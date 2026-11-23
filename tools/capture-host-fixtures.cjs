#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
//
// Records real RisuAI / fork DOM snapshots for tests/host-fixtures.test.mjs.
//
// This is a maintainer tool, NOT part of `npm test`. It needs:
//   - a host checkout running its Vite dev server (so /src/ts/*.ts modules are importable), e.g.
//       kwaroran/Risuai:  VITE_RISU_LEGAL_CONFIGURED=TRUE pnpm exec vite --port 5174
//       PocketRisu:       node server/node/server.cjs  +  vite dev proxied to it
//   - Playwright with Chromium (`require('playwright')`)
//
// Usage:
//   node tools/capture-host-fixtures.cjs --url http://127.0.0.1:5174/ --host upstream --lang ko
//
// Every seeded field carries a unique value token, so the expected target of each focused
// field is derived from the value the host itself bound into that field (ground truth),
// never from the label text the detector under test reads.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL = arg('url', 'http://127.0.0.1:5174/');
const HOST = arg('host', 'upstream');
const LANG = arg('lang', 'ko');
const OUT_DIR = path.resolve(__dirname, '..', 'tests', 'fixtures', 'host-dom');
const PASSWORD = arg('password', 'test1234');

// value token -> expected detection target
const EXPECT_BY_VALUE = {
  'TestChar': { targetKind: 'char_field', fieldKey: 'name' },
  'DESC-ORIGINAL': { targetKind: 'char_field', fieldKey: 'desc' },
  'FIRST-ORIGINAL': { targetKind: 'char_field', fieldKey: 'firstMessage' },
  'NOTE-ORIGINAL': { targetKind: 'chat_note', fieldKey: 'note' },
  'EXAMPLE-ORIGINAL': { targetKind: 'char_field', fieldKey: 'exampleMessage' },
  'CNOTES-ORIGINAL': { targetKind: 'char_field', fieldKey: 'creatorNotes' },
  'SYS-ORIGINAL': { targetKind: 'char_field', fieldKey: 'systemPrompt' },
  'RGN-ORIGINAL': { targetKind: 'char_field', fieldKey: 'replaceGlobalNote' },
  'ADDTEXT-ORIGINAL': { targetKind: 'char_field', fieldKey: 'additionalText' },
  'PERS-ORIGINAL': { targetKind: 'char_field', fieldKey: 'personality' },
  'SCEN-ORIGINAL': { targetKind: 'char_field', fieldKey: 'scenario' },
  'DEFVARS-ORIGINAL': { targetKind: 'char_field', fieldKey: 'defaultVariables' },
  'TRNOTE-ORIGINAL': { targetKind: 'char_field', fieldKey: 'translatorNote' },
  'CTOGGLE-ORIGINAL': { targetKind: 'char_field', fieldKey: 'customModuleToggle' },
  'NICK-ORIGINAL': { targetKind: 'char_field', fieldKey: 'nickname' },
  'DEPTHP-ORIGINAL': { targetKind: 'char_field', fieldKey: 'depthPrompt' },
  'BGHTML-ORIGINAL': { targetKind: 'char_field', fieldKey: 'backgroundHTML' },
  'LUA-ORIGINAL': { targetKind: 'char_lua', fieldKey: 'code' },
  // Bound to character data RisuHelper cannot edit: must never resolve to a writable target.
  'CREATOR-ORIGINAL': { writable: false },
  'CHARVER-ORIGINAL': { writable: false },
  'Lore One': { targetKind: 'char_lorebook', fieldKey: 'comment', loreIndex: 0 },
  'lore-one-key': { targetKind: 'char_lorebook', fieldKey: 'key', loreIndex: 0 },
  'lore one body': { targetKind: 'char_lorebook', fieldKey: 'content', loreIndex: 0 },
  '101': { targetKind: 'char_lorebook', fieldKey: 'insertorder', loreIndex: 0 },
  'Lore Two': { targetKind: 'char_lorebook', fieldKey: 'comment', loreIndex: 1 },
  'lore-two-key': { targetKind: 'char_lorebook', fieldKey: 'key', loreIndex: 1 },
  'lore two body': { targetKind: 'char_lorebook', fieldKey: 'content', loreIndex: 1 },
  '102': { targetKind: 'char_lorebook', fieldKey: 'insertorder', loreIndex: 1 },
  'ChatLore': { targetKind: 'chat_lorebook', fieldKey: 'comment', loreIndex: 0 },
  'chat-lore-key': { targetKind: 'chat_lorebook', fieldKey: 'key', loreIndex: 0 },
  'chat lore body': { targetKind: 'chat_lorebook', fieldKey: 'content', loreIndex: 0 },
  '103': { targetKind: 'chat_lorebook', fieldKey: 'insertorder', loreIndex: 0 },
  'Rx One': { targetKind: 'char_regex', fieldKey: 'comment', regexIndex: 0 },
  'rx-in-original': { targetKind: 'char_regex', fieldKey: 'in', regexIndex: 0 },
  'rx-out-original': { targetKind: 'char_regex', fieldKey: 'out', regexIndex: 0 },
  'PersonaA': { targetKind: 'persona', fieldKey: 'name' },
  'PA-NOTE': { targetKind: 'persona', fieldKey: 'note' },
  'PA-PROMPT': { targetKind: 'persona', fieldKey: 'personaPrompt' },
  'ModOne': { targetKind: 'module_field', fieldKey: 'name' },
  'MOD-DESC': { targetKind: 'module_field', fieldKey: 'description' },
  'mod-namespace': { targetKind: 'module_field', fieldKey: 'namespace' },
  'MOD-TOGGLE': { targetKind: 'module_field', fieldKey: 'customModuleToggle' },
  'MOD-BGEMBED': { targetKind: 'module_field', fieldKey: 'backgroundEmbedding' },
  'ModLore': { targetKind: 'module_lorebook', fieldKey: 'comment', loreIndex: 0 },
  'mod-lore-key': { targetKind: 'module_lorebook', fieldKey: 'key', loreIndex: 0 },
  'mod lore body': { targetKind: 'module_lorebook', fieldKey: 'content', loreIndex: 0 },
  '104': { targetKind: 'module_lorebook', fieldKey: 'insertorder', loreIndex: 0 },
  'ModRx': { targetKind: 'module_regex', fieldKey: 'comment', regexIndex: 0 },
  'mod-rx-in': { targetKind: 'module_regex', fieldKey: 'in', regexIndex: 0 },
  'mod-rx-out': { targetKind: 'module_regex', fieldKey: 'out', regexIndex: 0 },
  'CSS-ORIGINAL': { targetKind: 'config', fieldKey: 'customCSS' },
};

async function seed(page, lang) {
  await page.evaluate(async (lang) => {
    const stores = await import('/src/ts/stores.svelte.ts');
    const chars = await import('/src/ts/characters.ts');
    const langMod = await import('/src/lang/index.ts');
    const db = stores.DBState.db;
    db.didFirstSetup = true;
    db.language = lang;
    langMod.changeLanguage(lang);
    const lore = (comment, key, content, insertorder) => ({
      key, secondkey: '', insertorder, comment, content, mode: 'normal', alwaysActive: false, selective: false,
    });
    const c = chars.createBlankChar();
    Object.assign(c, {
      name: 'TestChar', desc: 'DESC-ORIGINAL', firstMessage: 'FIRST-ORIGINAL', exampleMessage: 'EXAMPLE-ORIGINAL',
      creatorNotes: 'CNOTES-ORIGINAL', systemPrompt: 'SYS-ORIGINAL', replaceGlobalNote: 'RGN-ORIGINAL',
      additionalText: 'ADDTEXT-ORIGINAL', personality: 'PERS-ORIGINAL', scenario: 'SCEN-ORIGINAL',
      defaultVariables: 'DEFVARS-ORIGINAL', translatorNote: 'TRNOTE-ORIGINAL', customModuleToggle: 'CTOGGLE-ORIGINAL',
      nickname: 'NICK-ORIGINAL', backgroundHTML: 'BGHTML-ORIGINAL',
      additionalData: { tag: [], creator: 'CREATOR-ORIGINAL', character_version: 'CHARVER-ORIGINAL' },
      depth_prompt: { depth: 0, prompt: 'DEPTHP-ORIGINAL' },
      globalLore: [lore('Lore One', 'lore-one-key', 'lore one body', 101), lore('Lore Two', 'lore-two-key', 'lore two body', 102)],
      customscript: [{ comment: 'Rx One', in: 'rx-in-original', out: 'rx-out-original', type: 'editdisplay', flag: 'g', ableFlag: false }],
      triggerscript: [{ comment: '', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: 'LUA-ORIGINAL' }] }],
    });
    c.chats[0].note = 'NOTE-ORIGINAL';
    c.chats[0].localLore = [lore('ChatLore', 'chat-lore-key', 'chat lore body', 103)];
    db.characters.push(c);
    chars.characterFormatUpdate(db.characters.length - 1);
    db.username = 'PersonaA'; db.userNote = 'PA-NOTE'; db.personaPrompt = 'PA-PROMPT';
    db.personas = [{ name: 'PersonaA', personaPrompt: 'PA-PROMPT', icon: '', note: 'PA-NOTE', id: 'pa' }];
    db.selectedPersona = 0;
    db.customCSS = 'CSS-ORIGINAL';
    db.modules = [{
      name: 'ModOne', description: 'MOD-DESC', id: 'mod-one', namespace: 'mod-namespace',
      customModuleToggle: 'MOD-TOGGLE', backgroundEmbedding: 'MOD-BGEMBED',
      lorebook: [lore('ModLore', 'mod-lore-key', 'mod lore body', 104)],
      regex: [{ comment: 'ModRx', in: 'mod-rx-in', out: 'mod-rx-out', type: 'editdisplay', flag: 'g', ableFlag: false }],
      trigger: [],
    }];
    window.__rhStores = stores;
    stores.selectedCharID.set(db.characters.length - 1);
  }, lang);
  await page.waitForTimeout(2500);
}

// Runs in the page: serialises the live DOM into a compact tree and lists every visible
// editable element together with the value the host bound into it.
function snapshotInPage() {
  const KEEP_ATTR = /^(class|id|placeholder|type|contenteditable|role|aria-selected|data-[\w-]+|x-[\w-]+)$/;
  const fields = [];
  const walk = (el, pathArr) => {
    const tag = el.tagName.toLowerCase();
    const node = { t: tag };
    const attrs = {};
    for (const a of el.attributes) {
      if (KEEP_ATTR.test(a.name)) attrs[a.name] = a.value;
    }
    if (Object.keys(attrs).length) node.a = attrs;
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      node.r = [r.left, r.top, r.width, r.height].map(v => Math.round(v * 10) / 10);
    }
    const isEditable = tag === 'textarea' ||
      (tag === 'input' && !['checkbox', 'file', 'range', 'color', 'radio'].includes(el.type)) ||
      el.getAttribute('contenteditable') === 'true';
    if (isEditable && r.width > 20 && r.height > 8) {
      fields.push({ path: pathArr.slice(), tag, value: String(el.value ?? el.innerText ?? ''), placeholder: el.getAttribute('placeholder') || '' });
    }
    if (tag === 'svg' || tag === 'iframe' || tag === 'script' || tag === 'style' || tag === 'canvas') return node;
    if (tag === 'textarea' || tag === 'input') return node; // live values are not visible to SafeElement
    const kids = [];
    let idx = 0;
    for (const child of el.childNodes) {
      if (child.nodeType === 3) {
        const text = child.nodeValue;
        if (text && text.trim()) kids.push(text.length > 400 ? text.slice(0, 400) : text);
      } else if (child.nodeType === 1) {
        if (child.hasAttribute('x-risuhelper-chip') || child.hasAttribute('x-risuhelper-frame')) continue;
        kids.push(walk(child, pathArr.concat(idx)));
        idx++;
      }
    }
    if (kids.length) node.n = kids;
    return node;
  };
  const tree = walk(document.documentElement, []);
  return { tree, fields, title: document.title };
}

async function main() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(8000);

  for (let i = 0; i < 3; i++) { // PocketRisu password dialog (set or enter)
    const pw = page.locator('input[type=password]:visible, [role=dialog] input:visible').first();
    if (await pw.count() === 0) break;
    await pw.fill(PASSWORD);
    await page.locator('button:visible', { hasText: /^(confirm|ok|확인|login|로그인)$/i }).first().click().catch(() => {});
    await page.waitForTimeout(5000);
  }
  await seed(page, LANG);

  const dismissModal = async () => {
    const btn = page.locator('.z-1100 button:visible, [role=dialog] button:visible', { hasText: /^(ok|yes|accept|confirm|확인|예)$/i }).first();
    if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(500); }
  };
  await dismissModal();

  const expandRows = async () => {
    await page.evaluate(() => { for (const row of document.querySelectorAll('[data-risu-idx]')) row.querySelector('button')?.click(); });
    await page.waitForTimeout(700);
  };
  const charTab = async () => {
    await page.evaluate(() => window.__rhStores.settingsOpen.set(false));
    await page.waitForTimeout(400);
    await page.locator('button', { hasText: /^(캐릭터|Character)$/ }).first().click({ timeout: 5000 });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const bs = [...document.querySelectorAll('button')].filter(b => b.querySelector('svg') && !b.textContent.trim());
      const byY = {};
      for (const b of bs) {
        const r = b.getBoundingClientRect();
        if (r.width < 8 || r.left > 500) continue;
        (byY[Math.round(r.top)] ||= []).push(b);
      }
      const row = Object.values(byY).sort((a, b) => b.length - a.length)[0] || [];
      row.forEach((b, i) => b.setAttribute('data-rh-subtab', String(i)));
    });
  };
  const sub = async (i) => { await page.locator(`[data-rh-subtab="${i}"]`).click({ timeout: 5000 }); await page.waitForTimeout(900); };
  const settings = async (idx) => {
    await page.evaluate((idx) => { window.__rhStores.settingsOpen.set(true); window.__rhStores.SettingsMenuIndex.set(idx); }, idx);
    await page.waitForTimeout(1300);
  };

  // ModuleMenu tab bar: upstream marks the active tab with bg-darkbutton, PocketRisu uses role="tab".
  const moduleTab = async (i) => {
    const clicked = await page.evaluate((i) => {
      const active = document.querySelector('[role="tab"][aria-selected="true"]') ||
        [...document.querySelectorAll('button.bg-darkbutton')].find(b => b.parentElement && b.parentElement.querySelectorAll(':scope > button').length >= 4);
      const bar = active && active.parentElement;
      const tabs = bar ? [...bar.querySelectorAll(':scope > button, :scope > [role="tab"]')] : [];
      if (!tabs[i]) return false;
      tabs[i].click();
      return true;
    }, i);
    if (!clicked) throw new Error('module tab bar not found');
    await page.waitForTimeout(800);
  };

  const screens = [
    ['char-basic', async () => { await charTab(); await sub(0); }],
    ['char-lorebook', async () => { await charTab(); await sub(2); await expandRows(); }],
    ['chat-lorebook', async () => {
      await charTab(); await sub(2);
      const chatTab = page.locator('button', { hasText: /^(챗|Chat)$/ });
      await chatTab.nth((await chatTab.count()) - 1).click();
      await page.waitForTimeout(700);
      await expandRows();
    }],
    ['char-scripts', async () => { await charTab(); await sub(4); await expandRows(); }],
    ['char-advanced', async () => { await charTab(); await sub(5); }],
    ['settings-persona', async () => { await settings(12); }],
    ['settings-modules', async () => { await settings(14); }],
    ['module-edit', async () => {
      await settings(14);
      // The edit pencil (lucide square-pen) of the first module row opens ModuleMenu in edit mode.
      await page.locator('button:visible:has(svg.lucide-square-pen)').first().click({ timeout: 4000 });
      await page.waitForTimeout(900);
    }],
    ['module-edit-lorebook', async () => { await moduleTab(1); await expandRows(); }, 'module-edit'],
    ['module-edit-regex', async () => { await moduleTab(2); await expandRows(); }, 'module-edit'],
    ['settings-advanced', async () => { await settings(6); }],
    ['settings-display', async () => { await settings(3); }],
    ['settings-chatbot', async () => { await settings(1); }],
  ];

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const skipped = new Set();
  for (const [name, go, requires] of screens) {
    if (requires && skipped.has(requires)) {
      skipped.add(name);
      console.log(`[skip] ${name}: requires ${requires}`);
      continue;
    }
    try {
      await go();
      await dismissModal();
    } catch (err) {
      skipped.add(name);
      console.log(`[skip] ${name}: ${String(err.message).split('\n')[0]}`);
      continue;
    }
    const snap = await page.evaluate(snapshotInPage);
    const cases = [];
    for (const f of snap.fields) {
      const value = f.value.trim();
      const mapped = EXPECT_BY_VALUE[value];
      const isChatInput = f.tag === 'textarea' && snap.fields.indexOf(f) === snap.fields.length - 1 && !value;
      if (isChatInput) continue;
      cases.push({
        path: f.path,
        tag: f.tag,
        value: value.slice(0, 60),
        placeholder: f.placeholder.slice(0, 60),
        expect: mapped || { writable: false },
      });
    }
    const fixture = { host: HOST, lang: LANG, screen: name, title: snap.title, capturedFrom: URL, cases, tree: snap.tree };
    const file = path.join(OUT_DIR, `${HOST}-${LANG}-${name}.json.gz`);
    fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(fixture)), { level: 9 }));
    const mappedCount = cases.filter(c => c.expect.targetKind).length;
    console.log(`[ok] ${name}: ${cases.length} fields (${mappedCount} with a known target), ${(fs.statSync(file).size / 1024).toFixed(1)} KiB`);
  }
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
