// @vitest-environment jsdom
// Books kept in the sync account: the first device signed in that has a book puts it there, every other device signed in
// downloads it and adds the very same book (same sync key, so its reading place lands in it), and deleting a book removes it
// from the account. The books here are made up; the server runs in process.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../cloud/src/worker';
import { requestCode, signIn, cloudSession } from '../../src/core/cloud';
import { accountBooks, forgetBookInAccount, packBook, syncBooks, unpackBook } from '../../src/core/cloudBooks';
import { bookKey } from '../../src/core/syncKeys';
import { bytesOf, openStore } from '../../src/store';
import type { ImportedBook } from '../../src/types';
import { cloud } from './helpers';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

/** A PNG's signature, then `n` bytes that do not compress (so a big image makes a package of several pieces). */
function png(n: number): Blob {
  const b = new Uint8Array(8 + n);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let x = 12345;
  for (let i = 8; i < b.length; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; }
  return new Blob([b]);
}

const book = (imageBytes = 2000): ImportedBook => ({
  title: '山中', author: '某人', format: 'epub', script: 'simplified', sourceName: 'shanzhong.epub', note: 'mac-book:' + 'ab'.repeat(32), importVersion: 2,
  cover: 'cover.png', assets: new Map([['cover.png', png(imageBytes)]]),
  chapters: [
    { title: '第一章', blocks: [{ t: 'h', level: 2, text: '第一章' }, { t: 'p', text: '山上有一座小房子。' }, { t: 'img', asset: 'cover.png', alt: '图' }] },
    { title: '第二章', blocks: [{ t: 'p', text: '房子里住着一位老人。' }, { t: 'hr' }, { t: 'quote', text: '“你好。”' }] },
  ],
});

async function signedIn() {
  const c = cloud();
  let code = '';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.arrayBuffer();
    const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body }), c.env);
    if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
    return res;
  });
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  await requestCode('reader@example.com');
  await signIn('reader@example.com', code);
  return c;
}

describe('a book kept in the account', () => {
  it('packs and unpacks to the same book', async () => {
    const store = await openStore(`books-${Math.random()}`);
    const meta = await store.books.add(book());
    const back = unpackBook(await packBook(store, meta));
    expect(back).toMatchObject({ title: '山中', author: '某人', format: 'epub', note: meta.note, importVersion: 2, cover: 'cover.png' });
    expect(back.chapters).toEqual(book().chapters);
    expect((await bytesOf(back.assets.get('cover.png')!)).byteLength).toBe(2008);
  });

  it('goes up from the device that has it and comes down on the others, as the same book, in pieces when it is big', async () => {
    await signedIn();
    const [a, b] = [await openStore(`books-a-${Math.random()}`), await openStore(`books-b-${Math.random()}`)];
    const meta = await a.books.add(book(2_500_000)); // three pieces of 1 MB
    expect(await syncBooks(a)).toMatchObject({ uploaded: 1, added: [] });
    const kept = await accountBooks();
    expect(kept).toEqual([expect.objectContaining({ key: bookKey(meta), title: '山中', chunks: 3 })]);
    // Device b, signed in to the same account.
    const { added } = await syncBooks(b);
    expect(added.map((m) => m.title)).toEqual(['山中']);
    const there = (await b.books.list())[0];
    expect(bookKey(there)).toBe(bookKey(meta));
    expect(await b.books.chapter(there.id, 1)).toEqual(book().chapters[1]);
    expect((await b.books.asset(there.id, 'cover.png'))?.size).toBe(2_500_008);
    // Nothing goes either way once both have it.
    expect(await syncBooks(a)).toEqual({ added: [], uploaded: 0 });
    expect(await syncBooks(b)).toEqual({ added: [], uploaded: 0 });
  });

  it('deleting a book removes it from the account, and it is not put back or downloaded again', async () => {
    await signedIn();
    const [a, b] = [await openStore(`books-a-${Math.random()}`), await openStore(`books-b-${Math.random()}`)];
    const meta = await a.books.add(book());
    await syncBooks(a);
    await syncBooks(b);
    await a.books.remove(meta.id);
    forgetBookInAccount(meta);
    await vi.waitFor(async () => expect(await accountBooks()).toEqual([]));
    // b still has its copy; it put nothing up (it downloaded it), so the deletion stands.
    expect(await syncBooks(b)).toEqual({ added: [], uploaded: 0 });
    expect(await accountBooks()).toEqual([]);
    expect(await syncBooks(a)).toEqual({ added: [], uploaded: 0 });
    expect(await a.books.list()).toEqual([]);
  });

  it('does not keep the classics, and does nothing signed out', async () => {
    await signedIn();
    const a = await openStore(`books-a-${Math.random()}`);
    await a.books.add({ ...book(), sourceName: 'sample:lunyu', note: undefined, format: 'sample' });
    expect(await syncBooks(a)).toEqual({ added: [], uploaded: 0 });
    localStorage.removeItem('dushu.cloud.v1');
    expect(cloudSession()).toBeNull();
    await a.books.add({ ...book(), title: '别的书', note: undefined, sourceName: 'other.txt' });
    expect(await syncBooks(a)).toEqual({ added: [], uploaded: 0 });
  });
});

describe('the server’s side of books', () => {
  it('takes pieces of the right size only, lists whole books only, and keeps an account to 1 GB', async () => {
    const c = cloud();
    const { signedIn: login } = await import('./helpers');
    const token = await login(c);
    const auth = { Authorization: `Bearer ${token}` };
    const start = (body: unknown) => c.post('/books', body, token);
    const sha = 'a'.repeat(64);
    expect((await start({ key: 'bk1', title: 't', author: 'a', size: 1_500_000, sha })).status).toBe(200);
    const put = (i: number, n: number) => c.call(`/books/chunk?key=bk1&i=${i}`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(n) });
    expect((await put(0, 1000)).status).toBe(400); // a first piece is a whole 1 MB
    expect((await put(0, 1024 * 1024)).status).toBe(200);
    expect(await (await c.call('/books', { headers: auth })).json()).toEqual([]); // not whole yet
    expect((await put(1, 1_500_000 - 1024 * 1024)).status).toBe(200);
    expect((await (await c.call('/books', { headers: auth })).json() as unknown[]).length).toBe(1);
    expect((await c.call('/books/chunk?key=bk1&i=1', { headers: auth })).headers.get('content-type')).toBe('application/octet-stream');
    expect((await start({ key: 'bk2', title: 't', author: 'a', size: 300 * 1024 * 1024, sha })).status).toBe(413);
    expect((await start({ key: 'bad key/../x', title: 't', author: 'a', size: 10, sha })).status).toBe(400);
    expect((await c.call('/books?key=bk1', { method: 'DELETE', headers: auth })).status).toBe(200);
    expect(await (await c.call('/books', { headers: auth })).json()).toEqual([]);
    expect((await c.call('/books', {})).status).toBe(401);
  });
});
