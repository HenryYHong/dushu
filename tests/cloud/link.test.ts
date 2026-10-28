// @vitest-environment jsdom
// Signing in brings a device what the owner already has: everything the Mac holds is copied into the account once (never
// over a newer change), and a device on the Mac tells the account where the Mac is. The page here is on localhost, so it
// is a device on the Mac: its bridge is its own origin.
import 'fake-indexeddb/auto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../cloud/src/worker';
import { createSyncStore } from '../../scripts/sync-bridge';
import { cloudSession, requestCode, signIn } from '../../src/core/cloud';
import { linkMac } from '../../src/core/cloudLink';
import { copyMacIntoAccount, createSyncer, type Syncer } from '../../src/core/sync';
import { newSrs } from '../../src/core/srs';
import { openStore } from '../../src/store';
import { cloud } from './helpers';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const syncers: Syncer[] = [];
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });
beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

/** The Mac (its sync store and private status) and the account, behind one fetch, as the page sees them. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'dushu-link-'));
  dirs.push(dir);
  const mac = createSyncStore({ dir });
  const c = cloud({ OWNER_EMAILS: 'reader@example.com' });
  let code = '';
  const macCalls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(new URL(String(input instanceof Request ? input.url : input), 'http://localhost:3000/'), init);
    const url = new URL(req.url);
    if (url.origin === 'https://sync.test') {
      const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.text() }), c.env);
      if (url.pathname === '/auth/code' && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
      return res;
    }
    macCalls.push(url.pathname);
    if (url.pathname === '/api/private-status') return Response.json({ app: 'dushu', url: 'https://my-mac.tail1234.ts.net:8443' });
    if (url.pathname === '/api/sync') return Response.json(mac.exchange(JSON.parse(await req.text())));
    return new Response(null, { status: 404 });
  });
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  const login = async (email = 'reader@example.com') => { await requestCode(email); await signIn(email, code); };
  return { mac, c, login, macCalls };
}

const word = (simp: string, last: number) => ({ id: simp, simp, trad: simp, pinyin: '', gloss: simp, addedAt: 1000, srs: { ...newSrs(1000), last } });

describe('signing in on a device that reaches the Mac', () => {
  it('copies what the Mac holds into the account once, and never over a newer change', async () => {
    const w = world();
    // What other devices synced through the Mac: two words, a lookup, a bookmark and a place in a book not on this device.
    w.mac.exchange({ changes: [
      { key: 'v:银行', at: 2000, data: word('银行', 2000) },
      { key: 'v:书', at: 2000, data: word('书', 2000) },
      { key: 'l:2026-10-24:水', at: 2100, data: { word: '水', pinyin: 'shui3', gloss: 'water', count: 2, first: 2000, last: 2100 } },
      { key: 'b:m1', at: 2200, data: { book: 'sabc', chapter: 3, block: 1, offset: 0, label: '第三回', createdAt: 2200 } },
      { key: 'p:sabc', at: 2300, data: { chapter: 3, block: 4, percent: 0.4, updatedAt: 2300 } },
    ] });
    await w.login();
    // The account already has a newer review of 书, made on a device signed in earlier.
    const token = cloudSession()!.token;
    await worker.fetch(new Request('https://sync.test/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ changes: [{ key: 'v:书', at: 9000, data: word('书', 9000) }] }) }), w.c.env);

    const store = await openStore(`link-${Math.random()}`);
    const s = createSyncer(store, { everyMs: 0 });
    syncers.push(s);
    // The sync starts the copy beside itself and syncs again once it is in.
    await s.run();
    await vi.waitFor(async () => { await s.run(); expect(store.vocab.has('银行')).toBe(true); }, { timeout: 3000, interval: 20 });
    expect((await store.vocab.get('书'))?.srs.last).toBe(9000);
    expect((await store.lookups.list()).map((r) => r.id)).toEqual(['水']);
    expect((await store.bookmarks.list()).map((b) => [b.id, b.bookKey])).toEqual([['m1', 'sabc']]);
    expect(s.status()).toMatchObject({ hub: 'cloud', counts: { words: 2, lookups: 1, bookmarks: 1, places: 1 } });

    // Once per account and Mac.
    const asked = w.macCalls.filter((p) => p === '/api/sync').length;
    expect(await copyMacIntoAccount()).toBe(false);
    await s.run();
    expect(w.macCalls.filter((p) => p === '/api/sync').length).toBe(asked);
  });

  it('tells the account where the Mac is, once', async () => {
    const w = world();
    await w.login();
    await linkMac();
    const token = cloudSession()!.token;
    const me = await (await worker.fetch(new Request('https://sync.test/me', { headers: { Authorization: `Bearer ${token}` } }), w.c.env)).json();
    expect(me).toEqual({ email: 'reader@example.com', owner: true, passkeys: 0, mac: 'https://my-mac.tail1234.ts.net:8443' });
    const asked = w.macCalls.filter((p) => p === '/api/private-status').length;
    await linkMac();
    expect(w.macCalls.filter((p) => p === '/api/private-status').length).toBe(asked + 1); // asked again, but not sent again
  });
});
