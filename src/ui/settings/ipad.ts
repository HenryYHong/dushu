import { h } from '../dom';
import { connectedMac, isMacOrigin } from '../../core/macBridge';
import { cloudSession, isAccountOwner } from '../../core/cloud';
import { group, more, row } from './controls';
import { macRows } from './mac';
import { syncRow } from './sync';
import { accountRow } from './account';
import { invitesRow } from './invites';
import { remindersRow } from './reminders';
import { tt } from '../../i18n';

/**
 * The sync account, and the owner's Mac and iPad setup. Off the Mac's own page, with no Mac connected and not the owner's
 * account, it is "Sync": the account, sync and how to install LinguPengu. The Mac, Tailscale and private link are the owner's.
 * Someone signed in to their own account (a friend, a student) never sees them. Signed out, they wait folded under "Use your
 * own Mac", so the owner can connect a new device before signing in; a link from the Mac's page (?connect) opens them.
 */
export function ipadGroup(params: Record<string, string>, open = false): { el: HTMLElement; dispose(): void } {
  // How to install, where books go and the owner's Mac setup wait under "More settings"; a link from the Mac (?connect) opens it.
  const unfold = open || params.connect !== undefined;
  const account = accountRow();
  // Under the account, while signed in: review reminders by email or notification.
  const reminders = remindersRow();
  const sync = syncRow();
  if (!isMacOrigin() && !connectedMac() && !isAccountOwner()) {
    const own = cloudSession() ? null : macRows(params);
    const el = group(tt('Sync'), null,
      account?.el ?? null,
      reminders?.el ?? null,
      sync.el,
      more('sync', [
        row(tt('Install'), tt('Added to the Home Screen, LinguPengu opens like an app and works offline.'), h('span', null, tt('In Safari: Share, then Add to Home Screen'))),
        row(tt('Books'), tt('When you are signed in, books you add are kept in your account, up to 200 MB in all your languages, and show up on every device you sign in on. Deleting one deletes it everywhere.'), h('span', null, tt('Import book, in the library'))),
        own ? h('details.set-own-mac', { open: params.connect !== undefined }, h('summary.set-own-mac-title', null, tt('Use your own Mac')), ...own.rows) : null,
      ], unfold));
    return { el, dispose() { sync.dispose(); account?.dispose(); reminders?.dispose(); own?.dispose(); } };
  }
  const mac = macRows(params);
  // The owner's invite links (shown once the server has said this account is the owner's).
  const invites = invitesRow();
  const status = h('div.set-help', { role: 'status' }, tt('Checking private connection…'));
  const link = h('a.btn.btn-sm', { hidden: true }, tt('Open private iPad link')) as HTMLAnchorElement;
  if (!isMacOrigin()) status.textContent = tt('This is the public copy of LinguPengu. The private address is shown when you open LinguPengu from your Mac.');
  else void fetch('/api/private-status', { cache: 'no-store', signal: AbortSignal.timeout(3000) }).then(async response => {
    if (!response.ok) throw new Error();
    const data = await response.json() as { url?: string };
    if (!data.url) throw new Error();
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.port !== '8443') throw new Error();
    link.href = `${url.href}?importLocalBooks#/`;
    link.hidden = false;
    status.textContent = tt('Private address: {address}. Only the Mac owner\'s Tailscale account can connect.', { address: url.origin });
  }).catch(() => { status.textContent = tt('Turn on Tailscale on your Mac and run npm run ipad in LinguPengu to set up the private address.'); });
  const el = group(tt('Your Mac and iPad'), account
    ? tt('Sign in and your books, words and Claude go with your account. Connecting a device to your Mac only adds its voices and local AI.')
    : tt('Connect each device to your Mac once. Your words and reading places then sync through it.'),
    account?.el ?? null,
    reminders?.el ?? null,
    invites?.el ?? null,
    sync.el,
    // With an account the Mac is extra (its voices and local AI), so its setup folds away; without one it is how devices sync.
    ...(() => {
      const setup = [
        ...mac.rows,
        row(tt('Connect'), tt('Turn on Tailscale on your iPad with the same account as this Mac, then open the private link in Safari.'), h('div', null, link, status)),
        row(tt('Install'), tt('Open LinguPengu from that icon. Books and lookups work offline. The Mac’s AI and voices need the connection.'), h('span', null, tt('In Safari: Share, then Add to Home Screen'))),
        row(tt('Books'), tt('Books on your Mac reach every device by themselves. For other books, use Import book.'), h('span', null, tt('Your Mac keeps a daily copy of your synced words for two weeks.'))),
      ];
      return account ? [more('sync', setup, unfold)] : setup;
    })());
  return { el, dispose() { mac.dispose(); sync.dispose(); account?.dispose(); reminders?.dispose(); invites?.dispose(); } };
}
