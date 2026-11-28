// SPDX-License-Identifier: GPL-3.0-only
// BotBuilder-compatible prompt preset engine adapted for RisuHelper (direct send vs preset mode).

import { normalizePreset, PRESET_LIMIT } from './preset-format.js';
import { parseToggleTree, toggleDefault } from './preset-v2.js';
import { calculatePreset } from './preset-calc.js';
import { normalizeModules, validateModuleOptions, activeModules, moduleMatches, moduleOptions, moduleRuntimeProfile, presetRegexProfile } from './preset-modules.js';

const MAX_INPUT_CHARS = 10_000_000;
const CBS_BYTES_LIMIT = PRESET_LIMIT;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

function byteLength(str) {
  return new TextEncoder().encode(String(str)).length;
}

function clone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseVariables(source) {
  const out = {};
  for (const line of String(source ?? '').split('\n')) {
    const trimmed = line.replace(/\r$/, '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !BAD_KEYS.has(key)) out[key] = val;
  }
  return out;
}

const BLOCK_TYPES = [
  ['plain', '일반 프롬프트'],
  ['chat', '대화 기록'],
  ['description', '캐릭터 설명'],
  ['persona', '페르소나'],
  ['lorebook', '로어북'],
  ['authornote', '작가 노트'],
  ['postEverything', '마지막 지시'],
  ['memory', '메모리 입력'],
  ['chatML', 'ChatML'],
  ['jailbreak', '구형 추가 프롬프트'],
  ['cot', '구형 CoT 블록'],
  ['cache', '캐시 지점'],
];

function newPresetState() {
  return {
    schemaVersion: 1,
    mode: 'direct', // 'direct' | 'preset'
    preset: null,
    modules: [],
    moduleOptions: {},
    values: {},
    selectedBlock: 0,
    pane: 'blocks', // 'blocks' | 'toggles' | 'modules' | 'preview'
    environment: {
      userName: '사용자',
      persona: '',
      authorNote: '',
      memory: '',
      globals: {},
    },
    excluded: {
      regex: false,
      modules: false,
      overlay: false,
    },
  };
}

function validatePresetState(raw) {
  assert(raw?.schemaVersion === 1 && ['direct', 'preset'].includes(raw.mode), '지원하지 않는 프리셋 설정 형식입니다.');
  const result = { ...newPresetState(), ...clone(raw) };
  if (result.preset) result.preset = normalizePreset(result.preset);
  assert(result.values && typeof result.values === 'object' && !Array.isArray(result.values), '토글 값 형식이 올바르지 않습니다.');
  result.environment = { ...newPresetState().environment, ...result.environment };
  for (const key of ['userName', 'persona', 'authorNote', 'memory']) {
    assert(typeof result.environment[key] === 'string', '프리셋 참고자료 형식 오류: ' + key);
  }
  assert(result.environment.globals && typeof result.environment.globals === 'object' && !Array.isArray(result.environment.globals), '추가 전역 변수는 객체여야 합니다.');
  for (const map of [result.values, result.environment.globals]) {
    for (const [k, v] of Object.entries(map)) {
      assert(!BAD_KEYS.has(k) && typeof v === 'string', '변수 키/값이 올바르지 않습니다.');
    }
  }
  result.excluded = { ...newPresetState().excluded, ...result.excluded };
  for (const key of ['regex', 'modules', 'overlay']) {
    assert(typeof result.excluded[key] === 'boolean', '제외 설정은 참/거짓이어야 합니다: ' + key);
  }
  result.modules = normalizeModules(result.modules ?? []);
  result.moduleOptions = validateModuleOptions(result);
  assert(byteLength(JSON.stringify(result)) <= PRESET_LIMIT * 2, '프리셋 작업 상태가 너무 큽니다.');
  return result;
}

function toggleDefinitions(preset, modules = []) {
  const items = [];
  const definitions = [];
  const known = new Map();
  const sources = [
    { name: '프리셋', text: preset?.customPromptTemplateToggle ?? '', preset: true },
    ...modules.map(m => ({ name: m.name, text: m.customModuleToggle })),
  ];

  for (const source of sources) {
    const tree = parseToggleTree(source.text);
    const names = new Set();
    const duplicates = new Set();
    for (const d of tree.definitions) {
      assert(!names.has(d.key), `중복 토글 키: ${d.rawKey} (${source.name})`);
      names.add(d.key);
      assert(!/[{}\r\n]/.test(d.key) && !d.key.includes('::'), '토글 키에 중괄호·줄바꿈·::를 사용할 수 없습니다.');
      const previous = known.get(d.key);
      if (previous) {
        assert(
          previous.type === d.type && JSON.stringify(previous.options) === JSON.stringify(d.options),
          `프리셋·모듈 간 토글 형식 충돌: ${d.rawKey}`
        );
        previous.sources.push(source.name);
        duplicates.add(d);
      } else {
        d.sources = [source.name];
        known.set(d.key, d);
        definitions.push(d);
      }
    }
    const filter = nodes => nodes
      .filter(node => node.type !== 'toggle' || !duplicates.has(node.definition))
      .map(node => (node.type === 'group' ? { ...node, children: filter(node.children) } : node));
    const children = filter(tree.items);
    if (source.preset) items.push(...children);
    else if (children.length) items.push({ type: 'group', label: '모듈 · ' + source.name, children });
  }
  assert(definitions.length <= 300, '프리셋과 모듈을 합쳐 토글은 300개 이하만 지원합니다.');
  return { items, definitions };
}

function presetValues(state) {
  const out = { ...(state.environment?.globals || {}) };
  for (const d of toggleDefinitions(state.preset, activeModules(state)).definitions) {
    const value = state.values[d.key] ?? toggleDefault(d);
    if (d.type === 'switch') assert(['0', '1'].includes(value), '스위치 토글 값은 0/1이어야 합니다: ' + d.rawKey);
    if (d.type === 'select') assert(/^\d+$/.test(value) && Number(value) < d.options.length, '선택형 토글 값이 올바르지 않습니다: ' + d.rawKey);
    out[d.key] = value;
  }
  return out;
}

const moduleReferences = preset => [
  ...new Set((preset?.moduleIntergration ?? '').split(',').map(id => id.trim()).filter(Boolean)),
];

// Bounded CBS parser & evaluator
function tokenize(source) {
  assert(source.length <= MAX_INPUT_CHARS, '블록 원문이 10,000,000자를 초과했습니다.');
  let position = 0;
  let count = 0;

  function pieces(depth, inMacro) {
    assert(depth < 50, 'CBS 중첩이 너무 깊습니다.');
    const parts = [[]];
    let text = '';
    const flush = () => { if (text) { parts[parts.length - 1].push({ kind: 'text', text }); text = ''; } };
    while (position < source.length) {
      assert(++count <= MAX_INPUT_CHARS + 1, 'CBS 처리 한도에 도달했습니다.');
      if (source.startsWith('{{', position)) {
        flush();
        position += 2;
        const nested = pieces(depth + 1, true);
        parts[parts.length - 1].push({ kind: 'macro', parts: nested });
      } else if (inMacro && source.startsWith('}}', position)) {
        flush();
        position += 2;
        return parts;
      } else if (inMacro && source.startsWith('::', position)) {
        flush();
        parts.push([]);
        position += 2;
      } else {
        text += source[position++];
      }
    }
    flush();
    assert(!inMacro, 'CBS 닫는 중괄호가 없습니다.');
    return parts;
  }

  const nodes = pieces(0, false)[0];
  let cursor = 0;

  function group(closing, depth = 0) {
    assert(depth < 50, 'CBS 블록 중첩이 너무 깊습니다.');
    const children = [];
    while (cursor < nodes.length) {
      const node = nodes[cursor++];
      const head = node.kind === 'macro' ? (node.parts[0][0]?.text ?? '').trim() : '';
      if (['else', '#else', ':else'].includes(head)) {
        assert(closing, '단독 else 문입니다.');
        const before = children[children.length - 1];
        const after = nodes[cursor];
        const elseLine =
          head === ':else' &&
          closing === 'when' &&
          (!before || (before.kind === 'text' && /(?:^|\n)[ \t]*$/.test(before.text))) &&
          (!after || (after.kind === 'text' && /^[ \t]*(?:\r?\n|$)/.test(after.text)));
        return { children, otherwise: true, elseLine };
      }
      if (head.startsWith('/') && !head.startsWith('//')) {
        assert(closing, '열린 CBS 블록이 없는 닫는 태그입니다: ' + head);
        return { children, otherwise: false };
      }
      if (head.startsWith('#')) {
        const name = head.split(/\s/)[0].slice(1);
        const first = group(name, depth + 1);
        const second = first.otherwise ? group(name, depth + 1) : { children: [] };
        children.push({ kind: 'block', name, opening: node, yes: first.children, no: second.children, elseLine: first.elseLine });
      } else {
        children.push(node);
      }
    }
    assert(!closing, 'CBS 블록 닫는 태그가 없습니다: ' + closing);
    return { children };
  }

  return group(null).children;
}

const truth = value => value === '1' || value === 'true';

function whenCondition(values, context) {
  const stack = [...values];
  let mode = 'normal';
  const globalVal = key => {
    assert(Object.hasOwn(context.globals, key), '값이 없는 전역 변수: ' + key);
    return context.globals[key];
  };
  const localVal = key => (Object.hasOwn(context.variables, key) ? context.variables[key] : 'null');

  while (stack.length > 1) {
    const b = stack.pop();
    const op = stack.pop();
    const left = () => {
      assert(stack.length, 'CBS 조건식의 왼쪽 값이 없습니다: ' + op);
      return stack.pop();
    };
    if (op === 'keep' || op === 'legacy') {
      mode = op;
      stack.push(b);
      continue;
    }
    let value;
    switch (op) {
      case 'not': value = !truth(b); break;
      case 'and': value = truth(left()) && truth(b); break;
      case 'or': value = truth(left()) || truth(b); break;
      case 'is': value = left() === b; break;
      case 'isnot': value = left() !== b; break;
      case '>': value = parseFloat(left()) > parseFloat(b); break;
      case '<': value = parseFloat(left()) < parseFloat(b); break;
      case '>=': value = parseFloat(left()) >= parseFloat(b); break;
      case '<=': value = parseFloat(left()) <= parseFloat(b); break;
      case 'var': value = truth(localVal(b)); break;
      case 'toggle': value = truth(globalVal('toggle_' + b)); break;
      case 'vis': value = localVal(left()) === b; break;
      case 'visnot': value = localVal(left()) !== b; break;
      case 'tis': value = globalVal('toggle_' + left()) === b; break;
      case 'tisnot': value = globalVal('toggle_' + left()) !== b; break;
      default: throw new Error('지원하지 않는 CBS 조건 연산자: ' + op);
    }
    stack.push(value ? '1' : '0');
  }
  return { active: truth(stack[0]), mode };
}

const trimLines = text => text.split('\n').map(line => line.trimStart()).join('\n').trim();
const stripDecorators = text => text.split('\n').filter(line => !/^\s*@@/.test(line)).join('\n');
function trimBlankLines(text) {
  const lines = text.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

function evaluate(nodes, context) {
  const render = list => {
    let out = '';
    for (const node of list) {
      out += one(node);
      assert(out.length <= MAX_INPUT_CHARS, 'CBS 출력 상한을 초과했습니다.');
    }
    return out;
  };
  const part = p => render(p);
  const relaxable = err => Boolean(context.lenient) && !/상한|초과/.test(err.message);
  const relax = note => { if (context.relaxed && context.relaxed.length < 50) context.relaxed.push(note); };

  function one(node) {
    if (node.kind === 'text') return node.text;
    if (node.kind === 'block') {
      let active;
      let mode = node.name === 'if_pure' ? 'keep' : 'legacy';
      try {
        assert(['if', 'if_pure', 'when'].includes(node.name), '지원하지 않는 CBS 블록: #' + node.name);
        if (node.name === 'when') {
          const values = node.opening.parts.length > 1
            ? node.opening.parts.slice(1).map(part)
            : [part(node.opening.parts[0]).replace(/^#when\s*/, '')];
          ({ active, mode } = whenCondition(values, context));
        } else {
          active = truth(part(node.opening.parts[0]).replace(/^#if(?:_pure)?\s*/, ''));
        }
      } catch (err) {
        if (!relaxable(err)) throw err;
        relax('조건을 거짓으로 처리: ' + err.message);
        active = false;
      }
      let text = render(active ? node.yes : node.no);
      if (node.elseLine) {
        text = active ? text.replace(/(?:\r?\n)?[ \t]*$/, '') : text.replace(/^[ \t]*\r?\n/, '');
      }
      return mode === 'keep' ? text : mode === 'legacy' ? trimLines(text) : trimBlankLines(text);
    }
    try {
      return macro(node);
    } catch (err) {
      if (!relaxable(err)) throw err;
      relax('표기를 빈 값으로 처리: ' + err.message);
      return '';
    }
  }

  function macro(node) {
    const rawHead = part(node.parts[0]);
    const head = rawHead.trim();
    const name = head.toLowerCase();
    const args = node.parts.slice(1).map(part);

    if (name.replace(/[\s_-]/g, '') === 'userinput') {
      if (context.nativeLiterals && context.nativeLiterals.size < 10) context.nativeLiterals.add(head);
      return '{{' + [rawHead, ...args].join('::') + '}}';
    }
    if (head.startsWith('? ')) return calculatePreset(head.slice(2), context);
    if (name === 'calc') { assert(args.length === 1, 'calc 인자 오류'); return calculatePreset(args[0], context); }
    if (head.startsWith('//') || head.startsWith('!')) return '';
    if (Object.hasOwn(context.fields, name)) {
      assert(!args.length, '인자 없는 CBS 표기입니다: ' + head);
      if (name === 'lorebook' && context.loreUsage) context.loreUsage.used = true;
      return context.fields[name];
    }
    if (['moduleenabled', 'module_enabled'].includes(name)) {
      assert(args.length === 1, 'moduleenabled 인자 오류');
      return (context.modules ?? []).some(m => m.namespace === args[0]) ? '1' : '0';
    }
    if (['moduleassetlist', 'module_assetlist'].includes(name)) {
      assert(args.length === 1, 'moduleassetlist 인자 오류');
      const mod = (context.modules ?? []).find(m => m.namespace === args[0]);
      return mod ? JSON.stringify(mod.assets.map(a => a[0].replace(/::/g, '\\u003A\\u003A'))) : '';
    }
    if (name === 'getglobalvar') {
      assert(args.length === 1, 'getglobalvar 인자 오류');
      assert(Object.hasOwn(context.globals, args[0]), `값이 없는 전역 변수: ${args[0]} (토글 또는 추가 전역 변수에서 설정하세요)`);
      return context.globals[args[0]];
    }
    if (name === 'getvar') {
      assert(args.length === 1, 'getvar 인자 오류');
      return Object.hasOwn(context.variables, args[0]) ? context.variables[args[0]] : 'null';
    }
    if (['equal', 'notequal', 'greater', 'greater_equal', 'less', 'less_equal'].includes(name)) {
      assert(args.length === 2, '비교식에는 값 2개가 필요합니다: ' + name);
      const [a, b] = args;
      if (name === 'equal') return a === b ? '1' : '0';
      if (name === 'notequal') return a !== b ? '1' : '0';
      const x = Number(a);
      const y = Number(b);
      assert(Number.isFinite(x) && Number.isFinite(y), '숫자 비교에 숫자가 아닌 값이 있습니다.');
      return ({ greater: x > y, greater_equal: x >= y, less: x < y, less_equal: x <= y })[name] ? '1' : '0';
    }
    if (name === 'and') { assert(args.length === 2, 'and 인자 오류'); return args[0] === '1' && args[1] === '1' ? '1' : '0'; }
    if (name === 'or') { assert(args.length === 2, 'or 인자 오류'); return args[0] === '1' || args[1] === '1' ? '1' : '0'; }
    if (name === 'not') { assert(args.length === 1, 'not 인자 오류'); return args[0] === '1' ? '0' : '1'; }
    if (name === 'trim') { if (args.length) return args.join('::').trim(); context.trim = true; return ''; }
    if (name === 'lower') return args.join('::').toLowerCase();
    if (name === 'upper') return args.join('::').toUpperCase();
    throw new Error('지원하지 않는 CBS: ' + head);
  }

  const out = render(nodes);
  return context.trim ? out.trim() : out;
}

function renderPresetText(source, context) {
  const value = evaluate(tokenize(String(source ?? '')), { ...context, trim: false });
  assert(byteLength(value) <= CBS_BYTES_LIMIT, 'CBS 출력이 32MiB를 초과했습니다.');
  return value;
}

function resolveRange(block, count) {
  let start = block.rangeStart ?? 0;
  let end = block.rangeEnd ?? 'end';
  assert(Number.isInteger(start) && (end === 'end' || Number.isInteger(end)), '채팅 범위가 올바르지 않습니다.');
  if (start === -1000) return [0, count];
  if (end === 'end') end = count;
  if (start < 0) start = Math.max(0, count + start);
  if (end < 0) end = Math.max(0, count + end);
  return [start, Math.min(end, count)];
}

const ROLE_MAP = { system: 'system', user: 'user', bot: 'assistant', assistant: 'assistant' };
const normalizeRole = value => (Object.hasOwn(ROLE_MAP, value) ? ROLE_MAP[value] : undefined);

/**
 * Assembles the final LLM messages for RisuHelper in either:
 * - 'direct' mode: sends RisuHelper's directMessages unchanged
 * - 'preset' mode: evaluates the imported RisuAI prompt preset + toggles + selected modules
 *   and embeds RisuHelper's work instructions & proposal protocol into the active user turn.
 */
function assembleRisuHelperMessages({
  presetState,
  directMessages,
  activeChar = null,
  activePersona = null,
  loreEntries = [],
  history = [],
  maxHistoryTurns = 12,
}) {
  const state = validatePresetState(presetState || newPresetState());

  if (state.mode === 'direct') {
    return {
      mode: 'direct',
      messages: directMessages,
      trace: [],
      moduleTrace: [],
      presetRegexTrace: [],
      issues: [],
      globals: {},
      notes: ['직접 보내기 모드: RisuHelper 시스템 프롬프트와 현재 화면 문맥을 그대로 전송합니다.'],
    };
  }

  const p = state.preset;
  if (!p) {
    return {
      mode: 'preset',
      messages: [],
      trace: [],
      moduleTrace: [],
      presetRegexTrace: [],
      issues: ['프리셋 적용 모드가 켜져 있지만 가져온 프리셋 파일이 없습니다. 프리셋 패널에서 .risup / .risupreset / JSON 파일을 가져오거나 "직접 보내기" 모드로 전환하세요.'],
      globals: {},
      notes: [],
    };
  }

  const globals = presetValues(state);
  const variables = {
    ...parseVariables(p.templateDefaultVariables),
    ...parseVariables(activeChar?.defaultVariables ?? ''),
  };
  const env = state.environment;
  const charDesc = String(activeChar?.desc ?? '');
  const charName = String(activeChar?.name ?? '');
  const personaText = env.persona || String(activePersona?.personaPrompt ?? '');
  const userName = env.userName || String(activePersona?.name ?? '사용자');

  let lore = (loreEntries || [])
    .filter(e => e && e.mode !== 'folder' && typeof e.content === 'string' && e.content.trim())
    .slice(0, 80)
    .map(l => `[${l.comment || l.key || '로어북'}]\n${l.content}`)
    .join('\n\n');

  const systemGuide = directMessages[0]?.role === 'system' ? directMessages[0].content : '';
  const latestDirectUser = directMessages[directMessages.length - 1];
  const userPrompt = latestDirectUser?.content ?? '';
  const currentUser = {
    role: 'user',
    content: systemGuide ? `[RisuHelper 작업 지침]\n${systemGuide}\n\n[사용자 요청]\n${userPrompt}` : userPrompt,
    ...(Array.isArray(latestDirectUser?.multimodals) && latestDirectUser.multimodals.length > 0
      ? { multimodals: latestDirectUser.multimodals }
      : {}),
  };

  const directHistSlice = directMessages.length > 2 ? directMessages.slice(1, -1) : [];
  const validHistory = (history || [])
    .filter(m => !m.error && (m.role === 'user' || m.role === 'assistant'))
    .map(m => ({ role: m.role, content: m.rawText || m.content }));
  const keepCount = Math.max(1, Number(maxHistoryTurns) || 12) * 2;
  const omittedHistory = Math.max(0, validHistory.length - keepCount);
  const keptHistory = omittedHistory ? validHistory.slice(-keepCount) : validHistory;
  if (directHistSlice.length === keptHistory.length) {
    for (let i = 0; i < keptHistory.length; i++) {
      const dm = directHistSlice[i];
      if (dm?.role === 'user' && Array.isArray(dm.multimodals) && dm.multimodals.length > 0) {
        keptHistory[i] = { ...keptHistory[i], multimodals: dm.multimodals };
      }
    }
  }
  const chats = [...keptHistory, currentUser];

  const lastAssistant = [...keptHistory].reverse().find(m => m.role === 'assistant')?.content ?? '';
  const context = {
    globals,
    variables,
    fields: {
      char: charName,
      user: userName,
      description: charDesc,
      personality: String(activeChar?.personality ?? ''),
      scenario: String(activeChar?.scenario ?? ''),
      persona: personaText,
      firstmessage: String(activeChar?.firstMessage ?? ''),
      first_message: String(activeChar?.firstMessage ?? ''),
      systemprompt: String(activeChar?.systemPrompt ?? ''),
      lorebook: lore,
      chatindex: String(chats.length - 1),
      lastusermessage: currentUser.content,
      lastcharmessage: lastAssistant,
      original: p.mainPrompt,
      slot: '',
    },
    modules: activeModules(state),
    loreUsage: { used: false },
    nativeLiterals: new Set(),
  };

  const messages = [];
  const trace = [];
  const issues = [];
  const moduleTrace = [];
  const presetRegexTrace = [];
  let userCount = 0;

  const missingRefs = moduleReferences(p).filter(ref => !context.modules.some(mod => moduleMatches(mod, ref)));
  if (missingRefs.length && !state.excluded.modules) {
    issues.push(`프리셋 참조 모듈이 선택되지 않았습니다 (${missingRefs.join(', ')}). 프리셋 → 모듈 탭에서 선택하거나 "모듈 연동 전체 제외"를 켜세요.`);
  }

  const moduleLore = [];
  let moduleSize = 0;
  for (const mod of state.modules) {
    const opts = moduleOptions(state, mod);
    const profile = moduleRuntimeProfile(mod);
    if (state.excluded.modules) {
      moduleTrace.push({ module: mod.name, status: 'excluded', reason: '모듈 연동 전체 제외' });
      continue;
    }
    if (profile.notApplicable.length) {
      moduleTrace.push({ module: mod.name, type: 'runtime', status: 'not-applicable', features: profile.notApplicable });
    }
    if (profile.blocking.length) {
      const status = opts.skipRuntime ? 'excluded' : 'error';
      moduleTrace.push({ module: mod.name, type: 'runtime', status, features: profile.blocking });
      if (!opts.skipRuntime) {
        issues.push(`${mod.name}: ${profile.blocking.join(', ')} 실행은 미지원입니다. 모듈 탭에서 "요청 관련 미지원 처리 제외"를 켜세요.`);
      }
    }
    for (const [index, entry] of mod.lorebook.entries()) {
      const rec = { module: mod.name, index, name: entry.comment || entry.key || '로어북', status: 'excluded' };
      moduleTrace.push(rec);
      if (opts.excludedLore.includes(index)) continue;
      let text;
      try {
        const decorated = /(?:^|\n)\s*@@/.test(entry.content);
        if (opts.relaxConditions) {
          const relaxed = decorated ? ['@@ 지시 줄 제거'] : [];
          text = renderPresetText(decorated ? stripDecorators(entry.content) : entry.content, { ...context, lenient: true, relaxed });
          if (relaxed.length) rec.relaxed = relaxed;
        } else {
          assert(!decorated, '@@ 위치·활성화 지시 처리는 미지원입니다.');
          text = renderPresetText(entry.content, context);
        }
        rec.status = text ? 'prepared' : 'empty';
      } catch (err) {
        rec.status = 'error';
        rec.error = err.message;
        issues.push(`${mod.name} / ${rec.name}: ${err.message}${opts.relaxConditions ? '' : ' (모듈 탭에서 조건 완화 옵션을 켜거나 항목을 제외하세요)'}`);
        continue;
      }
      moduleSize += byteLength(text);
      assert(moduleSize <= PRESET_LIMIT, '모듈 로어북 조립 결과가 32MiB를 초과했습니다.');
      if (text) moduleLore.push(`[모듈 ${mod.name} · ${rec.name}]\n${text}`);
    }
  }

  lore = [lore, ...moduleLore].filter(Boolean).join('\n\n');
  context.fields.lorebook = lore;
  context.loreUsage.used = false;

  if (p.regex?.length) {
    const profile = presetRegexProfile(p.regex);
    presetRegexTrace.push(...profile.items.map(item => ({
      ...item,
      status: state.excluded.regex ? 'excluded' : item.status === 'unsupported' ? 'error' : 'not-applicable',
    })));
    if (profile.blocking.length && !state.excluded.regex) {
      issues.push(`프리셋 정규식(${profile.blocking.join(', ')})은 미지원입니다. 프리셋 패널에서 "프리셋 정규식 제외"를 체크하세요.`);
    }
  }

  if (p.promptBlockOverlay?.enabled && !state.excluded.overlay) {
    issues.push('보조 프롬프트 오버레이는 미지원입니다. 프리셋 패널에서 "오버레이 제외"를 체크하세요.');
  }

  let totalSize = 0;
  const pushMsg = (r, content, current = false, multimodals = null) => {
    const mapped = normalizeRole(r);
    assert(mapped, '지원하지 않는 메시지 역할: ' + r);
    const hasModals = mapped === 'user' && Array.isArray(multimodals) && multimodals.length > 0;
    totalSize += byteLength(content);
    assert(totalSize <= PRESET_LIMIT, '조립된 프롬프트가 32MiB 상한을 초과했습니다.');
    if (current) userCount++;
    if (content || hasModals) {
      const msg = { role: mapped, content: content || '' };
      if (hasModals) msg.multimodals = multimodals;
      messages.push(msg);
    }
    assert(messages.length <= 3000, '전송 메시지가 3,000개를 초과했습니다.');
  };

  for (const [i, b] of p.promptTemplate.entries()) {
    const record = { index: i, name: b.name || b.type, type: b.type, status: 'excluded', messages: 0 };
    trace.push(record);
    if (b.enabled === false) continue;
    if ((b.type === 'jailbreak' && p.jailbreakToggle === false) || (b.type === 'cot' && p.chainOfThought === false)) {
      record.reason = '구형 블록 활성화 설정이 꺼져 있습니다.';
      continue;
    }
    const beforeLen = messages.length;
    try {
      if (['plain', 'jailbreak', 'cot'].includes(b.type)) {
        pushMsg(b.role ?? 'system', renderPresetText(b.text ?? '', context));
      } else if (b.type === 'chat') {
        const [start, end] = resolveRange(b, chats.length);
        for (const m of chats.slice(start, Math.max(start, end))) {
          pushMsg(m.role, m.content, m === currentUser, m.multimodals || null);
        }
      } else if (['description', 'persona', 'lorebook', 'authornote', 'memory', 'postEverything'].includes(b.type)) {
        const values = {
          description: charDesc,
          persona: personaText,
          lorebook: lore,
          authornote: env.authorNote || b.defaultText || '',
          memory: env.memory,
          postEverything: p.promptSettings?.postEndInnerFormat ?? '',
        };
        let text = values[b.type];
        if (text && (b.type === 'postEverything' || (b.type === 'authornote' && !env.authorNote))) {
          text = renderPresetText(text, context);
        }
        if (text && b.innerFormat) {
          assert(b.innerFormat.includes('{{slot}}'), '감싸는 서식에 {{slot}}이 없습니다.');
          text = renderPresetText(b.innerFormat, { ...context, fields: { ...context.fields, slot: text } });
        }
        pushMsg(b.role2 ?? 'system', text);
        if (b.type === 'lorebook' && text) context.loreUsage.used = true;
      } else if (b.type === 'chatML') {
        const text = renderPresetText(b.text ?? '', context);
        const re = /<\|im_start\|>(system|user|assistant)\r?\n([\s\S]*?)(?:<\|im_end\|>|$)/g;
        let match;
        let pos = 0;
        while ((match = re.exec(text))) {
          assert(!text.slice(pos, match.index).trim(), 'ChatML 시작 표기 앞에 해석할 수 없는 내용이 있습니다.');
          pushMsg(match[1], match[2]);
          pos = re.lastIndex;
        }
        assert(pos > 0 && !text.slice(pos).trim(), '지원하지 않는 ChatML 형식입니다.');
      } else if (b.type === 'cache') {
        const depth = b.depth ?? 1;
        const filter = b.role ?? 'all';
        assert(Number.isInteger(depth) && depth >= 0 && depth <= 3000, '캐시 깊이는 0~3,000 정수여야 합니다.');
        assert(['system', 'user', 'assistant', 'all'].includes(filter), '지원하지 않는 캐시 역할: ' + filter);
        record.status = 'metadata';
        for (let ptr = messages.length - 1, hit = 0; ptr >= 0 && hit < depth; ptr--) {
          if (filter === 'all' || messages[ptr].role === filter) {
            messages[ptr].cachePoint = true;
            hit++;
          }
        }
        continue;
      } else {
        throw new Error('지원하지 않는 블록 유형: ' + b.type);
      }
      record.status = messages.length > beforeLen ? 'included' : 'empty';
      record.messages = messages.length - beforeLen;
    } catch (err) {
      record.status = 'error';
      record.error = err.message;
      issues.push(`${i + 1}. ${record.name}: ${err.message}`);
    }
  }

  if (p.promptSettings?.assistantPrefill) {
    try {
      pushMsg('assistant', renderPresetText(p.promptSettings.assistantPrefill, context));
    } catch (err) {
      issues.push('Assistant prefill: ' + err.message);
    }
  }

  if (userCount !== 1) {
    issues.push(`현재 RisuHelper 요청을 포함하는 chat 블록이 정확히 1개여야 합니다 (현재 ${userCount}회 포함됨).`);
  }
  if (moduleLore.length && !context.loreUsage.used) {
    issues.push('선택 모듈 로어북을 담을 lorebook 블록 또는 {{lorebook}} 표기가 프리셋에 없습니다.');
  }
  for (const rec of moduleTrace) {
    if (rec.status === 'prepared') rec.status = context.loreUsage.used ? 'included' : 'not-included';
  }

  const notes = [];
  if (omittedHistory) notes.push(`이전 대화 ${omittedHistory}개는 턴 수 상한에 따라 생략되었습니다.`);
  if (context.nativeLiterals.size) {
    notes.push(`${[...context.nativeLiterals].map(n => `{{${n}}}`).join(', ')} 표기는 리스 원본처럼 리터럴로 유지했습니다.`);
  }

  return { mode: 'preset', messages, trace, moduleTrace, presetRegexTrace, issues, globals, notes };
}

export { parseVariables, newPresetState, validatePresetState, toggleDefinitions, presetValues, renderPresetText, assembleRisuHelperMessages, BLOCK_TYPES, moduleReferences };
