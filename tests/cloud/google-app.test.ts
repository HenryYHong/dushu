// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://henryyhong.com/dushu/#/settings" }
// The app's side of signing in with Google (src/core/google.ts): the button only where Google can send the person back, the
// address it leaves for, and the way back: the token taken out of the address at once (replaceState, no history entry left
// with it), the state checked once, a cancel said nothing about, a trip that ended in another browser said so. Then the whole
// trip against the real Worker in process, with a test RSA key standing in for Google's (tests/cloud/google.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudSession } from '../../src/core/cloud';
import { GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI } from '../../src/core/cloudUrl';
import { GOOGLE_EMBEDDED, GOOGLE_TRIP_KEY, embeddedBrowser, finishGoogleReturn, googleAuthUrl, googleOffered, startGoogleSignIn, takeGoogleReturn } from '../../src/core/google';
import { accountPanel } from '../../src/ui/settings/account';
import { forgetGoogleKeys } from '../../cloud/src/google';
import { fakeGoogle } from './googleFake';
import { cloud, signedIn } from './helpers';

const LOST = 'Google sign-in didn’t finish here. Try again, or sign in with your email.';

/** Leaves for Google as the button does, and gives back the address it went to (nothing navigates). */
function leave(): URL {
  let to = '';
  startGoogleSignIn((url) => { to = url; });
  return new URL(to);
}
/** Comes back to the app's address with `fragment`, as Google sends it (the same page, so jsdom keeps it). */
const arrive = (fragment: string) => history.replaceState(null, '', `${GOOGLE_REDIRECT_URI}${fragment}`);

beforeEach(() => { localStorage.clear(); history.replaceState(null, '', '/dushu/#/settings'); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the Continue with Google button', () => {
  it('shows only on the address Google sends sign-ins back to', () => {
    expect(googleOffered()).toBe(true);
    expect(googleOffered({ origin: 'https://henryyhong.com', pathname: '/dushu/' })).toBe(true);
    expect(googleOffered({ origin: 'http://localhost:5195', pathname: '/dushu/' })).toBe(false);
    expect(googleOffered({ origin: 'http://127.0.0.1:4173', pathname: '/' })).toBe(false);
    expect(googleOffered({ origin: 'https://my-mac.tail1234.ts.net:8443', pathname: '/' })).toBe(false);
    expect(googleOffered({ origin: 'https://henryyhong.com', pathname: '/dushu/index.html' })).toBe(false);
    expect(googleOffered({ origin: 'https://henryyhong.com', pathname: '/' })).toBe(false);
    expect(googleOffered({ origin: 'http://henryyhong.com', pathname: '/dushu/' })).toBe(false);
  });

  it('comes first in the sign-in panel there, white with Google’s G, and leaves for Google when tapped', () => {
    const panel = accountPanel();
    document.body.appendChild(panel.el);
    try {
      const rows = [...panel.el.querySelectorAll<HTMLElement>('.set-cloud-row')].filter((r) => !r.hidden);
      const google = rows[0].querySelector<HTMLButtonElement>('.set-cloud-google')!;
      expect(google.textContent).toBe('Continue with Google');
      expect(google.querySelectorAll('svg path').length).toBe(4);
      expect(google.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
      // Google's own button stands out; email is the plain way in after it.
      expect([...panel.el.querySelectorAll('button')].find((b) => b.textContent === 'Email me a code')!.classList.contains('btn-primary')).toBe(false);
      const assign = vi.fn();
      vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, hash: '#/settings', assign } as unknown as Location);
      google.click();
      expect(assign).toHaveBeenCalledTimes(1);
      expect(new URL(assign.mock.calls[0][0]).origin).toBe('https://accounts.google.com');
      expect(google.disabled).toBe(true);
      // Back from Google's page, shown from the back-forward cache as it was left: ready for another tap at once.
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      expect(google.disabled).toBe(false);
    } finally { panel.dispose(); panel.el.remove(); }
  });
});

// Real user agents. Google refuses its sign-in in an app's own WebView (Error 403: disallowed_useragent), which is where a link
// shared on Instagram, Facebook or TikTok opens; Safari's and Chrome's views inside an app, every real browser and the Home
// Screen app are fine.
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36';
const REFUSED: Record<string, string> = {
  'Instagram on an iPhone': `${IPHONE} Mobile/15E148 Instagram 334.0.4.32.98 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 609434196)`,
  'Facebook on an iPhone': `${IPHONE} Mobile/15E148 [FBAN/FBIOS;FBAV/468.0.0.45.108;FBBV/650000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]`,
  'Facebook on Android': `${ANDROID_WV} [FB_IAB/FB4A;FBAV/477.0.0.49.82;]`,
  'TikTok on an iPhone': `${IPHONE} Mobile/15E148 musical_ly_35.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US WKWebView/1 BytedanceWebview/d8a21c6`,
  'LINE on an iPhone': `${IPHONE} Mobile/15E148 Safari Line/14.10.0`,
  'WeChat on an iPhone': `${IPHONE} Mobile/15E148 MicroMessenger/8.0.49(0x18003130) NetType/WIFI Language/zh_CN`,
  'any Android app’s WebView': ANDROID_WV,
  'any iPhone app’s WebView': `${IPHONE} Mobile/15E148`,
};
const FINE: Record<string, { userAgent: string; standalone?: boolean }> = {
  'Safari on an iPhone': { userAgent: `${IPHONE} Version/17.5 Mobile/15E148 Safari/604.1` },
  'the Home Screen app on an iPhone': { userAgent: `${IPHONE} Mobile/15E148`, standalone: true },
  'Chrome on an iPhone': { userAgent: `${IPHONE} CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1` },
  'Firefox on an iPhone': { userAgent: `${IPHONE} FxiOS/128.0 Mobile/15E148 Safari/605.1.15` },
  'the Google app on an iPhone': { userAgent: `${IPHONE} GSA/330.0.665236494 Mobile/15E148 Safari/604.1` },
  'Safari on an iPad': { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15' },
  'Chrome on Android (and its installed app)': { userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36' },
  'Samsung Internet': { userAgent: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36' },
  'Chrome on a Mac': { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36' },
  'Firefox on Windows': { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0' },
  'Edge on Windows': { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0' },
};

describe('in another app’s browser', () => {
  it('knows the WebViews Google refuses, and lets every real browser and the Home Screen app go', () => {
    for (const [where, userAgent] of Object.entries(REFUSED)) expect(embeddedBrowser({ userAgent }), where).toBe(true);
    for (const [where, nav] of Object.entries(FINE)) expect(embeddedBrowser(nav), where).toBe(false);
    expect(embeddedBrowser({})).toBe(false);
  });

  it('says where Google sign-in works instead of leaving for Google’s error page', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(REFUSED['Instagram on an iPhone']);
    const assign = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, hash: '#/settings', assign } as unknown as Location);
    const panel = accountPanel();
    document.body.appendChild(panel.el);
    try {
      const google = panel.el.querySelector<HTMLButtonElement>('.set-cloud-google')!;
      expect(google.closest('[hidden]')).toBeNull();
      google.click();
      expect(assign).not.toHaveBeenCalled();
      expect(localStorage.getItem(GOOGLE_TRIP_KEY)).toBeNull();
      expect(panel.el.querySelector('.set-cloud-result')!.textContent).toBe(GOOGLE_EMBEDDED());
      expect(GOOGLE_EMBEDDED()).toMatch(/Safari or Chrome/);
      expect(google.disabled).toBe(false);
    } finally { panel.dispose(); panel.el.remove(); }
  });
});

describe('leaving for Google', () => {
  it('asks for an ID token for this app, back to the one redirect URI, with a fresh state and nonce kept for the way back', () => {
    history.replaceState(null, '', '/dushu/#/read/b123?ch=2');
    const url = leave();
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = Object.fromEntries(url.searchParams);
    expect(q).toEqual({
      client_id: GOOGLE_CLIENT_ID, redirect_uri: 'https://henryyhong.com/dushu/', response_type: 'id_token', scope: 'openid email',
      nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), prompt: 'select_account',
    });
    const trip = JSON.parse(localStorage.getItem(GOOGLE_TRIP_KEY)!);
    expect(trip).toEqual({ state: q.state, nonce: q.nonce, at: expect.any(Number), back: '#/read/b123?ch=2' });
    expect(Date.now() - trip.at).toBeLessThan(5000);
    // Each trip its own.
    const again = Object.fromEntries(leave().searchParams);
    expect(again.state).not.toBe(q.state);
    expect(again.nonce).not.toBe(q.nonce);
    expect(googleAuthUrl('s', 'n')).toContain('redirect_uri=https%3A%2F%2Fhenryyhong.com%2Fdushu%2F');
  });

  it('says so, and does not leave, when this browser will not keep the trip', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const go = vi.fn();
    expect(() => startGoogleSignIn(go)).toThrow(/would not keep the sign-in/);
    expect(go).not.toHaveBeenCalled();
  });
});

describe('coming back from Google', () => {
  it('takes the token out of the address before anything reads it, back to the screen it left from, and checks the state once', () => {
    const q = Object.fromEntries(leave().searchParams);
    const entries = history.length;
    const replace = vi.spyOn(history, 'replaceState');
    arrive(`#state=${q.state}&id_token=aaa.bbb.ccc&authuser=0&prompt=consent`);
    replace.mockClear();
    const r = takeGoogleReturn();
    expect(r).toEqual({ kind: 'token', idToken: 'aaa.bbb.ccc', nonce: q.nonce });
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][2]).toBe('#/settings');
    expect(location.href).toBe('https://henryyhong.com/dushu/#/settings');
    expect(history.length).toBe(entries);
    expect(localStorage.getItem(GOOGLE_TRIP_KEY)).toBeNull();
    // Nothing more to take; and the same answer again (a reload of a saved address) finds its trip used up.
    expect(takeGoogleReturn()).toBeNull();
    arrive(`#state=${q.state}&id_token=aaa.bbb.ccc`);
    expect(takeGoogleReturn()).toEqual({ kind: 'lost' });
    expect(location.hash).toBe('#/');
  });

  it('says nothing of a cancel, and says a trip that ended in another browser (or lost its state, or took too long) did not finish here', async () => {
    const toasts: string[] = [];
    const toast = (m: string) => toasts.push(m);
    let q = Object.fromEntries(leave().searchParams);
    arrive(`#error=access_denied&state=${q.state}`);
    const cancel = takeGoogleReturn()!;
    expect(cancel).toEqual({ kind: 'cancel' });
    expect(location.hash).toBe('#/settings');
    expect(await finishGoogleReturn(cancel, toast)).toBeNull();
    expect(toasts).toEqual([]);

    // A state that is not the one kept.
    q = Object.fromEntries(leave().searchParams);
    arrive(`#state=${q.state}x&id_token=aaa.bbb.ccc`);
    expect(takeGoogleReturn()).toEqual({ kind: 'lost' });
    // No trip kept here at all (it started in another browser, or this one lost it).
    arrive('#state=abcdefghijklmnopqrstuvwxyz&id_token=aaa.bbb.ccc');
    expect(takeGoogleReturn()).toEqual({ kind: 'lost' });
    expect(location.hash).toBe('#/');
    // Kept too long.
    q = Object.fromEntries(leave().searchParams);
    arrive(`#state=${q.state}&id_token=aaa.bbb.ccc`);
    expect(takeGoogleReturn(window, Date.now() + 16 * 60_000)).toEqual({ kind: 'lost' });
    // An error other than a cancel.
    q = Object.fromEntries(leave().searchParams);
    arrive(`#error=server_error&state=${q.state}`);
    const failed = takeGoogleReturn()!;
    expect(failed).toEqual({ kind: 'lost' });
    expect(await finishGoogleReturn(failed, toast)).toBeNull();
    expect(toasts).toEqual([LOST]);
    expect(cloudSession()).toBeNull();
  });

  it('says nothing, and changes nothing, on a device that is signed in already (Back to Google’s page after signing in)', async () => {
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 'acct.secret', email: 'reader@example.com' }));
    const post = vi.fn();
    vi.stubGlobal('fetch', post);
    const toasts: string[] = [];
    // The answer to a trip already used: Google's page from the history, an account picked again.
    arrive(`#state=${'s'.repeat(43)}&id_token=aaa.bbb.ccc`);
    const lost = takeGoogleReturn()!;
    expect(lost).toEqual({ kind: 'lost' });
    expect(location.href).toBe('https://henryyhong.com/dushu/#/');
    expect(await finishGoogleReturn(lost, (m) => toasts.push(m))).toMatchObject({ token: 'acct.secret' });
    // A good token too: this device is not moved to another account behind the reader's back.
    expect(await finishGoogleReturn({ kind: 'token', idToken: 'aaa.bbb.ccc', nonce: 'n'.repeat(43) }, (m) => toasts.push(m))).toMatchObject({ token: 'acct.secret' });
    expect(toasts).toEqual([]);
    expect(post).not.toHaveBeenCalled();
    expect(cloudSession()).toMatchObject({ token: 'acct.secret' });
  });

  it('puts back only a screen of the app, never another address', () => {
    for (const back of ['https://evil.example/', '//evil.example/x', 'javascript:alert(1)', '#/x y', 42]) {
      localStorage.setItem(GOOGLE_TRIP_KEY, JSON.stringify({ state: 's'.repeat(43), nonce: 'n'.repeat(43), at: Date.now(), back }));
      arrive(`#state=${'s'.repeat(43)}&id_token=aaa.bbb.ccc`);
      expect(takeGoogleReturn()).toMatchObject({ kind: 'token' });
      expect(location.href).toBe('https://henryyhong.com/dushu/#/');
    }
  });

  it('leaves an ordinary address alone', () => {
    history.replaceState(null, '', '/dushu/#/vocab');
    expect(takeGoogleReturn()).toBeNull();
    history.replaceState(null, '', '/dushu/');
    expect(takeGoogleReturn()).toBeNull();
    expect(location.href).toBe('https://henryyhong.com/dushu/');
  });
});

describe('the whole trip, against the sync server', () => {
  beforeEach(() => forgetGoogleKeys());

  it('signs this device in to the account the email’s code reaches, once, and says so like a code sign-in', async () => {
    const google = await fakeGoogle();
    const c = cloud({ GOOGLE_CLIENT_ID, googleFetch: google.fetch });
    const byCode = await signedIn(c, 'reader@example.com');
    const sent: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      sent.push(url.pathname);
      return c.call(url.pathname + url.search, { method: req.method, headers: Object.fromEntries(req.headers), body: req.method === 'GET' ? undefined : await req.text() });
    });
    localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
    const announced = vi.fn();
    window.addEventListener('dushu:cloud', announced);
    try {
      const url = leave();
      // Between the two, on Google's page: the person picks their account, and Google signs a token with the trip's nonce.
      const fragment = await google.answer(url, 'reader@example.com');
      arrive(fragment);
      const r = takeGoogleReturn()!;
      expect(location.hash).toBe('#/settings');
      const toasts: string[] = [];
      const s = await finishGoogleReturn(r, (m) => toasts.push(m));
      expect(s).toMatchObject({ email: 'reader@example.com', created: expect.any(String) });
      expect(cloudSession()).toMatchObject({ email: 'reader@example.com' });
      expect(cloudSession()!.token.split('.')[0]).toBe(byCode.split('.')[0]);
      expect(toasts).toEqual(['Signed in. Your books’ places, words and bookmarks are on their way.']);
      expect(announced).toHaveBeenCalled();
      expect(sent).toEqual(['/auth/google']);

      // The same token again (an address saved with it, replayed): refused by the server, said in a toast.
      localStorage.removeItem('dushu.cloud.v1');
      const again = await finishGoogleReturn(r, (m) => toasts.push(m));
      expect(again).toBeNull();
      expect(toasts.at(-1)).toBe('That Google sign-in was already used. Try again.');
      expect(cloudSession()).toBeNull();
    } finally { window.removeEventListener('dushu:cloud', announced); }
  });
});
