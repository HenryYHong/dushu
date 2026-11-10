// @vitest-environment jsdom
// The reader's records (reading time 'l:act:<day>:<device>' and the daily goal 'l:goal') are one record each on a hub, whichever
// library sends them (syncExchange.ts, isReaderKey): a device that reads only Japanese and one that reads only Spanish share one
// streak and one goal. The app sends them as it always did, under its library's prefix; the hub keeps them under the Chinese key
// and gives them to every library under its own. So the app from before needs nothing new (its sync is today's: the tests of
// today's app on an updated hub are the old app's), a hub from before (the Mac not yet restarted, tests/fixtures/languages) keeps
// a copy per library as it did, and the first request the updated one answers folds them into one. Each device here has its own
// localStorage (the time and the goal live there), swapped in while it syncs, and fake timers keep the syncers' own timers from
// running a device while another one's storage is in place.
import 'fake-indexeddb/auto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYNC_DAYS, actKey, addDays, dayOf } from '../../src/core/activity';
import { createSyncer } from '../../src/core/sync';
import { GOAL_KEY } from '../../src/core/syncKeys';
import { createSyncStore, type SyncState } from '../../scripts/sync-bridge';
import { createSyncer as releasedSyncer } from '../fixtures/released/sync';
import { countRecord as oldCount, exchange as oldExchange, inLang as oldInLang, noCounts as oldNoCounts } from '../fixtures/languages/syncExchange';
import { device, hub, stopDevices, type Answer } from '../helpers/readerDevices';

const dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'dushu-sync-reader-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); });
afterEach(() => {
  stopDevices();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The Mac's server from before (tests/fixtures/languages): that merge, over the same state.json the updated one keeps. */
function oldMac(dir: string): Answer {
  const file = join(dir, 'state.json');
  return (input) => {
    let s: SyncState;
    try { s = JSON.parse(readFileSync(file, 'utf8')) as SyncState; } catch { s = { epoch: 'mac-1', version: 0, records: {} }; }
    const table = {
      epoch: s.epoch,
      get version() { return s.version; },
      set version(v: number) { s.version = v; },
      get: (k: string) => s.records[k],
      put: (k: string, r: SyncState['records'][string]) => { s.records[k] = r; },
      changed: (since: number, also: Set<string>, lang: string) => Object.entries(s.records).filter(([k, r]) => oldInLang(k, lang) && (r.rev > since || also.has(k))).map(([key, r]) => ({ key, at: r.at, data: r.data })),
      counts: (lang: string) => { const c = oldNoCounts(); for (const [k, r] of Object.entries(s.records)) if (oldInLang(k, lang)) oldCount(c, k, r.data); return c; },
    };
    const { reply, changed } = oldExchange(table, input, Date.now());
    if (changed) {
      // As that server saves: the whole object, so a field it does not know (`reader`) is kept as it is.
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${file}.old`, JSON.stringify(s));
      renameSync(`${file}.old`, file);
    }
    return reply;
  };
}
const newMac = (dir: string): Answer => { const mac = createSyncStore({ dir }); return (input) => mac.exchange(input); };
const state = (dir: string) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as SyncState;

describe('two devices on different libraries, through the Mac, with the app as it was', () => {
  it('share one streak and one goal, kept once on the Mac, and settle', async () => {
    const dir = tempDir();
    const mac = hub(newMac(dir));
    const ja = await device(mac).open('ja');
    const es = await device(mac).open('es');
    ja.read('ja', 500);
    ja.choose(15);
    await ja.sync('ja');
    es.read('es', 400);
    await es.sync('es');
    await ja.sync('ja');
    const today = dayOf();
    expect(es.shown()).toEqual({ today: 900, goal: 15, met: true, current: 1 });
    expect(ja.shown()).toEqual(es.shown());
    // One record each, under the Chinese key, whichever library sent it.
    const kept = Object.keys(state(dir).records).sort();
    expect(kept).toEqual([GOAL_KEY, actKey(today, es.id), actKey(today, ja.id)].sort());
    // Each library sent and got them under its own prefix, as the app always has.
    for (const x of mac.log) {
      expect([...x.changes, ...x.records].every((r) => r.key.startsWith(`@${x.lang}:`))).toBe(true);
    }
    // The Spanish device's own day now carries the goal it took (15 minutes), which goes with its next sync; then nothing more
    // is sent or written.
    await es.sync('es');
    await ja.sync('ja');
    const version = state(dir).version;
    await es.sync('es');
    await ja.sync('ja');
    expect(mac.log.slice(-2).map((x) => x.changes.length)).toEqual([0, 0]);
    expect(state(dir).version).toBe(version);
    expect([ja.status('ja'), es.status('es')].map((s) => [s.state, s.pending])).toEqual([['idle', 0], ['idle', 0]]);
  });
});

describe('a device that opens two libraries', () => {
  it('makes one record of its day, settles in both, and lets an old day go once', async () => {
    const dir = tempDir();
    const mac = hub(newMac(dir));
    const two = await device(mac).open('ja');
    await two.open('es');
    const zh = await device(mac).open('zh');
    two.read('ja', 300);
    await two.sync('ja');
    two.read('es', 300);
    await two.sync('es');
    await two.sync('ja');
    await zh.sync('zh');
    const today = dayOf();
    expect(state(dir).records[actKey(today, two.id)]?.data).toMatchObject({ s: { ja: 300, es: 300 } });
    expect(Object.keys(state(dir).records).filter((k) => k.startsWith('@'))).toEqual([]);
    expect(zh.shown()).toMatchObject({ today: 600 });
    for (let i = 0; i < 2; i++) for (const lang of ['ja', 'es'] as const) await two.sync(lang);
    const version = state(dir).version;
    for (const lang of ['ja', 'es'] as const) await two.sync(lang);
    await zh.sync('zh');
    expect(state(dir).version).toBe(version);
    expect([two.status('ja').pending, two.status('es').pending, zh.status('zh').pending]).toEqual([0, 0, 0]);

    // A day past the window, from a device long gone: both libraries take it, one lets it go, and it stays gone.
    const old = actKey(addDays(today, -(SYNC_DAYS + 5)), 'gone0001');
    createSyncStore({ dir }).exchange({ changes: [{ key: old, at: Date.now() - 1000, data: { s: { ja: 900 }, g: 10, t: 1 } }] });
    await two.sync('ja');
    await two.sync('es');
    expect(state(dir).records[old]?.data).not.toBeNull();
    for (let i = 0; i < 3; i++) { await two.sync('ja'); await two.sync('es'); await zh.sync('zh'); }
    expect(state(dir).records[old]?.data).toBeNull();
    const after = state(dir).version;
    for (let i = 0; i < 2; i++) { await two.sync('ja'); await two.sync('es'); await zh.sync('zh'); }
    expect(state(dir).version).toBe(after);
    expect(state(dir).records[old]?.data).toBeNull();
    expect([two.status('ja').pending, two.status('es').pending, zh.status('zh').pending]).toEqual([0, 0, 0]);
  });
});

describe('a Mac not yet restarted, then restarted, then started from an older checkout again', () => {
  it('keeps a copy per library while it is from before, loses none of them, and makes them one once updated', async () => {
    const dir = tempDir();
    const mac = hub(oldMac(dir));
    const zh = await device(mac).open('zh');
    const ja = await device(mac).open('ja');
    const es = await device(mac).open('es');
    zh.read('zh', 300);
    zh.choose(20);
    await zh.sync('zh');
    ja.read('ja', 400);
    await ja.sync('ja');
    es.read('es', 200);
    await es.sync('es');
    // Chosen later on the Japanese device: on this Mac it reaches only Japanese libraries.
    ja.choose(15);
    for (const [d, lang] of [[zh, 'zh'], [ja, 'ja'], [es, 'es']] as const) await d.sync(lang);
    // As before: each library sees only its own, and nothing waits or loops.
    expect([zh, ja, es].map((d) => d.shown().today)).toEqual([300, 400, 200]);
    expect([zh, ja, es].map((d) => d.shown().goal)).toEqual([20, 15, 10]);
    expect([zh.status('zh'), ja.status('ja'), es.status('es')].map((s) => [s.state, s.pending])).toEqual([['idle', 0], ['idle', 0], ['idle', 0]]);
    const today = dayOf();
    expect(Object.keys(state(dir).records).sort()).toEqual([`@es:${actKey(today, es.id)}`, `@ja:${GOAL_KEY}`, `@ja:${actKey(today, ja.id)}`, GOAL_KEY, actKey(today, zh.id)].sort());
    const sentBefore = mac.log.flatMap((x) => x.changes.map((c) => c.key)).sort();

    // Restarted: the first request folds the copies into one record each, and every library gets all of them.
    mac.answer = newMac(dir);
    for (const [d, lang] of [[es, 'es'], [ja, 'ja'], [zh, 'zh']] as const) await d.sync(lang);
    for (const d of [zh, ja, es]) expect(d.shown()).toEqual({ today: 900, goal: 15, met: true, current: 1 });
    expect(state(dir).records[GOAL_KEY]?.data).toEqual({ g: 15 });
    expect(state(dir).reader).toBe(state(dir).version);
    // The app sent nothing new: the same keys, each under its library's prefix.
    expect(mac.log.flatMap((x) => x.changes.map((c) => c.key)).every((k) => sentBefore.includes(k) || /^(@(ja|es):)?l:act:/.test(k))).toBe(true);
    // The days that took the new goal go up once more with it; then nothing moves.
    for (const [d, lang] of [[es, 'es'], [ja, 'ja'], [zh, 'zh']] as const) await d.sync(lang);
    const version = state(dir).version;
    for (const [d, lang] of [[es, 'es'], [ja, 'ja'], [zh, 'zh']] as const) await d.sync(lang);
    expect(state(dir).version).toBe(version);
    expect([zh.status('zh'), ja.status('ja'), es.status('es')].map((s) => s.pending)).toEqual([0, 0, 0]);

    // Started from an older checkout on the same folder: the Japanese device's time goes into a copy of its own again, and the
    // next request the updated server answers folds it in.
    mac.answer = oldMac(dir);
    ja.read('ja', 100);
    await ja.sync('ja');
    expect(state(dir).records[`@ja:${actKey(today, ja.id)}`]?.data).toMatchObject({ s: { ja: 500 } });
    // A Spanish device that first syncs meanwhile gets only what that server gives Spanish, and its cursor moves past the rest.
    const late = await device(mac).open('es');
    expect(late.shown().today).toBe(200);
    mac.answer = newMac(dir);
    await es.sync('es');
    await zh.sync('zh');
    await late.sync('es');
    expect([es.shown().today, zh.shown().today, late.shown().today]).toEqual([1000, 1000, 1000]);
    await ja.sync('ja');
    expect(ja.shown().today).toBe(1000);
  });
});

describe('the Chinese app live before languages (tests/fixtures/released), on an updated Mac', () => {
  it('passes the reader’s records over, whichever library sent them, and syncs its words as ever', async () => {
    const dir = tempDir();
    const mac = hub(newMac(dir));
    const ja = await device(mac).open('ja');
    ja.read('ja', 400);
    ja.choose(20);
    await ja.sync('ja');
    const old = await device(mac, releasedSyncer as typeof createSyncer).open('zh');
    const other = await device(mac, releasedSyncer as typeof createSyncer).open('zh');
    const store = old.libs.get('zh')!.store;
    await store.known.add(['老师']);
    await old.sync('zh');
    await old.sync('zh');
    await other.sync('zh');
    expect(other.libs.get('zh')!.store.known.all()).toEqual(['老师']);
    // It got the Japanese reader's day and goal (they are Chinese keys now) and took neither: no lookups, nothing sent back.
    expect(mac.log.filter((x) => !x.lang).flatMap((x) => x.records.map((r) => r.key))).toEqual(expect.arrayContaining([GOAL_KEY, actKey(dayOf(), ja.id)]));
    expect(await store.lookups.list()).toEqual([]);
    expect(mac.log.filter((x) => !x.lang).flatMap((x) => x.changes.map((c) => c.key))).toEqual(['k:老师']);
    expect(old.status('zh')).toMatchObject({ state: 'idle', pending: 0 });
    expect(state(dir).records[GOAL_KEY]?.data).toEqual({ g: 20 });
  });
});
