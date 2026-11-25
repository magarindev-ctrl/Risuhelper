import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SKILL_DEFS,
  getOwnerSkillForAction,
  measureSkillChars,
  validateSkillRegistry,
  getSkillCatalog,
  loadSkillPack,
  selectSkills,
  buildSkillPromptSections,
} from '../src/skills.js';
import {
  VALID_ACTIONS,
  buildConversationMessages,
} from '../src/llm.js';
import { EVAL_SCENARIOS, runEvalScenario } from '../tools/eval-scenarios.mjs';
import { ROUTING_CORPUS } from './data/routing-corpus.mjs';

const FULL_CAPS = {
  getFetchLogs: true,
  getCurrentLorebookEntries: true,
  translationCache: true,
};

test('M2 100% reachability: every VALID_ACTION belongs to exactly one skill, every skill satisfies metadata/maxChars, and capability gating hides unsupported skills across L0/L1/L2', () => {
  const actions = [...VALID_ACTIONS];
  assert.equal(actions.length, 24);

  const check = validateSkillRegistry(actions);
  assert.equal(check.ok, true, `skill registry issues:\n- ${check.issues.join('\n- ')}`);

  // Every skill stays within its declared maxChars budget
  for (const def of SKILL_DEFS) {
    const actual = measureSkillChars(def);
    assert.ok(actual <= def.maxChars, `${def.id}: ${actual} > maxChars(${def.maxChars})`);
  }

  // Every skill in SKILL_DEFS appears in L1 catalog when capabilities are satisfied
  const fullL1 = getSkillCatalog(FULL_CAPS, []);
  assert.equal(fullL1.length, SKILL_DEFS.length);
  for (const def of SKILL_DEFS) {
    assert.ok(fullL1.some(s => s.id === def.id), `skill ${def.id} missing from L1 catalog`);
  }

  // Capability gating: when getFetchLogs is false, fetch_logs is hidden from L0, L1, and L2
  const noLogsCaps = { ...FULL_CAPS, getFetchLogs: false };
  const l0NoLogs = selectSkills({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    userInput: '429 에러 로그 원인 분석해 줘',
    extraContext: { attachedFetchLog: { status: 429 } },
    capabilities: noLogsCaps,
  });
  assert.ok(!l0NoLogs.includes('fetch_logs'), 'unsupported fetch_logs must be excluded from L0');
  assert.ok(!getSkillCatalog(noLogsCaps, []).some(s => s.id === 'fetch_logs'), 'unsupported fetch_logs must be excluded from L1');
  const l2NoLogs = loadSkillPack(['fetch_logs'], noLogsCaps);
  assert.equal(l2NoLogs.ok, false);
  assert.deepEqual(l2NoLogs.unsupported, ['fetch_logs']);
});

test('M2 prompt-schema consistency: every action name mentioned in system prompt has either its JSON schema loaded or its owner skill exposed in L1 catalog', () => {
  const screens = [
    { name: 'chat/freeTalk', context: { screen: 'chat', targetKind: 'general', freeTalk: true }, snapshot: { target: { targetKind: 'general' }, content: '' }, userInput: '안녕' },
    { name: 'chat/chat_input', context: { screen: 'chat', targetKind: 'chat_input', freeTalk: false }, snapshot: { target: { targetKind: 'chat_input' }, content: '' }, userInput: '다음 대사 대필해 줘' },
    { name: 'character/desc', context: { screen: 'character', targetKind: 'char_field', fieldKey: 'desc', freeTalk: false }, snapshot: { target: { targetKind: 'char_field', fieldKey: 'desc' }, content: '설명 원문' }, userInput: '다듬어 줘' },
    { name: 'lorebook/entry', context: { screen: 'lorebook', targetKind: 'char_lorebook', loreIndex: 0, freeTalk: false }, snapshot: { target: { targetKind: 'char_lorebook', loreIndex: 0 }, content: '로어 본문' }, userInput: '키워드 고쳐 줘' },
    { name: 'scripts/lua', context: { screen: 'scripts', targetKind: 'char_lua', freeTalk: false }, snapshot: { target: { targetKind: 'char_lua' }, content: 'function onOutput(id) end' }, userInput: '버그 잡아 줘' },
    { name: 'scripts/regex', context: { screen: 'scripts', targetKind: 'char_regex', regexIndex: 0, freeTalk: false }, snapshot: { target: { targetKind: 'char_regex', regexIndex: 0 }, content: '<b>$1</b>' }, userInput: '패턴 고쳐 줘' },
    { name: 'persona/edit', context: { screen: 'persona', targetKind: 'persona', personaIndex: 0, freeTalk: false }, snapshot: { target: { targetKind: 'persona', personaIndex: 0 }, content: '모험가' }, userInput: '다듬어 줘' },
    { name: 'settings/config', context: { screen: 'settings', targetKind: 'config', fieldKey: 'temperature', freeTalk: false }, snapshot: { target: { targetKind: 'config', fieldKey: 'temperature' }, content: '80' }, userInput: '온도 설명해 줘' },
    { name: 'module/field', context: { screen: 'module', targetKind: 'module_field', fieldKey: 'backgroundEmbedding', freeTalk: false }, snapshot: { target: { targetKind: 'module_field', fieldKey: 'backgroundEmbedding' }, content: '<style></style>' }, userInput: '스타일 다듬어 줘' },
  ];

  const actionPattern = new RegExp(`\\b(${[...VALID_ACTIONS].join('|')})\\b`, 'g');

  for (const tc of screens) {
    const msgs = buildConversationMessages({
      context: tc.context,
      snapshot: tc.snapshot,
      extraContext: {},
      history: [],
      userInput: tc.userInput,
      capabilities: FULL_CAPS,
      enableTools: true,
    });
    const sys = msgs[0].content;
    const pack = buildSkillPromptSections({
      context: tc.context,
      snapshot: tc.snapshot,
      userInput: tc.userInput,
      capabilities: FULL_CAPS,
    });
    const l1SkillIds = new Set(pack.l1Catalog.map(s => s.id));

    for (const m of sys.matchAll(actionPattern)) {
      const act = m[1];
      // Free-talk explicitly says "patch_text / replace_text는 쓸 수 없고" (negative prohibition)
      if (tc.context.freeTalk && (act === 'patch_text' || act === 'replace_text')) continue;
      const hasSchema = sys.includes(`"action":"${act}"`);
      const owner = getOwnerSkillForAction(act);
      const inL1 = owner ? l1SkillIds.has(owner) : false;
      assert.ok(
        hasSchema || inL1,
        `[${tc.name}] action "${act}" mentioned in system prompt without schema loaded or owner skill "${owner}" in L1`
      );
    }
  }
});

test('M2 224-utterance Korean routing corpus achieves >=95% L0 recall and 100% combined L0+L2 reachability', () => {
  assert.ok(ROUTING_CORPUS.length >= 200, `corpus must have >=200 utterances, got ${ROUTING_CORPUS.length}`);

  // Verify every built-in skill is well represented in the corpus
  const countsBySkill = new Map();
  for (const row of ROUTING_CORPUS) {
    countsBySkill.set(row.expectedSkill, (countsBySkill.get(row.expectedSkill) || 0) + 1);
  }
  for (const def of SKILL_DEFS) {
    assert.ok((countsBySkill.get(def.id) || 0) >= 10, `skill ${def.id} under-represented in corpus`);
  }

  let l0Hits = 0;
  let combinedHits = 0;
  const unexpectedMisses = [];

  for (const row of ROUTING_CORPUS) {
    const pack = buildSkillPromptSections({
      context: row.context,
      snapshot: { target: { targetKind: row.context?.targetKind || 'general', fieldKey: row.context?.fieldKey || '' } },
      userInput: row.userInput,
      history: row.history || [],
      extraContext: row.extraContext || {},
      capabilities: FULL_CAPS,
    });

    const hitL0 = pack.activeSkillIds.includes(row.expectedSkill);
    if (hitL0) {
      l0Hits++;
      combinedHits++;
    } else {
      const inL1 = pack.l1Catalog.some(s => s.id === row.expectedSkill);
      const l2 = loadSkillPack([row.expectedSkill], FULL_CAPS);
      if (inL1 && l2.ok && l2.loaded.includes(row.expectedSkill)) {
        combinedHits++;
      }
      if (!row.expectL2Fallback) {
        unexpectedMisses.push(`${row.expectedSkill}: "${row.userInput}" (got: ${pack.activeSkillIds.join(', ')})`);
      }
    }
  }

  const l0Recall = (l0Hits / ROUTING_CORPUS.length) * 100;
  const combinedRecall = (combinedHits / ROUTING_CORPUS.length) * 100;
  assert.deepEqual(unexpectedMisses, [], `unexpected L0 routing misses:\n- ${unexpectedMisses.join('\n- ')}`);
  assert.ok(l0Recall >= 95.0, `L0 recall must be >=95.0%, got ${l0Recall.toFixed(1)}% (${l0Hits}/${ROUTING_CORPUS.length})`);
  assert.equal(combinedRecall, 100, `combined L0+L2 reachability must be 100%, got ${combinedRecall.toFixed(1)}%`);
});

test('M2 per-skill evaluation coverage: every one of the 14 built-in skills has >=3 eval scenarios (>=2 positive, >=1 guard)', () => {
  const stats = new Map(SKILL_DEFS.map(d => [d.id, { positive: 0, guard: 0 }]));
  for (const sc of EVAL_SCENARIOS) {
    assert.ok(sc.skillId && stats.has(sc.skillId), `scenario ${sc.id} missing valid skillId (${sc.skillId})`);
    assert.ok(sc.kind === 'positive' || sc.kind === 'guard', `scenario ${sc.id} invalid kind (${sc.kind})`);
    stats.get(sc.skillId)[sc.kind]++;
  }
  for (const [skillId, count] of stats.entries()) {
    assert.ok(count.positive >= 2, `skill "${skillId}" needs >=2 positive scenarios, has ${count.positive}`);
    assert.ok(count.guard >= 1, `skill "${skillId}" needs >=1 guard scenario, has ${count.guard}`);
    assert.ok(count.positive + count.guard >= 3, `skill "${skillId}" needs >=3 total scenarios`);
  }
});

test('M2 system prompt size budget stays strictly at or below v0.5.1 level (<=9,232 chars avg) even with 12 Read-Only tools & L1 catalog enabled', async () => {
  const V051_AVG_SYS_CHARS = 9232;
  const allSys = [];
  for (const sc of EVAL_SCENARIOS) {
    const res = await runEvalScenario(sc, { dryRun: true, maxCalls: 3 });
    allSys.push(res.systemChars);
  }
  const avgOriginal26 = Math.round(allSys.slice(0, 26).reduce((a, b) => a + b, 0) / 26);
  const avgAll = Math.round(allSys.reduce((a, b) => a + b, 0) / allSys.length);

  assert.ok(
    avgOriginal26 <= V051_AVG_SYS_CHARS,
    `original 26-scenario system prompt avg (${avgOriginal26}c) must be <= v0.5.1 (${V051_AVG_SYS_CHARS}c)`
  );
  assert.ok(
    avgAll <= V051_AVG_SYS_CHARS,
    `all ${EVAL_SCENARIOS.length}-scenario system prompt avg (${avgAll}c) must be <= v0.5.1 (${V051_AVG_SYS_CHARS}c)`
  );
});
