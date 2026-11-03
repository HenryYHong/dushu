// store.books.replace: a new import of the same book takes the place of the stored one (ui/library/upgrade.ts).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/store';
import { newSrs } from '../../src/core/srs';
import { bookKey } from '../../src/core/syncKeys';
import type { Bookmark, ImportedBook } from '../../src/types';
import { PNG } from '../import/helpers';

const p = (text: string) => ({ t: 'p' as const, text });
const old: ImportedBook = {
  title: '三國', author: '羅貫中', format: 'txt', script: 'traditional', sourceName: 'sample:sanguo', note: 'a note',
  chapters: [
    { title: '一', blocks: [p('天下大勢，分久必合。')] },
    { title: '二 (1)', blocks: [p('周末七國分爭，並入於秦。')] },
    { title: '二 (2)', blocks: [p('及秦滅之後，楚、漢分爭，'), p('又並入於漢。')] },
  ],
  assets: new Map(),
};
const fresh: ImportedBook = {
  ...old, importVersion: 2,
  chapters: [
    { title: '一', blocks: [p('天下大勢，分久必合。')] },
    { title: '二', blocks: [p('周末七國分爭，並入於秦。'), p('及秦滅之後，楚、漢分爭，又並入於漢。')] },
  ],
};

describe('replacing a book with a new import of it', () => {
  it('keeps its id, name and history, rewrites the chapters and moves the place to the same character', async () => {
    const store = await openStore(`replace-${Math.random()}`);
    const meta = await store.books.add(old);
    await store.books.update(meta.id, { title: '我的三國', lastOpenedAt: 5 });
    // Reading at 又 in Pages (offset 0 of the old fourth block) .
    await store.progress.set({ bookId: meta.id, chapter: 2, block: 1, offset: 0, percent: 0.8, updatedAt: 42 });
    const next = await store.books.replace(meta.id, fresh);
    expect(next).toMatchObject({ id: meta.id, title: '我的三國', lastOpenedAt: 5, note: 'a note', chapterCount: 2, importVersion: 2 });
    expect(next.chapterTitles).toEqual(['一', '二']);
    expect(await store.books.chapter(meta.id, 2)).toBeUndefined();
    expect((await store.books.chapter(meta.id, 1))?.blocks).toHaveLength(2);
    // The place keeps the time it was read: sync compares it with the other devices' places.
    expect(await store.progress.get(meta.id)).toEqual({ bookId: meta.id, chapter: 1, block: 1, offset: 12, percent: 0.8, updatedAt: 42 });
    expect(await store.books.list()).toHaveLength(1);
  });

  it('moves a Scroll place (no offset) to the block that holds it', async () => {
    const store = await openStore(`replace-${Math.random()}`);
    const meta = await store.books.add(old);
    await store.progress.set({ bookId: meta.id, chapter: 1, block: 0, percent: 0.4, updatedAt: 7 });
    await store.books.replace(meta.id, fresh);
    expect(await store.progress.get(meta.id)).toEqual({ bookId: meta.id, chapter: 1, block: 0, percent: 0.4, updatedAt: 7 });
  });

  it('moves the book\'s bookmarks to the same characters, under the book\'s new key', async () => {
    const store = await openStore(`replace-${Math.random()}`);
    const meta = await store.books.add(old);
    const at = (chapter: number, block: number, offset: number, id: string) =>
      ({ id, bookId: meta.id, chapter, block, offset, label: '又並入於漢', createdAt: 3, bookKey: 'ssanguo' });
    await store.bookmarks.put(at(2, 1, 1, 'm1')); // 並 in 又並入於漢
    await store.bookmarks.put({ ...at(0, 0, 0, 'other'), bookId: 'another-book' });
    const next = await store.books.replace(meta.id, fresh);
    expect(await store.bookmarks.list(meta.id)).toEqual([{ ...at(1, 1, 13, 'm1'), bookKey: 'ssanguo.2' }]);
    expect(next.importVersion).toBe(2);
    // Another book's bookmark is left as it was.
    expect(await store.bookmarks.list('another-book')).toEqual([{ ...at(0, 0, 0, 'other'), bookId: 'another-book' }]);
  });

  it('leaves the place and the bookmarks exactly where they are when the new import has the same chapters', async () => {
    // Most books when the importer changes: only the version (and so the sync key) is new.
    const store = await openStore(`replace-${Math.random()}`);
    const book: ImportedBook = {
      ...old, sourceName: undefined, note: `mac-book:${'c'.repeat(64)}`, importVersion: 2,
      chapters: [{ title: '一', blocks: [p('天下大勢，分久必合。')] }, { title: '二', blocks: [p('“周末七國分爭，”'), { t: 'img', asset: 'x.png' }, p('並入於秦。')] }],
    };
    const meta = await store.books.add(book);
    // A page that starts on the quotation mark, and a place on the picture: moving them by their characters would shift both.
    await store.progress.set({ bookId: meta.id, chapter: 1, block: 0, offset: 0, percent: 0.4, updatedAt: 9 });
    const mark = (id: string, block: number, over: Partial<Bookmark> = {}): Bookmark =>
      ({ id, bookId: meta.id, chapter: 1, block, offset: 0, label: '周末', createdAt: 4, ...over });
    await store.bookmarks.put(mark('keyed', 1, { bookKey: bookKey(meta) }));
    await store.bookmarks.put(mark('older', 0));
    const next = await store.books.replace(meta.id, { ...book, importVersion: 3 });
    expect(bookKey(next)).toBe(`m${'c'.repeat(32)}.3`);
    expect(await store.progress.get(meta.id)).toEqual({ bookId: meta.id, chapter: 1, block: 0, offset: 0, percent: 0.4, updatedAt: 9 });
    // Still right in the old chapters, so they keep the key a device that has not imported the book again knows them by.
    expect((await store.bookmarks.list(meta.id)).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      mark('keyed', 1, { bookKey: `m${'c'.repeat(32)}.2` }), mark('older', 0, { bookKey: `m${'c'.repeat(32)}.2` }),
    ]);
  });

  it('keeps everything else of the book: its cover from the Mac, name, order, words, lookups and names', async () => {
    const store = await openStore(`replace-${Math.random()}`);
    const book: ImportedBook = { ...old, sourceName: undefined, note: `mac-book:${'d'.repeat(64)}`, importVersion: 2, cover: 'own.png',
      assets: new Map([['own.png', new Blob([PNG])]]) };
    const meta = await store.books.add(book);
    const other = await store.books.add({ ...old, title: '另一本', sourceName: 'b.txt', note: undefined });
    await store.books.update(meta.id, { lastOpenedAt: 1 });
    await store.books.update(other.id, { lastOpenedAt: 2 });
    // The picture the owner put beside the book on the Mac, given through the account (core/cloudBooks.ts).
    await store.books.setCover(meta.id, new Blob([PNG]), 'f'.repeat(64));
    const given = (await store.books.get(meta.id))!.cover!;
    await store.vocab.put({ id: '天下', simp: '天下', trad: '天下', pinyin: 'tian1 xia4', gloss: 'world', addedAt: 1, srs: newSrs(1),
      context: { sentence: '天下大勢', bookId: meta.id, bookTitle: '三國', chapter: 0 } });
    await store.known.add(['分']);
    await store.lookups.log({ day: '2026-11-01', id: '大勢', word: '大勢', pinyin: 'da4 shi4', gloss: 'trend', context: { sentence: '天下大勢', bookId: meta.id } }, 5);
    await store.lexicon.upsert(meta.id, { word: '周末', pinyin: 'zhou1 mo4', gloss: 'end of Zhou', kind: 'term', enabled: true, origin: 'user' });
    const next = await store.books.replace(meta.id, { ...fresh, sourceName: undefined, note: undefined, importVersion: 3, cover: 'own.png',
      assets: new Map([['own.png', new Blob([PNG])]]) });
    expect(next).toMatchObject({ cover: given, coverFrom: 'f'.repeat(64), note: `mac-book:${'d'.repeat(64)}`, title: '三國', lastOpenedAt: 1 });
    expect(await store.books.asset(meta.id, given)).toBeDefined();
    expect((await store.books.list()).map((b) => b.id)).toEqual([other.id, meta.id]);
    expect((await store.vocab.get('天下'))?.context?.bookId).toBe(meta.id);
    expect(store.known.has('分')).toBe(true);
    expect((await store.lookups.list())[0]).toMatchObject({ id: '大勢', count: 1, context: { bookId: meta.id } });
    expect((await store.lexicon.get(meta.id)).map((e) => e.word)).toEqual(['周末']);
    // A book that was never opened gets no place.
    expect(await store.progress.get(meta.id)).toBeUndefined();
  });

  it('moves a place read past the middle and bookmarks in several chapters by their characters, and keys only the moved ones anew', async () => {
    const store = await openStore(`replace-${Math.random()}`);
    const meta = await store.books.add({ ...old, importVersion: 2 });
    // Past the middle: at 漢 in the last old chapter.
    await store.progress.set({ bookId: meta.id, chapter: 2, block: 1, offset: 4, percent: 0.9, updatedAt: 11 });
    const at = (id: string, chapter: number, block: number, offset: number): Bookmark =>
      ({ id, bookId: meta.id, chapter, block, offset, label: 'x', createdAt: 3, bookKey: 'ssanguo.2' });
    await store.bookmarks.put(at('first', 0, 0, 2)); // 大 in the first chapter, cut the same in both
    await store.bookmarks.put(at('second', 1, 0, 3)); // 國
    await store.bookmarks.put(at('third', 2, 0, 1)); // 秦
    await store.books.replace(meta.id, { ...fresh, importVersion: 3 });
    expect(await store.progress.get(meta.id)).toEqual({ bookId: meta.id, chapter: 1, block: 1, offset: 16, percent: 0.9, updatedAt: 11 });
    const marks = new Map((await store.bookmarks.list(meta.id)).map((m) => [m.id, m]));
    expect(marks.get('first')).toEqual(at('first', 0, 0, 2));
    expect(marks.get('second')).toEqual(at('second', 1, 0, 3));
    expect(marks.get('third')).toEqual({ ...at('third', 1, 1, 1), bookKey: 'ssanguo.3' });
  });

  it('refuses a book that is gone', async () => {
    const store = await openStore(`replace-${Math.random()}`);
    await expect(store.books.replace('nope', fresh)).rejects.toThrow(/no longer in your library/);
  });
});
