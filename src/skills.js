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
      keywords: /설명(?!\s*(?:해|만|을\s*해|좀|부탁))|디스크립션|추가\s*디스크립션|additionalText|desc|캐릭터\s*(?:소개|프로필\s*본문|정보|이름)|시스템\s*프롬프트|(?<![가-힣])시프(?:[을를은는이가의도만에]|에서|랑|이랑|(?![가-힣]))|글로벌\s*노트|(?<![가-힣])글노(?:[을를은는이가의도만에]|에서|랑|이랑|(?![가-힣]))|깊이\s*프롬프트|뎁스\s*프롬프트|depth_?prompt|후처리\s*지시|히스토리\s*이후|postHistory|작가(?:의)?\s*노트|작노|author\s*note|성격|시나리오|예시\s*대화|대사\s*예시|백그라운드|배경\s*임베딩|backgroundHTML|virtualscript|번역가|제작자\s*(?:코멘트|노트)|닉네임|기본\s*변수|커스텀\s*토글/i,
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
      keywords: /첫\s*(?:메시지|메세지|인사|대사|장면)|추가\s*첫|인사말|퍼메|퍼스트\s*메시지|대체\s*인사|시작\s*(?:메시지|메세지|장면|대사)|오프닝|도입부|인트로|그리팅|알터\s*그리팅|alt\s*greeting|greeting|alternate\s*greeting|first\s*message|fmIndex/i,
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
      keywords: /로어북|(?<![가-힣])로어|lorebook|lore\b|localLore|globalLore|(?<!채팅\s*)폴더|(?<!chat)folder|세계관|설정집|백과|인물\s*(?:정보|설정)|등장인물\s*(?:등록|추가|정리|설정)|npc\s*(?:등록|추가|설정)|용어집|요약\s*(?:항목|로어)|이사|insertorder|@@depth|활성화?\s*키|키워드\s*(?:등록|추가|수정|삭제|제거|변경|확인)|상시\s*활성|alwaysActive/i,
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
      keywords: /lua|루아|트리거|trigger|정규\s*식|정규\s*표현식|regex|customscript|상태창|스탯창|hud|배지|editdisplay|editoutput|editinput|editprocess|인풋\s*수정|아웃풋\s*수정|디스플레이\s*수정|출력\s*(?:꾸미|치환|필터|가공|숨기)|입력\s*(?:치환|필터|가공)|태그\s*숨기|사고\s*과정\s*숨기|cbs|\{\{|스크립트|script|꾸며|표시\s*형식|치환|턴\s*수|응답마다|출력마다|html|css|버튼\s*클릭|onOutput|onInput|listenEdit/i,
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
      keywords: /모듈\s*(?:하나|통째|통으로|신규|새로|생성|만들|추가|제작|짜|패키지|구축)|모듈로\s*(?:만들|묶|패키징)|새\s*모듈|신규\s*모듈|확장\s*팩|패키지\s*모듈|\.?risum\b|create_module/i,
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
      keywords: /페르소나|(?<![가-힣])페르(?:[을를은는이가의도만에]|에서|랑|이랑|(?![가-힣]))|persona|바인딩|bindedPersona|유저\s*(?:설정|프로필|정보|소개|캐릭터|이름)|(?:내|플레이어|주인공)\s*(?:캐릭터\s*)?(?:프로필|설정|정보|소개|이름)|화자\s*설정/i,
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
      keywords: /전역\s*설정|리스\s*설정|설정(?:값|을|이|은|\s*진단|\s*변경|\s*수정|\s*바꿔|\s*올려|\s*내려|\s*알려)|컨피그|config|temperature|템퍼러처|온도|창의성|maxResponse|최대\s*(?:응답|토큰)|(?:응답|출력)\s*길이|maxContext|최대\s*컨텍스트|컨텍스트\s*(?:크기|토큰)|페널티|penalty|customCSS|커스텀\s*css|guiHTML|채팅\s*html|테마|theme|줄\s*간격|lineHeight|전역\s*모듈|모듈\s*(?:활성|켜|끄|비활성)|enabledModules|보조\s*모델|seperateModels/i,
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
      keywords: /로어(?:북)?\s*(?:설정|예산|토큰|깊이)|loreSettings|토큰\s*예산|tokenBudget|스캔\s*(?:깊이|범위)|scanDepth|재귀\s*스캔|recursiveScanning|전체\s*단어|fullWordMatching|바이어스|로짓|bias|단어\s*(?:억제|감점|가중치|금지)|금지어\s*(?:감점|등록|추가|설정|제거)|(?:캐릭터|기존|봇)\s*태그|태그\s*(?:추가|삭제|제거|수정|편집|목록|정리|에|에서)|\btags\b/i,
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
    tools: ['list_items', 'search_workspace', 'read_item', 'inspect_assets'],
    maxChars: 3800,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /새\s*캐릭터|신규\s*캐릭터|새\s*봇|신규\s*봇|캐릭터\s*(?:카드\s*)?(?:새로\s*)?(?:생성|만들|추가|제작|포팅|복사|이식)|봇\s*(?:카드\s*)?(?:새로\s*)?(?:생성|만들|제작)|다른\s*(?:캐릭터|봇)|타\s*(?:캐릭터|봇)|교차\s*포팅|포팅|이식해|create_character|port_from_character/i,
      match: (text) => wantsCharacterCatalog(text),
      contextKeys: ['characterCatalog'],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['character', 'char_advanced', 'cbs'],
    rules: [
      '새 캐릭터 카드를 처음부터 만들 때는 `create_character`를 사용하세요(현재 캐릭터를 덮어쓰지 않고 새 캐릭터로 추가됩니다).',
      '다른 캐릭터의 로어북·정규식·Lua를 현재 캐릭터로 옮길 때는 `port_from_character`를 사용하세요. 어느 캐릭터에서 가져올지 불분명하면 [다른 캐릭터 목록]을 보여 주고 먼저 물어보세요.',
      '다른 캐릭터 목록이나 내부 로어북·정규식·Lua를 직접 확인할 때는 `list_items(kind:"character",query)`로 `charIndex`를 찾은 뒤 `list_items(kind:"lorebook",charIndex)`·`search_workspace(query,charIndex)`·`read_item(...,charIndex)`로 조회할 수 있습니다.',
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
      keywords: /채팅\s*변수|상태\s*변수|변수|scriptstate|호감도|신뢰도|친밀도|affection|\bhp\b|\bmp\b|체력|마나|골드|소지금|경험치|진행도|스탯|상태값|플래그|카운터|수치\s*(?:바꿔|변경|수정|올려|내려|조정|확인)|\bvar\b|getvar|setvar|초기화/i,
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
      keywords: /이사|옮겨|가져와|이관|참조\s*채팅|\d+\s*번\s*채팅|채팅\s*#?\d+|이전\s*채팅|다른\s*채팅|콜드\s*스토리지|새\s*(?:채팅|대화|방)|신규\s*채팅|채팅(?:방)?\s*(?:생성|만들|추가|분리|새로|복사)|대화\s*(?:이사|분리|이어서)|세션\s*(?:분리|새로|이사)|회차\s*(?:분리|넘기|이사)|다음\s*회차|2부\s*채팅|백업\s*채팅|create_chat|import_chat/i,
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
      keywords: /요청\s*로그|api\s*(?:로그|에러|오류|실패)|요청\s*(?:에러|오류|실패)|호출\s*(?:에러|오류|실패)|fetch\s*log|에러\s*로그|오류\s*로그|(?:400|401|403|429|500|502|503)\s*(?:에러|오류|error)?|http\s*(?:에러|오류|상태)|토큰\s*초과|레이트\s*리밋|rate\s*limit|응답\s*(?:로그|실패)|전송\s*실패\s*원인/i,
      currentTurnOnly: true,
      contextKeys: ['attachedFetchLog'],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['fetch_logs'],
    rules: [],
    schemas: [],
    rawDelimiters: false,
  },
  {
    id: 'theme_hud',
    label: '테마·HUD',
    summary: '색상 스킴·텍스트 테마 변경(update_theme) 및 정화된 HTML/CBS 채팅 HUD(set_chat_panel)',
    requiresCapabilities: ['colorScheme'],
    actions: ['update_theme', 'set_chat_panel'],
    tools: ['read_item', 'host_info', 'test_regex_cbs'],
    maxChars: 2400,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /색상\s*스킴|컬러\s*스킴|colorScheme|텍스트\s*테마|글자\s*테마|textTheme|다크\s*(?:테마|모드)|라이트\s*(?:테마|모드)|배경색|글자색|폰트\s*색|색상\s*(?:변경|바꿔|조정|커스텀)|테마\s*(?:변경|바꿔|전환|커스텀|적용)|채팅\s*(?:hud|패널|상태창\s*패널)|(?:상단|하단|오버레이|상태)\s*(?:hud|패널)|hud\s*패널|setChatPanel|set_chat_panel|update_theme/i,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['theme_hud', 'cbs'],
    rules: [
      '색상 스킴·텍스트 테마 프리셋 전환이나 커스텀 색상 적용에는 `update_theme`을, 채팅 화면에 상시 HTML/CBS HUD 패널을 띄우거나 닫을 때는 `set_chat_panel`을 사용하세요.',
    ],
    schemas: [
      '- 테마·색상 스킴 변경: {"action":"update_theme","title":"설명","colorSchemeName":"dark","colorScheme":{"bgcolor":"#14161c"},"textThemeName":"standard","customTextTheme":{"FontColorStandard":"#e6e8ef"},"customCSS":""}',
      '- 채팅 HUD 패널 표시/닫기: {"action":"set_chat_panel","title":"상태 HUD","html":"<div class=\\"hud\\">HP {{getvar::hp}}</div>"} (닫기: {"action":"set_chat_panel","title":"HUD 닫기","clear":true})',
    ],
    rawDelimiters: false,
  },
  {
    id: 'assets_repair',
    label: '에셋·수리',
    summary: '에셋/인레이 등록·이름수정(register_asset) 및 캐릭터순서·고아로어·chat.id 일괄수리(repair_workspace)',
    requiresCapabilities: [],
    actions: ['register_asset', 'repair_workspace'],
    tools: ['inspect_assets', 'audit_workspace', 'host_info'],
    maxChars: 2400,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /additionalAssets|emotionImages|에셋.{0,24}(?:등록|추가|저장|연결|바인딩|이름|오타|수리|교체|변경|목록|확인|검사|누락|깨진)|이미지\s*(?:에셋|누락|깨진|등록|연결)|표정\s*이미지|svg\s*(?:등록|배지|아이콘|에셋)|인레이|inlay|saveAsset|createInlay|register_asset|캐릭터\s*(?:순서|정렬)\s*(?:복구|정리|수리)|checkCharOrder|워크스페이스\s*(?:수리|복구|정비|건강\s*검진)|건강\s*검진|고아\s*(?:로어북|로어|폴더)|깨진\s*(?:정규식|폴더|에셋|링크)|chat\.id\s*(?:복구|수리|부여)|repair_workspace/i,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['assets_repair'],
    rules: [
      'SVG/텍스트 에셋 등록·기존 에셋 연결·오타 이름 변경·원본 RisuAI 인레이 등록에는 `register_asset`을, 캐릭터 순서 복구(`checkCharOrder`)·고아 로어북·누락 chat.id·깨진 정규식 플래그 일괄 수리에는 `repair_workspace`를 사용하세요.',
    ],
    schemas: [
      '- 에셋·인레이 등록/수정: {"action":"register_asset","title":"설명","mode":"character_asset|module_asset|inlay|bind_asset|rename_asset","name":"badge","content":"<svg ...>...</svg>","ext":"svg","targetField":"additionalAssets"}',
      '- 워크스페이스 일괄 수리: {"action":"repair_workspace","title":"워크스페이스 수리","checkCharOrder":true,"fixOrphanLore":true,"fixMissingChatIds":true,"fixRegexFlags":true}',
    ],
    rawDelimiters: false,
  },
  {
    id: 'chat_advanced',
    label: '메시지·메모리·폴더',
    summary: '채팅 메시지 편집·비활성·북마크·삭제(manage_chat_messages), Hypa/Supa 메모리(update_memory), 채팅 폴더(organize_chat_folders)',
    requiresCapabilities: [],
    actions: ['manage_chat_messages', 'update_memory', 'organize_chat_folders'],
    tools: ['read_chat', 'read_item', 'list_items'],
    maxChars: 2800,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /메시지.{0,20}(?:삭제|지워|비활성|숨김|숨기|북마크|편집|수정)|말풍선.{0,20}(?:삭제|비활성|숨기|북마크|편집|수정)|대화\s*(?:삭제|지워|숨김|비활성|북마크)|북마크|고정\s*메시지|manage_chat_messages|hypa|하이파|supa|수파|메모리.{0,12}(?:요약|수정|편집|중요|추가|삭제|확인|청크)|요약\s*메모리|장기\s*기억|기억\s*요약|update_memory|채팅\s*(?:폴더|분류)|chatFolders|organize_chat_folders/i,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['chat_advanced'],
    rules: [
      '특정 채팅 메시지 편집·비활성화·북마크·삭제에는 `manage_chat_messages`를, HypaV3/HypaV2/Supa 메모리 요약 편집에는 `update_memory`를, 채팅 폴더 생성·이동·삭제에는 `organize_chat_folders`를 사용하세요.',
    ],
    schemas: [
      '- 채팅 메시지 관리: {"action":"manage_chat_messages","title":"설명","operation":"edit|toggle_disabled|bookmark|delete","messageIndex":0,"content":"수정 본문","disabled":true,"bookmarked":true}',
      '- 메모리 요약 수정: {"action":"update_memory","title":"설명","memoryType":"supa|hypaV3|hypaV2","operation":"set|add|edit|remove","summaryIndex":0,"text":"요약 본문","isImportant":true}',
      '- 채팅 폴더 정리: {"action":"organize_chat_folders","title":"설명","operation":"create_folder|rename_folder|delete_folder|move_chats|toggle_fold","folderName":"1부 아크","chatIndices":[0,1],"moveToRoot":false}',
    ],
    rawDelimiters: false,
  },
  {
    id: 'group_onboarding',
    label: '그룹챗·온보딩',
    summary: '그룹챗 멤버·발언비율·규칙 편집(update_group_chat) 및 캐릭터 온보딩 폼 설정(update_onboarding)',
    requiresCapabilities: [],
    actions: ['update_group_chat', 'update_onboarding'],
    tools: ['read_item', 'list_items'],
    maxChars: 2200,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /그룹\s*챗|그룹\s*채팅|단체\s*(?:채팅|방)|다인\s*챗|합방|그룹\s*(?:멤버|설정|발언|비율|순서|오토)|발언\s*(?:비율|순서|확률)|끼어들기|오토\s*모드|talkativeness|orderByOrder|update_group_chat|온보딩|onboarding|시작\s*(?:설문|폼|질문|입력\s*폼|설정\s*창)|초기\s*(?:설정\s*폼|질문)|update_onboarding/i,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['group_onboarding'],
    rules: [
      '그룹챗(`type: "group"`) 멤버 활성·발언 비율·순차 발언 설정에는 `update_group_chat`을, 캐릭터 시작 온보딩 입력 폼 구성에는 `update_onboarding`을 사용하세요.',
    ],
    schemas: [
      '- 그룹챗 설정: {"action":"update_group_chat","title":"설명","orderByOrder":true,"useCharacterLore":true,"setMemberActive":{"0":true},"setMemberTalk":{"0":0.8},"addMembers":[],"removeMembers":[]}',
      '- 캐릭터 온보딩 폼: {"action":"update_onboarding","title":"시작 설정","enabled":true,"description":"안내","fields":[{"id":"hero_name","label":"이름","type":"text","defaultValue":"유저","varName":"hero_name"}]}',
    ],
    rawDelimiters: false,
  },
  {
    id: 'extensions',
    label: '상주 확장',
    summary: '선언형 전역 스크립트·치환·응답감시·요청본문 패치·읽기전용 MCP·TTS·채널 확장(manage_extensions)',
    requiresCapabilities: [],
    actions: ['manage_extensions'],
    tools: ['read_item', 'list_items', 'host_info'],
    maxChars: 2600,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /상주\s*(?:확장|규칙)|확장\s*규칙|전역\s*(?:스크립트\s*핸들러|정규식)|script_handler|전역\s*치환|replacer|응답\s*(?:후\s*)?감시|자동\s*감시|chat_listener|요청\s*(?:본문\s*패치|가로채|변조)|인터셉터|body_intercepter|mcp\s*(?:서버|도구|노출)|mcp_server|tts\s*(?:전처리|후처리|정리|필터|규칙)|음성\s*(?:전처리|후처리|필터)|tts_processor|플러그인\s*채널|plugin_channel|manage_extensions/i,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['extensions'],
    rules: [
      '전역 정규식 핸들러·치환·응답 점검 감시·요청 본문 JSON 패치·읽기 전용 MCP 노출·TTS 정리·플러그인 채널 규칙은 `manage_extensions` 선언형 JSON 규칙으로만 제안하세요(임의 JS 코드 금지).',
    ],
    schemas: [
      '- 상주 확장 추가/수정: {"action":"manage_extensions","title":"설명","operation":"upsert","rule":{"type":"script_handler|replacer|chat_listener|body_intercepter|mcp_server|tts_processor|plugin_channel","name":"규칙명","enabled":true}}',
      '- 상주 확장 켜기/끄기/삭제: {"action":"manage_extensions","title":"설명","operation":"toggle|remove","ruleId":"ext_...","enabled":false}',
    ],
    rawDelimiters: false,
  },
  {
    id: 'bard_wiki',
    label: 'BardWiki',
    summary: 'RisuBard 전용 BardWiki 서사 문서 저장·등급·컨텍스트 모드·휴지통 관리(manage_bard_wiki)',
    requiresCapabilities: ['bardWiki'],
    actions: ['manage_bard_wiki'],
    tools: ['read_bard_wiki', 'host_info'],
    maxChars: 2000,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /바드\s*위키|리스바드\s*위키|risubard\s*위키|bard\s*wiki|bardWiki|서사\s*위키|위키\s*(?:문서|등급|컨텍스트|휴지통|등록|추가|저장|수정|조회|검색|정리|삭제)|manage_bard_wiki/i,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['bard_wiki'],
    rules: [
      'RisuBard 환경에서는 `read_bard_wiki`로 현재 스코프 문서를 확인하고 `manage_bard_wiki`로 저장·등급·문서별 컨텍스트 모드·휴지통 이동을 제안하세요.',
    ],
    schemas: [
      '- BardWiki 문서 관리: {"action":"manage_bard_wiki","operation":"save_document|set_grade|set_context_mode|trash_document","documentId":"doc-1","type":"location|character|event|other","title":"문서명","markdown":"내용","grade":7,"contextMode":"auto|always|never"}',
    ],
    rawDelimiters: false,
  },
  {
    id: 'risunest_native',
    label: 'RisuNest 패치',
    summary: 'RisuNest 전용 대화 메시지·변수 정밀 패치(patch_risunest_conversation) 및 호스트 툴 조회',
    requiresCapabilities: ['risunestPatch'],
    actions: ['patch_risunest_conversation'],
    tools: ['inspect_host_tools', 'list_items', 'read_chat', 'host_info'],
    maxChars: 2000,
    triggers: {
      screens: [],
      targetKinds: [],
      keywords: /리스\s*네스트|risunest|네이티브\s*패치|원자\s*패치|대화\s*정밀\s*패치|risunestPatch|patch_risunest_conversation|호스트\s*(?:툴|도구)/i,
      contextKeys: [],
      freeTalkSchemaBaseline: false,
    },
    knowledge: ['risunest_native'],
    rules: [
      'RisuNest 대화의 메시지·채팅 변수를 네이티브 원자 패치 API로 직접 수정할 때 `patch_risunest_conversation`을 사용하세요.',
    ],
    schemas: [
      '- RisuNest 대화 정밀 패치: {"action":"patch_risunest_conversation","title":"설명","conversationId":"conv-1","messages":[{"index":0,"set":{"data":"수정 본문"}}],"chatVariables":[{"key":"hp","value":90}]}',
    ],
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

const EXPLICIT_CHAR_CATALOG_RE =
  /포팅|다른\s*(?:캐릭터|봇)|타\s*(?:캐릭터|봇)|(?:캐릭터|봇)\s*목록|교차\s*포팅|port_from_character/i;
const NAMED_CHAR_QUOTED_RE = /(?:이?라는|이?란)\s*(?:캐릭터|봇)/;
const NAMED_CHAR_SOURCE_RE =
  /([가-힣A-Za-z0-9_"'`」』]+)\s*(?:캐릭터|봇)(?:에서|에\s*있는|에\s*들어|의\s*(?:로어북|정규식|루아|lua|스크립트|설정|카드|정보)|쪽)/gi;
const CURRENT_CHAR_PREFIX_RE =
  /^(?:이|현재|지금|해당|열린|열려있는|있는|선택된|켜진|활성|내|우리|새|신규|기존|본|원래|메인|같은|이쪽|여기|그룹|그룹챗|플레이어|유저|사용자|첫|두|세|네|각|모든|전체|위|아래)$/;
const NON_CHAR_RESOURCE_PREFIX_RE =
  /^(?:로어북|정규식|에셋|변수|채팅|모듈|페르소나|프롬프트|설정|스크립트|태그|메시지|대화|내용|항목|필드|트리거|코드|노트|요약)(?:을|를|은|는|이|가|도|만|에서|으로|로)?$/;

/**
 * Returns true when user text references another character/bot or asks for cross-character
 * lookup/porting, while avoiding false positives on current-character editing phrases.
 */
function wantsCharacterCatalog(text = '') {
  const s = String(text ?? '');
  if (!s.trim()) return false;
  if (EXPLICIT_CHAR_CATALOG_RE.test(s)) return true;
  if (NAMED_CHAR_QUOTED_RE.test(s)) return true;
  for (const m of s.matchAll(NAMED_CHAR_SOURCE_RE)) {
    const rawPrefix = String(m[1] || '').replace(/^["'`「『]+|["'`」』]+$/g, '');
    if (!rawPrefix) continue;
    if (CURRENT_CHAR_PREFIX_RE.test(rawPrefix)) continue;
    if (NON_CHAR_RESOURCE_PREFIX_RE.test(rawPrefix)) continue;
    if (rawPrefix.length >= 3 && /(?:을|를|에서|으로|에게|한테|부터|까지)$/.test(rawPrefix)) continue;
    return true;
  }
  return false;
}

/**
 * Extracts skill IDs for any proposals emitted or L2 skills dynamically loaded in the immediately
 * preceding assistant message so follow-up turns keep those skills and contexts active.
 */
function extractRecentAssistantSkillIds(history = []) {
  const ids = new Set();
  if (!Array.isArray(history) || history.length === 0) return ids;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant') continue;
    if (Array.isArray(msg.loopMeta?.loadedSkillIds)) {
      for (const sid of msg.loopMeta.loadedSkillIds) {
        if (sid && SKILL_BY_ID.has(sid) && sid !== 'core_text' && sid !== 'chat_input') {
          ids.add(sid);
        }
      }
    }
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

const SKILL_CATALOG_QUERY_RE = /^(?:list|catalog|all|\*|목록|전체|스킬\s*목록)$/i;

/**
 * Searches supported built-in skills by natural-language Korean/English keyword, label, action name,
 * or tool name so models can discover skills even when they don't know exact internal IDs.
 */
function findMatchingSkills(query = '', capabilities = null, maxResults = 4) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const tokens = lower.split(/[\s,./·|]+/).map(t => t.trim()).filter(t => t.length >= 2);
  const scored = [];

  for (const def of SKILL_DEFS) {
    if (!isSkillSupported(def, capabilities)) continue;
    let score = 0;
    const idLower = def.id.toLowerCase();
    const labelLower = String(def.label || '').toLowerCase();
    const summaryLower = String(def.summary || '').toLowerCase();
    const actionsLower = (def.actions || []).map(a => a.toLowerCase());
    const toolsLower = (def.tools || []).map(t => t.toLowerCase());

    if (idLower === lower || labelLower === lower) score += 20;
    else if (labelLower.includes(lower) || idLower.includes(lower)) score += 10;
    if (summaryLower.includes(lower)) score += 7;
    if (actionsLower.some(a => a === lower || a.includes(lower))) score += 10;
    if (toolsLower.some(t => t === lower || t.includes(lower))) score += 6;
    if (def.triggers?.keywords?.test(q)) score += 9;
    if (typeof def.triggers?.match === 'function' && def.triggers.match(q)) score += 9;

    if (tokens.length > 0) {
      const hay = `${idLower} ${labelLower} ${summaryLower} ${actionsLower.join(' ')} ${toolsLower.join(' ')}`;
      for (const tok of tokens) {
        if (hay.includes(tok)) score += 3;
        else if (def.triggers?.keywords?.test(tok)) score += 3;
      }
    }

    if (score > 0) scored.push({ def, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, maxResults)).map(x => x.def);
}

function resolveDirectSkillId(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  if (SKILL_BY_ID.has(trimmed)) return trimmed;
  const snake = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  if (SKILL_BY_ID.has(snake)) return snake;
  if (SKILL_ID_BY_ACTION.has(trimmed)) return SKILL_ID_BY_ACTION.get(trimmed);
  if (SKILL_ID_BY_ACTION.has(snake)) return SKILL_ID_BY_ACTION.get(snake);
  return null;
}

/**
 * L2 dynamic skill loader used by the Read-Only `load_skill` tool inside the 3-call loop.
 * Supports exact skill IDs, action names, Korean/English keyword/query discovery, and catalog listing.
 */
function loadSkillPack(skillIds = [], capabilities = null, options = {}) {
  const requested = Array.isArray(skillIds) ? skillIds : (skillIds ? [skillIds] : []);
  const query = String(options?.query ?? '').trim();
  const loaded = [];
  const unknown = [];
  const unsupported = [];
  const knowledgeKeys = new Set();
  const rules = [];
  const schemas = [];
  const tools = new Set();

  const addSkill = (def) => {
    if (!def) return;
    if (!isSkillSupported(def, capabilities)) {
      if (!unsupported.includes(def.id)) unsupported.push(def.id);
      return;
    }
    if (!loaded.includes(def.id)) {
      loaded.push(def.id);
      for (const k of def.knowledge || []) knowledgeKeys.add(k);
      for (const r of def.rules || []) rules.push(r);
      for (const s of def.schemas || []) schemas.push(s);
      for (const t of def.tools || []) tools.add(t);
    }
  };

  let wantsCatalog = false;
  for (const rawId of requested) {
    const id = String(rawId ?? '').trim();
    if (!id) continue;
    if (SKILL_CATALOG_QUERY_RE.test(id)) {
      wantsCatalog = true;
      continue;
    }
    const directId = resolveDirectSkillId(id);
    if (directId) {
      addSkill(SKILL_BY_ID.get(directId));
      continue;
    }
    // Try fuzzy keyword/label discovery across supported skills
    const matches = findMatchingSkills(id, capabilities, 3);
    if (matches.length > 0) {
      for (const def of matches) addSkill(def);
    } else {
      unknown.push(id);
    }
  }

  if (query) {
    if (SKILL_CATALOG_QUERY_RE.test(query)) {
      wantsCatalog = true;
    } else {
      const directId = resolveDirectSkillId(query);
      if (directId) {
        addSkill(SKILL_BY_ID.get(directId));
      } else {
        const matches = findMatchingSkills(query, capabilities, 4);
        if (matches.length > 0) {
          for (const def of matches) addSkill(def);
        } else {
          unknown.push(query);
        }
      }
    }
  }

  // Empty load_skill({}) acts as a read-only catalog discovery call
  if (requested.filter(v => String(v ?? '').trim()).length === 0 && !query) {
    wantsCatalog = true;
  }

  const sections = [];
  const knowledgeText = [...knowledgeKeys].map(k => KNOWLEDGE_SECTIONS[k]).filter(Boolean).join('\n\n');
  if (knowledgeText) sections.push(`[불러온 내장 스킬 지식]\n${knowledgeText}`);
  if (rules.length > 0) sections.push(`[규칙]\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
  if (schemas.length > 0) sections.push(`[지원 action 스키마]\n${schemas.join('\n')}`);
  if (tools.size > 0) sections.push(`[권장 읽기 도구]\n${[...tools].join(', ')}`);

  let availableSkills;
  if (wantsCatalog || (loaded.length === 0 && unknown.length > 0)) {
    availableSkills = getSkillCatalog(capabilities, []);
    if (wantsCatalog) {
      const catalogLines = availableSkills.map(s =>
        `- ${s.id} (${s.label}): ${s.summary}` +
        (s.actions.length ? ` [actions: ${s.actions.join(', ')}]` : '') +
        (s.tools.length ? ` [tools: ${s.tools.join(', ')}]` : '')
      );
      sections.push(`[사용 가능한 내장 스킬 목록]\n${catalogLines.join('\n')}`);
    }
  }

  return {
    ok: loaded.length > 0 || wantsCatalog,
    loaded,
    unknown,
    unsupported,
    ...(wantsCatalog ? { catalogListed: true } : {}),
    ...(availableSkills ? { availableSkills } : {}),
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
    if (typeof tr.match === 'function') {
      const matchText = tr.currentTurnOnly ? String(userInput ?? '') : text;
      if (tr.match(matchText)) {
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
  findMatchingSkills,
  loadSkillPack,
  collectRoutingText,
  extractRecentAssistantSkillIds,
  wantsCharacterCatalog,
  selectSkills,
  buildSkillPromptSections,
};
