// The walkthrough: steps that each light up one part of the screen and say what it does. The library's (siteGuide.ts) runs once
// after the welcome; the reader's (reader/reader.ts) the first time a book is opened on the device, and from the Aa menu. Settings
// shows both again. The rest of the screen is dimmed and takes no taps while a step shows, so a stray tap never opens something
// behind it. Esc ends it; the arrow keys and Enter move through it. Styled in guide.css (.rd-guide).
import '../styles/guide.css';
import { h } from './dom';
import { num, tt } from '../i18n';

/** The library's walkthrough: 'due' once the welcome is finished (or Settings asks for it), 'done' after. */
export const SITE_GUIDE_KEY = 'dushu.site-guide.v1';
/** The reader's: '1' once it was seen through or skipped (the key of the one-line hint it replaced). */
export const READER_GUIDE_KEY = 'dushu.reader-hint.v1';
/** Sent when the library's walkthrough becomes due while the library is already open. */
export const GUIDE_EVENT = 'dushu:guide';

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null): void => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* this visit only */ } };
export const siteGuideDue = (): boolean => read(SITE_GUIDE_KEY) === 'due';
export const markSiteGuide = (state: 'due' | 'done'): void => { write(SITE_GUIDE_KEY, state); if (state === 'due') window.dispatchEvent(new Event(GUIDE_EVENT)); };
export const readerGuideSeen = (): boolean => read(READER_GUIDE_KEY) === '1';
export const markReaderGuide = (seen: boolean): void => write(READER_GUIDE_KEY, seen ? '1' : null);

export interface GuideStep {
  /** What the step points at, looked up when it shows (null, hidden or off screen: the card sits in the middle). */
  target?: () => Element | null;
  title: string;
  /** Text and inline elements (the seal as the bar draws it). */
  body: (string | Node)[];
}

/** Room left around what a step points at, and between it and the card. */
const PAD = 6;
const GAP = 12;
/** The screen edge the card keeps clear of. */
const GUTTER = 16;

const visible = (el: Element | null | undefined): el is Element => {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
  return (el as HTMLElement).closest?.('[hidden]') === null;
};

/**
 * Shows `steps` one at a time over `root`. Resolves once it ends: `true` when the reader went through to the end or chose Skip,
 * `false` when it was taken down from outside (leaving the book), so a guide cut short shows again next time.
 */
export function showGuide(root: HTMLElement, steps: GuideStep[], opts: { last?: string } = {}): { done: Promise<boolean>; stop: () => void } {
  let at = 0;
  let finish: (seen: boolean) => void = () => {};
  const done = new Promise<boolean>((resolve) => { finish = resolve; });
  const spot = h('div.rd-guide-spot', { 'aria-hidden': 'true' });
  const count = h('p.rd-guide-count');
  const title = h('h2.rd-guide-title', { tabindex: -1 });
  const body = h('p.rd-guide-body');
  const back = h('button.btn.btn-sm', { type: 'button', onclick: () => go(at - 1) }, tt('Back')) as HTMLButtonElement;
  const next = h('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => go(at + 1) }) as HTMLButtonElement;
  const skip = h('button.btn.btn-sm.btn-ghost.rd-guide-skip', { type: 'button', onclick: () => end(true) }, tt('Skip')) as HTMLButtonElement;
  const card = h('section.rd-guide-card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': tt('Walkthrough') },
    count, title, body, h('div.rd-guide-foot', null, skip, h('span.rd-guide-gap'), back, next));
  const shade = h('div.rd-guide-shade');
  const el = h('div.rd-guide', { 'data-rd-ui': '' }, shade, spot, card);
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const place = () => {
    const step = steps[at];
    const t = step.target?.();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = Math.min(360, vw - GUTTER * 2);
    card.style.width = `${cw}px`;
    const ch = card.getBoundingClientRect().height;
    if (!visible(t)) {
      spot.hidden = true;
      shade.hidden = false;
      card.style.left = `${Math.round((vw - cw) / 2)}px`;
      card.style.top = `${Math.round(Math.max(GUTTER, (vh - ch) / 2))}px`;
      return;
    }
    const r = t.getBoundingClientRect();
    spot.hidden = false;
    shade.hidden = true;
    const box = { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    Object.assign(spot.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    // Below what it points at when it fits, else above, else wherever there is the most room.
    const below = box.top + box.height + GAP;
    const above = box.top - GAP - ch;
    const top = below + ch <= vh - GUTTER ? below : above >= GUTTER ? above : Math.max(GUTTER, Math.min(vh - ch - GUTTER, below));
    const left = Math.min(vw - GUTTER - cw, Math.max(GUTTER, r.left + r.width / 2 - cw / 2));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  };

  const go = (i: number) => {
    if (i < 0) return;
    if (i >= steps.length) { end(true); return; }
    at = i;
    const step = steps[i];
    const last = i === steps.length - 1;
    count.textContent = tt('Step {step} of {total}', { step: num(i + 1), total: num(steps.length) });
    title.textContent = step.title;
    body.replaceChildren(...step.body);
    back.hidden = i === 0;
    skip.hidden = last;
    next.textContent = last ? opts.last ?? tt('Done') : tt('Next');
    place();
    next.focus({ preventScroll: true });
  };

  // The reader's own keys (arrows turn pages, Esc closes things, Enter picks words) wait while the guide shows.
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    const onButton = e.target instanceof HTMLButtonElement && card.contains(e.target);
    if (e.key === 'Escape') end(true);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Enter' && !onButton)) go(at + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Tab') {
      // Focus stays in the card.
      const stops = [...card.querySelectorAll<HTMLButtonElement>('button')].filter((b) => !b.hidden);
      const k = stops.indexOf(document.activeElement as HTMLButtonElement);
      const to = e.shiftKey ? (k <= 0 ? stops.length - 1 : k - 1) : (k + 1) % stops.length;
      stops[to]?.focus();
    } else return; // Enter or Space on a button: the button's own click
    e.preventDefault();
  };
  const onResize = () => place();
  // Taps, swipes and scrolls outside the card do nothing (caught on the window, before the reader's own listeners see them).
  const swallow = (e: Event) => { if (!card.contains(e.target as Node)) { if (e.cancelable) e.preventDefault(); e.stopPropagation(); } };
  const SWALLOW = ['pointerdown', 'pointerup', 'click', 'touchstart', 'touchmove', 'wheel'] as const;

  let ended = false;
  const takeDown = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    for (const type of SWALLOW) window.removeEventListener(type, swallow, true);
    el.remove();
  };
  const end = (seen: boolean) => {
    if (ended) return;
    ended = true;
    takeDown();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    finish(seen);
  };

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  for (const type of SWALLOW) window.addEventListener(type, swallow, { capture: true, passive: false });
  root.appendChild(el);
  go(0);
  return { done, stop: () => end(false) };
}
