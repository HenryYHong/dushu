// Web Push as the sync server sends it (cloud/src/push.ts): the encryption checked byte for byte against the worked example in
// RFC 8291 (Section 5 and Appendix A), a browser's decryption (tests/cloud/pushReceiver.ts) of what it sends, the VAPID header's
// signature and claims (RFC 8292), the subscriptions it keeps, and what a push service's answers mean.
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { b64url, encryptPush, fromB64url, pushSubscription, sendPush, vapidAuth, vapidKeys, VAPID_SUBJECT, type PushRecord } from '../../cloud/src/push';
import { checkVapid, decryptPush, ecdhPair, newReceiver, subscriptionOf } from './pushReceiver';

/** RFC 8291 Section 5 and Appendix A, as printed there (line breaks and spaces taken out). */
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml'
    + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT'
    + 'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** A VAPID_KEYS secret as scripts/make-vapid.mjs writes one. */
async function vapidSecret(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  return JSON.stringify({ publicKey: b64url(pub), privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d });
}

describe('the encryption (RFC 8291)', () => {
  it('makes exactly the RFC’s example message from its keys and salt', async () => {
    const body = await encryptPush({ p256dh: RFC.uaPublic, auth: RFC.auth }, fromB64url(RFC.plaintext)!, {
      salt: fromB64url(RFC.salt)!, keys: await ecdhPair(RFC.asPublic, RFC.asPrivate),
    });
    expect(new TextDecoder().decode(fromB64url(RFC.plaintext)!)).toBe('When I grow up, I want to be a watermelon');
    // The 86-byte header, the ciphertext after it, and the whole body as Section 5 sends it: 144 bytes (41 of text, the
    // delimiter, the 16-byte tag and the header). Section 5's Content-Length says 145, one more than its own body decodes to.
    expect(body.length).toBe(144);
    expect(fromB64url(RFC.body)!.length).toBe(144);
    expect(b64url(body.slice(0, 86))).toBe(RFC.header);
    expect(b64url(body.slice(86))).toBe(RFC.ciphertext);
    expect(b64url(body)).toBe(RFC.body);
    // And the browser in the example reads it back with its private key.
    const ua = await ecdhPair(RFC.uaPublic, RFC.uaPrivate);
    expect(await decryptPush(body, { privateKey: ua.privateKey, publicKey: fromB64url(RFC.uaPublic)!, auth: fromB64url(RFC.auth)! })).toBe('When I grow up, I want to be a watermelon');
  });

  it('uses a fresh salt and key for every message, which the browser decrypts', async () => {
    const r = await newReceiver();
    const to = { p256dh: b64url(r.publicKey), auth: b64url(r.auth) };
    const text = JSON.stringify({ title: 'LinguPengu', body: '7 words are ready to review.' });
    const [a, b] = await Promise.all([encryptPush(to, new TextEncoder().encode(text)), encryptPush(to, new TextEncoder().encode(text))]);
    expect(b64url(a.slice(0, 16))).not.toBe(b64url(b.slice(0, 16)));
    expect(b64url(a.slice(21, 86))).not.toBe(b64url(b.slice(21, 86)));
    expect(await decryptPush(a, r)).toBe(text);
    expect(await decryptPush(b, r)).toBe(text);
    // Another browser's keys cannot read it.
    await expect(decryptPush(a, await newReceiver())).rejects.toThrow();
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a JWT for the push service’s origin, good for at most a day, with the site as its subject', async () => {
    const vapid = (await vapidKeys(await vapidSecret()))!;
    const now = Date.UTC(2026, 10, 11, 18);
    const header = await vapidAuth('https://fcm.googleapis.com/fcm/send/abc:def?x=1', vapid, now);
    const { claims, head, key } = await checkVapid(header);
    expect(head).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(key).toBe(vapid.publicKey);
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe(VAPID_SUBJECT);
    expect(claims.sub).toBe('https://henryyhong.com/dushu/');
    expect(claims.exp).toBeGreaterThan(now / 1000);
    expect(claims.exp).toBeLessThanOrEqual(now / 1000 + 24 * 3600);
    // Signed by this key and no other.
    const other = (await vapidKeys(await vapidSecret()))!;
    await expect(checkVapid(header.replace(/k=.*$/, `k=${other.publicKey}`))).rejects.toThrow(/does not verify/);
  });

  it('reads the secret only as a 65-byte public point and a 32-byte private scalar', async () => {
    expect(await vapidKeys(undefined)).toBeNull();
    expect(await vapidKeys('not json')).toBeNull();
    const good = JSON.parse(await vapidSecret()) as { publicKey: string; privateKey: string };
    expect(await vapidKeys(JSON.stringify({ ...good, publicKey: good.publicKey.slice(2) }))).toBeNull();
    expect(await vapidKeys(JSON.stringify({ ...good, privateKey: b64url(new Uint8Array(31)) }))).toBeNull();
    expect((await vapidKeys(JSON.stringify(good)))?.publicKey).toBe(good.publicKey);
  });

  it('gets a key pair from scripts/make-vapid.mjs, as only the JSON the secret takes', async () => {
    const out = execFileSync(process.execPath, ['scripts/make-vapid.mjs'], { encoding: 'utf8' });
    const parsed = JSON.parse(out) as Record<string, string>;
    expect(Object.keys(parsed).sort()).toEqual(['privateKey', 'publicKey']);
    const vapid = await vapidKeys(out);
    expect(vapid).not.toBeNull();
    await checkVapid(await vapidAuth('https://web.push.apple.com/abc', vapid!, Date.now()));
    // A new pair each time.
    expect(JSON.parse(execFileSync(process.execPath, ['scripts/make-vapid.mjs'], { encoding: 'utf8' })).publicKey).not.toBe(parsed.publicKey);
  });
});

describe('subscriptions', () => {
  it('keeps an https endpoint and keys of the right sizes, and nothing else', async () => {
    const r = await newReceiver();
    const sub = subscriptionOf(r, 'https://updates.push.services.mozilla.com/wpush/v2/gAAAA');
    expect(pushSubscription(sub)).toEqual({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
    // Padded base64 (some libraries write it) is the same key.
    expect(pushSubscription({ ...sub, keys: { p256dh: Buffer.from(r.publicKey).toString('base64'), auth: Buffer.from(r.auth).toString('base64') } })?.p256dh).toBe(sub.keys.p256dh);
    for (const bad of [
      null, 'x', {}, { ...sub, endpoint: 'http://push.example.com/x' }, { ...sub, endpoint: 'https://user:pw@push.example.com/x' },
      { ...sub, endpoint: 'https://localhost/x' }, { ...sub, endpoint: `https://push.example.com/${'a'.repeat(2100)}` }, { ...sub, endpoint: 'not a url' },
      { ...sub, keys: { ...sub.keys, p256dh: b64url(r.publicKey.slice(1)) } }, { ...sub, keys: { ...sub.keys, auth: b64url(new Uint8Array(15)) } },
      { ...sub, keys: { p256dh: 'not base64!', auth: sub.keys.auth } }, { endpoint: sub.endpoint },
    ]) expect(pushSubscription(bad)).toBeNull();
  });
});

describe('sending', () => {
  const record = async (endpoint = 'https://fcm.googleapis.com/fcm/send/abc'): Promise<{ to: PushRecord; r: Awaited<ReturnType<typeof newReceiver>> }> => {
    const r = await newReceiver();
    return { to: { endpoint, p256dh: b64url(r.publicKey), auth: b64url(r.auth), added: 0 }, r };
  };

  it('posts the encrypted message with the headers push services want, and reads their answers', async () => {
    const vapid = (await vapidKeys(await vapidSecret()))!;
    const { to, r } = await record();
    const seen: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const fetcher = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(null, { status }); }) as unknown as typeof fetch;
    const message = { title: 'LinguPengu', body: '5 words are ready to review.', url: 'https://henryyhong.com/dushu/#/review', tag: 'review' };
    expect(await sendPush(to, message, vapid, { fetch: fetcher })).toBe('sent');
    const { url, init } = seen[0];
    expect(url).toBe(to.endpoint);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect([headers.get('TTL'), headers.get('Urgency'), headers.get('Content-Encoding')]).toEqual(['86400', 'normal', 'aes128gcm']);
    expect((await checkVapid(headers.get('Authorization')!)).claims.aud).toBe('https://fcm.googleapis.com');
    expect(JSON.parse(await decryptPush(init.body as Uint8Array, r))).toEqual(message);

    for (const [code, result] of [[404, 'gone'], [410, 'gone'], [429, 'failed'], [500, 'failed'], [413, 'failed']] as const) {
      status = code;
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await sendPush(to, message, vapid, { fetch: fetcher })).toBe(result);
    }
    const down = (async () => { throw new TypeError('network'); }) as unknown as typeof fetch;
    expect(await sendPush(to, message, vapid, { fetch: down })).toBe('failed');
    vi.restoreAllMocks();
  });

  it('gives up on a subscription whose key is not a point on the curve, without sending', async () => {
    const vapid = (await vapidKeys(await vapidSecret()))!;
    const { to } = await record();
    const broken = new Uint8Array(65);
    broken[0] = 4;
    const fetcher = vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
    expect(await sendPush({ ...to, p256dh: b64url(broken) }, { title: 'x' }, vapid, { fetch: fetcher })).toBe('gone');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
