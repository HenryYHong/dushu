// Saved words, known words, reading places, looked-up words and bookmarks, kept on the Mac so every device the owner connects shows the same ones.
// Every language's library is in the one file, apart (src/core/syncExchange.ts: '@ja:v:…' beside the Chinese 'v:…').
// Owner-only (bridgeRequest). The shared copy is one JSON file in the folder DUSHU_SYNC_DIR names (the owner's is
// .dushu-local/sync, never in the repo, the build or the public site), written atomically, with one copy per day kept for
// two weeks. The merge itself is src/core/syncExchange.ts (shared with the sync account online); src/core/sync.ts is the
// device's half. Only the launcher (scripts/start-local.mjs) names the owner's folder: a server started any other way
// (npm run dev, a QA script) answers that sync is off, so it can never read or overwrite the owner's words.
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { bridgeRequest } from './private-access';
import { SYNC_LIMITS, SyncError, countRecord, exchange, inLang, noCounts, type RecordTable, type StoredRecord, type SyncReply, type WireRecord } from '../src/core/syncExchange';

export { SYNC_LIMITS, SyncError };
export type { SyncReply, WireRecord };
export interface SyncState { epoch: string; version: number; records: Record<string, StoredRecord> }

const BACKUP_DAYS = 14;

const two = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

/** What a server started without a sync folder answers on /api/sync. */
export const SYNC_OFF_MESSAGE = 'This Dushu server was started without its sync folder, so it does not sync. Start Dushu with Dushu.command or npm start.';

/**
 * The folder the Mac's copy lives in: DUSHU_SYNC_DIR when it is an absolute path, else null (sync off). There is no
 * default on purpose: a server that falls back to the owner's folder is how a QA run once wiped the owner's words.
 */
export function syncDir(env: Record<string, string | undefined> = process.env): string | null {
  const dir = env.DUSHU_SYNC_DIR?.trim();
  return dir && isAbsolute(dir) ? dir : null;
}

export interface SyncStoreOptions { dir?: string; now?: () => number }

export function createSyncStore(opts: SyncStoreOptions = {}) {
  const named = opts.dir ?? syncDir();
  if (!named) throw new Error('Dushu sync needs a folder: set DUSHU_SYNC_DIR to an absolute path.');
  const dir: string = named;
  const now = opts.now ?? (() => Date.now());
  const file = join(dir, 'state.json');
  let state: SyncState | null = null;
  /** state.json as this process last read or wrote it. Each save is a new file (renamed into place), so a save by
   * another process on the same folder shows as another inode. */
  let seen = '';
  const stamp = (path: string) => { try { const st = statSync(path); return `${st.ino}:${st.size}:${st.mtimeMs}`; } catch { return ''; } };

  function load(): SyncState {
    // Read again when another process saved since, so its changes are merged into, not overwritten.
    const current = stamp(file);
    if (state && current === seen) return state;
    seen = current;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as SyncState;
      if (typeof raw.epoch === 'string' && Number.isInteger(raw.version) && raw.records && typeof raw.records === 'object') state = raw;
    } catch (e) {
      // A file that exists but cannot be read is kept aside, never overwritten: the daily copies are next to it.
      if (existsSync(file)) {
        try { renameSync(file, join(dir, `state-unreadable-${Date.now()}.json`)); } catch { /* leave it */ }
        console.error('Dushu sync: the saved state could not be read and was set aside.', e);
      }
    }
    state ??= { epoch: randomUUID(), version: 0, records: {} };
    return state;
  }

  function save(s: SyncState): void {
    mkdirSync(dir, { recursive: true });
    // Before the first write of a day, the previous state is kept as that day's copy.
    const today = join(dir, `state-${day(new Date(now()))}.json`);
    if (existsSync(file) && !existsSync(today)) {
      try { copyFileSync(file, today); } catch { /* a missed copy is not worth failing the save */ }
      const old = readdirSync(dir).filter((f) => /^state-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const f of old.slice(0, Math.max(0, old.length - BACKUP_DAYS))) { try { unlinkSync(join(dir, f)); } catch { /* ignore */ } }
    }
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s));
    // Stamped before the rename (which keeps inode and times), so a save another process makes right after is not missed.
    const mine = stamp(tmp);
    renameSync(tmp, file);
    seen = mine;
  }

  /** One library's counts ('' Chinese, 'ja' Japanese …): every language's records are in the one file. */
  function counts(s: SyncState, lang: string): SyncReply['counts'] {
    const c = noCounts();
    for (const [key, r] of Object.entries(s.records)) if (inLang(key, lang)) countRecord(c, key, r.data);
    return c;
  }

  function table(s: SyncState): RecordTable {
    return {
      epoch: s.epoch,
      get version() { return s.version; },
      set version(v: number) { s.version = v; },
      get: (key) => s.records[key],
      put: (key, record) => { s.records[key] = record; },
      changed: (since, also, lang) => Object.entries(s.records).filter(([key, r]) => inLang(key, lang) && (r.rev > since || also.has(key))).map(([key, r]) => ({ key, at: r.at, data: r.data })),
      counts: (lang) => counts(s, lang),
    };
  }

  return {
    /** Merges `changes` and returns every record newer than `since`, plus the current value of any change that lost. */
    exchange(input: { epoch?: unknown; since?: unknown; changes?: unknown; lang?: unknown }): SyncReply {
      const s = load();
      const { reply, changed } = exchange(table(s), input, now());
      if (changed) save(s);
      return reply;
    },
    /** The Chinese library's status, as before languages synced. */
    status(): Omit<SyncReply, 'records'> {
      const s = load();
      return { epoch: s.epoch, version: s.version, counts: counts(s, '') };
    },
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** The store for this server's folder, or null when it was started without one (sync off). */
export function openSyncStore(env: Record<string, string | undefined> = process.env): ReturnType<typeof createSyncStore> | null {
  const dir = syncDir(env);
  if (!dir && env.DUSHU_SYNC_DIR) console.warn('Dushu sync: DUSHU_SYNC_DIR must be an absolute path. Sync is off on this server.');
  return dir ? createSyncStore({ dir }) : null;
}

export function syncHandler(store: ReturnType<typeof createSyncStore> | null = openSyncStore()) {
  return async function handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== '/api/sync') { next(); return; }
    if (!bridgeRequest(req)) { res.writeHead(403).end(); return; }
    if (!store) { json(res, 503, { error: SYNC_OFF_MESSAGE, off: true }); return; }
    if (req.method === 'GET') { json(res, 200, store.status()); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return; }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += (chunk as Buffer).length;
      // Past the limit the rest is read and dropped. Answering before the end would leave it unread on a kept-alive
      // connection, and the device's next request on it would wait a minute; closing instead can cut off the answer.
      if (bytes <= SYNC_LIMITS.body) chunks.push(chunk as Buffer);
    }
    if (bytes > SYNC_LIMITS.body) { json(res, 413, { error: 'Too much to sync in one request.' }); return; }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { json(res, 400, { error: 'The sync request was not understood.' }); return; }
    if (!body || typeof body !== 'object') { json(res, 400, { error: 'The sync request was not understood.' }); return; }
    try { json(res, 200, store.exchange(body as Record<string, unknown>)); }
    catch (e) {
      if (e instanceof SyncError) json(res, e.status, { error: e.message });
      else { console.error('Dushu sync', e); json(res, 500, { error: 'Your Mac could not save the changes.' }); }
    }
  };
}

export function syncBridge(): Plugin {
  const install = (server: any) => {
    const handle = syncHandler();
    server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
      void handle(req, res, next).catch(() => { if (!res.headersSent) res.writeHead(500); if (!res.writableEnded) res.end(); });
    });
  };
  return { name: 'dushu-sync', configureServer: install, configurePreviewServer: install };
}
