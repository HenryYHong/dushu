// Every paragraph of every classic in every spaced language segments without throwing. A context rule that read the word
// two back at the start of a sentence ("— Bien! bien! ma Gabrielle, fort! plus fort!", Notre-Dame de Paris) threw, and the
// whole paragraph failed to segment.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadLang } from './load';

const SAMPLES = join(__dirname, '..', '..', '..', 'public', 'samples');

describe('every classic segments', () => {
  it('French "plus fort!" at the start of a sentence', async () => {
    const fr = await loadLang('fr');
    expect(() => fr.segment('— Bien! bien! ma Gabrielle, fort! plus fort!')).not.toThrow();
  }, 120000);
  for (const id of ['es', 'fr', 'de', 'it', 'pt', 'ru', 'en'] as const) {
    it(id, async () => {
      const eng = await loadLang(id);
      const failed: string[] = [];
      for (const f of readdirSync(join(SAMPLES, id)).filter((x) => x.endsWith('.md'))) {
        for (const para of readFileSync(join(SAMPLES, id, f), 'utf8').split(/\n+/)) {
          try { eng.segment(para); } catch (e) { failed.push(`${f}: ${para.slice(0, 60)} (${(e as Error).message})`); }
        }
      }
      expect(failed.slice(0, 5)).toEqual([]);
    }, 600000);
  }
});
