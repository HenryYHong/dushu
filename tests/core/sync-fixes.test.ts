// @vitest-environment jsdom
// The reader's corrections sync like bookmarks (core/sync.ts): each fix is the record 'l:fix:<id>', last writer wins, a deletion stays
// deleted, and a fix of a book this device does not have waits for the book. They travel under 'l:' so that every hub keeps them
// as they are (the Mac's server and the Worker need no change) and the Chinese app live today (tests/fixtures/released, main
// ff6ab6c) passes them over: it neither takes them nor sends them back. The hubs run in process; the words are made up.
import 'fake-indexeddb/auto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { makeFix } from '../../src/core/fixes';
import { newSrs } from '../../src/core/srs';
import { createSyncer, setSyncEnabled, type Syncer } from '../../src/core/sync';
import { bookKey } from '../../src/core/syncKeys';
import { exchange, inLang, noCounts, type RecordTable, type StoredRecord } from '../../src/core/syncExchange';
import { createSyncStore } from '../../scripts/sync-bridge';
import { openStore } from '../../src/store';
import type { Fix, ImportedBook, Store } from '../../src/types';
import { createSyncer as releasedSyncer } from '../fixtures/released/sync';
import { exchange as releasedExchange } from '../fixtures/released/syncExchange';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const syncers: { stop(): unknown }[] = [];
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); setSyncEnabled(true); localStorage.clear(); });

let n = 0;
const open = () => openStore(`sync-fixes-${++n}-${Math.random().toString(36).slice(2)}`);

/** A hub in memory: today's merge, or with `released` the one live today (main ff6ab6c), over the same records. */
function hub() {
  const data = new Map<string, StoredRecord>();
  const h = {
    released: false, version: 0, data,
    send(body: string): Promise<Response> {
      const table: RecordTable = {
        epoch: 'hub-1',
        get version() { return h.version; },
        set version(v: number) { h.version = v; },
        get: (k) => data.get(k),
        put: (k, r) => { data.set(k, r); },
        changed: (since, also, lang) => [...data].filter(([k, r]) => (h.released || inLang(k, lang)) && (r.rev > since || also.has(k))).map(([key, r]) => ({ key, at: r.at, data: r.data })),
        counts: () => noCounts(),
      };
      const input = JSON.parse(body);
      const reply = h.released ? releasedExchange(table as never, input, Date.now()).reply : exchange(table, input, Date.now()).reply;
      return Promise.resolve(new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } }));
    },
  };
  return h;
}

/** The owner's Mac: the real server over a folder. */
function mac() {
  const d = mkdtempSync(join(tmpdir(), 'dushu-fixes-'));
  dirs.push(d);
  const server = createSyncStore({ dir: d });
  return { send: (body: string) => Promise.resolve(new Response(JSON.stringify(server.exchange(JSON.parse(body))), { status: 200 })) };
}

function device(store: Store, to: { send(body: string): Promise<Response> }, released = false): Syncer {
  const make = released ? releasedSyncer : createSyncer;
  const s = make(store, { send: (body: string) => to.send(body), everyMs: 0 }) as Syncer;
  syncers.push(s);
  return s;
}

const novel = (): ImportedBook => ({
  title: '河边的小屋', author: '林远', format: 'txt', script: 'simplified', assets: new Map(), sourceName: 'hebian.txt',
  chapters: [{ title: '一', blocks: [{ t: 'p', text: '子君说道：先生来了。' }] }, { title: '二', blocks: [{ t: 'p', text: '这家人家很好。' }] }],
});
const fixFor = (bookId: string, key: string, o: Partial<Fix> & Pick<Fix, 'kind' | 'word'>, t = Date.now()) =>
  makeFix({ book: key, bookId, t, ...o } as Parameters<typeof makeFix>[0]);

describe('fixes between two devices', () => {
  it('bring a fix to the same book on the other device, its switch and its deletion', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const [ba, bb] = [await a.books.add(novel()), await b.books.add(novel())];
    expect(bookKey(ba)).toBe(bookKey(bb));
    const sa = device(a, m);
    const sb = device(b, m);
    const f = fixFor(ba.id, bookKey(ba), { kind: 'word', word: '子君', pinyin: 'zi3 jun1', role: 'name' });
    await a.fixes.put([f]);
    await sa.run(); await sb.run();
    expect(await b.fixes.list()).toEqual([{ ...f, bookId: bb.id }]);

    // Nothing bounces back once both agree.
    await sa.run(); await sb.run();
    expect(sa.status().pending).toBe(0);
    expect(sb.status().pending).toBe(0);

    await b.fixes.put([{ ...f, bookId: bb.id, on: false, t: f.t + 10 }]);
    await sb.run(); await sa.run();
    expect((await a.fixes.list())[0]).toMatchObject({ on: false, bookId: ba.id });

    await a.fixes.remove([f.id]);
    await sa.run(); await sb.run();
    expect(await b.fixes.list()).toEqual([]);
    // A deletion stays: syncing again brings nothing back.
    await sa.run(); await sb.run();
    expect(await a.fixes.list()).toEqual([]);
    expect(await b.fixes.list()).toEqual([]);
  });

  it('keep a fix for a book that is not here under the book\'s key, and put it on the book once it arrives', async () => {
    const h = hub();
    const [a, b] = [await open(), await open()];
    const ba = await a.books.add(novel());
    const sa = device(a, h);
    const sb = device(b, h);
    const f = fixFor(ba.id, bookKey(ba), { kind: 'cut', word: '先生', cuts: [1] });
    await a.fixes.put([f]);
    await sa.run(); await sb.run();
    expect(await b.fixes.list()).toEqual([{ ...f, bookId: bookKey(ba) }]);
    const bb = await b.books.add(novel());
    await sb.run();
    expect(await b.fixes.list()).toEqual([{ ...f, bookId: bb.id }]);
    // Putting it on the book is no change to send.
    expect(sb.status().pending).toBe(0);
  });

  it('never delete a fix elsewhere because its book was deleted here', async () => {
    const h = hub();
    const [a, b] = [await open(), await open()];
    const [ba, bb] = [await a.books.add(novel()), await b.books.add(novel())];
    const sa = device(a, h);
    const sb = device(b, h);
    const f = fixFor(ba.id, bookKey(ba), { kind: 'reading', word: '人家', pinyin: 'ren2 jia5' });
    await a.fixes.put([f]);
    await sa.run(); await sb.run();
    await a.books.remove(ba.id);
    await sa.run(); await sb.run();
    expect(await b.fixes.list()).toEqual([{ ...f, bookId: bb.id }]);
    expect(await a.fixes.list()).toHaveLength(1);
  });

  it('let the later of two changes to the same fix win', async () => {
    const h = hub();
    const [a, b] = [await open(), await open()];
    const [ba, bb] = [await a.books.add(novel()), await b.books.add(novel())];
    const sa = device(a, h);
    const sb = device(b, h);
    await Promise.all([sa.run(), sb.run()]);
    // The same word fixed on both devices offline: one fix (the same id), the later one stays.
    const early = fixFor(ba.id, bookKey(ba), { kind: 'word', word: '子君', pinyin: 'zi3 jun1', gloss: 'early' }, 1000);
    const late = fixFor(bb.id, bookKey(bb), { kind: 'word', word: '子君', pinyin: 'zi3 jun1', gloss: 'late' }, 2000);
    expect(early.id).toBe(late.id);
    await a.fixes.put([early]);
    await b.fixes.put([late]);
    await sa.run(); await sb.run(); await sa.run();
    expect((await a.fixes.list())[0].gloss).toBe('late');
    expect((await b.fixes.list())[0].gloss).toBe('late');
  });
});

describe('fixes and the releases live today', () => {
  it('are kept as they are by the hub live today', async () => {
    const h = hub();
    h.released = true;
    const [a, b] = [await open(), await open()];
    const [ba, bb] = [await a.books.add(novel()), await b.books.add(novel())];
    const sa = device(a, h);
    const sb = device(b, h);
    const f = fixFor(ba.id, bookKey(ba), { kind: 'word', word: '子君', pinyin: 'zi3 jun1', role: 'name' });
    await a.fixes.put([f]);
    await sa.run(); await sb.run();
    expect(await b.fixes.list()).toEqual([{ ...f, bookId: bb.id }]);
    await b.fixes.remove([f.id]);
    await sb.run(); await sa.run();
    expect(await a.fixes.list()).toEqual([]);
    expect(h.data.get(`l:fix:${f.id}`)?.data).toBeNull();
  });

  it('are passed over by the app live today, which neither takes them nor sends them back, and syncs its own as before', async () => {
    const h = hub();
    const [a, old] = [await open(), await open()];
    const ba = await a.books.add(novel());
    await old.books.add(novel());
    const sa = device(a, h);
    const so = device(old, h, true);
    const f = fixFor(ba.id, bookKey(ba), { kind: 'cut', word: '先生', cuts: [1] });
    await a.fixes.put([f]);
    await old.vocab.put({ id: '学生', simp: '学生', trad: '學生', pinyin: 'xue2 sheng5', gloss: 'student', addedAt: 1000, srs: newSrs(1000) });
    await sa.run(); await so.run(); await sa.run(); await so.run();
    expect(so.status()).toMatchObject({ state: 'idle', pending: 0 });
    expect((await old.sync.rows()).some((r) => r.key.startsWith('l:fix:'))).toBe(false);
    expect(await old.fixes.list()).toEqual([]);
    // Its word reached the new device, and the fix is still the new device's, untouched on the hub.
    expect(a.vocab.has('学生')).toBe(true);
    expect(h.data.get(`l:fix:${f.id}`)?.data).toMatchObject({ kind: 'cut', word: '先生' });
    expect(await a.fixes.list()).toEqual([f]);
  });
});
