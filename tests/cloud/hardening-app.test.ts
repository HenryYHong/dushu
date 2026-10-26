// @vitest-environment jsdom
// The app's half of the account against what an adversarial review found: a deleted account made again, the same book packed
// twice, a damaged book in the account, a setting chosen while a sync is on the wire, and a device signed out by the server.
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../cloud/src/worker';
import { deleteAccount, requestCode, signIn } from '../../src/core/cloud';
import { accountBooks, packBook, syncBooks } from '../../src/core/cloudBooks';
import { createSyncer, type Syncer } from '../../src/core/sync';
import { createSettingsStore } from '../../src/store/settings';
import { openStore } from '../../src/store';
import type { ImportedBook } from '../../src/types';
import { cloud } from './helpers';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
let code = '';
let c: ReturnType<typeof cloud>;
let hold: Promise<void> | null = null;
let onSent: (() => void) | null = null;
const syncers: Syncer[] = [];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  c = cloud();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.arrayBuffer();
    const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body }), c.env);
    if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
    if (req.url.endsWith('/sync') && hold) { onSent?.(); await hold; }
    return res;
  });
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
});
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); hold = null; onSent = null; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

async function login(email = 'reader@example.com') {
  await requestCode(email);
  return signIn(email, code);
}

const book = (title: string, note: string): ImportedBook => ({
  title, author: '某人', format: 'epub', script: 'simplified', sourceName: `${title}.epub`, note, importVersion: 2, assets: new Map(),
  chapters: [{ title: '第一章', blocks: [{ t: 'p', text: `${title}：山上有一座小房子。` }] }],
});

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); },
  };
}

describe('books in an account made again', () => {
  it('go up to the new account after the old one was deleted', async () => {
    await login();
    const a = await openStore(`c-${Math.random()}`);
    await a.books.add(book('山中', 'mac-book:' + 'ab'.repeat(32)));
    expect((await syncBooks(a)).uploaded).toBe(1);
    await deleteAccount();
    await new Promise((r) => setTimeout(r, 5));
    await login();
    expect((await syncBooks(a)).uploaded).toBe(1);
    expect((await accountBooks()).map((b) => b.title)).toEqual(['山中']);
  });

  it('also go up when another device deleted the account (this device kept its marks)', async () => {
    const first = await login();
    const a = await openStore(`c-${Math.random()}`);
    await a.books.add(book('山中', 'mac-book:' + 'ab'.repeat(32)));
    await syncBooks(a);
    // Deleted from another device: the server forgets it; this device signs in again later.
    await c.post('/me/delete', {}, first.token);
    await new Promise((r) => setTimeout(r, 5));
    await login();
    expect((await syncBooks(a)).uploaded).toBe(1);
  });
});

describe('a book packed for the account', () => {
  it('is the very same bytes whenever and wherever it is packed', async () => {
    const s = await openStore(`p-${Math.random()}`);
    const meta = await s.books.add(book('山中', 'mac-book:' + 'cd'.repeat(32)));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    const one = await packBook(s, meta);
    vi.setSystemTime(new Date('2026-10-26T18:00:07Z'));
    const two = await packBook(s, meta);
    vi.useRealTimers();
    expect(sha(one)).toBe(sha(two));
  });

  it('that came down damaged does not stop the others, and is not fetched again for a day', async () => {
    const session = await login();
    const auth = { Authorization: `Bearer ${session.token}` };
    await c.post('/books', { key: 'damaged-key', title: '坏', author: '', size: 1000, sha: 'f'.repeat(64) }, session.token);
    await c.call('/books/chunk?key=damaged-key&i=0', { method: 'PUT', body: new Uint8Array(1000).fill(7), headers: { ...auth, 'Content-Type': 'application/octet-stream' } });
    const up = await openStore(`u-${Math.random()}`);
    await up.books.add(book('好书', 'mac-book:' + 'ef'.repeat(32)));
    await syncBooks(up);
    const other = await openStore(`o-${Math.random()}`);
    const got = await syncBooks(other);
    expect(got.added.map((m) => m.title)).toEqual(['好书']);
    let asked = 0;
    const plain = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input instanceof Request ? input.url : input).includes('damaged-key&i=')) asked++;
      return plain(input, init);
    });
    await syncBooks(other);
    expect(asked).toBe(0);
  });
});

describe('settings and the server', () => {
  let clock = 1_800_000_000_000;
  async function device() {
    const settings = createSettingsStore(memStorage());
    const store = await openStore(`s-${Math.random()}`);
    const syncer = createSyncer(store, { everyMs: 0, settings, now: () => (clock += 1000) });
    syncers.push(syncer);
    return { settings, syncer };
  }

  it('keeps a setting chosen while a sync is on the wire, and sends it next', async () => {
    await login();
    const a = await device();
    const b = await device();
    await a.syncer.run(); await b.syncer.run();
    b.settings.set({ theme: 'dark' });
    await b.syncer.run();
    let release!: () => void;
    hold = new Promise<void>((r) => { release = r; });
    const sent = new Promise<void>((r) => { onSent = r; });
    const running = a.syncer.run();
    await sent;
    a.settings.set({ theme: 'sepia' });
    hold = null; onSent = null;
    release();
    await running;
    expect(a.settings.get().theme).toBe('sepia');
    await a.syncer.run(); await b.syncer.run();
    expect(b.settings.get().theme).toBe('sepia');
  });

  it('says a device the server signed out was signed out, until it signs in again', async () => {
    // The public site (localhost is the Mac's own page, which would sync with the Mac instead).
    vi.stubGlobal('location', { hostname: 'henryyhong.com', protocol: 'https:', origin: 'https://henryyhong.com', pathname: '/dushu/', search: '', hash: '' });
    const s = await login();
    const a = await device();
    await a.syncer.run();
    await c.post('/me/delete', {}, s.token);
    await a.syncer.run();
    expect(a.syncer.status().state).toBe('signedout');
    // The sign-out wakes the syncer again: it still says why.
    await new Promise((r) => setTimeout(r, 300));
    await a.syncer.run();
    expect(a.syncer.status().state).toBe('signedout');
    await login();
    await a.syncer.run();
    expect(a.syncer.status().state).toBe('idle');
  });
});
