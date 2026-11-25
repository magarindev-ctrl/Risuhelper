// SPDX-License-Identifier: GPL-3.0-only
// Strictly Read-Only diagnostic & inspection tools for RisuHelper's 3-call LLM loop.
// Every tool in this module is guaranteed read-only: no DB/character/chat/host write API
// is ever invoked here, and every output is size-bounded and isolated as reference data.

import { ALLOWED_CHAR_FIELDS } from './version.js';
import { AUTHOR_NOTE_FIELD } from './fields.js';
import { listChats, chatName, isColdStoredChat } from './chat-transfer.js';
import { loadSkillPack } from './skills.js';
import {
  extractLuaFromTriggers,
  findOrphanedLorebooks,
  summarizeLoreList,
} from './host-adapter.js';
import {
  summarizeChatVariables,
  previewRegexApplication,
  hasCbsSyntax,
} from './runtime-tools.js';

const MAX_TOOLS_PER_CALL = 6;
const MAX_TOOL_RESULT_CHARS = 10000;
const MAX_BATCH_RESULT_CHARS = 24000;
const MAX_AUDIT_FINDINGS = 40;

const READ_TOOL_DEFS = [
  {
    id: 'load_skill',
    label: '내장 스킬 로드',
    summary: 'L1 목록의 내장 스킬 지식·스키마 로드',
    argsHint: 'skillIds[]',
    requiresCapabilities: [],
  },
  {
    id: 'read_item',
    label: '항목 전문 조회',
    summary: '필드·첫메시지·로어북·Lua·정규식·페르소나·모듈 전문(타 캐릭터·채팅 포함)',
    argsHint: 'kind(char_field|greeting|authorNote|lorebook|lua|regex|persona|module|config), field?/loreIndex?/regexIndex?/personaIndex?/moduleIndex?/charIndex?',
    requiresCapabilities: [],
  },
  {
    id: 'list_items',
    label: '목록 분할 조회',
    summary: '로어북·정규식·페르소나·모듈·채팅·캐릭터 페이지네이션/검색',
    argsHint: 'kind(lorebook|regex|persona|module|chat|character), offset?, limit?, query?',
    requiresCapabilities: [],
  },
  {
    id: 'read_chat',
    label: '채팅 구간 조회',
    summary: '현재/다른 채팅의 지정 구간 메시지·메모리 요약 조회',
    argsHint: 'chatIndex?, tail?, from?, to?, charIndex?',
    requiresCapabilities: [],
  },
  {
    id: 'read_vars',
    label: '채팅 변수 조회',
    summary: '채팅 변수(scriptstate) 조회(타 채팅 포함)',
    argsHint: 'chatIndex?, keys?[], charIndex?',
    requiresCapabilities: [],
  },
  {
    id: 'test_regex_cbs',
    label: '정규식·CBS 사전 검증',
    summary: '정규식 및 CBS(runVar:false) 사전 실행 테스트',
    argsHint: 'regex?({in,out,flag}), text?, cbs?, runCbs?',
    requiresCapabilities: [],
  },
  {
    id: 'active_lorebook',
    label: '발동 로어북 조회',
    summary: '현재 채팅에서 실제로 발동 중인 로어북 확인',
    argsHint: '(인자 없음)',
    requiresCapabilities: ['getCurrentLorebookEntries'],
  },
  {
    id: 'audit_workspace',
    label: '워크스페이스 진단',
    summary: '고아 폴더·정규식/Lua/CBS 문법·누락 에셋·chat.id 정적 건강검진',
    argsHint: 'scope?(all|character|chat|module), charIndex?, moduleIndex?',
    requiresCapabilities: [],
  },
  {
    id: 'inspect_assets',
    label: '에셋·인레이 조회',
    summary: '캐릭터·모듈 에셋 목록 및 readImage/readInlay 메타 확인',
    argsHint: 'scope?(character|module), names?[], inlayId?',
    requiresCapabilities: [],
  },
  {
    id: 'read_fetch_log',
    label: '요청 로그 조회',
    summary: '사용자가 로그 첨부를 켠 경우에만 최근 API 요청 로그 조회',
    argsHint: 'index?',
    requiresCapabilities: ['getFetchLogs'],
    requiresOptInFetchLog: true,
  },
  {
    id: 'host_info',
    label: '호스트 환경 조회',
    summary: '실행 포크·지원 API·현재 테마 확인',
    argsHint: '(인자 없음)',
    requiresCapabilities: [],
  },
  {
    id: 'search_translation',
    label: '번역 캐시 검색',
    summary: 'RisuAI 번역 캐시에서 기존 번역 용어 검색',
    argsHint: 'query, limit?',
    requiresCapabilities: ['translationCache'],
  },
];

const READ_TOOL_BY_ID = new Map(READ_TOOL_DEFS.map(t => [t.id, t]));
const VALID_READ_TOOL_IDS = new Set(READ_TOOL_DEFS.map(t => t.id));

function isReadToolSupported(def, capabilities = null, { allowFetchLog = false } = {}) {
  if (!def) return false;
  if (def.requiresOptInFetchLog && !allowFetchLog) return false;
  if (!capabilities || !Array.isArray(def.requiresCapabilities) || def.requiresCapabilities.length === 0) {
    return true;
  }
  return def.requiresCapabilities.every(cap => Boolean(capabilities[cap]));
}

function getAvailableReadTools(capabilities = null, { allowFetchLog = false } = {}) {
  return READ_TOOL_DEFS.filter(def => isReadToolSupported(def, capabilities, { allowFetchLog }));
}

function formatReadToolCatalog(capabilities = null, { allowFetchLog = false } = {}) {
  const tools = getAvailableReadTools(capabilities, { allowFetchLog });
  return tools.map(t => `- \`${t.id}\`(${t.argsHint}): ${t.summary}`).join('\n');
}

function describeToolCall(call) {
  const tool = String(call?.tool || '');
  const args = call?.args && typeof call.args === 'object' ? call.args : {};
  switch (tool) {
    case 'load_skill': {
      const ids = Array.isArray(args.skillIds) ? args.skillIds : (args.skillId ? [args.skillId] : []);
      return ids.length ? `스킬 로드(${ids.join(', ')})` : '스킬 로드';
    }
    case 'read_item': {
      if (args.kind === 'lorebook' && Number.isInteger(args.loreIndex)) return `로어북 #${args.loreIndex + 1} 조회`;
      if (args.kind === 'char_field' && args.field) return `필드(${args.field}) 조회`;
      if (args.kind === 'greeting') return `첫 메시지 조회`;
      if (args.kind === 'lua') return 'Lua 원문 조회';
      if (args.kind === 'regex') return '정규식 조회';
      return `${args.kind || '항목'} 전문 조회`;
    }
    case 'list_items': return `${args.kind || '목록'} 조회`;
    case 'read_chat': return '채팅 구간 조회';
    case 'read_vars': return '채팅 변수 조회';
    case 'test_regex_cbs': return '정규식·CBS 검증';
    case 'active_lorebook': return '발동 로어북 진단';
    case 'audit_workspace': return '워크스페이스 정적 점검';
    case 'inspect_assets': return '에셋 메타 조회';
    case 'read_fetch_log': return '요청 로그 조회';
    case 'host_info': return '호스트 환경 확인';
    case 'search_translation': return `번역 캐시 검색(${String(args.query || '').slice(0, 16)})`;
    default: return READ_TOOL_BY_ID.get(tool)?.label || tool || '도구 실행';
  }
}

function clipText(str, maxChars = MAX_TOOL_RESULT_CHARS) {
  const s = String(str ?? '');
  if (s.length <= maxChars) return { text: s, truncated: false, totalChars: s.length };
  return {
    text: s.slice(0, maxChars) + `\n... (총 ${s.length.toLocaleString()}자 중 앞 ${maxChars.toLocaleString()}자만 표시)`,
    truncated: true,
    totalChars: s.length,
  };
}

function extractMemorySummaries(chat) {
  const v3 = Array.isArray(chat?.hypaV3Data?.summaries) ? chat.hypaV3Data.summaries.map(s => s?.text) : [];
  const v2 = Array.isArray(chat?.hypaV2Data?.mainChunks) ? chat.hypaV2Data.mainChunks.map(s => s?.text) : [];
  const supa = typeof chat?.supaMemoryData === 'string' ? [chat.supaMemoryData] : [];
  for (const list of [v3, v2, supa]) {
    const texts = list.map(t => String(t ?? '').trim()).filter(Boolean);
    if (texts.length > 0) return texts;
  }
  return [];
}

/**
 * Lightweight static Lua block-balance checker (ignores `--` comments and quoted strings).
 */
function checkLuaBalance(code) {
  const src = String(code ?? '');
  if (!src.trim()) return [];
  const issues = [];
  // Strip block comments `--[[...]]`, line comments `--...`, and double/single quoted strings
  const cleaned = src
    .replace(/--\[\[[\s\S]*?\]\]/g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");

  const openers = (cleaned.match(/\b(?:function|if|for|while|repeat)\b/g) || []).length;
  const closers = (cleaned.match(/\b(?:end|until)\b/g) || []).length;
  if (openers !== closers) {
    issues.push(`Lua 블록 짝 불일치 의심 (시작 키워드 ${openers}개 vs 종료 end/until ${closers}개)`);
  }
  return issues;
}

function checkCbsBalance(text) {
  const s = String(text ?? '');
  if (!s.includes('{{') && !s.includes('}}')) return null;
  let depth = 0;
  let unclosed = false;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '{' && s[i + 1] === '{') {
      depth++;
      i++;
    } else if (s[i] === '}' && s[i + 1] === '}') {
      depth--;
      if (depth < 0) {
        unclosed = true;
        depth = 0;
      }
      i++;
    }
  }
  if (depth !== 0 || unclosed) {
    return `CBS 중괄호({{ / }}) 짝이 맞지 않습니다 (잔여 깊이 ${depth})`;
  }
  return null;
}

const ASSET_REF_RE = /\{\{(?:img|image|bg|audio|video|raw|asset)::([^}|]+)(?:\|[^}]*)?\}\}/gi;

function findMissingAssetRefs(texts, knownNames) {
  const missing = new Set();
  for (const text of texts) {
    const s = String(text ?? '');
    if (!s.includes('{{')) continue;
    for (const m of s.matchAll(ASSET_REF_RE)) {
      const refName = String(m[1] || '').trim();
      if (!refName || refName.includes('{{')) continue;
      if (!knownNames.has(refName.toLowerCase())) {
        missing.add(refName);
      }
    }
  }
  return [...missing];
}

function collectKnownAssetNames(char, mod) {
  const set = new Set();
  if (Array.isArray(char?.additionalAssets)) {
    for (const a of char.additionalAssets) {
      if (Array.isArray(a) && a[0]) set.add(String(a[0]).trim().toLowerCase());
    }
  }
  if (Array.isArray(char?.emotionImages)) {
    for (const e of char.emotionImages) {
      if (Array.isArray(e) && e[0]) set.add(String(e[0]).trim().toLowerCase());
    }
  }
  if (Array.isArray(mod?.assets)) {
    for (const a of mod.assets) {
      if (Array.isArray(a) && a[0]) set.add(String(a[0]).trim().toLowerCase());
    }
  }
  return set;
}

function optionalInt(val) {
  return Number.isInteger(val) && val >= 0 ? val : undefined;
}

async function runReadItem(adapter, args, unlocks) {
  const kind = String(args.kind || '').trim();
  const maxChars = Math.max(500, Math.min(adapter.maxContentChars || 60000, Number(args.maxChars) || 24000));
  const charHint = { targetCharIndex: optionalInt(args.charIndex) };
  const chatHint = {
    targetCharIndex: optionalInt(args.charIndex),
    targetChatIndex: args.chatIndex === 'current' ? undefined : optionalInt(args.chatIndex),
  };

  if (kind === 'char_field') {
    const field = String(args.field || 'desc');
    if (field === AUTHOR_NOTE_FIELD) {
      return await runReadItem(adapter, { ...args, kind: 'authorNote' }, unlocks);
    }
    if (!ALLOWED_CHAR_FIELDS.includes(field)) {
      return { ok: false, error: `허용되지 않는 캐릭터 필드입니다: ${field}` };
    }
    const { char, charIndex, crossCharacter } = await adapter._resolveTargetCharacter(charHint, null, '조회');
    const raw = field === 'depthPrompt' ? String(char.depth_prompt?.prompt ?? '') : String(char[field] ?? '');
    const clipped = clipText(raw, maxChars);
    if (!clipped.truncated && !crossCharacter) {
      unlocks.fieldsShownFull.add(field);
    }
    return {
      ok: true,
      kind,
      field,
      charIndex,
      charName: char.name || '(무제)',
      totalChars: clipped.totalChars,
      truncated: clipped.truncated,
      content: clipped.text,
    };
  }

  if (kind === 'authorNote' || kind === 'chat_note') {
    const { chat, char, charIndex, chatIndex, crossCharacter, crossChat } = await adapter._resolveTargetChat(chatHint, null, '조회');
    const clipped = clipText(String(chat.note ?? ''), maxChars);
    if (!clipped.truncated && !crossCharacter && !crossChat) {
      unlocks.fieldsShownFull.add(AUTHOR_NOTE_FIELD);
    }
    return {
      ok: true,
      kind: 'authorNote',
      charIndex,
      chatIndex,
      charName: char.name || '(무제)',
      chatName: chatName(chat, chatIndex),
      totalChars: clipped.totalChars,
      truncated: clipped.truncated,
      content: clipped.text,
    };
  }

  if (kind === 'greeting') {
    const idx = Number.isInteger(args.greetingIndex) ? args.greetingIndex : -1;
    const { char, charIndex, crossCharacter } = await adapter._resolveTargetCharacter(charHint, null, '조회');
    if (char.type === 'group') return { ok: false, error: '그룹 채팅에는 첫 메시지 구조가 없습니다.' };
    let raw;
    if (idx === -1) {
      raw = String(char.firstMessage ?? '');
    } else {
      const list = Array.isArray(char.alternateGreetings) ? char.alternateGreetings : [];
      if (idx < 0 || idx >= list.length) {
        return { ok: false, error: `추가 첫 메시지 #${idx + 1}을(를) 찾을 수 없습니다. (총 ${list.length}개)` };
      }
      raw = String(list[idx] ?? '');
    }
    const clipped = clipText(raw, maxChars);
    if (!clipped.truncated && !crossCharacter) {
      unlocks.greetingsShownFull.add(idx);
    }
    return {
      ok: true,
      kind,
      greetingIndex: idx,
      charIndex,
      charName: char.name || '(무제)',
      totalChars: clipped.totalChars,
      truncated: clipped.truncated,
      content: clipped.text,
    };
  }

  if (kind === 'lorebook') {
    const scope = args.scope || 'character';
    const loreIndex = args.loreIndex;
    if (!Number.isInteger(loreIndex) || loreIndex < 0) {
      return { ok: false, error: 'lorebook 조회에는 0 이상의 정수 loreIndex가 필요합니다.' };
    }
    let list = [];
    let ownerLabel = '';
    if (scope === 'chat') {
      const { chat, chatIndex } = await adapter._resolveTargetChat(chatHint, null, '조회');
      list = Array.isArray(chat.localLore) ? chat.localLore : [];
      ownerLabel = `채팅 "${chatName(chat, chatIndex)}"`;
    } else if (scope === 'module') {
      const { modules, permissionDenied } = await adapter.readModules();
      if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
      const modIdx = optionalInt(args.moduleIndex) ?? 0;
      const mod = modules[modIdx];
      if (!mod) return { ok: false, error: `모듈 #${modIdx + 1}을(를) 찾을 수 없습니다.` };
      list = Array.isArray(mod.lorebook) ? mod.lorebook : [];
      ownerLabel = `모듈 "${mod.name}"`;
    } else {
      const { char } = await adapter._resolveTargetCharacter(charHint, null, '조회');
      list = Array.isArray(char.globalLore) ? char.globalLore : [];
      ownerLabel = `캐릭터 "${char.name || '무제'}"`;
    }
    const entry = list[loreIndex];
    if (!entry) return { ok: false, error: `${ownerLabel} 로어북 #${loreIndex + 1}을(를) 찾을 수 없습니다. (총 ${list.length}개)` };
    const clipped = clipText(String(entry.content ?? ''), maxChars);
    return {
      ok: true,
      kind,
      scope,
      owner: ownerLabel,
      loreIndex,
      comment: entry.comment || '',
      key: entry.key || '',
      secondkey: entry.secondkey || '',
      selective: Boolean(entry.selective),
      alwaysActive: Boolean(entry.alwaysActive),
      useRegex: Boolean(entry.useRegex),
      insertorder: entry.insertorder ?? 100,
      mode: entry.mode || 'normal',
      folder: entry.folder || '',
      totalChars: clipped.totalChars,
      truncated: clipped.truncated,
      content: clipped.text,
    };
  }

  if (kind === 'lua') {
    const scope = args.scope || 'character';
    if (scope === 'module') {
      const { modules, permissionDenied } = await adapter.readModules();
      if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
      const modIdx = optionalInt(args.moduleIndex) ?? 0;
      const mod = modules[modIdx];
      if (!mod) return { ok: false, error: `모듈 #${modIdx + 1}을(를) 찾을 수 없습니다.` };
      const lua = extractLuaFromTriggers(mod.trigger);
      const clipped = clipText(lua.code, maxChars);
      return { ok: true, kind, scope, moduleIndex: modIdx, name: mod.name, isLua: lua.isLua, hasOtherTriggers: lua.hasOtherTriggers, ...clipped };
    }
    const { char, charIndex } = await adapter._resolveTargetCharacter(charHint, null, '조회');
    const lua = extractLuaFromTriggers(char.triggerscript);
    const clipped = clipText(lua.code, maxChars);
    return { ok: true, kind, scope: 'character', charIndex, charName: char.name || '(무제)', isLua: lua.isLua, hasOtherTriggers: lua.hasOtherTriggers, ...clipped };
  }

  if (kind === 'regex') {
    const scope = args.scope || 'character';
    const regexIndex = args.regexIndex;
    if (!Number.isInteger(regexIndex) || regexIndex < 0) {
      return { ok: false, error: 'regex 조회에는 0 이상의 정수 regexIndex가 필요합니다.' };
    }
    let list = [];
    if (scope === 'module') {
      const { modules, permissionDenied } = await adapter.readModules();
      if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
      const modIdx = optionalInt(args.moduleIndex) ?? 0;
      const mod = modules[modIdx];
      if (!mod) return { ok: false, error: `모듈 #${modIdx + 1}을(를) 찾을 수 없습니다.` };
      list = Array.isArray(mod.regex) ? mod.regex : [];
    } else {
      const { char } = await adapter._resolveTargetCharacter(charHint, null, '조회');
      list = Array.isArray(char.customscript) ? char.customscript : [];
    }
    const entry = list[regexIndex];
    if (!entry) return { ok: false, error: `정규식 #${regexIndex + 1}을(를) 찾을 수 없습니다. (총 ${list.length}개)` };
    return {
      ok: true,
      kind,
      scope,
      regexIndex,
      comment: entry.comment || '',
      type: entry.type || 'editdisplay',
      in: entry.in || '',
      out: clipText(entry.out || '', maxChars).text,
      flag: entry.flag || '',
      ableFlag: Boolean(entry.ableFlag),
    };
  }

  if (kind === 'persona') {
    const { personas, selectedPersona, permissionDenied } = await adapter.readPersonas();
    if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
    const idx = Number.isInteger(args.personaIndex) ? args.personaIndex : selectedPersona;
    const p = personas[idx];
    if (!p) return { ok: false, error: `페르소나 #${idx + 1}을(를) 찾을 수 없습니다. (총 ${personas.length}개)` };
    const clipped = clipText(String(p.personaPrompt ?? ''), maxChars);
    return {
      ok: true,
      kind,
      personaIndex: idx,
      selected: idx === selectedPersona,
      name: p.name || '',
      note: p.note || '',
      largePortrait: Boolean(p.largePortrait),
      personaPrompt: clipped.text,
      truncated: clipped.truncated,
    };
  }

  if (kind === 'module') {
    const { modules, enabledModules, permissionDenied } = await adapter.readModules();
    if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
    const modIdx = optionalInt(args.moduleIndex) ?? 0;
    const mod = modules[modIdx];
    if (!mod) return { ok: false, error: `모듈 #${modIdx + 1}을(를) 찾을 수 없습니다. (총 ${modules.length}개)` };
    const lua = extractLuaFromTriggers(mod.trigger);
    return {
      ok: true,
      kind,
      moduleIndex: modIdx,
      id: mod.id || '',
      name: mod.name || '',
      namespace: mod.namespace || '',
      description: clipText(mod.description || '', 2000).text,
      enabledGlobally: enabledModules.includes(mod.id),
      customModuleToggle: clipText(mod.customModuleToggle || '', 2000).text,
      backgroundEmbedding: clipText(mod.backgroundEmbedding || '', 3000).text,
      loreCount: Array.isArray(mod.lorebook) ? mod.lorebook.length : 0,
      regexCount: Array.isArray(mod.regex) ? mod.regex.length : 0,
      hasLua: Boolean(lua.isLua && lua.code.trim()),
      luaChars: lua.code.length,
    };
  }

  if (kind === 'config') {
    const cfg = await adapter.readAllowedConfig();
    if (!cfg) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
    return { ok: true, kind, config: cfg };
  }

  return { ok: false, error: `알 수 없는 read_item kind입니다: ${kind}` };
}

async function runListItems(adapter, args) {
  const kind = String(args.kind || '').trim();
  const offset = Math.max(0, Number.isInteger(args.offset) ? args.offset : (Number(args.offset) || 0));
  const limit = Math.max(1, Math.min(80, Number.isInteger(args.limit) ? args.limit : (Number(args.limit) || 40)));
  const q = String(args.query ?? '').trim().toLowerCase();
  const charHint = { targetCharIndex: optionalInt(args.charIndex) };
  const chatHint = {
    targetCharIndex: optionalInt(args.charIndex),
    targetChatIndex: args.chatIndex === 'current' ? undefined : optionalInt(args.chatIndex),
  };

  const paginate = (items) => {
    const filtered = q
      ? items.filter(item => JSON.stringify(item).toLowerCase().includes(q))
      : items;
    return {
      total: filtered.length,
      offset,
      limit,
      hasMore: offset + limit < filtered.length,
      items: filtered.slice(offset, offset + limit),
    };
  };

  if (kind === 'lorebook') {
    const scope = args.scope || 'character';
    let list = [];
    if (scope === 'chat') {
      const { chat } = await adapter._resolveTargetChat(chatHint, null, '목록 조회');
      list = Array.isArray(chat.localLore) ? chat.localLore : [];
    } else if (scope === 'module') {
      const { modules, permissionDenied } = await adapter.readModules();
      if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
      const modIdx = optionalInt(args.moduleIndex) ?? 0;
      const mod = modules[modIdx];
      if (!mod) return { ok: false, error: `모듈 #${modIdx + 1}을(를) 찾을 수 없습니다.` };
      list = Array.isArray(mod.lorebook) ? mod.lorebook : [];
    } else {
      const { char } = await adapter._resolveTargetCharacter(charHint, null, '목록 조회');
      list = Array.isArray(char.globalLore) ? char.globalLore : [];
    }
    const { loreSummary, foldersSummary, orphanedLoreCount } = summarizeLoreList(list, list.length);
    return { ok: true, kind, scope, orphanedLoreCount, foldersSummary, ...paginate(loreSummary) };
  }

  if (kind === 'regex') {
    const scope = args.scope || 'character';
    let list = [];
    if (scope === 'module') {
      const { modules, permissionDenied } = await adapter.readModules();
      if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
      const modIdx = optionalInt(args.moduleIndex) ?? 0;
      const mod = modules[modIdx];
      if (!mod) return { ok: false, error: `모듈 #${modIdx + 1}을(를) 찾을 수 없습니다.` };
      list = Array.isArray(mod.regex) ? mod.regex : [];
    } else {
      const { char } = await adapter._resolveTargetCharacter(charHint, null, '목록 조회');
      list = Array.isArray(char.customscript) ? char.customscript : [];
    }
    const rows = list.map((r, i) => ({
      regexIndex: i,
      comment: r?.comment || '(무제)',
      type: r?.type || 'editdisplay',
      in: String(r?.in || '').slice(0, 80),
      flag: r?.flag || '',
    }));
    return { ok: true, kind, scope, ...paginate(rows) };
  }

  if (kind === 'persona') {
    const { personas, selectedPersona, permissionDenied } = await adapter.readPersonas();
    if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
    const rows = personas.map((p, i) => ({
      personaIndex: i,
      name: p?.name || '(무제)',
      note: p?.note || '',
      selected: i === selectedPersona,
      chars: String(p?.personaPrompt || '').length,
    }));
    return { ok: true, kind, ...paginate(rows) };
  }

  if (kind === 'module') {
    const { modules, enabledModules, permissionDenied } = await adapter.readModules();
    if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
    const rows = modules.map((m, i) => ({
      moduleIndex: i,
      id: m?.id || '',
      name: m?.name || '(무제)',
      enabledGlobally: enabledModules.includes(m?.id),
      loreCount: Array.isArray(m?.lorebook) ? m.lorebook.length : 0,
      regexCount: Array.isArray(m?.regex) ? m.regex.length : 0,
      hasLua: extractLuaFromTriggers(m?.trigger).isLua,
    }));
    return { ok: true, kind, ...paginate(rows) };
  }

  if (kind === 'chat') {
    const { char, activeChatIndex, crossCharacter } = await adapter._resolveTargetCharacter(charHint, null, '채팅 목록 조회');
    const curIdx = !crossCharacter && Number.isInteger(activeChatIndex) ? activeChatIndex : (char.chatPage ?? 0);
    const chats = listChats(char, curIdx).map(c => ({
      chatIndex: c.index,
      name: c.name,
      messages: c.messages,
      coldStored: c.coldStored,
      current: c.current,
    }));
    return { ok: true, kind, charName: char.name || '(무제)', ...paginate(chats) };
  }

  if (kind === 'character') {
    const res = await adapter.readCharacterCatalog();
    if (res.permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
    return { ok: true, kind, usedQueryCharacters: Boolean(res.usedQueryCharacters), ...paginate(res.catalog) };
  }

  return { ok: false, error: `알 수 없는 list_items kind입니다: ${kind}` };
}

async function runReadChat(adapter, args) {
  const chatHint = {
    targetCharIndex: optionalInt(args.charIndex),
    targetChatIndex: args.chatIndex === 'current' ? undefined : optionalInt(args.chatIndex),
  };
  let resolved;
  try {
    resolved = await adapter._resolveTargetChat(chatHint, null, '채팅 조회');
  } catch (err) {
    const msg = err?.message || String(err);
    if (/콜드 스토리지/.test(msg)) {
      return { ok: false, coldStored: true, error: msg };
    }
    throw err;
  }
  const { chat, char, charIndex, chatIndex } = resolved;
  if (isColdStoredChat(chat)) {
    return { ok: false, coldStored: true, error: '콜드 스토리지에 보관된 채팅입니다. RisuAI에서 먼저 열어 복원한 뒤 조회해 주세요.' };
  }
  const messages = Array.isArray(chat.message) ? chat.message : [];
  const maxChars = Math.max(500, Math.min(12000, Number(args.maxChars) || 8000));

  let startIdx;
  let endIdx;
  if (Number.isInteger(args.from) && args.from >= 0) {
    startIdx = Math.min(args.from, messages.length);
    const rawTo = Number.isInteger(args.to) && args.to > startIdx ? args.to : startIdx + 12;
    endIdx = Math.min(messages.length, Math.min(rawTo, startIdx + 30));
  } else if (Number.isInteger(args.start) && args.start >= 0) {
    const count = Math.max(1, Math.min(30, Number.isInteger(args.count) ? args.count : 12));
    startIdx = Math.min(args.start, messages.length);
    endIdx = Math.min(startIdx + count, messages.length);
  } else {
    const tail = Math.max(1, Math.min(30, Number.isInteger(args.tail) ? args.tail : 12));
    endIdx = messages.length;
    startIdx = Math.max(0, messages.length - tail);
  }

  const slice = [];
  let usedChars = 0;
  let truncated = false;
  for (let i = startIdx; i < endIdx; i++) {
    const text = String(messages[i]?.data ?? '');
    const role = messages[i]?.role === 'user' ? '유저' : '캐릭터';
    if (usedChars + text.length > maxChars) {
      const rem = maxChars - usedChars;
      if (rem > 80) {
        slice.push({ n: i + 1, role, text: text.slice(0, rem) + '…', truncated: true });
      }
      truncated = true;
      break;
    }
    slice.push({ n: i + 1, role, text });
    usedChars += text.length;
  }

  const memories = extractMemorySummaries(chat).slice(0, 6).map(t => clipText(t, 1200).text);
  const vars = summarizeChatVariables(chat);

  return {
    ok: true,
    charIndex,
    charName: char.name || '(무제)',
    chatIndex,
    chatName: chatName(chat, chatIndex),
    totalMessages: messages.length,
    range: slice.length > 0 ? `${slice[0].n}~${slice[slice.length - 1].n}` : '없음',
    truncated,
    authorNote: clipText(chat.note || '', 1500).text,
    variablesCount: vars.total,
    memorySummaries: memories,
    messages: slice,
  };
}

async function runReadVars(adapter, args) {
  const chatHint = {
    targetCharIndex: optionalInt(args.charIndex),
    targetChatIndex: args.chatIndex === 'current' ? undefined : optionalInt(args.chatIndex),
  };
  const { chat, char, charIndex, chatIndex } = await adapter._resolveTargetChat(chatHint, null, '채팅 변수 조회');
  const summary = summarizeChatVariables(chat);
  let variables = summary.variables;
  if (Array.isArray(args.keys) && args.keys.length > 0) {
    const wanted = new Set(args.keys.map(k => String(k || '').replace(/^\$+/, '').trim().toLowerCase()).filter(Boolean));
    variables = variables.filter(v => wanted.has(String(v.name || '').toLowerCase()));
  }
  return {
    ok: true,
    charIndex,
    charName: char.name || '(무제)',
    chatIndex,
    chatName: chatName(chat, chatIndex),
    total: summary.total,
    variables,
  };
}

async function runTestRegexCbs(adapter, args) {
  let sampleText = typeof args.text === 'string' ? args.text : '';
  let sampleSource = sampleText ? '직접 입력 샘플' : '';

  if (!sampleText && args.sampleFromChat !== false) {
    try {
      const { chat } = await adapter.readActiveChat();
      if (chat && !isColdStoredChat(chat) && Array.isArray(chat.message)) {
        const msgs = chat.message.filter(m => typeof m?.data === 'string' && m.data.trim());
        if (args.regex && typeof args.regex === 'object') {
          for (let i = msgs.length - 1; i >= Math.max(0, msgs.length - 12); i--) {
            const probe = previewRegexApplication(args.regex, msgs[i].data);
            if (probe.ok && probe.matched) {
              sampleText = msgs[i].data;
              sampleSource = '최근 채팅 일치 메시지';
              break;
            }
          }
        }
        if (!sampleText && msgs.length > 0) {
          sampleText = msgs[msgs.length - 1].data;
          sampleSource = '최근 채팅 마지막 메시지';
        }
      }
    } catch {}
  }

  const out = { ok: true, sampleSource, samplePreview: sampleText.slice(0, 500) };

  if (args.regex && typeof args.regex === 'object') {
    const rp = previewRegexApplication(args.regex, sampleText);
    if (!rp.ok) return { ok: false, error: rp.error };
    out.regex = {
      matched: rp.matched,
      matchCount: rp.matchCount,
      flags: rp.flags,
      after: clipText(rp.after, 3000).text,
    };
  }

  const wantCbs = args.runCbs !== false && (args.cbs || hasCbsSyntax(out.regex?.after || args.regex?.out || sampleText));
  if (wantCbs) {
    const cbsInput = typeof args.cbs === 'string'
      ? args.cbs
      : (out.regex?.matched ? out.regex.after : (args.regex?.out || sampleText));
    if (cbsInput) {
      const sim = await adapter.simulateRisuChat(cbsInput, { processRegex: false, role: args.role || 'char' });
      out.cbs = sim.ok
        ? { ok: true, output: clipText(sim.output, 3000).text }
        : { ok: false, unsupported: Boolean(sim.unsupported), reason: sim.reason };
    }
  }
  return out;
}

async function runActiveLorebook(adapter) {
  if (!adapter.hasCapability('getCurrentLorebookEntries') || typeof adapter.api?.getCurrentLorebookEntries !== 'function') {
    return { ok: false, error: '이 호스트는 getCurrentLorebookEntries API를 지원하지 않습니다.' };
  }
  const raw = await adapter.api.getCurrentLorebookEntries();
  const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.entries) ? raw.entries : []);
  const entries = list.slice(0, 40).map((e, i) => ({
    index: i,
    comment: String(e?.comment ?? e?.name ?? '(무제)'),
    key: String(e?.key ?? ''),
    mode: String(e?.mode ?? 'normal'),
    alwaysActive: Boolean(e?.alwaysActive),
    chars: String(e?.content ?? '').length,
    preview: String(e?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 140),
  }));
  return {
    ok: true,
    total: list.length,
    shown: entries.length,
    entries,
  };
}

async function runAuditWorkspace(adapter, args) {
  const scope = String(args.scope || 'all');
  const charHint = { targetCharIndex: optionalInt(args.charIndex) };
  const chatHint = {
    targetCharIndex: optionalInt(args.charIndex),
    targetChatIndex: args.chatIndex === 'current' ? undefined : optionalInt(args.chatIndex),
  };

  const findings = [];
  const pushFinding = (severity, category, location, message) => {
    if (findings.length < MAX_AUDIT_FINDINGS) {
      findings.push({ severity, category, location, message });
    }
  };

  let char = null;
  let mod = null;

  if (scope === 'all' || scope === 'character') {
    try {
      const res = await adapter._resolveTargetCharacter(charHint, null, '진단');
      char = res.char;
      const gLore = Array.isArray(char.globalLore) ? char.globalLore : [];
      const orphans = findOrphanedLorebooks(gLore);
      if (orphans.length > 0) {
        pushFinding('error', 'lorebook', '캐릭터 로어북', `존재하지 않는 폴더를 가리켜 숨겨진 로어북 ${orphans.length}개 (인덱스: ${orphans.slice(0, 10).map(i => `#${i + 1}`).join(', ')})`);
      }
      gLore.forEach((e, i) => {
        const cbsErr = checkCbsBalance(e?.content);
        if (cbsErr) pushFinding('warn', 'cbs', `캐릭터 로어북 #${i + 1} (${e?.comment || '무제'})`, cbsErr);
      });

      const regexes = Array.isArray(char.customscript) ? char.customscript : [];
      regexes.forEach((r, i) => {
        const check = previewRegexApplication(r || {}, '');
        if (!check.ok) pushFinding('error', 'regex', `캐릭터 정규식 #${i + 1} (${r?.comment || '무제'})`, check.error);
        const cbsErr = checkCbsBalance(r?.out);
        if (cbsErr) pushFinding('warn', 'cbs', `캐릭터 정규식 #${i + 1} (${r?.comment || '무제'})`, cbsErr);
      });

      const lua = extractLuaFromTriggers(char.triggerscript);
      if (lua.isLua && lua.code.trim()) {
        for (const msg of checkLuaBalance(lua.code)) {
          pushFinding('warn', 'lua', `캐릭터 Lua (${char.name || '무제'})`, msg);
        }
      }

      for (const f of ['desc', 'firstMessage', 'systemPrompt', 'replaceGlobalNote']) {
        const cbsErr = checkCbsBalance(char[f]);
        if (cbsErr) pushFinding('warn', 'cbs', `캐릭터 필드 ${f}`, cbsErr);
      }

      const chats = Array.isArray(char.chats) ? char.chats : [];
      const missingIds = chats.filter(c => c && !c.id).length;
      if (missingIds > 0) {
        pushFinding('warn', 'fork_compat', `캐릭터 채팅 목록`, `UUID id가 없는 채팅 ${missingIds}개 발견 (PocketRisu/RisuBard/RisuNest 호환성 주의)`);
      }

      const knownAssets = collectKnownAssetNames(char, null);
      const textsToScan = [
        char.desc, char.firstMessage, char.backgroundHTML,
        ...gLore.map(e => e?.content),
        ...regexes.map(r => r?.out),
      ];
      const missingAssets = findMissingAssetRefs(textsToScan, knownAssets);
      if (missingAssets.length > 0) {
        pushFinding('warn', 'asset', `캐릭터 에셋 참조`, `등록되지 않은 에셋 참조 의심: ${missingAssets.slice(0, 12).join(', ')}`);
      }
    } catch (err) {
      pushFinding('warn', 'character', '캐릭터', `캐릭터 진단 생략: ${err.message}`);
    }
  }

  if (scope === 'all' || scope === 'chat') {
    try {
      const { chat, chatIndex } = await adapter._resolveTargetChat(chatHint, null, '진단');
      const lLore = Array.isArray(chat.localLore) ? chat.localLore : [];
      const orphans = findOrphanedLorebooks(lLore);
      if (orphans.length > 0) {
        pushFinding('error', 'lorebook', `채팅 "${chatName(chat, chatIndex)}" 로어북`, `숨겨진 채팅 로어북 ${orphans.length}개`);
      }
      lLore.forEach((e, i) => {
        const cbsErr = checkCbsBalance(e?.content);
        if (cbsErr) pushFinding('warn', 'cbs', `채팅 로어북 #${i + 1} (${e?.comment || '무제'})`, cbsErr);
      });
      const noteErr = checkCbsBalance(chat.note);
      if (noteErr) pushFinding('warn', 'cbs', '작가의 노트', noteErr);
    } catch {}
  }

  if (scope === 'module' || (scope === 'all' && Number.isInteger(args.moduleIndex))) {
    try {
      const { modules, permissionDenied } = await adapter.readModules();
      if (!permissionDenied) {
        const modIdx = optionalInt(args.moduleIndex) ?? 0;
        mod = modules[modIdx];
        if (mod) {
          const mLore = Array.isArray(mod.lorebook) ? mod.lorebook : [];
          const orphans = findOrphanedLorebooks(mLore);
          if (orphans.length > 0) {
            pushFinding('error', 'lorebook', `모듈 "${mod.name}" 로어북`, `숨겨진 모듈 로어북 ${orphans.length}개`);
          }
          const mRegex = Array.isArray(mod.regex) ? mod.regex : [];
          mRegex.forEach((r, i) => {
            const check = previewRegexApplication(r || {}, '');
            if (!check.ok) pushFinding('error', 'regex', `모듈 "${mod.name}" 정규식 #${i + 1}`, check.error);
          });
          const mLua = extractLuaFromTriggers(mod.trigger);
          if (mLua.isLua && mLua.code.trim()) {
            for (const msg of checkLuaBalance(mLua.code)) {
              pushFinding('warn', 'lua', `모듈 "${mod.name}" Lua`, msg);
            }
          }
          const knownModAssets = collectKnownAssetNames(null, mod);
          const missingModAssets = findMissingAssetRefs(
            [mod.backgroundEmbedding, ...mLore.map(e => e?.content), ...mRegex.map(r => r?.out)],
            knownModAssets
          );
          if (missingModAssets.length > 0) {
            pushFinding('warn', 'asset', `모듈 "${mod.name}" 에셋 참조`, `등록되지 않은 에셋 참조 의심: ${missingModAssets.slice(0, 12).join(', ')}`);
          }
        }
      }
    } catch {}
  }

  const errorCount = findings.filter(f => f.severity === 'error').length;
  const warnCount = findings.filter(f => f.severity === 'warn').length;
  return {
    ok: true,
    scope,
    healthy: findings.length === 0,
    errorCount,
    warnCount,
    findings,
  };
}

async function runInspectAssets(adapter, args) {
  const scope = String(args.scope || 'character');
  const charHint = { targetCharIndex: optionalInt(args.charIndex) };
  const listed = [];
  const pathByName = new Map();

  if (scope === 'module') {
    const { modules, permissionDenied } = await adapter.readModules();
    if (permissionDenied) return { ok: false, error: 'DB 읽기 권한이 없습니다.' };
    const modIdx = optionalInt(args.moduleIndex) ?? 0;
    const mod = modules[modIdx];
    if (!mod) return { ok: false, error: `모듈 #${modIdx + 1}을(를) 찾을 수 없습니다.` };
    for (const a of Array.isArray(mod.assets) ? mod.assets : []) {
      if (!Array.isArray(a)) continue;
      const name = String(a[0] || '');
      const assetPath = String(a[1] || '');
      const ext = String(a[2] || '');
      listed.push({ name, ext, hasPath: Boolean(assetPath) });
      if (name && assetPath) pathByName.set(name.toLowerCase(), assetPath);
    }
  } else {
    const { char } = await adapter._resolveTargetCharacter(charHint, null, '에셋 조회');
    for (const a of Array.isArray(char.additionalAssets) ? char.additionalAssets : []) {
      if (!Array.isArray(a)) continue;
      const name = String(a[0] || '');
      const assetPath = String(a[1] || '');
      const ext = String(a[2] || '');
      listed.push({ kind: 'additional', name, ext, hasPath: Boolean(assetPath) });
      if (name && assetPath) pathByName.set(name.toLowerCase(), assetPath);
    }
    for (const e of Array.isArray(char.emotionImages) ? char.emotionImages : []) {
      if (!Array.isArray(e)) continue;
      const name = String(e[0] || '');
      const assetPath = String(e[1] || '');
      listed.push({ kind: 'emotion', name, hasPath: Boolean(assetPath) });
      if (name && assetPath) pathByName.set(name.toLowerCase(), assetPath);
    }
  }

  const imageChecks = [];
  if (Array.isArray(args.names) && args.names.length > 0 && adapter.hasCapability('readImage') && typeof adapter.api?.readImage === 'function') {
    for (const rawName of args.names.slice(0, 5)) {
      const key = String(rawName || '').trim();
      const targetPath = pathByName.get(key.toLowerCase()) || key;
      try {
        const bytes = await adapter.api.readImage(targetPath);
        const len = bytes?.byteLength ?? bytes?.length ?? 0;
        imageChecks.push({ name: key, exists: len > 0, byteLength: len });
      } catch (err) {
        imageChecks.push({ name: key, exists: false, error: err?.message || String(err) });
      }
    }
  }

  const inlayChecks = [];
  const inlayIds = Array.isArray(args.checkInlays)
    ? args.checkInlays
    : (typeof args.inlayId === 'string' && args.inlayId.trim() ? [args.inlayId] : []);
  if (inlayIds.length > 0 && adapter.hasCapability('readInlay') && typeof adapter.api?.readInlay === 'function') {
    for (const rawId of inlayIds.slice(0, 5)) {
      const id = String(rawId || '').trim();
      try {
        const inlay = await adapter.api.readInlay(id);
        inlayChecks.push(inlay ? {
          id,
          exists: true,
          type: inlay.type || '',
          name: inlay.name || '',
          ext: inlay.ext || '',
          width: inlay.width ?? null,
          height: inlay.height ?? null,
        } : { id, exists: false });
      } catch (err) {
        inlayChecks.push({ id, exists: false, error: err?.message || String(err) });
      }
    }
  }

  return {
    ok: true,
    scope,
    totalAssets: listed.length,
    assets: listed.slice(0, 80),
    ...(imageChecks.length > 0 ? { imageChecks } : {}),
    ...(inlayChecks.length > 0 ? { inlayChecks } : {}),
  };
}

async function runReadFetchLog(adapter, args, toolContext) {
  if (!toolContext?.allowFetchLog) {
    return {
      ok: false,
      error: '요청 로그는 개인정보·보안 보호를 위해 사용자가 패널의 "최근 요청 로그 첨부" 버튼을 직접 눌렀을 때만 읽을 수 있습니다.',
    };
  }
  const idx = Number.isInteger(args.index) && args.index >= 0 ? args.index : 0;
  if (idx === 0 && toolContext.attachedFetchLog) {
    return { ok: true, index: 0, log: toolContext.attachedFetchLog };
  }
  return await adapter.readLatestFetchLog({ index: idx });
}

async function runHostInfo(adapter) {
  const flavor = adapter.detectHostFlavor();
  const capabilities = adapter.getCapabilities();
  const supportedCaps = Object.keys(capabilities || {}).filter(k => capabilities[k]);
  const unsupportedCaps = Object.keys(capabilities || {}).filter(k => !capabilities[k]);

  let colorScheme = null;
  if (capabilities?.colorScheme && typeof adapter.api?.getColorScheme === 'function') {
    try {
      const cs = await adapter.api.getColorScheme();
      colorScheme = cs?.name || cs?.scheme?.type || null;
    } catch {}
  }
  let textTheme = null;
  if (capabilities?.textTheme && typeof adapter.api?.getTextTheme === 'function') {
    try {
      const tt = await adapter.api.getTextTheme();
      textTheme = typeof tt === 'string' ? tt : (tt?.name || null);
    } catch {}
  }

  return {
    ok: true,
    host: flavor.name,
    activePersonaAutoSyncs: flavor.activePersonaAutoSyncs,
    runtime: adapter.getRuntimeInfo() || null,
    colorScheme,
    textTheme,
    supportedCapabilities: supportedCaps,
    unsupportedCapabilities: unsupportedCaps,
  };
}

async function runSearchTranslation(adapter, args) {
  if (!adapter.hasCapability('translationCache')) {
    return { ok: false, error: '이 호스트는 번역 캐시 조회 API를 지원하지 않습니다.' };
  }
  const query = String(args.query ?? '').trim();
  if (!query) return { ok: false, error: '검색할 query 문자열이 필요합니다.' };
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 12));

  if (typeof adapter.api?.searchTranslationCache === 'function') {
    const raw = await adapter.api.searchTranslationCache(query);
    const items = Array.isArray(raw) ? raw.slice(0, limit) : (raw ? [raw] : []);
    return { ok: true, query, count: items.length, matches: items };
  }
  if (typeof adapter.api?.getTranslationCache === 'function') {
    const hit = await adapter.api.getTranslationCache(query);
    return { ok: true, query, count: hit ? 1 : 0, matches: hit ? [{ source: query, target: hit }] : [] };
  }
  return { ok: false, error: '번역 캐시 조회 메서드를 찾을 수 없습니다.' };
}

/**
 * Executes a single validated Read-Only tool call. Never invokes any write API.
 */
async function executeReadTool(adapter, call, toolContext = {}, unlocks = null) {
  const tool = String(call?.tool || '').trim();
  const args = call?.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args : {};
  const sharedUnlocks = unlocks || {
    skillIds: new Set(),
    fieldsShownFull: new Set(),
    greetingsShownFull: new Set(),
  };

  if (!VALID_READ_TOOL_IDS.has(tool)) {
    return { tool, ok: false, label: tool || '알 수 없는 도구', result: { ok: false, error: `허용되지 않는 읽기 도구입니다: ${tool}` } };
  }

  const def = READ_TOOL_BY_ID.get(tool);
  const capabilities = adapter?.getCapabilities ? adapter.getCapabilities() : null;
  if (!isReadToolSupported(def, capabilities, { allowFetchLog: Boolean(toolContext?.allowFetchLog) })) {
    const reason = def.requiresOptInFetchLog && !toolContext?.allowFetchLog
      ? '요청 로그는 사용자가 패널에서 직접 로그 첨부를 켰을 때만 읽을 수 있습니다.'
      : `현재 호스트(${adapter?.detectHostFlavor?.()?.name || 'unknown'})에서는 ${tool} 도구를 지원하지 않습니다.`;
    return { tool, ok: false, label: describeToolCall(call), result: { ok: false, error: reason } };
  }

  try {
    let result;
    switch (tool) {
      case 'load_skill': {
        const ids = Array.isArray(args.skillIds)
          ? args.skillIds
          : [args.skillId ?? args.skill ?? args.id].filter(Boolean);
        result = loadSkillPack(ids, capabilities);
        for (const id of result.loaded || []) sharedUnlocks.skillIds.add(id);
        break;
      }
      case 'read_item':
        result = await runReadItem(adapter, args, sharedUnlocks);
        break;
      case 'list_items':
        result = await runListItems(adapter, args);
        break;
      case 'read_chat':
        result = await runReadChat(adapter, args);
        break;
      case 'read_vars':
        result = await runReadVars(adapter, args);
        break;
      case 'test_regex_cbs':
        result = await runTestRegexCbs(adapter, args);
        break;
      case 'active_lorebook':
        result = await runActiveLorebook(adapter);
        break;
      case 'audit_workspace':
        result = await runAuditWorkspace(adapter, args);
        break;
      case 'inspect_assets':
        result = await runInspectAssets(adapter, args);
        break;
      case 'read_fetch_log':
        result = await runReadFetchLog(adapter, args, toolContext);
        break;
      case 'host_info':
        result = await runHostInfo(adapter);
        break;
      case 'search_translation':
        result = await runSearchTranslation(adapter, args);
        break;
      default:
        result = { ok: false, error: `지원하지 않는 도구입니다: ${tool}` };
    }
    return {
      tool,
      ok: Boolean(result?.ok),
      label: describeToolCall(call),
      result,
    };
  } catch (err) {
    return {
      tool,
      ok: false,
      label: describeToolCall(call),
      result: { ok: false, error: err?.message || String(err) },
    };
  }
}

/**
 * Executes a batch of up to MAX_TOOLS_PER_CALL Read-Only tools in parallel and caps total
 * serialized output size so follow-up calls stay fast and bounded.
 */
async function executeReadToolBatch(adapter, calls = [], toolContext = {}) {
  const limited = (Array.isArray(calls) ? calls : []).slice(0, MAX_TOOLS_PER_CALL);
  const unlocks = {
    skillIds: new Set(),
    fieldsShownFull: new Set(),
    greetingsShownFull: new Set(),
  };

  const runs = await Promise.all(
    limited.map(call => executeReadTool(adapter, call, toolContext, unlocks))
  );

  // Format into size-bounded text blocks (strictly tagged as reference data, not instructions)
  const blocks = [];
  let usedChars = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    let serialized;
    if (run.tool === 'load_skill' && run.ok && run.result?.text) {
      serialized = run.result.text;
    } else {
      serialized = JSON.stringify(run.result, null, 2);
    }
    const perToolBudget = Math.min(MAX_TOOL_RESULT_CHARS, Math.max(800, MAX_BATCH_RESULT_CHARS - usedChars));
    const clipped = clipText(serialized, perToolBudget);
    usedChars += clipped.text.length;
    blocks.push(`### [${i + 1}] ${run.tool} (${run.label}) — ${run.ok ? '성공' : '실패'}\n${clipped.text}`);
    if (usedChars >= MAX_BATCH_RESULT_CHARS && i < runs.length - 1) {
      blocks.push(`... (나머지 ${runs.length - 1 - i}개 도구 결과는 크기 상한으로 생략됨)`);
      break;
    }
  }

  return {
    runs,
    formattedText: blocks.join('\n\n'),
    totalChars: usedChars,
    loadedSkillIds: [...unlocks.skillIds],
    fieldsShownFull: [...unlocks.fieldsShownFull],
    greetingsShownFull: [...unlocks.greetingsShownFull],
    droppedCount: Math.max(0, (Array.isArray(calls) ? calls.length : 0) - limited.length),
  };
}

export {
  READ_TOOL_DEFS,
  VALID_READ_TOOL_IDS,
  MAX_TOOLS_PER_CALL,
  MAX_TOOL_RESULT_CHARS,
  MAX_BATCH_RESULT_CHARS,
  isReadToolSupported,
  getAvailableReadTools,
  formatReadToolCatalog,
  describeToolCall,
  executeReadTool,
  executeReadToolBatch,
};
