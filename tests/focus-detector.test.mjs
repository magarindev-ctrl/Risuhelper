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


