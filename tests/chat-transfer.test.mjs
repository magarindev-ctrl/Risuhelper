// Moving state between chats of one character: listing chats, reading a reference chat within a
// budget, and planning what an import changes.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listChats,
  mentionedChatIndex,
  buildReferenceChat,
  planChatImport,
  CHAT_TRANSFER_ITEMS,
} from '../src/chat-transfer.js';

const msg = (role, data) => ({ role, data, chatId: `${role}-${data.slice(0, 6)}` });

function sourceChat() {
  return {
    id: 'chat-a',
    name: '1부 모험',
    note: 'A챗 작가의 노트',
    message: [msg('user', '안녕'), msg('char', '어서 와'), msg('user', '검을 줘'), msg('char', '여기 있어')],
    scriptstate: { $hp: 80, $affection: '12', $flag_met: true },
    localLore: [
      { key: 'folder:aaaa', comment: '인물', content: '', mode: 'folder' },
      { key: '철수', comment: '철수', content: '동료 기사', mode: 'normal', folder: 'folder:aaaa' },
      { key: '검', comment: '성검', content: '빛나는 검', mode: 'normal' },
    ],
    bindedPersona: 'persona-1',
    modules: ['mod-a', 'mod-b'],
    fmIndex: 1,
  };
}

test('chats of the character are listed with their number, name and size', () => {
  const char = { chats: [sourceChat(), { name: '2부', message: [], id: 'chat-b' }, { name: '서버 보관', _placeholder: true, id: 'chat-c' }] };
  const chats = listChats(char, 1);
  assert.deepEqual(chats.map(c => c.index), [0, 1, 2]);
  assert.deepEqual(chats.map(c => c.name), ['1부 모험', '2부', '서버 보관']);
  assert.deepEqual(chats.map(c => c.current), [false, true, false]);
  assert.equal(chats[0].messages, 4);
  assert.equal(chats[2].messages, null, 'an unloaded chat has no known size');
  assert.equal(chats[0].id, 'chat-a');
});

test('a request names another chat by its number or by its exact name', () => {
  const chats = listChats({ chats: [{ name: '1부 모험', message: [] }, { name: '2부', message: [] }, { name: 'New Chat 3', message: [] }] }, 1);
  assert.equal(mentionedChatIndex('1번 채팅에서 변수 옮겨줘', chats), 0);
  assert.equal(mentionedChatIndex('3번째 챗 요약해서 가져와', chats), 2);
  assert.equal(mentionedChatIndex('채팅 #3 내용 요약', chats), 2);
  assert.equal(mentionedChatIndex('"1부 모험"에서 이사하자', chats), 0);
  assert.equal(mentionedChatIndex('new chat 3 에서 가져와', chats), 2);
  assert.equal(mentionedChatIndex('2번 채팅에서 가져와', chats), null, 'the current chat is not another chat');
  assert.equal(mentionedChatIndex('9번 채팅에서 가져와', chats), null);
  assert.equal(mentionedChatIndex('작노 좀 고쳐줘', chats), null);
});

test('a chat name that also appears inside another name is not guessed', () => {
  const chats = listChats({ chats: [{ name: '모험', message: [] }, { name: '모험 2', message: [] }, { name: '지금', message: [] }] }, 2);
  assert.equal(mentionedChatIndex('모험 2에서 가져와', chats), 1, 'the longest matching name wins');
  const twins = listChats({ chats: [{ name: '모험', message: [] }, { name: '모험', message: [] }, { name: '지금', message: [] }] }, 2);
  assert.equal(mentionedChatIndex('모험에서 가져와', twins), null, 'two chats with the same name are ambiguous');
});

test('the reference chat carries its note, variables, lorebook and the whole transcript when it fits', () => {
  const ref = buildReferenceChat(sourceChat(), { index: 0, budget: 10000 });
  assert.equal(ref.index, 0);
  assert.equal(ref.name, '1부 모험');
  assert.equal(ref.messageCount, 4);
  assert.equal(ref.authorNote, 'A챗 작가의 노트');
  assert.deepEqual(ref.variables, [{ name: 'hp', value: '80' }, { name: 'affection', value: '12' }, { name: 'flag_met', value: 'true' }]);
  assert.deepEqual(ref.chatLore.map(e => e.comment), ['철수', '성검'], 'folders are not entries');
  assert.equal(ref.omittedMessages, 0);
  assert.deepEqual(ref.transcript.map(m => `${m.role}:${m.text}`), ['유저:안녕', '캐릭터:어서 와', '유저:검을 줘', '캐릭터:여기 있어']);
  assert.deepEqual(ref.transcript.map(m => m.n), [1, 2, 3, 4]);
});

test('a transcript longer than the budget keeps the latest messages and says how many were left out', () => {
  const chat = sourceChat();
  chat.message = Array.from({ length: 50 }, (_, i) => msg(i % 2 ? 'char' : 'user', `${i + 1}번째 ` + '가'.repeat(95)));
  const ref = buildReferenceChat(chat, { index: 0, budget: 1000 });
  assert.equal(ref.messageCount, 50);
  assert.ok(ref.transcript.length > 0 && ref.transcript.length < 50);
  assert.equal(ref.transcript.at(-1).n, 50, 'the newest message is kept');
  assert.equal(ref.omittedMessages, 50 - ref.transcript.length);
  assert.ok(ref.transcript.reduce((n, m) => n + m.text.length, 0) <= 1000);
});

test('a single message larger than the whole budget is cut rather than dropped', () => {
  const chat = sourceChat();
  chat.message = [msg('user', '처음'), msg('char', '끝'.repeat(5000))];
  const ref = buildReferenceChat(chat, { index: 0, budget: 1000 });
  assert.equal(ref.transcript.length, 1);
  assert.equal(ref.transcript[0].n, 2);
  assert.equal(ref.transcript[0].truncated, true);
  assert.ok(ref.transcript[0].text.length <= 1000);
  assert.equal(ref.omittedMessages, 1);
});

test('memory summaries the host already made stand in for the messages that were left out', () => {
  const chat = sourceChat();
  chat.message = Array.from({ length: 40 }, (_, i) => msg('user', `${i + 1} ` + '나'.repeat(98)));
  chat.hypaV3Data = { summaries: [{ text: '1장 요약: 마을을 떠났다', chatMemos: [] }, { text: '2장 요약: 숲에 도착했다', chatMemos: [] }] };
  const cut = buildReferenceChat(chat, { index: 0, budget: 1000 });
  assert.deepEqual(cut.memorySummaries, ['1장 요약: 마을을 떠났다', '2장 요약: 숲에 도착했다']);

  chat.hypaV3Data = undefined;
  chat.hypaV2Data = { mainChunks: [{ id: 0, text: 'V2 요약', chatMemos: [] }], chunks: [] };
  assert.deepEqual(buildReferenceChat(chat, { index: 0, budget: 1000 }).memorySummaries, ['V2 요약']);

  chat.hypaV2Data = undefined;
  chat.supaMemoryData = '수파 메모리 요약';
  assert.deepEqual(buildReferenceChat(chat, { index: 0, budget: 1000 }).memorySummaries, ['수파 메모리 요약']);
});

test('importing copies variables exactly and merges them into what the chat already has', () => {
  const target = { name: '2부', message: [], note: '', localLore: [], scriptstate: { $hp: 100, $gold: 5 } };
  const source = sourceChat();
  const plan = planChatImport(source, target, { items: ['variables'] });

  assert.deepEqual(plan.next.scriptstate, { $hp: 80, $gold: 5, $affection: '12', $flag_met: true });
  assert.equal(typeof plan.next.scriptstate.$hp, 'number', 'values keep their type');
  assert.equal(plan.overwrites, 1, 'hp already had a different value');
  assert.deepEqual(plan.metaChanges.map(c => [c.label, c.before, c.after]), [
    ['변수 hp', '100', '80'],
    ['변수 affection', '(없음)', '12'],
    ['변수 flag_met', '(없음)', 'true'],
  ]);
  assert.equal(plan.changed, true);
  assert.deepEqual(target.scriptstate, { $hp: 100, $gold: 5 }, 'the target passed in is not mutated');
  assert.deepEqual(source.scriptstate, { $hp: 80, $affection: '12', $flag_met: true });
});

test('only the named variables are copied when the proposal lists them', () => {
  const plan = planChatImport(sourceChat(), { message: [] }, { items: ['variables'], variableKeys: ['affection', '$flag_met', 'nope'] });
  assert.deepEqual(plan.next.scriptstate, { $affection: '12', $flag_met: true });
  assert.deepEqual(plan.missingVariables, ['nope']);
});

test('importing the author note replaces the current one and counts it as an overwrite only when one existed', () => {
  const empty = planChatImport(sourceChat(), { message: [], note: '' }, { items: ['authorNote'] });
  assert.equal(empty.next.note, 'A챗 작가의 노트');
  assert.equal(empty.overwrites, 0);

  const filled = planChatImport(sourceChat(), { message: [], note: 'B챗에 이미 있던 노트' }, { items: ['authorNote'] });
  assert.equal(filled.next.note, 'A챗 작가의 노트');
  assert.equal(filled.overwrites, 1);
  assert.match(filled.before, /B챗에 이미 있던 노트/);
  assert.match(filled.after, /A챗 작가의 노트/);
});

test('importing the chat lorebook adds entries and their folders without duplicating what is already there', () => {
  const target = {
    message: [],
    localLore: [{ key: '검', comment: '성검', content: '빛나는 검', mode: 'normal' }, { key: '용', comment: '용', content: 'B챗 전용', mode: 'normal' }],
  };
  const plan = planChatImport(sourceChat(), target, { items: ['localLore'] });
  assert.deepEqual(plan.next.localLore.map(e => e.comment), ['성검', '용', '인물', '철수']);
  assert.equal(plan.next.localLore[3].folder, 'folder:aaaa', 'the entry stays inside its folder');
  assert.equal(plan.overwrites, 0);

  const again = planChatImport(sourceChat(), plan.next, { items: ['localLore'] });
  assert.equal(again.changed, false, 'importing twice adds nothing');
});

test('persona, chat modules and the first message in use carry over', () => {
  const target = { message: [], modules: ['mod-b', 'mod-z'], bindedPersona: 'persona-9' };
  const plan = planChatImport(sourceChat(), target, {
    items: ['persona', 'modules', 'greeting'],
    personas: [{ id: 'persona-1', name: '기사' }, { id: 'persona-9', name: '상인' }],
    modules: [{ id: 'mod-a', name: '상태창' }, { id: 'mod-b', name: '날씨' }, { id: 'mod-z', name: '기타' }],
  });
  assert.equal(plan.next.bindedPersona, 'persona-1');
  assert.deepEqual(plan.next.modules, ['mod-b', 'mod-z', 'mod-a']);
  assert.equal(plan.next.fmIndex, 1);
  const rows = Object.fromEntries(plan.metaChanges.map(c => [c.label, [c.before, c.after]]));
  assert.deepEqual(rows['연결 페르소나'], ['상인', '기사']);
  assert.deepEqual(rows['채팅 모듈'], ['날씨, 기타', '날씨, 기타, 상태창']);
  assert.deepEqual(rows['첫 메시지'], ['기본 첫 메시지', '추가 첫 메시지 #2']);
});

test('items the source chat does not have are reported instead of wiping the current chat', () => {
  const bare = { name: '빈 챗', message: [] };
  const target = { message: [], note: '지켜야 할 노트', scriptstate: { $hp: 1 }, bindedPersona: 'p' };
  const plan = planChatImport(bare, target, { items: [...CHAT_TRANSFER_ITEMS] });
  assert.equal(plan.changed, false);
  assert.equal(plan.next.note, '지켜야 할 노트');
  assert.deepEqual(plan.next.scriptstate, { $hp: 1 });
  assert.equal(plan.next.bindedPersona, 'p');
  assert.deepEqual(plan.skipped.map(s => s.item).sort(), [...CHAT_TRANSFER_ITEMS].sort());
});

test('a persona that no longer exists is not bound', () => {
  const plan = planChatImport(sourceChat(), { message: [] }, { items: ['persona'], personas: [{ id: 'other', name: '다른' }] });
  assert.equal(plan.next.bindedPersona, undefined);
  assert.equal(plan.skipped[0].item, 'persona');
});

test('mentioning the current chat name or number alongside a source chat still resolves the source chat', () => {
  const chats = listChats({ chats: [{ name: '1부', message: [] }, { name: '새 채팅', message: [] }] }, 1);
  assert.equal(mentionedChatIndex('1번 채팅에서 새 채팅으로 이사해줘', chats), 0);
  assert.equal(mentionedChatIndex('1부에서 새 채팅으로 이사해줘', chats), 0);

  const reversed = listChats({ chats: [{ name: 'A', message: [] }, { name: 'B', message: [] }] }, 0);
  assert.equal(mentionedChatIndex('지금 1번 채팅으로 2번 채팅 변수 옮겨줘', reversed), 1);

  // Overlapping longer current chat name still shadows the shorter non-current name
  const overlap = listChats({ chats: [{ name: '모험', message: [] }, { name: '모험 2', message: [] }] }, 1);
  assert.equal(mentionedChatIndex('모험 2에 대해 알려줘', overlap), null);
});

test('cold-stored chats are flagged in listChats and object scriptstate values format as JSON', () => {
  const cold = {
    id: 'cold-1',
    name: '오래된 1부',
    message: [{ role: 'char', data: '\uEF01COLDSTORAGE\uEF01a1b2c3d4-0000-0000-0000-000000000001' }],
    scriptstate: {},
    localLore: [],
  };
  const listed = listChats({ chats: [cold, { name: '새 채팅', message: [] }] }, 1);
  assert.equal(listed[0].coldStored, true);
  assert.equal(listed[0].messages, null);

  const objSource = {
    name: 'A',
    message: [],
    scriptstate: { inventory: { sword: 1, potion: 3 }, $hp: 80, $undef: undefined },
    localLore: [{ mode: 'folder', key: 'f1', comment: '빈 폴더', content: '' }],
    fmIndex: 5,
  };
  const ref = buildReferenceChat(objSource, { index: 0 });
  assert.deepEqual(ref.variables, [
    { name: 'inventory', value: '{"sword":1,"potion":3}' },
    { name: 'hp', value: '80' },
  ]);

  const plan = planChatImport(objSource, { message: [] }, {
    items: ['variables', 'localLore', 'greeting'],
    alternateGreetingCount: 2,
  });
  assert.equal(plan.metaChanges.find(c => c.label === '변수 inventory')?.after, '{"sword":1,"potion":3}');
  assert.deepEqual(plan.next.scriptstate.inventory, { sword: 1, potion: 3 });
  assert.ok(plan.copied.includes('채팅 로어북 폴더 1개'), 'folder-only copy must not say 0개');
  assert.equal(plan.next.fmIndex, undefined, 'out-of-range fmIndex must be skipped');
  assert.ok(plan.skipped.some(s => s.item === 'greeting'));

  const groupPlan = planChatImport({ ...objSource, fmIndex: -1 }, { message: [] }, { items: ['greeting'], isGroup: true });
  assert.equal(groupPlan.changed, false);
  assert.ok(groupPlan.skipped.some(s => s.item === 'greeting'));
});

