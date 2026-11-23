//@name risuhelper
//@display-name RisuHelper
//@api 3.0
//@version 0.3.0
//@update-url https://raw.githubusercontent.com/magarindev-ctrl/Risuhelper/main/dist/risuhelper.js
//@link https://github.com/magarindev-ctrl/Risuhelper RisuHelper GitHub

/*
 * RisuHelper v0.3.0 — RisuAI Plugin API v3
 * License: GPL-3.0-only
 * https://github.com/magarindev-ctrl/Risuhelper
 */
(() => {
  'use strict';
  const __RISUHELPER_VERSION__ = "0.3.0";
  const __modules = {
  "src/version.js"(__require, __exports) {
    const VERSION = '0.3.0';
    const PLUGIN_NAME = 'risuhelper';
    const STORAGE_KEY = 'risuhelper_state_v1';
    const PRESET_STORAGE_KEY = 'risuhelper_preset_v1';

    /**
     * Editable configuration keys present in RisuAI's allowedDbKeys
     * across upstream kwaroran/Risuai and major forks (PocketRisu, RisuBard, HaejeokRisuai, RisuNest).
     * Note: 'askRemoval' is intentionally omitted from default config edits because PocketRisu/RisuBard omit it.
     */
    const ALLOWED_CONFIG_KEYS = [
      'temperature',
      'maxContext',
      'maxResponse',
      'frequencyPenalty',
      'PresensePenalty',
      'theme',
      'textTheme',
      'lineHeight',
      'seperateModelsForAxModels',
      'seperateModels',
      'customCSS',
      'guiHTML',
      'colorSchemeName',
      'enabledModules',
      'moduleIntergration',
      'selectedPersona',
    ];

    const CONFIG_KEY_TYPES = {
      temperature: 'number',
      maxContext: 'number',
      maxResponse: 'number',
      frequencyPenalty: 'number',
      PresensePenalty: 'number',
      theme: 'string',
      textTheme: 'string',
      lineHeight: 'number',
      seperateModelsForAxModels: 'boolean',
      seperateModels: 'object',
      customCSS: 'string',
      guiHTML: 'string',
      colorSchemeName: 'string',
      enabledModules: 'array',
      moduleIntergration: 'string',
      selectedPersona: 'number',
    };

    const CHAR_FIELD_META = {
      name: { label: '캐릭터 이름', path: 'char.name', multiline: false },
      desc: { label: '캐릭터 설명 (Description)', path: 'char.desc', multiline: true },
      firstMessage: { label: '첫 메시지 (First Message)', path: 'char.firstMessage', multiline: true },
      creatorNotes: { label: '제작자 코멘트 (Creator Notes)', path: 'char.creatorNotes', multiline: true },
      systemPrompt: { label: '시스템 프롬프트 (System Prompt)', path: 'char.systemPrompt', multiline: true },
      replaceGlobalNote: { label: '글로벌 노트 덮어쓰기 (Replace Global Note)', path: 'char.replaceGlobalNote', multiline: true },
      postHistoryInstructions: { label: '히스토리 이후 지시 (Post-History)', path: 'char.postHistoryInstructions', multiline: true },
      exampleMessage: { label: '예시 대화 (Example Message)', path: 'char.exampleMessage', multiline: true },
      personality: { label: '성격 (Personality)', path: 'char.personality', multiline: true },
      scenario: { label: '시나리오 (Scenario)', path: 'char.scenario', multiline: true },
      backgroundHTML: { label: '백그라운드 임베딩 (Background HTML)', path: 'char.backgroundHTML', multiline: true },
      virtualscript: { label: '캐릭터 스크립트 (virtualscript)', path: 'char.virtualscript', multiline: true },
    };

    const MAX_LLM_CONTENT_CHARS = 24000;
    const ALLOWED_CHAR_FIELDS = Object.keys(CHAR_FIELD_META);
    const ALLOWED_LORE_TEXT_FIELDS = ['comment', 'key', 'secondkey', 'content', 'insertorder'];
    const ALLOWED_PERSONA_TEXT_FIELDS = ['name', 'note', 'personaPrompt'];

    const SCREEN_LABELS = {
      character: '캐릭터 설정',
      lorebook: '로어북',
      scripts: '스크립트 (정규식 · Lua)',
      persona: '페르소나',
      module: '모듈',
      settings: '설정 / 컨피그',
      chat: '채팅 화면',
      unknown: '일반 / 수동 선택',
    };

      __exports.VERSION = VERSION;
      __exports.PLUGIN_NAME = PLUGIN_NAME;
      __exports.STORAGE_KEY = STORAGE_KEY;
      __exports.PRESET_STORAGE_KEY = PRESET_STORAGE_KEY;
      __exports.MAX_LLM_CONTENT_CHARS = MAX_LLM_CONTENT_CHARS;
      __exports.ALLOWED_CONFIG_KEYS = ALLOWED_CONFIG_KEYS;
      __exports.CONFIG_KEY_TYPES = CONFIG_KEY_TYPES;
      __exports.CHAR_FIELD_META = CHAR_FIELD_META;
      __exports.ALLOWED_CHAR_FIELDS = ALLOWED_CHAR_FIELDS;
      __exports.ALLOWED_LORE_TEXT_FIELDS = ALLOWED_LORE_TEXT_FIELDS;
      __exports.ALLOWED_PERSONA_TEXT_FIELDS = ALLOWED_PERSONA_TEXT_FIELDS;
      __exports.SCREEN_LABELS = SCREEN_LABELS;

  },
  "src/style.js"(__require, __exports) {
    const STYLES = `
    :root {
      --rh-bg: #141519;
      --rh-panel: #1b1d23;
      --rh-surface: #23262f;
      --rh-surface-2: #2b2f3a;
      --rh-border: #323746;
      --rh-text: #eceef2;
      --rh-muted: #9ba3b4;
      --rh-accent: #5c8dff;
      --rh-accent-hover: #4679f5;
      --rh-ok: #34d399;
      --rh-warn-bg: rgba(245, 158, 11, 0.14);
      --rh-warn-border: rgba(245, 158, 11, 0.45);
      --rh-warn-text: #fcd34d;
      --rh-err-bg: rgba(239, 68, 68, 0.14);
      --rh-err-border: rgba(239, 68, 68, 0.45);
      --rh-err-text: #fca5a5;
      --rh-diff-add-bg: rgba(16, 185, 129, 0.16);
      --rh-diff-add-text: #6ee7b7;
      --rh-diff-del-bg: rgba(239, 68, 68, 0.16);
      --rh-diff-del-text: #fca5a5;
      --rh-backdrop: rgba(8, 10, 14, 0.45);
      --rh-radius: 12px;
      --rh-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
      --rh-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    :root[data-theme="light"] {
      --rh-bg: #f6f7f9;
      --rh-panel: #ffffff;
      --rh-surface: #f1f3f7;
      --rh-surface-2: #e6eaf1;
      --rh-border: #d5dbe6;
      --rh-text: #181c24;
      --rh-muted: #5a6477;
      --rh-accent: #2563eb;
      --rh-accent-hover: #1d4ed8;
      --rh-ok: #059669;
      --rh-warn-bg: #fffbeb;
      --rh-warn-border: #f59e0b;
      --rh-warn-text: #92400e;
      --rh-err-bg: #fef2f2;
      --rh-err-border: #ef4444;
      --rh-err-text: #991b1b;
      --rh-diff-add-bg: #dcfce7;
      --rh-diff-add-text: #166534;
      --rh-diff-del-bg: #fee2e2;
      --rh-diff-del-text: #991b1b;
      --rh-backdrop: rgba(15, 23, 42, 0.35);
    }

    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      color: var(--rh-text);
      font-family: var(--rh-font);
      font-size: 14px;
      line-height: 1.5;
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }

    .rh-shell {
      position: fixed;
      inset: 0;
      display: flex;
      justify-content: flex-end;
      background: var(--rh-backdrop);
      backdrop-filter: blur(2px);
    }

    .rh-drawer {
      width: min(520px, 96vw);
      height: 100%;
      background: var(--rh-panel);
      border-left: 1px solid var(--rh-border);
      display: flex;
      flex-direction: column;
      box-shadow: -8px 0 32px rgba(0, 0, 0, 0.35);
      overflow: hidden;
      transition: width 160ms ease;
    }

    .rh-drawer.wide {
      width: min(860px, 98vw);
    }

    @media (max-width: 839px) {
      .rh-shell {
        align-items: flex-end;
        justify-content: center;
      }
      .rh-drawer, .rh-drawer.wide {
        width: 100%;
        height: min(92%, 100vh);
        border-left: none;
        border-top: 1px solid var(--rh-border);
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.4);
      }
      .rh-hide-mobile {
        display: none !important;
      }
    }

    .rh-shell.docked {
      align-items: stretch;
      justify-content: stretch;
      background: transparent;
      backdrop-filter: none;
    }

    .rh-drawer.docked,
    .rh-drawer.docked.wide {
      width: 100%;
      max-width: 100%;
      height: 100%;
      border-left: none;
      border-top: none;
      border-radius: 0;
      box-shadow: none;
    }

    .rh-live-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--rh-ok);
      margin-right: 5px;
      vertical-align: middle;
      box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.22);
    }

    .rh-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 14px;
      background: var(--rh-bg);
      border-bottom: 1px solid var(--rh-border);
      flex-shrink: 0;
    }

    .rh-header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .rh-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }

    .rh-logo {
      width: 26px;
      height: 26px;
      border-radius: 8px;
      background: var(--rh-accent);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .rh-title-wrap {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .rh-title {
      font-size: 14px;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rh-subtitle {
      font-size: 11px;
      color: var(--rh-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .rh-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .rh-preset-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 320px;
      overflow-y: auto;
    }

    .rh-btn {
      appearance: none;
      border: 1px solid var(--rh-border);
      background: var(--rh-surface);
      color: var(--rh-text);
      border-radius: 8px;
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .rh-btn:hover:not(:disabled) {
      background: var(--rh-surface-2);
      border-color: var(--rh-muted);
    }

    .rh-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .rh-btn.primary {
      background: var(--rh-accent);
      border-color: var(--rh-accent);
      color: #fff;
    }

    .rh-btn.primary:hover:not(:disabled) {
      background: var(--rh-accent-hover);
    }

    .rh-btn.danger {
      background: var(--rh-err-bg);
      border-color: var(--rh-err-border);
      color: var(--rh-err-text);
    }

    .rh-btn.ghost {
      background: transparent;
    }

    .rh-context-bar {
      padding: 10px 14px;
      background: var(--rh-surface);
      border-bottom: 1px solid var(--rh-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }

    .rh-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .rh-select {
      flex: 1;
      min-width: 140px;
      background: var(--rh-bg);
      color: var(--rh-text);
      border: 1px solid var(--rh-border);
      border-radius: 8px;
      padding: 6px 8px;
      font-size: 12px;
      font-family: var(--rh-font);
    }

    .rh-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: var(--rh-surface-2);
      border: 1px solid var(--rh-border);
      color: var(--rh-text);
    }

    .rh-pill.detected {
      border-color: var(--rh-accent);
      color: var(--rh-accent);
    }

    .rh-checks {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 11px;
      color: var(--rh-muted);
    }

    .rh-checks label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
    }

    .rh-preview-details {
      font-size: 12px;
      border: 1px solid var(--rh-border);
      border-radius: 8px;
      background: var(--rh-bg);
      padding: 6px 8px;
    }

    .rh-preview-details summary {
      cursor: pointer;
      color: var(--rh-muted);
      font-weight: 600;
      user-select: none;
    }

    .rh-preview-pre {
      margin: 6px 0 0;
      max-height: 150px;
      overflow: auto;
      font-family: var(--rh-mono);
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--rh-text);
    }

    .rh-banner {
      padding: 8px 10px;
      border-radius: 8px;
      font-size: 12px;
      border: 1px solid var(--rh-warn-border);
      background: var(--rh-warn-bg);
      color: var(--rh-warn-text);
    }

    .rh-banner.error {
      border-color: var(--rh-err-border);
      background: var(--rh-err-bg);
      color: var(--rh-err-text);
    }

    .rh-settings-panel {
      padding: 12px 14px;
      background: var(--rh-bg);
      border-bottom: 1px solid var(--rh-border);
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex-shrink: 0;
    }

    .rh-settings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .rh-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 11px;
      color: var(--rh-muted);
    }

    .rh-input {
      background: var(--rh-surface);
      color: var(--rh-text);
      border: 1px solid var(--rh-border);
      border-radius: 8px;
      padding: 6px 8px;
      font-size: 12px;
      font-family: var(--rh-font);
    }

    .rh-chat {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .rh-empty {
      margin: auto 0;
      text-align: center;
      padding: 20px 12px;
      color: var(--rh-muted);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }

    .rh-quick-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
    }

    .rh-chip {
      border: 1px solid var(--rh-border);
      background: var(--rh-surface);
      color: var(--rh-text);
      border-radius: 999px;
      padding: 6px 11px;
      font-size: 12px;
      cursor: pointer;
    }

    .rh-chip:hover {
      border-color: var(--rh-accent);
      color: var(--rh-accent);
    }

    .rh-msg {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-width: 100%;
    }

    .rh-msg.user {
      align-items: flex-end;
    }

    .rh-bubble {
      padding: 9px 12px;
      border-radius: 12px;
      max-width: 94%;
      word-break: break-word;
      white-space: pre-wrap;
      font-size: 13px;
    }

    .rh-msg.user .rh-bubble {
      background: var(--rh-accent);
      color: #fff;
      border-bottom-right-radius: 4px;
    }

    .rh-msg.assistant .rh-bubble {
      background: var(--rh-surface);
      border: 1px solid var(--rh-border);
      border-bottom-left-radius: 4px;
      width: 100%;
      max-width: 100%;
    }

    .rh-code-block {
      margin: 6px 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--rh-bg);
      border: 1px solid var(--rh-border);
      font-family: var(--rh-mono);
      font-size: 11.5px;
      overflow-x: auto;
      white-space: pre;
    }

    .rh-proposal {
      border: 1px solid var(--rh-border);
      border-radius: 10px;
      background: var(--rh-bg);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .rh-proposal-head {
      padding: 8px 10px;
      background: var(--rh-surface);
      border-bottom: 1px solid var(--rh-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .rh-proposal-title {
      font-size: 12px;
      font-weight: 700;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .rh-proposal-body {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .rh-diff {
      max-height: 220px;
      overflow: auto;
      border: 1px solid var(--rh-border);
      border-radius: 6px;
      font-family: var(--rh-mono);
      font-size: 11px;
      line-height: 1.45;
      background: var(--rh-panel);
    }

    .rh-diff-line {
      padding: 1px 8px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .rh-diff-line.add {
      background: var(--rh-diff-add-bg);
      color: var(--rh-diff-add-text);
    }

    .rh-diff-line.del {
      background: var(--rh-diff-del-bg);
      color: var(--rh-diff-del-text);
    }

    .rh-diff-line.meta {
      color: var(--rh-muted);
      font-style: italic;
    }

    .rh-proposal-foot {
      padding: 8px 10px;
      border-top: 1px solid var(--rh-border);
      background: var(--rh-surface);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .rh-composer {
      padding: 10px 14px;
      background: var(--rh-bg);
      border-top: 1px solid var(--rh-border);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }

    .rh-composer-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }

    .rh-textarea {
      flex: 1;
      min-height: 44px;
      max-height: 140px;
      resize: none;
      background: var(--rh-surface);
      color: var(--rh-text);
      border: 1px solid var(--rh-border);
      border-radius: 10px;
      padding: 9px 11px;
      font-family: var(--rh-font);
      font-size: 13px;
      line-height: 1.45;
      outline: none;
    }

    .rh-textarea:focus {
      border-color: var(--rh-accent);
    }

    .rh-seg {
      display: inline-flex;
      border: 1px solid var(--rh-border);
      border-radius: 8px;
      overflow: hidden;
      background: var(--rh-surface);
    }

    .rh-seg-btn {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--rh-muted);
      padding: 5px 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .rh-seg-btn.active {
      background: var(--rh-accent);
      color: #fff;
    }

    .rh-meta-diff {
      border: 1px solid var(--rh-border);
      border-radius: 6px;
      background: var(--rh-panel);
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 11.5px;
    }

    .rh-meta-diff-row {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 5px;
      font-family: var(--rh-mono);
      font-size: 11px;
      word-break: break-word;
    }

    .rh-meta-key {
      font-family: var(--rh-font);
      font-weight: 700;
      color: var(--rh-muted);
    }

    .rh-meta-old {
      background: var(--rh-diff-del-bg);
      color: var(--rh-diff-del-text);
      padding: 0 4px;
      border-radius: 4px;
      text-decoration: line-through;
    }

    .rh-meta-new {
      background: var(--rh-diff-add-bg);
      color: var(--rh-diff-add-text);
      padding: 0 4px;
      border-radius: 4px;
    }

    .rh-toast {
      position: fixed;
      left: 50%;
      bottom: 18px;
      transform: translateX(-50%);
      padding: 8px 14px;
      border-radius: 999px;
      background: var(--rh-text);
      color: var(--rh-bg);
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
      z-index: 20;
      pointer-events: none;
    }
    `;

      __exports.STYLES = STYLES;

  },
  "src/focus-detector.js"(__require, __exports) {
    const { SCREEN_LABELS, CHAR_FIELD_META } = __require("src/version.js");

    const FOCUS_SELECTOR = 'textarea:focus, input:focus, [contenteditable="true"]:focus, [contenteditable=""]:focus';
    const CHAT_INPUT_SELECTOR = 'textarea.text-input-area, textarea#messageInputTranslate, .text-input-area, .chat-input textarea';
    const CHIP_ATTR = 'x-risuhelper-chip';
    const DRAG_THRESHOLD_PX = 6;

    /**
     * Safely parses attributes from the opening HTML tag string returned by SafeElement.getOuterHTML().
     * (Plugin v3 SafeElement.getAttribute() only allows 'x-*' attributes.)
     */
    function parseOpeningTagAttrs(outerHtml) {
      const attrs = {};
      if (typeof outerHtml !== 'string') return attrs;
      const openMatch = outerHtml.match(/^<([a-zA-Z0-9-]+)([\s\S]*?)>/);
      if (!openMatch) return attrs;
      attrs._tag = openMatch[1].toLowerCase();
      const rawAttrs = openMatch[2];
      const re = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      let m;
      while ((m = re.exec(rawAttrs))) {
        const key = m[1].toLowerCase();
        const val = m[2] ?? m[3] ?? m[4] ?? '';
        attrs[key] = decodeBasicEntities(val);
      }
      return attrs;
    }

    function decodeBasicEntities(str) {
      return String(str)
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    }

    function normalizeLabel(text) {
      return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    }

    function matchAny(text, keywords) {
      const norm = normalizeLabel(text);
      if (!norm) return false;
      return keywords.some(kw => norm === kw || norm.startsWith(kw + ' ') || norm.includes(kw));
    }

    function isChatElementAttrs(attrs) {
      const cls = String(attrs?.class || '');
      const id = String(attrs?.id || '');
      return (
        cls.includes('text-input-area') ||
        cls.includes('chat-input') ||
        id === 'messageInputTranslate'
      );
    }

    function hasUsableRect(rect) {
      return Boolean(
        rect &&
        Number.isFinite(rect.top) &&
        Number.isFinite(rect.left) &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height) &&
        (rect.width > 0 || rect.height > 0)
      );
    }

    function rectsMatch(a, b) {
      if (!hasUsableRect(a) || !hasUsableRect(b)) return false;
      return (
        Math.abs(a.top - b.top) < 0.5 &&
        Math.abs(a.left - b.left) < 0.5 &&
        Math.abs(a.width - b.width) < 0.5 &&
        Math.abs(a.height - b.height) < 0.5
      );
    }

    function isTokenCountText(text) {
      return /^\d+\s*(토큰|tokens?)$/.test(normalizeLabel(text));
    }

    function isMutedHelperSpan(className, text) {
      const cls = String(className || '');
      if (cls.includes('text-textcolor2') || cls.includes('text-xs') || cls.includes('text-draculared')) {
        return true;
      }
      return isTokenCountText(text);
    }

    /**
     * Checks whether a sibling <div> is TriggerList.svelte's V1/V2/Lua mode bar
     * with the Lua button active (`<button class="... ring-1">Lua</button>`).
     * Inspects only direct button children of small (<=4 child) containers to avoid
     * false positives from unrelated page subtrees.
     */
    async function isLuaModeBar(el, className) {
      const cls = String(className || '');
      if (cls.includes('n-scroll') || cls.includes('border-darkborderc') || cls.includes('seperator')) {
        return false;
      }
      try {
        const kids = await el.getChildren();
        const len = kids ? await kids.length() : 0;
        if (len === 0 || len > 4) return false;
        for (let k = 0; k < len; k++) {
          const btn = await kids.at(k);
          if (!btn) continue;
          const bName = String(await btn.nodeName()).toLowerCase();
          if (bName !== 'button') continue;
          const bCls = String((await btn.getClassName()) || '');
          const bText = String((await btn.textContent()) || '').trim();
          if (bText === 'Lua' && bCls.includes('ring-1')) {
            return true;
          }
        }
      } catch {}
      return false;
    }

    /**
     * Pure classification logic: takes DOM snapshot signals gathered from SafeElement traversal
     * and resolves a structured FocusContext suitable for RisuHelper's host adapter & LLM.
     */
    function classifyDomSignals(signals) {
      const {
        tag = '',
        placeholder = '',
        inputType = '',
        isContentEditable = false,
        liveTextPreview = '',
        nearbyLabel = '',
        headings = [],
        loreIdx = null,
        activeTabs = [],
        luaButtonActive = false,
        hasRegexContainer = false,
        hasTriggerContainer = false,
        isChatInput = false,
      } = signals || {};

      const headingText = headings.join(' | ');
      const activeTabText = activeTabs.join(' | ');
      const warnings = [];

      // 0. Explicit chat input textarea (DefaultChatScreen.svelte: textarea.text-input-area / #messageInputTranslate)
      // Checked first so random <h2> tags inside chat messages/sidebars never misclassify the chat composer.
      if (isChatInput) {
        return {
          detectedAt: Date.now(),
          screen: 'chat',
          targetKind: 'general',
          fieldKey: null,
          loreIndex: null,
          loreScope: null,
          labelText: '채팅 입력 화면',
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      // 1. Persona settings screen
      const isPersonaScreen =
        matchAny(headingText, ['페르소나', 'persona']) ||
        placeholder.toLowerCase().includes('description of this persona') ||
        placeholder.toLowerCase().includes('persona');

      if (isPersonaScreen) {
        let fieldKey = 'personaPrompt';
        if (matchAny(nearbyLabel, ['이름', 'name']) || placeholder === 'User') {
          fieldKey = 'name';
        } else if (matchAny(nearbyLabel, ['메모', 'note'])) {
          fieldKey = 'note';
        } else if (matchAny(nearbyLabel, ['설명', 'description'])) {
          fieldKey = 'personaPrompt';
        }
        return {
          detectedAt: Date.now(),
          screen: 'persona',
          targetKind: 'persona',
          fieldKey,
          loreIndex: null,
          loreScope: null,
          labelText: `페르소나 · ${fieldKey === 'name' ? '이름' : fieldKey === 'note' ? '메모' : '설명 프롬프트'}`,
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      // 2. Module settings / edit screen
      const isModuleEdit = matchAny(headingText, ['모듈 수정', 'edit module', '모듈 생성', 'create module']);
      const isModuleScreen = isModuleEdit || matchAny(headingText, ['모듈', 'modules']);

      if (isModuleEdit) {
        warnings.push('모듈 편집 화면(tempModule)이 열려 있습니다. 플러그인에서 모듈을 저장한 뒤 하단 "모듈 수정" 버튼을 누르면 플러그인 변경이 덮어써질 수 있으니, 편집창을 닫고 다시 확인하세요.');
      }

      // 3. Lua trigger script editor (strictly verified via adjacent Lua mode bar or explicit trigger script label)
      if (
        luaButtonActive ||
        hasTriggerContainer ||
        matchAny(nearbyLabel, ['트리거 스크립트', 'trigger script'])
      ) {
        const targetKind = isModuleScreen ? 'module_lua' : 'char_lua';
        return {
          detectedAt: Date.now(),
          screen: isModuleScreen ? 'module' : 'scripts',
          targetKind,
          fieldKey: 'code',
          loreIndex: null,
          loreScope: null,
          labelText: `${isModuleScreen ? '모듈' : '캐릭터'} Lua 트리거 스크립트`,
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      // 4. Regex script editor (checked BEFORE lorebook because RegexData.svelte also carries data-risu-idx)
      if (hasRegexContainer || matchAny(nearbyLabel, ['정규식 스크립트', 'regex script'])) {
        const targetKind = isModuleScreen ? 'module_regex' : 'char_regex';
        const regexIdx = loreIdx !== null && Number.isInteger(loreIdx) && loreIdx >= 0 ? loreIdx : null;
        let fieldKey = 'in';
        if (matchAny(nearbyLabel, ['out', '출력', '치환'])) fieldKey = 'out';
        else if (matchAny(nearbyLabel, ['이름', 'name', 'comment'])) fieldKey = 'comment';
        return {
          detectedAt: Date.now(),
          screen: isModuleScreen ? 'module' : 'scripts',
          targetKind,
          fieldKey,
          loreIndex: null,
          loreScope: null,
          regexIndex: regexIdx,
          labelText: `${isModuleScreen ? '모듈' : '캐릭터'} 정규식 스크립트${regexIdx !== null ? ` #${regexIdx + 1}` : ''}`,
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      // 5. Lorebook item (identified by data-risu-idx inside LoreBookData)
      if (loreIdx !== null && Number.isInteger(loreIdx) && loreIdx >= 0) {
        let loreScope = 'character';
        let targetKind = 'char_lorebook';
        if (isModuleScreen) {
          loreScope = 'module';
          targetKind = 'module_lorebook';
        } else if (matchAny(activeTabText, ['채팅', 'chat'])) {
          loreScope = 'chat';
          targetKind = 'chat_lorebook';
        }

        let fieldKey = 'content';
        if (matchAny(nearbyLabel, ['폴더 이름', 'folder name', '이름', 'name'])) fieldKey = 'comment';
        else if (matchAny(nearbyLabel, ['두번째 키', 'secondary keys', '보조 키'])) fieldKey = 'secondkey';
        else if (matchAny(nearbyLabel, ['활성화 키', 'activation keys'])) fieldKey = 'key';
        else if (matchAny(nearbyLabel, ['배치 순서', 'insert order'])) fieldKey = 'insertorder';
        else if (matchAny(nearbyLabel, ['프롬프트', 'prompt']) || tag === 'textarea' || isContentEditable) fieldKey = 'content';

        const scopeLabel = loreScope === 'module' ? '모듈 로어북' : loreScope === 'chat' ? '채팅 로어북' : '캐릭터 로어북';
        const fieldLabelMap = { comment: '이름', key: '활성화 키', secondkey: '보조 키', insertorder: '배치 순서', content: '본문' };
        return {
          detectedAt: Date.now(),
          screen: isModuleScreen ? 'module' : 'lorebook',
          targetKind,
          fieldKey,
          loreIndex: loreIdx,
          loreScope,
          labelText: `${scopeLabel} #${loreIdx + 1} · ${fieldLabelMap[fieldKey] || fieldKey}`,
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      // 6. Module screen non-lorebook fields
      if (isModuleScreen) {
        let fieldKey = 'description';
        if (matchAny(nearbyLabel, ['백그라운드 임베딩', 'background embedding'])) fieldKey = 'backgroundEmbedding';
        else if (matchAny(nearbyLabel, ['토글', 'toggle'])) fieldKey = 'customModuleToggle';
        else if (matchAny(nearbyLabel, ['이름', 'name'])) fieldKey = 'name';
        return {
          detectedAt: Date.now(),
          screen: 'module',
          targetKind: 'module_lorebook',
          fieldKey,
          loreIndex: null,
          loreScope: 'module',
          labelText: `모듈 설정 · ${nearbyLabel || fieldKey}`,
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      // 7. Explicit config CSS/HTML fields
      if (matchAny(nearbyLabel, ['커스텀 css', 'custom css', 'gui html'])) {
        const fieldKey = matchAny(nearbyLabel, ['gui html']) ? 'guiHTML' : 'customCSS';
        return {
          detectedAt: Date.now(),
          screen: 'settings',
          targetKind: 'config',
          fieldKey,
          loreIndex: null,
          loreScope: null,
          labelText: `설정 · ${fieldKey}`,
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      // 8. Chat Author's Note (CharConfig.svelte -> char.chats[chatPage].note)
      if (matchAny(nearbyLabel, ['작가의 노트', "author's note", 'author note'])) {
        return {
          detectedAt: Date.now(),
          screen: 'character',
          targetKind: 'chat_note',
          fieldKey: 'note',
          loreIndex: null,
          loreScope: null,
          labelText: '작가의 노트 (현재 채팅)',
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      // 9. Character config fields (CharConfig.svelte — checked BEFORE generic Settings headings
      //    because CharConfig's Advanced tab also renders <h2>고급 설정</h2>)
      const charFieldChecks = [
        ['name', ['character name', 'group name', '캐릭터 이름', '그룹 이름']],
        ['desc', ['설명', 'description', '캐릭터 설명']],
        ['firstMessage', ['첫 메시지', 'first message']],
        ['creatorNotes', ['제작자 코멘트', "creator's comment", 'creator notes']],
        ['systemPrompt', ['시스템 프롬프트', 'system prompt']],
        ['replaceGlobalNote', ['글로벌 노트 덮어쓰기', 'global note replacement']],
        ['postHistoryInstructions', ['히스토리 이후', 'post history', 'post-history']],
        ['exampleMessage', ['예시 대화', 'example message']],
        ['personality', ['성격', 'personality']],
        ['scenario', ['시나리오', 'scenario']],
        ['backgroundHTML', ['백그라운드 임베딩', 'background embedding', 'background html']],
        ['virtualscript', ['캐릭터js', '캐릭터 js', 'charjs', 'character js']],
      ];

      for (const [key, terms] of charFieldChecks) {
        if (matchAny(nearbyLabel, terms) || matchAny(placeholder, terms)) {
          const meta = CHAR_FIELD_META[key];
          return {
            detectedAt: Date.now(),
            screen: key === 'backgroundHTML' || key === 'virtualscript' ? 'scripts' : 'character',
            targetKind: 'char_field',
            fieldKey: key,
            loreIndex: null,
            loreScope: null,
            labelText: meta ? meta.label : key,
            placeholder,
            liveTextPreview,
            warnings,
          };
        }
      }

      // 10. Settings / Config screens
      const isSettingsScreen = matchAny(headingText, [
        '채팅 봇', 'chat bot', '기타 봇', 'other bots', '소리 및 디스플레이', 'display',
        '고급 설정', 'advanced settings', '프롬프트 템플릿', 'prompt template', '접근성', 'accessibility',
      ]);

      if (isSettingsScreen) {
        return {
          detectedAt: Date.now(),
          screen: 'settings',
          targetKind: 'config',
          fieldKey: null,
          loreIndex: null,
          loreScope: null,
          labelText: `설정 / 컨피그 (${headings[0] || '일반'})`,
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      // 11. Lorebook heading open without specific item focused
      if (matchAny(headingText, ['로어북', 'lorebook'])) {
        const isChat = matchAny(activeTabText, ['채팅', 'chat']);
        return {
          detectedAt: Date.now(),
          screen: 'lorebook',
          targetKind: isChat ? 'chat_lorebook' : 'char_lorebook',
          fieldKey: 'content',
          loreIndex: null,
          loreScope: isChat ? 'chat' : 'character',
          labelText: isChat ? '채팅 로어북 목록' : '캐릭터 로어북 목록',
          placeholder,
          liveTextPreview,
          warnings,
        };
      }

      return {
        detectedAt: Date.now(),
        screen: 'unknown',
        targetKind: 'general',
        fieldKey: null,
        loreIndex: null,
        loreScope: null,
        labelText: nearbyLabel
          ? `${SCREEN_LABELS.unknown} (${nearbyLabel.slice(0, 28)})`
          : SCREEN_LABELS.unknown,
        placeholder,
        liveTextPreview,
        warnings,
      };
    }

    /**
     * Inspects the currently focused element in RisuAI's SafeDocument (`rootDoc`).
     * Returns null if nothing editable is focused (or if mainDom is unavailable).
     */
    async function inspectFocusedElement(rootDoc) {
      if (!rootDoc) return null;
      let el;
      try {
        el = await rootDoc.querySelector(FOCUS_SELECTOR);
      } catch {
        return null;
      }
      if (!el) return null;

      try {
        const outerHtml = await el.getOuterHTML();
        const attrs = parseOpeningTagAttrs(outerHtml);
        const tag = attrs._tag || String(await el.nodeName()).toLowerCase();
        const isContentEditable = attrs.contenteditable === 'true' || attrs.contenteditable === '';

        // Ignore our own injected chip if ever focused
        if (attrs[CHIP_ATTR] !== undefined) return null;

        let liveTextPreview = '';
        if (isContentEditable) {
          try {
            liveTextPreview = String((await el.innerText()) || '').slice(0, 600);
          } catch {}
        }

        let elRect = null;
        try {
          if (typeof el.getBoundingClientRect === 'function') {
            const rect = await el.getBoundingClientRect();
            if (hasUsableRect(rect)) elRect = rect;
          }
        } catch {}

        const headings = [];
        const activeTabs = [];
        let nearbyLabel = '';
        let loreIdx = null;
        let luaButtonActive = false;
        let hasRegexContainer = false;
        let hasTriggerContainer = false;
        // Check the focused element itself first (DefaultChatScreen puts `text-input-area` directly on <textarea>)
        let isChatInput = isChatElementAttrs(attrs);

        // Walk up ancestors (bounded to 8 hops to stay fast over iframe RPC)
        let cur = el;
        let curOuter = outerHtml;
        let curTag = tag;
        for (let depth = 0; depth < 8 && cur; depth++) {
          const parent = await cur.getParent();
          if (!parent) break;

          const pOuter = await parent.getOuterHTML();
          const pAttrs = parseOpeningTagAttrs(pOuter);

          if (loreIdx === null && pAttrs['data-risu-idx'] !== undefined) {
            const parsed = parseInt(pAttrs['data-risu-idx'], 10);
            if (!Number.isNaN(parsed)) loreIdx = parsed;
          }

          // Inspect direct children of close ancestors for labels, headings, and Lua/Regex/tab markers
          if (depth <= 4) {
            const children = await parent.getChildren();
            const len = children ? await children.length() : 0;
            const limit = Math.min(len, 64);
            const checkLocalContext = depth <= 3;

            // When depth > 0, check if SafeElement.querySelector(':focus') resolves the exact descendant branch.
            // This disambiguates sibling TextAreaInput wrappers that share identical outerHTML (e.g. PocketRisu).
            let focusQueryWorks = false;
            if (checkLocalContext && depth > 0 && typeof parent.querySelector === 'function') {
              try {
                focusQueryWorks = Boolean(await parent.querySelector(FOCUS_SELECTOR));
              } catch {}
            }

            let prevPrimarySpan = '';
            let prevFallbackSpan = '';
            let prevSiblingWasLuaBar = false;
            let foundCur = false;
            const containerSpanLabels = [];

            for (let i = 0; i < limit; i++) {
              const child = await children.at(i);
              if (!child) continue;
              const cName = String(await child.nodeName()).toLowerCase();

              // 1. Identify the exact sibling matching `cur`
              let isCur = false;
              if (checkLocalContext && !foundCur && (!curTag || cName === curTag)) {
                if (depth > 0 && focusQueryWorks) {
                  try {
                    isCur = Boolean(await child.querySelector(FOCUS_SELECTOR));
                  } catch {}
                } else if (depth === 0 && elRect && typeof child.getBoundingClientRect === 'function') {
                  try {
                    const cRect = await child.getBoundingClientRect();
                    isCur = rectsMatch(elRect, cRect);
                  } catch {}
                }
                if (!isCur && !focusQueryWorks && !(depth === 0 && elRect)) {
                  try {
                    const cOuter = await child.getOuterHTML();
                    isCur = cOuter === outerHtml || (depth > 0 && cOuter === curOuter);
                  } catch {}
                }
              }

              if (isCur) {
                foundCur = true;
                const candidateLabel = prevPrimarySpan || prevFallbackSpan;
                if (!nearbyLabel && candidateLabel) {
                  nearbyLabel = candidateLabel;
                }
                if (prevSiblingWasLuaBar) {
                  luaButtonActive = true;
                  hasTriggerContainer = true;
                }
                continue;
              }

              // 2. Gather headings, labels, RegexData markers, active tabs, and immediate Lua mode bars
              if (cName === 'h2' || cName === 'h3') {
                const ht = String((await child.textContent()) || '').trim();
                if (ht && !headings.includes(ht)) headings.push(ht);
                if (!foundCur) prevSiblingWasLuaBar = false;
              } else if (cName === 'span' || cName === 'label') {
                const st = String((await child.textContent()) || '').trim();
                const cClass = String((await child.getClassName()) || '');
                if (st && st.length <= 60) {
                  if (checkLocalContext) {
                    containerSpanLabels.push(normalizeLabel(st));
                  }
                  if (!foundCur) {
                    if (isMutedHelperSpan(cClass, st)) {
                      if (!isTokenCountText(st)) {
                        prevFallbackSpan = st;
                      }
                    } else {
                      prevPrimarySpan = st;
                      prevFallbackSpan = '';
                      prevSiblingWasLuaBar = false;
                    }
                  }
                }
              } else if (cName === 'button') {
                const cls = String((await child.getClassName()) || '');
                const bt = String((await child.textContent()) || '').trim();
                if (checkLocalContext && !foundCur) {
                  if (bt === 'Lua' && cls.includes('ring-1')) {
                    prevSiblingWasLuaBar = true;
                  } else {
                    prevSiblingWasLuaBar = false;
                  }
                }
                if ((cls.includes('bg-selected') || cls.includes('bg-darkbutton')) && bt && bt.length <= 32) {
                  if (!activeTabs.includes(bt)) activeTabs.push(bt);
                }
              } else if (checkLocalContext && !foundCur) {
                if (cName === 'div') {
                  const cClass = String((await child.getClassName()) || '');
                  if (await isLuaModeBar(child, cClass)) {
                    prevSiblingWasLuaBar = true;
                  } else {
                    prevSiblingWasLuaBar = false;
                    if (
                      cClass.includes('border-darkborderc') ||
                      cClass.includes('n-scroll') ||
                      cClass.includes('border-selected')
                    ) {
                      prevPrimarySpan = '';
                      prevFallbackSpan = '';
                    }
                  }
                } else if (cName === 'input' || cName === 'textarea' || cName === 'select' || cName === 'table') {
                  prevPrimarySpan = '';
                  prevFallbackSpan = '';
                  prevSiblingWasLuaBar = false;
                } else if (cName !== 'p') {
                  prevSiblingWasLuaBar = false;
                }
              }
            }

            // Strict RegexData.svelte structural check (direct child labels only; never whole-subtree outerHTML)
            if (
              checkLocalContext &&
              !hasRegexContainer &&
              (containerSpanLabels.includes('modification type') ||
                (containerSpanLabels.includes('in:') && containerSpanLabels.includes('out:')))
            ) {
              hasRegexContainer = true;
            }
          }

          if (depth === 4 || depth === 6) {
            try {
              const h2 = await parent.querySelector('h2');
              if (h2) {
                const ht = String((await h2.textContent()) || '').trim();
                if (ht && !headings.includes(ht)) headings.push(ht);
              }
            } catch {}
          }

          if (!isChatInput && isChatElementAttrs(pAttrs)) {
            isChatInput = true;
          }

          cur = parent;
          curOuter = pOuter;
          curTag = pAttrs._tag || '';
        }

        // Also look at top-level headings in rootDoc if none found locally
        if (!isChatInput && headings.length === 0) {
          try {
            const allH2 = await rootDoc.querySelectorAll('h2');
            const count = allH2 ? Math.min(await allH2.length(), 4) : 0;
            for (let i = 0; i < count; i++) {
              const node = await allH2.at(i);
              const txt = node ? String((await node.textContent()) || '').trim() : '';
              if (txt && !headings.includes(txt)) headings.push(txt);
            }
          } catch {}
        }

        return classifyDomSignals({
          tag,
          placeholder: attrs.placeholder || '',
          inputType: attrs.type || '',
          isContentEditable,
          liveTextPreview,
          nearbyLabel,
          headings,
          loreIdx,
          activeTabs,
          luaButtonActive,
          hasRegexContainer,
          hasTriggerContainer,
          isChatInput,
        });
      } catch {
        return null;
      }
    }

    /**
     * Fallback screen detector when no editable input currently holds `:focus`
     * (for example, opening RisuHelper directly from the chat screen or after mobile blur).
     */
    async function inspectVisibleScreen(rootDoc) {
      if (!rootDoc) return null;
      try {
        const headings = [];
        try {
          const allH2 = await rootDoc.querySelectorAll('h2');
          const count = allH2 ? Math.min(await allH2.length(), 6) : 0;
          for (let i = 0; i < count; i++) {
            const node = await allH2.at(i);
            const txt = node ? String((await node.textContent()) || '').trim() : '';
            if (txt && !headings.includes(txt)) headings.push(txt);
          }
        } catch {}

        // Check explicit chat input presence first; if present and no settings/persona/module modal heading is active, it's the chat screen.
        let chatInputEl = null;
        try {
          chatInputEl = await rootDoc.querySelector(CHAT_INPUT_SELECTOR);
        } catch {}

        const headingText = headings.join(' | ');
        const modalHeadings = [
          '페르소나', 'persona',
          '모듈 수정', 'edit module', '모듈 생성', 'create module', '모듈', 'modules',
          '채팅 봇', 'chat bot', '기타 봇', 'other bots', '소리 및 디스플레이', 'display',
          '고급 설정', 'advanced settings', '프롬프트 템플릿', 'prompt template', '접근성', 'accessibility',
          '로어북', 'lorebook',
        ];
        if (matchAny(headingText, modalHeadings)) {
          const classified = classifyDomSignals({ headings });
          if (classified.screen !== 'unknown') return classified;
        }

        if (chatInputEl) {
          return {
            detectedAt: Date.now(),
            screen: 'chat',
            targetKind: 'general',
            fieldKey: null,
            loreIndex: null,
            loreScope: null,
            labelText: '채팅 입력 화면',
            placeholder: '',
            liveTextPreview: '',
            warnings: [],
          };
        }

        if (headings.length > 0) {
          const classified = classifyDomSignals({ headings });
          if (classified.screen !== 'unknown') return classified;
        }
        return null;
      } catch {
        return null;
      }
    }

    const CHIP_ANCHORS = {
      tl: 'left:14px;top:64px;',
      tr: 'right:14px;top:64px;',
      bl: 'left:14px;bottom:74px;',
      br: 'right:14px;bottom:74px;',
      ml: 'left:14px;top:50%;transform:translateY(-50%);',
      mr: 'right:14px;top:50%;transform:translateY(-50%);',
    };
    const CHIP_CYCLE_ORDER = ['br', 'mr', 'tr', 'tl', 'ml', 'bl'];
    const LONG_PRESS_MS = 600;

    function extractPointerXY(ev) {
      const src = ev?.touches?.[0] ?? ev?.changedTouches?.[0] ?? ev;
      const x = Number(src?.clientX);
      const y = Number(src?.clientY);
      return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
    }

    function normalizeChipPos(pos) {
      if (!pos || typeof pos !== 'object') return null;
      if (typeof pos.anchor === 'string' && Object.hasOwn(CHIP_ANCHORS, pos.anchor)) {
        return { anchor: pos.anchor };
      }
      if (Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        return { left: Math.round(pos.left), top: Math.round(pos.top) };
      }
      return null;
    }

    function estimateChipOrigin(pos, chipW, chipH, viewW, viewH) {
      const norm = normalizeChipPos(pos);
      if (norm && Number.isFinite(norm.left) && Number.isFinite(norm.top)) {
        return { left: norm.left, top: norm.top };
      }
      const anchor = norm?.anchor || 'br';
      switch (anchor) {
        case 'tl': return { left: 14, top: 64 };
        case 'tr': return { left: Math.max(8, viewW - chipW - 14), top: 64 };
        case 'bl': return { left: 14, top: Math.max(8, viewH - chipH - 74) };
        case 'ml': return { left: 14, top: Math.max(8, Math.round((viewH - chipH) / 2)) };
        case 'mr': return { left: Math.max(8, viewW - chipW - 14), top: Math.max(8, Math.round((viewH - chipH) / 2)) };
        case 'br':
        default:
          return { left: Math.max(8, viewW - chipW - 14), top: Math.max(8, viewH - chipH - 74) };
      }
    }

    function buildChipStyle({ pos = null, left = null, top = null, dragging = false } = {}) {
      const norm = pos
        ? normalizeChipPos(pos)
        : (Number.isFinite(left) && Number.isFinite(top) ? { left, top } : null);
      let posCss = CHIP_ANCHORS.br;
      if (norm?.anchor) {
        posCss = CHIP_ANCHORS[norm.anchor];
      } else if (norm && Number.isFinite(norm.left) && Number.isFinite(norm.top)) {
        posCss = `left:${Math.round(norm.left)}px;top:${Math.round(norm.top)}px;`;
      }
      return (
        `position:fixed;${posCss}z-index:999;display:inline-flex;align-items:center;box-sizing:border-box;` +
        'padding:7px 12px;border-radius:999px;' +
        'background:rgba(24,24,27,0.92);color:#f4f4f5;border:1px solid rgba(161,161,170,0.45);' +
        'font-size:12px;font-weight:600;line-height:1.2;box-shadow:0 6px 20px rgba(0,0,0,0.32);' +
        `cursor:${dragging ? 'grabbing' : 'grab'};touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;` +
        'max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);'
      );
    }

    function clampChipPos(left, top, chipW, chipH, viewW, viewH) {
      const maxLeft = Math.max(8, Math.round(viewW - chipW - 8));
      const maxTop = Math.max(8, Math.round(viewH - chipH - 8));
      return {
        left: Math.max(8, Math.min(maxLeft, Math.round(left))),
        top: Math.max(8, Math.min(maxTop, Math.round(top))),
      };
    }

    const FRAME_ATTR = 'x-risuhelper-frame';
    const MIN_DOCK_VIEWPORT_PX = 960;
    const DEFAULT_DOCK_WIDTH = 420;
    const MIN_DOCK_WIDTH = 320;
    const MAX_DOCK_WIDTH = 640;

    /**
     * Manages allowed Plugin v3 rootDoc listeners (pointer/touch/mouse/click/keyup) to cache the latest
     * focused context BEFORE a user clicks the plugin button, renders a draggable floating chip,
     * and manages optional PC right-side docking so RisuAI remains interactive alongside RisuHelper.
     */
    class FocusTracker {
      constructor(api, options = {}) {
        this.api = api;
        this.onChange = options.onChange || (() => {});
        this.onChipClick = options.onChipClick || (() => {});
        this.onChipMove = options.onChipMove || (() => {});
        this.showFloatingChip = options.showFloatingChip ?? true;
        this.chipPos = normalizeChipPos(options.chipPos);
        this.rootDoc = null;
        this.listenerIds = [];
        this.chipEl = null;
        this.chipListenerIds = [];
        this.lastContext = null;
        this.enabled = false;
        this.liveScreenFallback = false;
        this._scanPending = false;
        this._drag = null;
        this._dragHandled = false;
        this._lastDragStart = 0;
        this._lastDownType = '';
        this._longPressTimer = null;
        this._suppressClickUntil = 0;
        this._cachedViewport = null;
        this._cachedChipRect = null;
        this._styleInFlight = false;
        this._pendingStyleUpdate = null;
        this._dockFrame = null;
        this._dockMain = null;
        this._savedMainStyle = null;
        this._isDocked = false;
        this._dockWidth = DEFAULT_DOCK_WIDTH;
        this._chipHiddenForDock = false;
      }

      async _getViewportSize() {
        // 1. In RisuAI/PocketRisu, SafeDocument wraps document.documentElement (<html>) directly,
        //    so calling getBoundingClientRect() on rootDoc itself returns the true host viewport rect.
        try {
          if (this.rootDoc && typeof this.rootDoc.getBoundingClientRect === 'function') {
            const rect = await this.rootDoc.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
              this._cachedViewport = { width: rect.width, height: rect.height };
              return this._cachedViewport;
            }
          }
        } catch {}
        // 2. Fallback: body rect (fixed 100dvh viewport in PocketRisu/RisuAI)
        try {
          const body = await this.rootDoc?.querySelector('body');
          if (body && typeof body.getBoundingClientRect === 'function') {
            const rect = await body.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
              this._cachedViewport = { width: rect.width, height: rect.height };
              return this._cachedViewport;
            }
          }
        } catch {}
        // 3. Fallback: querySelector('html') (unit test mocks)
        try {
          const html = await this.rootDoc?.querySelector('html');
          if (html && typeof html.getBoundingClientRect === 'function') {
            const rect = await html.getBoundingClientRect();
            if (rect && rect.width > 0 && rect.height > 0) {
              this._cachedViewport = { width: rect.width, height: rect.height };
              return this._cachedViewport;
            }
          }
        } catch {}
        if (typeof globalThis.innerWidth === 'number' && globalThis.innerWidth > 0) {
          this._cachedViewport = { width: globalThis.innerWidth, height: globalThis.innerHeight || 768 };
          return this._cachedViewport;
        }
        return this._cachedViewport || { width: 1024, height: 768 };
      }

      async getHostViewportSize() {
        if (!this.rootDoc && typeof this.api?.getRootDocument === 'function') {
          try {
            const doc = await this.api.getRootDocument();
            if (doc) this.rootDoc = doc;
          } catch {}
        }
        return await this._getViewportSize();
      }

      async _refreshChipMetrics() {
        if (!this.chipEl) return;
        try {
          const [rect, view] = await Promise.all([
            typeof this.chipEl.getBoundingClientRect === 'function' ? this.chipEl.getBoundingClientRect() : null,
            this._getViewportSize(),
          ]);
          if (rect) {
            const left = rect.left ?? rect.x;
            const top = rect.top ?? rect.y;
            if (Number.isFinite(left) && Number.isFinite(top) && rect.width > 0 && rect.height > 0) {
              this._cachedChipRect = { left, top, width: rect.width, height: rect.height };
            }
          }
          if (view && view.width > 0 && view.height > 0) {
            this._cachedViewport = view;
          }
        } catch {}
      }

      async start() {
        if (this.enabled) return true;
        if (typeof this.api?.getRootDocument !== 'function') return false;
        try {
          const rootDoc = await this.api.getRootDocument();
          if (!rootDoc) return false;
          this.rootDoc = rootDoc;
          this.enabled = true;

          // Register drag move/end listeners BEFORE focus-scan listeners so drag state resolves first.
          // Each event is wrapped individually so forks without specific event types never abort startup.
          for (const moveEvt of ['pointermove', 'touchmove', 'mousemove']) {
            try {
              const id = await rootDoc.addEventListener(moveEvt, (e) => {
                this._handlePointerMove(e);
              });
              if (id) this.listenerIds.push({ type: moveEvt, id });
            } catch {}
          }

          for (const endEvt of ['pointerup', 'touchend', 'mouseup', 'pointercancel', 'touchcancel']) {
            try {
              const id = await rootDoc.addEventListener(endEvt, () => {
                this._handlePointerEnd();
              });
              if (id) this.listenerIds.push({ type: endEvt, id });
            } catch {}
          }

          for (const evt of ['pointerup', 'click', 'keyup']) {
            try {
              const id = await rootDoc.addEventListener(evt, () => {
                if (this._drag?.moved || this._dragHandled || Date.now() < this._suppressClickUntil) return;
                this.scheduleScan();
              });
              if (id) this.listenerIds.push({ type: evt, id });
            } catch {}
          }

          if (this.showFloatingChip && !this._isDocked) {
            await this.mountFloatingChip();
          }
          this.scheduleScan();
          return true;
        } catch {
          return false;
        }
      }

      scheduleScan() {
        if (!this.enabled || this._scanPending) return;
        this._scanPending = true;
        setTimeout(async () => {
          this._scanPending = false;
          await this.scanNow({ allowScreenFallback: Boolean(this.liveScreenFallback) });
        }, 45);
      }

      async scanNow({ allowScreenFallback = false } = {}) {
        if (!this.rootDoc) return this.lastContext;
        let ctx = await inspectFocusedElement(this.rootDoc);
        if (!ctx && allowScreenFallback) {
          ctx = await inspectVisibleScreen(this.rootDoc);
        }
        if (ctx) {
          this.lastContext = ctx;
          this.onChange(ctx);
          await this.updateChipLabel(ctx);
        }
        return this.lastContext;
      }

      async snapshotVisibleIframes() {
        const visible = new Set();
        if (!this.rootDoc || typeof this.rootDoc.querySelectorAll !== 'function') return visible;
        try {
          const frames = await this.rootDoc.querySelectorAll('iframe');
          const len = frames ? await frames.length() : 0;
          for (let i = 0; i < len; i++) {
            const f = await frames.at(i);
            if (!f || typeof f.getStyle !== 'function') continue;
            const disp = String((await f.getStyle('display')) || '').trim().toLowerCase();
            if (disp && disp !== 'none') visible.add(i);
          }
        } catch {}
        return visible;
      }

      async _findOwnIframe(beforeVisibleIndices, probeWidth, localWin) {
        if (!this.rootDoc) return null;
        if (this._dockFrame) return this._dockFrame;

        // 1. Fast path: already tagged by us earlier in this session
        try {
          const tagged = await this.rootDoc.querySelector(`iframe[${FRAME_ATTR}="1"]`);
          if (tagged) {
            this._dockFrame = tagged;
            return tagged;
          }
        } catch {}

        if (typeof this.rootDoc.querySelectorAll !== 'function') return null;

        let frames;
        try {
          frames = await this.rootDoc.querySelectorAll('iframe');
        } catch {
          return null;
        }
        const len = frames ? await frames.length() : 0;
        if (len === 0) return null;

        const newlyVisible = [];
        const otherVisible = [];
        for (let i = len - 1; i >= 0; i--) {
          const f = await frames.at(i);
          if (!f || typeof f.getStyle !== 'function' || typeof f.setStyle !== 'function') continue;
          try {
            const disp = String((await f.getStyle('display')) || '').trim().toLowerCase();
            if (disp === 'none') continue;
            if (beforeVisibleIndices && !beforeVisibleIndices.has(i)) {
              newlyVisible.push(f);
            } else {
              otherVisible.push(f);
            }
          } catch {}
        }

        const candidates = [...newlyVisible, ...otherVisible];
        if (candidates.length === 0) return null;

        // 2. Cryptographically certain self-verification: probe candidate width and verify our own
        //    iframe's window.innerWidth changes to match probeWidth before ever keeping any style change.
        const canProbeWin = Boolean(localWin && Number.isFinite(localWin.innerWidth) && localWin.innerWidth > 0);
        if (canProbeWin) {
          const origLocalW = localWin.innerWidth;
          const testWidth = Math.abs(origLocalW - probeWidth) < 16 ? probeWidth + 24 : probeWidth;
          for (const cand of candidates) {
            let origStyleW = '';
            try {
              origStyleW = String((await cand.getStyle('width')) || '');
              await cand.setStyle('width', `${testWidth}px`);
              await new Promise(r => setTimeout(r, 25));
              if (Math.abs(localWin.innerWidth - testWidth) <= 8) {
                try { await cand.setAttribute(FRAME_ATTR, '1'); } catch {}
                this._dockFrame = cand;
                return cand;
              }
              await cand.setStyle('width', origStyleW || '100%');
            } catch {
              try { await cand.setStyle('width', origStyleW || '100%'); } catch {}
            }
          }
          return null;
        }

        // 3. Fallback when localWin.innerWidth isn't simulated (e.g. unit test sandbox):
        //    only accept when strictly 1 iframe transitioned from hidden -> visible on showContainer().
        if (newlyVisible.length === 1) {
          const only = newlyVisible[0];
          try { await only.setAttribute(FRAME_ATTR, '1'); } catch {}
          this._dockFrame = only;
          return only;
        }
        return null;
      }

      async _restoreMainLayout() {
        if (!this._dockMain || !this._savedMainStyle) return;
        try {
          await this._dockMain.setStyle('width', this._savedMainStyle.width || '');
          await this._dockMain.setStyle('maxWidth', this._savedMainStyle.maxWidth || '');
          await this._dockMain.setStyle('boxSizing', this._savedMainStyle.boxSizing || '');
        } catch {}
        this._savedMainStyle = null;
        this._dockMain = null;
      }

      /**
       * Docks RisuHelper's own plugin iframe to the right edge on PC screens so RisuAI's native UI
       * stays 100% interactive side-by-side while cursor focus changes stream live into RisuHelper.
       */
      async applyDock({
        width = DEFAULT_DOCK_WIDTH,
        pushLayout = true,
        beforeVisibleIndices = null,
        localWin = null,
      } = {}) {
        if (!this.rootDoc) {
          if (typeof this.api?.getRootDocument === 'function') {
            try { this.rootDoc = await this.api.getRootDocument(); } catch {}
          }
        }
        if (!this.rootDoc) {
          return { ok: false, reason: 'mainDom 권한이 없어 PC 오른쪽 도킹을 사용할 수 없습니다.' };
        }

        const view = await this._getViewportSize();
        if (view.width < MIN_DOCK_VIEWPORT_PX) {
          return {
            ok: false,
            reason: `화면 너비(${Math.round(view.width)}px)가 좁아 PC 오른쪽 도킹을 사용할 수 없습니다. (최소 ${MIN_DOCK_VIEWPORT_PX}px)`,
          };
        }

        const maxAllowed = Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, Math.round(view.width * 0.48)));
        const dockW = Math.max(MIN_DOCK_WIDTH, Math.min(maxAllowed, Math.round(Number(width) || DEFAULT_DOCK_WIDTH)));

        const frame = await this._findOwnIframe(beforeVisibleIndices, dockW, localWin);
        if (!frame) {
          return { ok: false, reason: '플러그인 컨테이너를 식별하지 못해 일반 창 모드로 열었습니다.' };
        }

        try {
          await frame.setStyle('position', 'fixed');
          await frame.setStyle('top', '0px');
          await frame.setStyle('left', 'auto');
          await frame.setStyle('right', '0px');
          await frame.setStyle('width', `${dockW}px`);
          await frame.setStyle('height', '100%');
          await frame.setStyle('border', 'none');
          await frame.setStyle('borderLeft', '1px solid rgba(161, 161, 170, 0.28)');
          await frame.setStyle('boxShadow', '-8px 0 28px rgba(0, 0, 0, 0.32)');
        } catch {
          return { ok: false, reason: '도킹 스타일을 적용하지 못했습니다.' };
        }

        if (pushLayout) {
          try {
            const main = this._dockMain || await this.rootDoc.querySelector('main');
            if (main && typeof main.setStyle === 'function') {
              if (!this._savedMainStyle) {
                this._savedMainStyle = {
                  width: typeof main.getStyle === 'function' ? String((await main.getStyle('width')) || '') : '',
                  maxWidth: typeof main.getStyle === 'function' ? String((await main.getStyle('maxWidth')) || '') : '',
                  boxSizing: typeof main.getStyle === 'function' ? String((await main.getStyle('boxSizing')) || '') : '',
                };
              }
              await main.setStyle('boxSizing', 'border-box');
              await main.setStyle('width', `calc(100% - ${dockW}px)`);
              await main.setStyle('maxWidth', `calc(100% - ${dockW}px)`);
              this._dockMain = main;
            }
          } catch {}
        } else {
          await this._restoreMainLayout();
        }

        if (this.chipEl) {
          this._chipHiddenForDock = true;
          await this.unmountFloatingChip();
        } else if (this.showFloatingChip) {
          this._chipHiddenForDock = true;
        }

        this._isDocked = true;
        this._dockWidth = dockW;
        this.liveScreenFallback = true;
        return { ok: true, width: dockW, viewWidth: view.width };
      }

      /**
       * Restores host <main> layout and our plugin iframe back to standard fullscreen geometry.
       */
      async releaseDock({ restoreChip = true } = {}) {
        this.liveScreenFallback = false;
        await this._restoreMainLayout();

        if (this._dockFrame && typeof this._dockFrame.setStyle === 'function') {
          try {
            await this._dockFrame.setStyle('left', '0');
            await this._dockFrame.setStyle('right', '');
            await this._dockFrame.setStyle('width', '100%');
            await this._dockFrame.setStyle('borderLeft', '');
            await this._dockFrame.setStyle('boxShadow', '');
          } catch {}
        }

        const wasHiddenForDock = this._chipHiddenForDock;
        this._isDocked = false;
        this._chipHiddenForDock = false;

        if (restoreChip && wasHiddenForDock && this.showFloatingChip && this.enabled && !this.chipEl) {
          await this.mountFloatingChip();
          if (this.lastContext) await this.updateChipLabel(this.lastContext);
        }
      }

      async _applyChipStyle(pos, dragging = false) {
        if (!this.chipEl) return;
        try {
          await this.chipEl.setStyleAttribute(buildChipStyle({
            pos,
            dragging,
          }));
        } catch {}
      }

      /**
       * Coalesces in-flight style RPC calls so the very first drag frame fires with 0ms latency
       * while never backing up the iframe postMessage bridge during rapid mouse movement.
       */
      _queueChipStyle(pos, dragging) {
        this._pendingStyleUpdate = { pos, dragging };
        if (this._styleInFlight) return;
        this._drainChipStyleQueue();
      }

      async _drainChipStyleQueue() {
        this._styleInFlight = true;
        try {
          while (this._pendingStyleUpdate) {
            const next = this._pendingStyleUpdate;
            this._pendingStyleUpdate = null;
            await this._applyChipStyle(next.pos, next.dragging);
          }
        } finally {
          this._styleInFlight = false;
        }
      }

      async _cycleChipSpot() {
        const view = this._cachedViewport || await this._getViewportSize();
        const chipW = this._cachedChipRect?.width || 140;
        const chipH = this._cachedChipRect?.height || 36;
        const curOrigin = this._cachedChipRect
          ? { left: this._cachedChipRect.left, top: this._cachedChipRect.top }
          : estimateChipOrigin(this.chipPos, chipW, chipH, view.width, view.height);

        let nextIdx = 0;
        if (this.chipPos?.anchor) {
          const idx = CHIP_CYCLE_ORDER.indexOf(this.chipPos.anchor);
          nextIdx = idx >= 0 ? (idx + 1) % CHIP_CYCLE_ORDER.length : 1;
        } else {
          const nearest = CHIP_CYCLE_ORDER.findIndex(anchor => {
            const spot = estimateChipOrigin({ anchor }, chipW, chipH, view.width, view.height);
            return Math.abs(spot.left - curOrigin.left) < 40 && Math.abs(spot.top - curOrigin.top) < 40;
          });
          nextIdx = nearest >= 0 ? (nearest + 1) % CHIP_CYCLE_ORDER.length : 1;
        }

        const nextAnchor = CHIP_CYCLE_ORDER[nextIdx];
        const nextPos = nextAnchor === 'br' ? null : { anchor: nextAnchor };
        this._suppressClickUntil = Date.now() + 500;
        await this.setChipPosition(nextPos);
        this.onChipMove(nextPos);
      }

      async _handleChipPointerDown(e) {
        if (!this.chipEl) return;
        if (e?.button === 1 || e?.button === 2) return;
        if (this._drag?.active) return; // Dedupe paired pointerdown + touchstart + mousedown

        const now = Date.now();
        const evType = String(e?.type || '');
        if (evType && this._lastDownType && this._lastDownType !== evType && now - this._lastDragStart < 120) {
          return;
        }
        this._lastDragStart = now;
        this._lastDownType = evType;
        this._dragHandled = false;

        const xy = extractPointerXY(e);
        const view = this._cachedViewport || { width: 1024, height: 768 };
        const cachedRect = this._cachedChipRect;
        const chipW = cachedRect?.width > 0 ? cachedRect.width : 140;
        const chipH = cachedRect?.height > 0 ? cachedRect.height : 36;
        const origin = (cachedRect && Number.isFinite(cachedRect.left) && Number.isFinite(cachedRect.top))
          ? { left: cachedRect.left, top: cachedRect.top }
          : estimateChipOrigin(this.chipPos, chipW, chipH, view.width, view.height);

        const drag = {
          active: true,
          startedAt: now,
          moved: false,
          hasCoords: Boolean(xy),
          startX: xy ? xy[0] : 0,
          startY: xy ? xy[1] : 0,
          lastX: xy ? xy[0] : 0,
          lastY: xy ? xy[1] : 0,
          originLeft: origin.left,
          originTop: origin.top,
          chipW,
          chipH,
          viewW: view.width,
          viewH: view.height,
        };
        this._drag = drag;

        // Long-press fallback (600ms): even on hosts that strip pointer coordinates,
        // holding the button cleanly cycles it to the next screen edge spot.
        clearTimeout(this._longPressTimer);
        this._longPressTimer = setTimeout(() => {
          if (this._drag === drag && drag.active && !drag.moved) {
            drag.active = false;
            this._drag = null;
            this._dragHandled = true;
            this._cycleChipSpot();
          }
        }, LONG_PRESS_MS);

        try {
          const [rect, liveView] = await Promise.all([
            typeof this.chipEl.getBoundingClientRect === 'function' ? this.chipEl.getBoundingClientRect() : null,
            this._getViewportSize(),
          ]);
          if (rect) {
            const left = rect.left ?? rect.x;
            const top = rect.top ?? rect.y;
            if (Number.isFinite(left) && Number.isFinite(top) && rect.width > 0 && rect.height > 0) {
              this._cachedChipRect = { left, top, width: rect.width, height: rect.height };
              if (this._drag === drag && drag.active && !drag.moved) {
                drag.originLeft = left;
                drag.originTop = top;
                drag.chipW = rect.width;
                drag.chipH = rect.height;
              }
            }
          }
          if (liveView && liveView.width > 0 && liveView.height > 0) {
            this._cachedViewport = liveView;
            if (this._drag === drag && drag.active) {
              drag.viewW = liveView.width;
              drag.viewH = liveView.height;
              if (drag.moved && drag.hasCoords) {
                const nextPos = clampChipPos(
                  drag.originLeft + (drag.lastX - drag.startX),
                  drag.originTop + (drag.lastY - drag.startY),
                  drag.chipW,
                  drag.chipH,
                  drag.viewW,
                  drag.viewH
                );
                this._queueChipStyle(nextPos, true);
              }
            }
          }
        } catch {}
      }

      _handlePointerMove(e) {
        const drag = this._drag;
        if (!drag || !drag.active || !drag.hasCoords) return;

        // If mouse button was released outside the window, end drag immediately when cursor returns
        if ((e?.type === 'mousemove' || e?.type === 'pointermove') && typeof e?.buttons === 'number' && e.buttons === 0) {
          this._handlePointerEnd();
          return;
        }

        const xy = extractPointerXY(e);
        if (!xy) return;

        const [x, y] = xy;
        drag.lastX = x;
        drag.lastY = y;
        const dx = x - drag.startX;
        const dy = y - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

        if (!drag.moved) {
          drag.moved = true;
          clearTimeout(this._longPressTimer);
        }

        const nextPos = clampChipPos(
          drag.originLeft + dx,
          drag.originTop + dy,
          drag.chipW,
          drag.chipH,
          drag.viewW,
          drag.viewH
        );
        this._queueChipStyle(nextPos, true);
      }

      async _handlePointerEnd() {
        clearTimeout(this._longPressTimer);
        const drag = this._drag;
        if (!drag || !drag.active) return;
        drag.active = false;
        this._drag = null;

        if (drag.moved && drag.hasCoords) {
          const finalPos = clampChipPos(
            drag.originLeft + (drag.lastX - drag.startX),
            drag.originTop + (drag.lastY - drag.startY),
            drag.chipW,
            drag.chipH,
            drag.viewW,
            drag.viewH
          );

          this._dragHandled = true;
          this._suppressClickUntil = Date.now() + 450;
          this.chipPos = finalPos;
          this._cachedChipRect = {
            left: finalPos.left,
            top: finalPos.top,
            width: drag.chipW,
            height: drag.chipH,
          };
          this._pendingStyleUpdate = null;
          await this._applyChipStyle(finalPos, false);
          this.onChipMove(finalPos);
          return;
        }

        const held = Date.now() - drag.startedAt;
        this._dragHandled = true;
        this._suppressClickUntil = Date.now() + 450;
        if (held >= LONG_PRESS_MS) {
          await this._cycleChipSpot();
          return;
        }
        this.onChipClick(this.lastContext);
      }

      async setChipPosition(pos) {
        this._lastDragStart = 0;
        this._lastDownType = '';
        const norm = normalizeChipPos(pos);
        if (norm?.anchor) {
          this.chipPos = norm;
          this._cachedChipRect = null;
        } else if (norm && Number.isFinite(norm.left) && Number.isFinite(norm.top)) {
          const view = await this._getViewportSize();
          const chipW = this._cachedChipRect?.width || 140;
          const chipH = this._cachedChipRect?.height || 36;
          this.chipPos = clampChipPos(norm.left, norm.top, chipW, chipH, view.width, view.height);
        } else {
          this.chipPos = null;
          this._cachedChipRect = null;
        }
        this._pendingStyleUpdate = null;
        await this._applyChipStyle(this.chipPos, false);
        await this._refreshChipMetrics();
      }

      async mountFloatingChip() {
        if (!this.rootDoc || this.chipEl) return;
        try {
          const body = await this.rootDoc.querySelector('body');
          if (!body) return;

          // Remove any orphaned chip left behind from a prior plugin reload
          try {
            const stale = await this.rootDoc.querySelector(`[${CHIP_ATTR}="1"]`);
            if (stale) await stale.remove();
          } catch {}

          // Use <div> instead of <button> so grabbing/dragging never steals :focus from the active editor
          const chip = await this.rootDoc.createElement('div');
          await chip.setAttribute(CHIP_ATTR, '1');
          if (this.chipPos && Number.isFinite(this.chipPos.left) && Number.isFinite(this.chipPos.top)) {
            const view = await this._getViewportSize();
            this.chipPos = clampChipPos(this.chipPos.left, this.chipPos.top, 140, 36, view.width, view.height);
          }
          await chip.setStyleAttribute(buildChipStyle({
            pos: this.chipPos,
            dragging: false,
          }));
          await chip.setTextContent('⋮⋮ ✨ RisuHelper');

          for (const downEvt of ['pointerdown', 'touchstart', 'mousedown']) {
            try {
              const downId = await chip.addEventListener(downEvt, (e) => {
                this._handleChipPointerDown(e);
              });
              if (downId) this.chipListenerIds.push({ type: downEvt, id: downId });
            } catch {}
          }

          try {
            const clickId = await chip.addEventListener('click', () => {
              if (this._dragHandled || this._drag?.active || Date.now() < this._suppressClickUntil) {
                this._dragHandled = false;
                return;
              }
              this.onChipClick(this.lastContext);
            });
            if (clickId) this.chipListenerIds.push({ type: 'click', id: clickId });
          } catch {}

          await body.appendChild(chip);
          this.chipEl = chip;
          await this._refreshChipMetrics();
        } catch {}
      }

      async setChipVisible(visible) {
        this.showFloatingChip = Boolean(visible);
        if (!this.rootDoc) return;
        if (this.showFloatingChip && !this.chipEl && !this._isDocked) {
          await this.mountFloatingChip();
          if (this.lastContext) await this.updateChipLabel(this.lastContext);
        } else if (!this.showFloatingChip && this.chipEl) {
          await this.unmountFloatingChip();
        }
      }

      async updateChipLabel(ctx) {
        if (!this.chipEl || !ctx) return;
        try {
          const text = ctx.labelText ? `⋮⋮ ✨ ${ctx.labelText}` : '⋮⋮ ✨ RisuHelper';
          await this.chipEl.setTextContent(text.slice(0, 36));
          await this._refreshChipMetrics();
        } catch {}
      }

      async unmountFloatingChip() {
        clearTimeout(this._longPressTimer);
        this._drag = null;
        this._dragHandled = false;
        this._pendingStyleUpdate = null;
        this._cachedChipRect = null;
        if (!this.chipEl) return;
        try {
          for (const entry of this.chipListenerIds) {
            try {
              await this.chipEl.removeEventListener(entry.type, entry.id);
            } catch {}
          }
          await this.chipEl.remove();
        } catch {}
        this.chipEl = null;
        this.chipListenerIds = [];
      }

      async stop() {
        this.enabled = false;
        clearTimeout(this._longPressTimer);
        this._drag = null;
        this._dragHandled = false;
        this._pendingStyleUpdate = null;
        this._cachedChipRect = null;
        await this.releaseDock({ restoreChip: false });
        await this.unmountFloatingChip();
        if (this.rootDoc) {
          for (const entry of this.listenerIds) {
            try {
              await this.rootDoc.removeEventListener(entry.type, entry.id);
            } catch {}
          }
        }
        this.listenerIds = [];
        this._dockFrame = null;
        this.rootDoc = null;
      }
    }

      __exports.parseOpeningTagAttrs = parseOpeningTagAttrs;
      __exports.classifyDomSignals = classifyDomSignals;
      __exports.inspectFocusedElement = inspectFocusedElement;
      __exports.inspectVisibleScreen = inspectVisibleScreen;
      __exports.normalizeChipPos = normalizeChipPos;
      __exports.MIN_DOCK_VIEWPORT_PX = MIN_DOCK_VIEWPORT_PX;
      __exports.FocusTracker = FocusTracker;

  },
  "src/text-edits.js"(__require, __exports) {
    // Exact partial-edit engine, fuzzy candidate locator, and unified-style diff preview.

    function assert(ok, message) {
      if (!ok) throw new Error(message);
    }

    /**
     * Validates and locates non-overlapping exact ranges in `source` for `edits: [{ before, after }]`.
     */
    function locateTextEdits(source, edits, label = '부분 편집') {
      assert(typeof source === 'string', `${label}: 원문 문자열이 필요합니다.`);
      assert(Array.isArray(edits) && edits.length > 0 && edits.length <= 100, `${label}: edits는 1~100개 배열이어야 합니다.`);

      const ranges = edits.map((edit, idx) => {
        assert(edit && typeof edit === 'object' && !Array.isArray(edit), `${label} #${idx + 1}: edit 객체가 필요합니다.`);
        assert(typeof edit.before === 'string' && edit.before.length > 0, `${label} #${idx + 1}: before는 비어 있지 않은 문자열이어야 합니다.`);
        assert(typeof edit.after === 'string', `${label} #${idx + 1}: after는 문자열이어야 합니다.`);

        const first = source.indexOf(edit.before);
        assert(first !== -1, `${label} #${idx + 1}: 원문에서 before 구간을 찾을 수 없습니다.`);
        const second = source.indexOf(edit.before, first + 1);
        assert(second === -1, `${label} #${idx + 1}: before 구간이 원문에 여러 번 등장합니다. 앞뒤 문맥을 더 포함해 주세요.`);

        return {
          start: first,
          end: first + edit.before.length,
          before: edit.before,
          after: edit.after,
        };
      }).sort((a, b) => a.start - b.start);

      for (let i = 1; i < ranges.length; i++) {
        assert(ranges[i].start >= ranges[i - 1].end, `${label}: 수정 구간이 서로 겹칩니다.`);
      }
      return ranges;
    }

    /**
     * Applies exact partial edits to `source` and returns the resulting string.
     */
    function applyTextEdits(source, edits, label = '부분 편집') {
      const ranges = locateTextEdits(source, edits, label);
      let cursor = 0;
      const parts = [];
      for (const r of ranges) {
        parts.push(source.slice(cursor, r.start), r.after);
        cursor = r.end;
      }
      parts.push(source.slice(cursor));
      return parts.join('');
    }

    /**
     * Finds approximate matches in `source` when an LLM's `before` snippet has minor whitespace/punctuation drift.
     */
    function findFuzzyCandidates(source, before, maxResults = 5) {
      if (typeof source !== 'string' || typeof before !== 'string' || !before) return [];
      const results = [];
      const seen = new Set();

      const push = (start, end, kind, score) => {
        const key = `${start}:${end}`;
        if (start >= 0 && end > start && !seen.has(key)) {
          seen.add(key);
          results.push({ start, end, kind, score, snippet: source.slice(start, end) });
        }
      };

      // 1. Exact matches (possibly multiple)
      let pos = source.indexOf(before);
      while (pos !== -1 && results.length < maxResults) {
        push(pos, pos + before.length, '정확히 일치', 1);
        pos = source.indexOf(before, pos + 1);
      }
      if (results.length > 0) return results;

      // 2. Normalized alphanumeric/Hangul match (ignores whitespace/punctuation differences)
      const keep = /[A-Za-z0-9\p{Script=Hangul}]/u;
      const positions = [];
      let normSource = '';
      let offset = 0;
      for (const ch of source) {
        if (keep.test(ch)) {
          normSource += ch.toLowerCase();
          positions.push(offset);
        }
        offset += ch.length;
      }
      const normNeedle = [...before].filter(ch => keep.test(ch)).join('').toLowerCase();
      if (normNeedle.length >= 4) {
        let at = normSource.indexOf(normNeedle);
        while (at !== -1 && results.length < maxResults) {
          const start = positions[at];
          const end = positions[at + normNeedle.length - 1] + 1;
          push(start, end, '공백·기호 차이', 0.9);
          at = normSource.indexOf(normNeedle, at + 1);
        }
      }
      if (results.length > 0) return results;

      // 3. Line-window bigram similarity
      const bigrams = (text) => {
        const s = [...text].filter(ch => keep.test(ch)).join('').toLowerCase();
        const set = new Set();
        for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
        return set;
      };
      const targetGrams = bigrams(before);
      if (targetGrams.size === 0) return [];

      const lineSpans = [];
      const lineRe = /[^\r\n]+(?:\r\n|\r|\n|$)/g;
      let m;
      while ((m = lineRe.exec(source))) {
        lineSpans.push({ start: m.index, end: lineRe.lastIndex });
      }
      const targetLines = Math.min(12, Math.max(1, before.split(/\r\n|\r|\n/).length));
      for (let i = 0; i < lineSpans.length; i++) {
        const endIdx = Math.min(lineSpans.length - 1, i + targetLines - 1);
        const start = lineSpans[i].start;
        const end = lineSpans[endIdx].end;
        const slice = source.slice(start, end).replace(/[\r\n]+$/, '');
        if (!slice || slice.length > Math.max(4096, before.length * 4)) continue;
        const other = bigrams(slice);
        let common = 0;
        for (const g of targetGrams) if (other.has(g)) common++;
        const score = (2 * common) / Math.max(1, targetGrams.size + other.size);
        if (score >= 0.35) {
          push(start, start + slice.length, '유사 구간', score);
        }
      }

      return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
    }

    /**
     * Generates a compact, readable line-by-line diff preview between `before` and `after`.
     * Uses LCS on bounded line windows, falling back to hunk replacement for huge files.
     */
    function buildDiffPreview(beforeText, afterText, maxLines = 180) {
      const a = String(beforeText ?? '').replace(/\r\n/g, '\n').split('\n');
      const b = String(afterText ?? '').replace(/\r\n/g, '\n').split('\n');

      if (a.length === 1 && a[0] === '' && b.length === 1 && b[0] === '') {
        return { lines: [], added: 0, removed: 0, truncated: false };
      }

      // Trim shared prefix and suffix for fast, clean diffing
      let prefix = 0;
      while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
      let suffix = 0;
      while (
        suffix < a.length - prefix &&
        suffix < b.length - prefix &&
        a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
      ) {
        suffix++;
      }

      const midA = a.slice(prefix, a.length - suffix);
      const midB = b.slice(prefix, b.length - suffix);

      const out = [];
      let added = 0;
      let removed = 0;

      // Context before change
      const ctxStart = Math.max(0, prefix - 2);
      if (ctxStart > 0) out.push({ type: 'meta', text: `... (${ctxStart}줄 생략)` });
      for (let i = ctxStart; i < prefix; i++) {
        out.push({ type: 'ctx', line: i + 1, text: a[i] });
      }

      // LCS when middle slice is reasonable in size
      if (midA.length * midB.length <= 40000) {
        const m = midA.length;
        const n = midB.length;
        const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
        for (let i = m - 1; i >= 0; i--) {
          for (let j = n - 1; j >= 0; j--) {
            dp[i][j] = midA[i] === midB[j]
              ? dp[i + 1][j + 1] + 1
              : Math.max(dp[i + 1][j], dp[i][j + 1]);
          }
        }
        let i = 0;
        let j = 0;
        while (i < m || j < n) {
          if (i < m && j < n && midA[i] === midB[j]) {
            out.push({ type: 'ctx', line: prefix + j + 1, text: midA[i] });
            i++;
            j++;
          } else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) {
            out.push({ type: 'add', line: prefix + j + 1, text: midB[j] });
            added++;
            j++;
          } else {
            out.push({ type: 'del', line: prefix + i + 1, text: midA[i] });
            removed++;
            i++;
          }
        }
      } else {
        for (let i = 0; i < midA.length; i++) {
          out.push({ type: 'del', line: prefix + i + 1, text: midA[i] });
          removed++;
        }
        for (let j = 0; j < midB.length; j++) {
          out.push({ type: 'add', line: prefix + j + 1, text: midB[j] });
          added++;
        }
      }

      // Context after change
      const suffixStart = a.length - suffix;
      const ctxEnd = Math.min(a.length, suffixStart + 2);
      for (let i = suffixStart; i < ctxEnd; i++) {
        out.push({ type: 'ctx', line: b.length - suffix + (i - suffixStart) + 1, text: a[i] });
      }
      if (ctxEnd < a.length) out.push({ type: 'meta', text: `... (${a.length - ctxEnd}줄 생략)` });

      const truncated = out.length > maxLines;
      return {
        lines: truncated ? out.slice(0, maxLines) : out,
        added,
        removed,
        truncated,
      };
    }

      __exports.locateTextEdits = locateTextEdits;
      __exports.applyTextEdits = applyTextEdits;
      __exports.findFuzzyCandidates = findFuzzyCandidates;
      __exports.buildDiffPreview = buildDiffPreview;

  },
  "src/host-adapter.js"(__require, __exports) {
    const { ALLOWED_CONFIG_KEYS, CONFIG_KEY_TYPES, CHAR_FIELD_META, MAX_LLM_CONTENT_CHARS, ALLOWED_CHAR_FIELDS, ALLOWED_LORE_TEXT_FIELDS, ALLOWED_PERSONA_TEXT_FIELDS } = __require("src/version.js");
    const { applyTextEdits } = __require("src/text-edits.js");

    const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

    const LORE_META_SPECS = [
      ['comment', '이름'],
      ['key', '활성화 키'],
      ['secondkey', '보조 키'],
      ['insertorder', '배치 순서'],
      ['alwaysActive', '항상 활성'],
      ['selective', '보조 키 사용'],
      ['useRegex', '정규식 키'],
      ['activationPercent', '활성 확률'],
      ['mode', '모드'],
      ['folder', '폴더'],
    ];

    const PERSONA_META_SPECS = [
      ['name', '이름'],
      ['note', '메모'],
      ['largePortrait', '큰 초상화'],
    ];

    const REGEX_META_SPECS = [
      ['comment', '이름'],
      ['type', '적용 유형'],
      ['in', 'IN 패턴'],
      ['flag', '플래그'],
      ['ableFlag', '플래그 활성'],
    ];

    function clone(value) {
      if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch {}
      }
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function makeUuid() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return 'rh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function formatMetaValue(val) {
      if (val === undefined || val === null || val === '') return '(비어 있음)';
      if (typeof val === 'boolean') return val ? '예' : '아니오';
      return String(val);
    }

    function computeMetaChanges(beforeObj, afterObj, specs, skipKey = null) {
      const changes = [];
      for (const [key, label] of specs) {
        if (key === skipKey) continue;
        const prev = beforeObj ? beforeObj[key] : undefined;
        const next = afterObj ? afterObj[key] : undefined;
        if (prev !== next) {
          changes.push({
            key,
            label,
            before: formatMetaValue(prev),
            after: formatMetaValue(next),
          });
        }
      }
      return changes;
    }

    function validateAllowedFieldKey(kind, fieldKey) {
      if (fieldKey === undefined || fieldKey === null || fieldKey === '') return null;
      if (typeof fieldKey !== 'string' || BAD_KEYS.has(fieldKey)) {
        return `허용되지 않는 필드 키입니다: ${String(fieldKey)}`;
      }
      if (kind === 'char_field' && !ALLOWED_CHAR_FIELDS.includes(fieldKey)) {
        return `허용되지 않는 캐릭터 필드입니다: ${fieldKey}`;
      }
      if (
        (kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook') &&
        !ALLOWED_LORE_TEXT_FIELDS.includes(fieldKey)
      ) {
        return `허용되지 않는 로어북 필드입니다: ${fieldKey}`;
      }
      if (kind === 'persona' && !ALLOWED_PERSONA_TEXT_FIELDS.includes(fieldKey)) {
        return `허용되지 않는 페르소나 필드입니다: ${fieldKey}`;
      }
      if (kind === 'chat_note' && fieldKey !== 'note') {
        return `허용되지 않는 작가의 노트 필드입니다: ${fieldKey}`;
      }
      if (kind === 'config' && !ALLOWED_CONFIG_KEYS.includes(fieldKey)) {
        return `허용되지 않는 설정 키입니다: ${fieldKey}`;
      }
      return null;
    }

    function assertAllowedFieldKey(kind, fieldKey) {
      const err = validateAllowedFieldKey(kind, fieldKey);
      if (err) throw new Error(err);
    }

    function checkTruncationGuard(beforeText, actionLabel) {
      if (typeof beforeText === 'string' && beforeText.length > MAX_LLM_CONTENT_CHARS) {
        return (
          `현재 원문(${beforeText.length.toLocaleString()}자)이 모델 입력 한도(${MAX_LLM_CONTENT_CHARS.toLocaleString()}자)를 초과해 앞부분만 전달되었습니다. ` +
          `뒷부분 유실을 방지하기 위해 ${actionLabel}은(는) 차단됩니다. 부분 편집(patch_text / edits)을 사용해 주세요.`
        );
      }
      return null;
    }

    function getCharIdentity(char) {
      if (!char) return { charId: null, charName: null };
      return {
        charId: char.chaId ?? char.id ?? null,
        charName: char.name ?? null,
      };
    }

    function isSameCharacter(char, charIndex, binding) {
      if (!binding) return true;
      if (!char) return false;
      const cur = getCharIdentity(char);
      if (binding.charId && cur.charId) {
        return binding.charId === cur.charId;
      }
      if (
        Number.isInteger(binding.charIndex) &&
        Number.isInteger(charIndex) &&
        binding.charIndex !== charIndex
      ) {
        return false;
      }
      if (binding.charName !== null && binding.charName !== undefined && cur.charName !== binding.charName) {
        return false;
      }
      return true;
    }

    function removeCreatedItem(list, insertedIndex, matcher) {
      if (!Array.isArray(list)) return false;
      if (insertedIndex >= 0 && insertedIndex < list.length && matcher(list[insertedIndex])) {
        list.splice(insertedIndex, 1);
        return true;
      }
      for (let i = list.length - 1; i >= 0; i--) {
        if (matcher(list[i])) {
          list.splice(i, 1);
          return true;
        }
      }
      return false;
    }

    /**
     * Extracts Lua code from RisuAI's triggerscript array (both character.triggerscript and module.trigger).
     */
    function extractLuaFromTriggers(triggers) {
      if (!Array.isArray(triggers) || triggers.length === 0) {
        return { isLua: false, code: '', hasOtherTriggers: false, otherTriggerCount: 0 };
      }
      const firstEffect = triggers[0]?.effect?.[0];
      if (firstEffect && firstEffect.type === 'triggerlua') {
        return { isLua: true, code: String(firstEffect.code ?? ''), hasOtherTriggers: false, otherTriggerCount: 0 };
      }
      return { isLua: false, code: '', hasOtherTriggers: true, otherTriggerCount: triggers.length };
    }

    /**
     * Builds the canonical RisuAI Lua triggerscript array expected by TriggerList.svelte.
     */
    function buildLuaTriggers(code) {
      return [
        {
          comment: '',
          type: 'start',
          conditions: [],
          effect: [
            {
              type: 'triggerlua',
              code: String(code ?? ''),
            },
          ],
        },
      ];
    }

    function buildLuaDestructiveWarning(otherTriggerCount) {
      const countText = otherTriggerCount > 0 ? `${otherTriggerCount}개의 ` : '';
      return (
        `⚠️ 기존 V1/V2 트리거(${countText}항목)가 설정되어 있습니다. ` +
        'Lua 트리거를 적용하면 기존 트리거와 병합되지 않고 모두 삭제된 뒤 새 Lua 스크립트로 통째로 대체됩니다. ' +
        '(적용 직후 되돌리기로 기존 트리거를 복구할 수 있습니다.)'
      );
    }

    function normalizeLorebookEntry(input, existing = null) {
      const base = existing ? clone(existing) : {
        key: '',
        secondkey: '',
        insertorder: 100,
        comment: 'New Lore',
        content: '',
        mode: 'normal',
        alwaysActive: false,
        selective: false,
        useRegex: false,
      };
      if (input.comment !== undefined) base.comment = String(input.comment);
      if (input.key !== undefined) base.key = String(input.key);
      if (input.secondkey !== undefined) base.secondkey = String(input.secondkey);
      if (input.content !== undefined) base.content = String(input.content);
      if (input.insertorder !== undefined && Number.isFinite(Number(input.insertorder))) {
        base.insertorder = Number(input.insertorder);
      }
      if (input.alwaysActive !== undefined) base.alwaysActive = Boolean(input.alwaysActive);
      if (input.selective !== undefined) base.selective = Boolean(input.selective);
      if (input.useRegex !== undefined) base.useRegex = Boolean(input.useRegex);
      if (input.activationPercent !== undefined && Number.isFinite(Number(input.activationPercent))) {
        base.activationPercent = Math.max(0, Math.min(100, Number(input.activationPercent)));
      }
      if (input.mode && ['normal', 'constant', 'multiple', 'child', 'folder'].includes(input.mode)) {
        base.mode = input.mode;
      }
      if (input.folder !== undefined) base.folder = String(input.folder);
      return base;
    }

    function normalizeRegexEntry(input, existing = null) {
      const validTypes = ['editinput', 'editoutput', 'editprocess', 'editdisplay'];
      const base = existing ? clone(existing) : {
        comment: 'New Regex',
        in: '',
        out: '',
        type: 'editdisplay',
        flag: 'g',
        ableFlag: false,
      };
      if (input.comment !== undefined) base.comment = String(input.comment);
      if (input.in !== undefined) base.in = String(input.in);
      if (input.out !== undefined) base.out = String(input.out);
      if (input.type !== undefined && validTypes.includes(input.type)) base.type = input.type;
      if (input.flag !== undefined) base.flag = String(input.flag);
      if (input.ableFlag !== undefined) base.ableFlag = Boolean(input.ableFlag);
      return base;
    }

    function isCatchAllProxyApi(api) {
      return Boolean(api && typeof api.__risuhelper_nonexistent_probe__ === 'function');
    }

    function isMissingMethodError(err) {
      const msg = String(err?.message || err || '').toLowerCase();
      return msg.includes('not found') || msg.includes('not a function') || msg.includes('undefined');
    }

    /**
     * Cross-fork safe adapter for RisuAI Plugin API v3.
     * Works with kwaroran/Risuai, PocketRisu, RisuBard, HaejeokRisuai, RisuNest, and RisuAI-Hardened.
     */
    class HostAdapter {
      constructor(api) {
        this.api = api;
        this.undoStack = [];
        this.maxUndo = 20;
        this._probedFlavor = null;
      }

      /**
       * Probes the real host flavor safely (working around RisuAI Plugin v3's catch-all `window.risuai` Proxy,
       * where `typeof api.anyName === 'function'` is always true for nonexistent methods).
       */
      async probeHostFlavor(rootDoc = null) {
        if (this._probedFlavor) return this._probedFlavor;

        // 1. Check host document <title> when mainDom is available (zero side effects, works on every fork)
        if (rootDoc && typeof rootDoc.querySelector === 'function') {
          try {
            const titleEl = await rootDoc.querySelector('title');
            const title = titleEl ? String((await titleEl.textContent()) || '').trim().toLowerCase() : '';
            if (title.includes('pocketrisu')) {
              this._probedFlavor = { name: 'PocketRisu', activePersonaAutoSyncs: false, syncLiteCharError: false };
              return this._probedFlavor;
            }
            if (title.includes('risubard')) {
              this._probedFlavor = { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
              return this._probedFlavor;
            }
            if (title.includes('risunest')) {
              this._probedFlavor = { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
              return this._probedFlavor;
            }
            if (title.includes('haejeok') || title.includes('해적')) {
              this._probedFlavor = { name: 'HaejeokRisuai', activePersonaAutoSyncs: true, syncLiteCharError: false };
              return this._probedFlavor;
            }
            if (title.includes('risuai')) {
              this._probedFlavor = { name: 'RisuAI', activePersonaAutoSyncs: false, syncLiteCharError: false };
              return this._probedFlavor;
            }
          } catch {}
        }

        // 2. Non-Proxy object (e.g. unit tests or direct host objects) can safely inspect own properties
        if (!isCatchAllProxyApi(this.api)) {
          if (typeof this.api?.risunestCallHostTool === 'function') {
            this._probedFlavor = { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
            return this._probedFlavor;
          }
          if (typeof this.api?._getBardWikiDocuments === 'function') {
            this._probedFlavor = { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
            return this._probedFlavor;
          }
        }

        this._probedFlavor = { name: 'RisuAI', activePersonaAutoSyncs: false, syncLiteCharError: false };
        return this._probedFlavor;
      }

      detectHostFlavor() {
        if (this._probedFlavor) return this._probedFlavor;
        // Never trust `typeof api.foo === 'function'` when `window.risuai` is a catch-all Proxy
        if (!isCatchAllProxyApi(this.api)) {
          if (typeof this.api?.risunestCallHostTool === 'function') {
            return { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
          }
          if (typeof this.api?._getBardWikiDocuments === 'function') {
            return { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
          }
        }
        return { name: 'RisuAI', activePersonaAutoSyncs: false, syncLiteCharError: false };
      }

      async _getCharacter() {
        if (typeof this.api.getCharacter === 'function') {
          try {
            return await this.api.getCharacter();
          } catch (err) {
            if (!isMissingMethodError(err) || typeof this.api.getChar !== 'function') throw err;
          }
        }
        if (typeof this.api.getChar === 'function') return await this.api.getChar();
        return null;
      }

      async _setCharacter(char) {
        if (typeof this.api.setCharacter === 'function') {
          try {
            return await this.api.setCharacter(char);
          } catch (err) {
            if (!isMissingMethodError(err) || typeof this.api.setChar !== 'function') throw err;
          }
        }
        if (typeof this.api.setChar === 'function') return await this.api.setChar(char);
        throw new Error('캐릭터 저장 API를 찾을 수 없습니다.');
      }

      async _getActiveIndices() {
        let charIndex = null;
        let chatIndex = null;
        if (typeof this.api.getCurrentCharacterIndex === 'function') {
          try { charIndex = await this.api.getCurrentCharacterIndex(); } catch {}
        }
        if (typeof this.api.getCurrentChatIndex === 'function') {
          try { chatIndex = await this.api.getCurrentChatIndex(); } catch {}
        }
        return { charIndex, chatIndex };
      }

      async readActiveCharacter() {
        const char = await this._getCharacter();
        const { charIndex, chatIndex } = await this._getActiveIndices();
        return { char, charIndex, chatIndex };
      }

      /**
       * Reads a specific chat by index (preferring getChatFromIndex for PocketRisu _placeholder safety).
       */
      async _readChatAt(charIndex, chatIndex, fallbackChar = null) {
        if (
          Number.isInteger(charIndex) &&
          charIndex >= 0 &&
          typeof this.api.getChatFromIndex === 'function'
        ) {
          try {
            const fetched = await this.api.getChatFromIndex(charIndex, chatIndex);
            if (fetched && !fetched._placeholder) {
              return fetched;
            }
          } catch {}
        }
        const char = fallbackChar || (await this._getCharacter());
        const fallback = char?.chats?.[chatIndex] ?? null;
        if (fallback?._placeholder) {
          throw new Error('채팅 본문이 아직 서버에서 로드되지 않았습니다(_placeholder). 채팅을 연 뒤 다시 시도해 주세요.');
        }
        return fallback;
      }

      /**
       * Reads active chat via getChatFromIndex first (required by PocketRisu for unopened _placeholder chats),
       * falling back to char.chats[chatPage].
       */
      async readActiveChat() {
        const { char, charIndex, chatIndex } = await this.readActiveCharacter();
        if (!char) return { chat: null, char, charIndex, chatIndex };
        const resolvedChatIdx = Number.isInteger(chatIndex) ? chatIndex : (char.chatPage ?? 0);
        const chat = await this._readChatAt(charIndex, resolvedChatIdx, char);
        return { chat, char, charIndex, chatIndex: resolvedChatIdx };
      }

      /**
       * Saves a modified chat via setChatToIndex() when supported (required by PocketRisu / RisuNest),
       * falling back to updating char.chats[chatIndex] via _setCharacter() on older/hardened forks.
       */
      async _setChat(charIndex, chatIndex, nextChat) {
        if (
          typeof this.api.setChatToIndex === 'function' &&
          Number.isInteger(charIndex) &&
          charIndex >= 0
        ) {
          try {
            await this.api.setChatToIndex(charIndex, chatIndex, nextChat);
            return;
          } catch (err) {
            if (!isMissingMethodError(err)) throw err;
          }
        }
        const { char } = await this.readActiveCharacter();
        if (!char || !Array.isArray(char.chats) || !char.chats[chatIndex]) {
          throw new Error('채팅 저장 API(setChatToIndex)를 사용할 수 없습니다.');
        }
        if (char.chats[chatIndex]._placeholder) {
          throw new Error('채팅 본문이 아직 로드되지 않았습니다(_placeholder). setChatToIndex 지원 호스트가 필요합니다.');
        }
        const nextChar = clone(char);
        nextChar.chats[chatIndex] = clone(nextChat);
        await this._setCharacter(nextChar);
      }

      async _requireSameActiveCharacter(binding, actionVerb = '적용') {
        const { char, charIndex, chatIndex } = await this.readActiveCharacter();
        if (!char) throw new Error('선택된 캐릭터가 없습니다.');
        if (binding && !isSameCharacter(char, charIndex, binding)) {
          throw new Error(`다른 캐릭터로 전환되어 ${actionVerb}을(를) 중단했습니다. 원래 캐릭터로 돌아온 뒤 다시 시도해 주세요.`);
        }
        return { char, charIndex, chatIndex };
      }

      async _requireSameActiveChat(binding, actionVerb = '적용') {
        const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
        if (!chat) throw new Error('활성 채팅을 찾을 수 없습니다.');
        if (binding) {
          if (!isSameCharacter(char, charIndex, binding)) {
            throw new Error(`다른 캐릭터로 전환되어 ${actionVerb}을(를) 중단했습니다. 원래 캐릭터로 돌아온 뒤 다시 시도해 주세요.`);
          }
          if (Number.isInteger(binding.chatIndex) && binding.chatIndex !== chatIndex) {
            throw new Error(`다른 채팅으로 전환되어 ${actionVerb}을(를) 중단했습니다. 원래 채팅으로 돌아온 뒤 다시 시도해 주세요.`);
          }
        }
        return { chat, char, charIndex, chatIndex };
      }

      /**
       * Resolves the effective target while blocking prompt-injected target/fieldKey overrides.
       */
      _resolveSafeTarget(proposal, activeTarget) {
        const base = { ...(activeTarget || {}) };
        const pt = proposal?.target;

        if (pt !== undefined) {
          if (!pt || typeof pt !== 'object' || Array.isArray(pt)) {
            throw new Error('제안의 target 형식이 올바르지 않습니다.');
          }
          for (const k of Object.keys(pt)) {
            if (BAD_KEYS.has(k)) throw new Error(`허용되지 않는 target 키입니다: ${k}`);
          }
        }

        if (proposal?.action === 'patch_text' || proposal?.action === 'replace_text') {
          // Never allow LLM proposal.target to redirect a direct text edit to a different field or target
          if (pt) {
            const guardedKeys = ['targetKind', 'fieldKey', 'loreIndex', 'loreScope', 'personaIndex', 'moduleIndex', 'regexIndex'];
            for (const k of guardedKeys) {
              if (pt[k] !== undefined && pt[k] !== null && pt[k] !== base[k]) {
                throw new Error(`보안상 제안 블록의 target.${k}(${String(pt[k])})로 현재 선택 대상을 덮어쓸 수 없습니다.`);
              }
            }
          }
          assertAllowedFieldKey(base.targetKind, base.fieldKey);
          return base;
        }

        const merged = pt ? { ...base, ...pt } : base;
        assertAllowedFieldKey(merged.targetKind, merged.fieldKey);
        return merged;
      }

      async readDbSubset(keys) {
        if (typeof this.api.getDatabase !== 'function') return null;
        const safeKeys = keys.filter(k => k !== 'plugins');
        return await this.api.getDatabase(safeKeys);
      }

      /**
       * Always uses async setDatabase() and never passes `plugins` or `characters` to setDatabaseLite().
       */
      async writeDbSubset(partial) {
        const safe = {};
        for (const [k, v] of Object.entries(partial)) {
          if (k === 'plugins') continue;
          safe[k] = v;
        }
        if (typeof this.api.setDatabase === 'function') {
          await this.api.setDatabase(safe);
          return;
        }
        if (typeof this.api.setDatabaseLite === 'function' && !Object.hasOwn(safe, 'characters')) {
          await this.api.setDatabaseLite(safe);
          return;
        }
        throw new Error('데이터베이스 저장 API를 사용할 수 없습니다.');
      }

      async readAllowedConfig() {
        const db = await this.readDbSubset(ALLOWED_CONFIG_KEYS);
        if (!db) return null;
        const out = {};
        for (const key of ALLOWED_CONFIG_KEYS) {
          if (Object.hasOwn(db, key)) out[key] = db[key];
        }
        return out;
      }

      async readPersonas() {
        const db = await this.readDbSubset(['personas', 'selectedPersona']);
        if (!db) return { personas: [], selectedPersona: 0, permissionDenied: true };
        return {
          personas: Array.isArray(db.personas) ? db.personas : [],
          selectedPersona: Number.isInteger(db.selectedPersona) ? db.selectedPersona : 0,
          permissionDenied: false,
        };
      }

      async readModules() {
        const db = await this.readDbSubset(['modules', 'enabledModules', 'moduleIntergration']);
        if (!db) return { modules: [], enabledModules: [], moduleIntergration: '', permissionDenied: true };
        return {
          modules: Array.isArray(db.modules) ? db.modules : [],
          enabledModules: Array.isArray(db.enabledModules) ? db.enabledModules : [],
          moduleIntergration: typeof db.moduleIntergration === 'string' ? db.moduleIntergration : '',
          permissionDenied: false,
        };
      }

      /**
       * Resolves the current source content, host identity binding, and rich metadata for any target descriptor.
       */
      async readTargetSnapshot(target) {
        const t = target || { targetKind: 'general' };

        if (t.targetKind === 'char_field') {
          const { char, charIndex } = await this.readActiveCharacter();
          if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
          const fieldKey = t.fieldKey || 'desc';
          const fieldErr = validateAllowedFieldKey('char_field', fieldKey);
          if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
          const content = String(char[fieldKey] ?? '');
          return {
            ok: true,
            target: { ...t, fieldKey },
            hostBinding: { charIndex, ...getCharIdentity(char) },
            label: CHAR_FIELD_META[fieldKey]?.label || fieldKey,
            content,
            charName: char.name || '(이름 없음)',
          };
        }

        if (t.targetKind === 'chat_note') {
          const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
          if (!chat) return { ok: false, reason: '활성 채팅을 찾을 수 없습니다.', content: '' };
          const fieldKey = t.fieldKey || 'note';
          const fieldErr = validateAllowedFieldKey('chat_note', fieldKey);
          if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
          return {
            ok: true,
            target: { ...t, fieldKey: 'note' },
            hostBinding: { charIndex, chatIndex, ...getCharIdentity(char) },
            label: '작가의 노트 (현재 채팅)',
            content: String(chat.note ?? ''),
            charName: char?.name || '(이름 없음)',
          };
        }

        if (t.targetKind === 'char_lorebook') {
          const { char, charIndex } = await this.readActiveCharacter();
          if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
          const list = Array.isArray(char.globalLore) ? char.globalLore : [];
          const idx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
          const entry = idx !== null && list[idx] ? list[idx] : null;
          const fieldKey = t.fieldKey || 'content';
          const fieldErr = validateAllowedFieldKey('char_lorebook', fieldKey);
          if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
          return {
            ok: true,
            target: { ...t, loreIndex: idx, fieldKey },
            hostBinding: { charIndex, ...getCharIdentity(char) },
            label: entry ? `캐릭터 로어북 #${idx + 1} (${entry.comment || '무제'})` : `캐릭터 로어북 (${list.length}개)`,
            content: entry ? String(entry[fieldKey] ?? '') : '',
            entry,
            loreCount: list.length,
            loreSummary: list.slice(0, 40).map((e, i) => ({
              index: i,
              comment: e.comment || '',
              key: e.key || '',
              alwaysActive: Boolean(e.alwaysActive),
              insertorder: e.insertorder ?? 100,
              mode: e.mode || 'normal',
            })),
          };
        }

        if (t.targetKind === 'chat_lorebook') {
          const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
          if (!chat) return { ok: false, reason: '활성 채팅을 찾을 수 없습니다.', content: '' };
          const list = Array.isArray(chat.localLore) ? chat.localLore : [];
          const idx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
          const entry = idx !== null && list[idx] ? list[idx] : null;
          const fieldKey = t.fieldKey || 'content';
          const fieldErr = validateAllowedFieldKey('chat_lorebook', fieldKey);
          if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
          return {
            ok: true,
            target: { ...t, loreIndex: idx, fieldKey },
            hostBinding: { charIndex, chatIndex, ...getCharIdentity(char) },
            label: entry ? `채팅 로어북 #${idx + 1} (${entry.comment || '무제'})` : `채팅 로어북 (${list.length}개)`,
            content: entry ? String(entry[fieldKey] ?? '') : '',
            entry,
            loreCount: list.length,
            loreSummary: list.slice(0, 40).map((e, i) => ({
              index: i,
              comment: e.comment || '',
              key: e.key || '',
              alwaysActive: Boolean(e.alwaysActive),
              insertorder: e.insertorder ?? 100,
            })),
          };
        }

        if (t.targetKind === 'char_lua') {
          const { char, charIndex } = await this.readActiveCharacter();
          if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
          const lua = extractLuaFromTriggers(char.triggerscript);
          return {
            ok: true,
            target: { ...t, fieldKey: 'code' },
            hostBinding: { charIndex, ...getCharIdentity(char) },
            label: `캐릭터 Lua 트리거 (${char.name || '무제'})`,
            content: lua.code,
            isLua: lua.isLua,
            hasOtherTriggers: lua.hasOtherTriggers,
            otherTriggerCount: lua.otherTriggerCount,
          };
        }

        if (t.targetKind === 'char_regex') {
          const { char, charIndex } = await this.readActiveCharacter();
          if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
          const list = Array.isArray(char.customscript) ? char.customscript : [];
          const idx = Number.isInteger(t.regexIndex) ? t.regexIndex : null;
          const entry = idx !== null && list[idx] ? list[idx] : null;
          return {
            ok: true,
            target: { ...t, regexIndex: idx },
            hostBinding: { charIndex, ...getCharIdentity(char) },
            label: entry ? `캐릭터 정규식 #${idx + 1} (${entry.comment || '무제'})` : `캐릭터 정규식 (${list.length}개)`,
            content: entry ? JSON.stringify(entry, null, 2) : '',
            entry,
            regexList: list.slice(0, 30),
          };
        }

        if (t.targetKind === 'persona') {
          const { personas, selectedPersona, permissionDenied } = await this.readPersonas();
          if (permissionDenied) return { ok: false, reason: 'DB 읽기 권한(db)이 필요합니다.', content: '' };
          const idx = Number.isInteger(t.personaIndex) ? t.personaIndex : selectedPersona;
          const entry = personas[idx] ?? null;
          const fieldKey = t.fieldKey || 'personaPrompt';
          const fieldErr = validateAllowedFieldKey('persona', fieldKey);
          if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
          return {
            ok: true,
            target: { ...t, personaIndex: idx, fieldKey },
            hostBinding: { personaIndex: idx, personaId: entry?.id || null },
            label: entry ? `페르소나 #${idx + 1} (${entry.name || '무제'})` : '페르소나 목록',
            content: entry ? String(entry[fieldKey] ?? '') : '',
            entry,
            personasSummary: personas.map((p, i) => ({
              index: i,
              id: p.id || '',
              name: p.name || '',
              note: p.note || '',
              selected: i === selectedPersona,
            })),
            selectedPersona,
          };
        }

        if (t.targetKind === 'module_lorebook' || t.targetKind === 'module_lua' || t.targetKind === 'module_regex') {
          const { modules, enabledModules, permissionDenied } = await this.readModules();
          if (permissionDenied) return { ok: false, reason: 'DB 읽기 권한(db)이 필요합니다.', content: '' };
          const modIdx = Number.isInteger(t.moduleIndex) ? t.moduleIndex : (modules.length > 0 ? 0 : null);
          const mod = modIdx !== null ? modules[modIdx] : null;
          if (!mod) return { ok: true, target: t, label: '설치된 모듈 없음', content: '', modulesSummary: [] };

          let content = '';
          let label = `모듈: ${mod.name}`;
          let entry = null;
          let isLua = false;
          let hasOtherTriggers = false;
          let otherTriggerCount = 0;

          if (t.targetKind === 'module_lua') {
            const lua = extractLuaFromTriggers(mod.trigger);
            content = lua.code;
            isLua = lua.isLua;
            hasOtherTriggers = lua.hasOtherTriggers;
            otherTriggerCount = lua.otherTriggerCount;
            label = `모듈 Lua (${mod.name})`;
          } else if (t.targetKind === 'module_regex') {
            const list = Array.isArray(mod.regex) ? mod.regex : [];
            const rIdx = Number.isInteger(t.regexIndex) ? t.regexIndex : null;
            entry = rIdx !== null && list[rIdx] ? list[rIdx] : null;
            content = entry ? JSON.stringify(entry, null, 2) : '';
            label = entry ? `모듈 정규식 (${mod.name} #${rIdx + 1})` : `모듈 정규식 (${mod.name}, ${list.length}개)`;
          } else {
            const list = Array.isArray(mod.lorebook) ? mod.lorebook : [];
            const lIdx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
            entry = lIdx !== null && list[lIdx] ? list[lIdx] : null;
            const fieldKey = t.fieldKey || 'content';
            const fieldErr = validateAllowedFieldKey('module_lorebook', fieldKey);
            if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
            content = entry ? String(entry[fieldKey] ?? '') : '';
            label = entry ? `모듈 로어북 (${mod.name} #${lIdx + 1})` : `모듈 로어북 (${mod.name}, ${list.length}개)`;
          }
          return {
            ok: true,
            target: { ...t, moduleIndex: modIdx },
            hostBinding: { moduleIndex: modIdx, moduleId: mod.id || null },
            label,
            content,
            entry,
            isLua,
            hasOtherTriggers,
            otherTriggerCount,
            module: mod,
            modulesSummary: modules.map((m, i) => ({
              index: i,
              id: m.id,
              name: m.name,
              enabled: enabledModules.includes(m.id),
              loreCount: m.lorebook?.length ?? 0,
            })),
          };
        }

        if (t.targetKind === 'config') {
          const cfg = await this.readAllowedConfig();
          if (!cfg) return { ok: false, reason: 'DB 읽기 권한(db)이 필요합니다.', content: '' };
          const fieldKey = t.fieldKey || null;
          const fieldErr = validateAllowedFieldKey('config', fieldKey);
          if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
          return {
            ok: true,
            target: { ...t, fieldKey },
            label: fieldKey ? `설정 · ${fieldKey}` : 'RisuAI 설정 (허용 키)',
            content: fieldKey ? String(cfg[fieldKey] ?? '') : JSON.stringify(cfg, null, 2),
            config: cfg,
          };
        }

        if (t.screen === 'chat') {
          try {
            const { char } = await this.readActiveCharacter();
            if (char) {
              return {
                ok: true,
                target: t,
                label: `채팅 화면 (${char.name || '이름 없음'})`,
                content: '',
                charName: char.name || '',
              };
            }
          } catch {}
          return { ok: true, target: t, label: '채팅 입력 화면', content: '' };
        }

        return { ok: true, target: t, label: '일반 대화 / 질문', content: '' };
      }

      _pushUndo(entry) {
        this.undoStack.push({
          id: makeUuid(),
          timestamp: Date.now(),
          ...entry,
        });
        if (this.undoStack.length > this.maxUndo) {
          this.undoStack.shift();
        }
        return this.undoStack[this.undoStack.length - 1].id;
      }

      /**
       * Computes the resulting text, metadata diffs, warnings, and pinned target binding before mutating anything.
       */
      async previewProposal(proposal, activeTarget) {
        let target;
        try {
          target = this._resolveSafeTarget(proposal, activeTarget);
        } catch (err) {
          return { ok: false, error: err.message };
        }

        if (proposal.action === 'patch_text' || proposal.action === 'replace_text') {
          const snap = await this.readTargetSnapshot(target);
          if (!snap.ok) return { ok: false, error: snap.reason };
          const kind = snap.target?.targetKind || target.targetKind;
          const nonEditableTextKinds = new Set(['general', 'char_regex', 'module_regex']);
          if (!kind || nonEditableTextKinds.has(kind)) {
            return {
              ok: false,
              error: `현재 대상(${kind || '없음'})에는 직접 텍스트 적용을 지원하지 않습니다. 상단에서 편집할 대상을 선택해 주세요.`,
              label: snap.label,
              target: snap.target,
            };
          }
          if (kind === 'config' && (!snap.target?.fieldKey || !ALLOWED_CONFIG_KEYS.includes(snap.target.fieldKey))) {
            return {
              ok: false,
              error: '특정 설정 필드가 선택되지 않았습니다. 설정 변경에는 update_config를 사용하거나 상단에서 설정 필드를 선택하세요.',
              label: snap.label,
              target: snap.target,
            };
          }
          if (
            (kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook') &&
            (!Number.isInteger(snap.target?.loreIndex) || !snap.entry)
          ) {
            return {
              ok: false,
              error: '수정할 로어북 항목이 선택되지 않았습니다. 상단에서 로어북 항목을 선택하거나 create_lorebook을 사용하세요.',
              label: snap.label,
              target: snap.target,
            };
          }
          const before = snap.content;
          if (proposal.action === 'replace_text') {
            const truncErr = checkTruncationGuard(before, '전체 덮어쓰기(replace_text)');
            if (truncErr) {
              return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
            }
          }
          try {
            const after = proposal.action === 'patch_text'
              ? applyTextEdits(before, proposal.edits, proposal.title || snap.label)
              : String(proposal.content ?? '');
            const isLuaTarget = kind === 'char_lua' || kind === 'module_lua';
            const destructiveWarning = isLuaTarget && snap.hasOtherTriggers
              ? buildLuaDestructiveWarning(snap.otherTriggerCount)
              : null;
            return {
              ok: true,
              before,
              after,
              label: snap.label,
              target: snap.target,
              hostBinding: snap.hostBinding || null,
              destructiveWarning,
              requiresConfirm: Boolean(destructiveWarning),
              confirmLabel: destructiveWarning ? '기존 V1/V2 트리거가 삭제되고 Lua로 대체됨을 확인했습니다' : null,
            };
          } catch (err) {
            return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
          }
        }

        if (proposal.action === 'update_lua') {
          const scope = proposal.scope === 'module' ? 'module_lua' : 'char_lua';
          const snap = await this.readTargetSnapshot({
            targetKind: scope,
            moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
          });
          if (!snap.ok) return { ok: false, error: snap.reason };
          const before = snap.content;
          if (!proposal.edits) {
            const truncErr = checkTruncationGuard(before, 'Lua 전체 교체');
            if (truncErr) {
              return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
            }
          }
          try {
            const after = proposal.edits
              ? applyTextEdits(before, proposal.edits, 'Lua 스크립트')
              : String(proposal.code ?? proposal.content ?? '');
            const destructiveWarning = snap.hasOtherTriggers
              ? buildLuaDestructiveWarning(snap.otherTriggerCount)
              : null;
            return {
              ok: true,
              before,
              after,
              label: snap.label,
              target: snap.target,
              hostBinding: snap.hostBinding || null,
              warning: destructiveWarning,
              destructiveWarning,
              requiresConfirm: Boolean(destructiveWarning),
              confirmLabel: destructiveWarning ? '기존 V1/V2 트리거가 삭제되고 Lua로 대체됨을 확인했습니다' : null,
            };
          } catch (err) {
            return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
          }
        }

        if (proposal.action === 'update_lorebook') {
          const scope = proposal.scope || target.loreScope || 'character';
          const targetKind = scope === 'chat' ? 'chat_lorebook' : scope === 'module' ? 'module_lorebook' : 'char_lorebook';
          const loreIndex = Number.isInteger(proposal.loreIndex) ? proposal.loreIndex : target.loreIndex;
          const fieldKey = proposal.fieldKey || 'content';
          const fieldErr = validateAllowedFieldKey(targetKind, fieldKey);
          if (fieldErr) return { ok: false, error: fieldErr };
          const snap = await this.readTargetSnapshot({
            targetKind,
            loreIndex,
            moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
            fieldKey,
          });
          if (!snap.ok) return { ok: false, error: snap.reason };
          if (!snap.entry) return { ok: false, error: `수정할 로어북 항목(#${loreIndex})을 찾을 수 없습니다.` };

          const before = String(snap.entry[fieldKey] ?? '');
          if (!proposal.edits && (proposal[fieldKey] !== undefined || (fieldKey === 'content' && proposal.content !== undefined))) {
            const truncErr = checkTruncationGuard(before, '로어북 본문 전체 덮어쓰기');
            if (truncErr) return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
          }

          const nextEntry = normalizeLorebookEntry(proposal, snap.entry);
          if (proposal.edits) {
            try {
              nextEntry[fieldKey] = applyTextEdits(before, proposal.edits, '로어북');
            } catch (err) {
              return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
            }
          }
          const after = String(nextEntry[fieldKey] ?? '');
          const metaChanges = computeMetaChanges(snap.entry, nextEntry, LORE_META_SPECS, fieldKey);
          return {
            ok: true,
            before,
            after,
            metaChanges,
            label: snap.label,
            target: snap.target,
            hostBinding: snap.hostBinding || null,
          };
        }

        if (proposal.action === 'update_persona') {
          const fieldKey = proposal.fieldKey || 'personaPrompt';
          const fieldErr = validateAllowedFieldKey('persona', fieldKey);
          if (fieldErr) return { ok: false, error: fieldErr };
          const snap = await this.readTargetSnapshot({
            targetKind: 'persona',
            personaIndex: proposal.personaIndex ?? target.personaIndex,
            fieldKey,
          });
          if (!snap.ok) return { ok: false, error: snap.reason };
          if (!snap.entry) return { ok: false, error: '수정할 페르소나를 찾을 수 없습니다.' };

          const before = String(snap.entry[fieldKey] ?? '');
          if (!proposal.edits && !proposal.fieldEdits && proposal[fieldKey] !== undefined) {
            const truncErr = checkTruncationGuard(before, '페르소나 전체 덮어쓰기');
            if (truncErr) return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
          }

          const nextEntry = clone(snap.entry);
          if (proposal.name !== undefined) nextEntry.name = String(proposal.name);
          if (proposal.note !== undefined) nextEntry.note = String(proposal.note);
          if (proposal.largePortrait !== undefined) nextEntry.largePortrait = Boolean(proposal.largePortrait);
          if (proposal.edits) {
            try {
              nextEntry.personaPrompt = applyTextEdits(String(snap.entry.personaPrompt ?? ''), proposal.edits, '페르소나 프롬프트');
            } catch (err) {
              return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
            }
          } else if (proposal.fieldEdits && proposal.fieldKey) {
            try {
              nextEntry[proposal.fieldKey] = applyTextEdits(String(snap.entry[proposal.fieldKey] ?? ''), proposal.fieldEdits, `페르소나 ${proposal.fieldKey}`);
            } catch (err) {
              return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
            }
          } else if (proposal.personaPrompt !== undefined) {
            nextEntry.personaPrompt = String(proposal.personaPrompt);
          }

          const after = String(nextEntry[fieldKey] ?? '');
          const metaChanges = computeMetaChanges(snap.entry, nextEntry, PERSONA_META_SPECS, fieldKey);
          const flavor = this.detectHostFlavor();
          const isSelected = snap.target.personaIndex === snap.selectedPersona;
          const warning = isSelected && !flavor.activePersonaAutoSyncs && !proposal.bindToCurrentChat
            ? '원본 RisuAI/PocketRisu/RisuBard에서는 현재 선택된 전역 페르소나 UI가 즉시 갱신되지 않을 수 있습니다. "현재 채팅에 바인딩"을 체크하면 즉시 반영됩니다.'
            : null;
          return {
            ok: true,
            before,
            after,
            metaChanges,
            label: snap.label,
            target: snap.target,
            hostBinding: snap.hostBinding || null,
            warning,
          };
        }

        if (proposal.action === 'upsert_regex') {
          const scope = proposal.scope || (target.targetKind === 'module_regex' ? 'module' : 'character');
          const targetKind = scope === 'module' ? 'module_regex' : 'char_regex';
          const idx = Number.isInteger(proposal.regexIndex) ? proposal.regexIndex : null;
          const snap = await this.readTargetSnapshot({
            targetKind,
            regexIndex: idx,
            moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
          });
          if (!snap.ok) return { ok: false, error: snap.reason };
          const existing = idx !== null ? snap.entry : null;
          const nextEntry = normalizeRegexEntry(proposal, existing);
          const metaChanges = existing
            ? computeMetaChanges(existing, nextEntry, REGEX_META_SPECS)
            : REGEX_META_SPECS.map(([key, label]) => ({
                key,
                label,
                before: '(신규)',
                after: formatMetaValue(nextEntry[key]),
              }));
          return {
            ok: true,
            before: existing ? String(existing.out ?? '') : '',
            after: String(nextEntry.out ?? ''),
            metaChanges,
            label: existing ? `${snap.label} 수정` : (proposal.title || `새 정규식 (${nextEntry.comment})`),
            target: snap.target,
            hostBinding: snap.hostBinding || null,
          };
        }

        if (proposal.action === 'create_lorebook') {
          const scope = proposal.scope || target.loreScope || 'character';
          const targetKind = scope === 'chat' ? 'chat_lorebook' : scope === 'module' ? 'module_lorebook' : 'char_lorebook';
          const snap = await this.readTargetSnapshot({
            targetKind,
            moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
          });
          if (!snap.ok) return { ok: false, error: snap.reason };
          const nextEntry = normalizeLorebookEntry(proposal);
          const metaChanges = LORE_META_SPECS
            .filter(([k]) => nextEntry[k] !== undefined && nextEntry[k] !== '' && nextEntry[k] !== false)
            .map(([key, label]) => ({ key, label, before: '(신규)', after: formatMetaValue(nextEntry[key]) }));
          return {
            ok: true,
            before: '',
            after: String(nextEntry.content ?? ''),
            metaChanges,
            label: proposal.title || `새 로어북 (${nextEntry.comment})`,
            target: snap.target,
            hostBinding: snap.hostBinding || null,
          };
        }

        if (proposal.action === 'create_persona') {
          const metaChanges = [
            { key: 'name', label: '이름', before: '(신규)', after: formatMetaValue(proposal.name || 'New Persona') },
          ];
          if (proposal.note) metaChanges.push({ key: 'note', label: '메모', before: '(신규)', after: formatMetaValue(proposal.note) });
          if (proposal.largePortrait) metaChanges.push({ key: 'largePortrait', label: '큰 초상화', before: '(신규)', after: '예' });
          return {
            ok: true,
            before: '',
            after: String(proposal.personaPrompt ?? proposal.content ?? ''),
            metaChanges,
            label: proposal.title || `새 페르소나 (${proposal.name || 'New Persona'})`,
            target,
            hostBinding: null,
          };
        }

        if (proposal.action === 'update_config') {
          const cfg = await this.readAllowedConfig();
          if (!cfg) return { ok: false, error: 'DB 읽기 권한(db)이 필요합니다.' };
          const changes = proposal.changes || {};
          const invalidKeys = Object.keys(changes).filter(k => !ALLOWED_CONFIG_KEYS.includes(k));
          if (invalidKeys.length > 0) {
            return { ok: false, error: `허용되지 않는 설정 키입니다: ${invalidKeys.join(', ')}` };
          }
          const beforeObj = {};
          const afterObj = {};
          for (const [k, v] of Object.entries(changes)) {
            beforeObj[k] = cfg[k];
            afterObj[k] = v;
          }
          return {
            ok: true,
            before: JSON.stringify(beforeObj, null, 2),
            after: JSON.stringify(afterObj, null, 2),
            label: `설정 변경 (${Object.keys(changes).join(', ')})`,
            target,
            hostBinding: null,
          };
        }

        return { ok: false, error: `지원하지 않는 작업 종류입니다: ${proposal.action}` };
      }

      /**
       * Applies a validated proposal to RisuAI using the pinned target and pushes a surgical Undo record.
       */
      async applyProposal(proposal, activeTarget, options = {}) {
        const target = this._resolveSafeTarget(proposal, activeTarget);

        switch (proposal.action) {
          case 'patch_text':
          case 'replace_text':
            return await this._applyTextTarget(proposal, target, options);
          case 'create_lorebook':
            return await this._applyCreateLorebook(proposal, target, options);
          case 'update_lorebook':
            return await this._applyUpdateLorebook(proposal, target, options);
          case 'update_lua':
            return await this._applyUpdateLua(proposal, target, options);
          case 'upsert_regex':
            return await this._applyUpsertRegex(proposal, target, options);
          case 'create_persona':
            return await this._applyCreatePersona(proposal, options);
          case 'update_persona':
            return await this._applyUpdatePersona(proposal, target, options);
          case 'update_config':
            return await this._applyUpdateConfig(proposal);
          default:
            throw new Error(`지원하지 않는 작업 종류입니다: ${proposal.action}`);
        }
      }

      async _applyTextTarget(proposal, target, options = {}) {
        const kind = target.targetKind;
        const compute = (before, label) => {
          if (proposal.action === 'replace_text') {
            const truncErr = checkTruncationGuard(before, '전체 덮어쓰기(replace_text)');
            if (truncErr) throw new Error(truncErr);
            return String(proposal.content ?? '');
          }
          return applyTextEdits(before, proposal.edits, label);
        };

        if (kind === 'char_field') {
          const fieldKey = target.fieldKey || 'desc';
          assertAllowedFieldKey('char_field', fieldKey);
          const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
          const hadKey = Object.hasOwn(char, fieldKey);
          const prevValue = clone(char[fieldKey]);
          const charBinding = { charIndex, ...getCharIdentity(char) };

          const nextChar = clone(char);
          nextChar[fieldKey] = compute(String(nextChar[fieldKey] ?? ''), fieldKey);
          await this._setCharacter(nextChar);

          const undoId = this._pushUndo({
            label: `캐릭터 ${fieldKey} 수정`,
            restore: async () => {
              const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
              const restored = clone(latest);
              if (hadKey) restored[fieldKey] = clone(prevValue);
              else delete restored[fieldKey];
              await this._setCharacter(restored);
            },
          });
          return { ok: true, undoId, summary: `캐릭터 ${CHAR_FIELD_META[fieldKey]?.label || fieldKey}에 적용했습니다.` };
        }

        if (kind === 'chat_note') {
          const fieldKey = target.fieldKey || 'note';
          assertAllowedFieldKey('chat_note', fieldKey);
          const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, '적용');
          const hadKey = Object.hasOwn(chat, 'note');
          const prevValue = clone(chat.note);

          const nextChat = clone(chat);
          nextChat.note = compute(String(nextChat.note ?? ''), '작가의 노트');
          await this._setChat(charIndex, chatIndex, nextChat);

          const undoId = this._pushUndo({
            label: '작가의 노트 수정',
            restore: async () => {
              const latestChat = await this._readChatAt(charIndex, chatIndex);
              if (!latestChat) throw new Error('되돌릴 채팅을 찾을 수 없습니다.');
              const restored = clone(latestChat);
              if (hadKey) restored.note = clone(prevValue);
              else delete restored.note;
              await this._setChat(charIndex, chatIndex, restored);
            },
          });
          return { ok: true, undoId, summary: '현재 채팅의 작가의 노트에 적용했습니다.' };
        }

        if (kind === 'char_lorebook') {
          const fieldKey = target.fieldKey || 'content';
          assertAllowedFieldKey('char_lorebook', fieldKey);
          const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
          const idx = target.loreIndex;
          if (!Number.isInteger(idx) || !char.globalLore?.[idx]) {
            throw new Error('수정할 캐릭터 로어북 인덱스가 올바르지 않습니다.');
          }
          const prevFieldValue = clone(char.globalLore[idx][fieldKey]);
          const charBinding = { charIndex, ...getCharIdentity(char) };

          const nextChar = clone(char);
          const nextStr = compute(String(nextChar.globalLore[idx][fieldKey] ?? ''), '캐릭터 로어북');
          if (fieldKey === 'insertorder') {
            const num = Number(nextStr.trim());
            if (!Number.isFinite(num)) throw new Error('배치 순서(insertorder)는 유한한 숫자여야 합니다.');
            nextChar.globalLore[idx][fieldKey] = num;
          } else {
            nextChar.globalLore[idx][fieldKey] = nextStr;
          }
          await this._setCharacter(nextChar);

          const undoId = this._pushUndo({
            label: `캐릭터 로어북 #${idx + 1} 수정`,
            restore: async () => {
              const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
              if (!latest.globalLore?.[idx]) throw new Error('되돌릴 캐릭터 로어북 항목을 찾을 수 없습니다.');
              const restored = clone(latest);
              restored.globalLore[idx][fieldKey] = clone(prevFieldValue);
              await this._setCharacter(restored);
            },
          });
          return { ok: true, undoId, summary: `캐릭터 로어북 #${idx + 1}의 ${fieldKey}을(를) 수정했습니다.` };
        }

        if (kind === 'chat_lorebook') {
          const fieldKey = target.fieldKey || 'content';
          assertAllowedFieldKey('chat_lorebook', fieldKey);
          const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, '적용');
          const idx = target.loreIndex;
          if (!Number.isInteger(idx) || !chat.localLore?.[idx]) {
            throw new Error('수정할 채팅 로어북 인덱스가 올바르지 않습니다.');
          }
          const prevFieldValue = clone(chat.localLore[idx][fieldKey]);

          const nextChat = clone(chat);
          const nextStr = compute(String(nextChat.localLore[idx][fieldKey] ?? ''), '채팅 로어북');
          if (fieldKey === 'insertorder') {
            const num = Number(nextStr.trim());
            if (!Number.isFinite(num)) throw new Error('배치 순서(insertorder)는 유한한 숫자여야 합니다.');
            nextChat.localLore[idx][fieldKey] = num;
          } else {
            nextChat.localLore[idx][fieldKey] = nextStr;
          }
          await this._setChat(charIndex, chatIndex, nextChat);

          const undoId = this._pushUndo({
            label: `채팅 로어북 #${idx + 1} 수정`,
            restore: async () => {
              const latestChat = await this._readChatAt(charIndex, chatIndex);
              if (!latestChat?.localLore?.[idx]) throw new Error('되돌릴 채팅 로어북 항목을 찾을 수 없습니다.');
              const restored = clone(latestChat);
              restored.localLore[idx][fieldKey] = clone(prevFieldValue);
              await this._setChat(charIndex, chatIndex, restored);
            },
          });
          return { ok: true, undoId, summary: `채팅 로어북 #${idx + 1}의 ${fieldKey}을(를) 수정했습니다.` };
        }

        if (kind === 'char_lua' || kind === 'module_lua') {
          return await this._applyUpdateLua({
            scope: kind === 'module_lua' ? 'module' : 'character',
            moduleIndex: target.moduleIndex,
            edits: proposal.action === 'patch_text' ? proposal.edits : undefined,
            code: proposal.action === 'replace_text' ? proposal.content : undefined,
          }, target, options);
        }

        if (kind === 'persona') {
          const fieldKey = target.fieldKey || 'personaPrompt';
          assertAllowedFieldKey('persona', fieldKey);
          return await this._applyUpdatePersona({
            personaIndex: target.personaIndex,
            [fieldKey]: proposal.action === 'replace_text' ? proposal.content : undefined,
            edits: proposal.action === 'patch_text' && fieldKey === 'personaPrompt' ? proposal.edits : undefined,
            fieldKey,
            fieldEdits: proposal.action === 'patch_text' ? proposal.edits : undefined,
          }, target, options);
        }

        if (kind === 'module_lorebook') {
          const fieldKey = target.fieldKey || 'content';
          assertAllowedFieldKey('module_lorebook', fieldKey);
          return await this._applyUpdateLorebook({
            scope: 'module',
            moduleIndex: target.moduleIndex,
            loreIndex: target.loreIndex,
            fieldKey,
            edits: proposal.action === 'patch_text' ? proposal.edits : undefined,
            [fieldKey]: proposal.action === 'replace_text' ? proposal.content : undefined,
          }, target, options);
        }

        if (kind === 'config' && target.fieldKey && ALLOWED_CONFIG_KEYS.includes(target.fieldKey)) {
          const cfg = await this.readAllowedConfig();
          if (!cfg) throw new Error('DB 읽기 권한(db)이 필요합니다.');
          const nextVal = compute(String(cfg[target.fieldKey] ?? ''), target.fieldKey);
          return await this._applyUpdateConfig({ changes: { [target.fieldKey]: nextVal } });
        }

        throw new Error(`현재 대상(${kind || '없음'})에는 직접 텍스트 적용을 지원하지 않습니다. 상단에서 대상을 선택해 주세요.`);
      }

      async _applyCreateLorebook(proposal, target, options = {}) {
        const scope = proposal.scope || target.loreScope || 'character';
        const entry = normalizeLorebookEntry(proposal);

        if (scope === 'chat') {
          const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, '적용');
          const nextChat = clone(chat);
          nextChat.localLore = Array.isArray(nextChat.localLore) ? nextChat.localLore : [];
          const insertedIndex = nextChat.localLore.length;
          nextChat.localLore.push(entry);
          await this._setChat(charIndex, chatIndex, nextChat);

          const snapshotEntry = clone(entry);
          const undoId = this._pushUndo({
            label: `채팅 로어북 생성 (${entry.comment})`,
            restore: async () => {
              const latestChat = await this._readChatAt(charIndex, chatIndex);
              if (!latestChat) throw new Error('되돌릴 채팅을 찾을 수 없습니다.');
              const restored = clone(latestChat);
              removeCreatedItem(restored.localLore, insertedIndex, e =>
                e && e.comment === snapshotEntry.comment && e.key === snapshotEntry.key && e.content === snapshotEntry.content
              );
              await this._setChat(charIndex, chatIndex, restored);
            },
          });
          return { ok: true, undoId, summary: `새 채팅 로어북 "${entry.comment}"을(를) 추가했습니다.` };
        }

        if (scope === 'module') {
          const { modules, permissionDenied } = await this.readModules();
          if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
          const modIdx = Number.isInteger(proposal.moduleIndex) ? proposal.moduleIndex : (target.moduleIndex ?? 0);
          if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
          const moduleId = modules[modIdx].id;
          const nextModules = clone(modules);
          nextModules[modIdx].lorebook = Array.isArray(nextModules[modIdx].lorebook) ? nextModules[modIdx].lorebook : [];
          const insertedIndex = nextModules[modIdx].lorebook.length;
          nextModules[modIdx].lorebook.push(entry);
          await this.writeDbSubset({ modules: nextModules });

          const snapshotEntry = clone(entry);
          const undoId = this._pushUndo({
            label: `모듈 로어북 생성 (${entry.comment})`,
            restore: async () => {
              const { modules: latestModules } = await this.readModules();
              const idx = latestModules.findIndex(m => m.id === moduleId);
              if (idx === -1) throw new Error('되돌릴 모듈을 찾을 수 없습니다.');
              const restored = clone(latestModules);
              removeCreatedItem(restored[idx].lorebook, insertedIndex, e =>
                e && e.comment === snapshotEntry.comment && e.key === snapshotEntry.key && e.content === snapshotEntry.content
              );
              await this.writeDbSubset({ modules: restored });
            },
          });
          return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}"에 새 로어북 "${entry.comment}"을(를) 추가했습니다.` };
        }

        // Default: character lorebook
        const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
        const charBinding = { charIndex, ...getCharIdentity(char) };
        const nextChar = clone(char);
        nextChar.globalLore = Array.isArray(nextChar.globalLore) ? nextChar.globalLore : [];
        const insertedIndex = nextChar.globalLore.length;
        nextChar.globalLore.push(entry);
        await this._setCharacter(nextChar);

        const snapshotEntry = clone(entry);
        const undoId = this._pushUndo({
          label: `캐릭터 로어북 생성 (${entry.comment})`,
          restore: async () => {
            const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
            const restored = clone(latest);
            removeCreatedItem(restored.globalLore, insertedIndex, e =>
              e && e.comment === snapshotEntry.comment && e.key === snapshotEntry.key && e.content === snapshotEntry.content
            );
            await this._setCharacter(restored);
          },
        });
        return { ok: true, undoId, summary: `새 캐릭터 로어북 "${entry.comment}"을(를) 추가했습니다.` };
      }

      async _applyUpdateLorebook(proposal, target, options = {}) {
        const scope = proposal.scope || target.loreScope || 'character';
        const loreIndex = Number.isInteger(proposal.loreIndex) ? proposal.loreIndex : target.loreIndex;
        if (!Number.isInteger(loreIndex) || loreIndex < 0) {
          throw new Error('수정할 로어북 인덱스(loreIndex)가 필요합니다.');
        }
        const fieldKey = proposal.fieldKey || 'content';
        assertAllowedFieldKey('char_lorebook', fieldKey);

        const mutateEntry = (existing) => {
          if (!proposal.edits && (proposal[fieldKey] !== undefined || (fieldKey === 'content' && proposal.content !== undefined))) {
            const truncErr = checkTruncationGuard(String(existing[fieldKey] ?? ''), '로어북 전체 덮어쓰기');
            if (truncErr) throw new Error(truncErr);
          }
          const next = normalizeLorebookEntry(proposal, existing);
          if (proposal.edits) {
            const nextStr = applyTextEdits(String(existing[fieldKey] ?? ''), proposal.edits, '로어북');
            if (fieldKey === 'insertorder') {
              const num = Number(nextStr.trim());
              if (!Number.isFinite(num)) throw new Error('배치 순서(insertorder)는 유한한 숫자여야 합니다.');
              next[fieldKey] = num;
            } else {
              next[fieldKey] = nextStr;
            }
          }
          return next;
        };

        if (scope === 'chat') {
          const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, '적용');
          if (!chat?.localLore?.[loreIndex]) throw new Error(`채팅 로어북 #${loreIndex + 1}을(를) 찾을 수 없습니다.`);
          const prevEntry = clone(chat.localLore[loreIndex]);
          const nextChat = clone(chat);
          nextChat.localLore[loreIndex] = mutateEntry(nextChat.localLore[loreIndex]);
          await this._setChat(charIndex, chatIndex, nextChat);

          const undoId = this._pushUndo({
            label: `채팅 로어북 #${loreIndex + 1} 수정`,
            restore: async () => {
              const latestChat = await this._readChatAt(charIndex, chatIndex);
              if (!latestChat?.localLore?.[loreIndex]) throw new Error('되돌릴 채팅 로어북 항목을 찾을 수 없습니다.');
              const restored = clone(latestChat);
              restored.localLore[loreIndex] = clone(prevEntry);
              await this._setChat(charIndex, chatIndex, restored);
            },
          });
          return { ok: true, undoId, summary: `채팅 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
        }

        if (scope === 'module') {
          const { modules, permissionDenied } = await this.readModules();
          if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
          const modIdx = Number.isInteger(proposal.moduleIndex) ? proposal.moduleIndex : (target.moduleIndex ?? 0);
          if (!modules[modIdx]?.lorebook?.[loreIndex]) throw new Error('대상 모듈 로어북 항목을 찾을 수 없습니다.');
          const moduleId = modules[modIdx].id;
          const prevEntry = clone(modules[modIdx].lorebook[loreIndex]);
          const nextModules = clone(modules);
          nextModules[modIdx].lorebook[loreIndex] = mutateEntry(nextModules[modIdx].lorebook[loreIndex]);
          await this.writeDbSubset({ modules: nextModules });

          const undoId = this._pushUndo({
            label: `모듈 로어북 #${loreIndex + 1} 수정`,
            restore: async () => {
              const { modules: latestModules } = await this.readModules();
              const idx = latestModules.findIndex(m => m.id === moduleId);
              if (idx === -1 || !latestModules[idx].lorebook?.[loreIndex]) throw new Error('되돌릴 모듈 로어북 항목을 찾을 수 없습니다.');
              const restored = clone(latestModules);
              restored[idx].lorebook[loreIndex] = clone(prevEntry);
              await this.writeDbSubset({ modules: restored });
            },
          });
          return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}" 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
        }

        const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
        if (!char?.globalLore?.[loreIndex]) throw new Error(`캐릭터 로어북 #${loreIndex + 1}을(를) 찾을 수 없습니다.`);
        const charBinding = { charIndex, ...getCharIdentity(char) };
        const prevEntry = clone(char.globalLore[loreIndex]);
        const nextChar = clone(char);
        nextChar.globalLore[loreIndex] = mutateEntry(nextChar.globalLore[loreIndex]);
        await this._setCharacter(nextChar);

        const undoId = this._pushUndo({
          label: `캐릭터 로어북 #${loreIndex + 1} 수정`,
          restore: async () => {
            const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
            if (!latest.globalLore?.[loreIndex]) throw new Error('되돌릴 캐릭터 로어북 항목을 찾을 수 없습니다.');
            const restored = clone(latest);
            restored.globalLore[loreIndex] = clone(prevEntry);
            await this._setCharacter(restored);
          },
        });
        return { ok: true, undoId, summary: `캐릭터 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
      }

      async _applyUpdateLua(proposal, target, options = {}) {
        const scope = proposal.scope || (target.targetKind === 'module_lua' ? 'module' : 'character');

        if (scope === 'module') {
          const { modules, permissionDenied } = await this.readModules();
          if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
          const modIdx = Number.isInteger(proposal.moduleIndex) ? proposal.moduleIndex : (target.moduleIndex ?? 0);
          if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
          const luaInfo = extractLuaFromTriggers(modules[modIdx].trigger);
          if (luaInfo.hasOtherTriggers && options.requireDestructiveConfirm && !options.destructiveConfirmed) {
            throw new Error('기존 V1/V2 트리거 삭제 확인 체크가 필요합니다.');
          }
          if (!proposal.edits) {
            const truncErr = checkTruncationGuard(luaInfo.code, '모듈 Lua 전체 교체');
            if (truncErr) throw new Error(truncErr);
          }

          const moduleId = modules[modIdx].id;
          const prevTriggers = clone(modules[modIdx].trigger);
          const nextModules = clone(modules);
          const nextCode = proposal.edits
            ? applyTextEdits(luaInfo.code, proposal.edits, '모듈 Lua')
            : String(proposal.code ?? proposal.content ?? '');
          nextModules[modIdx].trigger = buildLuaTriggers(nextCode);
          await this.writeDbSubset({ modules: nextModules });

          const undoId = this._pushUndo({
            label: `모듈 Lua 수정 (${nextModules[modIdx].name})`,
            restore: async () => {
              const { modules: latestModules } = await this.readModules();
              const idx = latestModules.findIndex(m => m.id === moduleId);
              if (idx === -1) throw new Error('되돌릴 모듈을 찾을 수 없습니다.');
              const restored = clone(latestModules);
              restored[idx].trigger = clone(prevTriggers);
              await this.writeDbSubset({ modules: restored });
            },
          });
          return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}" Lua 스크립트를 저장했습니다.` };
        }

        const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
        const luaInfo = extractLuaFromTriggers(char.triggerscript);
        if (luaInfo.hasOtherTriggers && options.requireDestructiveConfirm && !options.destructiveConfirmed) {
          throw new Error('기존 V1/V2 트리거 삭제 확인 체크가 필요합니다.');
        }
        if (!proposal.edits) {
          const truncErr = checkTruncationGuard(luaInfo.code, '캐릭터 Lua 전체 교체');
          if (truncErr) throw new Error(truncErr);
        }

        const charBinding = { charIndex, ...getCharIdentity(char) };
        const prevTriggers = clone(char.triggerscript);
        const nextChar = clone(char);
        const nextCode = proposal.edits
          ? applyTextEdits(luaInfo.code, proposal.edits, '캐릭터 Lua')
          : String(proposal.code ?? proposal.content ?? '');
        nextChar.triggerscript = buildLuaTriggers(nextCode);
        await this._setCharacter(nextChar);

        const undoId = this._pushUndo({
          label: `캐릭터 Lua 수정 (${nextChar.name})`,
          restore: async () => {
            const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
            const restored = clone(latest);
            restored.triggerscript = clone(prevTriggers);
            await this._setCharacter(restored);
          },
        });
        return { ok: true, undoId, summary: `캐릭터 "${nextChar.name}" Lua 트리거 스크립트를 저장했습니다.` };
      }

      async _applyUpsertRegex(proposal, target, options = {}) {
        const scope = proposal.scope || (target.targetKind === 'module_regex' ? 'module' : 'character');
        const idx = Number.isInteger(proposal.regexIndex) ? proposal.regexIndex : null;

        if (scope === 'module') {
          const { modules, permissionDenied } = await this.readModules();
          if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
          const modIdx = Number.isInteger(proposal.moduleIndex) ? proposal.moduleIndex : (target.moduleIndex ?? 0);
          if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
          const moduleId = modules[modIdx].id;
          const nextModules = clone(modules);
          nextModules[modIdx].regex = Array.isArray(nextModules[modIdx].regex) ? nextModules[modIdx].regex : [];

          const isUpdate = idx !== null && Boolean(nextModules[modIdx].regex[idx]);
          const prevEntry = isUpdate ? clone(nextModules[modIdx].regex[idx]) : null;
          const savedEntry = isUpdate
            ? normalizeRegexEntry(proposal, nextModules[modIdx].regex[idx])
            : normalizeRegexEntry(proposal);
          const insertedIndex = isUpdate ? idx : nextModules[modIdx].regex.length;
          if (isUpdate) nextModules[modIdx].regex[idx] = savedEntry;
          else nextModules[modIdx].regex.push(savedEntry);

          await this.writeDbSubset({ modules: nextModules });
          const snapshotEntry = clone(savedEntry);
          const undoId = this._pushUndo({
            label: `모듈 정규식 저장 (${proposal.comment || 'Regex'})`,
            restore: async () => {
              const { modules: latestModules } = await this.readModules();
              const mIdx = latestModules.findIndex(m => m.id === moduleId);
              if (mIdx === -1) throw new Error('되돌릴 모듈을 찾을 수 없습니다.');
              const restored = clone(latestModules);
              if (isUpdate) {
                if (!restored[mIdx].regex?.[idx]) throw new Error('되돌릴 모듈 정규식 항목을 찾을 수 없습니다.');
                restored[mIdx].regex[idx] = clone(prevEntry);
              } else {
                removeCreatedItem(restored[mIdx].regex, insertedIndex, e =>
                  e && e.comment === snapshotEntry.comment && e.in === snapshotEntry.in && e.out === snapshotEntry.out
                );
              }
              await this.writeDbSubset({ modules: restored });
            },
          });
          return { ok: true, undoId, summary: `모듈 "${nextModules[modIdx].name}" 정규식을 저장했습니다.` };
        }

        const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, '적용');
        const charBinding = { charIndex, ...getCharIdentity(char) };
        const nextChar = clone(char);
        nextChar.customscript = Array.isArray(nextChar.customscript) ? nextChar.customscript : [];

        const isUpdate = idx !== null && Boolean(nextChar.customscript[idx]);
        const prevEntry = isUpdate ? clone(nextChar.customscript[idx]) : null;
        const savedEntry = isUpdate
          ? normalizeRegexEntry(proposal, nextChar.customscript[idx])
          : normalizeRegexEntry(proposal);
        const insertedIndex = isUpdate ? idx : nextChar.customscript.length;
        if (isUpdate) nextChar.customscript[idx] = savedEntry;
        else nextChar.customscript.push(savedEntry);

        await this._setCharacter(nextChar);
        const snapshotEntry = clone(savedEntry);
        const undoId = this._pushUndo({
          label: `캐릭터 정규식 저장 (${proposal.comment || 'Regex'})`,
          restore: async () => {
            const { char: latest } = await this._requireSameActiveCharacter(charBinding, '되돌리기');
            const restored = clone(latest);
            if (isUpdate) {
              if (!restored.customscript?.[idx]) throw new Error('되돌릴 캐릭터 정규식 항목을 찾을 수 없습니다.');
              restored.customscript[idx] = clone(prevEntry);
            } else {
              removeCreatedItem(restored.customscript, insertedIndex, e =>
                e && e.comment === snapshotEntry.comment && e.in === snapshotEntry.in && e.out === snapshotEntry.out
              );
            }
            await this._setCharacter(restored);
          },
        });
        return { ok: true, undoId, summary: `캐릭터 정규식 "${proposal.comment || 'New Regex'}"을(를) 저장했습니다.` };
      }

      async _bindPersonaToActiveChat(personaId) {
        const { chat, charIndex, chatIndex } = await this.readActiveChat();
        if (!chat) return null;
        const hadKey = Object.hasOwn(chat, 'bindedPersona');
        const prevBindedPersona = chat.bindedPersona;
        const nextChat = clone(chat);
        nextChat.bindedPersona = personaId;
        await this._setChat(charIndex, chatIndex, nextChat);
        return async () => {
          const latestChat = await this._readChatAt(charIndex, chatIndex);
          if (!latestChat) return;
          const restored = clone(latestChat);
          if (hadKey) restored.bindedPersona = prevBindedPersona;
          else delete restored.bindedPersona;
          await this._setChat(charIndex, chatIndex, restored);
        };
      }

      async _applyCreatePersona(proposal, options) {
        const { personas, permissionDenied } = await this.readPersonas();
        if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
        const nextPersonas = clone(personas);
        const newPersona = {
          name: String(proposal.name || 'New Persona'),
          personaPrompt: String(proposal.personaPrompt ?? proposal.content ?? ''),
          icon: String(proposal.icon || ''),
          note: String(proposal.note || ''),
          largePortrait: Boolean(proposal.largePortrait),
          id: makeUuid(),
        };
        const insertedIndex = nextPersonas.length;
        nextPersonas.push(newPersona);
        await this.writeDbSubset({ personas: nextPersonas });

        let restoreChat = null;
        const shouldBind = Boolean(options.bindToCurrentChat ?? proposal.bindToCurrentChat);
        if (shouldBind) {
          restoreChat = await this._bindPersonaToActiveChat(newPersona.id);
        }

        const createdId = newPersona.id;
        const undoId = this._pushUndo({
          label: `새 페르소나 생성 (${newPersona.name})`,
          restore: async () => {
            const { personas: latestPersonas } = await this.readPersonas();
            const restored = clone(latestPersonas);
            removeCreatedItem(restored, insertedIndex, p => p && p.id === createdId);
            await this.writeDbSubset({ personas: restored });
            if (restoreChat) await restoreChat();
          },
        });
        return {
          ok: true,
          undoId,
          personaId: newPersona.id,
          summary: shouldBind && restoreChat
            ? `새 페르소나 "${newPersona.name}"을(를) 만들고 현재 채팅에 바인딩했습니다.`
            : `새 페르소나 "${newPersona.name}"을(를) 생성했습니다. 페르소나 설정에서 선택해 사용할 수 있습니다.`,
        };
      }

      async _applyUpdatePersona(proposal, target, options) {
        const { personas, selectedPersona, permissionDenied } = await this.readPersonas();
        if (permissionDenied) throw new Error('DB 읽기 권한(db)이 필요합니다.');
        const idx = Number.isInteger(proposal.personaIndex)
          ? proposal.personaIndex
          : (Number.isInteger(target.personaIndex) ? target.personaIndex : selectedPersona);
        if (!personas[idx]) throw new Error(`페르소나 #${idx + 1}을(를) 찾을 수 없습니다.`);

        if (proposal.fieldKey !== undefined) {
          assertAllowedFieldKey('persona', proposal.fieldKey);
        }

        const prevPersona = clone(personas[idx]);
        const nextPersonas = clone(personas);
        const cur = nextPersonas[idx];
        if (!cur.id) cur.id = makeUuid();

        if (!proposal.edits && !proposal.fieldEdits) {
          const checkKey = proposal.fieldKey || 'personaPrompt';
          if (proposal[checkKey] !== undefined) {
            const truncErr = checkTruncationGuard(String(cur[checkKey] ?? ''), '페르소나 전체 덮어쓰기');
            if (truncErr) throw new Error(truncErr);
          }
        }

        if (proposal.name !== undefined) cur.name = String(proposal.name);
        if (proposal.note !== undefined) cur.note = String(proposal.note);
        if (proposal.largePortrait !== undefined) cur.largePortrait = Boolean(proposal.largePortrait);
        if (proposal.edits) {
          cur.personaPrompt = applyTextEdits(String(cur.personaPrompt ?? ''), proposal.edits, '페르소나 프롬프트');
        } else if (proposal.fieldEdits && proposal.fieldKey) {
          cur[proposal.fieldKey] = applyTextEdits(String(cur[proposal.fieldKey] ?? ''), proposal.fieldEdits, `페르소나 ${proposal.fieldKey}`);
        } else if (proposal.personaPrompt !== undefined) {
          cur.personaPrompt = String(proposal.personaPrompt);
        }

        await this.writeDbSubset({ personas: nextPersonas });

        let restoreChat = null;
        const shouldBind = Boolean(options.bindToCurrentChat ?? proposal.bindToCurrentChat);
        if (shouldBind) {
          restoreChat = await this._bindPersonaToActiveChat(cur.id);
        }

        const savedId = cur.id;
        const undoId = this._pushUndo({
          label: `페르소나 수정 (${cur.name})`,
          restore: async () => {
            const { personas: latestPersonas } = await this.readPersonas();
            const restored = clone(latestPersonas);
            let targetIdx = restored.findIndex(p => p && p.id === savedId);
            if (targetIdx === -1 && restored[idx]) targetIdx = idx;
            if (targetIdx === -1) throw new Error('되돌릴 페르소나를 찾을 수 없습니다.');
            restored[targetIdx] = clone(prevPersona);
            await this.writeDbSubset({ personas: restored });
            if (restoreChat) await restoreChat();
          },
        });
        return {
          ok: true,
          undoId,
          summary: shouldBind && restoreChat
            ? `페르소나 "${cur.name}"을(를) 수정하고 현재 채팅에 바인딩했습니다.`
            : `페르소나 "${cur.name}"을(를) 수정했습니다.`,
        };
      }

      async _applyUpdateConfig(proposal) {
        const changes = proposal.changes || {};
        const keys = Object.keys(changes);
        if (keys.length === 0) throw new Error('변경할 설정 항목이 없습니다.');

        const cfg = await this.readAllowedConfig();
        if (!cfg) throw new Error('DB 읽기 권한(db)이 필요합니다.');

        const prev = {};
        const next = {};
        for (const k of keys) {
          if (!ALLOWED_CONFIG_KEYS.includes(k)) {
            throw new Error(`허용되지 않는 설정 키입니다: ${k}`);
          }
          const expectedType = CONFIG_KEY_TYPES[k];
          const val = changes[k];
          if (expectedType === 'array') {
            if (!Array.isArray(val)) throw new Error(`${k}는 배열이어야 합니다.`);
          } else if (expectedType === 'number') {
            if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error(`${k}는 유한한 숫자여야 합니다.`);
          } else if (expectedType === 'boolean') {
            if (typeof val !== 'boolean') throw new Error(`${k}는 boolean이어야 합니다.`);
          } else if (expectedType === 'string') {
            if (typeof val !== 'string') throw new Error(`${k}는 문자열이어야 합니다.`);
          } else if (expectedType === 'object') {
            if (!val || typeof val !== 'object' || Array.isArray(val)) throw new Error(`${k}는 객체여야 합니다.`);
          }
          prev[k] = clone(cfg[k]);
          next[k] = val;
        }

        await this.writeDbSubset(next);
        const undoId = this._pushUndo({
          label: `설정 변경 (${keys.join(', ')})`,
          restore: async () => { await this.writeDbSubset(prev); },
        });
        return { ok: true, undoId, summary: `설정(${keys.join(', ')})을 적용했습니다.` };
      }

      async undo(undoId = null) {
        if (this.undoStack.length === 0) throw new Error('되돌릴 내역이 없습니다.');
        let idx = this.undoStack.length - 1;
        if (undoId) {
          idx = this.undoStack.findIndex(item => item.id === undoId);
          if (idx === -1) throw new Error('해당 되돌리기 기록을 찾을 수 없습니다.');
        }
        const [entry] = this.undoStack.splice(idx, 1);
        await entry.restore();
        return { ok: true, label: entry.label };
      }
    }

      __exports.extractLuaFromTriggers = extractLuaFromTriggers;
      __exports.buildLuaTriggers = buildLuaTriggers;
      __exports.normalizeLorebookEntry = normalizeLorebookEntry;
      __exports.normalizeRegexEntry = normalizeRegexEntry;
      __exports.HostAdapter = HostAdapter;

  },
  "src/knowledge.js"(__require, __exports) {
    // Built-in RisuAI & fork knowledge base grounded in kwaroran/Risuai source code.

    const KNOWLEDGE_SECTIONS = {
      core: `[RisuAI 기본 구조]
    - RisuAI는 캐릭터 카드(CCv2/CCv3), 로어북, 모듈(.risum), 페르소나, 정규식, Lua 트리거 스크립트, 프롬프트 템플릿을 조합해 LLM에 요청하는 롤플레이 클라이언트입니다.
    - 주요 공개 포크: 원본(kwaroran/Risuai), PocketRisu(셀프호스팅), RisuBard(PocketRisu 기반 + BardWiki 서사 메모리), HaejeokRisuai(해적리스, 메모리/도메인 스토어 최적화), RisuNest(네이티브 앱).`,

      character: `[캐릭터 설정 필드 가이드]
    - desc (설명): 캐릭터의 핵심 외형·성격·세계관·관계·말투를 담는 메인 프롬프트. personality/scenario 필드는 구버전 호환용으로 비워 두고 desc에 통합하는 것이 권장됩니다.
    - firstMessage (첫 메시지) / alternateGreetings (추가 첫 메시지): 대화 시작 시 AI가 보내는 첫 출력. 문체와 서술 시점(1인칭/3인칭)을 결정합니다.
    - systemPrompt (시스템 프롬프트): 비어 있지 않으면 전역 메인 프롬프트를 대체합니다.
    - replaceGlobalNote (글로벌 노트 덮어쓰기): 비어 있지 않으면 전역 UJB/글로벌 노트를 대체합니다.
    - backgroundHTML (백그라운드 임베딩): 채팅 배경에 삽입되는 HTML/CSS/마크다운. {{bg::에셋명}}, {{audio::에셋명}} 등을 사용할 수 있습니다.
    - chat.note (작가의 노트): 현재 채팅 세션에만 주입되는 방향성·문체·전개 지시 메모입니다.
    - creatorNotes (제작자 코멘트): 프롬프트에 직접 들어가지 않는 제작자 안내 메모입니다.`,

      lorebook: `[로어북 (Lorebook) 가이드]
    - 3가지 스코프: (1) 캐릭터 로어북(char.globalLore), (2) 현재 채팅 로컬 로어북(chat.localLore), (3) 모듈 로어북(db.modules[i].lorebook).
    - 주요 필드:
      - comment: 목록에 표시되는 항목 이름
      - key: 활성화 키워드 (쉼표로 구분). 채팅 최근 메시지(scanDepth)에서 매칭되면 프롬프트에 삽입.
      - secondkey + selective(true): 보조 키. 1차 키와 2차 키가 모두 매칭되어야 활성화.
      - alwaysActive(true): 키워드 없이 항상 활성화.
      - insertorder(숫자, 기본 100): 높을수록 우선순위가 높아 토큰 예산(loreBookToken) 안에서 먼저 채택되고 프롬프트 하단에 가깝게 배치.
      - useRegex(true): 활성화 키를 정규식으로 매칭.
      - activationPercent: 0~100 확률 활성화.
      - mode: 'normal' | 'constant' | 'multiple' | 'child' | 'folder' (폴더는 key가 '\\uf000folder:<uuid>').
    - 주요 데코레이터(본문 최상단 줄에 기재):
      - @@depth N: 채팅 끝에서 N번째 위치에 삽입
      - @@role user|assistant|system: 삽입 메시지 역할 지정
      - @@dont_activate: 자동 활성화 차단 / @@activate: 강제 활성화
      - @@activate_only_after N / @@activate_only_every N: 턴 조건 제어
      - @@position pt_name: 특정 프롬프트 위치 지정
      - @@disable_ui_prompt / @@inject_at ...`,

      lua: `[RisuAI Lua 트리거 스크립트 가이드]
    - 저장 구조: char.triggerscript (또는 module.trigger) = [{ comment: "", type: "start", conditions: [], effect: [{ type: "triggerlua", code: "<Lua 코드>" }] }].
    - 주요 진입점(이벤트 훅):
      - function onStart(triggerId) ... end  -- 트리거 시작/수동 실행
      - function onInput(triggerId) ... end  -- 유저 입력 시
      - function onOutput(triggerId) ... end -- AI 출력 직후
      - function onButtonClick(triggerId, code) ... end -- {{button::표시명::코드}} 또는 risu-trigger 클릭 시
      - listenEdit("editDisplay"|"editInput"|"editOutput"|"editProcess", function(triggerId, data) return data end)
    - 주요 내장 Lua API (첫 인자 triggerId 전달):
      - 상태 변수: getChatVar(id, key), setChatVar(id, key, val), getGlobalVar(id, key)
      - 채팅 조작: getChat(id, idx), setChat(id, idx, text), getChatRole(id, idx), setChatRole(id, idx, role), getChatLength(id), getFullChat(id), setFullChat(id, tbl), addChat(id, role, text), insertChat(id, idx, role, text), removeChat(id, idx), cutChat(id, start, end), getCharacterLastMessage(id), getUserLastMessage(id)
      - 캐릭터/페르소나: getName(id), setName(id, name), getDescription(id), setDescription(id, desc), getCharacterFirstMessage(id), setCharacterFirstMessage(id, text), getPersonaName(id), getPersonaDescription(id), getAuthorsNote(id), getBackgroundEmbedding(id), setBackgroundEmbedding(id, html)
      - 로어북: getLoreBooks(id, search), upsertLocalLoreBook(id, name, content, options), loadLoreBooks(id, reserveTokens)
      - LLM/유틸: LLM(id, messages, multimodal, opts), axLLM(id, messages, multimodal, opts), simpleLLM(id, prompt), cbs(text), getTokens(id, text), sleep(id, ms), reloadDisplay(id), reloadChat(id, idx), stopChat(id), log(msg)
      - UI 알림: alertNormal(id, msg), alertError(id, msg), alertInput(id, msg, def), alertSelect(id, opts), alertConfirm(id, msg)
    - 주의: Lua 인덱스는 1-based이지만 RisuAI 채팅 인덱스(getChat/setChat)는 0-based(또는 음수 -1이 마지막 메시지)인 API가 있으므로 경계 확인이 중요합니다.`,

      regex: `[RisuAI 정규식 스크립트 (customscript) 가이드]
    - 필드: comment(이름), in(정규식 패턴, 양쪽 슬래시 없이 작성), out(치환 문자열), type, flag(정규식 플래그 예: 'g', 'gi', 'gm'), ableFlag(플래그 커스텀 활성화 여부).
    - type 종류:
      - editinput: 유저 입력문 수정
      - editoutput: AI 출력문 영구 수정
      - editprocess: LLM 요청 전송 직전 리퀘스트 데이터 수정
      - editdisplay: 저장 데이터는 유지하고 화면 표시만 수정 (HTML/CSS 상태창 렌더링에 가장 많이 사용)
    - out 특수 치환자: $&(전체 매치), $1/$2(캡처 그룹), $$(리터럴 $), @@emo <감정명>(감정 이미지 고정).`,

      cbs: `[CBS (Curly Braced Syntax) 핵심 문법]
    - 기본 치환: {{char}}, {{user}}, {{persona}}, {{description}}, {{lastmessage}}, {{chat_index}}
    - 변수: {{getvar::key}}, {{setvar::key::val}}, {{addvar::key::1}}, {{getglobalvar::key}}
    - 조건/분기: {{#if {{? {{getvar::hp}}<=0}}}}...{{/if}}, {{#when::...}}...{{/when}}
    - 랜덤/버튼/에셋: {{random::A::B::C}}, {{button::표시텍스트::트리거이름}}, {{img::에셋명}}, {{bg::에셋명}}, {{audio::에셋명}}
    - 주석: {{// 프롬프트에 포함되지 않는 주석 }}`,

      persona: `[페르소나 (Persona) 가이드]
    - db.personas 배열에 { name, personaPrompt, icon, note, id, largePortrait, embeddedModule } 형태로 저장되며, db.selectedPersona가 현재 선택된 전역 페르소나 인덱스입니다.
    - 특정 채팅에 페르소나를 고정하려면 chat.bindedPersona = persona.id 를 설정합니다.
    - 포크별 차이:
      - HaejeokRisuai(해적리스), RisuNest: db.personas/selectedPersona 수정 시 현재 화면과 채팅에 즉시 반영됩니다.
      - 원본 RisuAI, PocketRisu, RisuBard: 전역 미바인딩 페르소나는 별도 미러 필드(username/personaPrompt/userNote)를 읽으므로, 새 페르소나 생성 후 선택하거나 현재 채팅에 bindedPersona로 바인딩해야 즉시 반영됩니다.`,

      config: `[RisuAI 컨피그 / 설정 가이드]
    - 플러그인 v3가 직접 읽고 수정할 수 있는 주요 설정(allowedDbKeys):
      - temperature: 생성 다양성/창의성 (보통 0.6~1.2, 높을수록 자유롭고 낮을수록 일관적; RisuAI 내부에서는 0~200 정수 스케일 또는 모델별 실수 스케일로 저장될 수 있으므로 현재 저장된 값을 먼저 확인하고 같은 스케일로 수정!)
      - maxContext: 모델에 보낼 최대 컨텍스트 토큰 수
      - maxResponse: AI 한 번의 응답 최대 출력 토큰 수
      - frequencyPenalty / PresensePenalty: 반복 억제 페널티 (RisuAI 원본 키 철자가 'PresensePenalty'임에 주의)
      - theme / textTheme / colorSchemeName / lineHeight: UI 테마 및 가독성
      - customCSS / guiHTML: 화면 커스텀 CSS 및 GUI HTML (문제 발생 시 Ctrl+. 로 Custom CSS 토글)
      - enabledModules / moduleIntergration: 전역 활성화 모듈 ID 목록 및 모듈 통합 문자열
      - seperateModels / seperateModelsForAxModels: 보조 작업별 별도 모델 설정
    - 플러그인이 보안상 직접 접근할 수 없는 설정(사용자가 RisuAI 설정 메뉴에서 직접 변경해야 함): API 키, 메인 모델 선택(aiModel), 프롬프트 템플릿 순서(formatingOrder), 로어북 기본 스캔 깊이/예산(loreBookDepth/loreBookToken — 단 캐릭터별 char.loreSettings는 수정 가능).`,
    };

    function buildKnowledgeForContext(context) {
      const keys = new Set(['core']);
      const screen = context?.screen || 'unknown';
      const kind = context?.targetKind || 'general';

      if (screen === 'character' || kind === 'char_field') {
        keys.add('character');
        keys.add('cbs');
      }
      if (screen === 'lorebook' || kind.includes('lorebook')) {
        keys.add('lorebook');
        keys.add('cbs');
      }
      if (screen === 'scripts' || kind.includes('lua') || kind.includes('regex')) {
        keys.add('lua');
        keys.add('regex');
        keys.add('cbs');
      }
      if (screen === 'persona' || kind === 'persona') {
        keys.add('persona');
        keys.add('cbs');
      }
      if (screen === 'module' || kind.startsWith('module_')) {
        keys.add('lorebook');
        keys.add('lua');
        keys.add('regex');
        keys.add('cbs');
      }
      if (screen === 'settings' || kind === 'config') {
        keys.add('config');
      }
      if (screen === 'chat' || screen === 'unknown' || kind === 'general' || kind === 'chat_message') {
        keys.add('character');
        keys.add('lorebook');
        keys.add('config');
        keys.add('cbs');
      }

      return [...keys].map(k => KNOWLEDGE_SECTIONS[k]).join('\n\n');
    }

    function getQuickPromptsForContext(context) {
      const kind = context?.targetKind || 'general';
      const screen = context?.screen || 'unknown';

      if (kind === 'char_lua' || kind === 'module_lua') {
        return [
          { label: 'Lua 디버깅', prompt: '현재 Lua 트리거 스크립트에서 버그나 RisuAI API 오용이 있는지 점검하고 수정안을 제안해 줘.' },
          { label: '새 기능 추가', prompt: '현재 Lua 스크립트에 상태 변수나 버튼 트리거 기능을 추가하고 싶어. 어떤 구조가 좋을지 설명하고 수정안을 만들어 줘.' },
          { label: 'Lua API 가이드', prompt: 'RisuAI Lua 트리거에서 자주 쓰는 API와 onInput/onOutput/onButtonClick 사용법을 예시와 함께 알려 줘.' },
        ];
      }
      if (kind === 'char_regex' || kind === 'module_regex') {
        return [
          { label: '정규식 점검', prompt: '현재 정규식 스크립트의 IN 패턴과 OUT 치환이 의도대로 동작할지 검증하고 개선안을 제안해 줘.' },
          { label: '새 정규식 생성', prompt: '채팅 출력에서 특정 태그를 깔끔한 상태창 HTML로 바꾸는 editdisplay 정규식을 새로 만들어 줘.' },
          { label: '정규식 사용법', prompt: 'editinput, editoutput, editprocess, editdisplay의 차이와 안전한 작성 요령을 알려 줘.' },
        ];
      }
      if (kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook' || screen === 'lorebook') {
        return [
          { label: '현재 로어북 다듬기', prompt: '현재 선택된 로어북 항목의 키워드, 배치 순서, 본문을 토큰 효율적이고 명확하게 다듬는 수정안을 제안해 줘.' },
          { label: '새 로어북 생성', prompt: '현재 캐릭터 세계관에 어울리는 새 로어북 항목 초안을 제안해 줘.' },
          { label: '로어북 사용법', prompt: '로어북 활성화 키, 2차 키(selective), insertorder, @@depth 같은 데코레이터 사용법을 알려 줘.' },
        ];
      }
      if (kind === 'persona' || screen === 'persona') {
        return [
          { label: '현재 페르소나 다듬기', prompt: '현재 페르소나의 프롬프트가 캐릭터와 자연스럽게 상호작용하도록 다듬는 수정안을 제안해 줘.' },
          { label: '새 페르소나 생성', prompt: '현재 캐릭터의 세계관에 잘 어울리는 새 페르소나를 만들어 줘.' },
          { label: '페르소나/바인딩 안내', prompt: '페르소나 작성 팁과 채팅별 페르소나 바인딩(bindedPersona) 활용법을 알려 줘.' },
        ];
      }
      if (kind === 'config' || screen === 'settings') {
        return [
          { label: '내 설정 진단', prompt: '현재 읽어온 내 RisuAI 설정값(temperature, maxContext, maxResponse, 페널티, 모듈 등)을 보고 개선할 점이 있는지 진단해 줘.' },
          { label: '설정 의미 설명', prompt: 'temperature, maxContext, maxResponse, frequencyPenalty, PresensePenalty가 실제 출력에 어떤 영향을 주는지 쉽게 설명해 줘.' },
          { label: 'Custom CSS 수정', prompt: '현재 Custom CSS를 확인하고 가독성을 높이는 수정안을 제안해 줘.' },
        ];
      }
      if (kind === 'char_field' || screen === 'character') {
        return [
          { label: '현재 필드 다듬기', prompt: '현재 선택된 캐릭터 필드의 문장과 구조를 더 선명하고 토큰 효율적으로 다듬는 부분 수정안을 제안해 줘.' },
          { label: '전체 재작성', prompt: '현재 캐릭터 설정을 바탕으로 이 필드를 더 몰입감 있게 새로 작성한 덮어쓰기 안을 제안해 줘.' },
          { label: 'CBS/필드 가이드', prompt: '이 필드가 프롬프트에서 어떤 역할을 하고, {{char}}/{{user}} 같은 CBS를 어떻게 쓰면 좋은지 알려 줘.' },
        ];
      }

      return [
        { label: '현재 화면 사용법', prompt: '지금 내가 보고 있는 RisuAI 화면과 주요 기능 사용법을 알기 쉽게 설명해 줘.' },
        { label: '내 설정 진단', prompt: '현재 RisuAI 설정과 활성화된 캐릭터/로어북 구성을 간단히 점검해 줘.' },
        { label: '새 로어북 만들기', prompt: '현재 캐릭터에 추가할 새 로어북 항목을 함께 만들어 줘.' },
      ];
    }

      __exports.buildKnowledgeForContext = buildKnowledgeForContext;
      __exports.getQuickPromptsForContext = getQuickPromptsForContext;

  },
  "src/llm.js"(__require, __exports) {
    const { buildKnowledgeForContext } = __require("src/knowledge.js");
    const { ALLOWED_CONFIG_KEYS, MAX_LLM_CONTENT_CHARS, ALLOWED_CHAR_FIELDS, ALLOWED_LORE_TEXT_FIELDS, ALLOWED_PERSONA_TEXT_FIELDS } = __require("src/version.js");

    const MAX_RESPONSE_BYTES = 1024 * 1024; // 1 MiB safety limit
    const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const RAW_SECTION_RE = /^<<<(CONTENT|CODE|BEFORE|AFTER|IN|OUT|END)>>>[ \t]*$/;

    function byteLength(str) {
      return new TextEncoder().encode(String(str)).length;
    }

    /**
     * Normalizes all RisuAI / fork runLLMModel return formats:
     * - plain string
     * - { type: 'fail', result }
     * - { type: 'success', result: string }
     * - ReadableStream (string chunks, Uint8Array chunks, or RisuAI cumulative { '0': string } chunks)
     */
    async function readModelResponse(result, job = {}) {
      if (result === null || result === undefined) {
        throw new Error('모델 응답이 비어 있습니다.');
      }
      if (typeof result === 'string') {
        if (byteLength(result) > MAX_RESPONSE_BYTES) throw new Error('응답 크기가 1MiB를 초과했습니다.');
        return result;
      }
      if (result.type === 'fail') {
        throw new Error(String(result.result ?? result.error ?? '모델 요청이 실패했습니다.'));
      }
      if (typeof result.result === 'string') {
        return readModelResponse(result.result, job);
      }
      const stream = result.result?.getReader ? result.result : (result.getReader ? result : null);
      if (!stream) {
        throw new Error('지원하지 않는 모델 응답 형식입니다.');
      }

      const reader = stream.getReader();
      job.reader = reader;
      const decoder = new TextDecoder();
      let current = '';
      let cumulative = false;
      let size = 0;

      try {
        while (true) {
          if (job.cancelled) throw new Error('요청을 중단했습니다.');
          const { value, done } = await reader.read();
          if (done) break;
          if (typeof value === 'string') {
            current += value;
            size += byteLength(value);
          } else if (value instanceof Uint8Array) {
            const chunk = decoder.decode(value, { stream: true });
            current += chunk;
            size += byteLength(chunk);
          } else if (value && typeof value === 'object' && typeof value['0'] === 'string') {
            current = value['0'];
            cumulative = true;
            size = current.length > MAX_RESPONSE_BYTES / 4 ? byteLength(current) : current.length;
          } else {
            throw new Error('지원하지 않는 스트림 청크 형식입니다.');
          }
          if (size > MAX_RESPONSE_BYTES) throw new Error('스트림 응답 크기가 1MiB를 초과했습니다.');
          if (typeof job.onChunk === 'function') job.onChunk(current);
        }
        if (!cumulative) {
          const tail = decoder.decode();
          if (tail) {
            current += tail;
            size += byteLength(tail);
          }
        }
        if (size > MAX_RESPONSE_BYTES) throw new Error('응답 크기가 1MiB를 초과했습니다.');
        return current;
      } finally {
        if (job.cancelled) {
          try { await reader.cancel(); } catch {}
        }
        try { reader.releaseLock(); } catch {}
        job.reader = null;
      }
    }

    /**
     * Invokes Risuai.runLLMModel with timeout and cancellation support.
     */
    async function callRisuModel(api, messages, options = {}, job = {}) {
      const mode = options.mode || 'model';
      const timeoutSec = Math.max(10, Math.min(600, Number(options.timeoutSeconds) || 120));
      if (typeof api?.runLLMModel !== 'function') {
        throw new Error('현재 RisuAI 버전은 Plugin v3 runLLMModel API를 지원하지 않습니다.');
      }

      let timer;
      const abortPromise = new Promise((_, reject) => {
        job.stop = (reason = '요청을 중단했습니다.') => {
          job.cancelled = true;
          try { job.reader?.cancel(); } catch {}
          reject(new Error(reason));
        };
        timer = setTimeout(() => job.stop('모델 응답 대기 시간이 초과되었습니다.'), timeoutSec * 1000);
      });

      const workPromise = Promise.resolve()
        .then(() => api.runLLMModel({ mode, messages, allowPlugins: true }))
        .then(res => readModelResponse(res, job));
      workPromise.catch(() => {});

      try {
        return await Promise.race([workPromise, abortPromise]);
      } finally {
        clearTimeout(timer);
        job.stop = null;
      }
    }

    const VALID_ACTIONS = new Set([
      'patch_text',
      'replace_text',
      'create_lorebook',
      'update_lorebook',
      'update_lua',
      'upsert_regex',
      'create_persona',
      'update_persona',
      'update_config',
    ]);

    /**
     * Extracts fenced `risuhelper-proposal` blocks using a line-based scanner so:
     * - Dynamic fence lengths (``` or ````) work natively.
     * - Triple backticks inside JSON string values never prematurely close a multiline fence.
     * - Raw body sections terminated by `<<<END>>>` can safely contain markdown ``` code blocks.
     * - Inline single-line blocks (```risuhelper-proposal {...}```) remain supported.
     */
    function extractProposalBlocks(rawText) {
      const normalized = String(rawText ?? '').replace(/\r\n/g, '\n');
      const lines = normalized.split('\n');
      const proseLines = [];
      const blocks = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const openMatch = line.match(/^[ \t]*(`{3,})risuhelper-proposal(?:[ \t]+(.*))?$/);
        if (!openMatch) {
          proseLines.push(line);
          continue;
        }

        const fence = openMatch[1];
        const rest = openMatch[2] ?? '';

        // Single-line inline form: ```risuhelper-proposal {...}```
        if (rest.trim()) {
          const endIdx = rest.lastIndexOf(fence);
          if (endIdx !== -1 && rest.slice(endIdx + fence.length).trim() === '') {
            blocks.push(rest.slice(0, endIdx));
            continue;
          }
        }

        // Look ahead to check if an explicit <<<END>>> marker appears before the next proposal opening
        let explicitEndLine = -1;
        for (let k = i + 1; k < lines.length; k++) {
          if (/^[ \t]*`{3,}risuhelper-proposal(?:\s|$)/.test(lines[k])) break;
          if (/^<<<END>>>[ \t]*$/.test(lines[k])) {
            explicitEndLine = k;
            break;
          }
        }

        const closeRe = new RegExp(`^[ \\t]*${fence}[ \\t]*$`);
        let closeIdx = -1;
        const bodyLines = [];
        if (rest.trim()) bodyLines.push(rest);

        for (let j = i + 1; j < lines.length; j++) {
          const candidate = lines[j];
          const canClose = explicitEndLine === -1 || j > explicitEndLine;
          if (canClose && closeRe.test(candidate)) {
            closeIdx = j;
            break;
          }
          bodyLines.push(candidate);
        }

        if (closeIdx === -1) {
          // Unclosed fence: keep as prose rather than silently dropping text
          proseLines.push(line);
          continue;
        }

        blocks.push(bodyLines.join('\n'));
        i = closeIdx;
      }

      return { prose: proseLines.join('\n').trim(), blocks };
    }

    /**
     * Parses either a standard JSON proposal payload or a hybrid Header JSON + raw delimiter payload:
     *   {"action":"update_lua","title":"...","scope":"character"}
     *   <<<CODE>>>
     *   ...raw Lua without JSON escaping...
     *   <<<END>>>
     */
    function parseProposalPayload(rawBody) {
      const normalized = String(rawBody ?? '').replace(/\r\n/g, '\n');
      const lines = normalized.split('\n');
      const firstMarkerIdx = lines.findIndex(line => RAW_SECTION_RE.test(line));

      if (firstMarkerIdx === -1) {
        const trimmed = normalized.trim();
        if (!trimmed) return [];
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      }

      const headerText = lines.slice(0, firstMarkerIdx).join('\n').trim();
      if (!headerText) {
        throw new Error('원문 구분자 블록 앞에 JSON 헤더 객체가 필요합니다.');
      }
      const header = JSON.parse(headerText);
      if (!header || typeof header !== 'object' || Array.isArray(header)) {
        throw new Error('원문 구분자 블록의 헤더는 JSON 객체여야 합니다.');
      }

      const sections = [];
      let currentTag = null;
      let currentLines = [];

      for (let i = firstMarkerIdx; i < lines.length; i++) {
        const marker = lines[i].match(RAW_SECTION_RE);
        if (marker) {
          if (currentTag !== null) {
            sections.push({ tag: currentTag, value: currentLines.join('\n') });
          }
          const nextTag = marker[1];
          if (nextTag === 'END') {
            currentTag = null;
            currentLines = [];
            break;
          }
          currentTag = nextTag;
          currentLines = [];
        } else if (currentTag !== null) {
          currentLines.push(lines[i]);
        }
      }
      if (currentTag !== null) {
        sections.push({ tag: currentTag, value: currentLines.join('\n') });
      }

      let pendingBefore = null;
      for (const sec of sections) {
        if (sec.tag === 'BEFORE') {
          if (pendingBefore !== null) {
            throw new Error('<<<BEFORE>>> 뒤에 대응되는 <<<AFTER>>> 블록이 없습니다.');
          }
          pendingBefore = sec.value;
        } else if (sec.tag === 'AFTER') {
          if (pendingBefore === null) {
            throw new Error('<<<AFTER>>> 앞에 대응되는 <<<BEFORE>>> 블록이 없습니다.');
          }
          if (!Array.isArray(header.edits)) header.edits = [];
          header.edits.push({ before: pendingBefore, after: sec.value });
          pendingBefore = null;
        } else if (sec.tag === 'CONTENT') {
          if (header.action === 'create_persona' || header.action === 'update_persona') {
            header.personaPrompt = sec.value;
          } else {
            header.content = sec.value;
          }
        } else if (sec.tag === 'CODE') {
          header.code = sec.value;
        } else if (sec.tag === 'IN') {
          header.in = sec.value;
        } else if (sec.tag === 'OUT') {
          header.out = sec.value;
        }
      }
      if (pendingBefore !== null) {
        throw new Error('<<<BEFORE>>> 뒤에 대응되는 <<<AFTER>>> 블록이 없습니다.');
      }

      return [header];
    }

    /**
     * Extracts natural prose and structured `risuhelper-proposal` blocks from an LLM reply.
     */
    function parseAssistantReply(rawText) {
      const text = String(rawText ?? '');
      const proposals = [];
      const errors = [];
      const { prose, blocks } = extractProposalBlocks(text);

      for (const rawBlock of blocks) {
        const trimmed = rawBlock.trim();
        if (!trimmed) continue;
        try {
          const items = parseProposalPayload(rawBlock);
          for (const item of items) {
            const validationError = validateProposal(item);
            if (validationError) {
              errors.push({ raw: trimmed, error: validationError });
            } else {
              proposals.push(item);
            }
          }
        } catch (err) {
          errors.push({ raw: trimmed, error: `제안 블록 파싱 오류: ${err.message}` });
        }
      }

      return { prose, proposals, errors, rawText: text };
    }

    function validateFieldKeyForKind(kind, fieldKey) {
      if (fieldKey === undefined || fieldKey === null || fieldKey === '') return null;
      if (typeof fieldKey !== 'string' || BAD_KEYS.has(fieldKey)) {
        return `허용되지 않는 필드 키입니다: ${String(fieldKey)}`;
      }
      if (kind === 'char_field' && !ALLOWED_CHAR_FIELDS.includes(fieldKey)) {
        return `허용되지 않는 캐릭터 필드입니다: ${fieldKey}`;
      }
      if ((kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook') && !ALLOWED_LORE_TEXT_FIELDS.includes(fieldKey)) {
        return `허용되지 않는 로어북 필드입니다: ${fieldKey}`;
      }
      if (kind === 'persona' && !ALLOWED_PERSONA_TEXT_FIELDS.includes(fieldKey)) {
        return `허용되지 않는 페르소나 필드입니다: ${fieldKey}`;
      }
      if (kind === 'chat_note' && fieldKey !== 'note') {
        return `허용되지 않는 작가의 노트 필드입니다: ${fieldKey}`;
      }
      if (kind === 'config' && !ALLOWED_CONFIG_KEYS.includes(fieldKey)) {
        return `허용되지 않는 설정 키입니다: ${fieldKey}`;
      }
      return null;
    }

    function validateProposal(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return '제안은 JSON 객체여야 합니다.';
      }
      for (const key of Object.keys(item)) {
        if (BAD_KEYS.has(key)) return `허용되지 않는 속성 키입니다: ${key}`;
      }
      if (!VALID_ACTIONS.has(item.action)) {
        return `알 수 없는 action입니다: ${String(item.action)}`;
      }
      if (item.target !== undefined) {
        if (!item.target || typeof item.target !== 'object' || Array.isArray(item.target)) {
          return 'target은 JSON 객체여야 합니다.';
        }
        for (const key of Object.keys(item.target)) {
          if (BAD_KEYS.has(key)) return `허용되지 않는 target 키입니다: ${key}`;
        }
        const targetFieldErr = validateFieldKeyForKind(item.target.targetKind, item.target.fieldKey);
        if (targetFieldErr) return targetFieldErr;
      }
      if (item.action === 'patch_text') {
        if (!Array.isArray(item.edits) || item.edits.length === 0) {
          return 'patch_text에는 1개 이상의 edits 배열({ before, after })이 필요합니다.';
        }
        for (const e of item.edits) {
          if (!e || typeof e.before !== 'string' || !e.before || typeof e.after !== 'string') {
            return 'edits 항목은 비어 있지 않은 문자열 before와 문자열 after가 필요합니다.';
          }
        }
      }
      if (item.action === 'replace_text' && typeof item.content !== 'string') {
        return 'replace_text에는 문자열 content가 필요합니다.';
      }
      if (item.action === 'create_lorebook') {
        if (typeof item.comment !== 'string' || typeof item.content !== 'string') {
          return 'create_lorebook에는 comment와 content 문자열이 필요합니다.';
        }
      }
      if (item.action === 'update_lorebook' && item.fieldKey !== undefined) {
        const err = validateFieldKeyForKind('char_lorebook', item.fieldKey);
        if (err) return err;
      }
      if (item.action === 'update_lua') {
        if (!item.edits && typeof item.code !== 'string' && typeof item.content !== 'string') {
          return 'update_lua에는 edits 배열 또는 code 문자열이 필요합니다.';
        }
      }
      if (item.action === 'upsert_regex') {
        if (typeof item.in !== 'string' || typeof item.out !== 'string') {
          return 'upsert_regex에는 in과 out 문자열이 필요합니다.';
        }
      }
      if (item.action === 'create_persona') {
        if (typeof item.name !== 'string' || typeof (item.personaPrompt ?? item.content) !== 'string') {
          return 'create_persona에는 name과 personaPrompt 문자열이 필요합니다.';
        }
      }
      if (item.action === 'update_persona' && item.fieldKey !== undefined) {
        const err = validateFieldKeyForKind('persona', item.fieldKey);
        if (err) return err;
      }
      if (item.action === 'update_config') {
        if (!item.changes || typeof item.changes !== 'object' || Array.isArray(item.changes)) {
          return 'update_config에는 changes 객체가 필요합니다.';
        }
        const invalid = Object.keys(item.changes).filter(k => !ALLOWED_CONFIG_KEYS.includes(k));
        if (invalid.length > 0) {
          return `허용되지 않는 설정 키입니다: ${invalid.join(', ')}`;
        }
      }
      return null;
    }

    /**
     * Builds the system prompt + message list sent to Risuai.runLLMModel().
     */
    function buildConversationMessages({ context, snapshot, extraContext, history, userInput, maxHistoryTurns = 12 }) {
      const knowledge = buildKnowledgeForContext(context);
      const targetLabel = snapshot?.label || context?.labelText || '일반 화면';
      const currentText = snapshot?.content ?? '';
      const isTruncated = currentText.length > MAX_LLM_CONTENT_CHARS;
      const clippedContent = isTruncated
        ? currentText.slice(0, MAX_LLM_CONTENT_CHARS) + `\n... (총 ${currentText.length}자 중 앞 ${MAX_LLM_CONTENT_CHARS.toLocaleString()}자만 표시)`
        : currentText;

      const extraBlocks = [];
      if (extraContext?.charSummary) {
        extraBlocks.push(`[현재 캐릭터 요약]\n${JSON.stringify(extraContext.charSummary, null, 2)}`);
      }
      if (extraContext?.loreSummary) {
        extraBlocks.push(`[로어북 목록 요약]\n${JSON.stringify(extraContext.loreSummary, null, 2)}`);
      }
      if (extraContext?.personasSummary) {
        extraBlocks.push(`[페르소나 목록 요약]\n${JSON.stringify(extraContext.personasSummary, null, 2)}`);
      }
      if (extraContext?.configSummary) {
        extraBlocks.push(`[현재 허용 RisuAI 설정값]\n${JSON.stringify(extraContext.configSummary, null, 2)}`);
      }

      const truncationRule = isTruncated
        ? `\n⚠️ [원문 잘림 경고] 현재 원문(${currentText.length.toLocaleString()}자)은 앞 ${MAX_LLM_CONTENT_CHARS.toLocaleString()}자만 제공되었습니다. 뒷부분 유실을 막기 위해 replace_text 및 전체 code 덮어쓰기는 차단됩니다. 반드시 patch_text 또는 edits로 보이는 구간만 부분 편집하세요.`
        : '';

      const screenNote = context?.screen === 'chat'
        ? '\n- 안내: 사용자는 현재 채팅 화면(대화 입력창)에 있습니다. 특정 편집 필드를 열지 않았더라도 아래 [현재 캐릭터 요약]/[로어북 목록 요약] 등을 바탕으로 질문에 답하거나, 새 로어북·페르소나·정규식·Lua 생성 및 설정 변경을 바로 제안할 수 있습니다.'
        : '';

      const systemPrompt = `당신은 RisuAI(및 PocketRisu, RisuBard, 해적리스, RisuNest 등 포크) 안에 내장된 소통형 어시스턴트 "RisuHelper"입니다.
    사용자의 질문(설정 의미, 사용법, 디버깅, 프롬프트/로어북/Lua/정규식/페르소나 작성)에 친절하고 정확하게 한국어로 답합니다.

    ${knowledge}

    [현재 감지된 화면 및 대상]
    - 화면: ${context?.screen || 'unknown'}
    - 대상 종류(targetKind): ${snapshot?.target?.targetKind || context?.targetKind || 'general'}
    - 필드(fieldKey): ${snapshot?.target?.fieldKey || context?.fieldKey || '없음'}
    - 대상 설명: ${targetLabel}${screenNote}
    ${snapshot?.target?.loreIndex !== null && snapshot?.target?.loreIndex !== undefined ? `- 로어북 인덱스(0-based): ${snapshot.target.loreIndex}` : ''}
    ${snapshot?.target?.regexIndex !== null && snapshot?.target?.regexIndex !== undefined ? `- 정규식 인덱스(0-based): ${snapshot.target.regexIndex}` : ''}
    ${snapshot?.target?.personaIndex !== null && snapshot?.target?.personaIndex !== undefined ? `- 페르소나 인덱스(0-based): ${snapshot.target.personaIndex}` : ''}
    ${snapshot?.target?.moduleIndex !== null && snapshot?.target?.moduleIndex !== undefined ? `- 모듈 인덱스(0-based): ${snapshot.target.moduleIndex}` : ''}

    [현재 대상의 실제 원문]
    \`\`\`
    ${clippedContent || '(비어 있음)'}
    \`\`\`${truncationRule}

    ${extraBlocks.join('\n\n')}

    [수정·생성 제안 프로토콜]
    1. 단순 질문·상담·설명 요청일 때는 자연어 답변만 작성하고 제안 블록을 출력하지 마세요.
    2. 사용자가 편집·수정·덮어쓰기·새로 생성·설정 변경을 요청할 때는 설명과 함께 \`\`\`risuhelper-proposal 블록을 포함하세요. 사용자가 UI에서 Diff를 검토하고 "적용" 버튼을 눌러야 실제 반영됩니다.
    3. 기존 긴 원문의 일부만 바꿀 때는 반드시 \`patch_text\`를 사용하고, \`before\`에는 위 [현재 대상의 실제 원문]에서 **공백과 줄바꿈까지 정확히 일치하는 고유 구간**을 복사하세요.
    4. 주의: \`patch_text\`/\`replace_text\`에서 \`target\`을 임의로 바꿔 다른 필드를 지정하지 마세요.

    지원 action 스키마 (표준 JSON):
    - 부분 편집: {"action":"patch_text","title":"설명","edits":[{"before":"원문 구간","after":"수정 구간"}]}
    - 전체 덮어쓰기: {"action":"replace_text","title":"설명","content":"새 전체 텍스트"}
    - 새 로어북 생성: {"action":"create_lorebook","title":"설명","scope":"character|chat|module","comment":"항목명","key":"키1,키2","secondkey":"","selective":false,"alwaysActive":false,"insertorder":100,"content":"본문"}
    - 기존 로어북 수정: {"action":"update_lorebook","title":"설명","scope":"character|chat|module","loreIndex":0,"comment":"항목명","key":"키1,키2","edits":[{"before":"...","after":"..."}]}
    - Lua 트리거 수정/생성: {"action":"update_lua","title":"설명","scope":"character|module","edits":[{"before":"...","after":"..."}]} (신규이거나 전체 교체면 "code":"..." 사용)
    - 정규식 생성/수정: {"action":"upsert_regex","title":"설명","scope":"character|module","comment":"이름","in":"패턴","out":"치환","type":"editdisplay|editoutput|editinput|editprocess","flag":"g","ableFlag":true}
    - 새 페르소나 생성: {"action":"create_persona","title":"설명","name":"이름","note":"메모","personaPrompt":"설명","bindToCurrentChat":true}
    - 기존 페르소나 수정: {"action":"update_persona","title":"설명","personaIndex":0,"name":"이름","note":"메모","personaPrompt":"설명","bindToCurrentChat":false}
    - 허용 설정 변경: {"action":"update_config","title":"설명","changes":{"temperature":80,"maxResponse":2000}}

    [권장: 긴 코드·Lua·정규식·HTML용 원문 구분자 형식 (JSON 이스케이프 불필요)]
    따옴표·백슬래시·줄바꿈이 많은 Lua/정규식/HTML/긴 본문은 JSON 헤더 아래에 구분자 섹션을 쓰면 이스케이프 오류를 피할 수 있습니다:
    - 부분 편집: JSON 헤더 아래 \`<<<BEFORE>>>\` ... \`<<<AFTER>>>\` (반복 가능) ... \`<<<END>>>\`
    - 전체 본문/코드: JSON 헤더 아래 \`<<<CONTENT>>>\` 또는 \`<<<CODE>>>\` ... \`<<<END>>>\`
    - 정규식: JSON 헤더 아래 \`<<<IN>>>\` ... \`<<<OUT>>>\` ... \`<<<END>>>\`
    (본문 안에 \`\`\` 마크다운이 포함되면 반드시 \`<<<END>>>\`를 닫거나 4개 백틱 \`\`\`\`risuhelper-proposal을 사용하세요.)

    JSON 헤더 안에는 주석이나 trailing comma를 넣지 말고 유효한 JSON만 출력하세요.`;

      const recentHistory = (history || []).slice(-(maxHistoryTurns * 2)).map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.rawText || msg.content,
      }));

      return [
        { role: 'system', content: systemPrompt },
        ...recentHistory,
        { role: 'user', content: String(userInput ?? '') },
      ];
    }

      __exports.readModelResponse = readModelResponse;
      __exports.callRisuModel = callRisuModel;
      __exports.extractProposalBlocks = extractProposalBlocks;
      __exports.parseProposalPayload = parseProposalPayload;
      __exports.parseAssistantReply = parseAssistantReply;
      __exports.validateProposal = validateProposal;
      __exports.buildConversationMessages = buildConversationMessages;

  },
  "src/rpack-map.js"(__require, __exports) {
    // SPDX-License-Identifier: GPL-3.0-only
    // RisuAI RPack 256-byte encode/decode lookup table (first 256 = encode, next 256 = decode).
    const rpackMap = Uint8Array.from(
      atob('xA0eC70rP1X8RW71ZlNPGuC7MJSGumu/QVBvm+/etxBhFyDfMomonW2ryZAADF2v0sFW5RZkkYJldJfKI9ZS0f+0oOgvilg4WmAZlknb18g7PkNLpWNHqmopkvQVz2I0eNMdPOIFjipXDhvNTC3yQCwleUgPsnq1p2w35px7VH7+h9yaAuQzouuxLgPdmaaw59WIGIN89r7hXJ/DIUYfCE7QdhJf7v2PROqjXosoCTWeacwKx4UHrUrzd+ln1NqEgJO2TXP6JyZ/BMb78XI5UcI2qWis+O3FucvOdaQ9gdlCcByVEbzYjJj5WaET9xR9s+xxwOON8AGuWzEGJCI6uCz3hIvJZfu2n66zAy0BaXQf5KPs7lw0IZNKD2riYgKeIpz9PPxxx8atWWcFcG2KRBL6JIZfr9F6R87+UGPdUQZvGOBSqAmdVnNMuFNsw6AOGc8+DX4HMmhG6kj5mS6rpEkgXlU1OAy807FYFnkoChrh8s3EOduiumBydn2V73/IwN43lL+1FIGSJUWs5/Vmpys2WsET40s66I2DG3wnsJpC64eq3FSOeCbSVynUt/gvj4l18EF3wh7/2BUR5QSXF/Mx0JsA18q0Tyo72bJr2l2hPzBhvZE9Tubfvk2CjB0jEJhk9IUze5BDu6mI8dalHPbMbrlbC5bt1enFywimgEA='),
      c => c.charCodeAt(0)
    );

      __exports.rpackMap = rpackMap;

  },
  "src/preset-format.js"(__require, __exports) {
    // SPDX-License-Identifier: GPL-3.0-only
    // Zero-dependency RisuAI/RisuBard preset wire format decoder (.risup, .risupreset, .json, .preset).
    // Uses native WebCrypto AES-256-GCM, DecompressionStream, RPack lookup map, and pure-JS MessagePack.

    const { rpackMap } = __require("src/rpack-map.js");

    const PRESET_LIMIT = 32 * 1024 * 1024; // 32 MiB
    const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

    function assert(ok, message) {
      if (!ok) throw new Error(message);
    }

    function byteLength(str) {
      return new TextEncoder().encode(String(str)).length;
    }

    function clone(value) {
      if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch {}
      }
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    /**
     * Pure-JS MessagePack decoder supporting all standard types with depth/node bounds.
     */
    function decodeMsgpack(input) {
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const decoder = new TextDecoder('utf-8');
      let offset = 0;
      let nodes = 0;

      function readBytes(len) {
        assert(offset + len <= bytes.length, 'MessagePack 데이터가 잘렸습니다.');
        const slice = bytes.subarray(offset, offset + len);
        offset += len;
        return slice;
      }

      function readStr(len) {
        return decoder.decode(readBytes(len));
      }

      function readValue(depth = 0) {
        assert(depth < 80 && ++nodes < 400000, 'MessagePack 구조가 너무 깊거나 큽니다.');
        assert(offset < bytes.length, 'MessagePack 예기치 않은 종료입니다.');
        const b = bytes[offset++];

        if (b <= 0x7f) return b; // positive fixint
        if (b >= 0xe0) return b - 256; // negative fixint

        if ((b & 0xf0) === 0x80) return readMap(b & 0x0f, depth);
        if ((b & 0xf0) === 0x90) return readArray(b & 0x0f, depth);
        if ((b & 0xe0) === 0xa0) return readStr(b & 0x1f);

        switch (b) {
          case 0xc0: return null;
          case 0xc2: return false;
          case 0xc3: return true;
          case 0xc4: return new Uint8Array(readBytes(readU8()));
          case 0xc5: return new Uint8Array(readBytes(readU16()));
          case 0xc6: return new Uint8Array(readBytes(readU32()));
          case 0xc7: { const len = readU8(); offset += 1; return new Uint8Array(readBytes(len)); }
          case 0xc8: { const len = readU16(); offset += 1; return new Uint8Array(readBytes(len)); }
          case 0xc9: { const len = readU32(); offset += 1; return new Uint8Array(readBytes(len)); }
          case 0xca: { const v = view.getFloat32(offset); offset += 4; return v; }
          case 0xcb: { const v = view.getFloat64(offset); offset += 8; return v; }
          case 0xcc: return readU8();
          case 0xcd: return readU16();
          case 0xce: return readU32();
          case 0xcf: { const v = Number(view.getBigUint64(offset)); offset += 8; return v; }
          case 0xd0: { const v = view.getInt8(offset); offset += 1; return v; }
          case 0xd1: { const v = view.getInt16(offset); offset += 2; return v; }
          case 0xd2: { const v = view.getInt32(offset); offset += 4; return v; }
          case 0xd3: { const v = Number(view.getBigInt64(offset)); offset += 8; return v; }
          case 0xd4: { offset += 1; return new Uint8Array(readBytes(1)); }
          case 0xd5: { offset += 1; return new Uint8Array(readBytes(2)); }
          case 0xd6: { offset += 1; return new Uint8Array(readBytes(4)); }
          case 0xd7: { offset += 1; return new Uint8Array(readBytes(8)); }
          case 0xd8: { offset += 1; return new Uint8Array(readBytes(16)); }
          case 0xd9: return readStr(readU8());
          case 0xda: return readStr(readU16());
          case 0xdb: return readStr(readU32());
          case 0xdc: return readArray(readU16(), depth);
          case 0xdd: return readArray(readU32(), depth);
          case 0xde: return readMap(readU16(), depth);
          case 0xdf: return readMap(readU32(), depth);
          default:
            throw new Error(`알 수 없는 MessagePack 태그: 0x${b.toString(16)}`);
        }
      }

      function readU8() {
        assert(offset + 1 <= bytes.length, 'MessagePack U8 범위 초과');
        return bytes[offset++];
      }
      function readU16() {
        assert(offset + 2 <= bytes.length, 'MessagePack U16 범위 초과');
        const v = view.getUint16(offset);
        offset += 2;
        return v;
      }
      function readU32() {
        assert(offset + 4 <= bytes.length, 'MessagePack U32 범위 초과');
        const v = view.getUint32(offset);
        offset += 4;
        return v;
      }
      function readArray(len, depth) {
        const arr = new Array(len);
        for (let i = 0; i < len; i++) arr[i] = readValue(depth + 1);
        return arr;
      }
      function readMap(len, depth) {
        const obj = {};
        for (let i = 0; i < len; i++) {
          const k = String(readValue(depth + 1));
          const v = readValue(depth + 1);
          if (!BAD_KEYS.has(k)) obj[k] = v;
        }
        return obj;
      }

      return readValue(0);
    }

    /**
     * Decompresses gzip / zlib-deflate / raw-deflate bytes using native DecompressionStream
     * with a strict 32MiB output limit.
     */
    async function expandCompressed(data) {
      assert(typeof DecompressionStream === 'function', '이 환경은 DecompressionStream을 지원하지 않습니다.');

      const formats = [];
      if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
        formats.push('gzip', 'deflate', 'deflate-raw');
      } else if (data.length >= 2 && (data[0] & 0x0f) === 0x08 && (((data[0] << 8) | data[1]) % 31 === 0)) {
        formats.push('deflate', 'deflate-raw', 'gzip');
      } else {
        formats.push('deflate-raw', 'deflate', 'gzip');
      }

      let lastError;
      for (const fmt of formats) {
        try {
          const ds = new DecompressionStream(fmt);
          const writer = ds.writable.getWriter();
          const writePromise = writer.write(data).then(() => writer.close());
          writePromise.catch(() => {});
          const reader = ds.readable.getReader();
          const chunks = [];
          let total = 0;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            total += value.byteLength;
            assert(total <= PRESET_LIMIT, '프리셋 압축 해제 크기가 32MiB를 초과했습니다.');
            chunks.push(value);
          }
          await writePromise;
          const out = new Uint8Array(total);
          let pos = 0;
          for (const c of chunks) {
            out.set(c, pos);
            pos += c.byteLength;
          }
          return out;
        } catch (err) {
          if (String(err?.message || '').includes('32MiB')) throw err;
          lastError = err;
        }
      }
      throw new Error('프리셋 압축 해제에 실패했습니다: ' + (lastError?.message || 'unknown'));
    }

    async function decryptRisupresetPayload(encrypted) {
      const subtle = globalThis.crypto?.subtle;
      assert(subtle, 'WebCrypto(crypto.subtle)를 사용할 수 없습니다.');
      const keyBytes = await subtle.digest('SHA-256', new TextEncoder().encode('risupreset'));
      const cryptoKey = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
      const plainBuf = await subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(12) },
        cryptoKey,
        encrypted
      );
      return new Uint8Array(plainBuf);
    }

    function checkTree(value, depth = 0, count = { n: 0 }) {
      assert(depth < 70 && ++count.n < 200000, '프리셋 데이터 구조가 너무 큽니다.');
      if (!value || typeof value !== 'object') return;
      for (const [k, v] of Object.entries(value)) {
        assert(!BAD_KEYS.has(k), '허용하지 않는 프리셋 키: ' + k);
        checkTree(v, depth + 1, count);
      }
    }

    const ALLOWED_PRESET_KEYS = [
      'name', 'description', 'mainPrompt', 'jailbreak', 'jailbreakToggle', 'chainOfThought',
      'globalNote', 'promptTemplate', 'formatingOrder', 'customPromptTemplateToggle',
      'templateDefaultVariables', 'promptSettings', 'promptBlockOverlay', 'moduleIntergration', 'regex',
    ];

    function legacyBlocks(p) {
      const order = p.formatingOrder ?? ['main', 'description', 'personaPrompt', 'lorebook', 'chats', 'lastChat', 'globalNote', 'authorNote'];
      assert(Array.isArray(order), '구형 프롬프트 순서가 올바르지 않습니다.');
      return order.map(type => {
        if (['main', 'jailbreak', 'globalNote'].includes(type)) {
          return {
            type: 'plain',
            type2: type === 'jailbreak' ? 'normal' : type,
            name: type,
            role: 'system',
            text: p[type === 'main' ? 'mainPrompt' : type] ?? '',
          };
        }
        if (type === 'chats') return { type: 'chat', rangeStart: 0, rangeEnd: -1 };
        if (type === 'lastChat') return { type: 'chat', rangeStart: -1, rangeEnd: 'end' };
        if (type === 'personaPrompt') return { type: 'persona' };
        if (type === 'authorNote') return { type: 'authornote' };
        return { type };
      });
    }

    function normalizePreset(raw) {
      assert(raw && typeof raw === 'object' && !Array.isArray(raw), '프리셋 객체가 필요합니다.');
      checkTree(raw);
      assert(
        ['promptTemplate', 'mainPrompt', 'formatingOrder', 'customPromptTemplateToggle'].some(k => Object.hasOwn(raw, k)),
        '프롬프트 프리셋 필드를 찾지 못했습니다.'
      );

      const result = {};
      for (const k of ALLOWED_PRESET_KEYS) {
        if (Object.hasOwn(raw, k)) result[k] = clone(raw[k]);
      }
      for (const k of ['name', 'description', 'mainPrompt', 'jailbreak', 'globalNote', 'customPromptTemplateToggle', 'templateDefaultVariables', 'moduleIntergration']) {
        if (result[k] === undefined) result[k] = '';
        assert(typeof result[k] === 'string', '프리셋 문자열 형식 오류: ' + k);
      }
      result.name ||= '가져온 프리셋';

      for (const k of ['jailbreakToggle', 'chainOfThought']) {
        if (k in result) assert(typeof result[k] === 'boolean', '프롬프트 활성화 설정 형식 오류: ' + k);
      }
      if (result.regex !== undefined) assert(Array.isArray(result.regex), '프리셋 정규식은 배열이어야 합니다.');
      if (result.promptBlockOverlay !== undefined) {
        assert(result.promptBlockOverlay && typeof result.promptBlockOverlay === 'object' && !Array.isArray(result.promptBlockOverlay), '오버레이 설정은 객체여야 합니다.');
      }
      if (result.promptSettings !== undefined) {
        assert(result.promptSettings && typeof result.promptSettings === 'object' && !Array.isArray(result.promptSettings), '프롬프트 옵션은 객체여야 합니다.');
      }
      if (result.promptTemplate == null) result.promptTemplate = legacyBlocks(result);
      assert(Array.isArray(result.promptTemplate) && result.promptTemplate.length <= 500, '프롬프트 블록은 500개 이하 배열이어야 합니다.');

      for (const b of result.promptTemplate) {
        assert(b && typeof b === 'object' && !Array.isArray(b) && typeof b.type === 'string', '잘못된 프롬프트 블록입니다.');
        for (const k of ['text', 'innerFormat', 'defaultText', 'name']) {
          if (k in b) assert(typeof b[k] === 'string', '블록 문자열 형식 오류: ' + k);
        }
        if ('enabled' in b) assert(typeof b.enabled === 'boolean', '블록 활성화 형식이 올바르지 않습니다.');
      }

      assert(byteLength(JSON.stringify(result)) <= PRESET_LIMIT, '프리셋이 32MiB를 초과했습니다.');
      return result;
    }

    /**
     * Decodes .risup, .risupreset, .json, or .preset bytes into a normalized RisuAI prompt preset.
     */
    async function decodePreset(data, name = 'preset.risup') {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      assert(bytes.length <= PRESET_LIMIT, '프리셋 파일은 32MiB 이하만 지원합니다.');

      let raw;
      if (/\.(risup|risupreset)$/i.test(name)) {
        const packed = /\.risup$/i.test(name) ? bytes.map(x => rpackMap[x + 256]) : bytes;
        let wrapper;
        try {
          const inflated = await expandCompressed(packed);
          wrapper = decodeMsgpack(inflated);
        } catch (err) {
          throw new Error('프리셋 압축·MessagePack을 읽지 못했습니다: ' + err.message);
        }
        assert(wrapper && [0, 2].includes(wrapper.presetVersion) && wrapper.type === 'preset', '지원하지 않는 프리셋 파일 버전입니다.');
        const encrypted = wrapper.preset ?? wrapper.pres;
        assert(encrypted instanceof Uint8Array && encrypted.length <= PRESET_LIMIT, '암호화된 프리셋 본문이 올바르지 않습니다.');
        try {
          const decrypted = await decryptRisupresetPayload(encrypted);
          raw = decodeMsgpack(decrypted);
        } catch {
          throw new Error('프리셋 복호화·본문 해석에 실패했습니다. 파일 손상 또는 지원하지 않는 형식입니다.');
        }
      } else {
        try {
          raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
          throw new Error('UTF-8 프리셋 JSON을 읽지 못했습니다.');
        }
      }

      const result = normalizePreset(raw);
      for (const block of result.promptTemplate) {
        delete block.workshopError;
        delete block.workshopDraft;
      }
      return result;
    }

      __exports.decodeMsgpack = decodeMsgpack;
      __exports.normalizePreset = normalizePreset;
      __exports.decodePreset = decodePreset;
      __exports.PRESET_LIMIT = PRESET_LIMIT;

  },
  "src/preset-v2.js"(__require, __exports) {
    // SPDX-License-Identifier: GPL-3.0-only
    // RisuAI/RisuBard toggle syntax & V2 block activation condition parser/compiler.

    function parseToggleSyntax(template) {
      const parsed = [];
      for (const line of String(template ?? '').split('\n')) {
        const [key, value, type, option] = line.replace(/\r$/, '').split('=');
        if (['group', 'groupEnd', 'divider'].includes(type)) {
          parsed.push({ key, value, type });
        } else if (type === 'caption' && value) {
          parsed.push({ key, value, type });
        } else if (key && value) {
          parsed.push({
            key,
            value,
            type: ['select', 'text', 'textarea'].includes(type) ? type : 'switch',
            options: option?.split(',') ?? [],
          });
        }
      }
      return parsed;
    }

    function parseToggleTree(template) {
      const items = [];
      const definitions = [];
      const stack = [];
      const target = () => (stack.length ? stack[stack.length - 1].children : items);

      for (const toggle of parseToggleSyntax(template)) {
        if (toggle.type === 'group') {
          const g = { type: 'group', label: toggle.value ?? '', children: [] };
          target().push(g);
          stack.push(g);
        } else if (toggle.type === 'groupEnd') {
          stack.pop();
        } else if (['caption', 'divider'].includes(toggle.type)) {
          target().push({ type: toggle.type, label: toggle.value ?? '' });
        } else {
          const definition = {
            ...toggle,
            key: 'toggle_' + toggle.key,
            rawKey: toggle.key,
            label: toggle.value,
            group: stack.length ? stack[stack.length - 1].label : undefined,
          };
          definitions.push(definition);
          target().push({ type: 'toggle', definition });
        }
      }
      return { items, definitions };
    }

    const toggleDefault = (definition) => (
      ['text', 'textarea'].includes(definition.type) ? '' : '0'
    );

    const OPS = {
      is: 'equal',
      isnot: 'notequal',
      greater: 'greater',
      greaterequal: 'greater_equal',
      less: 'less',
      lessequal: 'less_equal',
    };

    const safeArg = (value) => (
      typeof value === 'string' && value.length > 0 && !/[{}\r\n]/.test(value) && !value.includes('::')
    );

    function compileV2(body, activation) {
      if (!activation?.conditions?.length) return body;
      if (!['and', 'or'].includes(activation.join)) {
        throw new Error('조건 결합은 and/or여야 합니다.');
      }
      const expression = activation.conditions
        .map(c => {
          if (!safeArg(c.key) || !safeArg(c.value) || !OPS[c.operator]) {
            throw new Error('조건 키·값에는 중괄호·줄바꿈·::를 사용할 수 없습니다.');
          }
          return `{{${OPS[c.operator]}::{{getglobalvar::${c.key}}}::${c.value}}}`;
        })
        .join(`::${activation.join}::`);
      return `{{#when::keep::${expression}}}\n${body}\n{{/when}}`;
    }

    function parseV2(source) {
      const text = String(source ?? '');
      const wrapper = text.match(/^\{\{#when::keep::(.+)\}\}\r?\n([\s\S]*)\r?\n\{\{\/when\}\}$/);
      if (!wrapper) return { body: text, activation: null };
      const comparison = /\{\{(equal|notequal|greater|greater_equal|less|less_equal)::\{\{getglobalvar::([^{}\r\n]+)\}\}::([^{}\r\n]+)\}\}/y;
      const conditions = [];
      const joins = [];
      let cursor = 0;

      while (cursor < wrapper[1].length) {
        comparison.lastIndex = cursor;
        const m = comparison.exec(wrapper[1]);
        if (!m) return { body: text, activation: null };
        conditions.push({
          key: m[2],
          operator: Object.keys(OPS).find(k => OPS[k] === m[1]),
          value: m[3],
        });
        cursor = comparison.lastIndex;
        if (cursor === wrapper[1].length) break;
        const separator = wrapper[1].slice(cursor).match(/^::(and|or)::/);
        if (!separator) return { body: text, activation: null };
        joins.push(separator[1]);
        cursor += separator[0].length;
      }

      if (!conditions.length || joins.some(j => j !== joins[0])) {
        return { body: text, activation: null };
      }
      return { body: wrapper[2], activation: { join: joins[0] ?? 'and', conditions } };
    }

      __exports.parseToggleSyntax = parseToggleSyntax;
      __exports.parseToggleTree = parseToggleTree;
      __exports.compileV2 = compileV2;
      __exports.parseV2 = parseV2;
      __exports.toggleDefault = toggleDefault;

  },
  "src/preset-calc.js"(__require, __exports) {
    // SPDX-License-Identifier: GPL-3.0-only
    // RPN CBS math/logic evaluator for prompt presets (no eval, bounded input).

    function assert(ok, message) {
      if (!ok) throw new Error(message);
    }

    const PRECEDENCE = {
      '+': 2, '-': 2, '*': 3, '/': 3, '^': 4, '%': 3,
      '<': 1, '>': 1, '|': 1, '&': 1, '≤': 1, '≥': 1, '=': 1, '≠': 1, '!': 5,
    };
    const isOperator = ch => Object.hasOwn(PRECEDENCE, ch);
    const isNumber = token => Boolean(parseFloat(token)) || token === '0';

    function toRPN(expression) {
      const clean = expression.replace(/\s+/g, '');
      const tokens = [];
      const output = [];
      const stack = [];
      let pending = '';

      for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (ch === '-' && (i === 0 || isOperator(clean[i - 1]) || clean[i - 1] === '(')) {
          pending += ch;
        } else if (isOperator(ch)) {
          tokens.push(pending || '0', ch);
          pending = '';
        } else {
          pending += ch;
        }
      }
      tokens.push(pending || '0');

      for (const token of tokens) {
        if (isNumber(token)) {
          output.push(token);
        } else if (isOperator(token)) {
          while (
            stack.length &&
            (token === '!'
              ? PRECEDENCE[token] < PRECEDENCE[stack[stack.length - 1]]
              : PRECEDENCE[token] <= PRECEDENCE[stack[stack.length - 1]])
          ) {
            output.push(stack.pop());
          }
          stack.push(token);
        }
      }
      while (stack.length) output.push(stack.pop());
      return output;
    }

    function evaluateRPN(tokens) {
      const stack = [];
      for (const token of tokens) {
        if (isNumber(token)) {
          stack.push(parseFloat(token));
          continue;
        }
        const b = stack.pop();
        const a = stack.pop();
        switch (token) {
          case '+': stack.push(a + b); break;
          case '-': stack.push(a - b); break;
          case '*': stack.push(a * b); break;
          case '/': stack.push(a / b); break;
          case '^': stack.push(a ** b); break;
          case '%': stack.push(a % b); break;
          case '<': stack.push(a < b ? 1 : 0); break;
          case '>': stack.push(a > b ? 1 : 0); break;
          case '≤': stack.push(a <= b ? 1 : 0); break;
          case '≥': stack.push(a >= b ? 1 : 0); break;
          case '=': stack.push(a === b ? 1 : 0); break;
          case '≠': stack.push(a !== b ? 1 : 0); break;
          case '|': stack.push(a || b); break;
          case '&': stack.push(a && b); break;
          case '!': stack.push(b ? 0 : 1); break;
        }
      }
      return stack.length ? stack.pop() : 0;
    }

    function calculatePreset(source, { variables = {}, globals = {} } = {}) {
      const text = String(source ?? '');
      assert(text.length <= 65536, 'CBS 계산식은 65,536자 이하만 지원합니다.');
      const read = (map, key) => {
        const n = parseFloat(Object.hasOwn(map, key) ? map[key] : '');
        return Number.isNaN(n) ? '0' : String(n);
      };
      const execute = (expr) => evaluateRPN(
        toRPN(
          expr
            .replace(/\$([a-zA-Z0-9_]+)/g, (_, key) => read(variables, key))
            .replace(/@([a-zA-Z0-9_]+)/g, (_, key) => read(globals, key))
            .replace(/&&/g, '&')
            .replace(/\|\|/g, '|')
            .replace(/<=/g, '≤')
            .replace(/>=/g, '≥')
            .replace(/==/g, '=')
            .replace(/!=/g, '≠')
            .replace(/null/gi, '0')
        )
      );

      const depth = [''];
      for (const ch of text) {
        if (ch === '(') {
          assert(depth.length < 50, 'CBS 계산식 괄호 중첩이 너무 깊습니다.');
          depth.push('');
        } else if (ch === ')' && depth.length > 1) {
          const value = execute(depth.pop());
          depth[depth.length - 1] += value;
        } else {
          depth[depth.length - 1] += ch;
        }
      }
      return String(execute(depth.join('')));
    }

      __exports.calculatePreset = calculatePreset;

  },
  "src/preset-modules.js"(__require, __exports) {
    // SPDX-License-Identifier: GPL-3.0-only
    // Installed module snapshot normalization and runtime feature classification for preset mode.
    // Never mutates host module activation or executes scripts.

    const { PRESET_LIMIT } = __require("src/preset-format.js");

    const MODULE_LIMIT = PRESET_LIMIT;
    const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

    function assert(ok, message) {
      if (!ok) throw new Error(message);
    }

    function byteLength(str) {
      return new TextEncoder().encode(String(str)).length;
    }

    function clone(value) {
      if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch {}
      }
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function stableEqual(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }

    function checkTree(value, depth = 0, count = { n: 0 }) {
      assert(depth < 70 && ++count.n < 200000, '모듈 데이터 구조가 너무 큽니다.');
      if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          assert(!BAD_KEYS.has(key), '허용하지 않는 모듈 키: ' + key);
          checkTree(item, depth + 1, count);
        }
      }
    }

    function normalizeModule(raw) {
      assert(raw && typeof raw === 'object' && !Array.isArray(raw), '설치 모듈 객체가 필요합니다.');
      assert(typeof raw.id === 'string' && raw.id.trim() && !BAD_KEYS.has(raw.id), '모듈 ID가 없거나 올바르지 않습니다.');
      const result = {};
      for (const key of ['id', 'name', 'namespace', 'description', 'customModuleToggle', 'cjs', 'backgroundEmbedding']) {
        const value = raw[key] ?? '';
        assert(typeof value === 'string', '모듈 문자열 형식 오류: ' + key);
        result[key] = value;
      }
      result.name ||= result.id;
      for (const key of ['lorebook', 'regex', 'trigger', 'assets']) {
        const value = raw[key] ?? [];
        assert(Array.isArray(value) && value.length <= 3000, '모듈 배열 형식 또는 개수 오류: ' + key);
        result[key] = value;
      }
      if (raw.mcp != null) result.mcp = raw.mcp;
      checkTree(result);
      assert(byteLength(JSON.stringify(result)) <= MODULE_LIMIT, '모듈 한 개의 데이터가 32MiB를 초과했습니다.');
      for (const entry of result.lorebook) {
        assert(entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.content === 'string', '모듈 로어북 본문이 올바르지 않습니다.');
      }
      for (const asset of result.assets) {
        assert(Array.isArray(asset) && typeof asset[0] === 'string', '모듈 에셋 이름 형식이 올바르지 않습니다.');
      }
      return clone(result);
    }

    function normalizeModules(raw = []) {
      assert(Array.isArray(raw) && raw.length <= 100, '선택 모듈은 100개 이하 배열이어야 합니다.');
      const modules = raw.map(normalizeModule);
      const ids = new Set();
      for (const mod of modules) {
        assert(!ids.has(mod.id), '선택 모듈 ID가 중복됩니다: ' + mod.id);
        ids.add(mod.id);
      }
      assert(
        modules.reduce((sum, mod) => sum + mod.lorebook.length, 0) <= 3000,
        '선택 모듈의 로어북 합계는 3,000개 이하만 지원합니다.'
      );
      assert(byteLength(JSON.stringify(modules)) <= MODULE_LIMIT, '선택 모듈 합계가 32MiB를 초과했습니다.');
      return modules;
    }

    function moduleOptions(state, mod) {
      const own = Object.hasOwn(state.moduleOptions ?? {}, mod.id) ? state.moduleOptions[mod.id] : {};
      return { skipRuntime: false, excludedLore: [], relaxConditions: false, ...own };
    }

    function validateModuleOptions(state) {
      assert(state.moduleOptions && typeof state.moduleOptions === 'object' && !Array.isArray(state.moduleOptions), '모듈 적용 설정은 객체여야 합니다.');
      checkTree(state.moduleOptions);
      const result = {};
      for (const mod of state.modules) {
        const value = moduleOptions(state, mod);
        assert(
          typeof value.skipRuntime === 'boolean' &&
          typeof value.relaxConditions === 'boolean' &&
          Array.isArray(value.excludedLore) &&
          value.excludedLore.every(i => Number.isInteger(i) && i >= 0 && i < mod.lorebook.length),
          '모듈 적용 설정이 올바르지 않습니다: ' + mod.name
        );
        result[mod.id] = {
          skipRuntime: value.skipRuntime,
          excludedLore: [...new Set(value.excludedLore)],
          relaxConditions: value.relaxConditions,
        };
      }
      return result;
    }

    const activeModules = state => (state.excluded?.modules ? [] : state.modules ?? []);
    const moduleMatches = (mod, reference) => mod.id === reference || Boolean(mod.namespace && mod.namespace === reference);

    function moduleRuntimeProfile(mod) {
      const items = [];
      const requestTriggerNames = { start: '시작 트리거', input: '입력 트리거', request: '요청 트리거' };
      const add = (kind, index, name, phase, category, blocking, reason) => {
        items.push({ kind, index, name, phase, category, status: blocking ? 'unsupported' : 'not-applicable', reason });
      };

      for (const [index, rule] of (mod.regex || []).entries()) {
        const name = rule?.comment || `정규식 ${index + 1}`;
        const phase = rule?.type ?? 'unknown';
        if (phase === 'editdisplay') {
          add('regex', index, name, phase, '표시 정규식', false, '리스 채팅 화면의 표시 처리이므로 RisuHelper 요청에는 적용하지 않습니다.');
        } else if (phase === 'editoutput') {
          add('regex', index, name, phase, '출력 정규식', false, '리스 채팅 응답 후처리이므로 RisuHelper 구조화 제안 응답에는 적용하지 않습니다.');
        } else if (rule?.in === '') {
          add('regex', index, name, phase, '빈 IN 정규식', false, '빈 IN 규칙은 실행하지 않습니다.');
        } else if (phase === 'editinput') {
          add('regex', index, name, phase, '입력 정규식', true, '입력문을 바꿀 수 있으나 프리셋 조립에서는 실행하지 않습니다.');
        } else if (phase === 'editprocess') {
          add('regex', index, name, phase, '전처리 정규식', true, '요청 전처리 정규식은 프리셋 조립에서 실행하지 않습니다.');
        } else {
          add('regex', index, name, phase, '유형 미확인 정규식', true, '적용 유형을 확인할 수 없어 안전을 위해 차단합니다.');
        }
      }

      for (const [index, trigger] of (mod.trigger || []).entries()) {
        const name = trigger?.comment || `트리거 ${index + 1}`;
        const phase = trigger?.type ?? 'unknown';
        const first = trigger?.effect?.[0]?.type;
        if (first === 'triggerlua' || first === 'triggercode') {
          add('trigger', index, name, phase, 'Lua·JS 콜백 트리거', true, '코드 트리거는 실행 시점과 별개로 콜백을 등록할 수 있어 확인/제외가 필요합니다.');
        } else if (['manual', 'display', 'output'].includes(phase)) {
          const label = { manual: '수동 트리거', display: '표시 트리거', output: '출력 트리거' }[phase];
          add('trigger', index, name, phase, label, false, '채팅 수동·표시·출력 단계이므로 RisuHelper 요청에서는 실행하지 않습니다.');
        } else {
          add('trigger', index, name, phase, requestTriggerNames[phase] || '유형 미확인 트리거', true, '모델 요청이나 변수를 바꿀 수 있어 확인/제외가 필요합니다.');
        }
      }

      if ((mod.cjs || '').trim()) add('cjs', 0, '모듈 JS', 'script', '모듈 JS', true, '모듈 JS 실행·콜백은 지원하지 않습니다.');
      if (mod.mcp) add('mcp', 0, 'MCP', 'tools', 'MCP', true, '모듈 MCP 도구 연동은 지원하지 않습니다.');
      if ((mod.backgroundEmbedding || '').trim()) {
        add('background', 0, '배경 코드', 'display', '배경 화면 코드', false, '배경 화면 표시 코드이므로 RisuHelper 요청에서는 실행하지 않습니다.');
      }

      const summarize = (status) => {
        const counts = new Map();
        for (const item of items) {
          if (item.status === status) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
        }
        return [...counts].map(([name, count]) => `${name} ${count}개`);
      };

      return {
        items,
        blocking: summarize('unsupported'),
        notApplicable: summarize('not-applicable'),
      };
    }

    const presetRegexProfile = regex => moduleRuntimeProfile({ regex, trigger: [], cjs: '', backgroundEmbedding: '' });

    async function readInstalledModules(api) {
      assert(typeof api?.getDatabase === 'function', '이 호스트에는 설치 모듈 조회 API가 없습니다.');
      const db = await api.getDatabase(['modules']);
      assert(db && Array.isArray(db.modules), '설치 모듈 조회 권한(db)이 필요하거나 호스트가 modules 조회를 지원하지 않습니다.');
      const seen = new Set();
      return db.modules.filter(mod => mod && typeof mod.id === 'string' && !seen.has(mod.id) && seen.add(mod.id));
    }

    function selectInstalledModules(state, catalog, ids) {
      const wanted = new Set(ids);
      assert([...wanted].every(id => catalog.some(m => m.id === id)), '설치 목록에 없는 모듈을 선택했습니다.');
      const modules = normalizeModules(catalog.filter(mod => wanted.has(mod.id)));
      const options = {};
      for (const mod of modules) {
        const previous = (state.modules ?? []).find(old => old.id === mod.id);
        options[mod.id] = previous && stableEqual(previous, mod)
          ? moduleOptions(state, mod)
          : { skipRuntime: false, excludedLore: [], relaxConditions: false };
      }
      return {
        ...state,
        modules,
        moduleOptions: options,
        excluded: { ...(state.excluded || {}), modules: false },
      };
    }

      __exports.normalizeModule = normalizeModule;
      __exports.normalizeModules = normalizeModules;
      __exports.moduleOptions = moduleOptions;
      __exports.validateModuleOptions = validateModuleOptions;
      __exports.moduleRuntimeProfile = moduleRuntimeProfile;
      __exports.readInstalledModules = readInstalledModules;
      __exports.selectInstalledModules = selectInstalledModules;
      __exports.MODULE_LIMIT = MODULE_LIMIT;
      __exports.activeModules = activeModules;
      __exports.moduleMatches = moduleMatches;
      __exports.presetRegexProfile = presetRegexProfile;

  },
  "src/preset-engine.js"(__require, __exports) {
    // SPDX-License-Identifier: GPL-3.0-only
    // BotBuilder-compatible prompt preset engine adapted for RisuHelper (direct send vs preset mode).

    const { normalizePreset, PRESET_LIMIT } = __require("src/preset-format.js");
    const { parseToggleTree, toggleDefault } = __require("src/preset-v2.js");
    const { calculatePreset } = __require("src/preset-calc.js");
    const { normalizeModules, validateModuleOptions, activeModules, moduleMatches, moduleOptions, moduleRuntimeProfile, presetRegexProfile } = __require("src/preset-modules.js");

    const MAX_INPUT_CHARS = 10_000_000;
    const CBS_BYTES_LIMIT = PRESET_LIMIT;
    const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

    function assert(ok, message) {
      if (!ok) throw new Error(message);
    }

    function byteLength(str) {
      return new TextEncoder().encode(String(str)).length;
    }

    function clone(value) {
      if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch {}
      }
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function parseVariables(source) {
      const out = {};
      for (const line of String(source ?? '').split('\n')) {
        const trimmed = line.replace(/\r$/, '').trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (key && !BAD_KEYS.has(key)) out[key] = val;
      }
      return out;
    }

    const BLOCK_TYPES = [
      ['plain', '일반 프롬프트'],
      ['chat', '대화 기록'],
      ['description', '캐릭터 설명'],
      ['persona', '페르소나'],
      ['lorebook', '로어북'],
      ['authornote', '작가 노트'],
      ['postEverything', '마지막 지시'],
      ['memory', '메모리 입력'],
      ['chatML', 'ChatML'],
      ['jailbreak', '구형 추가 프롬프트'],
      ['cot', '구형 CoT 블록'],
      ['cache', '캐시 지점'],
    ];

    function newPresetState() {
      return {
        schemaVersion: 1,
        mode: 'direct', // 'direct' | 'preset'
        preset: null,
        modules: [],
        moduleOptions: {},
        values: {},
        selectedBlock: 0,
        pane: 'blocks', // 'blocks' | 'toggles' | 'modules' | 'preview'
        environment: {
          userName: '사용자',
          persona: '',
          authorNote: '',
          memory: '',
          globals: {},
        },
        excluded: {
          regex: false,
          modules: false,
          overlay: false,
        },
      };
    }

    function validatePresetState(raw) {
      assert(raw?.schemaVersion === 1 && ['direct', 'preset'].includes(raw.mode), '지원하지 않는 프리셋 설정 형식입니다.');
      const result = { ...newPresetState(), ...clone(raw) };
      if (result.preset) result.preset = normalizePreset(result.preset);
      assert(result.values && typeof result.values === 'object' && !Array.isArray(result.values), '토글 값 형식이 올바르지 않습니다.');
      result.environment = { ...newPresetState().environment, ...result.environment };
      for (const key of ['userName', 'persona', 'authorNote', 'memory']) {
        assert(typeof result.environment[key] === 'string', '프리셋 참고자료 형식 오류: ' + key);
      }
      assert(result.environment.globals && typeof result.environment.globals === 'object' && !Array.isArray(result.environment.globals), '추가 전역 변수는 객체여야 합니다.');
      for (const map of [result.values, result.environment.globals]) {
        for (const [k, v] of Object.entries(map)) {
          assert(!BAD_KEYS.has(k) && typeof v === 'string', '변수 키/값이 올바르지 않습니다.');
        }
      }
      result.excluded = { ...newPresetState().excluded, ...result.excluded };
      for (const key of ['regex', 'modules', 'overlay']) {
        assert(typeof result.excluded[key] === 'boolean', '제외 설정은 참/거짓이어야 합니다: ' + key);
      }
      result.modules = normalizeModules(result.modules ?? []);
      result.moduleOptions = validateModuleOptions(result);
      assert(byteLength(JSON.stringify(result)) <= PRESET_LIMIT * 2, '프리셋 작업 상태가 너무 큽니다.');
      return result;
    }

    function toggleDefinitions(preset, modules = []) {
      const items = [];
      const definitions = [];
      const known = new Map();
      const sources = [
        { name: '프리셋', text: preset?.customPromptTemplateToggle ?? '', preset: true },
        ...modules.map(m => ({ name: m.name, text: m.customModuleToggle })),
      ];

      for (const source of sources) {
        const tree = parseToggleTree(source.text);
        const names = new Set();
        const duplicates = new Set();
        for (const d of tree.definitions) {
          assert(!names.has(d.key), `중복 토글 키: ${d.rawKey} (${source.name})`);
          names.add(d.key);
          assert(!/[{}\r\n]/.test(d.key) && !d.key.includes('::'), '토글 키에 중괄호·줄바꿈·::를 사용할 수 없습니다.');
          const previous = known.get(d.key);
          if (previous) {
            assert(
              previous.type === d.type && JSON.stringify(previous.options) === JSON.stringify(d.options),
              `프리셋·모듈 간 토글 형식 충돌: ${d.rawKey}`
            );
            previous.sources.push(source.name);
            duplicates.add(d);
          } else {
            d.sources = [source.name];
            known.set(d.key, d);
            definitions.push(d);
          }
        }
        const filter = nodes => nodes
          .filter(node => node.type !== 'toggle' || !duplicates.has(node.definition))
          .map(node => (node.type === 'group' ? { ...node, children: filter(node.children) } : node));
        const children = filter(tree.items);
        if (source.preset) items.push(...children);
        else if (children.length) items.push({ type: 'group', label: '모듈 · ' + source.name, children });
      }
      assert(definitions.length <= 300, '프리셋과 모듈을 합쳐 토글은 300개 이하만 지원합니다.');
      return { items, definitions };
    }

    function presetValues(state) {
      const out = { ...(state.environment?.globals || {}) };
      for (const d of toggleDefinitions(state.preset, activeModules(state)).definitions) {
        const value = state.values[d.key] ?? toggleDefault(d);
        if (d.type === 'switch') assert(['0', '1'].includes(value), '스위치 토글 값은 0/1이어야 합니다: ' + d.rawKey);
        if (d.type === 'select') assert(/^\d+$/.test(value) && Number(value) < d.options.length, '선택형 토글 값이 올바르지 않습니다: ' + d.rawKey);
        out[d.key] = value;
      }
      return out;
    }

    const moduleReferences = preset => [
      ...new Set((preset?.moduleIntergration ?? '').split(',').map(id => id.trim()).filter(Boolean)),
    ];

    // Bounded CBS parser & evaluator
    function tokenize(source) {
      assert(source.length <= MAX_INPUT_CHARS, '블록 원문이 10,000,000자를 초과했습니다.');
      let position = 0;
      let count = 0;

      function pieces(depth, inMacro) {
        assert(depth < 50, 'CBS 중첩이 너무 깊습니다.');
        const parts = [[]];
        let text = '';
        const flush = () => { if (text) { parts[parts.length - 1].push({ kind: 'text', text }); text = ''; } };
        while (position < source.length) {
          assert(++count <= MAX_INPUT_CHARS + 1, 'CBS 처리 한도에 도달했습니다.');
          if (source.startsWith('{{', position)) {
            flush();
            position += 2;
            const nested = pieces(depth + 1, true);
            parts[parts.length - 1].push({ kind: 'macro', parts: nested });
          } else if (inMacro && source.startsWith('}}', position)) {
            flush();
            position += 2;
            return parts;
          } else if (inMacro && source.startsWith('::', position)) {
            flush();
            parts.push([]);
            position += 2;
          } else {
            text += source[position++];
          }
        }
        flush();
        assert(!inMacro, 'CBS 닫는 중괄호가 없습니다.');
        return parts;
      }

      const nodes = pieces(0, false)[0];
      let cursor = 0;

      function group(closing, depth = 0) {
        assert(depth < 50, 'CBS 블록 중첩이 너무 깊습니다.');
        const children = [];
        while (cursor < nodes.length) {
          const node = nodes[cursor++];
          const head = node.kind === 'macro' ? (node.parts[0][0]?.text ?? '').trim() : '';
          if (['else', '#else', ':else'].includes(head)) {
            assert(closing, '단독 else 문입니다.');
            const before = children[children.length - 1];
            const after = nodes[cursor];
            const elseLine =
              head === ':else' &&
              closing === 'when' &&
              (!before || (before.kind === 'text' && /(?:^|\n)[ \t]*$/.test(before.text))) &&
              (!after || (after.kind === 'text' && /^[ \t]*(?:\r?\n|$)/.test(after.text)));
            return { children, otherwise: true, elseLine };
          }
          if (head.startsWith('/') && !head.startsWith('//')) {
            assert(closing, '열린 CBS 블록이 없는 닫는 태그입니다: ' + head);
            return { children, otherwise: false };
          }
          if (head.startsWith('#')) {
            const name = head.split(/\s/)[0].slice(1);
            const first = group(name, depth + 1);
            const second = first.otherwise ? group(name, depth + 1) : { children: [] };
            children.push({ kind: 'block', name, opening: node, yes: first.children, no: second.children, elseLine: first.elseLine });
          } else {
            children.push(node);
          }
        }
        assert(!closing, 'CBS 블록 닫는 태그가 없습니다: ' + closing);
        return { children };
      }

      return group(null).children;
    }

    const truth = value => value === '1' || value === 'true';

    function whenCondition(values, context) {
      const stack = [...values];
      let mode = 'normal';
      const globalVal = key => {
        assert(Object.hasOwn(context.globals, key), '값이 없는 전역 변수: ' + key);
        return context.globals[key];
      };
      const localVal = key => (Object.hasOwn(context.variables, key) ? context.variables[key] : 'null');

      while (stack.length > 1) {
        const b = stack.pop();
        const op = stack.pop();
        const left = () => {
          assert(stack.length, 'CBS 조건식의 왼쪽 값이 없습니다: ' + op);
          return stack.pop();
        };
        if (op === 'keep' || op === 'legacy') {
          mode = op;
          stack.push(b);
          continue;
        }
        let value;
        switch (op) {
          case 'not': value = !truth(b); break;
          case 'and': value = truth(left()) && truth(b); break;
          case 'or': value = truth(left()) || truth(b); break;
          case 'is': value = left() === b; break;
          case 'isnot': value = left() !== b; break;
          case '>': value = parseFloat(left()) > parseFloat(b); break;
          case '<': value = parseFloat(left()) < parseFloat(b); break;
          case '>=': value = parseFloat(left()) >= parseFloat(b); break;
          case '<=': value = parseFloat(left()) <= parseFloat(b); break;
          case 'var': value = truth(localVal(b)); break;
          case 'toggle': value = truth(globalVal('toggle_' + b)); break;
          case 'vis': value = localVal(left()) === b; break;
          case 'visnot': value = localVal(left()) !== b; break;
          case 'tis': value = globalVal('toggle_' + left()) === b; break;
          case 'tisnot': value = globalVal('toggle_' + left()) !== b; break;
          default: throw new Error('지원하지 않는 CBS 조건 연산자: ' + op);
        }
        stack.push(value ? '1' : '0');
      }
      return { active: truth(stack[0]), mode };
    }

    const trimLines = text => text.split('\n').map(line => line.trimStart()).join('\n').trim();
    const stripDecorators = text => text.split('\n').filter(line => !/^\s*@@/.test(line)).join('\n');
    function trimBlankLines(text) {
      const lines = text.split('\n');
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return lines.join('\n');
    }

    function evaluate(nodes, context) {
      const render = list => {
        let out = '';
        for (const node of list) {
          out += one(node);
          assert(out.length <= MAX_INPUT_CHARS, 'CBS 출력 상한을 초과했습니다.');
        }
        return out;
      };
      const part = p => render(p);
      const relaxable = err => Boolean(context.lenient) && !/상한|초과/.test(err.message);
      const relax = note => { if (context.relaxed && context.relaxed.length < 50) context.relaxed.push(note); };

      function one(node) {
        if (node.kind === 'text') return node.text;
        if (node.kind === 'block') {
          let active;
          let mode = node.name === 'if_pure' ? 'keep' : 'legacy';
          try {
            assert(['if', 'if_pure', 'when'].includes(node.name), '지원하지 않는 CBS 블록: #' + node.name);
            if (node.name === 'when') {
              const values = node.opening.parts.length > 1
                ? node.opening.parts.slice(1).map(part)
                : [part(node.opening.parts[0]).replace(/^#when\s*/, '')];
              ({ active, mode } = whenCondition(values, context));
            } else {
              active = truth(part(node.opening.parts[0]).replace(/^#if(?:_pure)?\s*/, ''));
            }
          } catch (err) {
            if (!relaxable(err)) throw err;
            relax('조건을 거짓으로 처리: ' + err.message);
            active = false;
          }
          let text = render(active ? node.yes : node.no);
          if (node.elseLine) {
            text = active ? text.replace(/(?:\r?\n)?[ \t]*$/, '') : text.replace(/^[ \t]*\r?\n/, '');
          }
          return mode === 'keep' ? text : mode === 'legacy' ? trimLines(text) : trimBlankLines(text);
        }
        try {
          return macro(node);
        } catch (err) {
          if (!relaxable(err)) throw err;
          relax('표기를 빈 값으로 처리: ' + err.message);
          return '';
        }
      }

      function macro(node) {
        const rawHead = part(node.parts[0]);
        const head = rawHead.trim();
        const name = head.toLowerCase();
        const args = node.parts.slice(1).map(part);

        if (name.replace(/[\s_-]/g, '') === 'userinput') {
          if (context.nativeLiterals && context.nativeLiterals.size < 10) context.nativeLiterals.add(head);
          return '{{' + [rawHead, ...args].join('::') + '}}';
        }
        if (head.startsWith('? ')) return calculatePreset(head.slice(2), context);
        if (name === 'calc') { assert(args.length === 1, 'calc 인자 오류'); return calculatePreset(args[0], context); }
        if (head.startsWith('//') || head.startsWith('!')) return '';
        if (Object.hasOwn(context.fields, name)) {
          assert(!args.length, '인자 없는 CBS 표기입니다: ' + head);
          if (name === 'lorebook' && context.loreUsage) context.loreUsage.used = true;
          return context.fields[name];
        }
        if (['moduleenabled', 'module_enabled'].includes(name)) {
          assert(args.length === 1, 'moduleenabled 인자 오류');
          return (context.modules ?? []).some(m => m.namespace === args[0]) ? '1' : '0';
        }
        if (['moduleassetlist', 'module_assetlist'].includes(name)) {
          assert(args.length === 1, 'moduleassetlist 인자 오류');
          const mod = (context.modules ?? []).find(m => m.namespace === args[0]);
          return mod ? JSON.stringify(mod.assets.map(a => a[0].replace(/::/g, '\\u003A\\u003A'))) : '';
        }
        if (name === 'getglobalvar') {
          assert(args.length === 1, 'getglobalvar 인자 오류');
          assert(Object.hasOwn(context.globals, args[0]), `값이 없는 전역 변수: ${args[0]} (토글 또는 추가 전역 변수에서 설정하세요)`);
          return context.globals[args[0]];
        }
        if (name === 'getvar') {
          assert(args.length === 1, 'getvar 인자 오류');
          return Object.hasOwn(context.variables, args[0]) ? context.variables[args[0]] : 'null';
        }
        if (['equal', 'notequal', 'greater', 'greater_equal', 'less', 'less_equal'].includes(name)) {
          assert(args.length === 2, '비교식에는 값 2개가 필요합니다: ' + name);
          const [a, b] = args;
          if (name === 'equal') return a === b ? '1' : '0';
          if (name === 'notequal') return a !== b ? '1' : '0';
          const x = Number(a);
          const y = Number(b);
          assert(Number.isFinite(x) && Number.isFinite(y), '숫자 비교에 숫자가 아닌 값이 있습니다.');
          return ({ greater: x > y, greater_equal: x >= y, less: x < y, less_equal: x <= y })[name] ? '1' : '0';
        }
        if (name === 'and') { assert(args.length === 2, 'and 인자 오류'); return args[0] === '1' && args[1] === '1' ? '1' : '0'; }
        if (name === 'or') { assert(args.length === 2, 'or 인자 오류'); return args[0] === '1' || args[1] === '1' ? '1' : '0'; }
        if (name === 'not') { assert(args.length === 1, 'not 인자 오류'); return args[0] === '1' ? '0' : '1'; }
        if (name === 'trim') { if (args.length) return args.join('::').trim(); context.trim = true; return ''; }
        if (name === 'lower') return args.join('::').toLowerCase();
        if (name === 'upper') return args.join('::').toUpperCase();
        throw new Error('지원하지 않는 CBS: ' + head);
      }

      const out = render(nodes);
      return context.trim ? out.trim() : out;
    }

    function renderPresetText(source, context) {
      const value = evaluate(tokenize(String(source ?? '')), { ...context, trim: false });
      assert(byteLength(value) <= CBS_BYTES_LIMIT, 'CBS 출력이 32MiB를 초과했습니다.');
      return value;
    }

    function resolveRange(block, count) {
      let start = block.rangeStart ?? 0;
      let end = block.rangeEnd ?? 'end';
      assert(Number.isInteger(start) && (end === 'end' || Number.isInteger(end)), '채팅 범위가 올바르지 않습니다.');
      if (start === -1000) return [0, count];
      if (end === 'end') end = count;
      if (start < 0) start = Math.max(0, count + start);
      if (end < 0) end = Math.max(0, count + end);
      return [start, Math.min(end, count)];
    }

    const ROLE_MAP = { system: 'system', user: 'user', bot: 'assistant', assistant: 'assistant' };
    const normalizeRole = value => (Object.hasOwn(ROLE_MAP, value) ? ROLE_MAP[value] : undefined);

    /**
     * Assembles the final LLM messages for RisuHelper in either:
     * - 'direct' mode: sends RisuHelper's directMessages unchanged
     * - 'preset' mode: evaluates the imported RisuAI prompt preset + toggles + selected modules
     *   and embeds RisuHelper's work instructions & proposal protocol into the active user turn.
     */
    function assembleRisuHelperMessages({
      presetState,
      directMessages,
      activeChar = null,
      activePersona = null,
      loreEntries = [],
      history = [],
      maxHistoryTurns = 12,
    }) {
      const state = validatePresetState(presetState || newPresetState());

      if (state.mode === 'direct') {
        return {
          mode: 'direct',
          messages: directMessages,
          trace: [],
          moduleTrace: [],
          presetRegexTrace: [],
          issues: [],
          globals: {},
          notes: ['직접 보내기 모드: RisuHelper 시스템 프롬프트와 현재 화면 문맥을 그대로 전송합니다.'],
        };
      }

      const p = state.preset;
      if (!p) {
        return {
          mode: 'preset',
          messages: [],
          trace: [],
          moduleTrace: [],
          presetRegexTrace: [],
          issues: ['프리셋 적용 모드가 켜져 있지만 가져온 프리셋 파일이 없습니다. 프리셋 패널에서 .risup / .risupreset / JSON 파일을 가져오거나 "직접 보내기" 모드로 전환하세요.'],
          globals: {},
          notes: [],
        };
      }

      const globals = presetValues(state);
      const variables = {
        ...parseVariables(p.templateDefaultVariables),
        ...parseVariables(activeChar?.defaultVariables ?? ''),
      };
      const env = state.environment;
      const charDesc = String(activeChar?.desc ?? '');
      const charName = String(activeChar?.name ?? '');
      const personaText = env.persona || String(activePersona?.personaPrompt ?? '');
      const userName = env.userName || String(activePersona?.name ?? '사용자');

      let lore = (loreEntries || [])
        .filter(e => e && e.mode !== 'folder' && typeof e.content === 'string' && e.content.trim())
        .slice(0, 80)
        .map(l => `[${l.comment || l.key || '로어북'}]\n${l.content}`)
        .join('\n\n');

      const systemGuide = directMessages[0]?.role === 'system' ? directMessages[0].content : '';
      const userPrompt = directMessages[directMessages.length - 1]?.content ?? '';
      const currentUser = {
        role: 'user',
        content: systemGuide ? `[RisuHelper 작업 지침]\n${systemGuide}\n\n[사용자 요청]\n${userPrompt}` : userPrompt,
      };

      const validHistory = (history || [])
        .filter(m => !m.error && (m.role === 'user' || m.role === 'assistant'))
        .map(m => ({ role: m.role, content: m.rawText || m.content }));
      const keepCount = Math.max(1, Number(maxHistoryTurns) || 12) * 2;
      const omittedHistory = Math.max(0, validHistory.length - keepCount);
      const keptHistory = omittedHistory ? validHistory.slice(-keepCount) : validHistory;
      const chats = [...keptHistory, currentUser];

      const lastAssistant = [...keptHistory].reverse().find(m => m.role === 'assistant')?.content ?? '';
      const context = {
        globals,
        variables,
        fields: {
          char: charName,
          user: userName,
          description: charDesc,
          personality: String(activeChar?.personality ?? ''),
          scenario: String(activeChar?.scenario ?? ''),
          persona: personaText,
          firstmessage: String(activeChar?.firstMessage ?? ''),
          first_message: String(activeChar?.firstMessage ?? ''),
          systemprompt: String(activeChar?.systemPrompt ?? ''),
          lorebook: lore,
          chatindex: String(chats.length - 1),
          lastusermessage: currentUser.content,
          lastcharmessage: lastAssistant,
          original: p.mainPrompt,
          slot: '',
        },
        modules: activeModules(state),
        loreUsage: { used: false },
        nativeLiterals: new Set(),
      };

      const messages = [];
      const trace = [];
      const issues = [];
      const moduleTrace = [];
      const presetRegexTrace = [];
      let userCount = 0;

      const missingRefs = moduleReferences(p).filter(ref => !context.modules.some(mod => moduleMatches(mod, ref)));
      if (missingRefs.length && !state.excluded.modules) {
        issues.push(`프리셋 참조 모듈이 선택되지 않았습니다 (${missingRefs.join(', ')}). 프리셋 → 모듈 탭에서 선택하거나 "모듈 연동 전체 제외"를 켜세요.`);
      }

      const moduleLore = [];
      let moduleSize = 0;
      for (const mod of state.modules) {
        const opts = moduleOptions(state, mod);
        const profile = moduleRuntimeProfile(mod);
        if (state.excluded.modules) {
          moduleTrace.push({ module: mod.name, status: 'excluded', reason: '모듈 연동 전체 제외' });
          continue;
        }
        if (profile.notApplicable.length) {
          moduleTrace.push({ module: mod.name, type: 'runtime', status: 'not-applicable', features: profile.notApplicable });
        }
        if (profile.blocking.length) {
          const status = opts.skipRuntime ? 'excluded' : 'error';
          moduleTrace.push({ module: mod.name, type: 'runtime', status, features: profile.blocking });
          if (!opts.skipRuntime) {
            issues.push(`${mod.name}: ${profile.blocking.join(', ')} 실행은 미지원입니다. 모듈 탭에서 "요청 관련 미지원 처리 제외"를 켜세요.`);
          }
        }
        for (const [index, entry] of mod.lorebook.entries()) {
          const rec = { module: mod.name, index, name: entry.comment || entry.key || '로어북', status: 'excluded' };
          moduleTrace.push(rec);
          if (opts.excludedLore.includes(index)) continue;
          let text;
          try {
            const decorated = /(?:^|\n)\s*@@/.test(entry.content);
            if (opts.relaxConditions) {
              const relaxed = decorated ? ['@@ 지시 줄 제거'] : [];
              text = renderPresetText(decorated ? stripDecorators(entry.content) : entry.content, { ...context, lenient: true, relaxed });
              if (relaxed.length) rec.relaxed = relaxed;
            } else {
              assert(!decorated, '@@ 위치·활성화 지시 처리는 미지원입니다.');
              text = renderPresetText(entry.content, context);
            }
            rec.status = text ? 'prepared' : 'empty';
          } catch (err) {
            rec.status = 'error';
            rec.error = err.message;
            issues.push(`${mod.name} / ${rec.name}: ${err.message}${opts.relaxConditions ? '' : ' (모듈 탭에서 조건 완화 옵션을 켜거나 항목을 제외하세요)'}`);
            continue;
          }
          moduleSize += byteLength(text);
          assert(moduleSize <= PRESET_LIMIT, '모듈 로어북 조립 결과가 32MiB를 초과했습니다.');
          if (text) moduleLore.push(`[모듈 ${mod.name} · ${rec.name}]\n${text}`);
        }
      }

      lore = [lore, ...moduleLore].filter(Boolean).join('\n\n');
      context.fields.lorebook = lore;
      context.loreUsage.used = false;

      if (p.regex?.length) {
        const profile = presetRegexProfile(p.regex);
        presetRegexTrace.push(...profile.items.map(item => ({
          ...item,
          status: state.excluded.regex ? 'excluded' : item.status === 'unsupported' ? 'error' : 'not-applicable',
        })));
        if (profile.blocking.length && !state.excluded.regex) {
          issues.push(`프리셋 정규식(${profile.blocking.join(', ')})은 미지원입니다. 프리셋 패널에서 "프리셋 정규식 제외"를 체크하세요.`);
        }
      }

      if (p.promptBlockOverlay?.enabled && !state.excluded.overlay) {
        issues.push('보조 프롬프트 오버레이는 미지원입니다. 프리셋 패널에서 "오버레이 제외"를 체크하세요.');
      }

      let totalSize = 0;
      const pushMsg = (r, content, current = false) => {
        const mapped = normalizeRole(r);
        assert(mapped, '지원하지 않는 메시지 역할: ' + r);
        totalSize += byteLength(content);
        assert(totalSize <= PRESET_LIMIT, '조립된 프롬프트가 32MiB 상한을 초과했습니다.');
        if (current) userCount++;
        if (content) messages.push({ role: mapped, content });
        assert(messages.length <= 3000, '전송 메시지가 3,000개를 초과했습니다.');
      };

      for (const [i, b] of p.promptTemplate.entries()) {
        const record = { index: i, name: b.name || b.type, type: b.type, status: 'excluded', messages: 0 };
        trace.push(record);
        if (b.enabled === false) continue;
        if ((b.type === 'jailbreak' && p.jailbreakToggle === false) || (b.type === 'cot' && p.chainOfThought === false)) {
          record.reason = '구형 블록 활성화 설정이 꺼져 있습니다.';
          continue;
        }
        const beforeLen = messages.length;
        try {
          if (['plain', 'jailbreak', 'cot'].includes(b.type)) {
            pushMsg(b.role ?? 'system', renderPresetText(b.text ?? '', context));
          } else if (b.type === 'chat') {
            const [start, end] = resolveRange(b, chats.length);
            for (const m of chats.slice(start, Math.max(start, end))) {
              pushMsg(m.role, m.content, m === currentUser);
            }
          } else if (['description', 'persona', 'lorebook', 'authornote', 'memory', 'postEverything'].includes(b.type)) {
            const values = {
              description: charDesc,
              persona: personaText,
              lorebook: lore,
              authornote: env.authorNote || b.defaultText || '',
              memory: env.memory,
              postEverything: p.promptSettings?.postEndInnerFormat ?? '',
            };
            let text = values[b.type];
            if (text && (b.type === 'postEverything' || (b.type === 'authornote' && !env.authorNote))) {
              text = renderPresetText(text, context);
            }
            if (text && b.innerFormat) {
              assert(b.innerFormat.includes('{{slot}}'), '감싸는 서식에 {{slot}}이 없습니다.');
              text = renderPresetText(b.innerFormat, { ...context, fields: { ...context.fields, slot: text } });
            }
            pushMsg(b.role2 ?? 'system', text);
            if (b.type === 'lorebook' && text) context.loreUsage.used = true;
          } else if (b.type === 'chatML') {
            const text = renderPresetText(b.text ?? '', context);
            const re = /<\|im_start\|>(system|user|assistant)\r?\n([\s\S]*?)(?:<\|im_end\|>|$)/g;
            let match;
            let pos = 0;
            while ((match = re.exec(text))) {
              assert(!text.slice(pos, match.index).trim(), 'ChatML 시작 표기 앞에 해석할 수 없는 내용이 있습니다.');
              pushMsg(match[1], match[2]);
              pos = re.lastIndex;
            }
            assert(pos > 0 && !text.slice(pos).trim(), '지원하지 않는 ChatML 형식입니다.');
          } else if (b.type === 'cache') {
            const depth = b.depth ?? 1;
            const filter = b.role ?? 'all';
            assert(Number.isInteger(depth) && depth >= 0 && depth <= 3000, '캐시 깊이는 0~3,000 정수여야 합니다.');
            assert(['system', 'user', 'assistant', 'all'].includes(filter), '지원하지 않는 캐시 역할: ' + filter);
            record.status = 'metadata';
            for (let ptr = messages.length - 1, hit = 0; ptr >= 0 && hit < depth; ptr--) {
              if (filter === 'all' || messages[ptr].role === filter) {
                messages[ptr].cachePoint = true;
                hit++;
              }
            }
            continue;
          } else {
            throw new Error('지원하지 않는 블록 유형: ' + b.type);
          }
          record.status = messages.length > beforeLen ? 'included' : 'empty';
          record.messages = messages.length - beforeLen;
        } catch (err) {
          record.status = 'error';
          record.error = err.message;
          issues.push(`${i + 1}. ${record.name}: ${err.message}`);
        }
      }

      if (p.promptSettings?.assistantPrefill) {
        try {
          pushMsg('assistant', renderPresetText(p.promptSettings.assistantPrefill, context));
        } catch (err) {
          issues.push('Assistant prefill: ' + err.message);
        }
      }

      if (userCount !== 1) {
        issues.push(`현재 RisuHelper 요청을 포함하는 chat 블록이 정확히 1개여야 합니다 (현재 ${userCount}회 포함됨).`);
      }
      if (moduleLore.length && !context.loreUsage.used) {
        issues.push('선택 모듈 로어북을 담을 lorebook 블록 또는 {{lorebook}} 표기가 프리셋에 없습니다.');
      }
      for (const rec of moduleTrace) {
        if (rec.status === 'prepared') rec.status = context.loreUsage.used ? 'included' : 'not-included';
      }

      const notes = [];
      if (omittedHistory) notes.push(`이전 대화 ${omittedHistory}개는 턴 수 상한에 따라 생략되었습니다.`);
      if (context.nativeLiterals.size) {
        notes.push(`${[...context.nativeLiterals].map(n => `{{${n}}}`).join(', ')} 표기는 리스 원본처럼 리터럴로 유지했습니다.`);
      }

      return { mode: 'preset', messages, trace, moduleTrace, presetRegexTrace, issues, globals, notes };
    }

      __exports.parseVariables = parseVariables;
      __exports.newPresetState = newPresetState;
      __exports.validatePresetState = validatePresetState;
      __exports.toggleDefinitions = toggleDefinitions;
      __exports.presetValues = presetValues;
      __exports.renderPresetText = renderPresetText;
      __exports.assembleRisuHelperMessages = assembleRisuHelperMessages;
      __exports.BLOCK_TYPES = BLOCK_TYPES;
      __exports.moduleReferences = moduleReferences;

  },
  "src/preset-ui.js"(__require, __exports) {
    // SPDX-License-Identifier: GPL-3.0-only
    // Preset configuration & preview UI panel for RisuHelper (direct send vs preset mode).

    const { decodePreset, normalizePreset, PRESET_LIMIT } = __require("src/preset-format.js");
    const { newPresetState, validatePresetState, toggleDefinitions, BLOCK_TYPES, moduleReferences } = __require("src/preset-engine.js");
    const { toggleDefault } = __require("src/preset-v2.js");
    const { activeModules, moduleOptions, moduleRuntimeProfile, readInstalledModules, selectInstalledModules } = __require("src/preset-modules.js");

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

    function pickLocalFile(doc, accept) {
      return new Promise((resolve) => {
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        let settled = false;
        const finish = (file) => {
          if (settled) return;
          settled = true;
          input.remove();
          resolve(file);
        };
        input.onchange = () => finish(input.files?.[0] || null);
        if (typeof input.addEventListener === 'function') {
          input.addEventListener('cancel', () => finish(null));
        }
        doc.body.appendChild(input);
        input.click();
      });
    }

    function renderToggleNodes(doc, nodes, state, onChange, keyPrefix = 'tg') {
      const out = [];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.type === 'divider') {
          out.push(h(doc, 'hr', { style: 'border:none;border-top:1px solid var(--rh-border);margin:6px 0;' }));
        } else if (node.type === 'caption') {
          out.push(h(doc, 'div', { style: 'font-size:11px;color:var(--rh-muted);' }, node.label));
        } else if (node.type === 'group') {
          const groupKey = `${keyPrefix}:${i}:${node.label || 'group'}`;
          out.push(
            h(doc, 'details', { class: 'rh-preview-details', open: true, 'data-rh-details-key': groupKey },
              h(doc, 'summary', {}, node.label || '그룹'),
              h(doc, 'div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px;' },
                ...renderToggleNodes(doc, node.children || [], state, onChange, groupKey)
              )
            )
          );
        } else if (node.type === 'toggle') {
          const d = node.definition;
          const cur = state.values[d.key] ?? toggleDefault(d);
          if (d.type === 'switch') {
            out.push(
              h(doc, 'label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;' },
                h(doc, 'input', {
                  type: 'checkbox',
                  checked: cur === '1',
                  onchange: (e) => {
                    state.values[d.key] = e.target.checked ? '1' : '0';
                    onChange();
                  },
                }),
                `${d.label} (${d.rawKey})`
              )
            );
          } else if (d.type === 'select') {
            out.push(
              h(doc, 'div', { class: 'rh-field' },
                h(doc, 'span', {}, `${d.label} (${d.rawKey})`),
                h(doc, 'select', {
                  class: 'rh-select',
                  onchange: (e) => {
                    state.values[d.key] = e.target.value;
                    onChange();
                  },
                },
                  ...d.options.map((opt, idx) =>
                    h(doc, 'option', { value: String(idx), selected: String(idx) === String(cur) }, opt)
                  )
                )
              )
            );
          } else {
            out.push(
              h(doc, 'div', { class: 'rh-field' },
                h(doc, 'span', {}, `${d.label} (${d.rawKey})`),
                h(doc, d.type === 'textarea' ? 'textarea' : 'input', {
                  class: d.type === 'textarea' ? 'rh-textarea' : 'rh-input',
                  value: cur,
                  onchange: (e) => {
                    state.values[d.key] = e.target.value;
                    onChange();
                  },
                })
              )
            );
          }
        }
      }
      return out;
    }

    /**
     * Renders the Preset Manager / Direct-vs-Preset Mode panel inside RisuHelper's drawer.
     */
    function renderPresetPanel(app) {
      const doc = app.doc;
      const state = app.presetState;
      const p = state.preset;

      const persistAndRender = async (msg) => {
        await app.savePresetState();
        if (msg) app.showToast(msg);
        else app.render();
      };

      const handleImport = async () => {
        try {
          const file = await pickLocalFile(doc, '.risup,.risupreset,.json,.preset');
          if (!file) return;
          if (file.size > PRESET_LIMIT) {
            app.showToast('프리셋 파일은 32MiB 이하만 지원합니다.');
            return;
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const decoded = await decodePreset(bytes, file.name);
          const prevModules = state.modules || [];
          const prevModOpts = state.moduleOptions || {};
          const next = validatePresetState({
            ...newPresetState(),
            mode: 'preset',
            preset: decoded,
            modules: prevModules,
            moduleOptions: prevModOpts,
            values: state.values || {},
            environment: state.environment,
            excluded: state.excluded,
          });
          // Validate toggle consistency
          toggleDefinitions(next.preset, activeModules(next));
          app.presetState = next;
          await persistAndRender(`프리셋 "${decoded.name}"을(를) 불러왔습니다 (프리셋 적용 모드).`);
        } catch (err) {
          app.showToast(`프리셋 가져오기 실패: ${err.message}`);
        }
      };

      const handleExport = () => {
        if (!p) return;
        try {
          const data = normalizePreset(p);
          data.promptTemplate = data.promptTemplate.filter(b => b.enabled !== false).map(b => {
            const copy = { ...b };
            delete copy.enabled;
            return copy;
          });
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = doc.createElement('a');
          a.href = url;
          a.download = `${(data.name || 'preset').replace(/[<>:"/\\|?*]/g, '_')}.json`;
          doc.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
          app.showToast('프리셋 JSON을 내보냈습니다.');
        } catch (err) {
          app.showToast(`내보내기 실패: ${err.message}`);
        }
      };

      const handleLoadHostModules = async () => {
        try {
          const catalog = await readInstalledModules(app.api);
          app.hostModuleCatalog = catalog;
          app.showToast(`설치된 모듈 ${catalog.length}개를 불러왔습니다.`);
        } catch (err) {
          app.showToast(`모듈 목록 조회 실패: ${err.message}`);
        }
      };

      // Mode toggle row: 직접 보내기 vs 프리셋 적용
      const modeBar = h(doc, 'div', { class: 'rh-row', style: 'justify-content:space-between;' },
        h(doc, 'div', { class: 'rh-seg' },
          h(doc, 'button', {
            class: `rh-seg-btn${state.mode === 'direct' ? ' active' : ''}`,
            onclick: async () => {
              state.mode = 'direct';
              await persistAndRender('직접 보내기 모드로 전환했습니다.');
            },
          }, '직접 보내기'),
          h(doc, 'button', {
            class: `rh-seg-btn${state.mode === 'preset' ? ' active' : ''}`,
            onclick: async () => {
              state.mode = 'preset';
              await persistAndRender('프리셋 적용 모드로 전환했습니다.');
            },
          }, '프리셋 적용')
        ),
        h(doc, 'div', { class: 'rh-row' },
          h(doc, 'button', { class: 'rh-btn primary', onclick: handleImport }, '프리셋 가져오기'),
          p && h(doc, 'button', { class: 'rh-btn', onclick: handleExport }, 'JSON 내보내기'),
          p && h(doc, 'button', {
            class: 'rh-btn danger',
            onclick: async () => {
              state.preset = null;
              state.mode = 'direct';
              state.selectedBlock = 0;
              await persistAndRender('프리셋을 제거하고 직접 보내기 모드로 전환했습니다.');
            },
          }, '제거')
        )
      );

      // Sub-pane tabs
      const panes = [
        ['blocks', `블록${p ? ` (${p.promptTemplate.length})` : ''}`],
        ['toggles', '토글'],
        ['modules', `모듈 (${state.modules.length})`],
        ['preview', '전송 미리보기'],
      ];
      const paneTabs = h(doc, 'div', { class: 'rh-row' },
        ...panes.map(([id, label]) =>
          h(doc, 'button', {
            class: `rh-btn${state.pane === id ? ' primary' : ''}`,
            onclick: async () => {
              state.pane = id;
              if (id === 'preview') await app.refreshPresetPreview();
              app.render();
            },
          }, label)
        )
      );

      const body = h(doc, 'div', { class: 'rh-preset-body' });

      if (state.pane === 'blocks') {
        if (!p) {
          body.appendChild(
            h(doc, 'div', { class: 'rh-banner' },
              '가져온 프리셋이 없습니다. ".risup / .risupreset / .json" 파일을 가져오면 본체 프리셋을 변경하지 않고 RisuHelper 요청에 프리셋을 적용할 수 있습니다.'
            )
          );
        } else {
          body.appendChild(
            h(doc, 'div', { style: 'font-size:12px;font-weight:700;' }, `프리셋: ${p.name} (블록 ${p.promptTemplate.length}개)`)
          );

          // Exclusions for unsupported regex/modules/overlay
          body.appendChild(
            h(doc, 'div', { class: 'rh-checks' },
              h(doc, 'label', {},
                h(doc, 'input', {
                  type: 'checkbox',
                  checked: state.excluded.regex,
                  onchange: async (e) => { state.excluded.regex = Boolean(e.target.checked); await persistAndRender(); },
                }),
                '프리셋 정규식 제외'
              ),
              h(doc, 'label', {},
                h(doc, 'input', {
                  type: 'checkbox',
                  checked: state.excluded.modules,
                  onchange: async (e) => { state.excluded.modules = Boolean(e.target.checked); await persistAndRender(); },
                }),
                '모듈 연동 전체 제외'
              ),
              h(doc, 'label', {},
                h(doc, 'input', {
                  type: 'checkbox',
                  checked: state.excluded.overlay,
                  onchange: async (e) => { state.excluded.overlay = Boolean(e.target.checked); await persistAndRender(); },
                }),
                '오버레이 제외'
              )
            )
          );

          for (const [idx, block] of p.promptTemplate.entries()) {
            const typeLabel = BLOCK_TYPES.find(([t]) => t === block.type)?.[1] || block.type;
            const isSelected = state.selectedBlock === idx;
            body.appendChild(
              h(doc, 'div', {
                style: `border:1px solid ${isSelected ? 'var(--rh-accent)' : 'var(--rh-border)'};border-radius:8px;padding:6px 8px;background:var(--rh-surface);display:flex;flex-direction:column;gap:6px;`,
              },
                h(doc, 'div', { class: 'rh-row', style: 'justify-content:space-between;' },
                  h(doc, 'label', { style: 'display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;cursor:pointer;' },
                    h(doc, 'input', {
                      type: 'checkbox',
                      checked: block.enabled !== false,
                      onchange: async (e) => {
                        block.enabled = Boolean(e.target.checked);
                        await persistAndRender();
                      },
                    }),
                    `${idx + 1}. ${block.name || typeLabel}`
                  ),
                  h(doc, 'div', { class: 'rh-row' },
                    h(doc, 'span', { class: 'rh-pill' }, `${typeLabel}${block.role ? ` · ${block.role}` : ''}`),
                    ['plain', 'jailbreak', 'cot', 'chatML'].includes(block.type) && h(doc, 'button', {
                      class: 'rh-btn ghost',
                      onclick: () => {
                        state.selectedBlock = isSelected ? -1 : idx;
                        app.render();
                      },
                    }, isSelected ? '접기' : '편집')
                  )
                ),
                isSelected && ['plain', 'jailbreak', 'cot', 'chatML'].includes(block.type) && h(doc, 'textarea', {
                  class: 'rh-textarea',
                  style: 'min-height:90px;font-family:var(--rh-mono);font-size:11.5px;',
                  value: block.text ?? '',
                  onchange: async (e) => {
                    block.text = e.target.value;
                    await persistAndRender('블록 내용을 저장했습니다.');
                  },
                })
              )
            );
          }
        }
      } else if (state.pane === 'toggles') {
        try {
          const { items, definitions } = toggleDefinitions(p, activeModules(state));
          if (definitions.length === 0) {
            body.appendChild(h(doc, 'div', { style: 'font-size:12px;color:var(--rh-muted);' }, '정의된 프리셋·모듈 토글이 없습니다.'));
          } else {
            const persistToggleOnly = () => {
              app.savePresetState().catch((err) => {
                app.showToast(`토글 저장 실패: ${err.message}`);
              });
            };
            for (const nodeEl of renderToggleNodes(doc, items, state, persistToggleOnly)) {
              body.appendChild(nodeEl);
            }
          }
        } catch (err) {
          body.appendChild(h(doc, 'div', { class: 'rh-banner error' }, `토글 오류: ${err.message}`));
        }
      } else if (state.pane === 'modules') {
        const refs = moduleReferences(p);
        body.appendChild(
          h(doc, 'div', { class: 'rh-row' },
            h(doc, 'button', { class: 'rh-btn primary', onclick: handleLoadHostModules }, '설치 모듈 불러오기'),
            refs.length > 0 && app.hostModuleCatalog?.length > 0 && h(doc, 'button', {
              class: 'rh-btn',
              onclick: async () => {
                const matchedIds = app.hostModuleCatalog
                  .filter(m => refs.some(r => m.id === r || (m.namespace && m.namespace === r)))
                  .map(m => m.id);
                const curIds = new Set(state.modules.map(m => m.id));
                for (const id of matchedIds) curIds.add(id);
                app.presetState = selectInstalledModules(state, app.hostModuleCatalog, [...curIds]);
                await persistAndRender(`프리셋 참조 모듈 ${matchedIds.length}개를 선택했습니다.`);
              },
            }, `참조 모듈 자동 선택 (${refs.length})`)
          )
        );

        if (refs.length > 0) {
          body.appendChild(h(doc, 'div', { style: 'font-size:11px;color:var(--rh-muted);' }, `프리셋 참조 모듈: ${refs.join(', ')}`));
        }

        if (Array.isArray(app.hostModuleCatalog) && app.hostModuleCatalog.length > 0) {
          const selectedIds = new Set(state.modules.map(m => m.id));
          body.appendChild(
            h(doc, 'details', { class: 'rh-preview-details', open: true, 'data-rh-details-key': 'host-module-catalog' },
              h(doc, 'summary', {}, `설치된 호스트 모듈 선택 (${app.hostModuleCatalog.length}개)`),
              h(doc, 'div', { style: 'display:flex;flex-direction:column;gap:4px;margin-top:6px;' },
                ...app.hostModuleCatalog.map(mod =>
                  h(doc, 'label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;' },
                    h(doc, 'input', {
                      type: 'checkbox',
                      checked: selectedIds.has(mod.id),
                      onchange: async (e) => {
                        const nextIds = new Set(state.modules.map(m => m.id));
                        if (e.target.checked) nextIds.add(mod.id);
                        else nextIds.delete(mod.id);
                        try {
                          app.presetState = selectInstalledModules(state, app.hostModuleCatalog, [...nextIds]);
                          await persistAndRender();
                        } catch (err) {
                          app.showToast(err.message);
                        }
                      },
                    }),
                    `${mod.name || mod.id}${mod.namespace ? ` [${mod.namespace}]` : ''} (로어북 ${mod.lorebook?.length ?? 0}개)`
                  )
                )
              )
            )
          );
        }

        for (const mod of state.modules) {
          const opts = moduleOptions(state, mod);
          const profile = moduleRuntimeProfile(mod);
          body.appendChild(
            h(doc, 'div', { style: 'border:1px solid var(--rh-border);border-radius:8px;padding:8px;background:var(--rh-surface);display:flex;flex-direction:column;gap:6px;' },
              h(doc, 'div', { style: 'font-size:12px;font-weight:700;' }, `${mod.name} (로어북 ${mod.lorebook.length}개)`),
              profile.blocking.length > 0 && h(doc, 'div', { class: 'rh-banner' }, `미지원 요청 처리: ${profile.blocking.join(', ')}`),
              h(doc, 'div', { class: 'rh-checks' },
                h(doc, 'label', {},
                  h(doc, 'input', {
                    type: 'checkbox',
                    checked: opts.relaxConditions,
                    onchange: async (e) => {
                      state.moduleOptions[mod.id] = { ...opts, relaxConditions: Boolean(e.target.checked) };
                      await persistAndRender();
                    },
                  }),
                  '@@/미지원 조건 완화(거짓 처리 후 본문 포함)'
                ),
                profile.blocking.length > 0 && h(doc, 'label', {},
                  h(doc, 'input', {
                    type: 'checkbox',
                    checked: opts.skipRuntime,
                    onchange: async (e) => {
                      state.moduleOptions[mod.id] = { ...opts, skipRuntime: Boolean(e.target.checked) };
                      await persistAndRender();
                    },
                  }),
                  '요청 관련 미지원 처리 제외'
                )
              )
            )
          );
        }
      } else if (state.pane === 'preview') {
        body.appendChild(
          h(doc, 'div', { class: 'rh-row' },
            h(doc, 'button', {
              class: 'rh-btn',
              onclick: async () => { await app.refreshPresetPreview(); app.render(); },
            }, '전송 내용 새로 계산')
          )
        );
        const preview = app.lastPresetPreview;
        if (!preview) {
          body.appendChild(h(doc, 'div', { style: 'font-size:12px;color:var(--rh-muted);' }, '전송 내용을 계산하는 중...'));
        } else {
          if (preview.issues?.length) {
            for (const issue of preview.issues) {
              body.appendChild(h(doc, 'div', { class: 'rh-banner error' }, issue));
            }
          }
          for (const note of preview.notes || []) {
            body.appendChild(h(doc, 'div', { style: 'font-size:11px;color:var(--rh-muted);' }, note));
          }
          const totalChars = (preview.messages || []).reduce((sum, m) => sum + String(m.content || '').length, 0);
          body.appendChild(
            h(doc, 'div', { style: 'font-size:12px;font-weight:700;' },
              `모드: ${preview.mode === 'preset' ? '프리셋 적용' : '직접 보내기'} · 메시지 ${preview.messages.length}개 · 총 ${totalChars.toLocaleString()}자`
            )
          );
          for (const [idx, msg] of (preview.messages || []).entries()) {
            body.appendChild(
              h(doc, 'details', { class: 'rh-preview-details' },
                h(doc, 'summary', {}, `${idx + 1}. [${msg.role}]${msg.cachePoint ? ' ⚡cache' : ''} (${String(msg.content).length.toLocaleString()}자)`),
                h(doc, 'pre', { class: 'rh-preview-pre' }, String(msg.content).slice(0, 3000) + (String(msg.content).length > 3000 ? '\n... (생략)' : ''))
              )
            );
          }
        }
      }

      return h(doc, 'div', { class: 'rh-settings-panel' }, modeBar, paneTabs, body);
    }

      __exports.renderPresetPanel = renderPresetPanel;

  },
  "src/ui.js"(__require, __exports) {
    const { VERSION, STORAGE_KEY, PRESET_STORAGE_KEY, CHAR_FIELD_META, SCREEN_LABELS } = __require("src/version.js");
    const { STYLES } = __require("src/style.js");
    const { FocusTracker, normalizeChipPos, MIN_DOCK_VIEWPORT_PX } = __require("src/focus-detector.js");
    const { HostAdapter } = __require("src/host-adapter.js");
    const { callRisuModel, parseAssistantReply, buildConversationMessages } = __require("src/llm.js");
    const { buildDiffPreview } = __require("src/text-edits.js");
    const { getQuickPromptsForContext } = __require("src/knowledge.js");
    const { newPresetState, validatePresetState, assembleRisuHelperMessages } = __require("src/preset-engine.js");
    const { renderPresetPanel } = __require("src/preset-ui.js");

    const DEFAULT_SETTINGS = {
      modelMode: 'model',
      timeoutSeconds: 120,
      maxHistoryTurns: 12,
      showFloatingChip: true,
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
        this.tracker.chipPos = normalizeChipPos(this.settings.floatingChipPos);
        const trackerStarted = await this.tracker.start().catch(() => false);
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
          { value: 'chat_note:', label: "채팅 · 작가의 노트 (Author's Note)" },
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
            chat_note: 'character',
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
            fieldKey: field || (
              kind === 'chat_note' ? 'note' :
              kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook' ? 'content' :
              kind === 'persona' ? 'personaPrompt' :
              null
            ),
            loreIndex: null,
            loreScope: kind === 'chat_lorebook' ? 'chat' : kind === 'module_lorebook' ? 'module' : kind === 'char_lorebook' ? 'character' : null,
            labelText: kind === 'char_field'
              ? (CHAR_FIELD_META[field]?.label || field)
              : kind === 'chat_note'
                ? '작가의 노트 (현재 채팅)'
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
            }, `되돌리기 (${this.adapter.undoStack.length})`)
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
            h(doc, 'details', { class: 'rh-preview-details', 'data-rh-details-key': 'active-source-preview' },
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

      __exports.RisuHelperApp = RisuHelperApp;

  },
  "src/main.js"(__require, __exports) {
    const { RisuHelperApp } = __require("src/ui.js");

    const api = typeof risuai !== 'undefined' ? risuai : globalThis.Risuai;
    if (api && typeof document !== 'undefined') {
      const app = new RisuHelperApp(api, document);
      app.init().catch((err) => {
        console.error('[RisuHelper] 초기화 실패:', err);
        if (document.body) {
          document.body.textContent = `RisuHelper를 시작하지 못했습니다: ${err?.message || err}`;
        }
      });
    }

  }
  };
  const __cache = Object.create(null);
  function __require(id) {
    if (__cache[id]) return __cache[id].exports;
    const factory = __modules[id];
    if (!factory) throw new Error('[RisuHelper] Missing module: ' + id);
    const mod = { exports: {} };
    __cache[id] = mod;
    factory(__require, mod.exports);
    return mod.exports;
  }
  __require("src/main.js");
})();
