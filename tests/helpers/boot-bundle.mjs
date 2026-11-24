// Boots dist/risuhelper.js inside a vm sandbox with a mock Plugin v3 host.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createMockDocument } from './mock-document.mjs';

const BUNDLE_PATH = process.env.RH_BUNDLE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'risuhelper.js');
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
    async setItem(key, value) { data[key] = String(value); },
  };
}

/**
 * @param {object} opts.state    mutable host state: { character }
 * @param {Function} opts.runLLMModel
 * @param {object} [opts.storage] shared pluginStorage (to simulate a reload)
 */
async function bootBundle({ state, runLLMModel, storage = createMemoryStorage() }) {
  const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
  const doc = createMockDocument();
  const registeredButtons = [];
  let unloadHandler = null;
  const risuai = {
    pluginStorage: storage,
    async getColorScheme() { return { scheme: { type: 'dark' } }; },
    async registerButton(meta, cb) { registeredButtons.push({ meta, cb }); return { id: meta.id }; },
    async registerSetting(_name, _cb, _icon, _type, id) { return { id }; },
    async unregisterUIPart() {},
    async onUnload(fn) { unloadHandler = fn; },
    async showContainer() {},
    async hideContainer() {},
    async getCharacter() { return structuredClone(state.character); },
    async setCharacter(c) { state.character = structuredClone(c); },
    async getCurrentCharacterIndex() { return 0; },
    async getCurrentChatIndex() { return Number.isInteger(state.chatIndex) ? state.chatIndex : 0; },
    async getRootDocument() { return null; },
    runLLMModel,
  };
  const sandbox = {
    risuai, document: doc, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, Int32Array,
    DataView, URL, Blob, atob, crypto, DecompressionStream, structuredClone, ReadableStream,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'dist/risuhelper.js' });
  await tick();
  registeredButtons[0].cb(); // open the panel
  await tick();

  const findAll = (pred) => {
    const out = [];
    const walk = (node) => {
      if (pred(node)) out.push(node);
      for (const c of node.children || []) walk(c);
    };
    walk(doc.body);
    return out;
  };
  const buttons = (matcher) => findAll(n => n.tagName === 'BUTTON' && (matcher instanceof RegExp ? matcher.test(n.textContent) : n.textContent === matcher));
  const selectTarget = async (value) => {
    const selectEl = findAll(n => n.tagName === 'SELECT')[0];
    selectEl.value = value;
    for (const fn of selectEl.listeners.get('change') || []) await fn({ target: selectEl });
    await tick(10);
  };
  /** Sets a <select> found by class name (e.g. the reference-chat picker). */
  const selectByClass = async (className, value) => {
    const selectEl = findAll(n => n.tagName === 'SELECT' && String(n.className || '').split(/\s+/).includes(className))[0];
    if (!selectEl) throw new Error(`select not found: .${className}`);
    selectEl.value = value;
    for (const fn of selectEl.listeners.get('change') || []) await fn({ target: selectEl });
    await tick(10);
  };
  const send = async (text) => {
    doc.querySelector('.rh-composer-input').value = text;
    buttons('전송')[0].click();
    await tick(40);
  };
  const click = async (matcher, index = 0) => {
    const btn = buttons(matcher)[index];
    if (!btn) throw new Error(`button not found: ${matcher}`);
    btn.click();
    await tick(40);
  };
  const bodyText = () => doc.body.textContent;
  /** The in-panel confirmation popup, or null while none is open. */
  const dialog = () => findAll(n => String(n.className || '').split(/\s+/).includes('rh-modal'))[0] || null;
  /** Answers the open confirmation popup: `true` presses the confirm button, `false` presses 취소. */
  const answerDialog = async (accept = true) => {
    const box = dialog();
    if (!box) throw new Error('no confirmation popup is open');
    const wanted = accept ? 'rh-modal-confirm' : 'rh-modal-cancel';
    const btn = findAll(n => n.tagName === 'BUTTON' && String(n.className || '').split(/\s+/).includes(wanted))[0];
    if (!btn) throw new Error(`popup button not found: ${wanted}`);
    btn.click();
    await tick(40);
  };
  /** Clicks a button that asks for confirmation first, then confirms. */
  const clickConfirm = async (matcher, index = 0) => {
    await click(matcher, index);
    await answerDialog(true);
  };
  /** Polls until `predicate()` is truthy (deterministic under load, unlike fixed sleeps). */
  const waitFor = async (predicate, label = 'condition', timeoutMs = 5000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (predicate()) return;
      await tick(10);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  /** Waits until start-up work has stopped re-rendering the panel. */
  const settle = async (quietMs = 200) => {
    let last = doc.querySelector('.rh-composer-input');
    let quietSince = Date.now();
    while (Date.now() - quietSince < quietMs) {
      await tick(20);
      const cur = doc.querySelector('.rh-composer-input');
      if (cur !== last) { last = cur; quietSince = Date.now(); }
    }
  };
  const unload = async () => { if (unloadHandler) await unloadHandler(); };
  return { doc, storage, findAll, buttons, selectTarget, selectByClass, send, click, clickConfirm, dialog, answerDialog, bodyText, tick, waitFor, settle, unload };
}

const proposalBlock = (obj) => '```risuhelper-proposal\n' + JSON.stringify(obj) + '\n```';

export { bootBundle, createMemoryStorage, proposalBlock, tick };
