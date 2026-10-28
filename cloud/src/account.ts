// One sync account: its sign-in codes or passkeys, its signed-in devices and its records. The Worker (worker.ts) keeps one of
// these per email, or per account made with a passkey, in a Durable Object with its own SQLite database (sqlStore.ts); tests
// keep it in memory. Every method is synchronous over the store, so a Durable Object runs each one as a single transaction;
// the hashing and the passkey signatures are checked before.
import { countRecord, exchange, noCounts, type RecordTable, type SyncReply } from '../../src/core/syncExchange';

export const CODE_TTL_MS = 10 * 60_000;
export const CODE_GAP_MS = 30_000;
export const CODES_PER_HOUR = 5;
export const TRIES_PER_CODE = 5;
/** Wrong codes an account takes in a day, across all its codes: guessing six digits stays hopeless. */
export const WRONG_PER_DAY = 30;
export const SESSION_IDLE_MS = 365 * 86_400_000;
export const MAX_SESSIONS = 20;
const TOUCH_MS = 3_600_000;

export interface Session { created: number; used: number }

/** A passkey of the account: the credential's id and public key (COSE, base64url) as the device made it, for the page `rpID`. */
export interface PasskeyRecord { id: string; publicKey: string; counter: number; transports?: string[]; rpID: string; created: number; used?: number }
/** Passkeys an account keeps (each device that is not in the same iCloud or Google account adds its own). */
export const MAX_PASSKEYS = 10;
const B64URL = /^[A-Za-z0-9_-]+$/;

/** A device signed in: `email` is the account's email, or 'passkey:<account id>' for an account made with a passkey. */
export interface SignedIn { email: string; name?: string; created: string }

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
  /** Which upload the pieces belong to: a newer upload of the book (another device) refuses the older one's pieces. */
  upload?: string;
}

/** An upload left unfinished this long (a tab closed, a device that never came back) gives its space back. */
export const STALE_UPLOAD_MS = 86_400_000;
/** Words, places, settings and the rest an account keeps, in bytes of JSON: the owner's, and everyone else's. */
export const OWNER_RECORD_BYTES = 100 * 1024 * 1024;
export const SHARED_RECORD_BYTES = 20 * 1024 * 1024;

export const BOOK_CHUNK = 1024 * 1024;
export const BOOK_MAX_BYTES = 200 * 1024 * 1024;
/** Books an account keeps: the owner's, and everyone else's (the free plan stores 5 GB in all). */
export const ACCOUNT_BOOK_BYTES = 1024 * 1024 * 1024;
export const SHARED_BOOK_BYTES = 200 * 1024 * 1024;
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
  /** Bytes of JSON in the records. */
  recordBytes(): number;
  /** Forgets everything: the account deleted. */
  wipe(): void;
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

interface CodeState { hash: string; expires: number; tries: number; sent: number[]; wrong?: { day: string; n: number } }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A Mac's private address: https on a Tailscale name, an optional port, nothing else. */
export const MAC = /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.ts\.net(:\d{1,5})?$/;

/** An email as accounts are named by it, or null when it is not one. */
export function normalEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

const emails = (list: string | undefined) => (list ?? '').split(/[\s,]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

/** Whether `email` may sign in: anyone when the list is empty, else only the emails on it (comma or space separated). */
export function allowedEmail(email: string, list: string | undefined): boolean {
  const allowed = emails(list);
  return !allowed.length || allowed.includes(email);
}

/** Whether `email` is an owner of this Dushu (Claude on the owner's key, the larger shares). Nobody is when the list is empty. */
export function isOwner(email: string, owners: string | undefined): boolean {
  return !!email && emails(owners).includes(email);
}

/** What the owner's key pays for is the owner's alone. */
export const OWNER_ONLY_CLAUDE = 'Claude translation is only for the owner of this Dushu. The other translators work as usual.';

export class AccountCore {
  /** The owners' emails, as the Worker passes them with each request. */
  private owners = '';
  constructor(private readonly store: AccountStore) {}

  setOwners(owners: string): void { this.owners = owners; }

  /** Whether this account is an owner's. */
  owner(): boolean { return isOwner(this.store.getMeta('email') ?? '', this.owners); }

  private code(): CodeState | null {
    try { return JSON.parse(this.store.getMeta('code') ?? 'null') as CodeState | null; } catch { return null; }
  }

  /**
   * Whether a new code may be sent now: not when one still unused was sent just now, nor past the hourly limit. Asked before
   * the email goes out (checkCode), and again as the code is kept (storeCode). Returns the recent sends.
   */
  private codeAllowed(old: CodeState | null, now: number): number[] {
    const sent = (old?.sent ?? []).filter((t) => now - t < 3_600_000);
    // A code already used (another device signing in) does not make the next one wait.
    if (old?.hash && sent.length && now - sent[sent.length - 1] < CODE_GAP_MS) throw new CloudError(429, 'A code was just sent. Check your email, or wait half a minute for another.');
    if (sent.length >= CODES_PER_HOUR) throw new CloudError(429, 'Too many codes this hour. Try again later.');
    return sent;
  }

  /** Throws when no new code may be sent now (see codeAllowed). */
  checkCode(now: number): void {
    this.codeAllowed(this.code(), now);
  }

  /** Keeps a new sign-in code (its hash) for `email`, once its email has gone out. It replaces the one before. */
  storeCode(email: string, hash: string, now: number): void {
    const old = this.code();
    const sent = this.codeAllowed(old, now);
    this.store.setMeta('email', email);
    this.store.setMeta('code', JSON.stringify({ hash, expires: now + CODE_TTL_MS, tries: 0, sent: [...sent, now], ...(old?.wrong ? { wrong: old.wrong } : {}) } satisfies CodeState));
  }

  /**
   * Checks a code (its hash). Right: the code is used up and the device is signed in with `sessionHash`. `created` names this
   * account (it changes when the account is deleted and made again), so a device can tell the new one from the old.
   */
  verify(codeHash: string, sessionHash: string, now: number): SignedIn {
    const c = this.code();
    if (!c || !c.hash) throw new CloudError(400, 'Ask for a code first.');
    if (now > c.expires) throw new CloudError(400, 'That code has expired. Ask for a new one.');
    const day = new Date(now).toISOString().slice(0, 10);
    const wrong = c.wrong?.day === day ? c.wrong.n : 0;
    if (wrong >= WRONG_PER_DAY) throw new CloudError(429, 'Too many wrong codes today. Try again tomorrow.');
    if (c.hash !== codeHash) {
      const tries = c.tries + 1;
      this.store.setMeta('code', JSON.stringify({ ...c, tries, wrong: { day, n: wrong + 1 }, ...(tries >= TRIES_PER_CODE ? { hash: '' } : {}) }));
      throw new CloudError(400, tries >= TRIES_PER_CODE ? 'Too many wrong tries. Ask for a new code.' : 'That code is not right. Check the newest email.');
    }
    this.store.setMeta('code', JSON.stringify({ ...c, hash: '' }));
    return this.addSession(sessionHash, now);
  }

  /**
   * Signs in the owner's Mac, with no code (worker.ts has checked the Mac's key): a session like a device's, which the Mac
   * uses to put the books in its book folder in the account. Only an owner's account that exists can have one.
   */
  macSession(sessionHash: string, now: number): SignedIn {
    if (!this.store.getMeta('email') || !this.owner()) throw new CloudError(403, 'Only the owner’s account can link a Mac.');
    return this.addSession(sessionHash, now);
  }

  /** The account's email, or 'passkey:<its id>' for one made with a passkey: what a device names it by. */
  private naming(): string {
    const email = this.store.getMeta('email');
    if (email) return email;
    const id = this.store.getMeta('id');
    return id ? `passkey:${id}` : '';
  }

  private passkeys(): PasskeyRecord[] {
    try { const list = JSON.parse(this.store.getMeta('passkeys') ?? '[]') as unknown; return Array.isArray(list) ? list as PasskeyRecord[] : []; } catch { return []; }
  }

  /** A passkey as the Worker checked it, or a 400: only the fields a sign-in needs, within bounds. */
  private static passkey(input: unknown, now: number): PasskeyRecord {
    const k = (input ?? {}) as Record<string, unknown>;
    const id = typeof k.id === 'string' && k.id.length <= 1400 && B64URL.test(k.id) ? k.id : '';
    const publicKey = typeof k.publicKey === 'string' && k.publicKey.length <= 2000 && B64URL.test(k.publicKey) ? k.publicKey : '';
    const rpID = typeof k.rpID === 'string' && /^[a-z0-9.-]{1,253}$/.test(k.rpID) ? k.rpID : '';
    if (!id || !publicKey || !rpID) throw new CloudError(400, 'That passkey could not be kept.');
    const transports = Array.isArray(k.transports) ? k.transports.filter((t): t is string => typeof t === 'string' && /^[a-z-]{1,20}$/.test(t)).slice(0, 8) : undefined;
    return { id, publicKey, counter: Number(k.counter) >= 0 ? Number(k.counter) : 0, rpID, created: now, ...(transports?.length ? { transports } : {}) };
  }

  /**
   * Makes this account with a passkey (an invite's join, the invite already counted): its name, its first passkey, and the
   * device's session. `id` is the account's own Durable Object id: the passkey's user handle, so a sign-in finds it.
   */
  createWithPasskey(id: string, name: string, key: unknown, sessionHash: string, now: number): SignedIn {
    if (this.store.getMeta('created') || this.store.getMeta('email') || this.passkeys().length) throw new CloudError(409, 'That account already exists.');
    if (!/^[0-9a-f]{64}$/.test(id)) throw new CloudError(400, 'That account could not be made.');
    this.store.setMeta('id', id);
    this.store.setMeta('name', name);
    this.store.setMeta('passkeys', JSON.stringify([AccountCore.passkey(key, now)]));
    return this.addSession(sessionHash, now);
  }

  /** The passkey with this id, for the Worker to check a sign-in against; null when the account has none (or is gone). */
  passkeyFor(id: string): PasskeyRecord | null {
    return this.passkeys().find((k) => k.id === id) ?? null;
  }

  /** Signs in with a passkey whose signature the Worker has checked: its counter moves on and the device gets a session. */
  passkeySignIn(id: string, counter: number, sessionHash: string, now: number): SignedIn {
    const list = this.passkeys();
    const k = list.find((p) => p.id === id);
    if (!k) throw new CloudError(401, 'This passkey’s account was deleted.', 'no_account');
    k.counter = Number.isFinite(counter) && counter >= 0 ? counter : k.counter;
    k.used = now;
    this.store.setMeta('passkeys', JSON.stringify(list));
    return this.addSession(sessionHash, now);
  }

  /** Adds a passkey to the signed-in account: the owner's email account, or a friend's on a device outside their passkey sync. */
  addPasskey(sessionHash: string, key: unknown, now: number): void {
    this.authorize(sessionHash, now);
    const k = AccountCore.passkey(key, now);
    const list = this.passkeys().filter((p) => p.id !== k.id);
    if (list.length >= MAX_PASSKEYS) throw new CloudError(400, `An account keeps ${MAX_PASSKEYS} passkeys at most.`);
    this.store.setMeta('passkeys', JSON.stringify([...list, k]));
  }

  /** What a new passkey for the signed-in account is labeled with, and the ids it has (not to make one twice on a device). */
  passkeyLabel(sessionHash: string, now: number): { name: string; ids: string[] } {
    this.authorize(sessionHash, now);
    return { name: this.store.getMeta('name') || this.store.getMeta('email') || 'Dushu', ids: this.passkeys().map((k) => k.id) };
  }

  private addSession(sessionHash: string, now: number): SignedIn {
    // Devices signed in long ago and never since are signed out; past the limit, the one used least recently is.
    const live = this.store.sessions().filter((s) => {
      if (now - s.used <= SESSION_IDLE_MS) return true;
      this.store.dropSession(s.hash);
      return false;
    }).sort((a, b) => a.used - b.used);
    for (const s of live.slice(0, Math.max(0, live.length - MAX_SESSIONS + 1))) this.store.dropSession(s.hash);
    this.store.putSession(sessionHash, { created: now, used: now });
    let created = this.store.getMeta('created');
    if (!created) { created = String(now); this.store.setMeta('created', created); }
    const name = this.store.getMeta('name');
    return { email: this.naming(), ...(name ? { name } : {}), created };
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
  me(sessionHash: string, now: number): { email: string; name?: string; owner: boolean; passkeys: number; mac?: string } {
    this.authorize(sessionHash, now);
    const mac = this.store.getMeta('mac');
    const name = this.store.getMeta('name');
    return { email: this.naming(), ...(name ? { name } : {}), owner: this.owner(), passkeys: this.passkeys().length, ...(mac ? { mac } : {}) };
  }

  /** Deletes the account: its records, books, devices, passkeys and email. Signing in again starts a new, empty one. */
  deleteAccount(sessionHash: string, now: number): void {
    this.authorize(sessionHash, now);
    this.store.wipe();
  }

  /**
   * Remembers the owner's Mac (its private Tailscale address); only a Tailscale https origin is kept, and only in an owner's
   * account (someone else signing in on the owner's Mac must not take its address away with them).
   */
  setMac(sessionHash: string, mac: string, now: number): ReturnType<AccountCore['me']> {
    this.authorize(sessionHash, now);
    if (!this.owner()) throw new CloudError(403, 'Only the owner’s account keeps the Mac’s address.');
    if (!MAC.test(mac)) throw new CloudError(400, 'That is not a Mac address Dushu can use.');
    this.store.setMeta('mac', mac);
    return this.me(sessionHash, now);
  }

  signOut(sessionHash: string): void {
    this.store.dropSession(sessionHash);
  }

  /** The books kept in the account (whole ones only), and with `covers` the covers the owner's Mac put there (keys c…). */
  listBooks(sessionHash: string, now: number, covers = false): Omit<BookEntry, 'complete'>[] {
    this.authorize(sessionHash, now);
    return this.store.books().filter((b) => b.complete && (covers || !b.key.startsWith('c'))).map(({ complete: _c, ...b }) => { void _c; return b; });
  }

  /**
   * Starts keeping a book (or a new copy of it): its pieces follow with putBookChunk, naming the upload. The same package
   * (same size and SHA-256, as two devices make of one book) already kept is not sent again (`complete`), and one being sent
   * goes on under its upload, so two devices sending a book at once send it once. A different package starts a new upload,
   * and the older one's pieces are refused.
   */
  startBook(sessionHash: string, input: Record<string, unknown>, now: number): { chunks: number; upload: string; complete?: true } {
    this.authorize(sessionHash, now);
    const key = typeof input.key === 'string' ? input.key : '';
    const size = typeof input.size === 'number' && Number.isInteger(input.size) ? input.size : -1;
    const sha = typeof input.sha === 'string' && /^[0-9a-f]{64}$/.test(input.sha) ? input.sha : '';
    if (!BOOK_KEY.test(key) || !sha || size <= 0) throw new CloudError(400, 'That book could not be kept.');
    if (size > BOOK_MAX_BYTES) throw new CloudError(413, 'That book is too large to keep in your account.');
    const chunks = Math.ceil(size / BOOK_CHUNK);
    const same = this.store.books().find((b) => b.key === key && b.sha === sha && b.size === size);
    if (same?.upload) return { chunks, upload: same.upload, ...(same.complete ? { complete: true as const } : {}) };
    // An upload of another book left unfinished for a day gives its space back.
    for (const b of this.store.books()) if (b.key !== key && !b.complete && now - b.addedAt > STALE_UPLOAD_MS) this.store.dropBook(b.key);
    const others = this.store.books().filter((b) => b.key !== key).reduce((n, b) => n + b.size, 0);
    const room = this.owner() ? ACCOUNT_BOOK_BYTES : SHARED_BOOK_BYTES;
    if (others + size > room) throw new CloudError(413, `Your account is full: it keeps up to ${room >= 1024 ** 3 ? `${room / 1024 ** 3} GB` : `${room / 1024 ** 2} MB`} of books. Delete a book to make room.`);
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    this.store.dropBook(key);
    const upload = crypto.randomUUID();
    this.store.putBook({ key, title: text(input.title, 200), author: text(input.author, 200), size, sha, chunks, addedAt: now, complete: false, upload });
    return { chunks, upload };
  }

  /**
   * One piece of a book being kept, for `upload` (startBook). The book is whole once every piece is in. A piece of an upload a
   * newer one replaced is refused (409). An app from before uploads had names sends none: its pieces are taken as before.
   */
  putBookChunk(sessionHash: string, key: string, index: number, data: Uint8Array, now: number, upload = ''): { complete: boolean } {
    this.authorize(sessionHash, now);
    const book = this.store.books().find((b) => b.key === key);
    if (!book) throw new CloudError(404, 'Start keeping the book first.');
    if (upload && book.upload && upload !== book.upload) throw new CloudError(409, 'A newer copy of this book is being saved.', 'superseded');
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
  claudeStatus(sessionHash: string, limits: ClaudeLimits, now: number): { usage: ClaudeUsage; limitMessage: string | null; owner: boolean } {
    this.authorize(sessionHash, now);
    const usage = this.claudeUsage(now);
    return { usage, limitMessage: claudeLimitMessage(usage, limits), owner: this.owner() };
  }

  /** Counts a Claude request before it is sent (so a failing client cannot loop past the cap), or refuses it over the limit. */
  claudeStart(sessionHash: string, limits: ClaudeLimits, now: number): void {
    this.authorize(sessionHash, now);
    if (!this.owner()) throw new CloudError(403, OWNER_ONLY_CLAUDE, 'not_owner');
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

  /**
   * Before a sentence is read aloud: whether this is the owner's account. The Worker counts the characters in the Limits
   * object (the account's day and the shared day), where deleting the account does not reset them.
   */
  speechStart(sessionHash: string, now: number): { owner: boolean } {
    this.authorize(sessionHash, now);
    return { owner: this.owner() };
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
    // An account keeps so much (more for the owner): changes that would grow it past that are refused, ones that shrink it never.
    const room = this.owner() ? OWNER_RECORD_BYTES : SHARED_RECORD_BYTES;
    if (Array.isArray(input.changes) && input.changes.length) {
      const size = (data: unknown) => (data === null || data === undefined ? 0 : JSON.stringify(data).length);
      let grow = 0;
      for (const c of input.changes as { key?: unknown; data?: unknown }[]) {
        if (!c || typeof c.key !== 'string') continue;
        grow += size(c.data) - size(table.get(c.key)?.data);
      }
      if (grow > 0 && this.store.recordBytes() + grow > room) {
        throw new CloudError(413, `Your account is full: it keeps up to ${room / 1024 / 1024} MB of words, places and settings.`, 'full');
      }
    }
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
    recordBytes: () => [...data.values()].reduce((n, r) => n + (r.data === null ? 0 : JSON.stringify(r.data).length), 0),
    wipe: () => { meta.clear(); sessions.clear(); data.clear(); books.clear(); chunks.clear(); },
  };
}

// ------------------------------------------------------------------ shared ---

/**
 * What every account shares, kept by one Durable Object: today's counts (the free allowances, sign-ins from one network), the
 * passkey challenges waiting for an answer, and the owner's invites.
 */
export interface LimitsStore {
  get(day: string, name: string): number;
  set(day: string, name: string, n: number): void;
  /** Forgets the days before `day`. */
  prune(day: string): void;
  /** Small values by kind ('challenge', 'invite') and key; null removes one. */
  item(kind: string, key: string): string | undefined;
  putItem(kind: string, key: string, value: string | null): void;
  items(kind: string): { key: string; value: string }[];
}

export interface Take { name: string; n: number; max: number }

/** A challenge is answered within this long, once. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
/** An invite link the owner made: who it is for, how many accounts it may make, and how many it has. */
export interface Invite { token: string; label: string; max: number; uses: number; created: number; revoked?: boolean }
export const MAX_INVITE_USES = 500;
const INVITE = /^[A-Za-z0-9_-]{16,64}$/;

export class LimitsCore {
  constructor(private readonly store: LimitsStore) {}

  /** Keeps a passkey challenge and what it was for, to be taken once within CHALLENGE_TTL_MS. */
  putChallenge(challenge: string, payload: unknown, now: number): void {
    for (const { key, value } of this.store.items('challenge')) {
      try { if ((JSON.parse(value) as { expires: number }).expires < now) this.store.putItem('challenge', key, null); } catch { this.store.putItem('challenge', key, null); }
    }
    this.store.putItem('challenge', challenge, JSON.stringify({ payload, expires: now + CHALLENGE_TTL_MS }));
  }

  /** What a challenge was for, once: taking it removes it. Null when there is none, or it is too old. */
  takeChallenge(challenge: string, now: number): unknown {
    const value = this.store.item('challenge', challenge);
    if (value === undefined) return null;
    this.store.putItem('challenge', challenge, null);
    try {
      const { payload, expires } = JSON.parse(value) as { payload: unknown; expires: number };
      return expires >= now ? payload : null;
    } catch { return null; }
  }

  createInvite(token: string, label: string, max: number, now: number): Invite {
    if (!INVITE.test(token)) throw new CloudError(400, 'That invite could not be made.');
    const invite: Invite = { token, label: label.trim().slice(0, 60) || 'Invite', max: Math.min(MAX_INVITE_USES, Math.max(1, Math.floor(max) || 1)), uses: 0, created: now };
    this.store.putItem('invite', token, JSON.stringify(invite));
    return invite;
  }

  invites(): Invite[] {
    return this.store.items('invite').map(({ value }) => JSON.parse(value) as Invite).filter((i) => !i.revoked).sort((a, b) => b.created - a.created);
  }

  /** An invite that can still make an account, or null. */
  invite(token: string): Invite | null {
    if (!INVITE.test(token)) return null;
    const value = this.store.item('invite', token);
    const invite = value ? JSON.parse(value) as Invite : null;
    return invite && !invite.revoked && invite.uses < invite.max ? invite : null;
  }

  /** Counts an account made with the invite; false when it cannot make another. */
  useInvite(token: string): boolean {
    const invite = this.invite(token);
    if (!invite) return false;
    this.store.putItem('invite', token, JSON.stringify({ ...invite, uses: invite.uses + 1 }));
    return true;
  }

  /** Stops an invite making accounts (the ones it made stay). */
  revokeInvite(token: string): void {
    const value = INVITE.test(token) ? this.store.item('invite', token) : undefined;
    if (value) this.store.putItem('invite', token, JSON.stringify({ ...JSON.parse(value) as Invite, revoked: true }));
  }

  /** Adds each `n` to today's count of its `name`, or nothing at all (false) when any would pass its `max`. */
  take(items: Take[], now: number): boolean {
    const day = new Date(now).toISOString().slice(0, 10);
    const have = items.map((t) => this.store.get(day, t.name));
    if (items.some((t, i) => !(t.n >= 0) || have[i] + t.n > t.max)) return false;
    items.forEach((t, i) => this.store.set(day, t.name, have[i] + t.n));
    this.store.prune(new Date(now - 7 * 86_400_000).toISOString().slice(0, 10));
    return true;
  }
}

export function memoryLimits(): LimitsStore {
  const m = new Map<string, number>();
  const items = new Map<string, string>();
  return {
    get: (day, name) => m.get(`${day}|${name}`) ?? 0,
    set: (day, name, n) => { m.set(`${day}|${name}`, n); },
    prune: (day) => { for (const k of [...m.keys()]) if (k.slice(0, 10) < day) m.delete(k); },
    item: (kind, key) => items.get(`${kind}|${key}`),
    putItem: (kind, key, value) => { if (value === null) items.delete(`${kind}|${key}`); else items.set(`${kind}|${key}`, value); },
    items: (kind) => [...items].filter(([k]) => k.startsWith(`${kind}|`)).map(([k, value]) => ({ key: k.slice(kind.length + 1), value })),
  };
}
