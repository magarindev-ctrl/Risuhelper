// Regression tests for RisuHelper v1.1.2 cross-character lookup & read-tool ergonomics:
// 1. list_items / read_item plural & shorthand kind aliases + allowed-kinds error hints
//    + charIndex / targetCharIndex / sourceCharIndex cross-character lookup
// 2. READ_TOOL_DEFS argsHint explicitly documents list_items kinds & charIndex? on read tools
// 3. Natural-language cross-character references ("~라는 캐릭터에서", "~ 캐릭터에서", "~ 봇에서")
//    trigger characterCatalog & char_create_port without false positives on current-character edits

import test from 'node:test';
import assert from 'node:assert/strict';

import { HostAdapter } from '../src/host-adapter.js';
import { executeReadTool, formatReadToolCatalog } from '../src/read-tools.js';
import {
  wantsCharacterCatalog,
  selectSkills,
  buildSkillPromptSections,
  loadSkillPack,
  extractRecentAssistantSkillIds,
} from '../src/skills.js';
import { mentionedFields } from '../src/fields.js';
import { wantsGreetingText } from '../src/greetings.js';
import { buildConversationMessages } from '../src/llm.js';
import { runAgentLoop } from '../src/agent-loop.js';
import { bootBundle, proposalBlock } from './helpers/boot-bundle.mjs';

function makeCrossCharFixture() {
  const char0 = {
    type: 'character',
    chaId: 'char-active',
    name: '유나를 괴롭히는 XX가지 방법',
    desc: '현재 열려 있는 캐릭터',
    firstMessage: '안녕 {{user}}.',
    alternateGreetings: [],
    globalLore: [
      { comment: '유나 기본 설정', key: '유나', mode: 'normal', content: '주인공 유나 설정', insertorder: 100 },
    ],
    customscript: [],
    triggerscript: [],
    chats: [
      { id: 'chat-a1', name: 'Chat 1', note: '', localLore: [], modules: [], scriptstate: {}, message: [] },
    ],
    chatPage: 0,
  };

  // Build 30 lorebooks so "민호연" sits at index 28 (past the 25-entry catalog loreNames preview)
  const manyLores = Array.from({ length: 28 }, (_, i) => ({
    comment: `항목 ${i + 1}`,
    key: `item_${i + 1}`,
    mode: 'normal',
    content: `일반 항목 ${i + 1} 본문`,
    insertorder: 100,
  }));
  manyLores.push({
    comment: '민호연',
    key: '민호연,호연',
    mode: 'normal',
    content: '민호연은 챗챈중고의 2학년 학생회장이다.',
    insertorder: 100,
  });

  const char1 = {
    type: 'character',
    chaId: 'char-ccjg',
    name: '챗챈중고',
    desc: '학교 배경 캐릭터',
    firstMessage: '종이 울린다.',
    alternateGreetings: [],
    globalLore: manyLores,
    customscript: [
      { comment: '학교 상태창', in: '\\[STATUS\\]', out: '<div>상태</div>', type: 'editdisplay', flag: 'g', ableFlag: true },
    ],
    triggerscript: [],
    chats: [
      { id: 'chat-b1', name: '챗챈중고 1번', note: '', localLore: [], modules: [], scriptstate: { day: '3' }, message: [] },
    ],
    chatPage: 0,
  };

  const db = {
    characters: [char0, char1],
    characterOrder: [char0.chaId, char1.chaId],
    modules: [
      { id: 'mod-1', name: '공통 모듈', lorebook: [], regex: [], trigger: [] },
    ],
    enabledModules: ['mod-1'],
    moduleIntergration: '',
    personas: [
      { name: '기본 페르소나', note: '', personaPrompt: '유저 설정', largePortrait: false },
    ],
    selectedPersona: 0,
  };

  const state = {
    character: char0,
    db,
    charIndex: 0,
    chatIndex: 0,
  };

  const api = {
    getDatabase: async (keys = 'all') => {
      if (keys === 'all' || !Array.isArray(keys)) return structuredClone(state.db);
      const out = {};
      for (const k of keys) if (Object.hasOwn(state.db, k)) out[k] = structuredClone(state.db[k]);
      return out;
    },
    setDatabase: async (partial) => {
      for (const [k, v] of Object.entries(partial)) state.db[k] = structuredClone(v);
      state.character = state.db.characters[state.charIndex];
    },
    getCharacter: async () => structuredClone(state.db.characters[state.charIndex]),
    setCharacter: async (next) => {
      state.db.characters[state.charIndex] = structuredClone(next);
      state.character = state.db.characters[state.charIndex];
    },
    getChar: async () => structuredClone(state.db.characters[state.charIndex]),
    setChar: async (next) => {
      state.db.characters[state.charIndex] = structuredClone(next);
      state.character = state.db.characters[state.charIndex];
    },
    getCharacterFromIndex: async (idx) => structuredClone(state.db.characters[idx]),
    setCharacterToIndex: async (idx, next) => {
      state.db.characters[idx] = structuredClone(next);
      if (idx === state.charIndex) state.character = state.db.characters[idx];
    },
    getCharacterIndex: async () => state.charIndex,
    getChatIndex: async () => state.chatIndex,
    getChat: async () => structuredClone(state.db.characters[state.charIndex].chats[state.chatIndex]),
    setChat: async (next) => { state.db.characters[state.charIndex].chats[state.chatIndex] = structuredClone(next); },
    getChatFromIndex: async (cIdx, chIdx) => structuredClone(state.db.characters[cIdx]?.chats?.[chIdx]),
    setChatToIndex: async (cIdx, chIdx, next) => { state.db.characters[cIdx].chats[chIdx] = structuredClone(next); },
  };

  return { state, api, adapter: new HostAdapter(api) };
}

test('v1.1.2 list_items & read_item accept plural/shorthand kind aliases, resolve cross-character indices, and give helpful errors', async () => {
  const { adapter } = makeCrossCharFixture();

  // Plural "characters" works just like "character"
  const chars = await executeReadTool(adapter, {
    tool: 'list_items',
    args: { kind: 'characters', query: '챗챈중고' },
  });
  assert.equal(chars.ok, true);
  assert.equal(chars.result.kind, 'character');
  assert.equal(chars.result.total, 1);
  assert.equal(chars.result.items[0].charIndex, 1);
  assert.equal(chars.result.items[0].name, '챗챈중고');

  // Other plural/shorthand aliases
  const lorePlural = await executeReadTool(adapter, {
    tool: 'list_items',
    args: { kind: 'lorebooks', charIndex: 1, query: '민호연' },
  });
  assert.equal(lorePlural.ok, true);
  assert.equal(lorePlural.result.charIndex, 1);
  assert.equal(lorePlural.result.charName, '챗챈중고');
  assert.equal(lorePlural.result.total, 1);
  assert.equal(lorePlural.result.items[0].index, 28);

  // targetCharIndex / sourceCharIndex aliases work across list_items, search_workspace, and read_item
  const loreViaSource = await executeReadTool(adapter, {
    tool: 'list_items',
    args: { kind: 'lore', sourceCharIndex: 1, query: '민호연' },
  });
  assert.equal(loreViaSource.ok, true);
  assert.equal(loreViaSource.result.items[0].comment, '민호연');

  const regexPlural = await executeReadTool(adapter, {
    tool: 'list_items',
    args: { kind: 'regexes', targetCharIndex: 1 },
  });
  assert.equal(regexPlural.ok, true);
  assert.equal(regexPlural.result.charIndex, 1);
  assert.equal(regexPlural.result.charName, '챗챈중고');
  assert.equal(regexPlural.result.items[0].comment, '학교 상태창');

  const chatsPlural = await executeReadTool(adapter, {
    tool: 'list_items',
    args: { kind: 'chats', charIndex: 1 },
  });
  assert.equal(chatsPlural.ok, true);
  assert.equal(chatsPlural.result.charIndex, 1);
  assert.equal(chatsPlural.result.items[0].name, '챗챈중고 1번');

  const personasPlural = await executeReadTool(adapter, {
    tool: 'list_items',
    args: { kind: 'personas' },
  });
  assert.equal(personasPlural.ok, true);
  assert.equal(personasPlural.result.total, 1);

  const modulesPlural = await executeReadTool(adapter, {
    tool: 'list_items',
    args: { kind: 'modules' },
  });
  assert.equal(modulesPlural.ok, true);
  assert.equal(modulesPlural.result.total, 1);

  // search_workspace & read_item with charIndex / sourceCharIndex
  const searchOther = await executeReadTool(adapter, {
    tool: 'search_workspace',
    args: { query: '민호연', sourceCharIndex: 1 },
  });
  assert.equal(searchOther.ok, true);
  assert.ok(searchOther.result.totalMatches >= 1);
  assert.equal(searchOther.result.matches[0].charIndex, 1);
  assert.equal(searchOther.result.matches[0].loreIndex, 28);

  const readOther = await executeReadTool(adapter, {
    tool: 'read_item',
    args: { kind: 'lorebooks', charIndex: 1, loreIndex: 28 },
  });
  assert.equal(readOther.ok, true);
  assert.equal(readOther.result.comment, '민호연');
  assert.match(readOther.result.content, /학생회장/);

  // Invalid kind reports allowed kinds explicitly
  const badList = await executeReadTool(adapter, {
    tool: 'list_items',
    args: { kind: 'unknown_thing' },
  });
  assert.equal(badList.ok, false);
  assert.match(badList.result.error, /character/);
  assert.match(badList.result.error, /lorebook/);

  const badRead = await executeReadTool(adapter, {
    tool: 'read_item',
    args: { kind: 'unknown_thing' },
  });
  assert.equal(badRead.ok, false);
  assert.match(badRead.result.error, /lorebook/);
  assert.match(badRead.result.error, /char_field/);
});

test('v1.1.2 tool catalog & char_create_port skill advertise list_items kinds and charIndex?', () => {
  const catalog = formatReadToolCatalog();
  assert.match(catalog, /list_items\(kind:character\|lorebook\|regex\|persona\|module\|chat,charIndex\?/);
  assert.match(catalog, /search_workspace\(query,scope\?,charIndex\?,useRegex\?\)/);
  assert.match(catalog, /read_item\(kind,field\|loreIndex,charIndex\?/);
  assert.match(catalog, /read_chat\(charIndex\?,chatIndex\?/);
  assert.match(catalog, /read_vars\(charIndex\?,chatIndex\?/);

  const pack = buildSkillPromptSections({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    userInput: '챗챈중고 라는 캐릭터에서 민호연이 있나 찾아보는거야',
  });
  assert.ok(pack.activeSkillIds.includes('char_create_port'));
  assert.ok(pack.rules.some(r => r.includes('list_items(kind:"character",query)')));

  const msgs = buildConversationMessages({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    userInput: '챗챈중고 라는 캐릭터에서 민호연이 있나 찾아보는거야',
    enableTools: true,
  });
  assert.match(msgs[0].content, /list_items\(kind:character\|lorebook/);
});

test('v1.1.2 wantsCharacterCatalog matches natural cross-character phrasing without false positives on current-character edits', () => {
  const positives = [
    '챗챈중고 라는 캐릭터에서 민호연이 있나 찾아보는거야',
    '챗챈중고라는 캐릭터에서 민호연 찾아줘',
    '챗챈중고 캐릭터에서 민호연 있어?',
    '비밀동아리실 봇에서 조이경 로어북 가져와 줘',
    '카엘 캐릭터의 로어북 확인해 줘',
    '카엘 캐릭터에 있는 화염 마법 보여줘',
    '다른 봇에서 정규식 가져와 줘',
    '타 캐릭터에서 Lua 이식해 줘',
    '2번 캐릭터에서 로어북 확인해 줘',
    '다른 캐릭터 목록 보여줘',
  ];
  for (const text of positives) {
    assert.equal(wantsCharacterCatalog(text), true, `expected true for: "${text}"`);
    const skills = selectSkills({
      context: { screen: 'chat', targetKind: 'general', freeTalk: true },
      userInput: text,
    });
    assert.ok(skills.includes('char_create_port'), `expected char_create_port active for: "${text}"`);
  }

  const negatives = [
    '캐릭터 설명에서 머리 색깔을 검은색으로 바꿔 줘',
    '현재 캐릭터에서 로어북 찾아줘',
    '이 캐릭터에서 변수 확인해 줘',
    '지금 열려 있는 캐릭터에서 로어북 수정해 줘',
    '로어북을 캐릭터에서 삭제해 줘',
    '에셋을 캐릭터에서 지워 줘',
    '캐릭터에 SVG 배지 에셋 등록해 줘',
    '기존 저장된 에셋 ID를 캐릭터에 연결해 줘',
    '내 캐릭터 프로필 만들어 줘',
    '로어북 설정 지금 캐릭터꺼 어떻게 돼 있어?',
    '수정하고 캐릭터 로어북 확인해 줘',
    '캐릭터에서 로어북 하나 만들어 줘',
  ];
  for (const text of negatives) {
    assert.equal(wantsCharacterCatalog(text), false, `expected false for: "${text}"`);
  }
});

test('v1.1.2 bundled UI E2E: natural query loads characterCatalog, runs plural list_items + cross-char search_workspace, and ports lorebook #29', async () => {
  const fix = makeCrossCharFixture();
  const capturedPrompts = [];
  let callNum = 0;

  const ui = await bootBundle({
    state: fix.state,
    extraApi: fix.api,
    runLLMModel: async (req) => {
      callNum++;
      capturedPrompts.push(req.messages[0].content);
      if (callNum === 1) {
        // Model calls plural `characters` + searches charIndex 1 beyond first 25 loreNames
        return '```risuhelper-tool\n' + JSON.stringify([
          { tool: 'list_items', args: { kind: 'characters', query: '챗챈중고' } },
          { tool: 'search_workspace', args: { query: '민호연', charIndex: 1 } },
        ]) + '\n```';
      }
      const toolMsg = req.messages[req.messages.length - 1].content;
      assert.match(toolMsg, /"charIndex": 1/);
      assert.match(toolMsg, /"loreIndex": 28/);
      assert.match(toolMsg, /학생회장/);
      return '챗챈중고 캐릭터 로어북 #29에서 민호연을 찾았습니다. 현재 캐릭터로 포팅할 수 있습니다.\n' + proposalBlock({
        action: 'port_from_character',
        title: '챗챈중고에서 민호연 로어북 포팅',
        sourceCharIndex: 1,
        items: ['lorebook'],
        loreIndices: [28],
      });
    },
  });

  await ui.send('챗챈중고 라는 캐릭터에서 민호연이 있나 찾아보는거야');

  assert.equal(callNum, 2);
  assert.match(capturedPrompts[0], /\[다른 캐릭터 목록/, 'natural phrasing must auto-load [다른 캐릭터 목록]');
  assert.match(capturedPrompts[0], /"action":"port_from_character"/, 'char_create_port schema must be active');
  assert.match(capturedPrompts[0], /list_items\(kind:character\|lorebook/, 'tool catalog must expose list_items kinds');

  // Apply the port_from_character proposal and confirm "민호연" was copied into the active character
  await ui.click('적용');
  const activeLores = fix.state.db.characters[0].globalLore;
  assert.ok(activeLores.some(l => l.comment === '민호연' && /학생회장/.test(l.content)), '민호연 lorebook should be ported to active character');
});

test('v1.1.2 load_skill supports action names, hyphen/case normalization, Korean query search, catalog listing, and strict capability gating', async () => {
  const { adapter } = makeCrossCharFixture();
  const caps = {
    getFetchLogs: false,
    colorScheme: true,
    bardWiki: false,
    risunestPatch: false,
  };

  // Action name resolves owner skill and includes [권장 읽기 도구]
  const byAction = loadSkillPack(['port_from_character'], caps);
  assert.equal(byAction.ok, true);
  assert.deepEqual(byAction.loaded, ['char_create_port']);
  assert.match(byAction.text, /\[권장 읽기 도구\]/);
  assert.match(byAction.text, /search_workspace/);

  // Case + hyphen normalization
  const byHyphen = loadSkillPack(['CHAR-CREATE-PORT'], caps);
  assert.equal(byHyphen.ok, true);
  assert.deepEqual(byHyphen.loaded, ['char_create_port']);

  // Natural-language Korean query search
  const byQuery = await executeReadTool(adapter, {
    tool: 'load_skill',
    args: { query: '장기 기억 메모리 요약' },
  });
  assert.equal(byQuery.ok, true);
  assert.ok(byQuery.result.loaded.includes('chat_advanced'));
  assert.match(byQuery.result.text, /update_memory/);

  // Fuzzy label inside skillIds array
  const byKoreanId = loadSkillPack(['다크 모드'], caps);
  assert.equal(byKoreanId.ok, true);
  assert.ok(byKoreanId.loaded.includes('theme_hud'));

  // Empty load_skill({}) lists available supported catalog
  const catalogCall = await executeReadTool(adapter, {
    tool: 'load_skill',
    args: {},
  });
  assert.equal(catalogCall.ok, true);
  assert.equal(catalogCall.result.catalogListed, true);
  assert.match(catalogCall.result.text, /\[사용 가능한 내장 스킬 목록\]/);
  assert.ok(catalogCall.result.availableSkills.some(s => s.id === 'char_create_port'));

  // Unknown query returns availableSkills fallback strictly respecting capability gates
  const unknown = loadSkillPack(['zzzz_nonexistent_skill'], caps);
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.unknown, ['zzzz_nonexistent_skill']);
  assert.ok(Array.isArray(unknown.availableSkills) && unknown.availableSkills.length > 0);
  assert.ok(!unknown.availableSkills.some(s => s.id === 'bard_wiki' || s.id === 'fetch_logs'));

  // Capability gate strictly blocks unsupported skill IDs & action names
  const blockedId = loadSkillPack(['fetch_logs'], caps);
  assert.equal(blockedId.ok, false);
  assert.deepEqual(blockedId.unsupported, ['fetch_logs']);

  const blockedAction = loadSkillPack(['manage_bard_wiki'], caps);
  assert.equal(blockedAction.ok, false);
  assert.deepEqual(blockedAction.unsupported, ['bard_wiki']);
});

test('v1.1.2 auto-repair injects missing owner skill schema when model guesses an unloaded action', async () => {
  const { adapter, api } = makeCrossCharFixture();
  const seenPrompts = [];
  let calls = 0;

  const loopRes = await runAgentLoop({
    api,
    adapter,
    initialMessages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '메모리에 요약 한 줄 추가해 줘' },
    ],
    maxCalls: 3,
    callModel: async (_api, messages) => {
      calls++;
      seenPrompts.push(messages[messages.length - 1].content);
      if (calls === 1) {
        // Malformed update_memory proposal (invalid memoryType triggers validation failure)
        return proposalBlock({
          action: 'update_memory',
          title: '메모리 추가',
          memoryType: 'longterm',
          text: '민호연과 첫 만남',
        });
      }
      // Call 2 should receive chat_advanced's schema automatically!
      return proposalBlock({
        action: 'update_memory',
        title: 'Supa 메모리 설정',
        memoryType: 'supa',
        operation: 'set',
        text: '민호연과 첫 만남',
      });
    },
  });

  assert.equal(calls, 2);
  assert.match(seenPrompts[1], /"action":"update_memory"/, 'auto-repair must inject owner skill schema');
  assert.ok(loopRes.loadedSkillIds.includes('chat_advanced'));
  assert.equal(loopRes.previewedProposals.length, 1);
  assert.equal(loopRes.previewedProposals[0].preview.ok, true);
});

test('v1.1.2 multi-turn L2 skill continuity carries over loopMeta.loadedSkillIds and refreshes characterCatalog on Turn 2', async () => {
  // Unit check for extractRecentAssistantSkillIds
  const carried = extractRecentAssistantSkillIds([
    { role: 'user', content: '잠깐 확인 좀' },
    { role: 'assistant', content: '어느 캐릭터인가요?', loopMeta: { loadedSkillIds: ['char_create_port', 'core_text'] } },
  ]);
  assert.equal(carried.has('char_create_port'), true);
  assert.equal(carried.has('core_text'), false, 'focus-only core_text must not carry over');

  // Bundled UI E2E: Turn 1 has neutral wording -> loads char_create_port via load_skill -> asks question;
  // Turn 2 has neutral follow-up -> automatically gets [다른 캐릭터 목록] and port_from_character schema!
  const fix = makeCrossCharFixture();
  const promptsByCall = [];
  let turnCalls = 0;
  const ui = await bootBundle({
    state: fix.state,
    extraApi: fix.api,
    runLLMModel: async (req) => {
      turnCalls++;
      promptsByCall.push(req.messages[0].content);
      if (turnCalls === 1) {
        return '```risuhelper-tool\n[{"tool":"load_skill","args":{"query":"포팅"}}]\n```';
      }
      if (turnCalls === 2) {
        return '어느 항목을 가져올까요?';
      }
      return proposalBlock({
        action: 'port_from_character',
        title: '챗챈중고 민호연 포팅',
        sourceCharIndex: 1,
        items: ['lorebook'],
        loreIndices: [28],
      });
    },
  });

  await ui.send('예전에 쓰던 항목 좀 확인해 볼게');
  assert.equal(turnCalls, 2);

  await ui.send('응 2번 거로 해 줘');
  assert.equal(turnCalls, 3);
  assert.match(promptsByCall[2], /\[다른 캐릭터 목록/, 'Turn 2 must auto-load characterCatalog from Turn 1 loadedSkillIds');
  assert.match(promptsByCall[2], /"action":"port_from_character"/, 'Turn 2 must keep char_create_port active');
});

test('v1.1.2 broadened Korean triggers & fixed Hangul boundaries match everyday RisuAI phrasing across skills', () => {
  const ctx = { screen: 'chat', targetKind: 'general', freeTalk: true };
  const caps = { colorScheme: true, getFetchLogs: true, bardWiki: true, risunestPatch: true };
  const cases = [
    ['로어를 하나 추가해 줘', 'lorebook'],
    ['페르에 이름이랑 성별 적어 줘', 'persona'],
    ['퍼메 문체 좀 다듬어 줘', 'greetings'],
    ['시프에 금지 규칙 넣어 줘', 'char_fields'],
    ['글노 내용 수정해 줘', 'char_fields'],
    ['다크 모드로 바꿔 줘', 'theme_hud'],
    ['장기 기억 요약 한 줄 추가해 줘', 'chat_advanced'],
    ['단체 채팅 발언 순서 켜 줘', 'group_onboarding'],
    ['건강 검진 한 번 돌려 줘', 'assets_repair'],
    ['신뢰도 80으로 올려 줘', 'chat_vars'],
    ['새 방 하나 파서 이어서 하자', 'chat_migration'],
    ['사고 과정 숨기게 정규식 짜 줘', 'scripts'],
  ];

  for (const [text, expected] of cases) {
    const active = selectSkills({ context: ctx, userInput: text, capabilities: caps });
    assert.ok(active.includes(expected), `expected skill "${expected}" for "${text}", got [${active.join(', ')}]`);
  }

  // Hangul boundary guard: "플로어" / "팔로어" must NOT trigger lorebook
  const floorSkills = selectSkills({ context: ctx, userInput: '2층 플로어에서 팔로어들이 기다린다', capabilities: caps });
  assert.ok(!floorSkills.includes('lorebook'), '플로어/팔로어 must not falsely trigger lorebook');

  // fields.js & greetings.js shorthand sync
  assert.ok(mentionedFields('시프랑 글노, 뎁스 프롬프트 다듬어 줘').includes('systemPrompt'));
  assert.ok(mentionedFields('시프랑 글노, 뎁스 프롬프트 다듬어 줘').includes('replaceGlobalNote'));
  assert.ok(mentionedFields('시프랑 글노, 뎁스 프롬프트 다듬어 줘').includes('depthPrompt'));
  assert.equal(wantsGreetingText({ screen: 'character', targetKind: 'char_field', fieldKey: 'desc' }, '퍼메 좀 고쳐 줘'), true);
});

