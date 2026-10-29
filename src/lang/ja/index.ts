// The Japanese engine: IPADIC morphemes (ipadic.ts) grouped into learner words (words.ts), keyed and defined by JMdict,
// with furigana (ruby.ts) and KANJIDIC2 for the kanji. Contract: src/lang/types.ts.
import type { RubyPart, Token } from '../../types';
import type { KanjiInfo, LangEngine, LangModule, Sense, WordEntry, WordLookup } from '../types';
import { Jmdict, Kanjidic, fetchBytes, gunzip, headOf, yieldToEventLoop, type Entry, type Form } from './data';
import { deinflect, posFits } from './deinflect';
import { describeForms } from './forms';
import { IPADIC_FILES, Ipadic, type IpadicFiles } from './ipadic';
import { foldReading, hasKanji, isAllKana, isKanaCode, isKanjiCode, shiftRow, toHiragana, toKatakana } from './kana';
import { numberParts } from './numbers';
import { alignRuby } from './ruby';
import { isPosTag, isFringeSense, posText, tagNotes } from './tags';
import { digitValue, groupWords, type Word, type WordClass } from './words';

type Meta = LangEngine['meta'];

// ------------------------------------------------------------ characters ---

type Cls = 'ja' | 'num' | 'latin' | 'space' | 'punct' | 'other';

const PUNCT_RE = /^[\p{P}\p{S}]$/u;
const SPACE_RE = /^\s$/u;
const LATIN_RE = /^\p{Script=Latin}$/u;
const MARK_RE = /^\p{M}$/u;

function charClass(cp: number): Cls {
  if (cp < 128) {
    if (cp >= 48 && cp <= 57) return 'num';
    if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) return 'latin';
    if (cp === 32 || (cp >= 9 && cp <= 13)) return 'space';
    if (cp < 32 || cp === 127) return 'other';
    return 'punct';
  }
  if (isKanaCode(cp) || isKanjiCode(cp) || cp === 0x309b || cp === 0x309c) return 'ja';
  if (cp >= 0xff10 && cp <= 0xff19) return 'num';
  const ch = String.fromCodePoint(cp);
  if (SPACE_RE.test(ch)) return 'space';
  if (/^\p{Nd}$/u.test(ch)) return 'num';
  if (LATIN_RE.test(ch)) return 'latin';
  if (PUNCT_RE.test(ch)) return 'punct';
  if (MARK_RE.test(ch)) return 'other';
  return 'other';
}

const isDigits = (s: string) => /^[0-9０-９]+$/.test(s);
/** A word of one kana letter with no ending: what IPADIC leaves when it cuts up a kana word it does not know. */
const single = (w: Word | undefined): boolean => !!w && w.text.length === 1 && isKanaCode(w.text.charCodeAt(0)) && w.morphemes.length === 1;

// -------------------------------------------------------------- ranking ---

/** IPADIC conjugation types to JMdict verb classes. */
function verbClassFits(ctype: string, pos: ReadonlySet<string>): boolean {
  if (ctype.startsWith('一段・クレル')) return pos.has('v1-s');
  if (ctype.startsWith('一段')) return pos.has('v1') || pos.has('v1-s');
  if (ctype.startsWith('カ変')) return pos.has('vk');
  if (ctype.startsWith('サ変・－ズル')) return pos.has('vz');
  if (ctype.startsWith('サ変')) return pos.has('vs-i') || pos.has('vs-s') || pos.has('vs');
  if (ctype.startsWith('五段')) {
    const row = ctype.slice(3, 4);
    const map: Record<string, string[]> = {
      カ: ['v5k', 'v5k-s'], ガ: ['v5g'], サ: ['v5s'], タ: ['v5t'], ナ: ['v5n'], バ: ['v5b'], マ: ['v5m'], ラ: ['v5r', 'v5r-i', 'v5aru'], ワ: ['v5u', 'v5u-s'],
    };
    return (map[row] ?? []).some((t) => pos.has(t));
  }
  if (ctype.startsWith('文語') || ctype.startsWith('四段') || ctype.startsWith('上二') || ctype.startsWith('下二')) return [...pos].some((t) => /^v[24]/.test(t));
  return false;
}

const VERB_TAG = /^(v1|v1-s|v5|vk|vs-i|vs-s|vz|vn|vr|v2|v4)/;

/** How well a JMdict entry's parts of speech fit the class IPADIC gave the word. */
function posScore(cls: WordClass | undefined, ctype: string, pos: ReadonlySet<string>): number {
  if (!cls) return 0;
  const any = (...t: string[]) => t.some((x) => pos.has(x));
  switch (cls) {
    case 'verb': {
      if (![...pos].some((t) => VERB_TAG.test(t))) return pos.has('vs') && ctype.startsWith('サ変') ? 30 : -40;
      return 40 + (verbClassFits(ctype, pos) ? 25 : 0);
    }
    case 'adj': return any('adj-i', 'adj-ix') ? 50 : any('aux-adj') ? 30 : -40;
    case 'adjna': return any('adj-na') ? 50 : any('n', 'adj-no', 'adj-t', 'adv') ? 15 : -30;
    case 'noun': return any('n', 'n-adv', 'n-t', 'adj-no', 'vs') ? 40 : any('adj-na', 'pn', 'n-suf', 'n-pref', 'ctr', 'num') ? 20 : any('exp') ? 0 : -30;
    case 'pronoun': return any('pn') ? 50 : any('n') ? 20 : -20;
    case 'adverb': return any('adv', 'adv-to') ? 50 : any('n-adv', 'adj-na', 'n') ? 10 : -20;
    case 'particle': return any('prt') ? 50 : any('conj', 'exp', 'suf') ? 10 : -30;
    case 'conj': return any('conj') ? 50 : any('prt', 'exp', 'adv') ? 15 : -20;
    case 'interj': return any('int') ? 50 : -10;
    case 'prenoun': return any('adj-pn') ? 50 : any('adj-f', 'pn') ? 20 : -10;
    case 'aux': return any('aux-v', 'aux', 'cop', 'aux-adj') ? 50 : any('prt', 'exp') ? 10 : -20;
    case 'prefix': return any('pref', 'n-pref') ? 50 : -10;
    case 'suffix': return any('suf', 'n-suf') ? 50 : any('ctr') ? 30 : any('n') ? 5 : -10;
    case 'counter': return any('ctr') ? 50 : any('suf', 'n-suf') ? 20 : any('n', 'num') ? 10 : -10;
    case 'number': return any('num') ? 50 : any('n') ? 15 : -10;
    default: return 0;
  }
}

interface Ranked { e: Entry; score: number; kanji: number; kana: number }

// --------------------------------------------------------------- engine ---

class JaEngine implements LangEngine {
  readonly id = 'ja' as const;
  private words = new WeakMap<Token, Word>();
  private keyCache = new Map<string, string>();
  private normCache = new Map<string, string>();
  private readingsCache = new Map<string, readonly string[]>();
  private rubyCache = new Map<string, RubyPart[]>();
  private readonly kanjiReadings = (ch: string) => this.readingsOf(ch, false);

  constructor(
    private readonly ipadic: Ipadic,
    private readonly jm: Jmdict,
    private readonly kd: Kanjidic,
    readonly meta: Meta,
  ) {}

  // ------------------------------------------------------- segmentation ---

  segment(text: string): Token[] {
    const out: Token[] = [];
    const n = text.length;
    let i = 0;
    const push = (start: number, end: number, kind: Token['kind']) => out.push({ text: text.slice(start, end), start, end, kind, inDict: false });
    while (i < n) {
      const cp = text.codePointAt(i)!;
      const len = cp > 0xffff ? 2 : 1;
      let cls = charClass(cp);
      // Digits right before Japanese go to the analyzer with it, so 3人 reads にん and 2025年 ねん.
      if (cls === 'num') {
        let j = i + len;
        while (j < n && charClass(text.codePointAt(j)!) === 'num') j++;
        if (j < n && charClass(text.codePointAt(j)!) === 'ja') cls = 'ja';
      }
      if (cls === 'ja') {
        let j = i + len;
        while (j < n) {
          const c2 = text.codePointAt(j)!;
          const k = charClass(c2);
          if (k !== 'ja' && k !== 'num') break;
          j += c2 > 0xffff ? 2 : 1;
        }
        // Trailing digits after the Japanese text are a number of their own.
        let end = j;
        while (end > i && charClass(text.charCodeAt(end - 1)) === 'num') end--;
        if (end === i) end = j;
        this.segmentRun(text, i, end, out);
        i = end;
        continue;
      }
      if (cls === 'punct') { push(i, i + len, 'punct'); i += len; continue; }
      let j = i + len;
      while (j < n) {
        const c2 = text.codePointAt(j)!;
        const k = charClass(c2);
        if (k === cls) { j += c2 > 0xffff ? 2 : 1; continue; }
        if (MARK_RE.test(String.fromCodePoint(c2)) && cls !== 'space') { j += c2 > 0xffff ? 2 : 1; continue; }
        // Joiners inside words and numbers: don't, 3.14, 1,000.
        if (cls === 'latin' && (c2 === 39 || c2 === 0x2019 || c2 === 45) && j + 1 < n && charClass(text.codePointAt(j + 1)!) === 'latin') { j++; continue; }
        if (cls === 'num' && (c2 === 46 || c2 === 44) && j + 1 < n && charClass(text.codePointAt(j + 1)!) === 'num') { j++; continue; }
        break;
      }
      push(i, j, cls);
      i = j;
    }
    return out;
  }

  private segmentRun(text: string, a: number, b: number, out: Token[]): void {
    const words = this.wordsOf(text, a, b);
    for (const w of words) {
      if (w.cls === 'symbol' || isDigits(w.text)) {
        // Symbols IPADIC met inside the text (ヽ, ゝ, 〻 standing alone) and plain digits.
        if (isDigits(w.text)) { out.push({ text: w.text, start: w.start, end: w.end, kind: 'num', inDict: false }); continue; }
        for (let k = w.start; k < w.end;) {
          const cp = text.codePointAt(k)!;
          const len = cp > 0xffff ? 2 : 1;
          const ch = text.slice(k, k + len);
          const kind = charClass(cp) === 'ja' ? 'word' : charClass(cp) === 'punct' ? 'punct' : 'other';
          const t: Token = { text: ch, start: k, end: k + len, kind, inDict: false };
          if (kind === 'word') { t.key = ch; t.lemma = ch; t.ruby = [{ text: ch }]; }
          out.push(t);
          k += len;
        }
        continue;
      }
      // A word that starts with digits (3本, 2025年): the digits are a number token, the rest the word, read the way the
      // number makes it (3本 ぼん).
      if (/^[0-9０-９]/.test(w.text)) {
        let k = 0;
        while (k < w.text.length && /[0-9０-９]/.test(w.text[k])) k++;
        out.push({ text: w.text.slice(0, k), start: w.start, end: w.start + k, kind: 'num', inDict: false });
        if (!this.afterDigits(w, k)) continue;
      }
      out.push(this.tokenOf(w));
    }
  }

  /** The words of text[a, b): IPADIC's morphemes grouped (words.ts), then the repairs that need JMdict. */
  private wordsOf(text: string, a = 0, b = text.length, depth = 0): Word[] {
    const ms = this.ipadic.analyze(text, a, b);
    return this.repair(groupWords(ms, { has: (f) => this.jm.has(f) }), text, b, depth);
  }

  /**
   * Two things IPADIC gets wrong that JMdict can put right:
   *   - A verb or adjective spelled with a kanji IPADIC does not know (掩った, 喰べたい, 遁げ): the kanji is an unknown noun and
   *     the okurigana scatter into nonsense. The kanji and the kana after it become the longest JMdict word they can inflect.
   *   - 々 standing alone after a word (黒洞々): it joins the word before it.
   */
  private repair(words: Word[], text: string, b: number, depth: number): Word[] {
    const out: Word[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      // 御 before a verb or adjective is お (御飲みになる, 御美しい), and so is 御 in the honorific 御…になる, where IPADIC takes
      // the verb stem for a noun (御歩きになる) and reads it ご.
      const next = words[i + 1];
      const honorific = next?.cls === 'noun' && words[i + 2]?.text === 'に' && /^な[らりるれろっ]/.test(words[i + 3]?.text ?? '');
      if (w.text === '御' && w.reading === 'ご' && (next?.cls === 'verb' || next?.cls === 'adj' || honorific)) {
        w.reading = w.lemmaReading = 'お';
        w.pieces = [{ text: w.text, reading: 'お' }];
      }
      if (w.text === '々' && out.length && hasKanji(out[out.length - 1].text)) {
        const prev = out[out.length - 1];
        const ruby = prev.reading ? alignRuby(prev.text, prev.reading, this.kanjiReadings) : [];
        const lastRt = ruby.length && ruby[ruby.length - 1].rt && [...ruby[ruby.length - 1].text].length === 1 ? ruby[ruby.length - 1].rt! : '';
        prev.text += w.text;
        prev.end = w.end;
        prev.morphemes = [...prev.morphemes, ...w.morphemes];
        prev.lemma = prev.text;
        prev.reading = prev.reading && lastRt ? prev.reading + lastRt : '';
        prev.lemmaReading = prev.reading;
        prev.pieces = [{ text: prev.text, reading: prev.reading }];
        prev.forms = [];
        prev.compound = true;
        continue;
      }
      // IPADIC cuts a kana word it does not have into single letters (ひ|ら|が|な); letters JMdict knows as one word join up.
      if (single(w) && single(words[i + 1])) {
        let text = w.text;
        let best = -1;
        let ranked: Ranked[] = [];
        for (let j = i + 1; j < words.length && j < i + 10 && single(words[j]); j++) {
          text += words[j].text;
          if (text.length < 3) continue;
          const r = this.rank(text, undefined, undefined, '').filter((x) => x.kana >= 0 && !/[SR]/.test(x.e.kana[x.kana].flags));
          if (r.length) { best = j; ranked = r; }
        }
        // Only where IPADIC's cut looks broken: a run of particles (よね, かな) is left alone.
        const broken = (p: Word) => p.cls !== 'particle' && p.cls !== 'aux';
        if (best > 0 && broken(w) && words.slice(i, best + 1).filter(broken).length >= 2) {
          const parts = words.slice(i, best + 1);
          const joined = parts.map((p) => p.text).join('');
          const pos = ranked[0].e.pos;
          const cls: WordClass = [...pos].some((t) => VERB_TAG.test(t)) ? 'verb' : pos.has('adj-i') ? 'adj' : pos.has('adv') ? 'adverb' : pos.has('int') ? 'interj' : 'noun';
          const reading = toHiragana(joined);
          out.push({
            start: w.start, end: parts[parts.length - 1].end, text: joined, morphemes: parts.flatMap((p) => p.morphemes), lemma: joined,
            reading, lemmaReading: reading, pieces: [{ text: joined, reading }], forms: [], cls, ctype: '', unknown: true,
          });
          i = best;
          continue;
        }
      }
      if (w.unknown && w.morphemes.length === 1 && hasKanji(w.text) && [...w.text].every((ch) => isKanjiCode(ch.codePointAt(0)!))) {
        const fixed = this.okurigana(words, i, text, b);
        if (fixed) {
          out.push(fixed.word);
          // The word ended inside the kana IPADIC had cut otherwise (斯|ういう → 斯う + いう): analyze the rest again.
          if (fixed.word.end !== words[fixed.last].end && depth < 4) return [...out, ...this.wordsOf(text, fixed.word.end, b, depth + 1)];
          i = fixed.last;
          continue;
        }
      }
      out.push(w);
    }
    return out;
  }

  /** words[i] is unknown kanji: the longest span of it and the kana words after it that JMdict knows, inflected or not. */
  private okurigana(words: Word[], i: number, src: string, b: number): { word: Word; last: number } | null {
    const w = words[i];
    // Every end from one kana after the kanji to ten, as long as the kana run lasts; j is the word each end falls in.
    const spans: { j: number; text: string }[] = [];
    let j = i + 1;
    for (let end = w.end + 1; end <= Math.min(b, w.end + 10); end++) {
      if (!isKanaCode(src.charCodeAt(end - 1))) break;
      while (j < words.length && words[j].end < end) j++;
      if (j >= words.length) break;
      spans.push({ j, text: src.slice(w.start, end) });
    }
    for (let k = spans.length - 1; k >= 0; k--) {
      const { j, text: span } = spans[k];
      let lemma = '';
      let forms: string[] = [];
      let r: Ranked | undefined;
      const exact = this.rank(span, undefined, undefined, '');
      if (exact.length && exact[0].kanji >= 0) { lemma = span; r = exact[0]; }
      else {
        const d = this.deinflected(span).find((x) => x.term.startsWith(w.text) && x.r.kanji >= 0);
        if (d) { lemma = d.term; forms = d.forms; r = d.r; }
      }
      if (!r) continue;
      const kana = r.e.kana.find((f) => !f.only || f.only.includes(r!.kanji));
      const lemmaReading = kana ? toHiragana(kana.text) : '';
      const lemmaTail = lemma.slice(w.text.length);
      let reading = '';
      if (lemmaReading && lemmaReading.endsWith(toHiragana(lemmaTail))) reading = lemmaReading.slice(0, lemmaReading.length - lemmaTail.length) + toHiragana(span.slice(w.text.length));
      const parts = words.slice(i, j + 1);
      const end = w.start + span.length;
      const pos = r.e.pos;
      const cls: WordClass = [...pos].some((t) => VERB_TAG.test(t)) ? 'verb' : pos.has('adj-i') ? 'adj' : pos.has('adv') ? 'adverb' : 'noun';
      const word: Word = {
        start: w.start, end, text: span, morphemes: parts.flatMap((p) => p.morphemes).filter((m) => m.start < end),
        lemma, reading, lemmaReading, pieces: [{ text: span, reading }], forms, cls, ctype: '', unknown: true,
      };
      return { word, last: j };
    }
    return null;
  }

  /** Cuts the first k characters (digits) off a number-and-counter word, keeping the counter's share of the reading. */
  private afterDigits(w: Word, k: number): boolean {
    const text = w.text.slice(k);
    if (!text) return false;
    const ms = w.morphemes.filter((m) => !isDigits(m.surface));
    const plain = ms.map((m) => (m.reading ? toHiragana(m.reading) : '')).join('');
    const value = digitValue(w.text.slice(0, k));
    let reading = plain;
    if (value !== null && w.reading) {
      const parts = numberParts(value);
      const num = parts.join('');
      reading = w.reading.startsWith(num) ? w.reading.slice(num.length) : stripChangedNumber(w.reading, parts) ?? plain;
    }
    w.text = text;
    w.start += k;
    w.morphemes = ms;
    w.reading = reading;
    w.pieces = [{ text, reading }];
    w.lemma = ms.length === 1 && ms[0].base !== '*' ? ms[0].base : text;
    w.lemmaReading = plain;
    return true;
  }

  private tokenOf(w: Word): Token {
    this.resolveReading(w);
    this.resolvePotential(w);
    const key = this.keyFor(w);
    const ruby = this.rubyOf(w);
    const t: Token = { text: w.text, start: w.start, end: w.end, kind: 'word', inDict: key !== w.lemma || this.jm.has(w.lemma), key, lemma: w.lemma, ruby };
    if (w.reading) t.reading = w.reading;
    if (w.name) t.name = true;
    this.words.set(t, w);
    return t;
  }

  /** Readings IPADIC could not give (unknown words) or got wrong in compounds (本棚 ほんたな) come from JMdict. */
  private resolveReading(w: Word): void {
    if (!hasKanji(w.text)) return;
    if (w.reading && !w.compound) {
      this.preferCommonReading(w);
      return;
    }
    const ranked = this.rank(w.text, undefined, w.compound ? 'noun' : undefined, '');
    if (!ranked.length) return;
    if (w.reading && ranked.some((r) => r.e.kana.some((k) => foldReading(k.text) === foldReading(w.reading)))) return;
    const best = ranked[0];
    const kana = best.kana >= 0 ? best.e.kana[best.kana] : best.e.kana.find((k) => !k.only || k.only.includes(best.kanji));
    if (!kana) return;
    w.reading = toHiragana(kana.text);
    w.lemmaReading = w.reading;
    w.pieces = [{ text: w.text, reading: w.reading }];
  }

  /**
   * IPADIC picks among the readings of a noun by cost alone, so a rare reading can win everywhere: 獣 しし, 白熊 はぐま. When JMdict
   * marks some reading of the word common and IPADIC's is not among them, the common one is used (家 いえ/うち, both common, stay).
   */
  private preferCommonReading(w: Word): void {
    if (w.morphemes.length !== 1 || w.name || w.forms.length || (w.cls !== 'noun' && w.cls !== 'adjna')) return;
    const m = w.morphemes[0];
    if (!m.known || m.surface !== w.text) return;
    const mine = foldReading(w.reading);
    const common: string[] = [];
    for (const r of this.rank(w.text, undefined, w.cls, '')) {
      if (r.kanji < 0) continue;
      const kf = r.e.kanji[r.kanji];
      if (!kf.common && /[SROIA]/.test(kf.flags)) continue;
      for (const k of r.e.kana) {
        if (!k.common || (k.only && !k.only.includes(r.kanji))) continue;
        const f = foldReading(k.text);
        if (f === mine) return;
        if (!common.includes(f)) common.push(toHiragana(k.text));
      }
    }
    if (!common.length) return;
    w.reading = common[0];
    w.lemmaReading = w.reading;
    w.pieces = [{ text: w.text, reading: w.reading }];
  }

  /**
   * 読める is the potential of 読む to a learner. IPADIC files potential verbs as verbs of their own; when JMdict has no entry for
   * one, or its entry only says "to be able to …", the word becomes the godan verb with "potential" in front of its forms.
   */
  private resolvePotential(w: Word): void {
    if (w.cls !== 'verb' || !w.ctype.startsWith('一段') || w.lemma.length < 2 || !w.lemma.endsWith('る')) return;
    const e = w.lemma[w.lemma.length - 2];
    if (!'えけげせてねべめれ'.includes(e)) return;
    const u = shiftRow(e, 'う');
    if (!u) return;
    const base = w.lemma.slice(0, -2) + u;
    const godan = this.rank(base, undefined, 'verb', '').filter((r) => [...r.e.pos].some((t) => t.startsWith('v5')));
    if (!godan.length || godan[0].score < 0) return;
    const own = this.rank(w.lemma, w.lemmaReading || undefined, 'verb', w.ctype);
    if (own.length && own[0].score > 0) {
      const first = own[0].e.senses[0]?.glosses[0] ?? '';
      if (!/^(to be able to|can |to be possible to)/.test(first)) return;
    }
    w.lemma = base;
    if (w.lemmaReading) w.lemmaReading = w.lemmaReading.slice(0, -2) + u;
    w.ctype = '五段';
    w.forms = ['potential', ...w.forms];
  }

  private rubyOf(w: Word): RubyPart[] {
    const out: RubyPart[] = [];
    const kr = w.name ? (ch: string) => this.readingsOf(ch, true) : this.kanjiReadings;
    for (const p of w.pieces) {
      const k = p.text + '\u0000' + p.reading + (w.name ? '\u0001' : '');
      let parts = this.rubyCache.get(k);
      if (!parts) {
        parts = p.reading ? alignRuby(p.text, p.reading, kr) : [{ text: p.text }];
        if (this.rubyCache.size > 20000) this.rubyCache.clear();
        this.rubyCache.set(k, parts);
      }
      for (const part of parts) {
        const last = out[out.length - 1];
        if (!part.rt && last && !last.rt) last.text += part.text;
        else out.push({ ...part });
      }
    }
    return out;
  }

  /** A kanji's readings in hiragana for furigana: on, kun without okurigana, and for names the nanori too. */
  private readingsOf(ch: string, names: boolean): readonly string[] {
    const k = ch + (names ? '\u0001' : '');
    let r = this.readingsCache.get(k);
    if (r) return r;
    const row = this.kd.get(ch);
    const set = new Set<string>();
    if (row) {
      for (const on of row.on) set.add(toHiragana(on.replace(/-/g, '')));
      for (const kun of row.kun) { const s = kun.replace(/-/g, ''); set.add(s.split('.')[0]); }
      if (names) for (const n of row.nanori) set.add(n);
    }
    set.delete('');
    r = [...set];
    this.readingsCache.set(k, r);
    return r;
  }

  // ------------------------------------------------------------ ranking ---

  /** JMdict entries with `form` (kanji or kana), best first, for a word read `reading` that IPADIC classed `cls`. */
  private rank(form: string, reading: string | undefined, cls: WordClass | undefined, ctype: string): Ranked[] {
    let ids = this.jm.ids(form);
    if (!ids.length && isAllKana(form)) {
      const alt = toHiragana(form) === form ? toKatakana(form) : toHiragana(form);
      ids = this.jm.ids(alt);
      if (ids.length) form = alt;
    }
    const fr = reading ? foldReading(reading) : '';
    const out: Ranked[] = [];
    for (const id of ids) {
      const e = this.jm.entry(id);
      const kanji = e.kanji.findIndex((f) => f.text === form);
      let kana = e.kana.findIndex((f) => f.text === form);
      let score = 0;
      if (fr) {
        const ri = e.kana.findIndex((f) => foldReading(f.text) === fr && (kanji < 0 || !f.only || f.only.includes(kanji)));
        if (ri >= 0) { score += 100; if (kana < 0) kana = ri; } else score -= 60;
      }
      if (kanji >= 0) {
        const f = e.kanji[kanji];
        if (f.common) score += 15;
        if (f.flags.includes('S')) score -= 20;
        else if (/[ROI]/.test(f.flags)) score -= 10;
        if (e.uk) score -= 5;
      } else if (kana >= 0 && !fr) {
        // The word was written in kana: words usually written in kana fit best.
        const f = e.kana[kana];
        if (e.uk || !e.kanji.length) score += 30; else score -= 10;
        if (f.common) score += 10;
        if (/[SRO]/.test(f.flags)) score -= 10;
      } else if (kanji < 0 && fr) {
        if (e.uk || !e.kanji.length) score += 30; else score -= 10;
      }
      score += posScore(cls, ctype, e.pos);
      if (e.common) score += 20;
      if (e.level) score += 12;
      if (e.senses.every((s) => isFringeSense(s.tags))) score -= 25;
      score += Math.min(6, e.senses.length);
      out.push({ e, score, kanji, kana });
    }
    out.sort((x, y) => y.score - x.score || x.e.id - y.e.id);
    return out;
  }

  private keyFor(w: Word): string {
    const k = `${w.lemma}\u0000${w.lemmaReading}\u0000${w.cls}\u0000${w.ctype}`;
    let key = this.keyCache.get(k);
    if (key !== undefined) return key;
    // A word JMdict lacks keeps its lemma, as normalize would give it, so a key survives a round trip.
    key = w.lemma;
    const ranked = this.rankWord(w);
    if (ranked.length && ranked[0].score > 0) key = headOf(ranked[0].e);
    else {
      // Kept for the moment first: normalize may cut the word alone and come back here for the same lemma.
      this.keyCache.set(k, key);
      key = this.normalize(key);
    }
    if (this.keyCache.size > 50000) this.keyCache.clear();
    this.keyCache.set(k, key);
    return key;
  }

  /** Entries for a word on the page: its lemma first; a する-verb with no entry of its own falls back to its noun. */
  private rankWord(w: Word): Ranked[] {
    // IPADIC's costs read a kana いる as the godan verb (要る "to be needed", 入る) more often than the ichidan 居る "to be";
    // in running text a kana いる is nearly always 居る (要る is written with its kanji when it is meant).
    const ctype = w.lemma === 'いる' && w.ctype.startsWith('五段') ? '一段' : w.ctype;
    let ranked = this.rank(w.lemma, w.lemmaReading || undefined, w.cls, ctype);
    if ((!ranked.length || ranked[0].score <= 0) && w.ctype.startsWith('サ変') && w.lemma.endsWith('する') && w.lemma.length > 2) {
      const noun = w.lemma.slice(0, -2);
      const nr = this.rank(noun, w.lemmaReading.endsWith('する') ? w.lemmaReading.slice(0, -2) : undefined, 'noun', '');
      if (nr.length) ranked = nr;
    }
    if ((!ranked.length || ranked[0].score <= 0) && w.text !== w.lemma) {
      const sr = this.rank(w.text, w.reading || undefined, w.cls, w.ctype);
      if (sr.length && (!ranked.length || sr[0].score > ranked[0].score)) ranked = sr;
    }
    return ranked;
  }

  // ------------------------------------------------------------- lookup ---

  lookup(surface: string, ctx?: { token?: Token; sentence?: string }): WordLookup {
    const token = ctx?.token;
    let w = token ? this.words.get(token) : undefined;
    if (!w && token && token.kind === 'word') w = this.wordAlone(token.text, token);
    if (w) return this.lookupWord(surface, w, token);
    return this.lookupSpan(surface);
  }

  /** The word for a token analysed again on its own (a token from another session, or one rebuilt by the UI). */
  private wordAlone(text: string, token?: Token): Word | undefined {
    const ws = this.wordsOf(text);
    if (ws.length !== 1) return undefined;
    const w = ws[0];
    this.resolveReading(w);
    this.resolvePotential(w);
    if (token?.reading && token.reading !== w.reading) {
      // Trust the reading the token was shown with; it came from the sentence.
      w.reading = token.reading;
      if (token.lemma === token.text) w.lemmaReading = token.reading;
    }
    return w;
  }

  private lookupWord(surface: string, w: Word, token?: Token): WordLookup {
    const ranked = this.rankWord(w);
    const seen = new Set<number>();
    const entries: WordEntry[] = [];
    // After the best entry: other readings of the same kanji spelling (IPADIC may have picked the wrong one), and words that
    // sound the same only when they come close (a kana particle は is not 羽).
    const top = ranked[0]?.score ?? 0;
    const good = ranked.filter((r, i) => i === 0 || (r.score > 0 && (r.kanji >= 0 || r.score >= top - 60)));
    for (const r of (good.length ? good : ranked).slice(0, 8)) {
      if (seen.has(r.e.id)) continue;
      seen.add(r.e.id);
      entries.push(this.toEntry(r, w.lemma, w));
    }
    // The page's own spelling may be a word of its own too (読める beside 読む): after the lemma's entries.
    if (w.text !== w.lemma && hasKanji(w.text) === hasKanji(w.lemma)) {
      for (const r of this.rank(w.text, w.reading || undefined, undefined, '').filter((x) => x.score > 0).slice(0, 2)) {
        if (seen.has(r.e.id)) continue;
        seen.add(r.e.id);
        entries.push(this.toEntry(r, w.text));
      }
    }
    const key = token?.key ?? this.keyFor(w);
    const res: WordLookup = { surface, key, entries };
    // 勉強した is defined under 勉強: say that the する makes it a verb.
    const viaNoun = w.lemma.endsWith('する') && w.ctype.startsWith('サ変') && entries.length > 0 && !entries[0].head.endsWith('する') && w.lemma !== 'する';
    const form = describeForms(viaNoun ? ['verb with する', ...w.forms] : w.forms);
    if (form) res.form = form;
    const chars = this.charsOf(surface + (entries[0]?.head ?? ''));
    if (chars.length) res.chars = chars;
    if (w.name && !good.length) {
      res.name = true;
      res.entries = [{ head: w.text, reading: w.reading || undefined, senses: [{ glosses: [NAME_GLOSS[w.name]] }], source: 'name' }, ...entries];
    }
    return res;
  }

  /** A selection that is not one token: an exact JMdict headword first, then deinflection, then the analyzer. */
  private lookupSpan(surface: string): WordLookup {
    const text = surface.trim();
    const entries: WordEntry[] = [];
    const seen = new Set<number>();
    let form: string | undefined;
    const { exact, de } = this.spanCandidates(text);
    let first: Entry | undefined;
    for (const r of exact.slice(0, 6)) { seen.add(r.e.id); entries.push(this.toEntry(r, text)); first ??= r.e; }
    for (const d of de) {
      if (seen.has(d.r.e.id)) continue;
      seen.add(d.r.e.id);
      if (!entries.length) form = describeForms(d.forms);
      entries.push(this.toEntry(d.r, d.term));
      first ??= d.r.e;
      if (entries.length >= 8) break;
    }
    let key = first ? headOf(first) : text;
    if (!entries.length) {
      const w = this.wordAlone(text);
      if (w) {
        const res = this.lookupWord(surface, w);
        if (res.entries.length) return res;
      }
      key = text;
    }
    const res: WordLookup = { surface, key, entries };
    if (form) res.form = form;
    const chars = this.charsOf(text + (entries[0]?.head ?? ''));
    if (chars.length) res.chars = chars;
    return res;
  }

  /**
   * A word with no context: its exact JMdict entries first, then the dictionary forms it can be an inflection of. When no exact
   * entry is common but an inflection of a common word fits (来た: the rare interjection, or the past of 来る), the
   * inflection goes first.
   */
  private spanCandidates(text: string): { exact: Ranked[]; de: { term: string; forms: string[]; r: Ranked }[] } {
    let exact = this.rank(text, undefined, undefined, '');
    let de = this.deinflected(text);
    if (exact.length && !exact.some((r) => r.e.common) && de.some((d) => d.r.e.common)) {
      de = [...de.filter((d) => d.r.e.common), ...de.filter((d) => !d.r.e.common)];
      // The exact entries follow the common inflections.
      const later = exact;
      exact = [];
      de.push(...later.map((r) => ({ term: text, forms: [], r })));
    }
    return { exact, de };
  }

  /** Dictionary forms `text` can be an inflection of, each with the entries that fit, best first. */
  private deinflected(text: string): { term: string; forms: string[]; r: Ranked }[] {
    const out: { term: string; forms: string[]; r: Ranked; s: number }[] = [];
    for (const d of deinflect(text)) {
      if (!d.forms.length) continue;
      for (const r of this.rank(d.term, undefined, undefined, '')) {
        if (!posFits(d.type, r.e.pos)) continue;
        // Fewer endings peeled is the likelier reading (きた: 来る past before 着る past only by commonness).
        out.push({ term: d.term, forms: d.forms, r, s: r.score - d.forms.length * 3 + d.term.length * 2 });
      }
    }
    out.sort((a, b) => b.s - a.s);
    return out;
  }

  private toEntry(r: Ranked, lemma: string, w?: Word): WordEntry {
    const e = r.e;
    const shown = (f: Form) => !f.flags.includes('S');
    const key = headOf(e);
    // The head is the spelling on the page when it is one of the entry's own; a kana spelling of a kanji word shows the kanji.
    let head = key;
    if (r.kanji >= 0 && shown(e.kanji[r.kanji])) head = e.kanji[r.kanji].text;
    else if (isAllKana(lemma) && e.kana.some((f) => f.text === lemma) && e.uk) head = lemma;
    const kanaForm = r.kana >= 0 ? e.kana[r.kana] : e.kana.find((f) => shown(f) && (r.kanji < 0 || !f.only || f.only.includes(r.kanji))) ?? e.kana[0];
    const reading = kanaForm?.text;
    const alts: string[] = [];
    for (const f of [...e.kanji, ...e.kana]) {
      if (!shown(f) || f.text === head || f.text === reading || alts.includes(f.text)) continue;
      alts.push(f.text);
      if (alts.length >= 6) break;
    }
    const senses: Sense[] = [];
    let lastPos: string | undefined;
    // A particle's senses in the order its use on the page makes likely (と after a noun list is "and", before a verb "if").
    const want = w?.cls === 'particle' ? particleSense(w.text, w.morphemes[0]?.pos1 ?? '', w.morphemes[0]?.pos2 ?? '') : undefined;
    const order = want ? [...e.senses.filter((x) => want.test(x.glosses.join('; ') + ' ' + x.notes.join('; '))), ...e.senses.filter((x) => !want.test(x.glosses.join('; ') + ' ' + x.notes.join('; ')))] : e.senses;
    for (const s of order) {
      if (s.kanji && r.kanji >= 0 && !s.kanji.includes(r.kanji)) continue;
      if (s.kana && r.kana >= 0 && !s.kana.includes(r.kana)) continue;
      const pos = posText(s.tags.filter(isPosTag));
      const notes = [...tagNotes(s.tags), ...s.notes];
      const sense: Sense = { glosses: s.glosses.length ? s.glosses : ['(no gloss)'] };
      // Show the part of speech when it changes from the sense before, as printed dictionaries do.
      if (pos && pos !== lastPos) sense.pos = pos;
      lastPos = pos ?? lastPos;
      if (notes.length) sense.notes = notes;
      senses.push(sense);
    }
    if (!senses.length) senses.push({ glosses: e.senses[0]?.glosses ?? ['(no gloss)'] });
    const out: WordEntry = { head, senses, source: 'JMdict' };
    if (reading && reading !== head) out.reading = reading;
    else if (reading && !hasKanji(head)) out.reading = reading;
    if (alts.length) out.alts = alts;
    if (e.level) out.level = e.level;
    if (e.common) out.common = true;
    return out;
  }

  private charsOf(s: string): KanjiInfo[] {
    const out: KanjiInfo[] = [];
    const seen = new Set<string>();
    for (const ch of s) {
      if (seen.has(ch) || !isKanjiCode(ch.codePointAt(0)!)) continue;
      seen.add(ch);
      const row = this.kd.get(ch);
      if (!row) continue;
      const info: KanjiInfo = { char: ch, meanings: row.meanings, on: row.on, kun: row.kun };
      if (row.strokes) info.strokes = row.strokes;
      if (row.grade) info.grade = row.grade;
      if (row.jlpt) info.jlpt = row.jlpt;
      out.push(info);
    }
    return out;
  }

  // ---------------------------------------------------------- the rest ---

  normalize(word: string): string {
    const text = word.trim();
    if (!text) return '';
    const cached = this.normCache.get(text);
    if (cached !== undefined) return cached;
    let key = text;
    const { exact, de } = this.spanCandidates(text);
    if (exact.length) {
      key = exact.some((r) => headOf(r.e) === text) ? text : headOf(exact[0].e);
    } else {
      if (de.length) key = de.some((d) => !d.forms.length && headOf(d.r.e) === text) ? text : headOf(de[0].r.e);
      else {
        const w = this.wordAlone(text);
        if (w) key = this.keyFor(w);
      }
    }
    if (this.normCache.size > 20000) this.normCache.clear();
    this.normCache.set(text, key);
    return key;
  }

  level(key: string): number | undefined {
    let best: number | undefined;
    for (const id of this.jm.ids(key)) {
      const e = this.jm.entry(id);
      if (!e.level || headOf(e) !== key) continue;
      if (best === undefined || e.level < best) best = e.level;
    }
    return best;
  }

  levelWords(max: number): string[] {
    const out = new Set<string>();
    for (let lv = 1; lv <= Math.min(5, max); lv++) for (const id of this.jm.levelIdsOf(lv)) out.add(headOf(this.jm.entry(id)));
    return [...out];
  }

  hint(token: Token): string | undefined {
    if (token.kind !== 'word') return undefined;
    let w = this.words.get(token);
    if (!w) w = this.wordAlone(token.text, token);
    if (!w) return undefined;
    const ranked = this.rankWord(w);
    if (!ranked.length || ranked[0].score <= 0) return undefined;
    const e = this.toEntry(ranked[0], w.lemma, w);
    return shortGloss(e.senses[0]?.glosses[0]);
  }
}

/** Which sense of a particle IPADIC's subclass points to, as a pattern over the sense's glosses and notes. */
const PARTICLE_SENSES: Record<string, [string, RegExp][]> = {
  と: [['並立助詞', /^and\b/], ['格助詞,引用', /quot/], ['格助詞', /^with\b/], ['接続助詞', /^(if|when)\b/]],
  が: [['格助詞', /subject/], ['接続助詞', /^but\b/]],
  から: [['格助詞', /^from\b/], ['接続助詞', /^because\b/]],
  の: [['連体化', /possessive/], ['終助詞', /question/]],
  し: [['接続助詞', /^and\b/]],
};

function particleSense(text: string, pos1: string, pos2: string): RegExp | undefined {
  for (const [when, re] of PARTICLE_SENSES[text] ?? []) {
    const [p1, p2] = when.split(',');
    if (p1 === pos1 && (!p2 || p2 === pos2)) return re;
  }
  return undefined;
}

const NAME_GLOSS: Record<NonNullable<Word['name']>, string> = {
  surname: 'surname', given: 'given name', person: "person's name", place: 'place name', org: 'organization', proper: 'proper noun',
};

/** One short gloss: no parentheses, the first of a list, a few words at most ("to eat", "house"). */
export function shortGloss(g: string | undefined): string | undefined {
  if (!g) return undefined;
  let s = g;
  for (let k = 0; k < 3 && /\([^()]*\)/.test(s); k++) s = s.replace(/\s*\([^()]*\)\s*/g, ' ');
  s = s.replace(/^(lit|fig)\. /, '').split(/[;,]/)[0].replace(/\s+/g, ' ').trim();
  const words = s.split(' ');
  if (words.length > 4) s = words.slice(0, words[0] === 'to' ? 4 : 3).join(' ');
  return s || undefined;
}

// -------------------------------------------------------------- numbers ---

/** 一本 read いっぽん with the number token separate: the counter's share is what follows the (changed) number. */
function stripChangedNumber(full: string, parts: string[]): string | null {
  const num = parts.join('');
  const changed = num.slice(0, -1) + 'っ';
  if (full.startsWith(changed)) return full.slice(changed.length);
  const head = parts.slice(0, -1).join('');
  if (full.startsWith(head) && parts.length) {
    const last = parts[parts.length - 1];
    if (full.startsWith(head + last.slice(0, -1))) return full.slice((head + last).length - 1);
  }
  return null;
}

// --------------------------------------------------------------- loading ---

const JMDICT = 'jmdict.tsv.gz';
const KANJI = 'kanji.tsv.gz';

export const loadEngine: LangModule['loadEngine'] = async (baseUrl, opts) => {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const get = opts?.fetchBytes ?? ((name: string) => fetchBytes(base + name));
  let progress = 0;
  const report = (to: number) => {
    if (to > progress) { progress = to; opts?.onProgress?.(Math.min(100, Math.round(progress)), 100); }
  };
  report(0);
  // Start every download at once; unpack and parse in order as each arrives.
  const ipadicFiles = IPADIC_FILES.map((f) => get(`kuromoji/${f}.gz`));
  const jmFile = get(JMDICT);
  const kanjiFile = get(KANJI);
  const metaFile = get('meta.json');
  for (const p of [...ipadicFiles, jmFile, kanjiFile, metaFile]) p.catch(() => {}); // surfaced when awaited below
  let done = 0;
  const files = {} as IpadicFiles;
  for (let i = 0; i < IPADIC_FILES.length; i++) {
    files[IPADIC_FILES[i]] = await gunzip(await ipadicFiles[i]);
    done++;
    report(5 + (done / IPADIC_FILES.length) * 35);
  }
  await yieldToEventLoop();
  const ipadic = new Ipadic(files);
  report(45);
  await yieldToEventLoop();
  const jm = new Jmdict();
  const jmText = new TextDecoder().decode(await gunzip(await jmFile));
  report(55);
  await jm.load(jmText, (f) => report(55 + f * 35));
  const kd = new Kanjidic();
  kd.load(new TextDecoder().decode(await gunzip(await kanjiFile)));
  report(95);
  const metaRaw = JSON.parse(new TextDecoder().decode(await gunzip(await metaFile))) as Partial<Meta>;
  const meta: Meta = { built: metaRaw.built ?? '', counts: metaRaw.counts ?? {}, sources: metaRaw.sources ?? [] };
  report(100);
  return new JaEngine(ipadic, jm, kd, meta);
};

const mod: LangModule = { loadEngine };
export default mod;
