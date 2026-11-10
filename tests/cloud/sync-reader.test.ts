// @vitest-environment jsdom
// The reader's records (reading time and the daily goal) through the sync account (cloud/src): one record each in the account,
// whichever library sends it, kept under the Chinese key and counted in the Chinese room; a Worker from before this one (its merge
// frozen in tests/fixtures/languages) keeps a copy per library, which the first sync after the deploy folds into one; one rolled
// back to the Worker live before languages hands the Chinese library's time on once it is updated again; and the SQL that picks
// them runs on a real SQLite. Devices and hubs: tests/helpers/readerDevices.ts.
import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHARED_RECORD_BYTES, type memoryStore } from '../../cloud/src/account';
import type { Env } from '../../cloud/src/worker';
import { sqlStore, type SqlStorage } from '../../cloud/src/sqlStore';
import { actKey, dayOf } from '../../src/core/activity';
import { READER, READER_COPIES, exchange, shareReader } from '../../src/core/syncExchange';
import { GOAL_KEY } from '../../src/core/syncKeys';
import { exchange as oldExchange } from '../fixtures/languages/syncExchange';
import { device, hub, stopDevices, type Answer } from '../helpers/readerDevices';
import { cloud, signedIn } from './helpers';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); });
afterEach(() => {
  stopDevices();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A signed-in account on the Worker in process, the store it keeps, and its exchange: today's Worker, or the one from before. */
async function account(state = { released: false }) {
  const c = cloud({}, { released: () => state.released });
  const token = await signedIn(c);
  const store = [...c.stores.values()][0];
  const worker: Answer = async (input) => (await c.post('/sync', input, token)).json();
  /** The Worker from before this one: its merge (tests/fixtures/languages) over the same account; its rooms are not in play here. */
  const before: Answer = (input) => {
    let epoch = store.getMeta('epoch');
    if (!epoch) { epoch = 'account-1'; store.setMeta('epoch', epoch); }
    const table = store.records(epoch, Number(store.getMeta('version') ?? 0));
    const { reply, changed } = oldExchange(table, input, Date.now());
    if (changed) store.setMeta('version', String(table.version));
    return reply;
  };
  return { c, store, worker, before, state };
}
const keys = (store: ReturnType<typeof memoryStore>) => [...store.data.keys()].sort();

describe('two devices on different libraries, through the account', () => {
  it('share one streak and one goal, kept once under Chinese keys, counted in the Chinese room', async () => {
    const { store, worker } = await account();
    const to = hub(worker);
    const ja = await device(to).open('ja');
    const es = await device(to).open('es');
    ja.read('ja', 500);
    ja.choose(15);
    await ja.sync('ja');
    es.read('es', 400);
    await es.sync('es');
    await ja.sync('ja');
    expect(es.shown()).toEqual({ today: 900, goal: 15, met: true, current: 1 });
    expect(ja.shown()).toEqual(es.shown());
    const today = dayOf();
    expect(keys(store)).toEqual([GOAL_KEY, actKey(today, es.id), actKey(today, ja.id)].sort());
    expect([store.recordBytes('others'), store.recordBytes('chinese') > 0]).toEqual([0, true]);
    // The Spanish day takes the goal it heard of with its next sync; then nothing moves.
    await es.sync('es');
    await ja.sync('ja');
    const version = store.getMeta('version');
    await es.sync('es');
    await ja.sync('ja');
    expect(store.getMeta('version')).toBe(version);
    expect(store.getMeta('reader')).toBe(version);
    expect([ja.status('ja').pending, es.status('es').pending]).toEqual([0, 0]);
  });
});

describe('the rooms', () => {
  it('count the reader’s records in the Chinese room, whichever library sends them', async () => {
    const c = cloud({ OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const friend = await signedIn(c, 'friend@example.com');
    const send = async (body: object) => {
      const res = await c.call('/sync', { method: 'POST', body: JSON.stringify(body), headers: { Authorization: `Bearer ${friend}` } });
      return { status: res.status, body: await res.json() as { error?: string } };
    };
    const pad = (bytes: number) => ({ p: 'x'.repeat(bytes - 8) });
    // 699 Chinese words of 30 KB: 1.5 KB short of the Chinese room's 20 MB.
    for (let r = 0; r < 3; r++) {
      expect((await send({ changes: Array.from({ length: 233 }, (_, i) => ({ key: `v:f${r}-${i}`, at: 1, data: pad(30_000) })) })).status).toBe(200);
    }
    expect(SHARED_RECORD_BYTES).toBe(20 * 1024 * 1024);
    // Japanese words have their own room; a day of reading time that does not fit in the Chinese one is refused as Chinese.
    expect((await send({ lang: 'ja', changes: [{ key: '@ja:v:学生', at: 1, data: pad(30_000) }] })).status).toBe(200);
    const day = { key: `@ja:${actKey('2026-11-10', 'dev00001')}`, at: Date.now(), data: { s: { ja: 60 }, g: 10, t: 1, ...pad(5000) } };
    expect(await send({ lang: 'ja', changes: [day] })).toEqual({ status: 413, body: expect.objectContaining({ error: 'Your account is full: it keeps up to 20 MB of words, places and settings.' }) });
    expect((await send({ lang: 'ja', changes: [{ ...day, data: { s: { ja: 60 }, g: 10, t: 1 } }] })).status).toBe(200);
  });
});

describe('the Worker from before this one, then deployed', () => {
  it('keeps a copy per library before, and the first sync after folds them into one for every library', async () => {
    const { store, worker, before } = await account();
    const to = hub(before);
    const zh = await device(to).open('zh');
    const ja = await device(to).open('ja');
    const es = await device(to).open('es');
    zh.read('zh', 300);
    zh.choose(20);
    await zh.sync('zh');
    ja.read('ja', 400);
    await ja.sync('ja');
    es.read('es', 200);
    await es.sync('es');
    for (const [d, lang] of [[zh, 'zh'], [ja, 'ja'], [es, 'es']] as const) await d.sync(lang);
    expect([zh, ja, es].map((d) => d.shown().today)).toEqual([300, 400, 200]);
    const today = dayOf();
    expect(keys(store)).toEqual([`@es:${actKey(today, es.id)}`, `@ja:${actKey(today, ja.id)}`, GOAL_KEY, actKey(today, zh.id)].sort());
    expect(store.getMeta('reader')).toBeUndefined();

    to.answer = worker;
    const deployed = to.log.length;
    for (const [d, lang] of [[ja, 'ja'], [es, 'es'], [zh, 'zh']] as const) await d.sync(lang);
    for (const d of [zh, ja, es]) expect(d.shown()).toEqual({ today: 900, goal: 20, met: false, current: 0 });
    expect(keys(store).filter((k) => !k.startsWith('@'))).toEqual([GOAL_KEY, actKey(today, es.id), actKey(today, ja.id), actKey(today, zh.id)].sort());
    // The copies stay where that Worker put them, and no library is given one beside the record it was folded into.
    expect(store.data.get(`@ja:${actKey(today, ja.id)}`)?.data).toMatchObject({ s: { ja: 400 } });
    for (const x of to.log.slice(deployed)) expect(new Set(x.records.map((r) => r.key)).size).toBe(x.records.length);
    expect(store.getMeta('reader')).toBe(store.getMeta('version'));
  });

  it('hands the Chinese library’s time on to the other languages after a rollback to the Worker live before languages', async () => {
    const { store, worker, state } = await account();
    const to = hub(worker);
    const zh = await device(to).open('zh');
    const ja = await device(to).open('ja');
    ja.read('ja', 60);
    await ja.sync('ja');
    // Rolled back: the Japanese library waits (outdated), and the Chinese one goes on sending its day.
    state.released = true;
    zh.read('zh', 600);
    await zh.sync('zh');
    await ja.sync('ja');
    expect(ja.status('ja').state).toBe('outdated');
    expect(Number(store.getMeta('version'))).toBeGreaterThan(Number(store.getMeta('reader')));
    // Updated again: the day the Chinese library sent meanwhile reaches the Japanese one, and the other way around.
    state.released = false;
    await ja.sync('ja');
    await zh.sync('zh');
    expect(ja.status('ja')).toMatchObject({ state: 'idle', pending: 0 });
    expect([ja.shown().today, zh.shown().today]).toEqual([660, 660]);
  });
});

/** SQLite through the sqlite3 command (macOS has it), with the bindings written into the query. Enough for the record queries. */
function sqliteCli(file: string): SqlStorage {
  const literal = (v: unknown) => (typeof v === 'number' ? String(v) : v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  return {
    exec(query, ...bindings) {
      let i = 0;
      const sql = query.replace(/\?/g, () => literal(bindings[i++]));
      const out = execFileSync('sqlite3', ['-json', file, sql], { encoding: 'utf8' }).trim();
      const rows = out ? JSON.parse(out) as Record<string, unknown>[] : [];
      return { toArray: () => rows };
    },
  };
}
let hasSqlite = true;
try { execFileSync('sqlite3', ['-version'], { stdio: 'ignore' }); } catch { hasSqlite = false; }

describe('the reader’s records in SQLite (sqlStore)', () => {
  it.skipIf(!hasSqlite)('picks the records and the copies a Worker from before kept, folds them, and gives them to every library', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dushu-reader-sql-'));
    dirs.push(dir);
    const table = sqlStore(sqliteCli(join(dir, 'account.sqlite'))).records('e', 0);
    const at = 1_700_000_000_000;
    const day = '2026-11-10';
    const time = (s: Record<string, number>, t: number) => ({ s, g: 10, t });
    // What the Worker from before kept: Chinese records as they are, each other library's under its prefix. A Japanese saved
    // word whose id happens to be 'l:goal' is a word, not the goal.
    oldExchange(table, { changes: [{ key: actKey(day, 'zhdev001'), at, data: time({ zh: 300 }, at) }, { key: GOAL_KEY, at, data: { g: 20 } }, { key: 'v:学生', at, data: { id: '学生' } }] }, at);
    oldExchange(table, { lang: 'ja', changes: [
      { key: `@ja:${actKey(day, 'twolibs1')}`, at: at + 5, data: time({ ja: 400, es: 100 }, at + 5) },
      { key: `@ja:${GOAL_KEY}`, at: at + 1, data: { g: 15 } },
      { key: '@ja:v:l:goal', at, data: { id: 'l:goal' } },
    ] }, at);
    oldExchange(table, { lang: 'es', changes: [{ key: `@es:${actKey(day, 'twolibs1')}`, at: at + 9, data: time({ es: 250 }, at + 9) }] }, at);
    const picked = (lang: string) => table.changed(0, new Set(), lang).map((r) => r.key);
    expect(picked(READER)).toEqual([actKey(day, 'zhdev001'), GOAL_KEY]);
    expect(picked(READER_COPIES)).toEqual([`@ja:${actKey(day, 'twolibs1')}`, `@ja:${GOAL_KEY}`, `@es:${actKey(day, 'twolibs1')}`]);

    expect(shareReader(table, 0)).toBe(true);
    const one = table.get(actKey(day, 'twolibs1'));
    expect(one).toMatchObject({ at: at + 9, data: { s: { ja: 400, es: 250 }, t: at + 9 } });
    expect(table.get(GOAL_KEY)?.data).toEqual({ g: 15 });
    expect(picked(READER).sort()).toEqual([GOAL_KEY, actKey(day, 'twolibs1'), actKey(day, 'zhdev001')].sort());
    // Every library gets them under its prefix, the copies never; Chinese as they are, with its own records.
    const spanish = exchange(table, { lang: 'es', since: 0, changes: [] }, at).reply.records.map((r) => r.key);
    expect(spanish.sort()).toEqual([`@es:${GOAL_KEY}`, `@es:${actKey(day, 'twolibs1')}`, `@es:${actKey(day, 'zhdev001')}`].sort());
    const japanese = exchange(table, { lang: 'ja', since: 0, changes: [] }, at).reply.records.map((r) => r.key);
    expect(japanese.sort()).toEqual(['@ja:v:l:goal', `@ja:${GOAL_KEY}`, `@ja:${actKey(day, 'twolibs1')}`, `@ja:${actKey(day, 'zhdev001')}`].sort());
    const chinese = exchange(table, { since: 0, changes: [] }, at).reply.records.map((r) => r.key);
    expect(chinese.sort()).toEqual(['v:学生', GOAL_KEY, actKey(day, 'twolibs1'), actKey(day, 'zhdev001')].sort());
    // A Spanish change to the goal is the one goal.
    exchange(table, { lang: 'es', changes: [{ key: `@es:${GOAL_KEY}`, at: at + 20, data: { g: 30 } }] }, at);
    expect(table.get(GOAL_KEY)?.data).toEqual({ g: 30 });
    expect(table.get(`@es:${GOAL_KEY}`)).toBeUndefined();
  });
});
