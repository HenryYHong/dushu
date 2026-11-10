// @vitest-environment jsdom
// Two things the app shell keeps right while it stays open: the Review badge goes up when a card falls due, and a book sync
// that cannot reach the server (offline, a dropped connection, no answer in time) is not an error: no toast with the
// browser's "Failed to fetch", and the book is not put aside for a day. The books here are made up; the server runs in process.
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../cloud/src/worker';
import { requestCode, signIn } from '../../src/core/cloud';
import { BOOKS_EVENT, syncBooks, type BooksReport } from '../../src/core/cloudBooks';
import { openStore } from '../../src/store';
import type { ImportedBook, Store, VocabItem } from '../../src/types';
import { cloud } from '../cloud/helpers';
import { installLayout } from '../reader/layoutFake';
import { bootApp } from './bootApp';

// A dictionary of one word: nothing here opens a book, so the real one would only slow the tests that run alongside.
vi.mock('../../src/core/dict', async (orig) => {
  const real = await orig<typeof import('../../src/core/dict')>();
  const files: Record<string, string> = {
    'cedict.tsv.gz': '山\t山\tshan1\tmountain', 'chars.tsv.gz': '山\tshan1', 'words.tsv.gz': '山\t100', 'hsk.tsv.gz': '山\t山\t1\t1\t5',
    't2s.tsv.gz': '', 's2t.tsv.gz': '', 'radicals.tsv.gz': '1\t⼀\t一', 'meta.json': '{}',
  };
  const fetchText = async (name: string) => { if (files[name] === undefined) throw new Error(`${name}: missing`); return files[name]; };
  return { ...real, loadDictionary: () => real.loadDictionary('/', { fetchText }) };
});
vi.mock('../../src/core/sync', async (orig) => ({ ...(await orig<typeof import('../../src/core/sync')>()), startSync: () => undefined }));
vi.mock('../../src/fonts', () => ({}));
vi.mock('../../src/ui/library/library', () => ({
  mount: (root: HTMLElement) => { root.appendChild(Object.assign(document.createElement('div'), { className: 'lib-page' })); return () => {}; },
}));

const BAD_KEY = 'dushu.cloud.books-bad.v1';

const book = (): ImportedBook => ({
  title: '山中', author: '某人', format: 'paste', script: 'simplified', assets: new Map(),
  chapters: [{ title: '第一章', blocks: [{ t: 'p', text: '山上有一座小房子。' }] }],
});

/** Signed in to the in-process server. `drop(url)` gives the error a request fails with (a lost connection, a timeout), or null. */
async function signedIn(drop: (url: string) => Error | null) {
  const c = cloud();
  let code = '';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const cut = drop(req.url);
    if (cut) throw cut;
    const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.arrayBuffer();
    const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body }), c.env);
    if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
    return res;
  });
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  await requestCode('reader@example.com');
  await signIn('reader@example.com', code);
}

describe('books in the account, without a connection', () => {
  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

  it('a download cut off is not an error and does not put the book aside: it comes down once the connection is back', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let offline = false;
    await signedIn((url) => (offline && url.includes('/books/chunk') ? new TypeError('Failed to fetch') : null));
    const [a, b] = [await openStore(`badge-books-a-${Math.random()}`), await openStore(`badge-books-b-${Math.random()}`)];
    await a.books.add(book());
    await syncBooks(a);
    const reports: BooksReport[] = [];
    const listen = (e: Event) => reports.push((e as CustomEvent<BooksReport>).detail);
    window.addEventListener(BOOKS_EVENT, listen);
    try {
      offline = true;
      expect(await syncBooks(b)).toEqual({ added: [], uploaded: 0 });
      expect(reports.filter((r) => r.error)).toEqual([]);
      expect(JSON.parse(localStorage.getItem(BAD_KEY) ?? '{}')).toEqual({});
      offline = false;
      expect((await syncBooks(b)).added.map((m) => m.title)).toEqual(['山中']);
    } finally {
      window.removeEventListener(BOOKS_EVENT, listen);
    }
  });

  it('a list that times out is not an error either', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let slow = false;
    await signedIn((url) => (slow && /\/books\?/.test(url) ? new DOMException('signal timed out', 'TimeoutError') : null));
    const store = await openStore(`badge-books-c-${Math.random()}`);
    const reports: BooksReport[] = [];
    const listen = (e: Event) => reports.push((e as CustomEvent<BooksReport>).detail);
    window.addEventListener(BOOKS_EVENT, listen);
    try {
      slow = true;
      await syncBooks(store);
      expect(reports).toEqual([]);
    } finally {
      window.removeEventListener(BOOKS_EVENT, listen);
    }
  });
});

describe('the Review badge', () => {
  let store: Store;
  beforeAll(async () => {
    installLayout();
    ({ store } = await bootApp());
  });

  const word = (id: string, due: number): VocabItem => ({
    id, simp: id, trad: id, pinyin: 'shan1', gloss: 'mountain', addedAt: Date.now(),
    srs: { due, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  });
  const badge = () => document.querySelector<HTMLElement>('.app-badge')!;

  it('goes up when a card falls due while the app is open, with nothing else happening', async () => {
    await store.vocab.put(word('山', Date.now() - 1000));
    await store.vocab.put(word('水', Date.now() + 1200));
    await vi.waitFor(() => expect(badge().textContent).toBe('1'));
    expect(badge().hidden).toBe(false);
    await vi.waitFor(() => expect(badge().textContent).toBe('2'), { timeout: 5000, interval: 100 });
  });

  it('is counted again when the app comes back to the front', async () => {
    // Saved straight into the database by another tab of an older version, which says nothing.
    const due = word('火', Date.now() - 1000);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('dushu');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('vocab', 'readwrite');
      tx.objectStore('vocab').put(due);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    expect(badge().textContent).toBe('2');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(badge().textContent).toBe('3'));
  });
});
