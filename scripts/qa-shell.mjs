// Headless QA for the library, settings and about screens.
// Usage: start `npx vite --port 5182 --strictPort`, then `node scripts/qa-shell.mjs`.
// Writes screenshots to qa-out/shell/ and exits non-zero on console errors or failed checks.
//
// Offline check (service worker): needs a production build in a scratch folder, never dist/ (the running server serves that):
//   npx vite build --outDir .cache/build-x
//   QA_ONLY=offline QA_DIST=.cache/build-x QA_PREVIEW_PORT=5212 node scripts/qa-shell.mjs
// It starts `vite preview` itself, lets the service worker install, then STOPS the server and loads every screen again.
// page.setOfflineMode cannot see the real failure: it never changes the Vary headers a cache lookup depends on.
import puppeteer from 'puppeteer-core';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'qa-out', 'shell');
mkdirSync(out, { recursive: true });
const BASE = process.env.QA_URL ?? 'http://localhost:5182/';
/**
 * For a server this script did not start (its sync folder may be the owner's): sync is switched off in the page before the
 * app starts, and again after any localStorage.clear(), so nothing this run saves reaches the Mac's copy.
 */
const SYNC_OFF = () => {
  try {
    const key = 'dushu.sync.off.v1';
    localStorage.setItem(key, '1');
    const clear = Storage.prototype.clear;
    Storage.prototype.clear = function () { clear.call(this); try { if (this === localStorage) this.setItem(key, '1'); } catch { /* blocked */ } };
  } catch { /* storage blocked: the app cannot sync either */ }
};
// A real book with a cover that any machine has: Project Gutenberg's 道德經 (public domain), never the owner's own books.
const COVER_BOOK = join(root, 'tests/fixtures/import/daodejing.gutenberg.azw3');

const problems = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) problems.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------- offline (server stopped) ---
async function offlineStep() {
  const dist = process.env.QA_DIST;
  const port = Number(process.env.QA_PREVIEW_PORT ?? 0);
  if (!dist || !port) { console.log('FAIL QA_ONLY=offline needs QA_DIST (a build folder) and QA_PREVIEW_PORT'); process.exit(1); }
  if (/(^|\/)dist\/?$/.test(dist)) { console.log('FAIL refusing to preview dist/: build into .cache/ instead'); process.exit(1); }
  const base = `http://localhost:${port}/`;
  const up = async () => { try { return (await fetch(base, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };
  // The preview started here gets an empty sync folder of its own (removed on exit), never the owner's.
  const syncDir = mkdtempSync(join(tmpdir(), 'dushu-qa-sync-'));
  process.on('exit', () => rmSync(syncDir, { recursive: true, force: true }));
  const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', env: { ...process.env, DUSHU_SYNC_DIR: syncDir } });
  const stopServer = async () => { server.kill('SIGTERM'); for (let i = 0; i < 40 && await up(); i++) await sleep(150); };
  for (let i = 0; i < 60 && !(await up()); i++) await sleep(250);
  check(await up(), 'preview server is up');
  const vary = (await fetch(base)).headers.get('vary');
  console.log(`     host sends Vary: ${vary ?? '(none)'}`);

  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, timeout: 90000, args: ['--no-first-run', '--no-default-browser-check'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 860 });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  try {
    await p.goto(base, { waitUntil: 'networkidle0' });
    await p.evaluate(() => navigator.serviceWorker.ready);
    await p.waitForFunction(async () => (await caches.keys()).length >= 2 && (await (await caches.open((await caches.keys()).find((k) => k.startsWith('dushu-app-')))).keys()).length > 5, { timeout: 30000 });
    await p.reload({ waitUntil: 'networkidle0' });
    check(await p.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
    const cached = await p.evaluate(async () => { let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n; });
    check(cached > 20, `service worker cached ${cached} files`);

    // A top-level visit to another file must not replace the stored app shell.
    await p.goto(`${base}manifest.webmanifest`, { waitUntil: 'networkidle0' });
    await sleep(300);
    const shellType = await p.evaluate(async () => (await caches.match('./', { ignoreVary: true }))?.headers.get('content-type'));
    check(/text\/html/.test(shellType ?? ''), `stored app shell is still HTML after visiting the manifest (${shellType})`);
    await p.goto(base, { waitUntil: 'networkidle0' });

    await stopServer();
    check(!(await up()), 'server stopped');

    // Fresh navigation with the server gone: the shell and each lazy chunk come from the cache.
    await p.goto(base, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForSelector('.lib-page', { timeout: 15000 });
    check(true, 'offline: the library opens');
    for (const [hash, sel] of [['#/vocab', '.voc-page'], ['#/review', '.rev-empty, .rev-word, .card'], ['#/settings', '.set-page'], ['#/about', '.ab-host section'], ['#/', '.lib-page']]) {
      await p.evaluate((h) => { location.hash = h; }, hash);
      const ok = await p.waitForSelector(sel, { timeout: 8000 }).then(() => true, () => false);
      const stuck = await p.evaluate(() => !!document.querySelector('.app-load-failed'));
      check(ok && !stuck, `offline: ${hash} opens`);
    }
    await p.screenshot({ path: join(out, 'offline-about.png') });

    // Classics are precached, so they add fine offline. A classic that was never stored (the precache can be partial) cannot
    // be added; take them out of the cache to see what the person would read then.
    const inCache = await p.evaluate(async () => { for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) if (/\/samples\/[^/]+\.txt$/.test(r.url)) await c.delete(r); } return true; });
    await p.evaluate(() => { location.hash = '#/'; });
    await p.waitForSelector('.lib-sample .lib-add', { timeout: 8000 }).catch(() => {});
    if (await p.$('.lib-sample .lib-add')) {
      await p.evaluate(() => document.querySelectorAll('.app-toast').forEach((t) => t.remove()));
      await p.evaluate(() => document.querySelector('.lib-sample .lib-add').click());
      await p.waitForSelector('.app-toast', { timeout: 10000 });
      const t = await p.$eval('.app-toast', (e) => e.textContent);
      check(/^Could not (add|download) /.test(t) && !/respondWith|TypeError|Load failed|Failed to fetch/.test(t), `offline: adding a classic gives a plain message (${t.slice(0, 90)})`);
      // With the browser itself reporting offline, the message says so.
      await p.setOfflineMode(true);
      await p.evaluate(() => document.querySelectorAll('.app-toast').forEach((t) => t.remove()));
      await p.evaluate(() => document.querySelector('.lib-sample .lib-add').click());
      await p.waitForFunction(() => /offline/i.test(document.querySelector('.app-toast')?.textContent ?? ''), { timeout: 10000 }).catch(() => {});
      const t2 = await p.$eval('.app-toast', (e) => e.textContent).catch(() => '');
      check(/You are offline\. Connect once to add this classic\./.test(t2), `offline: the browser reports offline (${t2.slice(0, 90)})`);
      await p.screenshot({ path: join(out, 'offline-add-classic.png') });
      await p.setOfflineMode(false);
    } else {
      check(false, 'offline: classics list is available from the cache');
    }
    check(errs.filter((e) => !/Failed to fetch|Load failed/.test(e)).length === 0, `offline: no page errors${errs.length ? ' (' + errs.slice(0, 3).join(' / ') + ')' : ''}`);
  } finally {
    await b.close();
    await stopServer();
  }
  if (problems.length) { console.log(`\n${problems.length} check(s) failed`); process.exit(1); }
  console.log('\nall offline checks passed');
  process.exit(0);
}
if (process.env.QA_ONLY === 'offline') await offlineStep();

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, timeout: 90000,
  args: ['--no-first-run', '--no-default-browser-check'],
});
const page = await browser.newPage();
// QA_URL names a server this script did not start.
await page.evaluateOnNewDocument(SYNC_OFF);
// On the dev server the Mac bridge lists the owner's books and a fresh profile adds them at once, so the library would never
// start empty. Answer the list with "no books"; the bridge and the owner books are checked in qa-local-books.mjs.
await page.setRequestInterception(true);
page.on('request', (r) => {
  if (new URL(r.url()).pathname === '/api/local-books') void r.respond({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: '[]' });
  else void r.continue();
});
const errors = [];
let ignoreErrors = false;
page.on('console', (m) => { if (m.type() === 'error' && !ignoreErrors) errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => { if (!ignoreErrors) errors.push(`pageerror: ${e.message}`); });
page.on('requestfailed', (r) => {
  if (ignoreErrors || r.url().includes('hanzi')) return;
  // A probe the page abandons on purpose (its own AbortSignal.timeout, or a reload while it was in flight) shows up as ERR_ABORTED.
  if (/\/api\//.test(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED') return;
  errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`);
});

const shot = async (name, opts = {}) => { await sleep(250); await page.screenshot({ path: join(out, `${name}.png`), ...opts }); console.log(`     shot ${name}`); };
const goto = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(500); };
const text = (sel) => page.$eval(sel, (e) => e.textContent).catch(() => null);

async function setTheme(theme) {
  await page.evaluate((t) => {
    const k = 'dushu.settings.v1';
    const cur = JSON.parse(localStorage.getItem(k) || '{}');
    localStorage.setItem(k, JSON.stringify({ ...cur, theme: t }));
  }, theme);
  await page.reload({ waitUntil: 'networkidle0' });
}

// ---------------------------------------------------------------- desktop ---
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle0' });
await setTheme('light');
await page.waitForSelector('.lib-page');
await page.waitForSelector('.lib-sample', { timeout: 8000 }).catch(() => {});
check(!!(await page.$('.lib-empty')), 'empty library shows the empty state');
check((await page.$$('.lib-sample')).length >= 8, `classics listed (${(await page.$$('.lib-sample')).length})`);
await shot('01-library-empty', { fullPage: true });

// Paste dialog.
await page.evaluate(() => [...document.querySelectorAll('.lib-actions .btn')].find((b) => b.textContent.includes('Paste')).click());
await page.waitForSelector('dialog.lib-dlg[open]');
check(await page.$eval('.lib-dlg .btn-primary', (b) => b.disabled), 'paste dialog: Add disabled while empty');
await page.type('.lib-paste-text', '第一章 开始\n\n今天天气很好，我和朋友一起去公园玩。我们看到了很多花。\n\n第二章 回家\n\n天黑了，我们走路回家。路上很安静。');
await page.type('.lib-paste input[aria-label=Title]', '短文');
await shot('02-paste-dialog');
await page.click('.lib-dlg .btn-primary');
await page.waitForFunction(() => location.hash.startsWith('#/read/'), { timeout: 8000 });
check(true, 'paste import navigates to the reader');
ignoreErrors = true; // the reader belongs to another agent
await goto('#/');
await page.waitForSelector('.lib-card');
ignoreErrors = false;

// Two samples by click (first one opens the reader), then back.
await page.waitForSelector('.lib-sample .lib-add');
await page.evaluate(() => document.querySelector('.lib-sample .lib-add').click());
await page.waitForFunction(() => location.hash.startsWith('#/read/'), { timeout: 15000 });
check(true, 'sample click imports and opens the reader');
ignoreErrors = true;
await goto('#/');
await page.waitForSelector('.lib-card');
ignoreErrors = false;

// Files through the real file input: a txt sample and a Kindle book with a cover.
const input = await page.$('input[type=file]');
await input.uploadFile(join(root, 'public/samples/kong-yiji.txt'));
await page.waitForFunction(() => document.querySelectorAll('.lib-card').length >= 3, { timeout: 15000 });
await input.uploadFile(COVER_BOOK);
// Cards show titles in the reading script (simplified by default): the stored 道德經 shows as 道德经.
const coverAdded = await page.waitForFunction(() => [...document.querySelectorAll('.lib-card-title')].some((e) => e.textContent === '道德經' || e.textContent === '道德经'), { timeout: 30000 }).then(() => true, () => false);
check(coverAdded, '道德經.azw3 imports through the file input');
await sleep(500);
const titles = await page.$$eval('.lib-card-title', (els) => els.map((e) => e.textContent));
console.log('     books:', titles.join(' | '));
check(titles.length >= 4, `library has ${titles.length} books`);
const realCover = await page.waitForFunction(() => {
  const c = [...document.querySelectorAll('.lib-card')].find((x) => ['道德經', '道德经'].includes(x.querySelector('.lib-card-title')?.textContent ?? ''));
  const img = c?.querySelector('img.lib-cover-img');
  return !!img && img.complete && img.naturalWidth > 0;
}, { timeout: 5000 }).then(() => true, () => false);
check(realCover, '道德經 shows its real cover image');

// Fake some reading progress so the Continue card and bars show.
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('dushu'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const books = await new Promise((res) => { const r = db.transaction('books').objectStore('books').getAll(); r.onsuccess = () => res(r.result); });
  const tx = db.transaction(['books', 'progress'], 'readwrite');
  books.forEach((b, i) => {
    if (b.title === '道德經') { b.lastOpenedAt = Date.now(); tx.objectStore('progress').put({ bookId: b.id, chapter: 5, block: 0, percent: 0.37, updatedAt: Date.now() }); }
    else if (i % 2 === 0) { b.lastOpenedAt = Date.now() - 1e6; tx.objectStore('progress').put({ bookId: b.id, chapter: 0, block: 2, percent: i === 2 ? 1 : 0.12, updatedAt: Date.now() }); }
    tx.objectStore('books').put(b);
  });
  await new Promise((res) => { tx.oncomplete = res; });
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.lib-continue');
check(['道德經', '道德经'].includes(await text('.lib-continue-title')), 'Continue card shows the most recently opened book');
await shot('03-library-books', { fullPage: true });

// Card menu, rename, delete.
await page.hover('.lib-card');
await page.click('.lib-card .lib-card-menu');
await page.waitForSelector('.lib-menu');
await shot('04-card-menu');
await page.evaluate(() => [...document.querySelectorAll('.lib-menu-item')].find((b) => b.textContent === 'Rename').click());
await page.waitForSelector('dialog.lib-dlg[open] input');
await page.$eval('dialog.lib-dlg input[name=title]', (i) => { i.value = ''; });
await page.type('dialog.lib-dlg input[name=title]', '改名了');
await shot('05-rename');
await page.keyboard.press('Enter');
await page.waitForFunction(() => [...document.querySelectorAll('.lib-card-title')].some((e) => e.textContent === '改名了'));
check(true, 'rename updates the card');
const before = (await page.$$('.lib-card')).length;
await page.hover('.lib-card');
await page.click('.lib-card .lib-card-menu');
await page.evaluate(() => [...document.querySelectorAll('.lib-menu-item')].find((b) => b.textContent === 'Delete').click());
await page.waitForSelector('dialog.lib-dlg[open]');
await shot('06-delete-confirm');
await page.evaluate(() => [...document.querySelectorAll('dialog.lib-dlg .btn')].find((b) => b.textContent === 'Cancel').click());
check((await page.$$('.lib-card')).length === before, 'cancel keeps the book');
await page.hover('.lib-card');
await page.click('.lib-card .lib-card-menu');
await page.evaluate(() => [...document.querySelectorAll('.lib-menu-item')].find((b) => b.textContent === 'Delete').click());
await page.waitForSelector('dialog.lib-dlg[open]');
await page.evaluate(() => [...document.querySelectorAll('dialog.lib-dlg .btn')].find((b) => b.textContent === 'Delete').click());
await page.waitForFunction((n) => document.querySelectorAll('.lib-card').length === n - 1, {}, before);
check(true, 'confirmed delete removes the book');

// Error toast for a bad file.
await page.evaluate(() => document.querySelectorAll('.app-toast').forEach((t) => t.remove()));
await (await page.$('input[type=file]')).uploadFile(join(root, 'package.json'));
await page.waitForSelector('.app-toast');
const toastText = await text('.app-toast');
console.log('     toast:', toastText);
check(/package\.json/.test(toastText) && !/undefined/.test(toastText), 'bad file gives a readable toast naming the file');
await shot('07-error-toast');

// Drag overlay.
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['x'], 'a.txt'));
  window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
check(await page.$eval('.lib-drop', (e) => !e.hidden), 'drag overlay appears');
await shot('08-drop-overlay');
await page.evaluate(() => window.dispatchEvent(new DragEvent('dragleave', { bubbles: true })));

// ---------------------------------------------------------------- settings ---
await goto('#/settings');
await page.waitForSelector('.set-page .set-ruby rt');
await sleep(800);
await shot('10-settings-light', { fullPage: true });
check((await page.$$('.set-ruby rt:not(:empty)')).length > 5, 'preview shows pinyin');
const providers = await page.$$eval('.set-prov', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').slice(0, 60)));
console.log('     providers:', providers.join(' || '));
// Controls change the preview.
await page.evaluate(() => [...document.querySelectorAll('.set-seg-btn')].find((b) => b.textContent === 'Numbers').click());
await sleep(200);
const rt1 = await page.$eval('.set-ruby rt', (e) => e.textContent);
check(/\d/.test(rt1), `pinyin style numbers applies to the preview (${rt1})`);
await page.evaluate(() => [...document.querySelectorAll('.set-seg-btn')].find((b) => b.textContent === 'Zhuyin').click());
await sleep(200);
await shot('11-settings-zhuyin');
await page.evaluate(() => [...document.querySelectorAll('.set-seg-btn')].find((b) => b.textContent === 'Tone marks').click());
await page.evaluate(() => [...document.querySelectorAll('.set-seg-btn')].find((b) => b.textContent === 'Traditional').click());
await sleep(200);
check((await text('.set-sample')).includes('們'), 'traditional script applies to the preview');
await page.evaluate(() => [...document.querySelectorAll('.set-seg-btn')].find((b) => b.textContent === 'As written').click());
await page.evaluate(() => [...document.querySelectorAll('.set-seg-btn')].find((b) => b.textContent === 'Off').click());
await sleep(200);
check((await page.$$('.set-ruby rt:not(:empty)')).length === 0, 'pinyin Off removes ruby text');
await page.evaluate(() => [...document.querySelectorAll('.set-seg-btn')].find((b) => b.textContent === 'All').click());
// Font size slider.
await page.$eval('.set-range', (el) => { el.value = '32'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(200);
check((await page.$eval('.set-sample', (e) => e.style.fontSize)) === '32px', 'font size slider applies');
await page.$eval('.set-range', (el) => { el.value = '22'; el.dispatchEvent(new Event('input', { bubbles: true })); });

// The Anthropic key lives only on the Mac: Settings has no key field, and nothing about a key is kept in the browser.
check(!(await page.$('.set-key, input[type=password]')), 'settings has no API key field (the key stays on the Mac)');
check(await page.evaluate(() => !/claudeApiKey|sk-ant-/.test(localStorage.getItem('dushu.settings.v1') ?? '')), 'saved settings hold no API key');
await shot('12-settings-translation', { clip: undefined });

// Backup export.
const exported = await page.evaluate(async () => {
  const chunks = [];
  const orig = URL.createObjectURL;
  URL.createObjectURL = (b) => { chunks.push(b); return orig(b); };
  [...document.querySelectorAll('.btn')].find((b) => b.textContent.includes('Export backup')).click();
  await new Promise((r) => setTimeout(r, 800));
  URL.createObjectURL = orig;
  return chunks.length ? JSON.parse(await chunks[0].text()) : null;
});
check(exported && exported.app === 'dushu' && !('claudeApiKey' in (exported.settings ?? {})), 'backup export has app marker and no API key');

for (const theme of ['dark', 'sepia']) {
  await setTheme(theme);
  await page.waitForSelector('.set-page .set-ruby rt');
  await sleep(600);
  await shot(`13-settings-${theme}`, { fullPage: true });
}
await setTheme('dark');
await goto('#/');
await page.waitForSelector('.lib-card');
await shot('14-library-dark', { fullPage: true });
await goto('#/about');
await page.waitForSelector('.ab-stat');
await shot('15-about-dark', { fullPage: true });
await setTheme('light');
await goto('#/about');
await page.waitForSelector('.ab-stat');
await sleep(400);
await shot('16-about-light', { fullPage: true });
const stats = await page.$$eval('.ab-stat-value', (els) => els.map((e) => e.textContent));
console.log('     stats:', stats.join(' | '));
check(stats.every((s) => s !== '-' && s !== 'NaN'), 'about coverage numbers are real');
check((await page.$$('.ab-source')).length >= 8, 'about lists the sources');
check((await page.content()).includes('CC-CEDICT'), 'about credits CC-CEDICT');

// ------------------------------------------------------------------ mobile ---
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const [name, hash] of [['20-mobile-library', '#/'], ['21-mobile-settings', '#/settings'], ['22-mobile-about', '#/about']]) {
  await goto(hash);
  await sleep(900);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${name}: no horizontal overflow (${overflow}px)`);
  await shot(name, { fullPage: true });
}
await goto('#/settings');
await sleep(800);
await shot('21b-mobile-settings-top');
await page.evaluate(() => document.querySelector('.set-prov-wrap').scrollIntoView());
await shot('21c-mobile-settings-translation');
await goto('#/');
await page.evaluate(() => [...document.querySelectorAll('.lib-actions .btn')].find((b) => b.textContent.includes('Paste')).click());
await page.waitForSelector('dialog.lib-dlg[open]');
await shot('23-mobile-paste');

check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 5).join(' / ') : ''}`);
await browser.close();
if (problems.length) { console.log(`\n${problems.length} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
