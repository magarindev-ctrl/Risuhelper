// SPDX-License-Identifier: GPL-3.0-only
// Shared pure-JS report summarizer and Markdown formatter for both the CLI runner
// (tools/eval-real-model.mjs) and the in-RisuAI temporary evaluator plugin (dist/risuhelper-eval.js).

const DEFAULT_MAX_TOKENS = 8192;

function summarizeResults(results, meta) {
  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  const mutation = results.filter(r => r.expectMode !== 'no_proposal');
  const guard = results.filter(r => r.expectMode === 'no_proposal');
  const mutationPassed = mutation.filter(r => r.ok).length;
  const guardPassed = guard.filter(r => r.ok).length;

  const sysChars = results.map(r => r.systemChars);
  const minSys = sysChars.length ? Math.min(...sysChars) : 0;
  const maxSys = sysChars.length ? Math.max(...sysChars) : 0;
  const avgSys = sysChars.length ? Math.round(sysChars.reduce((a, b) => a + b, 0) / sysChars.length) : 0;

  const latencies = results.map(r => r.latencyMs).filter(n => n > 0);
  const avgLatencyMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
  const totalIn = results.reduce((s, r) => s + (r.usage?.inputTokens || 0), 0);
  const totalOut = results.reduce((s, r) => s + (r.usage?.outputTokens || 0), 0);

  const callsList = results.map(r => (Number.isInteger(r.callsUsed) && r.callsUsed > 0 ? r.callsUsed : 1));
  const singleCallCount = callsList.filter(c => c === 1).length;
  const singleCallRate = total ? Number(((singleCallCount / total) * 100).toFixed(1)) : 0;
  const avgCallsUsed = total ? Number((callsList.reduce((a, b) => a + b, 0) / total).toFixed(2)) : 0;
  const maxCallsObserved = callsList.length ? Math.max(...callsList) : 0;
  const totalToolRuns = results.reduce((s, r) => s + (Number(r.toolRunsCount) || 0), 0);
  const totalRepairs = results.reduce((s, r) => s + (Number(r.repairedCount) || 0), 0);
  const loopResults = results.filter(r => r.requiresLoop);
  const loopPassed = loopResults.filter(r => r.ok).length;

  const byCategory = new Map();
  const byScenario = new Map();
  for (const r of results) {
    const cur = byCategory.get(r.category) || { total: 0, passed: 0 };
    cur.total++;
    if (r.ok) cur.passed++;
    byCategory.set(r.category, cur);

    const sc = byScenario.get(r.id) || { id: r.id, category: r.category, title: r.title, total: 0, passed: 0 };
    sc.total++;
    if (r.ok) sc.passed++;
    byScenario.set(r.id, sc);
  }

  const failuresByType = new Map();
  for (const r of results) {
    if (!r.ok) {
      const k = r.failureCategory || 'unknown';
      failuresByType.set(k, (failuresByType.get(k) || 0) + 1);
    }
  }

  return {
    meta,
    total,
    passed,
    passRate: total ? Number(((passed / total) * 100).toFixed(1)) : 0,
    mutationTotal: mutation.length,
    mutationPassed,
    guardTotal: guard.length,
    guardPassed,
    promptStats: { minSys, avgSys, maxSys },
    loopStats: {
      singleCallCount,
      singleCallRate,
      avgCallsUsed,
      maxCallsObserved,
      totalToolRuns,
      totalRepairs,
      loopTotal: loopResults.length,
      loopPassed,
    },
    avgLatencyMs,
    tokens: { input: totalIn, output: totalOut },
    byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })),
    byScenario: [...byScenario.values()],
    failuresByType: [...failuresByType.entries()].map(([type, count]) => ({ type, count })),
  };
}

function renderMarkdownReport(results, summary) {
  const runs = summary.meta.runs || 1;
  const metaParts = [];
  if (summary.meta.maxCalls) metaParts.push(`\`maxCalls=${summary.meta.maxCalls}\``);
  if (summary.meta.maxTokens) metaParts.push(`\`maxTokens=${summary.meta.maxTokens}\``);
  if (summary.meta.modelMode) metaParts.push(`\`modelMode=${summary.meta.modelMode}\``);
  if (summary.meta.platform) metaParts.push(`\`platform=${summary.meta.platform}\``);
  metaParts.push(`시나리오당 \`${runs}회\` 실행`);

  const scenarioCount = new Set(results.map(r => r.id)).size || summary.total;
  const ls = summary.loopStats || {
    singleCallCount: summary.total,
    singleCallRate: 100,
    avgCallsUsed: 1,
    maxCallsObserved: 1,
    totalToolRuns: 0,
    totalRepairs: 0,
    loopTotal: 0,
    loopPassed: 0,
  };
  const lines = [
    `# RisuHelper 실모델 ${scenarioCount}문항 평가 리포트`,
    '',
    `- **모드 / 모델**: ${summary.meta.mode}${summary.meta.model ? ` (\`${summary.meta.provider}:${summary.meta.model}\`)` : ''}`,
    `- **실행 시각**: ${summary.meta.timestamp}`,
    `- **설정**: ${metaParts.join(' · ')}`,
    `- **종합 통과율**: **${summary.passed} / ${summary.total} (${summary.passRate}%)**`,
    `  - 수정·생성 시나리오: **${summary.mutationPassed} / ${summary.mutationTotal}**`,
    `  - 안전·비수정 가드(단순 질문 · 콜드 스토리지): **${summary.guardPassed} / ${summary.guardTotal}**`,
    ...(ls.loopTotal > 0 ? [`  - 3회 루프 전용 시나리오(전문 조회 · L2 스킬 로드 · 자동 수정): **${ls.loopPassed} / ${ls.loopTotal}**`] : []),
    `- **호출 루프 지표**: 1회 종료 **${ls.singleCallCount}/${summary.total} (${ls.singleCallRate}%)** · 평균 ${ls.avgCallsUsed}회 · 최대 ${ls.maxCallsObserved}회 · 읽기 도구 ${ls.totalToolRuns}건 · 자동 수정 ${ls.totalRepairs}회`,
    `- **시스템 프롬프트 길이**: 최소 ${summary.promptStats.minSys.toLocaleString()}자 / 평균 ${summary.promptStats.avgSys.toLocaleString()}자 / 최대 ${summary.promptStats.maxSys.toLocaleString()}자`,
  ];
  if (summary.avgLatencyMs > 0) {
    lines.push(`- **평균 응답 시간**: ${summary.avgLatencyMs.toLocaleString()}ms`);
  }
  if (summary.tokens.input > 0 || summary.tokens.output > 0) {
    lines.push(`- **총 토큰**: 입력 ${summary.tokens.input.toLocaleString()} / 출력 ${summary.tokens.output.toLocaleString()}`);
  }

  lines.push('', '## 카테고리별 결과', '', '| 카테고리 | 통과 | 전체 |', '|---|---:|---:|');
  for (const row of summary.byCategory) {
    lines.push(`| ${row.category} | ${row.passed} | ${row.total} |`);
  }

  if (runs > 1 && summary.byScenario?.length) {
    lines.push('', `## 시나리오별 일관성 (${runs}회 반복)`, '', '| ID | 카테고리 | 통과 |', '|---|---|---:|');
    for (const sc of summary.byScenario) {
      lines.push(`| \`${sc.id}\` | ${sc.category} | ${sc.passed}/${sc.total} |`);
    }
  }

  if (summary.failuresByType.length > 0) {
    lines.push('', '## 실패 유형 분류', '', '| 실패 유형 | 건수 |', '|---|---:|');
    for (const row of summary.failuresByType) {
      lines.push(`| \`${row.type}\` | ${row.count} |`);
    }
  }

  lines.push('', '## 실행별 상세', '', '| # | ID | 회차 | 결과 | 호출 | 도구/수정 | 종료 사유 | 프롬프트(자) | 제안 액션 | 지연(ms) |', '|---:|---|---:|---|---:|---|---|---:|---|---:|');
  results.forEach((r, idx) => {
    const status = r.ok ? '✅ PASS' : `❌ FAIL (\`${r.failureCategory}\`)`;
    const acts = r.proposalActions.length ? r.proposalActions.join(', ') : '(없음)';
    const finish = r.finishReason || '-';
    const callsLabel = `${r.callsUsed || 1}/${r.maxCalls || 3}`;
    const toolMod = `${r.toolRunsCount || 0} / ${r.repairedCount || 0}`;
    lines.push(`| ${idx + 1} | \`${r.id}\` | ${r.runIndex || 1} | ${status} | ${callsLabel} | ${toolMod} | ${finish} | ${r.systemChars.toLocaleString()} | ${acts} | ${r.latencyMs} |`);
  });

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    lines.push('', '## 실패 상세 진단');
    for (const r of failed) {
      const runTag = runs > 1 ? ` (회차 ${r.runIndex || 1}/${runs})` : '';
      lines.push('', `### ❌ \`${r.id}\`${runTag} — ${r.title}`);
      if (r.finishReason) lines.push(`- 종료 사유: \`${r.finishReason}\``);
      for (const issue of r.issues) lines.push(`- ${issue}`);
      if (r.rawReplyExcerpt) {
        lines.push('', '<details><summary>모델 원문 발췌 (앞 500자)</summary>', '', '```text', r.rawReplyExcerpt, '```', '</details>');
      }
    }
  }

  return lines.join('\n') + '\n';
}

export { DEFAULT_MAX_TOKENS, summarizeResults, renderMarkdownReport };
