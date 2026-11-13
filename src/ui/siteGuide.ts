// The library's walkthrough (guide.ts), once after the welcome and again from Settings: the first book, the ways to add one, then
// the top bar (Vocabulary, Review, Settings, the language switch, Sign in). The reader has its own, the first time a book opens.
import { showGuide, markSiteGuide, siteGuideDue, type GuideStep } from './guide';
import { tt } from '../i18n';
import type { AppContext } from '../types';

/**
 * On a first visit the dictionary is still being read when the library shows, and its parse takes the page in long slices for
 * a few seconds: the walkthrough waits for it, so its first steps glide on a free page. It waits this long at most, then starts
 * anyway (a slow connection, a dictionary that never comes).
 */
export const DICT_WAIT_MS = 8000;
/** After the dictionary, the page's next quiet moment (the work that follows it goes first), at most this long. */
export const IDLE_WAIT_MS = 1000;

/** Resolves once `first` settles (or DICT_WAIT_MS pass) and then the page is idle (or IDLE_WAIT_MS pass). Never rejects. */
function afterQuiet(first: Promise<unknown>): Promise<void> {
  const settled = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, DICT_WAIT_MS);
    void first.then(() => {}, () => {}).then(() => { clearTimeout(timer); resolve(); });
  });
  return settled.then(() => new Promise<void>((resolve) => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    // Browsers without idle callbacks (Safari) give the work that follows the dictionary a moment.
    if (typeof idle === 'function') idle(() => resolve(), { timeout: IDLE_WAIT_MS });
    else setTimeout(resolve, 300);
  }));
}

/** Shown while the library is on screen and nothing else is open over it (the welcome, a dialog). */
const busy = (): boolean => document.body.classList.contains('wel-open') || !!document.querySelector('dialog[open], .rd-guide');

const q = (sel: string) => (): Element | null => document.querySelector(sel);
/** A link in the top bar, by its route ('' is the library). */
const nav = (route: string) => q(`.app-nav .app-navlink[data-route="${route}"]`);

/**
 * Starts the walkthrough over the library when it is due, once nothing else is open over it and the dictionary is read (on a
 * first visit it is not yet: see DICT_WAIT_MS). Returns what takes it down when the library goes (a walkthrough cut short that
 * way stays due). The library never waits on it.
 */
export function maybeSiteGuide(ctx?: Pick<AppContext, 'dict' | 'dictSync'>): () => void {
  let stop: (() => void) | null = null;
  let timer = 0;
  let gone = false;
  const tryNow = () => {
    if (gone || stop || !siteGuideDue()) return;
    if (busy()) { timer = window.setTimeout(tryNow, 800); return; }
    stop = start();
  };
  // Asked only when the walkthrough is due, so a library drawn while offline does not ask for the dictionary again for it.
  if (ctx && siteGuideDue() && !ctx.dictSync()) void afterQuiet(ctx.dict()).then(tryNow);
  else tryNow();
  return () => { gone = true; window.clearTimeout(timer); stop?.(); };
}

function start(): () => void {
  const there = (sel: string) => { const el = document.querySelector<HTMLElement>(sel); return !!el && !el.hidden && el.getBoundingClientRect().width > 0; };
  // Three steps at most: where books come from, where words go, and signing in. The buttons and tabs say the rest themselves.
  const steps: GuideStep[] = [
    // The first book's Start reading, the book to continue, or else the page's title: the first of them there is.
    { target: () => document.querySelector('.lib-start-go') ?? document.querySelector('.lib-continue') ?? document.querySelector('.page-head .page-title'),
      title: tt('Hi, I’m Pengu!'),
      body: [tt('Your books live here. Start with a free classic, or add your own: find a book, paste some text or import a file.')] },
    { target: nav('review'), title: tt('Your words'), body: [tt('Words you save are listed in Vocabulary, and Review brings them back as flashcards, a few minutes a day.')] },
  ];
  if (there('.app-signin:not(.app-signin-on)')) steps.push({ target: q('.app-signin'), title: tt('Sign in'), body: [tt('Sign in to keep your books and words on all your devices.')] });
  const guide = showGuide(document.body, steps);
  void guide.done.then((seen) => { if (seen) markSiteGuide('done'); });
  return guide.stop;
}
