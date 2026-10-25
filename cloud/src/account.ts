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

/** A book kept in the account: a package the app made of the stored book (core/cloudBooks.ts), in BOOK_CHUNK pieces. */
export interface BookEntry {
  /** The book's sync key (core/syncKeys bookKey): the same book on every device. */
  key: string;
  title: string;
  author: string;
  /** Bytes in the package, and its SHA-256 (hex), so a device can check what it downloaded. */
  size: number;
  sha: string;
  chunks: number;
  addedAt: number;
  complete: boolean;
}

export const BOOK_CHUNK = 1024 * 1024;
export const BOOK_MAX_BYTES = 200 * 1024 * 1024;
export const ACCOUNT_BOOK_BYTES = 1024 * 1024 * 1024;
const BOOK_KEY = /^[A-Za-z0-9._-]{1,160}$/;

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
  books(): BookEntry[];
  putBook(entry: BookEntry): void;
  /** Removes the book and every piece of it. */
  dropBook(key: string): void;
  putChunk(key: string, index: number, data: Uint8Array): void;
  getChunk(key: string, index: number): Uint8Array | undefined;
  chunkCount(key: string): number;
}

export class CloudError extends Error {
  /** `code` says what kind of failure it is, for a client that treats some as lasting (src/translate/claude.ts). */
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); }
}

/** Claude through the account: requests and tokens per UTC day, against the limits the Worker passes in. */
export interface ClaudeUsage { day: string; requests: number; inputTokens: number; outputTokens: number }
export interface ClaudeLimits { requests: number; inputTokens: number }

export function claudeLimitMessage(u: ClaudeUsage, limits: ClaudeLimits): string | null {
  if (u.requests >= limits.requests) return `Today's Claude limit on your account (${limits.requests.toLocaleString('en-US')} requests) is used up. It resets at midnight (UTC).`;
  if (u.inputTokens >= limits.inputTokens) return `Today's Claude limit on your account (${limits.inputTokens.toLocaleString('en-US')} input tokens) is used up. It resets at midnight (UTC).`;
  return null;
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

  /** The books kept in the account (whole ones only). */
  listBooks(sessionHash: string, now: number): Omit<BookEntry, 'complete'>[] {
    this.authorize(sessionHash, now);
    return this.store.books().filter((b) => b.complete).map(({ complete: _c, ...b }) => { void _c; return b; });
  }

  /** Starts keeping a book (or a new copy of it): its pieces follow with putBookChunk. */
  startBook(sessionHash: string, input: Record<string, unknown>, now: number): { chunks: number } {
    this.authorize(sessionHash, now);
    const key = typeof input.key === 'string' ? input.key : '';
    const size = typeof input.size === 'number' && Number.isInteger(input.size) ? input.size : -1;
    const sha = typeof input.sha === 'string' && /^[0-9a-f]{64}$/.test(input.sha) ? input.sha : '';
    if (!BOOK_KEY.test(key) || !sha || size <= 0) throw new CloudError(400, 'That book could not be kept.');
    if (size > BOOK_MAX_BYTES) throw new CloudError(413, 'That book is too large to keep in your account.');
    const others = this.store.books().filter((b) => b.key !== key).reduce((n, b) => n + b.size, 0);
    if (others + size > ACCOUNT_BOOK_BYTES) throw new CloudError(413, 'Your account is full: it keeps up to 1 GB of books.');
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    this.store.dropBook(key);
    const chunks = Math.ceil(size / BOOK_CHUNK);
    this.store.putBook({ key, title: text(input.title, 200), author: text(input.author, 200), size, sha, chunks, addedAt: now, complete: false });
    return { chunks };
  }

  /** One piece of a book being kept. The book is whole once every piece is in. */
  putBookChunk(sessionHash: string, key: string, index: number, data: Uint8Array, now: number): { complete: boolean } {
    this.authorize(sessionHash, now);
    const book = this.store.books().find((b) => b.key === key);
    if (!book) throw new CloudError(404, 'Start keeping the book first.');
    const last = book.chunks - 1;
    const want = index === last ? book.size - BOOK_CHUNK * last : BOOK_CHUNK;
    if (!Number.isInteger(index) || index < 0 || index > last || data.byteLength !== want) throw new CloudError(400, 'That piece of the book is not the right size.');
    this.store.putChunk(key, index, data);
    const complete = this.store.chunkCount(key) === book.chunks;
    if (complete && !book.complete) this.store.putBook({ ...book, complete: true });
    return { complete };
  }

  getBookChunk(sessionHash: string, key: string, index: number, now: number): Uint8Array {
    this.authorize(sessionHash, now);
    const book = this.store.books().find((b) => b.key === key && b.complete);
    const data = book && Number.isInteger(index) ? this.store.getChunk(key, index) : undefined;
    if (!data) throw new CloudError(404, 'That book is not in your account.');
    return data;
  }

  dropBook(sessionHash: string, key: string, now: number): void {
    this.authorize(sessionHash, now);
    this.store.dropBook(key);
  }

  private claudeUsage(now: number): ClaudeUsage {
    const day = new Date(now).toISOString().slice(0, 10);
    try {
      const u = JSON.parse(this.store.getMeta('claude') ?? 'null') as ClaudeUsage | null;
      if (u && u.day === day) return u;
    } catch { /* a damaged count starts again */ }
    return { day, requests: 0, inputTokens: 0, outputTokens: 0 };
  }

  /** Today's Claude use and whether it is under the limits. */
  claudeStatus(sessionHash: string, limits: ClaudeLimits, now: number): { usage: ClaudeUsage; limitMessage: string | null } {
    this.authorize(sessionHash, now);
    const usage = this.claudeUsage(now);
    return { usage, limitMessage: claudeLimitMessage(usage, limits) };
  }

  /** Counts a Claude request before it is sent (so a failing client cannot loop past the cap), or refuses it over the limit. */
  claudeStart(sessionHash: string, limits: ClaudeLimits, now: number): void {
    this.authorize(sessionHash, now);
    const usage = this.claudeUsage(now);
    const limit = claudeLimitMessage(usage, limits);
    if (limit) throw new CloudError(429, limit, 'daily_limit');
    this.store.setMeta('claude', JSON.stringify({ ...usage, requests: usage.requests + 1 }));
  }

  /** Adds the tokens a finished request used. */
  claudeUsed(sessionHash: string, input: number, output: number, now: number): void {
    this.authorize(sessionHash, now);
    const usage = this.claudeUsage(now);
    const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
    this.store.setMeta('claude', JSON.stringify({ ...usage, inputTokens: usage.inputTokens + n(input), outputTokens: usage.outputTokens + n(output) }));
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
  const books = new Map<string, BookEntry>();
  const chunks = new Map<string, Uint8Array>();
  return {
    data,
    books: () => [...books.values()],
    putBook: (b) => { books.set(b.key, b); },
    dropBook: (key) => { books.delete(key); for (const k of [...chunks.keys()]) if (k.startsWith(`${key}\u0000`)) chunks.delete(k); },
    putChunk: (key, i, d) => { chunks.set(`${key}\u0000${i}`, d.slice()); },
    getChunk: (key, i) => chunks.get(`${key}\u0000${i}`),
    chunkCount: (key) => [...chunks.keys()].filter((k) => k.startsWith(`${key}\u0000`)).length,
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
