// SPDX-License-Identifier: GPL-3.0-only
// Declarative host profiles and faithful Plugin API v3 fork simulators for RisuHelper E2E verification.
// Covers upstream RisuAI + 5 public forks tracked in docs/api-coverage.md.

const FORK_HOSTS = {
  risuai: {
    id: 'risuai',
    name: 'RisuAI (원본)',
    repo: 'kwaroran/Risuai',
    defaultUrl: 'http://localhost:5174',
    title: 'RisuAI',
    catchAllProxy: true,
    expectedFlavor: 'upstream',
    supportsLLM: true,
    lazyChatPlaceholders: false,
    rejectsLiteCharacters: false,
    autoSyncPersona: false,
    runtimeInfo: { apiVersion: '3.0', platform: 'web', saveMethod: 'local' },
  },
  pocketrisu: {
    id: 'pocketrisu',
    name: 'PocketRisu',
    repo: 'PocketRisu/PocketRisu',
    defaultUrl: 'http://localhost:5175',
    title: 'PocketRisu',
    catchAllProxy: true,
    expectedFlavor: 'pocketrisu',
    supportsLLM: true,
    lazyChatPlaceholders: true,
    rejectsLiteCharacters: false,
    autoSyncPersona: false,
    runtimeInfo: { apiVersion: '3.0', platform: 'web', saveMethod: 'server' },
  },
  risubard: {
    id: 'risubard',
    name: 'RisuBard',
    repo: 'rpaddict/RisuBard',
    defaultUrl: 'http://localhost:5176',
    title: 'RisuBard',
    catchAllProxy: true,
    expectedFlavor: 'risubard',
    supportsLLM: true,
    lazyChatPlaceholders: true,
    rejectsLiteCharacters: false,
    autoSyncPersona: false,
    runtimeInfo: { apiVersion: '3.0', platform: 'web', saveMethod: 'server' },
  },
  risunest: {
    id: 'risunest',
    name: 'RisuNest',
    repo: 'rsyumi/RisuNest',
    defaultUrl: 'http://localhost:5177',
    title: 'RisuNest',
    catchAllProxy: true,
    expectedFlavor: 'risunest',
    supportsLLM: true,
    lazyChatPlaceholders: false,
    rejectsLiteCharacters: true,
    autoSyncPersona: true,
    runtimeInfo: { apiVersion: '3.0', platform: 'risunest', saveMethod: 'native' },
  },
  haejeok: {
    id: 'haejeok',
    name: 'HaejeokRisuai (해적리스)',
    repo: 'nevaeh5379/HaejeokRisuai',
    defaultUrl: 'http://localhost:5178',
    title: 'HaejeokRisuai',
    catchAllProxy: true,
    expectedFlavor: 'haejeok',
    supportsLLM: true,
    lazyChatPlaceholders: false,
    rejectsLiteCharacters: false,
    autoSyncPersona: true,
    runtimeInfo: { apiVersion: '3.0', platform: 'web', saveMethod: 'sqlite' },
  },
  hardened: {
    id: 'hardened',
    name: 'RisuAI-Hardened',
    repo: 'devforai-creator/RisuAI-Hardened',
    defaultUrl: 'http://localhost:5179',
    title: 'RisuAI',
    catchAllProxy: false,
    expectedFlavor: 'hardened',
    supportsLLM: false,
    lazyChatPlaceholders: false,
    rejectsLiteCharacters: false,
    autoSyncPersona: false,
    runtimeInfo: null,
  },
};

const deepClone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/**
 * Builds a realistic multi-character, multi-chat state fixture matching fork edge cases.
 */
function createE2eState() {
  const aria = {
    type: 'character',
    chaId: 'e2e-char-aria',
    name: '아리아',
    desc: '아리아는 북부 변경의 수호 기사이며, 은빛 장검을 사용한다.\n' + '가'.repeat(650) + '\n숨겨진 유물: 푸른 월광석.',
    firstMessage: '안녕하세요.',
    alternateGreetings: ['비 오는 날의 인사'],
    globalLore: [
      { comment: '왕국 설정', key: '왕국', secondkey: '', content: '북부 왕국', insertorder: 100, mode: 'normal' },
    ],
    customscript: [],
    triggerscript: [],
    tags: ['판타지'],
    bias: [],
    chats: [
      {
        id: 'e2e-chat-1',
        name: '1부 모험',
        note: '1부 노트',
        fmIndex: -1,
        scriptstate: { $hp: 80, $gold: 100 },
        localLore: [],
        message: [
          { role: 'user', data: '숲으로 출발하자.', chatId: 'm1' },
          { role: 'char', data: '안개 속에서 늑대가 나타났다.', chatId: 'm2' },
        ],
      },
      {
        id: 'e2e-chat-2',
        name: '2부 여정',
        note: '2부 노트',
        fmIndex: -1,
        scriptstate: { $hp: 60 },
        localLore: [],
        message: [
          { role: 'user', data: '2부 시작.', chatId: 'm3' },
          { role: 'char', data: '새로운 도시에 도착했다.', chatId: 'm4' },
        ],
      },
    ],
    chatPage: 1,
  };

  const otherChar = {
    type: 'character',
    chaId: 'e2e-char-other',
    name: 'OtherChar',
    desc: '다른 캐릭터의 기존 설명입니다.',
    firstMessage: '반갑다.',
    alternateGreetings: [],
    globalLore: [],
    customscript: [],
    triggerscript: [],
    tags: [],
    bias: [],
    chats: [
      {
        id: 'e2e-other-chat-0',
        name: '기본 채팅',
        note: '',
        fmIndex: -1,
        scriptstate: {},
        localLore: [],
        message: [],
      },
    ],
    chatPage: 0,
  };

  return {
    charIndex: 0,
    chatIndex: 1,
    characters: [aria, otherChar],
    db: {
      temperature: 80,
      maxContext: 8000,
      maxResponse: 1000,
      colorSchemeName: 'default',
      textTheme: 'standard',
      selectedPersona: 0,
      personas: [{ id: 'e2e-p0', name: '모험가', note: '', personaPrompt: '탐색가' }],
      modules: [],
      enabledModules: [],
      characterOrder: [aria.chaId, otherChar.chaId],
    },
    hostMeta: {
      colorScheme: {
        name: 'dark',
        scheme: {
          bgcolor: '#1e1e2e',
          darkbg: '#181825',
          borderc: '#585b70',
          selected: '#313244',
          draculared: '#f38ba8',
          textcolor: '#cdd6f4',
          textcolor2: '#a6adc8',
          darkBorderc: '#45475a',
          darkbutton: '#313244',
          type: 'dark',
        },
      },
      textTheme: {
        name: 'standard',
        customTheme: {
          FontColorStandard: '#cdd6f4',
          FontColorBold: '#ffffff',
          FontColorItalic: '#a6adc8',
          FontColorItalicBold: '#bac2de',
          FontColorQuote1: '#89dceb',
          FontColorQuote2: '#fab387',
        },
      },
      chatPanelHtml: null,
      savedAssets: [],
      bodyIntercepters: new Map(), // id -> fn (exact upstream { id } contract)
      nextIntercepterId: 1,
      scriptHandlers: [],
      replacers: [],
      chatListeners: [],
      ttsPre: [],
      bardWikiDocs: [
        { id: 'bw-1', type: 'event', status: 'active', title: '왕국 연대기', content: '초기 기록', grade: 6, contextMode: 'auto', contentHash: 'hash-bw-1-v1' },
      ],
      bardWikiContext: { content: '초기 컨텍스트', sources: [] },
      risunestRevision: 1,
      risunestEventIds: new Set(),
      risunestSavedFiles: [],
    },
  };
}

/**
 * Wraps the shared state fixture into a faithful Plugin API v3 host object mimicking the given fork.
 * Strictly enforces real upstream kwaroran/Risuai, RisuBard, and RisuNest signatures so signature
 * regressions fail immediately in simulated E2E.
 */
function createSimulatedForkApi(hostId, state, { storage, runLLMModel, registeredButtons, onUnloadRef }) {
  const profile = FORK_HOSTS[hostId];
  if (!profile) throw new Error(`Unknown fork host: ${hostId}`);

  const readCharForExport = (idx) => {
    const ch = deepClone(state.characters[idx]);
    // PocketRisu / RisuBard return `_placeholder: true` stubs for unopened chats inside getCharacter()
    if (profile.lazyChatPlaceholders && Array.isArray(ch.chats)) {
      const openChatIdx = idx === state.charIndex ? state.chatIndex : (ch.chatPage ?? 0);
      ch.chats = ch.chats.map((c, i) => (
        i === openChatIdx
          ? c
          : { id: c.id, name: c.name, _placeholder: true, message: [] }
      ));
    }
    return ch;
  };

  const COLOR_KEYS = ['bgcolor', 'darkbg', 'borderc', 'selected', 'draculared', 'textcolor', 'textcolor2', 'darkBorderc', 'darkbutton', 'type'];
  const TEXT_KEYS = ['FontColorStandard', 'FontColorBold', 'FontColorItalic', 'FontColorItalicBold', 'FontColorQuote1', 'FontColorQuote2'];

  const handlers = {
    pluginStorage: storage,
    async getCharacter() { return readCharForExport(state.charIndex); },
    async setCharacter(c) {
      const incoming = deepClone(c);
      // Preserve real unhydrated chats if host is lazy-placeholder and caller didn't touch them
      if (profile.lazyChatPlaceholders && Array.isArray(incoming.chats)) {
        const prev = state.characters[state.charIndex].chats || [];
        incoming.chats = incoming.chats.map((chat, i) => (
          chat?._placeholder && prev[i] ? deepClone(prev[i]) : chat
        ));
      }
      state.characters[state.charIndex] = incoming;
      if (Number.isInteger(incoming.chatPage)) state.chatIndex = incoming.chatPage;
    },
    async getCharacterFromIndex(idx) {
      if (!state.characters[idx]) return null;
      return readCharForExport(idx);
    },
    async setCharacterToIndex(idx, c) {
      if (!state.characters[idx]) return;
      state.characters[idx] = deepClone(c);
      if (idx === state.charIndex && Number.isInteger(c?.chatPage)) state.chatIndex = c.chatPage;
    },
    async getCurrentCharacterIndex() { return state.charIndex; },
    async getCurrentChatIndex() { return state.chatIndex; },
    async getChatFromIndex(ci, chIdx) {
      const chat = state.characters[ci]?.chats?.[chIdx];
      return chat ? deepClone(chat) : null;
    },
    async getDatabase(keys) {
      const full = { ...state.db, characters: state.characters.map((_, i) => readCharForExport(i)) };
      if (!Array.isArray(keys)) return deepClone(full);
      const out = {};
      for (const k of keys) {
        if (Object.hasOwn(full, k)) out[k] = deepClone(full[k]);
      }
      return out;
    },
    async setDatabase(patch) {
      for (const [k, v] of Object.entries(patch || {})) {
        if (k === 'plugins') continue;
        if (k === 'characters' && Array.isArray(v)) {
          state.characters = deepClone(v);
        } else {
          state.db[k] = deepClone(v);
        }
      }
    },
    async setDatabaseLite(patch) {
      if (profile.rejectsLiteCharacters && patch && Object.hasOwn(patch, 'characters')) {
        throw new Error('RisuNest forbids passing characters to setDatabaseLite');
      }
      for (const [k, v] of Object.entries(patch || {})) {
        if (k === 'plugins') continue;
        state.db[k] = deepClone(v);
      }
    },
    async getRootDocument() {
      return {
        async querySelector(sel) {
          if (sel === 'title') return { async textContent() { return profile.title; } };
          return null;
        },
        async addEventListener() {},
        async removeEventListener() {},
      };
    },
    async registerButton(meta, cb) { registeredButtons.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(_n, cb, _i, _t, id) { registeredButtons.push({ meta: { id, location: 'setting' }, cb }); return { id }; },
    async unregisterUIPart(id) { state.hostMeta.risunestEventIds.delete(id); },
    async showContainer() {},
    async hideContainer() {},
    async onUnload(fn) { onUnloadRef.fn = fn; },
  };

  if (profile.runtimeInfo) {
    handlers.getRuntimeInfo = async () => deepClone(profile.runtimeInfo);
  }
  if (hostId !== 'hardened') {
    handlers.setChatToIndex = async (ci, chIdx, chat) => {
      if (state.characters[ci]?.chats?.[chIdx]) {
        state.characters[ci].chats[chIdx] = deepClone(chat);
      }
    };
    handlers.getColorScheme = async () => deepClone(state.hostMeta.colorScheme);
    handlers.changeColorScheme = async (name) => {
      state.db.colorSchemeName = String(name);
      state.hostMeta.colorScheme.name = String(name);
    };
    handlers.setColorScheme = async (scheme) => {
      if (!scheme || typeof scheme !== 'object') throw new Error('Color scheme must be an object');
      for (const k of COLOR_KEYS) {
        if (typeof scheme[k] !== 'string') throw new Error(`Color scheme missing required key: ${k}`);
      }
      state.db.colorSchemeName = 'custom';
      state.hostMeta.colorScheme = { name: 'custom', scheme: deepClone(scheme) };
    };
    handlers.getTextTheme = async () => deepClone(state.hostMeta.textTheme);
    handlers.changeTextTheme = async (name) => {
      if (!['standard', 'highcontrast'].includes(name)) throw new Error(`Invalid text theme: ${name}`);
      state.db.textTheme = String(name);
      state.hostMeta.textTheme.name = String(name);
    };
    handlers.setCustomTextTheme = async (theme) => {
      if (!theme || typeof theme !== 'object') throw new Error('Text theme must be an object');
      for (const k of TEXT_KEYS) {
        if (typeof theme[k] !== 'string') throw new Error(`CustomTextTheme missing required key: ${k}`);
      }
      state.db.textTheme = 'custom';
      state.hostMeta.textTheme = { name: 'custom', customTheme: deepClone(theme) };
    };
    handlers.setChatPanel = async (html) => {
      if (html !== null && typeof html !== 'string') throw new Error('content must be a string or null');
      state.hostMeta.chatPanelHtml = html ? String(html) : null;
      return { id: 'risuhelper:default' };
    };
    handlers.saveAsset = async (bytes) => {
      if (!(bytes instanceof Uint8Array)) throw new Error('saveAsset requires Uint8Array');
      const id = `e2e_asset_${state.hostMeta.savedAssets.length + 1}`;
      state.hostMeta.savedAssets.push({ id, bytes: bytes.length });
      return id;
    };
    handlers.checkCharOrder = async () => {
      state.db.characterOrder = state.characters.map(c => c.chaId);
    };
    handlers.addRisuScriptHandler = async (mode, fn) => {
      if (!['display', 'output', 'input', 'process'].includes(mode)) throw new Error(`Invalid script mode: ${mode}`);
      state.hostMeta.scriptHandlers.push({ mode, fn });
    };
    handlers.removeRisuScriptHandler = async (mode, fn) => {
      const i = state.hostMeta.scriptHandlers.findIndex(x => x.mode === mode && x.fn === fn);
      if (i >= 0) state.hostMeta.scriptHandlers.splice(i, 1);
    };
    handlers.addRisuReplacer = async (type, fn) => {
      if (type !== 'beforeRequest' && type !== 'afterRequest') throw new Error(`Invalid replacer type: ${type}`);
      state.hostMeta.replacers.push({ type, fn });
    };
    handlers.removeRisuReplacer = async (type, fn) => {
      const i = state.hostMeta.replacers.findIndex(x => x.type === type && x.fn === fn);
      if (i >= 0) state.hostMeta.replacers.splice(i, 1);
    };
    handlers.addRisuChatListener = async (mode, fn) => {
      if (mode !== 'output') throw new Error(`Invalid chat listener mode: ${String(mode)}`);
      state.hostMeta.chatListeners.push({ mode, fn });
    };
    handlers.removeRisuChatListener = async (mode, fn) => {
      if (mode !== 'output') throw new Error(`Invalid chat listener mode: ${String(mode)}`);
      const i = state.hostMeta.chatListeners.findIndex(x => x.mode === mode && x.fn === fn);
      if (i >= 0) state.hostMeta.chatListeners.splice(i, 1);
    };
    // Exact upstream contract: returns `{ id }` and unregisters strictly by string `id`
    handlers.registerBodyIntercepter = async (fn) => {
      const id = `bi_${state.hostMeta.nextIntercepterId++}`;
      state.hostMeta.bodyIntercepters.set(id, fn);
      return { id };
    };
    handlers.unregisterBodyIntercepter = async (id) => {
      if (typeof id !== 'string') return;
      state.hostMeta.bodyIntercepters.delete(id);
    };
    handlers.addTTSPreprocessor = async (fn) => { state.hostMeta.ttsPre.push(fn); };
    handlers.parseRisuChat = async (text) => String(text ?? '');
    handlers.sendChat = async () => {};
    handlers.runLLMModel = runLLMModel;
  }
  if (hostId === 'risuai') {
    handlers.createInlay = async (data, options = {}) => {
      if (!(data instanceof Uint8Array) && typeof data !== 'string') {
        throw new Error('data must be a Uint8Array or an image data URI string');
      }
      return `inlay_${options?.name || 'e2e'}`;
    };
  }
  if (hostId === 'risunest') {
    handlers.queryCharacters = async ({ limit = 50 } = {}) => ({
      revision: state.hostMeta.risunestRevision,
      items: state.characters.slice(0, limit).map((c, i) => ({
        index: i,
        chaId: c.chaId,
        name: c.name,
        type: c.type,
      })),
    });
    handlers.queryConversations = async (input) => {
      if (!input || typeof input.characterId !== 'string') throw new Error('queryConversations requires characterId');
      const char = state.characters.find(c => c.chaId === input.characterId);
      const chats = char?.chats || [];
      return {
        revision: state.hostMeta.risunestRevision,
        items: chats.map((c, i) => ({ chatIndex: i, conversationId: c.id, id: c.id, name: c.name, messageCount: c.message?.length || 0 })),
      };
    };
    handlers.queryConversationMessages = async (input) => {
      if (!input || typeof input.characterId !== 'string' || typeof input.conversationId !== 'string') {
        throw new Error('queryConversationMessages requires characterId and conversationId');
      }
      const char = state.characters.find(c => c.chaId === input.characterId);
      const chat = char?.chats?.find(c => c.id === input.conversationId);
      const msgs = deepClone(chat?.message || []);
      return {
        revision: state.hostMeta.risunestRevision,
        characterId: input.characterId,
        conversationId: input.conversationId,
        messages: msgs,
        startIndex: 0,
        endIndex: msgs.length,
        totalMessages: msgs.length,
        hasMoreBefore: false,
        hasMoreAfter: false,
      };
    };
    handlers.risunestReadConversationContext = async (input = {}) => {
      const char = (input.characterId ? state.characters.find(c => c.chaId === input.characterId) : null) || state.characters[state.charIndex];
      const chat = (input.conversationId ? char?.chats?.find(c => c.id === input.conversationId) : null) || char?.chats?.[state.chatIndex];
      const vars = {};
      for (const [k, v] of Object.entries(chat?.scriptstate || {})) {
        vars[k.replace(/^\$/, '')] = v;
      }
      return {
        revision: state.hostMeta.risunestRevision,
        characterId: char.chaId,
        conversationId: chat.id,
        characterIndex: state.characters.indexOf(char),
        chatIndex: char.chats.indexOf(chat),
        selected: true,
        messageCount: chat.message.length,
        conversation: { id: chat.id, name: chat.name, note: chat.note },
        chatVariables: vars,
        messages: { startIndex: 0, messages: deepClone(chat.message) },
      };
    };
    handlers.risunestPatchConversation = async (request) => {
      if (!request || typeof request !== 'object' || !request.characterId || !request.conversationId || !request.mutationId) {
        throw new Error('risunestPatchConversation requires { characterId, conversationId, mutationId, messages, chatVariables }');
      }
      const char = state.characters.find(c => c.chaId === request.characterId);
      const chat = char?.chats?.find(c => c.id === request.conversationId);
      if (!chat) return { status: 'conflict', conflict: { target: 'conversation', reason: 'not-found' }, revision: state.hostMeta.risunestRevision };
      for (const m of request.messages || []) {
        const cur = chat.message[m.index];
        if (!cur) return { status: 'conflict', conflict: { target: 'message', reason: 'not-found', index: m.index }, revision: state.hostMeta.risunestRevision };
        if (m.expected) {
          for (const [f, ev] of Object.entries(m.expected)) {
            if (JSON.stringify(cur[f]) !== JSON.stringify(ev)) {
              return { status: 'conflict', conflict: { target: 'message', reason: 'mismatch', index: m.index, field: f }, revision: state.hostMeta.risunestRevision };
            }
          }
        }
        Object.assign(cur, deepClone(m.set));
      }
      for (const v of request.chatVariables || []) {
        const curVal = chat.scriptstate[`$${v.key}`] ?? chat.scriptstate[v.key] ?? null;
        if (v.expected !== undefined && JSON.stringify(curVal) !== JSON.stringify(v.expected)) {
          return { status: 'conflict', conflict: { target: 'chatVariable', reason: 'mismatch', key: v.key }, revision: state.hostMeta.risunestRevision };
        }
        if (v.value === null) {
          delete chat.scriptstate[`$${v.key}`];
          delete chat.scriptstate[v.key];
        } else {
          chat.scriptstate[`$${v.key}`] = v.value;
        }
      }
      state.hostMeta.risunestRevision++;
      return { status: 'applied', revision: state.hostMeta.risunestRevision };
    };
    handlers.risunestListHostTools = async () => [{ name: 'search_docs', description: 'Read-only search', readOnly: true }];
    handlers.risunestOnChatView = async () => {
      const id = `rn_chat_view_${state.hostMeta.risunestEventIds.size + 1}`;
      state.hostMeta.risunestEventIds.add(id);
      return { id };
    };
    handlers.risunestOnGenerationEnd = async () => {
      const id = `rn_gen_end_${state.hostMeta.risunestEventIds.size + 1}`;
      state.hostMeta.risunestEventIds.add(id);
      return { id };
    };
  }
  if (hostId === 'risubard') {
    let hashSeq = 2;
    handlers._getBardWikiContext = async () => deepClone(state.hostMeta.bardWikiContext);
    handlers._getBardWikiDocuments = async () => deepClone(state.hostMeta.bardWikiDocs);
    handlers._saveBardWikiDocument = async (doc) => {
      if (!doc || typeof doc.markdown !== 'string' || typeof doc.title !== 'string') {
        throw new Error('bardWiki.saveDocument requires { type, title, markdown }');
      }
      if (doc.documentId) {
        const existing = state.hostMeta.bardWikiDocs.find(d => d.id === doc.documentId);
        if (existing && existing.contentHash !== doc.expectedContentHash) {
          throw new Error('bardWiki.saveDocument contentHash mismatch');
        }
      }
      const id = doc.documentId || `bw_${state.hostMeta.bardWikiDocs.length + 1}`;
      const existing = state.hostMeta.bardWikiDocs.find(d => d.id === id);
      const next = {
        id,
        type: doc.type || existing?.type || 'other',
        status: 'active',
        title: doc.title,
        aliases: doc.aliases || existing?.aliases || [],
        content: doc.markdown,
        contextMode: existing?.contextMode || 'auto',
        grade: existing?.grade ?? null,
        contentHash: `hash-${id}-v${hashSeq++}`,
      };
      const idx = state.hostMeta.bardWikiDocs.findIndex(d => d.id === id);
      if (idx >= 0) state.hostMeta.bardWikiDocs[idx] = next;
      else state.hostMeta.bardWikiDocs.push(next);
      return deepClone(next);
    };
    handlers._setBardWikiGrade = async (input) => {
      if (!input || typeof input !== 'object' || !input.documentId) {
        throw new Error('bardWiki.setGrade requires object { documentId, grade, expectedContentHash }');
      }
      const d = state.hostMeta.bardWikiDocs.find(x => x.id === input.documentId);
      if (!d || d.contentHash !== input.expectedContentHash) return null;
      if (input.grade !== null && (!Number.isInteger(input.grade) || input.grade < 0 || input.grade > 9)) {
        throw new Error('bardWiki.setGrade grade must be 0..9 or null');
      }
      d.grade = input.grade;
      d.contentHash = `hash-${d.id}-v${hashSeq++}`;
      return deepClone(d);
    };
    handlers._setBardWikiContextMode = async (input) => {
      if (!input || typeof input !== 'object' || !input.documentId) {
        throw new Error('bardWiki.setContextMode requires object { documentId, contextMode, expectedContentHash }');
      }
      const d = state.hostMeta.bardWikiDocs.find(x => x.id === input.documentId);
      if (!d || d.contentHash !== input.expectedContentHash) return null;
      if (!['always', 'auto', 'never'].includes(input.contextMode)) {
        throw new Error(`Invalid contextMode: ${input.contextMode}`);
      }
      d.contextMode = input.contextMode;
      d.contentHash = `hash-${d.id}-v${hashSeq++}`;
      return deepClone(d);
    };
    handlers._trashBardWikiDocument = async (id) => {
      const idx = state.hostMeta.bardWikiDocs.findIndex(d => d.id === id);
      if (idx < 0) return null;
      state.hostMeta.bardWikiDocs.splice(idx, 1);
      return { id, trashed: true };
    };
  }

  if (!profile.catchAllProxy) {
    return handlers;
  }
  return new Proxy(handlers, {
    get(target, prop) {
      if (prop === 'then') return undefined;
      if (Object.hasOwn(target, prop)) return target[prop];
      return async () => { throw new Error(`Unsupported Plugin v3 method on ${hostId}: ${String(prop)}`); };
    },
  });
}

export {
  FORK_HOSTS,
  createE2eState,
  createSimulatedForkApi,
};
