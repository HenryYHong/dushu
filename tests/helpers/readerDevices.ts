// Devices for the tests of the reader's records (reading time and the daily goal) between libraries: tests/core/sync-reader.test.ts
// and tests/cloud/sync-reader.test.ts. Each device has its own localStorage, where the time, the goal and its id live, swapped in
// while it does anything, and a library per language with its own store and syncer. Run them under fake timers, so a syncer's
// own timer never runs one device while another one's storage is in place.
import { vi } from 'vitest';
import { addSeconds, deviceId, streak } from '../../src/core/activity';
import { getPlan, setPlan } from '../../src/core/plan';
import { createSyncer, type Syncer } from '../../src/core/sync';
import { openStore } from '../../src/store';
import type { LangId } from '../../src/lang/types';
import type { Store } from '../../src/types';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); },
  };
}

export type Answer = (input: Record<string, unknown>) => unknown;
export interface Logged { lang: string; changes: { key: string; data: unknown }[]; records: { key: string; data: unknown }[] }

/** A hub as the devices reach it: `answer` is swapped to update it (or roll it back) between two syncs; `log` holds each request. */
export function hub(answer: Answer) {
  const h = {
    answer,
    log: [] as Logged[],
    async send(body: string): Promise<Response> {
      const input = JSON.parse(body) as Record<string, unknown>;
      const reply = await h.answer(input) as { records: Logged['records'] };
      h.log.push({ lang: typeof input.lang === 'string' ? input.lang : '', changes: input.changes as Logged['changes'], records: reply.records });
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  return h;
}
export type Hub = ReturnType<typeof hub>;

const syncers: Syncer[] = [];
/** Stops every device's syncers (afterEach). */
export function stopDevices(): void { for (const s of syncers.splice(0)) void s.stop(); }

let n = 0;
/** One device: its own localStorage and a library per language, each syncing with `to`, made by `make` (today's app or a frozen one). */
export function device(to: Hub, make: typeof createSyncer = createSyncer) {
  const ls = memStorage();
  const libs = new Map<LangId, { store: Store; syncer: Syncer }>();
  const here = () => vi.stubGlobal('localStorage', ls);
  const d = {
    libs,
    get id() { here(); return deviceId(); },
    async open(lang: LangId) {
      here();
      const store = await openStore(`reader-${lang}-${++n}-${Math.random().toString(36).slice(2)}`);
      here();
      const syncer = make(store, { send: (body: string) => to.send(body), everyMs: 0, lang });
      syncers.push(syncer);
      libs.set(lang, { store, syncer });
      await syncer.run();
      return d;
    },
    async sync(lang: LangId) { here(); await libs.get(lang)!.syncer.run(); },
    read(lang: LangId, seconds: number) { here(); addSeconds(lang, seconds, getPlan().goal); },
    choose(goal: number) { here(); setPlan({ goal }); },
    status: (lang: LangId) => libs.get(lang)!.syncer.status(),
    /** The streak this device shows, by the goal in force here: the numbers every device should agree on. */
    shown() {
      here();
      const goal = getPlan().goal;
      const s = streak(goal);
      return { today: s.today, goal, met: s.met, current: s.current };
    },
  };
  return d;
}
export type Device = ReturnType<typeof device>;
