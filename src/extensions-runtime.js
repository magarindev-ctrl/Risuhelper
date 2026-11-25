// SPDX-License-Identifier: GPL-3.0-only
// Declarative resident extensions runtime for RisuHelper (v1.0.0 · §6.1 ④).
// Covers Plugin v3 resident hook APIs strictly via declarative JSON rules —
// NEVER executes arbitrary model-authored JavaScript (`eval`/`Function` forbidden).
// Every signature matches upstream kwaroran/Risuai Plugin API v3 (`v3.svelte.ts` / `risuai.d.ts`):
// - addRisuScriptHandler(mode, fn) / removeRisuScriptHandler(mode, fn)
// - addRisuReplacer('beforeRequest', OpenAIChat[] => OpenAIChat[]) & ('afterRequest', string => string)
// - addRisuChatListener('output', ChatOutputListenerArg => void) / removeRisuChatListener('output', fn)
// - registerBodyIntercepter(fn) -> { id } / unregisterBodyIntercepter(id) (strict safe-key allowlist)
// - registerMCP({ identifier: 'plugin:...', ... }, getTools, callTool) / unregisterMCP(identifier)
// - addTTSPreprocessor(BeforeTTSContext => BeforeTTSResult | void)
// - addPluginChannelListener(channel, fn) / postPluginChannelMessage(targetPlugin, channel, msg)
// Includes static ReDoS rejection, per-rule runtime circuit breaker, safe-mode boot, and 1-click stop-all.

import { EXTENSIONS_STORAGE_KEY, VERSION } from './version.js';

const EXTENSION_TYPES = [
  'script_handler',
  'replacer',
  'chat_listener',
  'body_intercepter',
  'mcp_server',
  'tts_processor',
  'plugin_channel',
];

const EXTENSION_TYPE_LABELS = {
  script_handler: '전역 스크립트 (정규식)',
  replacer: '전역 텍스트 치환',
  chat_listener: '응답 후 점검 감시',
  body_intercepter: '요청 본문 파라미터 패치',
  mcp_server: '읽기 전용 MCP 도구 제공',
  tts_processor: 'TTS 합성 전 텍스트 정리',
  plugin_channel: '플러그인 채널 연동',
};

const VALID_SCRIPT_MODES = ['display', 'output', 'input', 'process'];
const VALID_REPLACER_STAGES = ['beforeRequest', 'afterRequest'];
const VALID_TTS_STAGES = ['pre'];
const SAFE_MCP_TOOLS = ['host_info', 'audit_workspace', 'active_lorebook', 'inspect_assets', 'read_vars'];
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Strict allowlist of pure LLM sampling/generation tuning parameters for `body_intercepter`.
// Blocks prompt/routing/model/auth/tool hijacking (`messages`, `model`, `stream`, `tools`,
// `functions`, `tool_choice`, `system`, `prompt`, `input`, `contents`, `apiKey`, `authorization`, `headers`, etc.).
const SAFE_BODY_PATCH_KEYS = new Set([
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'top_a',
  'typical_p',
  'tfs_z',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'presence_penalty',
  'frequency_penalty',
  'repetition_penalty',
  'repeat_penalty',
  'seed',
  'stop',
  'stop_sequences',
  'reasoning_effort',
  'reasoning',
  'thinking',
  'verbosity',
  'logit_bias',
  'response_format',
  'service_tier',
  'n',
  'logprobs',
  'top_logprobs',
  'include_reasoning',
]);

const MAX_EXTENSION_RULES = 50;
const MAX_REGEX_LENGTH = 500;
const DEFAULT_MAX_RULE_RUN_MS = 100;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function sanitizeRegexFlags(flags, fallback = 'g') {
  const raw = String(flags ?? fallback);
  return [...new Set(raw.replace(/[^gimsuy]/g, '').split(''))].join('');
}

/**
 * Static ReDoS guard rejecting catastrophic backtracking patterns before RegExp compilation.
 * Strips escaped characters and character classes before checking group nesting/quantifiers.
 */
function checkRegexSafety(pattern) {
  if (typeof pattern !== 'string' || !pattern) {
    return '정규식 pattern은 비어 있지 않은 문자열이어야 합니다.';
  }
  if (pattern.length > MAX_REGEX_LENGTH) {
    return `정규식 pattern이 너무 깁니다(최대 ${MAX_REGEX_LENGTH}자).`;
  }
  // Reject backreferences combined with quantifiers (e.g. `\1+`, `\1*`, `\1{2,}`)
  if (/\\[1-9]\s*(?:[+*]|\{\d+,)/.test(pattern)) {
    return '정규식에 역참조 수량자 등 ReDoS 위험 패턴이 포함되어 차단했습니다.';
  }

  // Strip escaped pairs and character class contents while preserving `[]` as an atom
  let stripped = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++; // skip escaped char
      if (!inClass) stripped += 'a';
      continue;
    }
    if (ch === '[' && !inClass) {
      inClass = true;
      stripped += 'a';
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      continue;
    }
    if (!inClass) stripped += ch;
  }

  // Reject illegal / suspicious consecutive quantifiers like `**`, `++`, `*+`, `+*`
  if (/(?:[+*]|\{\d+,\d*\})\s*(?:[+*]|\{\d+,)/.test(stripped)) {
    return '정규식에 연속 수량자 등 ReDoS 위험 패턴이 포함되어 차단했습니다.';
  }

  // Track group stack to detect nested quantifiers `(…+…)+` and quantified overlapping alternations `(a|aa)+`
  const stack = [];
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '(') {
      stack.push({ hasQuantifier: false, hasAlternation: false, hasWildcard: false, start: i });
      continue;
    }
    if (ch === ')') {
      const grp = stack.pop();
      if (!grp) continue;
      // Check if this closing group is immediately followed by a repeating quantifier (`+`, `*`, `{m,}`)
      const rest = stripped.slice(i + 1);
      const outerQuant = rest.match(/^(?:[+*]|\{\d+,\d*\})/);
      const isOuterRepeated = Boolean(outerQuant);
      if (isOuterRepeated) {
        if (grp.hasQuantifier) {
          return '정규식에 중첩 수량자((…+)+ 등) ReDoS 위험 패턴이 포함되어 차단했습니다.';
        }
        if (grp.hasAlternation) {
          const inner = stripped.slice(grp.start + 1, i).replace(/^\?(?::|=|!|<=|<!)/, '');
          const branches = inner.split('|').map(b => b.trim());
          const unique = new Set(branches);
          const hasPrefixOverlap = branches.some((a, ai) =>
            branches.some((b, bi) => ai !== bi && a && b && (a.startsWith(b) || b.startsWith(a)))
          );
          if (grp.hasWildcard || unique.size !== branches.length || hasPrefixOverlap) {
            return '정규식에 중첩 분기 수량자((a|aa)+ 등) ReDoS 위험 패턴이 포함되어 차단했습니다.';
          }
        }
      }
      // Propagate inner quantifier flag to enclosing parent group
      if (stack.length > 0 && (grp.hasQuantifier || isOuterRepeated)) {
        stack[stack.length - 1].hasQuantifier = true;
      }
      continue;
    }
    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (ch === '+' || ch === '*') top.hasQuantifier = true;
      else if (ch === '{' && /^\{\d+,\d*\}/.test(stripped.slice(i))) top.hasQuantifier = true;
      else if (ch === '|') top.hasAlternation = true;
      else if (ch === '.') top.hasWildcard = true;
    }
  }

  return null;
}

function compileSafeRegex(pattern, flags = 'g') {
  const safetyErr = checkRegexSafety(pattern);
  if (safetyErr) throw new Error(safetyErr);
  const cleanFlags = sanitizeRegexFlags(flags, 'g');
  return new RegExp(pattern, cleanFlags);
}

function hasForbiddenBodyKey(key) {
  const k = String(key ?? '').trim();
  if (!k || BAD_KEYS.has(k)) return true;
  return !SAFE_BODY_PATCH_KEYS.has(k);
}

function makeExtensionId(type, name = '') {
  const slug = String(name || type)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || type;
  const rand = Math.random().toString(36).slice(2, 8);
  return `ext_${type}_${slug}_${rand}`;
}

/**
 * Validates and normalizes a declarative extension rule.
 * Returns `{ ok: true, rule }` or `{ ok: false, error }`.
 */
function validateExtensionRule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '확장 규칙은 JSON 객체여야 합니다.' };
  }
  for (const k of Object.keys(raw)) {
    if (BAD_KEYS.has(k)) return { ok: false, error: `허용되지 않는 키입니다: ${k}` };
  }
  if (typeof raw.code === 'string' || typeof raw.js === 'string' || typeof raw.script === 'string' || typeof raw.fn === 'string') {
    return { ok: false, error: '임의 JavaScript 코드 실행은 보안 원칙상 금지되어 있습니다. 선언형 규칙 필드만 사용하세요.' };
  }
  const type = String(raw.type || '').trim();
  if (!EXTENSION_TYPES.includes(type)) {
    return { ok: false, error: `지원하지 않는 확장 종류입니다: ${type || '(없음)'}. 허용값: ${EXTENSION_TYPES.join(', ')}` };
  }
  const name = String(raw.name || EXTENSION_TYPE_LABELS[type] || type).trim().slice(0, 80);
  const id = String(raw.id || makeExtensionId(type, name)).trim().slice(0, 64);
  const enabled = raw.enabled !== false;

  const base = { id, type, name, enabled };

  if (type === 'script_handler') {
    const mode = String(raw.mode || 'display').trim();
    if (!VALID_SCRIPT_MODES.includes(mode)) {
      return { ok: false, error: `script_handler의 mode는 ${VALID_SCRIPT_MODES.join('/')} 중 하나여야 합니다.` };
    }
    try {
      compileSafeRegex(raw.pattern, raw.flags ?? 'g');
    } catch (err) {
      return { ok: false, error: `정규식 문법/안전 오류: ${err.message}` };
    }
    if (typeof raw.replacement !== 'string') {
      return { ok: false, error: 'script_handler에는 replacement 문자열이 필요합니다.' };
    }
    return {
      ok: true,
      rule: {
        ...base,
        mode,
        pattern: raw.pattern,
        flags: sanitizeRegexFlags(raw.flags, 'g'),
        replacement: raw.replacement,
      },
    };
  }

  if (type === 'replacer') {
    const stage = String(raw.stage || 'afterRequest').trim();
    if (!VALID_REPLACER_STAGES.includes(stage)) {
      const hint = stage === 'display'
        ? ' 화면 표시용 치환은 script_handler(mode: "display")를 사용하세요.'
        : '';
      return { ok: false, error: `replacer의 stage는 ${VALID_REPLACER_STAGES.join('/')} 중 하나여야 합니다.${hint}` };
    }
    if (typeof raw.find !== 'string' || !raw.find) {
      return { ok: false, error: 'replacer에는 비어 있지 않은 find 문자열이 필요합니다.' };
    }
    if (typeof raw.replace !== 'string') {
      return { ok: false, error: 'replacer에는 replace 문자열이 필요합니다.' };
    }
    const useRegex = Boolean(raw.useRegex);
    const flags = sanitizeRegexFlags(raw.flags, 'g');
    if (useRegex) {
      try {
        compileSafeRegex(raw.find, flags);
      } catch (err) {
        return { ok: false, error: `replacer 정규식 오류: ${err.message}` };
      }
    }
    return {
      ok: true,
      rule: { ...base, stage, find: raw.find, replace: raw.replace, useRegex, flags },
    };
  }

  if (type === 'chat_listener') {
    const requirePatterns = Array.isArray(raw.requirePatterns) ? raw.requirePatterns.map(String).filter(Boolean).slice(0, 10) : [];
    const forbidPatterns = Array.isArray(raw.forbidPatterns) ? raw.forbidPatterns.map(String).filter(Boolean).slice(0, 10) : [];
    const watchVars = Array.isArray(raw.watchVars) ? raw.watchVars.map(v => String(v).replace(/^\$/, '').trim()).filter(Boolean).slice(0, 20) : [];
    if (requirePatterns.length === 0 && forbidPatterns.length === 0 && watchVars.length === 0) {
      return { ok: false, error: 'chat_listener에는 requirePatterns, forbidPatterns, watchVars 중 하나 이상이 필요합니다.' };
    }
    for (const p of [...requirePatterns, ...forbidPatterns]) {
      try {
        compileSafeRegex(p, '');
      } catch (err) {
        return { ok: false, error: `chat_listener 패턴 오류("${p}"): ${err.message}` };
      }
    }
    const notifyLabel = String(raw.notifyLabel || name || '응답 점검 알림').trim().slice(0, 80);
    return {
      ok: true,
      rule: { ...base, requirePatterns, forbidPatterns, watchVars, notifyLabel },
    };
  }

  if (type === 'body_intercepter') {
    const setObj = raw.set && typeof raw.set === 'object' && !Array.isArray(raw.set) ? raw.set : {};
    const removeKeys = Array.isArray(raw.removeKeys) ? raw.removeKeys.map(String).filter(Boolean).slice(0, 20) : [];
    const setEntries = Object.entries(setObj);
    if (setEntries.length === 0 && removeKeys.length === 0) {
      return { ok: false, error: 'body_intercepter에는 set 객체 또는 removeKeys 배열 중 하나 이상이 필요합니다.' };
    }
    const cleanSet = {};
    for (const [k, v] of setEntries) {
      if (hasForbiddenBodyKey(k)) {
        return {
          ok: false,
          error: `보안상 요청 본문 키 "${k}"는 수정할 수 없습니다. 안전한 샘플링·생성 파라미터(temperature, top_p, top_k, max_tokens, seed, reasoning_effort 등)만 허용됩니다.`,
        };
      }
      if (typeof v === 'function' || typeof v === 'symbol') {
        return { ok: false, error: `body_intercepter의 set["${k}"]는 JSON 직렬화 가능한 값이어야 합니다.` };
      }
      cleanSet[k] = v;
    }
    for (const k of removeKeys) {
      if (hasForbiddenBodyKey(k)) {
        return {
          ok: false,
          error: `보안상 요청 본문 키 "${k}"는 제거 대상으로 지정할 수 없습니다. 안전한 샘플링·생성 파라미터만 허용됩니다.`,
        };
      }
    }
    const matchModelRegex = typeof raw.matchModelRegex === 'string' && raw.matchModelRegex.trim()
      ? raw.matchModelRegex.trim()
      : '';
    if (matchModelRegex) {
      try {
        compileSafeRegex(matchModelRegex, 'i');
      } catch (err) {
        return { ok: false, error: `matchModelRegex 정규식 오류: ${err.message}` };
      }
    }
    return {
      ok: true,
      rule: { ...base, matchModelRegex, set: cleanSet, removeKeys },
    };
  }

  if (type === 'mcp_server') {
    const requested = Array.isArray(raw.exposedTools) && raw.exposedTools.length > 0
      ? raw.exposedTools.map(String)
      : [...SAFE_MCP_TOOLS];
    const invalid = requested.filter(t => !SAFE_MCP_TOOLS.includes(t));
    if (invalid.length > 0) {
      return {
        ok: false,
        error: `MCP는 안전한 읽기 전용 도구(${SAFE_MCP_TOOLS.join(', ')})만 노출할 수 있습니다. 허용 불가: ${invalid.join(', ')}`,
      };
    }
    const exposedTools = [...new Set(requested)];
    return {
      ok: true,
      rule: { ...base, exposedTools },
    };
  }

  if (type === 'tts_processor') {
    const stage = String(raw.stage || 'pre').trim();
    if (!VALID_TTS_STAGES.includes(stage)) {
      return {
        ok: false,
        error: 'tts_processor는 합성 전 텍스트를 정리하는 stage: "pre"(addTTSPreprocessor)만 지원합니다(addTTSPostprocessor는 오디오 ArrayBuffer 전용입니다).',
      };
    }
    const stripTags = Boolean(raw.stripTags);
    const stripAsterisks = Boolean(raw.stripAsterisks);
    const stripCodeBlocks = Boolean(raw.stripCodeBlocks);
    const pattern = typeof raw.pattern === 'string' ? raw.pattern : '';
    const flags = sanitizeRegexFlags(raw.flags, 'g');
    const replacement = typeof raw.replacement === 'string' ? raw.replacement : '';
    if (pattern) {
      try {
        compileSafeRegex(pattern, flags);
      } catch (err) {
        return { ok: false, error: `tts_processor 정규식 오류: ${err.message}` };
      }
    }
    if (!stripTags && !stripAsterisks && !stripCodeBlocks && !pattern) {
      return { ok: false, error: 'tts_processor에는 stripTags/stripAsterisks/stripCodeBlocks 또는 pattern 중 하나 이상이 필요합니다.' };
    }
    return {
      ok: true,
      rule: { ...base, stage, stripTags, stripAsterisks, stripCodeBlocks, pattern, flags, replacement },
    };
  }

  if (type === 'plugin_channel') {
    const channel = String(raw.channel || 'risuhelper:v1').trim().slice(0, 64);
    if (!channel) return { ok: false, error: 'plugin_channel에는 channel 이름이 필요합니다.' };
    const targetPlugin = typeof raw.targetPlugin === 'string' ? raw.targetPlugin.trim().slice(0, 64) : '';
    const allowReadOnlyQueries = raw.allowReadOnlyQueries !== false;
    const initialMessage = raw.initialMessage && typeof raw.initialMessage === 'object' && !Array.isArray(raw.initialMessage)
      ? raw.initialMessage
      : null;
    return {
      ok: true,
      rule: { ...base, channel, targetPlugin, allowReadOnlyQueries, initialMessage },
    };
  }

  return { ok: false, error: `알 수 없는 확장 종류입니다: ${type}` };
}

function applyReplacerText(rule, text) {
  const src = String(text ?? '');
  if (rule.useRegex) {
    return src.replace(compileSafeRegex(rule.find, rule.flags || 'g'), rule.replace);
  }
  return src.split(rule.find).join(rule.replace);
}

/**
 * Applies a `replacer` rule respecting upstream Plugin API v3 contracts:
 * - `beforeRequest` receives `OpenAIChat[]` and MUST return `OpenAIChat[]` (never a string!)
 * - `afterRequest` receives `string` and returns `string`
 */
function applyReplacerValue(rule, input) {
  if (rule.stage === 'beforeRequest') {
    if (Array.isArray(input)) {
      return input.map((msg) => {
        if (!msg || typeof msg !== 'object') return msg;
        if (typeof msg.content === 'string') {
          return { ...msg, content: applyReplacerText(rule, msg.content) };
        }
        return msg;
      });
    }
    if (typeof input === 'string') {
      return applyReplacerText(rule, input);
    }
    return input;
  }
  return applyReplacerText(rule, input);
}

function applyTtsTransform(rule, text) {
  let out = String(text ?? '');
  if (rule.stripCodeBlocks) {
    out = out.replace(/```[\s\S]*?```/g, ' ');
  }
  if (rule.stripTags) {
    out = out.replace(/<[^>]+>/g, '');
  }
  if (rule.stripAsterisks) {
    out = out.replace(/\*([^*\n]+)\*/g, '$1');
  }
  if (rule.pattern) {
    const re = compileSafeRegex(rule.pattern, rule.flags || 'g');
    out = out.replace(re, rule.replacement ?? '');
  }
  return out;
}

function applyBodyPatch(rule, rawBody) {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) return rawBody;
  if (rule.matchModelRegex) {
    const modelStr = String(rawBody.model ?? rawBody.modelName ?? '');
    const re = compileSafeRegex(rule.matchModelRegex, 'i');
    if (!re.test(modelStr)) return rawBody;
  }
  const next = { ...rawBody };
  for (const [k, v] of Object.entries(rule.set || {})) {
    if (!hasForbiddenBodyKey(k)) next[k] = v;
  }
  for (const k of rule.removeKeys || []) {
    if (!hasForbiddenBodyKey(k)) delete next[k];
  }
  return next;
}

/**
 * Evaluates a `chat_listener` rule against either:
 * - Real upstream `ChatOutputListenerArg`: `{ char, chat, characterIndex, chatIndex, messageIndex }`
 * - Direct dry-run sample: `{ data, scriptstate }` or string
 */
function inspectChatPayload(rule, payload) {
  let text = '';
  let vars = {};

  if (payload && typeof payload === 'object' && payload.chat && typeof payload.chat === 'object') {
    const msgIdx = payload.messageIndex;
    if (msgIdx === -1) return []; // Output message was removed by Lua/host processing
    const msgs = Array.isArray(payload.chat.message) ? payload.chat.message : [];
    const target = Number.isInteger(msgIdx) && msgIdx >= 0 ? msgs[msgIdx] : msgs[msgs.length - 1];
    if (!target) return [];
    text = String(target.data ?? '');
    vars = payload.chat.scriptstate && typeof payload.chat.scriptstate === 'object'
      ? payload.chat.scriptstate
      : {};
  } else if (typeof payload === 'string') {
    text = payload;
  } else if (payload && typeof payload === 'object') {
    text = String(payload.data ?? payload.content ?? payload.message ?? '');
    vars = payload.scriptstate && typeof payload.scriptstate === 'object' ? payload.scriptstate : {};
  }

  const warnings = [];
  for (const p of rule.requirePatterns || []) {
    const re = compileSafeRegex(p, '');
    if (!re.test(text)) warnings.push(`필수 패턴 누락: /${p}/`);
  }
  for (const p of rule.forbidPatterns || []) {
    const re = compileSafeRegex(p, '');
    if (re.test(text)) warnings.push(`금지 패턴 감지: /${p}/`);
  }
  for (const v of rule.watchVars || []) {
    const val = vars[`$${v}`] ?? vars[v];
    if (val === undefined || val === null || val === '') {
      warnings.push(`감시 변수 누락/비어 있음: ${v}`);
    }
  }
  return warnings;
}

/**
 * Pure side-effect-free dry-run preview for any declarative extension rule.
 */
function dryRunExtensionRule(rawRule, sampleInput = null) {
  const checked = validateExtensionRule(rawRule);
  if (!checked.ok) return { ok: false, error: checked.error };
  const rule = checked.rule;

  if (rule.type === 'script_handler') {
    const input = typeof sampleInput === 'string' ? sampleInput : '[HP:80] *테스트 대사*';
    const re = compileSafeRegex(rule.pattern, rule.flags || 'g');
    const output = input.replace(re, rule.replacement);
    return { ok: true, type: rule.type, input, output, changed: input !== output };
  }
  if (rule.type === 'replacer') {
    if (rule.stage === 'beforeRequest') {
      const input = Array.isArray(sampleInput)
        ? sampleInput
        : [{ role: 'user', content: `${rule.find} 예시 요청 메시지` }];
      const output = applyReplacerValue(rule, input);
      return { ok: true, type: rule.type, stage: rule.stage, input, output, changed: JSON.stringify(input) !== JSON.stringify(output) };
    }
    const input = typeof sampleInput === 'string' ? sampleInput : `${rule.find} 예시 텍스트`;
    const output = applyReplacerValue(rule, input);
    return { ok: true, type: rule.type, stage: rule.stage, input, output, changed: input !== output };
  }
  if (rule.type === 'body_intercepter') {
    const input = sampleInput && typeof sampleInput === 'object' && !Array.isArray(sampleInput)
      ? sampleInput
      : { model: 'gpt-4.1', temperature: 0.8, max_tokens: 2048 };
    const output = applyBodyPatch(rule, input);
    return {
      ok: true,
      type: rule.type,
      input,
      output,
      changed: JSON.stringify(input) !== JSON.stringify(output),
    };
  }
  if (rule.type === 'tts_processor') {
    const input = typeof sampleInput === 'string'
      ? sampleInput
      : '<status>HP 80</status> *조용히 웃으며* 안녕하세요. ```lua\nx=1\n```';
    const output = applyTtsTransform(rule, input);
    return { ok: true, type: rule.type, input, output, changed: input !== output };
  }
  if (rule.type === 'chat_listener') {
    const input = sampleInput ?? {
      chat: { message: [{ role: 'char', data: '테스트 응답 본문' }], scriptstate: {} },
      messageIndex: 0,
    };
    const warnings = inspectChatPayload(rule, input);
    return { ok: true, type: rule.type, warnings, triggered: warnings.length > 0 };
  }
  if (rule.type === 'mcp_server') {
    return { ok: true, type: rule.type, exposedTools: rule.exposedTools, readOnly: true };
  }
  if (rule.type === 'plugin_channel') {
    return {
      ok: true,
      type: rule.type,
      channel: rule.channel,
      targetPlugin: rule.targetPlugin || null,
      allowReadOnlyQueries: rule.allowReadOnlyQueries,
    };
  }
  return { ok: true, type: rule.type };
}

function requiredCapabilityForExtensionType(type) {
  switch (type) {
    case 'body_intercepter': return 'bodyIntercepter';
    case 'chat_listener': return 'chatListener';
    case 'mcp_server': return 'mcp';
    case 'tts_processor': return 'ttsHooks';
    case 'plugin_channel': return 'pluginChannel';
    default: return null; // script_handler & replacer exist on all 6 hosts
  }
}

class ExtensionRuntime {
  constructor(api, options = {}) {
    this.api = api;
    this.adapter = options.adapter || null;
    this.onAlert = typeof options.onAlert === 'function' ? options.onAlert : null;
    this.readToolRunner = typeof options.readToolRunner === 'function' ? options.readToolRunner : null;
    this.maxRuleRunMs = Number(options.maxRuleRunMs) > 0 ? Number(options.maxRuleRunMs) : DEFAULT_MAX_RULE_RUN_MS;
    this.maxConsecutiveErrors = Number(options.maxConsecutiveErrors) > 0
      ? Number(options.maxConsecutiveErrors)
      : DEFAULT_MAX_CONSECUTIVE_ERRORS;
    this.rules = [];
    this._activeHandles = new Map(); // ruleId -> cleanup fn
    this._ruleStats = new Map(); // ruleId -> { consecutiveErrors, lastError, trippedReason, lastMs }
    this._ttsPreInstalled = false;
    this._disposed = false;
    this.recentAlerts = [];
  }

  _hasCap(cap) {
    if (!cap) return true;
    if (this.adapter && typeof this.adapter.hasCapability === 'function') {
      return this.adapter.hasCapability(cap);
    }
    return true;
  }

  isTypeSupported(type) {
    const cap = requiredCapabilityForExtensionType(type);
    return this._hasCap(cap);
  }

  _stat(ruleId) {
    let st = this._ruleStats.get(ruleId);
    if (!st) {
      st = { consecutiveErrors: 0, lastError: null, trippedReason: null, lastMs: 0 };
      this._ruleStats.set(ruleId, st);
    }
    return st;
  }

  _emitAlert(ruleId, label, warnings) {
    const alert = { ruleId, label, warnings, at: Date.now() };
    this.recentAlerts.push(alert);
    if (this.recentAlerts.length > 20) this.recentAlerts.shift();
    if (this.onAlert) {
      try { this.onAlert(alert); } catch {}
    }
  }

  _tripRule(rule, reason) {
    const st = this._stat(rule.id);
    st.trippedReason = reason;
    st.lastError = reason;
    rule.enabled = false;
    this._unregisterRule(rule.id).catch(() => {});
    this.save().catch(() => {});
    this._emitAlert(rule.id, `${rule.name} (안전 자동 중지)`, [reason]);
  }

  /**
   * Executes a synchronous hook body with runtime error + latency circuit breaking.
   * Always returns `fallbackValue` on error so host chat/rendering never breaks.
   */
  _runRuleGuarded(rule, workFn, fallbackValue) {
    if (this._disposed || !rule.enabled) return fallbackValue;
    const st = this._stat(rule.id);
    const t0 = nowMs();
    try {
      const result = workFn();
      const dt = nowMs() - t0;
      st.lastMs = dt;
      st.consecutiveErrors = 0;
      if (dt > this.maxRuleRunMs) {
        this._tripRule(rule, `실행 지연(${Math.round(dt)}ms > ${this.maxRuleRunMs}ms)으로 자동 중지되었습니다.`);
        return fallbackValue;
      }
      return result;
    } catch (err) {
      st.consecutiveErrors += 1;
      st.lastError = err?.message || String(err);
      if (st.consecutiveErrors >= this.maxConsecutiveErrors) {
        this._tripRule(rule, `연속 오류 ${st.consecutiveErrors}회(${st.lastError})로 자동 중지되었습니다.`);
      }
      return fallbackValue;
    }
  }

  async load({ autoRestore = true } = {}) {
    this._disposed = false;
    try {
      const storage = this.api?.pluginStorage;
      if (storage && typeof storage.getItem === 'function') {
        const raw = await storage.getItem(EXTENSIONS_STORAGE_KEY);
        if (raw) {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            this.rules = [];
            for (const item of parsed.slice(0, MAX_EXTENSION_RULES)) {
              const checked = validateExtensionRule(item);
              if (checked.ok) this.rules.push(checked.rule);
            }
          }
        }
      }
    } catch {
      this.rules = [];
    }
    if (autoRestore) {
      await this.syncAll();
    } else {
      await this._unregisterAllHandles();
    }
    return this.list();
  }

  async save() {
    try {
      const storage = this.api?.pluginStorage;
      if (storage && typeof storage.setItem === 'function') {
        await storage.setItem(EXTENSIONS_STORAGE_KEY, JSON.stringify(this.rules));
      }
    } catch {}
  }

  list() {
    return this.rules.map(r => {
      const st = this._ruleStats.get(r.id);
      return {
        ...r,
        typeLabel: EXTENSION_TYPE_LABELS[r.type] || r.type,
        supported: this.isTypeSupported(r.type),
        active: this._activeHandles.has(r.id) || (r.type === 'tts_processor' && r.enabled && !this._disposed && this.isTypeSupported(r.type)),
        lastError: st?.lastError || null,
        trippedReason: st?.trippedReason || null,
      };
    });
  }

  get(id) {
    return this.rules.find(r => r.id === id) || null;
  }

  async upsert(rawRule) {
    const checked = validateExtensionRule(rawRule);
    if (!checked.ok) throw new Error(checked.error);
    const rule = checked.rule;
    if (!this.isTypeSupported(rule.type)) {
      throw new Error(`현재 호스트는 "${EXTENSION_TYPE_LABELS[rule.type] || rule.type}"(${rule.type}) 확장 API를 지원하지 않습니다.`);
    }
    const idx = this.rules.findIndex(r => r.id === rule.id);
    const prevRule = idx >= 0 ? this.rules[idx] : null;
    if (idx < 0 && this.rules.length >= MAX_EXTENSION_RULES) {
      throw new Error(`상주 확장 규칙은 최대 ${MAX_EXTENSION_RULES}개까지 등록할 수 있습니다.`);
    }

    // Reset breaker state on fresh upsert
    this._ruleStats.delete(rule.id);

    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);

    try {
      await this._syncRule(rule);
    } catch (err) {
      // Roll back in-memory rule if host registration rejected (e.g. user denied 'replacer' permission)
      if (prevRule) {
        this.rules[idx] = prevRule;
        await this._syncRule(prevRule).catch(() => {});
      } else {
        const addedIdx = this.rules.findIndex(r => r.id === rule.id);
        if (addedIdx >= 0) this.rules.splice(addedIdx, 1);
      }
      throw err;
    }

    await this.save();
    return rule;
  }

  async toggle(id, enabled) {
    const rule = this.get(id);
    if (!rule) throw new Error(`확장 규칙(${id})을 찾을 수 없습니다.`);
    const prev = rule.enabled;
    rule.enabled = Boolean(enabled);
    if (rule.enabled) this._ruleStats.delete(rule.id);
    try {
      await this._syncRule(rule);
    } catch (err) {
      rule.enabled = prev;
      throw err;
    }
    await this.save();
    return rule;
  }

  async remove(id) {
    const idx = this.rules.findIndex(r => r.id === id);
    if (idx < 0) throw new Error(`확장 규칙(${id})을 찾을 수 없습니다.`);
    const [removed] = this.rules.splice(idx, 1);
    this._ruleStats.delete(id);
    await this._unregisterRule(id);
    await this.save();
    return removed;
  }

  /**
   * Emergency stop: disables and unregisters every resident extension immediately.
   */
  async disableAll() {
    let stopped = 0;
    for (const rule of this.rules) {
      if (rule.enabled) {
        rule.enabled = false;
        stopped++;
      }
    }
    await this._unregisterAllHandles();
    await this.save();
    return stopped;
  }

  async replaceAll(rulesList = []) {
    await this._unregisterAllHandles();
    this.rules = [];
    this._ruleStats.clear();
    for (const item of (Array.isArray(rulesList) ? rulesList : []).slice(0, MAX_EXTENSION_RULES)) {
      const checked = validateExtensionRule(item);
      if (checked.ok) this.rules.push(checked.rule);
    }
    await this.syncAll();
    await this.save();
    return this.list();
  }

  async syncAll() {
    if (this._disposed) return;
    await this._unregisterAllHandles();
    let dirty = false;
    for (const rule of this.rules) {
      if (rule.enabled && this.isTypeSupported(rule.type)) {
        try {
          await this._registerRule(rule);
        } catch (err) {
          // Isolate startup failure so one broken/denied rule never blocks RisuHelper boot
          const st = this._stat(rule.id);
          st.lastError = err?.message || String(err);
          st.trippedReason = `시작 복원 실패: ${st.lastError}`;
          rule.enabled = false;
          dirty = true;
        }
      }
    }
    if (dirty) await this.save();
  }

  async _syncRule(rule) {
    await this._unregisterRule(rule.id);
    if (!this._disposed && rule.enabled && this.isTypeSupported(rule.type)) {
      await this._registerRule(rule);
    }
  }

  async _unregisterRule(id) {
    const cleanup = this._activeHandles.get(id);
    if (typeof cleanup === 'function') {
      this._activeHandles.delete(id);
      try { await cleanup(); } catch {}
    }
  }

  async _unregisterAllHandles() {
    const ids = [...this._activeHandles.keys()];
    for (const id of ids) {
      await this._unregisterRule(id);
    }
  }

  async _ensureTtsPreDispatcher() {
    if (this._ttsPreInstalled || typeof this.api?.addTTSPreprocessor !== 'function') return;
    this._ttsPreInstalled = true;
    const fn = (ctx) => {
      const isObj = ctx && typeof ctx === 'object' && typeof ctx.text === 'string';
      if (this._disposed) return isObj ? undefined : ctx;
      const orig = isObj ? ctx.text : String(ctx ?? '');
      let out = orig;
      for (const r of this.rules) {
        if (r.type === 'tts_processor' && r.enabled && r.stage === 'pre') {
          out = this._runRuleGuarded(r, () => applyTtsTransform(r, out), out);
        }
      }
      if (isObj) return out === orig ? undefined : { text: out };
      return out;
    };
    await this.api.addTTSPreprocessor(fn);
  }

  async _registerRule(rule) {
    const api = this.api;
    if (!api) return;

    if (rule.type === 'script_handler' && typeof api.addRisuScriptHandler === 'function') {
      const fn = (content) => this._runRuleGuarded(
        rule,
        () => {
          const re = compileSafeRegex(rule.pattern, rule.flags || 'g');
          return String(content ?? '').replace(re, rule.replacement);
        },
        content
      );
      await api.addRisuScriptHandler(rule.mode, fn);
      this._activeHandles.set(rule.id, async () => {
        if (typeof api.removeRisuScriptHandler === 'function') {
          await api.removeRisuScriptHandler(rule.mode, fn);
        }
      });
      return;
    }

    if (rule.type === 'replacer' && typeof api.addRisuReplacer === 'function') {
      const fn = (input, _type) => this._runRuleGuarded(
        rule,
        () => applyReplacerValue(rule, input),
        input
      );
      await api.addRisuReplacer(rule.stage, fn);
      this._activeHandles.set(rule.id, async () => {
        if (typeof api.removeRisuReplacer === 'function') {
          await api.removeRisuReplacer(rule.stage, fn);
        }
      });
      return;
    }

    if (rule.type === 'chat_listener' && typeof api.addRisuChatListener === 'function') {
      const fn = (payload) => {
        this._runRuleGuarded(
          rule,
          () => {
            const warnings = inspectChatPayload(rule, payload);
            if (warnings.length > 0) {
              this._emitAlert(rule.id, rule.notifyLabel || rule.name, warnings);
            }
            return undefined;
          },
          undefined
        );
      };
      // Upstream Plugin API v3 requires explicit mode `'output'` as the 1st argument
      await api.addRisuChatListener('output', fn);
      this._activeHandles.set(rule.id, async () => {
        if (typeof api.removeRisuChatListener === 'function') {
          await api.removeRisuChatListener('output', fn);
        }
      });
      return;
    }

    if (rule.type === 'body_intercepter' && typeof api.registerBodyIntercepter === 'function') {
      const fn = (body, _type) => this._runRuleGuarded(
        rule,
        () => applyBodyPatch(rule, body),
        body
      );
      // Upstream Plugin API v3 returns `{ id: string } | null` (null if 'replacer' permission denied)
      const handle = await api.registerBodyIntercepter(fn);
      if (!handle || typeof handle.id !== 'string' || !handle.id) {
        throw new Error('요청 본문 패치 권한(replacer)이 거부되어 등록하지 못했습니다.');
      }
      const interceptorId = handle.id;
      this._activeHandles.set(rule.id, async () => {
        if (typeof api.unregisterBodyIntercepter === 'function') {
          await api.unregisterBodyIntercepter(interceptorId);
        }
      });
      return;
    }

    if (rule.type === 'mcp_server' && typeof api.registerMCP === 'function') {
      const identifier = `plugin:risuhelper:${rule.id}`;
      const getTools = async () => rule.exposedTools.map(toolId => ({
        name: `risuhelper_${toolId}`,
        description: `RisuHelper Read-Only diagnostic tool: ${toolId}`,
        inputSchema: { type: 'object', properties: {} },
      }));
      const callTool = async (name, args = {}) => {
        const toolId = String(name || '').replace(/^risuhelper_/, '');
        if (!rule.exposedTools.includes(toolId) || !SAFE_MCP_TOOLS.includes(toolId)) {
          return [{ type: 'text', text: JSON.stringify({ ok: false, error: `허용되지 않는 MCP 도구입니다: ${name}` }) }];
        }
        if (this.readToolRunner) {
          const res = await this.readToolRunner(toolId, args);
          return [{ type: 'text', text: JSON.stringify(res) }];
        }
        return [{ type: 'text', text: JSON.stringify({ ok: true, tool: toolId, version: VERSION }) }];
      };
      await api.registerMCP(
        {
          identifier,
          name: rule.name || 'RisuHelper Diagnostics (Read-Only)',
          version: VERSION,
          description: 'RisuHelper Read-Only diagnostic tools',
        },
        getTools,
        callTool
      );
      this._activeHandles.set(rule.id, async () => {
        if (typeof api.unregisterMCP === 'function') {
          await api.unregisterMCP(identifier);
        }
      });
      return;
    }

    if (rule.type === 'tts_processor') {
      await this._ensureTtsPreDispatcher();
      this._activeHandles.set(rule.id, async () => {});
      return;
    }

    if (rule.type === 'plugin_channel' && typeof api.addPluginChannelListener === 'function') {
      let active = true;
      const listener = async (msg) => {
        if (!active || this._disposed || !rule.allowReadOnlyQueries) return;
        if (!msg || typeof msg !== 'object') return;
        const kind = String(msg.type || '');
        const replyPlugin = String(msg.replyToPlugin || rule.targetPlugin || '').trim();
        if (kind === 'risuhelper:ping' && replyPlugin && typeof api.postPluginChannelMessage === 'function') {
          try {
            // Upstream Plugin API v3 takes 3 arguments: (pluginName, channelName, message)
            await api.postPluginChannelMessage(replyPlugin, rule.channel, {
              type: 'risuhelper:pong',
              version: VERSION,
              capabilities: this.adapter?.capabilities || null,
            });
          } catch {}
        }
      };
      const maybeUnsub = await api.addPluginChannelListener(rule.channel, listener);
      if (rule.initialMessage && rule.targetPlugin && typeof api.postPluginChannelMessage === 'function') {
        try {
          await api.postPluginChannelMessage(rule.targetPlugin, rule.channel, {
            ...rule.initialMessage,
            source: 'risuhelper',
            version: VERSION,
          });
        } catch {}
      }
      this._activeHandles.set(rule.id, async () => {
        active = false;
        if (typeof maybeUnsub === 'function') {
          try { await maybeUnsub(); } catch {}
        }
      });
    }
  }

  async sendChannelMessage(targetPlugin, channel, payload) {
    if (!this._hasCap('pluginChannel') || typeof this.api?.postPluginChannelMessage !== 'function') {
      throw new Error('현재 호스트는 PluginChannel API를 지원하지 않습니다.');
    }
    const target = String(targetPlugin || '').trim();
    if (!target) {
      throw new Error('수신 대상 플러그인 이름(targetPlugin)이 필요합니다.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('채널 메시지는 JSON 객체여야 합니다.');
    }
    await this.api.postPluginChannelMessage(target, String(channel || 'risuhelper:v1'), {
      ...payload,
      source: 'risuhelper',
      version: VERSION,
    });
    return true;
  }

  async dispose() {
    this._disposed = true;
    await this._unregisterAllHandles();
  }
}

export {
  EXTENSION_TYPES,
  EXTENSION_TYPE_LABELS,
  VALID_SCRIPT_MODES,
  VALID_REPLACER_STAGES,
  VALID_TTS_STAGES,
  SAFE_BODY_PATCH_KEYS,
  SAFE_MCP_TOOLS,
  MAX_EXTENSION_RULES,
  checkRegexSafety,
  validateExtensionRule,
  dryRunExtensionRule,
  applyReplacerValue,
  inspectChatPayload,
  requiredCapabilityForExtensionType,
  ExtensionRuntime,
};
