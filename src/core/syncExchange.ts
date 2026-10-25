// The shared copy's half of sync: how a request's changes merge into the records a hub keeps, and what goes back. Two hubs
// run it: the owner's Mac (scripts/sync-bridge.ts, one JSON file) and the sync account online (cloud/src, one SQLite
// database per account). Each record is last-writer-wins by the time the change happened on the device that made it,
// except a word's lookups on a day, which merge (every device's count). src/core/sync.ts is the device's half.
import { canonical, isLookupRecord, mergeLookups } from './syncKeys';

/** A record as it travels: `data` null means deleted. */
export interface WireRecord { key: string; at: number; data: unknown }
export interface StoredRecord { at: number; data: unknown; rev: number }
export interface SyncCounts { words: number; known: number; places: number; lookups: number; bookmarks: number }
export interface SyncReply { epoch: string; version: number; records: WireRecord[]; counts: SyncCounts }

export const SYNC_LIMITS = { body: 8 * 1024 * 1024, records: 5000, key: 160, record: 32 * 1024 };
/** How far ahead of the hub's clock a change may claim to be. A device with a clock far in the future would otherwise win forever. */
export const MAX_SKEW_MS = 10 * 60_000;
/** Saved words, known words, places, lookups, bookmarks and settings (o:). */
const KEY = /^[vkplbo]:./s;

/** The records a hub keeps, however it stores them. */
export interface RecordTable {
  epoch: string;
  version: number;
  get(key: string): StoredRecord | undefined;
  put(key: string, record: StoredRecord): void;
  /** Every record with `rev > since`, and the ones named in `also`, each once. */
  changed(since: number, also: Set<string>): WireRecord[];
  counts(): SyncCounts;
}

export class SyncError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Adds `n` live records of the kind `key` names to the counts a reply carries. */
export function countRecord(c: SyncCounts, key: string, data: unknown, n = 1): void {
  if (data === null) return;
  if (key[0] === 'v') c.words += n;
  else if (key[0] === 'k') c.known += n;
  else if (key[0] === 'p') c.places += n;
  else if (key[0] === 'l') c.lookups += n;
  else if (key[0] === 'b') c.bookmarks += n;
}
export const noCounts = (): SyncCounts => ({ words: 0, known: 0, places: 0, lookups: 0, bookmarks: 0 });

/**
 * Which of two versions of a record wins: the later change, and on a tie the larger contents, so every copy agrees.
 * Time 0 is a device's copy of something it never synced: it only lands where there is nothing yet, and the device
 * decides from the copy it gets back.
 */
function wins(at: number, data: unknown, cur: StoredRecord | undefined): boolean {
  if (!cur) return true;
  if (at === 0) return false;
  if (at !== cur.at) return at > cur.at;
  const a = JSON.stringify(data);
  const b = JSON.stringify(cur.data);
  return a !== b && a > b;
}

/**
 * Merges a request's `changes` into the table and returns every record newer than `since`, plus the current value of any
 * change that lost. `table.version` (and the records) change in place; `changed` says whether anything needs saving.
 */
export function exchange(table: RecordTable, input: { epoch?: unknown; since?: unknown; changes?: unknown }, now: number): { reply: SyncReply; changed: boolean } {
  const fresh = typeof input.epoch !== 'string' || input.epoch !== table.epoch;
  const since = !fresh && typeof input.since === 'number' && Number.isInteger(input.since) && input.since >= 0 && input.since <= table.version ? input.since : 0;
  const changes = Array.isArray(input.changes) ? input.changes : [];
  if (changes.length > SYNC_LIMITS.records) throw new SyncError(413, 'Too many changes in one request.');
  const lost = new Set<string>();
  let changed = false;
  const limit = now + MAX_SKEW_MS;
  for (const c of changes) {
    if (!c || typeof c !== 'object') continue;
    const { key, at, data } = c as Partial<WireRecord>;
    if (typeof key !== 'string' || key.length > SYNC_LIMITS.key || !KEY.test(key)) continue;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) continue;
    const value = data === undefined ? null : data;
    if (value !== null && typeof value !== 'object') continue;
    // Too large to keep: answered like a change that lost, with the hub's copy, so the device does not take it as sent.
    if (value !== null && JSON.stringify(value).length > SYNC_LIMITS.record) { lost.add(key); continue; }
    const when = Math.min(at, limit);
    const cur = table.get(key);
    if (key[0] === 'l' && isLookupRecord(value) && isLookupRecord(cur?.data)) {
      // Both devices looked the word up that day: one copy with both, sent back to the device when it is not its own.
      const merged = mergeLookups(value, cur.data);
      if (canonical(merged) !== canonical(cur.data)) {
        table.put(key, { at: Math.max(when, cur.at), data: merged, rev: ++table.version });
        changed = true;
      }
      if (canonical(merged) !== canonical(value)) lost.add(key);
      continue;
    }
    if (wins(when, value, cur)) {
      table.put(key, { at: when, data: value, rev: ++table.version });
      changed = true;
    } else lost.add(key);
  }
  return { reply: { epoch: table.epoch, version: table.version, records: table.changed(since, lost), counts: table.counts() }, changed };
}
