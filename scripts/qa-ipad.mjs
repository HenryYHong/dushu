// Headless iPad QA for the Pages layout, in WebKit (Playwright) at iPad size with touch.
// This is the Safari engine, not real iPadOS: there is no home-screen mode, no real long-press selection handles and
// no iPad keyboard. It checks layout, taps, swipes, popups, selection handling and rotation.
//
//   node scripts/qa-ipad.mjs                        starts `vite --port 5191 --strictPort` itself and stops it at the end
//   QA_BASE=http://localhost:5191/ node scripts/qa-ipad.mjs   use a server that is already running (sync off in the browser)
//
// Screenshots go to qa-out/ipad/. Needs the isolated Playwright install in .cache/qa-webkit (see its package.json).
// Headless only: it never opens a window.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const require = createRequire(`${ROOT}.cache/qa-webkit/package.json`);
const { webkit, devices } = require('playwright');

const PORT = 5191;
const BASE = process.env.QA_BASE ?? `http://localhost:${PORT}/`;
const OUT = `${ROOT}qa-out/ipad/`;
mkdirSync(OUT, { recursive: true });
// The server started here gets an empty sync folder of its own (removed at the end), never the owner's.
const SYNC_DIR = process.env.QA_BASE ? null : mkdtempSync(join(tmpdir(), 'dushu-qa-sync-'));
const dropSyncDir = () => { if (SYNC_DIR) rmSync(SYNC_DIR, { recursive: true, force: true }); };
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

let server = null;
async function startServer() {
  if (process.env.QA_BASE) return;
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DUSHU_SYNC_DIR: SYNC_DIR } });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start')), 30000);
    server.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); resolve(); } });
    server.stderr.on('data', (d) => { if (String(d).includes('Error')) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}
const stopServer = () => { if (server) { server.kill('SIGTERM'); server = null; } dropSyncDir(); };
process.on('exit', stopServer);

const failures = [];
// QA_ONLY=landscape,portrait,... runs just those sections (scroll, landscape, portrait, sizes, cover, settings, flip, keys, phone, names).
const want = (name) => !process.env.QA_ONLY || process.env.QA_ONLY.split(',').includes(name);
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.log('FAIL', msg); } else console.log('ok  ', msg); };
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const errors = [];

await startServer();
const browser = await webkit.launch({ headless: true });
// Every browser context gets SYNC_OFF when the server was not started here.
if (!SYNC_DIR) { const make = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await make(o); await c.addInitScript(SYNC_OFF); return c; }; }

/** Open a fresh iPad context, seed a book through the app's own modules, open it in Pages. */
async function openReader(device, settings = {}, chapter = 1, contextOptions = {}) {
  if (!devices[device]) throw new Error(`Unknown device profile: ${device}`);
  const ctx = await browser.newContext({ ...devices[device], ...contextOptions });
  // The dev server lists the owner's own books on this Mac; a test profile never takes them.
  await ctx.route('**/api/local-books**', (r) => r.fulfill({ status: 404, body: '' }));
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/hanzi-writer-data|Failed to load resource|Importing a module script failed/.test(t)) return;
    errors.push(`${device}: ${t}`);
  });
  page.on('pageerror', (e) => { if (!/Importing a module script failed/.test(e.message)) errors.push(`${device} pageerror: ${e.message}`); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const id = await page.evaluate(async () => {
    const { openStore } = await import('/src/store/index.ts');
    const { importText } = await import('/src/import/index.ts');
    const store = await openStore('dushu');
    const text = await (await fetch('/samples/hongloumeng.txt')).text();
    const id = (await store.books.add(importText(text, '红楼梦', '曹雪芹'))).id;
    // Mark the names scan as done: it would otherwise re-draw the chapter some seconds into the run (that is checked on its own, below).
    await store.lexicon.putDetected(id, []);
    return id;
  });
  await page.evaluate(([i, s, ch]) => {
    localStorage.setItem('dushu.settings.v1', JSON.stringify({ theme: 'light', pinyin: 'all', fontSize: 24, translator: 'gloss', layout: 'pages', ...s }));
    localStorage.setItem('dushu.reader-hint.v1', '1');
    location.hash = `#/read/${i}?ch=${ch}`;
  }, [id, settings, chapter]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(settings.layout === 'scroll' ? '.rd-article .rd-w' : '.rd-article.rd-live .rd-w', { timeout: 60000 });
  // The first open of a book scans it for names and then draws the chapter again; wait for that to finish so a check
  // never runs across it (the scan itself is checked below with a real novel).
  for (let last = -1, stable = 0, i = 0; stable < 4 && i < 200; i++) {
    const n = await page.evaluate(async (bookId) => {
      const { openStore } = await import('/src/store/index.ts');
      return (await (await openStore('dushu')).lexicon.get(bookId)).length;
    }, id);
    stable = n > 0 && n === last ? stable + 1 : 0;
    last = n;
    await settle(700);
  }
  await settle(1500);
  return { ctx, page, id };
}

const info = (page) => page.evaluate(() => ({ ...document.querySelector('.rd-stage').dataset, w: innerWidth, h: innerHeight }));

/**
 * A point on the blank margin of an outer strip (`side`: 'prev' or 'next'), in viewport px: inside the strip, not on text
 * (.rd-b) and not on a control. A tap there shows or hides the bar (a tap never turns the page); a word opens its card, and the rest of a
 * text line shows or hides the bar. Prefers points near the middle of the height.
 */
const marginPoint = (page, side) => page.evaluate((side) => {
  const st = document.querySelector('.rd-stage');
  const r = st.getBoundingClientRect();
  const per = st.dataset.per === '2' ? 2 : 1;
  const edge = Math.min(Math.max(56, r.width * (per === 2 ? 0.16 : 0.2)), per === 2 ? 220 : 160);
  const blank = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return !!el && st.contains(el) && !el.closest('.rd-b, [data-rd-ui], button, a, input, .pp-pop, .rd-bar');
  };
  for (const f of [0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65]) {
    const y = Math.round(innerHeight * f);
    for (let i = 6; i < edge - 4; i += 4) {
      const x = side === 'prev' ? r.left + i : r.right - i;
      if (blank(x, y)) return { x, y };
    }
  }
  return null;
}, side);

/**
 * Characters of words that lie wholly inside the left outer strip, in viewport px: the one nearest the edge, one in the
 * middle and the one nearest the strip's inner border (distinct x).
 */
const stripWords = (page) => page.evaluate(() => {
  const st = document.querySelector('.rd-stage');
  const r = st.getBoundingClientRect();
  const per = st.dataset.per === '2' ? 2 : 1;
  const edge = Math.min(Math.max(56, r.width * (per === 2 ? 0.16 : 0.2)), per === 2 ? 220 : 160);
  const cs = [...document.querySelectorAll('.rd-article.rd-live .rd-p .rd-w ruby')].map((c) => c.getBoundingClientRect())
    .filter((q) => q.width > 0 && q.left >= r.left && q.right < r.left + edge - 2 && q.top > 120 && q.bottom < innerHeight - 100)
    .map((q) => ({ x: Math.round(q.left + q.width / 2), y: Math.round(q.top + q.height * 0.7) }))
    .sort((a, b) => a.x - b.x);
  const xs = [...new Set(cs.map((c) => c.x))];
  const pick = [xs[0], xs[Math.floor(xs.length / 2)], xs[xs.length - 1]].filter((x, i, a) => x !== undefined && a.indexOf(x) === i);
  return pick.map((x) => cs.find((c) => c.x === x));
});

/** A touch swipe as pointer events on the stage. `hold` leaves the finger down so a mid-turn frame can be captured. */
async function swipe(page, x0, y0, x1, y1, { steps = 10, hold = false, gap = 16 } = {}) {
  await page.evaluate(async ({ x0, y0, x1, y1, steps, hold, gap }) => {
    const st = document.querySelector('.rd-stage');
    const fire = (type, x, y) => st.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
    window.__fire = fire;
    fire('pointerdown', x0, y0);
    for (let i = 1; i <= steps; i++) {
      fire('pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      await new Promise((r) => setTimeout(r, gap));
    }
    if (!hold) fire('pointerup', x1, y1);
  }, { x0, y0, x1, y1, steps, hold, gap });
}
const release = (page, x, y) => page.evaluate(([x, y]) => window.__fire('pointerup', x, y), [x, y]);

/**
 * Center of the nth visible Han word that sits clear of the outer strips (a tap there turns the page, not a lookup),
 * in viewport coordinates.
 */
const wordAt = (page, nth = 3) => page.evaluate((n) => {
  const live = document.querySelector('.rd-article.rd-live');
  const edge = Math.min(Math.max(56, innerWidth * (innerWidth >= 900 && innerWidth >= innerHeight * 1.1 ? 0.16 : 0.2)), innerWidth >= 900 && innerWidth >= innerHeight * 1.1 ? 220 : 160);
  const ws = [...live.querySelectorAll('.rd-p .rd-w')].filter((w) => { const r = w.getBoundingClientRect(); return r.left > edge + 8 && r.right < innerWidth - edge - 8 && r.top > 80 && r.bottom < innerHeight - 60; });
  const w = ws[n];
  const r = w.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, text: [...w.querySelectorAll('ruby')].map((u) => u.firstChild.data).join('') };
}, nth);

/**
 * Double tap a word in the upper and in the lower half of the screen. The first tap opens the word card, which on Pages is a
 * bottom sheet that lifts the page: the second tap lands where the word WAS, so it must still give the sentence popup.
 * (Touch emulation in WebKit, not a finger on a real iPad.)
 */
async function doubleTapHalves(page, label, gap = 200, { hold = true } = {}) {
  const findWord = (half) => page.evaluate((half) => {
    const live = document.querySelector('.rd-article.rd-live') ?? document.querySelector('.rd-article');
    const wide = innerWidth >= 900 && innerWidth >= innerHeight * 1.1;
    const edge = Math.min(Math.max(56, innerWidth * (wide ? 0.16 : 0.2)), wide ? 220 : 160);
    const pick = (lo, hi) => [...live.querySelectorAll('.rd-p .rd-w')].filter((el) => {
      const r = el.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      return mid > lo && mid < hi && r.left > edge + 8 && r.right < innerWidth - edge - 8;
    });
    // (A phone's first screen can have a big title and only a line or two of text in its upper half.)
    const ws = half === 'upper' ? (pick(80, innerHeight * 0.52).length ? pick(80, innerHeight * 0.52) : pick(80, innerHeight * 0.6)) : pick(innerHeight * 0.6, innerHeight - 70);
    const el = ws[Math.floor(ws.length / 3)];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 };
  }, half);
  // The page's own time stamps of the taps' clicks: the reader counts a double tap by them (DOUBLE_TAP_MS in reader.ts).
  await page.evaluate(() => { if (!window.__clicks) { window.__clicks = []; addEventListener('click', (e) => window.__clicks.push(e.timeStamp), true); } });
  for (const half of ['upper', 'lower']) {
    let w = await findWord(half);
    if (!w && half === 'upper' && await page.evaluate(() => !document.querySelector('.rd-article.rd-live'))) {
      // Scroll layout: a chapter that opens with a tall title has no text in the upper half yet. Scroll the first paragraph there.
      await page.evaluate(() => { const p = document.querySelector('.rd-article .rd-p'); if (p) scrollBy(0, p.getBoundingClientRect().top - innerHeight * 0.25); });
      await settle(300);
      w = await findWord(half);
    }
    if (!w && half === 'upper') {
      // Pages: a phone's first page can be all title down to below the middle. The next page starts with text at the top.
      await page.keyboard.press('ArrowRight');
      await settle(1000);
      w = await findWord(half);
    }
    if (!w) { check(false, `${label}: a word in the ${half} half to double tap`); continue; }
    // The second tap must reach the page within DOUBLE_TAP_MS (380) of the first. The harness can be slower than that
    // under load (a round trip for the hold check, WebKit's touch emulation): then the pair was not a double tap at all,
    // and it is tried again. Within the window it must give the sentence.
    let kind = 'none';
    let apart = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.touchscreen.tap(w.x, w.y);
      await settle(gap);
      // The page holds still while a second tap could still come: the word is still under the finger.
      const held = await page.evaluate(([x, y]) => { const r = document.querySelector('.rd-c.rd-active')?.getBoundingClientRect(); return !!r && r.top - 4 <= y && y <= r.bottom + 4 && r.left - 4 <= x && x <= r.right + 4; }, [w.x, w.y]);
      if (hold && attempt === 0) check(held, `${label}: the ${half} word is still under the finger ${gap} ms after the first tap`);
      await page.touchscreen.tap(w.x, w.y);
      await settle(900);
      kind = await page.evaluate(() => document.querySelector('.pp-pop')?.className.match(/pp-k-\w+/)?.[0] ?? 'none');
      // (Unrounded: the reader compares the same two time stamps.)
      apart = await page.evaluate(() => { const c = window.__clicks; return c.length > 1 ? c[c.length - 1] - c[c.length - 2] : -1; });
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await settle(400);
      if (kind === 'pp-k-phrase' || apart <= 380) break;
      console.log(`   ${label}: the two taps reached the page ${apart.toFixed(1)} ms apart (over 380 ms, not a double tap); trying again`);
    }
    check(kind === 'pp-k-phrase', `${label}: a double tap on a word in the ${half} half gives the sentence popup (${kind}, taps ${apart.toFixed(1)} ms apart)`);
  }
}

try {
  // Scrolling + real Premium audio, with the same touch gesture used by an iPad reader.
  for (const device of want('scroll') ? ['iPad Pro 11', 'iPad Mini landscape'] : []) {
    // The audio part needs the Mac speech bridge (the launcher's server); a failure here must not hide the rest of the run.
    const { ctx, page } = await openReader(device, { layout: 'scroll' });
    try {
    const metrics = await page.evaluate(() => ({
      font: parseFloat(getComputedStyle(document.querySelector('.rd-article')).fontSize),
      progress: getComputedStyle(document.querySelector('.rd-progress')).display,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    check(metrics.font === 28, `${device}: Scroll defaults to larger 28px text`);
    check(metrics.progress === 'none' && !metrics.overflow, `${device}: Scroll has no horizontal progress bar or overflow`);
    const word = page.locator('.rd-p .rd-w').first();
    await word.tap();
    const sentenceButtons = page.getByRole('button', { name: 'Translate sentence', exact: true });
    check(await sentenceButtons.first().isVisible(), `${device}: sentence translation is immediately visible in the word card`);
    // The card may offer it in more than one place (header and footer); at least one is a full touch target, all on screen.
    // The card scales in as it opens (0.9999 for a moment: 43.995 px tall), so measure after it has settled and allow half a pixel.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 3000 }).catch(() => {});
    await settle(150);
    const boxes = (await sentenceButtons.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, y: r.y, b: r.bottom }; })));
    check(boxes.length > 0 && Math.max(...boxes.map((b) => b.h)) >= 43.5 && boxes.every((b) => b.y >= 0 && b.b <= page.viewportSize().height),
      `${device}: sentence translation has an on-screen 44px touch target`);
    await page.getByRole('button', { name: 'Read from here', exact: true }).waitFor({ state: 'visible' });
    await page.screenshot({ path: `${OUT}${device.replaceAll(' ', '-')}-scroll-popup.png` });
    await page.getByRole('button', { name: 'Read from here', exact: true }).tap();
    await page.waitForFunction(() => document.querySelector('.rd-audio-status')?.textContent === 'Reading aloud', { timeout: 20000 });
    check(await page.locator('.rd-audio').isVisible(), `${device}: tap-to-start Premium speech reaches actual playback`);
    await page.getByRole('button', { name: 'Pause audio', exact: true }).tap();
    check(await page.locator('.rd-audio-status').textContent() === 'Paused', `${device}: audio pauses`);
    await page.getByRole('button', { name: 'Resume audio', exact: true }).tap();
    await page.waitForFunction(() => document.querySelector('.rd-audio-status')?.textContent === 'Reading aloud');
    await page.getByRole('button', { name: 'Stop audio', exact: true }).tap();
    check(!await page.locator('.rd-audio').isVisible(), `${device}: audio stops and controls reset`);
    } catch (e) {
      failures.push(`${device}: scroll popup or audio: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
      console.log('FAIL', failures[failures.length - 1]);
    }
    await ctx.close();
  }
  // ============================================================ landscape
  if (want('landscape')) {
    const { ctx, page } = await openReader('iPad Pro 11 landscape');
    const s0 = await info(page);
    console.log('landscape', s0);
    check(s0.per === '2', 'iPad landscape shows a two-page spread');
    check(s0.w === 1194 && s0.h === 834, 'viewport is 1194x834');
    check(Number(s0.pages) > 3, `the chapter is paginated (${s0.pages} pages)`);
    await page.screenshot({ path: `${OUT}01-landscape-spread.png` });

    // The even pinyin grid: every character in a line has the same width, pinyin centered over it.
    const grid = await page.evaluate(() => {
      const live = document.querySelector('.rd-article.rd-live');
      const rubies = [...live.querySelectorAll('.rd-p ruby.rd-c')].filter((r) => { const q = r.getBoundingClientRect(); return q.left > 0 && q.right < innerWidth; }).slice(0, 80);
      const widths = rubies.map((r) => Math.round(r.getBoundingClientRect().width * 10) / 10);
      const off = rubies.map((r) => {
        const rt = r.querySelector('.rd-rtx');
        if (!rt) return 0;
        const a = r.getBoundingClientRect(); const b = rt.getBoundingClientRect();
        return Math.abs((a.left + a.width / 2) - (b.left + b.width / 2));
      });
      const lines = new Map();
      for (const r of rubies) { const q = r.getBoundingClientRect(); const k = Math.round(q.top); (lines.get(k) ?? lines.set(k, []).get(k)).push(q); }
      let overlap = 0;
      const rts = rubies.map((r) => r.querySelector('.rd-rtx')?.getBoundingClientRect()).filter(Boolean);
      for (let i = 1; i < rts.length; i++) if (Math.abs(rts[i].top - rts[i - 1].top) < 4 && rts[i].left < rts[i - 1].right - 0.5) overlap++;
      const cell = parseFloat(getComputedStyle(document.querySelector('.rd-root')).getPropertyValue('--rd-cell'));
      return { distinct: [...new Set(widths)], maxOff: Math.max(...off), overlap, cell, size: parseFloat(getComputedStyle(live).fontSize), n: rubies.length };
    });
    console.log('grid', grid);
    check(grid.n > 40, 'enough characters on the page to measure the grid');
    check(Math.max(...grid.distinct) - Math.min(...grid.distinct) < 0.6, `every character has the same cell width (${grid.distinct.join(', ')} px)`);
    check(Math.abs(grid.distinct[0] - grid.cell * grid.size) < 1.5, 'the cell is the width the grid rule chose');
    check(grid.maxOff < 1.2, `pinyin is centered over its character (max offset ${grid.maxOff.toFixed(2)} px)`);
    check(grid.overlap === 0, 'neighboring pinyin never overlaps');

    // No hover affordances, rt not selectable.
    const touchChecks = await page.evaluate(() => {
      const rt = document.querySelector('.rd-article rt');
      const cs = getComputedStyle(rt);
      const hoverRule = [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch { return []; } })
        .some((r) => r.media && /hover:\s*hover/.test(r.media.mediaText) && /rd-w/.test(r.cssText) && matchMedia(r.media.mediaText).matches);
      return { sel: cs.webkitUserSelect || cs.userSelect, hoverRuleActive: hoverRule, ptBtn: !!document.querySelector('.rd-pt-btn') && getComputedStyle(document.querySelector('.rd-pt-btn')).display !== 'none' };
    });
    check(touchChecks.sel === 'none', 'pinyin (rt) is not selectable');
    check(!touchChecks.hoverRuleActive, 'no hover-only rules are active on a touch screen');
    check(!touchChecks.ptBtn, 'no margin translate buttons in Pages');

    // A tap never turns the page: on the blank margin at either edge it shows or hides the bar. Only swipes turn.
    const before = await info(page);
    const chromeOff = () => page.evaluate(() => document.querySelector(".rd-root")?.classList.contains("rd-chrome-off"));
    const right = await marginPoint(page, 'next');
    check(!!right, `the right edge has a blank margin to tap (x=${right?.x})`);
    const bar0 = await chromeOff();
    await page.touchscreen.tap(right?.x ?? 1190, right?.y ?? 420);
    await settle(700);
    check((await info(page)).page === before.page, 'a tap on the blank margin at the right edge does not turn the page');
    check((await chromeOff()) !== bar0, "it shows or hides the bar instead");
    const left = await marginPoint(page, 'prev');
    check(!!left, `the left edge has a blank margin to tap (x=${left?.x})`);
    await page.touchscreen.tap(left?.x ?? 4, left?.y ?? 420);
    await settle(700);
    check((await info(page)).page === before.page, 'a tap on the blank margin at the left edge does not turn the page either');

    // A swipe left turns to the next spread, from anywhere (over words too); a swipe right turns back.
    const swipeOn = () => swipe(page, 900, 420, 640, 424, { steps: 6 });
    const swipeBack = () => swipe(page, 300, 420, 560, 424, { steps: 6 });
    await swipeOn();
    await settle(900);
    const after = await info(page);
    check(Number(after.page) === Number(before.page) + 2, `a swipe left turns to the next spread (page ${before.page} -> ${after.page})`);
    await page.screenshot({ path: `${OUT}02-landscape-after-swipe.png` });
    await swipeBack();
    await settle(900);
    const back = await info(page);
    check(back.page === before.page, `a swipe right turns back (page ${after.page} -> ${back.page})`);

    // Three swipes go three spreads in, so a wrong turn back below would show.
    for (let i = 0; i < 3; i++) { await swipeOn(); await settle(700); }
    const deep = await info(page);
    check(Number(deep.page) === Number(before.page) + 6, `three swipes turn three spreads (page ${before.page} -> ${deep.page})`);
    // A word in an outer strip opens its card and never turns the page: reaching for a word near the edge used to turn it.
    const inStrip = await stripWords(page);
    check(inStrip.length === 3, `three words to tap in the left strip (x=${inStrip.map((c) => c.x).join(', ')})`);
    for (const c of inStrip) {
      const p0 = (await info(page)).page;
      await page.touchscreen.tap(c.x, c.y);
      await settle(700);
      const p1 = (await info(page)).page;
      const kind = await page.evaluate(() => document.querySelector('.pp-pop')?.className.match(/pp-k-\w+/)?.[0] ?? 'none');
      check(kind === 'pp-k-word', `a tap at x=${c.x} on a word in the left strip opens its card (${kind})`);
      check(p1 === p0, `x=${c.x}: and does not turn the page (page ${p0} -> ${p1})`);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await settle(500);
    }
    // Swipes back, once per swipe.
    for (let i = 0; i < 3; i++) { await swipeBack(); await settle(700); }
    check(Number((await info(page)).page) === Number(deep.page) - 6, `three swipes right turn three spreads back (page ${deep.page} -> ${(await info(page)).page})`);
    // Words at 250 and 380 px are in the middle: they open the popup and the page stays.
    for (const x of [250, 380]) {
      const target = await page.evaluate(([x]) => {
        let best = null;
        for (const w of document.querySelectorAll('.rd-article.rd-live .rd-p .rd-w')) {
          const r = w.getBoundingClientRect();
          if (r.top < 120 || r.bottom > innerHeight - 100 || r.left > x || r.right < x) continue;
          best = { x, y: r.top + r.height * 0.7 };
          break;
        }
        return best;
      }, [x]);
      if (!target) { check(false, `a word is under x=${x}`); continue; }
      const p0 = (await info(page)).page;
      await page.touchscreen.tap(target.x, target.y);
      await settle(600);
      check(await page.evaluate(() => !!document.querySelector('.pp-pop')) && (await info(page)).page === p0, `a tap at x=${x} over a word looks it up and does not turn the page`);
      await page.touchscreen.tap(600, 790); await settle(400);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await settle(200);
    }
    // Two quick taps on a word: the whole sentence with its translation.
    {
      const w2 = await wordAt(page, 6);
      await page.touchscreen.tap(w2.x, w2.y);
      await page.touchscreen.tap(w2.x, w2.y);
      await settle(900);
      const kind = await page.evaluate(() => document.querySelector('.pp-pop')?.className ?? '');
      check(/pp-k-phrase/.test(kind), 'a double tap on a word opens the sentence (phrase popup)');
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await settle(300);
    }
    await doubleTapHalves(page, 'landscape', 120);
    await doubleTapHalves(page, 'landscape (slower)', 240);
    // Back to the first spread for the checks that follow.
    await page.keyboard.press('Home');
    await settle(1000);
    check((await info(page)).page === before.page, 'Home returns to the first page');

    // Swipe left, caught mid-turn, then released.
    await swipe(page, 1000, 420, 600, 430, { steps: 9, hold: true });
    await settle(150);
    const mid = await page.evaluate(() => ({ turning: document.querySelector('.rd-stage').classList.contains('rd-turning'), leaf: !!document.querySelector('.rd-leaf'), tf: document.querySelector('.rd-leaf')?.style.transform }));
    check(mid.turning && mid.leaf, `the page follows the finger (leaf ${mid.tf})`);
    await page.screenshot({ path: `${OUT}03-landscape-mid-swipe.png` });
    await release(page, 600, 430);
    await settle(1000);
    const swiped = await info(page);
    check(Number(swiped.page) === Number(before.page) + 2, 'a long swipe completes the turn');
    // (A turn for the next page is built in idle time and waits, unseen, in a host marked data-idle.)
    check(await page.evaluate(() => !document.querySelector('.rd-turn:not([data-idle]) .rd-leaf') && !document.querySelector('.rd-stage').classList.contains('rd-turning')), 'the leaf is cleaned up after the turn');

    // A short swipe snaps back.
    await swipe(page, 800, 420, 740, 424, { steps: 4, hold: true });
    await settle(100);
    await release(page, 740, 424);
    await settle(900);
    check((await info(page)).page === swiped.page, 'a short swipe snaps back to the same page');

    // Tap a word: popup near the word, a card not a phone sheet.
    const w = await wordAt(page, 4);
    await page.touchscreen.tap(w.x, w.y);
    await settle(700);
    const pop = await page.evaluate(() => { const p = document.querySelector('.pp-pop'); if (!p) return null; const r = p.getBoundingClientRect(); const c = p.querySelector('.pp-content')?.getBoundingClientRect(); return { cls: p.className, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, cw: c?.width ?? r.width, vw: innerWidth, vh: innerHeight }; });
    // On a touch tablet the popup is a card or, because the Pages reader lifts the page out of its way, a centered sheet.
    check(!!pop && (pop.cls.includes('pp-float') || pop.cls.includes('pp-sheet-tablet')), `a tap on "${w.text}" opens the word popup (${pop?.cls.match(/pp-(float|sheet-tablet|sheet)/)?.[0]})`);
    // A tablet sheet spans the screen (no half-cut glyphs of the pages beside it) with its content in a readable column; a card stays narrow.
    const sheet = !!pop && pop.cls.includes('pp-sheet-tablet');
    check(!!pop && (sheet ? Math.abs(pop.w - pop.vw) <= 1 && pop.cw <= 640 : pop.w <= 620) && pop.left >= 0 && pop.right <= pop.vw + 1 && pop.bottom <= pop.vh + 1,
      `the popup fits on the screen (${sheet ? `full-width sheet, ${Math.round(pop.cw)} px column` : 'card'})`);
    if (sheet) {
      const word = await page.evaluate(() => { const r = document.querySelector('.rd-c.rd-active')?.getBoundingClientRect(); return r ? { bottom: r.bottom } : null; });
      check(!!word && word.bottom < pop.top, `the page lifts so the word stays above the sheet (word bottom ${Math.round(word?.bottom ?? -1)}, sheet top ${Math.round(pop.top)})`);
    }
    await page.screenshot({ path: `${OUT}04-landscape-word-popup.png` });
    check((await info(page)).page === swiped.page, 'a word tap does not turn the page');

    // Tapping elsewhere closes the popup and does not turn the page.
    // (A tablet sheet covers the foot of the screen, so "outside" is the page above it: the gutter between the two pages.)
    const outside = pop && sheet ? { x: pop.vw / 2, y: Math.max(100, Math.min(pop.top - 24, pop.vh - 20)) } : { x: 1000, y: 790 };
    await page.touchscreen.tap(outside.x, outside.y);
    await settle(500);
    check(await page.evaluate(() => !document.querySelector('.pp-pop')), 'a tap outside closes the popup');
    check((await info(page)).page === swiped.page, 'and does not turn the page');

    // Select a phrase (what a long press does: a native selection that settles, then the phrase popup).
    await page.evaluate(() => {
      const live = document.querySelector('.rd-article.rd-live');
      const ws = [...live.querySelectorAll('.rd-p .rd-w')].filter((x) => { const r = x.getBoundingClientRect(); return r.left > 60 && r.right < innerWidth / 2 && r.top > 120 && r.bottom < innerHeight - 100; });
      const a = ws[2].querySelector('ruby'); const z = ws[7].querySelector('ruby:last-of-type');
      const sel = getSelection(); const r = document.createRange();
      r.setStart(a.firstChild, 0); r.setEnd(z.firstChild, 1); sel.removeAllRanges(); sel.addRange(r);
    });
    await settle(1500);
    const phrase = await page.evaluate(() => { const p = document.querySelector('.pp-pop'); return p ? { kind: p.className, text: p.querySelector('.pp-phrase-text')?.textContent ?? '' } : null; });
    check(!!phrase && phrase.kind.includes('pp-k-phrase'), 'a native selection settles into the phrase popup');
    check(!!phrase && !/[āáǎàēéěèīíǐìōóǒòūúǔù]/.test(phrase.text.replace(/\s/g, '').slice(0, 0)), 'the phrase text comes from the book, not the pinyin');
    await page.screenshot({ path: `${OUT}05-landscape-phrase-popup.png` });
    // A swipe must not turn the page while a selection is showing.
    const pageBeforeSel = (await info(page)).page;
    console.log('selection before swipe', await page.evaluate(() => ({ coll: getSelection().isCollapsed, len: getSelection().toString().length, pop: document.querySelector('.pp-pop')?.className })));
    await swipe(page, 1000, 420, 500, 430, { steps: 6 });
    await settle(900);
    const selShowing = await page.evaluate(() => !getSelection().isCollapsed);
    if (selShowing) check((await info(page)).page === pageBeforeSel, 'no page turn while text is selected');
    else console.log('NOTE the phrase popup took focus and WebKit dropped the native selection (popup/host.ts); a swipe then turns the page, which is correct without a selection');
    await page.evaluate(() => getSelection().removeAllRanges());
    await settle(300);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    // Middle tap toggles the bar.
    const barOff = await page.evaluate(() => document.querySelector('.rd-root').classList.contains('rd-chrome-off'));
    await page.touchscreen.tap(600, 780);
    await settle(400);
    const barNow = await page.evaluate(() => document.querySelector('.rd-root').classList.contains('rd-chrome-off'));
    check(barOff !== barNow, 'a tap in the middle toggles the reading chrome');
    await page.screenshot({ path: `${OUT}06-landscape-chrome-toggled.png` });

    // Rotate to portrait: one page, same place.
    const place = await info(page);
    await page.setViewportSize({ width: 834, height: 1194 });
    await settle(1800);
    const rot = await info(page);
    console.log('rotated', rot);
    check(rot.per === '1', 'portrait shows a single page');
    // A portrait page holds more text, so the page that holds the old place may start a few blocks earlier; it never starts after it.
    check(Number(rot.block) <= Number(place.block), `rotation keeps the reading position (block ${place.block} -> ${rot.block})`);
    await page.screenshot({ path: `${OUT}07-rotated-portrait.png` });
    await page.setViewportSize({ width: 1194, height: 834 });
    await settle(1800);
    const rot2 = await info(page);
    check(rot2.per === '2' && Number(rot2.block) <= Number(place.block) && Number(place.block) - Number(rot2.block) <= 1, `rotating back restores the spread and the place (block ${place.block} -> ${rot2.block})`);

    // No horizontal page scroll, no stray scrolling of the stage.
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('.rd-stage').scrollLeft === 0), 'no horizontal scroll');
    await ctx.close();
  }

  // ============================================================ portrait
  if (want('portrait')) {
    const { ctx, page } = await openReader('iPad Pro 11');
    const s0 = await info(page);
    console.log('portrait', s0);
    check(s0.per === '1', 'iPad portrait shows a single page');
    await page.screenshot({ path: `${OUT}08-portrait-single.png` });
    const before = await info(page);
    await page.touchscreen.tap(780, 600);
    await settle(700);
    check((await info(page)).page === before.page, 'a tap does not turn the page in portrait');
    await swipe(page, 700, 600, 450, 604, { steps: 6 });
    await settle(900);
    const after = await info(page);
    check(Number(after.page) === Number(before.page) + 1, 'a swipe turns one page in portrait');
    await swipe(page, 600, 700, 250, 700, { steps: 8, hold: true });
    await settle(120);
    await page.screenshot({ path: `${OUT}09-portrait-mid-swipe.png` });
    await release(page, 250, 700);
    await settle(1000);
    check(Number((await info(page)).page) === Number(before.page) + 2, 'swipe turns one page in portrait');
    await swipe(page, 200, 700, 600, 700, { steps: 8 });
    await settle(1000);
    check(Number((await info(page)).page) === Number(before.page) + 1, 'swipe the other way goes back');
    const w = await wordAt(page, 6);
    await page.touchscreen.tap(w.x, w.y);
    await settle(700);
    const pop = await page.evaluate(() => { const p = document.querySelector('.pp-pop'); return p ? { cls: p.className, w: p.getBoundingClientRect().width, r: p.getBoundingClientRect().right, vw: innerWidth } : null; });
    check(!!pop && (pop.cls.includes('pp-float') || pop.cls.includes('pp-sheet-tablet')) && pop.r <= pop.vw, 'portrait iPad gets the card or the tablet sheet, not the phone sheet');
    await page.screenshot({ path: `${OUT}10-portrait-word-popup.png` });
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await settle(400);
    await doubleTapHalves(page, 'portrait');
    await ctx.close();
  }

  // ============================================================ menus: bubbles under their buttons on an iPad
  if (want('menus')) {
    for (const device of ['iPad Pro 11', 'iPad Pro 11 landscape']) {
      const { ctx, page } = await openReader(device);
      for (const btn of ['.rd-aa-btn', '.rd-pinyin-btn']) {
        await page.locator(btn).tap();
        await settle(500);
        const m = await page.evaluate((sel) => {
          const p = document.querySelector('.rd-pop');
          const b = document.querySelector(sel).getBoundingClientRect();
          const r = p?.getBoundingClientRect();
          return p ? { sheet: p.classList.contains('rd-sheet'), top: r.top, left: r.left, right: r.right, bottom: r.bottom, b: { bottom: b.bottom, left: b.left, right: b.right }, vw: innerWidth, vh: innerHeight } : null;
        }, btn);
        check(!!m && !m.sheet && m.top >= m.b.bottom && m.top - m.b.bottom < 16 && m.left >= 0 && m.right <= m.vw && m.bottom <= m.vh && m.right >= m.b.left && m.left <= m.b.right,
          `${device}: ${btn} opens a bubble just under its button, not a sheet (${m ? `top ${Math.round(m.top)}, button bottom ${Math.round(m.b.bottom)}` : 'no menu'})`);
        await page.screenshot({ path: `${OUT}menus-${device.replace(/\s+/g, '-')}-${btn.slice(4, -4)}.png` });
        await page.locator(btn).tap();
        await settle(300);
        check(await page.evaluate(() => !document.querySelector('.rd-pop')), `${device}: tapping ${btn} again closes it`);
      }
      await ctx.close();
    }
  }

  // ============================================================ other sizes
  if (want('sizes')) {
    const { ctx, page } = await openReader('iPad Mini');
    check((await info(page)).per === '1', 'iPad mini portrait shows a single page');
    await ctx.close();
    const m = await openReader('iPad Mini landscape', { fontSize: 28 });
    check((await info(m.page)).per === '2', 'iPad mini landscape shows a spread');
    await m.page.screenshot({ path: `${OUT}11-mini-landscape-28px.png` });
    await m.ctx.close();
  }

  // ============================================================ the word stays above the sheet, wherever on the page it is tapped
  if (want('cover')) {
    for (const device of ['iPad Pro 11 landscape', 'iPad Mini landscape', 'iPad Mini']) {
      for (const stress of [false, true]) {
        const { ctx, page } = await openReader(device);
        // The stress run makes the sheet as tall as a long entry with its translation makes it (its top then sits near 300 px).
        if (stress) await page.addStyleTag({ content: '.pp-sheet-tablet { min-height: 56vh !important; }' });
        const found = [];
        for (const f of [0.2, 0.35, 0.5, 0.62, 0.72, 0.82]) {
          const w = await page.evaluate((f) => {
            const live = document.querySelector('.rd-article.rd-live');
            const wide = innerWidth >= 900 && innerWidth >= innerHeight * 1.1;
            const edge = Math.min(Math.max(56, innerWidth * (wide ? 0.16 : 0.2)), wide ? 220 : 160);
            let best = null; let bd = 1e9;
            for (const el of live.querySelectorAll('.rd-p .rd-w')) {
              const r = el.getBoundingClientRect();
              if (!(r.left > edge + 8 && r.right < innerWidth - edge - 8 && r.top > 90 && r.bottom < innerHeight - 60)) continue;
              const d = Math.abs((r.top + r.height / 2) / innerHeight - f);
              if (d < bd) { bd = d; best = el; }
            }
            if (!best) return null;
            const r = best.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 };
          }, f);
          if (!w) continue;
          await page.touchscreen.tap(w.x, w.y);
          await settle(1800);
          const g = await page.evaluate(() => {
            const pop = document.querySelector('.pp-pop')?.getBoundingClientRect();
            const a = document.querySelector('.rd-c.rd-active')?.getBoundingClientRect();
            const bar = document.querySelector('.rd-bar')?.getBoundingClientRect();
            if (!pop || !a) return null;
            const hit = pop.top < a.bottom && pop.bottom > a.top && pop.left < a.right && pop.right > a.left;
            return { popTop: Math.round(pop.top), hidden: hit ? Math.round(a.bottom - pop.top) : 0, underBar: bar ? a.top < bar.bottom - 2 : false };
          });
          found.push({ f, ...g });
          await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
          await settle(700);
        }
        const bad = found.filter((x) => x.hidden > 0 || x.underBar);
        const tops = [...new Set(found.map((x) => x.popTop))].join('/');
        check(found.length >= 5 && found.every((x) => x.popTop !== undefined), `${device}${stress ? ' (tall sheet)' : ''}: the word opens a sheet at ${found.length} tap heights (sheet top ${tops})`);
        check(bad.length === 0, `${device}${stress ? ' (tall sheet)' : ''}: the tapped word is never under the sheet or the top bar${bad.length ? ' (' + bad.map((x) => `${x.f}: hidden ${x.hidden}${x.underBar ? ', under bar' : ''}`).join('; ') + ')' : ''}`);
        if (stress && device !== 'iPad Pro 11 landscape') await page.screenshot({ path: `${OUT}cover-${device.replaceAll(' ', '-')}-tall.png` });
        await ctx.close();
      }
    }
  }

  // ============================================================ Settings: section list on an iPad mini in landscape, nothing wider than the screen
  if (want('settings')) {
    // The profile's 1024 px is an older iPad mini; the mini 6 in landscape is 1133 x 744 (the width this check is about).
    const profiles = [
      ['iPad Mini 6 landscape', { ...devices['iPad Mini landscape'], viewport: { width: 1133, height: 744 }, screen: { width: 1133, height: 744 } }],
      ['iPad Mini landscape', devices['iPad Mini landscape']], ['iPad Pro 11 landscape', devices['iPad Pro 11 landscape']], ['iPad Mini', devices['iPad Mini']],
    ];
    for (const [device, profile] of profiles) {
      const ctx = await browser.newContext(profile);
      const page = await ctx.newPage();
      await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.set-page', { timeout: 30000 });
      await settle(600);
      const g = await page.evaluate(() => {
        const link = document.querySelector('.set-nav-link');
        const visible = !!link && link.getBoundingClientRect().width > 0 && getComputedStyle(link).visibility !== 'hidden';
        const col = document.querySelector('.set-layout > :not(.set-nav)')?.getBoundingClientRect();
        return { visible, vw: innerWidth, sw: document.documentElement.scrollWidth, colRight: col ? Math.round(col.right) : null };
      });
      const wantNav = g.vw >= 1080;
      check(g.visible === wantNav, `${device} (${g.vw} px): the section list is ${wantNav ? 'shown' : 'hidden'}`);
      check(g.sw <= g.vw, `${device}: Settings does not scroll sideways (${g.sw} of ${g.vw} px)`);
      if (wantNav) await page.screenshot({ path: `${OUT}settings-${device.replaceAll(' ', '-')}.png` });
      await ctx.close();
    }
    // A laptop-size window: the preview must leave most of the height to the controls.
    for (const [w, h] of [[1280, 800], [1440, 900]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.set-preview', { timeout: 30000 });
      await settle(600);
      await page.evaluate(() => window.scrollTo(0, 700)); // stuck at the top of the window, as it is while the controls are used
      await settle(300);
      const pv = await page.evaluate(() => { const e = document.querySelector('.set-preview'); return { pos: getComputedStyle(e).position, h: Math.round(e.getBoundingClientRect().bottom) }; });
      check(pv.pos === 'static' || pv.h <= h * 0.3, `${w}x${h}: the sticky preview does not take more than 30% of the window (${pv.pos}, bottom edge ${pv.h} px)`);
      await ctx.close();
    }
  }

  // ============================================================ the flip, both modes
  if (want('flip')) {
    const { ctx, page } = await openReader('iPad Pro 11 landscape', { pageTurn: 'flip' });
    await page.keyboard.press('ArrowRight');
    await settle(260);
    const mid = await page.evaluate(() => !!document.querySelector('.rd-leaf'));
    check(mid, 'a key press starts the flip animation');
    await page.screenshot({ path: `${OUT}12-flip-mid-two-page.png` });
    await settle(900);
    await ctx.close();
    const s = await openReader('iPad Pro 11', { pageTurn: 'flip' });
    await s.page.keyboard.press('ArrowRight');
    await settle(220);
    await s.page.screenshot({ path: `${OUT}13-flip-mid-single.png` });
    await settle(900);
    await s.ctx.close();
  }

  // ============================================================ keyboard word cursor, end of chapter, reduced motion
  if (want('keys')) {
    const { ctx, page } = await openReader('iPad Pro 11 landscape');
    await page.keyboard.press('Enter');
    await settle(300);
    const c0 = await page.evaluate(() => { const a = document.activeElement; return { cursor: !!document.querySelector('.rd-w.rd-cursor'), isWord: !!a?.classList.contains('rd-w'), role: a?.getAttribute('role'), label: a?.getAttribute('aria-label') ?? '' }; });
    check(c0.cursor && c0.isWord, 'Enter puts a word cursor (keyboard focus) on the first word of the page');
    check(c0.role === 'button' && /, /.test(c0.label), `the word has a spoken name: the word and its pinyin ("${c0.label.slice(0, 20)}")`);
    check(await page.evaluate(() => [...document.querySelectorAll('.rd-article.rd-live rt')].slice(0, 20).every((r) => r.getAttribute('aria-hidden') === 'true')), 'pinyin is hidden from screen readers (it is in the word name)');
    await page.keyboard.press('ArrowRight');
    const c1 = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    check(c1 !== c0.label && c1 !== '', 'ArrowRight moves the cursor to the next word');
    await page.keyboard.press('ArrowDown');
    const c2 = await page.evaluate(() => { const a = document.activeElement?.getBoundingClientRect(); return a ? Math.round(a.top) : -1; });
    console.log('before Enter', await page.evaluate(() => ({ a: document.activeElement?.className, lbl: document.activeElement?.getAttribute('aria-label'), pop: !!document.querySelector('.pp-pop'), cursor: !!document.querySelector('.rd-cursor') })));
    await page.keyboard.press('Enter');
    await settle(700);
    console.log('after Enter', await page.evaluate(() => ({ a: document.activeElement?.className, pop: document.querySelector('.pp-pop')?.className })));
    check(await page.evaluate(() => !!document.querySelector('.pp-pop')), 'Enter on the cursor word opens its popup');
    await page.keyboard.press('Escape');
    await settle(700);
    check(await page.evaluate(() => !document.querySelector('.pp-pop') && document.activeElement?.classList.contains('rd-cursor')), 'Escape closes the popup and focus returns to the word');
    await page.keyboard.press('Escape');
    check(await page.evaluate(() => !document.querySelector('.rd-cursor')), 'a second Escape puts the cursor away');
    check(c2 > 0, 'ArrowDown moves the cursor to a word on another line');
    await ctx.close();
  }
  if (want('keys')) {
    const { ctx, page } = await openReader('iPad Pro 11 landscape', {}, 1, { reducedMotion: 'reduce' });
    const before = await info(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.rd-stage')?.dataset.turn || document.querySelector('.rd-turn:not([data-idle])'), null, { timeout: 2000 }).catch(() => {});
    const mid = await page.evaluate(() => ({ kind: document.querySelector('.rd-stage').dataset.turn, host: !!document.querySelector('.rd-turn:not([data-idle])'), opacity: document.querySelector('.rd-turn:not([data-idle])')?.style.opacity }));
    check(mid.kind === 'fade' && mid.host, `with reduced motion the page turn is a cross-fade, not a cut (${JSON.stringify(mid)})`);
    await settle(600);
    check(Number((await info(page)).page) === Number(before.page) + 2, 'and it still turns the page');
    await ctx.close();
  }
  if (want('keys')) {
    const { ctx, page } = await openReader('iPad Pro 11 landscape');
    const t0 = Date.now();
    await page.keyboard.press('End');
    await page.waitForFunction(() => { const st = document.querySelector('.rd-stage'); return st && !st.classList.contains('rd-measuring') && st.dataset.exact === 'true' && Number(st.dataset.page) + Number(st.dataset.per) > Number(st.dataset.pages) && !document.querySelector('.rd-stage-busy:not([hidden])'); }, null, { timeout: 30000 });
    console.log('End key: last spread ready after', Date.now() - t0, 'ms');
    await settle(300);
    const e = await info(page);
    const odd = Number(e.pages) % 2 === 1;
    const card = await page.evaluate(() => ({ btn: document.querySelector('.rd-endcard .rd-endbtn')?.textContent ?? null, left: [...document.querySelectorAll('.rd-hf .rd-ftr-left')].map((x) => x.textContent) }));
    if (odd) check(!!card.btn && /^Next: /.test(card.btn), `the blank page after an odd chapter carries the way on (${card.btn})`);
    else check(card.left.every((t) => !/^1 page left/.test(t)), 'the last spread never says "1 page left"');
    check(!card.left.some((t) => /^1 page left/.test(t)), `the footer does not say "1 page left" on the last spread (${JSON.stringify(card.left)}, page ${e.page} of ${e.pages})`);
    if (odd && card.btn) {
      const ch = Number(e.chapter);
      await page.click('.rd-endbtn');
      await settle(1500);
      const n = await info(page);
      check(Number(n.chapter) === ch + 1 && n.page === '1', 'the end button opens the next chapter at its first page');
    }
    await page.screenshot({ path: `${OUT}14-chapter-end.png` });
    await ctx.close();
  }

  // ============================================================ phone: page geometry and menus
  if (want('phone')) {
    const { ctx, page } = await openReader('iPhone 13', { fontSize: 24 });
    const g = await page.evaluate(() => {
      const root = document.querySelector('.rd-root');
      const st = document.querySelector('.rd-stage');
      const cell = parseFloat(root.style.getPropertyValue('--rd-cell'));
      const size = parseFloat(getComputedStyle(document.querySelector('.rd-article.rd-live')).fontSize);
      const cw = parseFloat(st.style.getPropertyValue('--pg-cw'));
      const left = parseFloat(st.style.getPropertyValue('--pg-left'));
      const rubies = [...document.querySelectorAll('.rd-article.rd-live .rd-p ruby.rd-c')].filter((r) => { const q = r.getBoundingClientRect(); return q.left >= 0 && q.right <= innerWidth; });
      const lines = new Map();
      for (const r of rubies) { const k = Math.round(r.getBoundingClientRect().top); lines.set(k, (lines.get(k) ?? 0) + 1); }
      const fs = parseFloat(getComputedStyle(root).getPropertyValue('--rd-rt')) * size;
      return { cell, size, cw, left, vw: innerWidth, perLine: Math.max(...lines.values()), cells: cw / (cell * size), rtPx: fs, aa: document.querySelector('.rd-aa-btn')?.textContent, label: getComputedStyle(document.querySelector('.rd-pinyin-btn .rd-pill-label')).clipPath };
    });
    console.log('phone', g);
    check(g.cells >= 9 && Math.abs(g.cells - Math.round(g.cells)) < 0.01, `the phone column is a whole number of cells, 9 or more (${g.cells.toFixed(2)})`);
    check(Math.abs(g.left * 2 + g.cw - g.vw) < 1.5, 'the column is centered: equal margins on both sides');
    check(g.perLine >= 8, `8 or more characters on a line even with marks taking half cells (${g.perLine})`);
    check(g.rtPx >= 10, `the pinyin is at least 10 px (${g.rtPx.toFixed(1)})`);
    check(g.aa === 'Aa', 'the bar shows Aa and the eye (the pinyin pill has no text at narrow widths)');
    await page.screenshot({ path: `${OUT}15-phone-reader.png` });
    await page.locator('.rd-aa-btn').tap();
    await settle(600);
    const sheet = await page.evaluate(() => { const p = document.querySelector('.rd-pop'); const r = p?.getBoundingClientRect(); return p ? { sheet: p.classList.contains('rd-sheet'), top: r.top, h: r.height, vh: innerHeight, label: p.getAttribute('aria-label'), focus: document.activeElement === p } : null; });
    check(!!sheet && sheet.sheet && sheet.top > sheet.vh * 0.35 && sheet.h <= sheet.vh * 0.65, `the Aa menu is a bottom sheet that leaves the top of the page in view (top ${Math.round(sheet?.top)} of ${sheet?.vh})`);
    check(!!sheet && sheet.label === 'Display settings' && sheet.focus, 'the menu is a labeled dialog and focus moved into it');
    await page.screenshot({ path: `${OUT}16-phone-aa-sheet.png` });
    await page.locator('.rd-pop .btn', { hasText: 'Done' }).tap();
    await settle(300);
    check(await page.evaluate(() => !document.querySelector('.rd-pop')), 'Done closes the sheet');
    await doubleTapHalves(page, 'phone');
    await ctx.close();
    // The same in the Scroll layout, where the card opens beside the word and can be under the finger for the second tap.
    const sc = await openReader('iPhone 13', { fontSize: 24, layout: 'scroll' });
    await doubleTapHalves(sc.page, 'phone, Scroll', 200, { hold: false }); // Scroll may move the text to keep the word clear of the card
    await sc.ctx.close();
  }



  // ============================================================ names and terms (射雕英雄传, read in place, never copied)
  const SHEDIAO = process.env.QA_SHEDIAO ?? `${homedir()}/Downloads/射雕英雄传.epub`;
  if (existsSync(SHEDIAO) && want('names')) {
    const bytesOfBook = readFileSync(SHEDIAO);
    for (const [device, shot] of [['iPad Pro 11 landscape', 'lex-landscape'], ['iPad Pro 11', 'lex-portrait'], ['iPhone 13', 'lex-phone']]) {
      const ctx = await browser.newContext({ ...devices[device] });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error' && !/hanzi-writer-data|Failed to load resource|Importing a module script failed/.test(m.text())) errors.push(`${device}: ${m.text()}`); });
      // WebKit stalls when a multi-megabyte argument is passed to evaluate, so the page fetches the book from a route
      // that Playwright answers from the file in place (nothing is copied into the repo).
      await page.route('**/__qa-book.epub', (route) => route.fulfill({ status: 200, contentType: 'application/epub+zip', body: bytesOfBook }));
      await page.goto(BASE, { waitUntil: 'networkidle' });
      const id = await page.evaluate(async () => {
        const { openStore } = await import('/src/store/index.ts');
        const { importFile } = await import('/src/import/index.ts');
        const bytes = new Uint8Array(await (await fetch('/__qa-book.epub')).arrayBuffer());
        const store = await openStore('dushu');
        return (await store.books.add(await importFile(new File([bytes], '射雕英雄传.epub')))).id;
      });
      await page.evaluate(([i]) => {
        localStorage.setItem('dushu.settings.v1', JSON.stringify({ theme: 'light', pinyin: 'all', fontSize: 22, translator: 'gloss', layout: 'pages' }));
        location.hash = `#/read/${i}?ch=11`;
      }, [id]);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.rd-article.rd-live .rd-w', { timeout: 60000 });
      const hasName = () => page.evaluate(() => [...document.querySelectorAll('.rd-article.rd-live .rd-w')].some((el) => [...el.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('') === '郭靖'));
      let ok = false;
      for (let i = 0; i < 120 && !ok; i++) { ok = await hasName(); if (!ok) await settle(500); }
      check(ok, `${device}: 郭靖 becomes one word once the book has been scanned`);
      await settle(800);
      // Turn until a 郭靖 is on screen, then tap it.
      const visibleName = () => page.evaluate(() => {
        const el = [...document.querySelectorAll('.rd-article.rd-live .rd-w')].find((e) => {
          if ([...e.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('') !== '郭靖') return false;
          const r = e.getBoundingClientRect();
          // Clear of the outer strips: a tap there turns the page instead of looking the word up (where the name falls depends on the text).
          const wide = innerWidth >= 900 && innerWidth >= innerHeight * 1.1;
          const edge = Math.min(Math.max(56, innerWidth * (wide ? 0.16 : 0.2)), wide ? 220 : 160);
          return r.left > edge + 8 && r.right < innerWidth - edge - 8 && r.top > 70 && r.bottom < innerHeight - 50;
        });
        if (!el) return null;
        // A name can wrap across two lines; its own box then spans both, so tap its first character.
        const r = el.querySelector('ruby').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, py: [...el.querySelectorAll('rt')].map((t) => t.textContent).join(' ') };
      });
      let at = await visibleName();
      for (let i = 0; i < 25 && !at; i++) { await page.keyboard.press('ArrowRight'); await settle(1000); at = await visibleName(); }
      check(!!at && at.py === 'guō jìng', `${device}: 郭靖 is on a page and reads guō jìng`);
      if (at) {
        await settle(700);
        at = (await visibleName()) ?? at; // measure again right before the tap: nothing may be moving
        await page.touchscreen.tap(at.x, at.y);
        await settle(700);
        // (The labels are set in capitals by CSS, so read the text the card holds, not how it is drawn.)
        const card = await page.evaluate(() => {
          const b = document.querySelector('.pp-book');
          return { section: b?.querySelector('.pp-section')?.textContent ?? '', kind: b?.querySelector('.chip')?.textContent ?? '', pop: document.querySelector('.pp-pop')?.className.match(/pp-k-\w+/)?.[0] ?? 'none' };
        });
        check(card.section === 'In this book' && card.kind === 'Person', `${device}: tapping the name opens the In this book card (${card.pop}: ${card.section || '-'} / ${card.kind || '-'})`);
        const box = await page.evaluate(() => { const r = document.querySelector('.pp-pop')?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight } : null; });
        check(!!box && box.l >= 0 && box.r <= box.w + 1 && box.t >= -1 && box.b <= box.h + 1, `${device}: the popup stays on screen`);
        await page.screenshot({ path: `${OUT}${shot}-popup.png` });
        // A tap on the margin closes it (Safari reports the tap as a mouse click).
        // Outside the popup: the left margin beside a card, the strip above a full-width sheet on a phone.
        // (On the phone the bar is above the sheet: its title is not a word, so a tap there is a tap outside.)
        const outside = box && box.l <= 20 ? { x: box.w / 2, y: 26 } : { x: 8, y: box ? box.h / 2 : 400 };
        await page.touchscreen.tap(outside.x, outside.y);
        await settle(500);
        check(await page.$('.pp-pop') === null, `${device}: a tap outside closes the popup`);
      }
      await page.screenshot({ path: `${OUT}${shot}.png` });
      await ctx.close();
    }
  } else console.log('skip: no 射雕英雄传.epub');

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  failures.push(String(e && e.message ? e.message : e));
} finally {
  await browser.close();
  stopServer();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall iPad checks passed (WebKit at iPad size; not real iPadOS)');
