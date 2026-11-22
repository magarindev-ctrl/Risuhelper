import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLE_PATH = path.resolve(__dirname, '..', 'dist', 'risuhelper.js');
const PKG = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

function createMockDocument() {
  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.className = '';
      this.id = '';
      this.value = '';
      this.checked = false;
      this.disabled = false;
      this.selected = false;
      this.attributes = {};
      this.style = {};
      this.children = [];
      this.listeners = new Map();
      this._textContent = '';
    }
    set textContent(v) {
      this._textContent = String(v ?? '');
      this.children = [];
    }
    get textContent() {
      return this._textContent + this.children.map(c => c.textContent || '').join('');
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'id') this.id = String(v);
      if (k === 'class') this.className = String(v);
    }
    getAttribute(k) { return this.attributes[k] ?? null; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    remove() {}
    click() {
      for (const fn of this.listeners.get('click') || []) {
        fn({ stopPropagation() {}, preventDefault() {}, target: this });
      }
    }
    querySelector(selector) {
      const wantClass = selector.startsWith('.') ? selector.slice(1) : null;
      const walk = (node) => {
        for (const c of node.children || []) {
          if (wantClass && String(c.className || '').split(/\s+/).includes(wantClass)) return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    }
  }

  const head = new MockElement('head');
  const body = new MockElement('body');
  const documentElement = new MockElement('html');
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  return {
    head,
    body,
    documentElement,
    defaultView: null,
    createElement(tag) { return new MockElement(tag); },
    createTextNode(text) { return { textContent: String(text), children: [] }; },
    getElementById(id) {
      const walk = (node) => {
        for (const c of node.children || []) {
          if (c.id === id) return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(documentElement);
    },
    querySelector(sel) { return body.querySelector(sel); },
  };
}

test('dist/risuhelper.js header meets RisuAI Plugin v3 500-byte spec and has zero external imports', () => {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const first500 = Buffer.from(code, 'utf8').subarray(0, 500).toString('utf8');

  assert.match(first500, /\/\/@name risuhelper/);
  assert.match(first500, /\/\/@api 3\.0/);
  assert.match(first500, new RegExp(`//@version ${PKG.version.replace(/\./g, '\\.')}`));
  assert.match(first500, /\/\/@update-url https:\/\/raw\.githubusercontent\.com\/magarindev-ctrl\/Risuhelper\/main\/dist\/risuhelper\.js/);
  assert.equal(/^\s*import\s+.*from\s+/m.test(code), false);
});

test('dist/risuhelper.js boots cleanly in mock Plugin v3 sandbox, prevents preset/composer textarea collision, and unloads cleanly', async () => {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const doc = createMockDocument();
  const registeredButtons = [];
  const unregisteredIds = [];
  const storage = new Map();
  let unloadHandler = null;
  let containerVisible = false;

  const mockRisuai = {
    pluginStorage: {
      async getItem(k) { return storage.get(k) ?? null; },
      async setItem(k, v) { storage.set(k, v); },
    },
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async registerButton(meta, cb) {
      registeredButtons.push({ meta, cb });
      return { id: meta.id };
    },
    async registerSetting(name, cb, _icon, _type, id) {
      registeredButtons.push({ meta: { name, id }, cb });
      return { id };
    },
    async unregisterUIPart(id) { unregisteredIds.push(id); },
    async onUnload(fn) { unloadHandler = fn; },
    async showContainer() { containerVisible = true; },
    async hideContainer() { containerVisible = false; },
    async getCharacter() {
      return { name: '테스트봇', desc: '설명 원문', globalLore: [], customscript: [], triggerscript: [], chats: [{}] };
    },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getRootDocument() { return null; }, // test graceful fallback without mainDom
  };

  const sandbox = {
    risuai: mockRisuai,
    document: doc,
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Int32Array,
    DataView,
    URL,
    Blob,
    atob,
    crypto,
    DecompressionStream,
    structuredClone,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(code, sandbox, { filename: 'dist/risuhelper.js' });
  await new Promise(r => setTimeout(r, 30));

  // Verify FAB, hamburger, and settings entry points registered
  assert.equal(registeredButtons.length, 3);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.ok(doc.getElementById('risuhelper-styles'));

  // Open drawer via registered FAB
  registeredButtons[0].cb();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(containerVisible, true);

  // Verify composer uses .rh-composer-input and preserves its value independently of other .rh-textarea elements
  const composerInput = doc.querySelector('.rh-composer-input');
  assert.ok(composerInput, 'composer textarea should have .rh-composer-input class');
  composerInput.value = '사용자 입력 초안';

  // Insert an earlier dummy preset .rh-textarea in DOM before composer to test regression
  const fakePresetArea = doc.createElement('textarea');
  fakePresetArea.className = 'rh-textarea';
  fakePresetArea.value = '프리셋 블록 내용';
  doc.body.children.unshift(fakePresetArea);

  // Re-open (triggers render) and confirm composer preserved user draft instead of preset block text
  registeredButtons[0].cb();
  await new Promise(r => setTimeout(r, 20));
  const afterRenderComposer = doc.querySelector('.rh-composer-input');
  assert.equal(afterRenderComposer.value, '사용자 입력 초안');

  // Verify clean unload unregisters all UI parts
  assert.equal(typeof unloadHandler, 'function');
  await unloadHandler();
  assert.deepEqual(unregisteredIds.sort(), ['risuhelper-fab', 'risuhelper-ham', 'risuhelper-setting']);
});
