import { VERSION, STORAGE_KEY, PRESET_STORAGE_KEY, CHAR_FIELD_META, SCREEN_LABELS } from './version.js';
import { STYLES } from './style.js';
import { FocusTracker } from './focus-detector.js';
import { HostAdapter } from './host-adapter.js';
import { callRisuModel, parseAssistantReply, buildConversationMessages } from './llm.js';
import { buildDiffPreview } from './text-edits.js';
import { getQuickPromptsForContext } from './knowledge.js';
import { newPresetState, validatePresetState, assembleRisuHelperMessages } from './preset-engine.js';
import { renderPresetPanel } from './preset-ui.js';

const DEFAULT_SETTINGS = {
  modelMode: 'model',
  timeoutSeconds: 120,
  maxHistoryTurns: 12,
  showFloatingChip: true,
  includeCharSummary: true,
  includeLoreSummary: true,
  includeConfigSummary: false,
  wideMode: false,
};

const ACTION_LABELS = {
  patch_text: '부분 편집',
  replace_text: '전체 덮어쓰기',
  create_lorebook: '새 로어북 생성',
  update_lorebook: '로어북 수정',
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
    else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected') el[k] = v;
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

/**
 * Safely renders assistant markdown prose (headings, code blocks, inline text) using DOM nodes only.
 */
function renderSafeProse(doc, container, text) {
  const parts = String(text || '').split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3).replace(/^[a-zA-Z0-9_-]*\n/, '');
      container.appendChild(h(doc, 'pre', { class: 'rh-code-block' }, inner));
    } else {
      container.appendChild(h(doc, 'div', {}, part.trim()));
    }
  }
}

class RisuHelperApp {
  constructor(api, doc) {
    this.api = api;
    this.doc = doc;
    this.adapter = new HostAdapter(api);
    this.settings = { ...DEFAULT_SETTINGS };
    this.tracker = new FocusTracker(api, {
      showFloatingChip: this.settings.showFloatingChip,
      onChange: (ctx) => {
        this.detectedContext = ctx;
      },
      onChipClick: () => {
        this.open();
      },
    });

    this.isOpen = false;
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
    this.viewportHandler = null;
  }

  async init() {
    await this.loadSettings();
    await this.loadPresetState();
    this.mountBaseStyles();
    this.syncHostTheme();
    this.bindVisualViewport();

    const openHandler = () => { this.open(); };

    if (typeof this.api.registerButton === 'function') {
      const fab = await this.api.registerButton(
        { name: 'RisuHelper', icon: '✨', iconType: 'html', location: 'action', id: 'risuhelper-fab' },
        openHandler
      );
      if (fab?.id) this.registeredIds.push(fab.id);

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
    this.tracker.start().catch(() => {});

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

  async open() {
    this.isOpen = true;
    await this.syncHostTheme();
    if (typeof this.api.showContainer === 'function') {
      await this.api.showContainer('fullscreen');
    }
    await this.refreshContextSnapshot();
    this.render();
  }

  async close() {
    this.isOpen = false;
    if (typeof this.api.hideContainer === 'function') {
      await this.api.hideContainer();
    }
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
    if (this.settings.includeCharSummary) {
      try {
        const { char } = await this.adapter.readActiveCharacter();
        if (char) {
          extra.charSummary = {
            name: char.name || '',
            descPreview: String(char.desc || '').slice(0, 500),
            firstMessagePreview: String(char.firstMessage || '').slice(0, 300),
            globalLoreCount: char.globalLore?.length ?? 0,
            regexCount: char.customscript?.length ?? 0,
            hasLua: char.triggerscript?.[0]?.effect?.[0]?.type === 'triggerlua',
          };
          if (this.settings.includeLoreSummary && Array.isArray(char.globalLore)) {
            extra.loreSummary = char.globalLore.slice(0, 30).map((e, i) => ({
              index: i,
              comment: e.comment || '',
              key: e.key || '',
              alwaysActive: Boolean(e.alwaysActive),
              insertorder: e.insertorder ?? 100,
            }));
          }
        }
      } catch {}
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

    const job = {
      cancelled: false,
      onChunk: (partial) => {
        assistantMsg.content = partial;
        assistantMsg.rawText = partial;
        this.render();
        this.scrollChatToBottom();
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
        });
      }
    } catch (err) {
      assistantMsg.streaming = false;
      assistantMsg.content = '';
      assistantMsg.error = err.message || String(err);
    } finally {
      this.busy = false;
      this.currentJob = null;
      this.render();
      this.scrollChatToBottom();
    }
  }

  async applyProposalItem(item) {
    const pinnedTarget = item.pinnedTarget || item.preview?.target;
    try {
      const res = await this.adapter.applyProposal(item.proposal, pinnedTarget, {
        bindToCurrentChat: item.bindToCurrentChat,
        hostBinding: item.hostBinding || item.preview?.hostBinding || null,
        requireDestructiveConfirm: Boolean(item.preview?.requiresConfirm),
        destructiveConfirmed: Boolean(item.destructiveConfirmed),
      });
      item.applied = true;
      item.undoId = res.undoId;
      item.statusMessage = res.summary;
      await this.refreshContextSnapshot();
      this.showToast(res.summary);
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
      this.showToast(`되돌렸습니다: ${res.label}`);
    } catch (err) {
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
      { value: 'char_field:firstMessage', label: '캐릭터 · 첫 메시지 (First Message)' },
      { value: 'char_field:systemPrompt', label: '캐릭터 · 시스템 프롬프트' },
      { value: 'char_field:replaceGlobalNote', label: '캐릭터 · 글로벌 노트 덮어쓰기' },
      { value: 'char_field:creatorNotes', label: '캐릭터 · 제작자 코멘트' },
      { value: 'char_field:backgroundHTML', label: '캐릭터 · 백그라운드 임베딩 (HTML)' },
      { value: 'char_lorebook:', label: '캐릭터 로어북 (목록 / 생성)' },
      { value: 'chat_lorebook:', label: '채팅 로컬 로어북 (목록 / 생성)' },
      { value: 'char_lua:', label: '캐릭터 Lua 트리거 스크립트' },
      { value: 'char_regex:', label: '캐릭터 정규식 스크립트' },
      { value: 'persona:', label: '페르소나 (목록 / 생성 · 수정)' },
      { value: 'module_lorebook:', label: '모듈 로어북' },
      { value: 'module_lua:', label: '모듈 Lua 트리거 스크립트' },
      { value: 'module_regex:', label: '모듈 정규식 스크립트' },
      { value: 'config:', label: 'RisuAI 설정 / 컨피그 진단' },
      { value: 'config:customCSS', label: '설정 · Custom CSS' },
      { value: 'general:', label: '일반 질문 / 사용법 안내' },
    ];
    return opts;
  }

  currentPickerValue() {
    if (!this.manualTarget) return 'auto';
    const k = this.manualTarget.targetKind;
    const f = this.manualTarget.fieldKey || '';
    if (k === 'char_field') return `char_field:${f}`;
    if (k === 'config' && f === 'customCSS') return 'config:customCSS';
    return `${k}:`;
  }

  async onSelectTarget(val) {
    if (val === 'auto') {
      this.manualTarget = null;
    } else {
      const [kind, field] = val.split(':');
      const screenMap = {
        char_field: 'character',
        char_lorebook: 'lorebook',
        chat_lorebook: 'lorebook',
        char_lua: 'scripts',
        char_regex: 'scripts',
        persona: 'persona',
        module_lorebook: 'module',
        module_lua: 'module',
        module_regex: 'module',
        config: 'settings',
        general: 'unknown',
      };
      this.manualTarget = {
        screen: screenMap[kind] || 'unknown',
        targetKind: kind,
        fieldKey: field || (kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook' ? 'content' : kind === 'persona' ? 'personaPrompt' : null),
        loreIndex: null,
        loreScope: kind === 'chat_lorebook' ? 'chat' : kind === 'module_lorebook' ? 'module' : kind === 'char_lorebook' ? 'character' : null,
        labelText: kind === 'char_field' ? (CHAR_FIELD_META[field]?.label || field) : (SCREEN_LABELS[screenMap[kind]] || kind),
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
          }, `#${item.index + 1} ${item.comment || '(무제)'}${item.key ? ` [${item.key.slice(0, 24)}]` : ''}`)
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

    if ((ctx.targetKind === 'module_lorebook' || ctx.targetKind === 'module_lua' || ctx.targetKind === 'module_regex') && Array.isArray(this.activeSnapshot.modulesSummary)) {
      return h(doc, 'select', {
        class: 'rh-select',
        onchange: async (e) => {
          const base = this.manualTarget || { ...ctx };
          base.moduleIndex = Number(e.target.value);
          this.manualTarget = base;
          await this.refreshContextSnapshot();
          this.render();
        },
      },
        ...this.activeSnapshot.modulesSummary.map(item =>
          h(doc, 'option', {
            value: String(item.index),
            selected: (ctx.moduleIndex ?? 0) === item.index,
          }, `${item.name || '(무제)'} (로어북 ${item.loreCount}개${item.enabled ? ', 활성' : ''})`)
        )
      );
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
        )
      ),
      h(doc, 'div', { class: 'rh-checks' },
        h(doc, 'label', {},
          h(doc, 'input', {
            type: 'checkbox',
            checked: this.settings.showFloatingChip,
            onchange: async (e) => {
              this.settings.showFloatingChip = Boolean(e.target.checked);
              await this.saveSettings();
              await this.tracker.setChipVisible(this.settings.showFloatingChip);
            },
          }),
          '화면에 현재 포커스 플로팅 칩 표시 (mainDom 필요)'
        )
      )
    );
  }

  render() {
    const doc = this.doc;
    const prevInput = doc.querySelector('.rh-composer-input')?.value ?? '';
    doc.body.textContent = '';

    const ctx = this.getEffectiveContext();
    const flavor = this.adapter.detectHostFlavor();
    const pickerOpts = this.buildTargetPickerOptions();
    const subPicker = this.renderSubItemPicker(ctx);
    const quickPrompts = getQuickPromptsForContext(ctx);

    const header = h(doc, 'header', { class: 'rh-header' },
      h(doc, 'div', { class: 'rh-brand' },
        h(doc, 'div', { class: 'rh-logo' }, 'RH'),
        h(doc, 'div', { class: 'rh-title-wrap' },
          h(doc, 'div', { class: 'rh-title' }, `RisuHelper v${VERSION}`),
          h(doc, 'div', { class: 'rh-subtitle' }, `${flavor.name} · ${this.tracker.enabled ? '커서 자동감지 활성' : '수동 대상 모드'}`)
        )
      ),
      h(doc, 'div', { class: 'rh-actions' },
        this.adapter.undoStack.length > 0 && h(doc, 'button', {
          class: 'rh-btn',
          onclick: async () => {
            try {
              const res = await this.adapter.undo();
              await this.refreshContextSnapshot();
              this.showToast(`되돌림: ${res.label}`);
            } catch (err) {
              this.showToast(err.message);
            }
          },
        }, `되돌리기 (${this.adapter.undoStack.length})`),
        h(doc, 'button', {
          class: 'rh-btn ghost',
          onclick: async () => {
            this.settings.wideMode = !this.settings.wideMode;
            await this.saveSettings();
            this.render();
          },
        }, this.settings.wideMode ? '좁게' : '넓게'),
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
          class: 'rh-btn ghost',
          onclick: () => {
            this.messages = [];
            this.render();
          },
        }, '대화 비우기'),
        h(doc, 'button', {
          class: 'rh-btn',
          onclick: () => this.close(),
        }, '닫기')
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
            await this.tracker.scanNow();
            this.manualTarget = null;
            await this.refreshContextSnapshot();
            this.showToast(this.detectedContext ? `감지됨: ${this.detectedContext.labelText}` : '현재 포커스된 입력칸이 없습니다.');
          },
        }, '커서 재감지')
      ),
    ];

    if (subPicker) {
      contextBarChildren.push(h(doc, 'div', { class: 'rh-row' }, subPicker));
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

    if (this.activeSnapshot && !this.activeSnapshot.ok) {
      contextBarChildren.push(h(doc, 'div', { class: 'rh-banner error' }, this.activeSnapshot.reason));
    } else if (this.activeSnapshot?.content) {
      const content = this.activeSnapshot.content;
      const lineCount = content.split('\n').length;
      contextBarChildren.push(
        h(doc, 'details', { class: 'rh-preview-details' },
          h(doc, 'summary', {}, `현재 원문 보기 (${this.activeSnapshot.label} · ${content.length.toLocaleString()}자 / ${lineCount}줄)`),
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
          if (msg.error) {
            bubble.appendChild(h(doc, 'div', { class: 'rh-banner error' }, `오류: ${msg.error}`));
          } else {
            renderSafeProse(doc, bubble, msg.content);
          }
          msgWrap.appendChild(bubble);

          for (const err of msg.parseErrors || []) {
            msgWrap.appendChild(h(doc, 'div', { class: 'rh-banner error' }, `제안 블록 파싱 실패: ${err.error}`));
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
      class: `rh-drawer${this.settings.wideMode ? ' wide' : ''}`,
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
      class: 'rh-shell',
      onclick: () => this.close(),
    }, drawer);

    doc.body.appendChild(shell);

    if (this.toastText) {
      doc.body.appendChild(h(doc, 'div', { class: 'rh-toast' }, this.toastText));
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

export { RisuHelperApp };
