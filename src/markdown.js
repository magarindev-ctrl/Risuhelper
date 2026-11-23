// Zero-dependency, XSS-safe (pure DOM nodes, no innerHTML) Markdown & code editor renderer
// tailored for RisuHelper's assistant chat bubbles (Dark/Light themes, Lua/JSON/HTML/CSS/Regex/CBS).

const CALLOUT_META = {
  NOTE: { cls: 'note', label: 'ℹ️ 참고' },
  TIP: { cls: 'tip', label: '💡 팁' },
  IMPORTANT: { cls: 'important', label: '📌 중요' },
  WARNING: { cls: 'warning', label: '⚠️ 주의' },
  CAUTION: { cls: 'caution', label: '🚨 경고' },
};

const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
  'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return',
  'then', 'true', 'until', 'while',
]);

const LUA_RISU_APIS = new Set([
  'onStart', 'onInput', 'onOutput', 'onButtonClick', 'listenEdit',
  'getChatVar', 'setChatVar', 'getGlobalVar', 'getChat', 'setChat',
  'getChatRole', 'setChatRole', 'getChatLength', 'getFullChat', 'setFullChat',
  'addChat', 'insertChat', 'removeChat', 'cutChat', 'getCharacterLastMessage',
  'getUserLastMessage', 'getName', 'setName', 'getDescription', 'setDescription',
  'getCharacterFirstMessage', 'setCharacterFirstMessage', 'getPersonaName',
  'getPersonaDescription', 'getAuthorsNote', 'getBackgroundEmbedding',
  'setBackgroundEmbedding', 'getLoreBooks', 'upsertLocalLoreBook', 'loadLoreBooks',
  'LLM', 'axLLM', 'simpleLLM', 'cbs', 'getTokens', 'sleep', 'reloadDisplay',
  'reloadChat', 'stopChat', 'log', 'alertNormal', 'alertError', 'alertInput',
  'alertSelect', 'alertConfirm', 'pairs', 'ipairs', 'tonumber', 'tostring',
  'string', 'table', 'math', 'json',
]);

const JS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally',
  'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
  'null', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true',
  'try', 'typeof', 'undefined', 'var', 'void', 'while', 'yield',
]);

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) {
    node.appendChild(doc.createTextNode(String(text)));
  }
  return node;
}

function normalizeLang(raw) {
  const l = String(raw || '').trim().toLowerCase();
  if (!l) return '';
  if (l === 'javascript' || l === 'mjs' || l === 'cjs') return 'js';
  if (l === 'typescript' || l === 'mts') return 'ts';
  if (l === 'regexp' || l === 're') return 'regex';
  if (l === 'htm' || l === 'xml' || l === 'svg') return 'html';
  if (l === 'markdown') return 'md';
  if (l === 'risuhelper-proposal' || l === 'risu-helper-proposal') return 'proposal';
  return l;
}

function isSafeHttpUrl(raw) {
  const str = String(raw || '').trim();
  if (!/^https?:\/\//i.test(str)) return false;
  try {
    const parsed = new URL(str);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Lightweight single-pass syntax tokenizer returning `{ type, text }` tokens.
 * Types map to `.rh-tok-<type>` CSS classes (kw, str, num, cmt, fn, op, add, del, plain).
 */
function tokenizeCode(code, lang) {
  const src = String(code ?? '');
  const norm = normalizeLang(lang);
  if (!src) return [];

  // Diff blocks: line-based coloring (keep newline separate so spans never break gutter line-height)
  if (norm === 'diff') {
    const tokens = [];
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let type = 'plain';
      if (line.startsWith('@@')) type = 'kw';
      else if (line.startsWith('+++') || line.startsWith('---')) type = 'cmt';
      else if (line.startsWith('+')) type = 'add';
      else if (line.startsWith('-')) type = 'del';
      if (line) tokens.push({ type, text: line });
      if (i < lines.length - 1) tokens.push({ type: 'plain', text: '\n' });
    }
    return tokens;
  }

  // Regex blocks
  if (norm === 'regex') {
    return scanRegexTokens(src, [
      [/^\\(?:[dDwWsSbBnrt0\\/.+*?^$()[\]{}|]|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2})/, 'op'],
      [/^\[(?:\\.|[^\]\\])*\]/, 'str'],
      [/^\{\d+(?:,\d*)?\}|^[+*?]/, 'num'],
      [/^[()|]/, 'kw'],
      [/^[\^$]/, 'fn'],
    ]);
  }

  // HTML / XML / Svelte
  if (norm === 'html' || norm === 'svelte') {
    return scanRegexTokens(src, [
      [/^<!--[\s\S]*?-->/, 'cmt'],
      [/^\{\{[\s\S]*?\}\}/, 'op'],
      [/^<\/?[a-zA-Z][a-zA-Z0-9:-]*/, 'fn'],
      [/^\/?>/, 'fn'],
      [/^"(?:\\.|[^"\\])*"|^'(?:\\.|[^'\\])*'/, 'str'],
      [/^[a-zA-Z_:@-][a-zA-Z0-9_.:@-]*(?==)/, 'kw'],
    ]);
  }

  // CSS
  if (norm === 'css') {
    return scanRegexTokens(src, [
      [/^\/\*[\s\S]*?\*\//, 'cmt'],
      [/^"(?:\\.|[^"\\])*"|^'(?:\\.|[^'\\])*'/, 'str'],
      [/^@[a-zA-Z-]+/, 'kw'],
      [/^#[0-9a-fA-F]{3,8}\b/, 'op'],
      [/^[a-zA-Z-]+(?=\s*:)/, 'fn'],
      [/^-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|dvh|%|ms|s|deg)?\b/, 'num'],
    ]);
  }

  // Lua
  if (norm === 'lua') {
    return scanRegexTokens(src, [
      [/^--\[\[[\s\S]*?(?:\]\]|$)/, 'cmt'],
      [/^--[^\n]*/, 'cmt'],
      [/^\[\[[\s\S]*?(?:\]\]|$)/, 'str'],
      [/^"(?:\\.|[^"\\])*"|^'(?:\\.|[^'\\])*'/, 'str'],
      [/^\{\{[\s\S]*?\}\}/, 'op'],
      [/^0x[0-9a-fA-F]+|^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'num'],
      [/^[a-zA-Z_][a-zA-Z0-9_]*/, (m) => {
        if (LUA_KEYWORDS.has(m)) return 'kw';
        if (LUA_RISU_APIS.has(m)) return 'fn';
        return 'plain';
      }],
    ]);
  }

  // JSON / Streaming RisuHelper proposal block
  if (norm === 'json' || norm === 'proposal') {
    return scanRegexTokens(src, [
      [/^<<<[A-Z_]+>>>/, 'op'],
      [/^"(?:\\.|[^"\\])*"(?=\s*:)/, 'fn'],
      [/^"(?:\\.|[^"\\])*"/, 'str'],
      [/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'num'],
      [/^\b(?:true|false|null)\b/, 'kw'],
    ]);
  }

  // JavaScript / TypeScript
  if (norm === 'js' || norm === 'ts') {
    return scanRegexTokens(src, [
      [/^\/\*[\s\S]*?(?:\*\/|$)/, 'cmt'],
      [/^\/\/[^\n]*/, 'cmt'],
      [/^`(?:\\.|[^`\\])*`|^"(?:\\.|[^"\\])*"|^'(?:\\.|[^'\\])*'/, 'str'],
      [/^0x[0-9a-fA-F]+|^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/, 'num'],
      [/^[a-zA-Z_$][a-zA-Z0-9_$]*/, (m) => (JS_KEYWORDS.has(m) ? 'kw' : 'plain')],
    ]);
  }

  // CBS / Lorebook / Generic text: highlight RisuAI CBS {{...}} macros & @@decorators
  return scanRegexTokens(src, [
    [/^\{\{[\s\S]*?\}\}/, 'op'],
    [/^@@[a-zA-Z0-9_]+/, 'kw'],
    [/^"(?:\\.|[^"\\])*"/, 'str'],
  ]);
}

function scanRegexTokens(src, rules) {
  const tokens = [];
  let pos = 0;
  let plainBuf = '';

  const flushPlain = () => {
    if (plainBuf) {
      tokens.push({ type: 'plain', text: plainBuf });
      plainBuf = '';
    }
  };

  while (pos < src.length) {
    const rest = src.slice(pos);
    let matched = false;
    for (const [re, kind] of rules) {
      const m = rest.match(re);
      if (m && m[0].length > 0) {
        const text = m[0];
        const type = typeof kind === 'function' ? kind(text) : kind;
        if (type === 'plain') {
          plainBuf += text;
        } else {
          flushPlain();
          tokens.push({ type, text });
        }
        pos += text.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      plainBuf += src[pos];
      pos++;
    }
  }
  flushPlain();
  return tokens;
}

function renderCodeCard(doc, code, lang, { onCopy, meta } = {}) {
  const norm = normalizeLang(lang);
  const displayLang = norm === 'proposal' ? 'PROPOSAL' : (norm || 'text').toUpperCase();
  const card = el(doc, 'div', 'rh-code-card');
  const lines = String(code ?? '').split('\n');
  const showGutter = lines.length >= 2;

  const head = el(doc, 'div', 'rh-code-head');
  const metaWrap = el(doc, 'div', 'rh-code-meta');
  metaWrap.appendChild(el(doc, 'span', `rh-code-dot${norm ? ` lang-${norm}` : ''}`));
  metaWrap.appendChild(el(doc, 'span', `rh-code-lang${norm ? ` lang-${norm}` : ''}`, displayLang));
  if (meta) {
    metaWrap.appendChild(el(doc, 'span', 'rh-code-file', meta));
  }
  if (showGutter) {
    metaWrap.appendChild(el(doc, 'span', 'rh-code-lines', `${lines.length}줄`));
  }
  head.appendChild(metaWrap);

  if (typeof onCopy === 'function') {
    const copyBtn = el(doc, 'button', 'rh-code-copy', '복사');
    copyBtn.setAttribute('type', 'button');
    copyBtn.addEventListener('click', (e) => {
      if (e?.stopPropagation) e.stopPropagation();
      onCopy(code);
    });
    head.appendChild(copyBtn);
  }
  card.appendChild(head);

  const body = el(doc, 'div', showGutter ? 'rh-code-grid' : 'rh-code-single');
  if (showGutter) {
    const gutter = el(doc, 'div', 'rh-code-gutter');
    gutter.setAttribute('aria-hidden', 'true');
    gutter.appendChild(doc.createTextNode(lines.map((_, i) => String(i + 1)).join('\n')));
    body.appendChild(gutter);
  }

  const pre = el(doc, 'pre', 'rh-code-pre');
  const codeEl = el(doc, 'code', 'rh-code-content');
  const tokens = tokenizeCode(code, norm);
  for (const tok of tokens) {
    if (tok.type === 'plain') {
      codeEl.appendChild(doc.createTextNode(tok.text));
    } else {
      codeEl.appendChild(el(doc, 'span', `rh-tok-${tok.type}`, tok.text));
    }
  }
  pre.appendChild(codeEl);
  body.appendChild(pre);
  card.appendChild(body);
  return card;
}

/**
 * Parses and appends safe inline Markdown nodes (inline code, links, bold/italic/strike, CBS macros).
 */
function renderInlineMarkdown(doc, parent, text) {
  const str = String(text ?? '');
  let pos = 0;
  let buf = '';

  const flush = () => {
    if (buf) {
      parent.appendChild(doc.createTextNode(buf));
      buf = '';
    }
  };

  while (pos < str.length) {
    const rest = str.slice(pos);

    // 1. Escaped markdown punctuation (\*, \`, \[, etc.)
    if (rest[0] === '\\' && rest.length >= 2 && /[\\`*_{}[\]()#+\-.!~|>]/.test(rest[1])) {
      buf += rest[1];
      pos += 2;
      continue;
    }

    // 2. Inline code (`code` or ``code``)
    if (rest[0] === '`') {
      const tickMatch = rest.match(/^(`+)/);
      const ticks = tickMatch[1];
      const closeIdx = rest.indexOf(ticks, ticks.length);
      if (closeIdx !== -1) {
        flush();
        const inner = rest.slice(ticks.length, closeIdx).trim();
        parent.appendChild(el(doc, 'code', 'rh-md-code', inner));
        pos += closeIdx + ticks.length;
        continue;
      }
    }

    // 3. Safe HTTP/HTTPS link: [label](url)
    if (rest[0] === '[') {
      const linkMatch = rest.match(/^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
      if (linkMatch) {
        flush();
        const label = linkMatch[1];
        const href = linkMatch[2];
        if (isSafeHttpUrl(href)) {
          const a = el(doc, 'a', 'rh-md-link');
          a.setAttribute('href', href);
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
          renderInlineMarkdown(doc, a, label);
          parent.appendChild(a);
        } else {
          renderInlineMarkdown(doc, parent, label);
        }
        pos += linkMatch[0].length;
        continue;
      }
    }

    // 4. RisuAI CBS macro in prose: {{...}}
    if (rest.startsWith('{{')) {
      const cbsMatch = rest.match(/^\{\{([^{}\n]{1,120})\}\}/);
      if (cbsMatch) {
        flush();
        parent.appendChild(el(doc, 'span', 'rh-md-cbs', cbsMatch[0]));
        pos += cbsMatch[0].length;
        continue;
      }
    }

    // 5. Bold + Italic (***text***)
    if (rest.startsWith('***')) {
      const m = rest.match(/^\*\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*\*/);
      if (m) {
        flush();
        const strong = el(doc, 'strong', 'rh-md-strong');
        const em = el(doc, 'em', 'rh-md-em');
        renderInlineMarkdown(doc, em, m[1]);
        strong.appendChild(em);
        parent.appendChild(strong);
        pos += m[0].length;
        continue;
      }
    }

    // 6. Bold (**text** or __text__)
    if (rest.startsWith('**') || (rest.startsWith('__') && (pos === 0 || !/[a-zA-Z0-9_]/.test(str[pos - 1])))) {
      const marker = rest.slice(0, 2);
      const re = marker === '**'
        ? /^\*\*([^*\n](?:[\s\S]*?[^*\n])?)\*\*/
        : /^__([^_\n](?:[\s\S]*?[^_\n])?)__(?![a-zA-Z0-9_])/;
      const m = rest.match(re);
      if (m) {
        flush();
        const strong = el(doc, 'strong', 'rh-md-strong');
        renderInlineMarkdown(doc, strong, m[1]);
        parent.appendChild(strong);
        pos += m[0].length;
        continue;
      }
    }

    // 7. Strikethrough (~~text~~)
    if (rest.startsWith('~~')) {
      const m = rest.match(/^~~([^~\n](?:[\s\S]*?[^~\n])?)~~/);
      if (m) {
        flush();
        const del = el(doc, 'del', 'rh-md-del');
        renderInlineMarkdown(doc, del, m[1]);
        parent.appendChild(del);
        pos += m[0].length;
        continue;
      }
    }

    // 8. Italic (*text* or word-bounded _text_)
    if (rest[0] === '*' && rest[1] !== '*' && rest[1] !== ' ') {
      const m = rest.match(/^\*([^*\n](?:[^*\n]*?[^*\n\s])?)\*/);
      if (m) {
        flush();
        const em = el(doc, 'em', 'rh-md-em');
        renderInlineMarkdown(doc, em, m[1]);
        parent.appendChild(em);
        pos += m[0].length;
        continue;
      }
    }
    if (rest[0] === '_' && rest[1] !== '_' && rest[1] !== ' ' && (pos === 0 || !/[a-zA-Z0-9_]/.test(str[pos - 1]))) {
      const m = rest.match(/^_([^_\n](?:[^_\n]*?[^_\n\s])?)_(?![a-zA-Z0-9_])/);
      if (m) {
        flush();
        const em = el(doc, 'em', 'rh-md-em');
        renderInlineMarkdown(doc, em, m[1]);
        parent.appendChild(em);
        pos += m[0].length;
        continue;
      }
    }

    buf += str[pos];
    pos++;
  }
  flush();
}

function splitTableRow(line) {
  let trimmed = String(line || '').trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (trimmed[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += trimmed[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

function isTableSeparatorLine(line) {
  if (!line || !line.includes('-')) return false;
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length >= 1 && cells.every(c => /^:?-{2,}:?$/.test(c));
}

function parseTableAlignments(sepLine) {
  return splitTableRow(sepLine).map(c => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function matchFenceOpen(line) {
  const m = String(line || '').match(/^[ \t]*(`{3,}|~{3,})([^\n]*)$/);
  if (!m) return null;
  const fenceChar = m[1][0];
  const info = m[2].trim();
  // CommonMark: backtick fence info strings cannot contain backticks (prevents inline ```code``` false match)
  if (fenceChar === '`' && info.includes('`')) return null;
  const parts = info ? info.split(/\s+/) : [];
  const rawLang = parts[0] || '';
  const langParts = rawLang.split(':');
  const lang = /^[a-zA-Z0-9_+-]+$/.test(langParts[0]) ? langParts[0] : '';
  const colonMeta = langParts.length > 1 ? langParts.slice(1).join(':') : '';
  const restMeta = parts.slice(1).join(' ');
  const meta = [colonMeta, restMeta].filter(Boolean).join(' ').replace(/^title=["']?([^"']+)["']?$/i, '$1');
  return { fenceChar, fenceLen: m[1].length, lang, meta };
}

function isBlockBoundary(lines, i) {
  const line = lines[i];
  if (!line || !line.trim()) return true;
  if (matchFenceOpen(line)) return true;
  if (/^[ \t]*#{1,6}\s+/.test(line)) return true;
  if (/^[ \t]*([-*_])(?:\s*\1){2,}[ \t]*$/.test(line)) return true;
  if (/^[ \t]*>\s?/.test(line)) return true;
  if (/^[ \t]*(?:[-*+]|\d+\.)\s+/.test(line)) return true;
  if (line.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) return true;
  return false;
}

/**
 * Renders full block + inline Markdown safely into `container` using DOM nodes only.
 */
function renderMarkdown(doc, container, rawText, options = {}) {
  const normalized = String(rawText ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return;

  const root = el(doc, 'div', 'rh-md');
  const lines = normalized.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // 1. Fenced code block (``` or ~~~, handles unclosed streaming blocks gracefully)
    const fenceOpen = matchFenceOpen(line);
    if (fenceOpen) {
      const { fenceChar, fenceLen, lang, meta } = fenceOpen;
      const closeRe = new RegExp(`^[ \\t]*${fenceChar}{${fenceLen},}[ \\t]*$`);
      const codeLines = [];
      i++;
      while (i < lines.length && !closeRe.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && closeRe.test(lines[i])) i++;
      root.appendChild(renderCodeCard(doc, codeLines.join('\n'), lang, { ...options, meta }));
      continue;
    }

    // 2. Headings (# to ######, preserves trailing # like "C#" unless preceded by whitespace)
    const heading = line.match(/^[ \t]*(#{1,6})\s+(.+?)(?:[ \t]+#+[ \t]*)?$/);
    if (heading) {
      const level = heading[1].length;
      const hEl = el(doc, `h${level}`, `rh-md-h${level}`);
      renderInlineMarkdown(doc, hEl, heading[2].trim());
      root.appendChild(hEl);
      i++;
      continue;
    }

    // 3. Horizontal rule
    if (/^[ \t]*([-*_])(?:\s*\1){2,}[ \t]*$/.test(line)) {
      root.appendChild(el(doc, 'hr', 'rh-md-hr'));
      i++;
      continue;
    }

    // 4. Blockquote / GitHub Callout (> [!NOTE], > [!TIP], > [!WARNING], etc.)
    if (/^[ \t]*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^[ \t]*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^[ \t]*>\s?/, ''));
        i++;
      }
      const calloutMatch = quoteLines[0]?.trim().match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i);
      if (calloutMatch) {
        const meta = CALLOUT_META[calloutMatch[1].toUpperCase()] || CALLOUT_META.NOTE;
        const box = el(doc, 'div', `rh-md-callout callout-${meta.cls}`);
        box.appendChild(el(doc, 'div', 'rh-md-callout-title', meta.label));
        const bodyText = quoteLines.slice(1).join('\n').trim();
        if (bodyText) renderMarkdown(doc, box, bodyText, options);
        root.appendChild(box);
      } else {
        const bq = el(doc, 'blockquote', 'rh-md-quote');
        renderMarkdown(doc, bq, quoteLines.join('\n'), options);
        root.appendChild(bq);
      }
      continue;
    }

    // 5. Markdown Table
    if (line.includes('|') && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headers = splitTableRow(line);
      const aligns = parseTableAlignments(lines[i + 1]);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const wrap = el(doc, 'div', 'rh-md-table-wrap');
      const table = el(doc, 'table', 'rh-md-table');
      const thead = el(doc, 'thead');
      const headTr = el(doc, 'tr');
      headers.forEach((cell, idx) => {
        const th = el(doc, 'th');
        if (aligns[idx] && aligns[idx] !== 'left') th.setAttribute('style', `text-align:${aligns[idx]};`);
        renderInlineMarkdown(doc, th, cell);
        headTr.appendChild(th);
      });
      thead.appendChild(headTr);
      table.appendChild(thead);

      if (rows.length > 0) {
        const tbody = el(doc, 'tbody');
        for (const r of rows) {
          const tr = el(doc, 'tr');
          for (let c = 0; c < headers.length; c++) {
            const td = el(doc, 'td');
            if (aligns[c] && aligns[c] !== 'left') td.setAttribute('style', `text-align:${aligns[c]};`);
            renderInlineMarkdown(doc, td, r[c] ?? '');
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
      }
      wrap.appendChild(table);
      root.appendChild(wrap);
      continue;
    }

    // 6. Ordered or Unordered Lists (with optional task checkboxes & simple 1-level nesting)
    const listMatch = line.match(/^([ \t]*)(?:([-*+])|(\d+)\.)\s+(.*)$/);
    if (listMatch) {
      const baseIndent = listMatch[1].length;
      const isOrdered = Boolean(listMatch[3]);
      const listEl = el(doc, isOrdered ? 'ol' : 'ul', `rh-md-list${isOrdered ? ' ordered' : ''}`);
      let lastLi = null;

      while (i < lines.length) {
        const m = lines[i].match(/^([ \t]*)(?:([-*+])|(\d+)\.)\s+(.*)$/);
        if (!m) break;
        const indent = m[1].length;
        const itemOrdered = Boolean(m[3]);
        const itemText = m[4];

        // If sibling switches list type at the same base indent, close current list
        if (indent <= baseIndent && itemOrdered !== isOrdered) break;

        if (indent > baseIndent && lastLi) {
          let subList = lastLi._rhSubList;
          if (!subList) {
            subList = el(doc, itemOrdered ? 'ol' : 'ul', `rh-md-list nested${itemOrdered ? ' ordered' : ''}`);
            lastLi.appendChild(subList);
            lastLi._rhSubList = subList;
          }
          subList.appendChild(buildListItem(doc, itemText));
        } else {
          const li = buildListItem(doc, itemText);
          listEl.appendChild(li);
          lastLi = li;
        }
        i++;
      }
      root.appendChild(listEl);
      continue;
    }

    // 7. Paragraph (groups consecutive prose lines until next block boundary)
    const paraLines = [];
    while (i < lines.length && !isBlockBoundary(lines, i)) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const p = el(doc, 'p', 'rh-md-p');
      paraLines.forEach((pLine, idx) => {
        if (idx > 0) p.appendChild(doc.createElement('br'));
        renderInlineMarkdown(doc, p, pLine);
      });
      root.appendChild(p);
    } else {
      // Safety advance to guarantee termination
      i++;
    }
  }

  container.appendChild(root);
}

function buildListItem(doc, rawItemText) {
  const li = el(doc, 'li', 'rh-md-li');
  const taskMatch = rawItemText.match(/^\[([ xX])\]\s+(.*)$/);
  if (taskMatch) {
    const done = taskMatch[1].toLowerCase() === 'x';
    li.className = `rh-md-li task${done ? ' done' : ''}`;
    li.appendChild(el(doc, 'span', `rh-md-check${done ? ' done' : ''}`, done ? '✓' : ''));
    const span = el(doc, 'span', 'rh-md-task-text');
    renderInlineMarkdown(doc, span, taskMatch[2]);
    li.appendChild(span);
  } else {
    renderInlineMarkdown(doc, li, rawItemText);
  }
  return li;
}

export {
  tokenizeCode,
  renderInlineMarkdown,
  renderMarkdown,
};
