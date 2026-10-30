// The shared copy's half of sync: how a request's changes merge into the records a hub keeps, and what goes back. Two hubs
// run it: the owner's Mac (scripts/sync-bridge.ts, one JSON file) and the sync account online (cloud/src, one SQLite
// database per account). Each record is last-writer-wins by the time the change happened on the device that made it,
// except a word's lookups on a day, which merge (every device's count). src/core/sync.ts is the device's half.
//
// A hub keeps every language's library, apart: Chinese records under their own keys ('v:学生'), another language's with
// '@<id>:' in front ('@ja:v:学生', syncKeys.ts). A request syncs one library. A request without `lang` is Chinese, as every
// request was before languages synced, and it gets exactly what it got then: only Chinese records, Chinese counts and room.
import { canonical, isLookupRecord, isOtherLang, isSyncedSetting, langPrefix, mergeLookups, type OtherLang } from './syncKeys';

/** A record as it travels: `data` null means deleted. */
export interface WireRecord { key: string; at: number; data: unknown }
export interface StoredRecord { at: number; data: unknown; rev: number }
export interface SyncCounts { words: number; known: number; places: number; lookups: number; bookmarks: number }
/** `lang` names the library synced when it is not Chinese: a hub from before languages never names it (core/sync.ts). */
export interface SyncReply { epoch: string; version: number; records: WireRecord[]; counts: SyncCounts; lang?: OtherLang }

/**
 * Per request: its bytes, its changes, a key's length and a record's. The key is measured without its language's prefix, so a
 * Japanese word may be as long as a Chinese one. A request carries one library, so several languages never share a request's
 * limits; what an account keeps in all is per library too (cloud/src/account.ts).
 */
export const SYNC_LIMITS = { body: 8 * 1024 * 1024, records: 5000, key: 160, record: 32 * 1024 };
/** How far ahead of the hub's clock a change may claim to be. A device with a clock far in the future would otherwise win forever. */
export const MAX_SKEW_MS = 10 * 60_000;
/** Saved words, known words, places, lookups, bookmarks and settings (o:), as a library names them (no language prefix). */
const KEY = /^[vkplbo]:./s;

/**
 * The library a request syncs: '' for Chinese, else the language it names (`lang: 'ja'`). A language this hub does not know
 * is answered as Chinese, the way a hub from before languages answers every request: its records are not kept and the reply
 * does not name it, so its device keeps them unsent and says the hub needs updating.
 */
export function syncLang(v: unknown): '' | OtherLang {
  return isOtherLang(v) ? v : '';
}

/** Whether a kept key is in the library `lang` names ('' for Chinese: no '@<id>:' in front). */
export function inLang(key: string, lang: string): boolean {
  return lang ? key.startsWith(langPrefix(lang)) : key[0] !== '@';
}

/** The records a hub keeps, however it stores them. */
export interface RecordTable {
  epoch: string;
  version: number;
  get(key: string): StoredRecord | undefined;
  put(key: string, record: StoredRecord): void;
  /** Every record of the library `lang` names (inLang) with `rev > since`, and the ones named in `also`, each once. */
  changed(since: number, also: Set<string>, lang: string): WireRecord[];
  /** The live records of the library `lang` names, by kind. */
  counts(lang: string): SyncCounts;
}

export class SyncError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Adds `n` live records of the kind `key` names to the counts a reply carries ('@ja:v:…' is a saved word, like 'v:…'). */
export function countRecord(c: SyncCounts, key: string, data: unknown, n = 1): void {
  if (data === null) return;
  const kind = key[0] === '@' ? key[key.indexOf(':') + 1] : key[0];
  if (kind === 'v') c.words += n;
  else if (kind === 'k') c.known += n;
  else if (kind === 'p') c.places += n;
  else if (kind === 'l') c.lookups += n;
  else if (kind === 'b') c.bookmarks += n;
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

/** Bytes of JSON a record's data takes (a deletion none), as a hub's room counts them. */
export const recordSize = (data: unknown): number => (data === null || data === undefined ? 0 : JSON.stringify(data).length);

/**
 * Merges a request's `changes` into the table and returns every record of its library newer than `since`, plus the current
 * value of any change that lost. `table.version` (and the records) change in place; `changed` says whether anything needs
 * saving. The version counts every library's changes: a Chinese device's cursor simply moves past a Japanese change.
 * `room`, when given, hears how many bytes the merge would add (what it keeps less what that replaces) before anything is
 * written, and throws to refuse the request (the account's room, cloud/src/account.ts). Only what the merge keeps counts: a
 * deletion that loses (at time 0, or older than the copy here) frees nothing, and a key deleted and added again in one request
 * counts once, so neither makes room the request then fills.
 */
export function exchange(table: RecordTable, input: { epoch?: unknown; since?: unknown; changes?: unknown; lang?: unknown }, now: number, room?: (grow: number) => void): { reply: SyncReply; changed: boolean } {
  const lang = syncLang(input.lang);
  const prefix = langPrefix(lang);
  const fresh = typeof input.epoch !== 'string' || input.epoch !== table.epoch;
  const since = !fresh && typeof input.since === 'number' && Number.isInteger(input.since) && input.since >= 0 && input.since <= table.version ? input.since : 0;
  const changes = Array.isArray(input.changes) ? input.changes : [];
  if (changes.length > SYNC_LIMITS.records) throw new SyncError(413, 'Too many changes in one request.');
  const lost = new Set<string>();
  let changed = false;
  const limit = now + MAX_SKEW_MS;
  /** The merge's decisions, written once the room allows them. */
  const staged = new Map<string, StoredRecord>();
  const get = (key: string) => staged.get(key) ?? table.get(key);
  let version = table.version;
  for (const c of changes) {
    if (!c || typeof c !== 'object') continue;
    const { key, at, data } = c as Partial<WireRecord>;
    // One library per request: a Japanese request's '@ja:' keys only, a Chinese one's keys without a prefix (KEY refuses '@').
    if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
    const own = key.slice(prefix.length);
    if (own.length > SYNC_LIMITS.key || !KEY.test(own)) continue;
    // Only the settings that library syncs, nothing else under o: (a Japanese o:translateTo is the Chinese library's to sync).
    if (own[0] === 'o' && !isSyncedSetting(own.slice(2), lang)) continue;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) continue;
    const value = data === undefined ? null : data;
    if (value !== null && typeof value !== 'object') continue;
    // Too large to keep: answered like a change that lost, with the hub's copy, so the device does not take it as sent.
    if (value !== null && JSON.stringify(value).length > SYNC_LIMITS.record) { lost.add(key); continue; }
    const when = Math.min(at, limit);
    const cur = get(key);
    if (own[0] === 'l' && isLookupRecord(value) && isLookupRecord(cur?.data)) {
      // Both devices looked the word up that day: one copy with both, sent back to the device when it is not its own.
      const merged = mergeLookups(value, cur.data);
      if (canonical(merged) !== canonical(cur.data)) {
        staged.set(key, { at: Math.max(when, cur.at), data: merged, rev: ++version });
        changed = true;
      }
      if (canonical(merged) !== canonical(value)) lost.add(key);
      continue;
    }
    if (wins(when, value, cur)) {
      staged.set(key, { at: when, data: value, rev: ++version });
      changed = true;
    } else lost.add(key);
  }
  if (room && staged.size) {
    let grow = 0;
    for (const [key, r] of staged) grow += recordSize(r.data) - recordSize(table.get(key)?.data);
    room(grow);
  }
  for (const [key, r] of staged) table.put(key, r);
  table.version = version;
  const reply: SyncReply = { epoch: table.epoch, version: table.version, records: table.changed(since, lost, lang), counts: table.counts(lang) };
  // Named back, so the device knows this hub keeps its language (a Chinese reply stays as it always was).
  if (lang) reply.lang = lang;
  return { reply, changed };
}
