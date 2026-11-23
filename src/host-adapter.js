import {
  ALLOWED_CONFIG_KEYS,
  CONFIG_KEY_TYPES,
  CHAR_FIELD_META,
  MODULE_FIELD_META,
  CONFIG_FIELD_META,
  DEFAULT_MAX_CONTENT_CHARS,
  ALLOWED_CHAR_FIELDS,
  ALLOWED_MODULE_FIELDS,
  ALLOWED_LORE_TEXT_FIELDS,
  ALLOWED_PERSONA_TEXT_FIELDS,
} from './version.js';
import { applyTextEdits } from './text-edits.js';
import { diffValues, revertOps } from './undo-journal.js';

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DB_PERMISSION_ERROR =
  'DB 읽기 권한(db)이 필요합니다. 이전에 권한을 거부(취소)했다면 RisuAI/PocketRisu 설정 → 플러그인에서 권한 초기화 후 다시 허용해 주세요.';

const LORE_META_SPECS = [
  ['comment', '이름'],
  ['key', '활성화 키'],
  ['secondkey', '보조 키'],
  ['insertorder', '배치 순서'],
  ['alwaysActive', '항상 활성'],
  ['selective', '보조 키 사용'],
  ['useRegex', '정규식 키'],
  ['activationPercent', '활성 확률'],
  ['mode', '모드'],
  ['folder', '폴더'],
];

const PERSONA_META_SPECS = [
  ['name', '이름'],
  ['note', '메모'],
  ['largePortrait', '큰 초상화'],
];

const REGEX_META_SPECS = [
  ['comment', '이름'],
  ['type', '적용 유형'],
  ['in', 'IN 패턴'],
  ['flag', '플래그'],
  ['ableFlag', '플래그 활성'],
];

function clone(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function makeUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'rh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function formatMetaValue(val) {
  if (val === undefined || val === null || val === '') return '(비어 있음)';
  if (typeof val === 'boolean') return val ? '예' : '아니오';
  return String(val);
}

function computeMetaChanges(beforeObj, afterObj, specs, skipKey = null) {
  const changes = [];
  for (const [key, label] of specs) {
    if (key === skipKey) continue;
    const prev = beforeObj ? beforeObj[key] : undefined;
    const next = afterObj ? afterObj[key] : undefined;
    if (prev !== next) {
      changes.push({
        key,
        label,
        before: formatMetaValue(prev),
        after: formatMetaValue(next),
      });
    }
  }
  return changes;
}

function validateAllowedFieldKey(kind, fieldKey) {
  if (fieldKey === undefined || fieldKey === null || fieldKey === '') return null;
  if (typeof fieldKey !== 'string' || BAD_KEYS.has(fieldKey)) {
    return `허용되지 않는 필드 키입니다: ${String(fieldKey)}`;
  }
  if (kind === 'char_field' && !ALLOWED_CHAR_FIELDS.includes(fieldKey)) {
    return `허용되지 않는 캐릭터 필드입니다: ${fieldKey}`;
  }
  if (kind === 'char_alt_greeting' && fieldKey !== 'alternateGreetings') {
    return `허용되지 않는 추가 첫 메시지 필드입니다: ${fieldKey}`;
  }
  if (
    (kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook') &&
    !ALLOWED_LORE_TEXT_FIELDS.includes(fieldKey)
  ) {
    return `허용되지 않는 로어북 필드입니다: ${fieldKey}`;
  }
  if (kind === 'module_field' && !ALLOWED_MODULE_FIELDS.includes(fieldKey)) {
    return `허용되지 않는 모듈 필드입니다: ${fieldKey}`;
  }
  if (kind === 'persona' && !ALLOWED_PERSONA_TEXT_FIELDS.includes(fieldKey)) {
    return `허용되지 않는 페르소나 필드입니다: ${fieldKey}`;
  }
  if (kind === 'chat_note' && fieldKey !== 'note') {
    return `허용되지 않는 작가의 노트 필드입니다: ${fieldKey}`;
  }
  if (kind === 'chat_message' && fieldKey !== 'data') {
    return `허용되지 않는 채팅 메시지 필드입니다: ${fieldKey}`;
  }
  if (kind === 'config' && !ALLOWED_CONFIG_KEYS.includes(fieldKey)) {
    return `허용되지 않는 설정 키입니다: ${fieldKey}`;
  }
  return null;
}

function assertAllowedFieldKey(kind, fieldKey) {
  const err = validateAllowedFieldKey(kind, fieldKey);
  if (err) throw new Error(err);
}

function checkTruncationGuard(beforeText, actionLabel, limit = DEFAULT_MAX_CONTENT_CHARS) {
  if (typeof beforeText === 'string' && beforeText.length > limit) {
    return (
      `현재 원문(${beforeText.length.toLocaleString()}자)이 모델 입력 한도(${limit.toLocaleString()}자)를 초과해 앞부분만 전달되었습니다. ` +
      `뒷부분 유실을 방지하기 위해 ${actionLabel}은(는) 차단됩니다. 부분 편집(patch_text / edits)을 사용하거나, 설정에서 "모델에 보내는 원문 길이"를 늘려 주세요.`
    );
  }
  return null;
}

function getCharIdentity(char) {
  if (!char) return { charId: null, charName: null };
  return {
    charId: char.chaId ?? char.id ?? null,
    charName: char.name ?? null,
  };
}

function isSameCharacter(char, charIndex, binding) {
  if (!binding) return true;
  if (!char) return false;
  const cur = getCharIdentity(char);
  if (binding.charId && cur.charId) {
    return binding.charId === cur.charId;
  }
  if (
    Number.isInteger(binding.charIndex) &&
    Number.isInteger(charIndex) &&
    binding.charIndex !== charIndex
  ) {
    return false;
  }
  if (binding.charName !== null && binding.charName !== undefined && cur.charName !== binding.charName) {
    return false;
  }
  return true;
}

/**
 * Extracts Lua code from RisuAI's triggerscript array (both character.triggerscript and module.trigger).
 */
function extractLuaFromTriggers(triggers) {
  if (!Array.isArray(triggers) || triggers.length === 0) {
    return { isLua: false, code: '', hasOtherTriggers: false, otherTriggerCount: 0 };
  }
  const firstEffect = triggers[0]?.effect?.[0];
  if (firstEffect && firstEffect.type === 'triggerlua') {
    return { isLua: true, code: String(firstEffect.code ?? ''), hasOtherTriggers: false, otherTriggerCount: 0 };
  }
  return { isLua: false, code: '', hasOtherTriggers: true, otherTriggerCount: triggers.length };
}

/**
 * Builds the canonical RisuAI Lua triggerscript array expected by TriggerList.svelte.
 */
function buildLuaTriggers(code) {
  return [
    {
      comment: '',
      type: 'start',
      conditions: [],
      effect: [
        {
          type: 'triggerlua',
          code: String(code ?? ''),
        },
      ],
    },
  ];
}

function buildLuaDestructiveWarning(otherTriggerCount) {
  const countText = otherTriggerCount > 0 ? `${otherTriggerCount}개의 ` : '';
  return (
    `⚠️ 기존 V1/V2 트리거(${countText}항목)가 설정되어 있습니다. ` +
    'Lua 트리거를 적용하면 기존 트리거와 병합되지 않고 모두 삭제된 뒤 새 Lua 스크립트로 통째로 대체됩니다. ' +
    '(적용 직후 되돌리기로 기존 트리거를 복구할 수 있습니다.)'
  );
}

const LORE_FOLDER_PREFIX = '\uf000folder:';
const MAX_LORE_SUMMARY_ITEMS = 120;

/**
 * Ensures a lorebook folder key uses RisuAI's canonical `\uf000folder:<id>` format.
 * Repairs literal double-escaped `\\uf000folder:...`, stripped `folder:...`, bare IDs, or empty keys.
 */
function canonicalizeFolderKey(rawKey) {
  const s = String(rawKey ?? '').trim();
  if (!s) return LORE_FOLDER_PREFIX + makeUuid();
  if (s.startsWith(LORE_FOLDER_PREFIX)) {
    const suffix = s.slice(LORE_FOLDER_PREFIX.length).trim();
    return LORE_FOLDER_PREFIX + (suffix || makeUuid());
  }
  const literalEscaped = s.match(/^\\+u[fF]000folder:(.*)$/);
  if (literalEscaped) {
    const suffix = literalEscaped[1].trim();
    return LORE_FOLDER_PREFIX + (suffix || makeUuid());
  }
  const barePrefix = s.match(/^folder:(.*)$/i);
  if (barePrefix) {
    const suffix = barePrefix[1].trim();
    return LORE_FOLDER_PREFIX + (suffix || makeUuid());
  }
  return LORE_FOLDER_PREFIX + s;
}

function getReachableFolderKeys(list) {
  if (!Array.isArray(list)) return new Set();
  const folderByKey = new Map();
  for (const e of list) {
    if (e && e.mode === 'folder' && typeof e.key === 'string' && e.key.length > 0) {
      folderByKey.set(e.key, e);
    }
  }
  const reachable = new Set();
  for (const [key, folder] of folderByKey.entries()) {
    const seen = new Set([key]);
    let cur = folder;
    let ok = true;
    while (cur && cur.folder) {
      if (seen.has(cur.folder) || !folderByKey.has(cur.folder)) {
        ok = false;
        break;
      }
      seen.add(cur.folder);
      cur = folderByKey.get(cur.folder);
    }
    if (ok) reachable.add(key);
  }
  return reachable;
}

/**
 * Returns indices of lorebook entries whose `folder` property points to a missing/unreachable folder key.
 * In RisuAI's LoreBookList.svelte (`(!showFolder && !item.folder) || (showFolder === item.folder)`),
 * these entries remain in DB but disappear from both the root list and every folder view.
 */
function findOrphanedLorebooks(list) {
  if (!Array.isArray(list)) return [];
  const reachable = getReachableFolderKeys(list);
  const orphaned = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || typeof e !== 'object') continue;
    if (e.folder && !reachable.has(e.folder)) {
      orphaned.push(i);
    }
  }
  return orphaned;
}

function buildFolderNameMap(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  for (const e of list) {
    if (e && e.mode === 'folder' && typeof e.key === 'string' && e.key.length > 0) {
      map.set(e.key, String(e.comment || '').trim() || '(무제 폴더)');
    }
  }
  return map;
}

function formatFolderDisplay(val, folderNameMap) {
  if (val === undefined || val === null || val === '') return '(최상위)';
  const str = String(val);
  if (folderNameMap && folderNameMap.has(str)) {
    return `📁 ${folderNameMap.get(str)}`;
  }
  return `⚠️ 알 수 없는 폴더 (${str.replace(/\uf000/g, '')})`;
}

function computeLoreMetaChanges(beforeObj, afterObj, list, skipKey = null) {
  const folderNameMap = buildFolderNameMap(list);
  const raw = computeMetaChanges(beforeObj, afterObj, LORE_META_SPECS, skipKey);
  return raw.map(ch => {
    if (ch.key === 'folder') {
      return {
        ...ch,
        before: formatFolderDisplay(beforeObj?.folder, folderNameMap),
        after: formatFolderDisplay(afterObj?.folder, folderNameMap),
      };
    }
    return ch;
  });
}

/**
 * Resolves a folder reference (`folderIndex`, `folder` key/canonical key/name, or `folderName`)
 * against the real `mode === 'folder'` entries in `list`, blocking writes to nonexistent folder keys.
 */
function resolveFolderRef(list, { folder, folderName, folderIndex } = {}) {
  const folders = [];
  if (Array.isArray(list)) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && e.mode === 'folder' && typeof e.key === 'string' && e.key.length > 0) {
        folders.push({
          index: i,
          entry: e,
          key: e.key,
          name: String(e.comment || '').trim(),
        });
      }
    }
  }

  const hasFolderIndex = folderIndex !== undefined && folderIndex !== null;
  const hasFolderName = typeof folderName === 'string' && folderName.trim().length > 0;

  if ((folder === '' || folder === null) && !hasFolderName && !hasFolderIndex) {
    return { ok: true, folderKey: '', folderName: '', folderIndex: null, isRoot: true };
  }

  if (hasFolderIndex) {
    if (!Number.isInteger(folderIndex) || folderIndex < 0 || !Array.isArray(list) || !list[folderIndex]) {
      return { ok: false, error: `폴더 인덱스(#${Number(folderIndex) + 1})를 찾을 수 없습니다.` };
    }
    const targetEntry = list[folderIndex];
    if (targetEntry.mode !== 'folder' || typeof targetEntry.key !== 'string' || !targetEntry.key.length) {
      return { ok: false, error: `항목 #${folderIndex + 1}은(는) 유효한 로어북 폴더가 아닙니다.` };
    }
    return {
      ok: true,
      folderKey: targetEntry.key,
      folderName: String(targetEntry.comment || '').trim() || '(무제 폴더)',
      folderIndex,
      isRoot: false,
    };
  }

  const findByName = (rawName) => {
    const norm = String(rawName || '').trim().toLowerCase();
    if (!norm) return null;
    const matches = folders.filter(f => f.name.toLowerCase() === norm);
    if (matches.length === 1) {
      return {
        ok: true,
        folderKey: matches[0].key,
        folderName: matches[0].name || '(무제 폴더)',
        folderIndex: matches[0].index,
        isRoot: false,
      };
    }
    if (matches.length > 1) {
      const idxList = matches.map(m => `#${m.index + 1}`).join(', ');
      return {
        ok: false,
        ambiguous: true,
        error: `이름이 "${rawName}"인 폴더가 ${matches.length}개(${idxList}) 있어 대상 폴더를 특정할 수 없습니다. folderIndex를 지정해 주세요.`,
      };
    }
    return null;
  };

  if (folder !== undefined && folder !== null && String(folder).trim() !== '') {
    const raw = String(folder).trim();
    const exact = folders.find(f => f.key === raw);
    if (exact) {
      return {
        ok: true,
        folderKey: exact.key,
        folderName: exact.name || '(무제 폴더)',
        folderIndex: exact.index,
        isRoot: false,
      };
    }
    const canon = canonicalizeFolderKey(raw);
    const byCanon = folders.find(f => f.key === canon);
    if (byCanon) {
      return {
        ok: true,
        folderKey: byCanon.key,
        folderName: byCanon.name || '(무제 폴더)',
        folderIndex: byCanon.index,
        isRoot: false,
      };
    }
    const byName = findByName(raw);
    if (byName) return byName;
  }

  if (hasFolderName) {
    const rawName = folderName.trim();
    const exact = folders.find(f => f.key === rawName);
    if (exact) {
      return {
        ok: true,
        folderKey: exact.key,
        folderName: exact.name || '(무제 폴더)',
        folderIndex: exact.index,
        isRoot: false,
      };
    }
    const byName = findByName(rawName);
    if (byName) return byName;
  }

  const requested = String(folderName ?? folder ?? '').trim().replace(/\uf000/g, '');
  const existingHint = folders.length > 0
    ? ` (현재 폴더: ${folders.slice(0, 12).map(f => `"${f.name || '무제'}"(#${f.index + 1})`).join(', ')})`
    : ' (현재 생성된 폴더가 없습니다)';
  return {
    ok: false,
    notFound: true,
    error: `대상 폴더("${requested}")를 찾을 수 없습니다. 존재하지 않는 폴더 키를 지정하면 로어북이 화면에서 숨겨지므로 차단되었습니다. 폴더 생성과 이동을 함께 하려면 organize_lorebook 액션을 사용해 주세요.${existingHint}`,
  };
}

/**
 * Summarizes a lorebook array for both UI pickers and LLM context.
 * Always includes EVERY `mode === 'folder'` entry regardless of list position, plus up to `maxItems`
 * regular entries, with human-readable `folderName` instead of raw `\uf000folder:` keys.
 */
function summarizeLoreList(list, maxItems = MAX_LORE_SUMMARY_ITEMS) {
  if (!Array.isArray(list)) {
    return { loreSummary: [], foldersSummary: [], orphanedLoreIndices: [], orphanedLoreCount: 0 };
  }

  const folderNameByKey = buildFolderNameMap(list);
  const childCountByKey = new Map();
  const orphanedLoreIndices = findOrphanedLorebooks(list);
  const orphanedSet = new Set(orphanedLoreIndices);

  for (const e of list) {
    if (e && e.folder && folderNameByKey.has(e.folder)) {
      childCountByKey.set(e.folder, (childCountByKey.get(e.folder) || 0) + 1);
    }
  }

  const foldersSummary = [];
  const selectedIndices = new Set();
  let regularCount = 0;

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || typeof e !== 'object') continue;
    if (e.mode === 'folder') {
      selectedIndices.add(i);
      if (typeof e.key === 'string' && e.key.length > 0) {
        foldersSummary.push({
          index: i,
          name: String(e.comment || '').trim() || '(무제 폴더)',
          childCount: childCountByKey.get(e.key) || 0,
        });
      }
    } else if (regularCount < maxItems) {
      selectedIndices.add(i);
      regularCount++;
    }
  }

  const ordered = [...selectedIndices].sort((a, b) => a - b);
  const loreSummary = ordered.map(i => {
    const e = list[i];
    const isFolder = e.mode === 'folder';
    const item = {
      index: i,
      comment: e.comment || '',
      key: isFolder ? '' : (e.key || ''),
      alwaysActive: Boolean(e.alwaysActive),
      insertorder: e.insertorder ?? 100,
      mode: e.mode || 'normal',
    };
    if (e.folder) {
      if (folderNameByKey.has(e.folder)) {
        item.folderName = folderNameByKey.get(e.folder);
      } else if (orphanedSet.has(i)) {
        item.orphaned = true;
      }
    }
    return item;
  });

  return {
    loreSummary,
    foldersSummary,
    orphanedLoreIndices,
    orphanedLoreCount: orphanedLoreIndices.length,
  };
}

function resolveLorebookFolderProposal(list, proposal, existingEntry = null) {
  const hasFolderSpec =
    proposal.folder !== undefined ||
    proposal.folderName !== undefined ||
    proposal.folderIndex !== undefined;
  const nextMode =
    proposal.mode && ['normal', 'constant', 'multiple', 'child', 'folder'].includes(proposal.mode)
      ? proposal.mode
      : (existingEntry?.mode || 'normal');

  if (nextMode === 'folder') {
    const wantsNested =
      (proposal.folder !== undefined && proposal.folder !== null && String(proposal.folder).trim() !== '') ||
      (typeof proposal.folderName === 'string' && proposal.folderName.trim() !== '') ||
      (proposal.folderIndex !== undefined && proposal.folderIndex !== null);
    if (wantsNested) {
      return { ok: false, error: '폴더 항목은 다른 폴더 안으로 중첩할 수 없습니다.' };
    }
    return { ok: true, resolvedFolder: undefined };
  }

  if (!hasFolderSpec) {
    return { ok: true, resolvedFolder: undefined };
  }

  const ref = resolveFolderRef(list, {
    folder: proposal.folder,
    folderName: proposal.folderName,
    folderIndex: proposal.folderIndex,
  });
  if (!ref.ok) return { ok: false, error: ref.error };
  return {
    ok: true,
    resolvedFolder: ref.isRoot ? '' : ref.folderKey,
    folderName: ref.folderName,
    folderIndex: ref.folderIndex,
  };
}

function planOrganizeLorebook(list, proposal) {
  if (!Array.isArray(list)) {
    return { ok: false, error: '대상 로어북 목록을 읽을 수 없습니다.' };
  }
  if (!Array.isArray(proposal.loreIndices) || proposal.loreIndices.length === 0) {
    return { ok: false, error: '이동할 로어북 인덱스(loreIndices)를 1개 이상 지정해야 합니다.' };
  }

  const uniqueIndices = [];
  const seen = new Set();
  for (const rawIdx of proposal.loreIndices) {
    if (!Number.isInteger(rawIdx) || rawIdx < 0 || rawIdx >= list.length) {
      return { ok: false, error: `유효하지 않은 로어북 인덱스(#${Number(rawIdx) + 1})가 포함되어 있습니다. (전체 ${list.length}개)` };
    }
    if (!seen.has(rawIdx)) {
      seen.add(rawIdx);
      uniqueIndices.push(rawIdx);
    }
  }

  const isRoot =
    proposal.moveToRoot === true ||
    ((proposal.folder === '' || proposal.folder === null) &&
      proposal.folderName === undefined &&
      proposal.folderIndex === undefined);

  let willCreateFolder = false;
  let newFolderName = '';
  let folderKey = '';
  let folderLabel = '(최상위)';
  let folderIndex = null;

  if (!isRoot) {
    const ref = resolveFolderRef(list, {
      folder: proposal.folder,
      folderName: proposal.folderName,
      folderIndex: proposal.folderIndex,
    });
    if (ref.ok && !ref.isRoot) {
      folderKey = ref.folderKey;
      folderLabel = ref.folderName || '(무제 폴더)';
      folderIndex = ref.folderIndex;
    } else if (
      ref.notFound &&
      proposal.createFolderIfMissing !== false &&
      proposal.folderIndex === undefined
    ) {
      const explicitName = typeof proposal.folderName === 'string' ? proposal.folderName.trim() : '';
      const rawFolder = typeof proposal.folder === 'string' ? proposal.folder.trim() : '';
      const rawLooksLikeKey = /^(\uf000|\\+u[fF]000)?folder:/i.test(rawFolder);
      newFolderName = explicitName || (!rawLooksLikeKey ? rawFolder : '');
      if (!newFolderName) {
        return { ok: false, error: '새로 만들 폴더 이름(folderName)이 필요합니다.' };
      }
      willCreateFolder = true;
      folderLabel = newFolderName;
    } else {
      return { ok: false, error: ref.error };
    }
  }

  const movableIndices = [];
  const skippedFolderIndices = [];
  for (const idx of uniqueIndices) {
    const entry = list[idx];
    if (!isRoot && entry?.mode === 'folder') {
      skippedFolderIndices.push(idx);
    } else {
      movableIndices.push(idx);
    }
  }

  if (movableIndices.length === 0) {
    return { ok: false, error: '이동할 일반 로어북 항목이 없습니다. 폴더 자체는 다른 폴더 안으로 넣을 수 없습니다.' };
  }

  const folderNameMap = buildFolderNameMap(list);
  const destDisplay = isRoot ? '(최상위)' : `📁 ${folderLabel}`;

  const beforeLines = movableIndices.map(idx => {
    const e = list[idx];
    const title = String(e?.comment || e?.key || '(무제)').trim();
    const curLoc = formatFolderDisplay(e?.folder, folderNameMap);
    return `#${idx + 1} ${title}  [${curLoc}]`;
  });

  const afterLines = [];
  if (willCreateFolder) {
    afterLines.push(`📁 새 폴더 생성: "${newFolderName}"`);
  }
  for (const idx of movableIndices) {
    const e = list[idx];
    const title = String(e?.comment || e?.key || '(무제)').trim();
    afterLines.push(`#${idx + 1} ${title}  [${destDisplay}]`);
  }

  const metaChanges = [
    {
      key: 'folder',
      label: '대상 폴더',
      before: willCreateFolder ? '(신규 폴더 생성)' : (isRoot ? '(기존 위치)' : `📁 ${folderLabel} (#${folderIndex + 1})`),
      after: destDisplay,
    },
    {
      key: 'count',
      label: '이동 항목 수',
      before: `${movableIndices.length}개`,
      after: `${movableIndices.length}개`,
    },
  ];

  const warning = skippedFolderIndices.length > 0
    ? `⚠️ 폴더 항목(${skippedFolderIndices.map(i => `#${i + 1} "${list[i]?.comment || '무제'}"`).join(', ')})은 중첩할 수 없어 이동 대상에서 제외되었습니다.`
    : null;

  return {
    ok: true,
    isRoot,
    willCreateFolder,
    newFolderName,
    folderKey,
    folderLabel,
    folderIndex,
    movableIndices,
    skippedFolderIndices,
    before: beforeLines.join('\n'),
    after: afterLines.join('\n'),
    metaChanges,
    warning,
  };
}

function normalizeLorebookEntry(input, existing = null) {
  const base = existing ? clone(existing) : {
    key: '',
    secondkey: '',
    insertorder: 100,
    comment: 'New Lore',
    content: '',
    mode: 'normal',
    alwaysActive: false,
    selective: false,
    useRegex: false,
  };
  if (input.comment !== undefined) base.comment = String(input.comment);
  if (input.key !== undefined) base.key = String(input.key);
  if (input.secondkey !== undefined) base.secondkey = String(input.secondkey);
  if (input.content !== undefined) base.content = String(input.content);
  if (input.insertorder !== undefined && Number.isFinite(Number(input.insertorder))) {
    base.insertorder = Number(input.insertorder);
  }
  if (input.alwaysActive !== undefined) base.alwaysActive = Boolean(input.alwaysActive);
  if (input.selective !== undefined) base.selective = Boolean(input.selective);
  if (input.useRegex !== undefined) base.useRegex = Boolean(input.useRegex);
  if (input.activationPercent !== undefined && Number.isFinite(Number(input.activationPercent))) {
    base.activationPercent = Math.max(0, Math.min(100, Number(input.activationPercent)));
  }
  if (input.mode && ['normal', 'constant', 'multiple', 'child', 'folder'].includes(input.mode)) {
    base.mode = input.mode;
  }
  if (input.folder !== undefined) {
    if (input.folder === '' || input.folder === null) {
      delete base.folder;
    } else {
      base.folder = String(input.folder);
    }
  }
  if (base.mode === 'folder') {
    if (existing?.mode === 'folder' && existing.key && (!input.key || !String(input.key).trim())) {
      base.key = canonicalizeFolderKey(existing.key);
    } else {
      base.key = canonicalizeFolderKey(base.key);
    }
    base.content = '';
    base.secondkey = '';
    base.selective = false;
    delete base.folder;
  }
  return base;
}

function normalizeRegexEntry(input, existing = null) {
  const validTypes = ['editinput', 'editoutput', 'editprocess', 'editdisplay'];
  const base = existing ? clone(existing) : {
    comment: 'New Regex',
    in: '',
    out: '',
    type: 'editdisplay',
    flag: 'g',
    ableFlag: false,
  };
  if (input.comment !== undefined) base.comment = String(input.comment);
  if (input.in !== undefined) base.in = String(input.in);
  if (input.out !== undefined) base.out = String(input.out);
  if (input.type !== undefined && validTypes.includes(input.type)) base.type = input.type;
  if (input.flag !== undefined) base.flag = String(input.flag);
  if (input.ableFlag !== undefined) base.ableFlag = Boolean(input.ableFlag);
  return base;
}

function isCatchAllProxyApi(api) {
  return Boolean(api && typeof api.__risuhelper_nonexistent_probe__ === 'function');
}

function isMissingMethodError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('not found') || msg.includes('not a function') || msg.includes('undefined');
}

const GENERIC_ITEM_TITLES = new Set(['unnamed lore', 'unnamed folder', 'unnamed script', '']);

function normalizeMatchText(str) {
  return String(str || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

function expectedLoreDisplayTitle(entry) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.mode === 'folder') {
    return String(entry.comment || '').trim() || 'Unnamed Folder';
  }
  return String(entry.comment || '').trim() || String(entry.key || '').trim() || 'Unnamed Lore';
}

function expectedRegexDisplayTitle(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.comment || '').trim() || 'Unnamed Script';
}

function scorePreviewMatch(candidateText, normPreview) {
  if (!normPreview || normPreview.length < 4) return 0;
  const normCandidate = normalizeMatchText(candidateText);
  if (!normCandidate) return 0;
  if (normCandidate === normPreview) return 1500;
  if (normCandidate.startsWith(normPreview)) return 1000;
  if (normCandidate.length >= 4 && normPreview.startsWith(normCandidate)) return 900;
  if (normPreview.length >= 12 && normCandidate.includes(normPreview)) return 600;
  return 0;
}

/**
 * Resolves the index of the currently edited module in `db.modules`.
 * Priority:
 *  1. Explicit `target.moduleIndex` (manual user selection or pinned proposal)
 *  2. DOM fingerprint matching via `target.moduleDomHints` (lorebook/regex titles, expanded text preview, assets)
 *  3. Last matched module ID (`preferredModuleId`) when switching tabs inside the same module
 *  4. Fallback to 0 (first installed module)
 */
function resolveModuleIndex(modules, target, preferredModuleId = null) {
  if (!Array.isArray(modules) || modules.length === 0) return { index: null, matchedBy: 'none' };

  if (Number.isInteger(target?.moduleIndex) && target.moduleIndex >= 0 && target.moduleIndex < modules.length) {
    return { index: target.moduleIndex, matchedBy: 'explicit' };
  }

  const hints = target?.moduleDomHints;
  if (hints && typeof hints === 'object') {
    const tab = hints.tab || (
      target.targetKind === 'module_lorebook' ? 'lorebook' :
      target.targetKind === 'module_regex' ? 'regex' :
      target.targetKind === 'module_lua' ? 'trigger' : null
    );
    const items = Array.isArray(hints.items) ? hints.items : [];
    const totalIdxCount = Number.isInteger(hints.totalIdxCount) ? hints.totalIdxCount : 0;
    const rawPreview = String(hints.textPreview || target?.liveTextPreview || '');
    const normPreview = normalizeMatchText(rawPreview).slice(0, 240);
    const openIdx = Number.isInteger(target?.loreIndex)
      ? target.loreIndex
      : Number.isInteger(target?.regexIndex)
        ? target.regexIndex
        : (Number.isInteger(hints.openIdx) ? hints.openIdx : null);
    const assetNames = Array.isArray(hints.assetNames) ? hints.assetNames : [];

    let bestIdx = -1;
    let bestScore = 0;
    let tiedWithBest = false;

    for (let i = 0; i < modules.length; i++) {
      const m = modules[i];
      if (!m || typeof m !== 'object') continue;
      let score = 0;

      if (tab === 'lorebook' || (tab === null && target.targetKind === 'module_lorebook')) {
        const list = Array.isArray(m.lorebook) ? m.lorebook : [];
        if (totalIdxCount > 0) {
          if (list.length === 0) score -= 20;
          else if (list.length === totalIdxCount) score += 10;
        }
        const allTitleSet = new Set(list.map(e => normalizeMatchText(expectedLoreDisplayTitle(e)).toLowerCase()));
        for (const item of items) {
          const normTitle = normalizeMatchText(item.title).toLowerCase();
          const isGeneric = GENERIC_ITEM_TITLES.has(normTitle);
          const atIdx = list[item.idx];
          if (atIdx) {
            const expected = normalizeMatchText(expectedLoreDisplayTitle(atIdx)).toLowerCase();
            if (expected === normTitle) {
              score += isGeneric ? 2 : 30;
              continue;
            }
          }
          if (!isGeneric && allTitleSet.has(normTitle)) {
            score += 8;
          }
        }
        if (normPreview.length >= 4) {
          if (openIdx !== null && list[openIdx]) {
            const openHit = scorePreviewMatch(list[openIdx].content, normPreview);
            if (openHit > 0) score += openHit;
          } else {
            let maxHit = 0;
            for (const e of list) {
              const hit = scorePreviewMatch(e?.content, normPreview);
              if (hit > maxHit) maxHit = hit;
            }
            score += maxHit;
          }
        }
      } else if (tab === 'regex' || (tab === null && target.targetKind === 'module_regex')) {
        const list = Array.isArray(m.regex) ? m.regex : [];
        if (totalIdxCount > 0) {
          if (list.length === 0) score -= 20;
          else if (list.length === totalIdxCount) score += 10;
        }
        const allTitleSet = new Set(list.map(e => normalizeMatchText(expectedRegexDisplayTitle(e)).toLowerCase()));
        for (const item of items) {
          const normTitle = normalizeMatchText(item.title).toLowerCase();
          const isGeneric = GENERIC_ITEM_TITLES.has(normTitle);
          const atIdx = list[item.idx];
          if (atIdx) {
            const expected = normalizeMatchText(expectedRegexDisplayTitle(atIdx)).toLowerCase();
            if (expected === normTitle) {
              score += isGeneric ? 2 : 30;
              continue;
            }
          }
          if (!isGeneric && allTitleSet.has(normTitle)) {
            score += 8;
          }
        }
        if (normPreview.length >= 4) {
          if (target.targetKind === 'module_field' && target.fieldKey === 'backgroundEmbedding') {
            score += scorePreviewMatch(m.backgroundEmbedding, normPreview);
          } else if (openIdx !== null && list[openIdx]) {
            score += scorePreviewMatch(list[openIdx].out, normPreview);
          } else {
            const bgHit = scorePreviewMatch(m.backgroundEmbedding, normPreview);
            let maxRegexHit = 0;
            for (const e of list) {
              const hit = scorePreviewMatch(e?.out, normPreview);
              if (hit > maxRegexHit) maxRegexHit = hit;
            }
            score += Math.max(bgHit, maxRegexHit);
          }
        }
      } else if (tab === 'trigger' || target.targetKind === 'module_lua') {
        if (normPreview.length >= 4) {
          const lua = extractLuaFromTriggers(m.trigger);
          score += scorePreviewMatch(lua.code, normPreview);
        }
      } else if (tab === 'assets' && assetNames.length > 0) {
        const modAssets = Array.isArray(m.assets) ? m.assets : [];
        const assetSet = new Set(modAssets.map(a => String(a?.[0] || '').trim()));
        for (const name of assetNames) {
          if (assetSet.has(name)) score += 20;
        }
      } else if (target.targetKind === 'module_field' && normPreview.length >= 4) {
        const fk = target.fieldKey || 'description';
        score += scorePreviewMatch(m[fk], normPreview);
      }

      if (score > 0 && preferredModuleId && m.id === preferredModuleId) {
        score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
        tiedWithBest = false;
      } else if (score === bestScore && score > 0) {
        tiedWithBest = true;
      }
    }

    if (bestIdx !== -1 && bestScore > 0) {
      // Two modules that look identical in the DOM (e.g. a duplicated module) cannot be told apart.
      return { index: bestIdx, matchedBy: tiedWithBest ? 'ambiguous' : 'dom_hints', score: bestScore };
    }
  }

  if (preferredModuleId) {
    const prefIdx = modules.findIndex(m => m && m.id === preferredModuleId);
    if (prefIdx !== -1) {
      return { index: prefIdx, matchedBy: 'preferred' };
    }
  }

  // Nothing identified the module. With a single installed module index 0 is certain;
  // otherwise it is only a guess that callers must not write to.
  return { index: 0, matchedBy: modules.length === 1 ? 'single' : 'fallback' };
}

const MODULE_UNCERTAIN_ERROR =
  '어느 모듈을 편집 중인지 자동으로 확정하지 못했습니다. 상단의 모듈 선택기에서 대상 모듈을 직접 선택한 뒤 다시 요청해 주세요.';

function isUncertainModuleMatch(matchedBy) {
  return matchedBy === 'fallback' || matchedBy === 'ambiguous';
}

/**
 * Cross-fork safe adapter for RisuAI Plugin API v3.
 * Works with kwaroran/Risuai, PocketRisu, RisuBard, HaejeokRisuai, RisuNest, and RisuAI-Hardened.
 */
class HostAdapter {
  constructor(api) {
    this.api = api;
    this.undoStack = [];
    this.maxUndoUnits = 200;
    this.maxUndoBytes = 1_000_000;
    this.onUndoChange = null;
    this.maxContentChars = DEFAULT_MAX_CONTENT_CHARS;
    this._activeGroup = null;
    this._probedFlavor = null;
    this._lastMatchedModuleId = null;
  }

  _resolveWriteModuleIndex(modules, proposal, target, options = {}) {
    if (Number.isInteger(proposal?.moduleIndex) && modules[proposal.moduleIndex]) {
      return proposal.moduleIndex;
    }
    const pinnedId = options?.hostBinding?.moduleId || null;
    if (pinnedId) {
      const byId = modules.findIndex(m => m && m.id === pinnedId);
      if (byId !== -1) return byId;
    }
    const res = resolveModuleIndex(modules, target, this._lastMatchedModuleId);
    if (isUncertainModuleMatch(res.matchedBy)) {
      throw new Error(MODULE_UNCERTAIN_ERROR);
    }
    return res.index ?? 0;
  }

  /**
   * Probes the real host flavor safely (working around RisuAI Plugin v3's catch-all `window.risuai` Proxy,
   * where `typeof api.anyName === 'function'` is always true for nonexistent methods).
   */
  async probeHostFlavor(rootDoc = null) {
    if (this._probedFlavor) return this._probedFlavor;

    // 1. Check host document <title> when mainDom is available (zero side effects, works on every fork)
    if (rootDoc && typeof rootDoc.querySelector === 'function') {
      try {
        const titleEl = await rootDoc.querySelector('title');
        const title = titleEl ? String((await titleEl.textContent()) || '').trim().toLowerCase() : '';
        if (title.includes('pocketrisu')) {
          this._probedFlavor = { name: 'PocketRisu', activePersonaAutoSyncs: false, syncLiteCharError: false };
          return this._probedFlavor;
        }
        if (title.includes('risubard')) {
          this._probedFlavor = { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
          return this._probedFlavor;
        }
        if (title.includes('risunest')) {
          this._probedFlavor = { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
          return this._probedFlavor;
        }
        if (title.includes('haejeok') || title.includes('해적')) {
          this._probedFlavor = { name: 'HaejeokRisuai', activePersonaAutoSyncs: true, syncLiteCharError: false };
          return this._probedFlavor;
        }
        if (title.includes('risuai')) {
          this._probedFlavor = { name: 'RisuAI', activePersonaAutoSyncs: false, syncLiteCharError: false };
          return this._probedFlavor;
        }
      } catch {}
    }

    // 2. Non-Proxy object (e.g. unit tests or direct host objects) can safely inspect own properties
    if (!isCatchAllProxyApi(this.api)) {
      if (typeof this.api?.risunestCallHostTool === 'function') {
        this._probedFlavor = { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
        return this._probedFlavor;
      }
      if (typeof this.api?._getBardWikiDocuments === 'function') {
        this._probedFlavor = { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
        return this._probedFlavor;
      }
    }

    this._probedFlavor = { name: 'RisuAI', activePersonaAutoSyncs: false, syncLiteCharError: false };
    return this._probedFlavor;
  }

  detectHostFlavor() {
    if (this._probedFlavor) return this._probedFlavor;
    // Never trust `typeof api.foo === 'function'` when `window.risuai` is a catch-all Proxy
    if (!isCatchAllProxyApi(this.api)) {
      if (typeof this.api?.risunestCallHostTool === 'function') {
        return { name: 'RisuNest', activePersonaAutoSyncs: true, syncLiteCharError: true };
      }
      if (typeof this.api?._getBardWikiDocuments === 'function') {
        return { name: 'RisuBard', activePersonaAutoSyncs: false, syncLiteCharError: false };
      }
    }
    return { name: 'RisuAI', activePersonaAutoSyncs: false, syncLiteCharError: false };
  }

  async _getCharacter() {
    if (typeof this.api.getCharacter === 'function') {
      try {
        return await this.api.getCharacter();
      } catch (err) {
        if (!isMissingMethodError(err) || typeof this.api.getChar !== 'function') throw err;
      }
    }
    if (typeof this.api.getChar === 'function') return await this.api.getChar();
    return null;
  }

  async _setCharacter(char) {
    if (typeof this.api.setCharacter === 'function') {
      try {
        return await this.api.setCharacter(char);
      } catch (err) {
        if (!isMissingMethodError(err) || typeof this.api.setChar !== 'function') throw err;
      }
    }
    if (typeof this.api.setChar === 'function') return await this.api.setChar(char);
    throw new Error('캐릭터 저장 API를 찾을 수 없습니다.');
  }

  async _getActiveIndices() {
    let charIndex = null;
    let chatIndex = null;
    if (typeof this.api.getCurrentCharacterIndex === 'function') {
      try { charIndex = await this.api.getCurrentCharacterIndex(); } catch {}
    }
    if (typeof this.api.getCurrentChatIndex === 'function') {
      try { chatIndex = await this.api.getCurrentChatIndex(); } catch {}
    }
    return { charIndex, chatIndex };
  }

  async readActiveCharacter() {
    const char = await this._getCharacter();
    const { charIndex, chatIndex } = await this._getActiveIndices();
    return { char, charIndex, chatIndex };
  }

  /**
   * Reads a specific chat by index (preferring getChatFromIndex for PocketRisu _placeholder safety).
   */
  async _readChatAt(charIndex, chatIndex, fallbackChar = null) {
    if (
      Number.isInteger(charIndex) &&
      charIndex >= 0 &&
      typeof this.api.getChatFromIndex === 'function'
    ) {
      try {
        const fetched = await this.api.getChatFromIndex(charIndex, chatIndex);
        if (fetched && !fetched._placeholder) {
          return fetched;
        }
      } catch {}
    }
    const char = fallbackChar || (await this._getCharacter());
    const fallback = char?.chats?.[chatIndex] ?? null;
    if (fallback?._placeholder) {
      throw new Error('채팅 본문이 아직 서버에서 로드되지 않았습니다(_placeholder). 채팅을 연 뒤 다시 시도해 주세요.');
    }
    return fallback;
  }

  /**
   * Reads active chat via getChatFromIndex first (required by PocketRisu for unopened _placeholder chats),
   * falling back to char.chats[chatPage].
   */
  async readActiveChat() {
    const { char, charIndex, chatIndex } = await this.readActiveCharacter();
    if (!char) return { chat: null, char, charIndex, chatIndex };
    const resolvedChatIdx = Number.isInteger(chatIndex) ? chatIndex : (char.chatPage ?? 0);
    const chat = await this._readChatAt(charIndex, resolvedChatIdx, char);
    return { chat, char, charIndex, chatIndex: resolvedChatIdx };
  }

  /**
   * Saves a modified chat via setChatToIndex() when supported (required by PocketRisu / RisuNest),
   * falling back to updating char.chats[chatIndex] via _setCharacter() on older/hardened forks.
   */
  async _setChat(charIndex, chatIndex, nextChat) {
    if (
      typeof this.api.setChatToIndex === 'function' &&
      Number.isInteger(charIndex) &&
      charIndex >= 0
    ) {
      try {
        await this.api.setChatToIndex(charIndex, chatIndex, nextChat);
        return;
      } catch (err) {
        if (!isMissingMethodError(err)) throw err;
      }
    }
    const { char } = await this.readActiveCharacter();
    if (!char || !Array.isArray(char.chats) || !char.chats[chatIndex]) {
      throw new Error('채팅 저장 API(setChatToIndex)를 사용할 수 없습니다.');
    }
    if (char.chats[chatIndex]._placeholder) {
      throw new Error('채팅 본문이 아직 로드되지 않았습니다(_placeholder). setChatToIndex 지원 호스트가 필요합니다.');
    }
    const nextChar = clone(char);
    nextChar.chats[chatIndex] = clone(nextChat);
    await this._setCharacter(nextChar);
  }

  async _requireSameActiveCharacter(binding, actionVerb = '적용') {
    const { char, charIndex, chatIndex } = await this.readActiveCharacter();
    if (!char) throw new Error('선택된 캐릭터가 없습니다.');
    if (binding && !isSameCharacter(char, charIndex, binding)) {
      throw new Error(`다른 캐릭터로 전환되어 ${actionVerb}을(를) 중단했습니다. 원래 캐릭터로 돌아온 뒤 다시 시도해 주세요.`);
    }
    return { char, charIndex, chatIndex };
  }

  async _requireSameActiveChat(binding, actionVerb = '적용') {
    const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
    if (!chat) throw new Error('활성 채팅을 찾을 수 없습니다.');
    if (binding) {
      if (!isSameCharacter(char, charIndex, binding)) {
        throw new Error(`다른 캐릭터로 전환되어 ${actionVerb}을(를) 중단했습니다. 원래 캐릭터로 돌아온 뒤 다시 시도해 주세요.`);
      }
      if (Number.isInteger(binding.chatIndex) && binding.chatIndex !== chatIndex) {
        throw new Error(`다른 채팅으로 전환되어 ${actionVerb}을(를) 중단했습니다. 원래 채팅으로 돌아온 뒤 다시 시도해 주세요.`);
      }
    }
    return { chat, char, charIndex, chatIndex };
  }

  /**
   * Resolves the effective target while blocking prompt-injected target/fieldKey overrides.
   */
  _resolveSafeTarget(proposal, activeTarget) {
    const base = { ...(activeTarget || {}) };
    const pt = proposal?.target;

    if (pt !== undefined) {
      if (!pt || typeof pt !== 'object' || Array.isArray(pt)) {
        throw new Error('제안의 target 형식이 올바르지 않습니다.');
      }
      for (const k of Object.keys(pt)) {
        if (BAD_KEYS.has(k)) throw new Error(`허용되지 않는 target 키입니다: ${k}`);
      }
    }

    if (proposal?.action === 'patch_text' || proposal?.action === 'replace_text') {
      // Never allow LLM proposal.target to redirect a direct text edit to a different field or target
      if (pt) {
        const guardedKeys = [
          'targetKind', 'fieldKey', 'loreIndex', 'loreScope',
          'personaIndex', 'moduleIndex', 'regexIndex', 'greetingIndex', 'messageIndex',
        ];
        for (const k of guardedKeys) {
          if (pt[k] !== undefined && pt[k] !== null && pt[k] !== base[k]) {
            throw new Error(`보안상 제안 블록의 target.${k}(${String(pt[k])})로 현재 선택 대상을 덮어쓸 수 없습니다.`);
          }
        }
      }
      assertAllowedFieldKey(base.targetKind, base.fieldKey);
      return base;
    }

    const merged = pt ? { ...base, ...pt } : base;
    assertAllowedFieldKey(merged.targetKind, merged.fieldKey);
    return merged;
  }

  async readDbSubset(keys) {
    if (typeof this.api.getDatabase !== 'function') return null;
    const safeKeys = keys.filter(k => k !== 'plugins');
    return await this.api.getDatabase(safeKeys);
  }

  /**
   * Always uses async setDatabase() and never passes `plugins` or `characters` to setDatabaseLite().
   */
  async writeDbSubset(partial) {
    const safe = {};
    for (const [k, v] of Object.entries(partial)) {
      if (k === 'plugins') continue;
      safe[k] = v;
    }
    if (typeof this.api.setDatabase === 'function') {
      await this.api.setDatabase(safe);
      return;
    }
    if (typeof this.api.setDatabaseLite === 'function' && !Object.hasOwn(safe, 'characters')) {
      await this.api.setDatabaseLite(safe);
      return;
    }
    throw new Error('데이터베이스 저장 API를 사용할 수 없습니다.');
  }

  async readAllowedConfig() {
    const db = await this.readDbSubset(ALLOWED_CONFIG_KEYS);
    if (!db) return null;
    const out = {};
    for (const key of ALLOWED_CONFIG_KEYS) {
      if (Object.hasOwn(db, key)) out[key] = db[key];
    }
    return out;
  }

  async readPersonas() {
    const db = await this.readDbSubset(['personas', 'selectedPersona']);
    if (!db) return { personas: [], selectedPersona: 0, permissionDenied: true };
    return {
      personas: Array.isArray(db.personas) ? db.personas : [],
      selectedPersona: Number.isInteger(db.selectedPersona) ? db.selectedPersona : 0,
      permissionDenied: false,
    };
  }

  async readModules() {
    const db = await this.readDbSubset(['modules', 'enabledModules', 'moduleIntergration']);
    if (!db) return { modules: [], enabledModules: [], moduleIntergration: '', permissionDenied: true };
    return {
      modules: Array.isArray(db.modules) ? db.modules : [],
      enabledModules: Array.isArray(db.enabledModules) ? db.enabledModules : [],
      moduleIntergration: typeof db.moduleIntergration === 'string' ? db.moduleIntergration : '',
      permissionDenied: false,
    };
  }

  /**
   * Resolves the current source content, host identity binding, and rich metadata for any target descriptor.
   */
  async readTargetSnapshot(target) {
    const t = target || { targetKind: 'general' };

    if (t.targetKind === 'char_field') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const fieldKey = t.fieldKey || 'desc';
      const fieldErr = validateAllowedFieldKey('char_field', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      const content = fieldKey === 'depthPrompt'
        ? String(char.depth_prompt?.prompt ?? '')
        : String(char[fieldKey] ?? '');
      const orphanedCharLore = findOrphanedLorebooks(char.globalLore);
      return {
        ok: true,
        target: { ...t, fieldKey },
        hostBinding: { charIndex, ...getCharIdentity(char) },
        label: CHAR_FIELD_META[fieldKey]?.label || fieldKey,
        content,
        charName: char.name || '(이름 없음)',
        ...(orphanedCharLore.length > 0 ? {
          orphanedLoreCount: orphanedCharLore.length,
          orphanedLoreIndices: orphanedCharLore,
          orphanedLoreScopeLabel: '캐릭터 로어북',
          orphanedLoreTarget: { targetKind: 'char_lorebook', loreScope: 'character' },
        } : {}),
      };
    }

    if (t.targetKind === 'char_alt_greeting') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const list = Array.isArray(char.alternateGreetings) ? char.alternateGreetings : [];
      // No guessing: without a valid index nothing is selected. Falling back to the first
      // greeting would turn "write a new one" into overwriting an existing greeting.
      const idx =
        Number.isInteger(t.greetingIndex) && t.greetingIndex >= 0 && t.greetingIndex < list.length
          ? t.greetingIndex
          : null;
      return {
        ok: true,
        target: { ...t, fieldKey: 'alternateGreetings', greetingIndex: idx },
        hostBinding: { charIndex, greetingIndex: idx, ...getCharIdentity(char) },
        label: idx !== null
          ? `캐릭터 · 추가 첫 메시지 #${idx + 1} (${char.name || '무제'})`
          : `캐릭터 · 추가 첫 메시지 (항목 미선택 · 현재 ${list.length}개 · ${char.name || '무제'})`,
        content: idx !== null ? String(list[idx] ?? '') : '',
        greetingCount: list.length,
        altGreetingsSummary: list.slice(0, 40).map((g, i) => ({
          index: i,
          preview: String(g ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        })),
        charName: char.name || '(이름 없음)',
      };
    }

    if (t.targetKind === 'chat_note') {
      const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat) return { ok: false, reason: '활성 채팅을 찾을 수 없습니다.', content: '' };
      const fieldKey = t.fieldKey || 'note';
      const fieldErr = validateAllowedFieldKey('chat_note', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      return {
        ok: true,
        target: { ...t, fieldKey: 'note' },
        hostBinding: { charIndex, chatIndex, ...getCharIdentity(char) },
        label: '작가의 노트 (현재 채팅)',
        content: String(chat.note ?? ''),
        charName: char?.name || '(이름 없음)',
      };
    }

    if (t.targetKind === 'chat_message') {
      const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat) return { ok: false, reason: '활성 채팅을 찾을 수 없습니다.', content: '' };
      // In Chat.svelte, data-chat-index="-1" represents the active greeting (firstMessage or alternateGreetings[fmIndex])
      if (t.messageIndex === -1 && char) {
        const fmIndex = Number.isInteger(chat.fmIndex) ? chat.fmIndex : -1;
        if (fmIndex >= 0 && Array.isArray(char.alternateGreetings) && char.alternateGreetings[fmIndex] !== undefined) {
          return await this.readTargetSnapshot({
            ...t,
            screen: 'character',
            targetKind: 'char_alt_greeting',
            fieldKey: 'alternateGreetings',
            greetingIndex: fmIndex,
            messageIndex: undefined,
          });
        }
        return await this.readTargetSnapshot({
          ...t,
          screen: 'character',
          targetKind: 'char_field',
          fieldKey: 'firstMessage',
          messageIndex: undefined,
        });
      }
      const list = Array.isArray(chat.message) ? chat.message : [];
      const idx =
        Number.isInteger(t.messageIndex) && t.messageIndex >= 0 && t.messageIndex < list.length
          ? t.messageIndex
          : (list.length > 0 ? list.length - 1 : null);
      const msg = idx !== null ? list[idx] : null;
      const roleLabel = msg?.role === 'user' ? '유저' : '캐릭터';
      const startOffset = Math.max(0, list.length - 30);
      return {
        ok: true,
        target: { ...t, fieldKey: 'data', messageIndex: idx },
        hostBinding: { charIndex, chatIndex, messageIndex: idx, chatId: msg?.chatId || null, ...getCharIdentity(char) },
        label: msg ? `채팅 메시지 #${idx + 1} (${roleLabel})` : '채팅 메시지 (없음)',
        content: msg ? String(msg.data ?? '') : '',
        messageCount: list.length,
        messagesSummary: list.slice(startOffset).map((m, i) => ({
          index: startOffset + i,
          role: m?.role === 'user' ? '유저' : '캐릭터',
          preview: String(m?.data ?? '').replace(/\s+/g, ' ').trim().slice(0, 36),
        })),
        charName: char?.name || '(이름 없음)',
      };
    }

    if (t.targetKind === 'char_lorebook') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const list = Array.isArray(char.globalLore) ? char.globalLore : [];
      const idx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
      const entry = idx !== null && list[idx] ? list[idx] : null;
      const fieldKey = t.fieldKey || 'content';
      const fieldErr = validateAllowedFieldKey('char_lorebook', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      const { loreSummary, foldersSummary, orphanedLoreIndices, orphanedLoreCount } = summarizeLoreList(list);
      return {
        ok: true,
        target: { ...t, loreIndex: idx, fieldKey },
        hostBinding: { charIndex, ...getCharIdentity(char) },
        label: entry ? `캐릭터 로어북 #${idx + 1} (${entry.comment || '무제'})` : `캐릭터 로어북 (${list.length}개)`,
        content: entry ? String(entry[fieldKey] ?? '') : '',
        entry,
        loreCount: list.length,
        loreSummary,
        foldersSummary,
        orphanedLoreIndices,
        orphanedLoreCount,
        ...(orphanedLoreCount > 0 ? {
          orphanedLoreScopeLabel: '캐릭터 로어북',
          orphanedLoreTarget: { targetKind: 'char_lorebook', loreScope: 'character' },
        } : {}),
      };
    }

    if (t.targetKind === 'chat_lorebook') {
      const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat) return { ok: false, reason: '활성 채팅을 찾을 수 없습니다.', content: '' };
      const list = Array.isArray(chat.localLore) ? chat.localLore : [];
      const idx = Number.isInteger(t.loreIndex) ? t.loreIndex : null;
      const entry = idx !== null && list[idx] ? list[idx] : null;
      const fieldKey = t.fieldKey || 'content';
      const fieldErr = validateAllowedFieldKey('chat_lorebook', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      const { loreSummary, foldersSummary, orphanedLoreIndices, orphanedLoreCount } = summarizeLoreList(list);
      return {
        ok: true,
        target: { ...t, loreIndex: idx, fieldKey },
        hostBinding: { charIndex, chatIndex, ...getCharIdentity(char) },
        label: entry ? `채팅 로어북 #${idx + 1} (${entry.comment || '무제'})` : `채팅 로어북 (${list.length}개)`,
        content: entry ? String(entry[fieldKey] ?? '') : '',
        entry,
        loreCount: list.length,
        loreSummary,
        foldersSummary,
        orphanedLoreIndices,
        orphanedLoreCount,
        ...(orphanedLoreCount > 0 ? {
          orphanedLoreScopeLabel: '채팅 로어북',
          orphanedLoreTarget: { targetKind: 'chat_lorebook', loreScope: 'chat' },
        } : {}),
      };
    }

    if (t.targetKind === 'char_lua') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const lua = extractLuaFromTriggers(char.triggerscript);
      return {
        ok: true,
        target: { ...t, fieldKey: 'code' },
        hostBinding: { charIndex, ...getCharIdentity(char) },
        label: `캐릭터 Lua 트리거 (${char.name || '무제'})`,
        content: lua.code,
        isLua: lua.isLua,
        hasOtherTriggers: lua.hasOtherTriggers,
        otherTriggerCount: lua.otherTriggerCount,
      };
    }

    if (t.targetKind === 'char_regex') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, reason: '선택된 캐릭터가 없습니다.', content: '' };
      const list = Array.isArray(char.customscript) ? char.customscript : [];
      const idx = Number.isInteger(t.regexIndex) ? t.regexIndex : null;
      const entry = idx !== null && list[idx] ? list[idx] : null;
      return {
        ok: true,
        target: { ...t, regexIndex: idx },
        hostBinding: { charIndex, ...getCharIdentity(char) },
        label: entry ? `캐릭터 정규식 #${idx + 1} (${entry.comment || '무제'})` : `캐릭터 정규식 (${list.length}개)`,
        content: entry ? JSON.stringify(entry, null, 2) : '',
        entry,
        regexList: list.slice(0, 30),
      };
    }

    if (t.targetKind === 'persona') {
      const { personas, selectedPersona, permissionDenied } = await this.readPersonas();
      if (permissionDenied) return { ok: false, reason: DB_PERMISSION_ERROR, content: '' };
      const idx = Number.isInteger(t.personaIndex) ? t.personaIndex : selectedPersona;
      const entry = personas[idx] ?? null;
      const fieldKey = t.fieldKey || 'personaPrompt';
      const fieldErr = validateAllowedFieldKey('persona', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      return {
        ok: true,
        target: { ...t, personaIndex: idx, fieldKey },
        hostBinding: { personaIndex: idx, personaId: entry?.id || null },
        label: entry ? `페르소나 #${idx + 1} (${entry.name || '무제'})` : '페르소나 목록',
        content: entry ? String(entry[fieldKey] ?? '') : '',
        entry,
        personasSummary: personas.map((p, i) => ({
          index: i,
          id: p.id || '',
          name: p.name || '',
          note: p.note || '',
          selected: i === selectedPersona,
        })),
        selectedPersona,
      };
    }

    if (
      t.targetKind === 'module_field' ||
      t.targetKind === 'module_lorebook' ||
      t.targetKind === 'module_lua' ||
      t.targetKind === 'module_regex'
    ) {
      const { modules, enabledModules, permissionDenied } = await this.readModules();
      if (permissionDenied) return { ok: false, reason: DB_PERMISSION_ERROR, content: '' };
      const resolvedMod = resolveModuleIndex(modules, t, this._lastMatchedModuleId);
      const modIdx = resolvedMod.index;
      const mod = modIdx !== null ? modules[modIdx] : null;
      if (!mod) return { ok: true, target: t, label: '설치된 모듈 없음', content: '', modulesSummary: [] };
      if (mod.id && (resolvedMod.matchedBy === 'explicit' || resolvedMod.matchedBy === 'dom_hints')) {
        this._lastMatchedModuleId = mod.id;
      }

      let content = '';
      let label = `모듈: ${mod.name}`;
      let entry = null;
      let isLua = false;
      let hasOtherTriggers = false;
      let otherTriggerCount = 0;
      let resolvedFieldKey = t.fieldKey;
      let resolvedLoreIdx = t.loreIndex;
      let resolvedRegexIdx = t.regexIndex;
      let loreCount;
      let loreSummary;
      let foldersSummary;
      let orphanedLoreIndices;
      let orphanedLoreCount;
      let regexList;

      if (t.targetKind === 'module_field') {
        const fieldKey = t.fieldKey || 'backgroundEmbedding';
        const fieldErr = validateAllowedFieldKey('module_field', fieldKey);
        if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
        resolvedFieldKey = fieldKey;
        content = String(mod[fieldKey] ?? '');
        const metaLabel = MODULE_FIELD_META[fieldKey]?.label || `모듈 · ${fieldKey}`;
        label = `${metaLabel} (${mod.name || '무제'})`;
      } else if (t.targetKind === 'module_lua') {
        const lua = extractLuaFromTriggers(mod.trigger);
        content = lua.code;
        isLua = lua.isLua;
        hasOtherTriggers = lua.hasOtherTriggers;
        otherTriggerCount = lua.otherTriggerCount;
        label = `모듈 Lua (${mod.name})`;
      } else if (t.targetKind === 'module_regex') {
        const list = Array.isArray(mod.regex) ? mod.regex : [];
        const rIdx = Number.isInteger(t.regexIndex) && list[t.regexIndex] ? t.regexIndex : null;
        resolvedRegexIdx = rIdx;
        entry = rIdx !== null ? list[rIdx] : null;
        content = entry ? JSON.stringify(entry, null, 2) : '';
        label = entry ? `모듈 정규식 (${mod.name} #${rIdx + 1})` : `모듈 정규식 (${mod.name}, ${list.length}개)`;
        regexList = list.slice(0, 30);
      } else {
        const list = Array.isArray(mod.lorebook) ? mod.lorebook : [];
        const lIdx = Number.isInteger(t.loreIndex) && list[t.loreIndex] ? t.loreIndex : null;
        resolvedLoreIdx = lIdx;
        entry = lIdx !== null ? list[lIdx] : null;
        const fieldKey = t.fieldKey || 'content';
        const fieldErr = validateAllowedFieldKey('module_lorebook', fieldKey);
        if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
        resolvedFieldKey = fieldKey;
        content = entry ? String(entry[fieldKey] ?? '') : '';
        const entryTitle = entry?.comment ? ` · ${entry.comment}` : '';
        label = entry ? `모듈 로어북 (${mod.name} #${lIdx + 1}${entryTitle})` : `모듈 로어북 (${mod.name}, ${list.length}개)`;
        loreCount = list.length;
        const summarized = summarizeLoreList(list);
        loreSummary = summarized.loreSummary;
        foldersSummary = summarized.foldersSummary;
        orphanedLoreIndices = summarized.orphanedLoreIndices;
        orphanedLoreCount = summarized.orphanedLoreCount;
      }

      const moduleUncertain = isUncertainModuleMatch(resolvedMod.matchedBy);
      if (!moduleUncertain && orphanedLoreCount === undefined) {
        const modOrphaned = findOrphanedLorebooks(mod.lorebook);
        if (modOrphaned.length > 0) {
          orphanedLoreIndices = modOrphaned;
          orphanedLoreCount = modOrphaned.length;
        }
      }

      return {
        ok: true,
        target: {
          ...t,
          moduleIndex: modIdx,
          fieldKey: resolvedFieldKey,
          ...(t.targetKind === 'module_lorebook' ? { loreIndex: resolvedLoreIdx } : {}),
          ...(t.targetKind === 'module_regex' ? { regexIndex: resolvedRegexIdx } : {}),
        },
        hostBinding: { moduleIndex: modIdx, moduleId: mod.id || null },
        moduleMatchedBy: resolvedMod.matchedBy,
        moduleUncertain,
        label,
        content,
        entry,
        isLua,
        hasOtherTriggers,
        otherTriggerCount,
        ...(loreSummary !== undefined ? { loreCount, loreSummary, foldersSummary } : {}),
        ...(orphanedLoreCount !== undefined ? { orphanedLoreIndices, orphanedLoreCount } : {}),
        ...(!moduleUncertain && orphanedLoreCount > 0 ? {
          orphanedLoreScopeLabel: `모듈 "${mod.name || '무제'}" 로어북`,
          orphanedLoreTarget: { targetKind: 'module_lorebook', loreScope: 'module', moduleIndex: modIdx },
        } : {}),
        ...(regexList !== undefined ? { regexList } : {}),
        module: mod,
        modulesSummary: modules.map((m, i) => ({
          index: i,
          id: m.id,
          name: m.name,
          enabled: enabledModules.includes(m.id),
          loreCount: m.lorebook?.length ?? 0,
        })),
      };
    }

    if (t.targetKind === 'config') {
      const cfg = await this.readAllowedConfig();
      if (!cfg) return { ok: false, reason: DB_PERMISSION_ERROR, content: '' };
      const fieldKey = t.fieldKey || null;
      const fieldErr = validateAllowedFieldKey('config', fieldKey);
      if (fieldErr) return { ok: false, reason: fieldErr, content: '' };
      return {
        ok: true,
        target: { ...t, fieldKey },
        label: fieldKey ? (CONFIG_FIELD_META[fieldKey]?.label || `설정 · ${fieldKey}`) : 'RisuAI 설정 (허용 키)',
        content: fieldKey ? String(cfg[fieldKey] ?? '') : JSON.stringify(cfg, null, 2),
        config: cfg,
      };
    }

    if (t.screen === 'chat') {
      try {
        const { char, charIndex } = await this.readActiveCharacter();
        if (char) {
          const orphanedCharLore = findOrphanedLorebooks(char.globalLore);
          return {
            ok: true,
            target: t,
            hostBinding: { charIndex, ...getCharIdentity(char) },
            label: `채팅 화면 (${char.name || '이름 없음'})`,
            content: '',
            charName: char.name || '',
            ...(orphanedCharLore.length > 0 ? {
              orphanedLoreCount: orphanedCharLore.length,
              orphanedLoreIndices: orphanedCharLore,
              orphanedLoreScopeLabel: '캐릭터 로어북',
              orphanedLoreTarget: { targetKind: 'char_lorebook', loreScope: 'character' },
            } : {}),
          };
        }
      } catch {}
      return { ok: true, target: t, label: '채팅 입력 화면', content: '' };
    }

    return { ok: true, target: t, label: '일반 대화 / 질문', content: '' };
  }

  // ---------------------------------------------------------------------------------------------
  // Undo journal. Every write goes through a _commit* helper, which stores the JSON operations
  // (src/undo-journal.js) that turn the previous entity state into the written one. Records are
  // serialisable (exportUndoState / importUndoState), can be grouped, and revert with guards.
  // ---------------------------------------------------------------------------------------------

  get maxUndo() { return this.maxUndoUnits; }
  set maxUndo(n) { this.maxUndoUnits = n; }

  /** Undo units in stack order: a group of records counts as one unit. */
  _undoUnits() {
    const units = [];
    for (const rec of this.undoStack) {
      const last = units[units.length - 1];
      if (rec.groupId && last && last.groupId === rec.groupId) last.records.push(rec);
      else units.push({ groupId: rec.groupId || null, records: [rec] });
    }
    return units;
  }

  undoUnitCount() {
    return this._undoUnits().length;
  }

  /** Label of what the next global undo would revert (for the UI). */
  peekUndoLabel() {
    const units = this._undoUnits();
    const top = units[units.length - 1];
    if (!top) return '';
    if (top.groupId && top.records.length > 1) {
      return `${top.records[0].groupLabel || '묶음 적용'} (${top.records.length}건)`;
    }
    return top.records[0].label;
  }

  _emitUndoChange(info = {}) {
    if (typeof this.onUndoChange === 'function') {
      try { this.onUndoChange(info); } catch {}
    }
  }

  _enforceUndoLimits() {
    const labels = [];
    const ids = [];
    const totalSize = () => this.undoStack.reduce((sum, r) => sum + (r.size || 0), 0);
    let units = this._undoUnits();
    while (units.length > 1 && (units.length > this.maxUndoUnits || totalSize() > this.maxUndoBytes)) {
      const oldest = units.shift();
      for (const rec of oldest.records) {
        const at = this.undoStack.indexOf(rec);
        if (at !== -1) this.undoStack.splice(at, 1);
        labels.push(rec.label);
        ids.push(rec.id);
      }
    }
    return { labels, ids };
  }

  _recordChange(entity, ops, label, opts = {}) {
    const change = { entity, ops };
    const size = JSON.stringify(change).length;
    if (opts.appendTo) {
      const existing = this.undoStack.find(r => r.id === opts.appendTo);
      if (existing) {
        existing.changes.push(change);
        existing.size = (existing.size || 0) + size;
        this._emitUndoChange({});
        return existing.id;
      }
    }
    const record = {
      id: makeUuid(),
      timestamp: Date.now(),
      label: String(label || '변경'),
      groupId: this._activeGroup?.id || null,
      groupLabel: this._activeGroup?.label || null,
      changes: [change],
      size,
    };
    this.undoStack.push(record);
    const { labels: evicted, ids: evictedIds } = this._enforceUndoLimits();
    this._emitUndoChange({ evicted, evictedIds });
    return record.id;
  }

  async _commitCharacter(char, charIndex, nextChar, label, opts = {}) {
    const ops = diffValues(char, nextChar);
    await this._setCharacter(nextChar);
    return this._recordChange({ type: 'char', binding: { charIndex, ...getCharIdentity(char) } }, ops, label, opts);
  }

  async _commitChat(chat, charIndex, chatIndex, nextChat, label, opts = {}) {
    const ops = diffValues(chat, nextChat);
    let identity = { charId: null, charName: null };
    try {
      identity = getCharIdentity(await this._getCharacter());
    } catch {}
    await this._setChat(charIndex, chatIndex, nextChat);
    return this._recordChange({ type: 'chat', chatIndex, binding: { charIndex, ...identity } }, ops, label, opts);
  }

  async _commitDb(before, next, label, opts = {}) {
    const ops = diffValues(before, next);
    await this.writeDbSubset(next);
    return this._recordChange({ type: 'db', keys: Object.keys(next) }, ops, label, opts);
  }

  /** Applies several proposals as one undo unit. */
  async runGroup(label, fn) {
    if (this._activeGroup) {
      const result = await fn();
      return { groupId: this._activeGroup.id, result };
    }
    this._activeGroup = { id: makeUuid(), label: String(label || '묶음 적용') };
    const groupId = this._activeGroup.id;
    try {
      const result = await fn();
      return { groupId, result };
    } finally {
      this._activeGroup = null;
    }
  }

  async _revertRecord(record) {
    let reverted = 0;
    const conflicts = [];
    for (let n = record.changes.length - 1; n >= 0; n--) {
      const { entity, ops } = record.changes[n];
      if (!Array.isArray(ops) || ops.length === 0) continue;

      if (entity.type === 'char') {
        const { char: latest } = await this._requireSameActiveCharacter(entity.binding, '되돌리기');
        const res = revertOps(latest, ops);
        if (res.reverted > 0) await this._setCharacter(res.value);
        reverted += res.reverted;
        conflicts.push(...res.conflicts);
      } else if (entity.type === 'chat') {
        const { charIndex } = await this._requireSameActiveCharacter(entity.binding, '되돌리기');
        const latestChat = await this._readChatAt(charIndex, entity.chatIndex);
        if (!latestChat) throw new Error('되돌릴 채팅을 찾을 수 없습니다.');
        const res = revertOps(latestChat, ops);
        if (res.reverted > 0) await this._setChat(charIndex, entity.chatIndex, res.value);
        reverted += res.reverted;
        conflicts.push(...res.conflicts);
      } else if (entity.type === 'db') {
        const current = (await this.readDbSubset(entity.keys)) || {};
        const scoped = {};
        for (const k of entity.keys) {
          if (Object.hasOwn(current, k)) scoped[k] = current[k];
        }
        const res = revertOps(scoped, ops);
        if (res.reverted > 0) {
          const partial = {};
          for (const k of entity.keys) {
            if (Object.hasOwn(res.value, k)) partial[k] = res.value[k];
          }
          if (Object.keys(partial).length > 0) await this.writeDbSubset(partial);
        }
        reverted += res.reverted;
        conflicts.push(...res.conflicts);
      }
    }
    return { reverted, conflicts };
  }

  /**
   * Undoes one record (`undoId`), or — without an id — the most recent unit (a whole group if the
   * last change was applied as a group). Values the user changed afterwards are left alone and
   * reported in `conflicts`.
   */
  async undo(undoId = null) {
    if (this.undoStack.length === 0) throw new Error('되돌릴 내역이 없습니다.');
    let records;
    if (undoId) {
      const rec = this.undoStack.find(item => item.id === undoId);
      if (!rec) throw new Error('되돌릴 내역이 없습니다. (기록이 정리되었거나 이미 되돌렸습니다)');
      records = [rec];
    } else {
      const units = this._undoUnits();
      records = [...units[units.length - 1].records].reverse();
    }
    return this._undoRecords(records);
  }

  async undoGroup(groupId) {
    const records = this.undoStack.filter(r => r.groupId === groupId).reverse();
    if (records.length === 0) throw new Error('되돌릴 내역이 없습니다. (기록이 정리되었거나 이미 되돌렸습니다)');
    return this._undoRecords(records);
  }

  async _undoRecords(records) {
    let undone = 0;
    let reverted = 0;
    let removedAny = false;
    const conflicts = [];
    const labels = [];
    try {
      for (const rec of records) {
        const res = await this._revertRecord(rec);
        const at = this.undoStack.indexOf(rec);
        if (at !== -1) {
          this.undoStack.splice(at, 1);
          removedAny = true;
        }
        reverted += res.reverted;
        conflicts.push(...res.conflicts);
        if (res.reverted > 0) undone++;
        labels.push(rec.label);
      }
    } finally {
      if (removedAny) this._emitUndoChange({});
    }
    if (reverted === 0 && conflicts.length > 0) {
      const err = new Error(
        `되돌리지 않았습니다: 적용 이후 값이 다시 변경되어 덮어쓰지 않았습니다 (${conflicts.slice(0, 3).map(c => c.path).join(', ')}). 이 기록은 목록에서 제거했습니다.`
      );
      err.code = 'UNDO_CONFLICT';
      throw err;
    }
    const label = records.length > 1 ? `${records[records.length - 1].groupLabel || '묶음 적용'} (${records.length}건)` : labels[0];
    return { ok: true, label, undone, reverted, conflicts };
  }

  exportUndoState() {
    return { version: 1, records: this.undoStack.map(r => ({ ...r })) };
  }

  importUndoState(state) {
    if (!state || state.version !== 1 || !Array.isArray(state.records)) return 0;
    const valid = state.records.filter(r =>
      r && typeof r.id === 'string' && typeof r.label === 'string' && Array.isArray(r.changes) &&
      r.changes.every(c => c && c.entity && typeof c.entity.type === 'string' && Array.isArray(c.ops))
    );
    this.undoStack = valid.map(r => ({ ...r }));
    this._enforceUndoLimits();
    return this.undoStack.length;
  }

  async _loadLorebookForPreview(scope, proposal, target) {
    if (scope === 'chat') {
      const { chat, char, charIndex, chatIndex } = await this.readActiveChat();
      if (!chat) return { ok: false, error: '활성 채팅을 찾을 수 없습니다.' };
      const list = Array.isArray(chat.localLore) ? chat.localLore : [];
      return {
        ok: true,
        list,
        scopeLabel: '채팅 로어북',
        target: { ...target, targetKind: 'chat_lorebook', loreScope: 'chat' },
        hostBinding: { charIndex, chatIndex, ...getCharIdentity(char) },
      };
    }

    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) return { ok: false, error: DB_PERMISSION_ERROR };
      const modTarget = {
        ...target,
        targetKind: 'module_lorebook',
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
        moduleDomHints: proposal.moduleIndex === undefined ? target.moduleDomHints : undefined,
      };
      const resolvedMod = resolveModuleIndex(modules, modTarget, this._lastMatchedModuleId);
      const modIdx = resolvedMod.index;
      const mod = modIdx !== null ? modules[modIdx] : null;
      if (!mod) return { ok: false, error: '대상 모듈을 찾을 수 없습니다.' };
      if (isUncertainModuleMatch(resolvedMod.matchedBy)) {
        return {
          ok: false,
          error: MODULE_UNCERTAIN_ERROR,
          label: `모듈 로어북 (${mod.name || '무제'})`,
          target: { ...modTarget, moduleIndex: modIdx, loreScope: 'module' },
        };
      }
      const list = Array.isArray(mod.lorebook) ? mod.lorebook : [];
      return {
        ok: true,
        list,
        scopeLabel: `모듈 "${mod.name || '무제'}" 로어북`,
        target: { ...modTarget, moduleIndex: modIdx, loreScope: 'module' },
        hostBinding: { moduleIndex: modIdx, moduleId: mod.id || null },
      };
    }

    const { char, charIndex } = await this.readActiveCharacter();
    if (!char) return { ok: false, error: '선택된 캐릭터가 없습니다.' };
    const list = Array.isArray(char.globalLore) ? char.globalLore : [];
    return {
      ok: true,
      list,
      scopeLabel: '캐릭터 로어북',
      target: { ...target, targetKind: 'char_lorebook', loreScope: 'character' },
      hostBinding: { charIndex, ...getCharIdentity(char) },
    };
  }

  /**
   * Every index or id a proposal names must exist before anything is previewed or written.
   * Kept in one place so that a new action cannot forget the check: a reference that does not
   * resolve must fail loudly, never be redirected to another item or stored as-is.
   */
  async _findReferenceError(proposal, target, options = {}) {
    const formatBadIndex = (raw) => (Number.isInteger(raw) ? `#${raw + 1}` : `"${String(raw)}"`);
    let modulesCache = null;
    const loadModules = async () => {
      if (!modulesCache) modulesCache = await this.readModules();
      return modulesCache;
    };

    if (proposal.moduleIndex !== undefined && proposal.moduleIndex !== null) {
      const { modules, permissionDenied } = await loadModules();
      if (permissionDenied) return DB_PERMISSION_ERROR;
      if (!Number.isInteger(proposal.moduleIndex) || !modules[proposal.moduleIndex]) {
        return `제안이 가리키는 모듈(${formatBadIndex(proposal.moduleIndex)})이 없습니다. (설치된 모듈 ${modules.length}개)`;
      }
    }

    if (proposal.action === 'update_config' && proposal.changes && typeof proposal.changes === 'object') {
      const changes = proposal.changes;
      if (Object.hasOwn(changes, 'selectedPersona')) {
        const { personas, permissionDenied } = await this.readPersonas();
        if (permissionDenied) return DB_PERMISSION_ERROR;
        if (!Number.isInteger(changes.selectedPersona) || !personas[changes.selectedPersona]) {
          return `선택하려는 페르소나(${formatBadIndex(changes.selectedPersona)})가 없습니다. (등록된 페르소나 ${personas.length}개)`;
        }
      }
      if (Array.isArray(changes.enabledModules)) {
        const { modules, permissionDenied } = await loadModules();
        if (permissionDenied) return DB_PERMISSION_ERROR;
        const knownIds = new Set(modules.map(m => m?.id).filter(Boolean));
        const unknown = changes.enabledModules.filter(id => !knownIds.has(id));
        if (unknown.length > 0) {
          return `활성화하려는 모듈 ID가 설치된 모듈에 없습니다: ${unknown.map(String).join(', ')}`;
        }
      }
    }

    if (proposal.action === 'update_greeting' && proposal.greetingIndex !== -1) {
      const { char } = await this.readActiveCharacter();
      const list = Array.isArray(char?.alternateGreetings) ? char.alternateGreetings : [];
      if (!Number.isInteger(proposal.greetingIndex) || proposal.greetingIndex < 0 || proposal.greetingIndex >= list.length) {
        return `수정할 추가 첫 메시지 #${Number(proposal.greetingIndex) + 1}을(를) 찾을 수 없습니다. (현재 ${list.length}개) 새로 만들려면 create_greeting을 사용해 주세요.`;
      }
    }

    if (proposal.action === 'upsert_regex' && proposal.regexIndex !== undefined && proposal.regexIndex !== null) {
      const scope = proposal.scope || (target?.targetKind === 'module_regex' ? 'module' : 'character');
      let list = [];
      if (scope === 'module') {
        const { modules, permissionDenied } = await loadModules();
        if (permissionDenied) return DB_PERMISSION_ERROR;
        let modIdx = null;
        if (Number.isInteger(proposal.moduleIndex) && modules[proposal.moduleIndex]) {
          modIdx = proposal.moduleIndex;
        } else if (options?.hostBinding?.moduleId) {
          const byId = modules.findIndex(m => m && m.id === options.hostBinding.moduleId);
          if (byId !== -1) modIdx = byId;
        }
        if (modIdx === null) {
          const resolved = resolveModuleIndex(modules, target, this._lastMatchedModuleId);
          if (isUncertainModuleMatch(resolved.matchedBy)) return MODULE_UNCERTAIN_ERROR;
          modIdx = resolved.index;
        }
        list = Array.isArray(modules[modIdx]?.regex) ? modules[modIdx].regex : [];
      } else {
        const { char } = await this.readActiveCharacter();
        list = Array.isArray(char?.customscript) ? char.customscript : [];
      }
      if (!Number.isInteger(proposal.regexIndex) || !list[proposal.regexIndex]) {
        return `수정할 정규식 스크립트 ${formatBadIndex(proposal.regexIndex)}을(를) 찾을 수 없습니다. (현재 ${list.length}개) 새로 만들려면 regexIndex를 빼 주세요.`;
      }
    }

    return null;
  }

  /**
   * Computes the preview for a proposal. The returned `target` is what the card pins and later
   * passes back to applyProposal, so it must describe the item the proposal changes — not carry
   * over the field of whatever was under the cursor (e.g. `fieldKey: 'desc'` on a lorebook target).
   */
  async previewProposal(proposal, activeTarget) {
    const res = await this._previewProposalInner(proposal, activeTarget);
    if (res && res.target && validateAllowedFieldKey(res.target.targetKind, res.target.fieldKey)) {
      const { fieldKey: _stale, ...rest } = res.target;
      res.target = rest;
    }
    return res;
  }

  async _previewProposalInner(proposal, activeTarget) {
    let target;
    try {
      target = this._resolveSafeTarget(proposal, activeTarget);
    } catch (err) {
      return { ok: false, error: err.message };
    }
    const referenceError = await this._findReferenceError(proposal, target);
    if (referenceError) return { ok: false, error: referenceError };

    if (proposal.action === 'patch_text' || proposal.action === 'replace_text') {
      const snap = await this.readTargetSnapshot(target);
      if (!snap.ok) return { ok: false, error: snap.reason };
      if (snap.moduleUncertain) return { ok: false, error: MODULE_UNCERTAIN_ERROR, label: snap.label, target: snap.target };
      const kind = snap.target?.targetKind || target.targetKind;
      const nonEditableTextKinds = new Set(['general', 'char_regex', 'module_regex']);
      if (!kind || nonEditableTextKinds.has(kind)) {
        return {
          ok: false,
          error: `현재 대상(${kind || '없음'})에는 직접 텍스트 적용을 지원하지 않습니다. 상단에서 편집할 대상을 선택해 주세요.`,
          label: snap.label,
          target: snap.target,
        };
      }
      if (kind === 'config' && (!snap.target?.fieldKey || !ALLOWED_CONFIG_KEYS.includes(snap.target.fieldKey))) {
        return {
          ok: false,
          error: '특정 설정 필드가 선택되지 않았습니다. 설정 변경에는 update_config를 사용하거나 상단에서 설정 필드를 선택하세요.',
          label: snap.label,
          target: snap.target,
        };
      }
      if (
        (kind === 'char_lorebook' || kind === 'chat_lorebook' || kind === 'module_lorebook') &&
        (!Number.isInteger(snap.target?.loreIndex) || !snap.entry)
      ) {
        return {
          ok: false,
          error: '수정할 로어북 항목이 선택되지 않았습니다. 상단에서 로어북 항목을 선택하거나 create_lorebook을 사용하세요.',
          label: snap.label,
          target: snap.target,
        };
      }
      if (kind === 'char_alt_greeting' && !Number.isInteger(snap.target?.greetingIndex)) {
        return {
          ok: false,
          error: '수정할 추가 첫 메시지 항목이 선택되지 않았습니다. 상단에서 고칠 항목을 고르거나, 새 항목을 만들려면 "추가 첫 메시지를 새로 만들어줘"라고 요청해 주세요(create_greeting).',
          label: snap.label,
          target: snap.target,
        };
      }
      if (kind === 'chat_message' && !Number.isInteger(snap.target?.messageIndex)) {
        return {
          ok: false,
          error: '수정할 채팅 메시지가 없습니다. 채팅 대화가 있는 상태에서 메시지를 선택해 주세요.',
          label: snap.label,
          target: snap.target,
        };
      }
      if (kind === 'module_field' && !snap.module) {
        return {
          ok: false,
          error: '수정할 설치 모듈이 없습니다.',
          label: snap.label,
          target: snap.target,
        };
      }
      const before = snap.content;
      if (proposal.action === 'replace_text') {
        const truncErr = this._checkTruncationGuard(before, '전체 덮어쓰기(replace_text)');
        if (truncErr) {
          return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
        }
      }
      try {
        const after = proposal.action === 'patch_text'
          ? applyTextEdits(before, proposal.edits, proposal.title || snap.label)
          : String(proposal.content ?? '');
        const isLuaTarget = kind === 'char_lua' || kind === 'module_lua';
        const destructiveWarning = isLuaTarget && snap.hasOtherTriggers
          ? buildLuaDestructiveWarning(snap.otherTriggerCount)
          : null;
        return {
          ok: true,
          before,
          after,
          label: snap.label,
          target: snap.target,
          hostBinding: snap.hostBinding || null,
          destructiveWarning,
          requiresConfirm: Boolean(destructiveWarning),
          confirmLabel: destructiveWarning ? '기존 V1/V2 트리거가 삭제되고 Lua로 대체됨을 확인했습니다' : null,
        };
      } catch (err) {
        return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
      }
    }

    if (proposal.action === 'update_lua') {
      const scope = proposal.scope === 'module' ? 'module_lua' : 'char_lua';
      const snap = await this.readTargetSnapshot({
        targetKind: scope,
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
        moduleDomHints: proposal.moduleIndex === undefined ? target.moduleDomHints : undefined,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      if (snap.moduleUncertain) return { ok: false, error: MODULE_UNCERTAIN_ERROR, label: snap.label, target: snap.target };
      const before = snap.content;
      if (!proposal.edits) {
        const truncErr = this._checkTruncationGuard(before, 'Lua 전체 교체');
        if (truncErr) {
          return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
        }
      }
      try {
        const after = proposal.edits
          ? applyTextEdits(before, proposal.edits, 'Lua 스크립트')
          : String(proposal.code ?? proposal.content ?? '');
        const destructiveWarning = snap.hasOtherTriggers
          ? buildLuaDestructiveWarning(snap.otherTriggerCount)
          : null;
        return {
          ok: true,
          before,
          after,
          label: snap.label,
          target: snap.target,
          hostBinding: snap.hostBinding || null,
          warning: destructiveWarning,
          destructiveWarning,
          requiresConfirm: Boolean(destructiveWarning),
          confirmLabel: destructiveWarning ? '기존 V1/V2 트리거가 삭제되고 Lua로 대체됨을 확인했습니다' : null,
        };
      } catch (err) {
        return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
      }
    }

    if (proposal.action === 'update_lorebook') {
      const scope = proposal.scope || target.loreScope || (target.targetKind?.startsWith('module_') ? 'module' : target.targetKind === 'chat_lorebook' ? 'chat' : 'character');
      const targetKind = scope === 'chat' ? 'chat_lorebook' : scope === 'module' ? 'module_lorebook' : 'char_lorebook';
      const loreIndex = Number.isInteger(proposal.loreIndex) ? proposal.loreIndex : target.loreIndex;
      const fieldKey = proposal.fieldKey || 'content';
      const fieldErr = validateAllowedFieldKey(targetKind, fieldKey);
      if (fieldErr) return { ok: false, error: fieldErr };
      const snap = await this.readTargetSnapshot({
        targetKind,
        loreIndex,
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
        moduleDomHints: proposal.moduleIndex === undefined ? target.moduleDomHints : undefined,
        fieldKey,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      if (snap.moduleUncertain) return { ok: false, error: MODULE_UNCERTAIN_ERROR, label: snap.label, target: snap.target };
      if (!snap.entry) return { ok: false, error: `수정할 로어북 항목(#${loreIndex})을 찾을 수 없습니다.` };

      const before = String(snap.entry[fieldKey] ?? '');
      if (!proposal.edits && (proposal[fieldKey] !== undefined || (fieldKey === 'content' && proposal.content !== undefined))) {
        const truncErr = this._checkTruncationGuard(before, '로어북 본문 전체 덮어쓰기');
        if (truncErr) return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
      }

      const loaded = await this._loadLorebookForPreview(scope, proposal, snap.target);
      if (!loaded.ok) return { ok: false, error: loaded.error, before, label: snap.label, target: snap.target };

      const folderRes = resolveLorebookFolderProposal(loaded.list, proposal, snap.entry);
      if (!folderRes.ok) {
        return { ok: false, error: folderRes.error, before, label: snap.label, target: snap.target };
      }

      const resolvedInput = folderRes.resolvedFolder !== undefined
        ? { ...proposal, folder: folderRes.resolvedFolder }
        : proposal;
      const nextEntry = normalizeLorebookEntry(resolvedInput, snap.entry);
      if (proposal.edits) {
        try {
          nextEntry[fieldKey] = applyTextEdits(before, proposal.edits, '로어북');
        } catch (err) {
          return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
        }
      }
      const after = String(nextEntry[fieldKey] ?? '');
      const metaChanges = computeLoreMetaChanges(snap.entry, nextEntry, loaded.list, fieldKey);
      return {
        ok: true,
        before,
        after,
        metaChanges,
        label: snap.label,
        target: snap.target,
        hostBinding: snap.hostBinding || null,
      };
    }

    if (proposal.action === 'organize_lorebook') {
      const scope = proposal.scope || target.loreScope || (target.targetKind?.startsWith('module_') ? 'module' : target.targetKind === 'chat_lorebook' ? 'chat' : 'character');
      const loaded = await this._loadLorebookForPreview(scope, proposal, target);
      if (!loaded.ok) {
        return { ok: false, error: loaded.error, label: loaded.label, target: loaded.target };
      }
      const plan = planOrganizeLorebook(loaded.list, proposal);
      if (!plan.ok) {
        return { ok: false, error: plan.error, label: loaded.scopeLabel, target: loaded.target };
      }
      const defaultTitle = plan.isRoot
        ? `${loaded.scopeLabel} · ${plan.movableIndices.length}개 항목 최상위로 이동`
        : plan.willCreateFolder
          ? `${loaded.scopeLabel} · "${plan.newFolderName}" 폴더 생성 및 ${plan.movableIndices.length}개 이동`
          : `${loaded.scopeLabel} · "${plan.folderLabel}" 폴더로 ${plan.movableIndices.length}개 이동`;
      return {
        ok: true,
        before: plan.before,
        after: plan.after,
        metaChanges: plan.metaChanges,
        warning: plan.warning,
        label: proposal.title || defaultTitle,
        target: loaded.target,
        hostBinding: loaded.hostBinding || null,
      };
    }

    if (proposal.action === 'update_persona') {
      const fieldKey = proposal.fieldKey || 'personaPrompt';
      const fieldErr = validateAllowedFieldKey('persona', fieldKey);
      if (fieldErr) return { ok: false, error: fieldErr };
      const snap = await this.readTargetSnapshot({
        targetKind: 'persona',
        personaIndex: proposal.personaIndex ?? target.personaIndex,
        fieldKey,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      if (snap.moduleUncertain) return { ok: false, error: MODULE_UNCERTAIN_ERROR, label: snap.label, target: snap.target };
      if (!snap.entry) return { ok: false, error: '수정할 페르소나를 찾을 수 없습니다.' };

      const before = String(snap.entry[fieldKey] ?? '');
      if (!proposal.edits && !proposal.fieldEdits && proposal[fieldKey] !== undefined) {
        const truncErr = this._checkTruncationGuard(before, '페르소나 전체 덮어쓰기');
        if (truncErr) return { ok: false, error: truncErr, before, label: snap.label, target: snap.target };
      }

      const nextEntry = clone(snap.entry);
      if (proposal.name !== undefined) nextEntry.name = String(proposal.name);
      if (proposal.note !== undefined) nextEntry.note = String(proposal.note);
      if (proposal.largePortrait !== undefined) nextEntry.largePortrait = Boolean(proposal.largePortrait);
      if (proposal.edits) {
        try {
          nextEntry.personaPrompt = applyTextEdits(String(snap.entry.personaPrompt ?? ''), proposal.edits, '페르소나 프롬프트');
        } catch (err) {
          return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
        }
      } else if (proposal.fieldEdits && proposal.fieldKey) {
        try {
          nextEntry[proposal.fieldKey] = applyTextEdits(String(snap.entry[proposal.fieldKey] ?? ''), proposal.fieldEdits, `페르소나 ${proposal.fieldKey}`);
        } catch (err) {
          return { ok: false, error: err.message, before, label: snap.label, target: snap.target };
        }
      } else if (proposal.personaPrompt !== undefined) {
        nextEntry.personaPrompt = String(proposal.personaPrompt);
      }

      const after = String(nextEntry[fieldKey] ?? '');
      const metaChanges = computeMetaChanges(snap.entry, nextEntry, PERSONA_META_SPECS, fieldKey);
      const flavor = this.detectHostFlavor();
      const isSelected = snap.target.personaIndex === snap.selectedPersona;
      const warning = isSelected && !flavor.activePersonaAutoSyncs && !proposal.bindToCurrentChat
        ? '원본 RisuAI/PocketRisu/RisuBard에서는 현재 선택된 전역 페르소나 UI가 즉시 갱신되지 않을 수 있습니다. "현재 채팅에 바인딩"을 체크하면 즉시 반영됩니다.'
        : null;
      return {
        ok: true,
        before,
        after,
        metaChanges,
        label: snap.label,
        target: snap.target,
        hostBinding: snap.hostBinding || null,
        warning,
      };
    }

    if (proposal.action === 'upsert_regex') {
      const scope = proposal.scope || (target.targetKind === 'module_regex' ? 'module' : 'character');
      const targetKind = scope === 'module' ? 'module_regex' : 'char_regex';
      const idx = Number.isInteger(proposal.regexIndex) ? proposal.regexIndex : null;
      const snap = await this.readTargetSnapshot({
        targetKind,
        regexIndex: idx,
        moduleIndex: proposal.moduleIndex ?? target.moduleIndex,
        moduleDomHints: proposal.moduleIndex === undefined ? target.moduleDomHints : undefined,
      });
      if (!snap.ok) return { ok: false, error: snap.reason };
      if (snap.moduleUncertain) return { ok: false, error: MODULE_UNCERTAIN_ERROR, label: snap.label, target: snap.target };
      const existing = idx !== null ? snap.entry : null;
      const nextEntry = normalizeRegexEntry(proposal, existing);
      const metaChanges = existing
        ? computeMetaChanges(existing, nextEntry, REGEX_META_SPECS)
        : REGEX_META_SPECS.map(([key, label]) => ({
            key,
            label,
            before: '(신규)',
            after: formatMetaValue(nextEntry[key]),
          }));
      return {
        ok: true,
        before: existing ? String(existing.out ?? '') : '',
        after: String(nextEntry.out ?? ''),
        metaChanges,
        label: existing ? `${snap.label} 수정` : (proposal.title || `새 정규식 (${nextEntry.comment})`),
        target: snap.target,
        hostBinding: snap.hostBinding || null,
      };
    }

    if (proposal.action === 'create_lorebook') {
      const scope = proposal.scope || target.loreScope || (target.targetKind?.startsWith('module_') ? 'module' : target.targetKind === 'chat_lorebook' ? 'chat' : 'character');
      const loaded = await this._loadLorebookForPreview(scope, proposal, target);
      if (!loaded.ok) {
        return { ok: false, error: loaded.error, label: loaded.label, target: loaded.target };
      }
      const folderRes = resolveLorebookFolderProposal(loaded.list, proposal, null);
      if (!folderRes.ok) {
        return { ok: false, error: folderRes.error, label: loaded.scopeLabel, target: loaded.target };
      }
      const resolvedInput = folderRes.resolvedFolder !== undefined
        ? { ...proposal, folder: folderRes.resolvedFolder }
        : proposal;
      const nextEntry = normalizeLorebookEntry(resolvedInput);
      const folderNameMap = buildFolderNameMap(loaded.list);
      const metaChanges = LORE_META_SPECS
        .filter(([k]) => {
          if (nextEntry.mode === 'folder' && k === 'key') return false;
          return nextEntry[k] !== undefined && nextEntry[k] !== '' && nextEntry[k] !== false;
        })
        .map(([key, label]) => ({
          key,
          label,
          before: '(신규)',
          after: key === 'folder' ? formatFolderDisplay(nextEntry[key], folderNameMap) : formatMetaValue(nextEntry[key]),
        }));
      const defaultLabel = nextEntry.mode === 'folder'
        ? `새 로어북 폴더 (${nextEntry.comment})`
        : `새 로어북 (${nextEntry.comment})`;
      return {
        ok: true,
        before: '',
        after: String(nextEntry.content ?? ''),
        metaChanges,
        label: proposal.title || defaultLabel,
        target: loaded.target,
        hostBinding: loaded.hostBinding || null,
      };
    }

    if (proposal.action === 'create_persona') {
      const metaChanges = [
        { key: 'name', label: '이름', before: '(신규)', after: formatMetaValue(proposal.name || 'New Persona') },
      ];
      if (proposal.note) metaChanges.push({ key: 'note', label: '메모', before: '(신규)', after: formatMetaValue(proposal.note) });
      if (proposal.largePortrait) metaChanges.push({ key: 'largePortrait', label: '큰 초상화', before: '(신규)', after: '예' });
      return {
        ok: true,
        before: '',
        after: String(proposal.personaPrompt ?? proposal.content ?? ''),
        metaChanges,
        label: proposal.title || `새 페르소나 (${proposal.name || 'New Persona'})`,
        target,
        hostBinding: null,
      };
    }

    if (proposal.action === 'update_greeting') {
      const gTarget = this._greetingTarget(proposal);
      const snap = await this.readTargetSnapshot(gTarget);
      if (!snap.ok) return { ok: false, error: snap.reason };
      const before = String(snap.content ?? '');
      const guardError = this._greetingOverwriteError(proposal, target, before);
      if (guardError) return { ok: false, error: guardError, before, label: snap.label };
      try {
        const after = Array.isArray(proposal.edits) && proposal.edits.length > 0
          ? applyTextEdits(before, proposal.edits, snap.label)
          : String(proposal.content ?? '');
        return {
          ok: true,
          before,
          after,
          label: snap.label,
          target: { ...snap.target, greetingsShownFull: target.greetingsShownFull },
          hostBinding: snap.hostBinding,
          warning: proposal.greetingIndex === -1
            ? '기본 첫 메시지는 이 캐릭터의 모든 채팅에 공통으로 적용됩니다.'
            : null,
        };
      } catch (err) {
        return { ok: false, error: err.message, before, label: snap.label };
      }
    }

    if (proposal.action === 'create_greeting') {
      const { char, charIndex } = await this.readActiveCharacter();
      if (!char) return { ok: false, error: '선택된 캐릭터가 없습니다.' };
      const count = Array.isArray(char.alternateGreetings) ? char.alternateGreetings.length : 0;
      return {
        ok: true,
        before: '',
        after: String(proposal.content ?? ''),
        label: `캐릭터 · 추가 첫 메시지 #${count + 1} (새로 추가 · ${char.name || '무제'})`,
        target: { targetKind: 'char_alt_greeting', fieldKey: 'alternateGreetings' },
        hostBinding: { charIndex, ...getCharIdentity(char) },
      };
    }

    if (proposal.action === 'update_config') {
      const cfg = await this.readAllowedConfig();
      if (!cfg) return { ok: false, error: DB_PERMISSION_ERROR };
      const changes = proposal.changes || {};
      const invalidKeys = Object.keys(changes).filter(k => !ALLOWED_CONFIG_KEYS.includes(k));
      if (invalidKeys.length > 0) {
        return { ok: false, error: `허용되지 않는 설정 키입니다: ${invalidKeys.join(', ')}` };
      }
      const beforeObj = {};
      const afterObj = {};
      for (const [k, v] of Object.entries(changes)) {
        beforeObj[k] = cfg[k];
        afterObj[k] = v;
      }
      return {
        ok: true,
        before: JSON.stringify(beforeObj, null, 2),
        after: JSON.stringify(afterObj, null, 2),
        label: `설정 변경 (${Object.keys(changes).join(', ')})`,
        target,
        hostBinding: null,
      };
    }

    return { ok: false, error: `지원하지 않는 작업 종류입니다: ${proposal.action}` };
  }

  /**
   * Applies a validated proposal to RisuAI using the pinned target and pushes a surgical Undo record.
   */
  async applyProposal(proposal, activeTarget, options = {}) {
    const target = this._resolveSafeTarget(proposal, activeTarget);
    const referenceError = await this._findReferenceError(proposal, target, options);
    if (referenceError) throw new Error(referenceError);

    switch (proposal.action) {
      case 'patch_text':
      case 'replace_text':
        return await this._applyTextTarget(proposal, target, options);
      case 'create_lorebook':
        return await this._applyCreateLorebook(proposal, target, options);
      case 'update_lorebook':
        return await this._applyUpdateLorebook(proposal, target, options);
      case 'organize_lorebook':
        return await this._applyOrganizeLorebook(proposal, target, options);
      case 'update_lua':
        return await this._applyUpdateLua(proposal, target, options);
      case 'upsert_regex':
        return await this._applyUpsertRegex(proposal, target, options);
      case 'create_persona':
        return await this._applyCreatePersona(proposal, options);
      case 'update_persona':
        return await this._applyUpdatePersona(proposal, target, options);
      case 'update_config':
        return await this._applyUpdateConfig(proposal);
      case 'update_greeting':
        return await this._applyUpdateGreeting(proposal, target, options);
      case 'create_greeting':
        return await this._applyCreateGreeting(proposal, target, options);
      default:
        throw new Error(`지원하지 않는 작업 종류입니다: ${proposal.action}`);
    }
  }

  async _applyTextTarget(proposal, target, options = {}) {
    const kind = target.targetKind;
    const editsOf = () => (proposal.action === 'patch_text' ? proposal.edits : undefined);
    const fullTextOf = () => (proposal.action === 'replace_text' ? proposal.content : undefined);

    // --- kinds handled by a dedicated operation ---
    if (kind === 'char_lua' || kind === 'module_lua') {
      return await this._applyUpdateLua({
        scope: kind === 'module_lua' ? 'module' : 'character',
        moduleIndex: target.moduleIndex,
        edits: editsOf(),
        code: fullTextOf(),
      }, target, options);
    }
    if (kind === 'persona') {
      const fieldKey = target.fieldKey || 'personaPrompt';
      assertAllowedFieldKey('persona', fieldKey);
      return await this._applyUpdatePersona({
        personaIndex: target.personaIndex,
        [fieldKey]: fullTextOf(),
        edits: fieldKey === 'personaPrompt' ? editsOf() : undefined,
        fieldKey,
        fieldEdits: editsOf(),
      }, target, options);
    }
    if (kind === 'module_lorebook') {
      const fieldKey = target.fieldKey || 'content';
      assertAllowedFieldKey('module_lorebook', fieldKey);
      return await this._applyUpdateLorebook({
        scope: 'module',
        moduleIndex: target.moduleIndex,
        loreIndex: target.loreIndex,
        fieldKey,
        edits: editsOf(),
        [fieldKey]: fullTextOf(),
      }, target, options);
    }

    const compute = (before, label) => {
      if (proposal.action === 'replace_text') {
        const truncErr = this._checkTruncationGuard(before, '전체 덮어쓰기(replace_text)');
        if (truncErr) throw new Error(truncErr);
        return String(proposal.content ?? '');
      }
      return applyTextEdits(before, proposal.edits, label);
    };

    if (kind === 'config' && target.fieldKey && ALLOWED_CONFIG_KEYS.includes(target.fieldKey)) {
      const cfg = await this.readAllowedConfig();
      if (!cfg) throw new Error(DB_PERMISSION_ERROR);
      const nextVal = compute(String(cfg[target.fieldKey] ?? ''), target.fieldKey);
      return await this._applyUpdateConfig({ changes: { [target.fieldKey]: nextVal } });
    }

    // --- kinds that rewrite exactly one text slot of the character, the chat or a module ---
    // `locate(root)` returns where the text lives on the cloned entity: { holder, key, label,
    // summary, numeric?, after? }. Reading, writing and undo are shared by every kind.
    const writeSlot = async (scope, locate) => {
      const opened = await this._openScope(scope, proposal, target, options);
      const slot = locate(opened.root, opened);
      const nextStr = compute(String(slot.holder[slot.key] ?? ''), slot.label);
      if (slot.numeric) {
        const num = Number(nextStr.trim());
        if (!Number.isFinite(num)) throw new Error('배치 순서(insertorder)는 유한한 숫자여야 합니다.');
        slot.holder[slot.key] = num;
      } else {
        slot.holder[slot.key] = nextStr;
      }
      if (slot.after) slot.after(nextStr);
      const undoId = await opened.commit(`${slot.label} 수정`);
      return { ok: true, undoId, summary: slot.summary };
    };

    const loreSlot = (scopeName, listKey) => (root) => {
      const fieldKey = target.fieldKey || 'content';
      const idx = target.loreIndex;
      if (!Number.isInteger(idx) || !root[listKey]?.[idx]) {
        throw new Error(`수정할 ${scopeName} 로어북 인덱스가 올바르지 않습니다.`);
      }
      return {
        holder: root[listKey][idx],
        key: fieldKey,
        numeric: fieldKey === 'insertorder',
        label: `${scopeName} 로어북 #${idx + 1}`,
        summary: `${scopeName} 로어북 #${idx + 1}의 ${fieldKey}을(를) 수정했습니다.`,
      };
    };

    if (kind === 'char_field') {
      const fieldKey = target.fieldKey || 'desc';
      assertAllowedFieldKey('char_field', fieldKey);
      if (fieldKey === 'depthPrompt') {
        return await writeSlot('character', (root) => {
          const depth = Number.isFinite(Number(root.depth_prompt?.depth)) ? Number(root.depth_prompt.depth) : 0;
          root.depth_prompt = { ...(root.depth_prompt || {}), depth };
          return { holder: root.depth_prompt, key: 'prompt', label: '캐릭터 깊이 프롬프트', summary: '캐릭터 깊이 프롬프트에 적용했습니다.' };
        });
      }
      return await writeSlot('character', (root) => ({
        holder: root,
        key: fieldKey,
        label: `캐릭터 ${fieldKey}`,
        summary: `캐릭터 ${CHAR_FIELD_META[fieldKey]?.label || fieldKey}에 적용했습니다.`,
      }));
    }

    if (kind === 'char_alt_greeting') {
      return await writeSlot('character', (root) => {
        const idx = target.greetingIndex;
        if (!Array.isArray(root.alternateGreetings) || !Number.isInteger(idx) || idx < 0 || idx >= root.alternateGreetings.length) {
          throw new Error('수정할 추가 첫 메시지 인덱스가 올바르지 않습니다.');
        }
        return {
          holder: root.alternateGreetings,
          key: idx,
          label: `추가 첫 메시지 #${idx + 1}`,
          summary: `캐릭터 추가 첫 메시지 #${idx + 1}에 적용했습니다.`,
        };
      });
    }

    if (kind === 'chat_note') {
      assertAllowedFieldKey('chat_note', target.fieldKey || 'note');
      return await writeSlot('chat', (root) => ({
        holder: root, key: 'note', label: '작가의 노트', summary: '현재 채팅의 작가의 노트에 적용했습니다.',
      }));
    }

    if (kind === 'chat_message') {
      return await writeSlot('chat', (root) => {
        const idx = target.messageIndex;
        const message = Number.isInteger(idx) && idx >= 0 ? root.message?.[idx] : null;
        if (!message) throw new Error('수정할 채팅 메시지 인덱스가 올바르지 않습니다.');
        const pinnedChatId = options.hostBinding?.chatId || null;
        if (pinnedChatId && message.chatId && message.chatId !== pinnedChatId) {
          throw new Error('대상 채팅 메시지가 변경되어 적용을 중단했습니다. 다시 제안받아 주세요.');
        }
        const hasSwipe = Array.isArray(message.swipes) && Number.isInteger(message.swipeId);
        return {
          holder: message,
          key: 'data',
          label: `채팅 메시지 #${idx + 1}`,
          summary: `채팅 메시지 #${idx + 1}에 적용했습니다.`,
          after: (text) => { if (hasSwipe) message.swipes[message.swipeId] = text; },
        };
      });
    }

    if (kind === 'char_lorebook') {
      assertAllowedFieldKey('char_lorebook', target.fieldKey || 'content');
      return await writeSlot('character', loreSlot('캐릭터', 'globalLore'));
    }

    if (kind === 'chat_lorebook') {
      assertAllowedFieldKey('chat_lorebook', target.fieldKey || 'content');
      return await writeSlot('chat', loreSlot('채팅', 'localLore'));
    }

    if (kind === 'module_field') {
      const fieldKey = target.fieldKey || 'backgroundEmbedding';
      assertAllowedFieldKey('module_field', fieldKey);
      return await writeSlot('module', (root) => ({
        holder: root,
        key: fieldKey,
        label: `모듈 "${root.name || '무제'}" ${fieldKey}`,
        summary: `${MODULE_FIELD_META[fieldKey]?.label || `모듈 ${fieldKey}`} (${root.name || '무제'})에 적용했습니다.`,
      }));
    }

    throw new Error(`현재 대상(${kind || '없음'})에는 직접 텍스트 적용을 지원하지 않습니다. 상단에서 대상을 선택해 주세요.`);
  }

  /** Where a greeting lives: index -1 is the default first message, n >= 0 an alternate greeting. */
  _greetingTarget(proposal) {
    return proposal.greetingIndex === -1
      ? { targetKind: 'char_field', fieldKey: 'firstMessage' }
      : { targetKind: 'char_alt_greeting', fieldKey: 'alternateGreetings', greetingIndex: proposal.greetingIndex };
  }

  /**
   * A whole-text replacement is only safe when the model was shown the whole greeting.
   * `target.greetingsShownFull` lists the greeting indices that were sent in full for this
   * request (src/greetings.js); partial edits are exact-match and therefore always safe.
   */
  _greetingOverwriteError(proposal, target, before) {
    const isOverwrite = !(Array.isArray(proposal.edits) && proposal.edits.length > 0);
    if (!isOverwrite || before.length === 0) return null;
    const shown = Array.isArray(target?.greetingsShownFull) ? target.greetingsShownFull : [];
    if (!shown.includes(proposal.greetingIndex)) {
      return '이 첫 메시지는 전문이 모델에 전달되지 않은 상태(앞부분 미리보기만 전달)라, 뒷부분 유실을 막기 위해 전체 덮어쓰기를 차단했습니다. ' +
        '보이는 구간의 부분 편집(edits)을 쓰거나, 상단 대상을 해당 첫 메시지로 고른 뒤 다시 요청해 주세요.';
    }
    return this._checkTruncationGuard(before, '첫 메시지 전체 덮어쓰기');
  }

  async _applyUpdateGreeting(proposal, target, options = {}) {
    const gTarget = this._greetingTarget(proposal);
    const snap = await this.readTargetSnapshot(gTarget);
    if (!snap.ok) throw new Error(snap.reason);
    const guardError = this._greetingOverwriteError(proposal, target, String(snap.content ?? ''));
    if (guardError) throw new Error(guardError);
    const hasEdits = Array.isArray(proposal.edits) && proposal.edits.length > 0;
    return await this._applyTextTarget(
      hasEdits ? { action: 'patch_text', edits: proposal.edits } : { action: 'replace_text', content: proposal.content },
      gTarget,
      options
    );
  }

  async _applyCreateGreeting(proposal, target, options = {}) {
    const opened = await this._openScope('character', proposal, target, options);
    if (!Array.isArray(opened.root.alternateGreetings)) opened.root.alternateGreetings = [];
    opened.root.alternateGreetings.push(String(proposal.content ?? ''));
    const number = opened.root.alternateGreetings.length;
    const undoId = await opened.commit(`추가 첫 메시지 #${number} 생성`);
    return {
      ok: true,
      undoId,
      greetingIndex: number - 1,
      summary: `추가 첫 메시지 #${number}을(를) 새로 만들었습니다. 채팅 화면의 첫 메시지 좌우 화살표로 전환할 수 있습니다.`,
    };
  }

  /**
   * Opens the entity a scoped operation works on — the active character, the active chat, or one
   * installed module — and returns a cloned `root` to mutate plus `commit(label)`, which writes
   * it and records the undo entry. One implementation serves all three scopes.
   */
  async _openScope(scope, proposal, target, options = {}, verb = '적용') {
    if (scope === 'chat') {
      const { chat, charIndex, chatIndex } = await this._requireSameActiveChat(options.hostBinding, verb);
      const next = clone(chat);
      return {
        scope: 'chat',
        name: '채팅',
        root: next,
        listKeys: { lore: 'localLore' },
        commit: (label) => this._commitChat(chat, charIndex, chatIndex, next, label),
      };
    }
    if (scope === 'module') {
      const { modules, permissionDenied } = await this.readModules();
      if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
      const modIdx = this._resolveWriteModuleIndex(modules, proposal, target, options);
      if (!modules[modIdx]) throw new Error('대상 모듈을 찾을 수 없습니다.');
      const nextModules = clone(modules);
      return {
        scope: 'module',
        name: `모듈 "${modules[modIdx].name}"`,
        root: nextModules[modIdx],
        listKeys: { lore: 'lorebook', regex: 'regex', trigger: 'trigger' },
        commit: (label) => this._commitDb({ modules }, { modules: nextModules }, label),
      };
    }
    const { char, charIndex } = await this._requireSameActiveCharacter(options.hostBinding, verb);
    const next = clone(char);
    return {
      scope: 'character',
      name: '캐릭터',
      root: next,
      listKeys: { lore: 'globalLore', regex: 'customscript', trigger: 'triggerscript' },
      commit: (label) => this._commitCharacter(char, charIndex, next, label),
    };
  }

  _checkTruncationGuard(beforeText, actionLabel) {
    return checkTruncationGuard(beforeText, actionLabel, this.maxContentChars);
  }

  _loreScopeOf(proposal, target) {
    return proposal?.scope || target?.loreScope ||
      (target?.targetKind?.startsWith('module_') ? 'module' : target?.targetKind === 'chat_lorebook' ? 'chat' : 'character');
  }

  /** Returns the scope's list for `kind` ('lore' | 'regex'), creating it on the clone if missing. */
  _scopeList(opened, kind) {
    const key = opened.listKeys[kind];
    if (!Array.isArray(opened.root[key])) opened.root[key] = [];
    return opened.root[key];
  }

  async _applyCreateLorebook(proposal, target, options = {}) {
    const opened = await this._openScope(this._loreScopeOf(proposal, target), proposal, target, options);
    const list = this._scopeList(opened, 'lore');

    const folderRes = resolveLorebookFolderProposal(list, proposal, null);
    if (!folderRes.ok) throw new Error(folderRes.error);
    const entry = normalizeLorebookEntry(
      folderRes.resolvedFolder !== undefined ? { ...proposal, folder: folderRes.resolvedFolder } : proposal
    );
    list.push(entry);

    const undoId = await opened.commit(`${opened.name} 로어북 생성 (${entry.comment})`);
    return { ok: true, undoId, summary: `${opened.name}에 새 로어북 "${entry.comment}"을(를) 추가했습니다.` };
  }

  async _applyUpdateLorebook(proposal, target, options = {}) {
    const loreIndex = Number.isInteger(proposal.loreIndex) ? proposal.loreIndex : target.loreIndex;
    if (!Number.isInteger(loreIndex) || loreIndex < 0) {
      throw new Error('수정할 로어북 인덱스(loreIndex)가 필요합니다.');
    }
    const fieldKey = proposal.fieldKey || 'content';
    assertAllowedFieldKey('char_lorebook', fieldKey);

    const opened = await this._openScope(this._loreScopeOf(proposal, target), proposal, target, options);
    const list = this._scopeList(opened, 'lore');
    const existing = list[loreIndex];
    if (!existing) throw new Error(`${opened.name} 로어북 #${loreIndex + 1}을(를) 찾을 수 없습니다.`);

    if (!proposal.edits && (proposal[fieldKey] !== undefined || (fieldKey === 'content' && proposal.content !== undefined))) {
      const truncErr = this._checkTruncationGuard(String(existing[fieldKey] ?? ''), '로어북 전체 덮어쓰기');
      if (truncErr) throw new Error(truncErr);
    }
    const folderRes = resolveLorebookFolderProposal(list, proposal, existing);
    if (!folderRes.ok) throw new Error(folderRes.error);
    const next = normalizeLorebookEntry(
      folderRes.resolvedFolder !== undefined ? { ...proposal, folder: folderRes.resolvedFolder } : proposal,
      existing
    );
    if (proposal.edits) {
      const nextStr = applyTextEdits(String(existing[fieldKey] ?? ''), proposal.edits, '로어북');
      if (fieldKey === 'insertorder') {
        const num = Number(nextStr.trim());
        if (!Number.isFinite(num)) throw new Error('배치 순서(insertorder)는 유한한 숫자여야 합니다.');
        next[fieldKey] = num;
      } else {
        next[fieldKey] = nextStr;
      }
    }
    list[loreIndex] = next;

    const undoId = await opened.commit(`${opened.name} 로어북 #${loreIndex + 1} 수정`);
    return { ok: true, undoId, summary: `${opened.name} 로어북 #${loreIndex + 1}을(를) 수정했습니다.` };
  }

  async _applyOrganizeLorebook(proposal, target, options = {}) {
    const opened = await this._openScope(this._loreScopeOf(proposal, target), proposal, target, options);
    const list = this._scopeList(opened, 'lore');

    const plan = planOrganizeLorebook(list, proposal);
    if (!plan.ok) throw new Error(plan.error);

    let createdFolder = null;
    let targetFolderKey = plan.folderKey;
    if (plan.willCreateFolder) {
      createdFolder = normalizeLorebookEntry({ mode: 'folder', comment: plan.newFolderName, key: '' });
      list.push(createdFolder);
      targetFolderKey = createdFolder.key;
    }
    for (const idx of plan.movableIndices) {
      if (plan.isRoot) delete list[idx].folder;
      else list[idx].folder = targetFolderKey;
    }

    const count = plan.movableIndices.length;
    const undoId = await opened.commit(`${opened.name} 로어북 폴더 정리 (${count}개)`);
    let summary;
    if (plan.isRoot) summary = `${opened.name} 로어북 ${count}개를 최상위 목록으로 이동했습니다.`;
    else if (createdFolder) summary = `${opened.name}에 새 폴더 "${createdFolder.comment}"을(를) 만들고 로어북 ${count}개를 이동했습니다.`;
    else summary = `${opened.name} 로어북 ${count}개를 "${plan.folderLabel}" 폴더로 이동했습니다.`;
    return { ok: true, undoId, folderKey: targetFolderKey, movedCount: count, createdFolder: Boolean(createdFolder), summary };
  }

  /**
   * Rescues orphaned lorebook entries whose `folder` property points to a nonexistent folder key
   * by clearing `entry.folder` (moving them back to root) in one write with a single undo entry.
   */
  async recoverOrphanedLorebooks(target = {}, options = {}) {
    const opened = await this._openScope(this._loreScopeOf({}, target), {}, target, options, '복구');
    const list = this._scopeList(opened, 'lore');
    const orphaned = findOrphanedLorebooks(list);
    if (orphaned.length === 0) {
      return { ok: true, recoveredCount: 0, undoId: null, summary: `복구할 숨겨진 ${opened.name} 로어북이 없습니다.` };
    }
    for (const idx of orphaned) delete list[idx].folder;
    const undoId = await opened.commit(`${opened.name} 숨겨진 로어북 ${orphaned.length}개 복구`);
    return {
      ok: true,
      recoveredCount: orphaned.length,
      undoId,
      summary: `${opened.name}의 숨겨진 로어북 ${orphaned.length}개를 최상위 목록으로 복구했습니다.`,
    };
  }

  async _applyUpdateLua(proposal, target, options = {}) {
    const scope = proposal.scope || (target.targetKind === 'module_lua' ? 'module' : 'character');
    const opened = await this._openScope(scope, proposal, target, options);
    const triggerKey = opened.listKeys.trigger;

    const luaInfo = extractLuaFromTriggers(opened.root[triggerKey]);
    if (luaInfo.hasOtherTriggers && options.requireDestructiveConfirm && !options.destructiveConfirmed) {
      throw new Error('기존 V1/V2 트리거 삭제 확인 체크가 필요합니다.');
    }
    if (!proposal.edits) {
      const truncErr = this._checkTruncationGuard(luaInfo.code, `${opened.name} Lua 전체 교체`);
      if (truncErr) throw new Error(truncErr);
    }
    const nextCode = proposal.edits
      ? applyTextEdits(luaInfo.code, proposal.edits, `${opened.name} Lua`)
      : String(proposal.code ?? proposal.content ?? '');
    opened.root[triggerKey] = buildLuaTriggers(nextCode);

    const ownerName = opened.scope === 'module' ? opened.name : `캐릭터 "${opened.root.name}"`;
    const undoId = await opened.commit(`${opened.name} Lua 수정`);
    return { ok: true, undoId, summary: `${ownerName} Lua 트리거 스크립트를 저장했습니다.` };
  }

  async _applyUpsertRegex(proposal, target, options = {}) {
    const scope = proposal.scope || (target.targetKind === 'module_regex' ? 'module' : 'character');
    const idx = Number.isInteger(proposal.regexIndex) ? proposal.regexIndex : null;
    const opened = await this._openScope(scope, proposal, target, options);
    const list = this._scopeList(opened, 'regex');

    const isUpdate = idx !== null && Boolean(list[idx]);
    if (isUpdate) list[idx] = normalizeRegexEntry(proposal, list[idx]);
    else list.push(normalizeRegexEntry(proposal));

    const undoId = await opened.commit(`${opened.name} 정규식 저장 (${proposal.comment || 'Regex'})`);
    return { ok: true, undoId, summary: `${opened.name} 정규식 "${proposal.comment || 'New Regex'}"을(를) 저장했습니다.` };
  }

  /**
   * Binds a persona to the active chat. The chat change is appended to the undo record `appendTo`
   * so persona + binding are undone together. Returns false when there is no active chat.
   */
  async _bindPersonaToActiveChat(personaId, appendTo) {
    const { chat, charIndex, chatIndex } = await this.readActiveChat();
    if (!chat) return false;
    const nextChat = clone(chat);
    nextChat.bindedPersona = personaId;
    await this._commitChat(chat, charIndex, chatIndex, nextChat, '', { appendTo });
    return true;
  }

  async _applyCreatePersona(proposal, options) {
    const { personas, permissionDenied } = await this.readPersonas();
    if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
    const nextPersonas = clone(personas);
    const newPersona = {
      name: String(proposal.name || 'New Persona'),
      personaPrompt: String(proposal.personaPrompt ?? proposal.content ?? ''),
      icon: String(proposal.icon || ''),
      note: String(proposal.note || ''),
      largePortrait: Boolean(proposal.largePortrait),
      id: makeUuid(),
    };
    nextPersonas.push(newPersona);
    const undoId = await this._commitDb({ personas }, { personas: nextPersonas }, `새 페르소나 생성 (${newPersona.name})`);

    let restoreChat = false;
    const shouldBind = Boolean(options.bindToCurrentChat ?? proposal.bindToCurrentChat);
    if (shouldBind) {
      restoreChat = await this._bindPersonaToActiveChat(newPersona.id, undoId);
    }

    return {
      ok: true,
      undoId,
      personaId: newPersona.id,
      summary: shouldBind && restoreChat
        ? `새 페르소나 "${newPersona.name}"을(를) 만들고 현재 채팅에 바인딩했습니다.`
        : `새 페르소나 "${newPersona.name}"을(를) 생성했습니다. 페르소나 설정에서 선택해 사용할 수 있습니다.`,
    };
  }

  async _applyUpdatePersona(proposal, target, options) {
    const { personas, selectedPersona, permissionDenied } = await this.readPersonas();
    if (permissionDenied) throw new Error(DB_PERMISSION_ERROR);
    const idx = Number.isInteger(proposal.personaIndex)
      ? proposal.personaIndex
      : (Number.isInteger(target.personaIndex) ? target.personaIndex : selectedPersona);
    if (!personas[idx]) throw new Error(`페르소나 #${idx + 1}을(를) 찾을 수 없습니다.`);

    if (proposal.fieldKey !== undefined) {
      assertAllowedFieldKey('persona', proposal.fieldKey);
    }

    const nextPersonas = clone(personas);
    const cur = nextPersonas[idx];
    if (!cur.id) cur.id = makeUuid();

    if (!proposal.edits && !proposal.fieldEdits) {
      const checkKey = proposal.fieldKey || 'personaPrompt';
      if (proposal[checkKey] !== undefined) {
        const truncErr = this._checkTruncationGuard(String(cur[checkKey] ?? ''), '페르소나 전체 덮어쓰기');
        if (truncErr) throw new Error(truncErr);
      }
    }

    if (proposal.name !== undefined) cur.name = String(proposal.name);
    if (proposal.note !== undefined) cur.note = String(proposal.note);
    if (proposal.largePortrait !== undefined) cur.largePortrait = Boolean(proposal.largePortrait);
    if (proposal.edits) {
      cur.personaPrompt = applyTextEdits(String(cur.personaPrompt ?? ''), proposal.edits, '페르소나 프롬프트');
    } else if (proposal.fieldEdits && proposal.fieldKey) {
      cur[proposal.fieldKey] = applyTextEdits(String(cur[proposal.fieldKey] ?? ''), proposal.fieldEdits, `페르소나 ${proposal.fieldKey}`);
    } else if (proposal.personaPrompt !== undefined) {
      cur.personaPrompt = String(proposal.personaPrompt);
    }

    const undoId = await this._commitDb({ personas }, { personas: nextPersonas }, `페르소나 수정 (${cur.name})`);

    let restoreChat = false;
    const shouldBind = Boolean(options.bindToCurrentChat ?? proposal.bindToCurrentChat);
    if (shouldBind) {
      restoreChat = await this._bindPersonaToActiveChat(cur.id, undoId);
    }

    return {
      ok: true,
      undoId,
      summary: shouldBind && restoreChat
        ? `페르소나 "${cur.name}"을(를) 수정하고 현재 채팅에 바인딩했습니다.`
        : `페르소나 "${cur.name}"을(를) 수정했습니다.`,
    };
  }

  async _applyUpdateConfig(proposal) {
    const changes = proposal.changes || {};
    const keys = Object.keys(changes);
    if (keys.length === 0) throw new Error('변경할 설정 항목이 없습니다.');

    const cfg = await this.readAllowedConfig();
    if (!cfg) throw new Error(DB_PERMISSION_ERROR);

    const prev = {};
    const next = {};
    for (const k of keys) {
      if (!ALLOWED_CONFIG_KEYS.includes(k)) {
        throw new Error(`허용되지 않는 설정 키입니다: ${k}`);
      }
      const expectedType = CONFIG_KEY_TYPES[k];
      const val = changes[k];
      if (expectedType === 'array') {
        if (!Array.isArray(val)) throw new Error(`${k}는 배열이어야 합니다.`);
      } else if (expectedType === 'number') {
        if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error(`${k}는 유한한 숫자여야 합니다.`);
      } else if (expectedType === 'boolean') {
        if (typeof val !== 'boolean') throw new Error(`${k}는 boolean이어야 합니다.`);
      } else if (expectedType === 'string') {
        if (typeof val !== 'string') throw new Error(`${k}는 문자열이어야 합니다.`);
      } else if (expectedType === 'object') {
        if (!val || typeof val !== 'object' || Array.isArray(val)) throw new Error(`${k}는 객체여야 합니다.`);
      }
      prev[k] = clone(cfg[k]);
      next[k] = val;
    }

    const undoId = await this._commitDb(prev, next, `설정 변경 (${keys.join(', ')})`);
    return { ok: true, undoId, summary: `설정(${keys.join(', ')})을 적용했습니다.` };
  }
}

export {
  LORE_FOLDER_PREFIX,
  canonicalizeFolderKey,
  resolveFolderRef,
  findOrphanedLorebooks,
  summarizeLoreList,
  extractLuaFromTriggers,
  buildLuaTriggers,
  normalizeLorebookEntry,
  normalizeRegexEntry,
  resolveModuleIndex,
  HostAdapter,
};
