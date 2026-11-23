# RisuHelper 아키텍처 및 RisuAI 포크 호환성 분석

> 버전: `0.4.4` · 라이선스: `GPL-3.0-only` · 외부 런타임 의존성: 0개

---

## 1. RisuAI 및 공개 포크 Plugin API v3 호환성 매트릭스

원본 [`kwaroran/Risuai`](https://github.com/kwaroran/Risuai)와 주요 공개 포크 소스를 분석한 결과, **모든 주요 버전에서 Plugin API v3를 통한 페르소나 및 로어북 생성·수정·삭제가 가능**합니다. 전용 CRUD 함수 대신 `allowedDbKeys` 기반의 DB/캐릭터/채팅 API를 조합해 사용합니다.

| 저장소 | 페르소나 · 로어북 CRUD | `dbWrite` 권한 | 현재 선택 전역 페르소나 즉시 반영 | 핵심 주의점 |
|---|---|---|---|---|
| [`kwaroran/Risuai`](https://github.com/kwaroran/Risuai) (원본) | 가능 | 예 (3일 주기) | ❌ 미러 미동기화 (`bindedPersona` 우회) | `username`/`userIcon`/`personaPrompt`/`userNote`가 `allowedDbKeys`에 없음 |
| [`PocketRisu/PocketRisu`](https://github.com/PocketRisu/PocketRisu) | 가능 | 아니오 | ❌ 원본과 동일 | 미열람 채팅은 `_placeholder`이므로 `getChatFromIndex()` 선조회 후 `setChatToIndex()` 필수 |
| [`rpaddict/RisuBard`](https://github.com/rpaddict/RisuBard) | 가능 | 아니오 | ❌ 원본과 동일 | 일반 로어북 외에 자체 서사 메모리 **BardWiki v3 API**(`bardWikiWrite`) 추가 제공 |
| [`nevaeh5379/HaejeokRisuai`](https://github.com/nevaeh5379/HaejeokRisuai) | 가능 | 아니오 | ✅ 즉시 반영 | `personaStore` 도메인 스토어 구조로 미러 불일치 없음 |
| [`rsyumi/RisuNest`](https://github.com/rsyumi/RisuNest) | 가능 | 아니오 | ✅ 즉시 반영 | `setDatabaseLite({ characters })` 호출 시 에러 → 반드시 `setCharacter`/`setChatToIndex`/async `setDatabase` 사용 |
| [`devforai-creator/RisuAI-Hardened`](https://github.com/devforai-creator/RisuAI-Hardened) | 가능 | 아니오 | ❌ 원본과 동일 | 일부 최신 편의 API 미포함 → `setChatToIndex` 미존재 시 캐릭터 경유 폴백으로 보호 |

### 본체 UI 주의사항 2가지

1. **모듈 편집 화면 (`ModuleSettings.svelte`, `mode === 2`)**
   - 본체가 로컬 참조 `tempModule`을 보관하다가 하단 저장 버튼 클릭 시 `DBState.db.modules[editModuleIndex] = tempModule`로 덮어씁니다.
   - RisuHelper는 모듈 편집 화면이 감지되면 사전 경고 배너를 표시합니다.
2. **현재 선택된 전역 페르소나 (`PersonaSettings.svelte`)**
   - 원본 / PocketRisu / RisuBard에서는 `db.personas[db.selectedPersona]`만 수정하면 UI에 즉시 반영되지 않고, 다른 페르소나 클릭 시 `saveUserPersona()`가 기존 값으로 덮어씁니다.
   - **페르소나에 UUID를 부여하고 `chat.bindedPersona = persona.id`로 바인딩**하면 모든 호스트에서 즉시 반영됩니다.

---

## 2. Plugin v3 샌드박스 제약과 해결 아키텍처

### 샌드박스 제약
- `SafeElement`에는 `.value`, `setValue()`, `dispatchEvent()`, `selectionStart`/`selectionEnd`가 없습니다.
- `getAttribute()`는 `x-*` 속성만 허용합니다.
- `focus` / `focusin` / `input` / `change` 리스너가 차단되며 `event.target`도 제거됩니다.

### RisuHelper 돌파 아키텍처
1. **사전 포커스 캐싱 (`src/focus-detector.js`)**: `rootDoc = await Risuai.getRootDocument()`(`mainDom` 권한)에서 허용 이벤트(`pointerup`, `click`, `keyup`) 시마다 `rootDoc.querySelector('textarea:focus, input:focus, [contenteditable]:focus')`를 조회해 마지막 포커스 컨텍스트를 사전 캐싱합니다(플러그인 버튼 클릭 시 포커스가 풀리는 문제 해결).
2. **역매핑 분류**: `getOuterHTML()`의 여는 태그 속성(`placeholder`, `data-risu-idx`, `contenteditable`)과 상위 노드(`getParent`)의 인접 라벨(한국어/영어)·제목(`<h2>`)·활성 탭을 파싱해 실제 RisuAI DB 경로로 역매핑합니다.
3. **크로스-포크 DB/캐릭터/채팅 쓰기 (`src/host-adapter.js`)**: 읽기와 쓰기는 모두 Plugin v3 DB/캐릭터/채팅 API로 수행해 Svelte 5 `$state` 반응성으로 실제 웹·모바일 화면에 즉시 반영되도록 합니다. `plugins` 키는 어떤 경우에도 읽거나 쓰지 않습니다.
4. **반응형 오버레이 UI (`src/ui.js`, `src/style.js`)**: `showContainer('fullscreen')` 기반 투명 배경 `iframe` 내부에 PC 우측 드로어 / 모바일 하단 시트(`visualViewport` 대응)로 렌더링합니다.

---

## 3. 모듈 구성 및 핵심 파이프라인

```text
User Input + Detected/Manual Target
        │
        ▼
[focus-detector.js] ──▶ [host-adapter.js] (Target Snapshot + Extra Context)
                                │
                                ▼
                         [knowledge.js] (Screen-aware RisuAI/Fork Knowledge)
                                │
                                ▼
                    [llm.js] / [preset-engine.js]
                    (direct mode ↔ preset mode: .risup/.risupreset/.json + CBS + Modules)
                                │
                                ▼
                   Risuai.runLLMModel() Stream Reader
                                │
                                ▼
                  parseAssistantReply() (`risuhelper-proposal`)
                                │
                                ▼
             [text-edits.js] Diff Preview Card → User Review
                                │
                                ▼
             [host-adapter.js] Apply + 1-Click Undo Stack
```

### 주요 설계 원칙 및 안전장치
- **무의존성(Zero Runtime Dependencies)**: 순수 표준 Web API(`WebCrypto` AES-256-GCM, `DecompressionStream`, `TextEncoder`/`TextDecoder`)와 자체 MessagePack/RPack/CBS 구현만으로 단일 파일 `dist/risuhelper.js`를 빌드합니다.
- **검토 후 적용 및 대상 고정(Pinned Target)**: 일반 질문에는 데이터를 절대 수정하지 않으며, 제안 생성 시점의 대상(`pinnedTarget`)과 캐릭터/채팅 식별자(`hostBinding`)를 카드에 고정합니다. 본문 Diff뿐 아니라 로어북·페르소나·정규식의 메타데이터 변경(`metaChanges`)도 모두 카드에 표시합니다.
- **정밀 필드 단위 되돌리기(Surgical Undo)**: Undo 시 객체 전체 스냅샷을 덮어쓰지 않고 최신 캐릭터·채팅·모듈·페르소나를 다시 읽어(read-modify-write) 변경된 필드/항목만 복원·제거하여, 적용 이후 이어진 채팅이나 추가 항목을 보존합니다.
- **프롬프트 인젝션 및 데이터 유실 방어**:
  - 캐릭터(`ALLOWED_CHAR_FIELDS`), 로어북(`ALLOWED_LORE_TEXT_FIELDS`), 페르소나(`ALLOWED_PERSONA_TEXT_FIELDS`), 설정(`ALLOWED_CONFIG_KEYS`) 필드 화이트리스트를 강제하며, `patch_text`/`replace_text`에서 `proposal.target`으로 대상을 탈취하는 시도를 차단합니다.
  - 모델 입력 상한(`24,000자`)을 초과해 잘린 원문에는 전체 덮어쓰기(`replace_text` / Lua 전체 `code` 교체)를 차단하고 부분 편집(`patch_text` / `edits`)만 허용합니다.
  - 기존 V1/V2 트리거가 있는 상태에서 Lua로 전환할 때는 삭제·대체 경고와 명시적 확인 체크박스를 요구합니다.
- **되돌리기 기록(Undo Journal)**: 모든 쓰기는 `_commitCharacter` / `_commitChat` / `_commitDb`를 거치며, 이전 상태를 쓴 상태로 바꾸는 연산 목록(`src/undo-journal.js`의 `diffValues`)을 기록합니다. 기록은 순수 JSON이라 `pluginStorage`에 저장되어 새로고침 뒤에도 복원됩니다. 복원(`revertOps`)은 호스트가 아직 RisuHelper가 쓴 값을 갖고 있는 연산만 되돌리고, 이후 사용자가 고친 값은 충돌로 보고합니다. 목록 항목은 `id`/`chatId`가 있으면 그것으로, 없으면 인덱스와 식별 속성(`comment`, `key`, `name`)으로 다시 찾으므로 순서가 바뀌어도 동작합니다. 여러 제안은 `runGroup`으로 한 단위가 됩니다.
- **범위 공통 쓰기 경로**: 캐릭터·채팅·모듈 세 범위는 `_openScope`가 복제본(`root`)과 `commit(label)`을 돌려주는 하나의 경로를 씁니다. 로어북 생성·수정·폴더 정리·복구, Lua, 정규식, 단일 텍스트 필드 쓰기가 범위별 분기 없이 구현됩니다.
- **첫 메시지 전용 동작**: `patch_text`/`replace_text`는 현재 대상 한 곳만 고칠 수 있고 대상 변경은 프롬프트 인젝션 방지를 위해 차단되므로, 대상과 무관하게 쓸 수 있는 `update_greeting`(번호 -1 = `firstMessage`, n = `alternateGreetings[n]`, RisuAI의 `chat.fmIndex`와 같은 규칙)과 `create_greeting`(배열 끝에 추가)을 둡니다. `src/greetings.js`의 `planGreetingContext`가 요청마다 어떤 첫 메시지를 전문으로 보낼지 정하고 그 번호 목록(`greetingsShownFull`)을 제안의 고정 대상에 남기며, 목록에 없는 번호의 전체 덮어쓰기는 어댑터가 거부합니다. `char_alt_greeting` 대상은 번호가 없거나 범위를 벗어나면 1번으로 떨어지지 않고 "항목 미선택"으로 남습니다.
- **참조 검증(`_findReferenceError`)**: 제안이 이름으로 지정한 인덱스·ID는 미리보기와 적용 양쪽에서 같은 함수로 검사합니다. 존재하지 않으면 다른 항목으로 넘기거나 그대로 저장하지 않고 오류로 끝냅니다. 스키마에 없는 속성은 `findUnknownProposalKeys`로 찾아 카드에 표시합니다.
- **감지 진단**: 감지기는 호스트마다 지원이 다른 `SafeElement` 호출의 오류를 의도적으로 삼키지만, 진단을 켜면 삼킨 오류와 최종 신호를 `ctx.diagnostics`에 남겨 패널에서 볼 수 있습니다.
- **추측하지 않는 대상 판정**:
  - 필드 라벨·placeholder는 전체 일치(`labelIs`)로만 매칭합니다. 부분 일치는 `캐릭터 설명 Prefix`(전역 설정)나 `Additional Description`을 캐릭터 설명으로 오인해 엉뚱한 데이터를 덮어쓰게 만듭니다.
  - 알 수 없는 라벨, 목록 검색창, 매핑이 없는 PocketRisu `data-setting-id` 항목은 편집 가능한 대상이 아닌 `general` / `config(fieldKey 없음)`으로 분류합니다.
  - 로어북 범위(캐릭터/챗)는 항목에서 가장 가까운 조상이 포함하는 활성 탭(`button.bg-selected`, `[role="tab"][aria-selected="true"]`)의 라벨로 결정합니다. 탭 버튼은 목록의 형제 컨테이너 안에 있어 조상의 직계 자식만 봐서는 찾을 수 없습니다.
  - 열려 있는 모듈을 DOM 단서로 특정하지 못했거나(`fallback`) 동점인 모듈이 있으면(`ambiguous`) 미리보기와 적용을 모두 차단하고 모듈 선택기를 안내합니다. 모듈이 하나뿐이면(`single`) 그대로 진행합니다.
- **실제 호스트 DOM 회귀 테스트**: `tools/capture-host-fixtures.cjs`가 실제 호스트 화면의 DOM과 각 입력칸에 바인딩된 값을 기록하고, `tests/host-fixtures.test.mjs`가 그 스냅샷 위에서 감지기를 실행합니다. 기대 대상은 호스트가 바인딩한 값에서 유도되므로 감지 휴리스틱과 독립적입니다.
- **원문 구분자 프로토콜(Raw Delimiter Sections)**: 표준 JSON 외에 `<<<CODE>>>`, `<<<CONTENT>>>`, `<<<BEFORE>>>`/`<<<AFTER>>>`, `<<<IN>>>`/`<<<OUT>>>`, `<<<END>>>` 구분자를 지원해 따옴표·백슬래시가 많은 Lua/정규식/HTML 생성 시 JSON 이스케이프 오류를 방지합니다.
- **본체 프리셋 불변**: 프리셋 적용 모드의 `.risup` / `.risupreset` / `.json` 상태는 `pluginStorage`에 독립 저장되며 RisuAI 본체의 활성 프리셋이나 모듈 활성 상태를 변경하지 않습니다.
