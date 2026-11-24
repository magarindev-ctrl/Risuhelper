// Verifies the 20-scenario real-model evaluation harness itself against golden replies
// and known failure modes (zero network calls).

import test from 'node:test';
import assert from 'node:assert/strict';
import { EVAL_SCENARIOS, runEvalScenario, hasUnclosedProposalFence, formatUndoConflict } from '../tools/eval-scenarios.mjs';
import { DEFAULT_MAX_TOKENS, parseArgs, summarizeResults, renderMarkdownReport } from '../tools/eval-real-model.mjs';

test('eval harness defines 26 unique scenarios and every scenario passes with its golden reply (including undo)', async () => {
  assert.equal(EVAL_SCENARIOS.length, 26);
  const ids = new Set(EVAL_SCENARIOS.map(s => s.id));
  assert.equal(ids.size, 26, 'all scenario IDs must be unique');

  const results = [];
  for (const sc of EVAL_SCENARIOS) {
    const res = await runEvalScenario(sc, { useGolden: true });
    assert.equal(res.ok, true, `golden failed for ${sc.id}: ${res.issues.join('; ')}`);
    assert.ok(res.systemChars > 2000, `${sc.id} should produce full real system prompt`);
    results.push(res);
  }

  const summary = summarizeResults(results, { mode: 'golden', provider: 'golden', model: '', maxTokens: DEFAULT_MAX_TOKENS, runs: 1, timestamp: '2026-01-01T00:00:00Z' });
  assert.equal(summary.passed, 26);
  assert.equal(summary.total, 26);
  assert.equal(summary.passRate, 100);
  const md = renderMarkdownReport(results, summary);
  assert.match(md, /26 \/ 26 \(100%\)/);
});

test('eval harness catches over-eager edits, preview errors (real error text), truncation, empty replies, parse errors, unknown keys, and undo conflict formatting', async () => {
  const byId = (id) => EVAL_SCENARIOS.find(s => s.id === id);

  // 1. Over-eager edit on pure Q&A
  const overEager = await runEvalScenario(byId('qa-no-proposal-cbs'), {
    callModel: async () => '설명입니다.\n```risuhelper-proposal\n{"action":"update_config","title":"억지 변경","changes":{"temperature":90}}\n```',
  });
  assert.equal(overEager.ok, false);
  assert.equal(overEager.failureCategory, 'overEagerEdit');

  // 2. Preview failure surfaces real preview.error (never "unknown")
  const badPatch = await runEvalScenario(byId('focused-desc-patch'), {
    callModel: async () => '고칩니다.\n```risuhelper-proposal\n{"action":"patch_text","title":"없는 문구","edits":[{"before":"존재하지 않는 원문 문장","after":"수정"}]}\n```',
  });
  assert.equal(badPatch.ok, false);
  assert.equal(badPatch.failureCategory, 'previewFailed');
  assert.doesNotMatch(badPatch.issues[0], /: unknown$/);
  assert.match(badPatch.issues[0], /일치|찾지 못|원문/);

  // 3. Truncated overwrite blocked by preview with real error text
  const truncBlocked = await runEvalScenario(byId('focused-desc-truncated-guard'), {
    callModel: async () => '덮어씁니다.\n```risuhelper-proposal\n{"action":"replace_text","title":"전체 교체","content":"왕도의 대현자"}\n```',
  });
  assert.equal(truncBlocked.ok, false);
  assert.equal(truncBlocked.failureCategory, 'previewFailed');
  assert.match(truncBlocked.issues[0], /한도|차단/);

  // 4. Truncated model output (provider finishReason=length / MAX_TOKENS) -> outputTruncated, NOT missingProposal
  const cutByLimit = await runEvalScenario(byId('lua-create-trigger'), {
    callModel: async () => ({
      text: 'Lua 코드를 작성하는 중입니다...',
      finishReason: 'length',
      truncated: true,
    }),
  });
  assert.equal(cutByLimit.ok, false);
  assert.equal(cutByLimit.failureCategory, 'outputTruncated');
  assert.equal(cutByLimit.truncated, true);
  assert.equal(cutByLimit.finishReason, 'length');

  // 5. Unclosed proposal fence (even if proxy omitted finishReason) -> outputTruncated
  assert.equal(hasUnclosedProposalFence('설명\n```risuhelper-proposal\n{"action":"update_lua"'), true);
  assert.equal(hasUnclosedProposalFence('설명\n```risuhelper-proposal\n{"action":"update_lua"}\n```'), false);
  const cutMidFence = await runEvalScenario(byId('lua-create-trigger'), {
    callModel: async () => '작성 중...\n```risuhelper-proposal\n{"action":"update_lua","title":"끊긴 블록"',
  });
  assert.equal(cutMidFence.ok, false);
  assert.equal(cutMidFence.failureCategory, 'outputTruncated');

  // 6. Empty response -> emptyResponse, NOT missingProposal
  const emptyReply = await runEvalScenario(byId('lua-create-trigger'), {
    callModel: async () => ({ text: '   ', finishReason: 'stop', truncated: false }),
  });
  assert.equal(emptyReply.ok, false);
  assert.equal(emptyReply.failureCategory, 'emptyResponse');

  // 7. Broken JSON parse error
  const brokenJson = await runEvalScenario(byId('config-update-safe'), {
    callModel: async () => '```risuhelper-proposal\n{"action":"update_config", broken}\n```',
  });
  assert.equal(brokenJson.ok, false);
  assert.equal(brokenJson.failureCategory, 'parseError');

  // 8. Unknown schema key detected
  const unknownKey = await runEvalScenario(byId('config-update-safe'), {
    callModel: async () => '```risuhelper-proposal\n{"action":"update_config","title":"설정","changes":{"maxResponse":1500,"temperature":80},"bogusFlag":true}\n```',
  });
  assert.equal(unknownKey.ok, false);
  assert.equal(unknownKey.failureCategory, 'unknownKeys');
  assert.ok(unknownKey.unknownKeys.includes('bogusFlag'));

  // 9. Cold-stored chat proposal flagged
  const coldProp = await runEvalScenario(byId('chat-migration-cold-guard'), {
    callModel: async () => '옮깁니다.\n```risuhelper-proposal\n{"action":"import_chat","title":"콜드 이사","sourceChatIndex":0,"items":["variables"]}\n```',
  });
  assert.equal(coldProp.ok, false);
  assert.equal(coldProp.failureCategory, 'overEagerEdit');

  // 10. Undo conflict objects format cleanly (never [object Object])
  const formatted = formatUndoConflict({ path: 'char.desc', reason: '적용 이후 값이 다시 변경되었습니다.' });
  assert.equal(formatted, 'char.desc: 적용 이후 값이 다시 변경되었습니다.');
  assert.doesNotMatch(formatted, /\[object Object\]/);
});

test('eval CLI defaults maxTokens to 8192 and supports --runs multi-run consistency reports', () => {
  const def = parseArgs([]);
  assert.equal(def.maxTokens, 8192);
  assert.equal(def.runs, 1);

  const multi = parseArgs(['--runs', '3', '--max-tokens', '16384']);
  assert.equal(multi.runs, 3);
  assert.equal(multi.maxTokens, 16384);

  const sampleResults = [
    { id: 'focused-desc-patch', category: '포커스 · 부분 편집', title: 't', expectMode: 'apply', ok: true, failureCategory: null, issues: [], systemChars: 8500, latencyMs: 500, usage: null, finishReason: 'stop', proposalActions: ['patch_text'], runIndex: 1 },
    { id: 'focused-desc-patch', category: '포커스 · 부분 편집', title: 't', expectMode: 'apply', ok: false, failureCategory: 'outputTruncated', issues: ['잘림'], systemChars: 8500, latencyMs: 600, usage: null, finishReason: 'length', proposalActions: [], runIndex: 2 },
  ];
  const summary = summarizeResults(sampleResults, { mode: 'live', provider: 'openai', model: 'test-m', maxTokens: 8192, runs: 2, timestamp: '2026-01-01T00:00:00Z' });
  assert.equal(summary.byScenario[0].passed, 1);
  assert.equal(summary.byScenario[0].total, 2);
  const md = renderMarkdownReport(sampleResults, summary);
  assert.match(md, /시나리오별 일관성 \(2회 반복\)/);
  assert.match(md, /\| `focused-desc-patch` \| 포커스 · 부분 편집 \| 1\/2 \|/);
});

test('dist/risuhelper-eval.js boots in a Plugin v3 sandbox, runs all 20 scenarios via runLLMModel without touching real host data, and renders copyable Markdown report', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const vm = await import('node:vm');
  const { fileURLToPath } = await import('node:url');
  const { createMockDocument } = await import('./helpers/mock-document.mjs');

  const evalBundlePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'risuhelper-eval.js');
  const code = fs.readFileSync(evalBundlePath, 'utf8');

  const headerLines = code.split('\n').filter(l => l.startsWith('//@'));
  assert.ok(Buffer.byteLength(headerLines.join('\n') + '\n', 'utf8') <= 500);
  assert.ok(headerLines.some(l => l === '//@name risuhelper-eval'));
  assert.ok(headerLines.some(l => l === '//@api 3.0'));

  const doc = createMockDocument();
  const registeredButtons = [];
  const unregisteredIds = [];
  let unloadFn = null;
  let shown = false;
  const calledModes = [];
  const forbiddenTouch = (name) => () => { throw new Error(`Evaluator plugin must never call host.${name}`); };

  // Match each scenario by user prompt and return its golden reply in RisuAI { type: 'success', result } format
  const goldenByPrompt = new Map(EVAL_SCENARIOS.map(s => [s.prompt, s.goldenReply]));
  const risuai = {
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async getRuntimeInfo() { return { apiVersion: '3.0', platform: 'web', saveMethod: 'local' }; },
    async registerButton(meta, cb) { registeredButtons.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(_n, cb, _i, _t, id) { registeredButtons.push({ meta: { id, location: 'setting' }, cb }); return { id }; },
    async unregisterUIPart(id) { unregisteredIds.push(id); },
    async onUnload(fn) { unloadFn = fn; },
    async showContainer() { shown = true; },
    async hideContainer() { shown = false; },
    async runLLMModel({ mode, messages }) {
      calledModes.push(mode);
      const userPrompt = messages[messages.length - 1]?.content || '';
      const reply = goldenByPrompt.get(userPrompt);
      assert.ok(reply, `unexpected prompt: ${userPrompt}`);
      return { type: 'success', result: reply };
    },
    getCharacter: forbiddenTouch('getCharacter'),
    setCharacter: forbiddenTouch('setCharacter'),
    getDatabase: forbiddenTouch('getDatabase'),
    setDatabase: forbiddenTouch('setDatabase'),
    setDatabaseLite: forbiddenTouch('setDatabaseLite'),
    setChatToIndex: forbiddenTouch('setChatToIndex'),
    sendChat: forbiddenTouch('sendChat'),
    getRootDocument: forbiddenTouch('getRootDocument'),
  };

  const sandbox = {
    risuai,
    Risuai: risuai,
    document: doc,
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Int32Array,
    DataView,
    URL,
    Blob,
    atob,
    crypto,
    DecompressionStream,
    ReadableStream,
    structuredClone,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'dist/risuhelper-eval.js' });
  await new Promise(r => setTimeout(r, 30));

  assert.equal(registeredButtons.length, 2);
  await registeredButtons[0].cb(); // open modal
  assert.equal(shown, true);

  const findAll = (pred) => {
    const out = [];
    const walk = (n) => {
      if (pred(n)) out.push(n);
      for (const c of n.children || []) walk(c);
    };
    walk(doc.body);
    return out;
  };

  // Switch model mode select to 'submodel'
  const selects = findAll(n => n.tagName === 'SELECT');
  selects[0].value = 'submodel';
  for (const fn of selects[0].listeners.get('change') || []) fn({ target: selects[0] });

  // Click '▶ 20문항 평가 시작'
  const startBtn = findAll(n => n.tagName === 'BUTTON' && n.textContent.includes('평가 시작'))[0];
  assert.ok(startBtn);
  startBtn.click();

  // Wait for all 26 virtual-host runs to complete
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (doc.querySelector('.rhe-textarea')?.value) break;
    await new Promise(r => setTimeout(r, 25));
  }

  assert.equal(calledModes.length, 26);
  assert.ok(calledModes.every(m => m === 'submodel'));
  const report = doc.querySelector('.rhe-textarea')?.value || '';
  assert.match(report, /26 \/ 26 \(100%\)/);
  assert.match(report, /modelMode=submodel/);
  assert.match(report, /platform=web\/local/);

  // Clean unload unregisters both UI parts
  await unloadFn();
  assert.equal(unregisteredIds.length, 2);
});

