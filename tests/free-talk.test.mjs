// "자유대화": a field is the target only while the cursor is actually in an editable input.
// Everything else is free talk; what the screen looks like is passed on as a hint, never a target.

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomSignals, inspectFocusedElement, isWritableTarget, FocusTracker } from '../src/focus-detector.js';
import { listFixtures, loadFixture, buildFixtureDocument } from './helpers/fixture-dom.mjs';

const tick = (ms) => new Promise(r => setTimeout(r, ms));

test('a focused editable field or chat input is a target; search boxes and unlabeled inputs are free talk', () => {
  const desc = classifyDomSignals({ tag: 'textarea', nearbyLabel: '설명' });
  assert.equal(desc.targetKind, 'char_field');
  assert.equal(desc.freeTalk, undefined);
  assert.equal(isWritableTarget(desc), true);

  const chat = classifyDomSignals({ tag: 'textarea', isChatInput: true });
  assert.equal(chat.freeTalk, undefined);
  assert.equal(chat.targetKind, 'chat_input');
  assert.equal(chat.fieldKey, 'input');
  assert.equal(chat.labelText, '채팅 입력창 (유저 대필)');
  assert.equal(chat.screen, 'chat');
  assert.equal(isWritableTarget(chat), true);

  const search = classifyDomSignals({ tag: 'input', inputType: 'text', placeholder: '검색', headings: ['모듈'] });
  assert.equal(search.freeTalk, true);
  assert.equal(search.labelText, '자유대화');

  const unknown = classifyDomSignals({ tag: 'input', inputType: 'text', nearbyLabel: '알 수 없는 칸' });
  assert.equal(unknown.freeTalk, true);
  assert.equal(unknown.targetKind, 'general');
});

test('what is on screen without a focused input is only a hint: never a writable target', () => {
  const loreList = classifyDomSignals({ headings: ['로어북'], activeTabs: ['챗'] });
  assert.equal(loreList.freeTalk, true);
  assert.equal(loreList.targetKind, 'general');
  assert.equal(loreList.loreScope, 'chat', 'which lorebook tab is open is kept as a hint');
  assert.match(loreList.screenHint, /로어북/);

  const moduleTab = classifyDomSignals({
    headings: ['모듈 수정'],
    activeTabs: ['로어북'],
    moduleDomHints: { tab: 'lorebook', openIdx: 2, items: [{ idx: 2, title: 'X' }] },
  });
  assert.equal(moduleTab.freeTalk, true, 'an expanded module entry without a cursor in it is not a target');
  assert.equal(isWritableTarget(moduleTab), false);
  assert.ok(moduleTab.moduleDomHints, 'module hints are kept so module-scoped proposals find the open module');
  assert.ok(moduleTab.warnings.some(w => w.includes('tempModule')), 'the module editor warning is kept');

  const settings = classifyDomSignals({ headings: ['고급 설정'] });
  assert.equal(settings.freeTalk, true);
  assert.equal(settings.screen, 'settings');
});

function fixtureDoc(name, pick) {
  const fixture = loadFixture(listFixtures().find(f => f.includes(name)));
  const c = fixture.cases.find(pick);
  return { root: buildFixtureDocument(fixture, c.path), fixture, focusedPath: c.path };
}

function trackerOn(root, graceMs = 40) {
  const changes = [];
  const tracker = new FocusTracker({}, { onChange: ctx => changes.push(ctx), showFloatingChip: false });
  tracker.rootDoc = root;
  tracker.enabled = true;
  tracker.freeTalkGraceMs = graceMs;
  return { tracker, changes };
}

test('losing focus keeps the field briefly, then falls back to free talk if the panel was not opened', async () => {
  const { root } = fixtureDoc('upstream-ko-char-basic', c => c.expect.fieldKey === 'desc');
  const { tracker } = trackerOn(root);
  await tracker.scanNow();
  assert.equal(tracker.lastContext.fieldKey, 'desc');

  const focusedNode = root.doc.focused;
  root.doc.focused = null; // blur: the user clicked something that is not an input
  await tracker.scanNow();
  assert.equal(tracker.lastContext.fieldKey, 'desc', 'the field survives the click that opens the panel');

  await tick(90);
  assert.equal(tracker.lastContext.freeTalk, true, 'a field left behind does not stay selected');
  assert.equal(tracker.lastContext.labelText, '자유대화');

  root.doc.focused = focusedNode;
  await tracker.scanNow();
  assert.equal(tracker.lastContext.fieldKey, 'desc', 'clicking the field again selects it again');
});

test('opening the panel right after the field lost focus keeps that field', async () => {
  const { root } = fixtureDoc('upstream-ko-char-basic', c => c.expect.fieldKey === 'desc');
  const { tracker } = trackerOn(root);
  await tracker.scanNow();
  root.doc.focused = null;
  await tracker.scanNow();
  await tracker.onPanelOpen('overlay');
  await tick(90);
  assert.equal(tracker.lastContext.fieldKey, 'desc');

  await tracker.scanNow();
  assert.equal(tracker.lastContext.fieldKey, 'desc', 'while the overlay covers the host nothing changes the target');
});

test('with the panel docked, clicking away from the field switches to free talk immediately', async () => {
  const { root } = fixtureDoc('upstream-ko-char-basic', c => c.expect.fieldKey === 'desc');
  const { tracker } = trackerOn(root, 5000);
  await tracker.scanNow();
  await tracker.onPanelOpen('docked');
  root.doc.focused = null;
  await tracker.scanNow();
  assert.equal(tracker.lastContext.freeTalk, true);
});

test('moving the cursor into the chat input switches to chat_input at once, without waiting', async () => {
  const basic = fixtureDoc('upstream-ko-char-basic', c => c.expect.fieldKey === 'desc');
  const { tracker } = trackerOn(basic.root, 5000);
  await tracker.scanNow();
  assert.equal(tracker.lastContext.fieldKey, 'desc');

  const chatInput = await basic.root.querySelector('textarea.text-input-area');
  assert.ok(chatInput, 'fixture contains the chat input');
  basic.root.doc.focused = chatInput;
  await tracker.scanNow();
  assert.equal(tracker.lastContext.targetKind, 'chat_input');
  assert.equal(tracker.lastContext.screen, 'chat');
  assert.equal(tracker.lastContext.freeTalk, undefined);
});

test('a real focused field still resolves exactly as before on every recorded host screen', async () => {
  const { root } = fixtureDoc('upstream-ko-char-lorebook', c => c.expect.fieldKey === 'content' && c.expect.loreIndex === 1);
  const ctx = await inspectFocusedElement(root);
  assert.equal(ctx.targetKind, 'char_lorebook');
  assert.equal(ctx.loreIndex, 1);
  assert.equal(ctx.freeTalk, undefined);
});

test('onPanelOpen picks up a newly focused chat input or field immediately instead of keeping a stale field', async () => {
  const basic = fixtureDoc('upstream-ko-char-basic', c => c.expect.fieldKey === 'desc');
  const { tracker } = trackerOn(basic.root, 5000);
  await tracker.scanNow();
  assert.equal(tracker.lastContext.fieldKey, 'desc');

  const chatInput = await basic.root.querySelector('textarea.text-input-area');
  assert.ok(chatInput);
  basic.root.doc.focused = chatInput;
  await tracker.onPanelOpen('overlay');
  assert.equal(tracker.lastContext.targetKind, 'chat_input', 'live focus in chat input must override stale desc');
  assert.equal(tracker.lastContext.screen, 'chat');
});

