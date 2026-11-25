# RisuHelper 포크별 E2E 검증 하네스

원본 RisuAI 및 5대 공개 포크(PocketRisu, RisuBard, RisuNest, 해적리스, RisuAI-Hardened)에서 빌드된 단일 파일 번들(`dist/risuhelper.js`)의 핵심 흐름을 검증하는 러너입니다.

## 구성

- [`hosts.mjs`](hosts.mjs): 6개 호스트 프로파일(기본 URL, 기능 기대치, PocketRisu `_placeholder` 지연 채팅, RisuNest `setDatabaseLite({ characters })` 차단 및 `queryCharacters` 고속 경로 등 포크별 특성 시뮬레이터).
- [`scenarios.mjs`](scenarios.mjs): 3회 호출 루프(읽기 도구 · 자동 수정 · 3회 하드캡 · 거부 사유 보존), 경계 없는 타 캐릭터/타 채팅 수정 + `[다른 캐릭터: ...]`/`[다른 채팅: ...]` 고정 대상 표시, `create_chat` + 원클릭 이사 + 되돌리기 8종 대표 E2E 시나리오.
- [`run-fork-e2e.mjs`](run-fork-e2e.mjs): 시뮬레이션 모드(`--mode simulated`) 및 Chromium Playwright 실호스트 모드(`--mode playwright`) 통합 실행기.

## 실행 방법

### 1) 무의존성 포크 시뮬레이션 (CI / 로컬 즉시 실행)
```bash
npm run build
npm run e2e:sim
# 특정 호스트만 + 마크다운 리포트 저장
node tools/e2e/run-fork-e2e.mjs --host pocketrisu --mode simulated --out docs/e2e-results/pocketrisu-sim.md
```

### 2) 실제 호스트 Chromium(Playwright) 실행
각 포크의 로컬 개발 서버를 띄운 뒤 실행합니다:
```bash
node tools/e2e/run-fork-e2e.mjs --host risuai --mode playwright --url http://localhost:5174 --out docs/e2e-results/risuai.md
```

### 3) 실모델 31문항 평가 기준선 기록
```bash
# 3회 호출 모드 vs 1회 호출 모드 비교 (M1 통과 기준 측정)
OPENAI_API_KEY=... node tools/eval-real-model.mjs --provider openai --model <model> --max-calls 3 --out docs/eval-baselines/v0.7.0-calls3.md
OPENAI_API_KEY=... node tools/eval-real-model.mjs --provider openai --model <model> --max-calls 1 --out docs/eval-baselines/v0.7.0-calls1.md
```
또는 RisuAI 본체에 `dist/risuhelper-eval.js`를 임시 설치해 내장 모델로 31문항 평가(호출 상한 3회 / 1회 전환 지원)를 바로 실행할 수 있습니다.
