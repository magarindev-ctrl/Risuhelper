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

