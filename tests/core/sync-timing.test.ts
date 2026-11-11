// @vitest-environment jsdom
// When a device syncs (core/sync.ts). Workers Free answers 100,000 requests a day for everyone, so a page left open asks only
// every 3 minutes (IDLE_SYNC_MS), counted from its last sync, and not at all while hidden; what keeps devices in step is the
// sync right after a change, when the page comes back to the front, gets the focus or comes back online. Short waits stand in
// for the 3 minutes (everyMs).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_SYNC_MS, createSyncer, type Syncer } from '../../src/core/sync';
import { openStore } from '../../src/store';

const reply = () => new Response(JSON.stringify({ epoch: 'e1', version: 0, records: [], counts: { words: 0, known: 0, places: 0, lookups: 0, bookmarks: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const setVisible = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

let syncer: Syncer | null = null;
afterEach(async () => {
  await syncer?.stop();
  syncer = null;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.restoreAllMocks();
  localStorage.clear();
});

async function counted(everyMs?: number) {
  const store = await openStore(`timing-${Math.random()}`);
  const c = { sends: 0 };
  syncer = createSyncer(store, { send: () => { c.sends++; return Promise.resolve(reply()); }, ...(everyMs === undefined ? {} : { everyMs }) });
  await syncer.run();
  return c;
}

describe('when a device syncs', () => {
  it('waits 3 minutes after its last sync before it asks again, when nothing happens', async () => {
    expect(IDLE_SYNC_MS).toBe(3 * 60_000);
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const c = await counted();
    expect(c.sends).toBeGreaterThan(0);
    expect(timeout.mock.calls.some(([, ms]) => ms === IDLE_SYNC_MS)).toBe(true);
    // Never the old 45-second clock.
    expect(timeout.mock.calls.some(([, ms]) => ms === 45_000)).toBe(false);
  });

  it('starts the wait again after every sync, so a page in use hardly polls', async () => {
    const c = await counted(500);
    const start = c.sends;
    await sleep(300);
    await syncer!.run(); // a change sent, a screen opened: the idle wait starts over
    const after = c.sends;
    expect(after).toBe(start + 1);
    await sleep(300); // 600 ms since the first sync, 300 since the last: no poll yet
    expect(c.sends).toBe(after);
    await vi.waitFor(() => expect(c.sends).toBe(after + 1), { timeout: 2000, interval: 20 });
  });

  it('lets the poll lapse while the page is hidden, and syncs at once when it comes back', async () => {
    const c = await counted(150);
    setVisible('hidden');
    await vi.waitFor(() => expect(syncer!.status().state).not.toBe('syncing'));
    const hidden = c.sends; // leaving sends what is waiting, once
    await sleep(500);
    expect(c.sends).toBe(hidden);
    setVisible('visible');
    await vi.waitFor(() => expect(c.sends).toBe(hidden + 1), { timeout: 2000, interval: 20 });
  });

  it('syncs when the window gets the focus, and when the connection comes back', async () => {
    const c = await counted(0);
    const start = c.sends;
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(c.sends).toBe(start + 1), { timeout: 2000, interval: 20 });
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(c.sends).toBe(start + 2), { timeout: 2000, interval: 20 });
    // A focus and a page shown together (switching back to the tab) are one sync, not two.
    window.dispatchEvent(new Event('focus'));
    setVisible('visible');
    await vi.waitFor(() => expect(c.sends).toBe(start + 3), { timeout: 2000, interval: 20 });
    await sleep(400);
    expect(c.sends).toBe(start + 3);
  });

  it('stops polling once stopped', async () => {
    const c = await counted(100);
    const n = c.sends;
    await syncer!.stop();
    syncer = null;
    await sleep(300);
    expect(c.sends).toBe(n);
  });
});
