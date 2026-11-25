// SPDX-License-Identifier: GPL-3.0-only
// Data-driven L0 / L1 / L2 built-in skill router for RisuHelper (v0.8.0+).
// No external SKILL.md files: every skill is declared once in SKILL_DEFS with its
// summary, owned actions (100% disjoint partition), knowledge/rules/schemas, triggers,
// associated Read-Only tools, capability requirements, and prompt char budget.

import { KNOWLEDGE_SECTIONS } from './knowledge.js';

const SKILL_DEFS = [
  {
    id: 'core_text',
    label: '현재 칸 편집',
    summary: '현재 포커스된 단일 입력칸의 부분 편집(patch_text) 및 덮어쓰기(replace_text)',
    requiresCapabilities: [],
    actions: ['patch_text', 'replace_text'],
    tools: ['read_item'],
    maxChars: 1200,
    triggers: {
      screens: [],
      targetKinds: [
        'char_field', 'char_alt_greeting', 'chat_note', 'chat_message',
        'char_lorebook', 'chat_lorebook', 'module_lorebook',
        'char_lua', 'module_lua', 'char_regex', 'module_regex',
        'persona', 'module_field', 'config',
      ],
      keywords: null,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
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
    summary: '채팅 입력창에서 현재 채팅 흐름에 맞는 유저 대사/행동 대필',
    requiresCapabilities: [],
    actions: [],
    usesActions: ['replace_text'],
    tools: ['read_chat', 'read_vars'],
    maxChars: 1400,
    triggers: {
      screens: [],
      targetKinds: ['chat_input'],
      keywords: null,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
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
    summary: '캐릭터 설명·시스템 프롬프트·글로벌 노트·시나리오·작가의 노트 수정(update_field)',
    requiresCapabilities: [],
    actions: ['update_field'],
    tools: ['read_item'],
    maxChars: 2400,
    triggers: {
      screens: ['character'],
      targetKinds: ['char_field', 'chat_note', 'chat_message'],
      keywords: /설명|디스크립션|desc|캐릭터\s*(?:소개|프로필\s*본문|정보)|시스템\s*프롬프트|시프|글로벌\s*노트|글노|깊이\s*프롬프트|뎁스\s*프롬프트|depth_?prompt|작가(?:의)?\s*노트|작노|author\s*note|성격|시나리오|예시\s*대화|백그라운드|배경\s*임베딩|번역가|제작자\s*(?:코멘트|노트)|닉네임|기본\s*변수|커스텀\s*토글/i,
      contextKeys: [],
      freeTalkSchemaBaseline: true,
    },
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
    summary: '기본 첫 메시지 및 추가 첫 메시지 수정·생성·삭제(update/create/delete_greeting)',
    requiresCapabilities: [],
    actions: ['update_greeting', 'create_greeting', 'delete_greeting'],
    tools: ['read_item'],
    maxChars: 2800,
    triggers: {
      screens: ['character'],
      targetKinds: ['char_alt_greeting'],
      fieldKeys: ['firstMessage'],
      keywords: /첫\s*(?:메시지|메세지|인사|대사|장면)|추가\s*첫|인사말|오프닝|도입부|그리팅|greeting|alternate\s*greeting|first\s*message|fmIndex/i,
      contextKeys: [],
      freeTalkSchemaBaseline: true,
    },
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
    summary: '캐릭터·채팅·모듈 로어북 생성·수정·폴더 정리·삭제',
    requiresCapabilities: [],
    actions: ['create_lorebook', 'update_lorebook', 'organize_lorebook', 'delete_lorebook'],
    tools: ['read_item', 'list_items', 'active_lorebook', 'audit_workspace'],
    maxChars: 3200,
    triggers: {
      screens: ['lorebook'],
      targetKinds: ['char_lorebook', 'chat_lorebook', 'module_lorebook'],
      keywords: /로어북|로어\b|lorebook|lore\b|폴더|folder|세계관|설정집|백과|인물\s*정보|용어집|요약\s*(?:항목|로어)|이사|insertorder|@@depth|활성화\s*키|키워드\s*(?:등록|추가|수정)|상시\s*활성|alwaysActive/i,
      contextKeys: [],
      freeTalkSchemaBaseline: true,
    },
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
    summary: '캐릭터·모듈 Lua 트리거 및 정규식(editdisplay/editoutput 등) 작성·수정·삭제',
    requiresCapabilities: [],
    actions: ['update_lua', 'upsert_regex', 'delete_regex'],
    tools: ['read_item', 'list_items', 'test_regex_cbs', 'audit_workspace'],
    maxChars: 3800,
    triggers: {
      screens: ['scripts'],
      targetKinds: ['char_lua', 'module_lua', 'char_regex', 'module_regex'],
      keywords: /lua|루아|트리거|trigger|정규식|정규\s*표현식|regex|customscript|상태창|스탯창|hud|배지|editdisplay|editoutput|editinput|editprocess|cbs|\{\{|스크립트|script|꾸며|표시\s*형식|치환|턴\s*수|응답마다|출력마다|html|css|버튼\s*클릭|onOutput|onInput|listenEdit/i,
      contextKeys: [],
      freeTalkSchemaBaseline: true,
    },
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
    summary: '정규식+Lua+토글+임베딩+로어북이 묶인 새 RisuAI 모듈 통째 생성(create_module)',
    requiresCapabilities: [],
    actions: ['create_module'],
    tools: ['list_items', 'read_item', 'test_regex_cbs', 'audit_workspace'],
    maxChars: 5500,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /모듈\s*(?:하나|통째|통으로|신규|새로|생성|만들|추가|제작|짜|패키지|구축)|새\s*모듈|신규\s*모듈|\.risum|create_module/i,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
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
    summary: '유저 페르소나 생성·수정·삭제 및 현재 채팅 바인딩',
    requiresCapabilities: [],
    actions: ['create_persona', 'update_persona', 'delete_persona'],
    tools: ['read_item', 'list_items'],
    maxChars: 2200,
    triggers: {
      screens: ['persona'],
      targetKinds: ['persona'],
      keywords: /페르소나|페르\b|persona|바인딩|bindedPersona|유저\s*(?:설정|프로필|정보|소개|캐릭터|이름)|(?:내|플레이어|주인공)\s*(?:캐릭터\s*)?(?:프로필|설정)|화자\s*설정/i,
      contextKeys: [],
      freeTalkSchemaBaseline: true,
    },
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
    summary: '온도·최대 응답·페널티·CSS/HTML·전역 모듈 등 RisuAI 전역 설정 변경(update_config)',
    requiresCapabilities: [],
    actions: ['update_config'],
    tools: ['read_item', 'host_info'],
    maxChars: 2200,
    triggers: {
      screens: ['settings'],
      targetKinds: ['config'],
      keywords: /전역\s*설정|리스\s*설정|설정(?:값|을|이|은|\s*진단|\s*변경|\s*수정|\s*바꿔|\s*올려|\s*내려|\s*알려)|컨피그|config|temperature|온도|창의성|maxResponse|최대\s*응답|응답\s*길이|maxContext|최대\s*컨텍스트|컨텍스트\s*(?:크기|토큰)|페널티|penalty|customCSS|guiHTML|테마|theme|줄간격|lineHeight|전역\s*모듈\s*활성|모듈\s*활성|enabledModules|보조\s*모델|seperateModels/i,
      contextKeys: ['attachedFetchLog'],
      freeTalkSchemaBaseline: true,
    },
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
    summary: '로어북 토큰 예산·스캔 깊이(loreSettings), 로짓 바이어스(bias), 태그(tags) 튜닝',
    requiresCapabilities: [],
    actions: ['update_char_settings'],
    tools: ['read_item', 'audit_workspace'],
    maxChars: 2200,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /로어북\s*(?:설정|예산|토큰|깊이)|토큰\s*예산|tokenBudget|스캔\s*깊이|scanDepth|재귀\s*스캔|recursiveScanning|전체\s*단어|fullWordMatching|바이어스|로짓|bias|금지어\s*감점|태그|tags/i,
      contextKeys: ['charSettings'],
      freeTalkSchemaBaseline: false,
    },
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
    summary: '새 캐릭터 카드 생성(create_character) 및 다른 캐릭터의 로어북·정규식·Lua 포팅(port_from_character)',
    requiresCapabilities: [],
    actions: ['create_character', 'port_from_character'],
    tools: ['list_items', 'read_item', 'inspect_assets'],
    maxChars: 3800,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /새\s*캐릭터|신규\s*캐릭터|새\s*봇|신규\s*봇|캐릭터\s*(?:카드\s*)?(?:새로\s*)?(?:생성|만들|추가|제작|포팅|복사|이식)|봇\s*(?:카드\s*)?(?:새로\s*)?(?:생성|만들|제작)|다른\s*캐릭터|타\s*캐릭터|교차\s*포팅|포팅|이식해|create_character|port_from_character/i,
      contextKeys: ['characterCatalog'],
      freeTalkSchemaBaseline: false,
    },
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
    summary: '채팅 변수(chat.scriptstate) 호감도·스탯·플래그 추가·수정·삭제(update_chat_vars)',
    requiresCapabilities: [],
    actions: ['update_chat_vars'],
    tools: ['read_vars', 'test_regex_cbs'],
    maxChars: 1800,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /채팅\s*변수|변수|scriptstate|호감도|affection|\bhp\b|\bmp\b|체력|마나|골드|소지금|스탯|상태값|플래그|카운터|\bvar\b|getvar|setvar|초기화/i,
      contextKeys: [],
      freeTalkSchemaBaseline: true,
    },
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
    summary: '새 채팅 생성+원클릭 이사(create_chat) 및 다른 채팅에서 상태 옮기기(import_chat)',
    requiresCapabilities: [],
    actions: ['import_chat', 'create_chat'],
    tools: ['list_items', 'read_chat', 'read_vars'],
    maxChars: 2400,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /이사|옮겨|가져와|이관|참조\s*채팅|\d+\s*번\s*채팅|채팅\s*#?\d+|이전\s*채팅|다른\s*채팅|콜드\s*스토리지|새\s*채팅|신규\s*채팅|채팅\s*(?:생성|만들|추가|분리|새로)|세션\s*(?:분리|새로|이사)|다음\s*회차|2부\s*채팅|create_chat|import_chat/i,
      contextKeys: ['chatList', 'referenceChat'],
      freeTalkSchemaBaseline: false,
    },
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
    summary: '사용자가 직접 첨부한 최근 LLM API 요청·응답 로그 오류(4xx/5xx·토큰 초과 등) 분석',
    requiresCapabilities: ['getFetchLogs'],
    actions: [],
    tools: ['read_fetch_log', 'host_info'],
    maxChars: 1000,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /요청\s*로그|api\s*로그|fetch\s*log|에러\s*로그|오류\s*로그|(?:400|401|403|429|500|502|503)\s*(?:에러|오류|error)|http\s*(?:에러|오류|상태)|응답\s*로그|전송\s*실패\s*원인/i,
      currentTurnOnly: true,
      contextKeys: ['attachedFetchLog'],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['fetch_logs'],
    rules: [],
    schemas: [],
    rawDelimiters: false,
  },
];

const SKILL_BY_ID = new Map(SKILL_DEFS.map(s => [s.id, s]));
const SKILL_ID_BY_ACTION = new Map();
for (const def of SKILL_DEFS) {
  for (const act of def.actions || []) {
    SKILL_ID_BY_ACTION.set(act, def.id);
  }
}

const FREE_TALK_SCHEMA_BASELINE_SKILLS = SKILL_DEFS
  .filter(def => def.triggers?.freeTalkSchemaBaseline)
  .map(def => def.id);

function getSkillById(id) {
  return SKILL_BY_ID.get(String(id ?? '').trim()) || null;
}

function getOwnerSkillForAction(action) {
  return SKILL_ID_BY_ACTION.get(String(action ?? '').trim()) || null;
}

/**
 * Estimates the rendered prompt character footprint of a single skill pack
 * (knowledge sections + rules + schemas) for enforcing `maxChars` invariants.
 */
function measureSkillChars(def) {
  if (!def) return 0;
  const kChars = (def.knowledge || []).reduce((s, k) => s + String(KNOWLEDGE_SECTIONS[k] || '').length, 0);
  const rChars = (def.rules || []).reduce((s, r) => s + String(r || '').length, 0);
  const sChars = (def.schemas || []).reduce((s, sc) => s + String(sc || '').length, 0);
  return kChars + rChars + sChars;
}

/**
 * Validates the built-in skill registry against an action whitelist (`VALID_ACTIONS`):
 * - Every action belongs to EXACTLY ONE skill in SKILL_DEFS (100% reachability, 0 duplicates).
 * - Every skill declares required metadata (`id`, `label`, `summary`, `triggers`, `tools`, `requiresCapabilities`, `maxChars`).
 * - Every skill stays within its declared `maxChars` budget.
 */
function validateSkillRegistry(validActions = []) {
  const issues = [];
  const seenSkills = new Set();
  const actionOwners = new Map();

  for (const def of SKILL_DEFS) {
    if (!def.id || seenSkills.has(def.id)) {
      issues.push(`중복되거나 비어 있는 스킬 ID: ${def.id}`);
    }
    seenSkills.add(def.id);
    if (!def.label || !def.summary) issues.push(`스킬 ${def.id}: label/summary 누락`);
    if (!def.triggers || typeof def.triggers !== 'object') issues.push(`스킬 ${def.id}: triggers 누락`);
    if (!Array.isArray(def.tools)) issues.push(`스킬 ${def.id}: tools 배열 누락`);
    if (!Array.isArray(def.requiresCapabilities)) issues.push(`스킬 ${def.id}: requiresCapabilities 배열 누락`);
    if (!Number.isInteger(def.maxChars) || def.maxChars <= 0) {
      issues.push(`스킬 ${def.id}: 유효한 maxChars 누락`);
    } else {
      const actual = measureSkillChars(def);
      if (actual > def.maxChars) {
        issues.push(`스킬 ${def.id}: 실제 글자 수(${actual})가 maxChars(${def.maxChars}) 초과`);
      }
    }
    for (const act of def.actions || []) {
      if (actionOwners.has(act)) {
        issues.push(`동작 "${act}"이(가) 여러 스킬(${actionOwners.get(act)}, ${def.id})에 중복 등록됨`);
      } else {
        actionOwners.set(act, def.id);
      }
    }
  }

  for (const act of validActions || []) {
    if (!actionOwners.has(act)) {
      issues.push(`동작 "${act}"을(를) 소유한 내장 스킬이 없음`);
    }
  }
  const validSet = new Set(validActions || []);
  if (validSet.size > 0) {
    for (const [act, owner] of actionOwners.entries()) {
      if (!validSet.has(act)) {
        issues.push(`스킬 ${owner}에 미등록 동작 "${act}"이(가) 선언됨`);
      }
    }
  }

  return { ok: issues.length === 0, issues, actionOwners: Object.fromEntries(actionOwners) };
}

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
        if (sid && sid !== 'core_text') ids.add(sid);
      }
    }
    const raw = String(msg.rawText ?? msg.content ?? '');
    for (const m of raw.matchAll(/"action"\s*:\s*"([a-z_]+)"/g)) {
      const sid = SKILL_ID_BY_ACTION.get(m[1]);
      if (sid && sid !== 'core_text') ids.add(sid);
    }
    break; // only inspect the immediately preceding assistant turn
  }
  return ids;
}

function isSkillSupported(def, capabilities = null) {
  if (!def) return false;
  if (!capabilities || !Array.isArray(def.requiresCapabilities) || def.requiresCapabilities.length === 0) {
    return true;
  }
  return def.requiresCapabilities.every(cap => Boolean(capabilities[cap]));
}

/**
 * Returns the L1 built-in skill catalog (id, label, 1-line summary, actions, tools) for all skills
 * supported on the current host and not in `excludeIds`.
 */
function getSkillCatalog(capabilities = null, excludeIds = []) {
  const excluded = new Set(Array.isArray(excludeIds) ? excludeIds : []);
  return SKILL_DEFS
    .filter(def => !excluded.has(def.id) && isSkillSupported(def, capabilities))
    .map(def => ({
      id: def.id,
      label: def.label,
      summary: def.summary,
      actions: [...(def.actions || [])],
      tools: [...(def.tools || [])],
    }));
}

/**
 * L2 dynamic skill loader used by the Read-Only `load_skill` tool inside the 3-call loop.
 */
function loadSkillPack(skillIds = [], capabilities = null) {
  const requested = Array.isArray(skillIds) ? skillIds : [skillIds];
  const loaded = [];
  const unknown = [];
  const unsupported = [];
  const knowledgeKeys = new Set();
  const rules = [];
  const schemas = [];

  for (const rawId of requested) {
    const id = String(rawId ?? '').trim();
    if (!id) continue;
    const def = SKILL_BY_ID.get(id);
    if (!def) {
      unknown.push(id);
      continue;
    }
    if (!isSkillSupported(def, capabilities)) {
      unsupported.push(id);
      continue;
    }
    if (!loaded.includes(id)) {
      loaded.push(id);
      for (const k of def.knowledge || []) knowledgeKeys.add(k);
      for (const r of def.rules || []) rules.push(r);
      for (const s of def.schemas || []) schemas.push(s);
    }
  }

  const sections = [];
  const knowledgeText = [...knowledgeKeys].map(k => KNOWLEDGE_SECTIONS[k]).filter(Boolean).join('\n\n');
  if (knowledgeText) sections.push(`[불러온 내장 스킬 지식]\n${knowledgeText}`);
  if (rules.length > 0) sections.push(`[규칙]\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
  if (schemas.length > 0) sections.push(`[지원 action 스키마]\n${schemas.join('\n')}`);

  return {
    ok: loaded.length > 0,
    loaded,
    unknown,
    unsupported,
    text: sections.join('\n\n'),
  };
}

function hasContextTrigger(def, extraContext, { isFreeTalk, isChatInput, text }) {
  const keys = def.triggers?.contextKeys || [];
  for (const key of keys) {
    if (key === 'chatList') {
      if (extraContext?.chatList?.chats?.length > 1 && (isFreeTalk || isChatInput || def.triggers.keywords?.test(text))) {
        return true;
      }
    } else if (key === 'referenceChat') {
      if (extraContext?.referenceChat && (isFreeTalk || isChatInput || def.triggers.keywords?.test(text))) {
        return true;
      }
    } else if (key === 'characterCatalog') {
      if (extraContext?.characterCatalog?.length > 0) return true;
    } else if (key === 'charSettings') {
      if (extraContext?.charSettings) return true;
    } else if (key === 'attachedFetchLog') {
      if (extraContext?.attachedFetchLog) return true;
    } else if (extraContext?.[key]) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministically selects the subset of internal skills (full knowledge + rules + schemas)
 * based on declarative `SKILL_DEFS` triggers, recent conversation context, and L2 `extraSkillIds`.
 * @returns {string[]} ordered list of active skill IDs
 */
function selectSkills({
  context,
  snapshot,
  userInput = '',
  history = [],
  extraContext = {},
  extraSkillIds = [],
  capabilities = null,
} = {}) {
  const screen = context?.screen || 'unknown';
  const kind = snapshot?.target?.targetKind || context?.targetKind || 'general';
  const fieldKey = snapshot?.target?.fieldKey || context?.fieldKey || '';
  const isFreeTalk = Boolean(context?.freeTalk) || kind === 'general';
  const isChatInput = kind === 'chat_input';
  const text = collectRoutingText(userInput, history);
  const active = new Set();

  // 1. Declarative screen / target / field / context / keyword triggers
  for (const def of SKILL_DEFS) {
    const tr = def.triggers || {};

    if (def.id === 'core_text') {
      if (!isFreeTalk && !isChatInput) active.add('core_text');
      continue;
    }
    if (def.id === 'chat_input') {
      if (isChatInput) active.add('chat_input');
      continue;
    }

    if (Array.isArray(tr.screens) && tr.screens.includes(screen)) {
      active.add(def.id);
    }
    if (Array.isArray(tr.targetKinds) && tr.targetKinds.includes(kind)) {
      active.add(def.id);
    }
    if (Array.isArray(tr.fieldKeys) && fieldKey && tr.fieldKeys.includes(fieldKey)) {
      active.add(def.id);
    }
    if (hasContextTrigger(def, extraContext, { isFreeTalk, isChatInput, text })) {
      active.add(def.id);
    }
    if (tr.keywords) {
      const kwText = tr.currentTurnOnly ? String(userInput ?? '') : text;
      if (tr.keywords.test(kwText)) {
        active.add(def.id);
      }
    }
  }

  // Module editor screen tab routing (lorebook vs regex/trigger tab)
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

  // 2. Carry over skills for proposals emitted in the immediately preceding assistant turn
  for (const id of extractRecentAssistantSkillIds(history)) {
    active.add(id);
  }

  // 3. Merge any L2 dynamically loaded skills requested via `load_skill`
  for (const rawId of Array.isArray(extraSkillIds) ? extraSkillIds : []) {
    const id = String(rawId ?? '').trim();
    if (SKILL_BY_ID.has(id)) active.add(id);
  }

  // Keep canonical definition order and hide skills unsupported on this host
  return SKILL_DEFS
    .filter(s => active.has(s.id) && isSkillSupported(s, capabilities))
    .map(s => s.id);
}

function buildSkillPromptSections({
  context,
  snapshot,
  userInput = '',
  history = [],
  extraContext = {},
  extraSkillIds = [],
  capabilities = null,
} = {}) {
  const activeSkillIds = selectSkills({
    context,
    snapshot,
    userInput,
    history,
    extraContext,
    extraSkillIds,
    capabilities,
  });
  const activeSet = new Set(activeSkillIds);
  const screen = context?.screen || 'unknown';
  const kind = snapshot?.target?.targetKind || context?.targetKind || 'general';
  const isFreeTalk = Boolean(context?.freeTalk) || kind === 'general';

  // On chat/unknown free-talk, keep common lightweight action schemas loaded (1-call parity)
  // while loading heavy knowledge guides & rules ONLY for skills triggered in `activeSkillIds`.
  const schemaOnlySkillIds = isFreeTalk && (screen === 'chat' || screen === 'unknown')
    ? FREE_TALK_SCHEMA_BASELINE_SKILLS.filter(id => !activeSet.has(id) && isSkillSupported(SKILL_BY_ID.get(id), capabilities))
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
    if (!isSkillSupported(def, capabilities)) continue;
    const isActive = activeSet.has(def.id);
    const includeSchema = schemaSkillSet.has(def.id);
    if (!isActive && !includeSchema) continue;

    if (isActive) {
      for (const k of def.knowledge) knowledgeKeys.add(k);
      for (const r of def.rules) rules.push(r);
    }
    if (includeSchema) {
      for (const s of def.schemas) schemas.push(s);
      for (const a of [...(def.actions || []), ...(def.usesActions || [])]) {
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

  // Exclude focus-only skills (`core_text`, `chat_input`) from L1 catalog on free-talk where
  // cursor-bound edits are disallowed, while exposing all other unloaded skills via `load_skill`.
  const l1Exclude = isFreeTalk ? [...activeSkillIds, 'core_text', 'chat_input'] : activeSkillIds;
  const l1Catalog = getSkillCatalog(capabilities, l1Exclude);

  return {
    activeSkillIds,
    schemaOnlySkillIds,
    activeSkillLabels: activeSkillIds.map(id => SKILL_BY_ID.get(id)?.label || id),
    activeActions,
    knowledgeText,
    rules,
    schemas,
    includeRawDelimiters,
    l1Catalog,
  };
}

export {
  SKILL_DEFS,
  FREE_TALK_SCHEMA_BASELINE_SKILLS,
  getSkillById,
  getOwnerSkillForAction,
  measureSkillChars,
  validateSkillRegistry,
  isSkillSupported,
  getSkillCatalog,
  loadSkillPack,
  collectRoutingText,
  selectSkills,
  buildSkillPromptSections,
};
