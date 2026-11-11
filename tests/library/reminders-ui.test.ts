// @vitest-environment jsdom
// The Reminders row in Settings (ui/settings/reminders.ts): email reminders for an account with an email, notifications on this
// device when the server can send them, and why they can't be turned on where they can't. The sync server and the browser's
// push service are fakes here; the server's side is tested in tests/cloud.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { remindersRow } from '../../src/ui/settings/reminders';
import { accountPanel } from '../../src/ui/settings/account';
import { watchSignOut } from '../../src/core/reminders';
import { CLOUD_EVENT, cloudSession, forgetSession } from '../../src/core/cloud';

/** A P-256 public key as the server sends it: 65 bytes, 0x04 first, base64url. */
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
const KEY = btoa(String.fromCharCode(...KEY_BYTES)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

interface Call { method: string; path: string; body?: Record<string, unknown>; auth: string | null }
let calls: Call[];
let server: { reminders: { email: boolean; canEmail: boolean; devices: number } | null; key: string | null; pushFails: boolean };

/** The browser's side: a service worker whose push manager makes one subscription at a time. */
let sub: ReturnType<typeof makeSub> | null;
let permission: NotificationPermission;
const requestPermission = vi.fn(async () => { permission = answer; return answer; });
let answer: NotificationPermission;
const subscribe = vi.fn(async (o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => { sub = makeSub(o.applicationServerKey); return sub; });
function makeSub(key: Uint8Array) {
  const s = {
    endpoint: 'https://push.example.com/send/abc',
    options: { applicationServerKey: key.buffer.slice(0) as ArrayBuffer },
    toJSON: () => ({ endpoint: s.endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => { sub = null; return true; }),
  };
  return s;
}
const registration = { pushManager: { getSubscription: async () => sub, subscribe } };

function withPush(): void {
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { get permission() { return permission; }, requestPermission });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration), getRegistration: async () => registration } });
}

let root: HTMLElement;
const until = async (f: () => boolean) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); expect(f()).toBe(true); };
const signIn = (email = 'reader@example.com') => localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 'tok', email }));
const lines = () => [...root.querySelectorAll<HTMLElement>('.set-remind-line')];
const line = (name: string) => lines().find((l) => l.textContent === name)!;
const input = (name: string) => line(name).querySelector<HTMLInputElement>('input')!;
const note = () => root.querySelector('.set-remind-note')?.textContent ?? '';
const flip = (name: string) => { const i = input(name); i.checked = !i.checked; i.dispatchEvent(new Event('change')); };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  calls = [];
  server = { reminders: { email: true, canEmail: true, devices: 0 }, key: KEY, pushFails: false };
  sub = null;
  permission = 'default';
  answer = 'granted';
  requestPermission.mockClear();
  subscribe.mockClear();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ method, path: url.pathname, body, auth: new Headers(init?.headers).get('Authorization') });
    const r = server.reminders;
    if (url.pathname === '/me/reminders') {
      if (!r) return Response.json({ error: 'Not found.' }, { status: 404 });
      if (method === 'POST') r.email = body?.email === true;
      return Response.json(r);
    }
    if (url.pathname === '/push/key') return server.key ? Response.json({ key: server.key }) : Response.json({ error: 'No notifications here.' }, { status: 404 });
    if (url.pathname === '/me/push') {
      if (server.pushFails) return Response.json({ error: 'That subscription is not valid.' }, { status: 400 });
      return Response.json({ ok: true, devices: 1 });
    }
    if (url.pathname === '/me/push/remove') return Response.json({ ok: true, devices: 0 });
    if (url.pathname === '/auth/signout' || url.pathname === '/me/delete') return Response.json({ ok: true });
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }));
  root = document.createElement('div');
  document.body.appendChild(root);
});
afterEach(() => {
  root.remove();
  vi.unstubAllGlobals();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (navigator as { userAgent?: unknown }).userAgent;
});

function mount() {
  const row = remindersRow()!;
  root.appendChild(row.el);
  return row;
}

describe('the Reminders row', () => {
  it('waits for a sign-in, and stays hidden on a server from before reminders', async () => {
    const out = mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(out.el.hidden).toBe(true);
    expect(calls).toEqual([]);
    out.dispose();

    signIn();
    server.reminders = null;
    server.key = null;
    const old = mount();
    await until(() => calls.length >= 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(old.el.hidden).toBe(true);
    old.dispose();
  });

  it('turns email reminders off and on, and says why when the server says no', async () => {
    signIn();
    server.key = null; // a server that sends no notifications: email only
    const row = mount();
    await until(() => !row.el.hidden);
    expect(row.el.querySelector('.set-label')?.textContent).toBe('Reminders');
    expect(row.el.textContent).toContain('When words are ready to review and you haven’t been back for a few days. At most once a week.');
    expect(input('Email reminders').checked).toBe(true);
    expect(line('Notifications on this device').hidden).toBe(true);
    expect(note()).toBe('');
    expect(calls.every((c) => c.auth === 'Bearer tok')).toBe(true);

    flip('Email reminders');
    await until(() => calls.some((c) => c.method === 'POST' && c.path === '/me/reminders'));
    await until(() => !input('Email reminders').disabled);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ email: false });
    expect(input('Email reminders').checked).toBe(false);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    flip('Email reminders');
    await until(() => !!root.querySelector('.set-remind-result.set-bad'));
    expect(input('Email reminders').checked).toBe(false);
    expect(root.querySelector('.set-remind-result')?.textContent).toBe('Could not reach the sync server. Check this device’s internet connection.');
    row.dispose();
  });

  it('asks for permission only on the tap, then subscribes with the server’s key and tells the account; off ends it', async () => {
    withPush();
    signIn();
    const row = mount();
    await until(() => !row.el.hidden && !line('Notifications on this device').hidden);
    expect(input('Notifications on this device').checked).toBe(false);
    expect(input('Notifications on this device').disabled).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();

    flip('Notifications on this device');
    await until(() => calls.some((c) => c.method === 'POST' && c.path === '/me/push'));
    await until(() => !input('Notifications on this device').disabled);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][0].userVisibleOnly).toBe(true);
    expect([...subscribe.mock.calls[0][0].applicationServerKey]).toEqual([...KEY_BYTES]);
    expect(calls.find((c) => c.path === '/me/push')?.body).toEqual({ subscription: { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: 'p', auth: 'a' } } });
    expect(input('Notifications on this device').checked).toBe(true);

    const made = sub!;
    flip('Notifications on this device');
    await until(() => calls.some((c) => c.path === '/me/push/remove'));
    await until(() => !input('Notifications on this device').disabled);
    expect(made.unsubscribe).toHaveBeenCalled();
    expect(calls.find((c) => c.path === '/me/push/remove')?.body).toEqual({ endpoint: 'https://push.example.com/send/abc' });
    expect(input('Notifications on this device').checked).toBe(false);
    row.dispose();
  });

  it('shows this device’s subscription as on, and sends it to the account again', async () => {
    withPush();
    permission = 'granted';
    sub = makeSub(KEY_BYTES);
    signIn();
    const row = mount();
    await until(() => input('Notifications on this device')?.checked === true);
    await until(() => calls.some((c) => c.path === '/me/push'));
    expect(requestPermission).not.toHaveBeenCalled();
    row.dispose();
  });

  it('a subscription made with a key the server no longer has is off, ends here, leaves the account and is never sent again', async () => {
    withPush();
    permission = 'granted';
    const oldKey = Uint8Array.from(KEY_BYTES, (b, i) => (i === 0 ? 4 : 255 - b));
    sub = makeSub(oldKey);
    const made = sub;
    signIn();
    const row = mount();
    await until(() => !line('Notifications on this device').hidden);
    expect(input('Notifications on this device').checked).toBe(false);
    await until(() => calls.some((c) => c.path === '/me/push/remove'));
    expect(made.unsubscribe).toHaveBeenCalled();
    expect(calls.find((c) => c.path === '/me/push/remove')?.body).toEqual({ endpoint: 'https://push.example.com/send/abc' });
    expect(calls.some((c) => c.path === '/me/push')).toBe(false);

    // Turned on again: a new subscription with the server's key.
    flip('Notifications on this device');
    await until(() => calls.some((c) => c.path === '/me/push'));
    await until(() => !input('Notifications on this device').disabled);
    expect([...subscribe.mock.calls[0][0].applicationServerKey]).toEqual([...KEY_BYTES]);
    expect(input('Notifications on this device').checked).toBe(true);
    row.dispose();
  });

  it('drops the subscription again when the account does not take it', async () => {
    withPush();
    server.pushFails = true;
    signIn();
    const row = mount();
    await until(() => !line('Notifications on this device').hidden);
    flip('Notifications on this device');
    await until(() => !!root.querySelector('.set-remind-result.set-bad'));
    await until(() => !input('Notifications on this device').disabled);
    expect(root.querySelector('.set-remind-result')?.textContent).toBe('That subscription is not valid.');
    expect(sub).toBeNull();
    expect(input('Notifications on this device').checked).toBe(false);
    row.dispose();
  });

  it('says how to unblock notifications this site may not show', async () => {
    withPush();
    permission = 'denied';
    signIn();
    const row = mount();
    await until(() => note() !== '');
    expect(note()).toBe('Notifications are blocked for this site in your browser settings.');
    expect(input('Notifications on this device').disabled).toBe(true);
    // The disabled switch says why, to a screen reader too.
    const describedBy = input('Notifications on this device').getAttribute('aria-describedby');
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBe('Notifications are blocked for this site in your browser settings.');

    // Blocked on the tap itself: the switch goes back off and the same line says why.
    row.dispose();
    root.replaceChildren();
    permission = 'default';
    answer = 'denied';
    const again = mount();
    await until(() => !line('Notifications on this device').hidden);
    flip('Notifications on this device');
    await until(() => note() !== '');
    expect(note()).toBe('Notifications are blocked for this site in your browser settings.');
    expect(input('Notifications on this device').checked).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
    again.dispose();
  });

  it('tells an iPhone in Safari to add LinguPengu to the Home Screen first, and other browsers that they can’t', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
    signIn();
    const row = mount();
    await until(() => note() !== '');
    expect(note()).toBe('On iPhone and iPad, add LinguPengu to your Home Screen first: tap Share, then Add to Home Screen.');
    expect(line('Notifications on this device').hidden).toBe(false);
    expect(input('Notifications on this device').disabled).toBe(true);
    row.dispose();
    root.replaceChildren();

    delete (navigator as { userAgent?: unknown }).userAgent;
    const desktop = mount();
    await until(() => note() !== '');
    expect(note()).toBe('This browser can’t show notifications.');
    desktop.dispose();
  });

  it('a passkey account has notifications only, and no row at all where the server has none', async () => {
    server.reminders = { email: false, canEmail: false, devices: 0 };
    withPush();
    signIn('passkey:abc');
    const row = mount();
    await until(() => !row.el.hidden);
    expect(line('Email reminders').hidden).toBe(true);
    expect(line('Notifications on this device').hidden).toBe(false);
    row.dispose();
    root.replaceChildren();

    server.key = null;
    const none = mount();
    await until(() => calls.filter((c) => c.path === '/push/key').length === 2);
    await new Promise((r) => setTimeout(r, 20));
    expect(none.el.hidden).toBe(true);
    none.dispose();
  });
});

describe('signing out', () => {
  it('signs out at once and ends this device’s notifications, with the server told in the background', async () => {
    withPush();
    permission = 'granted';
    sub = makeSub(KEY_BYTES);
    const made = sub;
    signIn();
    const panel = accountPanel();
    root.appendChild(panel.el);
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Sign out')!.click();
    // Nothing is waited on: the device is signed out before the server answers.
    expect(cloudSession()).toBeNull();
    expect(panel.el.textContent).toContain('Signed out. Everything stays on this device');
    await until(() => calls.some((c) => c.path === '/auth/signout'));
    // The server's sign-out forgets the subscription that session added (tests/cloud/reminders.test.ts): no second request.
    expect(calls.map((c) => c.path)).toEqual(['/auth/signout']);
    expect(calls[0].auth).toBe('Bearer tok');
    await until(() => made.unsubscribe.mock.calls.length > 0);
    panel.dispose();
  });

  it('ends this device’s subscription however else the sign-in ends: the server’s 401, or a deleted account', async () => {
    withPush();
    permission = 'granted';
    const stop = watchSignOut();
    try {
      // The server says the sign-in is over (sync and accountInfo forget the session on a 401).
      sub = makeSub(KEY_BYTES);
      const first = sub;
      signIn();
      window.dispatchEvent(new Event(CLOUD_EVENT)); // still signed in: nothing ends
      await new Promise((r) => setTimeout(r, 20));
      expect(first.unsubscribe).not.toHaveBeenCalled();
      forgetSession();
      await until(() => first.unsubscribe.mock.calls.length === 1);

      // The account deleted from Settings.
      sub = makeSub(KEY_BYTES);
      const second = sub;
      signIn();
      const panel = accountPanel();
      root.appendChild(panel.el);
      [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete account…')!.click();
      [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete my account')!.click();
      await until(() => calls.some((c) => c.path === '/me/delete'));
      await until(() => second.unsubscribe.mock.calls.length === 1);
      expect(sub).toBeNull();
      panel.dispose();
    } finally { stop(); }
  });
});
