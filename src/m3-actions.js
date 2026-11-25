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
const ALLOWED_COLOR_SCHEME_KEYS = new Set([
  'bgcolor', 'darkbg', 'borderc', 'selected', 'draculared', 'textcolor', 'textcolor2',
  'darkBorderc', 'darkbutton', 'type', 'custom', 'name',
]);
const ALLOWED_TEXT_THEME_KEYS = new Set([
  'FontColorStandard', 'FontColorItalic', 'FontColorBold', 'FontColorItalicBold',
  'FontColorQuote1', 'FontColorQuote2', 'name',
]);
const ALLOWED_ONBOARDING_FIELD_TYPES = new Set(['text', 'textarea', 'select', 'checkbox', 'radio', 'number']);
const ALLOWED_RISUNEST_PATCH_KEYS = new Set([
  'name', 'note', 'folderId', 'fmIndex', 'bindedPersona', 'scriptstate', 'supaMemoryData', 'localLore', 'modules', 'metadata',
]);

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
    ? () => bw.getContext()
    : (typeof api._getBardWikiContext === 'function' ? () => api._getBardWikiContext() : null);
  const getDocuments = typeof bw.getDocuments === 'function'
    ? (opts) => bw.getDocuments(opts)
    : (typeof api._getBardWikiDocuments === 'function' ? (opts) => api._getBardWikiDocuments(opts) : null);
  const saveDocument = typeof bw.saveDocument === 'function'
    ? (doc) => bw.saveDocument(doc)
    : (typeof api._saveBardWikiDocument === 'function' ? (doc) => api._saveBardWikiDocument(doc) : null);
  const setContextMode = typeof bw.setContextMode === 'function'
    ? (mode) => bw.setContextMode(mode)
    : (typeof api._setBardWikiContextMode === 'function' ? (mode) => api._setBardWikiContextMode(mode) : null);
  const setGrade = typeof bw.setGrade === 'function'
    ? (id, grade) => bw.setGrade(id, grade)
    : (typeof api._setBardWikiGrade === 'function' ? (id, grade) => api._setBardWikiGrade(id, grade) : null);
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

  let cleanColorScheme = null;
  if (proposal.colorScheme && typeof proposal.colorScheme === 'object') {
    cleanColorScheme = {};
    for (const [k, v] of Object.entries(proposal.colorScheme)) {
      if (BAD_KEYS.has(k) || !ALLOWED_COLOR_SCHEME_KEYS.has(k)) {
        return { ok: false, error: `허용되지 않는 colorScheme 키입니다: ${k}` };
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

  let currentColorScheme = null;
  if (wantsColor && typeof api?.getColorScheme === 'function') {
    try { currentColorScheme = clone(await api.getColorScheme()); } catch {}
  }
  let currentTextTheme = null;
  if (wantsText && typeof api?.getTextTheme === 'function') {
    try { currentTextTheme = clone(await api.getTextTheme()); } catch {}
  }
  const dbKeys = ['colorSchemeName', 'textTheme'];
  if (proposal.customCSS !== undefined) dbKeys.push('customCSS');
  if (proposal.guiHTML !== undefined) dbKeys.push('guiHTML');
  const currentDb = (await adapter.readDbSubset(dbKeys)) || {};

  const beforeSummary = {};
  const afterSummary = {};
  if (proposal.colorSchemeName !== undefined) {
    beforeSummary.colorSchemeName = currentDb.colorSchemeName ?? '(현재)';
    afterSummary.colorSchemeName = String(proposal.colorSchemeName);
  }
  if (cleanColorScheme) {
    beforeSummary.colorScheme = currentColorScheme || {};
    afterSummary.colorScheme = { ...(currentColorScheme || {}), ...cleanColorScheme };
  }
  if (proposal.textThemeName !== undefined) {
    beforeSummary.textThemeName = currentDb.textTheme ?? '(현재)';
    afterSummary.textThemeName = String(proposal.textThemeName);
  }
  if (cleanTextTheme) {
    beforeSummary.customTextTheme = currentTextTheme || {};
    afterSummary.customTextTheme = { ...(currentTextTheme || {}), ...cleanTextTheme };
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
// 11. manage_bard_wiki (RisuBard-only)
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
  let ctx = null;
  if (bw.getContext) {
    try { ctx = await bw.getContext(); } catch {}
  }
  const docId = String(proposal.documentId || proposal.id || '').trim();
  const existingDoc = docId ? (docs.find(d => d && String(d.id) === docId) || null) : null;
  const scopeNote = '(RisuBard 현재 열린 캐릭터·채팅 스코프 기준)';

  if (op === 'save_document') {
    if (!bw.saveDocument) return { ok: false, error: 'bardWiki.saveDocument API를 사용할 수 없습니다.' };
    const title = String(proposal.title || existingDoc?.title || '').trim();
    const content = typeof proposal.content === 'string' ? proposal.content : existingDoc?.content;
    if (!title || typeof content !== 'string') {
      return { ok: false, error: 'save_document에는 title과 content 문자열이 필요합니다.' };
    }
    const nextDoc = {
      ...(existingDoc ? clone(existingDoc) : {}),
      ...(docId ? { id: docId } : {}),
      title,
      content,
      ...(proposal.grade !== undefined ? { grade: String(proposal.grade) } : {}),
      ...(proposal.category !== undefined ? { category: String(proposal.category) } : {}),
      ...(Array.isArray(proposal.tags) ? { tags: proposal.tags.map(String) } : {}),
    };
    return {
      ok: true,
      op,
      bw,
      nextDoc,
      existingDoc: existingDoc ? clone(existingDoc) : null,
      label: `BardWiki 문서 ${existingDoc ? '수정' : '생성'}: ${title}`,
      before: existingDoc ? JSON.stringify(existingDoc, null, 2) : `(새 BardWiki 문서) ${scopeNote}`,
      after: `${JSON.stringify(nextDoc, null, 2)}\n${scopeNote}`,
      hostBinding: null,
    };
  }

  if (op === 'set_grade') {
    if (!bw.setGrade) return { ok: false, error: 'bardWiki.setGrade API를 사용할 수 없습니다.' };
    if (!docId || proposal.grade === undefined) {
      return { ok: false, error: 'set_grade에는 documentId와 grade가 필요합니다.' };
    }
    return {
      ok: true,
      op,
      bw,
      docId,
      grade: String(proposal.grade),
      beforeGrade: existingDoc?.grade ?? null,
      existingDoc: existingDoc ? clone(existingDoc) : null,
      label: `BardWiki 등급 변경: ${existingDoc?.title || docId} → ${proposal.grade}`,
      before: `grade: ${existingDoc?.grade ?? '(미상)'}`,
      after: `grade: ${proposal.grade}\n${scopeNote}`,
      hostBinding: null,
    };
  }

  if (op === 'set_context_mode') {
    if (!bw.setContextMode) return { ok: false, error: 'bardWiki.setContextMode API를 사용할 수 없습니다.' };
    const mode = String(proposal.contextMode || proposal.mode || '').trim();
    if (!mode) return { ok: false, error: 'set_context_mode에는 contextMode(또는 mode) 문자열이 필요합니다.' };
    const beforeMode = ctx?.mode ?? ctx?.contextMode ?? null;
    return {
      ok: true,
      op,
      bw,
      contextMode: mode,
      beforeMode,
      label: `BardWiki 컨텍스트 모드 변경: ${mode}`,
      before: `contextMode: ${beforeMode ?? '(현재)'}`,
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
// 12. patch_risunest_conversation (RisuNest-only)
// ---------------------------------------------------------------------------

async function planPatchRisuNestConversation(adapter, proposal) {
  if (!adapter.hasCapability('risunestPatch') || typeof adapter.api?.risunestPatchConversation !== 'function') {
    return { ok: false, error: '현재 호스트는 RisuNest risunestPatchConversation API를 지원하지 않습니다.' };
  }
  const patch = proposal.patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    return { ok: false, error: 'patch_risunest_conversation에는 1개 이상의 키를 포함한 patch 객체가 필요합니다.' };
  }
  const cleanPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if (BAD_KEYS.has(k) || !ALLOWED_RISUNEST_PATCH_KEYS.has(k)) {
      return { ok: false, error: `허용되지 않는 RisuNest 대화 패치 키입니다: ${k}` };
    }
    cleanPatch[k] = v;
  }

  const ref = {
    ...(proposal.conversationId ? { conversationId: String(proposal.conversationId) } : {}),
    ...(Number.isInteger(proposal.targetCharIndex) ? { charIndex: proposal.targetCharIndex } : {}),
    ...(Number.isInteger(proposal.targetChatIndex) ? { chatIndex: proposal.targetChatIndex } : {}),
  };

  let currentCtx = {};
  if (typeof adapter.api?.risunestReadConversationContext === 'function') {
    try {
      const read = await adapter.api.risunestReadConversationContext(ref);
      if (read && typeof read === 'object') currentCtx = read;
    } catch {}
  }

  const beforeValues = {};
  for (const k of Object.keys(cleanPatch)) {
    beforeValues[k] = Object.hasOwn(currentCtx, k) ? clone(currentCtx[k]) : null;
  }

  const convLabel = ref.conversationId || (Number.isInteger(ref.chatIndex) ? `채팅 #${ref.chatIndex + 1}` : '현재 대화');
  return {
    ok: true,
    ref,
    cleanPatch,
    beforeValues,
    label: `RisuNest 대화 정밀 패치 (${convLabel}: ${Object.keys(cleanPatch).join(', ')})`,
    before: JSON.stringify(beforeValues, null, 2),
    after: JSON.stringify(cleanPatch, null, 2),
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
        await api.changeColorScheme(String(proposal.colorSchemeName));
      }
      if (plan.cleanColorScheme && typeof api?.setColorScheme === 'function') {
        await api.setColorScheme({ ...(plan.currentColorScheme || {}), ...plan.cleanColorScheme });
      }
      if (proposal.textThemeName !== undefined && typeof api?.changeTextTheme === 'function') {
        await api.changeTextTheme(String(proposal.textThemeName));
      }
      if (plan.cleanTextTheme && typeof api?.setCustomTextTheme === 'function') {
        await api.setCustomTextTheme({ ...(plan.currentTextTheme || {}), ...plan.cleanTextTheme });
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
            colorSchemeName: proposal.colorSchemeName !== undefined ? String(proposal.colorSchemeName) : null,
            colorScheme: plan.cleanColorScheme ? { ...(plan.currentColorScheme || {}), ...plan.cleanColorScheme } : null,
            textThemeName: proposal.textThemeName !== undefined ? String(proposal.textThemeName) : null,
            customTextTheme: plan.cleanTextTheme ? { ...(plan.currentTextTheme || {}), ...plan.cleanTextTheme } : null,
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
        const inlayRes = await api.createInlay({
          name: plan.name,
          data: plan.decoded.bytes,
          type: plan.decoded.mimeType.startsWith('image/') ? 'image' : 'text',
          ext: plan.decoded.mimeType.includes('svg') ? 'svg' : 'txt',
        });
        const inlayId = typeof inlayRes === 'string' ? inlayRes : String(inlayRes?.id || makeUuid());
        const undoId = adapter._recordChange(
          { type: 'host_api', kind: 'inlay' },
          [{ op: 'host_api', before: null, after: { inlayId, name: plan.name } }],
          plan.label
        );
        return { ok: true, message: `인레이 등록 완료: {{inlay::${inlayId}}}`, inlayId, undoId };
      }

      if (plan.mode === 'module_asset') {
        const saved = await api.saveAsset(plan.decoded.bytes, undefined, `${plan.name}.${plan.ext}`);
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
        const saved = await api.saveAsset(plan.decoded.bytes, undefined, `${plan.name}.${plan.ext}`);
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
        const saved = await plan.bw.saveDocument(plan.nextDoc);
        const savedId = String(saved?.id || plan.nextDoc.id || '');
        undoPayload = {
          bwOp: 'save_document',
          docId: savedId,
          before: plan.existingDoc,
          after: { ...plan.nextDoc, ...(savedId ? { id: savedId } : {}) },
        };
      } else if (plan.op === 'set_grade') {
        await plan.bw.setGrade(plan.docId, plan.grade);
        undoPayload = { bwOp: 'set_grade', docId: plan.docId, before: plan.beforeGrade, after: plan.grade };
      } else if (plan.op === 'set_context_mode') {
        await plan.bw.setContextMode(plan.contextMode);
        undoPayload = { bwOp: 'set_context_mode', before: plan.beforeMode, after: plan.contextMode };
      } else if (plan.op === 'trash_document') {
        await plan.bw.trashDocument(plan.docId);
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
      await api.risunestPatchConversation(plan.ref, plan.cleanPatch);
      const undoId = adapter._recordChange(
        { type: 'host_api', kind: 'risunest_patch' },
        [{ op: 'host_api', ref: plan.ref, before: plan.beforeValues, after: plan.cleanPatch }],
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
      if (after.colorSchemeName !== null && typeof api?.changeColorScheme === 'function') {
        const db = (await adapter.readDbSubset(['colorSchemeName'])) || {};
        if (db.colorSchemeName !== undefined && db.colorSchemeName !== after.colorSchemeName) {
          conflicts.push({ path: 'theme.colorSchemeName', reason: '적용 이후 색상 스킴이 다시 변경되었습니다.' });
        } else if (before.colorSchemeName) {
          await api.changeColorScheme(before.colorSchemeName);
          reverted++;
        }
      }
      if (after.colorScheme && typeof api?.setColorScheme === 'function') {
        let cur = null;
        try { cur = await api.getColorScheme?.(); } catch {}
        if (cur && !deepEqual(cur, after.colorScheme)) {
          conflicts.push({ path: 'theme.colorScheme', reason: '적용 이후 커스텀 색상이 다시 변경되었습니다.' });
        } else if (before.colorScheme) {
          await api.setColorScheme(before.colorScheme);
          reverted++;
        }
      }
      if (after.textThemeName !== null && typeof api?.changeTextTheme === 'function') {
        const db = (await adapter.readDbSubset(['textTheme'])) || {};
        if (db.textTheme !== undefined && db.textTheme !== after.textThemeName) {
          conflicts.push({ path: 'theme.textTheme', reason: '적용 이후 텍스트 테마가 다시 변경되었습니다.' });
        } else if (before.textThemeName) {
          await api.changeTextTheme(before.textThemeName);
          reverted++;
        }
      }
      if (after.customTextTheme && typeof api?.setCustomTextTheme === 'function') {
        let cur = null;
        try { cur = await api.getTextTheme?.(); } catch {}
        if (cur && !deepEqual(cur, after.customTextTheme)) {
          conflicts.push({ path: 'theme.customTextTheme', reason: '적용 이후 커스텀 텍스트 테마가 다시 변경되었습니다.' });
        } else if (before.customTextTheme) {
          await api.setCustomTextTheme(before.customTextTheme);
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
      if (op.bwOp === 'save_document') {
        let curDoc = null;
        if (bw.getDocuments && op.docId) {
          try {
            const raw = await bw.getDocuments();
            const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.documents) ? raw.documents : []);
            curDoc = list.find(d => d && String(d.id) === String(op.docId)) || null;
          } catch {}
        }
        if (curDoc && op.after && curDoc.content !== op.after.content) {
          conflicts.push({ path: `bardWiki.${op.docId}`, reason: '적용 이후 BardWiki 문서 내용이 다시 변경되었습니다.' });
        } else if (op.before && bw.saveDocument) {
          await bw.saveDocument(op.before);
          reverted++;
        } else if (!op.before && op.docId && bw.trashDocument) {
          await bw.trashDocument(op.docId);
          reverted++;
        }
      } else if (op.bwOp === 'set_grade' && bw.setGrade) {
        if (op.before !== null && op.before !== undefined) {
          await bw.setGrade(op.docId, op.before);
          reverted++;
        }
      } else if (op.bwOp === 'set_context_mode' && bw.setContextMode) {
        let curMode = null;
        try {
          const ctx = await bw.getContext?.();
          curMode = ctx?.mode ?? ctx?.contextMode ?? null;
        } catch {}
        if (curMode !== null && curMode !== op.after) {
          conflicts.push({ path: 'bardWiki.contextMode', reason: '적용 이후 BardWiki 컨텍스트 모드가 다시 변경되었습니다.' });
        } else if (op.before !== null && op.before !== undefined) {
          await bw.setContextMode(op.before);
          reverted++;
        }
      } else if (op.bwOp === 'trash_document' && op.before && bw.saveDocument) {
        await bw.saveDocument(op.before);
        reverted++;
      }
      continue;
    }

    if (entity.kind === 'risunest_patch') {
      if (typeof api?.risunestPatchConversation !== 'function') continue;
      let curCtx = null;
      if (typeof api?.risunestReadConversationContext === 'function') {
        try { curCtx = await api.risunestReadConversationContext(op.ref); } catch {}
      }
      const inverse = {};
      for (const [k, afterVal] of Object.entries(op.after || {})) {
        if (curCtx && Object.hasOwn(curCtx, k) && !deepEqual(curCtx[k], afterVal)) {
          conflicts.push({ path: `risunest.${k}`, reason: `적용 이후 "${k}" 값이 다시 변경되었습니다.` });
        } else {
          inverse[k] = op.before?.[k] ?? null;
        }
      }
      if (Object.keys(inverse).length > 0) {
        await api.risunestPatchConversation(op.ref, inverse);
        reverted++;
      }
    }
  }

  return { reverted, conflicts };
}

export {
  M3_ACTIONS,
  ALLOWED_COLOR_SCHEME_KEYS,
  ALLOWED_TEXT_THEME_KEYS,
  ALLOWED_ONBOARDING_FIELD_TYPES,
  ALLOWED_RISUNEST_PATCH_KEYS,
  sanitizeChatPanelHtml,
  getBardWikiApi,
  previewM3Proposal,
  applyM3Proposal,
  revertHostApiRecord,
};
