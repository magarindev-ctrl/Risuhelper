import test from 'node:test';
import assert from 'node:assert/strict';
import { planGreetingContext, wantsGreetingText, GREETING_PREVIEW_CHARS } from '../src/greetings.js';

const longText = (label, n) => `${label}-START ` + 'x'.repeat(n) + ` ${label}-END`;

test('planGreetingContext lists the default greeting as index -1 and marks the one the chat uses', () => {
  const char = { firstMessage: 'hello', alternateGreetings: ['alt zero', 'alt one'] };
  const plan = planGreetingContext(char, { fmIndex: 1 }, { includeFullText: true });
  assert.deepEqual(plan.greetings.map(g => g.index), [-1, 0, 1]);
  assert.equal(plan.activeIndex, 1);
  assert.deepEqual(plan.greetings.map(g => g.active), [false, false, true]);
  assert.deepEqual(plan.shownFull, [-1, 0, 1]);
});

test('without full text only previews are sent and long greetings are not counted as fully shown', () => {
  const char = { firstMessage: longText('FIRST', 2000), alternateGreetings: ['short alt'] };
  const plan = planGreetingContext(char, { fmIndex: -1 }, { includeFullText: false });
  const first = plan.greetings[0];
  assert.equal(first.truncated, true);
  assert.equal(first.text.length, GREETING_PREVIEW_CHARS);
  assert.ok(!first.text.includes('FIRST-END'));
  assert.deepEqual(plan.shownFull, [0], 'a greeting that fits in the preview is fully shown');
});

test('full text is given to the active greeting first when the budget cannot cover everything', () => {
  const char = { firstMessage: longText('FIRST', 9000), alternateGreetings: [longText('ALT0', 9000), longText('ALT1', 9000)] };
  const plan = planGreetingContext(char, { fmIndex: 1 }, { includeFullText: true, budget: 12000 });
  const byIndex = Object.fromEntries(plan.greetings.map(g => [g.index, g]));
  assert.ok(byIndex[1].text.includes('ALT1-END'), 'the greeting the chat is using must be complete');
  assert.equal(byIndex[1].truncated, false);
  assert.equal(byIndex[-1].truncated, true);
  assert.deepEqual(plan.shownFull, [1]);
});

test('wantsGreetingText is true on the chat screen and when the request talks about first messages', () => {
  assert.equal(wantsGreetingText({ screen: 'chat', targetKind: 'general' }, '아무 말'), true);
  assert.equal(wantsGreetingText({ screen: 'character', targetKind: 'char_field', fieldKey: 'desc' }, '첫 메시지 좀 고쳐줘'), true);
  assert.equal(wantsGreetingText({ screen: 'character', targetKind: 'char_field', fieldKey: 'desc' }, 'add an alternate greeting'), true);
  assert.equal(wantsGreetingText({ screen: 'character', targetKind: 'char_field', fieldKey: 'desc' }, '설명을 다듬어줘'), false);
});
