import { h } from '../dom';
import { isMacOrigin } from '../../core/macBridge';
import { group, row } from './controls';
import { macRows } from './mac';

/** The Mac connection and the iPad setup: how a device reaches the Mac's private services. */
export function ipadGroup(params: Record<string, string>): { el: HTMLElement; dispose(): void } {
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
  const el = group('Your Mac and iPad', 'Connect each device to your Mac once. Your library is stored separately in each browser; there is no automatic syncing.',
    ...mac.rows,
    row('Connect', 'Install/connect Tailscale on your iPad using the same account as this Mac. Open the private link in Safari. Keep this Mac awake for Premium voices and private AI.', h('div', null, link, status)),
    row('Install', 'In Safari, tap Share → Add to Home Screen, then open that icon. Downloaded books and dictionary lookups work offline; Mac AI and Mac voices need the connection.', h('span', null, 'Safari → Share → Add to Home Screen')),
    row('Books & progress', 'Your own books on your Mac are added automatically the first time a device reaches it, and stay on the device after that. Library → Add books from Mac is the manual fallback. For other books use Import book → Files. Transfer saved words and progress with a fresh Data → Export backup / Import backup. Backups exclude books.', h('span', null, 'Keep a backup before changing browsers or clearing website data.')));
  return { el, dispose: mac.dispose };
}
