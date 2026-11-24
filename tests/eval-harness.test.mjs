// Verifies the 20-scenario real-model evaluation harness itself against golden replies
// and known failure modes (zero network calls).

import test from 'node:test';
import assert from 'node:assert/strict';
import { EVAL_SCENARIOS, runEvalScenario } from '../tools/eval-scenarios.mjs';
import { summarizeResults, renderMarkdownReport } from '../tools/eval-real-model.mjs';

test('eval harness defines 20 unique scenarios and every scenario passes with its golden reply (including undo)', async () => {
  assert.equal(EVAL_SCENARIOS.length, 20);
  const ids = new Set(EVAL_SCENARIOS.map(s => s.id));
  assert.equal(ids.size, 20, 'all scenario IDs must be unique');

  const results = [];
  for (const sc of EVAL_SCENARIOS) {
    const res = await runEvalScenario(sc, { useGolden: true });
    assert.equal(res.ok, true, `golden failed for ${sc.id}: ${res.issues.join('; ')}`);
    assert.ok(res.systemChars > 2000, `${sc.id} should produce full real system prompt`);
    results.push(res);
  }

  const summary = summarizeResults(results, { mode: 'golden', provider: 'golden', model: '', timestamp: '2026-01-01T00:00:00Z' });
  assert.equal(summary.passed, 20);
  assert.equal(summary.total, 20);
  assert.equal(summary.passRate, 100);
  const md = renderMarkdownReport(results, summary);
  assert.match(md, /20 \/ 20 \(100%\)/);
});

test('eval harness catches over-eager edits, truncated overwrite attempts, parse errors, unknown keys, and cold-storage proposals', async () => {
  const byId = (id) => EVAL_SCENARIOS.find(s => s.id === id);

  // 1. Over-eager edit on pure Q&A
  const overEager = await runEvalScenario(byId('qa-no-proposal-cbs'), {
    callModel: async () => '설명입니다.\n```risuhelper-proposal\n{"action":"update_config","title":"억지 변경","changes":{"temperature":90}}\n```',
  });
  assert.equal(overEager.ok, false);
  assert.equal(overEager.failureCategory, 'overEagerEdit');

  // 2. Truncated overwrite blocked by preview
  const truncBlocked = await runEvalScenario(byId('focused-desc-truncated-guard'), {
    callModel: async () => '덮어씁니다.\n```risuhelper-proposal\n{"action":"replace_text","title":"전체 교체","content":"왕도의 대현자"}\n```',
  });
  assert.equal(truncBlocked.ok, false);
  assert.equal(truncBlocked.failureCategory, 'previewFailed');

  // 3. Broken JSON parse error
  const brokenJson = await runEvalScenario(byId('config-update-safe'), {
    callModel: async () => '```risuhelper-proposal\n{"action":"update_config", broken}\n```',
  });
  assert.equal(brokenJson.ok, false);
  assert.equal(brokenJson.failureCategory, 'parseError');

  // 4. Unknown schema key detected
  const unknownKey = await runEvalScenario(byId('config-update-safe'), {
    callModel: async () => '```risuhelper-proposal\n{"action":"update_config","title":"설정","changes":{"maxResponse":1500,"temperature":80},"bogusFlag":true}\n```',
  });
  assert.equal(unknownKey.ok, false);
  assert.equal(unknownKey.failureCategory, 'unknownKeys');
  assert.ok(unknownKey.unknownKeys.includes('bogusFlag'));

  // 5. Cold-stored chat proposal flagged
  const coldProp = await runEvalScenario(byId('chat-migration-cold-guard'), {
    callModel: async () => '옮깁니다.\n```risuhelper-proposal\n{"action":"import_chat","title":"콜드 이사","sourceChatIndex":0,"items":["variables"]}\n```',
  });
  assert.equal(coldProp.ok, false);
  assert.equal(coldProp.failureCategory, 'overEagerEdit');
});
