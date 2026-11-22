# RisuHelper 아키텍처 및 RisuAI 포크 호환성 분석

> 버전: `0.2.0` · 라이선스: `GPL-3.0-only` · 외부 런타임 의존성: 0개

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

### 주요 설계 원칙
- **무의존성(Zero Runtime Dependencies)**: 순수 표준 Web API(`WebCrypto` AES-256-GCM, `DecompressionStream`, `TextEncoder`/`TextDecoder`)와 자체 MessagePack/RPack/CBS 구현만으로 단일 파일 `dist/risuhelper.js`를 빌드합니다.
- **검토 후 적용(Review-before-Apply)**: 일반 질문에는 데이터를 절대 수정하지 않으며, 편집·생성 제안은 줄 단위 Diff 카드 검증을 거쳐 사용자가 명시적으로 **적용**을 클릭할 때만 호스트 상태를 변경합니다.
- **본체 프리셋 불변**: 프리셋 적용 모드의 `.risup` / `.risupreset` / `.json` 상태는 `pluginStorage`에 독립 저장되며 RisuAI 본체의 활성 프리셋이나 모듈 활성 상태를 변경하지 않습니다.
