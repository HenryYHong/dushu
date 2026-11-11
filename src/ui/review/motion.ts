// Review's motion, kept small and short, and only where it says something: the answer unfolding, a graded card leaving to
// the side it was graded (right remembered, left forgotten) while the next word settles in, the swipe that grades, and the
// summary's numbers counting up. Transforms and opacity only. Nothing moves for a reader who asks for reduced motion, and
// nothing happens where the browser cannot animate (tests): the screen never waits on an animation to do its work.

/** The app's --ease: a gentle start and a soft landing. */
export const EASE = 'cubic-bezier(0.22, 0.8, 0.24, 1)';
/** The app's --ease-out, for things arriving. */
export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** For things leaving: they gather speed as they go. */
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True when `el` can be animated here: the browser has the Web Animations API and the reader has not asked for less motion. */
export function canMove(el: Element | null | undefined): el is HTMLElement {
  return !!el && typeof (el as HTMLElement).animate === 'function' && !reduced();
}

/** Plays `frames` on `el` when it can move, else does nothing (and returns null). */
export function play(el: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  return canMove(el) ? el.animate(frames, opts) : null;
}

/**
 * Shows `to` in `el` counting up from 0 (an ease-out, so it slows into the real number). Where nothing can move, the number
 * is simply there. The count is drawn on the screen only: `el` should be hidden from screen readers, which read the number
 * from a copy beside it, so they never hear the numbers on the way.
 */
export function countUp(el: HTMLElement, to: number, format: (n: number) => string, ms = 600, delay = 0): void {
  el.textContent = format(to);
  if (!to || !canMove(el) || typeof requestAnimationFrame !== 'function') return;
  el.textContent = format(0);
  let t0 = -1;
  const step = (t: number): void => {
    if (!el.isConnected) return;
    if (t0 < 0) t0 = t + delay;
    const p = Math.min(1, Math.max(0, (t - t0) / ms));
    el.textContent = format(p >= 1 ? to : to * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
