import test from 'node:test';
import assert from 'node:assert/strict';
import {
  locateTextEdits,
  applyTextEdits,
  findFuzzyCandidates,
  buildDiffPreview,
} from '../src/text-edits.js';

test('applyTextEdits applies multiple non-overlapping exact edits in document order', () => {
  const source = '이름: 아리아\n성격: 차분하고 냉정함\n말투: 존댓말';
  const result = applyTextEdits(source, [
    { before: '말투: 존댓말', after: '말투: 반말과 존댓말을 섞어 씀' },
    { before: '성격: 차분하고 냉정함', after: '성격: 차분하지만 호기심이 많음' },
  ]);
  assert.equal(result, '이름: 아리아\n성격: 차분하지만 호기심이 많음\n말투: 반말과 존댓말을 섞어 씀');
});

test('locateTextEdits rejects missing, duplicate, and overlapping before snippets', () => {
  assert.throws(
    () => locateTextEdits('hello world', [{ before: 'missing', after: 'x' }]),
    /찾을 수 없습니다/
  );
  assert.throws(
    () => locateTextEdits('foo bar foo', [{ before: 'foo', after: 'baz' }]),
    /여러 번 등장합니다/
  );
  assert.throws(
    () => locateTextEdits('abcdef', [
      { before: 'abcd', after: '1' },
      { before: 'cdef', after: '2' },
    ]),
    /서로 겹칩니다/
  );
});

test('findFuzzyCandidates locates exact, normalized whitespace/punctuation, and bigram matches', () => {
  const exact = findFuzzyCandidates('alpha beta alpha', 'alpha');
  assert.equal(exact.length, 2);
  assert.equal(exact[0].kind, '정확히 일치');

  const source = '성격: 차분하고, 논리적인 분석가.\n취미: 별 관측';
  const normalized = findFuzzyCandidates(source, '성격 차분하고 논리적인 분석가');
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].kind, '공백·기호 차이');

  const bigram = findFuzzyCandidates('세계관: 마법과 증기기관이 공존하는 제국 수도\n기타 메모', '마법과 증기기관이 함께하는 제국의 수도');
  assert.ok(bigram.length >= 1);
  assert.equal(bigram[0].kind, '유사 구간');
});

test('buildDiffPreview produces accurate LCS diff lines and handles truncation', () => {
  const before = ['line1', 'line2', 'old line', 'line4', 'line5'].join('\n');
  const after = ['line1', 'line2', 'new line', 'extra line', 'line4', 'line5'].join('\n');
  const diff = buildDiffPreview(before, after);
  assert.equal(diff.removed, 1);
  assert.equal(diff.added, 2);
  assert.equal(diff.truncated, false);
  assert.ok(diff.lines.some(l => l.type === 'del' && l.text === 'old line'));
  assert.ok(diff.lines.some(l => l.type === 'add' && l.text === 'new line'));
  assert.ok(diff.lines.some(l => l.type === 'add' && l.text === 'extra line'));

  const empty = buildDiffPreview('', '');
  assert.deepEqual(empty, { lines: [], added: 0, removed: 0, truncated: false });

  const hugeBefore = Array.from({ length: 250 }, (_, i) => `a${i}`).join('\n');
  const hugeAfter = Array.from({ length: 250 }, (_, i) => `b${i}`).join('\n');
  const truncated = buildDiffPreview(hugeBefore, hugeAfter, 20);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.lines.length, 20);
});
