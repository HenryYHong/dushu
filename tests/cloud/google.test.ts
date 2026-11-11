// Sign-in with Google on the sync server (cloud/src/google.ts, POST /auth/google): the Worker checks Google's ID token itself,
// against a test RSA key published as Google publishes its own (a JWKS answered through the injected fetch, never the
// network), and signs the device in to the same account an emailed code reaches. Each refused token differs from a good one
// in one thing only, so a check that went missing lets that token in and fails here.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GOOGLE_CERTS, GoogleTokenError, forgetGoogleKeys, verifyGoogleIdToken } from '../../cloud/src/google';
import { cloud, signedIn } from './helpers';

const CLIENT = '1234567890-test.apps.googleusercontent.com';
const enc = new TextEncoder();
const b64 = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const rsa = () => crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as Promise<CryptoKeyPair>;
async function published(pair: CryptoKeyPair, kid: string) {
  const { n, e } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kty: 'RSA', alg: 'RS256', use: 'sig', kid, n, e };
}

/** Google's key (k1), a key Google never published (to forge with), and Google's next key (k2, published later). */
let google1: CryptoKeyPair;
let stranger: CryptoKeyPair;
let google2: CryptoKeyPair;
beforeAll(async () => { [google1, stranger, google2] = await Promise.all([rsa(), rsa(), rsa()]); });
beforeEach(() => forgetGoogleKeys());

/** Google's certs endpoint: the keys it publishes now, and how many times it was asked. */
async function certs(keys?: object[]) {
  const g = {
    keys: keys ?? [await published(google1, 'k1')],
    fetches: 0,
    fetch: (async (input: RequestInfo | URL) => {
      g.fetches++;
      if (String(input) !== GOOGLE_CERTS) throw new Error(`unexpected fetch ${String(input)}`);
      return new Response(JSON.stringify({ keys: g.keys }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=21600, must-revalidate, no-transform' } });
    }) as typeof fetch,
  };
  return g;
}

const nonce = () => b64(crypto.getRandomValues(new Uint8Array(32)));

/** An ID token as Google signs one for this client (iss, aud, azp, sub, email, iat, exp, nonce), with `claims` changed. */
async function idToken(n: string, claims: Record<string, unknown> = {}, opts: { kid?: string; key?: CryptoKey; alg?: string } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: 'https://accounts.google.com', azp: CLIENT, aud: CLIENT, sub: '110169484474386276334', email: 'reader@example.com',
    email_verified: true, at_hash: 'x', nonce: n, iat: now, exp: now + 3600, ...claims,
  };
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
  const head = b64(JSON.stringify({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', opts.key ?? google1.privateKey, enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(sig)}`;
}

type Cloud = ReturnType<typeof cloud>;
const json = async (r: Response) => await r.json() as Record<string, any>;
async function googleIn(c: Cloud, claims: Record<string, unknown> = {}, opts: Parameters<typeof idToken>[2] & { ip?: string } = {}) {
  const n = nonce();
  const headers: Record<string, string> = opts.ip ? { 'CF-Connecting-IP': opts.ip } : {};
  return c.call('/auth/google', { method: 'POST', headers, body: JSON.stringify({ idToken: await idToken(n, claims, opts), nonce: n }) });
}
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const idOf = (token: string) => token.split('.')[0];

describe('signing in with Google', () => {
  it('signs in to the account an emailed code reaches: the same words, the same account, and the directory hears of it', async () => {
    const g = await certs();
    const c = cloud({ GOOGLE_CLIENT_ID: CLIENT, googleFetch: g.fetch });
    // First by code, with a word saved.
    const byCode = await signedIn(c, 'reader@example.com');
    const first = await json(await c.call('/me', auth(byCode)));
    await c.post('/sync', { changes: [{ key: 'v:你好', at: 5, data: { id: '你好', simp: '你好', addedAt: 5 } }] }, byCode);

    // Then with Google, the address written as Google may write it: the same account.
    const res = await googleIn(c, { email: 'Reader@Example.com' });
    expect(res.status).toBe(200);
    const signed = await json(res);
    expect(signed).toEqual({ token: expect.stringMatching(/^[0-9a-f]{64}\.[A-Za-z0-9_-]{43}$/), email: 'reader@example.com', created: expect.any(String) });
    expect(idOf(signed.token)).toBe(idOf(byCode));
    expect(await json(await c.call('/me', auth(signed.token)))).toMatchObject({ email: 'reader@example.com', owner: false });
    const reply = await json(await c.post('/sync', { since: 0, changes: [] }, signed.token));
    expect(reply.records.map((r: { key: string }) => r.key)).toContain('v:你好');
    // Both devices stay signed in.
    expect((await c.call('/me', auth(byCode))).status).toBe(200);
    expect(first.email).toBe('reader@example.com');
    // Google's id for the person is noted (privacy.html: "the ID Google gives your account").
    expect(c.stores.get(idOf(signed.token))!.getMeta('google')).toBe('110169484474386276334');
    expect(c.directory.person(idOf(signed.token))?.tz).toBe('UTC');
    expect(g.fetches).toBe(1);
  });

  it('makes the account the first time, kept like a code’s, and tells the directory', async () => {
    const c = cloud({ GOOGLE_CLIENT_ID: CLIENT, googleFetch: (await certs()).fetch });
    const res = await googleIn(c, { email: 'new@example.com', sub: '42' });
    const signed = await json(res);
    expect(signed).toMatchObject({ email: 'new@example.com', created: expect.stringMatching(/^\d+$/) });
    expect(c.directory.person(idOf(signed.token))?.tz).toBe('UTC');
    // The same address by code later reaches it too.
    const byCode = await signedIn(c, 'new@example.com');
    expect(idOf(byCode)).toBe(idOf(signed.token));
    // A later sign-in keeps `created`: the app keys its marks for the account by it.
    expect((await json(await googleIn(c, { email: 'new@example.com', sub: '42' }))).created).toBe(signed.created);
  });

  it('refuses a token that is not Google’s, not for this app, not current, not for this attempt, or without a verified address', async () => {
    const c = cloud({ GOOGLE_CLIENT_ID: CLIENT, googleFetch: (await certs()).fetch });
    const now = Math.floor(Date.now() / 1000);
    const refused = async (why: string, claims: Record<string, unknown>, opts: Parameters<typeof idToken>[2] = {}) => {
      const res = await googleIn(c, claims, opts);
      expect({ why, status: res.status, code: (await json(res)).code }).toEqual({ why, status: 401, code: 'bad_google' });
    };
    await refused('another app’s token', { aud: 'someone-else.apps.googleusercontent.com', azp: 'someone-else.apps.googleusercontent.com' });
    await refused('another party it was issued to', { azp: 'someone-else.apps.googleusercontent.com' });
    await refused('a list without this app', { aud: ['someone-else'] });
    await refused('another issuer', { iss: 'https://accounts.evil.example' });
    await refused('no issuer', { iss: undefined });
    await refused('expired', { exp: now - 120 });
    await refused('issued in the future', { iat: now + 600 });
    await refused('no expiry', { exp: undefined });
    await refused('no subject', { sub: undefined });
    await refused('no email', { email: undefined });
    await refused('signed by a key Google never published', {}, { key: stranger.privateKey });
    await refused('an algorithm that is not RS256', {}, { alg: 'HS256' });
    await refused('no algorithm', {}, { alg: 'none' });

    // The nonce the app sends must be the token's (a token taken from another attempt).
    const n = nonce();
    const other = await c.post('/auth/google', { idToken: await idToken(n), nonce: nonce() });
    expect(await json(other)).toMatchObject({ code: 'bad_google' });
    // And a nonce that is no nonce is not even looked at.
    expect((await c.post('/auth/google', { idToken: await idToken('short'), nonce: 'short' })).status).toBe(400);
    expect((await c.post('/auth/google', { idToken: 'not.a token', nonce: nonce() })).status).toBe(401);

    // An address Google has not verified proves nothing.
    const unverified = await googleIn(c, { email_verified: false });
    expect(unverified.status).toBe(403);
    expect(await json(unverified)).toMatchObject({ code: 'unverified_email' });

    // A little clock difference is allowed: a minute past expiry, five minutes "early".
    expect((await googleIn(c, { exp: now - 30 })).status).toBe(200);
    expect((await googleIn(c, { iat: now + 120 })).status).toBe(200);
    expect((await googleIn(c, { iss: 'accounts.google.com' })).status).toBe(200);
    // Nothing above made an account but the good ones.
    const accounts = [...c.stores.values()].filter((s) => s.getMeta('email'));
    expect(accounts.length).toBe(1);
  });

  it('signs in once with a token: the nonce is remembered', async () => {
    const c = cloud({ GOOGLE_CLIENT_ID: CLIENT, googleFetch: (await certs()).fetch });
    const n = nonce();
    const body = { idToken: await idToken(n), nonce: n };
    expect((await c.post('/auth/google', body)).status).toBe(200);
    const again = await c.post('/auth/google', body);
    expect(again.status).toBe(401);
    expect(await json(again)).toMatchObject({ code: 'used' });
  });

  it('keeps Google’s keys for their max-age, fetches once more for a kid it does not know, then refuses', async () => {
    const g = await certs();
    const c = cloud({ GOOGLE_CLIENT_ID: CLIENT, googleFetch: g.fetch });
    expect((await googleIn(c)).status).toBe(200);
    expect((await googleIn(c)).status).toBe(200);
    expect(g.fetches).toBe(1);
    const t0 = Date.now();
    const check = async (kid: string, key: CryptoKey, at: number) => {
      const n = nonce();
      try { await verifyGoogleIdToken(await idToken(n, {}, { kid, key }), n, CLIENT, { fetch: g.fetch, now: at }); return 'ok'; } catch (e) { return e instanceof GoogleTokenError ? e.reason : String(e); }
    };
    // A kid it does not have, a minute after the keys came: asked once more, still not there, refused.
    expect(await check('k9', stranger.privateKey, t0 + 61_000)).toBe('unknown kid');
    expect(g.fetches).toBe(2);
    // Google starts signing with its next key: the first token with it, a minute on, fetches the new list and signs in.
    g.keys = [await published(google1, 'k1'), await published(google2, 'k2')];
    expect(await check('k2', google2.privateKey, t0 + 122_000)).toBe('ok');
    expect(g.fetches).toBe(3);
    // Past the max-age (21,600 s) the keys are fetched again before any token is checked.
    const n = nonce();
    const later = t0 + 122_000 + 21_601_000;
    await expect(verifyGoogleIdToken(await idToken(n), n, CLIENT, { fetch: g.fetch, now: later })).rejects.toThrow(GoogleTokenError);
    expect(g.fetches).toBe(4);
  });

  it('does not ask Google again for every made-up kid: at most once a minute', async () => {
    const g = await certs();
    const c = cloud({ GOOGLE_CLIENT_ID: CLIENT, googleFetch: g.fetch });
    expect((await googleIn(c)).status).toBe(200);
    expect(g.fetches).toBe(1);
    // Tokens naming kids Google never published, one after another (each from its own network, so no daily limit stops
    // them): the keys were fetched just now, so none of them is a reason to fetch again.
    for (let i = 0; i < 20; i++) {
      const res = await googleIn(c, {}, { kid: `made-up-${i}`, key: stranger.privateKey, ip: `198.51.100.${i + 1}` });
      expect(await json(res)).toMatchObject({ code: 'bad_google' });
    }
    expect(g.fetches).toBe(1);
    // The good key still signs in, with no fetch either.
    expect((await googleIn(c)).status).toBe(200);
    expect(g.fetches).toBe(1);
    // A minute on, one more look for an unknown kid, and again none for the next ones.
    const later = Date.now() + 61_000;
    for (let i = 0; i < 5; i++) {
      const n = nonce();
      await expect(verifyGoogleIdToken(await idToken(n, {}, { kid: `later-${i}`, key: stranger.privateKey }), n, CLIENT, { fetch: g.fetch, now: later + i * 1000 }))
        .rejects.toThrow(GoogleTokenError);
    }
    expect(g.fetches).toBe(2);
  });

  it('says why a token was refused, to the tests and the log (the app sees one message)', async () => {
    const g = await certs();
    const n = nonce();
    const reason = async (token: string, given = n) => {
      try { await verifyGoogleIdToken(token, given, CLIENT, { fetch: g.fetch }); return 'ok'; } catch (e) { return e instanceof GoogleTokenError ? e.reason : String(e); }
    };
    expect(await reason(await idToken(n))).toBe('ok');
    expect(await reason(await idToken(n, { aud: 'x' }))).toBe('aud');
    expect(await reason(await idToken(n, { iss: 'x' }))).toBe('iss');
    expect(await reason(await idToken(n, { exp: 1 }))).toBe('exp');
    expect(await reason(await idToken(n, { iat: Math.floor(Date.now() / 1000) + 3600 }))).toBe('iat');
    expect(await reason(await idToken(n), nonce())).toBe('nonce');
    expect(await reason(await idToken(n, {}, { key: stranger.privateKey }))).toBe('signature');
    expect(await reason(await idToken(n, {}, { kid: 'nope' }))).toBe('unknown kid');
    // A signature from another token: right key, wrong bytes.
    const [h, p] = (await idToken(n, { sub: 'someone-else' })).split('.');
    expect(await reason(`${h}.${p}.${(await idToken(n)).split('.')[2]}`)).toBe('signature');
  });

  it('is off without a client id (503), keeps to ALLOWED_EMAILS, and limits a network to 100 a day', async () => {
    const g = await certs();
    const off = cloud({ googleFetch: g.fetch });
    const res = await googleIn(off);
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ code: 'no_google' });
    expect(g.fetches).toBe(0);

    const closed = cloud({ GOOGLE_CLIENT_ID: CLIENT, googleFetch: g.fetch, ALLOWED_EMAILS: 'owner@example.com' });
    expect((await googleIn(closed)).status).toBe(403);
    expect((await googleIn(closed, { email: 'owner@example.com' })).status).toBe(200);

    const c = cloud({ GOOGLE_CLIENT_ID: CLIENT, googleFetch: g.fetch });
    // Bad tokens count too: a network cannot try forever.
    for (let i = 0; i < 99; i++) expect((await googleIn(c, { aud: 'x' }, { ip: '203.0.113.9' })).status).toBe(401);
    expect((await googleIn(c, {}, { ip: '203.0.113.9' })).status).toBe(200);
    const over = await googleIn(c, {}, { ip: '203.0.113.9' });
    expect(over.status).toBe(429);
    expect((await json(over)).error).toMatch(/Too many Google sign-ins from this network today/);
    // Another network is its own.
    expect((await googleIn(c, {}, { ip: '198.51.100.4' })).status).toBe(200);
  });
});
