// @vitest-environment jsdom
// Practice in Looked up is review too: its time counts toward the day's goal while it is open, and leaving the screen closes it
// (so its clock never runs beside the next screen's).
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupRow } from '../../src/types';
import { openPractice } from '../../src/ui/vocab/practice';
import { streak } from '../../src/core/activity';
import { makeCtx, stubBrowser } from '../reader/helpers';

const row = (id: string): LookupRow => ({ day: '2026-11-09', id, word: id, pinyin: '', gloss: `${id} gloss`, count: 1, first: 1, last: 1 });

beforeAll(() => stubBrowser());
beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('practice and the daily goal', () => {
  it('counts the time spent practicing, and stops when it closes', async () => {
    const { ctx } = await makeCtx();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 9, 10, 0));
    openPractice(ctx, [row('书'), row('水')], 'Today');
    for (let i = 0; i < 6; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      vi.advanceTimersByTime(5_000);
    }
    (document.querySelector('.prc-close') as HTMLElement).click();
    const counted = streak(10).today;
    expect(counted).toBeGreaterThanOrEqual(25);
    expect(counted).toBeLessThanOrEqual(35);
    vi.advanceTimersByTime(60_000);
    expect(streak(10).today).toBe(counted);
  });

  it('closes when the screen changes', async () => {
    const { ctx } = await makeCtx();
    openPractice(ctx, [row('书')], 'Today');
    expect(document.querySelector('.prc-overlay')).not.toBeNull();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(document.querySelector('.prc-overlay')).toBeNull();
  });

  it('says the goal is reached, as reading does', async () => {
    const { ctx, toasts } = await makeCtx();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 9, 10, 0));
    openPractice(ctx, [row('书'), row('水')], 'Today');
    for (let i = 0; i < 25; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
      vi.advanceTimersByTime(30_000);
    }
    (document.querySelector('.prc-close') as HTMLElement).click();
    expect(toasts).toContain('Daily goal reached: 10 minutes. Your streak has started.');
  });
});
