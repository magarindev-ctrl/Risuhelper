import {
  ALLOWED_CONFIG_KEYS,
  CONFIG_KEY_TYPES,
  CHAR_FIELD_META,
  MODULE_FIELD_META,
  CONFIG_FIELD_META,
  MAX_LLM_CONTENT_CHARS,
  ALLOWED_CHAR_FIELDS,
  ALLOWED_MODULE_FIELDS,
  ALLOWED_LORE_TEXT_FIELDS,
  ALLOWED_PERSONA_TEXT_FIELDS,
} from './version.js';
import { applyTextEdits } from './text-edits.js';

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DB_PERMISSION_ERROR =
  'DB 읽기 권한(db)이 필요합니다. 이전에 권한을 거부(취소)했다면 RisuAI/PocketRisu 설정 → 플러그인에서 권한 초기화 후 다시 허용해 주세요.';

const LORE_META_SPECS = [
  ['comment', '이름'],
  ['key', '활성화 키'],
  ['secondkey', '보조 키'],
  ['insertorder', '배치 순서'],
  ['alwaysActive', '항상 활성'],
  ['selective', '보조 키 사용'],
  ['useRegex', '정규식 키'],
  ['activationPercent', '활성 확률'],
  ['mode', '모드'],
  ['folder', '폴더'],
];

const PERSONA_META_SPECS = [
  ['name', '이름'],
  ['note', '메모'],
  ['largePortrait', '큰 초상화'],
];

const REGEX_META_SPECS = [
  ['comment', '이름'],
  ['type', '적용 유형'],
  ['in', 'IN 패턴'],
  ['flag', '플래그'],
  ['ableFlag', '플래그 활성'],
];

function clone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function makeUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'rh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function formatMetaValue(val) {
  if (val === undefined || val === null || val === '') return '(비어 있음)';
  if (typeof val === 'boolean') return val ? '예' : '아니오';
  return String(val);
}

function computeMetaChanges(beforeObj, afterObj, specs, skipKey = null) {
  const changes = [];
  for (const [key, label] of specs) {
    if (key === skipKey) continue;
    const prev = beforeObj ? beforeObj[key] : undefined;
    const next = afterObj ? afterObj[key] : undefined;
    if (prev !== next) {
      changes.push({
        key,
        label,
        before: formatMetaValue(prev),
        after: formatMetaValue(next),
      });
    }
  }
  return changes;
}

function validateAllowedFieldKey(kind, fieldKey) {
  if (fieldKey === undefined || fieldKey === null || fieldKey === '') return null;
  if (typeof fieldKey !== 'string' || BAD_KEYS.has(fieldKey)) {
    return `허용되지 않는 필드 키입니다: ${String(fieldKey)}`;
  }
  if (kind === 'char_field' && !ALLOWED_CHAR_FIELDS.includes(fieldKey)) {
    return `허용되지 않는 캐릭터 필드입니다: ${fieldKey}`;
  }
  if (kind === 'char_alt_greeting' && fieldKey !== 'alternateGreetings') {
    return `허용되지 않는 추가 첫 메시지 필드입니다: ${fieldKey}`;
  }
  if (
    (kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook') &&
    !ALLOWED_LORE_TEXT_FIELDS.includes(fieldKey)
  ) {
    return `허용되지 않는 로어북 필드입니다: ${fieldKey}`;
  }
  if (kind === 'module_field' && !ALLOWED_MODULE_FIELDS.includes(fieldKey)) {
    return `허용되지 않는 모듈 필드입니다: ${fieldKey}`;
  }
  if (kind === 'persona' && !ALLOWED_PERSONA_TEXT_FIELDS.includes(fieldKey)) {
    return `허용되지 않는 페르소나 필드입니다: ${fieldKey}`;
  }
  if (kind === 'chat_note' && fieldKey !== 'note') {
    return `허용되지 않는 작가의 노트 필드입니다: ${fieldKey}`;
  }
  if (kind === 'chat_message' && fieldKey !== 'data') {
    return `허용되지 않는 채팅 메시지 필드입니다: ${fieldKey}`;
  }
  if (kind === 'config' && !ALLOWED_CONFIG_KEYS.includes(fieldKey)) {
    return `허용되지 않는 설정 키입니다: ${fieldKey}`;
  }
  return null;
}

function assertAllowedFieldKey(kind, fieldKey) {
  const err = validateAllowedFieldKey(kind, fieldKey);
  if (err) throw new Error(err);
}

function checkTruncationGuard(beforeText, actionLabel) {
  if (typeof beforeText === 'string' && beforeText.length > MAX_LLM_CONTENT_CHARS) {
    return (
      `현재 원문(${beforeText.length.toLocaleString()}자)이 모델 입력 한도(${MAX_LLM_CONTENT_CHARS.toLocaleString()}자)를 초과해 앞부분만 전달되었습니다. ` +
      `뒷부분 유실을 방지하기 위해 ${actionLabel}은(는) 차단됩니다. 부분 편집(patch_text / edits)을 사용해 주세요.`
    );
  }
  return null;
}

function getCharIdentity(char) {
  if (!char) return { charId: null, charName: null };
  return {
    charId: char.chaId ?? char.id ?? null,
    charName: char.name ?? null,
  };
}

function isSameCharacter(char, charIndex, binding) {
  if (!binding) return true;
  if (!char) return false;
  const cur = getCharIdentity(char);
  if (binding.charId && cur.charId) {
    return binding.charId === cur.charId;
  }
  if (
    Number.isInteger(binding.charIndex) &&
    Number.isInteger(charIndex) &&
    binding.charIndex !== charIndex
  ) {
    return false;
  }
  if (binding.charName !== null && binding.charName !== undefined && cur.charName !== binding.charName) {
    return false;
  }
  return true;
}

function removeCreatedItem(list, insertedIndex, matcher) {
  if (!Array.isArray(list)) return false;
  if (insertedIndex >= 0 && insertedIndex < list.length && matcher(list[insertedIndex])) {
    list.splice(insertedIndex, 1);
    return true;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (matcher(list[i])) {
      list.splice(i, 1);
      return true;
    }
  }
  return false;
}

/**
 * Extracts Lua code from RisuAI's triggerscript array (both character.triggerscript and module.trigger).
 */
function extractLuaFromTriggers(triggers) {
  if (!Array.isArray(triggers) || triggers.length === 0) {
    return { isLua: false, code: '', hasOtherTriggers: false, otherTriggerCount: 0 };
  }
  const firstEffect = triggers[0]?.effect?.[0];
  if (firstEffect && firstEffect.type === 'triggerlua') {
    return { isLua: true, code: String(firstEffect.code ?? ''), hasOtherTriggers: false, otherTriggerCount: 0 };
  }
  return { isLua: false, code: '', hasOtherTriggers: true, otherTriggerCount: triggers.length };
}

/**
 * Builds the canonical RisuAI Lua triggerscript array expected by TriggerList.svelte.
 */
function buildLuaTriggers(code) {
  return [
    {
      comment: '',
      type: 'start',
      conditions: [],
      effect: [
        {
          type: 'triggerlua',
          code: String(code ?? ''),
        },
      ],
    },
  ];
}

function buildLuaDestructiveWarning(otherTriggerCount) {
  const countText = otherTriggerCount > 0 ? `${otherTriggerCount}개의 ` : '';
  return (
    `⚠️ 기존 V1/V2 트리거(${countText}항목)가 설정되어 있습니다. ` +
    'Lua 트리거를 적용하면 기존 트리거와 병합되지 않고 모두 삭제된 뒤 새 Lua 스크립트로 통째로 대체됩니다. ' +
    '(적용 직후 되돌리기로 기존 트리거를 복구할 수 있습니다.)'
  );
}

function normalizeLorebookEntry(input, existing = null) {
  const base = existing ? clone(existing) : {
    key: '',
    secondkey: '',
    insertorder: 100,
    comment: 'New Lore',
    content: '',
    mode: 'normal',
    alwaysActive: false,
    selective: false,
    useRegex: false,
  };
  if (input.comment !== undefined) base.comment = String(input.comment);
  if (input.key !== undefined) base.key = String(input.key);
  if (input.secondkey !== undefined) base.secondkey = String(input.secondkey);
  if (input.content !== undefined) base.content = String(input.content);
  if (input.insertorder !== undefined && Number.isFinite(Number(input.insertorder))) {
    base.insertorder = Number(input.insertorder);
  }
  if (input.alwaysActive !== undefined) base.alwaysActive = Boolean(input.alwaysActive);
  if (input.selective !== undefined) base.selective = Boolean(input.selective);
  if (input.useRegex !== undefined) base.useRegex = Boolean(input.useRegex);
  if (input.activationPercent !== undefined && Number.isFinite(Number(input.activationPercent))) {
    base.activationPercent = Math.max(0, Math.min(100, Number(input.activationPercent)));
  }
  if (input.mode && ['normal', 'constant', 'multiple', 'child', 'folder'].includes(input.mode)) {
    base.mode = input.mode;
  }
  if (input.folder !== undefined) base.folder = String(input.folder);
  return base;
}

function normalizeRegexEntry(input, existing = null) {
  const validTypes = ['editinput', 'editoutput', 'editprocess', 'editdisplay'];
  const base = existing ? clone(existing) : {
    comment: 'New Regex',
    in: '',
    out: '',
    type: 'editdisplay',
    flag: 'g',
    ableFlag: false,
  };
  if (input.comment !== undefined) base.comment = String(input.comment);
  if (input.in !== undefined) base.in = String(input.in);
  if (input.out !== undefined) base.out = String(input.out);
  if (input.type !== undefined && validTypes.includes(input.type)) base.type = input.type;
  if (input.flag !== undefined) base.flag = String(input.flag);
  if (input.ableFlag !== undefined) base.ableFlag = Boolean(input.ableFlag);
  return base;
}

function isCatchAllProxyApi(api) {
  return Boolean(api && typeof api.__risuhelper_nonexistent_probe__ === 'function');
}

function isMissingMethodError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('not found') || msg.includes('not a function') || msg.includes('undefined');
}

const GENERIC_ITEM_TITLES = new Set(['unnamed lore', 'unnamed folder', 'unnamed script', '']);

function normalizeMatchText(str) {
  return String(str || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

function expectedLoreDisplayTitle(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.mode === 'folder') {
    return String(entry.comment || '').trim() || 'Unnamed Folder';
  }
  return String(entry.comment || '').trim() || String(entry.key || '').trim() || 'Unnamed Lore';
}

function expectedRegexDisplayTitle(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.comment || '').trim() || 'Unnamed Script';
}

function scorePreviewMatch(candidateText, normPreview) {
  if (!normPreview || normPreview.length < 4) return 0;
  const normCandidate = normalizeMatchText(candidateText);
  if (!normCandidate) return 0;
  if (normCandidate === normPreview) return 1500;
  if (normCandidate.startsWith(normPreview)) return 1000;
  if (normCandidate.length >= 4 && normPreview.startsWith(normCandidate)) return 900;
  if (normPreview.length >= 12 && normCandidate.includes(normPreview)) return 600;
  return 0;
}

/**
 * Resolves the index of the currently edited module in `db.modules`.
 * Priority:
 *  1. Explicit `target.moduleIndex` (manual user selection or pinned proposal)
 *  2. DOM fingerprint matching via `target.moduleDomHints` (lorebook/regex titles, expanded text preview, assets)
 *  3. Last matched module ID (`preferredModuleId`) when switching tabs inside the same module
 *  4. Fallback to 0 (first installed module)
 */
function resolveModuleIndex(modules, target, preferredModuleId = null) {
  if (!Array.isArray(modules) || modules.length === 0) return { index: null, matchedBy: 'none' };

  if (Number.isInteger(target?.moduleIndex) && target.moduleIndex >= 0 && target.moduleIndex < modules.length) {
    return { index: target.moduleIndex, matchedBy: 'explicit' };
  }

  const hints = target?.moduleDomHints;
  if (hints && typeof hints === 'object') {
    const tab = hints.tab || (
      target.targetKind === 'module_lorebook' ? 'lorebook' :
      target.targetKind === 'module_regex' ? 'regex' :
      target.targetKind === 'module_lua' ? 'trigger' : null
    );
    const items = Array.isArray(hints.items) ? hints.items : [];
    const totalIdxCount = Number.isInteger(hints.totalIdxCount) ? hints.totalIdxCount : 0;
    const rawPreview = String(hints.textPreview || target?.liveTextPreview || '');
    const normPreview = normalizeMatchText(rawPreview).slice(0, 240);
    const openIdx = Number.isInteger(target?.loreIndex)
      ? target.loreIndex
      : Number.isInteger(target?.regexIndex)
        ? target.regexIndex
        : (Number.isInteger(hints.openIdx) ? hints.openIdx : null);
    const assetNames = Array.isArray(hints.assetNames) ? hints.assetNames : [];

    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < modules.length; i++) {
      const m = modules[i];
      if (!m || typeof m !== 'object') continue;
      let score = 0;

      if (tab === 'lorebook' || (tab === null && target.targetKind === 'module_lorebook')) {
        const list = Array.isArray(m.lorebook) ? m.lorebook : [];
        if (totalIdxCount > 0) {
          if (list.length === 0) score -= 20;
          else if (list.length === totalIdxCount) score += 10;
        }
        const allTitleSet = new Set(list.map(e => normalizeMatchText(expectedLoreDisplayTitle(e)).toLowerCase()));
        for (const item of items) {
          const normTitle = normalizeMatchText(item.title).toLowerCase();
          const isGeneric = GENERIC_ITEM_TITLES.has(normTitle);
          const atIdx = list[item.idx];
          if (atIdx) {
            const expected = normalizeMatchText(expectedLoreDisplayTitle(atIdx)).toLowerCase();
            if (expected === normTitle) {
              score += isGeneric ? 2 : 30;
              continue;
            }
          }
          if (!isGeneric && allTitleSet.has(normTitle)) {
            score += 8;
          }
        }
        if (normPreview.length >= 4) {
          if (openIdx !== null && list[openIdx]) {
            const openHit = scorePreviewMatch(list[openIdx].content, normPreview);
            if (openHit > 0) score += openHit;
          } else {
            let maxHit = 0;
            for (const e of list) {
              const hit = scorePreviewMatch(e?.content, normPreview);
              if (hit > maxHit) maxHit = hit;
            }
            score += maxHit;
          }
        }
      } else if (tab === 'regex' || (tab === null && target.targetKind === 'module_regex')) {
        const list = Array.isArray(m.regex) ? m.regex : [];
        if (totalIdxCount > 0) {
          if (list.length === 0) score -= 20;
          else if (list.length === totalIdxCount) score += 10;
        }
        const allTitleSet = new Set(list.map(e => normalizeMatchText(expectedRegexDisplayTitle(e)).toLowerCase()));
        for (const item of items) {
          const normTitle = normalizeMatchText(item.title).toLowerCase();
          const isGeneric = GENERIC_ITEM_TITLES.has(normTitle);
          const atIdx = list[item.idx];
          if (atIdx) {
            const expected = normalizeMatchText(expectedRegexDisplayTitle(atIdx)).toLowerCase();
            if (expected === normTitle) {
              score += isGeneric ? 2 : 30;
              continue;
            }
          }
          if (!isGeneric && allTitleSet.has(normTitle)) {
            score += 8;
          }
        }
        if (normPreview.length >= 4) {
          if (target.targetKind === 'module_field' && target.fieldKey === 'backgroundEmbedding') {
            score += scorePreviewMatch(m.backgroundEmbedding, normPreview);
          } else if (openIdx !== null && list[openIdx]) {
            score += scorePreviewMatch(list[openIdx].out, normPreview);
          } else {
            const bgHit = scorePreviewMatch(m.backgroundEmbedding, normPreview);
            let maxRegexHit = 0;
            for (const e of list) {
              const hit = scorePreviewMatch(e?.out, normPreview);
              if (hit > maxRegexHit) maxRegexHit = hit;
            }
            score += Math.max(bgHit, maxRegexHit);
          }
        }
      } else if (tab === 'trigger' || target.targetKind === 'module_lua') {
        if (normPreview.length >= 4) {
          const lua = extractLuaFromTriggers(m.trigger);
          score += scorePreviewMatch(lua.code, normPreview);
        }
      } else if (tab === 'assets' && assetNames.length > 0) {
        const modAssets = Array.isArray(m.assets) ? m.assets : [];
        const assetSet = new Set(modAssets.map(a => String(a?.[0] || '').trim()));
        for (const name of assetNames) {
          if (assetSet.has(name)) score += 20;
        }
      } else if (target.targetKind === 'module_field' && normPreview.length >= 4) {
        const fk = target.fieldKey || 'description';
        score += scorePreviewMatch(m[fk], normPreview);
      }

      if (score > 0 && preferredModuleId && m.id === preferredModuleId) {
        score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1 && bestScore > 0) {
      return { index: bestIdx, matchedBy: 'dom_hints', score: bestScore };
    }
  }

  if (preferredModuleId) {
    const prefIdx = modules.findIndex(m => m && m.id === preferredModuleId);
    if (prefIdx !== -1) {
      return { index: prefIdx, matchedBy: 'preferred' };
    }
  }

  return { index: 0, matchedBy: 'fallback' };
}

/**
 * Cross-fork safe adapter for RisuAI Plugin API v3.
 * Works with kwaroran/Risuai, PocketRisu, RisuBard, HaejeokRisuai, RisuNest, and RisuAI-Hardened.
 */
class HostAdapter {
  constructor(api) {
    this.api = api;
    this.undoStack = [];
    this.maxUndo = 20;
    this._probedFlavor = null;
    this._lastMatchedModuleId = null;
  }

  _resolveWriteModuleIndex(modules, proposal, target, options = {}) {
    if (Number.isInteger(proposal?.moduleIndex) && modules[proposal.moduleIndex]) {
      return proposal.moduleIndex;
    }
    const pinnedId = options?.hostBinding?.moduleId || null;
    if (pinnedId) {
      const byId = modules.findIndex(m => m && m.id === pinnedId);
      if (byId !== -1) return byId;
    }
    const res = resolveModuleIndex(modules, target, this._lastMatchedModuleId);
    return res.index ?? 0;
  }

  /**
   * Probes the real host flavor safely (working around RisuAI Plugin v3's catch-all `window.risuai` Proxy,
   * where `typeof api.anyName === 'function'` is always true for nonexistent methods).
   */
  async probeHostFlavor(rootDoc = null) {
    if (this._probedFlavor) return this._probedFlavor;

    // 1. Check host document <title> when mainDom is available (zero side effects, works on every fork)
    if (rootDoc && typeof rootDoc.querySelector === 'function') {
      try {
        const titleEl = await rootDoc.querySelector('title');
        const title = titleEl ? String((await titleEl.textContent()) || '').trim().toLowerCase() : '';
        if (title.includes('pocketrisu')) {
          this._probedFlavor = { name: 'PocketRisu', activePersonaAutoSyncs: false, syncLiteCharError: false };
          return this._probedFlavor;
        }
        if (title.includes('risubard')) {
          this._probedFlavor = { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
          return this._probedFlavor;
        }
        if (title.includes('risunest')) {
          this._probedFlavor = { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
          return this._probedFlavor;
        }
        if (title.includes('haejeok') || title.includes('해적')) {
          this._probedFlavor = { name: 'HaejeokRisuai', activePersonaAutoSyncs: true, syncLiteCharError: false };
          return this._probedFlavor;
        }
        if (title.includes('risuai')) {
          this._probedFlavor = { name: 'RisuAI', activePersonaAutoSyncs: false, syncLiteCharError: false };
          return this._probedFlavor;
        }
      } catch {}
    }

    // 2. Non-Proxy object (e.g. unit tests or direct host objects) can safely inspect own properties
    if (!isCatchAllProxyApi(this.api)) {
      if (typeof this.api?.risunestCallHostTool === 'function') {
        this._probedFlavor = { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
        return this._probedFlavor;
      }
      if (typeof this.api?._getBardWikiDocuments === 'function') {
        this._probedFlavor = { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
        return this._probedFlavor;
      }
    }

    this._probedFlavor = { name: 'RisuAI', activePersonaAutoSyncs: false, syncLiteCharError: false };
    return this._probedFlavor;
  }

  detectHostFlavor() {
    if (this._probedFlavor) return this._probedFlavor;
    // Never trust `typeof api.foo === 'function'` when `window.risuai` is a catch-all Proxy
    if (!isCatchAllProxyApi(this.api)) {
      if (typeof this.api?.risunestCallHostTool === 'function') {
        return { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
      }
      if (typeof this.api?._getBardWikiDocuments === 'function') {
        return { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
      }
    }
    return { name: 'RisuAI', activePersonaAutoSyncs: false, syncLiteCharError: false };
  }

  async _getCharacter() {
    if (typeof this.api.getCharacter === 'function') {
      try {
        return await this.api.getCharacter();
      } catch (err) {
        if (!isMissingMethodError(err) || typeof this.api.getChar !== 'function') throw err;
      }
    }
    if (typeof this.api.getChar === 'function') return await this.api.getChar();
    return null;
  }

  async _setCharacter(char) {
    if (typeof this.api.setCharacter === 'function') {
      try {
        return await this.api.setCharacter(char);
      } catch (err) {
        if (!isMissingMethodError(err) || typeof this.api.setChar !== 'function') throw err;
      }
    }
    if (typeof this.api.setChar === 'function') return await this.api.setChar(char);
    throw new Error('캐릭터 저장 API를 찾을 수 없습니다.');
  }

  async _getActiveIndices() {
    let charIndex = null;
    let chatIndex = null;
    if (typeof this.api.getCurrentCharacterIndex === 'function') {
      try { charIndex = await this.api.getCurrentCharacterIndex(); } catch {}
    }
    if (typeof this.api.getCurrentChatIndex === 'function') {
      try { chatIndex = await this.api.getCurrentChatIndex(); } catch {}
    }
    return { charIndex, chatIndex };
  }

  async readActiveCharacter() {
    const char = await this._getCharacter();
    const { charIndex, chatIndex } = await this._getActiveIndices();
    return { char, charIndex, chatIndex };
  }

  /**
   * Reads a specific chat by index (preferring getChatFromIndex for PocketRisu _placeholder safety).
   */
  async _readChatAt(charIndex, chatIndex, fallbackChar = null) {
    if (
      Number.isInteger(charIndex) &&
      charIndex >= 0 &&
      typeof this.api.getChatFromIndex === 'function'
    ) {
      try {
        const fetched = await this.api.getChatFromIndex(charIndex, chatIndex);
        if (fetched && !fetched._placeholder) {
          return fetched;
        }
      } catch {}
    }
    const char = fallbackChar || (await this._getCharacter());
    const fallback = char?.chats?.[chatIndex] ?? null;
    if (fallback?._placeholder) {
      throw new Error('채팅 본문이 아직 서버에서 로드되지 않았습니다(_placeholder). 채팅을 연 뒤 다시 시도해 주세요.');
    }
    return fallback;
  }

  /**
   * Reads active chat via getChatFromIndex first (required by PocketRisu for unopened _placeholder chats),
   * falling back to char.chats[chatPage].
   */
  async readActiveChat() {
    const { char, charIndex, chatIndex } = await this.readActiveCharacter();
    if (!char) return { chat: null, char, charIndex, chatIndex };
    const resolvedChatIdx = Number.isInteger(chatIndex) ? chatIndex : (char.chatPage ?? 0);
    const chat = await this._readChatAt(charIndex, resolvedChatIdx, char);
    return { chat, char, charIndex, chatIndex: resolvedChatIdx };
  }

  /**
   * Saves a modified chat via setChatToIndex() when supported (required by PocketRisu / RisuNest),
   * falling back to updating char.chats[chatIndex] via _setCharacter() on older/hardened forks.
   */
  async _setChat(charIndex, chatIndex, nextChat) {
    if (
      typeof this.api.setChatToIndex === 'function' &&
      Number.isInteger(charIndex) &&
      charIndex >= 0
    ) {
      try {
        await this.api.setChatToIndex(charIndex, chatIndex, nextChat);
        return;
      } catch (err) {
        if (!isMissingMethodError(err)) throw err;
      }
    }
    const { char } = await this.readActiveCharacter();
    if (!char || !Array.isArray(char.chats) || !char.chats[chatIndex]) {
      throw new Error('채팅 저장 API(setChatToIndex)를 사용할 수 없습니다.');
    }
    if (char.chats[chatIndex]._placeholder) {
      throw new Error('채팅 본문이 아직 로드되지 않았습니다(_placeholder). setChatToIndex 지원 호스트가 필요합니다.');
    }
    const nextChar = clone(char);
    nextChar.chats[chatIndex] = clone(nextChat);
    await this._setCharacter(nextChar);
  }

  async _requireSameActiveCharacter(binding, actionVerb = '적용') {
    const { char, charIndex, chatIndex } = await this.readActiveCharacter();
    if (!char) throw new Error('선택된 캐릭터가 없습니다.');
    if (binding && !isSameCharacter(char, charIndex, binding)) {
      throw new Error(`다른 캐릭터로 전환되어 ${actionVerb}을(를) 중단했습니다. 원래 캐릭터로 돌아온 뒤 다시 시도해 주세요.`);
    }
    return { char, charIndex, chatIndex };
  }

  async _requireSameActiveChat(binding, actionVerb = '적용') {
    const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
    if (!chat) throw new Error('활성 채팅을 찾을 수 없습니다.');
    if (binding) {
      if (!isSameCharacter(char, charIndex, binding)) {
        throw new Error(`다른 캐릭터로 전환되어 ${actionVerb}을(를) 중단했습니다. 원래 캐릭터로 돌아온 뒤 다시 시도해 주세요.`);
      }
      if (Number.isInteger(binding.chatIndex) && binding.chatIndex !== chatIndex) {
        throw new Error(`다른 채팅으로 전환되어 ${actionVerb}을(를) 중단했습니다. 원래 채팅으로 돌아온 뒤 다시 시도해 주세요.`);
      }
    }
    return { chat, char, charIndex, chatIndex };
  }

  /**
   * Resolves the effective target while blocking prompt-injected target/fieldKey overrides.
   */
  _resolveSafeTarget(proposal, activeTarget) {
    const base = { ...(activeTarget || {}) };
    const pt = proposal?.target;

    if (pt !== undefined) {
      if (!pt || typeof pt !== 'object' || Array.isArray(pt)) {
        throw new Error('제안의 target 형식이 올바르지 않습니다.');
      }
      for (const k of Object.keys(pt)) {
        if (BAD_KEYS.has(k)) throw new Error(`허용되지 않는 target 키입니다: ${k}`);
      }
    }

    if (proposal?.action === 'patch_text' || proposal?.action === 'replace_text') {
      // Never allow LLM proposal.target to redirect a direct text edit to a different field or target
      if (pt) {
        const guardedKeys = [
          'targetKind', 'fieldKey', 'loreIndex', 'loreScope',
          'personaIndex', 'moduleIndex', 'regexIndex', 'greetingIndex', 'messageIndex',
        ];
        for (const k of guardedKeys) {
          if (pt[k] !== undefined && pt[k] !== null && pt[k] !== base[k]) {
            throw new Error(`보안상 제안 블록의 target.${k}(${String(pt[k])})로 현재 선택 대상을 덮어쓸 수 없습니다.`);
          }
        }
      }
      assertAllowedFieldKey(base.targetKind, base.fieldKey);
      return base;
    }

    const merged = pt ? { ...base, ...pt } : base;
    assertAllowedFieldKey(merged.targetKind, merged.fieldKey);
    return merged;
  }

  async readDbSubset(keys) {
    if (typeof this.api.getDatabase !== 'function') return null;
    const safeKeys = keys.filter(k => k !== 'plugins');
    return await this.api.getDatabase(safeKeys);
  }

  /**
   * Always uses async setDatabase() and never passes `plugins` or `characters` to setDatabaseLite().
   */
  async writeDbSubset(partial) {
    const safe = {};
    for (const [k, v] of Object.entries(partial)) {
      if (k === 'plugins') continue;
      safe[k] = v;
    }
    if (typeof this.api.setDatabase === 'function') {
      await this.api.setDatabase(safe);
      return;
    }
    if (typeof this.api.setDatabaseLite === 'function' && !Object.hasOwn(safe, 'characters')) {
      await this.api.setDatabaseLite(safe);
      return;
    }
    throw new Error('데이터베이스 저장 API를 사용할 수 없습니다.');
  }

  async readAllowedConfig() {
    const db = await this.readDbSubset(ALLOWED_CONFIG_KEYS);
    if (!db) return null;
    const out = {};
    for (const key of ALLOWED_CONFIG_KEYS) {
      if (Object.hasOwn(db, key)) out[key] = db[key];
    }
    return out;
  }

  async readPersonas() {
    const db = await this.readDbSubset(['personas', 'selectedPersona']);
    if (!db) return { personas: [], selectedPersona: 0, permissionDenied: true };
    return {
      personas: Array.isArray(db.personas) ? db.personas : [],
      selectedPersona: Number.isInteger(db.selectedPersona) ? db.selectedPersona : 0,
      permissionDenied: false,
    };
  }

  async readModules() {
    const db = await this.readDbSubset(['modules', 'enabledModules', 'moduleIntergration']);
    if (!db) return { modules: [], enabledModules: [], moduleIntergration: '', permissionDenied: true };
    return {
      modules: Array.isArray(db.modules) ? db.modules : [],
      enabledModules: Array.isArray(db.enabledModules) ? db.enabledModules : [],
      moduleIntergration: typeof db.moduleIntergration === 'string' ? db.moduleIntergration : '',
      permissionDenied: false,
    };
  }

  /**
   * Resolves the current source content, host identity binding, and rich metadata for any target descriptor.
   */
  async readTargetSnapshot(target) {
    const t = target || { targetKind: 'general' };

    if (t.targetKind === 'char_field') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const fieldKey = t.fieldKey || 'desc';
      const fieldErr = validateAllowedFieldKey('char_field', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      const content = fieldKey === 'depthPrompt'
        ? String(char.depth_prompt?.prompt ?? '')
        : String(char[fieldKey] ?? '');
      return {
        ok: true,
        target: { ...t, fieldKey },
        hostBinding: { charIndex, ...getCharIdentity(char) },
        label: CHAR_FIELD_META[fieldKey]?.label || fieldKey,
        content,
        charName: char.name || '(이름 없음)',
      };
    }

    if (t.targetKind === 'char_alt_greeting') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const list = Array.isArray(char.alternateGreetings) ? char.alternateGreetings : [];
      const idx =
        Number.isInteger(t.greetingIndex) && t.greetingIndex >= 0 && t.greetingIndex < list.length
          ? t.greetingIndex
          : (list.length > 0 ? 0 : null);
      return {
        ok: true,
        target: { ...t, fieldKey: 'alternateGreetings', greetingIndex: idx },
        hostBinding: { charIndex, greetingIndex: idx, ...getCharIdentity(char) },
        label: idx !== null
          ? `캐릭터 · 추가 첫 메시지 #${idx + 1} (${char.name || '무제'})`
          : `캐릭터 · 추가 첫 메시지 (없음 · ${char.name || '무제'})`,
        content: idx !== null ? String(list[idx] ?? '') : '',
        greetingCount: list.length,
        altGreetingsSummary: list.slice(0, 40).map((g, i) => ({
          index: i,
          preview: String(g ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        })),
        charName: char.name || '(이름 없음)',
      };
    }

    if (t.targetKind === 'chat_note') {
      const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat) return { ok: false, reason: '활성 채팅을 찾을 수 없습니다.', content: '' };
      const fieldKey = t.fieldKey || 'note';
      const fieldErr = validateAllowedFieldKey('chat_note', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      return {
        ok: true,
        target: { ...t, fieldKey: 'note' },
        hostBinding: { charIndex, chatIndex, ...getCharIdentity(char) },
        label: '작가의 노트 (현재 채팅)',
        content: String(chat.note ?? ''),
        charName: char?.name || '(이름 없음)',
      };
    }

    if (t.targetKind === 'chat_message') {
      const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat) return { ok: false, reason: '활성 채팅을 찾을 수 없습니다.', content: '' };
      // In Chat.svelte, data-chat-index="-1" represents the active greeting (firstMessage or alternateGreetings[fmIndex])
      if (t.messageIndex === -1 && char) {
        const fmIndex = Number.isInteger(chat.fmIndex) ? chat.fmIndex : -1;
        if (fmIndex >= 0 && Array.isArray(char.alternateGreetings) && char.alternateGreetings[fmIndex] !== undefined) {
          return await this.readTargetSnapshot({
            ...t,
            screen: 'character',
            targetKind: 'char_alt_greeting',
            fieldKey: 'alternateGreetings',
            greetingIndex: fmIndex,
            messageIndex: undefined,
          });
        }
        return await this.readTargetSnapshot({
          ...t,
          screen: 'character',
          targetKind: 'char_field',
          fieldKey: 'firstMessage',
          messageIndex: undefined,
        });
      }
      const list = Array.isArray(chat.message) ? chat.message : [];
      const idx =
        Number.isInteger(t.messageIndex) && t.messageIndex >= 0 && t.messageIndex < list.length
          ? t.messageIndex
          : (list.length > 0 ? list.length - 1 : null);
      const msg = idx !== null ? list[idx] : null;
      const roleLabel = msg?.role === 'user' ? '유저' : '캐릭터';
      const startOffset = Math.max(0, list.length - 30);
      return {
        ok: true,
        target: { ...t, fieldKey: 'data', messageIndex: idx },
        hostBinding: { charIndex, chatIndex, messageIndex: idx, chatId: msg?.chatId || null, ...getCharIdentity(char) },
        label: msg ? `채팅 메시지 #${idx + 1} (${roleLabel})` : '채팅 메시지 (없음)',
        content: msg ? String(msg.data ?? '') : '',
        messageCount: list.length,
        messagesSummary: list.slice(startOffset).map((m, i) => ({
          index: startOffset + i,
          role: m?.role === 'user' ? '유저' : '캐릭터',
          preview: String(m?.data ?? '').replace(/\s+/g, ' ').trim().slice(0, 36),
        })),
        charName: char?.name || '(이름 없음)',
      };
    }

    if (t.targetKind === 'char_lorebook') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const list = Array.isArray(char.globalLore) ? char.globalLore : [];
      const idx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
      const entry = idx !== null && list[idx] ? list[idx] : null;
      const fieldKey = t.fieldKey || 'content';
      const fieldErr = validateAllowedFieldKey('char_lorebook', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      return {
        ok: true,
        target: { ...t, loreIndex: idx, fieldKey },
        hostBinding: { charIndex, ...getCharIdentity(char) },
        label: entry ? `캐릭터 로어북 #${idx + 1} (${entry.comment || '무제'})` : `캐릭터 로어북 (${list.length}개)`,
        content: entry ? String(entry[fieldKey] ?? '') : '',
        entry,
        loreCount: list.length,
        loreSummary: list.slice(0, 40).map((e, i) => ({
          index: i,
          comment: e.comment || '',
          key: e.key || '',
          alwaysActive: Boolean(e.alwaysActive),
          insertorder: e.insertorder ?? 100,
          mode: e.mode || 'normal',
        })),
      };
    }

    if (t.targetKind === 'chat_lorebook') {
      const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat) return { ok: false, reason: '활성 채팅을 찾을 수 없습니다.', content: '' };
      const list = Array.isArray(chat.localLore) ? chat.localLore : [];
      const idx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
      const entry = idx !== null && list[idx] ? list[idx] : null;
      const fieldKey = t.fieldKey || 'content';
      const fieldErr = validateAllowedFieldKey('chat_lorebook', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      return {
        ok: true,
        target: { ...t, loreIndex: idx, fieldKey },
        hostBinding: { charIndex, chatIndex, ...getCharIdentity(char) },
        label: entry ? `채팅 로어북 #${idx + 1} (${entry.comment || '무제'})` : `채팅 로어북 (${list.length}개)`,
        content: entry ? String(entry[fieldKey] ?? '') : '',
        entry,
        loreCount: list.length,
        loreSummary: list.slice(0, 40).map((e, i) => ({
          index: i,
          comment: e.comment || '',
          key: e.key || '',
          alwaysActive: Boolean(e.alwaysActive),
          insertorder: e.insertorder ?? 100,
        })),
      };
    }

    if (t.targetKind === 'char_lua') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const lua = extractLuaFromTriggers(char.triggerscript);
      return {
        ok: true,
        target: { ...t, fieldKey: 'code' },
        hostBinding: { charIndex, ...getCharIdentity(char) },
        label: `캐릭터 Lua 트리거 (${char.name || '무제'})`,
        content: lua.code,
        isLua: lua.isLua,
        hasOtherTriggers: lua.hasOtherTriggers,
        otherTriggerCount: lua.otherTriggerCount,
      };
    }

    if (t.targetKind === 'char_regex') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const list = Array.isArray(char.customscript) ? char.customscript : [];
      const idx = Number.isInteger(t.regexIndex) ? t.regexIndex : null;
      const entry = idx !== null && list[idx] ? list[idx] : null;
      return {
        ok: true,
        target: { ...t, regexIndex: idx },
        hostBinding: { charIndex, ...getCharIdentity(char) },
        label: entry ? `캐릭터 정규식 #${idx + 1} (${entry.comment || '무제'})` : `캐릭터 정규식 (${list.length}개)`,
        content: entry ? JSON.stringify(entry, null, 2) : '',
        entry,
        regexList: list.slice(0, 30),
      };
    }

    if (t.targetKind === 'persona') {
      const { personas, selectedPersona, permissionDenied } = await this.readPersonas();
      if (permissionDenied) return { ok: false, reason: DB_PERMISSION_ERROR, content: '' };
      const idx = Number.isInteger(t.personaIndex) ? t.personaIndex : selectedPersona;
      const entry = personas[idx] ?? null;
      const fieldKey = t.fieldKey || 'personaPrompt';
      const fieldErr = validateAllowedFieldKey('persona', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      return {
        ok: true,
        target: { ...t, personaIndex: idx, fieldKey },
        hostBinding: { personaIndex: idx, personaId: entry?.id || null },
        label: entry ? `페르소나 #${idx + 1} (${entry.name || '무제'})` : '페르소나 목록',
        content: entry ? String(entry[fieldKey] ?? '') : '',
        entry,
        personasSummary: personas.map((p, i) => ({
          index: i,
          id: p.id || '',
          name: p.name || '',
          note: p.note || '',
          selected: i === selectedPersona,
        })),
        selectedPersona,
      };
    }

    if (
      t.targetKind === 'module_field' ||
      t.targetKind === 'module_lorebook' ||
      t.targetKind === 'module_lua' ||
      t.targetKind === 'module_regex'
    ) {
      const { modules, enabledModules, permissionDenied } = await this.readModules();
      if (permissionDenied) return { ok: false, reason: DB_PERMISSION_ERROR, content: '' };
      const resolvedMod = resolveModuleIndex(modules, t, this._lastMatchedModuleId);
      const modIdx = resolvedMod.index;
      const mod = modIdx !== null ? modules[modIdx] : null;
      if (!mod) return { ok: true, target: t, label: '설치된 모듈 없음', content: '', modulesSummary: [] };
      if (mod.id && (resolvedMod.matchedBy === 'explicit' || resolvedMod.matchedBy === 'dom_hints')) {
        this._lastMatchedModuleId = mod.id;
      }

      let content = '';
      let label = `모듈: ${mod.name}`;
      let entry = null;
      let isLua = false;
      let hasOtherTriggers = false;
      let otherTriggerCount = 0;
      let resolvedFieldKey = t.fieldKey;
      let resolvedLoreIdx = t.loreIndex;
      let resolvedRegexIdx = t.regexIndex;
      let loreCount;
      let loreSummary;
      let regexList;

      if (t.targetKind === 'module_field') {
        const fieldKey = t.fieldKey || 'backgroundEmbedding';
        const fieldErr = validateAllowedFieldKey('module_field', fieldKey);
        if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
        resolvedFieldKey = fieldKey;
        content = String(mod[fieldKey] ?? '');
        const metaLabel = MODULE_FIELD_META[fieldKey]?.label || `모듈 · ${fieldKey}`;
        label = `${metaLabel} (${mod.name || '무제'})`;
      } else if (t.targetKind === 'module_lua') {
        const lua = extractLuaFromTriggers(mod.trigger);
        content = lua.code;
        isLua = lua.isLua;
        hasOtherTriggers = lua.hasOtherTriggers;
        otherTriggerCount = lua.otherTriggerCount;
        label = `모듈 Lua (${mod.name})`;
      } else if (t.targetKind === 'module_regex') {
        const list = Array.isArray(mod.regex) ? mod.regex : [];
        const rIdx = Number.isInteger(t.regexIndex) && list[t.regexIndex] ? t.regexIndex : null;
        resolvedRegexIdx = rIdx;
        entry = rIdx !== null ? list[rIdx] : null;
        content = entry ? JSON.stringify(entry, null, 2) : '';
        label = entry ? `모듈 정규식 (${mod.name} #${rIdx + 1})` : `모듈 정규식 (${mod.name}, ${list.length}개)`;
        regexList = list.slice(0, 30);
      } else {
        const list = Array.isArray(mod.lorebook) ? mod.lorebook : [];
        const lIdx = Number.isInteger(t.loreIndex) && list[t.loreIndex] ? t.loreIndex : null;
        resolvedLoreIdx = lIdx;
        entry = lIdx !== null ? list[lIdx] : null;
        const fieldKey = t.fieldKey || 'content';
        const fieldErr = validateAllowedFieldKey('module_lorebook', fieldKey);
        if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
        resolvedFieldKey = fieldKey;
        content = entry ? String(entry[fieldKey] ?? '') : '';
        const entryTitle = entry?.comment ? ` · ${entry.comment}` : '';
        label = entry ? `모듈 로어북 (${mod.name} #${lIdx + 1}${entryTitle})` : `모듈 로어북 (${mod.name}, ${list.length}개)`;
        loreCount = list.length;
        loreSummary = list.slice(0, 40).map((e, i) => ({
          index: i,
          comment: e.comment || '',
          key: e.key || '',
          alwaysActive: Boolean(e.alwaysActive),
          insertorder: e.insertorder ?? 100,
          mode: e.mode || 'normal',
        }));
      }
      return {
        ok: true,
        target: {
          ...t,
          moduleIndex: modIdx,
          fieldKey: resolvedFieldKey,
          ...(t.targetKind === 'module_lorebook' ? { loreIndex: resolvedLoreIdx } : {}),
          ...(t.targetKind === 'module_regex' ? { regexIndex: resolvedRegexIdx } : {}),
        },
        hostBinding: { moduleIndex: modIdx, moduleId: mod.id || null },
        moduleMatchedBy: resolvedMod.matchedBy,
        label,
        content,
        entry,
        isLua,
        hasOtherTriggers,
        otherTriggerCount,
        ...(loreSummary !== undefined ? { loreCount, loreSummary } : {}),
        ...(regexList !== undefined ? { regexList } : {}),
        module: mod,
        modulesSummary: modules.map((m, i) => ({
          index: i,
          id: m.id,
          name: m.name,
          enabled: enabledModules.includes(m.id),
          loreCount: m.lorebook?.length ?? 0,
        })),
      };
    }

    if (t.targetKind === 'config') {
      const cfg = await this.readAllowedConfig();
      if (!cfg) return { ok: false, reason: DB_PERMISSION_ERROR, content: '' };
      const fieldKey = t.fieldKey || null;
      const fieldErr = validateAllowedFieldKey('config', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      return {
        ok: true,
        target: { ...t, fieldKey },
        label: fieldKey ? (CONFIG_FIELD_META[fieldKey]?.label || `설정 · ${fieldKey}`) : 'RisuAI 설정 (허용 키)',
        content: fieldKey ? String(cfg[fieldKey] ?? '') : JSON.stringify(cfg, null, 2),
        config: cfg,
      };
    }

    if (t.screen === 'chat') {
      try {
        const { char } = await this.readActiveCharacter();
        if (char) {
          return {
            ok: true,
            target: t,
            label: `채팅 화면 (${char.name || '이름 없음'})`,
            content: '',
            charName: char.name || '',
          };
        }
      } catch {}
      return { ok: true, target: t, label: '채팅 입력 화면', content: '' };
    }

    return { ok: true, target: t, label: '일반 대화 / 질문', content: '' };
  }

  _pushUndo(entry) {
    this.undoStack.push({
      id: makeUuid(),
      timestamp: Date.now(),
      ...entry,
    });
    if (this.undoStack.length > this.maxUndo) {
      this.undoStack.shift();
    }
    return this.undoStack[this.undoStack.length - 1].id;
  }

  /**
   * Computes the resulting text, metadata diffs, warnings, and pinned target binding before mutating anything.
   */
  async previewProposal(proposal, activeTarget) {
    let target;
    try {
      target = this._resolveSafeTarget(proposal, activeTarget);
    } catch (err) {
      return { ok: false, error: err.message };
    }

    if (proposal.action === 'patch_text' || proposal.action === 'replace_text') {
      const snap = await this.readTargetSnapshot(target);
      if (!snap.ok) return { ok: false, error: snap.reason };
      const kind = snap.target?.targetKind || target.targetKind;
      const nonEditableTextKinds = new Set(['general', 'char_regex', 'module_regex']);
      if (!kind || nonEditableTextKinds.has(kind)) {
        return {
          ok: false,
          error: `현재 대상(${kind || '없음'})에는 직접 텍스트 적용을 지원하지 않습니다. 상단에서 편집할 대상을 선택해 주세요.`,
          label: snap.label,
          target: snap.target,
        };
      }
      if (kind === 'config' && (!snap.target?.fieldKey || !ALLOWED_CONFIG_KEYS.includes(snap.target.fieldKey))) {
        return {
          ok: false,
          error: '특정 설정 필드가 선택되지 않았습니다. 설정 변경에는 update_config를 사용하거나 상단에서 설정 필드를 선택하세요.',
          label: snap.label,
          target: snap.target,
        };
      }
      if (
        (kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook') &&
        (!Number.isInteger(snap.target?.loreIndex) || !snap.entry)
      ) {
        return {
          ok: false,
          error: '수정할 로어북 항목이 선택되지 않았습니다. 상단에서 로어북 항목을 선택하거나 create_lorebook을 사용하세요.',
          label: snap.label,
          target: snap.target,
        };
      }
      if (kind === 'char_alt_greeting' && !Number.isInteger(snap.target?.greetingIndex)) {
        return {
          ok: false,
          error: '수정할 추가 첫 메시지 항목이 없습니다. RisuAI 캐릭터 고급 설정에서 추가 첫 메시지를 하나 이상 만든 뒤 시도해 주세요.',
          label: snap.label,
          target: snap.target,
        };
      }
      if (kind === 'chat_message' && !Number.isInteger(snap.target?.messageIndex)) {
        return {
          ok: false,
          error: '수정할 채팅 메시지가 없습니다. 채팅 대화가 있는 상태에서 메시지를 선택해 주세요.',
          label: snap.label,
          target: snap.target,
        };
      }
      if (kind === 'module_field' && !snap.module) {
        return {
          ok: false,
          error: '수정할 설치 모듈이 없습니다.',
          label: snap.label,
          target: snap.target,
        };
      }
      const before = snap.content;
      if (proposal.action === 'replace_text') {
        const truncErr = checkTruncationGuard(before, '전체 덮어쓰기(replace_text)');
        if (truncErr) {
          return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
        }
      }
      try {
        const after = proposal.action === 'patch_text'
          ? applyTextEdits(before, proposal.edits, proposal.title || snap.label)
          : String(proposal.content ?? '');
        const isLuaTarget = kind === 'char_lua' || kind === 'module_lua';
        const destructiveWarning = isLuaTarget && snap.hasOtherTriggers
          ? buildLuaDestructiveWarning(snap.otherTriggerCount)
          : null;
        return {
          ok: true,
          before,
          after,
          label: snap.label,
          target: snap.target,
          hostBinding: snap.hostBinding || null,
          destructiveWarning,
          requiresConfirm: Boolean(destructiveWarning),
          confirmLabel: destructiveWarning ? '기존 V1/V2 트리거가 삭제되고 Lua로 대체됨을 확인했습니다' : null,
        };
      } catch (err) {
        return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
      }
    }

    if (proposal.action === 'update_lua') {
      const scope = proposal.scope === 'module' ? 'module_lua' : 'char_lua';
      const snap = await this.readTargetSnapshot({
        targetKind: scope,
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
        moduleDomHints: proposal.moduleIndex === undefined ? target.moduleDomHints : undefined,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      const before = snap.content;
      if (!proposal.edits) {
        const truncErr = checkTruncationGuard(before, 'Lua 전체 교체');
        if (truncErr) {
          return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
        }
      }
      try {
        const after = proposal.edits
          ? applyTextEdits(before, proposal.edits, 'Lua 스크립트')
          : String(proposal.code ?? proposal.content ?? '');
        const destructiveWarning = snap.hasOtherTriggers
          ? buildLuaDestructiveWarning(snap.otherTriggerCount)
          : null;
        return {
          ok: true,
          before,
          after,
          label: snap.label,
          target: snap.target,
          hostBinding: snap.hostBinding || null,
          warning: destructiveWarning,
          destructiveWarning,
          requiresConfirm: Boolean(destructiveWarning),
          confirmLabel: destructiveWarning ? '기존 V1/V2 트리거가 삭제되고 Lua로 대체됨을 확인했습니다' : null,
        };
      } catch (err) {
        return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
      }
    }

    if (proposal.action === 'update_lorebook') {
      const scope = proposal.scope || target.loreScope || 'character';
      const targetKind = scope === 'chat' ? 'chat_lorebook' : scope === 'module' ? 'module_lorebook' : 'char_lorebook';
      const loreIndex = Number.isInteger(proposal.loreIndex) ? proposal.loreIndex : target.loreIndex;
      const fieldKey = proposal.fieldKey || 'content';
      const fieldErr = validateAllowedFieldKey(targetKind, fieldKey);
      if (fieldErr) return { ok: false, error: fieldErr };
      const snap = await this.readTargetSnapshot({
        targetKind,
        loreIndex,
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
        moduleDomHints: proposal.moduleIndex === undefined ? target.moduleDomHints : undefined,
        fieldKey,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      if (!snap.entry) return { ok: false, error: `수정할 로어북 항목(#${loreIndex})을 찾을 수 없습니다.` };

      const before = String(snap.entry[fieldKey] ?? '');
      if (!proposal.edits && (proposal[fieldKey] !== undefined || (fieldKey === 'content' && proposal.content !== undefined))) {
        const truncErr = checkTruncationGuard(before, '로어북 본문 전체 덮어쓰기');
        if (truncErr) return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
      }

      const nextEntry = normalizeLorebookEntry(proposal, snap.entry);
      if (proposal.edits) {
        try {
          nextEntry[fieldKey] = applyTextEdits(before, proposal.edits, '로어북');
        } catch (err) {
          return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
        }
      }
      const after = String(nextEntry[fieldKey] ?? '');
      const metaChanges = computeMetaChanges(snap.entry, nextEntry, LORE_META_SPECS, fieldKey);
      return {
        ok: true,
        before,
        after,
        metaChanges,
        label: snap.label,
        target: snap.target,
        hostBinding: snap.hostBinding || null,
      };
    }

    if (proposal.action === 'update_persona') {
      const fieldKey = proposal.fieldKey || 'personaPrompt';
      const fieldErr = validateAllowedFieldKey('persona', fieldKey);
      if (fieldErr) return { ok: false, error: fieldErr };
      const snap = await this.readTargetSnapshot({
        targetKind: 'persona',
        personaIndex: proposal.personaIndex ?? target.personaIndex,
        fieldKey,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      if (!snap.entry) return { ok: false, error: '수정할 페르소나를 찾을 수 없습니다.' };

      const before = String(snap.entry[fieldKey] ?? '');
      if (!proposal.edits && !proposal.fieldEdits && proposal[fieldKey] !== undefined) {
        const truncErr = checkTruncationGuard(before, '페르소나 전체 덮어쓰기');
        if (truncErr) return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
      }

      const nextEntry = clone(snap.entry);
      if (proposal.name !== undefined) nextEntry.name = String(proposal.name);
      if (proposal.note !== undefined) nextEntry.note = String(proposal.note);
      if (proposal.largePortrait !== undefined) nextEntry.largePortrait = Boolean(proposal.largePortrait);
      if (proposal.edits) {
        try {
          nextEntry.personaPrompt = applyTextEdits(String(snap.entry.personaPrompt ?? ''), proposal.edits, '페르소나 프롬프트');
        } catch (err) {
          return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
        }
      } else if (proposal.fieldEdits && proposal.fieldKey) {
        try {
          nextEntry[proposal.fieldKey] = applyTextEdits(String(snap.entry[proposal.fieldKey] ?? ''), proposal.fieldEdits, `페르소나 ${proposal.fieldKey}`);
        } catch (err) {
          return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
        }
      } else if (proposal.personaPrompt !== undefined) {
        nextEntry.personaPrompt = String(proposal.personaPrompt);
      }

      const after = String(nextEntry[fieldKey] ?? '');
      const metaChanges = computeMetaChanges(snap.entry, nextEntry, PERSONA_META_SPECS, fieldKey);
      const flavor = this.detectHostFlavor();
      const isSelected = snap.target.personaIndex === snap.selectedPersona;
      const warning = isSelected && !flavor.activePersonaAutoSyncs && !proposal.bindToCurrentChat
        ? '원본 RisuAI/PocketRisu/RisuBard에서는 현재 선택된 전역 페르소나 UI가 즉시 갱신되지 않을 수 있습니다. "현재 채팅에 바인딩"을 체크하면 즉시 반영됩니다.'
        : null;
      return {
        ok: true,
        before,
        after,
        metaChanges,
        label: snap.label,
        target: snap.target,
        hostBinding: snap.hostBinding || null,
        warning,
      };
    }

    if (proposal.action === 'upsert_regex') {
      const scope = proposal.scope || (target.targetKind === 'module_regex' ? 'module' : 'character');
      const targetKind = scope === 'module' ? 'module_regex' : 'char_regex';
      const idx = Number.isInteger(proposal.regexIndex) ? proposal.regexIndex : null;
      const snap = await this.readTargetSnapshot({
        targetKind,
        regexIndex: idx,
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
        moduleDomHints: proposal.moduleIndex === undefined ? target.moduleDomHints : undefined,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      const existing = idx !== null ? snap.entry : null;
      const nextEntry = normalizeRegexEntry(proposal, existing);
      const metaChanges = existing
        ? computeMetaChanges(existing, nextEntry, REGEX_META_SPECS)
        : REGEX_META_SPECS.map(([key, label]) => ({
            key,
            label,
            before: '(신규)',
            after: formatMetaValue(nextEntry[key]),
          }));
      return {
        ok: true,
        before: existing ? String(existing.out ?? '') : '',
        after: String(nextEntry.out ?? ''),
        metaChanges,
        label: existing ? `${snap.label} 수정` : (proposal.title || `새 정규식 (${nextEntry.comment})`),
        target: snap.target,
        hostBinding: snap.hostBinding || null,
      };
    }

    if (proposal.action === 'create_lorebook') {
      const scope = proposal.scope || target.loreScope || 'character';
      const targetKind = scope === 'chat' ? 'chat_lorebook' : scope === 'module' ? 'module_lorebook' : 'char_lorebook';
      const snap = await this.readTargetSnapshot({
        targetKind,
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
        moduleDomHints: proposal.moduleIndex === undefined ? target.moduleDomHints : undefined,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      const nextEntry = normalizeLorebookEntry(proposal);
      const metaChanges = LORE_META_SPECS
        .filter(([k]) => nextEntry[k] !== undefined && nextEntry[k] !== '' && nextEntry[k] !== false)
        .map(([key, label]) => ({ key, label, before: '(신규)', after: formatMetaValue(nextEntry[key]) }));
      return {
        ok: true,
        before: '',
        after: String(nextEntry.content ?? ''),
        metaChanges,
        label: proposal.title || `새 로어북 (${nextEntry.comment})`,
        target: snap.target,
        hostBinding: snap.hostBinding || null,
      };
    }

    if (proposal.action === 'create_persona') {
      const metaChanges = [
        { key: 'name', label: '이름', before: '(신규)', after: formatMetaValue(proposal.name || 'New Persona') },
      ];
      if (proposal.note) metaChanges.push({ key: 'note', label: '메모', before: '(신규)', after: formatMetaValue(proposal.note) });
      if (proposal.largePortrait) metaChanges.push({ key: 'largePortrait', label: '큰 초상화', before: '(신규)', after: '예' });
      return {
        ok: true,
        before: '',
        after: String(proposal.personaPrompt ?? proposal.content ?? ''),
        metaChanges,
        label: proposal.title || `새 페르소나 (${proposal.name || 'New Persona'})`,
        target,
        hostBinding: null,
      };
    }

    if (proposal.action === 'update_config') {
      const cfg = await this.readAllowedConfig();
      if (!cfg) return { ok: false, error: DB_PERMISSION_ERROR };
      const changes = proposal.changes || {};
      const invalidKeys = Object.keys(changes).filter(k => !ALLOWED_CONFIG_KEYS.includes(k));
      if (invalidKeys.length > 0) {
        return { ok: false, error: `허용되지 않는 설정 키입니다: ${invalidKeys.join(', ')}` };
      }
      const beforeObj = {};
      const afterObj = {};
      for (const [k, v] of Object.entries(changes)) {
        beforeObj[k] = cfg[k];
        afterObj[k] = v;
      }
      return {
        ok: true,
        before: JSON.stringify(beforeObj, null, 2),
        after: JSON.stringify(afterObj, null, 2),
        label: `설정 변경 (${Object.keys(changes).join(', ')})`,
        target,
        hostBinding: null,
      };
    }

    return { ok: false, error: `지원하지 않는 작업 종류입니다: ${proposal.action}` };
  }

  /**
   * Applies a validated proposal to RisuAI using the pinned target and pushes a surgical Undo record.
   */
  async applyProposal(proposal, activeTarget, options = {}) {
    const target = this._resolveSafeTarget(proposal, activeTarget);

    switch (proposal.action) {
      case 'patch_text':
      case 'replace_text':
        return await this._applyTextTarget(proposal, target, options);
      case 'create_lorebook':
        return await this._applyCreateLorebook(proposal, target, options);
      case 'update_lorebook':
        return await this._applyUpdateLorebook(proposal, target, options);
      case 'update_lua':
        return await this._applyUpdateLua(proposal, target, options);
      case 'upsert_regex':
        return await this._applyUpsertRegex(proposal, target, options);
      case 'create_persona':
        return await this._applyCreatePersona(proposal, options);
      case 'update_persona':
        return await this._applyUpdatePersona(proposal, target, options);
      case 'update_config':
        return await this._applyUpdateConfig(proposal);
      default:
        throw new Error(`지원하지 않는 작업 종류입니다: ${proposal.action}`);
    }
  }

  async _applyTextTarget(proposal, target, options = {}) {
    const kind = target.targetKind;
    const compute = (before, label) => {
      if (proposal.action === 'replace_text') {
        const truncErr = checkTruncationGuard(before, '전체 덮어쓰기(replace_text)');
        if (truncErr) throw new Error(truncErr);
        return String(proposal.content ?? '');
      }
      return applyTextEdits(before, proposal.edits, label);
    };

    if (kind === 'char_field') {
      const fieldKey = target.fieldKey || 'desc';
      assertAllowedFieldKey('char_field', fieldKey);
      const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
      const charBinding = { charIndex, ...getCharIdentity(char) };

      if (fieldKey === 'depthPrompt') {
        const hadKey = Object.hasOwn(char, 'depth_prompt');
        const prevValue = clone(char.depth_prompt);
        const nextChar = clone(char);
        const curDepth = Number.isFinite(Number(nextChar.depth_prompt?.depth)) ? Number(nextChar.depth_prompt.depth) : 0;
        const nextPrompt = compute(String(nextChar.depth_prompt?.prompt ?? ''), '깊이 프롬프트');
        nextChar.depth_prompt = { ...(nextChar.depth_prompt || {}), depth: curDepth, prompt: nextPrompt };
        await this._setCharacter(nextChar);

        const undoId = this._pushUndo({
          label: '캐릭터 깊이 프롬프트 수정',
          restore: async () => {
            const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
            const restored = clone(latest);
            if (hadKey) restored.depth_prompt = clone(prevValue);
            else delete restored.depth_prompt;
            await this._setCharacter(restored);
          },
        });
        return { ok: true, undoId, summary: '캐릭터 깊이 프롬프트에 적용했습니다.' };
      }

      const hadKey = Object.hasOwn(char, fieldKey);
      const prevValue = clone(char[fieldKey]);

      const nextChar = clone(char);
      nextChar[fieldKey] = compute(String(nextChar[fieldKey] ?? ''), fieldKey);
      await this._setCharacter(nextChar);

      const undoId = this._pushUndo({
        label: `캐릭터 ${fieldKey} 수정`,
        restore: async () => {
          const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
          const restored = clone(latest);
          if (hadKey) restored[fieldKey] = clone(prevValue);
          else delete restored[fieldKey];
          await this._setCharacter(restored);
        },
      });
      return { ok: true, undoId, summary: `캐릭터 ${CHAR_FIELD_META[fieldKey]?.label || fieldKey}에 적용했습니다.` };
    }

    if (kind === 'char_alt_greeting') {
      const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
      const list = Array.isArray(char.alternateGreetings) ? char.alternateGreetings : [];
      const idx = target.greetingIndex;
      if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) {
        throw new Error('수정할 추가 첫 메시지 인덱스가 올바르지 않습니다.');
      }
      const prevValue = clone(list[idx]);
      const charBinding = { charIndex, ...getCharIdentity(char) };

      const nextChar = clone(char);
      nextChar.alternateGreetings[idx] = compute(String(nextChar.alternateGreetings[idx] ?? ''), `추가 첫 메시지 #${idx + 1}`);
      await this._setCharacter(nextChar);

      const undoId = this._pushUndo({
        label: `추가 첫 메시지 #${idx + 1} 수정`,
        restore: async () => {
          const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
          if (!Array.isArray(latest.alternateGreetings) || idx >= latest.alternateGreetings.length) {
            throw new Error('되돌릴 추가 첫 메시지 항목을 찾을 수 없습니다.');
          }
          const restored = clone(latest);
          restored.alternateGreetings[idx] = clone(prevValue);
          await this._setCharacter(restored);
        },
      });
      return { ok: true, undoId, summary: `캐릭터 추가 첫 메시지 #${idx + 1}에 적용했습니다.` };
    }

    if (kind === 'chat_note') {
      const fieldKey = target.fieldKey || 'note';
      assertAllowedFieldKey('chat_note', fieldKey);
      const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, '적용');
      const hadKey = Object.hasOwn(chat, 'note');
      const prevValue = clone(chat.note);

      const nextChat = clone(chat);
      nextChat.note = compute(String(nextChat.note ?? ''), '작가의 노트');
      await this._setChat(charIndex, chatIndex, nextChat);

      const undoId = this._pushUndo({
        label: '작가의 노트 수정',
        restore: async () => {
          const latestChat = await this._readChatAt(charIndex, chatIndex);
          if (!latestChat) throw new Error('되돌릴 채팅을 찾을 수 없습니다.');
          const restored = clone(latestChat);
          if (hadKey) restored.note = clone(prevValue);
          else delete restored.note;
          await this._setChat(charIndex, chatIndex, restored);
        },
      });
      return { ok: true, undoId, summary: '현재 채팅의 작가의 노트에 적용했습니다.' };
    }

    if (kind === 'chat_message') {
      const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, '적용');
      const idx = target.messageIndex;
      if (!Number.isInteger(idx) || idx < 0 || !chat.message?.[idx]) {
        throw new Error('수정할 채팅 메시지 인덱스가 올바르지 않습니다.');
      }
      const pinnedChatId = options.hostBinding?.chatId || null;
      if (pinnedChatId && chat.message[idx].chatId && chat.message[idx].chatId !== pinnedChatId) {
        throw new Error('대상 채팅 메시지가 변경되어 적용을 중단했습니다. 다시 제안받아 주세요.');
      }
      const prevData = clone(chat.message[idx].data);
      const hasSwipe = Array.isArray(chat.message[idx].swipes) && Number.isInteger(chat.message[idx].swipeId);
      const swipeId = hasSwipe ? chat.message[idx].swipeId : null;
      const prevSwipeVal = hasSwipe ? clone(chat.message[idx].swipes[swipeId]) : undefined;

      const nextChat = clone(chat);
      const nextText = compute(String(nextChat.message[idx].data ?? ''), `채팅 메시지 #${idx + 1}`);
      nextChat.message[idx].data = nextText;
      if (hasSwipe) {
        nextChat.message[idx].swipes[swipeId] = nextText;
      }
      await this._setChat(charIndex, chatIndex, nextChat);

      const undoId = this._pushUndo({
        label: `채팅 메시지 #${idx + 1} 수정`,
        restore: async () => {
          const latestChat = await this._readChatAt(charIndex, chatIndex);
          if (!latestChat?.message?.[idx]) throw new Error('되돌릴 채팅 메시지를 찾을 수 없습니다.');
          if (pinnedChatId && latestChat.message[idx].chatId && latestChat.message[idx].chatId !== pinnedChatId) {
            throw new Error('되돌릴 채팅 메시지가 변경되어 복구를 중단했습니다.');
          }
          const restored = clone(latestChat);
          restored.message[idx].data = clone(prevData);
          if (hasSwipe && Array.isArray(restored.message[idx].swipes)) {
            restored.message[idx].swipes[swipeId] = clone(prevSwipeVal);
          }
          await this._setChat(charIndex, chatIndex, restored);
        },
      });
      return { ok: true, undoId, summary: `채팅 메시지 #${idx + 1}에 적용했습니다.` };
    }

    if (kind === 'char_lorebook') {
      const fieldKey = target.fieldKey || 'content';
      assertAllowedFieldKey('char_lorebook', fieldKey);
      const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
      const idx = target.loreIndex;
      if (!Number.isInteger(idx) || !char.globalLore?.[idx]) {
        throw new Error('수정할 캐릭터 로어북 인덱스가 올바르지 않습니다.');
      }
      const prevFieldValue = clone(char.globalLore[idx][fieldKey]);
      const charBinding = { charIndex, ...getCharIdentity(char) };

      const nextChar = clone(char);
      const nextStr = compute(String(nextChar.globalLore[idx][fieldKey] ?? ''), '캐릭터 로어북');
      if (fieldKey === 'insertorder') {
        const num = Number(nextStr.trim());
        if (!Number.isFinite(num)) throw new Error('배치 순서(insertorder)는 유한한 숫자여야 합니다.');
        nextChar.globalLore[idx][fieldKey] = num;
      } else {
        nextChar.globalLore[idx][fieldKey] = nextStr;
      }
      await this._setCharacter(nextChar);

      const undoId = this._pushUndo({
        label: `캐릭터 로어북 #${idx + 1} 수정`,
        restore: async () => {
          const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
          if (!latest.globalLore?.[idx]) throw new Error('되돌릴 캐릭터 로어북 항목을 찾을 수 없습니다.');
          const restored = clone(latest);
          restored.globalLore[idx][fieldKey] = clone(prevFieldValue);
          await this._setCharacter(restored);
        },
      });
      return { ok: true, undoId, summary: `캐릭터 로어북 #${idx + 1}의 ${fieldKey}을(를) 수정했습니다.` };
    }

    if (kind === 'chat_lorebook') {
      const fieldKey = target.fieldKey || 'content';
      assertAllowedFieldKey('chat_lorebook', fieldKey);
      const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, '적용');
      const idx = target.loreIndex;
      if (!Number.isInteger(idx) || !chat.localLore?.[idx]) {
        throw new Error('수정할 채팅 로어북 인덱스가 올바르지 않습니다.');
      }
      const prevFieldValue = clone(chat.localLore[idx][fieldKey]);

      const nextChat = clone(chat);
      const nextStr = compute(String(nextChat.localLore[idx][fieldKey] ?? ''), '채팅 로어북');
      if (fieldKey === 'insertorder') {
        const num = Number(nextStr.trim());
        if (!Number.isFinite(num)) throw new Error('배치 순서(insertorder)는 유한한 숫자여야 합니다.');
        nextChat.localLore[idx][fieldKey] = num;
      } else {
        nextChat.localLore[idx][fieldKey] = nextStr;
      }
      await this._setChat(charIndex, chatIndex, nextChat);

      const undoId = this._pushUndo({
        label: `채팅 로어북 #${idx + 1} 수정`,
        restore: async () => {
          const latestChat = await this._readChatAt(charIndex, chatIndex);
          if (!latestChat?.localLore?.[idx]) throw new Error('되돌릴 채팅 로어북 항목을 찾을 수 없습니다.');
          const restored = clone(latestChat);
          restored.localLore[idx][fieldKey] = clone(prevFieldValue);
          await this._setChat(charIndex, chatIndex, restored);
        },
      });
      return { ok: true, undoId, summary: `채팅 로어북 #${idx + 1}의 ${fieldKey}을(를) 수정했습니다.` };
    }

    if (kind === 'char_lua' || kind === 'module_lua') {
      return await this._applyUpdateLua({
        scope: kind === 'module_lua' ? 'module' : 'character',
        moduleIndex: target.moduleIndex,
        edits: proposal.action === 'patch_text' ? proposal.edits : undefined,
        code: proposal.action === 'replace_text' ? proposal.content : undefined,
      }, target, options);
    }

    if (kind === 'persona') {
      const fieldKey = target.fieldKey || 'personaPrompt';
      assertAllowedFieldKey('persona', fieldKey);
      return await this._applyUpdatePersona({
        personaIndex: target.personaIndex,
        [fieldKey]: proposal.action === 'replace_text' ? proposal.content : undefined,
        edits: proposal.action === 'patch_text' && fieldKey === 'personaPrompt' ? proposal.edits : undefined,
        fieldKey,
        fieldEdits: proposal.action === 'patch_text' ? proposal.edits : undefined,
      }, target, options);
    }

    if (kind === 'module_field') {
      const fieldKey = target.fieldKey || 'backgroundEmbedding';
      assertAllowedFieldKey('module_field', fieldKey);
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
      const modIdx = this._resolveWriteModuleIndex(modules, proposal, target, options);
      if (!modules[modIdx]) throw new Error('수정할 모듈을 찾을 수 없습니다.');
      const moduleId = modules[modIdx].id;
      const moduleName = modules[modIdx].name || '무제';
      const hadKey = Object.hasOwn(modules[modIdx], fieldKey);
      const prevValue = clone(modules[modIdx][fieldKey]);

      const nextModules = clone(modules);
      nextModules[modIdx][fieldKey] = compute(String(nextModules[modIdx][fieldKey] ?? ''), `모듈 ${fieldKey}`);
      await this.writeDbSubset({ modules: nextModules });

      const undoId = this._pushUndo({
        label: `모듈 "${moduleName}" ${fieldKey} 수정`,
        restore: async () => {
          const { modules: latestModules } = await this.readModules();
          const idx = moduleId ? latestModules.findIndex(m => m.id === moduleId) : modIdx;
          if (idx === -1 || !latestModules[idx]) throw new Error('되돌릴 모듈을 찾을 수 없습니다.');
          const restored = clone(latestModules);
          if (hadKey) restored[idx][fieldKey] = clone(prevValue);
          else delete restored[idx][fieldKey];
          await this.writeDbSubset({ modules: restored });
        },
      });
      return {
        ok: true,
        undoId,
        summary: `${MODULE_FIELD_META[fieldKey]?.label || `모듈 ${fieldKey}`} (${moduleName})에 적용했습니다.`,
      };
    }

    if (kind === 'module_lorebook') {
      const fieldKey = target.fieldKey || 'content';
      assertAllowedFieldKey('module_lorebook', fieldKey);
      return await this._applyUpdateLorebook({
        scope: 'module',
        moduleIndex: target.moduleIndex,
        loreIndex: target.loreIndex,
        fieldKey,
        edits: proposal.action === 'patch_text' ? proposal.edits : undefined,
        [fieldKey]: proposal.action === 'replace_text' ? proposal.content : undefined,
      }, target, options);
    }

    if (kind === 'config' && target.fieldKey && ALLOWED_CONFIG_KEYS.includes(target.fieldKey)) {
      const cfg = await this.readAllowedConfig();
      if (!cfg) throw new Error(DB_PERMISSION_ERROR);
      const nextVal = compute(String(cfg[target.fieldKey] ?? ''), target.fieldKey);
      return await this._applyUpdateConfig({ changes: { [target.fieldKey]: nextVal } });
    }

    throw new Error(`현재 대상(${kind || '없음'})에는 직접 텍스트 적용을 지원하지 않습니다. 상단에서 대상을 선택해 주세요.`);
  }

  async _applyCreateLorebook(proposal, target, options = {}) {
    const scope = proposal.scope || target.loreScope || 'character';
    const entry = normalizeLorebookEntry(proposal);

    if (scope === 'chat') {
      const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, '적용');
      const nextChat = clone(chat);
      nextChat.localLore = Array.isArray(nextChat.localLore) ? nextChat.localLore : [];
      const insertedIndex = nextChat.localLore.length;
      nextChat.localLore.push(entry);
      await this._setChat(charIndex, chatIndex, nextChat);

      const snapshotEntry = clone(entry);
      const undoId = this._pushUndo({
        label: `채팅 로어북 생성 (${entry.comment})`,
        restore: async () => {
          const latestChat = await this._readChatAt(charIndex, chatIndex);
          if (!latestChat) throw new Error('되돌릴 채팅을 찾을 수 없습니다.');
          const restored = clone(latestChat);
          removeCreatedItem(restored.localLore, insertedIndex, e =>
            e && e.comment === snapshotEntry.comment && e.key === snapshotEntry.key && e.content === snapshotEntry.content
          );
          await this._setChat(charIndex, chatIndex, restored);
        },
      });
      return { ok: true, undoId, summary: `새 채팅 로어북 "${entry.comment}"을(를) 추가했습니다.` };
    }

    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
      const modIdx = this._resolveWriteModuleIndex(modules, proposal, target, options);
      if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
      const moduleId = modules[modIdx].id;
      const nextModules = clone(modules);
      nextModules[modIdx].lorebook = Array.isArray(nextModules[modIdx].lorebook) ? nextModules[modIdx].lorebook : [];
      const insertedIndex = nextModules[modIdx].lorebook.length;
      nextModules[modIdx].lorebook.push(entry);
      await this.writeDbSubset({ modules: nextModules });

      const snapshotEntry = clone(entry);
      const undoId = this._pushUndo({
        label: `모듈 로어북 생성 (${entry.comment})`,
        restore: async () => {
          const { modules: latestModules } = await this.readModules();
          const idx = latestModules.findIndex(m => m.id === moduleId);
          if (idx === -1) throw new Error('되돌릴 모듈을 찾을 수 없습니다.');
          const restored = clone(latestModules);
          removeCreatedItem(restored[idx].lorebook, insertedIndex, e =>
            e && e.comment === snapshotEntry.comment && e.key === snapshotEntry.key && e.content === snapshotEntry.content
          );
          await this.writeDbSubset({ modules: restored });
        },
      });
      return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}"에 새 로어북 "${entry.comment}"을(를) 추가했습니다.` };
    }

    // Default: character lorebook
    const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
    const charBinding = { charIndex, ...getCharIdentity(char) };
    const nextChar = clone(char);
    nextChar.globalLore = Array.isArray(nextChar.globalLore) ? nextChar.globalLore : [];
    const insertedIndex = nextChar.globalLore.length;
    nextChar.globalLore.push(entry);
    await this._setCharacter(nextChar);

    const snapshotEntry = clone(entry);
    const undoId = this._pushUndo({
      label: `캐릭터 로어북 생성 (${entry.comment})`,
      restore: async () => {
        const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
        const restored = clone(latest);
        removeCreatedItem(restored.globalLore, insertedIndex, e =>
          e && e.comment === snapshotEntry.comment && e.key === snapshotEntry.key && e.content === snapshotEntry.content
        );
        await this._setCharacter(restored);
      },
    });
    return { ok: true, undoId, summary: `새 캐릭터 로어북 "${entry.comment}"을(를) 추가했습니다.` };
  }

  async _applyUpdateLorebook(proposal, target, options = {}) {
    const scope = proposal.scope || target.loreScope || 'character';
    const loreIndex = Number.isInteger(proposal.loreIndex) ? proposal.loreIndex : target.loreIndex;
    if (!Number.isInteger(loreIndex) || loreIndex < 0) {
      throw new Error('수정할 로어북 인덱스(loreIndex)가 필요합니다.');
    }
    const fieldKey = proposal.fieldKey || 'content';
    assertAllowedFieldKey('char_lorebook', fieldKey);

    const mutateEntry = (existing) => {
      if (!proposal.edits && (proposal[fieldKey] !== undefined || (fieldKey === 'content' && proposal.content !== undefined))) {
        const truncErr = checkTruncationGuard(String(existing[fieldKey] ?? ''), '로어북 전체 덮어쓰기');
        if (truncErr) throw new Error(truncErr);
      }
      const next = normalizeLorebookEntry(proposal, existing);
      if (proposal.edits) {
        const nextStr = applyTextEdits(String(existing[fieldKey] ?? ''), proposal.edits, '로어북');
        if (fieldKey === 'insertorder') {
          const num = Number(nextStr.trim());
          if (!Number.isFinite(num)) throw new Error('배치 순서(insertorder)는 유한한 숫자여야 합니다.');
          next[fieldKey] = num;
        } else {
          next[fieldKey] = nextStr;
        }
      }
      return next;
    };

    if (scope === 'chat') {
      const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, '적용');
      if (!chat?.localLore?.[loreIndex]) throw new Error(`채팅 로어북 #${loreIndex + 1}을(를) 찾을 수 없습니다.`);
      const prevEntry = clone(chat.localLore[loreIndex]);
      const nextChat = clone(chat);
      nextChat.localLore[loreIndex] = mutateEntry(nextChat.localLore[loreIndex]);
      await this._setChat(charIndex, chatIndex, nextChat);

      const undoId = this._pushUndo({
        label: `채팅 로어북 #${loreIndex + 1} 수정`,
        restore: async () => {
          const latestChat = await this._readChatAt(charIndex, chatIndex);
          if (!latestChat?.localLore?.[loreIndex]) throw new Error('되돌릴 채팅 로어북 항목을 찾을 수 없습니다.');
          const restored = clone(latestChat);
          restored.localLore[loreIndex] = clone(prevEntry);
          await this._setChat(charIndex, chatIndex, restored);
        },
      });
      return { ok: true, undoId, summary: `채팅 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
    }

    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
      const modIdx = this._resolveWriteModuleIndex(modules, proposal, target, options);
      if (!modules[modIdx]?.lorebook?.[loreIndex]) throw new Error('대상 모듈 로어북 항목을 찾을 수 없습니다.');
      const moduleId = modules[modIdx].id;
      const prevEntry = clone(modules[modIdx].lorebook[loreIndex]);
      const nextModules = clone(modules);
      nextModules[modIdx].lorebook[loreIndex] = mutateEntry(nextModules[modIdx].lorebook[loreIndex]);
      await this.writeDbSubset({ modules: nextModules });

      const undoId = this._pushUndo({
        label: `모듈 로어북 #${loreIndex + 1} 수정`,
        restore: async () => {
          const { modules: latestModules } = await this.readModules();
          const idx = latestModules.findIndex(m => m.id === moduleId);
          if (idx === -1 || !latestModules[idx].lorebook?.[loreIndex]) throw new Error('되돌릴 모듈 로어북 항목을 찾을 수 없습니다.');
          const restored = clone(latestModules);
          restored[idx].lorebook[loreIndex] = clone(prevEntry);
          await this.writeDbSubset({ modules: restored });
        },
      });
      return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}" 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
    }

    const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
    if (!char?.globalLore?.[loreIndex]) throw new Error(`캐릭터 로어북 #${loreIndex + 1}을(를) 찾을 수 없습니다.`);
    const charBinding = { charIndex, ...getCharIdentity(char) };
    const prevEntry = clone(char.globalLore[loreIndex]);
    const nextChar = clone(char);
    nextChar.globalLore[loreIndex] = mutateEntry(nextChar.globalLore[loreIndex]);
    await this._setCharacter(nextChar);

    const undoId = this._pushUndo({
      label: `캐릭터 로어북 #${loreIndex + 1} 수정`,
      restore: async () => {
        const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
        if (!latest.globalLore?.[loreIndex]) throw new Error('되돌릴 캐릭터 로어북 항목을 찾을 수 없습니다.');
        const restored = clone(latest);
        restored.globalLore[loreIndex] = clone(prevEntry);
        await this._setCharacter(restored);
      },
    });
    return { ok: true, undoId, summary: `캐릭터 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
  }

  async _applyUpdateLua(proposal, target, options = {}) {
    const scope = proposal.scope || (target.targetKind === 'module_lua' ? 'module' : 'character');

    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
      const modIdx = this._resolveWriteModuleIndex(modules, proposal, target, options);
      if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
      const luaInfo = extractLuaFromTriggers(modules[modIdx].trigger);
      if (luaInfo.hasOtherTriggers && options.requireDestructiveConfirm && !options.destructiveConfirmed) {
        throw new Error('기존 V1/V2 트리거 삭제 확인 체크가 필요합니다.');
      }
      if (!proposal.edits) {
        const truncErr = checkTruncationGuard(luaInfo.code, '모듈 Lua 전체 교체');
        if (truncErr) throw new Error(truncErr);
      }

      const moduleId = modules[modIdx].id;
      const prevTriggers = clone(modules[modIdx].trigger);
      const nextModules = clone(modules);
      const nextCode = proposal.edits
        ? applyTextEdits(luaInfo.code, proposal.edits, '모듈 Lua')
        : String(proposal.code ?? proposal.content ?? '');
      nextModules[modIdx].trigger = buildLuaTriggers(nextCode);
      await this.writeDbSubset({ modules: nextModules });

      const undoId = this._pushUndo({
        label: `모듈 Lua 수정 (${nextModules[modIdx].name})`,
        restore: async () => {
          const { modules: latestModules } = await this.readModules();
          const idx = latestModules.findIndex(m => m.id === moduleId);
          if (idx === -1) throw new Error('되돌릴 모듈을 찾을 수 없습니다.');
          const restored = clone(latestModules);
          restored[idx].trigger = clone(prevTriggers);
          await this.writeDbSubset({ modules: restored });
        },
      });
      return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}" Lua 스크립트를 저장했습니다.` };
    }

    const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
    const luaInfo = extractLuaFromTriggers(char.triggerscript);
    if (luaInfo.hasOtherTriggers && options.requireDestructiveConfirm && !options.destructiveConfirmed) {
      throw new Error('기존 V1/V2 트리거 삭제 확인 체크가 필요합니다.');
    }
    if (!proposal.edits) {
      const truncErr = checkTruncationGuard(luaInfo.code, '캐릭터 Lua 전체 교체');
      if (truncErr) throw new Error(truncErr);
    }

    const charBinding = { charIndex, ...getCharIdentity(char) };
    const prevTriggers = clone(char.triggerscript);
    const nextChar = clone(char);
    const nextCode = proposal.edits
      ? applyTextEdits(luaInfo.code, proposal.edits, '캐릭터 Lua')
      : String(proposal.code ?? proposal.content ?? '');
    nextChar.triggerscript = buildLuaTriggers(nextCode);
    await this._setCharacter(nextChar);

    const undoId = this._pushUndo({
      label: `캐릭터 Lua 수정 (${nextChar.name})`,
      restore: async () => {
        const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
        const restored = clone(latest);
        restored.triggerscript = clone(prevTriggers);
        await this._setCharacter(restored);
      },
    });
    return { ok: true, undoId, summary: `캐릭터 "${nextChar.name}" Lua 트리거 스크립트를 저장했습니다.` };
  }

  async _applyUpsertRegex(proposal, target, options = {}) {
    const scope = proposal.scope || (target.targetKind === 'module_regex' ? 'module' : 'character');
    const idx = Number.isInteger(proposal.regexIndex) ? proposal.regexIndex : null;

    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
      const modIdx = this._resolveWriteModuleIndex(modules, proposal, target, options);
      if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
      const moduleId = modules[modIdx].id;
      const nextModules = clone(modules);
      nextModules[modIdx].regex = Array.isArray(nextModules[modIdx].regex) ? nextModules[modIdx].regex : [];

      const isUpdate = idx !== null && Boolean(nextModules[modIdx].regex[idx]);
      const prevEntry = isUpdate ? clone(nextModules[modIdx].regex[idx]) : null;
      const savedEntry = isUpdate
        ? normalizeRegexEntry(proposal, nextModules[modIdx].regex[idx])
        : normalizeRegexEntry(proposal);
      const insertedIndex = isUpdate ? idx : nextModules[modIdx].regex.length;
      if (isUpdate) nextModules[modIdx].regex[idx] = savedEntry;
      else nextModules[modIdx].regex.push(savedEntry);

      await this.writeDbSubset({ modules: nextModules });
      const snapshotEntry = clone(savedEntry);
      const undoId = this._pushUndo({
        label: `모듈 정규식 저장 (${proposal.comment || 'Regex'})`,
        restore: async () => {
          const { modules: latestModules } = await this.readModules();
          const mIdx = latestModules.findIndex(m => m.id === moduleId);
          if (mIdx === -1) throw new Error('되돌릴 모듈을 찾을 수 없습니다.');
          const restored = clone(latestModules);
          if (isUpdate) {
            if (!restored[mIdx].regex?.[idx]) throw new Error('되돌릴 모듈 정규식 항목을 찾을 수 없습니다.');
            restored[mIdx].regex[idx] = clone(prevEntry);
          } else {
            removeCreatedItem(restored[mIdx].regex, insertedIndex, e =>
              e && e.comment === snapshotEntry.comment && e.in === snapshotEntry.in && e.out === snapshotEntry.out
            );
          }
          await this.writeDbSubset({ modules: restored });
        },
      });
      return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}" 정규식을 저장했습니다.` };
    }

    const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
    const charBinding = { charIndex, ...getCharIdentity(char) };
    const nextChar = clone(char);
    nextChar.customscript = Array.isArray(nextChar.customscript) ? nextChar.customscript : [];

    const isUpdate = idx !== null && Boolean(nextChar.customscript[idx]);
    const prevEntry = isUpdate ? clone(nextChar.customscript[idx]) : null;
    const savedEntry = isUpdate
      ? normalizeRegexEntry(proposal, nextChar.customscript[idx])
      : normalizeRegexEntry(proposal);
    const insertedIndex = isUpdate ? idx : nextChar.customscript.length;
    if (isUpdate) nextChar.customscript[idx] = savedEntry;
    else nextChar.customscript.push(savedEntry);

    await this._setCharacter(nextChar);
    const snapshotEntry = clone(savedEntry);
    const undoId = this._pushUndo({
      label: `캐릭터 정규식 저장 (${proposal.comment || 'Regex'})`,
      restore: async () => {
        const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
        const restored = clone(latest);
        if (isUpdate) {
          if (!restored.customscript?.[idx]) throw new Error('되돌릴 캐릭터 정규식 항목을 찾을 수 없습니다.');
          restored.customscript[idx] = clone(prevEntry);
        } else {
          removeCreatedItem(restored.customscript, insertedIndex, e =>
            e && e.comment === snapshotEntry.comment && e.in === snapshotEntry.in && e.out === snapshotEntry.out
          );
        }
        await this._setCharacter(restored);
      },
    });
    return { ok: true, undoId, summary: `캐릭터 정규식 "${proposal.comment || 'New Regex'}"을(를) 저장했습니다.` };
  }

  async _bindPersonaToActiveChat(personaId) {
    const { chat, charIndex, chatIndex } = await this.readActiveChat();
    if (!chat) return null;
    const hadKey = Object.hasOwn(chat, 'bindedPersona');
    const prevBindedPersona = chat.bindedPersona;
    const nextChat = clone(chat);
    nextChat.bindedPersona = personaId;
    await this._setChat(charIndex, chatIndex, nextChat);
    return async () => {
      const latestChat = await this._readChatAt(charIndex, chatIndex);
      if (!latestChat) return;
      const restored = clone(latestChat);
      if (hadKey) restored.bindedPersona = prevBindedPersona;
      else delete restored.bindedPersona;
      await this._setChat(charIndex, chatIndex, restored);
    };
  }

  async _applyCreatePersona(proposal, options) {
    const { personas, permissionDenied } = await this.readPersonas();
    if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
    const nextPersonas = clone(personas);
    const newPersona = {
      name: String(proposal.name || 'New Persona'),
      personaPrompt: String(proposal.personaPrompt ?? proposal.content ?? ''),
      icon: String(proposal.icon || ''),
      note: String(proposal.note || ''),
      largePortrait: Boolean(proposal.largePortrait),
      id: makeUuid(),
    };
    const insertedIndex = nextPersonas.length;
    nextPersonas.push(newPersona);
    await this.writeDbSubset({ personas: nextPersonas });

    let restoreChat = null;
    const shouldBind = Boolean(options.bindToCurrentChat ?? proposal.bindToCurrentChat);
    if (shouldBind) {
      restoreChat = await this._bindPersonaToActiveChat(newPersona.id);
    }

    const createdId = newPersona.id;
    const undoId = this._pushUndo({
      label: `새 페르소나 생성 (${newPersona.name})`,
      restore: async () => {
        const { personas: latestPersonas } = await this.readPersonas();
        const restored = clone(latestPersonas);
        removeCreatedItem(restored, insertedIndex, p => p && p.id === createdId);
        await this.writeDbSubset({ personas: restored });
        if (restoreChat) await restoreChat();
      },
    });
    return {
      ok: true,
      undoId,
      personaId: newPersona.id,
      summary: shouldBind && restoreChat
        ? `새 페르소나 "${newPersona.name}"을(를) 만들고 현재 채팅에 바인딩했습니다.`
        : `새 페르소나 "${newPersona.name}"을(를) 생성했습니다. 페르소나 설정에서 선택해 사용할 수 있습니다.`,
    };
  }

  async _applyUpdatePersona(proposal, target, options) {
    const { personas, selectedPersona, permissionDenied } = await this.readPersonas();
    if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
    const idx = Number.isInteger(proposal.personaIndex)
      ? proposal.personaIndex
      : (Number.isInteger(target.personaIndex) ? target.personaIndex : selectedPersona);
    if (!personas[idx]) throw new Error(`페르소나 #${idx + 1}을(를) 찾을 수 없습니다.`);

    if (proposal.fieldKey !== undefined) {
      assertAllowedFieldKey('persona', proposal.fieldKey);
    }

    const prevPersona = clone(personas[idx]);
    const nextPersonas = clone(personas);
    const cur = nextPersonas[idx];
    if (!cur.id) cur.id = makeUuid();

    if (!proposal.edits && !proposal.fieldEdits) {
      const checkKey = proposal.fieldKey || 'personaPrompt';
      if (proposal[checkKey] !== undefined) {
        const truncErr = checkTruncationGuard(String(cur[checkKey] ?? ''), '페르소나 전체 덮어쓰기');
        if (truncErr) throw new Error(truncErr);
      }
    }

    if (proposal.name !== undefined) cur.name = String(proposal.name);
    if (proposal.note !== undefined) cur.note = String(proposal.note);
    if (proposal.largePortrait !== undefined) cur.largePortrait = Boolean(proposal.largePortrait);
    if (proposal.edits) {
      cur.personaPrompt = applyTextEdits(String(cur.personaPrompt ?? ''), proposal.edits, '페르소나 프롬프트');
    } else if (proposal.fieldEdits && proposal.fieldKey) {
      cur[proposal.fieldKey] = applyTextEdits(String(cur[proposal.fieldKey] ?? ''), proposal.fieldEdits, `페르소나 ${proposal.fieldKey}`);
    } else if (proposal.personaPrompt !== undefined) {
      cur.personaPrompt = String(proposal.personaPrompt);
    }

    await this.writeDbSubset({ personas: nextPersonas });

    let restoreChat = null;
    const shouldBind = Boolean(options.bindToCurrentChat ?? proposal.bindToCurrentChat);
    if (shouldBind) {
      restoreChat = await this._bindPersonaToActiveChat(cur.id);
    }

    const savedId = cur.id;
    const undoId = this._pushUndo({
      label: `페르소나 수정 (${cur.name})`,
      restore: async () => {
        const { personas: latestPersonas } = await this.readPersonas();
        const restored = clone(latestPersonas);
        let targetIdx = restored.findIndex(p => p && p.id === savedId);
        if (targetIdx === -1 && restored[idx]) targetIdx = idx;
        if (targetIdx === -1) throw new Error('되돌릴 페르소나를 찾을 수 없습니다.');
        restored[targetIdx] = clone(prevPersona);
        await this.writeDbSubset({ personas: restored });
        if (restoreChat) await restoreChat();
      },
    });
    return {
      ok: true,
      undoId,
      summary: shouldBind && restoreChat
        ? `페르소나 "${cur.name}"을(를) 수정하고 현재 채팅에 바인딩했습니다.`
        : `페르소나 "${cur.name}"을(를) 수정했습니다.`,
    };
  }

  async _applyUpdateConfig(proposal) {
    const changes = proposal.changes || {};
    const keys = Object.keys(changes);
    if (keys.length === 0) throw new Error('변경할 설정 항목이 없습니다.');

    const cfg = await this.readAllowedConfig();
    if (!cfg) throw new Error(DB_PERMISSION_ERROR);

    const prev = {};
    const next = {};
    for (const k of keys) {
      if (!ALLOWED_CONFIG_KEYS.includes(k)) {
        throw new Error(`허용되지 않는 설정 키입니다: ${k}`);
      }
      const expectedType = CONFIG_KEY_TYPES[k];
      const val = changes[k];
      if (expectedType === 'array') {
        if (!Array.isArray(val)) throw new Error(`${k}는 배열이어야 합니다.`);
      } else if (expectedType === 'number') {
        if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error(`${k}는 유한한 숫자여야 합니다.`);
      } else if (expectedType === 'boolean') {
        if (typeof val !== 'boolean') throw new Error(`${k}는 boolean이어야 합니다.`);
      } else if (expectedType === 'string') {
        if (typeof val !== 'string') throw new Error(`${k}는 문자열이어야 합니다.`);
      } else if (expectedType === 'object') {
        if (!val || typeof val !== 'object' || Array.isArray(val)) throw new Error(`${k}는 객체여야 합니다.`);
      }
      prev[k] = clone(cfg[k]);
      next[k] = val;
    }

    await this.writeDbSubset(next);
    const undoId = this._pushUndo({
      label: `설정 변경 (${keys.join(', ')})`,
      restore: async () => { await this.writeDbSubset(prev); },
    });
    return { ok: true, undoId, summary: `설정(${keys.join(', ')})을 적용했습니다.` };
  }

  async undo(undoId = null) {
    if (this.undoStack.length === 0) throw new Error('되돌릴 내역이 없습니다.');
    let idx = this.undoStack.length - 1;
    if (undoId) {
      idx = this.undoStack.findIndex(item => item.id === undoId);
      if (idx === -1) throw new Error('해당 되돌리기 기록을 찾을 수 없습니다.');
    }
    const [entry] = this.undoStack.splice(idx, 1);
    await entry.restore();
    return { ok: true, label: entry.label };
  }
}

export { extractLuaFromTriggers, buildLuaTriggers, normalizeLorebookEntry, normalizeRegexEntry, resolveModuleIndex, HostAdapter };
