// @vitest-environment jsdom
// The star a saved word sends to Vocabulary (ui/fly.ts): a no-op wherever it cannot be seen or animated.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arc, flyTo, flyToVocab, onScreen } from '../../src/ui/fly';

const proto = HTMLElement.prototype as unknown as { animate?: unknown };

function box(x: number, y: number, w: number, h: number, tag = 'span'): HTMLElement {
  const el = document.createElement(tag);
  el.getBoundingClientRect = () => new DOMRect(x, y, w, h);
  document.body.append(el);
  return el;
}

/** Element.animate as a browser has it, finishing at once. */
function canAnimate() {
  const calls: Element[] = [];
  proto.animate = vi.fn(function (this: Element) {
    calls.push(this);
    return { finished: Promise.resolve(), cancel() {} };
  });
  return calls;
}

afterEach(() => {
  delete proto.animate;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('flyTo', () => {
  it('does nothing where the browser cannot animate (jsdom, old browsers)', () => {
    expect(typeof proto.animate).toBe('undefined');
    const from = box(200, 500, 32, 32, 'button');
    const to = box(150, 10, 80, 44, 'a');
    expect(flyTo(from, to)).toBe(false);
    expect(document.body.children.length).toBe(2);
  });

  it('flies a star from the button to the link, takes it away when it lands, and nudges the link', async () => {
    const calls = canAnimate();
    const from = box(200, 500, 32, 32, 'button');
    const to = box(150, 10, 80, 44, 'a');
    expect(flyTo(from, to)).toBe(true);
    const star = document.body.lastElementChild as HTMLElement;
    expect(star.getAttribute('aria-hidden')).toBe('true');
    expect(star.style.pointerEvents).toBe('none');
    expect(star.querySelector('svg')).not.toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(star.isConnected).toBe(false);
    expect(calls).toEqual([star, to]);
  });

  it('skips a target that is hidden or off screen, and an absent one', () => {
    canAnimate();
    const from = box(200, 500, 32, 32, 'button');
    expect(flyTo(from, box(0, 0, 0, 0, 'a'))).toBe(false);
    expect(flyTo(from, box(150, -60, 80, 44, 'a'))).toBe(false);
    expect(flyTo(from, box(150, 5000, 80, 44, 'a'))).toBe(false);
    expect(flyTo(from, null)).toBe(false);
    expect(flyTo(null, box(150, 10, 80, 44, 'a'))).toBe(false);
    // No top bar on the page (the reader hides it): nothing flies.
    expect(flyToVocab(from)).toBe(false);
    expect(document.body.querySelectorAll('svg').length).toBe(0);
  });

  it('stays still for a reader who asks for reduced motion', () => {
    const calls = canAnimate();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    expect(flyTo(box(200, 500, 32, 32), box(150, 10, 80, 44))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('finds the Vocabulary link in the top bar', () => {
    canAnimate();
    const link = box(150, 10, 80, 44, 'a');
    link.className = 'app-navlink';
    link.dataset.route = 'vocab';
    expect(flyToVocab(box(200, 500, 32, 32, 'button'))).toBe(true);
  });
});

describe('onScreen', () => {
  it('gives the box of a drawn element in the window, and null otherwise', () => {
    expect(onScreen(box(10, 10, 20, 20))?.width).toBe(20);
    expect(onScreen(box(10, 10, 0, 20))).toBeNull();
    expect(onScreen(document.createElement('div'))).toBeNull(); // not in the page
  });
});

describe('arc', () => {
  it('starts and ends on the two points', () => {
    const pts = arc({ x: 300, y: 600 }, { x: 120, y: 30 });
    expect(pts[0]).toEqual({ x: 300, y: 600 });
    expect(pts[pts.length - 1].x).toBeCloseTo(120);
    expect(pts[pts.length - 1].y).toBeCloseTo(30);
  });

  it('bows up and out, not down, and not far', () => {
    const a = { x: 300, y: 600 };
    const b = { x: 120, y: 30 };
    const mid = arc(a, b, 10, { width: 390, height: 844 })[5];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    // Off the straight line, to the side that rises (here up and to the right of it), by a little.
    const cross = ((b.x - a.x) * (mid.y - a.y) - (b.y - a.y) * (mid.x - a.x)) / len;
    expect(Math.abs(cross)).toBeGreaterThan(20);
    expect(Math.abs(cross)).toBeLessThanOrEqual(55);
    expect(mid.x).toBeGreaterThan((a.x + b.x) / 2);
  });

  it('bows a straight climb toward the middle of the screen', () => {
    const view = { width: 400, height: 844 };
    expect(arc({ x: 40, y: 600 }, { x: 40, y: 30 }, 10, view)[5].x).toBeGreaterThan(40);
    expect(arc({ x: 360, y: 600 }, { x: 360, y: 30 }, 10, view)[5].x).toBeLessThan(360);
  });

  it('stays inside the window: along the top bar it dips instead of leaving the screen', () => {
    const view = { width: 1280, height: 860, margin: 13 };
    // A card's star at the top left to the bar's Vocabulary link at the top right.
    const pts = arc({ x: 312, y: 38 }, { x: 823, y: 28 }, 10, view);
    expect(Math.min(...pts.map((p) => p.y))).toBeGreaterThanOrEqual(13);
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(38);
    // No room on either side: a straight line.
    const flat = arc({ x: 20, y: 15 }, { x: 60, y: 15 }, 10, { width: 80, height: 30, margin: 13 });
    expect(flat.every((p) => Math.abs(p.y - 15) < 1e-9)).toBe(true);
  });
});
