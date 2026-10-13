// Dushu service worker: makes the installed app work offline.
//   - index.html: network first (so a new build shows up), cached copy when offline
//   - assets/ (hashed JS and CSS): cache first, precached at install
//   - data/, fonts/, samples/: cache first, in their own cache that survives app updates.
//   - The bundled font slices (assets/*.woff2): cache first in a third cache that is never cleared by an update. Font slices are not precached (there are hundreds): each one is stored the
//     first time a book needs it, so a page you have read once reads offline.
//   - A new version installs in the background and waits; the page shows "Reload" and sends SKIP_WAITING.
// The three __PLACEHOLDERS__ below are filled in by the build (see vite.config.ts); in dev this file is not used.
const BUILD = '__BUILD__';
const DATA_VERSION = '__DATA_VERSION__';
const PRECACHE = __PRECACHE__;

const APP_CACHE = `dushu-app-${BUILD}`;
const STATIC_CACHE = `dushu-static-${DATA_VERSION}`;
const FONT_CACHE = 'dushu-fonts-v1';
const SCOPE = new URL(self.registration.scope).pathname;

// Every cache lookup ignores Vary. vite preview and many static hosts answer with "Vary: Origin", and Chrome sends an
// Origin header on module requests (import() of a lazy chunk, a worker) but not on a plain navigation. Without this a
// cache.match() for such a request misses a file that is in the cache, and the screen stays on "Loading…" offline.
const MATCH = { ignoreVary: true };

const relPath = (url) => decodeURIComponent(url.pathname.slice(SCOPE.length));
const isFontSlice = (p) => p.startsWith('assets/') && p.endsWith('.woff2');
const isStatic = (p) => p.startsWith('data/') || p.startsWith('fonts/') || p.startsWith('samples/');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const app = await caches.open(APP_CACHE);
    const stat = await caches.open(STATIC_CACHE);
    // One missing file must not fail the install: the app still works online, and the next visit retries.
    const add = (cache, paths) => Promise.all(paths.map((p) => cache.add(new Request(p, { cache: 'reload' })).catch(() => {})));
    await add(app, ['./', ...PRECACHE.filter((p) => !isStatic(p))]);
    await add(stat, PRECACHE.filter(isStatic));
    // No skipWaiting here: the page decides when to switch (see the message handler), so an update never changes
    // the app under someone who is in the middle of a chapter.
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('dushu-') && name !== APP_CACHE && name !== STATIC_CACHE && name !== FONT_CACHE) await caches.delete(name);
    }
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
      fetch(request),
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

self.addEventListener('fetch', (event) => {
  const request = event.request;
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
  } else if (isStatic(path)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (path.startsWith('assets/')) {
    event.respondWith(cacheFirst(request, APP_CACHE));
  } else {
    // The icon and manifest: fresh when online, the precached copy when not.
    event.respondWith(fetch(request).catch(async () => (await caches.match(request, MATCH)) || Response.error()));
  }
});
