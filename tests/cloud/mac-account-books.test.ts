// @vitest-environment jsdom
// The owner's Mac puts its books in the owner's account by itself (scripts/account-books.ts): the sync server signs it in by
// its key, only to the owner's account; each book goes up once, as the file itself; and a device reads it as an import, keyed
// as the Mac's book, and does not send it back.
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../cloud/src/worker';
import { requestCode, signIn } from '../../src/core/cloud';
import { syncBooks } from '../../src/core/cloudBooks';
import { bookKey } from '../../src/core/syncKeys';
import { openStore } from '../../src/store';
import { macBookKey, sendMacBooks } from '../../scripts/account-books';
import { importFile } from '../../src/import';
import { duplicateMacBooks, syncMacBooks } from '../../src/ui/library/macBooks';
import type { BookMeta } from '../../src/types';
import { cloud, signedIn } from './helpers';

const KEY = 'k'.repeat(64);
const OWNER = 'owner@example.com';
const dir = mkdtempSync(join(tmpdir(), 'dushu-mac-account-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const text = '第一章\n山上有一座小房子。房子里住着一只小猫。\n小猫每天早上看太阳。\n';
const file = join(dir, '小猫.txt');
writeFileSync(file, text);
const sha = createHash('sha256').update(text).digest('hex');

let c: ReturnType<typeof cloud>;
const toWorker = (input: RequestInfo | URL, init?: RequestInit) => worker.fetch(new Request(input, init), c.env);
const mac = (state = mkdtempSync(join(dir, 'state-'))) => sendMacBooks({
  stateDir: state, books: () => [{ id: 'f-1', name: '小猫.txt', path: file }], macKey: () => KEY, base: 'https://sync.test', fetchFn: toWorker,
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  c = cloud({ OWNER_EMAILS: OWNER, MAC_KEY: KEY });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

const books = async (token: string) => await (await c.call('/books', { headers: { Authorization: `Bearer ${token}` } })).json() as { key: string; title: string }[];

describe('the owner\'s Mac and the account', () => {
  it('signs in by its key, only to the owner\'s account, and only once that account exists', async () => {
    const ask = (key?: string) => c.call('/auth/mac', { method: 'POST', headers: key ? { Authorization: `MacKey ${key}` } : {} });
    expect((await ask()).status).toBe(401);
    expect((await ask('x'.repeat(64))).status).toBe(401);
    expect((await ask(KEY)).status).toBe(403); // the owner has not signed in yet: no account to join
    await signedIn(c, OWNER);
    const res = await ask(KEY);
    expect(res.status).toBe(200);
    const { token, email } = await res.json() as { token: string; email: string };
    expect(email).toBe(OWNER);
    expect(await books(token)).toEqual([]);
    // A sync server without a Mac key signs in no Mac.
    c = cloud({ OWNER_EMAILS: OWNER });
    await signedIn(c, OWNER);
    expect((await ask(KEY)).status).toBe(401);
  });

  it('puts each book in the account once, as the file itself, under the key a device gives it', async () => {
    const owner = await signedIn(c, OWNER);
    const state = mkdtempSync(join(dir, 'state-'));
    expect(await mac(state)).toEqual(['小猫.txt']);
    expect((await books(owner)).map((b) => [b.key, b.title])).toEqual([[macBookKey(sha), '小猫.txt']]);
    expect(await mac(state)).toEqual([]);
    // Deleted from the account on purpose (on a device): not sent again.
    await c.call(`/books?key=${encodeURIComponent(macBookKey(sha))}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } });
    expect(await mac(state)).toEqual([]);
    expect(await books(owner)).toEqual([]);
  });

  it('comes down to a device as an import, marked as the Mac\'s book, and does not go back up', async () => {
    await signedIn(c, OWNER);
    await mac();
    let code = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.arrayBuffer();
      const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body }), c.env);
      if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
      return res;
    });
    localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
    await requestCode(OWNER);
    const session = await signIn(OWNER, code);
    const store = await openStore(`d-${Math.random()}`);
    const got = await syncBooks(store);
    expect(got.added.map((b) => b.title)).toEqual(['小猫']);
    const [meta] = await store.books.list();
    expect(meta.note).toBe(`mac-book:${sha}`);
    expect(bookKey(meta)).toBe(macBookKey(sha));
    expect((await syncBooks(store)).uploaded).toBe(0);
    expect((await books(session.token)).length).toBe(1);
  });

  it('is added once on a device that gets it from the Mac and from the account at the same moment', async () => {
    await signedIn(c, OWNER);
    await mac();
    let code = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.arrayBuffer();
      const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body }), c.env);
      if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
      return res;
    });
    localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
    await requestCode(OWNER);
    await signIn(OWNER, code);
    const store = await openStore(`r-${Math.random()}`);
    // The account's run looks at the library first, and the Mac's book lands while the account's copy downloads.
    const fromAccount = syncBooks(store);
    await new Promise((r) => setTimeout(r, 0));
    const fromMac = syncMacBooks([{ id: 'f-1', name: '小猫.txt', sha256: sha }], {
      list: () => store.books.list(),
      fetchFile: async () => new File([text], '小猫.txt'),
      add: async (files) => [await store.books.add(await importFile(files[0]))],
      update: (id, patch) => store.books.update(id, patch),
    });
    await Promise.all([fromAccount, fromMac]);
    expect((await store.books.list()).length).toBe(1);
  });

  it('gives a book the picture put beside it in the folder, on every device, and the new one when it changes', async () => {
    await signedIn(c, OWNER);
    const folder = join(mkdtempSync(join(dir, 'home-')), 'Dushu Books');
    mkdirSync(folder);
    const bookPath = join(folder, '小猫.txt');
    writeFileSync(bookPath, text);
    // A 1x1 PNG, then another.
    const png = (shade: number) => Buffer.from(`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk${shade}PwfwAD/gH+eDiTDAAAAABJRU5ErkJggg==`, 'base64');
    writeFileSync(join(folder, '小猫.png'), png(1));
    const state = mkdtempSync(join(dir, 'state-'));
    const send = () => sendMacBooks({ stateDir: state, books: () => [{ id: 'f-1', name: '小猫.txt', path: bookPath }], macKey: () => KEY, base: 'https://sync.test', fetchFn: toWorker });
    expect((await send()).sort()).toEqual(['小猫.png', '小猫.txt']);
    expect(await send()).toEqual([]);
    let code = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.arrayBuffer();
      const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body }), c.env);
      if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
      return res;
    });
    localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
    await requestCode(OWNER);
    await signIn(OWNER, code);
    const store = await openStore(`c-${Math.random()}`);
    await syncBooks(store);
    const shaOf = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    let [meta] = await store.books.list();
    expect(meta.coverFrom).toBe(shaOf(png(1)));
    expect((await store.books.asset(meta.id, meta.cover!))?.type).toBe('image/png');
    expect((await store.books.list()).length).toBe(1); // the picture is not a book
    writeFileSync(join(folder, '小猫.png'), png(2));
    expect(await send()).toEqual(['小猫.png']);
    await syncBooks(store);
    [meta] = await store.books.list();
    expect(meta.coverFrom).toBe(shaOf(png(2)));
    // An app from before covers lists the books alone, so it never takes the picture for a book.
    const older = await (await c.call('/books', { headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('dushu.cloud.v1')!).token}` } })).json() as { key: string }[];
    expect(older.map((e) => e.key[0])).toEqual(['m']);
  });

  it('keeps one copy of a Mac book that is here twice: the one read in most recently', () => {
    const copy = (id: string, extra: Partial<BookMeta> = {}): BookMeta => ({
      id, title: '小猫', author: '', format: 'txt', script: 'simplified', sourceName: '小猫.txt', addedAt: 1, chapterCount: 1, charCount: 10,
      importVersion: 2, note: `mac-book:${sha}`, ...extra,
    } as BookMeta);
    const read = new Map([['b', 50]]);
    expect(duplicateMacBooks([copy('a'), copy('b'), copy('c', { addedAt: 0 }), copy('own', { note: undefined })], (id) => read.get(id) ?? 0).sort()).toEqual(['a', 'c']);
    expect(duplicateMacBooks([copy('a', { addedAt: 5 }), copy('b', { addedAt: 2 })], () => 0)).toEqual(['a']);
  });
});
