#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Real-model 20-scenario evaluation CLI for RisuHelper.
// Runs representative Korean user requests through RisuHelperApp's exact production
// prompt builder, proposal parser, preview validator, apply engine, and undo verifier.
//
// Examples:
//   node tools/eval-real-model.mjs --dry-run
//   node tools/eval-real-model.mjs --golden
//   OPENAI_API_KEY=... node tools/eval-real-model.mjs --provider openai --model gpt-4o-mini
//   OPENAI_API_KEY=... node tools/eval-real-model.mjs --provider openai --base-url https://openrouter.ai/api/v1 --model google/gemini-2.5-flash
//   ANTHROPIC_API_KEY=... node tools/eval-real-model.mjs --provider anthropic --model claude-sonnet-4-5
//   GEMINI_API_KEY=... node tools/eval-real-model.mjs --provider gemini --model gemini-2.5-flash

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVAL_SCENARIOS, runEvalScenario } from './eval-scenarios.mjs';

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    golden: false,
    provider: 'openai',
    model: '',
    baseUrl: '',
    apiKey: '',
    temperature: 0.2,
    maxTokens: 2048,
    concurrency: 2,
    timeoutSec: 90,
    only: null,
    out: '',
    jsonOut: '',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[++i];
    };
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--golden') opts.golden = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--provider') opts.provider = next().toLowerCase();
    else if (a === '--model') opts.model = next();
    else if (a === '--base-url') opts.baseUrl = next();
    else if (a === '--api-key') opts.apiKey = next();
    else if (a === '--temperature') opts.temperature = Number(next());
    else if (a === '--max-tokens') opts.maxTokens = Number(next());
    else if (a === '--concurrency') opts.concurrency = Math.max(1, Math.min(8, Number(next()) || 1));
    else if (a === '--timeout') opts.timeoutSec = Math.max(10, Number(next()) || 90);
    else if (a === '--only') opts.only = new Set(next().split(',').map(s => s.trim()).filter(Boolean));
    else if (a === '--out') opts.out = next();
    else if (a === '--json-out') opts.jsonOut = next();
    else throw new Error(`Unknown option: ${a}`);
  }
  return opts;
}

function usage() {
  return `RisuHelper Real-Model 20-Scenario Evaluation Harness

Usage:
  node tools/eval-real-model.mjs [options]

Modes:
  --dry-run                Build all 20 prompts and measure prompt sizes (0 API calls)
  --golden                 Verify all 20 scenarios & graders against golden replies (0 API calls)
  --provider <name>        openai (default, OpenAI/OpenRouter/Ollama/compat) | anthropic | gemini

Options:
  --model <id>             Model identifier (required for live API runs)
  --base-url <url>         Custom API base URL (e.g. https://openrouter.ai/api/v1 or http://127.0.0.1:11434/v1)
  --api-key <key>          API key (defaults to EVAL_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY)
  --temperature <num>      Sampling temperature (default: 0.2)
  --max-tokens <num>       Max output tokens (default: 2048)
  --concurrency <1..8>     Concurrent scenario requests (default: 2)
  --timeout <sec>          Per-request timeout in seconds (default: 90)
  --only <id1,id2,...>     Run only specific scenario IDs
  --out <file.md>          Write Markdown scorecard report to file
  --json-out <file.json>   Write full machine-readable JSON results to file
  -h, --help               Show this help
`;
}

function resolveApiKey(opts) {
  if (opts.apiKey) return opts.apiKey;
  if (process.env.EVAL_API_KEY) return process.env.EVAL_API_KEY;
  if (opts.provider === 'anthropic') return process.env.ANTHROPIC_API_KEY || '';
  if (opts.provider === 'gemini') return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  return process.env.OPENAI_API_KEY || '';
}

function makeProviderCaller(opts) {
  const apiKey = resolveApiKey(opts);
  if (!opts.model) throw new Error('--model is required for live API runs (or use --dry-run / --golden)');
  if (!apiKey && !opts.baseUrl) {
    throw new Error(`API key not found for provider "${opts.provider}". Pass --api-key or set EVAL_API_KEY / provider env var.`);
  }

  return async (messages) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutSec * 1000);
    try {
      if (opts.provider === 'openai') {
        const base = (opts.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: opts.model,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data)?.slice(0, 300)}`);
        }
        const text = data?.choices?.[0]?.message?.content ?? '';
        const usage = data?.usage
          ? { inputTokens: data.usage.prompt_tokens || 0, outputTokens: data.usage.completion_tokens || 0 }
          : null;
        return { text, usage };
      }

      if (opts.provider === 'anthropic') {
        const base = (opts.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
        const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const turns = messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));
        const res = await fetch(`${base}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: opts.model,
            system,
            messages: turns,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data)?.slice(0, 300)}`);
        }
        const text = (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
        const usage = data?.usage
          ? { inputTokens: data.usage.input_tokens || 0, outputTokens: data.usage.output_tokens || 0 }
          : null;
        return { text, usage };
      }

      if (opts.provider === 'gemini') {
        const base = (opts.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
        const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const contents = messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
        const url = `${base}/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: {
              temperature: opts.temperature,
              maxOutputTokens: opts.maxTokens,
            },
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${data?.error?.message || JSON.stringify(data)?.slice(0, 300)}`);
        }
        const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
        const usage = data?.usageMetadata
          ? { inputTokens: data.usageMetadata.promptTokenCount || 0, outputTokens: data.usageMetadata.candidatesTokenCount || 0 }
          : null;
        return { text, usage };
      }

      throw new Error(`Unsupported provider "${opts.provider}". Use openai, anthropic, or gemini.`);
    } finally {
      clearTimeout(timer);
    }
  };
}

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

  const byCategory = new Map();
  for (const r of results) {
    const cur = byCategory.get(r.category) || { total: 0, passed: 0 };
    cur.total++;
    if (r.ok) cur.passed++;
    byCategory.set(r.category, cur);
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
    avgLatencyMs,
    tokens: { input: totalIn, output: totalOut },
    byCategory: [...byCategory.entries()].map(([category, v]) => ({ category, ...v })),
    failuresByType: [...failuresByType.entries()].map(([type, count]) => ({ type, count })),
  };
}

function renderMarkdownReport(results, summary) {
  const lines = [
    `# RisuHelper 실모델 20문항 평가 리포트`,
    '',
    `- **모드 / 모델**: ${summary.meta.mode}${summary.meta.model ? ` (\`${summary.meta.provider}:${summary.meta.model}\`)` : ''}`,
    `- **실행 시각**: ${summary.meta.timestamp}`,
    `- **종합 통과율**: **${summary.passed} / ${summary.total} (${summary.passRate}%)**`,
    `  - 수정·생성 시나리오: **${summary.mutationPassed} / ${summary.mutationTotal}**`,
    `  - 안전·비수정 가드(단순 질문 · 콜드 스토리지): **${summary.guardPassed} / ${summary.guardTotal}**`,
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

  if (summary.failuresByType.length > 0) {
    lines.push('', '## 실패 유형 분류', '', '| 실패 유형 | 건수 |', '|---|---:|');
    for (const row of summary.failuresByType) {
      lines.push(`| \`${row.type}\` | ${row.count} |`);
    }
  }

  lines.push('', '## 문항별 상세', '', '| # | ID | 카테고리 | 결과 | 프롬프트(자) | 제안 액션 | 지연(ms) |', '|---:|---|---|---|---:|---|---:|');
  results.forEach((r, idx) => {
    const status = r.ok ? '✅ PASS' : `❌ FAIL (\`${r.failureCategory}\`)`;
    const acts = r.proposalActions.length ? r.proposalActions.join(', ') : '(없음)';
    lines.push(`| ${idx + 1} | \`${r.id}\` | ${r.category} | ${status} | ${r.systemChars.toLocaleString()} | ${acts} | ${r.latencyMs} |`);
  });

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    lines.push('', '## 실패 상세 진단');
    for (const r of failed) {
      lines.push('', `### ❌ \`${r.id}\` — ${r.title}`);
      for (const issue of r.issues) lines.push(`- ${issue}`);
      if (r.rawReplyExcerpt) {
        lines.push('', '<details><summary>모델 원문 발췌 (앞 500자)</summary>', '', '```text', r.rawReplyExcerpt, '```', '</details>');
      }
    }
  }

  return lines.join('\n') + '\n';
}

async function runWithConcurrency(items, concurrency, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }

  const scenarios = opts.only
    ? EVAL_SCENARIOS.filter(s => opts.only.has(s.id))
    : EVAL_SCENARIOS;

  if (scenarios.length === 0) {
    throw new Error('No scenarios matched --only filter.');
  }

  const mode = opts.dryRun ? 'dry-run' : opts.golden ? 'golden' : 'live';
  const callModel = mode === 'live' ? makeProviderCaller(opts) : null;
  const concurrency = mode === 'live' ? opts.concurrency : 1;

  console.log(`[eval] Running ${scenarios.length} scenarios (mode=${mode}${opts.model ? `, ${opts.provider}:${opts.model}` : ''})...\n`);

  const results = await runWithConcurrency(scenarios, concurrency, async (sc, idx) => {
    const r = await runEvalScenario(sc, {
      callModel,
      dryRun: opts.dryRun,
      useGolden: opts.golden,
    });
    const num = String(idx + 1).padStart(2, '0');
    const tag = r.ok ? 'PASS' : `FAIL(${r.failureCategory})`;
    const acts = r.proposalActions.length ? r.proposalActions.join(',') : 'none';
    console.log(`[${num}/${scenarios.length}] ${tag.padEnd(20)} ${r.id.padEnd(30)} sys=${String(r.systemChars).padStart(5)}c  acts=${acts}${r.latencyMs ? `  ${r.latencyMs}ms` : ''}`);
    if (!r.ok) {
      for (const issue of r.issues) console.log(`      -> ${issue}`);
    }
    return r;
  });

  const summary = summarizeResults(results, {
    mode,
    provider: opts.provider,
    model: opts.model,
    timestamp: new Date().toISOString(),
  });
  const md = renderMarkdownReport(results, summary);

  console.log(`\n[eval] Summary: ${summary.passed}/${summary.total} passed (${summary.passRate}%) | system prompt avg ${summary.promptStats.avgSys.toLocaleString()} chars (min ${summary.promptStats.minSys.toLocaleString()}, max ${summary.promptStats.maxSys.toLocaleString()})`);

  if (opts.out) {
    fs.writeFileSync(path.resolve(opts.out), md, 'utf8');
    console.log(`[eval] Wrote Markdown report to ${opts.out}`);
  }
  if (opts.jsonOut) {
    fs.writeFileSync(path.resolve(opts.jsonOut), JSON.stringify({ summary, results }, null, 2), 'utf8');
    console.log(`[eval] Wrote JSON report to ${opts.jsonOut}`);
  }

  if (summary.passed < summary.total) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`[eval] Error: ${err.message}`);
    process.exit(1);
  });
}

export { parseArgs, summarizeResults, renderMarkdownReport };
