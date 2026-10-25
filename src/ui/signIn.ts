// The sync account from anywhere: the top bar's account button ("Sign in" while signed out, "Synced" once signed in) opens the
// sign-in, or who is signed in with Sign out, in a dialog: the same panel as Settings → Sync account.
import { h } from './dom';
import { icon } from './icons';
import { CLOUD_EVENT, cloudBase, cloudSession } from '../core/cloud';
import { accountPanel } from './settings/account';

/** Opens the account dialog: the sign-in (it closes by itself once a code has signed this device in), or who is signed in. */
export function openSignIn(): void {
  if (document.querySelector('dialog.signin-dialog')) return;
  const dlg = h('dialog', { class: 'modal signin-dialog', tabindex: -1, 'aria-labelledby': 'signin-title' }) as HTMLDialogElement;
  const panel = accountPanel(() => setTimeout(() => dlg.close(), 900));
  const signedIn = !!cloudSession();
  dlg.append(
    h('div.signin-body', null,
      h('h2.signin-title#signin-title', null, signedIn ? 'Your account' : 'Sign in to sync'),
      h('p.signin-text', null, signedIn
        ? 'This device keeps your books, words, reading places, looked-up words and bookmarks the same as every other device signed in with your email.'
        : 'Your books, words, reading places, looked-up words and bookmarks stay the same on every device you sign in on, anywhere. We email you a six-digit code; there is no password.'),
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
    btn.title = s ? `Signed in as ${s.email}` : 'Sign in to sync';
    btn.setAttribute('aria-label', s ? `Account: signed in as ${s.email}` : 'Sign in to sync');
  };
  window.addEventListener(CLOUD_EVENT, paint);
  paint();
  return btn;
}
