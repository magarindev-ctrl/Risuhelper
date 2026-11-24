// Comprehensive unit + end-to-end UI tests for RisuHelper v0.5.0 features:
// 1. Deterministic internal skill routing (src/skills.js)
// 2. parseRisuChat safe live preview (runVar: false) on regex & CBS cards
// 3. Direct chat variable editing (update_chat_vars) + Undo
// 4. Safe delete actions (delete_lorebook, delete_regex, delete_persona, delete_greeting) + confirm modal + guards + Undo
// 5. Manual opt-in fetch log attachment (getFetchLogs) + redaction + 1-shot clear
// 6. Full new module creation (create_module) + immediate chat/global activation + single Undo
// 7. New character creation (create_character), advanced tuning (update_char_settings), and cross-character porting (port_from_character)

import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSkills, buildSkillPromptSections } from '../src/skills.js';
import {
  summarizeChatVariables,
  planChatVarsUpdate,
  previewRegexApplication,
  sanitizeFetchLog,
  planCharSettingsUpdate,
  planCharacterPort,
} from '../src/runtime-tools.js';
import { HostAdapter, extractLuaFromTriggers, buildLuaTriggers } from '../src/host-adapter.js';
import { buildConversationMessages, parseAssistantReply, findUnknownProposalKeys } from '../src/llm.js';
import { bootBundle, proposalBlock } from './helpers/boot-bundle.mjs';

function makeFixture() {
  const char0 = {
    type: 'character',
    chaId: 'char-main',
    name: '아리아',
    desc: '별빛 탑의 기록관 {{char}}.',
    firstMessage: '안녕 {{user}}, 오늘도 왔구나.',
    alternateGreetings: ['도서관 버전 첫 인사', '야간 순찰 버전 첫 인사'],
    personality: '차분함',
    scenario: '별빛 탑',
    tags: ['판타지', '기록관'],
    bias: [['갑자기', -15]],
    loreSettings: { tokenBudget: 800, scanDepth: 2, recursiveScanning: false, fullWordMatching: false },
    globalLore: [
      { comment: '세계관 폴더', key: '\uf000folder:world', mode: 'folder', content: '', insertorder: 100 },
      { comment: '별빛 탑', key: '별빛 탑', mode: 'normal', folder: '\uf000folder:world', content: '고대 천문대.', insertorder: 100 },
      { comment: '빈 폴더', key: '\uf000folder:empty', mode: 'folder', content: '', insertorder: 100 },
      { comment: '임시 메모', key: '임시', mode: 'normal', content: '지워도 되는 메모', insertorder: 50 },
    ],
    customscript: [
      { comment: '상태창 HUD', in: '\\[HP:(\\d+)\\]', out: '<div class="hud">HP $1 / {{getvar::max_hp}}</div>', type: 'editdisplay', flag: 'g', ableFlag: true },
      { comment: '임시 정규식', in: 'foo', out: 'bar', type: 'editdisplay', flag: 'g', ableFlag: true },
    ],
    triggerscript: [],
    chats: [
      {
        id: 'chat-1',
        name: 'Chat 1',
        note: '현재 작노',
        fmIndex: 0,
        localLore: [],
        modules: [],
        scriptstate: { $hp: '80', $affection: '35', raw_flag: 'yes' },
        message: [
          { role: 'user', data: '상태 확인해 줘' },
          { role: 'char', data: '아리아가 미소 짓는다. [HP:80]' },
        ],
      },
      {
        id: 'chat-2',
        name: 'Chat 2',
        note: '',
        fmIndex: 1,
        localLore: [],
        modules: [],
        scriptstate: {},
        message: [],
      },
    ],
    chatPage: 0,
  };

  const char1 = {
    type: 'character',
    chaId: 'char-source',
    name: '마법사 카엘',
    desc: '화염 마법사',
    firstMessage: '불꽃이 피어난다.',
    alternateGreetings: [],
    tags: ['화염'],
    bias: [],
    globalLore: [
      { comment: '마법 체계 폴더', key: '\uf000folder:magic', mode: 'folder', content: '', insertorder: 100 },
      { comment: '화염 마법', key: '화염', mode: 'normal', folder: '\uf000folder:magic', content: '마나를 연소한다.', insertorder: 100 },
      { comment: '별빛 탑', key: '별빛 탑', mode: 'normal', content: '고대 천문대.', insertorder: 100 },
    ],
    customscript: [
      { comment: '화염 이펙트', in: '\\*불꽃\\*', out: '<span class="fire">🔥</span>', type: 'editdisplay', flag: 'g', ableFlag: true },
      { comment: '임시 정규식', in: 'foo', out: 'bar', type: 'editdisplay', flag: 'g', ableFlag: true },
    ],
    triggerscript: buildLuaTriggers('function onOutput(id)\n  setState(id, "mana", "100")\nend'),
    chats: [{ id: 'c-src-1', name: 'Chat 1', message: [], note: '', localLore: [] }],
    chatPage: 0,
  };

  const db = {
    characters: [char0, char1],
    characterOrder: [char0.chaId, char1.chaId],
    modules: [],
    enabledModules: [],
    moduleIntergration: '',
    personas: [
      { id: 'p-1', name: '여행자', personaPrompt: '기본 유저', note: '', largePortrait: false },
      { id: 'p-2', name: '테스트 페르소나', personaPrompt: '삭제 대상', note: '임시', largePortrait: false },
    ],
    selectedPersona: 1,
  };

  const state = { character: char0, charIndex: 0, chatIndex: 0, db };
  const parseCalls = [];
  let fetchLogCalls = 0;
  const fetchLogs = [
    {
      url: 'https://api.example.com/v1/chat/completions?api_key=leak-query-secret',
      status: 429,
      body: JSON.stringify({
        model: 'gpt-test',
        max_tokens: 2048,
        authorization: 'Bearer sk-super-secret-token-123456',
        apiKey: 'sk-raw-secret',
        messages: [{ role: 'user', content: 'Authorization: Bearer sk-inline-secret-abcdef1234' }],
      }),
      response: JSON.stringify({
        error: { message: 'rate limit exceeded' },
        usage: { prompt_tokens: 4000, completion_tokens: 0 },
      }),
    },
  ];

  const extraApi = {
    async getCharacter() { return structuredClone(db.characters[state.charIndex]); },
    async setCharacter(c) {
      db.characters[state.charIndex] = structuredClone(c);
      state.character = db.characters[state.charIndex];
    },
    async getChatFromIndex(ci, chi) { return structuredClone(db.characters[ci]?.chats?.[chi] ?? null); },
    async setChatToIndex(ci, chi, chat) {
      db.characters[ci].chats[chi] = structuredClone(chat);
      state.character = db.characters[state.charIndex];
    },
    async getDatabase(keys = 'all') {
      if (keys === 'all') return structuredClone(db);
      const out = {};
      for (const k of keys) if (Object.hasOwn(db, k)) out[k] = structuredClone(db[k]);
      return out;
    },
    async setDatabase(partial) {
      for (const [k, v] of Object.entries(partial)) db[k] = structuredClone(v);
      state.character = db.characters[state.charIndex];
    },
    async parseRisuChat(text, opts) {
      parseCalls.push({ text, opts });
      return String(text)
        .replace(/\{\{char\}\}/g, db.characters[state.charIndex]?.name || '')
        .replace(/\{\{user\}\}/g, '유저')
        .replace(/\{\{getvar::max_hp\}\}/g, '100');
    },
    async getFetchLogs() {
      fetchLogCalls++;
      return structuredClone(fetchLogs);
    },
  };

  return { state, db, extraApi, parseCalls, getFetchLogCalls: () => fetchLogCalls };
}

test('deterministic internal skill routing shrinks focused prompts and activates specialized skills by keyword', () => {
  const focusedSkills = selectSkills({
    context: { screen: 'character', targetKind: 'char_field', fieldKey: 'desc', freeTalk: false },
    snapshot: { target: { targetKind: 'char_field', fieldKey: 'desc' } },
    userInput: '설명 문장만 조금 다듬어 줘',
  });
  assert.ok(focusedSkills.includes('core_text'));
  assert.ok(focusedSkills.includes('char_fields'));
  assert.ok(!focusedSkills.includes('scripts'), 'unrelated scripts pack should not load on desc edit');
  assert.ok(!focusedSkills.includes('module_create'), 'module_create should stay unloaded unless asked');
  assert.ok(!focusedSkills.includes('char_create_port'), 'char_create_port should stay unloaded unless asked');

  const moduleSkills = selectSkills({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    userInput: 'RPG 상태창 모듈 하나 새로 만들어서 지금 채팅에 바로 켜줘',
  });
  assert.ok(moduleSkills.includes('module_create'));
  assert.ok(moduleSkills.includes('scripts'));

  const charSkills = selectSkills({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    userInput: '새 캐릭터 카드 하나 만들어 주고, 로어북 토큰 예산 1600으로 설정해 줘',
  });
  assert.ok(charSkills.includes('char_create_port'));
  assert.ok(charSkills.includes('char_settings'));

  const pack = buildSkillPromptSections({
    context: { screen: 'settings', targetKind: 'config', freeTalk: false },
    userInput: 'temperature 올려줘',
  });
  assert.ok(pack.schemas.some(s => s.includes('update_config')));
  assert.ok(!pack.schemas.some(s => s.includes('create_module')));
});

test('parseRisuChat previews regex & CBS safely with runVar: false, interactive live tester works, and invalid regex fails cleanly', async () => {
  const fix = makeFixture();
  const reply = [
    '정규식과 설명을 제안합니다.',
    proposalBlock({
      action: 'upsert_regex',
      title: 'HP 배지 변환',
      scope: 'character',
      comment: 'HP 배지',
      in: '\\[HP:(\\d+)\\]',
      out: '<span class="hp">체력 $1/{{getvar::max_hp}}</span>',
      type: 'editdisplay',
      flag: 'g',
      ableFlag: true,
    }),
    proposalBlock({
      action: 'update_field',
      title: '인사말 수정',
      field: 'firstMessage',
      edits: [{ before: '안녕 {{user}}', after: '{{char}}가 반긴다, {{user}}' }],
    }),
  ].join('\n');

  const ui = await bootBundle({ state: fix.state, extraApi: fix.extraApi, runLLMModel: async () => reply });
  await ui.send('정규식이랑 첫 메시지 고쳐줘');

  // Every parseRisuChat call MUST pass runVar: false
  assert.ok(fix.parseCalls.length >= 2, 'parseRisuChat must run for both regex CBS output and CBS field preview');
  for (const call of fix.parseCalls) {
    assert.equal(call.opts.runVar, false, 'parseRisuChat must ALWAYS enforce runVar: false');
    assert.equal(call.opts.processRegex, false);
  }

  const text = ui.bodyText();
  assert.match(text, /정규식 실행 결과 미리보기 \(매칭 1건/);
  assert.match(text, /<span class="hp">체력 80\/100<\/span>/);
  assert.match(text, /CBS 실행 결과 미리보기 \(현재 채팅 기준 · 변수 미변경\)/);
  assert.match(text, /아리아가 반긴다, 유저/);

  // Interactive regex sample tester updates live without modifying host data
  const sampleInput = ui.findAll(n => n.tagName === 'INPUT' && n.getAttribute('placeholder') === '테스트할 채팅 문장을 입력하세요')[0];
  assert.ok(sampleInput, 'interactive regex sample input must be rendered');
  sampleInput.value = '전투 중 [HP:42] 남음';
  await ui.click('실행 테스트');
  assert.match(ui.bodyText(), /체력 42\/100/);

  // Invalid regex syntax must be rejected loudly before apply
  const adapter = new HostAdapter(fix.extraApi);
  const badPreview = await adapter.previewProposal({
    action: 'upsert_regex',
    scope: 'character',
    comment: '깨진 정규식',
    in: '[unclosed(',
    out: 'x',
    type: 'editdisplay',
  }, { targetKind: 'general' });
  assert.equal(badPreview.ok, false);
  assert.match(badPreview.error, /정규식 문법 오류/);
});

test('update_chat_vars normalizes $ keys, preserves unprefixed Lua keys, edits & removes vars, and undoes cleanly', async () => {
  const fix = makeFixture();
  const capturedPrompts = [];
  const reply = proposalBlock({
    action: 'update_chat_vars',
    title: '호감도 상승 및 플래그 정리',
    set: { hp: '100', affection: '80', new_quest: 'start', raw_flag: 'updated' },
    remove: ['old_nonexistent', '$hp'],
  });
  const badUnknown = findUnknownProposalKeys(parseAssistantReply(reply).proposals[0]);
  assert.deepEqual(badUnknown, []);

  // Test clean set + remove (without setting and removing the same key)
  const cleanReply = proposalBlock({
    action: 'update_chat_vars',
    title: '채팅 변수 수정',
    set: { affection: '80', new_quest: 'start', raw_flag: 'updated' },
    remove: ['hp'],
  });
  const ui = await bootBundle({
    state: fix.state,
    extraApi: fix.extraApi,
    runLLMModel: async (req) => {
      capturedPrompts.push(req.messages[0].content);
      return cleanReply;
    },
  });
  await ui.send('현재 채팅 변수에서 호감도 80으로 올리고 hp 변수는 지워 줘');

  assert.match(capturedPrompts[0], /\[현재 채팅 변수 \(chat\.scriptstate\)\]/);
  assert.match(capturedPrompts[0], /affection = 35/);

  await ui.click('적용');
  const scriptstate = fix.db.characters[0].chats[0].scriptstate;
  assert.equal(scriptstate.$affection, '80');
  assert.equal(scriptstate.$new_quest, 'start');
  assert.equal(scriptstate.raw_flag, 'updated', 'existing unprefixed Lua state key must stay unprefixed');
  assert.equal(Object.hasOwn(scriptstate, '$hp'), false, 'removed variable must be deleted');

  // Undo restores exact original scriptstate
  await ui.clickConfirm(/^되돌리기 \(1\)$/);
  assert.deepEqual(fix.db.characters[0].chats[0].scriptstate, { $hp: '80', $affection: '35', raw_flag: 'yes' });
});

test('delete actions require confirmation modal, enforce integrity guards, and support surgical Undo', async () => {
  const fix = makeFixture();
  const reply = [
    proposalBlock({ action: 'delete_lorebook', title: '임시 메모 삭제', scope: 'character', loreIndex: 3 }),
    proposalBlock({ action: 'delete_regex', title: '임시 정규식 삭제', scope: 'character', regexIndex: 1 }),
    proposalBlock({ action: 'delete_persona', title: '테스트 페르소나 삭제', personaIndex: 1 }),
    proposalBlock({ action: 'delete_greeting', title: '추가 첫 메시지 #1 삭제', greetingIndex: 0 }),
  ].join('\n');

  const ui = await bootBundle({ state: fix.state, extraApi: fix.extraApi, runLLMModel: async () => reply });
  await ui.send('임시 메모, 임시 정규식, 테스트 페르소나, 1번 추가 첫 메시지 삭제해 줘');

  // All 4 cards must render red '삭제 적용' buttons
  assert.equal(ui.buttons('삭제 적용').length, 4);

  // Clicking '삭제 적용' opens confirmation modal; cancelling leaves data untouched
  await ui.click('삭제 적용', 0);
  assert.ok(ui.dialog(), 'delete action MUST open confirmation popup');
  await ui.answerDialog(false);
  assert.equal(fix.db.characters[0].globalLore.length, 4, 'cancelling delete modal must not mutate data');

  // Confirming individual lorebook delete removes it and supports Undo
  await ui.clickConfirm('삭제 적용', 0);
  assert.equal(fix.db.characters[0].globalLore.length, 3);
  assert.ok(!fix.db.characters[0].globalLore.some(e => e.comment === '임시 메모'));

  // Batch '모두 적용' for remaining 3 delete items asks confirmation once, then applies all 3
  await ui.click(/^모두 적용 \(3\)$/);
  assert.ok(ui.dialog(), 'batch apply containing deletes must open confirmation popup');
  assert.match(ui.bodyText(), /삭제 작업 3건/);
  await ui.answerDialog(true);

  assert.equal(fix.db.characters[0].customscript.length, 1);
  assert.equal(fix.db.personas.length, 1);
  assert.equal(fix.db.selectedPersona, 0, 'selectedPersona must re-index safely when deleted');
  assert.deepEqual(fix.db.characters[0].alternateGreetings, ['야간 순찰 버전 첫 인사']);
  assert.equal(fix.db.characters[0].chats[0].fmIndex, -1, 'chat using deleted greeting must fall back to default (-1)');
  assert.equal(fix.db.characters[0].chats[1].fmIndex, 0, 'chat using later greeting must decrement fmIndex cleanly');

  // Group Undo restores regex + persona + selectedPersona + greeting + multi-chat fmIndex
  await ui.clickConfirm('묶음 되돌리기');
  assert.equal(fix.db.characters[0].customscript.length, 2);
  assert.equal(fix.db.personas.length, 2);
  assert.equal(fix.db.selectedPersona, 1);
  assert.equal(fix.db.characters[0].alternateGreetings.length, 2);
  assert.equal(fix.db.characters[0].chats[0].fmIndex, 0);
  assert.equal(fix.db.characters[0].chats[1].fmIndex, 1);

  // Integrity guards via adapter:
  const adapter = new HostAdapter(fix.extraApi);
  // 1. Non-empty folder cannot be deleted
  const nonEmptyFolder = await adapter.previewProposal({ action: 'delete_lorebook', scope: 'character', loreIndex: 0 }, { targetKind: 'general' });
  assert.equal(nonEmptyFolder.ok, false);
  assert.match(nonEmptyFolder.error, /로어북 1개가 남아 있어/);

  // 2. Empty folder CAN be deleted
  const emptyFolder = await adapter.previewProposal({ action: 'delete_lorebook', scope: 'character', loreIndex: 2 }, { targetKind: 'general' });
  assert.equal(emptyFolder.ok, true);

  // 3. Last remaining persona cannot be deleted
  fix.db.personas = [fix.db.personas[0]];
  const lastPersona = await adapter.previewProposal({ action: 'delete_persona', personaIndex: 0 }, { targetKind: 'general' });
  assert.equal(lastPersona.ok, false);
  assert.match(lastPersona.error, /마지막 남은 페르소나/);

  // 4. Default firstMessage (-1) rejected by validation
  const badGreeting = parseAssistantReply(proposalBlock({ action: 'delete_greeting', greetingIndex: -1 }));
  assert.equal(badGreeting.proposals.length, 0);
  assert.match(badGreeting.errors[0].error, /기본 첫 메시지\(-1\)는 삭제할 수 없습니다/);
});

test('opt-in fetch logs are never read automatically, redact secrets while keeping token counts, and auto-clear after 1 send', async () => {
  const fix = makeFixture();
  const sentSystemPrompts = [];
  const ui = await bootBundle({
    state: fix.state,
    extraApi: fix.extraApi,
    runLLMModel: async (req) => {
      sentSystemPrompts.push(req.messages[0].content);
      return '진단 완료했습니다.';
    },
  });

  // Normal turn NEVER calls getFetchLogs()
  await ui.send('안녕, 테스트 질문이야');
  assert.equal(fix.getFetchLogCalls(), 0, 'getFetchLogs MUST NEVER be called automatically');
  assert.doesNotMatch(sentSystemPrompts[0], /첨부된 최근 LLM 요청 로그/);

  // User opens ☰ menu and explicitly clicks '🔍 최근 요청 로그 첨부'
  await ui.click('☰');
  await ui.click('🔍 최근 요청 로그 첨부');
  assert.equal(fix.getFetchLogCalls(), 1);
  assert.match(ui.bodyText(), /요청 로그 첨부됨 \(1회 전송 후 자동 해제\): HTTP 429/);

  // Next send includes sanitized log (secrets redacted, query stripped, token counts kept)
  await ui.send('방금 왜 429 오류가 났어?');
  assert.match(sentSystemPrompts[1], /\[첨부된 최근 LLM 요청 로그/);
  assert.match(sentSystemPrompts[1], /HTTP 상태: 429/);
  assert.match(sentSystemPrompts[1], /https:\/\/api\.example\.com\/v1\/chat\/completions/);
  assert.doesNotMatch(sentSystemPrompts[1], /leak-query-secret/);
  assert.doesNotMatch(sentSystemPrompts[1], /sk-super-secret-token/);
  assert.doesNotMatch(sentSystemPrompts[1], /sk-raw-secret/);
  assert.doesNotMatch(sentSystemPrompts[1], /sk-inline-secret/);
  assert.match(sentSystemPrompts[1], /\[REDACTED\]/);
  assert.match(sentSystemPrompts[1], /"max_tokens": 2048/);
  assert.match(sentSystemPrompts[1], /"prompt_tokens": 4000/);

  // Indicator bar is auto-cleared after 1 send, and subsequent send does NOT include the log
  assert.doesNotMatch(ui.bodyText(), /요청 로그 첨부됨/);
  await ui.send('다음 질문이야');
  assert.doesNotMatch(sentSystemPrompts[2], /첨부된 최근 LLM 요청 로그/);
  assert.equal(fix.getFetchLogCalls(), 1);
});

test('create_module creates a full RisuModule package, activates it in current chat, and undoes both DB + chat in one click', async () => {
  const fix = makeFixture();
  const reply = proposalBlock({
    action: 'create_module',
    title: 'RPG 상태창 모듈 생성',
    name: 'RPG Status HUD',
    description: 'HP/호감도 상태창 패키지',
    namespace: 'rpg-hud',
    customModuleToggle: 'hud_on=상태창 표시=select=켜기,끄기',
    backgroundEmbedding: '<style>.rpg-hud { border: 1px solid #5c8dff; }</style>',
    luaCode: 'function onOutput(id)\n  setState(id, "turn", "1")\nend',
    regex: [
      { comment: 'HP 배지', in: '\\[HP:(\\d+)\\]', out: '<div class="rpg-hud">HP $1/{{getvar::max_hp}}</div>', type: 'editdisplay', flag: 'g', ableFlag: true },
    ],
    lorebook: [
      { comment: '상태창 출력 지침', key: '', alwaysActive: true, insertorder: 100, content: '응답 끝에 [HP:숫자]를 표기한다.' },
    ],
    enableInCurrentChat: true,
    enableGlobally: false,
  });

  const ui = await bootBundle({ state: fix.state, extraApi: fix.extraApi, runLLMModel: async () => reply });
  await ui.send('RPG 상태창 모듈 하나 새로 만들어서 지금 채팅에 바로 켜줘');

  const cardText = ui.bodyText();
  assert.match(cardText, /새 모듈 생성/);
  assert.match(cardText, /RPG Status HUD/);
  assert.match(cardText, /현재 채팅에 바로 켜기/);
  assert.match(cardText, /정규식 실행 결과 미리보기 \(매칭 1건/);
  assert.match(cardText, /HP 80\/100/);

  await ui.click('적용');
  assert.equal(fix.db.modules.length, 1);
  const created = fix.db.modules[0];
  assert.equal(created.name, 'RPG Status HUD');
  assert.equal(created.namespace, 'rpg-hud');
  assert.equal(created.lorebook.length, 1);
  assert.equal(created.regex.length, 1);
  assert.equal(created.trigger[0].effect[0].type, 'triggerlua');
  assert.match(created.trigger[0].effect[0].code, /setState/);
  assert.equal(created.customModuleToggle, 'hud_on=상태창 표시=select=켜기,끄기');
  assert.ok(fix.db.characters[0].chats[0].modules.includes(created.id), 'module must be enabled in current chat');
  assert.equal(fix.db.enabledModules.length, 0, 'enableGlobally was false');

  // Single Undo reverts BOTH db.modules AND chat.modules together
  await ui.clickConfirm(/^되돌리기 \(1\)$/);
  assert.equal(fix.db.modules.length, 0);
  assert.deepEqual(fix.db.characters[0].chats[0].modules, []);
});

test('create_character creates a complete valid RisuAI character + characterOrder entry and undoes surgically by chaId', async () => {
  const fix = makeFixture();
  const reply = proposalBlock({
    action: 'create_character',
    title: '새 캐릭터 세라 생성',
    name: '세라',
    desc: '왕국 근위대의 젊은 기사.',
    firstMessage: '검을 쥔 채 경례한다. "어서 오십시오."',
    alternateGreetings: ['주점에서 마주친 첫 만남'],
    tags: ['기사', '판타지'],
    loreSettings: { tokenBudget: 1500, scanDepth: 5, recursiveScanning: true, fullWordMatching: true },
    bias: [['갑자기', -25]],
    globalLore: [{ comment: '왕국 근위대', key: '근위대', content: '수도 방위 조직', insertorder: 100 }],
    luaCode: 'function onInput(id)\nend',
  });

  const ui = await bootBundle({ state: fix.state, extraApi: fix.extraApi, runLLMModel: async () => reply });
  await ui.send('새 캐릭터 카드 세라 만들어 줘');
  await ui.click('적용');

  assert.equal(fix.db.characters.length, 3);
  const sera = fix.db.characters[2];
  assert.equal(sera.type, 'character');
  assert.equal(sera.name, '세라');
  assert.ok(sera.chaId && sera.chaId.length > 5);
  assert.equal(sera.chats.length, 1);
  assert.equal(sera.chats[0].name, 'Chat 1');
  assert.equal(sera.sdData.length, 7, 'defaultSdData skeleton must be populated');
  assert.equal(sera.loreSettings.tokenBudget, 1500);
  assert.deepEqual(sera.bias, [['갑자기', -25]]);
  assert.equal(sera.globalLore.length, 1);
  assert.equal(sera.triggerscript[0].effect[0].type, 'triggerlua');
  assert.ok(fix.db.characterOrder.includes(sera.chaId), 'new character chaId must be added to characterOrder');

  // Even if another character is appended later, surgical Undo removes ONLY 세라 by chaId
  fix.db.characters.push({ type: 'character', chaId: 'other-later', name: '나중에 추가됨', chats: [] });
  fix.db.characterOrder.push('other-later');

  await ui.clickConfirm(/^되돌리기 \(1\)$/);
  assert.ok(!fix.db.characters.some(c => c.chaId === sera.chaId), '세라 must be removed by Undo');
  assert.ok(fix.db.characters.some(c => c.chaId === 'other-later'), 'other characters must remain untouched');
  assert.ok(!fix.db.characterOrder.includes(sera.chaId));
  assert.ok(fix.db.characterOrder.includes('other-later'));
});

test('update_char_settings tunes loreSettings, bias, and tags incrementally and undoes cleanly', async () => {
  const fix = makeFixture();
  const captured = [];
  const reply = proposalBlock({
    action: 'update_char_settings',
    title: '로어북 예산 및 바이어스 튜닝',
    loreSettings: { tokenBudget: 2000, scanDepth: 6, recursiveScanning: true, fullWordMatching: true },
    addBias: [['문득', -20], ['갑자기', -30]],
    addTags: ['RPG'],
    removeTags: ['기록관'],
  });

  const ui = await bootBundle({
    state: fix.state,
    extraApi: fix.extraApi,
    runLLMModel: async (req) => {
      captured.push(req.messages[0].content);
      return reply;
    },
  });
  await ui.send('로어북 토큰 예산 2000, 스캔 깊이 6으로 올리고 바이어스랑 태그도 조정해 줘');
  assert.match(captured[0], /\[현재 캐릭터 고급 설정/);
  assert.match(captured[0], /"tokenBudget": 800/);

  await ui.click('적용');
  const ch = fix.db.characters[0];
  assert.deepEqual(ch.loreSettings, { tokenBudget: 2000, scanDepth: 6, recursiveScanning: true, fullWordMatching: true });
  assert.deepEqual(ch.bias, [['갑자기', -30], ['문득', -20]]);
  assert.deepEqual(ch.tags, ['판타지', 'RPG']);

  await ui.clickConfirm(/^되돌리기 \(1\)$/);
  assert.deepEqual(fix.db.characters[0].loreSettings, { tokenBudget: 800, scanDepth: 2, recursiveScanning: false, fullWordMatching: false });
  assert.deepEqual(fix.db.characters[0].bias, [['갑자기', -15]]);
  assert.deepEqual(fix.db.characters[0].tags, ['판타지', '기록관']);
});

test('port_from_character loads character catalog on demand, copies folder+lorebook/regex/Lua without duplicates or orphans, and undoes cleanly', async () => {
  const fix = makeFixture();
  const captured = [];
  const reply = proposalBlock({
    action: 'port_from_character',
    title: '마법사 카엘에서 로어북·정규식·Lua 포팅',
    sourceCharIndex: 1,
    items: ['lorebook', 'regex', 'lua'],
  });

  const ui = await bootBundle({
    state: fix.state,
    extraApi: fix.extraApi,
    runLLMModel: async (req) => {
      captured.push(req.messages[0].content);
      return reply;
    },
  });
  await ui.send('다른 캐릭터 마법사 카엘의 로어북, 정규식, Lua를 현재 캐릭터로 포팅해 줘');

  assert.match(captured[0], /\[다른 캐릭터 목록 \(교차 포팅용 읽기 전용 요약\)\]/);
  assert.match(captured[0], /마법사 카엘/);

  await ui.click('적용');
  const dst = fix.db.characters[0];
  // Original 4 lorebooks + parent folder '마법사 체계 폴더' + '화염 마법' ('별빛 탑' duplicate skipped!)
  assert.equal(dst.globalLore.length, 6);
  assert.ok(dst.globalLore.some(e => e.mode === 'folder' && e.key === '\uf000folder:magic'), 'parent folder copied so ported entry is never orphaned');
  assert.ok(dst.globalLore.some(e => e.comment === '화염 마법'));
  assert.equal(dst.globalLore.filter(e => e.comment === '별빛 탑').length, 1, 'duplicate lorebook must be skipped');

  // Original 2 regexes + '화염 이펙트' ('임시 정규식' duplicate skipped!)
  assert.equal(dst.customscript.length, 3);
  assert.ok(dst.customscript.some(r => r.comment === '화염 이펙트'));
  assert.equal(dst.customscript.filter(r => r.comment === '임시 정규식').length, 1, 'duplicate regex must be skipped');

  // Lua ported cleanly
  const dstLua = extractLuaFromTriggers(dst.triggerscript);
  assert.equal(dstLua.isLua, true);
  assert.match(dstLua.code, /setState\(id, "mana", "100"\)/);

  // Surgical Undo reverts all ported items in 1 click
  await ui.clickConfirm(/^되돌리기 \(1\)$/);
  assert.equal(fix.db.characters[0].globalLore.length, 4);
  assert.equal(fix.db.characters[0].customscript.length, 2);
  assert.deepEqual(fix.db.characters[0].triggerscript, []);
});

test('sanitizeFetchLog redacts secrets deeply while preserving token count metrics', () => {
  const res = sanitizeFetchLog({
    url: 'https://openrouter.ai/api/v1/chat/completions?key=abc',
    status: 400,
    body: {
      api_key: 'secret-1',
      headers: { Authorization: 'Bearer sk-1234567890abcdef' },
      max_tokens: 4096,
      prompt_tokens: 1200,
    },
    response: 'Bearer sk-response-secret-xyz999',
  });
  assert.equal(res.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.doesNotMatch(res.body, /secret-1/);
  assert.doesNotMatch(res.body, /sk-1234567890/);
  assert.match(res.body, /"max_tokens": 4096/);
  assert.match(res.body, /"prompt_tokens": 1200/);
  assert.doesNotMatch(res.response, /sk-response-secret/);
  assert.match(res.response, /Bearer \[REDACTED\]/);
});

test('pure planners handle edge cases cleanly (planChatVarsUpdate, planCharSettingsUpdate, planCharacterPort)', () => {
  const noChangeVars = planChatVarsUpdate({ $hp: '80' }, { set: { hp: '80' } });
  assert.equal(noChangeVars.ok, false);

  const groupBias = planCharSettingsUpdate({ type: 'group', name: 'G' }, { addBias: [['a', -10]] });
  assert.equal(groupBias.ok, false);
  assert.match(groupBias.error, /그룹 채팅/);

  // Orphan protection when porting a lore entry whose source folder key does not exist
  const portOrphan = planCharacterPort(
    { globalLore: [{ comment: '고아 항목', key: 'x', folder: '\uf000folder:missing', content: 'hi', mode: 'normal' }] },
    { globalLore: [] },
    { items: ['lorebook'], extractLua: extractLuaFromTriggers, buildLuaTriggers }
  );
  assert.equal(portOrphan.ok, true);
  assert.equal(portOrphan.next.globalLore[0].folder, undefined, 'dangling folder ref must be stripped on port');
});
