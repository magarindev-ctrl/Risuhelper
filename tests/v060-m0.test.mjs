import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HOST_PROFILES,
  isCatchAllProxyApi,
  probeHostCapabilities,
  detectHostFlavorSync,
} from '../src/host-capabilities.js';
import { HostAdapter } from '../src/host-adapter.js';
import {
  validateProposal,
  parseAssistantReply,
  shouldIncludeGhostwriteContext,
  buildConversationMessages,
  findUnknownProposalKeys,
} from '../src/llm.js';
import { buildSkillPromptSections } from '../src/skills.js';
import { COLD_STORAGE_HEADER } from '../src/chat-transfer.js';
import { DEFAULT_GHOSTWRITE_CHAT_CHARS, DEFAULT_GHOSTWRITE_MAX_MESSAGES } from '../src/version.js';

function makeProxyApi(handlers = {}) {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      if (Object.hasOwn(handlers, prop)) return handlers[prop];
      return async () => { throw new Error(`Method ${String(prop)} not found`); };
    },
  });
}

function makeTitleDoc(title) {
  return {
    async querySelector(sel) {
      if (sel !== 'title') return null;
      return { async textContent() { return title; } };
    },
  };
}

function createMultiCharHost({ risunest = false } = {}) {
  const dbReads = [];
  const state = {
    charIndex: 0,
    chatIndex: 0,
    characters: [
      {
        type: 'character',
        chaId: 'char-0-aria',
        name: '아리아',
        desc: '주인공 캐릭터 설명',
        firstMessage: '안녕하세요.',
        alternateGreetings: ['비 오는 날의 인사'],
        globalLore: [
          { comment: '왕국 설정', key: '왕국', secondkey: '', content: '북부 왕국', insertorder: 100, mode: 'normal', alwaysActive: false, selective: false, useRegex: false },
        ],
        customscript: [],
        triggerscript: [],
        tags: ['판타지'],
        chats: [
          {
            id: 'aria-chat-0',
            name: '1부 모험',
            note: '차분한 판타지 문체',
            fmIndex: -1,
            scriptstate: { $hp: 85, $gold: 120 },
            localLore: [
              { comment: '여관 메모', key: '여관', secondkey: '', content: '별빛 여관', insertorder: 100, mode: 'normal', alwaysActive: false, selective: false, useRegex: false },
            ],
            message: [
              { role: 'user', data: '검은 숲으로 출발하자.', chatId: 'm1' },
              { role: 'char', data: '안개 낀 검은 숲에서 은빛 늑대와 조우했다.', chatId: 'm2' },
            ],
          },
          {
            id: 'aria-chat-1',
            name: '2부 여정',
            note: '2부 기존 노트',
            fmIndex: -1,
            scriptstate: { $hp: 50 },
            localLore: [],
            message: [{ role: 'char', data: '2부가 시작됐다.', chatId: 'm3' }],
          },
          {
            id: 'aria-chat-placeholder',
            name: '미열람 3부',
            _placeholder: true,
            note: '',
            localLore: [],
            message: [],
          },
        ],
        chatPage: 0,
      },
      {
        type: 'character',
        chaId: 'char-1-kael',
        name: '마법사 카엘',
        desc: '화염 마법사 설명',
        firstMessage: '불꽃이 타오른다.',
        alternateGreetings: ['실험실 인사'],
        globalLore: [
          { comment: '화염 마법 체계', key: '화염', secondkey: '', content: '마나를 연소한다.', insertorder: 100, mode: 'normal', alwaysActive: false, selective: false, useRegex: false },
        ],
        customscript: [
          { comment: '화염 효과', in: '\\*불꽃\\*', out: '🔥', type: 'editdisplay', flag: 'g', ableFlag: true },
        ],
        triggerscript: [],
        tags: ['마법사'],
        chats: [
          {
            id: 'kael-chat-0',
            name: '카엘 1부',
            note: '카엘 1부 노트',
            fmIndex: -1,
            scriptstate: { $mana: 100 },
            localLore: [],
            message: [],
          },
          {
            id: 'kael-chat-1',
            name: '2부',
            note: '카엘 2부 노트',
            fmIndex: -1,
            scriptstate: { $mana: 40 },
            localLore: [],
            message: [],
          },
        ],
        chatPage: 0,
      },
    ],
    db: {
      personas: [{ id: 'p-1', name: '모험가', note: '', personaPrompt: '용감한 모험가' }],
      selectedPersona: 0,
      modules: [{ id: 'm-1', name: 'HUD', lorebook: [], regex: [], trigger: [] }],
      enabledModules: [],
      characterOrder: ['char-0-aria', 'char-1-kael'],
    },
  };

  const api = {
    async getCurrentCharacterIndex() { return state.charIndex; },
    async getCurrentChatIndex() { return state.chatIndex; },
    async getCharacter() { return structuredClone(state.characters[state.charIndex]); },
    async setCharacter(next) { state.characters[state.charIndex] = structuredClone(next); },
    async getCharacterFromIndex(idx) {
      return state.characters[idx] ? structuredClone(state.characters[idx]) : null;
    },
    async setCharacterToIndex(idx, next) {
      if (!state.characters[idx]) throw new Error('char out of bounds');
      state.characters[idx] = structuredClone(next);
    },
    async getChatFromIndex(cIdx, chIdx) {
      const ch = state.characters[cIdx]?.chats?.[chIdx];
      return ch ? structuredClone(ch) : null;
    },
    async setChatToIndex(cIdx, chIdx, next) {
      if (!state.characters[cIdx]?.chats?.[chIdx]) throw new Error('chat out of bounds');
      state.characters[cIdx].chats[chIdx] = structuredClone(next);
    },
    async getDatabase(keys) {
      dbReads.push([...keys]);
      const out = {};
      for (const k of keys) {
        if (k === 'characters') out.characters = structuredClone(state.characters);
        else if (Object.hasOwn(state.db, k)) out[k] = structuredClone(state.db[k]);
      }
      return out;
    },
    async setDatabase(partial) {
      for (const [k, v] of Object.entries(partial)) {
        if (k === 'characters') state.characters = structuredClone(v);
        else state.db[k] = structuredClone(v);
      }
    },
    ...(risunest ? {
      async getRuntimeInfo() {
        return { app: { id: 'risunest', version: '2.0.0' }, apiVersion: '3.0', platform: 'web' };
      },
      async queryCharacters({ limit = 60 } = {}) {
        return {
          items: state.characters.slice(0, limit).map((c, index) => ({
            index,
            chaId: c.chaId,
            name: c.name,
            type: c.type,
          })),
        };
      },
    } : {}),
  };

  const adapter = new HostAdapter(api);
  return { state, api, adapter, dbReads };
}

test('probeHostCapabilities identifies RisuNest on catch-all Proxy via getRuntimeInfo without mainDom', async () => {
  const proxyApi = makeProxyApi({
    async getRuntimeInfo() {
      return { app: { id: 'risunest', version: '1.9.0' }, apiVersion: '3.0', platform: 'web' };
    },
  });
  assert.equal(isCatchAllProxyApi(proxyApi), true);

  const info = await probeHostCapabilities(proxyApi, null);
  assert.equal(info.name, 'RisuNest');
  assert.equal(info.activePersonaAutoSyncs, true);
  assert.equal(info.syncLiteCharError, true);
  assert.equal(info.capabilities.risunestQuery, true);
  assert.equal(info.capabilities.createInlay, false);
  assert.equal(info.capabilities.getCharacterFromIndex, true);
  assert.equal(info.runtime?.app?.id, 'risunest');
});

test('probeHostCapabilities distinguishes upstream RisuAI vs PocketRisu, RisuBard, Haejeok, and Hardened', async () => {
  const proxyNoRuntime = makeProxyApi();

  const upstream = await probeHostCapabilities(proxyNoRuntime, makeTitleDoc('RisuAI'));
  assert.equal(upstream.name, 'RisuAI');
  assert.equal(upstream.capabilities.createInlay, true, 'only upstream RisuAI supports createInlay');
  assert.equal(upstream.capabilities.bardWiki, false);

  const pocket = await probeHostCapabilities(proxyNoRuntime, makeTitleDoc('PocketRisu'));
  assert.equal(pocket.name, 'PocketRisu');
  assert.equal(pocket.capabilities.createInlay, false);
  assert.equal(pocket.capabilities.lazyChats, true);

  const bard = await probeHostCapabilities(proxyNoRuntime, makeTitleDoc('RisuBard'));
  assert.equal(bard.name, 'RisuBard');
  assert.equal(bard.capabilities.bardWiki, true);
  assert.equal(bard.capabilities.createInlay, false);

  const haejeok = await probeHostCapabilities(proxyNoRuntime, makeTitleDoc('해적 RisuAI'));
  assert.equal(haejeok.name, 'HaejeokRisuai');
  assert.equal(haejeok.activePersonaAutoSyncs, true);
  assert.equal(haejeok.capabilities.createInlay, false);

  // Non-Proxy Hardened mock: core DB/character APIs exist, modern LLM/CBS/sendChat absent
  const hardenedApi = {
    getCharacter: async () => null,
    getCharacterFromIndex: async () => null,
    getDatabase: async () => ({}),
  };
  const hardened = await probeHostCapabilities(hardenedApi, null);
  assert.equal(hardened.name, 'RisuAI-Hardened');
  assert.equal(hardened.capabilities.getCharacterFromIndex, true);
  assert.equal(hardened.capabilities.runLLMModel, false);
  assert.equal(hardened.capabilities.sendChat, false);
  assert.equal(hardened.capabilities.parseRisuChat, false);

  assert.ok(HOST_PROFILES.RisuAI && HOST_PROFILES.PocketRisu && HOST_PROFILES.RisuBard);
  assert.equal(detectHostFlavorSync(hardenedApi).name, 'RisuAI-Hardened');
});

test('chat_input caps transcript to compact sliding window (<=12 msgs, <=10K chars) and omits transcript on non-ghostwriting Q&A', async () => {
  const { state, adapter } = createMultiCharHost();
  const chat = state.characters[0].chats[0];
  chat.message = [];
  for (let i = 1; i <= 50; i++) {
    chat.message.push({
      role: i % 2 === 0 ? 'char' : 'user',
      data: `[메시지 ${i}] ` + '가'.repeat(900),
      chatId: `msg-${i}`,
    });
  }
  chat.hypaV3Data = { summaries: [{ text: '앞부분 요약: 검은 숲에서 늑대와 동행했다.' }] };

  const snap = await adapter.readTargetSnapshot({ targetKind: 'chat_input' });
  assert.equal(snap.ok, true);
  assert.ok(snap.chatContext.transcript.length <= DEFAULT_GHOSTWRITE_MAX_MESSAGES);
  assert.ok(snap.chatContext.transcriptChars <= DEFAULT_GHOSTWRITE_CHAT_CHARS);
  assert.ok(snap.chatContext.omittedMessages > 0);
  assert.equal(snap.chatContext.memorySummaries.length, 1);

  // Q&A typed while cursor happens to sit in chat_input omits chat transcript
  assert.equal(shouldIncludeGhostwriteContext('로어북이 뭔지 알려줘'), false);
  assert.equal(shouldIncludeGhostwriteContext('온도 설정 0.8로 바꿔줘'), false);
  assert.equal(shouldIncludeGhostwriteContext('다음 대사 대필해줘'), true);
  assert.equal(shouldIncludeGhostwriteContext('지금 상황에 맞게 부드러운 선택지 2개 추천해줘'), true);

  const qaMessages = buildConversationMessages({
    context: { screen: 'chat', targetKind: 'chat_input', labelText: '채팅 입력창' },
    snapshot: snap,
    extraContext: {},
    history: [],
    userInput: '로어북이 뭔지 알려줘',
  });
  assert.doesNotMatch(qaMessages[0].content, /\[현재 채팅 대화 흐름/);
  assert.doesNotMatch(qaMessages[0].content, /\[메시지 50\]/);
  assert.ok(qaMessages[0].content.length < 15000, `expected lean prompt on Q&A, got ${qaMessages[0].content.length} chars`);

  const ghostMessages = buildConversationMessages({
    context: { screen: 'chat', targetKind: 'chat_input', labelText: '채팅 입력창' },
    snapshot: snap,
    extraContext: {},
    history: [],
    userInput: '다음 대사 대필해줘',
  });
  assert.match(ghostMessages[0].content, /\[현재 채팅 대화 흐름/);
  assert.match(ghostMessages[0].content, /\[메시지 50\]/);
  assert.doesNotMatch(ghostMessages[0].content, /\[메시지 1\]/);
});

test('borderless targetCharIndex edits another character and undoes cleanly without switching active character', async () => {
  const { state, adapter } = createMultiCharHost();
  const proposal = {
    action: 'create_lorebook',
    scope: 'character',
    targetCharIndex: 1,
    comment: '빙결 마법',
    key: '얼음,빙결',
    content: '화염과 상극인 빙결 마법 체계.',
  };
  assert.equal(validateProposal(proposal), null);
  assert.deepEqual(findUnknownProposalKeys(proposal), []);

  const preview = await adapter.previewProposal(proposal, { targetKind: 'general' });
  assert.equal(preview.ok, true);
  assert.match(preview.label, /마법사 카엘|빙결 마법/);
  assert.equal(preview.hostBinding.crossCharacter, true);
  assert.equal(preview.hostBinding.charIndex, 1);
  assert.equal(preview.hostBinding.charId, 'char-1-kael');

  const applied = await adapter.applyProposal(proposal, preview.target, { hostBinding: preview.hostBinding });
  assert.equal(applied.ok, true);
  assert.equal(state.characters[0].globalLore.length, 1, 'active character Aria is untouched');
  assert.equal(state.characters[1].globalLore.length, 2, 'target character Kael received the new lorebook');
  assert.equal(state.characters[1].globalLore[1].comment, '빙결 마법');

  // Borderless Undo works while Aria (char 0) is still the active character
  const undone = await adapter.undo(applied.undoId);
  assert.equal(undone.ok, true);
  assert.equal(state.characters[1].globalLore.length, 1);
  assert.equal(state.characters[0].globalLore.length, 1);
});

test('borderless targetCharIndex + targetChatIndex edits another character chat vars & authorNote and undoes cleanly', async () => {
  const { state, adapter } = createMultiCharHost();

  // 1. Cross-character + cross-chat variable edit (Kael's Chat #2)
  const varProposal = {
    action: 'update_chat_vars',
    targetCharIndex: 1,
    targetChatIndex: 1,
    set: { mana: '99', shield: 'on' },
  };
  const vPreview = await adapter.previewProposal(varProposal, { targetKind: 'general' });
  assert.equal(vPreview.ok, true);
  assert.match(vPreview.label, /다른 캐릭터: 마법사 카엘 · 채팅: 2부/);
  assert.equal(vPreview.hostBinding.crossCharacter, true);
  assert.equal(vPreview.hostBinding.crossChat, true);

  const vApplied = await adapter.applyProposal(varProposal, vPreview.target, { hostBinding: vPreview.hostBinding });
  assert.equal(vApplied.ok, true);
  assert.equal(state.characters[1].chats[1].scriptstate.$mana, '99');
  assert.equal(state.characters[1].chats[1].scriptstate.$shield, 'on');
  assert.equal(state.characters[1].chats[0].scriptstate.$mana, 100, 'Kael chat 0 untouched');
  assert.equal(state.characters[0].chats[0].scriptstate.$hp, 85, 'active char Aria untouched');

  await adapter.undo(vApplied.undoId);
  assert.equal(state.characters[1].chats[1].scriptstate.$mana, 40);
  assert.equal(state.characters[1].chats[1].scriptstate.$shield, undefined);

  // 2. Same character, different chat authorNote edit (Aria's Chat #2)
  const noteProposal = {
    action: 'update_field',
    field: 'authorNote',
    targetChatIndex: 1,
    edits: [{ before: '2부 기존 노트', after: '2부 수정된 노트' }],
  };
  const nPreview = await adapter.previewProposal(noteProposal, { targetKind: 'general' });
  assert.equal(nPreview.ok, true);
  assert.match(nPreview.label, /다른 채팅: 2부 여정/);
  const nApplied = await adapter.applyProposal(noteProposal, nPreview.target, { hostBinding: nPreview.hostBinding });
  assert.equal(nApplied.ok, true);
  assert.equal(state.characters[0].chats[1].note, '2부 수정된 노트');
  assert.equal(state.characters[0].chats[0].note, '차분한 판타지 문체');

  await adapter.undo(nApplied.undoId);
  assert.equal(state.characters[0].chats[1].note, '2부 기존 노트');
});

test('patch_text/replace_text blocks targetCharIndex/targetChatIndex redirection (prompt injection defense)', async () => {
  const { adapter } = createMultiCharHost();
  const activeTarget = { targetKind: 'char_field', fieldKey: 'desc' };

  const injected = {
    action: 'replace_text',
    targetCharIndex: 1,
    content: 'hijacked',
  };
  const prev = await adapter.previewProposal(injected, activeTarget);
  assert.equal(prev.ok, false);
  assert.match(prev.error, /보안상/);

  await assert.rejects(() => adapter.applyProposal(injected, activeTarget), /보안상/);

  // Out-of-bounds targetCharIndex fails loudly
  const oob = { action: 'update_char_settings', targetCharIndex: 99, addTags: ['테스트'] };
  const oobPrev = await adapter.previewProposal(oob, { targetKind: 'general' });
  assert.equal(oobPrev.ok, false);
  assert.match(oobPrev.error, /찾을 수 없습니다/);
});

test('port_from_character uses getCharacterFromIndex fast path and RisuNest readCharacterCatalog uses queryCharacters without full db.characters reads', async () => {
  const { state, adapter, dbReads } = createMultiCharHost({ risunest: true });
  await adapter.probeHostFlavor(null);
  assert.equal(adapter.detectHostFlavor().name, 'RisuNest');
  assert.equal(adapter.hasCapability('risunestQuery'), true);

  // 1. RisuNest queryCharacters catalog avoids getDatabase(['characters'])
  const cat = await adapter.readCharacterCatalog();
  assert.equal(cat.usedQueryCharacters, true);
  assert.equal(cat.catalog.length, 2);
  assert.equal(cat.catalog[1].name, '마법사 카엘');
  assert.equal(dbReads.some(keys => keys.includes('characters')), false, 'queryCharacters must not read db.characters');

  // 2. port_from_character preview + apply uses getCharacterFromIndex without getDatabase(['characters'])
  const portProposal = {
    action: 'port_from_character',
    sourceCharIndex: 1,
    items: ['lorebook', 'regex'],
  };
  const preview = await adapter.previewProposal(portProposal, { targetKind: 'general' });
  assert.equal(preview.ok, true);
  const applied = await adapter.applyProposal(portProposal, preview.target, { hostBinding: preview.hostBinding });
  assert.equal(applied.ok, true);
  assert.equal(state.characters[0].globalLore.some(e => e.comment === '화염 마법 체계'), true);
  assert.equal(state.characters[0].customscript.some(r => r.comment === '화염 효과'), true);
  assert.equal(dbReads.some(keys => keys.includes('characters')), false, 'port_from_character must not read db.characters');
});

test('create_chat creates fork-safe chat with UUID id and one-click migration + summaryLorebook, with surgical Undo', async () => {
  const { state, adapter } = createMultiCharHost();
  const initialCount = state.characters[0].chats.length; // 3 (including PocketRisu _placeholder)

  // Verify skill routing activates chat_migration & create_chat
  const skillPack = buildSkillPromptSections({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    snapshot: { target: { targetKind: 'general' }, content: '' },
    userInput: '현재 채팅 요약해서 새 채팅으로 한 번에 이사해줘',
  });
  assert.ok(skillPack.activeSkillIds.includes('chat_migration'));
  assert.ok(skillPack.activeActions.includes('create_chat'));

  // Parse + validate create_chat proposal
  const rawReply = [
    '현재 채팅을 요약해 새 채팅 "시즌 2"로 한 번에 이사합니다.',
    '```risuhelper-proposal',
    JSON.stringify({
      action: 'create_chat',
      title: '시즌 2 생성 + 원클릭 이사',
      name: '시즌 2',
      switchToNewChat: true,
      importFromChatIndex: 'current',
      importItems: ['variables', 'authorNote', 'localLore'],
      summaryLorebook: {
        comment: '1부 핵심 요약',
        content: '검은 숲에서 은빛 늑대와 동행하기로 약속했다.',
        alwaysActive: true,
        insertorder: 100,
      },
    }),
    '```',
  ].join('\n');
  const parsed = parseAssistantReply(rawReply);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.proposals.length, 1);
  const proposal = parsed.proposals[0];
  assert.deepEqual(findUnknownProposalKeys(proposal), []);

  const preview = await adapter.previewProposal(proposal, { targetKind: 'general' });
  assert.equal(preview.ok, true);
  assert.match(preview.after, /1부 핵심 요약/);
  assert.match(preview.after, /은빛 늑대/);

  const applied = await adapter.applyProposal(proposal, preview.target, { hostBinding: preview.hostBinding });
  assert.equal(applied.ok, true);
  assert.equal(state.characters[0].chats.length, initialCount + 1);
  assert.equal(state.characters[0].chatPage, initialCount, 'switched chatPage to the new chat');

  const created = state.characters[0].chats[initialCount];
  assert.equal(typeof created.id, 'string');
  assert.ok(created.id.length > 0, 'new chat must have non-empty UUID id for PocketRisu/RisuNest');
  assert.deepEqual(created.message, [], 'new chat must have empty message array');
  assert.equal(created.name, '시즌 2');
  assert.equal(created.note, '차분한 판타지 문체');
  assert.equal(created.scriptstate.$hp, 85);
  assert.equal(created.scriptstate.$gold, 120);
  assert.equal(created.localLore.length, 2, 'imported localLore + summaryLorebook');
  assert.equal(created.localLore[1].comment, '1부 핵심 요약');
  assert.equal(created.localLore[1].alwaysActive, true);
  // PocketRisu _placeholder untouched
  assert.equal(state.characters[0].chats[2]._placeholder, true);
  // Original chat #1 untouched
  assert.equal(state.characters[0].chats[0].localLore.length, 1);

  // Surgical 1-click Undo removes ONLY the newly created chat and restores chatPage
  const undone = await adapter.undo(applied.undoId);
  assert.equal(undone.ok, true);
  assert.equal(state.characters[0].chats.length, initialCount);
  assert.equal(state.characters[0].chatPage, 0);
  assert.equal(state.characters[0].chats[2]._placeholder, true);
});

test('create_chat blocks migrating from a cold-stored chat with clear guidance', async () => {
  const { state, adapter } = createMultiCharHost();
  state.characters[0].chats[1].message = [{ role: 'char', data: `${COLD_STORAGE_HEADER}uuid-123` }];

  const proposal = {
    action: 'create_chat',
    name: '복원 테스트',
    importFromChatIndex: 1,
    importItems: ['variables'],
  };
  const preview = await adapter.previewProposal(proposal, { targetKind: 'general' });
  assert.equal(preview.ok, false);
  assert.match(preview.error, /콜드 스토리지/);
});
