// Segmentation of a paragraph into tokens. Contract: ARCHITECTURE.md §4.2.
//
// Han runs are cut with the jieba method: build the DAG of dictionary words over the run and take the path with
// the highest total log-probability. Everything else is split by character class.
import type { Dictionary, Token, TokenKind, Lexicon } from '../types';
import { isHanCodePoint } from './text';

/** Used when the dictionary does not report the corpus size (jieba dict.txt.big). */
const DEFAULT_TOTAL = 83_170_339;
/**
 * Score cost (in nats, below the weakest possible corpus word) of a multi-character word that CC-CEDICT or the
 * Wiktionary supplement lists but the jieba corpus never saw. Such words still beat a run of unseen characters
 * (idioms, rare compounds) but lose to a split into common words ("我|不|知道" over "我不知道").
 * Chosen on the gold sets in tests/core/gold.ts.
 */
const UNSEEN_WORD_PENALTY = 4;
/** Score (nats) of a lexicon word: about a million occurrences, like 我们 or 因为. */
const LEXICON_WEIGHT = 14;
/** Marks a candidate that came from the lexicon, so a word in both places is not scored twice. */
const LEX_PREFIX = '\u0000';

type Cls = 'han' | 'latin' | 'num' | 'punct' | 'space' | 'other' | 'mark';

const LATIN_RE = /^\p{Script=Latin}$/u;
const MARK_RE = /^\p{M}$/u;
const DIGIT_RE = /^\p{Nd}$/u;
const SPACE_RE = /^\s$/u;
const PUNCT_RE = /^[\p{P}\p{Sm}\p{Sc}\p{Sk}]$/u;

const clsCache = new Map<number, Cls>();

function classify(cp: number): Cls {
  if (cp < 128) {
    if ((cp >= 48 && cp <= 57)) return 'num';
    if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) return 'latin';
    if (cp === 32 || (cp >= 9 && cp <= 13)) return 'space';
    if (cp < 32 || cp === 127) return 'other';
    return 'punct';
  }
  if (isHanCodePoint(cp)) return 'han';
  let c = clsCache.get(cp);
  if (c) return c;
  const ch = String.fromCodePoint(cp);
  if (SPACE_RE.test(ch)) c = 'space';
  else if (DIGIT_RE.test(ch)) c = 'num';
  else if (LATIN_RE.test(ch)) c = 'latin';
  else if (MARK_RE.test(ch)) c = 'mark';
  else if (PUNCT_RE.test(ch) || (cp >= 0xff01 && cp <= 0xff0f) || (cp >= 0xff1a && cp <= 0xff20) || (cp >= 0xff3b && cp <= 0xff40) || (cp >= 0xff5b && cp <= 0xff65)) c = 'punct';
  else c = 'other';
  if (clsCache.size < 5000) clsCache.set(cp, c);
  return c;
}

const KIND: Record<Exclude<Cls, 'mark'>, TokenKind> = {
  han: 'han', latin: 'latin', num: 'num', punct: 'punct', space: 'space', other: 'other',
};

function cpAt(text: string, i: number): { cp: number; len: number } {
  const cp = text.codePointAt(i)!;
  return { cp, len: cp > 0xffff ? 2 : 1 };
}

function isSingleCodePoint(w: string): boolean {
  return w.length === 1 || (w.length === 2 && w.charCodeAt(0) >= 0xd800 && w.charCodeAt(0) <= 0xdbff);
}

/** Bonus (nats) that keeps 一一 together. */
const ONE_ONE_BONUS = 6;
const NUMERAL_BEFORE_ZHI = '一二三四五六七八九十两兩几幾';
/** Characters that spell a year digit by digit (一九一八年): such a run is one token, not the dictionary's 九一八. */
const YEAR_DIGITS = '〇零一二三四五六七八九';
const ORDINAL_DIGITS = '〇零一二三四五六七八九十百千兩两';
/** After a number, 多 belongs to the number (三十多年 is 三十多 + 年, not 三十 + 多年 "many years"). */
const NUMERAL_BEFORE_DUO = '十百千萬万二三四五六七八九〇零';
const AFTER_DUO = '年歲岁天日月次人回遍斤里位个個';
/**
 * Words the dictionary has that a reader of the old novels and the classics almost never means; where they appear the text is
 * two words (他用船 is 他 + 用 + 船, 但聞人語響 is 聞 + 人語, 驚的士奇 is 驚 + 的 + 士奇). Each loses 8 nats.
 */
const UNLIKELY_WORDS: ReadonlySet<string> = new Set(['他用', '聞人', '闻人', '的士', '先見', '先见', '報上', '报上', '與非', '与非']);
/** Words after which 了得 is liǎode "remarkable" (十分了得, 武藝了得, 還了得), not 了 le + 得. */
const BEFORE_LIAODE = ['十分', '好生', '端的', '還', '还', '英雄', '武藝', '武艺', '真個', '真个', '恁地', '恁般', '如此'];

/** AABB or ABAB at `pos` built from a two-character dictionary word AB, with the score it gets as one token. */
function reduplication(text: string, pos: number, b: number, dict: Dictionary): { word: string; score: number } | null {
  if (pos + 4 > b) return null;
  const c0 = text.charCodeAt(pos);
  if (c0 < 0x3400 || c0 > 0x9fff) return null; // BMP ideographs only: the pairs this is for are common characters
  const c1 = text.charCodeAt(pos + 1);
  const c2 = text.charCodeAt(pos + 2);
  const c3 = text.charCodeAt(pos + 3);
  let ab = '';
  if (c0 === c1 && c2 === c3 && c0 !== c2) ab = text[pos] + text[pos + 2];
  else if (c0 === c2 && c1 === c3 && c0 !== c1) ab = text.slice(pos, pos + 2);
  else return null;
  if (!dict.hasWord(ab)) return null;
  // As likely as the base word, but never less than an ordinary seen word, so it beats the cut into 吆|吆喝|喝.
  return { word: text.slice(pos, pos + 4), score: Math.max(Math.log(dict.freq(ab) + 1), 1) };
}

/** Segment one Han run text[a, b) with the max-probability DAG path; returns the cut points (end offsets). */
function cutRun(text: string, a: number, b: number, dict: Dictionary, logTotal: number, lexicon?: Lexicon): number[] {
  const lexMax = lexicon && lexicon.maxLen >= 2 ? lexicon.maxLen : 0;
  const size = b - a;
  const score = new Float64Array(size + 1);
  const count = new Int32Array(size + 1);
  const next = new Int32Array(size + 1);
  for (let pos = b - 1; pos >= a; pos--) {
    const c = text.charCodeAt(pos);
    if (c >= 0xdc00 && c <= 0xdfff) continue; // second half of a surrogate pair
    let bestScore = -Infinity;
    let bestCount = 0;
    let bestEnd = pos + 1;
    let words = dict.wordsAt(text, pos);
    if (lexMax) {
      words = words.slice();
      // Names and terms of the book are candidates too, scored like a very frequent word so they win against a
      // split into the dictionary words their characters happen to form.
      let end = pos;
      for (let k = 1; k <= lexMax && end < b; k++) {
        end += text.codePointAt(end)! > 0xffff ? 2 : 1;
        if (k >= 2 && end <= b) {
          const sub = text.slice(pos, end);
          if (lexicon!.has(sub)) words.push(LEX_PREFIX + sub);
        }
      }
    }
    // An ordinal (第七十八回, 第一百零八回): 第 and the whole run of numerals after it are one token, not 第七 + 十八.
    if (text[pos] === '第') {
      let e = pos + 1;
      while (e < b && ORDINAL_DIGITS.includes(text[e])) e++;
      if (e - pos >= 3 && e <= b) words = [...words, LEX_PREFIX + text.slice(pos, e)];
    }
    // A year written in digits (一九一八年): the whole run is one word, whatever the dictionary has inside it.
    if (YEAR_DIGITS.includes(text[pos]) && (pos === a || !YEAR_DIGITS.includes(text[pos - 1]))) {
      let e = pos;
      while (e < b && YEAR_DIGITS.includes(text[e])) e++;
      if (e - pos >= 3 && text[e] === '年' && e <= b) words = [...words, LEX_PREFIX + text.slice(pos, e)];
    }
    // Reduplicated words: 吆吆喝喝 (AABB from 吆喝) and 研究研究 (ABAB from 研究) are one word each, though no list has them.
    const redup = reduplication(text, pos, b, dict);
    if (redup && !words.includes(redup.word)) { words = words.slice(); words.push(redup.word); }
    for (const cand of words) {
      const fromLexicon = cand.startsWith(LEX_PREFIX);
      const w = fromLexicon ? cand.slice(LEX_PREFIX.length) : cand;
      const end = pos + w.length;
      if (end > b) continue;
      const f = dict.freq(w);
      let own = fromLexicon ? Math.max(LEXICON_WEIGHT, Math.log(f + 1)) : f === 0 && !isSingleCodePoint(w) ? -UNSEEN_WORD_PENALTY : Math.log(f + 1);
      if (redup && w === redup.word && !dict.hasWord(w)) own = redup.score;
      // 一一 (one by one) is a word of its own: 一一应 is 一一 + 应, not 一 + 一应.
      if (w === '一一') own += ONE_ONE_BONUS;
      // 一只用: the 只 after a numeral is a measure word, so a word that starts with it (只用) is cut after it.
      if (w.length >= 2 && w[0] === '只' && pos > a && NUMERAL_BEFORE_ZHI.includes(text[pos - 1])) own -= 12;
      // 垂著手 睜著眼 擎著法環: 著 after a verb is the aspect particle; 著手 著眼 著想 著力 著重 are words only where nothing
      // verb-like comes before them (要著手, 先著眼). 站著作什麼 is 站著 + 作什麼, not 著作.
      if (w.length >= 2 && w[0] === '著' && pos > a && !'要先才須须應应宜當当將将能可便正又再從从由已即'.includes(text[pos - 1]) && '手眼想力重'.includes(w[1])) own -= 12;
      if (w === '著作' && '什甚啥'.includes(text[pos + 2] ?? '')) own -= 12;
      if (w.length === 2 && UNLIKELY_WORDS.has(w)) own -= 8;
      // 屋里面 家里头 心里边: the noun and 里面 (里头, 里边); the noun + 里 is not a word followed by a stray 面.
      if (w.length === 2 && '里裡裏'.includes(w[1]) && '面边邊头頭'.includes(text[end] ?? '')) own -= 4;
      // 三十多年才能輪到: 才能 after a time word is 才 + 能 (not the noun "talent").
      if (w === '才能' && pos > a && '年月日天時时次回歲岁'.includes(text[pos - 1])) own -= 12;
      // 有一行字: a line of writing (一 + 行 háng + 字), not the travelling party 一行 (yìxíng) of 一行人.
      if (w === '一行' && text[end] === '字') own -= 12;
      // 背著 is bēi (carrying) by default (WORD_READINGS); turned away from (背著臉), behind someone's back (偷背著我們, 背著人) and
      // 倒背著兩手 are bèi: cut there, and 背 alone keeps its bèi.
      if ((w === '背著' || w === '背着') && ('臉脸人眾众'.includes(text[end] ?? '') || (pos > a && '偷倒'.includes(text[pos - 1])))) own -= 12;
      // 那還了得！ 好生了得: 了得 (liǎode) ends its clause or follows a word of praise; 了 and 得 are so common they would split it.
      // A longer dictionary word that ends in it (這還了得) is left to win on its own.
      if (w === '了得' && (end === b || BEFORE_LIAODE.some((p) => pos - p.length >= a && text.startsWith(p, pos - p.length)))
        && ![1, 2, 3].some((k) => pos - k >= a && dict.hasWord(text.slice(pos - k, end)))) own += 8;
      // 三十多年: the 多 goes with the number.
      if (w.length >= 2 && w[0] === '多' && pos > a && NUMERAL_BEFORE_DUO.includes(text[pos - 1]) && AFTER_DUO.includes(w[1])) own -= 12;
      const s = own - logTotal + score[end - a];
      const k = count[end - a] + 1;
      if (s > bestScore + 1e-9 || (Math.abs(s - bestScore) <= 1e-9 && k < bestCount)) {
        bestScore = s;
        bestCount = k;
        bestEnd = end;
      }
    }
    score[pos - a] = bestScore;
    count[pos - a] = bestCount;
    next[pos - a] = bestEnd;
  }
  const cuts: number[] = [];
  for (let pos = a; pos < b; pos = next[pos - a]) cuts.push(next[pos - a]);
  return cuts;
}

/**
 * Split `text` into tokens that cover it exactly (concatenating every token's text gives `text`).
 * Han tokens carry numbered pinyin per code point from dict.pinyinFor, with the neighbouring tokens as context.
 */
export function segment(text: string, dict: Dictionary, lexicon?: Lexicon): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  const total = dict.meta?.counts?.wordTotal || DEFAULT_TOTAL;
  const logTotal = Math.log(total);
  let i = 0;
  const push = (start: number, end: number, kind: TokenKind) => {
    tokens.push({ text: text.slice(start, end), start, end, kind, inDict: false });
  };
  while (i < n) {
    const { cp, len } = cpAt(text, i);
    const cls = classify(cp);
    if (cls === 'han') {
      let j = i + len;
      while (j < n) {
        const nx = cpAt(text, j);
        if (classify(nx.cp) !== 'han') break;
        j += nx.len;
      }
      let from = i;
      for (const end of cutRun(text, i, j, dict, logTotal, lexicon)) {
        push(from, end, 'han');
        from = end;
      }
      i = j;
      continue;
    }
    if (cls === 'punct') { push(i, i + len, 'punct'); i += len; continue; }
    // Runs of the same class; marks stay with the character they follow.
    let j = i + len;
    while (j < n) {
      const nx = cpAt(text, j);
      const c2 = classify(nx.cp);
      if (c2 === 'mark' && cls !== 'space') { j += nx.len; continue; }
      if (c2 === cls) { j += nx.len; continue; }
      // Joiners inside words and numbers: don't, well-known, 3.14, 1,000
      if (cls === 'latin' && (nx.cp === 39 || nx.cp === 0x2019 || nx.cp === 45) && j + 1 < n && classify(text.codePointAt(j + 1)!) === 'latin') { j += 1; continue; }
      if (cls === 'num' && (nx.cp === 46 || nx.cp === 44) && j + 1 < n && classify(text.codePointAt(j + 1)!) === 'num') { j += 1; continue; }
      break;
    }
    push(i, j, cls === 'mark' ? 'other' : KIND[cls]);
    i = j;
  }
  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    if (tok.kind !== 'han') continue;
    tok.inDict = dict.hasWord(tok.text);
    const entry = lexicon && [...tok.text].length >= 2 ? lexicon.get(tok.text) : undefined;
    const given = entry?.pinyin ? entry.pinyin.split(' ') : undefined;
    if (given && given.length === [...tok.text].length && given.every(Boolean)) {
      tok.pinyin = given;
      continue;
    }
    // `next` is '' (known to be nothing) at the end of a paragraph, not undefined: a 地 that ends a line is a noun.
    tok.pinyin = dict.pinyinFor(tok.text, { prev: tokens[t - 1]?.text, next: tokens[t + 1]?.text ?? '', after: tokens[t + 2]?.text });
  }
  return tokens;
}
