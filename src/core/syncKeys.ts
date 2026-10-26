// How sync names books and records (core/sync.ts). Apart from it so the store can name a book's place when the book is
// deleted, and find a place kept for a book when it is added again.
import type { BookMeta, Progress } from '../types';

/**
 * The settings that follow the reader from device to device, one record each (o:<name>). The rest belong to the device: its
 * voice (each device has its own), hover or tap, and one or two pages side by side (that is about the screen). The hubs keep
 * only these names (syncExchange.ts).
 */
export const SYNCED_SETTINGS = ['theme', 'fontFamily', 'fontSize', 'scrollFontSize', 'lineHeight', 'pageWidth', 'pinyin', 'hskThreshold',
  'pinyinStyle', 'toneColors', 'sandhi', 'autoKnown', 'script', 'paragraphTranslate', 'translator', 'claudeModel', 'localOnly', 'ttsRate',
  'layout', 'pageTurn'] as const;
export type SyncedSetting = (typeof SYNCED_SETTINGS)[number];
export const isSyncedSetting = (name: string): name is SyncedSetting => (SYNCED_SETTINGS as readonly string[]).includes(name);

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

export type KeyedBook = Pick<BookMeta, 'note' | 'sourceName' | 'chapterCount' | 'charCount' | 'chapterTitles' | 'title' | 'importVersion'>;

/**
 * The same book on every device: the Mac's books by their file's digest, the classics by their id, anything else by its
 * shape (chapter titles and size), which an import of the same file reproduces and a rename does not change.
 */
export function bookKey(b: KeyedBook): string {
  // A book imported again by a newer importer may have its chapters cut differently: to sync it is another book, so a place
  // read in the old chapters never lands in the new ones as it is. Each device moves its own place when it imports the
  // book again, and a place only kept under the old key is moved by its percent (olderKeys).
  const v = (b.importVersion ?? 1) > 1 ? `.${b.importVersion}` : '';
  const mac = /^mac-book:([a-f0-9]{64})$/.exec(b.note ?? '');
  if (mac) return `m${mac[1].slice(0, 32)}${v}`;
  if (b.sourceName?.startsWith('sample:')) return `s${b.sourceName.slice(7, 80)}${v}`;
  return `b${hash(`${b.chapterCount}|${b.charCount}|${(b.chapterTitles ?? [b.title]).join('\u0001')}`)}`;
}

/** The keys the same book had under older importers: 'mabc.3' → ['mabc', 'mabc.2']. A book added from a file has none
 * (its key is its shape, which a new importer changes anyway). */
export function olderKeys(key: string): string[] {
  const m = /^([ms].*)\.(\d+)$/.exec(key);
  if (!m) return [];
  const out = [m[1]];
  for (let v = 2; v < Number(m[2]); v++) out.push(`${m[1]}.${v}`);
  return out;
}

/** A reading place as it travels and as it is kept for a book that is not here: without the device's own book id. */
export function progressWire(p: Progress): Omit<Progress, 'bookId'> {
  const { bookId: _id, ...rest } = p;
  void _id;
  return rest;
}

/** A looked-up word's record key: 'l:<day>:<word>'. */
export const lookupKey = (day: string, id: string): string => `l:${day}:${id}`;
export function parseLookupKey(key: string): { day: string; id: string } | null {
  const m = /^l:(\d{4}-\d{2}-\d{2}):(.+)$/s.exec(key);
  return m ? { day: m[1], id: m[2] } : null;
}

interface Lookupish { count: number; first: number; last: number; word?: unknown; pinyin?: unknown; gloss?: unknown; context?: unknown }

/** A looked-up word's record the Mac can merge: the counts and times are numbers. */
export function isLookupRecord(v: unknown): v is Lookupish {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return [o.count, o.first, o.last].every((n) => typeof n === 'number' && Number.isFinite(n));
}

/**
 * Two copies of a word's lookups on one day, as one: a word looked up on the iPad and on the Mac the same day keeps both,
 * instead of the later copy replacing the other. The answer is the same whatever the order, on the Mac and every device.
 * The words of the copy looked up last win; a tie is settled without the book's id, which each device names its own way.
 */
export function mergeLookups<T extends Lookupish>(a: T, b: T): T {
  const plain = (x: T) => {
    const c = x.context as { sentence?: unknown; bookTitle?: unknown; chapter?: unknown } | undefined;
    return canonical({ word: x.word, pinyin: x.pinyin, gloss: x.gloss, s: c?.sentence, t: c?.bookTitle, c: c?.chapter });
  };
  const later = a.last !== b.last ? (a.last > b.last ? a : b) : plain(a) >= plain(b) ? a : b;
  const other = later === a ? b : a;
  const out: T = { ...later, count: Math.max(a.count, b.count), first: Math.min(a.first, b.first), last: Math.max(a.last, b.last) };
  if (!out.pinyin && other.pinyin) out.pinyin = other.pinyin;
  if (!out.gloss && other.gloss) out.gloss = other.gloss;
  if (out.context === undefined && other.context !== undefined) out.context = other.context;
  return out;
}
