// The sync account from anywhere: the top bar's account button ("Sign in" while signed out, "Synced" once signed in) opens the
// sign-in (a passkey, or an emailed code), or who is signed in with Sign out, in a dialog: the same panel as Settings' Sync account.
import { h } from './dom';
import { icon } from './icons';
import { CLOUD_EVENT, accountLabel, cloudBase, cloudSession } from '../core/cloud';
import { passkeysSupported } from '../core/passkey';
import { accountPanel } from './settings/account';

/** Opens the account dialog: the sign-in (it closes by itself once a code has signed this device in), or who is signed in. */
export function openSignIn(): void {
  if (document.querySelector('dialog.signin-dialog')) return;
  const dlg = h('dialog', { class: 'modal signin-dialog', tabindex: -1, 'aria-labelledby': 'signin-title' }) as HTMLDialogElement;
  const panel = accountPanel(() => setTimeout(() => dlg.close(), 900));
  const signedIn = !!cloudSession();
  dlg.append(
    h('div.signin-body', null,
      h('h2.signin-title#signin-title', null, signedIn ? 'Your account' : 'Sign in'),
      h('p.signin-text', null, signedIn
        ? 'Your books, words and places are the same on every device signed in with this email.'
        : passkeysSupported()
          ? 'Sign in and your books, words and places are the same on every device. Use your passkey, or get a code by email.'
          : 'Sign in and your books, words and places are the same on every device. We email you a 6-digit code. There’s no password.'),
      panel.el),
    h('div.signin-actions', null, h('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Close')),
  );
  dlg.addEventListener('close', () => { panel.dispose(); dlg.remove(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.appendChild(dlg);
  dlg.showModal();
  panel.focus();
}

/** The top bar's account button: "Sign in" while signed out, "Synced" once signed in (when the build has a sync server). */
export function signInButton(): HTMLElement {
  const label = h('span.app-signin-label');
  const btn = h('button.app-signin', { type: 'button', onclick: () => openSignIn() }, icon('user'), label) as HTMLButtonElement;
  const paint = () => {
    const s = cloudSession();
    btn.hidden = !cloudBase();
    btn.classList.toggle('app-signin-on', !!s);
    label.textContent = s ? 'Synced' : 'Sign in';
    btn.title = s ? `Signed in as ${accountLabel(s)}` : 'Sign in to sync';
    btn.setAttribute('aria-label', s ? `Account: signed in as ${accountLabel(s)}` : 'Sign in to sync');
  };
  window.addEventListener(CLOUD_EVENT, paint);
  paint();
  return btn;
}
