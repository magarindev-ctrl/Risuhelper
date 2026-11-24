// Moving from one chat to another of the same character, end to end through the built bundle.

import test from 'node:test';
import assert from 'node:assert/strict';
import { bootBundle, proposalBlock } from './helpers/boot-bundle.mjs';

function twoChatState() {
  return {
    chatIndex: 1,
    character: {
      chaId: 'char-move-1',
      name: '이사테스트',
      desc: '설명',
      firstMessage: '첫 메시지',
      alternateGreetings: [],
      globalLore: [],
      customscript: [],
      triggerscript: [],
      chatPage: 1,
      chats: [
        {
          id: 'chat-a',
          name: '1부 모험',
          note: 'A챗 작가의 노트',
          message: [
            { role: 'user', data: '숲으로 가자' },
            { role: 'char', data: '숲에서 은빛-늑대를 만났다' },
          ],
          scriptstate: { $hp: 80, $affection: '12' },
          localLore: [],
        },
        { id: 'chat-b', name: '2부', note: '', message: [], localLore: [] },
      ],
    },
  };
}

const importReply = [
  '1번 채팅에서 변수와 작가의 노트를 옮기고, 요약을 채팅 로어북에 넣겠습니다.',
  proposalBlock({ action: 'import_chat', title: '1부에서 이사', sourceChatIndex: 0, items: ['variables', 'authorNote'] }),
  proposalBlock({ action: 'create_lorebook', title: '이전 채팅 요약', scope: 'chat', comment: '이전 채팅 요약', key: '', alwaysActive: true, content: '숲에서 은빛 늑대를 만났다.' }),
].join('\n');

test('naming another chat sends its conversation to the model, and the move applies to the open chat and can be undone', async () => {
  const state = twoChatState();
  const prompts = [];
  const ui = await bootBundle({ state, runLLMModel: async ({ messages }) => { prompts.push(messages[0].content); return importReply; } });

  await ui.send('1번 채팅을 요약해서 여기로 이사해줘. 변수랑 작노도 옮겨줘');
  assert.match(prompts[0], /"chatIndex": 0/);
  assert.match(prompts[0], /은빛-늑대/, 'the named chat\'s conversation reaches the model');
  assert.match(prompts[0], /hp = 80/);
  assert.match(ui.bodyText(), /1번 채팅 "1부 모험" → 현재 채팅 "2부"/);
  assert.match(ui.bodyText(), /변수 hp/);

  await ui.click(/^모두 적용 \(2\)$/);
  const b = state.character.chats[1];
  assert.deepEqual(b.scriptstate, { $hp: 80, $affection: '12' });
  assert.equal(b.note, 'A챗 작가의 노트');
  assert.deepEqual(b.localLore.map(e => e.comment), ['이전 채팅 요약']);
  assert.equal(state.character.chats[0].note, 'A챗 작가의 노트');
  assert.deepEqual(state.character.chats[0].localLore, [], 'nothing is written to the source chat');

  await ui.clickConfirm(/^되돌리기 \(1\)$/);
  assert.equal(state.character.chats[1].note, '');
  assert.equal(state.character.chats[1].scriptstate, undefined);
  assert.deepEqual(state.character.chats[1].localLore, []);
});

test('a request that names no other chat does not ship another chat\'s conversation', async () => {
  const state = twoChatState();
  const prompts = [];
  const ui = await bootBundle({ state, runLLMModel: async ({ messages }) => { prompts.push(messages[0].content); return '네.'; } });
  await ui.send('로어북이 뭔지 알려줘');
  assert.match(prompts[0], /"chatIndex": 0/, 'the short chat list is always there so a chat can be named');
  assert.doesNotMatch(prompts[0], /은빛-늑대/);
  assert.doesNotMatch(prompts[0], /hp = 80/);
});

test('the reference chat picker keeps a chat attached to every request until it is cleared', async () => {
  const state = twoChatState();
  const prompts = [];
  const ui = await bootBundle({ state, runLLMModel: async ({ messages }) => { prompts.push(messages[0].content); return '네.'; } });

  await ui.click('☰');
  await ui.selectByClass('rh-ref-chat', '0');
  await ui.send('여기까지 무슨 일이 있었는지 정리해줘');
  assert.match(prompts[0], /은빛-늑대/);
  assert.match(ui.bodyText(), /메시지 2개 중 2개/, 'the menu panel says how much of the reference chat was sent');

  // Closing the menu still shows the slim 1-line reference bar with a quick detach button
  await ui.click('☰');
  assert.match(ui.bodyText(), /참조 채팅: 1번 · 1부 모험 \(메시지 2\/2개\)/);

  await ui.click('☰');
  await ui.selectByClass('rh-ref-chat', '');
  await ui.send('고마워');
  assert.doesNotMatch(prompts[1], /은빛-늑대/);
});

test('a chat named in the request stays selected as the reference for follow-up requests', async () => {
  const state = twoChatState();
  const prompts = [];
  const ui = await bootBundle({ state, runLLMModel: async ({ messages }) => { prompts.push(messages[0].content); return '네.'; } });
  await ui.send('1번 채팅 내용 알려줘');
  await ui.send('그럼 그걸 세 줄로 줄여줘');
  assert.match(prompts[1], /은빛-늑대/, 'the follow-up still carries the reference chat');
  assert.match(ui.bodyText(), /참조 채팅: 1번 · 1부 모험/, 'slim reference bar shows attached chat even while menu is closed');
  await ui.click('☰');
  const picker = ui.findAll(n => n.tagName === 'SELECT' && /rh-ref-chat/.test(n.className || ''))[0];
  assert.ok(picker.children.some(o => o.selected && o.value === '0'), 'the picker shows which chat is attached');
});

test('a character with a single chat shows no reference picker and no chat list', async () => {
  const state = twoChatState();
  state.character.chats = [state.character.chats[0]];
  state.chatIndex = 0;
  state.character.chatPage = 0;
  const prompts = [];
  const ui = await bootBundle({ state, runLLMModel: async ({ messages }) => { prompts.push(messages[0].content); return '네.'; } });
  await ui.send('안녕');
  await ui.click('☰');
  assert.equal(ui.findAll(n => n.tagName === 'SELECT' && /rh-ref-chat/.test(n.className || '')).length, 0);
  assert.doesNotMatch(prompts[0], /"chatIndex"/);
});

test('importing over values the open chat already has needs the confirmation checkbox on the card', async () => {
  const state = twoChatState();
  state.character.chats[1].note = 'B챗에서 쓰던 노트';
  const reply = proposalBlock({ action: 'import_chat', title: '노트 이사', sourceChatIndex: 0, items: ['authorNote'] });
  const ui = await bootBundle({ state, runLLMModel: async () => reply });
  await ui.send('1번 채팅 작노 가져와');

  const applyBtn = ui.buttons('적용')[0];
  assert.equal(applyBtn.disabled, true, 'Apply stays disabled until the overwrite is acknowledged');
  assert.match(ui.bodyText(), /기존 값 1개를 덮어쓰는 것을 확인했습니다/);
  assert.equal(state.character.chats[1].note, 'B챗에서 쓰던 노트');
});

test('a cold-stored source chat is clearly labeled and rejected until opened in RisuAI', async () => {
  const state = twoChatState();
  state.character.chats[0].message = [{ role: 'char', data: '\uEF01COLDSTORAGE\uEF01a1b2c3d4-0000-0000-0000-000000000001' }];
  const reply = proposalBlock({ action: 'import_chat', title: '콜드 이사', sourceChatIndex: 0, items: ['variables'] });
  const ui = await bootBundle({ state, runLLMModel: async () => reply });

  await ui.click('☰');
  const picker = ui.findAll(n => n.tagName === 'SELECT' && /rh-ref-chat/.test(n.className || ''))[0];
  assert.ok(picker.children.some(o => /콜드 스토리지 보관 중/.test(o.textContent)));

  await ui.send('1번 채팅에서 변수 옮겨줘');
  assert.match(ui.bodyText(), /콜드 스토리지/);
  assert.equal(ui.buttons('적용').length, 0, 'cold-stored import must not be applicable');
});

test('switching chats and reopening the panel immediately refreshes the reference chat picker', async () => {
  const state = twoChatState();
  state.chatIndex = 0;
  state.character.chatPage = 0;
  const ui = await bootBundle({ state, runLLMModel: async () => '네.' });

  const pickerOptions = () => {
    const picker = ui.findAll(n => n.tagName === 'SELECT' && /rh-ref-chat/.test(n.className || ''))[0];
    return picker ? picker.children.map(o => o.textContent) : [];
  };
  await ui.click('☰');
  assert.ok(pickerOptions().some(t => t.includes('2부')), 'on Chat A, Chat B is selectable');
  assert.ok(!pickerOptions().some(t => t.includes('1부 모험')), 'on Chat A, Chat A is hidden');

  // Switch from Chat A to Chat B and reopen immediately (< 2s)
  state.chatIndex = 1;
  state.character.chatPage = 1;
  await ui.reopen();
  await ui.click('☰');
  assert.ok(pickerOptions().some(t => t.includes('1부 모험')), 'after switching to Chat B, Chat A is immediately selectable');
  assert.ok(!pickerOptions().some(t => t.includes('2부')), 'after switching to Chat B, Chat B is no longer listed as reference');
});

test('chat_input target sends active conversation context and lets the user add (undoable) or send a ghostwritten reply', async () => {
  const state = twoChatState();
  state.chatIndex = 0;
  state.character.chatPage = 0;
  const prompts = [];
  const sentViaHost = [];
  const twoChoicesReply = [
    '두 가지 대필안을 준비했습니다.',
    proposalBlock({ action: 'replace_text', title: '선택지 1 (부드럽게)', content: '조심스럽게 늑대에게 손을 내민다. "괜찮아, 해치지 않을게."' }),
    proposalBlock({ action: 'replace_text', title: '선택지 2 (경계하며)', content: '검자루에 손을 올린 채 한 발 물러선다. "거기 멈춰."' }),
  ].join('\n');

  const ui = await bootBundle({
    state,
    runLLMModel: async ({ messages }) => { prompts.push(messages[0].content); return twoChoicesReply; },
    sendChat: async (msg) => { sentViaHost.push(msg); return true; },
  });

  await ui.selectTarget('chat_input:');
  await ui.send('다음 대사 대필해줘');
  assert.match(prompts[0], /은빛-늑대/, 'active chat transcript reaches the model');
  assert.match(prompts[0], /유저 대필/);
  assert.equal(ui.buttons(/^모두 적용/).length, 0, 'Apply All is hidden for alternative chat_input draft choices');
  assert.equal(ui.buttons(/^💬 채팅에 추가$/).length, 2);
  assert.equal(ui.buttons(/^🚀 바로 전송$/).length, 2);

  // Add choice 1 as an undoable user message
  await ui.click(/^💬 채팅에 추가$/, 0);
  assert.equal(state.character.chats[0].message.length, 3);
  assert.equal(state.character.chats[0].message[2].role, 'user');
  assert.match(state.character.chats[0].message[2].data, /손을 내민다/);

  // Undo reverts the added user message cleanly
  await ui.clickConfirm(/^되돌리기$/, 0);
  assert.equal(state.character.chats[0].message.length, 2);

  // Direct send via sendChat asks confirmation first: cancel sends nothing, confirm sends once
  await ui.click(/^🚀 바로 전송$/, 1);
  assert.ok(ui.dialog(), 'direct send asks for confirmation');
  await ui.answerDialog(false);
  assert.deepEqual(sentViaHost, []);

  await ui.clickConfirm(/^🚀 바로 전송$/, 1);
  assert.deepEqual(sentViaHost, ['검자루에 손을 올린 채 한 발 물러선다. "거기 멈춰."']);
});

