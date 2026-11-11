// Review reminders: the sync server (cloud/) tells a person when saved words are waiting and they have not been back for a few
// days, at most once a week, at 6 PM where they are (core/sync.ts sends the time zone). It sends a notification to each device
// that turned them on here (Web Push, through public/sw.js), and otherwise an email when the account has one and emails are
// on. Settings shows both switches (ui/settings/reminders.ts); this file is how they talk to the server and the browser.
import { tt } from '../i18n';
import { cloudFetch, cloudSession } from './cloud';

/** The account's reminder settings: follow-up emails on, whether it has an email address at all, and the devices with notifications. */
export interface ReminderPrefs { email: boolean; canEmail: boolean; devices: number }

/**
 * How long to wait for the service worker. On a first visit it is registered only once the dictionary has downloaded
 * (main.ts), and in dev never: the tap then says it did not work, and a later one does.
 */
const WORKER_WAIT_MS = 10_000;

/** A signed-in request, with the sync server's own error message when it gives one, as core/cloud.ts post() does. */
async function call(path: string, body?: unknown): Promise<Response> {
  let res: Response | null;
  try {
    const init: RequestInit = body === undefined ? { signal: AbortSignal.timeout(15_000) }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) };
    res = await cloudFetch(path, init);
  } catch {
    throw new Error(tt('Could not reach the sync server. Check this device’s internet connection.'));
  }
  if (!res) throw new Error(tt('Sign in first.'));
  if (!res.ok) {
    const why = await res.json().then((b: { error?: unknown } | null) => b?.error, () => undefined);
    throw Object.assign(new Error(typeof why === 'string' && why.length <= 300 ? why : tt('The sync server answered {status}.', { status: res.status })), { status: res.status });
  }
  return res;
}

function prefsOf(data: unknown): ReminderPrefs {
  const d = (data ?? {}) as Partial<Record<keyof ReminderPrefs, unknown>>;
  return { email: d.email === true, canEmail: d.canEmail === true, devices: typeof d.devices === 'number' && Number.isFinite(d.devices) ? d.devices : 0 };
}

/** The account's reminder settings, or null when this device is signed out or the server is from before reminders (404). */
export async function getReminders(): Promise<ReminderPrefs | null> {
  if (!cloudSession()) return null;
  try { return prefsOf(await (await call('/me/reminders')).json()); } catch (e) {
    if ((e as { status?: unknown }).status === 404) return null;
    throw e;
  }
}

/** Turns the follow-up emails on or off. Sign-in codes come either way. */
export async function setEmailReminders(on: boolean): Promise<ReminderPrefs> {
  return prefsOf(await (await call('/me/reminders', { email: on })).json());
}

/** The server's public key for notifications (base64url), or null when it has none set up or is from before them. */
export async function pushKey(): Promise<string | null> {
  if (!cloudSession()) return null;
  try {
    const data = await (await call('/push/key')).json() as { key?: unknown };
    return typeof data.key === 'string' && isPublicKey(data.key) ? data.key : null;
  } catch (e) {
    if ((e as { status?: unknown }).status === 404) return null;
    throw e;
  }
}

/** base64url to bytes (the key a subscription is made with). */
export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** A P-256 public key as base64url: 65 bytes, the uncompressed point (0x04 first). Anything else could not make a subscription. */
function isPublicKey(s: string): boolean {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return false;
  try { const b = fromBase64Url(s.replace(/=+$/, '')); return b.length === 65 && b[0] === 4; } catch { return false; }
}

/** Whether this browser has what notifications need: a service worker, PushManager and Notification. */
export function pushAvailable(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}

/** This device's subscription, without waiting for a service worker that is not there (in dev, or before the first one). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushAvailable()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch { return null; }
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const had = sub.options?.applicationServerKey;
  if (!had) return true; // a browser that does not say: take it as the same one
  const bytes = new Uint8Array(had);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

/**
 * Turns notifications on for this device: a subscription made with the server's key (a new one if the server's key changed),
 * then kept by the account. The permission must already be granted. When the account does not take it, the subscription is
 * dropped again, so the switch never says on for a device the server does not know. Returns how many devices the account has.
 */
export async function subscribePush(key: string): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => { timer = setTimeout(() => r(null), WORKER_WAIT_MS); })]);
  clearTimeout(timer);
  if (!reg) throw new Error(tt('That did not work. Try again.'));
  const bytes = fromBase64Url(key);
  let sub: PushSubscription;
  try {
    const had = await reg.pushManager.getSubscription();
    if (had && !sameKey(had, bytes)) await had.unsubscribe().catch(() => false);
    sub = had && sameKey(had, bytes) ? had : await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  } catch {
    // The browser's push service refused or could not be reached; its own message is not written for people.
    throw new Error(tt('That did not work. Try again.'));
  }
  try {
    const data = await (await call('/me/push', { subscription: sub.toJSON() })).json() as { devices?: unknown };
    return typeof data.devices === 'number' ? data.devices : 1;
  } catch (e) {
    await sub.unsubscribe().catch(() => false);
    throw e;
  }
}

/**
 * Turns notifications off for this device: the subscription ends here first (nothing more can arrive), then the account is
 * told. If it can't be told (offline), the server finds out on its next try: the push service answers that the subscription is
 * gone, and the server drops it.
 */
export async function unsubscribePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await call('/me/push/remove', { endpoint }).then((r) => r.text(), () => '');
}

/**
 * Signing out: this device stops getting the account's reminders, and the next person to sign in here turns them on for their
 * own. Runs while still signed in (the account is told); never stops the sign-out.
 */
export async function dropPushHere(): Promise<void> {
  await unsubscribePush().catch(() => {});
}

/**
 * Sends this device's subscription to the account again, when it has one. Settings does it each time it opens: an account that
 * dropped it (more than ten devices, the account made again) gets it back, and "same endpoint replaces" on the server makes it
 * harmless. Quiet: a failure changes nothing.
 */
export async function refreshPush(): Promise<void> {
  const sub = await currentSubscription();
  if (sub && Notification.permission === 'granted') await call('/me/push', { subscription: sub.toJSON() }).then((r) => r.text(), () => '');
}
