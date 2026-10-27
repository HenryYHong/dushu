// The dictionary: CC-CEDICT words, Unihan characters, segmentation vocabulary, HSK, script conversion.
// Contract: ARCHITECTURE.md §3 and §4.1.
import type { CharInfo, DataMeta, DictEntry, Dictionary, HskInfo, RadicalInfo } from '../types';
import { ConvTable } from './convert';
import { hanBlockName } from './blocks';
import { baseOf, markedToNumbered, normalizePinyinField, numberedToMarked } from './pinyin';
import { CHAR_DEFAULTS, WORD_READINGS, firstCodePointOf, lastCodePoint, polyphoneReading } from './polyphone';
import { isHanCodePoint } from './text';

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
async function fetchDataText(url: string, keep?: LoadOptions['keep'], count?: (size: number, read: number) => void): Promise<string> {
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

const SPECIAL_RE = /[\u2E80-\u2FDF\uF900-\uFAFF\uD87E]/; // radicals, compatibility ideographs (and the supplement's high surrogate)
const EMPTY: string[] = [];

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

  private charLines = new Map<number, string>();
  private extraLines = new Map<number, string>();
  private compat = new Map<number, string>();
  private radicalByNum = new Map<string, { radicalChar: string; char: string }>();
  private radicalToChar = new Map<string, string>();

  private hskMap = new Map<string, HskInfo>();
  private hskRows: { simp: string; level: number; rank: number }[] = [];
  private t2s = new ConvTable();
  private s2t = new ConvTable();

  private charCache = new Map<number, CharInfo>();
  private defaultCache = new Map<string, string>();
  private wordReadingCache = new Map<string, ReadingCandidate | null>();

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
      if (supplement) this.wordsExtraLoaded++;
      this.addEntry(entry.simp, entry);
      if (entry.trad !== entry.simp) { this.addEntry(entry.trad, entry); this.twoScript.push(entry); }
      else if (entry.simp.length > 1) this.sameScript.push(entry.simp);
    });
  }

  /**
   * Curated senses (public/data/book-words.tsv.gz, built from scripts/data/book-words.tsv). A row with the same trad,
   * simp and pinyin as a CEDICT row replaces that row's definitions; any other row is added. Either way it moves to
   * the front of the list for each of its headwords, so it leads the popup, the card and the saved gloss.
   * The optional fifth column raises the segmentation count of a word that no list has (鴻濛).
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
      if (count > 0) for (const key of keys) if ((this.vocab.get(key) ?? 0) < count) this.vocab.set(key, count);
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

  private async parseHsk(text: string): Promise<void> {
    await eachLine(text, (line) => {
      const t = line.split('\t');
      const hsk3 = Number(t[2]) || undefined;
      const hsk2 = Number(t[3]) || undefined;
      const rank = Number(t[4]) || undefined;
      const info: HskInfo = {};
      if (hsk3) info.hsk3 = hsk3;
      if (hsk2) info.hsk2 = hsk2;
      if (rank) info.rank = rank;
      if (!this.hskMap.has(t[0])) this.hskMap.set(t[0], info);
      if (t[1] && !this.hskMap.has(t[1])) this.hskMap.set(t[1], info);
      if (hsk3) this.hskRows.push({ simp: t[0], level: hsk3, rank: rank ?? 1e9 });
      for (const w of [t[0], t[1]]) if (w && !this.vocab.has(w)) this.vocab.set(w, 0);
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
    for (const word of this.vocab.keys()) {
      if (++seen % INDEX_CHUNK === 0) await yieldToEventLoop();
      let n = 0;
      for (let i = 0; i < word.length; i++) {
        const c = word.charCodeAt(i);
        if (c < 0xdc00 || c > 0xdfff) n++;
      }
      if (n < 2 || n > 30) continue;
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
      const alt = this.s2t.convert(e.simp);
      if (alt === e.trad || alt === e.simp || this.entries.has(alt)) continue;
      this.entries.set(alt, [e]);
      const count = Math.max(this.vocab.get(e.simp) ?? 0, this.vocab.get(e.trad) ?? 0);
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

  /** Per-character normalization of compatibility ideographs and radicals. Never NFKC on whole strings. */
  private normalizeWord(word: string): string {
    if (!SPECIAL_RE.test(word)) return word;
    let out = '';
    for (const ch of word) out += this.normalizeCp(ch);
    return out;
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

  hsk(word: string): HskInfo | null {
    const w = this.normalizeWord(word);
    // The list's traditional column is often a rare variant for a single character (时 → 旹, 听 → 听), so a traditional
    // spelling it misses looks up its simplified form: 聽, 時, 這個.
    let info = this.hskMap.get(w);
    if (!info) { const simp = this.toSimplified(w); if (simp !== w) info = this.hskMap.get(simp); }
    return info ? { ...info } : null;
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
    const mask = this.lens.get(key) ?? 0;
    const found: string[] = [];
    let needsNorm = special;
    if (mask) {
      let end = start + firstLen;
      for (let len = 1; end < n && len < 30; ) {
        const c = text.charCodeAt(end);
        const step = c >= 0xd800 && c <= 0xdbff && end + 1 < n ? 2 : 1;
        end += step;
        len++;
        if (c >= 0x2e80 && !needsNorm && SPECIAL_RE.test(text.slice(end - step, end))) needsNorm = true;
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
  pinyinFor(word: string, ctx?: { prev?: string; next?: string; after?: string }): string[] {
    const w = this.normalizeWord(word);
    const cps = Array.from(w);
    const n = cps.length;
    if (n === 0) return [];
    const running = n >= 2 ? RUNNING_TEXT_READINGS[w] : undefined;
    if (running) return running.split(' ');
    // 不了 straight after a verb is a potential complement (走不了, 吃不了): bu is neutral.
    if (w === '不了' && ctx?.prev && isHanCodePoint(lastCodePoint(ctx.prev).codePointAt(0) ?? 0) && !/[个個]$/.test(ctx.prev)) {
      return ['bu5', 'liao3'];
    }
    // 那裏肯聽, 那裏敢: "how could (he)" is nǎ li; 那裏 elsewhere is nà li "there".
    if ((w === '那裏' || w === '那里' || w === '那裡') && ctx?.next && '肯敢能會会曉晓知曾容顧顾'.includes(firstCodePointOf(ctx.next))) return ['na3', 'li5'];
    // 兄弟，我前日…: a man addressing his friend, or 我兄弟 "my younger brother", is xiōng di; 兄弟二人 (brothers) stays xiōngdì.
    if (w === '兄弟' && ctx && !/^[\p{Script=Han}]/u.test(ctx.next ?? '。') && (!ctx.prev || !isHanCodePoint(lastCodePoint(ctx.prev).codePointAt(0) ?? 0) || '我你他咱'.includes(lastCodePoint(ctx.prev)))) return ['xiong1', 'di5'];
    // 十餘騎馬 (a dozen horsemen, jì) after a number: the word 騎馬 "to ride a horse" is not meant.
    if ((w === '騎馬' || w === '骑马') && ctx?.prev && '一二兩两三四五六七八九十數数餘余'.includes(lastCodePoint(ctx.prev)) && !(ctx.next && isHanCodePoint(firstCodePointOf(ctx.next).codePointAt(0) ?? 0) && '來来去上下'.includes(firstCodePointOf(ctx.next)))) return ['ji4', 'ma3'];
    // 勒住馬: rein in the horse (lè zhù), not the lēi zhù "to strangle, to tie tight" of 勒住.
    if (w === '勒住' && ctx?.next && '馬马韁缰繩绳'.includes(firstCodePointOf(ctx.next))) return ['le4', 'zhu4'];
    // 正行間, 方行間: "while walking" (xíng jiān), not the "between the lines" of 行間.
    if ((w === '行間' || w === '行间') && ctx?.prev && '正方在忽只'.includes(lastCodePoint(ctx.prev))) return ['xing2', 'jian1'];
    // 重重圍住, 重重疊疊 (layer upon layer, chóng chóng); 重重賞 重重責罰 (heavily) stay zhòng zhòng.
    if ((w === '重重') && ctx?.next && '圍围疊叠複复層层山嶂障門门谷關关'.includes(firstCodePointOf(ctx.next))) return ['chong2', 'chong2'];
    // 士大夫 卿大夫 中大夫: an official of the old courts (dàfū), not the doctor 大夫 (dàifu).
    if (w === '大夫' && ctx?.prev && '卿士中上下諫谏議议光祿禄太御諸诸'.includes(lastCodePoint(ctx.prev))) return ['da4', 'fu1'];
    if (n >= 2) {
      const hit = this.wordReading(w, cps);
      if (hit) {
        // Verb + 不 + complement (受不了, 说不定): CC-CEDICT often writes bu4, but the 不 is neutral.
        if (n === 3 && cps[1] === '不' && w !== '要不然') hit[1] = 'bu5';
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
      const ruled = polyphoneReading({
        ch: key,
        orig: cps[i],
        prevTok: prevS,
        nextTok: nextS,
        prevChar: lastCodePoint(prevS),
        nextChar: firstCodePointOf(nextS),
        afterChar: i < n - 1 ? '' : firstCodePointOf(this.t2s.convert(ctx?.after ?? '')),
        nextKnown: i < n - 1 || ctx?.next !== undefined,
      });
      out[i] = ruled ?? this.defaultSyllable(cps[i]);
    }
    // A verb + 不 + complement that the dictionary lacks (走不动, 看不到): the 不 is neutral.
    if (n === 3 && (cps[1] === '不') && isHanCodePoint(cps[0].codePointAt(0)!)) out[1] = 'bu5';
    return out;
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
  // 恁 is nèn "such" in the novels (CEDICT lists the thinking rèn first): 恁般 恁地 恁的.
  恁般: 'nen4 ban1', 恁地: 'nen4 di4', 恁的: 'nen4 de5',
  拚命: 'pin1 ming4', 拼命: 'pin1 ming4', 拚死: 'pin1 si3', 拼死: 'pin1 si3',
  // 累卵 is lěi luǎn (eggs piled up), not the léi of 累赘.
  累卵: 'lei3 luan3',
  // Chagatai: Cháhétái (CEDICT writes the Taiwan reading with gě).
  察合台: 'cha2 he2 tai2', 察合臺: 'cha2 he2 tai2',
  // Layer upon layer, built by the reduplication rule from 重叠 (no dictionary row of its own).
  重重叠叠: 'chong2 chong2 die2 die2', 重重疊疊: 'chong2 chong2 die2 die2',
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
