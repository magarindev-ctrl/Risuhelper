import { SCREEN_LABELS, CHAR_FIELD_META } from './version.js';

const FOCUS_SELECTOR = 'textarea:focus, input:focus, [contenteditable="true"]:focus, [contenteditable=""]:focus';
const CHAT_INPUT_SELECTOR = 'textarea.text-input-area, textarea#messageInputTranslate, .text-input-area, .chat-input textarea';
const CHIP_ATTR = 'x-risuhelper-chip';
const DRAG_THRESHOLD_PX = 6;

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
  } catch {}
  return false;
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

  // 3. Lua trigger script editor (strictly verified via adjacent Lua mode bar or explicit trigger script label)
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

  // 4. Regex script editor (checked BEFORE lorebook because RegexData.svelte also carries data-risu-idx)
  if (hasRegexContainer || matchAny(nearbyLabel, ['정규식 스크립트', 'regex script'])) {
    const targetKind = isModuleScreen ? 'module_regex' : 'char_regex';
    const regexIdx = loreIdx !== null && Number.isInteger(loreIdx) && loreIdx >= 0 ? loreIdx : null;
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
      regexIndex: regexIdx,
      labelText: `${isModuleScreen ? '모듈' : '캐릭터'} 정규식 스크립트${regexIdx !== null ? ` #${regexIdx + 1}` : ''}`,
      placeholder,
      liveTextPreview,
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

  // 7. Explicit config CSS/HTML fields
  if (matchAny(nearbyLabel, ['커스텀 css', 'custom css', 'gui html'])) {
    const fieldKey = matchAny(nearbyLabel, ['gui html']) ? 'guiHTML' : 'customCSS';
    return {
      detectedAt: Date.now(),
      screen: 'settings',
      targetKind: 'config',
      fieldKey,
      loreIndex: null,
      loreScope: null,
      labelText: `설정 · ${fieldKey}`,
      placeholder,
      liveTextPreview,
      warnings,
    };
  }

  // 8. Chat Author's Note (CharConfig.svelte -> char.chats[chatPage].note)
  if (matchAny(nearbyLabel, ['작가의 노트', "author's note", 'author note'])) {
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

  // 9. Character config fields (CharConfig.svelte — checked BEFORE generic Settings headings
  //    because CharConfig's Advanced tab also renders <h2>고급 설정</h2>)
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
    ['virtualscript', ['캐릭터js', '캐릭터 js', 'charjs', 'character js']],
  ];

  for (const [key, terms] of charFieldChecks) {
    if (matchAny(nearbyLabel, terms) || matchAny(placeholder, terms)) {
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

    let elRect = null;
    try {
      if (typeof el.getBoundingClientRect === 'function') {
        const rect = await el.getBoundingClientRect();
        if (hasUsableRect(rect)) elRect = rect;
      }
    } catch {}

    const headings = [];
    const activeTabs = [];
    let nearbyLabel = '';
    let loreIdx = null;
    let luaButtonActive = false;
    let hasRegexContainer = false;
    let hasTriggerContainer = false;
    // Check the focused element itself first (DefaultChatScreen puts `text-input-area` directly on <textarea>)
    let isChatInput = isChatElementAttrs(attrs);

    // Walk up ancestors (bounded to 8 hops to stay fast over iframe RPC)
    let cur = el;
    let curOuter = outerHtml;
    let curTag = tag;
    for (let depth = 0; depth < 8 && cur; depth++) {
      const parent = await cur.getParent();
      if (!parent) break;

      const pOuter = await parent.getOuterHTML();
      const pAttrs = parseOpeningTagAttrs(pOuter);

      if (loreIdx === null && pAttrs['data-risu-idx'] !== undefined) {
        const parsed = parseInt(pAttrs['data-risu-idx'], 10);
        if (!Number.isNaN(parsed)) loreIdx = parsed;
      }

      // Inspect direct children of close ancestors for labels, headings, and Lua/Regex/tab markers
      if (depth <= 4) {
        const children = await parent.getChildren();
        const len = children ? await children.length() : 0;
        const limit = Math.min(len, 64);
        const checkLocalContext = depth <= 3;

        // When depth > 0, check if SafeElement.querySelector(':focus') resolves the exact descendant branch.
        // This disambiguates sibling TextAreaInput wrappers that share identical outerHTML (e.g. PocketRisu).
        let focusQueryWorks = false;
        if (checkLocalContext && depth > 0 && typeof parent.querySelector === 'function') {
          try {
            focusQueryWorks = Boolean(await parent.querySelector(FOCUS_SELECTOR));
          } catch {}
        }

        let prevPrimarySpan = '';
        let prevFallbackSpan = '';
        let prevSiblingWasLuaBar = false;
        let foundCur = false;
        const containerSpanLabels = [];

        for (let i = 0; i < limit; i++) {
          const child = await children.at(i);
          if (!child) continue;
          const cName = String(await child.nodeName()).toLowerCase();

          // 1. Identify the exact sibling matching `cur`
          let isCur = false;
          if (checkLocalContext && !foundCur && (!curTag || cName === curTag)) {
            if (depth > 0 && focusQueryWorks) {
              try {
                isCur = Boolean(await child.querySelector(FOCUS_SELECTOR));
              } catch {}
            } else if (depth === 0 && elRect && typeof child.getBoundingClientRect === 'function') {
              try {
                const cRect = await child.getBoundingClientRect();
                isCur = rectsMatch(elRect, cRect);
              } catch {}
            }
            if (!isCur && !focusQueryWorks && !(depth === 0 && elRect)) {
              try {
                const cOuter = await child.getOuterHTML();
                isCur = cOuter === outerHtml || (depth > 0 && cOuter === curOuter);
              } catch {}
            }
          }

          if (isCur) {
            foundCur = true;
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

          // 2. Gather headings, labels, RegexData markers, active tabs, and immediate Lua mode bars
          if (cName === 'h2' || cName === 'h3') {
            const ht = String((await child.textContent()) || '').trim();
            if (ht && !headings.includes(ht)) headings.push(ht);
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
                if (
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

      if (depth === 4 || depth === 6) {
        try {
          const h2 = await parent.querySelector('h2');
          if (h2) {
            const ht = String((await h2.textContent()) || '').trim();
            if (ht && !headings.includes(ht)) headings.push(ht);
          }
        } catch {}
      }

      if (!isChatInput && isChatElementAttrs(pAttrs)) {
        isChatInput = true;
      }

      cur = parent;
      curOuter = pOuter;
      curTag = pAttrs._tag || '';
    }

    // Also look at top-level headings in rootDoc if none found locally
    if (!isChatInput && headings.length === 0) {
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
 * Fallback screen detector when no editable input currently holds `:focus`
 * (for example, opening RisuHelper directly from the chat screen or after mobile blur).
 */
async function inspectVisibleScreen(rootDoc) {
  if (!rootDoc) return null;
  try {
    const headings = [];
    try {
      const allH2 = await rootDoc.querySelectorAll('h2');
      const count = allH2 ? Math.min(await allH2.length(), 6) : 0;
      for (let i = 0; i < count; i++) {
        const node = await allH2.at(i);
        const txt = node ? String((await node.textContent()) || '').trim() : '';
        if (txt && !headings.includes(txt)) headings.push(txt);
      }
    } catch {}

    // Check explicit chat input presence first; if present and no settings/persona/module modal heading is active, it's the chat screen.
    let chatInputEl = null;
    try {
      chatInputEl = await rootDoc.querySelector(CHAT_INPUT_SELECTOR);
    } catch {}

    const headingText = headings.join(' | ');
    const modalHeadings = [
      '페르소나', 'persona',
      '모듈 수정', 'edit module', '모듈 생성', 'create module', '모듈', 'modules',
      '채팅 봇', 'chat bot', '기타 봇', 'other bots', '소리 및 디스플레이', 'display',
      '고급 설정', 'advanced settings', '프롬프트 템플릿', 'prompt template', '접근성', 'accessibility',
      '로어북', 'lorebook',
    ];
    if (matchAny(headingText, modalHeadings)) {
      const classified = classifyDomSignals({ headings });
      if (classified.screen !== 'unknown') return classified;
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
    } catch {}
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
    } catch {}
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
    } catch {}
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
      } catch {}
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
    } catch {}
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
        } catch {}
      }

      for (const endEvt of ['pointerup', 'touchend', 'mouseup', 'pointercancel', 'touchcancel']) {
        try {
          const id = await rootDoc.addEventListener(endEvt, () => {
            this._handlePointerEnd();
          });
          if (id) this.listenerIds.push({ type: endEvt, id });
        } catch {}
      }

      for (const evt of ['pointerup', 'click', 'keyup']) {
        try {
          const id = await rootDoc.addEventListener(evt, () => {
            if (this._drag?.moved || this._dragHandled || Date.now() < this._suppressClickUntil) return;
            this.scheduleScan();
          });
          if (id) this.listenerIds.push({ type: evt, id });
        } catch {}
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
    let ctx = await inspectFocusedElement(this.rootDoc);
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
    } catch {}
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
    } catch {}

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
      } catch {}
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
            try { await cand.setAttribute(FRAME_ATTR, '1'); } catch {}
            this._dockFrame = cand;
            return cand;
          }
          await cand.setStyle('width', origStyleW || '100%');
        } catch {
          try { await cand.setStyle('width', origStyleW || '100%'); } catch {}
        }
      }
      return null;
    }

    // 3. Fallback when localWin.innerWidth isn't simulated (e.g. unit test sandbox):
    //    only accept when strictly 1 iframe transitioned from hidden -> visible on showContainer().
    if (newlyVisible.length === 1) {
      const only = newlyVisible[0];
      try { await only.setAttribute(FRAME_ATTR, '1'); } catch {}
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
    } catch {}
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
        try { this.rootDoc = await this.api.getRootDocument(); } catch {}
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
      } catch {}
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
      } catch {}
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
    } catch {}
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
    } catch {}
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
      } catch {}

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
        } catch {}
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
      } catch {}

      await body.appendChild(chip);
      this.chipEl = chip;
      await this._refreshChipMetrics();
    } catch {}
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
    } catch {}
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
        } catch {}
      }
      await this.chipEl.remove();
    } catch {}
    this.chipEl = null;
    this.chipListenerIds = [];
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
        } catch {}
      }
    }
    this.listenerIds = [];
    this._dockFrame = null;
    this.rootDoc = null;
  }
}

export {
  parseOpeningTagAttrs,
  classifyDomSignals,
  inspectFocusedElement,
  inspectVisibleScreen,
  normalizeChipPos,
  MIN_DOCK_VIEWPORT_PX,
  FocusTracker,
};
