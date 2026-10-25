// @vitest-environment jsdom
// The app with an account open to anyone: it learns whether the account is the owner's, shows someone else no Mac, Tailscale
// or Claude settings, and lets anyone delete their account. The server runs in process.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../../cloud/src/worker';
import { accountInfo, cloudSession, deleteAccount, isAccountOwner, requestCode, signIn } from '../../src/core/cloud';
import { ipadGroup } from '../../src/ui/settings/ipad';
import { claudeStatusLines, statusText } from '../../src/ui/settings/translation';
import { fetchClaudeStatus, resetClaudeStatus } from '../../src/translate/claude';
import { cloud } from './helpers';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); resetClaudeStatus(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); document.body.innerHTML = ''; });

/** The app's own sign-in against the server in process, as `email`. */
async function login(email: string, extra: Partial<Env> = {}) {
  const c = cloud({ OWNER_EMAILS: 'owner@example.com', ...extra } as Partial<Env>);
  let code = '';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (!req.url.startsWith('https://sync.test/')) throw new TypeError('offline');
    const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.text() }), c.env);
    if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
    return res;
  });
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  await requestCode(email);
  await signIn(email, code);
  return c;
}

/** Settings as the public site draws it (localhost is the Mac's own page). */
const groupFor = () => {
  vi.stubGlobal('location', { hostname: 'henryyhong.com', protocol: 'https:', origin: 'https://henryyhong.com', pathname: '/dushu/', search: '', hash: '#/settings' });
  const g = ipadGroup({});
  document.body.appendChild(g.el);
  return g;
};

describe('an account that is not the owner’s', () => {
  it('learns it is not the owner’s, and Settings shows the account and sync without the Mac', async () => {
    await login('friend@example.com');
    expect(await accountInfo()).toMatchObject({ email: 'friend@example.com', owner: false });
    expect(isAccountOwner()).toBe(false);
    const g = groupFor();
    expect(g.el.querySelector('h2, .set-group-title')?.textContent ?? g.el.textContent).toMatch(/Sync/);
    expect(g.el.textContent).not.toMatch(/Tailscale|Mac address|private link/i);
    expect(g.el.querySelector('.set-address')).toBeNull();
    expect(g.el.textContent).toMatch(/up to 200 MB/);
    g.dispose();
  });

  it('is told Claude is the owner’s alone', async () => {
    await login('friend@example.com', { ANTHROPIC_API_KEY: 'test-key' } as Partial<Env>);
    const status = await fetchClaudeStatus({ force: true });
    expect(status).toMatchObject({ ready: false, ownerOnly: true });
    expect(claudeStatusLines(status, false, true)).toEqual([{ label: 'Claude', value: expect.stringContaining('only for the owner'), kind: 'off' }]);
    expect(statusText('claude', 'no', status)).toEqual({ text: 'Only for the owner', kind: 'off' });
  });

  it('can delete the account: the server forgets it and this device is signed out', async () => {
    const c = await login('student@example.com');
    const token = cloudSession()!.token;
    await deleteAccount();
    expect(cloudSession()).toBeNull();
    expect((await worker.fetch(new Request('https://sync.test/me', { headers: { Authorization: `Bearer ${token}` } }), c.env)).status).toBe(401);
  });

  it('deletes from the account panel only after a second, plain confirmation', async () => {
    const c = await login('student@example.com');
    const token = cloudSession()!.token;
    const g = groupFor();
    const btn = (label: string) => [...g.el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
    btn('Delete account…').click();
    expect(btn('Delete my account').closest<HTMLElement>('.set-cloud-delete')!.hidden).toBe(false);
    btn('Keep it').click();
    expect(btn('Delete my account').closest<HTMLElement>('.set-cloud-delete')!.hidden).toBe(true);
    expect(cloudSession()).not.toBeNull();
    btn('Delete account…').click();
    btn('Delete my account').click();
    await vi.waitFor(() => expect(cloudSession()).toBeNull());
    expect(g.el.textContent).toMatch(/Your account is deleted/);
    expect((await worker.fetch(new Request('https://sync.test/me', { headers: { Authorization: `Bearer ${token}` } }), c.env)).status).toBe(401);
    g.dispose();
  });
});

describe('the owner’s account', () => {
  it('is remembered as the owner’s, and Settings keeps the Mac rows', async () => {
    await login('owner@example.com');
    await accountInfo();
    expect(isAccountOwner()).toBe(true);
    const g = groupFor();
    expect(g.el.textContent).toMatch(/Your Mac and iPad/);
    expect(g.el.querySelector('.set-address')).not.toBeNull();
    g.dispose();
  });
});
