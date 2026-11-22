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

test('dist/risuhelper.js applies a proposal to its pinned target even if user switches target before clicking Apply', async () => {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const doc = createMockDocument();
  const registeredButtons = [];
  const state = {
    character: {
      chaId: 'char-pin-1',
      name: '핀테스트',
      desc: '원본 설명',
      firstMessage: '원본 첫 메시지',
      globalLore: [],
      customscript: [],
      triggerscript: [],
      chats: [{ message: [{ role: 'char', data: '원본 첫 메시지' }] }],
    },
  };

  const mockRisuai = {
    pluginStorage: { async getItem() { return null; }, async setItem() {} },
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async registerButton(meta, cb) { registeredButtons.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(name, cb, _icon, _type, id) { return { id }; },
    async unregisterUIPart() {},
    async onUnload() {},
    async showContainer() {},
    async hideContainer() {},
    async getCharacter() { return structuredClone(state.character); },
    async setCharacter(c) { state.character = structuredClone(c); },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getRootDocument() { return null; },
    async runLLMModel() {
      return [
        '설명을 개선했습니다.',
        '```risuhelper-proposal',
        '{"action":"replace_text","title":"설명 개선"}',
        '<<<CONTENT>>>',
        '새로 작성된 설명',
        '<<<END>>>',
        '```',
      ].join('\n');
    },
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

  // Open drawer
  registeredButtons[0].cb();
  await new Promise(r => setTimeout(r, 20));

  // Find helper to locate elements by predicate
  const findAll = (pred) => {
    const out = [];
    const walk = (node) => {
      if (pred(node)) out.push(node);
      for (const c of node.children || []) walk(c);
    };
    walk(doc.body);
    return out;
  };

  // 1. Select char_field:desc in target picker
  const selectEl = findAll(n => n.tagName === 'SELECT')[0];
  selectEl.value = 'char_field:desc';
  for (const fn of selectEl.listeners.get('change') || []) await fn({ target: selectEl });

  // 2. Send prompt to get replace_text proposal for desc
  const composer = doc.querySelector('.rh-composer-input');
  composer.value = '설명 고쳐줘';
  const sendBtn = findAll(n => n.tagName === 'BUTTON' && n.textContent === '전송')[0];
  sendBtn.click();
  await new Promise(r => setTimeout(r, 30));

  // 3. Before clicking Apply, switch target picker to char_field:firstMessage!
  const selectAfter = findAll(n => n.tagName === 'SELECT')[0];
  selectAfter.value = 'char_field:firstMessage';
  for (const fn of selectAfter.listeners.get('change') || []) await fn({ target: selectAfter });

  // 4. Click Apply on the proposal card -> MUST apply to pinned desc, NOT firstMessage!
  const applyBtn = findAll(n => n.tagName === 'BUTTON' && n.textContent === '적용')[0];
  assert.ok(applyBtn, 'Apply button should exist');
  applyBtn.click();
  await new Promise(r => setTimeout(r, 30));

  assert.equal(state.character.desc, '새로 작성된 설명');
  assert.equal(state.character.firstMessage, '원본 첫 메시지');
});

test('dist/risuhelper.js preserves preset panel scrollTop on toggle click and renders Clear Chat inside wrapping header actions', async () => {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const doc = createMockDocument();
  const registeredButtons = [];
  const storage = new Map();

  // Seed preset with toggles so toggles pane renders checkboxes
  storage.set('risuhelper_preset_v1', JSON.stringify({
    schemaVersion: 1,
    mode: 'preset',
    pane: 'toggles',
    preset: {
      name: '토글 테스트 프리셋',
      customPromptTemplateToggle: 't1=첫번째 토글=switch\nt2=두번째 토글=switch',
      promptTemplate: [{ type: 'chat', rangeStart: 0, rangeEnd: 'end' }],
    },
    modules: [],
    moduleOptions: {},
    values: { toggle_t1: '0', toggle_t2: '0' },
    selectedBlock: 0,
    environment: { userName: '사용자', persona: '', authorNote: '', memory: '', globals: {} },
    excluded: { regex: false, modules: false, overlay: false },
  }));

  const mockRisuai = {
    pluginStorage: {
      async getItem(k) { return storage.get(k) ?? null; },
      async setItem(k, v) { storage.set(k, v); },
    },
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async registerButton(meta, cb) { registeredButtons.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting() { return { id: 's1' }; },
    async unregisterUIPart() {},
    async onUnload() {},
    async showContainer() {},
    async hideContainer() {},
    async getCharacter() { return { name: '테스트봇', desc: '', globalLore: [], customscript: [], triggerscript: [], chats: [{}] }; },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getRootDocument() { return null; },
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

  registeredButtons[0].cb();
  await new Promise(r => setTimeout(r, 20));

  const findAll = (pred) => {
    const out = [];
    const walk = (node) => {
      if (pred(node)) out.push(node);
      for (const c of node.children || []) walk(c);
    };
    walk(doc.body);
    return out;
  };

  // Verify responsive header has .rh-header-top with Close and .rh-actions with Clear Chat
  const headerTop = doc.querySelector('.rh-header-top');
  assert.ok(headerTop, 'header should have dedicated .rh-header-top row');
  const actionsBar = doc.querySelector('.rh-actions');
  assert.ok(actionsBar, 'header should have wrapping .rh-actions toolbar');
  assert.ok(findAll(n => n.tagName === 'BUTTON' && n.textContent === '대화 비우기').length === 1);
  assert.ok(findAll(n => n.tagName === 'BUTTON' && n.textContent === '닫기').length === 1);

  // Open preset panel -> toggles pane
  const presetBtn = findAll(n => n.tagName === 'BUTTON' && n.textContent.startsWith('프리셋'))[0];
  presetBtn.click();
  await new Promise(r => setTimeout(r, 20));

  const presetBody = doc.querySelector('.rh-preset-body');
  assert.ok(presetBody, 'preset panel body should have .rh-preset-body class');
  presetBody.scrollTop = 240;

  // Toggle checkbox inside preset panel -> must save WITHOUT resetting scrollTop!
  const toggleCheckboxes = findAll(n => n.tagName === 'INPUT' && n.attributes.type === 'checkbox');
  assert.ok(toggleCheckboxes.length >= 2);
  toggleCheckboxes[0].checked = true;
  for (const fn of toggleCheckboxes[0].listeners.get('change') || []) {
    await fn({ target: toggleCheckboxes[0] });
  }
  await new Promise(r => setTimeout(r, 20));

  assert.equal(doc.querySelector('.rh-preset-body').scrollTop, 240);
  const saved = JSON.parse(storage.get('risuhelper_preset_v1'));
  assert.equal(saved.values.toggle_t1, '1');

  // Even a full re-render (e.g. clicking '넓게') preserves .rh-preset-body.scrollTop
  const wideBtn = findAll(n => n.tagName === 'BUTTON' && (n.textContent === '넓게' || n.textContent === '좁게'))[0];
  wideBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(doc.querySelector('.rh-preset-body').scrollTop, 240);
});


