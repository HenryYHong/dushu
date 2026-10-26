// @vitest-environment jsdom
// The sync server against what an adversarial review found: two devices saving one book at once, sign-in codes and guessing,
// an account's room for records, a stuck upload, read-aloud shares across a deleted account, and IPv6 networks.
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { networkOf, type Env } from '../../cloud/src/worker';
import { SHARED_RECORD_BYTES, STALE_UPLOAD_MS, WRONG_PER_DAY } from '../../cloud/src/account';
import { cloud, signedIn } from './helpers';

const MB = 1024 * 1024;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('two devices saving one book at once', () => {
  it('refuses the pieces of an upload a newer one replaced, so the book kept is one whole package', async () => {
    const c = cloud();
    const token = await signedIn(c);
    const size = 3 * MB + 100;
    const a = new Uint8Array(size).fill(0x41);
    const b = new Uint8Array(size).fill(0x42);
    const put = (bytes: Uint8Array, i: number, u: string) => c.call(`/books/chunk?key=K&i=${i}&u=${u}`, {
      method: 'PUT', body: bytes.slice(i * MB, (i + 1) * MB), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    });
    const startA = await (await c.post('/books', { key: 'K', title: 'T', author: '', size, sha: sha(a) }, token)).json() as { upload: string };
    expect((await put(a, 0, startA.upload)).status).toBe(200);
    const startB = await (await c.post('/books', { key: 'K', title: 'T', author: '', size, sha: sha(b) }, token)).json() as { upload: string };
    expect(startB.upload).not.toBe(startA.upload);
    for (let i = 0; i < 4; i++) expect((await put(b, i, startB.upload)).status).toBe(200);
    // The slower device carries on: refused, so nothing of A's lands in B's book.
    for (let i = 1; i < 4; i++) expect((await put(a, i, startA.upload)).status).toBe(409);
    const list = await (await c.call('/books', { headers: { Authorization: `Bearer ${token}` } })).json() as { sha: string }[];
    expect(list).toEqual([expect.objectContaining({ sha: sha(b) })]);
    const parts: Uint8Array[] = [];
    for (let i = 0; i < 4; i++) parts.push(new Uint8Array(await (await c.call(`/books/chunk?key=K&i=${i}`, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer()));
    const whole = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { whole.set(p, at); at += p.length; }
    expect(sha(whole)).toBe(sha(b));
  });

  it('sends the same package once: a second device saving it goes on under the same upload, or finds it kept', async () => {
    const c = cloud();
    const token = await signedIn(c);
    const bytes = new Uint8Array(1000).fill(9);
    const start = () => c.post('/books', { key: 'K', title: 'T', author: '', size: 1000, sha: sha(bytes) }, token).then((r) => r.json() as Promise<{ upload: string; complete?: boolean }>);
    const one = await start();
    const two = await start();
    expect(two.upload).toBe(one.upload);
    await c.call(`/books/chunk?key=K&i=0&u=${one.upload}`, { method: 'PUT', body: bytes, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' } });
    expect(await start()).toMatchObject({ upload: one.upload, complete: true });
  });

  it('gives back the room of an upload left unfinished for a day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    const c = cloud({ OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const friend = await signedIn(c, 'friend@example.com');
    expect((await c.post('/books', { key: 'gone', title: 't', author: '', size: 150 * MB, sha: 'a'.repeat(64) }, friend)).status).toBe(200);
    expect((await c.post('/books', { key: 'next', title: 't', author: '', size: 60 * MB, sha: 'b'.repeat(64) }, friend)).status).toBe(413);
    vi.setSystemTime(new Date(Date.parse('2026-10-25T10:00:00Z') + STALE_UPLOAD_MS + 1000));
    expect((await c.post('/books', { key: 'next', title: 't', author: '', size: 60 * MB, sha: 'b'.repeat(64) }, friend)).status).toBe(200);
  });
});

describe('sign-in codes', () => {
  it('keeps the code in the inbox working when no newer email goes out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    const c = cloud({ DAILY_EMAILS: '1' });
    const { devCode } = await (await c.post('/auth/code', { email: 'reader@example.com' })).json() as { devCode: string };
    vi.setSystemTime(new Date('2026-10-25T10:00:31Z'));
    expect((await c.post('/auth/code', { email: 'reader@example.com' })).status).toBe(429);
    expect((await c.post('/auth/verify', { email: 'reader@example.com', code: devCode })).status).toBe(200);
  });

  it('keeps no code that was never emailed, and none when the email could not be sent', async () => {
    const c = cloud({ DAILY_EMAILS: '1' });
    expect((await c.post('/auth/code', { email: 'someone@example.com' })).status).toBe(200);
    const real = crypto.getRandomValues.bind(crypto);
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((arr: ArrayBufferView) => {
      if (arr instanceof Uint32Array && arr.length === 1) { arr[0] = 123456; return arr; }
      return real(arr as Uint8Array);
    }) as typeof crypto.getRandomValues);
    expect((await c.post('/auth/code', { email: 'victim@example.com' })).status).toBe(429);
    const failing = cloud({ MAIL_MODE: undefined, mailer: { send: async () => { throw new Error('down'); } } } as Partial<Env>);
    expect((await failing.post('/auth/code', { email: 'victim@example.com' })).status).toBe(502);
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await c.post('/auth/verify', { email: 'victim@example.com', code: '123456' })).status).toBe(400);
    expect((await failing.post('/auth/verify', { email: 'victim@example.com', code: '123456' })).status).toBe(400);
  });

  it('lets a second device ask for a code at once when the last one was already used', async () => {
    const c = cloud();
    await signedIn(c);
    expect((await c.post('/auth/code', { email: 'reader@example.com' })).status).toBe(200);
    // An unused code still makes the next one wait half a minute.
    expect((await c.post('/auth/code', { email: 'reader@example.com' })).status).toBe(429);
  });

  it('caps the wrong codes a network types in a day', async () => {
    const c = cloud({ DAILY_EMAILS: '1000' } as Partial<Env>);
    const verify = (email: string, code: string, ip: string) => c.call('/auth/verify', { method: 'POST', body: JSON.stringify({ email, code }), headers: { 'CF-Connecting-IP': ip } });
    const codeFor = async (email: string) => (await (await c.post('/auth/code', { email })).json() as { devCode: string }).devCode;
    const mine = await codeFor('reader@example.com');
    // 20 wrong codes from one network, spread over accounts (each code takes 5 tries).
    for (let i = 0; i < 20; i++) {
      const right = await codeFor(`x${i}@example.com`);
      expect((await verify(`x${i}@example.com`, right === '000000' ? '111111' : '000000', '203.0.113.9')).status).toBe(400);
    }
    // Then even a right code is refused from that network today, and works from another.
    expect((await verify('reader@example.com', mine, '203.0.113.9')).status).toBe(429);
    expect((await verify('reader@example.com', mine, '198.51.100.4')).status).toBe(200);
  });

  it('caps the wrong codes an account takes in a day, whatever the network', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let t = Date.parse('2026-10-25T00:30:00Z');
    vi.setSystemTime(t);
    const c = cloud();
    const verify = (code: string, ip: string) => c.call('/auth/verify', { method: 'POST', body: JSON.stringify({ email: 'reader@example.com', code }), headers: { 'CF-Connecting-IP': ip } });
    const codeFor = async () => (await (await c.post('/auth/code', { email: 'reader@example.com' })).json() as { devCode: string }).devCode;
    let n = 0;
    while (n < WRONG_PER_DAY) {
      const right = await codeFor();
      for (let k = 0; k < 4 && n < WRONG_PER_DAY; k++, n++) expect((await verify(right === '000000' ? '111111' : '000000', `10.0.${n}.1`)).status).toBe(400);
      vi.setSystemTime(t += 3_600_000); // the next hour: past the hourly code limit
    }
    const last = await codeFor();
    const res = await verify(last, '10.9.9.9');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('wrong codes today') });
  });

  it('counts an IPv6 network by its /64, an IPv4 one by its address', async () => {
    expect(await networkOf('2001:db8:1:2::1')).toBe(await networkOf('2001:0db8:0001:0002:ffff:1:2:3'));
    expect(await networkOf('2001:db8:1:2::1')).not.toBe(await networkOf('2001:db8:1:3::1'));
    expect(await networkOf('203.0.113.7')).not.toBe(await networkOf('203.0.113.8'));
    const c = cloud({ DAILY_EMAILS: '1000' } as Partial<Env>);
    const ask = (email: string, ip: string) => c.call('/auth/code', { method: 'POST', body: JSON.stringify({ email }), headers: { 'CF-Connecting-IP': ip } });
    for (let i = 0; i < 40; i++) expect((await ask(`s${i}@example.com`, `2001:db8:1:2::${(i + 1).toString(16)}`)).status).toBe(200);
    expect((await ask('s40@example.com', '2001:db8:1:2::ff')).status).toBe(429);
  });

  it('gives each account an id that changes when it is deleted and made again', async () => {
    const c = cloud();
    const first = await (await c.post('/auth/verify', { email: 'reader@example.com', code: (await (await c.post('/auth/code', { email: 'reader@example.com' })).json() as { devCode: string }).devCode })).json() as { token: string; created: string };
    expect(first.created).toMatch(/^\d+$/);
    await new Promise((r) => setTimeout(r, 5));
    expect((await c.post('/me/delete', {}, first.token)).status).toBe(200);
    const again = await (await c.post('/auth/verify', { email: 'reader@example.com', code: (await (await c.post('/auth/code', { email: 'reader@example.com' })).json() as { devCode: string }).devCode })).json() as { created: string };
    expect(again.created).not.toBe(first.created);
  });
});

describe('an account’s room', () => {
  it('refuses records past its room (20 MB for everyone but the owner), never a change that frees some', async () => {
    const c = cloud({ OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const friend = await signedIn(c, 'friend@example.com');
    const pad = 'x'.repeat(30_000);
    let epoch: string | undefined;
    let since = 0;
    let refused = false;
    for (let r = 0; r < 4 && !refused; r++) {
      const changes = Array.from({ length: 250 }, (_, i) => ({ key: `v:w${r}-${i}`, at: 1, data: { pad } }));
      const res = await c.call('/sync', { method: 'POST', body: JSON.stringify({ epoch, since, changes }), headers: { Authorization: `Bearer ${friend}` } });
      if (res.status === 413) { refused = true; expect(await res.json()).toMatchObject({ code: 'full' }); break; }
      const reply = await res.json() as { epoch: string; version: number };
      epoch = reply.epoch; since = reply.version;
    }
    expect(refused).toBe(true);
    expect(SHARED_RECORD_BYTES).toBe(20 * MB);
    // Deleting is always allowed.
    const del = await c.call('/sync', { method: 'POST', body: JSON.stringify({ epoch, since, changes: [{ key: 'v:w0-0', at: 2, data: null }] }), headers: { Authorization: `Bearer ${friend}` } });
    expect(del.status).toBe(200);
  });

  it('keeps only the settings that sync under o:', async () => {
    const c = cloud();
    const token = await signedIn(c);
    const res = await c.call('/sync', { method: 'POST', body: JSON.stringify({ changes: [{ key: 'o:junk', at: 1, data: { v: 'x' } }, { key: 'o:theme', at: 1, data: { v: 'dark' } }] }), headers: { Authorization: `Bearer ${token}` } });
    const reply = await res.json() as { records: { key: string }[] };
    expect(reply.records.map((r) => r.key)).toEqual(['o:theme']);
  });
});

describe('read-aloud shares', () => {
  it('are kept by account outside it, so deleting the account does not start the day again', async () => {
    const AI: NonNullable<Env['AI']> = { run: async () => new Response(JSON.stringify({ audio: btoa('RIFF') }), { headers: { 'Content-Type': 'application/json' } }) };
    const c = cloud({ AI, OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    let token = await signedIn(c, 'friend@example.com');
    let ok = 0;
    while ((await c.post('/speech', { text: '好'.repeat(400) }, token)).status === 200) ok++;
    expect(ok).toBe(37);
    await c.post('/me/delete', {}, token);
    token = await signedIn(c, 'friend@example.com');
    expect((await c.post('/speech', { text: '好'.repeat(400) }, token)).status).toBe(429);
  });
});
