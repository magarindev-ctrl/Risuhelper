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

  // Truncation warning appears when content exceeds 24,000 chars
  const longMsgs = buildConversationMessages({
    context: { screen: 'scripts', targetKind: 'char_lua' },
    snapshot: { label: '긴 Lua', content: 'x'.repeat(25000), target: { targetKind: 'char_lua' } },
    userInput: '일부만 수정해 줘',
  });
  assert.match(longMsgs[0].content, /원문 잘림 경고/);
  assert.match(longMsgs[0].content, /replace_text 및 전체 code 덮어쓰기는 차단/);
});

test('parseAssistantReply supports raw delimiter body protocol for Lua, regex, edits, and embedded markdown fences', () => {
  const luaReply = [
    'Lua 트리거를 작성했습니다.',
    '```risuhelper-proposal',
    '{"action":"update_lua","title":"Lua 상태창","scope":"character"}',
    '<<<CODE>>>',
    'function onOutput(id)',
    '  local s = "quotes \\" and \\\\ pattern %[HP:(%d+)%]"',
    '  log(s)',
    'end',
    '<<<END>>>',
    '```',
  ].join('\n');

  const parsedLua = parseAssistantReply(luaReply);
  assert.equal(parsedLua.errors.length, 0);
  assert.equal(parsedLua.proposals.length, 1);
  assert.match(parsedLua.proposals[0].code, /local s = "quotes \\" and \\\\ pattern %\[HP:\(%d\+\)%\]"/);

  const patchReply = [
    '```risuhelper-proposal',
    '{"action":"patch_text","title":"다중 부분 수정"}',
    '<<<BEFORE>>>',
    '  old("line 1")',
    '<<<AFTER>>>',
    '  new("line 1")',
    '<<<BEFORE>>>',
    'old_2 = "\\n"',
    '<<<AFTER>>>',
    'new_2 = "\\t"',
    '<<<END>>>',
    '```',
  ].join('\n');

  const parsedPatch = parseAssistantReply(patchReply);
  assert.equal(parsedPatch.errors.length, 0);
  assert.equal(parsedPatch.proposals[0].edits.length, 2);
  assert.equal(parsedPatch.proposals[0].edits[0].before, '  old("line 1")');
  assert.equal(parsedPatch.proposals[0].edits[1].after, 'new_2 = "\\t"');

  const regexReply = [
    '```risuhelper-proposal',
    '{"action":"upsert_regex","title":"HP 표시","scope":"character","comment":"HP","type":"editdisplay","flag":"g","ableFlag":true}',
    '<<<IN>>>',
    '\\[HP:(\\d+)/(\\d+)\\]',
    '<<<OUT>>>',
    '<div class="hp">$1 / $2</div>',
    '<<<END>>>',
    '```',
  ].join('\n');

  const parsedRegex = parseAssistantReply(regexReply);
  assert.equal(parsedRegex.errors.length, 0);
  assert.equal(parsedRegex.proposals[0].in, '\\[HP:(\\d+)/(\\d+)\\]');
  assert.equal(parsedRegex.proposals[0].out, '<div class="hp">$1 / $2</div>');

  // Embedded ``` markdown code block inside <<<CONTENT>>> terminated by <<<END>>>
  const mdReply = [
    '안내 문구',
    '```risuhelper-proposal',
    '{"action":"replace_text","title":"마크다운 포함 본문"}',
    '<<<CONTENT>>>',
    '설명 시작',
    '```html',
    '<div class="box">OK</div>',
    '```',
    '설명 끝',
    '<<<END>>>',
    '```',
  ].join('\n');

  const parsedMd = parseAssistantReply(mdReply);
  assert.equal(parsedMd.errors.length, 0);
  assert.equal(parsedMd.proposals[0].content, '설명 시작\n```html\n<div class="box">OK</div>\n```\n설명 끝');
  assert.equal(parsedMd.prose, '안내 문구');

  // Validation rejects prompt-injected fieldKey in target
  assert.match(
    validateProposal({ action: 'replace_text', target: { targetKind: 'char_field', fieldKey: 'chats' }, content: 'x' }),
    /허용되지 않는 캐릭터 필드/
  );
});

