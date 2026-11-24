import test from 'node:test';
import assert from 'node:assert/strict';
import { RisuHelperApp } from '../src/ui.js';
import { createMockDocument } from './helpers/mock-document.mjs';

function makeMockRootDoc() {
  const chips = [];
  const makeNode = (tag) => {
    const attrs = new Map();
    const listeners = new Map();
    const node = {
      tag,
      removed: false,
      styleAttr: '',
      text: '',
      async setAttribute(k, v) { attrs.set(k, v); },
      async setStyleAttribute(s) { node.styleAttr = s; },
      async setTextContent(t) { node.text = t; },
      async getBoundingClientRect() { return { left: 10, top: 10, width: 120, height: 32 }; },
      async addEventListener(type, fn) {
        const id = `${type}-${listeners.size + 1}`;
        listeners.set(id, { type, fn });
        return id;
      },
      async removeEventListener(_type, id) { listeners.delete(id); },
      async remove() {
        node.removed = true;
        const idx = chips.indexOf(node);
        if (idx !== -1) chips.splice(idx, 1);
      },
      _attrs: attrs,
      _listeners: listeners,
    };
    return node;
  };
  const body = {
    async appendChild(el) {
      if (el._attrs.get('x-risuhelper-chip') === '1') chips.push(el);
    },
    async getBoundingClientRect() { return { width: 1200, height: 800 }; },
  };
  const rootDoc = {
    chips,
    async getBoundingClientRect() { return { width: 1200, height: 800 }; },
    async addEventListener() { return 'l-1'; },
    async removeEventListener() {},
    async createElement(tag) { return makeNode(tag); },
    async querySelector(sel) {
      if (sel === 'body') return body;
      if (sel === '[x-risuhelper-chip="1"]') return chips[0] || null;
      return null;
    },
    async querySelectorAll(sel) {
      const list = sel === '[x-risuhelper-chip="1"]' ? [...chips] : [];
      return {
        async length() { return list.length; },
        async at(i) { return list[i] ?? null; },
      };
    },
  };
  return { rootDoc, makeNode };
}

test('RisuHelper never registers a fixed top-right location:action button, even without mainDom or with legacy showHostActionButton setting', async () => {
  const registered = [];
  const storage = new Map([
    ['risuhelper_state_v1', JSON.stringify({ showFloatingChip: false, showHostActionButton: true })],
  ]);
  const api = {
    pluginStorage: {
      async getItem(k) { return storage.get(k) ?? null; },
      async setItem(k, v) { storage.set(k, v); },
    },
    async registerButton(meta, cb) { registered.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(name, cb, _icon, _type, id) { registered.push({ meta: { name, id }, cb }); return { id }; },
    async getRootDocument() { return null; },
  };
  const app = new RisuHelperApp(api, createMockDocument());
  await app.init();

  assert.equal(registered.some(r => r.meta?.location === 'action'), false, 'must never register a location:action button');
  assert.deepEqual(registered.map(r => r.meta.id).sort(), ['risuhelper-ham', 'risuhelper-setting']);
  await app.destroy();
});

test('disabling showFloatingChip removes the draggable chip (and any orphan chip) from host DOM without spawning a fallback action button', async () => {
  const registered = [];
  const { rootDoc, makeNode } = makeMockRootDoc();
  const storage = new Map();
  const api = {
    pluginStorage: {
      async getItem(k) { return storage.get(k) ?? null; },
      async setItem(k, v) { storage.set(k, v); },
    },
    async registerButton(meta, cb) { registered.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(name, cb, _icon, _type, id) { registered.push({ meta: { name, id }, cb }); return { id }; },
    async getRootDocument() { return rootDoc; },
  };
  const app = new RisuHelperApp(api, createMockDocument());
  await app.init();
  assert.equal(rootDoc.chips.length, 1, 'draggable chip starts mounted when enabled');

  // Inject an extra orphan chip to simulate a lingering element from a prior reload
  const orphan = makeNode('div');
  await orphan.setAttribute('x-risuhelper-chip', '1');
  rootDoc.chips.push(orphan);
  assert.equal(rootDoc.chips.length, 2);

  // Open settings and toggle "화면에 플로팅 버튼 표시" off
  app.settingsOpen = true;
  app.render();
  const findAll = (node, pred, out = []) => {
    if (!node) return out;
    if (pred(node)) out.push(node);
    for (const c of node.children || []) findAll(c, pred, out);
    return out;
  };
  const label = findAll(app.doc.body, n => n.tagName === 'LABEL' && /화면에 플로팅 버튼 표시/.test(n.textContent))[0];
  assert.ok(label);
  const hostActionLabels = findAll(app.doc.body, n => n.tagName === 'LABEL' && /우측 상단 고정/.test(n.textContent));
  assert.equal(hostActionLabels.length, 0, 'top-right fixed button setting must be gone');

  const cb = label.children.find(c => c.tagName === 'INPUT');
  cb.checked = false;
  for (const fn of cb.listeners.get('change') || []) await fn({ target: cb });

  assert.equal(app.settings.showFloatingChip, false);
  assert.equal(rootDoc.chips.length, 0, 'all chip elements including orphans must be removed from host DOM');
  assert.equal(app.tracker.chipEl, null);
  assert.equal(registered.some(r => r.meta?.location === 'action'), false, 'turning off the chip must NOT spawn a top-right action button');

  await app.destroy();
});
