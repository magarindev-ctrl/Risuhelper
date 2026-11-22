// SPDX-License-Identifier: GPL-3.0-only
// Installed module snapshot normalization and runtime feature classification for preset mode.
// Never mutates host module activation or executes scripts.

import { PRESET_LIMIT } from './preset-format.js';

const MODULE_LIMIT = PRESET_LIMIT;
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

function stableEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkTree(value, depth = 0, count = { n: 0 }) {
  assert(depth < 70 && ++count.n < 200000, '모듈 데이터 구조가 너무 큽니다.');
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assert(!BAD_KEYS.has(key), '허용하지 않는 모듈 키: ' + key);
      checkTree(item, depth + 1, count);
    }
  }
}

function normalizeModule(raw) {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), '설치 모듈 객체가 필요합니다.');
  assert(typeof raw.id === 'string' && raw.id.trim() && !BAD_KEYS.has(raw.id), '모듈 ID가 없거나 올바르지 않습니다.');
  const result = {};
  for (const key of ['id', 'name', 'namespace', 'description', 'customModuleToggle', 'cjs', 'backgroundEmbedding']) {
    const value = raw[key] ?? '';
    assert(typeof value === 'string', '모듈 문자열 형식 오류: ' + key);
    result[key] = value;
  }
  result.name ||= result.id;
  for (const key of ['lorebook', 'regex', 'trigger', 'assets']) {
    const value = raw[key] ?? [];
    assert(Array.isArray(value) && value.length <= 3000, '모듈 배열 형식 또는 개수 오류: ' + key);
    result[key] = value;
  }
  if (raw.mcp != null) result.mcp = raw.mcp;
  checkTree(result);
  assert(byteLength(JSON.stringify(result)) <= MODULE_LIMIT, '모듈 한 개의 데이터가 32MiB를 초과했습니다.');
  for (const entry of result.lorebook) {
    assert(entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.content === 'string', '모듈 로어북 본문이 올바르지 않습니다.');
  }
  for (const asset of result.assets) {
    assert(Array.isArray(asset) && typeof asset[0] === 'string', '모듈 에셋 이름 형식이 올바르지 않습니다.');
  }
  return clone(result);
}

function normalizeModules(raw = []) {
  assert(Array.isArray(raw) && raw.length <= 100, '선택 모듈은 100개 이하 배열이어야 합니다.');
  const modules = raw.map(normalizeModule);
  const ids = new Set();
  for (const mod of modules) {
    assert(!ids.has(mod.id), '선택 모듈 ID가 중복됩니다: ' + mod.id);
    ids.add(mod.id);
  }
  assert(
    modules.reduce((sum, mod) => sum + mod.lorebook.length, 0) <= 3000,
    '선택 모듈의 로어북 합계는 3,000개 이하만 지원합니다.'
  );
  assert(byteLength(JSON.stringify(modules)) <= MODULE_LIMIT, '선택 모듈 합계가 32MiB를 초과했습니다.');
  return modules;
}

function moduleOptions(state, mod) {
  const own = Object.hasOwn(state.moduleOptions ?? {}, mod.id) ? state.moduleOptions[mod.id] : {};
  return { skipRuntime: false, excludedLore: [], relaxConditions: false, ...own };
}

function validateModuleOptions(state) {
  assert(state.moduleOptions && typeof state.moduleOptions === 'object' && !Array.isArray(state.moduleOptions), '모듈 적용 설정은 객체여야 합니다.');
  checkTree(state.moduleOptions);
  const result = {};
  for (const mod of state.modules) {
    const value = moduleOptions(state, mod);
    assert(
      typeof value.skipRuntime === 'boolean' &&
      typeof value.relaxConditions === 'boolean' &&
      Array.isArray(value.excludedLore) &&
      value.excludedLore.every(i => Number.isInteger(i) && i >= 0 && i < mod.lorebook.length),
      '모듈 적용 설정이 올바르지 않습니다: ' + mod.name
    );
    result[mod.id] = {
      skipRuntime: value.skipRuntime,
      excludedLore: [...new Set(value.excludedLore)],
      relaxConditions: value.relaxConditions,
    };
  }
  return result;
}

const activeModules = state => (state.excluded?.modules ? [] : state.modules ?? []);
const moduleMatches = (mod, reference) => mod.id === reference || Boolean(mod.namespace && mod.namespace === reference);

function moduleRuntimeProfile(mod) {
  const items = [];
  const requestTriggerNames = { start: '시작 트리거', input: '입력 트리거', request: '요청 트리거' };
  const add = (kind, index, name, phase, category, blocking, reason) => {
    items.push({ kind, index, name, phase, category, status: blocking ? 'unsupported' : 'not-applicable', reason });
  };

  for (const [index, rule] of (mod.regex || []).entries()) {
    const name = rule?.comment || `정규식 ${index + 1}`;
    const phase = rule?.type ?? 'unknown';
    if (phase === 'editdisplay') {
      add('regex', index, name, phase, '표시 정규식', false, '리스 채팅 화면의 표시 처리이므로 RisuHelper 요청에는 적용하지 않습니다.');
    } else if (phase === 'editoutput') {
      add('regex', index, name, phase, '출력 정규식', false, '리스 채팅 응답 후처리이므로 RisuHelper 구조화 제안 응답에는 적용하지 않습니다.');
    } else if (rule?.in === '') {
      add('regex', index, name, phase, '빈 IN 정규식', false, '빈 IN 규칙은 실행하지 않습니다.');
    } else if (phase === 'editinput') {
      add('regex', index, name, phase, '입력 정규식', true, '입력문을 바꿀 수 있으나 프리셋 조립에서는 실행하지 않습니다.');
    } else if (phase === 'editprocess') {
      add('regex', index, name, phase, '전처리 정규식', true, '요청 전처리 정규식은 프리셋 조립에서 실행하지 않습니다.');
    } else {
      add('regex', index, name, phase, '유형 미확인 정규식', true, '적용 유형을 확인할 수 없어 안전을 위해 차단합니다.');
    }
  }

  for (const [index, trigger] of (mod.trigger || []).entries()) {
    const name = trigger?.comment || `트리거 ${index + 1}`;
    const phase = trigger?.type ?? 'unknown';
    const first = trigger?.effect?.[0]?.type;
    if (first === 'triggerlua' || first === 'triggercode') {
      add('trigger', index, name, phase, 'Lua·JS 콜백 트리거', true, '코드 트리거는 실행 시점과 별개로 콜백을 등록할 수 있어 확인/제외가 필요합니다.');
    } else if (['manual', 'display', 'output'].includes(phase)) {
      const label = { manual: '수동 트리거', display: '표시 트리거', output: '출력 트리거' }[phase];
      add('trigger', index, name, phase, label, false, '채팅 수동·표시·출력 단계이므로 RisuHelper 요청에서는 실행하지 않습니다.');
    } else {
      add('trigger', index, name, phase, requestTriggerNames[phase] || '유형 미확인 트리거', true, '모델 요청이나 변수를 바꿀 수 있어 확인/제외가 필요합니다.');
    }
  }

  if ((mod.cjs || '').trim()) add('cjs', 0, '모듈 JS', 'script', '모듈 JS', true, '모듈 JS 실행·콜백은 지원하지 않습니다.');
  if (mod.mcp) add('mcp', 0, 'MCP', 'tools', 'MCP', true, '모듈 MCP 도구 연동은 지원하지 않습니다.');
  if ((mod.backgroundEmbedding || '').trim()) {
    add('background', 0, '배경 코드', 'display', '배경 화면 코드', false, '배경 화면 표시 코드이므로 RisuHelper 요청에서는 실행하지 않습니다.');
  }

  const summarize = (status) => {
    const counts = new Map();
    for (const item of items) {
      if (item.status === status) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => `${name} ${count}개`);
  };

  return {
    items,
    blocking: summarize('unsupported'),
    notApplicable: summarize('not-applicable'),
  };
}

const presetRegexProfile = regex => moduleRuntimeProfile({ regex, trigger: [], cjs: '', backgroundEmbedding: '' });

async function readInstalledModules(api) {
  assert(typeof api?.getDatabase === 'function', '이 호스트에는 설치 모듈 조회 API가 없습니다.');
  const db = await api.getDatabase(['modules']);
  assert(db && Array.isArray(db.modules), '설치 모듈 조회 권한(db)이 필요하거나 호스트가 modules 조회를 지원하지 않습니다.');
  const seen = new Set();
  return db.modules.filter(mod => mod && typeof mod.id === 'string' && !seen.has(mod.id) && seen.add(mod.id));
}

function selectInstalledModules(state, catalog, ids) {
  const wanted = new Set(ids);
  assert([...wanted].every(id => catalog.some(m => m.id === id)), '설치 목록에 없는 모듈을 선택했습니다.');
  const modules = normalizeModules(catalog.filter(mod => wanted.has(mod.id)));
  const options = {};
  for (const mod of modules) {
    const previous = (state.modules ?? []).find(old => old.id === mod.id);
    options[mod.id] = previous && stableEqual(previous, mod)
      ? moduleOptions(state, mod)
      : { skipRuntime: false, excludedLore: [], relaxConditions: false };
  }
  return {
    ...state,
    modules,
    moduleOptions: options,
    excluded: { ...(state.excluded || {}), modules: false },
  };
}

export { normalizeModule, normalizeModules, moduleOptions, validateModuleOptions, moduleRuntimeProfile, readInstalledModules, selectInstalledModules, MODULE_LIMIT, activeModules, moduleMatches, presetRegexProfile };
