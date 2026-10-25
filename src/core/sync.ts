// Keeps saved words, known words, reading places, looked-up words and bookmarks the same on every device the owner connects
// to their Mac, or signs in to their sync account online (core/cloud.ts) with. A device signed in syncs with the account;
// the account and the Mac merge the same way (core/syncExchange.ts), so the rest of this file does not tell them apart.
// The Mac holds the shared copy (scripts/sync-bridge.ts). Each device keeps one row per record in the store's sync table
// saying what it last agreed on with the Mac, so it can tell its own changes (sent with the time they happened) from the
// Mac's (applied when newer). Those rows live in the same database as the data: a wipe or an eviction clears both, so a
// device that lost its data looks new and only receives; it never tells the Mac its words were deleted.
import type { Bookmark, BookMeta, LookupRow, Progress, Store, SyncRow, VocabItem } from '../types';
import { cleanBookmark, cleanLookup, cleanProgress, cleanVocab } from '../store';
import { moveByPercent } from './place';
import { BRIDGE_EVENT, bridgeBase, bridgeFetch, hasMacBridge } from './macBridge';
import { CLOUD_EVENT, cloudFetch, cloudSession, forgetSession } from './cloud';
import { bookKey, canonical, hash, lookupKey, mergeLookups, olderKeys, parseLookupKey, progressWire } from './syncKeys';

export { bookKey, canonical, hash };

/** Fired on window when the sync status changes (Settings shows it). */
export const SYNC_EVENT = 'dushu:sync';
/** Fired on window with `{ bookId, progress }` when another device's reading place was saved here. */
export const REMOTE_PROGRESS_EVENT = 'dushu:remote-progress';

const OFF_KEY = 'dushu.sync.off.v1';
/** The accounts each Mac's records were copied into (copyMacIntoAccount), as 'email|mac origin'. */
const COPIED_KEY = 'dushu.cloud.mac-copied.v1';
/** A copy that failed (the Mac asleep, Tailscale off) is tried again after this long, never on every sync. */
const COPY_RETRY_MS = 5 * 60_000;
const META = '#meta';
/** Records per request; a new device's first sync sends its words in pieces. */
const CHUNK = 1000;
const MAX_KEY = 160;

export type SyncState = 'off' | 'none' | 'idle' | 'syncing' | 'asleep' | 'refused' | 'signedout' | 'error' | 'memory';
export interface SyncStatus {
  state: SyncState;
  /** What this device syncs with: the sync account online, or the Mac. */
  hub?: 'cloud' | 'mac';
  /** When this device last finished a sync with the Mac. */
  lastOk?: number;
  /** Changes made here that the Mac has not received yet. */
  pending: number;
  /** What the Mac holds, from its last answer. */
  counts?: { words: number; known: number; places: number; lookups?: number; bookmarks?: number };
  message?: string;
}

interface WireRecord { key: string; at: number; data: unknown }
interface Reply { epoch: string; version: number; records: WireRecord[]; counts?: SyncStatus['counts'] }
interface Meta { epoch?: string; cursor: number }

// ------------------------------------------------------------------ keys ---

const sigOf = (data: unknown) => (data === null ? '-' : hash(canonical(data)));
/**
 * A saved word's signature without its book. Deleting the book here, or importing it again under a new key, changes only
 * the book a word names, which is not a change to the word: compared with the row's `bare`, it is never sent stamped now.
 */
const bareOf = (wire: VocabItem) => sigOf(wire.context?.bookId === undefined ? wire : { ...wire, context: { ...wire.context, bookId: undefined } });

// ------------------------------------------------------------- records ---

interface Books {
  keyOf: Map<string, string>;
  idOf: Map<string, string>;
  /** An older importer's key for a book here, to that book's id (olderKeys). */
  newer: Map<string, string>;
}

/** A saved word as it travels: its book is named by book key, so another device can find its own copy. */
function vocabWire(item: VocabItem, books: Books): VocabItem {
  if (!item.context?.bookId) return item;
  return { ...item, context: { ...item.context, bookId: books.keyOf.get(item.context.bookId) ?? item.context.bookId } };
}
function vocabLocal(item: VocabItem, books: Books): VocabItem {
  if (!item.context?.bookId) return item;
  return { ...item, context: { ...item.context, bookId: books.idOf.get(item.context.bookId) ?? item.context.bookId } };
}

/** A looked-up word as it travels: its day and word are in its key, its book is named by book key. */
function lookupWire(r: LookupRow, books: Books): Omit<LookupRow, 'day' | 'id'> {
  const { day: _d, id: _i, ...rest } = r;
  void _d; void _i;
  if (!rest.context?.bookId) return rest;
  return { ...rest, context: { ...rest.context, bookId: books.keyOf.get(rest.context.bookId) ?? rest.context.bookId } };
}
function lookupLocal(key: string, data: unknown, books: Books): LookupRow | null {
  const at = parseLookupKey(key);
  const r = at && cleanLookup({ ...(data as object), ...at });
  if (!r) return null;
  if (r.context?.bookId) r.context = { ...r.context, bookId: books.idOf.get(r.context.bookId) ?? r.context.bookId };
  return r;
}

/** A bookmark as it travels: its id is in its key, its book is named by book key (kept on the bookmark, so deleting the
 * book here changes nothing). */
function bookmarkWire(b: Bookmark, books: Books): { book: string; chapter: number; block: number; offset: number; label: string; createdAt: number } {
  return { book: b.bookKey ?? books.keyOf.get(b.bookId) ?? b.bookId, chapter: b.chapter, block: b.block, offset: b.offset, label: b.label, createdAt: b.createdAt };
}
function bookmarkLocal(id: string, data: unknown, books: Books): Bookmark | null {
  const book = (data as { book?: unknown }).book;
  if (typeof book !== 'string' || !book) return null;
  return cleanBookmark({ ...(data as object), id, bookKey: book, bookId: books.idOf.get(book) ?? books.newer.get(book) ?? book });
}

/** Everything this device would send, by record key, with the time each record says it last changed. */
type Snapshot = Map<string, { data: unknown; sig: string; at: number; bare?: string }>;
async function snapshot(store: Store, books: Books, rows: Map<string, SyncRow>): Promise<Snapshot> {
  const out: Snapshot = new Map();
  const put = (key: string, data: unknown, at: number, bare?: string) => {
    if (key.length <= MAX_KEY) out.set(key, { data, sig: sigOf(data), at, ...(bare ? { bare } : {}) });
  };
  for (const item of await store.vocab.list()) {
    const wire = vocabWire(item, books);
    put(`v:${item.id}`, wire, Math.max(item.srs?.last ?? 0, item.addedAt ?? 0), bareOf(wire));
  }
  for (const word of store.known.all()) put(`k:${word}`, store.known.isAuto(word) ? { a: 1 } : {}, 0);
  for (const r of await store.lookups.list()) put(lookupKey(r.day, r.id), lookupWire(r, books), r.last);
  for (const b of await store.bookmarks.list()) put(`b:${b.id}`, bookmarkWire(b, books), b.createdAt);
  for (const [id, key] of books.keyOf) {
    const p = await store.progress.get(id);
    if (p) put(`p:${key}`, progressWire(p), p.updatedAt);
  }
  // A place kept for a book that is not here (deleted here, or sent before the book arrived) is still sent: a place read
  // here and deleted before the Mac heard of it reaches the Mac all the same.
  for (const row of rows.values()) {
    if (!row.key.startsWith('p:') || row.held === undefined || out.has(row.key)) continue;
    const at = (row.held as { updatedAt?: unknown }).updatedAt;
    put(row.key, row.held, typeof at === 'number' && Number.isFinite(at) ? at : row.at);
  }
  return out;
}

// ------------------------------------------------------- Mac to account ---

let copying: Promise<boolean> | null = null;
let copyFailedAt = 0;

/**
 * Once per account and Mac: everything the Mac holds (the words, places, lookups and bookmarks of every device that synced
 * through it) goes into the account, each record with the time it changed. The account's merge keeps whichever copy is newer,
 * so this never undoes a change made since. Resolves true when it copied (the caller syncs again to take the records).
 */
export function copyMacIntoAccount(now = Date.now()): Promise<boolean> {
  const s = cloudSession();
  const base = bridgeBase();
  if (!s || base === null || copying || now - copyFailedAt < COPY_RETRY_MS) return copying ?? Promise.resolve(false);
  const mark = `${s.email}|${base || globalThis.location?.origin}`;
  let done: string[] = [];
  try { done = JSON.parse(globalThis.localStorage?.getItem(COPIED_KEY) ?? '[]') as string[]; } catch { /* none yet */ }
  if (!Array.isArray(done)) done = [];
  if (done.includes(mark)) return Promise.resolve(false);
  const json = { 'Content-Type': 'application/json' };
  copying = (async () => {
    try {
      const res = await bridgeFetch('/api/sync', { method: 'POST', headers: json, body: JSON.stringify({ since: 0, changes: [] }), signal: AbortSignal.timeout(20_000) });
      if (res.status === 503) return false; // a Mac without its sync folder holds nothing to copy
      if (!res.ok) throw new Error(`The Mac answered ${res.status}`);
      const reply = await res.json() as Partial<Reply>;
      const records = Array.isArray(reply.records) ? reply.records : [];
      for (let i = 0; i < records.length; i += CHUNK) {
        const r = await cloudFetch('/sync', { method: 'POST', headers: json, body: JSON.stringify({ changes: records.slice(i, i + CHUNK) }), signal: AbortSignal.timeout(20_000) });
        if (!r?.ok) throw new Error(`The sync server answered ${r?.status}`);
      }
      try { globalThis.localStorage?.setItem(COPIED_KEY, JSON.stringify([...done, mark])); } catch { /* copied again next time: harmless */ }
      return records.length > 0;
    } catch {
      copyFailedAt = now;
      return false;
    } finally { copying = null; }
  })();
  return copying;
}

// ----------------------------------------------------------------- sync ---

export interface Syncer {
  /** Sync now (or right after the sync that is running). Resolves when done; never rejects. */
  run(): Promise<void>;
  /** Sync soon: several changes in a row make one sync. */
  soon(ms?: number): void;
  status(): SyncStatus;
  stop(): void;
}

export function syncEnabled(): boolean {
  try { return globalThis.localStorage?.getItem(OFF_KEY) !== '1'; } catch { return true; }
}
export function setSyncEnabled(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.removeItem(OFF_KEY);
    else globalThis.localStorage?.setItem(OFF_KEY, '1');
  } catch { /* storage blocked: stays as it was */ }
  if (on) void active?.run();
  else active?.soon(0);
}

let active: Syncer | null = null;

/** The running syncer (main.ts starts it), or null. */
export function currentSyncer(): Syncer | null { return active; }

/** Whether this device has anything to sync with: signed in, or connected to the Mac. */
export function hasSyncHub(): boolean {
  return !!cloudSession() || hasMacBridge();
}

/** Before a book opens: a quick sync so the place read on another device is here. Waits at most `ms`. */
export async function syncBeforeOpen(ms = 1500): Promise<void> {
  const s = active;
  if (!s || !syncEnabled() || !hasSyncHub()) return;
  await Promise.race([s.run(), new Promise<void>((r) => setTimeout(r, ms))]);
}

export interface SyncOptions {
  /** How the Mac is asked; tests pass a fake. Returns null when no Mac can be asked. */
  send?: (body: string, keepalive: boolean) => Promise<Response> | null;
  /** Sync while the page is visible, this often. */
  everyMs?: number;
  now?: () => number;
}

/** Starts the app's syncer (one per page); the one before it stops. */
export function startSync(store: Store, opts: SyncOptions = {}): Syncer {
  active?.stop();
  active = createSyncer(store, opts);
  return active;
}

/** A syncer for one store. startSync is the app's way in; tests make several, one per device. */
export function createSyncer(store: Store, opts: SyncOptions = {}): Syncer {
  const now = opts.now ?? (() => Date.now());
  const send = opts.send ?? ((body: string, keepalive: boolean) => {
    const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive, signal: AbortSignal.timeout(20_000) };
    if (cloudSession()) return cloudFetch('/sync', init);
    return hasMacBridge() ? bridgeFetch('/api/sync', init) : null;
  });
  let status: SyncStatus = { state: store.backend === 'memory' ? 'memory' : 'idle', pending: 0 };
  let running: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let leaving = false;

  const setStatus = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    if (!('message' in patch)) delete status.message;
    try { globalThis.dispatchEvent?.(new CustomEvent(SYNC_EVENT, { detail: status })); } catch { /* no window */ }
  };

  async function once(): Promise<void> {
    if (store.backend === 'memory') { setStatus({ state: 'memory' }); return; }
    const list = await store.books.list();
    const books: Books = { keyOf: new Map(), idOf: new Map(), newer: new Map() };
    for (const b of list) {
      const key = bookKey(b);
      books.keyOf.set(b.id, key);
      if (!books.idOf.has(key)) books.idOf.set(key, b.id);
      for (const k of olderKeys(key)) if (!books.newer.has(k)) books.newer.set(k, b.id);
    }
    const rows = new Map((await store.sync.rows()).map((r) => [r.key, r]));
    const meta: Meta = { cursor: 0, ...(rows.get(META)?.held as Meta | undefined) };

    // 0. Bookmarks that name their book by key: on the book here, once it is here (it arrived, or was added again).
    const remapped: Bookmark[] = [];
    for (const b of await store.bookmarks.list()) {
      const key = b.bookKey ?? books.keyOf.get(b.bookId);
      if (!key) continue;
      const id = books.idOf.get(key) ?? books.newer.get(key) ?? b.bookId;
      if (key !== b.bookKey || id !== b.bookId) remapped.push({ ...b, bookKey: key, bookId: id });
    }
    if (remapped.length) await store.sync.apply({ bookmarksPut: remapped });

    // 1. Places held for books that have arrived since (store.books.add lands most of them as the book arrives).
    const arrived = new Map<string, Progress>();
    const settled: SyncRow[] = [];
    for (const row of rows.values()) {
      if (!row.key.startsWith('p:') || row.held === undefined) continue;
      const p = await placeHere(row.key.slice(2), row.held, books);
      if (p === undefined) continue;
      const { held: _h, ...rest } = row;
      void _h;
      settled.push(rest);
      const here = p && (arrived.get(p.bookId) ?? await store.progress.get(p.bookId));
      if (p && (!here || here.updatedAt < p.updatedAt)) arrived.set(p.bookId, p);
    }
    // Every write of rows below passes `rows` as seen: what this round read, so a place kept by a book deleted or added
    // meanwhile is not overwritten (store.sync.write). `rows` is updated only after each write.
    if (arrived.size || settled.length) {
      await store.sync.apply({ progressPut: [...arrived.values()], rows: settled, seen: rows });
      for (const r of settled) rows.set(r.key, r);
      announceProgress([...arrived.values()]);
    }

    // 2. What changed here since the last agreement, stamped now (or, for a record the Mac has never heard of, with
    //    the time the record itself carries, so an old copy on a new device does not beat a newer one elsewhere).
    const current = await snapshot(store, books, rows);
    const t = now();
    const changed: SyncRow[] = [];
    const bare = (cur: { bare?: string }) => (cur.bare ? { bare: cur.bare } : {});
    for (const [key, cur] of current) {
      const base = rows.get(key);
      if (base && base.sig === cur.sig) {
        // A row written before words kept `bare` gets it now, so a later change of only the book is recognized.
        if (cur.bare && base.bare !== cur.bare) changed.push({ ...base, bare: cur.bare });
        continue;
      }
      if (base && cur.bare && base.bare === cur.bare) {
        // Only the book the word names changed (deleted here, or imported again under a new key): nothing to send. The Mac
        // keeps the book's key, and a newer copy of the word elsewhere is not overwritten by this one stamped now.
        changed.push({ ...base, sig: cur.sig });
        continue;
      }
      if (!base && key.startsWith('v:')) {
        // A word this device saved before it ever synced: sent as the oldest possible change, so it only lands where the Mac
        // has no copy. If the Mac has one, take() keeps whichever copy was studied more.
        changed.push({ key, at: 0, sig: cur.sig, dirty: 1, fresh: 1, ...bare(cur) });
        continue;
      }
      // A change after the last agreement is stamped after it (a hybrid clock: the device's time, but never before the time
      // of the copy it changed), so a later change on a device whose clock is behind still wins. A place carries the time it
      // was read, so one read offline before a newer place elsewhere does not win. A known word with no row is time 0 (only
      // where the Mac has none) on a device's first sync, and stamped now once it has synced: it was marked here since.
      const at = !base
        ? (key.startsWith('k:') && meta.epoch ? t : cur.at)
        : key.startsWith('p:') ? Math.max(cur.at, base.at + 1) : Math.max(t, base.at + 1);
      changed.push({ key, at, sig: cur.sig, dirty: 1, ...bare(cur), ...(base?.held !== undefined ? { held: base.held } : {}) });
    }
    for (const [key, base] of rows) {
      // Places are never deleted by sync: removing a book here must not lose the place on the other devices.
      if (key === META || key.startsWith('p:') || base.sig === '-' || current.has(key)) continue;
      changed.push({ key, at: Math.max(t, base.at + 1), sig: '-', dirty: 1 });
    }
    if (changed.length) {
      await store.sync.write(changed, [], rows);
      for (const r of changed) rows.set(r.key, r);
    }
    const dirty = () => [...rows.values()].filter((r) => r.dirty);
    setStatus({ pending: dirty().length });
    if (!syncEnabled()) { setStatus({ state: 'off' }); return; }
    // Signed in and able to reach the Mac: what the Mac holds goes into the account once, beside this sync (never in its
    // way when the Mac is asleep), and a sync right after takes it.
    if (!opts.send && cloudSession() && hasMacBridge()) void copyMacIntoAccount().then((copied) => { if (copied) soon(0); });

    // 3. Send what changed and take what the Mac has that is newer.
    let restarted = false;
    let first = true;
    for (;;) {
      const outgoing = dirty().slice(0, CHUNK);
      if (!outgoing.length && !first) break;
      first = false;
      const body = JSON.stringify({
        epoch: meta.epoch, since: meta.cursor,
        changes: outgoing.map((r) => ({ key: r.key, at: r.at, data: r.sig === '-' ? null : current.get(r.key)?.data ?? null })),
      });
      const hub = cloudSession() ? 'cloud' : 'mac';
      const request = send(body, leaving && body.length < 60_000);
      if (!request) { setStatus({ state: 'none', hub: undefined }); return; }
      let response: Response;
      try { response = await request; } catch { setStatus({ state: 'asleep', hub }); return; }
      if (response.status === 401 && hub === 'cloud') {
        // Signed out on the server (from another device, or long unused): signed out here too, so Settings offers to sign in.
        setStatus({ state: 'signedout', hub });
        if (!opts.send) forgetSession();
        return;
      }
      if (response.status === 403) { setStatus({ state: 'refused', hub }); return; }
      if (!response.ok) {
        // The Mac says why when it can: a server started without its sync folder answers that it does not sync.
        const why = await response.json().then((b: { error?: unknown } | null) => b?.error, () => undefined);
        setStatus({ state: 'error', hub, message: typeof why === 'string' && why && why.length <= 300 ? why : `${hub === 'cloud' ? 'The sync server' : 'Your Mac'} answered ${response.status}.` });
        return;
      }
      const reply = await response.json().catch(() => null) as Reply | null;
      if (!reply || typeof reply.epoch !== 'string' || !Number.isInteger(reply.version) || !Array.isArray(reply.records)) {
        setStatus({ state: 'error', hub, message: `${hub === 'cloud' ? 'The sync server' : 'Your Mac'} sent an answer Dushu did not understand.` });
        return;
      }
      if (meta.epoch && reply.epoch !== meta.epoch && !restarted) {
        // The Mac's copy is new (or was reset): everything here goes to it again, then everything it has comes back.
        restarted = true;
        const all = [...rows.values()]
          .filter((r) => r.key !== META && (r.sig === '-' ? !r.key.startsWith('p:') : current.has(r.key)))
          .map((r) => ({ ...r, dirty: 1 as const }));
        meta.epoch = reply.epoch;
        meta.cursor = 0;
        await store.sync.write([...all, { key: META, at: 0, sig: '', held: meta }], [], rows);
        for (const r of all) rows.set(r.key, r);
        first = true;
        continue;
      }
      const sent = new Set(outgoing.map((r) => r.key));
      const kept = await take(reply, rows, books, sent, current);
      meta.epoch = reply.epoch;
      meta.cursor = reply.version;
      const cleared = outgoing.map((r) => rows.get(r.key)!).filter((r) => r.dirty && sent.has(r.key) && !kept.has(r.key)).map((r) => {
        const { dirty: _d, ...rest } = r;
        void _d;
        return rest;
      });
      await store.sync.write([...cleared, { key: META, at: 0, sig: '', held: meta }], [], rows);
      for (const r of cleared) rows.set(r.key, r);
      setStatus({ state: 'idle', hub, lastOk: now(), pending: dirty().length, counts: reply.counts });
      if (!dirty().length) break;
    }
  }

  /**
   * Applies the Mac's records that are newer than what this device has. Returns the keys whose copy here won over the Mac's
   * after all (a word studied more here than there): they stay unsent, stamped to win, and go with the next request.
   */
  async function take(reply: Reply, rows: Map<string, SyncRow>, books: Books, sent: Set<string>, current: Map<string, { data: unknown }>): Promise<Set<string>> {
    const kept = new Set<string>();
    const keep = (base: SyncRow, at: number) => {
      const { fresh: _f, ...rest } = base;
      void _f;
      const row: SyncRow = { ...rest, at, dirty: 1 };
      rows.set(base.key, row);
      kept.add(base.key);
      return row;
    };
    const vocabPut: VocabItem[] = [];
    const vocabDel: string[] = [];
    const knownPut: { word: string; auto?: true }[] = [];
    const knownDel: string[] = [];
    const progressPut: Progress[] = [];
    const lookupsPut: LookupRow[] = [];
    const lookupsDel: { day: string; id: string }[] = [];
    const bookmarksPut: Bookmark[] = [];
    const bookmarksDel: string[] = [];
    let resend = false;
    const moved = new Map<string, Progress>();
    const next: SyncRow[] = [];
    /** The signature this device gives the Mac's copy of a record (as in its rows); null when the copy is unusable. */
    const sigHere = (kind: string, id: string, data: unknown): string | null => {
      if (data === null || data === undefined) return '-';
      if (kind === 'v') {
        const item = cleanVocab(vocabLocal(data as VocabItem, books));
        return item && item.id === id ? sigOf(vocabWire(item, books)) : null;
      }
      if (kind === 'k') return sigOf((data as { a?: unknown }).a ? { a: 1 } : {});
      if (kind === 'l') {
        const r = lookupLocal(`l:${id}`, data, books);
        return r ? sigOf(lookupWire(r, books)) : null;
      }
      if (kind === 'b') {
        const b = bookmarkLocal(id, data, books);
        return b ? sigOf(bookmarkWire(b, books)) : null;
      }
      const wire = cleanProgress({ ...(data as object), bookId: 'held' });
      return wire ? sigOf(progressWire(wire)) : null;
    };
    for (const r of reply.records) {
      if (!r || typeof r.key !== 'string' || r.key.length > MAX_KEY || typeof r.at !== 'number' || !Number.isFinite(r.at)) continue;
      const kind = r.key[0];
      const id = r.key.slice(2);
      if (r.key[1] !== ':' || !id || !'vkplb'.includes(kind)) continue;
      const base = rows.get(r.key);
      if (kind === 'l' && r.data !== null && r.data !== undefined) {
        // Lookups merge (mergeLookups), so the Mac's copy is always taken: the store merges it with the row here, and what
        // only this device had is sent next time (the row records the Mac's copy, which no longer matches the one here).
        const item = lookupLocal(r.key, r.data, books);
        if (!item) continue;
        const wire = lookupWire(item, books);
        const sig = sigOf(wire);
        const mine = current.get(r.key)?.data as Omit<LookupRow, 'day' | 'id'> | undefined;
        if (mine && sigOf(mergeLookups(mine, wire)) !== sig) resend = true;
        if (base?.sig !== sig) lookupsPut.push(item);
        next.push({ key: r.key, at: r.at, sig });
        continue;
      }
      if (base?.dirty && sent.has(r.key) && r.at < base.at && sigHere(kind, id, r.data ?? null) === base.sig) {
        // Our own change, back with the Mac's time: a device clock ahead of the Mac's is held back to it. That time is the one
        // every device compares, so it is taken; kept ahead, a newer change from elsewhere would look older and be skipped.
        const { dirty: _d, fresh: _f, ...rest } = base;
        void _d; void _f;
        next.push({ ...rest, at: r.at });
        continue;
      }
      // A change of ours that is newer stays ours; it was just sent, or goes with the next sync.
      if (base?.dirty && (base.at > r.at || (base.at === r.at && !sent.has(r.key)))) continue;
      if (base && !base.dirty && base.at > r.at) continue;
      const data = r.data === undefined ? null : r.data;
      if (kind === 'v' && base?.dirty && base.fresh) {
        const mine = current.get(r.key)?.data as VocabItem | undefined;
        const theirs = data as VocabItem | null;
        const studied = (v: VocabItem | null | undefined) => v?.srs?.last ?? 0;
        // Saved here after it was deleted there, or studied more here: this copy stays and is sent again.
        if (mine && (theirs === null ? (mine.addedAt ?? 0) > r.at : studied(mine) > studied(theirs))) {
          next.push(keep(base, r.at + 1));
          continue;
        }
      }
      if (kind === 'v') {
        if (data === null) {
          if (base?.sig !== '-') vocabDel.push(id);
          next.push({ key: r.key, at: r.at, sig: '-' });
          continue;
        }
        const item = cleanVocab(vocabLocal(data as VocabItem, books));
        if (!item || item.id !== id) continue;
        const wire = vocabWire(item, books);
        const sig = sigOf(wire);
        if (base?.sig !== sig) vocabPut.push(item);
        next.push({ key: r.key, at: r.at, sig, bare: bareOf(wire) });
      } else if (kind === 'k') {
        if (data === null) {
          if (base?.sig !== '-') knownDel.push(id);
          next.push({ key: r.key, at: r.at, sig: '-' });
          continue;
        }
        const auto = !!(data as { a?: unknown }).a;
        const wire = auto ? { a: 1 } : {};
        const sig = sigOf(wire);
        if (base?.sig !== sig) knownPut.push(auto ? { word: id, auto: true } : { word: id });
        next.push({ key: r.key, at: r.at, sig });
      } else if (kind === 'l') {
        // Deleted there (a copy that is not deleted was taken above).
        const at = parseLookupKey(r.key);
        if (!at) continue;
        if (base?.sig !== '-') lookupsDel.push(at);
        next.push({ key: r.key, at: r.at, sig: '-' });
      } else if (kind === 'b') {
        if (data === null) {
          if (base?.sig !== '-') bookmarksDel.push(id);
          next.push({ key: r.key, at: r.at, sig: '-' });
          continue;
        }
        const b = bookmarkLocal(id, data, books);
        if (!b) continue;
        const sig = sigOf(bookmarkWire(b, books));
        if (base?.sig !== sig) bookmarksPut.push(b);
        next.push({ key: r.key, at: r.at, sig });
      } else {
        if (data === null) continue;
        const wire = cleanProgress({ ...(data as object), bookId: 'held' });
        if (!wire) continue;
        const sig = sigOf(progressWire(wire));
        const p = await placeHere(id, data, books);
        if (p === undefined) {
          // A book that is not here (yet): keep the place, and use it when the book arrives.
          next.push({ key: r.key, at: r.at, sig, held: progressWire(wire) });
          continue;
        }
        if (p && books.idOf.has(id)) {
          if (base?.sig !== sig) progressPut.push(p);
        } else if (p) {
          // Read in the book as an older importer cut it: moved into the chapters here, if it is newer than the place here.
          const here = moved.get(p.bookId) ?? await store.progress.get(p.bookId);
          if (!here || here.updatedAt < p.updatedAt) moved.set(p.bookId, p);
        }
        next.push({ key: r.key, at: r.at, sig });
      }
    }
    if (!next.length) return kept;
    for (const p of moved.values()) if (!progressPut.some((q) => q.bookId === p.bookId && q.updatedAt >= p.updatedAt)) progressPut.push(p);
    await store.sync.apply({ vocabPut, vocabDel, knownPut, knownDel, progressPut, lookupsPut, lookupsDel, bookmarksPut, bookmarksDel, rows: next, seen: rows });
    // A moved place is this device's to send, under the book's key here; so are lookups only this device had.
    if (moved.size || resend) soon();
    for (const r of next) rows.set(r.key, r);
    announceProgress(progressPut);
    return kept;
  }

  /**
   * A place saved under `key`, as it lands in this device's copy of that book: as it is, or moved by its percent when the
   * book here was imported again by a newer importer. Undefined when the book is not here; null when the place is unusable.
   */
  async function placeHere(key: string, data: unknown, books: Books): Promise<Progress | null | undefined> {
    const id = books.idOf.get(key) ?? books.newer.get(key);
    if (!id) return undefined;
    const p = cleanProgress({ ...(data as object), bookId: id });
    if (!p || books.idOf.has(key)) return p;
    const meta = await store.books.get(id);
    return meta ? moveByPercent(meta, progressWire(p), (i) => store.books.chapter(id, i)) : null;
  }

  function announceProgress(list: Progress[]): void {
    for (const p of list) {
      try { globalThis.dispatchEvent?.(new CustomEvent(REMOTE_PROGRESS_EVENT, { detail: { bookId: p.bookId, progress: p } })); } catch { /* no window */ }
    }
  }

  function run(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) { again = true; return running; }
    const go = async () => {
      if (syncEnabled() && hasSyncHub()) setStatus({ state: 'syncing' });
      try {
        const locks = (globalThis.navigator as Navigator | undefined)?.locks;
        // One tab at a time: two tabs of the same site share the rows.
        if (locks?.request) await locks.request('dushu-sync', () => once());
        else await once();
      } catch (e) {
        console.warn('Dushu sync', e);
        setStatus({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    };
    running = (async () => {
      do { again = false; await go(); } while (again && !stopped);
      running = null;
    })();
    return running;
  }

  function soon(ms = 1500): void {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void run(), ms);
  }

  // ---- when to sync
  const offChange = store.onChange((what, info) => {
    // A change that came from another tab or device is already in step; that tab sends its own.
    if (!info?.remote || what === 'books') soon(what === 'books' ? 3000 : 1500);
  });
  const setProgress = store.progress.set;
  store.progress.set = async (p) => { await setProgress(p); soon(5000); };
  const onVisible = () => {
    leaving = document.visibilityState === 'hidden';
    if (leaving) { clearTimeout(timer); void run(); } else soon(200);
  };
  const onWake = () => soon(200);
  // Opening another screen (Vocabulary, Review, a book) is when fresh words matter: ask the Mac then too.
  const onRoute = () => soon(300);
  const doc = typeof document !== 'undefined' ? document : null;
  doc?.addEventListener('visibilitychange', onVisible);
  globalThis.addEventListener?.('online', onWake);
  globalThis.addEventListener?.(BRIDGE_EVENT, onWake);
  globalThis.addEventListener?.(CLOUD_EVENT, onWake);
  globalThis.addEventListener?.('hashchange', onRoute);
  const every = opts.everyMs ?? 45_000;
  const interval = every > 0 ? setInterval(() => { if (!doc || doc.visibilityState === 'visible') void run(); }, every) : undefined;

  const syncer: Syncer = {
    run,
    soon,
    status: () => status,
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      offChange();
      store.progress.set = setProgress;
      doc?.removeEventListener('visibilitychange', onVisible);
      globalThis.removeEventListener?.('online', onWake);
      globalThis.removeEventListener?.(BRIDGE_EVENT, onWake);
      globalThis.removeEventListener?.(CLOUD_EVENT, onWake);
      globalThis.removeEventListener?.('hashchange', onRoute);
      if (active === syncer) active = null;
    },
  };
  void run();
  return syncer;
}
