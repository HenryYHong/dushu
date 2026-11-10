import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '../../src/store';
import type { ImportedBook } from '../../src/types';
const book = (text = '我们一起读书。'): ImportedBook => ({
  title: '同一本书', author: '作者', format: 'txt', script: 'simplified',
  chapters: [{ title: '第一章', blocks: [{ t: 'p', text }] }], assets: new Map(),
});
const open = () => openStore(`device-backup-${Math.random()}`);
afterEach(() => vi.unstubAllGlobals());
describe('cross-device progress and terms', () => {
  it('remaps identical imported books by content without putting book text in the backup', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const mac = await open(); const ipad = await open();
    const original = await mac.books.add(book()); const copy = await ipad.books.add(book());
    expect(original.id).not.toBe(copy.id);
    await mac.progress.set({ bookId: original.id, chapter: 0, block: 0, offset: 3, percent: 0.5, updatedAt: 100 });
    await mac.lexicon.upsert(original.id, { word: '读书', pinyin: 'du2 shu1', gloss: 'reading', enabled: true, origin: 'user', kind: 'term' });
    const backup = await mac.exportBackup();
    expect(backup).not.toContain('我们一起读书。');
    const report = await ipad.importBackup(backup);
    expect(report.progress.added).toBe(1);
    expect(await ipad.progress.get(copy.id)).toMatchObject({ bookId: copy.id, offset: 3, percent: 0.5 });
    expect((await ipad.lexicon.get(copy.id)).map(term => term.word)).toContain('读书');
    expect(await ipad.progress.get(original.id)).toBeUndefined();
  });
  it('does not apply progress to a different edition with the same title', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const mac = await open(); const ipad = await open();
    const original = await mac.books.add(book()); const different = await ipad.books.add(book('完全不同的正文。'));
    await mac.progress.set({ bookId: original.id, chapter: 0, block: 0, offset: 3, percent: 0.5, updatedAt: 100 });
    const report = await ipad.importBackup(await mac.exportBackup());
    expect(report.progress.skipped).toBe(1);
    expect(await ipad.progress.get(different.id)).toBeUndefined();
  });
  it('does not guess between duplicate copies of a book', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const mac = await open(); const ipad = await open();
    const original = await mac.books.add(book());
    await ipad.books.add(book()); await ipad.books.add(book());
    await mac.progress.set({ bookId: original.id, chapter: 0, block: 0, offset: 3, percent: 0.5, updatedAt: 100 });
    expect((await ipad.importBackup(await mac.exportBackup())).progress.skipped).toBe(1);
  });
});

describe('bookmarks and looked-up words in a backup', () => {
  const mark = (bookId: string, id = 'm1') => ({ id, bookId, chapter: 0, block: 0, offset: 2, label: '第一页', createdAt: 5 });

  it('come back after Delete all data, on the book once it is added again, in either order', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const store = await open();
    const original = await store.books.add(book());
    await store.bookmarks.put(mark(original.id));
    await store.lookups.log({ day: '2026-11-08', id: '读书', word: '读书', pinyin: 'du2 shu1', gloss: 'to read', context: { sentence: '我们读书。', bookId: original.id, chapter: 0 } }, 10);
    const backup = await store.exportBackup();
    const data = JSON.parse(backup) as { version: number; bookmarks: { bookKey?: string }[]; lookups: unknown[] };
    expect(data.version).toBe(1);
    expect(data.bookmarks).toHaveLength(1);
    expect(data.bookmarks[0].bookKey).toMatch(/^b/);
    expect(data.lookups).toHaveLength(1);

    // The book added again first, then the backup: the bookmark lands on it by its content.
    await store.wipe();
    const again = await store.books.add(book());
    const report = await store.importBackup(backup);
    expect([report.bookmarks.added, report.lookups.added]).toEqual([1, 1]);
    expect((await store.bookmarks.list(again.id)).map((b) => b.id)).toEqual(['m1']);
    expect((await store.lookups.list()).map((l) => [l.id, l.context?.bookId])).toEqual([['读书', again.id]]);
    // Imported twice: nothing new.
    expect(await store.importBackup(backup)).toMatchObject({ bookmarks: { added: 0 }, lookups: { added: 0 } });

    // The backup first, then the book: the bookmark waits under the book's key and lands when it is added.
    await store.wipe();
    expect((await store.importBackup(backup)).bookmarks.added).toBe(1);
    const third = await store.books.add(book());
    expect((await store.bookmarks.list(third.id)).map((b) => b.id)).toEqual(['m1']);
  });

  it('merges a looked-up word with the same word on the same day, and leaves a bookmark on another copy alone', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const mac = await open(); const ipad = await open();
    const a = await mac.books.add(book());
    await mac.lookups.log({ day: '2026-11-08', id: '读书', word: '读书', pinyin: 'du2 shu1', gloss: 'to read' }, 10);
    await ipad.lookups.log({ day: '2026-11-08', id: '读书', word: '读书', pinyin: '', gloss: '' }, 30);
    await ipad.lookups.log({ day: '2026-11-08', id: '读书', word: '读书', pinyin: '', gloss: '' }, 40);
    await mac.bookmarks.put(mark(a.id));
    const backup = await mac.exportBackup();
    const report = await ipad.importBackup(backup);
    expect(report.lookups.added).toBe(0);
    const [row] = await ipad.lookups.list();
    expect([row.count, row.first, row.last, row.gloss]).toEqual([2, 10, 40, 'to read']);
    // The bookmark's book is not on the iPad: kept under its key, and the iPad's copy added later gets it.
    const copy = await ipad.books.add(book());
    expect((await ipad.bookmarks.list(copy.id))).toHaveLength(1);
    // A second copy added after: the bookmark stays on the first.
    const second = await ipad.books.add(book());
    expect(await ipad.bookmarks.list(second.id)).toEqual([]);
  });

  it('a backup from before them still imports', async () => {
    const store = await open();
    const old = JSON.stringify({ app: 'dushu', version: 1, exportedAt: '2026-10-01T00:00:00.000Z', vocab: [], known: ['读书'], progress: [], reviews: [] });
    const report = await store.importBackup(old);
    expect(report).toMatchObject({ known: { added: 1 }, bookmarks: { added: 0 }, lookups: { added: 0 } });
    expect(await store.bookmarks.list()).toEqual([]);
  });
});
