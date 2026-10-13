import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DETECTOR_VERSION, loadLexicon, USER_SCOPE } from '../../src/core/lexicon';
import { openStore } from '../../src/store';
import type { AppContext, ImportedBook, LexiconEntry } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { novel } from '../helpers/novel';

let n = 0;
const dbName = () => `lex-${++n}-${Math.random().toString(36).slice(2)}`;
const entry = (word: string, over: Partial<LexiconEntry> = {}): LexiconEntry => ({
  word, pinyin: 'guo1 jing4', gloss: 'name (person)', kind: 'name', count: 9, enabled: true, origin: 'auto', ...over,
});

describe('store.lexicon', () => {
  it('keeps rows per scope, replaces only the detected rows, and remembers the detector version', async () => {
    const store = await openStore(dbName());
    expect(await store.lexicon.get('b1')).toEqual([]);
    expect(await store.lexicon.detected('b1')).toBe(false);

    await store.lexicon.upsert('b1', entry('黄蓉', { origin: 'user', gloss: 'mine' }));
    await store.lexicon.upsert('b1', entry('欧阳锋', { enabled: false }));
    await store.lexicon.putDetected('b1', [entry('郭靖'), entry('黄蓉'), entry('欧阳锋'), entry('洪七公')], 3);
    const rows = new Map((await store.lexicon.get('b1')).map((r) => [r.word, r]));
    expect([...rows.keys()].sort()).toEqual(['欧阳锋', '洪七公', '郭靖', '黄蓉'].sort());
    expect(rows.get('黄蓉')?.gloss).toBe('mine'); // the user's row survives a re-detection
    expect(rows.get('欧阳锋')?.enabled).toBe(false); // a rejected word stays rejected
    expect(rows.get('郭靖')).toEqual(entry('郭靖'));
    expect((rows.get('郭靖') as { scope?: string }).scope).toBeUndefined();

    // A second detection replaces the auto rows: 洪七公 is gone, 一灯 is new.
    await store.lexicon.putDetected('b1', [entry('郭靖'), entry('一灯')], 3);
    expect((await store.lexicon.get('b1')).map((r) => r.word).sort()).toEqual(['一灯', '欧阳锋', '郭靖', '黄蓉'].sort());

    expect(await store.lexicon.detected('b1')).toBe(true);
    expect(await store.lexicon.detected('b1', 3)).toBe(true);
    expect(await store.lexicon.detected('b1', 4)).toBe(false);
    expect(await store.lexicon.detected('b2')).toBe(false);
    expect(await store.lexicon.get('b2')).toEqual([]);

    await store.lexicon.remove('b1', '一灯');
    expect((await store.lexicon.get('b1')).some((r) => r.word === '一灯')).toBe(false);
  });

  it('survives a reload and a migration from a version 1 database', async () => {
    const name = dbName();
    // Build a v1 database by hand with a book in it.
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('chapters', { keyPath: ['bookId', 'index'] });
        db.createObjectStore('assets', { keyPath: ['bookId', 'name'] });
        db.createObjectStore('progress', { keyPath: 'bookId' });
        db.createObjectStore('vocab', { keyPath: 'id' });
        db.createObjectStore('known', { keyPath: 'word' });
        db.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true });
      };
      r.onsuccess = () => {
        const tx = r.result.transaction('books', 'readwrite');
        tx.objectStore('books').put({ id: 'old', title: '旧书', author: '', format: 'txt', script: 'simplified', addedAt: 1, chapterCount: 0, charCount: 0, chapterOffsets: [], chapterTitles: [] });
        tx.oncomplete = () => { r.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
    const a = await openStore(name);
    expect((await a.books.list()).map((b) => b.id)).toEqual(['old']);
    await a.lexicon.upsert(USER_SCOPE, entry('单于', { origin: 'user', pinyin: 'chan2 yu2' }));
    const b = await openStore(name);
    expect((await b.lexicon.get(USER_SCOPE)).map((r) => r.word)).toEqual(['单于']);
  });

  it('is removed with its book, and wipe clears it', async () => {
    const store = await openStore(dbName());
    const meta = await store.books.add(book('x'));
    await store.lexicon.putDetected(meta.id, [entry('郭靖')], 1);
    await store.lexicon.upsert(USER_SCOPE, entry('单于', { origin: 'user' }));
    await store.books.remove(meta.id);
    expect(await store.lexicon.get(meta.id)).toEqual([]);
    expect(await store.lexicon.detected(meta.id)).toBe(false);
    expect((await store.lexicon.get(USER_SCOPE)).length).toBe(1);
    await store.wipe();
    expect(await store.lexicon.get(USER_SCOPE)).toEqual([]);
  });

  it('puts the user rows and the rejected rows in a backup, not the detected ones, and merges them back', async () => {
    const a = await openStore(dbName());
    await a.lexicon.putDetected('b1', [entry('郭靖'), entry('欧阳锋')], 1);
    await a.lexicon.upsert('b1', entry('欧阳锋', { enabled: false }));
    await a.lexicon.upsert('b1', entry('桃花岛', { kind: 'place', origin: 'user', gloss: 'home' }));
    await a.lexicon.upsert(USER_SCOPE, entry('单于', { origin: 'user' }));
    const json = await a.exportBackup();
    const parsed = JSON.parse(json) as { lexicon: { scope: string; word: string }[] };
    expect(parsed.lexicon.map((r) => `${r.scope}:${r.word}`).sort()).toEqual(['*:单于', 'b1:桃花岛', 'b1:欧阳锋'].sort());

    const b = await openStore(dbName());
    await b.lexicon.upsert('b1', entry('桃花岛', { kind: 'place', origin: 'user', gloss: 'already here' }));
    await b.importBackup(json);
    const rows = new Map((await b.lexicon.get('b1')).map((r) => [r.word, r]));
    expect(rows.get('桃花岛')?.gloss).toBe('already here'); // existing rows win
    expect(rows.get('欧阳锋')?.enabled).toBe(false);
    expect((await b.lexicon.get(USER_SCOPE)).map((r) => r.word)).toEqual(['单于']);
    // A damaged row is skipped, not fatal.
    const bad = JSON.stringify({ app: 'dushu', version: 1, lexicon: [null, { scope: 'b9' }, { scope: 'b9', word: '甲乙', pinyin: 'jia3 yi3' }] });
    await b.importBackup(bad);
    expect((await b.lexicon.get('b9')).map((r) => r.word)).toEqual(['甲乙']);
  });
});

function book(text: string): ImportedBook {
  return { title: 't', author: '', format: 'txt', script: 'simplified', chapters: [{ title: 'c', blocks: [{ t: 'p', text }] }], assets: new Map() };
}

describe('loadLexicon', () => {
  it('returns at once, detects in the background, saves, calls back, and does not run again', async () => {
    const store = await openStore(dbName());
    const dict = await loadTestDictionary();
    const ctx = { store, dict: async () => dict, dictSync: () => dict } as unknown as AppContext;
    const paras = novel(9, 700).split('\n');
    const half = Math.floor(paras.length / 2);
    const meta = await store.books.add({
      ...book(''),
      chapters: [
        { title: '一', blocks: paras.slice(0, half).map((text) => ({ t: 'p' as const, text })) },
        { title: '二', blocks: paras.slice(half).map((text) => ({ t: 'p' as const, text })) },
      ],
    });
    await store.lexicon.upsert(USER_SCOPE, entry('单于', { origin: 'user' }));

    let updated: unknown = null;
    const first = await loadLexicon(ctx, meta.id, (lex) => { updated = lex; });
    expect(first.has('单于')).toBe(true); // user rows are there at once
    expect(first.has('莫远峰')).toBe(false);
    for (let i = 0; i < 100 && !updated; i++) await new Promise((r) => setTimeout(r, 50));
    expect(updated).not.toBeNull();
    expect(await store.lexicon.detected(meta.id, DETECTOR_VERSION)).toBe(true);
    const second = await loadLexicon(ctx, meta.id, () => { throw new Error('no second detection'); });
    expect(second.has('莫远峰')).toBe(true);
    expect(second.has('单雨晴')).toBe(true);
    expect(second.has('单于')).toBe(true);
    expect((await store.lexicon.get(meta.id)).every((r) => r.origin === 'auto')).toBe(true);
  });

  it('a book that is not there gives the user rows only', async () => {
    const store = await openStore(dbName());
    const dict = await loadTestDictionary();
    const ctx = { store, dict: async () => dict, dictSync: () => dict } as unknown as AppContext;
    const lex = await loadLexicon(ctx, 'missing');
    expect(lex.entries()).toEqual([]);
  });
});
