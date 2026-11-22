import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readModelResponse,
  callRisuModel,
  parseAssistantReply,
  validateProposal,
  buildConversationMessages,
} from '../src/llm.js';

function streamFrom(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

test('readModelResponse handles string, success/fail wrappers, string stream, Uint8Array stream, and cumulative {0} stream', async () => {
  assert.equal(await readModelResponse('plain'), 'plain');
  assert.equal(await readModelResponse({ type: 'success', result: 'ok' }), 'ok');
  await assert.rejects(() => readModelResponse({ type: 'fail', result: 'rate limit' }), /rate limit/);

  const seen = [];
  const s1 = await readModelResponse(streamFrom(['안', '녕']), { onChunk: c => seen.push(c) });
  assert.equal(s1, '안녕');
  assert.deepEqual(seen, ['안', '안녕']);

  const bytes = new TextEncoder().encode('한글 UTF-8 스트림');
  const s2 = await readModelResponse({ result: streamFrom([bytes.subarray(0, 5), bytes.subarray(5)]) });
  assert.equal(s2, '한글 UTF-8 스트림');

  const s3 = await readModelResponse(streamFrom([{ '0': 'Hel' }, { '0': 'Hello!' }]));
  assert.equal(s3, 'Hello!');
});

test('callRisuModel supports manual cancellation', async () => {
  const job = {};
  const api = {
    runLLMModel() {
      return new ReadableStream({
        start() {}, // stays open until cancelled
      });
    },
  };
  const promise = callRisuModel(api, [{ role: 'user', content: 'hi' }], { timeoutSeconds: 30 }, job);
  setTimeout(() => job.stop('사용자 중단'), 15);
  await assert.rejects(() => promise, /사용자 중단/);
});

test('parseAssistantReply extracts prose, valid proposals, and preserves triple backticks inside JSON strings', () => {
  const reply = [
    '설명에 HTML 코드 블록을 추가했습니다.',
    '```risuhelper-proposal',
    JSON.stringify({
      action: 'replace_text',
      title: '백그라운드 임베딩 업데이트',
      content: '```html\n<div class="card">Status</div>\n```',
    }),
    '```',
    '적용 버튼을 눌러 반영하세요.',
  ].join('\n');

  const parsed = parseAssistantReply(reply);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.proposals.length, 1);
  assert.equal(parsed.proposals[0].content, '```html\n<div class="card">Status</div>\n```');
  assert.match(parsed.prose, /설명에 HTML 코드 블록을 추가했습니다/);
  assert.match(parsed.prose, /적용 버튼을 눌러 반영하세요/);

  const inline = parseAssistantReply('안내\n```risuhelper-proposal {"action":"update_config","changes":{"temperature":90}}```');
  assert.equal(inline.errors.length, 0);
  assert.equal(inline.proposals.length, 1);
  assert.equal(inline.proposals[0].changes.temperature, 90);
});

test('validateProposal rejects disallowed config keys and malformed actions', () => {
  assert.match(validateProposal({ action: 'unknown' }), /알 수 없는 action/);
  assert.match(validateProposal({ action: 'patch_text', edits: [] }), /edits 배열/);
  assert.match(validateProposal({ action: 'update_config', changes: { openAIKey: 'x' } }), /허용되지 않는 설정 키/);
  assert.equal(validateProposal({ action: 'create_lorebook', comment: 'A', content: 'B' }), null);
});

test('buildConversationMessages injects targeted knowledge, snapshot, extra context, and clipped history', () => {
  const msgs = buildConversationMessages({
    context: { screen: 'scripts', targetKind: 'char_lua', labelText: '캐릭터 Lua' },
    snapshot: { label: '캐릭터 Lua', content: 'function onStart(id) end', target: { targetKind: 'char_lua', fieldKey: 'code' } },
    extraContext: { charSummary: { name: '세라' } },
    history: [
      { role: 'user', content: '이전 질문' },
      { role: 'assistant', content: '이전 답변' },
    ],
    userInput: '디버깅해 줘',
  });
  assert.equal(msgs.length, 4);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /RisuAI Lua 트리거 스크립트 가이드/);
  assert.match(msgs[0].content, /function onStart\(id\) end/);
  assert.equal(msgs[3].content, '디버깅해 줘');
});
