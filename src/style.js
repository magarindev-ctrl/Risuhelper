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

export { STYLES };
