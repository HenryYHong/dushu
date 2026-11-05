// The reading model on the hand-labeled places of the held-out corpus (zh/readings-calibration.tsv; the rows from the classics
// in public/samples are left to the training script's review, their books are long). Each text is read the way the reader shows
// it, once with the rules alone and once with the model: the model's changes must be right at least 90% of the time, and the
// page must not get fewer of the labeled readings right than the rules alone.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { READING_MODEL_FILE, parseReadingModel, type ReadingModel } from '../../src/core/readingModel';
import { importFile } from '../../src/import';
import { inScript, segmentShown } from '../../src/ui/reader/shown';
import type { Dictionary } from '../../src/types';
import { bookLexicon, detectionTexts } from '../../scripts/eval/zh-shown';
import { loadTestDictionary, readDataFile } from '../helpers/data';

const DIR = join(__dirname, 'zh');
interface Row { text: string; block: string; offset: number; ch: string; gold: string }

const rows: Row[] = readFileSync(join(DIR, 'readings-calibration.tsv'), 'utf8').split('\n')
  .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'))
  .filter((c) => c[0] === 'tests/corpus/zh')
  .map((c) => ({ text: c[1], block: c[2], offset: Number(c[3]), ch: c[4], gold: c[5] }));
const folders = new Map(readFileSync(join(DIR, 'texts.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
  .map((l) => l.split('\t')).map((c) => [c[0], c[1]] as [string, string]));

let dict: Dictionary;
let model: ReadingModel;
/** The reading at each labeled place: [rules alone, with the model]. */
const got = new Map<Row, [string, string]>();

beforeAll(async () => {
  dict = await loadTestDictionary();
  model = parseReadingModel(await readDataFile(READING_MODEL_FILE))!;
  const byText = new Map<string, Row[]>();
  for (const r of rows) byText.set(r.text, [...(byText.get(r.text) ?? []), r]);
  for (const [id, places] of byText) {
    const book = await importFile(new File([readFileSync(join(DIR, folders.get(id)!, `${id}.txt`)) as BlobPart], `${id}.txt`));
    const { lexicon } = bookLexicon(detectionTexts(book.chapters), dict, 'simplified', book.script);
    for (const r of places) {
      const [ci, bi] = r.block.split('.').map(Number);
      const b = book.chapters[ci]?.blocks[bi];
      const text = b && 'text' in b ? b.text : undefined;
      if (!text) continue;
      const shown = inScript(text, 'simplified', dict, book.script);
      const read = (m: ReadingModel | null) => {
        dict.setReadingModel?.(m);
        const t = segmentShown(shown, text, dict, lexicon).find((x) => x.start <= r.offset && r.offset < x.end);
        return t?.pinyin?.[[...shown.slice(t.start, r.offset)].length] ?? '';
      };
      got.set(r, [read(null), read(model)]);
    }
  }
  dict.setReadingModel?.(null);
}, 240_000);
afterAll(() => dict?.setReadingModel?.(null));

describe('reading model on the hand-labeled corpus places', () => {
  it('finds the labeled places', () => {
    expect(rows.length).toBeGreaterThan(200);
    expect(got.size).toBeGreaterThan(rows.length * 0.95);
  });

  it('is right in at least 90% of its changes and never makes the page worse', () => {
    let changed = 0, right = 0, before = 0, after = 0;
    const wrong: string[] = [];
    for (const [r, [a, b]] of got) {
      before += a === r.gold ? 1 : 0;
      after += b === r.gold ? 1 : 0;
      if (a === b) continue;
      changed++;
      if (b === r.gold) right++; else wrong.push(`${r.text} ${r.block} ${r.ch}: ${b} (right: ${r.gold})`);
    }
    console.log(`reading model on ${got.size} labeled corpus places: rules alone ${before} right, with the model ${after}; it changed ${changed}, ${right} right`);
    if (wrong.length) console.log('  wrong changes: ' + wrong.join('; '));
    expect(changed).toBeGreaterThan(0);
    expect(right / changed).toBeGreaterThanOrEqual(0.9);
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
