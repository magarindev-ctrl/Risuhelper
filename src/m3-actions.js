// SPDX-License-Identifier: GPL-3.0-only
// M3 Approval-Gated Write Actions & Surgical Undo (v0.9.9 / 1.0.0 RC).
// Covers:
// - Theme & Chat HUD (`update_theme`, `set_chat_panel`)
// - Assets & Inlays & Workspace Repair (`register_asset`, `repair_workspace`)
// - Chat Messages, Hypa/Supa Memory, Chat Folders (`manage_chat_messages`, `update_memory`, `organize_chat_folders`)
// - Group Chats & Onboarding (`update_group_chat`, `update_onboarding`)
// - Declarative Resident Extensions (`manage_extensions`)
// - Fork-Specific APIs: RisuBard BardWiki (`manage_bard_wiki`) & RisuNest Native Patch (`patch_risunest_conversation`)

import {
  validateExtensionRule,
  dryRunExtensionRule,
  EXTENSION_TYPE_LABELS,
} from './extensions-runtime.js';

const M3_ACTIONS = new Set([
  'update_theme',
  'set_chat_panel',
  'register_asset',
  'repair_workspace',
  'manage_chat_messages',
  'update_memory',
  'update_onboarding',
  'update_group_chat',
  'organize_chat_folders',
  'manage_extensions',
  'manage_bard_wiki',
  'patch_risunest_conversation',
]);

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Upstream kwaroran/Risuai ColorScheme requires all 10 keys (risuai.d.ts:431-442, v3.svelte.ts:849-876)
const COLOR_SCHEME_REQUIRED_KEYS = [
  'bgcolor', 'darkbg', 'borderc', 'selected', 'draculared',
  'textcolor', 'textcolor2', 'darkBorderc', 'darkbutton', 'type',
];
const ALLOWED_COLOR_SCHEME_KEYS = new Set(COLOR_SCHEME_REQUIRED_KEYS);
const ALLOWED_COLOR_SCHEME_PRESETS = new Set([
  'default', 'dark', 'light', 'cherry', 'galaxy', 'nature', 'realblack', 'monokai-light', 'monokai-black',
]);
const DEFAULT_DARK_COLOR_SCHEME = {
  bgcolor: '#282a36',
  darkbg: '#21222c',
  borderc: '#6272a4',
  selected: '#44475a',
  draculared: '#ff5555',
  textcolor: '#f8f8f2',
  textcolor2: '#64748b',
  darkBorderc: '#4b5563',
  darkbutton: '#374151',
  type: 'dark',
};

// Upstream kwaroran/Risuai CustomTextTheme requires all 6 keys (risuai.d.ts:447-454, v3.svelte.ts:887-907)
const TEXT_THEME_REQUIRED_KEYS = [
  'FontColorStandard', 'FontColorBold', 'FontColorItalic',
  'FontColorItalicBold', 'FontColorQuote1', 'FontColorQuote2',
];
const ALLOWED_TEXT_THEME_KEYS = new Set(TEXT_THEME_REQUIRED_KEYS);
const ALLOWED_TEXT_THEME_PRESETS = new Set(['standard', 'highcontrast']);
const DEFAULT_CUSTOM_TEXT_THEME = {
  FontColorStandard: '#f8f8f2',
  FontColorBold: '#f8f8f2',
  FontColorItalic: '#8c8d93',
  FontColorItalicBold: '#8c8d93',
  FontColorQuote1: '#8be9fd',
  FontColorQuote2: '#ffb86c',
};

const ALLOWED_ONBOARDING_FIELD_TYPES = new Set(['text', 'textarea', 'select', 'checkbox', 'radio', 'number']);
const BARD_WIKI_DOC_TYPES = new Set([
  'event', 'character', 'location', 'scene', 'faction', 'creature', 'item', 'concept', 'other',
]);
const BARD_WIKI_CONTEXT_MODES = new Set(['always', 'auto', 'never']);
const BARD_WIKI_GRADE_ALIASES = {
  EX: 9, S: 8, A: 7, B: 6, C: 5, D: 3, NONE: 0,
};
// Upstream rsyumi/RisuNest ConversationPatchRequest supports atomic `messages` + `chatVariables` patches
const ALLOWED_RISUNEST_PATCH_KEYS = new Set(['messages', 'chatVariables']);

function unwrapColorScheme(raw) {
  const src = raw && typeof raw === 'object' && raw.scheme && typeof raw.scheme === 'object'
    ? raw.scheme
    : (raw && typeof raw === 'object' ? raw : {});
  const out = {};
  for (const k of COLOR_SCHEME_REQUIRED_KEYS) {
    if (k === 'type') {
      out.type = src.type === 'light' ? 'light' : 'dark';
    } else {
      out[k] = typeof src[k] === 'string' && src[k] ? src[k] : DEFAULT_DARK_COLOR_SCHEME[k];
    }
  }
  return out;
}

function unwrapTextTheme(raw) {
  const src = raw && typeof raw === 'object' && raw.customTheme && typeof raw.customTheme === 'object'
    ? raw.customTheme
    : (raw && typeof raw === 'object' ? raw : {});
  const out = {};
  for (const k of TEXT_THEME_REQUIRED_KEYS) {
    out[k] = typeof src[k] === 'string' && src[k] ? src[k] : DEFAULT_CUSTOM_TEXT_THEME[k];
  }
  return out;
}

function normalizeBardWikiGrade(raw) {
  if (raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw === 'number') {
    if (Number.isInteger(raw) && raw >= 0 && raw <= 9) return { ok: true, value: raw };
    return { ok: false, error: 'BardWiki grade는 0~9 정수, null, 또는 EX/S/A/B/C/D 등급이어야 합니다.' };
  }
  const s = String(raw).trim().toUpperCase();
  if (!s) return { ok: true, value: null };
  if (/^[0-9]$/.test(s)) return { ok: true, value: Number(s) };
  if (Object.hasOwn(BARD_WIKI_GRADE_ALIASES, s)) {
    return { ok: true, value: BARD_WIKI_GRADE_ALIASES[s] };
  }
  return { ok: false, error: `유효하지 않은 BardWiki grade입니다: ${raw} (0~9 정수, null, 또는 EX/S/A/B/C/D 허용)` };
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function makeUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Strips executable markup (<script>, <iframe>, <object>, <embed>, on*= handlers, javascript: URLs)
 * from Chat HUD HTML or inline SVG assets while preserving safe HTML/CSS/CBS markup.
 */
function sanitizeChatPanelHtml(rawHtml) {
  let s = String(rawHtml ?? '');
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<(?:iframe|object|embed|applet|meta|base|link)\b[^>]*>[\s\S]*?<\/(?:iframe|object|embed|applet)>/gi, '');
  s = s.replace(/<(?:iframe|object|embed|applet|meta|base|link|script)\b[^>]*\/?>/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/(href|src|xlink:href|action|formaction)\s*=\s*(["'])\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^"']*\2/gi, '$1=$2#$2');
  s = s.replace(/url\(\s*(["']?)\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^)]*\)/gi, 'url()');
  return s.trim();
}

function hasInvalidRegexFlags(flagStr) {
  if (flagStr === undefined || flagStr === null || flagStr === '') return false;
  const s = String(flagStr);
  if (/[^gimsuydv]/.test(s)) return true;
  if (new Set(s.split('')).size !== s.length) return true;
  try {
    new RegExp('a', s);
    return false;
  } catch {
    return true;
  }
}

function cleanRegexFlags(flagStr) {
  const s = String(flagStr ?? '').replace(/[^gimsuy]/g, '');
  return [...new Set(s.split(''))].join('');
}

function findOrphanLoreIndices(loreList) {
  if (!Array.isArray(loreList)) return [];
  const folderIds = new Set(
    loreList
      .filter(e => e && e.mode === 'folder' && typeof e.key === 'string' && e.key)
      .map(e => e.key)
  );
  const orphans = [];
  for (let i = 0; i < loreList.length; i++) {
    const e = loreList[i];
    if (e && e.mode !== 'folder' && typeof e.folder === 'string' && e.folder && !folderIds.has(e.folder)) {
      orphans.push(i);
    }
  }
  return orphans;
}

function getBardWikiApi(api) {
  if (!api || typeof api !== 'object') return null;
  const bw = api.bardWiki && typeof api.bardWiki === 'object' ? api.bardWiki : {};
  const getContext = typeof bw.getContext === 'function'
    ? (opts) => bw.getContext(opts)
    : (typeof api._getBardWikiContext === 'function' ? (opts) => api._getBardWikiContext(opts) : null);
  const getDocuments = typeof bw.getDocuments === 'function'
    ? (opts) => bw.getDocuments(opts)
    : (typeof api._getBardWikiDocuments === 'function' ? (opts) => api._getBardWikiDocuments(opts) : null);
  const saveDocument = typeof bw.saveDocument === 'function'
    ? (doc) => bw.saveDocument(doc)
    : (typeof api._saveBardWikiDocument === 'function' ? (doc) => api._saveBardWikiDocument(doc) : null);
  // Upstream RisuBard takes a single object `{ documentId, contextMode, expectedContentHash }`
  const setContextMode = typeof bw.setContextMode === 'function'
    ? (input) => bw.setContextMode(input)
    : (typeof api._setBardWikiContextMode === 'function' ? (input) => api._setBardWikiContextMode(input) : null);
  // Upstream RisuBard takes a single object `{ documentId, grade, gradeBy?, expectedContentHash }`
  const setGrade = typeof bw.setGrade === 'function'
    ? (input) => bw.setGrade(input)
    : (typeof api._setBardWikiGrade === 'function' ? (input) => api._setBardWikiGrade(input) : null);
  const trashDocument = typeof bw.trashDocument === 'function'
    ? (id) => bw.trashDocument(id)
    : (typeof api._trashBardWikiDocument === 'function' ? (id) => api._trashBardWikiDocument(id) : null);
  if (!getContext && !getDocuments && !saveDocument && !setContextMode && !setGrade && !trashDocument) {
    return null;
  }
  return { getContext, getDocuments, saveDocument, setContextMode, setGrade, trashDocument };
}

function snippetOf(text, max = 60) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function decodeTextAssetBytes(content, mimeType) {
  const raw = String(content ?? '');
  if (raw.startsWith('data:')) {
    const m = raw.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/);
    if (!m) throw new Error('올바른 data URL 형식이 아닙니다.');
    const isBase64 = /^data:[^,]*;base64,/i.test(raw);
    const detectedMime = m[1] || mimeType || 'application/octet-stream';
    if (/text\/html/i.test(detectedMime)) {
      const decoded = isBase64 ? atob(m[2]) : decodeURIComponent(m[2]);
      return { bytes: new TextEncoder().encode(sanitizeChatPanelHtml(decoded)), mimeType: detectedMime };
    }
    if (isBase64) {
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { bytes, mimeType: detectedMime };
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(m[2])), mimeType: detectedMime };
  }
  const clean = /svg|html/i.test(String(mimeType || '')) || /<svg\b/i.test(raw)
    ? sanitizeChatPanelHtml(raw)
    : raw;
  return {
    bytes: new TextEncoder().encode(clean),
    mimeType: mimeType || (/<svg\b/i.test(clean) ? 'image/svg+xml' : 'text/plain'),
  };
}

// ---------------------------------------------------------------------------
// 1. update_theme
// ---------------------------------------------------------------------------

async function planThemeUpdate(adapter, proposal) {
  const api = adapter.api;
  const wantsColor = proposal.colorSchemeName !== undefined || (proposal.colorScheme && typeof proposal.colorScheme === 'object');
  const wantsText = proposal.textThemeName !== undefined || (proposal.customTextTheme && typeof proposal.customTextTheme === 'object');
  const wantsDbStyle = proposal.customCSS !== undefined || proposal.guiHTML !== undefined;

  if (!wantsColor && !wantsText && !wantsDbStyle) {
    return { ok: false, error: 'update_theme에는 colorSchemeName, colorScheme, textThemeName, customTextTheme, customCSS, guiHTML 중 하나 이상이 필요합니다.' };
  }
  if (wantsColor && !adapter.hasCapability('colorScheme')) {
    return { ok: false, error: '현재 호스트는 ColorScheme 테마 API를 지원하지 않습니다.' };
  }
  if (wantsText && !adapter.hasCapability('textTheme')) {
    return { ok: false, error: '현재 호스트는 TextTheme API를 지원하지 않습니다.' };
  }

  if (proposal.colorSchemeName !== undefined) {
    const preset = String(proposal.colorSchemeName).trim();
    if (!ALLOWED_COLOR_SCHEME_PRESETS.has(preset)) {
      return {
        ok: false,
        error: `허용되지 않는 colorSchemeName 프리셋입니다: ${preset}. 허용값: ${[...ALLOWED_COLOR_SCHEME_PRESETS].join(', ')}`,
      };
    }
  }
  if (proposal.textThemeName !== undefined) {
    const preset = String(proposal.textThemeName).trim();
    if (!ALLOWED_TEXT_THEME_PRESETS.has(preset)) {
      return {
        ok: false,
        error: `허용되지 않는 textThemeName 프리셋입니다: ${preset}. 허용값: standard, highcontrast`,
      };
    }
  }

  let cleanColorScheme = null;
  if (proposal.colorScheme && typeof proposal.colorScheme === 'object') {
    cleanColorScheme = {};
    for (const [k, v] of Object.entries(proposal.colorScheme)) {
      if (BAD_KEYS.has(k) || !ALLOWED_COLOR_SCHEME_KEYS.has(k)) {
        return { ok: false, error: `허용되지 않는 colorScheme 키입니다: ${k}` };
      }
      if (k === 'type' && v !== 'light' && v !== 'dark') {
        return { ok: false, error: 'colorScheme.type은 "light" 또는 "dark"여야 합니다.' };
      }
      cleanColorScheme[k] = String(v);
    }
  }
  let cleanTextTheme = null;
  if (proposal.customTextTheme && typeof proposal.customTextTheme === 'object') {
    cleanTextTheme = {};
    for (const [k, v] of Object.entries(proposal.customTextTheme)) {
      if (BAD_KEYS.has(k) || !ALLOWED_TEXT_THEME_KEYS.has(k)) {
        return { ok: false, error: `허용되지 않는 customTextTheme 키입니다: ${k}` };
      }
      cleanTextTheme[k] = String(v);
    }
  }

  let currentColorMeta = null;
  let currentColorScheme = null;
  if (wantsColor && typeof api?.getColorScheme === 'function') {
    try {
      currentColorMeta = clone(await api.getColorScheme());
      currentColorScheme = unwrapColorScheme(currentColorMeta);
    } catch {}
  }
  let currentTextMeta = null;
  let currentTextTheme = null;
  if (wantsText && typeof api?.getTextTheme === 'function') {
    try {
      currentTextMeta = clone(await api.getTextTheme());
      currentTextTheme = unwrapTextTheme(currentTextMeta);
    } catch {}
  }
  const dbKeys = ['colorSchemeName', 'textTheme'];
  if (proposal.customCSS !== undefined) dbKeys.push('customCSS');
  if (proposal.guiHTML !== undefined) dbKeys.push('guiHTML');
  const currentDb = (await adapter.readDbSubset(dbKeys)) || {};

  const mergedColorScheme = cleanColorScheme
    ? unwrapColorScheme({ ...(currentColorScheme || DEFAULT_DARK_COLOR_SCHEME), ...cleanColorScheme })
    : null;
  const mergedTextTheme = cleanTextTheme
    ? unwrapTextTheme({ ...(currentTextTheme || DEFAULT_CUSTOM_TEXT_THEME), ...cleanTextTheme })
    : null;

  const beforeSummary = {};
  const afterSummary = {};
  if (proposal.colorSchemeName !== undefined) {
    beforeSummary.colorSchemeName = currentDb.colorSchemeName ?? currentColorMeta?.name ?? '(현재)';
    afterSummary.colorSchemeName = String(proposal.colorSchemeName).trim();
  }
  if (mergedColorScheme) {
    beforeSummary.colorScheme = currentColorScheme || DEFAULT_DARK_COLOR_SCHEME;
    afterSummary.colorScheme = mergedColorScheme;
  }
  if (proposal.textThemeName !== undefined) {
    beforeSummary.textThemeName = currentDb.textTheme ?? currentTextMeta?.name ?? '(현재)';
    afterSummary.textThemeName = String(proposal.textThemeName).trim();
  }
  if (mergedTextTheme) {
    beforeSummary.customTextTheme = currentTextTheme || DEFAULT_CUSTOM_TEXT_THEME;
    afterSummary.customTextTheme = mergedTextTheme;
  }
  if (proposal.customCSS !== undefined) {
    beforeSummary.customCSS = currentDb.customCSS ?? '';
    afterSummary.customCSS = String(proposal.customCSS);
  }
  if (proposal.guiHTML !== undefined) {
    beforeSummary.guiHTML = currentDb.guiHTML ?? '';
    afterSummary.guiHTML = String(proposal.guiHTML);
  }

  return {
    ok: true,
    cleanColorScheme,
    cleanTextTheme,
    mergedColorScheme,
    mergedTextTheme,
    currentColorScheme,
    currentTextTheme,
    currentDb,
    beforeSummary,
    afterSummary,
  };
}

// ---------------------------------------------------------------------------
// 2. set_chat_panel
// ---------------------------------------------------------------------------

function planChatPanel(adapter, proposal) {
  if (!adapter.hasCapability('setChatPanel') || typeof adapter.api?.setChatPanel !== 'function') {
    return { ok: false, error: '현재 호스트는 setChatPanel HUD API를 지원하지 않습니다.' };
  }
  const clear = proposal.clear === true || proposal.visible === false;
  const beforeHtml = adapter._chatPanelState?.html ?? '';
  if (clear) {
    return {
      ok: true,
      clear: true,
      title: String(proposal.title || '채팅 HUD 닫기'),
      beforeHtml,
      afterHtml: '',
    };
  }
  if (typeof proposal.html !== 'string' || !proposal.html.trim()) {
    return { ok: false, error: 'set_chat_panel에는 html 문자열 또는 clear: true가 필요합니다.' };
  }
  const sanitized = sanitizeChatPanelHtml(proposal.html);
  if (!sanitized) {
    return { ok: false, error: '보안 정화 후 표시할 안전한 HTML 내용이 남지 않았습니다.' };
  }
  return {
    ok: true,
    clear: false,
    title: String(proposal.title || '채팅 HUD 패널'),
    beforeHtml,
    afterHtml: sanitized,
  };
}

// ---------------------------------------------------------------------------
// 3. register_asset
// ---------------------------------------------------------------------------

async function planRegisterAsset(adapter, proposal, target, binding = null) {
  const mode = String(proposal.mode || 'character_asset').trim();
  const name = String(proposal.name || '').trim();
  if (!name && mode !== 'inlay') {
    return { ok: false, error: 'register_asset에는 에셋 name이 필요합니다.' };
  }

  if (mode === 'inlay') {
    if (!adapter.hasCapability('createInlay') || typeof adapter.api?.createInlay !== 'function') {
      return { ok: false, error: '현재 호스트는 createInlay API를 지원하지 않습니다(원본 RisuAI 전용).' };
    }
    if (typeof proposal.content !== 'string' || !proposal.content.trim()) {
      return { ok: false, error: 'inlay 등록에는 content(SVG/텍스트/data URL)가 필요합니다.' };
    }
    const decoded = decodeTextAssetBytes(proposal.content, proposal.mimeType || 'image/svg+xml');
    return {
      ok: true,
      mode,
      name: name || 'inlay-asset',
      decoded,
      label: `인레이 등록: ${name || 'inlay-asset'}`,
      before: '(새 인레이)',
      after: `{{inlay::<생성됨>}} (${decoded.mimeType}, ${decoded.bytes.length}B)\n⚠️ 안내: 호스트에 저장된 인레이 파일은 Plugin v3 제한으로 되돌리기 시 자동 삭제할 수 없습니다.`,
      hostBinding: null,
    };
  }

  if (mode === 'module_asset') {
    if (!adapter.hasCapability('saveAsset') || typeof adapter.api?.saveAsset !== 'function') {
      return { ok: false, error: '현재 호스트는 saveAsset API를 지원하지 않습니다.' };
    }
    if (typeof proposal.content !== 'string' || !proposal.content.trim()) {
      return { ok: false, error: 'module_asset 등록에는 content 문자열이 필요합니다.' };
    }
    const db = await adapter.readDbSubset(['modules']);
    const modules = Array.isArray(db?.modules) ? db.modules : [];
    const idx = adapter._resolveWriteModuleIndex(modules, proposal, target);
    if (idx < 0 || !modules[idx]) {
      return { ok: false, error: '에셋을 등록할 모듈을 찾을 수 없습니다(moduleIndex를 지정하세요).' };
    }
    const decoded = decodeTextAssetBytes(proposal.content, proposal.mimeType || 'image/svg+xml');
    const ext = String(proposal.ext || (decoded.mimeType.includes('svg') ? 'svg' : 'txt')).replace(/[^a-z0-9]/gi, '') || 'svg';
    return {
      ok: true,
      mode,
      name,
      ext,
      decoded,
      moduleIndex: idx,
      moduleName: modules[idx].name || `모듈 #${idx + 1}`,
      modules,
      label: `모듈 에셋 등록: ${modules[idx].name || `#${idx + 1}`} / ${name}.${ext}`,
      before: JSON.stringify((modules[idx].assets || []).map(a => a[0]), null, 2),
      after: JSON.stringify([...(modules[idx].assets || []).map(a => a[0]), name], null, 2),
      hostBinding: null,
    };
  }

  // character_asset / bind_asset / rename_asset
  const resolved = await adapter._resolveTargetCharacter(proposal, binding, '적용');
  const { char, charIndex, crossCharacter } = resolved;
  const crossPrefix = adapter._formatCrossPrefix({ char, charIndex, crossCharacter });
  const targetField = proposal.targetField === 'emotionImages' ? 'emotionImages' : 'additionalAssets';

  if (mode === 'rename_asset') {
    const oldName = String(proposal.oldName || '').trim();
    if (!oldName) return { ok: false, error: 'rename_asset에는 oldName과 새 name이 필요합니다.' };
    const list = Array.isArray(char[targetField]) ? char[targetField] : [];
    const idx = list.findIndex(item => Array.isArray(item) && item[0] === oldName);
    if (idx < 0) return { ok: false, error: `${targetField}에서 "${oldName}" 에셋을 찾을 수 없습니다.` };
    return {
      ok: true,
      mode,
      name,
      oldName,
      assetIdx: idx,
      targetField,
      char,
      charIndex,
      crossCharacter,
      label: `${crossPrefix}에셋 이름 변경: ${oldName} → ${name}`,
      before: JSON.stringify(list[idx]),
      after: JSON.stringify([name, ...list[idx].slice(1)]),
      hostBinding: { charIndex, crossCharacter },
    };
  }

  if (mode === 'bind_asset') {
    const assetId = String(proposal.assetId || '').trim();
    if (!assetId) return { ok: false, error: 'bind_asset에는 연결할 기존 assetId가 필요합니다.' };
    const ext = String(proposal.ext || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
    const entry = targetField === 'emotionImages' ? [name, assetId] : [name, assetId, ext];
    const list = Array.isArray(char[targetField]) ? char[targetField] : [];
    return {
      ok: true,
      mode,
      name,
      ext,
      assetId,
      entry,
      targetField,
      char,
      charIndex,
      crossCharacter,
      label: `${crossPrefix}에셋 연결 (${targetField}): ${name}`,
      before: JSON.stringify(list.map(a => a?.[0]), null, 2),
      after: JSON.stringify([...list.map(a => a?.[0]), name], null, 2),
      hostBinding: { charIndex, crossCharacter },
    };
  }

  if (mode === 'character_asset') {
    if (!adapter.hasCapability('saveAsset') || typeof adapter.api?.saveAsset !== 'function') {
      return { ok: false, error: '현재 호스트는 saveAsset API를 지원하지 않습니다.' };
    }
    if (typeof proposal.content !== 'string' || !proposal.content.trim()) {
      return { ok: false, error: 'character_asset 등록에는 content(SVG/텍스트/data URL)가 필요합니다.' };
    }
    const decoded = decodeTextAssetBytes(proposal.content, proposal.mimeType || 'image/svg+xml');
    const ext = String(proposal.ext || (decoded.mimeType.includes('svg') ? 'svg' : 'txt')).replace(/[^a-z0-9]/gi, '') || 'svg';
    const list = Array.isArray(char[targetField]) ? char[targetField] : [];
    return {
      ok: true,
      mode,
      name,
      ext,
      decoded,
      targetField,
      char,
      charIndex,
      crossCharacter,
      label: `${crossPrefix}에셋 등록 (${targetField}): ${name}.${ext}`,
      before: JSON.stringify(list.map(a => a?.[0]), null, 2),
      after: JSON.stringify([...list.map(a => a?.[0]), name], null, 2),
      hostBinding: { charIndex, crossCharacter },
    };
  }

  return { ok: false, error: `지원하지 않는 register_asset mode입니다: ${mode}` };
}

// ---------------------------------------------------------------------------
// 4. repair_workspace
// ---------------------------------------------------------------------------

async function planWorkspaceRepair(adapter, proposal, binding = null) {
  const doCharOrder = Boolean(proposal.checkCharOrder);
  const doOrphanLore = Boolean(proposal.fixOrphanLore);
  const doChatIds = Boolean(proposal.fixMissingChatIds);
  const doRegexFlags = Boolean(proposal.fixRegexFlags);
  if (!doCharOrder && !doOrphanLore && !doChatIds && !doRegexFlags) {
    return { ok: false, error: 'repair_workspace에는 checkCharOrder, fixOrphanLore, fixMissingChatIds, fixRegexFlags 중 하나 이상을 true로 지정해야 합니다.' };
  }
  if (doCharOrder && (!adapter.hasCapability('checkCharOrder') || typeof adapter.api?.checkCharOrder !== 'function')) {
    return { ok: false, error: '현재 호스트는 checkCharOrder API를 지원하지 않습니다.' };
  }

  const actions = [];
  const beforeLines = [];
  const afterLines = [];
  let charBundle = null;
  let chatBundle = null;
  let beforeCharOrder = null;

  if (doCharOrder) {
    const db = (await adapter.readDbSubset(['characterOrder'])) || {};
    beforeCharOrder = Array.isArray(db.characterOrder) ? clone(db.characterOrder) : null;
    actions.push('checkCharOrder');
    beforeLines.push(`characterOrder: ${beforeCharOrder ? `${beforeCharOrder.length}개 항목` : '(조회 불가)'}`);
    afterLines.push('characterOrder: 호스트 checkCharOrder()로 정합성 복구');
  }

  if (doOrphanLore || doChatIds || doRegexFlags) {
    const resolved = await adapter._resolveTargetCharacter(proposal, binding, '적용');
    const { char, charIndex, crossCharacter } = resolved;
    const nextChar = clone(char);
    let charChanged = false;

    if (doOrphanLore) {
      const orphans = findOrphanLoreIndices(nextChar.globalLore);
      if (orphans.length > 0) {
        for (const i of orphans) nextChar.globalLore[i].folder = '';
        charChanged = true;
        actions.push(`charOrphanLore(${orphans.length})`);
        beforeLines.push(`캐릭터 고아 로어북 ${orphans.length}건 (깨진 folder 참조)`);
        afterLines.push(`캐릭터 고아 로어북 ${orphans.length}건 → 루트로 복구`);
      }
      // Also check target chat localLore if available
      try {
        const chatRes = await adapter._resolveTargetChat(proposal, binding, '적용');
        if (chatRes?.chat && Array.isArray(chatRes.chat.localLore)) {
          const chatOrphans = findOrphanLoreIndices(chatRes.chat.localLore);
          if (chatOrphans.length > 0) {
            const nextChat = clone(chatRes.chat);
            for (const i of chatOrphans) nextChat.localLore[i].folder = '';
            chatBundle = { ...chatRes, nextChat, chatOrphans };
            actions.push(`chatOrphanLore(${chatOrphans.length})`);
            beforeLines.push(`채팅 고아 로어북 ${chatOrphans.length}건 (깨진 folder 참조)`);
            afterLines.push(`채팅 고아 로어북 ${chatOrphans.length}건 → 루트로 복구`);
          }
        }
      } catch {}
    }

    if (doChatIds && Array.isArray(nextChar.chats)) {
      let fixed = 0;
      for (const c of nextChar.chats) {
        if (c && !c._placeholder && (!c.id || typeof c.id !== 'string')) {
          c.id = makeUuid();
          fixed++;
        }
      }
      if (fixed > 0) {
        charChanged = true;
        actions.push(`missingChatIds(${fixed})`);
        beforeLines.push(`chat.id 누락 채팅 ${fixed}건`);
        afterLines.push(`채팅 ${fixed}건에 UUID chat.id 부여`);
      }
    }

    if (doRegexFlags && Array.isArray(nextChar.customscript)) {
      let fixed = 0;
      for (const rx of nextChar.customscript) {
        if (rx && hasInvalidRegexFlags(rx.flag)) {
          rx.flag = cleanRegexFlags(rx.flag);
          fixed++;
        }
      }
      if (fixed > 0) {
        charChanged = true;
        actions.push(`invalidRegexFlags(${fixed})`);
        beforeLines.push(`잘못된 정규식 플래그 ${fixed}건`);
        afterLines.push(`정규식 플래그 ${fixed}건 정화 완료`);
      }
    }

    if (charChanged) {
      charBundle = { char, charIndex, crossCharacter, nextChar };
    }
  }

  if (actions.length === 0) {
    return { ok: false, error: '수리가 필요한 워크스페이스 이상 항목이 발견되지 않았습니다.' };
  }

  const crossPrefix = charBundle
    ? adapter._formatCrossPrefix({ char: charBundle.char, charIndex: charBundle.charIndex, crossCharacter: charBundle.crossCharacter })
    : '';
  return {
    ok: true,
    doCharOrder,
    beforeCharOrder,
    charBundle,
    chatBundle,
    actions,
    label: `${crossPrefix}워크스페이스 수리 (${actions.join(', ')})`,
    before: beforeLines.join('\n'),
    after: afterLines.join('\n'),
    hostBinding: charBundle ? { charIndex: charBundle.charIndex, crossCharacter: charBundle.crossCharacter } : null,
  };
}

// ---------------------------------------------------------------------------
// 5. manage_chat_messages
// ---------------------------------------------------------------------------

async function planManageChatMessages(adapter, proposal, binding = null) {
  const op = String(proposal.operation || '').trim();
  if (!['edit', 'toggle_disabled', 'bookmark', 'delete'].includes(op)) {
    return { ok: false, error: 'manage_chat_messages의 operation은 edit, toggle_disabled, bookmark, delete 중 하나여야 합니다.' };
  }
  const msgIdx = proposal.messageIndex;
  if (!Number.isInteger(msgIdx) || msgIdx < 0) {
    return { ok: false, error: 'manage_chat_messages에는 0 이상의 정수 messageIndex가 필요합니다.' };
  }
  const resolved = await adapter._resolveTargetChat(proposal, binding, '적용');
  const { char, charIndex, chat, chatIndex, crossCharacter, crossChat } = resolved;
  if (chat?._placeholder || (Array.isArray(chat?.message) && chat.message.length === 1 && chat.message[0]?.data === '[Cold Storage]')) {
    return { ok: false, error: '콜드 스토리지에 보관된 채팅 메시지는 RisuAI에서 먼저 해당 채팅을 연 뒤 수정하세요.' };
  }
  const messages = Array.isArray(chat?.message) ? chat.message : [];
  if (msgIdx >= messages.length) {
    return { ok: false, error: `메시지 #${msgIdx + 1}을(를) 찾을 수 없습니다(총 ${messages.length}개).` };
  }
  const targetMsg = messages[msgIdx];
  if (typeof proposal.expectedSnippet === 'string' && proposal.expectedSnippet.trim()) {
    if (!String(targetMsg?.data ?? '').includes(proposal.expectedSnippet.trim())) {
      return { ok: false, error: `메시지 #${msgIdx + 1}의 내용이 지정된 expectedSnippet과 일치하지 않아 중단했습니다.` };
    }
  }

  const crossPrefix = adapter._formatCrossPrefix({ char, charIndex, chat, chatIndex, crossCharacter, crossChat });
  const nextChat = clone(chat);
  let label;
  let before;
  let after;

  if (op === 'edit') {
    if (typeof proposal.content !== 'string') {
      return { ok: false, error: '메시지 편집(edit)에는 content 문자열이 필요합니다.' };
    }
    before = String(targetMsg.data ?? '');
    after = proposal.content;
    nextChat.message[msgIdx].data = proposal.content;
    label = `${crossPrefix}메시지 #${msgIdx + 1} (${targetMsg.role || 'char'}) 편집`;
  } else if (op === 'toggle_disabled') {
    const nextDisabled = proposal.disabled === 'allBefore'
      ? 'allBefore'
      : (proposal.disabled !== undefined ? Boolean(proposal.disabled) : !Boolean(targetMsg.disabled));
    before = `disabled: ${JSON.stringify(targetMsg.disabled ?? false)}\n내용: ${snippetOf(targetMsg.data)}`;
    after = `disabled: ${JSON.stringify(nextDisabled)}\n내용: ${snippetOf(targetMsg.data)}`;
    nextChat.message[msgIdx].disabled = nextDisabled;
    label = `${crossPrefix}메시지 #${msgIdx + 1} ${nextDisabled ? '비활성화' : '활성화'}`;
  } else if (op === 'bookmark') {
    const currentBm = Boolean(targetMsg.isComment || targetMsg.bookmarked);
    const nextBm = proposal.bookmarked !== undefined ? Boolean(proposal.bookmarked) : !currentBm;
    before = `bookmarked: ${currentBm}\n내용: ${snippetOf(targetMsg.data)}`;
    after = `bookmarked: ${nextBm}\n내용: ${snippetOf(targetMsg.data)}`;
    nextChat.message[msgIdx].bookmarked = nextBm;
    if (typeof proposal.bookmarkNote === 'string') {
      nextChat.message[msgIdx].bookmarkNote = proposal.bookmarkNote;
    }
    label = `${crossPrefix}메시지 #${msgIdx + 1} 북마크 ${nextBm ? '설정' : '해제'}`;
  } else if (op === 'delete') {
    before = `[#${msgIdx + 1} · ${targetMsg.role || 'char'}${targetMsg.chatId ? ` · id:${targetMsg.chatId}` : ''}]\n${String(targetMsg.data ?? '')}`;
    after = '(메시지 삭제됨 — 되돌리기로 정확히 복원 가능)';
    nextChat.message.splice(msgIdx, 1);
    label = `${crossPrefix}메시지 #${msgIdx + 1} 삭제 (${snippetOf(targetMsg.data, 24)})`;
  }

  return {
    ok: true,
    op,
    char,
    charIndex,
    chat,
    chatIndex,
    crossCharacter,
    crossChat,
    nextChat,
    label,
    before,
    after,
    hostBinding: { charIndex, chatIndex, chatId: chat?.id || null, crossCharacter, crossChat },
  };
}

// ---------------------------------------------------------------------------
// 6. update_memory (HypaV3 / HypaV2 / Supa)
// ---------------------------------------------------------------------------

async function planUpdateMemory(adapter, proposal, binding = null) {
  const memoryType = String(proposal.memoryType || 'supa').trim();
  if (!['supa', 'hypaV3', 'hypaV2'].includes(memoryType)) {
    return { ok: false, error: 'update_memory의 memoryType은 supa, hypaV3, hypaV2 중 하나여야 합니다.' };
  }
  const resolved = await adapter._resolveTargetChat(proposal, binding, '적용');
  const { char, charIndex, chat, chatIndex, crossCharacter, crossChat } = resolved;
  const crossPrefix = adapter._formatCrossPrefix({ char, charIndex, chat, chatIndex, crossCharacter, crossChat });
  const nextChat = clone(chat);
  let label;
  let before;
  let after;
  let notice = '';

  if (memoryType === 'supa') {
    if (typeof proposal.text !== 'string') {
      return { ok: false, error: 'supa 메모리 수정에는 text 문자열이 필요합니다.' };
    }
    before = String(chat.supaMemoryData ?? '');
    after = proposal.text;
    nextChat.supaMemoryData = proposal.text;
    label = `${crossPrefix}Supa 메모리 요약 수정`;
  } else if (memoryType === 'hypaV3') {
    notice = '⚠️ HypaV3 임베딩 안내: 요약 본문·중요도만 수정되며 기존 검색 임베딩 벡터는 플러그인이 재계산하지 않아 일시적으로 어긋날 수 있습니다.';
    if (!nextChat.hypaV3Data || typeof nextChat.hypaV3Data !== 'object') {
      nextChat.hypaV3Data = { summaries: [], metrics: {} };
    }
    if (!Array.isArray(nextChat.hypaV3Data.summaries)) nextChat.hypaV3Data.summaries = [];
    const summaries = nextChat.hypaV3Data.summaries;
    const op = String(proposal.operation || (Number.isInteger(proposal.summaryIndex) ? 'edit' : 'add')).trim();

    if (op === 'add') {
      if (typeof proposal.text !== 'string' || !proposal.text.trim()) {
        return { ok: false, error: 'HypaV3 요약 추가에는 text 문자열이 필요합니다.' };
      }
      const entry = {
        text: proposal.text,
        chatMemos: Array.isArray(proposal.chatMemos) ? proposal.chatMemos.map(String) : [],
        isImportant: Boolean(proposal.isImportant),
        ...(Array.isArray(proposal.tags) ? { tags: proposal.tags.map(String) } : {}),
      };
      before = `(기존 요약 ${summaries.length}개)`;
      after = `${JSON.stringify(entry, null, 2)}\n\n${notice}`;
      summaries.push(entry);
      label = `${crossPrefix}HypaV3 요약 추가 (#${summaries.length})`;
    } else {
      const idx = proposal.summaryIndex;
      if (!Number.isInteger(idx) || idx < 0 || idx >= summaries.length) {
        return { ok: false, error: `HypaV3 요약 #${Number.isInteger(idx) ? idx + 1 : '?'}을(를) 찾을 수 없습니다(총 ${summaries.length}개).` };
      }
      const cur = summaries[idx];
      before = JSON.stringify(cur, null, 2);
      if (op === 'remove') {
        summaries.splice(idx, 1);
        after = `(요약 #${idx + 1} 삭제됨)\n\n${notice}`;
        label = `${crossPrefix}HypaV3 요약 #${idx + 1} 삭제`;
      } else {
        if (typeof proposal.text === 'string') cur.text = proposal.text;
        if (proposal.isImportant !== undefined) cur.isImportant = Boolean(proposal.isImportant);
        if (Array.isArray(proposal.tags)) cur.tags = proposal.tags.map(String);
        after = `${JSON.stringify(cur, null, 2)}\n\n${notice}`;
        label = `${crossPrefix}HypaV3 요약 #${idx + 1} 수정`;
      }
    }
  } else if (memoryType === 'hypaV2') {
    notice = '⚠️ HypaV2 임베딩 안내: 청크 본문만 수정되며 임베딩 벡터는 재계산되지 않아 검색 결과와 일시적으로 어긋날 수 있습니다.';
    if (!nextChat.hypaV2Data || typeof nextChat.hypaV2Data !== 'object') {
      nextChat.hypaV2Data = { chunks: [], mainChunks: [], lastMainChunkID: 0 };
    }
    if (!Array.isArray(nextChat.hypaV2Data.chunks)) nextChat.hypaV2Data.chunks = [];
    const chunks = nextChat.hypaV2Data.chunks;
    const idx = proposal.summaryIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= chunks.length) {
      return { ok: false, error: `HypaV2 청크 #${Number.isInteger(idx) ? idx + 1 : '?'}을(를) 찾을 수 없습니다(총 ${chunks.length}개).` };
    }
    if (typeof proposal.text !== 'string') {
      return { ok: false, error: 'HypaV2 청크 수정에는 text 문자열이 필요합니다.' };
    }
    before = String(chunks[idx]?.text ?? '');
    chunks[idx].text = proposal.text;
    after = `${proposal.text}\n\n${notice}`;
    label = `${crossPrefix}HypaV2 요약 청크 #${idx + 1} 수정`;
  }

  return {
    ok: true,
    char,
    charIndex,
    chat,
    chatIndex,
    crossCharacter,
    crossChat,
    nextChat,
    label,
    before,
    after,
    notice,
    hostBinding: { charIndex, chatIndex, chatId: chat?.id || null, crossCharacter, crossChat },
  };
}

// ---------------------------------------------------------------------------
// 7. update_onboarding
// ---------------------------------------------------------------------------

async function planUpdateOnboarding(adapter, proposal, binding = null) {
  const resolved = await adapter._resolveTargetCharacter(proposal, binding, '적용');
  const { char, charIndex, crossCharacter } = resolved;
  const crossPrefix = adapter._formatCrossPrefix({ char, charIndex, crossCharacter });

  const prev = char.onboarding && typeof char.onboarding === 'object'
    ? clone(char.onboarding)
    : { enabled: false, title: '', description: '', fields: [] };
  const next = clone(prev);

  if (proposal.enabled !== undefined) next.enabled = Boolean(proposal.enabled);
  if (typeof proposal.title === 'string') next.title = proposal.title;
  if (typeof proposal.description === 'string') next.description = proposal.description;
  if (Array.isArray(proposal.fields)) {
    const normalized = [];
    for (const f of proposal.fields) {
      if (!f || typeof f !== 'object' || Array.isArray(f)) {
        return { ok: false, error: 'onboarding fields 항목은 JSON 객체여야 합니다.' };
      }
      const fType = String(f.type || 'text').trim();
      if (!ALLOWED_ONBOARDING_FIELD_TYPES.has(fType)) {
        return { ok: false, error: `지원하지 않는 온보딩 필드 타입입니다: ${fType}` };
      }
      const id = String(f.id || f.varName || `field_${normalized.length + 1}`).trim();
      const label = String(f.label || id).trim();
      normalized.push({
        id,
        label,
        type: fType,
        ...(f.defaultValue !== undefined ? { defaultValue: f.defaultValue } : {}),
        ...(Array.isArray(f.options) ? { options: f.options.map(String) } : {}),
        ...(typeof f.varName === 'string' && f.varName.trim() ? { varName: f.varName.trim() } : {}),
        ...(typeof f.promptTemplate === 'string' ? { promptTemplate: f.promptTemplate } : {}),
      });
    }
    if (proposal.merge === true && Array.isArray(next.fields)) {
      const byId = new Map(next.fields.map(item => [item.id, item]));
      for (const nf of normalized) byId.set(nf.id, nf);
      next.fields = [...byId.values()];
    } else {
      next.fields = normalized;
    }
  }

  const nextChar = clone(char);
  nextChar.onboarding = next;
  return {
    ok: true,
    char,
    charIndex,
    crossCharacter,
    nextChar,
    label: `${crossPrefix}캐릭터 온보딩 폼 설정 (${next.fields?.length || 0}개 항목)`,
    before: JSON.stringify(prev, null, 2),
    after: JSON.stringify(next, null, 2),
    hostBinding: { charIndex, crossCharacter },
  };
}

// ---------------------------------------------------------------------------
// 8. update_group_chat
// ---------------------------------------------------------------------------

async function planUpdateGroupChat(adapter, proposal, binding = null) {
  const resolved = await adapter._resolveTargetCharacter(proposal, binding, '적용');
  const { char, charIndex, crossCharacter } = resolved;
  if (char?.type !== 'group') {
    return { ok: false, error: 'update_group_chat은 그룹챗(type: "group") 캐릭터에만 사용할 수 있습니다.' };
  }
  const crossPrefix = adapter._formatCrossPrefix({ char, charIndex, crossCharacter });
  const nextChar = clone(char);

  const members = Array.isArray(nextChar.characters) ? [...nextChar.characters] : [];
  const talks = Array.isArray(nextChar.characterTalks) ? [...nextChar.characterTalks] : members.map(() => 1 / Math.max(1, members.length));
  const active = Array.isArray(nextChar.characterActive) ? [...nextChar.characterActive] : members.map(() => true);

  if (Array.isArray(proposal.characters)) {
    const clean = proposal.characters.map(String).filter(Boolean);
    if (clean.length === 0) return { ok: false, error: '그룹챗 멤버 목록은 최소 1명 이상이어야 합니다.' };
    nextChar.characters = clean;
  } else {
    if (Array.isArray(proposal.addMembers)) {
      for (const m of proposal.addMembers.map(String).filter(Boolean)) {
        if (!members.includes(m)) {
          members.push(m);
          talks.push(0.5);
          active.push(true);
        }
      }
    }
    if (Array.isArray(proposal.removeMembers)) {
      const rmSet = new Set(proposal.removeMembers.map(String));
      const keptM = [];
      const keptT = [];
      const keptA = [];
      for (let i = 0; i < members.length; i++) {
        if (!rmSet.has(members[i])) {
          keptM.push(members[i]);
          keptT.push(talks[i] ?? 0.5);
          keptA.push(active[i] ?? true);
        }
      }
      if (keptM.length === 0) return { ok: false, error: '그룹챗의 마지막 멤버는 제거할 수 없습니다.' };
      nextChar.characters = keptM;
      nextChar.characterTalks = keptT;
      nextChar.characterActive = keptA;
    } else {
      nextChar.characters = members;
      nextChar.characterTalks = talks;
      nextChar.characterActive = active;
    }
  }

  // Re-align characterTalks / characterActive length with characters
  const count = nextChar.characters.length;
  if (Array.isArray(proposal.characterTalks)) {
    if (proposal.characterTalks.length !== count) {
      return { ok: false, error: `characterTalks 길이(${proposal.characterTalks.length})가 그룹 멤버 수(${count})와 일치해야 합니다.` };
    }
    nextChar.characterTalks = proposal.characterTalks.map(n => Math.max(0, Math.min(1, Number(n) || 0)));
  } else {
    nextChar.characterTalks = Array.from({ length: count }, (_, i) => Number(nextChar.characterTalks?.[i] ?? 0.5));
  }
  if (Array.isArray(proposal.characterActive)) {
    if (proposal.characterActive.length !== count) {
      return { ok: false, error: `characterActive 길이(${proposal.characterActive.length})가 그룹 멤버 수(${count})와 일치해야 합니다.` };
    }
    nextChar.characterActive = proposal.characterActive.map(Boolean);
  } else {
    nextChar.characterActive = Array.from({ length: count }, (_, i) => nextChar.characterActive?.[i] !== false);
  }

  if (proposal.setMemberActive && typeof proposal.setMemberActive === 'object') {
    for (const [k, v] of Object.entries(proposal.setMemberActive)) {
      const idx = /^\d+$/.test(k) ? Number(k) : nextChar.characters.indexOf(k);
      if (idx < 0 || idx >= count) return { ok: false, error: `그룹 멤버 "${k}"을(를) 찾을 수 없습니다.` };
      nextChar.characterActive[idx] = Boolean(v);
    }
  }
  if (proposal.setMemberTalk && typeof proposal.setMemberTalk === 'object') {
    for (const [k, v] of Object.entries(proposal.setMemberTalk)) {
      const idx = /^\d+$/.test(k) ? Number(k) : nextChar.characters.indexOf(k);
      if (idx < 0 || idx >= count) return { ok: false, error: `그룹 멤버 "${k}"을(를) 찾을 수 없습니다.` };
      nextChar.characterTalks[idx] = Math.max(0, Math.min(1, Number(v) || 0));
    }
  }

  if (typeof proposal.name === 'string' && proposal.name.trim()) nextChar.name = proposal.name.trim();
  if (typeof proposal.firstMessage === 'string') nextChar.firstMessage = proposal.firstMessage;
  if (proposal.orderByOrder !== undefined) nextChar.orderByOrder = Boolean(proposal.orderByOrder);
  if (proposal.useCharacterLore !== undefined) nextChar.useCharacterLore = Boolean(proposal.useCharacterLore);
  if (proposal.autoMode !== undefined) nextChar.autoMode = Boolean(proposal.autoMode);

  const summarizeGroup = (g) => ({
    name: g.name,
    characters: g.characters,
    characterActive: g.characterActive,
    characterTalks: g.characterTalks,
    orderByOrder: Boolean(g.orderByOrder),
    useCharacterLore: Boolean(g.useCharacterLore),
    autoMode: Boolean(g.autoMode),
  });

  return {
    ok: true,
    char,
    charIndex,
    crossCharacter,
    nextChar,
    label: `${crossPrefix}그룹챗 설정 수정 (${nextChar.name || '그룹'})`,
    before: JSON.stringify(summarizeGroup(char), null, 2),
    after: JSON.stringify(summarizeGroup(nextChar), null, 2),
    hostBinding: { charIndex, crossCharacter },
  };
}

// ---------------------------------------------------------------------------
// 9. organize_chat_folders (anti-orphan rules)
// ---------------------------------------------------------------------------

async function planOrganizeChatFolders(adapter, proposal, binding = null) {
  const op = String(proposal.operation || '').trim();
  if (!['create_folder', 'rename_folder', 'delete_folder', 'move_chats', 'toggle_fold'].includes(op)) {
    return { ok: false, error: 'organize_chat_folders의 operation은 create_folder, rename_folder, delete_folder, move_chats, toggle_fold 중 하나여야 합니다.' };
  }
  const resolved = await adapter._resolveTargetCharacter(proposal, binding, '적용');
  const { char, charIndex, crossCharacter } = resolved;
  const crossPrefix = adapter._formatCrossPrefix({ char, charIndex, crossCharacter });
  const nextChar = clone(char);
  if (!Array.isArray(nextChar.chatFolders)) nextChar.chatFolders = [];
  if (!Array.isArray(nextChar.chats)) nextChar.chats = [];

  const findFolder = () => {
    if (typeof proposal.folderId === 'string' && proposal.folderId.trim()) {
      return nextChar.chatFolders.find(f => f && f.id === proposal.folderId.trim()) || null;
    }
    if (typeof proposal.folderName === 'string' && proposal.folderName.trim()) {
      const targetName = proposal.folderName.trim();
      return nextChar.chatFolders.find(f => f && f.name === targetName) || null;
    }
    return null;
  };

  const placeholderUpdates = [];
  const setChatFolder = (idx, targetFolderId) => {
    if (nextChar.chats[idx]?._placeholder) {
      placeholderUpdates.push({ chatIndex: idx, folderId: targetFolderId });
    } else {
      nextChar.chats[idx].folderId = targetFolderId;
    }
  };

  let label;
  if (op === 'create_folder') {
    const name = String(proposal.folderName || proposal.newName || '').trim();
    if (!name) return { ok: false, error: 'create_folder에는 folderName이 필요합니다.' };
    const existing = nextChar.chatFolders.find(f => f && f.name === name);
    const folder = existing || { id: makeUuid(), name, folded: Boolean(proposal.folded) };
    if (!existing) nextChar.chatFolders.push(folder);
    if (Array.isArray(proposal.chatIndices)) {
      for (const idx of proposal.chatIndices) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= nextChar.chats.length) {
          return { ok: false, error: `채팅 #${Number.isInteger(idx) ? idx + 1 : '?'}을(를) 찾을 수 없습니다.` };
        }
        setChatFolder(idx, folder.id);
      }
    }
    label = `${crossPrefix}채팅 폴더 생성: ${name}`;
  } else if (op === 'rename_folder') {
    const folder = findFolder();
    if (!folder) return { ok: false, error: '이름을 바꿀 채팅 폴더를 찾을 수 없습니다.' };
    const newName = String(proposal.newName || '').trim();
    if (!newName) return { ok: false, error: 'rename_folder에는 newName이 필요합니다.' };
    const oldName = folder.name;
    folder.name = newName;
    label = `${crossPrefix}채팅 폴더 이름 변경: ${oldName} → ${newName}`;
  } else if (op === 'delete_folder') {
    const folder = findFolder();
    if (!folder) return { ok: false, error: '삭제할 채팅 폴더를 찾을 수 없습니다.' };
    nextChar.chatFolders = nextChar.chatFolders.filter(f => f.id !== folder.id);
    // Anti-orphan rule: move all chats inside the deleted folder back to root (including lazy placeholders)
    for (let idx = 0; idx < nextChar.chats.length; idx++) {
      const c = nextChar.chats[idx];
      if (!c) continue;
      if (c._placeholder) {
        try {
          const hydrated = await adapter._readChatAt(charIndex, idx, char);
          if (hydrated && hydrated.folderId === folder.id) {
            placeholderUpdates.push({ chatIndex: idx, folderId: null });
          }
        } catch {}
      } else if (c.folderId === folder.id) {
        c.folderId = null;
      }
    }
    label = `${crossPrefix}채팅 폴더 삭제 (내부 채팅 루트 이동): ${folder.name}`;
  } else if (op === 'toggle_fold') {
    const folder = findFolder();
    if (!folder) return { ok: false, error: '접기/펼치기할 채팅 폴더를 찾을 수 없습니다.' };
    folder.folded = proposal.folded !== undefined ? Boolean(proposal.folded) : !Boolean(folder.folded);
    label = `${crossPrefix}채팅 폴더 ${folder.folded ? '접기' : '펼치기'}: ${folder.name}`;
  } else if (op === 'move_chats') {
    if (!Array.isArray(proposal.chatIndices) || proposal.chatIndices.length === 0) {
      return { ok: false, error: 'move_chats에는 1개 이상의 chatIndices 배열이 필요합니다.' };
    }
    let targetFolderId = null;
    let folderLabel = '루트(폴더 해제)';
    if (proposal.moveToRoot !== true) {
      let folder = findFolder();
      if (!folder && typeof proposal.folderName === 'string' && proposal.folderName.trim()) {
        folder = { id: makeUuid(), name: proposal.folderName.trim(), folded: false };
        nextChar.chatFolders.push(folder);
      }
      if (!folder) return { ok: false, error: '이동할 채팅 폴더를 찾을 수 없습니다(folderId, folderName, 또는 moveToRoot: true 지정).' };
      targetFolderId = folder.id;
      folderLabel = folder.name;
    }
    for (const idx of proposal.chatIndices) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= nextChar.chats.length) {
        return { ok: false, error: `채팅 #${Number.isInteger(idx) ? idx + 1 : '?'}을(를) 찾을 수 없습니다.` };
      }
      setChatFolder(idx, targetFolderId);
    }
    label = `${crossPrefix}채팅 ${proposal.chatIndices.length}건 폴더 이동 → ${folderLabel}`;
  }

  const placeholderMap = new Map(placeholderUpdates.map(u => [u.chatIndex, u.folderId]));
  const snap = (c, applyOverrides = false) => ({
    chatFolders: (c.chatFolders || []).map(f => ({ id: f.id, name: f.name, folded: Boolean(f.folded) })),
    chats: (c.chats || []).map((ch, i) => ({
      chatIndex: i,
      name: ch.name || `채팅 ${i + 1}`,
      folderId: applyOverrides && placeholderMap.has(i) ? placeholderMap.get(i) : (ch.folderId || null),
    })),
  });

  return {
    ok: true,
    char,
    charIndex,
    crossCharacter,
    nextChar,
    placeholderUpdates,
    label,
    before: JSON.stringify(snap(char, false), null, 2),
    after: JSON.stringify(snap(nextChar, true), null, 2),
    hostBinding: { charIndex, crossCharacter },
  };
}

// ---------------------------------------------------------------------------
// 10. manage_extensions (declarative resident extensions)
// ---------------------------------------------------------------------------

function planManageExtensions(adapter, proposal) {
  const runtime = adapter.extensionRuntime;
  if (!runtime) return { ok: false, error: '상주 확장 런타임이 초기화되지 않았습니다.' };
  const op = String(proposal.operation || 'upsert').trim();

  if (op === 'upsert') {
    const checked = validateExtensionRule(proposal.rule);
    if (!checked.ok) return { ok: false, error: checked.error };
    const rule = checked.rule;
    if (!runtime.isTypeSupported(rule.type)) {
      return { ok: false, error: `현재 호스트는 "${EXTENSION_TYPE_LABELS[rule.type] || rule.type}"(${rule.type}) API를 지원하지 않습니다.` };
    }
    const existing = runtime.get(rule.id);
    const dryRun = dryRunExtensionRule(rule, proposal.dryRunSample ?? null);
    return {
      ok: true,
      op,
      rule,
      beforeRule: existing ? clone(existing) : null,
      dryRun,
      label: `상주 확장 ${existing ? '수정' : '추가'}: ${rule.name} (${EXTENSION_TYPE_LABELS[rule.type] || rule.type})`,
      before: existing ? JSON.stringify(existing, null, 2) : '(새 선언형 규칙)',
      after: JSON.stringify(rule, null, 2) + (dryRun.ok ? `\n\n[드라이런 결과]\n${JSON.stringify(dryRun, null, 2)}` : ''),
      hostBinding: null,
    };
  }

  if (op === 'toggle') {
    const ruleId = String(proposal.ruleId || '').trim();
    const existing = runtime.get(ruleId);
    if (!existing) return { ok: false, error: `확장 규칙(${ruleId || '미지정'})을 찾을 수 없습니다.` };
    const nextEnabled = proposal.enabled !== undefined ? Boolean(proposal.enabled) : !existing.enabled;
    return {
      ok: true,
      op,
      ruleId,
      nextEnabled,
      beforeRule: clone(existing),
      label: `상주 확장 ${nextEnabled ? '활성화' : '비활성화'}: ${existing.name}`,
      before: JSON.stringify({ id: existing.id, name: existing.name, enabled: existing.enabled }, null, 2),
      after: JSON.stringify({ id: existing.id, name: existing.name, enabled: nextEnabled }, null, 2),
      hostBinding: null,
    };
  }

  if (op === 'remove') {
    const ruleId = String(proposal.ruleId || '').trim();
    const existing = runtime.get(ruleId);
    if (!existing) return { ok: false, error: `삭제할 확장 규칙(${ruleId || '미지정'})을 찾을 수 없습니다.` };
    return {
      ok: true,
      op,
      ruleId,
      beforeRule: clone(existing),
      label: `상주 확장 삭제: ${existing.name}`,
      before: JSON.stringify(existing, null, 2),
      after: '(규칙 삭제 및 호스트 핸들러 즉시 해제)',
      hostBinding: null,
    };
  }

  return { ok: false, error: `지원하지 않는 manage_extensions operation입니다: ${op}` };
}

// ---------------------------------------------------------------------------
// 11. manage_bard_wiki (RisuBard-only · exact upstream BardWikiAPI contract)
// ---------------------------------------------------------------------------

async function planManageBardWiki(adapter, proposal) {
  if (!adapter.hasCapability('bardWiki')) {
    return { ok: false, error: '현재 호스트는 RisuBard BardWiki API를 지원하지 않습니다.' };
  }
  const bw = getBardWikiApi(adapter.api);
  if (!bw) return { ok: false, error: 'BardWiki 브리지 메서드를 찾을 수 없습니다.' };

  const op = String(proposal.operation || '').trim();
  if (!['save_document', 'set_grade', 'set_context_mode', 'trash_document'].includes(op)) {
    return { ok: false, error: 'manage_bard_wiki의 operation은 save_document, set_grade, set_context_mode, trash_document 중 하나여야 합니다.' };
  }

  let docs = [];
  if (bw.getDocuments) {
    try {
      const rawDocs = await bw.getDocuments();
      docs = Array.isArray(rawDocs) ? rawDocs : (Array.isArray(rawDocs?.documents) ? rawDocs.documents : []);
    } catch {}
  }
  const docId = String(proposal.documentId || proposal.id || '').trim();
  const existingDoc = docId ? (docs.find(d => d && String(d.id) === docId) || null) : null;
  const scopeNote = '(RisuBard 현재 열린 캐릭터·채팅 스코프 기준)';

  if (op === 'save_document') {
    if (!bw.saveDocument) return { ok: false, error: 'bardWiki.saveDocument API를 사용할 수 없습니다.' };
    const title = String(proposal.title || existingDoc?.title || '').trim();
    const markdown = typeof proposal.markdown === 'string'
      ? proposal.markdown
      : (typeof proposal.content === 'string' ? proposal.content : existingDoc?.content);
    if (!title || typeof markdown !== 'string') {
      return { ok: false, error: 'save_document에는 title과 markdown(또는 content) 문자열이 필요합니다.' };
    }
    const docType = String(proposal.type || existingDoc?.type || 'other').trim();
    if (!BARD_WIKI_DOC_TYPES.has(docType)) {
      return {
        ok: false,
        error: `허용되지 않는 BardWiki 문서 type입니다: ${docType}. 허용값: ${[...BARD_WIKI_DOC_TYPES].join(', ')}`,
      };
    }
    let followUpGrade = undefined;
    if (proposal.grade !== undefined) {
      const parsedGrade = normalizeBardWikiGrade(proposal.grade);
      if (!parsedGrade.ok) return parsedGrade;
      followUpGrade = parsedGrade.value;
    }
    const aliases = Array.isArray(proposal.aliases)
      ? proposal.aliases.map(String).filter(Boolean)
      : (Array.isArray(existingDoc?.aliases) ? existingDoc.aliases : undefined);

    // Exact upstream BardWikiDocumentWrite shape (risubard.d.ts:1284-1293)
    const docWrite = {
      ...(existingDoc ? { documentId: existingDoc.id, expectedContentHash: existingDoc.contentHash } : {}),
      type: docType,
      title,
      ...(aliases ? { aliases } : {}),
      markdown,
    };
    return {
      ok: true,
      op,
      bw,
      docWrite,
      followUpGrade,
      existingDoc: existingDoc ? clone(existingDoc) : null,
      label: `BardWiki 문서 ${existingDoc ? '수정' : '생성'}: ${title}`,
      before: existingDoc ? JSON.stringify(existingDoc, null, 2) : `(새 BardWiki 문서) ${scopeNote}`,
      after: `${JSON.stringify({ ...docWrite, ...(followUpGrade !== undefined ? { grade: followUpGrade } : {}) }, null, 2)}\n${scopeNote}`,
      hostBinding: null,
    };
  }

  if (op === 'set_grade') {
    if (!bw.setGrade) return { ok: false, error: 'bardWiki.setGrade API를 사용할 수 없습니다.' };
    if (!docId || proposal.grade === undefined) {
      return { ok: false, error: 'set_grade에는 documentId와 grade가 필요합니다.' };
    }
    if (!existingDoc) {
      return { ok: false, error: `BardWiki 문서(${docId})를 찾을 수 없습니다(contentHash 확인 필요).` };
    }
    const parsedGrade = normalizeBardWikiGrade(proposal.grade);
    if (!parsedGrade.ok) return parsedGrade;
    const gradeInput = {
      documentId: existingDoc.id,
      grade: parsedGrade.value,
      gradeBy: 'user',
      expectedContentHash: existingDoc.contentHash || '',
    };
    return {
      ok: true,
      op,
      bw,
      docId: existingDoc.id,
      gradeInput,
      grade: parsedGrade.value,
      beforeGrade: existingDoc.grade ?? null,
      existingDoc: clone(existingDoc),
      label: `BardWiki 등급 변경: ${existingDoc.title || docId} → ${parsedGrade.value === null ? '해제' : parsedGrade.value}`,
      before: `grade: ${existingDoc.grade ?? '(없음)'}`,
      after: `grade: ${parsedGrade.value === null ? 'null' : parsedGrade.value}\n${scopeNote}`,
      hostBinding: null,
    };
  }

  if (op === 'set_context_mode') {
    if (!bw.setContextMode) return { ok: false, error: 'bardWiki.setContextMode API를 사용할 수 없습니다.' };
    const mode = String(proposal.contextMode || proposal.mode || '').trim();
    if (!BARD_WIKI_CONTEXT_MODES.has(mode)) {
      return {
        ok: false,
        error: `BardWiki contextMode는 always, auto, never 중 하나여야 합니다(입력: ${mode || '없음'}).`,
      };
    }
    if (!docId) {
      return { ok: false, error: 'RisuBard setContextMode는 문서별 API이므로 대상 documentId가 필요합니다.' };
    }
    if (!existingDoc) {
      return { ok: false, error: `BardWiki 문서(${docId})를 찾을 수 없습니다(contentHash 확인 필요).` };
    }
    const modeInput = {
      documentId: existingDoc.id,
      contextMode: mode,
      expectedContentHash: existingDoc.contentHash || '',
    };
    const beforeMode = existingDoc.contextMode ?? 'auto';
    return {
      ok: true,
      op,
      bw,
      docId: existingDoc.id,
      modeInput,
      contextMode: mode,
      beforeMode,
      existingDoc: clone(existingDoc),
      label: `BardWiki 컨텍스트 모드 변경: ${existingDoc.title || docId} → ${mode}`,
      before: `contextMode: ${beforeMode}`,
      after: `contextMode: ${mode}\n${scopeNote}`,
      hostBinding: null,
    };
  }

  if (op === 'trash_document') {
    if (!bw.trashDocument) return { ok: false, error: 'bardWiki.trashDocument API를 사용할 수 없습니다.' };
    if (!docId) return { ok: false, error: 'trash_document에는 documentId가 필요합니다.' };
    return {
      ok: true,
      op,
      bw,
      docId,
      existingDoc: existingDoc ? clone(existingDoc) : null,
      label: `BardWiki 문서 휴지통 이동: ${existingDoc?.title || docId}`,
      before: existingDoc ? JSON.stringify(existingDoc, null, 2) : `documentId: ${docId}`,
      after: `(휴지통으로 이동됨 — 되돌리기로 복원 가능)\n${scopeNote}`,
      hostBinding: null,
    };
  }

  return { ok: false, error: `지원하지 않는 manage_bard_wiki operation입니다: ${op}` };
}

// ---------------------------------------------------------------------------
// 12. patch_risunest_conversation (RisuNest-only · exact ConversationPatchRequest)
// ---------------------------------------------------------------------------

async function planPatchRisuNestConversation(adapter, proposal) {
  if (!adapter.hasCapability('risunestPatch') || typeof adapter.api?.risunestPatchConversation !== 'function') {
    return { ok: false, error: '현재 호스트는 RisuNest risunestPatchConversation API를 지원하지 않습니다.' };
  }

  // Reject legacy/unsupported metadata keys clearly with actionable alternatives
  if (proposal.patch && typeof proposal.patch === 'object' && !Array.isArray(proposal.patch)) {
    const unsupported = Object.keys(proposal.patch).filter(
      k => !['messages', 'chatVariables', 'scriptstate'].includes(k)
    );
    if (unsupported.length > 0) {
      return {
        ok: false,
        error: `RisuNest risunestPatchConversation은 messages와 chatVariables 정밀 패치 전용입니다(미지원 키: ${unsupported.join(', ')}). 작가의 노트·메모리·채팅 제목 수정에는 update_field(authorNote)/update_memory를 사용하세요.`,
      };
    }
  }

  // Resolve target characterId & conversationId (either explicit or from active/target chat)
  let characterId = typeof proposal.characterId === 'string' && proposal.characterId.trim()
    ? proposal.characterId.trim()
    : '';
  let conversationId = typeof proposal.conversationId === 'string' && proposal.conversationId.trim()
    ? proposal.conversationId.trim()
    : '';
  let resolvedChat = null;

  if (!characterId || !conversationId) {
    try {
      const res = await adapter._resolveTargetChat(proposal, null, '조회');
      if (!characterId && res?.char?.chaId) characterId = String(res.char.chaId);
      if (!conversationId && res?.chat?.id) conversationId = String(res.chat.id);
      resolvedChat = res?.chat || null;
    } catch {}
  }

  // Normalize `messages` entries into ConversationPatchMessage[]
  const rawMessages = Array.isArray(proposal.messages)
    ? proposal.messages
    : (Array.isArray(proposal.patch?.messages) ? proposal.patch.messages : []);
  const normMessages = [];
  for (let i = 0; i < rawMessages.length; i++) {
    const entry = rawMessages[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `messages[${i}]는 객체여야 합니다.` };
    }
    if (!Number.isInteger(entry.index) || entry.index < 0) {
      return { ok: false, error: `messages[${i}].index는 0 이상의 정수여야 합니다.` };
    }
    const rawSet = entry.set && typeof entry.set === 'object' && !Array.isArray(entry.set)
      ? entry.set
      : (typeof entry.data === 'string' ? { data: entry.data } : null);
    if (!rawSet || Object.keys(rawSet).length === 0) {
      return { ok: false, error: `messages[${i}]에는 set 객체(또는 data 문자열)가 필요합니다.` };
    }
    for (const k of Object.keys(rawSet)) {
      if (BAD_KEYS.has(k)) return { ok: false, error: `허용되지 않는 키입니다: ${k}` };
    }
    normMessages.push({
      index: entry.index,
      messageId: entry.messageId !== undefined ? (entry.messageId === null ? null : String(entry.messageId)) : undefined,
      ...(entry.expected && typeof entry.expected === 'object' ? { expected: clone(entry.expected) } : {}),
      set: clone(rawSet),
    });
  }

  // Normalize `chatVariables` (supports array `[{ key, value, expected? }]` or map `{ hp: 90, gold: null }`)
  const rawVars = proposal.chatVariables !== undefined
    ? proposal.chatVariables
    : (proposal.patch?.chatVariables !== undefined ? proposal.patch.chatVariables : proposal.patch?.scriptstate);
  const normVars = [];
  if (Array.isArray(rawVars)) {
    for (let i = 0; i < rawVars.length; i++) {
      const v = rawVars[i];
      if (!v || typeof v !== 'object' || !String(v.key || '').trim()) {
        return { ok: false, error: `chatVariables[${i}]에는 key가 필요합니다.` };
      }
      const key = String(v.key).replace(/^\$+/, '').trim();
      if (!key || BAD_KEYS.has(key)) return { ok: false, error: `유효하지 않은 변수 키입니다: ${v.key}` };
      const val = v.value;
      if (val !== null && typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') {
        return { ok: false, error: `chatVariables[${i}].value는 문자열·숫자·불리언·null이어야 합니다.` };
      }
      normVars.push({
        key,
        ...(v.expected !== undefined ? { expected: v.expected } : {}),
        value: val,
      });
    }
  } else if (rawVars && typeof rawVars === 'object') {
    for (const [rawKey, val] of Object.entries(rawVars)) {
      const key = String(rawKey).replace(/^\$+/, '').trim();
      if (!key || BAD_KEYS.has(key)) return { ok: false, error: `유효하지 않은 변수 키입니다: ${rawKey}` };
      if (val !== null && typeof val !== 'string' && typeof val !== 'number' && typeof val !== 'boolean') {
        return { ok: false, error: `chatVariables["${key}"]는 문자열·숫자·불리언·null이어야 합니다.` };
      }
      normVars.push({ key, value: val });
    }
  }

  if (normMessages.length === 0 && normVars.length === 0) {
    return {
      ok: false,
      error: 'patch_risunest_conversation에는 1개 이상의 messages 또는 chatVariables 패치가 필요합니다.',
    };
  }

  // Read live ConversationContext via exact upstream 1-object signature
  let currentCtx = null;
  if (typeof adapter.api?.risunestReadConversationContext === 'function') {
    try {
      const ctxReq = {
        ...(characterId && conversationId ? { characterId, conversationId } : {}),
        ...(normVars.length > 0 ? { chatVariables: normVars.map(v => v.key) } : {}),
        ...(normMessages.length > 0 ? {
          messages: {
            startIndex: Math.min(...normMessages.map(m => m.index)),
            limit: Math.min(128, Math.max(...normMessages.map(m => m.index)) - Math.min(...normMessages.map(m => m.index)) + 1),
          },
        } : {}),
      };
      const read = await adapter.api.risunestReadConversationContext(ctxReq);
      if (read && typeof read === 'object') {
        currentCtx = read;
        if (!characterId && read.characterId) characterId = String(read.characterId);
        if (!conversationId && read.conversationId) conversationId = String(read.conversationId);
      }
    } catch {}
  }

  if (!characterId || !conversationId) {
    return {
      ok: false,
      error: 'RisuNest 대화 패치에 필요한 characterId 또는 conversationId를 확인할 수 없습니다.',
    };
  }

  const baseRevision = Number.isSafeInteger(currentCtx?.revision) ? currentCtx.revision : undefined;

  // Hydrate missing `messageId` & capture `before` snapshots for surgical Undo
  const ctxMsgStart = Number.isSafeInteger(currentCtx?.messages?.startIndex) ? currentCtx.messages.startIndex : 0;
  const ctxMsgs = Array.isArray(currentCtx?.messages?.messages)
    ? currentCtx.messages.messages
    : (Array.isArray(resolvedChat?.message) ? resolvedChat.message : []);
  const ctxVars = currentCtx?.chatVariables && typeof currentCtx.chatVariables === 'object'
    ? currentCtx.chatVariables
    : (resolvedChat?.scriptstate && typeof resolvedChat.scriptstate === 'object' ? resolvedChat.scriptstate : {});

  const beforeMessages = [];
  const finalMessages = [];
  for (const m of normMessages) {
    const liveMsg = Array.isArray(currentCtx?.messages?.messages)
      ? ctxMsgs[m.index - ctxMsgStart]
      : ctxMsgs[m.index];
    const messageId = m.messageId !== undefined
      ? m.messageId
      : (typeof liveMsg?.chatId === 'string' && liveMsg.chatId ? liveMsg.chatId : null);
    if (messageId === null && baseRevision === undefined) {
      return {
        ok: false,
        error: `메시지 #${m.index + 1}에 messageId가 없고 baseRevision도 확인되지 않아 안전하게 패치할 수 없습니다.`,
      };
    }
    const beforeSet = {};
    for (const field of Object.keys(m.set)) {
      beforeSet[field] = liveMsg && Object.hasOwn(liveMsg, field) ? clone(liveMsg[field]) : undefined;
    }
    beforeMessages.push({ index: m.index, messageId, before: beforeSet, after: clone(m.set) });
    finalMessages.push({
      index: m.index,
      messageId,
      ...(m.expected ? { expected: m.expected } : {}),
      set: m.set,
    });
  }

  const beforeVars = [];
  const finalVars = [];
  for (const v of normVars) {
    const liveVal = Object.hasOwn(ctxVars, v.key)
      ? ctxVars[v.key]
      : (Object.hasOwn(ctxVars, `$${v.key}`) ? ctxVars[`$${v.key}`] : null);
    const normalizedBefore = (liveVal === undefined || liveVal === null) ? null : liveVal;
    beforeVars.push({ key: v.key, before: normalizedBefore, after: v.value });
    finalVars.push({
      key: v.key,
      ...(v.expected !== undefined ? { expected: v.expected } : {}),
      value: v.value,
    });
  }

  const request = {
    characterId,
    conversationId,
    mutationId: makeUuid(),
    ...(baseRevision !== undefined ? { baseRevision } : {}),
    messages: finalMessages,
    chatVariables: finalVars,
  };

  const parts = [];
  if (finalMessages.length > 0) parts.push(`메시지 ${finalMessages.length}건`);
  if (finalVars.length > 0) parts.push(`채팅 변수 ${finalVars.length}건`);

  return {
    ok: true,
    request,
    beforeMessages,
    beforeVars,
    label: `RisuNest 대화 정밀 패치 (${conversationId}: ${parts.join(', ')})`,
    before: JSON.stringify({ messages: beforeMessages, chatVariables: beforeVars }, null, 2),
    after: JSON.stringify({ messages: finalMessages, chatVariables: finalVars }, null, 2),
    hostBinding: null,
  };
}

// ---------------------------------------------------------------------------
// Public entry points wired into HostAdapter
// ---------------------------------------------------------------------------

async function previewM3Proposal(adapter, proposal, target) {
  switch (proposal.action) {
    case 'update_theme': {
      const plan = await planThemeUpdate(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: JSON.stringify(plan.beforeSummary, null, 2),
        after: JSON.stringify(plan.afterSummary, null, 2),
        label: proposal.title || `테마 · 스타일 변경 (${Object.keys(plan.afterSummary).join(', ')})`,
        target,
        hostBinding: null,
      };
    }
    case 'set_chat_panel': {
      const plan = planChatPanel(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.beforeHtml || '(열려 있는 HUD 없음)',
        after: plan.clear ? '(채팅 HUD 패널 닫기)' : plan.afterHtml,
        label: plan.title,
        target,
        hostBinding: null,
      };
    }
    case 'register_asset': {
      const plan = await planRegisterAsset(adapter, proposal, target);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: plan.hostBinding,
      };
    }
    case 'repair_workspace': {
      const plan = await planWorkspaceRepair(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: plan.hostBinding,
      };
    }
    case 'manage_chat_messages': {
      const plan = await planManageChatMessages(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: plan.hostBinding,
      };
    }
    case 'update_memory': {
      const plan = await planUpdateMemory(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: plan.hostBinding,
      };
    }
    case 'update_onboarding': {
      const plan = await planUpdateOnboarding(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: plan.hostBinding,
      };
    }
    case 'update_group_chat': {
      const plan = await planUpdateGroupChat(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: plan.hostBinding,
      };
    }
    case 'organize_chat_folders': {
      const plan = await planOrganizeChatFolders(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: plan.hostBinding,
      };
    }
    case 'manage_extensions': {
      const plan = planManageExtensions(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: null,
      };
    }
    case 'manage_bard_wiki': {
      const plan = await planManageBardWiki(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: null,
      };
    }
    case 'patch_risunest_conversation': {
      const plan = await planPatchRisuNestConversation(adapter, proposal);
      if (!plan.ok) return { ok: false, error: plan.error };
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        label: plan.label,
        target,
        hostBinding: null,
      };
    }
    default:
      return { ok: false, error: `지원하지 않는 M3 작업입니다: ${proposal.action}` };
  }
}

async function applyM3Proposal(adapter, proposal, target, options = {}) {
  const api = adapter.api;
  const binding = options.hostBinding || null;

  switch (proposal.action) {
    case 'update_theme': {
      const plan = await planThemeUpdate(adapter, proposal);
      if (!plan.ok) throw new Error(plan.error);
      const label = proposal.title || `테마 · 스타일 변경 (${Object.keys(plan.afterSummary).join(', ')})`;

      if (proposal.colorSchemeName !== undefined && typeof api?.changeColorScheme === 'function') {
        await api.changeColorScheme(String(proposal.colorSchemeName).trim());
      }
      if (plan.mergedColorScheme && typeof api?.setColorScheme === 'function') {
        await api.setColorScheme(plan.mergedColorScheme);
      }
      if (proposal.textThemeName !== undefined && typeof api?.changeTextTheme === 'function') {
        await api.changeTextTheme(String(proposal.textThemeName).trim());
      }
      if (plan.mergedTextTheme && typeof api?.setCustomTextTheme === 'function') {
        await api.setCustomTextTheme(plan.mergedTextTheme);
      }

      const undoId = adapter._recordChange(
        { type: 'host_api', kind: 'theme' },
        [{
          op: 'host_api',
          before: {
            colorSchemeName: plan.currentDb.colorSchemeName ?? null,
            colorScheme: plan.currentColorScheme,
            textThemeName: plan.currentDb.textTheme ?? null,
            customTextTheme: plan.currentTextTheme,
          },
          after: {
            colorSchemeName: proposal.colorSchemeName !== undefined ? String(proposal.colorSchemeName).trim() : null,
            colorScheme: plan.mergedColorScheme,
            textThemeName: proposal.textThemeName !== undefined ? String(proposal.textThemeName).trim() : null,
            customTextTheme: plan.mergedTextTheme,
          },
        }],
        label
      );

      if (proposal.customCSS !== undefined || proposal.guiHTML !== undefined) {
        const beforeDb = {};
        const nextDb = {};
        if (proposal.customCSS !== undefined) {
          beforeDb.customCSS = plan.currentDb.customCSS ?? '';
          nextDb.customCSS = String(proposal.customCSS);
        }
        if (proposal.guiHTML !== undefined) {
          beforeDb.guiHTML = plan.currentDb.guiHTML ?? '';
          nextDb.guiHTML = String(proposal.guiHTML);
        }
        await adapter._commitDb(beforeDb, nextDb, label, { appendTo: undoId });
      }
      return { ok: true, message: `${label} 적용 완료`, undoId };
    }

    case 'set_chat_panel': {
      const plan = planChatPanel(adapter, proposal);
      if (!plan.ok) throw new Error(plan.error);
      const nextVal = plan.clear ? null : plan.afterHtml;
      await api.setChatPanel(nextVal);
      adapter._chatPanelState = plan.clear ? null : { html: plan.afterHtml, title: plan.title };
      const undoId = adapter._recordChange(
        { type: 'host_api', kind: 'chat_panel' },
        [{ op: 'host_api', before: plan.beforeHtml || null, after: nextVal }],
        plan.title
      );
      return { ok: true, message: plan.clear ? '채팅 HUD 패널을 닫았습니다.' : `${plan.title} 적용 완료`, undoId };
    }

    case 'register_asset': {
      const plan = await planRegisterAsset(adapter, proposal, target, binding);
      if (!plan.ok) throw new Error(plan.error);

      if (plan.mode === 'inlay') {
        // Exact upstream signature: createInlay(data: Uint8Array | string, options?: { name?: string }): Promise<string | null>
        // Pass a fresh Uint8Array copy because upstream transfers/detaches the ArrayBuffer.
        const inlayRes = await api.createInlay(new Uint8Array(plan.decoded.bytes), { name: plan.name });
        if (!inlayRes || (typeof inlayRes !== 'string' && typeof inlayRes?.id !== 'string')) {
          throw new Error('인레이 생성 권한이 거부되었거나 호스트가 이미지 데이터 변환에 실패했습니다.');
        }
        const inlayId = typeof inlayRes === 'string' ? inlayRes : inlayRes.id;
        const undoId = adapter._recordChange(
          { type: 'host_api', kind: 'inlay' },
          [{ op: 'host_api', before: null, after: { inlayId, name: plan.name } }],
          plan.label
        );
        return { ok: true, message: `인레이 등록 완료: {{inlay::${inlayId}}}`, inlayId, undoId };
      }

      if (plan.mode === 'module_asset') {
        // Upstream saveAsset(data: Uint8Array): Promise<string>
        const saved = await api.saveAsset(new Uint8Array(plan.decoded.bytes));
        const savedId = typeof saved === 'string' ? saved : String(saved?.id || saved?.path || `${plan.name}.${plan.ext}`);
        const nextMods = clone(plan.modules);
        if (!Array.isArray(nextMods[plan.moduleIndex].assets)) nextMods[plan.moduleIndex].assets = [];
        nextMods[plan.moduleIndex].assets.push([plan.name, savedId, plan.ext]);
        const undoId = await adapter._commitDb({ modules: plan.modules }, { modules: nextMods }, plan.label);
        return { ok: true, message: `${plan.label} 완료 (ID: ${savedId})`, assetId: savedId, undoId };
      }

      const nextChar = clone(plan.char);
      if (!Array.isArray(nextChar[plan.targetField])) nextChar[plan.targetField] = [];
      let savedId = plan.assetId || null;

      if (plan.mode === 'rename_asset') {
        nextChar[plan.targetField][plan.assetIdx] = [plan.name, ...nextChar[plan.targetField][plan.assetIdx].slice(1)];
      } else if (plan.mode === 'bind_asset') {
        nextChar[plan.targetField].push(plan.entry);
      } else if (plan.mode === 'character_asset') {
        const saved = await api.saveAsset(new Uint8Array(plan.decoded.bytes));
        savedId = typeof saved === 'string' ? saved : String(saved?.id || saved?.path || `${plan.name}.${plan.ext}`);
        const entry = plan.targetField === 'emotionImages'
          ? [plan.name, savedId]
          : [plan.name, savedId, plan.ext];
        nextChar[plan.targetField].push(entry);
      }

      const undoId = await adapter._commitCharacterAt(plan.char, plan.charIndex, nextChar, plan.label, {
        crossCharacter: plan.crossCharacter,
      });
      return { ok: true, message: `${plan.label} 완료${savedId ? ` (ID: ${savedId})` : ''}`, assetId: savedId, undoId };
    }

    case 'repair_workspace': {
      const plan = await planWorkspaceRepair(adapter, proposal, binding);
      if (!plan.ok) throw new Error(plan.error);
      let undoId = null;
      if (plan.charBundle) {
        undoId = await adapter._commitCharacterAt(
          plan.charBundle.char,
          plan.charBundle.charIndex,
          plan.charBundle.nextChar,
          plan.label,
          { crossCharacter: plan.charBundle.crossCharacter }
        );
      }
      if (plan.chatBundle) {
        undoId = await adapter._commitChat(
          plan.chatBundle.chat,
          plan.chatBundle.charIndex,
          plan.chatBundle.chatIndex,
          plan.chatBundle.nextChat,
          plan.label,
          {
            char: plan.chatBundle.char,
            crossCharacter: plan.chatBundle.crossCharacter,
            crossChat: plan.chatBundle.crossChat,
            ...(undoId ? { appendTo: undoId } : {}),
          }
        );
      }
      if (plan.doCharOrder) {
        await api.checkCharOrder();
        const afterDb = (await adapter.readDbSubset(['characterOrder'])) || {};
        const afterOrder = Array.isArray(afterDb.characterOrder) ? clone(afterDb.characterOrder) : null;
        undoId = adapter._recordChange(
          { type: 'host_api', kind: 'char_order' },
          [{ op: 'host_api', before: plan.beforeCharOrder, after: afterOrder }],
          plan.label,
          undoId ? { appendTo: undoId } : {}
        );
      }
      return { ok: true, message: `${plan.label} 완료`, undoId };
    }

    case 'manage_chat_messages': {
      const plan = await planManageChatMessages(adapter, proposal, binding);
      if (!plan.ok) throw new Error(plan.error);
      const undoId = await adapter._commitChat(
        plan.chat,
        plan.charIndex,
        plan.chatIndex,
        plan.nextChat,
        plan.label,
        { char: plan.char, crossCharacter: plan.crossCharacter, crossChat: plan.crossChat }
      );
      return { ok: true, message: `${plan.label} 완료`, undoId };
    }

    case 'update_memory': {
      const plan = await planUpdateMemory(adapter, proposal, binding);
      if (!plan.ok) throw new Error(plan.error);
      const undoId = await adapter._commitChat(
        plan.chat,
        plan.charIndex,
        plan.chatIndex,
        plan.nextChat,
        plan.label,
        { char: plan.char, crossCharacter: plan.crossCharacter, crossChat: plan.crossChat }
      );
      return { ok: true, message: `${plan.label} 완료`, undoId };
    }

    case 'update_onboarding': {
      const plan = await planUpdateOnboarding(adapter, proposal, binding);
      if (!plan.ok) throw new Error(plan.error);
      const undoId = await adapter._commitCharacterAt(
        plan.char,
        plan.charIndex,
        plan.nextChar,
        plan.label,
        { crossCharacter: plan.crossCharacter }
      );
      return { ok: true, message: `${plan.label} 완료`, undoId };
    }

    case 'update_group_chat': {
      const plan = await planUpdateGroupChat(adapter, proposal, binding);
      if (!plan.ok) throw new Error(plan.error);
      const undoId = await adapter._commitCharacterAt(
        plan.char,
        plan.charIndex,
        plan.nextChar,
        plan.label,
        { crossCharacter: plan.crossCharacter }
      );
      return { ok: true, message: `${plan.label} 완료`, undoId };
    }

    case 'organize_chat_folders': {
      const plan = await planOrganizeChatFolders(adapter, proposal, binding);
      if (!plan.ok) throw new Error(plan.error);
      const undoId = await adapter._commitCharacterAt(
        plan.char,
        plan.charIndex,
        plan.nextChar,
        plan.label,
        { crossCharacter: plan.crossCharacter }
      );
      for (const upd of plan.placeholderUpdates || []) {
        const realChat = await adapter._readChatAt(plan.charIndex, upd.chatIndex, plan.char);
        if (!realChat) continue;
        const nextChat = clone(realChat);
        nextChat.folderId = upd.folderId;
        await adapter._commitChat(
          realChat,
          plan.charIndex,
          upd.chatIndex,
          nextChat,
          plan.label,
          { char: plan.char, crossCharacter: plan.crossCharacter, crossChat: true, appendTo: undoId }
        );
      }
      return { ok: true, message: `${plan.label} 완료`, undoId };
    }

    case 'manage_extensions': {
      const plan = planManageExtensions(adapter, proposal);
      if (!plan.ok) throw new Error(plan.error);
      let afterRule = null;
      if (plan.op === 'upsert') {
        afterRule = clone(await adapter.extensionRuntime.upsert(plan.rule));
      } else if (plan.op === 'toggle') {
        afterRule = clone(await adapter.extensionRuntime.toggle(plan.ruleId, plan.nextEnabled));
      } else if (plan.op === 'remove') {
        await adapter.extensionRuntime.remove(plan.ruleId);
        afterRule = null;
      }
      const undoId = adapter._recordChange(
        { type: 'host_api', kind: 'extensions' },
        [{ op: 'host_api', ruleId: afterRule?.id || plan.beforeRule?.id, before: plan.beforeRule, after: afterRule }],
        plan.label
      );
      return { ok: true, message: `${plan.label} 완료`, undoId };
    }

    case 'manage_bard_wiki': {
      const plan = await planManageBardWiki(adapter, proposal);
      if (!plan.ok) throw new Error(plan.error);
      let undoPayload;
      if (plan.op === 'save_document') {
        const saved = await plan.bw.saveDocument(plan.docWrite);
        if (!saved) throw new Error('BardWiki 문서 저장 권한이 거부되었거나 저장에 실패했습니다.');
        let finalDoc = saved;
        if (plan.followUpGrade !== undefined && plan.bw.setGrade && saved.id) {
          const graded = await plan.bw.setGrade({
            documentId: saved.id,
            grade: plan.followUpGrade,
            gradeBy: 'user',
            expectedContentHash: saved.contentHash || '',
          });
          if (graded) finalDoc = graded;
        }
        const savedId = String(finalDoc?.id || saved.id || '');
        undoPayload = {
          bwOp: 'save_document',
          docId: savedId,
          before: plan.existingDoc,
          after: {
            id: savedId,
            type: finalDoc.type || plan.docWrite.type,
            title: finalDoc.title || plan.docWrite.title,
            content: finalDoc.content ?? plan.docWrite.markdown,
            grade: finalDoc.grade ?? plan.followUpGrade ?? null,
            contentHash: finalDoc.contentHash || '',
          },
        };
      } else if (plan.op === 'set_grade') {
        const res = await plan.bw.setGrade(plan.gradeInput);
        if (!res) throw new Error('BardWiki 등급 변경 권한이 거부되었거나 문서 해시가 충돌했습니다.');
        undoPayload = { bwOp: 'set_grade', docId: plan.docId, before: plan.beforeGrade, after: plan.grade };
      } else if (plan.op === 'set_context_mode') {
        const res = await plan.bw.setContextMode(plan.modeInput);
        if (!res) throw new Error('BardWiki 컨텍스트 모드 변경 권한이 거부되었거나 문서 해시가 충돌했습니다.');
        undoPayload = { bwOp: 'set_context_mode', docId: plan.docId, before: plan.beforeMode, after: plan.contextMode };
      } else if (plan.op === 'trash_document') {
        const res = await plan.bw.trashDocument(plan.docId);
        if (!res) throw new Error('BardWiki 문서 휴지통 이동 권한이 거부되었거나 실패했습니다.');
        undoPayload = { bwOp: 'trash_document', docId: plan.docId, before: plan.existingDoc, after: null };
      }
      const undoId = adapter._recordChange(
        { type: 'host_api', kind: 'bard_wiki' },
        [{ op: 'host_api', ...undoPayload }],
        plan.label
      );
      return { ok: true, message: `${plan.label} 완료`, undoId };
    }

    case 'patch_risunest_conversation': {
      const plan = await planPatchRisuNestConversation(adapter, proposal);
      if (!plan.ok) throw new Error(plan.error);
      // Upstream RisuNest takes a single ConversationPatchRequest object and returns ConversationPatchResult
      const res = await api.risunestPatchConversation(plan.request);
      if (res && typeof res === 'object' && res.status && res.status !== 'applied' && res.status !== 'already-applied') {
        const reason = res.conflict
          ? `${res.conflict.target}/${res.conflict.reason}`
          : res.status;
        throw new Error(`RisuNest 대화 패치가 호스트에서 거부되었습니다(${reason}).`);
      }
      const undoId = adapter._recordChange(
        { type: 'host_api', kind: 'risunest_patch' },
        [{
          op: 'host_api',
          characterId: plan.request.characterId,
          conversationId: plan.request.conversationId,
          messages: plan.beforeMessages,
          chatVariables: plan.beforeVars,
          revisionAfter: Number.isSafeInteger(res?.revision) ? res.revision : undefined,
        }],
        plan.label
      );
      return { ok: true, message: `${plan.label} 완료`, undoId };
    }

    default:
      throw new Error(`지원하지 않는 M3 작업입니다: ${proposal.action}`);
  }
}

/**
 * Surgical Undo handler for `entity.type === 'host_api'` records with conflict detection.
 */
async function revertHostApiRecord(adapter, entity, ops) {
  const api = adapter.api;
  let reverted = 0;
  const conflicts = [];

  for (const op of ops || []) {
    if (entity.kind === 'theme') {
      const { before, after } = op;
      const effectiveAfterColorName = after.colorScheme ? 'custom' : after.colorSchemeName;
      let colorConflict = false;
      if (effectiveAfterColorName !== null && typeof api?.changeColorScheme === 'function') {
        const db = (await adapter.readDbSubset(['colorSchemeName'])) || {};
        if (db.colorSchemeName !== undefined && db.colorSchemeName !== effectiveAfterColorName) {
          conflicts.push({ path: 'theme.colorSchemeName', reason: '적용 이후 색상 스킴이 다시 변경되었습니다.' });
          colorConflict = true;
        }
      }
      if (!colorConflict && after.colorScheme && typeof api?.setColorScheme === 'function') {
        let cur = null;
        try {
          const rawCur = await api.getColorScheme?.();
          cur = rawCur ? unwrapColorScheme(rawCur) : null;
        } catch {}
        if (cur && !deepEqual(cur, unwrapColorScheme(after.colorScheme))) {
          conflicts.push({ path: 'theme.colorScheme', reason: '적용 이후 커스텀 색상이 다시 변경되었습니다.' });
          colorConflict = true;
        } else if (before.colorScheme) {
          await api.setColorScheme(unwrapColorScheme(before.colorScheme));
          reverted++;
        }
      }
      if (!colorConflict && effectiveAfterColorName !== null && typeof api?.changeColorScheme === 'function') {
        if (before.colorSchemeName && ALLOWED_COLOR_SCHEME_PRESETS.has(before.colorSchemeName)) {
          await api.changeColorScheme(before.colorSchemeName);
          reverted++;
        }
      }

      const effectiveAfterTextName = after.customTextTheme ? 'custom' : after.textThemeName;
      let textConflict = false;
      if (effectiveAfterTextName !== null && typeof api?.changeTextTheme === 'function') {
        const db = (await adapter.readDbSubset(['textTheme'])) || {};
        if (db.textTheme !== undefined && db.textTheme !== effectiveAfterTextName) {
          conflicts.push({ path: 'theme.textTheme', reason: '적용 이후 텍스트 테마가 다시 변경되었습니다.' });
          textConflict = true;
        }
      }
      if (!textConflict && after.customTextTheme && typeof api?.setCustomTextTheme === 'function') {
        let cur = null;
        try {
          const rawCur = await api.getTextTheme?.();
          cur = rawCur ? unwrapTextTheme(rawCur) : null;
        } catch {}
        if (cur && !deepEqual(cur, unwrapTextTheme(after.customTextTheme))) {
          conflicts.push({ path: 'theme.customTextTheme', reason: '적용 이후 커스텀 텍스트 테마가 다시 변경되었습니다.' });
          textConflict = true;
        } else if (before.customTextTheme) {
          await api.setCustomTextTheme(unwrapTextTheme(before.customTextTheme));
          reverted++;
        }
      }
      if (!textConflict && effectiveAfterTextName !== null && typeof api?.changeTextTheme === 'function') {
        if (before.textThemeName && ALLOWED_TEXT_THEME_PRESETS.has(before.textThemeName)) {
          await api.changeTextTheme(before.textThemeName);
          reverted++;
        }
      }
      continue;
    }

    if (entity.kind === 'chat_panel') {
      const curHtml = adapter._chatPanelState?.html ?? null;
      if (curHtml !== op.after) {
        conflicts.push({ path: 'chatPanel', reason: '적용 이후 채팅 HUD 패널이 다시 변경되었습니다.' });
      } else if (typeof api?.setChatPanel === 'function') {
        await api.setChatPanel(op.before ?? null);
        adapter._chatPanelState = op.before ? { html: op.before, title: '채팅 HUD 패널' } : null;
        reverted++;
      }
      continue;
    }

    if (entity.kind === 'inlay') {
      conflicts.push({ path: `inlay.${op.after?.inlayId || 'new'}`, reason: '호스트에 저장된 인레이 파일 자체는 Plugin v3에서 삭제할 수 없습니다.' });
      continue;
    }

    if (entity.kind === 'char_order') {
      if (Array.isArray(op.before)) {
        const db = (await adapter.readDbSubset(['characterOrder'])) || {};
        if (op.after && Array.isArray(db.characterOrder) && !deepEqual(db.characterOrder, op.after)) {
          conflicts.push({ path: 'db.characterOrder', reason: '적용 이후 캐릭터 순서가 다시 변경되었습니다.' });
        } else {
          await adapter.writeDbSubset({ characterOrder: op.before });
          reverted++;
        }
      }
      continue;
    }

    if (entity.kind === 'extensions') {
      const rt = adapter.extensionRuntime;
      if (!rt) continue;
      const cur = rt.get(op.ruleId);
      const curClean = cur ? clone(cur) : null;
      if (!deepEqual(curClean, op.after)) {
        conflicts.push({ path: `extension.${op.ruleId}`, reason: '적용 이후 상주 확장 규칙이 다시 변경되었습니다.' });
      } else if (op.before) {
        await rt.upsert(op.before);
        reverted++;
      } else if (cur) {
        await rt.remove(op.ruleId);
        reverted++;
      }
      continue;
    }

    if (entity.kind === 'bard_wiki') {
      const bw = getBardWikiApi(api);
      if (!bw) continue;
      const findLiveDoc = async (id) => {
        if (!bw.getDocuments || !id) return null;
        try {
          const raw = await bw.getDocuments();
          const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.documents) ? raw.documents : []);
          return list.find(d => d && String(d.id) === String(id)) || null;
        } catch {
          return null;
        }
      };

      if (op.bwOp === 'save_document') {
        const curDoc = await findLiveDoc(op.docId);
        if (curDoc && op.after && curDoc.content !== op.after.content) {
          conflicts.push({ path: `bardWiki.${op.docId}`, reason: '적용 이후 BardWiki 문서 내용이 다시 변경되었습니다.' });
        } else if (op.before && bw.saveDocument) {
          await bw.saveDocument({
            ...(curDoc ? { documentId: curDoc.id, expectedContentHash: curDoc.contentHash || '' } : {}),
            type: op.before.type || 'other',
            title: op.before.title,
            ...(Array.isArray(op.before.aliases) ? { aliases: op.before.aliases } : {}),
            markdown: op.before.content ?? '',
          });
          reverted++;
        } else if (!op.before && op.docId && bw.trashDocument) {
          await bw.trashDocument(op.docId);
          reverted++;
        }
      } else if (op.bwOp === 'set_grade' && bw.setGrade) {
        const curDoc = await findLiveDoc(op.docId);
        if (!curDoc) {
          conflicts.push({ path: `bardWiki.${op.docId}`, reason: '되돌릴 BardWiki 문서를 찾을 수 없습니다.' });
        } else if (curDoc.grade !== op.after) {
          conflicts.push({ path: `bardWiki.${op.docId}.grade`, reason: '적용 이후 BardWiki 등급이 다시 변경되었습니다.' });
        } else {
          await bw.setGrade({
            documentId: curDoc.id,
            grade: op.before ?? null,
            gradeBy: 'user',
            expectedContentHash: curDoc.contentHash || '',
          });
          reverted++;
        }
      } else if (op.bwOp === 'set_context_mode' && bw.setContextMode) {
        const curDoc = await findLiveDoc(op.docId);
        if (!curDoc) {
          conflicts.push({ path: `bardWiki.${op.docId}`, reason: '되돌릴 BardWiki 문서를 찾을 수 없습니다.' });
        } else if (curDoc.contextMode !== op.after) {
          conflicts.push({ path: `bardWiki.${op.docId}.contextMode`, reason: '적용 이후 BardWiki 컨텍스트 모드가 다시 변경되었습니다.' });
        } else if (op.before) {
          await bw.setContextMode({
            documentId: curDoc.id,
            contextMode: op.before,
            expectedContentHash: curDoc.contentHash || '',
          });
          reverted++;
        }
      } else if (op.bwOp === 'trash_document' && op.before && bw.saveDocument) {
        await bw.saveDocument({
          type: op.before.type || 'other',
          title: op.before.title,
          ...(Array.isArray(op.before.aliases) ? { aliases: op.before.aliases } : {}),
          markdown: op.before.content ?? '',
        });
        reverted++;
      }
      continue;
    }

    if (entity.kind === 'risunest_patch') {
      if (typeof api?.risunestPatchConversation !== 'function') continue;
      let curCtx = null;
      if (typeof api?.risunestReadConversationContext === 'function') {
        try {
          const varKeys = (op.chatVariables || []).map(v => v.key);
          const msgEntries = op.messages || [];
          curCtx = await api.risunestReadConversationContext({
            characterId: op.characterId,
            conversationId: op.conversationId,
            ...(varKeys.length > 0 ? { chatVariables: varKeys } : {}),
            ...(msgEntries.length > 0 ? {
              messages: {
                startIndex: Math.min(...msgEntries.map(m => m.index)),
                limit: Math.min(128, Math.max(...msgEntries.map(m => m.index)) - Math.min(...msgEntries.map(m => m.index)) + 1),
              },
            } : {}),
          });
        } catch {}
      }

      const curVars = curCtx?.chatVariables && typeof curCtx.chatVariables === 'object' ? curCtx.chatVariables : null;
      const curMsgStart = Number.isSafeInteger(curCtx?.messages?.startIndex) ? curCtx.messages.startIndex : 0;
      const curMsgs = Array.isArray(curCtx?.messages?.messages) ? curCtx.messages.messages : null;

      const inverseMessages = [];
      for (const m of op.messages || []) {
        const liveMsg = curMsgs ? curMsgs[m.index - curMsgStart] : null;
        let conflicted = false;
        if (liveMsg) {
          for (const [field, afterVal] of Object.entries(m.after || {})) {
            if (!deepEqual(liveMsg[field], afterVal)) {
              conflicts.push({ path: `risunest.messages[${m.index}].${field}`, reason: `적용 이후 메시지 #${m.index + 1}의 "${field}" 값이 다시 변경되었습니다.` });
              conflicted = true;
            }
          }
        }
        if (!conflicted) {
          inverseMessages.push({
            index: m.index,
            messageId: m.messageId ?? null,
            expected: clone(m.after),
            set: clone(m.before),
          });
        }
      }

      const inverseVars = [];
      for (const v of op.chatVariables || []) {
        if (curVars) {
          const liveVal = Object.hasOwn(curVars, v.key)
            ? curVars[v.key]
            : (Object.hasOwn(curVars, `$${v.key}`) ? curVars[`$${v.key}`] : null);
          const normLive = (liveVal === undefined || liveVal === null) ? null : liveVal;
          if (!deepEqual(normLive, v.after)) {
            conflicts.push({ path: `risunest.chatVariables.${v.key}`, reason: `적용 이후 변수 "${v.key}" 값이 다시 변경되었습니다.` });
            continue;
          }
        }
        inverseVars.push({
          key: v.key,
          expected: v.after,
          value: v.before,
        });
      }

      if (inverseMessages.length > 0 || inverseVars.length > 0) {
        const invReq = {
          characterId: op.characterId,
          conversationId: op.conversationId,
          mutationId: makeUuid(),
          ...(Number.isSafeInteger(curCtx?.revision) ? { baseRevision: curCtx.revision } : {}),
          messages: inverseMessages,
          chatVariables: inverseVars,
        };
        const res = await api.risunestPatchConversation(invReq);
        if (res && typeof res === 'object' && res.status === 'conflict') {
          conflicts.push({ path: `risunest.${res.conflict?.target || 'conversation'}`, reason: `호스트 충돌(${res.conflict?.reason || 'conflict'})로 되돌리기가 거부되었습니다.` });
        } else {
          reverted++;
        }
      }
    }
  }

  return { reverted, conflicts };
}

export {
  M3_ACTIONS,
  COLOR_SCHEME_REQUIRED_KEYS,
  TEXT_THEME_REQUIRED_KEYS,
  ALLOWED_COLOR_SCHEME_KEYS,
  ALLOWED_COLOR_SCHEME_PRESETS,
  ALLOWED_TEXT_THEME_KEYS,
  ALLOWED_TEXT_THEME_PRESETS,
  ALLOWED_ONBOARDING_FIELD_TYPES,
  ALLOWED_RISUNEST_PATCH_KEYS,
  BARD_WIKI_DOC_TYPES,
  BARD_WIKI_CONTEXT_MODES,
  unwrapColorScheme,
  unwrapTextTheme,
  normalizeBardWikiGrade,
  sanitizeChatPanelHtml,
  getBardWikiApi,
  previewM3Proposal,
  applyM3Proposal,
  revertHostApiRecord,
};
