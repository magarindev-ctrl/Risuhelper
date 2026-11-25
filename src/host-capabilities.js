// SPDX-License-Identifier: GPL-3.0-only
// Runtime host flavor & Plugin API v3 capability detection across upstream RisuAI and 5 major forks:
// kwaroran/Risuai, PocketRisu, RisuBard, RisuNest, HaejeokRisuai, RisuAI-Hardened.
//
// Important: in real RisuAI iframes, `window.risuai` is a catch-all Proxy where
// `typeof api.anyProperty === 'function'` is always true. Never trust method presence on a
// catch-all Proxy; identify the host via `getRuntimeInfo()` and `<title>` first, then consult
// the verified host capability profile.

function isCatchAllProxyApi(api) {
  return Boolean(api && typeof api.__risuhelper_nonexistent_probe__ === 'function');
}

const MODERN_BASE_CAPABILITIES = {
  // Core character / chat / DB (all 6 hosts)
  getCharacterFromIndex: true,
  setCharacterToIndex: true,
  getChatFromIndex: true,
  setChatToIndex: true,
  checkCharOrder: true,
  getRuntimeInfo: true,
  getFetchLogs: true,
  readImage: true,
  saveAsset: true,

  // Modern 5-host Plugin v3 APIs (absent on RisuAI-Hardened)
  runLLMModel: true,
  sendChat: true,
  parseRisuChat: true,
  getCurrentLorebookEntries: true,
  readInlay: true,
  colorScheme: true,
  textTheme: true,
  translationCache: true,
  setChatPanel: true,
  mcp: true,
  bodyIntercepter: true,
  chatListener: true,
  ttsHooks: true,
  pluginChannel: true,
  localPluginStorage: true,

  // Upstream-only / fork-only capabilities
  createInlay: false,
  lazyChats: false,
  bardWiki: false,
  risunestQuery: false,
  risunestPatch: false,
  risunestHostTools: false,
  risunestEvents: false,
  risunestSaveFile: false,
};

const HOST_PROFILES = {
  RisuAI: {
    name: 'RisuAI',
    activePersonaAutoSyncs: false,
    syncLiteCharError: false,
    capabilities: {
      ...MODERN_BASE_CAPABILITIES,
      createInlay: true,
    },
  },
  PocketRisu: {
    name: 'PocketRisu',
    activePersonaAutoSyncs: false,
    syncLiteCharError: false,
    capabilities: {
      ...MODERN_BASE_CAPABILITIES,
      lazyChats: true,
    },
  },
  RisuBard: {
    name: 'RisuBard',
    activePersonaAutoSyncs: false,
    syncLiteCharError: false,
    capabilities: {
      ...MODERN_BASE_CAPABILITIES,
      bardWiki: true,
    },
  },
  RisuNest: {
    name: 'RisuNest',
    activePersonaAutoSyncs: true,
    syncLiteCharError: true,
    capabilities: {
      ...MODERN_BASE_CAPABILITIES,
      risunestQuery: true,
      risunestPatch: true,
      risunestHostTools: true,
      risunestEvents: true,
      risunestSaveFile: true,
    },
  },
  HaejeokRisuai: {
    name: 'HaejeokRisuai',
    activePersonaAutoSyncs: true,
    syncLiteCharError: false,
    capabilities: {
      ...MODERN_BASE_CAPABILITIES,
    },
  },
  'RisuAI-Hardened': {
    name: 'RisuAI-Hardened',
    activePersonaAutoSyncs: false,
    syncLiteCharError: false,
    capabilities: {
      ...MODERN_BASE_CAPABILITIES,
      runLLMModel: false,
      sendChat: false,
      parseRisuChat: false,
      getCurrentLorebookEntries: false,
      readInlay: false,
      createInlay: false,
      colorScheme: false,
      textTheme: false,
      translationCache: false,
      setChatPanel: false,
      mcp: false,
      bodyIntercepter: false,
      chatListener: false,
      ttsHooks: false,
      pluginChannel: false,
      localPluginStorage: false,
    },
  },
};

function inferCapabilitiesForFlavor(flavorName) {
  const base = HOST_PROFILES[flavorName] || HOST_PROFILES.RisuAI;
  return {
    name: base.name,
    activePersonaAutoSyncs: base.activePersonaAutoSyncs,
    syncLiteCharError: base.syncLiteCharError,
    capabilities: { ...base.capabilities },
  };
}

function hasFn(obj, name) {
  return Boolean(obj && typeof obj[name] === 'function');
}

/**
 * Overlays direct method presence when `api` is NOT a catch-all Proxy (unit tests, direct host
 * objects, or future non-Proxy bridges). Flavor-level behavioral flags (`lazyChats`, etc.) remain
 * governed by the host profile.
 */
function refineNonProxyCapabilities(api, baseCaps) {
  const caps = { ...baseCaps };
  if (!api || typeof api !== 'object') return caps;

  caps.getCharacterFromIndex = hasFn(api, 'getCharacterFromIndex');
  caps.setCharacterToIndex = hasFn(api, 'setCharacterToIndex');
  caps.getChatFromIndex = hasFn(api, 'getChatFromIndex');
  caps.setChatToIndex = hasFn(api, 'setChatToIndex');
  caps.checkCharOrder = hasFn(api, 'checkCharOrder');
  caps.getRuntimeInfo = hasFn(api, 'getRuntimeInfo');
  caps.getFetchLogs = hasFn(api, 'getFetchLogs');
  caps.readImage = hasFn(api, 'readImage');
  caps.saveAsset = hasFn(api, 'saveAsset');

  caps.runLLMModel = hasFn(api, 'runLLMModel');
  caps.sendChat = hasFn(api, 'sendChat');
  caps.parseRisuChat = hasFn(api, 'parseRisuChat');
  caps.getCurrentLorebookEntries = hasFn(api, 'getCurrentLorebookEntries');
  caps.readInlay = hasFn(api, 'readInlay');
  caps.createInlay = Boolean(caps.createInlay && hasFn(api, 'createInlay'));
  caps.colorScheme = hasFn(api, 'getColorScheme') || hasFn(api, 'changeColorScheme') || hasFn(api, 'setColorScheme');
  caps.textTheme = hasFn(api, 'getTextTheme') || hasFn(api, 'changeTextTheme') || hasFn(api, 'setCustomTextTheme');
  caps.translationCache = hasFn(api, 'getTranslationCache') || hasFn(api, 'searchTranslationCache');
  caps.setChatPanel = hasFn(api, 'setChatPanel');
  caps.mcp = hasFn(api, 'registerMCP');
  caps.bodyIntercepter = hasFn(api, 'registerBodyIntercepter');
  caps.chatListener = hasFn(api, 'addRisuChatListener');
  caps.ttsHooks = hasFn(api, 'addTTSPreprocessor') || hasFn(api, 'addTTSPostprocessor');
  caps.pluginChannel = hasFn(api, 'addPluginChannelListener') || hasFn(api, 'postPluginChannelMessage');
  caps.localPluginStorage = hasFn(api, 'getLocalPluginStorage');

  caps.bardWiki = Boolean(
    hasFn(api, '_getBardWikiDocuments') ||
    hasFn(api, '_getBardWikiContext') ||
    hasFn(api.bardWiki, 'getDocuments') ||
    hasFn(api.bardWiki, 'getContext')
  );
  caps.risunestQuery = hasFn(api, 'queryCharacters') || hasFn(api, 'queryConversations');
  caps.risunestPatch = hasFn(api, 'risunestPatchConversation') || hasFn(api, 'risunestReadConversationContext');
  caps.risunestHostTools = hasFn(api, 'risunestListHostTools') || hasFn(api, 'risunestCallHostTool');
  caps.risunestEvents = hasFn(api, 'risunestOnChatView') || hasFn(api, 'risunestOnGenerationEnd');
  caps.risunestSaveFile = hasFn(api, 'save');

  return caps;
}

function flavorFromRuntimeInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const appId = String(info.app?.id ?? info.appId ?? info.host ?? '').trim().toLowerCase();
  if (!appId) return null;
  if (appId.includes('risunest')) return 'RisuNest';
  if (appId.includes('pocketrisu')) return 'PocketRisu';
  if (appId.includes('risubard')) return 'RisuBard';
  if (appId.includes('haejeok')) return 'HaejeokRisuai';
  if (appId.includes('hardened')) return 'RisuAI-Hardened';
  if (appId === 'risuai') return 'RisuAI';
  return null;
}

function flavorFromTitle(rawTitle) {
  const title = String(rawTitle ?? '').trim().toLowerCase();
  if (!title) return null;
  if (title.includes('pocketrisu')) return 'PocketRisu';
  if (title.includes('risubard')) return 'RisuBard';
  if (title.includes('risunest')) return 'RisuNest';
  if (title.includes('haejeok') || title.includes('해적')) return 'HaejeokRisuai';
  if (title.includes('hardened')) return 'RisuAI-Hardened';
  if (title.includes('risuai')) return 'RisuAI';
  return null;
}

function flavorFromNonProxyMethods(api) {
  if (!api || typeof api !== 'object') return null;
  if (
    hasFn(api, 'risunestCallHostTool') ||
    hasFn(api, 'queryCharacters') ||
    hasFn(api, 'risunestPatchConversation')
  ) {
    return 'RisuNest';
  }
  if (
    hasFn(api, '_getBardWikiDocuments') ||
    hasFn(api, '_getBardWikiContext') ||
    hasFn(api.bardWiki, 'getDocuments')
  ) {
    return 'RisuBard';
  }
  if (
    hasFn(api, 'getCharacterFromIndex') &&
    !hasFn(api, 'runLLMModel') &&
    !hasFn(api, 'parseRisuChat') &&
    !hasFn(api, 'sendChat') &&
    hasFn(api, 'getDatabase')
  ) {
    return 'RisuAI-Hardened';
  }
  return null;
}

/**
 * Synchronous fallback used before `probeHostCapabilities()` finishes.
 */
function detectHostFlavorSync(api) {
  const isProxy = isCatchAllProxyApi(api);
  const flavorName = (!isProxy && flavorFromNonProxyMethods(api)) || 'RisuAI';
  const profile = inferCapabilitiesForFlavor(flavorName);
  const capabilities = isProxy
    ? profile.capabilities
    : refineNonProxyCapabilities(api, profile.capabilities);
  return {
    ...profile,
    capabilities,
    runtime: null,
    isProxy,
  };
}

/**
 * Probes the real host flavor and API capability matrix safely with zero permission prompts.
 * Resolution order:
 *  1. `api.getRuntimeInfo()` (works on all 6 hosts without `mainDom`; identifies RisuNest via `app.id`)
 *  2. `rootDoc.querySelector('title')` (works when `mainDom` is granted; identifies every fork by title)
 *  3. Direct method signatures (ONLY when `api` is not a catch-all Proxy)
 */
async function probeHostCapabilities(api, rootDoc = null) {
  const isProxy = isCatchAllProxyApi(api);
  let runtime = null;
  let flavorName = null;

  // 1. Safe runtime metadata probe (present on all 6 hosts, zero permission prompts)
  if (api && typeof api.getRuntimeInfo === 'function') {
    try {
      const info = await api.getRuntimeInfo();
      if (info && typeof info === 'object') {
        runtime = info;
        flavorName = flavorFromRuntimeInfo(info);
      }
    } catch {}
  }

  // 2. Host document <title> when mainDom is available
  if (!flavorName && rootDoc && typeof rootDoc.querySelector === 'function') {
    try {
      const titleEl = await rootDoc.querySelector('title');
      const title = titleEl ? String((await titleEl.textContent()) || '') : '';
      flavorName = flavorFromTitle(title);
    } catch {}
  }

  // 3. Direct own-method inspection (strictly skipped on catch-all Proxy)
  if (!flavorName && !isProxy) {
    flavorName = flavorFromNonProxyMethods(api);
  }

  const resolvedFlavor = flavorName || 'RisuAI';
  const profile = inferCapabilitiesForFlavor(resolvedFlavor);
  const capabilities = isProxy
    ? profile.capabilities
    : refineNonProxyCapabilities(api, profile.capabilities);

  return {
    ...profile,
    capabilities,
    runtime,
    isProxy,
  };
}

export {
  HOST_PROFILES,
  isCatchAllProxyApi,
  inferCapabilitiesForFlavor,
  detectHostFlavorSync,
  probeHostCapabilities,
};
