// Chinese evaluation pipeline: a book or text read through the reader's own path, the way the page shows it.
//
// Import (src/import), the book's names (core/lexicon detectTerms over the chapters' paragraphs and quotes, as
// core/lexicon.ts bookTexts feeds it), the script conversion and the word cutting with readings taken from the book's own
// characters (ui/reader/shown.ts inScript, lexiconInScript, segmentShown), with the display set to simplified unless asked
// otherwise. Used by scripts/eval/zh-dump.run.ts (dumps for audits and zh-diff.py), scripts/eval/zh-bench.run.ts and the
// corpus tests in tests/corpus/. Nothing here prints book text; callers decide where output goes.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { loadDictionary } from '../../src/core/dict';
import { detectTerms, mergeLexicon } from '../../src/core/lexicon';
import { importFile } from '../../src/import';
import { inScript, lexiconInScript, segmentShown, type ScriptMode } from '../../src/ui/reader/shown';
import type { Chapter, Dictionary, Lexicon, LexiconEntry, Script, Token } from '../../src/types';

export const REPO_ROOT = join(__dirname, '..', '..');
export const DATA_DIR = join(REPO_ROOT, 'public', 'data');

/** The real dictionary from public/data, read from disk (the app fetches the same files). */
export function loadEvalDictionary(dataDir = DATA_DIR): Promise<Dictionary> {
  return loadDictionary('/', {
    fetchText: async (name: string) => {
      const file = /\.(gz|json)$/.test(name) ? name : name.replace(/(\.tsv)?$/, '.tsv.gz');
      const raw = await readFile(join(dataDir, file));
      return file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
    },
  });
}

/** One paragraph, heading or quote as the reader shows it. `key` is "chapter.block" (block index within the chapter). */
export interface ShownBlock {
  key: string;
  t: 'p' | 'h' | 'quote';
  /** The book's own text. */
  source: string;
  /** The text on the page (converted to the display script). Token offsets are into this string. */
  shown: string;
  tokens: Token[];
}

export interface ShownBook {
  script: Script;
  chapters: number;
  /** The names and terms detected in the book (as the book spells them). */
  found: LexiconEntry[];
  blocks: ShownBlock[];
  /** Han characters in Han tokens. */
  han: number;
}

/** The paragraphs and quotes of each chapter, one string per chapter: what the app's name detection reads. */
export function detectionTexts(chapters: Chapter[]): string[] {
  return chapters.map((c) => {
    const parts: string[] = [];
    for (const b of c.blocks) if ((b.t === 'p' || b.t === 'quote') && b.text) parts.push(b.text);
    return parts.join('\n');
  });
}

/** Detected names and terms of a book, converted for the page like the reader does. */
export function bookLexicon(chapterTexts: string[], dict: Dictionary, mode: ScriptMode, script: Script): { found: LexiconEntry[]; lexicon: Lexicon | undefined } {
  const found = detectTerms(chapterTexts, dict);
  return { found, lexicon: lexiconInScript(mergeLexicon([], found), mode, dict, script) };
}

/** Every text block of an imported book through the reader's path. */
export function shownChapters(chapters: Chapter[], script: Script, dict: Dictionary, mode: ScriptMode = 'simplified', opts: { names?: boolean } = {}): ShownBook {
  const { found, lexicon } = opts.names === false ? { found: [], lexicon: undefined } : bookLexicon(detectionTexts(chapters), dict, mode, script);
  const blocks: ShownBlock[] = [];
  let han = 0;
  chapters.forEach((c, ci) => {
    c.blocks.forEach((b, bi) => {
      if (!(b.t === 'p' || b.t === 'h' || b.t === 'quote') || !b.text) return;
      const shown = inScript(b.text, mode, dict, script);
      const tokens = segmentShown(shown, b.text, dict, lexicon, b.ruby);
      for (const t of tokens) if (t.kind === 'han') han += [...t.text].length;
      blocks.push({ key: `${ci}.${bi}`, t: b.t, source: b.text, shown, tokens });
    });
  });
  return { script, chapters: chapters.length, found, blocks, han };
}

/** A file (TXT, EPUB, MOBI/AZW3, PDF, HTML …) imported the way the app imports it, then read through the reader's path. */
export async function shownFile(name: string, bytes: Uint8Array, dict: Dictionary, mode: ScriptMode = 'simplified', opts: { names?: boolean } = {}): Promise<ShownBook & { title: string; author: string }> {
  const book = await importFile(new File([bytes as BlobPart], name));
  return { ...shownChapters(book.chapters, book.script, dict, mode, opts), title: book.title, author: book.author };
}

// ------------------------------------------------------------------------------------------------ dump format ---

/** Readings that are not "variant of" or surname-only entries. */
const NOT_A_READING = /^((old|unofficial|archaic|ancient|Japanese|erroneous) )*variant of|^surname\b|^\(archaic\)|^old variant/i;

/**
 * Which Han tokens get their reading written in seg.txt: a one-character token whose character has more than one reading, a
 * token outside the dictionary with such a character, or a dictionary word with more than one reading. full.txt writes every
 * reading. The rule is the audit dumps' (scratch dump.test.ts), so old dumps and new ones compare.
 */
export function readingNote(dict: Dictionary): (t: Token) => boolean {
  const polyChar = new Map<string, boolean>();
  const isPolyChar = (ch: string) => {
    let v = polyChar.get(ch);
    if (v === undefined) {
      const real = dict.lookup(ch).filter((e) => !NOT_A_READING.test(e.defs[0] ?? ''));
      v = new Set(real.map((e) => e.pinyin.toLowerCase())).size > 1;
      polyChar.set(ch, v);
    }
    return v;
  };
  const multi = new Map<string, boolean>();
  const multiReadingWord = (w: string) => {
    let v = multi.get(w);
    if (v === undefined) {
      v = new Set(dict.lookup(w).filter((e) => !/variant of|^surname\b/i.test(e.defs[0] ?? '')).map((e) => e.pinyin.toLowerCase())).size > 1;
      multi.set(w, v);
    }
    return v;
  };
  return (t: Token) => {
    if (t.kind !== 'han') return false;
    const chars = [...t.text];
    return (chars.length === 1 && isPolyChar(t.text)) || (!t.inDict && chars.some(isPolyChar)) || (t.inDict && chars.length > 1 && multiReadingWord(t.text));
  };
}

const py = (t: Token) => (t.pinyin ?? []).join(' ');

/**
 * The dump of one book, as the files the audits read: seg.txt (tokens joined by "|", readings of polyphonic tokens in
 * braces), full.txt (every Han token with its reading), lexicon.tsv, tokens.tsv, singles.tsv, pairs.tsv, readings.tsv.
 * Lines are "chapter.block<TAB>tokens". Same format as the audit-round dumps.
 */
export function dumpFiles(book: ShownBook, dict: Dictionary): Record<string, string> {
  const note = readingNote(dict);
  const seg: string[] = [];
  const full: string[] = [];
  const tokFreq = new Map<string, { n: number; inDict: boolean; readings: Map<string, number> }>();
  const pairs = new Map<string, { n: number; ctx: string[] }>();
  const reads = new Map<string, { n: number; ctx: string[] }>();
  for (const b of book.blocks) {
    const text = b.shown;
    const parts: string[] = [];
    const fparts: string[] = [];
    b.tokens.forEach((t, ti) => {
      if (t.kind !== 'han') { parts.push(t.text); fparts.push(t.text); return; }
      const p = py(t);
      const noted = note(t);
      parts.push(noted ? `${t.text}{${p}}` : t.text);
      fparts.push(`${t.text}{${p}}`);
      const f = tokFreq.get(t.text) ?? { n: 0, inDict: t.inDict, readings: new Map<string, number>() };
      f.n++; f.readings.set(p, (f.readings.get(p) ?? 0) + 1); tokFreq.set(t.text, f);
      const ctx = () => `${text.slice(Math.max(0, t.start - 8), t.start)}【${t.text}】${text.slice(t.end, t.end + 8)}`;
      if (noted) {
        const k = `${t.text}\t${p}`;
        const r = reads.get(k) ?? { n: 0, ctx: [] };
        r.n++; if (r.ctx.length < 4 && (r.n === 1 || r.n % 7 === 0)) r.ctx.push(ctx()); reads.set(k, r);
      }
      const nx = b.tokens[ti + 1];
      if (nx && nx.kind === 'han' && dict.hasWord(t.text + nx.text) && [...t.text].length + [...nx.text].length <= 4) {
        const k = `${t.text}|${nx.text}`;
        const pr = pairs.get(k) ?? { n: 0, ctx: [] };
        pr.n++; if (pr.ctx.length < 3 && (pr.n === 1 || pr.n % 5 === 0)) pr.ctx.push(`${text.slice(Math.max(0, t.start - 8), t.start)}【${t.text}|${nx.text}】${text.slice(nx.end, nx.end + 8)}`);
        pairs.set(k, pr);
      }
    });
    seg.push(`${b.key}\t${parts.join('|')}`);
    full.push(`${b.key}\t${fparts.join('|')}`);
  }
  const lines = (rows: string[]) => rows.join('\n') + '\n';
  return {
    'seg.txt': lines(seg),
    'full.txt': lines(full),
    'lexicon.tsv': lines(book.found.map((e) => [dict.toSimplified(e.word), e.kind ?? '', e.pinyin, e.count ?? '', (e.gloss ?? '').slice(0, 60)].join('\t'))),
    'tokens.tsv': '# token\tcount\tinDict\treadings\n' + lines([...tokFreq].filter(([w]) => [...w].length > 1).sort((a, b) => b[1].n - a[1].n)
      .map(([w, f]) => `${w}\t${f.n}\t${f.inDict ? 1 : 0}\t${[...f.readings].map(([r, n]) => `${r}:${n}`).join(', ')}`)),
    'singles.tsv': '# single-character token\tcount\treadings\n' + lines([...tokFreq].filter(([w]) => [...w].length === 1).sort((a, b) => b[1].n - a[1].n)
      .map(([w, f]) => `${w}\t${f.n}\t${[...f.readings].map(([r, n]) => `${r}:${n}`).join(', ')}`)),
    'pairs.tsv': '# adjacent tokens that together are a dictionary word (kept apart)\tcount\tcontexts\n' + lines([...pairs].sort((a, b) => b[1].n - a[1].n)
      .map(([k, p]) => `${k}\t${p.n}\t${p.ctx.join(' ／ ')}`)),
    'readings.tsv': '# token\treading\tcount\tcontexts\n' + lines([...reads].sort((a, b) => b[1].n - a[1].n)
      .map(([k, r]) => `${k}\t${r.n}\t${r.ctx.join(' ／ ')}`)),
  };
}

// --------------------------------------------------------------------------------------------- compact form ---
//
// A whole corpus's groupings and readings in a few hundred KB, for a baseline kept in the repository
// (tests/corpus/zh/shown-baseline.tsv). Lines:
//   "#R<TAB>token<TAB>reading": the corpus-wide most common reading of each token text whose reading the dumps write (the
//     seg.txt rule, readingNote), syllables joined by "-";
//   "@id": the blocks that follow belong to this text;
//   "key<TAB>text hash<TAB>length<TAB>cuts<TAB>exceptions": a block (length of its shown text in UTF-16 units). cuts marks every
//     token boundary inside the shown text, one bit per
//     UTF-16 offset 1 … length-1, six bits per character (A-Z a-z 0-9 - _, lowest bit first). A token whose text is in the
//     #R table reads as the table says unless exceptions say otherwise: "index:reading" pairs, index into the block's tokens.

export interface CompactToken { start: number; end: number; text: string; reading?: string }
export interface CompactBlock { id: string; key: string; hash: string; length: number; tokens: CompactToken[] }

/** FNV-1a, 32 bits, as 8 hex characters: identifies a block's text. */
export function textHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function packCuts(length: number, cuts: Iterable<number>): string {
  const bits = new Uint8Array(Math.max(0, length - 1));
  for (const c of cuts) if (c > 0 && c < length) bits[c - 1] = 1;
  let out = '';
  for (let i = 0; i < bits.length; i += 6) {
    let v = 0;
    for (let k = 0; k < 6 && i + k < bits.length; k++) v |= bits[i + k] << k;
    out += B64[v];
  }
  return out;
}

function unpackCuts(length: number, packed: string): number[] {
  const cuts: number[] = [];
  for (let i = 0; i < packed.length; i++) {
    const v = B64.indexOf(packed[i]);
    for (let k = 0; k < 6; k++) if (v & (1 << k)) cuts.push(i * 6 + k + 1);
  }
  return cuts.filter((c) => c < length);
}

/** Encodes the blocks of many books ("id" → book). */
export function encodeCompact(books: { id: string; book: ShownBook }[], dict: Dictionary): string {
  const note = readingNote(dict);
  const counts = new Map<string, Map<string, number>>();
  for (const { book } of books) {
    for (const b of book.blocks) {
      for (const t of b.tokens) {
        if (!note(t)) continue;
        const r = (t.pinyin ?? []).join('-');
        const m = counts.get(t.text) ?? new Map<string, number>();
        m.set(r, (m.get(r) ?? 0) + 1);
        counts.set(t.text, m);
      }
    }
  }
  const major = new Map<string, string>();
  for (const [w, m] of counts) major.set(w, [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0]);
  const out: string[] = [];
  for (const [w, r] of [...major].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out.push(`#R\t${w}\t${r}`);
  for (const { id, book } of books) {
    out.push(`@${id}`);
    for (const b of book.blocks) {
      const exc: string[] = [];
      b.tokens.forEach((t, i) => {
        const m = t.kind === 'han' ? major.get(t.text) : undefined;
        if (m === undefined) return;
        const r = (t.pinyin ?? []).join('-');
        if (r !== m) exc.push(`${i}:${r}`);
      });
      out.push([b.key, textHash(b.shown), b.shown.length, packCuts(b.shown.length, b.tokens.map((t) => t.start)), exc.join(',')].join('\t'));
    }
  }
  return out.join('\n') + '\n';
}

/**
 * Decodes a compact file. `textOf(id, key, hash, length)` gives the text to cut: the block's own (a block with the same hash),
 * or one of the same length where only some characters changed (a variant folded); a block with no text comes back with no
 * tokens.
 */
export function decodeCompact(file: string, textOf: (id: string, key: string, hash: string, length: number) => string | undefined): CompactBlock[] {
  const major = new Map<string, string>();
  const out: CompactBlock[] = [];
  let id = '';
  for (const line of file.split('\n')) {
    if (!line) continue;
    if (line.startsWith('#R\t')) { const c = line.split('\t'); major.set(c[1], c[2]); continue; }
    if (line.startsWith('#')) continue;
    if (line.startsWith('@')) { id = line.slice(1); continue; }
    const [key, hash, len, packed, excs] = line.split('\t');
    const length = Number(len);
    const text = textOf(id, key, hash, length);
    const tokens: CompactToken[] = [];
    if (text !== undefined) {
      const exc = new Map<number, string>();
      for (const e of (excs ?? '').split(',')) {
        if (!e) continue;
        const k = e.indexOf(':');
        exc.set(Number(e.slice(0, k)), e.slice(k + 1));
      }
      const bounds = [0, ...unpackCuts(text.length, packed ?? ''), text.length];
      for (let i = 0; i + 1 < bounds.length; i++) {
        if (bounds[i + 1] <= bounds[i]) continue;
        const tt = text.slice(bounds[i], bounds[i + 1]);
        const tok: CompactToken = { start: bounds[i], end: bounds[i + 1], text: tt };
        const r = exc.get(tokens.length) ?? major.get(tt);
        if (r !== undefined) tok.reading = r;
        tokens.push(tok);
      }
    }
    out.push({ id, key, hash, length, tokens });
  }
  return out;
}

/** The compact tokens of a live block, in the same shape as decoded ones (readings where the dumps write them). */
export function compactTokens(b: ShownBlock, note: (t: Token) => boolean): CompactToken[] {
  return b.tokens.map((t) => {
    const tok: CompactToken = { start: t.start, end: t.end, text: t.text };
    if (note(t)) tok.reading = (t.pinyin ?? []).join('-');
    return tok;
  });
}

// ----------------------------------------------------------------------------------------------- region diff ---

export interface Region { kind: 'seg' | 'read'; before: string; after: string; context: string; at: number }

const showToks = (ts: CompactToken[]) => ts.map((t) => (t.reading ? `${t.text}{${t.reading.replace(/-/g, ' ')}}` : t.text)).join('|');

/**
 * Where two cuttings of the same text differ, region by region: a region runs between two boundaries both sides share. "seg"
 * when the tokens differ (readings of written tokens shown), "read" when the same token got another written reading. The
 * rule is scripts/eval/zh-diff.py's.
 */
export function diffTokens(text: string, before: CompactToken[], after: CompactToken[]): Region[] {
  const bb = new Set<number>();
  for (const t of before) { bb.add(t.start); bb.add(t.end); }
  const common: number[] = [];
  const ab = new Set<number>();
  for (const t of after) { ab.add(t.start); ab.add(t.end); }
  for (const x of ab) if (bb.has(x)) common.push(x);
  common.sort((a, b) => a - b);
  const out: Region[] = [];
  let i = 0;
  let j = 0;
  for (let k = 0; k + 1 < common.length; k++) {
    const lo = common[k];
    const hi = common[k + 1];
    const bs: CompactToken[] = [];
    const as: CompactToken[] = [];
    while (i < before.length && before[i].start < hi) { if (before[i].start >= lo) bs.push(before[i]); i++; }
    while (j < after.length && after[j].start < hi) { if (after[j].start >= lo) as.push(after[j]); j++; }
    if (!bs.length || !as.length) continue;
    const ctx = `${text.slice(Math.max(0, lo - 8), lo)}【${text.slice(lo, hi)}】${text.slice(hi, hi + 8)}`;
    if (bs.length === 1 && as.length === 1) {
      const [x] = bs;
      const [y] = as;
      if (x.reading && y.reading && x.reading !== y.reading) out.push({ kind: 'read', before: showToks(bs), after: showToks(as), context: ctx, at: lo });
      continue;
    }
    out.push({ kind: 'seg', before: showToks(bs), after: showToks(as), context: ctx, at: lo });
  }
  return out;
}

/** A small seeded generator (mulberry32), for samples that come out the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` items drawn without replacement, the same ones for the same seed. */
export function sample<T>(items: T[], n: number, seed = 1): T[] {
  const rnd = seeded(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(rnd() * (i + 1));
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a.slice(0, n);
}
