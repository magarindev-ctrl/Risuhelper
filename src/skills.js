// SPDX-License-Identifier: GPL-3.0-only
// Deterministic internal skill router for RisuHelper.
// Selects only the RisuAI knowledge, rules, and proposal action schemas relevant to the
// current cursor/screen, user request keywords, and attached context — zero extra LLM calls.

import { KNOWLEDGE_SECTIONS } from './knowledge.js';

const SKILL_KEYWORDS = {
  char_fields: /설명|디스크립션|desc|시스템\s*프롬프트|글로벌\s*노트|깊이\s*프롬프트|작가(?:의)?\s*노트|작노|author\s*note|성격|시나리오|예시\s*대화|백그라운드|번역가|제작자|닉네임|기본\s*변수|커스텀\s*토글/i,
  greetings: /첫\s*메시지|추가\s*첫|인사말|오프닝|greeting|alternate\s*greeting|first\s*message/i,
  lorebook: /로어북|lorebook|lore\b|폴더|folder|세계관|요약|이사|insertorder|@@depth/i,
  scripts: /lua|루아|트리거|trigger|정규식|regex|customscript|상태창|hud|배지|editdisplay|editoutput|editinput|editprocess|cbs|\{\{|스크립트|script|꾸며|표시\s*형식|치환|턴\s*수|응답마다|출력마다|html|css/i,
  persona: /페르소나|persona|바인딩|bindedPersona|유저\s*(?:설정|프로필|정보|소개|캐릭터)|(?:내|플레이어|주인공)\s*(?:캐릭터\s*)?프로필/i,
  config: /설정|컨피그|config|temperature|온도|maxResponse|maxContext|페널티|penalty|customCSS|guiHTML|테마|theme|모듈\s*활성|enabledModules/i,
  chat_migration: /이사|옮겨|가져와|이관|참조\s*채팅|\d+\s*번\s*채팅|채팅\s*#?\d+|이전\s*채팅|다른\s*채팅|콜드\s*스토리지|새\s*채팅|신규\s*채팅|채팅\s*(?:생성|만들|추가)|create_chat/i,
  chat_vars: /변수|scriptstate|호감도|affection|\bhp\b|\bmp\b|스탯|상태값|플래그|카운터|\bvar\b|getvar|setvar|초기화/i,
  module_create: /모듈\s*(?:하나|통째|통으로|신규|새로|생성|만들|추가|제작|짜)|새\s*모듈|신규\s*모듈|create_module/i,
  char_settings: /로어북\s*(?:설정|예산|토큰|깊이)|토큰\s*예산|tokenBudget|스캔\s*깊이|scanDepth|재귀\s*스캔|recursiveScanning|전체\s*단어|fullWordMatching|바이어스|로짓|bias|태그|tags/i,
  char_create_port: /새\s*캐릭터|신규\s*캐릭터|캐릭터\s*(?:카드\s*)?(?:생성|만들|추가|제작|포팅)|다른\s*캐릭터|교차\s*포팅|포팅|create_character|port_from_character/i,
};

const SKILL_DEFS = [
  {
    id: 'core_text',
    label: '현재 칸 편집',
    actions: ['patch_text', 'replace_text'],
    knowledge: [],
    rules: [
      '기존 긴 원문의 일부만 바꿀 때는 반드시 `patch_text`를 사용하고, `before`에는 위 [현재 대상의 실제 원문]에서 **공백과 줄바꿈까지 정확히 일치하는 고유 구간**을 복사하세요.',
      '주의: `patch_text`/`replace_text`에서 `target`을 임의로 바꿔 다른 필드를 지정하지 마세요.',
    ],
    schemas: [
      '- 부분 편집: {"action":"patch_text","title":"설명","edits":[{"before":"원문 구간","after":"수정 구간"}]}',
      '- 전체 덮어쓰기: {"action":"replace_text","title":"설명","content":"새 전체 텍스트"}',
    ],
    rawDelimiters: true,
  },
  {
    id: 'chat_input',
    label: '유저 대필',
    actions: ['replace_text'],
    knowledge: ['cbs'],
    rules: [
      '현재 대상이 `chat_input`(채팅 입력창 · 유저 대필)일 때 대필·문장 다듬기 요청에는 `replace_text`의 `content`에 바로 전송할 유저 대사/서술 본문만 담아 제안하세요(불필요한 해설·인사말을 `content` 안에 넣지 마세요).',
    ],
    schemas: [
      '- 유저 대필 제안: {"action":"replace_text","title":"선택지 설명","content":"바로 전송할 유저 대사/행동 본문"}',
    ],
    rawDelimiters: true,
  },
  {
    id: 'char_fields',
    label: '캐릭터 필드 · 작노',
    actions: ['update_field'],
    knowledge: ['character', 'cbs'],
    rules: [
      '캐릭터 설명·시스템 프롬프트 등 캐릭터 필드나 작가의 노트를 고칠 때, 그 필드가 현재 대상이 아니면 `update_field`를 사용하세요. 그 필드가 현재 대상이면 `patch_text` / `replace_text`도 됩니다.',
    ],
    schemas: [
      '- 캐릭터 필드·작가의 노트 수정: {"action":"update_field","title":"설명","field":"desc","edits":[{"before":"...","after":"..."}]} (field는 [캐릭터 필드 목록]의 값. 작가의 노트는 "authorNote". 전체 교체는 edits 대신 "content":"새 전체 텍스트")',
    ],
    rawDelimiters: true,
  },
  {
    id: 'greetings',
    label: '첫 메시지',
    actions: ['update_greeting', 'create_greeting', 'delete_greeting'],
    knowledge: ['character', 'cbs'],
    rules: [
      '첫 메시지(기본·추가)를 고치거나 새로 추가하거나 삭제할 때는 현재 대상이 무엇이든 `update_greeting` / `create_greeting` / `delete_greeting`을 사용하세요. "추가 첫 메시지를 새로 만들어 달라"는 요청에 기존 항목을 `replace_text`로 덮어쓰지 마세요.',
    ],
    schemas: [
      '- 첫 메시지 수정: {"action":"update_greeting","title":"설명","greetingIndex":-1,"edits":[{"before":"...","after":"..."}]} (greetingIndex -1 = 기본 첫 메시지, 0 이상 = 추가 첫 메시지 번호. 전체 교체는 edits 대신 "content":"새 전체 텍스트")',
      '- 추가 첫 메시지 새로 만들기: {"action":"create_greeting","title":"설명","content":"새 추가 첫 메시지 전체 텍스트","useInCurrentChat":false} (기존 항목은 바뀌지 않고 맨 뒤에 추가됨. 사용자가 지금 채팅에서 바로 쓰길 원하면 useInCurrentChat을 true로)',
      '- 추가 첫 메시지 삭제: {"action":"delete_greeting","title":"설명","greetingIndex":0} (0 이상 추가 첫 메시지만 삭제 가능, 기본 첫 메시지 -1은 삭제 불가)',
    ],
    rawDelimiters: true,
  },
  {
    id: 'lorebook',
    label: '로어북',
    actions: ['create_lorebook', 'update_lorebook', 'organize_lorebook', 'delete_lorebook'],
    knowledge: ['lorebook', 'cbs'],
    rules: [
      '로어북 폴더를 새로 만들어 로어북을 옮기거나 기존 폴더에 여러 로어북을 담을 때는 절대 `update_lorebook`을 여러 개로 쪼개거나 `\\uf000folder:...` 키를 임의로 지어내지 말고, 반드시 **단일 `organize_lorebook` 블록 하나**로 제안하세요.',
    ],
    schemas: [
      '- 새 로어북 생성: {"action":"create_lorebook","title":"설명","scope":"character|chat|module","comment":"항목명","key":"키1,키2","secondkey":"","selective":false,"alwaysActive":false,"insertorder":100,"content":"본문"}',
      '- 기존 로어북 수정: {"action":"update_lorebook","title":"설명","scope":"character|chat|module","loreIndex":0,"comment":"항목명","key":"키1,키2","edits":[{"before":"...","after":"..."}]}',
      '- 로어북 폴더 정리(생성+일괄 이동): {"action":"organize_lorebook","title":"설명","scope":"character|chat|module","folderName":"폴더명","createFolderIfMissing":true,"loreIndices":[0,1,2]} (기존 폴더는 folderName 또는 folderIndex 지정, 최상위 복귀는 "moveToRoot":true)',
      '- 로어북 삭제: {"action":"delete_lorebook","title":"설명","scope":"character|chat|module","loreIndex":0}',
    ],
    rawDelimiters: true,
  },
  {
    id: 'scripts',
    label: 'Lua · 정규식',
    actions: ['update_lua', 'upsert_regex', 'delete_regex'],
    knowledge: ['lua', 'regex', 'cbs'],
    rules: [],
    schemas: [
      '- Lua 트리거 수정/생성: {"action":"update_lua","title":"설명","scope":"character|module","edits":[{"before":"...","after":"..."}]} (신규이거나 전체 교체면 "code":"..." 사용)',
      '- 정규식 생성/수정: {"action":"upsert_regex","title":"설명","scope":"character|module","comment":"이름","in":"패턴","out":"치환","type":"editdisplay|editoutput|editinput|editprocess","flag":"g","ableFlag":true}',
      '- 정규식 삭제: {"action":"delete_regex","title":"설명","scope":"character|module","regexIndex":0}',
    ],
    rawDelimiters: true,
  },
  {
    id: 'module_create',
    label: '모듈 신규 생성',
    actions: ['create_module'],
    knowledge: ['module_create', 'lua', 'regex', 'lorebook', 'cbs'],
    rules: [
      '사용자가 새 모듈(정규식+Lua+토글+임베딩+로어북 패키지)을 통째로 만들어 달라고 하면 반드시 단일 `create_module` 제안으로 구성하고, "지금 채팅에 바로 켜줘"라고 하면 `enableInCurrentChat: true`, "전역으로 켜줘"라고 하면 `enableGlobally: true`를 설정하세요.',
    ],
    schemas: [
      '- 새 모듈 통째로 생성: {"action":"create_module","title":"설명","name":"모듈명","description":"설명","namespace":"slug","customModuleToggle":"key=라벨=select=켜기,끄기","backgroundEmbedding":"<style>...</style>","luaCode":"function onOutput(id)...end","regex":[{"comment":"이름","in":"패턴","out":"치환","type":"editdisplay","flag":"g","ableFlag":true}],"lorebook":[{"comment":"규칙","key":"","alwaysActive":true,"insertorder":100,"content":"본문"}],"lowLevelAccess":false,"hideIcon":false,"enableInCurrentChat":true,"enableGlobally":false}',
    ],
    rawDelimiters: true,
  },
  {
    id: 'persona',
    label: '페르소나',
    actions: ['create_persona', 'update_persona', 'delete_persona'],
    knowledge: ['persona', 'cbs'],
    rules: [],
    schemas: [
      '- 새 페르소나 생성: {"action":"create_persona","title":"설명","name":"이름","note":"메모","personaPrompt":"설명","bindToCurrentChat":true}',
      '- 기존 페르소나 수정: {"action":"update_persona","title":"설명","personaIndex":0,"name":"이름","note":"메모","personaPrompt":"설명","bindToCurrentChat":false}',
      '- 페르소나 삭제: {"action":"delete_persona","title":"설명","personaIndex":0} (마지막 1개는 삭제 불가)',
    ],
    rawDelimiters: true,
  },
  {
    id: 'config',
    label: '설정 · 컨피그',
    actions: ['update_config'],
    knowledge: ['config'],
    rules: [],
    schemas: [
      '- 허용 설정 변경: {"action":"update_config","title":"설명","changes":{"temperature":80,"maxResponse":2000}}',
    ],
    rawDelimiters: false,
  },
  {
    id: 'char_settings',
    label: '캐릭터 고급 튜닝',
    actions: ['update_char_settings'],
    knowledge: ['char_advanced'],
    rules: [
      '현재 캐릭터의 로어북 예산·스캔 깊이(`loreSettings`), 로짓 바이어스(`bias`), 태그(`tags`)를 조정할 때는 `update_char_settings`를 사용하세요. 기존 바이어스나 태그를 유지하면서 일부만 추가·삭제할 때는 `addBias`/`removeBias`, `addTags`/`removeTags`를 쓰세요.',
    ],
    schemas: [
      '- 캐릭터 고급 튜닝(로어북 설정·바이어스·태그): {"action":"update_char_settings","title":"설명","loreSettings":{"tokenBudget":1600,"scanDepth":6,"recursiveScanning":true,"fullWordMatching":false},"addBias":[["반복단어",-20]],"removeBias":["지울단어"],"addTags":["판타지"],"removeTags":["초안"]} (전체 교체 시 bias / tags 배열 직접 지정 가능)',
    ],
    rawDelimiters: false,
  },
  {
    id: 'char_create_port',
    label: '캐릭터 생성 · 포팅',
    actions: ['create_character', 'port_from_character'],
    knowledge: ['character', 'char_advanced', 'cbs'],
    rules: [
      '새 캐릭터 카드를 처음부터 만들 때는 `create_character`를 사용하세요(현재 캐릭터를 덮어쓰지 않고 새 캐릭터로 추가됩니다).',
      '다른 캐릭터의 로어북·정규식·Lua를 현재 캐릭터로 옮길 때는 `port_from_character`를 사용하세요. 어느 캐릭터에서 가져올지 불분명하면 [다른 캐릭터 목록]을 보여 주고 먼저 물어보세요.',
    ],
    schemas: [
      '- 새 캐릭터 카드 생성: {"action":"create_character","title":"설명","name":"캐릭터명","desc":"설명","firstMessage":"첫 메시지","alternateGreetings":[],"personality":"","scenario":"","systemPrompt":"","creatorNotes":"","defaultVariables":"","tags":["태그"],"loreSettings":{"tokenBudget":1200,"scanDepth":4,"recursiveScanning":true},"bias":[],"globalLore":[],"customscript":[],"luaCode":""}',
      '- 다른 캐릭터에서 포팅: {"action":"port_from_character","title":"설명","sourceCharIndex":1,"items":["lorebook","regex","lua"],"loreIndices":[0,1],"regexIndices":[0]} (loreIndices/regexIndices 생략 시 해당 항목 전체 복사, 중복 로어북/정규식은 자동 건너뜀)',
    ],
    rawDelimiters: true,
  },
  {
    id: 'chat_vars',
    label: '채팅 변수',
    actions: ['update_chat_vars'],
    knowledge: ['chat_vars', 'cbs'],
    rules: [
      '현재 진행 중인 채팅의 변수(`chat.scriptstate`) 값을 추가·수정·삭제할 때는 `update_chat_vars`를 사용하세요(새 채팅의 기본값은 `update_field`의 `defaultVariables`).',
    ],
    schemas: [
      '- 현재 채팅 변수 편집: {"action":"update_chat_vars","title":"설명","set":{"hp":"80","affection":"50"},"remove":["old_flag"]} (set은 추가/수정할 변수 맵, remove는 삭제할 변수 이름 배열; 키에 "$"는 붙이지 않아도 됨)',
    ],
    rawDelimiters: false,
  },
  {
    id: 'chat_migration',
    label: '채팅 생성 · 이사',
    actions: ['import_chat', 'create_chat'],
    knowledge: [],
    rules: [
      '같은 캐릭터의 다른 채팅에서 지금 채팅으로 "이사"(변수·작가의 노트·채팅 로어북·연결 페르소나·채팅 모듈·첫 메시지 번호 옮기기)할 때는 `import_chat`을 사용하세요. 값은 플러그인이 원본 그대로 복사하므로 변수 값이나 노트 내용을 직접 받아 적지 마세요. 원본 채팅이 어느 것인지 불분명하면 [같은 캐릭터의 채팅 목록]을 보여 주고 먼저 물어보세요.',
      '새 채팅을 새로 만들거나, "현재 채팅(또는 N번 채팅)을 요약해서 새 채팅으로 한 번에 이사해 줘"처럼 새 채팅 생성과 이사를 함께 요청하면 `create_chat`을 사용하세요. `importFromChatIndex`("current" 또는 원본 chatIndex), `importItems`, 필요 시 `summaryLorebook`과 `switchToNewChat: true`를 한 블록에 담아 원클릭으로 제안할 수 있습니다.',
      '이미 새 채팅이 열려 있는 상태에서 이전 채팅의 요약을 넘길 때는 [참조 채팅]에 실제로 전달된 내용만으로 요약을 쓰고, 기본적으로 `create_lorebook`(scope: "chat", alwaysActive: true, 항목명 예: "이전 채팅 요약")으로 현재 채팅에 넣으세요. 사용자가 작가의 노트에 넣어 달라고 하면 `update_field`(field: "authorNote")를 쓰되, 그 경우 같은 답변의 `import_chat` items에서 "authorNote"를 빼고 원본 노트에서 유지할 내용을 요약과 합쳐 한 번에 쓰세요(두 제안이 같은 노트를 번갈아 덮어쓰지 않도록).',
    ],
    schemas: [
      '- 다른 채팅에서 현재 채팅으로 이사: {"action":"import_chat","title":"설명","sourceChatIndex":0,"items":["variables","authorNote","localLore","persona","modules","greeting"]} (items는 옮길 것만 고름: variables = 채팅 변수, authorNote = 작가의 노트, localLore = 채팅 로어북, persona = 연결 페르소나, modules = 채팅 모듈, greeting = 쓰던 첫 메시지 번호. 일부 변수만 옮기려면 "variableKeys":["hp","affection"] 추가. 대화 메시지 자체는 옮기지 않음)',
      '- 새 채팅 생성 (+ 원클릭 이사): {"action":"create_chat","title":"설명","name":"2부 여정","fmIndex":-1,"switchToNewChat":true,"importFromChatIndex":"current","importItems":["variables","authorNote","localLore","persona","modules","greeting"],"summaryLorebook":{"comment":"이전 채팅 요약","content":"요약 본문","alwaysActive":true,"insertorder":100}} (단순 새 채팅이면 name·fmIndex·switchToNewChat만 지정)',
    ],
    rawDelimiters: false,
  },
  {
    id: 'fetch_logs',
    label: '요청 로그 진단',
    actions: [],
    knowledge: ['fetch_logs'],
    rules: [],
    schemas: [],
    rawDelimiters: false,
  },
];

const SKILL_BY_ID = new Map(SKILL_DEFS.map(s => [s.id, s]));
const SKILL_ID_BY_ACTION = new Map();
for (const def of SKILL_DEFS) {
  if (def.id === 'core_text' || def.id === 'chat_input') continue;
  for (const act of def.actions || []) {
    SKILL_ID_BY_ACTION.set(act, def.id);
  }
}

// On chat/unknown free-talk, always expose lightweight scripts/persona schemas so follow-ups or
// indirect phrasing never lose v0.4.x action coverage, while deferring heavy Lua/regex/persona
// knowledge guides until triggered by screen, keyword, or recent turn context.
const FREE_TALK_SCHEMA_BASELINE_SKILLS = ['scripts', 'persona'];

/**
 * Combines the current user input with the most recent 2 user messages from `history` so
 * short follow-ups ("응 그렇게 해줘", "2번에서 가져와줘") retain the prior turn's skill & context.
 */
function collectRoutingText(userInput = '', history = [], maxRecentUserTurns = 2) {
  const parts = [];
  if (Array.isArray(history) && history.length > 0 && maxRecentUserTurns > 0) {
    const recentUsers = [];
    for (let i = history.length - 1; i >= 0 && recentUsers.length < maxRecentUserTurns; i--) {
      const msg = history[i];
      if (msg && msg.role === 'user') {
        const text = String(msg.rawText ?? msg.content ?? '').trim();
        if (text) recentUsers.unshift(text);
      }
    }
    parts.push(...recentUsers);
  }
  const cur = String(userInput ?? '').trim();
  if (cur) parts.push(cur);
  return parts.join('\n');
}

/**
 * Extracts skill IDs for any proposals emitted in the immediately preceding assistant message
 * so follow-up tweaks ("조금만 바꿔줘") keep that action's schema & knowledge active.
 */
function extractRecentAssistantSkillIds(history = []) {
  const ids = new Set();
  if (!Array.isArray(history) || history.length === 0) return ids;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant') continue;
    if (Array.isArray(msg.proposals)) {
      for (const item of msg.proposals) {
        const act = item?.proposal?.action || item?.action;
        const sid = act ? SKILL_ID_BY_ACTION.get(act) : null;
        if (sid) ids.add(sid);
      }
    }
    const raw = String(msg.rawText ?? msg.content ?? '');
    for (const m of raw.matchAll(/"action"\s*:\s*"([a-z_]+)"/g)) {
      const sid = SKILL_ID_BY_ACTION.get(m[1]);
      if (sid) ids.add(sid);
    }
    break; // only inspect the immediately preceding assistant turn
  }
  return ids;
}

/**
 * Deterministically selects the subset of internal skills for a request based on
 * current cursor/screen, user message + recent follow-up turns, and attached context.
 * @returns {string[]} ordered list of active skill IDs
 */
function selectSkills({ context, snapshot, userInput = '', history = [], extraContext = {} } = {}) {
  const screen = context?.screen || 'unknown';
  const kind = snapshot?.target?.targetKind || context?.targetKind || 'general';
  const isFreeTalk = Boolean(context?.freeTalk) || kind === 'general';
  const isChatInput = kind === 'chat_input';
  const text = collectRoutingText(userInput, history);
  const active = new Set();

  // 1. Primary target / screen routing
  if (isChatInput) {
    active.add('chat_input');
  } else if (!isFreeTalk) {
    active.add('core_text');
  }

  if (kind === 'char_field' || screen === 'character') {
    active.add('char_fields');
    if (context?.fieldKey === 'firstMessage' || screen === 'character') active.add('greetings');
  }
  if (kind === 'char_alt_greeting') {
    active.add('greetings');
  }
  if (kind === 'chat_note' || kind === 'chat_message') {
    active.add('char_fields');
  }
  if (kind.includes('lorebook') || screen === 'lorebook') {
    active.add('lorebook');
  }
  if (kind.includes('lua') || kind.includes('regex') || screen === 'scripts') {
    active.add('scripts');
  }
  if (kind === 'persona' || screen === 'persona') {
    active.add('persona');
  }
  if (kind === 'config' || screen === 'settings') {
    active.add('config');
  }
  if (kind === 'module_field' || screen === 'module') {
    const modTab = extraContext?.openModule?.tab || context?.moduleDomHints?.tab || '';
    if (modTab === 'regex' || modTab === 'trigger') {
      active.add('scripts');
    } else if (modTab === 'lorebook') {
      active.add('lorebook');
    } else {
      active.add('lorebook');
      active.add('scripts');
    }
  }

  // Free talk on chat/unknown screen: keep the common lightweight authoring baseline,
  // while leaving heavier specialized knowledge packs keyword/context-driven.
  if (isFreeTalk && (screen === 'chat' || screen === 'unknown')) {
    active.add('char_fields');
    active.add('greetings');
    active.add('lorebook');
    active.add('config');
    active.add('chat_vars');
  }

  // 2. Context-driven activations
  if (extraContext?.chatList?.chats?.length > 1 || extraContext?.referenceChat) {
    if (isFreeTalk || isChatInput || SKILL_KEYWORDS.chat_migration.test(text)) {
      active.add('chat_migration');
    }
  }
  if (extraContext?.attachedFetchLog) {
    active.add('fetch_logs');
    active.add('config');
  }
  if (extraContext?.personasSummary && (screen === 'persona' || SKILL_KEYWORDS.persona.test(text))) {
    active.add('persona');
  }
  if (extraContext?.chatVariables?.variables?.length > 0 && (isFreeTalk || isChatInput || SKILL_KEYWORDS.chat_vars.test(text))) {
    active.add('chat_vars');
  }
  if (extraContext?.characterCatalog?.length > 0) {
    active.add('char_create_port');
  }

  // 3. Keyword-driven activations across current + recent user turns (works from ANY screen/focus!)
  for (const [id, re] of Object.entries(SKILL_KEYWORDS)) {
    if (re.test(text)) active.add(id);
  }

  // 4. Carry over skills for proposals emitted in the immediately preceding assistant turn
  for (const id of extractRecentAssistantSkillIds(history)) {
    active.add(id);
  }

  // Keep canonical definition order
  return SKILL_DEFS.filter(s => active.has(s.id)).map(s => s.id);
}

function buildSkillPromptSections({ context, snapshot, userInput = '', history = [], extraContext = {} } = {}) {
  const activeSkillIds = selectSkills({ context, snapshot, userInput, history, extraContext });
  const activeSet = new Set(activeSkillIds);
  const screen = context?.screen || 'unknown';
  const kind = snapshot?.target?.targetKind || context?.targetKind || 'general';
  const isFreeTalk = Boolean(context?.freeTalk) || kind === 'general';

  // On chat/unknown free-talk, include compact scripts & persona schemas even without keywords
  // (v0.4.x action parity) without paying for heavy Lua/regex/persona knowledge guides.
  const schemaOnlySkillIds = isFreeTalk && (screen === 'chat' || screen === 'unknown')
    ? FREE_TALK_SCHEMA_BASELINE_SKILLS.filter(id => !activeSet.has(id))
    : [];
  const schemaSkillSet = new Set([...activeSkillIds, ...schemaOnlySkillIds]);

  const knowledgeKeys = new Set(['core']);
  const rules = [];
  const schemas = [];
  const activeActions = [];
  const seenActions = new Set();
  let includeRawDelimiters = false;

  const fieldKey = snapshot?.target?.fieldKey || context?.fieldKey || '';
  if (fieldKey === 'guiHTML' || fieldKey === 'customCSS') {
    knowledgeKeys.add('cbs');
  }

  for (const def of SKILL_DEFS) {
    const isActive = activeSet.has(def.id);
    const includeSchema = schemaSkillSet.has(def.id);
    if (!isActive && !includeSchema) continue;

    if (isActive) {
      for (const k of def.knowledge) knowledgeKeys.add(k);
      for (const r of def.rules) rules.push(r);
    }
    if (includeSchema) {
      for (const s of def.schemas) schemas.push(s);
      for (const a of def.actions || []) {
        if (!seenActions.has(a)) {
          seenActions.add(a);
          activeActions.push(a);
        }
      }
      if (def.rawDelimiters) includeRawDelimiters = true;
    }
  }

  const knowledgeText = [...knowledgeKeys]
    .map(k => KNOWLEDGE_SECTIONS[k])
    .filter(Boolean)
    .join('\n\n');

  return {
    activeSkillIds,
    activeSkillLabels: activeSkillIds.map(id => SKILL_BY_ID.get(id)?.label || id),
    activeActions,
    knowledgeText,
    rules,
    schemas,
    includeRawDelimiters,
  };
}

export { SKILL_DEFS, collectRoutingText, selectSkills, buildSkillPromptSections };
