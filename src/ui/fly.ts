// A small mark flying from one place on screen to another, to say where something went: a word's star, when the word is saved,
// goes to Vocabulary in the top bar. About 450 ms along a gentle curve, fading as it lands, and the place it lands on gives one
// small nudge. Transforms and opacity only. Nothing happens for a reader who asks for reduced motion, where the browser cannot
// animate (tests), or when either end is not on screen (the reader hides the top bar), since a star flying off the edge says
// nothing.
import { icon } from './icons';

/** The top bar's Vocabulary link (main.ts), where saved words wait. */
export const VOCAB_LINK = 'a.app-navlink[data-route="vocab"]';

const FLY_MS = 450;
const NUDGE_MS = 260;

const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The element's box when it is drawn and at least partly inside the window, else null (display: none, hidden, scrolled off). */
export function onScreen(el: Element | null | undefined): DOMRect | null {
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return null;
  const seen = (el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean }).checkVisibility;
  if (typeof seen === 'function' && !seen.call(el, { visibilityProperty: true, opacityProperty: true })) return null;
  return r;
}

interface Point { x: number; y: number }

/**
 * `steps + 1` points on a quadratic curve from `a` to `b`, bowed to one side by a tenth of the distance (at most 55 px): the
 * side that rises, so a star tossed up to the bar arcs over rather than sagging; a straight climb bows toward the middle of the
 * screen. The bow stays inside the window (`view`, with a margin): along a bar at the top of the screen it dips instead, and
 * with no room either way the path is straight.
 */
export function arc(a: Point, b: Point, steps = 10, view: { width: number; height: number; margin?: number } = { width: Infinity, height: Infinity }): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [a, b];
  let nx = dy / len;
  let ny = -dx / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const middle = Number.isFinite(view.width) ? view.width / 2 : mx;
  if (Math.abs(ny) < 0.15) { if ((middle - mx) * nx < 0) { nx = -nx; ny = -ny; } } else if (ny > 0) { nx = -nx; ny = -ny; }
  const bow = Math.min(110, len * 0.2);
  const m = view.margin ?? 12;
  const inside = (p: Point) => p.x >= m && p.y >= m && p.x <= view.width - m && p.y <= view.height - m;
  const along = (side: number): Point[] => {
    const c = { x: mx + side * nx * bow, y: my + side * ny * bow };
    const out: Point[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
    }
    return out;
  };
  // The ends themselves are on screen (flyTo checks), so only the bow can leave it.
  for (const side of [1, -1]) {
    const pts = along(side);
    if (pts.slice(1, -1).every(inside)) return pts;
  }
  return along(0);
}

/** One small nudge of `el` (a nav link a star landed on): up a hair and a touch bigger, then back. */
export function nudge(el: Element | null | undefined): void {
  if (!el || reduced() || typeof (el as HTMLElement).animate !== 'function') return;
  (el as HTMLElement).animate([
    { transform: 'none' },
    { transform: 'translateY(-2px) scale(1.06)', offset: 0.4 },
    { transform: 'none' },
  ], { duration: NUDGE_MS, easing: 'cubic-bezier(.22,.8,.24,1)' });
}

/**
 * A filled star (or `glyph`) from `from` to `to`, then a nudge of `to`. Returns whether it flew: false when motion is off, the
 * browser cannot animate, or either end is hidden or off screen. It takes no taps and is gone when it lands.
 */
export function flyTo(from: Element | null | undefined, to: Element | null | undefined, glyph?: Element): boolean {
  if (reduced()) return false;
  const a = onScreen(from);
  const b = onScreen(to);
  if (!a || !b) return false;
  const mark = document.createElement('span');
  if (typeof mark.animate !== 'function') return false;
  // The same size as the star on the button, so it seems to lift off it.
  const own = from!.querySelector('svg')?.getBoundingClientRect();
  const size = Math.round(own && own.width >= 8 ? own.width : 18);
  mark.setAttribute('aria-hidden', 'true');
  mark.style.cssText = `position:fixed;left:0;top:0;z-index:90;width:${size}px;height:${size}px;pointer-events:none;color:var(--accent);will-change:transform,opacity`;
  const g = glyph ?? icon('starFill');
  if (g instanceof SVGElement) g.setAttribute('style', 'width:100%;height:100%;display:block');
  mark.append(g);
  const center = (r: DOMRect): Point => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const pts = arc(center(a), center(b), 10, { width: window.innerWidth, height: window.innerHeight, margin: size / 2 + 4 });
  const last = pts.length - 1;
  const frames: Keyframe[] = pts.map((p, i) => {
    const t = i / last;
    return {
      transform: `translate(${(p.x - size / 2).toFixed(1)}px, ${(p.y - size / 2).toFixed(1)}px) scale(${(1 - 0.4 * t).toFixed(3)})`,
      // Full for most of the way, then fading out as it reaches the link.
      opacity: t <= 0.72 ? 1 : Number(((1 - t) / 0.28).toFixed(3)),
      offset: t,
    };
  });
  document.body.append(mark);
  const anim = mark.animate(frames, { duration: FLY_MS, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'forwards' });
  const done = () => mark.remove();
  anim.finished.then(() => { done(); nudge(to); }, done);
  // Gone in any case, even if the animation never reports back (a tab put in the background).
  window.setTimeout(done, FLY_MS + 400);
  return true;
}

/** A saved word's star from the card's Save button to Vocabulary in the top bar, when the bar is on screen. */
export function flyToVocab(from: Element | null | undefined): boolean {
  const link = typeof document === 'undefined' ? null : document.querySelector(VOCAB_LINK);
  // Already on Vocabulary: the word is in the list on screen, so nothing flies to the tab.
  if (link?.getAttribute('aria-current') === 'page') return false;
  return flyTo(from, link);
}
