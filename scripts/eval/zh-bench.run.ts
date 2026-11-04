// The body of scripts/eval/zh-bench.mjs (run inside Vitest by that launcher; options arrive as JSON in ZH_EVAL_ARGS, the
// data folders in ZH_BENCH_DATA and ZH_BENCH_CPP). Prints a table, writes JSON, and compares with a baseline when asked.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';
import { loadEvalDictionary } from './zh-shown';
import { cppItems, goldLines, round, scoreCpp, scoreSegmentation, segmentLines, TOLERANCE, type Mode } from './zh-score';

interface Args { sets?: string[]; json?: string; baseline?: string; record?: string; segOut?: string; noCpp?: boolean }
interface Result {
  recorded: string;
  sets: Record<string, Record<Mode, { f1: number; cross: number; tokens: number; mismatched: number }>>;
  cpp?: Record<Mode, { strict: number; single: number; n: number; nSingle: number }>;
}

it('scores the local benchmarks through the reader path', async () => {
  const a = JSON.parse(process.env.ZH_EVAL_ARGS ?? '{}') as Args;
  const data = process.env.ZH_BENCH_DATA;
  if (!data || !existsSync(data)) throw new Error('Set ZH_BENCH_DATA to a folder of <set>.gold files (one sentence per line, words separated by spaces).');
  const cppDir = process.env.ZH_BENCH_CPP ?? join(data, 'cpp');
  const dict = await loadEvalDictionary();
  const sets = a.sets ?? readdirSync(data).filter((f) => f.endsWith('.gold')).map((f) => basename(f, '.gold')).sort();
  const res: Result = { recorded: new Date().toISOString().slice(0, 10), sets: {} };
  const table = ['set\tmode\tF1\tcross %\ttokens\tseconds'];
  for (const set of sets) {
    const gold = goldLines(readFileSync(join(data, `${set}.gold`), 'utf8'));
    const raw = gold.map((l) => l.replace(/ /g, ''));
    res.sets[set] = {} as Result['sets'][string];
    for (const mode of ['dict', 'book'] as const) {
      const t0 = performance.now();
      const { seg, pinyin } = segmentLines(raw, dict, mode);
      const s = scoreSegmentation(gold, seg);
      res.sets[set][mode] = { f1: round(s.f1), cross: round(s.cross, 3), tokens: s.tokens, mismatched: s.mismatched };
      table.push(`${set}\t${mode}\t${round(s.f1)}\t${round(s.cross, 3)}\t${s.tokens}\t${round((performance.now() - t0) / 1000, 1)}`);
      if (a.segOut) {
        mkdirSync(a.segOut, { recursive: true });
        writeFileSync(join(a.segOut, `${set}.${mode}.seg`), seg.join('\n') + '\n');
        writeFileSync(join(a.segOut, `${set}.${mode}.py`), pinyin.join('\n') + '\n');
      }
    }
  }
  if (!a.noCpp && existsSync(join(cppDir, 'test.sent'))) {
    const items = cppItems(readFileSync(join(cppDir, 'test.sent'), 'utf8'), readFileSync(join(cppDir, 'test.lb'), 'utf8'));
    res.cpp = {} as NonNullable<Result['cpp']>;
    for (const mode of ['dict', 'book'] as const) {
      const s = scoreCpp(items, dict, mode);
      res.cpp[mode] = { strict: round(s.strict), single: round(s.single), n: s.n, nSingle: s.nSingle };
      table.push(`cpp\t${mode}\tstrict ${round(s.strict)}\tone-character ${round(s.single)}\t${s.n} (${s.nSingle} one-character)`);
    }
  }
  console.log(table.join('\n'));
  if (a.json) writeFileSync(a.json, JSON.stringify(res, null, 1) + '\n');
  if (a.record) writeFileSync(a.record, JSON.stringify(res, null, 1) + '\n');
  if (a.baseline) {
    const base = JSON.parse(readFileSync(a.baseline, 'utf8')) as Result;
    const fails: string[] = [];
    for (const [set, modes] of Object.entries(res.sets)) {
      for (const [mode, n] of Object.entries(modes) as [Mode, Result['sets'][string][Mode]][]) {
        const b = base.sets[set]?.[mode];
        if (!b) continue;
        if (n.cross > b.cross + TOLERANCE.cross + 1e-9) fails.push(`${set} ${mode}: crossing ${n.cross} vs ${b.cross}`);
        if (n.f1 < b.f1 - TOLERANCE.f1 - 1e-9) fails.push(`${set} ${mode}: F1 ${n.f1} vs ${b.f1}`);
      }
    }
    for (const mode of ['dict', 'book'] as const) {
      const n = res.cpp?.[mode];
      const b = base.cpp?.[mode];
      if (!n || !b) continue;
      if (n.strict < b.strict - TOLERANCE.cppStrict - 1e-9) fails.push(`cpp ${mode}: strict ${n.strict} vs ${b.strict}`);
      if (n.single < b.single - TOLERANCE.cppSingle - 1e-9) fails.push(`cpp ${mode}: one-character ${n.single} vs ${b.single}`);
    }
    console.log(fails.length ? `gate: ${fails.length} past tolerance\n  ${fails.join('\n  ')}` : 'gate: every number within tolerance of the baseline');
    expect(fails).toEqual([]);
  }
});
