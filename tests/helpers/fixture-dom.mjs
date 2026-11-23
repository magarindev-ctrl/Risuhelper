// Rebuilds a Plugin v3 SafeElement-shaped DOM from a recorded host snapshot
// (tools/capture-host-fixtures.cjs) so the detector runs against real RisuAI markup in CI.
// Mirrors the sandbox contract: async methods, no `.value`, getAttribute() limited to `x-*`.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'host-dom');

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseCompound(src) {
  const out = { tag: null, id: null, classes: [], attrs: [], focus: false };
  let rest = src;
  const tagMatch = rest.match(/^[a-zA-Z][\w-]*/);
  if (tagMatch) {
    out.tag = tagMatch[0].toLowerCase();
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest) {
    let m;
    if ((m = rest.match(/^#([\w-]+)/))) out.id = m[1];
    else if ((m = rest.match(/^\.([\w-]+)/))) out.classes.push(m[1]);
    else if ((m = rest.match(/^\[([\w-]+)(?:="([^"]*)")?\]/))) out.attrs.push({ name: m[1], value: m[2] });
    else if ((m = rest.match(/^:focus/))) out.focus = true;
    else throw new Error(`fixture-dom: unsupported selector part "${rest}" in "${src}"`);
    rest = rest.slice(m[0].length);
  }
  return out;
}

function parseSelectorList(selector) {
  return String(selector).split(',').map(part => part.trim().split(/\s+/).map(parseCompound));
}

class FixtureNode {
  constructor(raw, parent, doc) {
    this.tag = raw.t;
    this.attrs = raw.a || {};
    this.rect = raw.r || null;
    this.parent = parent;
    this.doc = doc;
    this.kids = [];
    this.textParts = [];
    for (const child of raw.n || []) {
      if (typeof child === 'string') {
        this.textParts.push(child);
      } else {
        const node = new FixtureNode(child, this, doc);
        this.kids.push(node);
        this.textParts.push(node);
      }
    }
  }

  _text() {
    return this.textParts.map(p => (typeof p === 'string' ? p : p._text())).join('');
  }

  _outer() {
    const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
    const inner = this.textParts.map(p => (typeof p === 'string' ? escapeAttr(p) : p._outer())).join('');
    return `<${this.tag}${attrs}>${inner}</${this.tag}>`;
  }

  _matchesCompound(c) {
    if (c.tag && c.tag !== this.tag) return false;
    if (c.id && this.attrs.id !== c.id) return false;
    const classList = String(this.attrs.class || '').split(/\s+/);
    for (const cls of c.classes) if (!classList.includes(cls)) return false;
    for (const a of c.attrs) {
      if (!Object.hasOwn(this.attrs, a.name)) return false;
      if (a.value !== undefined && this.attrs[a.name] !== a.value) return false;
    }
    if (c.focus && this.doc.focused !== this) return false;
    return true;
  }

  _matchesComplex(chain) {
    if (!this._matchesCompound(chain[chain.length - 1])) return false;
    let idx = chain.length - 2;
    let cur = this.parent;
    while (idx >= 0 && cur) {
      if (cur._matchesCompound(chain[idx])) idx--;
      cur = cur.parent;
    }
    return idx < 0;
  }

  _descendants(out = []) {
    for (const kid of this.kids) {
      out.push(kid);
      kid._descendants(out);
    }
    return out;
  }

  _query(selector) {
    const list = parseSelectorList(selector);
    return this._descendants().filter(node => list.some(chain => node._matchesComplex(chain)));
  }

  // --- SafeElement surface used by src/focus-detector.js ---
  async getOuterHTML() { return this._outer(); }
  async nodeName() { return this.tag.toUpperCase(); }
  async textContent() { return this._text(); }
  async innerText() { return this._text(); }
  async getClassName() { return String(this.attrs.class || ''); }
  async getParent() { return this.parent; }
  async getChildren() { return wrapList(this.kids); }
  async querySelector(selector) { return this._query(selector)[0] || null; }
  async querySelectorAll(selector) { return wrapList(this._query(selector)); }
  async matches(selector) { return parseSelectorList(selector).some(chain => this._matchesComplex(chain)); }
  async getAttribute(name) {
    if (!String(name).startsWith('x-')) throw new Error("Can only get attributes starting with 'x-' for security reasons.");
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }
  async getBoundingClientRect() {
    const [left, top, width, height] = this.rect || [0, 0, 0, 0];
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height };
  }
}

function wrapList(items) {
  return {
    async length() { return items.length; },
    async at(i) { return items[i] || null; },
  };
}

function listFixtures() {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs.readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.json.gz')).sort();
}

function loadFixture(fileName) {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(FIXTURE_DIR, fileName)));
  return JSON.parse(raw.toString('utf8'));
}

/**
 * Builds a SafeDocument-like root for a fixture and focuses the element at `fieldPath`
 * (child-element indexes from <html>), exactly as the host would have `:focus` set.
 */
function buildFixtureDocument(fixture, fieldPath) {
  const doc = { focused: null };
  const root = new FixtureNode(fixture.tree, null, doc);
  let cur = root;
  for (const idx of fieldPath) {
    cur = cur.kids[idx];
    if (!cur) throw new Error(`fixture-dom: field path ${JSON.stringify(fieldPath)} not found in ${fixture.screen}`);
  }
  doc.focused = cur;
  return root;
}

export { listFixtures, loadFixture, buildFixtureDocument };
