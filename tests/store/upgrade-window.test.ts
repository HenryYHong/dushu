// @vitest-environment jsdom
// A new importer reads the owner's books again on each device in turn (ui/library/upgrade.ts, store.books.replace). Between the
// first device and the last, one device has the new chapters and keys and another the old ones: neither loses its place or a
// bookmark, nor sends anything over a newer change from the other. The Mac's merge runs in process; the books are made up.
import 'fake-indexeddb/auto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { newSrs } from '../../src/core/srs';
import { bookKey, createSyncer, setSyncEnabled, type Syncer } from '../../src/core/sync';
import { openStore } from '../../src/store';
import type { Bookmark, ImportedBook, Store } from '../../src/types';
import { createSyncStore } from '../../scripts/sync-bridge';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const syncers: Syncer[] = [];
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); setSyncEnabled(true); });

function mac() {
  const dir = mkdtempSync(join(tmpdir(), 'dushu-upgrade-'));
  dirs.push(dir);
  const server = createSyncStore({ dir });
  const sent: { key: string; at: number }[][] = [];
  const send = (body: string) => {
    const parsed = JSON.parse(body);
    sent.push(parsed.changes);
    return Promise.resolve(new Response(JSON.stringify(server.exchange(parsed)), { status: 200, headers: { 'content-type': 'application/json' } }));
  };
  return { server, sent, send };
}
const device = (store: Store, m: ReturnType<typeof mac>, clock: { t: number }) => {
  const s = createSyncer(store, { send: (body) => m.send(body), everyMs: 0, now: () => clock.t });
  syncers.push(s);
  return s;
};
const open = () => openStore(`window-${Math.random().toString(36).slice(2)}`);

const p = (text: string) => ({ t: 'p' as const, text });
// Ten Han characters a line.
const LINES = ['山上有一座小房子里面', '住着一位老人每天早上', '他都去河边看太阳升起', '然后回家喝一碗热粥吃'];
/** A Mac book whose new import is cut just as before (most books). */
const same = (importVersion: number): ImportedBook => ({
  title: '小房子', author: '某人', format: 'epub', script: 'simplified', assets: new Map(), note: `mac-book:${'a'.repeat(64)}`, importVersion,
  chapters: [{ title: '一', blocks: LINES.slice(0, 2).map(p) }, { title: '二', blocks: LINES.slice(2).map(p) }],
});
/** A Mac book set out one printed line per paragraph, whose new import joins the lines back. */
const wrapped = (importVersion: number): ImportedBook => ({
  title: '河边', author: '某人', format: 'epub', script: 'simplified', assets: new Map(), note: `mac-book:${'b'.repeat(64)}`, importVersion,
  chapters: [{ title: '一', blocks: importVersion > 2 ? [p(LINES.join(''))] : LINES.map(p) }],
});

async function twoDevices() {
  const m = mac();
  const [ca, cb] = [{ t: 1_000_000 }, { t: 1_000_000 }];
  const [a, b] = [await open(), await open()];
  const [xa, ya] = [await a.books.add(same(2)), await a.books.add(wrapped(2))];
  const [xb, yb] = [await b.books.add(same(2)), await b.books.add(wrapped(2))];
  const [sa, sb] = [device(a, m, ca), device(b, m, cb)];
  return { m, a, b, ca, cb, sa, sb, xa, ya, xb, yb };
}

describe('the owner\'s books imported again on one device and not yet on another', () => {
  it('keeps every bookmark where it is on both, and shows one that had to move only where the book is cut the new way', async () => {
    const { a, b, sa, sb, xa, ya, xb, yb } = await twoDevices();
    const mark = (id: string, bookId: string, block: number, offset: number, key: string): Bookmark =>
      ({ id, bookId, chapter: block > 1 && bookId === xa.id ? 1 : 0, block: bookId === xa.id ? block % 2 : block, offset, label: id, createdAt: 2_000_000, bookKey: key });
    await a.bookmarks.put(mark('x', xa.id, 2, 3, bookKey(xa))); // 河 in the second chapter
    await a.bookmarks.put(mark('y0', ya.id, 0, 4, bookKey(ya))); // 座: the first line, where it was
    await a.bookmarks.put(mark('y2', ya.id, 2, 4, bookKey(ya))); // 边: the third line, inside the joined paragraph now
    await sa.run(); await sb.run();
    expect((await b.bookmarks.list()).map((m) => [m.id, m.bookId === xb.id || m.bookId === yb.id]).sort()).toEqual([['x', true], ['y0', true], ['y2', true]]);

    await a.books.replace(xa.id, same(3));
    await a.books.replace(ya.id, wrapped(3));
    await sa.run(); await sb.run();
    const onB = new Map((await b.bookmarks.list()).map((m) => [m.id, m]));
    // Right in the old cut and the new: still on b's books, at the same places.
    expect(onB.get('x')).toMatchObject({ bookId: xb.id, chapter: 1, block: 0, offset: 3 });
    expect(onB.get('y0')).toMatchObject({ bookId: yb.id, chapter: 0, block: 0, offset: 4 });
    // Moved into the joined paragraph: kept, but shown on b's book only once b has the new cut too, never at a wrong place.
    expect(onB.get('y2')).toMatchObject({ block: 0, offset: 24, bookKey: bookKey({ ...ya, importVersion: 3 }) });
    expect(onB.get('y2')?.bookId).not.toBe(yb.id);
    const onA = new Map((await a.bookmarks.list()).map((m) => [m.id, m]));
    expect(onA.get('x')).toMatchObject({ bookId: xa.id, chapter: 1, block: 0, offset: 3 });
    expect(onA.get('y0')).toMatchObject({ bookId: ya.id, block: 0, offset: 4 });
    expect(onA.get('y2')).toMatchObject({ bookId: ya.id, block: 0, offset: 24 });

    await b.books.replace(xb.id, same(3));
    await b.books.replace(yb.id, wrapped(3));
    await sb.run(); await sa.run(); await sb.run();
    for (const [s, x, y] of [[a, xa, ya], [b, xb, yb]] as const) {
      const all = new Map((await s.bookmarks.list()).map((m) => [m.id, m]));
      expect(all.get('x')).toMatchObject({ bookId: x.id, chapter: 1, block: 0, offset: 3 });
      expect(all.get('y0')).toMatchObject({ bookId: y.id, block: 0, offset: 4 });
      expect(all.get('y2')).toMatchObject({ bookId: y.id, block: 0, offset: 24 });
      expect(all.size).toBe(3);
    }
  });

  it('never lets the device with the old cut send a place over a newer one read in the new cut, and lands each where it belongs', async () => {
    const { a, b, ca, cb, sa, sb, ya, yb } = await twoDevices();
    await b.progress.set({ bookId: yb.id, chapter: 0, block: 1, percent: 0.25, updatedAt: 2_000_000 });
    await sb.run(); await sa.run();
    expect(await a.progress.get(ya.id)).toMatchObject({ block: 1, updatedAt: 2_000_000 });
    // a imports the book again (its place moves by the text), and reads on.
    await a.books.replace(ya.id, wrapped(3));
    expect(await a.progress.get(ya.id)).toMatchObject({ block: 0, updatedAt: 2_000_000 });
    ca.t = 3_000_000;
    await a.progress.set({ bookId: ya.id, chapter: 0, block: 0, offset: 30, percent: 0.75, updatedAt: 3_000_000 });
    await sa.run();
    // b still has the old cut and syncs: its older place goes nowhere over a's, and a's waits for b's new cut.
    cb.t = 3_100_000;
    await sb.run(); await sa.run();
    expect(await a.progress.get(ya.id)).toMatchObject({ block: 0, offset: 30, updatedAt: 3_000_000 });
    expect(await b.progress.get(yb.id)).toMatchObject({ block: 1, updatedAt: 2_000_000 });
    // b imports it again: a's newer place lands there exactly.
    await b.books.replace(yb.id, wrapped(3));
    await sb.run();
    expect(await b.progress.get(yb.id)).toMatchObject({ chapter: 0, block: 0, offset: 30, updatedAt: 3_000_000 });
    await sa.run();
    expect(await a.progress.get(ya.id)).toMatchObject({ chapter: 0, block: 0, offset: 30, updatedAt: 3_000_000 });
  });

  it('sends no saved word or place again just because a book was imported again', async () => {
    const { m, a, sa, sb, xa } = await twoDevices();
    await a.vocab.put({ id: '房子', simp: '房子', trad: '房子', pinyin: 'fang2 zi5', gloss: 'house', addedAt: 1, srs: newSrs(1),
      context: { sentence: '山上有一座小房子', bookId: xa.id, bookTitle: '小房子' } });
    await a.progress.set({ bookId: xa.id, chapter: 1, block: 1, percent: 0.9, updatedAt: 2_000_000 });
    await sa.run(); await sb.run();
    const before = m.sent.length;
    await a.books.replace(xa.id, same(3));
    await sa.run();
    const keys = m.sent.slice(before).flat().map((c) => c.key);
    expect(keys.filter((k) => k.startsWith('v:') || k.startsWith('b:'))).toEqual([]);
    // The place goes once under the book's new key, with the time it was read, and lands exactly where it was.
    expect(keys).toEqual([`p:${bookKey({ ...xa, importVersion: 3 })}`]);
    expect(await a.progress.get(xa.id)).toMatchObject({ chapter: 1, block: 1, updatedAt: 2_000_000 });
  });
});
