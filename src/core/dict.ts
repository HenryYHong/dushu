// The dictionary: CC-CEDICT words, Unihan characters, segmentation vocabulary, HSK, script conversion.
// Contract: ARCHITECTURE.md §3 and §4.1.
import type { CharInfo, DataMeta, DictEntry, Dictionary, HskInfo, RadicalInfo } from '../types';
import { ConvTable } from './convert';
import { hanBlockName } from './blocks';
import { baseOf, markedToNumbered, normalizePinyinField, numberedToMarked } from './pinyin';
import { WORD_READINGS, firstCodePointOf, lastCodePoint, polyphoneReading } from './polyphone';
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
async function fetchDataText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzipToText(bytes) : new TextDecoder().decode(bytes);
  if (/^\s*<(!doctype|html)/i.test(text.slice(0, 200))) throw new Error(`${url}: not a data file`);
  return text;
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
  const load = opts?.fetchText ?? ((name: string) => fetchDataText(base + name));
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
  if (/^(Taiwan pr\.|also pr\.|\(Tw\) pr\.|pr\. )/i.test(d0)) p += 2.5;
  if (e.defs.length > 0 && e.defs.every((d) => /^surname /i.test(d))) p += 1.5;
  if (/^[A-Z]/.test(e.pinyin)) p += 0.4; // proper noun: lose to a common-noun reading of the same word
  return p;
}

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
    this.meta.counts.wordTotal = this.wordTotal;
    this.meta.counts.charsLoaded = this.charLines.size;
    this.meta.counts.extraLoaded = this.extraLines.size;
    this.meta.counts.wordsExtraLoaded = this.wordsExtraLoaded;
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
    const info = this.hskMap.get(this.normalizeWord(word));
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

  /** Default numbered reading of one character, "" if none is known. */
  private defaultSyllable(ch: string): string {
    const cached = this.defaultCache.get(ch);
    if (cached !== undefined) return cached;
    const r = this.computeDefault(ch);
    this.defaultCache.set(ch, r);
    return r;
  }

  private computeDefault(ch: string): string {
    const target = this.normalizeCp(ch);
    const cp = target.codePointAt(0)!;
    const unihan = this.unihanReadings(cp).map(markedToNumbered);
    const own = (this.entries.get(target) ?? []).filter((e) => e.simp === target || e.trad === target);
    const ranked = own
      .map((e, i) => ({ e, i, p: entryPenalty(e) }))
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .map((x) => x.e.pinyin.toLowerCase())
      .filter((p) => !p.includes(' '));
    const good = own.filter((e) => entryPenalty(e) < 2).map((e) => e.pinyin.toLowerCase()).filter((p) => !p.includes(' '));
    for (const u of unihan) {
      const b = baseOf(u);
      for (const pool of [good, ranked]) {
        const hit = pool.find((c) => c === u) ?? pool.find((c) => baseOf(c) === b);
        if (hit) return hit;
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
      const r = this.defaultSyllable(v);
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
    return cand ? cand.syllables.slice() : null;
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
  pinyinFor(word: string, ctx?: { prev?: string; next?: string }): string[] {
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
        prevTok: prevS,
        nextTok: nextS,
        prevChar: lastCodePoint(prevS),
        nextChar: firstCodePointOf(nextS),
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
