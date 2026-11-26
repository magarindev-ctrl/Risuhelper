// SPDX-License-Identifier: GPL-3.0-only
// Comprehensive verification suite for RisuHelper v1.1.0:
//   1. Full-overwrite data-loss guards (lorebook, Lua, regex, persona) + double-truncation batch unlock fix
//   2. 0-token local search_workspace across 200+ lorebooks & 240K+ chars
//   3. Windowed/outline read_item + lineRange-scoped applyTextEdits
//   4. Large-target auto-outline (>12K) + dedicated maxRequestChars budget compaction
//   5. Dynamic 3-stage planned pipeline (Step 1 -> Step 2 0..N -> Step 3 0..M) with confirmation gate,
//      rolling summary (<=3,000 chars), raw-chunk eviction, hard ceiling clamping, and partial checkpointing
//   6. Bundled dist/risuhelper.js in-panel confirmation modal (Approve & Cancel) + Settings UI integration

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  locateTextEdits,
  applyTextEdits,
  buildTextOutline,
  sliceTextByLines,
  sliceTextAroundAnchor,
  splitTextIntoChunks,
} from '../src/text-edits.js';
import { HostAdapter, buildShownItemKey } from '../src/host-adapter.js';
import { executeReadTool, executeReadToolBatch, MAX_TOOL_RESULT_CHARS } from '../src/read-tools.js';
import {
  buildConversationMessages,
  enforceRequestCharBudget,
} from '../src/llm.js';
import { runAgentLoop } from '../src/agent-loop.js';
import { MAX_ROLLING_SUMMARY_CHARS } from '../src/staged-pipeline.js';
import { bootBundle } from './helpers/boot-bundle.mjs';

function makeLargeHost({ writeSpy = null, loreContent = null, luaCode = null, regexOut = null, personaPrompt = null } = {}) {
  const longLore = loreContent ?? Array.from({ length: 400 }, (_, i) =>
    `## 제${i + 1}절 왕국 연대기\n라인-${i + 1}: 아르카디아 제국의 마법 규율과 고대 유적 기록. ${'상세 설정 서술 문장입니다. '.repeat(3)}`
  ).join('\n'); // ~40K+ chars

  const longLua = luaCode ?? Array.from({ length: 420 }, (_, i) =>
    `-- section ${i + 1}\nfunction handler_${i + 1}(triggerId)\n  local rate = 10\n  local msg = "${'lua_payload_padding_text_'.repeat(3)}_${i + 1}"\n  return rate\nend`
  ).join('\n'); // ~48K+ chars

  const longRegexOut = regexOut ?? `<div class="hud">${'<span>상태 블록</span>'.repeat(120)}</div>`;
  const longPersona = personaPrompt ?? `길드 소속 마도 학자.\n${'세부 배경 설정과 행동 지침. '.repeat(80)}`;

  const state = {
    charIndex: 0,
    characters: [
      {
        chaId: 'char-v110-1',
        name: '아리아',
        desc: '항구 도시의 연금술사 아리아.\n은빛 단발과 초록 눈동자를 지녔다.',
        firstMessage: '공방에 오신 것을 환영합니다.',
        alternateGreetings: ['비 오는 날의 공방.'],
        globalLore: [
          {
            comment: '아르카디아 대백과',
            key: '아르카디아,제국',
            secondkey: '',
            selective: false,
            alwaysActive: false,
            insertorder: 100,
            mode: 'normal',
            content: longLore,
          },
          {
            comment: '짧은 메모',
            key: '메모',
            secondkey: '',
            selective: false,
            alwaysActive: false,
            insertorder: 100,
            mode: 'normal',
            content: '짧은 기존 로어북 본문입니다.',
          },
        ],
        customscript: [
          { comment: '긴 HUD 정규식', in: '\\[HUD:(.+?)\\]', out: longRegexOut, type: 'editdisplay', flag: 'g', ableFlag: true },
        ],
        triggerscript: [
          { comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: longLua }] },
        ],
        chatPage: 0,
        chats: [
          {
            id: 'chat-v110-0',
            name: '1부 본편',
            note: '분위기는 차분하게 유지한다.',
            fmIndex: -1,
            scriptstate: { $hp: 100 },
            localLore: [],
            message: [
              { role: 'user', data: '아르카디아 제국 도서관에 들어가자.' },
              { role: 'char', data: '아리아가 고대 석판 앞에서 발걸음을 멈췄다.' },
            ],
          },
        ],
      },
    ],
    db: {
      temperature: 100,
      maxContext: 8000,
      maxResponse: 800,
      selectedPersona: 0,
      personas: [
        { id: 'p-0', name: '긴 페르소나', note: '', personaPrompt: longPersona },
        { id: 'p-1', name: '짧은 페르소나', note: '', personaPrompt: '짧은 여행자.' },
      ],
      modules: [
        {
          id: 'mod-v110-0',
          name: '세계관 확장 모듈',
          description: '모듈 설명',
          lorebook: [
            { comment: '모듈 대용량 로어', key: '용어', content: '모듈 핵심 규칙: 구용어_알파 를 사용한다.\n'.repeat(60) },
          ],
          regex: [],
          trigger: [],
        },
      ],
      enabledModules: ['mod-v110-0'],
    },
    storage: new Map(),
  };

  const api = {
    getCharacter: async () => structuredClone(state.characters[state.charIndex]),
    setCharacter: async (next) => {
      writeSpy?.('setCharacter');
      state.characters[state.charIndex] = structuredClone(next);
    },
    getDatabase: async () => ({
      ...structuredClone(state.db),
      characters: structuredClone(state.characters),
      characterOrder: state.characters.map(c => c.chaId),
    }),
    setDatabaseLite: async (patch) => {
      writeSpy?.('setDatabaseLite');
      if (patch.characters) state.characters = structuredClone(patch.characters);
      if (patch.personas) state.db.personas = structuredClone(patch.personas);
      if (patch.modules) state.db.modules = structuredClone(patch.modules);
    },
    getCharIndex: () => state.charIndex,
    pluginStorage: {
      getItem: async (k) => state.storage.get(k) ?? null,
      setItem: async (k, v) => { state.storage.set(k, String(v)); },
    },
  };

  const adapter = new HostAdapter(api);
  return { state, api, adapter, longLore, longLua };
}

test('v1.1.0 security guard: blocks unshown/partial full overwrite on 40K lorebook, 48K Lua, regex, persona AND fixes executeReadToolBatch 16K clip unlock bug', async () => {
  const writes = [];
  const { state, adapter, longLore, longLua } = makeLargeHost({ writeSpy: (fn) => writes.push(fn) });
  assert.ok(longLore.length > 35000, `expected >35K lore, got ${longLore.length}`);
  assert.ok(longLua.length > 42000, `expected >42K lua, got ${longLua.length}`);

  const freeTalkCtx = { screen: 'chat', targetKind: 'general', freeTalk: true, itemsShownFull: [], fieldsShownFull: [], greetingsShownFull: [] };

  // 1. 40K lorebook full overwrite blocked in free talk AND raw empty target AND auto-outlined focus!
  const loreProp = { action: 'update_lorebook', scope: 'character', loreIndex: 0, content: '20자짜리 짧은 덮어쓰기' };
  const pLore1 = await adapter.previewProposal(loreProp, freeTalkCtx);
  assert.equal(pLore1.ok, false, 'free-talk full overwrite on unshown 40K lorebook must fail preview');
  assert.match(pLore1.error, /전체 덮어쓰기를 차단/);

  const pLore2 = await adapter.previewProposal(loreProp, {});
  assert.equal(pLore2.ok, false, 'raw target full overwrite on unshown 40K lorebook must fail preview');

  const pLore3 = await adapter.previewProposal(loreProp, { targetKind: 'char_lorebook', loreIndex: 0, contentTruncated: true });
  assert.equal(pLore3.ok, false, 'auto-outlined focused 40K lorebook must block full overwrite');

  await assert.rejects(() => adapter.applyProposal(loreProp, freeTalkCtx), /차단/);
  assert.equal(state.characters[0].globalLore[0].content.length, longLore.length);

  // 2. 48K Lua full overwrite blocked in both preview and apply!
  const luaProp = { action: 'update_lua', scope: 'character', code: 'function onOutput() end' };
  const pLua1 = await adapter.previewProposal(luaProp, freeTalkCtx);
  assert.equal(pLua1.ok, false, 'unshown 48K Lua full overwrite must fail preview');
  const pLua2 = await adapter.previewProposal(luaProp, {});
  assert.equal(pLua2.ok, false, 'raw target 48K Lua full overwrite must fail preview');
  await assert.rejects(() => adapter.applyProposal(luaProp, freeTalkCtx), /차단/);

  // 3. Existing long regex `out` & long persona full overwrite blocked!
  const regexProp = { action: 'upsert_regex', scope: 'character', regexIndex: 0, comment: '긴 HUD 정규식', in: '\\[HUD:(.+?)\\]', out: '<b>short</b>' };
  const pRegex = await adapter.previewProposal(regexProp, freeTalkCtx);
  assert.equal(pRegex.ok, false, 'unshown existing regex out overwrite must fail preview');
  await assert.rejects(() => adapter.applyProposal(regexProp, freeTalkCtx), /차단/);

  const personaProp = { action: 'update_persona', personaIndex: 0, personaPrompt: '짧은 덮어쓰기' };
  const pPersona = await adapter.previewProposal(personaProp, freeTalkCtx);
  assert.equal(pPersona.ok, false, 'unshown long persona overwrite must fail preview');
  await assert.rejects(() => adapter.applyProposal(personaProp, freeTalkCtx), /차단/);

  // 4. Double-truncation bug fix: reading an 18K field with maxChars=24000 inside executeReadToolBatch
  // gets clipped by MAX_TOOL_RESULT_CHARS (16,000), so it MUST NOT unlock fieldsShownFull or itemsShownFull!
  state.characters[0].desc = 'D'.repeat(MAX_TOOL_RESULT_CHARS + 2500);
  const clippedBatch = await executeReadToolBatch(adapter, [
    { tool: 'read_item', args: { kind: 'char_field', field: 'desc', maxChars: 24000 } },
  ]);
  assert.equal(clippedBatch.runs[0].ok, true);
  assert.equal(clippedBatch.fieldsShownFull.includes('desc'), false, 'batch-clipped char_field must NOT unlock fieldsShownFull');
  assert.equal(clippedBatch.itemsShownFull.some(k => k.includes('desc')), false, 'batch-clipped char_field must NOT unlock itemsShownFull');

  // Reading a short lorebook (#1) in full DOES unlock itemsShownFull and permits full overwrite!
  const fullBatch = await executeReadToolBatch(adapter, [
    { tool: 'read_item', args: { kind: 'lorebook', scope: 'character', loreIndex: 1 } },
  ]);
  assert.ok(fullBatch.itemsShownFull.includes(buildShownItemKey('lorebook', { scope: 'character', loreIndex: 1 })));
  const unlockedPreview = await adapter.previewProposal(
    { action: 'update_lorebook', scope: 'character', loreIndex: 1, content: '전문 확인 후 안전 교체' },
    { ...freeTalkCtx, itemsShownFull: fullBatch.itemsShownFull }
  );
  assert.equal(unlockedPreview.ok, true);
  assert.equal(writes.length, 0, 'all checks and previews must invoke zero writes');
});

test('v1.1.0 search_workspace scans 200+ lorebooks (~240K chars) in <200ms with 0 writes and returns line numbers + ±360c verbatim snippets', async () => {
  const writes = [];
  const { state, adapter } = makeLargeHost({ writeSpy: (fn) => writes.push(fn) });

  // Populate 200 lorebooks (~1,200 chars each = ~240K chars)
  state.characters[0].globalLore = Array.from({ length: 200 }, (_, idx) => ({
    comment: `백과사전 항목 #${idx + 1}`,
    key: `키_${idx + 1}`,
    secondkey: '',
    selective: false,
    alwaysActive: false,
    insertorder: 100,
    mode: 'normal',
    content: idx === 137
      ? `${'일반 세계관 배경 서술입니다.\n'.repeat(18)}비밀_보스_약점: 얼음 속성 마법에 2배 피해를 입는다.\n${'추가 후속 기록입니다.\n'.repeat(18)}`
      : `일반 설정 문단 ${idx + 1}. ${'가나다라마바사아자차카타파하 '.repeat(60)}`,
  }));

  const t0 = Date.now();
  const res = await executeReadTool(adapter, {
    tool: 'search_workspace',
    args: { query: '비밀_보스_약점', scope: 'all', contextChars: 360 },
  });
  const elapsedMs = Date.now() - t0;

  assert.equal(res.ok, true);
  assert.ok(elapsedMs < 200, `search_workspace must be fast (<200ms), took ${elapsedMs}ms`);
  assert.equal(res.result.totalMatchedItems, 1);
  assert.equal(res.result.matches.length, 1);
  const hit = res.result.matches[0];
  assert.equal(hit.kind, 'lorebook');
  assert.equal(hit.loreIndex, 137);
  assert.equal(hit.matchLine, 19);
  assert.ok(hit.snippetStartLine <= 19 && hit.snippetEndLine >= 19);
  assert.ok(hit.snippet.includes('비밀_보스_약점: 얼음 속성 마법에 2배 피해를 입는다.'));
  assert.ok(hit.snippet.length >= 300, 'snippet includes generous surrounding context for immediate 2-call edit');

  // Regex search mode works across modules & Lua too
  const regRes = await executeReadTool(adapter, {
    tool: 'search_workspace',
    args: { query: 'handler_4(19|20)', useRegex: true, scope: 'scripts' },
  });
  assert.equal(regRes.ok, true);
  assert.ok(regRes.result.totalMatches >= 2);
  assert.equal(regRes.result.matches[0].kind, 'lua');
  assert.equal(writes.length, 0);
});

test('v1.1.0 windowed/outline read_item + lineRange-scoped applyTextEdits targets exact occurrence among duplicates', async () => {
  const { adapter, longLore, longLua } = makeLargeHost();

  // 1. outlineOnly on 40K lorebook & 48K Lua -> returns headings + line numbers, never unlocks ShownFull
  const unlocks = { skillIds: new Set(), fieldsShownFull: new Set(), greetingsShownFull: new Set(), itemsShownFull: new Set() };
  const outlineRes = await executeReadTool(adapter, {
    tool: 'read_item',
    args: { kind: 'lorebook', scope: 'character', loreIndex: 0, outlineOnly: true },
  }, {}, unlocks);
  assert.equal(outlineRes.ok, true);
  assert.equal(outlineRes.result.outlineOnly, true);
  assert.equal(outlineRes.result.truncated, true);
  assert.ok(outlineRes.result.headings.length >= 20);
  assert.equal(outlineRes.result.headings[0].line, 1);
  assert.equal(unlocks.itemsShownFull.size, 0, 'outlineOnly must NEVER unlock ShownFull');

  const luaOutline = await executeReadTool(adapter, {
    tool: 'read_item',
    args: { kind: 'lua', scope: 'character', outlineOnly: true },
  }, {}, unlocks);
  assert.equal(luaOutline.ok, true);
  assert.ok(luaOutline.result.headings.some(h => h.text.includes('function handler_1')));

  // 2. startLine/endLine window on 40K lorebook
  const lineWin = await executeReadTool(adapter, {
    tool: 'read_item',
    args: { kind: 'lorebook', scope: 'character', loreIndex: 0, startLine: 501, endLine: 510 },
  }, {}, unlocks);
  assert.equal(lineWin.ok, true);
  assert.equal(lineWin.result.startLine, 501);
  assert.equal(lineWin.result.endLine, 510);
  assert.equal(lineWin.result.truncated, true);
  assert.match(lineWin.result.content, /제251절|라인-251/);
  assert.equal(unlocks.itemsShownFull.size, 0, 'windowed read must NOT unlock ShownFull');

  // 3. aroundText window on 48K Lua
  const aroundWin = await executeReadTool(adapter, {
    tool: 'read_item',
    args: { kind: 'lua', scope: 'character', aroundText: 'function handler_350', contextChars: 400 },
  }, {}, unlocks);
  assert.equal(aroundWin.ok, true);
  assert.equal(aroundWin.result.found, true);
  assert.ok(aroundWin.result.matchLine > 1500);
  assert.match(aroundWin.result.code, /function handler_350/);

  // 4. lineRange-scoped applyTextEdits disambiguates duplicate lines cleanly!
  // `  local rate = 10` appears 420 times in longLua!
  assert.throws(
    () => locateTextEdits(longLua, [{ before: '  local rate = 10', after: '  local rate = 99' }]),
    /여러 번 등장/
  );
  // Target ONLY handler_350's line range!
  const targetLine = aroundWin.result.matchLine;
  const patchedLua = applyTextEdits(longLua, [{
    before: '  local rate = 10',
    after: '  local rate = 99',
    lineRange: [targetLine, targetLine + 3],
  }]);
  assert.equal((patchedLua.match(/local rate = 99/g) || []).length, 1, 'ONLY the single occurrence inside lineRange changed');
  assert.equal((patchedLua.match(/local rate = 10/g) || []).length, 419, 'all other 419 occurrences untouched');

  // Wrong lineRange fails with clear Korean error
  assert.throws(
    () => applyTextEdits(longLua, [{ before: 'function handler_350', after: 'function handler_X', lineRange: [1, 10] }]),
    /지정한 줄 범위\(1~10줄\)에서 before 구간을 찾을 수 없습니다/
  );

  // Verify splitTextIntoChunks is 100% lossless
  const chunks = splitTextIntoChunks(longLore, 8000);
  assert.ok(chunks.length >= 4);
  assert.equal(chunks.map(c => c.text).join(''), longLore, 'splitTextIntoChunks must be byte-exact lossless');

  // Verify buildTextOutline / sliceTextByLines / sliceTextAroundAnchor pure helpers
  const out = buildTextOutline(longLore);
  assert.equal(out.totalChars, longLore.length);
  const sl = sliceTextByLines(longLore, 1, 2);
  assert.equal(sl.startLine, 1);
  assert.equal(sl.endLine, 2);
  const anc = sliceTextAroundAnchor(longLore, '라인-200:', 200);
  assert.equal(anc.found, true);
});

test('v1.1.0 large-target auto-outline (>12K) and dedicated maxRequestChars budget compaction keep prompts lean', () => {
  const { longLore } = makeLargeHost();

  // 1. Auto-outline activates when enableTools=true & target > 12,000 chars
  const outlinedMsgs = buildConversationMessages({
    context: { screen: 'lorebook', targetKind: 'char_lorebook', loreIndex: 0, labelText: '캐릭터 로어북 #1' },
    snapshot: { target: { targetKind: 'char_lorebook', loreIndex: 0 }, label: '캐릭터 로어북 #1', content: longLore },
    extraContext: {},
    history: [],
    userInput: '제250절 설정 확인해 줘',
    enableTools: true,
  });
  assert.match(outlinedMsgs[0].content, /대용량 원문 자동 목차 모드/);
  assert.match(outlinedMsgs[0].content, /L1: ## 제1절/);
  assert.ok(outlinedMsgs[0].content.length < 18000, `auto-outlined system prompt must stay lean (<18K), got ${outlinedMsgs[0].content.length}`);

  // 2. Dedicated maxRequestChars budget compacts large old history blocks + oldest turns while preserving protocol & latest user input
  const hugeHistory = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0
      ? `이전 질문 #${i}: ${'배경 설명 텍스트 '.repeat(500)}`
      : `이전 답변 #${i}\n\`\`\`risuhelper-proposal\n${'{"a":"' + 'X'.repeat(5000) + '"}\n'}\`\`\``,
  }));
  const rawMsgs = [
    { role: 'system', content: '시스템 앞부분\n' + '참고 문맥\n'.repeat(200) + '\n[수정·생성 제안 프로토콜]\n핵심 규칙 보존' },
    ...hugeHistory,
    { role: 'user', content: '최신 사용자 요청 보존 확인' },
  ];
  const rawTotal = rawMsgs.reduce((s, m) => s + m.content.length, 0);
  assert.ok(rawTotal > 48000);

  const budgeted = enforceRequestCharBudget(rawMsgs, 20000);
  assert.equal(budgeted.trimmed, true);
  assert.ok(budgeted.finalChars <= 20000, `budgeted finalChars (${budgeted.finalChars}) must be <= 20,000`);
  assert.ok(budgeted.messages[0].content.includes('[수정·생성 제안 프로토콜]'), 'protocol rules must be preserved');
  assert.equal(budgeted.messages[budgeted.messages.length - 1].content, '최신 사용자 요청 보존 확인');
});

test('v1.1.0 dynamic staged pipeline (chunked_rewrite): confirmation gate, rollingSummary + raw-chunk eviction, 1 atomic proposal, Apply & Undo byte-exact roundtrip', async () => {
  const writes = [];
  const { state, api, adapter, longLore } = makeLargeHost({ writeSpy: (fn) => writes.push(fn) });

  const capturedPayloads = [];
  let confirmOverview = null;
  const progressEvents = [];

  const mockCallModel = async (_api, messages) => {
    const callIdx = capturedPayloads.length;
    capturedPayloads.push(messages.map(m => ({ ...m })));

    // Call 1 (Step 1): emit risuhelper-plan for 40K lorebook full rewrite
    if (callIdx === 0) {
      return [
        '4만 자 대용량 로어북 전체 번역 계획을 수립했습니다.',
        '```risuhelper-plan',
        JSON.stringify({
          mode: 'chunked_rewrite',
          goal: '아르카디아 대백과 로어북 전체 문체 통일 번역',
          reason: '원문이 4만 자를 넘어 5개 구간으로 안전하게 분할 변환합니다.',
          target: { kind: 'lorebook', scope: 'character', loreIndex: 0 },
          chunkSizeChars: 9000,
          step2Tasks: [
            { label: '전반부 고유명사·문체 추출', startChar: 0, maxChars: 4000 },
          ],
        }),
        '```',
      ].join('\n');
    }

    // Call 2 (Step 2 #1): produce rollingSummary (intentionally huge to verify 3,000-char clamping!)
    if (callIdx === 1) {
      return `<<<SUMMARY>>>\n용어집: 아르카디아=Arcadia, 마법 규율=Arcane Law\n${'세부 규칙 메모. '.repeat(350)}\n<<<END_SUMMARY>>>`;
    }

    // Calls 3..N (Step 3 chunks): extract current SOURCE chunk and transform it deterministically!
    const userMsg = messages[messages.length - 1].content;
    const srcMatch = userMsg.match(/<<<SOURCE>>>\n([\s\S]*?)\n<<<END_SOURCE>>>/);
    assert.ok(srcMatch, `Step 3 call #${callIdx} must include <<<SOURCE>>> chunk`);
    const chunkSrc = srcMatch[1];
    const transformed = chunkSrc.replace(/아르카디아 제국/g, 'Arcadia Empire');
    return `<<<CHUNK>>>\n${transformed}\n<<<END_CHUNK>>>\n<<<SUMMARY>>>\n용어집: 아르카디아=Arcadia Empire (완료 구간 누적 ${callIdx - 1})\n<<<END_SUMMARY>>>`;
  };

  const loopRes = await runAgentLoop({
    api,
    adapter,
    initialMessages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '1번 로어북 전체를 영문 용어로 통일해 줘' },
    ],
    callModel: mockCallModel,
    pinnedCtx: { screen: 'chat', targetKind: 'general', freeTalk: true, itemsShownFull: [], fieldsShownFull: [], greetingsShownFull: [] },
    maxCalls: 3,
    pipelineLimits: { maxTotalCalls: 12, confirmThresholdCalls: 4 },
    confirmLargePlan: true,
    onConfirmPlan: async (overview) => {
      confirmOverview = overview;
      return true; // User clicks Approve!
    },
    onProgress: (info) => progressEvents.push(info),
  });

  // 1. Confirmation gate fired with exact breakdown
  assert.ok(confirmOverview, 'confirmation gate must fire for >=4 total calls');
  assert.equal(confirmOverview.step2Count, 1);
  assert.ok(confirmOverview.step3Count >= 4 && confirmOverview.step3Count <= 8);
  assert.equal(confirmOverview.plannedTotalCalls, 1 + 1 + confirmOverview.step3Count);
  assert.match(confirmOverview.stageBreakdownText, /Step 1.*Step 2.*Step 3/);

  // 2. Zero host writes happened during all automatic Step 1 / Step 2 / Step 3 calls!
  assert.equal(writes.length, 0, 'staged pipeline MUST remain 100% Read-Only during Step 1/2/3');

  // 3. Verify raw-chunk eviction & rollingSummary <= 3,000 chars!
  // Step 3 chunk #1 (capturedPayloads[2]) received rollingSummary clamped to <= 3,000 chars!
  const step3Call1User = capturedPayloads[2][1].content;
  const summaryInStep3 = step3Call1User.match(/\[누적 요약 \(용어·문체·규칙\)\]\n([\s\S]*?)\n\n\[이번에 변환할 현재 구간/);
  assert.ok(summaryInStep3);
  assert.ok(summaryInStep3[1].length <= MAX_ROLLING_SUMMARY_CHARS + 5, `rollingSummary must stay <= ${MAX_ROLLING_SUMMARY_CHARS} chars`);

  // Step 3 chunk #3 (capturedPayloads[4]) must NOT contain chunk #1's raw text (라인-1:)!
  const step3Call3User = capturedPayloads[4][1].content;
  assert.equal(step3Call3User.includes('라인-1:'), false, 'raw text from earlier chunk #1 must be evicted from chunk #3');
  assert.ok(step3Call3User.includes('[직전 구간 변환 끝부분'), 'continuity tail from previous chunk must be attached');

  // 4. Final output is ONE atomic verified proposal -> Apply -> Undo restores exact 40K original!
  assert.equal(loopRes.pipeline.used, true);
  assert.equal(loopRes.pipeline.partial, false);
  assert.equal(loopRes.previewedProposals.length, 1);
  const { proposal, preview } = loopRes.previewedProposals[0];
  assert.equal(proposal.action, 'update_lorebook');
  assert.equal(preview.ok, true, `atomic stitched preview must succeed: ${preview.error}`);
  assert.ok(preview.after.includes('Arcadia Empire'));
  assert.equal(preview.after.includes('아르카디아 제국'), false, 'all 400 lines across all chunks were transformed');

  const applied = await adapter.applyProposal(proposal, preview.target, { hostBinding: preview.hostBinding });
  assert.equal(applied.ok, true);
  assert.equal(state.characters[0].globalLore[0].content, preview.after);
  assert.equal(writes.length, 1, 'atomic apply performs exactly 1 write');

  const undone = await adapter.undo(applied.undoId);
  assert.equal(undone.conflicts.length, 0);
  assert.equal(state.characters[0].globalLore[0].content, longLore, '1-click Undo restores original 40K lorebook byte-for-byte');
});

test('v1.1.0 staged pipeline: confirmation Cancel aborts with 0 extra calls, dynamic Step 2->3 batch_proposals works, ceiling clamps runaway plans, and mid-Step 3 failure preserves completed chunks safely', async () => {
  const { state, api, adapter, longLore } = makeLargeHost();

  // --- Subtest A: Confirmation Cancel -> 0 extra LLM calls ---
  let cancelCalls = 0;
  const cancelRes = await runAgentLoop({
    api,
    adapter,
    initialMessages: [{ role: 'system', content: 'sys' }, { role: 'user', content: '전체 번역해 줘' }],
    callModel: async () => {
      cancelCalls++;
      return '```risuhelper-plan\n{"mode":"chunked_rewrite","goal":"전체 번역","target":{"kind":"lorebook","loreIndex":0},"chunkSizeChars":8000}\n```';
    },
    pinnedCtx: { screen: 'chat', targetKind: 'general', freeTalk: true, itemsShownFull: [] },
    confirmLargePlan: true,
    onConfirmPlan: async () => false, // User clicks Cancel!
  });
  assert.equal(cancelCalls, 1, 'cancelling confirmation must invoke ZERO extra LLM calls');
  assert.equal(cancelRes.pipeline.cancelled, true);
  assert.equal(cancelRes.previewedProposals.length, 0);
  assert.match(cancelRes.parsed.prose, /취소/);

  // --- Subtest B: Dynamic Step 2 -> Step 3 `batch_proposals` + hard ceiling clamping ---
  let batchCalls = 0;
  const batchRes = await runAgentLoop({
    api,
    adapter,
    initialMessages: [{ role: 'system', content: 'sys' }, { role: 'user', content: '로어북 용어 통일' }],
    callModel: async (_api, messages) => {
      batchCalls++;
      if (batchCalls === 1) {
        // Runaway plan with 20 step2 tasks -> must be clamped cleanly by maxStep2Calls & maxTotalCalls!
        return '```risuhelper-plan\n' + JSON.stringify({
          mode: 'batch_proposals',
          goal: '로어북 일괄 용어 수정',
          step2Tasks: [
            { label: '키워드 검색', tool: 'search_workspace', args: { query: '짧은 기존', scope: 'lorebook' } },
          ],
          step3Tasks: [], // Step 2 will dynamically decide Step 3 tasks!
          step3Estimate: 2,
        }) + '\n```';
      }
      if (batchCalls === 2) {
        // Step 2 verifies search result and dynamically outputs Step 3 task list (trying 15 tasks -> clamped!)
        const userText = messages[1].content;
        assert.match(userText, /짧은 기존 로어북 본문입니다/);
        const oversizedTasks = Array.from({ length: 15 }, (_, idx) => ({
          label: `배치 ${idx + 1}`,
          instruction: idx === 0 ? '로어북 #2 본문 문구를 수정' : '추가 배치',
          readCalls: idx === 0 ? [{ tool: 'read_item', args: { kind: 'lorebook', scope: 'character', loreIndex: 1 } }] : [],
          skillIds: ['lorebook'],
        }));
        return [
          '<<<SUMMARY>>>\n대상: 캐릭터 로어북 #2 (loreIndex: 1)\n<<<END_SUMMARY>>>',
          '```risuhelper-step3',
          JSON.stringify({ step3Tasks: oversizedTasks }),
          '```',
        ].join('\n');
      }
      if (batchCalls === 3) {
        // Step 3 batch #1 emits concrete edit proposal
        return [
          '```risuhelper-proposal',
          JSON.stringify({
            action: 'update_lorebook',
            title: '로어북 #2 용어 통일',
            scope: 'character',
            loreIndex: 1,
            edits: [{ before: '짧은 기존 로어북 본문입니다.', after: '통일된 신규 로어북 본문입니다.' }],
          }),
          '```',
        ].join('\n');
      }
      return '추가 변경 없음.';
    },
    pinnedCtx: { screen: 'chat', targetKind: 'general', freeTalk: true, itemsShownFull: [] },
    pipelineLimits: { maxTotalCalls: 5, maxStep2Calls: 2, maxStep3Calls: 3, confirmThresholdCalls: 4 },
    confirmLargePlan: true,
    onConfirmPlan: async () => true,
  });
  assert.ok(batchCalls <= 5, `hard maxTotalCalls ceiling (5) must never be exceeded, got ${batchCalls}`);
  assert.equal(batchRes.pipeline.step2Executed, 1);
  assert.equal(batchRes.pipeline.step3Executed, 3, 'clamped to remaining budget (5 - 1 - 1 = 3)');
  assert.equal(batchRes.previewedProposals.length, 1);
  assert.equal(batchRes.previewedProposals[0].preview.ok, true);

  // --- Subtest C: Partial Checkpoint Preservation on mid-Step 3 error ---
  let partialCall = 0;
  const partialRes = await runAgentLoop({
    api,
    adapter,
    initialMessages: [{ role: 'system', content: 'sys' }, { role: 'user', content: '전체 번역' }],
    callModel: async (_api, messages) => {
      partialCall++;
      if (partialCall === 1) {
        return '```risuhelper-plan\n{"mode":"chunked_rewrite","goal":"부분 보존 테스트","target":{"kind":"lorebook","loreIndex":0},"chunkSizeChars":9000}\n```';
      }
      // Fail on chunk #3 (call #4)! Chunks #1 and #2 already succeeded!
      if (partialCall === 4) {
        throw new Error('429 Too Many Requests');
      }
      const userMsg = messages[1].content;
      const src = userMsg.match(/<<<SOURCE>>>\n([\s\S]*?)\n<<<END_SOURCE>>>/)[1];
      return `<<<CHUNK>>>\n${src.replace(/아르카디아 제국/g, 'PARTIAL_ARC')}\n<<<END_CHUNK>>>`;
    },
    pinnedCtx: { screen: 'chat', targetKind: 'general', freeTalk: true, itemsShownFull: [] },
    confirmLargePlan: false,
  });

  assert.equal(partialRes.pipeline.partial, true);
  assert.equal(partialRes.pipeline.step3Executed, 2);
  assert.match(partialRes.parsed.prose, /부분 완료|429 Too Many Requests/);
  assert.equal(partialRes.previewedProposals.length, 1, 'completed chunks 1..2 preserved as a safe partial edits proposal');

  const partItem = partialRes.previewedProposals[0];
  assert.equal(partItem.preview.ok, true, `partial checkpoint preview must succeed: ${partItem.preview.error}`);
  assert.ok(Array.isArray(partItem.proposal.edits), 'partial checkpoint uses safe lineRange edits, NEVER truncated full overwrite');

  // Apply partial checkpoint -> chunks 1..2 updated, untouched tail (라인-400) 100% preserved!
  const partApplied = await adapter.applyProposal(partItem.proposal, partItem.preview.target, { hostBinding: partItem.preview.hostBinding });
  assert.equal(partApplied.ok, true);
  assert.ok(state.characters[0].globalLore[0].content.includes('PARTIAL_ARC'));
  assert.ok(state.characters[0].globalLore[0].content.includes('라인-400: 아르카디아 제국'), 'untouched later chunks remain 100% intact!');

  // Undo restores entire 40K lorebook cleanly
  await adapter.undo(partApplied.undoId);
  assert.equal(state.characters[0].globalLore[0].content, longLore);
});

test('v1.1.0 bundled dist/risuhelper.js UI integration: in-panel confirmation modal (Cancel + Approve), Apply + Undo, and v1.1.0 settings controls', async () => {
  const { state, longLore } = makeLargeHost();
  const bundleState = { character: structuredClone(state.characters[0]) };

  let llmCallCount = 0;
  let phase = 'cancel';

  const ui = await bootBundle({
    state: bundleState,
    runLLMModel: async ({ messages }) => {
      llmCallCount++;
      if ((phase === 'cancel' && llmCallCount === 1) || (phase === 'approve' && llmCallCount === 2)) {
        return '```risuhelper-plan\n' + JSON.stringify({
          mode: 'chunked_rewrite',
          goal: '대백과 로어북 번역',
          reason: '4만 자 대용량 로어북을 안전하게 분할 번역합니다.',
          target: { kind: 'lorebook', scope: 'character', loreIndex: 0 },
          chunkSizeChars: 11000,
        }) + '\n```';
      }
      const userMsg = messages[messages.length - 1].content;
      const src = userMsg.match(/<<<SOURCE>>>\n([\s\S]*?)\n<<<END_SOURCE>>>/)[1];
      return `<<<CHUNK>>>\n${src.replace(/아르카디아 제국/g, 'Arcadia')}\n<<<END_CHUNK>>>`;
    },
  });

  // 1. Verify v1.1.0 settings controls exist inside Settings drawer
  await ui.click('☰');
  await ui.click(/설정/);
  assert.ok(ui.findAll(n => n.getAttribute?.('data-setting') === 'maxRequestChars').length === 1, 'maxRequestChars select rendered');
  assert.ok(ui.findAll(n => n.getAttribute?.('data-setting') === 'maxPipelineCalls').length === 1, 'maxPipelineCalls select rendered');
  assert.ok(ui.findAll(n => n.getAttribute?.('data-setting') === 'confirmLargePlan').length === 1, 'confirmLargePlan checkbox rendered');
  // Close settings panel back to chat
  await ui.click(/설정/);

  // 2. Trigger large plan -> in-panel confirmation modal appears -> click 취소 -> aborts with 0 extra LLM calls!
  phase = 'cancel';
  const sendCancelPromise = ui.send('1번 로어북 전체 번역해 줘');
  await ui.tick(25);

  const cancelModalText = ui.bodyText();
  assert.match(cancelModalText, /대용량 다단계 작업 진행 확인/);
  assert.match(cancelModalText, /Step 1.*Step 3/);
  await ui.click(/^취소$/);
  await sendCancelPromise;

  assert.equal(llmCallCount, 1, 'clicking 취소 must invoke 0 extra LLM calls');
  assert.equal(bundleState.character.globalLore[0].content, longLore);

  // 3. Trigger again -> click 진행 -> executes all chunks -> renders atomic proposal card -> Apply -> Undo restores exact 40K!
  phase = 'approve';
  const sendApprovePromise = ui.send('1번 로어북 전체 번역 진행해 줘');
  await ui.tick(25);

  assert.match(ui.bodyText(), /진행 \(\d+회 호출\)/);
  await ui.click(/^진행 \(\d+회 호출\)$/);
  await sendApprovePromise;

  assert.ok(llmCallCount >= 5, `approved pipeline should run Step 1 + all Step 3 chunks, got ${llmCallCount} total calls`);
  assert.match(ui.bodyText(), /계획형 \d+회/);

  await ui.click(/^적용$/);
  assert.ok(bundleState.character.globalLore[0].content.includes('Arcadia'));
  assert.equal(bundleState.character.globalLore[0].content.includes('아르카디아 제국'), false);

  await ui.clickConfirm(/^되돌리기 \(1\)$/);
  assert.equal(bundleState.character.globalLore[0].content, longLore, '1-click Undo restores 40K lorebook byte-for-byte');
});
