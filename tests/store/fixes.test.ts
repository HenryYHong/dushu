// The reader's corrections in the store (store.fixes, core/fixes.ts): kept under the book's key, kept when the book is deleted,
// in backups, applied from another device in one transaction, and the user's old rows of a book's names and terms adopted once.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { fixId, makeFix } from '../../src/core/fixes';
import { USER_SCOPE } from '../../src/core/lexicon';
import { bookKey } from '../../src/core/syncKeys';
import { openStore } from '../../src/store';
import type { Fix, ImportedBook, LexiconEntry, StoreChange } from '../../src/types';

let n = 0;
const dbName = () => `fixes-${++n}-${Math.random().toString(36).slice(2)}`;
const book = (): ImportedBook => ({
  title: '河边', author: '某人', format: 'txt', script: 'simplified', assets: new Map(), sourceName: 'hebian.txt',
  chapters: [{ title: '一', blocks: [{ t: 'p', text: '子君说道：先生来了。' }] }],
});
const fix = (bookId: string, key: string, o: Partial<Fix> & Pick<Fix, 'kind' | 'word'>): Fix =>
  makeFix({ book: key, bookId, t: 1000, ...o } as Parameters<typeof makeFix>[0]);
const entry = (word: string, over: Partial<LexiconEntry> = {}): LexiconEntry => ({
  word, pinyin: 'zi3 jun1', gloss: 'name (person)', kind: 'name', count: 9, enabled: true, origin: 'auto', ...over,
});

describe('store.fixes', () => {
  it('keeps fixes by id, refuses what is not one, and tells the screens', async () => {
    const store = await openStore(dbName());
    const heard: StoreChange[] = [];
    store.onChange((w) => heard.push(w));
    const cut = fix('b1', 'bk', { kind: 'cut', word: '先生', cuts: [1] });
    await store.fixes.put([cut, { ...cut, id: 'bad', cuts: [] }]);
    expect(await store.fixes.list()).toEqual([cut]);
    expect(heard).toEqual(['fixes']);
    await store.fixes.put([{ ...cut, on: false, t: 2000 }]);
    expect((await store.fixes.list())[0]).toMatchObject({ on: false, t: 2000 });
    await store.fixes.remove([cut.id]);
    expect(await store.fixes.list()).toEqual([]);
  });

  it('keeps a book\'s fixes when the book is deleted, so they come back with it', async () => {
    const store = await openStore(dbName());
    const meta = await store.books.add(book());
    const f = fix(meta.id, bookKey(meta), { kind: 'word', word: '子君', pinyin: 'zi3 jun1', role: 'name' });
    await store.fixes.put([f]);
    await store.books.remove(meta.id);
    expect(await store.fixes.list()).toEqual([f]);
  });

  it('adopts the user\'s own rows of the book\'s names and terms once, and those of every book', async () => {
    const store = await openStore(dbName());
    await store.lexicon.putDetected('b1', [entry('郭靖'), entry('黄蓉')], 9);
    await store.lexicon.upsert('b1', entry('子君', { origin: 'user', gloss: 'a friend' }));
    await store.lexicon.upsert('b1', entry('黄蓉', { origin: 'user', enabled: false }));
    await store.lexicon.upsert(USER_SCOPE, entry('书生', { origin: 'user', kind: 'user', pinyin: 'shu1 sheng1', gloss: '' }));
    await store.lexicon.upsert('b2', entry('别人', { origin: 'user' }));
    expect(await store.fixes.adopt('b1', 'bkey')).toBe(3);
    const fixes = new Map((await store.fixes.list()).map((f) => [f.word, f]));
    expect(fixes.get('子君')).toMatchObject({ id: fixId('bkey', 'word', '子君'), book: 'bkey', bookId: 'b1', kind: 'word', role: 'name', gloss: 'a friend', pinyin: 'zi3 jun1', on: true, t: 0 });
    expect(fixes.get('黄蓉')).toMatchObject({ kind: 'unword', book: 'bkey' });
    expect(fixes.get('书生')).toMatchObject({ book: '*', bookId: '*', kind: 'word', role: 'user' });
    expect(fixes.has('别人')).toBe(false); // another book's
    // The rows are gone from the names and terms; what was found stays.
    expect((await store.lexicon.get('b1')).map((r) => r.word).sort()).toEqual(['郭靖', '黄蓉'].sort());
    expect((await store.lexicon.get('b1')).every((r) => r.origin === 'auto')).toBe(true);
    expect(await store.lexicon.get(USER_SCOPE)).toEqual([]);
    expect(await store.fixes.adopt('b1', 'bkey')).toBe(0);
  });

  it('never replaces a fix with an adopted row', async () => {
    const store = await openStore(dbName());
    const mine = fix('b1', 'bkey', { kind: 'word', word: '子君', pinyin: 'zi3 jun1', gloss: 'newer', t: 5000 });
    await store.fixes.put([mine]);
    await store.lexicon.upsert('b1', entry('子君', { origin: 'user', gloss: 'older' }));
    await store.fixes.adopt('b1', 'bkey');
    expect(await store.fixes.list()).toEqual([mine]);
    expect(await store.lexicon.get('b1')).toEqual([]);
  });

  it('applies fixes from another device in the same transaction as their sync rows, heard as remote', async () => {
    const store = await openStore(dbName());
    const heard: [StoreChange, boolean][] = [];
    store.onChange((w, info) => heard.push([w, !!info?.remote]));
    const f = fix('b1', 'bk', { kind: 'reading', word: '人家', pinyin: 'ren2 jia5' });
    await store.sync.apply({ fixesPut: [f], rows: [{ key: `l:fix:${f.id}`, at: 1000, sig: 'x' }] });
    expect(await store.fixes.list()).toEqual([f]);
    expect((await store.sync.rows()).map((r) => r.key)).toEqual([`l:fix:${f.id}`]);
    expect(heard).toEqual([['fixes', true]]);
    await store.sync.apply({ fixesDel: [f.id] });
    expect(await store.fixes.list()).toEqual([]);
  });

  it('goes into a backup and comes back from one onto the same book', async () => {
    const a = await openStore(dbName());
    const meta = await a.books.add(book());
    const f = fix(meta.id, bookKey(meta), { kind: 'cut', word: '先生', cuts: [1] });
    await a.fixes.put([f]);
    const json = await a.exportBackup();
    expect(JSON.parse(json).fixes).toEqual([f]);
    const b = await openStore(dbName());
    const there = await b.books.add(book());
    await b.importBackup(json);
    const got = await b.fixes.list();
    expect(got).toHaveLength(1);
    // The same book (by its contents' digest) on the other device: the fix is on it.
    expect(got[0]).toMatchObject({ id: f.id, book: f.book, bookId: there.id });
    // A fix already there stays as it is.
    await b.fixes.put([{ ...got[0], on: false, t: 9000 }]);
    await b.importBackup(json);
    expect((await b.fixes.list())[0]).toMatchObject({ on: false, t: 9000 });
  });
});
