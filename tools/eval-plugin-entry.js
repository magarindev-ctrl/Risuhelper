// SPDX-License-Identifier: GPL-3.0-only
// Standalone temporary RisuAI Plugin API v3 entry point that runs the 20-scenario
// RisuHelper evaluation inside RisuAI using the user's already-configured model/submodel.
// Never reads or writes real user characters, chats, or database settings.

import { VERSION } from '../src/version.js';
import { callRisuModel } from '../src/llm.js';
import { EVAL_SCENARIOS, runEvalScenario } from './eval-scenarios.mjs';
import { summarizeResults, renderMarkdownReport } from './eval-report.mjs';

const EVAL_CSS = `
:root {
  --rhe-bg: #11141d;
  --rhe-panel: #171b26;
  --rhe-surface: #1f2534;
  --rhe-border: #2f384e;
  --rhe-text: #eef1f7;
  --rhe-muted: #9aa4b8;
  --rhe-accent: #7c5cff;
  --rhe-accent-hover: #6a48f5;
  --rhe-ok: #10b981;
  --rhe-ok-bg: rgba(16, 185, 129, 0.14);
  --rhe-err: #ef4444;
  --rhe-err-bg: rgba(239, 68, 68, 0.14);
}
:root[data-rhe-theme="light"] {
  --rhe-bg: #f4f6fa;
  --rhe-panel: #ffffff;
  --rhe-surface: #eef1f7;
  --rhe-border: #d5dbe6;
  --rhe-text: #181c24;
  --rhe-muted: #5a6477;
  --rhe-accent: #2563eb;
  --rhe-accent-hover: #1d4ed8;
  --rhe-ok: #059669;
  --rhe-ok-bg: #dcfce7;
  --rhe-err: #dc2626;
  --rhe-err-bg: #fee2e2;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  color: var(--rhe-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif;
  font-size: 13.5px;
  line-height: 1.5;
  overflow: hidden;
}
.rhe-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(10, 12, 20, 0.58);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.rhe-modal {
  width: min(760px, 100%);
  max-height: 92vh;
  background: var(--rhe-panel);
  border: 1px solid var(--rhe-border);
  border-radius: 14px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.rhe-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  background: var(--rhe-bg);
  border-bottom: 1px solid var(--rhe-border);
  flex-shrink: 0;
}
.rhe-title {
  font-size: 14.5px;
  font-weight: 800;
}
.rhe-body {
  padding: 12px 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}
.rhe-banner {
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--rhe-surface);
  border: 1px solid var(--rhe-border);
  font-size: 12px;
  color: var(--rhe-muted);
}
.rhe-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.rhe-field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--rhe-muted);
}
.rhe-select {
  background: var(--rhe-surface);
  color: var(--rhe-text);
  border: 1px solid var(--rhe-border);
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 12.5px;
}
.rhe-btn {
  appearance: none;
  border: 1px solid var(--rhe-border);
  background: var(--rhe-surface);
  color: var(--rhe-text);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
.rhe-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.rhe-btn.primary {
  background: var(--rhe-accent);
  border-color: var(--rhe-accent);
  color: #fff;
}
.rhe-btn.primary:hover:not(:disabled) {
  background: var(--rhe-accent-hover);
}
.rhe-btn.danger {
  background: var(--rhe-err-bg);
  border-color: var(--rhe-err);
  color: var(--rhe-err);
}
.rhe-btn.ok {
  background: var(--rhe-ok-bg);
  border-color: var(--rhe-ok);
  color: var(--rhe-ok);
}
.rhe-progress-wrap {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.rhe-progress-track {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: var(--rhe-surface);
  overflow: hidden;
  border: 1px solid var(--rhe-border);
}
.rhe-progress-bar {
  height: 100%;
  background: var(--rhe-accent);
  transition: width 160ms ease;
}
.rhe-status {
  font-size: 12px;
  color: var(--rhe-muted);
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
}
.rhe-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}
.rhe-item {
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--rhe-border);
  background: var(--rhe-bg);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.rhe-item.pass {
  border-color: rgba(16, 185, 129, 0.4);
}
.rhe-item.fail {
  border-color: rgba(239, 68, 68, 0.5);
  background: var(--rhe-err-bg);
}
.rhe-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.rhe-item-issue {
  font-size: 11.5px;
  color: var(--rhe-err);
}
.rhe-report-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rhe-textarea {
  width: 100%;
  min-height: 170px;
  resize: vertical;
  background: var(--rhe-bg);
  color: var(--rhe-text);
  border: 1px solid var(--rhe-border);
  border-radius: 8px;
  padding: 9px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.45;
}
.rhe-toast {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--rhe-accent);
  color: #fff;
  font-size: 12.5px;
  font-weight: 700;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
`;

function h(doc, tag, props = {}, ...children) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked' || k === 'disabled' || k === 'value' || k === 'selected' || k === 'readOnly') el[k] = v;
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

class RisuHelperEvalApp {
  constructor(api, doc) {
    this.api = api;
    this.doc = doc;
    this.isOpen = false;
    this.running = false;
    this.cancelled = false;
    this.currentJob = null;
    this.modelMode = 'model';
    this.runs = 1;
    this.timeoutSeconds = 120;
    this.results = [];
    this.totalJobs = EVAL_SCENARIOS.length;
    this.currentLabel = '';
    this.reportMarkdown = '';
    this.summary = null;
    this.toastText = '';
    this.toastTimer = null;
    this.registeredIds = [];
  }

  showToast(text) {
    this.toastText = text;
    this.render();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastText = '';
      this.render();
    }, 2600);
  }

  mountStyles() {
    if (this.doc.getElementById('rhe-eval-style')) return;
    const style = this.doc.createElement('style');
    style.id = 'rhe-eval-style';
    style.textContent = EVAL_CSS;
    this.doc.head.appendChild(style);
  }

  async syncTheme() {
    try {
      if (typeof this.api?.getColorScheme === 'function') {
        const res = await this.api.getColorScheme();
        const type = res?.scheme?.type === 'light' ? 'light' : 'dark';
        this.doc.documentElement.setAttribute('data-rhe-theme', type);
      }
    } catch {}
  }

  async init() {
    this.mountStyles();
    await this.syncTheme();
    if (typeof this.api?.registerButton === 'function') {
      try {
        const btn = await this.api.registerButton({
          name: `RisuHelper ${EVAL_SCENARIOS.length}문항 평가`,
          icon: '🧪',
          iconType: 'none',
          location: 'hamburger',
          id: 'risuhelper-eval-hamburger',
        }, () => this.open());
        if (btn?.id) this.registeredIds.push(btn.id);
      } catch {}
    }
    if (typeof this.api?.registerSetting === 'function') {
      try {
        const s = await this.api.registerSetting(
          `RisuHelper ${EVAL_SCENARIOS.length}문항 평가 (임시)`,
          () => this.open(),
          '🧪',
          'none',
          'risuhelper-eval-setting'
        );
        if (s?.id) this.registeredIds.push(s.id);
      } catch {}
    }
  }

  async open() {
    this.isOpen = true;
    await this.syncTheme();
    if (typeof this.api?.showContainer === 'function') {
      await this.api.showContainer('fullscreen');
    }
    this.render();
  }

  async close() {
    this.stop();
    this.isOpen = false;
    if (typeof this.api?.hideContainer === 'function') {
      await this.api.hideContainer();
    }
  }

  stop() {
    this.cancelled = true;
    this.currentJob?.stop?.('사용자가 평가를 중단했습니다.');
  }

  async copyReport() {
    if (!this.reportMarkdown) return;
    const text = this.reportMarkdown;
    try {
      const nav = this.doc.defaultView?.navigator || globalThis.navigator;
      if (nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(text);
        this.showToast('📋 평가 리포트를 클립보드에 복사했습니다!');
        return;
      }
    } catch {}
    try {
      const ta = this.doc.querySelector('.rhe-textarea');
      if (ta && typeof ta.select === 'function') {
        ta.select();
        this.doc.execCommand?.('copy');
        this.showToast('📋 평가 리포트를 복사했습니다!');
        return;
      }
    } catch {}
    this.showToast('아래 리포트 텍스트 박스를 길게 눌러 직접 복사해 주세요.');
  }

  downloadReport() {
    if (!this.reportMarkdown) return;
    try {
      const blob = new Blob([this.reportMarkdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = this.doc.createElement('a');
      a.href = url;
      a.download = `risuhelper-eval-${this.modelMode}-${new Date().toISOString().slice(0, 10)}.md`;
      this.doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      this.showToast('💾 마크다운 리포트 파일을 저장했습니다.');
    } catch (err) {
      this.showToast(`파일 저장 실패: ${err.message}`);
    }
  }

  async startEval() {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.results = [];
    this.reportMarkdown = '';
    this.summary = null;
    this.totalJobs = EVAL_SCENARIOS.length * this.runs;
    this.currentLabel = '시작 중...';
    this.render();

    let platform = '';
    try {
      if (typeof this.api?.getRuntimeInfo === 'function') {
        const info = await this.api.getRuntimeInfo();
        platform = info?.platform ? `${info.platform}/${info.saveMethod || ''}`.replace(/\/$/, '') : '';
      }
    } catch {}

    const callModel = async (messages) => {
      const job = { cancelled: false };
      this.currentJob = job;
      try {
        const text = await callRisuModel(
          this.api,
          messages,
          { mode: this.modelMode, timeoutSeconds: this.timeoutSeconds },
          job
        );
        return { text, usage: null, finishReason: '', truncated: false };
      } finally {
        if (this.currentJob === job) this.currentJob = null;
      }
    };

    try {
      for (let runIndex = 1; runIndex <= this.runs; runIndex++) {
        for (const sc of EVAL_SCENARIOS) {
          if (this.cancelled) break;
          const idx = this.results.length + 1;
          this.currentLabel = `[${idx}/${this.totalJobs}] ${sc.id} — ${sc.title}`;
          this.render();

          const res = await runEvalScenario(sc, { callModel });
          res.runIndex = runIndex;
          if (this.cancelled && res.failureCategory === 'modelError') break;
          this.results.push(res);
          this.render();
        }
        if (this.cancelled) break;
      }
    } finally {
      this.running = false;
      this.currentJob = null;
      if (this.results.length > 0) {
        this.summary = summarizeResults(this.results, {
          mode: this.cancelled ? 'risuai-in-app (중단됨)' : 'risuai-in-app',
          provider: 'risuai',
          model: this.modelMode,
          modelMode: this.modelMode,
          platform,
          runs: this.runs,
          timestamp: new Date().toISOString(),
        });
        this.reportMarkdown = renderMarkdownReport(this.results, this.summary);
        this.currentLabel = this.cancelled
          ? `중단됨 (${this.results.length}/${this.totalJobs} 완료 · ${this.summary.passed}/${this.summary.total} 통과)`
          : `완료! ${this.summary.passed}/${this.summary.total} 통과 (${this.summary.passRate}%)`;
      } else {
        this.currentLabel = '중단되었습니다.';
      }
      this.render();
    }
  }

  render() {
    const doc = this.doc;
    const prevListScroll = doc.querySelector('.rhe-list')?.scrollTop ?? null;
    doc.body.textContent = '';

    const doneCount = this.results.length;
    const passedCount = this.results.filter(r => r.ok).length;
    const pct = this.totalJobs > 0 ? Math.min(100, Math.round((doneCount / this.totalJobs) * 100)) : 0;

    const scCount = EVAL_SCENARIOS.length;
    const modal = h(doc, 'section', {
      class: 'rhe-modal',
      onclick: (e) => e.stopPropagation(),
    },
      h(doc, 'header', { class: 'rhe-header' },
        h(doc, 'div', { class: 'rhe-title' }, `🧪 RisuHelper ${scCount}문항 실모델 평가기 (v${VERSION} · 임시)`),
        h(doc, 'button', { class: 'rhe-btn', onclick: () => this.close() }, '닫기')
      ),
      h(doc, 'div', { class: 'rhe-body' },
        h(doc, 'div', { class: 'rhe-banner' },
          '실제 내 캐릭터·채팅·설정은 절대 수정하지 않습니다. 가상 캐릭터 "아리아"로 격리 실행되며 현재 RisuAI에 연결된 모델(runLLMModel)만 호출합니다. 평가를 마치고 리포트를 복사한 뒤 이 임시 플러그인은 삭제하셔도 됩니다.'
        ),
        h(doc, 'div', { class: 'rhe-controls' },
          h(doc, 'label', { class: 'rhe-field' },
            '모델',
            h(doc, 'select', {
              class: 'rhe-select',
              disabled: this.running,
              onchange: (e) => { this.modelMode = e.target.value; },
            },
              h(doc, 'option', { value: 'model', selected: this.modelMode === 'model' }, '메인 모델 (model)'),
              h(doc, 'option', { value: 'submodel', selected: this.modelMode === 'submodel' }, '보조 모델 (submodel)'),
              h(doc, 'option', { value: 'otherAx', selected: this.modelMode === 'otherAx' }, '기타 보조 모델 (otherAx)')
            )
          ),
          h(doc, 'label', { class: 'rhe-field' },
            '반복',
            h(doc, 'select', {
              class: 'rhe-select',
              disabled: this.running,
              onchange: (e) => {
                this.runs = Number(e.target.value) || 1;
                this.totalJobs = EVAL_SCENARIOS.length * this.runs;
              },
            },
              h(doc, 'option', { value: '1', selected: this.runs === 1 }, `1회 (${scCount}건)`),
              h(doc, 'option', { value: '2', selected: this.runs === 2 }, `2회 (${scCount * 2}건)`),
              h(doc, 'option', { value: '3', selected: this.runs === 3 }, `3회 (${scCount * 3}건)`)
            )
          ),
          h(doc, 'label', { class: 'rhe-field' },
            '대기 제한',
            h(doc, 'select', {
              class: 'rhe-select',
              disabled: this.running,
              onchange: (e) => { this.timeoutSeconds = Number(e.target.value) || 120; },
            },
              h(doc, 'option', { value: '60', selected: this.timeoutSeconds === 60 }, '60초'),
              h(doc, 'option', { value: '120', selected: this.timeoutSeconds === 120 }, '120초'),
              h(doc, 'option', { value: '180', selected: this.timeoutSeconds === 180 }, '180초')
            )
          ),
          this.running
            ? h(doc, 'button', { class: 'rhe-btn danger', onclick: () => this.stop() }, '■ 중단')
            : h(doc, 'button', { class: 'rhe-btn primary', onclick: () => this.startEval() }, `▶ ${scCount}문항 평가 시작`)
        ),
        (this.running || doneCount > 0) && h(doc, 'div', { class: 'rhe-progress-wrap' },
          h(doc, 'div', { class: 'rhe-progress-track' },
            h(doc, 'div', { class: 'rhe-progress-bar', style: `width:${pct}%;` })
          ),
          h(doc, 'div', { class: 'rhe-status' },
            h(doc, 'span', {}, this.currentLabel || '준비됨'),
            h(doc, 'span', {}, `통과 ${passedCount}/${doneCount} (${doneCount ? Math.round((passedCount / doneCount) * 100) : 0}%)`)
          )
        ),
        doneCount > 0 && h(doc, 'div', { class: 'rhe-list' },
          ...this.results.map((r, i) =>
            h(doc, 'div', { class: `rhe-item ${r.ok ? 'pass' : 'fail'}` },
              h(doc, 'div', { class: 'rhe-item-top' },
                h(doc, 'span', {}, `${i + 1}. ${r.ok ? '✅' : '❌'} ${r.id}${this.runs > 1 ? ` (#${r.runIndex})` : ''}`),
                h(doc, 'span', { style: 'color:var(--rhe-muted);font-size:11px;' },
                  `${r.ok ? 'PASS' : r.failureCategory} · ${r.proposalActions.join(', ') || '없음'} · ${r.latencyMs}ms`)
              ),
              ...r.issues.map(issue => h(doc, 'div', { class: 'rhe-item-issue' }, `• ${issue}`))
            )
          )
        ),
        this.reportMarkdown && h(doc, 'div', { class: 'rhe-report-box' },
          h(doc, 'div', { class: 'rhe-controls' },
            h(doc, 'button', { class: 'rhe-btn ok', onclick: () => this.copyReport() }, '📋 리포트 복사'),
            h(doc, 'button', { class: 'rhe-btn', onclick: () => this.downloadReport() }, '💾 .md 파일 저장')
          ),
          h(doc, 'textarea', { class: 'rhe-textarea', readOnly: true, value: this.reportMarkdown })
        )
      )
    );

    const backdrop = h(doc, 'div', {
      class: 'rhe-backdrop',
      onclick: () => { if (!this.running) this.close(); },
    }, modal);
    doc.body.appendChild(backdrop);

    if (this.toastText) {
      doc.body.appendChild(h(doc, 'div', { class: 'rhe-toast' }, this.toastText));
    }

    if (prevListScroll !== null) {
      const listEl = doc.querySelector('.rhe-list');
      if (listEl) listEl.scrollTop = listEl.scrollHeight || prevListScroll;
    }
  }

  async destroy() {
    this.stop();
    clearTimeout(this.toastTimer);
    if (typeof this.api?.unregisterUIPart === 'function') {
      for (const id of this.registeredIds) {
        try { await this.api.unregisterUIPart(id); } catch {}
      }
    }
    this.registeredIds = [];
  }
}

(async () => {
  const api = globalThis.Risuai || globalThis.risuai || (typeof window !== 'undefined' && (window.Risuai || window.risuai));
  if (!api || typeof document === 'undefined') return;
  const app = new RisuHelperEvalApp(api, document);
  await app.init();
  if (typeof api.onUnload === 'function') {
    await api.onUnload(() => app.destroy());
  }
})();
