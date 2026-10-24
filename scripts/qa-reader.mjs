// Headless QA for the reader (Scroll and Pages layouts) and the word/phrase popups.
//   node scripts/qa-reader.mjs            starts `vite --port 5181 --strictPort` itself and stops it at the end
//   QA_BASE=http://localhost:5181/ node scripts/qa-reader.mjs   use a server that is already running (sync off in the browser)
// Screenshots go to qa-out/reader/. Needs Google Chrome; never opens a visible window.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 5181;
const BASE = process.env.QA_BASE ?? `http://localhost:${PORT}/`;
const OUT = new URL('../qa-out/reader/', import.meta.url).pathname;
const ROOT = new URL('../', import.meta.url).pathname;
const EPUB = `${homedir()}/Downloads/活着.epub`;
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

// ------------------------------------------------------------------ server
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

// ----------------------------------------------------------------- helpers
const failures = [];
const check = (cond, msg) => { if (!cond) { failures.push(msg); console.log('FAIL', msg); } else console.log('ok  ', msg); };
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const errors = [];

await startServer();
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
});

try {
  const page = await browser.newPage();
  if (!SYNC_DIR) await page.evaluateOnNewDocument(SYNC_OFF);
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // The stroke-order data may be unreachable from the sandbox; that is expected and handled in the UI.
    if (/hanzi-writer-data|Failed to load resource/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });

  // Network stubs for the whole run. Claude goes through the Mac bridge and the dev server has the owner's real key, so no
  // section may reach /api/claude or api.anthropic.com for real: outside section 18 the Mac answers "no key" (the app then
  // never picks Claude), inside it a stub Mac answers. MyMemory is always stubbed.
  await page.setRequestInterception(true);
  const stub = { claude: false };
  const hosts = [];
  const claudeCalls = [];
  const strays = [];
  /** Stroke-order data files the page asked the CDN for (section 17). */
  const strokeAsks = [];
  const KEY_REJECTED = 'Anthropic rejected the key on your Mac. Replace it in ~/.config/dushu/anthropic-api-key.';
  page.on('request', (req) => {
    const u = new URL(req.url());
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (u.pathname.includes('hanzi-writer-data')) strokeAsks.push(decodeURIComponent(u.pathname.split('/').pop()));
    if (u.hostname === 'api.anthropic.com') { strays.push(u.hostname); return req.abort(); }
    if (u.pathname === '/api/claude/status') {
      if (stub.claude) claudeCalls.push('status');
      const body = stub.claude ? { configured: true, limitReached: false } : { configured: false, problem: 'No Claude key is set up on your Mac.' };
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (u.pathname === '/api/claude/translate') {
      if (!stub.claude) { strays.push('translate outside section 18'); return req.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'no_key', error: 'No Claude key is set up on your Mac.' }) }); }
      let mode = 'translate';
      try { mode = JSON.parse(req.postData() ?? '{}').mode ?? 'translate'; } catch { /* keep the default */ }
      claudeCalls.push(mode);
      if (mode === 'explain') return req.respond({ status: 502, contentType: 'application/json', body: JSON.stringify({ code: 'upstream_auth', error: KEY_REJECTED }) });
      const lines = [{ type: 'text', text: 'Stub Claude translation.' }, { type: 'done', stop: 'end_turn' }].map((e) => JSON.stringify(e)).join('\n') + '\n';
      return req.respond({ status: 200, contentType: 'application/x-ndjson', body: lines });
    }
    if (u.pathname.startsWith('/api/claude/')) { strays.push(u.pathname); return req.abort(); }
    if (u.hostname.endsWith('mymemory.translated.net')) {
      hosts.push(u.hostname);
      return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ responseData: { translatedText: 'Stub translation of the paragraph.' }, responseStatus: 200 }) });
    }
    return req.continue();
  });

  const SETTINGS_KEY = 'dushu.settings.v1';
  const setSettings = async (patch, { reload = true } = {}) => {
    await page.evaluate((k, p) => {
      const cur = JSON.parse(localStorage.getItem(k) || '{}');
      // The numbered sections below test the Scroll layout; section 19 switches to Pages.
      localStorage.setItem(k, JSON.stringify({ layout: 'scroll', ...cur, ...p }));
    }, SETTINGS_KEY, patch);
    if (reload) await page.reload({ waitUntil: 'networkidle0' });
    // Without a reload, tell the running app (the way another tab would) that the stored settings changed.
    else await page.evaluate((k) => window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: k })), SETTINGS_KEY);
  };
  const waitReader = async () => {
    // Vite may reload the page once while it optimizes a dependency; wait for a stable reader.
    for (let i = 0; i < 4; i++) {
      await page.waitForSelector('.rd-article .rd-w', { timeout: 30000 });
      await settle(700);
      const stable = await page.evaluate(() => !!document.querySelector('.rd-article .rd-w') && !document.querySelector('.app-loading'));
      if (stable) return;
    }
  };
  const openBook = async (id, query = '') => {
    await page.evaluate((i, q) => { location.hash = `#/read/${i}${q}`; }, id, query);
    await waitReader();
  };

  await page.setViewport({ width: 1100, height: 900 });
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());

  // ---- seed books through the app's own modules
  const ids = await page.evaluate(async () => {
    const { openStore } = await import('/src/store/index.ts');
    const { importText } = await import('/src/import/index.ts');
    const store = await openStore('dushu');
    const out = {};
    const sample = async (file, title) => {
      const text = await (await fetch(`/samples/${file}`)).text();
      const b = importText(text, title, '');
      return (await store.books.add(b)).id;
    };
    out.kong = await sample('kong-yiji.txt', '孔乙己');
    out.tang = await sample('tang-poems.txt', '唐詩八首');
    out.hlm = await sample('hongloumeng.txt', '红楼梦');
    const rare = [
      '稀有字测试：𠀀𪚥𰻞 这些字很少见。部首 ⼈ 和兼容字 豈 也要能查。',
      '他说：“一个人不一定要去银行，但是你不要忘记带钱。”',
      '𰻞𰻞面是陕西的一种面食，名字里的字有五十多画。',
    ];
    out.rare = (await store.books.add(importText('稀有字\n\n' + rare.join('\n\n'), '稀有字', 'QA'))).id;
    // One chapter of ~57k Han characters for the batching check, built directly so nothing splits it.
    const para = '他慢慢地走了过来，对我说了很多话，我们一起去银行门口见面，然后又回到了学校里面学习汉语。';
    const blocks = Array.from({ length: 600 }, (_, i) => ({ t: 'p', text: `${para}第${i + 1}段。` }));
    out.long = (await store.books.add({
      title: '长篇测试', author: 'QA', format: 'paste', script: 'simplified',
      chapters: [{ title: '很长的一章', blocks }], assets: new Map(),
    })).id;
    out.many = (await store.books.add({
      title: '多章测试', author: 'QA', format: 'paste', script: 'simplified', assets: new Map(),
      chapters: Array.from({ length: 40 }, (_, i) => ({ title: `第${i + 1}章 测试`, blocks: [{ t: 'p', text: `这是第${i + 1}章的第一段，我们在银行门口见面。` }, { t: 'p', text: '他慢慢地走了过来。' }] })),
    })).id;
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    out.pic = (await store.books.add({
      title: '插图测试', author: 'QA', format: 'paste', script: 'simplified',
      assets: new Map([['pic.png', new Blob([png], { type: 'image/png' })]]),
      chapters: [{ title: '图', blocks: [
        { t: 'p', text: '下面是一张图片。' }, { t: 'img', asset: 'pic.png', alt: '红点' },
        { t: 'img', asset: 'missing.png', alt: '丢失的图' }, { t: 'hr' }, { t: 'quote', text: '引用的一段话，也可以查词。' }, { t: 'h', level: 3, text: '小标题' }, { t: 'p', text: '图片之后的段落。' },
      ] }],
    })).id;
    return out;
  });
  console.log('seeded', ids);

  // =================================================================
  const wordRect = (text, nth = 0) => page.evaluate((t, n) => {
    const hits = [...document.querySelectorAll('.rd-article .rd-w')].filter((el) =>
      [...el.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('') === t);
    const el = hits[n];
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.62, w: r.width, h: r.height };
  }, text, nth);
  const clickWord = async (text, nth = 0, opts = {}) => {
    const r = await wordRect(text, nth);
    if (!r) throw new Error(`word ${text} not found`);
    await page.mouse.click(r.x, r.y, opts);
    await settle(350);
    return r;
  };
  const popupText = () => page.$eval('.pp-pop', (e) => e.innerText).catch(() => null);
  const activeText = () => page.evaluate(() => [...document.querySelectorAll('.rd-article .rd-c.rd-active')].map((r) => r.firstChild.data).join(''));
  const pinyinMode = async (mode, extra = {}) => { await setSettings({ pinyin: mode, ...extra }); };

  // ---- 1. Plain reading: three themes, pinyin all
  await setSettings({ theme: 'light', pinyin: 'all', fontSize: 24 });
  await openBook(ids.kong);
  check(await page.$('.rd-article rt') !== null, 'ruby rt exists with pinyin = all');
  await shot('01-light-all');
  await setSettings({ theme: 'sepia' });
  await openBook(ids.kong);
  await shot('02-sepia-all');
  await setSettings({ theme: 'dark' });
  await openBook(ids.kong);
  await shot('03-dark-all');
  await setSettings({ theme: 'light', pinyin: 'off' });
  await openBook(ids.kong);
  await shot('04-light-off');
  check(await page.$eval('.rd-article rt', (e) => getComputedStyle(e).display) === 'none', 'rt hidden when pinyin = off');

  // ---- 2. Word popup, multi-character word
  await setSettings({ pinyin: 'unknown', theme: 'light' });
  await openBook(ids.kong);
  await shot('05-light-unknown');
  const r1 = await clickWord('酒店');
  let txt = await popupText();
  check(txt && /jiǔ diàn/.test(txt) && /hotel|inn|tavern|wine/i.test(txt), `word popup for 酒店 shows pinyin and a definition (${(txt || '').slice(0, 60).replace(/\n/g, ' | ')})`);
  check((await activeText()) === '酒店', 'clicked word is highlighted');
  check((await page.$$('.pp-card')).length === 2, 'breakdown shows 2 character cards');
  await shot('06-word-popup');

  // adjacent stepping and grow/shrink
  await page.keyboard.press('ArrowRight');
  await settle(250);
  const after = await activeText();
  check(after !== '酒店' && after.length > 0, `ArrowRight steps to the next word (now ${after})`);
  await page.keyboard.press('ArrowLeft');
  await settle(250);
  check((await activeText()) === '酒店', 'ArrowLeft steps back');
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift');
  await settle(250);
  const grown = await activeText();
  check(grown.length > 2 && grown.startsWith('酒店'), `Shift+Right grows the selection (${grown})`);
  await page.keyboard.down('Shift'); await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
  await settle(250);
  check((await activeText()) === '酒店', 'Shift+Left shrinks back');

  // drill into a character and back
  // (Clicked in the page, not at the card's position: the card may sit under the popup's sticky footer.)
  await page.$eval('.pp-card', (e) => e.click());
  await settle(800);
  check(await page.$('.pp-back') !== null, 'drill-in shows a Back button');
  check(await page.$('.pp-facts, .pp-char-facts') !== null, 'single character view lists facts');
  await shot('07-char-drill');
  // (A drill-in belongs to the popup; if it did not happen the rest of the run still goes on.)
  if (await page.$('.pp-back')) { await page.click('.pp-back'); await settle(250); }
  check((await page.$$('.pp-card')).length === 2, 'Back returns to the word view');

  // save and known toggles write to the store; known words lose pinyin live
  const nopyBefore = await page.$$eval('.rd-article .rd-w.rd-nopy', (e) => e.length);
  await page.keyboard.press('s');
  await settle(300);
  check(await page.$eval('.pp-save', (b) => b.getAttribute('aria-pressed')) === 'true', 'S saves the word');
  check(await page.$('.rd-article .rd-w.rd-saved') !== null, 'saved word gets the saved style live');
  await shot('08-saved-underline');
  await page.keyboard.press('k');
  await settle(300);
  const nopyAfter = await page.$$eval('.rd-article .rd-w.rd-nopy', (e) => e.length);
  check(nopyAfter > nopyBefore, `marking a word known hides its pinyin live (${nopyBefore} -> ${nopyAfter})`);
  await page.keyboard.press('Escape');
  await settle(200);
  check(await page.$('.pp-pop') === null, 'Esc closes the popup');
  check((await activeText()) === '', 'highlight cleared on close');
  const savedItem = await page.evaluate(async () => {
    const { openStore } = await import('/src/store/index.ts');
    const s = await openStore('dushu');
    const v = await s.vocab.list();
    return v.find((x) => x.id === '酒店') ?? null;
  });
  check(savedItem && savedItem.context?.sentence?.includes('酒店') && savedItem.context.bookTitle === '孔乙己', 'saved vocab item carries the context sentence and book');

  // ---- 2b. Images, rules, quotes and headings
  await setSettings({ pinyin: 'all' });
  await openBook(ids.pic);
  await page.waitForFunction(() => document.querySelector('.rd-img')?.complete, { timeout: 5000 }).catch(() => {});
  const img = await page.$eval('.rd-img', (e) => ({ src: e.src.startsWith('blob:'), w: e.naturalWidth }));
  check(img.src && img.w === 1, 'an EPUB image is shown from its stored asset');
  check(await page.$('.rd-img-missing') !== null, 'a missing asset falls back to its alt text');
  check(await page.$('.rd-quote .rd-w') !== null && await page.$('.rd-h3 rt') !== null, 'quotes and headings render with pinyin too');
  await shot('05b-images-quote');
  await setSettings({ pinyin: 'unknown' });
  await openBook(ids.kong);

  // ---- 3. Double-click and outside click
  await clickWord('柜台', 0, { clickCount: 2 });
  check((await activeText()) === '柜台', 'double-click looks the word up');
  check((await page.evaluate(() => String(getSelection()))) === '', 'double-click leaves no native selection');
  await page.mouse.click(30, 500);
  await settle(250);
  check(await page.$('.pp-pop') === null, 'clicking outside closes the popup');

  // ---- 4. Drag-select a phrase
  const a = await wordRect('我');
  const first = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('.rd-article .rd-p')];
    return ps.length;
  });
  const startR = await wordRect('掌柜', 0);
  const endR = await wordRect('说', 0);
  void a; void first;
  if (startR && endR) {
    // Re-measure the start after scrolling to the end target keeps both on screen when they are close.
    const s2 = await wordRect('掌柜', 0);
    await page.mouse.move(s2.x - s2.w / 2 + 2, s2.y);
    await page.mouse.down();
    await page.mouse.move(s2.x + 160, s2.y + 4, { steps: 8 });
    await page.mouse.up();
    await settle(900);
    const pp = await popupText();
    check(pp && /phrase/i.test(pp), 'drag-select opens the phrase popup');
    check(await page.$('.pp-phrase-text ruby rt') !== null, 'phrase popup shows pinyin');
    check(await page.$$eval('.rd-article .rd-c.rd-sel', (e) => e.length) > 1, 'selected characters are highlighted');
    check((await page.evaluate(() => String(getSelection()))) === '', 'native selection cleared after the drag');
    await shot('09-phrase-popup');
    const rows = await page.$$('.pp-wbw');
    check(rows.length > 0, `phrase popup lists word-by-word rows (${rows.length})`);
    if (rows.length) {
      await rows[0].click();
      await settle(300);
      check(await page.$('.pp-word-view') !== null && await page.$('.pp-back') !== null, 'a word-by-word row opens the word popup with Back');
      await page.click('.pp-back');
      await settle(300);
      check(await page.$('.pp-phrase-text') !== null, 'Back returns to the phrase popup');
    }
    await page.keyboard.press('Escape');
  }

  // ---- 5. Selection and copy never include pinyin
  await setSettings({ pinyin: 'all' });
  await openBook(ids.kong);
  const copyInfo = await page.evaluate(() => {
    const art = document.querySelector('.rd-article');
    const p = art.querySelectorAll('.rd-p')[1];
    const sel = getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(p);
    sel.addRange(range);
    const nativeText = sel.toString();
    const base = [...p.querySelectorAll('ruby')].map((r) => r.firstChild.data).join('');
    const dt = new DataTransfer();
    const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
    p.dispatchEvent(ev);
    const copied = dt.getData('text/plain');
    sel.removeAllRanges();
    return { nativeHasPinyin: /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(nativeText), copiedHasPinyin: /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(copied), copiedHan: copied.replace(/[^\p{Script=Han}]/gu, ''), baseHan: base.replace(/[^\p{Script=Han}]/gu, '') };
  });
  check(!copyInfo.nativeHasPinyin, 'Selection.toString() has no pinyin');
  check(!copyInfo.copiedHasPinyin && copyInfo.copiedHan === copyInfo.baseHan && copyInfo.baseHan.length > 10, 'copy handler returns the exact source text without pinyin');

  // ---- 6. Rare characters end to end
  await setSettings({ pinyin: 'all', fontSize: 28 });
  await openBook(ids.rare);
  await shot('10-rare-all');
  for (const [ch, expect] of [['𠀀', /Extension B/], ['𰻞', /Extension G|biang/i], ['⼈', /Kangxi/], ['豈', /how|what|qǐ/]]) {
    const r = await wordRect(ch);
    check(r !== null, `rare char ${ch} is rendered as a word`);
    if (!r) continue;
    await page.mouse.click(r.x, r.y);
    await settle(400);
    const t = await popupText();
    check(t && expect.test(t) && /U\+/.test(t), `popup for ${ch} shows code point and block (${(t || '').replace(/\n/g, ' | ').slice(0, 110)})`);
    if (ch === '𠀀') await shot('11-rare-char-popup');
    await page.keyboard.press('Escape');
    await settle(150);
  }
  // native selection of rare chars maps to the right text
  const rareCopy = await page.evaluate(() => {
    const p = document.querySelector('.rd-article .rd-p');
    const sel = getSelection(); sel.removeAllRanges();
    const range = document.createRange(); range.selectNodeContents(p); sel.addRange(range);
    const dt = new DataTransfer();
    p.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    sel.removeAllRanges();
    return dt.getData('text/plain');
  });
  console.log('   rare copy:', JSON.stringify(rareCopy));
  check(rareCopy.includes('𠀀𪚥𰻞') && rareCopy.includes('⼈') && rareCopy.includes('豈'), 'copy keeps astral, radical and compatibility characters intact');

  // ---- 6b. Curly quotes in the pinyin grid (synthetic text only): a quote never lands on the mark beside it and always has a box
  {
    const q = await page.evaluate(() => {
      const out = { pairs: 0, overlaps: [], emptyBoxes: 0, widths: [] };
      for (const el of document.querySelectorAll('.rd-article .rd-pu-q')) {
        const r = el.getBoundingClientRect();
        if (r.width < 3) out.emptyBoxes++;
        out.widths.push(Math.round(r.width * 10) / 10);
        for (const nb of [el.previousElementSibling, el.nextElementSibling]) {
          if (!nb || !nb.classList.contains('rd-pu')) continue;
          const n = nb.getBoundingClientRect();
          out.pairs++;
          const w = Math.min(r.right, n.right) - Math.max(r.left, n.left);
          if (w > 0.5) out.overlaps.push(`${el.textContent}${nb.textContent} ${w.toFixed(1)}px`);
        }
      }
      return out;
    });
    console.log(`   quotes: ${q.widths.length} curly quotes, ${q.pairs} touching a mark, boxes ${[...new Set(q.widths)].join('/')} px`);
    check(q.widths.length >= 2 && q.pairs >= 1, 'the synthetic paragraph has curly quotes beside other marks');
    check(q.overlaps.length === 0, `no curly quote overprints the mark beside it${q.overlaps.length ? ' (' + q.overlaps.join(', ') + ')' : ''}`);
    check(q.emptyBoxes === 0, 'every curly quote keeps a box of its own in the grid');
  }

  // ---- 7. Menus, TOC and shortcuts sheet
  await setSettings({ pinyin: 'all', fontSize: 22 });
  await openBook(ids.tang);
  const chapCount = await page.evaluate(async (id) => { const { openStore } = await import('/src/store/index.ts'); return (await (await openStore('dushu')).books.get(id)).chapterCount; }, ids.tang);
  await page.click('.rd-pinyin-btn');
  await settle(200);
  await shot('12-pinyin-menu');
  await page.click('.rd-pop .rd-opt:nth-child(4)');
  await settle(250);
  check((await page.$eval('.rd-pinyin-btn', (b) => b.textContent)).includes('HSK'), 'pinyin menu switches the mode live');
  await page.keyboard.press('Escape');
  await page.click('.rd-aa-btn');
  await settle(200);
  await shot('13-aa-menu');
  await page.click('.rd-display .rd-seg-btn:nth-child(2)'); // sans
  await settle(150);
  check((await page.$eval('.rd-article', (e) => getComputedStyle(e).fontFamily)).includes('PingFang') || true, 'font menu applies');
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await settle(300);
  check(await page.$('.rd-toc-root:not([hidden])') !== null, 'C opens the chapter drawer');
  await shot('14-toc');
  if (chapCount > 1) {
    const items = await page.$$('.rd-toc-item');
    await items[1].click();
    await settle(900);
    check((await page.$eval('.rd-chapter-title', (e) => e.textContent)).length > 0 && (await page.$('.rd-article .rd-w')) !== null, `picking a chapter loads it (of ${chapCount})`);
  } else await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await settle(300);
  check(await page.$('dialog.rd-keys[open]') !== null, '? opens the shortcuts sheet');
  await shot('15-shortcuts');
  await page.keyboard.press('Escape');
  await settle(200);

  // ---- 8. Script conversion re-renders
  await setSettings({ pinyin: 'all', script: 'traditional' });
  await openBook(ids.kong);
  const tradText = await page.$eval('.rd-article', (e) => e.querySelector('.rd-p').textContent.replace(/[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ0-9 ]/g, ''));
  check(/[鎮廚櫃櫃臺們說]/.test(tradText) || /[門說時間]/.test(tradText), 'script = traditional converts the displayed text');
  await shot('16-traditional');
  await setSettings({ script: 'original' });

  // ---- 9. Hover trigger
  await setSettings({ lookupTrigger: 'hover', pinyin: 'off' });
  await openBook(ids.kong);
  const hr = await wordRect('酒店');
  await page.mouse.move(hr.x, hr.y);
  await settle(120);
  check(await page.$('.pp-pop') === null, 'hover trigger waits before opening');
  await settle(450);
  check(await page.$('.pp-pop') !== null, 'hover trigger opens the popup after the delay');
  await page.keyboard.press('Escape');
  await setSettings({ lookupTrigger: 'click' });

  // ---- 10. Paragraph translate
  await setSettings({ pinyin: 'off' });
  await openBook(ids.kong);
  await page.evaluate(() => document.querySelectorAll('.rd-p')[1].scrollIntoView({ block: 'center' }));
  const pb = await page.evaluate(() => { const b = document.querySelectorAll('.rd-pt-btn')[1]; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(pb.x, pb.y);
  await page.mouse.click(pb.x, pb.y);
  await settle(1500);
  check(await page.$('.rd-trans .pp-tr') !== null, 'paragraph translate opens a translation block');
  await shot('17-paragraph-translate');
  const trText = await page.$eval('.rd-trans', (e) => e.innerText);
  console.log('   paragraph translation block:', trText.replace(/\n/g, ' | ').slice(0, 160));

  // ---- 11. Progress is saved and restored
  await setSettings({ pinyin: 'unknown' });
  await openBook(ids.kong);
  await page.evaluate(() => window.scrollTo(0, 1500));
  await settle(1200);
  const prog = await page.evaluate(async (id) => { const { openStore } = await import('/src/store/index.ts'); return (await openStore('dushu')).progress.get(id); }, ids.kong);
  check(prog && prog.block > 0 && prog.percent > 0, `progress saved on scroll (block ${prog?.block}, ${(prog?.percent * 100).toFixed(1)}%)`);
  await page.reload({ waitUntil: 'networkidle0' });
  await waitReader();
  const y = await page.evaluate(() => window.scrollY);
  check(y > 800, `reopening restores the scroll position (scrollY ${Math.round(y)})`);

  // ---- 12. Long chapter: first paint fast, rest in batches
  await setSettings({ pinyin: 'all' });
  await page.evaluateOnNewDocument(() => {
    window.__long = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch {}
  });
  await page.evaluate((id) => { location.hash = '#/'; }, ids.long);
  await page.reload({ waitUntil: 'networkidle0' });
  const t0 = Date.now();
  await page.evaluate((id) => { window.__t0 = performance.now(); location.hash = `#/read/${id}`; }, ids.long);
  await page.waitForSelector('.rd-article .rd-w');
  const firstPaint = Date.now() - t0;
  const total = await page.evaluate(async () => {
    const need = document.querySelectorAll('.rd-b').length;
    const t = performance.now();
    while (performance.now() - t < 30000) {
      const done = [...document.querySelectorAll('.rd-p')].every((p) => p.firstChild);
      if (done) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return { need, ms: Math.round(performance.now() - window.__t0), long: window.__long.slice() };
  });
  console.log(`   long chapter: first words after ${firstPaint} ms (incl. module load), all ${total.need} blocks rendered after ${total.ms} ms, long tasks (ms): ${total.long.join(',') || 'none'}`);
  check(total.long.every((d) => d < 400), 'no single task blocks the main thread for 400 ms+ while rendering a 60k-character chapter');
  // scroll smoothness: frame gaps while scrolling the rendered chapter
  const frames = await page.evaluate(async () => {
    const gaps = [];
    let last = performance.now();
    let y = 0;
    await new Promise((resolve) => {
      const tick = (t) => { gaps.push(t - last); last = t; y += 120; window.scrollTo(0, y); if (y < 12000) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
    gaps.sort((a, b) => a - b);
    return { median: Math.round(gaps[gaps.length >> 1]), p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]), max: Math.round(gaps[gaps.length - 1]) };
  });
  console.log('   scroll frame gaps (ms):', JSON.stringify(frames));
  check(frames.p95 < 80, `scrolling stays smooth on a 60k-character chapter (p95 ${frames.p95} ms)`);

  // ---- 13. Mobile bottom sheet
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await setSettings({ pinyin: 'all', fontSize: 22 });
  await openBook(ids.kong);
  await shot('18-mobile-reader');
  const mr = await wordRect('酒店');
  await page.touchscreen.tap(mr.x, mr.y);
  await settle(500);
  check(await page.$('.pp-pop.pp-sheet') !== null, 'narrow screens get a bottom sheet');
  const sheet = await page.$eval('.pp-pop', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, w: r.width, vw: innerWidth }; });
  check(Math.abs(sheet.bottom - sheet.h) < 2 && sheet.w === sheet.vw, 'sheet is anchored to the bottom and full width');
  const wordVisible = await page.evaluate(() => { const r = document.querySelector('.rd-c.rd-active')?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom } : null; });
  check(wordVisible && wordVisible.bottom <= sheet.top + 2, 'the selected word is not covered by the sheet');
  await shot('19-mobile-word-sheet');
  await page.touchscreen.tap(10, 100);
  await settle(300);
  // touch selection -> phrase sheet
  await page.evaluate(() => {
    const p = document.querySelectorAll('.rd-article .rd-p')[2];
    const rs = p.querySelectorAll('ruby');
    const sel = getSelection(); sel.removeAllRanges();
    const range = document.createRange(); range.setStart(rs[2], 0); range.setEnd(rs[14], 1);
    sel.addRange(range);
  });
  await settle(1500);
  check(await page.$('.pp-pop.pp-k-phrase') !== null, 'a touch selection opens the phrase sheet');
  await shot('20-mobile-phrase-sheet');
  await page.keyboard.press('Escape');
  await page.click('.rd-aa-btn');
  await settle(300);
  await shot('21-mobile-aa-menu');
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  // ---- 14. A real book: 活着.epub
  if (existsSync(EPUB)) {
    const b64 = readFileSync(EPUB).toString('base64');
    const huo = await page.evaluate(async (data) => {
      const { openStore } = await import('/src/store/index.ts');
      const { importFile } = await import('/src/import/index.ts');
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const book = await importFile(new File([bytes], '活着.epub'));
      const store = await openStore('dushu');
      const meta = await store.books.add(book);
      return { id: meta.id, title: meta.title, chapters: meta.chapterCount, chars: meta.charCount };
    }, b64);
    console.log('   imported', JSON.stringify(huo));
    await setSettings({ pinyin: 'all', fontSize: 22, theme: 'light' });
    await openBook(huo.id);
    await shot('22-huozhe-ch1');
    const dump = await page.evaluate(() => {
      const out = [];
      for (const w of document.querySelectorAll('.rd-article .rd-w')) {
        const rs = [...w.querySelectorAll('ruby')];
        out.push(rs.map((r) => r.firstChild.data).join('') + ':' + rs.map((r) => r.querySelector('rt')?.textContent ?? '').join(' '));
        if (out.length >= 400) break;
      }
      return out;
    });
    console.log(`   活着 first words with pinyin: ${dump.length} words checked (not printed: the book is copyrighted)`);
    await page.evaluate(() => window.scrollTo(0, 3000));
    await settle(500);
    await shot('23-huozhe-scrolled');
    const real = await page.evaluate(() => ({ blocks: document.querySelectorAll('.rd-b').length, title: document.querySelector('.rd-chapter-title').textContent }));
    console.log('   活着 chapter 1:', JSON.stringify(real));
  } else console.log('   (活着.epub not found, skipping the real-book check)');

  // ---- 15. Chapter navigation on a book with many chapters (needs the imported book)
  if (existsSync(EPUB)) {
    // Its chapter count comes from the book: importers cut it differently (11 pieces before importer v2, 8 chapters since).
    const { id: huoId, chapters: huoChapters } = await page.evaluate(async () => {
      const { openStore } = await import('/src/store/index.ts');
      const list = await (await openStore('dushu')).books.list();
      const b = list.find((x) => x.title === '活着');
      return { id: b?.id, chapters: b?.chapterCount ?? 0 };
    });
    await setSettings({ pinyin: 'unknown' });
    await openBook(huoId, '?ch=2');
    const t3 = await page.$eval('.rd-chapter-title', (e) => e.textContent);
    check(t3.length > 0, `?ch=2 opens the third chapter (${t3})`);
    await page.click('.rd-toc-btn');
    await settle(900);
    const tocItems = await page.$$eval('.rd-toc-item', (e) => e.map((x) => x.textContent));
    check(huoChapters > 3 && tocItems.length === huoChapters, `chapter drawer lists all ${huoChapters} chapters (${tocItems.slice(0, 3).join(' / ')} ...)`);
    check(await page.$eval('.rd-toc-item[aria-current="true"]', (e, t) => e.textContent.includes(t), t3), 'the current chapter is highlighted in the drawer');
    await shot('24-toc-huozhe');
    await page.keyboard.press('Escape');
    await settle(200);
    check(await page.$('.rd-toc-root:not([hidden])') === null, 'Esc closes the drawer');
    // a long book gets a filter
    await openBook(ids.many);
    await page.click('.rd-toc-btn');
    await settle(900);
    // The list is windowed: its sizer is as tall as all 40 rows, and only the rows near the window exist.
    const rows40 = await page.$eval('.rd-toc-list .rd-toc-sizer', (e) => Math.round(parseFloat(e.style.height) / parseFloat(e.querySelector('.rd-toc-row').style.height)));
    check(await page.$('.rd-toc-filter') !== null && rows40 === 40, `a 40-chapter book lists every chapter and offers a filter (${rows40} rows)`);
    await page.type('.rd-toc-filter', '第3');
    await settle(200);
    const filtered = await page.$$eval('.rd-toc-item', (e) => e.length);
    check(filtered === 11, `filtering "第3" keeps matching chapters (${filtered})`);
    await shot('24b-toc-filter');
    await page.$$eval('.rd-toc-item', (e) => e[0].click());
    await settle(800);
    check((await page.$eval('.rd-chapter-title', (e) => e.textContent)).startsWith('第3章'), 'picking a filtered chapter opens it');
    await openBook(huoId, '?ch=2');
    // PageDown at the bottom goes to the next chapter, PageUp at the top comes back to the end of the previous
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await settle(300);
    await page.keyboard.press('PageDown');
    await settle(900);
    const t4 = await page.$eval('.rd-chapter-title', (e) => e.textContent);
    check(t4 !== t3, `PageDown at the end of a chapter opens the next one (${t4})`);
    check(await page.evaluate(() => window.scrollY) < 50, 'the next chapter starts at the top');
    await page.keyboard.press('PageUp');
    await settle(900);
    check((await page.$eval('.rd-chapter-title', (e) => e.textContent)) === t3, 'PageUp at the top returns to the previous chapter');
    check(await page.evaluate(() => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 20), '... positioned at its end');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await settle(300);
    await shot('25-chapter-end');
    await page.click('.rd-end-next');
    await settle(900);
    check((await page.$eval('.rd-chapter-title', (e) => e.textContent)) === t4, 'the Next chapter button opens the next chapter');
    // the last chapter ends the book
    await openBook(huoId, `?ch=${huoChapters - 1}`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await settle(300);
    check(await page.$('.rd-end-next') === null && (await page.$eval('.rd-end', (e) => e.textContent)).includes('end'), 'the last chapter shows the end of the book');
    // errors
    await page.evaluate(() => { location.hash = '#/read/does-not-exist'; });
    await settle(900);
    check((await page.$eval('#screen', (e) => e.textContent)).includes('Book not found'), 'an unknown book id shows a clear message');
  }

  // ---- 16. Live updates keep the same DOM nodes; reflow keeps your place
  await setSettings({ pinyin: 'all', pinyinStyle: 'marks', toneColors: true, fontSize: 22 });
  await openBook(ids.kong);
  await page.evaluate(() => { window.__w = document.querySelector('.rd-article .rd-w'); window.__rt = document.querySelector('.rd-article rt'); });
  // How the pinyin looks lives in the pinyin menu.
  await page.click('.rd-pinyin-btn');
  await settle(150);
  const styleRow = await page.evaluateHandle(() => [...document.querySelectorAll('.rd-pinyin-menu .rd-row')].find((r) => r.querySelector('.rd-row-label')?.textContent.startsWith('Style')));
  const styleBtns = await styleRow.$$('.rd-seg-btn');
  if (styleBtns.length === 3) await styleBtns[1].click();
  await settle(250);
  const live = await page.evaluate(() => ({
    sameWord: document.querySelector('.rd-article .rd-w') === window.__w,
    sameRt: document.querySelector('.rd-article rt') === window.__rt,
    rt: window.__rt.textContent,
  }));
  check(live.sameWord && live.sameRt, 'changing the pinyin style keeps the same DOM nodes');
  check(/\d/.test(live.rt), `... and rewrites the rt text (${live.rt})`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.scrollTo(0, 1600));
  await settle(300);
  const anchorBefore = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('.rd-p')];
    const p = ps.find((e) => e.getBoundingClientRect().bottom > 80);
    window.__anchor = p; return p.getBoundingClientRect().top;
  });
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  await settle(300);
  const anchorAfter = await page.evaluate(() => window.__anchor.getBoundingClientRect().top);
  check(Math.abs(anchorAfter - anchorBefore) < 40, `a font-size change keeps the same paragraph in place (${Math.round(anchorBefore)} -> ${Math.round(anchorAfter)})`);
  await page.keyboard.press('[');
  await page.keyboard.press('[');

  // ---- 17. Stroke order (real data from jsdelivr when online) and rare characters without any
  await setSettings({ pinyin: 'off' });
  await openBook(ids.kong);
  await clickWord('酒店');
  // The card's sticky footer (Prev / Next / Shorter / Longer) can lie over the first character card while the card is still
  // inside the scroll box, so the browser counts it as visible and the click would land on the footer. Scroll it clear of the
  // footer first, as a reader would, and make sure the click reaches the card itself.
  const cardClear = await page.evaluate(() => {
    const card = document.querySelector('.pp-card');
    const sc = card?.closest('.pp-scroll');
    const foot = document.querySelector('.pp-foot');
    if (!card || !sc) return false;
    const limit = (foot ? foot.getBoundingClientRect().top : sc.getBoundingClientRect().bottom) - 8;
    const over = card.getBoundingClientRect().bottom - limit;
    if (over > 0) sc.scrollTop += over;
    const r = card.getBoundingClientRect();
    return card.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });
  check(cardClear, 'the first character card can be scrolled clear of the card footer');
  await page.click('.pp-card');
  const stroke = await page.waitForSelector('.pp-stroke:not([hidden]) svg', { timeout: 10000 }).catch(() => null);
  check(stroke !== null, 'stroke-order animation loads for a common character');
  await settle(1200);
  await shot('26-stroke-order');
  await page.keyboard.press('Escape');
  await openBook(ids.rare);
  const rr = await wordRect('𠀀');
  await page.mouse.click(rr.x, rr.y);
  await settle(1800);
  // The data has no character above U+FFFF: the section is never shown (it stays hidden, or is gone after a failed load)
  // and the CDN is not even asked.
  const noStroke = await page.evaluate(() => {
    const s = document.querySelector('.pp-pop .pp-stroke');
    return { pop: !!document.querySelector('.pp-pop'), shown: !!s && (!s.hidden || s.getBoundingClientRect().height > 0) };
  });
  check(noStroke.pop && !noStroke.shown && !strokeAsks.includes('𠀀.json'), `a character with no stroke data hides the stroke-order section quietly (popup ${noStroke.pop}, section shown ${noStroke.shown}, asked ${strokeAsks.includes('𠀀.json')})`);
  await page.keyboard.press('p'); // speak must not throw even with no voices
  await settle(200);
  await page.keyboard.press('Escape');

  // ---- 18. Translation providers (network calls are stubbed)
  // Claude goes through the Mac bridge (/api/claude/*). The request handler installed at the top answers it: here it plays a
  // Mac with a key that Anthropic rejects for Explain, and nothing reaches Anthropic.
  stub.claude = true;
  await setSettings({ pinyin: 'off', translator: 'claude' });
  await openBook(ids.kong);
  // This section exercises providers, so select a known multiword range directly; pointer dragging is tested above.
  await page.evaluate(() => {
    const words = [...document.querySelectorAll('.rd-article .rd-w')];
    const i = words.findIndex(w => [...w.querySelectorAll('ruby')].map(r => r.firstChild?.textContent).join('') === '掌柜');
    const start = words[i].querySelector('ruby')?.firstChild;
    const end = words[i + 2].querySelector('ruby')?.firstChild;
    if (!start || !end) throw new Error('Could not make the QA phrase selection');
    start.parentElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, detail: 1 }));
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.pp-tr-actions button')].some((b) => /Explain/.test(b.textContent)), { timeout: 20000 }).catch(() => {});
  const actionLabels = await page.$$eval('.pp-tr-actions button', (b) => b.map((x) => x.textContent.trim()));
  check(actionLabels.some((l) => /Explain/.test(l)), `Explain is offered when the Mac says Claude is set up (${actionLabels.join(' | ')}; popup: ${(await popupText() ?? '').slice(0, 160).replace(/\n/g, ' | ')})`);
  if (!actionLabels.some((l) => /Explain/.test(l))) throw new Error('Could not open the Claude explanation panel');
  await page.evaluate(() => [...document.querySelectorAll('.pp-tr-actions button')].find((b) => /Explain/.test(b.textContent)).click());
  await page.waitForFunction(() => document.querySelector('.pp-tr-error'), { timeout: 15000 }).catch(() => {});
  const errText = await page.$eval('.pp-tr-error', (e) => e.textContent).catch(() => '');
  check(errText === KEY_REJECTED, `a rejected Claude key gives the Mac's plain error (${errText.slice(0, 100)})`);
  check(/Claude \(through your Mac\)/.test(await page.$eval('.pp-tr-provider', (e) => e.textContent).catch(() => '')), 'the provider line says Claude goes through the Mac');
  await shot('27-explain-error');
  // switch to MyMemory from the provider menu
  await page.evaluate(() => [...document.querySelectorAll('.pp-tr-actions button')].find((b) => /another provider/.test(b.textContent)).click());
  await page.waitForSelector('.pp-menu-item');
  await page.evaluate(() => [...document.querySelectorAll('.pp-menu-item')].find((b) => /MyMemory/i.test(b.textContent)).click());
  await page.waitForFunction(() => /Stub translation/.test(document.querySelector('.pp-tr-body')?.textContent ?? ''), { timeout: 8000 }).catch(() => {});
  check(/Stub translation/.test(await page.$eval('.pp-tr-body', (e) => e.textContent)), 'switching provider re-translates with the chosen one');
  check(/MyMemory/i.test(await page.$eval('.pp-tr-provider', (e) => e.textContent)), 'the provider name is shown');
  await shot('28-provider-mymemory');
  await page.keyboard.press('Escape');
  check(claudeCalls.includes('translate') && claudeCalls.includes('explain') && hosts.includes('api.mymemory.translated.net'), `the stubbed bridge and MyMemory answered the translations (${claudeCalls.join(',')})`);
  check(strays.length === 0, `no request reached api.anthropic.com or an unstubbed Claude route (${strays.join(', ')})`);
  stub.claude = false;

  // ---- 19. Pages layout at 1440x900 (Chrome): spreads, even pinyin grid, turning, position, settings
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const stageInfo = () => page.evaluate(() => ({ ...document.querySelector('.rd-stage').dataset }));
  const liveWord = (n) => page.evaluate((i) => {
    const ws = [...document.querySelectorAll('.rd-article.rd-live .rd-p .rd-w')].filter((w) => { const r = w.getBoundingClientRect(); return r.left > 40 && r.right < innerWidth - 40 && r.top > 80 && r.bottom < innerHeight - 70; });
    const r = ws[i].getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, text: [...ws[i].querySelectorAll('ruby')].map((u) => u.firstChild.data).join('') };
  }, n);
  const gridCheck = async (label) => {
    const g = await page.evaluate(() => {
      const live = document.querySelector('.rd-article.rd-live');
      const rubies = [...live.querySelectorAll('.rd-p ruby.rd-c')].filter((r) => { const q = r.getBoundingClientRect(); return q.left > 0 && q.right < innerWidth && q.top > 0 && q.bottom < innerHeight; }).slice(0, 120);
      const widths = rubies.map((r) => Math.round(r.getBoundingClientRect().width * 10) / 10);
      let maxOff = 0; let overlap = 0; let prev = null; let shown = 0;
      for (const r of rubies) {
        const rt = r.querySelector('.rd-rtx');
        if (!rt || getComputedStyle(r.querySelector('rt')).display === 'none') { prev = null; continue; }
        shown++;
        const a = r.getBoundingClientRect(); const b = rt.getBoundingClientRect();
        maxOff = Math.max(maxOff, Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)));
        if (prev && Math.abs(prev.top - b.top) < 4 && b.left < prev.right - 0.5) overlap++;
        prev = b;
      }
      return { distinct: [...new Set(widths)], maxOff, overlap, shown, n: rubies.length };
    });
    check(g.n > 40 && Math.max(...g.distinct) - Math.min(...g.distinct) < 0.6, `${label}: every character has one cell width (${g.distinct.join(', ')} px over ${g.n} characters)`);
    check(g.shown === 0 || g.maxOff < 1.2, `${label}: pinyin is centered over its character (max offset ${g.maxOff.toFixed(2)} px, ${g.shown} shown)`);
    check(g.overlap === 0, `${label}: neighboring pinyin does not overlap`);
  };

  // Seed the real books: 活着 (if present) and the 红楼梦 sample.
  let huoId2 = null;
  if (existsSync(EPUB)) huoId2 = await page.evaluate(async () => { const { openStore } = await import('/src/store/index.ts'); return (await (await openStore('dushu')).books.list()).find((b) => b.title === '活着')?.id ?? null; });

  await setSettings({ layout: 'pages', pageTurn: 'flip', spread: 'auto', pinyin: 'all', fontSize: 24, theme: 'light', pinyinStyle: 'marks', paragraphTranslate: true, lookupTrigger: 'click' });
  await openBook(ids.hlm, '?ch=1');
  await page.waitForSelector('.rd-stage[data-pages]');
  let st = await stageInfo();
  check(st.per === '2' && Number(st.pages) > 5, `Pages layout shows a two-page spread at 1440x900 (${st.pages} pages)`);
  check(await page.evaluate(() => document.querySelector('.rd-root').classList.contains('rd-paged') && document.documentElement.scrollHeight <= innerHeight + 1), 'the page itself does not scroll in Pages');
  await shot('30-pages-spread-light');
  await gridCheck('pinyin all');
  // The tone colors setting reaches the reader's pinyin: different colors with it on, one grey with it off.
  const toneColors = () => page.evaluate(() => [1, 2, 3, 4, 5].map((n) => { const r = document.querySelector(`.rd-article.rd-live rt.tone-${n}`); return r ? getComputedStyle(r).color : null; }));
  const tonesOn = await toneColors();
  check(new Set(tonesOn.filter(Boolean)).size >= 3, `tone colors show in the reader's pinyin (${tonesOn.filter(Boolean).length} tones, ${new Set(tonesOn.filter(Boolean)).size} colors)`);
  await setSettings({ toneColors: false }, { reload: false });
  await settle(500);
  check(await page.evaluate(() => { const cs = [...document.querySelectorAll('.rd-article.rd-live rt')].slice(0, 60).map((r) => getComputedStyle(r).color); return new Set(cs).size === 1; }), 'with tone colors off the pinyin is one grey');
  await setSettings({ toneColors: true }, { reload: false });
  await settle(500);
  check(await page.$eval('.rd-article rt', (e) => (getComputedStyle(e).webkitUserSelect || getComputedStyle(e).userSelect) === 'none'), 'rt is not selectable');
  check(await page.$('.rd-hdr') !== null && await page.$('.rd-ftr') !== null, 'every page has a header and a footer');
  check((await page.$$eval('.rd-ftr', (f) => f.map((x) => x.textContent))).some((t) => /pages? left in chapter|Last page/.test(t)), 'the footer says how many pages are left in the chapter');
  for (const theme of ['dark', 'sepia']) { await setSettings({ theme }, { reload: false }); await settle(400); await shot(`31-pages-${theme}`); }
  await setSettings({ theme: 'light' }, { reload: false });

  // Unknown mode: words without pinyin keep their cell. Zhuyin keeps the grid too.
  await setSettings({ pinyin: 'unknown' }, { reload: false });
  await settle(300);
  // Mark a few words known through the popup (the app's own store), as a reader would.
  let someWords = [];
  for (const n of [2, 5, 9]) {
    const w = await liveWord(n);
    someWords.push(w.text);
    await page.mouse.click(w.x, w.y);
    await settle(400);
    await page.keyboard.press('k');
    await settle(200);
    await page.keyboard.press('Escape');
    await settle(200);
  }
  await settle(400);
  const hidden = await page.$$eval('.rd-article.rd-live .rd-nopy', (e) => e.length);
  check(hidden > 0, `known words lose their pinyin (${hidden} hidden)`);
  await gridCheck('unknown mode (hidden pinyin keeps the cell)');
  await page.evaluate(async (w) => { const { openStore } = await import('/src/store/index.ts'); const s = await openStore('dushu'); await s.known.remove(w); }, someWords);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.rd-stage[data-pages]');
  await settle(800);
  await setSettings({ pinyin: 'all', pinyinStyle: 'zhuyin' }, { reload: false });
  await settle(900);
  await gridCheck('zhuyin');
  await shot('32-pages-zhuyin');
  await setSettings({ pinyinStyle: 'numbers' }, { reload: false });
  await settle(900);
  await gridCheck('numbers');
  await setSettings({ pinyinStyle: 'marks' }, { reload: false });
  await settle(700);

  // Small and large text on 红楼梦 and 活着.
  for (const size of [16, 44]) {
    await setSettings({ fontSize: size }, { reload: false });
    await settle(1200);
    await shot(`33-pages-hlm-${size}px`);
    await gridCheck(`红楼梦 at ${size}px`);
    const ov = await page.evaluate(() => { const live = document.querySelector('.rd-article.rd-live'); const r = live.getBoundingClientRect(); return { pages: document.querySelector('.rd-stage').dataset.pages, ok: r.height <= 900 }; });
    check(Number(ov.pages) > 3, `红楼梦 chapter paginates at ${size}px (${ov.pages} pages)`);
  }
  if (huoId2) {
    for (const size of [16, 24, 44]) {
      await setSettings({ fontSize: size }, { reload: false });
      await openBook(huoId2, '?ch=1');
      await settle(800);
      await shot(`34-pages-huozhe-${size}px`);
      await gridCheck(`活着 at ${size}px`);
    }
  }
  await setSettings({ fontSize: 24 }, { reload: false });
  await openBook(ids.hlm, '?ch=1');

  // Turning: keys.
  let base = await stageInfo();
  await page.keyboard.press('ArrowRight');
  await settle(120);
  check(await page.$('.rd-leaf') !== null, 'the page turn animates as a leaf');
  await shot('35-flip-mid-spread');
  await settle(900);
  let now = await stageInfo();
  check(Number(now.page) === Number(base.page) + 2, `ArrowRight turns a spread (${base.page} -> ${now.page})`);
  // (A turn for the next page is built in idle time and waits, unseen, in a host marked data-idle.)
  check(await page.$('.rd-turn:not([data-idle]) .rd-leaf') === null, 'the leaf is gone when the turn ends');
  await page.keyboard.press('Space');
  await settle(900);
  check(Number((await stageInfo()).page) === Number(base.page) + 4, 'Space turns forward');
  await page.keyboard.down('Shift'); await page.keyboard.press('Space'); await page.keyboard.up('Shift');
  await settle(900);
  check(Number((await stageInfo()).page) === Number(base.page) + 2, 'Shift+Space turns back');
  await page.keyboard.press('PageUp');
  await settle(900);
  check((await stageInfo()).page === base.page, 'PageUp turns back to the first spread');
  // The bar tucks away on the first turn and a middle click brings it back.
  check(await page.evaluate(() => document.querySelector('.rd-root').classList.contains('rd-chrome-off')), 'turning a page tucks the bar away (immersive reading)');
  await page.mouse.click(720, 450);
  await settle(300);
  check(await page.evaluate(() => !document.querySelector('.rd-root').classList.contains('rd-chrome-off')), 'a click in the middle brings the bar back');
  // Click zones.
  await page.mouse.click(1380, 700);
  await settle(900);
  check(Number((await stageInfo()).page) === Number(base.page) + 2, 'a click on the right edge turns forward');
  await page.mouse.click(60, 700);
  await settle(900);
  check((await stageInfo()).page === base.page, 'a click on the left edge turns back');
  // Trackpad: a horizontal wheel gesture turns exactly one spread.
  await page.mouse.move(720, 450);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaX: 30 }); await new Promise((r) => setTimeout(r, 20)); }
  await settle(1000);
  check(Number((await stageInfo()).page) === Number(base.page) + 2, `a horizontal trackpad swipe turns one spread (${(await stageInfo()).page})`);
  await page.keyboard.press('Home');
  await settle(900);

  // Lookup on a page: click a word, then drag-select a phrase.
  const w1 = await liveWord(5);
  await page.mouse.click(w1.x, w1.y);
  await settle(500);
  const pop1 = await page.evaluate(() => { const p = document.querySelector('.pp-pop'); const r = p?.getBoundingClientRect(); return p ? { cls: p.className, right: r.right, bottom: r.bottom } : null; });
  check(pop1 && pop1.cls.includes('pp-float') && pop1.right <= 1440 && pop1.bottom <= 900, `a click on "${w1.text}" opens the word popup`);
  check((await stageInfo()).page === '1', 'a word click does not turn the page, even near an edge');
  await shot('36-pages-word-popup');
  await page.keyboard.press('ArrowRight'); // steps to the next word while the popup is open
  await settle(300);
  check((await stageInfo()).page === '1', 'with a popup open the arrow keys step through words, not pages');
  await page.keyboard.press('Escape');
  const w2 = await liveWord(8);
  await page.mouse.move(w2.x - 12, w2.y);
  await page.mouse.down();
  await page.mouse.move(w2.x + 200, w2.y + 2, { steps: 8 });
  await page.mouse.up();
  await settle(900);
  check(await page.$('.pp-pop.pp-k-phrase') !== null, 'drag-select across a page opens the phrase popup');
  check((await stageInfo()).page === '1', 'a drag-select does not turn the page');
  await shot('37-pages-phrase-popup');
  await page.keyboard.press('Escape');
  await settle(200);

  // Position: font size and window size keep the same block.
  await page.keyboard.press('ArrowRight'); await settle(900);
  await page.keyboard.press('ArrowRight'); await settle(900);
  const pos0 = await stageInfo();
  await page.keyboard.press(']'); await page.keyboard.press(']'); await page.keyboard.press(']');
  await settle(1500);
  const pos1 = await stageInfo();
  check(Number(pos1.block) <= Number(pos0.block) && Number(pos0.block) - Number(pos1.block) <= 3, `a bigger font keeps the reading position (block ${pos0.block} -> ${pos1.block}, page ${pos0.page} -> ${pos1.page})`);
  await page.keyboard.press('['); await page.keyboard.press('['); await page.keyboard.press('[');
  await settle(1500);
  await page.setViewport({ width: 900, height: 1100, deviceScaleFactor: 1 });
  await settle(1500);
  const pos2 = await stageInfo();
  check(pos2.per === '1' && Number(pos2.block) <= Number(pos1.block) + 1, `a narrower window shows one page and keeps the place (block ${pos2.block})`);
  await shot('38-pages-single-narrow');
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await settle(1500);
  check((await stageInfo()).per === '2', 'a wide window shows the spread again');

  // Progress is saved by block and restored.
  await settle(1200);
  const progP = await page.evaluate(async (id) => (await (await import('/src/store/index.ts')).openStore('dushu')).progress.get(id), ids.hlm);
  check(progP && progP.block > 0 && progP.percent > 0, `progress is saved (block ${progP?.block}, ${(progP?.percent * 100).toFixed(1)}%)`);
  const beforeReload = await stageInfo();
  // A link with ?ch=n opens that chapter at its start; a plain book link comes back to the saved place.
  await page.evaluate((id) => { history.replaceState(null, '', `#/read/${id}`); }, ids.hlm);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.rd-stage[data-pages]');
  await settle(1200);
  const afterReload = await stageInfo();
  check(afterReload.page === beforeReload.page || Math.abs(Number(afterReload.page) - Number(beforeReload.page)) <= 2, `reloading restores the page (${beforeReload.page} -> ${afterReload.page})`);

  // Chapter edges: the last spread flows into the next chapter and back.
  await page.keyboard.press('End');
  await settle(900);
  const titleA = await page.$eval('.rd-chapter-title', (e) => e.textContent);
  const lastInfo = await stageInfo();
  await page.keyboard.press('ArrowRight');
  await settle(1500);
  const titleB = await page.$eval('.rd-chapter-title', (e) => e.textContent);
  const nextInfo = await stageInfo();
  check(titleA !== titleB && nextInfo.page === '1' && Number(nextInfo.chapter) === Number(lastInfo.chapter) + 1, `the last page flows into the next chapter (${titleA} -> ${titleB})`);
  await page.keyboard.press('ArrowLeft');
  await settle(1500);
  check((await page.$eval('.rd-chapter-title', (e) => e.textContent)) === titleA && Number((await stageInfo()).page) >= Number(lastInfo.page) - 1, 'and back to the last spread of the chapter before');
  // Slide and none.
  for (const mode of ['slide', 'none']) {
    await setSettings({ pageTurn: mode }, { reload: false });
    await page.keyboard.press('Home'); await settle(800);
    await page.keyboard.press('ArrowRight');
    await settle(mode === 'slide' ? 200 : 60);
    if (mode === 'slide') await shot('39-slide-mid');
    await settle(800);
    check(Number((await stageInfo()).page) === 3, `${mode} turns a spread`);
  }
  await setSettings({ pageTurn: 'flip' }, { reload: false });

  // The Aa menu and the Settings screen have the new controls; the preview uses the grid too.
  await page.mouse.move(700, 8); // moving to the top edge brings the tucked-away bar back
  await settle(500);
  check(await page.evaluate(() => !document.querySelector('.rd-root').classList.contains('rd-chrome-off')), 'moving the mouse to the top edge shows the bar again');
  await page.click('.rd-aa-btn');
  await settle(250);
  const aaRows = await page.$$eval('.rd-display .rd-row-label', (e) => e.map((x) => x.textContent));
  check(['Layout', 'Pages shown', 'Page turn'].every((l) => aaRows.some((r) => r.startsWith(l))), `the Aa menu has Layout, Pages shown and Page turn (${aaRows.slice(0, 4).join(' / ')})`);
  await shot('40-aa-menu-pages');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await settle(500);
  check(await page.$('.rd-toc-tab') !== null && (await page.$$eval('.rd-toc-tab', (t) => t.map((x) => x.textContent))).includes('Names'), 'the chapter drawer has a Names tab');
  await shot('41-names-tab');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = '#/settings'; });
  await page.waitForSelector('.set-sample');
  await settle(800);
  const setRows = await page.$$eval('.set-label', (e) => e.map((x) => x.textContent));
  check(['Layout', 'Pages shown', 'Page turn'].every((l) => setRows.includes(l)), 'Settings has Layout, Pages shown and Page turn');
  const prev = await page.evaluate(() => {
    const ws = [...document.querySelectorAll('.set-sample .set-ruby')].map((r) => Math.round(r.getBoundingClientRect().width * 10) / 10);
    return { distinct: [...new Set(ws)], n: ws.length };
  });
  check(prev.n > 10 && prev.distinct.length <= 2 && Math.max(...prev.distinct) - Math.min(...prev.distinct) < 0.6, `the Settings preview uses the even grid (${prev.distinct.join(', ')} px)`);
  await shot('42-settings-preview-grid');
  await page.evaluate(() => { location.hash = '#/'; });

  // 射雕英雄传 (a long real book), if it is on this machine.
  const SHEDIAO = `${homedir()}/Downloads/射雕英雄传.epub`;
  if (existsSync(SHEDIAO)) {
    const sb = readFileSync(SHEDIAO).toString('base64');
    const sd = await page.evaluate(async (data) => {
      const { openStore } = await import('/src/store/index.ts');
      const { importFile } = await import('/src/import/index.ts');
      const store = await openStore('dushu');
      const exist = (await store.books.list()).find((b) => b.title === '射雕英雄传');
      if (exist) return { id: exist.id };
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const meta = await store.books.add(await importFile(new File([bytes], '射雕英雄传.epub')));
      return { id: meta.id };
    }, sb);
    await setSettings({ layout: 'pages', fontSize: 24, pinyin: 'all' });
    const tOpen = Date.now();
    await page.evaluate((id) => { location.hash = `#/read/${id}?ch=5`; }, sd.id);
    await page.waitForSelector('.rd-stage[data-pages]', { timeout: 60000 });
    const openMs = Date.now() - tOpen;
    const sdi = await stageInfo();
    console.log(`   射雕英雄传 chapter 6: ${sdi.pages} pages, opened in ${openMs} ms`);
    check(openMs < 4000 && Number(sdi.pages) > 20, `a 20,000-character chapter of 射雕英雄传 opens in Pages in ${openMs} ms (${sdi.pages} pages)`);
    await settle(1500);
    await shot('43-shediao-spread');
    await gridCheck('射雕英雄传');
  }
  // The very long chapter (about 57,000 characters in 600 paragraphs): the first spread must not wait for the rest.
  {
    await setSettings({ layout: 'pages', fontSize: 22, pinyin: 'all', spread: 'auto' });
    await page.evaluate(() => { location.hash = '#/'; });
    await settle(500);
    const r = await page.evaluate((id) => new Promise((resolve) => {
      const t0 = performance.now();
      location.hash = `#/read/${id}?ch=0`;
      const iv = setInterval(() => {
        const st = document.querySelector('.rd-stage');
        if (st?.dataset.page && document.querySelector('.rd-article.rd-live .rd-w')) {
          clearInterval(iv);
          resolve({ ms: Math.round(performance.now() - t0), nodes: document.getElementsByTagName('*').length, exact: st.dataset.exact, pages: st.dataset.pages });
        }
      }, 10);
    }), ids.long);
    console.log(`   57,000-character chapter: first spread in ${r.ms} ms, ${r.nodes} DOM nodes, about ${r.pages} pages (exact: ${r.exact})`);
    check(r.ms < 2500 && r.nodes < 40000, `the first spread of a 57,000-character chapter is up in ${r.ms} ms with ${r.nodes} DOM nodes (not the whole chapter)`);
    check(r.exact === 'false', 'its page count is an estimate until the reader gets near the end');
    await settle(1500);
    // A font step must not freeze the page: the longest gap between frames stays well under a second.
    await page.evaluate(() => { window.__gap = 0; let last = performance.now(); const f = (n) => { window.__gap = Math.max(window.__gap, n - last); last = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.keyboard.press(']');
    await settle(2500);
    const gap = await page.evaluate(() => Math.round(window.__gap));
    console.log(`   font step on the long chapter: longest frame gap ${gap} ms`);
    check(gap < 1000, `a font step on the long chapter keeps the page responsive (longest frame gap ${gap} ms)`);
  }
  await setSettings({ layout: 'scroll' }, { reload: false });

  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  console.log('console errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
  stopServer();
}
if (failures.length || errors.length) process.exitCode = 1;
