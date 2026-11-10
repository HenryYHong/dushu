// The sync account from anywhere: the top bar's account button ("Sign in" while signed out; signed in, what sync is doing:
// "Synced", "Offline", "Not synced" or "Sync off") opens the sign-in (a passkey, or an emailed code), or who is signed in with
// Sign out, in a dialog: the same panel as Settings' Sync account.
import { h } from './dom';
import { icon } from './icons';
import { CLOUD_EVENT, accountLabel, cloudBase, cloudSession } from '../core/cloud';
import { passkeysSupported } from '../core/passkey';
import { SYNC_EVENT, currentSyncer, syncEnabled, type Syncer, type SyncStatus } from '../core/sync';
import { accountPanel } from './settings/account';
import { describeSync } from './settings/sync';

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
    title.textContent = signedIn ? 'Your account' : 'Sign in';
    intro.textContent = signedIn
      ? 'Your books, words and places are the same on every device signed in to this account.'
      : passkeysSupported()
        ? 'Sign in and your books, words and places are the same on every device. Use your passkey, or get a code by email.'
        : 'Sign in and your books, words and places are the same on every device. We email you a 6-digit code. There’s no password.';
  };
  paintHead();
  dlg.append(
    h('div.signin-body', null, title, intro, panel.el),
    h('div.signin-actions', null, h('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Close')),
  );
  window.addEventListener(CLOUD_EVENT, paintHead);
  dlg.addEventListener('close', () => { window.removeEventListener(CLOUD_EVENT, paintHead); panel.dispose(); dlg.remove(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.appendChild(dlg);
  dlg.showModal();
  panel.focus();
}

/**
 * What the account button says while signed in, from this library's syncer and the connection. Only "Synced" (the green dot)
 * says the words here are on the other devices. A sync under way keeps what was shown before, so the label does not flicker
 * with each sync every 45 seconds; "Syncing…" shows only until the first sync has answered.
 */
export function syncLabel(st: SyncStatus | null, enabled: boolean, online: boolean, before: string | null): string {
  if (!enabled || st?.state === 'off') return 'Sync off';
  if (!online || st?.state === 'asleep') return 'Offline';
  if (!st || st.state === 'error' || st.state === 'outdated' || st.state === 'memory' || st.state === 'refused' || st.state === 'signedout') return 'Not synced';
  if (st.state === 'idle' && st.lastOk) return 'Synced';
  if (before && before !== 'Sync off') return before;
  return st.lastOk ? 'Synced' : 'Syncing…';
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
      label.textContent = 'Sign in';
      btn.title = 'Sign in to sync';
      btn.setAttribute('aria-label', 'Sign in to sync');
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
    const why = text === 'Offline' && now.state !== 'asleep' && enabled ? { ...now, state: 'asleep' as const, hub: 'cloud' as const } : now;
    const reason = text === 'Syncing…' && why.state !== 'syncing' ? 'Syncing…' : describeSync({ ...why, counts: undefined }, enabled);
    btn.classList.toggle('app-signin-on', text === 'Synced');
    label.textContent = text;
    btn.title = `Signed in as ${accountLabel(s)}. ${reason}`;
    btn.setAttribute('aria-label', `Account, ${text}: signed in as ${accountLabel(s)}. ${reason}`);
  };
  window.addEventListener(CLOUD_EVENT, paint);
  window.addEventListener(SYNC_EVENT, paint);
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  paint();
  return btn;
}
