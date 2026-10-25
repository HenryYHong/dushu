// One sync account: its sign-in codes, its signed-in devices and its records. The Worker (worker.ts) keeps one of these per
// email in a Durable Object with its own SQLite database (sqlStore.ts); tests keep it in memory. Every method is
// synchronous over the store, so a Durable Object runs each one as a single transaction; the hashing is done before.
import { countRecord, exchange, noCounts, type RecordTable, type SyncReply } from '../../src/core/syncExchange';

export const CODE_TTL_MS = 10 * 60_000;
export const CODE_GAP_MS = 30_000;
export const CODES_PER_HOUR = 5;
export const TRIES_PER_CODE = 5;
export const SESSION_IDLE_MS = 365 * 86_400_000;
export const MAX_SESSIONS = 20;
const TOUCH_MS = 3_600_000;

export interface Session { created: number; used: number }

/** Where an account keeps its state. */
export interface AccountStore {
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string | null): void;
  /** The account's records; `epoch` and `version` as the meta last saved them. */
  records(epoch: string, version: number): RecordTable;
  getSession(hash: string): Session | undefined;
  putSession(hash: string, session: Session): void;
  dropSession(hash: string): void;
  sessions(): { hash: string; used: number }[];
}

export class CloudError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface CodeState { hash: string; expires: number; tries: number; sent: number[] }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A Mac's private address: https on a Tailscale name, an optional port, nothing else. */
export const MAC = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.ts\.net(:\d{1,5})?$/;

/** An email as accounts are named by it, or null when it is not one. */
export function normalEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** Whether `email` may sign in: anyone when the list is empty, else only the emails on it (comma or space separated). */
export function allowedEmail(email: string, list: string | undefined): boolean {
  const allowed = (list ?? '').split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !allowed.length || allowed.includes(email);
}

export class AccountCore {
  constructor(private readonly store: AccountStore) {}

  private code(): CodeState | null {
    try { return JSON.parse(this.store.getMeta('code') ?? 'null') as CodeState | null; } catch { return null; }
  }

  /** Keeps a new sign-in code (its hash) for `email`, unless one was asked for just now or too many this hour. */
  storeCode(email: string, hash: string, now: number): void {
    const old = this.code();
    const sent = (old?.sent ?? []).filter((t) => now - t < 3_600_000);
    if (sent.length && now - sent[sent.length - 1] < CODE_GAP_MS) throw new CloudError(429, 'A code was just sent. Check your email, or wait half a minute for another.');
    if (sent.length >= CODES_PER_HOUR) throw new CloudError(429, 'Too many codes this hour. Try again later.');
    this.store.setMeta('email', email);
    this.store.setMeta('code', JSON.stringify({ hash, expires: now + CODE_TTL_MS, tries: 0, sent: [...sent, now] } satisfies CodeState));
  }

  /** Checks a code (its hash). Right: the code is used up and the device is signed in with `sessionHash`. */
  verify(codeHash: string, sessionHash: string, now: number): { email: string } {
    const c = this.code();
    if (!c || !c.hash) throw new CloudError(400, 'Ask for a code first.');
    if (now > c.expires) throw new CloudError(400, 'That code has expired. Ask for a new one.');
    if (c.hash !== codeHash) {
      const tries = c.tries + 1;
      this.store.setMeta('code', JSON.stringify({ ...c, tries, ...(tries >= TRIES_PER_CODE ? { hash: '' } : {}) }));
      throw new CloudError(400, tries >= TRIES_PER_CODE ? 'Too many wrong tries. Ask for a new code.' : 'That code is not right. Check the newest email.');
    }
    this.store.setMeta('code', JSON.stringify({ ...c, hash: '' }));
    // Devices signed in long ago and never since are signed out; past the limit, the one used least recently is.
    const live = this.store.sessions().filter((s) => {
      if (now - s.used <= SESSION_IDLE_MS) return true;
      this.store.dropSession(s.hash);
      return false;
    }).sort((a, b) => a.used - b.used);
    for (const s of live.slice(0, Math.max(0, live.length - MAX_SESSIONS + 1))) this.store.dropSession(s.hash);
    this.store.putSession(sessionHash, { created: now, used: now });
    return { email: this.store.getMeta('email') ?? '' };
  }

  /** The signed-in device's session, or a 401. */
  authorize(sessionHash: string, now: number): void {
    const s = this.store.getSession(sessionHash);
    if (!s || now - s.used > SESSION_IDLE_MS) {
      if (s) this.store.dropSession(sessionHash);
      throw new CloudError(401, 'This device is signed out of sync. Sign in again in Settings.');
    }
    if (now - s.used > TOUCH_MS) this.store.putSession(sessionHash, { ...s, used: now });
  }

  /** Who is signed in, and the address of their Mac when a device on it said (so other devices can reach it for books). */
  me(sessionHash: string, now: number): { email: string; mac?: string } {
    this.authorize(sessionHash, now);
    const mac = this.store.getMeta('mac');
    return { email: this.store.getMeta('email') ?? '', ...(mac ? { mac } : {}) };
  }

  /** Remembers the owner's Mac (its private Tailscale address); only a Tailscale https origin is kept. */
  setMac(sessionHash: string, mac: string, now: number): { email: string; mac?: string } {
    this.authorize(sessionHash, now);
    if (!MAC.test(mac)) throw new CloudError(400, 'That is not a Mac address Dushu can use.');
    this.store.setMeta('mac', mac);
    return this.me(sessionHash, now);
  }

  signOut(sessionHash: string): void {
    this.store.dropSession(sessionHash);
  }

  private table(): RecordTable {
    let epoch = this.store.getMeta('epoch');
    if (!epoch) {
      epoch = crypto.randomUUID();
      this.store.setMeta('epoch', epoch);
    }
    return this.store.records(epoch, Number(this.store.getMeta('version') ?? 0) || 0);
  }

  sync(sessionHash: string, input: { epoch?: unknown; since?: unknown; changes?: unknown }, now: number): SyncReply {
    this.authorize(sessionHash, now);
    const table = this.table();
    const { reply, changed } = exchange(table, input, now);
    if (changed) this.store.setMeta('version', String(table.version));
    return reply;
  }

  status(sessionHash: string, now: number): Omit<SyncReply, 'records'> {
    this.authorize(sessionHash, now);
    const table = this.table();
    return { epoch: table.epoch, version: table.version, counts: table.counts() };
  }
}

/** An account kept in memory, for tests. */
export function memoryStore(): AccountStore & { data: Map<string, { at: number; data: unknown; rev: number }> } {
  const meta = new Map<string, string>();
  const sessions = new Map<string, Session>();
  const data = new Map<string, { at: number; data: unknown; rev: number }>();
  return {
    data,
    getMeta: (k) => meta.get(k),
    setMeta: (k, v) => { if (v === null) meta.delete(k); else meta.set(k, v); },
    records: (epoch, version) => ({
      epoch,
      version,
      get: (key) => data.get(key),
      put: (key, r) => { data.set(key, r); },
      changed: (since, also) => [...data].filter(([k, r]) => r.rev > since || also.has(k)).map(([key, r]) => ({ key, at: r.at, data: r.data })),
      counts: () => {
        const c = noCounts();
        for (const [k, r] of data) countRecord(c, k, r.data);
        return c;
      },
    }),
    getSession: (h) => sessions.get(h),
    putSession: (h, s) => { sessions.set(h, s); },
    dropSession: (h) => { sessions.delete(h); },
    sessions: () => [...sessions].map(([hash, s]) => ({ hash, used: s.used })),
  };
}
