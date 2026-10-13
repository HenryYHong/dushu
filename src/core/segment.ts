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
    for (const cand of words) {
      const fromLexicon = cand.startsWith(LEX_PREFIX);
      const w = fromLexicon ? cand.slice(LEX_PREFIX.length) : cand;
      const end = pos + w.length;
      if (end > b) continue;
      const f = dict.freq(w);
      const own = fromLexicon ? Math.max(LEXICON_WEIGHT, Math.log(f + 1)) : f === 0 && !isSingleCodePoint(w) ? -UNSEEN_WORD_PENALTY : Math.log(f + 1);
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
    tok.pinyin = dict.pinyinFor(tok.text, { prev: tokens[t - 1]?.text, next: tokens[t + 1]?.text });
  }
  return tokens;
}
