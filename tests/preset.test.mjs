import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { rpackMap } from '../src/rpack-map.js';
import { decodeMsgpack, decodePreset, normalizePreset } from '../src/preset-format.js';
import { calculatePreset } from '../src/preset-calc.js';
import { parseToggleTree, compileV2, parseV2 } from '../src/preset-v2.js';
import {
  newPresetState,
  assembleRisuHelperMessages,
  renderPresetText,
} from '../src/preset-engine.js';

// Minimal MessagePack encoder for generating real binary .risup / .risupreset test fixtures
function encodeMsgpack(value) {
  const parts = [];
  const pushU8 = (n) => parts.push(Uint8Array.of(n & 0xff));
  const pushU16 = (n) => parts.push(Uint8Array.of((n >> 8) & 0xff, n & 0xff));
  const pushU32 = (n) => parts.push(Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff));

  function write(v) {
    if (v === null || v === undefined) { pushU8(0xc0); return; }
    if (typeof v === 'boolean') { pushU8(v ? 0xc3 : 0xc2); return; }
    if (typeof v === 'number' && Number.isInteger(v)) {
      if (v >= 0 && v <= 0x7f) { pushU8(v); return; }
      if (v >= -32 && v < 0) { pushU8(256 + v); return; }
      if (v >= 0 && v <= 0xffff) { pushU8(0xcd); pushU16(v); return; }
      pushU8(0xd2); pushU32(v >>> 0); return;
    }
    if (typeof v === 'string') {
      const b = new TextEncoder().encode(v);
      if (b.length <= 31) { pushU8(0xa0 | b.length); }
      else if (b.length <= 255) { pushU8(0xd9); pushU8(b.length); }
      else { pushU8(0xda); pushU16(b.length); }
      parts.push(b);
      return;
    }
    if (v instanceof Uint8Array) {
      if (v.length <= 255) { pushU8(0xc4); pushU8(v.length); }
      else if (v.length <= 65535) { pushU8(0xc5); pushU16(v.length); }
      else { pushU8(0xc6); pushU32(v.length); }
      parts.push(v);
      return;
    }
    if (Array.isArray(v)) {
      if (v.length <= 15) { pushU8(0x90 | v.length); }
      else { pushU8(0xdc); pushU16(v.length); }
      for (const item of v) write(item);
      return;
    }
    const entries = Object.entries(v);
    if (entries.length <= 15) { pushU8(0x80 | entries.length); }
    else { pushU8(0xde); pushU16(entries.length); }
    for (const [k, val] of entries) {
      write(k);
      write(val);
    }
  }

  write(value);
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

async function buildBinaryPreset(rawPreset, format = 'risup') {
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('risupreset'));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const inner = encodeMsgpack(rawPreset);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, cryptoKey, inner)
  );
  const wrapper = encodeMsgpack({ presetVersion: 2, type: 'preset', preset: encrypted });
  const compressed = new Uint8Array(deflateSync(wrapper));
  if (format === 'risup') {
    return compressed.map(b => rpackMap[b]);
  }
  return compressed;
}

test('rpackMap is a valid 512-byte bijective encode/decode lookup table', () => {
  assert.equal(rpackMap.length, 512);
  for (let b = 0; b < 256; b++) {
    const encoded = rpackMap[b];
    const decoded = rpackMap[encoded + 256];
    assert.equal(decoded, b, `RPack round-trip failed for byte ${b}`);
  }
});

test('decodePreset decodes real binary .risup, .risupreset, and .json formats and blocks prototype pollution', async () => {
  const samplePreset = {
    name: '테스트 프리셋',
    mainPrompt: 'Main instructions',
    customPromptTemplateToggle: 'mode=모드=select=기본,상세\nstrict=엄격=switch',
    promptTemplate: [
      { type: 'plain', name: 'Main', role: 'system', text: '{{#when::toggle::strict}}STRICT{{/when}} {{char}}' },
      { type: 'lorebook', role2: 'system' },
      { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
      { type: 'cache', depth: 1, role: 'all' },
    ],
  };

  const risupBytes = await buildBinaryPreset(samplePreset, 'risup');
  const fromRisup = await decodePreset(risupBytes, 'my.risup');
  assert.equal(fromRisup.name, '테스트 프리셋');
  assert.equal(fromRisup.promptTemplate.length, 4);

  const risupresetBytes = await buildBinaryPreset(samplePreset, 'risupreset');
  const fromRisupreset = await decodePreset(risupresetBytes, 'my.risupreset');
  assert.equal(fromRisupreset.name, '테스트 프리셋');

  const jsonBytes = new TextEncoder().encode(JSON.stringify(samplePreset));
  const fromJson = await decodePreset(jsonBytes, 'my.json');
  assert.equal(fromJson.name, '테스트 프리셋');

  // Corrupted compressed payload rejects cleanly without unhandled promise rejection
  await assert.rejects(
    () => decodePreset(new Uint8Array([0x1f, 0x8b, 0x00, 0x01, 0x02, 0x03]), 'broken.risupreset'),
    /압축/
  );

  // MessagePack strips __proto__
  const polluted = encodeMsgpack({ __proto__: { hacked: true }, ok: 1 });
  const decodedMap = decodeMsgpack(polluted);
  assert.equal(decodedMap.ok, 1);
  assert.equal(({}).hacked, undefined);
});

test('calculatePreset and V2 condition compiler/parser work cleanly', () => {
  assert.equal(calculatePreset('(2 + 3) * 4'), '20');
  assert.equal(calculatePreset('$hp <= 10 && @toggle_hard == 1', { variables: { hp: '5' }, globals: { toggle_hard: '1' } }), '1');

  const tree = parseToggleTree('=그룹=group\nstyle=문체=select=간결,서정\n=끝=groupEnd');
  assert.equal(tree.definitions.length, 1);
  assert.equal(tree.definitions[0].key, 'toggle_style');
  assert.equal(tree.definitions[0].group, '그룹');

  const activation = {
    join: 'and',
    conditions: [
      { key: 'toggle_style', operator: 'is', value: '1' },
      { key: 'toggle_level', operator: 'greaterequal', value: '2' },
    ],
  };
  const compiled = compileV2('본문 내용', activation);
  const parsed = parseV2(compiled);
  assert.equal(parsed.body, '본문 내용');
  assert.deepEqual(parsed.activation, activation);
});

test('assembleRisuHelperMessages handles direct vs preset mode, CBS, cachePoint, and module @@ relaxation', () => {
  const directMessages = [
    { role: 'system', content: 'RisuHelper system guide' },
    { role: 'user', content: '캐릭터 설명 다듬어 줘' },
  ];

  // 1. Direct mode passes through untouched
  const directOut = assembleRisuHelperMessages({
    presetState: newPresetState(),
    directMessages,
  });
  assert.equal(directOut.mode, 'direct');
  assert.equal(directOut.issues.length, 0);
  assert.deepEqual(directOut.messages, directMessages);

  // 2. Preset mode with CBS, toggles, cachePoint, and module lorebook (@@ decorator strict vs relaxed)
  const preset = normalizePreset({
    name: '봇빌더 호환 프리셋',
    customPromptTemplateToggle: 'detail=상세=switch',
    promptTemplate: [
      { type: 'plain', name: 'Sys', role: 'system', text: '캐릭터={{char}} 상세={{#when::toggle::detail}}ON{{:else}}OFF{{/when}}' },
      { type: 'lorebook', role2: 'system' },
      { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
      { type: 'cache', depth: 1, role: 'user' },
    ],
  });

  const modWithDecorator = {
    id: 'mod-lore',
    name: '세계관 모듈',
    namespace: 'world',
    lorebook: [{ comment: '규칙', key: 'r', content: '@@depth 2\n마법 규칙 본문' }],
    regex: [{ comment: '표시', type: 'editdisplay', in: 'a', out: 'b' }],
    trigger: [],
  };

  // Without relaxConditions, @@ decorator triggers an issue
  const strictState = {
    ...newPresetState(),
    mode: 'preset',
    preset,
    values: { toggle_detail: '1' },
    modules: [modWithDecorator],
    moduleOptions: { 'mod-lore': { skipRuntime: false, excludedLore: [], relaxConditions: false } },
  };
  const strictOut = assembleRisuHelperMessages({
    presetState: strictState,
    directMessages,
    activeChar: { name: '세라', desc: '마도사' },
  });
  assert.ok(strictOut.issues.some(msg => msg.includes('@@ 위치·활성화 지시')));

  // With relaxConditions: true, @@ line is stripped and body is included cleanly
  const relaxedState = {
    ...strictState,
    moduleOptions: { 'mod-lore': { skipRuntime: false, excludedLore: [], relaxConditions: true } },
  };
  const relaxedOut = assembleRisuHelperMessages({
    presetState: relaxedState,
    directMessages,
    activeChar: { name: '세라', desc: '마도사' },
  });
  assert.equal(relaxedOut.issues.length, 0);
  assert.equal(relaxedOut.messages.length, 3);
  assert.equal(relaxedOut.messages[0].content, '캐릭터=세라 상세=ON');
  assert.match(relaxedOut.messages[1].content, /마법 규칙 본문/);
  assert.ok(!relaxedOut.messages[1].content.includes('@@depth'));
  assert.match(relaxedOut.messages[2].content, /\[RisuHelper 작업 지침\]/);
  assert.equal(relaxedOut.messages[2].cachePoint, true);

  // CBS {{userinput}} stays literal
  const literalText = renderPresetText('Keep {{user_input}}', {
    globals: {},
    variables: {},
    fields: {},
    nativeLiterals: new Set(),
  });
  assert.equal(literalText, 'Keep {{user_input}}');
});
