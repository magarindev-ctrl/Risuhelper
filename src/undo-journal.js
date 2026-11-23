// Serialisable undo journal.
//
// A change is recorded as the list of operations that turn the entity's previous state into
// the state RisuHelper wrote. Operations are plain JSON, so the journal can be persisted and
// replayed after a reload. Reverting is guarded: an operation is only undone while the host
// still holds the value RisuHelper wrote, so later edits by the user are reported as conflicts
// instead of being overwritten.

const ID_KEYS = ['id', 'chatId'];
const ANCHOR_KEYS = ['comment', 'key', 'name', 'title'];
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// The live entity is cloned structurally (keeps values JSON cannot represent); recorded operation
// values are always JSON.
function cloneDeep(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return cloneJson(value);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).filter(k => a[k] !== undefined);
    const kb = Object.keys(b).filter(k => b[k] !== undefined);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

/**
 * True while `current` still holds what was written. Objects may have gained extra properties
 * (hosts normalise saved entries), but every written property must be unchanged.
 */
function matchesWritten(current, written) {
  if (current === written) return true;
  if (Array.isArray(written)) {
    if (!Array.isArray(current) || current.length !== written.length) return false;
    for (let i = 0; i < written.length; i++) if (!matchesWritten(current[i], written[i])) return false;
    return true;
  }
  if (isPlainObject(written)) {
    if (!isPlainObject(current)) return false;
    for (const k of Object.keys(written)) {
      if (written[k] === undefined) continue;
      if (!matchesWritten(current[k], written[k])) return false;
    }
    return true;
  }
  return false;
}

function uniqueIdKey(...lists) {
  for (const key of ID_KEYS) {
    const ok = lists.every(list => {
      const seen = new Set();
      for (const el of list) {
        if (!isPlainObject(el) || typeof el[key] !== 'string' || !el[key] || seen.has(el[key])) return false;
        seen.add(el[key]);
      }
      return true;
    });
    if (ok && lists.some(list => list.length > 0)) return key;
  }
  return null;
}

function anchorOf(element) {
  if (!isPlainObject(element)) return null;
  const anchor = {};
  for (const k of ANCHOR_KEYS) {
    if (typeof element[k] === 'string') anchor[k] = element[k];
  }
  return Object.keys(anchor).length > 0 ? anchor : null;
}

function indexSegment(index, element) {
  const anchor = anchorOf(element);
  return anchor ? { i: index, a: anchor } : index;
}

/**
 * Computes the operations that turn `before` into `after`.
 * Path segments: object key (string), list index (number), `{ k, v }` (list element whose
 * id-like property `k` equals `v`), or `{ i, a }` (list index plus identifying properties).
 */
function diffValues(before, after, path = [], ops = []) {
  if (deepEqual(before, after)) return ops;

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (BAD_KEYS.has(key)) continue;
      const inBefore = Object.hasOwn(before, key) && before[key] !== undefined;
      const inAfter = Object.hasOwn(after, key) && after[key] !== undefined;
      if (inBefore && inAfter) {
        diffValues(before[key], after[key], [...path, key], ops);
      } else if (inAfter) {
        ops.push({ op: 'set', path: [...path, key], had: false, value: cloneJson(after[key]) });
      } else if (inBefore) {
        ops.push({ op: 'set', path: [...path, key], had: true, old: cloneJson(before[key]), gone: true });
      }
    }
    return ops;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const idKey = uniqueIdKey(before, after);
    if (idKey) {
      const afterById = new Map(after.map(el => [el[idKey], el]));
      const beforeIds = new Set(before.map(el => el[idKey]));
      if (before.every(el => afterById.has(el[idKey]))) {
        for (const el of before) {
          diffValues(el, afterById.get(el[idKey]), [...path, { k: idKey, v: el[idKey] }], ops);
        }
        after.forEach((el, index) => {
          if (!beforeIds.has(el[idKey])) ops.push({ op: 'insert', path: [...path], index, value: cloneJson(el) });
        });
        return ops;
      }
    } else if (after.length >= before.length) {
      for (let i = 0; i < before.length; i++) {
        diffValues(before[i], after[i], [...path, indexSegment(i, after[i])], ops);
      }
      for (let i = before.length; i < after.length; i++) {
        ops.push({ op: 'insert', path: [...path], index: i, value: cloneJson(after[i]) });
      }
      return ops;
    }
  }

  ops.push({ op: 'set', path: [...path], had: true, old: cloneJson(before), value: cloneJson(after) });
  return ops;
}

function anchorMatches(element, anchor) {
  if (!isPlainObject(element)) return false;
  return Object.keys(anchor).every(k => element[k] === anchor[k]);
}

function stepInto(container, seg, anchorCache = null) {
  if (typeof seg === 'string') {
    if (!isPlainObject(container) || BAD_KEYS.has(seg)) return null;
    return { parent: container, key: seg };
  }
  if (!Array.isArray(container)) return null;
  if (typeof seg === 'number') {
    return seg >= 0 && seg < container.length ? { parent: container, key: seg } : null;
  }
  if (seg && typeof seg === 'object' && 'k' in seg) {
    const idx = container.findIndex(el => isPlainObject(el) && el[seg.k] === seg.v);
    return idx === -1 ? null : { parent: container, key: idx };
  }
  if (seg && typeof seg === 'object' && 'i' in seg) {
    const cacheKey = anchorCache ? JSON.stringify(seg) : null;
    if (anchorCache) {
      const cached = anchorCache.get(container)?.get(cacheKey);
      if (cached !== undefined) {
        const curIdx = container.indexOf(cached);
        return curIdx === -1 ? null : { parent: container, key: curIdx };
      }
    }
    let foundIdx = -1;
    if (seg.i >= 0 && seg.i < container.length && anchorMatches(container[seg.i], seg.a)) {
      foundIdx = seg.i;
    } else {
      const hits = [];
      container.forEach((el, idx) => { if (anchorMatches(el, seg.a)) hits.push(idx); });
      if (hits.length === 1) foundIdx = hits[0];
    }
    if (foundIdx === -1) return null;
    if (anchorCache) {
      let bySeg = anchorCache.get(container);
      if (!bySeg) {
        bySeg = new Map();
        anchorCache.set(container, bySeg);
      }
      bySeg.set(cacheKey, container[foundIdx]);
    }
    return { parent: container, key: foundIdx };
  }
  return null;
}

function locate(root, path, anchorCache = null) {
  let container = root;
  let slot = null;
  for (let n = 0; n < path.length; n++) {
    slot = stepInto(container, path[n], anchorCache);
    if (!slot) return null;
    if (n < path.length - 1) container = slot.parent[slot.key];
  }
  return slot;
}

function resolveValue(root, path, anchorCache = null) {
  if (path.length === 0) return { found: true, value: root };
  const slot = locate(root, path, anchorCache);
  if (!slot) return { found: false };
  return { found: true, value: slot.parent[slot.key] };
}

function describePath(path) {
  return path.map(seg => {
    if (typeof seg === 'string') return seg;
    if (typeof seg === 'number') return `#${seg + 1}`;
    if ('k' in seg) return String(seg.v);
    return seg.a?.comment || seg.a?.name || seg.a?.title || `#${seg.i + 1}`;
  }).join(' › ');
}

/**
 * Undoes `ops` on `current` (not mutated). Returns the reverted value, how many operations were
 * undone, and the operations that were skipped because the host no longer holds what was written.
 */
function revertOps(current, ops) {
  let root = cloneDeep(current);
  let reverted = 0;
  const conflicts = [];
  // Keep anchored element identity stable within a single revert pass so reverting an anchor
  // property (e.g. `comment` or `key`) never breaks locating the same element for its sibling ops.
  const anchorCache = new WeakMap();

  for (let n = ops.length - 1; n >= 0; n--) {
    const op = ops[n];
    const where = describePath(op.path);

    if (op.op === 'insert') {
      const target = resolveValue(root, op.path, anchorCache);
      if (!target.found || !Array.isArray(target.value)) {
        conflicts.push({ path: where, reason: '추가했던 항목이 들어 있던 목록을 찾을 수 없습니다.' });
        continue;
      }
      const list = target.value;
      let at = -1;
      if (op.index < list.length && matchesWritten(list[op.index], op.value)) {
        at = op.index;
      } else {
        for (let i = list.length - 1; i >= 0; i--) {
          if (matchesWritten(list[i], op.value)) { at = i; break; }
        }
      }
      if (at === -1) {
        conflicts.push({ path: where, reason: '추가했던 항목이 이후 수정되었거나 삭제되었습니다.' });
        continue;
      }
      list.splice(at, 1);
      reverted++;
      continue;
    }

    if (op.path.length === 0) {
      if (!matchesWritten(root, op.value)) {
        conflicts.push({ path: '(전체)', reason: '적용 이후 값이 다시 변경되었습니다.' });
        continue;
      }
      root = cloneJson(op.old);
      reverted++;
      continue;
    }

    const slot = locate(root, op.path, anchorCache);
    if (!slot) {
      conflicts.push({ path: where, reason: '대상 항목을 찾을 수 없습니다.' });
      continue;
    }
    const exists = Array.isArray(slot.parent)
      ? true
      : Object.hasOwn(slot.parent, slot.key) && slot.parent[slot.key] !== undefined;
    const untouched = op.gone ? !exists : (exists && matchesWritten(slot.parent[slot.key], op.value));
    if (!untouched) {
      conflicts.push({ path: where, reason: '적용 이후 값이 다시 변경되었습니다.' });
      continue;
    }
    if (op.had) slot.parent[slot.key] = cloneJson(op.old);
    else delete slot.parent[slot.key];
    reverted++;
  }

  return { value: root, reverted, conflicts };
}

export { diffValues, revertOps, deepEqual, matchesWritten };
