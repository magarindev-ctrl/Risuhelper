import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createMockDocument } from './helpers/mock-document.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLE_PATH = path.resolve(__dirname, '..', 'dist', 'risuhelper.js');
const PKG = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

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

  // Verify hamburger and settings entry points registered (no fixed top-right action button)
  assert.equal(registeredButtons.length, 2);
  assert.equal(registeredButtons.some(b => b.meta?.location === 'action'), false);
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.ok(doc.getElementById('risuhelper-styles'));

  // Open drawer via registered hamburger button
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
  assert.deepEqual(unregisteredIds.sort(), ['risuhelper-ham', 'risuhelper-setting']);
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

test('dist/risuhelper.js supports opt-in PC right-side docking with live real-time DOM focus updates and clean restore', async () => {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const doc = createMockDocument();
  const localWin = { innerWidth: 1440 };
  doc.defaultView = localWin;

  const storage = new Map([
    ['risuhelper_state_v1', JSON.stringify({ dockMode: true, autoOpenDocked: true, dockPushLayout: true, dockWidth: 420 })],
  ]);

  const myIframeStyles = { display: 'none', width: '100%' };
  const mainStyles = { width: '', maxWidth: '', boxSizing: '' };
  const myIframeAttrs = {};
  const rootListeners = [];
  let unloadHandler = null;

  const makeMockFocused = (labelText, tag = 'textarea', outerHtml = '<textarea></textarea>') => {
    const editor = {
      async getOuterHTML() { return outerHtml; },
      async nodeName() { return tag.toUpperCase(); },
      async textContent() { return ''; },
      async innerText() { return ''; },
      async getClassName() { return ''; },
      async getParent() { return container; },
      async getChildren() { return { async length() { return 0; }, async at() { return null; } }; },
      async querySelector() { return null; },
    };
    const labelSpan = {
      async getOuterHTML() { return `<span>${labelText}</span>`; },
      async nodeName() { return 'SPAN'; },
      async textContent() { return labelText; },
      async getClassName() { return 'text-textcolor'; },
      async getParent() { return container; },
      async getChildren() { return { async length() { return 0; }, async at() { return null; } }; },
    };
    const container = {
      async getOuterHTML() { return '<div class="char-config"></div>'; },
      async nodeName() { return 'DIV'; },
      async getClassName() { return 'char-config'; },
      async getParent() { return null; },
      async getChildren() {
        const list = [labelSpan, editor];
        return { async length() { return list.length; }, async at(i) { return list[i]; } };
      },
      async querySelector() { return null; },
    };
    return editor;
  };

  let currentFocused = makeMockFocused('설명');

  const myIframe = {
    async getStyle(k) { return myIframeStyles[k] || ''; },
    async setStyle(k, v) {
      myIframeStyles[k] = v;
      if (k === 'width') {
        const px = parseInt(v, 10);
        localWin.innerWidth = Number.isFinite(px) && String(v).endsWith('px') ? px : 1440;
      }
    },
    async setAttribute(k, v) { myIframeAttrs[k] = v; },
  };
  const mainEl = {
    async getStyle(k) { return mainStyles[k] || ''; },
    async setStyle(k, v) { mainStyles[k] = v; },
  };
  const rootDoc = {
    async getBoundingClientRect() { return { width: 1440, height: 900, top: 0, left: 0 }; },
    async querySelector(sel) {
      if (sel.includes(':focus')) return currentFocused;
      if (sel === 'body') return { async appendChild() {} };
      if (sel === 'main') return mainEl;
      if (sel.includes('x-risuhelper-frame') && myIframeAttrs['x-risuhelper-frame'] === '1') return myIframe;
      return null;
    },
    async querySelectorAll(sel) {
      if (sel === 'iframe') return { async length() { return 1; }, async at() { return myIframe; } };
      return { async length() { return 0; }, async at() { return null; } };
    },
    async createElement() {
      return {
        async setAttribute() {},
        async setStyleAttribute() {},
        async setTextContent() {},
        async getBoundingClientRect() { return { left: 1200, top: 700, width: 140, height: 36 }; },
        async addEventListener() { return 'cid'; },
        async removeEventListener() {},
        async remove() {},
      };
    },
    async addEventListener(type, fn) {
      rootListeners.push({ type, fn });
      return `lid-${rootListeners.length}`;
    },
    async removeEventListener() {},
  };

  const mockRisuai = {
    pluginStorage: {
      async getItem(k) { return storage.get(k) ?? null; },
      async setItem(k, v) { storage.set(k, v); },
    },
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async registerButton(meta) { return { id: meta.id }; },
    async registerSetting(_n, _cb, _i, _t, id) { return { id }; },
    async unregisterUIPart() {},
    async onUnload(fn) { unloadHandler = fn; },
    async showContainer() { myIframeStyles.display = 'block'; },
    async hideContainer() { myIframeStyles.display = 'none'; },
    async getRootDocument() { return rootDoc; },
    async getCharacter() {
      return {
        chaId: 'c1',
        name: '세라',
        desc: '캐릭터 설명 실시간 원문',
        firstMessage: '첫 메시지 실시간 원문',
        globalLore: [],
        customscript: [],
        triggerscript: [],
        chatPage: 0,
        chats: [{ note: '작가의 노트 실시간 원문', localLore: [] }],
      };
    },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getChatFromIndex() { return { note: '작가의 노트 실시간 원문', localLore: [] }; },
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
  await new Promise(r => setTimeout(r, 90));

  // Auto-docked on PC startup
  assert.equal(myIframeStyles.display, 'block');
  assert.equal(myIframeStyles.right, '0px');
  assert.equal(myIframeStyles.width, '420px');
  assert.equal(mainStyles.width, 'calc(100% - 420px)');
  assert.ok(doc.querySelector('.rh-shell').className.includes('docked'));
  assert.ok(doc.querySelector('.rh-drawer').className.includes('docked'));
  assert.match(doc.body.textContent, /캐릭터 설명 실시간 원문/);

  // Keep a draft inside RisuHelper's composer while clicking different DOM fields in RisuAI
  doc.querySelector('.rh-composer-input').value = '작업 중 초안';

  // User clicks '첫 메시지' in RisuAI on the left -> RisuHelper live-updates to firstMessage!
  currentFocused = makeMockFocused('첫 메시지');
  for (const l of rootListeners) {
    if (l.type === 'click') l.fn();
  }
  await new Promise(r => setTimeout(r, 80));
  assert.match(doc.body.textContent, /첫 메시지 실시간 원문/);
  assert.equal(doc.querySelector('.rh-composer-input').value, '작업 중 초안');

  // User clicks '작가의 노트' in RisuAI on the left -> RisuHelper live-updates to chat.note!
  currentFocused = makeMockFocused('작가의 노트');
  for (const l of rootListeners) {
    if (l.type === 'click') l.fn();
  }
  await new Promise(r => setTimeout(r, 80));
  assert.match(doc.body.textContent, /작가의 노트 실시간 원문/);

  // Clean unload restores <main> layout
  await unloadHandler();
  assert.equal(mainStyles.width, '');
});

test('dist/risuhelper.js renders LLM Markdown replies as rich editor cards with syntax highlighting and raw-view toggle', async () => {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const doc = createMockDocument();
  const registeredButtons = [];
  let lastCopied = '';
  doc.defaultView = {
    navigator: {
      clipboard: {
        async writeText(t) { lastCopied = t; },
      },
    },
  };

  const mockReply = [
    '## 상태창 Lua 가이드',
    '',
    '**핵심 변수** `hp` 와 {{char}} 매크로를 함께 사용하세요.',
    '',
    '> [!TIP]',
    '> `setChatVar` 호출 후에는 `reloadDisplay`를 확인하세요.',
    '',
    '```lua hp_sync.lua',
    'function onOutput(id)',
    '  setChatVar(id, "hp", "100")',
    'end',
    '```',
  ].join('\n');

  const mockRisuai = {
    pluginStorage: { async getItem() { return null; }, async setItem() {} },
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async registerButton(meta, cb) { registeredButtons.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(_n, _cb, _i, _t, id) { return { id }; },
    async unregisterUIPart() {},
    async onUnload() {},
    async showContainer() {},
    async hideContainer() {},
    async getCharacter() { return { name: '테스트봇', desc: '', globalLore: [], customscript: [], triggerscript: [], chats: [{}] }; },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getRootDocument() { return null; },
    async runLLMModel() { return mockReply; },
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

  doc.querySelector('.rh-composer-input').value = 'Lua 예시 보여줘';
  findAll(n => n.tagName === 'BUTTON' && n.textContent === '전송')[0].click();
  await new Promise(r => setTimeout(r, 30));

  // Verify rich Markdown nodes and editor-style code card rendered inside assistant bubble
  assert.ok(doc.querySelector('.rh-md'), 'assistant bubble should contain .rh-md root');
  assert.equal(doc.querySelector('.rh-md-h2').textContent, '상태창 Lua 가이드');
  assert.equal(doc.querySelector('.rh-md-strong').textContent, '핵심 변수');
  assert.equal(doc.querySelector('.rh-md-cbs').textContent, '{{char}}');
  assert.ok(doc.querySelector('.callout-tip'), 'tip callout should render');
  assert.equal(doc.querySelector('.rh-code-file').textContent, 'hp_sync.lua');
  assert.equal(doc.querySelector('.rh-code-gutter').textContent, '1\n2\n3');
  assert.ok(findAll(n => n.className === 'rh-tok-fn').some(n => n.textContent === 'setChatVar'));

  // Code card copy button copies exact code text
  doc.querySelector('.rh-code-copy').click();
  await new Promise(r => setTimeout(r, 10));
  assert.match(lastCopied, /^function onOutput\(id\)/);

  // Clicking '원문 보기' switches bubble to raw monospace Markdown view and back on '서식 보기'
  const rawBtn = findAll(n => n.tagName === 'BUTTON' && n.textContent === '원문 보기')[0];
  assert.ok(rawBtn, 'assistant bar should have 원문 보기 toggle');
  rawBtn.click();
  await new Promise(r => setTimeout(r, 10));
  assert.ok(doc.querySelector('.rh-raw-pre'), 'raw view should render .rh-raw-pre');
  assert.equal(doc.querySelector('.rh-md'), null);

  const fmtBtn = findAll(n => n.tagName === 'BUTTON' && n.textContent === '서식 보기')[0];
  fmtBtn.click();
  await new Promise(r => setTimeout(r, 10));
  assert.ok(doc.querySelector('.rh-md'), 'switching back restores rich Markdown view');
});

test('dist/risuhelper.js treats an expanded module entry without a cursor as a free-talk hint and tells the model which module and entry are open', async () => {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const doc = createMockDocument();
  const registeredButtons = [];
  let capturedSystemPrompt = null;

  const promptBody = '- CRITICAL: This is a front-end rendering command.\nBackground List: airplane interior, airport';

  const makeSafeEl = (tag, outerHtml, text = '', children = [], className = '') => {
    const el = {
      _tag: tag.toLowerCase(),
      _outerHtml: outerHtml,
      _text: text,
      _children: children,
      _className: className,
      _parent: null,
      async getOuterHTML() { return outerHtml; },
      async nodeName() { return tag.toUpperCase(); },
      async textContent() { return text; },
      async innerText() { return text; },
      async getClassName() { return className; },
      async getParent() { return el._parent; },
      async getChildren() {
        return { async length() { return children.length; }, async at(i) { return children[i] || null; } };
      },
      async querySelectorAll(sel) {
        const parts = sel.split(',').map(s => s.trim());
        const hits = [];
        const walk = (n) => {
          for (const c of n._children) {
            const match = parts.some(p => {
              if (p === 'h2') return c._tag === 'h2';
              if (p === '[role="tab"][aria-selected="true"]') return c._outerHtml.includes('role="tab"') && c._outerHtml.includes('aria-selected="true"');
              if (p === '[role="tab"]') return c._outerHtml.includes('role="tab"');
              if (p === '[data-risu-idx]') return c._outerHtml.includes('data-risu-idx=');
              if (p === 'button.valuer') return c._tag === 'button' && c._className.includes('valuer');
              if (p === '[contenteditable="true"]') return c._outerHtml.includes('contenteditable="true"');
              return false;
            });
            if (match) hits.push(c);
            walk(c);
          }
        };
        walk(el);
        return { async length() { return hits.length; }, async at(i) { return hits[i] || null; } };
      },
      async querySelector(sel) {
        const res = await el.querySelectorAll(sel);
        return (await res.length()) > 0 ? await res.at(0) : null;
      },
    };
    for (const c of children) c._parent = el;
    return el;
  };

  const modPage = makeSafeEl('div', '<div class="module-page"></div>', '', [
    makeSafeEl('h2', '<h2>모듈 수정</h2>', '모듈 수정'),
    makeSafeEl('button', '<button role="tab" aria-selected="true">로어북</button>', '로어북'),
    makeSafeEl('div', '<div data-risu-idx="0"></div>', '', [
      makeSafeEl('button', '<button class="endflex valuer">ha0</button>', 'ha0', [], 'endflex valuer'),
    ]),
    makeSafeEl('div', '<div data-risu-idx="1"></div>', '', [
      makeSafeEl('button', '<button class="endflex valuer">Global LoreBook Override</button>', 'Global LoreBook Override', [], 'endflex valuer'),
      makeSafeEl('div', '<div contenteditable="true"></div>', promptBody),
    ]),
    makeSafeEl('div', '<div data-risu-idx="2"></div>', '', [
      makeSafeEl('button', '<button class="endflex valuer">Home</button>', 'Home', [], 'endflex valuer'),
    ]),
  ]);

  const rootDoc = {
    async querySelector(sel) {
      if (sel === 'title') return { async textContent() { return 'PocketRisu'; } };
      if (sel === 'body') return { async appendChild() {} };
      if (sel.includes(':focus')) return null;
      return await modPage.querySelector(sel);
    },
    async querySelectorAll(sel) {
      return await modPage.querySelectorAll(sel);
    },
    async createElement() {
      return {
        async setAttribute() {},
        async setStyleAttribute() {},
        async setTextContent() {},
        async addEventListener() { return 'c1'; },
        async removeEventListener() {},
        async remove() {},
      };
    },
    async addEventListener() { return 'l1'; },
    async removeEventListener() {},
  };

  const mockRisuai = {
    pluginStorage: { async getItem() { return null; }, async setItem() {} },
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async registerButton(meta, cb) { registeredButtons.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(_n, _cb, _i, _t, id) { return { id }; },
    async unregisterUIPart() {},
    async onUnload() {},
    async showContainer() {},
    async hideContainer() {},
    async getCharacter() { return { name: '테스트봇', desc: '', globalLore: [], customscript: [], triggerscript: [], chats: [{}] }; },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async runLLMModel({ messages }) { capturedSystemPrompt = messages[0].content; return '설명입니다.'; },
    async getRootDocument() { return rootDoc; },
    async getDatabase() {
      return {
        modules: [
          {
            id: 'mod-0',
            name: '인레이 모듈 V3',
            description: 'AI챗고수가도리거야',
            lorebook: [{ comment: '인레이 1', key: 'a', content: 'inlay text' }],
          },
          {
            id: 'mod-1',
            name: '배경 자동 변경 모듈',
            description: '배경 모듈 설명',
            lorebook: [
              { comment: 'ha0', key: '', content: 'init' },
              { comment: 'Global LoreBook Override', key: '', content: promptBody },
              { comment: 'Home', key: 'home', content: 'home text' },
            ],
          },
        ],
        enabledModules: ['mod-0', 'mod-1'],
      };
    },
  };

  const sandbox = {
    window: { risuai: mockRisuai, Risuai: mockRisuai },
    risuai: mockRisuai,
    Risuai: mockRisuai,
    document: doc,
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    URL,
    Blob,
    crypto,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'risuhelper.js' });
  await new Promise(r => setTimeout(r, 40));

  await registeredButtons[0].cb();
  await new Promise(r => setTimeout(r, 30));

  const selects = [];
  const walk = (n) => {
    if (n.tagName === 'SELECT') selects.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(doc.body);

  // Nothing has the cursor, so the expanded module entry is a hint, not the target: free talk.
  assert.equal(selects.length, 1, 'without a selected input only the target select is shown');
  const autoOpt = selects[0].children.find(o => o.value === 'auto');
  assert.match(autoOpt.textContent, /자유대화/);
  assert.match(doc.body.textContent, /화면 힌트: 모듈 로어북 #2/);

  // The model still learns which module is open and gets the expanded entry's real text,
  // so it can address it explicitly (scope module + moduleIndex + loreIndex).
  doc.querySelector('.rh-composer-input').value = '펼쳐진 항목 설명해줘';
  const sendBtn = (() => { let found = null; const w = (n) => { if (n.tagName === 'BUTTON' && n.textContent === '전송') found = n; for (const c of n.children || []) w(c); }; w(doc.body); return found; })();
  sendBtn.click();
  await new Promise(r => setTimeout(r, 60));
  assert.ok(capturedSystemPrompt, 'the request must have been sent');
  assert.match(capturedSystemPrompt, /배경 자동 변경 모듈/);
  assert.match(capturedSystemPrompt, /moduleIndex: 1/);
  assert.match(capturedSystemPrompt, /loreIndex 1 "Global LoreBook Override"/);
  assert.match(capturedSystemPrompt, /CRITICAL: This is a front-end rendering command/);
  assert.doesNotMatch(capturedSystemPrompt, /AI챗고수가도리거야/);
});

test('dist/risuhelper.js keeps multi-line template literals byte-identical to src (no bundler indentation injected)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'llm.js'), 'utf8');
  const dist = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const start = src.indexOf('[수정·생성 제안 프로토콜]');
  assert.ok(start !== -1, 'expected the proposal protocol block in src/llm.js');
  const literalChunk = src.slice(start, start + 400);
  assert.ok(literalChunk.includes('\n'), 'chunk must span several lines');
  assert.ok(dist.includes(literalChunk), 'system prompt text in dist differs from src');
});

test('dist/risuhelper.js warns about stale tempModule after module apply and refills open contenteditable editor via 1-click button', async () => {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const doc = createMockDocument();
  const registeredButtons = [];

  const initialBody = 'Initial module lore line\nKeep this line';
  const patchedBody = 'Updated module lore line\nKeep this line';
  let liveDomText = initialBody;
  let editorFocusCount = 0;

  const db = {
    modules: [
      {
        id: 'mod-bg',
        name: '배경 모듈',
        description: '설명',
        lorebook: [
          { comment: 'ha0', key: '', content: 'init' },
          { comment: 'Global LoreBook Override', key: '', content: initialBody },
        ],
      },
    ],
    enabledModules: ['mod-bg'],
  };

  const makeSafeEl = (tag, outerHtml, textGetter, children = [], className = '', onSet = null, onFocus = null) => {
    const el = {
      _tag: tag.toLowerCase(),
      _outerHtml: outerHtml,
      _children: children,
      _className: className,
      _parent: null,
      async getOuterHTML() { return outerHtml; },
      async nodeName() { return tag.toUpperCase(); },
      async textContent() { return typeof textGetter === 'function' ? textGetter() : textGetter; },
      async innerText() { return typeof textGetter === 'function' ? textGetter() : textGetter; },
      async setTextContent(v) { if (onSet) onSet(String(v)); },
      async focus() { if (onFocus) onFocus(); },
      async getClassName() { return className; },
      async getParent() { return el._parent; },
      async getChildren() {
        return { async length() { return children.length; }, async at(i) { return children[i] || null; } };
      },
      async querySelectorAll(sel) {
        const parts = sel.split(',').map(s => s.trim());
        const hits = [];
        const walk = (n) => {
          for (const c of n._children) {
            const match = parts.some(p => {
              if (p === 'h2') return c._tag === 'h2';
              if (p === '[role="tab"][aria-selected="true"]') return c._outerHtml.includes('role="tab"') && c._outerHtml.includes('aria-selected="true"');
              if (p === '[role="tab"]') return c._outerHtml.includes('role="tab"');
              if (p === '[data-risu-idx]') return c._outerHtml.includes('data-risu-idx=');
              if (p === 'button.valuer') return c._tag === 'button' && c._className.includes('valuer');
              if (p === '[contenteditable="true"]') return c._outerHtml.includes('contenteditable="true"');
              return false;
            });
            if (match) hits.push(c);
            walk(c);
          }
        };
        walk(el);
        return { async length() { return hits.length; }, async at(i) { return hits[i] || null; } };
      },
      async querySelector(sel) {
        const res = await el.querySelectorAll(sel);
        return (await res.length()) > 0 ? await res.at(0) : null;
      },
    };
    for (const c of children) c._parent = el;
    return el;
  };

  const editorNode = makeSafeEl(
    'div',
    '<div contenteditable="true"></div>',
    () => liveDomText,
    [],
    '',
    (v) => { liveDomText = v; },
    () => { editorFocusCount++; }
  );

  const modPage = makeSafeEl('div', '<div class="module-page"></div>', '', [
    makeSafeEl('h2', '<h2>모듈 수정</h2>', '모듈 수정'),
    makeSafeEl('button', '<button role="tab" aria-selected="true">로어북</button>', '로어북'),
    makeSafeEl('div', '<div data-risu-idx="0"></div>', '', [
      makeSafeEl('button', '<button class="endflex valuer">ha0</button>', 'ha0', [], 'endflex valuer'),
    ]),
    makeSafeEl('div', '<div data-risu-idx="1"></div>', '', [
      makeSafeEl('button', '<button class="endflex valuer">Global LoreBook Override</button>', 'Global LoreBook Override', [], 'endflex valuer'),
      editorNode,
    ]),
  ]);

  const rootDoc = {
    async querySelector(sel) {
      if (sel === 'title') return { async textContent() { return 'PocketRisu'; } };
      if (sel === 'body') return { async appendChild() {} };
      if (sel.includes(':focus')) return null;
      return await modPage.querySelector(sel);
    },
    async querySelectorAll(sel) { return await modPage.querySelectorAll(sel); },
    async createElement() {
      return {
        async setAttribute() {},
        async setStyleAttribute() {},
        async setTextContent() {},
        async addEventListener() { return 'c1'; },
        async removeEventListener() {},
        async remove() {},
      };
    },
    async addEventListener() { return 'l1'; },
    async removeEventListener() {},
  };

  const mockRisuai = {
    pluginStorage: { async getItem() { return null; }, async setItem() {} },
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async registerButton(meta, cb) { registeredButtons.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(_n, _cb, _i, _t, id) { return { id }; },
    async unregisterUIPart() {},
    async onUnload() {},
    async showContainer() {},
    async hideContainer() {},
    async getCharacter() { return { name: '봇', desc: '', globalLore: [], customscript: [], triggerscript: [], chats: [{}] }; },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getRootDocument() { return rootDoc; },
    async getDatabase() { return JSON.parse(JSON.stringify(db)); },
    async setDatabaseLite(patch) {
      if (patch.modules) db.modules = JSON.parse(JSON.stringify(patch.modules));
    },
    async runLLMModel() {
      return '수정안입니다.\n```risuhelper-proposal\n{"action":"update_lorebook","title":"로어북 수정","scope":"module","moduleIndex":0,"loreIndex":1,"edits":[{"before":"Initial module lore line","after":"Updated module lore line"}]}\n```';
    },
  };

  const sandbox = {
    window: { risuai: mockRisuai, Risuai: mockRisuai },
    risuai: mockRisuai,
    Risuai: mockRisuai,
    document: doc,
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    URL,
    Blob,
    crypto,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'risuhelper.js' });
  await new Promise(r => setTimeout(r, 40));
  await registeredButtons[0].cb();
  await new Promise(r => setTimeout(r, 30));

  const findButtons = (label) => {
    const out = [];
    const walk = (n) => {
      if (n.tagName === 'BUTTON' && n.textContent === label) out.push(n);
      for (const c of n.children || []) walk(c);
    };
    walk(doc.body);
    return out;
  };

  doc.querySelector('.rh-composer-input').value = '첫 줄 고쳐줘';
  findButtons('전송')[0].click();
  await new Promise(r => setTimeout(r, 40));

  findButtons('적용')[0].click();
  await new Promise(r => setTimeout(r, 40));

  // DB updated immediately, tempModule safety notice rendered, and 1-click fill button available
  assert.equal(db.modules[0].lorebook[1].content, patchedBody);
  assert.equal(liveDomText, initialBody, 'default safe mode must not overwrite DOM until user clicks fill or opts in');
  assert.match(doc.body.textContent, /하단 "모듈 수정" 버튼을 누르면/);

  const fillBtns = findButtons('📝 입력칸에 채우기');
  assert.equal(fillBtns.length, 1, 'applied module card should offer 1-click DOM fill button');
  assert.equal(findButtons('📝 DB 최신본을 입력칸에 채우기').length, 1, 'context bar should detect DB vs screen mismatch');

  // Clicking 1-click fill updates live contenteditable DOM, focuses it, and shows Space+Backspace reminder
  fillBtns[0].click();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(liveDomText, patchedBody);
  assert.equal(editorFocusCount, 1);
  assert.match(doc.body.textContent, /스페이스→백스페이스/);
  assert.equal(findButtons('📝 DB 최신본을 입력칸에 채우기').length, 0, 'mismatch banner clears once DOM is synced');
});

test('dist/risuhelper.js rescues orphaned lorebooks in 1 click and organizes lorebooks into a folder past index 30', async () => {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const doc = createMockDocument();
  const registeredButtons = [];
  let capturedMessages = null;

  const existingFolderKey = '\uf000folder:existing-bg-35';
  const state = {
    character: {
      chaId: 'char-folder-e2e',
      name: '로어테스트',
      desc: '테스트 캐릭터',
      globalLore: [
        ...Array.from({ length: 33 }, (_, i) => ({
          comment: `로어 ${i + 1}`,
          key: `k${i + 1}`,
          content: `본문 ${i + 1}`,
          insertorder: 100,
          mode: 'normal',
        })),
        { comment: '숨겨진 로어 A', key: 'a', content: '살아있는 본문 A', insertorder: 100, mode: 'normal', folder: '잘못된폴더키' },
        { comment: '숨겨진 로어 B', key: 'b', content: '살아있는 본문 B', insertorder: 100, mode: 'normal', folder: '\\uf000folder:existing-bg-35' },
        { comment: '배경설정', key: existingFolderKey, content: '', insertorder: 100, mode: 'folder', alwaysActive: false, secondkey: '', selective: false },
      ],
      customscript: [],
      triggerscript: [],
      chats: [{ localLore: [], message: [] }],
    },
  };

  const mockRisuai = {
    pluginStorage: { async getItem() { return null; }, async setItem() {} },
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async registerButton(meta, cb) { registeredButtons.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(_n, _cb, _i, _t, id) { return { id }; },
    async unregisterUIPart() {},
    async onUnload() {},
    async showContainer() {},
    async hideContainer() {},
    async getCharacter() { return structuredClone(state.character); },
    async setCharacter(c) { state.character = structuredClone(c); },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getRootDocument() { return null; },
    async runLLMModel({ messages }) {
      capturedMessages = messages;
      return [
        '미리 만들어 둔 배경설정 폴더로 옮겼습니다.',
        '```risuhelper-proposal',
        JSON.stringify({
          action: 'organize_lorebook',
          title: '배경설정 폴더로 로어북 3개 이동',
          scope: 'character',
          folderName: '배경설정',
          loreIndices: [0, 33, 34],
        }),
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

  const findAll = (pred) => {
    const out = [];
    const walk = (n) => {
      if (pred(n)) out.push(n);
      for (const c of n.children || []) walk(c);
    };
    walk(doc.body);
    return out;
  };

  // Open drawer and switch to char_lorebook
  registeredButtons[0].cb();
  await new Promise(r => setTimeout(r, 20));
  const targetSel = findAll(n => n.tagName === 'SELECT')[0];
  targetSel.value = 'char_lorebook:';
  for (const fn of targetSel.listeners.get('change') || []) await fn({ target: targetSel });

  // 1. Orphaned Lorebook Rescue banner & button MUST appear for the 2 hidden lorebooks
  const rescueBtn = findAll(n => n.tagName === 'BUTTON' && n.textContent === '🛟 숨겨진 로어북 2개 최상위로 복구')[0];
  assert.ok(rescueBtn, 'rescue button should appear when orphaned lorebooks exist');

  rescueBtn.click();
  await new Promise(r => setTimeout(r, 30));

  assert.equal(Object.hasOwn(state.character.globalLore[33], 'folder'), false);
  assert.equal(Object.hasOwn(state.character.globalLore[34], 'folder'), false);
  assert.equal(state.character.globalLore[33].content, '살아있는 본문 A');
  assert.equal(findAll(n => n.tagName === 'BUTTON' && n.textContent.includes('최상위로 복구')).length, 0, 'rescue banner clears after recovery');

  // 2. Ask LLM to move lorebooks into existing folder at index 35 -> LLM receives folder at index 35 in context!
  doc.querySelector('.rh-composer-input').value = '배경설정 폴더에 담아줘';
  findAll(n => n.tagName === 'BUTTON' && n.textContent === '전송')[0].click();
  await new Promise(r => setTimeout(r, 40));

  assert.ok(capturedMessages, 'LLM should be called');
  assert.match(capturedMessages[0].content, /배경설정/, 'folder past index 30 must be visible to LLM');

  const applyBtn = findAll(n => n.tagName === 'BUTTON' && n.textContent === '적용')[0];
  assert.ok(applyBtn, 'organize_lorebook proposal should validate cleanly and render Apply button');
  applyBtn.click();
  await new Promise(r => setTimeout(r, 30));

  assert.equal(state.character.globalLore[0].folder, existingFolderKey);
  assert.equal(state.character.globalLore[33].folder, existingFolderKey);
  assert.equal(state.character.globalLore[34].folder, existingFolderKey);
  assert.equal(state.character.globalLore.length, 36, 'must reuse existing folder without duplicating it');

  // 3. 1-click Undo reverts all 3 moved entries in one step
  const undoCardBtn = findAll(n => n.tagName === 'BUTTON' && n.textContent === '되돌리기')[0];
  assert.ok(undoCardBtn);
  undoCardBtn.click();
  await new Promise(r => setTimeout(r, 30));

  assert.equal(Object.hasOwn(state.character.globalLore[0], 'folder'), false);
  assert.equal(Object.hasOwn(state.character.globalLore[33], 'folder'), false);
  assert.equal(Object.hasOwn(state.character.globalLore[34], 'folder'), false);
});

