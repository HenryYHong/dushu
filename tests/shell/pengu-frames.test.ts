// @vitest-environment jsdom
// Pengu animated a drawing at a time (ui/pengu.ts): every drawing of its set stacked in one box with only one showing, a move
// showing them in turn and coming back to rest, the wave's cutout flipper swinging from its shoulder, the jump's smooth arc and
// its paper, and nothing at all under reduced motion. The browser's Web Animations are faked: each call is recorded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animatePengu, penguEl, penguHtml } from '../../src/ui/pengu';
import lifts from '../../src/ui/pengu/jump.json';

interface Run { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions }
let runs: Run[] = [];
let reduce = false;
const proto = HTMLElement.prototype as unknown as { animate?: unknown; getAnimations?: unknown };

beforeEach(() => {
  runs = [];
  reduce = false;
  vi.useFakeTimers();
  proto.animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) { runs.push({ el: this, frames, opts }); return { cancel() {}, finished: new Promise(() => {}) }; };
  proto.getAnimations = () => [];
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { delete proto.animate; delete proto.getAnimations; vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ''; });

const showing = (el: Element) => [...el.querySelectorAll<HTMLElement>('.pengu-f.on')].map((i) => i.dataset.f);

describe('the drawings', () => {
  it('stacks every drawing of its set in one box, only the resting one showing, and names only that one', () => {
    const host = document.createElement('div');
    host.innerHTML = penguHtml('read', 'Pengu');
    const stack = host.querySelector<HTMLElement>('.pengu-stack')!;
    expect(stack.dataset.kind).toBe('book');
    expect([...stack.querySelectorAll<HTMLElement>('.pengu-f')].map((i) => i.dataset.f)).toEqual(['rest', 'blink-half', 'blink', 'noflip']);
    expect(showing(stack)).toEqual(['rest']);
    // The waving flipper, turning from its shoulder.
    expect(stack.querySelector<HTMLElement>('.pengu-arm')!.style.transformOrigin).toMatch(/^[\d.]+% [\d.]+%$/);
    expect([...stack.querySelectorAll('img')].filter((i) => i.getAttribute('alt'))).toHaveLength(1);
    host.innerHTML = penguHtml('cheer');
    expect(host.querySelector<HTMLElement>('.pengu-stack')!.dataset.kind).toBe('jump');
    expect([...host.querySelectorAll<HTMLElement>('.pengu-f')].map((i) => i.dataset.f)).toEqual(['rest', 'crouch', 'rise', 'air']);
  });

  it('jump drawings stand on one ground line, the top one drawn highest', () => {
    expect(lifts.stand).toBe(0);
    expect(lifts.crouch).toBe(0);
    expect(lifts.rise).toBeGreaterThan(0);
    expect(lifts.air).toBeGreaterThan(lifts.rise);
  });
});

describe('moves', () => {
  it('waves by swinging the cutout flipper from its shoulder over the picture without it, then rests', () => {
    const el = penguEl('wave');
    animatePengu(el, 'wave');
    const flip = el.querySelector('.pengu-arm')!;
    const swing = runs.find((r) => r.el === flip)!;
    // Up from the book, out and in a few times, and back down: turns only.
    expect(swing.frames.every((f) => /^rotate\(-?\d+deg\)$/.test(String(f.transform)))).toBe(true);
    expect(swing.frames[0].opacity).toBe(0);
    expect(swing.frames[swing.frames.length - 1].opacity).toBe(0);
    vi.advanceTimersByTime(10);
    expect(showing(el)).toEqual(['rest', 'noflip']);
    vi.advanceTimersByTime(2000);
    expect(showing(el)).toEqual(['rest']);
    // Nothing moves the whole picture.
    expect(runs.some((r) => r.el === el || r.el === el.querySelector('.pengu-stack'))).toBe(false);
  });

  it('jumps twice for good news: the drawings in turn, and a smooth arc up as high as the top drawing', () => {
    const el = penguEl('cheer');
    animatePengu(el, 'cheer');
    const stack = el.querySelector('.pengu-stack')!;
    const arc = runs.find((r) => r.el === stack)!;
    expect(arc.opts.iterations).toBe(2);
    expect(arc.frames.map((f) => f.transform)).toContain(`translateY(-${lifts.air}%)`);
    const seen: string[] = [];
    for (let t = 0; t < 1700; t += 10) { const f = showing(el)[0]!; if (seen[seen.length - 1] !== f) seen.push(f); vi.advanceTimersByTime(10); }
    expect(seen).toEqual(['rest', 'crouch', 'rise', 'air', 'rise', 'crouch', 'rise', 'air', 'rise', 'crouch', 'rest']);
  });

  it('throws a burst of paper as it leaves the ground, each jump, but not for a tap', () => {
    const el = penguEl('cheer');
    document.body.append(el);
    animatePengu(el, 'boing');
    vi.advanceTimersByTime(900);
    expect(document.querySelectorAll('.pengu-confetti')).toHaveLength(0);
    animatePengu(el, 'cheer');
    vi.advanceTimersByTime(140);
    expect(document.querySelectorAll('.pengu-confetti')).toHaveLength(0);
    vi.advanceTimersByTime(20);
    expect(document.querySelectorAll('.pengu-confetti')).toHaveLength(1);
    vi.advanceTimersByTime(780);
    expect(document.querySelectorAll('.pengu-confetti')).toHaveLength(2);
  });

  it('a new move takes over from the one playing', () => {
    const el = penguEl('wave');
    animatePengu(el, 'wave');
    vi.advanceTimersByTime(300);
    animatePengu(el, 'blink');
    vi.advanceTimersByTime(60);
    expect(showing(el)).toEqual(['blink']);
    vi.advanceTimersByTime(2000);
    expect(showing(el)).toEqual(['rest']);
  });

  it('does nothing under reduced motion', () => {
    reduce = true;
    const el = penguEl('cheer');
    animatePengu(el, 'cheer');
    animatePengu(el, 'pop');
    vi.advanceTimersByTime(500);
    expect(showing(el)).toEqual(['rest']);
    expect(runs).toHaveLength(0);
  });
});
