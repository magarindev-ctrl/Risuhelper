// SPDX-License-Identifier: GPL-3.0-only
// Preset configuration & preview UI panel for RisuHelper (direct send vs preset mode).

import { decodePreset, normalizePreset, PRESET_LIMIT } from './preset-format.js';
import { newPresetState, validatePresetState, toggleDefinitions, BLOCK_TYPES, moduleReferences } from './preset-engine.js';
import { toggleDefault } from './preset-v2.js';
import { activeModules, moduleOptions, moduleRuntimeProfile, readInstalledModules, selectInstalledModules } from './preset-modules.js';

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

function renderToggleNodes(doc, nodes, state, onChange) {
  const out = [];
  for (const node of nodes) {
    if (node.type === 'divider') {
      out.push(h(doc, 'hr', { style: 'border:none;border-top:1px solid var(--rh-border);margin:6px 0;' }));
    } else if (node.type === 'caption') {
      out.push(h(doc, 'div', { style: 'font-size:11px;color:var(--rh-muted);' }, node.label));
    } else if (node.type === 'group') {
      out.push(
        h(doc, 'details', { class: 'rh-preview-details', open: true },
          h(doc, 'summary', {}, node.label || '그룹'),
          h(doc, 'div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px;' },
            ...renderToggleNodes(doc, node.children || [], state, onChange)
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

  const body = h(doc, 'div', { style: 'display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;' });

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
        for (const nodeEl of renderToggleNodes(doc, items, state, () => { persistAndRender(); })) {
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
        h(doc, 'details', { class: 'rh-preview-details', open: true },
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

export { renderPresetPanel };
