#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Zero-dependency ESM -> single-file IIFE bundler for the temporary in-RisuAI 20-scenario evaluator plugin.
// Outputs dist/risuhelper-eval.js without modifying dist/risuhelper.js.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const ENTRY_REL = 'tools/eval-plugin-entry.js';
const OUT_FILE = path.join(ROOT, 'dist', 'risuhelper-eval.js');

const HEADER_LINES = [
  '//@name risuhelper-eval',
  '//@display-name RisuHelper 실모델 평가기 (임시)',
  '//@api 3.0',
  `//@version ${VERSION}`,
];

function assert(ok, message) {
  if (!ok) throw new Error(`[build-eval] ${message}`);
}

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

function resolveRelativeModule(fromRel, specifier) {
  assert(specifier.startsWith('./') || specifier.startsWith('../'), `External runtime imports are forbidden: "${specifier}" in ${fromRel}`);
  const fromDir = path.dirname(path.join(ROOT, fromRel));
  const resolvedAbs = path.resolve(fromDir, specifier);
  const rel = toPosix(path.relative(ROOT, resolvedAbs));
  assert(fs.existsSync(resolvedAbs), `Missing imported module "${specifier}" (resolved ${rel}) from ${fromRel}`);
  return rel;
}

function transformModule(relPath) {
  const absPath = path.join(ROOT, relPath);
  const source = fs.readFileSync(absPath, 'utf8');
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const deps = [];
  const outLines = [];
  const exportAssignments = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (/^(?:import|export)\s+\{/.test(line) && !line.includes('}')) {
      let combined = line;
      while (i + 1 < lines.length && !combined.includes('}')) {
        i++;
        combined += ' ' + lines[i].trim();
      }
      if (combined.startsWith('import') && !/\bfrom\s+['"]/.test(combined) && i + 1 < lines.length) {
        i++;
        combined += ' ' + lines[i].trim();
      }
      line = combined;
    }

    const namedImport = line.match(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/);
    if (namedImport) {
      const targetRel = resolveRelativeModule(relPath, namedImport[2]);
      deps.push(targetRel);
      const specifiers = namedImport[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
          const alias = s.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
          return alias ? `${alias[1]}: ${alias[2]}` : s;
        });
      outLines.push(`const { ${specifiers.join(', ')} } = __require(${JSON.stringify(targetRel)});`);
      continue;
    }

    const nsImport = line.match(/^import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?\s*$/);
    if (nsImport) {
      const targetRel = resolveRelativeModule(relPath, nsImport[2]);
      deps.push(targetRel);
      outLines.push(`const ${nsImport[1]} = __require(${JSON.stringify(targetRel)});`);
      continue;
    }

    const defImport = line.match(/^import\s+([A-Za-z0-9_$]+)\s+from\s+['"]([^'"]+)['"];?\s*$/);
    if (defImport) {
      const targetRel = resolveRelativeModule(relPath, defImport[2]);
      deps.push(targetRel);
      outLines.push(`const ${defImport[1]} = __require(${JSON.stringify(targetRel)}).default;`);
      continue;
    }

    assert(!/^import\s+/.test(line), `Unsupported import syntax in ${relPath}:${i + 1}: ${line}`);

    const exportList = line.match(/^export\s+\{([^}]+)\};?\s*$/);
    if (exportList) {
      for (const rawSpec of exportList[1].split(',').map(s => s.trim()).filter(Boolean)) {
        const alias = rawSpec.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
        if (alias) exportAssignments.push(`  __exports.${alias[2]} = ${alias[1]};`);
        else exportAssignments.push(`  __exports.${rawSpec} = ${rawSpec};`);
      }
      continue;
    }

    const exportDecl = line.match(/^export\s+(?:(async\s+function|function|class|const|let|var)\s+([A-Za-z0-9_$]+))/);
    if (exportDecl) {
      outLines.push(line.replace(/^export\s+/, ''));
      exportAssignments.push(`  __exports.${exportDecl[2]} = ${exportDecl[2]};`);
      continue;
    }

    assert(!/^export\s+/.test(line), `Unsupported export syntax in ${relPath}:${i + 1}: ${line}`);
    outLines.push(line);
  }

  while (outLines.length > 0 && outLines[outLines.length - 1] === '') outLines.pop();
  if (exportAssignments.length > 0) {
    outLines.push('');
    outLines.push(...exportAssignments);
  }

  return { relPath, deps, body: outLines.join('\n') };
}

function collectGraph(entryRel) {
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];

  function visit(relPath) {
    if (visited.has(relPath)) return;
    assert(!visiting.has(relPath), `Circular dependency detected at ${relPath}`);
    visiting.add(relPath);
    const mod = transformModule(relPath);
    for (const dep of mod.deps) visit(dep);
    visiting.delete(relPath);
    visited.add(relPath);
    ordered.push(mod);
  }

  visit(entryRel);
  return ordered;
}

function buildEvalPlugin() {
  const headerText = HEADER_LINES.join('\n') + '\n';
  const headerBytes = Buffer.byteLength(headerText, 'utf8');
  assert(headerBytes <= 500, `Plugin v3 header exceeds 500-byte limit (${headerBytes} bytes)`);

  const modules = collectGraph(ENTRY_REL);
  const moduleBlocks = modules.map((mod, idx) => {
    const comma = idx < modules.length - 1 ? ',' : '';
    return `  ${JSON.stringify(mod.relPath)}(__require, __exports) {\n${mod.body}\n\n  }${comma}`;
  });

  const bundle = [
    headerText.trimEnd(),
    '',
    '/*',
    ` * RisuHelper 20-Scenario Evaluator Plugin (temporary dev tool, v${VERSION})`,
    ' * License: GPL-3.0-only',
    ' */',
    '(() => {',
    "  'use strict';",
    '  const __modules = {',
    ...moduleBlocks,
    '  };',
    '  const __cache = Object.create(null);',
    '  function __require(id) {',
    '    if (__cache[id]) return __cache[id].exports;',
    '    const factory = __modules[id];',
    "    if (!factory) throw new Error('[RisuHelper-Eval] Missing module: ' + id);",
    '    const mod = { exports: {} };',
    '    __cache[id] = mod;',
    '    factory(__require, mod.exports);',
    '    return mod.exports;',
    '  }',
    `  __require(${JSON.stringify(ENTRY_REL)});`,
    '})();',
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, bundle, 'utf8');
  execFileSync(process.execPath, ['--check', OUT_FILE], { stdio: 'inherit' });

  const totalBytes = Buffer.byteLength(bundle, 'utf8');
  console.log(
    `[build-eval] Built ${toPosix(path.relative(ROOT, OUT_FILE))} ` +
    `(v${VERSION}, ${modules.length} modules, header ${headerBytes}B / 500B, bundle ${(totalBytes / 1024).toFixed(1)} KiB)`
  );
}

buildEvalPlugin();
