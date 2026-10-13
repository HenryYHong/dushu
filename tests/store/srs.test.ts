import { describe, expect, it } from 'vitest';
import { DAY, MINUTE, formatInterval, nextIntervals, newSrs, schedule } from '../../src/core/srs';
import type { Grade, SrsState } from '../../src/types';

const T = 1_000_000_000_000;
const review = (over: Partial<SrsState> = {}): SrsState => ({ due: T, interval: 10, ease: 2.5, reps: 3, lapses: 0, last: T - 10 * DAY, ...over });

describe('learning steps', () => {
  it('new card: again 1m, hard 6m, good 10m, easy 4d', () => {
    const s = newSrs(T);
    expect(schedule(s, 0, T).due - T).toBe(1 * MINUTE);
    expect(schedule(s, 1, T).due - T).toBe(6 * MINUTE);
    expect(schedule(s, 2, T).due - T).toBe(10 * MINUTE);
    const easy = schedule(s, 3, T);
    expect(easy.interval).toBe(4);
    expect(easy.due - T).toBe(4 * DAY);
    expect(easy.reps).toBe(1);
  });

  it('good, good graduates to 1 day', () => {
    const a = schedule(newSrs(T), 2, T);
    expect(a.interval).toBe(0);
    const b = schedule(a, 2, a.due);
    expect(b.interval).toBe(1);
    expect(b.due).toBe(a.due + DAY);
    expect(b.reps).toBe(1);
  });

  it('second step: hard repeats 10m, again goes back to 1m', () => {
    const a = schedule(newSrs(T), 2, T);
    expect(schedule(a, 1, a.due).due - a.due).toBe(10 * MINUTE);
    const back = schedule(a, 0, a.due);
    expect(back.due - a.due).toBe(MINUTE);
    expect(schedule(back, 2, back.due).due - back.due).toBe(10 * MINUTE);
  });

  it('hard on step 1 then good still graduates', () => {
    const a = schedule(newSrs(T), 2, T);
    const h = schedule(a, 1, a.due);
    expect(schedule(h, 2, h.due).interval).toBe(1);
  });
});

describe('review cards (table)', () => {
  const cases: [string, Partial<SrsState>, Grade, Partial<SrsState>][] = [
    ['hard', {}, 1, { interval: 12, ease: 2.35 }],
    ['good', {}, 2, { interval: 25, ease: 2.5 }],
    ['easy', {}, 3, { interval: 33, ease: 2.65 }],
    ['again lapses', {}, 0, { interval: 0, ease: 2.3, lapses: 1 }],
    ['hard on interval 1 still grows', { interval: 1 }, 1, { interval: 2, ease: 2.35 }],
    ['good on interval 1 grows past hard', { interval: 1 }, 2, { interval: 3 }],
    ['easy beats good', { interval: 1 }, 3, { interval: 4 }],
    ['ease floor', { ease: 1.3 }, 0, { ease: 1.3 }],
    ['ease floor hard', { ease: 1.35 }, 1, { ease: 1.3 }],
  ];
  for (const [name, from, grade, want] of cases) {
    it(name, () => {
      const out = schedule(review(from), grade, T);
      for (const [k, v] of Object.entries(want)) expect((out as unknown as Record<string, number>)[k]).toBe(v);
      expect(out.last).toBe(T);
      if (out.interval > 0) expect(out.due).toBe(T + out.interval * DAY);
      else expect(out.due).toBe(T + MINUTE);
    });
  }

  it('lapsed card relearns then graduates to 1 day', () => {
    const l = schedule(review(), 0, T);
    const a = schedule(l, 2, l.due);
    expect(a.interval).toBe(0);
    expect(schedule(a, 2, a.due).interval).toBe(1);
  });

  it('does not mutate and is deterministic', () => {
    const s = review();
    const copy = { ...s };
    expect(schedule(s, 2, T)).toEqual(schedule(s, 2, T));
    expect(s).toEqual(copy);
  });

  it('caps the interval', () => {
    expect(schedule(review({ interval: 30000, ease: 3 }), 3, T).interval).toBe(36500);
  });
});

describe('nextIntervals / formatInterval', () => {
  it('labels for a new card', () => {
    expect(nextIntervals(newSrs(T), T)).toEqual({ again: '1m', hard: '6m', good: '10m', easy: '4d' });
  });
  it('labels for a review card', () => {
    expect(nextIntervals(review(), T)).toEqual({ again: '1m', hard: '12d', good: '25d', easy: '1.1mo' });
  });
  it('formats ranges', () => {
    expect(formatInterval(10_000)).toBe('<1m');
    expect(formatInterval(3 * 3600_000)).toBe('3h');
    expect(formatInterval(45 * DAY)).toBe('1.5mo');
    expect(formatInterval(800 * DAY)).toBe('2.2y');
  });
});
