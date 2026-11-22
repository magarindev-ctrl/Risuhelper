// SPDX-License-Identifier: GPL-3.0-only
// Zero-dependency RisuAI/RisuBard preset wire format decoder (.risup, .risupreset, .json, .preset).
// Uses native WebCrypto AES-256-GCM, DecompressionStream, RPack lookup map, and pure-JS MessagePack.

import { rpackMap } from './rpack-map.js';

const PRESET_LIMIT = 32 * 1024 * 1024; // 32 MiB
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

function byteLength(str) {
  return new TextEncoder().encode(String(str)).length;
}

function clone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Pure-JS MessagePack decoder supporting all standard types with depth/node bounds.
 */
function decodeMsgpack(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');
  let offset = 0;
  let nodes = 0;

  function readBytes(len) {
    assert(offset + len <= bytes.length, 'MessagePack 데이터가 잘렸습니다.');
    const slice = bytes.subarray(offset, offset + len);
    offset += len;
    return slice;
  }

  function readStr(len) {
    return decoder.decode(readBytes(len));
  }

  function readValue(depth = 0) {
    assert(depth < 80 && ++nodes < 400000, 'MessagePack 구조가 너무 깊거나 큽니다.');
    assert(offset < bytes.length, 'MessagePack 예기치 않은 종료입니다.');
    const b = bytes[offset++];

    if (b <= 0x7f) return b; // positive fixint
    if (b >= 0xe0) return b - 256; // negative fixint

    if ((b & 0xf0) === 0x80) return readMap(b & 0x0f, depth);
    if ((b & 0xf0) === 0x90) return readArray(b & 0x0f, depth);
    if ((b & 0xe0) === 0xa0) return readStr(b & 0x1f);

    switch (b) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return new Uint8Array(readBytes(readU8()));
      case 0xc5: return new Uint8Array(readBytes(readU16()));
      case 0xc6: return new Uint8Array(readBytes(readU32()));
      case 0xc7: { const len = readU8(); offset += 1; return new Uint8Array(readBytes(len)); }
      case 0xc8: { const len = readU16(); offset += 1; return new Uint8Array(readBytes(len)); }
      case 0xc9: { const len = readU32(); offset += 1; return new Uint8Array(readBytes(len)); }
      case 0xca: { const v = view.getFloat32(offset); offset += 4; return v; }
      case 0xcb: { const v = view.getFloat64(offset); offset += 8; return v; }
      case 0xcc: return readU8();
      case 0xcd: return readU16();
      case 0xce: return readU32();
      case 0xcf: { const v = Number(view.getBigUint64(offset)); offset += 8; return v; }
      case 0xd0: { const v = view.getInt8(offset); offset += 1; return v; }
      case 0xd1: { const v = view.getInt16(offset); offset += 2; return v; }
      case 0xd2: { const v = view.getInt32(offset); offset += 4; return v; }
      case 0xd3: { const v = Number(view.getBigInt64(offset)); offset += 8; return v; }
      case 0xd4: { offset += 1; return new Uint8Array(readBytes(1)); }
      case 0xd5: { offset += 1; return new Uint8Array(readBytes(2)); }
      case 0xd6: { offset += 1; return new Uint8Array(readBytes(4)); }
      case 0xd7: { offset += 1; return new Uint8Array(readBytes(8)); }
      case 0xd8: { offset += 1; return new Uint8Array(readBytes(16)); }
      case 0xd9: return readStr(readU8());
      case 0xda: return readStr(readU16());
      case 0xdb: return readStr(readU32());
      case 0xdc: return readArray(readU16(), depth);
      case 0xdd: return readArray(readU32(), depth);
      case 0xde: return readMap(readU16(), depth);
      case 0xdf: return readMap(readU32(), depth);
      default:
        throw new Error(`알 수 없는 MessagePack 태그: 0x${b.toString(16)}`);
    }
  }

  function readU8() {
    assert(offset + 1 <= bytes.length, 'MessagePack U8 범위 초과');
    return bytes[offset++];
  }
  function readU16() {
    assert(offset + 2 <= bytes.length, 'MessagePack U16 범위 초과');
    const v = view.getUint16(offset);
    offset += 2;
    return v;
  }
  function readU32() {
    assert(offset + 4 <= bytes.length, 'MessagePack U32 범위 초과');
    const v = view.getUint32(offset);
    offset += 4;
    return v;
  }
  function readArray(len, depth) {
    const arr = new Array(len);
    for (let i = 0; i < len; i++) arr[i] = readValue(depth + 1);
    return arr;
  }
  function readMap(len, depth) {
    const obj = {};
    for (let i = 0; i < len; i++) {
      const k = String(readValue(depth + 1));
      const v = readValue(depth + 1);
      if (!BAD_KEYS.has(k)) obj[k] = v;
    }
    return obj;
  }

  return readValue(0);
}

/**
 * Decompresses gzip / zlib-deflate / raw-deflate bytes using native DecompressionStream
 * with a strict 32MiB output limit.
 */
async function expandCompressed(data) {
  assert(typeof DecompressionStream === 'function', '이 환경은 DecompressionStream을 지원하지 않습니다.');

  const formats = [];
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    formats.push('gzip', 'deflate', 'deflate-raw');
  } else if (data.length >= 2 && (data[0] & 0x0f) === 0x08 && (((data[0] << 8) | data[1]) % 31 === 0)) {
    formats.push('deflate', 'deflate-raw', 'gzip');
  } else {
    formats.push('deflate-raw', 'deflate', 'gzip');
  }

  let lastError;
  for (const fmt of formats) {
    try {
      const ds = new DecompressionStream(fmt);
      const writer = ds.writable.getWriter();
      const writePromise = writer.write(data).then(() => writer.close());
      writePromise.catch(() => {});
      const reader = ds.readable.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        assert(total <= PRESET_LIMIT, '프리셋 압축 해제 크기가 32MiB를 초과했습니다.');
        chunks.push(value);
      }
      await writePromise;
      const out = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) {
        out.set(c, pos);
        pos += c.byteLength;
      }
      return out;
    } catch (err) {
      if (String(err?.message || '').includes('32MiB')) throw err;
      lastError = err;
    }
  }
  throw new Error('프리셋 압축 해제에 실패했습니다: ' + (lastError?.message || 'unknown'));
}

async function decryptRisupresetPayload(encrypted) {
  const subtle = globalThis.crypto?.subtle;
  assert(subtle, 'WebCrypto(crypto.subtle)를 사용할 수 없습니다.');
  const keyBytes = await subtle.digest('SHA-256', new TextEncoder().encode('risupreset'));
  const cryptoKey = await subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(12) },
    cryptoKey,
    encrypted
  );
  return new Uint8Array(plainBuf);
}

function checkTree(value, depth = 0, count = { n: 0 }) {
  assert(depth < 70 && ++count.n < 200000, '프리셋 데이터 구조가 너무 큽니다.');
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value)) {
    assert(!BAD_KEYS.has(k), '허용하지 않는 프리셋 키: ' + k);
    checkTree(v, depth + 1, count);
  }
}

const ALLOWED_PRESET_KEYS = [
  'name', 'description', 'mainPrompt', 'jailbreak', 'jailbreakToggle', 'chainOfThought',
  'globalNote', 'promptTemplate', 'formatingOrder', 'customPromptTemplateToggle',
  'templateDefaultVariables', 'promptSettings', 'promptBlockOverlay', 'moduleIntergration', 'regex',
];

function legacyBlocks(p) {
  const order = p.formatingOrder ?? ['main', 'description', 'personaPrompt', 'lorebook', 'chats', 'lastChat', 'globalNote', 'authorNote'];
  assert(Array.isArray(order), '구형 프롬프트 순서가 올바르지 않습니다.');
  return order.map(type => {
    if (['main', 'jailbreak', 'globalNote'].includes(type)) {
      return {
        type: 'plain',
        type2: type === 'jailbreak' ? 'normal' : type,
        name: type,
        role: 'system',
        text: p[type === 'main' ? 'mainPrompt' : type] ?? '',
      };
    }
    if (type === 'chats') return { type: 'chat', rangeStart: 0, rangeEnd: -1 };
    if (type === 'lastChat') return { type: 'chat', rangeStart: -1, rangeEnd: 'end' };
    if (type === 'personaPrompt') return { type: 'persona' };
    if (type === 'authorNote') return { type: 'authornote' };
    return { type };
  });
}

function normalizePreset(raw) {
  assert(raw && typeof raw === 'object' && !Array.isArray(raw), '프리셋 객체가 필요합니다.');
  checkTree(raw);
  assert(
    ['promptTemplate', 'mainPrompt', 'formatingOrder', 'customPromptTemplateToggle'].some(k => Object.hasOwn(raw, k)),
    '프롬프트 프리셋 필드를 찾지 못했습니다.'
  );

  const result = {};
  for (const k of ALLOWED_PRESET_KEYS) {
    if (Object.hasOwn(raw, k)) result[k] = clone(raw[k]);
  }
  for (const k of ['name', 'description', 'mainPrompt', 'jailbreak', 'globalNote', 'customPromptTemplateToggle', 'templateDefaultVariables', 'moduleIntergration']) {
    if (result[k] === undefined) result[k] = '';
    assert(typeof result[k] === 'string', '프리셋 문자열 형식 오류: ' + k);
  }
  result.name ||= '가져온 프리셋';

  for (const k of ['jailbreakToggle', 'chainOfThought']) {
    if (k in result) assert(typeof result[k] === 'boolean', '프롬프트 활성화 설정 형식 오류: ' + k);
  }
  if (result.regex !== undefined) assert(Array.isArray(result.regex), '프리셋 정규식은 배열이어야 합니다.');
  if (result.promptBlockOverlay !== undefined) {
    assert(result.promptBlockOverlay && typeof result.promptBlockOverlay === 'object' && !Array.isArray(result.promptBlockOverlay), '오버레이 설정은 객체여야 합니다.');
  }
  if (result.promptSettings !== undefined) {
    assert(result.promptSettings && typeof result.promptSettings === 'object' && !Array.isArray(result.promptSettings), '프롬프트 옵션은 객체여야 합니다.');
  }
  if (result.promptTemplate == null) result.promptTemplate = legacyBlocks(result);
  assert(Array.isArray(result.promptTemplate) && result.promptTemplate.length <= 500, '프롬프트 블록은 500개 이하 배열이어야 합니다.');

  for (const b of result.promptTemplate) {
    assert(b && typeof b === 'object' && !Array.isArray(b) && typeof b.type === 'string', '잘못된 프롬프트 블록입니다.');
    for (const k of ['text', 'innerFormat', 'defaultText', 'name']) {
      if (k in b) assert(typeof b[k] === 'string', '블록 문자열 형식 오류: ' + k);
    }
    if ('enabled' in b) assert(typeof b.enabled === 'boolean', '블록 활성화 형식이 올바르지 않습니다.');
  }

  assert(byteLength(JSON.stringify(result)) <= PRESET_LIMIT, '프리셋이 32MiB를 초과했습니다.');
  return result;
}

/**
 * Decodes .risup, .risupreset, .json, or .preset bytes into a normalized RisuAI prompt preset.
 */
async function decodePreset(data, name = 'preset.risup') {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  assert(bytes.length <= PRESET_LIMIT, '프리셋 파일은 32MiB 이하만 지원합니다.');

  let raw;
  if (/\.(risup|risupreset)$/i.test(name)) {
    const packed = /\.risup$/i.test(name) ? bytes.map(x => rpackMap[x + 256]) : bytes;
    let wrapper;
    try {
      const inflated = await expandCompressed(packed);
      wrapper = decodeMsgpack(inflated);
    } catch (err) {
      throw new Error('프리셋 압축·MessagePack을 읽지 못했습니다: ' + err.message);
    }
    assert(wrapper && [0, 2].includes(wrapper.presetVersion) && wrapper.type === 'preset', '지원하지 않는 프리셋 파일 버전입니다.');
    const encrypted = wrapper.preset ?? wrapper.pres;
    assert(encrypted instanceof Uint8Array && encrypted.length <= PRESET_LIMIT, '암호화된 프리셋 본문이 올바르지 않습니다.');
    try {
      const decrypted = await decryptRisupresetPayload(encrypted);
      raw = decodeMsgpack(decrypted);
    } catch {
      throw new Error('프리셋 복호화·본문 해석에 실패했습니다. 파일 손상 또는 지원하지 않는 형식입니다.');
    }
  } else {
    try {
      raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new Error('UTF-8 프리셋 JSON을 읽지 못했습니다.');
    }
  }

  const result = normalizePreset(raw);
  for (const block of result.promptTemplate) {
    delete block.workshopError;
    delete block.workshopDraft;
  }
  return result;
}

export { decodeMsgpack, normalizePreset, decodePreset, PRESET_LIMIT };
