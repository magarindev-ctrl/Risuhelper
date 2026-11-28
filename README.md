# RisuHelper

RisuAI 및 공개 포크(`PocketRisu`, `RisuBard`, `HaejeokRisuai`, `RisuNest`, `RisuAI-Hardened`)의 대부분의 화면에서 **현재 커서가 위치한 입력 영역과 화면 문맥을 인식**하여 LLM과 대화하면서 **사용법 질문, 컨피그 진단, 설명/로어북/Lua/정규식/페르소나/모듈의 부분 편집·덮어쓰기·새로 생성**을 수행할 수 있는 **Plugin API v3** 플러그인입니다.

## 핵심 특징

- **화면 · 커서 자동 감지 (`mainDom` 우회 아키텍처)**
  - Plugin v3 샌드박스(`SafeElement`)에서 허용되는 `pointerup`/`click`/`keyup` 이벤트와 `querySelector(':focus')`·`getBoundingClientRect()`를 조합해 사용자가 마지막으로 커서를 둔 화면·필드·로어북/정규식 항목(`data-risu-idx`)을 정확하게 자동 추적합니다 (`PocketRisu` 2중 래퍼 `TextAreaInput` 및 bits-ui 환경 완전 대응).
  - 화면의 플로팅 버튼(`⋮⋮ ✨ ...`)은 마우스·터치 드래그로 자유롭게 이동할 수 있으며, 600ms 길게 누르기 자리 순환 및 설정 내 6방향 원클릭 이동을 지원합니다.
  - 필드 라벨은 **전체 일치**로만 판정합니다. `캐릭터 설명 Prefix`(전역 설정)처럼 키워드가 일부만 들어간 라벨, 목록 검색창, 알 수 없는 입력칸은 편집 대상으로 추측하지 않고 "대상 없음"으로 둡니다. 로어북의 캐릭터/챗 탭은 가장 가까운 활성 탭으로 구분하며, PocketRisu의 설정 항목은 `data-setting-id`로 판정합니다.
  - 제안이 가리키는 인덱스·ID(모듈, 페르소나, 정규식 번호, 활성화할 모듈 ID 등)는 쓰기 전에 실제로 존재하는지 한 곳에서 검사하며, 없으면 다른 항목으로 넘기지 않고 거부합니다. 스키마에 없는 속성이 제안에 들어 있으면 카드에 "지원하지 않는 속성"으로 표시합니다.
  - 여러 모듈이 설치된 상태에서 열려 있는 모듈을 특정하지 못하거나 내용이 같은 모듈이 둘 이상이면, 첫 번째 모듈로 넘겨짚지 않고 모듈 선택기에서 직접 고를 때까지 적용을 막습니다.
  - 채팅 화면 우측 상단의 고정 `✨` 버튼(`location: 'action'`)은 화면을 가리지 않도록 등록하지 않습니다. 드래그 가능한 플로팅 버튼(`⋮⋮ ✨ ...`, 설정에서 완전히 끌 수 있음), 햄버거 메뉴, 설정 메뉴로 깔끔하게 열 수 있습니다.
  - `mainDom` 권한을 거부하더라도 상단 **수동 대상 선택기**로 모든 편집/질문 기능을 그대로 사용할 수 있습니다.
- **PC 오른쪽 상시 도킹(분할 화면 · 사용자 선택) & 웹 · 모바일 반응형 UI**
  - 상단 바를 **`☰` 메뉴 · `설정` · `대화 비우기` · `닫기`**와 **대상 선택기(`📍 자동감지: ...`)** 2줄로 최소화해 채팅 공간을 최대한 확보합니다. 프리셋, 오른쪽 도킹, 넓게/좁게, 커서 재감지, 전송 모드, 참고 옵션 체크박스, 참조 채팅 선택기는 좌측 상단 **`☰`** 메뉴에서 열고 설정할 수 있습니다.
  - PC(`960px` 이상)에서 **`☰` → `📌 오른쪽 도킹`** 또는 설정 옵션을 켜면 RisuHelper가 화면 오른쪽에 고정되고 RisuAI 본체(`<main>`)가 왼쪽으로 자동 분할되어 **RisuAI 화면을 그대로 조작하면서 클릭하는 DOM 입력칸이 RisuHelper에 실시간 반영**됩니다. (시작 시 자동 도킹, 패널 폭 `360/420/500px`, 화면 자동 분할 on/off 선택 가능)
  - 일반 모드에서는 PC 우측 사이드 드로어(넓게 보기 지원), 모바일에서는 하단 시트 + `visualViewport` 가상 키보드 대응 레이아웃으로 표시되며 RisuAI 다크/라이트 테마를 자동으로 따릅니다.
- **에디터형 마크다운 대화창 & 구문 강조 코드 카드 (XSS 안전)**
  - LLM 응답의 마크다운(제목 `H1`~`H6`, 굵게/기울임/취소선, 인라인 코드 배지, RisuAI `{{...}}` CBS 매크로 배지, 중첩 목록·체크리스트, 인용구 및 `[!NOTE]`/`[!TIP]`/`[!IMPORTANT]`/`[!WARNING]`/`[!CAUTION]` 콜아웃 박스, 정렬 지원 표, 안전한 `http(s)` 링크)을 `innerHTML` 없이 순수 DOM 노드로 렌더링합니다.
  - 코드 블록은 언어 컬러 배지·파일명·줄 수·고정 줄 번호 거터·원클릭 복사 버튼이 포함된 에디터 카드로 표시되며, Lua(RisuAI API 포함)·JSON·JS/TS·HTML/Svelte·CSS·Regex·Diff·스트리밍 미완성 코드 블록의 구문 강조와 메시지별 **원문 보기 / 서식 보기** 전환을 지원합니다.
- **대화 자동 저장 · 목록 불러오기 · 대화 제목 설정 · 긴 대화 자동/수동 요약 (`v1.1.1`)**
  - 대화를 주고받으면 `pluginStorage`에 자동 저장되며, 플러그인을 다시 열거나 새로고침해도 마지막 활성 대화가 그대로 복원됩니다(최대 40개 · 1.5MB 용량 자동 정리, 상단 고정·활성 대화 우선 보호).
  - 상단 대화 바에서 **클릭 한 번으로 대화 제목을 직접 설정·수정(`✏️`)**하거나 **`+ 새 대화`**를 시작할 수 있으며, **`📚 대화 (N)`** 드로어에서 제목·본문·요약·캐릭터 검색, 불러오기, 상단 고정(`📌`), 인라인 이름 변경, 마크다운(`.md`) 내보내기(`📤`), 확인 팝업 후 삭제(`🗑️`)를 지원합니다.
  - **Antigravity 방식 긴 대화 압축(Compaction)**: 대화가 설정된 기준(`12K/16K(기본)/24K/36K자` 또는 미요약 16건)을 넘으면 다음 요청 직전 이전 대화를 구조화된 한국어 요약으로 자동 압축하고 최신 4건만 원문으로 유지합니다(상단 **`🗜️ 요약`** 버튼으로 수동 요약도 가능, 모델 오류 시 결정적 로컬 자동 정리 폴백). 채팅 중간의 **접이식 요약 구분 카드**에서 누적 요약을 열람·직접 편집·추가 요약·해제할 수 있으며, 직접 보내기·프리셋 적용 모드 양쪽에 자동 반영됩니다.
- **대화 + 검토 후 적용 + 필드 단위 안전 되돌리기(Undo)**
  - 일반 대화나 사용법·설정 질문만 할 때는 데이터를 절대 수정하지 않습니다.
  - LLM이 제안한 변경사항은 `risuhelper-proposal` 스키마(표준 JSON 및 Lua/정규식/HTML용 이스케이프 불필요 원문 구분자 `<<<CODE>>>`·`<<<BEFORE>>>`/`<<<AFTER>>>`·`<<<IN>>>`/`<<<OUT>>>`·`<<<CONTENT>>>` 지원)로 검증한 뒤 **고정된 적용 대상 · 메타데이터 전/후 변경 목록 · 줄 단위 본문 Diff 카드**로 보여 줍니다.
  - 제안 생성 시점의 대상과 캐릭터/채팅 식별자를 카드에 고정해 커서 이동 후 적용해도 의도치 않은 필드가 덮어써지지 않으며, 허용 필드 화이트리스트·24,000자 초과 원문의 전체 덮어쓰기 차단·기존 V1/V2 트리거 삭제 확인 체크박스로 안전성을 보장합니다.
  - **되돌리기(Undo)**는 최신 상태를 다시 읽어 변경했던 필드/항목만 정밀 복원하므로 적용 이후 나눈 채팅 메시지나 새로 추가된 항목을 유실하지 않습니다.
- **광범위한 편집 · 생성 · 삭제 지원**
  - **캐릭터 생성 · 고급 튜닝 · 교차 포팅**: **새 캐릭터 카드 원클릭 생성(`create_character`)**, **다른 캐릭터의 로어북·정규식·Lua 교차 포팅(`port_from_character`, 폴더 유지·중복 자동 건너뜀)**, **로어북 토큰 예산·스캔 깊이·재귀 스캔·전체 단어 일치(`loreSettings`) · 로짓 바이어스(`bias`) · 태그(`tags`) 튜닝(`update_char_settings`)**
  - 캐릭터/채팅 설정: 이름(`name`), 닉네임(`nickname`), 설명(`desc`), 추가 디스크립션(`additionalText`), 첫 메시지(`firstMessage`), **추가 첫 메시지(`alternateGreetings`) 생성·수정·삭제**, **작가의 노트(`chat.note`)**, **실시간 채팅 변수(`chat.scriptstate`) 추가·수정·삭제(`update_chat_vars`)**, **채팅 말풍선 메시지 수정(`chat.message[i]`)**, 시스템 프롬프트, 글로벌 노트 덮어쓰기, **깊이 프롬프트(`depth_prompt.prompt`)**, **기본 변수(`defaultVariables`)**, **캐릭터 커스텀 토글(`customModuleToggle`)**, **번역가의 노트(`translatorNote`)**, 제작자 코멘트, 백그라운드 임베딩, 캐릭터JS(`virtualscript`) 등
  - 로어북: 캐릭터 로어북(`globalLore`), 채팅 로컬 로어북(`localLore`), 모듈 로어북(`modules[].lorebook`) 생성·수정·폴더 정리·**안전 삭제(`delete_lorebook`, 비어 있지 않은 폴더 차단)**
  - 모듈 & 스크립트: **새 모듈 통째로 신규 생성(`create_module` — 정규식+Lua+로어북+커스텀 토글+백그라운드 임베딩 패키지 생성 + 현재 채팅/전역 즉시 활성화)**, 기존 모듈 백그라운드 임베딩·커스텀 토글·설명/이름/네임스페이스, 캐릭터/모듈 Lua 트리거 스크립트(`triggerlua`) 및 정규식 스크립트(`customscript`) 생성·부분편집·덮어쓰기·**안전 삭제(`delete_regex`)**
  - **정규식 · CBS 실시간 실행 미리보기 (`parseRisuChat`, `runVar: false`)**: 정규식 제안 카드에서 현재 채팅 메시지 또는 직접 입력한 샘플 문장으로 매칭/치환 결과를 즉시 테스트할 수 있고, CBS(`{{...}}`)가 포함된 제안 카드에서는 현재 채팅 기준 실행 결과를 변수 변경 없이 미리 확인합니다.
  - **수동 1회성 요청 로그 진단 (`☰ › 🔍 최근 요청 로그 첨부`)**: 사용자가 직접 버튼을 눌렀을 때만 `getFetchLogs()`로 최근 LLM 요청/응답 1건을 읽어 API 키·Bearer 토큰 등 민감정보를 자동 마스킹한 뒤 다음 1회 질문에만 첨부하고 전송 즉시 자동 해제합니다(자동 전송 절대 없음).
  - 페르소나: 새 페르소나 생성, 기존 페르소나 수정, **안전 삭제(`delete_persona`, 마지막 1개 보호·선택 인덱스 자동 보정)**, **현재 채팅 바인딩(`bindedPersona`)** 1-클릭 옵션
  - 설정/컨피그: `allowedDbKeys` 범위의 설정 진단 및 안전한 수정(디스플레이 **채팅 HTML(`guiHTML`)** · **커스텀 CSS(`customCSS`)**, `temperature`, `maxContext`, `maxResponse`, `enabledModules` 등)
- **요청당 기본 3회 에이전트 루프 · 15종 읽기 전용(Read-Only) 자동 도구 · 대용량 계획형 파이프라인 (`v1.1.0`)**
  - 단순 요청은 **1회 호출**로 즉시 끝내고, 전문 확인·검색·진단·스킬 로드가 필요하면 **15종 읽기 전용 도구**(`search_workspace`, `read_item`, `list_items`, `read_chat`, `read_vars`, `test_regex_cbs`, `active_lorebook`, `audit_workspace`, `inspect_assets`, `host_info`, `search_translation`, `read_bard_wiki`, `inspect_host_tools`, `load_skill`, 수동 옵트인 `read_fetch_log`)를 자동 실행한 뒤 결과를 받아 제안합니다.
  - **0-토큰 로컬 전문 검색 & 구간 읽기 + 줄 범위 편집 (`v1.1.0`)**: `search_workspace`가 캐릭터 필드·로어북(캐릭터/채팅/모듈)·Lua·정규식·페르소나·채팅 본문을 로컬 JS에서 밀리초 단위로 검색해 정확한 줄 번호와 앞뒤 ±360자 원문 문맥을 반환합니다. `read_item`은 `startLine`/`endLine`, `startChar`/`maxChars`, `aroundText`, `outlineOnly`를 지원하며, `edits`의 선택 `lineRange: [시작줄, 끝줄]`로 중복 문구가 많은 수만 자 파일에서도 지정 구간만 정확히 패치합니다.
  - **전 항목 미열람·부분 열람 전체 덮어쓰기 차단 (`v1.1.0`)**: 캐릭터 필드·첫 메시지뿐 아니라 **로어북·Lua·정규식·페르소나**까지 전문이 실제로 모델에 전달되지 않았거나 배치 직렬화 한도로 잘린 경우 전체 덮어쓰기를 미리보기·적용 양쪽에서 차단합니다.
  - **대용량 자동 목차 & 어시스턴트 전용 요청 예산 (`v1.1.0`)**: 포커스된 대상이 `12,000자`를 초과하면 매 루프마다 원문을 통째로 재전송하지 않고 구조 목차(제목·Lua 함수·줄 번호) + 앞·뒤 미리보기로 자동 압축하며, RisuAI 채팅의 `db.maxContext`와 독립된 **어시스턴트 총 요청 예산(`maxRequestChars`: `48K/80K/160K/320K`)**을 설정에서 제어할 수 있습니다.
  - **동적 3단계 계획형 파이프라인 (`Step 1 → Step 2 (0..N) → Step 3 (0..M)`) + 진행 전 확인창 (`v1.1.0`)**: "4만 자 로어북 전체 번역", "로어북 100개 용어 통일"처럼 단일 출력·3회 호출을 초과하는 대용량 작업은 `risuhelper-plan`을 수립하고, **4회 이상 호출 예정 시 패널 내 확인창(`대용량 다단계 작업 진행 확인`)**으로 단계·예상 호출 수를 먼저 보여 준 뒤 사용자가 **진행**을 눌렀을 때만 실행합니다. 매 단계 이전 원문을 제거하고 **3,000자 고정 예산 누적 요약(`rollingSummary`)** + 직전 구간 끝부분(8줄)만 전달해 컨텍스트 폭증을 막으며, `chunked_rewrite`는 마지막에 **1개의 원자적 수정 카드(전체 Diff + 1클릭 되돌리기)**로 합치고, 중간 오류/중단 시에도 완료된 구간을 안전한 부분 편집 카드로 보존합니다.
  - 제안 검증 실패 시 오류 사유를 모델에 되돌려 자동 수정하며, 모든 쓰기는 예외 없이 사용자의 승인 카드 클릭 뒤에만 실행됩니다(기본 호출 상한 `1~3회`, 계획형 최대 호출 `6/12/18/24회`, 확인창 표시 on/off 설정 가능).
- **21개 내장 스킬 · L0/L1/L2 라우터 & 36종 승인형 쓰기 동작**
  - 외부 파일 없이 플러그인 안에 내장된 **21개 스킬**을 L0(결정적 자동 선택) → L1(1줄 카탈로그) → L2(`load_skill` 동적 로드)로 운용하며, 호스트 기능 탐지(`src/host-capabilities.js`)로 미지원 포크 API를 자동 은닉합니다.
  - **경계 없는(Borderless) 타 캐릭터 · 타 채팅 편집 & 새 채팅 생성/이사**: `targetCharIndex`·`targetChatIndex`로 열려 있지 않은 다른 캐릭터·채팅의 필드·로어북·변수·메시지·메모리까지 수정·되돌리기하며, 카드에 `[다른 캐릭터: …]`/`[다른 채팅: …]`을 고정 표시합니다. `create_chat`으로 새 채팅 생성 + 상태 이사 + 전환까지 한 번에 처리합니다.
  - **M3 확장 도메인 전면 지원**: 테마·색상 스킴·텍스트 테마(`update_theme`), 보안 정화 채팅 HUD 패널(`set_chat_panel`), SVG/텍스트 에셋·원본 인레이 등록(`register_asset`), 워크스페이스 일괄 수리(`repair_workspace` + `☰ › 🩺 건강검진` · `💾 진단 리포트 저장`), 채팅 메시지 관리(`manage_chat_messages`), Hypa/Supa 메모리(`update_memory`), 캐릭터 온보딩 폼(`update_onboarding`), 그룹챗(`update_group_chat`), 채팅 폴더(`organize_chat_folders`), RisuBard BardWiki(`manage_bard_wiki`), RisuNest 네이티브 원자 패치(`patch_risunest_conversation`).
  - **선언형 상주 확장 런타임 (`manage_extensions`, `☰ › 🧩 상주 확장`)**: 임의 JS(`eval`/`Function`) 실행 없이 승인된 선언형 JSON 규칙으로 `script_handler`, `replacer`(`beforeRequest` 메시지 배열/`afterRequest` 문자열), `chat_listener`(`output`), `body_intercepter`(안전 파라미터 허용목록), 읽기 전용 `mcp_server`, `tts_processor`(`pre`), `plugin_channel`을 안전하게 상주 운용합니다. ReDoS 정적 차단, 연속 오류/지연 시 자동 중지 서킷 브레이커, 설정의 안전 모드(자동 복원 끄기), 원클릭 **모두 중지**, 언로드 100% 해제를 지원합니다.
- **프롬프트 프리셋 적용 / 직접 보내기 전환 (BotBuilder 호환)**
  - 좌측 상단 **`☰`** 메뉴에서 **직접 보내기 (`direct`) ↔ 프리셋 적용 (`preset`)** 모드를 전환하고 프리셋 패널을 열 수 있습니다.
  - `.risup` / `.risupreset` / `.json` / `.preset` 파일을 외부 의존성 없이 순수 WebCrypto·`DecompressionStream`·MessagePack·RPack으로 복호화해 가져옵니다(본체 프리셋은 변경하지 않음).
  - 프리셋 **블록 활성/편집**, 프리셋+모듈 통합 **토글 설정**(스크롤 위치 유지), 호스트 **설치 모듈 선택 연동**(로어북 포함/조건 완화/미지원 처리 제외), 그리고 실제 LLM에 전송되는 최종 메시지 배열을 미리 보는 **전송 미리보기**를 제공합니다.
- **6대 호스트 호환 (`RisuAI` · `PocketRisu` · `RisuBard` · `RisuNest` · `HaejeokRisuai` · `RisuAI-Hardened`)**
  - `PocketRisu`의 미열람 채팅 `_placeholder` 자동 하이드레이션 및 `createInlay` 게이팅
  - `RisuBard`의 `bardWiki.*`(`contentHash` 충돌 검사·`markdown`·등급 `0~9`·문서별 컨텍스트 모드) 네이티브 지원
  - `RisuNest`의 `queryCharacters`/`queryConversations`/`queryConversationMessages` 고속 경로, `risunestPatchConversation` 원자 패치, `MessageButtonTarget` 말풍선 편집 버튼, `setDatabaseLite({ characters })` 차단 회피
  - 원본/`PocketRisu`/`RisuBard`의 현재 선택 전역 페르소나 미동기화 안내 및 `bindedPersona` 즉시 반영 옵션
  - `RisuAI-Hardened` 등 제한 호스트에서의 자동 기능 축소 및 안전한 캐릭터 경유 저장 폴백

상세한 포크별 Plugin API v3 커버리지와 아키텍처는 [docs/api-coverage.md](docs/api-coverage.md)와 [docs/architecture.md](docs/architecture.md)를 참고하세요.

## 자동감지와 자유대화

- **입력칸에 커서가 실제로 있을 때만** 그 칸이 대상이 됩니다(`📍 자동감지: 캐릭터 설명`, `📍 자동감지: 채팅 입력창 (유저 대필)` 등).
- **채팅 입력창 (유저 대필)**: RisuAI 하단 채팅 입력창(및 PocketRisu·RisuBard 전체화면 입력창)에 커서를 두면 **`📍 자동감지: 채팅 입력창 (유저 대필)`**로 잡히며, 대필 요청 시에만 최근 대화 흐름(예산 제한)이 함께 전달됩니다. 대필 제안 카드에서 **복사**, **💬 채팅에 추가**(되돌리기 가능), 또는 **🚀 바로 전송**(`sendChat` 지원 호스트, 확인 팝업 후 전송 및 캐릭터 응답 생성)을 고를 수 있습니다.
- 그 외에는 모두 **`📍 자동감지: 자유대화`** 입니다. 검색창, 알 수 없는 칸, 아무 칸도 선택하지 않은 화면이 여기에 해당합니다.
- 자유대화에서는 대상 선택 없이 말로 요청하면 필요한 정보를 읽기 도구로 확인하고 승인 카드를 제안합니다. 다른 캐릭터나 열려 있지 않은 채팅을 지목해도 경계 없이 편집·되돌리기할 수 있으며, 카드에 대상이 명확히 고정 표시됩니다.
- 필드 선택 유지 규칙:
  - 다른 구체적 입력칸(채팅 입력창 포함)으로 커서를 옮기면 즉시 그 칸으로 바뀝니다.
  - 검색창·알 수 없는 입력칸으로 커서를 옮기면 즉시 자유대화가 됩니다.
  - 일반 모드에서는 칸 밖 클릭 후 5초 동안 직전 칸을 유지하며, 오른쪽 도킹 모드에서는 즉시 자유대화로 전환됩니다.

## 첫 메시지 수정과 추가

- 첫 메시지는 어느 화면에서든 바로 수정·추가·삭제할 수 있습니다 (`update_greeting`, `create_greeting`, `delete_greeting`).
- 새 추가 첫 메시지 카드의 **현재 채팅에서 바로 사용**을 체크하면 지금 채팅의 첫 메시지가 새 항목으로 전환되고, 되돌리면 추가와 전환이 함께 복원됩니다.
- 그룹 채팅에는 첫 메시지 구조가 없어 첫 메시지 편집이 차단되며, 대신 `update_group_chat`으로 그룹 멤버·발언 비율·순차 발언을 관리합니다.

## 채팅 이사 및 새 채팅 생성 (`import_chat` / `create_chat`)

긴 채팅을 정리하고 새 채팅에서 이어 갈 때 두 가지 방법을 모두 지원합니다.

1. **새 채팅을 바로 만들며 이사 (`create_chat`)**: "2부 여정으로 새 채팅 만들어서 변수·작노 옮기고 요약 로어북 넣어 전환해 줘"처럼 요청하면 UUID `chat.id`가 포함된 새 채팅 생성 + 상태 복사 + 요약 로어북 + 채팅 전환을 한 카드로 처리하며, 되돌리기 시 새 채팅 삭제와 원래 채팅 복귀까지 원자적으로 복원합니다.
2. **이미 연 채팅으로 가져오기 (`import_chat`)**: **`☰` 메뉴 › 참조 채팅**에서 원본 채팅을 고르거나 요청에서 "1번 채팅"처럼 지목하면 채팅 변수, 작가의 노트, 채팅 로어북, 연결 페르소나, 채팅 모듈, 첫 메시지 번호를 원본 그대로 복사합니다.
3. **콜드 스토리지 보호**: 오래된 채팅이 RisuAI 콜드 스토리지에 보관 중인 경우 목록에 표시되며, RisuAI에서 해당 채팅을 한 번 열어 복원한 뒤 이사할 수 있습니다.

## 적용과 되돌리기

- 한 번의 답변에 제안이 여러 개면 **모두 적용**으로 한꺼번에 적용하고, 상단 **되돌리기** 한 번으로 전부 되돌릴 수 있습니다.
- **삭제(`delete_*`, `trash_document`, `remove`)** 제안은 빨간 버튼과 패널 내 확인 팝업을 거쳐야 실행됩니다.
- 작업 결과가 만족스러우면 **✓ 변경 확정**으로 되돌리기 기록을 비울 수 있습니다.
- 되돌리기 기록은 `pluginStorage`에 저장되며, 적용 이후 사용자가 직접 고친 곳은 충돌을 감지해 덮어쓰지 않고 건너뜁니다.
- 모델에 보내는 원문 길이는 설정에서 24,000 / 60,000(기본) / 120,000 / 300,000자 중 고를 수 있습니다. 원문이 잘린 경우에도 3회 루프의 `read_item`으로 전문을 확인하거나 부분 편집으로 안전하게 수정합니다.

## 설치 방법

1. [`dist/risuhelper.js`](dist/risuhelper.js) 파일을 내려받습니다.
2. RisuAI(또는 포크)의 **설정 → 플러그인 → 플러그인 가져오기**에서 `dist/risuhelper.js`를 추가합니다.
3. 드래그 가능한 플로팅 버튼(`⋮⋮ ✨ ...`), 햄버거 메뉴, 설정 메뉴 중 하나를 눌러 RisuHelper를 엽니다.
4. 모델은 RisuAI에 이미 설정된 메인 모델(`model`) / 보조 모델(`submodel`) / `otherAx`를 `Risuai.runLLMModel()`으로 그대로 사용합니다.

## 필요한 Plugin v3 권한

- `mainDom` (선택): 커서·입력칸 자동 감지, 플로팅 버튼, 오른쪽 도킹 (거부 시 수동 대상 선택으로 동작)
- `db` (선택): 페르소나·모듈·허용 설정 조회, 새 캐릭터/모듈 생성, 다른 캐릭터 포팅 및 프리셋 모듈 연동
- `dbWrite` (원본 RisuAI): 수정·생성·삭제 제안의 **적용** 클릭 시 요청
- `fetchLogs` (선택): **`☰ › 🔍 최근 요청 로그 첨부`** 버튼을 사용자가 직접 눌렀을 때만 최근 로그 1건 조회
- `replacer` / `inlay` / `bardWikiWrite` (선택): 해당 승인형 확장(`body_intercepter`), 원본 인레이(`createInlay`), RisuBard BardWiki 쓰기를 사용자가 직접 승인할 때만 호스트가 요청

## 개발 및 검증

외부 런타임 의존성 없이 순수 Node.js(>=20)로 빌드하고 테스트합니다.

```bash
npm run build   # src/ -> dist/risuhelper.js 단일 번들 생성 및 문법 검증
npm test        # 313개 단위·통합·보안·회귀 테스트 실행
npm run check   # build + test 일괄 실행
npm run e2e:sim # 6개 호스트 엄격 시그니처 시뮬레이션 E2E 실행
node tools/eval-real-model.mjs --golden # 71문항 평가 하네스 무결성 검증
```

### 실제 호스트 DOM 회귀 테스트

`tests/fixtures/host-dom/`에는 실제 `kwaroran/Risuai`(한국어·영어)와 `PocketRisu`(한국어) 화면에서 기록한 DOM 스냅샷이 들어 있고, `tests/host-fixtures.test.mjs`가 각 입력칸에 포커스를 둔 상태로 감지 결과를 검증합니다. 기대값은 라벨이 아니라 **호스트가 그 입력칸에 바인딩한 실제 값**에서 얻으므로, 라벨 휴리스틱이 틀리면 테스트가 실패합니다. 브라우저 없이 `npm test`에 포함되어 실행됩니다.

본체 UI가 바뀌면 호스트 개발 서버를 띄운 뒤 스냅샷을 다시 기록합니다(Playwright 필요, `npm test`와 무관한 관리용 도구).

```bash
node tools/capture-host-fixtures.cjs --url http://127.0.0.1:5174/ --host upstream --lang ko
```

### 릴리스 규칙

RisuAI는 원격 `//@version`이 설치본보다 **클 때만** 업데이트를 제안합니다. `dist/risuhelper.js`가 바뀌면 `package.json`과 `src/version.js`의 버전을 함께 올려야 하며, CI(`tools/check-version-bump.mjs`)가 이를 검사합니다.

## 구조

```text
src/
  main.js               # Plugin v3 진입점
  version.js            # 버전, 허용 컨피그 키, 필드 메타데이터
  host-capabilities.js  # 6대 호스트 런타임 기능 탐지 매트릭스
  knowledge.js          # RisuAI/포크 내장 지식 베이스 (21개 스킬 연동)
  skills.js             # 21개 내장 스킬 레지스트리 및 L0/L1/L2 라우터
  read-tools.js         # 15종 엄격 읽기 전용(Read-Only) 자동 도구
  agent-loop.js         # 요청당 최대 3회 LLM 루프, 대용량 계획형 파이프라인 및 자동 수정 오케스트레이터
  conversations.js      # 저장된 대화 목록(제목·고정·검색·내보내기) 및 Antigravity 방식 긴 대화 압축 엔진
  extensions-runtime.js # 선언형 상주 확장 런타임 (ReDoS/허용목록/서킷브레이커/안전모드)
  m3-actions.js         # 테마/HUD/에셋/수리/메시지/메모리/폴더/그룹/온보딩/포크 API 쓰기·Undo
  runtime-tools.js      # 채팅 변수, 정규식 미리보기, 로그 마스킹, 캐릭터 생성/포팅
  text-edits.js         # 정확 일치 부분편집, 유사 구간 탐색, 줄 단위 Diff 생성
  focus-detector.js     # mainDom 기반 커서·화면 감지(한/영 UI 지원) 및 플로팅 칩
  host-adapter.js       # 크로스-포크 경계 없는 읽기/쓰기/검증 계층
  undo-journal.js       # 저장 가능한 되돌리기 기록 (변경 연산 diff / 충돌 감지 복원)
  chat-transfer.js      # 채팅 이사 및 새 채팅 생성 계획
  greetings.js          # 첫 메시지 컨텍스트 계획
  fields.js             # 자유대화용 캐릭터 필드·작가의 노트 전달 계획
  llm.js                # runLLMModel 스트리밍 리더, 도구·제안 블록 파서 및 검증기
  markdown.js           # XSS 안전 마크다운 파서 및 구문 강조 코드 카드 렌더러
  rpack-map.js          # .risup RPack 룩업 테이블
  preset-format.js      # .risup / .risupreset / .json 무의존성 복호화·정규화
  preset-calc.js        # CBS 수식 RPN 계산기
  preset-v2.js          # 토글 트리 파서 및 V2 조건 어댑터
  preset-modules.js     # 설치 모듈 스냅샷·런타임 분류·선택 관리
  preset-engine.js      # 직접 보내기 / 프리셋 적용 조립 엔진 및 CBS 평가기
  preset-ui.js          # 프리셋 블록·토글·모듈·전송 미리보기 패널 UI
  ui.js                 # 반응형 드로어/도킹/대화저장·요약/상주확장/건강검진 UI 컨트롤러
  style.js              # 다크/라이트 대응 CSS
tools/
  build.mjs                  # 무의존성 ESM -> IIFE 단일 플러그인 번들러
  build-eval-plugin.mjs      # RisuAI 인앱 71문항 실모델 평가 플러그인 번들러
  eval-real-model.mjs        # CLI 실모델/골든 71문항 평가 러너
  e2e/                       # 6개 호스트 시뮬레이션 및 Playwright E2E 러너
  check-version-bump.mjs     # 번들 변경 시 버전 상승 여부 검사 (CI)
  capture-host-fixtures.cjs  # 실제 호스트 DOM 스냅샷 기록 (관리용, Playwright 필요)
tests/
  *.test.mjs        # 313개 자동 테스트 스위트
  data/             # 336개 한국어 스킬 라우팅 코퍼스
  fixtures/host-dom # 실제 RisuAI / PocketRisu 화면 DOM 스냅샷
  helpers/          # 샌드박스 부팅 및 DOM 스냅샷 테스트 헬퍼
docs/
  api-coverage.md   # 6대 호스트 Plugin API v3 전수 커버리지 매트릭스
  architecture.md   # 포크별 Plugin API v3 호환성 분석 및 샌드박스 설계 문서
  eval-baselines/   # 실모델 평가 기준선 리포트
  e2e-results/      # 6개 호스트 시뮬레이션 E2E 실행 기록
dist/
  risuhelper.js     # RisuAI에 바로 설치하는 단일 배포 파일
```

## 라이선스

[GPL-3.0-only](LICENSE)