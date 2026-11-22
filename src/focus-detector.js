import { SCREEN_LABELS, CHAR_FIELD_META } from './version.js';

const FOCUS_SELECTOR = 'textarea:focus, input:focus, [contenteditable="true"]:focus, [contenteditable=""]:focus';
const CHIP_ATTR = 'x-risuhelper-chip';

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
  } = signals || {};

  const headingText = headings.join(' | ');
  const activeTabText = activeTabs.join(' | ');
  const warnings = [];

  // 1. Persona settings screen
  const isPersonaScreen =
    matchAny(headingText, ['페르소나', 'persona']) ||
    placeholder.toLowerCase().includes('description of this persona') ||
    placeholder.toLowerCase().includes('persona');

  if (isPersonaScreen) {
    let fieldKey = 'personaPrompt';
    if (matchAny(nearbyLabel, ['이름', 'name']) || placeholder === 'User') {
      fieldKey = 'name';
    } else if (matchAny(nearbyLabel, ['메모', 'note'])) {
      fieldKey = 'note';
    } else if (matchAny(nearbyLabel, ['설명', 'description'])) {
      fieldKey = 'personaPrompt';
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
  const isModuleScreen = isModuleEdit || matchAny(headingText, ['모듈', 'modules']);

  if (isModuleEdit) {
    warnings.push('모듈 편집 화면(tempModule)이 열려 있습니다. 플러그인에서 모듈을 저장한 뒤 하단 "모듈 수정" 버튼을 누르면 플러그인 변경이 덮어써질 수 있으니, 편집창을 닫고 다시 확인하세요.');
  }

  // 3. Lorebook item (identified by data-risu-idx inside LoreBookData)
  if (loreIdx !== null && Number.isInteger(loreIdx) && loreIdx >= 0) {
    let loreScope = 'character';
    let targetKind = 'char_lorebook';
    if (isModuleScreen) {
      loreScope = 'module';
      targetKind = 'module_lorebook';
    } else if (matchAny(activeTabText, ['채팅', 'chat'])) {
      loreScope = 'chat';
      targetKind = 'chat_lorebook';
    }

    let fieldKey = 'content';
    if (matchAny(nearbyLabel, ['폴더 이름', 'folder name', '이름', 'name'])) fieldKey = 'comment';
    else if (matchAny(nearbyLabel, ['두번째 키', 'secondary keys', '보조 키'])) fieldKey = 'secondkey';
    else if (matchAny(nearbyLabel, ['활성화 키', 'activation keys'])) fieldKey = 'key';
    else if (matchAny(nearbyLabel, ['배치 순서', 'insert order'])) fieldKey = 'insertorder';
    else if (matchAny(nearbyLabel, ['프롬프트', 'prompt']) || tag === 'textarea' || isContentEditable) fieldKey = 'content';

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
      liveTextPreview,
      warnings,
    };
  }

  // 4. Lua trigger script editor
  if (
    luaButtonActive ||
    hasTriggerContainer ||
    matchAny(nearbyLabel, ['트리거 스크립트', 'trigger script'])
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
      liveTextPreview,
      warnings,
    };
  }

  // 5. Regex script editor
  if (hasRegexContainer || matchAny(nearbyLabel, ['정규식 스크립트', 'regex script'])) {
    const targetKind = isModuleScreen ? 'module_regex' : 'char_regex';
    let fieldKey = 'in';
    if (matchAny(nearbyLabel, ['out', '출력', '치환'])) fieldKey = 'out';
    else if (matchAny(nearbyLabel, ['이름', 'name', 'comment'])) fieldKey = 'comment';
    return {
      detectedAt: Date.now(),
      screen: isModuleScreen ? 'module' : 'scripts',
      targetKind,
      fieldKey,
      loreIndex: null,
      loreScope: null,
      labelText: `${isModuleScreen ? '모듈' : '캐릭터'} 정규식 스크립트`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 6. Module screen non-lorebook fields
  if (isModuleScreen) {
    let fieldKey = 'description';
    if (matchAny(nearbyLabel, ['백그라운드 임베딩', 'background embedding'])) fieldKey = 'backgroundEmbedding';
    else if (matchAny(nearbyLabel, ['토글', 'toggle'])) fieldKey = 'customModuleToggle';
    else if (matchAny(nearbyLabel, ['이름', 'name'])) fieldKey = 'name';
    return {
      detectedAt: Date.now(),
      screen: 'module',
      targetKind: 'module_lorebook',
      fieldKey,
      loreIndex: null,
      loreScope: 'module',
      labelText: `모듈 설정 · ${nearbyLabel || fieldKey}`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 7. Settings / Config screens
  const isSettingsScreen =
    matchAny(headingText, [
      '채팅 봇', 'chat bot', '기타 봇', 'other bots', '소리 및 디스플레이', 'display',
      '고급 설정', 'advanced settings', '프롬프트 템플릿', 'prompt template', '접근성', 'accessibility',
    ]) ||
    matchAny(nearbyLabel, ['커스텀 css', 'custom css', 'gui html']);

  if (isSettingsScreen) {
    let fieldKey = null;
    if (matchAny(nearbyLabel, ['커스텀 css', 'custom css'])) fieldKey = 'customCSS';
    else if (matchAny(nearbyLabel, ['gui html'])) fieldKey = 'guiHTML';
    return {
      detectedAt: Date.now(),
      screen: 'settings',
      targetKind: 'config',
      fieldKey,
      loreIndex: null,
      loreScope: null,
      labelText: fieldKey ? `설정 · ${fieldKey}` : `설정 / 컨피그 (${headings[0] || '일반'})`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 8. Lorebook heading open without specific item focused
  if (matchAny(headingText, ['로어북', 'lorebook'])) {
    const isChat = matchAny(activeTabText, ['채팅', 'chat']);
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

  // 9. Character config fields (CharConfig.svelte)
  const charFieldChecks = [
    ['name', ['character name', 'group name', '캐릭터 이름', '그룹 이름']],
    ['desc', ['설명', 'description', '캐릭터 설명']],
    ['firstMessage', ['첫 메시지', 'first message']],
    ['creatorNotes', ['제작자 코멘트', "creator's comment", 'creator notes']],
    ['systemPrompt', ['시스템 프롬프트', 'system prompt']],
    ['replaceGlobalNote', ['글로벌 노트 덮어쓰기', 'global note replacement']],
    ['postHistoryInstructions', ['히스토리 이후', 'post history', 'post-history']],
    ['exampleMessage', ['예시 대화', 'example message']],
    ['personality', ['성격', 'personality']],
    ['scenario', ['시나리오', 'scenario']],
    ['backgroundHTML', ['백그라운드 임베딩', 'background embedding', 'background html']],
  ];

  for (const [key, terms] of charFieldChecks) {
    if (matchAny(nearbyLabel, terms) || matchAny(placeholder, terms)) {
      const meta = CHAR_FIELD_META[key];
      return {
        detectedAt: Date.now(),
        screen: key === 'backgroundHTML' ? 'scripts' : 'character',
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

  // 10. Chat screen fallback
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
async function inspectFocusedElement(rootDoc) {
  if (!rootDoc) return null;
  let el;
  try {
    el = await rootDoc.querySelector(FOCUS_SELECTOR);
  } catch {
    return null;
  }
  if (!el) return null;

  try {
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
      } catch {}
    }

    const headings = [];
    const activeTabs = [];
    let nearbyLabel = '';
    let loreIdx = null;
    let luaButtonActive = false;
    let hasRegexContainer = false;
    let hasTriggerContainer = false;
    let isChatInput = false;

    // Walk up ancestors (bounded to 8 hops to stay fast over iframe RPC)
    let cur = el;
    let curOuter = outerHtml;
    for (let depth = 0; depth < 8 && cur; depth++) {
      const parent = await cur.getParent();
      if (!parent) break;

      const pOuter = await parent.getOuterHTML();
      const pAttrs = parseOpeningTagAttrs(pOuter);

      if (loreIdx === null && pAttrs['data-risu-idx'] !== undefined) {
        const parsed = parseInt(pAttrs['data-risu-idx'], 10);
        if (!Number.isNaN(parsed)) loreIdx = parsed;
      }

      // Inspect direct children of close ancestors for labels, headings, and Lua/tab markers
      if (depth <= 4) {
        const children = await parent.getChildren();
        const len = children ? await children.length() : 0;
        const limit = Math.min(len, 24);
        let prevSpanText = '';
        for (let i = 0; i < limit; i++) {
          const child = await children.at(i);
          if (!child) continue;
          const cName = String(await child.nodeName()).toLowerCase();
          if (cName === 'h2' || cName === 'h3') {
            const ht = String((await child.textContent()) || '').trim();
            if (ht && !headings.includes(ht)) headings.push(ht);
          } else if (cName === 'span' || cName === 'label') {
            const st = String((await child.textContent()) || '').trim();
            if (st && st.length <= 60) prevSpanText = st;
          } else if (cName === 'button') {
            const cls = String((await child.getClassName()) || '');
            const bt = String((await child.textContent()) || '').trim();
            if (bt === 'Lua' && cls.includes('ring-1')) {
              luaButtonActive = true;
              hasTriggerContainer = true;
            }
            if ((cls.includes('bg-selected') || cls.includes('bg-darkbutton')) && bt && bt.length <= 32) {
              if (!activeTabs.includes(bt)) activeTabs.push(bt);
            }
          }
          // Check if we reached `cur` via outerHTML match to keep the closest preceding label
          if (!nearbyLabel && prevSpanText && depth <= 2) {
            const cOuter = await child.getOuterHTML();
            if (cOuter === outerHtml || (depth > 0 && cOuter === curOuter)) {
              nearbyLabel = prevSpanText;
            }
          }
        }
        if (!nearbyLabel && prevSpanText && depth <= 2) {
          nearbyLabel = prevSpanText;
        }
      }

      if (depth === 4 || depth === 6) {
        try {
          const h2 = await parent.querySelector('h2');
          if (h2) {
            const ht = String((await h2.textContent()) || '').trim();
            if (ht && !headings.includes(ht)) headings.push(ht);
          }
        } catch {}
      }

      const pClass = String(pAttrs.class || '');
      if (pClass.includes('text-input-area') || pClass.includes('chat-input')) {
        isChatInput = true;
      }
      if (pOuter.includes('triggerScript') || pOuter.includes('Trigger')) {
        hasTriggerContainer = true;
      }
      if (pOuter.includes('regexScript') || pOuter.includes('editdisplay')) {
        hasRegexContainer = true;
      }

      cur = parent;
      curOuter = pOuter;
    }

    // Also look at top-level headings in rootDoc if none found locally
    if (headings.length === 0) {
      try {
        const allH2 = await rootDoc.querySelectorAll('h2');
        const count = allH2 ? Math.min(await allH2.length(), 4) : 0;
        for (let i = 0; i < count; i++) {
          const node = await allH2.at(i);
          const txt = node ? String((await node.textContent()) || '').trim() : '';
          if (txt && !headings.includes(txt)) headings.push(txt);
        }
      } catch {}
    }

    return classifyDomSignals({
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
    });
  } catch {
    return null;
  }
}

/**
 * Manages allowed Plugin v3 rootDoc listeners (pointerup, click, keyup) to cache the latest
 * focused context BEFORE a user clicks the plugin button (which naturally blurs the input).
 */
class FocusTracker {
  constructor(api, options = {}) {
    this.api = api;
    this.onChange = options.onChange || (() => {});
    this.onChipClick = options.onChipClick || (() => {});
    this.showFloatingChip = options.showFloatingChip ?? true;
    this.rootDoc = null;
    this.listenerIds = [];
    this.chipEl = null;
    this.chipClickId = null;
    this.lastContext = null;
    this.enabled = false;
    this._scanPending = false;
  }

  async start() {
    if (this.enabled) return true;
    if (typeof this.api?.getRootDocument !== 'function') return false;
    try {
      const rootDoc = await this.api.getRootDocument();
      if (!rootDoc) return false;
      this.rootDoc = rootDoc;
      this.enabled = true;

      for (const evt of ['pointerup', 'click', 'keyup']) {
        const id = await rootDoc.addEventListener(evt, () => {
          this.scheduleScan();
        });
        if (id) this.listenerIds.push({ type: evt, id });
      }
      if (this.showFloatingChip) {
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
      await this.scanNow();
    }, 60);
  }

  async scanNow() {
    if (!this.rootDoc) return this.lastContext;
    const ctx = await inspectFocusedElement(this.rootDoc);
    if (ctx) {
      this.lastContext = ctx;
      this.onChange(ctx);
      await this.updateChipLabel(ctx);
    }
    return this.lastContext;
  }

  async mountFloatingChip() {
    if (!this.rootDoc || this.chipEl) return;
    try {
      const body = await this.rootDoc.querySelector('body');
      if (!body) return;
      const chip = await this.rootDoc.createElement('button');
      await chip.setAttribute(CHIP_ATTR, '1');
      await chip.setStyleAttribute(
        'position:fixed;right:14px;bottom:74px;z-index:940;padding:7px 12px;border-radius:999px;' +
        'background:rgba(24,24,27,0.92);color:#f4f4f5;border:1px solid rgba(161,161,170,0.45);' +
        'font-size:12px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,0.32);cursor:pointer;' +
        'max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(6px);'
      );
      await chip.setTextContent('✨ RisuHelper');
      const clickId = await chip.addEventListener('click', () => {
        this.onChipClick(this.lastContext);
      });
      await body.appendChild(chip);
      this.chipEl = chip;
      this.chipClickId = clickId;
    } catch {}
  }

  async setChipVisible(visible) {
    this.showFloatingChip = Boolean(visible);
    if (!this.rootDoc) return;
    if (this.showFloatingChip && !this.chipEl) {
      await this.mountFloatingChip();
      if (this.lastContext) await this.updateChipLabel(this.lastContext);
    } else if (!this.showFloatingChip && this.chipEl) {
      await this.unmountFloatingChip();
    }
  }

  async updateChipLabel(ctx) {
    if (!this.chipEl || !ctx) return;
    try {
      const text = ctx.labelText ? `✨ ${ctx.labelText}` : '✨ RisuHelper';
      await this.chipEl.setTextContent(text.slice(0, 34));
    } catch {}
  }

  async unmountFloatingChip() {
    if (!this.chipEl) return;
    try {
      if (this.chipClickId) {
        await this.chipEl.removeEventListener('click', this.chipClickId);
      }
      await this.chipEl.remove();
    } catch {}
    this.chipEl = null;
    this.chipClickId = null;
  }

  async stop() {
    this.enabled = false;
    await this.unmountFloatingChip();
    if (this.rootDoc) {
      for (const entry of this.listenerIds) {
        try {
          await this.rootDoc.removeEventListener(entry.type, entry.id);
        } catch {}
      }
    }
    this.listenerIds = [];
    this.rootDoc = null;
  }
}

export { parseOpeningTagAttrs, classifyDomSignals, inspectFocusedElement, FocusTracker };
