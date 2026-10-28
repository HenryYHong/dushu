// The owner's invite links (Settings, beside the sync account): each one lets the people it is sent to make an account with
// a passkey, no email (ui/join.ts), up to the number set. Shown only to the owner's account; the server checks that too.
import { h, clear } from '../dom';
import { CLOUD_EVENT, cloudBase, isAccountOwner } from '../../core/cloud';
import { createInvite, inviteLink, listInvites, revokeInvite, type Invite } from '../../core/passkey';
import { nextId, row } from './controls';

export function invitesRow(): { el: HTMLElement; dispose(): void } | null {
  if (!cloudBase()) return null;
  const labelId = nextId('invite-label');
  const label = h('input.input.set-cloud-input', { id: labelId, type: 'text', maxlength: 60, placeholder: 'Who it’s for, like Mom’s class', 'aria-label': 'Who the link is for' }) as HTMLInputElement;
  const max = h('input.input.set-invite-max', { type: 'number', min: 1, max: 500, value: '30', 'aria-label': 'How many people' }) as HTMLInputElement;
  const make = h('button.btn.btn-sm', { type: 'button' }, 'Make a link') as HTMLButtonElement;
  const list = h('div.set-invites');
  const result = h('div.set-test-out', { role: 'status', 'aria-live': 'polite' });
  const el = row('Invite people', 'Send a link to people you want to use Dushu. They make an account with a passkey, with no email, and the link works for as many people as you set.',
    h('div.set-invite', null, h('div.set-cloud-row', null, label, max, make), list, result), labelId);
  el.hidden = true;
  let alive = true;

  const say = (text: string) => { result.textContent = text; };

  function item(inv: Invite): HTMLElement {
    const link = inviteLink(inv.token);
    const field = h('input.input.set-link', { type: 'text', readonly: true, value: link, 'aria-label': `Invite link for ${inv.label}` }) as HTMLInputElement;
    field.addEventListener('focus', () => field.select());
    const copy = h('button.btn.btn-sm', { type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(link); say(`Copied the link for ${inv.label}.`); } catch { field.select(); say('Select the link and copy it.'); }
    } }, 'Copy');
    const share = typeof navigator.share === 'function'
      ? h('button.btn.btn-sm', { type: 'button', onclick: () => void navigator.share({ title: 'Dushu', text: 'Read Chinese books with me on Dushu', url: link }).catch(() => {}) }, 'Share')
      : null;
    const stop = h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: async () => {
      try { await revokeInvite(inv.token); say(`The link for ${inv.label} no longer works. Accounts made with it stay.`); void load(); } catch (e) { say(e instanceof Error ? e.message : 'Could not stop the link.'); }
    } }, 'Stop');
    return h('div.set-invite-item', null,
      h('div.set-invite-head', null, h('span.set-invite-label', null, inv.label), h('span.set-invite-uses', null, `${inv.uses} of ${inv.max} joined`)),
      h('div.set-cloud-row', null, field, copy, share, stop));
  }

  async function load(): Promise<void> {
    el.hidden = !isAccountOwner();
    if (el.hidden) return;
    try {
      const invites = await listInvites();
      if (!alive) return;
      clear(list);
      for (const inv of invites) list.appendChild(item(inv));
    } catch (e) { if (alive) say(e instanceof Error ? e.message : 'Could not load the invite links.'); }
  }

  make.addEventListener('click', async () => {
    make.disabled = true;
    try {
      const inv = await createInvite(label.value.trim() || 'Friends', Math.min(500, Math.max(1, Number(max.value) || 30)));
      label.value = '';
      await load();
      say(`Made a link for ${inv.label}. Copy it and send it.`);
    } catch (e) { say(e instanceof Error ? e.message : 'Could not make the link.'); }
    finally { make.disabled = false; }
  });

  const onChange = () => void load();
  window.addEventListener(CLOUD_EVENT, onChange);
  void load();
  return { el, dispose() { alive = false; window.removeEventListener(CLOUD_EVENT, onChange); } };
}
