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
  await ui.clickConfirm(/^되돌리기 \(1\)$/);
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
  await reloaded.clickConfirm(/^되돌리기 \(1\)$/);
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
  await reloaded.clickConfirm(/^되돌리기 \(1\)$/);
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
  await ui.clickConfirm(/^되돌리기$/);

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

test('from the chat screen the model gets the whole first message and its greeting proposals apply directly', async () => {
  const state = { character: freshCharacter() };
  state.character.firstMessage = '첫 문장. ' + '가'.repeat(900) + ' 끝-표식';
  state.character.alternateGreetings = ['기존 추가 인사'];
  const seenSystemPrompts = [];
  const replies = [
    '고칩니다.\n' + proposalBlock({ action: 'update_greeting', title: '첫 메시지 수정', greetingIndex: -1, edits: [{ before: '끝-표식', after: '끝!' }] }),
    '추가합니다.\n' + proposalBlock({ action: 'create_greeting', title: '새 추가 첫 메시지', content: '새로 만든 인사' }),
  ];
  const ui = await bootBundle({
    state,
    runLLMModel: async ({ messages }) => { seenSystemPrompts.push(messages[0].content); return replies.shift(); },
  });

  await ui.send('첫 메시지 끝부분 고쳐줘');
  assert.ok(seenSystemPrompts[0].includes('끝-표식'), 'the full first message must reach the model on the chat screen');
  await ui.click('적용');
  assert.ok(state.character.firstMessage.endsWith('끝!'));

  await ui.send('추가 첫 메시지 하나 새로 만들어줘');
  await ui.click('적용');
  assert.deepEqual(state.character.alternateGreetings, ['기존 추가 인사', '새로 만든 인사']);
});

test('choosing the alternate-greeting target selects no item until the user picks one', async () => {
  const state = { character: freshCharacter() };
  state.character.alternateGreetings = ['기존 1번', '기존 2번'];
  const reply = '새로 씁니다.\n' + proposalBlock({ action: 'replace_text', title: '새 추가 첫 메시지', content: '덮어쓰면 안 되는 내용' });
  const ui = await bootBundle({ state, runLLMModel: async () => reply });
  await ui.selectTarget('char_alt_greeting:');

  const itemPicker = ui.findAll(n => n.tagName === 'SELECT').find(sel => sel.children.some(o => /추가 첫 메시지 #1/.test(o.textContent)));
  assert.ok(itemPicker, 'the greeting item picker must be shown');
  const selected = itemPicker.children.find(o => o.selected);
  assert.ok(selected && !/#1/.test(selected.textContent), 'greeting #1 must not appear pre-selected');

  await ui.send('추가 첫 메시지를 새로 만들어줘');
  assert.equal(ui.buttons('적용').length, 0, 'an overwrite without a chosen item must not be applicable');
  assert.deepEqual(state.character.alternateGreetings, ['기존 1번', '기존 2번']);
});

test('with no alternate greetings yet, a plain overwrite from that target is applied as the first greeting', async () => {
  const state = { character: freshCharacter() };
  state.character.alternateGreetings = [];
  const reply = '준비했습니다.\n' + proposalBlock({ action: 'replace_text', title: '추가 첫 메시지: 새 상황', content: '빈 칸을 채운 인사' });
  const ui = await bootBundle({ state, runLLMModel: async () => reply });
  await ui.selectTarget('char_alt_greeting:');
  await ui.send('추가 첫 메시지 만들어줘');
  await ui.click('적용');
  assert.deepEqual(state.character.alternateGreetings, ['빈 칸을 채운 인사']);
});

test('the new-greeting card offers to use it in the current chat right away', async () => {
  const state = { character: freshCharacter() };
  state.character.alternateGreetings = ['기존'];
  state.character.chats[0].fmIndex = -1;
  const reply = '추가합니다.\n' + proposalBlock({ action: 'create_greeting', title: '새 인사', content: '새로 만든 인사' });
  const ui = await bootBundle({ state, runLLMModel: async () => reply });
  await ui.send('추가 첫 메시지 만들어줘');

  const label = ui.findAll(n => n.tagName === 'LABEL' && /현재 채팅에서 바로 사용/.test(n.textContent))[0];
  assert.ok(label, 'the card must offer the option');
  const checkbox = label.children.find(c => c.tagName === 'INPUT');
  checkbox.checked = true;
  for (const fn of checkbox.listeners.get('change') || []) await fn({ target: checkbox });

  await ui.click('적용');
  assert.deepEqual(state.character.alternateGreetings, ['기존', '새로 만든 인사']);
  assert.equal(state.character.chats[0].fmIndex, 1);
});

test('free talk: asking about the description sends its full text and the edit applies without choosing a target', async () => {
  const state = { character: freshCharacter() };
  state.character.desc = '첫 줄. ' + '나'.repeat(800) + ' 설명-끝표식';
  const prompts = [];
  const reply = '고칩니다.\n' + proposalBlock({ action: 'update_field', title: '설명 수정', field: 'desc', edits: [{ before: '설명-끝표식', after: '설명 끝!' }] });
  const ui = await bootBundle({ state, runLLMModel: async ({ messages }) => { prompts.push(messages[0].content); return reply; } });

  assert.match(ui.bodyText(), /자유대화/, 'with nothing selected the panel says free talk');
  await ui.send('캐릭터 설명 끝부분을 고쳐줘');
  assert.ok(prompts[0].includes('설명-끝표식'), 'the mentioned field must reach the model in full');
  await ui.click('적용');
  assert.ok(state.character.desc.endsWith('설명 끝!'));
});

test('free talk: an unrelated request does not ship the long description to the model', async () => {
  const state = { character: freshCharacter() };
  state.character.desc = '첫 줄. ' + '나'.repeat(800) + ' 설명-끝표식';
  const prompts = [];
  const ui = await bootBundle({ state, runLLMModel: async ({ messages }) => { prompts.push(messages[0].content); return '네.'; } });
  await ui.send('로어북이 뭔지 알려줘');
  assert.ok(!prompts[0].includes('설명-끝표식'));
  assert.ok(prompts[0].includes('첫 줄.'), 'a short preview is still included');
});

test('focused char_field allows update_field whole-text overwrite even without repeating the field name', async () => {
  const state = { character: freshCharacter() };
  state.character.desc = '긴 원문. ' + '다'.repeat(1200) + ' 끝';
  const reply = '다시 썼습니다.\n' + proposalBlock({ action: 'update_field', title: '설명 전체 다듬기', field: 'desc', content: '새로 쓴 설명' });
  const ui = await bootBundle({ state, runLLMModel: async () => reply });
  await ui.selectTarget('char_field:desc');
  await ui.send('전체 말투를 시니컬하게 다시 써줘');
  await ui.click('적용');
  assert.equal(state.character.desc, '새로 쓴 설명');
});

test('free talk: mentioned field still ships and applies when includeCharSummary is unchecked', async () => {
  const state = { character: freshCharacter() };
  state.character.desc = '원본 설명. ' + '라'.repeat(800) + ' 끝표식';
  const prompts = [];
  const reply = '고쳤습니다.\n' + proposalBlock({ action: 'update_field', title: '설명 전체 수정', field: 'desc', content: '완전히 새로운 설명' });
  const ui = await bootBundle({ state, runLLMModel: async ({ messages }) => { prompts.push(messages[0].content); return reply; } });

  const summaryLabel = ui.findAll(n => n.tagName === 'LABEL' && /캐릭터 요약 참고/.test(n.textContent))[0];
  const cb = summaryLabel.children.find(c => c.tagName === 'INPUT');
  cb.checked = false;
  for (const fn of cb.listeners.get('change') || []) await fn({ target: cb });

  await ui.send('캐릭터 설명 전체 다시 써줘');
  assert.ok(prompts[0].includes('끝표식'), 'mentioned field full text must still be sent');
  await ui.click('적용');
  assert.equal(state.character.desc, '완전히 새로운 설명');
});

test('manual general target sets freeTalk banner, _focusSignature tracks screenHint, and module regex/Lua free-talk hints & DOM sync stay accurate', async () => {
  const { RisuHelperApp } = await import('../src/ui.js');
  const { createMockDocument } = await import('./helpers/mock-document.mjs');

  const writtenToDom = [];
  const db = {
    modules: [{
      id: 'mod-1',
      name: 'HUD 모듈',
      lorebook: [],
      regex: [{ comment: 'BG', in: '<bg>', out: '<div class="bg">ok</div>', type: 'editdisplay', flag: 'g', ableFlag: false }],
      trigger: [{ comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: 'function onOutput(id) return 42 end' }] }],
    }],
  };
  let chatReads = 0;
  const api = {
    async getDatabase() { return db; },
    async getCharacter() { return freshCharacter(); },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getChatFromIndex() { chatReads++; return { message: [], note: '채팅 노트', fmIndex: -1 }; },
  };
  const app = new RisuHelperApp(api, createMockDocument());
  app.tracker.enabled = true;
  app.tracker.syncModuleEditorDom = async (opts) => { writtenToDom.push(opts.text); return { ok: true, message: 'filled' }; };

  // 1. Manual general target sets freeTalk: true and labelText: '자유대화'
  await app.onSelectTarget('general:');
  assert.equal(app.manualTarget.freeTalk, true);
  assert.equal(app.manualTarget.labelText, '자유대화');
  assert.match(app.doc.body.textContent, /입력칸을 선택하지 않은 상태/);

  // 2. _focusSignature distinguishes screenHint changes within the same screen
  const sigA = app._focusSignature({ screen: 'settings', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '설정 / 컨피그 (채팅 봇)' });
  const sigB = app._focusSignature({ screen: 'settings', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '설정 / 컨피그 (디스플레이)' });
  assert.notEqual(sigA, sigB);

  // 3. Module regex DOM mismatch compares entry.out (not JSON) and refill writes entry.out
  app.manualTarget = null;
  app.detectedContext = {
    screen: 'module', targetKind: 'general', freeTalk: true, labelText: '자유대화',
    moduleDomHints: { tab: 'regex', openIdx: 0, items: [{ idx: 0, title: 'BG' }], textPreview: '<div class="bg">ok</div>', fingerprint: 'r1' },
  };
  await app.refreshContextSnapshot();
  assert.equal(app._hasModuleDomMismatch(), false, 'identical regex out must not trigger false mismatch');

  db.modules[0].regex[0].out = '<div class="bg">updated</div>';
  await app.refreshContextSnapshot();
  assert.equal(app._hasModuleDomMismatch(), true, 'real regex out drift must be detected');
  const syncSnap = app._moduleSyncSnapshot();
  await app.syncOpenModuleEditor(syncSnap.target, app._moduleSyncText(syncSnap), { moduleId: syncSnap.hostBinding?.moduleId });
  assert.deepEqual(writtenToDom, ['<div class="bg">updated</div>'], 'refill must write entry.out, never raw JSON');

  // 4. Module regex & Lua free-talk hints reach the model even with includeLoreSummary = false, and readActiveChat runs at most once
  app.settings.includeLoreSummary = false;
  chatReads = 0;
  const extraRegex = await app.gatherExtraContext(app.getEffectiveContext(), '정규식 봐줘');
  assert.equal(chatReads, 1, 'readActiveChat should not be called twice in one gatherExtraContext');
  assert.equal(extraRegex.openModule?.expandedRegexIndex, 0);
  assert.equal(extraRegex.openModule?.expandedRegex?.out, '<div class="bg">updated</div>');
  assert.equal(extraRegex.openModule?.regexList?.length, 1);

  app.detectedContext = {
    screen: 'module', targetKind: 'general', freeTalk: true, labelText: '자유대화',
    moduleDomHints: { tab: 'trigger', openIdx: null, items: [], textPreview: 'function onOutput(id)', fingerprint: 'l1' },
  };
  await app.refreshContextSnapshot();
  const extraLua = await app.gatherExtraContext(app.getEffectiveContext(), 'Lua 디버깅해줘');
  assert.match(extraLua.openModule?.luaCode || '', /return 42/);
});

test('committing changes clears undo buttons immediately, keeps applied data, and persists cleared state across reload', async () => {
  const state = { character: freshCharacter() };
  const storage = createMemoryStorage();
  const reply = [
    proposalBlock({ action: 'create_lorebook', title: '항목 A', scope: 'character', comment: 'A', key: 'a', content: 'body A' }),
    proposalBlock({ action: 'create_lorebook', title: '항목 B', scope: 'character', comment: 'B', key: 'b', content: 'body B' }),
  ].join('\n');

  const ui = await bootBundle({ state, storage, runLLMModel: async () => reply });
  await ui.send('로어북 두 개 추가해줘');
  await ui.click(/^모두 적용 \(2\)$/);
  await ui.tick(200); // let debounced save persist the applied undo records first

  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A', 'B']);
  assert.equal(JSON.parse(storage.data.risuhelper_undo_v1).records.length, 2);
  assert.equal(ui.buttons(/^되돌리기 \(1\)$/).length, 1);
  assert.equal(ui.buttons(/^✓ 변경 확정$/).length, 1);
  assert.equal(ui.buttons(/^✓ 묶음 확정$/).length, 1);
  assert.equal(ui.buttons(/^✓ 확정$/).length, 2);

  // Commit all via the header button
  await ui.clickConfirm(/^✓ 변경 확정$/);

  // All undo & commit controls vanish; applied data and committed status remain; Apply does NOT come back
  assert.equal(ui.buttons(/^되돌리기/).length, 0);
  assert.equal(ui.buttons(/^묶음 되돌리기$/).length, 0);
  assert.equal(ui.buttons(/^✓ 변경 확정$/).length, 0);
  assert.equal(ui.buttons(/^✓ 묶음 확정$/).length, 0);
  assert.equal(ui.buttons(/^✓ 확정$/).length, 0);
  assert.equal(ui.buttons(/^적용$/).length, 0);
  assert.match(ui.bodyText(), /확정됨/);
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A', 'B']);
  assert.equal(JSON.parse(storage.data.risuhelper_undo_v1).records.length, 0, 'cleared state flushed to pluginStorage immediately');

  // Reloading immediately without waiting for debounce still has zero undo entries
  const reloaded = await bootBundle({ state, storage, runLLMModel: async () => '' });
  assert.equal(reloaded.buttons(/^되돌리기/).length, 0);
  assert.equal(reloaded.buttons(/^✓ 변경 확정$/).length, 0);
});

test('committing a single card or a group locks only the chosen records while leaving other undoable changes intact', async () => {
  const state = { character: freshCharacter() };
  let turn = 0;
  const replies = [
    proposalBlock({ action: 'update_field', title: '설명 수정', field: 'desc', content: '확정 안 한 설명' }),
    [
      proposalBlock({ action: 'create_lorebook', title: '항목 A', scope: 'character', comment: 'A', key: 'a', content: 'body A' }),
      proposalBlock({ action: 'create_lorebook', title: '항목 B', scope: 'character', comment: 'B', key: 'b', content: 'body B' }),
    ].join('\n'),
  ];

  const ui = await bootBundle({ state, runLLMModel: async () => replies[turn++] || '' });

  // Turn 1: standalone desc edit (kept uncommitted)
  await ui.send('설명 수정해줘');
  await ui.click(/^적용$/);
  assert.equal(state.character.desc, '확정 안 한 설명');
  assert.equal(ui.buttons(/^되돌리기 \(1\)$/).length, 1);

  // Turn 2: 2-item group apply
  await ui.send('로어북 두 개 추가해줘');
  await ui.click(/^모두 적용 \(2\)$/);
  assert.equal(ui.buttons(/^되돌리기 \(2\)$/).length, 1);
  assert.equal(ui.buttons(/^✓ 확정$/).length, 3);

  // Commit only card A (index 1, after the standalone desc card at index 0)
  await ui.clickConfirm(/^✓ 확정$/, 1);
  assert.equal(ui.buttons(/^✓ 확정$/).length, 2, 'desc card and card B remain uncommitted');
  assert.equal(ui.buttons(/^묶음 되돌리기$/).length, 1, 'group undo still covers uncommitted card B');

  // Undo the remaining group -> reverts B while leaving committed A and standalone desc intact
  await ui.clickConfirm(/^묶음 되돌리기$/);
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A']);
  assert.equal(state.character.desc, '확정 안 한 설명');
  assert.equal(ui.buttons(/^묶음 되돌리기$/).length, 0);
  assert.equal(ui.buttons(/^✓ 묶음 확정$/).length, 0);
  assert.equal(ui.buttons(/^되돌리기 \(1\)$/).length, 1, 'standalone desc edit is still undoable');

  // Re-send a 2-item group and commit ONLY the group via ✓ 묶음 확정
  turn = 1;
  await ui.send('로어북 다시 추가해줘');
  await ui.click(/^모두 적용 \(2\)$/);
  assert.equal(ui.buttons(/^되돌리기 \(2\)$/).length, 1);
  await ui.clickConfirm(/^✓ 묶음 확정$/);
  assert.equal(ui.buttons(/^✓ 묶음 확정$/).length, 0);
  assert.equal(ui.buttons(/^묶음 되돌리기$/).length, 0);
  assert.equal(ui.buttons(/^되돌리기 \(1\)$/).length, 1, 'group commit leaves standalone desc edit undoable');
});

// --- Confirmation popups: a single stray click must neither roll back nor finalise anything ---

const twoLoreReply = [
  proposalBlock({ action: 'create_lorebook', title: '항목 A', scope: 'character', comment: 'A', key: 'a', content: 'body A' }),
  proposalBlock({ action: 'create_lorebook', title: '항목 B', scope: 'character', comment: 'B', key: 'b', content: 'body B' }),
].join('\n');

async function bootWithAppliedGroup(extra = {}) {
  const state = { character: freshCharacter() };
  const storage = createMemoryStorage();
  const ui = await bootBundle({ state, storage, runLLMModel: async () => twoLoreReply, ...extra });
  await ui.send('로어북 두 개 추가해줘');
  await ui.click(/^모두 적용 \(2\)$/);
  await ui.tick(200);
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A', 'B']);
  return { state, storage, ui };
}

const undoRecordCount = (storage) => JSON.parse(storage.data.risuhelper_undo_v1).records.length;

test('the header undo button asks first: nothing is rolled back until the popup is confirmed', async () => {
  const { state, ui } = await bootWithAppliedGroup();
  assert.equal(ui.dialog(), null);

  await ui.click(/^되돌리기 \(1\)$/);
  assert.ok(ui.dialog(), 'a confirmation popup must open');
  assert.match(ui.dialog().textContent, /되돌/);
  assert.match(ui.dialog().textContent, /2건/, 'the popup must say what is about to be undone');
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A', 'B'], 'no rollback before confirming');

  await ui.answerDialog(false);
  assert.equal(ui.dialog(), null, 'cancel closes the popup');
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A', 'B'], 'cancel must not roll back');
  assert.equal(ui.buttons(/^되돌리기 \(1\)$/).length, 1, 'the change stays undoable after cancelling');

  await ui.click(/^되돌리기 \(1\)$/);
  await ui.answerDialog(true);
  assert.equal(ui.dialog(), null);
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존']);
});

test('card and group undo buttons ask first and name what they undo', async () => {
  const { state, ui } = await bootWithAppliedGroup();

  await ui.click(/^되돌리기$/, 1);
  assert.match(ui.dialog().textContent, /항목 B/, 'the popup names the card being undone');
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A', 'B']);
  await ui.answerDialog(false);
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A', 'B']);

  await ui.click(/^되돌리기$/, 1);
  await ui.answerDialog(true);
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A']);

  await ui.click(/^묶음 되돌리기$/);
  assert.ok(ui.dialog(), 'group undo must ask too');
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A']);
  await ui.answerDialog(true);
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존']);
});

test('commit buttons ask first: undo history is only erased after the popup is confirmed', async () => {
  const { state, storage, ui } = await bootWithAppliedGroup();
  assert.equal(undoRecordCount(storage), 2);

  // Header: commit everything
  await ui.click(/^✓ 변경 확정$/);
  assert.ok(ui.dialog(), 'a confirmation popup must open');
  assert.match(ui.dialog().textContent, /되돌릴 수 없/, 'the popup must warn that this cannot be undone');
  await ui.answerDialog(false);
  await ui.tick(200);
  assert.equal(undoRecordCount(storage), 2, 'cancel keeps the undo history');
  assert.equal(ui.buttons(/^되돌리기 \(1\)$/).length, 1);
  assert.doesNotMatch(ui.bodyText(), /확정됨/);

  // Card: commit one
  await ui.click(/^✓ 확정$/, 0);
  assert.match(ui.dialog().textContent, /항목 A/, 'the popup names the card being committed');
  await ui.answerDialog(false);
  assert.equal(ui.buttons(/^✓ 확정$/).length, 2, 'cancel keeps the card uncommitted');
  await ui.click(/^✓ 확정$/, 0);
  await ui.answerDialog(true);
  assert.equal(ui.buttons(/^✓ 확정$/).length, 1);

  // Group: commit the rest
  await ui.click(/^✓ 묶음 확정$/);
  assert.ok(ui.dialog(), 'group commit must ask too');
  assert.equal(ui.buttons(/^✓ 확정$/).length, 1);
  await ui.answerDialog(true);
  await ui.tick(200);
  assert.equal(ui.buttons(/^✓ 확정$/).length, 0);
  assert.equal(ui.buttons(/^되돌리기/).length, 0);
  assert.equal(undoRecordCount(storage), 0);
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A', 'B'], 'committing never touches the data');
});

test('the confirmation popup survives panel re-renders and clicking outside it cancels', async () => {
  const { state, ui } = await bootWithAppliedGroup();

  await ui.click(/^되돌리기 \(1\)$/);
  assert.ok(ui.dialog());
  await ui.tick(3000); // the "applied" toast expires and re-renders the panel meanwhile
  assert.ok(ui.dialog(), 'a re-render must not drop the popup');

  const backdrop = ui.findAll(n => String(n.className || '').split(/\s+/).includes('rh-modal-backdrop'))[0];
  backdrop.click();
  await ui.tick(40);
  assert.equal(ui.dialog(), null, 'clicking outside the popup cancels');
  assert.deepEqual(state.character.globalLore.map(e => e.comment), ['기존', 'A', 'B']);
  assert.equal(ui.buttons(/^되돌리기 \(1\)$/).length, 1);
});
