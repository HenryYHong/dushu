// The sync account online (cloud/): sign in with an emailed code, and sync from anywhere without Tailscale or the Mac. A
// device signed in syncs with the account instead of the Mac (core/sync.ts). The session is kept in this browser only.

/** The sync server. Empty: this build has none, and Settings does not offer to sign in. */
export const CLOUD_URL = 'https://dushu-sync.henryhong.workers.dev';
const URL_KEY = 'dushu.cloud.url.v1';
const SESSION_KEY = 'dushu.cloud.v1';
/** The email of the signed-in account when the server last said it is an owner's (Claude, the Mac settings). */
const OWNER_KEY = 'dushu.cloud.owner.v1';
/** Fired on window when this device signs in or out. */
export const CLOUD_EVENT = 'dushu:cloud';

/** A device's sign-in. `created` names the account it signed in to (it changes when the account is deleted and made again). */
export interface CloudSession { token: string; email: string; created?: string }

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
    return raw && typeof raw.token === 'string' && raw.token && typeof raw.email === 'string' && cloudBase()
      ? { token: raw.token, email: raw.email, ...(typeof raw.created === 'string' && raw.created ? { created: raw.created } : {}) } : null;
  } catch { return null; }
}

function announce(): void {
  try { globalThis.dispatchEvent?.(new Event(CLOUD_EVENT)); } catch { /* no window */ }
}

/** Signs this device out here only (the server already forgot it, or will). */
export function forgetSession(): void {
  try { storage()?.removeItem(SESSION_KEY); storage()?.removeItem(OWNER_KEY); } catch { /* nothing kept */ }
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
  await (await post('/auth/code', { email })).text().catch(() => '');
}

/**
 * Marks this device keeps per account, as 'email|created|…' (created: the account's own id, so a deleted account's marks do
 * not hold for the one made again with the same email), or 'email|…' for a sign-in from before accounts had one.
 */
export function accountMark(s: CloudSession, rest: string): string {
  return s.created ? `${s.email}|${s.created}|${rest}` : `${s.email}|${rest}`;
}
/** The lists of such marks (books put in the account, the Mac copied into it). */
export const MARK_LISTS = ['dushu.cloud.books-up.v1', 'dushu.cloud.mac-copied.v1'];

/** Signs this device in with the emailed code. */
export async function signIn(email: string, code: string): Promise<CloudSession> {
  const res = await post('/auth/verify', { email, code });
  const data = await res.json().catch(() => null) as Partial<CloudSession> | null;
  if (!data || typeof data.token !== 'string' || typeof data.email !== 'string') throw new Error('The sync server sent an answer Dushu did not understand.');
  const session: CloudSession = { token: data.token, email: data.email, ...(typeof data.created === 'string' && data.created ? { created: data.created } : {}) };
  try { storage()?.setItem(SESSION_KEY, JSON.stringify(session)); } catch { throw new Error('This browser would not keep the sign-in. Allow site data for Dushu and try again.'); }
  announce();
  return session;
}

/** Signs this device out (the other devices stay signed in). */
export async function signOut(): Promise<void> {
  const s = cloudSession();
  forgetSession();
  if (s) await post('/auth/signout', {}, s.token).then((r) => r.text(), () => '').catch(() => '');
}

/**
 * The signed-in account: its email, whether it is an owner's (remembered for isAccountOwner), and its Mac's private address
 * when a device on the Mac told it (cloudLink.ts).
 */
export async function accountInfo(): Promise<{ email: string; owner: boolean; mac?: string } | null> {
  const res = await cloudFetch('/me', { signal: AbortSignal.timeout(15_000) });
  if (!res) return null;
  if (res.status === 401) { forgetSession(); return null; }
  if (!res.ok) throw new Error(`The sync server answered ${res.status}.`);
  const data = await res.json() as { email?: unknown; owner?: unknown; mac?: unknown };
  const email = typeof data.email === 'string' ? data.email : '';
  const owner = data.owner === true;
  try {
    const was = isAccountOwner();
    if (owner) storage()?.setItem(OWNER_KEY, cloudSession()?.email ?? email); else storage()?.removeItem(OWNER_KEY);
    if (was !== owner) announce();
  } catch { /* asked again next time */ }
  return { email, owner, ...(typeof data.mac === 'string' ? { mac: data.mac } : {}) };
}

/** Whether the signed-in account is an owner's, as the server last said: someone else's sees no Mac or Claude settings. */
export function isAccountOwner(): boolean {
  const s = cloudSession();
  try { return !!s && storage()?.getItem(OWNER_KEY) === s.email; } catch { return false; }
}

/** Deletes the account on the server, then signs this device out. What is on this device stays on it. */
export async function deleteAccount(): Promise<void> {
  const s = cloudSession();
  if (!s) return;
  await (await post('/me/delete', {}, s.token)).text().catch(() => '');
  // What this device put in the old account says nothing about a new one made with the same email.
  for (const key of MARK_LISTS) {
    try {
      const list = JSON.parse(storage()?.getItem(key) ?? '[]') as unknown;
      if (Array.isArray(list)) storage()?.setItem(key, JSON.stringify(list.filter((m) => typeof m === 'string' && !m.startsWith(`${s.email}|`))));
    } catch { /* nothing kept */ }
  }
  forgetSession();
}

/** Tells the account where its Mac is, so the owner's other devices can reach it for their books. */
export async function shareMac(mac: string): Promise<void> {
  const s = cloudSession();
  if (s) await post('/me', { mac }, s.token);
}

/** fetch for a sync server path, signed in; null when this device is not signed in. */
export function cloudFetch(path: string, init: RequestInit = {}): Promise<Response> | null {
  const s = cloudSession();
  const base = cloudBase();
  if (!s || !base) return null;
  return fetch(`${base}${path}`, { ...init, credentials: 'omit', headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${s.token}` } });
}
