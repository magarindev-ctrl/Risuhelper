import { SCREEN_LABELS, CHAR_FIELD_META, MODULE_FIELD_META, CONFIG_FIELD_META } from './version.js';

const FOCUS_SELECTOR = 'textarea:focus, input:focus, [contenteditable="true"]:focus, [contenteditable=""]:focus';
const CHAT_INPUT_SELECTOR = 'textarea.text-input-area, textarea#messageInputTranslate, .text-input-area, .chat-input textarea';
const CHIP_ATTR = 'x-risuhelper-chip';
const DRAG_THRESHOLD_PX = 6;

// Detection diagnostics (opt-in). The detector swallows SafeElement errors on purpose — hosts
// differ in which calls they support — but a wrong detection must be explainable. While a
// diagnostic run is active, every swallowed error and the final signals are recorded.
let activeDiagnostics = null;

function noteDetectError(err) {
  if (!activeDiagnostics || activeDiagnostics.errors.length >= 30) return;
  const stackLine = String(err?.stack || '').split('\n')[1] || '';
  activeDiagnostics.errors.push({
    message: String(err?.message || err),
    at: stackLine.trim().replace(/^at\s+/, '').split(' ')[0] || '',
  });
}

function summarizeSignals(signals) {
  const out = {};
  for (const [key, value] of Object.entries(signals || {})) {
    if (key === 'moduleDomHints') {
      out.moduleDomHints = value ? { tab: value.tab ?? null, openIdx: value.openIdx ?? null, items: value.items?.length ?? 0 } : null;
    } else if (typeof value === 'string') {
      out[key] = value.slice(0, 120);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Safely parses attributes from the opening HTML tag string returned by SafeElement.getOuterHTML().
 * (Plugin v3 SafeElement.getAttribute() only allows 'x-*' attributes.)
 */
function parseOpeningTagAttrs(outerHtml) {
  const attrs = {};
  if (typeof outerHtml !== 'string') return attrs;
  const openMatch = outerHtml.match(/^<([a-zA-Z0-9-]+)([\s\S]*?)>/);
  if (!openMatch) return attrs;
  attrs._tag = openMatch[1].toLowerCase();
  const rawAttrs = openMatch[2];
  const re = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(rawAttrs))) {
    const key = m[1].toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[key] = decodeBasicEntities(val);
  }
  return attrs;
}

function decodeBasicEntities(str) {
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function normalizeLabel(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchAny(text, keywords) {
  const norm = normalizeLabel(text);
  if (!norm) return false;
  return keywords.some(kw => norm === kw || norm.startsWith(kw + ' ') || norm.includes(kw));
}

/**
 * Exact (whole-label) match for a field label or placeholder.
 * Field labels must never be matched by substring: "캐릭터 설명 Prefix" (a global setting) and
 * "Additional Description" both contain a keyword of the character description field.
 */
function labelIs(text, keywords) {
  const norm = normalizeLabel(text).replace(/\s*[:：*?]+$/u, '').trim();
  if (!norm) return false;
  return keywords.includes(norm);
}

function isSearchField(placeholder, inputType) {
  if (String(inputType || '').toLowerCase() === 'search') return true;
  const norm = normalizeLabel(placeholder);
  return norm === '검색' || norm === 'search' || norm.endsWith(' 검색') || norm.endsWith('로 검색') || norm.startsWith('search ');
}

const LORE_CHAT_TAB_LABELS = ['챗', '채팅', 'chat'];

function isChatElementAttrs(attrs) {
  const cls = String(attrs?.class || '');
  const id = String(attrs?.id || '');
  return (
    cls.includes('text-input-area') ||
    cls.includes('chat-input') ||
    id === 'messageInputTranslate'
  );
}

function hasUsableRect(rect) {
  return Boolean(
    rect &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    (rect.width > 0 || rect.height > 0)
  );
}

function rectsMatch(a, b) {
  if (!hasUsableRect(a) || !hasUsableRect(b)) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function isTokenCountText(text) {
  return /^\d+\s*(토큰|tokens?)$/.test(normalizeLabel(text));
}

function isMutedHelperSpan(className, text) {
  const cls = String(className || '');
  if (cls.includes('text-textcolor2') || cls.includes('text-xs') || cls.includes('text-draculared')) {
    return true;
  }
  return isTokenCountText(text);
}

/**
 * Checks whether a sibling <div> is TriggerList.svelte's V1/V2/Lua mode bar
 * with the Lua button active (`<button class="... ring-1">Lua</button>`).
 * Inspects only direct button children of small (<=4 child) containers to avoid
 * false positives from unrelated page subtrees.
 */
async function isLuaModeBar(el, className) {
  const cls = String(className || '');
  if (cls.includes('n-scroll') || cls.includes('border-darkborderc') || cls.includes('seperator')) {
    return false;
  }
  try {
    const kids = await el.getChildren();
    const len = kids ? await kids.length() : 0;
    if (len === 0 || len > 4) return false;
    for (let k = 0; k < len; k++) {
      const btn = await kids.at(k);
      if (!btn) continue;
      const bName = String(await btn.nodeName()).toLowerCase();
      if (bName !== 'button') continue;
      const bCls = String((await btn.getClassName()) || '');
      const bText = String((await btn.textContent()) || '').trim();
      if (bText === 'Lua' && bCls.includes('ring-1')) {
        return true;
      }
    }
  } catch (err) { noteDetectError(err); }
  return false;
}

/**
 * Extracts a short field label from PocketRisu's SettingFieldLabel wrapper
 * (`<div class="flex flex-col ..."><span class="text-sm text-textcolor">Label</span><p>...</p></div>`).
 */
async function extractLabelFromColWrapper(el, className) {
  const cls = String(className || '');
  if (!cls.includes('flex-col')) return '';
  if (cls.includes('border-darkborderc') || cls.includes('n-scroll') || cls.includes('border-selected')) {
    return '';
  }
  try {
    const kids = await el.getChildren();
    const len = kids ? await kids.length() : 0;
    if (len === 0 || len > 3) return '';
    for (let k = 0; k < len; k++) {
      const child = await kids.at(k);
      if (!child) continue;
      const cName = String(await child.nodeName()).toLowerCase();
      if (cName === 'span' || cName === 'label') {
        const st = String((await child.textContent()) || '').trim();
        const cCls = String((await child.getClassName()) || '');
        if (st && st.length <= 60 && !isMutedHelperSpan(cCls, st)) {
          return st;
        }
      }
    }
  } catch (err) { noteDetectError(err); }
  return '';
}

/**
 * Finds the label of the active tab that governs a list item (e.g. LoreBookSetting's
 * 캐릭터 / 챗 / 설정 bar). The tab buttons live in a sibling container of the list, so they are
 * never direct children of the focused field's ancestors: climb and query each ancestor's subtree,
 * and stop at the first (innermost) ancestor that contains an active tab.
 */
async function findNearestActiveTabLabel(startNode, maxHops = 6) {
  let cur = startNode;
  for (let hop = 0; hop < maxHops && cur; hop++) {
    let parent = null;
    try {
      parent = await cur.getParent();
    } catch (err) { noteDetectError(err); }
    if (!parent || typeof parent.querySelector !== 'function') return '';
    try {
      const tab = await parent.querySelector('button.bg-selected, [role="tab"][aria-selected="true"]');
      if (tab) {
        return String((await tab.textContent()) || '').replace(/\s+/g, ' ').trim().slice(0, 36);
      }
    } catch (err) { noteDetectError(err); }
    cur = parent;
  }
  return '';
}

const MODULE_HEADING_KEYWORDS = ['모듈 수정', 'edit module', '모듈 생성', 'create module', '모듈', 'modules'];

function detectModuleTabKind(activeTabs) {
  const tabText = Array.isArray(activeTabs) ? activeTabs.join(' | ') : String(activeTabs || '');
  if (!tabText) return null;
  if (matchAny(tabText, ['로어북', 'lorebook', 'lore book'])) return 'lorebook';
  if (matchAny(tabText, ['정규식', 'regex'])) return 'regex';
  if (matchAny(tabText, ['트리거', 'trigger'])) return 'trigger';
  if (matchAny(tabText, ['추가 에셋', 'additional assets', 'assets'])) return 'assets';
  if (matchAny(tabText, ['기본 정보', 'basic info'])) return 'basic';
  return null;
}

/**
 * Collects active tab button labels across both PocketRisu (`[role="tab"][aria-selected="true"]`)
 * and upstream RisuAI (`button.bg-darkbutton` / `button.bg-selected`).
 */
async function collectActiveTabs(scopeRoot) {
  if (!scopeRoot || typeof scopeRoot.querySelectorAll !== 'function') return [];
  const found = [];
  const pushUnique = (txt) => {
    const t = String(txt || '').replace(/\s+/g, ' ').trim();
    if (t && t.length <= 36 && !found.includes(t)) found.push(t);
  };
  try {
    const ariaTabs = await scopeRoot.querySelectorAll('[role="tab"][aria-selected="true"]');
    const len = ariaTabs ? Math.min(await ariaTabs.length(), 6) : 0;
    for (let i = 0; i < len; i++) {
      const node = await ariaTabs.at(i);
      if (node) pushUnique(await node.textContent());
    }
  } catch (err) { noteDetectError(err); }
  if (found.length === 0) {
    try {
      const clsTabs = await scopeRoot.querySelectorAll('button.bg-darkbutton, button.bg-selected');
      const len = clsTabs ? Math.min(await clsTabs.length(), 8) : 0;
      for (let i = 0; i < len; i++) {
        const node = await clsTabs.at(i);
        if (node) pushUnique(await node.textContent());
      }
    } catch (err) { noteDetectError(err); }
  }
  return found;
}

/**
 * Resolves the tightest ancestor of a module heading (`<h2>모듈 수정</h2>`) that contains
 * ModuleMenu tabs or `[data-risu-idx]` items, preventing cross-talk with unrelated sidebars.
 */
async function resolveModuleScopeRoot(h2Node, rootDoc) {
  let cur = h2Node;
  for (let hop = 0; hop < 3 && cur; hop++) {
    let parent = null;
    try { parent = await cur.getParent(); } catch (err) { noteDetectError(err); }
    if (!parent) break;
    if (typeof parent.querySelector === 'function') {
      try {
        const marker = await parent.querySelector('[role="tab"], button.bg-darkbutton, button.bg-selected, [data-risu-idx]');
        if (marker) return parent;
      } catch (err) { noteDetectError(err); }
    }
    cur = parent;
  }
  return rootDoc;
}

/**
 * Collects bounded DOM hints from an open ModuleMenu screen so HostAdapter can
 * deterministically identify which module in `db.modules` is open and which entry is expanded.
 */
async function collectModuleDomHints(scopeRoot, { activeTabs = [], focusedLoreIdx = null, focusedTextPreview = '' } = {}) {
  if (!scopeRoot) return null;
  const tab = detectModuleTabKind(activeTabs);
  const items = [];
  let totalIdxCount = 0;
  let openEditableIdx = null;
  let openInputIdx = null;
  let openTextPreview = '';
  let luaTextPreview = '';
  const assetNames = [];

  // Scan [data-risu-idx] entries on Lorebook / Regex tabs (or when tab is unknown)
  if ((tab === 'lorebook' || tab === 'regex' || tab === null) && typeof scopeRoot.querySelectorAll === 'function') {
    try {
      const idxNodes = await scopeRoot.querySelectorAll('[data-risu-idx]');
      const rawLen = idxNodes ? await idxNodes.length() : 0;
      totalIdxCount = rawLen;
      const limit = Math.min(rawLen, 24);
      for (let i = 0; i < limit; i++) {
        const node = await idxNodes.at(i);
        if (!node) continue;

        // Hidden items inside closed folders render empty placeholder divs without `button.valuer`
        let titleBtn = null;
        if (typeof node.querySelector === 'function') {
          try { titleBtn = await node.querySelector('button.valuer'); } catch (err) { noteDetectError(err); }
        }
        if (!titleBtn) continue;

        let idx = null;
        try {
          const nodeOuter = await node.getOuterHTML();
          const nodeAttrs = parseOpeningTagAttrs(nodeOuter);
          const parsed = parseInt(nodeAttrs['data-risu-idx'], 10);
          if (!Number.isNaN(parsed) && parsed >= 0) idx = parsed;
        } catch (err) { noteDetectError(err); }
        if (idx === null) continue;

        let title = '';
        try {
          title = String((await titleBtn.textContent()) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        } catch (err) { noteDetectError(err); }
        items.push({ idx, title });

        // Detect expanded accordion entry; iterating in DOM order picks the innermost entry over outer folders
        if (typeof node.querySelector === 'function') {
          try {
            const ce = await node.querySelector('[contenteditable="true"], [contenteditable=""]');
            if (ce) {
              openEditableIdx = idx;
              try {
                const txt = String((await ce.innerText()) || '').slice(0, 600);
                if (txt.trim()) openTextPreview = txt;
              } catch (err) { noteDetectError(err); }
            } else if (openEditableIdx === null) {
              const inp = await node.querySelector('textarea, input');
              if (inp) openInputIdx = idx;
            }
          } catch (err) { noteDetectError(err); }
        }
      }
    } catch (err) { noteDetectError(err); }
  }

  // On Trigger tab (or fallback with no [data-risu-idx]), read visible Lua [contenteditable="true"]
  if ((tab === 'trigger' || (tab === null && items.length === 0)) && typeof scopeRoot.querySelector === 'function') {
    try {
      const ce = await scopeRoot.querySelector('[contenteditable="true"], [contenteditable=""]');
      if (ce) {
        const txt = String((await ce.innerText()) || '').slice(0, 600);
        if (txt.trim()) luaTextPreview = txt;
      }
    } catch (err) { noteDetectError(err); }
  }

  // On Additional Assets tab, read visible asset names from table cells
  if (tab === 'assets' && typeof scopeRoot.querySelectorAll === 'function') {
    try {
      const tds = await scopeRoot.querySelectorAll('td');
      const len = tds ? Math.min(await tds.length(), 16) : 0;
      for (let i = 0; i < len; i++) {
        const td = await tds.at(i);
        if (!td) continue;
        const txt = String((await td.textContent()) || '').trim();
        if (txt && txt.length <= 120 && !assetNames.includes(txt)) {
          assetNames.push(txt);
        }
      }
    } catch (err) { noteDetectError(err); }
  }

  const openIdx = Number.isInteger(focusedLoreIdx)
    ? focusedLoreIdx
    : (openEditableIdx !== null ? openEditableIdx : openInputIdx);
  const textPreview = String(focusedTextPreview || openTextPreview || luaTextPreview || '').slice(0, 600);

  if (!tab && items.length === 0 && !textPreview && assetNames.length === 0) {
    return null;
  }

  const fpParts = [
    tab || '',
    String(totalIdxCount),
    items.slice(0, 6).map(it => `${it.idx}:${it.title}`).join(','),
    openIdx ?? '',
    textPreview.slice(0, 64).replace(/\s+/g, ' ').trim(),
    assetNames.slice(0, 4).join(','),
  ];

  return {
    tab,
    totalIdxCount,
    items,
    openIdx,
    textPreview,
    assetNames,
    fingerprint: fpParts.join('#'),
  };
}

/**
 * Pure classification logic: takes DOM snapshot signals gathered from SafeElement traversal
 * and resolves a structured FocusContext suitable for RisuHelper's host adapter & LLM.
 */
function classifyDomSignals(signals) {
  const {
    tag = '',
    placeholder = '',
    inputType = '',
    isContentEditable = false,
    liveTextPreview = '',
    nearbyLabel = '',
    headings = [],
    loreIdx = null,
    activeTabs = [],
    luaButtonActive = false,
    hasRegexContainer = false,
    hasTriggerContainer = false,
    isChatInput = false,
    settingId = '',
    chatIndex = null,
    isChatMessageEdit = false,
    tableRowIndex = null,
    moduleDomHints = null,
    loreTabLabel = '',
  } = signals || {};

  const headingText = headings.join(' | ');
  const activeTabText = activeTabs.join(' | ');
  const normSettingId = String(settingId || '').trim().toLowerCase();
  const warnings = [];

  // 0. Explicit chat input textarea (DefaultChatScreen.svelte: textarea.text-input-area / #messageInputTranslate)
  // Checked first so random <h2> tags inside chat messages/sidebars never misclassify the chat composer.
  if (isChatInput) {
    return {
      detectedAt: Date.now(),
      screen: 'chat',
      targetKind: 'general',
      fieldKey: null,
      loreIndex: null,
      loreScope: null,
      labelText: '채팅 입력 화면',
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 0.5. Chat bubble message editor (Chat.svelte: .risu-chat[data-chat-index] / textarea.message-edit-area)
  if (isChatMessageEdit) {
    const idx = Number.isInteger(chatIndex) ? chatIndex : null;
    return {
      detectedAt: Date.now(),
      screen: 'chat',
      targetKind: 'chat_message',
      fieldKey: 'data',
      loreIndex: null,
      loreScope: null,
      messageIndex: idx,
      labelText: idx === -1
        ? '채팅 · 첫 메시지 수정'
        : idx !== null && idx >= 0
          ? `채팅 메시지 #${idx + 1} 수정`
          : '채팅 메시지 수정',
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 0.75. Deterministic PocketRisu data-setting-id detection for Display HTML/CSS
  if (normSettingId === 'display.guihtml' || normSettingId === 'display.customcss') {
    const fieldKey = normSettingId === 'display.guihtml' ? 'guiHTML' : 'customCSS';
    return {
      detectedAt: Date.now(),
      screen: 'settings',
      targetKind: 'config',
      fieldKey,
      loreIndex: null,
      loreScope: null,
      labelText: CONFIG_FIELD_META[fieldKey]?.label || `설정 · ${fieldKey}`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 0.8. List search boxes are never an edit target (module / persona / lorebook list filters).
  if (isSearchField(placeholder, inputType)) {
    const screen = matchAny(headingText, ['페르소나', 'persona'])
      ? 'persona'
      : matchAny(headingText, MODULE_HEADING_KEYWORDS) ? 'module' : 'unknown';
    return {
      detectedAt: Date.now(),
      screen,
      targetKind: 'general',
      fieldKey: null,
      loreIndex: null,
      loreScope: null,
      labelText: `${SCREEN_LABELS[screen] || SCREEN_LABELS.unknown} · 검색창`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 0.9. Any other declarative setting row (PocketRisu `data-setting-id`, e.g. `adv.descPrefix`)
  //      is a global setting: it must never fall through to character / lorebook label heuristics.
  if (normSettingId && !normSettingId.startsWith('module.')) {
    return {
      detectedAt: Date.now(),
      screen: 'settings',
      targetKind: 'config',
      fieldKey: null,
      loreIndex: null,
      loreScope: null,
      settingId: String(settingId).trim(),
      labelText: `설정 · ${nearbyLabel ? nearbyLabel.slice(0, 28) : String(settingId).trim()}`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 1. Persona settings screen
  const isPersonaScreen =
    matchAny(headingText, ['페르소나', 'persona']) ||
    placeholder.toLowerCase().includes('description of this persona') ||
    placeholder.toLowerCase().includes('persona');

  if (isPersonaScreen) {
    let fieldKey = null;
    if (labelIs(nearbyLabel, ['이름', 'name']) || placeholder === 'User') {
      fieldKey = 'name';
    } else if (labelIs(nearbyLabel, ['메모', 'note'])) {
      fieldKey = 'note';
    } else if (
      labelIs(nearbyLabel, ['설명', 'description']) ||
      placeholder.toLowerCase().includes('description of this persona') ||
      (!nearbyLabel && (tag === 'textarea' || isContentEditable))
    ) {
      fieldKey = 'personaPrompt';
    }
    if (!fieldKey) {
      return {
        detectedAt: Date.now(),
        screen: 'persona',
        targetKind: 'general',
        fieldKey: null,
        loreIndex: null,
        loreScope: null,
        labelText: `페르소나 화면${nearbyLabel ? ` (${nearbyLabel.slice(0, 28)})` : ''}`,
        placeholder,
        liveTextPreview,
        warnings,
      };
    }
    return {
      detectedAt: Date.now(),
      screen: 'persona',
      targetKind: 'persona',
      fieldKey,
      loreIndex: null,
      loreScope: null,
      labelText: `페르소나 · ${fieldKey === 'name' ? '이름' : fieldKey === 'note' ? '메모' : '설명 프롬프트'}`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 2. Module settings / edit screen
  const isModuleEdit = matchAny(headingText, ['모듈 수정', 'edit module', '모듈 생성', 'create module']);
  const isModuleScreen = isModuleEdit || matchAny(headingText, ['모듈', 'modules']) || normSettingId.startsWith('module.');
  const modHintsExtra = isModuleScreen && moduleDomHints ? { moduleDomHints } : {};

  if (isModuleEdit) {
    warnings.push('모듈 편집 화면(tempModule)이 열려 있습니다. 플러그인에서 모듈을 저장한 뒤 하단 "모듈 수정" 버튼을 누르면 플러그인 변경이 덮어써질 수 있으니, 편집창을 닫고 다시 확인하세요.');
  }

  // 3. Lua trigger script editor (strictly verified via adjacent Lua mode bar or explicit trigger script label)
  if (
    luaButtonActive ||
    hasTriggerContainer ||
    labelIs(nearbyLabel, ['트리거 스크립트', 'trigger script'])
  ) {
    const targetKind = isModuleScreen ? 'module_lua' : 'char_lua';
    return {
      detectedAt: Date.now(),
      screen: isModuleScreen ? 'module' : 'scripts',
      targetKind,
      fieldKey: 'code',
      loreIndex: null,
      loreScope: null,
      labelText: `${isModuleScreen ? '모듈' : '캐릭터'} Lua 트리거 스크립트`,
      placeholder,
      liveTextPreview: liveTextPreview || (isModuleScreen ? moduleDomHints?.textPreview || '' : ''),
      ...modHintsExtra,
      warnings,
    };
  }

  // 4. Regex script editor (checked BEFORE lorebook because RegexData.svelte also carries data-risu-idx)
  if (hasRegexContainer || labelIs(nearbyLabel, ['정규식 스크립트', 'regex script'])) {
    const targetKind = isModuleScreen ? 'module_regex' : 'char_regex';
    const regexIdx = loreIdx !== null && Number.isInteger(loreIdx) && loreIdx >= 0 ? loreIdx : null;
    let fieldKey = 'in';
    if (labelIs(nearbyLabel, ['out', '출력', '치환'])) fieldKey = 'out';
    else if (labelIs(nearbyLabel, ['이름', 'name', 'comment'])) fieldKey = 'comment';
    return {
      detectedAt: Date.now(),
      screen: isModuleScreen ? 'module' : 'scripts',
      targetKind,
      fieldKey,
      loreIndex: null,
      loreScope: null,
      regexIndex: regexIdx,
      labelText: `${isModuleScreen ? '모듈' : '캐릭터'} 정규식 스크립트${regexIdx !== null ? ` #${regexIdx + 1}` : ''}`,
      placeholder,
      liveTextPreview: liveTextPreview || (isModuleScreen ? moduleDomHints?.textPreview || '' : ''),
      ...modHintsExtra,
      warnings,
    };
  }

  // 5. Lorebook item (identified by data-risu-idx inside LoreBookData)
  if (loreIdx !== null && Number.isInteger(loreIdx) && loreIdx >= 0) {
    let loreScope = 'character';
    let targetKind = 'char_lorebook';
    if (isModuleScreen) {
      loreScope = 'module';
      targetKind = 'module_lorebook';
    } else if (labelIs(loreTabLabel, LORE_CHAT_TAB_LABELS) || activeTabs.some(t => labelIs(t, LORE_CHAT_TAB_LABELS))) {
      loreScope = 'chat';
      targetKind = 'chat_lorebook';
    }

    let fieldKey = null;
    if (labelIs(nearbyLabel, ['폴더 이름', 'folder name', '이름', 'name'])) fieldKey = 'comment';
    else if (labelIs(nearbyLabel, ['두번째 키', 'secondary keys', '보조 키'])) fieldKey = 'secondkey';
    else if (labelIs(nearbyLabel, ['활성화 키', 'activation keys'])) fieldKey = 'key';
    else if (labelIs(nearbyLabel, ['배치 순서', 'insert order', 'insertion order'])) fieldKey = 'insertorder';
    else if (labelIs(nearbyLabel, ['프롬프트', 'prompt']) || tag === 'textarea' || isContentEditable) fieldKey = 'content';

    if (!fieldKey) {
      // Unknown single-line input inside a lore entry: never guess that it is the entry body.
      const scopeName = loreScope === 'module' ? '모듈 로어북' : loreScope === 'chat' ? '채팅 로어북' : '캐릭터 로어북';
      return {
        detectedAt: Date.now(),
        screen: isModuleScreen ? 'module' : 'lorebook',
        targetKind: 'general',
        fieldKey: null,
        loreIndex: null,
        loreScope: null,
        labelText: `${scopeName} #${loreIdx + 1}${nearbyLabel ? ` · ${nearbyLabel.slice(0, 20)}` : ''} (편집 대상 아님)`,
        placeholder,
        liveTextPreview,
        warnings,
      };
    }

    const scopeLabel = loreScope === 'module' ? '모듈 로어북' : loreScope === 'chat' ? '채팅 로어북' : '캐릭터 로어북';
    const fieldLabelMap = { comment: '이름', key: '활성화 키', secondkey: '보조 키', insertorder: '배치 순서', content: '본문' };
    return {
      detectedAt: Date.now(),
      screen: isModuleScreen ? 'module' : 'lorebook',
      targetKind,
      fieldKey,
      loreIndex: loreIdx,
      loreScope,
      labelText: `${scopeLabel} #${loreIdx + 1} · ${fieldLabelMap[fieldKey] || fieldKey}`,
      placeholder,
      liveTextPreview: liveTextPreview || (isModuleScreen ? moduleDomHints?.textPreview || '' : ''),
      ...modHintsExtra,
      warnings,
    };
  }

  // 6. Module screen (active tab routing + dedicated module_field targets)
  if (isModuleScreen) {
    const isExplicitBgEmbed =
      normSettingId === 'module.backgroundembedding' ||
      labelIs(nearbyLabel, ['백그라운드 임베딩', 'background embedding', 'background html']) ||
      labelIs(placeholder, ['백그라운드 임베딩', 'background embedding']);
    const isExplicitToggle =
      normSettingId === 'module.custommoduletoggle' ||
      labelIs(nearbyLabel, ['커스텀 토글', 'custom toggle', 'custom toggles', '토글', 'toggle']);
    const isExplicitNamespace =
      normSettingId === 'module.namespace' ||
      labelIs(nearbyLabel, ['네임스페이스', 'namespace']);
    const isExplicitName =
      normSettingId === 'module.name' ||
      labelIs(nearbyLabel, ['이름', 'name']);
    const isExplicitDesc =
      normSettingId === 'module.description' ||
      labelIs(nearbyLabel, ['설명', 'description']);
    const hasExplicitModuleField =
      isExplicitBgEmbed || isExplicitToggle || isExplicitNamespace || isExplicitName || isExplicitDesc;

    if (!hasExplicitModuleField) {
      const modTab = moduleDomHints?.tab || detectModuleTabKind(activeTabs);
      if (modTab === 'lorebook') {
        const openIdx = Number.isInteger(moduleDomHints?.openIdx) ? moduleDomHints.openIdx : null;
        return {
          detectedAt: Date.now(),
          screen: 'module',
          targetKind: 'module_lorebook',
          fieldKey: 'content',
          loreIndex: openIdx,
          loreScope: 'module',
          labelText: openIdx !== null ? `모듈 로어북 #${openIdx + 1} · 본문` : '모듈 로어북 목록',
          placeholder,
          liveTextPreview: liveTextPreview || moduleDomHints?.textPreview || '',
          ...modHintsExtra,
          warnings,
        };
      }
      if (modTab === 'regex') {
        const openIdx = Number.isInteger(moduleDomHints?.openIdx) ? moduleDomHints.openIdx : null;
        return {
          detectedAt: Date.now(),
          screen: 'module',
          targetKind: 'module_regex',
          fieldKey: 'out',
          loreIndex: null,
          loreScope: null,
          regexIndex: openIdx,
          labelText: openIdx !== null ? `모듈 정규식 스크립트 #${openIdx + 1}` : '모듈 정규식 스크립트',
          placeholder,
          liveTextPreview: liveTextPreview || moduleDomHints?.textPreview || '',
          ...modHintsExtra,
          warnings,
        };
      }
      if (modTab === 'trigger') {
        return {
          detectedAt: Date.now(),
          screen: 'module',
          targetKind: 'module_lua',
          fieldKey: 'code',
          loreIndex: null,
          loreScope: null,
          labelText: '모듈 Lua 트리거 스크립트',
          placeholder,
          liveTextPreview: liveTextPreview || moduleDomHints?.textPreview || '',
          ...modHintsExtra,
          warnings,
        };
      }
    }

    if (!hasExplicitModuleField) {
      // Module list or an unlabeled control: do not guess "module description".
      return {
        detectedAt: Date.now(),
        screen: 'module',
        targetKind: 'general',
        fieldKey: null,
        loreIndex: null,
        loreScope: null,
        labelText: `모듈 화면${nearbyLabel ? ` (${nearbyLabel.slice(0, 28)})` : ''}`,
        placeholder,
        liveTextPreview,
        ...modHintsExtra,
        warnings,
      };
    }

    let fieldKey = 'description';
    if (isExplicitBgEmbed) {
      fieldKey = 'backgroundEmbedding';
    } else if (isExplicitToggle) {
      fieldKey = 'customModuleToggle';
    } else if (isExplicitNamespace) {
      fieldKey = 'namespace';
    } else if (isExplicitName) {
      fieldKey = 'name';
    }
    return {
      detectedAt: Date.now(),
      screen: 'module',
      targetKind: 'module_field',
      fieldKey,
      loreIndex: null,
      loreScope: null,
      labelText: MODULE_FIELD_META[fieldKey]?.label || `모듈 · ${nearbyLabel || fieldKey}`,
      placeholder,
      liveTextPreview,
      ...modHintsExtra,
      warnings,
    };
  }

  // 7. Explicit config CSS/HTML fields (upstream RisuAI & PocketRisu labels)
  if (labelIs(nearbyLabel, ['커스텀 css', 'custom css', '채팅 html', 'chat html', 'gui html'])) {
    const fieldKey = labelIs(nearbyLabel, ['채팅 html', 'chat html', 'gui html']) ? 'guiHTML' : 'customCSS';
    return {
      detectedAt: Date.now(),
      screen: 'settings',
      targetKind: 'config',
      fieldKey,
      loreIndex: null,
      loreScope: null,
      labelText: CONFIG_FIELD_META[fieldKey]?.label || `설정 · ${fieldKey}`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 8. Chat Author's Note (CharConfig.svelte -> char.chats[chatPage].note)
  if (labelIs(nearbyLabel, ['작가의 노트', "author's note", 'author note'])) {
    return {
      detectedAt: Date.now(),
      screen: 'character',
      targetKind: 'chat_note',
      fieldKey: 'note',
      loreIndex: null,
      loreScope: null,
      labelText: '작가의 노트 (현재 채팅)',
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 8.5. Character Alternate Greetings (checked BEFORE firstMessage because '추가 첫 메시지' contains '첫 메시지')
  if (labelIs(nearbyLabel, ['추가 첫 메시지', 'alternate greetings', 'alternative first messages', 'alt greet'])) {
    const gIdx = Number.isInteger(tableRowIndex) && tableRowIndex >= 0 ? tableRowIndex : null;
    return {
      detectedAt: Date.now(),
      screen: 'character',
      targetKind: 'char_alt_greeting',
      fieldKey: 'alternateGreetings',
      loreIndex: null,
      loreScope: null,
      greetingIndex: gIdx,
      labelText: gIdx !== null ? `캐릭터 · 추가 첫 메시지 #${gIdx + 1}` : '캐릭터 · 추가 첫 메시지',
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 9. Character config fields (CharConfig.svelte — checked BEFORE generic Settings headings
  //    because CharConfig's Advanced tab also renders <h2>고급 설정</h2>)
  const charFieldChecks = [
    ['name', ['character name', 'group name', '캐릭터 이름', '그룹 이름']],
    ['nickname', ['닉네임', 'nickname']],
    ['additionalText', ['추가 디스크립션', 'additional description', 'additional text']],
    ['desc', ['설명', 'description', '캐릭터 설명']],
    ['firstMessage', ['첫 메시지', 'first message']],
    ['creatorNotes', ['제작자 코멘트', "creator's comment", 'creator notes']],
    ['systemPrompt', ['시스템 프롬프트', 'system prompt']],
    ['replaceGlobalNote', ['글로벌 노트 덮어쓰기', 'global note replacement']],
    ['postHistoryInstructions', ['히스토리 이후', 'post history', 'post-history']],
    ['exampleMessage', ['예시 대화', 'example message']],
    ['personality', ['성격', 'personality']],
    ['scenario', ['시나리오', 'scenario']],
    ['defaultVariables', ['기본 변수', 'default variables']],
    ['translatorNote', ['번역가의 노트', 'translator note', "translator's note"]],
    ['customModuleToggle', ['커스텀 토글', 'custom toggle', 'custom toggles', 'custom prompt template toggle']],
    ['depthPrompt', ['깊이 프롬프트', 'depth prompt']],
    ['backgroundHTML', ['백그라운드 임베딩', 'background embedding', 'background html']],
    ['virtualscript', ['캐릭터js', '캐릭터 js', 'charjs', 'character js']],
  ];

  for (const [key, terms] of charFieldChecks) {
    if (key === 'depthPrompt' && String(inputType || '').toLowerCase() === 'number') {
      continue;
    }
    if (labelIs(nearbyLabel, terms) || labelIs(placeholder, terms)) {
      const meta = CHAR_FIELD_META[key];
      return {
        detectedAt: Date.now(),
        screen: key === 'backgroundHTML' || key === 'virtualscript' ? 'scripts' : 'character',
        targetKind: 'char_field',
        fieldKey: key,
        loreIndex: null,
        loreScope: null,
        labelText: meta ? meta.label : key,
        placeholder,
        liveTextPreview,
        warnings,
      };
    }
  }

  // 9.5. Character Advanced fields RisuHelper does not edit (creator, version, numeric depth).
  //      They share <h2>고급 설정</h2> with the global Advanced Settings page, so name them
  //      explicitly rather than reporting the global settings screen.
  if (
    labelIs(nearbyLabel, ['제작자', 'creator', '캐릭터 버전', 'character version']) ||
    (labelIs(nearbyLabel, ['깊이 프롬프트', 'depth prompt']) && String(inputType || '').toLowerCase() === 'number')
  ) {
    return {
      detectedAt: Date.now(),
      screen: 'character',
      targetKind: 'general',
      fieldKey: null,
      loreIndex: null,
      loreScope: null,
      labelText: `캐릭터 · ${nearbyLabel.slice(0, 24)} (편집 미지원)`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 10. Settings / Config screens
  const isSettingsScreen = matchAny(headingText, [
    '채팅 봇', 'chat bot', '기타 봇', 'other bots', '소리 및 디스플레이', 'display',
    '고급 설정', 'advanced settings', '프롬프트 템플릿', 'prompt template', '접근성', 'accessibility',
  ]);

  if (isSettingsScreen) {
    return {
      detectedAt: Date.now(),
      screen: 'settings',
      targetKind: 'config',
      fieldKey: null,
      loreIndex: null,
      loreScope: null,
      labelText: `설정 / 컨피그 (${headings[0] || '일반'})`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 11. Lorebook heading open without specific item focused
  if (matchAny(headingText, ['로어북', 'lorebook'])) {
    const isChat = labelIs(loreTabLabel, LORE_CHAT_TAB_LABELS) || activeTabs.some(t => labelIs(t, LORE_CHAT_TAB_LABELS));
    return {
      detectedAt: Date.now(),
      screen: 'lorebook',
      targetKind: isChat ? 'chat_lorebook' : 'char_lorebook',
      fieldKey: 'content',
      loreIndex: null,
      loreScope: isChat ? 'chat' : 'character',
      labelText: isChat ? '채팅 로어북 목록' : '캐릭터 로어북 목록',
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  return {
    detectedAt: Date.now(),
    screen: 'unknown',
    targetKind: 'general',
    fieldKey: null,
    loreIndex: null,
    loreScope: null,
    labelText: nearbyLabel
      ? `${SCREEN_LABELS.unknown} (${nearbyLabel.slice(0, 28)})`
      : SCREEN_LABELS.unknown,
    placeholder,
    liveTextPreview,
    warnings,
  };
}

/**
 * Inspects the currently focused element in RisuAI's SafeDocument (`rootDoc`).
 * Returns null if nothing editable is focused (or if mainDom is unavailable).
 */
async function inspectFocusedElement(rootDoc, options = {}) {
  if (!rootDoc) return null;
  const diag = options.diagnostics ? { errors: [] } : null;
  const prevDiagnostics = activeDiagnostics;
  if (diag) activeDiagnostics = diag;

  try {
    let el;
    try {
      el = await rootDoc.querySelector(FOCUS_SELECTOR);
    } catch (err) {
      noteDetectError(err);
      return null;
    }
    if (!el) return null;

    const outerHtml = await el.getOuterHTML();
    const attrs = parseOpeningTagAttrs(outerHtml);
    const tag = attrs._tag || String(await el.nodeName()).toLowerCase();
    const isContentEditable = attrs.contenteditable === 'true' || attrs.contenteditable === '';

    // Ignore our own injected chip if ever focused
    if (attrs[CHIP_ATTR] !== undefined) return null;

    let liveTextPreview = '';
    if (isContentEditable) {
      try {
        liveTextPreview = String((await el.innerText()) || '').slice(0, 600);
      } catch (err) { noteDetectError(err); }
    }

    let elRect = null;
    try {
      if (typeof el.getBoundingClientRect === 'function') {
        const rect = await el.getBoundingClientRect();
        if (hasUsableRect(rect)) elRect = rect;
      }
    } catch (err) { noteDetectError(err); }

    const headings = [];
    const activeTabs = [];
    let nearbyLabel = '';
    let loreIdx = null;
    let settingId = attrs['data-setting-id'] || '';
    let chatIndex = null;
    let tableRowIndex = null;
    let luaButtonActive = false;
    let hasRegexContainer = false;
    let hasTriggerContainer = false;
    let moduleScopeCandidate = null;
    let moduleH2Node = null;
    let loreItemNode = null;
    // Check the focused element itself first (DefaultChatScreen puts `text-input-area` directly on <textarea>)
    let isChatInput = isChatElementAttrs(attrs);
    let isChatMessageEdit = String(attrs.class || '').includes('message-edit-area');

    // Walk up ancestors (bounded to 12 hops; child scans stay strictly bounded to close containers)
    let cur = el;
    let curOuter = outerHtml;
    let curTag = tag;
    for (let depth = 0; depth < 12 && cur; depth++) {
      const parent = await cur.getParent();
      if (!parent) break;

      const pOuter = await parent.getOuterHTML();
      const pAttrs = parseOpeningTagAttrs(pOuter);
      const pTag = pAttrs._tag || '';

      if (loreIdx === null && pAttrs['data-risu-idx'] !== undefined) {
        const parsed = parseInt(pAttrs['data-risu-idx'], 10);
        if (!Number.isNaN(parsed)) {
          loreIdx = parsed;
          loreItemNode = parent;
        }
      }

      if (!settingId && pAttrs['data-setting-id']) {
        settingId = pAttrs['data-setting-id'];
      }

      if (chatIndex === null && pAttrs['data-chat-index'] !== undefined) {
        const parsed = parseInt(pAttrs['data-chat-index'], 10);
        if (!Number.isNaN(parsed)) {
          chatIndex = parsed;
          isChatMessageEdit = true;
        }
      }

      if (!isChatMessageEdit && String(pAttrs.class || '').split(/\s+/).includes('risu-chat')) {
        isChatMessageEdit = true;
      }

      const trackTableRow = tableRowIndex === null && curTag === 'tr' && (pTag === 'tbody' || pTag === 'table') && depth <= 5;
      const needAltGreetingLabel = tableRowIndex !== null && !nearbyLabel && depth <= 8;
      const shouldScanChildren = depth <= 4 || trackTableRow || needAltGreetingLabel;

      // Inspect direct children of close ancestors for labels, headings, and Lua/Regex/tab markers
      if (shouldScanChildren) {
        const children = await parent.getChildren();
        const len = children ? await children.length() : 0;
        const limit = Math.min(len, 64);
        const checkLocalContext = depth <= 3 || needAltGreetingLabel;

        // When depth > 0, check if SafeElement.querySelector(':focus') resolves the exact descendant branch.
        // This disambiguates sibling TextAreaInput wrappers that share identical outerHTML (e.g. PocketRisu).
        let focusQueryWorks = false;
        if ((checkLocalContext || trackTableRow) && depth > 0 && typeof parent.querySelector === 'function') {
          try {
            focusQueryWorks = Boolean(await parent.querySelector(FOCUS_SELECTOR));
          } catch (err) { noteDetectError(err); }
        }

        let prevPrimarySpan = '';
        let prevFallbackSpan = '';
        let prevSiblingWasLuaBar = false;
        let foundCur = false;
        let seenTrCount = 0;
        const containerSpanLabels = [];

        for (let i = 0; i < limit; i++) {
          const child = await children.at(i);
          if (!child) continue;
          const cName = String(await child.nodeName()).toLowerCase();

          // 1. Identify the exact sibling matching `cur`
          let isCur = false;
          if ((checkLocalContext || trackTableRow) && !foundCur && (!curTag || cName === curTag)) {
            if (depth > 0 && focusQueryWorks) {
              try {
                isCur = Boolean(await child.querySelector(FOCUS_SELECTOR));
              } catch (err) { noteDetectError(err); }
            } else if (depth === 0 && elRect && typeof child.getBoundingClientRect === 'function') {
              try {
                const cRect = await child.getBoundingClientRect();
                isCur = rectsMatch(elRect, cRect);
              } catch (err) { noteDetectError(err); }
            }
            if (!isCur && !focusQueryWorks && !(depth === 0 && elRect)) {
              try {
                const cOuter = await child.getOuterHTML();
                isCur = cOuter === outerHtml || (depth > 0 && cOuter === curOuter);
              } catch (err) { noteDetectError(err); }
            }
          }

          if (isCur) {
            foundCur = true;
            if (trackTableRow && seenTrCount >= 1) {
              // Row 0 is the <th> header row in CharConfig's alternateGreetings table
              tableRowIndex = seenTrCount - 1;
            }
            const candidateLabel = prevPrimarySpan || prevFallbackSpan;
            if (!nearbyLabel && candidateLabel) {
              nearbyLabel = candidateLabel;
            }
            if (prevSiblingWasLuaBar) {
              luaButtonActive = true;
              hasTriggerContainer = true;
            }
            continue;
          }

          if (trackTableRow && !foundCur && cName === 'tr') {
            seenTrCount++;
            continue;
          }

          // 2. Gather headings, labels, RegexData markers, active tabs, and immediate Lua mode bars
          if (cName === 'h2' || cName === 'h3') {
            const ht = String((await child.textContent()) || '').trim();
            if (ht && !headings.includes(ht)) headings.push(ht);
            if (!moduleScopeCandidate && matchAny(ht, MODULE_HEADING_KEYWORDS)) {
              moduleScopeCandidate = parent;
              moduleH2Node = child;
            }
            if (!foundCur) prevSiblingWasLuaBar = false;
          } else if (cName === 'span' || cName === 'label') {
            const st = String((await child.textContent()) || '').trim();
            const cClass = String((await child.getClassName()) || '');
            if (st && st.length <= 60) {
              if (checkLocalContext) {
                containerSpanLabels.push(normalizeLabel(st));
              }
              if (!foundCur) {
                if (isMutedHelperSpan(cClass, st)) {
                  if (!isTokenCountText(st)) {
                    prevFallbackSpan = st;
                  }
                } else {
                  prevPrimarySpan = st;
                  prevFallbackSpan = '';
                  prevSiblingWasLuaBar = false;
                }
              }
            }
          } else if (cName === 'button') {
            const cls = String((await child.getClassName()) || '');
            const bt = String((await child.textContent()) || '').trim();
            if (checkLocalContext && !foundCur) {
              if (bt === 'Lua' && cls.includes('ring-1')) {
                prevSiblingWasLuaBar = true;
              } else {
                prevSiblingWasLuaBar = false;
              }
            }
            if ((cls.includes('bg-selected') || cls.includes('bg-darkbutton')) && bt && bt.length <= 32) {
              if (!activeTabs.includes(bt)) activeTabs.push(bt);
            }
          } else if (checkLocalContext && !foundCur) {
            if (cName === 'div') {
              const cClass = String((await child.getClassName()) || '');
              if (await isLuaModeBar(child, cClass)) {
                prevSiblingWasLuaBar = true;
              } else {
                prevSiblingWasLuaBar = false;
                const colLabel = await extractLabelFromColWrapper(child, cClass);
                if (colLabel) {
                  prevPrimarySpan = colLabel;
                  prevFallbackSpan = '';
                } else if (
                  cClass.includes('border-darkborderc') ||
                  cClass.includes('n-scroll') ||
                  cClass.includes('border-selected')
                ) {
                  prevPrimarySpan = '';
                  prevFallbackSpan = '';
                }
              }
            } else if (cName === 'input' || cName === 'textarea' || cName === 'select' || cName === 'table') {
              prevPrimarySpan = '';
              prevFallbackSpan = '';
              prevSiblingWasLuaBar = false;
            } else if (cName !== 'p') {
              prevSiblingWasLuaBar = false;
            }
          }
        }

        // Strict RegexData.svelte structural check (direct child labels only; never whole-subtree outerHTML)
        if (
          checkLocalContext &&
          !hasRegexContainer &&
          (containerSpanLabels.includes('modification type') ||
            (containerSpanLabels.includes('in:') && containerSpanLabels.includes('out:')))
        ) {
          hasRegexContainer = true;
        }
      }

      if (depth === 4 || depth === 6 || depth === 8) {
        try {
          const h2 = await parent.querySelector('h2');
          if (h2) {
            const ht = String((await h2.textContent()) || '').trim();
            if (ht && !headings.includes(ht)) headings.push(ht);
            if (!moduleScopeCandidate && matchAny(ht, MODULE_HEADING_KEYWORDS)) {
              moduleScopeCandidate = parent;
              moduleH2Node = h2;
            }
          }
        } catch (err) { noteDetectError(err); }
      }

      if (!isChatInput && isChatElementAttrs(pAttrs)) {
        isChatInput = true;
      }

      cur = parent;
      curOuter = pOuter;
      curTag = pTag;
    }

    // Also look at top-level headings in rootDoc if none found locally
    if (!isChatInput && !isChatMessageEdit && headings.length === 0) {
      try {
        const allH2 = await rootDoc.querySelectorAll('h2');
        const count = allH2 ? Math.min(await allH2.length(), 4) : 0;
        for (let i = 0; i < count; i++) {
          const node = await allH2.at(i);
          const txt = node ? String((await node.textContent()) || '').trim() : '';
          if (txt && !headings.includes(txt)) headings.push(txt);
          if (!moduleH2Node && matchAny(txt, MODULE_HEADING_KEYWORDS)) {
            moduleH2Node = node;
          }
        }
      } catch (err) { noteDetectError(err); }
    }

    const loreTabLabel = loreItemNode ? await findNearestActiveTabLabel(loreItemNode) : '';

    let moduleDomHints = null;
    const isModuleFocusContext =
      !isChatInput &&
      !isChatMessageEdit &&
      (matchAny(headings.join(' | '), MODULE_HEADING_KEYWORDS) ||
        String(settingId || '').trim().toLowerCase().startsWith('module.'));
    if (isModuleFocusContext) {
      const scopeRoot = moduleScopeCandidate || (moduleH2Node ? await resolveModuleScopeRoot(moduleH2Node, rootDoc) : rootDoc);
      const tabLabels = await collectActiveTabs(scopeRoot);
      for (const t of tabLabels) {
        if (!activeTabs.includes(t)) activeTabs.push(t);
      }
      moduleDomHints = await collectModuleDomHints(scopeRoot, {
        activeTabs,
        focusedLoreIdx: loreIdx,
        focusedTextPreview: liveTextPreview,
      });
    }

    const signals = {
      tag,
      placeholder: attrs.placeholder || '',
      inputType: attrs.type || '',
      isContentEditable,
      liveTextPreview,
      nearbyLabel,
      headings,
      loreIdx,
      activeTabs,
      luaButtonActive,
      hasRegexContainer,
      hasTriggerContainer,
      isChatInput,
      settingId,
      chatIndex,
      isChatMessageEdit,
      tableRowIndex,
      moduleDomHints,
      loreTabLabel,
    };
    const classified = classifyDomSignals(signals);
    if (diag && classified) {
      classified.diagnostics = { signals: summarizeSignals(signals), errors: diag.errors };
    }
    return classified;
  } catch (err) {
    noteDetectError(err);
    return null;
  } finally {
    if (diag) activeDiagnostics = prevDiagnostics;
  }
}

/**
 * Fallback screen detector when no editable input currently holds `:focus`
 * (for example, opening RisuHelper directly from the chat screen or after mobile blur).
 */
async function inspectVisibleScreen(rootDoc) {
  if (!rootDoc) return null;
  try {
    const headings = [];
    let moduleH2Node = null;
    try {
      const allH2 = await rootDoc.querySelectorAll('h2');
      const count = allH2 ? Math.min(await allH2.length(), 6) : 0;
      for (let i = 0; i < count; i++) {
        const node = await allH2.at(i);
        const txt = node ? String((await node.textContent()) || '').trim() : '';
        if (txt && !headings.includes(txt)) headings.push(txt);
        if (!moduleH2Node && matchAny(txt, MODULE_HEADING_KEYWORDS)) {
          moduleH2Node = node;
        }
      }
    } catch (err) { noteDetectError(err); }

    // Check explicit chat input presence first; if present and no settings/persona/module modal heading is active, it's the chat screen.
    let chatInputEl = null;
    try {
      chatInputEl = await rootDoc.querySelector(CHAT_INPUT_SELECTOR);
    } catch (err) { noteDetectError(err); }

    const headingText = headings.join(' | ');
    const modalHeadings = [
      '페르소나', 'persona',
      '모듈 수정', 'edit module', '모듈 생성', 'create module', '모듈', 'modules',
      '채팅 봇', 'chat bot', '기타 봇', 'other bots', '소리 및 디스플레이', 'display',
      '고급 설정', 'advanced settings', '프롬프트 템플릿', 'prompt template', '접근성', 'accessibility',
      '로어북', 'lorebook',
    ];
    if (matchAny(headingText, modalHeadings)) {
      if (matchAny(headingText, MODULE_HEADING_KEYWORDS)) {
        const scopeRoot = moduleH2Node ? await resolveModuleScopeRoot(moduleH2Node, rootDoc) : rootDoc;
        const activeTabs = await collectActiveTabs(scopeRoot);
        const moduleDomHints = await collectModuleDomHints(scopeRoot, { activeTabs });
        const classified = classifyDomSignals({ headings, activeTabs, moduleDomHints });
        if (classified.screen !== 'unknown') return classified;
      } else if (matchAny(headingText, ['로어북', 'lorebook'])) {
        const activeTabs = await collectActiveTabs(rootDoc);
        const classified = classifyDomSignals({ headings, activeTabs });
        if (classified.screen !== 'unknown') return classified;
      } else {
        const classified = classifyDomSignals({ headings });
        if (classified.screen !== 'unknown') return classified;
      }
    }

    if (chatInputEl) {
      return {
        detectedAt: Date.now(),
        screen: 'chat',
        targetKind: 'general',
        fieldKey: null,
        loreIndex: null,
        loreScope: null,
        labelText: '채팅 입력 화면',
        placeholder: '',
        liveTextPreview: '',
        warnings: [],
      };
    }

    if (headings.length > 0) {
      const classified = classifyDomSignals({ headings });
      if (classified.screen !== 'unknown') return classified;
    }
    return null;
  } catch {
    return null;
  }
}

const CHIP_ANCHORS = {
  tl: 'left:14px;top:64px;',
  tr: 'right:14px;top:64px;',
  bl: 'left:14px;bottom:74px;',
  br: 'right:14px;bottom:74px;',
  ml: 'left:14px;top:50%;transform:translateY(-50%);',
  mr: 'right:14px;top:50%;transform:translateY(-50%);',
};
const CHIP_CYCLE_ORDER = ['br', 'mr', 'tr', 'tl', 'ml', 'bl'];
const LONG_PRESS_MS = 600;

function extractPointerXY(ev) {
  const src = ev?.touches?.[0] ?? ev?.changedTouches?.[0] ?? ev;
  const x = Number(src?.clientX);
  const y = Number(src?.clientY);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function normalizeChipPos(pos) {
  if (!pos || typeof pos !== 'object') return null;
  if (typeof pos.anchor === 'string' && Object.hasOwn(CHIP_ANCHORS, pos.anchor)) {
    return { anchor: pos.anchor };
  }
  if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
    return { left: Math.round(pos.left), top: Math.round(pos.top) };
  }
  return null;
}

function estimateChipOrigin(pos, chipW, chipH, viewW, viewH) {
  const norm = normalizeChipPos(pos);
  if (norm && Number.isFinite(norm.left) && Number.isFinite(norm.top)) {
    return { left: norm.left, top: norm.top };
  }
  const anchor = norm?.anchor || 'br';
  switch (anchor) {
    case 'tl': return { left: 14, top: 64 };
    case 'tr': return { left: Math.max(8, viewW - chipW - 14), top: 64 };
    case 'bl': return { left: 14, top: Math.max(8, viewH - chipH - 74) };
    case 'ml': return { left: 14, top: Math.max(8, Math.round((viewH - chipH) / 2)) };
    case 'mr': return { left: Math.max(8, viewW - chipW - 14), top: Math.max(8, Math.round((viewH - chipH) / 2)) };
    case 'br':
    default:
      return { left: Math.max(8, viewW - chipW - 14), top: Math.max(8, viewH - chipH - 74) };
  }
}

function buildChipStyle({ pos = null, left = null, top = null, dragging = false } = {}) {
  const norm = pos
    ? normalizeChipPos(pos)
    : (Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null);
  let posCss = CHIP_ANCHORS.br;
  if (norm?.anchor) {
    posCss = CHIP_ANCHORS[norm.anchor];
  } else if (norm && Number.isFinite(norm.left) && Number.isFinite(norm.top)) {
    posCss = `left:${Math.round(norm.left)}px;top:${Math.round(norm.top)}px;`;
  }
  return (
    `position:fixed;${posCss}z-index:999;display:inline-flex;align-items:center;box-sizing:border-box;` +
    'padding:7px 12px;border-radius:999px;' +
    'background:rgba(24,24,27,0.92);color:#f4f4f5;border:1px solid rgba(161,161,170,0.45);' +
    'font-size:12px;font-weight:600;line-height:1.2;box-shadow:0 6px 20px rgba(0,0,0,0.32);' +
    `cursor:${dragging ? 'grabbing' : 'grab'};touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;` +
    'max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);'
  );
}

function clampChipPos(left, top, chipW, chipH, viewW, viewH) {
  const maxLeft = Math.max(8, Math.round(viewW - chipW - 8));
  const maxTop = Math.max(8, Math.round(viewH - chipH - 8));
  return {
    left: Math.max(8, Math.min(maxLeft, Math.round(left))),
    top: Math.max(8, Math.min(maxTop, Math.round(top))),
  };
}

const FRAME_ATTR = 'x-risuhelper-frame';
const MIN_DOCK_VIEWPORT_PX = 960;
const DEFAULT_DOCK_WIDTH = 420;
const MIN_DOCK_WIDTH = 320;
const MAX_DOCK_WIDTH = 640;

/**
 * Manages allowed Plugin v3 rootDoc listeners (pointer/touch/mouse/click/keyup) to cache the latest
 * focused context BEFORE a user clicks the plugin button, renders a draggable floating chip,
 * and manages optional PC right-side docking so RisuAI remains interactive alongside RisuHelper.
 */
class FocusTracker {
  constructor(api, options = {}) {
    this.api = api;
    this.onChange = options.onChange || (() => {});
    this.onChipClick = options.onChipClick || (() => {});
    this.onChipMove = options.onChipMove || (() => {});
    this.showFloatingChip = options.showFloatingChip ?? true;
    this.chipPos = normalizeChipPos(options.chipPos);
    this.rootDoc = null;
    this.listenerIds = [];
    this.chipEl = null;
    this.chipListenerIds = [];
    this.lastContext = null;
    this.enabled = false;
    this.liveScreenFallback = false;
    this._scanPending = false;
    this._drag = null;
    this._dragHandled = false;
    this._lastDragStart = 0;
    this._lastDownType = '';
    this._longPressTimer = null;
    this._suppressClickUntil = 0;
    this._cachedViewport = null;
    this._cachedChipRect = null;
    this._styleInFlight = false;
    this._pendingStyleUpdate = null;
    this._dockFrame = null;
    this._dockMain = null;
    this._savedMainStyle = null;
    this._isDocked = false;
    this._dockWidth = DEFAULT_DOCK_WIDTH;
    this._chipHiddenForDock = false;
  }

  async _getViewportSize() {
    // 1. In RisuAI/PocketRisu, SafeDocument wraps document.documentElement (<html>) directly,
    //    so calling getBoundingClientRect() on rootDoc itself returns the true host viewport rect.
    try {
      if (this.rootDoc && typeof this.rootDoc.getBoundingClientRect === 'function') {
        const rect = await this.rootDoc.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          this._cachedViewport = { width: rect.width, height: rect.height };
          return this._cachedViewport;
        }
      }
    } catch (err) { noteDetectError(err); }
    // 2. Fallback: body rect (fixed 100dvh viewport in PocketRisu/RisuAI)
    try {
      const body = await this.rootDoc?.querySelector('body');
      if (body && typeof body.getBoundingClientRect === 'function') {
        const rect = await body.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          this._cachedViewport = { width: rect.width, height: rect.height };
          return this._cachedViewport;
        }
      }
    } catch (err) { noteDetectError(err); }
    // 3. Fallback: querySelector('html') (unit test mocks)
    try {
      const html = await this.rootDoc?.querySelector('html');
      if (html && typeof html.getBoundingClientRect === 'function') {
        const rect = await html.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          this._cachedViewport = { width: rect.width, height: rect.height };
          return this._cachedViewport;
        }
      }
    } catch (err) { noteDetectError(err); }
    if (typeof globalThis.innerWidth === 'number' && globalThis.innerWidth > 0) {
      this._cachedViewport = { width: globalThis.innerWidth, height: globalThis.innerHeight || 768 };
      return this._cachedViewport;
    }
    return this._cachedViewport || { width: 1024, height: 768 };
  }

  async getHostViewportSize() {
    if (!this.rootDoc && typeof this.api?.getRootDocument === 'function') {
      try {
        const doc = await this.api.getRootDocument();
        if (doc) this.rootDoc = doc;
      } catch (err) { noteDetectError(err); }
    }
    return await this._getViewportSize();
  }

  async _refreshChipMetrics() {
    if (!this.chipEl) return;
    try {
      const [rect, view] = await Promise.all([
        typeof this.chipEl.getBoundingClientRect === 'function' ? this.chipEl.getBoundingClientRect() : null,
        this._getViewportSize(),
      ]);
      if (rect) {
        const left = rect.left ?? rect.x;
        const top = rect.top ?? rect.y;
        if (Number.isFinite(left) && Number.isFinite(top) && rect.width > 0 && rect.height > 0) {
          this._cachedChipRect = { left, top, width: rect.width, height: rect.height };
        }
      }
      if (view && view.width > 0 && view.height > 0) {
        this._cachedViewport = view;
      }
    } catch (err) { noteDetectError(err); }
  }

  async start() {
    if (this.enabled) return true;
    if (typeof this.api?.getRootDocument !== 'function') return false;
    try {
      const rootDoc = await this.api.getRootDocument();
      if (!rootDoc) return false;
      this.rootDoc = rootDoc;
      this.enabled = true;

      // Register drag move/end listeners BEFORE focus-scan listeners so drag state resolves first.
      // Each event is wrapped individually so forks without specific event types never abort startup.
      for (const moveEvt of ['pointermove', 'touchmove', 'mousemove']) {
        try {
          const id = await rootDoc.addEventListener(moveEvt, (e) => {
            this._handlePointerMove(e);
          });
          if (id) this.listenerIds.push({ type: moveEvt, id });
        } catch (err) { noteDetectError(err); }
      }

      for (const endEvt of ['pointerup', 'touchend', 'mouseup', 'pointercancel', 'touchcancel']) {
        try {
          const id = await rootDoc.addEventListener(endEvt, () => {
            this._handlePointerEnd();
          });
          if (id) this.listenerIds.push({ type: endEvt, id });
        } catch (err) { noteDetectError(err); }
      }

      for (const evt of ['pointerup', 'click', 'keyup']) {
        try {
          const id = await rootDoc.addEventListener(evt, () => {
            if (this._drag?.moved || this._dragHandled || Date.now() < this._suppressClickUntil) return;
            this.scheduleScan();
          });
          if (id) this.listenerIds.push({ type: evt, id });
        } catch (err) { noteDetectError(err); }
      }

      if (this.showFloatingChip && !this._isDocked) {
        await this.mountFloatingChip();
      }
      this.scheduleScan();
      return true;
    } catch {
      return false;
    }
  }

  scheduleScan() {
    if (!this.enabled || this._scanPending) return;
    this._scanPending = true;
    setTimeout(async () => {
      this._scanPending = false;
      await this.scanNow({ allowScreenFallback: Boolean(this.liveScreenFallback) });
    }, 45);
  }

  async scanNow({ allowScreenFallback = false } = {}) {
    if (!this.rootDoc) return this.lastContext;
    let ctx = await inspectFocusedElement(this.rootDoc, { diagnostics: Boolean(this.diagnostics) });
    if (!ctx && allowScreenFallback) {
      ctx = await inspectVisibleScreen(this.rootDoc);
    }
    if (ctx) {
      this.lastContext = ctx;
      this.onChange(ctx);
      await this.updateChipLabel(ctx);
    }
    return this.lastContext;
  }

  async snapshotVisibleIframes() {
    const visible = new Set();
    if (!this.rootDoc || typeof this.rootDoc.querySelectorAll !== 'function') return visible;
    try {
      const frames = await this.rootDoc.querySelectorAll('iframe');
      const len = frames ? await frames.length() : 0;
      for (let i = 0; i < len; i++) {
        const f = await frames.at(i);
        if (!f || typeof f.getStyle !== 'function') continue;
        const disp = String((await f.getStyle('display')) || '').trim().toLowerCase();
        if (disp && disp !== 'none') visible.add(i);
      }
    } catch (err) { noteDetectError(err); }
    return visible;
  }

  async _findOwnIframe(beforeVisibleIndices, probeWidth, localWin) {
    if (!this.rootDoc) return null;
    if (this._dockFrame) return this._dockFrame;

    // 1. Fast path: already tagged by us earlier in this session
    try {
      const tagged = await this.rootDoc.querySelector(`iframe[${FRAME_ATTR}="1"]`);
      if (tagged) {
        this._dockFrame = tagged;
        return tagged;
      }
    } catch (err) { noteDetectError(err); }

    if (typeof this.rootDoc.querySelectorAll !== 'function') return null;

    let frames;
    try {
      frames = await this.rootDoc.querySelectorAll('iframe');
    } catch {
      return null;
    }
    const len = frames ? await frames.length() : 0;
    if (len === 0) return null;

    const newlyVisible = [];
    const otherVisible = [];
    for (let i = len - 1; i >= 0; i--) {
      const f = await frames.at(i);
      if (!f || typeof f.getStyle !== 'function' || typeof f.setStyle !== 'function') continue;
      try {
        const disp = String((await f.getStyle('display')) || '').trim().toLowerCase();
        if (disp === 'none') continue;
        if (beforeVisibleIndices && !beforeVisibleIndices.has(i)) {
          newlyVisible.push(f);
        } else {
          otherVisible.push(f);
        }
      } catch (err) { noteDetectError(err); }
    }

    const candidates = [...newlyVisible, ...otherVisible];
    if (candidates.length === 0) return null;

    // 2. Cryptographically certain self-verification: probe candidate width and verify our own
    //    iframe's window.innerWidth changes to match probeWidth before ever keeping any style change.
    const canProbeWin = Boolean(localWin && Number.isFinite(localWin.innerWidth) && localWin.innerWidth > 0);
    if (canProbeWin) {
      const origLocalW = localWin.innerWidth;
      const testWidth = Math.abs(origLocalW - probeWidth) < 16 ? probeWidth + 24 : probeWidth;
      for (const cand of candidates) {
        let origStyleW = '';
        try {
          origStyleW = String((await cand.getStyle('width')) || '');
          await cand.setStyle('width', `${testWidth}px`);
          await new Promise(r => setTimeout(r, 25));
          if (Math.abs(localWin.innerWidth - testWidth) <= 8) {
            try { await cand.setAttribute(FRAME_ATTR, '1'); } catch (err) { noteDetectError(err); }
            this._dockFrame = cand;
            return cand;
          }
          await cand.setStyle('width', origStyleW || '100%');
        } catch {
          try { await cand.setStyle('width', origStyleW || '100%'); } catch (err) { noteDetectError(err); }
        }
      }
      return null;
    }

    // 3. Fallback when localWin.innerWidth isn't simulated (e.g. unit test sandbox):
    //    only accept when strictly 1 iframe transitioned from hidden -> visible on showContainer().
    if (newlyVisible.length === 1) {
      const only = newlyVisible[0];
      try { await only.setAttribute(FRAME_ATTR, '1'); } catch (err) { noteDetectError(err); }
      this._dockFrame = only;
      return only;
    }
    return null;
  }

  async _restoreMainLayout() {
    if (!this._dockMain || !this._savedMainStyle) return;
    try {
      await this._dockMain.setStyle('width', this._savedMainStyle.width || '');
      await this._dockMain.setStyle('maxWidth', this._savedMainStyle.maxWidth || '');
      await this._dockMain.setStyle('boxSizing', this._savedMainStyle.boxSizing || '');
    } catch (err) { noteDetectError(err); }
    this._savedMainStyle = null;
    this._dockMain = null;
  }

  /**
   * Docks RisuHelper's own plugin iframe to the right edge on PC screens so RisuAI's native UI
   * stays 100% interactive side-by-side while cursor focus changes stream live into RisuHelper.
   */
  async applyDock({
    width = DEFAULT_DOCK_WIDTH,
    pushLayout = true,
    beforeVisibleIndices = null,
    localWin = null,
  } = {}) {
    if (!this.rootDoc) {
      if (typeof this.api?.getRootDocument === 'function') {
        try { this.rootDoc = await this.api.getRootDocument(); } catch (err) { noteDetectError(err); }
      }
    }
    if (!this.rootDoc) {
      return { ok: false, reason: 'mainDom 권한이 없어 PC 오른쪽 도킹을 사용할 수 없습니다.' };
    }

    const view = await this._getViewportSize();
    if (view.width < MIN_DOCK_VIEWPORT_PX) {
      return {
        ok: false,
        reason: `화면 너비(${Math.round(view.width)}px)가 좁아 PC 오른쪽 도킹을 사용할 수 없습니다. (최소 ${MIN_DOCK_VIEWPORT_PX}px)`,
      };
    }

    const maxAllowed = Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, Math.round(view.width * 0.48)));
    const dockW = Math.max(MIN_DOCK_WIDTH, Math.min(maxAllowed, Math.round(Number(width) || DEFAULT_DOCK_WIDTH)));

    const frame = await this._findOwnIframe(beforeVisibleIndices, dockW, localWin);
    if (!frame) {
      return { ok: false, reason: '플러그인 컨테이너를 식별하지 못해 일반 창 모드로 열었습니다.' };
    }

    try {
      await frame.setStyle('position', 'fixed');
      await frame.setStyle('top', '0px');
      await frame.setStyle('left', 'auto');
      await frame.setStyle('right', '0px');
      await frame.setStyle('width', `${dockW}px`);
      await frame.setStyle('height', '100%');
      await frame.setStyle('border', 'none');
      await frame.setStyle('borderLeft', '1px solid rgba(161, 161, 170, 0.28)');
      await frame.setStyle('boxShadow', '-8px 0 28px rgba(0, 0, 0, 0.32)');
    } catch {
      return { ok: false, reason: '도킹 스타일을 적용하지 못했습니다.' };
    }

    if (pushLayout) {
      try {
        const main = this._dockMain || await this.rootDoc.querySelector('main');
        if (main && typeof main.setStyle === 'function') {
          if (!this._savedMainStyle) {
            this._savedMainStyle = {
              width: typeof main.getStyle === 'function' ? String((await main.getStyle('width')) || '') : '',
              maxWidth: typeof main.getStyle === 'function' ? String((await main.getStyle('maxWidth')) || '') : '',
              boxSizing: typeof main.getStyle === 'function' ? String((await main.getStyle('boxSizing')) || '') : '',
            };
          }
          await main.setStyle('boxSizing', 'border-box');
          await main.setStyle('width', `calc(100% - ${dockW}px)`);
          await main.setStyle('maxWidth', `calc(100% - ${dockW}px)`);
          this._dockMain = main;
        }
      } catch (err) { noteDetectError(err); }
    } else {
      await this._restoreMainLayout();
    }

    if (this.chipEl) {
      this._chipHiddenForDock = true;
      await this.unmountFloatingChip();
    } else if (this.showFloatingChip) {
      this._chipHiddenForDock = true;
    }

    this._isDocked = true;
    this._dockWidth = dockW;
    this.liveScreenFallback = true;
    return { ok: true, width: dockW, viewWidth: view.width };
  }

  /**
   * Restores host <main> layout and our plugin iframe back to standard fullscreen geometry.
   */
  async releaseDock({ restoreChip = true } = {}) {
    this.liveScreenFallback = false;
    await this._restoreMainLayout();

    if (this._dockFrame && typeof this._dockFrame.setStyle === 'function') {
      try {
        await this._dockFrame.setStyle('left', '0');
        await this._dockFrame.setStyle('right', '');
        await this._dockFrame.setStyle('width', '100%');
        await this._dockFrame.setStyle('borderLeft', '');
        await this._dockFrame.setStyle('boxShadow', '');
      } catch (err) { noteDetectError(err); }
    }

    const wasHiddenForDock = this._chipHiddenForDock;
    this._isDocked = false;
    this._chipHiddenForDock = false;

    if (restoreChip && wasHiddenForDock && this.showFloatingChip && this.enabled && !this.chipEl) {
      await this.mountFloatingChip();
      if (this.lastContext) await this.updateChipLabel(this.lastContext);
    }
  }

  async _applyChipStyle(pos, dragging = false) {
    if (!this.chipEl) return;
    try {
      await this.chipEl.setStyleAttribute(buildChipStyle({
        pos,
        dragging,
      }));
    } catch (err) { noteDetectError(err); }
  }

  /**
   * Coalesces in-flight style RPC calls so the very first drag frame fires with 0ms latency
   * while never backing up the iframe postMessage bridge during rapid mouse movement.
   */
  _queueChipStyle(pos, dragging) {
    this._pendingStyleUpdate = { pos, dragging };
    if (this._styleInFlight) return;
    this._drainChipStyleQueue();
  }

  async _drainChipStyleQueue() {
    this._styleInFlight = true;
    try {
      while (this._pendingStyleUpdate) {
        const next = this._pendingStyleUpdate;
        this._pendingStyleUpdate = null;
        await this._applyChipStyle(next.pos, next.dragging);
      }
    } finally {
      this._styleInFlight = false;
    }
  }

  async _cycleChipSpot() {
    const view = this._cachedViewport || await this._getViewportSize();
    const chipW = this._cachedChipRect?.width || 140;
    const chipH = this._cachedChipRect?.height || 36;
    const curOrigin = this._cachedChipRect
      ? { left: this._cachedChipRect.left, top: this._cachedChipRect.top }
      : estimateChipOrigin(this.chipPos, chipW, chipH, view.width, view.height);

    let nextIdx = 0;
    if (this.chipPos?.anchor) {
      const idx = CHIP_CYCLE_ORDER.indexOf(this.chipPos.anchor);
      nextIdx = idx >= 0 ? (idx + 1) % CHIP_CYCLE_ORDER.length : 1;
    } else {
      const nearest = CHIP_CYCLE_ORDER.findIndex(anchor => {
        const spot = estimateChipOrigin({ anchor }, chipW, chipH, view.width, view.height);
        return Math.abs(spot.left - curOrigin.left) < 40 && Math.abs(spot.top - curOrigin.top) < 40;
      });
      nextIdx = nearest >= 0 ? (nearest + 1) % CHIP_CYCLE_ORDER.length : 1;
    }

    const nextAnchor = CHIP_CYCLE_ORDER[nextIdx];
    const nextPos = nextAnchor === 'br' ? null : { anchor: nextAnchor };
    this._suppressClickUntil = Date.now() + 500;
    await this.setChipPosition(nextPos);
    this.onChipMove(nextPos);
  }

  async _handleChipPointerDown(e) {
    if (!this.chipEl) return;
    if (e?.button === 1 || e?.button === 2) return;
    if (this._drag?.active) return; // Dedupe paired pointerdown + touchstart + mousedown

    const now = Date.now();
    const evType = String(e?.type || '');
    if (evType && this._lastDownType && this._lastDownType !== evType && now - this._lastDragStart < 120) {
      return;
    }
    this._lastDragStart = now;
    this._lastDownType = evType;
    this._dragHandled = false;

    const xy = extractPointerXY(e);
    const view = this._cachedViewport || { width: 1024, height: 768 };
    const cachedRect = this._cachedChipRect;
    const chipW = cachedRect?.width > 0 ? cachedRect.width : 140;
    const chipH = cachedRect?.height > 0 ? cachedRect.height : 36;
    const origin = (cachedRect && Number.isFinite(cachedRect.left) && Number.isFinite(cachedRect.top))
      ? { left: cachedRect.left, top: cachedRect.top }
      : estimateChipOrigin(this.chipPos, chipW, chipH, view.width, view.height);

    const drag = {
      active: true,
      startedAt: now,
      moved: false,
      hasCoords: Boolean(xy),
      startX: xy ? xy[0] : 0,
      startY: xy ? xy[1] : 0,
      lastX: xy ? xy[0] : 0,
      lastY: xy ? xy[1] : 0,
      originLeft: origin.left,
      originTop: origin.top,
      chipW,
      chipH,
      viewW: view.width,
      viewH: view.height,
    };
    this._drag = drag;

    // Long-press fallback (600ms): even on hosts that strip pointer coordinates,
    // holding the button cleanly cycles it to the next screen edge spot.
    clearTimeout(this._longPressTimer);
    this._longPressTimer = setTimeout(() => {
      if (this._drag === drag && drag.active && !drag.moved) {
        drag.active = false;
        this._drag = null;
        this._dragHandled = true;
        this._cycleChipSpot();
      }
    }, LONG_PRESS_MS);

    try {
      const [rect, liveView] = await Promise.all([
        typeof this.chipEl.getBoundingClientRect === 'function' ? this.chipEl.getBoundingClientRect() : null,
        this._getViewportSize(),
      ]);
      if (rect) {
        const left = rect.left ?? rect.x;
        const top = rect.top ?? rect.y;
        if (Number.isFinite(left) && Number.isFinite(top) && rect.width > 0 && rect.height > 0) {
          this._cachedChipRect = { left, top, width: rect.width, height: rect.height };
          if (this._drag === drag && drag.active && !drag.moved) {
            drag.originLeft = left;
            drag.originTop = top;
            drag.chipW = rect.width;
            drag.chipH = rect.height;
          }
        }
      }
      if (liveView && liveView.width > 0 && liveView.height > 0) {
        this._cachedViewport = liveView;
        if (this._drag === drag && drag.active) {
          drag.viewW = liveView.width;
          drag.viewH = liveView.height;
          if (drag.moved && drag.hasCoords) {
            const nextPos = clampChipPos(
              drag.originLeft + (drag.lastX - drag.startX),
              drag.originTop + (drag.lastY - drag.startY),
              drag.chipW,
              drag.chipH,
              drag.viewW,
              drag.viewH
            );
            this._queueChipStyle(nextPos, true);
          }
        }
      }
    } catch (err) { noteDetectError(err); }
  }

  _handlePointerMove(e) {
    const drag = this._drag;
    if (!drag || !drag.active || !drag.hasCoords) return;

    // If mouse button was released outside the window, end drag immediately when cursor returns
    if ((e?.type === 'mousemove' || e?.type === 'pointermove') && typeof e?.buttons === 'number' && e.buttons === 0) {
      this._handlePointerEnd();
      return;
    }

    const xy = extractPointerXY(e);
    if (!xy) return;

    const [x, y] = xy;
    drag.lastX = x;
    drag.lastY = y;
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    if (!drag.moved) {
      drag.moved = true;
      clearTimeout(this._longPressTimer);
    }

    const nextPos = clampChipPos(
      drag.originLeft + dx,
      drag.originTop + dy,
      drag.chipW,
      drag.chipH,
      drag.viewW,
      drag.viewH
    );
    this._queueChipStyle(nextPos, true);
  }

  async _handlePointerEnd() {
    clearTimeout(this._longPressTimer);
    const drag = this._drag;
    if (!drag || !drag.active) return;
    drag.active = false;
    this._drag = null;

    if (drag.moved && drag.hasCoords) {
      const finalPos = clampChipPos(
        drag.originLeft + (drag.lastX - drag.startX),
        drag.originTop + (drag.lastY - drag.startY),
        drag.chipW,
        drag.chipH,
        drag.viewW,
        drag.viewH
      );

      this._dragHandled = true;
      this._suppressClickUntil = Date.now() + 450;
      this.chipPos = finalPos;
      this._cachedChipRect = {
        left: finalPos.left,
        top: finalPos.top,
        width: drag.chipW,
        height: drag.chipH,
      };
      this._pendingStyleUpdate = null;
      await this._applyChipStyle(finalPos, false);
      this.onChipMove(finalPos);
      return;
    }

    const held = Date.now() - drag.startedAt;
    this._dragHandled = true;
    this._suppressClickUntil = Date.now() + 450;
    if (held >= LONG_PRESS_MS) {
      await this._cycleChipSpot();
      return;
    }
    this.onChipClick(this.lastContext);
  }

  async setChipPosition(pos) {
    this._lastDragStart = 0;
    this._lastDownType = '';
    const norm = normalizeChipPos(pos);
    if (norm?.anchor) {
      this.chipPos = norm;
      this._cachedChipRect = null;
    } else if (norm && Number.isFinite(norm.left) && Number.isFinite(norm.top)) {
      const view = await this._getViewportSize();
      const chipW = this._cachedChipRect?.width || 140;
      const chipH = this._cachedChipRect?.height || 36;
      this.chipPos = clampChipPos(norm.left, norm.top, chipW, chipH, view.width, view.height);
    } else {
      this.chipPos = null;
      this._cachedChipRect = null;
    }
    this._pendingStyleUpdate = null;
    await this._applyChipStyle(this.chipPos, false);
    await this._refreshChipMetrics();
  }

  async mountFloatingChip() {
    if (!this.rootDoc || this.chipEl) return;
    try {
      const body = await this.rootDoc.querySelector('body');
      if (!body) return;

      // Remove any orphaned chip left behind from a prior plugin reload
      try {
        const stale = await this.rootDoc.querySelector(`[${CHIP_ATTR}="1"]`);
        if (stale) await stale.remove();
      } catch (err) { noteDetectError(err); }

      // Use <div> instead of <button> so grabbing/dragging never steals :focus from the active editor
      const chip = await this.rootDoc.createElement('div');
      await chip.setAttribute(CHIP_ATTR, '1');
      if (this.chipPos && Number.isFinite(this.chipPos.left) && Number.isFinite(this.chipPos.top)) {
        const view = await this._getViewportSize();
        this.chipPos = clampChipPos(this.chipPos.left, this.chipPos.top, 140, 36, view.width, view.height);
      }
      await chip.setStyleAttribute(buildChipStyle({
        pos: this.chipPos,
        dragging: false,
      }));
      await chip.setTextContent('⋮⋮ ✨ RisuHelper');

      for (const downEvt of ['pointerdown', 'touchstart', 'mousedown']) {
        try {
          const downId = await chip.addEventListener(downEvt, (e) => {
            this._handleChipPointerDown(e);
          });
          if (downId) this.chipListenerIds.push({ type: downEvt, id: downId });
        } catch (err) { noteDetectError(err); }
      }

      try {
        const clickId = await chip.addEventListener('click', () => {
          if (this._dragHandled || this._drag?.active || Date.now() < this._suppressClickUntil) {
            this._dragHandled = false;
            return;
          }
          this.onChipClick(this.lastContext);
        });
        if (clickId) this.chipListenerIds.push({ type: 'click', id: clickId });
      } catch (err) { noteDetectError(err); }

      await body.appendChild(chip);
      this.chipEl = chip;
      await this._refreshChipMetrics();
    } catch (err) { noteDetectError(err); }
  }

  async setChipVisible(visible) {
    this.showFloatingChip = Boolean(visible);
    if (!this.rootDoc) return;
    if (this.showFloatingChip && !this.chipEl && !this._isDocked) {
      await this.mountFloatingChip();
      if (this.lastContext) await this.updateChipLabel(this.lastContext);
    } else if (!this.showFloatingChip && this.chipEl) {
      await this.unmountFloatingChip();
    }
  }

  async updateChipLabel(ctx) {
    if (!this.chipEl || !ctx) return;
    try {
      const text = ctx.labelText ? `⋮⋮ ✨ ${ctx.labelText}` : '⋮⋮ ✨ RisuHelper';
      await this.chipEl.setTextContent(text.slice(0, 36));
      await this._refreshChipMetrics();
    } catch (err) { noteDetectError(err); }
  }

  async unmountFloatingChip() {
    clearTimeout(this._longPressTimer);
    this._drag = null;
    this._dragHandled = false;
    this._pendingStyleUpdate = null;
    this._cachedChipRect = null;
    if (!this.chipEl) return;
    try {
      for (const entry of this.chipListenerIds) {
        try {
          await this.chipEl.removeEventListener(entry.type, entry.id);
        } catch (err) { noteDetectError(err); }
      }
      await this.chipEl.remove();
    } catch (err) { noteDetectError(err); }
    this.chipEl = null;
    this.chipListenerIds = [];
  }

  async syncModuleEditorDom(opts) {
    if (!this.rootDoc) {
      return { ok: false, reason: 'mainDom 권한이 없어 화면 입력칸에 접근할 수 없습니다.' };
    }
    return await syncModuleEditorDom(this.rootDoc, opts);
  }

  async stop() {
    this.enabled = false;
    clearTimeout(this._longPressTimer);
    this._drag = null;
    this._dragHandled = false;
    this._pendingStyleUpdate = null;
    this._cachedChipRect = null;
    await this.releaseDock({ restoreChip: false });
    await this.unmountFloatingChip();
    if (this.rootDoc) {
      for (const entry of this.listenerIds) {
        try {
          await this.rootDoc.removeEventListener(entry.type, entry.id);
        } catch (err) { noteDetectError(err); }
      }
    }
    this.listenerIds = [];
    this._dockFrame = null;
    this.rootDoc = null;
  }
}

const MODULE_EDIT_ONLY_HEADINGS = ['모듈 수정', 'edit module', '모듈 생성', 'create module'];

/**
 * Safely writes updated DB text into an open ModuleMenu `[contenteditable="true"]` editor
 * (Lorebook content, Lua trigger code, or Regex OUT) and focuses it.
 *
 * Note: Plugin API v3 SafeElement does not expose `dispatchEvent()` or `<input>.value`,
 * so Svelte's `bind:textContent` (`tempModule`) only syncs after the user triggers an `input`
 * event (e.g. Space+Backspace) or re-opens the module without clicking the bottom save button.
 */
async function syncModuleEditorDom(rootDoc, { targetKind, fieldKey, loreIndex, regexIndex, text } = {}) {
  if (!rootDoc || typeof rootDoc.querySelectorAll !== 'function') {
    return { ok: false, reason: 'mainDom 권한이 없어 화면 입력칸에 접근할 수 없습니다.' };
  }

  const resolvedField = fieldKey || (
    targetKind === 'module_lorebook' ? 'content' :
    targetKind === 'module_lua' ? 'code' :
    targetKind === 'module_regex' ? 'out' : null
  );

  const isSupported =
    (targetKind === 'module_lorebook' && resolvedField === 'content') ||
    (targetKind === 'module_lua' && resolvedField === 'code') ||
    (targetKind === 'module_regex' && resolvedField === 'out');

  if (!isSupported) {
    return {
      ok: false,
      reason: '이 필드는 <input>/<textarea> 형식이라 Plugin v3 권한으로 직접 채울 수 없습니다. 하단 "모듈 수정" 버튼을 누르지 말고 다른 설정 탭을 다녀와 다시 열어 주세요.',
    };
  }

  let editH2 = null;
  try {
    const allH2 = await rootDoc.querySelectorAll('h2');
    const count = allH2 ? Math.min(await allH2.length(), 6) : 0;
    for (let i = 0; i < count; i++) {
      const node = await allH2.at(i);
      const txt = node ? String((await node.textContent()) || '').trim() : '';
      if (matchAny(txt, MODULE_EDIT_ONLY_HEADINGS)) {
        editH2 = node;
        break;
      }
    }
  } catch (err) { noteDetectError(err); }

  if (!editH2) {
    return { ok: false, reason: '현재 화면에 모듈 수정 창이 열려 있지 않습니다.' };
  }

  const scopeRoot = await resolveModuleScopeRoot(editH2, rootDoc);
  const activeTabs = await collectActiveTabs(scopeRoot);
  const tab = detectModuleTabKind(activeTabs);

  if (targetKind === 'module_lorebook' && tab && tab !== 'lorebook') {
    return { ok: false, reason: '현재 모듈의 "로어북" 탭이 열려 있지 않습니다.' };
  }
  if (targetKind === 'module_regex' && tab && tab !== 'regex') {
    return { ok: false, reason: '현재 모듈의 "정규식 스크립트" 탭이 열려 있지 않습니다.' };
  }
  if (targetKind === 'module_lua' && tab && tab !== 'trigger') {
    return { ok: false, reason: '현재 모듈의 "트리거 스크립트" 탭이 열려 있지 않습니다.' };
  }

  let editorEl = null;

  if (targetKind === 'module_lua') {
    try {
      editorEl = await scopeRoot.querySelector('[contenteditable="true"], [contenteditable=""]');
    } catch (err) { noteDetectError(err); }
  } else {
    const wantIdx = targetKind === 'module_lorebook' ? loreIndex : regexIndex;
    if (!Number.isInteger(wantIdx) || wantIdx < 0) {
      return { ok: false, reason: '대상 항목 인덱스를 확인할 수 없습니다.' };
    }
    try {
      const idxNodes = await scopeRoot.querySelectorAll('[data-risu-idx]');
      const len = idxNodes ? Math.min(await idxNodes.length(), 60) : 0;
      for (let i = 0; i < len && !editorEl; i++) {
        const node = await idxNodes.at(i);
        if (!node) continue;
        const outer = await node.getOuterHTML();
        const attrs = parseOpeningTagAttrs(outer);
        const parsed = parseInt(attrs['data-risu-idx'], 10);
        if (parsed !== wantIdx) continue;

        if (typeof node.querySelectorAll === 'function') {
          const candidates = await node.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
          const cLen = candidates ? Math.min(await candidates.length(), 8) : 0;
          for (let j = 0; j < cLen; j++) {
            const ce = await candidates.at(j);
            if (!ce) continue;
            // Verify the nearest ancestor with data-risu-idx is wantIdx (prevents folder writes hitting nested child editors)
            let cur = ce;
            let nearestIdx = null;
            for (let hop = 0; hop < 6 && cur; hop++) {
              const p = await cur.getParent();
              if (!p) break;
              const pAttrs = parseOpeningTagAttrs(await p.getOuterHTML());
              if (pAttrs['data-risu-idx'] !== undefined) {
                const pIdx = parseInt(pAttrs['data-risu-idx'], 10);
                if (!Number.isNaN(pIdx)) nearestIdx = pIdx;
                break;
              }
              cur = p;
            }
            if (nearestIdx === wantIdx) {
              editorEl = ce;
              break;
            }
          }
        }
      }
    } catch (err) { noteDetectError(err); }
  }

  if (!editorEl || typeof editorEl.setTextContent !== 'function') {
    return {
      ok: false,
      reason: '현재 화면에 펼쳐진 해당 본문 입력칸(contenteditable)을 찾지 못했습니다. 항목을 펼친 뒤 다시 시도하거나 다른 설정 탭을 다녀와 주세요.',
    };
  }

  try {
    await editorEl.setTextContent(String(text ?? ''));
    if (typeof editorEl.focus === 'function') {
      try { await editorEl.focus(); } catch (err) { noteDetectError(err); }
    }
    return {
      ok: true,
      message: '📝 화면 입력칸에 DB 최신본을 채우고 커서를 옮겼습니다! Svelte tempModule에도 동기화하려면 입력칸에서 스페이스→백스페이스를 1회 누르세요. (그냥 하단 "모듈 수정"을 누르면 이전 값으로 덮어써집니다)',
    };
  } catch (err) {
    return { ok: false, reason: `화면 입력칸 채우기 실패: ${err?.message || err}` };
  }
}

export {
  parseOpeningTagAttrs,
  classifyDomSignals,
  inspectFocusedElement,
  inspectVisibleScreen,
  syncModuleEditorDom,
  normalizeChipPos,
  MIN_DOCK_VIEWPORT_PX,
  FocusTracker,
};
