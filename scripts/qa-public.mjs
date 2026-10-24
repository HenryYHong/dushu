// Headless QA for the hosted copy: a production build served under /dushu/ (see scripts/serve-subpath.mjs), as a visitor on a
// public origin, with and without a Mac to talk to. Never opens a visible window.
//
//   node scripts/serve-subpath.mjs .cache/build-pages /dushu/ 5243 &
//   node scripts/qa-public.mjs [http://dushu.test:5243/dushu/]
//
// The page is loaded from the made-up host dushu.test (mapped to 127.0.0.1) so it is not a loopback origin, like the real site.
// A small fake Mac answers the book routes on 127.0.0.1:5245. The build's Content-Security-Policy allows the Mac's private address
// (*.ts.net) but not a loopback fake, so the "connected" scenarios load the same build through a proxy on port 5246 that widens
// connect-src to the fake. The unpatched run is reported as a note, not a failure.
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const BASE = (process.argv[2] ?? 'http://dushu.test:5243/dushu/').replace(/\/?$/, '/');
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
const ORIGIN = new URL(BASE).origin;
const ALLOWED_ORIGINS = [ORIGIN, ORIGIN.replace(/:\d+$/, ':5246')];
const MAC = 'http://127.0.0.1:5245';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let failed = 0;
let scene = '';
const check = (cond, msg) => { cond ? passed++ : failed++; console.log(`${cond ? 'PASS' : 'FAIL'} [${scene}] ${msg}`); return !!cond; };

// ---- the fake Mac: public-domain text only ----
const TEXT = ('学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？\n\n').repeat(30);
const BOOK = Buffer.from(TEXT);
const SHA = createHash('sha256').update(BOOK).digest('hex');
const hits = { list: 0, file: 0 };
let macUp = true;
const mac = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (!macUp) { req.socket.destroy(); return; }
  const path = new URL(req.url, MAC).pathname;
  if (path === '/api/local-books') {
    hits.list++;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([{ id: 'lunyu', name: '论语测试.txt', size: BOOK.length, sha256: SHA }]));
  } else if (path === '/api/local-books/lunyu') {
    hits.file++;
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': BOOK.length }).end(BOOK);
  } else res.writeHead(404).end();
}).listen(5245, '127.0.0.1');

// The same build, served one port over with the CSP widened to allow the fake Mac. Real pages get that allowance for the Mac's
// private address; this stands in for it.
const U = new URL(BASE);
const PATCHED = `${U.protocol}//${U.hostname}:5246${U.pathname}`;
const patched = createServer(async (req, res) => {
  try {
    const upstream = await fetch(`http://127.0.0.1:${U.port}${req.url}`);
    let body = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') ?? '';
    if (/text\/html/.test(type)) body = Buffer.from(body.toString().replace("connect-src 'self'", `connect-src 'self' ${MAC}`));
    res.writeHead(upstream.status, { 'Content-Type': type, 'Content-Length': body.length }).end(body);
  } catch { res.writeHead(502).end(); }
}).listen(5246, '127.0.0.1');
const host = U.hostname;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  timeout: 90000,
  args: ['--no-first-run', '--no-default-browser-check', '--mute-audio', `--host-resolver-rules=MAP ${host} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${ALLOWED_ORIGINS.join(',')}`,
    // The fake Mac is on loopback, which Chrome's local-network permission would block for a page served through interception.
    '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'],
});

/** A fresh profile. With `allowMac`, the served page's CSP also allows the fake Mac. */
async function visit({ allowMac = false, connect = false, reuse = null } = {}) {
  const context = reuse ?? await browser.createBrowserContext();
  const page = await context.newPage();
  await page.evaluateOnNewDocument(SYNC_OFF);
  const requests = [];
  const errors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((connectTo) => {
    window.__persist = 0;
    try { if (navigator.storage) { const p = navigator.storage.persist?.bind(navigator.storage); navigator.storage.persist = () => { window.__persist++; return p ? p() : Promise.resolve(false); }; } } catch { /* ignore */ }
    try { if (connectTo && !localStorage.getItem('dushu.mac-bridge.v1')) localStorage.setItem('dushu.mac-bridge.v1', connectTo); } catch { /* ignore */ }
  }, connect ? MAC : '');
  await page.setViewport({ width: 1100, height: 860 });
  await page.goto(allowMac ? PATCHED : BASE, { waitUntil: 'load' });
  await sleep(800);
  return { context, page, requests, errors };
}
const cards = (page) => page.$$eval('.lib-card:not(.lib-card-pending)', (c) => c.length);
const waitCards = (page, n, ms = 45000) => page.waitForFunction((k) => document.querySelectorAll('.lib-card:not(.lib-card-pending)').length === k, { timeout: ms }, n).then(() => true, () => false);

// ---- 1. the subpath: manifest, icons, worker, offline ----
scene = 'subpath';
{
  const { context, page, errors } = await visit();
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const m = await (await fetch(href)).json();
    return { href, m };
  });
  const start = new URL(manifest.m.start_url, manifest.href).href;
  const scope = new URL(manifest.m.scope, manifest.href).href;
  check(start === BASE, 'manifest start_url resolves to the app root under the subpath');
  check(scope === BASE, 'manifest scope is the subpath');
  check(new URL(manifest.m.id, manifest.href).href.startsWith(BASE), 'manifest id stays under the subpath');
  const icons = await page.evaluate(async (hrefs) => Promise.all(hrefs.map(async (h) => {
    const r = await fetch(h);
    return { h, ok: r.ok, type: r.headers.get('content-type') };
  })), manifest.m.icons.map((i) => new URL(i.src, manifest.href).href).concat([await page.$eval('link[rel=apple-touch-icon]', (e) => e.href), await page.$eval('link[rel=icon]', (e) => e.href)]));
  check(icons.every((i) => i.ok && /^image\//.test(i.type)), `every icon loads as an image (${icons.length} checked)`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || false, { timeout: 15000 }).catch(async () => { await page.reload({ waitUntil: 'networkidle0' }); });
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? { scope: r.scope, active: !!r.active } : null; });
  check(sw?.scope === BASE && sw.active, `the service worker scope is ${BASE}`);
  await page.reload({ waitUntil: 'networkidle0' });
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the page is controlled by the worker');
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const offline = await page.waitForSelector('.page-title', { timeout: 15000 }).then(() => true, () => false);
  check(offline, 'the app loads on reload with the network off');
  await page.setOfflineMode(false);
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
  await context.close();
}

// ---- 2. a public visitor with no Mac ----
scene = 'public-no-mac';
{
  const { context, page, requests } = await visit();
  await page.waitForSelector('.lib-mac-note:not([hidden])', { timeout: 10000 }).catch(() => {});
  const note = await page.$eval('.lib-mac-note', (e) => ({ hidden: e.hidden, text: e.textContent })).catch(() => null);
  check(note && !note.hidden && /public copy/.test(note.text) && /Settings/.test(note.text), 'the Library explains the public copy and points to Settings');
  check(await page.$eval('a[href="#/settings"]', () => true).catch(() => false), 'the note links to Settings');
  check(!(await page.$$eval('button', (bs) => bs.some((b) => b.textContent === 'Add books from Mac' && !b.hidden))), '"Add books from Mac" is hidden');
  check(!requests.some((u) => u.includes('/api/')), `no request goes to /api (${requests.filter((u) => u.includes('/api/')).length} seen)`);
  await page.screenshot({ path: 'qa-out/public/public-no-mac.png' });
  await context.close();
}

// ---- 3. connected, but the build's CSP has no allowance for the Mac ----
scene = 'csp-note';
{
  hits.list = 0;
  const { context, page } = await visit({ connect: true });
  await sleep(1500);
  const blocked = hits.list === 0;
  console.log(`NOTE [${scene}] with the unpatched CSP the page ${blocked ? 'cannot reach' : 'can reach'} the Mac from a public origin`);
  await context.close();
}

// ---- 4. connected: owner books sync, persist, no duplicates, no Delete, added again when missing ----
scene = 'connected';
{
  hits.list = 0; hits.file = 0; macUp = true;
  const first = await visit({ allowMac: true, connect: true });
  const { context, page } = first;
  check(await waitCards(page, 1), 'the Mac book is added on its own');
  const toast = await page.$$eval('.toast, [role=status]', (e) => e.map((x) => x.textContent).join(' | ')).catch(() => '');
  check(/from your Mac/.test(toast), 'a quiet toast says where it came from');
  check((await page.evaluate(() => window.__persist)) > 0, 'persistent storage was requested');
  check(hits.file === 1, `the book was downloaded once (${hits.file})`);
  check(await page.$eval('.lib-mac-note', (e) => e.hidden), 'no note while the Mac is connected');
  await page.screenshot({ path: 'qa-out/public/connected.png' });
  await page.close();

  // A second visit adds nothing and downloads nothing.
  const again = await visit({ allowMac: true, reuse: context });
  await sleep(1500);
  check(await cards(again.page) === 1, 'a second visit does not duplicate the book');
  check(hits.file === 1, `and does not download it again (${hits.file})`);
  const bookId = await again.page.$eval('.lib-card', (c) => c.dataset.id);

  // With the Mac off, the book is still there and opens.
  macUp = false;
  await again.page.reload({ waitUntil: 'load' });
  await sleep(1200);
  check(await cards(again.page) === 1, 'the book is still in the library with the Mac off');
  const note = await again.page.$eval('.lib-mac-note', (e) => ({ hidden: e.hidden, text: e.textContent })).catch(() => null);
  check(note && !note.hidden && /did not answer/.test(note.text), 'the Library says the Mac did not answer');
  await again.page.goto(`${PATCHED}#/read/${encodeURIComponent(bookId)}`, { waitUntil: 'load' });
  check(await again.page.waitForSelector('.rd-article .rd-w', { timeout: 45000 }).then(() => true, () => false), 'the book opens with the Mac off');
  macUp = true;

  // The Mac's books are always in the library: the menu has no Delete, and one removed behind the app's back (storage
  // cleared, Delete all data) is added again on the next visit.
  await again.page.goto(PATCHED, { waitUntil: 'load' });
  await sleep(800);
  await again.page.click('.lib-card-menu');
  const items = await again.page.$$eval('.lib-menu-item', (e) => e.map((x) => x.textContent.trim()));
  check(items.includes('Rename') && !items.includes('Delete'), `the Mac book's menu offers Rename and no Delete (${items.join(', ')})`);
  await again.page.keyboard.press('Escape');
  await again.page.evaluate((id) => new Promise((done) => {
    const r = indexedDB.open('dushu');
    r.onsuccess = () => { const tx = r.result.transaction('books', 'readwrite'); tx.objectStore('books').delete(id); tx.oncomplete = () => { r.result.close(); done(); }; };
  }), bookId);
  await again.page.reload({ waitUntil: 'load' });
  check(await waitCards(again.page, 1), "a Mac book removed behind the app's back is added again");
  check(hits.file === 2, `by downloading it once more (${hits.file})`);
  await context.close();
}

await browser.close();
mac.close();
patched.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
