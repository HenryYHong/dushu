// @vitest-environment jsdom
// Opening a book: it waits for a quick sync only when the device has not synced a moment ago, and never long. A place that
// arrives later is offered by the reader (REMOTE_PROGRESS_EVENT).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSyncer, startSync, syncBeforeOpen } from '../../src/core/sync';
import { openStore } from '../../src/store';

const reply = () => new Response(JSON.stringify({ epoch: 'e1', version: 0, records: [], counts: { words: 0, known: 0, places: 0, lookups: 0, bookmarks: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => { currentSyncer()?.stop(); vi.useRealTimers(); localStorage.clear(); });

describe('before a book opens', () => {
  it('does not wait when it synced a moment ago, and waits at most a little when it did not', async () => {
    let sends = 0;
    let delay = 0;
    const store = await openStore(`open-${Math.random()}`);
    const s = startSync(store, { everyMs: 0, send: () => { sends++; return new Promise((r) => setTimeout(() => r(reply()), delay)); } });
    await s.run();
    expect(s.status().state).toBe('idle');
    const before = sends;
    // Just synced: the book opens at once, without asking again.
    let t = performance.now();
    await syncBeforeOpen();
    expect(performance.now() - t).toBeLessThan(50);
    expect(sends).toBe(before);
    // Half a minute later, with a slow connection: it asks, but opens the book after 0.6 s whatever happens.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 30_000);
    delay = 5000;
    t = performance.now();
    await syncBeforeOpen();
    const waited = performance.now() - t;
    expect(sends).toBe(before + 1);
    expect(waited).toBeGreaterThan(500);
    expect(waited).toBeLessThan(1200);
  });
});
