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

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    if (res.ok) cache.put('./', res.clone()).catch(() => {});
    return res;
  } catch {
    return (await cache.match('./')) || (await cache.match(request, { ignoreSearch: true })) || Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // Partial and error responses are never stored.
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

  if (request.mode === 'navigate' || path === '' || path === 'index.html') {
    event.respondWith(networkFirst(request, APP_CACHE, 4000));
  } else if (isFontSlice(path)) {
    // Hashed file names never change, so this cache outlives every app and data update.
    event.respondWith(cacheFirst(request, FONT_CACHE));
  } else if (isStatic(path)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (path.startsWith('assets/')) {
    event.respondWith(cacheFirst(request, APP_CACHE));
  } else {
    // The icon and manifest: fresh when online, the precached copy when not.
    event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || Response.error()));
  }
});
