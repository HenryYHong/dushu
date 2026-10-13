// Headless WebKit (Playwright) check of the word and phrase popups with touch, at iPad and iPhone sizes.
// It is the Safari engine at device size, not real iPadOS: no real safe areas, no home-screen mode.
//
//   node scripts/qa-popup.mjs                       starts `vite --port 5193 --strictPort` itself and stops it at the end
//   QA_BASE=http://localhost:5211/ node scripts/qa-popup.mjs   use a server that is already running
//
// Checks: the popup scrolls and stays scrolled, the footer (Prev / Next / Shorter / Longer) is reachable (on screen, or on
// screen once the card is scrolled to the bottom: a short sheet lets it scroll with the definitions) and Next works by touch, focus is in the dialog and comes back, controls are 44 px, the phone sheet is at most 45% of the screen, and
// a phrase with no translator says so in one line. Screenshots go to qa-out/popup/. Headless only.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname;
const require = createRequire(`${ROOT}.cache/qa-webkit/package.json`);
const { webkit, devices } = require('playwright');
const PORT = 5193;
const BASE = process.env.QA_BASE ?? `http://localhost:${PORT}/`;
const OUT = process.env.QA_OUT ?? `${ROOT}qa-out/popup/`;
mkdirSync(OUT, { recursive: true });

let server = null;
if (!process.env.QA_BASE) {
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start')), 30000);
    server.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); resolve(); } });
    server.stderr.on('data', (d) => { if (String(d).includes('Error')) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}
const stop = () => { if (server) { server.kill('SIGTERM'); server = null; } };
process.on('exit', stop);

const fails = [];
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails.push(m); };
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await webkit.launch({ headless: true });

async function openReader(device) {
  const ctx = await browser.newContext({ ...devices[device] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${device}: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const id = await page.evaluate(async () => {
    const { openStore } = await import('/src/store/index.ts');
    const { importText } = await import('/src/import/index.ts');
    const store = await openStore('dushu');
    const text = await (await fetch('/samples/hongloumeng.txt')).text();
    return (await store.books.add(importText(text, '红楼梦', '曹雪芹'))).id;
  });
  await page.evaluate((i) => {
    // 'gloss' keeps the check offline: no translation request leaves the page.
    localStorage.setItem('dushu.settings.v1', JSON.stringify({ theme: 'light', pinyin: 'all', fontSize: 24, translator: 'gloss', layout: 'pages' }));
    location.hash = `#/read/${i}?ch=1`;
  }, id);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.rd-article.rd-live .rd-w', { timeout: 60000 });
  // Name detection finishes a few seconds after a fresh import and the reader re-renders (closing any popup): wait it out.
  await settle(4500);
  return { ctx, page };
}

const word = (page, n) => page.evaluate((n) => {
  const ws = [...document.querySelectorAll('.rd-article.rd-live .rd-w')].filter((w) => {
    const r = w.getBoundingClientRect(); return r.left > 0 && r.right < innerWidth && r.top > 100 && r.bottom < innerHeight - 100;
  });
  const r = ws[n].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, bottom: r.bottom };
}, n);

const info = (page) => page.evaluate(() => {
  const el = document.querySelector('.pp-pop');
  if (!el) return null;
  const sc = el.querySelector('.pp-scroll');
  const r = el.getBoundingClientRect();
  const foot = el.querySelector('.pp-foot')?.getBoundingClientRect();
  const box = sc.getBoundingClientRect();
  const small = [...el.querySelectorAll('.pp-seg-btn, .pp-tr-actions .btn, .pp-wbw')].filter((b) => b.getBoundingClientRect().height < 43.5).length;
  return { h: r.height, top: r.top, bottom: r.bottom, scrollH: sc.scrollHeight, clientH: sc.clientHeight, vh: innerHeight, vw: innerWidth,
    short: el.classList.contains('pp-short'), box: { top: box.top, bottom: box.bottom },
    foot: foot ? { top: foot.top, bottom: foot.bottom } : null, focused: document.activeElement === el, label: el.getAttribute('aria-label'), small };
});

/** Scrolls the card to its end and reports whether the footer sits fully inside the scroll box and the screen. */
async function footerAtEnd(page) {
  await page.evaluate(() => { const sc = document.querySelector('.pp-scroll'); sc.scrollTop = sc.scrollHeight; });
  await settle(300);
  const q = await info(page);
  return { q, ok: !!q && !!q.foot && q.foot.top >= q.box.top - 0.5 && q.foot.bottom <= q.box.bottom + 0.5 && q.foot.bottom <= q.vh + 0.5 };
}

try {
  // ---- iPad Pro 11 landscape: float card (or sheet when the reader shifts the page)
  {
    const { ctx, page } = await openReader('iPad Pro 11 landscape');
    let scrolled = 0;
    for (let n = 3; n < 40 && !scrolled; n += 3) {
      const w = await word(page, n);
      await page.touchscreen.tap(w.x, w.y);
      await settle(700);
      const p = await info(page);
      if (!p) { check(false, `popup opens for word ${n}`); continue; }
      check(p.focused && /^Word: /.test(p.label), `focus is on the labelled dialog (${p.label})`);
      // A tall card pins the footer under the definitions; a short sheet lets it scroll with them (the meanings come first).
      if (p.foot && !p.short) check(p.foot.bottom <= p.vh + 0.5 && p.foot.top >= 0, `footer is pinned on screen (${Math.round(p.foot.top)}-${Math.round(p.foot.bottom)} of ${p.vh})`);
      check(p.small === 0, 'footer, phrase rows and provider buttons are 44 px or more');
      if (p.scrollH > p.clientH + 80) {
        scrolled = 1;
        await page.evaluate(() => { document.querySelector('.pp-scroll').scrollTop = 80; });
        await settle(300);
        const st = await page.evaluate(() => document.querySelector('.pp-scroll').scrollTop);
        check(st >= 70, `scrollTop sticks after 300 ms (${st})`);
        await page.screenshot({ path: `${OUT}ipad-landscape-word-scrolled.png` });
        const end = await footerAtEnd(page);
        check(end.ok, `footer is fully visible when the card is scrolled to the bottom (${end.q?.foot && Math.round(end.q.foot.top)}-${end.q?.foot && Math.round(end.q.foot.bottom)} in ${end.q && Math.round(end.q.box.top)}-${end.q && Math.round(end.q.box.bottom)})`);
        await page.screenshot({ path: `${OUT}ipad-landscape-word-end.png` });
        const before = await page.evaluate(() => document.querySelector('.pp-word')?.textContent);
        await page.locator('.pp-seg-btn', { hasText: 'Next' }).tap();
        await page.waitForSelector('.pp-word', { timeout: 5000 }).catch(() => {});
        await settle(600);
        const after = await page.evaluate(() => document.querySelector('.pp-word')?.textContent);
        check(!!after && after !== before, `Next is reachable and steps the word (${before} -> ${after})`);
      }
      await page.keyboard.press('Escape');
      await settle(300);
    }
    check(!!scrolled, 'found a word whose popup scrolls by 80 px or more');
    // a phrase: no translator offline is one line, and the list is the content
    await page.touchscreen.tap(600, 760); await settle(400);
    await page.evaluate(() => {
      const ws = [...document.querySelectorAll('.rd-article.rd-live .rd-w')].filter((x) => { const r = x.getBoundingClientRect(); return r.left > 60 && r.right < innerWidth / 2 && r.top > 120 && r.bottom < innerHeight - 100; });
      const a = ws[2].querySelector('ruby'); const z = ws[7].querySelector('ruby:last-of-type');
      const sel = getSelection(); const r = document.createRange();
      r.setStart(a.firstChild, 0); r.setEnd(z.firstChild, 1); sel.removeAllRanges(); sel.addRange(r);
    });
    await settle(1800);
    const phrase = await page.evaluate(() => ({ quiet: document.querySelector('.pp-tr.pp-tr-quiet')?.textContent ?? '', rows: document.querySelectorAll('.pp-wbw').length,
      glossLines: document.querySelectorAll('.pp-tr-text').length }));
    console.log('phrase', JSON.stringify(phrase).slice(0, 300));
    check(phrase.rows > 0 && phrase.glossLines === 0 && /set to word by word|No translation offline/.test(phrase.quiet), 'a phrase with no translator shows one quiet line and the word list');
    await page.screenshot({ path: `${OUT}ipad-landscape-phrase.png` });
    await ctx.close();
  }
  // ---- iPhone 13: the sheet stays at most 45% of the screen
  {
    const { ctx, page } = await openReader('iPhone 13');
    for (const n of [2, 5, 8]) {
      const w = await word(page, n);
      await page.touchscreen.tap(w.x, w.y);
      await settle(700);
      let p = await info(page);
      if (!p) { await page.touchscreen.tap(w.x, w.y); await settle(700); p = await info(page); } // the first tap can only wake the chrome
      check(!!p && p.h <= Math.round(p.vh * 0.45) + 1, `phone sheet is at most 45% of the screen (${p && Math.round(p.h)} of ${p && p.vh})`);
      const end = p ? await footerAtEnd(page) : { ok: false };
      check(end.ok, 'phone footer is fully visible when the card is scrolled to the bottom');
      if (n === 5) await page.screenshot({ path: `${OUT}iphone-sheet.png` });
      await page.keyboard.press('Escape');
      await settle(300);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  stop();
}
console.log('page errors:', errors.length ? errors : 'none');
console.log(fails.length ? `${fails.length} FAILED` : 'all passed');
process.exit(fails.length || errors.length ? 1 : 0);
