// The simpler-word hints over the text (public/data/<id>/native.tsv.gz, the hint column; scripts/lang/native/build.py pick_hint)
// are all there: in November 2026 a cached Wiktionary extract that had left out the synonyms took most of them away (Spanish
// 1,010 to 4) without anything failing. Each language keeps at least about 70% of what it had then.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DATA = join(__dirname, '..', '..', 'public', 'data');
const AT_LEAST: Record<string, number> = { en: 1500, es: 700, fr: 700, de: 1700, it: 2800, pt: 1000, ru: 2600 };

describe('the simpler-word hints over the text', () => {
  for (const [id, min] of Object.entries(AT_LEAST)) {
    it(`${id}: at least ${min}`, () => {
      const lines = gunzipSync(readFileSync(join(DATA, id, 'native.tsv.gz'))).toString('utf8').split('\n');
      const hinted = new Set(lines.filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')).filter((c) => c[2]).map((c) => c[0]));
      expect(hinted.size).toBeGreaterThanOrEqual(min);
    });
  }
});
