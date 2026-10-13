import { h } from '../dom';
import { group, row } from './controls';

export function ipadGroup(): HTMLElement {
  const status = h('div.set-help', { role: 'status' }, 'Checking private connection…');
  const link = h('a.btn.btn-sm', { hidden: true }, 'Open private iPad link') as HTMLAnchorElement;
  void fetch('/api/private-status', { cache: 'no-store', signal: AbortSignal.timeout(3000) }).then(async response => {
    if (!response.ok) throw new Error();
    const data = await response.json() as { url?: string };
    if (!data.url) throw new Error();
    const url = new URL(data.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.port !== '8443') throw new Error();
    link.href = `${url.href}?importLocalBooks#/`;
    link.hidden = false;
    status.textContent = `Private address: ${url.origin}. Only the Mac owner's Tailscale account can connect.`;
  }).catch(() => { status.textContent = 'Connect Tailscale on your Mac and run npm run ipad in Dushu to prepare private HTTPS access.'; });
  return group('iPad & private connection', 'Your library is stored separately in each browser. There is no automatic syncing.',
    row('Connect', 'Install/connect Tailscale on your iPad using the same account as this Mac. Open the private link in Safari. Keep this Mac awake for Premium voices and private AI.', h('div', null, link, status)),
    row('Install', 'In Safari, tap Share → Add to Home Screen, then open that icon. If its library is empty, choose Library → Add books from Mac. Downloaded books and dictionary lookups work offline; Mac AI and Mac voices need the connection.', h('span', null, 'Safari → Share → Add to Home Screen')),
    row('Books & progress', 'The private link imports 活着 and 射雕英雄传 from your Mac once. For other books use Import book → Files. Import the same book files first, then transfer saved words and progress with a fresh Data → Export backup / Import backup. Backups exclude books and API keys.', h('span', null, 'Keep a backup before changing browsers or clearing website data.')));
}
