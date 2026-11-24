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

  await ui.selectByClass('rh-ref-chat', '0');
  await ui.send('여기까지 무슨 일이 있었는지 정리해줘');
  assert.match(prompts[0], /은빛-늑대/);
  assert.match(ui.bodyText(), /메시지 2개 중 2개/, 'the panel says how much of the reference chat was sent');

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
