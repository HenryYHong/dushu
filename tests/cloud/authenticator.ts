// A passkey authenticator for tests: real P-256 keys made with WebCrypto, and the bytes a phone's authenticator sends (CBOR
// attestation with format "none", authenticator data, a DER signature), so the server's real WebAuthn checks run on them.
import { isoBase64URL, isoCBOR, isoUint8Array } from '@simplewebauthn/server/helpers';

const enc = new TextEncoder();
const sha = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>));
const b64 = (b: Uint8Array) => isoBase64URL.fromBuffer(b as Uint8Array<ArrayBuffer>);

/** A raw ECDSA signature (r || s) as DER, the way WebAuthn sends it. */
function der(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.slice(i);
    return v[0] & 0x80 ? isoUint8Array.concat([new Uint8Array([0]), v]) : v;
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  const body = isoUint8Array.concat([new Uint8Array([2, r.length]), r, new Uint8Array([2, s.length]), s]);
  return isoUint8Array.concat([new Uint8Array([0x30, body.length]), body]);
}

interface Held { pair: CryptoKeyPair; handle: string; rpID: string; counter: number }

export interface CreateOptions { challenge: string; rp: { id: string }; user: { id: string } }
export interface GetOptions { challenge: string; rpId: string }

/** One device's passkeys. `create` and `get` answer the server's options as JSON, the way the app sends them. */
export function fakeAuthenticator(opts: { counts?: boolean } = {}) {
  const held = new Map<string, Held>();
  return {
    held,
    async create(o: CreateOptions, origin: string) {
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
      const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, raw.slice(1, 33)], [-3, raw.slice(33)]]));
      const credId = crypto.getRandomValues(new Uint8Array(16));
      const authData = isoUint8Array.concat([await sha(enc.encode(o.rp.id)), new Uint8Array([0x45, 0, 0, 0, 0]), new Uint8Array(16),
        new Uint8Array([0, credId.length]), credId, cose]);
      const clientDataJSON = enc.encode(JSON.stringify({ type: 'webauthn.create', challenge: o.challenge, origin, crossOrigin: false }));
      const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
      const id = b64(credId);
      held.set(id, { pair, handle: o.user.id, rpID: o.rp.id, counter: 0 });
      return { id, rawId: id, type: 'public-key', response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject), transports: ['internal', 'hybrid'] }, clientExtensionResults: {} };
    },
    /** Signs the server's challenge with the newest passkey for its site (or the one named), as navigator.credentials.get does. */
    async get(o: GetOptions, origin: string, which?: string, sign: { challenge?: string; key?: CryptoKeyPair } = {}) {
      const [id, k] = which ? [which, held.get(which)!] : [...held].filter(([, h]) => h.rpID === o.rpId).at(-1)!;
      if (opts.counts) k.counter++;
      const counter = new Uint8Array(4);
      new DataView(counter.buffer).setUint32(0, k.counter);
      const authData = isoUint8Array.concat([await sha(enc.encode(o.rpId)), new Uint8Array([0x05]), counter]);
      const clientDataJSON = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: sign.challenge ?? o.challenge, origin, crossOrigin: false }));
      const signed = isoUint8Array.concat([authData, await sha(clientDataJSON)]);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, (sign.key ?? k.pair).privateKey, signed));
      return { id, rawId: id, type: 'public-key',
        response: { clientDataJSON: b64(clientDataJSON), authenticatorData: b64(authData), signature: b64(der(raw)), userHandle: k.handle }, clientExtensionResults: {} };
    },
  };
}

/** The same answers as browser objects, for the app's own code (core/passkey.ts) to turn back into JSON. */
export function asBrowserCredential(json: { id: string; type: string; response: Record<string, unknown> }) {
  const buf = (s: unknown) => { const b = isoBase64URL.toBuffer(String(s)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const r = json.response;
  const response: Record<string, unknown> = { clientDataJSON: buf(r.clientDataJSON) };
  if (r.attestationObject) { response.attestationObject = buf(r.attestationObject); response.getTransports = () => r.transports; }
  if (r.authenticatorData) { response.authenticatorData = buf(r.authenticatorData); response.signature = buf(r.signature); response.userHandle = r.userHandle ? buf(r.userHandle) : null; }
  return { id: json.id, rawId: buf(json.id), type: json.type, response, getClientExtensionResults: () => ({}), authenticatorAttachment: 'platform' };
}
