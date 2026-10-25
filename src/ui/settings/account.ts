// Signing in to the sync account with an emailed code: the Sync account row in Settings, and the Sign in dialog the top bar
// opens (ui/signIn.ts). Both are the same panel: email, then the six-digit code, then who is signed in and Sign out.
import { h } from '../dom';
import { CLOUD_EVENT, cloudBase, cloudSession, deleteAccount, requestCode, signIn, signOut } from '../../core/cloud';
import { nextId, row } from './controls';

export interface AccountPanel {
  el: HTMLElement;
  /** The email field's id, for a label. */
  emailId: string;
  focus(): void;
  dispose(): void;
}

/** The sign-in panel. `onSignedIn` runs once a code has signed this device in. */
export function accountPanel(onSignedIn?: () => void): AccountPanel {
  const emailId = nextId('cloud-email');
  const email = h('input.input.set-cloud-input.set-cloud-email', { id: emailId, type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'none',
    spellcheck: 'false', placeholder: 'you@example.com', 'aria-label': 'Email' }) as HTMLInputElement;
  const sendBtn = h('button.btn.btn-sm.btn-primary', { type: 'button' }, 'Email me a code') as HTMLButtonElement;
  const code = h('input.input.set-cloud-input.set-cloud-code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6,
    placeholder: '6-digit code', 'aria-label': 'Code from the email' }) as HTMLInputElement;
  const signInBtn = h('button.btn.btn-sm.btn-primary', { type: 'button' }, 'Sign in') as HTMLButtonElement;
  const againBtn = h('button.btn.btn-sm', { type: 'button' }, 'Another email') as HTMLButtonElement;
  const signOutBtn = h('button.btn.btn-sm', { type: 'button' }, 'Sign out') as HTMLButtonElement;
  const deleteBtn = h('button.btn.btn-sm.btn-ghost', { type: 'button' }, 'Delete account…') as HTMLButtonElement;
  const confirmBtn = h('button.btn.btn-sm.btn-danger-solid', { type: 'button' }, 'Delete my account') as HTMLButtonElement;
  const keepBtn = h('button.btn.btn-sm', { type: 'button' }, 'Keep it') as HTMLButtonElement;
  const status = h('div.set-help.set-cloud-status', { role: 'status', 'aria-live': 'polite' });
  const result = h('div.set-test-out.set-cloud-result', { role: 'status', 'aria-live': 'polite' });
  const emailRow = h('div.set-cloud-row', null, email, sendBtn);
  const codeRow = h('div.set-cloud-row', null, code, signInBtn, againBtn);
  const outRow = h('div.set-cloud-row', null, signOutBtn, deleteBtn);
  const deleteRow = h('div.set-cloud-delete', { hidden: true },
    h('p.set-help', null, 'This deletes your account from the sync server: the books, words, reading places and bookmarks kept there, and every device’s sign-in. What is on this device stays on it.'),
    h('div.set-cloud-row', null, confirmBtn, keepBtn));
  let asked = ''; // the email a code was sent to

  const say = (text: string, kind: '' | 'good' | 'bad' = '') => {
    result.className = `set-test-out set-cloud-result${kind ? ` set-${kind}` : ''}`;
    result.textContent = text;
  };

  function paint(): void {
    const s = cloudSession();
    emailRow.hidden = !!s || !!asked;
    codeRow.hidden = !!s || !asked;
    outRow.hidden = !s;
    if (!s) deleteRow.hidden = true;
    status.textContent = s ? `Signed in as ${s.email}. Your books, words, reading places, looked-up words and bookmarks are the same on every device signed in with this email, wherever you are.`
      : asked ? `A code was sent to ${asked}. It works for 10 minutes.`
      : 'Sign in with your email on each device, and your books, words and reading places are the same on all of them. Your email is only used to send you sign-in codes.';
  }

  sendBtn.addEventListener('click', async () => {
    const value = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { say('Enter your email address.', 'bad'); return; }
    sendBtn.disabled = true;
    say('Sending…');
    try {
      await requestCode(value);
      asked = value;
      say('');
      paint();
      code.value = '';
      code.focus();
    } catch (e) { say(e instanceof Error ? e.message : 'The code could not be sent.', 'bad'); }
    finally { sendBtn.disabled = false; }
  });
  signInBtn.addEventListener('click', async () => {
    const digits = code.value.replace(/\D/g, '');
    if (digits.length !== 6) { say('Type the six-digit code from the email.', 'bad'); return; }
    signInBtn.disabled = true;
    say('Signing in…');
    try {
      await signIn(asked, digits);
      asked = '';
      say('Signed in. Your books’ places, words and bookmarks are on their way.', 'good');
      onSignedIn?.();
    } catch (e) { say(e instanceof Error ? e.message : 'Could not sign in.', 'bad'); }
    finally { signInBtn.disabled = false; paint(); }
  });
  againBtn.addEventListener('click', () => { asked = ''; say(''); paint(); email.focus(); });
  signOutBtn.addEventListener('click', async () => {
    signOutBtn.disabled = true;
    await signOut();
    signOutBtn.disabled = false;
    say('Signed out. Everything stays on this device; it no longer syncs through your account.');
    paint();
  });
  deleteBtn.addEventListener('click', () => { deleteRow.hidden = false; confirmBtn.focus(); });
  keepBtn.addEventListener('click', () => { deleteRow.hidden = true; deleteBtn.focus(); });
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    say('Deleting…');
    try {
      await deleteAccount();
      deleteRow.hidden = true;
      say('Your account is deleted. Everything on this device stays here; it no longer syncs.', 'good');
    } catch (e) { say(e instanceof Error ? e.message : 'The account could not be deleted. Try again.', 'bad'); }
    finally { confirmBtn.disabled = false; paint(); }
  });
  email.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') sendBtn.click(); });
  code.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') signInBtn.click(); });
  // The code fills itself in from the email on an iPad (one-time-code); six digits sign in.
  code.addEventListener('input', () => { if (code.value.replace(/\D/g, '').length === 6 && !signInBtn.disabled) signInBtn.click(); });

  const onChange = () => paint();
  window.addEventListener(CLOUD_EVENT, onChange);
  paint();
  return {
    el: h('div.set-cloud', null, emailRow, codeRow, outRow, deleteRow, status, result),
    emailId,
    focus: () => (asked ? code : email).focus({ preventScroll: true }),
    dispose() { window.removeEventListener(CLOUD_EVENT, onChange); },
  };
}

/** The Sync account row for the Mac and iPad group, or null when this build has no sync server. */
export function accountRow(): { el: HTMLElement; dispose(): void } | null {
  if (!cloudBase()) return null;
  const panel = accountPanel();
  const el = row('Sync account', 'Sign in with your email to keep your books, words and reading places the same on all your devices, from anywhere.',
    panel.el, panel.emailId);
  el.id = 'sync-account';
  return { el, dispose: panel.dispose };
}
