# RisuHelper

RisuAI 및 공개 포크(`PocketRisu`, `RisuBard`, `HaejeokRisuai`, `RisuNest`, `RisuAI-Hardened`)의 대부분의 화면에서 **현재 커서가 위치한 입력 영역과 화면 문맥을 인식**하여 LLM과 대화하면서 **사용법 질문, 컨피그 진단, 설명/로어북/Lua/정규식/페르소나/모듈의 부분 편집·덮어쓰기·새로 생성**을 수행할 수 있는 **Plugin API v3** 플러그인입니다.

## 핵심 특징

- **화면 · 커서 자동 감지 (`mainDom` 우회 아키텍처)**
  - Plugin v3 샌드박스(`SafeElement`)에서 허용되는 `pointerup`/`click`/`keyup` 이벤트와 `querySelector(':focus')`·`getBoundingClientRect()`를 조합해 사용자가 마지막으로 커서를 둔 화면·필드·로어북/정규식 항목(`data-risu-idx`)을 정확하게 자동 추적합니다 (`PocketRisu` 2중 래퍼 `TextAreaInput` 및 bits-ui 환경 완전 대응).
  - 화면의 플로팅 버튼(`⋮⋮ ✨ ...`)은 마우스·터치 드래그로 자유롭게 이동할 수 있으며, 600ms 길게 누르기 자리 순환 및 설정 내 6방향 원클릭 이동을 지원합니다.
  - 필드 라벨은 **전체 일치**로만 판정합니다. `캐릭터 설명 Prefix`(전역 설정)처럼 키워드가 일부만 들어간 라벨, 목록 검색창, 알 수 없는 입력칸은 편집 대상으로 추측하지 않고 "대상 없음"으로 둡니다. 로어북의 캐릭터/챗 탭은 가장 가까운 활성 탭으로 구분하며, PocketRisu의 설정 항목은 `data-setting-id`로 판정합니다.
  - 제안이 가리키는 인덱스·ID(모듈, 페르소나, 정규식 번호, 활성화할 모듈 ID 등)는 쓰기 전에 실제로 존재하는지 한 곳에서 검사하며, 없으면 다른 항목으로 넘기지 않고 거부합니다. 스키마에 없는 속성이 제안에 들어 있으면 카드에 "지원하지 않는 속성"으로 표시합니다.
  - 여러 모듈이 설치된 상태에서 열려 있는 모듈을 특정하지 못하거나 내용이 같은 모듈이 둘 이상이면, 첫 번째 모듈로 넘겨짚지 않고 모듈 선택기에서 직접 고를 때까지 적용을 막습니다.
  - 채팅 화면 우측 상단의 고정 `✨` 버튼은 RisuAI 본체가 그리는 버튼이라 옮길 수 없습니다. 드래그 가능한 플로팅 버튼과 겹치지 않도록 기본으로 숨기며, 설정에서 켜거나 플로팅 버튼을 쓸 수 없을 때(`mainDom` 거부 등) 자동으로 대신 표시됩니다.
  - `mainDom` 권한을 거부하더라도 상단 **수동 대상 선택기**로 모든 편집/질문 기능을 그대로 사용할 수 있습니다.
- **PC 오른쪽 상시 도킹(분할 화면 · 사용자 선택) & 웹 · 모바일 반응형 UI**
  - PC(`960px` 이상)에서 **`📌 오른쪽 도킹`** 또는 설정 옵션을 켜면 RisuHelper가 화면 오른쪽에 고정되고 RisuAI 본체(`<main>`)가 왼쪽으로 자동 분할되어 **RisuAI 화면을 그대로 조작하면서 클릭하는 DOM 입력칸이 RisuHelper에 실시간 반영**됩니다. (시작 시 자동 도킹, 패널 폭 `360/420/500px`, 화면 자동 분할 on/off 선택 가능)
  - 일반 모드에서는 PC 우측 사이드 드로어(넓게 보기 지원), 모바일에서는 하단 시트 + `visualViewport` 가상 키보드 대응 레이아웃으로 표시되며 RisuAI 다크/라이트 테마를 자동으로 따릅니다.
- **에디터형 마크다운 대화창 & 구문 강조 코드 카드 (XSS 안전)**
  - LLM 응답의 마크다운(제목 `H1`~`H6`, 굵게/기울임/취소선, 인라인 코드 배지, RisuAI `{{...}}` CBS 매크로 배지, 중첩 목록·체크리스트, 인용구 및 `[!NOTE]`/`[!TIP]`/`[!IMPORTANT]`/`[!WARNING]`/`[!CAUTION]` 콜아웃 박스, 정렬 지원 표, 안전한 `http(s)` 링크)을 `innerHTML` 없이 순수 DOM 노드로 렌더링합니다.
  - 코드 블록은 언어 컬러 배지·파일명·줄 수·고정 줄 번호 거터·원클릭 복사 버튼이 포함된 에디터 카드로 표시되며, Lua(RisuAI API 포함)·JSON·JS/TS·HTML/Svelte·CSS·Regex·Diff·스트리밍 미완성 코드 블록의 구문 강조와 메시지별 **원문 보기 / 서식 보기** 전환을 지원합니다.
- **대화 + 검토 후 적용 + 필드 단위 안전 되돌리기(Undo)**
  - 일반 대화나 사용법·설정 질문만 할 때는 데이터를 절대 수정하지 않습니다.
  - LLM이 제안한 변경사항은 `risuhelper-proposal` 스키마(표준 JSON 및 Lua/정규식/HTML용 이스케이프 불필요 원문 구분자 `<<<CODE>>>`·`<<<BEFORE>>>`/`<<<AFTER>>>`·`<<<IN>>>`/`<<<OUT>>>`·`<<<CONTENT>>>` 지원)로 검증한 뒤 **고정된 적용 대상 · 메타데이터 전/후 변경 목록 · 줄 단위 본문 Diff 카드**로 보여 줍니다.
  - 제안 생성 시점의 대상과 캐릭터/채팅 식별자를 카드에 고정해 커서 이동 후 적용해도 의도치 않은 필드가 덮어써지지 않으며, 허용 필드 화이트리스트·24,000자 초과 원문의 전체 덮어쓰기 차단·기존 V1/V2 트리거 삭제 확인 체크박스로 안전성을 보장합니다.
  - **되돌리기(Undo)**는 최신 상태를 다시 읽어 변경했던 필드/항목만 정밀 복원하므로 적용 이후 나눈 채팅 메시지나 새로 추가된 항목을 유실하지 않습니다.
- **광범위한 편집 · 생성 지원**
  - 캐릭터/채팅 설정: 이름(`name`), 닉네임(`nickname`), 설명(`desc`), 추가 디스크립션(`additionalText`), 첫 메시지(`firstMessage`), **추가 첫 메시지(`alternateGreetings`)**, **작가의 노트(`chat.note`)**, **채팅 말풍선 메시지 수정(`chat.message[i]`)**, 시스템 프롬프트, 글로벌 노트 덮어쓰기, **깊이 프롬프트(`depth_prompt.prompt`)**, **기본 변수(`defaultVariables`)**, **캐릭터 커스텀 토글(`customModuleToggle`)**, **번역가의 노트(`translatorNote`)**, 제작자 코멘트, 백그라운드 임베딩, 캐릭터JS(`virtualscript`) 등
  - 로어북: 캐릭터 로어북(`globalLore`), 채팅 로컬 로어북(`localLore`), 모듈 로어북(`modules[].lorebook`) 생성·수정
  - 모듈 & 스크립트: 모듈 **백그라운드 임베딩(`backgroundEmbedding`)**·**커스텀 토글(`customModuleToggle`)**·설명/이름/네임스페이스, 캐릭터/모듈 **Lua 트리거 스크립트(`triggerlua`)** 및 **정규식 스크립트(`customscript`)** 생성·부분편집·덮어쓰기
  - 페르소나: 새 페르소나 생성, 기존 페르소나 수정, **현재 채팅 바인딩(`bindedPersona`)** 1-클릭 옵션
  - 설정/컨피그: `allowedDbKeys` 범위의 설정 진단 및 안전한 수정(디스플레이 **채팅 HTML(`guiHTML`)** · **커스텀 CSS(`customCSS`)**, `temperature`, `maxContext`, `maxResponse`, `enabledModules` 등)
- **프롬프트 프리셋 적용 / 직접 보내기 전환 (BotBuilder 호환)**
  - 상단 바에서 **직접 보내기 (`direct`) ↔ 프리셋 적용 (`preset`)** 모드를 1-클릭으로 전환할 수 있습니다.
  - `.risup` / `.risupreset` / `.json` / `.preset` 파일을 외부 의존성 없이 순수 WebCrypto·`DecompressionStream`·MessagePack·RPack으로 복호화해 가져옵니다(본체 프리셋은 변경하지 않음).
  - 프리셋 **블록 활성/편집**, 프리셋+모듈 통합 **토글 설정**(스크롤 위치 유지), 호스트 **설치 모듈 선택 연동**(로어북 포함/조건 완화/미지원 처리 제외), 그리고 실제 LLM에 전송되는 최종 메시지 배열을 미리 보는 **전송 미리보기**를 제공합니다.
- **멀티 포크 호환**
  - `PocketRisu`의 미열람 채팅 `_placeholder` 보호(`getChatFromIndex` 선조회)
  - `RisuNest`의 `setDatabaseLite({ characters })` 동기 차단 회피(`setCharacter` / `setChatToIndex` / async `setDatabase` 사용)
  - 원본/`PocketRisu`/`RisuBard`의 현재 선택 전역 페르소나 미동기화 안내 및 `bindedPersona` 즉시 반영 옵션
  - `RisuAI-Hardened` 등 `setChatToIndex` 미제공 호스트에서의 안전한 캐릭터 경유 채팅 저장 폴백
  - 모듈 편집 화면(`tempModule`) 덮어쓰기 위험 사전 경고

상세한 포크별 Plugin API v3 호환성 분석과 샌드박스 설계 문서는 [docs/architecture.md](docs/architecture.md)를 참고하세요.

## 적용과 되돌리기

- 한 번의 답변에 제안이 여러 개면 **모두 적용**으로 한꺼번에 적용하고, **묶음 되돌리기** 또는 상단 **되돌리기** 한 번으로 전부 되돌릴 수 있습니다.
- 되돌리기 기록은 `pluginStorage`에 저장되어 새로고침하거나 플러그인을 다시 불러와도 남습니다. 기록이 가득 차 오래된 것이 정리되면 알림이 뜹니다.
- 되돌릴 때는 RisuHelper가 쓴 값이 그대로 남아 있는 곳만 복원합니다. 적용 이후 직접 고친 곳은 덮어쓰지 않고 건너뛰며, 몇 곳을 건너뛰었는지 알려 줍니다.
- 모델에 보내는 원문 길이는 설정에서 24,000 / 60,000(기본) / 120,000 / 300,000자 중 고를 수 있습니다. 원문이 이보다 길면 앞부분만 전달되고, 뒷부분 유실을 막기 위해 전체 덮어쓰기는 차단됩니다(부분 편집은 가능). 잘렸을 때는 패널에 표시됩니다.
- 대상이 잘못 잡힐 때는 설정의 **감지 근거 표시**를 켜면 판정에 쓰인 라벨·제목·탭과 무시된 오류를 볼 수 있습니다.

## 설치 방법

1. [`dist/risuhelper.js`](dist/risuhelper.js) 파일을 내려받습니다.
2. RisuAI(또는 포크)의 **설정 → 플러그인 → 플러그인 가져오기**에서 `dist/risuhelper.js`를 추가합니다.
3. 드래그 가능한 플로팅 버튼(`⋮⋮ ✨ ...`), 햄버거 메뉴, 설정 메뉴 중 하나를 눌러 RisuHelper를 엽니다.
4. 모델은 RisuAI에 이미 설정된 메인 모델(`model`) / 보조 모델(`submodel`) / `otherAx`를 `Risuai.runLLMModel()`으로 그대로 사용합니다.

## 필요한 Plugin v3 권한

- `mainDom` (선택): 현재 커서가 위치한 화면·입력칸 자동 감지 및 플로팅 칩 표시 (거부 시 수동 대상 선택으로 동작)
- `db` (선택): 페르소나·모듈·허용 설정값 조회 및 프리셋 설치 모듈 선택
- `dbWrite` (원본 RisuAI): 수정·생성 제안의 실제 **적용** 버튼 클릭 시 요청

## 개발 및 검증

외부 런타임 의존성 없이 순수 Node.js(>=20)로 빌드하고 테스트합니다.

```bash
npm run build   # src/ -> dist/risuhelper.js 단일 번들 생성 및 문법 검증
npm test        # 단위 테스트 + 모의 호스트/샌드박스 부팅 검증
npm run check   # build + test 일괄 실행
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
  main.js           # Plugin v3 진입점
  version.js        # 버전, 허용 컨피그 키, 필드 메타데이터
  knowledge.js      # RisuAI/포크 내장 지식 베이스 (설정/로어북/Lua/정규식/CBS/페르소나)
  text-edits.js     # 정확 일치 부분편집, 유사 구간 탐색, 줄 단위 Diff 생성
  focus-detector.js # mainDom 기반 커서·화면 감지(한/영 UI 지원) 및 플로팅 칩
  host-adapter.js   # 크로스-포크 읽기/쓰기/검증 계층 (범위 공통 쓰기 경로)
  undo-journal.js   # 저장 가능한 되돌리기 기록 (변경 연산 diff / 충돌 감지 복원)
  llm.js            # runLLMModel 스트리밍/비스트리밍 리더 및 제안 블록 파서
  markdown.js       # XSS 안전 마크다운 파서 및 구문 강조 코드 카드 렌더러
  rpack-map.js      # .risup RPack 룩업 테이블
  preset-format.js  # .risup / .risupreset / .json 무의존성 복호화·정규화
  preset-calc.js    # CBS 수식 RPN 계산기
  preset-v2.js      # 토글 트리 파서 및 V2 조건 어댑터
  preset-modules.js # 설치 모듈 스냅샷·런타임 분류·선택 관리
  preset-engine.js  # 직접 보내기 / 프리셋 적용 조립 엔진 및 CBS 평가기
  preset-ui.js      # 프리셋 블록·토글·모듈·전송 미리보기 패널 UI
  ui.js             # 반응형 드로어/바텀시트 UI 및 대화/제안 카드 컨트롤러
  style.js          # 다크/라이트 대응 CSS
tools/
  build.mjs                  # 무의존성 ESM -> IIFE 단일 플러그인 번들러
  check-version-bump.mjs     # 번들 변경 시 버전 상승 여부 검사 (CI)
  capture-host-fixtures.cjs  # 실제 호스트 DOM 스냅샷 기록 (관리용, Playwright 필요)
tests/
  *.test.mjs        # 자동 테스트 스위트
  fixtures/host-dom # 실제 RisuAI / PocketRisu 화면 DOM 스냅샷
  helpers/          # 스냅샷을 SafeElement 형태로 되살리는 테스트 헬퍼
docs/
  architecture.md   # 포크별 Plugin API v3 호환성 분석 및 샌드박스 설계 문서
dist/
  risuhelper.js     # RisuAI에 바로 설치하는 단일 배포 파일
```

## 라이선스

[GPL-3.0-only](LICENSE)