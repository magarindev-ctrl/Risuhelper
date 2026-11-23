// Regression tests against DOM snapshots recorded from real hosts (kwaroran/Risuai, PocketRisu).
// Each case focuses one real field; the expected target comes from the value the host bound
// into that field at capture time, so a wrong label heuristic cannot agree with itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectFocusedElement } from '../src/focus-detector.js';
import { listFixtures, loadFixture, buildFixtureDocument } from './helpers/fixture-dom.mjs';

// Targets a replace_text / patch_text proposal could be written to.
const WRITABLE_KINDS = new Set([
  'char_field', 'char_lorebook', 'chat_lorebook', 'char_lua', 'char_regex', 'char_alt_greeting',
  'chat_note', 'chat_message', 'persona', 'module_field', 'module_lorebook', 'module_lua', 'module_regex',
]);

function isWritableTarget(ctx) {
  if (!ctx) return false;
  if (WRITABLE_KINDS.has(ctx.targetKind)) return true;
  return ctx.targetKind === 'config' && Boolean(ctx.fieldKey);
}

function describeCtx(ctx) {
  if (!ctx) return 'null';
  const idx = ctx.loreIndex ?? ctx.regexIndex;
  return `${ctx.targetKind}/${ctx.fieldKey}${Number.isInteger(idx) ? `#${idx}` : ''} «${ctx.labelText}»`;
}

const fixtures = listFixtures();

test('host DOM fixtures are present', () => {
  assert.ok(fixtures.length >= 30, `expected recorded host fixtures, found ${fixtures.length}`);
});

for (const file of fixtures) {
  const fixture = loadFixture(file);
  const title = `${fixture.host} ${fixture.lang} · ${fixture.screen}`;

  test(`${title}: every field resolves to the data the host bound to it`, async () => {
    const failures = [];
    for (const c of fixture.cases) {
      const rootDoc = buildFixtureDocument(fixture, c.path);
      const ctx = await inspectFocusedElement(rootDoc);
      const where = `<${c.tag}> value="${c.value}"${c.placeholder ? ` placeholder="${c.placeholder}"` : ''}`;

      if (c.expect.writable === false) {
        if (isWritableTarget(ctx)) {
          failures.push(`${where}: expected no writable target, got ${describeCtx(ctx)}`);
        }
        continue;
      }

      const problems = [];
      if (ctx?.targetKind !== c.expect.targetKind) problems.push('targetKind');
      if (ctx?.fieldKey !== c.expect.fieldKey) problems.push('fieldKey');
      if (Number.isInteger(c.expect.loreIndex) && ctx?.loreIndex !== c.expect.loreIndex) problems.push('loreIndex');
      if (Number.isInteger(c.expect.regexIndex) && ctx?.regexIndex !== c.expect.regexIndex) problems.push('regexIndex');
      if (problems.length > 0) {
        const idx = c.expect.loreIndex ?? c.expect.regexIndex;
        failures.push(
          `${where}: expected ${c.expect.targetKind}/${c.expect.fieldKey}${Number.isInteger(idx) ? `#${idx}` : ''}, got ${describeCtx(ctx)}`
        );
      }
    }
    assert.deepEqual(failures, [], `${failures.length} of ${fixture.cases.length} fields misdetected`);
  });
}
