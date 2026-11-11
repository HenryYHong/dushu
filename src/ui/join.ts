// Making an account with a passkey: someone types their name, this device makes a passkey, and they are signed in, with no
// email (core/passkey.ts). Anyone can, from the sign-in's "Create an account with a passkey" (#/join), within the server's
// daily count of such accounts; an invite link (#/join/<invite>, made by the owner in Settings) does the same against the
// invite's own count and names who it is for. The account then works like any other.
import '../styles/join.css';
import type { MountFn } from '../types';
import { h } from './dom';
import { pageTitle } from './pageHead';
import { accountLabel, cloudBase, cloudSession } from '../core/cloud';
import { inviteLabel, joinWithPasskey, passkeysSupported } from '../core/passkey';
import { tt } from '../i18n';

export const mount: MountFn = (root, params, ctx) => {
  let alive = true;
  const invite = params.invite ?? '';
  const lead = h('p.join-lead', null, tt('Checking your invite…'));
  const status = h('p.join-status', { role: 'status', 'aria-live': 'polite' });
  const name = h('input.input.join-name', { type: 'text', autocomplete: 'name', maxlength: 40, placeholder: tt('Your name'), 'aria-label': tt('Your name') }) as HTMLInputElement;
  const go = h('button.btn.btn-primary', { type: 'submit' }, tt('Make my account')) as HTMLButtonElement;
  const form = h('form.join-form', { hidden: true }, name, go) as HTMLFormElement;
  const note = h('p.join-note', { hidden: true }, tt('Your phone or computer saves a passkey for LinguPengu. You unlock it the way you unlock the device: Face ID, a fingerprint, or your computer’s password or PIN. You don’t need a LinguPengu password or an email. On a shared computer, pick your phone instead and scan the code. On an iPhone or iPad the passkey is on your other Apple devices too.'));
  const done = h('div.join-done', { hidden: true });

  const say = (text: string, bad = false) => { status.textContent = text; status.classList.toggle('join-bad', bad); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim()) { say(tt('Type your name.'), true); name.focus(); return; }
    go.disabled = true;
    say(tt('Making your passkey…'));
    try {
      const s = await joinWithPasskey(invite, name.value);
      if (!alive) return;
      say('');
      form.hidden = note.hidden = true;
      lead.textContent = tt('You’re in, {name}. Your books, words and places now go with your account.', { name: accountLabel(s) });
      done.hidden = false;
      ctx.toast(tt('Signed in with your passkey.'));
    } catch (err) {
      if (!alive) return;
      say(err instanceof Error ? err.message : tt('That did not work. Try again.'), true);
    } finally { go.disabled = false; }
  });

  done.append(h('a.btn.btn-primary', { href: '#/' }, tt('Open the library')));
  root.appendChild(h('div.page.join-page', null,
    h('div.page-head', null, h('div', null, pageTitle('join', tt('Join LinguPengu')))),
    lead, form, status, note, done));

  const signedIn = cloudSession();
  if (signedIn) {
    lead.textContent = tt('You’re already signed in as {name}. To make a new account, sign out in Settings first.', { name: accountLabel(signedIn) });
    done.hidden = false;
  } else if (!cloudBase() || !passkeysSupported()) {
    lead.textContent = tt('This browser can’t make passkeys. Open the link in Safari or Chrome, on a phone or computer from the last few years.');
  } else if (!invite) {
    lead.textContent = tt('Make your LinguPengu account with a passkey: no password, no email.');
    form.hidden = note.hidden = false;
    name.focus();
  } else {
    void inviteLabel(invite).then((label) => {
      if (!alive) return;
      lead.textContent = label
        ? tt('You’re invited to LinguPengu ({label}). Make an account with a passkey: no password, no email.', { label })
        : tt('You’re invited to LinguPengu. Make an account with a passkey: no password, no email.');
      form.hidden = note.hidden = false;
      name.focus();
    }, (err) => {
      if (alive) lead.textContent = err instanceof Error ? err.message : tt('This invite link is not valid anymore. Ask for a new one.');
    });
  }
  return () => { alive = false; };
};
