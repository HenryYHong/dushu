// The sync account from anywhere: the top bar's account button ("Sign in" while signed out; signed in, what sync is doing:
// "Synced", "Offline", "Not synced" or "Sync off") opens the sign-in (Google, a passkey, or an emailed code), or who is signed
// in with Sign out, in a dialog: the same panel as Settings' Sync account.
import { h } from './dom';
import { icon } from './icons';
import { CLOUD_EVENT, accountLabel, cloudBase, cloudSession } from '../core/cloud';
import { passkeysSupported } from '../core/passkey';
import { googleOffered } from '../core/google';
import { SYNC_EVENT, currentSyncer, syncEnabled, type Syncer, type SyncStatus } from '../core/sync';
import { accountPanel } from './settings/account';
import { describeSync } from './settings/sync';
import { tt, ttm } from '../i18n';

/** Opens the account dialog: the sign-in (it closes by itself once a code has signed this device in), or who is signed in. */
export function openSignIn(): void {
  if (document.querySelector('dialog.signin-dialog')) return;
  const dlg = h('dialog', { class: 'modal signin-dialog', tabindex: -1, 'aria-labelledby': 'signin-title' }) as HTMLDialogElement;
  const panel = accountPanel(() => setTimeout(() => dlg.close(), 900));
  const title = h('h2.signin-title#signin-title');
  const intro = h('p.signin-text');
  // Signing out (or in) inside the dialog changes what it is about: its heading follows. A passkey account has no email, so
  // the signed-in line names the account, never "this email".
  const paintHead = () => {
    const signedIn = !!cloudSession();
    title.textContent = signedIn ? tt('Your account') : tt('Sign in');
    intro.textContent = signedIn
      ? tt('Your books, words and places are the same on every device signed in to this account.')
      : passkeysSupported() || googleOffered()
        ? tt('Sign in and your books, words and places are the same on every device. The first time makes your account.')
        : tt('Sign in and your books, words and places are the same on every device. We email you a 6-digit code. There’s no password.');
  };
  paintHead();
  dlg.append(
    h('div.signin-body', null, title, intro, panel.el),
    h('div.signin-actions', null, h('button.btn', { type: 'button', onclick: () => dlg.close() }, tt('Close'))),
  );
  // Another screen opened from inside the dialog (Create an account with a passkey, which is the Join screen): the dialog goes.
  const onRoute = () => dlg.close();
  window.addEventListener(CLOUD_EVENT, paintHead);
  window.addEventListener('hashchange', onRoute);
  dlg.addEventListener('close', () => {
    window.removeEventListener(CLOUD_EVENT, paintHead);
    window.removeEventListener('hashchange', onRoute);
    panel.dispose();
    dlg.remove();
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.appendChild(dlg);
  dlg.showModal();
  panel.focus();
}

const SYNC_OFF = ttm('Sync off');
const OFFLINE = ttm('Offline');
const NOT_SYNCED = ttm('Not synced');
const SYNCED = ttm('Synced');
const SYNCING = ttm('Syncing…');

/**
 * What the account button says while signed in, from this library's syncer and the connection. Only "Synced" (the green dot)
 * says the words here are on the other devices. A sync under way keeps what was shown before, so the label does not flicker
 * with each sync (after every change, and every few minutes); "Syncing…" shows only until the first sync has answered. The label is in English, as
 * `before` is: the button shows it through tt().
 */
export function syncLabel(st: SyncStatus | null, enabled: boolean, online: boolean, before: string | null): string {
  if (!enabled || st?.state === 'off') return SYNC_OFF;
  if (!online || st?.state === 'asleep') return OFFLINE;
  if (!st || st.state === 'error' || st.state === 'outdated' || st.state === 'memory' || st.state === 'refused' || st.state === 'signedout') return NOT_SYNCED;
  if (st.state === 'idle' && st.lastOk) return SYNCED;
  if (before && before !== SYNC_OFF) return before;
  return st.lastOk ? SYNCED : SYNCING;
}

/** The top bar's account button: "Sign in" while signed out, and what sync is doing once signed in (when the build has a sync server). */
export function signInButton(): HTMLElement {
  const label = h('span.app-signin-label');
  const btn = h('button.app-signin', { type: 'button', onclick: () => openSignIn() }, icon('user'), label) as HTMLButtonElement;
  /** The label shown while signed in, and the syncer it came from: a new syncer (another library) starts again. */
  let shown: string | null = null;
  let from: Syncer | null = null;
  const paint = () => {
    const s = cloudSession();
    btn.hidden = !cloudBase();
    if (!s) {
      shown = null;
      btn.classList.remove('app-signin-on');
      label.textContent = tt('Sign in');
      btn.title = tt('Sign in to sync');
      btn.setAttribute('aria-label', tt('Sign in to sync'));
      return;
    }
    const syncer = currentSyncer();
    if (syncer !== from) { from = syncer; shown = null; }
    const st = syncer?.status() ?? null;
    const enabled = syncEnabled();
    const online = globalThis.navigator?.onLine !== false;
    const text = syncLabel(st, enabled, online, shown);
    shown = text;
    // Why, in the tooltip and for a screen reader: the Settings line, without what the account holds. Offline before the
    // syncer has noticed reads as it will once it has.
    const now: SyncStatus = st ?? { state: 'none', pending: 0 };
    const why = text === OFFLINE && now.state !== 'asleep' && enabled ? { ...now, state: 'asleep' as const, hub: 'cloud' as const } : now;
    const reason = text === SYNCING && why.state !== 'syncing' ? tt(SYNCING) : describeSync({ ...why, counts: undefined }, enabled);
    btn.classList.toggle('app-signin-on', text === SYNCED);
    label.textContent = tt(text);
    const name = accountLabel(s);
    btn.title = tt('Signed in as {name}. {reason}', { name, reason });
    btn.setAttribute('aria-label', tt('Account, {status}: signed in as {name}. {reason}', { status: tt(text), name, reason }));
  };
  window.addEventListener(CLOUD_EVENT, paint);
  window.addEventListener(SYNC_EVENT, paint);
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  paint();
  return btn;
}
