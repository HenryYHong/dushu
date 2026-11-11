// @vitest-environment jsdom
// Review's motion (review/motion.ts, swipe.ts): the answer unfolding, a graded card leaving to the side of its grade, swipe to
// grade on a touch screen, the "3 in a row" line and the summary counting up. The screen must never wait on an animation, and
// a swipe must grade only once the answer shows.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '../../src/store';
import { createSettingsStore } from '../../src/store/settings';
import { mount as mountReview } from '../../src/ui/review/review';
import { swipeLine, swipeResult, swipeTilt } from '../../src/ui/review/swipe';
import type { AppContext } from '../../src/types';
import { item } from './helpers';

vi.mock('../../src/ui/popup/popup', () => ({ openWordPopup: vi.fn() }));

const tick = () => new Promise((r) => setTimeout(r, 30));
async function until(fn: () => boolean, ms = 2000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const WORDS = [item('你好', 'ni3 hao3', 'hello'), item('爱', 'ai4', 'to love'), item('山', 'shan1', 'mountain'), item('水', 'shui3', 'water'), item('火', 'huo3', 'fire')];

async function setup(words = WORDS, buttons: 'simple' | 'detailed' = 'simple') {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  const store = await openStore('t' + Math.random());
  const now = Date.now();
  for (const w of words) await store.vocab.put({ ...w, addedAt: now - 1000, srs: { ...w.srs, due: now - 1000 } });
  const ctx: AppContext = {
    dict: () => Promise.reject(new Error('no dict')), dictSync: () => null,
    settings: createSettingsStore(), store, navigate: () => {}, toast: () => {},
  };
  ctx.settings.set({ reviewButtons: buttons });
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const cleanup = await mountReview(root, {}, ctx) as () => void;
  await until(() => !!root.querySelector('.rev-word'));
  return { store, root, cleanup };
}
/** The card on screen (a leaving copy, when there is one, is not it). */
const card = (root: HTMLElement) => root.querySelector<HTMLElement>('.rev-card:not(.rev-ghost)')!;
const counter = (root: HTMLElement) => root.querySelector('.rev-counter')!.textContent!;
const word = (root: HTMLElement) => card(root).querySelector('.rev-word')!.textContent!;
/** Waits for the next card: a new word, its answer hidden. (Got it keeps a new card in the session, so the counter can stay.) */
async function nextCard(root: HTMLElement, was: string) {
  await until(() => word(root) !== was && !!card(root).querySelector('.rev-back[hidden]'));
}

/**
 * A finger (or `type`) on the card: down at (x0, y0), moved by each [dx, dy] in turn, then up. jsdom has no PointerEvent.
 * `during` looks at the card before the finger lifts.
 */
function drag(el: HTMLElement, moves: [number, number][], type = 'touch', during?: () => void) {
  const [x0, y0] = [200, 300];
  let t = performance.now();
  const fire = (name: string, x: number, y: number) => {
    const e = new MouseEvent(name, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperties(e, { pointerType: { value: type }, pointerId: { value: 7 }, isPrimary: { value: true }, timeStamp: { value: (t += 40) } });
    el.dispatchEvent(e);
  };
  fire('pointerdown', x0, y0);
  let [x, y] = [x0, y0];
  for (const [dx, dy] of moves) { x = x0 + dx; y = y0 + dy; fire('pointermove', x, y); }
  during?.();
  fire('pointerup', x, y);
}

beforeEach(() => { localStorage.clear(); });

describe('swipe to grade, the numbers', () => {
  it('grades past about a third of the card, or a quick flick past 40 px; short of that the card goes back', () => {
    expect(swipeLine(320)).toBe(96);
    expect(swipeLine(1000)).toBe(120);
    expect(swipeLine(100)).toBe(60);
    expect(swipeResult(100, 0, 320)).toBe(1);
    expect(swipeResult(-100, 0, 320)).toBe(-1);
    expect(swipeResult(80, 0.1, 320)).toBe(0);
    expect(swipeResult(50, 0.8, 320)).toBe(1);
    expect(swipeResult(-50, -0.8, 320)).toBe(-1);
    // A flick back toward the middle is not a flick away.
    expect(swipeResult(50, -0.8, 320)).toBe(0);
    expect(swipeResult(30, 2, 320)).toBe(0);
  });
  it('tilts 3 degrees at most, and not at all with reduced motion', () => {
    expect(swipeTilt(100, true)).toBeCloseTo(2);
    expect(swipeTilt(-500, true)).toBe(-3);
    expect(swipeTilt(80, false)).toBe(0);
  });
});

describe('swipe to grade on the card', () => {
  it('does nothing before the answer shows; then right is Got it and left is Forgot', async () => {
    const { root, store, cleanup } = await setup();
    try {
      // Before the answer the card does not even follow the finger.
      drag(card(root), [[40, 0], [90, 0], [140, 0]], 'touch', () => {
        expect(card(root).style.transform).toBe('');
        expect(root.querySelector('.rev-swipe')).toBeNull();
      });
      await tick();
      expect(counter(root)).toContain('0 of 5');
      expect((await store.vocab.logs()).length).toBe(0);
      key(' ');
      let was = word(root);
      drag(card(root), [[40, 0], [90, 0], [140, 0]], 'touch', () => {
        expect(card(root).style.transform).toBe('translateX(130px)');
        expect(card(root).querySelector('.rev-swipe-right .rev-swipe-label')?.textContent).toBe('Got it');
      });
      await nextCard(root, was);
      key(' ');
      was = word(root);
      drag(card(root), [[-40, 0], [-90, 0], [-140, 0]]);
      await nextCard(root, was);
      expect((await store.vocab.logs()).map((l) => l.grade)).toEqual([2, 0]);
    } finally { cleanup(); }
  });

  it('a short drag, an up-and-down move or a mouse grades nothing, and the card is put back straight', async () => {
    const { root, store, cleanup } = await setup();
    try {
      key(' ');
      drag(card(root), [[20, 0], [50, 0]]);
      drag(card(root), [[2, 30], [8, 120]]);
      drag(card(root), [[40, 0], [90, 0], [160, 0]], 'mouse');
      await tick();
      expect(counter(root)).toContain('0 of 5');
      expect((await store.vocab.logs()).length).toBe(0);
      expect(card(root).style.transform).toBe('');
      expect(root.querySelector('.rev-swipe')).toBeNull();
    } finally { cleanup(); }
  });

  it('shows what each side means in the words of the buttons: Good and Again with Anki’s buttons', async () => {
    const { root, store, cleanup } = await setup(WORDS, 'detailed');
    try {
      key(' ');
      const el = card(root);
      const fire = (name: string, x: number) => {
        const e = new MouseEvent(name, { clientX: x, clientY: 300, bubbles: true });
        Object.defineProperties(e, { pointerType: { value: 'touch' }, pointerId: { value: 3 }, isPrimary: { value: true } });
        el.dispatchEvent(e);
      };
      fire('pointerdown', 200);
      fire('pointermove', 260);
      expect(el.querySelector('.rev-swipe-right .rev-swipe-label')?.textContent).toBe('Good');
      expect(el.querySelector('.rev-swipe')!.getAttribute('aria-hidden')).toBe('true');
      fire('pointermove', 140);
      expect(el.querySelector('.rev-swipe-left .rev-swipe-label')?.textContent).toBe('Again');
      const was = word(root);
      fire('pointermove', 330);
      fire('pointerup', 330);
      await nextCard(root, was);
      expect((await store.vocab.logs()).map((l) => l.grade)).toEqual([2]);
    } finally { cleanup(); }
  });
});

describe('the "in a row" line', () => {
  it('shows from 3 remembered in a row, counts on, and goes at a forgotten one', async () => {
    const { root, cleanup } = await setup();
    try {
      const streak = () => root.querySelector('.rev-streak')?.textContent ?? null;
      const answer = async (k: string) => { const was = word(root); key(' '); key(k); await nextCard(root, was); };
      await answer('2'); await answer('2');
      expect(streak()).toBeNull();
      await answer('2');
      expect(streak()).toBe('3 in a row');
      await answer('2');
      expect(streak()).toBe('4 in a row');
      await answer('1');
      expect(streak()).toBeNull();
    } finally { cleanup(); }
  });
});

describe('with animations that never finish', () => {
  // A browser that can animate: every animation starts and none ever ends. Grading, focus and the next card must not wait.
  const real = (HTMLElement.prototype as { animate?: unknown }).animate;
  beforeEach(() => {
    (HTMLElement.prototype as { animate?: unknown }).animate = function () {
      return { finished: new Promise(() => {}), cancel() {}, play() {}, currentTime: 0 } as unknown as Animation;
    };
  });
  afterEach(() => { (HTMLElement.prototype as { animate?: unknown }).animate = real; });

  it('grades at once: the leaving copy is hidden from screen readers and taps, and focus is on the new card', async () => {
    const { root, cleanup } = await setup();
    try {
      root.querySelector<HTMLButtonElement>('.rev-reveal')!.click();
      root.querySelector<HTMLButtonElement>('.rev-grade-good')!.focus();
      const was = word(root);
      key('2');
      await nextCard(root, was);
      const ghost = root.querySelector<HTMLElement>('.rev-ghost')!;
      expect(ghost).toBeTruthy();
      expect(ghost.getAttribute('aria-hidden')).toBe('true');
      expect(ghost.inert).toBe(true);
      expect(ghost.hasAttribute('tabindex')).toBe(false);
      expect(root.querySelectorAll('.rev-card:not(.rev-ghost)')).toHaveLength(1);
      expect(document.activeElement).toBe(card(root));
      expect(card(root).classList.contains('rev-card-gone')).toBe(false);
      // The next card answers to the keyboard straight away.
      key(' ');
      expect(document.activeElement).toBe(card(root).querySelector('.rev-back'));
      const second = word(root);
      key('1');
      await nextCard(root, second);
    } finally { cleanup(); }
  });

  it('the summary has its final numbers for screen readers while the tiles count up', async () => {
    const { root, cleanup } = await setup([item('爱', 'ai4', 'to love')], 'detailed');
    try {
      key(' '); key('4');
      await until(() => !!root.querySelector('.rev-summary-title'));
      const stats = [...root.querySelectorAll('.rev-stat')];
      expect(stats.map((s) => s.querySelector('.rev-sr')!.textContent)).toEqual(['100%', '0', '0', '0', '1']);
      expect(stats.every((s) => s.querySelector('.rev-stat-value')!.getAttribute('aria-hidden') === 'true')).toBe(true);
    } finally { cleanup(); document.querySelector('.rev-confetti')?.remove(); }
  });
});
