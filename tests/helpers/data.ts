// Loads the real dictionary from public/data for tests. One instance per worker.
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { loadDictionary } from '../../src/core/dict';
import type { Dictionary } from '../../src/types';

export const DATA_DIR = join(__dirname, '..', '..', 'public', 'data');

/** Decompressed text of a data file by name ("cedict", "cedict.tsv", "cedict.tsv.gz" and "meta.json" all work). */
export async function readDataFile(name: string): Promise<string> {
  const file = /\.(gz|json)$/.test(name) ? name : name.replace(/(\.tsv)?$/, '.tsv.gz');
  const raw = await readFile(join(DATA_DIR, file));
  const text = file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return text;
}

let cached: Promise<Dictionary> | null = null;

export function loadTestDictionary(): Promise<Dictionary> {
  cached ??= loadDictionary('/', { fetchText: readDataFile });
  return cached;
}

/** Data lines (comments and blanks dropped) of a TSV data file, split into columns. */
export async function readRows(name: string): Promise<string[][]> {
  const text = await readDataFile(name);
  return text.split('\n').filter((l) => l && !l.startsWith('# ')).map((l) => l.split('\t'));
}
