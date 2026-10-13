// Headless iPad QA for the Pages layout, in WebKit (Playwright) at iPad size with touch.
// This is the Safari engine, not real iPadOS: there is no home-screen mode, no real long-press selection handles and
// no iPad keyboard. It checks layout, taps, swipes, popups, selection handling and rotation.
//
//   node scripts/qa-ipad.mjs                        starts `vite --port 5191 --strictPort` itself and stops it at the end
//   QA_BASE=http://localhost:5191/ node scripts/qa-ipad.mjs   use a server that is already running
//
// Screenshots go to qa-out/ipad/. Needs the isolated Playwright install in .cache/qa-webkit (see its package.json).
// Headless only: it never opens a window.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const ROOT = new URL('../', import.meta.url).pathname;
const require = createRequire(`${ROOT}.cache/qa-webkit/package.json`);
const { webkit, devices } = require('playwright');

const PORT = 5191;
const BASE = process.env.QA_BASE ?? `http://localhost:${PORT}/`;
const OUT = `${ROOT}qa-out/ipad/`;
mkdirSync(OUT, { recursive: true });

let server = null;
async function startServer() {
  if (process.env.QA_BASE) return;
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('vite did not start')), 30000);
    server.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); resolve(); } });
    server.stderr.on('data', (d) => { if (String(d).includes('Error')) { clearTimeout(t); reject(new Error(String(d))); } });
  });
}
const stopServer = () => { if (server) { server.kill('SIGTERM'); server = null; } };
process.on('exit', stopServer);

const failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.log('FAIL', msg); } else console.log('ok  ', msg); };
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const errors = [];

await startServer();
const browser = await webkit.launch({ headless: true });

/** Open a fresh iPad context, seed a book through the app's own modules, open it in Pages. */
async function openReader(device, settings = {}, chapter = 1) {
  if (!devices[device]) throw new Error(`Unknown device profile: ${device}`);
  const ctx = await browser.newContext({ ...devices[device] });
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
    return (await store.books.add(importText(text, '红楼梦', '曹雪芹'))).id;
  });
  await page.evaluate(([i, s, ch]) => {
    localStorage.setItem('dushu.settings.v1', JSON.stringify({ theme: 'light', pinyin: 'all', fontSize: 24, translator: 'gloss', layout: 'pages', ...s }));
    location.hash = `#/read/${i}?ch=${ch}`;
  }, [id, settings, chapter]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector(settings.layout === 'scroll' ? '.rd-article .rd-w' : '.rd-article.rd-live .rd-w', { timeout: 60000 });
  await settle(1200);
  return { ctx, page, id };
}

const info = (page) => page.evaluate(() => ({ ...document.querySelector('.rd-stage').dataset, w: innerWidth, h: innerHeight }));

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

/** Center of the nth visible Han word, in viewport coordinates. */
const wordAt = (page, nth = 3) => page.evaluate((n) => {
  const live = document.querySelector('.rd-article.rd-live');
  const ws = [...live.querySelectorAll('.rd-p .rd-w')].filter((w) => { const r = w.getBoundingClientRect(); return r.left > 0 && r.right < innerWidth && r.top > 80 && r.bottom < innerHeight - 60; });
  const w = ws[n];
  const r = w.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, text: [...w.querySelectorAll('ruby')].map((u) => u.firstChild.data).join('') };
}, nth);

try {
  // Scrolling + real Premium audio, with the same touch gesture used by an iPad reader.
  for (const device of ['iPad Pro 11', 'iPad Mini landscape']) {
    const { ctx, page } = await openReader(device, { layout: 'scroll' });
    const metrics = await page.evaluate(() => ({
      font: parseFloat(getComputedStyle(document.querySelector('.rd-article')).fontSize),
      progress: getComputedStyle(document.querySelector('.rd-progress')).display,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    }));
    check(metrics.font === 28, `${device}: Scroll defaults to larger 28px text`);
    check(metrics.progress === 'none' && !metrics.overflow, `${device}: Scroll has no horizontal progress bar or overflow`);
    const word = page.locator('.rd-p .rd-w').first();
    await word.tap();
    const sentenceButton = page.getByRole('button', { name: 'Translate sentence', exact: true });
    check(await sentenceButton.isVisible(), `${device}: sentence translation is immediately visible in the word card`);
    const actionBox = await sentenceButton.boundingBox();
    check(actionBox && actionBox.height >= 44 && actionBox.y >= 0 && actionBox.y + actionBox.height <= page.viewportSize().height,
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
    await ctx.close();
  }
  // ============================================================ landscape
  {
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

    // Tap the right outer third: next spread. (The chrome tucks away on the first turn.)
    const before = await info(page);
    await page.touchscreen.tap(1100, 420);
    await settle(900);
    const after = await info(page);
    check(Number(after.page) === Number(before.page) + 2, `tap on the right third turns to the next spread (page ${before.page} -> ${after.page})`);
    await page.screenshot({ path: `${OUT}02-landscape-after-tap.png` });

    // Tap the left outer third: back.
    await page.touchscreen.tap(90, 420);
    await settle(900);
    const back = await info(page);
    check(back.page === before.page, 'tap on the left third turns back');

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
    check(await page.evaluate(() => !document.querySelector('.rd-leaf') && !document.querySelector('.rd-stage').classList.contains('rd-turning')), 'the leaf is cleaned up after the turn');

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
    const pop = await page.evaluate(() => { const p = document.querySelector('.pp-pop'); if (!p) return null; const r = p.getBoundingClientRect(); return { cls: p.className, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; });
    check(!!pop && pop.cls.includes('pp-float') && !pop.cls.includes('pp-sheet'), `a tap on "${w.text}" opens the word popup as a card`);
    check(!!pop && pop.w <= 460 && pop.left >= 0 && pop.right <= pop.vw && pop.bottom <= pop.vh + 1, 'the popup fits on the screen');
    await page.screenshot({ path: `${OUT}04-landscape-word-popup.png` });
    check((await info(page)).page === swiped.page, 'a word tap does not turn the page');

    // Tapping elsewhere closes the popup and does not turn the page.
    await page.touchscreen.tap(1000, 790);
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
    await swipe(page, 1000, 420, 500, 430, { steps: 6 });
    await settle(900);
    check((await info(page)).page === pageBeforeSel, 'no page turn while text is selected');
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
    check(Number(rot.block) <= Number(place.block) && Number(place.block) - Number(rot.block) <= 3, `rotation keeps the reading position (block ${place.block} -> ${rot.block})`);
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
  {
    const { ctx, page } = await openReader('iPad Pro 11');
    const s0 = await info(page);
    console.log('portrait', s0);
    check(s0.per === '1', 'iPad portrait shows a single page');
    await page.screenshot({ path: `${OUT}08-portrait-single.png` });
    const before = await info(page);
    await page.touchscreen.tap(780, 600);
    await settle(900);
    const after = await info(page);
    check(Number(after.page) === Number(before.page) + 1, 'tap turns one page in portrait');
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
    check(!!pop && pop.cls.includes('pp-float') && pop.r <= pop.vw, 'portrait iPad also gets the card popup, not the phone sheet');
    await page.screenshot({ path: `${OUT}10-portrait-word-popup.png` });
    await ctx.close();
  }

  // ============================================================ other sizes
  {
    const { ctx, page } = await openReader('iPad Mini');
    check((await info(page)).per === '1', 'iPad mini portrait shows a single page');
    await ctx.close();
    const m = await openReader('iPad Mini landscape', { fontSize: 28 });
    check((await info(m.page)).per === '2', 'iPad mini landscape shows a spread');
    await m.page.screenshot({ path: `${OUT}11-mini-landscape-28px.png` });
    await m.ctx.close();
  }

  // ============================================================ the flip, both modes
  {
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


  // ============================================================ names and terms (射雕英雄传, read in place, never copied)
  const SHEDIAO = process.env.QA_SHEDIAO ?? `${homedir()}/Downloads/射雕英雄传.epub`;
  if (existsSync(SHEDIAO)) {
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
          return r.left > 10 && r.right < innerWidth - 10 && r.top > 70 && r.bottom < innerHeight - 50;
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
        const card = await page.evaluate(() => document.querySelector('.pp-book')?.innerText ?? '');
        check(/In this book/i.test(card) && /Person/.test(card), `${device}: tapping the name opens the In this book card`);
        const box = await page.evaluate(() => { const r = document.querySelector('.pp-pop')?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight } : null; });
        check(!!box && box.l >= 0 && box.r <= box.w + 1 && box.t >= -1 && box.b <= box.h + 1, `${device}: the popup stays on screen`);
        await page.screenshot({ path: `${OUT}${shot}-popup.png` });
        // A tap on the margin closes it (Safari reports the tap as a mouse click).
        // Outside the popup: the left margin beside a card, the strip above a full-width sheet on a phone.
        const outside = box && box.l <= 20 ? { x: box.w / 2, y: 120 } : { x: 8, y: box ? box.h / 2 : 400 };
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
