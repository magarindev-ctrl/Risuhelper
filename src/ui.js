import {
  VERSION,
  STORAGE_KEY,
  PRESET_STORAGE_KEY,
  UNDO_STORAGE_KEY,
  CONVERSATIONS_STORAGE_KEY,
  DEFAULT_MAX_CONTENT_CHARS,
  MAX_CONTENT_CHAR_OPTIONS,
  LARGE_TARGET_OUTLINE_THRESHOLD,
  DEFAULT_MAX_REQUEST_CHARS,
  MAX_REQUEST_CHAR_OPTIONS,
  DEFAULT_PIPELINE_LIMITS,
  PIPELINE_CALL_LIMIT_OPTIONS,
  DEFAULT_AUTO_COMPACT,
  DEFAULT_COMPACT_THRESHOLD_CHARS,
  COMPACT_THRESHOLD_CHAR_OPTIONS,
  DEFAULT_COMPACT_THRESHOLD_MESSAGES,
  DEFAULT_COMPACT_KEEP_RECENT,
  CHAR_FIELD_META,
  MODULE_FIELD_META,
  CONFIG_FIELD_META,
  SCREEN_LABELS,
} from './version.js';
import { STYLES } from './style.js';
import { FocusTracker, normalizeChipPos, MIN_DOCK_VIEWPORT_PX } from './focus-detector.js';
import { HostAdapter, resolveModuleIndex, summarizeLoreList, buildShownItemKey } from './host-adapter.js';
import { callRisuModel, buildConversationMessages, findUnknownProposalKeys, DELETE_ACTIONS, requiresConfirmation } from './llm.js';
import { runAgentLoop, normalizeMaxCalls } from './agent-loop.js';
import { executeReadTool } from './read-tools.js';
import { dryRunExtensionRule } from './extensions-runtime.js';
import { buildDiffPreview } from './text-edits.js';
import { getQuickPromptsForContext } from './knowledge.js';
import { newPresetState, validatePresetState, assembleRisuHelperMessages } from './preset-engine.js';
import { renderPresetPanel } from './preset-ui.js';
import { renderMarkdown } from './markdown.js';
import { planGreetingContext, wantsGreetingText } from './greetings.js';
import { planFieldContext, mentionedFields, AUTHOR_NOTE_FIELD } from './fields.js';
import { summarizeChatList, mentionedChatIndex, isColdStoredChat } from './chat-transfer.js';
import { summarizeChatVariables, previewRegexApplication, hasCbsSyntax } from './runtime-tools.js';
import { collectRoutingText, wantsCharacterCatalog, extractRecentAssistantSkillIds } from './skills.js';
import {
  createEmptyStore,
  normalizeConversationStore,
  createConversation,
  upsertConversation,
  renameConversation,
  togglePinConversation,
  deleteConversation,
  exportConversationStore,
  filterAndSortConversations,
  deserializeMessageFromStorage,
  deriveConversationTitle,
  normalizeTitle,
  clampSummaryText,
  formatRelativeTime,
  formatConversationAsMarkdown,
  measureUncompactedMessages,
  shouldAutoCompact,
  compactConversationMessages,
} from './conversations.js';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_IMAGES_PER_MESSAGE,
  FILE_ACCEPT_ATTR,
  formatFileSize,
  attachmentIcon,
  processFileLike,
  extractFilesFromClipboardEvent,
  readClipboardImagesFromApi,
  captureScreenImage,
  pickLocalFiles,
  buildDefaultUserPromptForAttachments,
  formatAttachmentsForPrompt,
  extractAttachmentRoutingHints,
} from './attachments.js';

const DEFAULT_SETTINGS = {
  modelMode: 'model',
  timeoutSeconds: 120,
  maxLlmCalls: 3,
  maxHistoryTurns: 12,
  maxContentChars: DEFAULT_MAX_CONTENT_CHARS,
  maxRequestChars: DEFAULT_MAX_REQUEST_CHARS,
  maxPipelineCalls: DEFAULT_PIPELINE_LIMITS.maxTotalCalls,
  confirmLargePlan: true,
  autoCompactChat: DEFAULT_AUTO_COMPACT,
  compactThresholdChars: DEFAULT_COMPACT_THRESHOLD_CHARS,
  showFloatingChip: true,
  showDetectDiagnostics: false,
  autoFillModuleEditor: false,
  floatingChipPos: null,
  dockMode: false,
  autoOpenDocked: false,
  dockPushLayout: true,
  dockWidth: 420,
  includeCharSummary: true,
  includeLoreSummary: true,
  includeConfigSummary: false,
  wideMode: false,
  autoRestoreExtensions: true,
};

const ACTION_LABELS = {
  patch_text: '부분 편집',
  replace_text: '전체 덮어쓰기',
  create_lorebook: '새 로어북 생성',
  update_lorebook: '로어북 수정',
  organize_lorebook: '로어북 폴더 정리',
  delete_lorebook: '로어북 삭제',
  update_lua: 'Lua 스크립트 수정',
  upsert_regex: '정규식 저장',
  delete_regex: '정규식 삭제',
  create_persona: '새 페르소나 생성',
  update_persona: '페르소나 수정',
  delete_persona: '페르소나 삭제',
  update_config: '설정 변경',
  update_field: '캐릭터 필드 수정',
  update_greeting: '첫 메시지 수정',
  create_greeting: '추가 첫 메시지 생성',
  delete_greeting: '추가 첫 메시지 삭제',
  import_chat: '채팅 이사',
  create_chat: '새 채팅 생성',
  update_chat_vars: '채팅 변수 편집',
  create_module: '새 모듈 생성',
  create_character: '새 캐릭터 생성',
  update_char_settings: '캐릭터 고급 설정',
  port_from_character: '캐릭터 교차 포팅',
  update_theme: '테마 · 스타일 변경',
  set_chat_panel: '채팅 HUD 패널',
  register_asset: '에셋 · 인레이 등록',
  repair_workspace: '워크스페이스 수리',
  manage_chat_messages: '채팅 메시지 관리',
  update_memory: '메모리 요약 편집',
  update_onboarding: '온보딩 폼 설정',
  update_group_chat: '그룹챗 설정',
  organize_chat_folders: '채팅 폴더 정리',
  manage_extensions: '상주 확장 규칙',
  manage_bard_wiki: 'BardWiki 문서 관리',
  patch_risunest_conversation: 'RisuNest 대화 패치',
};

function h(doc, tag, props = {}, ...children) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected' || k === 'open') el[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(doc.createTextNode(String(child)));
    } else {
      el.appendChild(child);
    }
  }
  return el;
}

function toggleElementClass(el, cls, on) {
  if (!el) return;
  if (el.classList && typeof el.classList.add === 'function' && typeof el.classList.remove === 'function') {
    if (on) el.classList.add(cls);
    else el.classList.remove(cls);
    return;
  }
  const parts = String(el.className || '').split(/\s+/).filter(Boolean);
  const idx = parts.indexOf(cls);
  if (on && idx === -1) parts.push(cls);
  if (!on && idx !== -1) parts.splice(idx, 1);
  el.className = parts.join(' ');
}

class RisuHelperApp {
  constructor(api, doc) {
    this.api = api;
    this.doc = doc;
    this.adapter = new HostAdapter(api);
    this.settings = { ...DEFAULT_SETTINGS };
    this.tracker = new FocusTracker(api, {
      showFloatingChip: this.settings.showFloatingChip,
      chipPos: this.settings.floatingChipPos,
      onChange: (ctx) => {
        this._handleLiveFocusChange(ctx);
      },
      onChipClick: () => {
        this.open();
      },
      onChipMove: (pos) => {
        this.settings.floatingChipPos = pos;
        this.saveSettings();
      },
    });

    this.isOpen = false;
    this.isDocked = false;
    this.syncPanelMode();
    this.menuOpen = false;
    this.settingsOpen = false;
    this.presetPanelOpen = false;
    this.extensionsPanelOpen = false;
    this.lastAuditResult = null;
    this._risunestCleanups = [];
    this.presetState = newPresetState();
    this.hostModuleCatalog = [];
    this.lastPresetPreview = null;
    this.busy = false;
    this.applyingGroup = false;
    this.currentJob = null;
    this.detectedContext = null;
    this.manualTarget = null;
    this.activeSnapshot = null;
    this.messages = [];
    // Pending file/image attachments for the next composer message
    this.pendingAttachments = [];
    this.lightboxImage = null;
    this._dragDepth = 0;
    // Persistent saved conversations & Antigravity-style long-chat compaction state
    this.conversationStore = createEmptyStore();
    this.activeConversationId = null;
    this.conversationTitle = '';
    this.conversationCustomTitle = false;
    this.conversationSummary = '';
    this.conversationCompactedCount = 0;
    this.conversationCompactedAt = null;
    this.conversationsPanelOpen = false;
    this.conversationSearchQuery = '';
    this.editingTitle = false;
    this.editingListTitleId = null;
    this.editingSummary = false;
    this._convSaveTimer = null;
    this._activeCharName = '';
    this.toastTimer = null;
    this._undoSaveTimer = null;
    this.toastText = '';
    this.confirmDialog = null;
    // Chat migration: the active character's chats, and the other chat attached as reference.
    this.chatList = [];
    this.referenceChat = null;
    this.referenceInfo = null;
    // Manual opt-in 1-shot fetch log diagnostic attachment (never populated automatically).
    this.attachedFetchLog = null;
    this.registeredIds = [];
    this.viewportHandler = null;
    this._lastLiveFocusSig = '';
    this._liveRefreshSeq = 0;
    this._cardSeq = 0;
  }

  _focusSignature(ctx) {
    if (!ctx) return '';
    return [
      ctx.screen || '',
      ctx.targetKind || '',
      ctx.fieldKey || '',
      ctx.loreIndex ?? '',
      ctx.loreScope || '',
      ctx.regexIndex ?? '',
      ctx.greetingIndex ?? '',
      ctx.messageIndex ?? '',
      ctx.moduleIndex ?? '',
      ctx.moduleDomHints?.fingerprint || '',
      ctx.freeTalk ? '1' : '0',
      ctx.screenHint || '',
      ctx.labelText || '',
    ].join('|');
  }

  async _handleLiveFocusChange(ctx) {
    this.detectedContext = ctx;
    if (!this.isOpen) return;

    const nextSig = this._focusSignature(ctx);
    if (nextSig === this._lastLiveFocusSig) return;
    this._lastLiveFocusSig = nextSig;

    if (this.manualTarget) {
      if (!this.busy) this.render();
      return;
    }

    const seq = ++this._liveRefreshSeq;
    await this.refreshContextSnapshot();
    if (seq !== this._liveRefreshSeq || !this.isOpen) return;
    this.render();
  }

  async init() {
    await this.loadSettings();
    this.applyContentLimit();
    await this.loadPresetState();
    await this.loadUndoState();
    await this.loadConversations();
    this.adapter.onUndoChange = (info) => {
      this.scheduleSaveUndoState();
      if (info?.evictedIds?.length) {
        this.markEvictedCards(info.evictedIds);
      }
      if (info?.evicted?.length) {
        this.showToast(`되돌리기 기록이 가득 차 가장 오래된 ${info.evicted.length}건을 정리했습니다. (정리된 변경은 더 이상 되돌릴 수 없습니다)`);
      }
    };
    this.mountBaseStyles();
    this.syncHostTheme();
    this.bindVisualViewport();

    const openHandler = () => { this.open(); };

    if (typeof this.api.registerButton === 'function') {
      const ham = await this.api.registerButton(
        { name: 'RisuHelper', icon: '✨', iconType: 'html', location: 'hamburger', id: 'risuhelper-ham' },
        openHandler
      );
      if (ham?.id) this.registeredIds.push(ham.id);
    }

    if (typeof this.api.registerSetting === 'function') {
      const setting = await this.api.registerSetting('RisuHelper', openHandler, '✨', 'html', 'risuhelper-setting');
      if (setting?.id) this.registeredIds.push(setting.id);
    }

    if (typeof this.api.onUnload === 'function') {
      await this.api.onUnload(() => this.destroy());
    }

    // Start cursor focus tracker asynchronously (gracefully continues in manual mode if mainDom is declined)
    this.tracker.showFloatingChip = this.settings.showFloatingChip;
    this.tracker.diagnostics = Boolean(this.settings.showDetectDiagnostics);
    this.tracker.chipPos = normalizeChipPos(this.settings.floatingChipPos);
    const trackerStarted = await this.tracker.start().catch(() => false);
    await this.adapter.probeHostFlavor(this.tracker.rootDoc).catch(() => {});

    // Wire & restore user-approved declarative resident extensions (zero arbitrary JS; respects Safe Mode setting)
    this.adapter.extensionRuntime.onAlert = (alert) => {
      const msg = `[${alert.label}] ${(alert.warnings || []).join(' · ')}`;
      this.showToast(msg);
    };
    this.adapter.extensionRuntime.readToolRunner = async (toolId, args) => {
      const res = await executeReadTool(this.adapter, { tool: toolId, args });
      return res.result;
    };
    await this.adapter.extensionRuntime
      .load({ autoRestore: this.settings.autoRestoreExtensions !== false })
      .catch(() => {});

    // RisuNest-specific lifecycle & message quick-edit button hooks (strictly capability-gated)
    // Upstream RisuNest risunestOnChatView / risunestOnGenerationEnd return `{ id: string }` unregistered via `unregisterUIPart(id)`
    const registerRisunestCleanup = (res) => {
      if (typeof res === 'function') {
        this._risunestCleanups.push(res);
      } else if (res && typeof res.id === 'string' && typeof this.api.unregisterUIPart === 'function') {
        const partId = res.id;
        this._risunestCleanups.push(() => this.api.unregisterUIPart(partId));
      }
    };
    if (this.adapter.hasCapability('risunestEvents')) {
      if (typeof this.api.risunestOnChatView === 'function') {
        try {
          const handle = await this.api.risunestOnChatView(() => {
            if (this.isOpen && !this.busy) this.refreshContextSnapshot().catch(() => {});
          });
          registerRisunestCleanup(handle);
        } catch {}
      }
      if (typeof this.api.risunestOnGenerationEnd === 'function') {
        try {
          const handle = await this.api.risunestOnGenerationEnd(() => {
            if (this.isOpen && !this.busy) this.refreshContextSnapshot().catch(() => {});
          });
          registerRisunestCleanup(handle);
        } catch {}
      }
      if (typeof this.api.registerButton === 'function') {
        try {
          const msgBtn = await this.api.registerButton(
            { name: 'RisuHelper 메시지 편집', icon: '✨', iconType: 'html', location: 'message', id: 'risuhelper-msg-btn' },
            async (ctxInfo) => {
              const msgIdx = Number.isInteger(ctxInfo?.messageIndex) ? ctxInfo.messageIndex : null;
              await this.open();
              if (msgIdx !== null) {
                this.manualTarget = { targetKind: 'chat_message', messageIndex: msgIdx };
                await this.refreshContextSnapshot();
              }
            }
          );
          if (msgBtn?.id) this.registeredIds.push(msgBtn.id);
        } catch {}
      }
    }

    // Optional PC auto-dock on startup (strictly opt-in via user settings)
    if (trackerStarted && this.settings.dockMode && this.settings.autoOpenDocked) {
      try {
        const view = await this.tracker.getHostViewportSize();
        if (view && view.width >= MIN_DOCK_VIEWPORT_PX) {
          await this.open({ forceDock: true });
          return;
        }
      } catch {}
    }

    this.render();
  }

  mountBaseStyles() {
    const existing = this.doc.getElementById('risuhelper-styles');
    if (existing) return;
    const style = this.doc.createElement('style');
    style.id = 'risuhelper-styles';
    style.textContent = STYLES;
    this.doc.head.appendChild(style);
  }

  async syncHostTheme() {
    if (typeof this.api.getColorScheme !== 'function') return;
    try {
      const res = await this.api.getColorScheme();
      const type = res?.scheme?.type === 'light' ? 'light' : 'dark';
      this.doc.documentElement.setAttribute('data-theme', type);
    } catch {}
  }

  bindVisualViewport() {
    const win = this.doc.defaultView;
    if (!win?.visualViewport) return;
    this.viewportHandler = () => {
      const shell = this.doc.querySelector('.rh-shell');
      if (!shell) return;
      shell.style.height = `${win.visualViewport.height}px`;
      shell.style.top = `${win.visualViewport.offsetTop}px`;
    };
    win.visualViewport.addEventListener('resize', this.viewportHandler);
  }

  async loadSettings() {
    if (!this.api.pluginStorage?.getItem) return;
    try {
      const raw = await this.api.pluginStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') {
          this.settings = { ...DEFAULT_SETTINGS, ...parsed };
          this.settings.maxLlmCalls = normalizeMaxCalls(this.settings.maxLlmCalls);
        }
      }
    } catch {}
  }

  async saveSettings() {
    if (!this.api.pluginStorage?.setItem) return;
    try {
      await this.api.pluginStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {}
  }

  /** Sends the configured "original text length" limit to the adapter (overwrite guard). */
  applyContentLimit() {
    const n = Number(this.settings.maxContentChars);
    this.settings.maxContentChars = MAX_CONTENT_CHAR_OPTIONS.includes(n) ? n : DEFAULT_MAX_CONTENT_CHARS;
    const reqN = Number(this.settings.maxRequestChars);
    this.settings.maxRequestChars = MAX_REQUEST_CHAR_OPTIONS.includes(reqN) ? reqN : DEFAULT_MAX_REQUEST_CHARS;
    const pipeN = Number(this.settings.maxPipelineCalls);
    this.settings.maxPipelineCalls = PIPELINE_CALL_LIMIT_OPTIONS.includes(pipeN) ? pipeN : DEFAULT_PIPELINE_LIMITS.maxTotalCalls;
    this.settings.confirmLargePlan = this.settings.confirmLargePlan !== false;
    this.settings.autoCompactChat = this.settings.autoCompactChat !== false;
    const compactN = Number(this.settings.compactThresholdChars);
    this.settings.compactThresholdChars = COMPACT_THRESHOLD_CHAR_OPTIONS.includes(compactN)
      ? compactN
      : DEFAULT_COMPACT_THRESHOLD_CHARS;
    this.adapter.maxContentChars = this.settings.maxContentChars;
  }

  // Undo history is kept in pluginStorage so it survives a reload of the page or the plugin.
  async loadUndoState() {
    if (!this.api.pluginStorage?.getItem) return;
    try {
      const raw = await this.api.pluginStorage.getItem(UNDO_STORAGE_KEY);
      if (raw) this.adapter.importUndoState(typeof raw === 'string' ? JSON.parse(raw) : raw);
    } catch {}
  }

  async flushUndoState() {
    if (this._undoSaveTimer) {
      clearTimeout(this._undoSaveTimer);
      this._undoSaveTimer = null;
    }
    if (!this.api.pluginStorage?.setItem) return;
    try {
      await this.api.pluginStorage.setItem(UNDO_STORAGE_KEY, JSON.stringify(this.adapter.exportUndoState()));
    } catch {}
  }

  scheduleSaveUndoState() {
    if (!this.api.pluginStorage?.setItem) return;
    clearTimeout(this._undoSaveTimer);
    this._undoSaveTimer = setTimeout(() => {
      this._undoSaveTimer = null;
      this.flushUndoState();
    }, 120);
  }

  // --- Saved Conversations & Antigravity-Style Compaction (pluginStorage only) ---

  _reconcileLoadedUndoIds() {
    const liveIds = new Set((this.adapter.undoStack || []).map(r => r.id));
    for (const msg of this.messages) {
      for (const item of msg.proposals || []) {
        if (item.applied && item.undoId && !liveIds.has(item.undoId)) {
          item.undoId = null;
        }
      }
      if (msg.groupId && !(this.adapter.undoStack || []).some(r => r.groupId === msg.groupId)) {
        msg.groupId = null;
      }
    }
  }

  _hydrateConversationRecord(record) {
    if (!record) return;
    this.activeConversationId = record.id;
    this.conversationTitle = record.title || deriveConversationTitle(record.messages, '새 대화');
    this.conversationCustomTitle = Boolean(record.customTitle);
    this.conversationSummary = record.summary || '';
    this.conversationCompactedCount = record.summary ? Math.max(0, Number(record.compactedCount) || 0) : 0;
    this.conversationCompactedAt = record.compactedAt || null;
    this.messages = (record.messages || [])
      .map(m => deserializeMessageFromStorage(m, () => `card-${++this._cardSeq}`))
      .filter(Boolean);
    this._reconcileLoadedUndoIds();
  }

  async loadConversations() {
    if (!this.api.pluginStorage?.getItem) return;
    try {
      const raw = await this.api.pluginStorage.getItem(CONVERSATIONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      this.conversationStore = normalizeConversationStore(parsed);
      if (this.conversationStore.activeId) {
        const active = this.conversationStore.conversations.find(c => c.id === this.conversationStore.activeId);
        if (active) {
          this._hydrateConversationRecord(active);
        }
      }
    } catch {
      this.conversationStore = createEmptyStore();
    }
  }

  async flushConversations() {
    if (this._convSaveTimer) {
      clearTimeout(this._convSaveTimer);
      this._convSaveTimer = null;
    }
    if (!this.api.pluginStorage?.setItem) return;
    try {
      await this.api.pluginStorage.setItem(CONVERSATIONS_STORAGE_KEY, exportConversationStore(this.conversationStore));
    } catch {}
  }

  scheduleSaveConversations() {
    if (!this.api.pluginStorage?.setItem) return;
    clearTimeout(this._convSaveTimer);
    this._convSaveTimer = setTimeout(() => {
      this._convSaveTimer = null;
      this.flushConversations();
    }, 150);
  }

  async syncActiveConversationToStore({ touchTimestamp = true, persistNow = false } = {}) {
    const hasContent = this.messages.length > 0 || Boolean(this.conversationSummary) || Boolean(this.conversationCustomTitle);
    if (!hasContent && !this.activeConversationId) return;

    const existing = this.activeConversationId
      ? this.conversationStore.conversations.find(c => c.id === this.activeConversationId)
      : null;

    const derived = deriveConversationTitle(this.messages, '새 대화');
    const title = this.conversationCustomTitle && this.conversationTitle.trim()
      ? normalizeTitle(this.conversationTitle)
      : normalizeTitle(derived);
    this.conversationTitle = title;

    const charHint = this._activeCharName || this.activeSnapshot?.charName || existing?.charHint || '';
    const now = Date.now();
    const record = createConversation({
      id: this.activeConversationId,
      title,
      customTitle: this.conversationCustomTitle,
      pinned: Boolean(existing?.pinned),
      charHint,
      messages: this.messages,
      summary: this.conversationSummary,
      compactedCount: this.conversationCompactedCount,
      compactedAt: this.conversationCompactedAt,
      createdAt: existing?.createdAt || now,
      updatedAt: touchTimestamp ? now : (existing?.updatedAt || now),
    });

    this.activeConversationId = record.id;
    this.conversationStore = upsertConversation(this.conversationStore, record);
    if (persistNow) {
      await this.flushConversations();
    } else {
      this.scheduleSaveConversations();
    }
  }

  async startNewConversation({ saveCurrent = true, toast = '' } = {}) {
    if (this.busy) {
      this.showToast('응답 생성 중에는 새 대화를 시작할 수 없습니다.');
      return;
    }
    if (saveCurrent && (this.messages.length > 0 || this.conversationSummary || this.conversationCustomTitle)) {
      await this.syncActiveConversationToStore({ touchTimestamp: false, persistNow: true });
    }
    this.activeConversationId = null;
    this.messages = [];
    this.pendingAttachments = [];
    this.closeImageLightbox({ render: false });
    this.conversationTitle = '';
    this.conversationCustomTitle = false;
    this.conversationSummary = '';
    this.conversationCompactedCount = 0;
    this.conversationCompactedAt = null;
    this.editingTitle = false;
    this.editingListTitleId = null;
    this.editingSummary = false;
    this.conversationsPanelOpen = false;
    this.conversationStore = { ...this.conversationStore, activeId: null };
    this.scheduleSaveConversations();
    if (toast) {
      this.showToast(toast);
    } else {
      this.render();
    }
  }

  async loadConversationById(id) {
    if (this.busy) {
      this.showToast('응답 생성 중에는 다른 대화를 불러올 수 없습니다.');
      return;
    }
    if (!id) return;
    if (this.activeConversationId !== id && (this.messages.length > 0 || this.conversationSummary || this.conversationCustomTitle)) {
      await this.syncActiveConversationToStore({ touchTimestamp: false, persistNow: false });
    }
    const target = this.conversationStore.conversations.find(c => c.id === id);
    if (!target) {
      this.showToast('저장된 대화를 찾을 수 없습니다.');
      return;
    }
    this._hydrateConversationRecord(target);
    this.pendingAttachments = [];
    this.closeImageLightbox({ render: false });
    this.conversationStore = { ...this.conversationStore, activeId: target.id };
    this.conversationsPanelOpen = false;
    this.editingTitle = false;
    this.editingListTitleId = null;
    this.editingSummary = false;
    await this.flushConversations();
    this.showToast(`불러옴: ${target.title}`);
    this.scrollChatToBottom();
  }

  async setCurrentConversationTitle(rawTitle) {
    const trimmed = String(rawTitle ?? '').trim();
    if (trimmed) {
      this.conversationTitle = normalizeTitle(trimmed);
      this.conversationCustomTitle = true;
    } else {
      this.conversationCustomTitle = false;
      this.conversationTitle = deriveConversationTitle(this.messages, '새 대화');
    }
    this.editingTitle = false;
    await this.syncActiveConversationToStore({ touchTimestamp: false, persistNow: true });
    this.showToast(`대화 제목 저장: ${this.conversationTitle}`);
  }

  async renameSavedConversation(id, rawTitle) {
    this.conversationStore = renameConversation(this.conversationStore, id, rawTitle);
    this.editingListTitleId = null;
    if (this.activeConversationId === id) {
      const updated = this.conversationStore.conversations.find(c => c.id === id);
      if (updated) {
        this.conversationTitle = updated.title;
        this.conversationCustomTitle = Boolean(updated.customTitle);
      }
    }
    await this.flushConversations();
    this.render();
  }

  async togglePinSavedConversation(id) {
    this.conversationStore = togglePinConversation(this.conversationStore, id);
    await this.flushConversations();
    this.render();
  }

  async deleteSavedConversation(id) {
    const target = this.conversationStore.conversations.find(c => c.id === id);
    if (!target) return;
    const confirmed = await this.askConfirm({
      title: '저장된 대화를 삭제할까요?',
      message: `${this._quoteLabel(target.title)} 대화를 목록에서 삭제합니다.`,
      detail: '대화 기록과 누적 요약만 삭제되며, 이미 RisuAI에 적용한 변경 사항은 그대로 유지됩니다.',
      confirmLabel: '예, 삭제합니다',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.conversationStore = deleteConversation(this.conversationStore, id);
    if (this.activeConversationId === id) {
      this.activeConversationId = null;
      this.messages = [];
      this.conversationTitle = '';
      this.conversationCustomTitle = false;
      this.conversationSummary = '';
      this.conversationCompactedCount = 0;
      this.conversationCompactedAt = null;
      this.editingTitle = false;
      this.editingSummary = false;
    }
    await this.flushConversations();
    this.showToast(`삭제됨: ${target.title}`);
  }

  async exportSavedConversation(id = null) {
    const target = id
      ? this.conversationStore.conversations.find(c => c.id === id)
      : createConversation({
          id: this.activeConversationId,
          title: this.conversationTitle || deriveConversationTitle(this.messages, '새 대화'),
          customTitle: this.conversationCustomTitle,
          charHint: this._activeCharName || '',
          messages: this.messages,
          summary: this.conversationSummary,
          compactedCount: this.conversationCompactedCount,
          compactedAt: this.conversationCompactedAt,
        });
    if (!target) return;
    const md = formatConversationAsMarkdown(target);
    const safeName = String(target.title || 'conversation')
      .replace(/[\\/:*?"<>|\s]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'conversation';
    const fileName = `risuhelper-chat-${safeName}.md`;
    try {
      const bytes = new TextEncoder().encode(md);
      const isProxyApi = Boolean(this.adapter?.detectHostFlavor?.()?.isProxy);
      if (!isProxyApi && typeof this.api?.save === 'function') {
        await this.api.save(fileName, bytes);
        this.showToast(`대화를 저장했습니다 (${fileName})`);
        return;
      }
      if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && this.doc?.body) {
        const blob = new Blob([bytes], { type: 'text/markdown;charset=utf-8' });
        const href = URL.createObjectURL(blob);
        const a = this.doc.createElement('a');
        a.href = href;
        a.download = fileName;
        a.style.display = 'none';
        this.doc.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(href); } catch {} }, 1000);
        this.showToast(`대화를 저장했습니다 (${fileName})`);
        return;
      }
      await this.copyText(md);
      this.showToast('마크다운 대화를 클립보드에 복사했습니다.');
    } catch {
      await this.copyText(md);
    }
  }

  async compactCurrentConversation({ manual = true, keepRecent = DEFAULT_COMPACT_KEEP_RECENT, silent = false } = {}) {
    if (manual && this.busy) return { ok: false, error: '응답 생성 중에는 요약할 수 없습니다.' };
    const stats = measureUncompactedMessages(this.messages, this.conversationCompactedCount);
    const effectiveKeep = manual
      ? Math.min(keepRecent, Math.max(2, stats.count - 2))
      : keepRecent;
    if (stats.count < 4 || (this.messages.length - effectiveKeep) <= this.conversationCompactedCount) {
      if (!silent) this.showToast('요약할 이전 대화가 아직 충분하지 않습니다. (미요약 4건 이상 필요)');
      return { ok: false, error: '요약할 이전 대화가 충분하지 않습니다.' };
    }

    let prevBusy = this.busy;
    if (manual) {
      this.busy = true;
      this.showToast('🗜️ 이전 대화를 요약하는 중...');
    }
    try {
      const res = await compactConversationMessages({
        api: this.api,
        callModel: callRisuModel,
        modelOptions: { mode: this.settings.modelMode, timeoutSeconds: this.settings.timeoutSeconds },
        job: {},
        messages: this.messages,
        compactedCount: this.conversationCompactedCount,
        existingSummary: this.conversationSummary,
        keepRecent: effectiveKeep,
        title: this.conversationTitle || deriveConversationTitle(this.messages),
      });
      if (res.ok) {
        this.conversationSummary = res.summary;
        this.conversationCompactedCount = res.compactedCount;
        this.conversationCompactedAt = Date.now();
        await this.syncActiveConversationToStore({ touchTimestamp: false, persistNow: true });
        if (!silent) {
          const kept = Math.max(0, this.messages.length - res.compactedCount);
          this.showToast(res.usedFallback
            ? `🗜️ 이전 대화 ${res.newlyCompactedCount}건을 로컬 정리로 요약했습니다. (최근 ${kept}건 원문 유지)`
            : `🗜️ 이전 대화 ${res.newlyCompactedCount}건을 요약했습니다. (최근 ${kept}건 원문 유지)`);
        }
      } else if (!silent) {
        this.showToast(res.error || '대화를 요약하지 못했습니다.');
      }
      return res;
    } finally {
      if (manual) {
        this.busy = prevBusy;
        this.render();
      }
    }
  }

  async updateCurrentConversationSummary(rawText) {
    const cleaned = clampSummaryText(rawText);
    if (!cleaned) {
      await this.clearCurrentConversationSummary();
      return;
    }
    this.conversationSummary = cleaned;
    this.conversationCompactedAt = Date.now();
    this.editingSummary = false;
    await this.syncActiveConversationToStore({ touchTimestamp: false, persistNow: true });
    this.showToast('누적 요약을 수정했습니다.');
  }

  async clearCurrentConversationSummary() {
    this.conversationSummary = '';
    this.conversationCompactedCount = 0;
    this.conversationCompactedAt = null;
    this.editingSummary = false;
    await this.syncActiveConversationToStore({ touchTimestamp: false, persistNow: true });
    this.showToast('누적 요약을 해제했습니다. (다음 요청부터 전체 대화 기록 기준)');
  }

  /** Marks cards whose undo records were evicted so they stay applied without a dead Undo button. */
  markEvictedCards(evictedIds) {
    const expired = new Set(evictedIds || []);
    if (expired.size === 0) return;
    for (const msg of this.messages) {
      for (const item of msg.proposals || []) {
        if (item.applied && item.undoId && expired.has(item.undoId)) {
          item.undoId = null;
          item.statusMessage = '적용됨 (되돌리기 기록 만료)';
        }
      }
      if (msg.groupId && !this.adapter.undoStack.some(r => r.groupId === msg.groupId)) {
        msg.groupId = null;
      }
    }
  }

  /** Marks cards whose undo records were explicitly committed so they stay applied without Undo/Commit buttons. */
  markCommittedCards(clearedIds) {
    const committed = new Set(clearedIds || []);
    if (committed.size === 0) return;
    for (const msg of this.messages) {
      for (const item of msg.proposals || []) {
        if (item.applied && item.undoId && committed.has(item.undoId)) {
          item.undoId = null;
          item.statusMessage = '확정됨 (되돌리기 기록 비움)';
        }
      }
      if (msg.groupId && !this.adapter.undoStack.some(r => r.groupId === msg.groupId)) {
        msg.groupId = null;
      }
    }
  }

  /** Commits applied changes by clearing Undo records (all, one group, or one card) without touching host data. */
  async commitUndoHistory({ undoId = null, groupId = null, label = '' } = {}) {
    if (this.applyingGroup) return;
    const records = this.adapter.undoStack.filter(r => (undoId ? r.id === undoId : groupId ? r.groupId === groupId : true));
    if (records.length === 0) return;
    const what = undoId
      ? `${this._quoteLabel(label || records[0].label)} 변경을 확정합니다.`
      : groupId
        ? `이 답변에서 적용한 변경 ${records.length}건을 확정합니다.`
        : `적용한 변경 ${this.adapter.undoUnitCount()}건을 모두 확정합니다.`;
    const confirmed = await this.askConfirm({
      title: '변경을 확정할까요?',
      message: what,
      detail: '확정하면 되돌리기 기록이 지워져 더 이상 되돌릴 수 없습니다. 적용된 내용은 그대로 유지됩니다.',
      confirmLabel: '예, 확정합니다',
      tone: 'ok',
    });
    if (!confirmed || this.applyingGroup) return;
    const res = this.adapter.clearUndoHistory({ undoId, groupId });
    if (!res.clearedIds.length) return;
    this.markCommittedCards(res.clearedIds);
    await this.flushUndoState();
    this.syncActiveConversationToStore({ touchTimestamp: false });
    const toast = undoId
      ? '✓ 변경을 확정했습니다. (되돌리기 기록에서 제거됨)'
      : groupId
        ? '✓ 묶음 변경을 확정하고 되돌리기 기록을 비웠습니다.'
        : `✓ 변경 ${res.clearedUnits}건을 확정하고 되돌리기 기록을 비웠습니다.`;
    this.showToast(toast);
  }

  /** Reconciles applied cards whose undo record was removed (undone or skipped due to conflict). */
  syncAppliedCards({ conflict = false } = {}) {
    const liveIds = new Set(this.adapter.undoStack.map(r => r.id));
    for (const msg of this.messages) {
      for (const item of msg.proposals || []) {
        if (item.applied && item.undoId && !liveIds.has(item.undoId)) {
          item.undoId = null;
          if (conflict) {
            item.statusMessage = '적용됨 (이후 직접 수정되어 되돌리지 않음)';
          } else {
            item.applied = false;
            item.statusMessage = '되돌림 완료';
          }
        }
      }
      if (msg.groupId && !this.adapter.undoStack.some(r => r.groupId === msg.groupId)) {
        msg.groupId = null;
      }
    }
  }

  describeUndoResult(res) {
    const skipped = res.conflicts?.length || 0;
    return skipped > 0
      ? `되돌림: ${res.label} — 단, 이후 직접 수정된 ${skipped}곳은 덮어쓰지 않고 그대로 두었습니다.`
      : `되돌림: ${res.label}`;
  }

  applicableProposals(msg) {
    return (msg.proposals || []).filter(item =>
      item.preview?.ok && !item.applied && !item.sent && (!item.preview.requiresConfirm || item.destructiveConfirmed)
    );
  }

  /** Applies every applicable proposal of one reply as a single undo unit. */
  async applyAllProposals(msg) {
    if (this.busy || this.applyingGroup) return;
    const initialTargets = this.applicableProposals(msg);
    if (initialTargets.length === 0) return;
    const deleteTargets = initialTargets.filter(item => requiresConfirmation(item.proposal));
    const confirmedDeletes = new Set();
    if (deleteTargets.length > 0) {
      const names = deleteTargets.slice(0, 3).map(i => i.proposal?.title || i.preview?.label || i.proposal?.action).join(', ');
      const suffix = deleteTargets.length > 3 ? ` 외 ${deleteTargets.length - 3}건` : '';
      const confirmed = await this.askConfirm({
        title: '삭제가 포함된 묶음을 적용할까요?',
        message: `선택된 ${initialTargets.length}건 중 삭제 작업 ${deleteTargets.length}건(${names}${suffix})이 포함되어 있습니다.`,
        detail: '실제 RisuAI 데이터에서 항목이 제거됩니다. 적용 직후에는 "묶음 되돌리기"로 복구할 수 있습니다.',
        confirmLabel: '예, 모두 적용합니다',
        tone: 'danger',
      });
      if (!confirmed || this.busy || this.applyingGroup) return;
      for (const item of deleteTargets) confirmedDeletes.add(item);
    }

    this.applyingGroup = true;
    const attempted = new Set();
    try {
      const { groupId } = await this.adapter.runGroup(`묶음 적용`, async () => {
        for (let guard = 0; guard < 200; guard++) {
          const next = this.applicableProposals(msg).find(item => !attempted.has(item));
          if (!next) break;
          attempted.add(next);
          await this.applyProposalItem(next, { skipDeleteConfirm: confirmedDeletes.has(next) });
        }
      });
      const appliedCount = [...attempted].filter(item => item.applied).length;
      if (appliedCount > 0) {
        msg.groupId = groupId;
        this.showToast(`${appliedCount}건을 한 번에 적용했습니다. "묶음 되돌리기" 한 번으로 모두 되돌릴 수 있습니다.`);
      } else {
        this.showToast('적용된 제안이 없습니다. 각 카드의 오류 또는 확인 체크를 확인해 주세요.');
      }
    } finally {
      this.applyingGroup = false;
    }
    this.render();
  }

  /**
   * In-panel confirmation popup. Host dialogs can open behind the plugin's fullscreen frame and
   * native confirm() is unreliable in app shells, so the question is asked inside the panel.
   * Resolves true only when the confirm button is pressed.
   */
  askConfirm({ title, message, detail = '', confirmLabel = '확인', tone = 'danger' }) {
    this._closeConfirm(false);
    return new Promise(resolve => {
      let onKeyDown = null;
      if (typeof this.doc.addEventListener === 'function') {
        onKeyDown = (e) => {
          if (e?.key === 'Escape') {
            e.preventDefault?.();
            e.stopPropagation?.();
            this._closeConfirm(false);
          }
        };
        this.doc.addEventListener('keydown', onKeyDown);
      }
      this.confirmDialog = { title, message, detail, confirmLabel, tone, resolve, onKeyDown };
      this.render();
    });
  }

  _closeConfirm(result, { render = true } = {}) {
    const dialog = this.confirmDialog;
    if (!dialog) return;
    this.confirmDialog = null;
    if (dialog.onKeyDown && typeof this.doc.removeEventListener === 'function') {
      this.doc.removeEventListener('keydown', dialog.onKeyDown);
    }
    if (render) this.render();
    dialog.resolve(Boolean(result));
  }

  _quoteLabel(label) {
    const text = String(label || '').trim();
    if (!text) return '이';
    return `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;
  }

  renderConfirmDialog() {
    const doc = this.doc;
    const dialog = this.confirmDialog;
    return h(doc, 'div', {
      class: 'rh-modal-backdrop',
      onclick: (e) => { e.stopPropagation(); this._closeConfirm(false); },
    },
      h(doc, 'div', { class: 'rh-modal', role: 'alertdialog', onclick: (e) => e.stopPropagation() },
        h(doc, 'div', { class: 'rh-modal-title' }, dialog.title),
        h(doc, 'div', { class: 'rh-modal-message' }, dialog.message),
        dialog.detail && h(doc, 'div', { class: 'rh-modal-detail' }, dialog.detail),
        h(doc, 'div', { class: 'rh-modal-actions' },
          h(doc, 'button', { class: 'rh-btn rh-modal-cancel', onclick: () => this._closeConfirm(false) }, '취소'),
          h(doc, 'button', {
            class: `rh-btn ${dialog.tone === 'ok' ? 'ok' : 'danger'} rh-modal-confirm`,
            onclick: () => this._closeConfirm(true),
          }, dialog.confirmLabel)
        )
      )
    );
  }

  /** Global undo (header button): reverts the most recent change or group after confirmation. */
  async undoLatest() {
    if (this.applyingGroup || this.adapter.undoUnitCount() === 0) return;
    const confirmed = await this.askConfirm({
      title: '변경을 되돌릴까요?',
      message: `가장 최근 변경을 되돌립니다: ${this.adapter.peekUndoLabel()}`,
      detail: '적용 전 상태로 돌아갑니다. 적용 이후 직접 고친 부분은 덮어쓰지 않습니다.',
      confirmLabel: '예, 되돌립니다',
    });
    if (!confirmed || this.applyingGroup || this.adapter.undoUnitCount() === 0) return;
    try {
      const res = await this.adapter.undo();
      this.syncAppliedCards();
      await this.refreshContextSnapshot();
      this.syncActiveConversationToStore({ touchTimestamp: false });
      this.showToast(this.describeUndoResult(res));
    } catch (err) {
      this.syncAppliedCards({ conflict: err?.code === 'UNDO_CONFLICT' });
      this.showToast(err.message);
    }
    this.render();
  }

  async undoProposalGroup(msg) {
    if (!msg.groupId || this.applyingGroup) return;
    const count = this.adapter.undoStack.filter(r => r.groupId === msg.groupId).length;
    if (count === 0) {
      msg.groupId = null;
      this.render();
      return;
    }
    const confirmed = await this.askConfirm({
      title: '묶음 변경을 되돌릴까요?',
      message: `이 답변에서 적용한 변경 ${count}건을 한꺼번에 되돌립니다.`,
      detail: '적용 전 상태로 돌아갑니다. 적용 이후 직접 고친 부분은 덮어쓰지 않습니다.',
      confirmLabel: '예, 되돌립니다',
    });
    if (!confirmed || !msg.groupId || this.applyingGroup) return;
    try {
      const res = await this.adapter.undoGroup(msg.groupId);
      this.syncAppliedCards();
      await this.refreshContextSnapshot();
      this.syncActiveConversationToStore({ touchTimestamp: false });
      this.showToast(this.describeUndoResult(res));
    } catch (err) {
      this.syncAppliedCards({ conflict: err?.code === 'UNDO_CONFLICT' });
      this.showToast(`되돌리기 실패: ${err.message}`);
    }
    this.render();
  }

  /** Re-renders only the streaming reply's body; the composer and pickers stay as they are. */
  updateStreamingBody(msg) {
    const slot = this._streamingBody;
    if (!slot || slot.msg !== msg || !slot.el) return false;
    try {
      slot.el.textContent = '';
      renderMarkdown(this.doc, slot.el, msg.content, { onCopy: (codeText) => this.copyText(codeText) });
      return true;
    } catch {
      return false;
    }
  }

  async loadPresetState() {
    if (!this.api.pluginStorage?.getItem) return;
    try {
      const raw = await this.api.pluginStorage.getItem(PRESET_STORAGE_KEY);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        this.presetState = validatePresetState(parsed);
      }
    } catch {
      this.presetState = newPresetState();
    }
  }

  async savePresetState() {
    this.presetState = validatePresetState(this.presetState);
    if (!this.api.pluginStorage?.setItem) return;
    try {
      await this.api.pluginStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(this.presetState));
    } catch {}
  }

  getEffectiveContext() {
    if (this.manualTarget) return this.manualTarget;
    if (this.detectedContext) return this.detectedContext;
    return {
      screen: 'unknown',
      targetKind: 'general',
      fieldKey: null,
      loreIndex: null,
      loreScope: null,
      freeTalk: true,
      labelText: '자유대화',
      screenHint: '',
      warnings: [],
    };
  }

  async open({ forceDock = null } = {}) {
    const wantDock = forceDock !== null ? Boolean(forceDock) : Boolean(this.settings.dockMode);
    this.isOpen = true;
    await this.syncHostTheme();
    if (wantDock && !this.tracker.enabled) {
      await this.tracker.start().catch(() => false);
    }
    if (this.tracker.enabled) {
      // Opening the panel confirms a field that just lost the cursor to this very click;
      // with nothing selected it refreshes the free-talk screen hint.
      await this.tracker.onPanelOpen(wantDock ? 'docked' : 'overlay');
    }
    this._lastLiveFocusSig = this._focusSignature(this.detectedContext);

    if (wantDock) {
      const beforeVisible = await this.tracker.snapshotVisibleIframes();
      if (typeof this.api.showContainer === 'function') {
        await this.api.showContainer('fullscreen');
      }
      const dockRes = await this.tracker.applyDock({
        width: this.settings.dockWidth,
        pushLayout: this.settings.dockPushLayout,
        beforeVisibleIndices: beforeVisible,
        localWin: this.doc.defaultView,
      });
      this.isDocked = Boolean(dockRes.ok);
      this.syncPanelMode();
    } else {
      if (this.isDocked) {
        await this.tracker.releaseDock({ restoreChip: false });
        this.isDocked = false;
        this.syncPanelMode();
      }
      if (typeof this.api.showContainer === 'function') {
        await this.api.showContainer('fullscreen');
      }
    }

    await this.refreshContextSnapshot({ forceChatList: true });
    this.render();
  }

  /** Tells the tracker whether the host is covered (overlay), usable beside us (docked) or alone. */
  syncPanelMode() {
    if (!this.tracker) return;
    this.tracker.panelMode = !this.isOpen ? 'closed' : (this.isDocked ? 'docked' : 'overlay');
  }

  async close() {
    this._closeConfirm(false, { render: false });
    this.closeImageLightbox({ render: false });
    this.attachedFetchLog = null;
    this.menuOpen = false;
    this.conversationsPanelOpen = false;
    this.editingTitle = false;
    this.editingListTitleId = null;
    this.editingSummary = false;
    this.isOpen = false;
    this.tracker.onPanelClose();
    if (this.isDocked) {
      await this.tracker.releaseDock({ restoreChip: true });
      this.isDocked = false;
      this.syncPanelMode();
    }
    if (typeof this.api.hideContainer === 'function') {
      await this.api.hideContainer();
    }
  }

  async toggleDockMode(nextValue = null) {
    const wantDock = nextValue !== null ? Boolean(nextValue) : !this.isDocked;
    this.settings.dockMode = wantDock;
    await this.saveSettings();

    if (!this.isOpen) {
      this.render();
      return;
    }

    if (wantDock) {
      if (!this.tracker.enabled) {
        await this.tracker.start().catch(() => false);
      }
      const res = await this.tracker.applyDock({
        width: this.settings.dockWidth,
        pushLayout: this.settings.dockPushLayout,
        localWin: this.doc.defaultView,
      });
      if (res.ok) {
        this.isDocked = true;
        this.syncPanelMode();
        this.showToast('오른쪽 도킹 모드 활성 · RisuAI 입력칸을 클릭하면 실시간 반영됩니다.');
      } else {
        this.isDocked = false;
        this.syncPanelMode();
        this.settings.dockMode = false;
        await this.saveSettings();
        this.showToast(res.reason || '도킹 모드로 전환할 수 없습니다.');
      }
    } else {
      await this.tracker.releaseDock({ restoreChip: false });
      this.isDocked = false;
      this.syncPanelMode();
      this.showToast('일반 오버레이 모드로 전환했습니다.');
    }
    this.render();
  }

  async _applyLiveDockSettings() {
    if (!this.isOpen || !this.isDocked) return;
    await this.tracker.applyDock({
      width: this.settings.dockWidth,
      pushLayout: this.settings.dockPushLayout,
      localWin: this.doc.defaultView,
    });
  }

  async refreshContextSnapshot({ forceChatList = false } = {}) {
    const ctx = this.getEffectiveContext();
    try {
      this.activeSnapshot = await this.adapter.readTargetSnapshot(ctx);
    } catch (err) {
      this.activeSnapshot = { ok: false, reason: err.message, content: '' };
    }
    this.moduleHintSnapshot = await this._readModuleHintSnapshot(ctx);
    await this.refreshChatList({ force: forceChatList });
  }

  /** Reloads the active character's chat list and drops a reference chat that no longer exists. */
  async refreshChatList({ force = false } = {}) {
    // The host hands over the whole character for this, so focus-driven refreshes are throttled.
    const now = Date.now();
    if (!force && this._chatListAt && now - this._chatListAt < 2000) return;
    this._chatListAt = now;
    try {
      const listed = await this.adapter.listActiveChats();
      this.chatList = listed.chats;
      this._chatListCharKey = listed.char ? `${listed.charIndex}:${listed.char.chaId || listed.char.name || ''}` : null;
    } catch {
      this.chatList = [];
      this._chatListCharKey = null;
    }
    const ref = this.referenceChat;
    if (!ref) return;
    let entry = ref.charKey === this._chatListCharKey ? this.chatList[ref.index] : null;
    if (entry && (ref.id ? entry.id !== ref.id : entry.name !== ref.name)) {
      entry = ref.id ? this.chatList.find(c => c.id === ref.id) || null : null;
    }
    if (!entry || entry.current) {
      this.referenceChat = null;
      this.referenceInfo = null;
    } else if (entry.index !== ref.index) {
      this.referenceChat = { ...ref, index: entry.index, name: entry.name };
      this.referenceInfo = null;
    }
  }

  /** Attaches another chat of this character as reference material (null clears it). */
  setReferenceChat(index) {
    const entry = Number.isInteger(index) ? this.chatList[index] : null;
    this.referenceInfo = null;
    this.referenceChat = entry && !entry.current
      ? { index: entry.index, id: entry.id, name: entry.name, charKey: this._chatListCharKey }
      : null;
  }

  /**
   * Explicitly reads and attaches the newest sanitized LLM fetch log (1-shot).
   * Must ONLY be triggered by user click — never called automatically.
   */
  async attachLatestFetchLog() {
    const res = await this.adapter.readLatestFetchLog({ index: 0 });
    if (!res.ok) {
      this.showToast(res.reason || '최근 요청 로그를 불러오지 못했습니다.');
      return false;
    }
    this.attachedFetchLog = res.log;
    this.menuOpen = false;
    this.showToast(`🔍 최근 요청 로그(HTTP ${res.log.status ?? '?'})를 첨부했습니다. 다음 1회 전송 후 자동 해제됩니다.`);
    return true;
  }

  /**
   * In free talk the expanded item of an open module editor is not a target, but the stale
   * tempModule warning still has to work: read what the DB holds for that item so it can be
   * compared with what the editor shows.
   */
  async _readModuleHintSnapshot(ctx) {
    const hints = ctx?.freeTalk ? ctx.moduleDomHints : null;
    if (!hints) return null;
    const openIdx = Number.isInteger(hints.openIdx) ? hints.openIdx : null;
    let hintTarget = null;
    if (hints.tab === 'lorebook' && openIdx !== null) {
      hintTarget = { targetKind: 'module_lorebook', loreScope: 'module', loreIndex: openIdx, fieldKey: 'content' };
    } else if (hints.tab === 'regex' && openIdx !== null) {
      hintTarget = { targetKind: 'module_regex', regexIndex: openIdx };
    } else if (hints.tab === 'trigger') {
      hintTarget = { targetKind: 'module_lua', fieldKey: 'code' };
    }
    if (!hintTarget) return null;
    try {
      const snap = await this.adapter.readTargetSnapshot({ ...hintTarget, screen: 'module', moduleDomHints: hints });
      return snap.ok && !snap.moduleUncertain ? snap : null;
    } catch {
      return null;
    }
  }

  /** The module item to compare against the open editor: the selected target, or the free-talk hint. */
  _moduleSyncSnapshot() {
    if (this.activeSnapshot?.ok && !this.activeSnapshot.moduleUncertain && this._isModuleDomFillable(this.activeSnapshot.target)) {
      return this.activeSnapshot;
    }
    return this.moduleHintSnapshot || null;
  }

  /** Text that belongs in the open module editor's contenteditable box (regex uses entry.out, not JSON). */
  _moduleSyncText(snap) {
    if (!snap) return '';
    if (snap.target?.targetKind === 'module_regex') {
      return String(snap.entry?.out ?? '');
    }
    return String(snap.content ?? '');
  }

  showToast(message) {
    this.toastText = message;
    clearTimeout(this.toastTimer);
    this.render();
    this.toastTimer = setTimeout(() => {
      this.toastText = '';
      this.render();
    }, 2800);
  }

  openImageLightbox(att) {
    const src = att?.base64 || att?.thumbDataUrl || '';
    if (!src) return;
    this.closeImageLightbox({ render: false });
    let onKeyDown = null;
    if (typeof this.doc.addEventListener === 'function') {
      onKeyDown = (e) => {
        if (e?.key === 'Escape') {
          e.preventDefault?.();
          e.stopPropagation?.();
          this.closeImageLightbox();
        }
      };
      this.doc.addEventListener('keydown', onKeyDown);
    }
    this.lightboxImage = {
      src,
      name: att.name || 'image',
      width: att.width || 0,
      height: att.height || 0,
      sizeBytes: att.sizeBytes || 0,
      isThumbOnly: !att.base64 && Boolean(att.thumbDataUrl),
      onKeyDown,
    };
    this.render();
  }

  closeImageLightbox({ render = true } = {}) {
    const lb = this.lightboxImage;
    if (!lb) return;
    this.lightboxImage = null;
    if (lb.onKeyDown && typeof this.doc.removeEventListener === 'function') {
      this.doc.removeEventListener('keydown', lb.onKeyDown);
    }
    if (render) this.render();
  }

  _appendPendingAttachment(att) {
    if (!att) return { ok: false, error: '유효하지 않은 첨부 항목입니다.' };
    if (this.pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      return { ok: false, error: `메시지당 최대 ${MAX_ATTACHMENTS_PER_MESSAGE}개까지만 첨부할 수 있습니다.` };
    }
    if (att.kind === 'image') {
      const currentImages = this.pendingAttachments.filter(a => a.kind === 'image').length;
      if (currentImages >= MAX_IMAGES_PER_MESSAGE) {
        return { ok: false, error: `이미지는 메시지당 최대 ${MAX_IMAGES_PER_MESSAGE}장까지만 첨부할 수 있습니다.` };
      }
    }
    this.pendingAttachments.push(att);
    return { ok: true };
  }

  async addAttachmentsFromFiles(fileList, source = 'file') {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return { added: 0, errors: [] };
    let added = 0;
    const errors = [];
    const notes = [];
    for (const f of files) {
      if (this.pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        errors.push(`메시지당 최대 ${MAX_ATTACHMENTS_PER_MESSAGE}개까지 첨부 가능해 나머지 파일은 건너뛰었습니다.`);
        break;
      }
      const res = await processFileLike(f, { doc: this.doc, source });
      if (!res.ok) {
        errors.push(res.error || '파일 첨부에 실패했습니다.');
        continue;
      }
      const pushRes = this._appendPendingAttachment(res.attachment);
      if (!pushRes.ok) {
        errors.push(pushRes.error);
        continue;
      }
      added++;
      if (res.attachment.truncated) {
        notes.push(`${res.attachment.name} 앞부분만 로드됨`);
      } else if (res.attachment.resized) {
        notes.push(`${res.attachment.name} 자동 리사이즈(${res.attachment.width}×${res.attachment.height})`);
      }
    }
    if (added > 0 && errors.length === 0) {
      const noteText = notes.length > 0 ? ` (${notes[0]})` : '';
      this.showToast(`첨부됨: ${added}건${noteText}`);
    } else if (added > 0 && errors.length > 0) {
      this.showToast(`${added}건 첨부됨 · 일부 실패: ${errors[0]}`);
    } else if (errors.length > 0) {
      this.showToast(errors[0]);
    } else {
      this.render();
    }
    return { added, errors };
  }

  removePendingAttachment(id) {
    this.pendingAttachments = this.pendingAttachments.filter(a => a.id !== id);
    this.render();
  }

  clearPendingAttachments() {
    this.pendingAttachments = [];
    this.render();
  }

  async pickAttachmentsUi() {
    if (this.busy) return;
    const files = await pickLocalFiles(this.doc, FILE_ACCEPT_ATTR, true);
    if (files.length > 0) {
      await this.addAttachmentsFromFiles(files, 'file');
    }
  }

  async pasteClipboardImageUi() {
    if (this.busy) return;
    const res = await readClipboardImagesFromApi(this.doc);
    if (!res.ok) {
      this.showToast(res.error || '클립보드 이미지를 읽지 못했습니다. 입력창에 Ctrl+V로 직접 붙여넣어 주세요.');
      return;
    }
    let added = 0;
    let firstErr = '';
    for (const att of res.attachments || []) {
      const pushRes = this._appendPendingAttachment(att);
      if (pushRes.ok) added++;
      else if (!firstErr) firstErr = pushRes.error;
    }
    if (added > 0) {
      this.showToast(`클립보드 이미지 ${added}장 첨부됨`);
    } else {
      this.showToast(firstErr || '클립보드 이미지를 첨부하지 못했습니다.');
    }
  }

  async captureScreenUi() {
    if (this.busy) return;
    const res = await captureScreenImage(this.doc);
    if (res.ok && res.attachment) {
      const pushRes = this._appendPendingAttachment(res.attachment);
      if (pushRes.ok) {
        const dims = res.attachment.width && res.attachment.height
          ? ` (${res.attachment.width}×${res.attachment.height})`
          : '';
        this.showToast(`화면 캡처 첨부됨${dims}`);
      } else {
        this.showToast(pushRes.error);
      }
      return;
    }
    if (res.cancelled) {
      this.showToast('화면 캡처를 취소했습니다.');
      return;
    }
    if (res.blocked) {
      this.showToast('플러그인 iframe 정책으로 화면 직접 캡처가 차단되어 있습니다. 스크린샷 복사(Win+Shift+S / Cmd+Shift+4) 후 입력창에 Ctrl+V로 붙여넣거나 📋 버튼을 눌러 주세요.');
      return;
    }
    this.showToast(res.error || '화면 캡처에 실패했습니다. 스크린샷 복사 후 Ctrl+V로 붙여넣어 주세요.');
  }

  async handleComposerPaste(event) {
    if (this.busy) return;
    const { files, hasAttachments } = extractFilesFromClipboardEvent(event);
    if (!hasAttachments) return;
    event.preventDefault?.();
    await this.addAttachmentsFromFiles(files, 'paste');
  }

  async handleDropFiles(event) {
    event.preventDefault?.();
    event.stopPropagation?.();
    if (this.busy) return;
    const rawFiles = event?.dataTransfer?.files;
    if (rawFiles && rawFiles.length > 0) {
      await this.addAttachmentsFromFiles(Array.from(rawFiles), 'drop');
    }
  }

  collectRecentAttachedTextFiles(historyMessages = [], currentAttachments = []) {
    const out = [];
    const seen = new Set();
    const pushIfText = (att) => {
      if (!att || att.kind !== 'text' || !att.content) return;
      const key = att.id || `${att.name}:${att.sizeBytes || 0}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(att);
    };
    for (const att of Array.isArray(currentAttachments) ? currentAttachments : []) {
      pushIfText(att);
    }
    const hist = Array.isArray(historyMessages) ? historyMessages : [];
    for (let i = hist.length - 1; i >= 0 && out.length < 12; i--) {
      const m = hist[i];
      if (!Array.isArray(m?.attachments)) continue;
      for (let j = m.attachments.length - 1; j >= 0 && out.length < 12; j--) {
        pushIfText(m.attachments[j]);
      }
    }
    return out;
  }

  async gatherExtraContext(ctx, userInput = '', historyMessages = [], userAttachments = []) {
    const extra = {};
    const attachHints = Array.isArray(userAttachments) && userAttachments.length > 0
      ? extractAttachmentRoutingHints(userAttachments)
      : '';
    const routingInput = attachHints ? `${String(userInput ?? '')}\n${attachHints}`.trim() : userInput;
    const routingText = collectRoutingText(routingInput, historyMessages);
    // Chat migration: the list of this character's chats (short), and the attached reference
    // chat's state and transcript (as much as the content limit allows, newest first).
    if (this.chatList.length > 1) {
      extra.chatList = summarizeChatList(this.chatList);
      if (this.referenceChat) {
        try {
          const ref = await this.adapter.readReferenceChat(this.referenceChat.index, { budget: this.settings.maxContentChars });
          if (ref.ok) {
            extra.referenceChat = ref.chat;
            this.referenceInfo = {
              index: ref.chat.index,
              messageCount: ref.chat.messageCount,
              sent: ref.chat.transcript.length,
              omitted: ref.chat.omittedMessages,
              chars: ref.chat.transcriptChars,
              hasMemory: ref.chat.memorySummaries.length > 0,
            };
          } else {
            this.referenceInfo = { index: this.referenceChat.index, error: ref.reason };
          }
        } catch (err) {
          this.referenceInfo = { index: this.referenceChat.index, error: err?.message || String(err) };
        }
      }
    }
    // First messages & character fields: full text when the request mentions them (or on the
    // chat/greeting screen for first messages), otherwise short previews when char summary is on.
    const recentSkillIds = extractRecentAssistantSkillIds(historyMessages);
    const wantGreetingText = wantsGreetingText(ctx, userInput);
    const wantFields = mentionedFields(userInput);
    const wantChatVars =
      recentSkillIds.has('chat_vars') ||
      /변수|scriptstate|호감도|신뢰도|친밀도|진행도|affection|\bhp\b|\bmp\b|스탯|상태값|플래그|카운터|\bvar\b|getvar|setvar|초기화/i.test(routingText);
    const wantCharRegex =
      ctx.screen === 'scripts' ||
      ctx.targetKind === 'char_regex' ||
      recentSkillIds.has('scripts') ||
      /정규\s*식|regex|customscript|상태창|hud|스크립트|꾸며|치환/i.test(routingText);
    const wantCharSettings =
      recentSkillIds.has('char_settings') ||
      /로어(?:북)?\s*(?:설정|예산|토큰|깊이)|loreSettings|토큰\s*예산|tokenBudget|스캔\s*(?:깊이|범위)|scanDepth|재귀\s*스캔|recursiveScanning|전체\s*단어|fullWordMatching|바이어스|로짓|bias|단어\s*(?:억제|감점|가중치|금지)|금지어|태그|tags/i.test(routingText);
    if (this.settings.includeCharSummary || this.settings.includeLoreSummary || wantGreetingText || wantFields.length > 0 || wantChatVars || wantCharRegex || wantCharSettings) {
      try {
        const { char } = await this.adapter.readActiveCharacter();
        if (char) {
          if (char.name) this._activeCharName = String(char.name).slice(0, 48);
          let cachedChat;
          const getActiveChat = async () => {
            if (cachedChat === undefined) {
              try {
                cachedChat = (await this.adapter.readActiveChat()).chat || null;
              } catch {
                cachedChat = null;
              }
            }
            return cachedChat;
          };

          if (wantGreetingText || this.settings.includeCharSummary) {
            const plan = planGreetingContext(char, await getActiveChat(), { includeFullText: wantGreetingText });
            extra.greetings = { activeIndex: plan.activeIndex, greetings: plan.greetings };
            extra.greetingsShownFull = plan.shownFull;
          }
          if (this.settings.includeCharSummary || wantFields.length > 0) {
            // Character text fields + author note: previews, and the full text of whichever
            // field the request mentions (src/fields.js).
            const fieldPlan = planFieldContext(char, await getActiveChat(), {
              userInput,
              onlyMentioned: !this.settings.includeCharSummary,
            });
            if (fieldPlan.fields.length > 0) extra.fields = fieldPlan.fields;
            extra.fieldsShownFull = fieldPlan.shownFull;
          }
          if (this.settings.includeCharSummary || wantChatVars) {
            const chat = await getActiveChat();
            if (chat && !isColdStoredChat(chat)) {
              const cv = summarizeChatVariables(chat);
              if (cv.variables.length > 0 || wantChatVars) {
                extra.chatVariables = { ...cv, includeEmpty: wantChatVars };
              }
            }
          }
          if (this.settings.includeCharSummary) {
            extra.charSummary = {
              name: char.name || '',
              globalLoreCount: char.globalLore?.length ?? 0,
              regexCount: char.customscript?.length ?? 0,
              hasLua: char.triggerscript?.[0]?.effect?.[0]?.type === 'triggerlua',
            };
          }
          if (wantCharSettings) {
            extra.charSettings = {
              loreSettings: char.loreSettings || null,
              bias: Array.isArray(char.bias) ? char.bias.slice(0, 60) : [],
              tags: Array.isArray(char.tags) ? char.tags.slice(0, 40) : [],
            };
          }
          if (wantCharRegex && Array.isArray(char.customscript) && char.customscript.length > 0) {
            extra.charRegexSummary = char.customscript.slice(0, 60).map((r, i) => ({
              index: i,
              comment: r?.comment || '',
              type: r?.type || 'editdisplay',
              in: String(r?.in ?? '').slice(0, 80),
            }));
          }
          if (this.settings.includeLoreSummary && Array.isArray(char.globalLore)) {
            const summarized = summarizeLoreList(char.globalLore);
            extra.loreSummary = summarized.loreSummary;
            if (summarized.foldersSummary.length > 0) {
              extra.foldersSummary = summarized.foldersSummary;
            }
          }
        }
      } catch {}
    }

    // Record items whose full text actually fits inside the prompt so overwrite guards never falsely
    // reject full-shown targets, while strictly flagging auto-outlined / truncated targets!
    extra.itemsShownFull = [];
    extra.contentTruncated = false;
    const addFullItem = (key) => {
      if (key && !extra.itemsShownFull.includes(key)) extra.itemsShownFull.push(key);
    };
    const toolsEnabledNow = normalizeMaxCalls(this.settings.maxLlmCalls) > 1;
    const effectiveInlineLimit = toolsEnabledNow
      ? Math.min(this.settings.maxContentChars, LARGE_TARGET_OUTLINE_THRESHOLD)
      : this.settings.maxContentChars;

    if (this.activeSnapshot?.ok) {
      const snapText = String(this.activeSnapshot.content ?? '');
      if (snapText.length > effectiveInlineLimit) {
        extra.contentTruncated = true;
      } else {
        const st = this.activeSnapshot.target;
        const addFullField = (field) => {
          if (!Array.isArray(extra.fieldsShownFull)) extra.fieldsShownFull = [];
          if (!extra.fieldsShownFull.includes(field)) extra.fieldsShownFull.push(field);
        };
        const addFullGreeting = (idx) => {
          if (!Array.isArray(extra.greetingsShownFull)) extra.greetingsShownFull = [];
          if (!extra.greetingsShownFull.includes(idx)) extra.greetingsShownFull.push(idx);
        };
        if (st?.targetKind === 'char_field' && st.fieldKey) {
          addFullField(st.fieldKey);
          addFullItem(buildShownItemKey('char_field', { field: st.fieldKey }));
          if (st.fieldKey === 'firstMessage') addFullGreeting(-1);
        } else if (st?.targetKind === 'chat_note') {
          addFullField(AUTHOR_NOTE_FIELD);
          addFullItem(buildShownItemKey('authorNote', {}));
        } else if (st?.targetKind === 'char_alt_greeting' && Number.isInteger(st.greetingIndex)) {
          addFullGreeting(st.greetingIndex);
          addFullItem(buildShownItemKey('greeting', { greetingIndex: st.greetingIndex }));
        } else if (st?.targetKind === 'char_lorebook' && Number.isInteger(st.loreIndex)) {
          addFullItem(buildShownItemKey('lorebook', { scope: 'character', loreIndex: st.loreIndex }));
        } else if (st?.targetKind === 'chat_lorebook' && Number.isInteger(st.loreIndex)) {
          addFullItem(buildShownItemKey('lorebook', { scope: 'chat', loreIndex: st.loreIndex }));
        } else if (st?.targetKind === 'module_lorebook' && Number.isInteger(st.loreIndex)) {
          addFullItem(buildShownItemKey('lorebook', { scope: 'module', moduleIndex: st.moduleIndex, loreIndex: st.loreIndex }));
        } else if (st?.targetKind === 'char_lua') {
          addFullItem(buildShownItemKey('lua', { scope: 'character' }));
        } else if (st?.targetKind === 'module_lua') {
          addFullItem(buildShownItemKey('lua', { scope: 'module', moduleIndex: st.moduleIndex }));
        } else if (st?.targetKind === 'char_regex' && Number.isInteger(st.regexIndex)) {
          addFullItem(buildShownItemKey('regex', { scope: 'character', regexIndex: st.regexIndex }));
        } else if (st?.targetKind === 'module_regex' && Number.isInteger(st.regexIndex)) {
          addFullItem(buildShownItemKey('regex', { scope: 'module', moduleIndex: st.moduleIndex, regexIndex: st.regexIndex }));
        } else if (st?.targetKind === 'persona' && Number.isInteger(st.personaIndex)) {
          addFullItem(buildShownItemKey('persona', { personaIndex: st.personaIndex }));
        }
      }
    }

    if (
      this.settings.includeLoreSummary &&
      this.activeSnapshot?.ok &&
      this.activeSnapshot.target?.targetKind === 'chat_lorebook' &&
      Array.isArray(this.activeSnapshot.loreSummary)
    ) {
      extra.chatLoreSummary = this.activeSnapshot.loreSummary;
      if (this.activeSnapshot.foldersSummary?.length > 0) {
        extra.chatFoldersSummary = this.activeSnapshot.foldersSummary;
      }
    }

    if (
      this.settings.includeLoreSummary &&
      this.activeSnapshot?.ok &&
      this.activeSnapshot.target?.targetKind === 'module_lorebook' &&
      Array.isArray(this.activeSnapshot.loreSummary)
    ) {
      extra.moduleLoreSummary = this.activeSnapshot.loreSummary;
      if (this.activeSnapshot.foldersSummary?.length > 0) {
        extra.moduleFoldersSummary = this.activeSnapshot.foldersSummary;
      }
    }

    // Free talk hints: what the screen shows is context for the model, not a target.
    if (ctx.freeTalk) {
      // The chat tab of the lorebook is open: list the chat lorebook too.
      if (this.settings.includeLoreSummary && ctx.loreScope === 'chat' && !extra.chatLoreSummary) {
        try {
          const snap = await this.adapter.readTargetSnapshot({ targetKind: 'chat_lorebook', loreScope: 'chat' });
          if (snap.ok && Array.isArray(snap.loreSummary)) {
            extra.chatLoreSummary = snap.loreSummary;
            if (snap.foldersSummary?.length > 0) extra.chatFoldersSummary = snap.foldersSummary;
          }
        } catch {}
      }
      // A module editor is open: identify the module and pass the active tab's context
      // (lorebook list + expanded entry, Lua trigger code, or regex list + expanded entry)
      // so module-scoped proposals can name moduleIndex / loreIndex / regexIndex accurately.
      if (ctx.moduleDomHints) {
        try {
          const hints = ctx.moduleDomHints;
          const openIdx = Number.isInteger(hints.openIdx) ? hints.openIdx : null;
          const tab = hints.tab || 'lorebook';
          const probeKind =
            tab === 'trigger' ? 'module_lua' :
            tab === 'regex' ? 'module_regex' :
            'module_lorebook';
          const snap = await this.adapter.readTargetSnapshot({
            targetKind: probeKind,
            ...(probeKind === 'module_lorebook' ? { loreScope: 'module', ...(openIdx !== null ? { loreIndex: openIdx } : {}) } : {}),
            ...(probeKind === 'module_regex' && openIdx !== null ? { regexIndex: openIdx } : {}),
            moduleDomHints: hints,
          });
          if (snap.ok && !snap.moduleUncertain && snap.module) {
            if (this.settings.includeLoreSummary && !extra.moduleLoreSummary) {
              if (Array.isArray(snap.loreSummary)) {
                extra.moduleLoreSummary = snap.loreSummary;
                if (snap.foldersSummary?.length > 0) extra.moduleFoldersSummary = snap.foldersSummary;
              } else if (Array.isArray(snap.module.lorebook) && snap.module.lorebook.length > 0) {
                const summarized = summarizeLoreList(snap.module.lorebook);
                extra.moduleLoreSummary = summarized.loreSummary;
                if (summarized.foldersSummary.length > 0) extra.moduleFoldersSummary = summarized.foldersSummary;
              }
            }
            const om = {
              moduleIndex: snap.target?.moduleIndex ?? null,
              name: snap.module.name || '',
              tab: hints.tab || null,
            };
            if (probeKind === 'module_lorebook' && snap.entry && Number.isInteger(snap.target?.loreIndex)) {
              const rawLore = String(snap.entry.content ?? '');
              om.expandedLoreIndex = snap.target.loreIndex;
              om.expandedLoreTitle = snap.entry.comment || '';
              om.expandedLoreContent = rawLore.slice(0, effectiveInlineLimit);
              if (rawLore.length <= effectiveInlineLimit) {
                addFullItem(buildShownItemKey('lorebook', { scope: 'module', moduleIndex: snap.target?.moduleIndex, loreIndex: snap.target.loreIndex }));
              }
            } else if (probeKind === 'module_lua') {
              const rawLua = String(snap.content ?? '');
              om.luaCode = rawLua.slice(0, effectiveInlineLimit);
              om.hasOtherTriggers = Boolean(snap.hasOtherTriggers);
              if (rawLua.length <= effectiveInlineLimit) {
                addFullItem(buildShownItemKey('lua', { scope: 'module', moduleIndex: snap.target?.moduleIndex }));
              }
            } else if (probeKind === 'module_regex') {
              if (Array.isArray(snap.regexList) && snap.regexList.length > 0) {
                om.regexList = snap.regexList.map((r, i) => ({
                  index: i,
                  comment: r?.comment || '',
                  type: r?.type || 'editdisplay',
                  in: r?.in || '',
                }));
              }
              if (snap.entry && Number.isInteger(snap.target?.regexIndex)) {
                om.expandedRegexIndex = snap.target.regexIndex;
                om.expandedRegex = snap.entry;
                if (String(snap.entry.out ?? '').length <= effectiveInlineLimit) {
                  addFullItem(buildShownItemKey('regex', { scope: 'module', moduleIndex: snap.target?.moduleIndex, regexIndex: snap.target.regexIndex }));
                }
              }
            }
            extra.openModule = om;
          }
        } catch {}
      }
    }

    const wantPersonaSummary =
      ctx.targetKind === 'persona' ||
      ctx.screen === 'persona' ||
      recentSkillIds.has('persona') ||
      /페르소나|(?<![가-힣])페르(?:[을를은는이가의도만에]|에서|랑|이랑|(?![가-힣]))|persona|바인딩|bindedPersona|유저\s*(?:설정|프로필|정보|소개|캐릭터|이름)|(?:내|플레이어|주인공)\s*(?:캐릭터\s*)?(?:프로필|설정|정보|소개|이름)/i.test(routingText);
    if (wantPersonaSummary) {
      try {
        const p = await this.adapter.readPersonas();
        if (!p.permissionDenied) {
          extra.personasSummary = p.personas.map((item, i) => {
            const promptText = String(item.personaPrompt ?? '');
            const fitInline = promptText.length <= 300;
            if (fitInline) {
              addFullItem(buildShownItemKey('persona', { personaIndex: i }));
            }
            return {
              index: i,
              name: item.name,
              note: item.note || '',
              selected: i === p.selectedPersona,
              ...(fitInline ? { personaPrompt: promptText } : { promptChars: promptText.length, truncated: true }),
            };
          });
        }
      } catch {}
    }

    if (this.settings.includeConfigSummary || ctx.targetKind === 'config' || ctx.screen === 'settings' || recentSkillIds.has('config')) {
      try {
        const cfg = await this.adapter.readAllowedConfig();
        if (cfg) extra.configSummary = cfg;
      } catch {}
    }

    if (wantsCharacterCatalog(routingText) || recentSkillIds.has('char_create_port')) {
      try {
        const res = await this.adapter.readCharacterCatalog();
        if (!res.permissionDenied && res.catalog.length > 0) {
          extra.characterCatalog = res.catalog;
        }
      } catch {}
    }

    if (this.attachedFetchLog) {
      extra.attachedFetchLog = this.attachedFetchLog;
    }
    if (this.conversationSummary) {
      extra.conversationSummary = {
        text: this.conversationSummary,
        compactedCount: this.conversationCompactedCount,
      };
    }
    return extra;
  }

  async assembleRequestPayload(ctx, historyMessages, userInput, opts = {}) {
    const compactedOffset = this.conversationSummary && this.conversationCompactedCount > 0
      ? Math.min((historyMessages || []).length, this.conversationCompactedCount)
      : 0;
    const effectiveHistory = compactedOffset > 0 ? historyMessages.slice(compactedOffset) : historyMessages;
    const userAttachments = Array.isArray(opts.userAttachments) ? opts.userAttachments : [];
    const extraContext = await this.gatherExtraContext(ctx, userInput, effectiveHistory, userAttachments);
    const maxCalls = normalizeMaxCalls(this.settings.maxLlmCalls);
    const enableTools = opts.enableTools !== undefined ? Boolean(opts.enableTools) : maxCalls > 1;
    const allowFetchLog = Boolean(opts.allowFetchLog ?? this.attachedFetchLog);
    const directMessages = buildConversationMessages({
      context: ctx,
      snapshot: this.activeSnapshot,
      extraContext,
      history: effectiveHistory,
      userInput,
      userAttachments,
      maxHistoryTurns: this.settings.maxHistoryTurns,
      maxContentChars: this.settings.maxContentChars,
      maxRequestChars: this.settings.maxRequestChars,
      capabilities: this.adapter.getCapabilities(),
      enableTools,
      allowFetchLog,
    });

    let activeChar = null;
    let activePersona = null;
    let loreEntries = [];
    if (this.presetState.mode === 'preset') {
      try {
        const res = await this.adapter.readActiveCharacter();
        activeChar = res?.char || null;
        if (Array.isArray(activeChar?.globalLore)) loreEntries = activeChar.globalLore;
      } catch {}
      try {
        const p = await this.adapter.readPersonas();
        if (!p.permissionDenied && p.personas[p.selectedPersona]) {
          activePersona = p.personas[p.selectedPersona];
        }
      } catch {}
    }

    const assembled = assembleRisuHelperMessages({
      presetState: this.presetState,
      directMessages,
      activeChar,
      activePersona,
      loreEntries,
      history: effectiveHistory,
      maxHistoryTurns: this.settings.maxHistoryTurns,
    });
    assembled.greetingsShownFull = extraContext.greetingsShownFull || [];
    assembled.fieldsShownFull = extraContext.fieldsShownFull || [];
    assembled.itemsShownFull = extraContext.itemsShownFull || [];
    assembled.contentTruncated = Boolean(extraContext.contentTruncated);
    return assembled;
  }

  async refreshPresetPreview() {
    await this.refreshContextSnapshot();
    const ctx = this.getEffectiveContext();
    const draftInput = this.doc.querySelector('.rh-composer-input')?.value?.trim()
      || (this.pendingAttachments.length > 0 ? '' : '(미리보기용 샘플 요청)');
    try {
      this.lastPresetPreview = await this.assembleRequestPayload(ctx, this.messages, draftInput, {
        userAttachments: this.pendingAttachments,
      });
    } catch (err) {
      this.lastPresetPreview = {
        mode: this.presetState.mode,
        messages: [],
        issues: [err.message || String(err)],
        notes: [],
      };
    }
  }

  async sendMessage(text, opts = {}) {
    const trimmed = String(text || '').trim();
    const turnAttachments = Array.isArray(opts.attachments)
      ? opts.attachments.filter(Boolean)
      : [...this.pendingAttachments];
    if ((!trimmed && turnAttachments.length === 0) || this.busy) return;
    if (!opts.attachments) this.pendingAttachments = [];

    await this.refreshContextSnapshot({ forceChatList: true });
    // A chat named in the request ("2번 채팅", its exact name) becomes the reference chat and
    // stays attached for follow-ups until the picker is cleared.
    const namedChat = trimmed ? mentionedChatIndex(trimmed, this.chatList) : null;
    if (namedChat !== null && namedChat !== this.referenceChat?.index) this.setReferenceChat(namedChat);
    const ctx = this.getEffectiveContext();
    const maxCalls = normalizeMaxCalls(this.settings.maxLlmCalls);
    const promptHead = trimmed || buildDefaultUserPromptForAttachments(turnAttachments);
    const historyAttachText = turnAttachments.length > 0
      ? formatAttachmentsForPrompt(turnAttachments, {
          maxPerFileChars: Math.min(this.settings.maxContentChars || 12000, 12000),
          maxTotalChars: 24000,
        })
      : '';
    const userMsg = {
      role: 'user',
      content: trimmed,
      rawText: historyAttachText ? `${promptHead}\n\n${historyAttachText}` : promptHead,
      ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
    };
    const assistantMsg = {
      role: 'assistant',
      content: '생각 중...',
      rawText: '',
      proposals: [],
      parseErrors: [],
      streaming: true,
      progressLabel: maxCalls > 1 ? `1/${maxCalls} · 요청 분석 및 응답 생성 중...` : '응답 생성 중...',
      loopMeta: null,
    };

    this.messages.push(userMsg, assistantMsg);
    this.busy = true;
    this.render();
    this.scrollChatToBottom();

    let lastChunkRenderAt = 0;
    let chunkRenderTimer = null;
    const flushChunkRender = () => {
      chunkRenderTimer = null;
      lastChunkRenderAt = Date.now();
      if (!this.updateStreamingBody(assistantMsg)) this.render();
      this.scrollChatToBottom();
    };

    const job = {
      cancelled: false,
      cancelReason: '',
      _activeStop: null,
      stop(reason = '사용자가 요청을 중단했습니다.') {
        this.cancelled = true;
        this.cancelReason = reason;
        if (typeof this._activeStop === 'function') this._activeStop(reason);
      },
      onChunk: (partial) => {
        assistantMsg.content = partial;
        assistantMsg.rawText = partial;
        const elapsed = Date.now() - lastChunkRenderAt;
        if (elapsed >= 45) {
          if (chunkRenderTimer) {
            clearTimeout(chunkRenderTimer);
            chunkRenderTimer = null;
          }
          flushChunkRender();
        } else if (!chunkRenderTimer) {
          chunkRenderTimer = setTimeout(flushChunkRender, 45 - elapsed);
        }
      },
    };
    this.currentJob = job;

    try {
      const hadOptInFetchLog = Boolean(this.attachedFetchLog);
      const optInLogSnapshot = this.attachedFetchLog ? { ...this.attachedFetchLog } : null;
      const priorMessages = this.messages.slice(0, -2);

      // Antigravity-style automatic compaction: when uncompacted conversation grows past threshold,
      // fold older turns into a rolling summary while keeping the newest turns verbatim.
      const compactCheck = shouldAutoCompact({
        messages: priorMessages,
        compactedCount: this.conversationCompactedCount,
        enabled: this.settings.autoCompactChat !== false,
        thresholdChars: this.settings.compactThresholdChars,
        thresholdMessages: DEFAULT_COMPACT_THRESHOLD_MESSAGES,
        keepRecent: DEFAULT_COMPACT_KEEP_RECENT,
      });
      if (compactCheck.shouldCompact && !job.cancelled) {
        assistantMsg.progressLabel = '🗜️ 대화가 길어져 이전 대화를 자동 요약하는 중...';
        assistantMsg.content = assistantMsg.progressLabel;
        this.render();
        this.scrollChatToBottom();
        const compactJob = {
          get cancelled() { return job.cancelled; },
          set _activeStop(fn) { job._activeStop = fn; },
        };
        const compactRes = await compactConversationMessages({
          api: this.api,
          callModel: callRisuModel,
          modelOptions: { mode: this.settings.modelMode, timeoutSeconds: this.settings.timeoutSeconds },
          job: compactJob,
          messages: priorMessages,
          compactedCount: this.conversationCompactedCount,
          existingSummary: this.conversationSummary,
          keepRecent: DEFAULT_COMPACT_KEEP_RECENT,
          title: this.conversationTitle || deriveConversationTitle(priorMessages),
        });
        if (job.cancelled) {
          throw new Error(job.cancelReason || '사용자가 요청을 중단했습니다.');
        }
        if (compactRes.ok) {
          this.conversationSummary = compactRes.summary;
          this.conversationCompactedCount = compactRes.compactedCount;
          this.conversationCompactedAt = Date.now();
          await this.syncActiveConversationToStore({ touchTimestamp: false, persistNow: false });
        }
        assistantMsg.progressLabel = maxCalls > 1 ? `1/${maxCalls} · 요청 분석 및 응답 생성 중...` : '응답 생성 중...';
        assistantMsg.content = '생각 중...';
        this.render();
      }

      const assembled = await this.assembleRequestPayload(ctx, priorMessages, trimmed, {
        enableTools: maxCalls > 1,
        allowFetchLog: hadOptInFetchLog,
        userAttachments: turnAttachments,
      });
      this.lastPresetPreview = assembled;
      if (assembled.issues && assembled.issues.length > 0) {
        throw new Error('프리셋 요청 점검에서 중단되었습니다:\n- ' + assembled.issues.join('\n- '));
      }
      // 1-shot diagnostic log attachment: consume immediately once the request is actually sent
      if (this.attachedFetchLog) {
        this.attachedFetchLog = null;
      }

      // Pin the target + full-text visibility flags at generation time; read_item may unlock more in-loop
      const pinnedCtx = JSON.parse(JSON.stringify(ctx));
      pinnedCtx.greetingsShownFull = assembled.greetingsShownFull || [];
      pinnedCtx.fieldsShownFull = assembled.fieldsShownFull || [];
      pinnedCtx.itemsShownFull = assembled.itemsShownFull || [];
      pinnedCtx.contentTruncated = Boolean(assembled.contentTruncated);
      const attachedTextFiles = this.collectRecentAttachedTextFiles(priorMessages, turnAttachments);

      const loopResult = await runAgentLoop({
        api: this.api,
        adapter: this.adapter,
        initialMessages: assembled.messages,
        callModel: callRisuModel,
        modelOptions: { mode: this.settings.modelMode, timeoutSeconds: this.settings.timeoutSeconds },
        job,
        pinnedCtx,
        currentSourceExcerpt: this.activeSnapshot?.content || '',
        maxCalls,
        maxRequestChars: this.settings.maxRequestChars,
        pipelineLimits: { maxTotalCalls: this.settings.maxPipelineCalls },
        confirmLargePlan: this.settings.confirmLargePlan !== false,
        onConfirmPlan: async (overview) => {
          if (chunkRenderTimer) {
            clearTimeout(chunkRenderTimer);
            chunkRenderTimer = null;
          }
          const targetLine = overview.targetLabel
            ? `\n대상: ${overview.targetLabel} (${overview.targetChars.toLocaleString()}자)`
            : '';
          return await this.askConfirm({
            title: overview.isReconfirm ? '다단계 작업 단계 변경 확인' : '대용량 다단계 작업 진행 확인',
            message: `${overview.modeLabel}: "${overview.goal}"\n${overview.stageBreakdownText}${targetLine}`,
            detail: `${overview.reason ? `${overview.reason}\n` : ''}${overview.safetyNote}`,
            confirmLabel: `진행 (${overview.plannedTotalCalls}회 호출)`,
            tone: 'ok',
          });
        },
        toolContext: {
          allowFetchLog: hadOptInFetchLog,
          attachedFetchLog: optInLogSnapshot,
          attachedFiles: attachedTextFiles,
        },
        onProgress: (info) => {
          assistantMsg.progressLabel = info?.label || '응답 생성 중...';
          const statusStages = new Set([
            'tools', 'repair', 'confirm_plan',
            'pipeline_step2', 'pipeline_step2_tools',
            'pipeline_step3', 'pipeline_step3_tools',
          ]);
          if (statusStages.has(info?.stage)) {
            if (chunkRenderTimer) {
              clearTimeout(chunkRenderTimer);
              chunkRenderTimer = null;
            }
            assistantMsg.content = info.label;
          }
          this.render();
          this.scrollChatToBottom();
        },
      });

      const { rawReply, parsed, previewedProposals, pinnedCtx: finalPinnedCtx } = loopResult;
      assistantMsg.streaming = false;
      assistantMsg.progressLabel = '';
      assistantMsg.rawText = rawReply;
      assistantMsg.content = parsed.prose || (parsed.proposals.length > 0 ? '아래 수정·생성 제안을 확인한 뒤 적용해 주세요.' : rawReply);
      assistantMsg.parseErrors = parsed.errors;
      assistantMsg.loopMeta = {
        callsUsed: loopResult.callsUsed,
        maxCalls: loopResult.maxCalls,
        totalPromptChars: loopResult.totalPromptChars,
        budgetTrimmedNotes: loopResult.budgetTrimmedNotes || [],
        pipeline: loopResult.pipeline || null,
        toolRuns: loopResult.toolRuns,
        repairedCount: loopResult.repairedCount,
        repairHistory: loopResult.repairHistory || [],
        loadedSkillIds: loopResult.loadedSkillIds,
        steps: loopResult.steps,
      };

      assistantMsg.proposals = [];
      for (const { proposal: prop, preview } of previewedProposals) {
        assistantMsg.proposals.push({
          cardKey: `card-${++this._cardSeq}`,
          proposal: prop,
          preview,
          pinnedTarget: preview.target ? JSON.parse(JSON.stringify(preview.target)) : finalPinnedCtx,
          hostBinding: preview.hostBinding ? JSON.parse(JSON.stringify(preview.hostBinding)) : null,
          applied: false,
          undoId: null,
          bindToCurrentChat: Boolean(prop.bindToCurrentChat),
          useInCurrentChat: Boolean(prop.useInCurrentChat),
          enableInCurrentChat: Boolean(prop.enableInCurrentChat),
          enableGlobally: Boolean(prop.enableGlobally),
          destructiveConfirmed: false,
          statusMessage: '',
          unknownKeys: findUnknownProposalKeys(prop),
        });
      }
    } catch (err) {
      assistantMsg.streaming = false;
      assistantMsg.progressLabel = '';
      assistantMsg.content = '';
      const rawErr = err.message || String(err);
      const hasImages = turnAttachments.some(a => a.kind === 'image');
      if (hasImages && !job.cancelled && !/중단|취소|프리셋 요청 점검/.test(rawErr)) {
        const modelLabel = this.settings.modelMode === 'submodel' ? '보조 모델' : '메인 모델';
        assistantMsg.error = `${rawErr}\n(이미지 첨부 요청 실패: 현재 RisuAI에서 선택된 ${modelLabel}이 이미지/Vision 입력을 지원하는지 확인해 주세요.)`;
      } else {
        assistantMsg.error = rawErr;
      }
    } finally {
      if (chunkRenderTimer) clearTimeout(chunkRenderTimer);
      this.busy = false;
      this.currentJob = null;
      await this.syncActiveConversationToStore({ touchTimestamp: true, persistNow: true });
      this.render();
      this.scrollChatToBottom();
    }
  }

  _isModuleTarget(target, proposal = null) {
    const kind = target?.targetKind || '';
    if (kind.startsWith('module_')) return true;
    if (proposal?.scope === 'module') return true;
    return false;
  }

  _isModuleDomFillable(target, proposal = null) {
    if (!target) return false;
    if (proposal?.action === 'organize_lorebook' || proposal?.action === 'create_lorebook') {
      return false;
    }
    if (target.targetKind === 'module_lorebook') {
      return (target.fieldKey || 'content') === 'content' && Number.isInteger(target.loreIndex) && target.loreIndex >= 0;
    }
    if (target.targetKind === 'module_lua') {
      return (target.fieldKey || 'code') === 'code';
    }
    if (target.targetKind === 'module_regex') {
      return (target.fieldKey || 'out') === 'out' && Number.isInteger(target.regexIndex) && target.regexIndex >= 0;
    }
    return false;
  }

  _hasModuleDomMismatch() {
    if (!this.tracker?.enabled) return false;
    const syncSnap = this._moduleSyncSnapshot();
    if (!syncSnap) return false;
    const snapTarget = syncSnap.target;
    if (!this._isModuleDomFillable(snapTarget)) return false;
    if (!this.detectedContext || this.detectedContext.screen !== 'module') return false;
    if (!this.detectedContext.freeTalk) {
      if (this.detectedContext.targetKind !== snapTarget.targetKind) return false;
      if (snapTarget.targetKind === 'module_lorebook' && this.detectedContext.loreIndex !== snapTarget.loreIndex) return false;
      if (snapTarget.targetKind === 'module_regex' && this.detectedContext.regexIndex !== snapTarget.regexIndex) return false;
    }

    const norm = (s) => String(s || '').replace(/\r\n/g, '\n').trim();
    const livePreview = norm(this.detectedContext.liveTextPreview || this.detectedContext.moduleDomHints?.textPreview || '');
    const dbContent = norm(this._moduleSyncText(syncSnap));
    if (!livePreview && !dbContent) return false;
    const dbPrefix = dbContent.slice(0, Math.min(dbContent.length, 600)).trim();
    const livePrefix = livePreview.slice(0, Math.min(livePreview.length, 600)).trim();
    if (!livePrefix) return false;
    return !dbPrefix.startsWith(livePrefix) && !livePrefix.startsWith(dbPrefix);
  }

  async syncOpenModuleEditor(target, text, { moduleId = null } = {}) {
    if (!this.tracker?.enabled) {
      return { ok: false, reason: 'mainDom 권한이 없어 화면 입력칸에 채울 수 없습니다.' };
    }
    if (!this._isModuleDomFillable(target)) {
      return {
        ok: false,
        reason: '이 필드는 <input>/<textarea> 형식이라 Plugin v3 권한으로 직접 채울 수 없습니다. 하단 "모듈 수정" 버튼을 누르지 말고 다른 설정 탭을 다녀와 다시 열어 주세요.',
      };
    }

    // Prevent filling into a different module if the user manually picked another module
    if (moduleId && this.detectedContext?.moduleDomHints) {
      try {
        const { modules, permissionDenied } = await this.adapter.readModules();
        if (!permissionDenied && Array.isArray(modules) && modules.length > 0) {
          const domMatch = resolveModuleIndex(modules, {
            targetKind: this.detectedContext.targetKind,
            fieldKey: this.detectedContext.fieldKey,
            loreIndex: this.detectedContext.loreIndex,
            regexIndex: this.detectedContext.regexIndex,
            liveTextPreview: this.detectedContext.liveTextPreview,
            moduleDomHints: this.detectedContext.moduleDomHints,
          });
          if (domMatch.matchedBy === 'dom_hints' && modules[domMatch.index]?.id && modules[domMatch.index].id !== moduleId) {
            return {
              ok: false,
              reason: '현재 RisuAI 화면에 열려 있는 모듈과 수정한 모듈이 달라 입력칸 채우기를 중단했습니다.',
            };
          }
        }
      } catch {}
    }

    const res = await this.tracker.syncModuleEditorDom({
      targetKind: target.targetKind,
      fieldKey: target.fieldKey,
      loreIndex: target.loreIndex,
      regexIndex: target.regexIndex,
      text: String(text ?? ''),
    });

    if (res.ok && this.detectedContext && this.detectedContext.screen === 'module') {
      const nextPreview = String(text ?? '').slice(0, 600);
      this.detectedContext.liveTextPreview = nextPreview;
      if (this.detectedContext.moduleDomHints) {
        this.detectedContext.moduleDomHints.textPreview = nextPreview;
      }
    }
    return res;
  }

  async _repreviewSiblingProposals(appliedItem) {
    const ownerMsg = this.messages.find(m => Array.isArray(m.proposals) && m.proposals.includes(appliedItem));
    if (!ownerMsg) return;
    for (const sibling of ownerMsg.proposals) {
      if (sibling === appliedItem || sibling.applied || sibling.preview?.ok) continue;
      try {
        const nextPreview = await this.adapter.previewProposal(sibling.proposal, sibling.pinnedTarget);
        sibling.preview = nextPreview;
        if (nextPreview.target) {
          sibling.pinnedTarget = JSON.parse(JSON.stringify(nextPreview.target));
        }
        if (nextPreview.hostBinding) {
          sibling.hostBinding = JSON.parse(JSON.stringify(nextPreview.hostBinding));
        }
      } catch {}
    }
  }

  async applyProposalItem(item, { skipDeleteConfirm = false } = {}) {
    if (requiresConfirmation(item.proposal) && !skipDeleteConfirm) {
      const confirmed = await this.askConfirm({
        title: '항목을 삭제할까요?',
        message: `${this._quoteLabel(item.proposal?.title || item.preview?.label)} 삭제 제안을 적용합니다.`,
        detail: '실제 RisuAI 데이터에서 항목이 제거됩니다. 적용 직후에는 "되돌리기"로 복구할 수 있습니다.',
        confirmLabel: '예, 삭제합니다',
        tone: 'danger',
      });
      if (!confirmed || item.applied) return;
    }

    const pinnedTarget = item.pinnedTarget || item.preview?.target;
    const hostBinding = item.hostBinding || item.preview?.hostBinding || null;
    try {
      const res = await this.adapter.applyProposal(item.proposal, pinnedTarget, {
        bindToCurrentChat: item.bindToCurrentChat,
        useInCurrentChat: item.useInCurrentChat,
        enableInCurrentChat: item.enableInCurrentChat,
        enableGlobally: item.enableGlobally,
        hostBinding,
        requireDestructiveConfirm: Boolean(item.preview?.requiresConfirm),
        destructiveConfirmed: Boolean(item.destructiveConfirmed),
      });
      item.applied = true;
      item.undoId = res.undoId;
      item.statusMessage = res.summary;
      if (item.proposal?.action === 'create_lorebook' || item.proposal?.action === 'organize_lorebook') {
        await this._repreviewSiblingProposals(item);
      }
      await this.refreshContextSnapshot();

      const isModuleEdit = this._isModuleTarget(pinnedTarget, item.proposal);
      if (isModuleEdit) {
        item.moduleDbSaved = true;
        item.moduleDomSynced = false;
        const savedText = (!item.preview?.previewDeferred && item.preview?.after !== undefined)
          ? item.preview.after
          : this._moduleSyncText(this.activeSnapshot);
        const canFillDom = this.tracker?.enabled && this._isModuleDomFillable(pinnedTarget, item.proposal);
        if (this.settings.autoFillModuleEditor && canFillDom) {
          const syncRes = await this.syncOpenModuleEditor(pinnedTarget, savedText, {
            moduleId: hostBinding?.moduleId || this.activeSnapshot?.hostBinding?.moduleId || null,
          });
          if (syncRes.ok) {
            item.moduleDomSynced = true;
            item.moduleSyncNotice = syncRes.message;
            this.showToast('✅ DB 저장 + 입력칸 채우기 완료! tempModule 반영은 스페이스→백스페이스 1회 또는 창 닫기');
          } else {
            item.moduleSyncNotice = '⚠️ DB에 저장 완료! 열려 있는 "모듈 수정" 화면(tempModule)에는 이전 내용이 남아 있습니다. 하단 "모듈 수정" 버튼을 누르면 되돌아가니 누르지 말고 다른 설정 탭을 다녀와 다시 여세요.';
            this.showToast(`${res.summary} — ⚠️ 하단 "모듈 수정" 버튼을 누르지 마세요!`);
          }
        } else {
          item.moduleSyncNotice = '⚠️ DB에 저장 완료! 열려 있는 "모듈 수정" 화면(tempModule)에는 이전 내용이 남아 있습니다. 하단 "모듈 수정" 버튼을 누르면 이전 값으로 덮어써지니 누르지 말고 다른 설정 탭을 다녀와 다시 여세요.';
          this.showToast(`${res.summary} — ⚠️ 하단 "모듈 수정" 버튼을 누르지 마세요!`);
        }
      } else {
        this.showToast(res.summary);
      }
      this.syncActiveConversationToStore({ touchTimestamp: false });
    } catch (err) {
      item.statusMessage = `적용 실패: ${err.message}`;
      this.showToast(`적용 실패: ${err.message}`);
    }
    this.render();
  }

  async undoProposalItem(item) {
    if (!item.undoId || this.applyingGroup) return;
    const confirmed = await this.askConfirm({
      title: '변경을 되돌릴까요?',
      message: `${this._quoteLabel(item.proposal?.title || item.preview?.label)} 변경을 되돌립니다.`,
      detail: '적용 전 상태로 돌아갑니다. 적용 이후 직접 고친 부분은 덮어쓰지 않습니다.',
      confirmLabel: '예, 되돌립니다',
    });
    if (!confirmed || !item.undoId || this.applyingGroup) return;
    try {
      const res = await this.adapter.undo(item.undoId);
      item.applied = false;
      item.undoId = null;
      item.statusMessage = `되돌림 완료 (${res.label})`;
      this.syncAppliedCards();
      await this.refreshContextSnapshot();

      if (item.moduleDbSaved) {
        item.moduleDbSaved = false;
        item.moduleDomSynced = false;
        const pinnedTarget = item.pinnedTarget || item.preview?.target;
        const hostBinding = item.hostBinding || item.preview?.hostBinding || null;
        if (this.settings.autoFillModuleEditor && this.tracker?.enabled && this._isModuleDomFillable(pinnedTarget, item.proposal)) {
          const restoredText = (!item.preview?.previewDeferred && item.preview?.before !== undefined)
            ? item.preview.before
            : this._moduleSyncText(this.activeSnapshot);
          const syncRes = await this.syncOpenModuleEditor(pinnedTarget, restoredText, {
            moduleId: hostBinding?.moduleId || this.activeSnapshot?.hostBinding?.moduleId || null,
          });
          item.moduleSyncNotice = syncRes.ok
            ? syncRes.message
            : '⚠️ DB에서 되돌렸습니다. 열려 있는 "모듈 수정" 화면에 이전 내용이 남아 있으면 하단 "모듈 수정"을 누르지 말고 다른 설정 탭을 다녀오세요.';
        } else {
          item.moduleSyncNotice = '⚠️ DB에서 되돌렸습니다. 열려 있는 "모듈 수정" 화면에 이전 내용이 남아 있으면 하단 "모듈 수정"을 누르지 말고 다른 설정 탭을 다녀오세요.';
        }
      }
      this.syncActiveConversationToStore({ touchTimestamp: false });
      this.showToast(this.describeUndoResult(res));
    } catch (err) {
      this.syncAppliedCards({ conflict: err?.code === 'UNDO_CONFLICT' });
      this.showToast(`되돌리기 실패: ${err.message}`);
    }
    this.render();
  }

  /** Sends a chat_input ghostwrite draft via Plugin v3 sendChat() after in-panel confirmation. */
  async sendDraftProposalItem(item) {
    if (!item?.preview?.ok || item.applied || item.sent) return;
    const text = String(item.preview.after || '').trim();
    if (!text) return;
    const confirmed = await this.askConfirm({
      title: '대필 내용을 바로 전송할까요?',
      message: '현재 채팅에 유저 메시지로 전송하고 캐릭터의 다음 응답을 생성합니다.',
      detail: '바로 전송 대신 먼저 확인·수정하고 싶다면 취소 후 "💬 채팅에 추가" 또는 "복사"를 사용해 주세요.',
      confirmLabel: '예, 바로 전송합니다',
      tone: 'ok',
    });
    if (!confirmed || item.applied || item.sent) return;
    try {
      const hostBinding = item.hostBinding || item.preview?.hostBinding || null;
      const res = await this.adapter.sendUserChatMessage(text, { hostBinding });
      item.sent = true;
      item.statusMessage = res.summary;
      await this.refreshContextSnapshot({ forceChatList: true });
      this.syncActiveConversationToStore({ touchTimestamp: false });
      this.showToast(res.summary);
    } catch (err) {
      item.statusMessage = `전송 실패: ${err.message}`;
      this.showToast(`전송 실패: ${err.message}`);
    }
    this.render();
  }

  async copyText(text) {
    try {
      if (this.doc.defaultView?.navigator?.clipboard?.writeText) {
        await this.doc.defaultView.navigator.clipboard.writeText(String(text || ''));
        this.showToast('클립보드에 복사했습니다.');
        return;
      }
    } catch {}
    try {
      const ta = this.doc.createElement('textarea');
      ta.value = String(text || '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      this.doc.body.appendChild(ta);
      ta.select();
      this.doc.execCommand('copy');
      ta.remove();
      this.showToast('클립보드에 복사했습니다.');
    } catch {
      this.showToast('복사에 실패했습니다.');
    }
  }

  scrollChatToBottom() {
    const chat = this.doc.querySelector('.rh-chat');
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  buildTargetPickerOptions() {
    const autoLabel = this.detectedContext
      ? (this.detectedContext.freeTalk && this.detectedContext.screenHint
          ? `${this.detectedContext.labelText} · ${this.detectedContext.screenHint}`
          : this.detectedContext.labelText)
      : '자유대화';
    const opts = [
      { value: 'auto', label: `📍 자동감지: ${autoLabel}` },
      { value: 'chat_input:', label: '채팅 · 입력창 (유저 대필)' },
      { value: 'char_field:desc', label: '캐릭터 · 설명 (Description)' },
      { value: 'char_field:additionalText', label: '캐릭터 · 추가 디스크립션' },
      { value: 'char_field:firstMessage', label: '캐릭터 · 첫 메시지 (First Message)' },
      { value: 'char_alt_greeting:', label: '캐릭터 · 추가 첫 메시지 (Alternate Greetings)' },
      { value: 'chat_note:', label: "채팅 · 작가의 노트 (Author's Note)" },
      { value: 'chat_message:', label: '채팅 · 메시지 수정 (말풍선)' },
      { value: 'char_field:systemPrompt', label: '캐릭터 · 시스템 프롬프트' },
      { value: 'char_field:replaceGlobalNote', label: '캐릭터 · 글로벌 노트 덮어쓰기' },
      { value: 'char_field:depthPrompt', label: '캐릭터 · 깊이 프롬프트 (Depth Prompt)' },
      { value: 'char_field:defaultVariables', label: '캐릭터 · 기본 변수 (Default Variables)' },
      { value: 'char_field:customModuleToggle', label: '캐릭터 · 커스텀 토글' },
      { value: 'char_field:translatorNote', label: '캐릭터 · 번역가의 노트' },
      { value: 'char_field:creatorNotes', label: '캐릭터 · 제작자 코멘트' },
      { value: 'char_field:nickname', label: '캐릭터 · 닉네임' },
      { value: 'char_field:backgroundHTML', label: '캐릭터 · 백그라운드 임베딩 (HTML)' },
      { value: 'char_lorebook:', label: '캐릭터 로어북 (목록 / 생성)' },
      { value: 'chat_lorebook:', label: '채팅 로컬 로어북 (목록 / 생성)' },
      { value: 'char_lua:', label: '캐릭터 Lua 트리거 스크립트' },
      { value: 'char_regex:', label: '캐릭터 정규식 스크립트' },
      { value: 'persona:', label: '페르소나 (목록 / 생성 · 수정)' },
      { value: 'module_field:backgroundEmbedding', label: '모듈 · 백그라운드 임베딩 (HTML)' },
      { value: 'module_field:customModuleToggle', label: '모듈 · 커스텀 토글' },
      { value: 'module_field:description', label: '모듈 · 설명' },
      { value: 'module_lorebook:', label: '모듈 로어북' },
      { value: 'module_lua:', label: '모듈 Lua 트리거 스크립트' },
      { value: 'module_regex:', label: '모듈 정규식 스크립트' },
      { value: 'config:', label: 'RisuAI 설정 / 컨피그 진단' },
      { value: 'config:customCSS', label: '설정 · 커스텀 CSS (customCSS)' },
      { value: 'config:guiHTML', label: '설정 · 채팅 HTML (guiHTML)' },
      { value: 'general:', label: '자유대화 (대상 지정 없음)' },
    ];
    return opts;
  }

  currentPickerValue() {
    if (!this.manualTarget) return 'auto';
    const k = this.manualTarget.targetKind;
    const f = this.manualTarget.fieldKey || '';
    if (k === 'char_field') return `char_field:${f}`;
    if (k === 'module_field') return `module_field:${f || 'backgroundEmbedding'}`;
    if (k === 'config' && (f === 'customCSS' || f === 'guiHTML')) return `config:${f}`;
    return `${k}:`;
  }

  async onSelectTarget(val) {
    if (val === 'auto') {
      this.manualTarget = null;
    } else {
      const [kind, field] = val.split(':');
      const screenMap = {
        char_field: 'character',
        char_alt_greeting: 'character',
        chat_note: 'character',
        chat_input: 'chat',
        chat_message: 'chat',
        char_lorebook: 'lorebook',
        chat_lorebook: 'lorebook',
        char_lua: 'scripts',
        char_regex: 'scripts',
        persona: 'persona',
        module_field: 'module',
        module_lorebook: 'module',
        module_lua: 'module',
        module_regex: 'module',
        config: 'settings',
        general: 'unknown',
      };
      this.manualTarget = {
        screen: screenMap[kind] || 'unknown',
        targetKind: kind,
        fieldKey: field || (
          kind === 'chat_note' ? 'note' :
          kind === 'chat_input' ? 'input' :
          kind === 'chat_message' ? 'data' :
          kind === 'char_alt_greeting' ? 'alternateGreetings' :
          kind === 'module_field' ? 'backgroundEmbedding' :
          kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook' ? 'content' :
          kind === 'persona' ? 'personaPrompt' :
          null
        ),
        loreIndex: null,
        loreScope: kind === 'chat_lorebook' ? 'chat' : kind === 'module_lorebook' ? 'module' : kind === 'char_lorebook' ? 'character' : null,
        ...(kind === 'general' ? { freeTalk: true, screenHint: '' } : {}),
        labelText: kind === 'general'
          ? '자유대화'
          : kind === 'chat_input'
            ? '채팅 입력창 (유저 대필)'
            : kind === 'char_field'
              ? (CHAR_FIELD_META[field]?.label || field)
              : kind === 'char_alt_greeting'
                ? '캐릭터 · 추가 첫 메시지'
                : kind === 'chat_note'
                  ? '작가의 노트 (현재 채팅)'
                  : kind === 'chat_message'
                    ? '채팅 · 메시지 수정'
                    : kind === 'module_field'
                      ? (MODULE_FIELD_META[field]?.label || `모듈 · ${field}`)
                      : kind === 'config' && field
                        ? (CONFIG_FIELD_META[field]?.label || `설정 · ${field}`)
                        : (SCREEN_LABELS[screenMap[kind]] || kind),
        warnings: [],
      };
    }
    await this.refreshContextSnapshot();
    this.render();
  }

  _formatRegexPreviewLines(rp) {
    if (!rp) return '';
    if (!rp.ok) return `오류: ${rp.error || '실행 실패'}`;
    const lines = [`플래그: /${rp.flags || 'g'} · 매칭: ${rp.matchCount || 0}건${rp.sampleSource ? ` (${rp.sampleSource})` : ''}`];
    if (rp.before) {
      lines.push(`[입력 샘플]\n${rp.before}`);
      lines.push(`[치환 결과]\n${rp.after}`);
    } else {
      lines.push('위 입력칸에 테스트 문장을 넣고 "실행 테스트"를 눌러 보세요.');
    }
    if (rp.cbsOutput !== undefined) {
      lines.push(`[CBS 실행 미리보기 · 변수 미변경]\n${rp.cbsOutput}`);
    }
    return lines.join('\n\n');
  }

  renderProposalCard(item) {
    const doc = this.doc;
    const { proposal, preview } = item;
    const isChatInputDraft = (item.pinnedTarget?.targetKind || preview.target?.targetKind) === 'chat_input' && proposal.action === 'replace_text';
    const isDelete = requiresConfirmation(proposal) || Boolean(preview.isDelete);
    const actionLabel = isChatInputDraft ? '유저 대필' : (ACTION_LABELS[proposal.action] || proposal.action);
    const cardKey = item.cardKey || `card-${proposal.action}`;
    const bodyChildren = [];

    if (preview.label) {
      bodyChildren.push(
        h(doc, 'div', { style: 'font-size:11.5px;color:var(--rh-muted);' }, `적용 대상(고정): ${preview.label}`)
      );
    }
    if (item.unknownKeys?.length) {
      bodyChildren.push(
        h(doc, 'div', { class: 'rh-banner' },
          `지원하지 않는 속성이 제안에 들어 있어 무시됩니다: ${item.unknownKeys.join(', ')}. 이 속성이 꼭 필요한 변경이라면 결과가 요청과 다를 수 있습니다.`)
      );
    }

    if (!preview.ok) {
      bodyChildren.push(h(doc, 'div', { class: 'rh-banner error' }, preview.error));
    } else {
      if (preview.destructiveWarning) {
        bodyChildren.push(h(doc, 'div', { class: 'rh-banner error' }, preview.destructiveWarning));
      }
      if (preview.warning && preview.warning !== preview.destructiveWarning) {
        bodyChildren.push(h(doc, 'div', { class: 'rh-banner' }, preview.warning));
      }

      const metaChanges = Array.isArray(preview.metaChanges) ? preview.metaChanges : [];
      if (metaChanges.length > 0) {
        bodyChildren.push(
          h(doc, 'div', { class: 'rh-meta-diff' },
            ...metaChanges.map(mc =>
              h(doc, 'div', { class: 'rh-meta-diff-row' },
                h(doc, 'span', { class: 'rh-meta-key' }, `${mc.label}:`),
                h(doc, 'span', { class: 'rh-meta-old' }, mc.before),
                h(doc, 'span', {}, '→'),
                h(doc, 'span', { class: 'rh-meta-new' }, mc.after)
              )
            )
          )
        );
      }

      if (preview.previewDeferred) {
        bodyChildren.push(
          h(doc, 'div', { class: 'rh-banner', style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;' },
            h(doc, 'span', {}, '💾 저장 용량 절약을 위해 대용량 미리보기 일부만 보관되었습니다. 적용 시 현재 데이터에 정확히 반영됩니다.'),
            !item.applied && h(doc, 'button', {
              class: 'rh-btn',
              onclick: async () => {
                try {
                  const fresh = await this.adapter.previewProposal(item.proposal, item.pinnedTarget);
                  item.preview = fresh;
                  if (fresh.target) item.pinnedTarget = JSON.parse(JSON.stringify(fresh.target));
                  if (fresh.hostBinding) item.hostBinding = JSON.parse(JSON.stringify(fresh.hostBinding));
                  this.render();
                } catch (err) {
                  this.showToast(`미리보기 새로고침 실패: ${err.message}`);
                }
              },
            }, '🔄 미리보기 다시 계산')
          )
        );
      }

      const diff = buildDiffPreview(preview.before, preview.after, 140);
      const diffEl = h(doc, 'div', { class: 'rh-diff' });
      if (diff.lines.length === 0) {
        diffEl.appendChild(
          h(doc, 'div', { class: 'rh-diff-line meta' },
            metaChanges.length > 0 ? '(본문 변경 없음 · 위 메타데이터 변경만 적용됨)' : '(변경 사항 없음)'
          )
        );
      } else {
        for (const line of diff.lines) {
          const prefix = line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : line.type === 'meta' ? '' : '  ';
          diffEl.appendChild(h(doc, 'div', { class: `rh-diff-line ${line.type}` }, prefix + line.text));
        }
        if (diff.truncated) {
          diffEl.appendChild(h(doc, 'div', { class: 'rh-diff-line meta' }, '... (긴 Diff 일부 생략)'));
        }
      }
      bodyChildren.push(diffEl);

      if (preview.regexPreview && preview.regexPreview.entry) {
        const liveRp = item._regexLive || preview.regexPreview;
        const summaryText = liveRp.before
          ? `🧪 정규식 실행 결과 미리보기 (${liveRp.matched ? `매칭 ${liveRp.matchCount}건` : '현재 샘플 미매칭'} · ${liveRp.sampleSource || '샘플'})`
          : '🧪 정규식 실행 결과 미리보기 (샘플 문장을 넣어 직접 테스트)';
        const summaryEl = h(doc, 'summary', {}, summaryText);
        const preEl = h(doc, 'pre', { class: 'rh-preview-pre' }, this._formatRegexPreviewLines(liveRp));
        const sampleInput = h(doc, 'input', {
          class: 'rh-input',
          type: 'text',
          style: 'flex:1;min-width:140px;',
          placeholder: '테스트할 채팅 문장을 입력하세요',
          value: liveRp.before || '',
        });
        const runRegexTest = async () => {
          const sample = String(sampleInput.value ?? '');
          const nextRp = previewRegexApplication(preview.regexPreview.entry, sample);
          nextRp.sampleSource = '직접 입력';
          nextRp.entry = preview.regexPreview.entry;
          if (nextRp.ok && typeof this.api?.parseRisuChat === 'function') {
            const cbsInput = nextRp.matched
              ? nextRp.after
              : (hasCbsSyntax(preview.regexPreview.entry.out) ? preview.regexPreview.entry.out : '');
            if (cbsInput) {
              const sim = await this.adapter.simulateRisuChat(cbsInput, { processRegex: false });
              if (sim.ok) nextRp.cbsOutput = sim.output;
            }
          }
          item._regexLive = nextRp;
          summaryEl.textContent = nextRp.before
            ? `🧪 정규식 실행 결과 미리보기 (${nextRp.matched ? `매칭 ${nextRp.matchCount}건` : '현재 샘플 미매칭'} · 직접 입력)`
            : '🧪 정규식 실행 결과 미리보기 (샘플 문장을 넣어 직접 테스트)';
          preEl.textContent = this._formatRegexPreviewLines(nextRp);
        };
        sampleInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            runRegexTest();
          }
        });
        bodyChildren.push(
          h(doc, 'details', { class: 'rh-preview-details', 'data-rh-details-key': `${cardKey}-regex` },
            summaryEl,
            h(doc, 'div', { class: 'rh-row', style: 'margin-top:6px;' },
              sampleInput,
              h(doc, 'button', { class: 'rh-btn', type: 'button', onclick: () => runRegexTest() }, '실행 테스트')
            ),
            preEl
          )
        );
      }

      if (preview.cbsPreview && preview.cbsPreview.ok) {
        const cbsBody = preview.cbsPreview.output +
          (preview.cbsPreview.truncated ? '\n\n... (앞 2,000자까지만 시뮬레이션됨)' : '');
        bodyChildren.push(
          h(doc, 'details', { class: 'rh-preview-details', 'data-rh-details-key': `${cardKey}-cbs` },
            h(doc, 'summary', {}, '🧪 CBS 실행 결과 미리보기 (현재 채팅 기준 · 변수 미변경)'),
            h(doc, 'pre', { class: 'rh-preview-pre' }, cbsBody || '(빈 출력)')
          )
        );
      }
    }

    if (item.statusMessage) {
      const isFailure = item.statusMessage.startsWith('적용 실패') || item.statusMessage.startsWith('전송 실패');
      bodyChildren.push(
        h(doc, 'div', {
          style: `font-size:11.5px;color:${isFailure ? 'var(--rh-err-text)' : 'var(--rh-ok)'};font-weight:600;`,
        }, item.statusMessage)
      );
    }

    if (item.moduleSyncNotice) {
      bodyChildren.push(
        h(doc, 'div', { class: 'rh-banner' }, item.moduleSyncNotice)
      );
    }

    const leftControls = [];
    if (proposal.action === 'create_persona' || proposal.action === 'update_persona') {
      leftControls.push(
        h(doc, 'label', { style: 'font-size:11.5px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;' },
          h(doc, 'input', {
            type: 'checkbox',
            checked: item.bindToCurrentChat,
            onchange: (e) => { item.bindToCurrentChat = Boolean(e.target.checked); },
          }),
          '현재 채팅에 바인딩(즉시 반영)'
        )
      );
    }
    if (preview.ok && preview.createsGreeting && !item.applied) {
      leftControls.push(
        h(doc, 'label', { style: 'font-size:11.5px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;' },
          h(doc, 'input', {
            type: 'checkbox',
            checked: item.useInCurrentChat,
            onchange: (e) => { item.useInCurrentChat = Boolean(e.target.checked); },
          }),
          '현재 채팅에서 바로 사용 (이 채팅의 첫 메시지를 새 항목으로 전환)'
        )
      );
    }
    if (preview.ok && preview.createsModule && !item.applied) {
      leftControls.push(
        h(doc, 'label', { style: 'font-size:11.5px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;' },
          h(doc, 'input', {
            type: 'checkbox',
            checked: item.enableInCurrentChat,
            onchange: (e) => { item.enableInCurrentChat = Boolean(e.target.checked); },
          }),
          '현재 채팅에 바로 켜기'
        ),
        h(doc, 'label', { style: 'font-size:11.5px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;' },
          h(doc, 'input', {
            type: 'checkbox',
            checked: item.enableGlobally,
            onchange: (e) => { item.enableGlobally = Boolean(e.target.checked); },
          }),
          '전역 활성화'
        )
      );
    }
    if (preview.ok && preview.requiresConfirm && !item.applied) {
      leftControls.push(
        h(doc, 'label', { style: 'font-size:11.5px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:var(--rh-err-text);font-weight:600;' },
          h(doc, 'input', {
            type: 'checkbox',
            checked: item.destructiveConfirmed,
            onchange: (e) => {
              item.destructiveConfirmed = Boolean(e.target.checked);
              this.render();
            },
          }),
          preview.confirmLabel || '파괴적 변경 내용을 확인했습니다'
        )
      );
    }

    const rightControls = [];
    if (preview.ok && preview.after) {
      rightControls.push(
        h(doc, 'button', {
          class: 'rh-btn',
          onclick: () => this.copyText(preview.after),
        }, '복사')
      );
    }
    if (!preview.ok) {
      rightControls.push(
        h(doc, 'button', {
          class: 'rh-btn',
          disabled: this.busy,
          onclick: () => this.sendMessage(`방금 제안한 "${proposal.title || actionLabel}" 적용 검증에서 다음 오류가 발생했어:\n${preview.error}\n현재 원문을 기준으로 정확한 수정안을 다시 제안해 줘.`),
        }, '자동 재요청')
      );
    } else if (item.sent) {
      // Already sent via sendChat; copy button remains available.
    } else if (item.applied) {
      const syncTarget = item.pinnedTarget || preview.target;
      if (item.moduleDbSaved && this.tracker?.enabled && this._isModuleDomFillable(syncTarget, proposal)) {
        rightControls.push(
          h(doc, 'button', {
            class: 'rh-btn',
            onclick: async () => {
              const syncRes = await this.syncOpenModuleEditor(
                syncTarget,
                preview.after ?? this._moduleSyncText(this.activeSnapshot),
                { moduleId: item.hostBinding?.moduleId || preview.hostBinding?.moduleId || null }
              );
              if (syncRes.ok) {
                item.moduleDomSynced = true;
                item.moduleSyncNotice = syncRes.message;
                this.showToast('📝 입력칸 채우기 완료! tempModule 반영은 스페이스→백스페이스 1회');
              } else {
                item.moduleSyncNotice = syncRes.reason;
                this.showToast(syncRes.reason);
              }
              this.render();
            },
          }, item.moduleDomSynced ? '📝 다시 채우기' : '📝 입력칸에 채우기')
        );
      }
      if (item.undoId) {
        rightControls.push(
          h(doc, 'button', {
            class: 'rh-btn ok',
            title: '이 변경을 확정하고 되돌리기 단추를 제거합니다',
            onclick: () => this.commitUndoHistory({ undoId: item.undoId, label: item.proposal?.title || item.preview?.label }),
          }, '✓ 확정'),
          h(doc, 'button', {
            class: 'rh-btn danger',
            onclick: () => this.undoProposalItem(item),
          }, '되돌리기')
        );
      }
    } else {
      rightControls.push(
        h(doc, 'button', {
          class: isDelete ? 'rh-btn danger' : 'rh-btn primary',
          disabled: Boolean(preview.requiresConfirm && !item.destructiveConfirmed),
          onclick: () => this.applyProposalItem(item),
        }, isChatInputDraft ? '💬 채팅에 추가' : (isDelete ? '삭제 적용' : '적용'))
      );
      if (isChatInputDraft && typeof this.api.sendChat === 'function') {
        rightControls.push(
          h(doc, 'button', {
            class: 'rh-btn ok',
            title: '대필 내용을 현재 채팅에 유저 메시지로 전송하고 캐릭터의 다음 응답을 생성합니다',
            onclick: () => this.sendDraftProposalItem(item),
          }, '🚀 바로 전송')
        );
      }
    }

    return h(doc, 'div', { class: 'rh-proposal' },
      h(doc, 'div', { class: 'rh-proposal-head' },
        h(doc, 'span', { class: 'rh-proposal-title' }, proposal.title || preview.label || actionLabel),
        h(doc, 'span', { class: `rh-pill${isDelete ? ' danger' : ''}` }, actionLabel)
      ),
      h(doc, 'div', { class: 'rh-proposal-body' }, ...bodyChildren),
      h(doc, 'div', { class: 'rh-proposal-foot' },
        h(doc, 'div', { class: 'rh-row' }, ...leftControls),
        h(doc, 'div', { class: 'rh-row' }, ...rightControls)
      )
    );
  }

  _formatLoreOptionLabel(item) {
    if (item.mode === 'folder') {
      return `#${item.index + 1} 📁 ${item.comment || '(무제 폴더)'}`;
    }
    const prefix = item.orphaned
      ? '⚠️(숨겨짐) '
      : (item.folderName ? `[${item.folderName}] ` : '');
    const keyPart = item.key ? ` [${item.key.slice(0, 24)}]` : '';
    return `#${item.index + 1} ${prefix}${item.comment || '(무제)'}${keyPart}`;
  }

  renderSubItemPicker(ctx) {
    const doc = this.doc;
    if (!this.activeSnapshot?.ok) return null;

    if ((ctx.targetKind === 'char_lorebook' || ctx.targetKind === 'chat_lorebook') && Array.isArray(this.activeSnapshot.loreSummary)) {
      const sel = h(doc, 'select', {
        class: 'rh-select',
        onchange: async (e) => {
          const val = e.target.value;
          const base = this.manualTarget || { ...ctx };
          base.loreIndex = val === '' ? null : Number(val);
          this.manualTarget = base;
          await this.refreshContextSnapshot();
          this.render();
        },
      },
        h(doc, 'option', { value: '', selected: ctx.loreIndex === null || ctx.loreIndex === undefined }, '로어북 항목 선택 (미선택 시 전체/신규 생성)'),
        ...this.activeSnapshot.loreSummary.map(item =>
          h(doc, 'option', {
            value: String(item.index),
            selected: ctx.loreIndex === item.index,
          }, this._formatLoreOptionLabel(item))
        )
      );
      return sel;
    }

    if (ctx.targetKind === 'persona' && Array.isArray(this.activeSnapshot.personasSummary)) {
      return h(doc, 'select', {
        class: 'rh-select',
        onchange: async (e) => {
          const base = this.manualTarget || { ...ctx };
          base.personaIndex = Number(e.target.value);
          this.manualTarget = base;
          await this.refreshContextSnapshot();
          this.render();
        },
      },
        ...this.activeSnapshot.personasSummary.map(item =>
          h(doc, 'option', {
            value: String(item.index),
            selected: (ctx.personaIndex ?? this.activeSnapshot.selectedPersona) === item.index,
          }, `#${item.index + 1} ${item.name || '(무제)'}${item.selected ? ' (현재 선택됨)' : ''}`)
        )
      );
    }

    if (ctx.targetKind === 'char_alt_greeting' && Array.isArray(this.activeSnapshot.altGreetingsSummary) && this.activeSnapshot.altGreetingsSummary.length > 0) {
      // Nothing is selected until the user picks an item: a missing index must not look like #1.
      const snapIdx = this.activeSnapshot.target?.greetingIndex;
      const selectedIdx = Number.isInteger(ctx.greetingIndex) ? ctx.greetingIndex : (Number.isInteger(snapIdx) ? snapIdx : null);
      return h(doc, 'select', {
        class: 'rh-select',
        onchange: async (e) => {
          const base = this.manualTarget || { ...ctx };
          base.greetingIndex = e.target.value === '' ? null : Number(e.target.value);
          this.manualTarget = base;
          await this.refreshContextSnapshot();
          this.render();
        },
      },
        h(doc, 'option', { value: '', selected: selectedIdx === null },
          '고칠 항목 선택 (새로 만들려면 선택하지 말고 "새로 만들어줘"라고 요청)'),
        ...this.activeSnapshot.altGreetingsSummary.map(item =>
          h(doc, 'option', {
            value: String(item.index),
            selected: selectedIdx === item.index,
          }, `추가 첫 메시지 #${item.index + 1}${item.preview ? ` · ${item.preview}` : ' (비어 있음)'}`)
        )
      );
    }

    if (ctx.targetKind === 'chat_message' && Array.isArray(this.activeSnapshot.messagesSummary) && this.activeSnapshot.messagesSummary.length > 0) {
      const selectedIdx = ctx.messageIndex ?? this.activeSnapshot.target?.messageIndex;
      return h(doc, 'select', {
        class: 'rh-select',
        onchange: async (e) => {
          const base = this.manualTarget || { ...ctx };
          base.messageIndex = Number(e.target.value);
          this.manualTarget = base;
          await this.refreshContextSnapshot();
          this.render();
        },
      },
        ...this.activeSnapshot.messagesSummary.map(item =>
          h(doc, 'option', {
            value: String(item.index),
            selected: selectedIdx === item.index,
          }, `#${item.index + 1} [${item.role}] ${item.preview || '(비어 있음)'}`)
        )
      );
    }

    if (
      (ctx.targetKind === 'module_field' || ctx.targetKind === 'module_lorebook' || ctx.targetKind === 'module_lua' || ctx.targetKind === 'module_regex') &&
      Array.isArray(this.activeSnapshot.modulesSummary)
    ) {
      const selectedModIdx = ctx.moduleIndex ?? this.activeSnapshot.target?.moduleIndex ?? 0;
      const modSel = h(doc, 'select', {
        class: 'rh-select',
        onchange: async (e) => {
          const base = this.manualTarget || { ...ctx };
          base.moduleIndex = Number(e.target.value);
          if (ctx.targetKind === 'module_lorebook') base.loreIndex = null;
          if (ctx.targetKind === 'module_regex') base.regexIndex = null;
          delete base.moduleDomHints;
          this.manualTarget = base;
          await this.refreshContextSnapshot();
          this.render();
        },
      },
        ...this.activeSnapshot.modulesSummary.map(item =>
          h(doc, 'option', {
            value: String(item.index),
            selected: selectedModIdx === item.index,
          }, `${item.name || '(무제)'} (로어북 ${item.loreCount}개${item.enabled ? ', 활성' : ''})`)
        )
      );

      if (ctx.targetKind === 'module_lorebook' && Array.isArray(this.activeSnapshot.loreSummary)) {
        const selectedLoreIdx = ctx.loreIndex ?? this.activeSnapshot.target?.loreIndex ?? null;
        const loreSel = h(doc, 'select', {
          class: 'rh-select',
          onchange: async (e) => {
            const val = e.target.value;
            const base = this.manualTarget || { ...ctx };
            base.moduleIndex = selectedModIdx;
            base.loreIndex = val === '' ? null : Number(val);
            delete base.moduleDomHints;
            this.manualTarget = base;
            await this.refreshContextSnapshot();
            this.render();
          },
        },
          h(doc, 'option', { value: '', selected: selectedLoreIdx === null || selectedLoreIdx === undefined }, '모듈 로어북 항목 선택 (미선택 시 전체/신규 생성)'),
          ...this.activeSnapshot.loreSummary.map(item =>
            h(doc, 'option', {
              value: String(item.index),
              selected: selectedLoreIdx === item.index,
            }, this._formatLoreOptionLabel(item))
          )
        );
        return [modSel, loreSel];
      }

      return modSel;
    }
    return null;
  }

  renderSettingsPanel() {
    const doc = this.doc;
    return h(doc, 'div', { class: 'rh-settings-panel' },
      h(doc, 'div', { class: 'rh-settings-grid' },
        h(doc, 'div', { class: 'rh-field' },
          h(doc, 'span', {}, '사용 모델 (RisuAI 설정)'),
          h(doc, 'select', {
            class: 'rh-select',
            onchange: async (e) => {
              this.settings.modelMode = e.target.value;
              await this.saveSettings();
            },
          },
            h(doc, 'option', { value: 'model', selected: this.settings.modelMode === 'model' }, '메인 모델 (model)'),
            h(doc, 'option', { value: 'submodel', selected: this.settings.modelMode === 'submodel' }, '보조 모델 (submodel)'),
            h(doc, 'option', { value: 'otherAx', selected: this.settings.modelMode === 'otherAx' }, '기타 보조 모델 (otherAx)')
          )
        ),
        h(doc, 'div', { class: 'rh-field' },
          h(doc, 'span', {}, '응답 대기 제한 (초)'),
          h(doc, 'input', {
            class: 'rh-input',
            type: 'number',
            value: String(this.settings.timeoutSeconds),
            onchange: async (e) => {
              const v = Math.max(15, Math.min(600, Number(e.target.value) || 120));
              this.settings.timeoutSeconds = v;
              await this.saveSettings();
            },
          })
        ),
        h(doc, 'div', { class: 'rh-field' },
          h(doc, 'span', {}, '요청당 최대 LLM 호출 (읽기 도구 · 자동 수정)'),
          h(doc, 'select', {
            class: 'rh-select',
            'data-setting': 'maxLlmCalls',
            onchange: async (e) => {
              this.settings.maxLlmCalls = normalizeMaxCalls(e.target.value);
              await this.saveSettings();
              this.render();
            },
          },
            h(doc, 'option', { value: '1', selected: normalizeMaxCalls(this.settings.maxLlmCalls) === 1 }, '1회 (단일 호출 · 빠름)'),
            h(doc, 'option', { value: '2', selected: normalizeMaxCalls(this.settings.maxLlmCalls) === 2 }, '2회 (조회 또는 자동 수정 1회)'),
            h(doc, 'option', { value: '3', selected: normalizeMaxCalls(this.settings.maxLlmCalls) === 3 }, '3회 (기본 · 조회 + 분석 + 자동 수정)')
          )
        ),
        h(doc, 'div', { class: 'rh-field' },
          h(doc, 'span', {}, '모델에 보내는 원문 길이 (초과분은 잘리고 전체 덮어쓰기가 막힘)'),
          h(doc, 'select', {
            class: 'rh-select',
            onchange: async (e) => {
              this.settings.maxContentChars = Number(e.target.value);
              this.applyContentLimit();
              await this.saveSettings();
              await this.refreshContextSnapshot();
              this.render();
            },
          },
            ...MAX_CONTENT_CHAR_OPTIONS.map(n =>
              h(doc, 'option', { value: String(n), selected: this.settings.maxContentChars === n },
                `${n.toLocaleString()}자${n === DEFAULT_MAX_CONTENT_CHARS ? ' (기본)' : n === MAX_CONTENT_CHAR_OPTIONS[0] ? ' (컨텍스트가 작은 모델용)' : ''}`)
            )
          )
        ),
        h(doc, 'div', { class: 'rh-field' },
          h(doc, 'span', {}, '어시스턴트 총 요청 예산 (RisuAI 채팅 컨텍스트와 별도)'),
          h(doc, 'select', {
            class: 'rh-select',
            'data-setting': 'maxRequestChars',
            onchange: async (e) => {
              this.settings.maxRequestChars = Number(e.target.value);
              this.applyContentLimit();
              await this.saveSettings();
              this.render();
            },
          },
            ...MAX_REQUEST_CHAR_OPTIONS.map(n =>
              h(doc, 'option', { value: String(n), selected: this.settings.maxRequestChars === n },
                `${n.toLocaleString()}자${n === DEFAULT_MAX_REQUEST_CHARS ? ' (기본)' : ''}`)
            )
          )
        ),
        h(doc, 'div', { class: 'rh-field' },
          h(doc, 'span', {}, '계획형 파이프라인 최대 호출 (대용량 개편 · 일괄 작업)'),
          h(doc, 'select', {
            class: 'rh-select',
            'data-setting': 'maxPipelineCalls',
            onchange: async (e) => {
              this.settings.maxPipelineCalls = Number(e.target.value);
              this.applyContentLimit();
              await this.saveSettings();
              this.render();
            },
          },
            ...PIPELINE_CALL_LIMIT_OPTIONS.map(n =>
              h(doc, 'option', { value: String(n), selected: this.settings.maxPipelineCalls === n },
                `최대 ${n}회${n === DEFAULT_PIPELINE_LIMITS.maxTotalCalls ? ' (기본)' : ''}`)
            )
          )
        ),
        h(doc, 'div', { class: 'rh-field' },
          h(doc, 'span', {}, '긴 대화 자동 요약 기준 (초과 시 이전 턴 자동 압축)'),
          h(doc, 'select', {
            class: 'rh-select',
            'data-setting': 'compactThresholdChars',
            onchange: async (e) => {
              this.settings.compactThresholdChars = Number(e.target.value);
              this.applyContentLimit();
              await this.saveSettings();
              this.render();
            },
          },
            ...COMPACT_THRESHOLD_CHAR_OPTIONS.map(n =>
              h(doc, 'option', { value: String(n), selected: this.settings.compactThresholdChars === n },
                `${n.toLocaleString()}자${n === DEFAULT_COMPACT_THRESHOLD_CHARS ? ' (기본)' : ''}`)
            )
          )
        )
      ),
      h(doc, 'div', { class: 'rh-checks', style: 'margin-bottom:8px;' },
        h(doc, 'label', {},
          h(doc, 'input', {
            type: 'checkbox',
            'data-setting': 'confirmLargePlan',
            checked: this.settings.confirmLargePlan !== false,
            onchange: async (e) => {
              this.settings.confirmLargePlan = Boolean(e.target.checked);
              await this.saveSettings();
              this.render();
            },
          }),
          '4회 이상 대용량 다단계 작업 시작 전 확인창 표시 (권장)'
        ),
        h(doc, 'label', {},
          h(doc, 'input', {
            type: 'checkbox',
            'data-setting': 'autoCompactChat',
            checked: this.settings.autoCompactChat !== false,
            onchange: async (e) => {
              this.settings.autoCompactChat = Boolean(e.target.checked);
              await this.saveSettings();
              this.render();
            },
          }),
          '대화가 길어지면 이전 대화 자동 요약 (최근 4건 원문 유지)'
        )
      ),
      h(doc, 'div', { class: 'rh-field' },
        h(doc, 'span', {}, 'PC 오른쪽 상시 도킹 (선택 · RisuAI 화면 동시 조작 + 실시간 커서 추적)'),
        h(doc, 'div', { class: 'rh-checks' },
          h(doc, 'label', {},
            h(doc, 'input', {
              type: 'checkbox',
              checked: this.settings.dockMode,
              onchange: async (e) => {
                await this.toggleDockMode(Boolean(e.target.checked));
              },
            }),
            'PC 화면에서 오른쪽 도킹 모드 사용 (mainDom 필요)'
          ),
          this.settings.dockMode && h(doc, 'label', {},
            h(doc, 'input', {
              type: 'checkbox',
              checked: this.settings.autoOpenDocked,
              onchange: async (e) => {
                this.settings.autoOpenDocked = Boolean(e.target.checked);
                await this.saveSettings();
                this.render();
              },
            }),
            'PC에서 시작 시 오른쪽에 자동으로 띄우기'
          ),
          this.settings.dockMode && h(doc, 'label', {},
            h(doc, 'input', {
              type: 'checkbox',
              checked: this.settings.dockPushLayout,
              onchange: async (e) => {
                this.settings.dockPushLayout = Boolean(e.target.checked);
                await this.saveSettings();
                await this._applyLiveDockSettings();
                this.render();
              },
            }),
            'RisuAI 화면 자동 분할 (오른쪽 사이드바가 가려지지 않게 폭 조정)'
          )
        ),
        this.settings.dockMode && h(doc, 'div', { class: 'rh-row', style: 'flex-wrap:wrap;gap:6px;margin-top:4px;' },
          ...[
            { label: '좁게 (360px)', w: 360 },
            { label: '표준 (420px)', w: 420 },
            { label: '넓게 (500px)', w: 500 },
          ].map(opt => h(doc, 'button', {
            class: `rh-btn${Number(this.settings.dockWidth) === opt.w ? ' primary' : ''}`,
            onclick: async () => {
              this.settings.dockWidth = opt.w;
              await this.saveSettings();
              await this._applyLiveDockSettings();
              this.showToast(`도킹 패널 폭을 ${opt.w}px로 변경했습니다.`);
            },
          }, opt.label))
        )
      ),
      h(doc, 'div', { class: 'rh-row', style: 'justify-content:space-between;' },
        h(doc, 'div', { class: 'rh-checks' },
          h(doc, 'label', {},
            h(doc, 'input', {
              type: 'checkbox',
              checked: this.settings.showFloatingChip,
              onchange: async (e) => {
                this.settings.showFloatingChip = Boolean(e.target.checked);
                await this.saveSettings();
                await this.tracker.setChipVisible(this.settings.showFloatingChip);
                this.render();
              },
            }),
            '화면에 플로팅 버튼 표시 (드래그 이동 가능 · mainDom 필요)'
          ),
          h(doc, 'label', {},
            h(doc, 'input', {
              type: 'checkbox',
              checked: this.settings.showDetectDiagnostics,
              onchange: async (e) => {
                this.settings.showDetectDiagnostics = Boolean(e.target.checked);
                this.tracker.diagnostics = this.settings.showDetectDiagnostics;
                await this.saveSettings();
                if (this.tracker.enabled) await this.tracker.scanNow({ force: true });
                this.render();
              },
            }),
            '감지 근거 표시 (대상이 잘못 잡힐 때 원인 확인용)'
          ),
          h(doc, 'label', {},
            h(doc, 'input', {
              type: 'checkbox',
              checked: this.settings.autoFillModuleEditor,
              onchange: async (e) => {
                this.settings.autoFillModuleEditor = Boolean(e.target.checked);
                await this.saveSettings();
                this.render();
              },
            }),
            '모듈 적용/되돌리기 시 열려 있는 본문 입력칸에 자동 채우기 (반영 후 스페이스→백스페이스 1회 필요)'
          ),
          h(doc, 'label', {},
            h(doc, 'input', {
              type: 'checkbox',
              checked: this.settings.autoRestoreExtensions !== false,
              onchange: async (e) => {
                this.settings.autoRestoreExtensions = Boolean(e.target.checked);
                await this.saveSettings();
                this.showToast(this.settings.autoRestoreExtensions
                  ? '시작 시 승인된 상주 확장을 자동 복원합니다.'
                  : '안전 모드: 다음 시작 시 상주 확장을 자동 복원하지 않습니다.');
                this.render();
              },
            }),
            '시작 시 승인된 상주 확장 자동 복원 (끄면 안전 모드)'
          )
        )
      ),
      this.settings.showFloatingChip && h(doc, 'div', { class: 'rh-field' },
        h(doc, 'span', {}, '플로팅 버튼 빠른 위치 이동 (다른 플러그인과 겹칠 때 · 직접 드래그도 가능)'),
        h(doc, 'div', { class: 'rh-row', style: 'flex-wrap:wrap;gap:6px;' },
          ...[
            { label: '↖ 좌상', pos: { anchor: 'tl' } },
            { label: '↗ 우상', pos: { anchor: 'tr' } },
            { label: '← 좌중앙', pos: { anchor: 'ml' } },
            { label: '→ 우중앙', pos: { anchor: 'mr' } },
            { label: '↙ 좌하', pos: { anchor: 'bl' } },
            { label: '↘ 우하 (기본)', pos: null },
          ].map(preset => {
            const cur = this.settings.floatingChipPos;
            const isActive = preset.pos === null
              ? (!cur || cur.anchor === 'br')
              : (cur?.anchor === preset.pos.anchor);
            return h(doc, 'button', {
              class: `rh-btn${isActive ? ' primary' : ''}`,
              onclick: async () => {
                this.settings.floatingChipPos = preset.pos;
                await this.saveSettings();
                await this.tracker.setChipPosition(preset.pos);
                this.showToast(`플로팅 버튼을 ${preset.label} 위치로 옮겼습니다.`);
              },
            }, preset.label);
          })
        )
      )
    );
  }

  renderMenuPanel(ctx, flavor) {
    const doc = this.doc;
    const otherChats = this.chatList.filter(c => !c.current);
    const refIndex = this.referenceChat?.index ?? null;
    const statusText = this.isDocked
      ? `RisuHelper v${VERSION} · 실시간 도킹 · ${flavor.name}`
      : `RisuHelper v${VERSION} · ${flavor.name} · ${this.tracker.enabled ? '커서 자동감지 활성' : '수동 대상 모드'}`;

    const children = [
      h(doc, 'div', { class: 'rh-row', style: 'justify-content:space-between;' },
        h(doc, 'div', { class: 'rh-subtitle', style: 'display:flex;align-items:center;' },
          this.isDocked && h(doc, 'span', { class: 'rh-live-dot' }),
          statusText
        ),
        h(doc, 'span', { class: 'rh-pill' },
          this.presetState.mode === 'preset'
            ? (this.presetState.preset ? `프리셋: ${this.presetState.preset.name}` : '프리셋 미설정')
            : `모델: ${this.settings.modelMode}`
        )
      ),
      h(doc, 'div', { class: 'rh-actions' },
        h(doc, 'button', {
          class: `rh-btn${this.conversationsPanelOpen ? ' primary' : ''}`,
          onclick: () => {
            this.conversationsPanelOpen = !this.conversationsPanelOpen;
            if (this.conversationsPanelOpen) {
              this.menuOpen = false;
              this.settingsOpen = false;
              this.presetPanelOpen = false;
              this.extensionsPanelOpen = false;
            }
            this.render();
          },
        }, `📚 저장된 대화 (${this.conversationStore.conversations.length})`),
        h(doc, 'button', {
          class: `rh-btn${this.presetPanelOpen ? ' primary' : ''}`,
          onclick: async () => {
            this.presetPanelOpen = !this.presetPanelOpen;
            if (this.presetPanelOpen) {
              this.menuOpen = false;
              this.settingsOpen = false;
              this.conversationsPanelOpen = false;
              this.extensionsPanelOpen = false;
              if (this.presetState.pane === 'preview') await this.refreshPresetPreview();
            }
            this.render();
          },
        }, this.presetState.mode === 'preset' ? '프리셋 · 적용' : '프리셋 · 직접'),
        h(doc, 'button', {
          class: `rh-btn${this.isDocked ? ' primary' : ' rh-hide-mobile'}`,
          onclick: () => this.toggleDockMode(),
        }, this.isDocked ? '📌 도킹 해제' : '📌 오른쪽 도킹'),
        !this.isDocked && h(doc, 'button', {
          class: 'rh-btn rh-hide-mobile',
          onclick: async () => {
            this.settings.wideMode = !this.settings.wideMode;
            await this.saveSettings();
            this.render();
          },
        }, this.settings.wideMode ? '좁게' : '넓게'),
        h(doc, 'button', {
          class: 'rh-btn',
          onclick: async () => {
            if (!this.tracker.enabled) await this.tracker.start();
            await this.tracker.scanNow({ force: true });
            this.manualTarget = null;
            await this.refreshContextSnapshot({ forceChatList: true });
            this.showToast(this.detectedContext ? `감지됨: ${this.detectedContext.labelText}` : '현재 포커스된 입력칸이 없습니다.');
          },
        }, '커서 재감지'),
        typeof this.api?.getFetchLogs === 'function' && h(doc, 'button', {
          class: `rh-btn${this.attachedFetchLog ? ' primary' : ''}`,
          title: 'RisuAI의 가장 최근 LLM 요청/응답 로그 1건을 민감정보 마스킹 후 다음 질문에 1회만 첨부합니다 (자동 전송 안 함)',
          onclick: async () => {
            if (this.attachedFetchLog) {
              this.attachedFetchLog = null;
              this.showToast('첨부된 요청 로그를 해제했습니다.');
            } else {
              await this.attachLatestFetchLog();
            }
          },
        }, this.attachedFetchLog ? '🔍 요청 로그 해제' : '🔍 최근 요청 로그 첨부'),
        h(doc, 'button', {
          class: `rh-btn${this.extensionsPanelOpen ? ' primary' : ''}`,
          title: '사용자가 승인한 선언형 상주 확장 규칙을 켜고 끄거나 드라이런으로 점검합니다',
          onclick: () => {
            this.extensionsPanelOpen = !this.extensionsPanelOpen;
            if (this.extensionsPanelOpen) {
              this.menuOpen = false;
              this.presetPanelOpen = false;
              this.settingsOpen = false;
              this.conversationsPanelOpen = false;
            }
            this.render();
          },
        }, `🧩 상주 확장 (${this.adapter.extensionRuntime?.list?.().filter(r => r.enabled).length || 0})`),
        h(doc, 'button', {
          class: 'rh-btn',
          title: '고아 로어북·깨진 정규식·Lua·CBS·누락 에셋·채팅 폴더를 읽기 전용으로 일괄 점검합니다',
          onclick: async () => {
            await this.runWorkspaceAuditUi();
          },
        }, '🩺 건강검진'),
        this.adapter._chatPanelState && h(doc, 'button', {
          class: 'rh-btn danger',
          onclick: async () => {
            try {
              await this.adapter.applyProposal({ action: 'set_chat_panel', clear: true, title: '채팅 HUD 닫기' }, null);
              this.showToast('채팅 HUD 패널을 닫았습니다.');
              this.render();
            } catch (err) {
              this.showToast(err?.message || 'HUD 닫기 실패');
            }
          },
        }, '✕ HUD 닫기'),
        h(doc, 'button', {
          class: 'rh-btn',
          title: '현재 워크스페이스 진단 리포트를 마크다운 파일로 저장합니다',
          onclick: async () => {
            await this.exportAuditReport();
          },
        }, '💾 진단 리포트 저장')
      ),
      h(doc, 'div', { class: 'rh-row', style: 'justify-content:space-between;' },
        h(doc, 'span', { class: 'rh-menu-section-label' }, '전송 모드'),
        h(doc, 'div', { class: 'rh-seg' },
          h(doc, 'button', {
            class: `rh-seg-btn${this.presetState.mode === 'direct' ? ' active' : ''}`,
            onclick: async () => {
              this.presetState.mode = 'direct';
              await this.savePresetState();
              this.showToast('직접 보내기 모드');
            },
          }, '직접 보내기'),
          h(doc, 'button', {
            class: `rh-seg-btn${this.presetState.mode === 'preset' ? ' active' : ''}`,
            onclick: async () => {
              this.presetState.mode = 'preset';
              await this.savePresetState();
              if (!this.presetState.preset) {
                this.menuOpen = false;
                this.presetPanelOpen = true;
                this.showToast('프리셋 파일을 먼저 가져오세요.');
              } else {
                this.showToast(`프리셋 적용 모드 (${this.presetState.preset.name})`);
              }
            },
          }, '프리셋 적용')
        )
      ),
      h(doc, 'div', { class: 'rh-checks' },
        h(doc, 'label', {},
          h(doc, 'input', {
            type: 'checkbox',
            checked: this.settings.includeCharSummary,
            onchange: async (e) => { this.settings.includeCharSummary = Boolean(e.target.checked); await this.saveSettings(); },
          }),
          '캐릭터 요약 참고'
        ),
        h(doc, 'label', {},
          h(doc, 'input', {
            type: 'checkbox',
            checked: this.settings.includeLoreSummary,
            onchange: async (e) => { this.settings.includeLoreSummary = Boolean(e.target.checked); await this.saveSettings(); },
          }),
          '로어북 목록 참고'
        ),
        h(doc, 'label', {},
          h(doc, 'input', {
            type: 'checkbox',
            checked: this.settings.includeConfigSummary,
            onchange: async (e) => { this.settings.includeConfigSummary = Boolean(e.target.checked); await this.saveSettings(); },
          }),
          '현재 설정값 참고'
        )
      ),
    ];

    if (this.chatList.length > 1 && otherChats.length > 0) {
      children.push(
        h(doc, 'div', { class: 'rh-row' },
          h(doc, 'select', {
            class: 'rh-select rh-ref-chat',
            title: '같은 캐릭터의 다른 채팅을 참고 자료로 붙입니다 (요약·이사용). 변경은 항상 지금 열려 있는 채팅에만 적용됩니다.',
            onchange: (e) => {
              this.setReferenceChat(e.target.value === '' ? null : Number(e.target.value));
              this.render();
            },
          },
            h(doc, 'option', { value: '', selected: refIndex === null }, '참조 채팅: 없음 (다른 채팅에서 요약·이사할 때 선택)'),
            ...otherChats.map(c =>
              h(doc, 'option', { value: String(c.index), selected: c.index === refIndex },
                `참조 채팅: ${c.index + 1}번 · ${c.name}${c.coldStored ? ' (콜드 스토리지 보관 중)' : c.messages !== null ? ` (메시지 ${c.messages}개)` : ''}`)
            )
          )
        )
      );
      if (refIndex !== null) {
        const info = this.referenceInfo?.index === refIndex ? this.referenceInfo : null;
        let line = `${refIndex + 1}번 채팅의 작가의 노트·변수·대화 내용을 요청마다 함께 보냅니다 (대화는 원문 입력 한도 ${this.settings.maxContentChars.toLocaleString()}자까지, 최근 메시지 우선). 다 쓰면 "없음"으로 되돌리세요.`;
        if (info?.error) {
          line = `참조 채팅을 읽지 못했습니다: ${info.error}`;
        } else if (info) {
          line = `최근 요청에 ${refIndex + 1}번 채팅의 메시지 ${info.messageCount}개 중 ${info.sent}개(${info.chars.toLocaleString()}자)를 보냈습니다.` +
            (info.omitted > 0
              ? ` 앞쪽 ${info.omitted}개는 한도를 넘어 빠졌습니다${info.hasMemory ? '(RisuAI가 만들어 둔 메모리 요약으로 대신함)' : ''}. 더 보내려면 설정에서 원문 입력 한도를 올리세요.`
              : '') +
            ' 다 쓰면 "없음"으로 되돌리세요.';
        }
        children.push(
          h(doc, 'div', { class: info?.error || info?.omitted > 0 ? 'rh-banner' : '', style: info?.error || info?.omitted > 0 ? '' : 'font-size:11.5px;color:var(--rh-muted);' }, line)
        );
      }
    }

    if (ctx.freeTalk) {
      children.push(
        h(doc, 'div', { style: 'font-size:11px;color:var(--rh-muted);line-height:1.4;' },
          '자유대화 — 입력칸을 선택하지 않은 상태입니다. 무엇을 고칠지 말로 요청하거나, 특정 칸을 클릭·선택해 편집하세요.' +
          (ctx.screenHint ? ` (화면 힌트: ${ctx.screenHint})` : ''))
      );
    } else if (ctx.targetKind === 'chat_input' && this.activeSnapshot?.ok && this.activeSnapshot.chatContext) {
      const cc = this.activeSnapshot.chatContext;
      const turnSummary = cc.messageCount > 0
        ? `현재 채팅 최근 ${cc.transcript.length}/${cc.messageCount}개 메시지(${cc.transcriptChars.toLocaleString()}자)${cc.omittedMessages > 0 ? (cc.memorySummaries.length > 0 ? ' + 기존 메모리 요약' : ' · 앞부분 생략') : ''}`
        : '현재 채팅 첫 메시지 기준';
      children.push(
        h(doc, 'div', { style: 'font-size:11px;color:var(--rh-muted);line-height:1.4;' },
          `💬 유저 대필 모드 — ${turnSummary}를 참고해 다음 유저 응답을 작성합니다. (미전송 초안은 여기에 붙여넣어 다듬기를 요청하세요)`)
      );
    }

    return h(doc, 'div', { class: 'rh-menu-panel' }, ...children);
  }

  renderConversationBar() {
    const doc = this.doc;
    const savedCount = this.conversationStore.conversations.length;
    const displayTitle = this.conversationTitle || deriveConversationTitle(this.messages, '새 대화');
    const uncompacted = measureUncompactedMessages(this.messages, this.conversationCompactedCount);
    const canCompact = uncompacted.count >= 4;

    let titleArea;
    if (this.editingTitle) {
      const titleInput = h(doc, 'input', {
        class: 'rh-conv-title-input',
        type: 'text',
        placeholder: '대화 제목 입력 (비우면 자동 제목)',
        value: this.conversationCustomTitle ? this.conversationTitle : displayTitle,
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.setCurrentConversationTitle(titleInput.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            this.editingTitle = false;
            this.render();
          }
        },
      });
      titleArea = h(doc, 'div', { class: 'rh-conv-title-area' },
        titleInput,
        h(doc, 'button', {
          class: 'rh-btn primary',
          onclick: () => this.setCurrentConversationTitle(titleInput.value),
        }, '저장'),
        h(doc, 'button', {
          class: 'rh-btn ghost',
          onclick: () => {
            this.editingTitle = false;
            this.render();
          },
        }, '취소')
      );
    } else {
      titleArea = h(doc, 'div', { class: 'rh-conv-title-area' },
        h(doc, 'button', {
          class: 'rh-conv-title-btn',
          title: '클릭하여 대화 제목 설정·변경',
          onclick: () => {
            this.editingTitle = true;
            this.render();
            const inp = this.doc.querySelector('.rh-conv-title-input');
            inp?.focus?.();
            inp?.select?.();
          },
        }, `${displayTitle} ✏️`)
      );
    }

    return h(doc, 'div', { class: 'rh-conv-bar' },
      h(doc, 'button', {
        class: `rh-btn rh-conv-list-btn${this.conversationsPanelOpen ? ' primary' : ' ghost'}`,
        title: '저장된 대화 목록 열기 / 불러오기',
        onclick: () => {
          this.conversationsPanelOpen = !this.conversationsPanelOpen;
          if (this.conversationsPanelOpen) {
            this.menuOpen = false;
            this.settingsOpen = false;
            this.presetPanelOpen = false;
            this.extensionsPanelOpen = false;
          }
          this.render();
        },
      }, `📚 대화 (${savedCount})`),
      titleArea,
      canCompact && h(doc, 'button', {
        class: 'rh-btn ghost rh-compact-btn',
        disabled: this.busy,
        title: `이전 대화를 요약하고 최신 턴만 원문 유지 (현재 미요약 ${uncompacted.count}건 · ${uncompacted.chars.toLocaleString()}자)`,
        onclick: () => this.compactCurrentConversation({ manual: true }),
      }, '🗜️ 요약'),
      h(doc, 'button', {
        class: 'rh-btn ghost rh-new-conv-btn',
        disabled: this.busy,
        title: '현재 대화를 저장하고 새 대화를 시작합니다',
        onclick: () => this.startNewConversation({ saveCurrent: true, toast: '새 대화를 시작했습니다.' }),
      }, '+ 새 대화')
    );
  }

  renderConversationsPanel() {
    const doc = this.doc;
    const total = this.conversationStore.conversations.length;
    const listEl = h(doc, 'div', { class: 'rh-conv-list' });

    const populateList = () => {
      listEl.textContent = '';
      const filtered = filterAndSortConversations(this.conversationStore, this.conversationSearchQuery);
      if (filtered.length === 0) {
        listEl.appendChild(
          h(doc, 'div', { style: 'font-size:12px;color:var(--rh-muted);padding:10px 4px;text-align:center;' },
            total === 0
              ? '저장된 대화가 아직 없습니다. 메시지를 보내면 자동으로 저장됩니다.'
              : '검색 결과와 일치하는 대화가 없습니다.'
          )
        );
        return;
      }

      for (const conv of filtered) {
        const isActive = conv.id === this.activeConversationId;
        if (this.editingListTitleId === conv.id) {
          const inp = h(doc, 'input', {
            class: 'rh-conv-title-input',
            type: 'text',
            value: conv.title,
            placeholder: '대화 제목 입력',
            onclick: (e) => e.stopPropagation(),
            onkeydown: (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                this.renameSavedConversation(conv.id, inp.value);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                this.editingListTitleId = null;
                this.render();
              }
            },
          });
          listEl.appendChild(
            h(doc, 'div', { class: `rh-conv-item${isActive ? ' active' : ''}`, 'data-conv-id': conv.id },
              inp,
              h(doc, 'button', {
                class: 'rh-btn primary',
                onclick: (e) => { e.stopPropagation(); this.renameSavedConversation(conv.id, inp.value); },
              }, '저장'),
              h(doc, 'button', {
                class: 'rh-btn ghost',
                onclick: (e) => { e.stopPropagation(); this.editingListTitleId = null; this.render(); },
              }, '취소')
            )
          );
          continue;
        }

        const metaParts = [`메시지 ${(conv.messages || []).length}개`];
        if (conv.compactedCount > 0 && conv.summary) metaParts.push(`🗜️ 요약(${conv.compactedCount})`);
        if (conv.charHint) metaParts.push(conv.charHint);
        const rel = formatRelativeTime(conv.updatedAt);
        if (rel) metaParts.push(rel);

        listEl.appendChild(
          h(doc, 'div', {
            class: `rh-conv-item${isActive ? ' active' : ''}`,
            'data-conv-id': conv.id,
            onclick: () => this.loadConversationById(conv.id),
          },
            h(doc, 'div', { class: 'rh-conv-item-main' },
              h(doc, 'div', { class: 'rh-conv-item-title' }, `${conv.pinned ? '📌 ' : ''}${conv.title}`),
              h(doc, 'div', { class: 'rh-conv-item-meta' }, metaParts.join(' · '))
            ),
            h(doc, 'div', { class: 'rh-conv-item-actions' },
              h(doc, 'button', {
                class: 'rh-conv-icon-btn',
                'data-conv-action': 'pin',
                title: conv.pinned ? '상단 고정 해제' : '상단 고정',
                onclick: (e) => { e.stopPropagation(); this.togglePinSavedConversation(conv.id); },
              }, conv.pinned ? '📌' : '📍'),
              h(doc, 'button', {
                class: 'rh-conv-icon-btn',
                'data-conv-action': 'rename',
                title: '제목 변경',
                onclick: (e) => {
                  e.stopPropagation();
                  this.editingListTitleId = conv.id;
                  this.render();
                },
              }, '✏️'),
              h(doc, 'button', {
                class: 'rh-conv-icon-btn',
                'data-conv-action': 'export',
                title: '마크다운(.md)으로 내보내기',
                onclick: (e) => { e.stopPropagation(); this.exportSavedConversation(conv.id); },
              }, '📤'),
              h(doc, 'button', {
                class: 'rh-conv-icon-btn danger',
                'data-conv-action': 'delete',
                title: '대화 삭제',
                onclick: (e) => { e.stopPropagation(); this.deleteSavedConversation(conv.id); },
              }, '🗑️')
            )
          )
        );
      }
    };

    populateList();

    return h(doc, 'div', { class: 'rh-conv-panel' },
      h(doc, 'div', { class: 'rh-conv-panel-head' },
        h(doc, 'strong', { style: 'font-size:12.5px;' }, `📚 저장된 대화 (${total}개)`),
        h(doc, 'div', { class: 'rh-row', style: 'gap:6px;' },
          h(doc, 'button', {
            class: 'rh-btn primary',
            disabled: this.busy,
            onclick: () => this.startNewConversation({ saveCurrent: true, toast: '새 대화를 시작했습니다.' }),
          }, '+ 새 대화'),
          h(doc, 'button', {
            class: 'rh-btn ghost',
            onclick: () => {
              this.conversationsPanelOpen = false;
              this.editingListTitleId = null;
              this.render();
            },
          }, '닫기')
        )
      ),
      h(doc, 'input', {
        class: 'rh-conv-search',
        type: 'search',
        placeholder: '대화 제목 · 내용 · 요약 · 캐릭터 검색...',
        value: this.conversationSearchQuery,
        oninput: (e) => {
          this.conversationSearchQuery = e.target.value;
          populateList();
        },
      }),
      listEl
    );
  }

  renderCompactionCard() {
    const doc = this.doc;
    const uncompacted = measureUncompactedMessages(this.messages, this.conversationCompactedCount);
    const body = h(doc, 'div', { class: 'rh-compaction-body' });

    if (this.editingSummary) {
      const ta = h(doc, 'textarea', {
        class: 'rh-compaction-textarea',
        value: this.conversationSummary,
      });
      body.appendChild(ta);
      body.appendChild(
        h(doc, 'div', { class: 'rh-row', style: 'gap:6px;justify-content:flex-end;' },
          h(doc, 'button', {
            class: 'rh-btn ghost',
            onclick: () => {
              this.editingSummary = false;
              this.render();
            },
          }, '취소'),
          h(doc, 'button', {
            class: 'rh-btn primary',
            onclick: () => this.updateCurrentConversationSummary(ta.value),
          }, '요약 저장')
        )
      );
    } else {
      const summaryBox = h(doc, 'div', { class: 'rh-msg-body' });
      renderMarkdown(doc, summaryBox, this.conversationSummary, {
        onCopy: (codeText) => this.copyText(codeText),
      });
      body.appendChild(summaryBox);
      body.appendChild(
        h(doc, 'div', { class: 'rh-row', style: 'gap:6px;flex-wrap:wrap;' },
          h(doc, 'button', {
            class: 'rh-btn',
            onclick: () => {
              this.editingSummary = true;
              this.render();
            },
          }, '✏️ 요약 편집'),
          uncompacted.count >= 4 && h(doc, 'button', {
            class: 'rh-btn',
            disabled: this.busy,
            onclick: () => this.compactCurrentConversation({ manual: true }),
          }, '↻ 추가 요약'),
          h(doc, 'button', {
            class: 'rh-btn ghost',
            onclick: () => this.copyText(this.conversationSummary),
          }, '복사'),
          h(doc, 'button', {
            class: 'rh-btn danger',
            onclick: () => this.clearCurrentConversationSummary(),
          }, '✕ 요약 해제')
        )
      );
    }

    const timeText = this.conversationCompactedAt ? formatRelativeTime(this.conversationCompactedAt) : '';
    return h(doc, 'details', {
      class: 'rh-compaction-card',
      'data-rh-details-key': 'compaction-summary',
      open: this.editingSummary ? true : undefined,
    },
      h(doc, 'summary', {},
        h(doc, 'span', {}, `🗜️ 이전 대화 ${this.conversationCompactedCount}건 요약됨 · 후속 요청은 이 요약 + 최근 원문 사용`),
        timeText && h(doc, 'span', { style: 'font-size:10.5px;color:var(--rh-muted);font-weight:400;' }, timeText)
      ),
      body
    );
  }

  renderUserMessageAttachments(attachments) {
    const list = Array.isArray(attachments) ? attachments.filter(Boolean) : [];
    if (list.length === 0) return null;
    const doc = this.doc;
    const images = list.filter(a => a.kind === 'image');
    const files = list.filter(a => a.kind !== 'image');

    const children = [];
    if (images.length > 0) {
      children.push(
        h(doc, 'div', { class: 'rh-msg-img-grid' },
          ...images.map(img => {
            const src = img.base64 || img.thumbDataUrl || '';
            const dims = img.width && img.height ? `${img.width}×${img.height}` : '';
            const metaText = [dims, img.sizeBytes ? formatFileSize(img.sizeBytes) : '', (!img.base64 && img.imageOmittedFromStorage) ? '저장 썸네일' : '']
              .filter(Boolean)
              .join(' · ');
            if (src) {
              return h(doc, 'button', {
                type: 'button',
                class: 'rh-msg-img-card',
                title: `${img.name || 'image'}${metaText ? ` (${metaText})` : ''} — 클릭해 크게 보기`,
                onclick: (e) => {
                  e.stopPropagation();
                  this.openImageLightbox(img);
                },
              },
                h(doc, 'img', { class: 'rh-msg-img', src, alt: img.name || 'attached image' }),
                h(doc, 'span', { class: 'rh-msg-img-cap' }, img.name || 'image')
              );
            }
            return h(doc, 'div', { class: 'rh-msg-file-chip' },
              h(doc, 'span', {}, '🖼️'),
              h(doc, 'span', { class: 'rh-msg-file-name' }, img.name || 'image'),
              h(doc, 'span', { class: 'rh-msg-file-meta' }, metaText || '이전 세션 이미지')
            );
          })
        )
      );
    }

    if (files.length > 0) {
      children.push(
        h(doc, 'div', { class: 'rh-msg-file-list' },
          ...files.map(file => {
            const meta = [
              file.lines ? `${file.lines.toLocaleString()}줄` : '',
              file.sizeBytes ? formatFileSize(file.sizeBytes) : '',
              file.truncated ? '일부' : '',
            ].filter(Boolean).join(' · ');
            if (file.content) {
              const previewText = file.content.length > 4000
                ? `${file.content.slice(0, 4000)}\n... (총 ${file.content.length.toLocaleString()}자 중 앞 4,000자 미리보기)`
                : file.content;
              return h(doc, 'details', {
                class: 'rh-msg-file-details',
                'data-rh-details-key': `att-${file.id || file.name}`,
              },
                h(doc, 'summary', { class: 'rh-msg-file-chip' },
                  h(doc, 'span', {}, attachmentIcon(file)),
                  h(doc, 'span', { class: 'rh-msg-file-name' }, file.name || 'file'),
                  meta && h(doc, 'span', { class: 'rh-msg-file-meta' }, meta)
                ),
                h(doc, 'pre', { class: 'rh-msg-file-pre' }, previewText)
              );
            }
            return h(doc, 'div', { class: 'rh-msg-file-chip' },
              h(doc, 'span', {}, attachmentIcon(file)),
              h(doc, 'span', { class: 'rh-msg-file-name' }, file.name || 'file'),
              meta && h(doc, 'span', { class: 'rh-msg-file-meta' }, meta)
            );
          })
        )
      );
    }

    return h(doc, 'div', { class: 'rh-msg-attachments' }, ...children);
  }

  renderPendingAttachmentsTray() {
    if (!this.pendingAttachments || this.pendingAttachments.length === 0) return null;
    const doc = this.doc;
    return h(doc, 'div', { class: 'rh-attach-tray' },
      ...this.pendingAttachments.map(att => {
        const isImg = att.kind === 'image';
        const thumbSrc = isImg ? (att.thumbDataUrl || att.base64 || '') : '';
        const meta = isImg
          ? [att.width && att.height ? `${att.width}×${att.height}` : '', att.sizeBytes ? formatFileSize(att.sizeBytes) : ''].filter(Boolean).join(' · ')
          : [att.lines ? `${att.lines.toLocaleString()}줄` : '', att.sizeBytes ? formatFileSize(att.sizeBytes) : ''].filter(Boolean).join(' · ');
        return h(doc, 'div', {
          class: `rh-attach-chip${isImg ? ' is-image' : ''}`,
          title: `${att.name || '첨부'}${meta ? ` (${meta})` : ''}`,
        },
          isImg && thumbSrc
            ? h(doc, 'button', {
                type: 'button',
                class: 'rh-attach-thumb-btn',
                title: '클릭해 이미지 미리보기',
                onclick: () => this.openImageLightbox(att),
              }, h(doc, 'img', { class: 'rh-attach-thumb', src: thumbSrc, alt: att.name || 'image' }))
            : h(doc, 'span', { class: 'rh-attach-icon' }, attachmentIcon(att)),
          h(doc, 'div', { class: 'rh-attach-info' },
            h(doc, 'span', { class: 'rh-attach-name' }, att.name || '첨부 파일'),
            meta && h(doc, 'span', { class: 'rh-attach-meta' }, meta)
          ),
          h(doc, 'button', {
            type: 'button',
            class: 'rh-attach-remove',
            title: '첨부 제거',
            disabled: this.busy,
            onclick: () => this.removePendingAttachment(att.id),
          }, '×')
        );
      }),
      this.pendingAttachments.length >= 2 && h(doc, 'button', {
        type: 'button',
        class: 'rh-attach-clear',
        disabled: this.busy,
        onclick: () => this.clearPendingAttachments(),
      }, '모두 비우기')
    );
  }

  renderImageLightbox() {
    const lb = this.lightboxImage;
    if (!lb) return null;
    const doc = this.doc;
    const metaParts = [];
    if (lb.width && lb.height) metaParts.push(`${lb.width}×${lb.height}`);
    if (lb.sizeBytes) metaParts.push(formatFileSize(lb.sizeBytes));
    if (lb.isThumbOnly) metaParts.push('저장 썸네일');
    return h(doc, 'div', {
      class: 'rh-lightbox-backdrop',
      onclick: (e) => {
        e.stopPropagation();
        this.closeImageLightbox();
      },
    },
      h(doc, 'div', {
        class: 'rh-lightbox',
        onclick: (e) => e.stopPropagation(),
      },
        h(doc, 'div', { class: 'rh-lightbox-bar' },
          h(doc, 'span', { class: 'rh-lightbox-title' },
            lb.name,
            metaParts.length > 0 && h(doc, 'span', { class: 'rh-lightbox-meta' }, ` · ${metaParts.join(' · ')}`)
          ),
          h(doc, 'button', {
            type: 'button',
            class: 'rh-btn ghost',
            onclick: () => this.closeImageLightbox(),
          }, '✕ 닫기')
        ),
        h(doc, 'div', { class: 'rh-lightbox-body' },
          h(doc, 'img', { class: 'rh-lightbox-img', src: lb.src, alt: lb.name || 'image' })
        )
      )
    );
  }

  render() {
    const doc = this.doc;
    this._streamingBody = null;
    const prevInput = doc.querySelector('.rh-composer-input')?.value ?? '';
    const prevPresetScroll = doc.querySelector('.rh-preset-body')?.scrollTop ?? null;
    const prevChatScroll = doc.querySelector('.rh-chat')?.scrollTop ?? null;
    const prevDetailsOpen = new Map();
    if (typeof doc.querySelectorAll === 'function') {
      for (const el of doc.querySelectorAll('details[data-rh-details-key]')) {
        const key = el.getAttribute('data-rh-details-key');
        if (key) prevDetailsOpen.set(key, Boolean(el.open));
      }
    }
    doc.body.textContent = '';

    const ctx = this.getEffectiveContext();
    const flavor = this.adapter.detectHostFlavor();
    const pickerOpts = this.buildTargetPickerOptions();
    const subPicker = this.renderSubItemPicker(ctx);
    const quickPrompts = getQuickPromptsForContext(ctx);

    const statusTooltip = this.isDocked
      ? `RisuHelper v${VERSION} · 실시간 도킹 · ${flavor.name}`
      : `RisuHelper v${VERSION} · ${flavor.name} · ${this.tracker.enabled ? '커서 자동감지 활성' : '수동 대상 모드'}`;
    const hasUndo = this.adapter.undoUnitCount() > 0;

    const header = h(doc, 'header', { class: 'rh-header' },
      h(doc, 'div', { class: 'rh-header-top' },
        h(doc, 'div', { class: 'rh-brand', title: statusTooltip },
          h(doc, 'button', {
            class: `rh-btn rh-menu-btn${this.menuOpen ? ' primary' : ' ghost'}`,
            'aria-label': '메뉴',
            title: '메뉴 (프리셋 · 도킹 · 커서 재감지 · 참고 옵션 · 참조 채팅)',
            onclick: () => {
              this.menuOpen = !this.menuOpen;
              if (this.menuOpen) {
                this.settingsOpen = false;
                this.presetPanelOpen = false;
                this.conversationsPanelOpen = false;
                this.extensionsPanelOpen = false;
              }
              this.render();
            },
          }, '☰'),
          h(doc, 'div', { class: 'rh-logo' }, 'RH'),
          h(doc, 'div', { class: 'rh-title-wrap' },
            this.isDocked && h(doc, 'span', { class: 'rh-live-dot', style: 'margin-right:0;' }),
            h(doc, 'div', { class: 'rh-title' }, 'RisuHelper')
          )
        ),
        h(doc, 'div', { class: 'rh-header-controls' },
          h(doc, 'button', {
            class: `rh-btn${this.settingsOpen ? ' primary' : ' ghost'}`,
            onclick: () => {
              this.settingsOpen = !this.settingsOpen;
              if (this.settingsOpen) {
                this.menuOpen = false;
                this.presetPanelOpen = false;
                this.conversationsPanelOpen = false;
                this.extensionsPanelOpen = false;
              }
              this.render();
            },
          }, '설정'),
          h(doc, 'button', {
            class: 'rh-btn ghost',
            title: '현재 화면을 비우고 새 대화를 시작합니다 (저장된 대화 목록은 유지됩니다)',
            onclick: () => {
              this.startNewConversation({ saveCurrent: false });
            },
          }, '대화 비우기'),
          h(doc, 'button', {
            class: 'rh-btn',
            onclick: () => this.close(),
          }, '닫기')
        )
      ),
      hasUndo && h(doc, 'div', { class: 'rh-actions' },
        h(doc, 'button', {
          class: 'rh-btn',
          title: `다음에 되돌릴 변경: ${this.adapter.peekUndoLabel()}`,
          onclick: () => this.undoLatest(),
        }, `되돌리기 (${this.adapter.undoUnitCount()})`),
        h(doc, 'button', {
          class: 'rh-btn ok',
          title: '적용한 변경을 모두 확정하고 되돌리기 기록을 비웁니다 (실수 롤백 방지)',
          onclick: () => this.commitUndoHistory(),
        }, '✓ 변경 확정')
      )
    );

    const contextBarChildren = [
      h(doc, 'div', { class: 'rh-row' },
        h(doc, 'select', {
          class: 'rh-select rh-target-select',
          onchange: (e) => this.onSelectTarget(e.target.value),
        },
          ...pickerOpts.map(o => h(doc, 'option', { value: o.value, selected: o.value === this.currentPickerValue() }, o.label))
        )
      ),
    ];

    if (subPicker) {
      const rows = Array.isArray(subPicker) ? subPicker : [subPicker];
      for (const pickerEl of rows) {
        if (pickerEl) contextBarChildren.push(h(doc, 'div', { class: 'rh-row' }, pickerEl));
      }
    }

    // When a reference chat is attached, show a slim 1-line dismissible indicator even while the menu is closed.
    if (this.referenceChat) {
      const refIdx = this.referenceChat.index;
      const info = this.referenceInfo?.index === refIdx ? this.referenceInfo : null;
      const refDetail = info?.error
        ? `오류: ${info.error}`
        : info
          ? `메시지 ${info.sent}/${info.messageCount}개${info.omitted > 0 ? (info.hasMemory ? ' · 메모리 보충' : ' · 일부 생략') : ''}`
          : '요청 시 함께 전송';
      contextBarChildren.push(
        h(doc, 'div', { class: info?.error ? 'rh-banner error' : 'rh-ref-bar' },
          h(doc, 'span', {}, `📎 참조 채팅: ${refIdx + 1}번 · ${this.referenceChat.name} (${refDetail})`),
          h(doc, 'button', {
            class: 'rh-btn ghost',
            title: '참조 채팅 연결을 해제합니다',
            onclick: () => {
              this.setReferenceChat(null);
              this.render();
            },
          }, '해제')
        )
      );
    }

    if (this.attachedFetchLog) {
      const log = this.attachedFetchLog;
      const logLabel = `HTTP ${log.status ?? '?'}${log.url ? ` · ${log.url}` : ''}`;
      contextBarChildren.push(
        h(doc, 'div', { class: 'rh-ref-bar' },
          h(doc, 'span', {}, `🔍 요청 로그 첨부됨 (1회 전송 후 자동 해제): ${logLabel}`),
          h(doc, 'button', {
            class: 'rh-btn ghost',
            title: '첨부된 요청 로그를 해제합니다',
            onclick: () => {
              this.attachedFetchLog = null;
              this.render();
            },
          }, '해제')
        )
      );
    }

    if (ctx.warnings?.length) {
      for (const w of ctx.warnings) {
        contextBarChildren.push(h(doc, 'div', { class: 'rh-banner' }, w));
      }
    }

    if (this.settings.showDetectDiagnostics && ctx.diagnostics) {
      const sig = ctx.diagnostics.signals || {};
      const lines = [
        `판정: ${ctx.targetKind}${ctx.fieldKey ? ` / ${ctx.fieldKey}` : ''} (화면: ${ctx.screen})`,
        `옆 라벨: "${sig.nearbyLabel || ''}"  placeholder: "${sig.placeholder || ''}"  태그: ${sig.tag || ''}${sig.inputType ? `[${sig.inputType}]` : ''}`,
        `제목: ${(sig.headings || []).join(' | ') || '(없음)'}`,
        `활성 탭: ${(sig.activeTabs || []).join(' | ') || '(없음)'}  로어북 탭: "${sig.loreTabLabel || ''}"`,
        `항목 번호: ${sig.loreIdx ?? '(없음)'}  설정 ID: ${sig.settingId || '(없음)'}`,
        ...(ctx.diagnostics.errors || []).map(e => `무시된 오류: ${e.message}${e.at ? ` (${e.at})` : ''}`),
      ];
      contextBarChildren.push(
        h(doc, 'details', { class: 'rh-preview-details' },
          h(doc, 'summary', {}, `🔎 감지 근거 보기${ctx.diagnostics.errors?.length ? ` · 무시된 오류 ${ctx.diagnostics.errors.length}건` : ''}`),
          h(doc, 'pre', { class: 'rh-preview-pre' }, lines.join('\n'))
        )
      );
    }

    if (this.activeSnapshot?.ok && this.activeSnapshot.moduleUncertain) {
      contextBarChildren.push(h(doc, 'div', { class: 'rh-banner error' },
        '열려 있는 모듈을 자동으로 확정하지 못했습니다. 아래 모듈 선택기에서 편집할 모듈을 직접 선택해 주세요. 선택 전에는 모듈 편집 제안을 적용할 수 없습니다.'));
    }

    if (this.activeSnapshot?.ok && !this.activeSnapshot.moduleUncertain && this.activeSnapshot.orphanedLoreCount > 0) {
      const orphanCount = this.activeSnapshot.orphanedLoreCount;
      const scopeLabel = this.activeSnapshot.orphanedLoreScopeLabel || '로어북';
      const rescueTarget = this.activeSnapshot.orphanedLoreTarget || this.activeSnapshot.target;
      const rescueHostBinding = this.activeSnapshot.hostBinding || null;
      contextBarChildren.push(
        h(doc, 'div', { class: 'rh-banner error', style: 'display:flex;flex-direction:column;gap:6px;' },
          h(doc, 'div', {}, `🛟 ${scopeLabel}에서 잘못된 폴더 연결로 화면에 숨겨진 로어북 ${orphanCount}개를 발견했습니다. 삭제된 것이 아니라 DB에 그대로 남아 있으며, 아래 버튼으로 최상위 목록에 바로 복구할 수 있습니다.`),
          h(doc, 'div', { class: 'rh-row' },
            h(doc, 'button', {
              class: 'rh-btn primary',
              onclick: async () => {
                try {
                  const res = await this.adapter.recoverOrphanedLorebooks(rescueTarget, { hostBinding: rescueHostBinding });
                  await this.refreshContextSnapshot();
                  const isMod = rescueTarget?.loreScope === 'module' || rescueTarget?.targetKind === 'module_lorebook';
                  this.showToast(
                    isMod
                      ? `${res.summary} — ⚠️ 하단 "모듈 수정"을 누르지 말고 다른 설정 탭을 다녀와 다시 여세요!`
                      : res.summary
                  );
                } catch (err) {
                  this.showToast(`복구 실패: ${err.message}`);
                }
              },
            }, `🛟 숨겨진 로어북 ${orphanCount}개 최상위로 복구`)
          )
        )
      );
    }

    const originalLength = this.activeSnapshot?.ok ? String(this.activeSnapshot.content || '').length : 0;
    if (originalLength > this.settings.maxContentChars) {
      contextBarChildren.push(
        h(doc, 'div', { class: 'rh-banner' },
          `✂️ 원문 ${originalLength.toLocaleString()}자 중 앞 ${this.settings.maxContentChars.toLocaleString()}자만 모델에 전달됩니다. ` +
          '뒷부분 유실을 막기 위해 전체 덮어쓰기는 차단되고 부분 편집만 적용할 수 있습니다. 설정 › "모델에 보내는 원문 길이"에서 늘릴 수 있습니다.')
      );
    }

    if (this._hasModuleDomMismatch()) {
      contextBarChildren.push(
        h(doc, 'div', { class: 'rh-banner', style: 'display:flex;flex-direction:column;gap:6px;' },
          h(doc, 'div', {}, '⚠️ DB와 열려 있는 "모듈 수정" 화면(tempModule) 내용이 다릅니다. 하단 "모듈 수정" 버튼을 누르면 이전 값으로 덮어써지니 누르지 말고 다른 탭을 다녀오거나 아래 버튼으로 입력칸을 채워 주세요.'),
          h(doc, 'div', { class: 'rh-row' },
            h(doc, 'button', {
              class: 'rh-btn',
              onclick: async () => {
                const syncSnap = this._moduleSyncSnapshot();
                if (!syncSnap) return;
                const syncRes = await this.syncOpenModuleEditor(
                  syncSnap.target,
                  this._moduleSyncText(syncSnap),
                  { moduleId: syncSnap.hostBinding?.moduleId || null }
                );
                this.showToast(syncRes.ok ? syncRes.message : syncRes.reason);
                this.render();
              },
            }, '📝 DB 최신본을 입력칸에 채우기')
          )
        )
      );
    }

    if (this.activeSnapshot && !this.activeSnapshot.ok) {
      contextBarChildren.push(h(doc, 'div', { class: 'rh-banner error' }, this.activeSnapshot.reason));
    } else if (this.activeSnapshot?.content) {
      const content = this.activeSnapshot.content;
      const lineCount = content.split('\n').length;
      const previewHeading = this._isModuleTarget(this.activeSnapshot.target) ? '현재 DB 원문 보기' : '현재 원문 보기';
      contextBarChildren.push(
        h(doc, 'details', { class: 'rh-preview-details', 'data-rh-details-key': 'active-source-preview' },
          h(doc, 'summary', {}, `${previewHeading} (${this.activeSnapshot.label} · ${content.length.toLocaleString()}자 / ${lineCount}줄)`),
          h(doc, 'pre', { class: 'rh-preview-pre' }, content.slice(0, 4000) + (content.length > 4000 ? '\n... (일부 생략)' : ''))
        )
      );
    }

    const chatEl = h(doc, 'div', { class: 'rh-chat' });
    if (this.messages.length === 0) {
      if (this.conversationSummary) {
        chatEl.appendChild(this.renderCompactionCard());
      }
      chatEl.appendChild(
        h(doc, 'div', { class: 'rh-empty' },
          h(doc, 'div', { style: 'font-size:15px;font-weight:700;color:var(--rh-text);' }, `현재 대상: ${this.activeSnapshot?.label || ctx.labelText}`),
          h(doc, 'div', { style: 'max-width:360px;font-size:12.5px;' }, '사용법·설정을 질문하거나, 현재 커서가 위치한 설명·로어북·Lua·정규식·페르소나의 부분 편집, 덮어쓰기, 새로 생성을 요청해 보세요.'),
          h(doc, 'div', { class: 'rh-quick-chips' },
            ...quickPrompts.map(q =>
              h(doc, 'button', {
                class: 'rh-chip',
                onclick: () => this.sendMessage(q.prompt),
              }, q.label)
            )
          )
        )
      );
    } else {
      const hasCompaction = Boolean(this.conversationSummary && this.conversationCompactedCount > 0);
      const compactSplit = hasCompaction
        ? Math.min(this.messages.length, this.conversationCompactedCount)
        : -1;
      for (let msgIdx = 0; msgIdx < this.messages.length; msgIdx++) {
        if (hasCompaction && msgIdx === compactSplit) {
          chatEl.appendChild(this.renderCompactionCard());
        }
        const msg = this.messages[msgIdx];
        const isCompacted = hasCompaction && msgIdx < compactSplit;
        const msgWrap = h(doc, 'div', { class: `rh-msg ${msg.role}${isCompacted ? ' compacted' : ''}` });
        if (msg.role === 'user') {
          const attEl = this.renderUserMessageAttachments(msg.attachments);
          msgWrap.appendChild(
            h(doc, 'div', { class: `rh-bubble${attEl ? ' has-attachments' : ''}` },
              attEl,
              msg.content && h(doc, 'div', { class: 'rh-user-text' }, msg.content),
              isCompacted && h(doc, 'span', { class: 'rh-compacted-tag' }, '요약됨')
            )
          );
        } else {
          const bubble = h(doc, 'div', { class: 'rh-bubble' });
          let barLeft;
          if (msg.streaming) {
            barLeft = h(doc, 'span', { class: 'rh-msg-badge' }, h(doc, 'span', { class: 'rh-streaming-dot' }), msg.progressLabel || '응답 생성 중...');
          } else if (msg.error) {
            barLeft = h(doc, 'span', { class: 'rh-msg-badge' }, '오류');
          } else {
            const baseLabel = msg.rawView ? 'RisuHelper · 원문' : 'RisuHelper';
            let metaSpan = null;
            if (msg.loopMeta) {
              const m = msg.loopMeta;
              const metaParts = m.pipeline?.used
                ? [
                    `계획형 ${m.callsUsed}회 (S2:${m.pipeline.step2Executed}·S3:${m.pipeline.step3Executed})`,
                    ...(m.pipeline.cancelled ? ['취소됨'] : m.pipeline.partial ? ['부분 완료'] : []),
                  ]
                : [`호출 ${m.callsUsed}/${m.maxCalls}`];
              if (Number.isFinite(m.totalPromptChars) && m.totalPromptChars > 0) {
                metaParts.push(`${m.totalPromptChars.toLocaleString()}자`);
              }
              if (m.toolRuns?.length > 0) metaParts.push(`읽기 도구 ${m.toolRuns.length}건`);
              if (m.repairedCount > 0) metaParts.push(`자동 수정 ${m.repairedCount}회`);
              if (m.budgetTrimmedNotes?.length > 0) metaParts.push('예산 축약');
              metaSpan = h(doc, 'span', { class: 'rh-msg-meta' }, ` · ${metaParts.join(' · ')}`);
            }
            barLeft = h(doc, 'span', { class: 'rh-msg-badge' },
              baseLabel,
              metaSpan,
              isCompacted && h(doc, 'span', { class: 'rh-compacted-tag' }, '요약됨')
            );
          }
          const barActions = (!msg.error && !msg.streaming && msg.content)
            ? h(doc, 'div', { class: 'rh-msg-actions' },
                h(doc, 'button', {
                  class: `rh-msg-act${msg.rawView ? ' active' : ''}`,
                  type: 'button',
                  onclick: () => {
                    msg.rawView = !msg.rawView;
                    this.render();
                  },
                }, msg.rawView ? '서식 보기' : '원문 보기'),
                h(doc, 'button', {
                  class: 'rh-msg-act',
                  type: 'button',
                  onclick: () => this.copyText(msg.content),
                }, '복사')
              )
            : null;
          bubble.appendChild(h(doc, 'div', { class: 'rh-msg-bar' }, barLeft, barActions));

          const body = h(doc, 'div', { class: 'rh-msg-body' });
          if (msg.streaming) this._streamingBody = { msg, el: body };
          if (msg.error) {
            body.appendChild(h(doc, 'div', { class: 'rh-banner error' }, `오류: ${msg.error}`));
          } else if (msg.rawView) {
            body.appendChild(h(doc, 'pre', { class: 'rh-raw-pre' }, msg.content));
          } else {
            renderMarkdown(doc, body, msg.content, {
              onCopy: (codeText) => this.copyText(codeText),
            });
          }
          bubble.appendChild(body);
          if (!msg.streaming && msg.loopMeta && (msg.loopMeta.toolRuns?.length > 0 || msg.loopMeta.repairedCount > 0)) {
            const m = msg.loopMeta;
            const repairEntries = Array.isArray(m.repairHistory) ? m.repairHistory : [];
            const repairEndedWithoutProposal = m.repairedCount > 0 && (msg.proposals || []).length === 0;
            const summaryParts = [];
            if (m.toolRuns?.length > 0) summaryParts.push(`읽기 도구 ${m.toolRuns.length}건 조회`);
            if (m.repairedCount > 0) {
              summaryParts.push(repairEndedWithoutProposal
                ? `이전 제안 거부 후 재응답 ${m.repairedCount}회`
                : `제안 오류 자동 수정 ${m.repairedCount}회`);
            }
            bubble.appendChild(
              h(doc, 'details', { class: 'rh-preview-details rh-loop-trace', open: repairEndedWithoutProposal },
                h(doc, 'summary', {}, `${summaryParts.join(' · ')} (자동 단계는 읽기 전용)`),
                h(doc, 'ul', { class: 'rh-loop-trace-list' },
                  ...(m.toolRuns || []).map(run =>
                    h(doc, 'li', { class: `rh-loop-trace-item ${run.ok ? 'ok' : 'fail'}` },
                      `${run.ok ? '✓' : '✗'} [호출 ${run.call}] ${run.label}${!run.ok && run.error ? ` — ${run.error}` : ''}`
                    )
                  ),
                  ...repairEntries.flatMap(entry =>
                    (entry.reasons || []).map(reason =>
                      h(doc, 'li', { class: 'rh-loop-trace-item fail' },
                        `↻ [호출 ${entry.call} 거부 사유] ${reason}`
                      )
                    )
                  ),
                  m.repairedCount > 0 && repairEntries.length === 0 && h(doc, 'li', { class: 'rh-loop-trace-item ok' },
                    `↻ 파싱·미리보기 오류를 감지해 ${m.repairedCount}회 자동 수정했습니다.`
                  )
                )
              )
            );
          }
          msgWrap.appendChild(bubble);

          for (const err of msg.parseErrors || []) {
            msgWrap.appendChild(h(doc, 'div', { class: 'rh-banner error' }, `제안 블록 파싱 실패: ${err.error}`));
          }
          const applicable = this.applicableProposals(msg);
          const showApplyAll = applicable.length >= 2 &&
            !applicable.every(i => (i.pinnedTarget?.targetKind || i.preview?.target?.targetKind) === 'chat_input');
          if (showApplyAll || msg.groupId) {
            msgWrap.appendChild(
              h(doc, 'div', { class: 'rh-row', style: 'gap:6px;flex-wrap:wrap;' },
                showApplyAll && h(doc, 'button', {
                  class: 'rh-btn primary',
                  disabled: this.busy || this.applyingGroup,
                  onclick: () => this.applyAllProposals(msg),
                }, `모두 적용 (${applicable.length})`),
                msg.groupId && h(doc, 'button', {
                  class: 'rh-btn ok',
                  title: '이 묶음 적용을 확정하고 묶음 되돌리기 기록을 비웁니다',
                  onclick: () => this.commitUndoHistory({ groupId: msg.groupId }),
                }, '✓ 묶음 확정'),
                msg.groupId && h(doc, 'button', {
                  class: 'rh-btn danger',
                  onclick: () => this.undoProposalGroup(msg),
                }, '묶음 되돌리기')
              )
            );
          }
          for (const item of msg.proposals || []) {
            msgWrap.appendChild(this.renderProposalCard(item));
          }
        }
        chatEl.appendChild(msgWrap);
      }
      if (hasCompaction && compactSplit >= this.messages.length) {
        chatEl.appendChild(this.renderCompactionCard());
      }
    }

    const triggerSend = () => {
      const val = textarea.value;
      if (!String(val || '').trim() && this.pendingAttachments.length === 0) return;
      textarea.value = '';
      this.sendMessage(val);
    };

    const textarea = h(doc, 'textarea', {
      class: 'rh-textarea rh-composer-input',
      placeholder: '질문·편집 요청 · 파일 드래그 · Ctrl+V 이미지 붙여넣기 (Ctrl+Enter 전송)',
      value: prevInput,
      onpaste: (e) => {
        this.handleComposerPaste(e);
      },
      onkeydown: (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          triggerSend();
        }
      },
    });

    const sendBtn = this.busy
      ? h(doc, 'button', {
          class: 'rh-btn danger',
          onclick: () => { this.currentJob?.stop?.('사용자가 요청을 중단했습니다.'); },
        }, '중단')
      : h(doc, 'button', {
          class: 'rh-btn primary',
          onclick: triggerSend,
        }, '전송');

    const composerTools = h(doc, 'div', { class: 'rh-composer-tools' },
      h(doc, 'button', {
        type: 'button',
        class: 'rh-attach-btn rh-btn-attach-file',
        title: '.js, .lua, .txt, .log, .json, .md, .css, .html, .svg 및 이미지 파일 첨부',
        disabled: this.busy,
        onclick: () => this.pickAttachmentsUi(),
      }, '📎 파일·이미지'),
      h(doc, 'button', {
        type: 'button',
        class: 'rh-attach-btn rh-btn-attach-clipboard',
        title: '클립보드 이미지를 바로 첨부합니다 (입력창에서 Ctrl+V도 가능)',
        disabled: this.busy,
        onclick: () => this.pasteClipboardImageUi(),
      }, '📋 클립보드'),
      h(doc, 'button', {
        type: 'button',
        class: 'rh-attach-btn rh-btn-attach-screen',
        title: '화면·창을 한 프레임 캡처해 첨부합니다',
        disabled: this.busy,
        onclick: () => this.captureScreenUi(),
      }, '📷 화면 캡처'),
      h(doc, 'span', { class: 'rh-attach-hint rh-hide-mobile' }, 'Ctrl+V 붙여넣기 · 드래그 첨부')
    );

    const pendingTray = this.renderPendingAttachmentsTray();

    const composer = h(doc, 'div', { class: 'rh-composer' },
      pendingTray,
      composerTools,
      h(doc, 'div', { class: 'rh-composer-row' }, textarea, sendBtn)
    );

    const dropOverlay = h(doc, 'div', { class: 'rh-drop-overlay' },
      h(doc, 'div', { class: 'rh-drop-box' },
        h(doc, 'div', { style: 'font-size:24px;' }, '📎'),
        h(doc, 'div', { style: 'font-weight:700;font-size:14px;' }, '파일 또는 이미지를 여기에 놓으세요'),
        h(doc, 'div', { style: 'font-size:12px;color:var(--rh-muted);' }, '.js, .lua, .txt, .log, .json, .md, .css, .html, .svg · PNG/JPG/WebP/GIF')
      )
    );

    const hasDragFiles = (e) => {
      const types = e?.dataTransfer?.types;
      if (!types) return Boolean(e?.dataTransfer?.files?.length);
      return Array.from(types).includes('Files');
    };

    const drawer = h(doc, 'section', {
      class: `rh-drawer${this.isDocked ? ' docked' : (this.settings.wideMode ? ' wide' : '')}`,
      onclick: (e) => e.stopPropagation(),
      ondragenter: (e) => {
        if (!hasDragFiles(e)) return;
        e.preventDefault?.();
        this._dragDepth = (this._dragDepth || 0) + 1;
        toggleElementClass(drawer, 'rh-drag-over', true);
      },
      ondragover: (e) => {
        if (!hasDragFiles(e)) return;
        e.preventDefault?.();
        try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch {}
        toggleElementClass(drawer, 'rh-drag-over', true);
      },
      ondragleave: () => {
        this._dragDepth = Math.max(0, (this._dragDepth || 1) - 1);
        if (this._dragDepth === 0) toggleElementClass(drawer, 'rh-drag-over', false);
      },
      ondrop: (e) => {
        this._dragDepth = 0;
        toggleElementClass(drawer, 'rh-drag-over', false);
        this.handleDropFiles(e);
      },
    },
      header,
      this.renderConversationBar(),
      this.conversationsPanelOpen && this.renderConversationsPanel(),
      h(doc, 'div', { class: 'rh-context-bar' }, ...contextBarChildren),
      this.menuOpen && this.renderMenuPanel(ctx, flavor),
      this.presetPanelOpen && renderPresetPanel(this),
      this.extensionsPanelOpen && this.renderExtensionsPanel(),
      this.settingsOpen && this.renderSettingsPanel(),
      chatEl,
      composer,
      dropOverlay,
      this.confirmDialog && this.renderConfirmDialog(),
      this.lightboxImage && this.renderImageLightbox()
    );

    const shell = h(doc, 'div', {
      class: `rh-shell${this.isDocked ? ' docked' : ''}`,
      onclick: this.isDocked ? null : () => this.close(),
    }, drawer);

    doc.body.appendChild(shell);

    if (this.toastText) {
      doc.body.appendChild(h(doc, 'div', { class: 'rh-toast' }, this.toastText));
    }

    // Restore collapsible details states and scroll positions so toggles/toasts never jump to top
    if (prevDetailsOpen.size > 0 && typeof doc.querySelectorAll === 'function') {
      for (const el of doc.querySelectorAll('details[data-rh-details-key]')) {
        const key = el.getAttribute('data-rh-details-key');
        if (key === 'compaction-summary' && this.editingSummary) {
          el.open = true;
        } else if (key && prevDetailsOpen.has(key)) {
          el.open = prevDetailsOpen.get(key);
        }
      }
    }
    if (prevPresetScroll !== null) {
      const presetBody = doc.querySelector('.rh-preset-body');
      if (presetBody) presetBody.scrollTop = prevPresetScroll;
    }
    if (prevChatScroll !== null) {
      const nextChat = doc.querySelector('.rh-chat');
      if (nextChat) nextChat.scrollTop = prevChatScroll;
    }
  }

  async runWorkspaceAuditUi() {
    try {
      const res = await executeReadTool(this.adapter, { tool: 'audit_workspace', args: { scope: 'all' } });
      this.lastAuditResult = res.result;
      this.menuOpen = false;
      const r = res.result || {};
      if (!r.ok) {
        this.showToast(r.error || '건강검진 실행 실패');
        return;
      }
      if (r.healthy) {
        this.messages.push({
          role: 'assistant',
          content: '🩺 **워크스페이스 건강검진 완료**: 이상 항목이 발견되지 않았습니다(오류 0건 · 경고 0건).',
          proposals: [],
        });
        this.showToast('건강검진 완료: 이상 없음');
      } else {
        const lines = (r.findings || []).map(f => `- [${f.severity === 'error' ? '오류' : '경고'}] **${f.location ?? f.where ?? '항목'}**: ${f.message ?? f.detail ?? ''}`);
        this.messages.push({
          role: 'assistant',
          content:
            `🩺 **워크스페이스 건강검진 결과** (오류 ${r.errorCount || 0}건 · 경고 ${r.warnCount || 0}건)\n\n` +
            lines.join('\n') +
            '\n\n수리가 필요하면 `"방금 건강검진에서 나온 문제들을 워크스페이스 수리 카드로 고쳐 줘"`라고 요청하세요.',
          proposals: [],
        });
        this.showToast(`건강검진 완료: 오류 ${r.errorCount || 0} · 경고 ${r.warnCount || 0}`);
      }
      await this.syncActiveConversationToStore({ touchTimestamp: true, persistNow: true });
      this.render();
    } catch (err) {
      this.showToast(err?.message || '건강검진 중 오류 발생');
    }
  }

  async exportAuditReport() {
    try {
      const res = await executeReadTool(this.adapter, { tool: 'audit_workspace', args: { scope: 'all' } });
      const host = await executeReadTool(this.adapter, { tool: 'host_info', args: {} });
      const lines = [
        `# RisuHelper 워크스페이스 진단 리포트 (v${VERSION})`,
        `- 호스트: ${host.result?.host || 'unknown'}`,
        `- 시각: ${new Date().toISOString()}`,
        `- 오류: ${res.result?.errorCount || 0}건 · 경고: ${res.result?.warnCount || 0}건`,
        '',
        ...(res.result?.findings || []).map(f => `- [${f.severity}] ${f.location ?? f.where ?? '항목'}: ${f.message ?? f.detail ?? ''}`),
      ];
      const text = lines.join('\n') + '\n';
      const bytes = new TextEncoder().encode(text);
      const isProxyApi = Boolean(this.adapter?.detectHostFlavor?.()?.isProxy);
      if (!isProxyApi && typeof this.api?.save === 'function') {
        await this.api.save('risuhelper-audit.md', bytes);
      } else if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && this.doc?.body) {
        // Works universally across browsers and triggers RisuNest Tauri's SandboxHost download handler
        const blob = new Blob([bytes], { type: 'text/markdown;charset=utf-8' });
        const href = URL.createObjectURL(blob);
        const a = this.doc.createElement('a');
        a.href = href;
        a.download = 'risuhelper-audit.md';
        a.style.display = 'none';
        this.doc.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(href); } catch {} }, 1000);
      } else {
        throw new Error('이 환경에서는 파일 다운로드를 지원하지 않습니다.');
      }
      this.showToast('진단 리포트를 저장했습니다 (risuhelper-audit.md)');
    } catch (err) {
      this.showToast(err?.message || '진단 리포트 저장 실패');
    }
  }

  renderExtensionsPanel() {
    const doc = this.doc;
    const rt = this.adapter.extensionRuntime;
    const rules = rt ? rt.list() : [];
    const activeCount = rules.filter(r => r.enabled).length;
    const alerts = rt ? rt.recentAlerts.slice(-5).reverse() : [];

    return h(doc, 'div', { class: 'rh-settings rh-ext-panel' },
      h(doc, 'div', { class: 'rh-row', style: 'justify-content:space-between;align-items:center;' },
        h(doc, 'strong', {}, `🧩 선언형 상주 확장 (${rules.length}개)`),
        h(doc, 'div', { class: 'rh-row', style: 'gap:6px;' },
          activeCount > 0 && h(doc, 'button', {
            class: 'rh-btn danger',
            title: '실행 중인 모든 상주 확장을 즉시 비활성화하고 호스트 훅을 해제합니다',
            onclick: async () => {
              try {
                const stopped = await rt.disableAll();
                this.showToast(`모든 상주 확장 ${stopped}개를 즉시 중지했습니다.`);
                this.render();
              } catch (err) {
                this.showToast(err?.message || '일괄 중지 실패');
              }
            },
          }, '모두 중지'),
          h(doc, 'button', {
            class: 'rh-btn ghost',
            onclick: () => { this.extensionsPanelOpen = false; this.render(); },
          }, '닫기')
        )
      ),
      h(doc, 'div', { style: 'font-size:11.5px;color:var(--rh-muted);margin:4px 0 8px;' },
        '임의 JS 실행 없이 사용자가 승인한 선언형 규칙만 동작합니다. 지연·오류 시 자동 중지되며 끄거나 언로드하면 호스트 훅이 즉시 해제됩니다.'
      ),
      rules.length === 0
        ? h(doc, 'div', { style: 'font-size:12px;color:var(--rh-muted);padding:8px 0;' },
            '등록된 상주 확장 규칙이 없습니다. 채팅에서 "TTS에서 별표 지문 제거 규칙 추가해 줘"처럼 요청해 승인 카드로 추가할 수 있습니다.'
          )
        : h(doc, 'div', { style: 'display:flex;flex-direction:column;gap:6px;' },
            ...rules.map(r => h(doc, 'div', {
              class: 'rh-ext-item',
              style: 'border:1px solid var(--rh-border);border-radius:8px;padding:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;',
            },
              h(doc, 'div', { style: 'min-width:0;' },
                h(doc, 'div', { style: 'font-size:12.5px;font-weight:600;' },
                  `${r.name} `,
                  h(doc, 'span', { style: 'font-size:11px;color:var(--rh-muted);font-weight:400;' }, `(${r.typeLabel})`)
                ),
                h(doc, 'div', { style: `font-size:11px;color:${r.trippedReason ? 'var(--rh-danger, #e05252)' : 'var(--rh-muted)'};` },
                  r.trippedReason
                    ? `⚠️ ${r.trippedReason}`
                    : (r.supported ? (r.enabled ? '활성 · 호스트 훅 연결됨' : '비활성') : '현재 호스트 미지원')
                )
              ),
              h(doc, 'div', { class: 'rh-row', style: 'gap:4px;' },
                h(doc, 'button', {
                  class: `rh-btn${r.enabled ? ' primary' : ''}`,
                  disabled: !r.supported,
                  onclick: async () => {
                    try {
                      await rt.toggle(r.id, !r.enabled);
                      this.showToast(`${r.name}: ${!r.enabled ? '활성화' : '비활성화'}`);
                      this.render();
                    } catch (err) {
                      this.showToast(err?.message || '상태 변경 실패');
                    }
                  },
                }, r.enabled ? '켜짐' : '꺼짐'),
                h(doc, 'button', {
                  class: 'rh-btn',
                  onclick: () => {
                    const dr = dryRunExtensionRule(r);
                    this.showToast(dr.ok ? `드라이런 OK (${dr.type}${dr.changed ? ' · 변경 감지' : ''})` : (dr.error || '드라이런 오류'));
                  },
                }, '테스트'),
                h(doc, 'button', {
                  class: 'rh-btn danger',
                  onclick: async () => {
                    try {
                      await rt.remove(r.id);
                      this.showToast(`${r.name} 규칙 삭제 완료`);
                      this.render();
                    } catch (err) {
                      this.showToast(err?.message || '삭제 실패');
                    }
                  },
                }, '삭제')
              )
            ))
          ),
      alerts.length > 0 && h(doc, 'div', { style: 'margin-top:8px;font-size:11.5px;color:var(--rh-muted);' },
        h(doc, 'strong', {}, '최근 응답 점검 알림'),
        ...alerts.map(a => h(doc, 'div', {}, `• [${a.label}] ${(a.warnings || []).join(', ')}`))
      )
    );
  }

  async destroy() {
    this._closeConfirm(false, { render: false });
    clearTimeout(this.toastTimer);
    if (this._undoSaveTimer) {
      await this.flushUndoState();
    }
    if (this._convSaveTimer) {
      await this.flushConversations();
    }
    this.currentJob?.stop?.('플러그인이 언로드되었습니다.');
    try { await this.adapter.extensionRuntime?.dispose?.(); } catch {}
    for (const unsub of this._risunestCleanups || []) {
      try { await unsub(); } catch {}
    }
    this._risunestCleanups = [];
    await this.tracker.stop();
    const win = this.doc.defaultView;
    if (win?.visualViewport && this.viewportHandler) {
      win.visualViewport.removeEventListener('resize', this.viewportHandler);
    }
    if (typeof this.api.unregisterUIPart === 'function') {
      for (const id of this.registeredIds) {
        try { await this.api.unregisterUIPart(id); } catch {}
      }
    }
    this.registeredIds = [];
  }
}

export { RisuHelperApp };
