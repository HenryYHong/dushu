// Shared contracts for every Dushu module. ARCHITECTURE.md explains each one.
// Change a type here only together with every module that uses it.

// ------------------------------------------------------------ dictionary ---

/** One CC-CEDICT (or HSK-supplement) sense group: one headword + one reading. */
export interface DictEntry {
  trad: string;
  simp: string;
  /** Numbered pinyin exactly as built: "ni3 hao3", ü not u:/v, tone 5 = neutral. */
  pinyin: string;
  /** Definitions split on "/". Classifier notes stay in here ("CL:個|个[ge4]"). */
  defs: string[];
  /** Where the entry came from (absent = CC-CEDICT). */
  source?: 'cedict' | 'hsk' | 'wiktionary';
  /** A hand-written row from book-words.tsv: it leads its headword's senses. */
  curated?: true;
}

export interface RadicalInfo {
  /** Kangxi radical number, with a trailing ' for simplified forms ("120'"). */
  num: string;
  /** The radical as a Kangxi Radicals block char (⽔) or "" if none. */
  radicalChar: string;
  /** The unified ideograph for the radical (水). */
  char: string;
  /** Strokes beyond the radical. */
  residual: number;
}

export interface CharInfo {
  char: string;
  /** Tone-marked Mandarin readings, most customary first. May be empty for rare chars. */
  readings: string[];
  /** English definition (Unihan kDefinition, else the Wiktionary supplement), may be "". */
  definition: string;
  /** Where `readings`/`definition` came from, for attribution in the popup. */
  source: 'unihan' | 'wiktionary' | 'variant' | 'cedict' | 'none';
  strokes: number | null;
  radical: RadicalInfo | null;
  simplified: string[];
  traditional: string[];
  /** Semantic / Z / specialized-semantic variants. */
  variants: string[];
  /** For CJK compatibility ideographs: the unified ideograph it stands for. */
  compatOf?: string;
  /** Unicode block name ("CJK Unified Ideographs Extension B"). */
  block: string;
}

export interface HskInfo {
  /** HSK 3.0 (2021) band, 1–6, 7 means 7–9. */
  hsk3?: number;
  /** Old HSK 2.0 level 1–6. */
  hsk2?: number;
  /** Frequency rank from the HSK list (lower = more common). */
  rank?: number;
}

export interface DataMeta {
  built: string;
  unicode: string;
  counts: Record<string, number>;
  sources: { name: string; license: string; url: string }[];
}

export interface Dictionary {
  /** Exact headword lookup in either script. Input is normalized (compat ideographs, Kangxi radicals) first. */
  lookup(word: string): DictEntry[];
  hasWord(word: string): boolean;
  /** jieba count for segmentation; 0 if unseen. */
  freq(word: string): number;
  /** Per-character info for ANY CJK ideograph (all Unicode blocks); null only for non-Han input. */
  char(ch: string): CharInfo | null;
  hsk(word: string): HskInfo | null;
  /** Simplified HSK 3.0 words at levels 1..maxLevel (7 = 7–9), for "mark as known" bulk actions. */
  hskWords(maxLevel: number): string[];
  /** Dictionary words starting at text[start] (code-unit index), longest first. Always includes the single char if it is Han. */
  wordsAt(text: string, start: number): string[];
  /**
   * Best numbered pinyin for `word` in context, one syllable per code point
   * (non-Han code points get "" ). Handles polyphones (了 le/liǎo, 的, 着, 得, 地 …).
   */
  pinyinFor(word: string, ctx?: { prev?: string; next?: string; /** The token after `next` (for 倒了茶 vs 墙倒了). */ after?: string }): string[];
  toSimplified(text: string): string;
  toTraditional(text: string): string;
  meta: DataMeta;
}

// ---------------------------------------------------------- segmentation ---

/**
 * 'han' is a Chinese word (core/segment.ts). 'word' is a word of any other language a book is read in (src/lang): the
 * same role, a thing to look up, but no per-character pinyin. Use `isWord` (src/lang/token.ts) to ask "can this be looked up".
 */
export type TokenKind = 'han' | 'word' | 'latin' | 'num' | 'punct' | 'space' | 'other';

/** One piece of a Japanese word for furigana: `rt` is the reading shown over `text` (kanji); kana and letters have none. */
export interface RubyPart { text: string; rt?: string }

export interface Token {
  /** Text exactly as it appears in the source paragraph. */
  text: string;
  /** UTF-16 offsets into the paragraph. */
  start: number;
  end: number;
  kind: TokenKind;
  /** For han tokens: numbered pinyin per code point (same length as [...text]). */
  pinyin?: string[];
  /** True when `text` is a dictionary headword. */
  inDict: boolean;
  // ---- 'word' tokens only (src/lang). ----
  /** The key the word is looked up, saved and marked known under: its dictionary form, folded (LangEngine.normalize). */
  key?: string;
  /** Dictionary form as written (食べる for 食べた, ir for fuimos). */
  lemma?: string;
  /** Japanese: furigana pieces covering `text` exactly. */
  ruby?: RubyPart[];
  /** Japanese: the whole word's reading in hiragana. */
  reading?: string;
  /** Russian: UTF-16 offset inside `text` of the stressed vowel, when it is known and the word has more than one vowel. */
  stress?: number;
  /** A proper noun (a person or place), as the engine could tell. */
  name?: true;
}

// ----------------------------------------------------------------- books ---

export type BookFormat = 'epub' | 'txt' | 'pdf' | 'html' | 'md' | 'mobi' | 'azw3' | 'paste' | 'sample';
export type Script = 'simplified' | 'traditional' | 'mixed' | 'unknown';

export type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { t: 'quote'; text: string }
  | { t: 'img'; asset: string; alt?: string }
  | { t: 'hr' };

export interface Chapter {
  title: string;
  blocks: Block[];
  /** A later part of a chapter too long to keep whole: the text runs on from the part before, so it shows no title. */
  cont?: true;
}

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  script: Script;
  addedAt: number;
  lastOpenedAt?: number;
  chapterCount: number;
  /** Han characters in the whole book. */
  charCount: number;
  /** Han characters before each chapter (length chapterCount), for overall progress %. */
  chapterOffsets: number[];
  /** Asset key of the cover image, if any. */
  cover?: string;
  /** The SHA-256 of the cover the owner's Mac gave this book through the account (core/cloudBooks.ts), once it is shown. */
  coverFrom?: string;
  /** Chapter titles in order (length chapterCount), filled by books.add so the TOC needs no chapter reads. */
  chapterTitles?: string[];
  sourceName?: string;
  /** Free-form provenance (samples: source URL + public-domain note). */
  note?: string;
  /** IMPORT_VERSION of the importer that made the stored chapters; missing = 1. A book from the Mac or a classic made by an
   * older importer is imported again (ui/library/upgrade.ts). */
  importVersion?: number;
}

/** What an importer returns; the store assigns id/addedAt and saves assets. */
export interface ImportedBook {
  title: string;
  author: string;
  format: BookFormat;
  script: Script;
  chapters: Chapter[];
  /** Images referenced by Block.asset / cover, keyed by asset name (unique within the book). */
  assets: Map<string, Blob>;
  cover?: string;
  sourceName?: string;
  note?: string;
  /** IMPORT_VERSION of the importer that made it (src/import). */
  importVersion?: number;
}

export interface Progress {
  bookId: string;
  chapter: number;
  /** Index of the first block visible at the top of the viewport. */
  block: number;
  /** Pages layout only: UTF-16 offset of the first character on the page, inside `block`. A page often starts mid-paragraph. */
  offset?: number;
  /** 0–1, overall position in the book by Han characters. */
  percent: number;
  updatedAt: number;
}

// ------------------------------------------------------------ vocabulary ---

export interface SrsState {
  /** ms epoch when next due. */
  due: number;
  /** Days. 0 = new / relearning. */
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  last?: number;
}

/** 0 again, 1 hard, 2 good, 3 easy */
export type Grade = 0 | 1 | 2 | 3;

export interface VocabItem {
  /** Simplified headword; unique key. */
  id: string;
  simp: string;
  trad: string;
  /** Numbered pinyin of the reading the user saved. */
  pinyin: string;
  /** Short gloss shown on cards (first 2–3 definitions). */
  gloss: string;
  context?: { sentence: string; bookId?: string; bookTitle?: string; chapter?: number };
  addedAt: number;
  srs: SrsState;
}

/** A word looked up in the reader on one local day: one row per word per day, kept for practice (Vocabulary, Looked up). */
export interface LookupRow {
  /** Local day, YYYY-MM-DD. */
  day: string;
  /** Simplified headword. */
  id: string;
  /** The word as it was on the page (either script). */
  word: string;
  /** Numbered pinyin as read on the page. */
  pinyin: string;
  gloss: string;
  /** Times it was looked up that day. */
  count: number;
  first: number;
  last: number;
  context?: VocabItem['context'];
}

/** A bookmarked place in a book: a stored block and offset, like a reading place. */
export interface Bookmark {
  id: string;
  bookId: string;
  chapter: number;
  block: number;
  offset: number;
  /** The first words on the page, to recognize it by. */
  label: string;
  createdAt: number;
  /** The book's sync key (core/syncKeys bookKey), so the bookmark finds the book on another device or after it is added again. */
  bookKey?: string;
}

/** What a store change was about (Store.onChange). */
export type StoreChange = 'vocab' | 'known' | 'books' | 'lookups' | 'bookmarks';

/** One word's sightings on pages read without looking it up (settings.autoKnown). */
export interface SeenRow {
  word: string;
  /** Pages it was on since it was last looked up. */
  n: number;
  /** Different days among those. */
  days: number;
  /** The last of those days, as a local day number (days since 1970 in local time). */
  lastDay: number;
}

/**
 * Sync bookkeeping: the record `key` ('v:<word>', 'k:<word>', 'p:<book key>', 'l:<day>:<word>' for a looked-up word,
 * 'b:<bookmark id>') as this device last agreed with the Mac.
 */
export interface SyncRow {
  key: string;
  /** When the record last changed, on the device that changed it (ms epoch). */
  at: number;
  /** Hash of the record's contents; '-' when deleted. */
  sig: string;
  /** Changed here and not yet sent to the Mac. */
  dirty?: 1;
  /** A word saved here before this device ever agreed on it with the Mac (see core/sync.ts). */
  fresh?: 1;
  /** A reading place for a book this device does not have yet, applied when the book arrives. */
  held?: unknown;
  /** A saved word's signature without the book it names (core/sync.ts bareOf). */
  bare?: string;
}

export interface SyncApply {
  vocabPut?: VocabItem[];
  vocabDel?: string[];
  knownPut?: { word: string; auto?: true }[];
  knownDel?: string[];
  progressPut?: Progress[];
  /** Merged with the row here (mergeLookups): every device's lookups of a word on a day count. */
  lookupsPut?: LookupRow[];
  lookupsDel?: { day: string; id: string }[];
  bookmarksPut?: Bookmark[];
  bookmarksDel?: string[];
  rows?: SyncRow[];
  /** The rows as the syncer last read or wrote them, so a held place changed since is kept (see Store['sync'].write). */
  seen?: ReadonlyMap<string, SyncRow>;
}

export interface ReviewLog {
  id?: number;
  itemId: string;
  grade: Grade;
  at: number;
}

// -------------------------------------------------------------- settings ---

export type PinyinMode = 'off' | 'all' | 'unknown' | 'hsk';
export type PinyinStyle = 'marks' | 'numbers' | 'zhuyin';

export interface Settings {
  theme: 'system' | 'light' | 'sepia' | 'dark';
  fontFamily: 'serif' | 'sans' | 'kai';
  /** Pages layout font size in px. */
  fontSize: number;
  /** Scroll layout font size in px, independent of Pages. */
  scrollFontSize: number;
  lineHeight: number;
  /** Max text column width in px. */
  pageWidth: number;
  /** off | all | words not marked known | words above hskThreshold (or not in HSK). */
  pinyin: PinyinMode;
  hskThreshold: number;
  pinyinStyle: PinyinStyle;
  toneColors: boolean;
  /** Mark 一/不 tone changes (yí gè, bú shì). */
  sandhi: boolean;
  /** Learn known words from reading: a word read past often enough without being looked up is marked known (core/autoKnown.ts). */
  autoKnown: boolean;
  /** Display conversion of the book text. */
  script: 'original' | 'simplified' | 'traditional';
  /** How a single word is looked up. Double-click and drag-select always work. */
  lookupTrigger: 'click' | 'hover';
  paragraphTranslate: boolean;
  translator: 'auto' | 'local' | 'chrome' | 'claude' | 'account' | 'mymemory' | 'gloss';
  /** Sonnet 5.5 (default) or Haiku 5.5, asked through the owner's Mac. The API key lives only on the Mac. */
  claudeModel: string;
  /** Keep every sentence on the Mac: no Claude and no MyMemory, only the local model, on-device Chrome and the dictionary. */
  localOnly: boolean;
  ttsVoice: string;
  ttsRate: number;
  /** scroll = one long column per chapter; pages = paginated like a printed book (Apple Books style). */
  layout: 'scroll' | 'pages';
  /** In pages layout: auto = two pages side by side when the window is wide enough (iPad landscape, desktop). */
  spread: 'auto' | 'single' | 'double';
  /** Page-turn animation in pages layout. */
  pageTurn: 'flip' | 'slide' | 'none';
  /** Covers picked in the book cards' menus, "key:classic,key:modern" by book sync key (core/covers.ts). */
  covers: string;
  /** Russian: mark the stressed vowel of each word (lang/registry.ts `stress`). Absent in Chinese settings, which keep the
   * keys they always had. */
  stress?: boolean;
}

export interface SettingsStore {
  get(): Settings;
  set(patch: Partial<Settings>): void;
  /** Returns an unsubscribe function. Called after every set(). */
  subscribe(fn: (s: Settings, changed: (keyof Settings)[]) => void): () => void;
}

// --------------------------------------------------------------- lexicon ---

/**
 * Words the dictionary lacks but a book needs: character names (郭靖, 黄蓉, 王熙凤), places, martial-arts terms,
 * detected automatically per book, plus words the user adds. They take part in segmentation and lookup.
 */
export interface LexiconEntry {
  /** As written in the book (either script). */
  word: string;
  /** Numbered pinyin, one syllable per code point ("guo1 jing4"). */
  pinyin: string;
  /** Short English gloss ("name (person)", or the user's text). */
  gloss: string;
  kind: 'name' | 'place' | 'term' | 'user';
  /** Occurrences in the book, for detected entries. */
  count?: number;
  /** false = the user rejected a detected entry; kept so detection does not bring it back. */
  enabled: boolean;
  /** 'auto' = detected; 'user' = added or edited by the user (never overwritten by re-detection). */
  origin: 'auto' | 'user';
}

export interface Lexicon {
  has(word: string): boolean;
  get(word: string): LexiconEntry | undefined;
  /** Enabled entries only. */
  entries(): LexiconEntry[];
  /** Longest enabled entry, in code points (0 when empty). */
  maxLen: number;
}

// ----------------------------------------------------------------- store ---

/** What a backup import did, so the UI can say "Added 12 words, updated 3". */
export interface BackupReport {
  vocab: { added: number; updated: number; skipped: number };
  known: { added: number };
  progress: { added: number; updated: number; skipped: number };
  reviews: { added: number };
  /** The backup's settings (validated, no API key). The caller applies them with settings.set(). */
  settings?: Partial<Settings>;
}

export interface Store {
  /** 'idb' normally; 'memory' when IndexedDB was unavailable (data is lost on reload). */
  readonly backend: 'idb' | 'memory';
  books: {
    list(): Promise<BookMeta[]>;
    get(id: string): Promise<BookMeta | undefined>;
    chapter(id: string, index: number): Promise<Chapter | undefined>;
    add(book: ImportedBook): Promise<BookMeta>;
    update(id: string, patch: Partial<BookMeta>): Promise<void>;
    /** Put a new import of the same book in place of the stored one: same id, name and history, the reading place moved to
     * the same character. */
    replace(id: string, book: ImportedBook): Promise<BookMeta>;
    remove(id: string): Promise<void>;
    /** Object URL for an asset (cached per session; caller must not revoke). */
    assetUrl(bookId: string, asset: string): Promise<string | undefined>;
    /** An asset's bytes (an image the book has), for keeping the book in the sync account (core/cloudBooks.ts). */
    asset(bookId: string, asset: string): Promise<Blob | undefined>;
    /** Shows `image` as the book's cover from now on, noting where it came from (`from`, the image's digest). */
    setCover(id: string, image: Blob, from: string): Promise<void>;
  };
  progress: {
    get(bookId: string): Promise<Progress | undefined>;
    set(p: Progress): Promise<void>;
  };
  vocab: {
    list(): Promise<VocabItem[]>;
    get(id: string): Promise<VocabItem | undefined>;
    put(item: VocabItem): Promise<void>;
    remove(id: string): Promise<void>;
    due(now: number): Promise<VocabItem[]>;
    /** Synchronous membership, kept in memory. Accepts either script. */
    has(word: string): boolean;
    review(id: string, grade: Grade, now: number): Promise<VocabItem>;
    logs(): Promise<ReviewLog[]>;
  };
  known: {
    /** Synchronous; accepts simplified or traditional. */
    has(word: string): boolean;
    /**
     * Marks words known. `auto` = learned from reading (settings.autoKnown): it never replaces a word the person marked
     * themselves, while a plain add turns a learned word into one the person marked.
     */
    add(words: string[], opts?: { auto?: boolean }): Promise<void>;
    remove(words: string[]): Promise<void>;
    all(): string[];
    count(): number;
    /** Synchronous: true when the word is known only because reading marked it (accepts either script). */
    isAuto(word: string): boolean;
    /** How many known words reading marked. */
    autoCount(): number;
  };
  /** Words looked up in the reader, one row per word per day. Synced through the Mac (core/sync.ts). */
  lookups: {
    /** Counts a lookup of `row.id` on `row.day` (adds the row, or bumps its count and last time). */
    log(row: Omit<LookupRow, 'count' | 'first' | 'last'>, at: number): Promise<void>;
    list(): Promise<LookupRow[]>;
    remove(day: string, id: string): Promise<void>;
  };
  /** Bookmarked places. Synced through the Mac (core/sync.ts). */
  bookmarks: {
    list(bookId?: string): Promise<Bookmark[]>;
    put(b: Bookmark): Promise<void>;
    remove(id: string): Promise<void>;
  };
  /** Sightings per word for settings.autoKnown. Disposable: a wipe clears it, nothing syncs it. */
  seen: {
    get(words: string[]): Promise<SeenRow[]>;
    put(rows: SeenRow[]): Promise<void>;
    remove(words: string[]): Promise<void>;
    clear(): Promise<void>;
  };
  /** The sync bookkeeping (core/sync.ts). Nothing else reads or writes it. */
  sync: {
    rows(): Promise<SyncRow[]>;
    /**
     * Writes sync rows. With `seen` (the rows as the caller last read or wrote them), a place row keeps the held place stored
     * now when it is no longer the one in `seen`: a book deleted or added again since changed it, and that stands.
     */
    write(put: SyncRow[], del?: string[], seen?: ReadonlyMap<string, SyncRow>): Promise<void>;
    /**
     * Saves what came from another device, together with the sync rows that record it, in one transaction. Open screens
     * hear it as a remote change (info.remote), the same as a save in another tab.
     */
    apply(change: SyncApply): Promise<void>;
  };
  /**
   * Per-scope lexicon rows. scope = a bookId for that book's names/terms, or '*' for the user's own words
   * that apply to every book. `detected(scope)` is true once automatic detection has run for that book.
   */
  lexicon: {
    get(scope: string): Promise<LexiconEntry[]>;
    /** Replace every 'auto' row of the scope (user rows are kept) and mark the scope detected. */
    putDetected(scope: string, entries: LexiconEntry[], version?: number): Promise<void>;
    upsert(scope: string, entry: LexiconEntry): Promise<void>;
    remove(scope: string, word: string): Promise<void>;
    /** True once detection has run for the scope with a detector at least as new as `minVersion`. */
    detected(scope: string, minVersion?: number): Promise<boolean>;
  };
  /** Everything except book contents, as JSON (for backup). */
  exportBackup(): Promise<string>;
  /** Merges a backup (newer wins). Settings are returned, never applied by the store. */
  importBackup(json: string): Promise<BackupReport>;
  /** Deletes every book, word, progress record and review log. */
  wipe(): Promise<void>;
  /**
   * Fires on any vocab/known/books change so open screens can refresh. `info.remote` is true when another tab made the
   * change (the store has already reloaded what it keeps in memory by then).
   */
  onChange(fn: (what: StoreChange, info?: { remote: boolean }) => void): () => void;
  /**
   * Called by main.ts once the dictionary loads (dict.toSimplified). vocab.has / known.has then
   * also match a word written in the other script. Before that, matching is exact.
   */
  setNormalizer(fn: (word: string) => string): void;
}

// ------------------------------------------------------------ translate ---

export type TranslatorId = 'local' | 'chrome' | 'claude' | 'account' | 'mymemory' | 'gloss';

export interface TranslateRequest {
  text: string;
  /** Surrounding paragraph, for better translations of fragments. */
  context?: string;
  /** Book-specific readings/glosses, as reference data for names and specialist terms. */
  terms?: { word: string; pinyin: string; gloss: string; kind?: 'name' | 'term' | 'idiom' }[];
  /** translate = English only; explain = translation + short notes on words and grammar. */
  mode: 'translate' | 'explain';
  /** The language of `text` when it is not Chinese (src/lang): the prompt and the checks follow it. */
  lang?: 'ja' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ru';
}

export interface Translator {
  id: TranslatorId;
  label: string;
  /** 'yes' ready now, 'download' needs a one-time model download on user gesture, 'no' unusable. */
  availability(): Promise<'yes' | 'download' | 'no'>;
  /** Streams partial output to onDelta (full text so far) when the provider supports it. */
  translate(
    req: TranslateRequest,
    opts?: { signal?: AbortSignal; onDelta?: (soFar: string) => void; onNote?: (note: { kind: 'unverified'; detail: string }) => void },
  ): Promise<string>;
}

// --------------------------------------------------------------- app shell ---

export interface AppContext {
  /** Resolves once data files are parsed; cached. */
  dict(): Promise<Dictionary>;
  /** Present after dict() resolves; screens that render text may assume it in event handlers. */
  dictSync(): Dictionary | null;
  settings: SettingsStore;
  store: Store;
  navigate(hash: string): void;
  toast(message: string, opts?: { action?: { label: string; run: () => void }; ms?: number }): void;
}

/** Every screen module exports `mount`. Returning a function = cleanup on route change. */
export type MountFn = (
  root: HTMLElement,
  params: Record<string, string>,
  ctx: AppContext,
) => void | (() => void) | Promise<void | (() => void)>;
