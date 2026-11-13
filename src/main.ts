// App shell: theme, fonts, nav, hash router, toasts, and the AppContext every screen receives.
import { penguEl, penguMark, penguSays, preloadPengu } from './ui/pengu';
import { num, startI18n, tt, ttm, ttn } from './i18n';
import './styles/tokens.css';
import './styles/base.css';
import type { AppContext, Dictionary, MountFn, Settings, Store } from './types';
import { byteMeter, dataSizes, fetchDataBytes, fetchDataText, type Keep } from './core/dataFetch';
import { setDictBytes } from './core/dictProgress';
import { openStore } from './store';
import { createSettingsStore } from './store/settings';
import { h, clear } from './ui/dom';
import { parseRoute } from './ui/route';
import { icon } from './ui/icons';
import { watchServiceWorker } from './swUpdate';
import { startSync } from './core/sync';
import { CLOUD_EVENT, accountInfo, cloudSession } from './core/cloud';
import { finishGoogleReturn, takeGoogleReturn } from './core/google';
import { BOOKS_EVENT, syncBooks, type BooksReport } from './core/cloudBooks';
import { linkMac } from './core/cloudLink';
import { watchSignOut } from './core/reminders';
import { signInButton } from './ui/signIn';
import { reviewCount } from './ui/review/learning';
import { scriptView } from './ui/vocab/render';
import { activeEngine, isChinese, lang, setActiveEngine, storeName } from './lang/active';
import { loadOwnDictionary, setReaderLanguage, withOwnDictionary } from './lang/ownDictionary';
import { noChineseDictionary } from './lang/noChinese';
import { langChip } from './ui/langSwitch';
import { needsWelcome } from './core/plan';
import { goalMessage, startReadingClock } from './core/readingClock';
import { listenForOpenedFiles } from './ui/library/incoming';

/**
 * A sign-in coming back from Google (core/google.ts) carries its ID token in the address's fragment ('#id_token=…&state=…').
 * It is taken out first, before the router or anything else reads the address: the screen the person left from takes its
 * place in the address bar and the history, so the token is never kept in either, nor bookmarked or shared. What it brought
 * is finished once the app can say how it went (boot, below).
 */
const googleReturn = takeGoogleReturn();

const ROUTES: Record<string, () => Promise<{ mount: MountFn }>> = {
  '': () => import('./ui/library/library'),
  read: () => import('./ui/reader/reader'),
  vocab: () => import('./ui/vocab/vocab'),
  review: () => import('./ui/review/review'),
  settings: () => import('./ui/settings/settings'),
  about: () => import('./ui/about/about'),
  join: () => import('./ui/join'),
};

/** Newsreader (OFL-1.1, public/fonts/Newsreader-OFL.txt) is a Latin-1 subset for the app's own English; precached by sw.js. */
const NEWSREADER_RANGE = 'U+0020-007E, U+00A0-00FF, U+2013-2014, U+2018-201D, U+2022, U+2026, U+2032-2033, U+2039-203A, U+2192';

function injectFonts(): void {
  const url = (f: string) => new URL(`fonts/${f}`, document.baseURI).href;
  const css = `
@font-face { font-family: 'Jigmo'; src: url('${url('Jigmo.woff2')}') format('woff2'); font-display: swap; unicode-range: U+2E80-2FDF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF; }
@font-face { font-family: 'Jigmo2'; src: url('${url('Jigmo2.woff2')}') format('woff2'); font-display: swap; unicode-range: U+20000-2FFFF; }
@font-face { font-family: 'Jigmo3'; src: url('${url('Jigmo3.woff2')}') format('woff2'); font-display: swap; unicode-range: U+30000-3FFFF; }
@font-face { font-family: 'Newsreader'; src: url('${url('newsreader-roman.woff2')}') format('woff2'); font-style: normal; font-weight: 400 500; font-display: swap; unicode-range: ${NEWSREADER_RANGE}; }
@font-face { font-family: 'Newsreader'; src: url('${url('newsreader-italic.woff2')}') format('woff2'); font-style: italic; font-weight: 400 500; font-display: swap; unicode-range: ${NEWSREADER_RANGE}; }`;
  document.head.appendChild(h('style', { 'data-fonts': '' }, css));
}

/** The theme setting last applied, and how many cross-fades have started (applyTheme). */
let themeShown: Settings['theme'] | null = null;
let themeFades = 0;

/**
 * Draws the page in the theme set. A theme picked by hand (in Settings or the reader's menu) cross-fades the whole page, bar
 * and all, in about a quarter second with the View Transitions API (base.css, .app-theme-fade), so the eye sees the same page
 * change color rather than a flash. The first draw, the system turning light or dark under Auto, and everything under reduced
 * motion or without the API change at once.
 */
function applyTheme(s: Settings): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = s.theme === 'system' ? (dark ? 'dark' : 'light') : s.theme;
  const root = document.documentElement;
  const show = () => {
    root.dataset.theme = theme;
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#f6f2ea');
  };
  const picked = themeShown !== null && themeShown !== s.theme && root.dataset.theme !== theme;
  themeShown = s.theme;
  if (!picked || still()) { show(); return; }
  // Picked by hand: the colors ease to the new ones (base.css .app-theme-fade). Only colors move and nothing is captured or
  // covered, so a tap during it still lands (a View Transition sent every tap to the page for its length). A newer change keeps
  // the class until its own ease ends.
  const fade = ++themeFades;
  root.classList.add('app-theme-fade');
  show();
  window.setTimeout(() => { if (fade === themeFades) root.classList.remove('app-theme-fade'); }, THEME_FADE_MS + 40);
}

/** How long a theme picked by hand takes to ease in (base.css .app-theme-fade). */
const THEME_FADE_MS = 240;

const parseHash = () => parseRoute(location.hash, (r) => Object.prototype.hasOwnProperty.call(ROUTES, r));

/** Each screen's name in the browser's tab and history (the reader puts the book's title there itself). */
const TITLES: Record<string, string> = { '': ttm('Library'), vocab: ttm('Vocabulary'), review: ttm('Review'), settings: ttm('Settings'), about: ttm('About'), join: ttm('Join') };

/** The libraries whose pages show Chinese or Japanese: they load the reading fonts (fonts.ts). */
const CJK_LIBRARIES = new Set(['zh', 'ja', 'en']);

/** What a browser says itself when a request fails, times out or is cut off (Chrome, Safari, Firefox): never shown as a reason. */
const BROWSER_TEXT = /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|signal timed out|signal is aborted without reason|The (operation|user) (was aborted|timed out|aborted a request)\.?|.*dynamically imported module.*)$/i;

/** How often an open app asks the account for its books (main's accountBooks): see where it is used. */
const BOOKS_EVERY_MS = 10 * 60_000;

/** How long a first visit waits for its downloads to reach the offline copy before installing it anyway. */
const HANDOFF_WAIT_MS = 30_000;

/** Under reduced motion nothing in the shell moves: screens change, toasts go and the tab's underline jumps at once. */
const still = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** How long a dismissed toast takes to fade. */
const TOAST_FADE_MS = 180;

/**
 * On a first visit (no service worker yet), every dictionary file the page downloads is also put in FIRST_VISIT_CACHE. The
 * worker installs once they are all there, files each one in its language's cache and only asks the server whether it is
 * current, so the dictionary works offline after one visit in every language and is not downloaded twice.
 */
function firstVisitHandoff(): { keep?: Keep; track: <T>(p: Promise<T>) => Promise<T>; keepUrl: (url: string) => void; settled: () => Promise<void> } {
  const first = import.meta.env.PROD && 'serviceWorker' in navigator && !navigator.serviceWorker.controller && 'caches' in window;
  const cache = first ? caches.open('dushu-first-visit') : null;
  cache?.catch(() => {});
  const pending = new Set<Promise<void>>();
  const hold = (p: Promise<unknown>) => {
    const q = p.then(() => {}, () => {});
    pending.add(q);
    void q.then(() => pending.delete(q));
  };
  return {
    keep: cache ? (url, res) => hold(cache.then((c) => c.put(url, res))) : undefined,
    /** A download that hands its file over once it starts: waited for too. */
    track: (p) => { if (cache) hold(p); return p; },
    /** A file the page has just loaded some other way (a stylesheet): asked for again, from the browser's cache, and kept. */
    keepUrl: (url) => { if (cache) hold(fetch(url).then((res) => (res.ok ? cache.then((c) => c.put(url, res)) : undefined))); },
    async settled() {
      const until = Date.now() + HANDOFF_WAIT_MS;
      while (pending.size && Date.now() < until) {
        await Promise.race([Promise.all([...pending]), new Promise((r) => setTimeout(r, until - Date.now()))]);
      }
    },
  };
}

async function boot(): Promise<void> {
  // Asked before anything is written: a device that has never been used is welcomed (ui/welcome.ts) before the dictionary
  // downloads, so someone learning Spanish never waits for the Chinese one.
  const welcome = needsWelcome();
  // The app's own words in the reader's language (src/i18n), before anything is drawn.
  await startI18n();
  // A book opened with the installed app ("Open with") is kept for the library from the very start.
  listenForOpenedFiles();
  injectFonts();
  const L = lang();
  document.documentElement.dataset.lang = L.id;
  const settings = createSettingsStore(undefined, L.id);
  // Whose language the word meanings follow (lang/ownDictionary.ts): the one sentences go into.
  setReaderLanguage(settings.get().translateTo);
  applyTheme(settings.get());
  settings.subscribe((s, changed) => { if (changed.includes('theme')) applyTheme(s); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(settings.get()));
  if (welcome) {
    const { showWelcome } = await import('./ui/welcome');
    await showWelcome(settings, { current: L.id });
  }

  // If IndexedDB never answers, the page would stay empty. Say what is happening, and after a while what to try.
  const app = document.getElementById('app')!;
  // Pengu reading while the library opens (ui/pengu.ts), in place of a spinner.
  preloadPengu();
  const opening = h('div.app-loading.app-opening', { role: 'status' }, penguEl('read', 'app-opening-pengu', { tap: false }), h('span', null, tt('Opening your library…')));
  app.append(opening);
  const slow = setTimeout(() => {
    opening.replaceChildren(h('div.app-spinner'),
      h('span', null, tt('Still opening your library. If this does not finish, close any other LinguPengu tabs and reload this page.')));
  }, 5000);

  // The dictionary takes longest to be ready, so it starts first: its files download and parse while the library opens.
  // Another language loads its own engine (src/lang/<id>) from data/<id>/; screens written for Chinese then see an empty
  // Chinese dictionary (lang/noChinese.ts) and the engine does the work (lang/active.ts activeEngine).
  const dictUrl = new URL(isChinese() ? 'data/' : `data/${L.id}/`, document.baseURI).href;
  // On a first visit the files are also handed to the offline copy (firstVisitHandoff).
  const handoff = firstVisitHandoff();
  const keep = handoff.keep;
  // The Chinese dictionary's code is a chunk of its own (about 100 KB), so another language's first screen never waits for it.
  let ownWatched = false;
  const loadDict = (opts: { keep?: Keep; onBytes?: (loaded: number, total: number) => void }): Promise<Dictionary> => {
    if (isChinese()) return import('./core/dict').then((m) => m.loadDictionary(dictUrl, opts));
    // Each file the engine asks for counts toward the reader's "Downloading the dictionary: x of y MB" and is handed over.
    // Only the ones it asks for at the start count: those are what it waits for. One asked for once the engine is ready
    // (English pronunciations) would take the line back to "Downloading" after it said the dictionary was getting ready.
    const meter = opts.onBytes ? byteMeter(opts.onBytes, handoff.track(dataSizes(dictUrl, opts.keep))) : null;
    let atStart: boolean | null = null;
    const fetchBytes = (name: string) => {
      if (atStart === null) { atStart = true; setTimeout(() => { atStart = false; }, 0); }
      return handoff.track(fetchDataBytes(dictUrl + name, opts.keep, atStart ? meter?.(name) : undefined));
    };
    // Meanings in the book's own language, for a reader who gets them (lang/ownDictionary.ts): fetched alongside the engine, so
    // the first word card already has them, and again whenever the reader's language changes.
    const own = () => loadOwnDictionary(L.id, dictUrl, (url) => fetchDataText(url, opts.keep));
    if (!ownWatched) {
      ownWatched = true;
      settings.subscribe((s, changed) => {
        if (!changed.includes('translateTo')) return;
        setReaderLanguage(s.translateTo);
        void own();
      });
    }
    return Promise.all([L.load!().then((m) => m.loadEngine(dictUrl, { fetchBytes })), own()]).then(([engine]) => {
      setActiveEngine(withOwnDictionary(engine));
      return noChineseDictionary(activeEngine()!);
    });
  };
  let early: Promise<Dictionary> | null = loadDict({ keep, onBytes: setDictBytes });
  early.catch(() => {}); // reported by the first ctx.dict() below

  let store: Store;
  try {
    store = await openStore(storeName());
  } catch (e) {
    // Only a newer on-disk database lands here; everything else falls back to memory.
    console.error(e);
    clearTimeout(slow);
    opening.remove();
    app.append(h('main.app-fatal', null,
      h('h1', null, tt('LinguPengu cannot open your saved data')),
      h('p', null, e instanceof Error ? e.message : tt('The local database could not be opened.'))));
    return;
  }
  clearTimeout(slow);
  opening.remove();

  let dictPromise: Promise<Dictionary> | null = null;
  let dictReady: Dictionary | null = null;
  const toasts = h('div.app-toasts', { role: 'status', 'aria-live': 'polite' });

  const ctx: AppContext = {
    dict() {
      // A failed download is not kept: the next use (a lookup, opening a book) downloads it again.
      dictPromise ??= (early ?? loadDict({ onBytes: setDictBytes })).then((d) => {
        // Saved and known words match any form of a word: a script for Chinese, the dictionary form for the rest.
        if (isChinese()) {
          store.setNormalizer((w) => d.toSimplified(w));
          // The reading model (core/readingModel.ts) follows the dictionary in the background. Until it arrives, and when it
          // cannot (offline with an old copy, a missing file), the rules alone give every reading.
          const model = import('./core/readingModel').then(({ loadReadingModel }) => loadReadingModel((name) => fetchDataText(dictUrl + name, keep)));
          void handoff.track(model).then((m) => { if (m) d.setReadingModel?.(m); }, () => {});
        } else {
          const engine = activeEngine();
          if (engine) store.setNormalizer((w) => engine.normalize(w));
        }
        return (dictReady = d);
      }, (e: unknown) => {
        dictPromise = null;
        throw e;
      });
      early = null;
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
      // The label as the screens give it, in the app's language.
      const read = tt('Read');
      const coalesce = opts?.action?.label === read;
      // A toast fading out is already gone: it is never replaced or counted again.
      const shown = () => ([...toasts.children] as HTMLElement[]).filter((t) => !t.dataset.gone);
      for (const old of shown()) {
        if (old.dataset.msg === message || (coalesce && old.dataset.action === read)) old.dispatchEvent(new Event('dismiss'));
      }
      const el = h('div.app-toast', { 'data-msg': message, 'data-action': opts?.action?.label ?? '' });
      const text = h('span.app-toast-text', { title: message }, message);
      el.append(text);
      let timer: ReturnType<typeof setTimeout> | undefined;
      // Put away by its timer or its buttons, a toast fades out where it is. Replaced by a newer one (the event), it goes at once,
      // so the new one takes its place instead of stacking under a fading copy.
      const dismiss = (fade = true) => {
        if (el.dataset.gone) return;
        el.dataset.gone = '1';
        clearTimeout(timer);
        if (!fade || still() || typeof el.animate !== 'function') { el.remove(); return; }
        el.setAttribute('aria-hidden', 'true');
        el.inert = true;
        el.style.pointerEvents = 'none';
        const anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: TOAST_FADE_MS, easing: 'ease-in', fill: 'forwards' });
        anim.onfinish = anim.oncancel = () => el.remove();
        setTimeout(() => el.remove(), TOAST_FADE_MS + 200); // a tab in the background may never finish it
      };
      el.addEventListener('dismiss', () => dismiss(false));
      if (opts?.action) {
        const a = opts.action;
        el.appendChild(h('button.app-toast-action', { type: 'button', onclick: () => { a.run(); dismiss(); } }, a.label));
      }
      // A toast that stays a long time (errors, the update notice) can be put away.
      if (ms > 6000) el.appendChild(h('button.app-toast-close', { type: 'button', 'aria-label': tt('Dismiss'), title: tt('Dismiss'), onclick: () => dismiss() }, icon('close')));
      toasts.appendChild(el);
      for (let up = shown(); up.length > 3; up = shown()) up[0].dispatchEvent(new Event('dismiss'));
      timer = setTimeout(dismiss, ms);
    },
  };
  if (store.backend === 'memory') {
    ctx.toast(tt('This browser is blocking local storage, so books and words will be lost when you close the tab.'), { ms: 9000 });
  }
  // Start parsing the dictionary right away; the library does not wait for it.
  ctx.dict().catch((e) => { console.error(e); ctx.toast(tt('Could not download the dictionary. Check your connection; LinguPengu will try again.'), { ms: 8000 }); });
  // Saved words, known words, reading places, lookups and bookmarks, kept the same on every device signed in to the sync
  // account (or connected to the Mac), each language's library apart. Signed in, a device also learns where the Mac is, for
  // the Mac's books.
  startSync(store, { settings });
  // Back from Google: the token goes to the sync server, and its sign-in is kept like an emailed code's (sync starts, the
  // account's books come, with the same messages).
  if (googleReturn) void finishGoogleReturn(googleReturn, (message, ms) => ctx.toast(message, { ms }));
  void linkMac();
  window.addEventListener(CLOUD_EVENT, () => void linkMac());
  // Review reminders on this device are the signed-in account's: however the sign-in ends, they end here too.
  watchSignOut();
  // Whether this account is the owner's (the Mac and Claude settings follow it): asked on each start.
  if (cloudSession()) void accountInfo().catch(() => {});
  // Books in the account: this device's go up and the account's come down, on open, on sign-in, when the app comes back to
  // the front and every 10 minutes while it is in front, and each run says what it did (or what went wrong, once). Ten, not
  // five: Workers Free answers 100,000 requests a day for everyone together, and each run is at least one (GET /books). A
  // book added on another device still arrives the moment this one comes back to the front, which is when it is wanted.
  // Not tried without a connection: the first run once it is back says what came down.
  const accountBooks = () => { if (cloudSession() && navigator.onLine !== false) void syncBooks(store); };
  const toldErrors = new Set<string>();
  window.addEventListener(BOOKS_EVENT, (e) => {
    const r = (e as CustomEvent<BooksReport>).detail;
    const title = (t: string[]) => scriptView(ctx.settings.get().script, ctx.dictSync()).text(t[0]);
    const up = r.uploaded.length;
    const down = r.added.length;
    if (up) ctx.toast(up === 1 ? tt('Saved “{title}” to your account.', { title: title(r.uploaded) }) : ttn(up, 'Saved {n} book to your account.', 'Saved {n} books to your account.'), { ms: 5000 });
    if (down) ctx.toast(down === 1 ? tt('Added “{title}” from your account.', { title: title(r.added) }) : ttn(down, 'Added {n} book from your account.', 'Added {n} books from your account.'), { ms: 6000 });
    // Only what LinguPengu can say in its own words: a browser's own text for a dropped connection ("Failed to fetch") is not
    // shown, and Settings → Sync already says when the server cannot be reached.
    if (r.error && !BROWSER_TEXT.test(r.error) && !toldErrors.has(r.error)) { toldErrors.add(r.error); ctx.toast(tt('Your books could not sync with your account: {error}', { error: r.error }), { ms: 9000 }); }
  });
  accountBooks();
  window.addEventListener(CLOUD_EVENT, accountBooks);
  window.addEventListener('online', accountBooks);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') accountBooks(); });
  setInterval(() => { if (document.visibilityState === 'visible') accountBooks(); }, BOOKS_EVERY_MS);

  /** The app's mark, as in the browser tab (public/icon.svg): Pengu over its book on a white rounded square (ui/pengu.ts). */
  const brandMark = () => {
    const el = h('span.app-brand-mark', { 'aria-hidden': 'true' });
    el.innerHTML = penguMark();
    return el;
  };
  const reviewBadge = h('span.app-badge', { hidden: true });
  const navLink = (href: string, label: string, ic: string, extra?: Node) =>
    h('a.app-navlink', { href, title: label, 'aria-label': label, 'data-route': href.replace(/^#\/?/, '') }, icon(ic), h('span.app-navlabel', null, label), extra ?? null);
  const nav = h('nav.app-nav', { 'aria-label': tt('Main') },
    h('a.app-brand', { href: '#/', 'aria-label': tt('LinguPengu, library') }, brandMark(), h('span.app-brand-en', null, 'LinguPengu')),
    langChip(),
    navLink('#/', tt('Library'), 'library'),
    navLink('#/vocab', tt('Vocabulary'), 'list'),
    navLink('#/review', tt('Review'), 'cards', reviewBadge),
    navLink('#/settings', tt('Settings'), 'settings'),
    signInButton(),
  );
  // One underline for the current tab: it slides to the new tab when the screen changes (base.css .app-nav-line).
  const navLine = h('span.app-nav-line', { 'aria-hidden': 'true' });
  nav.append(navLine);
  const screen = h('main#screen');
  app.append(nav, screen, toasts);
  /**
   * Puts the underline under the current tab, sized to it with a transform. It slides only on a screen change; when the bar itself
   * changes (a resize, the icons-only bar, a label's font arriving, the Review count) or it was not showing, it is set in place.
   */
  const placeNavLine = (slide: boolean) => {
    const tab = nav.querySelector<HTMLElement>('.app-navlink[aria-current="page"]');
    const box = tab?.getBoundingClientRect();
    if (!box?.width) { navLine.classList.remove('app-nav-line-on'); return; }
    const jump = !slide || !navLine.classList.contains('app-nav-line-on');
    navLine.classList.toggle('app-nav-line-jump', jump);
    navLine.style.transform = `translateX(${box.left - nav.getBoundingClientRect().left}px) scaleX(${box.width})`;
    if (jump) void navLine.offsetWidth; // the move is drawn with the transition off
    navLine.classList.remove('app-nav-line-jump');
    navLine.classList.add('app-nav-line-on');
  };
  // Labels that do not fit (Einstellungen, Bibliothèque on a phone) give way to the icons, as on the narrowest screens; measured
  // with the labels shown, so a wider screen or a shorter language brings them back.
  const fitNav = () => {
    nav.classList.remove('app-nav-tight');
    if (nav.scrollWidth > nav.clientWidth + 1) nav.classList.add('app-nav-tight');
  };
  if (typeof ResizeObserver === 'function') {
    // Every item in the bar, since any of them growing moves the tabs.
    const ro = new ResizeObserver(() => { fitNav(); placeNavLine(false); });
    for (const el of [nav, ...nav.children]) if (el !== navLine) ro.observe(el);
  }
  fitNav();

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

  let badgeTimer: ReturnType<typeof setTimeout> | undefined;
  let badgeSeq = 0;
  const refreshBadge = async () => {
    const seq = ++badgeSeq;
    const now = Date.now();
    // The due saved words and the looked-up words Review would add (review/learning.ts).
    const n = await reviewCount(store, now);
    const next = (await store.vocab.list()).reduce((m, v) => (v.srs.due > now && v.srs.due < m ? v.srs.due : m), Infinity);
    if (seq !== badgeSeq) return;
    reviewBadge.hidden = n === 0;
    reviewBadge.textContent = n > 99 ? `${num(99)}+` : num(n);
    // Again when the next card falls due (a ten-minute step, tomorrow's cards in a tab left open). The wait is capped at an
    // hour: a timer of more than about 24 days would fire at once.
    clearTimeout(badgeTimer);
    if (next !== Infinity) badgeTimer = setTimeout(() => void refreshBadge(), Math.min(next - now + 500, 3_600_000));
  };
  // Also fires for a save made in another tab. A device that slept holds its timers, so coming back to the front counts too.
  store.onChange((what) => { if (what === 'vocab' || what === 'lookups' || what === 'known') void refreshBadge(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshBadge(); });
  void refreshBadge();

  // Time in a book or in Review counts toward the day's goal (core/readingClock.ts); reaching it says so once.
  let stopClock: (() => void) | null = null;
  // The day's goal reached: Pengu pops up from the bottom of the screen to say so (ui/pengu.ts).
  const onGoal = (days: number, goal: number) => penguSays(goalMessage(days, goal), 6500);
  const clockFor = (route: string) => {
    stopClock?.();
    stopClock = route === 'read' || route === 'review' ? startReadingClock(L.id, onGoal) : null;
  };

  let cleanup: (() => void) | void;
  let navSeq = 0;
  /** The screen on show, so a change knows where it comes from. */
  let shownRoute: string | null = null;
  /** `fade`: the new screen fades in by itself (a browser without the View Transitions API). */
  const render = async (fade = false) => {
    const seq = ++navSeq;
    const { route, params } = parseHash();
    // The old screen goes first, under its own route: the reader saves its place while body[data-route=read] still hides
    // the nav. With the nav back in the flow the text sits lower, and the place it measured was a line early on every visit.
    try { cleanup?.(); } catch (e) { console.error(e); }
    cleanup = undefined;
    document.body.dataset.route = route || 'library';
    shownRoute = route;
    // After the old screen's cleanup, which puts back the title the reader replaced.
    document.title = TITLES[route] ? tt('{screen} - LinguPengu', { screen: tt(TITLES[route]) }) : 'LinguPengu';
    clockFor(route);
    for (const a of nav.querySelectorAll<HTMLAnchorElement>('.app-navlink')) {
      a.toggleAttribute('aria-current', a.dataset.route === route);
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    }
    placeNavLine(moved);
    clear(screen);
    screen.appendChild(h('div.app-loading', null, h('div.app-spinner'), tt('Loading…')));
    let mod: { mount: MountFn };
    try {
      mod = await ROUTES[route]();
    } catch (e) {
      // Offline with a screen that was never downloaded, or a deploy that replaced the file: say so, and offer a retry.
      console.error(e);
      if (seq !== navSeq) return;
      clear(screen);
      screen.appendChild(h('div.app-loading.app-load-failed', { role: 'alert' },
        h('span', null, navigator.onLine === false ? tt('You are offline, and this screen has not been downloaded yet.') : tt('This screen could not be loaded.')),
        h('button.btn', { type: 'button', onclick: () => void render() }, icon('refresh'), tt('Try again'))));
      return;
    }
    if (seq !== navSeq) return;
    clear(screen);
    window.scrollTo(0, 0);
    // Opacity only: a transform on the screen would move the fixed elements inside it (menus, the drop overlay) while it plays.
    if (fade && typeof screen.animate === 'function') screen.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    const done = await mod.mount(screen, params, ctx);
    // The route moved on while this screen was mounting: put it away now, and keep the newer screen's cleanup for its turn.
    if (seq !== navSeq) { try { done?.(); } catch { /* ignore */ } return; }
    cleanup = done;
    // A screen reader hears nothing when the hash changes: the new screen's heading takes the focus, unless the screen put it
    // somewhere itself. The reader keeps its own.
    if (moved && route !== 'read' && !screen.contains(document.activeElement)) {
      const heading = screen.querySelector<HTMLElement>('h1');
      if (heading) {
        // Never in the Tab order, and drawn without a focus ring, as the welcome's title is (welcome.css): it is not a control.
        if (!heading.hasAttribute('tabindex')) { heading.tabIndex = -1; heading.style.outline = 'none'; }
        heading.focus({ preventScroll: true });
      }
    }
  };
  let moved = false;
  /**
   * A change of screen fades the new one in (render(true): an opacity fade of #screen) while the bar stays and its underline
   * slides. Not a View Transition: while one plays, the browser sends every tap to the page itself, so a second tab or a quick
   * Show answer did nothing for about 300 ms. Never into or out of the reader, which is full screen with its own bar and measures
   * its place as it goes; never for the same screen drawn again, nor under reduced motion.
   */
  /**
   * A Google answer that reached this page without a new load: taken out before the router reads it, as at the very start.
   * On an iPhone's Home Screen app Google's answer may come back as a change of the open page's fragment (the app's window
   * goes from '#/settings' to '#id_token=…'); and a fragment pasted into an open tab is the same. Asked before each screen
   * is drawn, the first one included: an answer that arrived while the app was starting, before it listened for changes,
   * would otherwise stay in the address bar and open the library.
   */
  const takeLate = () => {
    const late = takeGoogleReturn();
    if (late) void finishGoogleReturn(late, (message, ms) => ctx.toast(message, { ms }));
  };
  const change = () => {
    takeLate();
    moved = true;
    const from = shownRoute;
    const to = parseHash().route;
    if (from === null || from === to || from === 'read' || to === 'read' || still()) { void render(); return; }
    void render(true);
  };
  window.addEventListener('hashchange', change);
  takeLate();
  await render();

  // The dictionary has the connection first. After it, the reading fonts' rules (500 KB, only for libraries that show Chinese
  // or Japanese) and, on a first visit, the offline copy, which installs once the dictionary's files are handed over so it
  // reuses those downloads instead of fetching every file again alongside them.
  const dictSettled = ctx.dict().then(() => {}, () => {});
  if (CJK_LIBRARIES.has(L.id)) {
    // The fonts' stylesheet is not precached for every device (vite.config.ts onlyFontFaces): a first visit hands it over.
    const sheets = () => new Set([...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => l.href));
    const fonts = dictSettled.then(async () => {
      const before = sheets();
      await import('./fonts');
      for (const url of sheets()) if (!before.has(url)) handoff.keepUrl(url);
    });
    void handoff.track(fonts).catch(() => {});
  }
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const first = navigator.serviceWorker.controller ? Promise.resolve() : dictSettled.then(() => handoff.settled());
    void first.then(() => watchServiceWorker(ctx));
  }
}

void boot();
