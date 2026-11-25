# RisuAI 및 5대 포크 Plugin API v3 전수 커버리지 매트릭스

> 기준 버전: `0.6.0` (M0 확정판) · 대조 대상:
> - **원본** [`kwaroran/Risuai`](https://github.com/kwaroran/Risuai)
> - **PocketRisu** [`PocketRisu/PocketRisu`](https://github.com/PocketRisu/PocketRisu)
> - **RisuBard** [`rpaddict/RisuBard`](https://github.com/rpaddict/RisuBard)
> - **RisuNest** [`rsyumi/RisuNest`](https://github.com/rsyumi/RisuNest)
> - **해적리스** [`nevaeh5379/HaejeokRisuai`](https://github.com/nevaeh5379/HaejeokRisuai)
> - **Hardened** [`devforai-creator/RisuAI-Hardened`](https://github.com/devforai-creator/RisuAI-Hardened)

모든 Plugin v3 API를 6개 정책 분류(① 기존 핵심 · ② 읽기/진단 도구 · ③ 승인형 쓰기 · ④ 선언형 상주 확장 · ⑤ 플러그인 내부/UX · ⑥ 보안 경계 LLM 미노출)로 100% 분류하고, 런타임 기능 탐지 계층([`src/host-capabilities.js`](../src/host-capabilities.js))과 1:1로 연동합니다.

---

## 1. 표준 Plugin v3 API 전수표

### ① 기존 핵심 (24개 — 사용 중)

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
| `getColorScheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **지원** (UI 테마 자동 동기화) |
| `pluginStorage` | 플러그인 저장소 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** (설정·프리셋·Undo 영속화) |
| `registerButton` | 호스트 버튼 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `registerSetting` | 호스트 설정 탭 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `unregisterUIPart` | UI 정리 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `showContainer` / `hideContainer` | 패널 표시 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |
| `onUnload` | 라이프사이클 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원** |

### ② 읽기 · 진단 도구 (10개)

| API | 범위 | 원본 | Pocket | Bard | Nest | 해적 | Hardened | 상태 / 마일스톤 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `getRuntimeInfo` | 호스트 런타임 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`0.6.0`)** — `host-capabilities.js` 탐지 + M1 `host_info` 도구 |
| `apiVersion` / `apiVersionCompatibleWith` | 버전 정보 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`0.6.0`)** — 기능 탐지 메타데이터 |
| `getCharacterFromIndex` | 임의 캐릭터 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`0.6.0`)** — 경계 없는 타 캐릭터 읽기·포팅 고속 경로 |
| `getCurrentLorebookEntries` | 현재 채팅 로어북 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M1 (`0.7.0`)** — `active_lorebook` 진단 도구 |
| `getTextTheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M1 (`0.7.0`)** / **M3 (`0.9.0`)** — 테마 조회·Undo |
| `getTranslationCache` | 전역 번역 캐시 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M1 (`0.7.0`)** — `search_translation` 도구 |
| `searchTranslationCache` | 전역 번역 캐시 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M1 (`0.7.0`)** — `search_translation` 도구 |
| `readImage` | 에셋 조회 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **M1 (`0.7.0`)** — `inspect_assets` 메타/존재 확인 |
| `readInlay` | 인레이 조회 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M1 (`0.7.0`)** — `inspect_assets` 메타 확인 |

### ③ 승인형 쓰기 동작 (9개)

| API | 범위 | 원본 | Pocket | Bard | Nest | 해적 | Hardened | 상태 / 마일스톤 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `setCharacterToIndex` | 임의 캐릭터 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **지원 (`0.6.0`)** — `targetCharIndex` 경계 없는 타 캐릭터 수정·Undo |
| `changeColorScheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.0`)** — 승인 카드 + Undo |
| `setColorScheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.0`)** — 승인 카드 + Undo |
| `changeTextTheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.0`)** — 승인 카드 + Undo |
| `setCustomTextTheme` | 전역 테마 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.0`)** — 승인 카드 + Undo |
| `saveAsset` | 에셋 등록 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **M3 (`0.9.0`)** — 에셋 등록 카드 |
| `createInlay` | 인레이 등록 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | **M3 (`0.9.0`)** — `capabilities.createInlay` 게이팅 (원본 전용) |
| `checkCharOrder` | 캐릭터 정렬 복구 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **M3 (`0.9.0`)** — 캐릭터 목록 정합성 복구 |
| `setChatPanel` | 채팅 화면 HUD | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.0`)** — 정화된 HTML/CBS 라이브 HUD·진단 패널 |

### ④ 선언형 상주 확장 (14개 — 임의 JS 실행 없음, 설정값/규칙 기반)

| API | 범위 | 원본 | Pocket | Bard | Nest | 해적 | Hardened | 상태 / 마일스톤 |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| `addRisuScriptHandler` / `removeRisuScriptHandler` | 전역 스크립트 훅 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **M3 (`0.9.2`)** — 선언형 전역 정규식/치환 규칙 |
| `addRisuReplacer` / `removeRisuReplacer` | 전역 요청/응답 치환 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **M3 (`0.9.2`)** — 선언형 치환 규칙 |
| `addRisuChatListener` / `removeRisuChatListener` | 응답 완료 감시 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.2`)** — 태그/변수 이상 자동 점검 알림 |
| `registerBodyIntercepter` / `unregisterBodyIntercepter` | 요청 본문 패치 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.2`)** — 조건부 JSON 패치 규칙 + 드라이런 |
| `registerMCP` / `unregisterMCP` | MCP 읽기 도구 제공 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.2`)** — RisuHelper Read-Only 도구 노출 |
| `addTTSPreprocessor` / `addTTSPostprocessor` | TTS 전/후처리 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.2`)** — 선언형 지문/태그 정리 규칙 |
| `addPluginChannelListener` / `postPluginChannelMessage` | 플러그인 간 통신 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | **M3 (`0.9.2`)** — V3 플러그인 연동 채널 |

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

## 2. 포크 전용 API 매트릭스

| 포크 | API | 범위 | 상태 / 마일스톤 |
|---|---|---|---|
| **RisuBard** | `bardWiki.getContext` (`_getBardWikiContext`) | 현재 스코프 | **M3 (`0.9.3`)** — BardWiki 읽기 도구 |
| **RisuBard** | `bardWiki.getDocuments` (`_getBardWikiDocuments`) | 현재 스코프 | **M3 (`0.9.3`)** — BardWiki 문서 목록·검색 |
| **RisuBard** | `bardWiki.saveDocument` (`_saveBardWikiDocument`) | 현재 스코프 | **M3 (`0.9.3`)** — 승인 카드 + Undo |
| **RisuBard** | `bardWiki.setContextMode` (`_setBardWikiContextMode`) | 현재 스코프 | **M3 (`0.9.3`)** — 승인 카드 + Undo |
| **RisuBard** | `bardWiki.setGrade` (`_setBardWikiGrade`) | 현재 스코프 | **M3 (`0.9.3`)** — 승인 카드 + Undo |
| **RisuBard** | `bardWiki.trashDocument` (`_trashBardWikiDocument`) | 현재 스코프 | **M3 (`0.9.3`)** — 확인 창 + Undo |
| **RisuNest** | `queryCharacters` | 전역 (페이지네이션) | **지원 (`0.6.0`)** — `readCharacterCatalog` 고속 경로 |
| **RisuNest** | `queryConversations` / `queryConversationMessages` | 임의 캐릭터·채팅 | **M1 (`0.7.0`)** / **M3 (`0.9.3`)** — `list_items`·`read_chat` 고속 경로 |
| **RisuNest** | `risunestReadConversationContext` / `risunestPatchConversation` | 임의 채팅 패치 | **M3 (`0.9.3`)** — RisuNest 대화 정밀 패치 |
| **RisuNest** | `risunestListHostTools` / `risunestCallHostTool` | 호스트 툴 | **M3 (`0.9.3`)** — 읽기 전용 호스트 툴 연동 |
| **RisuNest** | `risunestOnChatView` / `risunestOnGenerationEnd` | 라이프사이클 | **M3 (`0.9.3`)** — 포커스·응답 완료 이벤트 최적화 |
| **RisuNest** | `registerButton` (`MessageButtonTarget`) | 메시지별 버튼 | **M3 (`0.9.3`)** — 말풍선 원클릭 편집/디버깅 |
| **RisuNest** | `save(name, bytes)` | 파일 다운로드 | **M3 (`0.9.3`)** — 진단 리포트/프리셋 내보내기 |

---

## 3. 본체 구조상 현재 채팅 기준으로만 동작하는 API 4종 (명시적 예외)

RisuHelper 1.0.0의 모든 데이터 조작은 기본적으로 `targetCharIndex` / `targetChatIndex`를 통해 **현재 채팅·화면 경계 없이 어디서든 동작**하지만, 아래 4개 API는 RisuAI/포크 본체 구현 자체가 대상 인덱스를 인자로 받지 않고 "지금 열린 채팅"만 참조합니다.

1. `sendChat(message)` — 현재 열린 채팅에 유저 메시지 전송 및 응답 생성
2. `getCurrentLorebookEntries()` — 현재 열린 채팅에서 발동 중인 로어북 조회
3. `parseRisuChat(text, opts)` — 현재 선택된 캐릭터·채팅 변수 기준 CBS 평가
4. RisuBard `bardWiki.*` — 현재 열린 캐릭터·채팅 스코프(`getCurrentBardWikiScope()`) 기준 동작
