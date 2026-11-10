// @vitest-environment jsdom
// The daily goal syncs (core/plan.ts, core/sync.ts) as 'l:goal', the goal chosen last on any device. A device that never chose
// one (the default, time 0) takes the account's instead of replacing it. Under 'l:', so every hub keeps it as it is, and the
// Chinese app live today (tests/fixtures/released) passes it over.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { getPlan, setPlan } from '../../src/core/plan';
import { createSyncer, setSyncEnabled, type Syncer } from '../../src/core/sync';
import { exchange, inLang, noCounts, type RecordTable, type StoredRecord } from '../../src/core/syncExchange';
import { GOAL_KEY } from '../../src/core/syncKeys';
import { openStore } from '../../src/store';
import type { Store } from '../../src/types';
import { createSyncer as releasedSyncer } from '../fixtures/released/sync';

const syncers: { stop(): unknown }[] = [];
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); setSyncEnabled(true); localStorage.clear(); });
let n = 0;
const open = () => openStore(`sync-goal-${++n}-${Math.random().toString(36).slice(2)}`);

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

describe('the daily goal between devices', () => {
  it('sends a goal chosen here', async () => {
    const h = hub();
    const s = device(await open(), h);
    setPlan({ goal: 20 });
    await s.run();
    expect(h.data.get(GOAL_KEY)?.data).toEqual({ g: 20 });
    expect(h.data.get(GOAL_KEY)?.at).toBe(getPlan().goalAt);
  });

  it('takes the account’s goal on a device that never chose one, and leaves it as it is', async () => {
    const h = hub();
    const chosen = Date.now() - 86_400_000;
    h.data.set(GOAL_KEY, { at: chosen, data: { g: 15 }, rev: ++h.version });
    const s = device(await open(), h);
    expect(getPlan()).toMatchObject({ goal: 10, goalAt: 0 });
    await s.run();
    expect(getPlan()).toMatchObject({ goal: 15, goalAt: chosen });
    expect(h.data.get(GOAL_KEY)).toMatchObject({ at: chosen, data: { g: 15 } });
    await s.run();
    expect(s.status().pending).toBe(0);
  });

  it('keeps the goal chosen last, here or there', async () => {
    const h = hub();
    h.data.set(GOAL_KEY, { at: Date.now() - 3_600_000, data: { g: 5 }, rev: ++h.version });
    const s = device(await open(), h);
    setPlan({ goal: 30 });
    await s.run();
    expect(getPlan().goal).toBe(30);
    expect(h.data.get(GOAL_KEY)?.data).toEqual({ g: 30 });
    // Then another device chooses 5 minutes.
    h.data.set(GOAL_KEY, { at: Date.now() + 1000, data: { g: 5 }, rev: ++h.version });
    await s.run();
    expect(getPlan().goal).toBe(5);
    await s.run();
    expect(h.data.get(GOAL_KEY)?.data).toEqual({ g: 5 });
    expect(s.status().pending).toBe(0);
  });

  it('passes over a goal that is not one of the choices', async () => {
    const h = hub();
    h.data.set(GOAL_KEY, { at: Date.now(), data: { g: 7 }, rev: ++h.version });
    const s = device(await open(), h);
    await s.run();
    expect(getPlan().goal).toBe(10);
  });

  it('is passed over by the app live today', async () => {
    const h = hub();
    h.data.set(GOAL_KEY, { at: Date.now(), data: { g: 20 }, rev: ++h.version });
    const old = await open();
    const so = device(old, h, true);
    await so.run();
    await so.run();
    expect([...h.data.keys()]).toEqual([GOAL_KEY]);
    expect(h.data.get(GOAL_KEY)?.data).toEqual({ g: 20 });
    expect(await old.lookups.list()).toEqual([]);
  });
});
