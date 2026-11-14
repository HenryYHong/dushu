// A reader whose interface is in their own language (the default: the browser's) gets the card in the book's language too.
// The engine names a sense's part of speech in the interface's language ("sustantivo"), the own dictionary in English
// ("noun"); before 2026-11-14 the two never matched, and a Spanish speaker with a Spanish interface got the English card.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadLang } from './spaced/load';
import { OWN_SOURCE, loadOwnDictionary, resetOwnDictionary, setReaderLanguage, withOwnDictionary } from '../../src/lang/ownDictionary';
import { setCatalogForTest } from '../../src/i18n';

const ROOT = join(__dirname, '..', '..');
const WORDS = { es: 'casa', fr: 'maison', de: 'Haus', it: 'casa', pt: 'casa', ru: 'дом' } as const;

describe('a reader with an interface in their own language gets the card in it', () => {
  afterAll(() => setCatalogForTest('en', {}));
  for (const [id, word] of Object.entries(WORDS) as [keyof typeof WORDS, string][]) {
    it(`${id}: ${word}`, async () => {
      const catalog = JSON.parse(readFileSync(join(ROOT, 'src', 'i18n', 'catalogs', `${id}.json`), 'utf8')) as Record<string, string>;
      setCatalogForTest(id, catalog);
      resetOwnDictionary();
      const engine = await loadLang(id);
      setReaderLanguage(id);
      await loadOwnDictionary(id, `/data/${id}/`, async () => gunzipSync(readFileSync(join(ROOT, 'public', 'data', id, 'native.tsv.gz'))).toString('utf8'));
      const e = withOwnDictionary(engine).lookup(word).entries[0];
      expect(e.source).toBe(OWN_SOURCE);
      // The part of speech as the interface names it (Russian "существительное"), not in English.
      expect(e.senses[0].pos).toBe(catalog.noun);
    }, 300000);
  }
});
