// Dushu service worker: makes the installed app work offline.
//   - index.html: network first (so a new build shows up), cached copy when offline
//   - assets/ (hashed JS and CSS, the PDF worker and its Chinese CMaps): cache first, precached at install. A hashed file the
//     previous build already stored is copied from its cache, not downloaded again.
//   - data/, fonts/, samples/: cache first, in their own cache that survives app updates. The two small Newsreader files
//     (the display face of the interface) are precached there too, so the app looks the same offline from the first visit.
//     The Chinese dictionary and short classics are precached only on a device that reads Chinese (see install). On a first
//     visit the page hands over the dictionary files it downloaded, in any language (main.ts), and each is filed in its
//     language's cache, so the dictionary works offline after one visit and is not downloaded twice.
//     Jigmo is not: it is large and only books with rare characters need it, so it is stored when first fetched. Nor are the
//     name list (data/names.tsv.gz) and the name model (data/name-model.tsv.gz), which only name detection fetches, when a book
//     is first read. The long
//     novels in samples/ are not precached either (vite.config.ts): each is stored the first time it is added.
//   - The bundled font slices (assets/*.woff2): cache first in a third cache that is never cleared by an update. Font slices are not precached (there are hundreds): each one is stored the
//     first time a book needs it, so a page you have read once reads offline.
//   - A new version installs in the background and waits; the page shows "Reload" and sends SKIP_WAITING.
// The __PLACEHOLDERS__ below are filled in by the build (see vite.config.ts); in dev this file is not used.
const BUILD = '__BUILD__';
const DATA_VERSION = '__DATA_VERSION__';
/** The app shell: the built assets, the icons and the manifest. Precached on every device. */
const SHELL = __SHELL__;
/** The Chinese dictionary (data/ at the top) and the short Chinese classics: precached only on a device that reads Chinese. */
const ZH_STATIC = __ZH_STATIC__;
/**
 * The reading fonts' rules (assets/fonts-….css, 500 KB): only the libraries that show Chinese or Japanese load them. Kept by a
 * device whose page did (handed over on a first visit, copied from the previous build's cache after), never downloaded ahead.
 */
const FONT_SHEETS = __FONT_SHEETS__;
/** Each language other than Chinese: the version of its data and classics (vite.config.ts), naming its own cache. */
const LANG_VERSIONS = __LANG_VERSIONS__;
const UI_FONTS = ['fonts/newsreader-roman.woff2', 'fonts/newsreader-italic.woff2'];

const APP_CACHE = `dushu-app-${BUILD}`;
const STATIC_CACHE = `dushu-static-${DATA_VERSION}`;
const FONT_CACHE = 'dushu-fonts-v1';
/** On a first visit the page keeps the dictionary files it downloaded here (main.ts); install takes them over. */
const FIRST_VISIT_CACHE = 'dushu-first-visit';
const SCOPE = new URL(self.registration.scope).pathname;

// Every cache lookup ignores Vary. vite preview and many static hosts answer with "Vary: Origin", and Chrome sends an
// Origin header on module requests (import() of a lazy chunk, a worker) but not on a plain navigation. Without this a
// cache.match() for such a request misses a file that is in the cache, and the screen stays on "Loading…" offline.
const MATCH = { ignoreVary: true };

const relPath = (url) => decodeURIComponent(url.pathname.slice(SCOPE.length));
const isFontSlice = (p) => p.startsWith('assets/') && p.endsWith('.woff2');
const isStatic = (p) => p.startsWith('data/') || p.startsWith('fonts/') || p.startsWith('samples/');
/** data/ja/… or samples/es/…: the language's id, when it has a cache of its own. */
const langOf = (p) => { const m = /^(?:data|samples)\/([a-z]{2})\//.exec(p); return m && LANG_VERSIONS[m[1]] ? m[1] : null; };
const langCache = (id) => `dushu-lang-${id}-${LANG_VERSIONS[id]}`;
// Vite names every built file in assets/ with a hash of its contents (name-HASH.ext).
const isHashed = (p) => /^assets\/.+-[\w-]{8}\.\w+$/.test(p);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    const stat = await caches.open(STATIC_CACHE);
    // One missing file must not fail the install: the app still works online, and the next visit retries.
    // 'no-cache' asks the server whether the copy the page already downloaded is current: on a first visit the dictionary
    // comes back as "not modified" instead of a second 9 MB download, and a changed file is still never stored stale.
    const add = (cache, paths) => Promise.all(paths.map((p) => cache.add(new Request(p, { cache: 'no-cache' })).catch(() => {})));
    // A hashed name always holds the same bytes, so a file an earlier build stored is copied instead of downloaded.
    const reuse = async (cache, p) => {
      const old = isHashed(p) && await caches.match(p, MATCH);
      if (!old) return false;
      await cache.put(p, old);
      return true;
    };
    const fresh = [];
    for (const p of SHELL) if (!(await reuse(app, p).catch(() => false))) fresh.push(p);
    await add(app, ['./', ...fresh]);
    for (const p of FONT_SHEETS) await reuse(app, p).catch(() => false);
    // A file the page already downloaded on a first visit, or that the previous offline copy kept (an update that changed
    // other files, such as the list of classics), is checked with the server (a tiny "not modified" when it is current) and
    // kept, instead of downloaded again. A changed file comes back whole and is stored instead.
    const handed = await caches.open(FIRST_VISIT_CACHE);
    const older = [];
    for (const name of await caches.keys()) if (name.startsWith('dushu-static-') && name !== STATIC_CACHE) older.push(await caches.open(name));
    const priorOf = async (p) => {
      let prior = await handed.match(p, MATCH);
      for (const c of older) prior = prior || await c.match(p, MATCH);
      return prior;
    };
    const takeOver = async (cache, p, prior) => {
      const tag = prior && prior.headers.get('ETag');
      if (!tag) return false;
      const res = await fetch(new Request(p, { headers: { 'If-None-Match': tag }, cache: 'no-store' }));
      if (res.status === 304) await cache.put(p, prior);
      else if (res.ok) await cache.put(p, res);
      else return false;
      return true;
    };
    // Everything the page handed over: the dictionary of whatever language it opened (data/es/ goes to that language's own
    // cache, where the fetch handler looks for it), and for Chinese the top-level data/.
    const handedPaths = [];
    for (const req of await handed.keys()) {
      const url = new URL(req.url);
      if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) continue;
      const p = relPath(url);
      if (isStatic(p)) handedPaths.push(p);
      // A built file the page loaded (the reading fonts' rules): a hashed name always holds the same bytes, so it is kept as is.
      else if (isHashed(p)) await app.put(p, await handed.match(req, MATCH)).catch(() => {});
    }
    const statics = [...new Set([...UI_FONTS, ...ZH_STATIC, ...handedPaths])];
    const priors = await Promise.all(statics.map((p) => priorOf(p).catch(() => undefined)));
    // The Chinese files are precached only on a device that reads Chinese: its page handed the Chinese dictionary over, or
    // the previous offline copy kept it. A first visit in Spanish never downloads the 9 MB Chinese dictionary; if that device
    // opens Chinese later, each file is stored the first time it is fetched.
    const zh = new Set(ZH_STATIC);
    const readsChinese = statics.some((p, i) => priors[i] && zh.has(p) && p.startsWith('data/'));
    await Promise.all(statics.map(async (p, i) => {
      if (!priors[i] && !UI_FONTS.includes(p) && !(readsChinese && zh.has(p))) return;
      const id = langOf(p);
      const cache = id ? await caches.open(langCache(id)) : stat;
      // A copy the server cannot vouch for (no ETag) is asked for again: the browser's cache answers for one the page just got.
      if (!(await takeOver(cache, p, priors[i]).catch(() => false))) await add(cache, [p]);
    }));
    await caches.delete(FIRST_VISIT_CACHE).catch(() => {});
    // No skipWaiting here: the page decides when to switch (see the message handler), so an update never changes
    // the app under someone who is in the middle of a chapter.
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const langs = new Set(Object.keys(LANG_VERSIONS).map(langCache));
    for (const name of await caches.keys()) {
      if (name.startsWith('dushu-') && name !== APP_CACHE && name !== STATIC_CACHE && name !== FONT_CACHE && name !== SHARED_CACHE && !langs.has(name)) await caches.delete(name);
    }
    // A service worker from before the languages filed a language's files with the Chinese data (data/es/, samples/ja/ in
    // the static cache). They are read only from the language's own cache now, so the copies there would only take room.
    try {
      const statics = await caches.open(STATIC_CACHE);
      for (const req of await statics.keys()) {
        if (langOf(relPath(new URL(req.url)))) await statics.delete(req);
      }
    } catch { /* a cache that cannot be read is left as it is */ }
    await self.clients.claim();
  })());
});

// The app shell. Only a real HTML page for the app's own root is ever stored as the shell: a navigation to some other
// same-origin file (the manifest, an icon, a data file opened in a tab) must not replace it.
const isShellPath = (p) => p === '' || p === 'index.html';
const isHtml = (res) => /text\/html/i.test(res.headers.get('content-type') || '');

async function networkFirst(request, cacheName, timeoutMs, shell) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      // Asked of the server every time (no-cache revalidates), not taken from the browser's cache: GitHub Pages lets the
      // page be reused for 10 minutes, which kept a new version from showing. A navigation can't be copied with options,
      // so it is fetched by its address.
      fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    if (shell && res.ok && res.status === 200 && isHtml(res)) cache.put('./', res.clone()).catch(() => {});
    return res;
  } catch {
    if (shell) return (await cache.match('./', MATCH)) || Response.error();
    return (await cache.match(request, { ...MATCH, ignoreSearch: true })) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, MATCH);
  if (hit) return hit;
  const res = await fetch(request);
  // Partial and error responses are never stored. Files that were not downloaded ahead of time (a classic's text, a font
  // slice) are stored the first time they are fetched, so they work offline afterwards.
  if (res.ok && res.status === 200) cache.put(request, res.clone()).catch(() => {});
  return res;
}

/**
 * Something shared to the installed app (manifest share_target, Android): its files, title, text and link are kept in a cache
 * of their own and the library opens, which takes them (ui/library/incoming.ts). Only this app's own share address is answered.
 */
const SHARED_CACHE = 'dushu-shared';
async function takeShare(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARED_CACHE);
    const files = form.getAll('books').filter((f) => f && typeof f === 'object' && 'size' in f && f.size > 0).slice(0, 20);
    await Promise.all(files.map((f, i) => cache.put(`./shared/file-${i}`, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Name': encodeURIComponent(f.name || `book-${i}`) } }))));
    const field = (k) => { const v = form.get(k); return typeof v === 'string' ? v.slice(0, 200000) : ''; };
    await cache.put('./shared/meta', new Response(JSON.stringify({ files: files.length, title: field('title'), text: field('text'), url: field('url') }), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* nothing usable was shared: the library opens as it is */ }
  return Response.redirect(new URL('./#/', self.registration.scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method === 'POST' && relPath(new URL(request.url)) === 'share-target' && new URL(request.url).origin === self.location.origin) {
    event.respondWith(takeShare(request));
    return;
  }
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Only this app's own files. Translation APIs and stroke-order data on other origins are left alone.
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('range')) return;
  const path = relPath(url);
  if (path.startsWith('api/')) return; // Private model, books and audio must never be cached.

  if (request.mode === 'navigate' || isShellPath(path)) {
    event.respondWith(networkFirst(request, APP_CACHE, 4000, isShellPath(path)));
  } else if (isFontSlice(path)) {
    // Hashed file names never change, so this cache outlives every app and data update.
    event.respondWith(cacheFirst(request, FONT_CACHE));
  } else if (langOf(path)) {
    // Another language's dictionary and classics: kept in its own cache until that language's files change.
    event.respondWith(cacheFirst(request, langCache(langOf(path))));
  } else if (isStatic(path)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (path.startsWith('assets/')) {
    event.respondWith(cacheFirst(request, APP_CACHE));
  } else {
    // The icon and manifest: fresh when online, the precached copy when not.
    event.respondWith(fetch(request).catch(async () => (await caches.match(request, MATCH)) || Response.error()));
  }
});

// Review reminders (cloud/ sends them as Web Push to each device that turned them on in Settings, core/reminders.ts). The
// message is JSON: { title, body, url, tag }, already in the reader's language. A push with no message (or one that can't be
// read) still shows something, as every push must: the app's name, opening the review. The link is only ever this app's own
// page: one for another address (the public copy's, on a device that uses a private copy) keeps only its #/route, here.
const REVIEW_HASH = '#/review';
function appLink(raw) {
  const scope = new URL(self.registration.scope);
  try {
    const url = new URL(typeof raw === 'string' && raw ? raw : REVIEW_HASH, scope);
    if (url.origin === self.location.origin && url.pathname.startsWith(scope.pathname)) return url.href;
    const here = new URL(scope.href);
    here.hash = url.hash || REVIEW_HASH;
    return here.href;
  } catch {
    return new URL(REVIEW_HASH, scope).href;
  }
}

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = (event.data && event.data.json()) || {}; } catch { msg = {}; }
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const title = text(msg.title, 120) || 'LinguPengu';
  const options = {
    body: text(msg.body, 400),
    tag: text(msg.tag, 64) || 'review',
    icon: new URL('icons/icon-192.png', self.registration.scope).href,
    data: { url: appLink(msg.url) },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// A tap on the notification: an open LinguPengu window comes to the front at the review; with none, one opens there.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = appLink(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = windows.find((c) => c.url.startsWith(self.registration.scope));
    if (!win) { await self.clients.openWindow(url); return; }
    const front = (await win.focus().catch(() => null)) || win;
    // navigate() works only on a window this worker controls; another one is still brought to the front.
    if (front.url !== url && typeof front.navigate === 'function') await front.navigate(url).catch(() => {});
  })());
});
