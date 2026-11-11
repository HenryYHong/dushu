// Swipe to grade, for a finger or a pen once the answer shows: the card follows sideways with a slight tilt, and a faint tint
// with a label says what letting go there means, right remembered (Got it, or Good with Anki's buttons) and left forgotten
// (Forgot, or Again). Let go past the line (or flick) and it grades; short of it the card eases back. A move that starts up
// or down is the page scrolling (the revealed card is touch-action: pan-y), a tap stays a tap, and a mouse never drags.
import { h } from '../dom';
import { EASE_OUT, canMove, play } from './motion';

export interface SwipeOpts {
  /** Whether the card can be swiped now: its answer shows and no grade is being saved. */
  ready(): boolean;
  /** What each side means, in the words of the buttons on screen. */
  labels(): { left: string; right: string };
  /** Let go past the line: grade toward `dir`, with the card at `x` px and tilted `deg`, where it leaves from. */
  done(dir: 1 | -1, x: number, deg: number): void;
}

/** A finger moves this far before it counts as a drag (sideways) or a scroll (up or down). */
export const SLOP = 10;

/** How far the card has to go to grade: about a third of its width, never under 60 px or over 120 px. */
export const swipeLine = (width: number): number => Math.min(120, Math.max(60, width * 0.3));

/**
 * What letting go means: 1 right, -1 left, 0 back to the middle. `vx` is the finger's speed in px/ms: a quick flick the
 * same way grades from 40 px, so a short confident swipe is not lost.
 */
export function swipeResult(dx: number, vx: number, width: number): -1 | 0 | 1 {
  const dir = dx > 0 ? 1 : -1;
  if (Math.abs(dx) >= swipeLine(width)) return dir;
  if (Math.abs(dx) >= 40 && vx * dir >= 0.5) return dir;
  return 0;
}

/** The card's tilt at `dx`: 3 degrees at most, like a card held at the bottom. None with reduced motion. */
export const swipeTilt = (dx: number, moving: boolean): number => (moving ? Math.max(-3, Math.min(3, dx * 0.02)) : 0);

export function attachSwipe(card: HTMLElement, opts: SwipeOpts): void {
  let start: { x: number; y: number; id: number } | null = null;
  let dragging = false;
  let dx = 0;
  let deg = 0;
  let trail: { x: number; t: number }[] = [];
  let tint: HTMLElement | null = null;
  // The click a browser may send after a drag ends on a button in the card (the audio button) is not a tap.
  let quietUntil = 0;
  // Asked once a drag starts, not on every move.
  let moving = false;

  const draw = () => {
    deg = swipeTilt(dx, moving);
    card.style.transform = `translateX(${dx}px)${deg ? ` rotate(${deg.toFixed(2)}deg)` : ''}`;
    if (!tint) return;
    const dir = dx >= 0 ? 'right' : 'left';
    if (tint.dataset.dir !== dir) {
      tint.dataset.dir = dir;
      tint.className = `rev-swipe rev-swipe-${dir}`;
      tint.firstChild!.textContent = opts.labels()[dir];
    }
    tint.style.opacity = String(Math.min(1, Math.abs(dx) / swipeLine(card.offsetWidth || 320)));
  };
  const settle = () => {
    card.classList.remove('rev-card-drag');
    const was = card.style.transform;
    card.style.transform = '';
    const t = tint;
    tint = null;
    if (!t) return;
    // Back to the middle: the card eases home and the tint fades with it.
    if (was && moving) {
      play(card, [{ transform: was }, { transform: 'none' }], { duration: 240, easing: EASE_OUT });
      const fade = play(t, [{ opacity: t.style.opacity || '0' }, { opacity: 0 }], { duration: 200, easing: EASE_OUT, fill: 'forwards' });
      if (fade) { void fade.finished.then(() => t.remove(), () => t.remove()); return; }
    }
    t.remove();
  };

  card.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.isPrimary || start || !opts.ready()) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging = false;
    dx = 0;
    trail = [{ x: e.clientX, t: e.timeStamp }];
  });
  card.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const mx = e.clientX - start.x;
    const my = e.clientY - start.y;
    if (!dragging) {
      // Up or down first: the page scrolls, and this touch is not a swipe.
      if (Math.abs(my) > SLOP && Math.abs(my) >= Math.abs(mx)) { start = null; return; }
      if (Math.abs(mx) <= SLOP) return;
      if (!opts.ready()) { start = null; return; }
      dragging = true;
      moving = canMove(card);
      try { card.setPointerCapture?.(e.pointerId); } catch { /* the pointer is gone already */ }
      card.classList.add('rev-card-drag');
      tint = h('div.rev-swipe', { 'aria-hidden': 'true' }, h('span.rev-swipe-label'));
      card.append(tint);
    }
    // From where the drag started, so the card does not jump by the slop.
    dx = mx - Math.sign(mx) * SLOP;
    trail.push({ x: e.clientX, t: e.timeStamp });
    while (trail.length > 2 && e.timeStamp - trail[0].t > 100) trail.shift();
    draw();
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    if (!start || e.pointerId !== start.id) return;
    start = null;
    if (!dragging) return;
    dragging = false;
    quietUntil = e.timeStamp + 400;
    const first = trail[0];
    const span = e.timeStamp - first.t;
    const vx = span > 0 ? (e.clientX - first.x) / span : 0;
    const dir = cancelled ? 0 : swipeResult(dx, vx, card.offsetWidth || 320);
    if (dir && opts.ready()) {
      // The leaving copy is made from the card as it is now (review.ts), then the card itself is put straight.
      opts.done(dir, dx, deg);
      card.classList.remove('rev-card-drag');
      card.style.transform = '';
      tint?.remove();
      tint = null;
      return;
    }
    settle();
  };
  card.addEventListener('pointerup', (e) => end(e, false));
  card.addEventListener('pointercancel', (e) => end(e, true));
  card.addEventListener('click', (e) => {
    if (e.timeStamp < quietUntil) { e.stopPropagation(); e.preventDefault(); }
  }, true);
}
