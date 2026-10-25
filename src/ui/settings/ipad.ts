import { h } from '../dom';
import { connectedMac, isMacOrigin } from '../../core/macBridge';
import { cloudSession, isAccountOwner } from '../../core/cloud';
import { group, row } from './controls';
import { macRows } from './mac';
import { syncRow } from './sync';
import { accountRow } from './account';

/**
 * The sync account, and the owner's Mac and iPad setup. Someone signed in who is not the owner (a friend, a student) sees only
 * the account, sync and how to install Dushu: the Mac, Tailscale and private link are the owner's alone. Signed out, the Mac
 * rows stay, so the owner can connect a new device (or follow the link the Mac's page gives) before signing in.
 */
export function ipadGroup(params: Record<string, string>): { el: HTMLElement; dispose(): void } {
  const account = accountRow();
  const sync = syncRow();
  if (account && !isMacOrigin() && !connectedMac() && cloudSession() && !isAccountOwner()) {
    const el = group('Sync', 'Sign in with your email on each device: your books, words, reading places and bookmarks then stay the same on all of them.',
      account.el,
      sync.el,
      row('Install', 'In Safari, tap Share → Add to Home Screen, then open Dushu from that icon. Your books and dictionary lookups work offline.', h('span', null, 'Safari → Share → Add to Home Screen')),
      row('Books', 'Books you add are kept in your account (up to 200 MB) and appear on each device you sign in on. Deleting a book removes it everywhere.', h('span', null, 'Library → Import book')));
    return { el, dispose() { sync.dispose(); account.dispose(); } };
  }
  const mac = macRows(params);
  const status = h('div.set-help', { role: 'status' }, 'Checking private connection…');
  const link = h('a.btn.btn-sm', { hidden: true }, 'Open private iPad link') as HTMLAnchorElement;
  if (!isMacOrigin()) status.textContent = 'This is the public copy of Dushu. The private address is shown when you open Dushu from your Mac.';
  else void fetch('/api/private-status', { cache: 'no-store', signal: AbortSignal.timeout(3000) }).then(async response => {
    if (!response.ok) throw new Error();
    const data = await response.json() as { url?: string };
    if (!data.url) throw new Error();
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.port !== '8443') throw new Error();
    link.href = `${url.href}?importLocalBooks#/`;
    link.hidden = false;
    status.textContent = `Private address: ${url.origin}. Only the Mac owner's Tailscale account can connect.`;
  }).catch(() => { status.textContent = 'Connect Tailscale on your Mac and run npm run ipad in Dushu to prepare private HTTPS access.'; });
  const el = group('Your Mac and iPad', account
    ? 'Sign in with your email on each device: your books, words, reading places, bookmarks and Claude then go with your account, with no Mac or Tailscale needed. Connecting a device to your Mac only adds the Mac’s voices and its local AI.'
    : 'Connect each device to your Mac once. Your words and reading places then sync through the Mac, and your Mac books are added by themselves.',
    account?.el ?? null,
    sync.el,
    ...mac.rows,
    row('Connect', 'Install/connect Tailscale on your iPad using the same account as this Mac. Open the private link in Safari. Keep this Mac awake for Premium voices and private AI.', h('div', null, link, status)),
    row('Install', 'In Safari, tap Share → Add to Home Screen, then open that icon. Downloaded books and dictionary lookups work offline; Mac AI and Mac voices need the connection.', h('span', null, 'Safari → Share → Add to Home Screen')),
    row('Books', 'Your own books on your Mac are added automatically the first time a device reaches it, and stay on the device after that. Library → Add books from Mac is the manual fallback. For other books use Import book → Files; your place in them syncs once the same file is on each device.', h('span', null, 'Your Mac keeps a daily copy of your synced words for two weeks.')));
  return { el, dispose() { mac.dispose(); sync.dispose(); account?.dispose(); } };
}
