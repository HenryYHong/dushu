// @vitest-environment jsdom
// Each language's books in the sync account (core/cloudBooks.ts, the Worker's /books): a Japanese library keeps its books as
// '@ja:<key>' and is handed only those, a request that names no language is Chinese and never sees one, and deleting a book
// in one library leaves the same book in another. Against the Worker live today (tests/fixtures/released/cloud) a new
// Japanese library sends and takes nothing and says why; against the new Worker the Chinese app live today
// (tests/fixtures/released/cloudBooks.ts) sees exactly what it sees now, and the Worker rolled back to the one live today never
// hands a Chinese library a Japanese book. The books are made up; the server runs in process.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../cloud/src/worker';
import { requestCode, signIn } from '../../src/core/cloud';
import { BOOKS_EVENT, accountBooks, forgetBookInAccount, syncBooks, type BooksReport } from '../../src/core/cloudBooks';
import { bookKey } from '../../src/core/syncKeys';
import { setSyncEnabled } from '../../src/core/sync';
import { setLangForTests } from '../../src/lang/active';
import type { LangId } from '../../src/lang/types';
import { openStore } from '../../src/store';
import type { ImportedBook } from '../../src/types';
import * as releasedBooks from '../fixtures/released/cloudBooks';
import { cloud, signedIn } from './helpers';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); setLangForTests(null); });

/** Only kanji, so the Chinese and the Japanese library count it alike and give it the same key. */
const book = (title = '学生'): ImportedBook => ({
  title, author: '某', format: 'txt', script: 'unknown', assets: new Map(), sourceName: `${title}.txt`,
  chapters: [{ title: '一', blocks: [{ t: 'p', text: '学生先生大学' }] }, { title: '二', blocks: [{ t: 'p', text: '日本中国' }] }],
});

/** The account behind the page's fetch: today's Worker, or the one live today while `state.released`. */
async function account() {
  const state = { released: false };
  const c = cloud({ OWNER_EMAILS: 'reader@example.com' } as Partial<Env>, { released: () => state.released });
  let code = '';
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    calls.push(`${req.method} ${new URL(req.url).pathname}${new URL(req.url).search}`);
    const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.arrayBuffer();
    const res = await c.fetch(new Request(req.url, { method: req.method, headers: req.headers, body }));
    if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
    return res;
  });
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  await requestCode('reader@example.com');
  await signIn('reader@example.com', code);
  /** The book keys the account keeps, whatever the language. */
  const kept = () => [...c.stores.values()].flatMap((s) => s.books().map((b) => b.key)).sort();
  return { c, state, calls, kept };
}

/** A library of this page in `lang` (the page reads one language at a time, as the app does). */
async function library(lang: LangId) {
  setLangForTests(lang);
  return openStore(`books-lang-${lang}-${Math.random().toString(36).slice(2)}`);
}
const as = async <T>(lang: LangId, run: () => Promise<T>): Promise<T> => { setLangForTests(lang); return run(); };

describe('a language’s books in the account', () => {
  it('go up and come down in that language’s library only, and deleting one leaves the other language’s copy', async () => {
    const w = await account();
    const jaA = await library('ja');
    const meta = await jaA.books.add(book());
    const key = bookKey(meta);
    expect(await as('ja', () => syncBooks(jaA))).toMatchObject({ uploaded: 1 });
    expect(w.kept()).toEqual([`@ja:${key}`]);
    expect((await as('ja', accountBooks)).map((b) => b.key)).toEqual([key]);
    // Another device's Japanese library takes it; a Chinese library is not offered it.
    const jaB = await library('ja');
    expect((await as('ja', () => syncBooks(jaB))).added.map((m) => bookKey(m))).toEqual([key]);
    const zh = await library('zh');
    expect(await as('zh', () => syncBooks(zh))).toEqual({ added: [], uploaded: 0 });
    expect(await as('zh', accountBooks)).toEqual([]);

    // The same book in the Chinese library is a book of its own there, under the same key without a prefix.
    const zhMeta = await zh.books.add(book());
    expect(bookKey(zhMeta)).toBe(key);
    expect(await as('zh', () => syncBooks(zh))).toMatchObject({ uploaded: 1 });
    expect(w.kept()).toEqual([`@ja:${key}`, key]);
    // Deleted in Japanese: only the Japanese copy goes, and the Chinese one is not downloaded into Japanese.
    setLangForTests('ja');
    forgetBookInAccount(meta);
    await vi.waitFor(() => expect(w.kept()).toEqual([key]));
    expect(await as('ja', () => syncBooks(jaA))).toEqual({ added: [], uploaded: 0 });
    // Deleted in Chinese too: the account has neither, and each library keeps its own list of what it deleted.
    setLangForTests('zh');
    forgetBookInAccount(zhMeta);
    await vi.waitFor(() => expect(w.kept()).toEqual([]));
    expect(localStorage.getItem('dushu.ja.cloud.books-removed.v1')).toBe(JSON.stringify([key]));
    expect(localStorage.getItem('dushu.cloud.books-removed.v1')).toBe(JSON.stringify([key]));
  });

  it('follow the library’s Sync switch, so a library whose data was deleted stays empty', async () => {
    const w = await account();
    const ja = await library('ja');
    await ja.books.add(book());
    await as('ja', () => syncBooks(ja));
    const fresh = await library('ja');
    setSyncEnabled(false, 'ja');
    expect(await as('ja', () => syncBooks(fresh))).toEqual({ added: [], uploaded: 0 });
    setSyncEnabled(true, 'ja');
    expect((await as('ja', () => syncBooks(fresh))).added).toHaveLength(1);
    expect(w.kept()).toHaveLength(1);
  });
});

describe('a new Japanese library and the Worker live today', () => {
  it('sends nothing and takes nothing, says why, leaves the Chinese books alone, and goes up once the Worker is updated', async () => {
    const w = await account();
    w.state.released = true;
    const reports: BooksReport[] = [];
    window.addEventListener(BOOKS_EVENT, (e) => reports.push((e as CustomEvent<BooksReport>).detail));
    // The Chinese library (this site) keeps its book as ever.
    const zh = await library('zh');
    await zh.books.add(book('中国'));
    expect(await as('zh', () => syncBooks(zh))).toMatchObject({ uploaded: 1 });
    // The Japanese library: the Worker's list is its Chinese one, which is nothing of Japanese, and nothing goes up.
    const ja = await library('ja');
    const meta = await ja.books.add(book());
    expect(await as('ja', () => syncBooks(ja))).toEqual({ added: [], uploaded: 0 });
    expect(reports.at(-1)?.error).toBe('The sync server is older than this version of Dushu and does not keep Japanese books yet. They stay on this device until it is updated.');
    expect(w.calls.filter((c) => c.startsWith('POST /books')).length).toBe(1); // the Chinese one
    expect(w.kept()).toEqual([bookKey(await zh.books.list().then((l) => l[0]))]);
    // A delete there names the Japanese key, which the Worker does not have: the Chinese book of that key would stay.
    setLangForTests('ja');
    forgetBookInAccount(meta);
    await vi.waitFor(() => expect(w.calls.some((c) => c.startsWith('DELETE /books?key=%40ja%3A'))).toBe(true));
    expect(w.kept()).toHaveLength(1);

    // Updated: the next run puts the Japanese book there (a book deleted here stays deleted).
    const other = await library('ja');
    await other.books.add(book('大学'));
    w.state.released = false;
    expect(await as('ja', () => syncBooks(other))).toMatchObject({ uploaded: 1 });
    expect(w.kept().filter((k) => k.startsWith('@ja:'))).toHaveLength(1);
  });
});

describe('the Chinese app live today and the new Worker', () => {
  it('sees exactly the books it sees now: its own list, never a Japanese book, and its deletes leave Japanese books alone', async () => {
    const w = await account();
    const ja = await library('ja');
    const jaMeta = await ja.books.add(book());
    await as('ja', () => syncBooks(ja));
    // The released app reads Chinese (its other languages never asked for books).
    const old = await library('zh');
    const oldMeta = await old.books.add(book());
    expect(await as('zh', () => releasedBooks.syncBooks(old))).toEqual({ added: [], uploaded: 1 });
    const fresh = await library('zh');
    expect((await as('zh', () => releasedBooks.syncBooks(fresh))).added.map((m) => m.title)).toEqual(['学生']);
    expect((await as('zh', releasedBooks.accountBooks)).map((b) => b.key)).toEqual([bookKey(oldMeta)]);
    // Its list is the bare list it always was.
    const token = JSON.parse(localStorage.getItem('dushu.cloud.v1')!).token as string;
    expect(Array.isArray(await (await w.c.call('/books?covers', { headers: { Authorization: `Bearer ${token}` } })).json())).toBe(true);
    // Deleting its copy leaves the Japanese one, which has the same key.
    expect(bookKey(oldMeta)).toBe(bookKey(jaMeta));
    setLangForTests('zh');
    releasedBooks.forgetBookInAccount(oldMeta);
    await vi.waitFor(() => expect(w.kept()).toEqual([`@ja:${bookKey(jaMeta)}`]));
    // And its Japanese library asks for nothing.
    const before = w.calls.length;
    const oldJa = await library('ja');
    await oldJa.books.add(book('大学'));
    expect(await as('ja', () => releasedBooks.syncBooks(oldJa))).toEqual({ added: [], uploaded: 0 });
    expect(w.calls.length).toBe(before);
  });
});

describe('the Worker rolled back to the one live before languages, then updated again', () => {
  it('never hands a Japanese book to a Chinese library, the app live today or this one, and keeps it for Japanese', async () => {
    const w = await account();
    const ja = await library('ja');
    const meta = await ja.books.add(book('吾輩は猫である'));
    expect(await as('ja', () => syncBooks(ja))).toMatchObject({ uploaded: 1 });
    // wrangler rollback: the Worker that lists every book in its `books` table and serves any piece in `book_chunks` by key.
    w.state.released = true;
    const token = JSON.parse(localStorage.getItem('dushu.cloud.v1')!).token as string;
    const auth = { Authorization: `Bearer ${token}` };
    expect(await (await w.c.call('/books?covers', { headers: auth })).json()).toEqual([]);
    expect((await w.c.call(`/books/chunk?key=${encodeURIComponent(`@ja:${bookKey(meta)}`)}&i=0`, { headers: auth })).status).toBe(404);
    for (const run of [releasedBooks.syncBooks, syncBooks]) {
      const zh = await library('zh');
      for (let i = 0; i < 3; i++) expect(await as('zh', () => run(zh))).toEqual({ added: [], uploaded: 0 });
      expect(await zh.books.list()).toEqual([]);
    }
    // The Japanese library hears the server is older and waits.
    const other = await library('ja');
    expect(await as('ja', () => syncBooks(other))).toEqual({ added: [], uploaded: 0 });
    // Updated again: the book is there for Japanese, as it was.
    w.state.released = false;
    expect((await as('ja', () => syncBooks(other))).added.map((m) => m.title)).toEqual(['吾輩は猫である']);
  });

  it('this Chinese library passes over a book with a prefix even if a server lists it', async () => {
    const w = await account();
    // A Japanese book on the Chinese shelf, as a Worker that kept every language's books in one table would list it.
    const store = [...w.c.stores.values()][0];
    store.shelves.chinese.books.set('@ja:bk1', { key: '@ja:bk1', title: '日本語の本', author: '', size: 3, sha: 'a'.repeat(64), chunks: 1, addedAt: 1, complete: true });
    w.state.released = true;
    expect((await as('zh', releasedBooks.accountBooks)).map((b) => b.key)).toEqual(['@ja:bk1']);
    expect(await as('zh', accountBooks)).toEqual([]);
  });
});

describe('the server’s side of a language’s books', () => {
  it('lists a language by name, keeps a known language’s key only, and shares the room among the languages', async () => {
    const c = cloud({ OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const friend = await signedIn(c, 'friend@example.com');
    const auth = { Authorization: `Bearer ${friend}` };
    const sha = 'a'.repeat(64);
    const MB = 1024 * 1024;
    const start = (key: string, size = 10) => c.post('/books', { key, title: 't', author: 'a', size, sha }, friend);
    const put = (key: string) => c.call(`/books/chunk?key=${encodeURIComponent(key)}&i=0`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(10) });
    expect((await start('@ja:bk1')).status).toBe(200);
    expect((await put('@ja:bk1')).status).toBe(200);
    expect((await start('bk1')).status).toBe(200);
    expect((await put('bk1')).status).toBe(200);
    expect((await start('@ko:bk1')).status).toBe(400);
    expect((await start('@zh:bk1')).status).toBe(400);
    const list = async (q: string) => (await c.call(`/books${q}`, { headers: auth })).json();
    expect(await list('?covers&lang=ja')).toEqual({ lang: 'ja', books: [expect.objectContaining({ key: '@ja:bk1' })] });
    expect(await list('?covers')).toEqual([expect.objectContaining({ key: 'bk1' })]);
    expect(await list('?covers&lang=es')).toEqual({ lang: 'es', books: [] });
    // A language this Worker does not know is answered as Chinese, as a Worker from before languages answers.
    expect(await list('?covers&lang=ko')).toEqual([expect.objectContaining({ key: 'bk1' })]);
    expect((await c.call('/books?key=bk1', { method: 'DELETE', headers: auth })).status).toBe(200);
    expect(await list('?covers&lang=ja')).toEqual({ lang: 'ja', books: [expect.objectContaining({ key: '@ja:bk1' })] });
    // 200 MB in all: a Chinese book takes room from Japanese ones, and the answer says so.
    expect((await start('big', 150 * MB)).status).toBe(200);
    const full = await start('@ja:big', 51 * MB);
    expect(full.status).toBe(413);
    expect((await full.json() as { error: string }).error).toBe('Your account is full: it keeps up to 200 MB of books, in all your languages together. Delete a book to make room.');
  });
});
