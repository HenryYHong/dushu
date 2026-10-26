// Headless QA driver for Dushu. Drives the real UI in headless Chrome (never a visible window).
//
//   node scripts/qa.mjs <url> <outDir> <scenario>
//
//   url       - (or nothing): starts `vite --port 5190 --strictPort` itself, with an empty sync folder, and stops it at the end
//             a URL: uses that server, with sync switched off in the browser (its sync folder may be the owner's)
//   outDir    where screenshots go (created if missing)
//   scenario  smoke | read | epub | vocab | rare | themes | mobile | pages | lexicon | mobi | offline | all (comma-separate to pick several)
//
// Prints PASS/FAIL lines and exits non-zero if any check failed. QA_EPUB overrides the EPUB path
// for the epub scenario (default ~/Downloads/活着.epub; the scenario is skipped if the file is absent).
// QA_SHEDIAO overrides the book for the lexicon scenario (default ~/Downloads/射雕英雄传.epub, skipped if absent).
// Everything goes through the UI, so the same script works against the dev server and the build.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [, , urlArg = '-', outArg = 'qa-out/run', scenarioArg = 'all'] = process.argv;
const OWN = !urlArg || urlArg === '-';
const PORT = 5190;
const BASE = OWN ? `http://localhost:${PORT}/` : urlArg.endsWith('/') ? urlArg : urlArg + '/';
// The server started here gets an empty sync folder of its own (removed at the end), never the owner's.
const SYNC_DIR = !OWN ? null : mkdtempSync(join(tmpdir(), 'dushu-qa-sync-'));
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
if (OWN) {
  const ROOT = new URL('../', import.meta.url).pathname;
  server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DUSHU_SYNC_DIR: SYNC_DIR } });
  await new Promise((done, fail) => {
    const t = setTimeout(() => fail(new Error('vite did not start')), 30000);
    server.stdout.on('data', (d) => { if (String(d).includes('Local:')) { clearTimeout(t); done(); } });
    server.stderr.on('data', (d) => { if (String(d).includes('Error')) { clearTimeout(t); fail(new Error(String(d))); } });
  });
}
process.on('exit', () => { if (server) server.kill('SIGTERM'); dropSyncDir(); });
const OUT = resolve(outArg);
const EPUB = process.env.QA_EPUB ?? join(homedir(), 'Downloads', '活着.epub');
const SHEDIAO = process.env.QA_SHEDIAO ?? join(homedir(), 'Downloads', '射雕英雄传.epub');
const MOBI = process.env.QA_MOBI ?? new URL('../tests/fixtures/import/daodejing.gutenberg.mobi', import.meta.url).pathname;
const AZW3 = new URL('../tests/fixtures/import/daodejing.gutenberg.azw3', import.meta.url).pathname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SETTINGS_KEY = 'dushu.settings.v1';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let passed = 0;
let skipped = 0;
let current = '';
function check(cond, msg) {
  if (cond) { passed++; console.log(`PASS [${current}] ${msg}`); } else { failed++; console.log(`FAIL [${current}] ${msg}`); }
  return !!cond;
}

const launch = () => puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check', '--mute-audio'],
});
let browser = await launch();

/** A fresh incognito context per scenario, so IndexedDB and localStorage start empty. */
async function session({ width = 1100, height = 860, mobile = false, settings = {}, ownerBooks = false } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  if (!SYNC_DIR) await page.evaluateOnNewDocument(SYNC_OFF);
  // On the dev server and on 4317 the Mac bridge lists the owner's books and every fresh profile adds them in the background,
  // so the library is never empty and a card can appear while a scenario is importing its own file. Answer the list with
  // "no books" unless the scenario asks for them; the bridge itself is checked in qa-local-books.mjs.
  if (!ownerBooks) {
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/local-books') void r.respond({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: '[]' });
      else void r.continue();
    });
  }
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location()?.url ?? '';
    // Stroke-order data comes from a CDN that a sandbox may block; the popup hides that section quietly.
    if (/jsdelivr|hanzi-writer-data/.test(where + m.text())) return;
    // Chrome logs a bare "Failed to load resource" for blocked requests without saying which.
    if (/^Failed to load resource/.test(m.text()) && !where) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => {
    if (/jsdelivr|translated\.net|anthropic/.test(r.url())) return;
    // The page's own 2 s AbortSignal.timeout on the voices probe is intended; under load it shows up as ERR_ABORTED.
    if (/\/api\/native-voices/.test(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
  });
  await page.setViewport(mobile
    ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { width, height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((key, patch) => {
    // Applies once per new document, before the app boots; later changes are left alone.
    try {
      if (sessionStorage.getItem('qa.seeded')) return;
      sessionStorage.setItem('qa.seeded', '1');
      localStorage.setItem(key, JSON.stringify(patch));
      // The settings are the scenario's own: no one-time moves to the new defaults (Pages, simplified), and no sync, which
      // would carry one scenario's settings into the next scenario's fresh profile through the server's sync folder.
      localStorage.setItem('dushu.settings.pages.v1', '1');
      localStorage.setItem('dushu.settings.simplified.v1', '1');
      localStorage.setItem('dushu.sync.off.v1', '1');
    } catch { /* storage blocked */ }
  }, SETTINGS_KEY, settings);
  await page.goto(BASE, { waitUntil: 'networkidle0' });

  const s = {
    page, errors,
    shot: async (name, opts = {}) => {
      await sleep(250);
      await page.screenshot({ path: join(OUT, `${current}-${name}.png`), ...opts });
    },
    goto: async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(450); },
    setSettings: async (patch, waitUntil = 'networkidle0') => {
      await page.evaluate((k, p) => {
        const cur = JSON.parse(localStorage.getItem(k) || '{}');
        localStorage.setItem(k, JSON.stringify({ ...cur, ...p }));
      }, SETTINGS_KEY, patch);
      await page.reload({ waitUntil });
    },
    /** Adds a classic from the library's "Start with a classic" list and waits for the reader. */
    addSample: async (title) => {
      await s.goto('#/');
      await page.waitForSelector('.lib-sample', { timeout: 15000 });
      const clicked = await page.evaluate((t) => {
        const card = [...document.querySelectorAll('.lib-sample')].find((c) => c.querySelector('.lib-sample-title')?.textContent === t);
        const btn = card?.querySelector('.lib-add');
        if (!btn) return false;
        btn.click();
        return true;
      }, title);
      if (!clicked) throw new Error(`sample ${title} not listed`);
      await page.waitForFunction(() => location.hash.startsWith('#/read/'), { timeout: 30000 });
      await s.waitReader();
    },
    waitReader: async () => {
      await page.waitForSelector('.rd-article .rd-w', { timeout: 30000 });
      await page.waitForFunction(() => !document.querySelector('.app-loading'), { timeout: 15000 });
      await sleep(500);
    },
    /** Center of the nth rendered word whose text is `text`, scrolled into view. */
    wordRect: (text, nth = 0) => page.evaluate((t, n) => {
      const hits = [...document.querySelectorAll('.rd-article .rd-w')].filter((el) =>
        [...el.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('') === t);
      const el = hits[n];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.62, left: r.left, right: r.right, w: r.width, h: r.height };
    }, text, nth),
    /** Rect of the nth word on screen that is at least `min` characters long. */
    anyWord: (min = 2, nth = 0) => page.evaluate((m, n) => {
      const hits = [...document.querySelectorAll('.rd-article .rd-w')].filter((el) => el.querySelectorAll('ruby').length >= m);
      const el = hits[n];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const text = [...el.querySelectorAll('ruby')].map((x) => x.firstChild.data).join('');
      return { text, x: r.left + r.width / 2, y: r.top + r.height * 0.62, left: r.left, right: r.right, w: r.width, h: r.height };
    }, min, nth),
    popupText: () => page.$eval('.pp-pop', (e) => e.innerText).catch(() => null),
    done: async () => {
      check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 3).join(' // ').slice(0, 300) : ''}`);
      await page.close();
      await context.close();
    },
  };
  return s;
}

const flat = (t) => (t ?? '').replace(/\s+/g, ' ').trim();
const tapOrClick = async (page, x, y, mobile) => { if (mobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };

// -------------------------------------------------------------------------------------------------
const scenarios = {};

scenarios.smoke = async () => {
  const s = await session();
  const { page } = s;
  const routes = [
    ['#/', '.lib-page', 'library'],
    ['#/vocab', '.voc-page, .page', 'vocabulary'],
    ['#/review', '.rev-page, .page', 'review'],
    ['#/settings', '.set-page, .page', 'settings'],
    ['#/about', '.ab-page', 'about'],
  ];
  for (const [hash, sel, name] of routes) {
    await s.goto(hash);
    const ok = await page.waitForSelector(sel, { timeout: 8000 }).then(() => true, () => false);
    check(ok, `${name} route renders`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} has no horizontal scroll`);
    await s.shot(name);
  }
  await s.goto('#/nonsense/route');
  check(await page.waitForSelector('.lib-page', { timeout: 5000 }).then(() => true, () => false), 'unknown route falls back to the library');
  await s.goto('#/read/does-not-exist');
  await sleep(800);
  const msg = flat(await page.$eval('#screen', (e) => e.innerText).catch(() => ''));
  check(msg.length > 0 && !/undefined|TypeError/.test(msg), `reader with an unknown book id shows a message (${msg.slice(0, 70)})`);
  // Reader for a real book.
  await s.addSample('孔乙己');
  check(await page.$('.rd-article .rd-w') !== null, 'reader renders a sample');
  check(await page.$eval('body', (b) => b.dataset.route) === 'read', 'reader hides the nav (body[data-route=read])');
  await s.shot('reader');
  await s.goto('#/about');
  check(await page.$('.pp-pop') === null, 'no popup left over after leaving the reader');
  // The review badge exists in the nav and starts hidden.
  check(await page.$eval('.app-badge', (b) => b.hidden), 'review badge is hidden with nothing due');
  await s.done();
};

scenarios.read = async () => {
  // The Scroll layout: position is the scroll offset and chapters end in a Next button. Pages is covered by `pages`.
  const s = await session({ settings: { pinyin: 'unknown', layout: 'scroll', translator: 'gloss' } });
  const { page } = s;
  await s.addSample('孔乙己');
  check(await page.$eval('.rd-article', el => getComputedStyle(el).fontSize) === '28px', 'Scroll defaults to larger 28px text');
  check(await page.$eval('.rd-progress', el => getComputedStyle(el).display) === 'none', 'Scroll hides the horizontal progress bar');
  await s.shot('reader-unknown');

  // Word popup: click a multi-character word.
  const w = await s.wordRect('酒店');
  check(!!w, 'the sample contains 酒店');
  await page.mouse.click(w.x, w.y);
  await sleep(400);
  const txt = await s.popupText();
  check(/jiǔ\s*diàn/.test(txt ?? ''), `word popup shows pinyin (${flat(txt).slice(0, 70)})`);
  check(/inn|tavern|hotel|wine shop|bar/i.test(txt ?? ''), 'word popup shows an English definition');
  check(/In this sentence[\s\S]*wine shop or tavern/i.test(txt ?? ''), 'the literary 酒店 passage uses its wine-shop sense from paragraph evidence');
  check(await page.$$eval('.pp-card', (c) => c.length) === 2, 'word popup breaks 酒店 into 2 characters');
  const box = await page.$eval('.pp-pop', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
  check(box.l >= 0 && box.t >= 0 && box.r <= box.vw && box.b <= box.vh, `popup sits inside the viewport (${Math.round(box.l)},${Math.round(box.t)} to ${Math.round(box.r)},${Math.round(box.b)})`);
  await s.shot('word-popup');
  await page.keyboard.press('Escape');
  await sleep(200);
  check(await page.$('.pp-pop') === null, 'Esc closes the popup');

  // Double click also looks up.
  await page.mouse.click(w.x, w.y, { clickCount: 2 });
  await sleep(400);
  check(await page.$('.pp-pop') !== null, 'double-click opens the popup');
  await page.keyboard.press('Escape');

  // Drag between actual glyphs: a fixed pixel distance may select only one word after reflow.
  const phrasePoints = await page.evaluate(() => {
    const chars = [...document.querySelectorAll('.rd-p ruby')].slice(0, 8);
    chars[0].scrollIntoView({ block: 'center' });
    const point = (el, end) => {
      const range = document.createRange();
      range.selectNodeContents(el.firstChild);
      const r = range.getBoundingClientRect();
      return { x: end ? r.right - 1 : r.left + 1, y: r.top + r.height / 2 };
    };
    return { from: point(chars[0], false), to: point(chars.at(-1), true) };
  });
  await page.mouse.move(phrasePoints.from.x, phrasePoints.from.y);
  await page.mouse.down();
  await page.mouse.move(phrasePoints.to.x, phrasePoints.to.y, { steps: 15 });
  await page.mouse.up();
  await sleep(900);
  const phrase = await s.popupText();
  check(/phrase|translation/i.test(phrase ?? '') && (await page.$('.pp-phrase-text') !== null), 'drag-select opens the phrase popup');
  check(await page.$('.pp-phrase-text rt') !== null, 'phrase popup shows pinyin over the phrase');
  // Translation: with no key and no downloaded model, the default shows a word-by-word gloss.
  await page.waitForFunction(() => {
    const t = document.querySelector('.pp-tr .pp-tr-text');
    return !!t && t.textContent.trim().length > 3;
  }, { timeout: 15000 }).catch(() => {});
  const tr = flat(await page.$eval('.pp-tr', (e) => e.innerText).catch(() => ''));
  check(tr.length > 20 && !/undefined/.test(tr), `translation panel has text or a fallback (${tr.slice(0, 110)})`);
  await s.shot('phrase-popup');
  check(await page.$$eval('.pp-wbw', (r) => r.length) > 0, 'phrase popup lists word-by-word rows');
  await page.keyboard.press('Escape');
  await sleep(200);

  // Pinyin modes, cycled with the P key and the quick menu.
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const shown = await page.$$eval('.rd-article rt', (rts) => rts.filter((r) => getComputedStyle(r).display !== 'none').length);
    seen.push(shown);
    await page.keyboard.press('p');
    await sleep(250);
  }
  check(new Set(seen).size >= 3, `P cycles pinyin modes (visible rt counts: ${seen.join(', ')})`);
  await page.click('.rd-pinyin-btn');
  await sleep(200);
  await s.shot('pinyin-menu');
  await page.keyboard.press('Escape');

  // Everything on, check ruby alignment: each ruby's rt is centered over its character.
  await s.setSettings({ pinyin: 'all' });
  await s.waitReader();
  const align = await page.evaluate(() => {
    const bad = [];
    let n = 0;
    for (const ruby of [...document.querySelectorAll('.rd-article ruby')].slice(0, 400)) {
      const rt = ruby.querySelector('rt');
      if (!rt || !rt.textContent) continue;
      // The pinyin text sits in a span inside the rt (Safari ignores positioning on rt itself).
      const rr = (rt.querySelector('.rd-rtx') ?? rt).getBoundingClientRect();
      // Measure against the glyph itself: the ruby box is narrower than a wide syllable (zhuāng) on purpose.
      const range = document.createRange();
      range.selectNodeContents(ruby.firstChild);
      const gr = range.getBoundingClientRect();
      n++;
      if (rr.bottom > gr.top + gr.height * 0.2) bad.push(ruby.textContent);       // pinyin must sit above the character
      if (Math.abs((rr.left + rr.right) / 2 - (gr.left + gr.right) / 2) > 2) bad.push(ruby.textContent);
    }
    return { n, bad: bad.slice(0, 5) };
  });
  check(align.n > 100 && align.bad.length === 0, `pinyin is centered above its character (${align.n} checked${align.bad.length ? ', bad: ' + align.bad.join(',') : ''})`);
  const lh = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('.rd-article .rd-p')].filter((p) => p.getBoundingClientRect().height > 80).slice(0, 5);
    // Line spacing must leave room for pinyin: the gap between consecutive lines is at least font-size * 1.8.
    const fs = parseFloat(getComputedStyle(ps[0]).fontSize);
    const rows = [...new Set([...ps[0].querySelectorAll('ruby')].map((r) => Math.round(r.getBoundingClientRect().top)))].sort((a, b) => a - b);
    const gaps = rows.slice(1).map((v, i) => v - rows[i]).filter((g) => g > fs);
    return { fs, minGap: Math.min(...gaps) };
  });
  check(lh.minGap >= lh.fs * 1.7, `line height leaves room for pinyin (min line pitch ${lh.minGap}px at ${lh.fs}px text)`);
  await s.shot('reader-all');

  // Shortcuts sheet, aa menu, TOC.
  await page.keyboard.press('?');
  await sleep(300);
  check(await page.$('dialog.rd-keys[open]') !== null, '? opens the shortcuts sheet');
  await page.keyboard.press('Escape');
  await page.click('.rd-aa-btn');
  await sleep(250);
  await s.shot('aa-menu');
  await page.keyboard.press('Escape');

  // Progress is saved and restored.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.4));
  await sleep(1500);
  await page.reload({ waitUntil: 'networkidle0' });
  await s.waitReader();
  await sleep(600);
  check(await page.evaluate(() => window.scrollY) > 200, 'reading position is restored after a reload');

  // Choose the fixture browser voice explicitly: Automatic legitimately prefers real Premium Mac audio.
  // Real Premium playback is checked independently by qa-ipad and qa-private-ipad.
  await s.setSettings({ ttsVoice: 'qa-zh' });
  await s.waitReader();
  // Stub only the browser speech engine: verify the real reader button's start/stop wiring without audio hardware.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    window.__qaSpoken = [];
    window.__qaPauses = [];
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
      constructor(text) { this.text = text; }
    } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ name: 'QA Mandarin', voiceURI: 'qa-zh', lang: 'zh-CN', localService: true }],
      speak: (u) => { window.__qaSpoken.push(u.text); queueMicrotask(() => u.onboundary?.({ charIndex: 1, charLength: 1 })); },
      cancel: () => {},
      pause: () => { window.__qaPauses.push('pause'); },
      resume: () => { window.__qaPauses.push('resume'); },
    } });
  });
  const speech = await page.$('.rd-speech-btn');
  check(!!speech, 'the reader has a chapter read-aloud button');
  if (speech) {
    await speech.click();
    // The first read-aloud asks the Mac for its voices before it picks one: on the fresh server this script starts, that is
    // `say -v ?` (most of a second). The page gives up on the Mac after 2 s, so the start must come within 3 s.
    await page.waitForFunction(() => window.__qaSpoken.length > 0, { timeout: 3000 }).catch(() => {});
    await sleep(150);
    const started = await page.evaluate(() => ({ active: document.querySelector('.rd-speech-btn')?.getAttribute('aria-pressed'), count: window.__qaSpoken.length }));
    check(started.active === 'true' && started.count > 0, 'read-aloud starts at the current chapter position');
    check(await page.$('.rd-speaking-word') !== null, 'spoken word is highlighted when the voice reports a boundary');
    const pause = await page.$('.rd-audio-pause');
    check(!!pause, 'read-aloud has a pause button');
    if (pause) {
      await pause.click();
      check(await page.$eval('.rd-audio-pause', b => b.getAttribute('aria-label')) === 'Resume audio', 'read-aloud pauses');
      await pause.click();
      check((await page.evaluate(() => window.__qaPauses)).join(',') === 'pause,resume', 'read-aloud resumes');
    }
    await speech.click();
    check(await page.$eval('.rd-speech-btn', b => b.getAttribute('aria-pressed')) === 'false', 'read-aloud stops from the same button');
  }
  await s.done();
};

scenarios.epub = async () => {
  if (!existsSync(EPUB)) { skipped++; console.log(`SKIP [epub] ${EPUB} not found`); return; }
  const s = await session({ settings: { pinyin: 'all', fontSize: 24, layout: 'scroll' } });
  const { page } = s;
  await s.goto('#/');
  await page.waitForSelector('.lib-page');
  const input = await page.$('input[type=file]');
  await input.uploadFile(EPUB);
  await page.waitForFunction(() => [...document.querySelectorAll('.lib-card-title')].length > 0, { timeout: 60000 });
  const title = await page.$eval('.lib-card-title', (e) => e.textContent);
  check(title.length > 0, `EPUB imported as "${title}"`);
  await s.shot('library');
  const id = await page.$eval('.lib-card-main', (a) => decodeURIComponent(a.getAttribute('href').split('/read/')[1].split('?')[0]));
  check(await page.waitForFunction(() => {
    const img = document.querySelector('img.lib-cover-img');
    return !img || (img.complete && img.naturalWidth > 0);
  }, { timeout: 5000 }).then(() => true, () => false), 'cover image loads (or a generated cover is used)');
  // Pick the first chapter that has substantial text: open the TOC and read titles.
  await page.evaluate((i) => { location.hash = `#/read/${encodeURIComponent(i)}`; }, id);
  await s.waitReader();
  await page.keyboard.press('c');
  await sleep(700);
  const titles = await page.$$eval('.rd-toc-item', (els) => els.map((e) => e.textContent.trim()));
  check(titles.length >= 1, `table of contents lists ${titles.length} chapters`);
  console.log('     chapters:', titles.slice(0, 12).join(' | '));
  const chapterIdx = Math.max(0, titles.findIndex((t) => /第一章|第1章|Chapter 1|^1\b/i.test(t)));
  await page.keyboard.press('Escape');
  await page.evaluate((i, c) => { location.hash = `#/read/${encodeURIComponent(i)}?ch=${c}`; }, id, chapterIdx);
  await sleep(500);
  await s.waitReader();
  const stats = await page.evaluate(() => ({
    words: document.querySelectorAll('.rd-article .rd-w').length,
    paras: document.querySelectorAll('.rd-article .rd-p').length,
    title: document.querySelector('.rd-chapter-title')?.textContent ?? '',
  }));
  check(stats.words > 200 && stats.paras > 5, `chapter "${stats.title}" renders ${stats.words} words in ${stats.paras} paragraphs`);
  await s.shot('chapter');
  // Click a word in the book.
  const w = await s.anyWord(2, 10);
  await page.mouse.click(w.x, w.y);
  await sleep(500);
  const txt = await s.popupText();
  check(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(txt ?? ''), `lookup works in the real book (${w.text}: ${flat(txt).slice(0, 80)})`);
  await s.shot('chapter-popup');
  await page.keyboard.press('Escape');
  // Sandhi and neutral tone spot checks on the rendered ruby of this chapter.
  const rubyOf = (needle) => page.evaluate((n) => {
    const out = [];
    for (const w of document.querySelectorAll('.rd-article .rd-w')) {
      const t = [...w.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('');
      if (t === n) out.push([...w.querySelectorAll('rt')].map((r) => r.textContent).join(' '));
      if (out.length >= 3) break;
    }
    return out;
  }, needle);
  console.log('     一个 ->', JSON.stringify(await rubyOf('一个')), ' 不是 ->', JSON.stringify(await rubyOf('不是')));
  // Next-chapter button at the bottom.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(600);
  check(await page.$('.rd-end-next') !== null, 'a Next chapter button is at the end of the chapter');
  await s.done();
};

scenarios.vocab = async () => {
  const s = await session({ settings: { pinyin: 'unknown', fontSize: 24 } });
  const { page } = s;
  await s.addSample('孔乙己');
  const w = await s.wordRect('酒店');
  await page.mouse.click(w.x, w.y);
  await sleep(400);
  await page.keyboard.press('s');
  await sleep(400);
  check(await page.$eval('.pp-save', (b) => b.getAttribute('aria-pressed')) === 'true', 'S saves the word from the popup');
  check(await page.$('.rd-article .rd-w.rd-saved') !== null, 'a saved word is marked in the text');
  await page.keyboard.press('Escape');
  await s.goto('#/vocab');
  await page.waitForSelector('.voc-row', { timeout: 8000 });
  const row = flat(await page.$eval('.voc-row', (e) => e.innerText));
  check(/酒店/.test(row) && /jiǔ\s*diàn/.test(row), `the vocab list has the word with pinyin (${row.slice(0, 80)})`);
  check(/孔乙己/.test(row), 'the row remembers the book');
  await s.shot('vocab');
  const badge = await page.$eval('.app-badge', (b) => ({ hidden: b.hidden, text: b.textContent }));
  check(!badge.hidden && badge.text === '1', `the review badge shows 1 due card (${badge.text})`);
  // Row click opens the word popup.
  await page.click('.voc-row');
  await sleep(500);
  check(await page.$('.pp-pop') !== null, 'clicking a row opens the word popup');
  await page.keyboard.press('Escape');
  // Review.
  await s.goto('#/review');
  await page.waitForSelector('.rev-word', { timeout: 8000 });
  await s.shot('review-front');
  check(/酒店/.test(await page.$eval('.rev-word', (e) => e.textContent)), 'review shows the saved word');
  await page.keyboard.press('Space');
  await sleep(250);
  check(await page.$eval('.rev-back', (e) => !e.hidden), 'Space reveals the answer');
  const ivs = await page.$$eval('.rev-grade-iv', (e) => e.map((x) => x.textContent));
  check(ivs.length === 4 && ivs.every(Boolean), `grade buttons show intervals (${ivs.join(', ')})`);
  await s.shot('review-back');
  await page.keyboard.press('4'); // Easy graduates a new card, so the session ends (Good would requeue it in 10 minutes)
  await sleep(500);
  check(await page.waitForSelector('.rev-summary, .rev-empty', { timeout: 5000 }).then(() => true, () => false), 'grading the last card ends the session');
  await s.goto('#/vocab');
  await page.waitForSelector('.voc-row');
  check(await page.$eval('.app-badge', (b) => b.hidden), 'the badge clears once nothing is due');
  // Backup round trip.
  await s.goto('#/settings');
  await page.waitForSelector('.set-page, .page');
  await s.done();
};

scenarios.rare = async () => {
  const s = await session({ settings: { pinyin: 'all', fontSize: 30, script: 'original' } });
  const { page } = s;
  await s.goto('#/');
  await page.waitForSelector('.lib-page');
  await page.evaluate(() => [...document.querySelectorAll('.lib-actions .btn')].find((b) => b.textContent.includes('Paste')).click());
  await page.waitForSelector('dialog.lib-dlg[open]');
  const rare = ['稀有字测试', '', '扩展B区：𠀀 𠀁 𠀂 𪚥 𫠝', '扩展G区：𰻞 𰀁 𰀂 𱁬', '扩展J区：\u{323B0}\u{323B1}\u{323B2}', '部首与兼容字：⼈ ⽔ 豈 更 說'];
  await page.type('.lib-paste-text', rare.join('\n'));
  await page.type('.lib-paste input[aria-label=Title]', '稀有字');
  await page.click('.lib-dlg .btn-primary');
  await page.waitForFunction(() => location.hash.startsWith('#/read/'), { timeout: 10000 });
  await s.waitReader();
  await page.evaluate(() => document.fonts.ready);
  await sleep(1500);
  await s.shot('rare-text');

  // Tofu check. Draw each character with the reader's own font stack and compare against a code point
  // that no font has (a noncharacter). If the pixels match that, the character is shown as a box.
  const result = await page.evaluate(async () => {
    const fam = getComputedStyle(document.querySelector('.rd-article')).fontFamily;
    const px = (ch) => {
      const c = document.createElement('canvas');
      c.width = 80; c.height = 80;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 80, 80);
      g.fillStyle = '#000'; g.font = `48px ${fam}`; g.textBaseline = 'top';
      g.fillText(ch, 8, 8);
      return g.getImageData(0, 0, 80, 80).data;
    };
    const same = (a, b) => { for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i]) return false; return true; };
    const blank = px(' ');
    // Make sure the fonts that matter are loaded before drawing.
    const probes = ['\u{20000}', '\u{30EDE}', '\u{323B0}', '\u{4E00}'];
    await Promise.all(probes.map((p) => document.fonts.load(`48px ${fam}`, p).catch(() => [])));
    await document.fonts.ready;
    const missing = px('\u{2FFFD}'); // noncharacter: renders as the fallback box or nothing
    const tests = ['\u{20000}', '\u{2A6A5}', '\u{2B81D}', '\u{30EDE}', '\u{31350}', '\u{323B0}', '\u{323B2}', '⼈', '⽔', '兀', '更', '說'];
    const bad = [];
    for (const ch of tests) {
      const p = px(ch);
      if (same(p, blank) || same(p, missing)) bad.push('U+' + ch.codePointAt(0).toString(16).toUpperCase());
    }
    const faces = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''));
    return { bad, faces, tested: tests.length, famStart: fam.slice(0, 60) };
  });
  check(result.bad.length === 0, `no tofu for Ext B, C, G, J, radicals and compatibility characters (${result.tested} tested${result.bad.length ? ', tofu: ' + result.bad.join(' ') : ''})`);
  check(['Jigmo2', 'Jigmo3'].every((f) => result.faces.includes(f)), `Jigmo2 and Jigmo3 loaded on demand (loaded faces: ${result.faces.join(', ')})`);

  // Look each rare char up.
  const cases = [['\u{20000}', /Extension B/], ['\u{30EDE}', /Extension G|biang|noodle/i], ['\u{323B0}', /Extension J/], ['⼈', /Kangxi|person|man/i], ['豈', /how|qǐ|what/i]];
  for (const [ch, expect] of cases) {
    const r = await s.wordRect(ch);
    if (!check(!!r, `U+${ch.codePointAt(0).toString(16).toUpperCase()} is rendered as its own word`)) continue;
    await page.mouse.click(r.x, r.y);
    await sleep(450);
    const t = await s.popupText();
    check(!!t && expect.test(t) && /U\+/.test(t), `popup for U+${ch.codePointAt(0).toString(16).toUpperCase()} shows the block and code point (${flat(t).slice(0, 90)})`);
    if (ch === '\u{323B0}') await s.shot('rare-popup-extJ');
    await page.keyboard.press('Escape');
    await sleep(150);
  }
  // Copying keeps the characters whole (no half surrogates, no pinyin).
  const copied = await page.evaluate(() => {
    const p = document.querySelectorAll('.rd-article .rd-p')[1];
    const sel = getSelection(); sel.removeAllRanges();
    const range = document.createRange(); range.selectNodeContents(p); sel.addRange(range);
    const dt = new DataTransfer();
    p.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    sel.removeAllRanges();
    return dt.getData('text/plain');
  });
  check(copied.includes('\u{20000}') && copied.includes('\u{2A6A5}') && !/[ā-ǜ]/.test(copied), `copy keeps astral characters whole (${JSON.stringify(copied).slice(0, 50)})`);
  await s.done();
};

scenarios.themes = async () => {
  // WCAG contrast of the colors people actually read, in each theme.
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const theme of ['light', 'sepia', 'dark']) {
    const s = await session({ settings: { theme, pinyin: 'all', toneColors: true, fontSize: 24 } });
    const { page } = s;
    check(await page.evaluate(() => document.documentElement.dataset.theme) === theme, `${theme} theme is applied`);
    await s.shot(`${theme}-library`);
    await s.addSample('孔乙己');
    const w = await s.wordRect('酒店');
    await page.mouse.click(w.x, w.y);
    await sleep(450);
    await s.shot(`${theme}-reader-popup`);
    const colors = await page.evaluate(() => {
      // Resolve any CSS color (rgb(), color(srgb ...), color-mix()) to [r, g, b, a] in 0-255 sRGB via a canvas.
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      const parse = (c) => {
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = '#000'; cx.fillStyle = c;
        cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const bgOf = (el) => {
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (c.length === 3 || (c.length === 4 && c[3] > 0.95)) return c.slice(0, 3);
        }
        return [255, 255, 255];
      };
      const pick = (sel) => {
        const el = document.querySelector(sel);
        return el ? { fg: parse(getComputedStyle(el).color).slice(0, 3), bg: bgOf(el) } : null;
      };
      const toneColors = [1, 2, 3, 4].map((n) => pick(`.rd-article rt.tone-${n}, .rd-article .tone-${n} rt`)).filter(Boolean);
      return {
        body: pick('.rd-article .rd-c, .rd-article .rd-p'),
        pinyin: pick('.rd-article rt'),
        popup: pick('.pp-pop'),
        popupMuted: pick('.pp-pop .pp-muted, .pp-pop .pp-section'),
        topbar: pick('.rd-bar'),
        toneColors,
      };
    });
    const row = (label, c, min) => { if (c) check(ratio(c.fg, c.bg) >= min, `${theme}: ${label} contrast ${ratio(c.fg, c.bg).toFixed(2)} (needs ${min})`); };
    row('body text', colors.body, 7);
    row('pinyin', colors.pinyin, 4.5);
    row('popup text', colors.popup, 7);
    row('popup secondary text', colors.popupMuted, 3);
    colors.toneColors.forEach((c, i) => row(`tone ${i + 1} pinyin`, c, 3));
    await page.keyboard.press('Escape');
    await s.goto('#/settings');
    await page.waitForSelector('.set-page, .page');
    await s.shot(`${theme}-settings`);
    await s.goto('#/about');
    await s.shot(`${theme}-about`);
    await s.done();
  }
};

scenarios.mobile = async () => {
  const s = await session({ mobile: true, settings: { pinyin: 'all', fontSize: 22 } });
  const { page } = s;
  for (const [hash, name] of [['#/', 'library'], ['#/vocab', 'vocab'], ['#/review', 'review'], ['#/settings', 'settings'], ['#/about', 'about']]) {
    await s.goto(hash);
    await sleep(300);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} has no horizontal scroll at 390px`);
    await s.shot(name, { fullPage: name === 'settings' || name === 'about' });
  }
  await s.addSample('孔乙己');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'reader has no horizontal scroll at 390px');
  await s.shot('reader');
  const w = await s.wordRect('酒店');
  await page.touchscreen.tap(w.x, w.y);
  await sleep(600);
  check(await page.$('.pp-pop.pp-sheet') !== null, 'tapping a word opens a bottom sheet');
  const sheet = await page.$eval('.pp-pop', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
  check(sheet.l >= -1 && sheet.r <= sheet.vw + 1 && sheet.b <= sheet.vh + 1, 'the sheet fits the screen');
  const w2 = await s.wordRect('酒店');
  const sheetTop = await page.$eval('.pp-pop', (e) => e.getBoundingClientRect().top);
  check(!!w2 && w2.y < sheetTop, `the tapped word stays visible above the sheet (word y ${Math.round(w2?.y ?? 0)}, sheet top ${Math.round(sheetTop)})`);
  await s.shot('reader-sheet');
  await page.keyboard.press('Escape');
  await page.click('.rd-aa-btn');
  await sleep(300);
  await s.shot('reader-aa');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Aa menu does not overflow the screen');
  await s.done();
};


// The Pages layout: two-page spread, turning by key and tap, chapter flow, position kept over a reload.
scenarios.pages = async () => {
  const s = await session({ width: 1440, height: 900, settings: { layout: 'pages', pinyin: 'all', fontSize: 22 } });
  const { page } = s;
  const info = () => page.evaluate(() => ({ ...document.querySelector('.rd-stage')?.dataset }));
  const settled = async (ms = 1000) => { await sleep(ms); return info(); };
  await s.addSample('红楼梦'); // classic titles show in the reading script (simplified by default)
  await page.waitForSelector('.rd-stage[data-pages]', { timeout: 30000 });
  await sleep(700);
  let st = await info();
  check(st.per === '2', `Pages shows a two-page spread at 1440x900 (per=${st.per}, ${st.pages} pages)`);
  check(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1), 'the page itself does not scroll');
  const geometry = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.rd-article.rd-live')];
    const live = pages[0].getBoundingClientRect();
    return { w: live.width, h: live.height, top: live.top, left: live.left };
  });
  check(geometry.h <= 900 && geometry.h > 500, `the text block fits the screen (${Math.round(geometry.h)} px tall)`);
  check(await page.$('.rd-hdr') !== null && await page.$('.rd-ftr') !== null, 'pages have a header and a footer');
  await s.shot('spread');

  const first = Number(st.page);
  await page.keyboard.press('ArrowRight');
  st = await settled();
  check(Number(st.page) === first + 2, `ArrowRight turns a whole spread (page ${first} -> ${st.page})`);
  await page.keyboard.press('ArrowLeft');
  st = await settled();
  check(Number(st.page) === first, `ArrowLeft turns back (page ${st.page})`);
  await page.keyboard.press('Space');
  st = await settled();
  check(Number(st.page) === first + 2, `Space turns forward (page ${st.page})`);
  await page.keyboard.press('Shift+Space').catch(() => {});
  await page.keyboard.down('Shift'); await page.keyboard.press('Space'); await page.keyboard.up('Shift');
  st = await settled();
  check(Number(st.page) === first, `Shift+Space turns back (page ${st.page})`);

  // A tap on the outer margin turns; a tap in the middle does not.
  const before = Number(st.page);
  await page.mouse.click(1425, 450);
  st = await settled();
  check(Number(st.page) === before + 2, `a tap on the right edge turns forward (page ${st.page})`);
  await page.mouse.click(15, 450);
  st = await settled();
  check(Number(st.page) === before, `a tap on the left edge turns back (page ${st.page})`);

  // Mid-flip screenshot.
  await page.keyboard.press('ArrowRight');
  await sleep(180);
  await s.shot('flip-mid', {});
  await sleep(900);

  // A word tap looks the word up and does not turn the page.
  const w = await page.evaluate(() => {
    const ws = [...document.querySelectorAll('.rd-article.rd-live .rd-p .rd-w')].filter((el) => { const r = el.getBoundingClientRect(); return el.querySelectorAll('ruby').length >= 2 && r.left > 200 && r.right < innerWidth - 200 && r.top > 120 && r.bottom < innerHeight - 100; });
    const el = ws[4]; const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 };
  });
  const pg = Number((await info()).page);
  await page.mouse.click(w.x, w.y);
  await sleep(500);
  check(await page.$('.pp-pop') !== null, 'a tap on a word opens its popup in Pages');
  check(Number((await info()).page) === pg, 'the word tap did not turn the page');
  await s.shot('popup');
  await page.keyboard.press('Escape');

  // Chapter flow: keep turning until the chapter number changes.
  const startChapter = (await info()).chapter;
  let turns = 0;
  while ((await info()).chapter === startChapter && turns < 80) {
    await page.keyboard.press('ArrowRight');
    await sleep(520);
    turns++;
  }
  await sleep(800);
  st = await info();
  check(st.chapter !== startChapter && Number(st.page) <= 2, `turning past the last page flows into the next chapter (chapter ${startChapter} -> ${st.chapter} after ${turns} turns, page ${st.page})`);
  await page.keyboard.press('ArrowLeft');
  await sleep(1000);
  st = await info();
  check(st.chapter === startChapter, `turning back from the first page returns to the previous chapter (${st.chapter})`);

  // Position survives a reload: go a few spreads in, wait for the save, reload.
  for (let i = 0; i < 2; i++) { await page.keyboard.press('ArrowLeft'); await sleep(520); }
  const keep = await info();
  await sleep(1800);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.rd-stage[data-pages]', { timeout: 30000 });
  await sleep(1200);
  const after = await info();
  check(after.chapter === keep.chapter && after.block === keep.block, `the reading position is kept after a reload (chapter ${keep.chapter} block ${keep.block} -> chapter ${after.chapter} block ${after.block})`);

  // A narrow window falls back to a single page and keeps its place.
  await page.setViewport({ width: 820, height: 1100, deviceScaleFactor: 1 });
  await sleep(1500);
  const narrow = await info();
  check(narrow.per === "1" && narrow.chapter === keep.chapter, `a portrait window shows one page (per=${narrow.per}) in the same chapter (${keep.chapter}:${keep.block} -> ${narrow.chapter}:${narrow.block})`);
  await s.shot('portrait');
  await s.done();
};

// 射雕英雄传: names the dictionary lacks become single words with name pinyin, and the popup explains them.
scenarios.lexicon = async () => {
  if (!existsSync(SHEDIAO)) { skipped++; console.log(`SKIP [lexicon] ${SHEDIAO} not found`); return; }
  const s = await session({ width: 1440, height: 900, settings: { pinyin: 'all', fontSize: 24, layout: 'scroll' } });
  const { page } = s;
  await s.goto('#/');
  await page.waitForSelector('.lib-page');
  await (await page.$('input[type=file]')).uploadFile(SHEDIAO);
  await page.waitForSelector('.lib-card-main', { timeout: 90000 });
  const id = await page.$eval('.lib-card-main', (a) => decodeURIComponent(a.getAttribute('href').split('/read/')[1].split('?')[0]));
  check(true, 'the book imported through the file input');
  const t0 = Date.now();
  await page.evaluate((i) => { location.hash = `#/read/${encodeURIComponent(i)}?ch=11`; }, id);
  await s.waitReader();
  // Detection runs in the background on first open; the chapter redraws when it is done.
  const found = await page.waitForFunction(() => [...document.querySelectorAll('.rd-article .rd-w')].some((el) => [...el.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('') === '郭靖'), { timeout: 90000, polling: 250 }).then(() => true, () => false);
  check(found, `detection finishes and 郭靖 renders as one word (${((Date.now() - t0) / 1000).toFixed(1)} s after opening)`);
  const wordInfo = (t) => page.evaluate((needle) => {
    const el = [...document.querySelectorAll('.rd-article .rd-w')].find((e) => [...e.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('') === needle);
    return el ? [...el.querySelectorAll('rt')].map((r) => r.textContent).join(' ') : null;
  }, t);
  const names = { '郭靖': 'guō jìng', '黄蓉': 'huáng róng', '欧阳锋': 'ōu yáng fēng', '洪七公': 'hóng qī gōng' };
  for (const [name, py] of Object.entries(names)) {
    const got = await wordInfo(name);
    if (got === null && name !== '郭靖' && name !== '黄蓉') { console.log(`     ${name} not in this chapter`); continue; }
    check(got === py, `${name} is one word and reads ${py} (got ${got})`);
  }
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'no horizontal scroll');
  await s.shot('chapter');

  // The popup leads with the In this book card.
  const w = await s.wordRect('郭靖');
  await page.mouse.click(w.x, w.y);
  await sleep(600);
  const card = flat(await page.$eval('.pp-book', (e) => e.innerText).catch(() => ''));
  check(/In this book/i.test(card) && /Person/.test(card) && /guō jìng/i.test(card), `the popup shows the In this book card (${card.slice(0, 80)})`);
  check(await page.$eval('.pp-body', (b) => b.firstElementChild.classList.contains('pp-book')).catch(() => false), 'the card comes first in the popup');
  await s.shot('popup-card');

  // "Not a word" splits it again; Undo brings it back.
  const clickBtn = (label) => page.evaluate((l) => { const b = [...document.querySelectorAll('.btn, .app-toast button')].find((x) => x.textContent.trim() === l); if (b) b.click(); return !!b; }, label);
  check(await clickBtn('Not a word'), 'Not a word is offered');
  await sleep(900);
  check(await wordInfo('郭靖') === null, '郭靖 is split into separate words after Not a word');
  check(await clickBtn('Undo'), 'the toast offers Undo');
  await sleep(1200);
  check(await wordInfo('郭靖') === 'guō jìng', '郭靖 is one word again after Undo');

  // Edit the pinyin through the popup.
  const w2 = await s.wordRect('黄蓉');
  await page.mouse.click(w2.x, w2.y);
  await sleep(500);
  await clickBtn('Edit');
  await sleep(200);
  await page.$eval('.pp-lex-form input', (i) => { i.value = 'huang2 rong1'; });
  await page.evaluate(() => document.querySelector('.pp-lex-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
  await sleep(1200);
  check(await wordInfo('黄蓉') === 'huáng rōng', `an edited reading reaches the page (${await wordInfo('黄蓉')})`);
  await page.keyboard.press('Escape');

  // Names & terms list in the contents drawer.
  await page.keyboard.press('c');
  await sleep(500);
  const tab = await page.evaluate(() => { const t = [...document.querySelectorAll('.rd-toc-tab')].find((b) => /Names/i.test(b.textContent)); if (t) t.click(); return !!t; });
  check(tab, 'the contents drawer has a Names & terms tab');
  await sleep(500);
  // The list is windowed: only the rows near the viewport exist, so read the total from the sizer's height.
  const { drawn, rows } = await page.$eval('.rd-names', (list) => {
    const rowEls = list.querySelectorAll('.rd-toc-row');
    const sizer = list.querySelector('.rd-toc-sizer');
    const rowH = rowEls[0]?.getBoundingClientRect().height || 0;
    return { drawn: rowEls.length, rows: rowH && sizer ? Math.round(sizer.getBoundingClientRect().height / rowH) : 0 };
  });
  check(drawn > 5 && rows > 50, `the list shows the detected names (${rows} rows, ${drawn} drawn)`);
  await s.shot('names-tab');
  await page.keyboard.press('Escape');

  // It was saved: after a reload the names are there at once.
  await page.reload({ waitUntil: 'networkidle0' });
  await s.waitReader();
  const t1 = Date.now();
  const again = await page.waitForFunction(() => [...document.querySelectorAll('.rd-article .rd-w')].some((el) => [...el.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('') === '郭靖'), { timeout: 15000, polling: 100 }).then(() => true, () => false);
  check(again, `the names are remembered after a reload (${Date.now() - t1} ms)`);
  check(await wordInfo('黄蓉') === 'huáng rōng', 'and so is the edited reading');

  // Pages layout: the same names are single words.
  // The page can be usable while a worker/font fetch is still active. Assert the rendered
  // stage/name below instead of waiting for every background request to become idle.
  await s.setSettings({ layout: 'pages' }, 'domcontentloaded');
  await page.waitForSelector('.rd-stage[data-pages]', { timeout: 30000 });
  await sleep(1200);
  const inPages = await page.evaluate(() => [...document.querySelectorAll('.rd-article.rd-live .rd-w')].some((el) => [...el.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('') === '郭靖'));
  check(inPages, '郭靖 is one word in the Pages layout too');
  await s.shot('pages');
  await s.done();
};

// Kindle files: MOBI and AZW3 without DRM (public-domain 道德經 fixtures from Project Gutenberg).
scenarios.mobi = async () => {
  const files = [MOBI, AZW3].filter((f) => existsSync(f));
  if (!files.length) { skipped++; console.log('SKIP [mobi] no fixture in tests/fixtures/import'); return; }
  const s = await session({ settings: { pinyin: 'all', fontSize: 24, layout: 'scroll' } });
  const { page } = s;
  await s.goto('#/');
  await page.waitForSelector('.lib-page');
  const accept = await page.$eval('input[type=file]', (i) => i.accept);
  check(/\.mobi/.test(accept) && /\.azw3/.test(accept), `the file picker accepts Kindle files (${accept})`);
  await (await page.$('input[type=file]')).uploadFile(files[0]);
  // The pending card has the file name as its title; the finished card is a different one (.lib-card[data-id]).
  await page.waitForSelector('.lib-card[data-id] .lib-card-main', { timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('.lib-card-pending'), { timeout: 60000 });
  const { title, id } = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.lib-card[data-id]')].find((c) => /道/.test(c.querySelector('.lib-card-title')?.textContent ?? ''));
    const a = card?.querySelector('.lib-card-main');
    return { title: card?.querySelector('.lib-card-title')?.textContent ?? '', id: a ? decodeURIComponent(a.getAttribute('href').split('/read/')[1].split('?')[0]) : '' };
  });
  check(/道/.test(title) && !!id, `${files[0].split('/').pop()} imported as "${title}"`);
  await s.shot('library');
  await page.evaluate((i) => { location.hash = `#/read/${encodeURIComponent(i)}`; }, id);
  await s.waitReader();
  await page.keyboard.press('c');
  await sleep(600);
  const n = await page.$$eval('.rd-toc-item', (els) => els.length);
  check(n > 5, `the Kindle contents became ${n} chapters`);
  await page.keyboard.press('Escape');
  await page.evaluate((i) => { location.hash = `#/read/${encodeURIComponent(i)}?ch=4`; }, id);
  await sleep(500);
  await s.waitReader();
  const w = await s.anyWord(1, 6);
  await page.mouse.click(w.x, w.y);
  await sleep(500);
  check(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test((await s.popupText()) ?? ''), `lookup works in the Kindle book (${w.text})`);
  await s.shot('reader');
  if (files[1]) {
    await s.goto('#/');
    await page.waitForSelector('.lib-page');
    await (await page.$('input[type=file]')).uploadFile(files[1]);
    // The same book in another format is recognized, not added twice.
    await page.waitForFunction(() => /already in your library/.test(document.body.textContent ?? ''), { timeout: 60000 })
      .then(() => check(true, 'the AZW3 of the same book is recognized as already in the library'), () => check(false, 'the AZW3 of the same book is recognized as already in the library'));
  }
  await s.done();
};

// The service worker is registered in production builds only, so this scenario skips itself on the dev server.
scenarios.offline = async () => {
  const s = await session({ settings: { pinyin: 'unknown', fontSize: 24 } });
  const { page } = s;
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 8000))]);
    return !!reg;
  });
  if (!registered) { skipped++; console.log('SKIP [offline] no service worker (dev server?)'); await s.done(); return; }
  await s.addSample('孔乙己'); // fetches the sample while online
  const hash = await page.evaluate(() => location.hash);
  // Wait until the worker controls the page and has finished precaching.
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 10000 }).catch(() => {});
  await page.reload({ waitUntil: 'networkidle0' });
  const cached = await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('dushu-')));
  check(cached.length >= 2, `the worker keeps an app cache and a data cache (${cached.join(', ')})`);
  await page.setOfflineMode(true);
  await page.goto(BASE + hash, { waitUntil: 'load' }).catch(() => {});
  await s.waitReader().catch(() => {});
  check(await page.$('.rd-article .rd-w') !== null, 'the reader opens a saved book with the network off');
  const w = await s.wordRect('酒店');
  if (w) {
    await page.mouse.click(w.x, w.y);
    await sleep(500);
    check(/jiǔ\s*diàn/.test((await s.popupText()) ?? ''), 'lookup works offline');
  } else check(false, 'found 酒店 offline');
  await page.keyboard.press('Escape');
  await s.goto('#/about');
  check(await page.waitForSelector('.ab-page', { timeout: 8000 }).then(() => true, () => false), 'other screens load offline (lazy chunks come from the cache)');
  await page.setOfflineMode(false);
  await s.done();
};

// -------------------------------------------------------------------------------------------------
const names = scenarioArg === 'all' ? Object.keys(scenarios) : scenarioArg.split(',');
for (const name of names) {
  if (!scenarios[name]) { console.log(`FAIL unknown scenario "${name}" (try: ${Object.keys(scenarios).join(', ')}, all)`); failed++; continue; }
  current = name;
  console.log(`\n== ${name} (${BASE})`);
  // If Chrome itself went away in the scenario before (it did once in a full run on a busy machine: "Target closed" in
  // [pages], then "Connection closed" for every scenario after it), that scenario has already failed; start a new Chrome.
  if (!browser.connected) {
    console.log('   (Chrome was gone after the last scenario; starting a new one)');
    browser = await launch();
  }
  try {
    await scenarios[name]();
  } catch (e) {
    failed++;
    console.log(`FAIL [${name}] threw: ${e?.stack ?? e}`);
  }
}
await browser.close();
console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failed ? 1 : 0);
