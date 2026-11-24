// SPDX-License-Identifier: GPL-3.0-only
// Pure helpers for v0.5.0 features:
// - regex live preview & syntax validation
// - CBS detection for safe parseRisuChat({ runVar: false }) simulation
// - chat.scriptstate (chat variable) deterministic update planning
// - opt-in fetch log sanitization & secret redaction

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_KEY_RE = /(?:api[-_]?key|authorization|x-api-key|secret|password|private[-_]?key|access[-_]?token|refresh[-_]?token|bearer)/i;
const BEARER_STR_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
const CBS_SYNTAX_RE = /\{\{[^{}]+\}\}/;

function cloneJson(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function formatVarVal(val) {
  if (val === undefined) return '(없음)';
  if (val !== null && typeof val === 'object') {
    try { return JSON.stringify(val); } catch { return String(val); }
  }
  return String(val);
}

function cleanVarName(raw) {
  return String(raw ?? '').trim().replace(/^\$+/, '').trim();
}

function resolveStateKey(state, rawName) {
  const clean = cleanVarName(rawName);
  if (!clean || BAD_KEYS.has(clean) || BAD_KEYS.has(rawName)) return null;
  const dollarKey = `$${clean}`;
  if (Object.hasOwn(state, dollarKey)) return dollarKey;
  if (Object.hasOwn(state, clean)) return clean;
  return dollarKey;
}

/**
 * Summarizes live chat variables (`chat.scriptstate`) for model context.
 */
function summarizeChatVariables(chat, { maxVars = 100, maxValueChars = 200 } = {}) {
  const raw = chat?.scriptstate && typeof chat.scriptstate === 'object' ? chat.scriptstate : {};
  const keys = Object.keys(raw).filter(k => !BAD_KEYS.has(k) && raw[k] !== undefined);
  const variables = keys.slice(0, maxVars).map(k => {
    const formatted = formatVarVal(raw[k]);
    return {
      name: cleanVarName(k) || k,
      rawKey: k,
      value: formatted.length > maxValueChars ? `${formatted.slice(0, maxValueChars)}…` : formatted,
    };
  });
  return {
    variables,
    total: keys.length,
    omitted: Math.max(0, keys.length - variables.length),
  };
}

/**
 * Deterministically plans `update_chat_vars` (`set` + `remove`) against `chat.scriptstate`.
 */
function planChatVarsUpdate(currentState, proposal) {
  const base = currentState && typeof currentState === 'object' ? cloneJson(currentState) : {};
  const next = cloneJson(base);
  const metaChanges = [];
  const beforeLines = [];
  const afterLines = [];
  let changedCount = 0;
  let removedCount = 0;

  const setObj = proposal?.set && typeof proposal.set === 'object' && !Array.isArray(proposal.set)
    ? proposal.set
    : {};
  for (const [rawKey, rawVal] of Object.entries(setObj)) {
    const stateKey = resolveStateKey(base, rawKey);
    if (!stateKey) {
      return { ok: false, error: `허용되지 않는 채팅 변수 이름입니다: ${String(rawKey)}` };
    }
    const displayName = cleanVarName(rawKey);
    const hadBefore = Object.hasOwn(base, stateKey) && base[stateKey] !== undefined;
    const prevVal = hadBefore ? base[stateKey] : undefined;
    const nextVal = rawVal === null ? '' : (typeof rawVal === 'object' ? cloneJson(rawVal) : rawVal);
    if (hadBefore && JSON.stringify(prevVal) === JSON.stringify(nextVal)) continue;

    next[stateKey] = nextVal;
    changedCount++;
    const beforeStr = hadBefore ? formatVarVal(prevVal) : '(없음)';
    const afterStr = formatVarVal(nextVal);
    metaChanges.push({
      key: stateKey,
      label: `변수 ${displayName}`,
      before: beforeStr,
      after: afterStr,
    });
    if (hadBefore) beforeLines.push(`${displayName} = ${beforeStr}`);
    afterLines.push(`${displayName} = ${afterStr}`);
  }

  const removeList = Array.isArray(proposal?.remove) ? proposal.remove : [];
  const seenRemove = new Set();
  for (const rawKey of removeList) {
    const stateKey = resolveStateKey(next, rawKey);
    if (!stateKey || seenRemove.has(stateKey)) continue;
    seenRemove.add(stateKey);
    if (!Object.hasOwn(next, stateKey) || next[stateKey] === undefined) continue;

    const displayName = cleanVarName(rawKey);
    const prevStr = formatVarVal(next[stateKey]);
    delete next[stateKey];
    changedCount++;
    removedCount++;
    metaChanges.push({
      key: stateKey,
      label: `변수 ${displayName} 삭제`,
      before: prevStr,
      after: '(삭제)',
    });
    beforeLines.push(`${displayName} = ${prevStr}`);
  }

  if (changedCount === 0) {
    return { ok: false, error: '현재 채팅 변수와 비교해 변경되는 값이 없습니다.' };
  }

  return {
    ok: true,
    nextState: next,
    metaChanges,
    before: beforeLines.join('\n'),
    after: afterLines.join('\n'),
    changedCount,
    removedCount,
  };
}

function hasCbsSyntax(text) {
  return typeof text === 'string' && CBS_SYNTAX_RE.test(text);
}

/**
 * Validates and runs a proposed RisuAI regex script against a sample string.
 */
function previewRegexApplication(regexEntry, sampleText = '') {
  const pattern = String(regexEntry?.in ?? '');
  const replacement = String(regexEntry?.out ?? '');
  const rawFlags = regexEntry?.ableFlag ? String(regexEntry?.flag ?? 'g') : 'g';
  const flags = rawFlags.replace(/[^dgimsuvy]/g, '') || 'g';

  let re;
  try {
    re = new RegExp(pattern, flags);
  } catch (err) {
    return { ok: false, error: `정규식 문법 오류: ${err.message}`, flags };
  }

  const sample = String(sampleText ?? '').slice(0, 4000);
  if (!sample) {
    return { ok: true, matched: false, matchCount: 0, before: '', after: '', flags };
  }

  const countFlags = flags.includes('g') ? flags : `${flags}g`;
  let matchCount = 0;
  try {
    const countRe = new RegExp(pattern, countFlags);
    let m;
    let guard = 0;
    while ((m = countRe.exec(sample)) !== null && guard++ < 200) {
      matchCount++;
      if (m[0] === '') countRe.lastIndex++;
    }
  } catch {
    matchCount = re.test(sample) ? 1 : 0;
  }

  const after = sample.replace(re, replacement);
  return {
    ok: true,
    matched: matchCount > 0,
    matchCount,
    before: sample,
    after,
    flags,
  };
}

function redactSecretsDeep(val, depth = 0) {
  if (depth > 8 || val === null || val === undefined) return val;
  if (typeof val === 'string') {
    return val.replace(BEARER_STR_RE, '$1[REDACTED]');
  }
  if (Array.isArray(val)) {
    return val.map(item => redactSecretsDeep(item, depth + 1));
  }
  if (typeof val === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(val)) {
      if (BAD_KEYS.has(k)) continue;
      if (SENSITIVE_KEY_RE.test(k) && !/tokens?$/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSecretsDeep(v, depth + 1);
      }
    }
    return out;
  }
  return val;
}

function serializeLogField(raw, maxChars) {
  if (raw === undefined || raw === null || raw === '') {
    return { text: '', truncated: false };
  }
  let text;
  if (typeof raw === 'string') {
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch {}
    if (parsed && typeof parsed === 'object') {
      text = JSON.stringify(redactSecretsDeep(parsed), null, 2);
    } else {
      text = raw.replace(BEARER_STR_RE, '$1[REDACTED]');
    }
  } else if (typeof raw === 'object') {
    try { text = JSON.stringify(redactSecretsDeep(raw), null, 2); } catch { text = String(raw); }
  } else {
    text = String(raw);
  }
  if (text.length > maxChars) {
    return { text: text.slice(0, maxChars) + '\n... (일부 생략)', truncated: true };
  }
  return { text, truncated: false };
}

/**
 * Sanitizes and bounds a single entry returned by `risuai.getFetchLogs()`.
 */
function sanitizeFetchLog(rawLog, { maxBodyChars = 8000, maxResponseChars = 6000 } = {}) {
  if (!rawLog || typeof rawLog !== 'object') return null;
  let cleanUrl = String(rawLog.url ?? '');
  try {
    const u = new URL(cleanUrl);
    cleanUrl = u.origin + u.pathname;
  } catch {
    cleanUrl = cleanUrl.split('?')[0];
  }
  const body = serializeLogField(rawLog.body, maxBodyChars);
  const response = serializeLogField(rawLog.response, maxResponseChars);
  return {
    url: cleanUrl,
    status: rawLog.status ?? null,
    body: body.text,
    bodyTruncated: body.truncated,
    response: response.text,
    responseTruncated: response.truncated,
  };
}

const PORT_ITEMS = ['lorebook', 'regex', 'lua'];

const DEFAULT_SD_DATA = [
  ['always', 'solo, 1girl'],
  ['negative', ''],
  ["|character's appearance", ''],
  ['current situation', ''],
  ["$character's pose", ''],
  ["$character's emotion", ''],
  ['current location', ''],
];

/**
 * Builds a complete blank RisuAI character object matching upstream `createBlankChar()`.
 */
function buildBlankCharacterSkeleton(chaId) {
  return {
    type: 'character',
    name: '',
    firstMessage: '',
    desc: '',
    notes: '',
    chats: [{
      message: [],
      note: '',
      name: 'Chat 1',
      localLore: [],
    }],
    chatFolders: [],
    chatPage: 0,
    emotionImages: [],
    bias: [],
    viewScreen: 'none',
    globalLore: [],
    chaId: String(chaId || ''),
    sdData: cloneJson(DEFAULT_SD_DATA),
    utilityBot: false,
    customscript: [],
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: '',
    scenario: '',
    firstMsgIndex: -1,
    replaceGlobalNote: '',
    triggerscript: [
      {
        comment: '',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'v2Header', code: '', indent: 0 }],
      },
      {
        comment: 'New Event',
        type: 'manual',
        conditions: [],
        effect: [],
      },
    ],
    additionalText: '',
  };
}

function normalizeBiasPair(entry) {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const word = String(entry[0] ?? '').trim();
  const num = Number(entry[1]);
  if (!word || !Number.isFinite(num)) return null;
  const clamped = Math.max(-100, Math.min(100, Math.round(num)));
  return [word, clamped];
}

function normalizeLoreSettingsInput(raw, existing = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'loreSettings는 JSON 객체여야 합니다.' };
  }
  const base = existing && typeof existing === 'object' ? cloneJson(existing) : {
    tokenBudget: 800,
    scanDepth: 2,
    recursiveScanning: false,
    fullWordMatching: false,
  };
  if (raw.tokenBudget !== undefined) {
    const v = Number(raw.tokenBudget);
    if (!Number.isFinite(v) || v < 0 || v > 200000) {
      return { ok: false, error: 'loreSettings.tokenBudget은 0~200000 사이의 숫자여야 합니다.' };
    }
    base.tokenBudget = Math.round(v);
  }
  if (raw.scanDepth !== undefined) {
    const v = Number(raw.scanDepth);
    if (!Number.isFinite(v) || v < 0 || v > 200) {
      return { ok: false, error: 'loreSettings.scanDepth는 0~200 사이의 숫자여야 합니다.' };
    }
    base.scanDepth = Math.round(v);
  }
  if (raw.recursiveScanning !== undefined) {
    base.recursiveScanning = Boolean(raw.recursiveScanning);
  }
  if (raw.fullWordMatching !== undefined) {
    base.fullWordMatching = Boolean(raw.fullWordMatching);
  }
  return { ok: true, value: base };
}

/**
 * Deterministically plans `update_char_settings` (loreSettings, bias, tags) without mutating `char`.
 */
function planCharSettingsUpdate(char, proposal) {
  if (!char || typeof char !== 'object') {
    return { ok: false, error: '선택된 캐릭터가 없습니다.' };
  }
  const isGroup = char.type === 'group';
  const metaChanges = [];
  const beforeLines = [];
  const afterLines = [];
  const nextPatch = {};
  let changed = false;

  if (proposal.loreSettings !== undefined) {
    const curLore = char.loreSettings && typeof char.loreSettings === 'object' ? char.loreSettings : null;
    const norm = normalizeLoreSettingsInput(proposal.loreSettings, curLore);
    if (!norm.ok) return norm;
    const nextLore = norm.value;
    const fields = [
      ['tokenBudget', '로어북 토큰 예산'],
      ['scanDepth', '로어북 스캔 깊이'],
      ['recursiveScanning', '재귀 스캔'],
      ['fullWordMatching', '전체 단어 일치'],
    ];
    let loreChanged = false;
    for (const [k, label] of fields) {
      const prevV = curLore ? curLore[k] : undefined;
      if (prevV !== nextLore[k]) {
        loreChanged = true;
        metaChanges.push({
          key: `loreSettings.${k}`,
          label,
          before: prevV === undefined ? '(기본값)' : String(prevV),
          after: String(nextLore[k]),
        });
      }
    }
    if (loreChanged) {
      changed = true;
      nextPatch.loreSettings = nextLore;
      beforeLines.push(`loreSettings = ${JSON.stringify(curLore || '(기본값)')}`);
      afterLines.push(`loreSettings = ${JSON.stringify(nextLore)}`);
    }
  }

  const hasBiasOp = proposal.bias !== undefined || proposal.addBias !== undefined || proposal.removeBias !== undefined;
  if (hasBiasOp) {
    if (isGroup) {
      return { ok: false, error: '그룹 채팅에는 로짓 바이어스(bias) 필드가 없습니다.' };
    }
    const curBias = Array.isArray(char.bias) ? char.bias.map(normalizeBiasPair).filter(Boolean) : [];
    let nextBias;
    if (proposal.bias !== undefined) {
      if (!Array.isArray(proposal.bias)) return { ok: false, error: 'bias는 [["단어", 가중치]] 형태의 배열이어야 합니다.' };
      nextBias = [];
      for (const pair of proposal.bias) {
        const norm = normalizeBiasPair(pair);
        if (!norm) return { ok: false, error: `올바르지 않은 bias 항목입니다: ${JSON.stringify(pair)}` };
        nextBias.push(norm);
      }
    } else {
      nextBias = cloneJson(curBias);
    }
    if (Array.isArray(proposal.addBias)) {
      for (const pair of proposal.addBias) {
        const norm = normalizeBiasPair(pair);
        if (!norm) return { ok: false, error: `올바르지 않은 addBias 항목입니다: ${JSON.stringify(pair)}` };
        const existingIdx = nextBias.findIndex(b => b[0] === norm[0]);
        if (existingIdx !== -1) nextBias[existingIdx] = norm;
        else nextBias.push(norm);
      }
    }
    if (Array.isArray(proposal.removeBias)) {
      const rmSet = new Set(proposal.removeBias.map(s => String(s ?? '').trim()).filter(Boolean));
      nextBias = nextBias.filter(b => !rmSet.has(b[0]));
    }
    if (JSON.stringify(curBias) !== JSON.stringify(nextBias)) {
      changed = true;
      nextPatch.bias = nextBias;
      const fmtBias = (arr) => arr.length === 0 ? '(없음)' : arr.map(([w, v]) => `${w}(${v > 0 ? '+' : ''}${v})`).join(', ');
      metaChanges.push({ key: 'bias', label: '로짓 바이어스', before: fmtBias(curBias), after: fmtBias(nextBias) });
      beforeLines.push(`bias = ${fmtBias(curBias)}`);
      afterLines.push(`bias = ${fmtBias(nextBias)}`);
    }
  }

  const hasTagsOp = proposal.tags !== undefined || proposal.addTags !== undefined || proposal.removeTags !== undefined;
  if (hasTagsOp) {
    if (isGroup) {
      return { ok: false, error: '그룹 채팅에는 태그(tags) 필드가 없습니다.' };
    }
    const curTags = Array.isArray(char.tags) ? char.tags.map(t => String(t ?? '').trim()).filter(Boolean) : [];
    let nextTags;
    if (proposal.tags !== undefined) {
      if (!Array.isArray(proposal.tags)) return { ok: false, error: 'tags는 문자열 배열이어야 합니다.' };
      nextTags = [...new Set(proposal.tags.map(t => String(t ?? '').trim()).filter(Boolean))];
    } else {
      nextTags = [...curTags];
    }
    if (Array.isArray(proposal.addTags)) {
      for (const t of proposal.addTags) {
        const clean = String(t ?? '').trim();
        if (clean && !nextTags.includes(clean)) nextTags.push(clean);
      }
    }
    if (Array.isArray(proposal.removeTags)) {
      const rmSet = new Set(proposal.removeTags.map(t => String(t ?? '').trim()).filter(Boolean));
      nextTags = nextTags.filter(t => !rmSet.has(t));
    }
    if (JSON.stringify(curTags) !== JSON.stringify(nextTags)) {
      changed = true;
      nextPatch.tags = nextTags;
      const fmtTags = (arr) => arr.length === 0 ? '(없음)' : arr.join(', ');
      metaChanges.push({ key: 'tags', label: '태그', before: fmtTags(curTags), after: fmtTags(nextTags) });
      beforeLines.push(`tags = ${fmtTags(curTags)}`);
      afterLines.push(`tags = ${fmtTags(nextTags)}`);
    }
  }

  if (!changed) {
    return { ok: false, error: '현재 캐릭터 설정과 비교해 변경되는 값이 없습니다.' };
  }
  return {
    ok: true,
    nextPatch,
    metaChanges,
    before: beforeLines.join('\n'),
    after: afterLines.join('\n'),
  };
}

/**
 * Deterministically plans porting lorebook / regex / Lua from `sourceChar` to `targetChar`.
 */
function planCharacterPort(sourceChar, targetChar, { items = [], loreIndices = null, regexIndices = null, extractLua, buildLuaTriggers } = {}) {
  const next = cloneJson(targetChar);
  const copied = [];
  const skipped = [];
  const metaChanges = [];
  const beforeParts = [];
  const afterParts = [];
  let overwritesLua = false;
  let overwritesOtherTriggers = false;
  let otherTriggerCount = 0;

  if (items.includes('lorebook')) {
    const srcLore = Array.isArray(sourceChar?.globalLore) ? sourceChar.globalLore : [];
    const dstLore = Array.isArray(next.globalLore) ? next.globalLore : (next.globalLore = []);
    let selectedIndices;
    if (Array.isArray(loreIndices) && loreIndices.length > 0) {
      for (const i of loreIndices) {
        if (!Number.isInteger(i) || !srcLore[i]) {
          return { ok: false, error: `원본 캐릭터의 로어북 #${Number(i) + 1}을(를) 찾을 수 없습니다. (총 ${srcLore.length}개)` };
        }
      }
      selectedIndices = [...new Set(loreIndices)];
    } else {
      selectedIndices = srcLore.map((_, i) => i);
    }

    const loreId = (e) => e?.mode === 'folder'
      ? `folder:${e.key}`
      : JSON.stringify([e?.comment ?? '', e?.key ?? '', e?.secondkey ?? '', e?.content ?? '']);
    const existingIds = new Set(dstLore.map(loreId));
    const existingFolderKeys = new Set(dstLore.filter(e => e?.mode === 'folder' && e.key).map(e => e.key));
    const srcFolderByKey = new Map(srcLore.filter(e => e?.mode === 'folder' && e.key).map(e => [e.key, e]));

    const addedEntries = [];
    const addedFolderKeys = new Set();
    let dupCount = 0;

    for (const idx of selectedIndices) {
      const entry = srcLore[idx];
      if (!entry) continue;
      const cloned = cloneJson(entry);
      if (cloned.mode !== 'folder' && cloned.folder) {
        if (!existingFolderKeys.has(cloned.folder) && !addedFolderKeys.has(cloned.folder)) {
          const parentFolder = srcFolderByKey.get(cloned.folder);
          if (parentFolder) {
            addedEntries.push(cloneJson(parentFolder));
            addedFolderKeys.add(cloned.folder);
          } else {
            // Never create orphaned hidden lorebook entries in destination
            delete cloned.folder;
          }
        }
      }
      const id = loreId(cloned);
      if (existingIds.has(id)) {
        dupCount++;
        continue;
      }
      existingIds.add(id);
      if (cloned.mode === 'folder' && cloned.key) addedFolderKeys.add(cloned.key);
      addedEntries.push(cloned);
    }

    if (addedEntries.length > 0) {
      dstLore.push(...addedEntries);
      copied.push(`로어북 ${addedEntries.length}개`);
      metaChanges.push({
        key: 'globalLore',
        label: '로어북 포팅',
        before: `${targetChar.globalLore?.length ?? 0}개`,
        after: `${dstLore.length}개 (+${addedEntries.length}${dupCount ? `, 중복 ${dupCount}개 건너뜀` : ''})`,
      });
      afterParts.push(
        `[추가 로어북 ${addedEntries.length}개]\n` +
        addedEntries.slice(0, 30).map(e => `- ${e.mode === 'folder' ? '📁 ' : ''}${e.comment || '(무제)'}${e.key && e.mode !== 'folder' ? ` [${e.key}]` : ''}`).join('\n')
      );
    } else {
      skipped.push(srcLore.length === 0 ? '원본 캐릭터에 로어북이 없습니다.' : '선택된 로어북은 이미 현재 캐릭터에 있습니다.');
    }
  }

  if (items.includes('regex')) {
    const srcRegex = Array.isArray(sourceChar?.customscript) ? sourceChar.customscript : [];
    const dstRegex = Array.isArray(next.customscript) ? next.customscript : (next.customscript = []);
    let selectedIndices;
    if (Array.isArray(regexIndices) && regexIndices.length > 0) {
      for (const i of regexIndices) {
        if (!Number.isInteger(i) || !srcRegex[i]) {
          return { ok: false, error: `원본 캐릭터의 정규식 #${Number(i) + 1}을(를) 찾을 수 없습니다. (총 ${srcRegex.length}개)` };
        }
      }
      selectedIndices = [...new Set(regexIndices)];
    } else {
      selectedIndices = srcRegex.map((_, i) => i);
    }

    const regexId = (r) => JSON.stringify([r?.comment ?? '', r?.in ?? '', r?.out ?? '', r?.type ?? 'editdisplay']);
    const existingIds = new Set(dstRegex.map(regexId));
    const addedRegex = [];
    let dupCount = 0;

    for (const idx of selectedIndices) {
      const entry = srcRegex[idx];
      if (!entry) continue;
      const id = regexId(entry);
      if (existingIds.has(id)) {
        dupCount++;
        continue;
      }
      existingIds.add(id);
      addedRegex.push(cloneJson(entry));
    }

    if (addedRegex.length > 0) {
      dstRegex.push(...addedRegex);
      copied.push(`정규식 ${addedRegex.length}개`);
      metaChanges.push({
        key: 'customscript',
        label: '정규식 포팅',
        before: `${targetChar.customscript?.length ?? 0}개`,
        after: `${dstRegex.length}개 (+${addedRegex.length}${dupCount ? `, 중복 ${dupCount}개 건너뜀` : ''})`,
      });
      afterParts.push(
        `[추가 정규식 ${addedRegex.length}개]\n` +
        addedRegex.slice(0, 30).map(r => `- ${r.comment || '(무제)'} (${r.type || 'editdisplay'})`).join('\n')
      );
    } else {
      skipped.push(srcRegex.length === 0 ? '원본 캐릭터에 정규식이 없습니다.' : '선택된 정규식은 이미 현재 캐릭터에 있습니다.');
    }
  }

  if (items.includes('lua')) {
    if (targetChar.type === 'group') {
      return { ok: false, error: '그룹 채팅에는 Lua 트리거 스크립트를 포팅할 수 없습니다.' };
    }
    const srcLua = extractLua(sourceChar?.triggerscript);
    const dstLua = extractLua(targetChar?.triggerscript);
    if (!srcLua.isLua || !srcLua.code.trim()) {
      skipped.push('원본 캐릭터에 Lua 트리거 스크립트가 없습니다.');
    } else if (dstLua.isLua && dstLua.code === srcLua.code) {
      skipped.push('현재 캐릭터에 이미 같은 Lua 스크립트가 들어 있습니다.');
    } else {
      if (dstLua.isLua && dstLua.code.trim()) overwritesLua = true;
      if (dstLua.hasOtherTriggers) {
        overwritesOtherTriggers = true;
        otherTriggerCount = dstLua.otherTriggerCount;
      }
      next.triggerscript = buildLuaTriggers(srcLua.code);
      copied.push('Lua 스크립트');
      metaChanges.push({
        key: 'triggerscript',
        label: 'Lua 트리거 포팅',
        before: dstLua.isLua ? `${dstLua.code.length}자` : (dstLua.hasOtherTriggers ? `기존 V1/V2 트리거 ${dstLua.otherTriggerCount}개` : '(없음)'),
        after: `${srcLua.code.length}자`,
      });
      if (dstLua.code) beforeParts.push(`[기존 Lua]\n${dstLua.code}`);
      afterParts.push(`[포팅할 Lua]\n${srcLua.code}`);
    }
  }

  return {
    ok: true,
    changed: copied.length > 0,
    next,
    copied,
    skipped,
    metaChanges,
    before: beforeParts.join('\n\n'),
    after: afterParts.join('\n\n'),
    overwritesLua,
    overwritesOtherTriggers,
    otherTriggerCount,
  };
}

export {
  summarizeChatVariables,
  planChatVarsUpdate,
  hasCbsSyntax,
  previewRegexApplication,
  sanitizeFetchLog,
  PORT_ITEMS,
  DEFAULT_SD_DATA,
  buildBlankCharacterSkeleton,
  normalizeBiasPair,
  normalizeLoreSettingsInput,
  planCharSettingsUpdate,
  planCharacterPort,
};
