// @vitest-environment jsdom
// The library's walkthrough on a first visit waits for the dictionary (its parse takes the page in long slices for a few
// seconds) and then for a quiet moment, so its first glides have the page to themselves. It starts anyway after DICT_WAIT_MS or
// when the download fails, at once when the dictionary is already read (Settings showing it again), and never after the library
// is gone. Timers are faked; no layout is measured.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { maybeSiteGuide, DICT_WAIT_MS, IDLE_WAIT_MS } from '../../src/ui/siteGuide';
import { SITE_GUIDE_KEY } from '../../src/ui/guide';
import type { Dictionary } from '../../src/types';

type Idle = (cb: () => void, o?: { timeout: number }) => number;
const win = window as unknown as { requestIdleCallback?: Idle };
const shown = () => !!document.querySelector('.rd-guide-card');

/** A dictionary still on its way (or already read, with `ready`), settled by hand. */
function dictionary(ready = false) {
  let settle: (ok: boolean) => void = () => {};
  const loading = new Promise<Dictionary>((resolve, reject) => { settle = (ok) => (ok ? resolve({} as Dictionary) : reject(new Error('offline'))); });
  loading.catch(() => {});
  const ctx = { dict: vi.fn(() => loading), dictSync: vi.fn(() => (ready ? ({} as Dictionary) : null)) };
  return { ctx, settle };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem(SITE_GUIDE_KEY, 'due');
});
afterEach(() => {
  vi.useRealTimers();
  delete win.requestIdleCallback;
  document.body.replaceChildren();
  localStorage.clear();
});

describe('the library walkthrough on a first visit', () => {
  it('waits for the dictionary, then for a quiet moment', async () => {
    const { ctx, settle } = dictionary();
    const stop = maybeSiteGuide(ctx);
    await vi.advanceTimersByTimeAsync(DICT_WAIT_MS - 1000);
    expect(shown()).toBe(false);
    settle(true);
    await vi.advanceTimersByTimeAsync(0);
    // Read, but the work that follows it goes first (no idle callbacks here: a short moment).
    expect(shown()).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(shown()).toBe(true);
    expect(ctx.dict).toHaveBeenCalledTimes(1);
    stop();
  });

  it('starts at the first idle moment after the dictionary where the browser has idle callbacks', async () => {
    const idle: (() => void)[] = [];
    win.requestIdleCallback = vi.fn<Idle>((cb) => { idle.push(cb); return idle.length; });
    const { ctx, settle } = dictionary();
    const stop = maybeSiteGuide(ctx);
    settle(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(win.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: IDLE_WAIT_MS });
    expect(shown()).toBe(false);
    idle[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toBe(true);
    stop();
  });

  it('starts anyway when the dictionary takes too long, or cannot be downloaded', async () => {
    const slow = dictionary();
    const stopSlow = maybeSiteGuide(slow.ctx);
    await vi.advanceTimersByTimeAsync(DICT_WAIT_MS - 1);
    expect(shown()).toBe(false);
    await vi.advanceTimersByTimeAsync(1 + 300);
    expect(shown()).toBe(true);
    stopSlow();
    expect(shown()).toBe(false);

    const failed = dictionary();
    const stopFailed = maybeSiteGuide(failed.ctx);
    failed.settle(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(shown()).toBe(true);
    stopFailed();
  });

  it('starts at once when the dictionary is already read, and asks for it only when the walkthrough is due', () => {
    const read = dictionary(true);
    const stop = maybeSiteGuide(read.ctx);
    expect(shown()).toBe(true);
    expect(read.ctx.dict).not.toHaveBeenCalled();
    stop();

    localStorage.setItem(SITE_GUIDE_KEY, 'done');
    const offline = dictionary();
    maybeSiteGuide(offline.ctx)();
    expect(offline.ctx.dict).not.toHaveBeenCalled();
  });

  it('never shows once the library is gone, and stays due for next time', async () => {
    const { ctx, settle } = dictionary();
    const stop = maybeSiteGuide(ctx);
    stop();
    settle(true);
    await vi.advanceTimersByTimeAsync(DICT_WAIT_MS + IDLE_WAIT_MS);
    expect(shown()).toBe(false);
    expect(localStorage.getItem(SITE_GUIDE_KEY)).toBe('due');
  });
});
