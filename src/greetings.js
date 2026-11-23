// First message context for the model.
//
// A character has one default first message (`firstMessage`, index -1 — the same convention as
// RisuAI's `chat.fmIndex`) and any number of alternate greetings (`alternateGreetings[n]`).
// The plan below decides how much of each is sent to the model, and records which ones were
// sent in full: a greeting the model only saw a preview of must not be overwritten wholesale.

const GREETING_PREVIEW_CHARS = 300;
const GREETING_CONTEXT_BUDGET = 16000;
const MAX_LISTED_ALT_GREETINGS = 30;

/**
 * @returns {{
 *   activeIndex: number,
 *   greetings: Array<{ index: number, active: boolean, length: number, text: string, truncated: boolean }>,
 *   shownFull: number[],
 * }}
 */
function planGreetingContext(char, chat, { includeFullText = false, budget = GREETING_CONTEXT_BUDGET } = {}) {
  const alternates = Array.isArray(char?.alternateGreetings) ? char.alternateGreetings.slice(0, MAX_LISTED_ALT_GREETINGS) : [];
  const fmIndex = Number.isInteger(chat?.fmIndex) ? chat.fmIndex : -1;
  const activeIndex = fmIndex >= 0 && alternates[fmIndex] !== undefined ? fmIndex : -1;

  const entries = [
    { index: -1, full: String(char?.firstMessage ?? '') },
    ...alternates.map((text, i) => ({ index: i, full: String(text ?? '') })),
  ];

  // The greeting the current chat uses gets the budget first, then the rest in order.
  const order = [...entries].sort((a, b) => (b.index === activeIndex) - (a.index === activeIndex));
  const showFull = new Set();
  let remaining = Math.max(0, Number(budget) || 0);
  for (const entry of order) {
    if (entry.full.length <= GREETING_PREVIEW_CHARS) {
      showFull.add(entry.index);
    } else if (includeFullText && entry.full.length <= remaining) {
      showFull.add(entry.index);
      remaining -= entry.full.length;
    }
  }

  const greetings = entries.map(entry => {
    const isFull = showFull.has(entry.index);
    return {
      index: entry.index,
      active: entry.index === activeIndex,
      length: entry.full.length,
      text: isFull ? entry.full : entry.full.slice(0, GREETING_PREVIEW_CHARS),
      truncated: !isFull,
    };
  });

  return { activeIndex, greetings, shownFull: greetings.filter(g => !g.truncated).map(g => g.index) };
}

const GREETING_REQUEST_RE = /첫\s*(메시지|메세지|인사|대사)|인사말|퍼스트\s*메시지|first\s*message|greeting/i;

/**
 * Whether full greeting text is worth its prompt cost for this request: on the chat screen
 * (no field is open, so the greeting is the likeliest subject), when a greeting is the current
 * target, or when the request itself talks about first messages.
 */
function wantsGreetingText(context, userInput) {
  if (context?.screen === 'chat' || context?.targetKind === 'general') return true;
  if (context?.targetKind === 'char_alt_greeting') return true;
  if (context?.targetKind === 'char_field' && context?.fieldKey === 'firstMessage') return true;
  return GREETING_REQUEST_RE.test(String(userInput ?? ''));
}

export { planGreetingContext, wantsGreetingText, GREETING_PREVIEW_CHARS, GREETING_CONTEXT_BUDGET };
