// An account's state in its Durable Object's SQLite database.
import type { AccountStore, BookEntry, LimitsStore } from './account';
import { countRecord, noCounts, type StoredRecord, type WireRecord } from '../../src/core/syncExchange';

export interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

export function sqlStore(sql: SqlStorage): AccountStore {
  sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, at REAL NOT NULL, data TEXT NOT NULL, rev INTEGER NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS records_rev ON records (rev)');
  sql.exec('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, created REAL NOT NULL, used REAL NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS books (key TEXT PRIMARY KEY, entry TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS book_chunks (key TEXT NOT NULL, i INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (key, i))');
  const row = (key: string): StoredRecord | undefined => {
    const r = sql.exec('SELECT at, data, rev FROM records WHERE key = ?', key).toArray()[0];
    return r ? { at: Number(r.at), data: JSON.parse(String(r.data)), rev: Number(r.rev) } : undefined;
  };
  return {
    getMeta(k) {
      const r = sql.exec('SELECT v FROM meta WHERE k = ?', k).toArray()[0];
      return r ? String(r.v) : undefined;
    },
    setMeta(k, v) {
      if (v === null) sql.exec('DELETE FROM meta WHERE k = ?', k);
      else sql.exec('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', k, v);
    },
    records: (epoch, version) => ({
      epoch,
      version,
      get: row,
      put(key, r) { sql.exec('INSERT OR REPLACE INTO records (key, at, data, rev) VALUES (?, ?, ?, ?)', key, r.at, JSON.stringify(r.data), r.rev); },
      changed(since, also) {
        const out: WireRecord[] = sql.exec('SELECT key, at, data FROM records WHERE rev > ? ORDER BY rev', since).toArray()
          .map((r) => ({ key: String(r.key), at: Number(r.at), data: JSON.parse(String(r.data)) }));
        const seen = new Set(out.map((r) => r.key));
        for (const key of also) {
          const r = seen.has(key) ? undefined : row(key);
          if (r) out.push({ key, at: r.at, data: r.data });
        }
        return out;
      },
      counts() {
        const c = noCounts();
        for (const r of sql.exec("SELECT substr(key, 1, 1) AS kind, count(*) AS n FROM records WHERE data != 'null' GROUP BY kind").toArray()) {
          countRecord(c, String(r.kind), {}, Number(r.n));
        }
        return c;
      },
    }),
    getSession(hash) {
      const r = sql.exec('SELECT created, used FROM sessions WHERE hash = ?', hash).toArray()[0];
      return r ? { created: Number(r.created), used: Number(r.used) } : undefined;
    },
    putSession(hash, s) { sql.exec('INSERT OR REPLACE INTO sessions (hash, created, used) VALUES (?, ?, ?)', hash, s.created, s.used); },
    dropSession(hash) { sql.exec('DELETE FROM sessions WHERE hash = ?', hash); },
    sessions: () => sql.exec('SELECT hash, used FROM sessions').toArray().map((r) => ({ hash: String(r.hash), used: Number(r.used) })),
    books: () => sql.exec('SELECT entry FROM books').toArray().map((r) => JSON.parse(String(r.entry)) as BookEntry),
    putBook(b) { sql.exec('INSERT OR REPLACE INTO books (key, entry) VALUES (?, ?)', b.key, JSON.stringify(b)); },
    dropBook(key) {
      sql.exec('DELETE FROM book_chunks WHERE key = ?', key);
      sql.exec('DELETE FROM books WHERE key = ?', key);
    },
    putChunk(key, i, data) { sql.exec('INSERT OR REPLACE INTO book_chunks (key, i, data) VALUES (?, ?, ?)', key, i, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)); },
    getChunk(key, i) {
      const r = sql.exec('SELECT data FROM book_chunks WHERE key = ? AND i = ?', key, i).toArray()[0];
      return r ? new Uint8Array(r.data as ArrayBuffer) : undefined;
    },
    chunkCount: (key) => Number(sql.exec('SELECT count(*) AS n FROM book_chunks WHERE key = ?', key).toArray()[0]?.n ?? 0),
    wipe() { for (const table of ['book_chunks', 'books', 'sessions', 'records', 'meta']) sql.exec(`DELETE FROM ${table}`); },
  };
}

/** The shared daily counts in the Limits Durable Object's SQLite database. */
export function sqlLimits(sql: SqlStorage): LimitsStore {
  sql.exec('CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, name TEXT NOT NULL, n REAL NOT NULL, PRIMARY KEY (day, name))');
  return {
    get: (day, name) => Number(sql.exec('SELECT n FROM counts WHERE day = ? AND name = ?', day, name).toArray()[0]?.n ?? 0),
    set(day, name, n) { sql.exec('INSERT OR REPLACE INTO counts (day, name, n) VALUES (?, ?, ?)', day, name, n); },
    prune(day) { sql.exec('DELETE FROM counts WHERE day < ?', day); },
  };
}
