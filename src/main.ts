// App shell: theme, fonts, nav, hash router, toasts, and the AppContext every screen receives.
import './styles/tokens.css';
import './styles/base.css';
import type { AppContext, Dictionary, MountFn, Settings, Store } from './types';
import { loadDictionary } from './core/dict';
import { openStore } from './store';
import { createSettingsStore } from './store/settings';
import { h, clear } from './ui/dom';
import { icon } from './ui/icons';

const ROUTES: Record<string, () => Promise<{ mount: MountFn }>> = {
  '': () => import('./ui/library/library'),
  read: () => import('./ui/reader/reader'),
  vocab: () => import('./ui/vocab/vocab'),
  review: () => import('./ui/review/review'),
  settings: () => import('./ui/settings/settings'),
  about: () => import('./ui/about/about'),
};

function injectFonts(): void {
  const url = (f: string) => new URL(`fonts/${f}`, document.baseURI).href;
  const css = `
@font-face { font-family: 'Jigmo'; src: url('${url('Jigmo.woff2')}') format('woff2'); font-display: swap; unicode-range: U+2E80-2FDF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF; }
@font-face { font-family: 'Jigmo2'; src: url('${url('Jigmo2.woff2')}') format('woff2'); font-display: swap; unicode-range: U+20000-2FFFF; }
@font-face { font-family: 'Jigmo3'; src: url('${url('Jigmo3.woff2')}') format('woff2'); font-display: swap; unicode-range: U+30000-3FFFF; }`;
  document.head.appendChild(h('style', { 'data-fonts': '' }, css));
}

function applyTheme(s: Settings): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = s.theme === 'system' ? (dark ? 'dark' : 'light') : s.theme;
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#f6f2ea');
}

function parseHash(): { route: string; params: Record<string, string> } {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(query));
  const route = parts[0] ?? '';
  if (route === 'read' && parts[1]) params.bookId = parts[1];
  return { route: route in ROUTES ? route : '', params };
}

async function boot(): Promise<void> {
  injectFonts();
  const settings = createSettingsStore();
  applyTheme(settings.get());
  settings.subscribe((s, changed) => { if (changed.includes('theme')) applyTheme(s); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(settings.get()));

  let store: Store;
  try {
    store = await openStore();
  } catch (e) {
    // Only a newer on-disk database lands here; everything else falls back to memory.
    console.error(e);
    const app = document.getElementById('app')!;
    app.append(h('main.app-fatal', null,
      h('h1', null, 'Dushu cannot open your saved data'),
      h('p', null, e instanceof Error ? e.message : 'The local database could not be opened.')));
    return;
  }

  let dictPromise: Promise<Dictionary> | null = null;
  let dictReady: Dictionary | null = null;
  const toasts = h('div.app-toasts', { role: 'status', 'aria-live': 'polite' });

  const ctx: AppContext = {
    dict() {
      dictPromise ??= loadDictionary(new URL('data/', document.baseURI).href).then((d) => {
        store.setNormalizer((w) => d.toSimplified(w));
        return (dictReady = d);
      });
      return dictPromise;
    },
    dictSync: () => dictReady,
    settings,
    store,
    navigate(hash) { location.hash = hash.startsWith('#') ? hash : `#${hash}`; },
    toast(message, opts) {
      const el = h('div.app-toast', null, h('span', null, message));
      if (opts?.action) {
        const a = opts.action;
        el.appendChild(h('button', { onclick: () => { a.run(); el.remove(); } }, a.label));
      }
      toasts.appendChild(el);
      setTimeout(() => el.remove(), opts?.ms ?? 3500);
    },
  };
  if (store.backend === 'memory') {
    ctx.toast('This browser is blocking local storage, so books and words will be lost when you close the tab.', { ms: 9000 });
  }
  // Start parsing the dictionary right away; the library does not wait for it.
  ctx.dict().catch((e) => { console.error(e); ctx.toast('Could not load the dictionary data. Run `npm run data`.'); });

  const app = document.getElementById('app')!;
  const reviewBadge = h('span.app-badge', { hidden: true });
  const navLink = (href: string, label: string, ic: string, extra?: Node) =>
    h('a.app-navlink', { href, title: label, 'aria-label': label, 'data-route': href.replace(/^#\/?/, '') }, icon(ic), h('span.app-navlabel', null, label), extra ?? null);
  const nav = h('nav.app-nav', { 'aria-label': 'Main' },
    h('a.app-brand', { href: '#/' }, h('span.app-brand-zh', null, '读书'), h('span.app-brand-en', null, 'Dushu')),
    navLink('#/', 'Library', 'library'),
    navLink('#/vocab', 'Vocabulary', 'star'),
    navLink('#/review', 'Review', 'cards', reviewBadge),
    navLink('#/settings', 'Settings', 'settings'),
  );
  const screen = h('main#screen');
  app.append(nav, screen, toasts);

  // Ask the browser not to evict our data. Safari can clear the storage of sites that are not on the Home Screen, so this
  // is asked once the person has something worth keeping: after the first book is added.
  let persistAsked = false;
  const askPersist = async () => {
    if (persistAsked || !navigator.storage?.persist) return;
    persistAsked = true;
    try {
      if (!(await navigator.storage.persisted())) await navigator.storage.persist();
    } catch { /* not available here */ }
  };
  store.onChange((what) => { if (what === 'books') void askPersist(); });
  void store.books.list().then((b) => { if (b.length) void askPersist(); }, () => {});

  const refreshBadge = async () => {
    const n = (await store.vocab.due(Date.now())).length;
    reviewBadge.hidden = n === 0;
    reviewBadge.textContent = n > 99 ? '99+' : String(n);
  };
  store.onChange((what) => { if (what === 'vocab') void refreshBadge(); });
  void refreshBadge();

  let cleanup: (() => void) | void;
  let navSeq = 0;
  const render = async () => {
    const seq = ++navSeq;
    const { route, params } = parseHash();
    document.body.dataset.route = route || 'library';
    for (const a of nav.querySelectorAll<HTMLAnchorElement>('.app-navlink')) {
      a.toggleAttribute('aria-current', a.dataset.route === route);
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    }
    try { cleanup?.(); } catch (e) { console.error(e); }
    cleanup = undefined;
    clear(screen);
    screen.appendChild(h('div.app-loading', null, h('div.app-spinner'), 'Loading…'));
    const mod = await ROUTES[route]();
    if (seq !== navSeq) return;
    clear(screen);
    window.scrollTo(0, 0);
    cleanup = await mod.mount(screen, params, ctx);
    if (seq !== navSeq) { try { cleanup?.(); } catch { /* ignore */ } }
  };
  window.addEventListener('hashchange', () => void render());
  await render();
  // After the first screen: the reading fonts' rules are large and nothing needs them to paint.
  void import('./fonts').catch(() => {});

  if (import.meta.env.PROD && 'serviceWorker' in navigator) watchServiceWorker(ctx);
}

/** Registers the service worker and offers "Reload" when a new version has been downloaded and is waiting. */
function watchServiceWorker(ctx: AppContext): void {
  let updateOffered = false;
  let waitingWorker: ServiceWorker | null = null;
  const offer = (worker: ServiceWorker) => {
    waitingWorker = worker;
    if (updateOffered) return;
    updateOffered = true;
    ctx.toast('A new version of Dushu is ready.', {
      ms: 24 * 3600 * 1000,
      action: { label: 'Reload', run: () => waitingWorker?.postMessage('SKIP_WAITING') },
    });
  };
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first install claims the page too; only an update (a previous controller existed) needs a reload.
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).then((reg) => {
    const watch = (worker: ServiceWorker | null) => {
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker); });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    // An installed app on an iPad can stay open for days: look for a new version whenever it comes back to the front.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}

void boot();
