import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY, MINUTE, newSrs, sanitizeSrs } from '../../src/core/srs';
import { openStore } from '../../src/store';
import { ABORT_MESSAGE, abortError, createIdbBackend, friendlyError, QUOTA_MESSAGE } from '../../src/store/db';
import type { ImportedBook, VocabItem } from '../../src/types';

let n = 0;
const dbName = () => `hard-${++n}-${Math.random().toString(36).slice(2)}`;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const item = (simp: string, over: Partial<VocabItem> = {}): VocabItem => ({
  id: simp, simp, trad: simp, pinyin: 'shu1', gloss: 'book', addedAt: 1000, srs: newSrs(1000), ...over,
});
const backup = (data: object) => JSON.stringify({ app: 'dushu', version: 1, ...data });

describe('IndexedDB that never answers', () => {
  it('falls back to memory after the timeout and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // An open request that never fires a handler: the WebKit startup bug.
    vi.stubGlobal('indexedDB', { open: () => ({}) });
    const t0 = Date.now();
    const store = await openStore(dbName(), { idbTimeoutMs: 60 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(store.backend).toBe('memory');
    expect(warn).toHaveBeenCalled();
    await store.vocab.put(item('书'));
    expect(store.vocab.has('书')).toBe(true);
  });

  it('still opens IndexedDB when it answers in time', async () => {
    const store = await openStore(dbName(), { idbTimeoutMs: 5000 });
    expect(store.backend).toBe('idb');
  });
});

describe('storage errors', () => {
  it('maps an abort with no reason to the out-of-space message', () => {
    expect(abortError(null).message).toBe(ABORT_MESSAGE);
    expect(abortError(undefined).message).toBe(ABORT_MESSAGE);
    expect(abortError(Object.assign(new Error('x'), { name: 'QuotaExceededError' })).message).toBe(QUOTA_MESSAGE);
    expect(abortError(new Error('other')).message).toBe('other');
    expect(friendlyError(undefined).message).toBe('Storage error');
  });

  it('a transaction aborted by the browser rejects with that message', async () => {
    const backend = await createIdbBackend(dbName());
    const original = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      // An abort the browser starts itself leaves tx.error null.
      if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());
      return tx;
    } as never);
    await expect(backend.commit([{ op: 'put', table: 'known', value: { word: '你' } }])).rejects.toThrow(ABORT_MESSAGE);
  });
});

describe('other tabs', () => {
  it('tells a second store with the same database about every kind of change, and it reloads first', async () => {
    const name = dbName();
    const a = await openStore(name);
    const b = await openStore(name);
    const seen: string[] = [];
    b.onChange((what, info) => seen.push(`${what}:${info?.remote ? 'remote' : 'local'}`));
    const settle = () => new Promise((r) => setTimeout(r, 30));

    await a.vocab.put(item('书'));
    await settle();
    expect(b.vocab.has('书')).toBe(true); // reloaded before the listener ran
    await a.known.add(['你']);
    await settle();
    expect(b.known.has('你')).toBe(true);
    const book: ImportedBook = {
      title: 't', author: '', format: 'txt', script: 'simplified', assets: new Map(),
      chapters: [{ title: 'c', blocks: [{ t: 'p', text: '你好' }] }],
    };
    const meta = await a.books.add(book);
    await settle();
    await a.books.remove(meta.id);
    await a.vocab.remove('书');
    await settle();
    expect(b.vocab.has('书')).toBe(false);
    expect(seen).toEqual(['vocab:remote', 'known:remote', 'books:remote', 'books:remote', 'vocab:remote']);
  });

  it('does not echo a change back to the tab that made it, and ignores other databases', async () => {
    const a = await openStore(dbName());
    const other = await openStore(dbName());
    const aSeen: string[] = [];
    const otherSeen: string[] = [];
    a.onChange((w, info) => aSeen.push(`${w}:${info?.remote ? 'remote' : 'local'}`));
    other.onChange((w) => otherSeen.push(w));
    await a.vocab.put(item('水'));
    await new Promise((r) => setTimeout(r, 30));
    expect(aSeen).toEqual(['vocab:local']);
    expect(otherSeen).toEqual([]);
  });

  it('works without BroadcastChannel (stores in one page still hear each other)', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const name = dbName();
    const a = await openStore(name);
    const b = await openStore(name);
    await a.known.add(['火']);
    await new Promise((r) => setTimeout(r, 30));
    expect(b.known.has('火')).toBe(true);
  });
});

describe('restoring a backup', () => {
  it('never switches the translator to a third party', async () => {
    const store = await openStore(dbName());
    for (const translator of ['mymemory', 'claude']) {
      const r = await store.importBackup(backup({ settings: { translator, theme: 'dark' } }));
      expect(r.settings).toEqual({ theme: 'dark' });
    }
    // Translators that stay on the device may be restored.
    expect((await store.importBackup(backup({ settings: { translator: 'local' } }))).settings).toEqual({ translator: 'local' });
    expect((await store.importBackup(backup({ settings: { translator: 'gloss' } }))).settings).toEqual({ translator: 'gloss' });
  });

  it('refuses a 5 MB word and cuts a 5 MB note', async () => {
    const store = await openStore(dbName());
    const huge = '长'.repeat(5_000_000);
    const r = await store.importBackup(backup({
      vocab: [item(huge), item('好', { gloss: huge, pinyin: huge, context: { sentence: huge, bookTitle: huge } })],
      known: [huge, '你'],
      reviews: [{ itemId: huge, grade: 2, at: 5 }, { itemId: '好', grade: 2, at: 5 }],
      lexicon: [{ scope: 'b', word: '天', pinyin: huge, gloss: huge, kind: 'name', enabled: true, origin: 'user' }],
    }));
    expect(r.vocab).toEqual({ added: 1, updated: 0, skipped: 1 });
    expect(r.known.added).toBe(1);
    expect(r.reviews.added).toBe(1);
    const v = (await store.vocab.get('好'))!;
    expect(v.gloss.length).toBeLessThanOrEqual(2000);
    expect(v.pinyin.length).toBeLessThanOrEqual(200);
    expect(v.context!.sentence.length).toBeLessThanOrEqual(1000);
    expect(v.context!.bookTitle!.length).toBeLessThanOrEqual(200);
    const lex = await store.lexicon.get('b');
    expect(lex[0].gloss.length).toBeLessThanOrEqual(2000);
  });

  it('turns NaN and wild scheduling numbers into sane ones', async () => {
    const store = await openStore(dbName());
    const bad = { due: 'soon', interval: 1e308, ease: -4, reps: 1e300, lapses: -5, last: -1 };
    const nan = JSON.parse(JSON.stringify({ ...item('金'), srs: { due: null, interval: null, ease: null, reps: null, lapses: null } }));
    const raw = JSON.stringify({ app: 'dushu', version: 1, vocab: [{ ...item('木'), srs: bad }, nan, { ...item('水'), srs: { ...newSrs(1000), due: 1e20 } }] });
    await store.importBackup(raw);
    for (const id of ['木', '金', '水']) {
      const s = (await store.vocab.get(id))!.srs;
      for (const k of ['due', 'interval', 'ease', 'reps', 'lapses'] as const) expect(Number.isFinite(s[k]), `${id}.${k}`).toBe(true);
      expect(s.interval).toBeLessThanOrEqual(36500);
      expect(s.ease).toBeGreaterThanOrEqual(1.3);
      expect(s.ease).toBeLessThanOrEqual(5);
      expect(s.reps).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('sanitizeSrs', () => {
  it('keeps a valid state exactly', () => {
    const s = { due: 5 * DAY, interval: 4, ease: 2.36, reps: 3, lapses: 1, last: 4 * DAY };
    expect(sanitizeSrs(s, 0)).toEqual(s);
    expect(sanitizeSrs({ due: 10 * MINUTE, interval: 0, ease: 2.5, reps: 0, lapses: 0 }, 0)).toEqual({ due: 10 * MINUTE, interval: 0, ease: 2.5, reps: 0, lapses: 0 });
  });

  it('replaces anything that is not an object with a new card', () => {
    for (const v of [null, undefined, 4, 'x', [], NaN]) expect(sanitizeSrs(v, 777)).toEqual(newSrs(777));
  });

  it('keeps a forged due date from hiding a card forever', () => {
    const s = sanitizeSrs({ due: 8e15, interval: 0, ease: 2.5, reps: 0, lapses: 0 }, 1000);
    expect(s.due).toBeLessThanOrEqual(1000 + 36500 * DAY);
  });

  it('drops a last-review time that is not a real time', () => {
    expect(sanitizeSrs({ ...newSrs(0), last: Infinity }, 0).last).toBeUndefined();
    expect(sanitizeSrs({ ...newSrs(0), last: 1e20 }, 0).last).toBeUndefined();
  });
});
