// @vitest-environment jsdom
// The screens around passkeys: the invite link's Join screen, the sign-in panel (a passkey first, email for the owner), and
// the owner's invite links in Settings. The passkey ceremony itself is tested against the server in tests/cloud/passkeys.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../../src/types';

const pk = vi.hoisted(() => ({
  supported: true,
  inviteLabel: vi.fn(),
  joinWithPasskey: vi.fn(),
  signInWithPasskey: vi.fn(),
  addPasskey: vi.fn(),
  listInvites: vi.fn(),
  createInvite: vi.fn(),
  revokeInvite: vi.fn(),
}));
vi.mock('../../src/core/passkey', () => ({
  passkeysSupported: () => pk.supported,
  inviteLabel: pk.inviteLabel,
  joinWithPasskey: pk.joinWithPasskey,
  signInWithPasskey: pk.signInWithPasskey,
  addPasskey: pk.addPasskey,
  passkeyHere: () => false,
  listInvites: pk.listInvites,
  createInvite: pk.createInvite,
  revokeInvite: pk.revokeInvite,
  inviteLink: (token: string) => `https://henryyhong.com/dushu/#/join/${token}`,
}));

import { mount as mountJoin } from '../../src/ui/join';
import { accountPanel } from '../../src/ui/settings/account';
import { invitesRow } from '../../src/ui/settings/invites';

let root: HTMLElement;
let toasts: string[];
const ctx = () => ({ toast: (m: string) => toasts.push(m) }) as unknown as AppContext;
const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 5)); expect(f()).toBe(true); };
const text = () => root.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  pk.supported = true;
  for (const f of Object.values(pk)) if (typeof f === 'function') (f as ReturnType<typeof vi.fn>).mockReset();
  root = document.createElement('div');
  document.body.appendChild(root);
  toasts = [];
});
afterEach(() => { root.remove(); });

describe('the join screen', () => {
  it('names the invite, makes the account with a passkey, and opens the library', async () => {
    pk.inviteLabel.mockResolvedValue('Mom’s class');
    pk.joinWithPasskey.mockResolvedValue({ token: 't', email: 'passkey:x', name: 'Amy' });
    mountJoin(root, { invite: 'abc' }, ctx());
    await until(() => text().includes('You’re invited to Dushu (Mom’s class)'));
    const name = root.querySelector<HTMLInputElement>('.join-name')!;
    root.querySelector<HTMLFormElement>('.join-form')!.requestSubmit();
    await until(() => text().includes('Type your name.'));
    expect(pk.joinWithPasskey).not.toHaveBeenCalled();
    name.value = 'Amy';
    root.querySelector<HTMLFormElement>('.join-form')!.requestSubmit();
    await until(() => text().includes('You’re in, Amy.'));
    expect(pk.joinWithPasskey).toHaveBeenCalledWith('abc', 'Amy');
    expect(root.querySelector('.join-done a')?.getAttribute('href')).toBe('#/');
    expect(toasts).toEqual(['Signed in with your passkey.']);
  });

  it('says so when the invite is no good, the browser has no passkeys, or this device is already signed in', async () => {
    pk.inviteLabel.mockRejectedValue(new Error('This invite link is not valid anymore. Ask for a new one.'));
    mountJoin(root, { invite: 'old' }, ctx());
    await until(() => text().includes('not valid anymore'));
    expect(root.querySelector<HTMLElement>('.join-form')!.hidden).toBe(true);

    root.replaceChildren();
    pk.supported = false;
    mountJoin(root, { invite: 'abc' }, ctx());
    expect(text()).toContain('can’t make passkeys');

    root.replaceChildren();
    pk.supported = true;
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't', email: 'passkey:x', name: 'Amy' }));
    mountJoin(root, { invite: 'abc' }, ctx());
    expect(text()).toContain('You’re already signed in as Amy.');
    expect(pk.inviteLabel).toHaveBeenCalledTimes(1); // only the first screen asked
  });
});

describe('the sign-in panel', () => {
  it('offers a passkey first, with email as the other way in, and a passkey for this device once signed in', async () => {
    const panel = accountPanel();
    root.appendChild(panel.el);
    const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!;
    expect(button('Sign in with a passkey').classList.contains('btn-primary')).toBe(true);
    expect(button('Email me a code').classList.contains('btn-primary')).toBe(false);
    expect(text()).toContain('New here? Open the invite link you were sent');

    pk.signInWithPasskey.mockImplementation(async () => {
      localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't', email: 'passkey:x', name: 'Amy' }));
      return { token: 't', email: 'passkey:x', name: 'Amy' };
    });
    button('Sign in with a passkey').click();
    await until(() => text().includes('Signed in as Amy.'));
    expect(button('Sign in with a passkey').closest('[hidden]')).not.toBeNull();
    expect(button('Add a passkey on this device').hidden).toBe(false);
    panel.dispose();
  });

  it('keeps email first where the browser has no passkeys', () => {
    pk.supported = false;
    const panel = accountPanel();
    root.appendChild(panel.el);
    expect([...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Email me a code')!.classList.contains('btn-primary')).toBe(true);
    expect([...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Sign in with a passkey')!.hidden).toBe(true);
    panel.dispose();
  });
});

describe('the owner’s invite links', () => {
  it('shows only for the owner, lists the links with how many joined, and makes a new one', async () => {
    const row = invitesRow()!;
    root.appendChild(row.el);
    expect(row.el.hidden).toBe(true);
    expect(pk.listInvites).not.toHaveBeenCalled();
    row.dispose();
    root.replaceChildren();

    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't', email: 'owner@example.com' }));
    localStorage.setItem('dushu.cloud.owner.v1', 'owner@example.com');
    pk.listInvites.mockResolvedValue([{ token: 'tok1', label: 'Mom’s class', max: 30, uses: 4, created: 1 }]);
    pk.createInvite.mockResolvedValue({ token: 'tok2', label: 'Friends', max: 30, uses: 0, created: 2 });
    const owner = invitesRow()!;
    root.appendChild(owner.el);
    await until(() => text().includes('4 of 30 joined'));
    expect(owner.el.hidden).toBe(false);
    expect(root.querySelector<HTMLInputElement>('.set-link')!.value).toBe('https://henryyhong.com/dushu/#/join/tok1');
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Make a link')!.click();
    await until(() => text().includes('Made a link for Friends.'));
    expect(pk.createInvite).toHaveBeenCalledWith('Friends', 30);
    owner.dispose();
  });
});
