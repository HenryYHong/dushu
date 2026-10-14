// The Sync row in "Your Mac and iPad": the switch, what the last sync did, and Sync now.
import { SYNC_EVENT, currentSyncer, setSyncEnabled, syncEnabled, type SyncStatus } from '../../core/sync';
import { h } from '../dom';
import { icon } from '../icons';
import { row } from './controls';

const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${n(m, 'minute')} ago`;
  const hours = Math.round(m / 60);
  if (hours < 24) return `${n(hours, 'hour')} ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** One or two sentences about the sync status, for the Settings row. */
export function describeSync(st: SyncStatus, enabled = syncEnabled(), now = Date.now()): string {
  const waiting = st.pending ? ` ${n(st.pending, 'change')} from this device will sync when it can.` : '';
  if (st.state === 'memory') return 'This browser is blocking local storage, so nothing here can sync.';
  if (!enabled || st.state === 'off') return `Sync is off on this device.${st.pending ? ` ${n(st.pending, 'change')} here have not been sent.` : ''}`;
  if (st.state === 'none') return 'Connect this device to your Mac above, and your words and reading places sync through it.';
  if (st.state === 'asleep') return `Your Mac did not answer. It may be asleep, or Tailscale is off on this device.${waiting}`;
  if (st.state === 'refused') return 'Your Mac did not accept this device. Sign in to Tailscale with the same account as the Mac.';
  if (st.state === 'error') return `Sync did not finish: ${st.message ?? 'unknown error'}${waiting}`;
  if (st.state === 'syncing' && !st.lastOk) return 'Syncing with your Mac…';
  if (!st.lastOk) return 'Not synced yet.';
  const c = st.counts;
  const held = c ? ` Your Mac holds ${n(c.words, 'saved word')}, ${n(c.known, 'known word')} and your place in ${n(c.places, 'book')}.` : '';
  return `Up to date, synced ${ago(st.lastOk, now)}.${held}${waiting}`;
}

export function syncRow(): { el: HTMLElement; dispose(): void } {
  const input = h('input.set-switch-input', { type: 'checkbox', role: 'switch', 'aria-label': 'Sync with your Mac' }) as HTMLInputElement;
  input.checked = syncEnabled();
  const toggle = h('label.set-switch', null, input, h('span.set-switch-track', null, h('span.set-switch-thumb')));
  const status = h('div.set-help.set-sync-status', { role: 'status', 'aria-live': 'polite' });
  const now = h('button.btn.btn-sm', { type: 'button' }, icon('refresh'), 'Sync now') as HTMLButtonElement;
  const show = () => {
    const syncer = currentSyncer();
    const st: SyncStatus = syncer?.status() ?? { state: 'none', pending: 0 };
    status.textContent = describeSync(st);
    now.disabled = !syncer || !syncEnabled() || st.state === 'syncing' || st.state === 'memory';
  };
  input.addEventListener('change', () => { setSyncEnabled(input.checked); show(); });
  now.addEventListener('click', () => { now.disabled = true; void currentSyncer()?.run().then(show); });
  window.addEventListener(SYNC_EVENT, show);
  const tick = window.setInterval(show, 30_000);
  show();
  const el = row('Sync',
    'Saved words (with their review schedule), known words and your place in each book stay the same on every device connected to this Mac. Changes made while the Mac is asleep sync when it wakes.',
    h('div.set-sync', null, h('div.set-sync-top', null, toggle, now), status));
  return { el, dispose() { window.removeEventListener(SYNC_EVENT, show); window.clearInterval(tick); } };
}
