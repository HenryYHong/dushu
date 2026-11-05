// The dictionary: CC-CEDICT words, Unihan characters, segmentation vocabulary, HSK, script conversion.
// Contract: ARCHITECTURE.md §3 and §4.1.
import type { CharInfo, DataMeta, DictEntry, Dictionary, HskInfo, LexiconEntry, OldSpellings, RadicalInfo } from '../types';
import { asksWithNa } from './bookStyle';
import { ConvTable } from './convert';
import { hanBlockName } from './blocks';
import { baseOf, markedToNumbered, normalizePinyinField, numberedToMarked } from './pinyin';
import { CHAR_DEFAULTS, WORD_READINGS, firstCodePointOf, lastCodePoint, polyphoneRule } from './polyphone';
import { isHanCodePoint } from './text';
import { compareReading } from './hskMatch';
import type { ReadingChooser, ReadingSite } from './readingModel';

// ---------------------------------------------------------------- loading ---

interface LoadOptions {
  /**
   * Returns the decompressed text of a data file. `name` is the file name as served ("cedict.tsv.gz",
   * "meta.json"). Rejecting means "missing": fine for the optional chars-extra and cedict-extra, fatal for the rest.
   */
  fetchText?: (name: string) => Promise<string>;
  /** Called with (done, total) where total is always 100. Monotone. */
  onProgress?: (done: number, total: number) => void;
  /** Given each data file as downloaded (the default fetchText only), to keep a copy. */
  keep?: (url: string, response: Response) => void;
  /** Bytes downloaded so far and the total of the sizes known (default fetchText only). */
  onBytes?: (loaded: number, total: number) => void;
}

const REQUIRED = ['cedict', 'chars', 'words', 'hsk', 't2s', 's2t', 'radicals'] as const;
const CHUNK = 8000;
/** Iterations of a derived-index loop between yields. */
const INDEX_CHUNK = 40000;

async function gunzipToText(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  const { gunzipSync, strFromU8 } = await import('fflate');
  return strFromU8(gunzipSync(bytes));
}

/** Fetch one data file. Handles servers that gunzip for us and dev servers that answer 404s with index.html. */
export async function fetchDataText(url: string, keep?: LoadOptions['keep'], count?: (size: number, read: number) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (keep && /gzip|json/.test(res.headers.get('content-type') ?? '')) keep(url, res.clone());
  const bytes = count && res.body
    ? await readCounting(res.body, Number(res.headers.get('content-length')) || 0, count)
    : new Uint8Array(await res.arrayBuffer());
  const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzipToText(bytes) : new TextDecoder().decode(bytes);
  if (/^\s*<(!doctype|html)/i.test(text.slice(0, 200))) throw new Error(`${url}: not a data file`);
  return text;
}

/** The whole body, reporting its size (Content-Length, 0 when unknown) and then each piece as it arrives. */
async function readCounting(body: ReadableStream<Uint8Array>, size: number, count: (size: number, read: number) => void): Promise<Uint8Array> {
  count(size, 0);
  const parts: Uint8Array[] = [];
  let n = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    count(0, value.length);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

let yieldChannel: MessageChannel | null = null;
/**
 * Give the event loop a turn so the page can paint and handle input between parse chunks.
 * A MessageChannel round trip is a plain task (no 4 ms timer clamp); scheduler.yield() is avoided on purpose because
 * its continuation outranks timers and would starve them for the whole load.
 */
function yieldToEventLoop(): Promise<void> {
  if (typeof window !== 'undefined' && typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      yieldChannel ??= new MessageChannel();
      const ch = yieldChannel;
      ch.port1.onmessage = () => { ch.port1.onmessage = null; resolve(); };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Call `fn` for each data line (comments skipped), yielding to the event loop every CHUNK lines. */
async function eachLine(text: string, fn: (line: string) => void, onComment?: (line: string) => void): Promise<void> {
  let pos = 0;
  let count = 0;
  const n = text.length;
  while (pos < n) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = n;
    let end = nl;
    if (end > pos && text.charCodeAt(end - 1) === 13) end--;
    if (end > pos) {
      if (text.charCodeAt(pos) === 35 && text.charCodeAt(pos + 1) === 32) onComment?.(text.slice(pos, end));
      else fn(text.slice(pos, end));
    }
    pos = nl + 1;
    if (++count % CHUNK === 0) await yieldToEventLoop();
  }
}

export async function loadDictionary(baseUrl: string, opts?: LoadOptions): Promise<Dictionary> {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  let got = 0;
  let size = 0;
  const onBytes = opts?.onBytes;
  const count = onBytes ? (more: number, read: number) => { size += more; got += read; onBytes(got, Math.max(size, got)); } : undefined;
  const load = opts?.fetchText ?? ((name: string) => fetchDataText(base + name, opts?.keep, count));
  let progress = 0;
  const report = (to: number) => {
    if (to > progress) { progress = to; opts?.onProgress?.(Math.min(100, Math.round(progress)), 100); }
  };
  report(0);

  // Start every download at once; parse in order as each one arrives.
  const files: Record<string, Promise<string>> = {};
  for (const name of REQUIRED) files[name] = load(`${name}.tsv.gz`);
  files.meta = load('meta.json');
  const extra: Promise<string | null> = load('chars-extra.tsv.gz').catch(() => null);
  const wordsExtra: Promise<string | null> = load('cedict-extra.tsv.gz').catch(() => null);
  const bookWords: Promise<string | null> = load('book-words.tsv.gz').catch(() => null);
  for (const p of Object.values(files)) p.catch(() => {}); // surfaced when awaited below
  report(10);

  const data = new DictImpl();
  // Weights add to 90 on top of the 10 for downloads: cedict is the biggest parse, then words and chars.
  const steps: [string, number][] = [['cedict', 25], ['chars', 15], ['words', 30], ['hsk', 3], ['t2s', 2], ['s2t', 10], ['radicals', 1]];
  let acc = 10;
  for (const [name, weight] of steps) {
    const text = await files[name];
    await data.parse(name, text);
    acc += weight;
    report(acc);
  }
  const extraText = await extra;
  if (extraText) await data.parse('chars-extra', extraText);
  const wordsExtraText = await wordsExtra;
  if (wordsExtraText) await data.parse('cedict-extra', wordsExtraText);
  // Last of the word files: its rows go ahead of whatever CC-CEDICT has for the same headword.
  const bookWordsText = await bookWords;
  if (bookWordsText) await data.parse('book-words', bookWordsText);
  data.parseMeta(await files.meta.catch(() => '{}'));
  await data.finish();
  report(100);
  return data;
}

// ------------------------------------------------------------ the dictionary ---

const EMPTY: string[] = [];

/**
 * Segmentation count of a CC-CEDICT or Wiktionary word that the jieba corpus never saw (文旅, 青蒿, 胶皮): enough to beat a split
 * into rare characters, never a split into common ones (有的 stays 有 + 的). Measured on the held-out corpus (scripts: diff of dumps).
 */
export const UNSEEN_FLOOR = 5;
/** A row that only points at another spelling, or that the dictionary marks as old or regional, gets no floor. */
const NO_FLOOR_DEF = /^((old|archaic|obsolete|ancient|erroneous|unofficial|Japanese) )*variant of|^\((archaic|obsolete|dialect|Cantonese|Hokkien|Wu|Min)\b/i;
/**
 * (Unless one of its tags is "(literary)": the old novels' own words, 厨下 "in the kitchen", 籴米 "to buy rice", 护驾 "to escort the
 * emperor", are tagged archaic or regional and literary at once.)
 */
const LITERARY_TAG = /^(\([^)]*\) )*\(literary\)/i;
/**
 * A sense whose first tag is slang, Internet or video-game talk or a neologism (头铁, 老六 "noob", 不要太 "very", 吃鸡 "PUBG"): a
 * row with no other sense gets no floor, since a book that has the two characters side by side nearly always means them, not the
 * slang. (A colloquial or dialect word that is slang too, 二饼 "(colloquial) (dialect) (slang) eyeglasses", keeps it.)
 */
const SLANG_DEF = /^\([^)]*\b(slang|Internet|neologism|video games)\b/i;
/** A sexual sense in slang (吃香蕉 "(slang) to give a blowjob") or of a prostitute (站街): never put on the page by a floor. */
const SEXUAL_DEF = /^(\([^)]*\) )*\([^)]*\b(slang|vulgar)\b[^)]*\).*\b(blowjob|sex|sexual|penis|vagina|breasts?|orgasm|masturbat\w*|prostitut\w*|porn\w*)\b|^\(of a prostitute\)/i;
const HAN_WORD = /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]{2,6}$/;
/** A sense that opens with a species' Latin name ("Anthurium andraeanum", "Artemisia annua, …"). */
const TAXON = /^[A-Z][a-z]+ [a-z]+(a|ae|um|us|is|es|i|ii|ensis|oides)(,|;| \(|$)/;
/**
 * A sense that only names a town, a village, a district, a city or a province ("Sanhe (a town in …)", "Zama (city in Kanagawa …)",
 * "Linnei (a rural township in Yunlin County, Taiwan)", "an urban village in Nangang district, Taipei", "Đắk Lắk (a province of
 * Vietnam)").
 */
const ADMIN_PLACE = /\((a |an )?((rural|urban) )?(town|township|village|subdistrict|county|district|city|county-level city|prefecture-level city)\b|\(city in |^(an? )?((rural|urban) )?(village|township|town)\b/i;
/** (A province of a country today, 多乐 "Đắk Lắk (a province of Vietnam)", not of imperial China: 交州 is the novels' own.) */
const PROVINCE_OF = /\(a province of [A-Z]/;
/**
 * Characters that CC-CEDICT gives only as "variant of" another but that the 2013 Table of General Standard Chinese Characters
 * (通用规范汉字表, Unihan kTGH) lists as standard in their own right, mostly for names (斌, 珪, 甯, 焱) or a sense of their own (犟,
 * 绔): foldVariants leaves them. 忕 and 濇 are left too: the character they point to (忲, 瀒) is not in the table. Derived from
 * Unihan 18.0 (Unicode license) against this CC-CEDICT: every other character foldVariants picks is outside the table, its target
 * inside it.
 */
const STANDARD_VARIANTS = '㬎倮偁刬勔坭崧憙摏攽斌椀毌澂焱牚犇犟珪甯绔鎏忕濇';
/**
 * Words in which a folded variant stands for another character than its usual one: 隄 is 堤 (a dike) on its own, but the novels'
 * 隄防 and 隄備 are 提防 and 提备 ("to be on guard"), not 堤防 "a dike". Applied before the character fold, on the page and in lookups.
 */
const FOLD_WORDS: Readonly<Record<string, string>> = { 隄防: '提防', 隄備: '提備', 隄备: '提备' };

interface ReadingCandidate { syllables: string[]; penalty: number; order: number }

/** How unattractive a CEDICT entry is as "the" reading of its headword (lower is better). */
function entryPenalty(e: DictEntry): number {
  const d0 = e.defs[0] ?? '';
  let p = 0;
  if (/^(old |archaic |ancient |Japanese )?variant (of|form of|pronunciation)/i.test(d0) || /^(also written|same as|see )/i.test(d0)) p += 3;
  else if (/^erhua variant/i.test(d0)) p += 1;
  // "used in 仿佛": a bound reading that only occurs inside other words (佛 fu2 in 仿佛), never the one a bare character has.
  else if (/^used in /i.test(d0)) p += 3;
  if (/^(Taiwan pr\.|also pr\.|\(Tw\) pr\.|pr\. )/i.test(d0)) p += 2.5;
  if (e.defs.length > 0 && e.defs.every((d) => /^surname /i.test(d))) p += 1.5;
  if (/^[A-Z]/.test(e.pinyin)) p += 0.4; // proper noun: lose to a common-noun reading of the same word
  return p;
}

/** "variant of 偷[tou1]", "old variant of 彷彿|仿佛[fang3 fu2]": the whole line, so a line with more to say is not a pointer. */
const VARIANT_POINTER = /^(?:(?:old|archaic|ancient|Japanese|unofficial|Taiwan|erhua|euphemistic) )*(?:variant|form) (?:form )?of ([\p{Script=Han}·|]+)\[([^\]]+)\]$/u;
/** "see 荆州市[Jing1 zhou1 Shi4]". */
const SEE_POINTER = /^see (?:also )?([\p{Script=Han}·|]+)\[([^\]]+)\]$/u;

const toArray = (s: string | undefined): string[] => (s ? Array.from(s) : EMPTY);

/** A row of hsk.tsv.gz (ARCHITECTURE.md §3). */
interface HskRecord {
  simp: string;
  /** The word-level answer: hsk3 is the level of its easiest reading. */
  info: HskInfo;
  /** The list's own readings, lowest level first; undefined on a row of the old 5-column file, which grades no reading. */
  own?: { pinyin: string[]; level: number }[];
  /** Same-word readings: the listed word read another way (血 xuè beside the list's xiě). */
  same?: { pinyin: string[]; level: number }[];
}

/** "xing2=1;hang2=3" -> readings, in file order (lowest level first). */
function hskReadingsOf(field: string | undefined): { pinyin: string[]; level: number }[] {
  const out: { pinyin: string[]; level: number }[] = [];
  for (const part of (field ?? '').split(';')) {
    const eq = part.lastIndexOf('=');
    const level = Number(part.slice(eq + 1));
    if (eq > 0 && level) out.push({ pinyin: part.slice(0, eq).split(' '), level });
  }
  return out;
}

/** Words ending in 儿 that are words of their own, not a spelling of the word without it (头儿 "boss" is not 头 "head"). */
export const HSK_OWN_ER_WORDS: ReadonlySet<string> = new Set(['头儿', '哥儿', '人儿']);

class DictImpl implements Dictionary {
  meta: DataMeta = { built: '', unicode: '', counts: {}, sources: [] };

  private entries = new Map<string, DictEntry[]>();
  /** Entries whose traditional headword differs from the simplified one (for alias building). */
  private twoScript: DictEntry[] = [];
  /** Multi-character headwords that are spelled the same in both scripts. */
  private sameScript: string[] = [];
  /** Segmentation vocabulary: word -> jieba count (0 for CEDICT-only words). */
  private vocab = new Map<string, number>();
  /** First code point -> bit n set when some word of n code points starts with it (n <= 30). */
  private lens = new Map<string, number>();
  private wordTotal = 1;
  private wordsExtraLoaded = 0;
  private bookWordsLoaded = 0;
  /** Headwords of the Wiktionary supplement (cedict-extra), which has none of CC-CEDICT's. */
  private extraWords = new Set<string>();
  /** segmentFreq's floors, by word. */
  private floorMemo = new Map<string, number>();
  /** book-words rows of scope "book", in both scripts, with their count. */
  private scoped = new Map<string, number>();
  /** Single-character headwords (BMP), for foldVariants; emptied after. */
  private singles = new Set<string>();
  /** Variant character -> its standard form (靑 -> 青, 槪 -> 概), from CC-CEDICT's pointer rows (foldVariants()). */
  private fold = new Map<string, string>();
  /** The UTF-16 units of `fold`'s variant characters (all in the BMP): what normalizeWord and finish() look for (isSpecial). */
  private foldBits: Uint8Array | null = null;

  private charLines = new Map<number, string>();
  private extraLines = new Map<number, string>();
  private compat = new Map<number, string>();
  private radicalByNum = new Map<string, { radicalChar: string; char: string }>();
  private radicalToChar = new Map<string, string>();

  /** hsk.tsv.gz rows by simplified form, then by the trad column where that is free. */
  private hskMap = new Map<string, HskRecord>();
  /** The list's forms and their 儿-less spellings, for hskWords (sorted by level, then rank, in finish()). */
  private hskRows: { simp: string; level: number; rank: number }[] = [];
  private t2s = new ConvTable();
  private s2t = new ConvTable();

  private charCache = new Map<number, CharInfo>();
  private defaultCache = new Map<string, string>();
  private wordReadingCache = new Map<string, ReadingCandidate | null>();
  private verbMemo = new Map<string, number>();
  /** The reading model (core/readingModel.ts), once loaded; null means the rules alone. */
  private readingModel: ReadingChooser | null = null;
  /** Each character's own readings (numbered), for the reading model. */
  private ownReadings = new Map<string, Set<string>>();

  // -------------------------------------------------------------- parsing ---

  async parse(name: string, text: string): Promise<void> {
    switch (name) {
      case 'cedict': return this.parseCedict(text, false);
      case 'cedict-extra': return this.parseCedict(text, true);
      case 'book-words': return this.parseBookWords(text);
      case 'chars': return this.parseChars(text);
      case 'chars-extra': return this.parseExtra(text);
      case 'words': return this.parseWords(text);
      case 'hsk': return this.parseHsk(text);
      case 't2s': return eachLine(text, (l) => { const t = l.split('\t'); if (t.length >= 2) this.t2s.add(t[0], t[1]); });
      case 's2t': return eachLine(text, (l) => { const t = l.split('\t'); if (t.length >= 2) this.s2t.add(t[0], t[1]); });
      case 'radicals': return this.parseRadicals(text);
    }
  }

  /** `supplement`: optional extra words in the same format; rows that repeat a CEDICT reading are skipped. */
  private async parseCedict(text: string, supplement: boolean): Promise<void> {
    await eachLine(text, (line) => {
      const t = line.split('\t');
      if (t.length < 4) return;
      if (supplement && this.entries.get(t[1])?.some((e) => e.trad === t[0] && e.pinyin === t[2])) return;
      let pinyin = t[2];
      // The HSK rows appended at the end are not in CEDICT's numbered format ("bu4 lìyú", "yǒujìnr5").
      if (/[^\x00-\x7f]|(^| )[a-zü]+( |$)/.test(pinyin)) pinyin = normalizePinyinField(pinyin);
      const entry: DictEntry = { trad: t[0], simp: t[1], pinyin, defs: t[3].split('/') };
      if (supplement) { this.wordsExtraLoaded++; this.extraWords.add(t[0]).add(t[1]); }
      if (t[0].length === 1) this.singles.add(t[0]);
      if (t[1].length === 1) this.singles.add(t[1]);
      this.addEntry(entry.simp, entry);
      if (entry.trad !== entry.simp) { this.addEntry(entry.trad, entry); this.twoScript.push(entry); }
      else if (entry.simp.length > 1) this.sameScript.push(entry.simp);
    });
  }

  /**
   * Curated senses (public/data/book-words.tsv.gz, built from scripts/data/book-words.tsv). A row with the same trad,
   * simp and pinyin as a CEDICT row replaces that row's definitions; any other row is added. Either way it moves to
   * the front of the list for each of its headwords, so it leads the popup, the card and the saved gloss.
   * The optional fifth column raises the segmentation count of a word that no list has (鴻濛). With "book" in the sixth, the
   * count is not global: the word joins the lexicon of a book that uses it (bookScoped, core/lexicon.ts).
   */
  private async parseBookWords(text: string): Promise<void> {
    await eachLine(text, (line) => {
      const t = line.split('\t');
      if (t.length < 4) return;
      const defs = t[3].split('/');
      const keys = t[0] === t[1] ? [t[1]] : [t[1], t[0]];
      let twin: DictEntry | undefined;
      for (const key of keys) {
        const list = this.entries.get(key);
        // The same case first (Ba1 jie4, the name, is not ba1 jie4, the precepts), then any case.
        const hit = list?.find((e) => e.trad === t[0] && e.simp === t[1] && e.pinyin === t[2])
          ?? list?.find((e) => e.trad === t[0] && e.simp === t[1] && e.pinyin.toLowerCase() === t[2].toLowerCase());
        if (hit) { twin = hit; break; }
      }
      const entry: DictEntry = twin ?? { trad: t[0], simp: t[1], pinyin: t[2], defs };
      if (twin) entry.defs = defs;
      entry.curated = true;
      for (const key of keys) {
        const list = this.entries.get(key) ?? [];
        const rest = list.filter((e) => e !== entry);
        this.entries.set(key, [entry, ...rest]);
        if (!this.vocab.has(key)) this.vocab.set(key, 0);
      }
      if (!twin && entry.trad !== entry.simp) this.twoScript.push(entry);
      else if (!twin && entry.simp.length > 1) this.sameScript.push(entry.simp);
      const count = Number(t[4]);
      // Scope "book": a name or a phrase of one book (小红, 子曰) counts only in a book that uses it (core/lexicon.ts).
      if (t[5] === 'book') { for (const key of keys) this.scoped.set(key, count || 1); }
      else if (count > 0) for (const key of keys) if ((this.vocab.get(key) ?? 0) < count) this.vocab.set(key, count);
      this.bookWordsLoaded++;
    });
  }

  private addEntry(key: string, entry: DictEntry): void {
    const list = this.entries.get(key);
    if (list) list.push(entry);
    else this.entries.set(key, [entry]);
    if (!this.vocab.has(key)) this.vocab.set(key, 0);
  }

  private async parseChars(text: string): Promise<void> {
    await eachLine(text, (line) => {
      const cp = line.codePointAt(0)!;
      this.charLines.set(cp, line);
      // Column 9 (compatOf) is the last one; find it without splitting the whole line.
      const lastTab = line.lastIndexOf('\t');
      if (lastTab > 0 && lastTab < line.length - 1) this.compat.set(cp, line.slice(lastTab + 1));
    });
  }

  private async parseExtra(text: string): Promise<void> {
    await eachLine(text, (line) => { this.extraLines.set(line.codePointAt(0)!, line); });
  }

  private async parseWords(text: string): Promise<void> {
    await eachLine(
      text,
      (line) => {
        const tab = line.indexOf('\t');
        if (tab <= 0) return;
        this.vocab.set(line.slice(0, tab), Number(line.slice(tab + 1)) || 0);
      },
      (comment) => {
        const m = /total=(\d+)/.exec(comment);
        if (m) this.wordTotal = Number(m[1]);
      },
    );
  }

  /**
   * hsk.tsv.gz. A row of the old 5-column file (a service worker can pair it with this code during an update) grades the
   * word, not its readings, as before. Only the list's own forms join the segmentation vocabulary: a derived row (一下 for
   * 一下儿, 好象 for 好像) must not change how a sentence is cut.
   */
  private async parseHsk(text: string): Promise<void> {
    await eachLine(text, (line) => {
      const t = line.split('\t');
      const hsk3 = Number(t[2]) || undefined;
      const hsk2 = Number(t[3]) || undefined;
      const rank = Number(t[4]) || undefined;
      const of = t[7] || undefined;
      const info: HskInfo = {};
      if (hsk3) info.hsk3 = hsk3;
      if (hsk2) info.hsk2 = hsk2;
      if (rank) info.rank = rank;
      if (of) info.of = of;
      const rec: HskRecord = { simp: t[0], info };
      if (t.length > 5) { rec.own = hskReadingsOf(t[5]); rec.same = hskReadingsOf(t[6]); }
      if (!this.hskMap.has(t[0])) this.hskMap.set(t[0], rec);
      if (t[1] && !this.hskMap.has(t[1])) this.hskMap.set(t[1], rec);
      if (hsk3 && (!of || of.endsWith('儿'))) this.hskRows.push({ simp: t[0], level: hsk3, rank: rank ?? 1e9 });
      if (!of) for (const w of [t[0], t[1]]) if (w && !this.vocab.has(w)) this.vocab.set(w, 0);
    });
  }

  private async parseRadicals(text: string): Promise<void> {
    await eachLine(text, (line) => {
      const t = line.split('\t');
      if (t.length < 3) return;
      this.radicalByNum.set(t[0], { radicalChar: t[1], char: t[2] });
      if (t[1] && t[2]) this.radicalToChar.set(t[1], t[2]);
    });
  }

  parseMeta(json: string): void {
    try {
      const m = JSON.parse(json) as Partial<DataMeta>;
      this.meta = {
        built: m.built ?? '',
        unicode: m.unicode ?? '',
        counts: { ...(m.counts ?? {}) },
        sources: m.sources ?? [],
      };
    } catch { /* keep the empty meta */ }
  }

  /** Build the derived indexes once every file is in. */
  async finish(): Promise<void> {
    await this.foldVariants(); // before resolvePointers, which adds meanings to the pointer rows it reads
    await this.addTraditionalAliases();
    await this.protectSharedWords();
    await this.discountProperNouns();
    await this.resolvePointers();
    this.meta.counts.wordTotal = this.wordTotal;
    this.meta.counts.charsLoaded = this.charLines.size;
    this.meta.counts.extraLoaded = this.extraLines.size;
    this.meta.counts.wordsExtraLoaded = this.wordsExtraLoaded;
    this.meta.counts.bookWordsLoaded = this.bookWordsLoaded;
    let seen = 0;
    const bits = this.foldBits;
    for (const word of this.vocab.keys()) {
      if (++seen % INDEX_CHUNK === 0) await yieldToEventLoop();
      let n = 0;
      let variant = false;
      for (let i = 0; i < word.length; i++) {
        const c = word.charCodeAt(i);
        if (c < 0xdc00 || c > 0xdfff) n++;
        if (bits && bits[c]) variant = true;
      }
      if (n < 2 || n > 30) continue;
      // A word spelled with a variant (咭咭呱呱) is found under its standard spelling too, which the page shows (foldVariants):
      // the corpus count and the dictionary's rows carry over. The loop reaches the new key later and indexes it.
      if (variant) {
        let folded = '';
        for (const ch of word) folded += this.fold.get(ch) ?? ch;
        if (!this.vocab.has(folded)) this.vocab.set(folded, this.vocab.get(word) ?? 0);
        const list = this.entries.get(word);
        if (list && !this.entries.has(folded)) this.entries.set(folded, list);
      }
      const first = firstCodePointOf(word);
      this.lens.set(first, (this.lens.get(first) ?? 0) | (1 << n));
    }
    this.hskRows.sort((a, b) => a.level - b.level || a.rank - b.rank);
  }

  /**
   * CEDICT spells some traditional words differently from the usual OpenCC output (鍛鍊/鍛煉, 裡/裏, 著/着).
   * Text in either form should find the entry, so the OpenCC spelling becomes an alias when it is free.
   */
  private async addTraditionalAliases(): Promise<void> {
    let added = 0;
    let seen = 0;
    for (const e of this.twoScript) {
      if (++seen % INDEX_CHUNK === 0) await yieldToEventLoop();
      const count = Math.max(this.vocab.get(e.simp) ?? 0, this.vocab.get(e.trad) ?? 0);
      // 隨著 is shown 随著: OpenCC keeps 著 (it is also zhù, 著名), so the simplified page needs that spelling as well. The
      // reader then writes 着 where the reading is zhe, zháo or zhuó (ui/reader/shown.ts). Not where 著 is zhāo (著數 "a move",
      // CC-CEDICT's 怎麼著), nor in a pair where it is zháo (點著 "to light"): there the book as often means a word and the particle
      // zhe (種著數本, 點著燈籠, 覺怎麼著).
      if (e.trad.includes('著')) {
        const shown = this.t2s.convert(e.trad);
        const cps = [...e.trad];
        const syl = e.pinyin.toLowerCase().split(' ');
        const zhao = syl.length === cps.length && cps.some((c, i) => c === '著' && (syl[i] === 'zhao1' || (syl[i] === 'zhao2' && cps.length === 2)));
        if (!zhao && shown !== e.simp && shown !== e.trad && !this.entries.has(shown)) {
          this.entries.set(shown, [e]);
          if ((this.vocab.get(shown) ?? 0) < count) this.vocab.set(shown, count);
          added++;
        }
      }
      const alt = this.s2t.convert(e.simp);
      if (alt === e.trad || alt === e.simp || this.entries.has(alt)) continue;
      this.entries.set(alt, [e]);
      if (!this.vocab.has(alt) || (this.vocab.get(alt) ?? 0) < count) this.vocab.set(alt, count);
      added++;
    }
    this.twoScript = [];
    this.meta.counts.tradAliases = added;
  }

  /**
   * Words CEDICT writes the same in both scripts (皇后, 王后) must survive simplified -> traditional conversion,
   * where the character table alone would turn 后 into 後.
   */
  private async protectSharedWords(): Promise<void> {
    let seen = 0;
    for (const w of this.sameScript) {
      if (++seen % INDEX_CHUNK === 0) await yieldToEventLoop();
      if (this.s2t.get(w) !== undefined) continue;
      for (const ch of w) {
        const to = this.s2t.get(ch);
        if (to !== undefined && to !== ch) { this.s2t.add(w, w); break; }
      }
    }
    this.sameScript = [];
  }

  /**
   * Two-character words that CEDICT lists only as proper nouns (花都, 长安) tie with the plain words they are made
   * of (花 + 都) on corpus counts alone, so their segmentation weight is cut to a quarter.
   */
  private async discountProperNouns(): Promise<void> {
    let seen = 0;
    for (const [word, list] of this.entries) {
      if (++seen % INDEX_CHUNK === 0) await yieldToEventLoop();
      if (word.length !== 2 || !list.every((e) => /^[A-Z]/.test(e.pinyin))) continue;
      const c = this.vocab.get(word);
      if (c) this.vocab.set(word, Math.floor(c / 4));
    }
  }

  /**
   * Variant characters that only stand for a standard one: every CC-CEDICT row of 靑 槪 倣 讐 湼 is "variant of" a character whose
   * own rows mean something (青 概 仿 仇 涅). The simplified page shows the standard form (the t2s table gains the pair; OpenCC
   * leaves them), and a word spelled with the variant finds the standard word (靑春 → 青春, normalizeWord). A character with a
   * meaning of its own (覆, 藉, 瞭, 雠) is left alone, so is one the 2013 standard table keeps (STANDARD_VARIANTS: 斌, 犟),
   * and so is 著 (zhù), which the reader settles by its reading.
   */
  private async foldVariants(): Promise<void> {
    let seen = 0;
    const isPointer = (d: string) => VARIANT_POINTER.test(d) || SEE_POINTER.test(d);
    for (const x of this.singles) {
      if (++seen % INDEX_CHUNK === 0) await yieldToEventLoop();
      const cp = x.charCodeAt(0);
      if (cp < 0x3400 || cp > 0x9fff || x === '著' || STANDARD_VARIANTS.includes(x) || this.t2s.get(x) !== undefined) continue;
      const own = (this.entries.get(x) ?? []).filter((e) => e.trad === x || e.simp === x);
      if (!own.length || own.some((e) => !e.defs.length || !e.defs.every(isPointer))) continue;
      // CC-CEDICT's own simplified column says where the variant goes (讐 仇); else the pointer does.
      const targets = new Set(own.filter((e) => e.trad === x && e.simp !== x).map((e) => e.simp));
      if (!targets.size) {
        for (const e of own) for (const d of e.defs) {
          const m = VARIANT_POINTER.exec(d);
          const forms = m ? m[1].split('|') : [];
          if (forms.length) targets.add(forms[forms.length - 1]);
        }
      }
      if (targets.size !== 1) continue;
      const y = [...targets][0];
      const ycp = y.codePointAt(0)!;
      // The standard form: one BMP character, simplified already, with a meaning of its own, and common.
      if (y.length !== 1 || y === x || ycp < 0x3400 || ycp > 0x9fff || this.t2s.convert(y) !== y || (this.vocab.get(y) ?? 0) < 100) continue;
      if (!(this.entries.get(y) ?? []).some((e) => e.simp === y && e.defs.some((d) => !isPointer(d)))) continue;
      this.fold.set(x, y);
    }
    this.singles.clear();
    for (const [x, y] of this.fold) this.t2s.add(x, y);
    if (this.fold.has('隄')) for (const [x, y] of Object.entries(FOLD_WORDS)) this.t2s.add(x, this.t2s.convert(y));
    this.meta.counts.variantsFolded = this.fold.size;
    if (!this.fold.size) return;
    this.foldBits = new Uint8Array(65536);
    for (const x of this.fold.keys()) this.foldBits[x.charCodeAt(0)] = 1;
  }

  /**
   * The segmentation count of a CC-CEDICT or Wiktionary headword of two to six characters that the corpus never saw: UNSEEN_FLOOR,
   * or 0 for pointer, archaic, dialect, slang-only and sexual-slang rows (curated book-words rows carry their own count). A
   * Wiktionary word gets it only when
   * the reading it would show is the one its parts have anyway: that list also writes tone sandhi (五口 wu2 kou3), rare literary
   * senses of common pairs (齐齐 zhāizhāi, 薄薄 bóbó) and a few wrong readings (率兵 lǜ), which a joined word would put on the page.
   */
  private floorOf(w: string): number {
    if (!HAN_WORD.test(w)) return 0;
    const list = (this.entries.get(w) ?? []).filter((e) => !e.curated && e.defs.length > 0 && !(NO_FLOOR_DEF.test(e.defs[0]) && !LITERARY_TAG.test(e.defs[0]))
      && !e.defs.every((d) => SLANG_DEF.test(d)) && !e.defs.some((d) => SEXUAL_DEF.test(d)));
    if (!list.length) return 0;
    // 叭儿狗: a regional word that opens with 儿 (儿狗 "(Mandarin) (dialect) male dog") is the 儿 of the word before and a noun.
    if (w[0] === '儿' && list.every((e) => e.defs.every((d) => /^(\([^)]*\) )*\(dialect\)/i.test(d)))) return 0;
    // A doubled character that is only a name (滴滴 the ride-hailing app, 邦邦 the game) is a sound word in a book (滴滴叫了两声).
    if (w.length === 2 && w[0] === w[1] && list.every((e) => /^[A-Z]/.test(e.pinyin))) return 0;
    // Only the simplified spelling, which the page shows by default (with the 著 the page keeps, 忙著): the corpus counts
    // traditional characters far lower than simplified ones (為 against 为), so a floor would join 為人 in a page shown as written
    // where 为人 stays 为 + 人.
    // (A row CC-CEDICT spells with a variant the page folds, 靑铜时代, is found under 青铜时代 and counts as that spelling.)
    if (!list.some((e) => e.simp === w || e.simp === w.replace(/著/g, '着') || (this.hasVariant(e.simp) && this.folded(e.simp) === w))) return 0;
    // A Wiktionary word only when the reading it would show is the one its parts have anyway.
    if (this.extraWords.has(w)) {
      const cps = Array.from(w);
      const parts = this.partsReading(cps);
      const shown = this.wordReading(w, cps);
      if (!shown || !shown.every((s, i) => s === parts[i] || (s.endsWith('5') && baseOf(s) === baseOf(parts[i])))) return 0;
    }
    // A pair that is only the name of a town, a village, a district or a province (三合, 庙前, 座间 "Zama, a city in Japan", 联成 "an
    // urban village in Taipei", 多乐 "a province of Vietnam"), or only a short form
    // (郑大 "short for 鄭州大學", 克州), is a coincidence of two plain characters in a book.
    if (w.length === 2 && list.every((e) => /^[A-Z]/.test(e.pinyin) && e.defs.every((d) => ADMIN_PLACE.test(d) || PROVINCE_OF.test(d) || /^(short for|abbr\. for) /.test(d)))) return 0;
    // A pair that is only a species' Latin name (红掌 "Anthurium andraeanum") is seldom meant where its characters are common words
    // (红掌拨清波, the goose's red feet): none then, and a fifth of the floor where they are rare (青蒿).
    if (w.length === 2 && list.every((e) => TAXON.test(e.defs[0]))) {
      const [c0, c1] = [...w];
      return ((this.vocab.get(c0) ?? 0) * (this.vocab.get(c1) ?? 0)) / this.wordTotal > 0.5 ? 0 : 1;
    }
    return UNSEEN_FLOOR;
  }

  /** How `cps` reads cut into the dictionary words inside it and single characters, each read beside its neighbors (率 + 兵: shuài). */
  private partsReading(cps: string[]): string[] {
    const out = new Array<string>(cps.length).fill('');
    for (const [a, b] of this.subWords(cps)) {
      const sub = this.wordReading(cps.slice(a, b).join(''), cps.slice(a, b));
      if (sub) for (let k = a; k < b; k++) out[k] = sub[k - a];
    }
    for (let i = 0; i < cps.length; i++) {
      if (!out[i]) out[i] = this.pinyinFor(cps[i], { prev: cps[i - 1], next: cps[i + 1] })[0] ?? '';
    }
    return out;
  }

  /**
   * Many rows only point at another one: 偸 "variant of 偷[tou1]", 荊州 "see 荆州市[Jing1 zhou1 Shi4]". Read alone they tell the
   * reader nothing, so the meanings of the row they point to are added to it. The pointer stays the first line (reading choice
   * still sees a variant row as one: entryPenalty), and rankedDefs puts it behind the meanings when a card is drawn.
   * Curated rows are left alone, and so is any row that has a meaning of its own.
   */
  private async resolvePointers(): Promise<void> {
    let n = 0;
    let resolved = 0;
    const pointerOf = (d: string): { target: string; pinyin: string } | null => {
      const m = VARIANT_POINTER.exec(d) ?? SEE_POINTER.exec(d);
      return m ? { target: m[1], pinyin: m[2] } : null;
    };
    const isPointer = (d: string) => !!pointerOf(d) || /^(abbr\. for|short for)/i.test(d) || /^CL:/.test(d);
    for (const [key, list] of this.entries) {
      if (++n % INDEX_CHUNK === 0) await yieldToEventLoop();
      for (const e of list) {
        if (key !== e.simp || e.curated || !e.defs.length) continue; // an entry is under its simplified headword once
        const d0 = e.defs[0];
        if (d0.length > 90 || !(d0.startsWith('see ') || d0.includes(' of '))) continue; // cheap test before the patterns
        // Only a row whose every line is a pointer is rewritten.
        const points = e.defs.map(pointerOf);
        if (points.some((p) => !p)) continue;
        const want = points[0]!;
        const reading = want.pinyin.toLowerCase().replace(/u:/g, 'ü').replace(/\s+/g, ' ');
        const forms = want.target.split('|');
        let found: DictEntry | undefined;
        for (const form of forms) {
          found = this.entries.get(form)?.find((x) => x !== e && x.pinyin.toLowerCase() === reading && !x.defs.every(isPointer) && x.defs.some((d) => !isPointer(d)));
          if (found) break;
        }
        if (!found) continue;
        const lead = found.defs.filter((d) => !isPointer(d) && !/^surname /i.test(d)).slice(0, 3);
        if (!lead.length) continue;
        e.defs = [...e.defs, ...lead];
        resolved++;
      }
    }
    this.meta.counts.pointersResolved = resolved;
  }

  // --------------------------------------------------------- normalization ---

  private normalizeCp(ch: string): string {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x2e80) return ch;
    const unified = this.compat.get(cp);
    if (unified) return unified;
    const radical = this.radicalToChar.get(ch);
    if (radical) return radical;
    if (cp <= 0x2fdf) {
      const k = ch.normalize('NFKC');
      if (k !== ch) return k;
    }
    return ch;
  }

  /** `s` with the variant characters of `fold` in their standard form (靑铜 → 青铜). */
  private folded(s: string): string {
    let out = '';
    for (const ch of s) out += this.fold.get(ch) ?? ch;
    return out;
  }

  /** Whether `s` holds a variant character of `fold`. */
  private hasVariant(s: string): boolean {
    const bits = this.foldBits;
    if (!bits) return false;
    for (let i = 0; i < s.length; i++) if (bits[s.charCodeAt(i)] === 1) return true;
    return false;
  }

  /**
   * Whether `s` holds a radical (U+2E80–2FDF), a compatibility ideograph (U+F900–FAFF, or the supplement's high surrogate) or a
   * variant character of `fold`.
   */
  private isSpecial(s: string): boolean {
    const bits = this.foldBits;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x2e80) continue;
      if (c <= 0x2fdf || (c >= 0xf900 && c <= 0xfaff) || c === 0xd87e || (bits !== null && bits[c] === 1)) return true;
    }
    return false;
  }

  /**
   * Per-character normalization of compatibility ideographs and radicals. Never NFKC on whole strings. A word the dictionary
   * does not know as written is then read with its variant characters folded (靑春 is 青春, see foldVariants).
   */
  private normalizeWord(word: string): string {
    if (!this.isSpecial(word)) return word;
    let out = '';
    for (const ch of word) out += this.normalizeCp(ch);
    if (!this.fold.size || this.vocab.has(out)) return out;
    for (const [x, y] of Object.entries(FOLD_WORDS)) if (out.includes(x)) out = out.split(x).join(y);
    let folded = '';
    for (const ch of out) folded += this.fold.get(ch) ?? ch;
    return folded;
  }

  // -------------------------------------------------------------- lookups ---

  /** Entries are shared with the dictionary: treat them (and their `defs`) as read-only. */
  lookup(word: string): DictEntry[] {
    const list = this.entries.get(this.normalizeWord(word));
    return list ? list.slice() : [];
  }

  hasWord(word: string): boolean {
    return this.entries.has(this.normalizeWord(word));
  }

  /**
   * Segmentation weight: the jieba corpus count (0 when unseen). Two-character words that CEDICT lists only
   * as proper nouns carry a quarter of their count, see discountProperNouns().
   */
  freq(word: string): number {
    return this.vocab.get(this.normalizeWord(word)) ?? 0;
  }

  /** Curated words that count only in a book that uses them (book-words rows of scope "book"), in both scripts. */
  bookScoped(): ReadonlyMap<string, number> {
    return this.scoped;
  }

  /** freq(), or the floor of a dictionary word the corpus never saw (floorOf). For segmentation scores only. */
  segmentFreq(word: string): number {
    const w = this.normalizeWord(word);
    const c = this.vocab.get(w) ?? 0;
    if (c > 0) return c;
    let f = this.floorMemo.get(w);
    if (f === undefined) {
      f = this.floorOf(w);
      if (this.floorMemo.size > 50000) this.floorMemo.clear();
      this.floorMemo.set(w, f);
    }
    return f;
  }

  hsk(word: string, pinyin?: readonly string[]): HskInfo | null {
    const w = this.normalizeWord(word);
    // A reading that is not one syllable per character says nothing: the word's level, as without one.
    let shown = pinyin?.length && pinyin.every(Boolean) && pinyin.length === [...w].length ? pinyin : undefined;
    // The list's traditional column is often a rare variant for a single character (时 → 旹, 听 → 听), so a traditional
    // spelling it misses looks up its simplified form: 聽, 時, 這個.
    let rec = this.hskMap.get(w);
    // Only a word found under its own simplified form gets the other-reading hint: through the trad column or t2s, a
    // character can land on another one (著 zhù → 着, 乾 qián → 干) whose readings say nothing of it.
    let hint = rec?.simp === w;
    // (Not through a variant the page folds, 呌 → 叫: a variant spelling is not the listed word. The page shows the standard form.)
    if (!rec && !this.hasVariant(w)) { const simp = this.toSimplified(w); if (simp !== w) rec = this.hskMap.get(simp); }
    // A book's 事儿 shìr is the listed 事 with 儿 added (not 头儿 "boss", which is not 头 "head").
    if (!rec && shown && shown.length > 1 && /^r5$/i.test(shown[shown.length - 1])) {
      const simp = this.toSimplified(w);
      if (simp.endsWith('儿') && !HSK_OWN_ER_WORDS.has(simp)) { rec = this.hskMap.get(simp.slice(0, -1)); shown = shown.slice(0, -1); }
    }
    if (!rec) return null;
    const info: HskInfo = { ...rec.info };
    if (!shown || !rec.own) return info;
    let same: number | undefined;
    let neutral: number | undefined;
    for (const r of [...rec.own, ...(rec.same ?? [])]) {
      const kind = compareReading(r.pinyin, shown, rec.simp);
      if (kind === 'same') { if (same === undefined || r.level < same) same = r.level; }
      else if (kind === 'neutral' && (neutral === undefined || r.level < neutral) && !this.twoWords(rec.simp, r.pinyin, shown)) neutral = r.level;
    }
    delete info.hsk3;
    const level = same ?? neutral;
    if (level !== undefined) info.hsk3 = level;
    else if (hint && rec.own.length) info.elsewhere = rec.own.map((r) => ({ pinyin: r.pinyin, hsk3: r.level }));
    return info;
  }

  /**
   * Readings that differ only in a neutral tone are one word (北边 běibiān, the list's běibian) unless CC-CEDICT spells both
   * as words of their own: 东西 dōngxī "east and west" is not 东西 dōngxi "thing".
   */
  private twoWords(simp: string, list: readonly string[], shown: readonly string[]): boolean {
    const readings = new Set(this.lookup(simp).filter((e) => !/^[A-Z]/.test(e.pinyin)).map((e) => e.pinyin.toLowerCase()));
    return readings.has(list.join(' ').toLowerCase()) && readings.has(shown.join(' ').toLowerCase());
  }

  hskReadings(maxLevel: number): { word: string; pinyin: string[]; hsk3: number }[] {
    const out: { word: string; pinyin: string[]; hsk3: number }[] = [];
    for (const [key, rec] of this.hskMap) {
      if (key !== rec.simp || rec.info.of) continue;
      if (rec.own) {
        // A same-word reading that differs from the list's only in a neutral tone teaches nothing more: 老婆 lǎopo (HSK 4) does
        // not teach 婆 pó, though CC-CEDICT reads the word lǎopó.
        const own = rec.own;
        const same = (rec.same ?? []).filter((s) => !own.some((r) => compareReading(r.pinyin, s.pinyin, rec.simp)));
        for (const r of [...own, ...same]) if (r.level <= maxLevel) out.push({ word: rec.simp, pinyin: r.pinyin, hsk3: r.level });
      } else if (rec.info.hsk3 && rec.info.hsk3 <= maxLevel) {
        for (const pinyin of this.oldHskReadings(rec.simp)) out.push({ word: rec.simp, pinyin, hsk3: rec.info.hsk3 });
      }
    }
    return out;
  }

  /**
   * The old 5-column file names a word, not a reading: guess the reading the list means from CC-CEDICT, the word's usual one
   * (便宜 piányi, not biànyí), with a single character's neutral readings too (地 de). Proper-noun readings count only when
   * the word has no other.
   */
  private oldHskReadings(word: string): string[][] {
    const n = [...word].length;
    const entries = this.lookup(word).filter((e) => e.simp === word && e.pinyin.split(' ').length === n);
    const common = entries.filter((e) => !/^[A-Z]/.test(e.pinyin));
    let readings = [...new Set((common.length ? common : entries).map((e) => e.pinyin.toLowerCase()))];
    if (readings.length > 1) {
      const usual = this.pinyinFor(word).join(' ');
      if (readings.includes(usual)) readings = readings.filter((r) => r === usual || (n === 1 && r.endsWith('5')));
    }
    return readings.map((r) => r.split(' '));
  }

  hskWords(maxLevel: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of this.hskRows) {
      if (r.level > maxLevel) break;
      if (!seen.has(r.simp)) { seen.add(r.simp); out.push(r.simp); }
    }
    return out;
  }

  toSimplified(text: string): string { return this.t2s.convert(text); }
  toTraditional(text: string): string { return this.s2t.convert(text); }

  wordsAt(text: string, start: number): string[] {
    const n = text.length;
    if (start < 0 || start >= n) return [];
    const c0 = text.charCodeAt(start);
    const firstLen = c0 >= 0xd800 && c0 <= 0xdbff && start + 1 < n ? 2 : 1;
    const cp0 = text.codePointAt(start)!;
    const special = cp0 >= 0x2e80;
    const han = isHanCodePoint(cp0);
    const key = special ? this.normalizeCp(text.slice(start, start + firstLen)) : text.slice(start, start + firstLen);
    // A word that opens with a variant character (靑春) is found under its standard form too.
    const alt = this.fold.size ? this.fold.get(key) : undefined;
    const mask = (this.lens.get(key) ?? 0) | (alt ? this.lens.get(alt) ?? 0 : 0);
    const found: string[] = [];
    // (Only a radical, a compatibility ideograph or a variant needs normalizeWord; plain text skips it.)
    let needsNorm = special && this.isSpecial(text.slice(start, start + firstLen));
    if (mask) {
      let end = start + firstLen;
      for (let len = 1; end < n && len < 30; ) {
        const c = text.charCodeAt(end);
        const step = c >= 0xd800 && c <= 0xdbff && end + 1 < n ? 2 : 1;
        end += step;
        len++;
        if (c >= 0x2e80 && !needsNorm && this.isSpecial(text.slice(end - step, end))) needsNorm = true;
        if (!((mask >>> len) & 1)) { if (mask >>> (len + 1) === 0) break; continue; }
        const cand = text.slice(start, end);
        if (this.vocab.has(needsNorm ? this.normalizeWord(cand) : cand)) found.push(cand);
      }
    }
    found.reverse();
    if (han) found.push(text.slice(start, start + firstLen));
    else if (this.vocab.has(key)) found.push(text.slice(start, start + firstLen));
    return found;
  }

  // ---------------------------------------------------------------- chars ---

  private fields(cp: number): string[] {
    const line = this.charLines.get(cp);
    return line ? line.split('\t') : EMPTY;
  }

  private extraFields(cp: number): string[] {
    const line = this.extraLines.get(cp);
    return line ? line.split('\t') : EMPTY;
  }

  private radicalFor(rs: string | undefined): RadicalInfo | null {
    if (!rs) return null;
    const dot = rs.lastIndexOf('.');
    if (dot < 0) return null;
    const num = rs.slice(0, dot);
    const r = this.radicalByNum.get(num);
    if (!r) return null;
    return { num, radicalChar: r.radicalChar, char: r.char, residual: parseInt(rs.slice(dot + 1), 10) || 0 };
  }

  char(ch: string): CharInfo | null {
    if (!ch) return null;
    const cp = ch.codePointAt(0)!;
    if (!isHanCodePoint(cp)) return null;
    let info = this.charCache.get(cp);
    if (!info) {
      info = this.buildChar(cp);
      this.charCache.set(cp, info);
    }
    return { ...info, readings: info.readings.slice(), simplified: info.simplified.slice(), traditional: info.traditional.slice(), variants: info.variants.slice() };
  }

  /** Unihan readings only (tone-marked), no fallbacks. */
  private unihanReadings(cp: number): string[] {
    const f = this.fields(cp)[1];
    return f ? f.split(',') : EMPTY;
  }

  private extraReadings(cp: number): string[] {
    const f = this.extraFields(cp)[1];
    return f ? f.split(',').filter(Boolean) : EMPTY;
  }

  private buildChar(cp: number): CharInfo {
    const ch = String.fromCodePoint(cp);
    const f = this.fields(cp);
    const block = hanBlockName(cp) ?? 'CJK';
    const unified = this.normalizeCp(ch);
    const alias = unified !== ch ? unified : undefined; // compatibility ideograph or radical
    const base = alias ? this.fields(alias.codePointAt(0)!) : f;

    let readings = this.unihanReadings(cp);
    let definition = f[2] ?? '';
    let rSource: CharInfo['source'] = readings.length ? 'unihan' : 'none';
    let dSource: CharInfo['source'] = definition ? 'unihan' : 'none';
    if (alias) {
      const a = alias.codePointAt(0)!;
      if (!readings.length) { readings = this.unihanReadings(a); if (readings.length) rSource = 'unihan'; }
      if (!definition) { definition = this.fields(a)[2] ?? ''; if (definition) dSource = 'unihan'; }
    }
    const target = alias ? alias.codePointAt(0)! : cp;

    // Wiktionary supplement fills gaps only.
    const x = this.extraFields(target);
    if (!readings.length) {
      const xr = this.extraReadings(target);
      if (xr.length) { readings = xr; rSource = 'wiktionary'; }
    }
    if (!definition && x[2]) { definition = x[2]; dSource = 'wiktionary'; }

    const simplified = toArray(base[5]);
    const traditional = toArray(base[6]);
    const variants = toArray(base[7]);

    // Last resort: borrow from forms of the same character (simplified/traditional first, then variants).
    if (!readings.length || !definition) {
      for (const v of [...simplified, ...traditional, ...variants]) {
        const vcp = v.codePointAt(0)!;
        if (vcp === cp || vcp === target) continue;
        if (!readings.length) {
          const vr = this.unihanReadings(vcp).length ? this.unihanReadings(vcp) : this.extraReadings(vcp);
          if (vr.length) { readings = vr; rSource = 'variant'; }
        }
        if (!definition) {
          const vd = this.fields(vcp)[2] || this.extraFields(vcp)[2];
          if (vd) { definition = `(cf. ${v}) ${vd}`; dSource = 'variant'; }
        }
        if (readings.length && definition) break;
      }
    }

    // CC-CEDICT knows a few single characters Unihan does not (〇).
    if (!readings.length) {
      const own = this.entries.get(ch) ?? this.entries.get(unified);
      const hit = own?.find((e) => (e.simp === unified || e.trad === unified) && e.pinyin);
      if (hit) {
        readings = [numberedToMarked(hit.pinyin.toLowerCase())];
        rSource = 'cedict';
        if (!definition && hit.defs[0]) { definition = hit.defs[0]; dSource = 'cedict'; }
      }
    }

    const source: CharInfo['source'] = rSource !== 'none' ? rSource : dSource;
    const strokesRaw = base[3];
    const info: CharInfo = {
      char: ch,
      readings,
      definition,
      source,
      strokes: strokesRaw ? Number(strokesRaw) || null : null,
      radical: this.radicalFor(base[4]),
      simplified,
      traditional,
      variants,
      block,
    };
    const compatOf = this.compat.get(cp) ?? alias;
    if (compatOf) info.compatOf = compatOf;
    return info;
  }

  // -------------------------------------------------------------- pinyinFor ---

  /**
   * How much of a verb a word is (the reading rules' CharContext.verb): 2 when every sense of its entries says "to …" (提供 to offer,
   * 撰稿 to write articles), 1 when some do (建设 to build, construction), 0 when none do or the dictionary does not list it.
   */
  private verbStrength = (w: string): number => {
    let v = this.verbMemo.get(w);
    if (v !== undefined) return v;
    const senses = (this.entries.get(w) ?? [])
      .filter((e) => (e.simp === w || e.trad === w) && entryPenalty(e) < 1.5)
      .flatMap((e) => e.defs)
      .map((d) => d.replace(/^(\([^)]*\)\s*)+/, ''))
      .filter((d) => d && !/^(CL:|abbr\.|surname |also written|see |used in )/i.test(d));
    const verbs = senses.filter((d) => /^(not )?to /.test(d)).length;
    v = verbs === 0 ? 0 : verbs === senses.length ? 2 : 1;
    if (this.verbMemo.size > 50000) this.verbMemo.clear();
    this.verbMemo.set(w, v);
    return v;
  };

  private listed = (w: string): boolean => this.entries.has(w);

  /** Whether the dictionary makes a word a noun: a classifier note (CL:) or a proper name (the reading's capital). */
  private nounish = (w: string): boolean => (this.entries.get(w) ?? [])
    .some((e) => (e.simp === w || e.trad === w) && (/^[A-Z]/.test(e.pinyin) || e.defs.some((d) => /^CL:/.test(d))));

  /**
   * Default numbered reading of one character, "" if none is known. `visiting` holds the characters whose reading
   * is being worked out further up the call chain: simplified/traditional counterparts can point at each other
   * (𩣔 and 𬳹 each name the other and neither has a reading), so a revisit answers "" instead of recursing.
   * A "" that came from cutting such a loop is not cached: it is only the answer for that chain.
   */
  private defaultSyllable(ch: string, visiting?: Set<string>): string {
    const cached = this.defaultCache.get(ch);
    if (cached !== undefined) return cached;
    if (visiting?.has(ch)) return '';
    const chain = visiting ?? new Set<string>();
    chain.add(ch);
    const r = this.computeDefault(ch, chain);
    chain.delete(ch);
    // The outermost call saw the whole loop, so its answer (even "") is final; a nested "" may be partial.
    if (!visiting || r) this.defaultCache.set(ch, r);
    return r;
  }

  private computeDefault(ch: string, visiting: Set<string>): string {
    const target = this.normalizeCp(ch);
    const fixed = CHAR_DEFAULTS[target];
    if (fixed) return fixed;
    const cp = target.codePointAt(0)!;
    const unihan = this.unihanReadings(cp).map(markedToNumbered);
    const own = (this.entries.get(target) ?? []).filter((e) => e.simp === target || e.trad === target);
    const ranked = own
      .map((e, i) => ({ e, i, p: entryPenalty(e) }))
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .map((x) => x.e.pinyin.toLowerCase())
      .filter((p) => !p.includes(' '));
    const good = own.filter((e) => entryPenalty(e) < 2).map((e) => e.pinyin.toLowerCase()).filter((p) => !p.includes(' '));
    // A "used in X" row (卜 bo2 in 萝卜) only says how the character sounds inside another word: the bare character's own
    // rows are tried first, so 卜 is bǔ although Unihan lists bo first.
    const boundOnly = new Set(own.filter((e) => /^used in /i.test(e.defs[0] ?? '')).map((e) => e.pinyin.toLowerCase()));
    const rankedOwn = ranked.filter((p) => !boundOnly.has(p));
    for (const pools of [[good, rankedOwn], [good, ranked]]) {
      for (const u of unihan) {
        const b = baseOf(u);
        for (const pool of pools) {
          const hit = pool.find((c) => c === u) ?? pool.find((c) => baseOf(c) === b);
          if (hit) return hit;
        }
      }
    }
    if (good.length) return good[0];
    if (ranked.length) return ranked[0];
    if (unihan.length) return unihan[0];
    const xr = this.extraReadings(cp).map(markedToNumbered);
    if (xr.length) return xr[0];
    // Simplified/traditional counterparts share the pronunciation; semantic variants might not, so skip those.
    const f = this.fields(cp);
    for (const v of [...toArray(f[5]), ...toArray(f[6])]) {
      if (v === target) continue;
      const r = this.defaultSyllable(v, visiting);
      if (r) return r;
    }
    return '';
  }

  /** Reading of a multi-character word from CEDICT, aligned to its code points, or null. */
  private wordReading(word: string, cps: string[]): string[] | null {
    let cand = this.wordReadingCache.get(word);
    if (cand === undefined) {
      cand = this.pickWordReading(word, cps);
      if (this.wordReadingCache.size > 50000) this.wordReadingCache.clear();
      this.wordReadingCache.set(word, cand);
    }
    if (!cand) return null;
    const out = cand.syllables.slice();
    // 王夫人, 甘夫人: CEDICT writes the second syllable of 夫人 neutral, the dictionaries of the language say fūrén.
    if (word.endsWith('夫人') && out[out.length - 1] === 'ren5') out[out.length - 1] = 'ren2';
    return out;
  }

  private pickWordReading(word: string, cps: string[]): ReadingCandidate | null {
    const list = this.entries.get(word);
    if (!list) return null;
    const han = cps.map((c) => isHanCodePoint(c.codePointAt(0)!));
    const hanCount = han.filter(Boolean).length;
    let best: ReadingCandidate | null = null;
    list.forEach((e, order) => {
      const syl = e.pinyin.toLowerCase().split(' ');
      const aligned = alignSyllables(syl, cps.length, han, hanCount);
      if (!aligned) return;
      let agree = 0;
      for (let i = 0; i < cps.length; i++) if (aligned[i] && aligned[i] === this.defaultSyllable(cps[i])) agree++;
      // A curated reading for the word beats everything (see WORD_READINGS).
      const curated = WORD_READINGS[e.simp] === e.pinyin.toLowerCase() ? 100 : 0;
      const cand = { syllables: aligned, penalty: entryPenalty(e) - 0.1 * agree - curated, order };
      if (!best || cand.penalty < best.penalty - 1e-9) best = cand;
    });
    return best;
  }

  /**
   * `ctx.prev` / `ctx.next` are the text of the neighbouring tokens (of any kind), used by the polyphone rules.
   * Returns lowercase numbered syllables, one per code point; "" for non-Han code points and for Han characters
   * that no source knows a reading for.
   */
  pinyinFor(word: string, ctx?: PinyinContext): string[] {
    const w = this.normalizeWord(word);
    const cps = Array.from(w);
    const n = cps.length;
    if (n === 0) return [];
    // The word as the book writes it (盡數 for 尽数, 為 for 为): it settles what the simplified form merges.
    const origCps = ctx?.orig && ctx.orig !== word ? Array.from(this.normalizeWord(ctx.orig)) : undefined;
    const orig = origCps && origCps.length === n ? origCps : undefined;
    const running = n >= 2 ? RUNNING_TEXT_READINGS[w] ?? (orig ? RUNNING_TEXT_READINGS[orig.join('')] : undefined) : undefined;
    if (running) return running.split(' ');
    const special = n >= 2 ? this.contextWordReading(w, ctx) : undefined;
    if (special) return special;
    // 不了 straight after a verb is a potential complement (走不了, 吃不了): bu is neutral.
    if (w === '不了' && ctx?.prev && isHanCodePoint(lastCodePoint(ctx.prev).codePointAt(0) ?? 0) && !/[个個]$/.test(ctx.prev)) {
      return ['bu5', 'liao3'];
    }
    // 那裏肯聽, 那裏敢: "how could (he)" is nǎ li; 那裏 elsewhere is nà li "there".
    // 他调到那里当个小组长, 去那里当专员 (there) stay nàli after a word of place or motion. 那里有这样的事 (how could there be) is nǎli.
    // 从好友那里得到 (from his place): a 从 在 向 … a few words back says the same.
    // The look back stops at the clause's start (跪在地下，那里肯起来: the 在 is the other clause's), and a place word after the
    // 在 is its object (你们在家里那里知道).
    // A book that writes 那 for 哪 (core/bookStyle.ts): 那里 那个 那一 … that ask which or where are nǎ (你们往那里跑？, 那个便宜？).
    // The reader said the book's 那 is written as meant: nà, whatever the rules for the old novels below would say.
    if (ctx?.spellings?.naAsWritten && n >= 2 && NA_WORDS.has(w)) {
      const r = this.pinyinFor(word, { ...ctx, spellings: undefined });
      r[0] = 'na4';
      return r;
    }
    if (ctx?.spellings?.na && n >= 2 && NA_WORDS.has(w) && ctx.line && ctx.at !== undefined && ctx.line[ctx.at] === word) {
      const lo = Math.max(0, ctx.at - 14);
      const win = ctx.line.slice(lo, ctx.at + 18).map((t) => this.t2s.convert(t));
      if (asksWithNa(win, ctx.at - lo, (x) => this.verbStrength(x) >= 1)) {
        const r = this.pinyinFor(word, { ...ctx, spellings: undefined });
        r[0] = 'na3';
        return r;
      }
    }
    const isNali = w === '那裏' || w === '那里' || w === '那裡';
    const back: string[] = [];
    if (isNali && ctx?.line && ctx.at !== undefined) {
      for (let k = 1; k <= 5; k++) {
        const t = ctx.line[ctx.at - k] ?? '';
        if (!isHanCodePoint(lastCodePoint(t).codePointAt(0) ?? 0)) break;
        back.push(this.t2s.convert(t));
      }
    }
    const governed = back.some((t, k) => k >= 1 && /^[从在向跟到]$/.test(t) && !back.slice(0, k).some((x) => /^.+[里裏上中下外内边處处]$/.test(x)));
    // 不知那里去了, 不知道在那里了 (where): nǎ, even after 在; 不知那里的风俗 (there) stays.
    const unknown = back.some((t, k) => /^(不知|不知道|不晓得|不知是)$/.test(t) || (t === '知' && back[k + 1] === '不'))
      || /(不知|不知道|不晓得)$/.test(this.t2s.convert(ctx?.prev ?? ''));
    // (不知那里如今怎样: there, when the clause asks how.)
    const rest: string[] = [];
    if (isNali && ctx?.line && ctx.at !== undefined) {
      for (let k = ctx.at + 1; k < ctx.line.length && k <= ctx.at + 8; k++) {
        if (!isHanCodePoint(ctx.line[k].codePointAt(0) ?? 0)) break;
        rest.push(this.t2s.convert(ctx.line[k]));
      }
    }
    if (isNali && unknown && ctx?.next && !/^(的|有|是)/.test(this.t2s.convert(ctx.next)) && !rest.some((t) => /怎|如何|什么|甚么/.test(t))) return ['na3', 'li5'];
    // (就那里挦得干净: right there.)
    const nali = isNali && !(ctx?.prev && /[在去到从從往来來住回于於向就]$/.test(ctx.prev)) && !governed;
    if (nali && ctx?.next && '肯敢能會会曉晓知曾容顧顾管禁當当及捨舍得'.includes(firstCodePointOf(ctx.next))) return ['na3', 'li5'];
    // In the old novels (written 那裏) a question with no other question word asks where or how: 长老那里来的？ 你往那里走了？
    // 他们那里看得出来？ (那里有多少人马？, 你在那里做什么？, 在那里么？ stay "there").
    if (isNali && ctx?.orig === '那裏' && ctx.line && ctx.at !== undefined) {
      const clause: string[] = [];
      let end = '';
      for (let k = ctx.at + 1; k < ctx.line.length && k <= ctx.at + 12; k++) {
        const t = ctx.line[k];
        if (!isHanCodePoint(t.codePointAt(0) ?? 0)) { end = t; break; }
        clause.push(this.t2s.convert(t));
      }
      const before = back.slice(0, back.length);
      // (我那里, 他那里, 你们那里: someone's place.)
      const asks = /^[？?]/.test(end) && clause.length > 0 && !/[我你他她们們家处處这這]$/.test(this.t2s.convert(ctx.prev ?? ''))
        && ![...clause, ...before].some((t) => /什么|甚么|甚麼|谁|怎|几|多少|何|吗|么|否|没有|不曾|可曾/.test(t));
      if (asks) return ['na3', 'li5'];
    }
    // 说那里话 (what nonsense), 那里睡得著 那里吃得下 (how could one), 你是那里来的 (where from): nǎli.
    if (isNali && ctx?.next && (/^[話话]$/.test(ctx.next) || (nali && [...ctx.next].length === 1 && /^[得]([着著下动動进進了过過去来來住]|$)/.test(this.t2s.convert(ctx.after ?? '')))
      || (nali && /^.得[着著下动動进進了过過去来來住]$/.test(this.t2s.convert(ctx.next)))
      || (/^[來来]$/.test(ctx.next) && /^的$/.test(ctx.after ?? '') && /是$/.test(ctx.prev ?? '') && ctx.orig === '那裏'))) return ['na3', 'li5'];
    if (nali && ctx?.next && /^[有]$/.test(ctx.next) && !(ctx.prev && /[我你他她们們]$/.test(ctx.prev)) && /^(这|這|此|那等|这等|這等|这样|這樣|这般|這般|这么|這麼)/.test(ctx.after ?? '')) return ['na3', 'li5'];
    // 那里还敢, 那里还肯 (how could … still); 那里还是 (there was still) stays nàli.
    if ((w === '那裏' || w === '那里' || w === '那裡') && ctx?.next && /^[還还]$/.test(ctx.next) && /^[敢肯管顧顾容]/.test(ctx.after ?? '')) return ['na3', 'li5'];
    // 那里的话 (not at all), 那里走？ (where are you going?): nǎli.
    if ((w === '那裏' || w === '那里' || w === '那裡') && ctx?.next && ((ctx.next === '的' && /^[話话]/.test(ctx.after ?? '')) || (/^(走|去|來|来)$/.test(ctx.next) && /^[？?]/.test(ctx.after ?? '')))) return ['na3', 'li5'];
    // 兄弟，我前日…: a man addressing his friend, or 我兄弟 "my younger brother", is xiōng di; 兄弟二人 (brothers) stays xiōngdì.
    if (w === '兄弟' && ctx && !/^[\p{Script=Han}]/u.test(ctx.next ?? '。') && (!ctx.prev || !isHanCodePoint(lastCodePoint(ctx.prev).codePointAt(0) ?? 0) || '我你他咱'.includes(lastCodePoint(ctx.prev)))) return ['xiong1', 'di5'];
    // 宝兄弟, 琏兄弟, 环兄弟 (紅樓夢): a young man addressed by his name (xiōngdi), not "brothers".
    if (w === '兄弟' && ctx?.prev && /^[宝寶琏璉环環蓉蔷薔芸]$/.test(ctx.prev)) return ['xiong1', 'di5'];
    // 十餘騎馬 (a dozen horsemen, jì) after a number: the word 騎馬 "to ride a horse" is not meant.
    if ((w === '騎馬' || w === '骑马') && ctx?.prev && '一二兩两三四五六七八九十數数餘余'.includes(lastCodePoint(ctx.prev)) && !(ctx.next && isHanCodePoint(firstCodePointOf(ctx.next).codePointAt(0) ?? 0) && '來来去上下'.includes(firstCodePointOf(ctx.next)))) return ['ji4', 'ma3'];
    // 勒住馬: rein in the horse (lè zhù), not the lēi zhù "to strangle, to tie tight" of 勒住.
    if (w === '勒住' && ctx?.next && '馬马韁缰繩绳'.includes(firstCodePointOf(ctx.next))) return ['le4', 'zhu4'];
    // 正行間, 方行間: "while walking" (xíng jiān), not the "between the lines" of 行間.
    if ((w === '行間' || w === '行间') && ctx?.prev && '正方在忽只'.includes(lastCodePoint(ctx.prev))) return ['xing2', 'jian1'];
    // 重重圍住, 重重疊疊 (layer upon layer, chóng chóng); 重重賞 重重責罰 (heavily) stay zhòng zhòng.
    if ((w === '重重') && ctx?.next && '圍围疊叠複复層层山嶂障門门谷關关'.includes(firstCodePointOf(ctx.next))) return ['chong2', 'chong2'];
    // 士大夫 卿大夫 中大夫: an official of the old courts (dàfū), not the doctor 大夫 (dàifu).
    if (w === '大夫' && ctx?.prev && '卿士中上下諫谏議议光祿禄太御諸诸寺'.includes(lastCodePoint(ctx.prev))) return ['da4', 'fu1'];
    if (n >= 2) {
      const hit = (orig && this.narrows(orig.join(''), w) && this.wordReading(orig.join(''), orig)) || this.wordReading(w, cps);
      if (hit) {
        // Verb + 不 + complement (受不了, 说不定): CC-CEDICT often writes bu4, but the 不 is neutral. After an adverb it is the
        // plain negation (岂不是, 还不如, 并不是).
        if (n === 3 && cps[1] === '不' && w !== '要不然' && !'岂豈还還并並决決绝絕也都就又更可'.includes(cps[0])) hit[1] = 'bu5';
        return hit;
      }
    }
    const out = new Array<string>(n).fill('');
    // A word the dictionary lacks (a jieba compound such as 总队长 or 少年儿童) reads like the dictionary words
    // inside it (队长 duìzhǎng, 儿童 értóng); only the characters left over use the single-character rules.
    const pieces = n >= 3 ? this.subWords(cps) : [];
    for (const [a, b] of pieces) {
      const sub = this.wordReading(cps.slice(a, b).join(''), cps.slice(a, b));
      if (sub) for (let k = a; k < b; k++) out[k] = sub[k - a];
    }
    // A one-character token may look further along its paragraph (为 X 所, 以 X 为) when the caller gave the paragraph's tokens.
    const line = ctx?.line;
    const at = ctx?.at;
    const tok = n === 1 && line && at !== undefined && line[at] === word
      ? (k: number): string => { const t = line[at + k]; return t === undefined ? '' : this.t2s.convert(t); }
      : undefined;
    for (let i = 0; i < n; i++) {
      if (out[i] || !isHanCodePoint(cps[i].codePointAt(0)!)) continue;
      // 儿 is the erhua suffix only at the end of a word; inside one (儿童, 少年儿童) it is ér.
      if ((cps[i] === '儿' || cps[i] === '兒') && i < n - 1 && isHanCodePoint(cps[i + 1].codePointAt(0)!)) {
        out[i] = 'er2';
        continue;
      }
      const prevTok = i > 0 ? cps.slice(0, i).join('') : ctx?.prev ?? '';
      const nextTok = i < n - 1 ? cps.slice(i + 1).join('') : ctx?.next ?? '';
      // The rules are written for simplified text; traditional input is folded first (長 -> 长, 還 -> 还).
      // 著 is the traditional form of 着 as a particle; as zhù it only occurs in words CEDICT lists.
      const key = cps[i] === '著' ? '着' : this.t2s.convert(cps[i]);
      const prevS = this.t2s.convert(prevTok);
      const nextS = this.t2s.convert(nextTok);
      const afterS = i < n - 1 ? '' : this.t2s.convert(ctx?.after ?? '');
      const rule = polyphoneRule({
        ch: key,
        orig: orig ? orig[i] : cps[i],
        prevTok: prevS,
        nextTok: nextS,
        prevChar: lastCodePoint(prevS),
        nextChar: firstCodePointOf(nextS),
        afterChar: firstCodePointOf(afterS),
        afterTok: afterS,
        nextKnown: i < n - 1 || ctx?.next !== undefined,
        alone: n === 1,
        tok,
        verb: this.verbStrength,
        word: this.listed,
        noun: this.nounish,
        ...(ctx?.spellings ? { spellings: ctx.spellings } : {}),
        ...(ctx?.named ? { named: ctx.named } : {}),
      });
      const usual = rule.reading ?? this.defaultSyllable(orig && this.narrows(orig[i], cps[i]) ? orig[i] : cps[i]);
      // Where no rule's case matched a one-character token, the reading model may speak, among the character's own readings.
      const own = orig ? orig[i] : cps[i];
      const model = tok ? this.readingModel : null;
      const ask = !!model && rule.usual && model.knows?.(key) !== false;
      const site: ReadingSite | undefined = model && (ask || model.observe) ? {
        ch: key, tok: tok!, verb: this.verbStrength, noun: this.nounish, script: ctx?.script,
        pair: (k) => this.pairReading(key, k < 0 ? lastCodePoint(prevS) : firstCodePointOf(nextS), k),
      } : undefined;
      const learned = ask && site ? model!.choose(site, usual, (r) => this.readsAs(key, r) && this.readsAs(own, r)) : undefined;
      if (site && model!.observe) model!.observe(site, usual, !rule.usual);
      out[i] = learned ?? usual;
    }
    // A verb + 不 + complement that the dictionary lacks (走不动, 看不到): the 不 is neutral.
    if (n === 3 && (cps[1] === '不') && isHanCodePoint(cps[0].codePointAt(0)!)) out[1] = 'bu5';
    return out;
  }

  /** The reading of `ch` in the dictionary word it makes with `other` before it (k < 0) or after it, "" when there is none. */
  private pairReading(ch: string, other: string, k: number): string {
    if (!other || !isHanCodePoint(other.codePointAt(0)!)) return '';
    const cps = k < 0 ? [other, ch] : [ch, other];
    return this.wordReading(cps.join(''), cps)?.[k < 0 ? 1 : 0] ?? '';
  }

  /** Hands pinyinFor the reading model (core/readingModel.ts), or takes it away with null. */
  setReadingModel(model: ReadingChooser | null): void {
    this.readingModel = model;
  }

  /** Whether `reading` (numbered) is one of the character's own: a CC-CEDICT row of the character itself, or Unihan's. */
  private readsAs(ch: string, reading: string): boolean {
    let set = this.ownReadings.get(ch);
    if (!set) {
      set = new Set((this.entries.get(ch) ?? []).filter((e) => e.simp === ch || e.trad === ch).map((e) => e.pinyin.toLowerCase()));
      for (const u of this.unihanReadings(ch.codePointAt(0)!)) set.add(markedToNumbered(u));
      this.ownReadings.set(ch, set);
    }
    return set.has(reading);
  }

  /**
   * Whether the book's own spelling settles more than the spelling shown: it has fewer dictionary readings (髮 fà against 发 fā fà,
   * 盡數 against 尽数). A spelling with as many (繃 and 绷, 這裏 and 这里) says nothing more, so the shown word keeps its reading.
   */
  private narrows(own: string, shown: string): boolean {
    const count = (x: string) => new Set((this.entries.get(x) ?? []).filter((e) => e.simp === x || e.trad === x).map((e) => e.pinyin.toLowerCase())).size;
    if (CHAR_DEFAULTS[own] && !CHAR_DEFAULTS[shown]) return false; // 箇 ge5 is how 这箇 is said, not a narrower 个
    const a = count(own);
    return a > 0 && a < count(shown);
  }

  /**
   * Words whose reading the neighbors decide (both readings are CC-CEDICT's): 人家 after a measure word is a household (rénjiā),
   * 大汗 is the Khan unless someone is sweating. Undefined keeps the usual choice.
   */
  private contextWordReading(w: string, ctx?: PinyinContext): string[] | undefined {
    if (!ctx || !CONTEXT_WORDS.has(w)) return undefined;
    const prev = ctx.prev ? this.t2s.convert(ctx.prev) : '';
    const next = ctx.next ? this.t2s.convert(ctx.next) : '';
    const after = ctx.after ? this.t2s.convert(ctx.after) : '';
    const p = lastCodePoint(prev);
    const nx = firstCodePointOf(next);
    const clauseEnd = ctx.next !== undefined && !isHanCodePoint(nx.codePointAt(0) ?? 0);
    // The conversion keeps a lone 著 (it may be zhù), so 引著 執著 合著 are folded to their 着 case here.
    switch (this.t2s.convert(w).replace(/著/g, '着')) {
      case '人家':
        // 两户人家, 一簇人家, 小户人家, 有钱人家, 咱们这样人家: a household (rénjiā), not "other people" (rénjia).
        // 寻个人家, 找个人家 (a household); 这个人家里 stays: 个 after 这 那 is the person's.
        if (p === '个' && ctx.line && ctx.at !== undefined && !/[这這那哪]$/.test(this.t2s.convert(ctx.line[ctx.at - 2] ?? ''))) return ['ren2', 'jia1'];
        // 一户姓李的人家, 街两边的人家, 卖酒的人家 (a household described by a 的 phrase).
        return (HOUSEHOLD_BEFORE.test(prev) && !/(讨好|和好|友好|示好|叫好|讲好|说好|问好)$/.test(prev)) || (p !== '' && '户家簇百千几多'.includes(p))
          || (p === '的' && ctx.line !== undefined && ctx.at !== undefined && !/^(我|你|他|她|我们|你们|他们|她们|咱们)$/.test(this.t2s.convert(ctx.line[ctx.at - 2] ?? ''))
            && !/^(说|咒|骂|笑|讲|议论|知道|看|听|问)/.test(next)) ? ['ren2', 'jia1'] : undefined;
      case '大汗':
        // 满头大汗, 急出一身大汗, 大汗淋漓 are sweat; everywhere else (拜见大汗, 大汗的旨意) the Khan.
        return (p !== '' && '身头脸满浑出冒阵'.includes(p)) || /^(淋|直流|如雨|如注|涔|浃|珠|滴|湿|流)/.test(next) ? ['da4', 'han4'] : ['da4', 'han2'];
      case '教会':
        // 你教会我, 教会了他: taught someone how to (jiāohuì); the church otherwise.
        return nx !== '' && (PRONOUN_START.test(next) || nx === '了') ? ['jiao1', 'hui4'] : undefined;
      case '舍下':
        // 到舍下坐坐, 与我舍下相邻: my humble home (shèxià); 舍下他, 舍下了 (to abandon) stay shěxià.
        return PRONOUN_START.test(next) || '了不么吗'.includes(nx) && nx !== '' || /[都全肯能不]$/.test(prev) ? undefined : ['she4', 'xia4'];
      case '重重':
        // 困难重重, 危机重重。: layer upon layer (chóngchóng); 重重地打 (heavily) stays zhòngzhòng.
        return /(困难|危机|疑虑|心事|顾虑|矛盾|障碍|关卡|险阻|疑团|阻碍|艰难|疑云)$/.test(prev) || (clauseEnd && p !== '') ? ['chong2', 'chong2'] : undefined;
      case '分子':
        // 反动分子 捣乱分子 知识分子: a member (fènzǐ); 分子 alone is the molecule.
        return /(反动|坏|捣乱|知识|积极|犯罪|恐怖|危险|顽固|右派|左派|落后|激进|不法|异己|投机|动摇)$/.test(prev) ? ['fen4', 'zi3'] : undefined;
      case '一行':
        // 一行字 一行楷书, 上一行: a line of writing (yì háng); 一行人 (a party) stays yìxíng.
        // 芝麻一行，茄子一行 (a row of plants).
        return /^(字|楷书|大字|小字|诗|文字|一句|泪|树|白|醒目|编号|数字|小楷|红字|黑字|蓝字|英文|代码|符号|公式|歪歪)/.test(next) || /[上下另]$/.test(prev)
          || (clauseEnd && /(芝麻|茄子|豆|麦|玉米|菜|葱|蒜|瓜|庄稼|花|树|稻|谷|白杨|柳)$/.test(prev)) ? ['yi1', 'hang2'] : undefined;
      case '打折':
        // 打折了腿, 打折胳膊: to break by beating (dǎshé), not "to give a discount".
        return /^(腿|胳膊|手|脚|骨|肋|脊|脖)/.test(next) || (nx === '了' && /^(腿|胳膊|手|脚|骨|肋|脊|脖|他|她|你|我)/.test(after)) ? ['da3', 'she2'] : undefined;
      case '好吃': case '好喝':
        // 好吃懒做 (fond of eating): hào.
        return nx === '懒' ? ['hao4', w.endsWith('喝') ? 'he1' : 'chi1'] : undefined;
      case '利害':
        // 冷得利害, 疼的利害: 利害 for 厉害 (lìhai, terribly); 利害关系 (interests) stays lìhài.
        return (/[得的]$/.test(prev) && !/(顾不得|不顾|权衡|计较|不知|晓得|懂得)$/.test(prev)) || /(太|很|好|真|这么|那么|怎的)$/.test(prev) ? ['li4', 'hai5'] : undefined;
      case '格格':
        // 格格地笑: the giggle (gēgē), not the Manchu princess.
        return /^(地|的|笑|作响|直笑)/.test(next) ? ['ge1', 'ge1'] : undefined;
      case '精神':
        // 一点精神都没有, 来了精神, 打起精神: vigor (jīngshen).
        // The noun follows (精神准备, 精神信念, 精神的富足): jīngshén.
        // 有精神地 很精神的 打起精神来 鼓起精神往上爬 没精神再讲 没精神哩 (energetic) too; 连点精神上的享受 is the noun.
        if (/^(文明|生活|世界|食粮|财富|病|分析|层面|上|领域|力量|支柱|状态|面貌|意义|价值|准备|信念|污染|境界|产品|贵族|导师|家园|寄托|需求|追求|内涵|实质|本质|分裂|失常|错乱|创伤|折磨|压力|负担)/.test(next)) return undefined;
        // 得来精神 (got one's vigor back): jīngshen.
        if (/(打起|提起|鼓起|抖擞起|振作|振作起|抖擞|打点|养养|养足|抖起|来了|得来)$/.test(prev) || prev === '起') return ['jing1', 'shen5'];
        // 格外精神。 (lively): jīngshen after a word of degree too.
        return /(有|没|点|起|足|好|很|挺|真|不|格外|特别|十分|非常|越发|分外)$/.test(prev) && (clauseEnd || /^(也|都|了|着|很|不|头|劲|起来|来|些|十足|抖擞|焕发|多了|得|一振|再|哩|呢|啊|吧|罢|呀|啦|地)/.test(next)
          || ((/(很|挺|真|特|满|多|好)有?$/.test(prev) || (prev === '有' && /^(很|挺|真|特|满|多|好|十分|特别)$/.test(this.t2s.convert(ctx.line?.[(ctx.at ?? 0) - 2] ?? '')))) && /^的/.test(next))) ? ['jing1', 'shen5'] : undefined;
      case '正当':
        // 正当自卫, 正当理由: legitimate (zhèngdàng); 正当…之时 (just when) stays zhèngdāng.
        return /^(自卫|防卫|理由|权益|手段|职业|要求|利益|关系|的|性|行为)/.test(next) ? ['zheng4', 'dang4'] : undefined;
      case '得出': case '得到': case '得来': case '得起': case '得住':
        // 猜得出 料得到 想得到 办得到 (can guess, can do): the particle de after a verb; 他得到了 stays dé, and so does 想得到一点安慰
        // (wants to get: what is got follows).
        // (哪想得到, 谁想得到: who would have thought.)
        if (/想$/.test(prev) && this.t2s.convert(w).endsWith('到') && nx !== '' && !clauseEnd && !'吗嗎呢的了吧么麼啊呀'.includes(nx)
          && !/[哪谁誰那怎岂豈没沒不料]想$/.test(prev) && !(ctx.line && ctx.at !== undefined && [2, 3].some((k) => /^[哪谁誰那怎岂豈没沒不料]|[哪谁誰怎岂豈没沒不料]$/.test(ctx.line![ctx.at! - k] ?? '')))) return undefined;
        return VERB_BEFORE_DE.test(prev) ? ['de5', this.t2s.convert(w).endsWith('出') ? 'chu1' : this.t2s.convert(w).endsWith('到') ? 'dao4' : this.t2s.convert(w).endsWith('来') ? 'lai2' : this.t2s.convert(w).endsWith('起') ? 'qi3' : 'zhu4'] : undefined;
      case '引着':
        // 引着十数个打鱼的, 引着唐僧 (leading): yǐn zhe; 引着了 (caught fire) stays yǐnzháo.
        return nx !== '' && nx !== '了' && nx !== '火' && !clauseEnd ? ['yin3', 'zhe5'] : undefined;
      case '执着':
        // 手执着铁棒 (holding): zhí zhe; 执着于, 很执着, 对梦想的执着 (persistent, persistence) stay zhízhuó.
        return nx !== '' && !clauseEnd && !'于的地追精'.includes(nx) && !/(很|太|非常|更|过于|那么|这么|十分|的)$/.test(prev) ? ['zhi2', 'zhe5'] : undefined;
      case '合着':
        // 双手合着, 合着眼 (closed): hé zhe; 合著一书 (co-wrote) is hézhù.
        return /^(书|一书|本|作品|的书|《)/.test(next) ? ['he2', 'zhu4'] : ['he2', 'zhe5'];
      case '点着':
        // 点着头 点着对手 (pointing, nodding): diǎn zhe; 点着了 点着烟 (lit) stay diǎnzháo.
        return /^(头|对手|他|她|你|我|它|手|脚|下巴|对|自己|地图|鼻子)/.test(next) ? ['dian3', 'zhe5'] : undefined;
      case '东西':
        // 东西两角门, 南北东西, 布东西冲杀: east and west (dōngxī).
        // 屋里的东西向四处飞, 各样东西两大箱, 要的东西五花八门, 带的东西对半分 are things: a thing is what 的 什么 各样 … point at.
        // 只有东西两角门 (the east and west side gates): a pair of sides wins over 有 before it.
        if (/^[两兩二]$/.test(next) && /^(角|边|邊|厢|廂|面|侧|側|头|頭|门|門|府|院|街|岸|座|旁|廊)/.test(after)) return ['dong1', 'xi1'];
        if (/(的|什么|甚么|样|些|个|種|种|点|點|件|多|好|新|旧|舊|买|買|吃|拿|偷|送|卖|賣|有|这|這|那|此|么|麼)$/.test(prev)) return undefined;
        // 东西与南北正交, 东西城墙, 东西两侧 (the east-west line, the walls on both sides).
        return /^(两|二|各|相|南北|走向|方向|向|冲|角|厢|长|宽|横|对|分|半|夹|二十|三十|几十|数十|百|千|万|一百|长约|城墙|城门|大街|干道|轴线|距离|跨度|全长|直径|延伸|排列|长度|宽度|主轴|两侧|两端|两岸|两翼)/.test(next)
          || (/^(与|和|及|跟|同)$/.test(next) && /^南北/.test(after)) || /(南北|贯穿|横贯|分列)$/.test(prev) ? ['dong1', 'xi1'] : undefined;
      case '和好':
        // 和好的面团, 把面和好 (kneaded): huó hǎo; 和好如初 (made peace) stays héhǎo.
        return /^(的面|面|的面团|面团)/.test(next + after) || /面团?$/.test(prev) ? ['huo2', 'hao3'] : undefined;
      case '妻子':
        // 保妻子, 各顾妻子, 携妻子 (wife and children): qīzǐ.
        return /[保弃抛携及]$/.test(prev) || (/顾$/.test(prev) && clauseEnd) ? ['qi1', 'zi3'] : undefined;
      case '便宜':
        // 岂不便宜, 甚是便宜 (convenient): biànyí.
        return /(岂不|甚是|甚|极|最是|十分)$/.test(prev) || ['行事', '从事'].includes(next) ? ['bian4', 'yi2'] : undefined;
      case '结果':
        // 仙桃常结果, 开花结果 (to bear fruit): jiēguǒ.
        return /(常|会|开花|能|已|才|未|不会|不能|开始)$/.test(prev) && (clauseEnd || nx === '实') ? ['jie1', 'guo3'] : undefined;
      case '所长':
        // 各有所长, 取其所长, 发挥所长 (one's strong point): suǒcháng.
        return /[各其之尽展有挥取用]$/.test(prev) ? ['suo3', 'chang2'] : undefined;
      case '生意':
        // 毫无生意, 生意盎然 (vitality): shēngyì.
        return /(毫无|了无|一片|充满)$/.test(prev) || /^(盎然|勃勃|葱茏)/.test(next) ? ['sheng1', 'yi4'] : undefined;
      case '片子':
        // 石片子 肉片子: a flake, a slice (piànzi); a film is piānzi (WORD_READINGS).
        return /[石肉铁瓦木碎纸刀薄冰骨竹玻璃碗瓷镜锅铜锡金银屎脚腳尿布草菜叶葉]$/.test(prev) ? ['pian4', 'zi5'] : undefined;
      case '历数':
        // 歷數昭明, 历数无疆 (the destiny of a dynasty, lìshù), whichever way it is written; 历数其罪 (to enumerate) is lìshǔ.
        if (nx === '') return undefined;
        return /^[其他她罪诸諸各每着著了一]/.test(next) ? ['li4', 'shu3'] : ['li4', 'shu4'];
      case '卷子':
        // 一卷子材料 (a roll of), 一个卷子 吃卷子 蒸卷子 (a steamed roll): juǎnzi; the exam paper (juànzi) otherwise.
        return /([一个個吃蒸拣揀糊烧燒馒饅花肉菜油]|^一)$/.test(prev) ? ['juan3', 'zi5'] : undefined;
      case '好事':
        // 生性好事的掌柜, 好事之徒 (meddlesome): hàoshì; a good deed is hǎoshì.
        return /(而|又|最|太|很|生性|素来|多|爱)$/.test(prev) && /^(的|之|者)/.test(next) ? ['hao4', 'shi4'] : undefined;
      case '大意':
        // 太大意了, 一时大意, 千万别大意 (careless): dàyi; the gist (dàyì) otherwise.
        return /(太|很|不可|别|粗心|麻痹|一时|有点|过于|真|可不能|千万|不要|一点|稍|稍一|大大意)$/.test(prev) || nx === '了' ? ['da4', 'yi5'] : undefined;
      case '丁丁':
        // 伐木丁丁 (the sound of chopping): zhēngzhēng.
        return /(伐木|木|斧|斤|棋|漏|声)$/.test(prev) ? ['zheng1', 'zheng1'] : undefined;
      case '多少':
        // 花落知多少。 (how much): duōshǎo, a full tone at the end of a line of verse.
        return prev === '知' && clauseEnd && !/[不谁誰]$/.test(this.t2s.convert(ctx.line?.[(ctx.at ?? 0) - 2] ?? '')) ? ['duo1', 'shao3'] : undefined;
      case '巷道':
        // In a paragraph about a mine (井 煤 矿 掘进), 巷道 is the tunnel (hàngdào); elsewhere a lane (xiàngdào).
        return ctx.line?.some((t) => /[井煤矿礦掘坑岩]|工作面|采煤|採煤/.test(t)) ? ['hang4', 'dao4'] : undefined;
      case '长毛':
        // 长毛了 (grew mold) is zhǎng máo; the Taiping 长毛 and long hair are cháng máo.
        return nx === '了' ? ['zhang3', 'mao2'] : ['chang2', 'mao2'];
      case '地道':
        // 玩得很地道, 他的口音真地道 (authentic, the real thing): dìdao; the tunnel is dìdào.
        return /(很|挺|真|得|不|特别|相当|非常|十分|够|最|多么|那么|这么|太)$/.test(prev) ? ['di4', 'dao5'] : undefined;
      case '一晃':
        // 身体 一晃 就跌倒, 他一晃 (the body swayed): yī huàng; 一晃就是十年 (in a flash) and 身子一晃，已 + a leap (flashed across:
        // a leap or a dodge follows) stay yī huǎng.
        if (!/(身体|身子|身|人|头|脑袋|他|她|我|你)$/.test(prev) || /^(就是|便是|又是|过了|过去|多年|几年|十年|半年|一年)/.test(next)) return undefined;
        if (ctx.line && ctx.at !== undefined && ctx.line.slice(ctx.at + 1, ctx.at + 5).some((t) => /^(已|又已|便已|早已|跃|闪|窜|飘|掠|欺|抢|纵)/.test(this.t2s.convert(t)))) return undefined;
        return ['yi1', 'huang4'];
    }
    return undefined;
  }

  /**
   * Dictionary words of 2+ code points that tile as much of `cps` as possible (ties: fewer pieces), as
   * [start, end) code-point ranges. Characters not covered are left out.
   */
  private subWords(cps: string[]): [number, number][] {
    const n = cps.length;
    // best[i] = [chars covered by words in cps[i..], pieces used, chosen end or -1 for a single char]
    const best: [number, number, number][] = new Array(n + 1);
    best[n] = [0, 0, -1];
    for (let i = n - 1; i >= 0; i--) {
      best[i] = [best[i + 1][0], best[i + 1][1] + 1, -1];
      for (let j = Math.min(n, i + 8); j >= i + 2; j--) {
        if (j - i === n || !this.entries.has(cps.slice(i, j).join(''))) continue;
        // Never split a reduplicated pair (山山地 is 山山 + 地 de, not 山 + 山地 shāndì).
        if (i > 0 && cps[i] === cps[i - 1]) continue;
        const covered = j - i + best[j][0];
        const count = 1 + best[j][1];
        if (covered > best[i][0] || (covered === best[i][0] && count < best[i][1])) best[i] = [covered, count, j];
      }
    }
    const out: [number, number][] = [];
    for (let i = 0; i < n;) {
      const j = best[i][2];
      if (j > 0) { out.push([i, j]); i = j; } else i++;
    }
    return out;
  }
}

/** What pinyinFor may know about the text around a word (see Dictionary.pinyinFor). */
export interface PinyinContext {
  prev?: string;
  next?: string;
  /** The token after `next`. */
  after?: string;
  /** The word as the book writes it (為, 盡數 for 为, 尽数), same number of code points; it settles what the simplified form merges. */
  orig?: string;
  /** The paragraph's tokens and the index of this word among them, for rules that look further than prev/next (为 X 所, 以 X 为). */
  line?: readonly string[];
  at?: number;
  /** The book's old spellings the reader follows (底 for 的, 那 for 哪: core/bookStyle.ts). */
  spellings?: OldSpellings;
  /** The kind of a token of `line` that the book's lexicon holds, asked in simplified (a place before 为 is a noun). */
  named?: (w: string) => LexiconEntry['kind'] | undefined;
  /** The script the paragraph is written in, as the book writes it (core/text.ts detectScript), worked out when first asked. */
  script?: () => string;
}

/** Words in 那 that ask which or where in a book that writes 那 for 哪 (pinyinFor, core/bookStyle.ts). */
const NA_WORDS: ReadonlySet<string> = new Set(['那里', '那裏', '那裡', '那儿', '那兒', '那个', '那個', '那些', '那位', '那种', '那種']);

/** The words contextWordReading decides, in both scripts (looked up before any conversion, so other words cost nothing). */
const CONTEXT_WORDS: ReadonlySet<string> = new Set([
  '人家', '大汗', '教会', '教會', '舍下', '捨下', '重重', '分子', '一行', '打折', '好吃', '好喝', '利害', '格格', '精神', '正当', '正當',
  '得出', '得到', '得来', '得來', '得起', '得住', '引着', '引著', '执着', '執著', '执著', '合着', '合著', '点着', '點著', '东西', '東西', '妻子',
  '便宜', '结果', '結果', '所长', '所長', '生意', '历数', '歷數', '曆數', '片子', '巷道', '长毛', '長毛', '卷子', '捲子', '好事', '大意',
  '丁丁', '多少', '地道', '一晃', '和好',
]);

/** Words before 人家 that make it a household: 小户人家, 有钱人家, 这样人家, 寻常人家, 庄上人家. */
const HOUSEHOLD_BEFORE = /(穷|富|富庶|寻常|平常|普通|有钱|百姓|小康|官宦|读书|贫寒|贫贱|本分|规矩|体面|中等|殷实|豪富|大户|小户|猎户|庄户|这样|那样|这种|那种|这等|那等|一般|好|不少|其他|许多|村里|庄上|城里|山里|那家|一家|有些|所有|有没有|几户|每户|哪家|这些|那些)$/;
const PRONOUN_START = /^(我|你|您|他|她|它|咱|人家|大家)/;
/** Verbs before 得出 得到 …: the particle de, not dé (猜得出, 料得到, 想得到, 办得到, 买得起, 靠得住). */
const VERB_BEFORE_DE = /(猜|料|想|看|听|办|做|找|买|吃|拿|说|写|认|学|记|赶|追|跑|走|飞|跳|闻|摸|觉|感|受|靠|守|顶|撑|站|坐|靠|挡|管|对|瞧|估|算)$/;

/**
 * Words whose everyday reading in running text is not the one CC-CEDICT lists: 穿着 is almost always the verb
 * 穿 + 着 (chuān zhe); CEDICT has only the noun "attire" (chuānzhuó).
 */
const RUNNING_TEXT_READINGS: Readonly<Record<string, string>> = {
  穿着: 'chuan1 zhe5', 穿著: 'chuan1 zhe5',
  // Adverbs in -地 that CEDICT writes with the particle de5; the standard reading (and the one in the books) is dì.
  猛地: 'meng3 di4', 忽地: 'hu1 di4', 蓦地: 'mo4 di4', 驀地: 'mo4 di4', 倏地: 'shu1 di4', 霍地: 'huo4 di4', 突地: 'tu1 di4', 陡地: 'dou3 di4',
  // 钉钯 is the rake (pá) of Zhu Bajie, not the metal 钯 (bǎ).
  钉钯: 'ding1 pa2', 釘鈀: 'ding1 pa2',
  // 倒把 is the adverb 倒 + the 把 construction in the novels (倒把我…), not the profiteering word.
  倒把: 'dao4 ba3',
  // 衣甲 is the armor (yī jiǎ) in the novels, not the verb "to put on armor"; 夫人 is fūrén (CEDICT writes the second syllable neutral).
  衣甲: 'yi1 jia3', 夫人: 'fu1 ren2',
  // Buddhist salutation: 南無阿彌陀佛 is nā mó, not 南 + 無.
  南無: 'na1 mo2', 南无: 'na1 mo2',
  // 恁 is nèn "such" in the novels (CEDICT lists the thinking rèn first): 恁般 恁地 恁的 恁么.
  恁般: 'nen4 ban1', 恁地: 'nen4 di4', 恁的: 'nen4 de5', 恁么: 'nen4 me5', 恁麼: 'nen4 me5',
  拚命: 'pin1 ming4', 拼命: 'pin1 ming4', 拚死: 'pin1 si3', 拼死: 'pin1 si3', 比拚: 'bi3 pin1',
  // 引得众人 (caused): a verb and 得, not the loanword "index"; 不自禁 (cannot help it) is jīn.
  引得: 'yin3 de5', 不自禁: 'bu4 zi4 jin1',
  // 累卵 is lěi luǎn (eggs piled up), not the léi of 累赘.
  累卵: 'lei3 luan3',
  // 唯唯 (yes, yes): wěiwěi. 惠子 (the philosopher, the Japanese name Keiko) is Huìzǐ.
  唯唯: 'wei3 wei3', 惠子: 'hui4 zi3',
  // Chagatai: Cháhétái (CEDICT writes the Taiwan reading with gě).
  察合台: 'cha2 he2 tai2', 察合臺: 'cha2 he2 tai2',
  // Layer upon layer, built by the reduplication rule from 重叠 (no dictionary row of its own).
  重重叠叠: 'chong2 chong2 die2 die2', 重重疊疊: 'chong2 chong2 die2 die2',
  // A basket carried on the back (bēi, as the dictionaries of the language have it; CEDICT writes bèidōu).
  背篼: 'bei1 dou1',
};

const SYLLABLE_TOKEN = /^[a-zü]+[1-5]$/;

/** Map CEDICT syllables onto code points; non-Han code points get "". Null when the counts do not line up. */
function alignSyllables(syl: string[], total: number, han: boolean[], hanCount: number): string[] | null {
  const out = new Array<string>(total).fill('');
  if (syl.length === total) {
    for (let i = 0; i < total; i++) if (han[i] && SYLLABLE_TOKEN.test(syl[i])) out[i] = syl[i];
    return out.some((s, i) => han[i] && !s) ? null : out;
  }
  // Some entries spell out Latin letters or "·" as extra tokens; align on the Han characters only.
  const sylOnly = syl.filter((s) => SYLLABLE_TOKEN.test(s));
  if (sylOnly.length !== hanCount) return null;
  let k = 0;
  for (let i = 0; i < total; i++) if (han[i]) out[i] = sylOnly[k++];
  return out;
}
