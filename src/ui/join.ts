// An invite link (#/join/<invite>, made by the owner in Settings): someone invited makes an account with a passkey on this
// device, with their name and no email, and is signed in. The account then works like any other (core/passkey.ts).
import '../styles/join.css';
import type { MountFn } from '../types';
import { h } from './dom';
import { pageTitle } from './pageHead';
import { accountLabel, cloudBase, cloudSession } from '../core/cloud';
import { inviteLabel, joinWithPasskey, passkeysSupported } from '../core/passkey';

export const mount: MountFn = (root, params, ctx) => {
  let alive = true;
  const invite = params.invite ?? '';
  const lead = h('p.join-lead', null, 'Checking your invite…');
  const status = h('p.join-status', { role: 'status', 'aria-live': 'polite' });
  const name = h('input.input.join-name', { type: 'text', autocomplete: 'name', maxlength: 40, placeholder: 'Your name', 'aria-label': 'Your name' }) as HTMLInputElement;
  const go = h('button.btn.btn-primary', { type: 'submit' }, 'Make my account') as HTMLButtonElement;
  const form = h('form.join-form', { hidden: true }, name, go) as HTMLFormElement;
  const note = h('p.join-note', { hidden: true }, 'Your phone or computer saves a passkey for Dushu. You unlock it the way you unlock the device: Face ID, a fingerprint, or your computer’s password or PIN. You don’t need a Dushu password or an email. On a shared computer, pick your phone instead and scan the code. On an iPhone or iPad the passkey is on your other Apple devices too.');
  const done = h('div.join-done', { hidden: true });

  const say = (text: string, bad = false) => { status.textContent = text; status.classList.toggle('join-bad', bad); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim()) { say('Type your name.', true); name.focus(); return; }
    go.disabled = true;
    say('Making your passkey…');
    try {
      const s = await joinWithPasskey(invite, name.value);
      if (!alive) return;
      say('');
      form.hidden = note.hidden = true;
      lead.textContent = `You’re in, ${accountLabel(s)}. Your books, words and places now go with your account.`;
      done.hidden = false;
      ctx.toast('Signed in with your passkey.');
    } catch (err) {
      if (!alive) return;
      say(err instanceof Error ? err.message : 'That did not work. Try again.', true);
    } finally { go.disabled = false; }
  });

  done.append(h('a.btn.btn-primary', { href: '#/' }, 'Open the library'));
  root.appendChild(h('div.page.join-page', null,
    h('div.page-head', null, h('div', null, pageTitle('join', 'Join Dushu'))),
    lead, form, status, note, done));

  const signedIn = cloudSession();
  if (signedIn) {
    lead.textContent = `You’re already signed in as ${accountLabel(signedIn)}. To make a new account, sign out in Settings first.`;
    done.hidden = false;
  } else if (!cloudBase() || !passkeysSupported()) {
    lead.textContent = 'This browser can’t make passkeys. Open the link in Safari or Chrome, on a phone or computer from the last few years.';
  } else if (!invite) {
    lead.textContent = 'This link is missing its invite. Ask for the link again.';
  } else {
    void inviteLabel(invite).then((label) => {
      if (!alive) return;
      lead.textContent = label ? `You’re invited to Dushu (${label}). Make an account with a passkey: no password, no email.` : 'You’re invited to Dushu. Make an account with a passkey: no password, no email.';
      form.hidden = note.hidden = false;
      name.focus();
    }, (err) => {
      if (alive) lead.textContent = err instanceof Error ? err.message : 'This invite link is not valid anymore. Ask for a new one.';
    });
  }
  return () => { alive = false; };
};
