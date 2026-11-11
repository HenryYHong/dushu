// Sign-in with Google (worker.ts POST /auth/google). The app sends the person to Google in the same window and Google sends
// them back to https://henryyhong.com/dushu/ with an ID token in the address's fragment (OpenID Connect's implicit flow,
// response_type=id_token): a JWT Google signed, saying which Google account it is (`sub`), its email address and whether
// Google has verified it, for which app (`aud`, the client id) and for which attempt (`nonce`, made by the app). There is no
// client secret and no Google library: the Worker checks the token itself with WebCrypto, against the public keys Google
// publishes, and checks every claim that matters. Only then is the address as good as one an emailed code proved.
import { CloudError, normalEmail } from './account';

/** Where Google publishes the keys its ID tokens are signed with (JWKS). */
export const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google's two spellings of its issuer. */
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
/** A token a minute past its expiry still counts (a device's clock a little ahead of Google's); one issued up to five minutes
 * "in the future" too (the Worker's clock a little behind). */
const EXP_SKEW_S = 60;
const IAT_SKEW_S = 300;
/** Google's keys are kept as long as its answer's Cache-Control max-age says (about six hours), at most a day, and five
 * minutes when it names none. */
const KEYS_DEFAULT_S = 300;
const KEYS_MAX_S = 86_400;
/**
 * A kid the kept keys do not have is looked for at Google at most this often (per isolate). Google publishes a new key hours
 * before it signs with it, so the keys kept for their max-age nearly always have it already, and a genuine new kid waits a
 * minute at worst. Without the gap, anyone could send tokens naming made-up kids and make every one of those requests a fetch
 * to Google (a subrequest, and the keys parsed and imported again), from as many networks as they have.
 */
export const UNKNOWN_KID_GAP_MS = 60_000;
/** The app's nonce is 32 random bytes in base64url (43 characters); anything shorter than 16 is no nonce. */
export const MIN_NONCE = 16;
const MAX_NONCE = 256;
/** A Google ID token is about 1 KB; this is room to spare and no more. */
const MAX_TOKEN = 8192;

const REFUSED = 'Google sign-in could not be checked. Try again, or sign in with your email.';

/** A token that is not good: one message for the app, and the reason for the tests and the Worker's log. */
export class GoogleTokenError extends CloudError {
  constructor(readonly reason: string) { super(401, REFUSED, 'bad_google'); }
}

export interface GoogleIdentity {
  /** Google's id for the person's account: stable, unlike an address. */
  sub: string;
  /** The account's address, as accounts are named by it (normalEmail), verified by Google. */
  email: string;
}

interface Jwk { kty?: unknown; kid?: unknown; alg?: unknown; use?: unknown; n?: unknown; e?: unknown }

/**
 * Google's keys by kid, as this Worker's isolate last fetched them, until when they hold, and when they were last asked for
 * (for UNKNOWN_KID_GAP_MS). A module-level copy: an isolate lives for many requests, and a new one fetches once (a few hundred
 * bytes). A fetch under way is shared.
 */
const kept: { keys: Map<string, CryptoKey>; until: number; asked: number; loading: Promise<void> | null } = { keys: new Map(), until: 0, asked: 0, loading: null };

/** Forgets the keys (tests start each case with none). */
export function forgetGoogleKeys(): void {
  kept.keys = new Map();
  kept.until = 0;
  kept.asked = 0;
  kept.loading = null;
}

const fromB64url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

function part(s: string, reason: string): Record<string, unknown> {
  try {
    const v = JSON.parse(new TextDecoder().decode(fromB64url(s))) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* below */ }
  throw new GoogleTokenError(reason);
}

async function load(fetcher: typeof fetch, now: number): Promise<void> {
  // Noted before the answer, so a fetch that fails starts the gap too.
  kept.asked = now;
  let res: Response;
  try {
    res = await fetcher(GOOGLE_CERTS, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new CloudError(502, 'The sync server could not reach Google to check the sign-in. Try again in a minute.', 'google_down');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new CloudError(502, 'The sync server could not reach Google to check the sign-in. Try again in a minute.', 'google_down');
  }
  const body = await res.json().catch(() => null) as { keys?: unknown } | null;
  const keys = new Map<string, CryptoKey>();
  for (const k of (Array.isArray(body?.keys) ? body.keys : []) as Jwk[]) {
    // Only RSA signing keys for RS256: a key for anything else is never used to check a token.
    if (!k || k.kty !== 'RSA' || typeof k.kid !== 'string' || !k.kid || typeof k.n !== 'string' || typeof k.e !== 'string') continue;
    if ((k.alg !== undefined && k.alg !== 'RS256') || (k.use !== undefined && k.use !== 'sig')) continue;
    try {
      keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    } catch { /* not a key WebCrypto can use */ }
  }
  const cc = res.headers.get('Cache-Control') ?? '';
  const age = /(?:^|[,\s])max-age=(\d+)/i.exec(cc);
  const seconds = /no-store|no-cache/i.test(cc) ? 0 : age ? Math.min(KEYS_MAX_S, Number(age[1])) : KEYS_DEFAULT_S;
  kept.keys = keys;
  kept.until = now + seconds * 1000;
}

function refresh(fetcher: typeof fetch, now: number): Promise<void> {
  kept.loading ??= load(fetcher, now).finally(() => { kept.loading = null; });
  return kept.loading;
}

/**
 * The key Google signed with, by the token's kid. Kept keys while they hold; a kid they do not have is fetched for once more
 * (Google starts signing with a new key a while after it publishes it, so this is rare), but only when the keys were last
 * asked for at least UNKNOWN_KID_GAP_MS ago, and then refused.
 */
async function keyFor(kid: string, fetcher: typeof fetch, now: number): Promise<CryptoKey | null> {
  if (now >= kept.until) await refresh(fetcher, now);
  else if (!kept.keys.has(kid) && now - kept.asked >= UNKNOWN_KID_GAP_MS) await refresh(fetcher, now);
  return kept.keys.get(kid) ?? null;
}

/**
 * Checks a Google ID token for `clientId` and the app's `nonce`, and gives back who it is. Throws GoogleTokenError (401) when
 * it is not good, a 403 when Google has not verified the address, a 400 when the request has no nonce, and a 502 when Google's
 * keys cannot be fetched.
 */
export async function verifyGoogleIdToken(idToken: unknown, nonce: unknown, clientId: string,
  opts: { fetch?: typeof fetch; now?: number } = {}): Promise<GoogleIdentity> {
  const now = opts.now ?? Date.now();
  const fetcher = opts.fetch ?? ((input, init) => fetch(input, init));
  if (typeof nonce !== 'string' || nonce.length < MIN_NONCE || nonce.length > MAX_NONCE) throw new CloudError(400, 'The request was not understood.');
  if (typeof idToken !== 'string' || idToken.length > MAX_TOKEN || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(idToken)) throw new GoogleTokenError('shape');
  const [h, p, sig] = idToken.split('.');

  // The header first: RS256 only (never "none", never a key the token brings), and the key it names.
  const header = part(h, 'header');
  if (header.alg !== 'RS256') throw new GoogleTokenError('alg');
  if (typeof header.kid !== 'string' || !header.kid || header.kid.length > 200) throw new GoogleTokenError('kid');
  const key = await keyFor(header.kid, fetcher, now);
  if (!key) throw new GoogleTokenError('unknown kid');
  let signed: boolean;
  try {
    signed = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(sig) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(`${h}.${p}`));
  } catch { signed = false; }
  if (!signed) throw new GoogleTokenError('signature');

  // Then what it says, now that Google is known to have said it.
  const c = part(p, 'payload');
  if (typeof c.iss !== 'string' || !ISSUERS.has(c.iss)) throw new GoogleTokenError('iss');
  // For this app: its client id is the audience (a list must hold it, and then name it as the party it was issued to).
  const aud = c.aud;
  if (!(aud === clientId || (Array.isArray(aud) && aud.includes(clientId) && c.azp === clientId))) throw new GoogleTokenError('aud');
  if (c.azp !== undefined && c.azp !== clientId) throw new GoogleTokenError('azp');
  const seconds = now / 1000;
  if (typeof c.exp !== 'number' || !Number.isFinite(c.exp) || seconds > c.exp + EXP_SKEW_S) throw new GoogleTokenError('exp');
  if (typeof c.iat !== 'number' || !Number.isFinite(c.iat) || c.iat > seconds + IAT_SKEW_S) throw new GoogleTokenError('iat');
  // For this attempt: the nonce the app made before it left for Google, which it sends again beside the token.
  if (typeof c.nonce !== 'string' || c.nonce !== nonce) throw new GoogleTokenError('nonce');
  if (typeof c.sub !== 'string' || !c.sub || c.sub.length > 255) throw new GoogleTokenError('sub');
  const email = normalEmail(c.email);
  if (!email) throw new GoogleTokenError('email');
  // An address Google has not verified (possible for some accounts made outside Gmail) proves nothing about its owner.
  if (c.email_verified !== true && c.email_verified !== 'true') {
    throw new CloudError(403, 'Google hasn’t confirmed that email address. Sign in with your email instead.', 'unverified_email');
  }
  return { sub: c.sub, email };
}
