import { describe, expect, it } from 'vitest';
import { describeNextDue, ReviewSession } from '../../src/ui/review/queue';
import { SAMPLE, T0, item } from './helpers';

const later = (it: typeof SAMPLE[0], ms: number) => ({ ...it, srs: { ...it.srs, due: T0 + ms } });

describe('ReviewSession', () => {
  it('orders by due date and tracks progress', () => {
    const s = new ReviewSession([item('b', 'b1', 'b', { srs: { due: 5, interval: 0, ease: 2.5, reps: 0, lapses: 0 } }), item('a', 'a1', 'a', { srs: { due: 1, interval: 0, ease: 2.5, reps: 0, lapses: 0 } })]);
    expect(s.current?.id).toBe('a');
    expect(s.total).toBe(2);
    s.answer(2, later(s.current!, 86400000), T0);
    expect([s.done, s.remaining, s.current?.id]).toEqual([1, 1, 'b']);
  });
  it('requeues a card that comes back within the session window', () => {
    const s = new ReviewSession([SAMPLE[0]]);
    s.answer(0, later(SAMPLE[0], 60_000), T0);
    expect(s.isOver).toBe(false);
    expect(s.done).toBe(0);
    s.answer(2, later(SAMPLE[0], 86400000), T0);
    expect(s.isOver).toBe(true);
    expect(s.done).toBe(1);
  });
  it('summary counts grades and recall', () => {
    const s = new ReviewSession([SAMPLE[0], SAMPLE[1]]);
    s.answer(0, later(SAMPLE[0], 60_000), T0);
    s.answer(3, later(SAMPLE[1], 4 * 86400000), T0);
    s.answer(1, later(SAMPLE[0], 86400000), T0);
    expect(s.summary()).toEqual({ reviews: 3, cards: 2, grades: [1, 1, 0, 1], recall: 2 / 3 });
  });
  it('skip removes without grading; answer on empty is a no-op', () => {
    const s = new ReviewSession([SAMPLE[0]]);
    s.skip();
    expect(s.isOver).toBe(true);
    s.answer(2, SAMPLE[0], T0);
    expect(s.summary().reviews).toBe(0);
  });
});

describe('describeNextDue', () => {
  it('words', () => {
    expect(describeNextDue(T0 - 1, T0)).toBe('now');
    expect(describeNextDue(T0 + 30_000, T0)).toBe('in under a minute');
    expect(describeNextDue(T0 + 60_000, T0)).toBe('in 1 minute');
    expect(describeNextDue(T0 + 3 * 3600_000, T0)).toBe('in 3 hours');
    expect(describeNextDue(T0 + 2 * 86400_000, T0)).toBe('in 2 days');
  });
});
