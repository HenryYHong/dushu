// Tiny hand-made data files for tests that need exact control over the dictionary contents.
import { loadDictionary } from '../../src/core/dict';
import type { Dictionary } from '../../src/types';

export interface MiniData {
  /** cedict.tsv rows: [trad, simp, numbered pinyin, defs joined by "/"] */
  cedict?: string[][];
  /** cedict-extra.tsv rows (same shape as cedict). Omit to make the file absent. */
  cedictExtra?: string[][];
  /** chars.tsv rows: char, readings, definition, strokes, rs, simp, trad, variants, compatOf (missing columns are blank) */
  chars?: string[][];
  /** chars-extra.tsv rows: char, readings, definition. Omit to make the file absent. */
  extra?: string[][];
  /** words.tsv rows: [word, count] */
  words?: [string, number][];
  hsk?: string[][];
  radicals?: string[][];
  t2s?: string[][];
  s2t?: string[][];
}

const tsv = (header: string, rows: string[][] = []) => `# ${header}\n${rows.map((r) => r.join('\t')).join('\n')}\n`;

export function miniDict(data: MiniData = {}): Promise<Dictionary> {
  const chars = (data.chars ?? []).map((r) => {
    const row = r.slice();
    while (row.length < 9) row.push('');
    return row;
  });
  const total = (data.words ?? []).reduce((a, [, c]) => a + c, 0);
  const files: Record<string, string> = {
    'cedict.tsv.gz': tsv('cedict', data.cedict),
    'chars.tsv.gz': tsv('chars', chars),
    'words.tsv.gz': `# test\n# total=${total || 1}\n${(data.words ?? []).map(([w, c]) => `${w}\t${c}`).join('\n')}\n`,
    'hsk.tsv.gz': tsv('hsk', data.hsk),
    'radicals.tsv.gz': tsv('radicals', data.radicals),
    't2s.tsv.gz': tsv('t2s', data.t2s),
    's2t.tsv.gz': tsv('s2t', data.s2t),
    'meta.json': '{}',
  };
  if (data.extra) files['chars-extra.tsv.gz'] = tsv('extra', data.extra);
  if (data.cedictExtra) files['cedict-extra.tsv.gz'] = tsv('cedict-extra', data.cedictExtra);
  return loadDictionary('/', {
    fetchText: async (name) => {
      if (name in files) return files[name];
      throw new Error(`no such test file ${name}`);
    },
  });
}
