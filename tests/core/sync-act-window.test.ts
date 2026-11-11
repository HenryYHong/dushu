// @vitest-environment jsdom
// A day's reading time is sent while it is within SYNC_DAYS of this device's date (core/activity.ts), and each device counts
// days on its own calendar. Two devices a day apart (Shanghai and Los Angeles) used to pass the same record back and forth at the
// edge: the one ahead deleted it, the one behind still listed it and sent it again. The deletion now waits two days past the
// window (core/sync.ts), so it goes out once, when every device has let the day go.
import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_KEY, actKey, addSeconds, dayOf, deviceId } from '../../src/core/activity';
import { IDLE_SYNC_MS, createSyncer } from '../../src/core/sync';
import { exchange, inLang, noCounts, type RecordTable, type StoredRecord } from '../../src/core/syncExchange';
import { openStore } from '../../src/store';
import type { Store } from '../../src/types';

const TZ = process.env.TZ;
afterAll(() => {
  vi.useRealTimers();
  if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ;
  localStorage.clear();
});

/** A hub in memory that counts the reading-time records sent to it, and which were deletions. */
function hub() {
  const data = new Map<string, StoredRecord>();
  const h = {
    version: 0, data, sent: [] as ('record' | 'deleted')[],
    send(body: string): Promise<Response> {
      const req = JSON.parse(body) as { changes: { key: string; data: unknown }[] };
      for (const c of req.changes) if (c.key.startsWith('l:act:')) h.sent.push(c.data === null ? 'deleted' : 'record');
      const table: RecordTable = {
        epoch: 'hub-1',
        get version() { return h.version; },
        set version(v: number) { h.version = v; },
        get: (k) => data.get(k),
        put: (k, r) => { data.set(k, r); },
        changed: (since, also, lang) => [...data].filter(([k, r]) => inLang(k, lang) && (r.rev > since || also.has(k))).map(([key, r]) => ({ key, at: r.at, data: r.data })),
        counts: () => noCounts(),
      };
      return Promise.resolve(new Response(JSON.stringify(exchange(table, req, Date.now()).reply), { status: 200, headers: { 'content-type': 'application/json' } }));
    },
  };
  return h;
}

/** A device: its time zone, its store, and its own reading-time blob (each device has its own localStorage). */
interface Device { tz: string; store: Store; blob: string | null }
async function on<T>(d: Device, fn: () => Promise<T> | T): Promise<T> {
  process.env.TZ = d.tz;
  localStorage.clear();
  if (d.blob) localStorage.setItem(ACTIVITY_KEY, d.blob);
  try { return await fn(); } finally { d.blob = localStorage.getItem(ACTIVITY_KEY); }
}
async function sync(d: Device, h: ReturnType<typeof hub>): Promise<void> {
  await on(d, async () => {
    const s = createSyncer(d.store, { send: (b) => h.send(b), everyMs: 0 });
    await s.run();
    await s.stop();
  });
}

let n = 0;
async function setup(tzB: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  const h = hub();
  const a: Device = { tz: 'Asia/Shanghai', store: await openStore(`act-window-a-${++n}`), blob: null };
  const b: Device = { tz: tzB, store: await openStore(`act-window-b-${n}`), blob: null };
  // 2026-09-10 08:00Z: 16:00 in Shanghai and 01:00 in Los Angeles, the same date in both.
  vi.setSystemTime(new Date('2026-09-10T08:00:00Z'));
  const id = await on(a, () => { addSeconds('zh', 600, 10); return deviceId(); });
  expect(await on(a, () => dayOf())).toBe('2026-09-10');
  expect(await on(b, () => dayOf())).toBe('2026-09-10');
  await sync(a, h); await sync(b, h); await sync(a, h);
  const key = actKey('2026-09-10', id);
  expect(h.data.get(key)?.data).not.toBeNull();
  /** Both devices sync in turn, an idle poll apart (IDLE_SYNC_MS), from `iso` on; what was sent and what the hub holds after. */
  const rounds = async (iso: string, count = 6) => {
    let t = new Date(iso).getTime();
    h.sent.length = 0;
    for (let i = 0; i < count; i++) {
      vi.setSystemTime(t += IDLE_SYNC_MS); await sync(a, h);
      vi.setSystemTime(t += IDLE_SYNC_MS); await sync(b, h);
    }
    const r = h.data.get(key);
    return { sent: [...h.sent], hub: r ? (r.data === null ? 'deleted' : 'record') : 'absent' };
  };
  return { a, b, rounds };
}

describe('a day of reading time at the edge of the sync window', () => {
  it('is deleted once, not passed back and forth, between Shanghai and Los Angeles', async () => {
    const { a, b, rounds } = await setup('America/Los_Angeles');
    // 2026-11-09 20:00Z: Nov 10 in Shanghai (61 days on), Nov 9 in Los Angeles (60 days on, still sending it).
    expect(await on(a, () => dayOf(new Date('2026-11-09T20:00:00Z').getTime()))).toBe('2026-11-10');
    expect(await on(b, () => dayOf(new Date('2026-11-09T20:00:00Z').getTime()))).toBe('2026-11-09');
    expect(await rounds('2026-11-09T20:00:00Z')).toEqual({ sent: [], hub: 'record' });
    // Two days on, Shanghai lets it go: one deletion, which Los Angeles (past its own window by then) takes and keeps.
    expect(await rounds('2026-11-11T20:00:00Z')).toEqual({ sent: ['deleted'], hub: 'deleted' });
    expect(await rounds('2026-11-12T20:00:00Z')).toEqual({ sent: [], hub: 'deleted' });
    // Neither device lost the day: it stays in each one's calendar.
    for (const d of [a, b]) expect(JSON.parse(d.blob ?? '{}').days?.['2026-09-10']).toBeDefined();
  });

  it('settles the same way for two devices on the same calendar', async () => {
    const { rounds } = await setup('Asia/Shanghai');
    expect(await rounds('2026-11-09T20:00:00Z')).toEqual({ sent: [], hub: 'record' });
    // Both let the day go at once and each sends its deletion before hearing of the other's; then nothing more.
    const gone = await rounds('2026-11-11T20:00:00Z');
    expect(gone.hub).toBe('deleted');
    expect(gone.sent.every((x) => x === 'deleted')).toBe(true);
    expect(gone.sent.length).toBeLessThanOrEqual(2);
    expect(await rounds('2026-11-12T20:00:00Z')).toEqual({ sent: [], hub: 'deleted' });
  });
});
