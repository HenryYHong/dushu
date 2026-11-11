// Web Push, written here with WebCrypto so the Worker needs no library: a message encrypted for one browser (RFC 8291, the
// aes128gcm content coding of RFC 8188) and signed for the push service with VAPID (RFC 8292). A browser that turns on review
// reminders gives the account a subscription (its push service's URL and two keys); the account sends to it at the person's
// 6 PM when words are waiting (followups.ts). Push costs nothing to send, has no daily cap, and needs no email address, so it
// comes before email: Resend's free plan sends 100 emails a day for sign-in codes and follow-ups together.
//
// The server's own key pair (VAPID_KEYS, a Worker secret made by scripts/make-vapid.mjs) is what the browser checks every
// message against: the public half is given to the app (GET /push/key) when it subscribes, and only a message signed with the
// private half is delivered. Each message is also encrypted with a fresh key pair, so the push service never reads it.

const enc = new TextEncoder();

/** What a link to the app's site says it is, for push services that want to know who to contact (RFC 8292 "sub"). */
export const VAPID_SUBJECT = 'https://henryyhong.com/dushu/';
/** How long a signed request is good for: RFC 8292 allows 24 hours at most; half that leaves room for a clock that is off. */
const VAPID_TTL_S = 12 * 3600;
/** The one record a message is sent in (RFC 8188 "rs"): far more than a reminder needs, and what push services accept. */
const RECORD_SIZE = 4096;
/** The longest text a message carries: 4096 bytes of body less the header (86), the delimiter (1) and the tag (16). */
export const MAX_PLAINTEXT = 4096 - 86 - 1 - 16;
/** Subscriptions an account keeps (one per browser or phone): past it the oldest goes. */
export const MAX_PUSH_DEVICES = 10;
/** The longest endpoint kept. Push services give a few hundred characters; this leaves room without keeping a document. */
const MAX_ENDPOINT = 2048;
/**
 * How long a push service has to answer. A real one answers in well under a second; an endpoint is any https URL (see
 * pushSubscription), and one that never answers would otherwise hold the account's follow-up, and the directory's whole batch
 * waiting on it, for as long as Cloudflare lets a request hang.
 */
export const PUSH_TIMEOUT_MS = 10_000;

/** Bytes that WebCrypto takes (TypeScript's DOM types want an ArrayBuffer behind them, never a SharedArrayBuffer). */
type Bytes = Uint8Array<ArrayBuffer>;

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url (or plain base64, padded or not) to bytes; null when it is not one. */
export function fromB64url(text: unknown): Bytes | null {
  if (typeof text !== 'string' || text.length > 4096 || !/^[A-Za-z0-9_+/-]*={0,2}$/.test(text)) return null;
  const plain = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (plain.length % 4 === 1) return null;
  try {
    const bin = atob(plain + '='.repeat((4 - (plain.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

function concat(...parts: (Uint8Array | number[])[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// ------------------------------------------------------------ subscriptions ---

/** A browser's push subscription as the account keeps it: where to send, its two keys, and which signed-in device gave it. */
export interface PushRecord {
  endpoint: string;
  /** The browser's P-256 public key (65 bytes, uncompressed) and its 16-byte auth secret, base64url as the browser gave them. */
  p256dh: string;
  auth: string;
  added: number;
  /** The session (its hash) that added it: signing that device out stops its reminders too. */
  by?: string;
}

/**
 * A subscription as PushSubscription.toJSON() gives it ({ endpoint, keys: { p256dh, auth } }), checked: an https URL of sane
 * length with no user name in it, and keys that are a 65-byte point and a 16-byte secret. Null when it is not one.
 *
 * The endpoint is not limited to a list of push services. The Worker sends to it at most once a week, with an encrypted body,
 * and a Worker cannot reach a private network, so an endpoint that is not a push service gains nobody anything; a list would
 * have to know every browser's service (Chrome's, Firefox's, Apple's, Microsoft's) and would break on the next one.
 */
export function pushSubscription(input: unknown): Pick<PushRecord, 'endpoint' | 'p256dh' | 'auth'> | null {
  if (!input || typeof input !== 'object') return null;
  const s = input as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof s.endpoint === 'string' ? s.endpoint : '';
  if (!endpoint || endpoint.length > MAX_ENDPOINT) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null;
  const p256dh = fromB64url(s.keys?.p256dh);
  const auth = fromB64url(s.keys?.auth);
  if (p256dh?.length !== 65 || auth?.length !== 16) return null;
  return { endpoint, p256dh: b64url(p256dh), auth: b64url(auth) };
}

// --------------------------------------------------------------- encryption ---

/** What a test fixes in place of the randomness: the salt and the sender's key pair (RFC 8291 Appendix A gives both). */
export interface PushRandom { salt?: Uint8Array; keys?: CryptoKeyPair }

/** The browser's key could not be used: a subscription that will never work. */
export class PushKeyError extends Error {}

/**
 * Encrypts `plaintext` for one browser (RFC 8291 §3.4): the body to POST, with the aes128gcm header (salt, record size, the
 * sender's public key) in front of the single record.
 */
export async function encryptPush(to: Pick<PushRecord, 'p256dh' | 'auth'>, plaintext: Uint8Array, random: PushRandom = {}): Promise<Bytes> {
  const uaPublic = fromB64url(to.p256dh);
  const authSecret = fromB64url(to.auth);
  if (uaPublic?.length !== 65 || authSecret?.length !== 16) throw new PushKeyError('The subscription’s keys are not the right size.');
  let uaKey: CryptoKey;
  try { uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []); } catch {
    throw new PushKeyError('The subscription’s key is not a P-256 point.');
  }
  // One record holds the whole message: its text, the delimiter and the 16-byte tag. A push service need take no more than 4096
  // bytes of body, the 86-byte header included (RFC 8291 Section 4), so the text is 3993 bytes at most.
  if (MAX_PLAINTEXT < plaintext.length) throw new Error('A push message is 3993 bytes at most.');
  const salt = random.salt ? concat(random.salt) : crypto.getRandomValues(new Uint8Array(16));
  const pair = random.keys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, pair.privateKey, 256));
  // HKDF written out as HMACs, exactly as RFC 8291 §3.4 lays it out.
  const prkKey = await hmac(authSecret, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (here the only) record, with no padding after it.
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, [2])));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

// -------------------------------------------------------------------- VAPID ---

/** The server's VAPID key pair: the public half as the browser takes it (base64url of the 65-byte point), the private to sign. */
export interface Vapid { publicKey: string; privateKey: CryptoKey }

/**
 * The VAPID_KEYS secret: JSON {"publicKey": "<base64url of the 65-byte uncompressed P-256 point>", "privateKey": "<base64url of
 * the 32-byte private scalar (a JWK's d)>"}, the form scripts/make-vapid.mjs writes and most Web Push tools print. Null when it
 * is unset or not a key pair (the routes then say push is not set up).
 */
export async function vapidKeys(secret: string | undefined): Promise<Vapid | null> {
  if (!secret) return null;
  let parsed: { publicKey?: unknown; privateKey?: unknown };
  try { parsed = JSON.parse(secret) as typeof parsed; } catch { return null; }
  const pub = fromB64url(parsed?.publicKey);
  const d = fromB64url(parsed?.privateKey);
  if (pub?.length !== 65 || pub[0] !== 4 || d?.length !== 32) return null;
  try {
    const privateKey = await crypto.subtle.importKey('jwk', {
      kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), d: b64url(d), ext: false,
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { publicKey: b64url(pub), privateKey };
  } catch { return null; }
}

/**
 * The Authorization header for one push service (RFC 8292): an ES256 JWT for the endpoint's origin, good for VAPID_TTL_S, and
 * the public key. WebCrypto signs ECDSA as r || s, 64 bytes, which is the JWS form.
 */
export async function vapidAuth(endpoint: string, vapid: Vapid, now: number): Promise<string> {
  const part = (v: unknown) => b64url(enc.encode(JSON.stringify(v)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + VAPID_TTL_S, sub: VAPID_SUBJECT })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.privateKey, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(signature)}, k=${vapid.publicKey}`;
}

// ------------------------------------------------------------------ sending ---

/** sent: the push service took it (201). gone: the subscription is dead (404 or 410, or its key is unusable): forget it. */
export type PushResult = 'sent' | 'gone' | 'failed';

/**
 * Sends one message (JSON) to one subscription. Kept a day by the push service when the device is off (TTL), delivered at normal
 * urgency (not woken for, on a phone saving its battery). A service that has not answered in PUSH_TIMEOUT_MS is a failure.
 */
export async function sendPush(to: PushRecord, message: unknown, vapid: Vapid, opts: { fetch?: typeof fetch; now?: number; random?: PushRandom; timeout?: number } = {}): Promise<PushResult> {
  let body: Bytes;
  try { body = await encryptPush(to, enc.encode(JSON.stringify(message)), opts.random); } catch (e) {
    if (e instanceof PushKeyError) return 'gone';
    throw e;
  }
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(to.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuth(to.endpoint, vapid, opts.now ?? Date.now()),
        TTL: '86400', Urgency: 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      },
      body,
      signal: AbortSignal.timeout(opts.timeout ?? PUSH_TIMEOUT_MS),
    });
  } catch (e) {
    console.error('LinguPengu push', e instanceof Error ? e.message : e);
    return 'failed';
  }
  await res.body?.cancel().catch(() => {});
  if (res.ok) return 'sent';
  if (res.status === 404 || res.status === 410) return 'gone';
  console.error('LinguPengu push: the push service answered', res.status);
  return 'failed';
}
