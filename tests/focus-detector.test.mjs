import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseOpeningTagAttrs,
  classifyDomSignals,
  inspectFocusedElement,
  FocusTracker,
} from '../src/focus-detector.js';

test('parseOpeningTagAttrs extracts attributes and decodes basic HTML entities', () => {
  const attrs = parseOpeningTagAttrs('<textarea placeholder="Character &quot;Desc&quot;" data-risu-idx="3" contenteditable="true">body</textarea>');
  assert.equal(attrs._tag, 'textarea');
  assert.equal(attrs.placeholder, 'Character "Desc"');
  assert.equal(attrs['data-risu-idx'], '3');
  assert.equal(attrs.contenteditable, 'true');
});

test('classifyDomSignals maps persona, module edit warning, lorebook scopes, Lua, regex, settings, and char fields', () => {
  const persona = classifyDomSignals({
    tag: 'textarea',
    headings: ['페르소나'],
    nearbyLabel: '설명',
  });
  assert.equal(persona.targetKind, 'persona');
  assert.equal(persona.fieldKey, 'personaPrompt');

  const modLore = classifyDomSignals({
    tag: 'textarea',
    headings: ['모듈 수정'],
    loreIdx: 2,
    nearbyLabel: '프롬프트',
  });
  assert.equal(modLore.targetKind, 'module_lorebook');
  assert.equal(modLore.loreIndex, 2);
  assert.equal(modLore.loreScope, 'module');
  assert.ok(modLore.warnings.some(w => w.includes('tempModule')));

  const chatLore = classifyDomSignals({
    tag: 'input',
    loreIdx: 1,
    activeTabs: ['채팅'],
    nearbyLabel: '활성화 키',
  });
  assert.equal(chatLore.targetKind, 'chat_lorebook');
  assert.equal(chatLore.fieldKey, 'key');
  assert.equal(chatLore.loreIndex, 1);

  const lua = classifyDomSignals({
    tag: 'textarea',
    luaButtonActive: true,
  });
  assert.equal(lua.targetKind, 'char_lua');

  const regex = classifyDomSignals({
    tag: 'textarea',
    hasRegexContainer: true,
    nearbyLabel: 'OUT',
  });
  assert.equal(regex.targetKind, 'char_regex');
  assert.equal(regex.fieldKey, 'out');

  const cfg = classifyDomSignals({
    tag: 'textarea',
    headings: ['소리 및 디스플레이'],
    nearbyLabel: 'Custom CSS',
  });
  assert.equal(cfg.targetKind, 'config');
  assert.equal(cfg.fieldKey, 'customCSS');

  const charDesc = classifyDomSignals({
    tag: 'textarea',
    nearbyLabel: 'Description',
  });
  assert.equal(charDesc.targetKind, 'char_field');
  assert.equal(charDesc.fieldKey, 'desc');
});

function createSafeNode({ tag, outerHtml, text = '', className = '', children = [], parent = null }) {
  const node = {
    _parent: parent,
    _children: children,
    async getOuterHTML() { return outerHtml; },
    async nodeName() { return tag.toUpperCase(); },
    async textContent() { return text; },
    async innerText() { return text; },
    async getClassName() { return className; },
    async getParent() { return node._parent; },
    async getChildren() {
      return {
        async length() { return node._children.length; },
        async at(i) { return node._children[i] || null; },
      };
    },
    async querySelector() { return null; },
  };
  for (const child of children) child._parent = node;
  return node;
}

test('inspectFocusedElement tracks curOuter across ancestor depth so preceding label is matched accurately', async () => {
  const focusedTextarea = createSafeNode({
    tag: 'textarea',
    outerHtml: '<textarea class="inner"></textarea>',
  });
  const wrapper = createSafeNode({
    tag: 'div',
    outerHtml: '<div class="field-wrap"><textarea class="inner"></textarea></div>',
    children: [focusedTextarea],
  });
  const firstLabel = createSafeNode({
    tag: 'span',
    outerHtml: '<span>첫 메시지</span>',
    text: '첫 메시지',
  });
  const trailingLabel = createSafeNode({
    tag: 'span',
    outerHtml: '<span>제작자 코멘트</span>',
    text: '제작자 코멘트',
  });
  const form = createSafeNode({
    tag: 'div',
    outerHtml: '<div class="form">...</div>',
    children: [firstLabel, wrapper, trailingLabel],
  });

  const rootDoc = {
    async querySelector(sel) {
      if (sel.includes(':focus')) return focusedTextarea;
      return null;
    },
    async querySelectorAll() {
      return { async length() { return 0; }, async at() { return null; } };
    },
  };

  const ctx = await inspectFocusedElement(rootDoc);
  assert.ok(ctx);
  assert.equal(ctx.targetKind, 'char_field');
  assert.equal(ctx.fieldKey, 'firstMessage');
  assert.equal(form._children.length, 3);
});

test('FocusTracker starts, mounts draggable floating chip, scans on events, and cleans up on stop', async () => {
  const listeners = new Map();
  let nextId = 1;
  let removedChip = false;
  let chipText = '';
  let chipStyle = '';
  let chipClicked = 0;
  let movedPos = null;

  const chipListeners = new Map();
  const chipNode = {
    attrs: {},
    async setAttribute(k, v) { this.attrs[k] = v; },
    async setStyleAttribute(s) { chipStyle = s; },
    async setTextContent(t) { chipText = t; },
    async getBoundingClientRect() { return { left: 860, top: 650, width: 140, height: 36 }; },
    async addEventListener(evt, fn) {
      const id = `chip-${evt}-${nextId++}`;
      chipListeners.set(evt, fn);
      return id;
    },
    async removeEventListener() {},
    async remove() { removedChip = true; },
  };

  const focusedEl = createSafeNode({
    tag: 'textarea',
    outerHtml: '<textarea placeholder="First Message"></textarea>',
  });
  createSafeNode({ tag: 'div', outerHtml: '<div></div>', children: [focusedEl] });

  const rootDoc = {
    async querySelector(sel) {
      if (sel === 'body') return { async appendChild() {} };
      if (sel === 'html') return { async getBoundingClientRect() { return { width: 1024, height: 768 }; } };
      if (sel.includes(':focus')) return focusedEl;
      return null;
    },
    async querySelectorAll() { return { async length() { return 0; }, async at() { return null; } }; },
    async createElement() { return chipNode; },
    async addEventListener(type, fn) {
      const id = `${type}-${nextId++}`;
      listeners.set(id, { type, fn });
      return id;
    },
    async removeEventListener(_type, id) {
      listeners.delete(id);
    },
  };

  let detected = null;
  const tracker = new FocusTracker(
    { async getRootDocument() { return rootDoc; } },
    {
      showFloatingChip: true,
      onChange: (ctx) => { detected = ctx; },
      onChipClick: () => { chipClicked++; },
      onChipMove: (pos) => { movedPos = pos; },
    }
  );

  assert.equal(await tracker.start(), true);
  assert.ok(listeners.size >= 6);
  await tracker.scanNow();
  assert.equal(detected.fieldKey, 'firstMessage');
  assert.ok(chipText.includes('첫 메시지'));

  // Plain click opens drawer
  chipListeners.get('click')();
  assert.equal(chipClicked, 1);

  // Dragging moves chip, clamps within viewport, persists position, and suppresses trailing click
  chipListeners.get('pointerdown')({ clientX: 900, clientY: 660, button: 0 });
  await new Promise(r => setTimeout(r, 10));
  for (const entry of listeners.values()) {
    if (entry.type === 'pointermove') entry.fn({ clientX: 200, clientY: 160 });
  }
  await new Promise(r => setTimeout(r, 30));
  for (const entry of listeners.values()) {
    if (entry.type === 'pointerup') entry.fn({ clientX: 200, clientY: 160 });
  }
  await new Promise(r => setTimeout(r, 10));

  assert.ok(movedPos, 'onChipMove should fire with final dragged position');
  assert.equal(movedPos.left, 160);
  assert.equal(movedPos.top, 150);
  assert.match(chipStyle, /left:160px;top:150px;/);

  // Trailing click right after drag MUST NOT open drawer
  chipListeners.get('click')();
  assert.equal(chipClicked, 1);

  // Reset position returns to default bottom-right anchoring
  await tracker.setChipPosition(null);
  assert.match(chipStyle, /right:14px;bottom:74px;/);

  await tracker.stop();
  assert.equal(removedChip, true);
  assert.equal(listeners.size, 0);
});

test('inspectFocusedElement detects DefaultChatScreen textarea.text-input-area even with page <h2> tags, and inspectVisibleScreen detects chat without focus', async () => {
  const { inspectVisibleScreen } = await import('../src/focus-detector.js');

  const chatTextarea = createSafeNode({
    tag: 'textarea',
    outerHtml: '<textarea class="peer text-input-area focus:border-textcolor input-text"></textarea>',
  });
  createSafeNode({ tag: 'div', outerHtml: '<div class="flex mt-2"></div>', children: [chatTextarea] });

  const randomChatH2 = createSafeNode({ tag: 'h2', outerHtml: '<h2>페르소나 상태창</h2>', text: '페르소나 상태창' });
  const rootDocFocused = {
    async querySelector(sel) {
      if (sel.includes(':focus')) return chatTextarea;
      if (sel.includes('text-input-area')) return chatTextarea;
      return null;
    },
    async querySelectorAll(sel) {
      if (sel === 'h2') return { async length() { return 1; }, async at() { return randomChatH2; } };
      return { async length() { return 0; }, async at() { return null; } };
    },
  };

  const focusedCtx = await inspectFocusedElement(rootDocFocused);
  assert.ok(focusedCtx);
  assert.equal(focusedCtx.screen, 'chat');
  assert.equal(focusedCtx.labelText, '채팅 입력 화면');

  // When nothing is focused (e.g. FAB tapped directly on chat screen), inspectVisibleScreen detects chat
  const rootDocNoFocus = {
    async querySelector(sel) {
      if (sel.includes(':focus')) return null;
      if (sel.includes('text-input-area')) return chatTextarea;
      return null;
    },
    async querySelectorAll() {
      return { async length() { return 0; }, async at() { return null; } };
    },
  };

  assert.equal(await inspectFocusedElement(rootDocNoFocus), null);
  const screenCtx = await inspectVisibleScreen(rootDocNoFocus);
  assert.ok(screenCtx);
  assert.equal(screenCtx.screen, 'chat');
});

function createInteractiveSafeNode({
  tag,
  outerHtml = '',
  text = '',
  className = '',
  rect = null,
  children = [],
  focused = false,
}) {
  const node = {
    _tag: tag.toLowerCase(),
    _parent: null,
    _children: children,
    _focused: focused,
    _rect: rect,
    async getOuterHTML() { return outerHtml || `<${tag.toLowerCase()}${className ? ` class="${className}"` : ''}></${tag.toLowerCase()}>`; },
    async nodeName() { return tag.toUpperCase(); },
    async textContent() { return text; },
    async innerText() { return text; },
    async getClassName() { return className; },
    async getBoundingClientRect() { return node._rect; },
    async getParent() { return node._parent; },
    async getChildren() {
      return {
        async length() { return node._children.length; },
        async at(i) { return node._children[i] || null; },
      };
    },
    async querySelector(sel) {
      if (sel.includes(':focus')) {
        const findFocused = (n) => {
          for (const c of n._children) {
            if (c._focused) return c;
            const found = findFocused(c);
            if (found) return found;
          }
          return null;
        };
        return findFocused(node);
      }
      return null;
    },
  };
  for (const child of children) child._parent = node;
  return node;
}

function makePocketRisuTextArea({ contentEditable = false, rect = null } = {}) {
  const editor = createInteractiveSafeNode({
    tag: contentEditable ? 'div' : 'textarea',
    outerHtml: contentEditable
      ? '<div class="w-full h-full" contenteditable="true" role="textbox"></div>'
      : '<textarea class="w-full h-full bg-transparent"></textarea>',
    rect,
  });
  const innerWrap = createInteractiveSafeNode({
    tag: 'div',
    className: 'relative flex-1 min-h-0 w-full',
    outerHtml: '<div class="relative flex-1 min-h-0 w-full"><textarea class="w-full h-full bg-transparent"></textarea></div>',
    children: [editor],
  });
  const actionBar = createInteractiveSafeNode({
    tag: 'div',
    className: 'shrink-0 flex items-center justify-end gap-0.5',
    outerHtml: '<div class="shrink-0 flex items-center justify-end gap-0.5"><button>copy</button></div>',
  });
  const outerWrap = createInteractiveSafeNode({
    tag: 'div',
    className: 'border border-darkborderc relative flex flex-col n-scroll rounded-md',
    outerHtml: '<div class="border border-darkborderc relative flex flex-col n-scroll rounded-md">identical-textarea-wrapper</div>',
    children: [innerWrap, actionBar],
  });
  return { editor, outerWrap };
}

function makeMockRootDoc(focusedNode) {
  return {
    async querySelector(sel) {
      if (sel.includes(':focus')) return focusedNode;
      return null;
    },
    async querySelectorAll() {
      return { async length() { return 0; }, async at() { return null; } };
    },
  };
}

test('PocketRisu CharConfig fields are never hijacked as Lua even when ancestor HTML contains "Trigger" and TextAreaInputs share identical outerHTML', async () => {
  const nameInput = createInteractiveSafeNode({
    tag: 'input',
    outerHtml: '<input type="text" placeholder="캐릭터 이름">',
    rect: { top: 100, left: 20, width: 320, height: 36 },
  });
  const descTa = makePocketRisuTextArea({ contentEditable: false });
  const firstMsgTa = makePocketRisuTextArea({ contentEditable: false });
  const authorNoteTa = makePocketRisuTextArea({ contentEditable: true });

  const charConfig = createInteractiveSafeNode({
    tag: 'div',
    className: 'flex flex-col',
    // Simulate PocketRisu bits-ui / tooltip attributes containing "Trigger" on the ancestor subtree
    outerHtml: '<div class="flex flex-col" data-tooltip-trigger="help">...Trigger...</div>',
    children: [
      createInteractiveSafeNode({ tag: 'h2', text: '캐릭터 정보', outerHtml: '<h2>캐릭터 정보</h2>' }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '캐릭터 이름' }),
      nameInput,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '설명 ?' }),
      descTa.outerWrap,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor2 mb-6 text-sm', text: '2404 토큰' }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '첫 메시지 ?' }),
      firstMsgTa.outerWrap,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor2 mb-6 text-sm', text: '8505 토큰' }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '작가의 노트 ?' }),
      authorNoteTa.outerWrap,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor2 mb-6 text-sm', text: '0 토큰' }),
    ],
  });
  const pageShell = createInteractiveSafeNode({
    tag: 'main',
    outerHtml: '<main data-popover-trigger="menu">TriggerScript</main>',
    children: [charConfig],
  });
  assert.ok(pageShell);

  const focusOnly = (target) => {
    for (const node of [nameInput, descTa.editor, firstMsgTa.editor, authorNoteTa.editor]) {
      node._focused = node === target;
    }
  };

  focusOnly(nameInput);
  const nameCtx = await inspectFocusedElement(makeMockRootDoc(nameInput));
  assert.equal(nameCtx.targetKind, 'char_field');
  assert.equal(nameCtx.fieldKey, 'name');

  focusOnly(descTa.editor);
  const descCtx = await inspectFocusedElement(makeMockRootDoc(descTa.editor));
  assert.equal(descCtx.targetKind, 'char_field');
  assert.equal(descCtx.fieldKey, 'desc');

  focusOnly(firstMsgTa.editor);
  const firstCtx = await inspectFocusedElement(makeMockRootDoc(firstMsgTa.editor));
  assert.equal(firstCtx.targetKind, 'char_field');
  assert.equal(firstCtx.fieldKey, 'firstMessage');

  focusOnly(authorNoteTa.editor);
  const noteCtx = await inspectFocusedElement(makeMockRootDoc(authorNoteTa.editor));
  assert.equal(noteCtx.targetKind, 'chat_note');
  assert.equal(noteCtx.fieldKey, 'note');
  assert.equal(noteCtx.labelText, '작가의 노트 (현재 채팅)');
});

test('PocketRisu Scripts tab distinguishes backgroundHTML, RegexData (with data-risu-idx), Lua TriggerList, and virtualscript accurately', async () => {
  const bgTa = makePocketRisuTextArea({ contentEditable: true });
  const regexNameInput = createInteractiveSafeNode({
    tag: 'input',
    outerHtml: '<input type="text">',
    rect: { top: 200, left: 20, width: 300, height: 32 },
  });
  const regexInInput = createInteractiveSafeNode({
    tag: 'input',
    outerHtml: '<input type="text">',
    rect: { top: 280, left: 20, width: 300, height: 32 },
  });
  const regexOutTa = makePocketRisuTextArea({ contentEditable: true });
  const regexSep = createInteractiveSafeNode({
    tag: 'div',
    className: 'seperator p-2',
    children: [
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor mt-6', text: '이름' }),
      regexNameInput,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor mt-4', text: 'Modification Type' }),
      createInteractiveSafeNode({ tag: 'select' }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor mt-6', text: 'IN:' }),
      regexInInput,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor mt-6', text: 'OUT:' }),
      regexOutTa.outerWrap,
    ],
  });
  const regexRow = createInteractiveSafeNode({
    tag: 'div',
    outerHtml: '<div class="w-full flex flex-col" data-risu-idx="1"></div>',
    children: [regexSep],
  });
  const regexListWrap = createInteractiveSafeNode({
    tag: 'div',
    className: 'border-selected',
    children: [regexRow],
  });

  const luaBar = createInteractiveSafeNode({
    tag: 'div',
    className: 'flex items-start mt-2 gap-2',
    children: [
      createInteractiveSafeNode({ tag: 'button', className: 'bg-bgcolor py-1 rounded-md', text: 'V2' }),
      createInteractiveSafeNode({ tag: 'button', className: 'bg-bgcolor py-1 rounded-md ring-1', text: 'Lua' }),
    ],
  });
  const luaTa = makePocketRisuTextArea({ contentEditable: false });
  const charJsTa = makePocketRisuTextArea({ contentEditable: false });

  createInteractiveSafeNode({
    tag: 'div',
    className: 'flex flex-col',
    children: [
      createInteractiveSafeNode({ tag: 'h2', text: '스크립트' }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor mt-2', text: '백그라운드 임베딩 ?' }),
      bgTa.outerWrap,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor mt-4', text: '정규식 스크립트 ?' }),
      regexListWrap,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor mt-4', text: '트리거 스크립트 ?' }),
      luaBar,
      luaTa.outerWrap,
      createInteractiveSafeNode({ tag: 'button', text: '도움말' }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor mt-4', text: '캐릭터JS ?' }),
      charJsTa.outerWrap,
    ],
  });

  const allEditors = [bgTa.editor, regexNameInput, regexInInput, regexOutTa.editor, luaTa.editor, charJsTa.editor];
  const focusOnly = (target) => {
    for (const node of allEditors) node._focused = node === target;
  };

  // Background HTML must NOT be hijacked by the Lua bar further down in the same parent
  focusOnly(bgTa.editor);
  const bgCtx = await inspectFocusedElement(makeMockRootDoc(bgTa.editor));
  assert.equal(bgCtx.targetKind, 'char_field');
  assert.equal(bgCtx.fieldKey, 'backgroundHTML');

  // RegexData with data-risu-idx="1" must be char_regex (NOT char_lorebook)
  focusOnly(regexNameInput);
  const rNameCtx = await inspectFocusedElement(makeMockRootDoc(regexNameInput));
  assert.equal(rNameCtx.targetKind, 'char_regex');
  assert.equal(rNameCtx.fieldKey, 'comment');
  assert.equal(rNameCtx.regexIndex, 1);

  focusOnly(regexInInput);
  const rInCtx = await inspectFocusedElement(makeMockRootDoc(regexInInput));
  assert.equal(rInCtx.targetKind, 'char_regex');
  assert.equal(rInCtx.fieldKey, 'in');
  assert.equal(rInCtx.regexIndex, 1);

  focusOnly(regexOutTa.editor);
  const rOutCtx = await inspectFocusedElement(makeMockRootDoc(regexOutTa.editor));
  assert.equal(rOutCtx.targetKind, 'char_regex');
  assert.equal(rOutCtx.fieldKey, 'out');
  assert.equal(rOutCtx.regexIndex, 1);

  // Actual Lua trigger editor right after the active Lua mode bar IS char_lua
  focusOnly(luaTa.editor);
  const luaCtx = await inspectFocusedElement(makeMockRootDoc(luaTa.editor));
  assert.equal(luaCtx.targetKind, 'char_lua');
  assert.equal(luaCtx.fieldKey, 'code');

  // virtualscript after the Lua trigger editor must NOT stay stuck as char_lua
  focusOnly(charJsTa.editor);
  const jsCtx = await inspectFocusedElement(makeMockRootDoc(charJsTa.editor));
  assert.equal(jsCtx.targetKind, 'char_field');
  assert.equal(jsCtx.fieldKey, 'virtualscript');
});

test('PocketRisu CharConfig Advanced tab (<h2>고급 설정</h2>) and LoreBookData helper spans classify accurately', async () => {
  // 1. CharConfig Advanced tab: <h2>고급 설정</h2> must NOT override char_field:systemPrompt
  const sysPromptTa = makePocketRisuTextArea({ contentEditable: true });
  sysPromptTa.editor._focused = true;
  createInteractiveSafeNode({
    tag: 'div',
    children: [
      createInteractiveSafeNode({ tag: 'h2', text: '고급 설정' }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '시스템 프롬프트 ?' }),
      sysPromptTa.outerWrap,
    ],
  });
  const sysCtx = await inspectFocusedElement(makeMockRootDoc(sysPromptTa.editor));
  assert.equal(sysCtx.targetKind, 'char_field');
  assert.equal(sysCtx.fieldKey, 'systemPrompt');

  // 2. LoreBookData: muted helper span (text-xs text-textcolor2) between label and input must not clobber '활성화 키'
  const loreKeyInput = createInteractiveSafeNode({
    tag: 'input',
    outerHtml: '<input type="text">',
    rect: { top: 320, left: 20, width: 300, height: 32 },
    focused: true,
  });
  const loreBody = createInteractiveSafeNode({
    tag: 'div',
    className: 'border-0 outline-hidden w-full mt-2 flex flex-col mb-2',
    children: [
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor mt-6', text: '활성화 키 ?' }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-xs text-textcolor2', text: '키워드를 쉼표로 구분하세요' }),
      loreKeyInput,
    ],
  });
  createInteractiveSafeNode({
    tag: 'div',
    outerHtml: '<div class="w-full flex flex-col" data-risu-idx="2"></div>',
    children: [loreBody],
  });

  const loreCtx = await inspectFocusedElement(makeMockRootDoc(loreKeyInput));
  assert.equal(loreCtx.targetKind, 'char_lorebook');
  assert.equal(loreCtx.fieldKey, 'key');
  assert.equal(loreCtx.loreIndex, 2);
});

test('FocusTracker reads real SafeDocument viewport rect, supports quick drags, mouse fallback, and anchor presets', async () => {
  const listeners = new Map();
  const chipListeners = new Map();
  let nextId = 1;
  let chipStyle = '';
  let movedPos = null;
  let delayedRectResolve = null;

  const chipNode = {
    async setAttribute() {},
    async setStyleAttribute(s) { chipStyle = s; },
    async setTextContent() {},
    async getBoundingClientRect() {
      if (delayedRectResolve) {
        return await new Promise(resolve => { delayedRectResolve = resolve; });
      }
      return { left: 1740, top: 970, width: 160, height: 36 };
    },
    async addEventListener(evt, fn) {
      const id = `chip-${evt}-${nextId++}`;
      chipListeners.set(evt, fn);
      return id;
    },
    async removeEventListener() {},
    async remove() {},
  };

  // Real SafeDocument wraps <html> directly: rootDoc.querySelector('html') returns null,
  // while rootDoc.getBoundingClientRect() returns the real host 1920x1080 viewport!
  const rootDoc = {
    async getBoundingClientRect() { return { width: 1920, height: 1080, top: 0, left: 0 }; },
    async querySelector(sel) {
      if (sel === 'body') return { async appendChild() {} };
      return null; // querySelector('html') is null on real SafeDocument!
    },
    async querySelectorAll() { return { async length() { return 0; }, async at() { return null; } }; },
    async createElement() { return chipNode; },
    async addEventListener(type, fn) {
      const id = `${type}-${nextId++}`;
      listeners.set(id, { type, fn });
      return id;
    },
    async removeEventListener(_type, id) { listeners.delete(id); },
  };

  const tracker = new FocusTracker(
    { async getRootDocument() { return rootDoc; } },
    {
      showFloatingChip: true,
      onChipMove: (pos) => { movedPos = pos; },
    }
  );
  assert.equal(await tracker.start(), true);

  // 1. Quick drag BEFORE async getBoundingClientRect resolves must STILL move & save within 1920x1080
  delayedRectResolve = () => {};
  chipListeners.get('pointerdown')({ clientX: 1760, clientY: 980, button: 0 });
  // Paired mousedown immediately after pointerdown must be deduplicated cleanly
  chipListeners.get('mousedown')({ clientX: 1760, clientY: 980, button: 0 });
  for (const entry of listeners.values()) {
    if (entry.type === 'pointermove') entry.fn({ clientX: 1620, clientY: 900 });
  }
  for (const entry of listeners.values()) {
    if (entry.type === 'pointerup') entry.fn({ clientX: 1620, clientY: 900 });
  }
  await new Promise(r => setTimeout(r, 10));
  if (typeof delayedRectResolve === 'function') delayedRectResolve({ left: 1600, top: 890, width: 160, height: 36 });
  delayedRectResolve = null;

  assert.ok(movedPos, 'quick drag must commit even before async rect resolves');
  assert.equal(movedPos.left, 1600);
  assert.equal(movedPos.top, 890);
  assert.match(chipStyle, /left:1600px;top:890px;/);

  // 2. Anchor preset positioning (for moving out from under overlapping plugins)
  await tracker.setChipPosition({ anchor: 'tl' });
  assert.match(chipStyle, /left:14px;top:64px;/);
  await tracker.setChipPosition({ anchor: 'ml' });
  assert.match(chipStyle, /left:14px;top:50%;transform:translateY\(-50%\);/);

  // 3. Mouse-only drag fallback (mousedown -> mousemove -> mouseup)
  movedPos = null;
  chipListeners.get('mousedown')({ type: 'mousedown', clientX: 50, clientY: 540, button: 0 });
  for (const entry of listeners.values()) {
    if (entry.type === 'mousemove') entry.fn({ type: 'mousemove', clientX: 350, clientY: 240, buttons: 1 });
  }
  for (const entry of listeners.values()) {
    if (entry.type === 'mouseup') entry.fn({ type: 'mouseup', clientX: 350, clientY: 240 });
  }
  await new Promise(r => setTimeout(r, 10));
  assert.ok(movedPos, 'mouse fallback drag must commit');
  assert.match(chipStyle, /left:\d+px;top:\d+px;/);

  await tracker.stop();
  assert.equal(listeners.size, 0);
});

test('FocusTracker survives disallowed touch* events like real PocketRisu, removes stale chip, uses <div>, deduplicates tap+click, and cycles on long-press without coords', async () => {
  const disallowed = new Set(['touchstart', 'touchmove', 'touchend', 'touchcancel']);
  const listeners = new Map();
  const chipListeners = new Map();
  let nextId = 1;
  let createdTag = '';
  let staleRemoved = false;
  let chipStyle = '';
  let openedCount = 0;
  let movedPos = null;

  const staleChip = { async remove() { staleRemoved = true; } };
  const chipNode = {
    async setAttribute() {},
    async setStyleAttribute(s) { chipStyle = s; },
    async setTextContent() {},
    async getBoundingClientRect() { return { left: 800, top: 650, width: 160, height: 36 }; },
    async addEventListener(evt, fn) {
      if (disallowed.has(evt)) throw new Error(`Event listener of type '${evt}' is not allowed`);
      const id = `chip-${evt}-${nextId++}`;
      chipListeners.set(evt, fn);
      return id;
    },
    async removeEventListener() {},
    async remove() {},
  };

  const rootDoc = {
    async getBoundingClientRect() { return { width: 1024, height: 768, top: 0, left: 0 }; },
    async querySelector(sel) {
      if (sel === 'body') return { async appendChild() {} };
      if (sel.includes('x-risuhelper-chip')) return staleChip;
      return null;
    },
    async querySelectorAll() { return { async length() { return 0; }, async at() { return null; } }; },
    async createElement(tag) { createdTag = tag; return chipNode; },
    async addEventListener(type, fn) {
      if (disallowed.has(type)) throw new Error(`Event listener of type '${type}' is not allowed`);
      const id = `${type}-${nextId++}`;
      listeners.set(id, { type, fn });
      return id;
    },
    async removeEventListener(_type, id) { listeners.delete(id); },
  };

  const tracker = new FocusTracker(
    { async getRootDocument() { return rootDoc; } },
    {
      showFloatingChip: true,
      onChipClick: () => { openedCount++; },
      onChipMove: (pos) => { movedPos = pos; },
    }
  );

  assert.equal(await tracker.start(), true);
  assert.equal(staleRemoved, true, 'stale chip from prior reload must be removed');
  assert.equal(createdTag, 'div', 'chip must be a <div> so grabbing does not steal editor focus');

  // Short tap (pointerdown -> pointerup -> click) must open drawer ONCE
  chipListeners.get('pointerdown')({ type: 'pointerdown', clientX: 840, clientY: 660, button: 0 });
  for (const entry of listeners.values()) {
    if (entry.type === 'pointerup') entry.fn({ type: 'pointerup', clientX: 840, clientY: 660 });
  }
  chipListeners.get('click')();
  assert.equal(openedCount, 1);

  // Release outside window (mousemove with buttons === 0) ends drag cleanly
  movedPos = null;
  chipListeners.get('pointerdown')({ type: 'pointerdown', clientX: 840, clientY: 660, button: 0 });
  for (const entry of listeners.values()) {
    if (entry.type === 'pointermove') entry.fn({ type: 'pointermove', clientX: 500, clientY: 300, buttons: 1 });
  }
  for (const entry of listeners.values()) {
    if (entry.type === 'mousemove') entry.fn({ type: 'mousemove', clientX: 500, clientY: 300, buttons: 0 });
  }
  await new Promise(r => setTimeout(r, 10));
  assert.ok(movedPos, 'buttons===0 must finalize drag');
  assert.equal(movedPos.left, 460);
  assert.equal(movedPos.top, 290);

  // Long-press fallback when host strips coordinates ({ type: 'pointerdown' } with no clientX/Y)
  movedPos = null;
  chipListeners.get('pointerdown')({ type: 'pointerdown' });
  await new Promise(r => setTimeout(r, 650));
  assert.ok(movedPos && movedPos.anchor, 'long-press without coords must cycle to next edge anchor');
  assert.match(chipStyle, /right:14px;top:50%;transform:translateY\(-50%\);|left:14px;top:64px;|right:14px;top:64px;/);

  await tracker.stop();
});

test('FocusTracker PC right-dock self-verifies own iframe among multiple plugin iframes, pushes/restores <main>, guards mobile, and cleans up on stop', async () => {
  const otherStyles = { display: 'block', width: '100%' };
  const myStyles = { display: 'none', width: '100%' };
  const mainStyles = { width: '', maxWidth: '', boxSizing: '' };
  const myAttrs = {};
  let viewportW = 1440;
  let chipMounted = false;
  let chipRemovedCount = 0;

  const localWin = { innerWidth: 1440 };

  const otherIframe = {
    async getStyle(k) { return otherStyles[k] || ''; },
    async setStyle(k, v) { otherStyles[k] = v; },
    async setAttribute() {},
  };
  const myIframe = {
    async getStyle(k) { return myStyles[k] || ''; },
    async setStyle(k, v) {
      myStyles[k] = v;
      if (k === 'width') {
        const px = parseInt(v, 10);
        localWin.innerWidth = Number.isFinite(px) && String(v).endsWith('px') ? px : viewportW;
      }
    },
    async setAttribute(k, v) { myAttrs[k] = v; },
  };
  const mainEl = {
    async getStyle(k) { return mainStyles[k] || ''; },
    async setStyle(k, v) { mainStyles[k] = v; },
  };
  const chipEl = {
    async setAttribute() {},
    async setStyleAttribute() {},
    async setTextContent() {},
    async getBoundingClientRect() { return { left: 1200, top: 700, width: 140, height: 36 }; },
    async addEventListener() { return 'id'; },
    async removeEventListener() {},
    async remove() { chipMounted = false; chipRemovedCount++; },
  };

  const rootDoc = {
    async getBoundingClientRect() { return { width: viewportW, height: 900, top: 0, left: 0 }; },
    async querySelector(sel) {
      if (sel === 'body') return { async appendChild() { chipMounted = true; } };
      if (sel === 'main') return mainEl;
      if (sel.includes('x-risuhelper-frame') && myAttrs['x-risuhelper-frame'] === '1') return myIframe;
      return null;
    },
    async querySelectorAll(sel) {
      if (sel === 'iframe') {
        const list = [otherIframe, myIframe];
        return { async length() { return list.length; }, async at(i) { return list[i]; } };
      }
      return { async length() { return 0; }, async at() { return null; } };
    },
    async createElement() { return chipEl; },
    async addEventListener() { return 'l1'; },
    async removeEventListener() {},
  };

  const tracker = new FocusTracker({ async getRootDocument() { return rootDoc; } }, { showFloatingChip: true });
  assert.equal(await tracker.start(), true);
  assert.equal(chipMounted, true);

  // Mobile viewport must refuse docking cleanly
  viewportW = 390;
  const mobileRes = await tracker.applyDock({ width: 420, pushLayout: true, localWin });
  assert.equal(mobileRes.ok, false);
  assert.match(mobileRes.reason, /화면 너비/);

  // PC viewport: simulate showContainer making myIframe visible
  viewportW = 1440;
  localWin.innerWidth = 1440;
  const beforeVisible = await tracker.snapshotVisibleIframes();
  assert.equal(beforeVisible.has(0), true);
  assert.equal(beforeVisible.has(1), false);
  myStyles.display = 'block';

  const dockRes = await tracker.applyDock({
    width: 420,
    pushLayout: true,
    beforeVisibleIndices: beforeVisible,
    localWin,
  });
  assert.equal(dockRes.ok, true);
  assert.equal(dockRes.width, 420);
  assert.equal(myAttrs['x-risuhelper-frame'], '1');
  assert.equal(otherStyles.width, '100%', 'other plugin iframe must remain untouched');
  assert.equal(myStyles.right, '0px');
  assert.equal(myStyles.left, 'auto');
  assert.equal(myStyles.width, '420px');
  assert.equal(mainStyles.width, 'calc(100% - 420px)');
  assert.equal(chipMounted, false, 'floating chip hides while docked');
  assert.equal(tracker.liveScreenFallback, true);

  // Changing width to 500px updates both iframe & <main> while keeping original saved <main> style intact
  const widerRes = await tracker.applyDock({ width: 500, pushLayout: true, localWin });
  assert.equal(widerRes.ok, true);
  assert.equal(myStyles.width, '500px');
  assert.equal(mainStyles.width, 'calc(100% - 500px)');

  // Releasing dock restores <main> to '' and iframe to 100%, and re-mounts floating chip
  await tracker.releaseDock({ restoreChip: true });
  assert.equal(mainStyles.width, '');
  assert.equal(myStyles.width, '100%');
  assert.equal(myStyles.left, '0');
  assert.equal(chipMounted, true);
  assert.ok(chipRemovedCount >= 1);

  // Re-dock then unload via stop(): <main> MUST be restored automatically
  await tracker.applyDock({ width: 420, pushLayout: true, localWin });
  assert.equal(mainStyles.width, 'calc(100% - 420px)');
  await tracker.stop();
  assert.equal(mainStyles.width, '');
});

test('PocketRisu DisplaySettings detects 채팅 HTML (guiHTML) and 커스텀 CSS (customCSS) via data-setting-id and flex-col label wrappers', async () => {
  const guiHtmlTa = makePocketRisuTextArea({ contentEditable: false });
  const customCssTa = makePocketRisuTextArea({ contentEditable: false });
  const upstreamChatHtmlTa = makePocketRisuTextArea({ contentEditable: false });

  createInteractiveSafeNode({
    tag: 'div',
    outerHtml: '<div class="py-3 border-t border-darkborderc" data-setting-id="display.guiHTML"></div>',
    children: [
      createInteractiveSafeNode({
        tag: 'div',
        className: 'flex flex-col',
        children: [
          createInteractiveSafeNode({ tag: 'span', className: 'text-sm text-textcolor', text: '채팅 HTML' }),
          createInteractiveSafeNode({ tag: 'p', className: 'text-xs text-textcolor2', text: '도움말' }),
        ],
      }),
      guiHtmlTa.outerWrap,
    ],
  });

  createInteractiveSafeNode({
    tag: 'div',
    outerHtml: '<div class="py-3 border-t border-darkborderc" data-setting-id="display.customCSS"></div>',
    children: [
      createInteractiveSafeNode({
        tag: 'div',
        className: 'flex flex-col',
        children: [
          createInteractiveSafeNode({ tag: 'span', className: 'text-sm text-textcolor', text: '커스텀 CSS' }),
        ],
      }),
      customCssTa.outerWrap,
    ],
  });

  // Upstream RisuAI stacked layout without data-setting-id (label-only)
  createInteractiveSafeNode({
    tag: 'div',
    className: 'flex flex-col',
    children: [
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '채팅 HTML' }),
      upstreamChatHtmlTa.outerWrap,
    ],
  });

  guiHtmlTa.editor._focused = true;
  const guiCtx = await inspectFocusedElement(makeMockRootDoc(guiHtmlTa.editor));
  assert.equal(guiCtx.targetKind, 'config');
  assert.equal(guiCtx.fieldKey, 'guiHTML');
  assert.equal(guiCtx.screen, 'settings');

  guiHtmlTa.editor._focused = false;
  customCssTa.editor._focused = true;
  const cssCtx = await inspectFocusedElement(makeMockRootDoc(customCssTa.editor));
  assert.equal(cssCtx.targetKind, 'config');
  assert.equal(cssCtx.fieldKey, 'customCSS');

  customCssTa.editor._focused = false;
  upstreamChatHtmlTa.editor._focused = true;
  const upCtx = await inspectFocusedElement(makeMockRootDoc(upstreamChatHtmlTa.editor));
  assert.equal(upCtx.targetKind, 'config');
  assert.equal(upCtx.fieldKey, 'guiHTML');
});

test('CharConfig Advanced tab detects additionalText, defaultVariables, customModuleToggle, translatorNote, nickname, depthPrompt, and alternateGreetings row indices', async () => {
  const addDescTa = makePocketRisuTextArea({ contentEditable: true });
  const defVarsTa = makePocketRisuTextArea({ contentEditable: false });
  const toggleTa = makePocketRisuTextArea({ contentEditable: false });
  const transTa = makePocketRisuTextArea({ contentEditable: false });
  const nickInput = createInteractiveSafeNode({ tag: 'input', outerHtml: '<input type="text">' });
  const depthNum = createInteractiveSafeNode({ tag: 'input', outerHtml: '<input type="number">' });
  const depthPromptInput = createInteractiveSafeNode({ tag: 'input', outerHtml: '<input type="text">' });
  const altGreet0 = makePocketRisuTextArea({ contentEditable: true });
  const altGreet1 = makePocketRisuTextArea({ contentEditable: true });

  const allEditors = [
    addDescTa.editor, defVarsTa.editor, toggleTa.editor, transTa.editor,
    nickInput, depthNum, depthPromptInput, altGreet0.editor, altGreet1.editor,
  ];
  const focusOnly = (target) => {
    for (const e of allEditors) e._focused = (e === target);
  };

  const altTable = createInteractiveSafeNode({
    tag: 'div',
    className: 'w-full max-w-full border border-selected rounded-md p-2',
    children: [
      createInteractiveSafeNode({
        tag: 'table',
        children: [
          createInteractiveSafeNode({
            tag: 'tbody',
            children: [
              createInteractiveSafeNode({ tag: 'tr', children: [createInteractiveSafeNode({ tag: 'th', text: '값' })] }),
              createInteractiveSafeNode({ tag: 'tr', children: [createInteractiveSafeNode({ tag: 'td', children: [altGreet0.outerWrap] })] }),
              createInteractiveSafeNode({ tag: 'tr', children: [createInteractiveSafeNode({ tag: 'td', children: [altGreet1.outerWrap] })] }),
            ],
          }),
        ],
      }),
    ],
  });

  createInteractiveSafeNode({
    tag: 'div',
    className: 'char-advanced',
    children: [
      createInteractiveSafeNode({ tag: 'h2', text: '고급 설정' }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '추가 디스크립션' }),
      addDescTa.outerWrap,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '기본 변수' }),
      defVarsTa.outerWrap,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '커스텀 토글' }),
      toggleTa.outerWrap,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '번역가의 노트' }),
      transTa.outerWrap,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '닉네임' }),
      nickInput,
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '깊이 프롬프트' }),
      createInteractiveSafeNode({ tag: 'div', className: 'flex justify-center items-center', children: [depthNum, depthPromptInput] }),
      createInteractiveSafeNode({ tag: 'span', className: 'text-textcolor', text: '추가 첫 메시지' }),
      altTable,
    ],
  });

  focusOnly(addDescTa.editor);
  assert.equal((await inspectFocusedElement(makeMockRootDoc(addDescTa.editor))).fieldKey, 'additionalText');

  focusOnly(defVarsTa.editor);
  assert.equal((await inspectFocusedElement(makeMockRootDoc(defVarsTa.editor))).fieldKey, 'defaultVariables');

  focusOnly(toggleTa.editor);
  assert.equal((await inspectFocusedElement(makeMockRootDoc(toggleTa.editor))).fieldKey, 'customModuleToggle');

  focusOnly(transTa.editor);
  assert.equal((await inspectFocusedElement(makeMockRootDoc(transTa.editor))).fieldKey, 'translatorNote');

  focusOnly(nickInput);
  assert.equal((await inspectFocusedElement(makeMockRootDoc(nickInput))).fieldKey, 'nickname');

  focusOnly(depthPromptInput);
  const depthCtx = await inspectFocusedElement(makeMockRootDoc(depthPromptInput));
  assert.equal(depthCtx.targetKind, 'char_field');
  assert.equal(depthCtx.fieldKey, 'depthPrompt');

  // Number input for depth must NOT be misclassified as depthPrompt string editor
  focusOnly(depthNum);
  assert.notEqual((await inspectFocusedElement(makeMockRootDoc(depthNum))).fieldKey, 'depthPrompt');

  focusOnly(altGreet0.editor);
  const g0 = await inspectFocusedElement(makeMockRootDoc(altGreet0.editor));
  assert.equal(g0.targetKind, 'char_alt_greeting');
  assert.equal(g0.greetingIndex, 0);

  focusOnly(altGreet1.editor);
  const g1 = await inspectFocusedElement(makeMockRootDoc(altGreet1.editor));
  assert.equal(g1.targetKind, 'char_alt_greeting');
  assert.equal(g1.greetingIndex, 1);
});

test('ModuleMenu fields resolve to module_field and Chat.svelte bubble editors resolve to chat_message with exact data-chat-index', async () => {
  const modBgTa = makePocketRisuTextArea({ contentEditable: false });
  const modToggleTa = makePocketRisuTextArea({ contentEditable: false });
  const modNameInput = createInteractiveSafeNode({ tag: 'input', outerHtml: '<input type="text">' });

  createInteractiveSafeNode({
    tag: 'div',
    children: [
      createInteractiveSafeNode({ tag: 'h2', text: '모듈 수정' }),
      createInteractiveSafeNode({
        tag: 'div',
        outerHtml: '<div class="flex justify-between py-3 border-t border-darkborderc" data-setting-id="module.name"></div>',
        children: [
          createInteractiveSafeNode({
            tag: 'div',
            className: 'flex flex-col min-w-0',
            children: [createInteractiveSafeNode({ tag: 'span', className: 'text-sm text-textcolor', text: '이름' })],
          }),
          createInteractiveSafeNode({ tag: 'div', className: 'shrink-0', children: [modNameInput] }),
        ],
      }),
      createInteractiveSafeNode({
        tag: 'div',
        className: 'py-3 border-t border-darkborderc',
        children: [
          createInteractiveSafeNode({ tag: 'span', className: 'text-sm text-textcolor', text: '커스텀 토글' }),
          modToggleTa.outerWrap,
        ],
      }),
      createInteractiveSafeNode({
        tag: 'div',
        className: 'flex flex-col',
        children: [
          createInteractiveSafeNode({ tag: 'span', className: 'text-sm text-textcolor', text: '백그라운드 임베딩' }),
          modBgTa.outerWrap,
        ],
      }),
    ],
  });

  modBgTa.editor._focused = true;
  const bgCtx = await inspectFocusedElement(makeMockRootDoc(modBgTa.editor));
  assert.equal(bgCtx.targetKind, 'module_field');
  assert.equal(bgCtx.fieldKey, 'backgroundEmbedding');

  modBgTa.editor._focused = false;
  modToggleTa.editor._focused = true;
  const togCtx = await inspectFocusedElement(makeMockRootDoc(modToggleTa.editor));
  assert.equal(togCtx.targetKind, 'module_field');
  assert.equal(togCtx.fieldKey, 'customModuleToggle');

  modToggleTa.editor._focused = false;
  modNameInput._focused = true;
  const nameCtx = await inspectFocusedElement(makeMockRootDoc(modNameInput));
  assert.equal(nameCtx.targetKind, 'module_field');
  assert.equal(nameCtx.fieldKey, 'name');

  // Chat.svelte standard bubble edit inside .risu-chat[data-chat-index="2"]
  const bubbleEditTa = createInteractiveSafeNode({ tag: 'textarea', outerHtml: '<textarea></textarea>' });
  createInteractiveSafeNode({
    tag: 'div',
    outerHtml: '<div class="flex max-w-full justify-center risu-chat" data-chat-index="2"></div>',
    children: [
      createInteractiveSafeNode({
        tag: 'div',
        children: [
          createInteractiveSafeNode({
            tag: 'div',
            children: [bubbleEditTa],
          }),
        ],
      }),
    ],
  });
  bubbleEditTa._focused = true;
  const msgCtx = await inspectFocusedElement(makeMockRootDoc(bubbleEditTa));
  assert.equal(msgCtx.targetKind, 'chat_message');
  assert.equal(msgCtx.messageIndex, 2);
  assert.equal(msgCtx.labelText, '채팅 메시지 #3 수정');
});





