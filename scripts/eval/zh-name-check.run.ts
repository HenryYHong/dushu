// What the name check (core/nameCandidates.ts) would offer for each book after detection, as the reader runs it: the book's
// names found (with the name list and the name model, as zh-shown.ts loads them; ZH_NAME_MODEL=off without the model), then the
// candidates the card would show. Run inside Vitest by scripts/eval/zh-dump.mjs's launcher (options as JSON in ZH_EVAL_ARGS):
//
//   inputs: folders or files of books (as zh-dump.mjs reads them); books: an "id<TAB>path" list kept outside the repository;
//   out: a TSV of id, private, Han characters, names found, offers, and for public books the offers themselves.
//
// Prints ids and counts only.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { it } from 'vitest';
import { nameCandidates } from '../../src/core/nameCandidates';
import { loadEvalDictionary, shownFile } from './zh-shown';

interface Args { inputs: string[]; books?: string; out: string }

const BOOK_EXT = /\.(txt|epub|mobi|azw3?|pdf|html?|xhtml|md)$/i;

it('counts the name check offers of every book', async () => {
  const a = JSON.parse(process.env.ZH_EVAL_ARGS ?? '{}') as Args;
  const dict = await loadEvalDictionary();
  const list: { id: string; path: string; private: boolean }[] = [];
  for (const p of a.inputs) {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).filter((f) => BOOK_EXT.test(f) && !/^[A-Z][A-Z0-9_-]*\.(md|txt)$/.test(f)).sort()) list.push({ id: basename(f, extname(f)), path: join(p, f), private: false });
    } else list.push({ id: basename(p, extname(p)), path: p, private: false });
  }
  if (a.books) {
    for (const line of readFileSync(a.books, 'utf8').split('\n')) {
      const [id, path] = line.split('\t');
      if (id && path && !line.startsWith('#') && existsSync(path)) list.push({ id, path, private: true });
    }
  }
  const rows = ['id\tprivate\than\tfound\toffers\twords'];
  let total = 0;
  for (const b of list) {
    let book;
    try { book = await shownFile(basename(b.path), readFileSync(b.path), dict, 'simplified', { names: true }); } catch { console.log(`${b.id}: import failed`); continue; }
    // (The paragraphs and quotes of each chapter, as detection read them: detectionTexts.)
    const chapters = new Map<string, string[]>();
    for (const blk of book.blocks) if (blk.t !== 'h') { const ch = blk.key.split('.')[0]; chapters.set(ch, [...(chapters.get(ch) ?? []), blk.source]); }
    const texts = [...chapters.values()].map((ps) => ps.join('\n'));
    const offers = nameCandidates(texts, dict, book.found.map((e) => e.word), book.found);
    total += offers.length;
    rows.push([b.id, b.private ? 1 : 0, book.han, book.found.length, offers.length, b.private ? '' : offers.map((o) => `${o.word}:${o.count}`).join(' ')].join('\t'));
    console.log(b.id, book.found.length, offers.length);
  }
  writeFileSync(a.out, rows.join('\n') + '\n');
  console.log(`${list.length} books, ${total} offers`);
});
