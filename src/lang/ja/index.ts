// The Japanese engine: IPADIC morphemes (ipadic.ts) grouped into learner words (words.ts), keyed and defined by JMdict,
// with furigana (ruby.ts) and KANJIDIC2 for the kanji. Contract: src/lang/types.ts.
import type { RubyPart, RubySpan, Token } from '../../types';
import type { KanjiInfo, LangEngine, LangModule, Sense, WordEntry, WordLookup } from '../types';
import { Jmdict, Kanjidic, fetchBytes, gunzip, headOf, yieldToEventLoop, type Entry, type Form } from './data';
import { deinflect, posFits } from './deinflect';
import { describeForms } from './forms';
import { IPADIC_FILES, Ipadic, type IpadicFiles, type Morpheme } from './ipadic';
import { foldReading, hasKanji, isAllKana, isHiraganaCode, isKanaCode, isKanjiCode, readingVariants, shiftRow, toHiragana, toKatakana } from './kana';
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

const NO_SPANS: readonly RubySpan[] = [];
const NO_BREAKS: readonly number[] = [];
const NO_NAMES = { sure: [] as RubySpan[], maybe: [] as RubySpan[] };
const PRT = ['prt'];
const ADV = ['adv'];
const MUST = ['なる', '成る', 'いける', '行ける'];
const MUST_NOT = ['いける', '行ける'];
const MAY = ['知れる', 'しれる'];
/** Word classes a copula or a suffix can follow. */
const NOMINAL: ReadonlySet<WordClass> = new Set(['noun', 'pronoun', 'adjna', 'number', 'counter', 'suffix']);

/** The code point that ends just before UTF-16 offset `p`. */
function codePointBefore(s: string, p: number): number {
  const lo = s.charCodeAt(p - 1);
  return lo >= 0xdc00 && lo <= 0xdfff && p >= 2 ? s.codePointAt(p - 2)! : lo;
}

// ------------------------------------------------------------ book ruby ---

/** Small kana written large, as old printings do (水晶《すいしよう》 is すいしょう). */
const SMALL_KANA: Record<string, string> = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', っ: 'つ', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ' };

const SMALL_RE = /[ぁぃぅぇぉっゃゅょゎ]/;

/** A reading for comparing a printed one with the dictionary's: hiragana, long vowels spelled out, small kana written large. */
export function looseReading(s: string): string {
  const f = foldReading(s);
  return SMALL_RE.test(f) ? f.replace(/[ぁぃぅぇぉっゃゅょゎ]/g, (c) => SMALL_KANA[c]) : f;
}

/**
 * The book's readings that can be used: inside the text, over Japanese letters only, in kana, not overlapping, in order.
 * (A reading over digits or Latin letters is left alone; those tokens carry no furigana.)
 */
function usableSpans(text: string, ruby: readonly RubySpan[] | undefined): readonly RubySpan[] {
  if (!ruby?.length) return NO_SPANS;
  const out: RubySpan[] = [];
  // In the order the readings close: a parser's base can only run too far back, never past the reading's own end.
  for (let r of [...ruby].sort((x, y) => x.end - y.end || y.start - x.start)) {
    if (!(r.start >= 0 && r.end <= text.length && r.start < r.end) || !r.rt || !/^[ぁ-ゟァ-ヿ]+$/.test(r.rt)) continue;
    const prev = out[out.length - 1];
    if (prev && r.start < prev.end) {
      // A reading right after another one covers only the kanji after it; a parser that runs its base back over the kanji
      // before (比較的《ひかくてき》呑気《のんき》 as 比較的呑気 read のんき) is taken at the word it meant.
      if (r.end <= prev.end) continue;
      r = { start: prev.end, end: r.end, rt: r.rt };
    }
    let ok = true;
    for (let k = r.start; k < r.end && ok;) {
      const cp = text.codePointAt(k)!;
      ok = isKanaCode(cp) || isKanjiCode(cp);
      k += cp > 0xffff ? 2 : 1;
    }
    if (ok) out.push(r);
  }
  return out;
}

/** Kanji numerals, and the question words that take a counter like them (何本, 幾日). */
const NUMERALS = '〇一二三四五六七八九十百千万両何幾数';

/**
 * Where the book's readings cut the text into words. Aozora prints a reading over a whole run of kanji unless ｜ says where
 * it starts, so an edge of a reading between two kanji is a word boundary the publisher drew (都｜洛陽《らくよう》, 唯《ただ》一人).
 * An edge next to kana says nothing (御釈迦様 under お, 断《き》れた), and neither does the edge between two readings side by
 * side, which a publisher may print kanji by kanji (一口《ひとくち》二口《ふたくち》).
 */
function spanBreaks(text: string, a: number, b: number, spans: readonly RubySpan[], whole: ReadonlySet<RubySpan>): number[] {
  const out = new Set<number>();
  spans.forEach((s, i) => {
    // A name read as the book printed it before is a whole word: its edges are word boundaries.
    if (whole.has(s)) {
      if (s.start > a) out.add(s.start);
      if (s.end < b) out.add(s.end);
      return;
    }
    let kanji = true;
    for (let k = s.start; k < s.end && kanji;) {
      const cp = text.codePointAt(k)!;
      kanji = isKanjiCode(cp);
      k += cp > 0xffff ? 2 : 1;
    }
    for (const p of [s.start, s.end]) {
      if (p <= a || p >= b) continue;
      if ((p === s.start && spans[i - 1]?.end === p) || (p === s.end && spans[i + 1]?.start === p)) continue;
      // A counter printed after its number (一｜杯《ぱい》, 三｜度《ど》) stays with it: 一杯 is いっぱい, not いち + ぱい.
      if (p === s.start && s.end - s.start === 1 && NUMERALS.includes(text[p - 1])) continue;
      if (!kanji || (isKanjiCode(codePointBefore(text, p)) && isKanjiCode(text.codePointAt(p)!))) out.add(p);
    }
  });
  return [...out].sort((x, y) => x - y);
}

/** Words one reading is printed over, as one word: 杜|子|春 is 杜子春; 親|譲り under 親譲《おやゆず》 is 親譲り. */
function mergeWords(ws: Word[]): Word {
  const last = ws[ws.length - 1];
  const text = ws.map((w) => w.text).join('');
  const inflects = last.cls === 'verb' || last.cls === 'adj';
  const names = ws.every((w) => w.name);
  return {
    start: ws[0].start, end: last.end, text, morphemes: ws.flatMap((w) => w.morphemes),
    lemma: inflects ? ws.slice(0, -1).map((w) => w.text).join('') + last.lemma : text,
    reading: '', lemmaReading: '', pieces: ws.flatMap((w) => w.pieces), forms: inflects ? last.forms : [],
    cls: inflects ? last.cls : 'noun', ctype: inflects ? last.ctype : '', unknown: ws.some((w) => w.unknown), compound: true,
    name: names ? (ws.length > 1 ? 'person' : ws[0].name) : undefined,
  };
}

/** The reading of the lemma of a printed word: the reading as printed up to where the lemma and the word part, then the lemma's kana. */
function printedLemmaReading(w: Word, parts: RubyPart[]): string {
  if (w.lemma === w.text) return w.reading;
  if (w.lemma === '来る') return 'くる';
  let cp = 0;
  while (cp < w.lemma.length && cp < w.text.length && w.lemma[cp] === w.text[cp]) cp++;
  const tail = w.lemma.slice(cp);
  if (hasKanji(tail)) return '';
  let r = '';
  let at = 0;
  for (const p of parts) {
    const end = at + p.text.length;
    if (end <= cp) {
      if (!p.rt && hasKanji(p.text)) return '';
      r += toHiragana(p.rt ?? p.text);
    } else if (at < cp) {
      if (p.rt) return '';
      r += toHiragana(p.text.slice(0, cp - at));
    }
    at = end;
  }
  return r + toHiragana(tail);
}

/** Deinflection types (deinflect.ts) as the IPADIC conjugation types the ranking reads. */
const CTYPE_OF: Record<string, string> = {
  v1: '一段', v5k: '五段・カ行イ音便', 'v5k-s': '五段・カ行促音便', v5g: '五段・ガ行', v5s: '五段・サ行', v5t: '五段・タ行', v5n: '五段・ナ行',
  v5b: '五段・バ行', v5m: '五段・マ行', v5r: '五段・ラ行', v5u: '五段・ワ行促音便', vk: 'カ変・来ル', vs: 'サ変・スル', 'adj-i': '形容詞・アウオ段',
};

/**
 * The morphemes, each known to the analyzer with a reading and none a name, spell `reading` (loose) read one after another,
 * with the sound changes of a compound: voicing at the start of a later one (杖 つえ → づえ), っ at the end of an earlier one.
 */
function compoundReads(ms: readonly Morpheme[], reading: string): boolean {
  if (!ms.every((m) => m.known && m.reading && m.pos1 !== '固有名詞')) return false;
  // Each piece's readings: IPADIC's, and for 御 and the numerals the others they take (御時宜 おじぎ, 四斗樽 しとだる).
  const rs = ms.map((m) => [looseReading(toHiragana(m.reading)), ...(OTHER_READINGS[m.surface] ?? [])]);
  const walk = (i: number, at: number): boolean => {
    if (i === rs.length) return at === reading.length;
    return rs[i].some((r) => readingVariants(r).map(looseReading).some((v) => (i > 0 || v[0] === r[0]) && reading.startsWith(v, at) && walk(i + 1, at + v.length)));
  };
  return walk(0, 0);
}

/** Readings 御 and the numerals take besides the one IPADIC gives them in a compound. */
const OTHER_READINGS: Record<string, string[]> = {
  御: ['お', 'ご', 'おん', 'み'], 一: ['いち', 'ひと'], 二: ['に', 'ふた'], 三: ['さん', 'み'], 四: ['し', 'よん', 'よ'], 五: ['ご', 'いつ'],
  六: ['ろく', 'む'], 七: ['しち', 'なな'], 八: ['はち', 'や'], 九: ['く', 'きゅう'], 十: ['じゅう', 'じっ', 'とお'], 拾: ['じゅう'],
};

/** Tags JMdict gives to names and to words only a historian needs. */
const NAME_TAGS = new Set(['place', 'person', 'surname', 'given', 'fem', 'masc', 'unclass', 'company', 'organization', 'station', 'work', 'char', 'fict', 'dei', 'myth', 'leg', 'group', 'ship', 'product', 'serv', 'ev', 'doc', 'obj', 'creat', 'relig', 'n-pr']);

/** An entry with nothing but names, history, archaic or rare senses: the Qing dynasty, the archaic adverb さや. */
function fringeOrName(e: Entry): boolean {
  return e.senses.every((s) => isFringeSense(s.tags) || s.tags.includes('hist') || s.tags.some((t) => NAME_TAGS.has(t)));
}

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

/** An entry for a form: its score, the kanji and kana forms that matched, and whether it is read the way asked (when asked). */
interface Ranked { e: Entry; score: number; kanji: number; kana: number; read: boolean }

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

  segment(text: string, opts?: { ruby?: readonly RubySpan[] }): Token[] {
    const spans = usableSpans(text, opts?.ruby);
    const names = this.printedNames.size;
    const out = this.segmentOnce(text, spans);
    // A name read for the first time here (犍陀多《かんだた》) may stand again later in the same paragraph without its reading.
    if (spans.length && this.printedNames.size > names) return this.segmentOnce(text, spans);
    return out;
  }

  private segmentOnce(text: string, spans: readonly RubySpan[]): Token[] {
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
        this.segmentRun(text, i, end, out, spans.length ? spans.filter((s) => s.start >= i && s.end <= end) : NO_SPANS);
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

  private segmentRun(text: string, a: number, b: number, out: Token[], printed: readonly RubySpan[]): void {
    const names = this.printedNames.size ? this.namesIn(text, a, b, printed) : NO_NAMES;
    let spans: readonly RubySpan[] = names.sure.length ? [...printed, ...names.sure].sort((x, y) => x.start - y.start) : printed;
    let breaks = spans.length ? spanBreaks(text, a, b, spans, new Set(names.sure)) : NO_BREAKS;
    if (breaks.length && printed.length) {
      // A reading over part of a word the dictionary has, read the way the book prints it, leaves the word whole: the ｜ of
      // 一部｜始終《しじゅう》 or 閻魔《えんま》大王 only marks where the furigana starts (一部始終 "the whole story" stays one word,
      // and so do 渦《うず》巻いた and 所嫌《きら》わず). 唯《ただ》一人 is cut: whole, IPADIC reads 唯一 ゆいいつ.
      const plain = this.wordsOf(text, a, b);
      breaks = breaks.filter((p) => names.sure.some((n) => n.start === p || n.end === p) || !this.printedInside(plain, p, printed));
    }
    let words = this.wordsOf(text, a, b, 0, breaks);
    // A name next to other kanji (清以外, 又杜子春) is the name where the analyzer cuts the words at its edges anyway; 清水 is
    // one word, and no Kiyo.
    const fits = names.maybe.length ? names.maybe.filter((m) => words.some((w) => w.start === m.start) && words.some((w) => w.end === m.end)) : NO_SPANS;
    if (fits.length) spans = [...spans, ...fits].sort((x, y) => x.start - y.start);
    // Kana that run on from a reading belong to its word only as okurigana or when the dictionary has the whole (親譲《おやゆず》り);
    // otherwise the word ends with the reading (杜子春《とししゅん》の is not 杜子 + 春の, a place IPADIC knows).
    const ends = spans.length ? spans.filter((s) => s.end < b && !breaks.includes(s.end) && this.runsOn(words, s, text)) : NO_SPANS;
    if (ends.length) {
      breaks = [...breaks, ...ends.map((s) => s.end)].sort((x, y) => x - y);
      words = this.wordsOf(text, a, b, 0, breaks);
    }
    this.fixNames(words);
    this.inContext(words, text, a);
    words = this.joinPhrases(words);
    if (spans.length) words = this.applyPrinted(words, spans, text, b, breaks);
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

  private nameCache = new Map<string, { plain: boolean; common: string | undefined }>();

  /** IPADIC's names checked against JMdict (words that are plain words, a name that is a common word read another way). */
  private fixNames(words: Word[]): void {
    words.forEach((w, i) => {
      if (!w.name || w.morphemes.length !== 1) return;
      // IPADIC calls many plain words names (蓮池 "lotus pond", 林 "grove", 大王 "great king", 風の音). One JMdict lists as a
      // plain word read the same way is that word, unless a person's suffix follows (林さん). A name whose only entries are
      // history or archaic (清, the maid Kiyo in 坊っちゃん: JMdict has only the Qing dynasty and an archaic adverb さや) stays a
      // name, and so does a place (東京).
      const next = words[i + 1];
      const k = w.text + '\u0000' + w.reading;
      let known = this.nameCache.get(k);
      if (!known) {
        known = { plain: this.plainWord(w.text, w.reading), common: this.commonReading(w.text, w.reading) };
        if (this.nameCache.size > 5000) this.nameCache.clear();
        this.nameCache.set(k, known);
      }
      if (w.name !== 'place' && next?.morphemes[0]?.pos2 !== '人名' && known.plain) w.name = undefined;
      // A name that is also a common word read another way is that word: 大分 is だいぶ "a lot" far more often than Ōita.
      const common = known.common;
      if (common) {
        w.name = undefined;
        w.reading = w.lemmaReading = common;
        w.pieces = [{ text: w.text, reading: common }];
      }
    });
  }

  /**
   * Readings and classes that the words around a word decide, where IPADIC decides by cost alone. `a` is where the run
   * starts in `text` (what stands before it says whether a word starts a clause).
   */
  private inContext(words: Word[], text: string, a: number): void {
    const nominal = (w: Word | undefined) => !!w && (NOMINAL.has(w.cls) || !!w.name || (w.cls === 'particle' && w.lemma === 'の' && w.morphemes[0]?.pos === '名詞'));
    // A verb, adjective or auxiliary that can stand before a noun: its last form is no te-form, stem, imperative or condition.
    const attributive = (w: Word | undefined) => {
      if (!w || (w.cls !== 'verb' && w.cls !== 'adj' && w.cls !== 'aux')) return false;
      const last = w.forms[w.forms.length - 1] ?? '';
      return !(last === 'te-form' || last.startsWith('stem') || last === 'imperative' || last.startsWith('conditional') || last === 'tari' || last === 'adverbial (ku)');
    };
    const set = (w: Word, reading: string) => { w.reading = w.lemmaReading = reading; w.pieces = [{ text: w.text, reading }]; };
    words.forEach((w, i) => {
      const prev = words[i - 1];
      const next = words[i + 1];
      // Where the run starts: after punctuation or at the start of the paragraph, a clause starts.
      const clauseStart = !prev && (w.start === 0 || /[。、，．！？「『（\s—―…]/.test(text[w.start - 1] ?? '') || a < w.start);
      const sentenceStart = !prev && (w.start === 0 || /[。．！？「『（\s—―…]/.test(text[w.start - 1] ?? ''));
      // A conjunction starts a sentence; anywhere else the word is the adverb (後にはただ極楽の…, と云っては、ただ罪人が…: ただ
      // "only", not "but").
      if (w.cls === 'conj' && !sentenceStart && this.hasPos(w.lemma, ADV)) w.cls = 'adverb';
      // じゃ after a noun, or before ない/ありません/なし, is the copula では (人じゃない, ものじゃなし); at the start of a clause
      // or after それ/これ it is "well then" (それじゃ、また).
      if ((w.text === 'じゃ' || w.text === 'じゃあ') && w.cls === 'particle') {
        const negative = !!next && /^(ない|なかっ|なく|なけれ|ありません|あり|ある|あるまい|なし|ねえ|ない)/.test(next.text);
        const demonstrative = !!prev && /^(それ|これ|あれ|そう|こう|そんな|こんな)$/.test(prev.text);
        if (negative || (nominal(prev) && !demonstrative)) w.cls = 'aux';
      }
      // 位 and 程 after a verb or adjective are the particles くらい and ほど (困る位, 生きている位なら), not "rank" and "degree".
      if (w.cls === 'noun' && w.morphemes.length === 1 && attributive(prev) && hasKanji(w.text) && this.hasPos(w.text, PRT, w.reading)) w.cls = 'particle';
      // 中 after a verb, before に, is うち "while" (見る見る中に, のぼる中に).
      if (w.text === '中' && attributive(prev) && next?.text === 'に') set(w, 'うち');
      // 間 after の, その/この or a verb is あいだ (蓮の葉の間, 五六年の間は), unless the whole is a word (床の間).
      if (w.text === '間' && w.reading === 'ま' && (prev?.lemma === 'の' || prev?.cls === 'prenoun' || attributive(prev)) && !(prev?.lemma === 'の' && this.jm.has((words[i - 2]?.text ?? '') + 'の間'))) set(w, 'あいだ');
      // 後 on its own after a verb or の, or starting a clause before a particle, is あと (のぼった後を, 後には); その後 stays ご.
      if (w.text === '後' && w.reading !== 'あと' && w.morphemes[0]?.pos1 !== '接尾' && (attributive(prev) || prev?.lemma === 'の' || (clauseStart && next?.cls === 'particle'))) set(w, 'あと');
      // A suffix with nothing nominal before it is a noun of its own (と音を立てて: 音 おと, not おん; 遥か下に: 下 した).
      // (What takes a suffix: a noun the analyzer knows, written in kanji or katakana, a number or a name; not いつ, not そ.)
      if (w.cls !== 'suffix' || w.morphemes.length !== 1 || prev?.cls === 'prefix') return;
      const stem = !!prev && (!!prev.name || prev.cls === 'number' || prev.cls === 'counter' || (prev.cls === 'noun' && !prev.unknown && /[\u3400-\u9fff々ァ-ヺ]/.test(prev.text)));
      if (!stem && hasKanji(w.text)) {
        const nouns = this.rank(w.text, undefined, 'noun', '').filter((r) => r.kanji >= 0 && r.score > 0 && r.e.pos.has('n'));
        const best = nouns.find((r) => !r.e.pos.has('suf') && !r.e.pos.has('n-suf')) ?? nouns[0];
        const kana = best?.e.kana.find((f) => !f.only || f.only.includes(best.kanji));
        if (kana) { w.cls = 'noun'; set(w, toHiragana(kana.text)); }
      }
    });
  }

  /**
   * Phrases a learner looks up whole that IPADIC leaves in pieces across a particle or an auxiliary:
   *   - must and must not, kept in the verb as its form: 行かなければならない, 食べなくてはいけない, 隠してはいけません;
   *   - かも知れない "may", with the form of 知れる (かも知れません is its polite form);
   *   - a word and a particle or ending that JMdict lists together as an adverb, conjunction or expression, read the same way:
   *     非常に "very", 相変らず "as usual", 元より "from the first". Not when something modifies the word (その時に is "at that
   *     time", not 時に "by the way").
   */
  private joinPhrases(words: Word[]): Word[] {
    const out: Word[] = [];
    const join = (ws: Word[], extra: Partial<Word>): Word => ({
      start: ws[0].start, end: ws[ws.length - 1].end, text: ws.map((x) => x.text).join(''), morphemes: ws.flatMap((x) => x.morphemes),
      reading: ws.every((x) => x.reading) ? ws.map((x) => x.reading).join('') : '', pieces: ws.flatMap((x) => x.pieces),
      lemma: ws[0].lemma, lemmaReading: ws[0].lemmaReading, forms: ws[0].forms, cls: ws[0].cls, ctype: ws[0].ctype, unknown: ws.some((x) => x.unknown),
      ...extra,
    });
    const negativeOf = (x: Word | undefined, lemmas: readonly string[]) => !!x && x.cls === 'verb' && lemmas.includes(x.lemma) && x.forms.includes('negative');
    const rest = (x: Word) => { const f = [...x.forms]; f.splice(f.indexOf('negative'), 1); return f; };
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const n1 = words[i + 1];
      const n2 = words[i + 2];
      const f = w.forms;
      const inflects = w.cls === 'verb' || w.cls === 'adj' || w.cls === 'aux';
      if (!n1) { out.push(w); continue; }
      // 行かなければならない, 行かねばならぬ, 行かなくては|ならない: must.
      const ifNot = f.length >= 2 && f[f.length - 2] === 'negative' && (f[f.length - 1] === 'conditional (ba)' || f[f.length - 1] === 'te-form');
      const mustAfter = ifNot && f[f.length - 1] === 'te-form' && n1?.text === 'は' ? n2 : n1;
      if (inflects && ifNot && negativeOf(mustAfter, MUST)) {
        const ws = mustAfter === n2 ? [w, n1!, n2!] : [w, n1!];
        out.push(join(ws, { forms: [...f.slice(0, -2), 'must (nakereba naranai)', ...rest(mustAfter!)] }));
        i += ws.length - 1;
        continue;
      }
      // 隠しては|いけません, 見ちゃ|いけない: must not.
      const teWa = f[f.length - 1] === 'te wa (cha)' ? n1 : f[f.length - 1] === 'te-form' && n1?.text === 'は' ? n2 : undefined;
      if (inflects && negativeOf(teWa, MUST_NOT)) {
        const ws = teWa === n2 ? [w, n1!, n2!] : [w, n1!];
        out.push(join(ws, { forms: [...f.slice(0, -1), 'must not (te wa ikenai)', ...rest(teWa!)] }));
        i += ws.length - 1;
        continue;
      }
      // かも知れない "may".
      if (w.text === 'かも' && negativeOf(n1, MAY)) {
        const lemma = n1!.lemma === '知れる' ? 'かも知れない' : 'かもしれない';
        out.push(join([w, n1!], { lemma, lemmaReading: 'かもしれない', forms: rest(n1!), cls: 'aux', ctype: '' }));
        i++;
        continue;
      }
      // 非常に, 相変らず, 元より.
      const prev = out[out.length - 1];
      const modified = !!prev && (prev.lemma === 'の' || prev.cls === 'prenoun' || ((prev.cls === 'verb' || prev.cls === 'adj') && !prev.forms.length));
      // (And a mimetic word in kana and its と: しんと "silently", which IPADIC cuts as しん "core" + と.)
      const mimetic = n1?.text === 'と' && isAllKana(w.text) && w.cls !== 'particle' && w.cls !== 'aux';
      if ((n1.cls === 'particle' || (n1.cls === 'verb' && n1.forms.length > 0)) && !w.name && !modified && (mimetic || hasKanji(w.text))) {
        const text = w.text + n1.text;
        const reading = !this.jm.has(text) ? '' : w.reading && n1.reading ? looseReading(w.reading + n1.reading) : '-';
        const r = !reading ? undefined : this.rank(text, undefined, undefined, '').find((x) => (x.kanji >= 0 || (mimetic && x.kana >= 0)) && (x.e.pos.has('adv') || x.e.pos.has('adv-to') || x.e.pos.has('conj') || x.e.pos.has('exp')) && (reading === '-' || x.e.kana.some((k) => looseReading(k.text) === reading)));
        if (r) {
          const pos = r.e.pos;
          out.push(join([w, n1], { lemma: text, lemmaReading: w.reading && n1.reading ? w.reading + n1.reading : '', forms: [], cls: pos.has('adv') ? 'adverb' : pos.has('conj') ? 'conj' : 'noun', ctype: '', compound: true }));
          i++;
          continue;
        }
      }
      out.push(w);
    }
    return out;
  }

  private posCache = new Map<string, boolean>();

  /** JMdict has `form` with one of the parts of speech `tags` (read `reading`, when given). */
  private hasPos(form: string, tags: readonly string[], reading?: string): boolean {
    const key = form + '\u0000' + tags.join(',') + '\u0000' + (reading ?? '');
    let yes = this.posCache.get(key);
    if (yes !== undefined) return yes;
    const r = reading ? looseReading(reading) : '';
    yes = this.jm.ids(form).some((id) => {
      const e = this.jm.entry(id);
      return tags.some((t) => e.pos.has(t)) && (!r || e.kana.some((f) => looseReading(f.text) === r));
    });
    if (this.posCache.size > 20000) this.posCache.clear();
    this.posCache.set(key, yes);
    return yes;
  }

  /**
   * The words of text[a, b): IPADIC's morphemes grouped (words.ts), then the repairs that need JMdict. No word crosses one of
   * `breaks` (the edges of a reading the book prints): the stretches between them are grouped each on its own.
   */
  private readonly ctx = { has: (f: string) => this.jm.has(f) };

  private wordsOf(text: string, a = 0, b = text.length, depth = 0, breaks: readonly number[] = NO_BREAKS): Word[] {
    const ms = this.ipadic.analyze(text, a, b, breaks);
    const ctx = this.ctx;
    if (!breaks.length) return this.repair(groupWords(ms, ctx), text, b, depth);
    const out: Word[] = [];
    let k = 0;
    for (const p of [...breaks.filter((x) => x > a && x < b), b]) {
      const part: Morpheme[] = [];
      while (k < ms.length && ms[k].end <= p) part.push(ms[k++]);
      if (part.length) out.push(...this.repair(groupWords(part, ctx), text, p, depth));
    }
    return out;
  }

  // ------------------------------------------------------ printed ruby ---

  /**
   * Fits the book's readings onto the words. A reading covering several words makes them one (杜|子|春 → 杜子春 とししゅん);
   * the kana that run on from it stay in the word (断《き》れた: the stem's furigana is the book's, the okurigana the
   * engine's), and the word is then defined by the dictionary entry read that way (明後日《あさって》, not みょうごにち). When
   * the dictionary has no entry read as printed, the word is a name (清《きよ》, 犍陀多《かんだた》), and its reading is kept for
   * where it comes again without one.
   */
  private applyPrinted(words: Word[], spans: readonly RubySpan[], text: string, b: number, breaks: readonly number[]): Word[] {
    const out: Word[] = [];
    let i = 0;
    while (i < words.length) {
      // The words a reading touches, and the words those readings touch in turn, become one.
      let j = i;
      let inside = spans.filter((s) => s.start < words[i].end && s.end > words[i].start);
      if (!inside.length) { out.push(words[i++]); continue; }
      for (;;) {
        const end = Math.max(...inside.map((s) => s.end));
        while (j + 1 < words.length && words[j + 1].start < end) j++;
        const more = spans.filter((s) => s.start < words[j].end && s.end > words[i].start);
        if (more.length === inside.length) break;
        inside = more;
      }
      const ext = this.printedOkurigana(words, i, j, inside, text, b);
      if (ext) {
        // The word ended inside the kana IPADIC cut otherwise (凄|じい): what follows is analyzed again.
        out.push(ext);
        const rest = ext.end < b ? this.wordsOf(text, ext.end, b, 0, breaks) : [];
        this.fixNames(rest);
        return [...out, ...this.applyPrinted(rest, spans, text, b, breaks)];
      }
      out.push(...this.printGroup(words.slice(i, j + 1), inside, text, words[j + 1]));
      i = j + 1;
    }
    return out;
  }

  /**
   * A reading over a kanji alone, then kana IPADIC cut apart (凄《すさま》じい as 凄 + じい, 畏《かしこま》って): the kanji and its
   * okurigana as the longest dictionary word read as printed, inflected or not. Null when there is none, or when the kana are
   * a particle after a noun (時《とき》に stays 時 + に).
   */
  private printedOkurigana(words: Word[], i: number, j: number, spans: readonly RubySpan[], text: string, b: number): Word | null {
    const s = spans[0];
    if (spans.length !== 1 || s.start !== words[i].start || s.end !== words[j].end || s.end >= b || !isHiraganaCode(text.charCodeAt(s.end))) return null;
    const base = text.slice(s.start, s.end);
    if (![...base].every((ch) => isKanjiCode(ch.codePointAt(0)!))) return null;
    let kana = 0;
    while (kana < 8 && s.end + kana < b && isHiraganaCode(text.charCodeAt(s.end + kana))) kana++;
    const next = words[j + 1];
    const particle = !!next && (next.cls === 'particle' || next.cls === 'aux');
    const rt = toHiragana(s.rt);
    for (let k = kana; k >= 1; k--) {
      const surface = text.slice(s.start, s.end + k);
      for (const d of deinflect(surface)) {
        if (!d.term.startsWith(base) || hasKanji(d.term.slice(base.length))) continue;
        const lemmaReading = rt + toHiragana(d.term.slice(base.length));
        // The spelling read as printed, or a word read so that is spelled with this kanji first (畏《かしこま》って: the
        // reading takes in the ま that JMdict's 畏まる writes).
        // Failing both, a verb or adjective is the common word read so (詫《あや》まって: 謝る, which JMdict does not spell 詫まる).
        const tail = d.term.slice(base.length);
        const r = this.rank(d.term, lemmaReading, undefined, '').find((x) => x.read && x.kanji >= 0 && posFits(d.type, x.e.pos))
          ?? this.rank(lemmaReading, undefined, undefined, '').find((x) => posFits(d.type, x.e.pos) && x.e.kanji.some((f) => f.text.startsWith(base) && (d.type || f.text.endsWith(tail))))
          ?? (d.type ? this.rank(lemmaReading, undefined, undefined, '').find((x) => posFits(d.type, x.e.pos) && x.e.common) : undefined);
        if (!r) continue;
        const pos = r.e.pos;
        const verb = [...pos].some((t) => VERB_TAG.test(t));
        const adj = pos.has('adj-i');
        // Kana IPADIC took for particles join only when the kanji read as printed is no word alone: 固《もと》より is 固より,
        // 賑《にぎ》やか 賑やか; 時《とき》に stays 時 + に.
        if (particle && !verb && !adj && this.rank(base, rt, undefined, '').some((x) => x.read)) continue;
        const end = s.end + k;
        const reading = rt + toHiragana(surface.slice(base.length));
        const cls: WordClass = verb ? 'verb' : adj ? 'adj' : pos.has('adv') ? 'adverb' : pos.has('adj-na') ? 'adjna' : 'noun';
        const type = d.type || [...pos].find((t) => CTYPE_OF[t]) || '';
        const word: Word = {
          start: s.start, end, text: surface, morphemes: words.slice(i).flatMap((w) => w.morphemes).filter((m) => m.start < end),
          lemma: d.term, reading, lemmaReading, pieces: [{ text: surface, reading }], forms: d.forms, cls, ctype: CTYPE_OF[type] ?? '', unknown: true,
          printed: [{ text: base, rt: s.rt }, { text: surface.slice(base.length) }],
        };
        return word;
      }
    }
    return null;
  }

  /** Words under the readings `spans`, as the word(s) they make. */
  private printGroup(group: Word[], spans: readonly RubySpan[], text: string, next?: Word): Word[] {
    const w = group.length === 1 ? { ...group[0] } : mergeWords(group);
    // A word with no kana outside its readings is no inflected form: 清《きよ》 is not the stem of 清い, nor 犍陀多 the stem
    // of 多い.
    let bare = true;
    for (let k = w.start; k < w.end && bare; k++) bare = spans.some((s) => s.start <= k && k < s.end);
    if (bare && (w.cls === 'verb' || w.cls === 'adj' || w.forms.length)) Object.assign(w, { cls: 'noun', forms: [], lemma: w.text, ctype: '' });
    const parts = this.printedParts(w, spans, text);
    if (!parts) return group;
    this.print(w, parts, spans, next);
    if (group.length === 2 && spans.length === 1 && !w.name && !this.rankWord(w).length) {
      // An honorific prefix and a verb under one reading (御佇《おたたず》み) are two words, each read its share.
      const two = this.splitPrefix(group, spans[0], text);
      if (two) return two;
    }
    return [w];
  }

  /** 御佇《おたたず》み as 御 (お) and 佇み (たたずみ): the prefix takes the reading of its own that starts the printed one. */
  private splitPrefix(group: Word[], s: RubySpan, text: string): Word[] | null {
    const [p, v] = group;
    if (p.cls !== 'prefix' || (v.cls !== 'verb' && v.cls !== 'adj') || s.start !== p.start || s.end <= p.end || s.end > v.end) return null;
    const rt = toHiragana(s.rt);
    const own = this.readingsOf(p.text, false).filter((r) => rt.startsWith(r) && rt.length > r.length).sort((x, y) => y.length - x.length);
    if (!own.length) return null;
    const out: Word[] = [];
    for (const [w, span] of [[p, { start: p.start, end: p.end, rt: own[0] }], [v, { start: p.end, end: s.end, rt: rt.slice(own[0].length) }]] as const) {
      const word = { ...w };
      const parts = this.printedParts(word, [span], text);
      if (!parts) return null;
      this.print(word, parts, [span]);
      out.push(word);
    }
    return out;
  }

  /** The word read as printed: its furigana, reading and lemma reading, and whether it is a name (`next`: the word after it). */
  private print(w: Word, parts: RubyPart[], spans: readonly RubySpan[], next?: Word): void {
    const was = w.name;
    w.printed = parts;
    w.reading = parts.every((p) => p.rt || !hasKanji(p.text)) ? parts.map((p) => toHiragana(p.rt ?? p.text)).join('') : '';
    w.pieces = [{ text: w.text, reading: w.reading }];
    w.lemmaReading = printedLemmaReading(w, parts);
    const inflected = w.forms.length > 0 || w.cls === 'verb' || w.cls === 'adj';
    if (inflected) {
      if (!this.rankWord(w).length) this.reinflect(w, parts);
      return;
    }
    const fits = this.rankWord(w);
    if (fits.length) {
      // Read as printed, the dictionary has it: the word, unless IPADIC took it for a person and the entries read so are
      // only names, history or archaic (a given name read しん would still not be the Qing dynasty).
      if (!(was && fits.every((r) => fringeOrName(r.e)))) w.name = undefined;
      return;
    }
    // A name the book printed earlier, read so again (清以外: IPADIC takes 清 for the stem of 清い here).
    if (spans.every((s) => this.virtual.has(s))) {
      w.name = was ?? 'person';
      return;
    }
    // IPADIC knows the noun read so, and not as a name: a word JMdict lacks, not a name.
    const m = w.morphemes;
    if (!was && m.length === 1 && m[0].known && m[0].pos === '名詞' && m[0].reading && looseReading(m[0].reading) === looseReading(w.reading)) return;
    // A name takes a particle, not an ending: a kanji whose reading runs into kana that are no particle (審《いぶか》しそう,
    // 賑《にぎ》やか, 惧《おそ》れ) is a word the dictionary spells otherwise.
    if (next && !was && next.start === w.end && isHiraganaCode(next.text.charCodeAt(0)) && next.cls !== 'particle') return;
    // Words the analyzer knows, read together the way the book prints them (竹杖 たけ + づえ, 四斗樽, 眼玉, 鍋焼饂飩): a
    // compound JMdict lacks, not a name. A name the analyzer reads its own way (杜子春 as もり + こ + はる) stays one.
    if (!was && w.morphemes.length > 1 && compoundReads(w.morphemes, looseReading(w.reading))) return;
    // One kanji read as a word of its own in KANJIDIC (瀑 たき "waterfall"), not a stem that takes okurigana (清 きよ.い):
    // the kanji's word.
    if (!was && [...w.text].length === 1 && this.kd.get(w.text)?.kun.some((k) => !k.includes('.') && k.replace(/-/g, '') === toHiragana(w.reading))) return;
    w.name = was ?? (w.morphemes.some((x) => x.pos2 === '人名') ? 'person' : 'proper');
    // One reading over the whole name: remembered, so the name reads so where it stands again without one.
    if (spans.length === 1 && spans[0].start === w.start && spans[0].end === w.end && w.reading) this.rememberName(w.text, spans[0].rt);
  }

  /**
   * An inflected word whose dictionary form, read as printed, is no word: IPADIC chose its verb by a reading the book does
   * not print (下《さが》りました is not 下りる おりる but 下がる さがる). The dictionary form is found again from the page.
   */
  private reinflect(w: Word, parts: RubyPart[]): void {
    for (const d of deinflect(w.text)) {
      const ctype = CTYPE_OF[d.type];
      if (!ctype || d.term === w.lemma) continue;
      const lemmaReading = printedLemmaReading({ ...w, lemma: d.term }, parts);
      if (!lemmaReading) continue;
      const cls: WordClass = d.type === 'adj-i' ? 'adj' : 'verb';
      const fits = this.rankPrinted({ ...w, lemma: d.term, lemmaReading, cls, ctype }).filter((r) => posFits(d.type, r.e.pos));
      if (!fits.length) continue;
      Object.assign(w, { lemma: d.term, lemmaReading, cls, ctype });
      return;
    }
  }

  /**
   * The word's furigana with the book's reading over each span it holds; its kana and any kanji outside the spans keep the
   * engine's. Null when a kanji reading of the engine's runs across the edge of a span (it cannot be cut there).
   */
  private printedParts(w: Word, spans: readonly RubySpan[], text: string): RubyPart[] | null {
    const placed: { at: number; part: RubyPart }[] = [];
    const inSpan = (p: number) => spans.some((s) => s.start <= p && p < s.end);
    let at = w.start;
    for (const part of this.rubyOf(w)) {
      const ps = at;
      const pe = at + part.text.length;
      at = pe;
      if (part.rt) {
        let ins = 0;
        for (let k = ps; k < pe; k++) if (inSpan(k)) ins++;
        if (ins === 0) placed.push({ at: ps, part });
        else if (ins !== pe - ps) return null;
        continue;
      }
      for (let k = ps; k < pe;) {
        const inside = inSpan(k);
        let e = k;
        while (e < pe && inSpan(e) === inside) e++;
        if (!inside) placed.push({ at: k, part: { text: text.slice(k, e) } });
        k = e;
      }
    }
    for (const s of spans) {
      const base = text.slice(s.start, s.end);
      // A run of kanji carries the reading as printed (杜子春 とししゅん, 洋燈 ランプ); a base with kana in it has the reading
      // over its kanji only.
      const own = [...base].every((ch) => isKanjiCode(ch.codePointAt(0)!)) ? [{ text: base, rt: s.rt }] : alignRuby(base, toHiragana(s.rt), this.kanjiReadings);
      let k = s.start;
      for (const part of own) { placed.push({ at: k, part }); k += part.text.length; }
    }
    placed.sort((x, y) => x.at - y.at);
    const out: RubyPart[] = [];
    for (const { part } of placed) {
      const last = out[out.length - 1];
      if (!part.rt && last && !last.rt) last.text += part.text;
      else out.push({ ...part });
    }
    return out.map((p) => p.text).join('') === w.text ? out : null;
  }

  /** The readings namesIn() put where a remembered name stands again (not printed there). */
  private virtual = new WeakSet<RubySpan>();

  /** Names the books printed a reading for (杜子春 とししゅん), by their text, to read so where they come again without it. */
  private printedNames = new Map<string, string>();
  /** The same names by their first letter, longest first. */
  private printedByFirst = new Map<string, string[]>();

  private rememberName(name: string, rt: string): void {
    if (this.printedNames.get(name) === rt) return;
    if (this.printedNames.size >= 5000) { this.printedNames.clear(); this.printedByFirst.clear(); }
    this.printedNames.set(name, rt);
    const list = this.printedByFirst.get(name[0]) ?? [];
    if (!list.includes(name)) list.push(name);
    list.sort((x, y) => y.length - x.length);
    this.printedByFirst.set(name[0], list);
  }

  /**
   * Readings for the names the book printed earlier, where one stands in text[a, b) as a whole run of kanji (清 alone, not
   * the 清 of 清水) and the book prints nothing over it here.
   */
  private namesIn(text: string, a: number, b: number, printed: readonly RubySpan[]): { sure: RubySpan[]; maybe: RubySpan[] } {
    const sure: RubySpan[] = [];
    const maybe: RubySpan[] = [];
    if (!this.printedNames.size) return { sure, maybe };
    for (let p = a; p < b; p++) {
      const list = this.printedByFirst.get(text[p]);
      if (!list) continue;
      // A printed reading's edge is as good as the end of the run of kanji (三｜度《ど》杜子春).
      const open = !(p > 0 && isKanjiCode(codePointBefore(text, p))) || printed.some((s) => s.end === p);
      for (const name of list) {
        const e = p + name.length;
        if (e > b || !text.startsWith(name, p) || printed.some((s) => s.start < e && s.end > p)) continue;
        const close = !(e < text.length && isKanjiCode(text.codePointAt(e)!)) || printed.some((s) => s.start === e);
        const span = { start: p, end: e, rt: this.printedNames.get(name)! };
        this.virtual.add(span);
        (open && close ? sure : maybe).push(span);
        p = e - 1;
        break;
      }
    }
    return { sure, maybe };
  }

  /**
   * JMdict has `text` as a plain word read `reading`: a kanji spelling that is not rare or search-only, with a sense that is
   * not history or a name.
   */
  private plainWord(text: string, reading: string): boolean {
    const mine = reading ? looseReading(reading) : '';
    for (const id of this.jm.ids(text)) {
      const e = this.jm.entry(id);
      const k = e.kanji.findIndex((f) => f.text === text);
      if (k < 0 || /[SRO]/.test(e.kanji[k].flags) || fringeOrName(e)) continue;
      if (!mine || e.kana.some((f) => (!f.only || f.only.includes(k)) && looseReading(f.text) === mine)) return true;
    }
    return false;
  }

  /**
   * A word of `words` runs across `p`, the dictionary has it, and its reading over each printed reading inside it is the
   * printed one (loosely: 水晶 すいしょう under すいしよう).
   */
  private printedInside(words: Word[], p: number, spans: readonly RubySpan[]): boolean {
    const w = words.find((x) => x.start < p && x.end > p);
    if (!w || !(this.jm.has(w.lemma) || this.jm.has(w.text))) return false;
    // A compound may have a kanji IPADIC does not know (閻魔大王): JMdict reads it.
    let reading = w.reading;
    if (!reading) {
      const best = this.rank(w.text, undefined, 'noun', '')[0];
      const kana = best?.kanji !== undefined && best.kanji >= 0 ? best.e.kana.find((f) => !f.only || f.only.includes(best.kanji)) : undefined;
      if (!kana) return false;
      reading = toHiragana(kana.text);
    }
    const inside = spans.filter((s) => s.start < w.end && s.end > w.start);
    if (!inside.length || inside.some((s) => s.start < w.start || s.end > w.end)) return false;
    const parts = alignRuby(w.text, reading, this.kanjiReadings);
    for (const s of inside) {
      let at = w.start;
      let over = '';
      for (const part of parts) {
        const pe = at + part.text.length;
        if (pe > s.start && at < s.end) {
          if (at < s.start || pe > s.end) return false;
          over += part.rt ?? toHiragana(part.text);
        }
        at = pe;
      }
      if (looseReading(over) !== looseReading(s.rt)) return false;
    }
    return true;
  }

  /** The word under the end of the reading `s` runs on with kana that are neither okurigana nor part of a dictionary word. */
  private runsOn(words: Word[], s: RubySpan, text: string): boolean {
    const i = words.findIndex((w) => w.start < s.end && w.end > s.end);
    if (i < 0) return false;
    const w = words[i];
    if (w.cls === 'verb' || w.cls === 'adj' || w.forms.length) return false;
    let first = i;
    while (first > 0 && words[first - 1].end > s.start) first--;
    return !this.jm.has(text.slice(Math.min(words[first].start, s.start), w.end));
  }

  /**
   * The reading of the common word spelled `text`, when IPADIC read it as a name in a way that is not common (大分: the
   * adverb だいぶ "a lot", not the city おおいた). A name read the common way (東京 とうきょう) stands.
   */
  private commonReading(text: string, reading: string): string | undefined {
    if (!reading || !hasKanji(text)) return undefined;
    const mine = foldReading(reading);
    let other: string | undefined;
    for (const id of this.jm.ids(text)) {
      const e = this.jm.entry(id);
      const k = e.kanji.findIndex((f) => f.text === text);
      if (k < 0) continue;
      const readings = e.kana.filter((f) => !f.only || f.only.includes(k));
      if (readings.some((f) => foldReading(f.text) === mine)) {
        if (e.kanji[k].common) return undefined;
        continue;
      }
      if (!e.kanji[k].common) continue;
      const kana = readings.find((f) => f.common);
      if (kana) other ??= toHiragana(kana.text);
    }
    return other;
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
      // (IPADIC may take the stem for a suffix: 御取りになって.)
      const honorific = (next?.cls === 'noun' || next?.cls === 'suffix') && words[i + 2]?.text === 'に' && /^な[らりるれろっ]/.test(words[i + 3]?.text ?? '');
      // 御 before a noun is お when the dictionary knows the word with お and not with ご: 御客 おきゃく, 御眼 おめ, 御時宜 おじぎ.
      const nr = next?.morphemes[0]?.reading ? toHiragana(next.morphemes[0].reading) : '';
      const native = (next?.cls === 'noun' || next?.cls === 'suffix') && !!nr && this.jm.has('お' + nr) && !this.jm.has('ご' + nr);
      if (w.text === '御' && w.reading === 'ご' && (next?.cls === 'verb' || next?.cls === 'adj' || honorific || native)) {
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
      const unknownKanji = w.unknown && w.morphemes.length === 1 && hasKanji(w.text) && [...w.text].every((ch) => isKanjiCode(ch.codePointAt(0)!));
      if (unknownKanji || this.brokenAfter(w, words[i + 1])) {
        const fixed = this.okurigana(words, i, text, b, !unknownKanji);
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
  /**
   * A word that starts with kanji and is followed by kana IPADIC cut into pieces that are no words of their own: 賞|め|られる,
   * 恐し|い, 極|っている, 驚|ろ|いて, 悪|る|く (old okurigana IPADIC does not know). A particle, an auxiliary, or a verb after
   * a te-form is no such piece.
   */
  private brokenAfter(w: Word, n: Word | undefined): boolean {
    if (!n || n.start !== w.end || !isHiraganaCode(n.text.charCodeAt(0)) || w.cls === 'particle' || !isKanjiCode(w.text.codePointAt(0)!)) return false;
    if (w.forms.includes('te-form')) return false;
    const m = n.morphemes[0];
    if (single(n) && n.cls !== 'particle' && n.cls !== 'aux') return true;
    // 極|って|いる: a kanji noun IPADIC reads on its own, then って, is a verb's te-form (極って, きまって).
    if (n.text === 'って' && w.cls === 'noun' && [...w.text].length === 1) return true;
    if (n.unknown && isAllKana(n.text)) return true;
    // A dependent verb with no te-form before it (恐し|い as いる, 極|っている as く).
    return m.pos === '動詞' && m.pos1 === '非自立' && (m.base === 'く' || m.base === 'る' || !w.text.endsWith('て') && !w.text.endsWith('で') && /^(いる|く|る)$/.test(m.base));
  }

  /**
   * words[i] is kanji IPADIC does not know, or (`known`) a known word with broken kana after it (brokenAfter): the longest
   * span of its kanji and the kana after them that JMdict knows, inflected or not, spelled as on the page, with one kana
   * too many (驚ろく is 驚く) or one too few (恐しい is 恐ろしい).
   */
  private okurigana(words: Word[], i: number, src: string, b: number, known = false): { word: Word; last: number } | null {
    const w = words[i];
    // The word up to its last kanji (気味が悪 in 気味が悪|る|く); what follows in it must be kana.
    let kanjiLen = w.text.length;
    while (kanjiLen > 0 && !isKanjiCode(w.text.charCodeAt(kanjiLen - 1))) kanjiLen--;
    const kanji = w.text.slice(0, kanjiLen);
    if (!kanji || /[^\u3041-\u309f]/.test(w.text.slice(kanjiLen))) return null;
    // Every end from one kana after the kanji to ten, as long as the kana run lasts; j is the word each end falls in.
    const spans: { j: number; text: string }[] = [];
    let j = i;
    for (let end = w.start + kanjiLen + 1; end <= Math.min(b, w.start + kanjiLen + 10); end++) {
      if (!isKanaCode(src.charCodeAt(end - 1))) break;
      while (j < words.length && words[j].end < end) j++;
      if (j >= words.length) break;
      // A known word is only taken past its own end.
      if (end > w.end || !known) spans.push({ j, text: src.slice(w.start, end) });
    }
    for (let k = spans.length - 1; k >= 0; k--) {
      const { j, text: span } = spans[k];
      const found = this.spelled(span, kanji, known);
      if (!found) continue;
      const { lemma, forms, r, extra, missing } = found;
      const kana = r.e.kana.find((f) => !f.only || f.only.includes(r.kanji));
      const lemmaReading = kana ? toHiragana(kana.text) : '';
      const lemmaTail = lemma.slice(kanji.length);
      let reading = '';
      if (lemmaReading && lemmaReading.endsWith(toHiragana(lemmaTail))) {
        // The kanji's share of the reading: 驚 is おど in 驚ろく (the ろ is written), 恐 is おそろ in 恐しい (the ろ is not).
        let stem = lemmaReading.slice(0, lemmaReading.length - lemmaTail.length) + missing;
        if (extra && stem.endsWith(extra)) stem = stem.slice(0, -extra.length);
        reading = stem + toHiragana(span.slice(kanji.length));
      }
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

  /**
   * The JMdict word `span` (kanji, then kana) is, inflected or not: as spelled, or (`variants`) with the kana right after the
   * kanji written once too often (驚ろいて: 驚く) or left out (恐しい: 恐ろしい).
   */
  private spelled(span: string, kanji: string, variants: boolean): { lemma: string; forms: string[]; r: Ranked; extra: string; missing: string } | null {
    const as = (s: string): { lemma: string; forms: string[]; r: Ranked } | null => {
      const exact = this.rank(s, undefined, undefined, '');
      if (exact.length && exact[0].kanji >= 0) return { lemma: s, forms: [], r: exact[0] };
      const d = this.deinflected(s).find((x) => x.term.startsWith(kanji) && x.r.kanji >= 0);
      return d ? { lemma: d.term, forms: d.forms, r: d.r } : null;
    };
    const plain = as(span);
    if (plain) return { ...plain, extra: '', missing: '' };
    if (!variants) return null;
    const after = span.slice(kanji.length);
    // One kana too many: the kanji's reading ends with it (驚 おどろ, then ろ).
    if (after.length > 1) {
      const alt = as(kanji + after.slice(1));
      if (alt) {
        const kana = alt.r.e.kana.find((f) => !f.only || f.only.includes(alt.r.kanji));
        const tail = alt.lemma.slice(kanji.length);
        if (kana && toHiragana(kana.text).slice(0, kana.text.length - tail.length).endsWith(after[0])) return { ...alt, extra: after[0], missing: '' };
      }
    }
    // One kana too few, in an adjective in -しい (恐しい, 怪しい): the kana JMdict writes after the kanji.
    if (/しい$|し[かくけ]/.test(after)) {
      for (const d of deinflect(span)) {
        if (d.type !== 'adj-i' && d.type !== '') continue;
        if (!d.term.endsWith('しい')) continue;
        for (let c = 0x3041; c <= 0x3093; c++) {
          const h = String.fromCharCode(c);
          const form = kanji + h + d.term.slice(kanji.length);
          if (!this.jm.has(form)) continue;
          const r = this.rank(form, undefined, 'adj', '').find((x) => x.kanji >= 0 && x.e.pos.has('adj-i'));
          if (r) return { lemma: form, forms: d.forms, r, extra: '', missing: h };
        }
      }
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
    if (!w.printed) this.resolveReading(w);
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
    // A reading of the kanji's own that a word on the JLPT lists has (縁 えん "fate", 画 が "picture") is no rare one, common
    // mark or not; 民 みん, on no list, gives way to たみ.
    if ([...w.text].length === 1 && this.readingsOf(w.text, false).includes(toHiragana(w.reading)) && this.jm.ids(w.text).some((id) => {
      const e = this.jm.entry(id);
      const k = e.kanji.findIndex((f) => f.text === w.text);
      return k >= 0 && (e.level !== undefined || e.common) && e.kana.some((f) => (!f.only || f.only.includes(k)) && !/[SRO]/.test(f.flags) && foldReading(f.text) === mine);
    })) return;
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
    // A reading the book prints decides: 断《き》れる is not the potential of 断る (ことわる).
    const baseReading = w.printed && w.lemmaReading ? w.lemmaReading.slice(0, -2) + u : undefined;
    const godan = this.rank(base, baseReading, 'verb', '').filter((r) => [...r.e.pos].some((t) => t.startsWith('v5')) && (!w.printed || r.read));
    if (!godan.length || godan[0].score < 0) return;
    const own = this.rank(w.lemma, w.lemmaReading || undefined, 'verb', w.ctype);
    if (own.length && own[0].score > 0 && (!w.printed || own[0].read)) {
      const first = own[0].e.senses[0]?.glosses[0] ?? '';
      if (!/^(to be able to|can |to be possible to)/.test(first)) return;
    }
    w.lemma = base;
    if (w.lemmaReading) w.lemmaReading = w.lemmaReading.slice(0, -2) + u;
    w.ctype = '五段';
    w.forms = ['potential', ...w.forms];
  }

  private rubyOf(w: Word): RubyPart[] {
    if (w.printed) return w.printed.map((p) => ({ ...p }));
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
    const frLoose = fr && SMALL_RE.test(fr) ? looseReading(fr) : fr;
    // Readings compare as folded, and with small kana written large only when there are any (水晶 すいしよう).
    const same = (k: string) => {
      const f = foldReading(k);
      return f === fr || ((SMALL_RE.test(f) || frLoose !== fr) && looseReading(f) === frLoose);
    };
    const out: Ranked[] = [];
    // The easiest level among the words this kana spells as a common spelling of theirs (for a word written in kana).
    let basicLevel: number | undefined;
    if (isAllKana(form)) {
      for (const id of ids) {
        const e = this.jm.entry(id);
        const f = e.kana.find((k) => k.text === form);
        if (f?.common && e.level !== undefined && (basicLevel === undefined || e.level < basicLevel)) basicLevel = e.level;
      }
    }
    for (const id of ids) {
      const e = this.jm.entry(id);
      const kanji = e.kanji.findIndex((f) => f.text === form);
      let kana = e.kana.findIndex((f) => f.text === form);
      let score = 0;
      let read = false;
      if (fr) {
        const ri = e.kana.findIndex((f) => same(f.text) && (kanji < 0 || !f.only || f.only.includes(kanji)));
        if (ri >= 0) { score += 100; read = true; if (kana < 0) kana = ri; } else score -= 60;
      }
      if (kanji >= 0) {
        const f = e.kanji[kanji];
        if (f.common) score += 15;
        if (f.flags.includes('S')) score -= 20;
        else if (/[ROI]/.test(f.flags)) score -= 10;
        if (e.uk) score -= 5;
      } else if (kana >= 0) {
        // The word was written in kana (its reading then is the kana, and says nothing more): words usually written in kana
        // fit best, unless that kana spelling is rare or outdated (ふち is 縁 "edge", not the outdated ぶち of 斑 "spots"), or
        // a more basic word is spelled so too (とる is 取る N5 "to take" before 摂る "to have (lunch)", usually in kana).
        const f = e.kana[kana];
        const plain = !/[SRO]/.test(f.flags);
        const basic = basicLevel === undefined || (e.level !== undefined && e.level <= basicLevel);
        if ((e.uk || !e.kanji.length) && plain) score += basic ? 30 : 10;
        else if (!(basic && e.level !== undefined)) score -= 10;
        if (f.common) score += 10;
        if (!plain) score -= 10;
      }
      score += posScore(cls, ctype, e.pos);
      if (e.common) score += 20;
      // The easier the level, the likelier the word a reader meets (とき is 時 "time" N5 far more often than 鴇 "ibis").
      if (e.level) score += (6 - e.level) * 4;
      if (e.senses.every((s) => isFringeSense(s.tags))) score -= 25;
      score += Math.min(6, e.senses.length);
      out.push({ e, score, kanji, kana, read });
    }
    out.sort((x, y) => y.score - x.score || x.e.id - y.e.id);
    return out;
  }

  private keyFor(w: Word): string {
    const k = `${w.lemma}\u0000${w.lemmaReading}\u0000${w.cls}\u0000${w.ctype}${w.printed ? '\u0000p' : ''}`;
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
    if (w.printed) return this.rankPrinted(w);
    // IPADIC's costs read a kana いる as the godan verb (要る "to be needed", 入る) more often than the ichidan 居る "to be";
    // in running text a kana いる is nearly always 居る (要る is written with its kanji when it is meant).
    // Only where the two verbs share the form: いらない, いります, いって are 要る's alone ("お金はもういらない").
    const ctype = w.lemma === 'いる' && w.ctype.startsWith('五段') && !/^い[らりっろ]/.test(w.text) ? '一段' : w.ctype;
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

  /** Entries for a word the book prints a reading over: only those read that way. Empty for a name. */
  private rankPrinted(w: Word): Ranked[] {
    const read = (rs: Ranked[]) => rs.filter((r) => r.read);
    const reading = w.lemmaReading || undefined;
    if (!reading) return [];
    let ranked = read(this.rank(w.lemma, reading, w.cls, w.ctype));
    if (!ranked.length && w.ctype.startsWith('サ変') && w.lemma.endsWith('する') && w.lemma.length > 2 && reading.endsWith('する')) {
      ranked = read(this.rank(w.lemma.slice(0, -2), reading.slice(0, -2), 'noun', ''));
    }
    if (!ranked.length && w.text !== w.lemma && w.reading) ranked = read(this.rank(w.text, w.reading, w.cls, w.ctype));
    const kanji = [...w.lemma].filter((ch) => isKanjiCode(ch.codePointAt(0)!));
    const inflects = w.cls === 'verb' || w.cls === 'adj';
    if (!ranked.length) {
      // A spelling JMdict does not list, read as printed: the word that sounds so and is spelled from these kanji on
      // (微《かすか》 is 微か, its okurigana inside the reading), or, for a verb or adjective, that shares a kanji or is common and
      // of the same kind (断《き》れる is 切れる).
      // (A noun's word must be spelled starting with the page's kanji: 洛陽 らくよう is no 落陽 "setting sun".)
      ranked = this.rank(reading, undefined, w.cls, w.ctype).filter((r) => {
        if (!inflects) return r.e.kanji.some((f) => f.text.startsWith(w.lemma));
        const shares = r.e.kanji.some((f) => kanji.some((ch) => f.text.includes(ch)));
        return posScore(w.cls, w.ctype, r.e.pos) > 0 && (shares || r.e.common);
      });
      for (const r of ranked) r.read = true;
    }
    if (!ranked.length && !inflects) {
      // The spelling is a word the dictionary reads another way (白蓮《しらはす》, which JMdict has as びゃくれん): that word.
      ranked = this.rank(w.lemma, undefined, w.cls, w.ctype).filter((r) => r.kanji >= 0 && !/[SR]/.test(r.e.kanji[r.kanji].flags) && !fringeOrName(r.e) && r.score > 0);
    }
    if (!ranked.length && !inflects && kanji.length >= 2 && w.lemma === w.text && kanji.length === [...w.text].length && !(w.morphemes.length === 1 && w.morphemes[0].known)) {
      // Another spelling of a word read the same way, as long and sharing at least half its kanji in place: 商買 is 商売
      // "business", 源因 原因, 楷子段 梯子段. (Not where the analyzer knows the spelling as a word of its own: 洛陽, the city,
      // is no 落陽 "setting sun".)
      const chars = [...w.text];
      ranked = this.rank(reading, undefined, 'noun', '').filter((r) => !fringeOrName(r.e) && r.e.kanji.some((f) => {
        const fc = [...f.text];
        return fc.length === chars.length && fc.filter((c, i) => c === chars[i]).length * 2 >= chars.length;
      }));
      for (const r of ranked) r.read = true;
    }
    if (!ranked.length && !inflects && kanji.length >= 2 && w.lemma === w.text) {
      // Two kanji or more that begin a word read the same way (数限《かずかぎり》もない: 数限りない "countless"). One kanji
      // would say little: 清《きよ》 begins 清い and 清らか, and is a name.
      const lr = looseReading(reading);
      ranked = this.prefixEntries(w.lemma, lr);
    }
    return ranked;
  }

  /** Entries with a kanji form that starts with `form` and a reading that starts with `reading` (loose), common first. */
  private prefixEntries(form: string, reading: string): Ranked[] {
    const out: Ranked[] = [];
    for (const head of this.jm.formsStartingWith(form, 400)) {
      // Only okurigana after: 数限 + りない, not 洛陽 + の紙価を高める.
      if (hasKanji(head.slice(form.length))) continue;
      for (const r of this.rank(head, undefined, undefined, '')) {
        if (r.kanji < 0 || out.some((x) => x.e.id === r.e.id)) continue;
        const k = r.kanji;
        if (!r.e.kana.some((f) => (!f.only || f.only.includes(k)) && looseReading(f.text).startsWith(reading))) continue;
        r.read = true;
        out.push(r);
      }
    }
    return out.sort((x, y) => y.score - x.score).slice(0, 4);
  }

  /** A new book: the names the last one printed readings for are forgotten (清 is Kiyo only in 坊っちゃん). */
  beginBook(): void {
    this.printedNames.clear();
    this.printedByFirst.clear();
    this.normCache.clear();
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
    const printed = token?.ruby?.some((p) => p.rt) && token.reading ? token.ruby : undefined;
    if (ws.length !== 1) {
      // A name the book printed a reading over is one word only in its sentence (杜子春 is 杜|子|春 to the analyzer alone).
      if (!printed || !token?.reading) return undefined;
      return {
        start: 0, end: text.length, text, morphemes: ws.flatMap((x) => x.morphemes), lemma: token.lemma ?? text, reading: token.reading,
        lemmaReading: (token.lemma ?? text) === text ? token.reading : '', pieces: [{ text, reading: token.reading }], forms: [], cls: 'noun',
        ctype: '', unknown: true, printed: printed.map((p) => ({ ...p })), name: token.name ? 'proper' : undefined,
      };
    }
    const w = ws[0];
    this.resolveReading(w);
    this.resolvePotential(w);
    if (token?.reading && token.reading !== w.reading) {
      // Trust the reading the token was shown with; it came from the sentence (or the book printed it: 明後日 あさって).
      w.reading = token.reading;
      if (token.lemma === token.text) w.lemmaReading = token.reading;
      if (printed && token.lemma === token.text) w.printed = printed.map((p) => ({ ...p }));
    }
    if (token && token.name !== (w.name ? true : undefined)) w.name = token.name ? w.name ?? 'proper' : undefined;
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
    if (w.text !== w.lemma && hasKanji(w.text) === hasKanji(w.lemma) && w.cls !== 'particle') {
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
    // A name the dictionary does not read the way the page does (清 きよ, not the Qing dynasty しん): the name, and only the
    // entries read as it is.
    if (w.name && !good.some((r) => r.read)) {
      res.name = true;
      const same = entries.filter((e) => w.reading && e.reading && looseReading(e.reading) === looseReading(w.reading));
      res.entries = [{ head: w.text, reading: w.reading || undefined, senses: [{ glosses: [NAME_GLOSS[w.name]] }], source: 'name' }, ...same];
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
    let de = [...this.deinflected(text)];
    if (exact.length && !exact.some((r) => r.e.common) && de.some((d) => d.r.e.common)) {
      de = [...de.filter((d) => d.r.e.common), ...de.filter((d) => !d.r.e.common)];
      // The exact entries follow the common inflections.
      const later = exact;
      exact = [];
      de.push(...later.map((r) => ({ term: text, forms: [], r })));
    }
    return { exact, de };
  }

  private deinflectCache = new Map<string, readonly { term: string; forms: string[]; r: Ranked }[]>();

  /** Dictionary forms `text` can be an inflection of, each with the entries that fit, best first (kept: the okurigana repairs ask again). */
  private deinflected(text: string): readonly { term: string; forms: string[]; r: Ranked }[] {
    const cached = this.deinflectCache.get(text);
    if (cached) return cached;
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
    if (this.deinflectCache.size > 5000) this.deinflectCache.clear();
    this.deinflectCache.set(text, out);
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
    const want = w?.cls === 'particle' ? particleSense(w.lemma, w.morphemes[0]?.pos1 ?? '', w.morphemes[0]?.pos2 ?? '') : undefined;
    let order = want ? [...e.senses.filter((x) => want.test(x.glosses.join('; ') + ' ' + x.notes.join('; '))), ...e.senses.filter((x) => !want.test(x.glosses.join('; ') + ' ' + x.notes.join('; ')))] : e.senses;
    // Any other word: the senses of the part of speech it has on the page first, in JMdict's order (ただ the adverb is
    // "only", not "ordinary"; 非常 before に is "extreme", not "emergency").
    const fits = !want && w ? CLASS_POS[w.cls] : undefined;
    if (fits) {
      const yes = order.filter((x) => x.tags.some((t) => fits.has(t)));
      if (yes.length && yes.length < order.length) order = [...yes, ...order.filter((x) => !yes.includes(x))];
    }
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
    // A name says nothing over it unless the dictionary has it read so (東京 "Tokyo"; 清 is no "Qing dynasty").
    if (w.name && !ranked[0].read) return undefined;
    const e = this.toEntry(ranked[0], w.lemma, w);
    return shortGloss(e.senses[0]?.glosses[0]);
  }
}

/** The JMdict parts of speech a sense has when it is used as the word class IPADIC gave the word on the page. */
const CLASS_POS: Partial<Record<WordClass, ReadonlySet<string>>> = {
  adverb: new Set(['adv', 'adv-to']), conj: new Set(['conj']), adjna: new Set(['adj-na']), noun: new Set(['n', 'n-adv', 'n-t', 'adj-no']),
  pronoun: new Set(['pn']), prenoun: new Set(['adj-pn']), interj: new Set(['int']), adj: new Set(['adj-i', 'adj-ix']),
  counter: new Set(['ctr']), suffix: new Set(['suf', 'n-suf']), prefix: new Set(['pref', 'n-pref']), aux: new Set(['aux-v', 'aux', 'cop', 'aux-adj']),
};

/** Which sense of a particle IPADIC's subclass points to, as a pattern over the sense's glosses and notes. */
const PARTICLE_SENSES: Record<string, [string, RegExp][]> = {
  と: [['並立助詞', /^and\b/], ['格助詞,引用', /quot/], ['格助詞', /^with\b/], ['接続助詞', /^(if|when)\b/]],
  が: [['格助詞', /subject/], ['接続助詞', /^but\b/]],
  から: [['格助詞', /^from\b/], ['接続助詞', /^because\b/]],
  の: [['連体化', /possessive/], ['終助詞', /question/], ['非自立', /nominaliz/]],
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
