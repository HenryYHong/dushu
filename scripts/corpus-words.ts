// The Node half of scripts/build_corpus_words.py: reads the offline corpus (gzipped text, one paragraph per line) with the app's
// own dictionary and segmenter. Bundled and run by the Python script:
//
//   node_modules/.bin/esbuild scripts/corpus-words.ts --bundle --platform=node --format=esm --outfile=.cache/corpus-words.mjs
//   node .cache/corpus-words.mjs count <data> <out-prefix> <k> <n> <titles.txt|-> <skip-titles.tsv|-> FILE:GROUP ...
//   node .cache/corpus-words.mjs near <words.txt> <out.tsv> <k> <n> FILE:GROUP ...
//   node .cache/corpus-words.mjs diff <data> <corpus-words.tsv.gz> <out.tsv> <k> <n> FILE:GROUP ...
//   node .cache/corpus-words.mjs probe <data> <word-parts.tsv> <out.tsv>
//
// A FILE of group "wiki" holds articles (a title line, paragraphs, a blank line) and worker k of n takes the articles whose index
// % n is k; any other group is one book per file (a title line, then paragraphs), and worker k takes the files whose index % n is
// k. `count` cuts every paragraph (dictionary only, no book lexicon) and writes, per group: the Han tokens (.tok.tsv); for the
// dictionary words the jieba corpus counted fewer than 20 times, how often they occur, occur with a cut at both edges, and are
// cut as one word (.cand.tsv); grams of 2 or 3 neighboring tokens, 2 to 4 characters, that hold a one-character token and that
// no dictionary has (.gram.tsv; Wikipedia: two single characters only, seen twice or more); and the titles of titles.txt that are
// not dictionary words, how often they occur and with a cut at both edges (.title.tsv). `near` counts each word of words.txt in
// each FILE with the characters right before and after it. `diff` cuts the paragraphs that hold a word of the file with and
// without it and counts each changed region "before => after". `probe` gives each word's reading, the reading of its parts side
// by side, its segmentation counts and its dictionary rows.
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, gunzipSync } from 'node:zlib';
import { loadDictionary } from '../src/core/dict';
import { segment } from '../src/core/segment';
import type { Dictionary } from '../src/types';

const HAN = /^[㐀-䶿一-鿿豈-﫿]+$/;
const isHan = (c: number) => (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff);
type Counts = Map<string, number>;
const bump = (m: Counts, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const of = <V>(m: Map<string, V>, g: string, mk: () => V) => { let v = m.get(g); if (!v) { v = mk(); m.set(g, v); } return v; };

/** The dictionary from `dataDir`, with the corpus counts file `cw` (null: without one). */
async function dictWith(dataDir: string, cw: string | null, cutOnly = false): Promise<Dictionary> {
  const fetchText = async (name: string) => {
    if (name === 'corpus-words.tsv.gz') {
      if (!cw) throw new Error('left out');
      return gunzipSync(await readFile(cw)).toString('utf8');
    }
    const file = /\.(gz|json)$/.test(name) ? name : name.replace(/(\.tsv)?$/, '.tsv.gz');
    const raw = await readFile(join(dataDir, file));
    return file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  };
  const d = await loadDictionary('/', { fetchText });
  if (cutOnly) {
    // Cutting never needs the readings segment() adds at the end; the rules' own lookups (no `line`) still get them.
    const real = d.pinyinFor.bind(d);
    (d as { pinyinFor: Dictionary['pinyinFor'] }).pinyinFor = (w, ctx) => (ctx && ctx.line ? [] : real(w, ctx));
  }
  return d;
}

/** Calls `fn(line, group)` for each paragraph of the specs that are worker k's. */
async function eachParagraph(specs: string[], k: number, n: number, fn: (line: string, group: string) => void, skip?: (title: string) => boolean): Promise<void> {
  let index = 0;
  for (const spec of specs) {
    const cut = spec.lastIndexOf(':');
    const file = spec.slice(0, cut), group = spec.slice(cut + 1);
    const wiki = group === 'wiki';
    if (!wiki && index++ % n !== k) continue;
    const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
    let first = true, art = 0, mine = !wiki, skipped = false;
    for await (const line of rl) {
      if (wiki) {
        if (line === '') { first = true; continue; }
        if (first) { first = false; art++; mine = art % n === k; skipped = !!skip?.(line); continue; }
        if (!mine || skipped) continue;
      } else if (first) { first = false; continue; } // the book's title line
      fn(line, group);
    }
    console.error(JSON.stringify({ worker: k, file: file.split('/').pop() }));
  }
}

async function count(args: string[]): Promise<void> {
  const [dataDir, outPrefix, kS, nS, titlesFile, skipFile, ...specs] = args;
  const k = Number(kS), n = Number(nS);
  const dict = await dictWith(dataDir, null, true);
  const cand = new Set<string>();
  for (const f of ['cedict.tsv.gz', 'cedict-extra.tsv.gz', 'hsk.tsv.gz']) {
    const text = gunzipSync(await readFile(join(dataDir, f)).catch(() => Buffer.from(''))).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('# ')) continue;
      const t = line.split('\t');
      const w = f === 'hsk.tsv.gz' ? t[0] : t[1];
      if (w && w.length >= 2 && w.length <= 6 && HAN.test(w) && dict.freq(w) < 20) cand.add(w);
    }
  }
  const titles = new Set<string>();
  if (titlesFile !== '-') {
    for (const line of readFileSync(titlesFile, 'utf8').split('\n')) {
      const s = line.trim();
      if (s.length >= 2 && s.length <= 5 && HAN.test(s) && !dict.hasWord(s)) titles.add(s);
    }
  }
  // Articles left out (the ones about the owner's books): column 2 of the file, matched in both scripts.
  const skipTitles = new Set<string>();
  if (skipFile !== '-') {
    for (const line of readFileSync(skipFile, 'utf8').split('\n').slice(1)) {
      const t = line.split('\t')[1];
      if (t) { skipTitles.add(t); skipTitles.add(dict.toSimplified(t)); }
    }
  }
  const tok = new Map<string, Counts>(), gram = new Map<string, Counts>();
  const cst = new Map<string, Map<string, number[]>>(), tit = new Map<string, Map<string, number[]>>();
  await eachParagraph(specs, k, n, (line, group) => {
    const wiki = group === 'wiki';
    const toks = segment(line, dict);
    const T = of(tok, group, () => new Map()), G = of(gram, group, () => new Map());
    const C = of(cst, group, () => new Map()), Ti = of(tit, group, () => new Map());
    const len = line.length;
    const bound = new Uint8Array(len + 1);
    const startTok = new Int32Array(len + 1).fill(-1);
    toks.forEach((t, i) => {
      bound[t.start] = 1; bound[t.end] = 1; startTok[t.start] = i;
      if (t.kind === 'han') bump(T, t.text);
    });
    for (let i = 0; i < len; i++) {
      if (!isHan(line.charCodeAt(i))) continue;
      for (const w of dict.wordsAt(line, i)) {
        if (w.length < 2 || !cand.has(w)) continue;
        const r = of(C, w, () => [0, 0, 0]);
        r[0]++;
        if (bound[i] && bound[i + w.length]) {
          r[1]++;
          if (startTok[i] >= 0 && toks[startTok[i]].text === w) r[2]++;
        }
      }
      for (let L = 2; titles.size && L <= 5 && i + L <= len; L++) {
        if (!isHan(line.charCodeAt(i + L - 1))) break;
        const s = line.substr(i, L);
        if (!titles.has(s)) continue;
        const r = of(Ti, s, () => [0, 0]);
        r[0]++;
        if (bound[i] && bound[i + L]) r[1]++;
      }
    }
    for (let i = 0; i + 1 < toks.length; i++) {
      if (toks[i].kind !== 'han') continue;
      let g = toks[i].text, single = g.length === 1;
      for (let j = i + 1; j < toks.length && j <= i + 2; j++) {
        const t = toks[j];
        if (t.kind !== 'han' || t.start !== toks[j - 1].end) break;
        g += t.text;
        if (t.text.length === 1) single = true;
        if (g.length > 4) break;
        if (!single || (wiki && !(j === i + 1 && g.length === 2)) || dict.hasWord(g)) continue;
        bump(G, g);
      }
    }
    // Wikipedia's pairs are too many to keep: drop the ones seen once now and then.
    if (wiki && G.size > 3_000_000) for (const [key, v] of G) if (v < 2) G.delete(key);
  }, (title) => skipTitles.has(title));
  const write = (suffix: string, rows: string[]) => writeFileSync(outPrefix + suffix, rows.join('\n') + '\n');
  write('.tok.tsv', [...tok].flatMap(([g, m]) => [...m].map(([w, c]) => `${g}\t${w}\t${c}`)));
  write('.cand.tsv', [...cst].flatMap(([g, m]) => [...m].map(([w, r]) => `${g}\t${w}\t${r.join('\t')}`)));
  write('.gram.tsv', [...gram].flatMap(([g, m]) => [...m].filter(([, c]) => c >= 2 || g !== 'wiki').map(([w, c]) => `${g}\t${w}\t${c}`)));
  write('.title.tsv', [...tit].flatMap(([g, m]) => [...m].map(([w, r]) => `${g}\t${w}\t${r.join('\t')}`)));
}

async function near(args: string[]): Promise<void> {
  const [wordsFile, outFile, kS, nS, ...specs] = args;
  const words = new Set(readFileSync(wordsFile, 'utf8').split('\n').filter(Boolean));
  let maxLen = 2;
  for (const w of words) maxLen = Math.max(maxLen, w.length);
  type Rec = { n: number; l: Counts; r: Counts };
  const by = new Map<string, Map<string, Rec>>();
  await eachParagraph(specs, Number(kS), Number(nS), (line, group) => {
    const G = of(by, group, () => new Map());
    for (let i = 0; i < line.length; i++) {
      if (!isHan(line.charCodeAt(i))) continue;
      for (let L = 2; L <= maxLen && i + L <= line.length; L++) {
        if (!isHan(line.charCodeAt(i + L - 1))) break;
        const s = line.substr(i, L);
        if (!words.has(s)) continue;
        const r = of(G, s, () => ({ n: 0, l: new Map(), r: new Map() }));
        r.n++;
        bump(r.l, i > 0 && isHan(line.charCodeAt(i - 1)) ? line[i - 1] : '#');
        bump(r.r, i + L < line.length && isHan(line.charCodeAt(i + L)) ? line[i + L] : '#');
      }
    }
  });
  const enc = (m: Counts) => [...m].map(([c, v]) => `${c}:${v}`).join(',');
  writeFileSync(outFile, [...by].flatMap(([g, G]) => [...G].map(([s, r]) => `${g}\t${s}\t${r.n}\t${enc(r.l)}\t${enc(r.r)}`)).join('\n') + '\n');
}

async function diff(args: string[]): Promise<void> {
  const [dataDir, cw, outFile, kS, nS, ...specs] = args;
  const before = await dictWith(dataDir, null, true);
  const after = await dictWith(dataDir, cw, true);
  const words = new Set<string>();
  let maxLen = 2;
  for (const line of gunzipSync(await readFile(cw)).toString('utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const t = line.split('\t');
    for (const w of t.length >= 5 ? [t[0], t[1]] : [t[0]]) { words.add(w); maxLen = Math.max(maxLen, w.length); }
  }
  const out: Counts = new Map();
  await eachParagraph(specs, Number(kS), Number(nS), (line, group) => {
    let found = false;
    for (let i = 0; i < line.length && !found; i++) {
      if (!isHan(line.charCodeAt(i))) continue;
      for (let L = 2; L <= maxLen && i + L <= line.length; L++) if (words.has(line.substr(i, L))) { found = true; break; }
    }
    if (!found) return;
    const a = segment(line, before), b = segment(line, after);
    const ea = new Set(a.map((t) => t.end)), eb = new Set(b.map((t) => t.end));
    let ia = 0, ib = 0;
    while (ia < a.length && ib < b.length) {
      if (a[ia].start === b[ib].start && a[ia].end === b[ib].end) { ia++; ib++; continue; }
      // A region runs to the next end both cuts share.
      const ja = ia, jb = ib;
      let end = Math.max(a[ia].end, b[ib].end);
      while (!(ea.has(end) && eb.has(end))) {
        while (ia < a.length && a[ia].end < end) ia++;
        while (ib < b.length && b[ib].end < end) ib++;
        end = Math.max(a[ia].end, b[ib].end);
      }
      while (ia < a.length && a[ia].end <= end) ia++;
      while (ib < b.length && b[ib].end <= end) ib++;
      bump(out, `${group}\t${a.slice(ja, ia).map((t) => t.text).join('|')}\t${b.slice(jb, ib).map((t) => t.text).join('|')}`);
    }
  });
  writeFileSync(outFile, [...out].map(([key, c]) => `${key}\t${c}`).join('\n') + '\n');
}

async function probe(args: string[]): Promise<void> {
  const [dataDir, inFile, outFile] = args;
  const dict = await dictWith(dataDir, null);
  const out: string[] = [];
  for (const line of readFileSync(inFile, 'utf8').split('\n').filter(Boolean)) {
    const [w, p] = line.split('\t');
    const parts = (p || [...w].join('|')).split('|');
    const pr = parts.flatMap((x, i) => dict.pinyinFor(x, { prev: parts[i - 1] ?? '', next: parts[i + 1] ?? '' }));
    const defs = dict.lookup(w).map((e) => `${e.pinyin}: ${e.defs.slice(0, 3).join('; ')}`).join(' || ').replace(/\t/g, ' ').slice(0, 400);
    out.push([w, dict.pinyinFor(w).join(' '), pr.join(' '), dict.segmentFreq?.(w) ?? 0, dict.freq(w), defs].join('\t'));
  }
  writeFileSync(outFile, out.join('\n') + '\n');
}

const [cmd, ...rest] = process.argv.slice(2);
const run = { count, near, diff, probe }[cmd as 'count'];
if (!run) { console.error('usage: corpus-words.mjs count|near|diff|probe ...'); process.exit(2); }
run(rest).catch((e) => { console.error(e); process.exit(1); });
