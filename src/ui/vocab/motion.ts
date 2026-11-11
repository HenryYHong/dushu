// The motion of saved words, small and short and only where it says something: a star or check that turns on gives one small
// pop (turning off, it is simply off), and a word that leaves a list folds away while the rows after it close the gap, as a
// word that comes back eases in and the rows make room. A search, a sort or a new setting redraws at once, and so does a
// change of many rows. Transforms and opacity only, through review/motion.ts: nothing moves for a reader who asks for reduced
// motion, and nothing happens where the browser cannot animate (tests). The list is drawn either way (in full, or a few words
// patched in place by patch.ts); the motion only shows the way there, so nothing waits on it.
import { EASE, EASE_OUT, canMove, play } from '../review/motion';

/** A button's icon that has just turned on: a little bigger, then back, in 200 ms. */
export function popIcon(btn: Element | null | undefined): void {
  const target = btn?.querySelector('svg') ?? btn;
  play(target, [{ transform: 'none' }, { transform: 'scale(1.15)', offset: 0.4 }, { transform: 'none' }], { duration: 200, easing: EASE });
}

/**
 * Each keyed element of a list ([data-flip]), and where those on or near the screen were. Rows farther off are never seen
 * moving (a row slides by a couple of rows at most), and measuring 800 of them took a phone longer than the change itself.
 */
interface Boxes { els: Map<string, HTMLElement>; at: Map<string, DOMRect> }

const GHOST = 'voc-ghost';
/** More rows than this coming or going at once (a restore, a sync) is a new list, not a change to read: it is just drawn. */
const MOST_CHANGES = 8;
/** And more rows than this moving on screen is too much motion to follow. */
const MOST_MOVING = 40;
/** A leaving row fades fast, so it is nearly gone before the rows after it slide over its place. */
const LEAVE_MS = 140;
const MOVE_MS = 240;
const MOVE_DELAY = 70;
/** A row coming back waits until the rows after it have mostly made room, so the two are never drawn over each other. */
const ARRIVE_DELAY = 100;
const ARRIVE_MS = 220;

function measure(root: HTMLElement, vh: number): Boxes {
  const list = [...root.querySelectorAll<HTMLElement>('[data-flip]')];
  const keys = list.map((el) => el.getAttribute('data-flip')!);
  const els = new Map(list.map((el, i) => [keys[i], el]));
  const at = new Map<string, DOMRect>();
  // Two screens above and below it: farther than that, a row is out of sight before and after any slide (a row slides by
  // at most twice its height).
  const lo = -2 * vh;
  const hi = 3 * vh;
  // The rows are in reading order, so their tops never go up the screen: the first near it is found by halving.
  let a = 0;
  let b = list.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (list[m].getBoundingClientRect().top < lo) a = m + 1; else b = m;
  }
  // A row above that one may still reach down into the band (a tall row, or the other column).
  while (a > 0 && list[a - 1].getBoundingClientRect().bottom > lo) a--;
  for (let i = a; i < list.length; i++) {
    const box = list[i].getBoundingClientRect();
    if (box.top > hi) break;
    at.set(keys[i], box);
  }
  return { els, at };
}

/**
 * Draws `root` again with `draw`. With `animate` (a change to the words themselves, not a search or a sort), a row that left
 * fades where it was while the rows after it slide up into its place, and a row that came back eases in while the rows after
 * it slide down to make room. Rows slide only straight up or down, by no more than a couple of rows, and only on screen. When
 * rows would move from one column to the other (two columns on a wide screen), they are simply drawn in their new places, as
 * rows crossing the screen would be far more motion than one word is worth; a word that came back still eases in.
 */
export function redraw(root: HTMLElement, animate: boolean, draw: () => void): void {
  const vh = window.innerHeight || document.documentElement.clientHeight;
  // A list out of sight (its tab not shown) has nothing to show moving.
  const before = animate && canMove(root) && !root.closest('[hidden]') ? measure(root, vh) : null;
  // A row still fading from the last change stays to finish (drawing clears the list).
  const ghosts = before ? [...root.querySelectorAll<HTMLElement>(`:scope > .${GHOST}`)] : [];
  draw();
  if (!before) return;
  root.append(...ghosts);
  const after = measure(root, vh);
  const gone = [...before.els.keys()].filter((k) => !after.els.has(k));
  if (gone.length + [...after.els.keys()].filter((k) => !before.els.has(k)).length > MOST_CHANGES) return;

  const seen = (b: DOMRect) => b.bottom > -60 && b.top < vh + 60 && b.height > 0;
  let slides: [HTMLElement, number, number][] = [];
  const arriving: HTMLElement[] = [];
  let crossing = false;
  for (const [key, now] of after.at) {
    const el = after.els.get(key)!;
    if (!before.els.has(key)) { if (seen(now)) arriving.push(el); continue; }
    // A row that was far off the screen is simply in its new place.
    const old = before.at.get(key);
    if (!old) continue;
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if ((Math.abs(dx) < 1 && Math.abs(dy) < 1) || (!seen(old) && !seen(now))) continue;
    if (Math.abs(dx) >= 2) crossing = true;
    // A row sent far off (a new order) is simply in its new place.
    else if (Math.abs(dy) <= Math.max(240, 2 * now.height)) slides.push([el, dx, dy]);
  }
  let leaving = gone.flatMap((k) => {
    const box = before.at.get(k);
    return box && seen(box) ? [{ el: before.els.get(k)!, box }] : [];
  });
  if (crossing) { slides = []; leaving = []; }
  if (slides.length + arriving.length + leaving.length > MOST_MOVING) return;

  const at = root.getBoundingClientRect();
  for (const { el, box } of leaving) {
    // The old row, out of the list and out of reach, faded where it was.
    el.removeAttribute('data-flip');
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    el.setAttribute('aria-hidden', 'true');
    el.inert = true;
    el.classList.add(GHOST);
    Object.assign(el.style, {
      left: `${box.left - at.left - root.clientLeft}px`, top: `${box.top - at.top - root.clientTop}px`,
      width: `${box.width}px`, height: `${box.height}px`,
    });
    root.append(el);
    const anim = play(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.98)' }], { duration: LEAVE_MS, easing: EASE_OUT, fill: 'forwards' });
    const done = () => el.remove();
    if (anim) anim.finished.then(done, done); else done();
    // Gone in any case, even if the animation never reports back (a tab put in the background).
    window.setTimeout(done, LEAVE_MS + 400);
  }
  const delay = leaving.length ? MOVE_DELAY : 0;
  for (const [el, dx, dy] of slides) {
    play(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: MOVE_MS, easing: EASE, delay, fill: 'backwards' });
  }
  for (const el of arriving) {
    play(el, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: ARRIVE_MS, easing: EASE_OUT, delay: slides.length ? ARRIVE_DELAY : 0, fill: 'backwards' });
  }
}
