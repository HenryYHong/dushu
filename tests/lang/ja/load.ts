// Loads the Japanese engine from public/data/ja for tests. One instance per worker.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEngine } from '../../../src/lang/ja';
import type { LangEngine } from '../../../src/lang/types';

export const JA_DIR = join(__dirname, '..', '..', '..', 'public', 'data', 'ja');

export const readJaFile = async (name: string): Promise<Uint8Array> => new Uint8Array(await readFile(join(JA_DIR, name)));

let cached: Promise<LangEngine> | null = null;

export function loadJa(): Promise<LangEngine> {
  cached ??= loadEngine('/data/ja/', { fetchBytes: readJaFile });
  return cached;
}
