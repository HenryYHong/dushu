// Word-segmentation gate on two public treebanks (tests/corpus/ud, CC BY-SA 4.0): the reader's cut of every test sentence,
// scored for F1 and crossing rate against tests/corpus/ud/baseline.json with the plan's tolerances. Fails only when a number
// moves the wrong way past its tolerance; prints the numbers either way. UPDATE_ZH_BASELINE=1 records new ones.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadTestDictionary } from '../helpers/data';
import { goldLines, round, scoreSegmentation, segmentLines, TOLERANCE, type Mode } from '../../scripts/eval/zh-score';

const DIR = join(__dirname, 'ud');
const BASELINE = join(DIR, 'baseline.json');
const UPDATE = process.env.UPDATE_ZH_BASELINE === '1';
const SETS = { gsdsimp: 'zh_gsdsimp-ud-test.words.txt', hk: 'zh_hk-ud-test.words.txt' } as const;
type Numbers = Record<string, Record<Mode, { f1: number; cross: number; tokens: number }>>;

describe('UD Chinese test sets through the reader', () => {
  it('cuts words no worse than the recorded baseline', async () => {
    const dict = await loadTestDictionary();
    const now: Numbers = {};
    for (const [set, file] of Object.entries(SETS)) {
      const gold = goldLines(readFileSync(join(DIR, file), 'utf8'));
      const raw = gold.map((l) => l.replace(/ /g, ''));
      now[set] = {} as Numbers[string];
      for (const mode of ['dict', 'book'] as const) {
        const { seg } = segmentLines(raw, dict, mode);
        const s = scoreSegmentation(gold, seg);
        expect(s.mismatched).toBe(0);
        now[set][mode] = { f1: round(s.f1), cross: round(s.cross, 3), tokens: s.tokens };
      }
    }
    if (UPDATE) {
      writeFileSync(BASELINE, JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), tolerance: { cross: TOLERANCE.cross, f1: TOLERANCE.f1 }, sets: now }, null, 1) + '\n');
      console.log('UD baseline recorded', JSON.stringify(now));
      return;
    }
    const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as { sets: Numbers };
    const lines = ['set\tmode\tF1 (base)\tcross % (base)'];
    const failures: string[] = [];
    for (const [set, modes] of Object.entries(now)) {
      for (const [mode, n] of Object.entries(modes) as [Mode, Numbers[string][Mode]][]) {
        const b = base.sets[set][mode];
        lines.push(`${set}\t${mode}\t${n.f1} (${b.f1})\t${n.cross} (${b.cross})`);
        if (n.cross > b.cross + TOLERANCE.cross + 1e-9) failures.push(`${set} ${mode}: crossing ${n.cross}% vs ${b.cross}% (at most +${TOLERANCE.cross})`);
        if (n.f1 < b.f1 - TOLERANCE.f1 - 1e-9) failures.push(`${set} ${mode}: F1 ${n.f1} vs ${b.f1} (at most -${TOLERANCE.f1})`);
        if (n.cross < b.cross - TOLERANCE.cross || n.f1 > b.f1 + TOLERANCE.f1) lines.push(`  ${set} ${mode} is better than its baseline: record it with UPDATE_ZH_BASELINE=1`);
      }
    }
    console.log(lines.join('\n'));
    expect(failures).toEqual([]);
  }, 180_000);
});
