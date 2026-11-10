// The Sync row in "Your Mac and iPad": the switch, what the last sync did, and Sync now.
import { SYNC_EVENT, currentSyncer, hasSyncHub, setSyncEnabled, syncEnabled, type SyncStatus } from '../../core/sync';
import { CLOUD_EVENT, cloudBase } from '../../core/cloud';
import { isChinese, lang } from '../../lang/active';
import { h } from '../dom';
import { icon } from '../icons';
import { nextId, row } from './controls';
import { langName, tt, ttn, uiLocale } from '../../i18n';

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return tt('just now');
  const m = Math.round(s / 60);
  if (m < 60) return ttn(m, '{n} minute ago', '{n} minutes ago');
  const hours = Math.round(m / 60);
  if (hours < 24) return ttn(hours, '{n} hour ago', '{n} hours ago');
  return new Date(ms).toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' });
}

/** What the account or the Mac holds: one sentence for each, with and without bookmarks. */
function heldSentence(c: NonNullable<SyncStatus['counts']>, cloud: boolean): string {
  const marks = c.bookmarks ?? 0;
  const vars = {
    words: ttn(c.words, '{n} saved word', '{n} saved words'),
    known: ttn(c.known, '{n} known word', '{n} known words'),
    places: ttn(c.places, 'your place in {n} book', 'your place in {n} books'),
    bookmarks: ttn(marks, '{n} bookmark', '{n} bookmarks'),
  };
  if (cloud) {
    return marks ? tt('Your account holds {words}, {known}, {bookmarks} and {places}.', vars)
      : tt('Your account holds {words}, {known} and {places}.', vars);
  }
  return marks ? tt('Your Mac holds {words}, {known}, {bookmarks} and {places}.', vars)
    : tt('Your Mac holds {words}, {known} and {places}.', vars);
}

/** One or two sentences about the sync status, for the Settings row. */
export function describeSync(st: SyncStatus, enabled = syncEnabled(), now = Date.now()): string {
  const waiting = st.pending ? ` ${ttn(st.pending, '{n} change from this device will sync when it can.', '{n} changes from this device will sync when it can.')}` : '';
  if (st.state === 'memory') return tt('This browser is blocking local storage, so nothing here can sync.');
  // Each language has its own switch: say which one is off, outside Chinese.
  if (!enabled || st.state === 'off') {
    const off = isChinese() ? tt('Sync is off on this device.') : tt('Sync is off for {language} on this device.', { language: langName(lang().id, lang().name) });
    return `${off}${st.pending ? ` ${ttn(st.pending, '{n} change here have not been sent.', '{n} changes here have not been sent.')}` : ''}`;
  }
  if (st.state === 'none') return cloudBase()
    ? tt('Sign in above, or connect this device to your Mac, and your words, reading places and bookmarks sync.')
    : tt('Connect this device to your Mac above, and your words and reading places sync through it.');
  if (st.state === 'signedout') return tt('This device was signed out of sync. Sign in again above.');
  if (st.state === 'asleep') return st.hub === 'cloud'
    ? `${tt('Could not reach the sync server. Check this device’s internet connection.')}${waiting}`
    : `${tt('Your Mac did not answer. It may be asleep, or Tailscale is off on this device.')}${waiting}`;
  if (st.state === 'refused') return tt('Your Mac did not accept this device. Sign in to Tailscale with the same account as the Mac.');
  if (st.state === 'error') return `${tt('Sync did not finish: {reason}', { reason: st.message ?? tt('unknown error') })}${waiting}`;
  // A hub from before this language synced: the records wait here (core/sync.ts says which hub and what to do).
  if (st.state === 'outdated') {
    const why = st.message ?? tt('Your sync server is older than this version of Globereader.');
    return `${why}${st.pending ? ` ${ttn(st.pending, '{n} change from this device is waiting.', '{n} changes from this device are waiting.')}` : ''}`;
  }
  // The first sync: the hub it goes to is known only once it answers, so it names none.
  if (st.state === 'syncing' && !st.lastOk) return tt('Syncing…');
  if (!st.lastOk) return tt('Not synced yet.');
  const held = st.counts ? ` ${heldSentence(st.counts, st.hub === 'cloud')}` : '';
  return `${tt('Up to date, synced {when}.', { when: ago(st.lastOk, now) })}${held}${waiting}`;
}

export function syncRow(): { el: HTMLElement; dispose(): void } {
  // Named by the row's title (aria-labelledby, below): it syncs with the account or the Mac, whichever this device has.
  const input = h('input.set-switch-input', { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  input.checked = syncEnabled();
  const toggle = h('label.set-switch', null, input, h('span.set-switch-track', null, h('span.set-switch-thumb')));
  const status = h('div.set-help.set-sync-status', { role: 'status', 'aria-live': 'polite' });
  const now = h('button.btn.btn-sm', { type: 'button' }, icon('refresh'), tt('Sync now')) as HTMLButtonElement;
  const show = () => {
    const syncer = currentSyncer();
    const hub = hasSyncHub();
    const st: SyncStatus = syncer?.status() ?? { state: 'none', pending: 0 };
    // Nothing to sync with (signed out, no Mac): Sync now cannot do anything, and the line says to sign in.
    status.textContent = describeSync(hub || st.state === 'memory' ? st : { ...st, state: 'none' });
    now.disabled = !syncer || !hub || !syncEnabled() || st.state === 'syncing' || st.state === 'memory';
  };
  input.addEventListener('change', () => { setSyncEnabled(input.checked); show(); });
  now.addEventListener('click', () => { now.disabled = true; void currentSyncer()?.run().then(show); });
  window.addEventListener(SYNC_EVENT, show);
  window.addEventListener(CLOUD_EVENT, show);
  const tick = window.setInterval(show, 30_000);
  show();
  // What syncs: Chinese adds the reader's corrections, and another language is named.
  const language = langName(lang().id, lang().name);
  const help = cloudBase()
    ? isChinese()
      ? tt('Words, lookups, bookmarks, your corrections and your place in each book. Changes made offline sync when you are back online.')
      : tt('{language} words, lookups, bookmarks and your place in each book. Changes made offline sync when you are back online.', { language })
    : isChinese()
      ? tt('Words, lookups, bookmarks, your corrections and your place in each book, on every device connected to this Mac.')
      : tt('{language} words, lookups, bookmarks and your place in each book, on every device connected to this Mac.', { language });
  const el = row(tt('Sync'), help, h('div.set-sync', null, h('div.set-sync-top', null, toggle, now), status));
  const title = el.querySelector<HTMLElement>('.set-label');
  if (title) { title.id = nextId('sync-title'); input.setAttribute('aria-labelledby', title.id); }
  return { el, dispose() { window.removeEventListener(SYNC_EVENT, show); window.removeEventListener(CLOUD_EVENT, show); window.clearInterval(tick); } };
}
