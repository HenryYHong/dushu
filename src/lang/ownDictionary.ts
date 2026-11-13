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
}
export type OwnTable = Map<string, OwnEntry[]>;

/** One meaning cell: "{label, label}definition". */
function sense(cell: string, pos: string): Sense {
  const m = /^\{([^}]*)\}/.exec(cell);
  const glosses = [(m ? cell.slice(m[0].length) : cell).trim()];
  return m ? { pos, glosses, notes: m[1].split(', ').filter(Boolean) } : { pos, glosses };
}

/** native.tsv.gz (or a native-rare shard) as a table: key → its entries, the main dictionary's commonest part of speech first. */
export function parseOwnTable(text: string): OwnTable {
  const table: OwnTable = new Map();
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const cells = line.split('\t');
    if (cells.length < 4) continue;
    const [key, pos, hint] = cells;
    const senses = cells.slice(3).filter(Boolean).map((c) => sense(c, pos === 'phrase' ? '' : pos));
    if (!senses.length) continue;
    const list = table.get(key);
    const entry = { pos, hint, senses };
    if (list) list.push(entry);
    else table.set(key, [entry]);
  }
  return table;
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

/** Tests: forget what was loaded. */
export function resetOwnDictionary(): void {
  loads.clear();
  ready = null;
  reader = 'en';
}

// --------------------------------------------------------------------------------------------------------- engine ---

/** Credited under an entry from the own-language dictionary. */
export const OWN_SOURCE = 'Wiktionary';

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
      const list = [key, e.head, e.reading, ...(e.alts ?? [])].map((k) => (k ? table.get(k) : undefined)).find((l) => l?.length);
      if (!list) return null;
      const senses = [...new Map(list.flatMap((x) => x.senses).map((x) => [x.glosses[0], x])).values()].slice(0, 6);
      return { ...e, senses, source: OWN_SOURCE };
    }
    const list = table.get(key) ?? table.get(engine.normalize(e.head));
    if (!list?.length) return null;
    const pos = e.senses[0]?.pos;
    const own = list.find((x) => x.pos === pos) ?? (engine.id === 'en' || !pos ? list[0] : undefined);
    return own ? { ...e, senses: own.senses, source: OWN_SOURCE } : null;
  };
  const lookup = (surface: string, ctx?: { token?: Token; sentence?: string }): WordLookup => {
    const lu = engine.lookup(surface, ctx);
    const table = tableFor(engine.id);
    if (!table || !lu.entries.length) return lu;
    const seen = new Set<string>();
    const entries: WordEntry[] = [];
    lu.entries.forEach((e, i) => {
      // A fixed phrase's entry comes first, under the phrase's key.
      const key = i === 0 && lu.phrase ? lu.phrase : engine.normalize(e.head);
      const own = swap(table, e, key) ?? e;
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
    ? { ...lu, entries: lu.entries.map((e) => ({ ...e, level: engine.rankLevel!(engine.normalize(e.head)) })) } : lu);
  return {
    id: engine.id,
    segment: (text, opts) => engine.segment(text, opts),
    lookup: (surface, ctx) => leveled(lookup(surface, ctx)),
    normalize: (w) => engine.normalize(w),
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
