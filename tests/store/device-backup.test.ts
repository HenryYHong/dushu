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
