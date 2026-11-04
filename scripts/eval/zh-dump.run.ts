// The body of scripts/eval/zh-dump.mjs (run inside Vitest by that launcher; options arrive as JSON in ZH_EVAL_ARGS).
// Writes, per book, <out>/<id>/seg.txt, full.txt, lexicon.tsv, tokens.tsv, singles.tsv, pairs.tsv and readings.tsv, plus
// <out>/index.json, and with "compact" one compact file for all books (the format of tests/corpus/zh/shown-baseline.tsv).
// It prints ids and counts only, never book text.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { it } from 'vitest';
import { detectScript } from '../../src/core/text';
import type { Chapter } from '../../src/types';
import { dumpFiles, encodeCompact, loadEvalDictionary, shownChapters, shownFile, type ShownBook } from './zh-shown';

interface Args {
  out: string;
  inputs: string[];
  books?: string;
  only?: string[];
  mode?: 'simplified' | 'traditional' | 'original';
  compact?: string;
  noNames?: boolean;
}

const BOOK_EXT = /\.(txt|epub|mobi|azw3?|pdf|html?|xhtml|md)$/i;

/** Books to read: files in the folders given, the files given, and "id<TAB>path" rows of a list kept outside the repository. */
function collect(a: Args): { id: string; path: string; private: boolean }[] {
  const out: { id: string; path: string; private: boolean }[] = [];
  for (const p of a.inputs) {
    if (statSync(p).isDirectory()) {
      // INDEX.md, README.md, LICENSES.md and the like describe the folder; they are not books.
      for (const f of readdirSync(p).filter((f) => BOOK_EXT.test(f) && !/^[A-Z][A-Z0-9_-]*\.(md|txt)$/.test(f)).sort()) out.push({ id: basename(f, extname(f)), path: join(p, f), private: false });
    } else out.push({ id: basename(p, extname(p)), path: p, private: false });
  }
  if (a.books) {
    for (const line of readFileSync(a.books, 'utf8').split('\n')) {
      if (!line.trim() || line.startsWith('#')) continue;
      const [id, path] = line.split('\t');
      if (existsSync(path)) out.push({ id, path, private: true });
      else console.log(`${id}: not on this machine, skipped`);
    }
  }
  return a.only ? out.filter((b) => a.only!.includes(b.id)) : out;
}

it('dumps every book through the reader path', async () => {
  const a = JSON.parse(process.env.ZH_EVAL_ARGS ?? '{}') as Args;
  const dict = await loadEvalDictionary();
  const mode = a.mode ?? 'simplified';
  const out = resolve(a.out);
  mkdirSync(out, { recursive: true });
  const index: Record<string, unknown> = {};
  const all: { id: string; book: ShownBook }[] = [];
  for (const b of collect(a)) {
    const t0 = performance.now();
    let book: ShownBook;
    let note: string | undefined;
    try {
      book = await shownFile(basename(b.path), readFileSync(b.path), dict, mode, { names: !a.noNames });
    } catch (e) {
      if (extname(b.path).toLowerCase() !== '.pdf') { index[b.id] = { private: b.private, error: String(e).slice(0, 300) }; console.log(`${b.id}: import failed`); continue; }
      // pdf.js may not start outside a browser: fall back to pdftotext (paragraphs at blank lines). Not the app's path.
      const txt = execFileSync('pdftotext', ['-layout', b.path, '-'], { maxBuffer: 1 << 28 }).toString('utf8');
      const chapters: Chapter[] = [{ title: '(pdftotext)', blocks: txt.split(/\n\s*\n/).map((p) => ({ t: 'p' as const, text: p.replace(/\s*\n\s*/g, '') })).filter((x) => x.text) }];
      book = shownChapters(chapters, detectScript(txt.slice(0, 200000)), dict, mode, { names: !a.noNames });
      note = 'pdftotext fallback: ' + String(e).slice(0, 160);
    }
    const dir = join(out, b.id);
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(dumpFiles(book, dict))) writeFileSync(join(dir, name), text);
    index[b.id] = { private: b.private, chapters: book.chapters, blocks: book.blocks.length, han: book.han, lexicon: book.found.length, script: book.script, seconds: Math.round((performance.now() - t0) / 100) / 10, ...(note ? { note } : {}) };
    console.log(b.id, JSON.stringify(index[b.id]));
    if (a.compact) all.push({ id: b.id, book });
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  if (a.compact) writeFileSync(resolve(a.compact), encodeCompact(all, dict));
});
