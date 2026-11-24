// Minimal DOM stand-in for booting the built plugin bundle in tests.

function createMockDocument() {
  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.className = '';
      this.id = '';
      this.value = '';
      this.checked = false;
      this.disabled = false;
      this.selected = false;
      this.attributes = {};
      this.style = {};
      this.children = [];
      this.listeners = new Map();
      this._textContent = '';
    }
    set textContent(v) {
      this._textContent = String(v ?? '');
      this.children = [];
    }
    get textContent() {
      return this._textContent + this.children.map(c => c.textContent || '').join('');
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'id') this.id = String(v);
      if (k === 'class') this.className = String(v);
    }
    getAttribute(k) { return this.attributes[k] ?? null; }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    remove() {}
    click() {
      for (const fn of this.listeners.get('click') || []) {
        fn({ stopPropagation() {}, preventDefault() {}, target: this });
      }
    }
    querySelector(selector) {
      const wantClass = selector.startsWith('.') ? selector.slice(1) : null;
      const walk = (node) => {
        for (const c of node.children || []) {
          if (wantClass && String(c.className || '').split(/\s+/).includes(wantClass)) return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    }
  }

  const head = new MockElement('head');
  const body = new MockElement('body');
  const documentElement = new MockElement('html');
  documentElement.appendChild(head);
  documentElement.appendChild(body);
  const docListeners = new Map();

  return {
    head,
    body,
    documentElement,
    defaultView: null,
    createElement(tag) { return new MockElement(tag); },
    createTextNode(text) { return { textContent: String(text), children: [] }; },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(type, event = {}) {
      for (const fn of [...(docListeners.get(type) || [])]) {
        fn({ stopPropagation() {}, preventDefault() {}, ...event });
      }
    },
    getElementById(id) {
      const walk = (node) => {
        for (const c of node.children || []) {
          if (c.id === id) return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(documentElement);
    },
    querySelector(sel) { return body.querySelector(sel); },
  };
}

export { createMockDocument };
