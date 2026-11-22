import { ALLOWED_CONFIG_KEYS, CONFIG_KEY_TYPES, CHAR_FIELD_META } from './version.js';
import { applyTextEdits } from './text-edits.js';

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

/**
 * Extracts Lua code from RisuAI's triggerscript array (both character.triggerscript and module.trigger).
 */
function extractLuaFromTriggers(triggers) {
  if (!Array.isArray(triggers) || triggers.length === 0) {
    return { isLua: false, code: '', hasOtherTriggers: false };
  }
  const firstEffect = triggers[0]?.effect?.[0];
  if (firstEffect && firstEffect.type === 'triggerlua') {
    return { isLua: true, code: String(firstEffect.code ?? ''), hasOtherTriggers: false };
  }
  return { isLua: false, code: '', hasOtherTriggers: true };
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

/**
 * Cross-fork safe adapter for RisuAI Plugin API v3.
 * Works with kwaroran/Risuai, PocketRisu, RisuBard, HaejeokRisuai, RisuNest, and RisuAI-Hardened.
 */
class HostAdapter {
  constructor(api) {
    this.api = api;
    this.undoStack = [];
    this.maxUndo = 20;
  }

  detectHostFlavor() {
    if (typeof this.api?.risunestCallHostTool === 'function') {
      return { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
    }
    if (typeof this.api?._getBardWikiDocuments === 'function') {
      return { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
    }
    return { name: 'RisuAI / Fork', activePersonaAutoSyncs: false, syncLiteCharError: false };
  }

  async _getCharacter() {
    if (typeof this.api.getCharacter === 'function') return await this.api.getCharacter();
    if (typeof this.api.getChar === 'function') return await this.api.getChar();
    return null;
  }

  async _setCharacter(char) {
    if (typeof this.api.setCharacter === 'function') return await this.api.setCharacter(char);
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
   * Reads active chat via getChatFromIndex first (required by PocketRisu for unopened _placeholder chats),
   * falling back to char.chats[chatPage].
   */
  async readActiveChat() {
    const { char, charIndex, chatIndex } = await this.readActiveCharacter();
    if (!char) return { chat: null, charIndex, chatIndex };
    const resolvedChatIdx = Number.isInteger(chatIndex) ? chatIndex : (char.chatPage ?? 0);
    if (
      Number.isInteger(charIndex) &&
      charIndex >= 0 &&
      typeof this.api.getChatFromIndex === 'function'
    ) {
      try {
        const fetched = await this.api.getChatFromIndex(charIndex, resolvedChatIdx);
        if (fetched && !fetched._placeholder) {
          return { chat: fetched, charIndex, chatIndex: resolvedChatIdx };
        }
      } catch {}
    }
    const fallback = char.chats?.[resolvedChatIdx] ?? null;
    if (fallback?._placeholder) {
      throw new Error('채팅 본문이 아직 서버에서 로드되지 않았습니다(_placeholder). 채팅을 연 뒤 다시 시도해 주세요.');
    }
    return { chat: fallback, charIndex, chatIndex: resolvedChatIdx };
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
      await this.api.setChatToIndex(charIndex, chatIndex, nextChat);
      return;
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
   * Resolves the current source content and rich metadata for any target descriptor.
   */
  async readTargetSnapshot(target) {
    const t = target || { targetKind: 'general' };

    if (t.targetKind === 'char_field') {
      const { char } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const fieldKey = t.fieldKey || 'desc';
      const content = String(char[fieldKey] ?? '');
      return {
        ok: true,
        target: { ...t, fieldKey },
        label: CHAR_FIELD_META[fieldKey]?.label || fieldKey,
        content,
        charName: char.name || '(이름 없음)',
      };
    }

    if (t.targetKind === 'char_lorebook') {
      const { char } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const list = Array.isArray(char.globalLore) ? char.globalLore : [];
      const idx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
      const entry = idx !== null && list[idx] ? list[idx] : null;
      const fieldKey = t.fieldKey || 'content';
      return {
        ok: true,
        target: { ...t, loreIndex: idx, fieldKey },
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
      const { chat } = await this.readActiveChat();
      if (!chat) return { ok: false, reason: '활성 채팅을 찾을 수 없습니다.', content: '' };
      const list = Array.isArray(chat.localLore) ? chat.localLore : [];
      const idx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
      const entry = idx !== null && list[idx] ? list[idx] : null;
      const fieldKey = t.fieldKey || 'content';
      return {
        ok: true,
        target: { ...t, loreIndex: idx, fieldKey },
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
      const { char } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const lua = extractLuaFromTriggers(char.triggerscript);
      return {
        ok: true,
        target: { ...t, fieldKey: 'code' },
        label: `캐릭터 Lua 트리거 (${char.name || '무제'})`,
        content: lua.code,
        isLua: lua.isLua,
        hasOtherTriggers: lua.hasOtherTriggers,
      };
    }

    if (t.targetKind === 'char_regex') {
      const { char } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const list = Array.isArray(char.customscript) ? char.customscript : [];
      const idx = Number.isInteger(t.regexIndex) ? t.regexIndex : null;
      const entry = idx !== null && list[idx] ? list[idx] : null;
      return {
        ok: true,
        target: { ...t, regexIndex: idx },
        label: entry ? `캐릭터 정규식 #${idx + 1} (${entry.comment || '무제'})` : `캐릭터 정규식 (${list.length}개)`,
        content: entry ? JSON.stringify(entry, null, 2) : '',
        entry,
        regexList: list.slice(0, 30),
      };
    }

    if (t.targetKind === 'persona') {
      const { personas, selectedPersona, permissionDenied } = await this.readPersonas();
      if (permissionDenied) return { ok: false, reason: 'DB 읽기 권한(db)이 필요합니다.', content: '' };
      const idx = Number.isInteger(t.personaIndex) ? t.personaIndex : selectedPersona;
      const entry = personas[idx] ?? null;
      const fieldKey = t.fieldKey || 'personaPrompt';
      return {
        ok: true,
        target: { ...t, personaIndex: idx, fieldKey },
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

    if (t.targetKind === 'module_lorebook' || t.targetKind === 'module_lua' || t.targetKind === 'module_regex') {
      const { modules, enabledModules, permissionDenied } = await this.readModules();
      if (permissionDenied) return { ok: false, reason: 'DB 읽기 권한(db)이 필요합니다.', content: '' };
      const modIdx = Number.isInteger(t.moduleIndex) ? t.moduleIndex : (modules.length > 0 ? 0 : null);
      const mod = modIdx !== null ? modules[modIdx] : null;
      if (!mod) return { ok: true, target: t, label: '설치된 모듈 없음', content: '', modulesSummary: [] };

      let content = '';
      let label = `모듈: ${mod.name}`;
      if (t.targetKind === 'module_lua') {
        content = extractLuaFromTriggers(mod.trigger).code;
        label = `모듈 Lua (${mod.name})`;
      } else if (t.targetKind === 'module_regex') {
        const list = Array.isArray(mod.regex) ? mod.regex : [];
        const rIdx = Number.isInteger(t.regexIndex) ? t.regexIndex : null;
        content = rIdx !== null && list[rIdx] ? JSON.stringify(list[rIdx], null, 2) : '';
        label = `모듈 정규식 (${mod.name}, ${list.length}개)`;
      } else {
        const list = Array.isArray(mod.lorebook) ? mod.lorebook : [];
        const lIdx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
        const entry = lIdx !== null && list[lIdx] ? list[lIdx] : null;
        const fieldKey = t.fieldKey || 'content';
        content = entry ? String(entry[fieldKey] ?? '') : '';
        label = entry ? `모듈 로어북 (${mod.name} #${lIdx + 1})` : `모듈 로어북 (${mod.name}, ${list.length}개)`;
      }
      return {
        ok: true,
        target: { ...t, moduleIndex: modIdx },
        label,
        content,
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
      if (!cfg) return { ok: false, reason: 'DB 읽기 권한(db)이 필요합니다.', content: '' };
      const fieldKey = t.fieldKey || null;
      return {
        ok: true,
        target: { ...t, fieldKey },
        label: fieldKey ? `설정 · ${fieldKey}` : 'RisuAI 설정 (허용 키)',
        content: fieldKey ? String(cfg[fieldKey] ?? '') : JSON.stringify(cfg, null, 2),
        config: cfg,
      };
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
   * Computes the resulting text & preview before mutating anything (dry run for Review UI).
   */
  async previewProposal(proposal, activeTarget) {
    const target = { ...(activeTarget || {}), ...(proposal.target || {}) };

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
      const before = snap.content;
      try {
        const after = proposal.action === 'patch_text'
          ? applyTextEdits(before, proposal.edits, proposal.title || snap.label)
          : String(proposal.content ?? '');
        return { ok: true, before, after, label: snap.label, target: snap.target };
      } catch (err) {
        return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
      }
    }

    if (proposal.action === 'update_lua') {
      const scope = proposal.scope === 'module' ? 'module_lua' : 'char_lua';
      const snap = await this.readTargetSnapshot({
        targetKind: scope,
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      const before = snap.content;
      try {
        const after = proposal.edits
          ? applyTextEdits(before, proposal.edits, 'Lua 스크립트')
          : String(proposal.code ?? proposal.content ?? '');
        return {
          ok: true,
          before,
          after,
          label: snap.label,
          target: snap.target,
          warning: snap.hasOtherTriggers
            ? '기존에 V1/V2 트리거가 설정되어 있습니다. 적용하면 Lua 트리거 모드로 전환됩니다.'
            : null,
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
      const snap = await this.readTargetSnapshot({
        targetKind,
        loreIndex,
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
        fieldKey,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      if (!snap.entry) return { ok: false, error: `수정할 로어북 항목(#${loreIndex})을 찾을 수 없습니다.` };
      const before = String(snap.entry[fieldKey] ?? '');
      let after = before;
      if (proposal.edits) {
        try {
          after = applyTextEdits(before, proposal.edits, '로어북');
        } catch (err) {
          return { ok: false, error: err.message, before, label: snap.label };
        }
      } else if (proposal[fieldKey] !== undefined) {
        after = String(proposal[fieldKey]);
      } else if (fieldKey === 'content' && proposal.content !== undefined) {
        after = String(proposal.content);
      }
      return { ok: true, before, after, label: snap.label, target: snap.target };
    }

    if (proposal.action === 'update_persona') {
      const snap = await this.readTargetSnapshot({
        targetKind: 'persona',
        personaIndex: proposal.personaIndex ?? target.personaIndex,
        fieldKey: 'personaPrompt',
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      if (!snap.entry) return { ok: false, error: '수정할 페르소나를 찾을 수 없습니다.' };
      const before = String(snap.entry.personaPrompt ?? '');
      let after = before;
      if (proposal.edits) {
        try {
          after = applyTextEdits(before, proposal.edits, '페르소나 프롬프트');
        } catch (err) {
          return { ok: false, error: err.message, before, label: snap.label };
        }
      } else if (proposal.personaPrompt !== undefined) {
        after = String(proposal.personaPrompt);
      }
      const flavor = this.detectHostFlavor();
      const isSelected = snap.target.personaIndex === snap.selectedPersona;
      const warning = isSelected && !flavor.activePersonaAutoSyncs && !proposal.bindToCurrentChat
        ? '원본 RisuAI/PocketRisu/RisuBard에서는 현재 선택된 전역 페르소나 UI가 즉시 갱신되지 않을 수 있습니다. "현재 채팅에 바인딩"을 체크하면 즉시 반영됩니다.'
        : null;
      return { ok: true, before, after, label: snap.label, target: snap.target, warning };
    }

    if (proposal.action === 'update_config') {
      const cfg = await this.readAllowedConfig();
      if (!cfg) return { ok: false, error: 'DB 읽기 권한(db)이 필요합니다.' };
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
      };
    }

    // Create actions (create_lorebook, create_persona, upsert_regex)
    return {
      ok: true,
      before: '',
      after: String(proposal.content ?? proposal.personaPrompt ?? proposal.out ?? JSON.stringify(proposal, null, 2)),
      label: proposal.title || proposal.comment || proposal.name || proposal.action,
    };
  }

  /**
   * Applies a validated proposal to RisuAI and pushes an Undo record.
   */
  async applyProposal(proposal, activeTarget, options = {}) {
    const target = { ...(activeTarget || {}), ...(proposal.target || {}) };

    switch (proposal.action) {
      case 'patch_text':
      case 'replace_text':
        return await this._applyTextTarget(proposal, target, options);
      case 'create_lorebook':
        return await this._applyCreateLorebook(proposal, target);
      case 'update_lorebook':
        return await this._applyUpdateLorebook(proposal, target);
      case 'update_lua':
        return await this._applyUpdateLua(proposal, target);
      case 'upsert_regex':
        return await this._applyUpsertRegex(proposal, target);
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
    const compute = (before, label) => (
      proposal.action === 'patch_text'
        ? applyTextEdits(before, proposal.edits, label)
        : String(proposal.content ?? '')
    );

    if (kind === 'char_field') {
      const { char } = await this.readActiveCharacter();
      if (!char) throw new Error('선택된 캐릭터가 없습니다.');
      const fieldKey = target.fieldKey || 'desc';
      const prevChar = clone(char);
      const nextChar = clone(char);
      nextChar[fieldKey] = compute(String(nextChar[fieldKey] ?? ''), fieldKey);
      await this._setCharacter(nextChar);
      const undoId = this._pushUndo({
        label: `캐릭터 ${fieldKey} 수정`,
        restore: async () => { await this._setCharacter(prevChar); },
      });
      return { ok: true, undoId, summary: `캐릭터 ${CHAR_FIELD_META[fieldKey]?.label || fieldKey}에 적용했습니다.` };
    }

    if (kind === 'char_lorebook') {
      const { char } = await this.readActiveCharacter();
      if (!char) throw new Error('선택된 캐릭터가 없습니다.');
      const idx = target.loreIndex;
      if (!Number.isInteger(idx) || !char.globalLore?.[idx]) {
        throw new Error('수정할 캐릭터 로어북 인덱스가 올바르지 않습니다.');
      }
      const fieldKey = target.fieldKey || 'content';
      const prevChar = clone(char);
      const nextChar = clone(char);
      nextChar.globalLore[idx][fieldKey] = compute(String(nextChar.globalLore[idx][fieldKey] ?? ''), '캐릭터 로어북');
      await this._setCharacter(nextChar);
      const undoId = this._pushUndo({
        label: `캐릭터 로어북 #${idx + 1} 수정`,
        restore: async () => { await this._setCharacter(prevChar); },
      });
      return { ok: true, undoId, summary: `캐릭터 로어북 #${idx + 1}의 ${fieldKey}을(를) 수정했습니다.` };
    }

    if (kind === 'chat_lorebook') {
      const { chat, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat) throw new Error('활성 채팅을 찾을 수 없습니다.');
      const idx = target.loreIndex;
      if (!Number.isInteger(idx) || !chat.localLore?.[idx]) {
        throw new Error('수정할 채팅 로어북 인덱스가 올바르지 않습니다.');
      }
      const fieldKey = target.fieldKey || 'content';
      const prevChat = clone(chat);
      const nextChat = clone(chat);
      nextChat.localLore[idx][fieldKey] = compute(String(nextChat.localLore[idx][fieldKey] ?? ''), '채팅 로어북');
      await this._setChat(charIndex, chatIndex, nextChat);
      const undoId = this._pushUndo({
        label: `채팅 로어북 #${idx + 1} 수정`,
        restore: async () => { await this._setChat(charIndex, chatIndex, prevChat); },
      });
      return { ok: true, undoId, summary: `채팅 로어북 #${idx + 1}의 ${fieldKey}을(를) 수정했습니다.` };
    }

    if (kind === 'char_lua' || kind === 'module_lua') {
      return await this._applyUpdateLua({
        scope: kind === 'module_lua' ? 'module' : 'character',
        moduleIndex: target.moduleIndex,
        edits: proposal.action === 'patch_text' ? proposal.edits : undefined,
        code: proposal.action === 'replace_text' ? proposal.content : undefined,
      }, target);
    }

    if (kind === 'persona') {
      const fieldKey = target.fieldKey || 'personaPrompt';
      return await this._applyUpdatePersona({
        personaIndex: target.personaIndex,
        [fieldKey]: proposal.action === 'replace_text' ? proposal.content : undefined,
        edits: proposal.action === 'patch_text' && fieldKey === 'personaPrompt' ? proposal.edits : undefined,
        fieldKey,
        fieldEdits: proposal.action === 'patch_text' ? proposal.edits : undefined,
      }, target, options);
    }

    if (kind === 'module_lorebook') {
      return await this._applyUpdateLorebook({
        scope: 'module',
        moduleIndex: target.moduleIndex,
        loreIndex: target.loreIndex,
        fieldKey: target.fieldKey || 'content',
        edits: proposal.action === 'patch_text' ? proposal.edits : undefined,
        content: proposal.action === 'replace_text' ? proposal.content : undefined,
      }, target);
    }

    if (kind === 'config' && target.fieldKey && ALLOWED_CONFIG_KEYS.includes(target.fieldKey)) {
      const cfg = await this.readAllowedConfig();
      if (!cfg) throw new Error('DB 읽기 권한(db)이 필요합니다.');
      const nextVal = compute(String(cfg[target.fieldKey] ?? ''), target.fieldKey);
      return await this._applyUpdateConfig({ changes: { [target.fieldKey]: nextVal } });
    }

    throw new Error(`현재 대상(${kind || '없음'})에는 직접 텍스트 적용을 지원하지 않습니다. 상단에서 대상을 선택해 주세요.`);
  }

  async _applyCreateLorebook(proposal, target) {
    const scope = proposal.scope || target.loreScope || 'character';
    const entry = normalizeLorebookEntry(proposal);

    if (scope === 'chat') {
      const { chat, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat) throw new Error('활성 채팅을 찾을 수 없습니다.');
      const prevChat = clone(chat);
      const nextChat = clone(chat);
      nextChat.localLore = Array.isArray(nextChat.localLore) ? nextChat.localLore : [];
      nextChat.localLore.push(entry);
      await this._setChat(charIndex, chatIndex, nextChat);
      const undoId = this._pushUndo({
        label: `채팅 로어북 생성 (${entry.comment})`,
        restore: async () => { await this._setChat(charIndex, chatIndex, prevChat); },
      });
      return { ok: true, undoId, summary: `새 채팅 로어북 "${entry.comment}"을(를) 추가했습니다.` };
    }

    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
      const modIdx = Number.isInteger(proposal.moduleIndex) ? proposal.moduleIndex : (target.moduleIndex ?? 0);
      if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
      const prevModules = clone(modules);
      const nextModules = clone(modules);
      nextModules[modIdx].lorebook = Array.isArray(nextModules[modIdx].lorebook) ? nextModules[modIdx].lorebook : [];
      nextModules[modIdx].lorebook.push(entry);
      await this.writeDbSubset({ modules: nextModules });
      const undoId = this._pushUndo({
        label: `모듈 로어북 생성 (${entry.comment})`,
        restore: async () => { await this.writeDbSubset({ modules: prevModules }); },
      });
      return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}"에 새 로어북 "${entry.comment}"을(를) 추가했습니다.` };
    }

    // Default: character lorebook
    const { char } = await this.readActiveCharacter();
    if (!char) throw new Error('선택된 캐릭터가 없습니다.');
    const prevChar = clone(char);
    const nextChar = clone(char);
    nextChar.globalLore = Array.isArray(nextChar.globalLore) ? nextChar.globalLore : [];
    nextChar.globalLore.push(entry);
    await this._setCharacter(nextChar);
    const undoId = this._pushUndo({
      label: `캐릭터 로어북 생성 (${entry.comment})`,
      restore: async () => { await this._setCharacter(prevChar); },
    });
    return { ok: true, undoId, summary: `새 캐릭터 로어북 "${entry.comment}"을(를) 추가했습니다.` };
  }

  async _applyUpdateLorebook(proposal, target) {
    const scope = proposal.scope || target.loreScope || 'character';
    const loreIndex = Number.isInteger(proposal.loreIndex) ? proposal.loreIndex : target.loreIndex;
    if (!Number.isInteger(loreIndex) || loreIndex < 0) {
      throw new Error('수정할 로어북 인덱스(loreIndex)가 필요합니다.');
    }

    const mutateEntry = (existing) => {
      const next = normalizeLorebookEntry(proposal, existing);
      if (proposal.edits) {
        const key = proposal.fieldKey || 'content';
        next[key] = applyTextEdits(String(existing[key] ?? ''), proposal.edits, '로어북');
      }
      return next;
    };

    if (scope === 'chat') {
      const { chat, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat?.localLore?.[loreIndex]) throw new Error(`채팅 로어북 #${loreIndex + 1}을(를) 찾을 수 없습니다.`);
      const prevChat = clone(chat);
      const nextChat = clone(chat);
      nextChat.localLore[loreIndex] = mutateEntry(nextChat.localLore[loreIndex]);
      await this._setChat(charIndex, chatIndex, nextChat);
      const undoId = this._pushUndo({
        label: `채팅 로어북 #${loreIndex + 1} 수정`,
        restore: async () => { await this._setChat(charIndex, chatIndex, prevChat); },
      });
      return { ok: true, undoId, summary: `채팅 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
    }

    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
      const modIdx = Number.isInteger(proposal.moduleIndex) ? proposal.moduleIndex : (target.moduleIndex ?? 0);
      if (!modules[modIdx]?.lorebook?.[loreIndex]) throw new Error('대상 모듈 로어북 항목을 찾을 수 없습니다.');
      const prevModules = clone(modules);
      const nextModules = clone(modules);
      nextModules[modIdx].lorebook[loreIndex] = mutateEntry(nextModules[modIdx].lorebook[loreIndex]);
      await this.writeDbSubset({ modules: nextModules });
      const undoId = this._pushUndo({
        label: `모듈 로어북 #${loreIndex + 1} 수정`,
        restore: async () => { await this.writeDbSubset({ modules: prevModules }); },
      });
      return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}" 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
    }

    const { char } = await this.readActiveCharacter();
    if (!char?.globalLore?.[loreIndex]) throw new Error(`캐릭터 로어북 #${loreIndex + 1}을(를) 찾을 수 없습니다.`);
    const prevChar = clone(char);
    const nextChar = clone(char);
    nextChar.globalLore[loreIndex] = mutateEntry(nextChar.globalLore[loreIndex]);
    await this._setCharacter(nextChar);
    const undoId = this._pushUndo({
      label: `캐릭터 로어북 #${loreIndex + 1} 수정`,
      restore: async () => { await this._setCharacter(prevChar); },
    });
    return { ok: true, undoId, summary: `캐릭터 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
  }

  async _applyUpdateLua(proposal, target) {
    const scope = proposal.scope || (target.targetKind === 'module_lua' ? 'module' : 'character');

    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
      const modIdx = Number.isInteger(proposal.moduleIndex) ? proposal.moduleIndex : (target.moduleIndex ?? 0);
      if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
      const prevModules = clone(modules);
      const nextModules = clone(modules);
      const currentCode = extractLuaFromTriggers(nextModules[modIdx].trigger).code;
      const nextCode = proposal.edits
        ? applyTextEdits(currentCode, proposal.edits, '모듈 Lua')
        : String(proposal.code ?? proposal.content ?? '');
      nextModules[modIdx].trigger = buildLuaTriggers(nextCode);
      await this.writeDbSubset({ modules: nextModules });
      const undoId = this._pushUndo({
        label: `모듈 Lua 수정 (${nextModules[modIdx].name})`,
        restore: async () => { await this.writeDbSubset({ modules: prevModules }); },
      });
      return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}" Lua 스크립트를 저장했습니다.` };
    }

    const { char } = await this.readActiveCharacter();
    if (!char) throw new Error('선택된 캐릭터가 없습니다.');
    const prevChar = clone(char);
    const nextChar = clone(char);
    const currentCode = extractLuaFromTriggers(nextChar.triggerscript).code;
    const nextCode = proposal.edits
      ? applyTextEdits(currentCode, proposal.edits, '캐릭터 Lua')
      : String(proposal.code ?? proposal.content ?? '');
    nextChar.triggerscript = buildLuaTriggers(nextCode);
    await this._setCharacter(nextChar);
    const undoId = this._pushUndo({
      label: `캐릭터 Lua 수정 (${nextChar.name})`,
      restore: async () => { await this._setCharacter(prevChar); },
    });
    return { ok: true, undoId, summary: `캐릭터 "${nextChar.name}" Lua 트리거 스크립트를 저장했습니다.` };
  }

  async _applyUpsertRegex(proposal, target) {
    const scope = proposal.scope || (target.targetKind === 'module_regex' ? 'module' : 'character');
    const idx = Number.isInteger(proposal.regexIndex) ? proposal.regexIndex : null;

    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
      const modIdx = Number.isInteger(proposal.moduleIndex) ? proposal.moduleIndex : (target.moduleIndex ?? 0);
      if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
      const prevModules = clone(modules);
      const nextModules = clone(modules);
      nextModules[modIdx].regex = Array.isArray(nextModules[modIdx].regex) ? nextModules[modIdx].regex : [];
      if (idx !== null && nextModules[modIdx].regex[idx]) {
        nextModules[modIdx].regex[idx] = normalizeRegexEntry(proposal, nextModules[modIdx].regex[idx]);
      } else {
        nextModules[modIdx].regex.push(normalizeRegexEntry(proposal));
      }
      await this.writeDbSubset({ modules: nextModules });
      const undoId = this._pushUndo({
        label: `모듈 정규식 저장 (${proposal.comment || 'Regex'})`,
        restore: async () => { await this.writeDbSubset({ modules: prevModules }); },
      });
      return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}" 정규식을 저장했습니다.` };
    }

    const { char } = await this.readActiveCharacter();
    if (!char) throw new Error('선택된 캐릭터가 없습니다.');
    const prevChar = clone(char);
    const nextChar = clone(char);
    nextChar.customscript = Array.isArray(nextChar.customscript) ? nextChar.customscript : [];
    if (idx !== null && nextChar.customscript[idx]) {
      nextChar.customscript[idx] = normalizeRegexEntry(proposal, nextChar.customscript[idx]);
    } else {
      nextChar.customscript.push(normalizeRegexEntry(proposal));
    }
    await this._setCharacter(nextChar);
    const undoId = this._pushUndo({
      label: `캐릭터 정규식 저장 (${proposal.comment || 'Regex'})`,
      restore: async () => { await this._setCharacter(prevChar); },
    });
    return { ok: true, undoId, summary: `캐릭터 정규식 "${proposal.comment || 'New Regex'}"을(를) 저장했습니다.` };
  }

  async _bindPersonaToActiveChat(personaId) {
    const { chat, charIndex, chatIndex } = await this.readActiveChat();
    if (!chat) return null;
    const prevChat = clone(chat);
    const nextChat = clone(chat);
    nextChat.bindedPersona = personaId;
    await this._setChat(charIndex, chatIndex, nextChat);
    return async () => { await this._setChat(charIndex, chatIndex, prevChat); };
  }

  async _applyCreatePersona(proposal, options) {
    const { personas, selectedPersona, permissionDenied } = await this.readPersonas();
    if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
    const prevPersonas = clone(personas);
    const nextPersonas = clone(personas);
    const newPersona = {
      name: String(proposal.name || 'New Persona'),
      personaPrompt: String(proposal.personaPrompt ?? proposal.content ?? ''),
      icon: String(proposal.icon || ''),
      note: String(proposal.note || ''),
      largePortrait: Boolean(proposal.largePortrait),
      id: makeUuid(),
    };
    nextPersonas.push(newPersona);
    await this.writeDbSubset({ personas: nextPersonas });

    let restoreChat = null;
    const shouldBind = Boolean(options.bindToCurrentChat ?? proposal.bindToCurrentChat);
    if (shouldBind) {
      restoreChat = await this._bindPersonaToActiveChat(newPersona.id);
    }

    const undoId = this._pushUndo({
      label: `새 페르소나 생성 (${newPersona.name})`,
      restore: async () => {
        await this.writeDbSubset({ personas: prevPersonas, selectedPersona });
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
    if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
    const idx = Number.isInteger(proposal.personaIndex)
      ? proposal.personaIndex
      : (Number.isInteger(target.personaIndex) ? target.personaIndex : selectedPersona);
    if (!personas[idx]) throw new Error(`페르소나 #${idx + 1}을(를) 찾을 수 없습니다.`);

    const prevPersonas = clone(personas);
    const nextPersonas = clone(personas);
    const cur = nextPersonas[idx];
    if (!cur.id) cur.id = makeUuid();

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

    const undoId = this._pushUndo({
      label: `페르소나 수정 (${cur.name})`,
      restore: async () => {
        await this.writeDbSubset({ personas: prevPersonas, selectedPersona });
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
    if (!cfg) throw new Error('DB 읽기 권한(db)이 필요합니다.');

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

export { extractLuaFromTriggers, buildLuaTriggers, normalizeLorebookEntry, normalizeRegexEntry, HostAdapter };
