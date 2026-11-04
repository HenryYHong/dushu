#!/usr/bin/env node
// Dumps what the reader shows for Chinese books: the word groupings and the readings it picks, in the display script
// (simplified unless asked), with each book's detected names. The path is the app's own (import, name detection,
// ui/reader/shown.ts), run inside Vitest so the TypeScript is used as it is (scripts/eval/zh-shown.ts does the work).
//
//   node scripts/eval/zh-dump.mjs --out DIR [options] PATH...
//
// PATH is a folder (every .txt .epub .mobi .azw3 .pdf .html .md in it) or a file; a book's id is its file name without the
// extension. Options:
//   --books FILE     also read the books listed in FILE, one "id<TAB>path" per line: a list kept outside the repository, for
//                    books that must not be named in it (the owner's own). Their dumps hold their text, so DIR must be
//                    outside the repository or under its ignored .cache/.
//   --only a,b       only these ids
//   --script M       simplified (default), traditional or original
//   --compact FILE   also write every book in the compact form of tests/corpus/zh/shown-baseline.tsv
//   --no-names       skip name detection (the dictionary alone)
//
// Output per book: DIR/<id>/seg.txt, full.txt, lexicon.tsv, tokens.tsv, singles.tsv, pairs.tsv, readings.tsv, and
// DIR/index.json. Compare two dumps with scripts/eval/zh-diff.py. Prints ids and counts only.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function runTool(entry, args) {
  const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync(vitest)) { console.error('Run npm install first (vitest is missing).'); process.exit(2); }
  const r = spawnSync(process.execPath, [vitest, 'run', '--config', 'scripts/eval/zh.vitest.config.mts'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ZH_EVAL_ENTRY: entry, ZH_EVAL_ARGS: JSON.stringify(args) },
  });
  return r.status ?? 1;
}

/** True when `p` would be committed: inside the repository and not under an ignored folder. */
export function insideRepo(p) {
  const rel = relative(root, resolve(p));
  if (rel.startsWith('..') || isAbsolute(rel)) return false;
  return !/^(\.cache|\.dushu-local|node_modules|dist)(\/|$)/.test(rel);
}

function main() {
  const argv = process.argv.slice(2);
  const args = { inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--books') args.books = resolve(argv[++i]);
    else if (a === '--only') args.only = argv[++i].split(',');
    else if (a === '--script') args.mode = argv[++i];
    else if (a === '--compact') args.compact = resolve(argv[++i]);
    else if (a === '--no-names') args.noNames = true;
    else if (a === '-h' || a === '--help') { console.log('usage: node scripts/eval/zh-dump.mjs --out DIR [--books FILE] [--only a,b] [--script simplified|traditional|original] [--compact FILE] [--no-names] PATH...'); return 0; }
    else if (a.startsWith('--')) { console.error(`unknown option ${a}`); return 2; }
    else args.inputs.push(resolve(a));
  }
  if (!args.out || (!args.inputs.length && !args.books)) { console.error('usage: node scripts/eval/zh-dump.mjs --out DIR [options] PATH...'); return 2; }
  args.out = resolve(args.out);
  if (args.books && insideRepo(args.out)) { console.error('--books dumps hold the books\' text: put --out outside the repository or under .cache/.'); return 2; }
  if (args.mode && !['simplified', 'traditional', 'original'].includes(args.mode)) { console.error('--script is simplified, traditional or original'); return 2; }
  return runTool('scripts/eval/zh-dump.run.ts', args);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
