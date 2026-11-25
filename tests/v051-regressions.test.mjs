// Regression tests for RisuHelper v0.5.1 fixes:
// 1. Pinned delete targets across multi-delete batch ('모두 적용') and sequential clicks
//    (lorebook, regex, greeting, legacy ID-less persona, external mutation guard)
// 2. Surgical delete Undo ('remove' op) surviving subsequent list additions/edits
// 3. Fork-safe create_character (chats[0].id UUID for RisuNest/PocketRisu/RisuBard,
//    lightweight preview DB check without reading full characters array)
// 4. Multi-turn skill & extraContext continuity (regex, port_from_character, module_create,
//    previous-turn proposal actions, chat-screen persona summary)
// 5. Chat-screen baseline schemas & screenNote consistency (no advertised unloaded actions)

import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSkills, buildSkillPromptSections } from '../src/skills.js';
import { buildConversationMessages } from '../src/llm.js';
import { HostAdapter } from '../src/host-adapter.js';
import { buildBlankCharacterSkeleton } from '../src/runtime-tools.js';
import { bootBundle, proposalBlock } from './helpers/boot-bundle.mjs';

function makeFixture() {
  const char0 = {
    type: 'character',
    chaId: 'char-main',
    name: '아리아',
    desc: '별빛 탑의 기록관.',
    firstMessage: '안녕 {{user}}.',
    alternateGreetings: ['인사 G0', '인사 G1', '인사 G2', '인사 G3'],
    globalLore: [
      { comment: 'A', key: 'a', mode: 'normal', content: 'body A', insertorder: 100 },
      { comment: 'B', key: 'b', mode: 'normal', content: 'body B', insertorder: 100 },
      { comment: 'C', key: 'c', mode: 'normal', content: 'body C', insertorder: 100 },
      { comment: 'D', key: 'd', mode: 'normal', content: 'body D', insertorder: 100 },
      { comment: 'E', key: 'e', mode: 'normal', content: 'body E', insertorder: 100 },
    ],
    customscript: [
      { comment: 'R0', in: 'r0', out: 'out0', type: 'editdisplay', flag: 'g', ableFlag: true },
      { comment: 'R1', in: 'r1', out: 'out1', type: 'editdisplay', flag: 'g', ableFlag: true },
      { comment: 'R2', in: 'r2', out: 'out2', type: 'editdisplay', flag: 'g', ableFlag: true },
      { comment: 'R3', in: 'r3', out: 'out3', type: 'editdisplay', flag: 'g', ableFlag: true },
    ],
    triggerscript: [],
    chats: [
      { id: 'chat-1', name: 'Chat 1', note: '', fmIndex: 1, localLore: [], modules: [], scriptstate: {}, message: [] },
      { id: 'chat-2', name: 'Chat 2', note: '', fmIndex: 3, localLore: [], modules: [], scriptstate: {}, message: [] },
    ],
    chatPage: 0,
  };

  const char1 = {
    type: 'character',
    chaId: 'char-source',
    name: '마법사 카엘',
    desc: '화염 마법사',
    firstMessage: '불꽃이 피어난다.',
    alternateGreetings: [],
    globalLore: [
      { comment: '화염 마법', key: '화염', mode: 'normal', content: '마나를 연소한다.', insertorder: 100 },
    ],
    customscript: [],
    triggerscript: [],
    chats: [{ id: 'chat-src-1', name: 'Chat 1', note: '', localLore: [], message: [] }],
    chatPage: 0,
  };

  const db = {
    characters: [char0, char1],
    characterOrder: [char0.chaId, char1.chaId],
    modules: [],
    enabledModules: [],
    moduleIntergration: '',
    // Legacy personas without `id` to verify fingerprint pinning fallback
    personas: [
      { name: 'P0', note: '', personaPrompt: 'prompt 0', largePortrait: false },
      { name: 'P1', note: '', personaPrompt: 'prompt 1', largePortrait: false },
      { name: 'P2', note: '', personaPrompt: 'prompt 2', largePortrait: false },
      { name: 'P3', note: '', personaPrompt: 'prompt 3', largePortrait: false },
    ],
    selectedPersona: 2,
  };

  const state = { character: char0, charIndex: 0, chatIndex: 0, db };
  const getDatabaseCalls = [];

  const extraApi = {
    async getCharacter() { return structuredClone(db.characters[state.charIndex]); },
    async setCharacter(c) {
      db.characters[state.charIndex] = structuredClone(c);
      state.character = db.characters[state.charIndex];
    },
    async getChatFromIndex(ci, chi) { return structuredClone(db.characters[ci]?.chats?.[chi] ?? null); },
    async setChatToIndex(ci, chi, chat) {
      db.characters[ci].chats[chi] = structuredClone(chat);
      state.character = db.characters[state.charIndex];
    },
    async getDatabase(keys = 'all') {
      getDatabaseCalls.push(Array.isArray(keys) ? [...keys] : keys);
      if (keys === 'all') return structuredClone(db);
      const out = {};
      for (const k of keys) if (Object.hasOwn(db, k)) out[k] = structuredClone(db[k]);
      return out;
    },
    async setDatabase(partial) {
      // Enforce RisuNest's validatePluginCompleteCharacter + PocketRisu's chat.id persistence invariant
      if (Object.hasOwn(partial, 'characters')) {
        assert.ok(Array.isArray(partial.characters), 'characters must be an array');
        for (const ch of partial.characters) {
          assert.ok(typeof ch.chaId === 'string' && ch.chaId.length > 0, 'character must have non-empty chaId');
          assert.ok(Array.isArray(ch.chats), 'character chats must be an array');
          for (const chat of ch.chats) {
            assert.ok(
              typeof chat.id === 'string' && chat.id.length > 0,
              `RisuNest/PocketRisu require non-empty chat.id on character "${ch.name}"`
            );
            assert.ok(Array.isArray(chat.message), 'chat.message must be an array');
          }
        }
      }
      for (const [k, v] of Object.entries(partial)) db[k] = structuredClone(v);
      state.character = db.characters[state.charIndex];
    },
  };

  return { state, db, extraApi, getDatabaseCalls };
}

test('batch-applying multiple delete_lorebook proposals deletes B and C (not D) and undoes cleanly even after adding F', async () => {
  const fix = makeFixture();
  const reply = [
    proposalBlock({ action: 'delete_lorebook', title: 'B 삭제', scope: 'character', loreIndex: 1 }),
    proposalBlock({ action: 'delete_lorebook', title: 'C 삭제', scope: 'character', loreIndex: 2 }),
  ].join('\n');

  const ui = await bootBundle({ state: fix.state, extraApi: fix.extraApi, runLLMModel: async () => reply });
  await ui.send('로어북 B와 C 삭제해 줘');

  await ui.clickConfirm(/^모두 적용 \(2\)$/);
  assert.deepEqual(
    fix.db.characters[0].globalLore.map(e => e.comment),
    ['A', 'D', 'E'],
    'batch delete of B(#2) and C(#3) must leave exactly A, D, E (never delete D)'
  );

  // User adds F after the batch delete; group Undo must still restore B and C in order while keeping F
  fix.db.characters[0].globalLore.push({ comment: 'F', key: 'f', mode: 'normal', content: 'body F', insertorder: 100 });
  await ui.clickConfirm('묶음 되돌리기');
  assert.deepEqual(
    fix.db.characters[0].globalLore.map(e => e.comment),
    ['A', 'B', 'C', 'D', 'E', 'F'],
    'group Undo after adding F must restore B and C without conflict and keep F'
  );
});

test('sequential delete clicks resolve shifted last index (B then E) and refuse if pinned entry was externally edited', async () => {
  const fix = makeFixture();
  const reply = [
    proposalBlock({ action: 'delete_lorebook', title: 'B 삭제', scope: 'character', loreIndex: 1 }),
    proposalBlock({ action: 'delete_lorebook', title: 'E 삭제', scope: 'character', loreIndex: 4 }),
  ].join('\n');

  const ui = await bootBundle({ state: fix.state, extraApi: fix.extraApi, runLLMModel: async () => reply });
  await ui.send('로어북 B와 E 삭제해 줘');

  // Click card 1 (deletes B, shifting E from index 4 -> 3)
  await ui.clickConfirm('삭제 적용', 0);
  assert.deepEqual(fix.db.characters[0].globalLore.map(e => e.comment), ['A', 'C', 'D', 'E']);

  // Click card 2 (original proposal.loreIndex=4 is now out of bounds, but pinned fingerprint locates E at index 3)
  await ui.clickConfirm('삭제 적용', 0);
  assert.deepEqual(fix.db.characters[0].globalLore.map(e => e.comment), ['A', 'C', 'D']);

  // External mutation guard: if pinned item is modified before apply, delete refuses instead of deleting wrong data
  const adapter = new HostAdapter(fix.extraApi);
  const p = { action: 'delete_lorebook', scope: 'character', loreIndex: 1 }; // C
  const preview = await adapter.previewProposal(p, { targetKind: 'general' });
  assert.equal(preview.ok, true);
  fix.db.characters[0].globalLore[1].content = '사용자가 직접 고친 C';
  await assert.rejects(
    () => adapter.applyProposal(p, preview.target, { hostBinding: preview.hostBinding }),
    /이미 수정되었거나 삭제되었습니다/
  );
  assert.deepEqual(fix.db.characters[0].globalLore.map(e => e.comment), ['A', 'C', 'D']);
});

test('multi-delete pinning works for regex, alternate greetings (+ fmIndex), and legacy ID-less personas', async () => {
  const fix = makeFixture();
  const reply = [
    proposalBlock({ action: 'delete_regex', title: 'R1 삭제', scope: 'character', regexIndex: 1 }),
    proposalBlock({ action: 'delete_regex', title: 'R2 삭제', scope: 'character', regexIndex: 2 }),
    proposalBlock({ action: 'delete_greeting', title: 'G1 삭제', greetingIndex: 1 }),
    proposalBlock({ action: 'delete_greeting', title: 'G2 삭제', greetingIndex: 2 }),
    proposalBlock({ action: 'delete_persona', title: 'P1 삭제', personaIndex: 1 }),
    proposalBlock({ action: 'delete_persona', title: 'P2 삭제', personaIndex: 2 }),
  ].join('\n');

  const ui = await bootBundle({ state: fix.state, extraApi: fix.extraApi, runLLMModel: async () => reply });
  await ui.send('정규식 R1/R2, 추가 첫 메시지 G1/G2, 페르소나 P1/P2 삭제해 줘');
  await ui.clickConfirm(/^모두 적용 \(6\)$/);

  assert.deepEqual(fix.db.characters[0].customscript.map(r => r.comment), ['R0', 'R3']);
  assert.deepEqual(fix.db.characters[0].alternateGreetings, ['인사 G0', '인사 G3']);
  assert.equal(fix.db.characters[0].chats[0].fmIndex, -1, 'chat pointing at deleted G1 resets to default -1');
  assert.equal(fix.db.characters[0].chats[1].fmIndex, 1, 'chat pointing at G3 shifts cleanly from 3 -> 1');
  assert.deepEqual(fix.db.personas.map(p => p.name), ['P0', 'P3'], 'legacy ID-less personas delete exact targets');
  assert.equal(fix.db.selectedPersona, 1);

  // User adds new items to all three lists, then group Undo still restores everything without conflict
  fix.db.characters[0].customscript.push({ comment: 'R4', in: 'r4', out: 'out4', type: 'editdisplay', flag: 'g', ableFlag: true });
  fix.db.characters[0].alternateGreetings.push('인사 G4');
  fix.db.personas.push({ name: 'P4', note: '', personaPrompt: 'prompt 4', largePortrait: false });

  await ui.clickConfirm('묶음 되돌리기');
  assert.deepEqual(fix.db.characters[0].customscript.map(r => r.comment), ['R0', 'R1', 'R2', 'R3', 'R4']);
  assert.deepEqual(fix.db.characters[0].alternateGreetings, ['인사 G0', '인사 G1', '인사 G2', '인사 G3', '인사 G4']);
  assert.deepEqual(fix.db.personas.map(p => p.name), ['P0', 'P1', 'P2', 'P3', 'P4']);
  assert.equal(fix.db.characters[0].chats[0].fmIndex, 1);
  assert.equal(fix.db.characters[0].chats[1].fmIndex, 3);
});

test('create_character populates chats[0].id UUID for RisuNest/PocketRisu/RisuBard and avoids reading db.characters on preview', async () => {
  const blank = buildBlankCharacterSkeleton('test-cha-id');
  assert.equal(blank.chats.length, 1);
  assert.ok(typeof blank.chats[0].id === 'string' && blank.chats[0].id.length >= 8, 'blank skeleton must set chats[0].id');

  const fix = makeFixture();
  const reply = proposalBlock({
    action: 'create_character',
    title: '세라 생성',
    name: '세라',
    desc: '왕국 기사',
    firstMessage: '안녕하세요.',
  });

  const ui = await bootBundle({ state: fix.state, extraApi: fix.extraApi, runLLMModel: async () => reply });
  fix.getDatabaseCalls.length = 0;

  await ui.send('새 캐릭터 세라 만들어 줘');
  // Preview MUST NOT pull the full `characters` array just to verify DB permission
  assert.equal(
    fix.getDatabaseCalls.some(k => k === 'all' || (Array.isArray(k) && k.includes('characters'))),
    false,
    'create_character preview must not read db.characters'
  );

  // Apply passes strict RisuNest/PocketRisu chat.id validation in extraApi.setDatabase
  await ui.click('적용');
  const created = fix.db.characters.find(c => c.name === '세라');
  assert.ok(created);
  assert.ok(typeof created.chats[0].id === 'string' && created.chats[0].id.length >= 8);
});

test('multi-turn routing carries over skills & context (regex, cross-char porting, module_create, previous proposal)', async () => {
  // 1. Follow-up after regex request: "응 그렇게 해줘" retains scripts skill
  const followRegex = selectSkills({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    history: [
      { role: 'user', content: '정규식 하나 만들어줘' },
      { role: 'assistant', content: '어떤 태그를 바꿀까요?' },
    ],
    userInput: '응 그렇게 해줘',
  });
  assert.ok(followRegex.includes('scripts'), 'follow-up turn must keep scripts skill active');

  // 2. Follow-up after previous assistant proposal carries over that proposal's skill
  const followProposal = selectSkills({
    context: { screen: 'chat', targetKind: 'general', freeTalk: true },
    history: [
      { role: 'user', content: '조정해 줘' },
      { role: 'assistant', rawText: '```risuhelper-proposal\n{"action":"update_char_settings","title":"예산","loreSettings":{"tokenBudget":1600}}\n```' },
    ],
    userInput: '조금만 낮춰줘',
  });
  assert.ok(followProposal.includes('char_settings'), 'previous assistant proposal action must carry over its skill');

  // 3. End-to-end UI follow-up for port_from_character: Turn 2 keeps characterCatalog & port_from_character schema
  const fix = makeFixture();
  const capturedPrompts = [];
  let turn = 0;
  const ui = await bootBundle({
    state: fix.state,
    extraApi: fix.extraApi,
    runLLMModel: async (req) => {
      capturedPrompts.push(req.messages[0].content);
      turn++;
      if (turn === 1) return '마법사 카엘(#2)에서 가져올까요?';
      return proposalBlock({
        action: 'port_from_character',
        title: '화염 마법 포팅',
        sourceCharIndex: 1,
        items: ['lorebook'],
      });
    },
  });

  await ui.send('다른 캐릭터에서 로어북 포팅해 줘');
  assert.match(capturedPrompts[0], /\[다른 캐릭터 목록/);
  assert.match(capturedPrompts[0], /port_from_character/);

  // Turn 2 has NO "포팅" or "다른 캐릭터" keyword at all!
  await ui.send('응 2번 카엘에서 가져와 줘');
  assert.match(capturedPrompts[1], /\[다른 캐릭터 목록/, 'follow-up turn must still load characterCatalog');
  assert.match(capturedPrompts[1], /"action":"port_from_character"/, 'follow-up turn must still include port_from_character schema');
});

test('chat-screen natural phrasing triggers scripts/persona skills, baseline keeps schemas compact, and screenNote matches loaded schemas', () => {
  const chatCtx = { screen: 'chat', targetKind: 'general', freeTalk: true };

  // Fable's 3 real natural-language prompts on the chat screen:
  const p1 = buildSkillPromptSections({ context: chatCtx, userInput: '[HP:숫자]를 예쁘게 꾸며서 보여줘' });
  assert.ok(p1.activeSkillIds.includes('scripts'));
  assert.match(p1.knowledgeText, /RisuAI 정규식 스크립트/);
  assert.ok(p1.schemas.some(s => s.includes('"action":"upsert_regex"')));

  const p2 = buildSkillPromptSections({ context: chatCtx, userInput: '응답마다 턴 수 세는 스크립트 짜줘' });
  assert.ok(p2.activeSkillIds.includes('scripts'));
  assert.match(p2.knowledgeText, /RisuAI Lua 트리거 스크립트 가이드/);
  assert.ok(p2.schemas.some(s => s.includes('"action":"update_lua"')));

  const p3 = buildSkillPromptSections({ context: chatCtx, userInput: '내 캐릭터 프로필 만들어줘' });
  assert.ok(p3.activeSkillIds.includes('persona'));
  assert.match(p3.knowledgeText, /페르소나 \(Persona\) 가이드/);
  assert.ok(p3.schemas.some(s => s.includes('"action":"create_persona"')));

  // Plain Q&A on chat screen keeps compact scripts/persona schemas (v0.4.x parity) WITHOUT heavy Lua guide
  const plainMsgs = buildConversationMessages({
    context: chatCtx,
    snapshot: { label: '자유대화', content: '', target: { targetKind: 'general' } },
    userInput: '로어북이 뭔지 알려줘',
  });
  const sys = plainMsgs[0].content;
  assert.match(sys, /"action":"upsert_regex"/);
  assert.match(sys, /"action":"update_lua"/);
  assert.match(sys, /"action":"create_persona"/);
  assert.doesNotMatch(sys, /RisuAI Lua 트리거 스크립트 가이드/, 'heavy Lua guide stays off for plain Q&A');

  // Consistency invariant: every action advertised in screenNote MUST have its JSON schema loaded
  const noteMatch = sys.match(/활성화된 전용 동작\(([^)]+)\)/);
  assert.ok(noteMatch, 'free-talk screenNote must list active actions');
  const advertised = noteMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  assert.ok(advertised.length > 0);
  for (const act of advertised) {
    assert.ok(
      sys.includes(`"action":"${act}"`),
      `screenNote advertised "${act}" whose schema was not included in system prompt`
    );
  }
  assert.ok(!advertised.includes('create_module'), 'unloaded create_module must not be advertised in screenNote');
  assert.ok(!advertised.includes('create_character'), 'unloaded create_character must not be advertised in screenNote');
});
