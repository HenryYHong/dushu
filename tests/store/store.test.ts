import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAY, MINUTE, newSrs } from '../../src/core/srs';
import { openStore, type DushuStore } from '../../src/store';
import { DB_VERSION } from '../../src/store/db';
import type { ImportedBook, VocabItem } from '../../src/types';

/** 1x1 PNG: the store keeps an asset only when its bytes are a raster image. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

let n = 0;
const dbName = () => `test-${++n}-${Math.random().toString(36).slice(2)}`;

function sampleBook(): ImportedBook {
  return {
    title: '测试', author: '作者', format: 'txt', script: 'simplified',
    chapters: [
      { title: '第一章', blocks: [{ t: 'p', text: '你好，世界！abc' }, { t: 'img', asset: 'a.png' }, { t: 'hr' }] },
      { title: '二', blocks: [{ t: 'h', level: 2, text: '𠀀𪚥' }, { t: 'quote', text: '〇一' }] },
      { title: 'x', blocks: [] },
    ],
    assets: new Map([['a.png', new Blob([PNG], { type: 'image/png' })]]),
    cover: 'a.png', sourceName: 'x.txt',
  };
}

const vocab = (simp: string, trad = simp, over: Partial<VocabItem> = {}): VocabItem => ({
  id: simp, simp, trad, pinyin: 'yin2 hang2', gloss: 'bank', addedAt: 1000, srs: newSrs(1000), ...over,
});

let store: DushuStore;
let name: string;
beforeEach(async () => { name = dbName(); store = await openStore(name); });
afterEach(() => { vi.restoreAllMocks(); });

describe('books', () => {
  it('add computes counts and offsets, round-trips chapters', async () => {
    const meta = await store.books.add(sampleBook());
    // chapter 1: 第一章(3)+你好世界(4)=7; chapter 2: 二(1)+2 astral+〇一(2)=5
    expect(meta.chapterCount).toBe(3);
    expect(meta.chapterOffsets).toEqual([0, 7, 12]);
    expect(meta.charCount).toBe(12);
    expect(meta.cover).toBe('a.png');
    expect(await store.books.get(meta.id)).toEqual(meta);
    expect((await store.books.list()).map((b) => b.id)).toEqual([meta.id]);
    expect((await store.books.chapter(meta.id, 1))?.title).toBe('二');
    expect(await store.books.chapter(meta.id, 9)).toBeUndefined();
    expect(await store.books.get('nope')).toBeUndefined();
  });

  it('update merges, keeps id, throws for missing', async () => {
    const meta = await store.books.add(sampleBook());
    await store.books.update(meta.id, { title: 'New', lastOpenedAt: 5, id: 'hack' } as never);
    const got = await store.books.get(meta.id);
    expect(got).toMatchObject({ id: meta.id, title: 'New', lastOpenedAt: 5, author: '作者' });
    await expect(store.books.update('nope', { title: 'x' })).rejects.toThrow(/no longer/);
  });

  it('list is most recent first', async () => {
    const a = await store.books.add(sampleBook());
    const b = await store.books.add(sampleBook());
    await store.books.update(a.id, { lastOpenedAt: Date.now() + 10_000 });
    expect((await store.books.list()).map((x) => x.id)).toEqual([a.id, b.id]);
  });

  it('assetUrl returns a cached object URL, undefined when missing', async () => {
    const meta = await store.books.add(sampleBook());
    const u1 = await store.books.assetUrl(meta.id, 'a.png');
    expect(u1).toMatch(/^blob:/);
    expect(await store.books.assetUrl(meta.id, 'a.png')).toBe(u1);
    expect(await store.books.assetUrl(meta.id, 'missing')).toBeUndefined();
    const blob = await (await fetch(u1!)).blob().catch(() => null);
    if (blob) expect(blob.size).toBe(PNG.length);
  });

  it('remove cascades: chapters, assets, progress; vocab stays', async () => {
    const keep = await store.books.add(sampleBook());
    const meta = await store.books.add(sampleBook());
    await store.progress.set({ bookId: meta.id, chapter: 1, block: 2, percent: 0.4, updatedAt: 1 });
    await store.progress.set({ bookId: keep.id, chapter: 0, block: 0, percent: 0, updatedAt: 1 });
    await store.vocab.put(vocab('银行', '銀行'));
    const url = await store.books.assetUrl(meta.id, 'a.png');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const events: string[] = [];
    store.onChange((w) => events.push(w));
    await store.books.remove(meta.id);
    expect(await store.books.get(meta.id)).toBeUndefined();
    expect(await store.books.chapter(meta.id, 0)).toBeUndefined();
    expect(await store.books.chapter(meta.id, 2)).toBeUndefined();
    expect(await store.books.assetUrl(meta.id, 'a.png')).toBeUndefined();
    expect(await store.progress.get(meta.id)).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith(url);
    expect(events).toEqual(['books']);
    // the other book is untouched
    expect((await store.books.chapter(keep.id, 0))?.title).toBe('第一章');
    expect(await store.books.assetUrl(keep.id, 'a.png')).toMatch(/^blob:/);
    expect(await store.progress.get(keep.id)).toBeDefined();
    expect(await store.vocab.get('银行')).toBeDefined();
  });

  it('data persists across reopen', async () => {
    const meta = await store.books.add(sampleBook());
    await store.vocab.put(vocab('书'));
    await store.known.add(['你']);
    const again = await openStore(name);
    expect(await again.books.get(meta.id)).toEqual(meta);
    expect(again.vocab.has('书')).toBe(true);
    expect(again.known.has('你')).toBe(true);
    expect(again.backend).toBe('idb');
  });
});

describe('progress', () => {
  it('round trips and overwrites', async () => {
    const p = { bookId: 'b', chapter: 1, block: 2, percent: 0.5, updatedAt: 9 };
    await store.progress.set(p);
    expect(await store.progress.get('b')).toEqual(p);
    await store.progress.set({ ...p, block: 7 });
    expect((await store.progress.get('b'))?.block).toBe(7);
    expect(await store.progress.get('zz')).toBeUndefined();
  });

  it('keeps the offset of a page that starts mid-paragraph, also through a backup', async () => {
    const p = { bookId: 'b', chapter: 1, block: 2, offset: 37, percent: 0.5, updatedAt: 9 };
    await store.progress.set(p);
    expect(await store.progress.get('b')).toEqual(p);
    const other = await openStore(dbName());
    await other.importBackup(await store.exportBackup());
    expect(await other.progress.get('b')).toEqual(p);
    // Junk offsets are dropped, not stored.
    await other.importBackup(JSON.stringify({ app: 'dushu', version: 1, progress: [{ bookId: 'c', chapter: 0, block: 1, offset: -3, percent: 0.1, updatedAt: 1 }] }));
    expect((await other.progress.get('c'))?.offset).toBeUndefined();
  });
});

describe('vocab', () => {
  it('put/get/list/remove and sync has() in both scripts', async () => {
    await store.vocab.put(vocab('银行', '銀行'));
    expect(await store.vocab.get('银行')).toMatchObject({ trad: '銀行' });
    expect((await store.vocab.list()).length).toBe(1);
    expect(store.vocab.has('银行')).toBe(true);
    expect(store.vocab.has('銀行')).toBe(true); // trad stored on the item
    expect(store.vocab.has('书')).toBe(false);
    await store.vocab.remove('银行');
    expect(store.vocab.has('银行')).toBe(false);
    expect(store.vocab.has('銀行')).toBe(false);
    expect(await store.vocab.get('银行')).toBeUndefined();
  });

  it('due filters and sorts', async () => {
    await store.vocab.put(vocab('a', 'a', { srs: { ...newSrs(0), due: 300 } }));
    await store.vocab.put(vocab('b', 'b', { srs: { ...newSrs(0), due: 100 } }));
    await store.vocab.put(vocab('c', 'c', { srs: { ...newSrs(0), due: 900 } }));
    expect((await store.vocab.due(500)).map((v) => v.id)).toEqual(['b', 'a']);
    expect(await store.vocab.due(50)).toEqual([]);
  });

  it('review schedules, persists and logs', async () => {
    await store.vocab.put(vocab('书'));
    const t = 5_000_000;
    const r1 = await store.vocab.review('书', 2, t);
    expect(r1.srs.due).toBe(t + 10 * MINUTE);
    const r2 = await store.vocab.review('书', 2, t + 10 * MINUTE);
    expect(r2.srs.interval).toBe(1);
    expect(r2.srs.due).toBe(t + 10 * MINUTE + DAY);
    expect((await store.vocab.get('书'))?.srs).toEqual(r2.srs);
    const logs = await store.vocab.logs();
    expect(logs.map((l) => [l.itemId, l.grade, l.at])).toEqual([['书', 2, t], ['书', 2, t + 10 * MINUTE]]);
    expect(logs[0].id).toBeTypeOf('number');
    await expect(store.vocab.review('nope', 1, t)).rejects.toThrow(/no longer/);
  });

  it('concurrent reviews of one card are serialized', async () => {
    await store.vocab.put(vocab('书'));
    await Promise.all([store.vocab.review('书', 2, 1), store.vocab.review('书', 2, 2)]);
    const item = await store.vocab.get('书');
    expect(item?.srs.interval).toBe(1); // second review saw the first
    expect((await store.vocab.logs()).length).toBe(2);
  });

  it('rejects an item without an id', async () => {
    await expect(store.vocab.put(vocab(''))).rejects.toThrow();
  });
});

describe('known + normalizer', () => {
  it('add/has/remove/all/count', async () => {
    await store.known.add(['你好', ' 世界 ', '', '你好']);
    expect(store.known.count()).toBe(2);
    expect(store.known.all().sort()).toEqual(['世界', '你好']);
    expect(store.known.has('世界')).toBe(true);
    await store.known.remove(['你好', 'missing']);
    expect(store.known.has('你好')).toBe(false);
    expect(store.known.count()).toBe(1);
  });

  it('matches across scripts only once the normalizer is set', async () => {
    const map: Record<string, string> = { '銀': '银', '開': '开' };
    const toSimp = (w: string) => [...w].map((c) => map[c] ?? c).join('');
    await store.known.add(['银行']);
    await store.vocab.put(vocab('开心', '開心'));
    expect(store.known.has('銀行')).toBe(false);
    store.setNormalizer(toSimp);
    expect(store.known.has('銀行')).toBe(true);
    expect(store.known.has('银行')).toBe(true);
    expect(store.known.has('開行')).toBe(false);
    expect(store.vocab.has('开心')).toBe(true);
    expect(store.vocab.has('開心')).toBe(true);
    // adding after the normalizer is in place
    await store.known.add(['開']);
    expect(store.known.has('开')).toBe(true);
    // a trad-only entry matches its simplified form
    await store.known.add(['銀']);
    expect(store.known.has('银')).toBe(true);
    await store.known.remove(['银', '銀']);
    expect(store.known.has('银')).toBe(false);
    await store.vocab.put(vocab('银', '銀'));
    await store.vocab.remove('银');
    expect(store.vocab.has('銀')).toBe(false);
  });

  it('a throwing normalizer does not break has()', async () => {
    await store.known.add(['你']);
    store.setNormalizer(() => { throw new Error('boom'); });
    expect(store.known.has('你')).toBe(true);
    expect(store.known.has('他')).toBe(false);
  });

  it('known persists', async () => {
    await store.known.add(['你']);
    expect((await openStore(name)).known.has('你')).toBe(true);
  });
});

describe('events', () => {
  it('fires for each domain and unsubscribes', async () => {
    const ev: string[] = [];
    const off = store.onChange((w) => ev.push(w));
    await store.vocab.put(vocab('书'));
    await store.vocab.review('书', 2, 1);
    await store.known.add(['你']);
    await store.books.add(sampleBook());
    expect(ev).toEqual(['vocab', 'vocab', 'known', 'books']);
    off();
    await store.known.add(['他']);
    expect(ev.length).toBe(4);
  });
});

describe('backup', () => {
  it('round trip into a fresh store', async () => {
    await store.vocab.put(vocab('书'));
    await store.vocab.review('书', 3, 7000);
    await store.known.add(['你', '好']);
    await store.progress.set({ bookId: 'b1', chapter: 2, block: 3, percent: 0.3, updatedAt: 50 });
    const json = await store.exportBackup();
    const parsed = JSON.parse(json);
    expect(parsed).toMatchObject({ app: 'dushu', version: 1 });
    expect(parsed.vocab.length).toBe(1);
    expect(parsed.reviews.length).toBe(1);

    const fresh = await openStore(dbName());
    const report = await fresh.importBackup(json);
    expect(report).toMatchObject({
      vocab: { added: 1, updated: 0, skipped: 0 }, known: { added: 2 }, progress: { added: 1 }, reviews: { added: 1 },
    });
    expect(await fresh.vocab.get('书')).toEqual(await store.vocab.get('书'));
    expect(fresh.vocab.has('书')).toBe(true);
    expect(fresh.known.all().sort()).toEqual(['你', '好']);
    expect(await fresh.progress.get('b1')).toBeDefined();
    expect((await fresh.vocab.logs()).length).toBe(1);
  });

  it('importing twice changes nothing the second time', async () => {
    await store.vocab.put(vocab('书'));
    await store.vocab.review('书', 2, 7000);
    await store.known.add(['你']);
    const json = await store.exportBackup();
    const r = await store.importBackup(json);
    expect(r.vocab).toEqual({ added: 0, updated: 0, skipped: 1 });
    expect(r.known.added).toBe(0);
    expect(r.reviews.added).toBe(0);
    expect((await store.vocab.logs()).length).toBe(1);
  });

  it('merge: newer item wins, older is skipped; progress likewise; known unions', async () => {
    await store.vocab.put(vocab('书', '書', { gloss: 'local', srs: { ...newSrs(1000), last: 5000 } }));
    await store.vocab.put(vocab('水', '水', { gloss: 'local', srs: { ...newSrs(1000), last: 100 } }));
    await store.known.add(['a']);
    await store.progress.set({ bookId: 'b', chapter: 1, block: 0, percent: 0.5, updatedAt: 10 });
    await store.progress.set({ bookId: 'c', chapter: 1, block: 0, percent: 0.5, updatedAt: 10 });
    const backup = {
      app: 'dushu', version: 1,
      vocab: [
        vocab('书', '書', { gloss: 'older', srs: { ...newSrs(1000), last: 4000 } }),
        vocab('水', '水', { gloss: 'newer', srs: { ...newSrs(1000), last: 9000 } }),
        vocab('火'),
        { nonsense: true },
      ],
      known: ['a', 'b', 7],
      progress: [
        { bookId: 'b', chapter: 9, block: 0, percent: 0.9, updatedAt: 20 },
        { bookId: 'c', chapter: 9, block: 0, percent: 0.9, updatedAt: 5 },
        { bookId: 'd', chapter: 0, block: 0, percent: 2, updatedAt: 1 },
      ],
      settings: { fontSize: 99, claudeApiKey: 'sk-secret', localOnly: false, bogus: 1, theme: 'dark' },
    };
    const r = await store.importBackup(JSON.stringify(backup));
    expect(r.vocab).toEqual({ added: 1, updated: 1, skipped: 2 });
    expect(r.known.added).toBe(1);
    expect(r.progress).toEqual({ added: 1, updated: 1, skipped: 1 });
    expect((await store.vocab.get('书'))?.gloss).toBe('local');
    expect((await store.vocab.get('水'))?.gloss).toBe('newer');
    expect(store.vocab.has('火')).toBe(true);
    expect(store.known.has('b')).toBe(true);
    expect((await store.progress.get('b'))?.chapter).toBe(9);
    expect((await store.progress.get('c'))?.chapter).toBe(1);
    expect((await store.progress.get('d'))?.percent).toBe(1);
    expect(r.settings).toEqual({ fontSize: 44, theme: 'dark' });
  });

  it('importBackup emits events and returns the report', async () => {
    const json = JSON.stringify({ app: 'dushu', version: 1, vocab: [vocab('书')], known: ['你'] });
    const ev: string[] = [];
    store.onChange((w) => ev.push(w));
    expect((await store.importBackup(json)).vocab.added).toBe(1);
    expect(ev.sort()).toEqual(['known', 'vocab']);
  });

  it('export omits the API key and includes valid settings from localStorage', async () => {
    const data: Record<string, string> = { 'dushu.settings.v1': JSON.stringify({ theme: 'dark', claudeApiKey: 'sk-secret' }) };
    vi.stubGlobal('localStorage', { getItem: (k: string) => data[k] ?? null });
    const json = await store.exportBackup();
    vi.unstubAllGlobals();
    expect(json).not.toContain('sk-secret');
    expect(JSON.parse(json).settings.theme).toBe('dark');
    expect('claudeApiKey' in JSON.parse(json).settings).toBe(false);
  });

  it('rejects garbage with clear messages and writes nothing', async () => {
    await expect(store.importBackup('{nope')).rejects.toThrow(/not valid JSON/);
    await expect(store.importBackup('[]')).rejects.toThrow(/not a Dushu backup/);
    await expect(store.importBackup(JSON.stringify({ app: 'other' }))).rejects.toThrow(/not a Dushu backup/);
    await expect(store.importBackup(JSON.stringify({ app: 'dushu', version: 2 }))).rejects.toThrow(/newer version/);
    expect((await store.vocab.list()).length).toBe(0);
  });
});

describe('robustness', () => {
  it('falls back to memory with a warning when IndexedDB is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = globalThis.indexedDB;
    // @ts-expect-error simulate Safari private mode / blocked storage
    globalThis.indexedDB = undefined;
    try {
      const mem = await openStore(dbName());
      expect(mem.backend).toBe('memory');
      expect(warn).toHaveBeenCalled();
      const meta = await mem.books.add(sampleBook());
      expect((await mem.books.chapter(meta.id, 0))?.title).toBe('第一章');
      expect(meta.charCount).toBe(12);
      await mem.vocab.put(vocab('书'));
      const r = await mem.vocab.review('书', 2, 1);
      expect(r.srs.interval).toBe(0);
      expect((await mem.vocab.logs()).length).toBe(1);
      await mem.known.add(['你']);
      expect(mem.known.has('你')).toBe(true);
      expect(await mem.books.assetUrl(meta.id, 'a.png')).toMatch(/^blob:/);
      const json = await mem.exportBackup();
      expect(JSON.parse(json).vocab.length).toBe(1);
      await mem.books.remove(meta.id);
      expect(await mem.books.chapter(meta.id, 0)).toBeUndefined();
      expect(await mem.books.assetUrl(meta.id, 'a.png')).toBeUndefined();
    } finally {
      globalThis.indexedDB = saved;
    }
  });

  it('falls back to memory when open() fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = globalThis.indexedDB;
    globalThis.indexedDB = { open() { throw new DOMException('denied', 'SecurityError'); } } as unknown as IDBFactory;
    try { expect((await openStore(dbName())).backend).toBe('memory'); } finally { globalThis.indexedDB = saved; }
  });

  it('a newer on-disk version is a clear error, not silent data loss', async () => {
    const nm = dbName();
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open(nm, 5);
      r.onsuccess = () => { r.result.close(); res(); };
      r.onerror = () => rej(r.error);
    });
    await expect(openStore(nm)).rejects.toThrow(/newer version/);
  });

  it('quota errors become a readable Error', async () => {
    const { friendlyError, QUOTA_MESSAGE } = await import('../../src/store/db');
    const q = new DOMException('full', 'QuotaExceededError');
    expect(friendlyError(q).message).toBe(QUOTA_MESSAGE);
    // end to end: a failing put surfaces the message
    const orig = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError'); };
    try {
      await expect(store.known.add(['x'])).rejects.toThrow(/Not enough storage space/);
      expect(store.known.has('x')).toBe(false);
    } finally { IDBObjectStore.prototype.put = orig; }
  });

  it('closes on versionchange and fails cleanly (no hang) afterwards', async () => {
    await store.vocab.put(vocab('书'));
    // another connection asks for a higher version: ours must close, then reopen on demand
    const upgrade = new Promise<void>((res) => {
      const r = indexedDB.open(name, DB_VERSION + 1);
      r.onupgradeneeded = () => {};
      r.onsuccess = () => { r.result.close(); res(); };
    });
    await upgrade;
    // our schema version is older than the db's now: reopening reports a VersionError, not a hang
    await expect(store.vocab.list()).rejects.toBeTruthy();
  });
});

describe('wipe', () => {
  it('removes books, words, known words and logs, and keeps working', async () => {
    const store = await openStore('wipe-test-' + Math.random());
    await store.vocab.put(vocab('书'));
    await store.known.add(['你']);
    await store.wipe();
    expect(await store.vocab.list()).toEqual([]);
    expect(store.vocab.has('书')).toBe(false);
    expect(store.known.count()).toBe(0);
    await store.vocab.put(vocab('好'));
    expect(store.vocab.has('好')).toBe(true);
  });
});
