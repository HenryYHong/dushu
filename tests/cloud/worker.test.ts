// @vitest-environment jsdom
// The sync account online (cloud/src): signing in with an emailed code, the rules on codes and devices, and two devices
// syncing through it with the app's own sign-in and syncer. The Worker runs in process; each account keeps its state in
// memory instead of a Durable Object's SQLite database (that half is checked against wrangler dev).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../cloud/src/worker';
import { AccountCore, CODE_GAP_MS, CODE_TTL_MS, memoryStore } from '../../cloud/src/account';
import { cloud, signedIn } from './helpers';
import { cloudSession, requestCode, signIn, signOut } from '../../src/core/cloud';
import { createSyncer, type Syncer } from '../../src/core/sync';
import { openStore } from '../../src/store';
import { newSrs } from '../../src/core/srs';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('signing in', () => {
  it('emails a code, signs the device in with it, and the token opens only that account', async () => {
    const c = cloud();
    const sent = await c.post('/auth/code', { email: ' Reader@Example.com ' });
    expect(sent.status).toBe(200);
    expect(sent.headers.get('Access-Control-Allow-Origin')).toBe('https://henryyhong.com');
    const { devCode } = await sent.json() as { devCode: string };
    expect(devCode).toMatch(/^\d{6}$/);
    const wrong = await c.post('/auth/verify', { email: 'reader@example.com', code: devCode === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect((await wrong.json() as { error: string }).error).toMatch(/not right/);
    const ok = await c.post('/auth/verify', { email: 'reader@example.com', code: devCode });
    const { token, email } = await ok.json() as { token: string; email: string };
    expect(email).toBe('reader@example.com');
    expect(token).toMatch(/^[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/);
    // A code works once.
    expect((await c.post('/auth/verify', { email: 'reader@example.com', code: devCode })).status).toBe(400);

    expect(await (await c.call('/me', { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual({ email: 'reader@example.com', owner: false, passkeys: 0 });
    const reply = await (await c.post('/sync', { changes: [{ key: 'k:好', at: 5, data: {} }] }, token)).json() as { records: unknown[]; counts: { known: number } };
    expect(reply.counts.known).toBe(1);
    expect(reply.records).toEqual([{ key: 'k:好', at: 5, data: {} }]);

    // Another account's token, a made-up one, or none: signed out.
    const other = await signedIn(c, 'friend@example.com');
    expect((await (await c.call('/sync', { headers: { Authorization: `Bearer ${other}` } })).json() as { counts: { known: number } }).counts.known).toBe(0);
    expect((await c.call('/sync', { headers: { Authorization: `Bearer ${token.slice(0, 65)}${'A'.repeat(43)}` } })).status).toBe(401);
    expect((await c.call('/sync', { headers: { Authorization: `Bearer ${'0'.repeat(64)}.${'A'.repeat(43)}` } })).status).toBe(401);
    expect((await c.call('/sync')).status).toBe(401);

    // Signing out one device leaves the account and other devices alone. (A second code comes half a minute after the first.)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    const second = await signedIn(c);
    expect((await c.post('/auth/signout', {}, token)).status).toBe(200);
    expect((await c.call('/me', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await (await c.call('/sync', { headers: { Authorization: `Bearer ${second}` } })).json() as { counts: { known: number } }).counts.known).toBe(1);
  });

  it('remembers the Mac’s private address for the owner’s account only, and only a Tailscale https address', async () => {
    const c = cloud({ OWNER_EMAILS: 'reader@example.com' });
    const token = await signedIn(c);
    const auth = { Authorization: `Bearer ${token}` };
    expect(await (await c.call('/me', { headers: auth })).json()).toEqual({ email: 'reader@example.com', owner: true, passkeys: 0 });
    expect((await c.post('/me', { mac: 'https://my-mac.tail1234.ts.net:8443' }, token)).status).toBe(200);
    expect(await (await c.call('/me', { headers: auth })).json()).toEqual({ email: 'reader@example.com', owner: true, passkeys: 0, mac: 'https://my-mac.tail1234.ts.net:8443' });
    // Someone else signing in on the owner's Mac does not take its address into their account.
    const friend = await signedIn(c, 'friend@example.com');
    expect((await c.post('/me', { mac: 'https://my-mac.tail1234.ts.net:8443' }, friend)).status).toBe(403);
    expect(await (await c.call('/me', { headers: { Authorization: `Bearer ${friend}` } })).json()).toEqual({ email: 'friend@example.com', owner: false, passkeys: 0 });
    for (const bad of ['http://my-mac.tail1234.ts.net', 'https://evil.example', 'https://x.ts.net/path', 'javascript:alert(1)']) {
      expect((await c.post('/me', { mac: bad }, token)).status).toBe(400);
    }
    expect((await c.post('/me', { mac: 'https://my-mac.tail1234.ts.net' })).status).toBe(401);
  });

  it('only lets the listed emails sign in, when there is a list', async () => {
    const c = cloud({ ALLOWED_EMAILS: 'reader@example.com, other@example.com' });
    expect((await c.post('/auth/code', { email: 'READER@example.com' })).status).toBe(200);
    const no = await c.post('/auth/code', { email: 'stranger@example.com' });
    expect(no.status).toBe(403);
    expect((await c.post('/auth/code', { email: 'not an email' })).status).toBe(400);
  });

  it('answers the app’s pages and no others across origins', async () => {
    const c = cloud();
    const pre = await c.call('/sync', { method: 'OPTIONS', origin: 'http://localhost:4317' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
    expect((await c.call('/', { origin: 'https://my-mac.tail1234.ts.net:8443' })).headers.get('Access-Control-Allow-Origin')).toBe('https://my-mac.tail1234.ts.net:8443');
    expect((await c.call('/', { origin: 'https://evil.example' })).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('says so when the day’s emails are used up', async () => {
    const c = cloud({ DAILY_EMAILS: '3' });
    for (const who of ['a', 'b', 'c']) expect((await c.post('/auth/code', { email: `${who}@example.com` })).status).toBe(200);
    const res = await c.post('/auth/code', { email: 'd@example.com' });
    expect(res.status).toBe(429);
  });
});

describe('the rules on codes and devices', () => {
  const T = 1_000_000_000;
  it('a code soon after another, too many in an hour, an old code and too many wrong tries are refused', () => {
    const core = new AccountCore(memoryStore());
    core.storeCode('r@example.com', 'h1', T);
    expect(() => core.storeCode('r@example.com', 'h2', T + 1000)).toThrow(/just sent/);
    for (let i = 1; i < 5; i++) core.storeCode('r@example.com', `h${i}`, T + i * CODE_GAP_MS);
    expect(() => core.storeCode('r@example.com', 'h9', T + 5 * CODE_GAP_MS)).toThrow(/Too many codes/);
    // An hour later it is fine again, and an expired code does not sign in.
    core.storeCode('r@example.com', 'late', T + 3_700_000);
    expect(() => core.verify('late', 's1', T + 3_700_000 + CODE_TTL_MS + 1)).toThrow(/expired/);
    core.storeCode('r@example.com', 'good', T + 3_800_000);
    for (let i = 0; i < 4; i++) expect(() => core.verify('bad', 's1', T + 3_800_000)).toThrow(/not right/);
    expect(() => core.verify('bad', 's1', T + 3_800_000)).toThrow(/Too many wrong tries/);
    // Even the right code is dead now.
    expect(() => core.verify('good', 's1', T + 3_800_000)).toThrow(/Ask for a code first/);
  });

  it('keeps at most 20 devices signed in, dropping the one used least recently', () => {
    const core = new AccountCore(memoryStore());
    for (let i = 0; i < 21; i++) {
      core.storeCode('r@example.com', `c${i}`, T + i * 4_000_000);
      core.verify(`c${i}`, `s${i}`, T + i * 4_000_000);
    }
    expect(() => core.me('s0', T + 90_000_000)).toThrow(/signed out/);
    expect(core.me('s1', T + 90_000_000).email).toBe('r@example.com');
  });
});

describe('two devices syncing through the account', () => {
  const syncers: Syncer[] = [];
  afterEach(() => { for (const s of syncers.splice(0)) s.stop(); });

  it('signs in with the app’s own code, brings a word and a lookup across, and signs out when the server forgot the device', async () => {
    const c = cloud();
    let lastCode = '';
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const res = await worker.fetch(new Request(req.url.replace('https://sync.test', 'https://sync.test'), { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.text() }), c.env);
      if (req.url.endsWith('/auth/code') && res.ok) lastCode = (await res.clone().json() as { devCode: string }).devCode;
      return res;
    });
    localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
    await requestCode('reader@example.com');
    await signIn('reader@example.com', lastCode);
    expect(cloudSession()?.email).toBe('reader@example.com');

    const [a, b] = [await openStore(`cloud-a-${Math.random()}`), await openStore(`cloud-b-${Math.random()}`)];
    const sa = createSyncer(a, { everyMs: 0 });
    const sb = createSyncer(b, { everyMs: 0 });
    syncers.push(sa, sb);
    await a.vocab.put({ id: '银行', simp: '银行', trad: '銀行', pinyin: 'yin2 hang2', gloss: 'bank', addedAt: 1000, srs: newSrs(1000) });
    await b.lookups.log({ day: '2026-10-24', id: '水', word: '水', pinyin: 'shui3', gloss: 'water' }, 2_000_000);
    await sa.run(); await sb.run(); await sa.run();
    expect(b.vocab.has('银行')).toBe(true);
    expect((await a.lookups.list()).map((r) => r.id)).toEqual(['水']);
    expect(sa.status()).toMatchObject({ state: 'idle', hub: 'cloud', counts: { words: 1, lookups: 1 } });

    // Signed out from Settings: the server forgets the token, and the other store (same browser here) is told to sign in.
    const token = cloudSession()!.token;
    await signOut();
    expect(cloudSession()).toBeNull();
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token, email: 'reader@example.com' }));
    await sb.run();
    expect(sb.status().state).toBe('signedout');
    expect(cloudSession()).toBeNull();
  });
});
