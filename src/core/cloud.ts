// The sync account online (cloud/): sign in with an emailed code, and sync from anywhere without Tailscale or the Mac. A
// device signed in syncs with the account instead of the Mac (core/sync.ts). The session is kept in this browser only.

/** The sync server. Empty: this build has none, and Settings does not offer to sign in. */
export const CLOUD_URL = 'https://dushu-sync.henryhong.workers.dev';
const URL_KEY = 'dushu.cloud.url.v1';
const SESSION_KEY = 'dushu.cloud.v1';
/** Fired on window when this device signs in or out. */
export const CLOUD_EVENT = 'dushu:cloud';

export interface CloudSession { token: string; email: string }

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** The sync server's origin: a local one set for testing (http on loopback only), else CLOUD_URL, else null. */
export function cloudBase(): string | null {
  try {
    const custom = storage()?.getItem(URL_KEY);
    if (custom && /^(https:\/\/[^/\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(custom)) return custom;
  } catch { /* storage blocked */ }
  return CLOUD_URL || null;
}

export function cloudSession(): CloudSession | null {
  try {
    const raw = JSON.parse(storage()?.getItem(SESSION_KEY) ?? 'null') as Partial<CloudSession> | null;
    return raw && typeof raw.token === 'string' && raw.token && typeof raw.email === 'string' && cloudBase() ? { token: raw.token, email: raw.email } : null;
  } catch { return null; }
}

function announce(): void {
  try { globalThis.dispatchEvent?.(new Event(CLOUD_EVENT)); } catch { /* no window */ }
}

/** Signs this device out here only (the server already forgot it, or will). */
export function forgetSession(): void {
  try { storage()?.removeItem(SESSION_KEY); } catch { /* nothing kept */ }
  announce();
}

async function post(path: string, body: unknown, token?: string): Promise<Response> {
  const base = cloudBase();
  if (!base) throw new Error('This copy of Dushu has no sync server.');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST', credentials: 'omit', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the sync server. Check this device’s internet connection.');
  }
  if (!res.ok) {
    const why = await res.json().then((b: { error?: unknown } | null) => b?.error, () => undefined);
    throw new Error(typeof why === 'string' && why.length <= 300 ? why : `The sync server answered ${res.status}.`);
  }
  return res;
}

/** Emails a six-digit code to `email`. Resolves once it is sent. */
export async function requestCode(email: string): Promise<void> {
  await post('/auth/code', { email });
}

/** Signs this device in with the emailed code. */
export async function signIn(email: string, code: string): Promise<CloudSession> {
  const res = await post('/auth/verify', { email, code });
  const data = await res.json().catch(() => null) as Partial<CloudSession> | null;
  if (!data || typeof data.token !== 'string' || typeof data.email !== 'string') throw new Error('The sync server sent an answer Dushu did not understand.');
  const session = { token: data.token, email: data.email };
  try { storage()?.setItem(SESSION_KEY, JSON.stringify(session)); } catch { throw new Error('This browser would not keep the sign-in. Allow site data for Dushu and try again.'); }
  announce();
  return session;
}

/** Signs this device out (the other devices stay signed in). */
export async function signOut(): Promise<void> {
  const s = cloudSession();
  forgetSession();
  if (s) await post('/auth/signout', {}, s.token).catch(() => {});
}

/** fetch for a sync server path, signed in; null when this device is not signed in. */
export function cloudFetch(path: string, init: RequestInit = {}): Promise<Response> | null {
  const s = cloudSession();
  const base = cloudBase();
  if (!s || !base) return null;
  return fetch(`${base}${path}`, { ...init, credentials: 'omit', headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${s.token}` } });
}
