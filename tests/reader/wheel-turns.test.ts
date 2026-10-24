// One page turn per trackpad swipe. The swipes here have the shape of recorded macOS ones: about 8 ms between events in
// Safari (16 ms in Chrome, with jitter) while the fingers move, a short gap when they lift, then coasting at 16 ms with
// deltas twice those of the finger events (twice the time between them) that fade by a few per cent a frame.
import { describe, expect, it } from 'vitest';
import { createWheelTurns, type WheelInput } from '../../src/ui/reader/wheelTurns';

interface Swipe {
  /** Deltas while the fingers move. */
  finger: number[];
  /** Milliseconds between finger events (a list repeats). */
  every?: number[];
  /** First coasting delta, and how much of it is left each frame. */
  coast?: number;
  fade?: number;
}

/** Events of a swipe starting at `t0`, along x (or y), signed by `dir`. */
function swipe(s: Swipe, t0 = 0, dir = 1, axis: 'x' | 'y' = 'x'): WheelInput[] {
  const out: WheelInput[] = [];
  const every = s.every ?? [8];
  let t = t0;
  const push = (d: number) => out.push({ deltaX: axis === 'x' ? dir * d : 0, deltaY: axis === 'y' ? dir * d : 0, deltaMode: 0, timeStamp: t });
  s.finger.forEach((d, i) => { if (i) t += every[i % every.length]; push(d); });
  if (s.coast) {
    t += 25;
    for (let d = s.coast; d >= 1; d *= s.fade ?? 0.94) { push(Math.round(d)); t += 16.7; }
  }
  return out;
}

const until = (ev: WheelInput[], t: number) => ev.filter((e) => e.timeStamp < t);
const end = (ev: WheelInput[]) => ev[ev.length - 1].timeStamp;

function turns(ev: WheelInput[]): number[] {
  const w = createWheelTurns();
  const out: number[] = [];
  for (const e of ev) { const r = w.feed(e); if (r) out.push(r); }
  return out;
}

/** The page is busy for `ms` after each turn: the events in that time reach it as one, their deltas added up. */
function turnsWhenBusy(ev: WheelInput[], ms: number): number[] {
  const w = createWheelTurns();
  const out: number[] = [];
  let busyUntil = -Infinity;
  let held: WheelInput | null = null;
  const feed = (e: WheelInput) => { const r = w.feed(e); if (r) { out.push(r); busyUntil = e.timeStamp + ms; } };
  for (const e of ev) {
    if (e.timeStamp < busyUntil) { held = held ? { ...e, deltaX: held.deltaX + e.deltaX, deltaY: held.deltaY + e.deltaY } : { ...e }; continue; }
    if (held) { feed(held); held = null; }
    feed(e);
  }
  if (held) feed(held);
  return out;
}

// Safari, a normal swipe: the coasting starts with deltas about twice the last finger ones.
const safari: Swipe = { finger: [3, 6, 8, 11, 12, 14, 24, 29, 41, 49, 55, 72, 54, 79, 58], coast: 150 };
// Chrome: events 8 to 25 ms apart.
const chrome: Swipe = { finger: [1, 4, 5, 13, 25, 39, 24, 52, 56], every: [8, 8, 15, 17, 15, 8, 25, 16], coast: 83 };
// A slow drag: the finger's speed wobbles from one event to the next.
const drag: Swipe = { finger: [1, 2, 2, 3, 4, 5, 5, 6, 6, 9, 4, 7, 7, 11, 6, 10, 9, 13, 8, 12, 11, 9, 13, 10, 15, 12, 17, 8, 17, 12, 10, 13, 7, 16, 11, 12, 7, 15, 8, 9, 5, 8, 6, 7, 5, 4, 6, 3, 5, 3, 4, 2, 2, 1] };

describe('wheel turns', () => {
  it('turns once for one swipe, its coasting included', () => {
    expect(turns(swipe(safari))).toEqual([1]);
    expect(turns(swipe(chrome))).toEqual([1]);
    expect(turns(swipe(drag))).toEqual([1]);
    expect(turns(swipe(safari, 0, -1))).toEqual([-1]);
    expect(turns(swipe(safari, 0, 1, 'y'))).toEqual([1]);
  });

  it('turns once when a busy page gets the events of the swipe folded together', () => {
    for (const ms of [50, 120, 300]) {
      expect(turnsWhenBusy(swipe(safari), ms)).toEqual([1]);
      expect(turnsWhenBusy(swipe(chrome), ms)).toEqual([1]);
    }
  });

  it('turns again for a second swipe that lands while the first one still coasts', () => {
    const first = swipe(safari);
    const lift = first.find((e) => e.deltaX === 150)!.timeStamp;
    for (const after of [60, 150, 400, 800]) {
      const cut = lift + after;
      const ev = [...until(first, cut), ...swipe(safari, cut + 12)];
      expect(turns(ev), `${after} ms after the lift`).toEqual([1, 1]);
      expect(turns([...until(first, cut), ...swipe(chrome, cut + 12)]), `${after} ms after the lift, Chrome`).toEqual([1, 1]);
    }
  });

  it('turns back for a swipe the other way, however fast the first one still coasts', () => {
    const first = swipe(chrome, 0, 1, 'x');
    const cut = 200;
    expect(turns([...until(first, cut), ...swipe(chrome, cut + 12, -1)])).toEqual([1, -1]);
  });

  it('turns again for a swipe after a pause', () => {
    const first = swipe(safari);
    expect(turns([...first, ...swipe(safari, end(first) + 300)])).toEqual([1, 1]);
  });

  it('turns once per notch of a mouse wheel with a pause between, once for a quick spin', () => {
    const notch = (t: number, d = 100): WheelInput => ({ deltaX: 0, deltaY: d, deltaMode: 0, timeStamp: t });
    expect(turns([notch(0), notch(400), notch(800)])).toEqual([1, 1, 1]);
    expect(turns([notch(0), notch(60), notch(120), notch(180)])).toEqual([1]);
    expect(turns([notch(0), notch(400, -100)])).toEqual([1, -1]);
  });

  it('turns once per notch of a wheel that counts in lines or pages (Firefox), however few lines a notch is', () => {
    const notch = (t: number, lines = 3): WheelInput => ({ deltaX: 0, deltaY: lines, deltaMode: 1, timeStamp: t });
    expect(turns([notch(0)])).toEqual([1]); // 3 lines: 48 px, less than an up-and-down swipe needs
    expect(turns([notch(0, 1)])).toEqual([1]);
    expect(turns([notch(0), notch(400), notch(800, -3)])).toEqual([1, 1, -1]);
    expect(turns([notch(0), notch(60), notch(120), notch(180)])).toEqual([1]); // a quick spin
    expect(turns([{ deltaX: 0, deltaY: 1, deltaMode: 2, timeStamp: 0 }])).toEqual([1]);
  });

  it('turns again for a slow new swipe that stops the coasting dead', () => {
    const first = swipe(safari);
    const lift = first.find((e) => e.deltaX === 150)!.timeStamp;
    // Short new swipes with no coasting of their own: slow and steady, 4 px a frame, or one that gets going quickly.
    const slow: Swipe = { finger: Array(30).fill(4) };
    const brisk: Swipe = { finger: [5, 10, 20, 30, 40, 50, 60] };
    for (const after of [30, 100, 300]) {
      const head = until(first, lift + after);
      const t = end(head);
      // The fingers land: the coasting stops with a near-zero event, then the new swipe.
      const stop: WheelInput = { deltaX: 0, deltaY: 0, deltaMode: 0, timeStamp: t + 16 };
      expect(turns([...head, stop, ...swipe(slow, t + 30)]), `${after} ms after the lift`).toEqual([1, 1]);
      expect(turns([...head, stop, ...swipe(brisk, t + 30)]), `${after} ms after the lift, brisk`).toEqual([1, 1]);
    }
  });

  it('a pixel or two back is a wobble, not a swipe back; a reversal in small steps turns back once it has gone far enough', () => {
    // A slow drag that wobbles back by 2 px after it has turned the page, then goes on: still one swipe.
    const ev = swipe(drag);
    const at = 31; // well after the turn (about 40 px in, at event 10)
    const wobble: WheelInput = { ...ev[at], deltaX: -2, timeStamp: ev[at].timeStamp - 4 };
    expect(turns([...ev.slice(0, at), wobble, ...ev.slice(at)])).toEqual([1]);
    // A swipe back in 5 px steps while the first one still coasts: back once it has moved TURN_X, not before.
    const first = swipe(safari);
    const head = until(first, first.find((e) => e.deltaX === 150)!.timeStamp + 200);
    const back = (n: number) => Array.from({ length: n }, (_, i): WheelInput => ({ deltaX: -5, deltaY: 0, deltaMode: 0, timeStamp: end(head) + 16 + 8 * i }));
    expect(turns([...head, ...back(10)])).toEqual([1, -1]);
    expect(turns([...head, ...back(7)])).toEqual([1]);
  });

  it('needs more travel up and down than across', () => {
    const steps = (n: number, axis: 'x' | 'y') => swipe({ finger: Array(n).fill(10) }, 0, 1, axis);
    expect(turns(steps(5, 'y'))).toEqual([]); // 50 px up and down
    expect(turns(steps(5, 'x'))).toEqual([1]); // 50 px across
    expect(turns(steps(8, 'y'))).toEqual([1]);
  });

  it('stays one swipe when a busy page gets 400 ms of its events folded into one', () => {
    expect(turnsWhenBusy(swipe(safari), 400)).toEqual([1]);
    expect(turnsWhenBusy(swipe(chrome), 400)).toEqual([1]);
    expect(turnsWhenBusy(swipe(safari, 0, -1), 400)).toEqual([-1]);
  });
});
