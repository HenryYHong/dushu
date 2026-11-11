// Signing in to the sync account: the Sync account row in Settings, and the Sign in dialog the top bar opens (ui/signIn.ts).
// Both are the same panel. Signed out, three ways in, in this order: Continue with Google (core/google.ts, only on the public
// site, the one address Google sends sign-ins back to), a passkey (core/passkey.ts: sign in with one, or make an account with
// one on the Join screen), and an email with its six-digit code. Google and the code make the account the first time, and
// reach the same one for the same address. Signed in: who it is, a passkey for this device, Sign out and Delete account.
import { h } from '../dom';
import { CLOUD_EVENT, accountLabel, cloudBase, cloudSession, deleteAccount, requestCode, signIn, signOut } from '../../core/cloud';
import { googleOffered, startGoogleSignIn } from '../../core/google';
import { addPasskey, passkeyHere, passkeysSupported, signInWithPasskey } from '../../core/passkey';
import { dropPushHere } from '../../core/reminders';
import { nextId, row } from './controls';
import { tt } from '../../i18n';

/**
 * Anyone may sign in with an email code, which makes the account the first time, or make one with a passkey. A server that
 * keeps a list of addresses (ALLOWED_EMAILS) refuses any other with a 403 ("That email cannot sign in here."), which said
 * nothing about why or what to do.
 */
export function codeRefusal(e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  const status = (e as { status?: unknown } | null)?.status;
  if (status === 403 || /^That email cannot sign in here\.?$/.test(message) || /answered 403\b/.test(message)) {
    return tt('Sign-in by email is closed here. Make an account with a passkey instead.');
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
  // Google first where it is offered: its own white button is the one that stands out, so the passkey button is a plain one
  // beside it. Elsewhere (localhost, the owner's Mac) the passkey is the one filled button. The email is a way in for anyone,
  // and a way back.
  const google = googleOffered();
  const passkeys = passkeysSupported();
  const googleBtn = h('button.btn.btn-sm.set-cloud-google', { type: 'button' }, googleMark(), h('span', null, tt('Continue with Google'))) as HTMLButtonElement;
  const passkeyBtn = h(passkeys && !google ? 'button.btn.btn-sm.btn-primary' : 'button.btn.btn-sm', { type: 'button', hidden: !passkeys }, tt('Sign in with a passkey')) as HTMLButtonElement;
  // The Join screen without an invite (ui/join.ts): a name, then a passkey makes the account.
  const createLink = h('a.btn.btn-sm.btn-ghost.set-cloud-create', { href: '#/join' }, tt('Create an account with a passkey'));
  const addKeyBtn = h('button.btn.btn-sm', { type: 'button', hidden: true }, tt('Add a passkey on this device')) as HTMLButtonElement;
  const sendBtn = h(passkeys || google ? 'button.btn.btn-sm' : 'button.btn.btn-sm.btn-primary', { type: 'button' }, tt('Email me a code')) as HTMLButtonElement;
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
  const googleRow = h('div.set-cloud-row.set-cloud-wide', { hidden: !google }, googleBtn);
  const passkeyRow = h('div.set-cloud-row.set-cloud-wide', { hidden: !passkeys }, passkeyBtn);
  const createRow = h('div.set-cloud-row.set-cloud-wide', { hidden: !passkeys }, createLink);
  const orEmail = h('div.set-help.set-cloud-or', { hidden: !passkeys && !google }, tt('Or get a code by email:'));
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
    googleRow.hidden = !google || !!s || !!asked;
    passkeyRow.hidden = !passkeys || !!s || !!asked;
    createRow.hidden = !passkeys || !!s || !!asked;
    orEmail.hidden = (!passkeys && !google) || !!s || !!asked;
    emailRow.hidden = !!s || !!asked;
    codeRow.hidden = !!s || !asked;
    outRow.hidden = !s;
    addKeyBtn.hidden = !s || !passkeys || passkeyHere();
    if (!s) deleteRow.hidden = true;
    // Signed out with more than one way in, the buttons say it all; with email alone, what the email is for.
    status.textContent = s ? tt('Signed in as {account}.', { account: accountLabel(s) })
      : asked ? tt('A code was sent to {email}. It works for 10 minutes.', { email: asked })
      : passkeys || google ? ''
      : tt('We only use your email to send you sign-in codes.');
  }

  googleBtn.addEventListener('click', () => {
    say('');
    try {
      // The page leaves for Google and comes back signed in (main.ts). Disabled meanwhile so a second tap does not start a
      // second trip; and again in a moment, for a browser that came Back from Google's page to this one, kept as it was.
      startGoogleSignIn();
      googleBtn.disabled = true;
      setTimeout(() => { googleBtn.disabled = false; }, 4000);
    } catch (e) { say(e instanceof Error ? e.message : tt('Could not sign in.'), 'bad'); }
  });

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
    // Notifications here were the account's: they stop with the sign-in (told to the account while it still is one).
    await dropPushHere();
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
    el: h('div.set-cloud', null, googleRow, passkeyRow, createRow, orEmail, emailRow, codeRow, outRow, deleteRow, status, result),
    emailId,
    focus: () => (asked ? code : cloudSession() ? email : google ? googleBtn : passkeys ? passkeyBtn : email).focus({ preventScroll: true }),
    dispose() { window.removeEventListener(CLOUD_EVENT, onChange); },
  };
}

/**
 * Google's "G" in its four colors, as its sign-in branding guidelines draw it on a Continue with Google button (the mark is
 * Google's, used as they ask: unchanged, on a white button, or Google's dark one in the dark theme).
 */
function googleMark(): HTMLElement {
  const el = h('span.set-cloud-google-mark', { 'aria-hidden': 'true' });
  el.innerHTML = '<svg viewBox="0 0 48 48" width="18" height="18" focusable="false">'
    + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
    + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
    + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
    + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>'
    + '</svg>';
  return el;
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
