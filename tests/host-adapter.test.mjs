import test from 'node:test';
import assert from 'node:assert/strict';
import { HostAdapter, extractLuaFromTriggers, buildLuaTriggers } from '../src/host-adapter.js';

function createMockHost(overrides = {}) {
  const state = {
    charIndex: 0,
    chatIndex: 0,
    character: {
      name: '세라',
      desc: '차분한 마도사.\n별을 연구한다.',
      firstMessage: '안녕, 여행자.',
      globalLore: [
        { comment: '왕국', key: '왕국', content: '북쪽의 오래된 왕국이다.', insertorder: 100 },
      ],
      customscript: [],
      triggerscript: buildLuaTriggers('function onOutput(id)\n  log("hi")\nend'),
      chatPage: 0,
      chats: [
        {
          localLore: [{ comment: '메모', key: '메모', content: '초기 메모', insertorder: 100 }],
          bindedPersona: '',
        },
      ],
    },
    db: {
      temperature: 80,
      maxContext: 8000,
      maxResponse: 1000,
      customCSS: 'body { color: white; }',
      personas: [
        { name: '모험가', personaPrompt: '길드 소속 모험가', icon: '', note: '', id: '' },
      ],
      selectedPersona: 0,
      modules: [
        { id: 'mod-1', name: '테스트 모듈', lorebook: [{ comment: '모듈로어', key: 'k', content: '원문' }], trigger: [], regex: [] },
      ],
      enabledModules: ['mod-1'],
      moduleIntergration: '',
      plugins: [{ name: 'secret-plugin' }],
    },
    dbReads: [],
    dbWrites: [],
    setDatabaseLiteCalls: [],
    setChatCalls: [],
  };

  const api = {
    async getCharacter() { return structuredClone(state.character); },
    async setCharacter(c) { state.character = structuredClone(c); },
    async getCurrentCharacterIndex() { return state.charIndex; },
    async getCurrentChatIndex() { return state.chatIndex; },
    async getChatFromIndex(ci, chi) {
      if (ci === state.charIndex && state.character.chats[chi]) {
        return structuredClone(state.character.chats[chi]);
      }
      return null;
    },
    async setChatToIndex(ci, chi, chat) {
      state.setChatCalls.push({ ci, chi });
      state.character.chats[chi] = structuredClone(chat);
    },
    async getDatabase(keys) {
      state.dbReads.push([...keys]);
      const out = {};
      for (const k of keys) {
        if (Object.hasOwn(state.db, k)) out[k] = structuredClone(state.db[k]);
      }
      return out;
    },
    async setDatabase(partial) {
      state.dbWrites.push(structuredClone(partial));
      Object.assign(state.db, structuredClone(partial));
    },
    async setDatabaseLite(partial) {
      state.setDatabaseLiteCalls.push(structuredClone(partial));
      if (Object.hasOwn(partial, 'characters')) {
        throw new Error('RisuNest forbids setDatabaseLite({ characters })');
      }
      Object.assign(state.db, structuredClone(partial));
    },
    ...overrides,
  };

  return { state, api, adapter: new HostAdapter(api) };
}

test('HostAdapter patches character field and supports 1-click Undo', async () => {
  const { state, adapter } = createMockHost();
  const target = { targetKind: 'char_field', fieldKey: 'desc' };
  const proposal = {
    action: 'patch_text',
    title: '설명 보강',
    edits: [{ before: '별을 연구한다.', after: '고대 천문대에서 별을 연구한다.' }],
  };

  const preview = await adapter.previewProposal(proposal, target);
  assert.equal(preview.ok, true);
  assert.equal(preview.after, '차분한 마도사.\n고대 천문대에서 별을 연구한다.');

  const applied = await adapter.applyProposal(proposal, target);
  assert.equal(applied.ok, true);
  assert.equal(state.character.desc, '차분한 마도사.\n고대 천문대에서 별을 연구한다.');

  await adapter.undo(applied.undoId);
  assert.equal(state.character.desc, '차분한 마도사.\n별을 연구한다.');
});

test('HostAdapter protects PocketRisu _placeholder chats and prefers getChatFromIndex', async () => {
  const realChat = { localLore: [{ comment: '로컬', key: 'a', content: '실제 내용', insertorder: 100 }] };
  const { state, adapter } = createMockHost({
    async getChatFromIndex() { return structuredClone(realChat); },
  });
  state.character.chats[0] = { _placeholder: true };

  const active = await adapter.readActiveChat();
  assert.equal(active.chat.localLore[0].content, '실제 내용');

  // When getChatFromIndex also returns _placeholder (or is absent), throw explicit protection error
  const placeholderHost = createMockHost({ getChatFromIndex: undefined });
  placeholderHost.state.character.chats[0] = { _placeholder: true };
  await assert.rejects(
    () => placeholderHost.adapter.readActiveChat(),
    /_placeholder/
  );
});

test('HostAdapter falls back to _setCharacter when setChatToIndex is absent (RisuAI-Hardened)', async () => {
  const { state, adapter } = createMockHost({ setChatToIndex: undefined });
  const res = await adapter.applyProposal(
    { action: 'create_lorebook', scope: 'chat', comment: '추가로어', key: 'k', content: '본문' },
    { targetKind: 'chat_lorebook', loreScope: 'chat' }
  );
  assert.equal(res.ok, true);
  assert.equal(state.character.chats[0].localLore.length, 2);

  await adapter.undo(res.undoId);
  assert.equal(state.character.chats[0].localLore.length, 1);
});

test('HostAdapter never reads or writes plugins key and avoids RisuNest setDatabaseLite({ characters })', async () => {
  const { state, adapter } = createMockHost({
    risunestCallHostTool() {},
  });
  assert.equal(adapter.detectHostFlavor().name, 'RisuNest');
  assert.equal(adapter.detectHostFlavor().activePersonaAutoSyncs, true);

  await adapter.readDbSubset(['temperature', 'plugins']);
  assert.deepEqual(state.dbReads[0], ['temperature']);

  await adapter.writeDbSubset({ temperature: 95, plugins: [] });
  assert.equal(Object.hasOwn(state.dbWrites[0], 'plugins'), false);
  assert.equal(state.db.plugins.length, 1);
  assert.equal(state.setDatabaseLiteCalls.length, 0);

  // Even if setDatabase is absent, writeDbSubset refuses characters on setDatabaseLite
  const liteOnly = createMockHost({ setDatabase: undefined });
  await assert.rejects(
    () => liteOnly.adapter.writeDbSubset({ characters: [] }),
    /데이터베이스 저장 API/
  );
});

test('HostAdapter creates/updates personas with UUID + bindedPersona and restores both on Undo', async () => {
  const { state, adapter } = createMockHost();
  const created = await adapter.applyProposal(
    { action: 'create_persona', name: '학자', personaPrompt: '천문학자', bindToCurrentChat: true },
    { targetKind: 'persona' }
  );
  assert.equal(created.ok, true);
  assert.equal(state.db.personas.length, 2);
  assert.ok(created.personaId);
  assert.equal(state.character.chats[0].bindedPersona, created.personaId);

  await adapter.undo(created.undoId);
  assert.equal(state.db.personas.length, 1);
  assert.equal(state.character.chats[0].bindedPersona, '');
});

test('HostAdapter validates config keys/types, Lua/regex updates, and rejects non-editable preview targets early', async () => {
  const { state, adapter } = createMockHost();

  const badPreview = await adapter.previewProposal(
    { action: 'replace_text', content: 'hello' },
    { targetKind: 'general' }
  );
  assert.equal(badPreview.ok, false);
  assert.match(badPreview.error, /직접 텍스트 적용을 지원하지 않습니다/);

  await assert.rejects(
    () => adapter.applyProposal({ action: 'update_config', changes: { apiKey: 'leak' } }, { targetKind: 'config' }),
    /허용되지 않는 설정 키/
  );
  await assert.rejects(
    () => adapter.applyProposal({ action: 'update_config', changes: { temperature: 'hot' } }, { targetKind: 'config' }),
    /유한한 숫자/
  );

  const cfgRes = await adapter.applyProposal(
    { action: 'update_config', changes: { temperature: 110, maxResponse: 1500 } },
    { targetKind: 'config' }
  );
  assert.equal(state.db.temperature, 110);
  await adapter.undo(cfgRes.undoId);
  assert.equal(state.db.temperature, 80);

  const luaRes = await adapter.applyProposal(
    { action: 'update_lua', scope: 'character', edits: [{ before: 'log("hi")', after: 'log("hello")' }] },
    { targetKind: 'char_lua' }
  );
  assert.equal(extractLuaFromTriggers(state.character.triggerscript).code, 'function onOutput(id)\n  log("hello")\nend');
  await adapter.undo(luaRes.undoId);
  assert.equal(extractLuaFromTriggers(state.character.triggerscript).code, 'function onOutput(id)\n  log("hi")\nend');

  await adapter.applyProposal(
    { action: 'upsert_regex', scope: 'character', comment: '상태창', in: '\\[HP:(\\d+)\\]', out: '<b>$1</b>', type: 'editdisplay', flag: 'g', ableFlag: true },
    { targetKind: 'char_regex' }
  );
  assert.equal(state.character.customscript.length, 1);
  assert.equal(state.character.customscript[0].type, 'editdisplay');
});

test('Surgical Undo restores only modified fields without wiping subsequent chats or newer entries', async () => {
  const { state, adapter } = createMockHost();
  state.character.chaId = 'char-sera';
  state.character.chats[0].message = [{ role: 'char', data: '안녕, 여행자.' }];

  // 1. Edit char.desc, then add 2 new chat messages, then undo -> messages MUST survive
  const descRes = await adapter.applyProposal(
    { action: 'replace_text', content: '수정된 설명' },
    { targetKind: 'char_field', fieldKey: 'desc' }
  );
  assert.equal(state.character.desc, '수정된 설명');
  state.character.chats[0].message.push(
    { role: 'user', data: '첫 질문' },
    { role: 'char', data: '첫 응답' }
  );
  await adapter.undo(descRes.undoId);
  assert.equal(state.character.desc, '차분한 마도사.\n별을 연구한다.');
  assert.equal(state.character.chats[0].message.length, 3);

  // 2. Edit chat.localLore, then add another chat message, then undo -> messages MUST survive
  const chatLoreRes = await adapter.applyProposal(
    { action: 'update_lorebook', scope: 'chat', loreIndex: 0, content: '바뀐 채팅 로어' },
    { targetKind: 'chat_lorebook', loreScope: 'chat', loreIndex: 0 }
  );
  state.character.chats[0].message.push({ role: 'user', data: '로어 수정 뒤 대화' });
  await adapter.undo(chatLoreRes.undoId);
  assert.equal(state.character.chats[0].localLore[0].content, '초기 메모');
  assert.equal(state.character.chats[0].message.length, 4);

  // 3. Create persona + bind to chat, then add another persona & chat turn, then undo -> newer persona & chat turn survive
  const pRes = await adapter.applyProposal(
    { action: 'create_persona', name: '임시 페르소나', personaPrompt: '임시', bindToCurrentChat: true },
    { targetKind: 'persona' }
  );
  state.db.personas.push({ name: '나중에 추가된 페르소나', personaPrompt: '유지됨', id: 'keep-me' });
  state.character.chats[0].message.push({ role: 'char', data: '페르소나 바인딩 뒤 응답' });
  await adapter.undo(pRes.undoId);
  assert.equal(state.db.personas.some(p => p.id === 'keep-me'), true);
  assert.equal(state.db.personas.some(p => p.id === pRes.personaId), false);
  assert.equal(state.character.chats[0].bindedPersona, '');
  assert.equal(state.character.chats[0].message.length, 5);
});

test('HostAdapter blocks apply/undo if active character changed since proposal preview', async () => {
  const { state, adapter } = createMockHost();
  state.character.chaId = 'char-A';
  const target = { targetKind: 'char_field', fieldKey: 'desc' };
  const proposal = { action: 'replace_text', content: '캐릭터 A 설명 변경' };

  const preview = await adapter.previewProposal(proposal, target);
  assert.equal(preview.ok, true);
  assert.equal(preview.hostBinding.charId, 'char-A');

  // Switch active character to B before apply
  state.character = { ...structuredClone(state.character), chaId: 'char-B', name: '다른 캐릭터', desc: 'B 원본 설명' };
  state.charIndex = 1;

  await assert.rejects(
    () => adapter.applyProposal(proposal, preview.target, { hostBinding: preview.hostBinding }),
    /다른 캐릭터로 전환되어/
  );
  assert.equal(state.character.desc, 'B 원본 설명');
});

test('HostAdapter blocks prompt-injected fieldKey/target overrides in preview and apply', async () => {
  const { state, adapter } = createMockHost();
  const activeDesc = { targetKind: 'char_field', fieldKey: 'desc' };

  // Injection attempt 1: fieldKey: "chats" via proposal.target
  const injectedChats = {
    action: 'replace_text',
    target: { targetKind: 'char_field', fieldKey: 'chats' },
    content: 'corrupted',
  };
  const prev1 = await adapter.previewProposal(injectedChats, activeDesc);
  assert.equal(prev1.ok, false);
  await assert.rejects(() => adapter.applyProposal(injectedChats, activeDesc), /보안상|허용되지 않는/);
  assert.ok(Array.isArray(state.character.chats));

  // Injection attempt 2: redirecting desc to firstMessage via proposal.target
  const redirectField = {
    action: 'replace_text',
    target: { targetKind: 'char_field', fieldKey: 'firstMessage' },
    content: 'hijacked greeting',
  };
  const prev2 = await adapter.previewProposal(redirectField, activeDesc);
  assert.equal(prev2.ok, false);
  assert.match(prev2.error, /보안상/);

  // Defense-in-depth: invalid fieldKey directly on activeTarget
  const badDirect = await adapter.previewProposal(
    { action: 'replace_text', content: 'x' },
    { targetKind: 'char_field', fieldKey: 'chats' }
  );
  assert.equal(badDirect.ok, false);
  assert.match(badDirect.error, /허용되지 않는 캐릭터 필드/);
});

test('HostAdapter exposes all metadata changes in previewProposal for lorebook, persona, and regex updates', async () => {
  const { state, adapter } = createMockHost();

  const lorePreview = await adapter.previewProposal(
    {
      action: 'update_lorebook',
      scope: 'character',
      loreIndex: 0,
      key: '왕국,제국',
      alwaysActive: true,
      insertorder: 250,
      content: '북쪽의 오래된 왕국이다.',
    },
    { targetKind: 'char_lorebook', loreIndex: 0 }
  );
  assert.equal(lorePreview.ok, true);
  assert.equal(lorePreview.metaChanges.length, 3);
  assert.ok(lorePreview.metaChanges.some(m => m.key === 'key' && m.after === '왕국,제국'));
  assert.ok(lorePreview.metaChanges.some(m => m.key === 'alwaysActive' && m.after === '예'));
  assert.ok(lorePreview.metaChanges.some(m => m.key === 'insertorder' && m.after === '250'));

  const personaPreview = await adapter.previewProposal(
    { action: 'update_persona', personaIndex: 0, name: '베테랑 모험가', note: '메모 추가', personaPrompt: '길드 소속 모험가' },
    { targetKind: 'persona', personaIndex: 0 }
  );
  assert.equal(personaPreview.ok, true);
  assert.ok(personaPreview.metaChanges.some(m => m.key === 'name' && m.before === '모험가' && m.after === '베테랑 모험가'));
  assert.ok(personaPreview.metaChanges.some(m => m.key === 'note' && m.after === '메모 추가'));

  state.character.customscript.push({ comment: '기존', in: 'foo', out: 'bar', type: 'editdisplay', flag: 'g', ableFlag: false });
  const regexPreview = await adapter.previewProposal(
    { action: 'upsert_regex', scope: 'character', regexIndex: 0, comment: '개선', in: 'foo+', out: 'baz', type: 'editdisplay', flag: 'gi', ableFlag: true },
    { targetKind: 'char_regex', regexIndex: 0 }
  );
  assert.equal(regexPreview.ok, true);
  assert.equal(regexPreview.before, 'bar');
  assert.equal(regexPreview.after, 'baz');
  assert.ok(regexPreview.metaChanges.some(m => m.key === 'in' && m.before === 'foo' && m.after === 'foo+'));
  assert.ok(regexPreview.metaChanges.some(m => m.key === 'flag' && m.after === 'gi'));
});

test('HostAdapter blocks full overwrite on >24,000-char truncated targets while allowing patch_text', async () => {
  const { state, adapter } = createMockHost();
  const tailMarker = 'TAIL_MUST_SURVIVE';
  state.character.desc = 'A'.repeat(24500) + '\n' + tailMarker;
  const target = { targetKind: 'char_field', fieldKey: 'desc' };

  const replacePrev = await adapter.previewProposal({ action: 'replace_text', content: 'short' }, target);
  assert.equal(replacePrev.ok, false);
  assert.match(replacePrev.error, /24,000자/);

  await assert.rejects(
    () => adapter.applyProposal({ action: 'replace_text', content: 'short' }, target),
    /24,000자/
  );

  // Partial edit still works and preserves tail
  const patchRes = await adapter.applyProposal(
    { action: 'patch_text', edits: [{ before: 'AAAAA\n' + tailMarker, after: 'BBBBB\n' + tailMarker }] },
    target
  );
  assert.equal(patchRes.ok, true);
  assert.ok(state.character.desc.endsWith('BBBBB\n' + tailMarker));
});

test('HostAdapter warns explicitly and requires confirmation when Lua replaces existing V1/V2 triggers', async () => {
  const { state, adapter } = createMockHost();
  state.character.triggerscript = [
    { comment: 'V1 trigger 1', type: 'start', conditions: [], effect: [{ type: 'setvar', var: 'a', value: '1' }] },
    { comment: 'V1 trigger 2', type: 'output', conditions: [], effect: [{ type: 'setvar', var: 'b', value: '2' }] },
  ];
  const proposal = { action: 'update_lua', scope: 'character', code: 'function onStart(id) end' };

  const preview = await adapter.previewProposal(proposal, { targetKind: 'char_lua' });
  assert.equal(preview.ok, true);
  assert.equal(preview.requiresConfirm, true);
  assert.match(preview.destructiveWarning, /2개의/);
  assert.match(preview.destructiveWarning, /병합되지 않고 모두 삭제/);

  await assert.rejects(
    () => adapter.applyProposal(proposal, preview.target, {
      hostBinding: preview.hostBinding,
      requireDestructiveConfirm: true,
      destructiveConfirmed: false,
    }),
    /삭제 확인/
  );
  assert.equal(state.character.triggerscript.length, 2);

  const applied = await adapter.applyProposal(proposal, preview.target, {
    hostBinding: preview.hostBinding,
    requireDestructiveConfirm: true,
    destructiveConfirmed: true,
  });
  assert.equal(extractLuaFromTriggers(state.character.triggerscript).isLua, true);

  await adapter.undo(applied.undoId);
  assert.equal(state.character.triggerscript.length, 2);
  assert.equal(state.character.triggerscript[0].comment, 'V1 trigger 1');
});

test('HostAdapter supports chat_note (Author\'s Note) preview, apply, validation, and surgical Undo preserving newer messages', async () => {
  const { state, adapter } = createMockHost();
  state.character.chaId = 'char-sera';
  state.character.chats[0].note = '기존 작가의 노트: 3인칭 시점 유지';
  state.character.chats[0].message = [{ role: 'char', data: '안녕, 여행자.' }];

  const target = { targetKind: 'chat_note', fieldKey: 'note' };

  // Invalid fieldKey on chat_note is rejected
  const badField = await adapter.previewProposal(
    { action: 'replace_text', content: 'hack' },
    { targetKind: 'chat_note', fieldKey: 'message' }
  );
  assert.equal(badField.ok, false);
  assert.match(badField.error, /허용되지 않는 작가의 노트 필드/);

  // Preview and apply patch_text
  const proposal = {
    action: 'patch_text',
    title: '문체 지시 보강',
    edits: [{ before: '3인칭 시점 유지', after: '3인칭 관찰자 시점과 잔잔한 문체 유지' }],
  };
  const preview = await adapter.previewProposal(proposal, target);
  assert.equal(preview.ok, true);
  assert.equal(preview.label, '작가의 노트 (현재 채팅)');
  assert.equal(preview.after, '기존 작가의 노트: 3인칭 관찰자 시점과 잔잔한 문체 유지');

  const applied = await adapter.applyProposal(proposal, preview.target, { hostBinding: preview.hostBinding });
  assert.equal(applied.ok, true);
  assert.equal(state.character.chats[0].note, '기존 작가의 노트: 3인칭 관찰자 시점과 잔잔한 문체 유지');

  // Subsequent chat turns MUST survive Undo of chat_note
  state.character.chats[0].message.push(
    { role: 'user', data: '노트 바꾼 뒤 유저 메시지' },
    { role: 'char', data: '노트 바꾼 뒤 캐릭터 응답' }
  );

  await adapter.undo(applied.undoId);
  assert.equal(state.character.chats[0].note, '기존 작가의 노트: 3인칭 시점 유지');
  assert.equal(state.character.chats[0].message.length, 3);
});

test('HostAdapter does not misidentify catch-all Plugin v3 Proxy as RisuNest and detects PocketRisu via rootDoc <title>', async () => {
  // Real RisuAI / PocketRisu `window.risuai` is a catch-all Proxy returning a function for ANY property name
  const proxyApi = new Proxy({}, {
    get(_target, prop) {
      return async () => { throw new Error(`Method ${String(prop)} not found`); };
    },
  });
  const adapter = new HostAdapter(proxyApi);

  // Even before probing rootDoc, must NEVER falsely report RisuNest!
  assert.equal(adapter.detectHostFlavor().name, 'RisuAI');
  assert.equal(adapter.detectHostFlavor().activePersonaAutoSyncs, false);

  // Probing PocketRisu rootDoc <title> identifies PocketRisu accurately
  const pocketRootDoc = {
    async querySelector(sel) {
      if (sel === 'title') return { async textContent() { return 'PocketRisu'; } };
      return null;
    },
  };
  const flavor = await adapter.probeHostFlavor(pocketRootDoc);
  assert.equal(flavor.name, 'PocketRisu');
  assert.equal(adapter.detectHostFlavor().name, 'PocketRisu');
  assert.equal(flavor.activePersonaAutoSyncs, false);
});

test('HostAdapter supports Display guiHTML/customCSS, depthPrompt, alternateGreetings, module_field, chat_message (with swipes sync & -1 redirect), and friendly DB permission hint', async () => {
  let allowDb = false;
  const db = {
    guiHTML: '<div class="chat">{{slot}}</div>',
    customCSS: '.risu-chat { font-size: 14px; }',
    modules: [
      {
        id: 'mod-hud-1',
        name: '상태창 모듈',
        description: '기존 모듈 설명',
        backgroundEmbedding: '<style>.hud{color:red}</style>',
        customModuleToggle: 'hp=HP 표시=switch',
        lorebook: [],
        regex: [],
        trigger: [],
      },
    ],
    enabledModules: ['mod-hud-1'],
    personas: [],
    selectedPersona: 0,
  };

  const state = {
    character: {
      chaId: 'char-adv-1',
      name: '에린',
      firstMessage: '기본 첫 메시지',
      alternateGreetings: ['추가 인사 1', '추가 인사 2 (수정 전)'],
      additionalText: '추가 설명 원본',
      defaultVariables: 'hp=100\nmp=50',
      depth_prompt: { depth: 4, prompt: '기존 깊이 지시' },
      globalLore: [],
      customscript: [],
      triggerscript: [],
      chatPage: 0,
      chats: [
        {
          fmIndex: 1,
          note: '',
          localLore: [],
          message: [
            { role: 'user', data: '안녕', chatId: 'm-0' },
            { role: 'char', data: '오타가 잇는 응답', chatId: 'm-1', swipeId: 0, swipes: ['오타가 잇는 응답', '다른 스와이프'] },
          ],
        },
      ],
    },
  };

  const api = {
    async getCharacter() { return structuredClone(state.character); },
    async setCharacter(c) { state.character = structuredClone(c); },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return 0; },
    async getChatFromIndex(_ci, chIdx) { return structuredClone(state.character.chats[chIdx]); },
    async setChatToIndex(_ci, chIdx, nextChat) { state.character.chats[chIdx] = structuredClone(nextChat); },
    async getDatabase(keys) {
      if (!allowDb) return null;
      const out = {};
      for (const k of keys) out[k] = structuredClone(db[k]);
      return out;
    },
    async setDatabase(partial) {
      for (const [k, v] of Object.entries(partial)) db[k] = structuredClone(v);
    },
  };

  const adapter = new HostAdapter(api);

  // 1. Denied DB permission gives clear PocketRisu/RisuAI permission reset hint
  const deniedSnap = await adapter.readTargetSnapshot({ targetKind: 'config', fieldKey: 'guiHTML' });
  assert.equal(deniedSnap.ok, false);
  assert.match(deniedSnap.reason, /권한 초기화/);

  // 2. Display guiHTML patch + Undo
  allowDb = true;
  const guiPrev = await adapter.previewProposal(
    { action: 'patch_text', edits: [{ before: 'class="chat"', after: 'class="chat-v2"' }] },
    { targetKind: 'config', fieldKey: 'guiHTML' }
  );
  assert.equal(guiPrev.ok, true);
  assert.equal(guiPrev.label, '설정 · 채팅 HTML (guiHTML)');
  const guiRes = await adapter.applyProposal(
    { action: 'patch_text', edits: [{ before: 'class="chat"', after: 'class="chat-v2"' }] },
    guiPrev.target
  );
  assert.equal(db.guiHTML, '<div class="chat-v2">{{slot}}</div>');
  await adapter.undo(guiRes.undoId);
  assert.equal(db.guiHTML, '<div class="chat">{{slot}}</div>');

  // 3. Character depthPrompt preserves numeric depth and restores on Undo
  const depthPrev = await adapter.previewProposal(
    { action: 'replace_text', content: '새 깊이 지시' },
    { targetKind: 'char_field', fieldKey: 'depthPrompt' }
  );
  assert.equal(depthPrev.ok, true);
  assert.equal(depthPrev.before, '기존 깊이 지시');
  const depthRes = await adapter.applyProposal(
    { action: 'replace_text', content: '새 깊이 지시' },
    depthPrev.target,
    { hostBinding: depthPrev.hostBinding }
  );
  assert.deepEqual(state.character.depth_prompt, { depth: 4, prompt: '새 깊이 지시' });
  await adapter.undo(depthRes.undoId);
  assert.deepEqual(state.character.depth_prompt, { depth: 4, prompt: '기존 깊이 지시' });

  // 4. Character alternateGreetings #2 + surgical Undo (leaves #1 intact)
  const altPrev = await adapter.previewProposal(
    { action: 'patch_text', edits: [{ before: '(수정 전)', after: '(수정 후)' }] },
    { targetKind: 'char_alt_greeting', greetingIndex: 1 }
  );
  assert.equal(altPrev.ok, true);
  const altRes = await adapter.applyProposal(
    { action: 'patch_text', edits: [{ before: '(수정 전)', after: '(수정 후)' }] },
    altPrev.target,
    { hostBinding: altPrev.hostBinding }
  );
  assert.equal(state.character.alternateGreetings[1], '추가 인사 2 (수정 후)');
  await adapter.undo(altRes.undoId);
  assert.equal(state.character.alternateGreetings[1], '추가 인사 2 (수정 전)');
  assert.equal(state.character.alternateGreetings[0], '추가 인사 1');

  // 5. Module field (backgroundEmbedding) patch + Undo by moduleId
  const modPrev = await adapter.previewProposal(
    { action: 'patch_text', edits: [{ before: 'color:red', after: 'color:cyan' }] },
    { targetKind: 'module_field', fieldKey: 'backgroundEmbedding', moduleIndex: 0 }
  );
  assert.equal(modPrev.ok, true);
  const modRes = await adapter.applyProposal(
    { action: 'patch_text', edits: [{ before: 'color:red', after: 'color:cyan' }] },
    modPrev.target,
    { hostBinding: modPrev.hostBinding }
  );
  assert.equal(db.modules[0].backgroundEmbedding, '<style>.hud{color:cyan}</style>');
  await adapter.undo(modRes.undoId);
  assert.equal(db.modules[0].backgroundEmbedding, '<style>.hud{color:red}</style>');

  // 6. Chat message edit syncs swipes[swipeId] and surgical Undo preserves newer messages
  const msgPrev = await adapter.previewProposal(
    { action: 'patch_text', edits: [{ before: '오타가 잇는 응답', after: '오타를 고친 응답' }] },
    { targetKind: 'chat_message', messageIndex: 1 }
  );
  assert.equal(msgPrev.ok, true);
  const msgRes = await adapter.applyProposal(
    { action: 'patch_text', edits: [{ before: '오타가 잇는 응답', after: '오타를 고친 응답' }] },
    msgPrev.target,
    { hostBinding: msgPrev.hostBinding }
  );
  assert.equal(state.character.chats[0].message[1].data, '오타를 고친 응답');
  assert.equal(state.character.chats[0].message[1].swipes[0], '오타를 고친 응답');
  assert.equal(state.character.chats[0].message[1].swipes[1], '다른 스와이프');

  // Newer message arrives before Undo
  state.character.chats[0].message.push({ role: 'user', data: '이후 새 메시지', chatId: 'm-2' });
  await adapter.undo(msgRes.undoId);
  assert.equal(state.character.chats[0].message[1].data, '오타가 잇는 응답');
  assert.equal(state.character.chats[0].message[1].swipes[0], '오타가 잇는 응답');
  assert.equal(state.character.chats[0].message.length, 3);

  // 7. Chat messageIndex -1 redirects to active alternateGreeting when chat.fmIndex === 1
  const fmSnap = await adapter.readTargetSnapshot({ targetKind: 'chat_message', messageIndex: -1 });
  assert.equal(fmSnap.ok, true);
  assert.equal(fmSnap.target.targetKind, 'char_alt_greeting');
  assert.equal(fmSnap.target.greetingIndex, 1);
  assert.equal(fmSnap.content, '추가 인사 2 (수정 전)');
});

test('HostAdapter auto-matches the open module via moduleDomHints instead of defaulting to db.modules[0], exposes loreSummary, and pins writes/undo to the right module', async () => {
  const { resolveModuleIndex } = await import('../src/host-adapter.js');

  const db = {
    modules: [
      {
        id: 'mod-inlay',
        name: '🆔인레이 모듈 마개조 V3.7.6',
        description: 'AI챗고수가도리거야',
        lorebook: Array.from({ length: 10 }, (_, i) => ({
          comment: `인레이 항목 ${i + 1}`,
          key: `inlay_${i}`,
          content: `Inlay body ${i}`,
          insertorder: 100,
          alwaysActive: false,
        })),
        regex: [{ comment: 'Inlay Parser', in: 'a', out: 'b', type: 'editdisplay', flag: 'g', ableFlag: false }],
        trigger: [],
      },
      {
        id: 'mod-status',
        name: '상태창 모듈',
        description: '상태창 UI',
        lorebook: [
          { comment: 'Status Prompt', key: 'status', content: 'Render HUD', insertorder: 100, alwaysActive: true },
        ],
        regex: [],
        trigger: [{ comment: '', type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: 'function onOutput() return 1 end' }] }],
      },
      {
        id: 'mod-bg',
        name: '배경 자동 변경 모듈',
        description: '장소별 배경 자동 렌더링',
        backgroundEmbedding: '<style>.bg-stage{background-size:cover;}</style>',
        lorebook: [
          { comment: 'ha0', key: '', content: 'init bg', insertorder: 100, alwaysActive: true },
          {
            comment: 'Global LoreBook Override',
            key: '',
            content: '- CRITICAL: This is a front-end rendering command.\nBackground List: airplane interior, airport, alley',
            insertorder: 999,
            alwaysActive: true,
          },
          { comment: 'Home', key: 'home', content: 'home scene', insertorder: 100, alwaysActive: false },
        ],
        regex: [
          { comment: 'BG Tag Parser', in: '<bg>(.*?)</bg>', out: '<img src="$1">', type: 'editdisplay', flag: 'g', ableFlag: false },
        ],
        trigger: [],
      },
    ],
    enabledModules: ['mod-inlay', 'mod-bg'],
  };

  const api = {
    async getDatabase() { return JSON.parse(JSON.stringify(db)); },
    async setDatabaseLite(patch) {
      if (patch.modules) db.modules = JSON.parse(JSON.stringify(patch.modules));
    },
  };

  const adapter = new HostAdapter(api);

  // 1. Auto-detected module_lorebook with NO explicit moduleIndex resolves db.modules[2] (NOT modules[0]!)
  const detectedCtx = {
    screen: 'module',
    targetKind: 'module_lorebook',
    fieldKey: 'content',
    loreIndex: 1,
    loreScope: 'module',
    moduleDomHints: {
      tab: 'lorebook',
      totalIdxCount: 3,
      items: [
        { idx: 0, title: 'ha0' },
        { idx: 1, title: 'Global LoreBook Override' },
        { idx: 2, title: 'Home' },
      ],
      openIdx: 1,
      textPreview: '- CRITICAL: This is a front-end rendering command.\nBackground List: airplane interior',
      fingerprint: 'lorebook#3#0:ha0,1:Global LoreBook Override,2:Home#1',
    },
  };

  const snap = await adapter.readTargetSnapshot(detectedCtx);
  assert.equal(snap.ok, true);
  assert.equal(snap.target.moduleIndex, 2);
  assert.equal(snap.moduleMatchedBy, 'dom_hints');
  assert.equal(snap.hostBinding.moduleId, 'mod-bg');
  assert.ok(snap.label.includes('배경 자동 변경 모듈'));
  assert.ok(snap.label.includes('Global LoreBook Override'));
  assert.ok(snap.content.startsWith('- CRITICAL: This is a front-end rendering command.'));
  assert.equal(snap.loreCount, 3);
  assert.equal(snap.loreSummary.length, 3);
  assert.equal(snap.loreSummary[1].comment, 'Global LoreBook Override');

  // 2. Switching to 기본 정보 tab (no DOM hints) remembers mod-bg via _lastMatchedModuleId
  const basicSnap = await adapter.readTargetSnapshot({
    screen: 'module',
    targetKind: 'module_field',
    fieldKey: 'description',
  });
  assert.equal(basicSnap.ok, true);
  assert.equal(basicSnap.target.moduleIndex, 2);
  assert.equal(basicSnap.moduleMatchedBy, 'preferred');
  assert.equal(basicSnap.content, '장소별 배경 자동 렌더링');

  // 3. Preview + Apply patch_text updates ONLY db.modules[2].lorebook[1] (never modules[0]) and Undo restores cleanly
  const prev = await adapter.previewProposal(
    { action: 'patch_text', edits: [{ before: 'alley', after: 'alley, rooftop' }] },
    detectedCtx
  );
  assert.equal(prev.ok, true);
  assert.equal(prev.target.moduleIndex, 2);
  assert.equal(prev.hostBinding.moduleId, 'mod-bg');

  const applied = await adapter.applyProposal(
    { action: 'patch_text', edits: [{ before: 'alley', after: 'alley, rooftop' }] },
    prev.target,
    { hostBinding: prev.hostBinding }
  );
  assert.equal(applied.ok, true);
  assert.ok(db.modules[2].lorebook[1].content.includes('alley, rooftop'));
  assert.equal(db.modules[0].lorebook[1].content, 'Inlay body 1', 'modules[0] must remain completely untouched');

  await adapter.undo(applied.undoId);
  assert.equal(
    db.modules[2].lorebook[1].content,
    '- CRITICAL: This is a front-end rendering command.\nBackground List: airplane interior, airport, alley'
  );

  // 4. Title-only lorebook matching (before expanding any entry), regex-tab backgroundEmbedding matching, and Lua preview matching
  const titleOnlyMatch = resolveModuleIndex(db.modules, {
    targetKind: 'module_lorebook',
    moduleDomHints: { tab: 'lorebook', totalIdxCount: 3, items: [{ idx: 0, title: 'ha0' }, { idx: 2, title: 'Home' }], openIdx: null, textPreview: '' },
  });
  assert.equal(titleOnlyMatch.index, 2);

  const regexBgMatch = resolveModuleIndex(db.modules, {
    targetKind: 'module_field',
    fieldKey: 'backgroundEmbedding',
    moduleDomHints: { tab: 'regex', totalIdxCount: 1, items: [{ idx: 0, title: 'BG Tag Parser' }], openIdx: null, textPreview: '' },
  });
  assert.equal(regexBgMatch.index, 2);

  const luaMatch = resolveModuleIndex(db.modules, {
    targetKind: 'module_lua',
    moduleDomHints: { tab: 'trigger', totalIdxCount: 0, items: [], openIdx: null, textPreview: 'function onOutput() return 1 end' },
  });
  assert.equal(luaMatch.index, 1);
});

function createTwinModuleHost() {
  const lore = (comment, content) => ({ comment, key: 'k', content, insertorder: 100, alwaysActive: false });
  const host = createMockHost();
  host.state.db.modules = [
    { id: 'mod-a', name: 'Original', description: 'first', lorebook: [lore('Intro', 'same body text here')], regex: [], trigger: [] },
    { id: 'mod-b', name: 'Copy of Original', description: 'second', lorebook: [lore('Intro', 'same body text here')], regex: [], trigger: [] },
  ];
  host.state.db.enabledModules = [];
  return host;
}

test('resolveModuleIndex reports a tie between identical modules as ambiguous instead of silently picking the first', async () => {
  const { resolveModuleIndex } = await import('../src/host-adapter.js');
  const { state } = createTwinModuleHost();
  const res = resolveModuleIndex(state.db.modules, {
    targetKind: 'module_lorebook',
    moduleDomHints: { tab: 'lorebook', items: [{ idx: 0, title: 'Intro' }], openIdx: 0, textPreview: 'same body text here', totalIdxCount: 1 },
  });
  assert.equal(res.matchedBy, 'ambiguous');
});

test('resolveModuleIndex flags the modules[0] guess as a fallback only when several modules are installed', async () => {
  const { resolveModuleIndex } = await import('../src/host-adapter.js');
  const { state } = createTwinModuleHost();
  assert.equal(resolveModuleIndex(state.db.modules, { targetKind: 'module_field', fieldKey: 'description' }).matchedBy, 'fallback');
  const single = resolveModuleIndex(state.db.modules.slice(0, 1), { targetKind: 'module_field', fieldKey: 'description' });
  assert.deepEqual({ index: single.index, matchedBy: single.matchedBy }, { index: 0, matchedBy: 'single' });
});

test('HostAdapter refuses to preview or apply a module edit when the open module cannot be identified', async () => {
  const { api, state } = createTwinModuleHost();
  const adapter = new HostAdapter(api);
  const target = { targetKind: 'module_lorebook', loreIndex: 0, fieldKey: 'content' };
  const proposal = { action: 'replace_text', content: 'OVERWRITTEN' };

  const snap = await adapter.readTargetSnapshot(target);
  assert.equal(snap.moduleUncertain, true);

  const preview = await adapter.previewProposal(proposal, target);
  assert.equal(preview.ok, false);
  assert.match(preview.error, /모듈/);

  await assert.rejects(() => adapter.applyProposal(proposal, target, {}), /모듈/);
  assert.equal(state.db.modules[0].lorebook[0].content, 'same body text here');
  assert.equal(state.db.modules[1].lorebook[0].content, 'same body text here');
});

test('HostAdapter edits the module the user picked explicitly even when modules are otherwise indistinguishable', async () => {
  const { api, state } = createTwinModuleHost();
  const adapter = new HostAdapter(api);
  const target = { targetKind: 'module_lorebook', moduleIndex: 1, loreIndex: 0, fieldKey: 'content' };
  const proposal = { action: 'replace_text', content: 'PICKED' };

  const preview = await adapter.previewProposal(proposal, target);
  assert.equal(preview.ok, true);
  await adapter.applyProposal(proposal, preview.target, { hostBinding: preview.hostBinding });
  assert.equal(state.db.modules[0].lorebook[0].content, 'same body text here');
  assert.equal(state.db.modules[1].lorebook[0].content, 'PICKED');
});
