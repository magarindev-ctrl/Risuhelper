// SPDX-License-Identifier: GPL-3.0-only
// Canonical E2E verification flows shared between simulated fork runs and Chromium/Playwright runs.

const proposalBlock = (obj) => '```risuhelper-proposal\n' + JSON.stringify(obj) + '\n```';
const toolBlock = (arr) => '```risuhelper-tool\n' + JSON.stringify(arr) + '\n```';

const E2E_SCENARIOS = [
  {
    id: 'loop-read-tool',
    title: '읽기 도구 요청 → 결과 받아 제안 (2회 호출 + 텔레메트리 + 적용/되돌리기)',
    requiresLLM: true,
    prompt: '뒷부분 유물 반영해서 소개 정리해 줘',
    scriptedReplies: [
      '전문을 확인합니다.\n' + toolBlock([{ tool: 'read_item', args: { kind: 'char_field', field: 'desc' } }]),
      '유물을 포함해 정리했습니다.\n' + proposalBlock({
        action: 'update_field',
        title: '유물 반영 정리',
        field: 'desc',
        content: '아리아는 북부 변경의 수호 기사이며 푸른 월광석을 지녔다.',
      }),
    ],
    async verify({ ui, state, assert }) {
      const body = ui.bodyText();
      assert.match(body, /호출 2\/3/);
      assert.match(body, /읽기 도구 1건/);
      await ui.click(/^적용$/);
      assert.ok(state.characters[0].desc.includes('푸른 월광석'));
      await ui.clickConfirm(/^되돌리기 \(1\)$/);
      assert.ok(state.characters[0].desc.includes('은빛 장검'));
    },
  },
  {
    id: 'loop-auto-repair',
    title: '잘못된 제안 → 자동 수정 (2회 호출 + 적용/되돌리기)',
    requiresLLM: true,
    prompt: '수호자를 기사단장으로 고쳐 줘',
    scriptedReplies: [
      proposalBlock({
        action: 'update_field',
        title: '1차 시도',
        field: 'desc',
        edits: [{ before: '북부 변경의 수호자', after: '왕도의 기사단장' }],
      }),
      '원문에 맞춰 수정했습니다.\n' + proposalBlock({
        action: 'update_field',
        title: '자동 수정안',
        field: 'desc',
        edits: [{ before: '북부 변경의 수호 기사', after: '왕도의 기사단장' }],
      }),
    ],
    async verify({ ui, state, assert }) {
      const body = ui.bodyText();
      assert.match(body, /호출 2\/3/);
      assert.match(body, /자동 수정 1회/);
      await ui.click(/^적용$/);
      assert.ok(state.characters[0].desc.includes('왕도의 기사단장'));
      await ui.clickConfirm(/^되돌리기 \(1\)$/);
      assert.ok(state.characters[0].desc.includes('북부 변경의 수호 기사'));
    },
  },
  {
    id: 'loop-hard-cap-3',
    title: '계속 도구만 요청 → 정확히 3회에서 중단 + 안내문',
    requiresLLM: true,
    prompt: '목록 계속 확인해 줘',
    scriptedReplies: [
      toolBlock([{ tool: 'list_items', args: { kind: 'lorebook', offset: 0 } }]),
      toolBlock([{ tool: 'list_items', args: { kind: 'lorebook', offset: 1 } }]),
      toolBlock([{ tool: 'list_items', args: { kind: 'lorebook', offset: 2 } }]),
      toolBlock([{ tool: 'list_items', args: { kind: 'lorebook', offset: 3 } }]),
    ],
    async verify({ ui, llmCalls, assert }) {
      assert.equal(llmCalls.length, 3, 'must stop strictly at 3 LLM calls');
      assert.match(ui.bodyText(), /최대 LLM 호출 횟수\(3회\)/);
    },
  },
  {
    id: 'borderless-other-char',
    title: '다른 캐릭터 설명 수정 ([다른 캐릭터: OtherChar] 표시 + 적용/되돌리기)',
    requiresLLM: true,
    prompt: 'OtherChar 캐릭터 설명을 수정해 줘',
    scriptedReplies: [
      proposalBlock({
        action: 'update_field',
        title: 'OtherChar 설명 수정',
        targetCharIndex: 1,
        field: 'desc',
        edits: [{ before: '다른 캐릭터의 기존 설명입니다.', after: '다른 캐릭터의 갱신된 설명입니다.' }],
      }),
    ],
    async verify({ ui, state, assert }) {
      assert.match(ui.bodyText(), /\[다른 캐릭터: OtherChar\]/);
      await ui.click(/^적용$/);
      assert.equal(state.characters[1].desc, '다른 캐릭터의 갱신된 설명입니다.');
      await ui.clickConfirm(/^되돌리기 \(1\)$/);
      assert.equal(state.characters[1].desc, '다른 캐릭터의 기존 설명입니다.');
    },
  },
  {
    id: 'borderless-other-chat-lore',
    title: '열려 있지 않은 1부 채팅에 로어북 추가 ([다른 채팅: 1부 모험] 표시 + 적용/되돌리기)',
    requiresLLM: true,
    prompt: '1부 채팅 로어북에 항목 추가해 줘',
    scriptedReplies: [
      proposalBlock({
        action: 'create_lorebook',
        title: '1부 로어',
        scope: 'chat',
        targetChatIndex: 0,
        comment: '1부 결말',
        key: '결말',
        content: '늑대와 계약했다.',
      }),
    ],
    async verify({ ui, state, assert }) {
      assert.match(ui.bodyText(), /\[다른 채팅: 1부 모험\]/);
      await ui.click(/^적용$/);
      assert.equal(state.characters[0].chats[0].localLore.length, 1);
      assert.equal(state.characters[0].chats[1].localLore.length, 0);
      await ui.clickConfirm(/^되돌리기 \(1\)$/);
      assert.equal(state.characters[0].chats[0].localLore.length, 0);
    },
  },
  {
    id: 'borderless-other-chat-vars',
    title: '열려 있지 않은 1부 채팅 변수 수정 ([다른 채팅: 1부 모험] 표시 + 적용/되돌리기)',
    requiresLLM: true,
    prompt: '1부 채팅 hp를 95로 바꿔 줘',
    scriptedReplies: [
      proposalBlock({
        action: 'update_chat_vars',
        title: '1부 HP 변경',
        targetChatIndex: 0,
        set: { hp: '95' },
      }),
    ],
    async verify({ ui, state, assert }) {
      assert.match(ui.bodyText(), /\[다른 채팅: 1부 모험\]/);
      await ui.click(/^적용$/);
      assert.equal(String(state.characters[0].chats[0].scriptstate.$hp), '95');
      await ui.clickConfirm(/^되돌리기 \(1\)$/);
      assert.equal(String(state.characters[0].chats[0].scriptstate.$hp), '80');
    },
  },
  {
    id: 'create-chat-migrate',
    title: '새 채팅 생성 + 이사 + 전환 + 되돌리기 (UUID 및 원래 채팅 복귀)',
    requiresLLM: true,
    prompt: '3부 여정 새 채팅 만들고 이사해서 전환해 줘',
    scriptedReplies: [
      proposalBlock({
        action: 'create_chat',
        title: '3부 새 채팅 이사',
        name: '3부 여정',
        importFromChatIndex: 'current',
        importItems: ['variables', 'authorNote'],
        summaryLorebook: { comment: '2부 요약', content: '새 도시 도착', alwaysActive: true },
        switchToNewChat: true,
      }),
    ],
    async verify({ ui, state, assert }) {
      await ui.click(/^적용$/);
      assert.equal(state.characters[0].chats.length, 3);
      const created = state.characters[0].chats[2];
      assert.ok(created.id, 'new chat must have UUID id');
      assert.equal(state.characters[0].chatPage, 2);
      assert.equal(created.localLore.length, 1);
      await ui.clickConfirm(/^되돌리기 \(1\)$/);
      assert.equal(state.characters[0].chats.length, 2);
      assert.equal(state.characters[0].chatPage, 1);
    },
  },
  {
    id: 'repair-no-proposal-trace',
    title: '자동 수정 후 제안 없이 종료해도 1차 거부 사유가 화면에 남아 있음',
    requiresLLM: true,
    prompt: '없는 문장 고쳐 줘',
    scriptedReplies: [
      proposalBlock({
        action: 'update_field',
        title: '실패할 1차 제안',
        field: 'desc',
        edits: [{ before: '절대 없는 문장 XYZ', after: '교체' }],
      }),
      '원문에서 해당 문구를 찾을 수 없어 제안을 취소했습니다.',
    ],
    async verify({ ui, assert }) {
      const body = ui.bodyText();
      assert.match(body, /호출 2\/3/);
      assert.match(body, /이전 제안 거부 후 재응답 1회/);
      assert.match(body, /호출 1 거부 사유/);
      assert.match(body, /실패할 1차 제안/);
    },
  },
];

export { E2E_SCENARIOS };
