// Built-in RisuAI & fork knowledge base grounded in kwaroran/Risuai source code.

const KNOWLEDGE_SECTIONS = {
  core: `[RisuAI 기본 구조]
- RisuAI는 캐릭터 카드(CCv2/CCv3), 로어북, 모듈(.risum), 페르소나, 정규식, Lua 트리거 스크립트, 프롬프트 템플릿을 조합해 LLM에 요청하는 롤플레이 클라이언트입니다.
- 주요 공개 포크: 원본(kwaroran/Risuai), PocketRisu(셀프호스팅), RisuBard(PocketRisu 기반 + BardWiki 서사 메모리), HaejeokRisuai(해적리스, 메모리/도메인 스토어 최적화), RisuNest(네이티브 앱).`,

  character: `[캐릭터 설정 필드 가이드]
- desc (설명): 캐릭터의 핵심 외형·성격·세계관·관계·말투를 담는 메인 프롬프트. personality/scenario 필드는 구버전 호환용으로 비워 두고 desc에 통합하는 것이 권장됩니다.
- firstMessage (첫 메시지) / alternateGreetings (추가 첫 메시지): 대화 시작 시 AI가 보내는 첫 출력. 문체와 서술 시점(1인칭/3인칭)을 결정합니다.
- systemPrompt (시스템 프롬프트): 비어 있지 않으면 전역 메인 프롬프트를 대체합니다.
- replaceGlobalNote (글로벌 노트 덮어쓰기): 비어 있지 않으면 전역 UJB/글로벌 노트를 대체합니다.
- backgroundHTML (백그라운드 임베딩): 채팅 배경에 삽입되는 HTML/CSS/마크다운. {{bg::에셋명}}, {{audio::에셋명}} 등을 사용할 수 있습니다.
- chat.note (작가의 노트): 현재 채팅 세션에만 주입되는 방향성·문체·전개 지시 메모입니다.
- creatorNotes (제작자 코멘트): 프롬프트에 직접 들어가지 않는 제작자 안내 메모입니다.`,

  lorebook: `[로어북 (Lorebook) 가이드]
- 3가지 스코프: (1) 캐릭터 로어북(char.globalLore), (2) 현재 채팅 로컬 로어북(chat.localLore), (3) 모듈 로어북(db.modules[i].lorebook).
- 주요 필드:
  - comment: 목록에 표시되는 항목 이름
  - key: 활성화 키워드 (쉼표로 구분). 채팅 최근 메시지(scanDepth)에서 매칭되면 프롬프트에 삽입.
  - secondkey + selective(true): 보조 키. 1차 키와 2차 키가 모두 매칭되어야 활성화.
  - alwaysActive(true): 키워드 없이 항상 활성화.
  - insertorder(숫자, 기본 100): 높을수록 우선순위가 높아 토큰 예산(loreBookToken) 안에서 먼저 채택되고 프롬프트 하단에 가깝게 배치.
  - useRegex(true): 활성화 키를 정규식으로 매칭.
  - activationPercent: 0~100 확률 활성화.
  - mode: 'normal' | 'constant' | 'multiple' | 'child' | 'folder' (폴더는 key가 '\\uf000folder:<uuid>').
- 주요 데코레이터(본문 최상단 줄에 기재):
  - @@depth N: 채팅 끝에서 N번째 위치에 삽입
  - @@role user|assistant|system: 삽입 메시지 역할 지정
  - @@dont_activate: 자동 활성화 차단 / @@activate: 강제 활성화
  - @@activate_only_after N / @@activate_only_every N: 턴 조건 제어
  - @@position pt_name: 특정 프롬프트 위치 지정
  - @@disable_ui_prompt / @@inject_at ...`,

  lua: `[RisuAI Lua 트리거 스크립트 가이드]
- 저장 구조: char.triggerscript (또는 module.trigger) = [{ comment: "", type: "start", conditions: [], effect: [{ type: "triggerlua", code: "<Lua 코드>" }] }].
- 주요 진입점(이벤트 훅):
  - function onStart(triggerId) ... end  -- 트리거 시작/수동 실행
  - function onInput(triggerId) ... end  -- 유저 입력 시
  - function onOutput(triggerId) ... end -- AI 출력 직후
  - function onButtonClick(triggerId, code) ... end -- {{button::표시명::코드}} 또는 risu-trigger 클릭 시
  - listenEdit("editDisplay"|"editInput"|"editOutput"|"editProcess", function(triggerId, data) return data end)
- 주요 내장 Lua API (첫 인자 triggerId 전달):
  - 상태 변수: getChatVar(id, key), setChatVar(id, key, val), getGlobalVar(id, key)
  - 채팅 조작: getChat(id, idx), setChat(id, idx, text), getChatRole(id, idx), setChatRole(id, idx, role), getChatLength(id), getFullChat(id), setFullChat(id, tbl), addChat(id, role, text), insertChat(id, idx, role, text), removeChat(id, idx), cutChat(id, start, end), getCharacterLastMessage(id), getUserLastMessage(id)
  - 캐릭터/페르소나: getName(id), setName(id, name), getDescription(id), setDescription(id, desc), getCharacterFirstMessage(id), setCharacterFirstMessage(id, text), getPersonaName(id), getPersonaDescription(id), getAuthorsNote(id), getBackgroundEmbedding(id), setBackgroundEmbedding(id, html)
  - 로어북: getLoreBooks(id, search), upsertLocalLoreBook(id, name, content, options), loadLoreBooks(id, reserveTokens)
  - LLM/유틸: LLM(id, messages, multimodal, opts), axLLM(id, messages, multimodal, opts), simpleLLM(id, prompt), cbs(text), getTokens(id, text), sleep(id, ms), reloadDisplay(id), reloadChat(id, idx), stopChat(id), log(msg)
  - UI 알림: alertNormal(id, msg), alertError(id, msg), alertInput(id, msg, def), alertSelect(id, opts), alertConfirm(id, msg)
- 주의: Lua 인덱스는 1-based이지만 RisuAI 채팅 인덱스(getChat/setChat)는 0-based(또는 음수 -1이 마지막 메시지)인 API가 있으므로 경계 확인이 중요합니다.`,

  regex: `[RisuAI 정규식 스크립트 (customscript) 가이드]
- 필드: comment(이름), in(정규식 패턴, 양쪽 슬래시 없이 작성), out(치환 문자열), type, flag(정규식 플래그 예: 'g', 'gi', 'gm'), ableFlag(플래그 커스텀 활성화 여부).
- type 종류:
  - editinput: 유저 입력문 수정
  - editoutput: AI 출력문 영구 수정
  - editprocess: LLM 요청 전송 직전 리퀘스트 데이터 수정
  - editdisplay: 저장 데이터는 유지하고 화면 표시만 수정 (HTML/CSS 상태창 렌더링에 가장 많이 사용)
- out 특수 치환자: $&(전체 매치), $1/$2(캡처 그룹), $$(리터럴 $), @@emo <감정명>(감정 이미지 고정).`,

  cbs: `[CBS (Curly Braced Syntax) 핵심 문법]
- 기본 치환: {{char}}, {{user}}, {{persona}}, {{description}}, {{lastmessage}}, {{chat_index}}
- 변수: {{getvar::key}}, {{setvar::key::val}}, {{addvar::key::1}}, {{getglobalvar::key}}
- 조건/분기: {{#if {{? {{getvar::hp}}<=0}}}}...{{/if}}, {{#when::...}}...{{/when}}
- 랜덤/버튼/에셋: {{random::A::B::C}}, {{button::표시텍스트::트리거이름}}, {{img::에셋명}}, {{bg::에셋명}}, {{audio::에셋명}}
- 주석: {{// 프롬프트에 포함되지 않는 주석 }}`,

  persona: `[페르소나 (Persona) 가이드]
- db.personas 배열에 { name, personaPrompt, icon, note, id, largePortrait, embeddedModule } 형태로 저장되며, db.selectedPersona가 현재 선택된 전역 페르소나 인덱스입니다.
- 특정 채팅에 페르소나를 고정하려면 chat.bindedPersona = persona.id 를 설정합니다.
- 포크별 차이:
  - HaejeokRisuai(해적리스), RisuNest: db.personas/selectedPersona 수정 시 현재 화면과 채팅에 즉시 반영됩니다.
  - 원본 RisuAI, PocketRisu, RisuBard: 전역 미바인딩 페르소나는 별도 미러 필드(username/personaPrompt/userNote)를 읽으므로, 새 페르소나 생성 후 선택하거나 현재 채팅에 bindedPersona로 바인딩해야 즉시 반영됩니다.`,

  config: `[RisuAI 컨피그 / 설정 가이드]
- 플러그인 v3가 직접 읽고 수정할 수 있는 주요 설정(allowedDbKeys):
  - temperature: 생성 다양성/창의성 (보통 0.6~1.2, 높을수록 자유롭고 낮을수록 일관적; RisuAI 내부에서는 0~200 정수 스케일 또는 모델별 실수 스케일로 저장될 수 있으므로 현재 저장된 값을 먼저 확인하고 같은 스케일로 수정!)
  - maxContext: 모델에 보낼 최대 컨텍스트 토큰 수
  - maxResponse: AI 한 번의 응답 최대 출력 토큰 수
  - frequencyPenalty / PresensePenalty: 반복 억제 페널티 (RisuAI 원본 키 철자가 'PresensePenalty'임에 주의)
  - theme / textTheme / colorSchemeName / lineHeight: UI 테마 및 가독성
  - customCSS / guiHTML: 화면 커스텀 CSS 및 GUI HTML (문제 발생 시 Ctrl+. 로 Custom CSS 토글)
  - enabledModules / moduleIntergration: 전역 활성화 모듈 ID 목록 및 모듈 통합 문자열
  - seperateModels / seperateModelsForAxModels: 보조 작업별 별도 모델 설정
- 플러그인이 보안상 직접 접근할 수 없는 설정(사용자가 RisuAI 설정 메뉴에서 직접 변경해야 함): API 키, 메인 모델 선택(aiModel), 프롬프트 템플릿 순서(formatingOrder), 로어북 기본 스캔 깊이/예산(loreBookDepth/loreBookToken — 단 캐릭터별 char.loreSettings는 수정 가능).`,
};

function buildKnowledgeForContext(context) {
  const keys = new Set(['core']);
  const screen = context?.screen || 'unknown';
  const kind = context?.targetKind || 'general';

  if (screen === 'character' || kind === 'char_field') {
    keys.add('character');
    keys.add('cbs');
  }
  if (screen === 'lorebook' || kind.includes('lorebook')) {
    keys.add('lorebook');
    keys.add('cbs');
  }
  if (screen === 'scripts' || kind.includes('lua') || kind.includes('regex')) {
    keys.add('lua');
    keys.add('regex');
    keys.add('cbs');
  }
  if (screen === 'persona' || kind === 'persona') {
    keys.add('persona');
    keys.add('cbs');
  }
  if (screen === 'module' || kind.startsWith('module_')) {
    keys.add('lorebook');
    keys.add('lua');
    keys.add('regex');
    keys.add('cbs');
  }
  if (screen === 'settings' || kind === 'config') {
    keys.add('config');
  }
  if (screen === 'chat' || screen === 'unknown' || kind === 'general' || kind === 'chat_message') {
    keys.add('character');
    keys.add('lorebook');
    keys.add('config');
    keys.add('cbs');
  }

  return [...keys].map(k => KNOWLEDGE_SECTIONS[k]).join('\n\n');
}

function getQuickPromptsForContext(context) {
  const kind = context?.targetKind || 'general';
  const screen = context?.screen || 'unknown';

  if (kind === 'char_lua' || kind === 'module_lua') {
    return [
      { label: 'Lua 디버깅', prompt: '현재 Lua 트리거 스크립트에서 버그나 RisuAI API 오용이 있는지 점검하고 수정안을 제안해 줘.' },
      { label: '새 기능 추가', prompt: '현재 Lua 스크립트에 상태 변수나 버튼 트리거 기능을 추가하고 싶어. 어떤 구조가 좋을지 설명하고 수정안을 만들어 줘.' },
      { label: 'Lua API 가이드', prompt: 'RisuAI Lua 트리거에서 자주 쓰는 API와 onInput/onOutput/onButtonClick 사용법을 예시와 함께 알려 줘.' },
    ];
  }
  if (kind === 'char_regex' || kind === 'module_regex') {
    return [
      { label: '정규식 점검', prompt: '현재 정규식 스크립트의 IN 패턴과 OUT 치환이 의도대로 동작할지 검증하고 개선안을 제안해 줘.' },
      { label: '새 정규식 생성', prompt: '채팅 출력에서 특정 태그를 깔끔한 상태창 HTML로 바꾸는 editdisplay 정규식을 새로 만들어 줘.' },
      { label: '정규식 사용법', prompt: 'editinput, editoutput, editprocess, editdisplay의 차이와 안전한 작성 요령을 알려 줘.' },
    ];
  }
  if (kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook' || screen === 'lorebook') {
    return [
      { label: '현재 로어북 다듬기', prompt: '현재 선택된 로어북 항목의 키워드, 배치 순서, 본문을 토큰 효율적이고 명확하게 다듬는 수정안을 제안해 줘.' },
      { label: '새 로어북 생성', prompt: '현재 캐릭터 세계관에 어울리는 새 로어북 항목 초안을 제안해 줘.' },
      { label: '로어북 사용법', prompt: '로어북 활성화 키, 2차 키(selective), insertorder, @@depth 같은 데코레이터 사용법을 알려 줘.' },
    ];
  }
  if (kind === 'persona' || screen === 'persona') {
    return [
      { label: '현재 페르소나 다듬기', prompt: '현재 페르소나의 프롬프트가 캐릭터와 자연스럽게 상호작용하도록 다듬는 수정안을 제안해 줘.' },
      { label: '새 페르소나 생성', prompt: '현재 캐릭터의 세계관에 잘 어울리는 새 페르소나를 만들어 줘.' },
      { label: '페르소나/바인딩 안내', prompt: '페르소나 작성 팁과 채팅별 페르소나 바인딩(bindedPersona) 활용법을 알려 줘.' },
    ];
  }
  if (kind === 'config' || screen === 'settings') {
    return [
      { label: '내 설정 진단', prompt: '현재 읽어온 내 RisuAI 설정값(temperature, maxContext, maxResponse, 페널티, 모듈 등)을 보고 개선할 점이 있는지 진단해 줘.' },
      { label: '설정 의미 설명', prompt: 'temperature, maxContext, maxResponse, frequencyPenalty, PresensePenalty가 실제 출력에 어떤 영향을 주는지 쉽게 설명해 줘.' },
      { label: 'Custom CSS 수정', prompt: '현재 Custom CSS를 확인하고 가독성을 높이는 수정안을 제안해 줘.' },
    ];
  }
  if (kind === 'char_field' || screen === 'character') {
    return [
      { label: '현재 필드 다듬기', prompt: '현재 선택된 캐릭터 필드의 문장과 구조를 더 선명하고 토큰 효율적으로 다듬는 부분 수정안을 제안해 줘.' },
      { label: '전체 재작성', prompt: '현재 캐릭터 설정을 바탕으로 이 필드를 더 몰입감 있게 새로 작성한 덮어쓰기 안을 제안해 줘.' },
      { label: 'CBS/필드 가이드', prompt: '이 필드가 프롬프트에서 어떤 역할을 하고, {{char}}/{{user}} 같은 CBS를 어떻게 쓰면 좋은지 알려 줘.' },
    ];
  }

  return [
    { label: '현재 화면 사용법', prompt: '지금 내가 보고 있는 RisuAI 화면과 주요 기능 사용법을 알기 쉽게 설명해 줘.' },
    { label: '내 설정 진단', prompt: '현재 RisuAI 설정과 활성화된 캐릭터/로어북 구성을 간단히 점검해 줘.' },
    { label: '새 로어북 만들기', prompt: '현재 캐릭터에 추가할 새 로어북 항목을 함께 만들어 줘.' },
  ];
}

export { buildKnowledgeForContext, getQuickPromptsForContext };
