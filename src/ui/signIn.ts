// Sign in from anywhere: the top bar's Sign in button (shown while this device is signed out) opens the sync account's
// sign-in in a dialog, the same panel as Settings → Sync account.
import { h } from './dom';
import { icon } from './icons';
import { CLOUD_EVENT, cloudBase, cloudSession } from '../core/cloud';
import { accountPanel } from './settings/account';

/** Opens the Sign in dialog. It closes by itself once a code has signed this device in. */
export function openSignIn(): void {
  if (document.querySelector('dialog.signin-dialog')) return;
  const dlg = h('dialog', { class: 'modal signin-dialog', tabindex: -1, 'aria-labelledby': 'signin-title' }) as HTMLDialogElement;
  const panel = accountPanel(() => setTimeout(() => dlg.close(), 900));
  dlg.append(
    h('div.signin-body', null,
      h('h2.signin-title#signin-title', null, 'Sign in to sync'),
      h('p.signin-text', null, 'Your words, reading places, looked-up words and bookmarks stay the same on every device you sign in on, anywhere. We email you a six-digit code; there is no password.'),
      panel.el),
    h('div.signin-actions', null, h('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Close')),
  );
  dlg.addEventListener('close', () => { panel.dispose(); dlg.remove(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.appendChild(dlg);
  dlg.showModal();
  panel.focus();
}

/** The top bar's Sign in button: shown only while this device is signed out (and the build has a sync server). */
export function signInButton(): HTMLElement {
  const btn = h('button.app-signin', { type: 'button', title: 'Sign in to sync', 'aria-label': 'Sign in to sync', onclick: () => openSignIn() },
    icon('user'), h('span.app-signin-label', null, 'Sign in')) as HTMLButtonElement;
  const paint = () => { btn.hidden = !cloudBase() || !!cloudSession(); };
  window.addEventListener(CLOUD_EVENT, paint);
  paint();
  return btn;
}
