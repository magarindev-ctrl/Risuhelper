# RisuAI 및 5대 포크 Plugin API v3 전수 커버리지 매트릭스

> 기준 버전: `1.0.0` (M0~M4 완료 · 미분류 API 0개 · 전 API 실소스 시그니처 대조 완료) · 대조 대상:
> - **원본** [`kwaroran/Risuai`](https://github.com/kwaroran/Risuai) (`src/ts/plugins/apiV3/v3.svelte.ts`, `risuai.d.ts`, `plugins.svelte.ts`, `pluginmcp.ts`)
> - **PocketRisu** [`PocketRisu/PocketRisu`](https://github.com/PocketRisu/PocketRisu) (`src/ts/plugins/apiV3/v3.svelte.ts`)
> - **RisuBard** [`rpaddict/RisuBard`](https://github.com/rpaddict/RisuBard) (`src/ts/plugins/apiV3/v3.svelte.ts`, `risuai.d.ts`)
> - **RisuNest** [`rsyumi/RisuNest`](https://github.com/rsyumi/RisuNest) (`src/ts/plugins/apiV3/v3.svelte.ts`, `risunestPrivateApi.ts`, `conversationPatch.ts`, `risuai.d.ts`)
> - **해적리스** [`nevaeh5379/HaejeokRisuai`](https://github.com/nevaeh5379/HaejeokRisuai) (`src/ts/plugins/apiV3/v3.svelte.ts`)
> - **Hardened** [`devforai-creator/RisuAI-Hardened`](https://github.com/devforai-creator/RisuAI-Hardened)

모든 Plugin v3 API를 6개 정책 분류(① 기존 핵심 · ② 읽기/진단 도구 · ③ 승인형 쓰기 · ④ 선언형 상주 확장 · ⑤ 플러그인 내부/UX · ⑥ 보안 경계 LLM 미노출)로 100% 분류하고, 런타임 기능 탐지 계층([`src/host-capabilities.js`](../src/host-capabilities.js))과 1:1로 연동합니다.

> **검증 범위 안내 (실구동 vs 실소스 대조 시뮬레이션 구분)**
> - 아래 표의 `✅` / `❌`는 **6개 공개 저장소 실소스(`v3.svelte.ts`/`risuai.d.ts`) 직접 대조 기준의 API 제공 여부**입니다.
> - **실제 브라우저(Chromium) RisuAI 실구동 검증**: 3회 호출 루프, 경계 없는 타 캐릭터·타 채팅 쓰기, 새 채팅 생성·이사·되돌리기, 실모델 49/49([`v0.8.0`](eval-baselines/v0.8.0-risuai-submodel-49.md)) 및 71/71([`v0.9.9`](eval-baselines/v0.9.9-risuai-submodel-71.md)) 통과, 실제 Chromium 감사에서 드러난 상주 확장 3건(`beforeRequest` 배열, `body_intercepter` `{ id }`, `chat_listener` `'output'`) 및 실소스 전수 대조로 찾은 M3 시그니처 수정 완료.
> - **엄격 시그니처 6-호스트 시뮬레이션 E2E** (`npm run e2e:sim`, [`docs/e2e-results/v1.0.0-simulated-6hosts.md`](e2e-results/v1.0.0-simulated-6hosts.md)): 원본·PocketRisu·RisuBard·RisuNest·해적리스·Hardened의 실제 업스트림 시그니처를 강제 검증하는 시뮬레이터에서 전체 자동 통과. 포크 5종 실서버 Chromium 실행은 [`tools/e2e/run-fork-e2e.mjs`](../tools/e2e/run-fork-e2e.mjs) `--mode playwright`로 수행합니다.

---

## 1. 표준 Plugin v3 API 전수표

### ① 기존 핵심 (24개 — 지원 완료)

| API | 범위 | 원본 | Pocket | Bard | Nest | 해적 | Hardened | RisuHelper 상태 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `getCharacter` / `getChar` | 현재 캐릭터 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `setCharacter` / `setChar` | 현재 캐릭터 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `getChatFromIndex` | 임의 캐릭터·채팅 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (PocketRisu `_placeholder` 자동 하이드레이션) |
| `setChatToIndex` | 임의 캐릭터·채팅 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (경계 없는 채팅 쓰기) |
| `getCurrentCharacterIndex` | 현재 인덱스 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `getCurrentChatIndex` | 현재 인덱스 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `getDatabase` | 전역 DB | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (`plugins` 키 영구 제외) |
| `setDatabase` | 전역 DB | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (async 우선, `plugins` 제외) |
| `setDatabaseLite` | 전역 DB | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **폴백 전용** (`characters` 전달 금지) |
| `runLLMModel` | LLM 호출 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원** |
| `parseRisuChat` | 현재 채팅 CBS | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원** (`runVar: false` 강제) |
| `getFetchLogs` | 전역 로그 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (수동 1회성 옵트인 + 비밀값 마스킹) |
| `sendChat` | 현재 채팅 전송 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원** (확인 팝업 후 전송) |
| `getRootDocument` | 호스트 DOM | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (포커스 감지·도킹) |
| `getColorScheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원** (`{ name, scheme }` 언래핑 + UI 테마 동기화 + Undo) |
| `pluginStorage` | 플러그인 저장소 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (설정·프리셋·Undo·상주 확장 영속화) |
| `registerButton` | 호스트 버튼 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (햄버거 + RisuNest `MessageButtonTarget`) |
| `registerSetting` | 호스트 설정 탭 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `unregisterUIPart` | UI 정리 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (RisuNest 이벤트 ID 정리 포함) |
| `showContainer` / `hideContainer` | 패널 표시 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `onUnload` | 라이프사이클 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (상주 확장·리스너·UI 100% 해제) |

### ② 읽기 · 진단 도구 (10개 — 전원 지원 완료)

| API | 범위 | 원본 | Pocket | Bard | Nest | 해적 | Hardened | 상태 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `getRuntimeInfo` | 호스트 런타임 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`0.7.0`)** — `host-capabilities.js` 탐지 + `host_info` |
| `apiVersion` / `apiVersionCompatibleWith` | 버전 정보 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`0.7.0`)** — 기능 탐지 및 `host_info` |
| `getCharacterFromIndex` | 임의 캐릭터 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`0.7.0`)** — 경계 없는 타 캐릭터 읽기·포팅·`read_item` |
| `getCurrentLorebookEntries` | 현재 채팅 로어북 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`0.7.0`)** — `active_lorebook` 진단 도구 |
| `getTextTheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `{ name, customTheme }` 언래핑 + `host_info` + Undo |
| `getTranslationCache` | 전역 번역 캐시 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`0.7.0`)** — `search_translation` 도구 |
| `searchTranslationCache` | 전역 번역 캐시 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`0.7.0`)** — `search_translation` 도구 |
| `readImage` | 에셋 조회 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`0.7.0`)** — `inspect_assets` 메타/존재 확인 |
| `readInlay` | 인레이 조회 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`0.7.0`)** — `inspect_assets` 메타 확인 |

### ③ 승인형 쓰기 동작 (9개 — 전원 지원 완료)

| API | 범위 | 원본 | Pocket | Bard | Nest | 해적 | Hardened | 상태 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `setCharacterToIndex` | 임의 캐릭터 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`0.6.0`)** — `targetCharIndex` 경계 없는 타 캐릭터 수정·Undo |
| `changeColorScheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `update_theme` 프리셋 검증 + 충돌 감지 Undo |
| `setColorScheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `update_theme` 10개 필수 키 자동 병합 + Undo |
| `changeTextTheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `update_theme` (`standard`/`highcontrast`) + Undo |
| `setCustomTextTheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `update_theme` 6개 필수 키 자동 병합 + Undo |
| `saveAsset` | 에셋 등록 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`1.0.0`)** — `register_asset` (`saveAsset(Uint8Array)` 1인자 + Undo) |
| `createInlay` | 인레이 등록 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **지원 (`1.0.0`)** — `register_asset(inlay)` (`createInlay(Uint8Array, { name })` · 원본 전용 게이팅) |
| `checkCharOrder` | 캐릭터 정렬 복구 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`1.0.0`)** — `repair_workspace` 일괄 수리 카드 + Undo |
| `setChatPanel` | 채팅 화면 HUD | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `set_chat_panel` HTML/CBS 보안 정화 HUD + 원클릭 닫기·Undo |

### ④ 선언형 상주 확장 (14개 — 실소스 시그니처 정렬 · 임의 JS 금지 · ReDoS/서킷브레이커/안전모드)

| API | 범위 | 원본 | Pocket | Bard | Nest | 해적 | Hardened | 상태 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `addRisuScriptHandler` / `removeRisuScriptHandler` | 전역 스크립트 훅 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`1.0.0`)** — `script_handler` (`display`/`output`/`input`/`process`) + ReDoS 차단 + 서킷브레이커 |
| `addRisuReplacer` / `removeRisuReplacer` | 전역 요청/응답 치환 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`1.0.0`)** — `replacer` (`beforeRequest` `OpenAIChat[]` 배열 보존 / `afterRequest` 문자열) |
| `addRisuChatListener` / `removeRisuChatListener` | 응답 완료 감시 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `chat_listener` (`'output'` 모드 2인자 + `ChatOutputListenerArg` 파싱) |
| `registerBodyIntercepter` / `unregisterBodyIntercepter` | 요청 본문 패치 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `body_intercepter` (`{ id }` 핸들 반환·ID 해제 + 안전 파라미터 허용목록) |
| `registerMCP` / `unregisterMCP` | MCP 읽기 도구 제공 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `mcp_server` (`plugin:risuhelper:*` Read-Only 진단 도구 노출) |
| `addTTSPreprocessor` / `addTTSPostprocessor` | TTS 전/후처리 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `tts_processor` (`addTTSPreprocessor` `BeforeTTSContext`→`{ text }` 텍스트 정리; `Postprocessor`는 오디오 `ArrayBuffer` 전용으로 텍스트 규칙 미노출) |
| `addPluginChannelListener` / `postPluginChannelMessage` | 플러그인 간 통신 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원 (`1.0.0`)** — `plugin_channel` (3인자 `postPluginChannelMessage(pluginName, channel, msg)`) |

### ⑤ 플러그인 내부 · UX 전용 (13개 — 모델 미노출)

| API | 원본 | Pocket | Bard | Nest | 해적 | Hardened | 용도 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `createMutationObserver` / `unwarpSafeArray` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 호스트 DOM 관찰·배열 언래핑 |
| `getLocalPluginStorage` / `safeLocalStorage` | ✅ | ✅ | ✅ | ✅ | ✅ | ❌(local) | 로컬 캐시·보조 저장 |
| `log` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 내부 진단 로그 |
| `getArg` / `getArgument` / `setArg` / `setArgument` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 플러그인 인자 읽기/쓰기 |
| `alert` / `alertConfirm` / `alertError` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 패널 외부 보조 알림(주 확인은 패널 내 `.rh-modal`) |
| `requestPluginPermission` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 기능 활성화 시 사용자 권한 안내 |

### ⑥ 보안상 의도적 미지원 (5개 — LLM 미노출)

| API | 미지원 사유 |
|---|---|
| `nativeFetch` | 프롬프트 인젝션에 의한 외부 데이터 유출(SSRF/exfiltration) 방지 |
| `saveSecretHeader` | API 키·인증 헤더 변조 및 탈취 방지 |
| `loadPlugins` / `installPlugin` | 모델에 의한 임의 플러그인 설치·권한 상승 방지 |
| `addProvider` | 커스텀 LLM 프로바이더 가로채기 및 무한 재귀 호출 방지 |

---

## 2. 포크 전용 API 매트릭스 (실소스 계약 정렬 완료)

| 포크 | API | 범위 | 상태 |
|---|---|---|---|
| **RisuBard** | `bardWiki.getContext` (`_getBardWikiContext`) | 현재 스코프 | **지원 (`1.0.0`)** — `read_bard_wiki` 읽기 도구 |
| **RisuBard** | `bardWiki.getDocuments` (`_getBardWikiDocuments`) | 현재 스코프 | **지원 (`1.0.0`)** — `read_bard_wiki` 문서 목록·`contentHash` 조회 |
| **RisuBard** | `bardWiki.saveDocument` (`_saveBardWikiDocument`) | 현재 스코프 | **지원 (`1.0.0`)** — `manage_bard_wiki` (`{ type, title, markdown, expectedContentHash }` + Undo) |
| **RisuBard** | `bardWiki.setContextMode` (`_setBardWikiContextMode`) | 현재 스코프 | **지원 (`1.0.0`)** — `manage_bard_wiki` (문서별 `{ documentId, contextMode, expectedContentHash }` + Undo) |
| **RisuBard** | `bardWiki.setGrade` (`_setBardWikiGrade`) | 현재 스코프 | **지원 (`1.0.0`)** — `manage_bard_wiki` (`{ documentId, grade: 0..9\|null, expectedContentHash }` + Undo) |
| **RisuBard** | `bardWiki.trashDocument` (`_trashBardWikiDocument`) | 현재 스코프 | **지원 (`1.0.0`)** — `manage_bard_wiki` 확인 창 + Undo |
| **RisuNest** | `queryCharacters` | 전역 (페이지네이션) | **지원 (`0.6.0`)** — `readCharacterCatalog` 고속 경로 |
| **RisuNest** | `queryConversations` / `queryConversationMessages` | 임의 캐릭터·채팅 | **지원 (`1.0.0`)** — `PluginConversationQuery`/`MessageQuery` (`characterId`/`conversationId`/`.messages`) 고속 경로 |
| **RisuNest** | `risunestReadConversationContext` / `risunestPatchConversation` | 임의 채팅 패치 | **지원 (`1.0.0`)** — `patch_risunest_conversation` (`ConversationPatchRequest`: `messages` + `chatVariables` 원자 패치 + `expected` 충돌 감지 Undo) |
| **RisuNest** | `risunestListHostTools` / `risunestCallHostTool` | 호스트 툴 | **지원 (`1.0.0`)** — `inspect_host_tools` 읽기 전용 목록 조회(자동 쓰기 차단) |
| **RisuNest** | `risunestOnChatView` / `risunestOnGenerationEnd` | 라이프사이클 | **지원 (`1.0.0`)** — `{ id }` 반환값 `unregisterUIPart(id)` 완전 정리 |
| **RisuNest** | `registerButton` (`MessageButtonTarget`) | 메시지별 버튼 | **지원 (`1.0.0`)** — 말풍선 원클릭 RisuHelper 편집 버튼 |
| **공통 (RisuNest Tauri 포함)** | 표준 Blob `<a download>` 다운로드 | 진단 리포트 저장 | **지원 (`1.0.0`)** — `💾 진단 리포트 저장` 전 호스트 지원 (RisuNest Tauri `SandboxHost` 다운로드 핸들러 자동 연동) |

---

## 3. 본체 구조상 현재 채팅 기준으로만 동작하는 API 4종 (명시적 예외)

RisuHelper 1.0.0의 모든 데이터 조작은 기본적으로 `targetCharIndex` / `targetChatIndex`를 통해 **현재 채팅·화면 경계 없이 어디서든 동작**하지만, 아래 4개 API는 RisuAI/포크 본체 구현 자체가 대상 인덱스를 인자로 받지 않고 "지금 열린 채팅"만 참조합니다.

1. `sendChat(message)` — 현재 열린 채팅에 유저 메시지 전송 및 응답 생성
2. `getCurrentLorebookEntries()` — 현재 열린 채팅에서 발동 중인 로어북 조회
3. `parseRisuChat(text, opts)` — 현재 선택된 캐릭터·채팅 변수 기준 CBS 평가
4. RisuBard `bardWiki.*` — 현재 열린 캐릭터·채팅 스코프(`getCurrentBardWikiScope()`) 기준 동작
