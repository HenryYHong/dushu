// @vitest-environment jsdom
// The top bar's account button (ui/signIn.ts) says what sync is doing once signed in, and only "Synced" has the green dot:
// offline, an unreachable server or a Sync switch turned off no longer read as synced. The account dialog's heading follows a
// Sign out made inside it. The session is made up and the sync server runs in process.
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setSyncEnabled, startSync, type Syncer } from '../../src/core/sync';
import { exchange, inLang, noCounts, type RecordTable, type StoredRecord } from '../../src/core/syncExchange';
import { openStore } from '../../src/store';
import { openSignIn, signInButton, syncLabel } from '../../src/ui/signIn';

beforeAll(() => {
  // jsdom has no showModal or close on <dialog>.
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});

let syncer: Syncer | null = null;
afterEach(async () => {
  await syncer?.stop();
  syncer = null;
  setSyncEnabled(true);
  localStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const signIn = (name?: string) =>
  localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't0ken', email: name ? 'passkey:abc123' : 'reader@example.com', ...(name ? { name } : {}) }));

/** A sync server in memory; `down` makes it unreachable. */
function server() {
  const data = new Map<string, StoredRecord>();
  const s = {
    down: false, version: 0,
    send(body: string): Promise<Response> {
      if (s.down) return Promise.reject(new TypeError('Failed to fetch'));
      const table: RecordTable = {
        epoch: 'hub-1',
        get version() { return s.version; },
        set version(v: number) { s.version = v; },
        get: (k) => data.get(k),
        put: (k, r) => { data.set(k, r); },
        changed: (since, also, lang) => [...data].filter(([k, r]) => inLang(k, lang) && (r.rev > since || also.has(k))).map(([key, r]) => ({ key, at: r.at, data: r.data })),
        counts: () => noCounts(),
      };
      return Promise.resolve(new Response(JSON.stringify(exchange(table, JSON.parse(body), Date.now()).reply), { status: 200, headers: { 'content-type': 'application/json' } }));
    },
  };
  return s;
}

const label = (btn: HTMLElement) => btn.querySelector('.app-signin-label')?.textContent;
const dot = (btn: HTMLElement) => btn.classList.contains('app-signin-on');

describe('the account button', () => {
  it('says Sign in while signed out', () => {
    const btn = signInButton();
    expect(label(btn)).toBe('Sign in');
    expect(dot(btn)).toBe(false);
  });

  it('follows the syncer: Offline while the server is out of reach, Sync off, and Synced with the dot only after a sync', async () => {
    signIn();
    const hub = server();
    hub.down = true;
    syncer = startSync(await openStore(`signin-${Math.random()}`), { send: (b) => hub.send(b), everyMs: 0 });
    const btn = signInButton();
    await syncer.run();
    expect(label(btn)).toBe('Offline');
    expect(dot(btn)).toBe(false);
    expect(btn.title).toMatch(/^Signed in as reader@example\.com\. Could not reach the sync server/);

    hub.down = false;
    await syncer.run();
    expect(label(btn)).toBe('Synced');
    expect(dot(btn)).toBe(true);
    expect(btn.getAttribute('aria-label')).toMatch(/^Account, Synced: signed in as reader@example\.com\. Up to date/);

    setSyncEnabled(false);
    await syncer.run();
    expect(label(btn)).toBe('Sync off');
    expect(dot(btn)).toBe(false);

    setSyncEnabled(true);
    await syncer.run();
    expect(label(btn)).toBe('Synced');

    // The browser says it went offline: the button says so at once, before the next sync finds out.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    expect(label(btn)).toBe('Offline');
    expect(dot(btn)).toBe(false);
  });

  it('keeps its label while a sync runs, and says Syncing only before the first one answers', () => {
    expect(syncLabel({ state: 'syncing', pending: 0 }, true, true, null)).toBe('Syncing…');
    expect(syncLabel({ state: 'syncing', pending: 0, lastOk: 1 }, true, true, 'Synced')).toBe('Synced');
    expect(syncLabel({ state: 'syncing', pending: 0 }, true, true, 'Offline')).toBe('Offline');
    expect(syncLabel({ state: 'error', pending: 3, lastOk: 1 }, true, true, 'Synced')).toBe('Not synced');
    expect(syncLabel({ state: 'outdated', pending: 3 }, true, true, null)).toBe('Not synced');
    expect(syncLabel({ state: 'idle', pending: 0, lastOk: 1 }, false, true, 'Synced')).toBe('Sync off');
  });
});

describe('the account dialog', () => {
  it('names the account, never "this email", and turns into Sign in after Sign out', async () => {
    signIn('Ana');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    openSignIn();
    const dlg = document.querySelector('dialog.signin-dialog')!;
    expect(dlg.querySelector('.signin-title')?.textContent).toBe('Your account');
    expect(dlg.querySelector('.signin-text')?.textContent).toBe('Your books, words and places are the same on every device signed in to this account.');
    const out = [...dlg.querySelectorAll('button')].find((b) => b.textContent === 'Sign out')!;
    out.click();
    await vi.waitFor(() => expect(dlg.querySelector('.signin-title')?.textContent).toBe('Sign in'));
    expect(dlg.querySelector('.signin-text')?.textContent).toMatch(/^Sign in and your books, words and places are the same on every device\./);
  });
});
