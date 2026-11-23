import { VERSION, STORAGE_KEY, PRESET_STORAGE_KEY, UNDO_STORAGE_KEY, DEFAULT_MAX_CONTENT_CHARS, MAX_CONTENT_CHAR_OPTIONS, CHAR_FIELD_META, MODULE_FIELD_META, CONFIG_FIELD_META, SCREEN_LABELS } from './version.js';
import { STYLES } from './style.js';
import { FocusTracker, normalizeChipPos, MIN_DOCK_VIEWPORT_PX } from './focus-detector.js';
import { HostAdapter, resolveModuleIndex, summarizeLoreList } from './host-adapter.js';
import { callRisuModel, parseAssistantReply, buildConversationMessages, findUnknownProposalKeys } from './llm.js';
import { buildDiffPreview } from './text-edits.js';
import { getQuickPromptsForContext } from './knowledge.js';
import { newPresetState, validatePresetState, assembleRisuHelperMessages } from './preset-engine.js';
import { renderPresetPanel } from './preset-ui.js';
import { renderMarkdown } from './markdown.js';

const DEFAULT_SETTINGS = {
  modelMode: 'model',
  timeoutSeconds: 120,
  maxHistoryTurns: 12,
  maxContentChars: DEFAULT_MAX_CONTENT_CHARS,
  showFloatingChip: true,
  showHostActionButton: false,
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
};

/**
 * The host renders `location: 'action'` buttons itself at a fixed top-right position on the chat
 * screen; a plugin cannot move them. Since it duplicates the draggable chip, it is only registered
 * when the user asks for it, or as the fallback entry point when the chip cannot be shown
 * (mainDom declined, or the chip switched off).
 */
function shouldRegisterHostActionButton({ userEnabled = false, chipAvailable = false } = {}) {
  return Boolean(userEnabled) || !chipAvailable;
}

const ACTION_LABELS = {
  patch_text: '부분 편집',
  replace_text: '전체 덮어쓰기',
  create_lorebook: '새 로어북 생성',
  update_lorebook: '로어북 수정',
  organize_lorebook: '로어북 폴더 정리',
  update_lua: 'Lua 스크립트 수정',
  upsert_regex: '정규식 저장',
  create_persona: '새 페르소나 생성',
  update_persona: '페르소나 수정',
  update_config: '설정 변경',
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
    this.settingsOpen = false;
    this.presetPanelOpen = false;
    this.presetState = newPresetState();
    this.hostModuleCatalog = [];
    this.lastPresetPreview = null;
    this.busy = false;
    this.currentJob = null;
    this.detectedContext = null;
    this.manualTarget = null;
    this.activeSnapshot = null;
    this.messages = [];
    this.toastTimer = null;
    this.toastText = '';
    this.registeredIds = [];
    this.hostActionButtonId = null;
    this.viewportHandler = null;
    this._lastLiveFocusSig = '';
    this._liveRefreshSeq = 0;
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
    this.adapter.onUndoChange = (info) => {
      this.scheduleSaveUndoState();
      if (info?.evicted?.length) {
        this.showToast(`되돌리기 기록이 가득 차 가장 오래된 ${info.evicted.length}건을 정리했습니다. (정리된 변경은 더 이상 되돌릴 수 없습니다)`);
      }
    };
    this.mountBaseStyles();
    this.syncHostTheme();
    this.bindVisualViewport();

    const openHandler = () => { this.open(); };

    this._openHandler = openHandler;
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
    await this.syncHostActionButton();
    await this.adapter.probeHostFlavor(this.tracker.rootDoc).catch(() => {});

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

  async syncHostActionButton() {
    if (typeof this.api.registerButton !== 'function') return;
    const chipAvailable = Boolean(this.tracker?.enabled && this.settings.showFloatingChip);
    const want = shouldRegisterHostActionButton({
      userEnabled: this.settings.showHostActionButton,
      chipAvailable,
    });
    if (want && !this.hostActionButtonId) {
      try {
        const fab = await this.api.registerButton(
          { name: 'RisuHelper', icon: '✨', iconType: 'html', location: 'action', id: 'risuhelper-fab' },
          this._openHandler || (() => { this.open(); })
        );
        this.hostActionButtonId = fab?.id || 'risuhelper-fab';
        this.registeredIds.push(this.hostActionButtonId);
      } catch {}
    } else if (!want && this.hostActionButtonId) {
      const id = this.hostActionButtonId;
      this.hostActionButtonId = null;
      this.registeredIds = this.registeredIds.filter(x => x !== id);
      if (typeof this.api.unregisterUIPart === 'function') {
        try { await this.api.unregisterUIPart(id); } catch {}
      }
    }
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

  scheduleSaveUndoState() {
    if (!this.api.pluginStorage?.setItem) return;
    clearTimeout(this._undoSaveTimer);
    this._undoSaveTimer = setTimeout(async () => {
      try {
        await this.api.pluginStorage.setItem(UNDO_STORAGE_KEY, JSON.stringify(this.adapter.exportUndoState()));
      } catch {}
    }, 120);
  }

  /** Clears "applied" on cards whose undo record no longer exists (undone globally or evicted). */
  syncAppliedCards() {
    const liveIds = new Set(this.adapter.undoStack.map(r => r.id));
    for (const msg of this.messages) {
      for (const item of msg.proposals || []) {
        if (item.applied && item.undoId && !liveIds.has(item.undoId)) {
          item.applied = false;
          item.undoId = null;
          item.statusMessage = '되돌림 완료';
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
    return (msg.proposals || []).filter(item => item.preview?.ok && !item.applied);
  }

  /** Applies every applicable proposal of one reply as a single undo unit. */
  async applyAllProposals(msg) {
    const attempted = new Set();
    const { groupId } = await this.adapter.runGroup(`묶음 적용`, async () => {
      for (let guard = 0; guard < 200; guard++) {
        const next = this.applicableProposals(msg).find(item => !attempted.has(item));
        if (!next) break;
        attempted.add(next);
        await this.applyProposalItem(next);
      }
    });
    const appliedCount = [...attempted].filter(item => item.applied).length;
    msg.groupId = appliedCount > 0 ? groupId : null;
    this.showToast(`${appliedCount}건을 한 번에 적용했습니다. "묶음 되돌리기" 한 번으로 모두 되돌릴 수 있습니다.`);
    this.render();
  }

  async undoProposalGroup(msg) {
    if (!msg.groupId) return;
    try {
      const res = await this.adapter.undoGroup(msg.groupId);
      this.syncAppliedCards();
      await this.refreshContextSnapshot();
      this.showToast(this.describeUndoResult(res));
    } catch (err) {
      this.syncAppliedCards();
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
      labelText: '일반 / 수동 선택',
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
    if (this.tracker.enabled && (!this.detectedContext || this.detectedContext.screen === 'unknown')) {
      await this.tracker.scanNow({ allowScreenFallback: true });
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
    } else {
      if (this.isDocked) {
        await this.tracker.releaseDock({ restoreChip: false });
        this.isDocked = false;
      }
      if (typeof this.api.showContainer === 'function') {
        await this.api.showContainer('fullscreen');
      }
    }

    await this.refreshContextSnapshot();
    this.render();
  }

  async close() {
    this.isOpen = false;
    if (this.isDocked) {
      await this.tracker.releaseDock({ restoreChip: true });
      this.isDocked = false;
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
        this.showToast('오른쪽 도킹 모드 활성 · RisuAI 입력칸을 클릭하면 실시간 반영됩니다.');
      } else {
        this.isDocked = false;
        this.settings.dockMode = false;
        await this.saveSettings();
        this.showToast(res.reason || '도킹 모드로 전환할 수 없습니다.');
      }
    } else {
      await this.tracker.releaseDock({ restoreChip: false });
      this.isDocked = false;
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

  async refreshContextSnapshot() {
    const ctx = this.getEffectiveContext();
    try {
      this.activeSnapshot = await this.adapter.readTargetSnapshot(ctx);
    } catch (err) {
      this.activeSnapshot = { ok: false, reason: err.message, content: '' };
    }
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

  async gatherExtraContext(ctx) {
    const extra = {};
    if (this.settings.includeCharSummary || this.settings.includeLoreSummary) {
      try {
        const { char } = await this.adapter.readActiveCharacter();
        if (char) {
          if (this.settings.includeCharSummary) {
            extra.charSummary = {
              name: char.name || '',
              descPreview: String(char.desc || '').slice(0, 500),
              firstMessagePreview: String(char.firstMessage || '').slice(0, 300),
              globalLoreCount: char.globalLore?.length ?? 0,
              regexCount: char.customscript?.length ?? 0,
              hasLua: char.triggerscript?.[0]?.effect?.[0]?.type === 'triggerlua',
            };
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

    if (ctx.targetKind === 'persona' || ctx.screen === 'persona') {
      try {
        const p = await this.adapter.readPersonas();
        if (!p.permissionDenied) {
          extra.personasSummary = p.personas.map((item, i) => ({
            index: i,
            name: item.name,
            note: item.note || '',
            selected: i === p.selectedPersona,
          }));
        }
      } catch {}
    }

    if (this.settings.includeConfigSummary || ctx.targetKind === 'config' || ctx.screen === 'settings') {
      try {
        const cfg = await this.adapter.readAllowedConfig();
        if (cfg) extra.configSummary = cfg;
      } catch {}
    }
    return extra;
  }

  async assembleRequestPayload(ctx, historyMessages, userInput) {
    const extraContext = await this.gatherExtraContext(ctx);
    const directMessages = buildConversationMessages({
      context: ctx,
      snapshot: this.activeSnapshot,
      extraContext,
      history: historyMessages,
      userInput,
      maxHistoryTurns: this.settings.maxHistoryTurns,
      maxContentChars: this.settings.maxContentChars,
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

    return assembleRisuHelperMessages({
      presetState: this.presetState,
      directMessages,
      activeChar,
      activePersona,
      loreEntries,
      history: historyMessages,
      maxHistoryTurns: this.settings.maxHistoryTurns,
    });
  }

  async refreshPresetPreview() {
    await this.refreshContextSnapshot();
    const ctx = this.getEffectiveContext();
    const draftInput = this.doc.querySelector('.rh-composer-input')?.value?.trim() || '(미리보기용 샘플 요청)';
    try {
      this.lastPresetPreview = await this.assembleRequestPayload(ctx, this.messages, draftInput);
    } catch (err) {
      this.lastPresetPreview = {
        mode: this.presetState.mode,
        messages: [],
        issues: [err.message || String(err)],
        notes: [],
      };
    }
  }

  async sendMessage(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || this.busy) return;

    await this.refreshContextSnapshot();
    const ctx = this.getEffectiveContext();
    const userMsg = { role: 'user', content: trimmed, rawText: trimmed };
    const assistantMsg = {
      role: 'assistant',
      content: '생각 중...',
      rawText: '',
      proposals: [],
      parseErrors: [],
      streaming: true,
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
      const assembled = await this.assembleRequestPayload(ctx, this.messages.slice(0, -2), trimmed);
      this.lastPresetPreview = assembled;
      if (assembled.issues && assembled.issues.length > 0) {
        throw new Error('프리셋 요청 점검에서 중단되었습니다:\n- ' + assembled.issues.join('\n- '));
      }

      const rawReply = await callRisuModel(
        this.api,
        assembled.messages,
        { mode: this.settings.modelMode, timeoutSeconds: this.settings.timeoutSeconds },
        job
      );

      const parsed = parseAssistantReply(rawReply);
      assistantMsg.streaming = false;
      assistantMsg.rawText = rawReply;
      assistantMsg.content = parsed.prose || (parsed.proposals.length > 0 ? '아래 수정·생성 제안을 확인한 뒤 적용해 주세요.' : rawReply);
      assistantMsg.parseErrors = parsed.errors;

      // Dry-run each proposal and pin the target + host binding at generation time
      const pinnedCtx = JSON.parse(JSON.stringify(ctx));
      assistantMsg.proposals = [];
      for (const prop of parsed.proposals) {
        const preview = await this.adapter.previewProposal(prop, pinnedCtx);
        assistantMsg.proposals.push({
          proposal: prop,
          preview,
          pinnedTarget: preview.target ? JSON.parse(JSON.stringify(preview.target)) : pinnedCtx,
          hostBinding: preview.hostBinding ? JSON.parse(JSON.stringify(preview.hostBinding)) : null,
          applied: false,
          undoId: null,
          bindToCurrentChat: Boolean(prop.bindToCurrentChat),
          destructiveConfirmed: false,
          statusMessage: '',
          unknownKeys: findUnknownProposalKeys(prop),
        });
      }
    } catch (err) {
      assistantMsg.streaming = false;
      assistantMsg.content = '';
      assistantMsg.error = err.message || String(err);
    } finally {
      if (chunkRenderTimer) clearTimeout(chunkRenderTimer);
      this.busy = false;
      this.currentJob = null;
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
    if (!this.tracker?.enabled || !this.activeSnapshot?.ok || this.activeSnapshot.moduleUncertain) return false;
    const snapTarget = this.activeSnapshot.target;
    if (!this._isModuleDomFillable(snapTarget)) return false;
    if (!this.detectedContext || this.detectedContext.screen !== 'module') return false;
    if (this.detectedContext.targetKind !== snapTarget.targetKind) return false;
    if (snapTarget.targetKind === 'module_lorebook' && this.detectedContext.loreIndex !== snapTarget.loreIndex) return false;
    if (snapTarget.targetKind === 'module_regex' && this.detectedContext.regexIndex !== snapTarget.regexIndex) return false;

    const norm = (s) => String(s || '').replace(/\r\n/g, '\n').trim();
    const livePreview = norm(this.detectedContext.liveTextPreview || this.detectedContext.moduleDomHints?.textPreview || '');
    const dbContent = norm(this.activeSnapshot.content || '');
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

  async applyProposalItem(item) {
    const pinnedTarget = item.pinnedTarget || item.preview?.target;
    const hostBinding = item.hostBinding || item.preview?.hostBinding || null;
    try {
      const res = await this.adapter.applyProposal(item.proposal, pinnedTarget, {
        bindToCurrentChat: item.bindToCurrentChat,
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
        const savedText = item.preview?.after ?? this.activeSnapshot?.content ?? '';
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
    } catch (err) {
      item.statusMessage = `적용 실패: ${err.message}`;
      this.showToast(`적용 실패: ${err.message}`);
    }
    this.render();
  }

  async undoProposalItem(item) {
    if (!item.undoId) return;
    try {
      const res = await this.adapter.undo(item.undoId);
      item.applied = false;
      item.undoId = null;
      item.statusMessage = `되돌림 완료 (${res.label})`;
      await this.refreshContextSnapshot();

      if (item.moduleDbSaved) {
        item.moduleDbSaved = false;
        item.moduleDomSynced = false;
        const pinnedTarget = item.pinnedTarget || item.preview?.target;
        const hostBinding = item.hostBinding || item.preview?.hostBinding || null;
        if (this.settings.autoFillModuleEditor && this.tracker?.enabled && this._isModuleDomFillable(pinnedTarget, item.proposal)) {
          const restoredText = item.preview?.before ?? this.activeSnapshot?.content ?? '';
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
      this.showToast(this.describeUndoResult(res));
    } catch (err) {
      this.syncAppliedCards();
      this.showToast(`되돌리기 실패: ${err.message}`);
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
    const opts = [
      { value: 'auto', label: this.detectedContext ? `📍 자동 감지: ${this.detectedContext.labelText}` : '📍 자동 감지 (미감지 · 일반)' },
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
      { value: 'general:', label: '일반 질문 / 사용법 안내' },
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
          kind === 'chat_message' ? 'data' :
          kind === 'char_alt_greeting' ? 'alternateGreetings' :
          kind === 'module_field' ? 'backgroundEmbedding' :
          kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook' ? 'content' :
          kind === 'persona' ? 'personaPrompt' :
          null
        ),
        loreIndex: null,
        loreScope: kind === 'chat_lorebook' ? 'chat' : kind === 'module_lorebook' ? 'module' : kind === 'char_lorebook' ? 'character' : null,
        labelText: kind === 'char_field'
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

  renderProposalCard(item) {
    const doc = this.doc;
    const { proposal, preview } = item;
    const actionLabel = ACTION_LABELS[proposal.action] || proposal.action;
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
    }

    if (item.statusMessage) {
      const isFailure = item.statusMessage.startsWith('적용 실패');
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
    } else if (item.applied) {
      const syncTarget = item.pinnedTarget || preview.target;
      if (item.moduleDbSaved && this.tracker?.enabled && this._isModuleDomFillable(syncTarget, proposal)) {
        rightControls.push(
          h(doc, 'button', {
            class: 'rh-btn',
            onclick: async () => {
              const syncRes = await this.syncOpenModuleEditor(
                syncTarget,
                preview.after ?? this.activeSnapshot?.content ?? '',
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
      rightControls.push(
        h(doc, 'button', {
          class: 'rh-btn danger',
          onclick: () => this.undoProposalItem(item),
        }, '되돌리기')
      );
    } else {
      rightControls.push(
        h(doc, 'button', {
          class: 'rh-btn primary',
          disabled: Boolean(preview.requiresConfirm && !item.destructiveConfirmed),
          onclick: () => this.applyProposalItem(item),
        }, '적용')
      );
    }

    return h(doc, 'div', { class: 'rh-proposal' },
      h(doc, 'div', { class: 'rh-proposal-head' },
        h(doc, 'span', { class: 'rh-proposal-title' }, proposal.title || preview.label || actionLabel),
        h(doc, 'span', { class: 'rh-pill' }, actionLabel)
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
      const selectedIdx = ctx.greetingIndex ?? this.activeSnapshot.target?.greetingIndex ?? 0;
      return h(doc, 'select', {
        class: 'rh-select',
        onchange: async (e) => {
          const base = this.manualTarget || { ...ctx };
          base.greetingIndex = Number(e.target.value);
          this.manualTarget = base;
          await this.refreshContextSnapshot();
          this.render();
        },
      },
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
                await this.syncHostActionButton();
                this.render();
              },
            }),
            '화면에 플로팅 버튼 표시 (드래그 이동 가능 · mainDom 필요)'
          ),
          h(doc, 'label', {},
            h(doc, 'input', {
              type: 'checkbox',
              checked: this.settings.showHostActionButton,
              onchange: async (e) => {
                this.settings.showHostActionButton = Boolean(e.target.checked);
                await this.saveSettings();
                await this.syncHostActionButton();
                this.render();
              },
            }),
            '채팅 화면 우측 상단 고정 ✨ 버튼도 표시 (RisuAI가 그리는 버튼 · 위치 이동 불가)'
          ),
          h(doc, 'label', {},
            h(doc, 'input', {
              type: 'checkbox',
              checked: this.settings.showDetectDiagnostics,
              onchange: async (e) => {
                this.settings.showDetectDiagnostics = Boolean(e.target.checked);
                this.tracker.diagnostics = this.settings.showDetectDiagnostics;
                await this.saveSettings();
                if (this.tracker.enabled) await this.tracker.scanNow({ allowScreenFallback: true });
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

    const subtitleEl = this.isDocked
      ? h(doc, 'div', { class: 'rh-subtitle' },
          h(doc, 'span', { class: 'rh-live-dot' }),
          `실시간 도킹 · ${flavor.name}`
        )
      : h(doc, 'div', { class: 'rh-subtitle' }, `${flavor.name} · ${this.tracker.enabled ? '커서 자동감지 활성' : '수동 대상 모드'}`);

    const header = h(doc, 'header', { class: 'rh-header' },
      h(doc, 'div', { class: 'rh-header-top' },
        h(doc, 'div', { class: 'rh-brand' },
          h(doc, 'div', { class: 'rh-logo' }, 'RH'),
          h(doc, 'div', { class: 'rh-title-wrap' },
            h(doc, 'div', { class: 'rh-title' }, `RisuHelper v${VERSION}`),
            subtitleEl
          )
        ),
        h(doc, 'button', {
          class: 'rh-btn',
          onclick: () => this.close(),
        }, '닫기')
      ),
      h(doc, 'div', { class: 'rh-actions' },
        h(doc, 'button', {
          class: `rh-btn${this.presetPanelOpen ? ' primary' : ' ghost'}`,
          onclick: async () => {
            this.presetPanelOpen = !this.presetPanelOpen;
            if (this.presetPanelOpen) {
              this.settingsOpen = false;
              if (this.presetState.pane === 'preview') await this.refreshPresetPreview();
            }
            this.render();
          },
        }, this.presetState.mode === 'preset' ? '프리셋 · 적용' : '프리셋 · 직접'),
        h(doc, 'button', {
          class: `rh-btn${this.settingsOpen ? ' primary' : ' ghost'}`,
          onclick: () => {
            this.settingsOpen = !this.settingsOpen;
            if (this.settingsOpen) this.presetPanelOpen = false;
            this.render();
          },
        }, '설정'),
        h(doc, 'button', {
          class: `rh-btn${this.isDocked ? ' primary' : ' ghost rh-hide-mobile'}`,
          onclick: () => this.toggleDockMode(),
        }, this.isDocked ? '📌 도킹 해제' : '📌 오른쪽 도킹'),
        h(doc, 'button', {
          class: 'rh-btn ghost',
          onclick: () => {
            this.messages = [];
            this.render();
          },
        }, '대화 비우기'),
        !this.isDocked && h(doc, 'button', {
          class: 'rh-btn ghost rh-hide-mobile',
          onclick: async () => {
            this.settings.wideMode = !this.settings.wideMode;
            await this.saveSettings();
            this.render();
          },
        }, this.settings.wideMode ? '좁게' : '넓게'),
        this.adapter.undoUnitCount() > 0 && h(doc, 'button', {
          class: 'rh-btn',
          title: `다음에 되돌릴 변경: ${this.adapter.peekUndoLabel()}`,
          onclick: async () => {
            try {
              const res = await this.adapter.undo();
              this.syncAppliedCards();
              await this.refreshContextSnapshot();
              this.showToast(this.describeUndoResult(res));
            } catch (err) {
              this.syncAppliedCards();
              this.showToast(err.message);
            }
            this.render();
          },
        }, `되돌리기 (${this.adapter.undoUnitCount()})`)
      )
    );

    const contextBarChildren = [
      h(doc, 'div', { class: 'rh-row', style: 'justify-content:space-between;' },
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
                this.presetPanelOpen = true;
                this.showToast('프리셋 파일을 먼저 가져오세요.');
              } else {
                this.showToast(`프리셋 적용 모드 (${this.presetState.preset.name})`);
              }
            },
          }, '프리셋 적용')
        ),
        h(doc, 'span', { class: 'rh-pill' },
          this.presetState.mode === 'preset'
            ? (this.presetState.preset ? `프리셋: ${this.presetState.preset.name}` : '프리셋 미설정')
            : `모델: ${this.settings.modelMode}`
        )
      ),
      h(doc, 'div', { class: 'rh-row' },
        h(doc, 'select', {
          class: 'rh-select',
          onchange: (e) => this.onSelectTarget(e.target.value),
        },
          ...pickerOpts.map(o => h(doc, 'option', { value: o.value, selected: o.value === this.currentPickerValue() }, o.label))
        ),
        h(doc, 'button', {
          class: 'rh-btn',
          onclick: async () => {
            if (!this.tracker.enabled) await this.tracker.start();
            await this.tracker.scanNow({ allowScreenFallback: true });
            this.manualTarget = null;
            await this.refreshContextSnapshot();
            this.showToast(this.detectedContext ? `감지됨: ${this.detectedContext.labelText}` : '현재 포커스된 입력칸이 없습니다.');
          },
        }, '커서 재감지')
      ),
    ];

    if (subPicker) {
      const rows = Array.isArray(subPicker) ? subPicker : [subPicker];
      for (const pickerEl of rows) {
        if (pickerEl) contextBarChildren.push(h(doc, 'div', { class: 'rh-row' }, pickerEl));
      }
    }

    contextBarChildren.push(
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
      )
    );

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
                const syncRes = await this.syncOpenModuleEditor(
                  this.activeSnapshot.target,
                  this.activeSnapshot.content,
                  { moduleId: this.activeSnapshot.hostBinding?.moduleId || null }
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
      for (const msg of this.messages) {
        const msgWrap = h(doc, 'div', { class: `rh-msg ${msg.role}` });
        if (msg.role === 'user') {
          msgWrap.appendChild(h(doc, 'div', { class: 'rh-bubble' }, msg.content));
        } else {
          const bubble = h(doc, 'div', { class: 'rh-bubble' });
          const barLeft = msg.streaming
            ? h(doc, 'span', { class: 'rh-msg-badge' }, h(doc, 'span', { class: 'rh-streaming-dot' }), '응답 생성 중...')
            : h(doc, 'span', { class: 'rh-msg-badge' }, msg.error ? '오류' : (msg.rawView ? 'RisuHelper · 원문' : 'RisuHelper'));
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
          msgWrap.appendChild(bubble);

          for (const err of msg.parseErrors || []) {
            msgWrap.appendChild(h(doc, 'div', { class: 'rh-banner error' }, `제안 블록 파싱 실패: ${err.error}`));
          }
          const applicable = this.applicableProposals(msg);
          if (applicable.length >= 2 || msg.groupId) {
            msgWrap.appendChild(
              h(doc, 'div', { class: 'rh-row', style: 'gap:6px;flex-wrap:wrap;' },
                applicable.length >= 2 && h(doc, 'button', {
                  class: 'rh-btn primary',
                  disabled: this.busy,
                  onclick: () => this.applyAllProposals(msg),
                }, `모두 적용 (${applicable.length})`),
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
    }

    const textarea = h(doc, 'textarea', {
      class: 'rh-textarea rh-composer-input',
      placeholder: '질문하거나 편집·덮어쓰기·새로 생성을 요청하세요 (Ctrl+Enter 또는 전송)',
      value: prevInput,
      onkeydown: (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          const val = textarea.value;
          textarea.value = '';
          this.sendMessage(val);
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
          onclick: () => {
            const val = textarea.value;
            textarea.value = '';
            this.sendMessage(val);
          },
        }, '전송');

    const composer = h(doc, 'div', { class: 'rh-composer' },
      h(doc, 'div', { class: 'rh-composer-row' }, textarea, sendBtn)
    );

    const drawer = h(doc, 'section', {
      class: `rh-drawer${this.isDocked ? ' docked' : (this.settings.wideMode ? ' wide' : '')}`,
      onclick: (e) => e.stopPropagation(),
    },
      header,
      this.presetPanelOpen && renderPresetPanel(this),
      this.settingsOpen && this.renderSettingsPanel(),
      h(doc, 'div', { class: 'rh-context-bar' }, ...contextBarChildren),
      chatEl,
      composer
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
        if (key && prevDetailsOpen.has(key)) {
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

  async destroy() {
    clearTimeout(this.toastTimer);
    this.currentJob?.stop?.('플러그인이 언로드되었습니다.');
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

export { RisuHelperApp, shouldRegisterHostActionButton };
