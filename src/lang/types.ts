// The contract between the app and the engine of a language a book is read in, other than Chinese. Chinese keeps its own
// modules (core/dict.ts, core/segment.ts, core/pinyin.ts); every other language plugs in here. LANGUAGES.md explains it.
import type { RubySpan, Token } from '../types';

/** The languages Dushu reads. 'zh' is the original app; the rest load an engine from src/lang/<id>/. */
export type LangId = 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ru';

/** One sense of a dictionary entry. */
export interface Sense {
  /** Part of speech in plain English ("noun", "verb (ichidan)", "adjective"), when the source has one. */
  pos?: string;
  /** English glosses, most useful first. Never empty. */
  glosses: string[];
  /** Usage notes in plain English ("colloquial", "archaic", "usually written in kana", "Latin America"). */
  notes?: string[];
}

/** One dictionary entry for a word: one headword with its senses. */
export interface WordEntry {
  /** The dictionary form as written: 食べる, ir, Haus, дом. */
  head: string;
  /** Japanese: the kana reading. Russian: the headword with its stress marked (до́ма). Absent elsewhere. */
  reading?: string;
  /** Other written forms the learner may meet (Japanese kanji spellings, a German old spelling). */
  alts?: string[];
  senses: Sense[];
  /** Nouns: grammatical gender, 'm' 'f' 'n', 'm/f' (both), 'pl' (plural only). */
  gender?: string;
  /** The level the word belongs to in the language's scheme (1 = easiest; LangInfo.levels). */
  level?: number;
  /** A common word (JMdict's priority marks, or the top of the frequency list). */
  common?: boolean;
  /** Where it came from, for the credit line under the entry: 'JMdict', 'Wiktionary', 'name'. */
  source: string;
  /**
   * Russian verbs: the aspect, 'pf' perfective, 'impf' imperfective, 'both' (biaspectual), when the dictionary says. The card
   * can then say "perfective; partner: брать" for взять.
   */
  aspect?: 'pf' | 'impf' | 'both';
  /** The verbs of the other aspect, with their stress marked: брать for взять, узна́ть for узнавать. */
  partners?: string[];
}

/** What tapping a word shows. */
export interface WordLookup {
  /** The word as it is on the page. */
  surface: string;
  /** The key it is saved and marked known under (LangEngine.normalize of its dictionary form). */
  key: string;
  /** Best first. Empty when nothing matched (the popup then offers a translation and "add your own meaning"). */
  entries: WordEntry[];
  /**
   * How the word on the page relates to the entry, in plain English, when it is not the dictionary form: "past tense",
   * "polite negative", "plural", "first-person plural, preterite". Shown as "past tense of 食べる".
   */
  form?: string;
  /**
   * The pieces of a word the reader may want one by one: Spanish clitics (dámelo = da + me + lo), French elision (l' + homme),
   * German compounds (Haus + tür). Each piece can be looked up on its own (its key) and may carry a short gloss.
   */
  parts?: { text: string; key?: string; gloss?: string; reading?: string }[];
  /** Japanese: the kanji in the word, in order, each once. */
  chars?: KanjiInfo[];
  /** A proper noun (a person or place) the dictionary does not list. */
  name?: boolean;
  /**
   * The fixed phrase the word is part of where it stands (sin embargo, потому что), folded: the first entry is then the
   * phrase's, and `key` stays the word's own (what the reader marks known or saved).
   */
  phrase?: string;
}

export interface KanjiInfo {
  char: string;
  meanings: string[];
  /** On readings in katakana, kun readings in hiragana (with okurigana after a dot: た.べる). */
  on: string[];
  kun: string[];
  strokes?: number;
  /** Japanese school grade (1–6, 8 = secondary school, 9–10 = names). */
  grade?: number;
  /** Old JLPT level 1–4 (KANJIDIC2), when listed. */
  jlpt?: number;
}

/** A language's loaded engine. Everything is synchronous once loaded. */
export interface LangEngine {
  readonly id: LangId;
  /**
   * A paragraph as tokens that cover it exactly (concatenated `text` === input; `start`/`end` UTF-16 offsets). Words of the
   * language are kind 'word' with `key` (and `lemma`, `ruby`, `reading`, `stress`, `name` as the language has them); spaces
   * 'space', punctuation 'punct' (one token per mark), digits 'num', anything in another script 'latin' or 'other'.
   * `ruby`: readings the book prints over stretches of this paragraph (types.ts RubySpan). An engine that knows what to do
   * with them takes them over its own guess (a span is one word, read as printed); others ignore them.
   */
  segment(text: string, opts?: { ruby?: readonly RubySpan[] }): Token[];
  /** The entries for a word on the page. `token` is the token it was cut as, when it was tapped (it carries the lemma). */
  lookup(surface: string, ctx?: { token?: Token; sentence?: string }): WordLookup;
  /** The key for a word with no context (store.known/vocab use it to match any form of a word): its folded dictionary form. */
  normalize(word: string): string;
  /** The level of a key (1..LangInfo.levels.labels.length), undefined when the word is not on any list. */
  level(key: string): number | undefined;
  /** Keys at levels 1..max, for "mark these as known". */
  levelWords(max: number): string[];
  /**
   * A short English hint for a word in running text (one to three words, "to eat", "house"), shown over hard words when the
   * reader asks for hints. Undefined when the dictionary has none.
   */
  hint(token: Token): string | undefined;
  /**
   * A new book opens: forget what the last one taught the engine (the names it uses). Given the book's text, learn its names
   * up front, so a name that starts a sentence on the first page is read as one (Platero y yo opens "Platero es pequeño").
   * Optional; without it an engine learns a book's names as it reads its paragraphs.
   */
  beginBook?(text?: string): void;
  /** Facts about the data that loaded (counts, sources), shown in About. */
  readonly meta: { built: string; counts: Record<string, number>; sources: { name: string; license: string; url: string }[] };
}

/** What every src/lang/<id>/index.ts exports. */
export interface LangModule {
  /**
   * Loads the engine's data from `baseUrl` (…/data/<id>/). `fetchBytes(name)` overrides fetching (Node tests read
   * public/data/<id>/ from disk); names include their extension and the bytes are as stored (gzip is undone by the engine).
   */
  loadEngine(baseUrl: string, opts?: { fetchBytes?: (name: string) => Promise<Uint8Array>; onProgress?: (done: number, total: number) => void }): Promise<LangEngine>;
}
