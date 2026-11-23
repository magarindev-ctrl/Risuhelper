import test from 'node:test';
import assert from 'node:assert/strict';
import { diffValues, revertOps } from '../src/undo-journal.js';

const lore = (comment, extra = {}) => ({ comment, key: comment.toLowerCase(), content: `body of ${comment}`, mode: 'normal', ...extra });

function roundTrip(before, after) {
  const ops = diffValues(before, after);
  // A journal must survive storage: only JSON-serialisable data, no closures.
  const stored = JSON.parse(JSON.stringify(ops));
  return { ops: stored, result: revertOps(structuredClone(after), stored) };
}

test('reverting a changed field restores the previous value and leaves the rest untouched', () => {
  const before = { name: 'A', desc: 'old', lore: [lore('One')] };
  const after = { name: 'A', desc: 'new', lore: [lore('One')] };
  const { ops, result } = roundTrip(before, after);
  assert.equal(ops.length, 1);
  assert.deepEqual(result.value, before);
  assert.equal(result.conflicts.length, 0);
});

test('reverting a field that did not exist before removes it again', () => {
  const { result } = roundTrip({ name: 'A' }, { name: 'A', depth_prompt: { depth: 0, prompt: 'x' } });
  assert.deepEqual(result.value, { name: 'A' });
});

test('reverting an appended list item removes it even after later items were added behind or before it', () => {
  const before = { lore: [lore('One')] };
  const after = { lore: [lore('One'), lore('Added')] };
  const ops = diffValues(before, after);
  const later = { lore: [lore('User Inserted First'), lore('One'), lore('Added'), lore('User Added Later')] };
  const result = revertOps(later, ops);
  assert.deepEqual(result.value.lore.map(e => e.comment), ['User Inserted First', 'One', 'User Added Later']);
  assert.equal(result.conflicts.length, 0);
});

test('reverting an appended item tolerates extra properties the host added to it', () => {
  const ops = diffValues({ lore: [] }, { lore: [lore('Added')] });
  const hostNormalised = { lore: [{ ...lore('Added'), id: 'host-generated', extentions: {} }] };
  const result = revertOps(hostNormalised, ops);
  assert.deepEqual(result.value.lore, []);
});

test('a field the user edited afterwards is reported as a conflict instead of being overwritten', () => {
  const ops = diffValues({ desc: 'old', note: 'n1' }, { desc: 'written by plugin', note: 'n2' });
  const result = revertOps({ desc: 'edited by the user later', note: 'n2' }, ops);
  assert.equal(result.value.desc, 'edited by the user later');
  assert.equal(result.value.note, 'n1');
  assert.equal(result.reverted, 1);
  assert.equal(result.conflicts.length, 1);
});

test('a folder reorganisation (append folder + retarget several entries) reverts as one unit', () => {
  const before = { lore: [lore('One'), lore('Two'), lore('Three', { folder: 'x' })] };
  const after = structuredClone(before);
  after.lore.push({ comment: '인물', key: 'folder:abc', mode: 'folder', content: '' });
  after.lore[0].folder = 'folder:abc';
  after.lore[2].folder = 'folder:abc';
  const { result } = roundTrip(before, after);
  assert.deepEqual(result.value, before);
});

test('entries of id-keyed lists are found by id even when the list order changed', () => {
  const before = { modules: [{ id: 'a', name: 'A', description: 'old' }, { id: 'b', name: 'B', description: 'keep' }] };
  const after = structuredClone(before);
  after.modules[0].description = 'new';
  const ops = diffValues(before, after);
  const reordered = { modules: [{ id: 'z', name: 'Installed later', description: '' }, { id: 'b', name: 'B', description: 'keep' }, { id: 'a', name: 'A', description: 'new' }] };
  const result = revertOps(reordered, ops);
  assert.equal(result.value.modules.find(m => m.id === 'a').description, 'old');
  assert.equal(result.value.modules.find(m => m.id === 'b').description, 'keep');
  assert.equal(result.conflicts.length, 0);
});

test('a list that got shorter or was replaced wholesale is restored as a whole', () => {
  const before = { triggerscript: [{ type: 'manual', effect: [] }, { type: 'start', effect: [] }] };
  const after = { triggerscript: [{ type: 'start', effect: [{ type: 'triggerlua', code: 'x' }] }] };
  const { result } = roundTrip(before, after);
  assert.deepEqual(result.value, before);
});

test('identical values produce no operations', () => {
  const v = { a: 1, b: [lore('One')], c: { d: null } };
  assert.deepEqual(diffValues(v, structuredClone(v)), []);
});
