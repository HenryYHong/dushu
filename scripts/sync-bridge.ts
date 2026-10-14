// Saved words, known words and reading places, kept on the Mac so every device the owner connects shows the same ones.
// Owner-only (bridgeRequest). The shared copy is one JSON file under .dushu-local (never in the repo, the build or the
// public site), written atomically, with one copy per day kept for two weeks. Each record is last-writer-wins by the time
// the change happened on the device that made it; src/core/sync.ts is the other half.
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { bridgeRequest } from './private-access';

/** A record as it travels: `data` null means deleted. */
export interface WireRecord { key: string; at: number; data: unknown }
interface Stored { at: number; data: unknown; rev: number }
export interface SyncState { epoch: string; version: number; records: Record<string, Stored> }
export interface SyncReply {
  epoch: string;
  version: number;
  records: WireRecord[];
  counts: { words: number; known: number; places: number };
}

export const SYNC_LIMITS = { body: 8 * 1024 * 1024, records: 5000, key: 160, record: 32 * 1024 };
/** How far ahead of the Mac's clock a change may claim to be. A device with a clock far in the future would otherwise win forever. */
const MAX_SKEW_MS = 10 * 60_000;
const BACKUP_DAYS = 14;
const KEY = /^[vkp]:./s;

const two = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;

export interface SyncStoreOptions { dir?: string; now?: () => number }

export function createSyncStore(opts: SyncStoreOptions = {}) {
  // DUSHU_SYNC_DIR: a separate folder for tests, so they never touch the owner's words.
  const dir = opts.dir ?? process.env.DUSHU_SYNC_DIR ?? join('.dushu-local', 'sync');
  const now = opts.now ?? (() => Date.now());
  const file = join(dir, 'state.json');
  let state: SyncState | null = null;

  function load(): SyncState {
    if (state) return state;
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
    renameSync(tmp, file);
  }

  function counts(s: SyncState): SyncReply['counts'] {
    const c = { words: 0, known: 0, places: 0 };
    for (const [key, r] of Object.entries(s.records)) {
      if (r.data === null) continue;
      if (key[0] === 'v') c.words++;
      else if (key[0] === 'k') c.known++;
      else c.places++;
    }
    return c;
  }

  /**
   * Which of two versions of a record wins: the later change, and on a tie the larger contents, so every copy agrees.
   * Time 0 is a device's copy of something it never synced: it only lands where there is nothing yet, and the device
   * decides from the copy it gets back.
   */
  function wins(at: number, data: unknown, cur: Stored | undefined): boolean {
    if (!cur) return true;
    if (at === 0) return false;
    if (at !== cur.at) return at > cur.at;
    const a = JSON.stringify(data);
    const b = JSON.stringify(cur.data);
    return a !== b && a > b;
  }

  return {
    /** Merges `changes` and returns every record newer than `since`, plus the current value of any change that lost. */
    exchange(input: { epoch?: unknown; since?: unknown; changes?: unknown }): SyncReply {
      const s = load();
      const fresh = typeof input.epoch !== 'string' || input.epoch !== s.epoch;
      const since = !fresh && typeof input.since === 'number' && Number.isInteger(input.since) && input.since >= 0 && input.since <= s.version ? input.since : 0;
      const changes = Array.isArray(input.changes) ? input.changes : [];
      if (changes.length > SYNC_LIMITS.records) throw new SyncError(413, 'Too many changes in one request.');
      const lost = new Set<string>();
      let changed = false;
      const limit = now() + MAX_SKEW_MS;
      for (const c of changes) {
        if (!c || typeof c !== 'object') continue;
        const { key, at, data } = c as Partial<WireRecord>;
        if (typeof key !== 'string' || key.length > SYNC_LIMITS.key || !KEY.test(key)) continue;
        if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) continue;
        const value = data === undefined ? null : data;
        if (value !== null && (typeof value !== 'object' || JSON.stringify(value).length > SYNC_LIMITS.record)) continue;
        const when = Math.min(at, limit);
        if (wins(when, value, s.records[key])) {
          s.records[key] = { at: when, data: value, rev: ++s.version };
          changed = true;
        } else lost.add(key);
      }
      if (changed) save(s);
      const records: WireRecord[] = [];
      for (const [key, r] of Object.entries(s.records)) {
        if (r.rev > since || lost.has(key)) records.push({ key, at: r.at, data: r.data });
      }
      return { epoch: s.epoch, version: s.version, records, counts: counts(s) };
    },
    status(): Omit<SyncReply, 'records'> {
      const s = load();
      return { epoch: s.epoch, version: s.version, counts: counts(s) };
    },
  };
}

export class SyncError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function syncHandler(store = createSyncStore()) {
  return async function handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== '/api/sync') { next(); return; }
    if (!bridgeRequest(req)) { res.writeHead(403).end(); return; }
    if (req.method === 'GET') { json(res, 200, store.status()); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415).end(); return; }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += (chunk as Buffer).length;
      if (bytes > SYNC_LIMITS.body) { json(res, 413, { error: 'Too much to sync in one request.' }); return; }
      chunks.push(chunk as Buffer);
    }
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
