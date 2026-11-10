// The words of one chapter, counted: what the reader's Words tab lists. Pure (no DOM, no store): the tab decides which
// words are known. The chapter is segmented the way the reader draws it (same dictionary, same names and terms), in
// slices with a pause between them, so a long chapter never holds up the page. ARCHITECTURE.md 5.3.
import type { Dictionary, Lexicon } from '../types';
import { segment } from './segment';
import { applyFixes, type HereFix } from './fixes';
import { sentenceAround as sentenceSpan } from './text';
import { isWord } from '../lang/token';
import { lang } from '../lang/active';

export interface ChapterWord {
  /** The counting form (simplified): one row per word, whichever script the chapter is shown in. */
  key: string;
  /** The word as the chapter shows it (its first spelling there). */
  word: string;
  /** Times it occurs in the chapter. */
  count: number;
  /** Numbered pinyin of its most common reading in this chapter, one syllable per character. */
  pinyin: string[];
  /** The sentence of its first occurrence, for the word card and a saved word's flashcard. */
  sentence: string;
  /** The text just before and after that occurrence (polyphones read by their neighbours). */
  prev: string;
  next: string;
  /** Where it first occurs, as a count of the chapter's words before it. */
  first: number;
}

export interface ChapterWords {
  words: ChapterWord[];
  /** Word occurrences counted (the book's names and terms are left out). */
  total: number;
  /** Occurrences of the book's names and terms, which the Names & terms tab lists instead. */
  names: number;
}

const CLAUSE_END = '，、：,:';
/** Chinese and Japanese: a sentence longer than this is cut down to the clause around the word. */
const LONG_SENTENCE = 90;
/** With spaces between words the sentence is kept whole (the screens shorten it for show), up to this many characters. */
const LONG_SPACED = 400;
/** Characters segmented between pauses. */
const SLICE_CHARS = 6000;

/**
 * The sentence around [start, end) in `text`, found the way the word card finds it (core/text.ts), so a word saved from the
 * Words tab and one saved from the card keep the same sentence. Without spaces between words (`spaced` false) a long one is
 * cut down to the clause around the word. With spaces, it is kept whole unless it is very long; then it is cut between
 * words, with … where it was cut.
 */
export function sentenceAround(text: string, start: number, end: number, spaced = false): string {
  const sp = sentenceSpan(text, start);
  let a = Math.min(sp.start, start);
  let b = Math.max(sp.end, end);
  if (spaced) {
    if (b - a <= LONG_SPACED) return text.slice(a, b).trim();
    const half = (LONG_SPACED - (end - start)) / 2;
    let ca = Math.max(a, Math.floor(start - half));
    let cb = Math.min(b, Math.ceil(end + half));
    // Never inside a word: move each cut in to the nearest space.
    while (ca > a && ca < start && !/\s/.test(text[ca - 1])) ca++;
    while (cb < b && cb > end && !/\s/.test(text[cb])) cb--;
    const out = text.slice(ca, cb).trim();
    return `${ca > a ? '… ' : ''}${out}${cb < b ? ' …' : ''}`;
  }
  if (b - a > LONG_SENTENCE) {
    let ca = start;
    while (ca > a && start - ca < LONG_SENTENCE / 2 && !CLAUSE_END.includes(text[ca - 1])) ca--;
    let cb = end;
    while (cb < b && cb - end < LONG_SENTENCE / 2 && !CLAUSE_END.includes(text[cb])) cb++;
    if (cb < b) cb++;
    a = ca;
    b = cb;
  }
  return text.slice(a, b).trim();
}

export interface ChapterWordsOptions {
  /** Stop early (the tab moved on to another chapter): resolves with what was counted so far. */
  cancelled?(): boolean;
  /** Pause between slices; the default gives the page a turn. */
  pause?(): Promise<void>;
  /** The reader's "here only" fixes placed in the `i`-th text (core/fixes.ts); the lexicon carries the others. */
  here?(i: number): readonly HereFix[] | undefined;
}

const pauseForPage = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Count the words of a chapter's paragraphs (`texts`, as the reader shows them). */
export async function chapterWords(texts: readonly string[], dict: Dictionary, lexicon?: Lexicon, opts: ChapterWordsOptions = {}): Promise<ChapterWords> {
  const pause = opts.pause ?? pauseForPage;
  const spaced = lang().spaced;
  const byKey = new Map<string, ChapterWord & { readings: Map<string, number> }>();
  let total = 0;
  let names = 0;
  let sinceBreak = 0;
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;
    if (sinceBreak > SLICE_CHARS) {
      sinceBreak = 0;
      await pause();
      if (opts.cancelled?.()) break;
    }
    sinceBreak += text.length;
    let tokens;
    try {
      tokens = segment(text, dict, lexicon);
      // As the page cuts and reads them once the reader has fixed them.
      if (lexicon?.fixes || opts.here) tokens = applyFixes(tokens, text, dict, lexicon?.fixes, opts.here?.(i), lexicon);
    } catch { continue; }
    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (!isWord(tok)) continue;
      if (lexicon?.has(tok.text) || tok.name) { names++; continue; }
      // Another language's word is counted under its dictionary form (fuimos and fue are one word, ir), shown as that form.
      const other = tok.kind === 'word';
      const key = other ? tok.key || tok.text : dict.toSimplified(tok.text) || tok.text;
      const reading = other ? '' : (tok.pinyin ?? []).join(' ');
      let row = byKey.get(key);
      if (!row) {
        row = {
          key, word: other ? tok.lemma || tok.text : tok.text, count: 0, pinyin: other ? [] : tok.pinyin ?? [], first: total,
          sentence: sentenceAround(text, tok.start, tok.end, spaced),
          prev: tokens[t - 1]?.text ?? '', next: tokens[t + 1]?.text ?? '',
          readings: new Map(),
        };
        byKey.set(key, row);
      }
      row.count++;
      row.readings.set(reading, (row.readings.get(reading) ?? 0) + 1);
      total++;
    }
  }
  const words: ChapterWord[] = [];
  for (const { readings, ...row } of byKey.values()) {
    let best = '';
    let most = -1;
    for (const [r, n] of readings) if (n > most) { best = r; most = n; }
    words.push({ ...row, pinyin: best ? best.split(' ') : row.pinyin });
  }
  return { words, total, names };
}

export interface WordShare {
  /** Word occurrences that are known, of `total`. */
  known: number;
  total: number;
  /** Different words not known yet, and how many of those occur at least `often` times. */
  fresh: number;
  freshOften: number;
}

/** How much of the chapter is known: by occurrence (what reading it feels like) and by different words. */
export function wordShare(list: ChapterWords, isKnown: (w: ChapterWord) => boolean, often = 3): WordShare {
  let known = 0;
  let fresh = 0;
  let freshOften = 0;
  for (const w of list.words) {
    if (isKnown(w)) known += w.count;
    else {
      fresh++;
      if (w.count >= often) freshOften++;
    }
  }
  return { known, total: list.total, fresh, freshOften };
}
