// store.books.replace: a new import of the same book takes the place of the stored one (ui/library/upgrade.ts).
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/store';
import type { ImportedBook } from '../../src/types';

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

  it('refuses a book that is gone', async () => {
    const store = await openStore(`replace-${Math.random()}`);
    await expect(store.books.replace('nope', fresh)).rejects.toThrow(/no longer in your library/);
  });
});
