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
  --rh-strong: #ffffff;
  --rh-code-inline-bg: rgba(92, 141, 255, 0.14);
  --rh-code-inline-border: rgba(92, 141, 255, 0.30);
  --rh-code-inline-text: #93c5fd;
  --rh-cbs-bg: rgba(244, 114, 182, 0.14);
  --rh-cbs-border: rgba(244, 114, 182, 0.32);
  --rh-cbs-text: #f9a8d4;
  --rh-syn-kw: #c084fc;
  --rh-syn-str: #86efac;
  --rh-syn-num: #fbbf24;
  --rh-syn-cmt: #737e95;
  --rh-syn-fn: #60a5fa;
  --rh-syn-op: #f472b6;
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
  --rh-strong: #0f172a;
  --rh-code-inline-bg: rgba(37, 99, 235, 0.09);
  --rh-code-inline-border: rgba(37, 99, 235, 0.24);
  --rh-code-inline-text: #1d4ed8;
  --rh-cbs-bg: rgba(190, 24, 93, 0.08);
  --rh-cbs-border: rgba(190, 24, 93, 0.24);
  --rh-cbs-text: #9d174d;
  --rh-syn-kw: #7c3aed;
  --rh-syn-str: #15803d;
  --rh-syn-num: #b45309;
  --rh-syn-cmt: #64748b;
  --rh-syn-fn: #1d4ed8;
  --rh-syn-op: #be185d;
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

.rh-btn.ok {
  background: var(--rh-diff-add-bg);
  border-color: var(--rh-ok);
  color: var(--rh-diff-add-text);
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
  border-radius: 12px;
  border-bottom-left-radius: 4px;
  width: 100%;
  max-width: 100%;
  white-space: normal;
  padding: 0;
  line-height: 1.62;
  overflow: hidden;
}

.rh-msg-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 11px;
  background: var(--rh-bg);
  border-bottom: 1px solid var(--rh-border);
  font-size: 11px;
  color: var(--rh-muted);
}

.rh-msg-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  color: var(--rh-muted);
}

.rh-streaming-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--rh-accent);
  animation: rh-pulse 1.1s ease-in-out infinite;
}

@keyframes rh-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}

.rh-msg-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.rh-msg-act {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--rh-muted);
  border-radius: 6px;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--rh-font);
  cursor: pointer;
}

.rh-msg-act:hover {
  background: var(--rh-surface);
  border-color: var(--rh-border);
  color: var(--rh-text);
}

.rh-msg-act.active {
  background: var(--rh-code-inline-bg);
  border-color: var(--rh-code-inline-border);
  color: var(--rh-code-inline-text);
}

.rh-msg-body {
  padding: 11px 14px;
}

.rh-raw-pre {
  margin: 0;
  padding: 10px 12px;
  background: var(--rh-bg);
  border: 1px solid var(--rh-border);
  border-radius: 8px;
  font-family: var(--rh-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--rh-text);
}

.rh-md {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rh-md-p {
  margin: 0;
  color: var(--rh-text);
}

.rh-md-h1,
.rh-md-h2,
.rh-md-h3,
.rh-md-h4,
.rh-md-h5,
.rh-md-h6 {
  margin: 6px 0 2px;
  font-weight: 700;
  line-height: 1.35;
  color: var(--rh-strong);
}

.rh-md > .rh-md-h1:first-child,
.rh-md > .rh-md-h2:first-child,
.rh-md > .rh-md-h3:first-child,
.rh-md > .rh-md-h4:first-child,
.rh-md > .rh-md-h5:first-child,
.rh-md > .rh-md-h6:first-child {
  margin-top: 0;
}

.rh-md-h1 {
  font-size: 15.5px;
  padding-bottom: 5px;
  border-bottom: 1px solid var(--rh-border);
}

.rh-md-h2 {
  font-size: 14.5px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--rh-border);
  color: var(--rh-accent);
}

.rh-md-h3 {
  font-size: 13.5px;
  color: var(--rh-strong);
}

.rh-md-h4,
.rh-md-h5,
.rh-md-h6 {
  font-size: 12.5px;
  color: var(--rh-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.rh-md-strong {
  font-weight: 700;
  color: var(--rh-strong);
}

.rh-md-em {
  font-style: italic;
  color: var(--rh-text);
}

.rh-md-del {
  text-decoration: line-through;
  color: var(--rh-muted);
}

.rh-md-code {
  display: inline;
  padding: 1px 5px;
  margin: 0 1px;
  border-radius: 5px;
  background: var(--rh-code-inline-bg);
  border: 1px solid var(--rh-code-inline-border);
  color: var(--rh-code-inline-text);
  font-family: var(--rh-mono);
  font-size: 12px;
  word-break: break-word;
}

.rh-md-cbs {
  display: inline;
  padding: 1px 5px;
  margin: 0 1px;
  border-radius: 5px;
  background: var(--rh-cbs-bg);
  border: 1px solid var(--rh-cbs-border);
  color: var(--rh-cbs-text);
  font-family: var(--rh-mono);
  font-size: 11.5px;
  font-weight: 600;
}

.rh-md-link {
  color: var(--rh-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.rh-md-link:hover {
  color: var(--rh-accent-hover);
}

.rh-md-hr {
  border: none;
  border-top: 1px solid var(--rh-border);
  margin: 4px 0;
}

.rh-md-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rh-md-list.nested {
  margin-top: 4px;
}

.rh-md-li {
  line-height: 1.55;
}

.rh-md-li::marker {
  color: var(--rh-accent);
  font-weight: 600;
}

.rh-md-li.task {
  list-style: none;
  margin-left: -18px;
  display: flex;
  align-items: flex-start;
  gap: 7px;
}

.rh-md-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  margin-top: 3px;
  border-radius: 4px;
  border: 1px solid var(--rh-border);
  background: var(--rh-bg);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}

.rh-md-check.done {
  border-color: var(--rh-ok);
  background: rgba(52, 211, 153, 0.16);
  color: var(--rh-ok);
}

.rh-md-li.task.done .rh-md-task-text {
  color: var(--rh-muted);
}

.rh-md-quote {
  margin: 0;
  padding: 7px 11px;
  border-left: 3px solid var(--rh-accent);
  background: var(--rh-bg);
  border-radius: 0 8px 8px 0;
  color: var(--rh-muted);
}

.rh-md-callout {
  padding: 8px 11px;
  border-radius: 8px;
  border: 1px solid var(--rh-border);
  border-left-width: 3px;
  background: var(--rh-bg);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rh-md-callout-title {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.rh-md-callout.callout-note {
  border-left-color: var(--rh-accent);
}
.rh-md-callout.callout-note .rh-md-callout-title {
  color: var(--rh-accent);
}

.rh-md-callout.callout-tip {
  border-left-color: var(--rh-ok);
}
.rh-md-callout.callout-tip .rh-md-callout-title {
  color: var(--rh-ok);
}

.rh-md-callout.callout-important {
  border-left-color: var(--rh-syn-kw);
}
.rh-md-callout.callout-important .rh-md-callout-title {
  color: var(--rh-syn-kw);
}

.rh-md-callout.callout-warning {
  border-left-color: var(--rh-warn-border);
  background: var(--rh-warn-bg);
}
.rh-md-callout.callout-warning .rh-md-callout-title {
  color: var(--rh-warn-text);
}

.rh-md-callout.callout-caution {
  border-left-color: var(--rh-err-border);
  background: var(--rh-err-bg);
}
.rh-md-callout.callout-caution .rh-md-callout-title {
  color: var(--rh-err-text);
}

.rh-md-table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--rh-border);
  border-radius: 8px;
  background: var(--rh-bg);
}

.rh-md-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.rh-md-table th,
.rh-md-table td {
  padding: 6px 9px;
  border-bottom: 1px solid var(--rh-border);
  text-align: left;
  vertical-align: top;
}

.rh-md-table thead th {
  background: var(--rh-surface-2);
  color: var(--rh-strong);
  font-weight: 700;
  white-space: nowrap;
}

.rh-md-table tbody tr:last-child td {
  border-bottom: none;
}

.rh-md-table tbody tr:nth-child(even) {
  background: rgba(128, 128, 128, 0.05);
}

.rh-code-card {
  border: 1px solid var(--rh-border);
  border-radius: 10px;
  background: var(--rh-bg);
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.rh-code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  background: var(--rh-surface-2);
  border-bottom: 1px solid var(--rh-border);
}

.rh-code-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}

.rh-code-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--rh-muted);
  flex-shrink: 0;
}

.rh-code-dot.lang-lua { background: var(--rh-syn-fn); }
.rh-code-dot.lang-json,
.rh-code-dot.lang-js,
.rh-code-dot.lang-ts { background: var(--rh-syn-num); }
.rh-code-dot.lang-html,
.rh-code-dot.lang-css { background: var(--rh-syn-op); }
.rh-code-dot.lang-regex,
.rh-code-dot.lang-proposal { background: var(--rh-syn-kw); }
.rh-code-dot.lang-diff { background: var(--rh-syn-str); }

.rh-code-lang {
  font-family: var(--rh-mono);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--rh-muted);
  flex-shrink: 0;
}

.rh-code-lang.lang-lua { color: var(--rh-syn-fn); }
.rh-code-lang.lang-json,
.rh-code-lang.lang-js,
.rh-code-lang.lang-ts { color: var(--rh-syn-num); }
.rh-code-lang.lang-html,
.rh-code-lang.lang-css { color: var(--rh-syn-op); }
.rh-code-lang.lang-regex,
.rh-code-lang.lang-proposal { color: var(--rh-syn-kw); }
.rh-code-lang.lang-diff { color: var(--rh-syn-str); }

.rh-code-file {
  font-family: var(--rh-mono);
  font-size: 11px;
  color: var(--rh-text);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rh-code-lines {
  font-size: 10.5px;
  color: var(--rh-muted);
  opacity: 0.78;
  flex-shrink: 0;
}

.rh-code-copy {
  border: 1px solid var(--rh-border);
  background: var(--rh-surface);
  color: var(--rh-text);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--rh-font);
  cursor: pointer;
  flex-shrink: 0;
}

.rh-code-copy:hover {
  border-color: var(--rh-accent);
  color: var(--rh-accent);
}

.rh-code-grid {
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  position: relative;
}

.rh-code-single {
  overflow-x: auto;
}

.rh-code-gutter {
  position: sticky;
  left: 0;
  flex-shrink: 0;
  padding: 9px 8px 9px 10px;
  border-right: 1px solid var(--rh-border);
  background: var(--rh-bg);
  color: var(--rh-muted);
  font-family: var(--rh-mono);
  font-size: 11.5px;
  line-height: 1.55;
  text-align: right;
  white-space: pre;
  user-select: none;
  -webkit-user-select: none;
}

.rh-code-pre {
  margin: 0;
  padding: 9px 11px;
  flex: 1;
  min-width: 0;
  font-family: var(--rh-mono);
  font-size: 11.8px;
  line-height: 1.55;
  white-space: pre;
  color: var(--rh-text);
}

.rh-code-content {
  font-family: inherit;
}

.rh-tok-kw { color: var(--rh-syn-kw); font-weight: 600; }
.rh-tok-str { color: var(--rh-syn-str); }
.rh-tok-num { color: var(--rh-syn-num); }
.rh-tok-cmt { color: var(--rh-syn-cmt); font-style: italic; }
.rh-tok-fn { color: var(--rh-syn-fn); }
.rh-tok-op { color: var(--rh-syn-op); font-weight: 600; }
.rh-tok-add { color: var(--rh-diff-add-text); background: var(--rh-diff-add-bg); border-radius: 3px; padding: 0 3px; }
.rh-tok-del { color: var(--rh-diff-del-text); background: var(--rh-diff-del-bg); border-radius: 3px; padding: 0 3px; }

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
