// SPDX-License-Identifier: GPL-3.0-only
// Bounded 3-call LLM orchestrator + dynamic 3-stage planned pipeline handoff for RisuHelper 1.1.0.
// Normal requests finish in 1..3 calls (Call 1: direct answer or tool selection, Call 2: analyze, Call 3: repair).
// Large-scale requests (e.g. 40K full rewrite or 100-item batch edits) can emit `risuhelper-plan` to enter
// the dynamic staged pipeline (Step 1 -> Step 2 0..N -> Step 3 0..M) with user confirmation gate, rolling summary,
// and raw-chunk eviction. All automatic steps are 100% Read-Only; writes happen ONLY when the user clicks "적용".

import {
  DEFAULT_MAX_REQUEST_CHARS,
} from './version.js';
import {
  callRisuModel,
  parseAssistantReply,
  buildToolResultsFollowUpMessage,
  buildAutoRepairFollowUpMessage,
  enforceRequestCharBudget,
} from './llm.js';
import {
  executeReadToolBatch,
  describeToolCall,
} from './read-tools.js';
import {
  runStagedPipeline,
} from './staged-pipeline.js';

const MAX_AGENT_CALLS = 3;

function normalizeMaxCalls(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return MAX_AGENT_CALLS;
  return Math.max(1, Math.min(MAX_AGENT_CALLS, Math.round(n)));
}

function measureMessagesChars(messages) {
  let total = 0;
  for (const m of messages || []) {
    total += String(m?.content ?? '').length;
  }
  return total;
}

function throwIfCancelled(job) {
  if (job?.cancelled) {
    throw new Error(job.cancelReason || '사용자가 요청을 중단했습니다.');
  }
}

function extractReadExcerptFromBatch(batch) {
  for (const run of batch?.runs || []) {
    if (!run?.ok || run.tool !== 'read_item' || !run.result) continue;
    for (const key of ['content', 'code', 'out', 'prompt', 'personaPrompt']) {
      if (typeof run.result[key] === 'string' && run.result[key].trim()) {
        return run.result[key];
      }
    }
  }
  return '';
}

/**
 * Runs a single user request through a strictly bounded 1..3 call LLM loop, with optional handoff
 * to the dynamic 3-stage planned pipeline when the model emits a valid `risuhelper-plan` block.
 */
async function runAgentLoop({
  api,
  adapter,
  initialMessages,
  callModel = callRisuModel,
  modelOptions = {},
  job = null,
  pinnedCtx = null,
  currentSourceExcerpt = '',
  maxCalls = MAX_AGENT_CALLS,
  maxRequestChars = DEFAULT_MAX_REQUEST_CHARS,
  enablePipeline = true,
  pipelineLimits = {},
  confirmLargePlan = true,
  onConfirmPlan = null,
  toolContext = {},
  onProgress = null,
}) {
  const budget = normalizeMaxCalls(maxCalls);
  let currentMessages = Array.isArray(initialMessages) ? initialMessages.map(m => ({ ...m })) : [];
  const livePinnedCtx = pinnedCtx ? JSON.parse(JSON.stringify(pinnedCtx)) : {};
  const loadedSkillIds = new Set();
  const fieldsShownFull = new Set(Array.isArray(livePinnedCtx.fieldsShownFull) ? livePinnedCtx.fieldsShownFull : []);
  const greetingsShownFull = new Set(Array.isArray(livePinnedCtx.greetingsShownFull) ? livePinnedCtx.greetingsShownFull : []);
  const itemsShownFull = new Set(Array.isArray(livePinnedCtx.itemsShownFull) ? livePinnedCtx.itemsShownFull : []);

  let totalPromptChars = 0;
  let budgetTrimmedNotes = [];
  const steps = [];
  const toolRuns = [];
  const repairHistory = [];
  let repairedCount = 0;
  let prevToolSig = null;
  let prevFailedRawReply = null;
  let lastSourceExcerpt = String(currentSourceExcerpt || '');
  let nextPhase = 'initial';

  // Ensure job.stop cancels both in-flight LLM streams and inter-call tool/preview phases.
  const hasManagedStop = Boolean(job && Object.prototype.hasOwnProperty.call(job, '_activeStop'));
  const origJobStop = job && !hasManagedStop ? job.stop : null;

  for (let call = 1; call <= budget; call++) {
    throwIfCancelled(job);

    const budgeted = enforceRequestCharBudget(currentMessages, maxRequestChars);
    currentMessages = budgeted.messages;
    if (budgeted.trimmed) {
      budgetTrimmedNotes = budgeted.trimmedNotes;
    }

    const promptChars = measureMessagesChars(currentMessages);
    totalPromptChars += promptChars;

    const llmStageLabel = budget <= 1
      ? '응답 생성 중...'
      : nextPhase === 'analyze'
        ? `${call}/${budget} · 조회한 데이터 분석 중...`
        : nextPhase === 'repair'
          ? `${call}/${budget} · 제안 오류 자동 수정 중...`
          : `${call}/${budget} · 요청 분석 및 응답 생성 중...`;

    onProgress?.({
      call,
      maxCalls: budget,
      stage: 'llm',
      phase: nextPhase,
      promptChars,
      label: llmStageLabel,
    });

    const callJob = {
      cancelled: Boolean(job?.cancelled),
      onChunk: typeof job?.onChunk === 'function'
        ? (partial) => {
            if (!job?.cancelled) job.onChunk(partial, { call, maxCalls: budget, phase: nextPhase });
          }
        : null,
      stop: null,
    };

    const forwardStop = (reason = '사용자가 요청을 중단했습니다.') => {
      if (job) {
        job.cancelled = true;
        job.cancelReason = reason;
      }
      callJob.cancelled = true;
      if (typeof callJob.stop === 'function') callJob.stop(reason);
    };

    if (job) {
      if (hasManagedStop) {
        job._activeStop = forwardStop;
      } else {
        job.stop = forwardStop;
      }
    }

    let rawReply;
    try {
      rawReply = await callModel(api, currentMessages, modelOptions, callJob);
    } finally {
      if (job) {
        if (hasManagedStop) {
          job._activeStop = null;
        } else if (origJobStop !== undefined) {
          job.stop = origJobStop;
        }
      }
    }

    throwIfCancelled(job);

    const parsed = parseAssistantReply(rawReply);

    // Branch P: Dynamic 3-Stage Planned Pipeline (`risuhelper-plan`)
    if (enablePipeline && budget > 1 && parsed.plan) {
      const pipeRes = await runStagedPipeline({
        api,
        adapter,
        plan: parsed.plan,
        step1CallCount: call,
        step1PromptChars: totalPromptChars,
        callModel,
        modelOptions,
        job,
        pinnedCtx: livePinnedCtx,
        toolContext,
        maxRequestChars,
        pipelineLimits,
        confirmLargePlan,
        onConfirmPlan,
        onProgress,
      });
      // Prepend any pre-plan steps/tools (e.g. if Call 1 ran search_workspace and Call 2 emitted plan)
      pipeRes.steps = [...steps, ...pipeRes.steps];
      pipeRes.toolRuns = [...toolRuns, ...pipeRes.toolRuns];
      pipeRes.loadedSkillIds = [...new Set([...loadedSkillIds, ...(pipeRes.loadedSkillIds || [])])];
      pipeRes.budgetTrimmedNotes = budgetTrimmedNotes;
      return pipeRes;
    }

    // Branch A: Read-Only tool calls (only allowed while budget remains)
    if (parsed.toolCalls.length > 0 && call < budget) {
      const toolSig = JSON.stringify(parsed.toolCalls);
      if (toolSig === prevToolSig) {
        steps.push({ call, phase: 'tools_duplicate', promptChars, toolCount: 0, tools: [] });
        currentMessages.push({ role: 'assistant', content: rawReply });
        currentMessages.push({
          role: 'user',
          content: `[호출 ${call + 1}/${budget}] 직전과 동일한 읽기 도구를 다시 요청했습니다. 이미 전달된 결과를 바탕으로 추가 도구 호출 없이 최종 답변 또는 \`\`\`risuhelper-proposal 블록을 작성하세요.`,
        });
        nextPhase = 'analyze';
        continue;
      }
      prevToolSig = toolSig;

      const toolLabels = parsed.toolCalls.map(describeToolCall);
      const summaryLabel = toolLabels.slice(0, 2).join(' · ') + (toolLabels.length > 2 ? ` 외 ${toolLabels.length - 2}건` : '');
      onProgress?.({
        call,
        maxCalls: budget,
        nextCall: call + 1,
        stage: 'tools',
        tools: toolLabels,
        label: `${call + 1}/${budget} · ${summaryLabel} 조회 중...`,
      });

      const batch = await executeReadToolBatch(adapter, parsed.toolCalls, toolContext);
      throwIfCancelled(job);

      for (const id of batch.loadedSkillIds || []) loadedSkillIds.add(id);
      for (const f of batch.fieldsShownFull || []) fieldsShownFull.add(f);
      for (const g of batch.greetingsShownFull || []) greetingsShownFull.add(g);
      for (const k of batch.itemsShownFull || []) itemsShownFull.add(k);
      livePinnedCtx.fieldsShownFull = [...fieldsShownFull];
      livePinnedCtx.greetingsShownFull = [...greetingsShownFull];
      livePinnedCtx.itemsShownFull = [...itemsShownFull];

      const freshExcerpt = extractReadExcerptFromBatch(batch);
      if (freshExcerpt) lastSourceExcerpt = freshExcerpt;

      for (const run of batch.runs || []) {
        toolRuns.push({
          call,
          tool: run.tool,
          label: run.label,
          ok: Boolean(run.ok),
          error: run.ok ? '' : String(run.result?.error || ''),
        });
      }
      steps.push({
        call,
        phase: 'tools',
        promptChars,
        toolCount: batch.runs.length,
        tools: toolLabels,
      });

      currentMessages.push({ role: 'assistant', content: rawReply });
      currentMessages.push({
        role: 'user',
        content: buildToolResultsFollowUpMessage(batch, {
          callNumber: call + 1,
          maxCalls: budget,
          toolErrors: parsed.toolErrors,
        }),
      });
      nextPhase = 'analyze';
      continue;
    }

    // Dry-run preview every parsed proposal (strictly Read-Only)
    const previewedProposals = [];
    for (const prop of parsed.proposals) {
      throwIfCancelled(job);
      const preview = await adapter.previewProposal(prop, livePinnedCtx);
      previewedProposals.push({ proposal: prop, preview });
    }

    const failedProposals = previewedProposals.filter(item => !item.preview?.ok);
    const hasParseErrors = parsed.errors.length > 0 || (parsed.planErrors?.length > 0 && parsed.proposals.length === 0);
    const hasPreviewFailures = failedProposals.length > 0;
    const hasBlockingToolErrors = parsed.toolErrors.length > 0 && parsed.proposals.length === 0 && !parsed.prose;
    const needsRepair = hasParseErrors || hasPreviewFailures || hasBlockingToolErrors;

    // Branch B: Auto-repair parse / validation / preview failures while budget remains
    if (needsRepair && call < budget) {
      // Zero-progress guard: avoid burning extra calls when a model/mock repeats the exact same failing reply
      if (prevFailedRawReply !== null && String(rawReply || '').trim() === prevFailedRawReply.trim()) {
        steps.push({
          call,
          phase: 'final_no_progress',
          promptChars,
          proposalCount: previewedProposals.length,
          failedCount: failedProposals.length,
        });
        return {
          rawReply,
          parsed,
          previewedProposals,
          pinnedCtx: livePinnedCtx,
          callsUsed: call,
          maxCalls: budget,
          totalPromptChars,
          budgetTrimmedNotes,
          steps,
          toolRuns,
          repairedCount,
          repairHistory,
          loadedSkillIds: [...loadedSkillIds],
          fieldsShownFull: [...fieldsShownFull],
          greetingsShownFull: [...greetingsShownFull],
          itemsShownFull: [...itemsShownFull],
        };
      }

      prevFailedRawReply = String(rawReply || '');
      repairedCount++;
      const repairReasons = [
        ...(parsed.errors || []).map(e => `파싱 실패: ${e?.error || String(e)}`),
        ...(parsed.planErrors || []).map(e => `계획 블록 오류: ${e?.error || String(e)}`),
        ...(parsed.toolErrors || []).map(e => `도구 오류: ${e?.error || String(e)}`),
        ...failedProposals.map(item => {
          const act = item?.proposal?.action || 'unknown';
          const ttl = item?.proposal?.title ? ` (${item.proposal.title})` : '';
          return `${act}${ttl}: ${item?.preview?.error || '미리보기 실패'}`;
        }),
      ];
      repairHistory.push({ call, reasons: repairReasons });
      steps.push({
        call,
        phase: 'repair',
        promptChars,
        errorCount: repairReasons.length,
        reasons: repairReasons,
      });

      onProgress?.({
        call,
        maxCalls: budget,
        nextCall: call + 1,
        stage: 'repair',
        label: `${call + 1}/${budget} · 제안 오류 자동 수정 중...`,
      });

      currentMessages.push({ role: 'assistant', content: rawReply });
      currentMessages.push({
        role: 'user',
        content: buildAutoRepairFollowUpMessage({
          parseErrors: [...parsed.errors, ...(parsed.planErrors || []), ...parsed.toolErrors],
          failedProposals,
          currentSourceExcerpt: lastSourceExcerpt,
          callNumber: call + 1,
          maxCalls: budget,
        }),
      });
      nextPhase = 'repair';
      continue;
    }

    // Branch C: Final result (budget completed or all checks passed)
    if (call === budget && parsed.toolCalls.length > 0 && parsed.proposals.length === 0 && !parsed.prose) {
      parsed.prose = `최대 LLM 호출 횟수(${budget}회)에 도달해 추가 읽기 도구를 실행하지 않고 종료했습니다. 필요한 대상을 직접 지정해 다시 요청해 주세요.`;
    }

    steps.push({
      call,
      phase: 'final',
      promptChars,
      proposalCount: previewedProposals.length,
      failedCount: failedProposals.length,
    });

    return {
      rawReply,
      parsed,
      previewedProposals,
      pinnedCtx: livePinnedCtx,
      callsUsed: call,
      maxCalls: budget,
      totalPromptChars,
      budgetTrimmedNotes,
      steps,
      toolRuns,
      repairedCount,
      repairHistory,
      loadedSkillIds: [...loadedSkillIds],
      fieldsShownFull: [...fieldsShownFull],
      greetingsShownFull: [...greetingsShownFull],
      itemsShownFull: [...itemsShownFull],
    };
  }

  // Unreachable defensive fallback
  throw new Error('LLM 요청 루프가 예기치 않게 종료되었습니다.');
}

export {
  MAX_AGENT_CALLS,
  normalizeMaxCalls,
  measureMessagesChars,
  runAgentLoop,
};
