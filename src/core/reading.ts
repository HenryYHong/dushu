// Matching dictionary entries to the reading on screen, so a short gloss never contradicts the pinyin beside it.
import type { DictEntry } from '../types';

const tones = /[1-5]/g;
// CEDICT capitalizes proper-name readings. For a short, context-unverified gloss,
// ordinary entries lead when the same reading has both (波: wave before Poland).
const lexicalFirst = (entries: DictEntry[]) => [...entries].sort((a, b) => Number(/[A-Z]/.test(a.pinyin)) - Number(/[A-Z]/.test(b.pinyin)));

/**
 * `entries` reordered so the ones whose pinyin is the reading being shown come first: 说 shown as shuō leads
 * with "to speak", not shuì "to persuade". Sandhi-changed syllables (bú, yí) still match their entry by base.
 */
export function entriesForReading(entries: DictEntry[], syllables: readonly (string | undefined)[]): DictEntry[] {
  const want = syllables.filter(Boolean).map((s) => s!.toLowerCase()).join(' ');
  if (entries.length < 2) return entries;
  if (!want) return lexicalFirst(entries);
  const norm = (p: string) => p.toLowerCase().replace(/u:/g, 'ü');
  let lead = entries.filter((e) => norm(e.pinyin) === want);
  if (!lead.length) lead = entries.filter((e) => norm(e.pinyin).replace(tones, '') === want.replace(tones, ''));
  return lead.length ? [...lexicalFirst(lead), ...entries.filter((e) => !lead.includes(e))] : lexicalFirst(entries);
}
