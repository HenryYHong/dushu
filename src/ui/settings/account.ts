// Signing in to the sync account: the Sync account row in Settings, and the Sign in dialog the top bar opens (ui/signIn.ts).
// Both are the same panel: a passkey (core/passkey.ts) or an email and its six-digit code, then who is signed in, a passkey
// for this device, and Sign out.
import { h } from '../dom';
import { CLOUD_EVENT, accountLabel, cloudBase, cloudSession, deleteAccount, requestCode, signIn, signOut } from '../../core/cloud';
import { addPasskey, passkeyHere, passkeysSupported, signInWithPasskey } from '../../core/passkey';
import { nextId, row } from './controls';
import { tt } from '../../i18n';

/**
 * Anyone may sign in with an email code, which makes the account the first time; invite links make one with a passkey. A server
 * that keeps a list of addresses (ALLOWED_EMAILS) refuses any other with a 403 ("That email cannot sign in here."), which said
 * nothing about why or what to do.
 */
export function codeRefusal(e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 403 || /^That email cannot sign in here\.?$/.test(message) || /answered 403\b/.test(message)) {
    return tt('Sign-in by email is closed here. To make an account, open the invite link you were sent.');
  }
  return message || tt('The code could not be sent.');
}

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
    spellcheck: 'false', placeholder: tt('you@example.com'), 'aria-label': tt('Email') }) as HTMLInputElement;
  // With passkeys, the passkey is the one filled button; the email is the owner's way in, and a way back for anyone.
  const passkeys = passkeysSupported();
  const passkeyBtn = h(passkeys ? 'button.btn.btn-sm.btn-primary' : 'button.btn.btn-sm', { type: 'button', hidden: !passkeys }, tt('Sign in with a passkey')) as HTMLButtonElement;
  const addKeyBtn = h('button.btn.btn-sm', { type: 'button', hidden: true }, tt('Add a passkey on this device')) as HTMLButtonElement;
  const sendBtn = h(passkeys ? 'button.btn.btn-sm' : 'button.btn.btn-sm.btn-primary', { type: 'button' }, tt('Email me a code')) as HTMLButtonElement;
  const code = h('input.input.set-cloud-input.set-cloud-code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6,
    placeholder: tt('6-digit code'), 'aria-label': tt('Code from the email') }) as HTMLInputElement;
  const signInBtn = h('button.btn.btn-sm.btn-primary', { type: 'button' }, tt('Sign in')) as HTMLButtonElement;
  const againBtn = h('button.btn.btn-sm', { type: 'button' }, tt('Another email')) as HTMLButtonElement;
  const signOutBtn = h('button.btn.btn-sm', { type: 'button' }, tt('Sign out')) as HTMLButtonElement;
  const deleteBtn = h('button.btn.btn-sm.btn-ghost', { type: 'button' }, tt('Delete account…')) as HTMLButtonElement;
  const confirmBtn = h('button.btn.btn-sm.btn-danger-solid', { type: 'button' }, tt('Delete my account')) as HTMLButtonElement;
  const keepBtn = h('button.btn.btn-sm', { type: 'button' }, tt('Keep it')) as HTMLButtonElement;
  const status = h('div.set-help.set-cloud-status', { role: 'status', 'aria-live': 'polite' });
  const result = h('div.set-test-out.set-cloud-result', { role: 'status', 'aria-live': 'polite' });
  const passkeyRow = h('div.set-cloud-row', { hidden: !passkeys }, passkeyBtn);
  const orEmail = h('div.set-help.set-cloud-or', { hidden: !passkeys }, tt('Or get a code by email:'));
  const emailRow = h('div.set-cloud-row', null, email, sendBtn);
  const codeRow = h('div.set-cloud-row', null, code, signInBtn, againBtn);
  const outRow = h('div.set-cloud-row', null, addKeyBtn, signOutBtn, deleteBtn);
  const deleteRow = h('div.set-cloud-delete', { hidden: true },
    h('p.set-help', null, tt('This deletes your account and everything kept in it, and signs out every device. What is on this device stays here.')),
    h('div.set-cloud-row', null, confirmBtn, keepBtn));
  let asked = ''; // the email a code was sent to

  const say = (text: string, kind: '' | 'good' | 'bad' = '') => {
    result.className = `set-test-out set-cloud-result${kind ? ` set-${kind}` : ''}`;
    result.textContent = text;
  };

  function paint(): void {
    const s = cloudSession();
    passkeyRow.hidden = !passkeys || !!s || !!asked;
    orEmail.hidden = !passkeys || !!s || !!asked;
    emailRow.hidden = !!s || !!asked;
    codeRow.hidden = !!s || !asked;
    outRow.hidden = !s;
    addKeyBtn.hidden = !s || !passkeys || passkeyHere();
    if (!s) deleteRow.hidden = true;
    status.textContent = s ? tt('Signed in as {account}.', { account: accountLabel(s) })
      : asked ? tt('A code was sent to {email}. It works for 10 minutes.', { email: asked })
      : passkeys ? tt('New here? Get a code by email to make your account.')
      : tt('We only use your email to send you sign-in codes.');
  }

  passkeyBtn.addEventListener('click', async () => {
    passkeyBtn.disabled = true;
    say('');
    try {
      await signInWithPasskey();
      say(tt('Signed in. Your books’ places, words and bookmarks are on their way.'), 'good');
      onSignedIn?.();
    } catch (e) { say(e instanceof Error ? e.message : tt('Could not sign in.'), 'bad'); }
    finally { passkeyBtn.disabled = false; paint(); }
  });
  addKeyBtn.addEventListener('click', async () => {
    addKeyBtn.disabled = true;
    say('');
    try {
      await addPasskey();
      say(tt('Passkey added. Next time, sign in here the way you unlock this device.'), 'good');
    } catch (e) { say(e instanceof Error ? e.message : tt('The passkey could not be added.'), 'bad'); }
    finally { addKeyBtn.disabled = false; paint(); }
  });

  sendBtn.addEventListener('click', async () => {
    const value = email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { say(tt('Enter your email address.'), 'bad'); return; }
    sendBtn.disabled = true;
    say(tt('Sending…'));
    try {
      await requestCode(value);
      asked = value;
      say('');
      paint();
      code.value = '';
      code.focus();
    } catch (e) { say(codeRefusal(e), 'bad'); }
    finally { sendBtn.disabled = false; }
  });
  signInBtn.addEventListener('click', async () => {
    const digits = code.value.replace(/\D/g, '');
    if (digits.length !== 6) { say(tt('Type the six-digit code from the email.'), 'bad'); return; }
    signInBtn.disabled = true;
    say(tt('Signing in…'));
    try {
      await signIn(asked, digits);
      asked = '';
      say(tt('Signed in. Your books’ places, words and bookmarks are on their way.'), 'good');
      onSignedIn?.();
    } catch (e) { say(e instanceof Error ? e.message : tt('Could not sign in.'), 'bad'); }
    finally { signInBtn.disabled = false; paint(); }
  });
  againBtn.addEventListener('click', () => { asked = ''; say(''); paint(); email.focus(); });
  signOutBtn.addEventListener('click', async () => {
    signOutBtn.disabled = true;
    await signOut();
    signOutBtn.disabled = false;
    say(tt('Signed out. Everything stays on this device; it no longer syncs through your account.'));
    paint();
  });
  deleteBtn.addEventListener('click', () => { deleteRow.hidden = false; confirmBtn.focus(); });
  keepBtn.addEventListener('click', () => { deleteRow.hidden = true; deleteBtn.focus(); });
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    say(tt('Deleting…'));
    try {
      await deleteAccount();
      deleteRow.hidden = true;
      say(tt('Your account is deleted. Everything on this device stays here; it no longer syncs.'), 'good');
    } catch (e) { say(e instanceof Error ? e.message : tt('The account could not be deleted. Try again.'), 'bad'); }
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
    el: h('div.set-cloud', null, passkeyRow, orEmail, emailRow, codeRow, outRow, deleteRow, status, result),
    emailId,
    focus: () => (asked ? code : passkeys && !cloudSession() ? passkeyBtn : email).focus({ preventScroll: true }),
    dispose() { window.removeEventListener(CLOUD_EVENT, onChange); },
  };
}

/** The Sync account row for the Mac and iPad group, or null when this build has no sync server. */
export function accountRow(): { el: HTMLElement; dispose(): void } | null {
  if (!cloudBase()) return null;
  const panel = accountPanel();
  const el = row(tt('Sync account'), tt('Sign in on each device and your books, words and places are the same on all of them.'),
    panel.el, panel.emailId);
  el.id = 'sync-account';
  return { el, dispose: panel.dispose };
}
