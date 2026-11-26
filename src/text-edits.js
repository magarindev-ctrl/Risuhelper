// Exact partial-edit engine, fuzzy candidate locator, and unified-style diff preview.

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

/**
 * Returns 0-indexed character start offset for every 1-indexed line in `source`.
 */
function computeLineStarts(source) {
  const s = String(source ?? '');
  const starts = [0];
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/**
 * Binary-searches 1-indexed line number for character `offset` using `computeLineStarts` output.
 */
function offsetToLineNumber(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, hi + 1);
}

/**
 * Converts an optional 1-indexed inclusive `lineRange` ([startLine, endLine]) to character offsets.
 */
function resolveLineRangeWindow(source, lineRange, lineStarts, label) {
  if (lineRange === undefined || lineRange === null) return null;
  let startLine;
  let endLine;
  if (Array.isArray(lineRange) && lineRange.length === 2) {
    startLine = Number(lineRange[0]);
    endLine = Number(lineRange[1]);
  } else if (typeof lineRange === 'object' && !Array.isArray(lineRange)) {
    startLine = Number(lineRange.start ?? lineRange.startLine);
    endLine = Number(lineRange.end ?? lineRange.endLine);
  } else {
    throw new Error(`${label}: lineRange는 [시작줄, 끝줄] 형태의 양의 정수 배열이어야 합니다.`);
  }
  assert(
    Number.isInteger(startLine) && Number.isInteger(endLine) && startLine >= 1 && endLine >= startLine,
    `${label}: lineRange는 1 이상의 정수 [시작줄, 끝줄](시작줄 <= 끝줄)이어야 합니다.`
  );
  const totalLines = lineStarts.length;
  assert(
    startLine <= totalLines,
    `${label}: 지정한 줄 범위(${startLine}~${endLine}줄)가 원문 전체 줄 수(${totalLines}줄)를 벗어납니다.`
  );
  const clampedEnd = Math.min(totalLines, endLine);
  const minOffset = lineStarts[startLine - 1];
  const maxOffset = clampedEnd >= totalLines ? source.length : lineStarts[clampedEnd];
  return { startLine, endLine: clampedEnd, minOffset, maxOffset, totalLines };
}

/**
 * Validates and locates non-overlapping exact ranges in `source` for `edits: [{ before, after, lineRange? }]`.
 * When `edit.lineRange` (`[startLine, endLine]`, 1-indexed inclusive) is given, matching is restricted
 * strictly to that line window so identical phrases elsewhere in a large document cannot be matched by mistake.
 */
function locateTextEdits(source, edits, label = '부분 편집') {
  assert(typeof source === 'string', `${label}: 원문 문자열이 필요합니다.`);
  assert(Array.isArray(edits) && edits.length > 0 && edits.length <= 100, `${label}: edits는 1~100개 배열이어야 합니다.`);

  const needsLines = edits.some(e => e && e.lineRange !== undefined && e.lineRange !== null);
  const lineStarts = needsLines ? computeLineStarts(source) : null;

  const ranges = edits.map((edit, idx) => {
    assert(edit && typeof edit === 'object' && !Array.isArray(edit), `${label} #${idx + 1}: edit 객체가 필요합니다.`);
    assert(typeof edit.before === 'string' && edit.before.length > 0, `${label} #${idx + 1}: before는 비어 있지 않은 문자열이어야 합니다.`);
    assert(typeof edit.after === 'string', `${label} #${idx + 1}: after는 문자열이어야 합니다.`);

    const win = lineStarts ? resolveLineRangeWindow(source, edit.lineRange, lineStarts, `${label} #${idx + 1}`) : null;
    if (win) {
      const slice = source.slice(win.minOffset, win.maxOffset);
      const relFirst = slice.indexOf(edit.before);
      assert(
        relFirst !== -1,
        `${label} #${idx + 1}: 지정한 줄 범위(${win.startLine}~${win.endLine}줄)에서 before 구간을 찾을 수 없습니다.`
      );
      const relSecond = slice.indexOf(edit.before, relFirst + 1);
      assert(
        relSecond === -1,
        `${label} #${idx + 1}: 지정한 줄 범위(${win.startLine}~${win.endLine}줄) 안에서도 before 구간이 여러 번 등장합니다. 앞뒤 문맥을 더 포함하거나 줄 범위를 좁혀 주세요.`
      );
      const absStart = win.minOffset + relFirst;
      return {
        start: absStart,
        end: absStart + edit.before.length,
        before: edit.before,
        after: edit.after,
        lineRange: [win.startLine, win.endLine],
      };
    }

    const first = source.indexOf(edit.before);
    assert(first !== -1, `${label} #${idx + 1}: 원문에서 before 구간을 찾을 수 없습니다.`);
    const second = source.indexOf(edit.before, first + 1);
    assert(second === -1, `${label} #${idx + 1}: before 구간이 원문에 여러 번 등장합니다. 앞뒤 문맥을 더 포함하거나 lineRange를 지정해 주세요.`);

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

/**
 * Builds a compact structural outline (markdown headings / Lua functions / section landmarks)
 * with 1-indexed line numbers, plus head/tail previews for large documents.
 */
function buildTextOutline(text, { kind = 'text', maxEntries = 50, headChars = 1600, tailChars = 900 } = {}) {
  const src = String(text ?? '');
  const lineStarts = computeLineStarts(src);
  const totalLines = lineStarts.length;
  const totalChars = src.length;
  const isLua = kind === 'lua' || kind === 'char_lua' || kind === 'module_lua';
  const headings = [];

  for (let idx = 0; idx < totalLines && headings.length < maxEntries; idx++) {
    const start = lineStarts[idx];
    const end = idx + 1 < totalLines ? lineStarts[idx + 1] : totalChars;
    const rawLine = src.slice(start, end).replace(/\r?\n$/, '');
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let match = false;
    if (isLua) {
      match = /^(?:local\s+)?function\s+[\w.:]+\s*\(/.test(trimmed) ||
        /^--\s*(?:={3,}|-{3,}|\[[^\]]{2,40}\])/.test(trimmed);
    } else {
      match = /^#{1,4}\s+\S/.test(trimmed) ||
        /^\[[^\]\n]{2,60}\]\s*$/.test(trimmed) ||
        /^<[A-Za-z_][\w-]{1,32}>\s*$/.test(trimmed);
    }
    if (match) {
      headings.push({
        line: idx + 1,
        charOffset: start,
        text: trimmed.length > 90 ? `${trimmed.slice(0, 90)}…` : trimmed,
      });
    }
  }

  // Fallback landmarks when a large document has no explicit headings/functions
  if (headings.length === 0 && totalChars > 2000) {
    const stepChars = Math.max(2500, Math.ceil(totalChars / 12));
    for (let pos = 0; pos < totalChars && headings.length < maxEntries; pos += stepChars) {
      const lineNo = offsetToLineNumber(lineStarts, pos);
      const lineStart = lineStarts[lineNo - 1];
      const lineEnd = lineNo < totalLines ? lineStarts[lineNo] : totalChars;
      const sample = src.slice(lineStart, Math.min(lineEnd, lineStart + 80)).replace(/\s+/g, ' ').trim();
      headings.push({
        line: lineNo,
        charOffset: lineStart,
        text: sample || `(L${lineNo})`,
      });
    }
  }

  const headPreview = headChars > 0 ? src.slice(0, headChars) : '';
  const tailStart = tailChars > 0 && totalChars > headChars + 200 ? Math.max(headChars, totalChars - tailChars) : totalChars;
  const tailPreview = tailStart < totalChars ? src.slice(tailStart) : '';
  const tailStartLine = tailStart < totalChars ? offsetToLineNumber(lineStarts, tailStart) : totalLines;

  return {
    totalChars,
    totalLines,
    headings,
    headPreview,
    headEndLine: offsetToLineNumber(lineStarts, Math.min(totalChars, headPreview.length)),
    tailPreview,
    tailStartLine,
  };
}

/**
 * Slices `text` by 1-indexed inclusive line range `[startLine, endLine]`, bounded by `maxChars`.
 */
function sliceTextByLines(text, startLine = 1, endLine = null, maxChars = 12000) {
  const src = String(text ?? '');
  const lineStarts = computeLineStarts(src);
  const totalLines = lineStarts.length;
  const totalChars = src.length;

  const sLine = Math.max(1, Math.min(totalLines, Math.floor(Number(startLine) || 1)));
  const eLineRaw = endLine === null || endLine === undefined ? totalLines : Math.floor(Number(endLine) || totalLines);
  const eLine = Math.max(sLine, Math.min(totalLines, eLineRaw));

  const startChar = lineStarts[sLine - 1];
  let endChar = eLine >= totalLines ? totalChars : lineStarts[eLine];
  let clippedByBudget = false;
  if (endChar - startChar > maxChars) {
    endChar = startChar + maxChars;
    clippedByBudget = true;
  }
  const actualEndLine = offsetToLineNumber(lineStarts, Math.max(startChar, endChar - 1));
  const slice = src.slice(startChar, endChar);
  const isFull = startChar === 0 && endChar === totalChars;

  return {
    text: slice,
    startLine: sLine,
    endLine: actualEndLine,
    totalLines,
    startChar,
    endChar,
    totalChars,
    truncated: !isFull || clippedByBudget,
    isFull,
    hasMoreBefore: startChar > 0,
    hasMoreAfter: endChar < totalChars,
    nextStartLine: endChar < totalChars ? Math.min(totalLines, actualEndLine + 1) : null,
  };
}

/**
 * Slices `text` by 0-indexed character offset `[startChar, startChar + maxChars)`.
 */
function sliceTextByChars(text, startChar = 0, maxChars = 12000) {
  const src = String(text ?? '');
  const lineStarts = computeLineStarts(src);
  const totalLines = lineStarts.length;
  const totalChars = src.length;
  const sChar = Math.max(0, Math.min(totalChars, Math.floor(Number(startChar) || 0)));
  const limit = Math.max(200, Math.floor(Number(maxChars) || 12000));
  const eChar = Math.min(totalChars, sChar + limit);
  const startLine = offsetToLineNumber(lineStarts, sChar);
  const endLine = offsetToLineNumber(lineStarts, Math.max(sChar, eChar - 1));
  const isFull = sChar === 0 && eChar === totalChars;

  return {
    text: src.slice(sChar, eChar),
    startLine,
    endLine,
    totalLines,
    startChar: sChar,
    endChar: eChar,
    totalChars,
    truncated: !isFull,
    isFull,
    hasMoreBefore: sChar > 0,
    hasMoreAfter: eChar < totalChars,
    nextStartChar: eChar < totalChars ? eChar : null,
  };
}

/**
 * Finds `anchor` inside `text` and returns a ±`contextChars` window aligned to line boundaries.
 */
function sliceTextAroundAnchor(text, anchor, contextChars = 3000) {
  const src = String(text ?? '');
  const needle = String(anchor ?? '');
  const lineStarts = computeLineStarts(src);
  const totalLines = lineStarts.length;
  const totalChars = src.length;
  if (!needle) {
    return { found: false, matchCount: 0, totalLines, totalChars };
  }

  let matchPos = src.indexOf(needle);
  let caseInsensitive = false;
  if (matchPos === -1) {
    matchPos = src.toLowerCase().indexOf(needle.toLowerCase());
    caseInsensitive = matchPos !== -1;
  }
  if (matchPos === -1) {
    return { found: false, matchCount: 0, totalLines, totalChars };
  }

  let matchCount = 0;
  const haystack = caseInsensitive ? src.toLowerCase() : src;
  const q = caseInsensitive ? needle.toLowerCase() : needle;
  let scan = matchPos;
  while (scan !== -1 && matchCount < 200) {
    matchCount++;
    scan = haystack.indexOf(q, scan + Math.max(1, q.length));
  }

  const radius = Math.max(200, Math.min(6000, Math.floor(Number(contextChars) || 3000)));
  const rawStart = Math.max(0, matchPos - radius);
  const rawEnd = Math.min(totalChars, matchPos + needle.length + radius);
  const startLine = offsetToLineNumber(lineStarts, rawStart);
  const endLine = offsetToLineNumber(lineStarts, Math.max(rawStart, rawEnd - 1));
  const startChar = lineStarts[startLine - 1];
  const endChar = endLine >= totalLines ? totalChars : lineStarts[endLine];
  const isFull = startChar === 0 && endChar === totalChars;

  return {
    found: true,
    matchLine: offsetToLineNumber(lineStarts, matchPos),
    matchCharOffset: matchPos,
    matchCount,
    text: src.slice(startChar, endChar),
    startLine,
    endLine,
    totalLines,
    startChar,
    endChar,
    totalChars,
    truncated: !isFull,
    isFull,
    hasMoreBefore: startChar > 0,
    hasMoreAfter: endChar < totalChars,
  };
}

/**
 * Losslessly partitions `text` into chunks near `targetChunkChars`, preferring paragraph (`\n\n`)
 * then line (`\n`) boundaries. Guarantees `chunks.map(c => c.text).join('') === text`.
 */
function splitTextIntoChunks(text, targetChunkChars = 8000, maxChunks = 0) {
  const src = String(text ?? '');
  if (!src) return [];
  const lineStarts = computeLineStarts(src);
  let target = Math.max(500, Math.floor(Number(targetChunkChars) || 8000));
  if (maxChunks > 0 && Math.ceil(src.length / target) > maxChunks) {
    target = Math.ceil(src.length / maxChunks);
  }

  const chunks = [];
  let cursor = 0;
  const minSplitOffset = Math.floor(target * 0.55);

  while (cursor < src.length) {
    const remaining = src.length - cursor;
    let end = src.length;
    if (remaining > target * 1.15 && (maxChunks <= 0 || chunks.length + 1 < maxChunks)) {
      const hardEnd = Math.min(src.length, cursor + target);
      const searchFloor = cursor + minSplitOffset;
      let splitAt = src.lastIndexOf('\n\n', hardEnd);
      if (splitAt >= searchFloor) {
        end = splitAt + 2;
      } else {
        splitAt = src.lastIndexOf('\n', hardEnd);
        if (splitAt >= searchFloor) {
          end = splitAt + 1;
        } else {
          end = hardEnd;
        }
      }
    }
    const startLine = offsetToLineNumber(lineStarts, cursor);
    const endLine = offsetToLineNumber(lineStarts, Math.max(cursor, end - 1));
    chunks.push({
      index: chunks.length,
      startChar: cursor,
      endChar: end,
      startLine,
      endLine,
      text: src.slice(cursor, end),
    });
    cursor = end;
  }
  return chunks;
}

export {
  computeLineStarts,
  offsetToLineNumber,
  locateTextEdits,
  applyTextEdits,
  findFuzzyCandidates,
  buildDiffPreview,
  buildTextOutline,
  sliceTextByLines,
  sliceTextByChars,
  sliceTextAroundAnchor,
  splitTextIntoChunks,
};
