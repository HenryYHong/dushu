// Headless QA for the library, settings and about screens.
// Usage: start `npx vite --port 5182 --strictPort`, then `node scripts/qa-shell.mjs`.
// Writes screenshots to qa-out/shell/ and exits non-zero on console errors or failed checks.
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'qa-out', 'shell');
mkdirSync(out, { recursive: true });
const BASE = process.env.QA_URL ?? 'http://localhost:5182/';
const EPUB = join(homedir(), 'Downloads', '活着.epub');

const problems = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) problems.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, timeout: 90000,
  args: ['--no-first-run', '--no-default-browser-check'],
});
const page = await browser.newPage();
const errors = [];
let ignoreErrors = false;
page.on('console', (m) => { if (m.type() === 'error' && !ignoreErrors) errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => { if (!ignoreErrors) errors.push(`pageerror: ${e.message}`); });
page.on('requestfailed', (r) => { if (!ignoreErrors && !r.url().includes('hanzi')) errors.push(`requestfailed: ${r.url()}`); });

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
await page.waitForSelector('.lib-sample .btn-primary');
await page.evaluate(() => document.querySelector('.lib-sample .btn-primary').click());
await page.waitForFunction(() => location.hash.startsWith('#/read/'), { timeout: 15000 });
check(true, 'sample click imports and opens the reader');
ignoreErrors = true;
await goto('#/');
await page.waitForSelector('.lib-card');
ignoreErrors = false;

// Files through the real file input: a txt sample and 活着.
const input = await page.$('input[type=file]');
await input.uploadFile(join(root, 'public/samples/kong-yiji.txt'));
await page.waitForFunction(() => document.querySelectorAll('.lib-card').length >= 3, { timeout: 15000 });
if (existsSync(EPUB)) {
  await input.uploadFile(EPUB);
  await page.waitForFunction(() => [...document.querySelectorAll('.lib-card-title')].some((e) => e.textContent === '活着'), { timeout: 30000 });
  check(true, '活着.epub imports through the file input');
}
await sleep(500);
const titles = await page.$$eval('.lib-card-title', (els) => els.map((e) => e.textContent));
console.log('     books:', titles.join(' | '));
check(titles.length >= 4, `library has ${titles.length} books`);
const huoCover = await page.waitForFunction(() => {
  const c = [...document.querySelectorAll('.lib-card')].find((x) => x.querySelector('.lib-card-title')?.textContent === '活着');
  const img = c?.querySelector('img.lib-cover-img');
  return !!img && img.complete && img.naturalWidth > 0;
}, { timeout: 5000 }).then(() => true, () => false);
check(huoCover, '活着 shows its real cover image');

// Fake some reading progress so the Continue card and bars show.
await page.evaluate(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('dushu'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const books = await new Promise((res) => { const r = db.transaction('books').objectStore('books').getAll(); r.onsuccess = () => res(r.result); });
  const tx = db.transaction(['books', 'progress'], 'readwrite');
  books.forEach((b, i) => {
    if (b.title === '活着') { b.lastOpenedAt = Date.now(); tx.objectStore('progress').put({ bookId: b.id, chapter: 5, block: 40, percent: 0.37, updatedAt: Date.now() }); }
    else if (i % 2 === 0) { b.lastOpenedAt = Date.now() - 1e6; tx.objectStore('progress').put({ bookId: b.id, chapter: 0, block: 2, percent: i === 2 ? 1 : 0.12, updatedAt: Date.now() }); }
    tx.objectStore('books').put(b);
  });
  await new Promise((res) => { tx.oncomplete = res; });
});
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.lib-continue');
check((await text('.lib-continue-title')) === '活着', 'Continue card shows the most recently opened book');
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

// Claude key + test button without a key.
await page.type('.set-key', 'sk-ant-test-1234');
await sleep(500);
check((await page.evaluate(() => JSON.parse(localStorage.getItem('dushu.settings.v1')).claudeApiKey)) === 'sk-ant-test-1234', 'API key saved to settings');
await shot('12-settings-translation', { clip: undefined });
await page.$eval('.set-key', (e) => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });

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
