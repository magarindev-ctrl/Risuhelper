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
      selectedPersona: 0,
      personas: [{ id: 'e2e-p0', name: '모험가', note: '', personaPrompt: '탐색가' }],
      modules: [],
      enabledModules: [],
      characterOrder: [aria.chaId, otherChar.chaId],
    },
  };
}

/**
 * Wraps the shared state fixture into a faithful Plugin API v3 host object mimicking the given fork.
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
    async unregisterUIPart() {},
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
    handlers.getColorScheme = async () => ({ name: 'Dark', scheme: { type: 'dark' } });
    handlers.getTextTheme = async () => 'standard';
    handlers.parseRisuChat = async (text) => String(text ?? '');
    handlers.sendChat = async () => {};
    handlers.runLLMModel = runLLMModel;
  }
  if (hostId === 'risunest') {
    handlers.queryCharacters = async ({ offset = 0, limit = 50 } = {}) => ({
      items: state.characters.slice(offset, offset + limit).map((c, i) => ({
        index: offset + i,
        chaId: c.chaId,
        name: c.name,
        type: c.type,
      })),
      total: state.characters.length,
    });
  }
  if (hostId === 'risubard') {
    handlers._getBardWikiContext = async () => ({ mode: 'auto', documents: [] });
    handlers._getBardWikiDocuments = async () => [];
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
