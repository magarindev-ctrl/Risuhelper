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
  adapter.maxContentChars = 24000;
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

test('Lorebook folder canonicalization prevents malformed keys, blocks nonexistent folders, and resolves existing folders by name/key/index', async () => {
  const {
    LORE_FOLDER_PREFIX,
    canonicalizeFolderKey,
    resolveFolderRef,
    normalizeLorebookEntry,
  } = await import('../src/host-adapter.js');

  // 1. canonicalizeFolderKey repairs empty, double-escaped, bare-prefix, and slug keys
  assert.ok(canonicalizeFolderKey('').startsWith(LORE_FOLDER_PREFIX));
  assert.equal(canonicalizeFolderKey('\\uf000folder:abc-1'), '\uf000folder:abc-1');
  assert.equal(canonicalizeFolderKey('\\\\uF000folder:abc-2'), '\uf000folder:abc-2');
  assert.equal(canonicalizeFolderKey('folder:abc-3'), '\uf000folder:abc-3');
  assert.equal(canonicalizeFolderKey('abc-4'), '\uf000folder:abc-4');
  assert.equal(canonicalizeFolderKey('\uf000folder:already-ok'), '\uf000folder:already-ok');

  // 2. normalizeLorebookEntry forces canonical key for mode:'folder', strips nested folder, and preserves existing UUID on rename
  const newFolder = normalizeLorebookEntry({ mode: 'folder', comment: '세계관', key: '', content: 'ignored', folder: 'bad' });
  assert.ok(newFolder.key.startsWith(LORE_FOLDER_PREFIX));
  assert.equal(newFolder.content, '');
  assert.equal(Object.hasOwn(newFolder, 'folder'), false);

  const renamed = normalizeLorebookEntry({ comment: '세계관 V2', key: '' }, newFolder);
  assert.equal(renamed.key, newFolder.key, 'renaming an existing folder must preserve its UUID key');

  const cleared = normalizeLorebookEntry({ folder: '' }, { comment: 'A', key: 'a', content: 'x', folder: newFolder.key });
  assert.equal(Object.hasOwn(cleared, 'folder'), false);

  // 3. HostAdapter blocks update_lorebook/create_lorebook with nonexistent folder keys (prevents Bug #1 orphaning)
  const { state, adapter } = createMockHost();
  const realKey = '\uf000folder:world-uuid-1';
  state.character.globalLore = [
    { comment: '북부 왕국', key: '왕국', content: '본문 1', insertorder: 100, mode: 'normal' },
    { comment: '세계관', key: realKey, content: '', insertorder: 100, mode: 'folder', alwaysActive: false, secondkey: '', selective: false },
  ];

  const badPrev = await adapter.previewProposal(
    { action: 'update_lorebook', scope: 'character', loreIndex: 0, folder: '존재하지않는폴더' },
    { targetKind: 'char_lorebook', loreScope: 'character', loreIndex: 0 }
  );
  assert.equal(badPrev.ok, false);
  assert.match(badPrev.error, /찾을 수 없습니다/);

  await assert.rejects(
    () => adapter.applyProposal(
      { action: 'update_lorebook', scope: 'character', loreIndex: 0, folder: 'fake-folder-id' },
      { targetKind: 'char_lorebook', loreScope: 'character', loreIndex: 0 }
    ),
    /숨겨지므로 차단/
  );
  assert.equal(state.character.globalLore[0].folder, undefined, 'failed folder move must leave entry visible at root');

  // 4. Resolves existing folder by display name, escaped key, and folderIndex
  const byName = await adapter.applyProposal(
    { action: 'update_lorebook', scope: 'character', loreIndex: 0, folder: '세계관' },
    { targetKind: 'char_lorebook', loreScope: 'character', loreIndex: 0 }
  );
  assert.equal(byName.ok, true);
  assert.equal(state.character.globalLore[0].folder, realKey);

  // Back to root via empty string
  await adapter.applyProposal(
    { action: 'update_lorebook', scope: 'character', loreIndex: 0, folder: '' },
    { targetKind: 'char_lorebook', loreScope: 'character', loreIndex: 0 }
  );
  assert.equal(Object.hasOwn(state.character.globalLore[0], 'folder'), false);

  // Escaped key resolves to real U+F000 key
  const refEscaped = resolveFolderRef(state.character.globalLore, { folder: '\\uf000folder:world-uuid-1' });
  assert.equal(refEscaped.ok, true);
  assert.equal(refEscaped.folderKey, realKey);

  // Nesting a folder inside another folder is blocked
  const nestPrev = await adapter.previewProposal(
    { action: 'create_lorebook', scope: 'character', mode: 'folder', comment: '중첩폴더', folder: '세계관' },
    { targetKind: 'char_lorebook', loreScope: 'character' }
  );
  assert.equal(nestPrev.ok, false);
  assert.match(nestPrev.error, /중첩할 수 없습니다/);
});

test('organize_lorebook creates folder + moves 25 entries atomically, reuses folders past index 40, supports module/chat scopes, and undoes in 1 click', async () => {
  const { LORE_FOLDER_PREFIX } = await import('../src/host-adapter.js');
  const { state, adapter } = createMockHost();

  // Seed 45 lorebooks + 1 pre-existing folder at the very end (index 45, previously invisible past slice(0,30)/(0,40)!)
  const preExistingFolderKey = '\uf000folder:late-folder-45';
  state.character.globalLore = Array.from({ length: 45 }, (_, i) => ({
    comment: `항목 ${i + 1}`,
    key: `k${i + 1}`,
    content: `내용 ${i + 1}`,
    insertorder: 100,
    mode: 'normal',
  }));
  state.character.globalLore.push({
    comment: '미리 만든 폴더',
    key: preExistingFolderKey,
    content: '',
    insertorder: 100,
    mode: 'folder',
    alwaysActive: false,
    secondkey: '',
    selective: false,
  });

  // Snapshot MUST include the folder at index 45 in both loreSummary and foldersSummary
  const snap = await adapter.readTargetSnapshot({ targetKind: 'char_lorebook', loreScope: 'character' });
  assert.equal(snap.ok, true);
  assert.equal(snap.foldersSummary.length, 1);
  assert.equal(snap.foldersSummary[0].index, 45);
  assert.equal(snap.foldersSummary[0].name, '미리 만든 폴더');
  assert.ok(snap.loreSummary.some(e => e.index === 45 && e.mode === 'folder'));

  // 1. Create a NEW folder and move 25 entries atomically (only 1 Undo slot!)
  const indices25 = Array.from({ length: 25 }, (_, i) => i);
  const createProp = {
    action: 'organize_lorebook',
    scope: 'character',
    folderName: '세계관 묶음',
    createFolderIfMissing: true,
    loreIndices: indices25,
  };
  const createPrev = await adapter.previewProposal(createProp, { targetKind: 'char_lorebook', loreScope: 'character' });
  assert.equal(createPrev.ok, true);
  assert.match(createPrev.after, /새 폴더 생성: "세계관 묶음"/);

  const createRes = await adapter.applyProposal(createProp, createPrev.target, { hostBinding: createPrev.hostBinding });
  assert.equal(createRes.ok, true);
  assert.equal(createRes.createdFolder, true);
  assert.equal(createRes.movedCount, 25);
  assert.ok(createRes.folderKey.startsWith(LORE_FOLDER_PREFIX));
  assert.equal(adapter.undoStack.length, 1, 'moving 25 entries + creating folder must take only 1 undo slot');

  const createdFolderEntry = state.character.globalLore.find(e => e.mode === 'folder' && e.comment === '세계관 묶음');
  assert.ok(createdFolderEntry);
  assert.equal(createdFolderEntry.key, createRes.folderKey);
  for (const idx of indices25) {
    assert.equal(state.character.globalLore[idx].folder, createRes.folderKey);
  }

  // 1-click surgical Undo restores all 25 entries to root AND removes the newly created folder
  await adapter.undo(createRes.undoId);
  assert.equal(state.character.globalLore.length, 46);
  for (const idx of indices25) {
    assert.equal(Object.hasOwn(state.character.globalLore[idx], 'folder'), false);
  }

  // 2. Move into pre-existing folder at index 45 by folderName (even if folder index accidentally included in loreIndices!)
  const reuseProp = {
    action: 'organize_lorebook',
    scope: 'character',
    folderName: '미리 만든 폴더',
    loreIndices: [0, 1, 2, 45],
  };
  const reusePrev = await adapter.previewProposal(reuseProp, { targetKind: 'char_lorebook', loreScope: 'character' });
  assert.equal(reusePrev.ok, true);
  assert.match(reusePrev.warning, /중첩할 수 없어 이동 대상에서 제외/);

  const reuseRes = await adapter.applyProposal(reuseProp, reusePrev.target, { hostBinding: reusePrev.hostBinding });
  assert.equal(reuseRes.createdFolder, false, 'must reuse existing folder without creating a duplicate');
  assert.equal(state.character.globalLore.length, 46);
  assert.equal(state.character.globalLore[0].folder, preExistingFolderKey);
  assert.equal(state.character.globalLore[1].folder, preExistingFolderKey);
  assert.equal(state.character.globalLore[2].folder, preExistingFolderKey);
  assert.equal(Object.hasOwn(state.character.globalLore[45], 'folder'), false);

  // 3. Move back to root
  const rootRes = await adapter.applyProposal(
    { action: 'organize_lorebook', scope: 'character', moveToRoot: true, loreIndices: [0, 1] },
    { targetKind: 'char_lorebook', loreScope: 'character' }
  );
  assert.equal(Object.hasOwn(state.character.globalLore[0], 'folder'), false);
  assert.equal(Object.hasOwn(state.character.globalLore[1], 'folder'), false);
  assert.equal(state.character.globalLore[2].folder, preExistingFolderKey);
  await adapter.undo(rootRes.undoId);
  assert.equal(state.character.globalLore[0].folder, preExistingFolderKey);

  // 4. Module scope organize_lorebook + Undo
  state.db.modules[0].lorebook = [
    { comment: 'M1', key: 'm1', content: 'c1', mode: 'normal' },
    { comment: 'M2', key: 'm2', content: 'c2', mode: 'normal' },
  ];
  const modRes = await adapter.applyProposal(
    { action: 'organize_lorebook', scope: 'module', moduleIndex: 0, folderName: '모듈폴더', loreIndices: [0, 1] },
    { targetKind: 'module_lorebook', loreScope: 'module', moduleIndex: 0 }
  );
  assert.equal(state.db.modules[0].lorebook.length, 3);
  assert.equal(state.db.modules[0].lorebook[0].folder, modRes.folderKey);
  assert.equal(state.db.modules[0].lorebook[1].folder, modRes.folderKey);
  await adapter.undo(modRes.undoId);
  assert.equal(state.db.modules[0].lorebook.length, 2);
  assert.equal(Object.hasOwn(state.db.modules[0].lorebook[0], 'folder'), false);
});

test('HostAdapter supports >= 100 Undo history depth without dropping edits beyond 20 (Bug #2)', async () => {
  const { state, adapter } = createMockHost();
  assert.ok(adapter.maxUndo >= 100);

  const initial = state.character.desc;
  const undoIds = [];
  for (let i = 1; i <= 30; i++) {
    const res = await adapter.applyProposal(
      { action: 'replace_text', content: `버전 ${i}` },
      { targetKind: 'char_field', fieldKey: 'desc' }
    );
    undoIds.push(res.undoId);
  }
  assert.equal(adapter.undoStack.length, 30);

  for (let i = undoIds.length - 1; i >= 0; i--) {
    await adapter.undo(undoIds[i]);
  }
  assert.equal(state.character.desc, initial);
  assert.equal(adapter.undoStack.length, 0);
});

test('findOrphanedLorebooks and recoverOrphanedLorebooks detect and rescue trapped lorebooks with surgical Undo', async () => {
  const { findOrphanedLorebooks } = await import('../src/host-adapter.js');
  const { state, adapter } = createMockHost();

  const validKey = '\uf000folder:valid-1';
  state.character.globalLore = [
    { comment: '정상 루트', key: 'a', content: '1', mode: 'normal' },
    { comment: '정상 폴더', key: validKey, content: '', mode: 'folder' },
    { comment: '정상 폴더 안', key: 'b', content: '2', mode: 'normal', folder: validKey },
    { comment: '고아 1 (폴더명 오기입)', key: 'c', content: '3', mode: 'normal', folder: '세계관' },
    { comment: '고아 2 (이중 이스케이프)', key: 'd', content: '4', mode: 'normal', folder: '\\uf000folder:valid-1' },
  ];

  assert.deepEqual(findOrphanedLorebooks(state.character.globalLore), [3, 4]);

  const snap = await adapter.readTargetSnapshot({ targetKind: 'char_lorebook', loreScope: 'character' });
  assert.equal(snap.orphanedLoreCount, 2);
  assert.deepEqual(snap.orphanedLoreIndices, [3, 4]);
  assert.equal(snap.loreSummary[3].orphaned, true);

  const rescued = await adapter.recoverOrphanedLorebooks({ targetKind: 'char_lorebook', loreScope: 'character' });
  assert.equal(rescued.ok, true);
  assert.equal(rescued.recoveredCount, 2);
  assert.deepEqual(findOrphanedLorebooks(state.character.globalLore), []);
  assert.equal(state.character.globalLore[2].folder, validKey, 'valid folder assignment must remain untouched');
  assert.equal(Object.hasOwn(state.character.globalLore[3], 'folder'), false);
  assert.equal(Object.hasOwn(state.character.globalLore[4], 'folder'), false);

  // Undo restores exact prior broken folder strings if ever needed
  await adapter.undo(rescued.undoId);
  assert.equal(state.character.globalLore[3].folder, '세계관');
  assert.equal(state.character.globalLore[4].folder, '\\uf000folder:valid-1');
});

// --- Undo journal: persistence, grouping, eviction notice, conflict protection ---

test('undo history survives a reload: a fresh adapter restores a change from the exported journal', async () => {
  const { api, state, adapter } = createMockHost();
  const target = { targetKind: 'char_field', fieldKey: 'desc' };
  const preview = await adapter.previewProposal({ action: 'replace_text', content: 'CHANGED' }, target);
  await adapter.applyProposal({ action: 'replace_text', content: 'CHANGED' }, preview.target, { hostBinding: preview.hostBinding });
  assert.equal(state.character.desc, 'CHANGED');

  const stored = JSON.parse(JSON.stringify(adapter.exportUndoState()));
  const reloaded = new HostAdapter(api);
  assert.equal(reloaded.undoUnitCount(), 0);
  reloaded.importUndoState(stored);
  assert.equal(reloaded.undoUnitCount(), 1);

  await reloaded.undo();
  assert.equal(state.character.desc, '차분한 마도사.\n별을 연구한다.');
  assert.equal(reloaded.undoUnitCount(), 0);
});

test('changes applied as one group are undone together with a single undo', async () => {
  const { state, adapter } = createMockHost();
  const apply = async (target, proposal) => {
    const pv = await adapter.previewProposal(proposal, target);
    assert.equal(pv.ok, true, pv.error);
    return adapter.applyProposal(proposal, pv.target, { hostBinding: pv.hostBinding });
  };
  await adapter.runGroup('한 번에 적용', async () => {
    await apply({ targetKind: 'char_field', fieldKey: 'desc' }, { action: 'replace_text', content: 'D2' });
    await apply({ targetKind: 'char_field', fieldKey: 'firstMessage' }, { action: 'replace_text', content: 'F2' });
    await apply({ targetKind: 'char_lorebook', loreIndex: 0, fieldKey: 'content' }, { action: 'replace_text', content: 'L2' });
  });
  assert.deepEqual([state.character.desc, state.character.firstMessage, state.character.globalLore[0].content], ['D2', 'F2', 'L2']);
  assert.equal(adapter.undoUnitCount(), 1);

  const res = await adapter.undo();
  assert.equal(res.undone, 3);
  assert.deepEqual(
    [state.character.desc, state.character.firstMessage, state.character.globalLore[0].content],
    ['차분한 마도사.\n별을 연구한다.', '안녕, 여행자.', '북쪽의 오래된 왕국이다.']
  );
  assert.equal(adapter.undoUnitCount(), 0);
});

test('dropping old undo history is reported instead of happening silently', async () => {
  const { adapter } = createMockHost();
  adapter.maxUndoUnits = 3;
  const evicted = [];
  adapter.onUndoChange = (info) => { if (info.evicted?.length) evicted.push(...info.evicted); };
  for (let i = 0; i < 5; i++) {
    const p = { action: 'replace_text', content: `v${i}` };
    const pv = await adapter.previewProposal(p, { targetKind: 'char_field', fieldKey: 'desc' });
    await adapter.applyProposal(p, pv.target, { hostBinding: pv.hostBinding });
  }
  assert.equal(adapter.undoUnitCount(), 3);
  assert.equal(evicted.length, 2);
});

test('undo does not overwrite a field the user edited after the change was applied', async () => {
  const { state, adapter } = createMockHost();
  const p = { action: 'replace_text', content: 'WRITTEN BY PLUGIN' };
  const pv = await adapter.previewProposal(p, { targetKind: 'char_field', fieldKey: 'desc' });
  await adapter.applyProposal(p, pv.target, { hostBinding: pv.hostBinding });
  state.character.desc = 'EDITED BY THE USER AFTERWARDS';

  await assert.rejects(() => adapter.undo(), /이후|변경/);
  assert.equal(state.character.desc, 'EDITED BY THE USER AFTERWARDS');
});

// --- Configurable model input limit ---

test('the model input limit is configurable: a longer original is fully editable once the limit covers it', async () => {
  const { state, adapter } = createMockHost();
  state.character.desc = 'x'.repeat(30000);
  const target = { targetKind: 'char_field', fieldKey: 'desc' };
  const proposal = { action: 'replace_text', content: 'short' };

  adapter.maxContentChars = 24000;
  const blocked = await adapter.previewProposal(proposal, target);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /24,000자/);

  adapter.maxContentChars = 60000;
  const allowed = await adapter.previewProposal(proposal, target);
  assert.equal(allowed.ok, true, allowed.error);
  await adapter.applyProposal(proposal, allowed.target, { hostBinding: allowed.hostBinding });
  assert.equal(state.character.desc, 'short');
});

test('the default model input limit is above the old fixed 24,000 characters', async () => {
  const { adapter } = createMockHost();
  assert.ok(adapter.maxContentChars >= 60000);
});

// --- References named by a proposal must exist before anything is written ---

test('a config change that points at a persona or module that does not exist is rejected', async () => {
  const { state, adapter } = createMockHost();
  const cfgTarget = { targetKind: 'config' };

  const badPersona = await adapter.previewProposal({ action: 'update_config', changes: { selectedPersona: 99 } }, cfgTarget);
  assert.equal(badPersona.ok, false);
  assert.match(badPersona.error, /페르소나/);
  await assert.rejects(() => adapter.applyProposal({ action: 'update_config', changes: { selectedPersona: 99 } }, cfgTarget, {}), /페르소나/);
  assert.equal(state.db.selectedPersona, 0);

  const badModule = await adapter.previewProposal({ action: 'update_config', changes: { enabledModules: ['mod-1', 'no-such-module'] } }, cfgTarget);
  assert.equal(badModule.ok, false);
  assert.match(badModule.error, /no-such-module/);
  await assert.rejects(() => adapter.applyProposal({ action: 'update_config', changes: { enabledModules: ['no-such-module'] } }, cfgTarget, {}), /no-such-module/);
  assert.deepEqual(state.db.enabledModules, ['mod-1']);

  const good = await adapter.previewProposal({ action: 'update_config', changes: { enabledModules: [] } }, cfgTarget);
  assert.equal(good.ok, true, good.error);
});

test('updating a regex script by an index that does not exist is rejected instead of silently creating a new script', async () => {
  const { state, adapter } = createMockHost();
  state.character.customscript = [{ comment: 'Only', in: 'a', out: 'b', type: 'editdisplay', flag: 'g', ableFlag: false }];
  const proposal = { action: 'upsert_regex', scope: 'character', regexIndex: 7, comment: 'Ghost', in: 'x', out: 'y' };
  const target = { targetKind: 'char_regex' };

  const preview = await adapter.previewProposal(proposal, target);
  assert.equal(preview.ok, false);
  assert.match(preview.error, /#8/);
  await assert.rejects(() => adapter.applyProposal(proposal, target, {}), /#8/);
  assert.equal(state.character.customscript.length, 1);

  const create = { action: 'upsert_regex', scope: 'character', comment: 'New', in: 'x', out: 'y' };
  const okPreview = await adapter.previewProposal(create, target);
  assert.equal(okPreview.ok, true, okPreview.error);
});

test('a proposal naming a module index that does not exist is rejected instead of being redirected to another module', async () => {
  const { state, adapter } = createMockHost();
  const proposal = { action: 'create_lorebook', scope: 'module', moduleIndex: 5, comment: 'X', key: 'x', content: 'body' };
  const target = { targetKind: 'module_lorebook' };

  const preview = await adapter.previewProposal(proposal, target);
  assert.equal(preview.ok, false);
  assert.match(preview.error, /모듈/);
  await assert.rejects(() => adapter.applyProposal(proposal, target, {}), /모듈/);
  assert.equal(state.db.modules[0].lorebook.length, 1);
});

// --- A proposal for a different kind of item than the one under the cursor ---

test('proposals for another kind of item apply cleanly when the cursor is in a character field', async () => {
  const cases = [
    ['create_lorebook', { action: 'create_lorebook', scope: 'character', comment: '새 항목', key: 'k2', content: '본문' },
      s => s.character.globalLore.some(e => e.comment === '새 항목')],
    ['organize_lorebook', { action: 'organize_lorebook', scope: 'character', folderName: '폴더', createFolderIfMissing: true, loreIndices: [0] },
      s => s.character.globalLore.some(e => e.mode === 'folder' && e.comment === '폴더')],
    ['update_lorebook', { action: 'update_lorebook', scope: 'character', loreIndex: 0, content: '바뀐 본문' },
      s => s.character.globalLore[0].content === '바뀐 본문'],
    ['create_lorebook (chat)', { action: 'create_lorebook', scope: 'chat', comment: '채팅 항목', key: 'k3', content: '본문' },
      s => s.character.chats[0].localLore.some(e => e.comment === '채팅 항목')],
    ['upsert_regex', { action: 'upsert_regex', scope: 'character', comment: '정규식', in: 'a', out: 'b' },
      s => s.character.customscript.some(e => e.comment === '정규식')],
    ['create_persona', { action: 'create_persona', name: '새 페르소나', personaPrompt: '설명' },
      s => s.db.personas.some(p => p.name === '새 페르소나')],
    ['update_config', { action: 'update_config', changes: { temperature: 55 } },
      s => s.db.temperature === 55],
  ];
  for (const [name, proposal, applied] of cases) {
    const { state, adapter } = createMockHost();
    const cursor = { targetKind: 'char_field', fieldKey: 'desc' };
    const preview = await adapter.previewProposal(proposal, cursor);
    assert.equal(preview.ok, true, `${name}: preview failed: ${preview.error}`);
    await adapter.applyProposal(proposal, preview.target || cursor, { hostBinding: preview.hostBinding });
    assert.ok(applied(state), `${name}: change was not applied`);
  }
});

test('nested runGroup returns { groupId, result } and eviction emits evictedIds alongside labels', async () => {
  const { adapter } = createMockHost();
  adapter.maxUndoUnits = 2;
  const events = [];
  adapter.onUndoChange = (info) => events.push(info);

  let outerId = null;
  let innerId = null;
  const outer = await adapter.runGroup('outer', async () => {
    const inner = await adapter.runGroup('inner', async () => 'ok');
    innerId = inner.groupId;
    assert.equal(inner.result, 'ok');
    return 'done';
  });
  outerId = outer.groupId;
  assert.ok(outerId);
  assert.equal(innerId, outerId);
  assert.equal(outer.result, 'done');

  const r1 = await adapter.applyProposal({ action: 'replace_text', content: 'v1' }, { targetKind: 'char_field', fieldKey: 'desc' });
  await adapter.applyProposal({ action: 'replace_text', content: 'v2' }, { targetKind: 'char_field', fieldKey: 'desc' });
  await adapter.applyProposal({ action: 'replace_text', content: 'v3' }, { targetKind: 'char_field', fieldKey: 'desc' });

  const evictEvt = events.find(e => e.evictedIds?.length);
  assert.ok(evictEvt, 'eviction event must include evictedIds');
  assert.deepEqual(evictEvt.evictedIds, [r1.undoId]);
});

test('_findReferenceError avoids #NaN, rejects uncertain module upsert_regex with MODULE_UNCERTAIN_ERROR, and honours hostBinding.moduleId', async () => {
  const { state, adapter } = createTwinModuleHost();
  state.db.modules[1].regex = [{ comment: 'R1', in: 'a', out: 'b', type: 'editdisplay', flag: 'g', ableFlag: false }];

  // Non-integer index formats cleanly without #NaN
  const nanPrev = await adapter.previewProposal(
    { action: 'create_lorebook', scope: 'module', moduleIndex: 'abc', comment: 'X', content: 'Y' },
    { targetKind: 'module_lorebook' }
  );
  assert.equal(nanPrev.ok, false);
  assert.doesNotMatch(nanPrev.error, /NaN/);
  assert.match(nanPrev.error, /"abc"/);

  // Uncertain module must fail with MODULE_UNCERTAIN_ERROR, not falsely inspect modules[0]
  const uncPrev = await adapter.previewProposal(
    { action: 'upsert_regex', scope: 'module', regexIndex: 0, comment: 'R1', in: 'a', out: 'c' },
    { targetKind: 'module_regex' }
  );
  assert.equal(uncPrev.ok, false);
  assert.match(uncPrev.error, /모듈을 편집 중인지 자동으로 확정하지 못했습니다/);

  // Reordering modules after preview still resolves via options.hostBinding.moduleId on apply
  const pinnedPrev = await adapter.previewProposal(
    { action: 'upsert_regex', scope: 'module', regexIndex: 0, comment: 'R1', in: 'a', out: 'updated' },
    { targetKind: 'module_regex', moduleIndex: 1 }
  );
  assert.equal(pinnedPrev.ok, true);
  state.db.modules.reverse(); // mod-b is now at index 0, mod-a (with 0 regexes) is at index 1
  const applied = await adapter.applyProposal(
    { action: 'upsert_regex', scope: 'module', regexIndex: 0, comment: 'R1', in: 'a', out: 'updated' },
    pinnedPrev.target,
    { hostBinding: pinnedPrev.hostBinding }
  );
  assert.equal(applied.ok, true);
  assert.equal(state.db.modules.find(m => m.id === 'mod-b').regex[0].out, 'updated');
});

test('partial failure while undoing a group still notifies onUndoChange for records already removed', async () => {
  const { state, adapter } = createMockHost();
  state.character.chaId = 'char-1';
  let undoEvents = 0;
  adapter.onUndoChange = () => { undoEvents++; };

  const { groupId } = await adapter.runGroup('mixed', async () => {
    await adapter.applyProposal({ action: 'replace_text', content: '변경된 설명' }, { targetKind: 'char_field', fieldKey: 'desc' });
    await adapter.applyProposal({ action: 'update_config', changes: { temperature: 95 } }, { targetKind: 'config' });
  });

  // Switch active character so reverting the earlier char record fails AFTER the db config record is reverted
  state.character.chaId = 'char-other';
  const beforeEvents = undoEvents;
  await assert.rejects(() => adapter.undoGroup(groupId), /다른 캐릭터로 전환/);
  assert.equal(state.db.temperature, 80, 'config record was reverted');
  assert.equal(adapter.undoStack.length, 1, 'only the un-reverted char record remains');
  assert.ok(undoEvents > beforeEvents, 'onUndoChange must fire in finally so storage stays in sync');
});

// --- First message / alternate greetings without selecting them as the target ---

function createGreetingHost() {
  const host = createMockHost();
  host.state.character.firstMessage = '안녕, 여행자. 오늘은 별이 밝아.';
  host.state.character.alternateGreetings = ['ALT ONE 원문', 'ALT TWO 원문'];
  return host;
}
const CHAT_SCREEN = { screen: 'chat', targetKind: 'general', fieldKey: null, greetingsShownFull: [-1, 0, 1] };

test('update_greeting edits the default first message from the chat screen and can be undone', async () => {
  const { state, adapter } = createGreetingHost();
  const proposal = { action: 'update_greeting', greetingIndex: -1, content: '새 첫 메시지' };
  const preview = await adapter.previewProposal(proposal, CHAT_SCREEN);
  assert.equal(preview.ok, true, preview.error);
  assert.equal(preview.before, '안녕, 여행자. 오늘은 별이 밝아.');
  assert.equal(preview.after, '새 첫 메시지');
  const res = await adapter.applyProposal(proposal, preview.target, { hostBinding: preview.hostBinding });
  assert.equal(state.character.firstMessage, '새 첫 메시지');
  assert.deepEqual(state.character.alternateGreetings, ['ALT ONE 원문', 'ALT TWO 원문']);
  await adapter.undo(res.undoId);
  assert.equal(state.character.firstMessage, '안녕, 여행자. 오늘은 별이 밝아.');
});

test('update_greeting patches one alternate greeting by index and leaves the others alone', async () => {
  const { state, adapter } = createGreetingHost();
  const proposal = { action: 'update_greeting', greetingIndex: 1, edits: [{ before: 'TWO', after: '둘' }] };
  const preview = await adapter.previewProposal(proposal, CHAT_SCREEN);
  assert.equal(preview.ok, true, preview.error);
  await adapter.applyProposal(proposal, preview.target, { hostBinding: preview.hostBinding });
  assert.deepEqual(state.character.alternateGreetings, ['ALT ONE 원문', 'ALT 둘 원문']);
  assert.equal(state.character.firstMessage, '안녕, 여행자. 오늘은 별이 밝아.');
});

test('a full overwrite of a greeting the model only saw a preview of is blocked, a partial edit is not', async () => {
  const { state, adapter } = createGreetingHost();
  state.character.firstMessage = 'HEAD ' + 'x'.repeat(2000) + ' TAIL_MUST_SURVIVE';
  const onlyPreviewShown = { ...CHAT_SCREEN, greetingsShownFull: [0, 1] };

  const overwrite = await adapter.previewProposal({ action: 'update_greeting', greetingIndex: -1, content: 'short' }, onlyPreviewShown);
  assert.equal(overwrite.ok, false);
  assert.match(overwrite.error, /전문/);
  await assert.rejects(
    () => adapter.applyProposal({ action: 'update_greeting', greetingIndex: -1, content: 'short' }, onlyPreviewShown, {}),
    /전문/
  );
  assert.ok(state.character.firstMessage.endsWith('TAIL_MUST_SURVIVE'));

  const patch = { action: 'update_greeting', greetingIndex: -1, edits: [{ before: 'HEAD', after: 'HELLO' }] };
  const patchPreview = await adapter.previewProposal(patch, onlyPreviewShown);
  assert.equal(patchPreview.ok, true, patchPreview.error);
  await adapter.applyProposal(patch, patchPreview.target, { hostBinding: patchPreview.hostBinding });
  assert.ok(state.character.firstMessage.startsWith('HELLO'));
  assert.ok(state.character.firstMessage.endsWith('TAIL_MUST_SURVIVE'));
});

test('create_greeting appends a new alternate greeting without touching existing ones, also when there were none', async () => {
  for (const existing of [['ALT ONE 원문', 'ALT TWO 원문'], []]) {
    const { state, adapter } = createGreetingHost();
    state.character.alternateGreetings = [...existing];
    const proposal = { action: 'create_greeting', content: '완전히 새로운 인사' };
    const preview = await adapter.previewProposal(proposal, CHAT_SCREEN);
    assert.equal(preview.ok, true, preview.error);
    const res = await adapter.applyProposal(proposal, preview.target, { hostBinding: preview.hostBinding });
    assert.deepEqual(state.character.alternateGreetings, [...existing, '완전히 새로운 인사']);
    await adapter.undo(res.undoId);
    assert.deepEqual(state.character.alternateGreetings, existing);
  }
});

test('update_greeting naming a greeting that does not exist is rejected', async () => {
  const { state, adapter } = createGreetingHost();
  const proposal = { action: 'update_greeting', greetingIndex: 5, content: 'ghost' };
  const preview = await adapter.previewProposal(proposal, CHAT_SCREEN);
  assert.equal(preview.ok, false);
  assert.match(preview.error, /#6/);
  await assert.rejects(() => adapter.applyProposal(proposal, CHAT_SCREEN, {}), /#6/);
  assert.deepEqual(state.character.alternateGreetings, ['ALT ONE 원문', 'ALT TWO 원문']);
});

test('the alternate-greeting target without a chosen item never falls back to overwriting greeting #1', async () => {
  const { state, adapter } = createGreetingHost();
  const target = { targetKind: 'char_alt_greeting', fieldKey: 'alternateGreetings' };
  const proposal = { action: 'replace_text', content: 'BRAND NEW GREETING' };

  const preview = await adapter.previewProposal(proposal, target);
  assert.equal(preview.ok, false);
  await assert.rejects(() => adapter.applyProposal(proposal, target, {}));
  assert.deepEqual(state.character.alternateGreetings, ['ALT ONE 원문', 'ALT TWO 원문']);

  const outOfRange = await adapter.previewProposal(proposal, { ...target, greetingIndex: 9 });
  assert.equal(outOfRange.ok, false);
  assert.deepEqual(state.character.alternateGreetings, ['ALT ONE 원문', 'ALT TWO 원문']);
});
