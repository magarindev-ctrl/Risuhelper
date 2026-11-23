import test from 'node:test';
import assert from 'node:assert/strict';
import { planFieldContext, mentionedFields, FREE_EDIT_FIELDS, FIELD_PREVIEW_CHARS } from '../src/fields.js';

const long = (label, n) => `${label}-START ` + 'x'.repeat(n) + ` ${label}-END`;

test('mentionedFields recognises the field a request talks about, and does not confuse "설명해줘" with the description', () => {
  assert.deepEqual(mentionedFields('캐릭터 설명에 한 줄 추가해줘'), ['desc']);
  assert.deepEqual(mentionedFields('description을 다듬어줘'), ['desc']);
  assert.deepEqual(mentionedFields('이 설정이 뭔지 설명해줘'), []);
  assert.deepEqual(mentionedFields('시스템 프롬프트랑 작가의 노트 고쳐줘').sort(), ['authorNote', 'systemPrompt']);
  assert.deepEqual(mentionedFields('글로벌 노트 덮어쓰기 손봐줘'), ['replaceGlobalNote']);
  assert.deepEqual(mentionedFields('로어북 하나 만들어줘'), []);
});

test('planFieldContext sends previews by default and the whole text only for fields the request mentions', () => {
  const char = { name: 'A', desc: long('DESC', 3000), systemPrompt: long('SYS', 3000), scenario: 'short scenario' };
  const chat = { note: long('NOTE', 3000) };

  const plain = planFieldContext(char, chat, { userInput: '로어북 만들어줘' });
  const byField = Object.fromEntries(plain.fields.map(f => [f.field, f]));
  assert.equal(byField.desc.truncated, true);
  assert.equal(byField.desc.text.length, FIELD_PREVIEW_CHARS);
  assert.equal(byField.scenario.truncated, false, 'a field that fits in the preview is fully shown');
  assert.ok(plain.shownFull.includes('scenario'));
  assert.ok(!plain.shownFull.includes('desc'));
  assert.ok(!plain.fields.some(f => f.field === 'personality'), 'empty fields are not listed');

  const asked = planFieldContext(char, chat, { userInput: '설명을 고쳐줘' });
  const desc = asked.fields.find(f => f.field === 'desc');
  assert.ok(desc.text.includes('DESC-END'));
  assert.ok(asked.shownFull.includes('desc'));
  assert.ok(!asked.shownFull.includes('systemPrompt'));

  const note = planFieldContext(char, chat, { userInput: '작가의 노트 수정해줘' });
  assert.ok(note.fields.find(f => f.field === 'authorNote').text.includes('NOTE-END'));
});

test('a mentioned field that does not fit the budget stays a preview and is not counted as shown', () => {
  const char = { desc: long('DESC', 30000) };
  const plan = planFieldContext(char, {}, { userInput: '설명 고쳐줘', budget: 5000 });
  assert.equal(plan.fields[0].truncated, true);
  assert.deepEqual(plan.shownFull, []);
});

test('the free-edit field list covers character text fields and the author note', () => {
  for (const f of ['desc', 'systemPrompt', 'replaceGlobalNote', 'personality', 'scenario', 'authorNote']) {
    assert.ok(FREE_EDIT_FIELDS.includes(f), f);
  }
});
