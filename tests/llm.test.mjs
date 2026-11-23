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
    maxContentChars: 24000,
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

test('validateProposal and buildConversationMessages support organize_lorebook and folder-aware lore summaries', () => {
  assert.equal(
    validateProposal({ action: 'organize_lorebook', scope: 'character', folderName: '세계관', loreIndices: [0, 1, 2] }),
    null
  );
  assert.equal(
    validateProposal({ action: 'organize_lorebook', scope: 'module', folderIndex: 4, loreIndices: [0] }),
    null
  );
  assert.equal(
    validateProposal({ action: 'organize_lorebook', scope: 'character', moveToRoot: true, loreIndices: [1, 2] }),
    null
  );
  assert.match(
    validateProposal({ action: 'organize_lorebook', scope: 'character', folderName: '세계관', loreIndices: [] }),
    /loreIndices/
  );
  assert.match(
    validateProposal({ action: 'organize_lorebook', scope: 'character', loreIndices: [0] }),
    /folderName/
  );
  assert.equal(
    validateProposal({ action: 'create_lorebook', mode: 'folder', comment: '배경' }),
    null
  );

  const msgs = buildConversationMessages({
    context: { screen: 'lorebook', targetKind: 'char_lorebook', labelText: '캐릭터 로어북' },
    snapshot: { label: '캐릭터 로어북 (40개)', content: '', target: { targetKind: 'char_lorebook' } },
    extraContext: {
      foldersSummary: [{ index: 39, name: '미리 만든 폴더', childCount: 0 }],
      loreSummary: [{ index: 0, comment: '항목 1', key: 'k1', mode: 'normal' }],
    },
    userInput: '미리 만든 폴더에 항목 1 담아줘',
  });
  assert.match(msgs[0].content, /캐릭터 로어북 폴더 목록/);
  assert.match(msgs[0].content, /미리 만든 폴더/);
  assert.match(msgs[0].content, /organize_lorebook/);
});


test('buildConversationMessages passes the whole original when it fits the configured limit and truncates only beyond it', () => {
  const content = 'A'.repeat(29990) + 'TAIL-MARKER';
  const base = { context: { screen: 'character' }, snapshot: { label: '긴 설명', content, target: { targetKind: 'char_field', fieldKey: 'desc' } }, history: [], userInput: 'q' };

  const full = buildConversationMessages({ ...base, maxContentChars: 60000 });
  assert.ok(full[0].content.includes('TAIL-MARKER'));
  assert.ok(!full[0].content.includes('원문 잘림 경고'));

  const cut = buildConversationMessages({ ...base, maxContentChars: 10000 });
  assert.ok(!cut[0].content.includes('TAIL-MARKER'));
  assert.ok(cut[0].content.includes('원문 잘림 경고'));
  assert.ok(cut[0].content.includes('10,000'));
});

test('findUnknownProposalKeys lists properties outside an action schema and accepts every documented one', async () => {
  const { findUnknownProposalKeys } = await import('../src/llm.js');
  assert.deepEqual(
    findUnknownProposalKeys({ action: 'create_lorebook', title: 't', scope: 'character', comment: 'c', key: 'k', content: 'b', folderColor: 'red', pinned: true }).sort(),
    ['folderColor', 'pinned']
  );
  const documented = [
    { action: 'patch_text', title: 't', edits: [{ before: 'a', after: 'b' }] },
    { action: 'replace_text', title: 't', content: 'x' },
    { action: 'create_lorebook', scope: 'chat', comment: 'c', key: 'k', secondkey: '', selective: false, alwaysActive: false, insertorder: 100, content: 'b', mode: 'normal', folderName: 'f' },
    { action: 'update_lorebook', scope: 'module', moduleIndex: 0, loreIndex: 0, comment: 'c', key: 'k', edits: [], fieldKey: 'content', folderIndex: 3 },
    { action: 'organize_lorebook', scope: 'character', folderName: 'f', createFolderIfMissing: true, loreIndices: [0], moveToRoot: false },
    { action: 'update_lua', scope: 'character', edits: [], code: 'x' },
    { action: 'upsert_regex', scope: 'character', regexIndex: 0, comment: 'n', in: 'a', out: 'b', type: 'editdisplay', flag: 'g', ableFlag: true },
    { action: 'create_persona', name: 'n', note: 'm', personaPrompt: 'p', bindToCurrentChat: true },
    { action: 'update_persona', personaIndex: 0, name: 'n', note: 'm', personaPrompt: 'p', bindToCurrentChat: false },
    { action: 'update_config', changes: { temperature: 80 } },
  ];
  for (const p of documented) assert.deepEqual(findUnknownProposalKeys(p), [], p.action);
});

test('greeting actions are part of the protocol: validated, parsed from raw sections, and described to the model', async () => {
  const { findUnknownProposalKeys } = await import('../src/llm.js');
  assert.equal(validateProposal({ action: 'update_greeting', greetingIndex: -1, content: 'x' }), null);
  assert.equal(validateProposal({ action: 'update_greeting', greetingIndex: 0, edits: [{ before: 'a', after: 'b' }] }), null);
  assert.ok(validateProposal({ action: 'update_greeting', content: 'x' }), 'greetingIndex is required');
  assert.ok(validateProposal({ action: 'update_greeting', greetingIndex: -2, content: 'x' }));
  assert.ok(validateProposal({ action: 'update_greeting', greetingIndex: 0 }), 'needs edits or content');
  assert.equal(validateProposal({ action: 'create_greeting', content: '새 인사' }), null);
  assert.ok(validateProposal({ action: 'create_greeting', content: '' }));
  assert.deepEqual(findUnknownProposalKeys({ action: 'update_greeting', title: 't', greetingIndex: -1, content: 'x' }), []);
  assert.deepEqual(findUnknownProposalKeys({ action: 'create_greeting', title: 't', content: 'x', mood: 'happy' }), ['mood']);

  const parsed = parseAssistantReply([
    '첫 메시지를 고칩니다.',
    '```risuhelper-proposal',
    '{"action":"update_greeting","title":"첫 메시지 수정","greetingIndex":-1}',
    '<<<CONTENT>>>',
    '"따옴표"가 있는 새 첫 메시지',
    '<<<END>>>',
    '```',
  ].join('\n'));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.proposals[0].content, '"따옴표"가 있는 새 첫 메시지');

  const msgs = buildConversationMessages({
    context: { screen: 'chat', targetKind: 'general' },
    snapshot: { label: '채팅 입력 화면', content: '', target: { targetKind: 'general' } },
    extraContext: { greetings: { activeIndex: -1, greetings: [{ index: -1, active: true, length: 21, text: 'FULL-FIRST-MESSAGE-TEXT', truncated: false }] } },
    history: [],
    userInput: '첫 메시지 고쳐줘',
  });
  const sys = msgs[0].content;
  assert.ok(sys.includes('FULL-FIRST-MESSAGE-TEXT'));
  assert.ok(sys.includes('update_greeting'));
  assert.ok(sys.includes('create_greeting'));
});

test('create_greeting may ask to use the new greeting in the current chat, and the prompt separates the current screen from earlier turns', async () => {
  const { findUnknownProposalKeys } = await import('../src/llm.js');
  assert.equal(validateProposal({ action: 'create_greeting', content: 'x', useInCurrentChat: true }), null);
  assert.deepEqual(findUnknownProposalKeys({ action: 'create_greeting', content: 'x', useInCurrentChat: true }), []);
  const sys = buildConversationMessages({
    context: { screen: 'chat', targetKind: 'general' },
    snapshot: { label: '채팅 입력 화면', content: '', target: { targetKind: 'general' } },
    history: [{ role: 'assistant', content: '추가 첫 메시지 필드에 포커스가 있습니다' }],
    userInput: '하나 더 만들어줘',
  })[0].content;
  assert.ok(sys.includes('useInCurrentChat'));
  assert.match(sys, /이전 대화[^\n]*현재/);
});

test('update_field is validated, and free talk tells the model what it can do on any screen', async () => {
  const { findUnknownProposalKeys } = await import('../src/llm.js');
  assert.equal(validateProposal({ action: 'update_field', field: 'desc', edits: [{ before: 'a', after: 'b' }] }), null);
  assert.equal(validateProposal({ action: 'update_field', field: 'authorNote', content: 'x' }), null);
  assert.ok(validateProposal({ action: 'update_field', field: 'chats', content: 'x' }), 'unknown field');
  assert.ok(validateProposal({ action: 'update_field', field: 'desc' }), 'needs edits or content');
  assert.deepEqual(findUnknownProposalKeys({ action: 'update_field', title: 't', field: 'desc', content: 'x' }), []);

  for (const context of [
    { screen: 'unknown', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '' },
    { screen: 'lorebook', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '채팅 로어북 목록', loreScope: 'chat' },
  ]) {
    const sys = buildConversationMessages({
      context,
      snapshot: { label: '자유대화', content: '', target: { targetKind: 'general' } },
      extraContext: { fields: [{ field: 'desc', label: '캐릭터 설명', length: 30, text: 'FULL-DESCRIPTION-TEXT', truncated: false }] },
      history: [],
      userInput: '설명 고쳐줘',
    })[0].content;
    assert.ok(sys.includes('자유대화'));
    assert.ok(sys.includes('update_field'));
    assert.ok(sys.includes('FULL-DESCRIPTION-TEXT'));
    if (context.screenHint) {
      assert.ok(sys.includes('채팅 로어북 목록'), 'the screen guess is passed on as a hint');
      assert.match(sys, /힌트|참고/);
    }
  }
});

test('openModule free-talk hint includes Lua code and regex details when those tabs are open', () => {
  const sysLua = buildConversationMessages({
    context: { screen: 'module', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '모듈 Lua 트리거 스크립트' },
    snapshot: { label: '자유대화', content: '', target: { targetKind: 'general' } },
    extraContext: { openModule: { moduleIndex: 2, name: 'HUD', luaCode: 'function onOutput(id) return 1 end' } },
    history: [],
    userInput: 'Lua 점검해줘',
  })[0].content;
  assert.ok(sysLua.includes('moduleIndex: 2'));
  assert.ok(sysLua.includes('function onOutput(id) return 1 end'));

  const sysRegex = buildConversationMessages({
    context: { screen: 'module', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '모듈 정규식 스크립트 #1' },
    snapshot: { label: '자유대화', content: '', target: { targetKind: 'general' } },
    extraContext: {
      openModule: {
        moduleIndex: 2,
        name: 'HUD',
        regexList: [{ index: 0, comment: 'BG', type: 'editdisplay', in: '<bg>' }],
        expandedRegexIndex: 0,
        expandedRegex: { comment: 'BG', in: '<bg>', out: '<div>bg</div>', type: 'editdisplay' },
      },
    },
    history: [],
    userInput: '정규식 봐줘',
  })[0].content;
  assert.ok(sysRegex.includes('regexIndex 0'));
  assert.ok(sysRegex.includes('<div>bg</div>'));
});

