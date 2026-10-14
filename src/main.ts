// App shell: theme, fonts, nav, hash router, toasts, and the AppContext every screen receives.
import './styles/tokens.css';
import './styles/base.css';
import type { AppContext, Dictionary, MountFn, Settings, Store } from './types';
import { loadDictionary } from './core/dict';
import { openStore } from './store';
import { createSettingsStore } from './store/settings';
import { h, clear } from './ui/dom';
import { parseRoute } from './ui/route';
import { icon } from './ui/icons';
import { watchServiceWorker } from './swUpdate';
import { startSync } from './core/sync';

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

const parseHash = () => parseRoute(location.hash, (r) => Object.prototype.hasOwnProperty.call(ROUTES, r));

async function boot(): Promise<void> {
  injectFonts();
  const settings = createSettingsStore();
  applyTheme(settings.get());
  settings.subscribe((s, changed) => { if (changed.includes('theme')) applyTheme(s); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(settings.get()));

  // If IndexedDB never answers, the page would stay empty. Say what is happening, and after a while what to try.
  const app = document.getElementById('app')!;
  const opening = h('div.app-loading.app-opening', { role: 'status' }, h('div.app-spinner'), h('span', null, 'Opening your library…'));
  app.append(opening);
  const slow = setTimeout(() => {
    opening.replaceChildren(h('div.app-spinner'),
      h('span', null, 'Still opening your library. If this does not finish, close any other Dushu tabs and reload this page.'));
  }, 5000);

  let store: Store;
  try {
    store = await openStore();
  } catch (e) {
    // Only a newer on-disk database lands here; everything else falls back to memory.
    console.error(e);
    clearTimeout(slow);
    opening.remove();
    app.append(h('main.app-fatal', null,
      h('h1', null, 'Dushu cannot open your saved data'),
      h('p', null, e instanceof Error ? e.message : 'The local database could not be opened.')));
    return;
  }
  clearTimeout(slow);
  opening.remove();

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
      const ms = opts?.ms ?? 3500;
      // The same message again, or a second "Added ... Read" while the first is still up, replaces the old one.
      // (Other actions, such as Undo, never replace each other: each one still undoes its own change.)
      const coalesce = opts?.action?.label === 'Read';
      for (const old of [...toasts.children] as HTMLElement[]) {
        if (old.dataset.msg === message || (coalesce && old.dataset.action === 'Read')) old.dispatchEvent(new Event('dismiss'));
      }
      const el = h('div.app-toast', { 'data-msg': message, 'data-action': opts?.action?.label ?? '' });
      const text = h('span.app-toast-text', { title: message }, message);
      el.append(text);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const dismiss = () => { clearTimeout(timer); el.remove(); };
      el.addEventListener('dismiss', dismiss);
      if (opts?.action) {
        const a = opts.action;
        el.appendChild(h('button.app-toast-action', { type: 'button', onclick: () => { a.run(); dismiss(); } }, a.label));
      }
      // A toast that stays a long time (errors, the update notice) can be put away.
      if (ms > 6000) el.appendChild(h('button.app-toast-close', { type: 'button', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: dismiss }, icon('close')));
      toasts.appendChild(el);
      while (toasts.children.length > 3) toasts.firstElementChild!.dispatchEvent(new Event('dismiss'));
      timer = setTimeout(dismiss, ms);
    },
  };
  if (store.backend === 'memory') {
    ctx.toast('This browser is blocking local storage, so books and words will be lost when you close the tab.', { ms: 9000 });
  }
  // Start parsing the dictionary right away; the library does not wait for it.
  ctx.dict().catch((e) => { console.error(e); ctx.toast('Could not load the dictionary data. Run `npm run data`.'); });
  // Saved words, known words and reading places, kept the same on every device connected to the Mac.
  startSync(store);

  const reviewBadge = h('span.app-badge', { hidden: true });
  const navLink = (href: string, label: string, ic: string, extra?: Node) =>
    h('a.app-navlink', { href, title: label, 'aria-label': label, 'data-route': href.replace(/^#\/?/, '') }, icon(ic), h('span.app-navlabel', null, label), extra ?? null);
  const nav = h('nav.app-nav', { 'aria-label': 'Main' },
    h('a.app-brand', { href: '#/' }, h('span.app-brand-zh', null, '读书'), h('span.app-brand-en', null, 'Dushu')),
    navLink('#/', 'Library', 'library'),
    navLink('#/vocab', 'Vocabulary', 'list'),
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
  // Also fires for a save made in another tab.
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
    let mod: { mount: MountFn };
    try {
      mod = await ROUTES[route]();
    } catch (e) {
      // Offline with a screen that was never downloaded, or a deploy that replaced the file: say so, and offer a retry.
      console.error(e);
      if (seq !== navSeq) return;
      clear(screen);
      screen.appendChild(h('div.app-loading.app-load-failed', { role: 'alert' },
        h('span', null, navigator.onLine === false ? 'You are offline, and this screen has not been downloaded yet.' : 'This screen could not be loaded.'),
        h('button.btn', { type: 'button', onclick: () => void render() }, icon('refresh'), 'Try again')));
      return;
    }
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

void boot();
