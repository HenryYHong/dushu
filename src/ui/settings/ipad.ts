import { h } from '../dom';
import { connectedMac, isMacOrigin } from '../../core/macBridge';
import { cloudSession, isAccountOwner } from '../../core/cloud';
import { group, row } from './controls';
import { macRows } from './mac';
import { syncRow } from './sync';
import { accountRow } from './account';
import { invitesRow } from './invites';

/**
 * The sync account, and the owner's Mac and iPad setup. Someone signed in who is not the owner (a friend, a student) sees only
 * the account, sync and how to install Dushu: the Mac, Tailscale and private link are the owner's alone. Signed out, the Mac
 * rows stay, so the owner can connect a new device (or follow the link the Mac's page gives) before signing in.
 */
export function ipadGroup(params: Record<string, string>): { el: HTMLElement; dispose(): void } {
  const account = accountRow();
  const sync = syncRow();
  if (account && !isMacOrigin() && !connectedMac() && cloudSession() && !isAccountOwner()) {
    const el = group('Sync', null,
      account.el,
      sync.el,
      row('Install', 'Open Dushu from that icon and it works offline.', h('span', null, 'In Safari: Share, then Add to Home Screen')),
      row('Books', 'Books you add are kept in your account, up to 200 MB in all your languages, and show up on every device you sign in on. Deleting one deletes it everywhere.', h('span', null, 'Import book, in the library')));
    return { el, dispose() { sync.dispose(); account.dispose(); } };
  }
  const mac = macRows(params);
  // The owner's invite links (shown once the server has said this account is the owner's).
  const invites = invitesRow();
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
  }).catch(() => { status.textContent = 'Turn on Tailscale on your Mac and run npm run ipad in Dushu to set up the private address.'; });
  const el = group('Your Mac and iPad', account
    ? 'Signed in, your books, words and Claude go with your account. Connecting a device to your Mac only adds its voices and local AI.'
    : 'Connect each device to your Mac once. Your words and reading places then sync through it.',
    account?.el ?? null,
    invites?.el ?? null,
    sync.el,
    ...mac.rows,
    row('Connect', 'Turn on Tailscale on your iPad with the same account as this Mac, then open the private link in Safari.', h('div', null, link, status)),
    row('Install', 'Open Dushu from that icon. Books and lookups work offline. The Mac’s AI and voices need the connection.', h('span', null, 'In Safari: Share, then Add to Home Screen')),
    row('Books', 'Books on your Mac reach every device by themselves. For other books, use Import book.', h('span', null, 'Your Mac keeps a daily copy of your synced words for two weeks.')));
  return { el, dispose() { mac.dispose(); sync.dispose(); account?.dispose(); invites?.dispose(); } };
}
