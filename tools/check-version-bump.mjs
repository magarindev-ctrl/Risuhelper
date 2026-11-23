#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// CI guard: when dist/risuhelper.js changes, its //@version must increase.
// RisuAI offers a plugin update only if the remote //@version is strictly greater than the
// installed one, so shipping a changed bundle under the same version strands existing installs.
//
// Usage: node tools/check-version-bump.mjs <base-git-ref>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE_REL = 'dist/risuhelper.js';

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function readVersion(bundle) {
  const m = String(bundle || '').match(/^\/\/@version\s+(\S+)/m);
  return m ? m[1] : null;
}

function evaluateVersionBump({ baseBundle, headBundle }) {
  if (baseBundle === null || baseBundle === undefined) {
    return { ok: true, reason: 'no base bundle to compare against' };
  }
  if (baseBundle === headBundle) {
    return { ok: true, reason: 'bundle unchanged' };
  }
  const baseVersion = readVersion(baseBundle);
  const headVersion = readVersion(headBundle);
  if (!baseVersion || !headVersion) {
    return { ok: false, reason: `missing //@version header (base=${baseVersion}, head=${headVersion})` };
  }
  if (compareVersions(headVersion, baseVersion) !== 1) {
    return {
      ok: false,
      reason: `${BUNDLE_REL} changed but //@version did not increase (${baseVersion} -> ${headVersion}). ` +
        'Bump "version" in package.json and src/version.js, then rebuild.',
    };
  }
  return { ok: true, reason: `version bumped ${baseVersion} -> ${headVersion}` };
}

function readBaseBundle(baseRef) {
  if (!baseRef || /^0+$/.test(baseRef)) return null;
  try {
    return execFileSync('git', ['show', `${baseRef}:${BUNDLE_REL}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const baseRef = process.argv[2] || '';
  const res = evaluateVersionBump({
    baseBundle: readBaseBundle(baseRef),
    headBundle: fs.readFileSync(path.join(ROOT, BUNDLE_REL), 'utf8'),
  });
  console.log(`[version-bump] ${res.ok ? 'ok' : 'FAILED'}: ${res.reason}`);
  process.exit(res.ok ? 0 : 1);
}

export { compareVersions, evaluateVersionBump };
