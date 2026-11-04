#!/usr/bin/env node
// Word segmentation and reading benchmarks that may not be stored in the repository (SIGHAN 2005, ZX, CPP), scored through
// the reader's path (scripts/eval/zh-score.ts). The data stays on this machine; its folders come from environment variables:
//
//   ZH_BENCH_DATA=<folder of <set>.gold files> [ZH_BENCH_CPP=<folder with test.sent and test.lb>] \
//     node scripts/eval/zh-bench.mjs [--sets pku,msr] [--json FILE] [--record FILE] [--baseline FILE] [--seg-out DIR] [--no-cpp]
//
// A .gold file has one sentence per line, words separated by single spaces. ZH_BENCH_CPP defaults to ZH_BENCH_DATA/cpp
// (CPP's test split: the target character between two U+2581 marks, one gold reading per line). Each set is read twice:
// "dict" (each line alone, no names) and "book" (the set as one uploaded book, names detected over chapters of 50 lines).
// Prints F1 and crossing per set and CPP accuracy (strict, and on one-character tokens). --record writes the numbers as a
// baseline; --baseline FILE fails when a number moves past the plan's tolerances (crossing +0.03, F1 -0.3, CPP strict -0.2,
// CPP one-character -0). --seg-out writes each set's cut and readings for scripts that score them further.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTool } from './zh-dump.mjs';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--sets') args.sets = argv[++i].split(',');
  else if (a === '--json') args.json = resolve(argv[++i]);
  else if (a === '--record') args.record = resolve(argv[++i]);
  else if (a === '--baseline') args.baseline = resolve(argv[++i]);
  else if (a === '--seg-out') args.segOut = resolve(argv[++i]);
  else if (a === '--no-cpp') args.noCpp = true;
  else { console.error(`unknown option ${a}\nusage: ZH_BENCH_DATA=<dir> node scripts/eval/zh-bench.mjs [--sets a,b] [--json FILE] [--record FILE] [--baseline FILE] [--seg-out DIR] [--no-cpp]`); process.exit(2); }
}
if (!process.env.ZH_BENCH_DATA) { console.error('Set ZH_BENCH_DATA to the folder with the .gold files (kept outside the repository).'); process.exit(2); }
process.env.ZH_BENCH_DATA = resolve(process.env.ZH_BENCH_DATA);
if (process.env.ZH_BENCH_CPP) process.env.ZH_BENCH_CPP = resolve(process.env.ZH_BENCH_CPP);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(runTool('scripts/eval/zh-bench.run.ts', args));
