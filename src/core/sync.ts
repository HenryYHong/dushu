// Keeps saved words, known words and reading places the same on every device the owner connects to their Mac.
// The Mac holds the shared copy (scripts/sync-bridge.ts). Each device keeps one row per record in the store's sync table
// saying what it last agreed on with the Mac, so it can tell its own changes (sent with the time they happened) from the
// Mac's (applied when newer). Those rows live in the same database as the data: a wipe or an eviction clears both, so a
// device that lost its data looks new and only receives; it never tells the Mac its words were deleted.
import type { BookMeta, Progress, Store, SyncRow, VocabItem } from '../types';
import { cleanProgress, cleanVocab } from '../store';
import { BRIDGE_EVENT, bridgeFetch, hasMacBridge } from './macBridge';

/** Fired on window when the sync status changes (Settings shows it). */
export const SYNC_EVENT = 'dushu:sync';
/** Fired on window with `{ bookId, progress }` when another device's reading place was saved here. */
export const REMOTE_PROGRESS_EVENT = 'dushu:remote-progress';

const OFF_KEY = 'dushu.sync.off.v1';
const META = '#meta';
/** Records per request; a new device's first sync sends its words in pieces. */
const CHUNK = 1000;
const MAX_KEY = 160;

export type SyncState = 'off' | 'none' | 'idle' | 'syncing' | 'asleep' | 'refused' | 'error' | 'memory';
export interface SyncStatus {
  state: SyncState;
  /** When this device last finished a sync with the Mac. */
  lastOk?: number;
  /** Changes made here that the Mac has not received yet. */
  pending: number;
  /** What the Mac holds, from its last answer. */
  counts?: { words: number; known: number; places: number };
  message?: string;
}

interface WireRecord { key: string; at: number; data: unknown }
interface Reply { epoch: string; version: number; records: WireRecord[]; counts?: SyncStatus['counts'] }
interface Meta { epoch?: string; cursor: number }

// ------------------------------------------------------------------ keys ---

/** cyrb53: a fast 53-bit string hash, as base36. Enough to tell versions of a record (or books) apart. */
export function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** JSON with sorted object keys and no undefined fields, so equal records always hash alike. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}
const sigOf = (data: unknown) => (data === null ? '-' : hash(canonical(data)));

/**
 * The same book on every device: the Mac's books by their file's digest, the classics by their id, anything else by its
 * shape (chapter titles and size), which an import of the same file reproduces and a rename does not change.
 */
export function bookKey(b: Pick<BookMeta, 'note' | 'sourceName' | 'chapterCount' | 'charCount' | 'chapterTitles' | 'title' | 'importVersion'>): string {
  // A book imported again by a newer importer may have its chapters cut differently: to sync it is another book, so a place
  // read in the old chapters never lands in the new ones. Each device moves its own place when it imports the book again.
  const v = (b.importVersion ?? 1) > 1 ? `.${b.importVersion}` : '';
  const mac = /^mac-book:([a-f0-9]{64})$/.exec(b.note ?? '');
  if (mac) return `m${mac[1].slice(0, 32)}${v}`;
  if (b.sourceName?.startsWith('sample:')) return `s${b.sourceName.slice(7, 80)}${v}`;
  return `b${hash(`${b.chapterCount}|${b.charCount}|${(b.chapterTitles ?? [b.title]).join('\u0001')}`)}`;
}

// ------------------------------------------------------------- records ---

interface Books { keyOf: Map<string, string>; idOf: Map<string, string> }

/** A saved word as it travels: its book is named by book key, so another device can find its own copy. */
function vocabWire(item: VocabItem, books: Books): VocabItem {
  if (!item.context?.bookId) return item;
  return { ...item, context: { ...item.context, bookId: books.keyOf.get(item.context.bookId) ?? item.context.bookId } };
}
function vocabLocal(item: VocabItem, books: Books): VocabItem {
  if (!item.context?.bookId) return item;
  return { ...item, context: { ...item.context, bookId: books.idOf.get(item.context.bookId) ?? item.context.bookId } };
}
function progressWire(p: Progress): Omit<Progress, 'bookId'> {
  const { bookId: _id, ...rest } = p;
  void _id;
  return rest;
}

/** Everything this device would send, by record key, with the time each record says it last changed. */
async function snapshot(store: Store, books: Books): Promise<Map<string, { data: unknown; sig: string; at: number }>> {
  const out = new Map<string, { data: unknown; sig: string; at: number }>();
  const put = (key: string, data: unknown, at: number) => { if (key.length <= MAX_KEY) out.set(key, { data, sig: sigOf(data), at }); };
  for (const item of await store.vocab.list()) put(`v:${item.id}`, vocabWire(item, books), Math.max(item.srs?.last ?? 0, item.addedAt ?? 0));
  for (const word of store.known.all()) put(`k:${word}`, store.known.isAuto(word) ? { a: 1 } : {}, 0);
  for (const [id, key] of books.keyOf) {
    const p = await store.progress.get(id);
    if (p) put(`p:${key}`, progressWire(p), p.updatedAt);
  }
  return out;
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

/** Before a book opens: a quick sync so the place read on another device is here. Waits at most `ms`. */
export async function syncBeforeOpen(ms = 1500): Promise<void> {
  const s = active;
  if (!s || !syncEnabled() || !hasMacBridge()) return;
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
  const send = opts.send ?? ((body: string, keepalive: boolean) => (hasMacBridge()
    ? bridgeFetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive, signal: AbortSignal.timeout(20_000) })
    : null));
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
    const books: Books = { keyOf: new Map(), idOf: new Map() };
    for (const b of list) {
      const key = bookKey(b);
      books.keyOf.set(b.id, key);
      if (!books.idOf.has(key)) books.idOf.set(key, b.id);
    }
    const rows = new Map((await store.sync.rows()).map((r) => [r.key, r]));
    const meta: Meta = { cursor: 0, ...(rows.get(META)?.held as Meta | undefined) };

    // 1. Places held for books that have arrived since.
    const arrived: Progress[] = [];
    const settled: SyncRow[] = [];
    for (const row of rows.values()) {
      if (!row.key.startsWith('p:') || row.held === undefined) continue;
      const id = books.idOf.get(row.key.slice(2));
      if (!id) continue;
      const p = cleanProgress({ ...(row.held as object), bookId: id });
      const { held: _h, ...rest } = row;
      void _h;
      const here = await store.progress.get(id);
      if (p && (!here || here.updatedAt < p.updatedAt)) arrived.push(p);
      const next: SyncRow = here && p && here.updatedAt >= p.updatedAt ? rest : { ...rest, sig: p ? sigOf(progressWire(p)) : rest.sig };
      settled.push(next);
      rows.set(row.key, next);
    }
    if (arrived.length || settled.length) {
      await store.sync.apply({ progressPut: arrived, rows: settled });
      announceProgress(arrived);
    }

    // 2. What changed here since the last agreement, stamped now (or, for a record the Mac has never heard of, with
    //    the time the record itself carries, so an old copy on a new device does not beat a newer one elsewhere).
    const current = await snapshot(store, books);
    const t = now();
    const changed: SyncRow[] = [];
    for (const [key, cur] of current) {
      const base = rows.get(key);
      if (base && base.sig === cur.sig) continue;
      if (!base && key.startsWith('v:')) {
        // A word this device saved before it ever synced: sent as the oldest possible change, so it only lands where the Mac
        // has no copy. If the Mac has one, take() keeps whichever copy was studied more.
        changed.push({ key, at: 0, sig: cur.sig, dirty: 1, fresh: 1 });
        continue;
      }
      // A place carries the time it was read; anything else changed just now (this runs within seconds of a change).
      const at = !base || key.startsWith('p:') ? cur.at : Math.max(t, base.at + 1);
      changed.push({ key, at, sig: cur.sig, dirty: 1 });
    }
    for (const [key, base] of rows) {
      // Places are never deleted by sync: removing a book here must not lose the place on the other devices.
      if (key === META || key.startsWith('p:') || base.sig === '-' || current.has(key)) continue;
      changed.push({ key, at: Math.max(t, base.at + 1), sig: '-', dirty: 1 });
    }
    if (changed.length) {
      await store.sync.write(changed);
      for (const r of changed) rows.set(r.key, r);
    }
    const dirty = () => [...rows.values()].filter((r) => r.dirty);
    setStatus({ pending: dirty().length });
    if (!syncEnabled()) { setStatus({ state: 'off' }); return; }

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
      const request = send(body, leaving && body.length < 60_000);
      if (!request) { setStatus({ state: 'none' }); return; }
      let response: Response;
      try { response = await request; } catch { setStatus({ state: 'asleep' }); return; }
      if (response.status === 403) { setStatus({ state: 'refused' }); return; }
      if (!response.ok) { setStatus({ state: 'error', message: `Your Mac answered ${response.status}.` }); return; }
      const reply = await response.json().catch(() => null) as Reply | null;
      if (!reply || typeof reply.epoch !== 'string' || !Number.isInteger(reply.version) || !Array.isArray(reply.records)) {
        setStatus({ state: 'error', message: 'Your Mac sent an answer Dushu did not understand.' });
        return;
      }
      if (meta.epoch && reply.epoch !== meta.epoch && !restarted) {
        // The Mac's copy is new (or was reset): everything here goes to it again, then everything it has comes back.
        restarted = true;
        const all = [...rows.values()]
          .filter((r) => r.key !== META && r.held === undefined && (r.sig === '-' ? !r.key.startsWith('p:') : current.has(r.key)))
          .map((r) => ({ ...r, dirty: 1 as const }));
        meta.epoch = reply.epoch;
        meta.cursor = 0;
        await store.sync.write([...all, { key: META, at: 0, sig: '', held: meta }]);
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
      await store.sync.write([...cleared, { key: META, at: 0, sig: '', held: meta }]);
      for (const r of cleared) rows.set(r.key, r);
      setStatus({ state: 'idle', lastOk: now(), pending: dirty().length, counts: reply.counts });
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
    const next: SyncRow[] = [];
    for (const r of reply.records) {
      if (!r || typeof r.key !== 'string' || r.key.length > MAX_KEY || typeof r.at !== 'number' || !Number.isFinite(r.at)) continue;
      const kind = r.key[0];
      const id = r.key.slice(2);
      if (r.key[1] !== ':' || !id || (kind !== 'v' && kind !== 'k' && kind !== 'p')) continue;
      const base = rows.get(r.key);
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
        const sig = sigOf(vocabWire(item, books));
        if (base?.sig !== sig) vocabPut.push(item);
        next.push({ key: r.key, at: r.at, sig });
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
      } else {
        if (data === null) continue;
        const local = books.idOf.get(id);
        if (!local) {
          // A book that is not here (yet): keep the place, and use it when the book arrives.
          const held = cleanProgress({ ...(data as object), bookId: 'held' });
          if (held) next.push({ key: r.key, at: r.at, sig: base?.sig ?? '', held: progressWire(held) });
          continue;
        }
        const p = cleanProgress({ ...(data as object), bookId: local });
        if (!p) continue;
        const sig = sigOf(progressWire(p));
        if (base?.sig !== sig) progressPut.push(p);
        next.push({ key: r.key, at: r.at, sig });
      }
    }
    if (!next.length) return kept;
    await store.sync.apply({ vocabPut, vocabDel, knownPut, knownDel, progressPut, rows: next });
    for (const r of next) rows.set(r.key, r);
    announceProgress(progressPut);
    return kept;
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
      if (syncEnabled() && hasMacBridge()) setStatus({ state: 'syncing' });
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
      globalThis.removeEventListener?.('hashchange', onRoute);
      if (active === syncer) active = null;
    },
  };
  void run();
  return syncer;
}
