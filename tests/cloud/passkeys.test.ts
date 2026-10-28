// @vitest-environment jsdom
// Passkeys for the sync account: the owner makes invite links; someone invited makes an account with a passkey and no email,
// and signs in with it again on any device that holds it; the owner can add a passkey to the email account. The server's
// real WebAuthn checks run on a test authenticator's real signatures. Then the app's side, through the same server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountLabel, cloudSession, signOut } from '../../src/core/cloud';
import { addPasskey, joinWithPasskey, signInWithPasskey } from '../../src/core/passkey';
import { asBrowserCredential, fakeAuthenticator, type CreateOptions, type GetOptions } from './authenticator';
import { cloud, signedIn } from './helpers';

const OWNER = 'owner@example.com';
const PAGE = 'https://henryyhong.com';
type Cloud = ReturnType<typeof cloud>;
type Device = ReturnType<typeof fakeAuthenticator>;

const body = async (r: Response) => await r.json() as Record<string, any>;
async function invite(c: Cloud, owner: string, max = 5, label = 'Mom’s class'): Promise<string> {
  return (await body(await c.post('/invites', { label, max }, owner))).invite.token;
}
async function join(c: Cloud, token: string, name: string, device: Device = fakeAuthenticator()) {
  const options = await body(await c.post('/auth/passkey/join-options', { invite: token, name }));
  const response = await device.create(options as CreateOptions, PAGE);
  return { res: await c.post('/auth/passkey/join', { challenge: options.challenge, response }), device, options };
}
async function passkeySignIn(c: Cloud, device: Device, sign: Parameters<Device['get']>[3] = {}, origin = PAGE) {
  const options = await body(await c.post('/auth/passkey/options', {}));
  const response = await device.get(options as GetOptions, origin, undefined, sign);
  return c.post('/auth/passkey/signin', { challenge: options.challenge, response });
}
const me = async (c: Cloud, token: string) => body(await c.call('/me', { headers: { Authorization: `Bearer ${token}` } }));

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('passkey accounts on an invite', () => {
  it('lets someone invited make an account with no email, and sign in with the passkey again', async () => {
    const c = cloud({ OWNER_EMAILS: OWNER, ALLOWED_EMAILS: OWNER });
    const owner = await signedIn(c, OWNER);
    const token = await invite(c, owner);
    expect(await body(await c.post('/auth/invite', { invite: token }))).toEqual({ label: 'Mom’s class' });

    const { res, device, options } = await join(c, token, '  Amy   Li ');
    expect(options.rp).toEqual({ id: 'henryyhong.com', name: 'Dushu' });
    expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required' });
    expect(res.status).toBe(200);
    const joined = await body(res);
    expect(joined).toMatchObject({ email: expect.stringMatching(/^passkey:[0-9a-f]{64}$/), name: 'Amy Li', created: expect.any(String) });
    expect(await me(c, joined.token)).toMatchObject({ email: joined.email, name: 'Amy Li', owner: false, passkeys: 1 });
    expect((await body(await c.call('/invites', { headers: { Authorization: `Bearer ${owner}` } }))).invites).toMatchObject([{ label: 'Mom’s class', uses: 1, max: 5 }]);

    // Another day, or another device holding the same passkey: sign in to the same account.
    const again = await passkeySignIn(c, device);
    expect(again.status).toBe(200);
    const back = await body(again);
    expect(back).toMatchObject({ email: joined.email, name: 'Amy Li', created: joined.created });
    expect(back.token).not.toBe(joined.token);
    expect((await c.call('/sync', { headers: { Authorization: `Bearer ${back.token}` } })).status).toBe(200);
  });

  it('refuses a bad or used-up invite, a stale or reused challenge, another page, and a signature that is not the passkey’s', async () => {
    const c = cloud({ OWNER_EMAILS: OWNER, ALLOWED_EMAILS: OWNER });
    const owner = await signedIn(c, OWNER);
    expect(await body(await c.post('/auth/passkey/join-options', { invite: 'x'.repeat(24), name: 'Amy' }))).toMatchObject({ code: 'bad_invite' });
    expect((await c.post('/auth/invite', { invite: 'nope' })).status).toBe(404);
    const one = await invite(c, owner, 1);
    expect((await c.post('/auth/passkey/join-options', { invite: one, name: ' ' })).status).toBe(400);

    const first = await join(c, one, 'Amy');
    expect(first.res.status).toBe(200);
    // The same challenge answered twice: the second is refused.
    const replay = await c.post('/auth/passkey/join', { challenge: first.options.challenge, response: await fakeAuthenticator().create(first.options as CreateOptions, PAGE) });
    expect(await body(replay)).toMatchObject({ code: 'stale' });
    // The invite was for one person.
    expect((await c.post('/auth/passkey/join-options', { invite: one, name: 'Ben' })).status).toBe(403);

    // Only the owner makes or sees invites.
    const friend = (await body(first.res)).token;
    expect((await c.call('/invites', { headers: { Authorization: `Bearer ${friend}` } })).status).toBe(403);
    expect((await c.post('/invites', { label: 'x', max: 9 }, friend)).status).toBe(403);
    expect((await c.call('/invites')).status).toBe(401);

    // A page that is not Dushu's is not answered; nor is an answer made for another page, another challenge or another key.
    expect((await c.call('/auth/passkey/options', { method: 'POST', body: '{}', origin: 'https://evil.example' })).status).toBe(403);
    expect(await body(await passkeySignIn(c, first.device, {}, 'https://evil.example'))).toMatchObject({ code: 'bad_passkey' });
    expect(await body(await passkeySignIn(c, first.device, { challenge: 'A'.repeat(43) }))).toMatchObject({ code: 'bad_passkey' });
    const stranger = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    expect(await body(await passkeySignIn(c, first.device, { key: stranger }))).toMatchObject({ code: 'bad_passkey' });
    // A passkey made for this site but not by Dushu: its user handle names no account.
    const other = fakeAuthenticator();
    const handle = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await other.create({ challenge: 'A'.repeat(43), rp: { id: 'henryyhong.com' }, user: { id: handle } }, PAGE);
    expect(await body(await passkeySignIn(c, other))).toMatchObject({ code: 'no_account' });
    expect((await passkeySignIn(c, first.device)).status).toBe(200);
  });

  it('stops an invite the owner stops, and keeps the accounts it made', async () => {
    const c = cloud({ OWNER_EMAILS: OWNER });
    const owner = await signedIn(c, OWNER);
    const token = await invite(c, owner);
    const { device } = await join(c, token, 'Amy');
    await c.call(`/invites?token=${token}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } });
    expect(await body(await c.post('/auth/passkey/join-options', { invite: token, name: 'Ben' }))).toMatchObject({ code: 'bad_invite' });
    expect((await body(await c.call('/invites', { headers: { Authorization: `Bearer ${owner}` } }))).invites).toEqual([]);
    expect((await passkeySignIn(c, device)).status).toBe(200);
  });

  it('signs in no more once the account is deleted', async () => {
    const c = cloud({ OWNER_EMAILS: OWNER });
    const { res, device } = await join(c, await invite(c, await signedIn(c, OWNER)), 'Amy');
    await c.post('/me/delete', {}, (await body(res)).token);
    expect(await body(await passkeySignIn(c, device))).toMatchObject({ code: 'no_account' });
  });

  it('refuses a passkey whose counter went back, as a copied key would', async () => {
    const c = cloud({ OWNER_EMAILS: OWNER });
    const device = fakeAuthenticator({ counts: true });
    await join(c, await invite(c, await signedIn(c, OWNER)), 'Amy', device);
    expect((await passkeySignIn(c, device)).status).toBe(200);
    expect((await passkeySignIn(c, device)).status).toBe(200);
    for (const k of device.held.values()) k.counter = 0;
    expect((await passkeySignIn(c, device)).status).toBe(401);
  });

  it('adds a passkey to the owner’s email account, and that passkey signs in to it', async () => {
    const c = cloud({ OWNER_EMAILS: OWNER, ALLOWED_EMAILS: OWNER });
    const owner = await signedIn(c, OWNER);
    const device = fakeAuthenticator();
    const options = await body(await c.post('/me/passkey/options', {}, owner));
    expect(options.user).toMatchObject({ name: OWNER, displayName: OWNER });
    const added = await c.post('/me/passkey', { challenge: options.challenge, response: await device.create(options as CreateOptions, PAGE) }, owner);
    expect(added.status).toBe(200);
    expect((await me(c, owner)).passkeys).toBe(1);
    const res = await passkeySignIn(c, device);
    const back = await body(res);
    expect(back.email).toBe(OWNER);
    expect(await me(c, back.token)).toMatchObject({ owner: true });
    // A second passkey on the same device is not offered again.
    const next = await body(await c.post('/me/passkey/options', {}, owner));
    expect(next.excludeCredentials).toEqual([{ type: 'public-key', id: [...device.held.keys()][0] }]);
    // Nor can a challenge made for one account add a passkey to another.
    const friend = (await body((await join(c, await invite(c, owner), 'Amy')).res)).token;
    const stolen = await c.post('/me/passkey', { challenge: next.challenge, response: await device.create(next as CreateOptions, PAGE) }, friend);
    expect(stolen.status).toBe(400);
  });
});

describe('the app’s passkeys', () => {
  it('joins on an invite, signs out, signs in with the passkey, and the owner adds one', async () => {
    const c = cloud({ OWNER_EMAILS: OWNER, ALLOWED_EMAILS: OWNER });
    const owner = await signedIn(c, OWNER);
    const token = await invite(c, owner);
    const device = fakeAuthenticator();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      return c.call(url.pathname + url.search, { method: req.method, headers: Object.fromEntries(req.headers), body: req.method === 'GET' ? undefined : await req.text() });
    });
    vi.stubGlobal('PublicKeyCredential', class {});
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      create: async ({ publicKey }: { publicKey: PublicKeyCredentialCreationOptions }) => {
        const b64 = (b: BufferSource) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return asBrowserCredential(await device.create({ challenge: b64(publicKey.challenge), rp: { id: publicKey.rp.id! }, user: { id: b64(publicKey.user.id) } }, PAGE));
      },
      get: async ({ publicKey }: { publicKey: PublicKeyCredentialRequestOptions }) => {
        const b64 = (b: BufferSource) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return asBrowserCredential(await device.get({ challenge: b64(publicKey.challenge), rpId: publicKey.rpId! }, PAGE));
      },
    } });
    try {
      localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
      const s = await joinWithPasskey(token, 'Amy');
      expect(cloudSession()).toMatchObject({ email: s.email, name: 'Amy' });
      expect(accountLabel(cloudSession()!)).toBe('Amy');
      await signOut();
      expect(cloudSession()).toBeNull();
      const back = await signInWithPasskey();
      expect(back).toMatchObject({ email: s.email, name: 'Amy' });

      // The owner, signed in by email, adds a passkey on this device; it then signs in to the owner's account.
      localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: owner, email: OWNER }));
      await addPasskey();
      await signOut();
      device.held.delete([...device.held.keys()][0]); // only the owner's passkey is left on this device
      expect((await signInWithPasskey()).email).toBe(OWNER);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).credentials;
    }
  });
});
