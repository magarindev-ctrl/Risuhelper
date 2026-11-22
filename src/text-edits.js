// Exact partial-edit engine, fuzzy candidate locator, and unified-style diff preview.

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

/**
 * Validates and locates non-overlapping exact ranges in `source` for `edits: [{ before, after }]`.
 */
function locateTextEdits(source, edits, label = '부분 편집') {
  assert(typeof source === 'string', `${label}: 원문 문자열이 필요합니다.`);
  assert(Array.isArray(edits) && edits.length > 0 && edits.length <= 100, `${label}: edits는 1~100개 배열이어야 합니다.`);

  const ranges = edits.map((edit, idx) => {
    assert(edit && typeof edit === 'object' && !Array.isArray(edit), `${label} #${idx + 1}: edit 객체가 필요합니다.`);
    assert(typeof edit.before === 'string' && edit.before.length > 0, `${label} #${idx + 1}: before는 비어 있지 않은 문자열이어야 합니다.`);
    assert(typeof edit.after === 'string', `${label} #${idx + 1}: after는 문자열이어야 합니다.`);

    const first = source.indexOf(edit.before);
    assert(first !== -1, `${label} #${idx + 1}: 원문에서 before 구간을 찾을 수 없습니다.`);
    const second = source.indexOf(edit.before, first + 1);
    assert(second === -1, `${label} #${idx + 1}: before 구간이 원문에 여러 번 등장합니다. 앞뒤 문맥을 더 포함해 주세요.`);

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

export { locateTextEdits, applyTextEdits, findFuzzyCandidates, buildDiffPreview };
