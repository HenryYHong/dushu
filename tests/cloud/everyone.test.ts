// @vitest-environment jsdom
// The sync account open to anyone with an email: limits on who can make it send codes, the owner's larger share of book
// space, deleting an account, and the email sender kept behind one small interface.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../cloud/src/worker';
import { codeEmail, resendMailer, type Mailer } from '../../cloud/src/mail';
import { cloud, signedIn } from './helpers';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

const sha = 'a'.repeat(64);

describe('open to anyone with an email', () => {
  it('lets anyone sign in when no list is set, each into an account of their own', async () => {
    const c = cloud({ OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const friend = await signedIn(c, 'friend@example.com');
    const student = await signedIn(c, 'student@example.com');
    const me = async (t: string) => (await c.call('/me', { headers: { Authorization: `Bearer ${t}` } })).json();
    expect(await me(friend)).toEqual({ email: 'friend@example.com', owner: false });
    expect(await me(student)).toEqual({ email: 'student@example.com', owner: false });
    expect(await me(await signedIn(c, 'owner@example.com'))).toEqual({ email: 'owner@example.com', owner: true });
    await c.post('/books', { key: 'bk1', title: '我的书', author: 'a', size: 10, sha }, friend);
    await c.call('/books/chunk?key=bk1&i=0', { method: 'PUT', headers: { Authorization: `Bearer ${friend}`, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(10) });
    expect(await (await c.call('/books', { headers: { Authorization: `Bearer ${student}` } })).json()).toEqual([]);
  });

  it('keeps 200 MB of books for everyone else and 1 GB for the owner', async () => {
    const c = cloud({ OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const MB = 1024 * 1024;
    const friend = await signedIn(c, 'friend@example.com');
    expect((await c.post('/books', { key: 'b1', title: 't', author: 'a', size: 150 * MB, sha }, friend)).status).toBe(200);
    const full = await c.post('/books', { key: 'b2', title: 't', author: 'a', size: 51 * MB, sha }, friend);
    expect(full.status).toBe(413);
    expect(await full.json()).toMatchObject({ error: expect.stringContaining('200 MB') });
    expect((await c.post('/books', { key: 'b2', title: 't', author: 'a', size: 50 * MB, sha }, friend)).status).toBe(200);
    const owner = await signedIn(c, 'owner@example.com');
    expect((await c.post('/books', { key: 'b1', title: 't', author: 'a', size: 199 * MB, sha }, owner)).status).toBe(200);
    expect((await c.post('/books', { key: 'b2', title: 't', author: 'a', size: 199 * MB, sha }, owner)).status).toBe(200);
  });

  it('limits the codes one network can ask for in a day, and the emails sent in all', async () => {
    const c = cloud({ DAILY_EMAILS: '1000' } as Partial<Env>);
    const ask = (email: string, ip: string) => c.call('/auth/code', { method: 'POST', body: JSON.stringify({ email }), headers: { 'CF-Connecting-IP': ip } });
    for (let i = 0; i < 40; i++) expect((await ask(`s${i}@example.com`, '203.0.113.7')).status).toBe(200);
    const blocked = await ask('s40@example.com', '203.0.113.7');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: expect.stringContaining('this network') });
    expect((await ask('s40@example.com', '198.51.100.2')).status).toBe(200);
  });

  it('deletes an account: its books, words and devices are gone, and signing in again starts an empty one', async () => {
    const c = cloud();
    const token = await signedIn(c);
    const auth = { Authorization: `Bearer ${token}` };
    await c.post('/books', { key: 'bk1', title: 't', author: 'a', size: 10, sha }, token);
    await c.call('/books/chunk?key=bk1&i=0', { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(10) });
    expect((await (await c.call('/books', { headers: auth })).json() as unknown[]).length).toBe(1);
    expect((await c.post('/me/delete', {}, token)).status).toBe(200);
    expect((await c.call('/books', { headers: auth })).status).toBe(401);
    const again = await signedIn(c);
    expect(await (await c.call('/books', { headers: { Authorization: `Bearer ${again}` } })).json()).toEqual([]);
    expect((await c.post('/me/delete', {})).status).toBe(401);
  });
});

describe('the sign-in email', () => {
  it('goes through whatever Mailer the server has', async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailer: Mailer = { send: async (m) => { sent.push(m); } };
    const c = cloud({ MAIL_MODE: undefined, mailer } as Partial<Env>);
    expect((await c.post('/auth/code', { email: 'friend@example.com' })).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('friend@example.com');
    expect(sent[0].subject).toMatch(/^\d{6} is your Dushu sign-in code$/);
    const failing = cloud({ MAIL_MODE: undefined, mailer: { send: async () => { throw new Error('down'); } } } as Partial<Env>);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await failing.post('/auth/code', { email: 'friend@example.com' })).status).toBe(502);
  });

  it('is sent through Resend with the configured sender', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}'); }) as unknown as typeof fetch;
    await resendMailer('re_test', 'Dushu <sign-in@mail.example.com>', fetcher).send({ to: 'friend@example.com', ...codeEmail('123456') });
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer re_test');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ from: 'Dushu <sign-in@mail.example.com>', to: ['friend@example.com'], subject: '123456 is your Dushu sign-in code' });
    const refusing = (async () => new Response('domain not verified', { status: 403 })) as unknown as typeof fetch;
    await expect(resendMailer('re_test', 'x', refusing).send({ to: 'friend@example.com', subject: 's', text: 't' })).rejects.toThrow(/403/);
  });
});
