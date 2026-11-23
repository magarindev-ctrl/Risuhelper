import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, evaluateVersionBump } from '../tools/check-version-bump.mjs';

// RisuAI only offers a plugin update when the remote //@version is strictly greater than the
// installed one, so a changed bundle with an unchanged version never reaches existing users.

test('compareVersions orders dotted versions numerically', () => {
  assert.equal(compareVersions('0.4.0', '0.3.9'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
  assert.equal(compareVersions('0.3.3', '0.4.0'), -1);
});

test('a changed bundle with the same version is rejected', () => {
  const res = evaluateVersionBump({ baseBundle: '//@version 0.4.0\nold', headBundle: '//@version 0.4.0\nnew' });
  assert.equal(res.ok, false);
});

test('a changed bundle with a greater version is accepted', () => {
  const res = evaluateVersionBump({ baseBundle: '//@version 0.3.3\nold', headBundle: '//@version 0.4.0\nnew' });
  assert.equal(res.ok, true);
});

test('an unchanged bundle needs no version bump, and a missing base bundle is skipped', () => {
  assert.equal(evaluateVersionBump({ baseBundle: '//@version 0.4.0\nsame', headBundle: '//@version 0.4.0\nsame' }).ok, true);
  assert.equal(evaluateVersionBump({ baseBundle: null, headBundle: '//@version 0.4.0\nnew' }).ok, true);
});
