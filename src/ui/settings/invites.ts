// The owner's invite links (Settings, beside the sync account): each one lets the people it is sent to make an account with
// a passkey, no email (ui/join.ts), up to the number set. Shown only to the owner's account; the server checks that too.
import { h, clear } from '../dom';
import { CLOUD_EVENT, cloudBase, isAccountOwner } from '../../core/cloud';
import { createInvite, inviteLink, listInvites, revokeInvite, type Invite } from '../../core/passkey';
import { nextId, row } from './controls';
import { num, tt, ttn } from '../../i18n';

export function invitesRow(): { el: HTMLElement; dispose(): void } | null {
  if (!cloudBase()) return null;
  const labelId = nextId('invite-label');
  const label = h('input.input.set-cloud-input', { id: labelId, type: 'text', maxlength: 60, placeholder: tt('Who it’s for, like Mom’s class'), 'aria-label': tt('Who the link is for') }) as HTMLInputElement;
  const max = h('input.input.set-invite-max', { type: 'number', min: 1, max: 500, value: '30', 'aria-label': tt('How many people') }) as HTMLInputElement;
  const make = h('button.btn.btn-sm', { type: 'button' }, tt('Make a link')) as HTMLButtonElement;
  const list = h('div.set-invites');
  const result = h('div.set-test-out', { role: 'status', 'aria-live': 'polite' });
  const el = row(tt('Invite people'), tt('Send a link to people you want to use Globereader. They make an account with a passkey, with no email, and the link works for as many people as you set.'),
    h('div.set-invite', null, h('div.set-cloud-row', null, label, max, make), list, result), labelId);
  el.hidden = true;
  let alive = true;

  const say = (text: string) => { result.textContent = text; };

  function item(inv: Invite): HTMLElement {
    const link = inviteLink(inv.token);
    const field = h('input.input.set-link', { type: 'text', readonly: true, value: link, 'aria-label': tt('Invite link for {name}', { name: inv.label }) }) as HTMLInputElement;
    field.addEventListener('focus', () => field.select());
    const copy = h('button.btn.btn-sm', { type: 'button', onclick: async () => {
      try { await navigator.clipboard.writeText(link); say(tt('Copied the link for {name}.', { name: inv.label })); } catch { field.select(); say(tt('Select the link and copy it.')); }
    } }, tt('Copy'));
    const share = typeof navigator.share === 'function'
      ? h('button.btn.btn-sm', { type: 'button', onclick: () => void navigator.share({ title: 'Globereader', text: tt('Read Chinese books with me on Globereader'), url: link }).catch(() => {}) }, tt('Share'))
      : null;
    const stop = h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: async () => {
      try { await revokeInvite(inv.token); say(tt('The link for {name} no longer works. Accounts made with it stay.', { name: inv.label })); void load(); } catch (e) { say(e instanceof Error ? e.message : tt('Could not stop the link.')); }
    } }, tt('Stop'));
    return h('div.set-invite-item', null,
      h('div.set-invite-head', null, h('span.set-invite-label', null, inv.label), h('span.set-invite-uses', null, ttn(inv.uses, '{n} of {max} joined', '{n} of {max} joined', { max: num(inv.max) }))),
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
    } catch (e) { if (alive) say(e instanceof Error ? e.message : tt('Could not load the invite links.')); }
  }

  make.addEventListener('click', async () => {
    make.disabled = true;
    try {
      const inv = await createInvite(label.value.trim() || tt('Friends'), Math.min(500, Math.max(1, Number(max.value) || 30)));
      label.value = '';
      await load();
      say(tt('Made a link for {name}. Copy it and send it.', { name: inv.label }));
    } catch (e) { say(e instanceof Error ? e.message : tt('Could not make the link.')); }
    finally { make.disabled = false; }
  });

  const onChange = () => void load();
  window.addEventListener(CLOUD_EVENT, onChange);
  void load();
  return { el, dispose() { alive = false; window.removeEventListener(CLOUD_EVENT, onChange); } };
}
