// End-to-end flows through the built bundle's UI against a mock Plugin v3 host.

import test from 'node:test';
import assert from 'node:assert/strict';
import { bootBundle, createMemoryStorage, proposalBlock } from './helpers/boot-bundle.mjs';

function freshCharacter() {
  return {
    chaId: 'char-ui-1',
    name: '흐름테스트',
    desc: '원본 설명',
    firstMessage: '원본 첫 메시지',
    globalLore: [{ comment: '기존', key: 'k', content: '기존 본문', mode: 'normal' }],
    customscript: [],
    triggerscript: [],
    chats: [{ message: [] }],
  };
}

const threeProposals = [
  '세 가지를 바꾸겠습니다.',
  proposalBlock({ action: 'replace_text', title: '설명 교체', content: '새 설명' }),
  proposalBlock({ action: 'create_lorebook', title: '로어북 A', scope: 'character', comment: '추가 A', key: 'a', content: 'A 본문' }),
  proposalBlock({ action: 'create_lorebook', title: '로어북 B', scope: 'character', comment: '추가 B', key: 'b', content: 'B 본문' }),
].join('\n');

test('several proposals from one reply can be applied together and undone with one click', async () => {
  const state = { character: freshCharacter() };
  const ui = await bootBundle({ state, runLLMModel: async () => threeProposals });
  await ui.selectTarget('char_field:desc');
  await ui.send('세 가지 바꿔줘');

  await ui.click(/^모두 적용/);
  assert.equal(state.character.desc, '새 설명');
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', '추가 A', '추가 B']);

  assert.equal(ui.buttons(/^되돌리기 \(1\)$/).length, 1, 'the group must count as a single undo unit');
  await ui.click(/^되돌리기 \(1\)$/);
  assert.equal(state.character.desc, '원본 설명');
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존']);
});

test('undo history is still available after the plugin is reloaded', async () => {
  const state = { character: freshCharacter() };
  const storage = createMemoryStorage();
  const first = await bootBundle({ state, storage, runLLMModel: async () => threeProposals });
  await first.selectTarget('char_field:desc');
  await first.send('바꿔줘');
  await first.click('적용');
  assert.equal(state.character.desc, '새 설명');
  await first.tick(400);

  const reloaded = await bootBundle({ state, storage, runLLMModel: async () => '' });
  assert.equal(reloaded.buttons(/^되돌리기 \(1\)$/).length, 1, 'the reloaded panel must offer the stored undo');
  await reloaded.click(/^되돌리기 \(1\)$/);
  assert.equal(state.character.desc, '원본 설명');
});

test('properties the proposal schema does not know are shown on the card instead of being silently dropped', async () => {
  const state = { character: freshCharacter() };
  const reply = '만들겠습니다.\n' + proposalBlock({ action: 'create_lorebook', title: '로어북', scope: 'character', comment: '색깔 폴더', key: 'c', content: '본문', folderColor: 'red', pinned: true });
  const ui = await bootBundle({ state, runLLMModel: async () => reply });
  await ui.selectTarget('char_field:desc');
  await ui.send('만들어줘');
  const text = ui.bodyText();
  assert.match(text, /지원하지 않는 속성/);
  assert.match(text, /folderColor/);
  assert.match(text, /pinned/);
});

test('the panel says so when the original is longer than what is sent to the model', async () => {
  const state = { character: freshCharacter() };
  state.character.desc = '가'.repeat(70000);
  const ui = await bootBundle({ state, runLLMModel: async () => '' });
  await ui.selectTarget('char_field:desc');
  assert.match(ui.bodyText(), /70,000자 중 앞 60,000자만/);
});

test('streaming a reply updates the message in place without rebuilding the composer', async () => {
  const state = { character: freshCharacter() };
  const gates = [];
  const gate = () => new Promise(resolve => gates.push(resolve));
  const chunks = ['첫 조각 ', '둘째 조각 ', '셋째 조각 ', '마지막 조각'];
  const runLLMModel = async () => new ReadableStream({
    async pull(controller) {
      if (chunks.length === 0) { controller.close(); return; }
      await gate();
      controller.enqueue(chunks.shift());
    },
  });
  const ui = await bootBundle({ state, runLLMModel });
  await ui.selectTarget('char_field:desc');
  await ui.settle();
  ui.doc.querySelector('.rh-composer-input').value = '길게 답해줘';
  ui.buttons('전송')[0].click();
  await ui.waitFor(() => gates.length > 0, 'the stream to be read');
  await ui.settle();

  gates.shift()();
  await ui.waitFor(() => /첫 조각/.test(ui.bodyText()), 'the first chunk to be shown');
  const composerDuringStream = ui.doc.querySelector('.rh-composer-input');
  composerDuringStream.value = '다음 질문 미리 작성 중';

  for (const expected of [/둘째 조각/, /셋째 조각/]) {
    await ui.waitFor(() => gates.length > 0, 'the next read');
    gates.shift()();
    await ui.waitFor(() => expected.test(ui.bodyText()), `chunk ${expected}`);
  }
  assert.equal(ui.doc.querySelector('.rh-composer-input'), composerDuringStream, 'composer must not be re-created per chunk');
  assert.equal(composerDuringStream.value, '다음 질문 미리 작성 중');

  await ui.waitFor(() => gates.length > 0, 'the last read');
  gates.shift()();
  await ui.waitFor(() => /마지막 조각/.test(ui.bodyText()), 'the last chunk to be shown');
});

test('unloading immediately after apply flushes pending Undo history to pluginStorage without waiting for debounce', async () => {
  const state = { character: freshCharacter() };
  const storage = createMemoryStorage();
  const first = await bootBundle({ state, storage, runLLMModel: async () => threeProposals });
  await first.selectTarget('char_field:desc');
  await first.send('바꿔줘');
  await first.click('적용');
  assert.equal(state.character.desc, '새 설명');

  // Unload immediately (<120ms debounce window) -> destroy() MUST flush Undo state
  await first.unload();

  const reloaded = await bootBundle({ state, storage, runLLMModel: async () => '' });
  assert.equal(reloaded.buttons(/^되돌리기 \(1\)$/).length, 1);
  await reloaded.click(/^되돌리기 \(1\)$/);
  assert.equal(state.character.desc, '원본 설명');
});

test('a conflict-skipped Undo keeps the card marked applied without falsely showing 되돌림 완료 or re-enabling Apply', async () => {
  const state = { character: freshCharacter() };
  const singleReply = '바꿨습니다.\n' + proposalBlock({ action: 'replace_text', title: '설명 교체', content: '플러그인 설명' });
  const ui = await bootBundle({ state, runLLMModel: async () => singleReply });
  await ui.selectTarget('char_field:desc');
  await ui.send('바꿔줘');
  await ui.click('적용');
  assert.equal(state.character.desc, '플러그인 설명');

  // User edits desc afterwards -> Undo must refuse to overwrite and keep the card applied (not '되돌림 완료')
  state.character.desc = '사용자가 나중에 직접 고친 설명';
  await ui.click(/^되돌리기$/);

  assert.equal(state.character.desc, '사용자가 나중에 직접 고친 설명');
  assert.match(ui.bodyText(), /이후 직접 수정되어 되돌리지 않음/);
  assert.doesNotMatch(ui.bodyText(), /되돌림 완료/);
  assert.equal(ui.buttons('적용').length, 0, 'conflict-skipped card must not re-enable Apply');
  assert.equal(ui.buttons(/^되돌리기$/).length, 0, 'dead per-card Undo button must disappear');
});

test('Apply All excludes unconfirmed destructive Lua proposals until confirmed', async () => {
  const state = { character: freshCharacter() };
  state.character.triggerscript = [
    { comment: 'V1 trigger', type: 'start', conditions: [], effect: [{ type: 'setvar', var: 'x', value: '1' }] },
  ];
  const reply = [
    '두 가지 제안입니다.',
    proposalBlock({ action: 'replace_text', title: '설명 교체', content: '새 설명' }),
    proposalBlock({ action: 'update_lua', title: 'Lua 전환', scope: 'character', code: 'function onStart(id) end' }),
  ].join('\n');

  const ui = await bootBundle({ state, runLLMModel: async () => reply });
  await ui.selectTarget('char_field:desc');
  await ui.send('둘 다 바꿔줘');

  // Only 1 non-destructive proposal is ready -> '모두 적용' must not include the unconfirmed Lua card
  assert.equal(ui.buttons(/^모두 적용/).length, 0);
});
