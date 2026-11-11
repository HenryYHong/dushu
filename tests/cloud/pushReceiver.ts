// A browser's side of Web Push, for tests: a subscription with its own keys, and the decryption a browser does on a message
// (RFC 8291 from the user agent's side), written apart from cloud/src/push.ts so the two check each other.
import { b64url, fromB64url } from '../../cloud/src/push';

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
const concat = (...parts: (Uint8Array | number[])[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

export interface Receiver { privateKey: CryptoKey; publicKey: Bytes; auth: Bytes }

/** A browser's subscription keys: a fresh P-256 pair and a 16-byte auth secret. */
export async function newReceiver(): Promise<Receiver> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer), auth: crypto.getRandomValues(new Uint8Array(16)) };
}

/** The subscription a browser gives the app (PushSubscription.toJSON()). */
export const subscriptionOf = (r: Receiver, endpoint: string) => ({ endpoint, keys: { p256dh: b64url(r.publicKey), auth: b64url(r.auth) } });

/** A key pair from base64url values (an RFC example's), for ECDH. */
export async function ecdhPair(publicKey: string, privateKey: string): Promise<CryptoKeyPair> {
  const pub = fromB64url(publicKey)!;
  const jwk = { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), d: privateKey, ext: true };
  return {
    privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  };
}

/** What a browser reads from an aes128gcm push body: the header's salt and sender key, the same derivation, then AES-GCM. */
export async function decryptPush(body: Uint8Array, r: Receiver): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  if (rs < 18 || sealed.length > rs) throw new Error('Not one record.');
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, r.privateKey, 256));
  const prkKey = await hmac(concat(r.auth), ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info'), [0], r.publicKey, asPublic, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm'), [0, 1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce'), [0, 1]))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
  // The last record ends with 0x02 and any zeros after it.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error('No last-record delimiter.');
  return new TextDecoder().decode(padded.slice(0, end));
}

/** A VAPID Authorization header taken apart and its signature checked against the key it names: the JWT's claims. */
export async function checkVapid(header: string): Promise<{ claims: { aud: string; exp: number; sub: string }; head: unknown; key: string }> {
  const m = /^vapid t=([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+), k=([A-Za-z0-9_-]+)$/.exec(header);
  if (!m) throw new Error(`Not a VAPID header: ${header}`);
  const [, h, c, sig, k] = m;
  const pub = await crypto.subtle.importKey('raw', fromB64url(k)!, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(sig)!, enc.encode(`${h}.${c}`));
  if (!ok) throw new Error('The VAPID signature does not verify.');
  const json = (part: string) => JSON.parse(new TextDecoder().decode(fromB64url(part)!));
  return { claims: json(c), head: json(h), key: k };
}
