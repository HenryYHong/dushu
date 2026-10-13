// End-to-end check of the PRIVATE site through its real address (Tailscale Serve), in a fresh headless browser profile each run.
// WebKit at iPad size is the Safari engine at device size, not real iPadOS; Chrome is headless Chrome.
//
//   node scripts/qa-private-e2e.mjs webkit "iPad Pro 11 landscape"
//   node scripts/qa-private-e2e.mjs webkit "iPad Pro 11"
//   node scripts/qa-private-e2e.mjs chrome
//
// Public-origin simulation: QA_BASE=http://localhost:5260/dushu/ QA_CONNECT=http://127.0.0.1:5241 runs the same checks on a build
// served under /dushu/ whose Mac is a second bridge on 5241 started with DUSHU_EXTRA_ORIGINS=http://localhost:5260. The device is
// connected to that Mac through the Settings hand-off link, as the owner would do it once on henryyhong.com.
//
// Checks: HTTPS app load, manifest + apple-touch-icon + service worker, both owner books added automatically (no button) and kept
// after a reload and offline, a sentence translated by Claude through the Mac and, with Local only, by the local model, Mac voices,
// Pages two-page reading, word and phrase popups. Prints counts and public-domain text only, never a passage of an owner book.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const require = createRequire(`${root}.cache/qa-webkit/package.json`);
const { host } = JSON.parse(readFileSync(`${root}.dushu-local/ipad.json`, 'utf8'));
const BASE = process.env.QA_BASE ?? `https://${host}/`;
const CONNECT = process.env.QA_CONNECT ?? '';
const API = CONNECT; // '' means the page's own origin
const [engine = 'webkit', deviceName = 'iPad Pro 11 landscape'] = process.argv.slice(2);
const tag = engine === 'chrome' ? 'chrome' : deviceName.replace(/\s+/g, '-').toLowerCase();
const OUT = `${root}qa-out/private/`;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (pass, name, info = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'} [${tag}] ${name}${info ? ` (${info})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

let browser, ctx, page, offline;
if (engine === 'chrome') {
  const puppeteer = (await import('puppeteer-core')).default;
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 800 } });
  ctx = await browser.createBrowserContext();
  page = await ctx.newPage();
  offline = (on) => page.setOfflineMode(on);
} else {
  const { webkit, devices } = require('playwright');
  browser = await webkit.launch({ headless: true });
  ctx = await browser.newContext({ ...devices[deviceName] });
  page = await ctx.newPage();
  offline = (on) => ctx.setOffline(on);
}
// A reload or going offline that the script itself triggers cancels requests and blob reads of an import that is still running;
// WebKit reports those as "due to access control checks". They are counted apart and do not fail the run.
const cancelled = [];
page.on('pageerror', (e) => { if (/due to access control checks/.test(e.message)) { cancelled.push(e.message); return; } errors.push(e.message); if (process.env.QA_DEBUG) console.log('PAGEERROR', e.message.slice(0, 160), String(e.stack ?? '').split('\n').slice(0, 4).join(' | ').slice(0, 400)); });
page.on('console', (m) => { if (process.env.QA_DEBUG && m.type() === 'error') console.log('console.error', m.text().slice(0, 200)); });
// One evaluate form for both engines: a source string, so any number of arguments works.
const ev = (fn, ...args) => page.evaluate(`(${fn})(...${JSON.stringify(args)})`);
async function until(fn, ms = 30000, ...args) {
  const end = Date.now() + ms;
  for (;;) {
    let v; try { v = await ev(fn, ...args); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(400);
  }
}
/** Polls a Node-side async check (the page-side `until` evaluates its function inside the page). */
async function untilNode(fn, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    let v; try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(500);
  }
}
const cards = () => ev(() => [...document.querySelectorAll('.lib-card:not(.lib-card-pending)')].map((c) => c.textContent ?? ''));
const owner = async () => { const t = await cards(); return { huozhe: t.filter((x) => x.includes('活着')).length, shediao: t.filter((x) => x.includes('射雕英雄传')).length }; };
const settle = async (ms) => sleep(ms);

try {
  // ---- 1. load, manifest, icon, service worker
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'load' });
  check(await until(() => document.querySelector('.lib-grid, .lib-empty, .lib-page, #app *') !== null, 20000), `app loads over HTTPS (${Date.now() - t0} ms)`, BASE.replace(/^https:\/\/[^/]+/, 'https://<mac>'));
  const meta = await ev(async () => {
    const m = document.querySelector('link[rel=manifest]')?.href; const a = document.querySelector('link[rel=apple-touch-icon]')?.href;
    const man = m ? await fetch(m).then((r) => r.ok ? r.json() : null).catch(() => null) : null;
    const icon = a ? await fetch(a).then((r) => ({ ok: r.ok, type: r.headers.get('content-type') })).catch(() => null) : null;
    return { https: location.protocol === 'https:', man: man && { name: man.name, display: man.display, icons: man.icons?.length, start: man.start_url }, icon };
  });
  check((meta.https || !!CONNECT) && !!meta.man && meta.man.icons >= 3, 'web manifest loads', JSON.stringify(meta.man));
  check(!!meta.icon?.ok && /image\/png/.test(meta.icon.type ?? ''), 'apple-touch-icon loads', meta.icon?.type);
  const sw = await ev(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 25000))]);
    for (let i = 0; i < 50 && reg && reg.active?.state !== 'activated'; i++) await new Promise((r) => setTimeout(r, 200));
    return reg ? { supported: true, scope: reg.scope === new URL('./', location.href).href, active: reg.active?.state } : { supported: true, scope: false };
  });
  check(sw.supported && sw.scope && sw.active === 'activated', 'service worker registered and active over HTTPS', JSON.stringify(sw));

  if (CONNECT) {
    // Connect this device to the Mac once, the way the one-time link does: it opens Settings with the address in the fragment.
    await ev((u) => { location.hash = '#/settings?connect=' + encodeURIComponent(u); }, CONNECT);
    const card = await until(() => { const p = document.querySelector('.set-pending'); return p && !p.hidden ? p.textContent : null; }, 20000);
    check(!!card && /Connect this device to/.test(card), 'the hand-off link asks before connecting', card ? card.slice(0, 60) : '');
    check(!(await ev(() => location.hash.includes('connect='))), 'the Mac address is stripped from the URL');
    await ev(() => { [...document.querySelectorAll('.set-pending button')].find((b) => b.textContent === 'Connect').click(); });
    const stored = await until((u) => localStorage.getItem('dushu.mac-bridge.v1') === u, 20000, CONNECT);
    check(!!stored, 'the device is connected to the Mac');
    const stat = await until(() => { const t = document.querySelector('.set-mac-result')?.textContent ?? ''; return /reach|connected|works|ready/i.test(t) ? t : null; }, 20000);
    console.log(`INFO [${tag}] connect result: ${(stat ?? 'none').slice(0, 100)}`);
    check(!!(await ev((u) => !JSON.parse(localStorage.getItem('dushu.settings.v1') ?? '{}').macUrl && !JSON.stringify(localStorage.getItem('dushu.settings.v1') ?? '').includes(u.replace(/^https?:\/\//, '')), CONNECT)), 'the Mac address is not stored in Settings');
    await ev(() => { location.hash = '#/'; });
  }

  // ---- 2. owner books appear on their own, without any button (QA_FAST=1 skips 2 and 3 to iterate on the rest)
  if (!process.env.QA_FAST) {
  let seen = null;
  await untilNode(async () => { const o = await owner(); return o.huozhe >= 1 && o.shediao >= 1; }, 300000);
  seen = await owner();
  check(seen.huozhe === 1 && seen.shediao === 1, 'both owner books were added automatically on a fresh profile (no button pressed)', JSON.stringify(seen));
  const toastGone = await until(() => !document.querySelector('.lib-card-pending'), 60000);
  check(!!toastGone, 'no import is still pending');
  const persist = await ev(async () => ({ api: !!navigator.storage?.persist, persisted: await navigator.storage?.persisted?.() }));
  console.log(`INFO [${tag}] persistent storage requested: api=${persist.api} granted=${persist.persisted} (headless browsers often refuse; Safari grants for a home-screen app)`);
  await page.screenshot({ path: `${OUT}${tag}-library.png` });
  await page.reload({ waitUntil: 'load' });
  await until(() => document.querySelector('.lib-card'), 30000);
  await settle(6000);
  const after = await owner();
  check(after.huozhe === 1 && after.shediao === 1, 'both owner books are still there, once each, after a reload', JSON.stringify(after));

  // ---- 3. offline reload
  await offline(true);
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  const offCards = await untilNode(async () => { const o = await owner(); return o.huozhe === 1 && o.shediao === 1; }, 40000);
  check(!!offCards, 'offline reload works and both owner books are there');
  // open the small owner book offline: the reader must render words
  const href = await ev(() => [...document.querySelectorAll('.lib-card')].find((c) => (c.textContent ?? '').includes('活着'))?.querySelector('a.lib-card-main')?.getAttribute('href'));
  if (href) { await ev((h) => { location.hash = h.replace(/^.*#/, '#'); }, href); }
  const words = await until(() => document.querySelectorAll('.rd-w').length > 20, 40000);
  check(!!words, 'an owner book opens offline and shows words');
  await ev(() => { location.hash = '#/'; });
  await offline(false);
  await page.reload({ waitUntil: 'load' });
  await until(() => document.querySelector('.lib-card'), 30000);

  }

  // ---- 4. a public-domain classic for the reader checks
  await ev(() => { localStorage.setItem('dushu.settings.v1', JSON.stringify({ theme: 'light', pinyin: 'off', layout: 'scroll', translator: 'auto', localOnly: false })); });
  await page.reload({ waitUntil: 'load' });
  await until(() => document.querySelector('.lib-sample'), 30000);
  await ev(() => { const s = [...document.querySelectorAll('.lib-sample')].find((x) => (x.textContent ?? '').includes('唐詩八首')); [...s.querySelectorAll('button')].find((b) => /Add and read/.test(b.textContent ?? '')).click(); });
  check(!!(await until(() => document.querySelectorAll('.rd-w').length > 20, 60000)), 'a public-domain classic opens in Scroll (the default)');
  const selectPhrase = (a, z) => ev((a, z) => {
    // A finger: the reader only turns a selection into a phrase card for touch after a touch pointer went down.
    document.body.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true }));
    const ws = [...document.querySelectorAll('.rd-article .rd-w')].filter((w) => { const r = w.getBoundingClientRect(); return r.top > 120 && r.bottom < innerHeight - 60 && r.left >= 0 && r.right <= innerWidth; });
    const first = ws[a], last = ws[z];
    const textNodes = (el) => { const wk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const out = []; let n; while ((n = wk.nextNode())) if ((n.textContent ?? '').trim()) out.push(n); return out; };
    const startNode = textNodes(first)[0];
    const endNode = textNodes(last).at(-1);
    const r = document.createRange(); r.setStart(startNode, 0); r.setEnd(endNode, endNode.textContent.length);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    return ws.length;
  }, a, z);
  const closePopup = async () => { await ev(() => { document.querySelector('.pp-close')?.click(); getSelection()?.removeAllRanges(); }); await settle(400); };

  // word popup
  await ev(() => {
    const w = [...document.querySelectorAll('.rd-article .rd-w')].find((x) => { const r = x.getBoundingClientRect(); return r.top > 160 && r.bottom < innerHeight - 160; });
    const r = w.getBoundingClientRect(); w.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + 4, clientY: r.y + 4 }));
  });
  const wordCard = await until(() => { const p = document.querySelector('.pp-pop.pp-k-word'); return p && p.querySelector('.pp-defs') ? { defs: p.querySelectorAll('.pp-defs li').length, py: !!p.querySelector('.pp-pyline .pp-py') } : null; }, 15000);
  check(!!wordCard && wordCard.defs > 0 && wordCard.py, 'word popup shows pinyin and definitions', JSON.stringify(wordCard));
  await page.screenshot({ path: `${OUT}${tag}-word.png` });
  await closePopup();

  // sentence translation by Claude through the Mac
  await selectPhrase(1, 8);
  const claude = await until(() => {
    const p = document.querySelector('.pp-pop.pp-k-phrase') ?? document.querySelector('.pp-pop');
    const head = p?.querySelector('.pp-tr-head')?.textContent ?? ''; const text = p?.querySelector('.pp-tr-text')?.textContent ?? '';
    return /Claude/.test(head) && text.length > 8 ? { head, text } : null;
  }, 60000);
  if (!claude) console.log('DEBUG', JSON.stringify(await ev(() => { const p = document.querySelector('.pp-pop'); return p ? { cls: p.className, head: p.querySelector('.pp-tr-head')?.textContent, text: (p.querySelector('.pp-tr-text')?.textContent ?? '').length, note: p.querySelector('.pp-tr-note, .pp-tr-error, .pp-tr-quiet')?.textContent?.slice(0, 120) } : 'no popup'; })));
  check(!!claude, 'a sentence is translated by Claude through the Mac', claude ? `${claude.head.replace(/\s+/g, ' ').slice(0, 60)} => ${claude.text.slice(0, 90)}` : 'no Claude answer');
  await page.screenshot({ path: `${OUT}${tag}-phrase-claude.png` });
  const quiet = await ev(() => !document.querySelector('.pp-tr-quiet') && !document.querySelector('.pp-tr-error'));
  check(quiet, 'the phrase card shows no error');
  await closePopup();

  // Local only: the same selection must be answered by the local model, never Claude
  await ev(() => { location.hash = '#/settings'; });
  await until(() => document.querySelector('input[aria-label^="Local only"]'), 20000);
  await ev(() => { const i = document.querySelector('input[aria-label^="Local only"]'); if (!i.checked) i.click(); });
  const on = await until(() => JSON.parse(localStorage.getItem('dushu.settings.v1') ?? '{}').localOnly === true, 5000);
  check(!!on, 'Local only turns on in Settings');
  const chip = await until(() => { const r = [...document.querySelectorAll('.set-prov')].find((x) => /^Claude/.test(x.querySelector('.set-prov-name')?.textContent ?? '')); const c = r?.querySelector('.set-chip')?.textContent; return c === 'Local only is on' ? c : null; }, 15000) ?? 'still not marked';
  check(chip === 'Local only is on', 'Settings marks Claude as off under Local only', chip);
  // Mac voices
  const voices = await ev(async (api) => { const r = await fetch(api + '/api/native-voices'); const j = r.ok ? await r.json() : []; return { ok: r.ok, n: j.length, mac: j.filter((v) => String(v.voiceURI).startsWith('dushu-mac:')).length }; }, API);
  check(voices.ok && voices.mac > 0, 'Mac voices are listed by the bridge', `${voices.mac} voices`);
  const voiceUi = await ev(() => [...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => /Premium|Mac/i.test(o.textContent ?? ''))));
  console.log(`INFO [${tag}] a Mac/Premium option is in a Settings voice list: ${voiceUi}`);
  await ev(() => { history.back(); });
  await until(() => document.querySelectorAll('.rd-w').length > 20, 20000);
  await selectPhrase(1, 8);
  const local = await until(() => {
    const p = document.querySelector('.pp-pop.pp-k-phrase') ?? document.querySelector('.pp-pop');
    const head = p?.querySelector('.pp-tr-head')?.textContent ?? ''; const text = p?.querySelector('.pp-tr-text')?.textContent ?? '';
    return head && !/Claude/.test(head) && /Mac AI|Ollama|Qwen|local/i.test(head) && text.length > 8 ? { head, text } : null;
  }, 120000);
  if (!local) console.log('DEBUG', JSON.stringify(await ev(() => { const p = document.querySelector('.pp-pop'); return p ? { cls: p.className, head: p.querySelector('.pp-tr-head')?.textContent, text: (p.querySelector('.pp-tr-text')?.textContent ?? '').length, note: p.querySelector('.pp-tr-note, .pp-tr-error, .pp-tr-quiet')?.textContent?.slice(0, 120) } : 'no popup'; })));
  check(!!local, 'with Local only the sentence is translated by the local model', local ? `${local.head.replace(/\s+/g, ' ').slice(0, 60)} => ${local.text.slice(0, 90)}` : 'no local answer');
  await page.screenshot({ path: `${OUT}${tag}-phrase-local.png` });
  const claudeAfter = await ev(async (api) => { const r = await fetch(api + '/api/claude/status'); return (await r.json()).usage?.requests ?? -1; }, API);
  await closePopup();
  await ev(() => { const s = JSON.parse(localStorage.getItem('dushu.settings.v1') ?? '{}'); s.localOnly = false; localStorage.setItem('dushu.settings.v1', JSON.stringify(s)); });
  console.log(`INFO [${tag}] Claude requests today after the Local only run: ${claudeAfter}`);

  // ---- 5. Pages: two pages on a wide screen, page turns
  await ev(() => { const s = JSON.parse(localStorage.getItem('dushu.settings.v1') ?? '{}'); s.layout = 'pages'; s.localOnly = false; localStorage.setItem('dushu.settings.v1', JSON.stringify(s)); });
  await ev(() => { location.hash = '#/'; });
  await page.reload({ waitUntil: 'load' });
  // A longer public-domain text (Lu Xun, 故乡), so there are several spreads to turn through.
  await until(() => document.querySelector('.lib-sample'), 30000);
  await ev(() => { const s = [...document.querySelectorAll('.lib-sample')].find((x) => (x.textContent ?? '').includes('故乡')); [...s.querySelectorAll('button')].find((b) => /Add and read|Read/.test(b.textContent ?? '')).click(); });
  const paged = await until(() => document.querySelector('.rd-root.rd-paged .rd-w'), 60000);
  check(!!paged, 'Pages layout opens');
  const info = await ev(() => {
    const stage = document.querySelector('.rd-stage'); const w = [...document.querySelectorAll('.rd-root.rd-paged .rd-w')].filter((x) => { const r = x.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1 && r.bottom <= innerHeight + 1; });
    const xs = w.map((x) => x.getBoundingClientRect().left); const mid = innerWidth / 2;
    return { width: innerWidth, left: xs.filter((x) => x < mid - 20).length, right: xs.filter((x) => x > mid + 20).length, spread: stage?.dataset.spread };
  });
  const wide = info.width >= 900;
  check(wide ? info.left > 0 && info.right > 0 : info.left + info.right > 0, wide ? 'Pages shows two pages side by side' : 'Pages shows one page on a narrow screen', JSON.stringify(info));
  await page.screenshot({ path: `${OUT}${tag}-pages.png` });
  const turned = await ev(async () => {
    const sig = () => [...document.querySelectorAll('.rd-root.rd-paged .rd-w')].filter((x) => { const r = x.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.top >= 0; }).slice(0, 12).map((x) => x.dataset.b + ':' + x.dataset.s).join(',');
    const key = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    const a = sig();
    key('ArrowRight'); await new Promise((r) => setTimeout(r, 1500));
    const b = sig();
    key('ArrowLeft'); await new Promise((r) => setTimeout(r, 1500));
    const c = sig();
    return { s1: a !== b ? 'moved' : 'same', s0: c === a ? 'back' : 'other' };
  });
  check(turned.s1 === 'moved' && turned.s0 === 'back', 'a page turn moves the spread forward and back', JSON.stringify(turned));
  // popup inside Pages
  await ev(() => {
    const w = [...document.querySelectorAll('.rd-root.rd-paged .rd-w')].find((x) => { const r = x.getBoundingClientRect(); return r.top > 160 && r.bottom < innerHeight - 200 && r.left > 40 && r.right < innerWidth - 40; });
    const r = w.getBoundingClientRect(); w.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + 4, clientY: r.y + 4 }));
  });
  await until(() => document.querySelector('.pp-pop.pp-k-word'), 15000); await settle(600);
  const pw = await until(() => { const p = document.querySelector('.pp-pop.pp-k-word'); if (!p) return null; const b = p.getBoundingClientRect(); return { sheet: p.classList.contains('pp-sheet'), w: Math.round(b.width), left: Math.round(b.left), vw: innerWidth, bottom: Math.round(b.bottom), vh: innerHeight }; }, 15000);
  check(!!pw && pw.bottom <= pw.vh + 1, 'word popup opens in Pages and stays on screen', JSON.stringify(pw));
  if (pw?.sheet && wide) check(pw.left === 0 && pw.w === pw.vw, 'the tablet sheet spans the whole screen (no half-cut text beside it)');
  await page.screenshot({ path: `${OUT}${tag}-pages-popup.png` });
} catch (e) {
  check(false, `script error: ${e.message}`);
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r).length;
console.log(`[${tag}] requests cancelled by the script's own reloads: ${cancelled.length}`);
console.log(`[${tag}] page errors: ${errors.length ? errors.slice(0, 3).join(' | ') : 'none'}`);
console.log(`[${tag}] ${results.length - failed} passed, ${failed} failed`);
process.exit(failed || errors.length ? 1 : 0);
