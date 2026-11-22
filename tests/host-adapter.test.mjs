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

