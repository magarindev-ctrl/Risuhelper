// Moving state between two chats of the same character ("chat migration").
//
// Three jobs, all pure:
//   - listChats: the character's chats, so a request can name one.
//   - buildReferenceChat: what the model is shown of another chat (note, variables, lorebook
//     names and as much of the transcript as fits the budget, newest first).
//   - planChatImport: what copying the chosen items into the current chat changes. Values are
//     copied as they are; the model only chooses which chat and which items, it never retypes them.

const CHAT_TRANSFER_ITEMS = ['variables', 'authorNote', 'localLore', 'persona', 'modules', 'greeting'];

const CHAT_TRANSFER_LABELS = {
  variables: '변수',
  authorNote: '작가의 노트',
  localLore: '채팅 로어북',
  persona: '연결 페르소나',
  modules: '채팅 모듈',
  greeting: '첫 메시지 번호',
};

const MAX_LISTED_CHATS = 60;
const MAX_REFERENCE_VARIABLES = 200;
const MAX_VARIABLE_VALUE_CHARS = 200;
const MAX_REFERENCE_LORE = 80;
const MAX_REFERENCE_NOTE_CHARS = 8000;
const MAX_VARIABLE_ROWS = 40;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function chatName(chat, index) {
  const name = String(chat?.name ?? '').trim();
  return name || `채팅 ${index + 1}`;
}

/**
 * @returns {Array<{ index: number, name: string, current: boolean, messages: number|null, id: string|null }>}
 */
function listChats(char, activeIndex) {
  const chats = Array.isArray(char?.chats) ? char.chats : [];
  return chats.map((chat, index) => ({
    index,
    name: chatName(chat, index),
    current: index === activeIndex,
    // A chat the host has not loaded yet (PocketRisu placeholder) has no known size.
    messages: !chat?._placeholder && Array.isArray(chat?.message) ? chat.message.length : null,
    id: typeof chat?.id === 'string' && chat.id ? chat.id : null,
  }));
}

/** The chat list as the model sees it (bounded; the current chat is always kept). */
function summarizeChatList(chats) {
  const current = chats.find(c => c.current);
  const shown = chats.slice(0, MAX_LISTED_CHATS);
  if (current && !shown.includes(current)) shown.push(current);
  return {
    chats: shown.map(c => ({
      chatIndex: c.index,
      name: c.name,
      ...(c.messages !== null ? { messages: c.messages } : {}),
      ...(c.current ? { current: true } : {}),
    })),
    total: chats.length,
  };
}

const CHAT_NUMBER_BEFORE = /(\d+)\s*번\s*째?\s*(?:채팅|챗|chat)/i;
const CHAT_NUMBER_AFTER = /(?:채팅|챗|chat)\s*(?:#\s*(\d+)|(\d+)\s*번)/i;

/**
 * Which other chat a request names: by its exact name (the longest matching name wins, and it
 * has to be unique) or by its number ("2번 채팅", "채팅 #2"). Returns null rather than guessing.
 */
function mentionedChatIndex(userInput, chats) {
  const text = String(userInput ?? '').toLowerCase();
  if (!text || !Array.isArray(chats) || chats.length < 2) return null;

  const named = chats
    .map(c => ({ chat: c, name: c.name.toLowerCase() }))
    .filter(c => c.name.length >= 2 && text.includes(c.name));
  if (named.length > 0) {
    const longest = Math.max(...named.map(c => c.name.length));
    const best = named.filter(c => c.name.length === longest);
    if (best.length === 1 && !best[0].chat.current) return best[0].chat.index;
    return null;
  }

  const m = text.match(CHAT_NUMBER_BEFORE) || text.match(CHAT_NUMBER_AFTER);
  if (m) {
    const number = Number(m[1] ?? m[2]);
    const hit = chats.find(c => c.index === number - 1);
    if (hit && !hit.current) return hit.index;
  }
  return null;
}

function variableName(key) {
  return key.startsWith('$') ? key.slice(1) : key;
}

function memoryTexts(chat) {
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
 * What the model is shown of another chat. The transcript keeps the newest messages that fit
 * `budget` characters; when older ones are left out, summaries the host's memory feature already
 * made (HypaV3 / HypaV2 / SupaMemory) are passed along to cover them.
 */
function buildReferenceChat(chat, { index, budget = 60000 } = {}) {
  const limit = Math.max(200, Number(budget) || 0);
  const messages = Array.isArray(chat?.message) ? chat.message : [];

  const transcript = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = String(messages[i]?.data ?? '');
    const role = messages[i]?.role === 'user' ? '유저' : '캐릭터';
    if (used + text.length > limit) {
      if (transcript.length === 0) {
        transcript.unshift({ n: i + 1, role, text: text.slice(text.length - limit), truncated: true });
        used = limit;
      }
      break;
    }
    transcript.unshift({ n: i + 1, role, text });
    used += text.length;
  }
  const omittedMessages = messages.length - transcript.length;

  const state = chat?.scriptstate && typeof chat.scriptstate === 'object' ? chat.scriptstate : {};
  const stateKeys = Object.keys(state).filter(k => !BAD_KEYS.has(k));
  const variables = stateKeys.slice(0, MAX_REFERENCE_VARIABLES).map(key => {
    const value = String(state[key]);
    return {
      name: variableName(key),
      value: value.length > MAX_VARIABLE_VALUE_CHARS ? `${value.slice(0, MAX_VARIABLE_VALUE_CHARS)}…` : value,
    };
  });

  const loreEntries = (Array.isArray(chat?.localLore) ? chat.localLore : []).filter(e => e?.mode !== 'folder');
  const note = String(chat?.note ?? '');

  const memorySummaries = [];
  let memoryTruncated = false;
  if (omittedMessages > 0) {
    let memoryBudget = Math.max(2000, Math.floor(limit / 4));
    for (const text of memoryTexts(chat)) {
      if (text.length > memoryBudget) { memoryTruncated = true; break; }
      memorySummaries.push(text);
      memoryBudget -= text.length;
    }
  }

  return {
    index,
    name: chatName(chat, index ?? 0),
    messageCount: messages.length,
    authorNote: note.length > MAX_REFERENCE_NOTE_CHARS ? `${note.slice(0, MAX_REFERENCE_NOTE_CHARS)}…` : note,
    variables,
    variablesOmitted: Math.max(0, stateKeys.length - variables.length),
    chatLore: loreEntries.slice(0, MAX_REFERENCE_LORE).map(e => ({
      comment: String(e?.comment ?? ''),
      key: String(e?.key ?? ''),
      chars: String(e?.content ?? '').length,
    })),
    chatLoreOmitted: Math.max(0, loreEntries.length - MAX_REFERENCE_LORE),
    memorySummaries,
    memoryTruncated,
    transcript,
    omittedMessages,
    transcriptChars: used,
  };
}

function loreLine(entry) {
  if (entry?.mode === 'folder') return `📁 ${entry.comment || '(이름 없는 폴더)'}`;
  const key = String(entry?.key ?? '').trim();
  return `- ${entry?.comment || '(이름 없음)'}${key ? ` (${key})` : ''}`;
}

function loreIdentity(entry) {
  if (entry?.mode === 'folder') return `folder:${entry.key}`;
  return JSON.stringify([entry?.comment ?? '', entry?.key ?? '', entry?.secondkey ?? '', entry?.content ?? '', entry?.folder ?? '']);
}

function greetingLabel(fmIndex) {
  return Number.isInteger(fmIndex) && fmIndex >= 0 ? `추가 첫 메시지 #${fmIndex + 1}` : '기본 첫 메시지';
}

/**
 * Plans copying `items` from `source` into `target` (neither is mutated).
 *
 * Variables merge key by key, the chat lorebook only gains entries it does not already have, and
 * chat modules are a union — so what the current chat already holds is only replaced where the
 * source has a different value for the same thing (`overwrites` counts variables and the note).
 * An item the source does not have is skipped, never used to blank the current chat.
 */
function planChatImport(source, target, { items = [], variableKeys = null, personas = null, modules = null } = {}) {
  const next = cloneJson(target) || {};
  const wanted = new Set(items);
  const metaChanges = [];
  const beforeParts = [];
  const afterParts = [];
  const skipped = [];
  const copied = [];
  const missingVariables = [];
  let overwrites = 0;

  if (wanted.has('variables')) {
    const state = source?.scriptstate && typeof source.scriptstate === 'object' ? source.scriptstate : {};
    let keys = Object.keys(state).filter(k => !BAD_KEYS.has(k));
    if (Array.isArray(variableKeys) && variableKeys.length > 0) {
      const picked = [];
      for (const raw of variableKeys) {
        const name = String(raw ?? '');
        const key = [name, `$${name}`].find(k => keys.includes(k));
        if (key) { if (!picked.includes(key)) picked.push(key); } else missingVariables.push(name);
      }
      keys = picked;
    }
    if (keys.length === 0) {
      skipped.push({ item: 'variables', reason: '원본 채팅에 옮길 변수가 없습니다.' });
    } else {
      const current = next.scriptstate && typeof next.scriptstate === 'object' ? next.scriptstate : {};
      const rows = [];
      for (const key of keys) {
        const had = Object.hasOwn(current, key);
        if (had && sameJson(current[key], state[key])) continue;
        if (had) overwrites++;
        rows.push({ label: `변수 ${variableName(key)}`, before: had ? String(current[key]) : '(없음)', after: String(state[key]) });
        current[key] = cloneJson(state[key]);
      }
      if (rows.length > 0) {
        next.scriptstate = current;
        metaChanges.push(...rows.slice(0, MAX_VARIABLE_ROWS));
        if (rows.length > MAX_VARIABLE_ROWS) {
          metaChanges.push({ label: '그 외 변수', before: '', after: `${rows.length - MAX_VARIABLE_ROWS}개 더` });
        }
        copied.push(`변수 ${rows.length}개`);
      }
    }
  }

  if (wanted.has('authorNote')) {
    const note = String(source?.note ?? '');
    const currentNote = String(next.note ?? '');
    if (!note.trim()) {
      skipped.push({ item: 'authorNote', reason: '원본 채팅의 작가의 노트가 비어 있습니다.' });
    } else if (note !== currentNote) {
      if (currentNote.trim()) overwrites++;
      beforeParts.push(`[작가의 노트]\n${currentNote || '(비어 있음)'}`);
      afterParts.push(`[작가의 노트]\n${note}`);
      next.note = note;
      copied.push('작가의 노트');
    }
  }

  if (wanted.has('localLore')) {
    const list = Array.isArray(source?.localLore) ? source.localLore : [];
    if (list.length === 0) {
      skipped.push({ item: 'localLore', reason: '원본 채팅에 채팅 로어북이 없습니다.' });
    } else {
      const current = Array.isArray(next.localLore) ? next.localLore : [];
      const known = new Set(current.map(loreIdentity));
      const added = list.filter(e => !known.has(loreIdentity(e)));
      if (added.length > 0) {
        beforeParts.push(`[채팅 로어북]\n${current.map(loreLine).join('\n') || '(비어 있음)'}`);
        next.localLore = [...current, ...added.map(cloneJson)];
        afterParts.push(`[채팅 로어북]\n${next.localLore.map(loreLine).join('\n')}`);
        copied.push(`채팅 로어북 ${added.filter(e => e?.mode !== 'folder').length}개`);
      }
    }
  }

  if (wanted.has('persona')) {
    const id = source?.bindedPersona;
    const nameOf = (pid) => (Array.isArray(personas) ? personas.find(p => p?.id === pid)?.name : null) || String(pid);
    if (!id) {
      skipped.push({ item: 'persona', reason: '원본 채팅에 연결된 페르소나가 없습니다.' });
    } else if (Array.isArray(personas) && !personas.some(p => p?.id === id)) {
      skipped.push({ item: 'persona', reason: '원본 채팅에 연결돼 있던 페르소나가 지금은 없습니다.' });
    } else if (next.bindedPersona !== id) {
      metaChanges.push({ label: '연결 페르소나', before: next.bindedPersona ? nameOf(next.bindedPersona) : '(없음)', after: nameOf(id) });
      next.bindedPersona = id;
      copied.push('연결 페르소나');
    }
  }

  if (wanted.has('modules')) {
    const ids = (Array.isArray(source?.modules) ? source.modules : []).filter(id => typeof id === 'string' && id);
    const nameOf = (mid) => (Array.isArray(modules) ? modules.find(m => m?.id === mid)?.name : null) || mid;
    if (ids.length === 0) {
      skipped.push({ item: 'modules', reason: '원본 채팅에 켜 둔 채팅 모듈이 없습니다.' });
    } else {
      const current = Array.isArray(next.modules) ? next.modules : [];
      const added = ids.filter(id => !current.includes(id));
      if (added.length > 0) {
        next.modules = [...current, ...added];
        metaChanges.push({
          label: '채팅 모듈',
          before: current.map(nameOf).join(', ') || '(없음)',
          after: next.modules.map(nameOf).join(', '),
        });
        copied.push(`채팅 모듈 ${added.length}개`);
      }
    }
  }

  if (wanted.has('greeting')) {
    if (!Number.isInteger(source?.fmIndex)) {
      skipped.push({ item: 'greeting', reason: '원본 채팅에 첫 메시지 번호 정보가 없습니다.' });
    } else {
      const currentIndex = Number.isInteger(next.fmIndex) ? next.fmIndex : -1;
      if (currentIndex !== source.fmIndex) {
        metaChanges.push({ label: '첫 메시지', before: greetingLabel(currentIndex), after: greetingLabel(source.fmIndex) });
        next.fmIndex = source.fmIndex;
        copied.push('첫 메시지 번호');
      }
    }
  }

  return {
    next,
    changed: copied.length > 0,
    copied,
    skipped,
    missingVariables,
    overwrites,
    metaChanges,
    before: beforeParts.join('\n\n'),
    after: afterParts.join('\n\n'),
  };
}

export {
  listChats,
  summarizeChatList,
  mentionedChatIndex,
  buildReferenceChat,
  planChatImport,
  chatName,
  CHAT_TRANSFER_ITEMS,
  CHAT_TRANSFER_LABELS,
};
