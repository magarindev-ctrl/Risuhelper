import { buildKnowledgeForContext } from './knowledge.js';
import {
  ALLOWED_CONFIG_KEYS,
  MAX_LLM_CONTENT_CHARS,
  ALLOWED_CHAR_FIELDS,
  ALLOWED_LORE_TEXT_FIELDS,
  ALLOWED_PERSONA_TEXT_FIELDS,
} from './version.js';

const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MiB safety limit
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const RAW_SECTION_RE = /^<<<(CONTENT|CODE|BEFORE|AFTER|IN|OUT|END)>>>[ \t]*$/;

function byteLength(str) {
  return new TextEncoder().encode(String(str)).length;
}

/**
 * Normalizes all RisuAI / fork runLLMModel return formats:
 * - plain string
 * - { type: 'fail', result }
 * - { type: 'success', result: string }
 * - ReadableStream (string chunks, Uint8Array chunks, or RisuAI cumulative { '0': string } chunks)
 */
async function readModelResponse(result, job = {}) {
  if (result === null || result === undefined) {
    throw new Error('모델 응답이 비어 있습니다.');
  }
  if (typeof result === 'string') {
    if (byteLength(result) > MAX_RESPONSE_BYTES) throw new Error('응답 크기가 1MiB를 초과했습니다.');
    return result;
  }
  if (result.type === 'fail') {
    throw new Error(String(result.result ?? result.error ?? '모델 요청이 실패했습니다.'));
  }
  if (typeof result.result === 'string') {
    return readModelResponse(result.result, job);
  }
  const stream = result.result?.getReader ? result.result : (result.getReader ? result : null);
  if (!stream) {
    throw new Error('지원하지 않는 모델 응답 형식입니다.');
  }

  const reader = stream.getReader();
  job.reader = reader;
  const decoder = new TextDecoder();
  let current = '';
  let cumulative = false;
  let size = 0;

  try {
    while (true) {
      if (job.cancelled) throw new Error('요청을 중단했습니다.');
      const { value, done } = await reader.read();
      if (done) break;
      if (typeof value === 'string') {
        current += value;
        size += byteLength(value);
      } else if (value instanceof Uint8Array) {
        const chunk = decoder.decode(value, { stream: true });
        current += chunk;
        size += byteLength(chunk);
      } else if (value && typeof value === 'object' && typeof value['0'] === 'string') {
        current = value['0'];
        cumulative = true;
        size = current.length > MAX_RESPONSE_BYTES / 4 ? byteLength(current) : current.length;
      } else {
        throw new Error('지원하지 않는 스트림 청크 형식입니다.');
      }
      if (size > MAX_RESPONSE_BYTES) throw new Error('스트림 응답 크기가 1MiB를 초과했습니다.');
      if (typeof job.onChunk === 'function') job.onChunk(current);
    }
    if (!cumulative) {
      const tail = decoder.decode();
      if (tail) {
        current += tail;
        size += byteLength(tail);
      }
    }
    if (size > MAX_RESPONSE_BYTES) throw new Error('응답 크기가 1MiB를 초과했습니다.');
    return current;
  } finally {
    if (job.cancelled) {
      try { await reader.cancel(); } catch {}
    }
    try { reader.releaseLock(); } catch {}
    job.reader = null;
  }
}

/**
 * Invokes Risuai.runLLMModel with timeout and cancellation support.
 */
async function callRisuModel(api, messages, options = {}, job = {}) {
  const mode = options.mode || 'model';
  const timeoutSec = Math.max(10, Math.min(600, Number(options.timeoutSeconds) || 120));
  if (typeof api?.runLLMModel !== 'function') {
    throw new Error('현재 RisuAI 버전은 Plugin v3 runLLMModel API를 지원하지 않습니다.');
  }

  let timer;
  const abortPromise = new Promise((_, reject) => {
    job.stop = (reason = '요청을 중단했습니다.') => {
      job.cancelled = true;
      try { job.reader?.cancel(); } catch {}
      reject(new Error(reason));
    };
    timer = setTimeout(() => job.stop('모델 응답 대기 시간이 초과되었습니다.'), timeoutSec * 1000);
  });

  const workPromise = Promise.resolve()
    .then(() => api.runLLMModel({ mode, messages, allowPlugins: true }))
    .then(res => readModelResponse(res, job));
  workPromise.catch(() => {});

  try {
    return await Promise.race([workPromise, abortPromise]);
  } finally {
    clearTimeout(timer);
    job.stop = null;
  }
}

const VALID_ACTIONS = new Set([
  'patch_text',
  'replace_text',
  'create_lorebook',
  'update_lorebook',
  'update_lua',
  'upsert_regex',
  'create_persona',
  'update_persona',
  'update_config',
]);

/**
 * Extracts fenced `risuhelper-proposal` blocks using a line-based scanner so:
 * - Dynamic fence lengths (``` or ````) work natively.
 * - Triple backticks inside JSON string values never prematurely close a multiline fence.
 * - Raw body sections terminated by `<<<END>>>` can safely contain markdown ``` code blocks.
 * - Inline single-line blocks (```risuhelper-proposal {...}```) remain supported.
 */
function extractProposalBlocks(rawText) {
  const normalized = String(rawText ?? '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const proseLines = [];
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const openMatch = line.match(/^[ \t]*(`{3,})risuhelper-proposal(?:[ \t]+(.*))?$/);
    if (!openMatch) {
      proseLines.push(line);
      continue;
    }

    const fence = openMatch[1];
    const rest = openMatch[2] ?? '';

    // Single-line inline form: ```risuhelper-proposal {...}```
    if (rest.trim()) {
      const endIdx = rest.lastIndexOf(fence);
      if (endIdx !== -1 && rest.slice(endIdx + fence.length).trim() === '') {
        blocks.push(rest.slice(0, endIdx));
        continue;
      }
    }

    // Look ahead to check if an explicit <<<END>>> marker appears before the next proposal opening
    let explicitEndLine = -1;
    for (let k = i + 1; k < lines.length; k++) {
      if (/^[ \t]*`{3,}risuhelper-proposal(?:\s|$)/.test(lines[k])) break;
      if (/^<<<END>>>[ \t]*$/.test(lines[k])) {
        explicitEndLine = k;
        break;
      }
    }

    const closeRe = new RegExp(`^[ \\t]*${fence}[ \\t]*$`);
    let closeIdx = -1;
    const bodyLines = [];
    if (rest.trim()) bodyLines.push(rest);

    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j];
      const canClose = explicitEndLine === -1 || j > explicitEndLine;
      if (canClose && closeRe.test(candidate)) {
        closeIdx = j;
        break;
      }
      bodyLines.push(candidate);
    }

    if (closeIdx === -1) {
      // Unclosed fence: keep as prose rather than silently dropping text
      proseLines.push(line);
      continue;
    }

    blocks.push(bodyLines.join('\n'));
    i = closeIdx;
  }

  return { prose: proseLines.join('\n').trim(), blocks };
}

/**
 * Parses either a standard JSON proposal payload or a hybrid Header JSON + raw delimiter payload:
 *   {"action":"update_lua","title":"...","scope":"character"}
 *   <<<CODE>>>
 *   ...raw Lua without JSON escaping...
 *   <<<END>>>
 */
function parseProposalPayload(rawBody) {
  const normalized = String(rawBody ?? '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const firstMarkerIdx = lines.findIndex(line => RAW_SECTION_RE.test(line));

  if (firstMarkerIdx === -1) {
    const trimmed = normalized.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  const headerText = lines.slice(0, firstMarkerIdx).join('\n').trim();
  if (!headerText) {
    throw new Error('원문 구분자 블록 앞에 JSON 헤더 객체가 필요합니다.');
  }
  const header = JSON.parse(headerText);
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('원문 구분자 블록의 헤더는 JSON 객체여야 합니다.');
  }

  const sections = [];
  let currentTag = null;
  let currentLines = [];

  for (let i = firstMarkerIdx; i < lines.length; i++) {
    const marker = lines[i].match(RAW_SECTION_RE);
    if (marker) {
      if (currentTag !== null) {
        sections.push({ tag: currentTag, value: currentLines.join('\n') });
      }
      const nextTag = marker[1];
      if (nextTag === 'END') {
        currentTag = null;
        currentLines = [];
        break;
      }
      currentTag = nextTag;
      currentLines = [];
    } else if (currentTag !== null) {
      currentLines.push(lines[i]);
    }
  }
  if (currentTag !== null) {
    sections.push({ tag: currentTag, value: currentLines.join('\n') });
  }

  let pendingBefore = null;
  for (const sec of sections) {
    if (sec.tag === 'BEFORE') {
      if (pendingBefore !== null) {
        throw new Error('<<<BEFORE>>> 뒤에 대응되는 <<<AFTER>>> 블록이 없습니다.');
      }
      pendingBefore = sec.value;
    } else if (sec.tag === 'AFTER') {
      if (pendingBefore === null) {
        throw new Error('<<<AFTER>>> 앞에 대응되는 <<<BEFORE>>> 블록이 없습니다.');
      }
      if (!Array.isArray(header.edits)) header.edits = [];
      header.edits.push({ before: pendingBefore, after: sec.value });
      pendingBefore = null;
    } else if (sec.tag === 'CONTENT') {
      if (header.action === 'create_persona' || header.action === 'update_persona') {
        header.personaPrompt = sec.value;
      } else {
        header.content = sec.value;
      }
    } else if (sec.tag === 'CODE') {
      header.code = sec.value;
    } else if (sec.tag === 'IN') {
      header.in = sec.value;
    } else if (sec.tag === 'OUT') {
      header.out = sec.value;
    }
  }
  if (pendingBefore !== null) {
    throw new Error('<<<BEFORE>>> 뒤에 대응되는 <<<AFTER>>> 블록이 없습니다.');
  }

  return [header];
}

/**
 * Extracts natural prose and structured `risuhelper-proposal` blocks from an LLM reply.
 */
function parseAssistantReply(rawText) {
  const text = String(rawText ?? '');
  const proposals = [];
  const errors = [];
  const { prose, blocks } = extractProposalBlocks(text);

  for (const rawBlock of blocks) {
    const trimmed = rawBlock.trim();
    if (!trimmed) continue;
    try {
      const items = parseProposalPayload(rawBlock);
      for (const item of items) {
        const validationError = validateProposal(item);
        if (validationError) {
          errors.push({ raw: trimmed, error: validationError });
        } else {
          proposals.push(item);
        }
      }
    } catch (err) {
      errors.push({ raw: trimmed, error: `제안 블록 파싱 오류: ${err.message}` });
    }
  }

  return { prose, proposals, errors, rawText: text };
}

function validateFieldKeyForKind(kind, fieldKey) {
  if (fieldKey === undefined || fieldKey === null || fieldKey === '') return null;
  if (typeof fieldKey !== 'string' || BAD_KEYS.has(fieldKey)) {
    return `허용되지 않는 필드 키입니다: ${String(fieldKey)}`;
  }
  if (kind === 'char_field' && !ALLOWED_CHAR_FIELDS.includes(fieldKey)) {
    return `허용되지 않는 캐릭터 필드입니다: ${fieldKey}`;
  }
  if ((kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook') && !ALLOWED_LORE_TEXT_FIELDS.includes(fieldKey)) {
    return `허용되지 않는 로어북 필드입니다: ${fieldKey}`;
  }
  if (kind === 'persona' && !ALLOWED_PERSONA_TEXT_FIELDS.includes(fieldKey)) {
    return `허용되지 않는 페르소나 필드입니다: ${fieldKey}`;
  }
  if (kind === 'chat_note' && fieldKey !== 'note') {
    return `허용되지 않는 작가의 노트 필드입니다: ${fieldKey}`;
  }
  if (kind === 'config' && !ALLOWED_CONFIG_KEYS.includes(fieldKey)) {
    return `허용되지 않는 설정 키입니다: ${fieldKey}`;
  }
  return null;
}

function validateProposal(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return '제안은 JSON 객체여야 합니다.';
  }
  for (const key of Object.keys(item)) {
    if (BAD_KEYS.has(key)) return `허용되지 않는 속성 키입니다: ${key}`;
  }
  if (!VALID_ACTIONS.has(item.action)) {
    return `알 수 없는 action입니다: ${String(item.action)}`;
  }
  if (item.target !== undefined) {
    if (!item.target || typeof item.target !== 'object' || Array.isArray(item.target)) {
      return 'target은 JSON 객체여야 합니다.';
    }
    for (const key of Object.keys(item.target)) {
      if (BAD_KEYS.has(key)) return `허용되지 않는 target 키입니다: ${key}`;
    }
    const targetFieldErr = validateFieldKeyForKind(item.target.targetKind, item.target.fieldKey);
    if (targetFieldErr) return targetFieldErr;
  }
  if (item.action === 'patch_text') {
    if (!Array.isArray(item.edits) || item.edits.length === 0) {
      return 'patch_text에는 1개 이상의 edits 배열({ before, after })이 필요합니다.';
    }
    for (const e of item.edits) {
      if (!e || typeof e.before !== 'string' || !e.before || typeof e.after !== 'string') {
        return 'edits 항목은 비어 있지 않은 문자열 before와 문자열 after가 필요합니다.';
      }
    }
  }
  if (item.action === 'replace_text' && typeof item.content !== 'string') {
    return 'replace_text에는 문자열 content가 필요합니다.';
  }
  if (item.action === 'create_lorebook') {
    if (typeof item.comment !== 'string' || typeof item.content !== 'string') {
      return 'create_lorebook에는 comment와 content 문자열이 필요합니다.';
    }
  }
  if (item.action === 'update_lorebook' && item.fieldKey !== undefined) {
    const err = validateFieldKeyForKind('char_lorebook', item.fieldKey);
    if (err) return err;
  }
  if (item.action === 'update_lua') {
    if (!item.edits && typeof item.code !== 'string' && typeof item.content !== 'string') {
      return 'update_lua에는 edits 배열 또는 code 문자열이 필요합니다.';
    }
  }
  if (item.action === 'upsert_regex') {
    if (typeof item.in !== 'string' || typeof item.out !== 'string') {
      return 'upsert_regex에는 in과 out 문자열이 필요합니다.';
    }
  }
  if (item.action === 'create_persona') {
    if (typeof item.name !== 'string' || typeof (item.personaPrompt ?? item.content) !== 'string') {
      return 'create_persona에는 name과 personaPrompt 문자열이 필요합니다.';
    }
  }
  if (item.action === 'update_persona' && item.fieldKey !== undefined) {
    const err = validateFieldKeyForKind('persona', item.fieldKey);
    if (err) return err;
  }
  if (item.action === 'update_config') {
    if (!item.changes || typeof item.changes !== 'object' || Array.isArray(item.changes)) {
      return 'update_config에는 changes 객체가 필요합니다.';
    }
    const invalid = Object.keys(item.changes).filter(k => !ALLOWED_CONFIG_KEYS.includes(k));
    if (invalid.length > 0) {
      return `허용되지 않는 설정 키입니다: ${invalid.join(', ')}`;
    }
  }
  return null;
}

/**
 * Builds the system prompt + message list sent to Risuai.runLLMModel().
 */
function buildConversationMessages({ context, snapshot, extraContext, history, userInput, maxHistoryTurns = 12 }) {
  const knowledge = buildKnowledgeForContext(context);
  const targetLabel = snapshot?.label || context?.labelText || '일반 화면';
  const currentText = snapshot?.content ?? '';
  const isTruncated = currentText.length > MAX_LLM_CONTENT_CHARS;
  const clippedContent = isTruncated
    ? currentText.slice(0, MAX_LLM_CONTENT_CHARS) + `\n... (총 ${currentText.length}자 중 앞 ${MAX_LLM_CONTENT_CHARS.toLocaleString()}자만 표시)`
    : currentText;

  const extraBlocks = [];
  if (extraContext?.charSummary) {
    extraBlocks.push(`[현재 캐릭터 요약]\n${JSON.stringify(extraContext.charSummary, null, 2)}`);
  }
  if (extraContext?.loreSummary) {
    extraBlocks.push(`[로어북 목록 요약]\n${JSON.stringify(extraContext.loreSummary, null, 2)}`);
  }
  if (extraContext?.personasSummary) {
    extraBlocks.push(`[페르소나 목록 요약]\n${JSON.stringify(extraContext.personasSummary, null, 2)}`);
  }
  if (extraContext?.configSummary) {
    extraBlocks.push(`[현재 허용 RisuAI 설정값]\n${JSON.stringify(extraContext.configSummary, null, 2)}`);
  }

  const truncationRule = isTruncated
    ? `\n⚠️ [원문 잘림 경고] 현재 원문(${currentText.length.toLocaleString()}자)은 앞 ${MAX_LLM_CONTENT_CHARS.toLocaleString()}자만 제공되었습니다. 뒷부분 유실을 막기 위해 replace_text 및 전체 code 덮어쓰기는 차단됩니다. 반드시 patch_text 또는 edits로 보이는 구간만 부분 편집하세요.`
    : '';

  const screenNote = context?.screen === 'chat'
    ? '\n- 안내: 사용자는 현재 채팅 화면(대화 입력창)에 있습니다. 특정 편집 필드를 열지 않았더라도 아래 [현재 캐릭터 요약]/[로어북 목록 요약] 등을 바탕으로 질문에 답하거나, 새 로어북·페르소나·정규식·Lua 생성 및 설정 변경을 바로 제안할 수 있습니다.'
    : '';

  const systemPrompt = `당신은 RisuAI(및 PocketRisu, RisuBard, 해적리스, RisuNest 등 포크) 안에 내장된 소통형 어시스턴트 "RisuHelper"입니다.
사용자의 질문(설정 의미, 사용법, 디버깅, 프롬프트/로어북/Lua/정규식/페르소나 작성)에 친절하고 정확하게 한국어로 답합니다.

${knowledge}

[현재 감지된 화면 및 대상]
- 화면: ${context?.screen || 'unknown'}
- 대상 종류(targetKind): ${snapshot?.target?.targetKind || context?.targetKind || 'general'}
- 필드(fieldKey): ${snapshot?.target?.fieldKey || context?.fieldKey || '없음'}
- 대상 설명: ${targetLabel}${screenNote}
${snapshot?.target?.loreIndex !== null && snapshot?.target?.loreIndex !== undefined ? `- 로어북 인덱스(0-based): ${snapshot.target.loreIndex}` : ''}
${snapshot?.target?.regexIndex !== null && snapshot?.target?.regexIndex !== undefined ? `- 정규식 인덱스(0-based): ${snapshot.target.regexIndex}` : ''}
${snapshot?.target?.personaIndex !== null && snapshot?.target?.personaIndex !== undefined ? `- 페르소나 인덱스(0-based): ${snapshot.target.personaIndex}` : ''}
${snapshot?.target?.moduleIndex !== null && snapshot?.target?.moduleIndex !== undefined ? `- 모듈 인덱스(0-based): ${snapshot.target.moduleIndex}` : ''}

[현재 대상의 실제 원문]
\`\`\`
${clippedContent || '(비어 있음)'}
\`\`\`${truncationRule}

${extraBlocks.join('\n\n')}

[수정·생성 제안 프로토콜]
1. 단순 질문·상담·설명 요청일 때는 자연어 답변만 작성하고 제안 블록을 출력하지 마세요.
2. 사용자가 편집·수정·덮어쓰기·새로 생성·설정 변경을 요청할 때는 설명과 함께 \`\`\`risuhelper-proposal 블록을 포함하세요. 사용자가 UI에서 Diff를 검토하고 "적용" 버튼을 눌러야 실제 반영됩니다.
3. 기존 긴 원문의 일부만 바꿀 때는 반드시 \`patch_text\`를 사용하고, \`before\`에는 위 [현재 대상의 실제 원문]에서 **공백과 줄바꿈까지 정확히 일치하는 고유 구간**을 복사하세요.
4. 주의: \`patch_text\`/\`replace_text\`에서 \`target\`을 임의로 바꿔 다른 필드를 지정하지 마세요.

지원 action 스키마 (표준 JSON):
- 부분 편집: {"action":"patch_text","title":"설명","edits":[{"before":"원문 구간","after":"수정 구간"}]}
- 전체 덮어쓰기: {"action":"replace_text","title":"설명","content":"새 전체 텍스트"}
- 새 로어북 생성: {"action":"create_lorebook","title":"설명","scope":"character|chat|module","comment":"항목명","key":"키1,키2","secondkey":"","selective":false,"alwaysActive":false,"insertorder":100,"content":"본문"}
- 기존 로어북 수정: {"action":"update_lorebook","title":"설명","scope":"character|chat|module","loreIndex":0,"comment":"항목명","key":"키1,키2","edits":[{"before":"...","after":"..."}]}
- Lua 트리거 수정/생성: {"action":"update_lua","title":"설명","scope":"character|module","edits":[{"before":"...","after":"..."}]} (신규이거나 전체 교체면 "code":"..." 사용)
- 정규식 생성/수정: {"action":"upsert_regex","title":"설명","scope":"character|module","comment":"이름","in":"패턴","out":"치환","type":"editdisplay|editoutput|editinput|editprocess","flag":"g","ableFlag":true}
- 새 페르소나 생성: {"action":"create_persona","title":"설명","name":"이름","note":"메모","personaPrompt":"설명","bindToCurrentChat":true}
- 기존 페르소나 수정: {"action":"update_persona","title":"설명","personaIndex":0,"name":"이름","note":"메모","personaPrompt":"설명","bindToCurrentChat":false}
- 허용 설정 변경: {"action":"update_config","title":"설명","changes":{"temperature":80,"maxResponse":2000}}

[권장: 긴 코드·Lua·정규식·HTML용 원문 구분자 형식 (JSON 이스케이프 불필요)]
따옴표·백슬래시·줄바꿈이 많은 Lua/정규식/HTML/긴 본문은 JSON 헤더 아래에 구분자 섹션을 쓰면 이스케이프 오류를 피할 수 있습니다:
- 부분 편집: JSON 헤더 아래 \`<<<BEFORE>>>\` ... \`<<<AFTER>>>\` (반복 가능) ... \`<<<END>>>\`
- 전체 본문/코드: JSON 헤더 아래 \`<<<CONTENT>>>\` 또는 \`<<<CODE>>>\` ... \`<<<END>>>\`
- 정규식: JSON 헤더 아래 \`<<<IN>>>\` ... \`<<<OUT>>>\` ... \`<<<END>>>\`
(본문 안에 \`\`\` 마크다운이 포함되면 반드시 \`<<<END>>>\`를 닫거나 4개 백틱 \`\`\`\`risuhelper-proposal을 사용하세요.)

JSON 헤더 안에는 주석이나 trailing comma를 넣지 말고 유효한 JSON만 출력하세요.`;

  const recentHistory = (history || []).slice(-(maxHistoryTurns * 2)).map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.rawText || msg.content,
  }));

  return [
    { role: 'system', content: systemPrompt },
    ...recentHistory,
    { role: 'user', content: String(userInput ?? '') },
  ];
}

export {
  readModelResponse,
  callRisuModel,
  extractProposalBlocks,
  parseProposalPayload,
  parseAssistantReply,
  validateProposal,
  buildConversationMessages,
};
