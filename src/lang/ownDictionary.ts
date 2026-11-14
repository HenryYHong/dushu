// Meanings in the book's own language. Someone reading their own language gets words explained in it, in plain words: a
// Spanish speaker reading Spanish sees Spanish definitions (Spanish Wiktionary), and the same for French, German, Italian,
// Portuguese and Russian. English is for anyone: its meanings are in simple English (Simple English Wiktionary, then English
// Wiktionary), and a reader of another language gets them translated on the card as for every other library. Only Chinese
// readers of English keep ECDICT's Chinese, written for them. scripts/lang/native/build.py makes the data
// (public/data/<id>/native.tsv.gz, and data/en/native-rare/ for English's rare words).
//
// The reader's language is the one sentences are translated into (Settings › Translation, shared by every library). The
// engine is wrapped (withOwnDictionary), so every place that looks a word up (the card, saving a word, Vocabulary, the word by
// word gloss) gets the same meanings without knowing where they came from.
import type { Token } from '../types';
import type { LangEngine, LangId, Sense, WordEntry, WordLookup } from './types';
import { fetchDataText } from '../core/dataFetch';

/** The libraries with a dictionary in their own language. */
const HAS_OWN: ReadonlySet<LangId> = new Set<LangId>(['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh']);

let reader = 'en';
const listeners = new Set<() => void>();

/** Takes the reader's language from Settings › Translation (zh-Hant counts as Chinese). main.ts keeps it current. */
export function setReaderLanguage(translateTo: string | undefined): void {
  const next = readerOf(translateTo);
  if (next === reader) return;
  reader = next;
  for (const f of listeners) f();
}
export const readerLanguage = (): string => reader;
/** Runs `f` when the reader's language changes; returns the unsubscribe. */
export function onReaderLanguage(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Whether the `id` library has a dictionary in its own language. */
export const hasOwnDictionary = (id: LangId): boolean => HAS_OWN.has(id);

/** A reader's language from a Translate-into choice ('zh-Hant' is Chinese). */
export const readerOf = (translateTo: string | undefined): string => (translateTo || 'en').split('-')[0];

/** Whether the `id` library explains words in its own language for a reader of `r` (this one's by default). */
export function ownDictionary(id: LangId, r: string = reader): boolean {
  if (!HAS_OWN.has(id)) return false;
  return id === 'en' ? r !== 'zh' : r === id;
}

/** Whether a reader of `r` reads the `id` library in their own language (nothing on the card needs translating then). */
export const readsOwnLanguage = (id: LangId, r: string = reader): boolean => ownDictionary(id, r) && r === id;

/** The language the `id` library's word meanings are in for a reader of `r`: its own, else ECDICT's Chinese for English, else English. */
export function glossCode(id: LangId, r: string = reader): string {
  return ownDictionary(id, r) ? id : id === 'en' ? 'zh' : 'en';
}

// ------------------------------------------------------------------------------------------------------------ data ---

export interface OwnEntry {
  pos: string;
  /** A simpler word, for over the text (empty when there is none). */
  hint: string;
  senses: Sense[];
  /** Japanese: under a kana word, the kanji its entries are written with ("=息,粋" in the part-of-speech column). */
  kanji?: string[];
  /** Japanese: under a kanji spelling, the readings (hiragana) this line is read as ("@いき"; 息 read そく is another line). */
  readings?: string[];
}
/** A word's entries by its key. */
export interface OwnTable {
  get(key: string): OwnEntry[] | undefined;
  readonly size: number;
}

/** One meaning cell: "{label, label}definition". */
function sense(cell: string, pos: string): Sense {
  const m = /^\{([^}]*)\}/.exec(cell);
  const glosses = [(m ? cell.slice(m[0].length) : cell).trim()];
  return m ? { pos, glosses, notes: m[1].split(', ').filter(Boolean) } : { pos, glosses };
}

function entryOf(line: string): OwnEntry | null {
  const cells = line.split('\t');
  if (cells.length < 4) return null;
  const [, column, hint] = cells;
  const kanji = column.startsWith('=') ? column.slice(1).split(',').filter(Boolean) : undefined;
  const readings = column.startsWith('@') ? column.slice(1).split(',').filter(Boolean) : undefined;
  const pos = kanji || readings ? '' : column;
  const senses = cells.slice(3).filter(Boolean).map((c) => sense(c, pos === 'phrase' ? '' : pos));
  return senses.length ? { pos, hint, senses, ...(kanji?.length ? { kanji } : {}), ...(readings?.length ? { readings } : {}) } : null;
}

/** Katakana as hiragana (ソク: そく), so readings compare whichever way they are written. */
const hiragana = (s: string) => s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * A Japanese word's own entries by its spellings (its key, the word as written, its other spellings), the lines under a kanji
 * spelling kept to those read as the word is (息 いき "breath", not 息 そく "son"); else by its readings: for a word written in
 * kanji, only the entries under a kana spelling that name one of its kanji, or failing those the ones that name none. An entry
 * that names only other kanji is another word read the same (いき is 息 and 粋, not 行き). Null when there are none.
 */
export function japaneseOwn(table: OwnTable, spellings: readonly (string | undefined)[], reading: string | undefined): OwnEntry[] | null {
  const kana = (s: string) => /^[\u3040-\u30ffー]+$/.test(s);
  const all = [...new Set([...spellings, reading].filter((s): s is string => !!s))];
  const written = all.filter((s) => !kana(s));
  const readAs = new Set(all.filter(kana).map(hiragana));
  /** A line under a kanji spelling that is this word: read as it is, or written for it (no reading named). */
  const mine = (x: OwnEntry) => !x.readings || !readAs.size || x.readings.some((r) => readAs.has(r));
  const unsure = (x: OwnEntry) => x.readings?.length === 1 && x.readings[0] === '?';
  for (const k of written.length ? written : all) {
    const list = table.get(k)?.filter(mine);
    if (list?.length) return list;
  }
  if (!written.length) return null;
  // By its reading: the entries naming one of its kanji, then lines under its kanji whose reading is not said, then the
  // entries naming no kanji.
  let open: OwnEntry[] = [];
  for (const k of all.filter(kana)) {
    const rows = table.get(k) ?? [];
    const named = rows.filter((x) => x.kanji?.some((w) => written.includes(w)));
    if (named.length) return named;
    if (!open.length) open = rows.filter((x) => !x.kanji?.length);
  }
  const unknown = written.flatMap((k) => table.get(k)?.filter(unsure) ?? []);
  return unknown.length ? unknown : open.length ? open : null;
}

/**
 * native.tsv.gz (or a native-rare shard) as a table: key → its entries, the main dictionary's commonest part of speech first.
 * Only the lines are indexed up front; a word's meanings are read the first time it is asked for (a phone reads 70,000 words'
 * worth of lines in a few tens of milliseconds, and the book asks for a few hundred).
 */
export function parseOwnTable(text: string): OwnTable {
  const lines = new Map<string, string[]>();
  let at = 0;
  while (at < text.length) {
    let end = text.indexOf('\n', at);
    if (end < 0) end = text.length;
    if (end > at && text.charCodeAt(at) !== 35 /* # */) {
      const tab = text.indexOf('\t', at);
      if (tab > at && tab < end) {
        const key = text.slice(at, tab);
        const line = text.slice(at, end);
        const list = lines.get(key);
        if (list) list.push(line); else lines.set(key, [line]);
      }
    }
    at = end + 1;
  }
  const parsed = new Map<string, OwnEntry[] | null>();
  return {
    get size() { return lines.size; },
    get(key: string) {
      let got = parsed.get(key);
      if (got === undefined) {
        const raw = lines.get(key);
        got = raw ? raw.map(entryOf).filter((e): e is OwnEntry => !!e) : null;
        if (got && !got.length) got = null;
        parsed.set(key, got);
      }
      return got ?? undefined;
    },
  };
}

const loads = new Map<string, Promise<OwnTable | null>>();
let ready: { id: LangId; table: OwnTable } | null = null;

/**
 * Loads the `id` library's own-language dictionary from `base` (…/data/<id>/) when this reader needs it, once. Resolves when it
 * is in (or it is not needed, or it could not be fetched: the card then keeps the main dictionary's meanings).
 */
export function loadOwnDictionary(id: LangId, base: string, fetchText: (url: string) => Promise<string> = fetchDataText): Promise<void> {
  if (!ownDictionary(id)) return Promise.resolve();
  const url = `${base}native.tsv.gz`;
  let p = loads.get(url);
  if (!p) {
    p = fetchText(url).then(parseOwnTable).catch(() => { loads.delete(url); return null; });
    loads.set(url, p);
  }
  return p.then((table) => { if (table) ready = { id, table }; });
}

/** The loaded table for `id`, when this reader uses it. */
const tableFor = (id: LangId): OwnTable | null => (ownDictionary(id) && ready?.id === id ? ready.table : null);

/**
 * The own-language meanings of a word in the `id` library for this reader, by the first of `spellings` the table has (Chinese:
 * traditional, then simplified, as Wiktionary files words under the traditional), each meaning once. Null when there are none.
 */
export function ownMeanings(id: LangId, spellings: readonly string[]): string[] | null {
  const table = tableFor(id);
  if (!table) return null;
  for (const s of spellings) {
    const list = s ? table.get(s) : undefined;
    // A label goes in front, in the brackets Chinese and Japanese use: （用於否定句）完全.
    if (list?.length) return [...new Set(list.flatMap((e) => e.senses.map((x) => `${x.notes?.length ? `（${x.notes.join('，')}）` : ''}${x.glosses.join('; ')}`)))];
  }
  return null;
}

/** A CC-CEDICT entry that is only a variant, a pointer, a sound, an archaic word or a name: not the likely spelling of the word. */
function minorEntry(e: { pinyin: string; defs: readonly string[] }): boolean {
  return /^[A-Z]/.test(e.pinyin) || e.defs.every((d) => /(?:^|\b)(?:old |archaic |Japanese |ancient )?variant of\b|^see |^used in|^surname|\((?:archaic|old|onom\.)\)|^\(onom\.\)/i.test(d));
}

/**
 * The spellings a Chinese word's meanings in Chinese are looked up under, the likeliest first: the word as written, for a reader
 * of traditional characters; then CC-CEDICT's spellings, those meaning most first and those only a variant, a pointer, a sound,
 * an archaic word or a name last (家: 傢 is only "used in 傢俱"; 后: 後 "back, behind, after..." before 后 "empress"; 当: 噹 is a
 * bell's sound); then the word converted.
 */
export function chineseSpellings(word: string, entries: readonly { trad: string; simp: string; pinyin: string; defs: readonly string[] }[],
  opts: { traditional?: string; readsTraditional?: boolean } = {}): string[] {
  const ordered = entries.map((e, i) => ({ e, i, minor: minorEntry(e) }))
    .sort((a, b) => Number(a.minor) - Number(b.minor) || b.e.defs.length - a.e.defs.length || a.i - b.i).map((x) => x.e);
  return [...new Set([
    ...(opts.readsTraditional ? [word] : []),
    ...ordered.flatMap((e) => [e.trad, e.simp]),
    word,
    opts.traditional,
  ].filter((s): s is string => !!s))];
}

/**
 * A Chinese word's meanings in Chinese from all its spellings (chineseSpellings), the likeliest spelling's first, each once, at
 * most `max`; a later spelling's note that it is a variant ("「國」的簡體字") left out. Null when there are none.
 */
export function chineseOwnMeanings(spellings: readonly string[], max = 8): string[] | null {
  const out: string[] = [];
  spellings.forEach((s, i) => {
    for (const m of ownMeanings('zh', [s]) ?? []) {
      if (i > 0 && out.length && /的(?:簡體字|異體字|繁體字|俗字|古字)/.test(m)) continue;
      if (!out.includes(m) && out.length < max) out.push(m);
    }
  });
  return out.length ? out : null;
}

/** Tests: forget what was loaded. */
export function resetOwnDictionary(): void {
  loads.clear();
  ready = null;
  reader = 'en';
}

// --------------------------------------------------------------------------------------------------------- engine ---

/**
 * Marks an entry whose meanings are the own-language dictionary's (Wiktionary's, or written for the app where it has none).
 * The main dictionaries mark theirs 'Wiktionary' and 'JMdict', so this is a name of its own.
 */
export const OWN_SOURCE = 'own language';
/** The most meanings an entry shows when it gathers them from two parts of speech. */
const MAX_SENSES = 8;

/**
 * `engine` with its meanings and hints in the book's own language when this reader gets them (ownDictionary). The main
 * dictionary still reads the word (its form, its key, its level, its sound); only the meanings change. An entry the
 * own-language dictionary lacks keeps its meanings, except in English, where a meaning in another part of speech is still
 * better than Chinese for someone who does not read it.
 */
export function withOwnDictionary(engine: LangEngine): LangEngine {
  const swap = (table: OwnTable, e: WordEntry, key: string): WordEntry | null => {
    if (engine.id === 'ja') {
      // By any of its spellings (たべる or 食べる): Japanese Wiktionary's parts of speech are not JMdict's.
      const list = japaneseOwn(table, [key, e.head, ...(e.alts ?? [])], e.reading);
      if (!list) return null;
      const senses = [...new Map(list.flatMap((x) => x.senses).map((x) => [x.glosses[0], x])).values()].slice(0, 6);
      return { ...e, senses, source: OWN_SOURCE };
    }
    // Under its own key; only a headword with no line of its own takes its likeliest word's (Portuguese "baixinha": baixo).
    const list = table.get(key) ?? table.get(engine.normalize(e.head));
    if (!list?.length) return null;
    // Every part of speech the entry's meanings have, in order (Spanish "mierda" is "nothing" as a pronoun, then the noun).
    const poses = [...new Set(e.senses.map((s) => s.pos ?? ''))];
    const mine = poses.flatMap((p) => list.filter((x) => x.pos === p));
    if (mine.length) return { ...e, senses: mine.flatMap((x) => x.senses).slice(0, MAX_SENSES), source: OWN_SOURCE };
    const own = engine.id === 'en' || !poses[0] ? list[0] : undefined;
    return own ? { ...e, senses: own.senses, source: OWN_SOURCE } : null;
  };
  const lookup = (surface: string, ctx?: { token?: Token; sentence?: string }): WordLookup => {
    const lu = engine.lookup(surface, ctx);
    const table = tableFor(engine.id);
    if (!table || !lu.entries.length) return lu;
    const seen = new Set<string>();
    const entries: WordEntry[] = [];
    const swapped = lu.entries.map((e, i) => {
      // A fixed phrase's entry comes first, under the phrase's key.
      // Its own key: never normalize's, which takes a headword that is also a form to another word (sei: essere).
      const key = i === 0 && lu.phrase ? lu.phrase : engine.keyOf ? engine.keyOf(e.head) : engine.normalize(e.head);
      return swap(table, e, key);
    });
    // One language on the card: when the word has meanings in it, the entries without any go (correu: correr, not the English
    // corréu); a word with none keeps the main dictionary's.
    const any = swapped.some(Boolean);
    lu.entries.forEach((e, i) => {
      const own = swapped[i] ?? (any ? null : e);
      if (!own) return;
      const id = `${own.head}\u0000${own.senses[0]?.pos ?? ''}\u0000${own.source}`;
      if (own.source === OWN_SOURCE && seen.has(id)) return;
      seen.add(id);
      entries.push(own);
    });
    return { ...lu, entries };
  };
  const hint = (token: Token): string | undefined => {
    const table = tableFor(engine.id);
    if (!table) return engine.hint(token);
    // In the own language only a simpler word helps; the main dictionary's hint is in another language.
    const key = token.key ?? engine.normalize(token.text);
    return table.get(key)?.find((x) => x.hint)?.hint || undefined;
  };
  // English levels by how common a word is (A1–C2) for anyone but a Chinese reader, whose are the Chinese exam lists
  // (registry.ts names them the same way).
  const byRank = (): boolean => engine.id === 'en' && glossCode('en') !== 'zh' && !!engine.rankLevel;
  const level = (k: string) => (byRank() ? engine.rankLevel!(k) : engine.level(k));
  const leveled = (lu: WordLookup): WordLookup => (byRank()
    ? { ...lu, entries: lu.entries.map((e) => ({ ...e, level: engine.rankLevel!(engine.keyOf ? engine.keyOf(e.head) : engine.normalize(e.head)) })) } : lu);
  return {
    id: engine.id,
    segment: (text, opts) => engine.segment(text, opts),
    lookup: (surface, ctx) => leveled(lookup(surface, ctx)),
    normalize: (w) => engine.normalize(w),
    keyOf: engine.keyOf ? (h) => engine.keyOf!(h) : undefined,
    level,
    levelWords: (max) => (byRank() ? engine.rankLevelWords!(max) : engine.levelWords(max)),
    rankLevel: engine.rankLevel ? (k) => engine.rankLevel!(k) : undefined,
    rankLevelWords: engine.rankLevelWords ? (m) => engine.rankLevelWords!(m) : undefined,
    hint,
    beginBook: engine.beginBook ? (text) => engine.beginBook!(text) : undefined,
    // Its sources credited too (About) while its meanings are the ones shown.
    get meta() {
      const m = engine.meta;
      return tableFor(engine.id) && m.ownSources?.length ? { ...m, sources: [...m.sources, ...m.ownSources] } : m;
    },
  };
}

// ----------------------------------------------------------------------------------------------- English rare words ---

const shards = new Map<string, Promise<OwnTable | null>>();

/**
 * An English rare word (one the main dictionary leaves out) in simple English, from data/en/native-rare/ (sharded as
 * data/en/rare is): its key and entries, or null. `candidates` are what the word may be, itself first (rareCandidates).
 */
export async function ownRareLookup(base: string, candidates: string[], shardOf: (key: string) => string,
  fetchText: (url: string) => Promise<string> = fetchDataText): Promise<{ key: string; entries: OwnEntry[] } | null> {
  for (const key of candidates) {
    if (!/^[a-z][a-z'-]*$/.test(key)) continue;
    const url = `${base}native-rare/${shardOf(key)}.tsv.gz`;
    let p = shards.get(url);
    if (!p) {
      p = fetchText(url).then(parseOwnTable).catch(() => { shards.delete(url); return null; });
      shards.set(url, p);
    }
    const entries = (await p)?.get(key);
    if (entries?.length) return { key, entries };
  }
  return null;
}
