import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeCode, renderMarkdown } from '../src/markdown.js';

function createMiniDoc() {
  class Node {
    constructor(tag, text = null) {
      this.tagName = tag ? tag.toUpperCase() : '#TEXT';
      this.className = '';
      this.attributes = {};
      this.children = [];
      this.listeners = new Map();
      this._text = text;
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'class') this.className = String(v);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    click() {
      for (const fn of this.listeners.get('click') || []) {
        fn({ stopPropagation() {}, preventDefault() {} });
      }
    }
    get textContent() {
      if (this._text !== null) return this._text;
      return this.children.map(c => c.textContent).join('');
    }
  }
  return {
    createElement(tag) { return new Node(tag); },
    createTextNode(text) { return new Node(null, String(text)); },
  };
}

function findAll(root, pred) {
  const out = [];
  const walk = (n) => {
    if (pred(n)) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(root);
  return out;
}

test('renderMarkdown parses headings, inline emphasis, code, CBS macros, lists, tasks, tables, quotes, and callouts', () => {
  const doc = createMiniDoc();
  const host = doc.createElement('div');
  const md = [
    '## 캐릭터 설정 요약',
    '',
    '이 설명은 **핵심 성격**과 *서술 문체*, ~~구버전 문장~~, 그리고 `desc` 필드와 {{char}} 매크로를 정리합니다.',
    '수식 2 * 3 * 4 는 기울임으로 오탐되지 않습니다.',
    '',
    '- 일반 항목 1',
    '  - 중첩 항목 A',
    '- [x] 완료된 작업',
    '- [ ] 남은 작업',
    '',
    '> [!WARNING]',
    '> 기존 **V1 트리거**는 삭제됩니다.',
    '',
    '| 필드 | 역할 | 비고 |',
    '| :--- | :---: | ---: |',
    '| `desc` | 캐릭터 설명 | **필수** |',
    '| `chat.note` | 작가의 노트 | 선택 |',
    '',
    '---',
  ].join('\n');

  renderMarkdown(doc, host, md);

  const h2s = findAll(host, n => n.tagName === 'H2');
  assert.equal(h2s.length, 1);
  assert.equal(h2s[0].textContent, '캐릭터 설정 요약');

  const strongs = findAll(host, n => n.tagName === 'STRONG');
  assert.ok(strongs.some(s => s.textContent === '핵심 성격'));
  assert.ok(strongs.some(s => s.textContent === 'V1 트리거'));
  assert.ok(strongs.some(s => s.textContent === '필수'));

  const ems = findAll(host, n => n.tagName === 'EM');
  assert.equal(ems.length, 1);
  assert.equal(ems[0].textContent, '서술 문체');

  const dels = findAll(host, n => n.tagName === 'DEL');
  assert.equal(dels.length, 1);
  assert.equal(dels[0].textContent, '구버전 문장');

  const inlineCodes = findAll(host, n => n.tagName === 'CODE' && n.className === 'rh-md-code');
  assert.ok(inlineCodes.some(c => c.textContent === 'desc'));
  assert.ok(inlineCodes.some(c => c.textContent === 'chat.note'));

  const cbsSpans = findAll(host, n => n.className === 'rh-md-cbs');
  assert.equal(cbsSpans.length, 1);
  assert.equal(cbsSpans[0].textContent, '{{char}}');

  const nestedLists = findAll(host, n => n.className.includes('nested'));
  assert.equal(nestedLists.length, 1);

  const taskDone = findAll(host, n => n.className.includes('rh-md-li task done'));
  assert.equal(taskDone.length, 1);

  const callouts = findAll(host, n => n.className.includes('callout-warning'));
  assert.equal(callouts.length, 1);

  const tables = findAll(host, n => n.tagName === 'TABLE');
  assert.equal(tables.length, 1);
  const ths = findAll(tables[0], n => n.tagName === 'TH');
  assert.equal(ths.length, 3);
  assert.equal(ths[1].attributes.style, 'text-align:center;');
  assert.equal(ths[2].attributes.style, 'text-align:right;');

  const hrs = findAll(host, n => n.tagName === 'HR');
  assert.equal(hrs.length, 1);
});

test('renderMarkdown neutralizes raw HTML tags and blocks javascript: links while allowing https links', () => {
  const doc = createMiniDoc();
  const host = doc.createElement('div');
  const md = '안전한 [문서](https://example.com/docs) 및 위험한 [클릭](javascript:alert(1)) <script>alert(2)</script>';

  renderMarkdown(doc, host, md);

  const links = findAll(host, n => n.tagName === 'A');
  assert.equal(links.length, 1);
  assert.equal(links[0].attributes.href, 'https://example.com/docs');
  assert.equal(links[0].attributes.rel, 'noopener noreferrer');

  const scripts = findAll(host, n => n.tagName === 'SCRIPT');
  assert.equal(scripts.length, 0);
  assert.match(host.textContent, /<script>alert\(2\)<\/script>/);
  assert.match(host.textContent, /위험한 클릭/);
});

test('renderMarkdown renders syntax-highlighted code editor cards with gutter, copy button, and streaming unclosed fence support', () => {
  const doc = createMiniDoc();
  const host = doc.createElement('div');
  let copied = '';

  const md = [
    '```lua',
    '-- 상태창 업데이트',
    'function onOutput(id)',
    '  local hp = tonumber(getChatVar(id, "hp")) or 100',
    '  setChatVar(id, "hp", tostring(hp - 5))',
    'end',
    '```',
    '',
    '스트리밍 중 미완성 블록:',
    '```json',
    '{"temperature": 80, "enabled": true}',
  ].join('\n');

  renderMarkdown(doc, host, md, { onCopy: (t) => { copied = t; } });

  const cards = findAll(host, n => n.className === 'rh-code-card');
  assert.equal(cards.length, 2, 'should render both closed Lua block and streaming unclosed JSON block');

  // Lua card has 5-line gutter, syntax tokens, and working copy button
  const gutters = findAll(cards[0], n => n.className === 'rh-code-gutter');
  assert.equal(gutters.length, 1);
  assert.equal(gutters[0].textContent, '1\n2\n3\n4\n5');

  const kwTokens = findAll(cards[0], n => n.className === 'rh-tok-kw').map(n => n.textContent);
  const fnTokens = findAll(cards[0], n => n.className === 'rh-tok-fn').map(n => n.textContent);
  const cmtTokens = findAll(cards[0], n => n.className === 'rh-tok-cmt').map(n => n.textContent);
  assert.ok(kwTokens.includes('function'));
  assert.ok(kwTokens.includes('local'));
  assert.ok(kwTokens.includes('end'));
  assert.ok(fnTokens.includes('onOutput'));
  assert.ok(fnTokens.includes('getChatVar'));
  assert.ok(fnTokens.includes('setChatVar'));
  assert.ok(cmtTokens.some(c => c.includes('-- 상태창 업데이트')));

  const copyBtn = findAll(cards[0], n => n.className === 'rh-code-copy')[0];
  copyBtn.click();
  assert.match(copied, /^-- 상태창 업데이트\nfunction onOutput\(id\)/);

  // Single-line JSON card omits gutter and highlights keys, numbers, and booleans
  assert.equal(findAll(cards[1], n => n.className === 'rh-code-gutter').length, 0);
  assert.ok(findAll(cards[1], n => n.className === 'rh-tok-fn').some(n => n.textContent === '"temperature"'));
  assert.ok(findAll(cards[1], n => n.className === 'rh-tok-num').some(n => n.textContent === '80'));
  assert.ok(findAll(cards[1], n => n.className === 'rh-tok-kw').some(n => n.textContent === 'true'));
});

test('tokenizeCode highlights HTML/CBS, CSS, Regex, and Diff cleanly', () => {
  const htmlToks = tokenizeCode('<div class="hp">{{getvar::hp}}</div>', 'html');
  assert.ok(htmlToks.some(t => t.type === 'fn' && t.text === '<div'));
  assert.ok(htmlToks.some(t => t.type === 'kw' && t.text === 'class'));
  assert.ok(htmlToks.some(t => t.type === 'str' && t.text === '"hp"'));
  assert.ok(htmlToks.some(t => t.type === 'op' && t.text === '{{getvar::hp}}'));

  const cssToks = tokenizeCode('.card { color: #ff8800; padding: 12px; }', 'css');
  assert.ok(cssToks.some(t => t.type === 'fn' && t.text === 'color'));
  assert.ok(cssToks.some(t => t.type === 'op' && t.text === '#ff8800'));
  assert.ok(cssToks.some(t => t.type === 'num' && t.text === '12px'));

  const regexToks = tokenizeCode('^\\[HP:(\\d+)\\]$', 'regex');
  assert.ok(regexToks.some(t => t.type === 'fn' && t.text === '^'));
  assert.ok(regexToks.some(t => t.type === 'op' && t.text === '\\d'));
  assert.ok(regexToks.some(t => t.type === 'num' && t.text === '+'));

  const diffToks = tokenizeCode('@@ -1 +1 @@\n-old\n+new', 'diff');
  const nonNlDiff = diffToks.filter(t => t.text !== '\n');
  assert.equal(nonNlDiff[0].type, 'kw');
  assert.equal(nonNlDiff[1].type, 'del');
  assert.equal(nonNlDiff[2].type, 'add');
});

test('renderMarkdown handles h5/h6, C# heading suffix, snake_case safety, fence filename metadata, and proposal blocks', () => {
  const doc = createMiniDoc();
  const host = doc.createElement('div');
  const md = [
    '## C# 및 Lua 연동 ##',
    '##### 세부 항목',
    '식별자 char_lorebook 와 foo__bar__baz 는 보존되고, _기울임_ 과 __굵게__ 만 서식이 적용됩니다.',
    '한 줄 인라인 코드 ```keep_inline``` 는 코드 펜스로 오탐되지 않습니다.',
    '',
    '```lua status_bar.lua',
    'local x = 1',
    'return x',
    '```',
    '',
    '```risuhelper-proposal',
    '{"action":"replace_text"}',
    '<<<CONTENT>>>',
    '본문',
  ].join('\n');

  renderMarkdown(doc, host, md);

  const h2 = findAll(host, n => n.tagName === 'H2')[0];
  assert.equal(h2.textContent, 'C# 및 Lua 연동');
  assert.equal(findAll(host, n => n.tagName === 'H5')[0].textContent, '세부 항목');

  const ems = findAll(host, n => n.tagName === 'EM').map(n => n.textContent);
  assert.deepEqual(ems, ['기울임']);
  const strongs = findAll(host, n => n.tagName === 'STRONG').map(n => n.textContent);
  assert.deepEqual(strongs, ['굵게']);

  const inlineCodes = findAll(host, n => n.className === 'rh-md-code').map(n => n.textContent);
  assert.ok(inlineCodes.includes('keep_inline'));

  const cards = findAll(host, n => n.className === 'rh-code-card');
  assert.equal(cards.length, 2);
  assert.equal(findAll(cards[0], n => n.className === 'rh-code-file')[0].textContent, 'status_bar.lua');
  assert.equal(findAll(cards[0], n => n.className === 'rh-code-lines')[0].textContent, '2줄');
  assert.equal(findAll(cards[1], n => n.className.includes('rh-code-lang'))[0].textContent, 'PROPOSAL');
  assert.ok(findAll(cards[1], n => n.className === 'rh-tok-op').some(n => n.textContent === '<<<CONTENT>>>'));
});
