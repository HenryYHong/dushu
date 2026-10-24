// "Sync account": sign in with an emailed code, so this device syncs through the sync account online instead of the Mac.
import { h } from '../dom';
import { CLOUD_EVENT, cloudBase, cloudSession, requestCode, signIn, signOut } from '../../core/cloud';
import { nextId, row } from './controls';

/** The sign-in row for the Mac and iPad group, or null when this build has no sync server. */
export function accountRow(): { el: HTMLElement; dispose(): void } | null {
  if (!cloudBase()) return null;
  const emailId = nextId('cloud-email');
  const email = h('input.input.set-address.set-cloud-email', { id: emailId, type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'none',
    spellcheck: 'false', placeholder: 'you@example.com', 'aria-label': 'Email' }) as HTMLInputElement;
  const sendBtn = h('button.btn.btn-sm.btn-primary', { type: 'button' }, 'Email me a code') as HTMLButtonElement;
  const code = h('input.input.set-address.set-cloud-code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6,
    placeholder: '6-digit code', 'aria-label': 'Code from the email' }) as HTMLInputElement;
  const signInBtn = h('button.btn.btn-sm.btn-primary', { type: 'button' }, 'Sign in') as HTMLButtonElement;
  const againBtn = h('button.btn.btn-sm', { type: 'button' }, 'Another email') as HTMLButtonElement;
  const signOutBtn = h('button.btn.btn-sm', { type: 'button' }, 'Sign out') as HTMLButtonElement;
  const status = h('div.set-help', { role: 'status', 'aria-live': 'polite' });
  const result = h('div.set-test-out.set-cloud-result', { role: 'status', 'aria-live': 'polite' });
  const emailRow = h('div.set-link-row', null, email, sendBtn);
  const codeRow = h('div.set-link-row', null, code, signInBtn, againBtn);
  const outRow = h('div.set-link-row', null, signOutBtn);
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
    status.textContent = s ? `Signed in as ${s.email}. Your words, reading places, looked-up words and bookmarks sync with every device signed in with this email, wherever you are.`
      : asked ? `A code was sent to ${asked}. It works for 10 minutes.`
      : 'Not signed in. Sign in with the same email on each device, and they sync anywhere, without Tailscale or your Mac.';
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
      say('Signed in. Syncing now.', 'good');
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
  email.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') sendBtn.click(); });
  code.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') signInBtn.click(); });
  // The code fills itself in from the email on an iPad (one-time-code); six digits sign in.
  code.addEventListener('input', () => { if (code.value.replace(/\D/g, '').length === 6 && !signInBtn.disabled) signInBtn.click(); });

  const onChange = () => paint();
  window.addEventListener(CLOUD_EVENT, onChange);
  paint();
  const el = row('Sync account', 'Sign in with your email to sync between your devices from anywhere. Devices signed in sync with each other; ones that are not still sync through your Mac.',
    h('div.set-link-wrap', null, emailRow, codeRow, outRow, status, result), emailId);
  return { el, dispose() { window.removeEventListener(CLOUD_EVENT, onChange); } };
}
