// How sync names books and records (core/sync.ts). Apart from it so the store can name a book's place when the book is
// deleted, and find a place kept for a book when it is added again.
import type { BookMeta, Progress, Settings } from '../types';
import type { LangId } from '../lang/types';

/**
 * The languages other than Chinese. Each one's records travel and are kept with '@<id>:' in front of the key Chinese would
 * use ('@ja:v:食べる', '@es:p:<book key>', '@fr:o:fontSize'), and its books in the account the same way ('@ja:b1x2y3'), so
 * the same word or book in two libraries is two records. Chinese keeps its keys as they were before languages synced: a
 * Chinese device from before reads only keys whose second character is ':' (take in core/sync.ts), so a Japanese saved word
 * never lands in its Chinese library. A hub keeps only the prefixes listed here (syncExchange.ts): a language added later
 * needs the hubs updated first, and until then its device keeps its records unsent and says so.
 */
export const OTHER_LANGS = ['ja', 'es', 'fr', 'de', 'it', 'pt', 'ru'] as const satisfies readonly Exclude<LangId, 'zh'>[];
export type OtherLang = (typeof OTHER_LANGS)[number];
// Every language but Chinese is listed: one added to LangId and not here fails to compile.
const _everyLanguage: [Exclude<LangId, 'zh' | OtherLang>] extends [never] ? true : false = true;
void _everyLanguage;
export const isOtherLang = (v: unknown): v is OtherLang => typeof v === 'string' && (OTHER_LANGS as readonly string[]).includes(v);
/** What a library's keys start with: nothing for Chinese, '@ja:' for Japanese. */
export const langPrefix = (id: string): string => (isOtherLang(id) ? `@${id}:` : '');

/**
 * The settings that follow the reader from device to device, one record each (o:<name>). The rest belong to the device: its
 * voice (each device has its own), hover or tap, and one or two pages side by side (that is about the screen). The hubs keep
 * only these names (syncExchange.ts).
 *
 * translateTo (the language sentences go into) was added after the others. A Chinese device from before it ignores the record
 * (settingHere in core/sync.ts), so an older iPad keeps translating into English until it updates, and nothing else changes for
 * it. A hub from before it drops an o: name it does not list without echoing it; the device keeps that row unsent and sends it
 * again with each sync, with the time it was chosen (core/sync.ts `unheard`), so the choice arrives once the hub is updated.
 */
export const SYNCED_SETTINGS = ['theme', 'fontFamily', 'fontSize', 'scrollFontSize', 'lineHeight', 'pageWidth', 'pinyin', 'hskThreshold',
  'pinyinStyle', 'toneColors', 'sandhi', 'autoKnown', 'script', 'paragraphTranslate', 'translator', 'claudeModel', 'localOnly', 'ttsRate',
  'layout', 'pageTurn', 'covers', 'translateTo'] as const;
export type SyncedSetting = (typeof SYNCED_SETTINGS)[number];

/**
 * The reader's settings rather than one library's: French chosen while reading Chinese is French in the Spanish library too.
 * Each device spreads them to its libraries itself (TARGET_KEY and LOCAL_ONLY_KEY in store/settings.ts), and only the Chinese
 * library syncs them. Synced by every library, two libraries on one device would fight: the Spanish one sending French it
 * read from the device while the Chinese one takes German from another, each undoing the other on every sync.
 */
export const READER_SETTINGS = ['translateTo', 'localOnly'] as const satisfies readonly SyncedSetting[];
/** Settings only the other languages use (Russian stress marks), so only their libraries sync them. */
export const OTHER_LANG_SETTINGS = ['stress'] as const satisfies readonly (keyof Settings)[];
const OTHER_SYNCED: readonly (keyof Settings)[] = [
  ...SYNCED_SETTINGS.filter((n) => !(READER_SETTINGS as readonly string[]).includes(n)), ...OTHER_LANG_SETTINGS,
];

/** The settings a library syncs: Chinese the whole list, as before languages synced; another language its own ones. */
export const librarySettings = (lang: string = 'zh'): readonly (keyof Settings)[] => (isOtherLang(lang) ? OTHER_SYNCED : SYNCED_SETTINGS);
export const isSyncedSetting = (name: string, lang: string = 'zh'): name is keyof Settings => (librarySettings(lang) as readonly string[]).includes(name);

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
