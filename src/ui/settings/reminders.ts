// The Reminders row in Settings, under the sync account: email reminders for an account with an email, and notifications on this
// device when the sync server can send them (core/reminders.ts says what each one is). Shown only while signed in, and only when
// there is something to switch: a passkey account on a server without notifications has neither.
import { h } from '../dom';
import { CLOUD_EVENT, cloudBase, cloudSession } from '../../core/cloud';
import { currentSubscription, getReminders, pushAvailable, pushKey, refreshPush, setEmailReminders, subscribePush, unsubscribePush } from '../../core/reminders';
import { isStandalone, onIPhoneOrIPad } from '../fullscreen';
import { nextId, row } from './controls';
import { tt } from '../../i18n';

/**
 * Whether this browser can turn notifications on: 'ok', 'home' on an iPhone or iPad outside the Home Screen app (Safari has no
 * PushManager there, only in the app added to the Home Screen), or 'no'.
 */
export function pushSupport(): 'ok' | 'home' | 'no' {
  if (pushAvailable()) return 'ok';
  return onIPhoneOrIPad() && !isStandalone() ? 'home' : 'no';
}

/** A labeled switch on its own line, inside the row. */
function switchLine(label: string): { el: HTMLElement; input: HTMLInputElement } {
  const id = nextId('remind');
  const input = h('input.set-switch-input', { id, type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  const el = h('div.set-remind-line', null,
    h('label.set-remind-name', { for: id }, label),
    h('label.set-switch', null, input, h('span.set-switch-track', null, h('span.set-switch-thumb'))));
  return { el, input };
}

export function remindersRow(): { el: HTMLElement; dispose(): void } | null {
  if (!cloudBase()) return null;
  const email = switchLine(tt('Email reminders'));
  const push = switchLine(tt('Notifications on this device'));
  const note = h('div.set-help.set-remind-note', { role: 'status', 'aria-live': 'polite' });
  const result = h('div.set-test-out.set-remind-result', { role: 'status', 'aria-live': 'polite' });
  const el = row(tt('Reminders'), tt('When words are ready to review and you haven’t been back for a few days. At most once a week.'),
    h('div.set-remind', null, email.el, push.el, note, result));
  el.classList.add('set-remind-row');
  // Nothing shows until the server has said what this account has.
  el.hidden = email.el.hidden = push.el.hidden = true;
  let alive = true;
  /** Counts loads, so an older one that answers late changes nothing. */
  let loads = 0;
  let key: string | null = null;

  const say = (text: string) => { result.className = `set-test-out set-remind-result${text ? ' set-bad' : ''}`; result.textContent = text; };
  const why = (e: unknown) => (e instanceof Error && e.message ? e.message : tt('That did not work. Try again.'));

  /** The notifications line: its switch from this device's subscription, and why it can't be turned on when it can't. */
  async function paintPush(): Promise<void> {
    push.el.hidden = !key;
    if (!key) return;
    const support = pushSupport();
    const denied = support === 'ok' && Notification.permission === 'denied';
    const sub = support === 'ok' && !denied ? await currentSubscription() : null;
    if (!alive) return;
    push.input.checked = !!sub && Notification.permission === 'granted';
    push.input.disabled = support !== 'ok' || denied;
    note.textContent = support === 'home' ? tt('On iPhone and iPad, add LinguPengu to your Home Screen first: tap Share, then Add to Home Screen.')
      : support === 'no' ? tt('This browser can’t show notifications.')
      : denied ? tt('Notifications are blocked for this site in your browser settings.')
      : '';
  }

  async function load(): Promise<void> {
    const mine = ++loads;
    if (!cloudSession()) { el.hidden = true; return; }
    // Both asked at once; a server from before reminders answers neither (404) and the row stays hidden. So does one that
    // can't be reached: Settings has nothing to say about reminders then.
    const [prefs, k] = await Promise.all([getReminders().catch(() => null), pushKey().catch(() => null)]);
    if (!alive || mine !== loads) return;
    key = k;
    email.el.hidden = !prefs?.canEmail;
    email.input.checked = !!prefs?.email;
    el.hidden = !cloudSession() || (!prefs?.canEmail && !key);
    await paintPush();
    if (key && pushSupport() === 'ok') void refreshPush();
  }

  email.input.addEventListener('change', async () => {
    const on = email.input.checked;
    email.input.disabled = true;
    say('');
    try {
      const prefs = await setEmailReminders(on);
      email.input.checked = prefs.email;
    } catch (e) {
      email.input.checked = !on;
      say(why(e));
    } finally { email.input.disabled = false; }
  });

  push.input.addEventListener('change', async () => {
    const on = push.input.checked;
    push.input.disabled = true;
    say('');
    try {
      if (!on) { await unsubscribePush(); return; }
      if (!key) return;
      // The browser asks only now, on this tap, never when Settings opens.
      const permission = Notification.permission === 'granted' ? 'granted' : (await Notification.requestPermission()) ?? Notification.permission;
      if (permission !== 'granted') {
        // Closed without choosing: nothing to say. Blocked: paintPush says how to unblock.
        push.input.checked = false;
        return;
      }
      await subscribePush(key);
    } catch (e) {
      say(why(e));
    } finally {
      push.input.disabled = false;
      await paintPush();
    }
  });

  const onChange = () => { say(''); void load(); };
  window.addEventListener(CLOUD_EVENT, onChange);
  void load();
  return { el, dispose() { alive = false; window.removeEventListener(CLOUD_EVENT, onChange); } };
}
