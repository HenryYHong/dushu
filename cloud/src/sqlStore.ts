// An account's state in its Durable Object's SQLite database.
import type { AccountStore } from './account';
import { countRecord, noCounts, type StoredRecord, type WireRecord } from '../../src/core/syncExchange';

export interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

export function sqlStore(sql: SqlStorage): AccountStore {
  sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, at REAL NOT NULL, data TEXT NOT NULL, rev INTEGER NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS records_rev ON records (rev)');
  sql.exec('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, created REAL NOT NULL, used REAL NOT NULL)');
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
  };
}
