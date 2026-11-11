// @vitest-environment jsdom
// Motion in Settings, the welcome and the walkthrough: a segmented control's highlight slides to a choice made by hand (never on
// the first draw or for a change made elsewhere, and from where it is when picked again on its way); the welcome's steps slide in
// from the side the reader went to, the footer still; the walkthrough's card glides from the last step's place and size while
// its words fade in, and the lit box with it, by transforms alone. Nothing moves under reduced motion. The browser's Web
// Animations are faked: each call is recorded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../src/lang/active', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/lang/active')>()), switchLang: vi.fn() }));

import { radioGroup } from '../../src/ui/settings/controls';
import { showGuide } from '../../src/ui/guide';
import { showWelcome } from '../../src/ui/welcome';
import { createSettingsStore } from '../../src/store/settings';

interface Run { el: Element; frames: Keyframe[]; opts: KeyframeAnimationOptions; onfinish: null | (() => void); cancelled: boolean; cancel(): void }
let runs: Run[] = [];
let reduce = false;
const proto = HTMLElement.prototype as unknown as { animate?: unknown };
const realRect = Element.prototype.getBoundingClientRect;
/** Boxes by element, for the fake layout. */
let rect: (el: Element) => DOMRect | null = () => null;

beforeEach(() => {
  runs = [];
  reduce = false;
  proto.animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    const run: Run = { el: this, frames, opts, onfinish: null, cancelled: false, cancel() { run.cancelled = true; } };
    runs.push(run);
    return run;
  };
  window.matchMedia = ((media: string) => ({
    matches: reduce && media.includes('prefers-reduced-motion: reduce'), media, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  Element.prototype.getBoundingClientRect = function (this: Element) { return rect(this) ?? realRect.call(this); };
});
afterEach(() => {
  delete proto.animate;
  Element.prototype.getBoundingClientRect = realRect;
  rect = () => null;
  document.body.replaceChildren();
  document.body.className = '';
  localStorage.clear();
});

describe('a segmented control', () => {
  /** Three buttons 40 px wide, 50 px apart, in a group at (10, 20); the mark, while it moves, halfway between the first two. */
  const setup = () => {
    let value = 'a';
    const group = radioGroup('Pick', ['a', 'b', 'c'].map((v) => ({ value: v, label: v.toUpperCase() })), (v) => { value = v; group.select(v); });
    document.body.append(group.el);
    const buttons = [...group.el.querySelectorAll<HTMLButtonElement>('.set-seg-btn')];
    const mark = group.el.querySelector<HTMLElement>('.set-seg-glide')!;
    rect = (el) => el === group.el ? new DOMRect(10, 20, 200, 32)
      : buttons.includes(el as HTMLButtonElement) ? new DOMRect(12 + buttons.indexOf(el as HTMLButtonElement) * 50, 22, 40, 28)
        : el === mark ? new DOMRect(37, 22, 40, 28) : null;
    group.select(value);
    return { group, buttons, mark, value: () => value };
  };
  const moving = (el: Element) => el.classList.contains('set-seg-moving');

  it('slides to a choice made by hand, and hands back to the button when it lands', () => {
    const { group, buttons, mark } = setup();
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    // The first draw does not move.
    expect(runs).toHaveLength(0);
    buttons[2].click();
    expect(runs).toHaveLength(1);
    expect(runs[0].el).toBe(mark);
    expect(runs[0].frames[0].transform).toBe('translate(-100px, 0px) scale(1, 1)');
    expect(runs[0].frames[1].transform).toBe('none');
    expect([mark.style.left, mark.style.top, mark.style.width]).toEqual(['102px', '2px', '40px']);
    expect(moving(group.el)).toBe(true);
    runs[0].onfinish!();
    expect(moving(group.el)).toBe(false);
  });

  it('an arrow key slides it too; picking the chosen one again does nothing', () => {
    const { group, buttons } = setup();
    buttons[0].click();
    expect(runs).toHaveLength(0);
    buttons[0].focus();
    group.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(runs).toHaveLength(1);
    expect(buttons[1].getAttribute('aria-checked')).toBe('true');
  });

  it('a second pick on the way starts from where the mark is', () => {
    const { group, buttons } = setup();
    buttons[1].click();
    buttons[2].click();
    expect(runs).toHaveLength(2);
    expect(runs[0].cancelled).toBe(true);
    // From the mark's place (27 px into the group), not the button it left.
    expect(runs[1].frames[0].transform).toBe('translate(-75px, 0px) scale(1, 1)');
    // The first one's end does not take the second's mark away.
    runs[0].onfinish?.();
    expect(moving(group.el)).toBe(true);
  });

  it('a change made elsewhere (another tab, the first draw) puts the mark away instead of sliding', () => {
    const { group, buttons } = setup();
    buttons[1].click();
    group.select('c');
    expect(runs).toHaveLength(1);
    expect(runs[0].cancelled).toBe(true);
    expect(moving(group.el)).toBe(false);
    expect(buttons[2].getAttribute('aria-checked')).toBe('true');
  });

  it('nothing moves under reduced motion, or where the browser cannot animate', () => {
    reduce = true;
    const { group, buttons } = setup();
    buttons[2].click();
    expect(runs).toHaveLength(0);
    expect(moving(group.el)).toBe(false);
    reduce = false;
    delete proto.animate;
    buttons[1].click();
    expect(buttons[1].getAttribute('aria-checked')).toBe('true');
  });
});

describe('the welcome', () => {
  const box = () => document.querySelector('.wel-box')!;
  /** The slides of the step's content (Pengu's own hello aside). */
  const slides = () => runs.filter((r) => r.el.parentElement === box());
  const primary = () => document.querySelector<HTMLButtonElement>('.wel-foot .btn-primary')!;

  it('a step slides in from the side the reader went to, the footer still; the first does not', () => {
    void showWelcome(createSettingsStore(localStorage, 'zh'), { current: 'zh' });
    expect(slides()).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('.wel-lang')!.click();
    primary().click();
    expect(slides().length).toBeGreaterThan(1);
    expect(slides().every((r) => !r.el.classList.contains('wel-foot'))).toBe(true);
    expect(slides().every((r) => r.frames[0].transform === 'translateX(20px)' && r.frames[0].opacity === 0)).toBe(true);
    runs = [];
    [...document.querySelectorAll<HTMLButtonElement>('.wel-foot .btn')].find((b) => b.textContent!.includes('Back'))!.click();
    expect(slides().length).toBeGreaterThan(1);
    expect(slides().every((r) => r.frames[0].transform === 'translateX(-20px)')).toBe(true);
  });

  it('the goal ring slides to a new goal', () => {
    void showWelcome(createSettingsStore(localStorage, 'zh'), { current: 'zh' });
    document.querySelector<HTMLButtonElement>('.wel-lang')!.click();
    primary().click();
    primary().click();
    const goals = [...document.querySelectorAll<HTMLButtonElement>('.wel-goal')];
    const group = document.querySelector('.wel-goals')!;
    rect = (el) => el === group ? new DOMRect(0, 100, 600, 80) : goals.includes(el as HTMLButtonElement) ? new DOMRect(goals.indexOf(el as HTMLButtonElement) * 100, 100, 90, 80) : null;
    runs = [];
    goals[4].click();
    const glide = runs.find((r) => r.el.classList.contains('wel-goals-glide'))!;
    // From the default goal (10 minutes, the second) to the fifth.
    expect(glide.frames[0].transform).toBe('translate(-300px, 0px) scale(1, 1)');
    expect(group.classList.contains('wel-goals-moving')).toBe(true);
    expect(goals[4].getAttribute('aria-checked')).toBe('true');
  });
});

describe('the walkthrough', () => {
  it('the card glides to the next step from where it was, its height with it, while the words fade in', () => {
    const a = document.body.appendChild(document.createElement('button'));
    const b = document.body.appendChild(document.createElement('button'));
    rect = (el) => {
      if (el === a) return new DOMRect(100, 100, 50, 20);
      if (el === b) return new DOMRect(400, 300, 50, 20);
      if (el.classList.contains('rd-guide-card')) {
        const s = (el as HTMLElement).style;
        return new DOMRect(parseFloat(s.left) || 0, parseFloat(s.top) || 0, 360, el.textContent!.includes('Second') ? 150 : 120);
      }
      return null;
    };
    const guide = showGuide(document.body, [{ target: () => a, title: 'First', body: ['One'] }, { target: () => b, title: 'Second', body: ['Two'] }]);
    const card = document.querySelector<HTMLElement>('.rd-guide-card')!;
    const onCard = () => runs.filter((r) => r.el === card);
    // The first step appears in its place.
    expect(onCard()).toHaveLength(0);
    const was = { left: parseFloat(card.style.left), top: parseFloat(card.style.top) };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const now = { left: parseFloat(card.style.left), top: parseFloat(card.style.top) };
    expect(now).not.toEqual(was);
    const [move, grow] = onCard();
    expect(move.frames[0].transform).toBe(`translate(${was.left - now.left}px, ${was.top - now.top}px)`);
    expect(grow.frames.map((f) => f.height)).toEqual(['120px', '150px']);
    expect(card.style.overflow).toBe('hidden');
    for (const sel of ['.rd-guide-count', '.rd-guide-title', '.rd-guide-body']) {
      expect(runs.find((r) => r.el === card.querySelector(sel))?.frames[0].opacity).toBe(0);
    }
    // A new window size puts it in its place at once.
    window.dispatchEvent(new Event('resize'));
    expect(move.cancelled && grow.cancelled).toBe(true);
    expect(card.style.overflow).toBe('');
    guide.stop();
  });

  /**
   * Two buttons to light up, the first 50x20 at (100, 100), the second 80x30 at (200, 400), and a fake layout: the card and the
   * lit box where their styles put them, the ring's arcs at the lit box's corners (2px out, 12px square).
   */
  const twoTargets = () => {
    const a = document.body.appendChild(document.createElement('button'));
    const b = document.body.appendChild(document.createElement('button'));
    rect = (el) => {
      if (el === a) return new DOMRect(100, 100, 50, 20);
      if (el === b) return new DOMRect(200, 400, 80, 30);
      const spot = document.querySelector<HTMLElement>('.rd-guide-spot');
      const box = spot && { l: parseFloat(spot.style.left), t: parseFloat(spot.style.top), w: parseFloat(spot.style.width), h: parseFloat(spot.style.height) };
      if (el.classList.contains('rd-guide-card')) return new DOMRect(parseFloat((el as HTMLElement).style.left) || 0, parseFloat((el as HTMLElement).style.top) || 0, 360, 120);
      if (box && el.parentElement?.classList.contains('rd-guide-ring') && el.tagName === 'I') {
        const right = el.classList.contains('rd-guide-tr') || el.classList.contains('rd-guide-br');
        const bottom = el.classList.contains('rd-guide-bl') || el.classList.contains('rd-guide-br');
        return new DOMRect(right ? box.l + box.w - 10 : box.l - 2, bottom ? box.t + box.h - 10 : box.t - 2, 12, 12);
      }
      return null;
    };
    return [{ target: () => a, title: 'First', body: ['One'] }, { target: () => b, title: 'Second', body: ['Two'] }];
  };

  it('the lit box glides with the card: its new box at once, its parts by transforms from the old one', () => {
    const guide = showGuide(document.body, twoTargets());
    const spot = document.querySelector<HTMLElement>('.rd-guide-spot')!;
    // The first step's box, 6px around the button (62x32 at 94, 94), just appears (only Pengu moves).
    expect([spot.style.left, spot.style.top, spot.style.width, spot.style.height]).toEqual(['94px', '94px', '62px', '32px']);
    expect(runs.filter((r) => spot.contains(r.el) || r.el === document.querySelector('.rd-guide-card'))).toHaveLength(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    // The new box (92x42 at 194, 394) is set at once: nothing about it transitions.
    expect([spot.style.left, spot.style.top, spot.style.width, spot.style.height]).toEqual(['194px', '394px', '92px', '42px']);
    const card = document.querySelector('.rd-guide-card')!;
    const on = (q: string) => runs.filter((r) => r.el === spot.querySelector(q)).map((r) => r.frames[0].transform);
    // The box slides from the old corner (100 px left, 300 up), in the card's time and curve.
    const slide = runs.find((r) => r.el === spot)!;
    expect(slide.frames.map((f) => f.transform)).toEqual(['translate(-100px, -300px) scale(1, 1)', 'none']);
    const cardMove = runs.find((r) => r.el === card && String(r.frames[0].transform).startsWith('translate'))!;
    expect([slide.opts.duration, slide.opts.easing]).toEqual([cardMove.opts.duration, cardMove.opts.easing]);
    // The parts on its right and bottom start where the old size had them (30 px narrower, 10 px shorter)...
    for (const part of ['.rd-guide-dim > .rd-guide-tr', '.rd-guide-ring > .rd-guide-tr']) expect(on(part)).toEqual(['translate(-30px, 0px) scale(1, 1)']);
    for (const part of ['.rd-guide-dim > .rd-guide-bl', '.rd-guide-ring > .rd-guide-bl']) expect(on(part)).toEqual(['translate(0px, -10px) scale(1, 1)']);
    for (const part of ['.rd-guide-dim > .rd-guide-br', '.rd-guide-ring > .rd-guide-br']) expect(on(part)).toEqual(['translate(-30px, -10px) scale(1, 1)']);
    // ...the top-left ones ride with the box...
    expect(on('.rd-guide-dim > .rd-guide-tl')).toEqual([]);
    expect(on('.rd-guide-ring > .rd-guide-tl')).toEqual([]);
    // ...and the ring's edges start at the old length (between the arcs, 18 px short of the box), stretching along it only.
    expect(on('.rd-guide-t')).toEqual([`translate(0px, 0px) scale(${44 / 74}, 1)`]);
    expect(on('.rd-guide-b')).toEqual([`translate(0px, -10px) scale(${44 / 74}, 1)`]);
    expect(on('.rd-guide-l')).toEqual([`translate(0px, 0px) scale(1, ${14 / 24})`]);
    expect(on('.rd-guide-r')).toEqual([`translate(-30px, 0px) scale(1, ${14 / 24})`]);
    // Nothing in the lit box animates anything but its transform.
    expect(runs.filter((r) => spot.contains(r.el)).every((r) => r.frames.every((f) => Object.keys(f).every((k) => k === 'transform' || k === 'offset' || k === 'composite' || k === 'easing')))).toBe(true);
    // A new window size puts it in its place at once.
    window.dispatchEvent(new Event('resize'));
    expect(runs.filter((r) => spot.contains(r.el)).every((r) => r.cancelled)).toBe(true);
    guide.stop();
  });

  it('the stylesheet transitions nothing in the walkthrough: a transition of the lit box laid the page out on every frame', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/guide.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.rd-guide-spot \{/);
    expect(css).not.toMatch(/transition/);
  });

  it('a step to or from one that lights nothing does not glide the lit box', () => {
    const [first] = twoTargets();
    const guide = showGuide(document.body, [first, { title: 'Middle', body: ['Two'] }, first]);
    const spot = document.querySelector<HTMLElement>('.rd-guide-spot')!;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(spot.hidden).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(spot.hidden).toBe(false);
    expect(runs.filter((r) => spot.contains(r.el))).toHaveLength(0);
    guide.stop();
  });

  it('nothing glides under reduced motion', () => {
    reduce = true;
    const guide = showGuide(document.body, twoTargets());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(document.querySelector('.rd-guide-title')!.textContent).toBe('Second');
    expect(document.querySelector<HTMLElement>('.rd-guide-spot')!.style.left).toBe('194px');
    expect(runs).toHaveLength(0);
    guide.stop();
  });
});
