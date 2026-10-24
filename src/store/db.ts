// A tiny table backend with two implementations: IndexedDB (raw API) and in-memory (fallback
// when IndexedDB is missing or refuses to open, e.g. some private-browsing modes).
// All writes go through commit(), which is atomic.

export type Table = 'books' | 'chapters' | 'assets' | 'progress' | 'vocab' | 'known' | 'reviews' | 'lexicon' | 'lexiconScopes' | 'sync' | 'seen' | 'lookups' | 'bookmarks';

/** Bump when a table is added or changed; openDb's upgrade step creates what is missing, so v1 data is kept. */
export const DB_VERSION = 4;

export const TABLES: Record<Table, { keyPath: string | string[]; autoIncrement?: boolean }> = {
  books: { keyPath: 'id' },
  chapters: { keyPath: ['bookId', 'index'] },
  assets: { keyPath: ['bookId', 'name'] },
  progress: { keyPath: 'bookId' },
  vocab: { keyPath: 'id' },
  known: { keyPath: 'word' },
  reviews: { keyPath: 'id', autoIncrement: true },
  /** Names and terms: one row per [scope, word]; scope is a book id or '*' for the user's own words. */
  lexicon: { keyPath: ['scope', 'word'] },
  /** Which scopes have been scanned, and by which detector version. */
  lexiconScopes: { keyPath: 'scope' },
  /** What this device last agreed with the Mac on, one row per synced record, plus '#meta'. Kept with the data so a wipe or an
   * eviction clears both together: the device then looks new, and never tells the Mac its words were deleted. */
  sync: { keyPath: 'key' },
  /** How often each word went by on a page without being looked up (known words learned from reading). */
  seen: { keyPath: 'word' },
  /** Words looked up in the reader, one row per [day, word]. */
  lookups: { keyPath: ['day', 'id'] },
  /** Bookmarked places. */
  bookmarks: { keyPath: 'id' },
};

export type Op =
  | { op: 'put'; table: Table; value: object }
  | { op: 'del'; table: Table; key: IDBValidKey }
  /** Delete every row of a table. */
  | { op: 'clear'; table: Table }
  /** Delete every row of a table keyed [bookId, ...] (chapters, assets, lexicon). */
  | { op: 'delBook'; table: 'chapters' | 'assets' | 'lexicon'; bookId: string };

export interface Backend {
  readonly kind: 'idb' | 'memory';
  get<T>(table: Table, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(table: Table): Promise<T[]>;
  commit(ops: Op[]): Promise<void>;
}

export const QUOTA_MESSAGE =
  'Not enough storage space on this device to save that. Free up space or delete a book, then try again.';

/** What a transaction that was aborted without saying why most often means: the browser ran out of room. */
export const ABORT_MESSAGE = 'The browser could not save the book (it may be out of space).';

/** The error to show for an aborted transaction; `tx.error` is null when the browser aborts it for lack of space. */
export function abortError(e: unknown): Error {
  return e === null || e === undefined ? new Error(ABORT_MESSAGE) : friendlyError(e);
}

export function friendlyError(e: unknown): Error {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError' || /quota/i.test(String((e as Error | null)?.message ?? ''))) {
    return new Error(QUOTA_MESSAGE, { cause: e });
  }
  if (e instanceof Error) return e;
  return new Error(String(e ?? 'Storage error'), { cause: e });
}

// ------------------------------------------------------------------ memory ---

function clone<T>(v: T): T {
  try { return structuredClone(v); } catch { return v; }
}

export function createMemoryBackend(): Backend {
  const data = new Map<Table, Map<string, object>>();
  for (const t of Object.keys(TABLES) as Table[]) data.set(t, new Map());
  let nextReview = 1;

  const keyOf = (table: Table, v: Record<string, unknown>): IDBValidKey => {
    const kp = TABLES[table].keyPath;
    return Array.isArray(kp) ? kp.map((p) => v[p] as IDBValidKey) : (v[kp] as IDBValidKey);
  };
  const ks = (key: IDBValidKey) => JSON.stringify(key);

  return {
    kind: 'memory',
    async get<T>(table: Table, key: IDBValidKey) {
      const v = data.get(table)!.get(ks(key));
      return v === undefined ? undefined : clone(v) as T;
    },
    async getAll<T>(table: Table) {
      return [...data.get(table)!.values()].map((v) => clone(v) as T);
    },
    async commit(ops) {
      // Validate first so a bad op cannot leave a half-applied commit.
      const prepared: (() => void)[] = [];
      for (const o of ops) {
        if (o.op === 'put') {
          const v = clone(o.value) as Record<string, unknown>;
          if (o.table === 'reviews' && v.id === undefined) v.id = nextReview++;
          else if (o.table === 'reviews' && typeof v.id === 'number') nextReview = Math.max(nextReview, v.id + 1);
          const key = keyOf(o.table, v);
          if ((Array.isArray(key) ? key : [key]).some((k) => k === undefined || k === null)) {
            throw new Error(`Cannot save a ${o.table} record without its key`);
          }
          prepared.push(() => data.get(o.table)!.set(ks(key), v));
        } else if (o.op === 'del') {
          prepared.push(() => data.get(o.table)!.delete(ks(o.key)));
        } else if (o.op === 'clear') {
          prepared.push(() => data.get(o.table)!.clear());
        } else {
          prepared.push(() => {
            const t = data.get(o.table)!;
            for (const [k] of [...t]) if ((JSON.parse(k) as unknown[])[0] === o.bookId) t.delete(k);
          });
        }
      }
      for (const run of prepared) run();
    },
  };
}

// --------------------------------------------------------------- IndexedDB ---

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(friendlyError(r.error));
  });

function openDb(name: string, onLost: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [t, def] of Object.entries(TABLES)) {
        if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, def);
      }
    };
    r.onblocked = () => console.warn('Dushu: another tab holds an older version of the database open; close it to continue.');
    r.onerror = () => reject(r.error ?? new Error('Could not open the local database'));
    r.onsuccess = () => {
      const db = r.result;
      // Another tab wants to upgrade or delete the database: let go, reopen lazily on next use.
      db.onversionchange = () => { db.close(); onLost(); };
      db.onclose = () => onLost();
      resolve(db);
    };
  });
}

/** Throws if IndexedDB is unavailable or cannot be opened; the caller falls back to memory. */
export async function createIdbBackend(name: string): Promise<Backend> {
  if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB is not available');
  let db: IDBDatabase | null = null;
  let opening: Promise<IDBDatabase> | null = null;
  const lost = () => { db = null; };

  const conn = async (): Promise<IDBDatabase> => {
    if (db) return db;
    opening ??= openDb(name, lost).then(
      (d) => { db = d; opening = null; return d; },
      (e) => { opening = null; throw e; },
    );
    return opening;
  };
  // A connection can be closed under us (versionchange, browser eviction): reopen once and retry.
  const withDb = async <T>(fn: (d: IDBDatabase) => Promise<T>): Promise<T> => {
    try {
      return await fn(await conn());
    } catch (e) {
      if ((e as { name?: string } | null)?.name !== 'InvalidStateError') throw e;
      db = null;
      return fn(await conn());
    }
  };

  await conn(); // fail fast so openStore can fall back

  return {
    kind: 'idb',
    get: <T>(table: Table, key: IDBValidKey) =>
      withDb(async (d) => req<T | undefined>(d.transaction(table, 'readonly').objectStore(table).get(key))),
    getAll: <T>(table: Table) =>
      withDb(async (d) => req<T[]>(d.transaction(table, 'readonly').objectStore(table).getAll())),
    commit: (ops) => {
      if (!ops.length) return Promise.resolve();
      return withDb((d) => new Promise<void>((resolve, reject) => {
        const tx = d.transaction([...new Set(ops.map((o) => o.table))], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(abortError(tx.error));
        tx.onerror = () => { /* the abort handler reports it */ };
        try {
          for (const o of ops) {
            const os = tx.objectStore(o.table);
            if (o.op === 'put') os.put(o.value);
            else if (o.op === 'del') os.delete(o.key);
            else if (o.op === 'clear') os.clear();
            else os.delete(IDBKeyRange.bound([o.bookId], [o.bookId, []]));
          }
        } catch (e) {
          try { tx.abort(); } catch { /* already finished */ }
          reject(friendlyError(e));
        }
      }));
    },
  };
}
