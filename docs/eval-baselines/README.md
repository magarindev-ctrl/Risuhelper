# RisuHelper 실모델 평가 기준선 (Eval Baselines)

이 디렉터리에는 [`tools/eval-real-model.mjs`](../../tools/eval-real-model.mjs) 또는 RisuAI 내장 임시 평가 플러그인(`dist/risuhelper-eval.js`)으로 실행한 **실제 모델 31문항 평가 리포트**를 마크다운 파일로 기록합니다.

## 측정 기준 (M0 · M1 통과 조건)

- **종합 통과율 및 M0/M1 신규 동작 확인**: 31문항(기존 26문항 + M0 `create_chat`·타 채팅 로어북 2문항 + M1 3회 루프 3문항: 전문 조회 · L2 스킬 로드 · 자동 수정).
- **1회 호출 종료 비율**: 전체 시나리오의 **80% 이상**이 1회 호출로 완료 (`호출 루프 지표`에 자동 집계).
- **최대 호출 상한**: 어떤 시나리오에서도 `maxCallsObserved <= 3`.
- **1회 모드 대비 3회 모드 향상**: `--max-calls 1`과 `--max-calls 3` 리포트를 나란히 저장해 루프 시나리오(3문항) 통과율 향상을 확인.

## 실행 명령 예시

```bash
# 1) CLI로 실행 (OpenAI / OpenRouter / Anthropic / Gemini)
OPENAI_API_KEY=... node tools/eval-real-model.mjs \
  --provider openai --model <model-id> --max-calls 3 --runs 3 \
  --out docs/eval-baselines/v0.7.0-<model>-calls3.md

OPENAI_API_KEY=... node tools/eval-real-model.mjs \
  --provider openai --model <model-id> --max-calls 1 \
  --out docs/eval-baselines/v0.7.0-<model>-calls1.md

# 2) RisuAI 앱 내부에서 실행 (API 키 별도 입력 불필요)
# dist/risuhelper-eval.js 설치 → ☰ 메뉴 "RisuHelper 31문항 평가" →
# 호출 상한 "최대 3회 (기본)" / "1회 (비교용)" 실행 후 마크다운 리포트 복사·저장
```

## 현재 저장소 기록 현황

- **하네스 무결성 (Golden 31/31 · Undo 왕복 0충돌)**: 통과 (`maxCalls=3`: 31/31, 1회 종료 28/31 = 90.3%, 평균 시스템 프롬프트 10,284자 / `maxCalls=1`: 28/31, 루프 3문항 실패 확인).
- **실제 모델 기준선 리포트**: 실행 환경에 외부 LLM API 키가 없어 아직 미기록 상태입니다. 위 명령 또는 `dist/risuhelper-eval.js`로 실행한 리포트를 이 폴더에 커밋해 기준선을 확정합니다.
