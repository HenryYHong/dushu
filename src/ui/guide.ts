// The walkthrough: steps that each light up one part of the screen and say what it does. The library's (siteGuide.ts) runs once
// after the welcome; the reader's (reader/reader.ts) the first time a book is opened on the device, and from the Aa menu. Settings
// shows both again. The rest of the screen is dimmed and takes no taps while a step shows, so a stray tap never opens something
// behind it. Esc ends it; the arrow keys and Enter move through it. Styled in guide.css (.rd-guide).
import '../styles/guide.css';
import { h } from './dom';
import { num, tt } from '../i18n';
import { animatePengu, penguHtml, type PenguPose } from './pengu';
import { EASE, canMove } from './review/motion';

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
  /** How Pengu stands beside it: waving on the first step and cheering on the last unless a step says otherwise. */
  pose?: PenguPose;
}

/** Room left around what a step points at, and between it and the card. */
const PAD = 6;
const GAP = 12;
/** The screen edge the card keeps clear of. */
const GUTTER = 16;
/** How long the card takes to glide to the next step: the lit box's glide too, so the two move as one. */
const GLIDE_MS = 260;
/** How long the next step's words take to fade in. */
const FADE_MS = 200;
/** The ring's width outside the lit box, and where its edges start from each corner (guide.css). */
const RING = 2;
const EDGE_IN = 9;

interface Box { left: number; top: number; width: number; height: number }

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
  // The lit box and its parts (guide.css): the dim's corners and the ring's arcs (top left, top right, bottom left, bottom right),
  // and the ring's edges.
  const corners = () => ['tl', 'tr', 'bl', 'br'].map((c) => h(`i.rd-guide-${c}`));
  const dim = corners();
  const arcs = corners();
  const [edgeT, edgeB, edgeL, edgeR] = ['t', 'b', 'l', 'r'].map((e) => h(`b.rd-guide-${e}`));
  const spot = h('div.rd-guide-spot', { 'aria-hidden': 'true' },
    h('div.rd-guide-dim', null, ...dim), h('div.rd-guide-ring', null, ...arcs, edgeT, edgeB, edgeL, edgeR));
  /** The lit box place() set for this step (null: none, the card in the middle). */
  let lit: Box | null = null;
  const count = h('p.rd-guide-count');
  const title = h('h2.rd-guide-title', { tabindex: -1 });
  const body = h('p.rd-guide-body');
  const back = h('button.btn.btn-sm', { type: 'button', onclick: () => go(at - 1) }, tt('Back')) as HTMLButtonElement;
  const next = h('button.btn.btn-sm.btn-primary', { type: 'button', onclick: () => go(at + 1) }) as HTMLButtonElement;
  const skip = h('button.btn.btn-sm.btn-ghost.rd-guide-skip', { type: 'button', onclick: () => end(true) }, tt('Skip')) as HTMLButtonElement;
  // Pengu, beside the step's title (ui/pengu.ts).
  const pengu = h('span.rd-guide-pengu.pengu-span.pengu-tappable', { 'aria-hidden': 'true', onclick: () => animatePengu(pengu, 'boing') });
  const card = h('section.rd-guide-card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': tt('Walkthrough') },
    h('div.rd-guide-head', null, pengu, h('div', null, count, title)), body, h('div.rd-guide-foot', null, skip, h('span.rd-guide-gap'), back, next));
  const shade = h('div.rd-guide-shade');
  const el = h('div.rd-guide', { 'data-rd-ui': '' }, shade, spot, card);
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // The card's glide and its words' fade, while they play.
  let moves: Animation[] = [];
  const settle = () => { for (const a of moves) a.cancel(); moves = []; card.style.overflow = ''; };

  /** Where the lit box is on the screen now (on its way, if it is gliding): inside the ring's top-left and bottom-right arcs. */
  const litNow = (): Box => {
    const a = arcs[0].getBoundingClientRect();
    const b = arcs[3].getBoundingClientRect();
    return { left: a.left + RING, top: a.top + RING, width: b.right - a.left - RING * 2, height: b.bottom - a.top - RING * 2 };
  };

  /**
   * Moves the lit box from `from` to the box place() just set, with the card: the box slides from the old corner, the parts that
   * CSS puts on its right and bottom start where the old size had them, and the ring's edges start at the old length. Transforms
   * only, stretching nothing but the edges along their length, so the ring keeps its 2px and its round corners all the way.
   */
  const glideSpot = (from: Box, to: Box, opts: KeyframeAnimationOptions) => {
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const dw = from.width - to.width;
    const dh = from.height - to.height;
    const along = (was: number, now: number) => (now > EDGE_IN * 2 ? Math.max(0, was - EDGE_IN * 2) / (now - EDGE_IN * 2) : 1);
    const sx = along(from.width, to.width);
    const sy = along(from.height, to.height);
    const parts: [Element, number, number, number, number][] = [
      [spot, dx, dy, 1, 1],
      [dim[1], dw, 0, 1, 1], [arcs[1], dw, 0, 1, 1],
      [dim[2], 0, dh, 1, 1], [arcs[2], 0, dh, 1, 1],
      [dim[3], dw, dh, 1, 1], [arcs[3], dw, dh, 1, 1],
      [edgeT, 0, 0, sx, 1], [edgeB, 0, dh, sx, 1], [edgeL, 0, 0, 1, sy], [edgeR, dw, 0, 1, sy],
    ];
    for (const [el, x, y, kx, ky] of parts) {
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(kx - 1) < 1e-3 && Math.abs(ky - 1) < 1e-3) continue;
      moves.push(el.animate([{ transform: `translate(${x}px, ${y}px) scale(${kx}, ${ky})` }, { transform: 'none' }], opts));
    }
  };

  /**
   * Moves the card from where it was (`from`, its box before the step changed) to where the new step put it, and fades the new
   * words in, so the eye follows it to the next thing it points at; the lit box glides with it from `fromLit`, when both steps
   * light something. The words of the step before go at once: two steps of text are never seen through each other. Transforms
   * and opacity, plus the card's height when the new step is taller or shorter (one small box). Nothing waits on it: the buttons
   * work as it goes.
   */
  const glide = (from: DOMRect | null, fromLit: Box | null) => {
    if (!from) return;
    const to = card.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const opts = { duration: GLIDE_MS, easing: EASE };
    if (fromLit && lit) glideSpot(fromLit, lit, opts);
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) moves.push(card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], opts));
    if (Math.abs(from.height - to.height) >= 1) {
      // The new words are already laid out: a card on its way to a shorter size clips them rather than spilling them.
      card.style.overflow = 'hidden';
      const grow = card.animate([{ height: `${from.height}px` }, { height: `${to.height}px` }], opts);
      grow.onfinish = () => { card.style.overflow = ''; };
      moves.push(grow);
    }
    for (const part of [count, title, body]) moves.push(part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: 'ease-out' }));
  };

  const place = () => {
    const step = steps[at];
    const t = step.target?.();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = Math.min(360, vw - GUTTER * 2);
    card.style.width = `${cw}px`;
    const ch = card.getBoundingClientRect().height;
    if (!visible(t)) {
      lit = null;
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
    lit = box;
    Object.assign(spot.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    // Below what it points at when it fits, else above, else wherever there is the most room.
    const below = box.top + box.height + GAP;
    const above = box.top - GAP - ch;
    const top = below + ch <= vh - GUTTER ? below : above >= GUTTER ? above : Math.max(GUTTER, Math.min(vh - ch - GUTTER, below));
    const left = Math.min(vw - GUTTER - cw, Math.max(GUTTER, r.left + r.width / 2 - cw / 2));
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  };

  let shown = false;
  const go = (i: number) => {
    if (i < 0) return;
    if (i >= steps.length) { end(true); return; }
    // Where the card is now (on its way, if a step was skipped through quickly), for the glide. The first step just appears.
    const from = shown && canMove(card) ? card.getBoundingClientRect() : null;
    const fromLit = from && !spot.hidden ? litNow() : null;
    settle();
    at = i;
    const step = steps[i];
    const last = i === steps.length - 1;
    count.textContent = tt('Step {step} of {total}', { step: num(i + 1), total: num(steps.length) });
    const pose = step.pose ?? (i === 0 ? 'wave' : last ? 'cheer' : 'stand');
    if (pengu.dataset.pose !== pose) { pengu.dataset.pose = pose; pengu.innerHTML = penguHtml(pose); }
    // Pengu arrives with the first step, hops along with each next one, and cheers at the last.
    // Pengu arrives with the first step and cheers at the last; in between it keeps still while the card glides, so the eye
    // follows the card.
    if (i === 0 && !pengu.dataset.seen) animatePengu(pengu, 'pop');
    else if (last) animatePengu(pengu, 'cheer');
    pengu.dataset.seen = '1';
    title.textContent = step.title;
    body.replaceChildren(...step.body);
    back.hidden = i === 0;
    skip.hidden = last;
    next.textContent = last ? opts.last ?? tt('Done') : tt('Next');
    place();
    glide(from, fromLit);
    shown = true;
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
  // A new size of window puts the card in its place at once (place measures it, so a glide in the middle gives way first).
  const onResize = () => { settle(); place(); };
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
