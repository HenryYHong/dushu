// "Connect this device to your Mac": the public copy of the app reaches the Mac's private services once the owner connects each
// device. The address is kept in this browser only. The private site makes a one-time link that carries it over.
import { h } from '../dom';
import { icon } from '../icons';
import { BRIDGE_EVENT, connectMac, connectedMac, disconnectMac, handoffLink, isMacOrigin, parseMacUrl, probeMac } from '../../core/macBridge';
import { nextId, row } from './controls';

const host = (origin: string) => new URL(origin).host;

/** The rows that connect this device to the Mac, for the Mac and iPad group. */
export function macRows(params: Record<string, string>): { rows: HTMLElement[]; dispose(): void } {
  let alive = true;
  const status = h('div.set-help', { role: 'status', 'aria-live': 'polite' });
  const result = h('div.set-test-out.set-mac-result', { role: 'status', 'aria-live': 'polite' });
  const say = (text: string, kind: '' | 'good' | 'bad' = '') => {
    result.className = `set-test-out set-mac-result${kind ? ` set-${kind}` : ''}`;
    result.textContent = text;
  };

  // The address field.
  const addressId = nextId('mac');
  const address = h('input.input.set-address', { id: addressId, type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
    placeholder: 'your-mac.your-tailnet.ts.net:8443', 'aria-label': 'Address of your Mac' }) as HTMLInputElement;
  const connectBtn = h('button.btn.btn-sm.btn-primary', { type: 'button' }, 'Connect') as HTMLButtonElement;
  const disconnectBtn = h('button.btn.btn-sm', { type: 'button' }, 'Disconnect') as HTMLButtonElement;

  async function connect(origin: string): Promise<boolean> {
    connectBtn.disabled = true;
    say('Checking your Mac…');
    try {
      await probeMac(origin);
      if (!connectMac(origin)) throw new Error('This browser would not keep the address. Allow site data for Dushu and try again.');
      say(`Connected. Claude, the local model, Premium voices and your books now use your Mac (${host(origin)}).`, 'good');
      return true;
    } catch (e) {
      const network = e instanceof TypeError || (e as { name?: string })?.name === 'TimeoutError';
      say(network ? 'Could not reach your Mac. Check that Tailscale is on for this device and that the Mac is awake.' : e instanceof Error ? e.message : 'Could not connect.', 'bad');
      return false;
    } finally { connectBtn.disabled = false; paint(); }
  }
  connectBtn.addEventListener('click', () => {
    const origin = parseMacUrl(address.value);
    if (!origin) { say('Enter the Tailscale address of your Mac, such as your-mac.your-tailnet.ts.net:8443.', 'bad'); return; }
    void connect(origin);
  });
  address.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') connectBtn.click(); });
  disconnectBtn.addEventListener('click', () => { disconnectMac(); say('Disconnected. This device no longer uses your Mac.'); paint(); });

  function paint() {
    const mac = connectedMac();
    disconnectBtn.hidden = !mac;
    status.textContent = mac ? `Connected to ${host(mac)}. Claude, the local model, Premium voices and your books use that Mac while it is awake.`
      : isMacOrigin() ? 'You opened Dushu from your Mac, so this device already uses it.'
      : 'Not connected. Without a Mac, translation uses Chrome on-device or the dictionary, and voices use this device.';
    if (mac && document.activeElement !== address) address.value = host(mac);
  }

  // A link from the private site: confirm before trusting the address it carries, then take it out of the address bar.
  const pending = h('div.set-pending', { role: 'group', 'aria-label': 'Connect this device' });
  pending.hidden = true;
  if (params.connect !== undefined) {
    const origin = parseMacUrl(params.connect);
    try { history.replaceState(null, '', `${location.pathname}${location.search}#/settings`); } catch { /* keep the hash */ }
    if (!origin) say('That link did not hold a valid Mac address. Make a new one on your Mac.', 'bad');
    else if (connectedMac() === origin) say(`This device is already connected to ${host(origin)}.`, 'good');
    else {
      pending.hidden = false;
      pending.replaceChildren(
        h('div.set-label', null, `Connect this device to ${host(origin)}?`),
        h('p.set-help', null, 'Only do this if the link came from your own Dushu. After connecting, translation, voices and your books on this device use that Mac.'),
        h('div.set-btn-row', null,
          h('button.btn.btn-sm.btn-primary', { type: 'button', onclick: async () => { if (await connect(origin)) pending.hidden = true; } }, 'Connect'),
          h('button.btn.btn-sm', { type: 'button', onclick: () => { pending.hidden = true; } }, 'Not now')));
    }
  }

  // On the private site: the one-time link for other devices.
  const linkInput = h('input.input.set-link', { type: 'text', readonly: true, 'aria-label': 'Link for your other devices', value: '' }) as HTMLInputElement;
  const copyBtn = h('button.btn.btn-sm', { type: 'button' }, icon('copy'), 'Copy link') as HTMLButtonElement;
  const shareBtn = h('button.btn.btn-sm', { type: 'button', hidden: typeof navigator === 'undefined' || typeof navigator.share !== 'function' }, 'Share') as HTMLButtonElement;
  const linkNote = h('div.set-help');
  const linkRow = row('Link for your other devices',
    'Open this link once on a device that uses the public Dushu site. It connects that device to your Mac. The link is not a password: the Mac still accepts only your Tailscale account.',
    h('div.set-link-wrap', null, h('div.set-link-row', null, linkInput, copyBtn, shareBtn), linkNote));
  linkRow.hidden = true;
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(linkInput.value); linkNote.textContent = 'Copied.'; }
    catch { linkInput.select(); linkNote.textContent = 'Press and hold the link to copy it.'; }
  });
  shareBtn.addEventListener('click', () => { void navigator.share?.({ url: linkInput.value }).catch(() => {}); });
  if (isMacOrigin()) {
    void fetch('/api/private-status', { cache: 'no-store', signal: AbortSignal.timeout(3000) }).then(async (response) => {
      if (!response.ok) throw new Error();
      const data = await response.json() as { url?: string | null };
      const link = data.url ? handoffLink(data.url) : null;
      if (!alive) return;
      linkRow.hidden = false;
      if (link) linkInput.value = link;
      else { linkInput.value = ''; copyBtn.disabled = true; shareBtn.disabled = true; linkNote.textContent = 'Run npm run ipad in Dushu on your Mac to set up the private address first.'; }
    }).catch(() => {});
  }

  const rows = [
    row('Connection', 'Your Mac adds Claude, its local model, Premium voices and your own books. It is reached over Tailscale, only by you.',
      h('div.set-status-wrap', null, status)),
    linkRow,
    row('Mac address', 'Your Mac\'s Tailscale name with the port, shown in Settings on the private site.',
      h('div.set-link-wrap', null, h('div.set-link-row', null, address, connectBtn, disconnectBtn), result), addressId),
    pending,
  ];
  paint();
  const onChange = () => paint();
  window.addEventListener(BRIDGE_EVENT, onChange);
  return { rows, dispose() { alive = false; window.removeEventListener(BRIDGE_EVENT, onChange); } };
}
