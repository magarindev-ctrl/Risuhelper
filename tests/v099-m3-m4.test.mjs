// SPDX-License-Identifier: GPL-3.0-only
// Comprehensive M3 (0.9.x) + M4 (0.9.9 / 1.0.0 RC) verification suite:
// - Apply -> post-apply conflict detection -> surgical Undo roundtrips for all 12 M3 actions
// - All 14 declarative resident extension APIs (zero arbitrary JS, persistence, unload teardown)
// - Fork-specific capabilities (RisuBard BardWiki, RisuNest query*/patch/hostTools/save/events, PocketRisu createInlay guard)
// - Static security audit (0 eval/Function, 0 Tier-6 APIs, 0 writes in all 14 Read-Only tools)
// - M4 large-library stress test (120 chars, 320 lorebooks, 1,050 messages, 65K desc)
// - Bundled UI integration test (Extensions panel, 1-click Health Audit, RisuNest save & MessageButtonTarget)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HostAdapter } from '../src/host-adapter.js';
import {
  ExtensionRuntime,
  validateExtensionRule,
  dryRunExtensionRule,
} from '../src/extensions-runtime.js';
import { sanitizeChatPanelHtml } from '../src/m3-actions.js';
import {
  READ_TOOL_DEFS,
  executeReadTool,
  getAvailableReadTools,
} from '../src/read-tools.js';
import { selectSkills, getSkillCatalog, loadSkillPack } from '../src/skills.js';
import { requiresConfirmation, validateProposal } from '../src/llm.js';
import { bootBundle, createMemoryStorage, tick } from './helpers/boot-bundle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

function makeFullHost(flavor = 'RisuAI', overrides = {}) {
  const storage = createMemoryStorage();
  const state = {
    charIndex: 0,
    chatIndex: 0,
    characters: [
      {
        type: 'character',
        chaId: 'char-0',
        name: '아리아',
        desc: '항구 도시의 연금술사.',
        firstMessage: '안녕하세요.',
        alternateGreetings: [],
        additionalAssets: [['existing_bg', 'asset-bg-1', 'png']],
        emotionImages: [['happy', 'asset-happy-1']],
        globalLore: [
          { comment: '고아 로어', key: '고아', secondkey: '', content: '잃어버린 폴더', folder: 'dead-folder', mode: 'normal', insertorder: 100 },
        ],
        customscript: [
          { comment: '깨진 플래그', in: 'foo', out: 'bar', type: 'editdisplay', flag: 'ggz!', ableFlag: true },
        ],
        triggerscript: [],
        chatFolders: [],
        chatPage: 0,
        chats: [
          {
            id: 'chat-0',
            name: '1부 시작',
            note: '초기 노트',
            fmIndex: -1,
            scriptstate: { $hp: 100 },
            supaMemoryData: '초기 수파 요약',
            hypaV3Data: { summaries: [{ text: '첫 만남', chatMemos: [], isImportant: false }], metrics: {} },
            hypaV2Data: { chunks: [{ text: 'v2 청크 1' }], mainChunks: [], lastMainChunkID: 0 },
            localLore: [],
            message: [
              { role: 'user', data: '안녕 아리아', chatId: 'm-0' },
              { role: 'char', data: '반가워요!', chatId: 'm-1', generationInfo: { model: 'gpt-4.1', outputTokens: 20 } },
            ],
          },
          {
            name: '아이디 누락 채팅',
            note: '',
            fmIndex: -1,
            scriptstate: {},
            localLore: [],
            message: [{ role: 'user', data: '2번 채팅', chatId: 'm-2' }],
          },
        ],
      },
      {
        type: 'group',
        chaId: 'group-1',
        name: '모험가 파티',
        firstMessage: '파티가 모였다.',
        characters: ['char-0', 'char-other'],
        characterActive: [true, true],
        characterTalks: [0.5, 0.5],
        orderByOrder: false,
        useCharacterLore: true,
        autoMode: false,
        chats: [{ id: 'gchat-0', name: '그룹 채팅', note: '', fmIndex: -1, scriptstate: {}, localLore: [], message: [] }],
        chatPage: 0,
      },
    ],
    db: {
      colorSchemeName: 'default',
      textTheme: 'standard',
      customCSS: '',
      guiHTML: '',
      characterOrder: ['stale-only'],
      modules: [{ id: 'mod-0', name: '테스트 모듈', assets: [], lorebook: [], regex: [], trigger: [] }],
      enabledModules: [],
      personas: [{ id: 'p-0', name: '유저', note: '', personaPrompt: '모험가' }],
      selectedPersona: 0,
    },
    meta: {
      colorScheme: { bgcolor: '#1e1e2e', textcolor: '#cdd6f4', type: 'dark' },
      textTheme: { FontColorStandard: '#cdd6f4', name: 'standard' },
      chatPanel: null,
      savedAssets: [],
      inlays: [],
      charOrderCalls: 0,
      scriptHandlers: [],
      replacers: [],
      chatListeners: [],
      bodyIntercepters: [],
      mcps: new Map(),
      ttsPre: [],
      ttsPost: [],
      channelListeners: new Map(),
      postedChannelMessages: [],
      bardWikiDocs: [{ id: 'bw-1', title: '공방', content: '원본 내용', grade: 'B' }],
      bardWikiContext: { mode: 'auto' },
      risunestConversations: { 'conv-1': { name: '기존 제목', note: '기존 노트', folderId: null } },
      savedFiles: [],
    },
  };

  const writeCalls = [];
  const api = {
    pluginStorage: storage,
    async getRuntimeInfo() { return { app: { id: flavor.toLowerCase(), version: '1.0.0' } }; },
    async getCharacter() { return deepClone(state.characters[state.charIndex]); },
    async setCharacter(c) { writeCalls.push('setCharacter'); state.characters[state.charIndex] = deepClone(c); },
    async getCharacterFromIndex(i) { return state.characters[i] ? deepClone(state.characters[i]) : null; },
    async setCharacterToIndex(i, c) { writeCalls.push('setCharacterToIndex'); if (state.characters[i]) state.characters[i] = deepClone(c); },
    async getCurrentCharacterIndex() { return state.charIndex; },
    async getCurrentChatIndex() { return state.chatIndex; },
    async getChatFromIndex(ci, chi) { return state.characters[ci]?.chats?.[chi] ? deepClone(state.characters[ci].chats[chi]) : null; },
    async setChatToIndex(ci, chi, c) { writeCalls.push('setChatToIndex'); if (state.characters[ci]?.chats?.[chi]) state.characters[ci].chats[chi] = deepClone(c); },
    async getDatabase(keys) {
      const full = { ...state.db, characters: state.characters };
      if (!Array.isArray(keys)) return deepClone(full);
      const out = {};
      for (const k of keys) if (Object.hasOwn(full, k)) out[k] = deepClone(full[k]);
      return out;
    },
    async setDatabase(patch) {
      writeCalls.push('setDatabase');
      for (const [k, v] of Object.entries(patch || {})) {
        if (k === 'plugins') continue;
        if (k === 'characters') state.characters = deepClone(v);
        else state.db[k] = deepClone(v);
      }
    },
    async setDatabaseLite(patch) {
      writeCalls.push('setDatabaseLite');
      for (const [k, v] of Object.entries(patch || {})) {
        if (k === 'plugins') continue;
        state.db[k] = deepClone(v);
      }
    },
    async getColorScheme() { return deepClone(state.meta.colorScheme); },
    async changeColorScheme(name) { writeCalls.push('changeColorScheme'); state.db.colorSchemeName = String(name); },
    async setColorScheme(s) { writeCalls.push('setColorScheme'); state.meta.colorScheme = deepClone(s); },
    async getTextTheme() { return deepClone(state.meta.textTheme); },
    async changeTextTheme(name) { writeCalls.push('changeTextTheme'); state.db.textTheme = String(name); },
    async setCustomTextTheme(t) { writeCalls.push('setCustomTextTheme'); state.meta.textTheme = deepClone(t); },
    async setChatPanel(html) { writeCalls.push('setChatPanel'); state.meta.chatPanel = html ? String(html) : null; },
    async saveAsset(bytes, customId, fileName) {
      writeCalls.push('saveAsset');
      const id = customId || `saved_${state.meta.savedAssets.length + 1}_${fileName || 'f'}`;
      state.meta.savedAssets.push({ id, fileName, bytes: bytes.length });
      return id;
    },
    async checkCharOrder() {
      writeCalls.push('checkCharOrder');
      state.meta.charOrderCalls++;
      state.db.characterOrder = state.characters.map(c => c.chaId);
    },
    async parseRisuChat(text) { return String(text ?? ''); },
    async getCurrentLorebookEntries() { return [{ comment: '발동 로어', key: '안녕', content: '내용' }]; },
    async getFetchLogs() { return [{ status: 429, url: 'https://api.example.com', body: '{}', response: '{}' }]; },
    async readImage() { return new Uint8Array([1, 2, 3]); },
    async readInlay() { return { type: 'image', data: 'ok' }; },
    async searchTranslationCache(q) { return [{ source: q, target: `번역:${q}` }]; },
    async addRisuScriptHandler(mode, fn) { writeCalls.push('addRisuScriptHandler'); state.meta.scriptHandlers.push({ mode, fn }); },
    async removeRisuScriptHandler(mode, fn) {
      const idx = state.meta.scriptHandlers.findIndex(x => x.mode === mode && x.fn === fn);
      if (idx >= 0) state.meta.scriptHandlers.splice(idx, 1);
    },
    async addRisuReplacer(stage, fn) { writeCalls.push('addRisuReplacer'); state.meta.replacers.push({ stage, fn }); },
    async removeRisuReplacer(stage, fn) {
      const idx = state.meta.replacers.findIndex(x => x.stage === stage && x.fn === fn);
      if (idx >= 0) state.meta.replacers.splice(idx, 1);
    },
    async addRisuChatListener(fn) { writeCalls.push('addRisuChatListener'); state.meta.chatListeners.push(fn); },
    async removeRisuChatListener(fn) {
      const idx = state.meta.chatListeners.indexOf(fn);
      if (idx >= 0) state.meta.chatListeners.splice(idx, 1);
    },
    async registerBodyIntercepter(fn) { writeCalls.push('registerBodyIntercepter'); state.meta.bodyIntercepters.push(fn); },
    async unregisterBodyIntercepter(fn) {
      const idx = state.meta.bodyIntercepters.indexOf(fn);
      if (idx >= 0) state.meta.bodyIntercepters.splice(idx, 1);
    },
    async registerMCP(cfg, getTools, callTool) { writeCalls.push('registerMCP'); state.meta.mcps.set(cfg.identifier, { cfg, getTools, callTool }); },
    async unregisterMCP(id) { state.meta.mcps.delete(id); },
    async addTTSPreprocessor(fn) { writeCalls.push('addTTSPreprocessor'); state.meta.ttsPre.push(fn); },
    async addTTSPostprocessor(fn) { writeCalls.push('addTTSPostprocessor'); state.meta.ttsPost.push(fn); },
    async addPluginChannelListener(ch, fn) {
      writeCalls.push('addPluginChannelListener');
      if (!state.meta.channelListeners.has(ch)) state.meta.channelListeners.set(ch, []);
      state.meta.channelListeners.get(ch).push(fn);
      return () => {
        const arr = state.meta.channelListeners.get(ch) || [];
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      };
    },
    async postPluginChannelMessage(ch, msg) {
      writeCalls.push('postPluginChannelMessage');
      state.meta.postedChannelMessages.push({ ch, msg });
    },
    ...(flavor === 'RisuAI' ? {
      async createInlay(payload) {
        writeCalls.push('createInlay');
        const id = `inlay_${state.meta.inlays.length + 1}`;
        state.meta.inlays.push({ id, ...payload });
        return id;
      },
    } : {}),
    ...(flavor === 'RisuBard' ? {
      bardWiki: {
        async getContext() { return deepClone(state.meta.bardWikiContext); },
        async getDocuments() { return deepClone(state.meta.bardWikiDocs); },
        async saveDocument(doc) {
          writeCalls.push('bardWiki.saveDocument');
          const id = doc.id || `bw_${state.meta.bardWikiDocs.length + 1}`;
          const next = { ...deepClone(doc), id };
          const idx = state.meta.bardWikiDocs.findIndex(d => d.id === id);
          if (idx >= 0) state.meta.bardWikiDocs[idx] = next;
          else state.meta.bardWikiDocs.push(next);
          return next;
        },
        async setGrade(id, grade) {
          writeCalls.push('bardWiki.setGrade');
          const d = state.meta.bardWikiDocs.find(x => x.id === id);
          if (d) d.grade = String(grade);
        },
        async setContextMode(mode) { writeCalls.push('bardWiki.setContextMode'); state.meta.bardWikiContext.mode = String(mode); },
        async trashDocument(id) {
          writeCalls.push('bardWiki.trashDocument');
          const i = state.meta.bardWikiDocs.findIndex(x => x.id === id);
          if (i >= 0) state.meta.bardWikiDocs.splice(i, 1);
        },
      },
    } : {}),
    ...(flavor === 'RisuNest' ? {
      async queryCharacters() { return { items: state.characters.map((c, i) => ({ index: i, chaId: c.chaId, name: c.name })), total: state.characters.length }; },
      async queryConversations({ charIndex = 0 } = {}) {
        const chats = state.characters[charIndex]?.chats || [];
        return { items: chats.map((c, i) => ({ chatIndex: i, id: c.id || null, name: c.name, messageCount: c.message.length })), total: chats.length, hasMore: false };
      },
      async queryConversationMessages({ charIndex = 0, chatIndex = 0 } = {}) {
        return { items: deepClone(state.characters[charIndex]?.chats?.[chatIndex]?.message || []) };
      },
      async risunestReadConversationContext(ref) { return deepClone(state.meta.risunestConversations[ref.conversationId] || {}); },
      async risunestPatchConversation(ref, patch) {
        writeCalls.push('risunestPatchConversation');
        state.meta.risunestConversations[ref.conversationId] = {
          ...(state.meta.risunestConversations[ref.conversationId] || {}),
          ...deepClone(patch),
        };
      },
      async risunestListHostTools() { return [{ name: 'inspect_lore', description: 'Read-only lore check', readOnly: true }]; },
      async risunestOnChatView() { return () => {}; },
      async risunestOnGenerationEnd() { return () => {}; },
      async save(name, bytes) { state.meta.savedFiles.push({ name, bytes: bytes.length }); },
    } : {}),
    ...overrides,
  };

  return { state, api, storage, writeCalls };
}

test('M3 all 12 write actions support preview -> apply -> post-apply conflict detection -> surgical Undo roundtrip', async () => {
  // --- Standard upstream RisuAI actions (1..10) ---
  const { state, api } = makeFullHost('RisuAI');
  const adapter = new HostAdapter(api);
  await adapter.probeHostFlavor(null);

  // 1. update_theme (colorSchemeName + custom colorScheme + textTheme + customCSS) + conflict check + Undo
  const themeProp = {
    action: 'update_theme',
    colorSchemeName: 'dark',
    colorScheme: { bgcolor: '#101218' },
    textThemeName: 'highcontrast',
    customTextTheme: { FontColorStandard: '#ffffff' },
    customCSS: '.msg { line-height: 1.7; }',
  };
  assert.equal(validateProposal(themeProp), null);
  assert.equal((await adapter.previewProposal(themeProp, null)).ok, true);
  const tApply = await adapter.applyProposal(themeProp, null);
  assert.equal(state.db.colorSchemeName, 'dark');
  assert.equal(state.meta.colorScheme.bgcolor, '#101218');
  assert.equal(state.db.textTheme, 'highcontrast');
  assert.equal(state.meta.textTheme.FontColorStandard, '#ffffff');
  assert.equal(state.db.customCSS, '.msg { line-height: 1.7; }');
  // Post-apply user edit conflict detection on colorSchemeName only
  state.db.colorSchemeName = 'user-custom-later';
  const tUndo = await adapter.undo(tApply.undoId);
  assert.ok(tUndo.conflicts.some(c => c.path === 'theme.colorSchemeName'));
  assert.equal(state.db.colorSchemeName, 'user-custom-later', 'user post-apply edit must be preserved');
  assert.equal(state.meta.colorScheme.bgcolor, '#1e1e2e', 'unchanged colorScheme reverted');
  assert.equal(state.db.customCSS, '', 'unchanged customCSS reverted');

  // 2. set_chat_panel (HTML sanitizer strips <script>/<iframe>/on*=/javascript:) + Undo
  const dirtyHtml = '<div onclick="evil()"><a href="javascript:alert(1)">HP</a><script>pwn()</script><iframe src="x"></iframe><span>OK</span></div>';
  const cleanHtml = sanitizeChatPanelHtml(dirtyHtml);
  assert.ok(!/<script|<iframe|onclick|javascript:/i.test(cleanHtml));
  assert.ok(cleanHtml.includes('<span>OK</span>'));
  const hudProp = { action: 'set_chat_panel', title: 'HUD', html: dirtyHtml };
  const hudApply = await adapter.applyProposal(hudProp, null);
  assert.ok(state.meta.chatPanel.includes('<span>OK</span>') && !state.meta.chatPanel.includes('<script'));
  await adapter.undo(hudApply.undoId);
  assert.equal(state.meta.chatPanel, null);

  // 3. register_asset (character_asset, module_asset, rename_asset, bind_asset, inlay) + Undo
  const assetProp = {
    action: 'register_asset',
    mode: 'character_asset',
    name: 'moon_badge',
    ext: 'svg',
    content: '<svg><script>bad()</script><circle r="5"/></svg>',
  };
  const assetApply = await adapter.applyProposal(assetProp, null);
  assert.ok(state.characters[0].additionalAssets.some(a => a[0] === 'moon_badge'));
  await adapter.undo(assetApply.undoId);
  assert.ok(!state.characters[0].additionalAssets.some(a => a[0] === 'moon_badge'));

  const renameProp = { action: 'register_asset', mode: 'rename_asset', oldName: 'existing_bg', name: 'harbor_bg' };
  const renameApply = await adapter.applyProposal(renameProp, null);
  assert.equal(state.characters[0].additionalAssets[0][0], 'harbor_bg');
  await adapter.undo(renameApply.undoId);
  assert.equal(state.characters[0].additionalAssets[0][0], 'existing_bg');

  const inlayProp = { action: 'register_asset', mode: 'inlay', name: 'sigil', content: '<svg><rect/></svg>' };
  const inlayPrev = await adapter.previewProposal(inlayProp, null);
  assert.equal(inlayPrev.ok, true);
  assert.match(inlayPrev.after, /자동 삭제할 수 없습니다/);
  const inlayRes = await adapter.applyProposal(inlayProp, null);
  assert.match(inlayRes.message, /\{\{inlay::inlay_1\}\}/);
  await assert.rejects(() => adapter.undo(inlayRes.undoId), { code: 'UNDO_CONFLICT' });

  // 4. repair_workspace (checkCharOrder + fixOrphanLore + fixMissingChatIds + fixRegexFlags) + Undo
  const repProp = {
    action: 'repair_workspace',
    checkCharOrder: true,
    fixOrphanLore: true,
    fixMissingChatIds: true,
    fixRegexFlags: true,
  };
  const repApply = await adapter.applyProposal(repProp, null);
  assert.equal(state.characters[0].globalLore[0].folder, '');
  assert.ok(typeof state.characters[0].chats[1].id === 'string' && state.characters[0].chats[1].id.length > 8);
  assert.equal(state.characters[0].customscript[0].flag, 'g');
  assert.deepEqual(state.db.characterOrder, ['char-0', 'group-1']);
  await adapter.undo(repApply.undoId);
  assert.equal(state.characters[0].globalLore[0].folder, 'dead-folder');
  assert.equal(state.characters[0].customscript[0].flag, 'ggz!');
  assert.deepEqual(state.db.characterOrder, ['stale-only']);

  // 5. manage_chat_messages (edit, toggle_disabled, bookmark, delete with confirmation flag) + Undo
  assert.equal(requiresConfirmation({ action: 'manage_chat_messages', operation: 'delete', messageIndex: 1 }), true);
  assert.equal(requiresConfirmation({ action: 'manage_chat_messages', operation: 'bookmark', messageIndex: 1 }), false);
  const delMsgApply = await adapter.applyProposal({
    action: 'manage_chat_messages',
    operation: 'delete',
    messageIndex: 1,
    expectedSnippet: '반가워요',
  }, null);
  assert.equal(state.characters[0].chats[0].message.length, 1);
  await adapter.undo(delMsgApply.undoId);
  assert.equal(state.characters[0].chats[0].message.length, 2);
  assert.equal(state.characters[0].chats[0].message[1].data, '반가워요!');

  const disApply = await adapter.applyProposal({
    action: 'manage_chat_messages',
    operation: 'toggle_disabled',
    messageIndex: 0,
    disabled: true,
  }, null);
  assert.equal(state.characters[0].chats[0].message[0].disabled, true);
  await adapter.undo(disApply.undoId);
  assert.equal(state.characters[0].chats[0].message[0].disabled, undefined);

  // 6. update_memory (HypaV3 preview has embedding-drift warning + Supa + HypaV2) + Undo
  const hypaProp = { action: 'update_memory', memoryType: 'hypaV3', operation: 'edit', summaryIndex: 0, text: '개정된 요약', isImportant: true };
  const hypaPrev = await adapter.previewProposal(hypaProp, null);
  assert.equal(hypaPrev.ok, true);
  assert.match(hypaPrev.after, /임베딩/);
  const hypaApply = await adapter.applyProposal(hypaProp, null);
  assert.equal(state.characters[0].chats[0].hypaV3Data.summaries[0].isImportant, true);
  await adapter.undo(hypaApply.undoId);
  assert.equal(state.characters[0].chats[0].hypaV3Data.summaries[0].text, '첫 만남');
  assert.equal(state.characters[0].chats[0].hypaV3Data.summaries[0].isImportant, false);

  // 7. update_onboarding + Undo
  const onbProp = {
    action: 'update_onboarding',
    enabled: true,
    title: '시작 설정',
    fields: [{ id: 'role', label: '역할', type: 'select', options: ['기사', '마법사'], varName: 'role' }],
  };
  const onbApply = await adapter.applyProposal(onbProp, null);
  assert.equal(state.characters[0].onboarding.enabled, true);
  assert.equal(state.characters[0].onboarding.fields.length, 1);
  await adapter.undo(onbApply.undoId);
  assert.equal(state.characters[0].onboarding, undefined);

  // 8. update_group_chat: rejected on single character, succeeds on borderless group character (targetCharIndex: 1) + Undo
  const badGroupPrev = await adapter.previewProposal({ action: 'update_group_chat', orderByOrder: true }, null);
  assert.equal(badGroupPrev.ok, false);
  assert.match(badGroupPrev.error, /그룹챗/);
  const grpProp = {
    action: 'update_group_chat',
    targetCharIndex: 1,
    orderByOrder: true,
    addMembers: ['char-new'],
    setMemberTalk: { '0': 0.9 },
  };
  const grpPrev = await adapter.previewProposal(grpProp, null);
  assert.equal(grpPrev.ok, true);
  assert.match(grpPrev.label, /\[다른 캐릭터: 모험가 파티\]/);
  const grpApply = await adapter.applyProposal(grpProp, null);
  assert.equal(state.characters[1].orderByOrder, true);
  assert.equal(state.characters[1].characters.length, 3);
  assert.equal(state.characters[1].characterTalks[0], 0.9);
  await adapter.undo(grpApply.undoId);
  assert.equal(state.characters[1].orderByOrder, false);
  assert.equal(state.characters[1].characters.length, 2);

  // 9. organize_chat_folders (create -> move -> anti-orphan delete -> Undo)
  const cfCreate = await adapter.applyProposal({
    action: 'organize_chat_folders',
    operation: 'create_folder',
    folderName: '1부',
    chatIndices: [0, 1],
  }, null);
  const fId = state.characters[0].chatFolders[0].id;
  assert.equal(state.characters[0].chats[0].folderId, fId);
  assert.equal(state.characters[0].chats[1].folderId, fId);
  assert.equal(requiresConfirmation({ action: 'organize_chat_folders', operation: 'delete_folder', folderId: fId }), true);
  const cfDel = await adapter.applyProposal({
    action: 'organize_chat_folders',
    operation: 'delete_folder',
    folderId: fId,
  }, null);
  assert.equal(state.characters[0].chatFolders.length, 0);
  assert.equal(state.characters[0].chats[0].folderId, null, 'deleting folder must reset chat folderId to prevent orphans');
  assert.equal(state.characters[0].chats[1].folderId, null);
  await adapter.undo(cfDel.undoId);
  assert.equal(state.characters[0].chatFolders.length, 1);
  assert.equal(state.characters[0].chats[0].folderId, fId);
  await adapter.undo(cfCreate.undoId);
  assert.equal(state.characters[0].chatFolders.length, 0);

  // 10. manage_extensions (upsert -> toggle -> Undo)
  const extApply = await adapter.applyProposal({
    action: 'manage_extensions',
    operation: 'upsert',
    rule: { id: 'ext-r1', type: 'script_handler', name: '괄호 강조', enabled: true, mode: 'display', pattern: '\\(([^)]+)\\)', flags: 'g', replacement: '<em>($1)</em>' },
  }, null);
  assert.equal(state.meta.scriptHandlers.length, 1);
  assert.equal(state.meta.scriptHandlers[0].fn('안녕 (속삭임)'), '안녕 <em>(속삭임)</em>');
  await adapter.undo(extApply.undoId);
  assert.equal(state.meta.scriptHandlers.length, 0);

  // --- 11. RisuBard BardWiki full CRUD + Undo ---
  const bard = makeFullHost('RisuBard');
  const bardAdapter = new HostAdapter(bard.api);
  await bardAdapter.probeHostFlavor(null);
  const bwSave = await bardAdapter.applyProposal({
    action: 'manage_bard_wiki',
    operation: 'save_document',
    documentId: 'bw-2',
    title: '새 문서',
    content: '연금술 기록',
    grade: 'A',
  }, null);
  assert.equal(bard.state.meta.bardWikiDocs.length, 2);
  await bardAdapter.undo(bwSave.undoId);
  assert.equal(bard.state.meta.bardWikiDocs.length, 1);

  const bwMode = await bardAdapter.applyProposal({
    action: 'manage_bard_wiki',
    operation: 'set_context_mode',
    contextMode: 'manual',
  }, null);
  assert.equal(bard.state.meta.bardWikiContext.mode, 'manual');
  await bardAdapter.undo(bwMode.undoId);
  assert.equal(bard.state.meta.bardWikiContext.mode, 'auto');

  assert.equal(requiresConfirmation({ action: 'manage_bard_wiki', operation: 'trash_document', documentId: 'bw-1' }), true);
  const bwTrash = await bardAdapter.applyProposal({
    action: 'manage_bard_wiki',
    operation: 'trash_document',
    documentId: 'bw-1',
  }, null);
  assert.equal(bard.state.meta.bardWikiDocs.length, 0);
  await bardAdapter.undo(bwTrash.undoId);
  assert.equal(bard.state.meta.bardWikiDocs.length, 1);
  assert.equal(bard.state.meta.bardWikiDocs[0].title, '공방');

  // --- 12. RisuNest Native Conversation Patch + conflict check + Undo ---
  const nest = makeFullHost('RisuNest');
  const nestAdapter = new HostAdapter(nest.api);
  await nestAdapter.probeHostFlavor(null);
  const rnApply = await nestAdapter.applyProposal({
    action: 'patch_risunest_conversation',
    conversationId: 'conv-1',
    patch: { name: '새 제목', note: '새 노트' },
  }, null);
  assert.equal(nest.state.meta.risunestConversations['conv-1'].name, '새 제목');
  assert.equal(nest.state.meta.risunestConversations['conv-1'].note, '새 노트');
  // Post-apply user change on name -> conflict on name, clean revert on note
  nest.state.meta.risunestConversations['conv-1'].name = '유저가 바꾼 제목';
  const rnUndo = await nestAdapter.undo(rnApply.undoId);
  assert.ok(rnUndo.conflicts.some(c => c.path === 'risunest.name'));
  assert.equal(nest.state.meta.risunestConversations['conv-1'].name, '유저가 바꾼 제목');
  assert.equal(nest.state.meta.risunestConversations['conv-1'].note, '기존 노트');
});

test('M3 declarative resident extensions cover all 14 Plugin v3 APIs, block arbitrary JS & secret keys, persist across reload, and clean up 100% on dispose', async () => {
  const { state, api } = makeFullHost('RisuAI');
  const adapter = new HostAdapter(api);
  await adapter.probeHostFlavor(null);

  // Security guards: arbitrary JS code & secret body keys & unsafe MCP tools are strictly rejected
  assert.equal(validateExtensionRule({ type: 'script_handler', code: 'alert(1)', pattern: 'a', replacement: 'b' }).ok, false);
  assert.equal(validateExtensionRule({ type: 'body_intercepter', set: { apiKey: 'stolen' } }).ok, false);
  assert.equal(validateExtensionRule({ type: 'body_intercepter', set: { authorization: 'Bearer x' } }).ok, false);
  assert.equal(validateExtensionRule({ type: 'body_intercepter', removeKeys: ['headers'] }).ok, false);
  assert.equal(validateExtensionRule({ type: 'mcp_server', exposedTools: ['write_db'] }).ok, false);

  const alerts = [];
  const rt = new ExtensionRuntime(api, {
    adapter,
    onAlert: (a) => alerts.push(a),
    readToolRunner: async (toolId) => ({ ok: true, toolId }),
  });

  // Register all 7 declarative extension types (exercising all 14 APIs)
  await rt.upsert({ id: 'r-script', type: 'script_handler', name: '스크립트', mode: 'display', pattern: 'foo', flags: 'g', replacement: 'bar' });
  await rt.upsert({ id: 'r-replace', type: 'replacer', name: '치환', stage: 'afterRequest', find: 'hello', replace: '안녕' });
  await rt.upsert({ id: 'r-listen', type: 'chat_listener', name: '태그 감시', requirePatterns: ['\\[HP:\\d+\\]'], notifyLabel: 'HP 누락' });
  await rt.upsert({ id: 'r-body', type: 'body_intercepter', name: '본문 패치', matchModelRegex: 'gpt', set: { top_p: 0.9 }, removeKeys: ['seed'] });
  await rt.upsert({ id: 'r-mcp', type: 'mcp_server', name: '읽기 MCP', exposedTools: ['host_info', 'audit_workspace'] });
  await rt.upsert({ id: 'r-tts-pre', type: 'tts_processor', name: 'TTS 전처리', stage: 'pre', stripTags: true, stripAsterisks: true, stripCodeBlocks: true });
  await rt.upsert({ id: 'r-tts-post', type: 'tts_processor', name: 'TTS 후처리', stage: 'post', pattern: '\\s{2,}', flags: 'g', replacement: ' ' });
  await rt.upsert({ id: 'r-chan', type: 'plugin_channel', name: '채널', channel: 'risuhelper:v1', allowReadOnlyQueries: true, initialMessage: { type: 'ready' } });

  // Verify execution of every single hook
  assert.equal(state.meta.scriptHandlers[0].fn('foo baz'), 'bar baz');
  assert.equal(state.meta.replacers[0].fn('hello world'), '안녕 world');
  state.meta.chatListeners[0]({ data: '상태창이 없는 응답' });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].label, 'HP 누락');

  const patchedBody = state.meta.bodyIntercepters[0]({ model: 'gpt-4.1', seed: 42 });
  assert.equal(patchedBody.top_p, 0.9);
  assert.equal(Object.hasOwn(patchedBody, 'seed'), false);
  const untouchedBody = state.meta.bodyIntercepters[0]({ model: 'claude-4', seed: 42 });
  assert.equal(untouchedBody.seed, 42);

  const mcpEntry = state.meta.mcps.get('plugin:risuhelper:r-mcp');
  const mcpTools = await mcpEntry.getTools();
  assert.equal(mcpTools.length, 2);
  const mcpRes = await mcpEntry.callTool('risuhelper_host_info', {});
  assert.match(mcpRes[0].text, /"toolId":"host_info"/);

  assert.equal(state.meta.ttsPre[0]('<b>hi</b> *laugh* ```js\nx=1\n```').trim(), 'hi laugh');
  assert.equal(state.meta.ttsPost[0]('a   b'), 'a b');

  assert.equal(state.meta.postedChannelMessages.length, 1);
  await state.meta.channelListeners.get('risuhelper:v1')[0]({ type: 'risuhelper:ping' });
  assert.equal(state.meta.postedChannelMessages[1].msg.type, 'risuhelper:pong');

  // Dry-run works cleanly with zero side effects
  const dr = dryRunExtensionRule(rt.get('r-body'), { model: 'gpt-4.1', seed: 1 });
  assert.equal(dr.ok, true);
  assert.equal(dr.changed, true);

  // Dispose cleans up 100% of registered handlers and disables TTS pass-through immediately
  await rt.dispose();
  assert.equal(state.meta.scriptHandlers.length, 0);
  assert.equal(state.meta.replacers.length, 0);
  assert.equal(state.meta.chatListeners.length, 0);
  assert.equal(state.meta.bodyIntercepters.length, 0);
  assert.equal(state.meta.mcps.size, 0);
  assert.equal(state.meta.channelListeners.get('risuhelper:v1').length, 0);
  assert.equal(state.meta.ttsPre[0]('<b>raw</b>'), '<b>raw</b>', 'disposed TTS dispatcher becomes pass-through');

  // Reloading from pluginStorage restores all 8 persisted declarative rules
  const rt2 = new ExtensionRuntime(api, { adapter });
  const restored = await rt2.load();
  assert.equal(restored.length, 8);
  assert.equal(state.meta.bodyIntercepters.length, 1);
  await rt2.dispose();
});

test('M3 fork capability gating hides fork-only skills & tools on non-matching hosts, and ALL 14 Read-Only tools invoke zero write APIs', async () => {
  // PocketRisu: createInlay blocked; bard_wiki & risunest_native completely hidden
  const pocket = makeFullHost('PocketRisu');
  const pocketAdapter = new HostAdapter(pocket.api);
  await pocketAdapter.probeHostFlavor(null);
  const pCaps = pocketAdapter.getCapabilities();
  assert.equal(pCaps.createInlay, false);
  assert.equal(pCaps.bardWiki, false);
  assert.equal(pCaps.risunestPatch, false);
  const pInlayPrev = await pocketAdapter.previewProposal({ action: 'register_asset', mode: 'inlay', name: 'x', content: '<svg/>' }, null);
  assert.equal(pInlayPrev.ok, false);
  assert.match(pInlayPrev.error, /createInlay/);
  assert.ok(!getSkillCatalog(pCaps, []).some(s => s.id === 'bard_wiki' || s.id === 'risunest_native'));
  assert.equal(loadSkillPack(['bard_wiki', 'risunest_native'], pCaps).ok, false);

  // RisuBard: read_bard_wiki works and invokes 0 writes
  const bard = makeFullHost('RisuBard');
  const bardAdapter = new HostAdapter(bard.api);
  await bardAdapter.probeHostFlavor(null);
  const bwRead = await executeReadTool(bardAdapter, { tool: 'read_bard_wiki', args: {} });
  assert.equal(bwRead.ok, true);
  assert.equal(bwRead.result.totalDocuments, 1);
  assert.equal(bard.writeCalls.length, 0);

  // RisuNest: queryConversations + inspect_host_tools work and invoke 0 writes
  const nest = makeFullHost('RisuNest');
  const nestAdapter = new HostAdapter(nest.api);
  await nestAdapter.probeHostFlavor(null);
  const rnChats = await executeReadTool(nestAdapter, { tool: 'list_items', args: { kind: 'chat' } });
  assert.equal(rnChats.ok, true);
  assert.equal(rnChats.result.usedQueryConversations, true);
  const rnTools = await executeReadTool(nestAdapter, { tool: 'inspect_host_tools', args: {} });
  assert.equal(rnTools.ok, true);
  assert.equal(rnTools.result.total, 1);
  assert.equal(nest.writeCalls.length, 0);

  // Upstream RisuAI: execute ALL 12 upstream Read-Only tools -> strictly 0 write API calls
  const up = makeFullHost('RisuAI');
  const upAdapter = new HostAdapter(up.api);
  await upAdapter.probeHostFlavor(null);
  assert.equal(READ_TOOL_DEFS.length, 14);
  const availUp = getAvailableReadTools(upAdapter.getCapabilities(), { allowFetchLog: true });
  assert.equal(availUp.length, 12, 'fork-only read_bard_wiki & inspect_host_tools hidden on upstream RisuAI');
  for (const def of availUp) {
    const sampleArgs = def.id === 'load_skill' ? { skillIds: ['theme_hud'] }
      : def.id === 'read_item' ? { kind: 'theme' }
      : def.id === 'list_items' ? { kind: 'chat' }
      : def.id === 'search_translation' ? { query: 'hello' }
      : def.id === 'test_regex_cbs' ? { cbs: '{{char}}' }
      : {};
    const r = await executeReadTool(upAdapter, { tool: def.id, args: sampleArgs }, { allowFetchLog: true });
    assert.equal(r.ok, true, `Read-Only tool ${def.id} failed: ${JSON.stringify(r.result)}`);
  }
  assert.equal(up.writeCalls.length, 0, `Read-Only tools MUST NEVER invoke write APIs, got: ${up.writeCalls.join(', ')}`);
});

test('M4 static security audit: zero eval/new Function and zero Tier-6 dangerous API calls across src/', () => {
  const srcDir = path.join(ROOT, 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
  assert.ok(files.length >= 25);

  const forbiddenCodeRe = /\beval\s*\(|\bnew\s+Function\s*\(/;
  const forbiddenApiCallRe = /\b(?:api|risuai|Risuai)\.(?:nativeFetch|saveSecretHeader|loadPlugins|installPlugin|addProvider)\b/;

  for (const f of files) {
    const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
    assert.equal(forbiddenCodeRe.test(content), false, `Forbidden eval/new Function found in src/${f}`);
    assert.equal(forbiddenApiCallRe.test(content), false, `Forbidden Tier-6 API call found in src/${f}`);
  }
});

test('M4 large-library stress test: 120 characters, 320 lorebooks, 1,050 messages, 65,000-char desc stay fast and bounded', async () => {
  const { state, api } = makeFullHost('RisuAI');
  state.characters[0].desc = '장문 설정 문단입니다. '.repeat(5500); // ~66,000 chars
  state.characters[0].globalLore = Array.from({ length: 320 }, (_, i) => ({
    comment: `세계관 항목 #${i + 1}`,
    key: `키워드${i + 1}`,
    secondkey: '',
    content: `세계관 상세 내용 ${i + 1}`.repeat(5),
    mode: 'normal',
    insertorder: 100,
  }));
  state.characters[0].chats[0].message = Array.from({ length: 1050 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'char',
    data: `메시지 #${i + 1} 대화 내용입니다.`,
    chatId: `big-m-${i}`,
  }));
  // Add 119 extra characters (total 121)
  for (let i = 2; i < 121; i++) {
    state.characters.push({
      type: 'character',
      chaId: `big-char-${i}`,
      name: `캐릭터 ${i}`,
      desc: '짧은 설명',
      globalLore: [],
      customscript: [],
      triggerscript: [],
      chats: [{ id: `bc-${i}`, name: '기본', message: [] }],
      chatPage: 0,
    });
  }

  const adapter = new HostAdapter(api);
  await adapter.probeHostFlavor(null);

  const t0 = Date.now();
  const lorePage = await executeReadTool(adapter, { tool: 'list_items', args: { kind: 'lorebook', offset: 100, limit: 40 } });
  const chatSlice = await executeReadTool(adapter, { tool: 'read_chat', args: { tail: 15 } });
  const audit = await executeReadTool(adapter, { tool: 'audit_workspace', args: { scope: 'all' } });
  const catalog = await executeReadTool(adapter, { tool: 'list_items', args: { kind: 'character', offset: 0, limit: 30 } });
  const elapsedMs = Date.now() - t0;

  assert.equal(lorePage.ok, true);
  assert.equal(lorePage.result.total, 320);
  assert.equal(lorePage.result.items.length, 40);
  assert.equal(lorePage.result.hasMore, true);

  assert.equal(chatSlice.ok, true);
  assert.equal(chatSlice.result.totalMessages, 1050);
  assert.equal(chatSlice.result.messages.length, 15);
  assert.equal(chatSlice.result.range, '1036~1050');

  assert.equal(audit.ok, true);
  assert.equal(catalog.ok, true);
  assert.equal(catalog.result.total, 121);
  assert.equal(catalog.result.items.length, 30);
  assert.ok(elapsedMs < 2000, `large-library stress tools should stay fast (<2000ms), took ${elapsedMs}ms`);
});

test('M3 bundled UI integration: extensions drawer, 1-click Health Audit, RisuNest report export & clean unload', async () => {
  const { state, api } = makeFullHost('RisuNest');
  const ui = await bootBundle({
    state: {
      character: state.characters[0],
      db: { ...state.db, characters: state.characters },
      chatIndex: 0,
    },
    extraApi: {
      getRuntimeInfo: api.getRuntimeInfo,
      getColorScheme: api.getColorScheme,
      getTextTheme: api.getTextTheme,
      addRisuScriptHandler: api.addRisuScriptHandler,
      removeRisuScriptHandler: api.removeRisuScriptHandler,
      registerBodyIntercepter: api.registerBodyIntercepter,
      unregisterBodyIntercepter: api.unregisterBodyIntercepter,
      risunestOnChatView: api.risunestOnChatView,
      risunestOnGenerationEnd: api.risunestOnGenerationEnd,
      save: api.save,
    },
    runLLMModel: async () => '```risuhelper-proposal\n' + JSON.stringify({
      action: 'manage_extensions',
      title: '전역 괄호 정리 추가',
      operation: 'upsert',
      rule: { id: 'ui-ext-1', type: 'script_handler', name: '괄호 정리', mode: 'display', pattern: 'foo', flags: 'g', replacement: 'bar' },
    }) + '\n```',
  });

  // Apply declarative extension via chat proposal
  await ui.send('전역 스크립트 핸들러 추가해 줘');
  await ui.click(/^적용$/);
  assert.equal(state.meta.scriptHandlers.length, 1);

  // Open menu -> open 상주 확장 drawer -> dry-run & toggle off
  await ui.click('☰');
  await ui.click(/상주 확장/);
  assert.match(ui.bodyText(), /선언형 상주 확장 \(1개\)/);
  assert.match(ui.bodyText(), /괄호 정리/);
  await ui.click(/^테스트$/);
  assert.match(ui.bodyText(), /드라이런 OK/);
  await ui.click(/^켜짐$/);
  assert.equal(state.meta.scriptHandlers.length, 0, 'toggling rule off immediately removes host handler');

  // Open menu -> 1-click Health Audit + RisuNest Save Audit Report
  await ui.click('☰');
  await ui.click(/건강검진/);
  assert.match(ui.bodyText(), /워크스페이스 건강검진/);

  await ui.click('☰');
  await ui.click(/진단 리포트 저장/);
  assert.equal(state.meta.savedFiles.length, 1);
  assert.equal(state.meta.savedFiles[0].name, 'risuhelper-audit.md');

  // Clean unload
  await ui.unload();
  await tick(20);
});
