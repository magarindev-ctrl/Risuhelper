// Tests for v1.1.1 Saved Conversations (list / load / custom title / pin / search / export)
// and Antigravity-style long-conversation compaction (auto & manual summary).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyStore,
  createConversation,
  upsertConversation,
  renameConversation,
  togglePinConversation,
  deleteConversation,
  pruneConversationStore,
  filterAndSortConversations,
  deriveConversationTitle,
  normalizeTitle,
  serializeProposalForStorage,
  deserializeProposalFromStorage,
  formatConversationAsMarkdown,
  shouldAutoCompact,
  compactConversationMessages,
} from '../src/conversations.js';
import { buildConversationMessages } from '../src/llm.js';
import { newPresetState, assembleRisuHelperMessages } from '../src/preset-engine.js';
import { CONVERSATIONS_STORAGE_KEY } from '../src/version.js';
import { bootBundle, createMemoryStorage, proposalBlock } from './helpers/boot-bundle.mjs';

function freshCharacter() {
  return {
    chaId: 'char-v111-1',
    name: '아리아',
    desc: '원본 캐릭터 설명',
    firstMessage: '안녕하세요.',
    globalLore: [{ comment: '세계관', key: '세계관', content: '마법 세계관 설명', mode: 'normal' }],
    customscript: [],
    triggerscript: [],
    chats: [{ id: 'c1', name: '1부', note: '', message: [], localLore: [] }],
  };
}

test('deriveConversationTitle and normalizeTitle strip markdown/code and enforce length caps', () => {
  assert.equal(deriveConversationTitle([]), '새 대화');
  assert.equal(
    deriveConversationTitle([
      { role: 'assistant', content: '무시' },
      { role: 'user', content: '```lua\nlocal x = 1\n```\n**로어북** 키워드 정리해 줘' },
    ]),
    '로어북 키워드 정리해 줘'
  );
  const long = '가'.repeat(50);
  const derived = deriveConversationTitle([{ role: 'user', content: long }]);
  assert.equal(derived.length, 36);
  assert.ok(derived.endsWith('…'));
  assert.equal(normalizeTitle('   커스텀   제목   '), '커스텀 제목');
  assert.equal(normalizeTitle('   ', '기본'), '기본');
});

test('conversation store CRUD supports pin-first sorting, search across title/body/summary/char, and rename', () => {
  let store = createEmptyStore();
  const c1 = createConversation({
    id: 'c1',
    title: '로어북 번역 작업',
    customTitle: true,
    charHint: '아리아',
    messages: [{ role: 'user', content: '세계관 번역 시작' }],
    updatedAt: 1000,
  });
  const c2 = createConversation({
    id: 'c2',
    title: 'Lua 트리거 디버깅',
    customTitle: true,
    charHint: '세라',
    summary: 'onOutput 훅에서 정규식 충돌 해결',
    compactedCount: 2,
    messages: [
      { role: 'user', content: 'onOutput 오류 봐줘' },
      { role: 'assistant', content: '확인했습니다.' },
    ],
    updatedAt: 2000,
  });
  store = upsertConversation(store, c1);
  store = upsertConversation(store, c2);

  // Default order: newest updatedAt first (c2 then c1)
  assert.deepEqual(filterAndSortConversations(store).map(c => c.id), ['c2', 'c1']);

  // Pinning c1 moves it above c2 despite older timestamp
  store = togglePinConversation(store, 'c1');
  assert.deepEqual(filterAndSortConversations(store).map(c => c.id), ['c1', 'c2']);

  // Search matches title, charHint, summary, and message content
  assert.deepEqual(filterAndSortConversations(store, '정규식 충돌').map(c => c.id), ['c2']);
  assert.deepEqual(filterAndSortConversations(store, '아리아').map(c => c.id), ['c1']);

  // Rename preserves customTitle; blank rename restores derived auto-title
  store = renameConversation(store, 'c1', '최종 번역본');
  assert.equal(store.conversations.find(c => c.id === 'c1').title, '최종 번역본');
  assert.equal(store.conversations.find(c => c.id === 'c1').customTitle, true);

  store = renameConversation(store, 'c1', '   ');
  assert.equal(store.conversations.find(c => c.id === 'c1').title, '세계관 번역 시작');
  assert.equal(store.conversations.find(c => c.id === 'c1').customTitle, false);

  // Delete removes record and clears activeId when active
  store = deleteConversation(store, 'c2');
  assert.equal(store.activeId, null);
  assert.deepEqual(store.conversations.map(c => c.id), ['c1']);
});

test('pruneConversationStore evicts oldest unpinned non-active conversations while protecting pinned and active ones', () => {
  let store = createEmptyStore();
  for (let i = 1; i <= 5; i++) {
    store = upsertConversation(store, createConversation({
      id: `conv-${i}`,
      title: `대화 ${i}`,
      customTitle: true,
      pinned: i === 1,
      messages: [{ role: 'user', content: 'x'.repeat(2000) }],
      updatedAt: i * 1000,
    }));
  }
  // Active is conv-5; pinned is conv-1. Pruning to maxCount=3 must keep conv-1 (pinned), conv-5 (active), conv-4 (newest)
  const byCount = pruneConversationStore(store, 3, 10_000_000);
  assert.deepEqual(byCount.conversations.map(c => c.id).sort(), ['conv-1', 'conv-4', 'conv-5']);

  // Pruning by tight byte budget also protects active & pinned first (each conv ~4.3KB because content+rawText)
  const byBytes = pruneConversationStore(store, 10, 10000);
  const keptIds = byBytes.conversations.map(c => c.id);
  assert.ok(keptIds.includes('conv-5'), 'active conversation must be protected');
  assert.ok(keptIds.includes('conv-1'), 'pinned conversation must be protected');
  assert.ok(keptIds.length < 5, 'byte cap must evict older unpinned entries');
});

test('serializeProposalForStorage defers huge previews > 8,000 chars while keeping small previews verbatim', () => {
  const small = serializeProposalForStorage({
    cardKey: 'card-1',
    proposal: { action: 'replace_text', title: '짧은 수정', content: '새 내용' },
    preview: { ok: true, label: '캐릭터 설명', before: '이전', after: '새 내용' },
    applied: true,
    undoId: 'u-1',
  });
  assert.equal(small.preview.previewDeferred, undefined);
  assert.equal(small.preview.after, '새 내용');

  const huge = serializeProposalForStorage({
    cardKey: 'card-2',
    proposal: { action: 'replace_text', title: '대용량', content: 'B'.repeat(12000) },
    preview: { ok: true, label: '로어북', before: 'A'.repeat(12000), after: 'B'.repeat(12000) },
    applied: false,
  });
  assert.equal(huge.preview.previewDeferred, true);
  assert.equal(huge.preview.before.length, 600);
  assert.equal(huge.preview.originalBeforeChars, 12000);

  const restored = deserializeProposalFromStorage(huge);
  assert.equal(restored.proposal.content.length, 12000);
  assert.equal(restored.preview.previewDeferred, true);
});

test('formatConversationAsMarkdown includes title, metadata, rolling summary, compacted tags, and proposal states', () => {
  const md = formatConversationAsMarkdown(createConversation({
    id: 'm1',
    title: '세계관 리팩터링',
    customTitle: true,
    charHint: '아리아',
    summary: '## 대화 목표 및 배경\n- 마법 체계 통일',
    compactedCount: 1,
    messages: [
      { role: 'user', content: '마법 체계 정리해 줘' },
      {
        role: 'assistant',
        content: '정리했습니다.',
        proposals: [{ proposal: { action: 'update_lorebook', title: '마법 체계' }, applied: true }],
      },
    ],
  }));
  assert.match(md, /^# 세계관 리팩터링/);
  assert.match(md, /아리아/);
  assert.match(md, /## 누적 대화 요약/);
  assert.match(md, /_\(요약됨\)_/);
  assert.match(md, /\[적용됨\] `update_lorebook`: 마법 체계/);
});

test('shouldAutoCompact and compactConversationMessages support LLM rolling summaries and deterministic fallback', async () => {
  const shortMsgs = [
    { role: 'user', content: '안녕' },
    { role: 'assistant', content: '안녕하세요.' },
  ];
  assert.equal(shouldAutoCompact({ messages: shortMsgs, thresholdChars: 4000 }).shouldCompact, false);

  const longMsgs = Array.from({ length: 8 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `메시지 ${i + 1}: ` + '내용'.repeat(400),
  }));
  const check = shouldAutoCompact({ messages: longMsgs, compactedCount: 0, thresholdChars: 4000, keepRecent: 4 });
  assert.equal(check.shouldCompact, true);
  assert.equal(check.compactEndIndex, 4);
  assert.equal(check.toCompactCount, 4);

  // Disabled toggle prevents auto-compaction
  assert.equal(
    shouldAutoCompact({ messages: longMsgs, enabled: false, thresholdChars: 4000 }).shouldCompact,
    false
  );

  // Successful LLM compaction folds messages[0..4) into a structured summary
  let capturedMessages = null;
  const okRes = await compactConversationMessages({
    api: {},
    callModel: async (_api, promptMsgs) => {
      capturedMessages = promptMsgs;
      return '## 대화 목표 및 배경\n- 메시지 1~4 핵심 요약';
    },
    messages: longMsgs,
    compactedCount: 0,
    keepRecent: 4,
    title: '긴 테스트',
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.usedFallback, false);
  assert.equal(okRes.compactedCount, 4);
  assert.equal(okRes.newlyCompactedCount, 4);
  assert.match(okRes.summary, /메시지 1~4 핵심 요약/);
  assert.match(capturedMessages[1].content, /\[대화 제목\] 긴 테스트/);

  // Model error falls back deterministically without breaking compaction
  const fbRes = await compactConversationMessages({
    api: {},
    callModel: async () => { throw new Error('network error'); },
    messages: longMsgs,
    compactedCount: 4,
    existingSummary: okRes.summary,
    keepRecent: 2,
  });
  assert.equal(fbRes.ok, true);
  assert.equal(fbRes.usedFallback, true);
  assert.equal(fbRes.compactedCount, 6);
  assert.match(fbRes.summary, /메시지 1~4 핵심 요약/);
  assert.match(fbRes.summary, /로컬 자동 정리/);
});

test('buildConversationMessages and assembleRisuHelperMessages inject conversationSummary with 0-char overhead when absent', () => {
  const ctx = { screen: 'unknown', targetKind: 'general', freeTalk: true, labelText: '자유대화' };
  const withoutSummary = buildConversationMessages({
    context: ctx,
    snapshot: null,
    extraContext: {},
    history: [],
    userInput: '질문입니다',
  });
  assert.doesNotMatch(withoutSummary[0].content, /이전 RisuHelper 대화 누적 요약/);

  const summaryText = '## 대화 목표 및 배경\n- 주인공 이름은 카엘로 확정';
  const withSummary = buildConversationMessages({
    context: ctx,
    snapshot: null,
    extraContext: { conversationSummary: { text: summaryText, compactedCount: 6 } },
    history: [{ role: 'user', content: '최근 턴' }, { role: 'assistant', content: '최근 답변' }],
    userInput: '다음 작업 해줘',
  });
  assert.match(withSummary[0].content, /\[이전 RisuHelper 대화 누적 요약 \(앞선 6개 메시지 압축\)/);
  assert.match(withSummary[0].content, /주인공 이름은 카엘로 확정/);

  // Preset mode embeds directMessages[0] systemGuide, so conversationSummary automatically flows into Preset mode too!
  const presetState = newPresetState();
  presetState.mode = 'preset';
  presetState.preset = {
    name: '테스트 프리셋',
    promptTemplate: [
      { type: 'plain', role: 'system', text: '프리셋 시스템', enabled: true },
      { type: 'chat', enabled: true },
    ],
  };
  const presetAssembled = assembleRisuHelperMessages({
    presetState,
    directMessages: withSummary,
    history: [{ role: 'user', content: '최근 턴' }, { role: 'assistant', content: '최근 답변' }],
  });
  const combinedText = presetAssembled.messages.map(m => m.content).join('\n');
  assert.match(combinedText, /이전 RisuHelper 대화 누적 요약/);
  assert.match(combinedText, /주인공 이름은 카엘로 확정/);
});

test('UI E2E: auto-saves conversations, supports custom titles, list search/load, pin, delete, and reload restore', async () => {
  const state = { character: freshCharacter() };
  const storage = createMemoryStorage();
  const ui = await bootBundle({
    state,
    storage,
    runLLMModel: async ({ messages }) => {
      const last = messages[messages.length - 1]?.content || '';
      if (last.includes('첫 번째 대화')) return '첫 번째 대화 답변입니다.';
      if (last.includes('두 번째 대화')) return '두 번째 대화 답변입니다.';
      return '일반 응답입니다.';
    },
  });

  // 1. Send message -> auto-saved to pluginStorage
  await ui.send('첫 번째 대화에서 로어북 설계하자');
  await ui.waitFor(() => ui.bodyText().includes('첫 번째 대화 답변입니다.'), 'reply 1');
  assert.equal(ui.buttons(/^📚 대화 \(1\)$/).length, 1);

  const savedRaw = JSON.parse(storage.data[CONVERSATIONS_STORAGE_KEY]);
  assert.equal(savedRaw.conversations.length, 1);
  assert.equal(savedRaw.conversations[0].charHint, '아리아');

  // 2. Set custom title inline on .rh-conv-bar
  const titleBtn = ui.doc.querySelector('.rh-conv-title-btn');
  assert.ok(titleBtn, 'title button should exist');
  titleBtn.click();
  await ui.tick(20);
  const titleInput = ui.doc.querySelector('.rh-conv-title-input');
  assert.ok(titleInput, 'inline title input should open');
  titleInput.value = '로어북 개편 프로젝트';
  await ui.click('저장');
  assert.match(ui.doc.querySelector('.rh-conv-title-btn').textContent, /로어북 개편 프로젝트/);

  // 3. Start a new conversation (+ 새 대화) -> previous conversation remains saved
  await ui.click('+ 새 대화');
  assert.equal(ui.findAll(n => String(n.className || '').split(/\s+/).includes('rh-msg')).length, 0);
  assert.equal(ui.buttons(/^📚 대화 \(1\)$/).length, 1);

  // 4. Send message in second conversation
  await ui.send('두 번째 대화 Lua 질문');
  await ui.waitFor(() => ui.bodyText().includes('두 번째 대화 답변입니다.'), 'reply 2');
  assert.equal(ui.buttons(/^📚 대화 \(2\)$/).length, 1);

  // 5. Open saved conversations drawer, search, and load first conversation
  await ui.click(/^📚 대화 \(2\)$/);
  assert.ok(ui.doc.querySelector('.rh-conv-panel'), 'saved conversations panel should open');
  assert.equal(ui.findAll(n => String(n.className || '').split(/\s+/).includes('rh-conv-item')).length, 2);

  const searchInput = ui.doc.querySelector('.rh-conv-search');
  searchInput.value = '개편 프로젝트';
  for (const fn of searchInput.listeners.get('input') || []) fn({ target: searchInput });
  await ui.tick(10);
  const filteredItems = ui.findAll(n => String(n.className || '').split(/\s+/).includes('rh-conv-item'));
  assert.equal(filteredItems.length, 1);
  assert.match(filteredItems[0].textContent, /로어북 개편 프로젝트/);

  // Click to load first conversation
  filteredItems[0].click();
  await ui.tick(40);
  assert.equal(ui.doc.querySelector('.rh-conv-panel'), null, 'panel closes after loading conversation');
  assert.match(ui.bodyText(), /첫 번째 대화 답변입니다\./);
  assert.match(ui.doc.querySelector('.rh-conv-title-btn').textContent, /로어북 개편 프로젝트/);

  // 6. Reload plugin with same storage -> last active conversation & custom title auto-restore!
  const reloaded = await bootBundle({ state, storage, runLLMModel: async () => '재접속 응답' });
  assert.match(reloaded.bodyText(), /첫 번째 대화 답변입니다\./);
  assert.match(reloaded.doc.querySelector('.rh-conv-title-btn').textContent, /로어북 개편 프로젝트/);
  assert.equal(reloaded.buttons(/^📚 대화 \(2\)$/).length, 1);

  // 7. Pin and delete inside the saved conversations drawer
  await reloaded.click(/^📚 대화 \(2\)$/);
  const pinBtns = reloaded.findAll(n => n.tagName === 'BUTTON' && n.attributes?.['data-conv-action'] === 'pin');
  assert.equal(pinBtns.length, 2);
  pinBtns[1].click();
  await reloaded.tick(30);
  const itemsAfterPin = reloaded.findAll(n => String(n.className || '').split(/\s+/).includes('rh-conv-item'));
  assert.match(itemsAfterPin[0].textContent, /📌/, 'pinned item should move to top');

  // Delete the second item with confirmation popup
  const delBtns = reloaded.findAll(n => n.tagName === 'BUTTON' && n.attributes?.['data-conv-action'] === 'delete');
  delBtns[1].click();
  await reloaded.tick(20);
  assert.ok(reloaded.dialog(), 'deleting a saved conversation must ask for confirmation');
  await reloaded.answerDialog(true);
  assert.equal(reloaded.buttons(/^📚 대화 \(1\)$/).length, 1);

  // 8. Clicking '대화 비우기' clears current view without deleting saved conversations
  await reloaded.click('대화 비우기');
  assert.equal(reloaded.findAll(n => String(n.className || '').split(/\s+/).includes('rh-msg')).length, 0);
  assert.equal(reloaded.buttons(/^📚 대화 \(1\)$/).length, 1);
});

test('UI E2E: manual compaction renders Antigravity divider, edits/persists summary, and sends summary instead of compacted turns', async () => {
  const state = { character: freshCharacter() };
  const storage = createMemoryStorage();
  const capturedCalls = [];
  const ui = await bootBundle({
    state,
    storage,
    runLLMModel: async ({ messages }) => {
      capturedCalls.push(messages.map(m => ({ role: m.role, content: m.content })));
      if (messages[0]?.content?.includes('대화 압축(요약) 전용 어시스턴트')) {
        return '## 대화 목표 및 배경\n- 비밀 코드명 알파-9 확정\n## 진행 중 · 남은 작업\n- 로어북 최종 작성';
      }
      const last = messages[messages.length - 1]?.content || '';
      return `응답: ${last}`;
    },
  });

  await ui.send('첫 질문: 비밀 코드명은 알파-9야');
  await ui.waitFor(() => ui.bodyText().includes('응답: 첫 질문'), 'turn 1');
  assert.equal(ui.buttons('🗜️ 요약').length, 0, 'compact button stays hidden below 4 uncompacted messages');

  await ui.send('둘째 질문: 배경은 중세 마법 도시야');
  await ui.waitFor(() => ui.bodyText().includes('응답: 둘째 질문'), 'turn 2');
  assert.equal(ui.buttons('🗜️ 요약').length, 1, 'compact button appears once 4+ uncompacted messages exist');

  // Trigger manual compaction
  await ui.click('🗜️ 요약');
  await ui.waitFor(() => Boolean(ui.doc.querySelector('.rh-compaction-card')), 'compaction card');

  const card = ui.doc.querySelector('.rh-compaction-card');
  assert.match(card.textContent, /이전 대화 2건 요약됨/);
  assert.match(card.textContent, /비밀 코드명 알파-9 확정/);
  const compactedMsgs = ui.findAll(n => {
    const cls = String(n.className || '').split(/\s+/);
    return cls.includes('rh-msg') && cls.includes('compacted');
  });
  assert.equal(compactedMsgs.length, 2, 'first 2 messages should be visually marked as compacted');

  // Edit summary inline
  await ui.click('✏️ 요약 편집');
  const ta = ui.doc.querySelector('.rh-compaction-textarea');
  assert.ok(ta, 'summary edit textarea should open');
  ta.value = '## 대화 목표 및 배경\n- 사용자가 직접 다듬은 요약 (코드명 베타-7)';
  await ui.click('요약 저장');
  assert.match(ui.doc.querySelector('.rh-compaction-card').textContent, /코드명 베타-7/);

  // Next user turn must receive the edited rolling summary AND omit compacted turn 1 verbatim!
  const beforeLen = capturedCalls.length;
  await ui.send('셋째 질문: 이어서 진행해 줘');
  await ui.waitFor(() => capturedCalls.length > beforeLen, 'turn 3 call');
  const turn3Msgs = capturedCalls[capturedCalls.length - 1];
  assert.match(turn3Msgs[0].content, /이전 RisuHelper 대화 누적 요약/);
  assert.match(turn3Msgs[0].content, /코드명 베타-7/);
  const historyUserTexts = turn3Msgs.slice(1, -1).map(m => m.content).join('\n');
  assert.doesNotMatch(historyUserTexts, /비밀 코드명은 알파-9야/, 'compacted turn 1 must not be re-sent verbatim');
  assert.match(historyUserTexts, /중세 마법 도시야/, 'uncompacted recent turn 2 stays verbatim');

  // Clear summary restores normal history state
  await ui.click('✕ 요약 해제');
  assert.equal(ui.doc.querySelector('.rh-compaction-card'), null);
});

test('UI E2E: automatic compaction triggers before send when long conversation exceeds configured threshold', async () => {
  const state = { character: freshCharacter() };
  const storage = createMemoryStorage({
    risuhelper_state_v1: JSON.stringify({
      autoCompactChat: true,
      compactThresholdChars: 12000,
    }),
  });
  let compactCalls = 0;
  let lastMainCallMsgs = null;
  const ui = await bootBundle({
    state,
    storage,
    runLLMModel: async ({ messages }) => {
      if (messages[0]?.content?.includes('대화 압축(요약) 전용 어시스턴트')) {
        compactCalls++;
        return '## 대화 목표 및 배경\n- 장문 대화 자동 압축 완료 (핵심 키워드: 은빛 탑)';
      }
      lastMainCallMsgs = messages.map(m => ({ role: m.role, content: m.content }));
      return '긴 답변: ' + '가'.repeat(3200);
    },
  });

  const countMsgs = () => ui.findAll(n => String(n.className || '').split(/\s+/).includes('rh-msg')).length;

  // 3 turns = 6 messages, each ~3,200+ chars -> total > 12,000 chars before turn 4!
  await ui.send('턴1: 은빛 탑 설정 ' + '가'.repeat(1500));
  await ui.waitFor(() => countMsgs() === 2, 't1');
  await ui.send('턴2: 인물 관계 ' + '나'.repeat(1500));
  await ui.waitFor(() => countMsgs() === 4, 't2');
  await ui.send('턴3: 사건 전개 ' + '다'.repeat(1500));
  await ui.waitFor(() => countMsgs() === 6, 't3');
  assert.equal(compactCalls, 0, 'compaction waits until prior history crosses threshold');

  // Turn 4 triggers Antigravity-style automatic compaction right before assembling the main request
  await ui.send('턴4: 이제 최종 정리해 줘');
  await ui.waitFor(() => compactCalls === 1 && countMsgs() === 8, 'auto-compact + t4');

  assert.equal(compactCalls, 1, 'auto-compaction should run exactly once');
  assert.ok(ui.doc.querySelector('.rh-compaction-card'), 'compaction divider should render automatically');
  assert.match(lastMainCallMsgs[0].content, /은빛 탑/, 'main request must include auto-compacted rolling summary');
  const sentHistory = lastMainCallMsgs.slice(1, -1);
  assert.equal(sentHistory.length, 4, 'only the newest 4 uncompacted messages should be sent verbatim');
  assert.doesNotMatch(sentHistory[0].content, /턴1: 은빛 탑/, 'older compacted turn 1 must be excluded from raw history');

  // Verify Settings panel exposes autoCompactChat and compactThresholdChars controls
  await ui.click('설정');
  const thresholdSel = ui.findAll(n => n.tagName === 'SELECT' && n.attributes?.['data-setting'] === 'compactThresholdChars')[0];
  const autoCb = ui.findAll(n => n.tagName === 'INPUT' && n.attributes?.['data-setting'] === 'autoCompactChat')[0];
  assert.ok(thresholdSel, 'compactThresholdChars select should exist in settings');
  assert.ok(autoCb, 'autoCompactChat checkbox should exist in settings');
  assert.equal(thresholdSel.children.find(o => o.selected)?.value, '12000');
  assert.equal(autoCb.checked, true);
});

test('UI E2E: reloaded conversation preserves proposal cards and applied state', async () => {
  const state = { character: freshCharacter() };
  const storage = createMemoryStorage();
  const reply = '설명을 고쳤습니다.\n' + proposalBlock({
    action: 'replace_text',
    title: '설명 보강',
    content: '보강된 캐릭터 설명',
  });
  const first = await bootBundle({ state, storage, runLLMModel: async () => reply });
  await first.selectTarget('char_field:desc');
  await first.send('설명 보강해 줘');
  await first.click('적용');
  assert.equal(state.character.desc, '보강된 캐릭터 설명');
  await first.tick(250);

  const reloaded = await bootBundle({ state, storage, runLLMModel: async () => '' });
  assert.match(reloaded.bodyText(), /설명 보강/);
  assert.match(reloaded.bodyText(), /적용했습니다\./);
  assert.equal(reloaded.buttons('적용').length, 0, 'already-applied card must stay applied on reload');
  assert.equal(reloaded.buttons('되돌리기').length, 1, 'live undo record stays linked after reload');
});
