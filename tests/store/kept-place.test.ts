// A reading place outlives its book: deleting a book keeps the place, and adding the same book again lands it, on this
// device and with no Mac in sight (store.books.remove / add / update, core/syncKeys.ts).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/store';
import type { ImportedBook, Store } from '../../src/types';

const p = (text: string) => ({ t: 'p' as const, text });
// Ten Han characters each.
const P = ['学而时习之不亦说乎有', '朋自远方来不亦乐乎人', '不知而不愠不亦君子乎', '其为人也孝弟而好犯上'];
const v1: ImportedBook = {
  title: '论语', author: '孔子', format: 'txt', script: 'simplified', sourceName: 'sample:lunyu',
  chapters: [{ title: '一', blocks: [p(P[0]), p(P[1])] }, { title: '二', blocks: [p(P[2]), p(P[3])] }],
  assets: new Map(),
};
/** The same book from a newer importer, cut as one chapter. */
const v2: ImportedBook = { ...v1, importVersion: 2, chapters: [{ title: '学而', blocks: P.map(p) }] };
const SHA = 'c'.repeat(64);
const open = () => openStore(`kept-${Math.random().toString(36).slice(2)}`);
const placeOf = async (store: Store, id: string) => store.progress.get(id);

describe('a deleted book keeps its place', () => {
  it('adding the same book again opens where it was', async () => {
    const store = await open();
    const a = await store.books.add(v1);
    await store.progress.set({ bookId: a.id, chapter: 1, block: 1, offset: 3, percent: 0.8, updatedAt: 500 });
    await store.books.remove(a.id);
    expect(await store.books.list()).toEqual([]);
    const b = await store.books.add(v1);
    expect(b.id).not.toBe(a.id);
    expect(await placeOf(store, b.id)).toEqual({ bookId: b.id, chapter: 1, block: 1, offset: 3, percent: 0.8, updatedAt: 500 });
    // The kept place is used once.
    const rows = await store.sync.rows();
    expect(rows.filter((r) => r.held !== undefined)).toEqual([]);
  });

  it('the Mac\'s book lands its place when it is marked as the Mac\'s, after it was added', async () => {
    const store = await open();
    const a = await store.books.add({ ...v1, sourceName: 'lunyu.epub' });
    await store.books.update(a.id, { note: `mac-book:${SHA}` });
    await store.progress.set({ bookId: a.id, chapter: 1, block: 0, percent: 0.6, updatedAt: 700 });
    await store.books.remove(a.id);
    // The library adds the Mac's file, then marks it with the file's digest.
    const b = await store.books.add({ ...v1, sourceName: 'lunyu.epub' });
    expect(await placeOf(store, b.id)).toBeUndefined();
    await store.books.update(b.id, { note: `mac-book:${SHA}` });
    expect(await placeOf(store, b.id)).toMatchObject({ chapter: 1, block: 0, updatedAt: 700 });
  });

  it('a place kept from an older import lands in the new one by its percent, a moment older', async () => {
    const store = await open();
    const a = await store.books.add(v1);
    // Three quarters through: 31.5 of the 42 Han characters counted with titles, so the new chapter's 30th text character.
    await store.progress.set({ bookId: a.id, chapter: 1, block: 1, percent: 0.75, updatedAt: 900 });
    await store.books.remove(a.id);
    const b = await store.books.add(v2);
    expect(await placeOf(store, b.id)).toEqual({ bookId: b.id, chapter: 0, block: 2, offset: 9, percent: 0.75, updatedAt: 899 });
  });

  it('never replaces a newer place, and a book never deleted has nothing kept', async () => {
    const store = await open();
    const a = await store.books.add({ ...v1, sourceName: 'x.epub' });
    await store.progress.set({ bookId: a.id, chapter: 0, block: 1, percent: 0.3, updatedAt: 100 });
    await store.books.update(a.id, { note: `mac-book:${SHA}` });
    await store.progress.set({ bookId: a.id, chapter: 1, block: 1, percent: 0.9, updatedAt: 300 });
    await store.books.remove(a.id);
    const b = await store.books.add({ ...v1, sourceName: 'x.epub' });
    await store.progress.set({ bookId: b.id, chapter: 0, block: 0, percent: 0.1, updatedAt: 400 });
    await store.books.update(b.id, { note: `mac-book:${SHA}` });
    expect(await placeOf(store, b.id)).toMatchObject({ chapter: 0, block: 0, updatedAt: 400 });
    const c = await store.books.add({ ...v1, title: '别的', sourceName: 'sample:other' });
    expect(await placeOf(store, c.id)).toBeUndefined();
  });
});
