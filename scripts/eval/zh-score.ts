// Word-segmentation and reading benchmarks through the reader's path: gold sets with one sentence per line and words
// separated by single spaces (SIGHAN 2005, UD Chinese, ZX), and CPP (one marked character per sentence, its gold reading in
// a parallel file). Used by tests/corpus/ud.test.ts (UD, in CI) and scripts/eval/zh-bench.run.ts (the restricted sets, locally).
import { detectScript } from '../../src/core/text';
import { inScript, segmentShown } from '../../src/ui/reader/shown';
import type { Dictionary, Lexicon, Token } from '../../src/types';
import { bookLexicon } from './zh-shown';

export type Mode = 'dict' | 'book';

/**
 * Each line cut as the reader cuts it, in the set's own characters (tokens joined by one space). 'dict' reads every line on
 * its own with no names; 'book' reads the set as one uploaded book: names are detected over chapters of 50 lines.
 */
export function segmentLines(lines: string[], dict: Dictionary, mode: Mode): { seg: string[]; pinyin: string[]; tokens: Token[][] } {
  const script = detectScript(lines.join('\n').slice(0, 400000));
  const shown = lines.map((l) => inScript(l, 'simplified', dict, script));
  let lexicon: Lexicon | undefined;
  if (mode === 'book') {
    const chapters: string[] = [];
    for (let i = 0; i < lines.length; i += 50) chapters.push(lines.slice(i, i + 50).join('\n'));
    lexicon = bookLexicon(chapters, dict, 'simplified', script).lexicon;
  }
  const seg: string[] = [];
  const pinyin: string[] = [];
  const tokens: Token[][] = [];
  lines.forEach((line, i) => {
    const toks = segmentShown(shown[i], line, dict, lexicon);
    tokens.push(toks);
    seg.push(toks.map((t) => line.slice(t.start, t.end)).join(' '));
    pinyin.push(toks.map((t) => (t.kind === 'han' ? (t.pinyin ?? []).join('-') || '?' : '_')).join(' '));
  });
  return { seg, pinyin, tokens };
}

/**
 * F1 of exact word spans, and the crossing rate: the share of the system's tokens that are wrong under any granularity (a
 * gold boundary falls strictly inside the token and the token is not a run of whole gold words). Percent. Lines whose
 * characters differ from the gold line are skipped and counted.
 */
export function scoreSegmentation(gold: string[], sys: string[]): { f1: number; cross: number; tokens: number; mismatched: number } {
  let tp = 0, ng = 0, ns = 0, cross = 0, bad = 0;
  const spans = (line: string) => {
    const out: [number, number][] = [];
    let i = 0;
    for (const w of line.split(' ')) { if (!w) continue; out.push([i, i + w.length]); i += w.length; }
    return out;
  };
  gold.forEach((g, k) => {
    const s = sys[k] ?? '';
    if (!g) return;
    if (g.replace(/ /g, '') !== s.replace(/ /g, '')) { bad++; return; }
    const gs = spans(g);
    const ss = spans(s);
    const gset = new Set(gs.map(([a, b]) => `${a},${b}`));
    const gb = new Set<number>();
    for (const [a, b] of gs) { gb.add(a); gb.add(b); }
    for (const [a, b] of ss) if (gset.has(`${a},${b}`)) tp++;
    ng += gs.length;
    ns += ss.length;
    for (const [a, b] of ss) {
      if (gb.has(a) && gb.has(b)) continue;
      for (let x = a + 1; x < b; x++) if (gb.has(x)) { cross++; break; }
    }
  });
  const p = tp / ns;
  const r = tp / ng;
  return { f1: (200 * p * r) / (p + r), cross: (100 * cross) / ns, tokens: ns, mismatched: bad };
}

/** A gold file's sentences: lines of words separated by single spaces; lines starting with "#" are comments. */
export function goldLines(text: string): string[] {
  return text.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/).join(' '));
}

export interface CppItem { text: string; at: number; gold: string }

/** CPP: sentences with the target character between two U+2581 marks, and one gold reading per line. */
export function cppItems(sentences: string, labels: string): CppItem[] {
  const ss = sentences.split('\n');
  const ls = labels.split('\n');
  const out: CppItem[] = [];
  ss.forEach((s, i) => {
    const gold = ls[i]?.trim();
    if (!s || !gold) return;
    const at = s.indexOf('\u2581');
    out.push({ text: s.replace(/\u2581/g, ''), at, gold: gold.replace(/u:/g, 'v').replace(/ü/g, 'v') });
  });
  return out;
}

/** CPP accuracy (percent, strict: syllable and tone) over all items and over items whose token is one character. */
export function scoreCpp(items: CppItem[], dict: Dictionary, mode: Mode): { strict: number; single: number; n: number; nSingle: number } {
  const { tokens } = segmentLines(items.map((x) => x.text), dict, mode);
  let ok = 0, okSingle = 0, nSingle = 0;
  items.forEach((x, i) => {
    const t = tokens[i].find((t) => t.start <= x.at && x.at < t.end);
    let got = '?';
    if (t && t.pinyin) got = (t.pinyin[[...x.text.slice(t.start, x.at)].length] ?? '?').toLowerCase().replace(/u:/g, 'v').replace(/ü/g, 'v');
    const single = !!t && [...t.text].length === 1;
    if (got === x.gold) ok++;
    if (single) { nSingle++; if (got === x.gold) okSingle++; }
  });
  return { strict: (100 * ok) / items.length, single: (100 * okSingle) / Math.max(1, nSingle), n: items.length, nSingle };
}

/** PLAN §3 tolerances: crossing may rise at most 0.03 points, F1 fall at most 0.3; CPP strict fall at most 0.2, one-character not at all. */
export const TOLERANCE = { cross: 0.03, f1: 0.3, cppStrict: 0.2, cppSingle: 0 };

export const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
