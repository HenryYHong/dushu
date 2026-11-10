// @vitest-environment jsdom
// The reading clock (core/readingClock.ts): time counts while the reader does something, or while the book is read aloud by
// any voice, and stops three minutes after the last input when it is not (paused, or stopped).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const aloud = vi.hoisted(() => ({ now: false }));
vi.mock('../../src/speech/tts', () => ({ isReadingAloud: () => aloud.now }));

import { goalMessage, startReadingClock } from '../../src/core/readingClock';
import { ACTIVITY_KEY, streak } from '../../src/core/activity';

const seconds = () => streak(10).today;

beforeEach(() => {
  localStorage.clear();
  aloud.now = false;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 9, 10, 0));
});
afterEach(() => { vi.useRealTimers(); });

describe('the reading clock', () => {
  it('keeps counting with no input while a book is read aloud (the Mac\'s or the account\'s voice too)', () => {
    aloud.now = true;
    const stop = startReadingClock('zh');
    vi.advanceTimersByTime(600_000);
    stop();
    expect(seconds()).toBeGreaterThanOrEqual(590);
  });

  it('stops three minutes after the last input when read-aloud is paused', () => {
    aloud.now = false; // paused: isReadingAloud says no, whichever voice
    const stop = startReadingClock('zh');
    vi.advanceTimersByTime(600_000);
    stop();
    expect(seconds()).toBeGreaterThanOrEqual(175);
    expect(seconds()).toBeLessThanOrEqual(190);
  });

  it('counts again from an input, and stays idle once stopped', () => {
    const stop = startReadingClock('zh');
    vi.advanceTimersByTime(300_000);
    const idle = seconds();
    document.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(60_000);
    stop();
    const after = seconds();
    expect(after - idle).toBeGreaterThanOrEqual(55);
    aloud.now = true;
    vi.advanceTimersByTime(600_000);
    expect(seconds()).toBe(after);
    expect(localStorage.getItem(ACTIVITY_KEY)).toContain('"zh"');
  });

  it('says the goal was reached in the same words wherever it counts', () => {
    expect(goalMessage(1, 10)).toBe('Daily goal reached: 10 minutes. Your streak has started.');
    expect(goalMessage(4, 20)).toBe('Daily goal reached: 20 minutes. That is 4 days in a row.');
  });
});
