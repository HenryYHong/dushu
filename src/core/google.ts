// Sign in with Google, in the same window. The app goes to Google's sign-in page itself (location.assign) and Google sends the
// person back to the app's address with an ID token in the fragment (OpenID Connect's implicit flow: response_type=id_token,
// no client secret, no Google script). Not a popup: window.open and popups break in an iPhone's Home Screen app, while a
// navigation to Google and back works there, on Android (installed or not) and in every desktop browser.
//
// The trip: startGoogleSignIn keeps { state, nonce, at, back } in localStorage (not sessionStorage, which some browsers and
// Home Screen apps lose on the way) and leaves. Coming back, main.ts calls takeGoogleReturn before anything reads the address:
// it takes the token out of the fragment and puts the screen the person left from in its place (history.replaceState, so the
// token never stays in the address bar, the history or a bookmark), and checks the state against the one kept (once).
// finishGoogleReturn then sends the token and the nonce to the sync server (cloud/src/google.ts checks the token itself) and
// keeps the session it answers, exactly as an emailed code's sign-in.
import { tt } from '../i18n';
import { cloudBase, cloudSession, keepSession, post, type CloudSession } from './cloud';
import { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } from './cloudUrl';

/** The trip under way: its state and nonce, when it left, and the screen to come back to. */
export const GOOGLE_TRIP_KEY = 'dushu.google.v1';
/** A trip older than this is not taken back (someone who left the sign-in page open for an hour starts again). */
export const GOOGLE_TRIP_MS = 15 * 60_000;
export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

/** Said when the trip came back to a browser that did not start it, or lost what it kept (or an error other than a cancel). */
export const GOOGLE_LOST = (): string => tt('Google sign-in didn’t finish here. Try again, or sign in with your email.');

interface Trip { state: string; nonce: string; at: number; back: string }

/** What came back from Google: a token to send, a cancel (said nothing about), or a trip that cannot be finished here. */
export type GoogleReturn = { kind: 'token'; idToken: string; nonce: string } | { kind: 'cancel' } | { kind: 'lost' };

/**
 * Whether this page offers Google: only the address Google sends sign-ins back to (GOOGLE_REDIRECT_URI, its origin and path
 * exactly), with a sync server. localhost and the owner's private copies never show a button whose trip could not come back.
 */
export function googleOffered(loc: Pick<Location, 'origin' | 'pathname'> | undefined = globalThis.location): boolean {
  if (!GOOGLE_CLIENT_ID || !loc || !cloudBase()) return false;
  try { return `${loc.origin}${loc.pathname}` === GOOGLE_REDIRECT_URI; } catch { return false; }
}

/**
 * Another app's built-in browser, where Google refuses to sign anyone in ("Error 403: disallowed_useragent"): Google allows its
 * sign-in only in a real browser, or in the Safari or Chrome view an app opens over itself, never in a WebView the app draws
 * itself. A link to LinguPengu shared on Instagram, Facebook, TikTok, LINE, WeChat, Snapchat, LinkedIn, Pinterest or KakaoTalk
 * opens in such a view first, and marketing sends people exactly there; going to Google from it ends on Google's error page
 * with no way back. The button says so instead (settings/account.ts), and the email code still works there.
 * Told by the user agent, as Google itself tells: these apps name themselves in it; any Android app's WebView says '; wv)';
 * and on an iPhone or iPad, Safari, Safari's view inside an app, Chrome, Firefox and Edge all end with 'Safari/', while a
 * WebView an app draws does not. The Home Screen app (navigator.standalone) is the app's own window, never refused here.
 */
export function embeddedBrowser(nav: { userAgent?: string; standalone?: boolean } | undefined = globalThis.navigator): boolean {
  const ua = nav?.userAgent ?? '';
  if (!ua) return false;
  if (/FBAN|FBAV|FB_IAB|FBIOS|Instagram|musical_ly|BytedanceWebview|TikTok|MicroMessenger|Snapchat|LinkedInApp|Pinterest|KAKAOTALK|\bLine\/\d/.test(ua)) return true;
  if (/\bAndroid\b/.test(ua) && /; wv\)/.test(ua)) return true;
  return /\b(iPhone|iPad|iPod)\b/.test(ua) && !/\bSafari\//.test(ua) && nav?.standalone !== true;
}

/** Said, instead of leaving, in another app's built-in browser (embeddedBrowser). */
export const GOOGLE_EMBEDDED = (): string =>
  tt('Google sign-in doesn’t work inside this app’s browser. Open LinguPengu in Safari or Chrome, or sign in with your email.');

/** 32 random bytes in base64url: a state or a nonce. */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Google's sign-in address for this trip: an ID token (with the email) for this app, back to the one redirect URI. */
export function googleAuthUrl(state: string, nonce: string): string {
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'id_token',
    scope: 'openid email',
    nonce,
    state,
    // The account picker every time, so someone with two Google accounts (or on a shared computer) picks the one they mean.
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH}?${q}`;
}

/** An internal screen ('#/…') to come back to, or the library. Never a URL: only a fragment can be put back. */
const internalRoute = (v: unknown): string =>
  (typeof v === 'string' && v.length <= 2000 && /^#\/[^\s\\]*$/.test(v) ? v : '#/');

/**
 * Leaves for Google's sign-in page. Throws when this browser will not keep the trip (site data blocked): it could never be
 * finished. `go` is the navigation (tests pass their own).
 */
export function startGoogleSignIn(go: (url: string) => void = (url) => location.assign(url)): void {
  const state = randomToken();
  const nonce = randomToken();
  const trip: Trip = { state, nonce, at: Date.now(), back: internalRoute(globalThis.location?.hash) };
  try {
    localStorage.setItem(GOOGLE_TRIP_KEY, JSON.stringify(trip));
    if (localStorage.getItem(GOOGLE_TRIP_KEY) === null) throw new Error('not kept');
  } catch {
    throw new Error(tt('This browser would not keep the sign-in. Allow site data for LinguPengu and try again.'));
  }
  go(googleAuthUrl(state, nonce));
}

/**
 * Takes a sign-in coming back from Google out of the address, before anything else reads it: '#id_token=…&state=…' (or
 * '#error=…&state=…') is replaced by the screen the person left from, in place (replaceState), and the trip kept for it is
 * used up whatever came back. Null when the address is not one (an ordinary '#/…' route, or none).
 */
export function takeGoogleReturn(win: { location: Location; history: History; localStorage?: Storage } = window, now = Date.now()): GoogleReturn | null {
  let hash: string;
  try { hash = win.location.hash; } catch { return null; }
  if (!hash || hash.startsWith('#/')) return null;
  const params = new URLSearchParams(hash.slice(1));
  if (!params.has('id_token') && !params.has('error') && !params.has('state')) return null;
  let trip: Partial<Trip> | null = null;
  try {
    trip = JSON.parse(win.localStorage?.getItem(GOOGLE_TRIP_KEY) ?? 'null') as Partial<Trip> | null;
    win.localStorage?.removeItem(GOOGLE_TRIP_KEY);
  } catch { /* nothing kept, or storage blocked: the trip is lost */ }
  const back = internalRoute(trip?.back);
  // The token leaves the address now. replaceState keeps the same page (no reload) and leaves no entry with the token behind;
  // location.replace is the fallback, which also replaces the entry.
  try { win.history.replaceState(win.history.state, '', back); } catch { try { win.location.replace(back); } catch { /* nothing more to try */ } }

  // A cancel on Google's page says nothing, whatever the state: the person chose to come back.
  if (params.get('error') === 'access_denied') return { kind: 'cancel' };
  const state = params.get('state') ?? '';
  const good = !!trip && typeof trip.state === 'string' && trip.state.length >= 16 && trip.state === state
    && typeof trip.nonce === 'string' && trip.nonce.length >= 16
    && typeof trip.at === 'number' && now - trip.at >= 0 && now - trip.at <= GOOGLE_TRIP_MS;
  const idToken = params.get('id_token') ?? '';
  if (!good || params.has('error') || !idToken) return { kind: 'lost' };
  return { kind: 'token', idToken, nonce: trip!.nonce! };
}

/**
 * Finishes what came back (takeGoogleReturn): a token is sent to the sync server, and its answer kept like an emailed code's
 * (keepSession: this device is signed in, sync starts, the account's books come). Every outcome but a cancel is said in a toast.
 *
 * Except on a device that is signed in already, where nothing is done or said. That is someone who pressed Back after signing
 * in: Google's page is the entry before the app's in the history, and picking the account there again sends back an answer
 * whose trip is used up. Telling them sign-in "didn't finish" while the top bar says Synced would be wrong, and a fresh token
 * (a trip given up, then a sign-in another way, then Forward to Google) must not switch the device to another account unasked.
 */
export async function finishGoogleReturn(r: GoogleReturn, toast: (message: string, ms?: number) => void): Promise<CloudSession | null> {
  if (r.kind === 'cancel') return null;
  const already = cloudSession();
  if (already) return already;
  if (r.kind === 'lost') { toast(GOOGLE_LOST(), 9000); return null; }
  try {
    const s = await keepSession(await post('/auth/google', { idToken: r.idToken, nonce: r.nonce }));
    toast(tt('Signed in. Your books’ places, words and bookmarks are on their way.'), 5000);
    return s;
  } catch (e) {
    toast(e instanceof Error && e.message ? e.message : GOOGLE_LOST(), 9000);
    return null;
  }
}
