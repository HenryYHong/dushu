// Google, for tests: a test RSA key published the way Google publishes its own (a JWKS, answered through the Worker's
// injected fetch, never the network), and the answer Google's sign-in page sends back to the app: an ID token signed with
// that key for the trip's client id and nonce, in the fragment with the trip's state.
import { GOOGLE_CERTS } from '../../cloud/src/google';

const enc = new TextEncoder();
export const b64 = (data: Uint8Array | string): string => {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export async function fakeGoogle() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const { n, e } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const g = {
    fetches: 0,
    /** Google's certs endpoint (the Worker's env.googleFetch). */
    fetch: (async (input: RequestInfo | URL) => {
      if (String(input) !== GOOGLE_CERTS) throw new Error(`unexpected fetch ${String(input)}`);
      g.fetches++;
      return new Response(JSON.stringify({ keys: [{ kty: 'RSA', alg: 'RS256', use: 'sig', kid: 'g1', n, e }] }), { headers: { 'Cache-Control': 'public, max-age=600' } });
    }) as typeof fetch,
    /** What Google sends back for the sign-in address `url` (the app's startGoogleSignIn): the person picked `email`. */
    async answer(url: URL, email: string): Promise<string> {
      const now = Math.floor(Date.now() / 1000);
      const client = url.searchParams.get('client_id');
      const head = b64(JSON.stringify({ alg: 'RS256', kid: 'g1', typ: 'JWT' }));
      const body = b64(JSON.stringify({ iss: 'https://accounts.google.com', aud: client, azp: client, sub: '1029384756', email, email_verified: true,
        nonce: url.searchParams.get('nonce'), iat: now, exp: now + 3600 }));
      const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(`${head}.${body}`)));
      return `#state=${url.searchParams.get('state')}&id_token=${head}.${body}.${b64(sig)}&authuser=0&prompt=consent`;
    },
  };
  return g;
}
