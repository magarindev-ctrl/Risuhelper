import test from 'node:test';
import assert from 'node:assert/strict';

import { HostAdapter } from '../src/host-adapter.js';
import {
  parseJsonTolerant,
  parseToolCalls,
  parseAssistantReply,
  buildConversationMessages,
} from '../src/llm.js';
import {
  getSkillCatalog,
  loadSkillPack,
} from '../src/skills.js';
import {
  READ_TOOL_DEFS,
  MAX_TOOLS_PER_CALL,
  getAvailableReadTools,
  executeReadTool,
  executeReadToolBatch,
} from '../src/read-tools.js';
import {
  MAX_AGENT_CALLS,
  normalizeMaxCalls,
  runAgentLoop,
} from '../src/agent-loop.js';
import { COLD_STORAGE_HEADER } from '../src/chat-transfer.js';
import { bootBundle, proposalBlock } from './helpers/boot-bundle.mjs';

function freshCharacter() {
  return {
    type: 'character',
    chaId: 'char-m1-test',
    name: '아리아',
    desc: '초기 설명',
    firstMessage: '안녕하세요.',
    alternateGreetings: [],
    globalLore: [],
    customscript: [],
    triggerscript: [],
    chats: [{ id: 'chat-m1-0', name: '기본 채팅', note: '', fmIndex: -1, scriptstate: {}, localLore: [], message: [] }],
    chatPage: 0,
  };
}

function toolBlock(payload) {
  return '```risuhelper-tool\n' + JSON.stringify(payload) + '\n```';
}

function makeRichHostFixture({ writeSpy = null, extraApi = {} } = {}) {
  const longDesc = '주인공 아리아의 초기 설정.\n' + '가'.repeat(600) + '\n숨겨진 비밀: 은빛 열쇠를 지녔다.';
  const db = {
    temperature: 80,
    maxContext: 8000,
    maxResponse: 1000,
    selectedPersona: 0,
    personas: [
      { id: 'p-1', name: '모험가', personaPrompt: '조용한 탐색가', note: '메모' },
    ],
    modules: [
      {
        id: 'mod-1',
        name: 'HUD 모듈',
        description: '상태창 모듈',
        backgroundEmbedding: '{{img::missing_mod_bg.png}}',
        assets: [['panel_bg', 'assets/panel.png', 'png']],
        lorebook: [
          { comment: '모듈 고아 항목', key: 'hud', folder: '\uf000folder:ghost', content: '고아 본문', insertorder: 100, mode: 'normal' },
        ],
        regex: [
          { comment: '깨진 모듈 정규식', in: '[unclosed', out: 'x', type: 'editdisplay', flag: 'g' },
        ],
        trigger: [
          { comment: 'mod', type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: 'if true then\n  local x = 1\n' }] },
        ],
      },
    ],
    characters: [
      {
        type: 'character',
        chaId: 'char-aria',
        name: '아리아',
        desc: longDesc,
        firstMessage: '첫 인사에 {{img::missing_cover.png}} 와 {{unclosed_cbs',
        alternateGreetings: ['두 번째 인사 ' + '나'.repeat(600) + ' 끝-표식'],
        backgroundHTML: '{{bg::ok_bg.png}}',
        additionalAssets: [['ok_bg', 'assets/ok_bg.png', 'png']],
        emotionImages: [['smile', 'assets/smile.png']],
        globalLore: [
          { comment: '정상 로어북', key: '왕국', secondkey: '', content: '북부 왕국의 역사', insertorder: 100, mode: 'normal' },
          { comment: '고아 로어북', key: '유령', folder: '\uf000folder:nonexistent', content: '숨겨진 항목', insertorder: 100, mode: 'normal' },
        ],
        customscript: [
          { comment: '정상 정규식', in: '\\[HP:(\\d+)\\]', out: '<b>$1</b>', type: 'editdisplay', flag: 'g' },
          { comment: '깨진 정규식', in: '(unclosed', out: 'bad', type: 'editdisplay', flag: 'g' },
        ],
        triggerscript: [
          { comment: 'charlua', type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: 'function onOutput(id)\n  if true then\n    local a = 1\nend' }] },
        ],
        chats: [
          {
            id: 'chat-0',
            name: '현재 모험',
            note: '차분한 서술',
            fmIndex: -1,
            scriptstate: { $hp: 80, $mp: 40, secret_flag: 'on' },
            localLore: [],
            message: [
              { role: 'user', data: '숲으로 들어가자.', chatId: 'm1' },
              { role: 'char', data: '안개 속에서 늑대가 나타났다.', chatId: 'm2' },
            ],
          },
          {
            // Intentionally missing `id` to test audit_workspace fork_compat check
            name: '이전 회차',
            note: '이전 노트',
            fmIndex: -1,
            scriptstate: { $hp: 10, $gold: 999 },
            localLore: [],
            message: [
              { role: 'user', data: '이전 회차의 시작', chatId: 'old1' },
              { role: 'char', data: '고대 유적의 문이 열렸다.', chatId: 'old2' },
            ],
          },
          {
            id: 'chat-2-cold',
            name: '보관된 채팅',
            note: '',
            fmIndex: -1,
            scriptstate: {},
            localLore: [],
            message: [{ role: 'user', data: `${COLD_STORAGE_HEADER}cold-ref-1` }],
          },
        ],
        chatPage: 0,
      },
      {
        type: 'character',
        chaId: 'char-kael',
        name: '마법사 카엘',
        desc: '불꽃 마법사 카엘의 전문 설명입니다.',
        firstMessage: '화염이여!',
        alternateGreetings: [],
        globalLore: [
          { comment: '화염 마법 체계', key: '화염', content: '마나를 소모해 불꽃을 다룬다.', insertorder: 100, mode: 'normal' },
        ],
        customscript: [],
        triggerscript: [],
        chats: [
          {
            id: 'kael-chat-0',
            name: '카엘의 방',
            note: '마법 노트',
            fmIndex: -1,
            scriptstate: { $mana: 250 },
            localLore: [],
            message: [{ role: 'char', data: '마탑의 문이 열렸다.', chatId: 'k1' }],
          },
        ],
        chatPage: 0,
      },
    ],
  };

  let charIndex = 0;
  const parseCalls = [];
  const recordWrite = (name) => {
    if (writeSpy) writeSpy(name);
  };

  const api = {
    getCharacter: async () => structuredClone(db.characters[charIndex]),
    setCharacter: async (c) => { recordWrite('setCharacter'); db.characters[charIndex] = structuredClone(c); },
    getCharacterFromIndex: async (i) => (db.characters[i] ? structuredClone(db.characters[i]) : null),
    setCharacterToIndex: async (i, c) => { recordWrite('setCharacterToIndex'); db.characters[i] = structuredClone(c); },
    getCharIndex: async () => charIndex,
    getChatIndex: async () => db.characters[charIndex].chatPage || 0,
    getChatFromIndex: async (ci, chIdx) => {
      const ch = db.characters[ci]?.chats?.[chIdx];
      return ch ? structuredClone(ch) : null;
    },
    setChatToIndex: async (ci, chIdx, chat) => {
      recordWrite('setChatToIndex');
      db.characters[ci].chats[chIdx] = structuredClone(chat);
    },
    getDatabase: async (keys) => {
      const out = {};
      for (const k of keys || Object.keys(db)) out[k] = structuredClone(db[k]);
      return out;
    },
    setDatabase: async (patch) => {
      recordWrite('setDatabase');
      for (const [k, v] of Object.entries(patch || {})) db[k] = structuredClone(v);
    },
    setDatabaseLite: async (patch) => {
      recordWrite('setDatabaseLite');
      for (const [k, v] of Object.entries(patch || {})) db[k] = structuredClone(v);
    },
    sendChat: async () => { recordWrite('sendChat'); },
    saveAsset: async () => { recordWrite('saveAsset'); },
    parseRisuChat: async (text, opts) => {
      parseCalls.push({ text, opts });
      return String(text).replace(/\{\{char\}\}/g, '아리아').replace(/\{\{getvar::hp\}\}/g, '80');
    },
    getCurrentLorebookEntries: async () => [
      { comment: '발동된 왕국 로어', key: '왕국', mode: 'normal', alwaysActive: false, content: '현재 프롬프트에 주입됨' },
    ],
    readImage: async (p) => (p === 'assets/ok_bg.png' ? new Uint8Array([1, 2, 3, 4]) : null),
    readInlay: async (id) => (id === 'inlay-1' ? { type: 'image', name: 'map', ext: 'png', width: 512, height: 512, data: 'BASE64_HUGE_IGNORED' } : null),
    getFetchLogs: async () => [
      {
        url: 'https://api.example.com/v1/chat',
        status: 200,
        header: { Authorization: 'Bearer sk-secret-token-123' },
        body: JSON.stringify({ apiKey: 'sk-super-secret', model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
        response: JSON.stringify({ usage: { prompt_tokens: 120, completion_tokens: 45 }, choices: [] }),
      },
    ],
    getColorScheme: async () => ({ name: 'Dark', scheme: { type: 'dark' } }),
    getTextTheme: async () => 'standard',
    searchTranslationCache: async (q) => [{ source: q, target: `${q}(번역됨)` }],
    ...extraApi,
  };

  const adapter = new HostAdapter(api);
  return { api, adapter, db, parseCalls, longDesc };
}

test('parseToolCalls & parseAssistantReply parse batches, flat forms, trailing commas, and reject write/unknown tools', () => {
  const raw = [
    '먼저 관련 스킬과 항목을 확인하겠습니다.',
    '```risuhelper-tool',
    '[{"tool":"load_skill","args":{"skillIds":["scripts"]},}, {"tool":"read_item","kind":"lorebook","loreIndex":0,}]',
    '```',
  ].join('\n');

  const parsed = parseAssistantReply(raw);
  assert.equal(parsed.prose, '먼저 관련 스킬과 항목을 확인하겠습니다.');
  assert.equal(parsed.toolCalls.length, 2);
  assert.deepEqual(parsed.toolCalls[0], { tool: 'load_skill', args: { skillIds: ['scripts'] } });
  assert.deepEqual(parsed.toolCalls[1], { tool: 'read_item', args: { kind: 'lorebook', loreIndex: 0 } });
  assert.equal(parsed.toolErrors.length, 0);

  // Reject write / unknown / prototype-pollution tools
  const bad = parseToolCalls(
    '```risuhelper-tool\n' +
    '[{"tool":"delete_lorebook","args":{"loreIndex":0}},{"tool":"setDatabase","args":{}},{"tool":"read_item","args":{"__proto__":{}}}]\n' +
    '```'
  );
  assert.equal(bad.toolCalls.length, 0);
  assert.equal(bad.toolErrors.length, 3);
  assert.match(bad.toolErrors[0].error, /허용되지 않는 읽기 도구/);
  assert.match(bad.toolErrors[2].error, /허용되지 않는 도구 인자 키/);

  // Tolerant JSON recovery check
  assert.deepEqual(parseJsonTolerant('{"a":[1,2,],}'), { a: [1, 2] });
});

test('L0/L1/L2 built-in skill router and tool catalog adapt to capabilities and opt-in fetch log flag', () => {
  const fullCaps = {
    getCurrentLorebookEntries: true,
    getFetchLogs: true,
    translationCache: true,
  };
  const hardenedCaps = {
    getCurrentLorebookEntries: false,
    getFetchLogs: false,
    translationCache: false,
  };

  // L1 catalog hides already-loaded skills
  const l1 = getSkillCatalog(fullCaps, ['core_chat', 'lorebook']);
  assert.ok(l1.some(s => s.id === 'scripts'));
  assert.ok(!l1.some(s => s.id === 'lorebook'));

  // L2 loadSkillPack returns full skill guide & schemas without external SKILL.md
  const pack = loadSkillPack(['scripts', 'nonexistent_skill'], fullCaps);
  assert.equal(pack.ok, true);
  assert.deepEqual(pack.loaded, ['scripts']);
  assert.deepEqual(pack.unknown, ['nonexistent_skill']);
  assert.match(pack.text, /update_lua/);
  assert.match(pack.text, /upsert_regex/);

  // Tool catalog hides read_fetch_log unless allowFetchLog is true, and hides unsupported host tools
  const toolsDefault = getAvailableReadTools(fullCaps, { allowFetchLog: false }).map(t => t.id);
  assert.ok(!toolsDefault.includes('read_fetch_log'), 'read_fetch_log hidden without explicit opt-in');
  assert.ok(toolsDefault.includes('active_lorebook'));
  assert.ok(toolsDefault.includes('search_translation'));

  const toolsWithOptIn = getAvailableReadTools(fullCaps, { allowFetchLog: true }).map(t => t.id);
  assert.ok(toolsWithOptIn.includes('read_fetch_log'));

  const toolsHardened = getAvailableReadTools(hardenedCaps, { allowFetchLog: true }).map(t => t.id);
  assert.ok(!toolsHardened.includes('active_lorebook'));
  assert.ok(!toolsHardened.includes('search_translation'));
  assert.ok(!toolsHardened.includes('read_fetch_log'));

  // buildConversationMessages injects L1 catalog + tools only when enableTools: true
  const msgWithTools = buildConversationMessages({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    snapshot: { target: { targetKind: 'general' }, content: '' },
    extraContext: {},
    history: [],
    userInput: '안녕',
    capabilities: hardenedCaps,
    enableTools: true,
    allowFetchLog: false,
  });
  assert.match(msgWithTools[0].content, /읽기·진단 도구 및 L1 내장 스킬/);
  assert.doesNotMatch(msgWithTools[0].content, /`read_fetch_log`/);
  assert.doesNotMatch(msgWithTools[0].content, /`active_lorebook`/);

  const msgNoTools = buildConversationMessages({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    snapshot: { target: { targetKind: 'general' }, content: '' },
    extraContext: {},
    history: [],
    userInput: '안녕',
    capabilities: fullCaps,
    enableTools: false,
  });
  assert.doesNotMatch(msgNoTools[0].content, /risuhelper-tool/);
});

test('all 12 Read-Only tools work safely, unlock full-text flags, respect opt-in log guard, and never invoke write APIs', async () => {
  const writes = [];
  const { adapter, parseCalls } = makeRichHostFixture({ writeSpy: (fn) => writes.push(fn) });
  assert.equal(READ_TOOL_DEFS.length, 12);

  // 1. load_skill
  const r1 = await executeReadTool(adapter, { tool: 'load_skill', args: { skillIds: ['module_create'] } });
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.result.loaded, ['module_create']);

  // 2. read_item (char_field, greeting, cross-char lorebook) + unlock tracking
  const unlocks = { skillIds: new Set(), fieldsShownFull: new Set(), greetingsShownFull: new Set() };
  const r2a = await executeReadTool(adapter, { tool: 'read_item', args: { kind: 'char_field', field: 'desc' } }, {}, unlocks);
  assert.equal(r2a.ok, true);
  assert.match(r2a.result.content, /은빛 열쇠/);
  assert.ok(unlocks.fieldsShownFull.has('desc'), 'full char_field read unlocks fieldsShownFull');

  const r2b = await executeReadTool(adapter, { tool: 'read_item', args: { kind: 'greeting', greetingIndex: 0 } }, {}, unlocks);
  assert.equal(r2b.ok, true);
  assert.match(r2b.result.content, /끝-표식/);
  assert.ok(unlocks.greetingsShownFull.has(0), 'full greeting read unlocks greetingsShownFull');

  const r2c = await executeReadTool(adapter, { tool: 'read_item', args: { kind: 'lorebook', charIndex: 1, loreIndex: 0 } });
  assert.equal(r2c.ok, true);
  assert.equal(r2c.result.comment, '화염 마법 체계');

  // 3. list_items (pagination + query)
  const r3 = await executeReadTool(adapter, { tool: 'list_items', args: { kind: 'lorebook', query: '왕국', offset: 0, limit: 10 } });
  assert.equal(r3.ok, true);
  assert.equal(r3.result.total, 1);
  assert.equal(r3.result.items[0].comment, '정상 로어북');

  // 4. read_chat (normal cross-chat + cold-stored guard)
  const r4a = await executeReadTool(adapter, { tool: 'read_chat', args: { chatIndex: 1, tail: 5 } });
  assert.equal(r4a.ok, true);
  assert.equal(r4a.result.messages.length, 2);
  assert.match(r4a.result.messages[1].text, /고대 유적/);

  const r4b = await executeReadTool(adapter, { tool: 'read_chat', args: { chatIndex: 2 } });
  assert.equal(r4b.ok, false);
  assert.equal(r4b.result.coldStored, true);

  // 5. read_vars (cross-char + keys filter)
  const r5 = await executeReadTool(adapter, { tool: 'read_vars', args: { charIndex: 1, chatIndex: 0, keys: ['mana'] } });
  assert.equal(r5.ok, true);
  assert.equal(r5.result.variables.length, 1);
  assert.equal(r5.result.variables[0].value, '250');

  // 6. test_regex_cbs (strictly passes runVar: false)
  const r6 = await executeReadTool(adapter, {
    tool: 'test_regex_cbs',
    args: { regex: { in: '\\[HP:(\\d+)\\]', out: 'HP={{getvar::hp}} ($1)', flag: 'g' }, text: '[HP:80]', runCbs: true },
  });
  assert.equal(r6.ok, true);
  assert.equal(r6.result.regex.matched, true);
  assert.equal(r6.result.cbs.ok, true);
  assert.equal(r6.result.cbs.output, 'HP=80 (80)');
  assert.equal(parseCalls.length, 1);
  assert.equal(parseCalls[0].opts.runVar, false, 'CBS simulation must always pass runVar: false');

  // 7. active_lorebook
  const r7 = await executeReadTool(adapter, { tool: 'active_lorebook', args: {} });
  assert.equal(r7.ok, true);
  assert.equal(r7.result.entries[0].comment, '발동된 왕국 로어');

  // 8. audit_workspace (catches orphan lore, invalid regex, unbalanced Lua, unbalanced CBS, missing asset, missing chat.id)
  const r8 = await executeReadTool(adapter, { tool: 'audit_workspace', args: { scope: 'all', moduleIndex: 0 } });
  assert.equal(r8.ok, true);
  assert.equal(r8.result.healthy, false);
  const categories = new Set(r8.result.findings.map(f => f.category));
  assert.ok(categories.has('lorebook'), 'detects orphaned lorebook');
  assert.ok(categories.has('regex'), 'detects broken regex');
  assert.ok(categories.has('lua'), 'detects unbalanced Lua');
  assert.ok(categories.has('cbs'), 'detects unbalanced CBS');
  assert.ok(categories.has('asset'), 'detects missing asset ref');
  assert.ok(categories.has('fork_compat'), 'detects chat missing UUID id');

  // 9. inspect_assets (metadata only, never dumps raw inlay base64)
  const r9 = await executeReadTool(adapter, {
    tool: 'inspect_assets',
    args: { scope: 'character', names: ['ok_bg', 'missing_one'], inlayId: 'inlay-1' },
  });
  assert.equal(r9.ok, true);
  assert.equal(r9.result.imageChecks[0].exists, true);
  assert.equal(r9.result.imageChecks[0].byteLength, 4);
  assert.equal(r9.result.imageChecks[1].exists, false);
  assert.equal(r9.result.inlayChecks[0].width, 512);
  assert.ok(!JSON.stringify(r9.result).includes('BASE64_HUGE_IGNORED'), 'must never leak raw binary/base64 data');

  // 10. read_fetch_log (blocked without opt-in, redacted with opt-in)
  const r10Blocked = await executeReadTool(adapter, { tool: 'read_fetch_log', args: { index: 0 } }, { allowFetchLog: false });
  assert.equal(r10Blocked.ok, false);
  assert.match(r10Blocked.result.error, /로그 첨부/);

  const r10Allowed = await executeReadTool(adapter, { tool: 'read_fetch_log', args: { index: 0 } }, { allowFetchLog: true });
  assert.equal(r10Allowed.ok, true);
  assert.ok(!JSON.stringify(r10Allowed.result).includes('sk-super-secret'), 'secrets must be redacted');
  assert.ok(JSON.stringify(r10Allowed.result).includes('120'), 'token usage preserved');

  // 11. host_info
  const r11 = await executeReadTool(adapter, { tool: 'host_info', args: {} });
  assert.equal(r11.ok, true);
  assert.equal(r11.result.colorScheme, 'Dark');
  assert.equal(r11.result.textTheme, 'standard');

  // 12. search_translation
  const r12 = await executeReadTool(adapter, { tool: 'search_translation', args: { query: 'kingdom' } });
  assert.equal(r12.ok, true);
  assert.equal(r12.result.matches[0].target, 'kingdom(번역됨)');

  // Batch cap at MAX_TOOLS_PER_CALL (6)
  const eightCalls = Array.from({ length: 8 }, () => ({ tool: 'host_info', args: {} }));
  const batch = await executeReadToolBatch(adapter, eightCalls);
  assert.equal(batch.runs.length, MAX_TOOLS_PER_CALL);
  assert.equal(batch.droppedCount, 2);

  // Zero writes across all 12 tools!
  assert.deepEqual(writes, [], 'Read-Only tools must NEVER invoke any host write API');
});

test('runAgentLoop handles 1-call fast path, 2-call read_item unlock, 2-call auto-repair, 3-call full pipeline, hard cap=3, zero writes, and cancellation', async () => {
  const writes = [];
  const { api, adapter } = makeRichHostFixture({ writeSpy: (fn) => writes.push(fn) });
  const basePinnedCtx = { screen: 'chat', targetKind: 'general', freeTalk: true, fieldsShownFull: [], greetingsShownFull: [] };
  const initialMessages = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'req' },
  ];

  // A. 1-call fast path
  {
    let n = 0;
    const res = await runAgentLoop({
      api,
      adapter,
      initialMessages,
      pinnedCtx: basePinnedCtx,
      callModel: async () => {
        n++;
        return '완료했습니다.\n' + proposalBlock({
          action: 'create_lorebook',
          title: '새 로어북',
          scope: 'character',
          comment: '신규',
          key: '신규',
          content: '내용',
        });
      },
    });
    assert.equal(n, 1);
    assert.equal(res.callsUsed, 1);
    assert.equal(res.toolRuns.length, 0);
    assert.equal(res.repairedCount, 0);
    assert.equal(res.previewedProposals[0].preview.ok, true);
  }

  // B. 2-call Read-Only tool (load_skill + read_item desc) unlocks whole-text update_field!
  {
    const replies = [
      '먼저 전문을 확인합니다.\n' + toolBlock([
        { tool: 'load_skill', args: { skillIds: ['char_fields'] } },
        { tool: 'read_item', args: { kind: 'char_field', field: 'desc' } },
      ]),
      '전문을 반영해 수정했습니다.\n' + proposalBlock({
        action: 'update_field',
        title: '캐릭터 설명 전체 정리',
        field: 'desc',
        content: '아리아의 새 전체 설명 (은빛 열쇠 포함)',
      }),
    ];
    let n = 0;
    let call2UserMsg = '';
    const res = await runAgentLoop({
      api,
      adapter,
      initialMessages,
      pinnedCtx: basePinnedCtx,
      callModel: async (_api, msgs) => {
        n++;
        if (n === 2) call2UserMsg = msgs[msgs.length - 1].content;
        return replies.shift();
      },
    });
    assert.equal(n, 2);
    assert.equal(res.callsUsed, 2);
    assert.deepEqual(res.loadedSkillIds, ['char_fields']);
    assert.ok(res.fieldsShownFull.includes('desc'));
    assert.match(call2UserMsg, /참고 자료 전용/);
    assert.match(call2UserMsg, /은빛 열쇠/);
    assert.equal(res.previewedProposals[0].preview.ok, true, 'read_item full read unlocks whole-text update_field preview');
  }

  // C. 2-call auto-repair when Call 1 has invalid regex / bad edit before mismatch
  {
    const replies = [
      proposalBlock({
        action: 'update_lorebook',
        title: '로어북 부분 수정',
        scope: 'character',
        loreIndex: 0,
        edits: [{ before: '존재하지 않는 문구', after: '교체' }],
      }),
      '수정했습니다.\n' + proposalBlock({
        action: 'update_lorebook',
        title: '로어북 부분 수정',
        scope: 'character',
        loreIndex: 0,
        edits: [{ before: '북부 왕국의 역사', after: '북부 왕국의 깊은 역사' }],
      }),
    ];
    let n = 0;
    let repairPrompt = '';
    const res = await runAgentLoop({
      api,
      adapter,
      initialMessages,
      pinnedCtx: basePinnedCtx,
      currentSourceExcerpt: '북부 왕국의 역사',
      callModel: async (_api, msgs) => {
        n++;
        if (n === 2) repairPrompt = msgs[msgs.length - 1].content;
        return replies.shift();
      },
    });
    assert.equal(n, 2);
    assert.equal(res.callsUsed, 2);
    assert.equal(res.repairedCount, 1);
    assert.match(repairPrompt, /자동 수정 요청/);
    assert.equal(res.previewedProposals[0].preview.ok, true);
  }

  // D. 3-call full pipeline: Call 1 tool -> Call 2 broken proposal -> Call 3 repaired final proposal
  {
    const replies = [
      toolBlock([{ tool: 'read_item', args: { kind: 'lorebook', loreIndex: 0 } }]),
      proposalBlock({
        action: 'upsert_regex',
        title: '깨진 정규식',
        scope: 'character',
        comment: '테스트',
        in: '(unclosed',
        out: 'x',
        type: 'editdisplay',
        flag: 'g',
      }),
      '정규식을 수정했습니다.\n' + proposalBlock({
        action: 'upsert_regex',
        title: '정상 정규식',
        scope: 'character',
        comment: '테스트',
        in: '\\(ok\\)',
        out: 'OK',
        type: 'editdisplay',
        flag: 'g',
      }),
    ];
    let n = 0;
    const res = await runAgentLoop({
      api,
      adapter,
      initialMessages,
      pinnedCtx: basePinnedCtx,
      callModel: async () => { n++; return replies.shift(); },
    });
    assert.equal(n, 3);
    assert.equal(res.callsUsed, 3);
    assert.equal(res.toolRuns.length, 1);
    assert.equal(res.repairedCount, 1);
    assert.equal(res.previewedProposals[0].preview.ok, true);
  }

  // E. Hard cap = 3 invariant (never makes a 4th call even with endless distinct tools or distinct errors)
  {
    let n = 0;
    const res = await runAgentLoop({
      api,
      adapter,
      initialMessages,
      pinnedCtx: basePinnedCtx,
      maxCalls: 99, // must clamp to 3!
      callModel: async () => {
        n++;
        return toolBlock([{ tool: 'list_items', args: { kind: 'lorebook', offset: n } }]);
      },
    });
    assert.equal(normalizeMaxCalls(99), MAX_AGENT_CALLS);
    assert.equal(n, 3, 'MUST NEVER exceed 3 LLM calls');
    assert.equal(res.callsUsed, 3);
    assert.equal(res.maxCalls, 3);
    assert.match(res.parsed.prose, /최대 LLM 호출 횟수/);
  }

  // F. maxCalls: 1 runs strictly 1 call without executing tools or auto-repair
  {
    let n = 0;
    const res = await runAgentLoop({
      api,
      adapter,
      initialMessages,
      pinnedCtx: basePinnedCtx,
      maxCalls: 1,
      callModel: async () => {
        n++;
        return toolBlock([{ tool: 'host_info', args: {} }]);
      },
    });
    assert.equal(n, 1);
    assert.equal(res.toolRuns.length, 0);
  }

  // G. Cancellation mid-loop stops immediately before Call 2
  {
    const job = { cancelled: false, cancelReason: '', _activeStop: null, stop(r) { this.cancelled = true; this.cancelReason = r; } };
    let n = 0;
    await assert.rejects(
      () => runAgentLoop({
        api,
        adapter,
        initialMessages,
        pinnedCtx: basePinnedCtx,
        job,
        onProgress: (info) => {
          if (info.stage === 'tools') job.stop('사용자 중단 테스트');
        },
        callModel: async () => {
          n++;
          return toolBlock([{ tool: 'host_info', args: {} }]);
        },
      }),
      /사용자 중단 테스트/
    );
    assert.equal(n, 1, 'cancelled loop must never invoke Call 2');
  }

  // H. Zero writes across EVERY single agent loop test above!
  assert.deepEqual(writes, [], 'Automatic agent loop steps must be 100% Read-Only');
});

test('bundled dist/risuhelper.js runs 2-call read_item -> update_field with telemetry UI, apply + undo, and maxLlmCalls=1 setting', async () => {
  const state = { character: freshCharacter() };
  state.character.desc = '긴 캐릭터 설명 앞부분. ' + '다'.repeat(700) + ' 끝-비밀문구';

  const replies = [
    '설명을 끝까지 읽어보겠습니다.\n' + toolBlock([{ tool: 'read_item', args: { kind: 'char_field', field: 'desc' } }]),
    '끝부분까지 반영해 정리했습니다.\n' + proposalBlock({
      action: 'update_field',
      title: '설명 전체 다듬기',
      field: 'desc',
      content: '정리된 캐릭터 설명 (끝-비밀문구 유지)',
    }),
  ];

  const capturedPrompts = [];
  const ui = await bootBundle({
    state,
    runLLMModel: async ({ messages }) => {
      capturedPrompts.push(messages[0].content);
      return replies.shift() || '단일 응답입니다.';
    },
  });

  // Turn 1: 2-call loop via read_item -> whole-text update_field (without mentioning '설명' explicitly in user input!)
  await ui.send('전체적으로 한번 다듬어 줘');
  assert.equal(capturedPrompts.length, 2, '2 LLM calls executed inside single user turn');
  assert.match(capturedPrompts[0], /읽기·진단 도구 및 L1 내장 스킬/);

  const text = ui.bodyText();
  assert.match(text, /호출 2\/3/);
  assert.match(text, /읽기 도구 1건/);
  assert.match(text, /자동 단계는 읽기 전용/);

  // Applying the proposal updates desc, and Undo restores it cleanly
  await ui.click(/^적용$/);
  assert.equal(state.character.desc, '정리된 캐릭터 설명 (끝-비밀문구 유지)');
  await ui.clickConfirm(/^되돌리기 \(1\)$/);
  assert.ok(state.character.desc.endsWith('끝-비밀문구'));

  // Settings: switch maxLlmCalls to 1 -> disables tool prompt section and restricts to 1 call
  await ui.click('☰');
  await ui.click(/설정/);
  const maxCallSel = ui.findAll(n => n.tagName === 'SELECT' && n.getAttribute('data-setting') === 'maxLlmCalls')[0];
  assert.ok(maxCallSel, 'maxLlmCalls selector must exist in settings');
  maxCallSel.value = '1';
  for (const fn of maxCallSel.listeners.get('change') || []) await fn({ target: maxCallSel });
  await ui.tick(10);

  await ui.send('단일 호출 확인');
  assert.equal(capturedPrompts.length, 3);
  assert.doesNotMatch(capturedPrompts[2], /risuhelper-tool/, 'maxLlmCalls=1 omits tool instructions from prompt');
  assert.match(ui.bodyText(), /호출 1\/1/);
});
