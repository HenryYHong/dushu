// @vitest-environment jsdom
// Reading time syncs (core/activity.ts, core/sync.ts): each device's day is the record 'l:act:<day>:<device>', sent with whichever
// library is open, and a copy from another device merges into the day here. Under 'l:', so every hub keeps it as it is, and the
// Chinese app live today (tests/fixtures/released) passes it over: it neither takes it nor sends it back.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { actKey, addSeconds, dayOf, deviceId, streak } from '../../src/core/activity';
import { createSyncer, setSyncEnabled, type Syncer } from '../../src/core/sync';
import { exchange, inLang, noCounts, type RecordTable, type StoredRecord } from '../../src/core/syncExchange';
import { openStore } from '../../src/store';
import type { Store } from '../../src/types';
import { createSyncer as releasedSyncer } from '../fixtures/released/sync';

const syncers: { stop(): unknown }[] = [];
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); setSyncEnabled(true); localStorage.clear(); });
let n = 0;
const open = () => openStore(`sync-activity-${++n}-${Math.random().toString(36).slice(2)}`);

function hub() {
  const data = new Map<string, StoredRecord>();
  const h = {
    version: 0, data,
    send(body: string): Promise<Response> {
      const table: RecordTable = {
        epoch: 'hub-1',
        get version() { return h.version; },
        set version(v: number) { h.version = v; },
        get: (k) => data.get(k),
        put: (k, r) => { data.set(k, r); },
        changed: (since, also, lang) => [...data].filter(([k, r]) => inLang(k, lang) && (r.rev > since || also.has(k))).map(([key, r]) => ({ key, at: r.at, data: r.data })),
        counts: () => noCounts(),
      };
      return Promise.resolve(new Response(JSON.stringify(exchange(table, JSON.parse(body), Date.now()).reply), { status: 200, headers: { 'content-type': 'application/json' } }));
    },
  };
  return h;
}
function device(store: Store, to: { send(body: string): Promise<Response> }, released = false): Syncer {
  const s = (released ? releasedSyncer : createSyncer)(store, { send: (body: string) => to.send(body), everyMs: 0 }) as Syncer;
  syncers.push(s);
  return s;
}

describe('reading time between devices', () => {
  it('sends this device’s day, takes another’s, and settles', async () => {
    const h = hub();
    const sa = device(await open(), h);
    const today = dayOf();
    addSeconds('zh', 420, 10);
    await sa.run();
    const mine = h.data.get(actKey(today, deviceId()));
    expect(mine?.data).toMatchObject({ s: { zh: 420 }, g: 10 });

    // Another device read Spanish today and synced through its own library: one streak counts both.
    h.data.set(actKey(today, 'otherdev01'), { at: Date.now(), data: { s: { es: 300 }, g: 10, t: Date.now() }, rev: ++h.version });
    await sa.run();
    expect(streak(10)).toMatchObject({ today: 720, met: true, current: 1 });
    await sa.run();
    expect(sa.status().pending).toBe(0);

    // More time here goes up as the same record, grown.
    addSeconds('zh', 60, 10);
    await sa.run();
    expect(h.data.get(actKey(today, deviceId()))?.data).toMatchObject({ s: { zh: 480 } });
    // A stale copy from the hub never shrinks the day here.
    h.data.set(actKey(today, deviceId()), { at: Date.now() + 1000, data: { s: { zh: 10 }, g: 10, t: 1 }, rev: ++h.version });
    await sa.run();
    expect(streak(10).today).toBe(780);
  });

  it('is passed over by the app live today', async () => {
    const h = hub();
    h.data.set(actKey(dayOf(), 'otherdev01'), { at: Date.now(), data: { s: { zh: 300 }, g: 10, t: Date.now() }, rev: ++h.version });
    const old = await open();
    const so = device(old, h, true);
    await so.run();
    await so.run();
    expect([...h.data.keys()]).toEqual([actKey(dayOf(), 'otherdev01')]);
    expect(await old.lookups.list()).toEqual([]);
  });
});
