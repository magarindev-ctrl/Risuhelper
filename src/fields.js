// Character text fields (and the chat's author note) that can be edited without selecting them
// as the target, plus the plan for how much of each is shown to the model.
//
// Sending every field in full on every request would be wasteful, so the default is a short
// preview per field; a field is sent in full only when the request itself talks about it. The
// plan records which fields were sent in full: a field the model only saw a preview of must not
// be overwritten wholesale.

import { CHAR_FIELD_META, ALLOWED_CHAR_FIELDS } from './version.js';

const AUTHOR_NOTE_FIELD = 'authorNote';
const FREE_EDIT_FIELDS = [...ALLOWED_CHAR_FIELDS, AUTHOR_NOTE_FIELD];
const FIELD_PREVIEW_CHARS = 160;
const FIELD_CONTEXT_BUDGET = 24000;

// What a request has to say for a field to count as "mentioned". "설명해줘" (explain) must not be
// read as the description field, hence the negative lookahead.
const FIELD_KEYWORDS = {
  desc: /캐릭터\s*설명|(?<!추가\s?)설명(?!서|\s*(?:좀\s*)?(?:해|하|부탁|드리|드려|을\s*해|을\s*부탁)|\s+좀[\s.,?!]*$)|디스크립션|(?<!additional\s)description|\bdesc\b/i,
  additionalText: /추가\s*(디스크립션|설명)|additional\s*(description|text)/i,
  firstMessage: /첫\s*(메시지|메세지|인사|대사)|first\s*message/i,
  creatorNotes: /제작자\s*(코멘트|노트)|creator'?s?\s*(comment|note)/i,
  systemPrompt: /시스템\s*프롬프트|system\s*prompt/i,
  replaceGlobalNote: /글로벌\s*노트|global\s*note/i,
  postHistoryInstructions: /히스토리\s*이후|post[\s-]*history/i,
  exampleMessage: /예시\s*(대화|메시지)|example\s*(message|dialog)/i,
  personality: /성격|personality/i,
  scenario: /시나리오|scenario/i,
  defaultVariables: /기본\s*변수|default\s*variables?/i,
  translatorNote: /번역가|translator/i,
  customModuleToggle: /커스텀\s*토글|custom\s*toggles?/i,
  depthPrompt: /깊이\s*프롬프트|depth\s*prompt/i,
  backgroundHTML: /백그라운드\s*(임베딩|html)|background\s*(embedding|html)/i,
  virtualscript: /캐릭터\s*(js|스크립트)|character\s*js|charjs/i,
  nickname: /닉네임|nickname/i,
  name: /캐릭터\s*이름|character\s*name/i,
  [AUTHOR_NOTE_FIELD]: /작가의?\s*노트|작노|author'?s?\s*note/i,
};

function fieldLabel(field) {
  if (field === AUTHOR_NOTE_FIELD) return '작가의 노트 (현재 채팅)';
  return CHAR_FIELD_META[field]?.label || field;
}

function mentionedFields(userInput) {
  const text = String(userInput ?? '');
  if (!text) return [];
  return FREE_EDIT_FIELDS.filter(field => FIELD_KEYWORDS[field]?.test(text));
}

function readField(char, chat, field) {
  if (field === AUTHOR_NOTE_FIELD) return String(chat?.note ?? '');
  if (field === 'depthPrompt') return String(char?.depth_prompt?.prompt ?? '');
  return String(char?.[field] ?? '');
}

/**
 * @returns {{
 *   fields: Array<{ field: string, label: string, length: number, text: string, truncated: boolean }>,
 *   shownFull: string[],
 * }}
 */
function planFieldContext(char, chat, { userInput = '', budget = FIELD_CONTEXT_BUDGET, onlyMentioned = false } = {}) {
  const isGroup = char?.type === 'group';
  const wanted = new Set(mentionedFields(userInput));
  // Most RisuAI cards keep personality inside `desc`; when `personality` is empty, also surface `desc`.
  if (!isGroup && wanted.has('personality') && !readField(char, chat, 'personality').trim()) {
    wanted.add('desc');
  }
  let remaining = Math.max(0, Number(budget) || 0);

  const candidateFields = isGroup
    ? [AUTHOR_NOTE_FIELD]
    : FREE_EDIT_FIELDS.filter(field => field !== 'firstMessage'); // first messages have their own list (src/greetings.js)

  const entries = candidateFields
    .filter(field => !onlyMentioned || wanted.has(field))
    .map(field => ({ field, full: readField(char, chat, field) }))
    .filter(entry => entry.full.length > 0);

  // Mentioned fields get the budget first, in list order.
  const showFull = new Set();
  for (const entry of [...entries].sort((a, b) => wanted.has(b.field) - wanted.has(a.field))) {
    if (entry.full.length <= FIELD_PREVIEW_CHARS) {
      showFull.add(entry.field);
    } else if (wanted.has(entry.field) && entry.full.length <= remaining) {
      showFull.add(entry.field);
      remaining -= entry.full.length;
    }
  }

  const fields = entries.map(entry => {
    const isFull = showFull.has(entry.field);
    return {
      field: entry.field,
      label: fieldLabel(entry.field),
      length: entry.full.length,
      text: isFull ? entry.full : entry.full.slice(0, FIELD_PREVIEW_CHARS),
      truncated: !isFull,
    };
  });

  return { fields, shownFull: fields.filter(f => !f.truncated).map(f => f.field) };
}

export { planFieldContext, mentionedFields, fieldLabel, FREE_EDIT_FIELDS, AUTHOR_NOTE_FIELD, FIELD_PREVIEW_CHARS, FIELD_CONTEXT_BUDGET };
