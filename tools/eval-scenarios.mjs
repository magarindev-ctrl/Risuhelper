// SPDX-License-Identifier: GPL-3.0-only
// 20 representative real-world RisuHelper evaluation scenarios using the exact production
// RisuHelperApp pipeline (gatherExtraContext -> buildConversationMessages -> parseAssistantReply
// -> HostAdapter.previewProposal -> applyProposal -> undoLatest).

import { RisuHelperApp } from '../src/ui.js';
import { createMockDocument } from '../tests/helpers/mock-document.mjs';

const COLD_PREFIX = '\uEF01COLDSTORAGE\uEF01';

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
    async setItem(key, value) { data[key] = String(value); },
  };
}

function baseCharacter() {
  return {
    chaId: 'eval-char-1',
    name: '아리아',
    nickname: '아리아',
    desc: [
      '아리아는 항구 도시의 연금술사이다.',
      '은빛 단발 머리와 초록빛 눈동자를 지녔으며, 마법 탑 최상층 공방에서 물약을 제조한다.',
      '평소에는 차분하고 예의 바르지만, 고양이 네로와 있을 때만 솔직한 감정을 드러낸다.',
    ].join('\n'),
    additionalText: '',
    firstMessage: '아리아는 낡은 찻잔을 조용히 내려놓으며 당신을 바라보았다. "오랜만이네요. 공방에 무슨 일이신가요?"',
    alternateGreetings: [
      '비가 내리는 공방 창가에서 아리아가 허브를 다듬고 있었다. "젖었잖아요. 일단 수건부터 받으세요."',
    ],
    creatorNotes: '',
    systemPrompt: '',
    replaceGlobalNote: '',
    postHistoryInstructions: '',
    exampleMessage: '',
    personality: '',
    scenario: '',
    defaultVariables: 'hp=100\naffection=10',
    translatorNote: '',
    customModuleToggle: '',
    depth_prompt: { depth: 4, prompt: '' },
    backgroundHTML: '',
    virtualscript: '',
    globalLore: [
      { comment: '주인공 에린', key: '에린', secondkey: '', selective: false, alwaysActive: false, insertorder: 100, mode: 'normal', content: '주인공 에린은 왕국 변경 출신의 여행자다.' },
      { comment: '왕국 수도', key: '수도,발렌시아', secondkey: '', selective: false, alwaysActive: false, insertorder: 100, mode: 'normal', content: '왕국 수도 발렌시아 중심에는 왕립 도서관이 자리하고 있다.' },
      { comment: '아르카나 학원', key: '학원,아르카나', secondkey: '', selective: false, alwaysActive: false, insertorder: 100, mode: 'normal', content: '아르카나 학원은 대륙 최고의 마법 교육 기관이다.' },
      { comment: '은빛 단검', key: '단검', secondkey: '', selective: false, alwaysActive: false, insertorder: 100, mode: 'normal', content: '마력이 깃든 작은 호신용 단검.' },
    ],
    customscript: [],
    triggerscript: [],
    chatPage: 0,
    chats: [
      {
        id: 'eval-chat-0',
        name: '기본 채팅',
        note: '',
        fmIndex: -1,
        scriptstate: { $hp: 100, $affection: 10 },
        localLore: [],
        message: [
          { role: 'user', data: '폭풍우 때문에 늦었어. 괜찮아?' },
          { role: 'char', data: '아리아가 창밖의 번개를 바라보며 불안한 눈빛으로 소매를 움켜쥐었다. "무사해서 다행이에요... 정말 걱정했어요."' },
        ],
      },
    ],
  };
}

function baseDb() {
  return {
    temperature: 100,
    maxContext: 8000,
    maxResponse: 800,
    frequencyPenalty: 0,
    PresensePenalty: 0,
    theme: 'standard',
    textTheme: 'standard',
    lineHeight: 1.5,
    customCSS: '',
    guiHTML: '',
    colorSchemeName: 'default',
    enabledModules: ['mod-0', 'mod-1'],
    moduleIntergration: '',
    selectedPersona: 0,
    personas: [
      { id: 'persona-0', name: '기본 유저', note: '', personaPrompt: '평범한 모험가.' },
    ],
    modules: [
      {
        id: 'mod-0',
        name: '인레이 보조 모듈',
        description: '인레이 테스트용',
        lorebook: [{ comment: '인레이 1', key: 'inlay', content: 'inlay helper' }],
        regex: [],
        trigger: [],
      },
      {
        id: 'mod-1',
        name: '배경 자동 변경 모듈',
        description: '장면 배경 자동 전환',
        lorebook: [
          { comment: '배경 초기화', key: '', alwaysActive: true, insertorder: 100, mode: 'normal', content: 'init bg' },
          { comment: 'Global LoreBook Override', key: '', alwaysActive: true, insertorder: 100, mode: 'normal', content: 'Background List: forest, workshop, harbor' },
        ],
        regex: [],
        trigger: [],
      },
    ],
  };
}

const EXISTING_LUA = [
  'function onInput(triggerId)',
  '  local msg = getUserLastMessage(triggerId)',
  '  log("input: " .. tostring(msg))',
  'end',
  '',
  'function onOutput(triggerId)',
  '  local hp = tonumber(getChatVar(triggerId, "hp")) or 100',
  '  local heal = 10',
  '  hp = math.min(100, hp + heal)',
  '  setChatVar(triggerId, "hp", tostring(hp))',
  'end',
  '',
  'function onButtonClick(triggerId, code)',
  '  if code == "reset" then',
  '    setChatVar(triggerId, "hp", "100")',
  '  end',
  'end',
].join('\n');

function proposalFence(obj) {
  return '```risuhelper-proposal\n' + JSON.stringify(obj, null, 2) + '\n```';
}

/**
 * 20 representative scenarios covering Q&A guards, focused edits, truncation safety,
 * free-talk field/greeting actions, lorebook CRUD & atomic folder organization,
 * regex/Lua creation & patching, module disambiguation, persona create+bind,
 * config updates, chat migration + cold-storage guard, and chat_input ghostwriting.
 */
const EVAL_SCENARIOS = [
  // 1. Negative: pure Q&A (must NOT emit proposal)
  {
    id: 'qa-no-proposal-cbs',
    category: '안전 · 단순 질문',
    title: '로어북 insertorder vs @@depth 개념 질문 (제안 금지)',
    prompt: '로어북에서 insertorder랑 @@depth 차이가 뭐야?',
    expectMode: 'no_proposal',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'chat', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '채팅 화면' },
      };
    },
    goldenReply: 'insertorder는 로어북 항목 간의 우선순위와 프롬프트 내 상대 배치 순서를 정하는 숫자이고, @@depth N은 로어북을 채팅 히스토리 끝에서 N번째 위치에 직접 삽입하는 데코레이터입니다.',
    check({ prose, proposals }) {
      const issues = [];
      if (proposals.length !== 0) issues.push(`단순 질문인데 제안 블록 ${proposals.length}개를 출력함`);
      if (!/insertorder|우선순위/i.test(prose)) issues.push('답변에 insertorder 설명이 빠짐');
      if (!/depth|깊이|위치/i.test(prose)) issues.push('답변에 @@depth 설명이 빠짐');
      return issues;
    },
  },

  // 2. Negative: read-only config diagnosis (must NOT emit proposal)
  {
    id: 'qa-no-proposal-config',
    category: '안전 · 단순 질문',
    title: '현재 설정값 진단 요청 — "아직 고치진 마" (제안 금지)',
    prompt: '내 현재 설정값(temperature, maxResponse 등) 보고 문제 있는 부분만 설명해 줘. 아직 고치진 마.',
    expectMode: 'no_proposal',
    setup() {
      const db = baseDb();
      db.temperature = 175;
      db.maxResponse = 200;
      return {
        character: baseCharacter(),
        db,
        context: { screen: 'settings', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '설정 / 컨피그' },
      };
    },
    goldenReply: '현재 설정값을 보면 temperature가 175로 매우 높고 maxResponse가 200으로 짧게 잡혀 있습니다. 원하시면 적정 값으로 조정해 드릴 수 있습니다.',
    check({ prose, proposals }) {
      const issues = [];
      if (proposals.length !== 0) issues.push(`수정하지 말라고 했는데 제안 블록 ${proposals.length}개를 출력함`);
      if (!/175|temperature|온도/i.test(prose)) issues.push('현재 temperature(175) 진단 언급 누락');
      if (!/200|maxResponse|최대/i.test(prose)) issues.push('현재 maxResponse(200) 진단 언급 누락');
      return issues;
    },
  },

  // 3. Focused partial edit on char desc
  {
    id: 'focused-desc-patch',
    category: '포커스 · 부분 편집',
    title: '캐릭터 설명 포커스 상태에서 머리색만 부분 수정',
    prompt: "설명에서 은빛 단발 머리 부분만 '허리까지 내려오는 흑발'로 부분 수정해 줘.",
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'character', targetKind: 'char_field', fieldKey: 'desc', labelText: '캐릭터 설명 (Description)' },
      };
    },
    goldenReply: '머리 묘사 부분만 부분 수정안으로 준비했습니다.\n' + proposalFence({
      action: 'patch_text',
      title: '캐릭터 설명 머리 묘사 수정',
      edits: [{ before: '은빛 단발 머리', after: '허리까지 내려오는 흑발' }],
    }),
    check({ proposals, state }) {
      const issues = [];
      const acts = proposals.map(p => p.proposal.action);
      if (!acts.some(a => a === 'patch_text' || a === 'update_field')) {
        issues.push(`patch_text 또는 update_field 기대, 실제: ${acts.join(', ')}`);
      }
      const desc = state.character.desc;
      if (!desc.includes('허리까지 내려오는 흑발')) issues.push('수정된 문구(허리까지 내려오는 흑발)가 desc에 없음');
      if (desc.includes('은빛 단발 머리')) issues.push('기존 문구(은빛 단발 머리)가 그대로 남아 있음');
      if (!desc.includes('마법 탑 최상층') || !desc.includes('고양이 네로')) issues.push('수정 대상이 아닌 기존 설명 문장이 유실됨');
      return issues;
    },
  },

  // 4. Truncation guard: long text > maxContentChars must use partial edit, never overwrite
  {
    id: 'focused-desc-truncated-guard',
    category: '안전 · 잘림 보호',
    title: '잘린 긴 설명에서 앞 문장만 부분 수정 (전체 덮어쓰기 차단 준수)',
    prompt: "설명 맨 첫 문장 '항구 도시의 연금술사'를 '왕도의 대현자'로 고쳐 줘.",
    expectMode: 'apply',
    setup() {
      const character = baseCharacter();
      character.desc = '아리아는 항구 도시의 연금술사이다.\n' + '상세 배경 설정 문장. '.repeat(60) + '\n끝부분-보존-표식';
      return {
        character,
        db: baseDb(),
        maxContentChars: 400,
        context: { screen: 'character', targetKind: 'char_field', fieldKey: 'desc', labelText: '캐릭터 설명 (Description)' },
      };
    },
    goldenReply: '잘린 뒷부분을 보존하기 위해 첫 문장만 부분 수정합니다.\n' + proposalFence({
      action: 'patch_text',
      title: '첫 문장 칭호 수정',
      edits: [{ before: '항구 도시의 연금술사', after: '왕도의 대현자' }],
    }),
    check({ proposals, state }) {
      const issues = [];
      if (proposals.some(p => p.proposal.action === 'replace_text')) {
        issues.push('잘린 원문에 금지된 replace_text를 제안함');
      }
      if (!state.character.desc.includes('왕도의 대현자')) issues.push('새 문구(왕도의 대현자) 미반영');
      if (!state.character.desc.includes('끝부분-보존-표식')) issues.push('잘린 뒷부분 원문이 유실됨');
      return issues;
    },
  },

  // 5. Free talk: mention char field -> update_field
  {
    id: 'freetalk-field-mention',
    category: '자유대화 · 필드 수정',
    title: '자유대화에서 캐릭터 설명에 말투 규칙 추가 (update_field)',
    prompt: "캐릭터 설명에 '말끝마다 흥! 을 붙인다'는 말투 규칙 한 줄 추가해 줘.",
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'chat', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '채팅 화면' },
      };
    },
    goldenReply: '캐릭터 설명 끝에 말투 규칙을 추가했습니다.\n' + proposalFence({
      action: 'update_field',
      title: '캐릭터 설명 말투 규칙 추가',
      field: 'desc',
      edits: [{
        before: '고양이 네로와 있을 때만 솔직한 감정을 드러낸다.',
        after: '고양이 네로와 있을 때만 솔직한 감정을 드러낸다.\n말끝마다 흥! 을 붙인다.',
      }],
    }),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'update_field' && p.proposal.field === 'desc')) {
        issues.push(`update_field(field:"desc") 기대, 실제: ${proposals.map(p => `${p.proposal.action}(${p.proposal.field || ''})`).join(', ')}`);
      }
      if (!state.character.desc.includes('흥!')) issues.push('말투 규칙(흥!)이 desc에 반영되지 않음');
      if (!state.character.desc.includes('아리아')) issues.push('기존 캐릭터 설명이 덮어써져 유실됨');
      return issues;
    },
  },

  // 6. Free talk: author's note via update_field
  {
    id: 'freetalk-author-note',
    category: '자유대화 · 필드 수정',
    title: '자유대화에서 현재 채팅 작가의 노트 작성 (update_field: authorNote)',
    prompt: "작가의 노트에 '현재 비 오는 밤, 긴장감 있는 느와르 톤 유지'라고 적어 줘.",
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'chat', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '채팅 화면' },
      };
    },
    goldenReply: '현재 채팅의 작가의 노트를 작성했습니다.\n' + proposalFence({
      action: 'update_field',
      title: '작가의 노트 설정',
      field: 'authorNote',
      content: '현재 비 오는 밤, 긴장감 있는 느와르 톤 유지',
    }),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'update_field' && p.proposal.field === 'authorNote')) {
        issues.push(`update_field(field:"authorNote") 기대, 실제: ${proposals.map(p => `${p.proposal.action}(${p.proposal.field || ''})`).join(', ')}`);
      }
      const note = state.character.chats[0].note || '';
      if (!note.includes('느와르') && !note.includes('비 오는 밤')) {
        issues.push(`작가의 노트 내용 미반영: "${note}"`);
      }
      return issues;
    },
  },

  // 7. Free talk: edit default first message via update_greeting
  {
    id: 'freetalk-greeting-edit',
    category: '자유대화 · 첫 메시지',
    title: '자유대화에서 기본 첫 메시지 문구 수정 (update_greeting)',
    prompt: "기본 첫 메시지에서 '낡은 찻잔'을 '금이 간 도자기 잔'으로 바꿔 줘.",
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'chat', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '채팅 화면' },
      };
    },
    goldenReply: '기본 첫 메시지의 소품 묘사를 변경했습니다.\n' + proposalFence({
      action: 'update_greeting',
      title: '기본 첫 메시지 찻잔 묘사 수정',
      greetingIndex: -1,
      edits: [{ before: '낡은 찻잔', after: '금이 간 도자기 잔' }],
    }),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'update_greeting' && p.proposal.greetingIndex === -1)) {
        issues.push(`update_greeting(greetingIndex:-1) 기대, 실제: ${proposals.map(p => `${p.proposal.action}(${p.proposal.greetingIndex ?? ''})`).join(', ')}`);
      }
      if (!state.character.firstMessage.includes('금이 간 도자기 잔')) issues.push('firstMessage 수정 미반영');
      if (state.character.firstMessage.includes('낡은 찻잔')) issues.push('기존 문구(낡은 찻잔)가 남아 있음');
      return issues;
    },
  },

  // 8. Free talk: create new alternate greeting and activate in current chat
  {
    id: 'freetalk-greeting-create',
    category: '자유대화 · 첫 메시지',
    title: '새 추가 첫 메시지 생성 + 현재 채팅 즉시 적용 (create_greeting)',
    prompt: '비 오는 날 우산을 나눠 쓰는 상황으로 새 추가 첫 메시지를 하나 만들어서 지금 채팅에서 바로 쓰게 해 줘.',
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'chat', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '채팅 화면' },
      };
    },
    goldenReply: '새 추가 첫 메시지를 만들고 현재 채팅에 바로 적용하도록 설정했습니다.\n' + proposalFence({
      action: 'create_greeting',
      title: '비 오는 날 우산 추가 첫 메시지 생성',
      content: '빗방울이 쏟아지는 골목에서 아리아가 작은 우산을 당신 쪽으로 기울였다. "어깨 다 젖겠어요. 조금 더 가까이 오세요."',
      useInCurrentChat: true,
    }),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'create_greeting')) {
        issues.push(`create_greeting 기대, 실제: ${proposals.map(p => p.proposal.action).join(', ')}`);
      }
      if (state.character.alternateGreetings.length !== 2) {
        issues.push(`alternateGreetings 길이 2 기대, 실제: ${state.character.alternateGreetings.length}`);
      }
      if (!state.character.alternateGreetings[0].includes('허브를 다듬고')) {
        issues.push('기존 1번 추가 첫 메시지가 덮어써짐');
      }
      if (state.character.chats[0].fmIndex !== 1) {
        issues.push(`현재 채팅 fmIndex가 새 항목(1)으로 전환되지 않음 (실제: ${state.character.chats[0].fmIndex})`);
      }
      return issues;
    },
  },

  // 9. Lorebook create
  {
    id: 'lorebook-create-char',
    category: '로어북',
    title: '캐릭터 로어북 신규 생성 (create_lorebook)',
    prompt: "캐릭터 로어북에 '아르카나 길드' 항목을 새로 만들어 줘. 키워드는 '길드,아르카나'이고, 마법사들이 모여 의뢰를 받는 곳이라는 내용으로.",
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'lorebook', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '로어북' },
      };
    },
    goldenReply: '캐릭터 로어북에 아르카나 길드 항목을 추가했습니다.\n' + proposalFence({
      action: 'create_lorebook',
      title: '아르카나 길드 로어북 생성',
      scope: 'character',
      comment: '아르카나 길드',
      key: '길드,아르카나',
      secondkey: '',
      selective: false,
      alwaysActive: false,
      insertorder: 100,
      content: '아르카나 길드는 각지의 마법사들이 모여 의뢰를 받고 정보를 교류하는 공식 길드이다.',
    }),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'create_lorebook')) {
        issues.push(`create_lorebook 기대, 실제: ${proposals.map(p => p.proposal.action).join(', ')}`);
      }
      const added = state.character.globalLore[4];
      if (!added) {
        issues.push('globalLore에 새 항목이 추가되지 않음');
      } else {
        if (!/길드/.test(added.key || '') || !/아르카나/.test(added.key || '')) {
          issues.push(`키워드에 길드/아르카나 누락: "${added.key}"`);
        }
        if (!/의뢰|마법사/.test(added.content || '')) {
          issues.push(`본문에 요청 내용 누락: "${added.content}"`);
        }
      }
      return issues;
    },
  },

  // 10. Lorebook update metadata + content
  {
    id: 'lorebook-update-existing',
    category: '로어북',
    title: '포커스된 로어북의 alwaysActive + 본문 동시 수정',
    prompt: "이 로어북 항목을 항상 활성(alwaysActive)으로 바꾸고, 본문에 '밤에는 출입이 통제된다.' 한 줄 추가해 줘.",
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'lorebook', targetKind: 'char_lorebook', loreScope: 'character', loreIndex: 1, fieldKey: 'content', labelText: '캐릭터 로어북 #2' },
      };
    },
    goldenReply: '왕국 수도 로어북을 항상 활성으로 바꾸고 출입 통제 문장을 추가했습니다.\n' + proposalFence({
      action: 'update_lorebook',
      title: '왕국 수도 로어북 항상 활성 + 내용 추가',
      scope: 'character',
      loreIndex: 1,
      alwaysActive: true,
      edits: [{
        before: '왕국 수도 발렌시아 중심에는 왕립 도서관이 자리하고 있다.',
        after: '왕국 수도 발렌시아 중심에는 왕립 도서관이 자리하고 있다.\n밤에는 출입이 통제된다.',
      }],
    }),
    check({ state }) {
      const issues = [];
      const entry = state.character.globalLore[1];
      if (entry.alwaysActive !== true) issues.push(`alwaysActive가 true로 변경되지 않음 (실제: ${entry.alwaysActive})`);
      if (!entry.content.includes('밤에는 출입이 통제된다')) issues.push('추가 문구 미반영');
      if (!entry.content.includes('왕립 도서관')) issues.push('기존 본문이 유실됨');
      return issues;
    },
  },

  // 11. Atomic lorebook folder organization
  {
    id: 'lorebook-organize-folder',
    category: '로어북',
    title: '새 로어북 폴더 생성 + 2개 항목 원자적 이동 (organize_lorebook)',
    prompt: "세계관 관련 로어북 2개('왕국 수도', '아르카나 학원')를 묶어서 '세계관' 새 폴더를 만들고 한 번에 옮겨 줘.",
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'lorebook', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '로어북' },
      };
    },
    goldenReply: '세계관 폴더를 새로 만들고 해당 로어북 2개를 한 번에 이동합니다.\n' + proposalFence({
      action: 'organize_lorebook',
      title: '세계관 폴더 생성 및 로어북 2개 이동',
      scope: 'character',
      folderName: '세계관',
      createFolderIfMissing: true,
      loreIndices: [1, 2],
    }),
    check({ proposals, state }) {
      const issues = [];
      const orgProps = proposals.filter(p => p.proposal.action === 'organize_lorebook');
      if (orgProps.length !== 1 || proposals.length !== 1) {
        issues.push(`단일 organize_lorebook 1개 기대, 실제: ${proposals.map(p => p.proposal.action).join(', ')}`);
      }
      const folder = state.character.globalLore.find(e => e.mode === 'folder' && /세계관/.test(e.comment || ''));
      if (!folder) {
        issues.push("'세계관' 폴더 항목이 생성되지 않음");
      } else {
        const cap = state.character.globalLore.find(e => e.comment === '왕국 수도');
        const acad = state.character.globalLore.find(e => e.comment === '아르카나 학원');
        const erin = state.character.globalLore.find(e => e.comment === '주인공 에린');
        const dagger = state.character.globalLore.find(e => e.comment === '은빛 단검');
        if (cap?.folder !== folder.key) issues.push("'왕국 수도'가 세계관 폴더로 이동되지 않음");
        if (acad?.folder !== folder.key) issues.push("'아르카나 학원'이 세계관 폴더로 이동되지 않음");
        if (erin?.folder || dagger?.folder) issues.push('관계없는 로어북까지 폴더에 잘못 이동됨');
      }
      return issues;
    },
  },

  // 12. Regex creation (tests escaping / raw delimiter <<<IN>>>/<<<OUT>>>)
  {
    id: 'regex-create-hud',
    category: '스크립트 · 정규식/Lua',
    title: 'editdisplay 상태 배지 정규식 생성 (HTML/이스케이프 검증)',
    prompt: 'AI 출력의 [HP:숫자] 태그를 화면에만 깔끔한 붉은 배지 HTML로 보여 주는 editdisplay 정규식을 하나 만들어 줘.',
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'scripts', targetKind: 'char_regex', labelText: '캐릭터 정규식 스크립트' },
      };
    },
    goldenReply: [
      'HP 태그를 붉은 배지로 렌더링하는 editdisplay 정규식입니다.',
      '```risuhelper-proposal',
      '{"action":"upsert_regex","title":"HP 붉은 배지 정규식","scope":"character","comment":"HP 배지","type":"editdisplay","flag":"g","ableFlag":true}',
      '<<<IN>>>',
      '\\[HP:(\\d+)\\]',
      '<<<OUT>>>',
      '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#b91c1c;color:#fff;font-weight:700;">HP $1</span>',
      '<<<END>>>',
      '```',
    ].join('\n'),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'upsert_regex')) {
        issues.push(`upsert_regex 기대, 실제: ${proposals.map(p => p.proposal.action).join(', ')}`);
      }
      const rx = state.character.customscript[0];
      if (!rx) {
        issues.push('customscript에 정규식이 추가되지 않음');
      } else {
        if (rx.type !== 'editdisplay') issues.push(`type이 editdisplay가 아님: ${rx.type}`);
        if (!/<[a-z]/i.test(rx.out || '')) issues.push('out에 HTML 태그가 없음');
        try {
          const re = new RegExp(rx.in, rx.flag || 'g');
          if (!re.test('[HP:85]')) issues.push(`정규식 패턴 "${rx.in}"이 "[HP:85]"에 매칭되지 않음`);
        } catch (err) {
          issues.push(`유효하지 않은 정규식 패턴 "${rx.in}": ${err.message}`);
        }
      }
      return issues;
    },
  },

  // 13. Lua trigger creation
  {
    id: 'lua-create-trigger',
    category: '스크립트 · 정규식/Lua',
    title: 'onOutput Lua 트리거 신규 작성 (turn_count 증가)',
    prompt: 'AI 출력 후마다 채팅 변수 turn_count를 1씩 증가시키는 RisuAI Lua 트리거(onOutput)를 작성해 줘.',
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'scripts', targetKind: 'char_lua', labelText: '캐릭터 Lua 트리거 스크립트' },
      };
    },
    goldenReply: [
      'AI 출력마다 turn_count를 1씩 올리는 Lua 트리거입니다.',
      '```risuhelper-proposal',
      '{"action":"update_lua","title":"turn_count 자동 증가 onOutput 트리거","scope":"character"}',
      '<<<CODE>>>',
      'function onOutput(triggerId)',
      '  local cur = tonumber(getChatVar(triggerId, "turn_count")) or 0',
      '  setChatVar(triggerId, "turn_count", tostring(cur + 1))',
      'end',
      '<<<END>>>',
      '```',
    ].join('\n'),
    check({ proposals, state }) {
      const issues = [];
      const acts = proposals.map(p => p.proposal.action);
      if (!acts.some(a => a === 'update_lua' || a === 'replace_text')) {
        issues.push(`update_lua 또는 replace_text 기대, 실제: ${acts.join(', ')}`);
      }
      const code = state.character.triggerscript?.[0]?.effect?.[0]?.code || '';
      if (!/function\s+onOutput\s*\(/.test(code)) issues.push('function onOutput(...) 정의 누락');
      if (!code.includes('getChatVar') || !code.includes('setChatVar')) issues.push('getChatVar/setChatVar API 사용 누락');
      if (!code.includes('turn_count')) issues.push('turn_count 변수명 누락');
      return issues;
    },
  },

  // 14. Lua partial edit preserving unrelated handlers
  {
    id: 'lua-patch-existing',
    category: '스크립트 · 정규식/Lua',
    title: '기존 Lua 트리거에서 회복량 10→25만 부분 수정',
    prompt: '기존 Lua 코드에서 HP 회복량을 10에서 25로만 부분 수정해 줘.',
    expectMode: 'apply',
    setup() {
      const character = baseCharacter();
      character.triggerscript = [{ comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: EXISTING_LUA }] }];
      return {
        character,
        db: baseDb(),
        context: { screen: 'scripts', targetKind: 'char_lua', labelText: '캐릭터 Lua 트리거 스크립트' },
      };
    },
    goldenReply: '회복량 수치만 10에서 25로 부분 수정했습니다.\n' + proposalFence({
      action: 'update_lua',
      title: 'HP 회복량 10 -> 25 수정',
      scope: 'character',
      edits: [{ before: 'local heal = 10', after: 'local heal = 25' }],
    }),
    check({ state }) {
      const issues = [];
      const code = state.character.triggerscript?.[0]?.effect?.[0]?.code || '';
      if (!/heal\s*=\s*25/.test(code)) issues.push('heal = 25 반영 누락');
      if (!code.includes('function onInput') || !code.includes('function onButtonClick')) {
        issues.push('기존 onInput / onButtonClick 함수가 유실됨');
      }
      return issues;
    },
  },

  // 15. Open module expanded lorebook disambiguation in free talk
  {
    id: 'module-expanded-lore-edit',
    category: '모듈',
    title: '열린 모듈 편집창(2번 모듈 #2 항목) 자유대화 수정',
    prompt: "지금 펼쳐져 있는 모듈 로어북 항목 본문 끝에 '주의: 실내 배경은 야간 조명 적용' 한 줄 추가해 줘.",
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: {
          screen: 'module',
          targetKind: 'general',
          freeTalk: true,
          labelText: '자유대화',
          screenHint: '모듈 로어북 #2 · 본문',
          moduleDomHints: {
            tab: 'lorebook',
            openIdx: 1,
            items: [{ idx: 0, title: '배경 초기화' }, { idx: 1, title: 'Global LoreBook Override' }],
            textPreview: 'Background List: forest, workshop, harbor',
            fingerprint: 'eval-mod-1',
          },
        },
      };
    },
    goldenReply: '열려 있는 배경 자동 변경 모듈의 Global LoreBook Override 항목에 주의 문구를 추가했습니다.\n' + proposalFence({
      action: 'update_lorebook',
      title: '모듈 로어북 야간 조명 주의 추가',
      scope: 'module',
      moduleIndex: 1,
      loreIndex: 1,
      edits: [{
        before: 'Background List: forest, workshop, harbor',
        after: 'Background List: forest, workshop, harbor\n주의: 실내 배경은 야간 조명 적용',
      }],
    }),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'update_lorebook' && p.proposal.scope === 'module' && p.proposal.moduleIndex === 1 && p.proposal.loreIndex === 1)) {
        issues.push(`update_lorebook(scope:"module", moduleIndex:1, loreIndex:1) 기대, 실제: ${JSON.stringify(proposals.map(p => ({ a: p.proposal.action, s: p.proposal.scope, m: p.proposal.moduleIndex, l: p.proposal.loreIndex })))}`);
      }
      const targetContent = state.db.modules[1].lorebook[1].content;
      if (!targetContent.includes('야간 조명')) issues.push('모듈 1 로어북 1에 새 문구 미반영');
      if (state.db.modules[0].lorebook[0].content !== 'inlay helper') issues.push('다른 모듈(mod-0)이 잘못 수정됨');
      return issues;
    },
  },

  // 16. Persona create + bind to current chat
  {
    id: 'persona-create-and-bind',
    category: '페르소나',
    title: '새 페르소나 생성 및 현재 채팅 바인딩 (create_persona)',
    prompt: "'강하늘'이라는 새 페르소나를 만들고 현재 채팅에 바로 바인딩해 줘. 설명은 '차분한 대학원생 마법 연구자'.",
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'persona', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '페르소나' },
      };
    },
    goldenReply: '새 페르소나 강하늘을 생성하고 현재 채팅에 바인딩합니다.\n' + proposalFence({
      action: 'create_persona',
      title: '강하늘 페르소나 생성 및 바인딩',
      name: '강하늘',
      note: '대학원생 연구자',
      personaPrompt: '차분한 대학원생 마법 연구자.',
      bindToCurrentChat: true,
    }),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'create_persona')) {
        issues.push(`create_persona 기대, 실제: ${proposals.map(p => p.proposal.action).join(', ')}`);
      }
      const created = state.db.personas.find(p => p.name === '강하늘');
      if (!created) {
        issues.push("'강하늘' 페르소나가 db.personas에 생성되지 않음");
      } else if (state.character.chats[0].bindedPersona !== created.id) {
        issues.push(`현재 채팅에 바인딩되지 않음 (bindedPersona=${state.character.chats[0].bindedPersona}, created.id=${created.id})`);
      }
      return issues;
    },
  },

  // 17. Config update
  {
    id: 'config-update-safe',
    category: '설정 · 컨피그',
    title: '허용 설정(maxResponse, temperature) 안전 수정 (update_config)',
    prompt: '응답 최대 길이(maxResponse)를 1500으로, temperature를 80으로 바꿔 줘.',
    expectMode: 'apply',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'settings', targetKind: 'config', labelText: 'RisuAI 설정 / 컨피그 진단' },
      };
    },
    goldenReply: 'maxResponse와 temperature 설정 변경안입니다.\n' + proposalFence({
      action: 'update_config',
      title: 'maxResponse 1500, temperature 80 변경',
      changes: { maxResponse: 1500, temperature: 80 },
    }),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'update_config')) {
        issues.push(`update_config 기대, 실제: ${proposals.map(p => p.proposal.action).join(', ')}`);
      }
      if (state.db.maxResponse !== 1500) issues.push(`maxResponse 1500 기대, 실제: ${state.db.maxResponse}`);
      if (state.db.temperature !== 80) issues.push(`temperature 80 기대, 실제: ${state.db.temperature}`);
      return issues;
    },
  },

  // 18. Chat migration: copy variables + authorNote + summarize into chat lorebook
  {
    id: 'chat-migration-full',
    category: '채팅 이사',
    title: '1번 채팅 요약 로어북 생성 + 변수·작노 일괄 이사 (import_chat + create_lorebook)',
    prompt: '1번 채팅 내용을 요약해서 현재 채팅 로어북에 넣고, 1번 채팅의 변수랑 작가의 노트도 그대로 옮겨 줘.',
    expectMode: 'apply',
    setup() {
      const character = baseCharacter();
      character.chatPage = 1;
      character.chats = [
        {
          id: 'chat-a',
          name: '1부 모험',
          note: 'A챗 작가의 노트: 차분한 판타지 문체',
          fmIndex: -1,
          scriptstate: { $hp: 80, $affection: '12' },
          localLore: [],
          message: [
            { role: 'user', data: '검은 숲으로 출발하자.' },
            { role: 'char', data: '안개 낀 검은 숲에서 은빛 늑대와 조우해 동행하기로 약속했다.' },
          ],
        },
        {
          id: 'chat-b',
          name: '2부 여정',
          note: '',
          fmIndex: -1,
          localLore: [],
          message: [],
        },
      ];
      return {
        character,
        chatIndex: 1,
        db: baseDb(),
        context: { screen: 'chat', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '채팅 화면' },
      };
    },
    goldenReply: [
      '1번 채팅의 변수와 작가의 노트를 복사하고, 대화 요약을 현재 채팅 로어북에 추가합니다.',
      proposalFence({
        action: 'import_chat',
        title: '1부 모험에서 변수·작가의 노트 이사',
        sourceChatIndex: 0,
        items: ['variables', 'authorNote'],
      }),
      proposalFence({
        action: 'create_lorebook',
        title: '이전 채팅 요약',
        scope: 'chat',
        comment: '이전 채팅 요약',
        key: '',
        alwaysActive: true,
        insertorder: 100,
        content: '검은 숲에서 은빛 늑대와 조우하여 동행하기로 약속했다.',
      }),
    ].join('\n'),
    check({ proposals, state }) {
      const issues = [];
      if (!proposals.some(p => p.proposal.action === 'import_chat' && p.proposal.sourceChatIndex === 0)) {
        issues.push('import_chat(sourceChatIndex:0) 제안 누락');
      }
      if (!proposals.some(p => p.proposal.action === 'create_lorebook' && p.proposal.scope === 'chat')) {
        issues.push('요약용 create_lorebook(scope:"chat") 제안 누락');
      }
      const b = state.character.chats[1];
      if (b.scriptstate?.$hp !== 80) issues.push(`변수 $hp=80 미복사 (실제: ${JSON.stringify(b.scriptstate)})`);
      if (b.note !== 'A챗 작가의 노트: 차분한 판타지 문체') issues.push(`작가의 노트 미복사 (실제: "${b.note}")`);
      const sumLore = b.localLore?.[0];
      if (!sumLore || !/늑대|숲/.test(sumLore.content || '')) {
        issues.push(`채팅 로어북 요약 미생성 또는 내용 부정확: ${JSON.stringify(sumLore)}`);
      }
      if (state.character.chats[0].localLore.length !== 0) issues.push('원본 1번 채팅이 잘못 수정됨');
      return issues;
    },
  },

  // 19. Safety guard: cold-stored source chat
  {
    id: 'chat-migration-cold-guard',
    category: '안전 · 콜드 스토리지',
    title: '콜드 스토리지 보관 채팅 이사 요청 시 복원 안내 (잘못된 제안 방지)',
    prompt: '1번 채팅에서 변수랑 작가의 노트 옮겨 줘.',
    expectMode: 'no_proposal',
    setup() {
      const character = baseCharacter();
      character.chatPage = 1;
      character.chats = [
        {
          id: 'chat-cold',
          name: '옛 모험',
          note: '',
          localLore: [],
          message: [{ role: 'char', data: `${COLD_PREFIX}11111111-2222-3333-4444-555555555555` }],
        },
        {
          id: 'chat-now',
          name: '새 여정',
          note: '',
          localLore: [],
          message: [],
        },
      ];
      return {
        character,
        chatIndex: 1,
        db: baseDb(),
        context: { screen: 'chat', targetKind: 'general', freeTalk: true, labelText: '자유대화', screenHint: '채팅 화면' },
      };
    },
    goldenReply: '1번 채팅("옛 모험")은 현재 RisuAI 콜드 스토리지에 보관 중이라 플러그인에서 읽을 수 없습니다. RisuAI에서 1번 채팅을 한 번 열어 복원한 뒤, 다시 현재 채팅으로 돌아와 요청해 주세요.',
    check({ prose, proposals }) {
      const issues = [];
      if (proposals.length > 0) {
        const allBlocked = proposals.every(p => !p.preview?.ok);
        issues.push(`coldStored:true 채팅에 제안 블록 ${proposals.length}개 출력함 (어댑터 차단 여부: ${allBlocked})`);
      }
      if (!/콜드|스토리지|열어|복원/i.test(prose)) {
        issues.push('콜드 스토리지 보관 중 / RisuAI에서 열어야 한다는 안내 누락');
      }
      return issues;
    },
  },

  // 20. Chat input ghostwriting (2 user reply choices)
  {
    id: 'chat-input-ghostwrite',
    category: '채팅 입력창 · 유저 대필',
    title: '채팅 입력창에서 부드러운 유저 대사 2가지 선택지 대필',
    prompt: '지금 상황에 맞게 캐릭터를 안심시키는 부드러운 유저 대사 2가지 선택지를 제안해 줘.',
    expectMode: 'apply_first',
    setup() {
      return {
        character: baseCharacter(),
        db: baseDb(),
        context: { screen: 'chat', targetKind: 'chat_input', labelText: '채팅 입력창 (유저 대필)' },
      };
    },
    goldenReply: [
      '아리아를 안심시키는 두 가지 선택지입니다.',
      proposalFence({
        action: 'replace_text',
        title: '선택지 1 (다정하게 미소 지으며)',
        content: '젖은 외투를 털어내며 부드럽게 미소 지었다. "걱정 끼쳐서 미안해, 아리아. 비만 좀 맞았을 뿐 다친 데는 하나도 없어."',
      }),
      proposalFence({
        action: 'replace_text',
        title: '선택지 2 (따뜻한 차를 권하며)',
        content: '떨고 있는 아리아의 손을 살짝 감싸 쥐었다. "이제 무사히 돌아왔잖아. 내가 따뜻한 차 끓여 줄 테니까 잠깐 앉아서 쉬자."',
      }),
    ].join('\n'),
    check({ proposals, state }) {
      const issues = [];
      const replaceProps = proposals.filter(p => p.proposal.action === 'replace_text');
      if (replaceProps.length !== 2) {
        issues.push(`replace_text 선택지 2개 기대, 실제: ${replaceProps.length}개 (${proposals.map(p => p.proposal.action).join(', ')})`);
      }
      for (const [i, item] of replaceProps.entries()) {
        if (String(item.proposal.content || '').trim().length < 10) {
          issues.push(`선택지 #${i + 1} 본문이 너무 짧음`);
        }
      }
      const msgs = state.character.chats[0].message;
      const last = msgs[msgs.length - 1];
      if (msgs.length !== 3 || last?.role !== 'user') {
        issues.push(`채팅에 유저 메시지 추가 실패 (길이=${msgs.length}, 마지막 role=${last?.role})`);
      }
      return issues;
    },
  },
];

function createScenarioHost(setupRes, callModelFn) {
  const state = {
    character: structuredClone(setupRes.character),
    db: structuredClone(setupRes.db),
    chatIndex: Number.isInteger(setupRes.chatIndex) ? setupRes.chatIndex : (setupRes.character.chatPage || 0),
  };
  const storage = createMemoryStorage();
  const capturedRequests = [];

  const api = {
    pluginStorage: storage,
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async getCharacter() { return structuredClone(state.character); },
    async setCharacter(c) { state.character = structuredClone(c); },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return state.chatIndex; },
    async getChatFromIndex(_charIdx, chatIdx) {
      const chat = state.character.chats?.[chatIdx];
      return chat ? structuredClone(chat) : null;
    },
    async setChatToIndex(_charIdx, chatIdx, chat) {
      if (state.character.chats?.[chatIdx]) {
        state.character.chats[chatIdx] = structuredClone(chat);
      }
    },
    async getDatabase(includeOnly = 'all') {
      if (includeOnly === 'all') return structuredClone(state.db);
      const out = {};
      for (const k of includeOnly) {
        if (Object.hasOwn(state.db, k)) out[k] = structuredClone(state.db[k]);
      }
      return out;
    },
    async setDatabase(next) {
      for (const [k, v] of Object.entries(next || {})) {
        if (k === 'plugins') continue;
        state.db[k] = structuredClone(v);
      }
    },
    async setDatabaseLite(next) {
      for (const [k, v] of Object.entries(next || {})) {
        if (k === 'plugins') continue;
        state.db[k] = structuredClone(v);
      }
    },
    async runLLMModel({ messages }) {
      capturedRequests.push(messages);
      return await callModelFn(messages);
    },
  };

  return { state, storage, api, capturedRequests };
}

/**
 * Runs a single scenario through the real RisuHelperApp pipeline and grades the result.
 * @param {object} scenario
 * @param {object} opts
 * @param {Function} [opts.callModel] async (messages, scenario) => { text, usage? } | string
 * @param {boolean} [opts.dryRun]
 * @param {boolean} [opts.useGolden]
 */
async function runEvalScenario(scenario, { callModel = null, dryRun = false, useGolden = false } = {}) {
  const setupRes = scenario.setup();
  let modelUsage = null;
  let rawReply = '';
  let latencyMs = 0;

  const invokeModel = async (messages) => {
    if (dryRun) {
      rawReply = '';
      return '(dry-run)';
    }
    if (useGolden) {
      rawReply = scenario.goldenReply;
      return rawReply;
    }
    if (typeof callModel !== 'function') {
      throw new Error('callModel function is required unless dryRun or useGolden is true');
    }
    const t0 = Date.now();
    const res = await callModel(messages, scenario);
    latencyMs = Date.now() - t0;
    if (typeof res === 'string') {
      rawReply = res;
      return rawReply;
    }
    rawReply = String(res?.text ?? '');
    modelUsage = res?.usage || null;
    return rawReply;
  };

  const { state, api, capturedRequests } = createScenarioHost(setupRes, invokeModel);
  const initialSnapshot = structuredClone({ character: state.character, db: state.db });
  const app = new RisuHelperApp(api, createMockDocument());
  if (setupRes.maxContentChars) {
    app.settings.maxContentChars = setupRes.maxContentChars;
    app.adapter.maxContentChars = setupRes.maxContentChars;
  }
  app.detectedContext = structuredClone(setupRes.context);
  app.manualTarget = null;
  await app.refreshContextSnapshot({ forceChatList: true });

  const result = {
    id: scenario.id,
    category: scenario.category,
    title: scenario.title,
    expectMode: scenario.expectMode,
    ok: false,
    failureCategory: null,
    issues: [],
    promptChars: 0,
    systemChars: 0,
    latencyMs: 0,
    usage: null,
    proposalActions: [],
    parseErrors: [],
    unknownKeys: [],
    rawReplyExcerpt: '',
  };

  try {
    await app.sendMessage(scenario.prompt);
    const sentMessages = capturedRequests[0] || [];
    result.systemChars = String(sentMessages[0]?.content || '').length;
    result.promptChars = sentMessages.reduce((sum, m) => sum + String(m?.content || '').length, 0);
    result.latencyMs = latencyMs;
    result.usage = modelUsage;

    if (dryRun) {
      result.ok = true;
      return result;
    }

    const assistantMsg = app.messages[app.messages.length - 1];
    result.rawReplyExcerpt = String(rawReply || '').slice(0, 500);

    if (assistantMsg?.error) {
      result.failureCategory = 'modelError';
      result.issues.push(`모델 호출 오류: ${assistantMsg.error}`);
      return result;
    }

    result.parseErrors = assistantMsg.parseErrors || [];
    result.proposalActions = (assistantMsg.proposals || []).map(p => p.proposal?.action || '(unknown)');
    result.unknownKeys = (assistantMsg.proposals || []).flatMap(p => p.unknownKeys || []);

    if (result.parseErrors.length > 0) {
      result.failureCategory = 'parseError';
      for (const e of result.parseErrors) {
        result.issues.push(`제안 블록 파싱 실패: ${e.error}`);
      }
    }
    if (result.unknownKeys.length > 0) {
      result.failureCategory ||= 'unknownKeys';
      result.issues.push(`스키마에 없는 알 수 없는 속성 사용: ${result.unknownKeys.join(', ')}`);
    }

    const proposals = assistantMsg.proposals || [];

    if (scenario.expectMode === 'apply' || scenario.expectMode === 'apply_first') {
      if (proposals.length === 0) {
        result.failureCategory ||= 'missingProposal';
        result.issues.push('수정/생성 제안 블록을 출력하지 않음');
      } else {
        const failedPreviews = proposals.filter(p => !p.preview?.ok);
        if (failedPreviews.length > 0) {
          result.failureCategory ||= 'previewFailed';
          for (const fp of failedPreviews) {
            result.issues.push(`미리보기 실패(${fp.proposal?.action}): ${fp.preview?.reason || 'unknown'}`);
          }
        } else {
          const toApply = scenario.expectMode === 'apply_first' ? [proposals[0]] : proposals;
          for (const item of toApply) {
            if (item.preview?.requiresConfirm) item.destructiveConfirmed = true;
            await app.applyProposalItem(item);
            if (!item.applied) {
              result.failureCategory ||= 'applyFailed';
              result.issues.push(`적용 실패(${item.proposal?.action}): ${item.statusMessage}`);
            }
          }
        }
      }
    }

    // Run scenario-specific semantic checks
    if (result.issues.length === 0 || scenario.expectMode === 'no_proposal') {
      const semanticIssues = scenario.check({
        prose: assistantMsg.content || '',
        rawReply,
        proposals,
        state,
        initialSnapshot,
      }) || [];
      if (semanticIssues.length > 0) {
        result.failureCategory ||= (scenario.expectMode === 'no_proposal' && proposals.length > 0)
          ? 'overEagerEdit'
          : 'semanticFailed';
        result.issues.push(...semanticIssues);
      }
    }

    // Verify surgical undo round-trip restores initial state cleanly with 0 conflicts
    if (result.issues.length === 0 && (scenario.expectMode === 'apply' || scenario.expectMode === 'apply_first')) {
      let guard = 0;
      while (app.adapter.undoUnitCount() > 0 && guard++ < 10) {
        const undoRes = await app.adapter.undo();
        if (undoRes?.conflicts?.length) {
          result.failureCategory ||= 'undoFailed';
          result.issues.push(`Undo 충돌 발생: ${undoRes.conflicts.join('; ')}`);
        }
      }
      if (JSON.stringify(state.character) !== JSON.stringify(initialSnapshot.character) ||
          JSON.stringify(state.db) !== JSON.stringify(initialSnapshot.db)) {
        result.failureCategory ||= 'undoFailed';
        result.issues.push('Undo 후 상태가 초기 스냅샷과 일치하지 않음');
      }
    }

    result.ok = result.issues.length === 0;
    return result;
  } finally {
    await app.destroy();
  }
}

export { EVAL_SCENARIOS, runEvalScenario };
