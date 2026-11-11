// @vitest-environment jsdom
// The motion of saved words (ui/vocab/motion.ts): a star or check that turns on pops, a word that leaves a list fades where it
// was while the rows after it slide up, one that comes back eases in. Rows never cross between columns, a big change is just
// drawn, and nothing moves where the browser cannot animate or the reader asks for reduced motion.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { popIcon, redraw } from '../../src/ui/vocab/motion';

interface Call { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions }
let calls: Call[] = [];
let finish: (() => void)[] = [];
const realAnimate = (Element.prototype as { animate?: unknown }).animate;
const realRect = Element.prototype.getBoundingClientRect;
const realMatch = window.matchMedia;

/** Lays the rows of `.list` out in `cols` columns of 500 x 100 px, from the top of the window. */
let cols = 1;
function layout(): void {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const list = this.closest('.list');
    const rows = list ? [...list.querySelectorAll(':scope > [data-flip]')] : [];
    const i = rows.indexOf(this);
    if (i < 0) return new DOMRect(0, 0, list === this ? 1000 : 0, 0);
    return new DOMRect((i % cols) * 500, Math.floor(i / cols) * 100, 480, 100);
  };
}

beforeEach(() => {
  calls = [];
  finish = [];
  cols = 1;
  (Element.prototype as { animate?: unknown }).animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, opts });
    return { finished: new Promise<void>((done) => finish.push(done)) };
  };
  layout();
});
afterEach(() => {
  (Element.prototype as { animate?: unknown }).animate = realAnimate;
  Element.prototype.getBoundingClientRect = realRect;
  window.matchMedia = realMatch;
  document.body.innerHTML = '';
});

function list(words: string[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'list';
  document.body.append(el);
  fill(el, words);
  return el;
}
function fill(el: HTMLElement, words: string[]): void {
  el.replaceChildren(...words.map((w) => {
    const row = document.createElement('div');
    row.dataset.flip = w;
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;
    row.textContent = w;
    return row;
  }));
}
const words = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-flip]')].map((r) => r.dataset.flip);
const moved = (frames: Keyframe[]) => String(frames[0].transform);

describe('a word that leaves a list', () => {
  it('fades where it was, out of reach, while the rows after it slide up into its place', async () => {
    const el = list(['a', 'b', 'c', 'd']);
    redraw(el, true, () => fill(el, ['a', 'c', 'd']));
    expect(words(el)).toEqual(['a', 'c', 'd']);
    const ghost = el.querySelector<HTMLElement>('.voc-ghost')!;
    expect(ghost.textContent).toBe('b');
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.inert).toBe(true);
    expect(ghost.hasAttribute('tabindex') || ghost.hasAttribute('role') || ghost.hasAttribute('data-flip')).toBe(false);
    expect(ghost.style.top).toBe('100px');
    expect(calls.find((c) => c.el === ghost)!.frames.at(-1)!.opacity).toBe(0);
    // c and d slide up one row; a stays.
    const slides = calls.filter((c) => c.el !== ghost);
    expect(slides.map((c) => (c.el as HTMLElement).dataset.flip)).toEqual(['c', 'd']);
    expect(slides.map((c) => moved(c.frames))).toEqual(['translate(0px, 100px)', 'translate(0px, 100px)']);
    // The rows wait for the fade to begin, and every motion is short.
    expect(slides.every((c) => Number(c.opts.delay) > 0)).toBe(true);
    expect(calls.every((c) => Number(c.opts.duration) <= 350)).toBe(true);
    finish.forEach((f) => f());
    await Promise.resolve();
    await Promise.resolve();
    expect(el.querySelector('.voc-ghost')).toBeNull();
  });

  it('comes back easing in, after the rows below have made room', () => {
    const el = list(['a', 'c', 'd']);
    redraw(el, true, () => fill(el, ['a', 'b', 'c', 'd']));
    const b = calls.find((c) => (c.el as HTMLElement).dataset.flip === 'b')!;
    expect(b.frames[0]).toMatchObject({ opacity: 0 });
    expect(Number(b.opts.delay)).toBeGreaterThan(0);
    expect(calls.filter((c) => c !== b).map((c) => moved(c.frames))).toEqual(['translate(0px, -100px)', 'translate(0px, -100px)']);
  });

  it('never sends rows across columns: in two columns the rest is simply drawn, and a word that came back still eases in', () => {
    cols = 2;
    const el = list(['a', 'b', 'c', 'd', 'e']);
    redraw(el, true, () => fill(el, ['a', 'c', 'd', 'e']));
    expect(calls).toHaveLength(0);
    expect(el.querySelector('.voc-ghost')).toBeNull();
    redraw(el, true, () => fill(el, ['a', 'b', 'c', 'd', 'e']));
    expect(calls.map((c) => (c.el as HTMLElement).dataset.flip)).toEqual(['b']);
  });

  it('just draws a search, a sort, or a change of many words at once', () => {
    const el = list(['a', 'b', 'c', 'd']);
    redraw(el, false, () => fill(el, ['a']));
    expect(calls).toHaveLength(0);
    redraw(el, true, () => fill(el, ['a', ...'nopqrstuvwxyz'])); // a restore
    expect(calls).toHaveLength(0);
    expect(el.querySelector('.voc-ghost')).toBeNull();
  });

  it('does nothing but draw where the browser cannot animate, or with reduced motion', () => {
    const el = list(['a', 'b', 'c']);
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q })) as typeof window.matchMedia;
    redraw(el, true, () => fill(el, ['a', 'c']));
    expect(words(el)).toEqual(['a', 'c']);
    expect(calls).toHaveLength(0);
    window.matchMedia = realMatch;
    (Element.prototype as { animate?: unknown }).animate = undefined;
    redraw(el, true, () => fill(el, ['c']));
    expect(words(el)).toEqual(['c']);
    expect(el.querySelector('.voc-ghost')).toBeNull();
  });
});

describe('a star or check that turns on', () => {
  it('pops its icon a little and back, in 200 ms; nothing with reduced motion', () => {
    const btn = document.createElement('button');
    btn.innerHTML = '<svg></svg>';
    popIcon(btn);
    expect(calls).toHaveLength(1);
    expect(calls[0].el).toBe(btn.querySelector('svg'));
    expect(calls[0].frames.map((f) => f.transform)).toEqual(['none', 'scale(1.15)', 'none']);
    expect(calls[0].opts.duration).toBe(200);
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q })) as typeof window.matchMedia;
    popIcon(btn);
    expect(calls).toHaveLength(1);
  });
});
