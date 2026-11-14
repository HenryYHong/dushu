// A word form's note ("first/third-person singular imperfect indicative of vivir") in the reader's interface language, term
// by term (src/lang/formLabel.ts; the terms are '<term> [grammar]' in src/i18n/catalogs). Every interface language has every
// term, the common notes come out with no English grammar word left, and a note with an unknown word stays English whole.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formLabel } from '../../src/lang/formLabel';
import { setCatalogForTest, UI_LANGS } from '../../src/i18n';

const SOURCE = readFileSync(join(__dirname, '..', '..', 'src', 'lang', 'formLabel.ts'), 'utf8');
const TERMS = [...SOURCE.matchAll(/ttx\('([^']+)', 'grammar'\)/g)].map((m) => m[1]);
const NOTES = ['third-person singular present indicative', 'first/third-person singular imperfect indicative', 'feminine plural past participle',
  'second-person singular imperative', 'genitive singular', 'nominative/accusative plural', 'short masculine singular', 'alternative spelling',
  'third-person singular past tense and past participle', 'masculine singular past passive participle', 'subjunctive II'];
const ENGLISH = /\b(?:person|present|past|indicative|subjunctive|imperative|participle|genitive|nominative|accusative|masculine|feminine|spelling|tense)\b/;

describe('form notes in the interface language', () => {
  afterAll(() => setCatalogForTest('en', {}));
  it('finds the terms', () => expect(TERMS.length).toBeGreaterThan(80));
  for (const ui of UI_LANGS.filter((l) => l !== 'en')) {
    it(ui, () => {
      const catalog = JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'i18n', 'catalogs', `${ui}.json`), 'utf8')) as Record<string, string>;
      expect(TERMS.filter((t) => !catalog[`${t} [grammar]`])).toEqual([]);
      setCatalogForTest(ui, catalog);
      for (const note of NOTES) expect(formLabel(note), note).not.toMatch(ENGLISH);
      expect(formLabel('obsolete spelli')).toBe('obsolete spelli');
    });
  }
  it('English stays as Wiktionary words it', () => {
    setCatalogForTest('en', {});
    expect(formLabel('first/third-person singular imperfect indicative')).toBe('first/third-person singular imperfect indicative');
  });
});
