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
