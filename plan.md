# RisuHelper 1.0.0 계획

> 기준 버전: `0.5.1` · 목표 버전: `1.0.0`
> 이 문서는 1.0.0이 어떤 모습이어야 하는지와 거기까지 가는 마일스톤을 정합니다.
> 구현 세부(파일·함수 단위 작업)는 각 마일스톤을 시작할 때 따로 씁니다.

---

## 1. 1.0.0의 한 줄 정의

**RisuAI와 5대 포크가 플러그인에 열어 둔 API를 현재 채팅·화면 경계 없이 어디서든 요청에 따라 골라 쓰고, 한 번의 요청 안에서 최대 3회 LLM 호출로 필요한 스킬·데이터를 찾아 분석·검증한 뒤, 사용자의 승인을 받아 안전하게 적용·복원하는 도우미.**

세 기둥으로 이룹니다.

| 기둥 | 내용 | 지금 (`0.5.1`) | 1.0.0 목표 |
|---|---|---|---|
| **A. 요청당 LLM 최대 3회** | ① 스킬·읽기 도구 확정 → ② 받은 데이터 분석·검증 → ③ 최종 답변/자가 수정까지 한 요청 안에서 완료 | 항상 1회. 실패하면 사용자가 직접 재요청 | 최대 **3회** (설정 `1 / 2 / 3`, 기본 `3`) · 단순 요청은 1회 종료 |
| **B. 내장 스킬 라우터 완성** | 모든 지식·동작을 내장 스킬로 데이터화하고, 빠진 스킬은 모델이 L1 목록에서 스스로 불러옴 | L0(화면·키워드·직전 턴) 고정 14스킬 | L0/L1/L2 3계층 내장 라우터 · 도달 가능성 100% |
| **C. 호스트 API 전면 지원 + 경계 없는 제어** | 원본 + 5대 포크 API 전수 대응 + `targetCharIndex`/`targetChatIndex`로 현재 채팅·화면 경계 없이 적용 | 원본 기준 70여 개 중 24개 사용 · 현재 활성 캐릭터/채팅 위주 | 전 API 분류·대응 + **어디서든 타 캐릭터·타 채팅 제어 · `create_chat` 원클릭 이사 · 포크 전용 API** |

---

## 2. 출발점 (`0.5.1`에서 확인된 사실)

- 테스트 **266개 통과**, 번들 **718 KiB**, 소스 모듈 23개, 무의존성(Zero Runtime Dependencies).
- 제안 동작 **23종**, 내장 스킬 **14개**.
- `0.5.1`에서 다중 삭제 지문 고정, 삭제 정밀 Undo(`op: 'remove'`), 후속 턴 스킬·컨텍스트 유지, `create_character`의 `chats[0].id` UUID 생성(RisuNest·PocketRisu·RisuBard 호환) 및 미리보기 경량화 완료.
- 6개 공개 호스트 저장소 소스를 이미 확보·대조 완료:
  - 원본 `kwaroran/Risuai` · `PocketRisu/PocketRisu` · `rpaddict/RisuBard` · `rsyumi/RisuNest` · `nevaeh5379/HaejeokRisuai` · `devforai-creator/RisuAI-Hardened`.
- 아직 남아 있는 핵심 과제:
  1. 대필 모드(`chat_input`)에서 요청 내용과 무관하게 현재 채팅 대화가 최대 6만 자까지 통째로 실림.
  2. 캐릭터 간 작업(`port_from_character` 등)이 `getCharacterFromIndex` / `setCharacterToIndex` · RisuNest `query*` 대신 `getDatabase(['characters'])`를 읽음.
  3. 실모델 평가는 `0.4.10` 시점 20문항(20/20)뿐이며, `0.5.x` 신규 동작과 5개 호스트 실구동 E2E 검증이 아직 없음.

---

## 3. 바뀌지 않는 원칙

1. **쓰기는 언제나 사용자의 승인 뒤에.** 3회 안에서 어떤 조회·시뮬레이션이 돌더라도, 데이터 변경은 카드에서 `적용`을 누른 뒤에만 일어납니다.
2. **자동으로 도는 단계는 100% 읽기·시뮬레이션·진단만.** 자동 단계에서는 어떤 쓰기 API도 호출할 수 없습니다.
3. **현재 채팅·화면에 갇히지 않고 어디서든 제어하되, 대상은 카드에 명시·고정한다.** 타 캐릭터(`targetCharIndex`)·열려 있지 않은 다른 채팅(`targetChatIndex`)·전역 설정/테마/모듈 모두 화면 이동 없이 읽고 수정할 수 있으며, 승인 카드에 실제 대상과 `chaId`/`chatId`를 고정해 표시합니다. *(단, RisuAI 본체 API 자체가 현재 열린 채팅만 기준으로 삼는 4개 — `sendChat`, `getCurrentLorebookEntries`, `parseRisuChat`, RisuBard `bardWiki.*` — 와 본체 비공개 키는 예외)*
4. **모든 변경은 정밀 되돌리기(Undo) 가능하거나, 불가 시 적용 전에 밝힌다.** (예: `sendChat` 바로 전송)
5. **값은 플러그인이 옮기고, 모델은 무엇을 할지만 고른다.** 복사·이동·삭제 대상은 번호가 아니라 항목 지문/ID로 고정합니다.
6. **임의 코드 실행 금지.** 상주 확장은 모델이 쓴 JS를 실행하지 않고, 정해진 선언형 설정값/규칙으로만 동작합니다.
7. **포크 차이는 추측하지 않고 탐지한다.** 호스트에 없는 API는 스킬·도구 목록에서 자동으로 감춥니다.
8. **기능은 측정으로 통과시킨다.** 실모델 평가와 실호스트 실행을 거치지 않은 것은 완료가 아닙니다.
9. **모델에 보내는 것은 투명하게 표시한다.** 호출 횟수, 실행한 도구, 전송 글자 수를 패널에서 바로 확인합니다.

---

## 4. 기둥 A — 요청당 LLM 최대 3회

### 4.1 3단계 흐름과 호출 예산

한 번의 사용자 요청은 **최대 3회 호출**로 제한합니다. 4번째 호출은 없습니다.
흔한 요청(80% 이상)은 L0 덕분에 1회로 끝나고, 추가 정보가 필요하거나 검증에 실패한 경우에만 2·3회째를 씁니다.

```text
사용자 요청
   │
   ▼
[1회차 · 요청 파악 & 스킬·읽기 확정]
   │  L0 스킬로 바로 답할 수 있으면 답변/제안 생성
   │  └─ 미리보기·검증 통과 ──────────────────────────────────► 끝 (1회)
   │  부족한 스킬·원문·실행 결과가 필요하면 `risuhelper-tool` 배치 요청
   │
   ▼  (플러그인이 Read-Only 도구 병렬 실행)
[2회차 · 받은 데이터 분석 & 제안/검증]
   │  읽어 온 전문·진단 결과·시뮬레이션 결과를 분석해 답변/제안 생성
   │  └─ 미리보기·검증 통과 ──────────────────────────────────► 끝 (2회)
   │  파싱·스키마·미리보기에서 실패 시 오류+현재 원문 첨부 (또는 추가 1회 검증 요청)
   │
   ▼
[3회차 · 최종 답변 확정]
      실패한 제안을 자가 수정하거나 최종 분석 결과를 확정해 출력 ──► 끝 (최대 3회, 종료 보장)
```

- **배치 도구 호출**: 1·2회차에서 `risuhelper-tool` 배열로 여러 읽기 도구를 한 번에 요청해 3회 예산 안에서 최대한 많은 정보를 확보합니다.
- **자동 수정 흡수**: 제안이 파싱·스키마·미리보기(원문 불일치, 정규식 문법 오류 등)에서 실패하면 남은 예산 안에서 자동으로 수정안을 받아 옵니다.
- **종료 및 제어**: 3회차 뒤에는 추가 호출 없이 결과를 그대로 표시합니다. 설정에서 상한을 `1 / 2 / 3` 중 고를 수 있고(기본 `3`), 어느 단계에서든 `중단` 버튼이 즉시 동작합니다.
- **표시**: 진행 중 `"2/3 · 로어북 #12 · 채팅 변수 분석 중"` 표시, 완료 후 호출 횟수와 전송 글자 수를 남깁니다.

### 4.2 자동 실행 읽기·진단 도구 (11종, 전부 Read-Only)

| 도구 | 하는 일 | 없애는 기존 불편 |
|---|---|---|
| `load_skill` | L1 목록에서 필요한 내장 스킬의 지식·규칙·스키마 로드 | 키워드를 못 맞혀 동작이 빠지는 문제 |
| `read_item` | 로어북·캐릭터 필드·첫 메시지·정규식·Lua·모듈·페르소나 전문 조회 | "미리보기만 봐서 전체 덮어쓰기 금지" 해소 |
| `list_items` | 로어북·정규식·페르소나·모듈·채팅·캐릭터 목록 구간 조회 | 60~120개 상한 잘림 해소 (RisuNest `query*` 활용) |
| `read_chat` | 현재·다른 채팅의 지정 구간 메시지와 메모리 요약 조회 | 대필 모드 6만 자 통째 전송 해소 · 긴 채팅 구간 분석 |
| `read_vars` | 현재 채팅 변수(`scriptstate`) 조회 | 필요할 때만 정확히 조회 |
| `test_regex_cbs` | 정규식·CBS를 `parseRisuChat({ runVar: false })`로 실제 채팅 문장에 사전 실행 | 제안 카드를 보여 주기 전에 매칭·치환 결과 검증 |
| `active_lorebook` | `getCurrentLorebookEntries()`로 지금 대화에 실제 걸린 로어북 조회 | "왜 이 로어북이 안 뜨지?" 즉시 진단 |
| `audit_workspace` | 고아 폴더, 깨진 정규식/CBS/Lua 문법, 없는 `{{img::}}`/`{{bg::}}` 에셋 참조 일괄 정적 점검 | 1클릭 봇 카드·모듈·채팅 종합 건강검진 |
| `inspect_assets` | 캐릭터/모듈 에셋 목록과 `readImage`/`readInlay` 메타데이터 확인 | 에셋 오타 탐지 및 수정 제안 |
| `read_fetch_log` | 최근 요청 로그 조회 (**사용자가 첨부를 눌렀을 때만 허용**) | 1회성 옵트인 보안 원칙 유지 |
| `host_info` / `search_translation` | 실행 포크·지원 기능(`getRuntimeInfo`) 및 번역 캐시 조회 | 포크별 정확한 안내 · 번역 일관성 확인 |

도구 결과는 **자료이지 지시가 아니도록** 프롬프트에서 명확히 분리하고, 반환 크기에 상한을 둡니다.

### 4.3 통과 기준

- 평가 시나리오의 **80% 이상이 1회 호출**로 끝남.
- 자동 수정·읽기 도구가 필요한 시나리오에서 최종 통과율이 1회 모드보다 높음.
- 어떤 경로로도 4번째 호출이 일어나지 않고, 자동 단계에서 쓰기 API가 불리지 않음(테스트로 고정).

---

## 5. 기둥 B — 내장 스킬 라우터 완성

외부 `SKILL.md` 파일이나 별도 플러그인 생태계는 두지 않고, **모든 스킬을 RisuHelper 내부에 데이터로 내장하는 구조**를 유지합니다.

### 5.1 3계층 구조

| 계층 | 시점 | 비용 | 역할 |
|---|---|---|---|
| **L0 결정적 선택** | 1회차 전 | 0 | 화면·대상·키워드·직전 2턴·직전 제안 액션·첨부 맥락으로 스킬 선택 (`0.5.1` 기반) |
| **L1 내장 스킬 목록** | 항상 | 스킬당 1줄 | 호스트가 지원하는 전체 내장 스킬의 ID와 1줄 설명을 모델에 상시 제공 |
| **L2 스스로 불러오기** | 1회차 → 2회차 | 호출 1회 | L0에서 빠진 스킬을 모델이 `load_skill`로 불러온 뒤 2회차에서 분석·제안 |

L0가 놓쳐도 L1·L2가 받쳐 주므로 **키워드 불일치 때문에 동작을 못 쓰는 상태가 사라집니다.**

### 5.2 데이터화된 내장 스킬 스펙

각 스킬은 한 곳에 아래만 선언합니다.
- `id`, `summary`(L1용 1줄 설명), `knowledge`, `rules`, `schemas`, `actions`
- `triggers`: 화면, 대상 종류, 키워드, 첨부 맥락 조건
- `tools`: 연관 읽기 도구
- `requiresCapabilities`: 필요한 호스트 API/포크 조건 (미지원 호스트에서는 L0·L1 모두 자동 제외)
- `maxChars`: 프롬프트 글자 수 상한

### 5.3 통과 기준

- **도달 가능성 100%**: 모든 동작이 정확히 1개 내장 스킬에 속하고, 모든 스킬이 L1 목록에 노출됨(테스트).
- **안내문-스키마 일치**: 프롬프트에 이름이 나오는 동작은 스키마가 실려 있거나 L1 목록의 스킬로만 언급됨(테스트).
- **라우팅 말뭉치**: 실제 말투 발화 200개 이상에서 L0 재현율 95% 이상, 나머지는 L2 `load_skill`로 해결됨을 실모델로 확인.
- **스킬별 평가 시나리오**: 스킬마다 최소 3개(정상 2, 거부 1).
- **프롬프트 크기**: 흔한 화면에서 시스템 프롬프트 평균이 `0.5.1` 수준 이하 유지.

---

## 6. 기둥 C — 호스트 API 전면 지원 & 포크별 대응

### 6.1 원본 Plugin v3 API 전수 분류 (`risuai.d.ts` + 구현 메서드)

모든 API를 누락 없이 분류하고 `docs/api-coverage.md`에서 1:1 추적합니다.

| 분류 | 다루는 방식 | 대상 API |
|---|---|---|
| **① 이미 사용 (24)** | 유지·최적화 | `getCharacter` `setCharacter` `getChar` `setChar` `getChatFromIndex` `setChatToIndex` `getCurrentCharacterIndex` `getCurrentChatIndex` `getDatabase` `setDatabase` `setDatabaseLite` `runLLMModel` `parseRisuChat` `getFetchLogs` `sendChat` `getRootDocument` `getColorScheme` `pluginStorage` `registerButton` `registerSetting` `unregisterUIPart` `showContainer` `hideContainer` `onUnload` |
| **② 읽기·진단 도구로 추가 (10)** | 4.2의 Read-Only 도구 | `getRuntimeInfo` `apiVersion` `apiVersionCompatibleWith` `getCharacterFromIndex` `getCurrentLorebookEntries` `getTextTheme` `getTranslationCache` `searchTranslationCache` `readImage` `readInlay` |
| **③ 승인형 동작으로 추가 (9)** | 승인 카드 → 적용 → Undo | `changeColorScheme` `setColorScheme` `changeTextTheme` `setCustomTextTheme` `setCharacterToIndex` `saveAsset` `createInlay` `checkCharOrder` + 채팅 HUD 패널 **`setChatPanel`** |
| **④ 상주 확장 — 선언형 설정 (14)** | 사용자가 켠 규칙만 동작, 목록에서 켜기/끄기, 재시작 복원 (임의 JS 실행 없음) | `addRisuScriptHandler` `removeRisuScriptHandler` `addRisuReplacer` `removeRisuReplacer` `addRisuChatListener` `removeRisuChatListener` `registerBodyIntercepter` `unregisterBodyIntercepter` `registerMCP` `unregisterMCP` `addTTSPreprocessor` `addTTSPostprocessor` `addPluginChannelListener` `postPluginChannelMessage` |
| **⑤ 플러그인 내부/UX (13)** | 모델 미노출, 플러그인 내부 활용 | `createMutationObserver` `getLocalPluginStorage` `safeLocalStorage` `unwarpSafeArray` `log` `getArg` `getArgument` `setArg` `setArgument` `alert` `alertConfirm` `alertError` `requestPluginPermission` |
| **⑥ 보안상 미지원 — LLM 미노출 (5)** | 의도적 미지원으로 문서화 | `nativeFetch` `saveSecretHeader` `loadPlugins` `installPlugin` `addProvider` |

**핵심 포인트:**
- **`getCharacterFromIndex` / `setCharacterToIndex` 우선 적용**: 타 캐릭터 읽기·포팅·다중 캐릭터 일괄 튜닝에서 `db.characters` 전체 읽기/쓰기를 없앱니다.
- **`setChatPanel` (5개 호스트 공통 지원)**: 채팅 화면에 정화된 HTML/CBS 기반 상태 HUD나 활성 로어북·변수 진단 바를 승인 카드로 띄우고 원클릭으로 끌 수 있게 합니다.
- **④ 상주 확장**: 모델이 작성한 코드는 실행하지 않고, 선언형 규칙(전역 정규식/치환 파이프라인, 요청 본문 JSON 패치 규칙, 응답 후 태그/변수 점검 알림, TTS 텍스트 정리, 읽기 전용 MCP 도구 노출)으로만 제공하며 패널 `확장` 목록에서 관리합니다.

### 6.2 5대 포크 실소스 기반 대응 전략

6개 공개 저장소 소스를 이미 대조했으며, `src/host-capabilities.js` 한 곳에서 **호스트 판별 + 메서드 실호출 검증(Catch-all Proxy 우회)** 으로 지원 기능을 확정합니다.

| 호스트 | 소스 확인 | 확인된 차이 & 전용 API | 1.0.0 목표 |
|---|---|---|---|
| **RisuAI 원본** (`kwaroran/Risuai`) | ✅ 완료 | 기준 호스트 (`dbWrite` 3일 주기, `createInlay`·`setChatPanel` 지원) | 전 기능 + 실실행 E2E |
| **PocketRisu** (`PocketRisu/PocketRisu`) | ✅ 완료 | `createInlay` 미지원, `_placeholder` 지연 채팅, `chat.id` 필수, lazy asset manifest, `setChatPanel` 지원 | `createInlay` 자동 숨김 + `_placeholder`/manifest 완전 대응 + 실실행 E2E |
| **RisuBard** (`rpaddict/RisuBard`) | ✅ 완료 | PocketRisu 기반 + **`bardWiki.*` 6종** (`getContext`, `getDocuments`, `saveDocument`, `setContextMode`, `setGrade`, `trashDocument`) | **BardWiki 전용 내장 스킬** (조회·생성·수정·등급·컨텍스트 모드·휴지통 + Undo) + 실실행 E2E |
| **RisuNest** (`rsyumi/RisuNest`) | ✅ 완료 | **`queryCharacters` / `queryConversations` / `queryConversationMessages`**, **`risunestReadConversationContext` / `risunestPatchConversation`**, **`risunestListHostTools` / `risunestCallHostTool`**, **`risunestOnChatView` / `risunestOnGenerationEnd`**, **`MessageButtonTarget`** | 페이지네이션 조회 우선 경로 + 대화 정밀 패치 + 메시지 빠른 편집 버튼 + 실실행 E2E |
| **HaejeokRisuai** (`nevaeh5379/HaejeokRisuai`) | ✅ 완료 | 도메인 스토어(SQLite 스냅샷), `setCharacterToIndex` = `characterStore.snapshot.save`, 전역 페르소나 즉시 반영 | 캐릭터 단위 고속 경로 + 실실행 E2E |
| **RisuAI-Hardened** (`devforai-creator/RisuAI-Hardened`) | ✅ 완료 | 구형 편의 API 일부 미제공 | `setChatToIndex`/`setCharacterToIndex` 폴백 유지 |

### 6.3 API는 열려 있지만 아직 동작이 없는 핵심 데이터 영역

| 영역 | 새 동작 | 비고 |
|---|---|---|
| **새 채팅 생성 (`create_chat`) + 원클릭 이사** | 새 채팅 생성, 활성 전환, **`create_chat` → `import_chat` → 요약 로어북** 묶음 실행 | `chats[].id = UUID` 규칙으로 5대 포크 전 호환. *"요약해서 새 채팅으로 이사해줘"*를 한 번에 완료 |
| **채팅 메시지 관리** | 삭제·비활성화·북마크, 생성 정보·전송 프롬프트 조회 | 삭제는 확인 창 + 정밀 Undo |
| **메모리 (HypaV3 / HypaV2 / Supa)** | 요약 읽기·수정·중요 표시 | 임베딩 벡터와 본문이 어긋날 수 있음을 카드에 명시 |
| **캐릭터 온보딩** | 온보딩 폼 생성·수정 | 호스트 지원 여부 탐지 |
| **에셋 & 인레이** | `{{img::}}`/`{{bg::}}`/`{{audio::}}` 오타 검증, `saveAsset`·`createInlay` 등록 | 바이너리 원문은 모델에 보내지 않음 |
| **그룹챗** | 멤버 활성·발언 비율·그룹 설정 편집 | 기존 일괄 차단 해소, 그룹 전용 가드 적용 |
| **채팅 폴더 & 정리** | `chatFolders` 생성·이름 변경·이동 | 로어북 폴더 정리와 같은 고아 방지 규칙 |
| **테마 & 스타일** | 색상 스킴·텍스트 테마·CSS 통합 제어 | 즉시 반영 + 원클릭 Undo |

---

## 7. 마일스톤 (`0.6.0` → `1.0.0`)

각 마일스톤마다 실사용 가능한 릴리즈를 내며 점진적으로 완성합니다.

### M0 · 기반 정비 & 핵심 불편 제거 (`0.6.0`)
- `src/host-capabilities.js`(기능 탐지 계층) + `docs/api-coverage.md`(6개 호스트 대조 확정판).
- **대필 모드(`chat_input`) 6만 자 전송 해결**: 최근 10~12개 메시지 슬라이딩 윈도우(기본 ~10,000자) + 비대필 질문 시 대화 본문 생략.
- **`getCharacterFromIndex` / `setCharacterToIndex` 전환**: 타 캐릭터 조회·포팅에서 `db.characters` 전체 읽기 제거(RisuNest는 `queryCharacters` 우선).
- **`create_chat` + 원클릭 새 채팅 이사** 구현(5대 포크 `chat.id` 호환 + 묶음 Undo).
- `0.5.x`~`0.6.0` 전체 동작 **실모델 26문항 기준선 평가** 리포트 + 포크별 실구동 E2E 스크립트 뼈대.

### M1 · 3회 호출 루프 (`0.7.0`)
- `risuhelper-tool` 배치 프로토콜, 호출 예산(`1 / 2 / 3`, 기본 3), 3단계 흐름(스킬·도구 확정 → 데이터 분석 → 최종 답변/자가 수정), 진행 배지, 전송량 표시.
- Read-Only 읽기·진단 도구 11종 구현(`load_skill`, `read_item`, `list_items`, `read_chat`, `read_vars`, `test_regex_cbs`, `active_lorebook`, `audit_workspace`, `inspect_assets`, `read_fetch_log`, `host_info`/`search_translation`).
- 제안 파싱·스키마·미리보기 실패 시 남은 예산 내 자동 수정.
- **통과**: 4.3 기준 충족 + 자동 단계 쓰기 호출 0건 테스트 고정.

### M2 · 내장 스킬 라우터 완성 (`0.8.0`)
- 모든 내장 스킬 데이터화, L0/L1/L2 3계층 완성, `requiresCapabilities` 자동 숨김.
- 200+ 발화 라우팅 말뭉치 + 스킬별 평가 시나리오(최소 3개/스킬).
- **통과**: 5.3 기준 충족.

### M3 · API 전면 확장 & 포크 전용 기능 (`0.9.x`)
- **`0.9.0`**: 승인형 API 추가(테마 `ColorScheme`/`TextTheme`, 에셋 `saveAsset`/`createInlay`, 다중 캐릭터 편집 `setCharacterToIndex`, `checkCharOrder`, `setChatPanel` HUD).
- **`0.9.1`**: 미지원 데이터 영역 완성(채팅 메시지 관리, Hypa/Supa 메모리, 온보딩, 그룹챗, 채팅 폴더, 1클릭 종합 건강검진 + 수리 카드).
- **`0.9.2`**: 선언형 상주 확장(전역 스크립트/치환, 요청 본문 JSON 패치, 응답 후 점검 훅, TTS 정리, 읽기 전용 MCP 도구 노출, `PluginChannel` + 패널 `확장` 목록).
- **`0.9.3`**: 포크 전용 기능(RisuBard **BardWiki v3** 스킬, RisuNest `query*`·`risunestPatchConversation`·메시지 버튼, PocketRisu·HaejeokRisuai 최적화 + 5개 호스트 E2E 스위트 완성).
- **통과**: `docs/api-coverage.md` 미분류 API 0개, 모든 지원 항목 테스트 + 실실행 기록 확보.

### M4 · 안정화 & 출시 (`1.0.0-rc` → `1.0.0`)
- 기능 추가 중단. 5개 호스트 전체 대표 흐름 E2E 실행, 모바일/도킹 UX 점검, 대형 라이브러리 부하 확인(캐릭터 100+, 로어북 300+, 메시지 1,000+, 설명 6만 자).
- 실모델 3종 × 전체 시나리오 × 3회 최종 평가, 번들 최적화, 최종 문서 정리.

---

## 8. `1.0.0` 출시 기준

- [ ] 실제 모델 3종(상위 1, 중간 1, 경량 1) × 전체 시나리오 × 3회: 상위·중간 **95% 이상**, 경량 **85% 이상**.
- [ ] 거부("하면 안 되는 경우") 시나리오는 모든 모델에서 **100%**.
- [ ] 요청의 **80% 이상이 1회 호출**로 끝나고, **3회를 넘는 경로가 없다**.
- [ ] `docs/api-coverage.md`에 미분류 API 0개.
- [ ] 5개 호스트(원본 · PocketRisu · RisuBard · RisuNest · 해적리스)에서 대표 흐름 전체 실실행 기록이 저장소에 있다.
- [ ] 모든 쓰기 동작에 `적용 → 후속 변경 → 되돌리기` 왕복 테스트가 있다.
- [ ] 자동 단계에서 쓰기 API가 불리지 않음을 보장하는 테스트가 있다.
- [ ] 알려진 데이터 손실 버그 0개.

---

## 9. 착수 전 확인할 것

포크 저장소 위치와 API 조사는 이미 끝났습니다. 아래 한 가지만 정하면 바로 **M0 (`0.6.0`)** 를 시작할 수 있습니다.

- **실모델 평가 3종 조합과 비용 한도**: 상위·중간·경량으로 쓸 실제 모델 3종(예: Claude / Gemini / 경량 모델) 선정.

---

## 10. 위험과 대응

| 위험 | 대응 |
|---|---|
| 3회 호출로 비용·지연 증가 | 1회 종료 비율(80%+) 출시 기준 관리, 배치 도구 호출, 상한 설정(`1/2/3`), 호출 수·전송량 표시 |
| 경량 모델의 도구 형식 오류 | L0으로 1회 응답 경로 유지, 관용 JSON 복구 파서, 남은 예산의 자동 수정 단계가 흡수 |
| 읽어 온 채팅·로그를 통한 프롬프트 인젝션 | 자동 단계 100% Read-Only, 자료 블록 격리, 쓰기는 항상 승인 카드, ⑥번 보안 API LLM 미노출 |
| 대형 라이브러리 지연 | `getCharacterFromIndex`/`setCharacterToIndex`, RisuNest `query*`, `list_items` 분할 조회, 대필 슬라이딩 윈도우 |
| 포크 변경으로 동작 깨짐 | `host-capabilities.js` 기능 탐지 + 5개 호스트 실실행 E2E 스크립트 상시 실행 |
| 번들 크기(`718 KiB`) 증가 | 내장 스킬 데이터화로 중복 제거, M4에서 상한 점검 |

---

## 11. 하지 않는 것 (1.0.0 범위 밖)

- 사용자 승인 없는 자동 쓰기, 4회 이상의 LLM 호출 루프.
- 모델이 작성한 JS 코드를 플러그인 안에서 실행하는 것(`eval`/`Function`).
- 외부 `SKILL.md` 파일 관리·공유 생태계 (모든 스킬은 내장 구조 유지).
- LLM의 자율 네트워크 송신·비밀값 저장·플러그인 설치(`nativeFetch`, `saveSecretHeader`, `loadPlugins`, `installPlugin`, `addProvider`).
