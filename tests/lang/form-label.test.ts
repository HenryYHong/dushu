// A word form's note ("first/third-person singular imperfect indicative of vivir") in the reader's interface language, term
// by term (src/lang/formLabel.ts; the terms are '<term> [grammar]' in src/i18n/catalogs). Every interface language has every
// term, the common notes come out with no English grammar word left, and a note with an unknown word stays English whole.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { formLabel } from '../../src/lang/formLabel';
import { describeForms } from '../../src/lang/ja/forms';
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

// Japanese verb and adjective forms (src/lang/ja/forms.ts): every label in every interface language, the construction in kana,
// never romaji ("progressive (te iru)" is 「〜ている」（進行）, "進行（ている）", "progresivo (ている)").
const JA_SOURCE = readFileSync(join(__dirname, '..', '..', 'src', 'lang', 'ja', 'forms.ts'), 'utf8');
const JA_LABELS = [...JA_SOURCE.matchAll(/ttx\('([^']+)', 'ja form'\)/g)].map((m) => m[1]);
const ROMAJI = /\b(?:iru|oru|shimau|aru|oku|nakereba|naranai|ikenai|hoshii|nasai|nasaru|sugiru|yasui|nikui|gatai|zurai|kakaru|naosu|kiru|dasu|garu|beki|nagara|tai|sou|cha|tara)\b/;

describe('Japanese form names in the interface language', () => {
  afterAll(() => setCatalogForTest('en', {}));
  it('finds the labels', () => expect(JA_LABELS.length).toBeGreaterThan(50));
  for (const ui of UI_LANGS.filter((l) => l !== 'en')) {
    it(ui, () => {
      const catalog = JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'i18n', 'catalogs', `${ui}.json`), 'utf8')) as Record<string, string>;
      expect(JA_LABELS.filter((l) => !catalog[`${l} [ja form]`])).toEqual([]);
      expect(JA_LABELS.filter((l) => ROMAJI.test(catalog[`${l} [ja form]`]))).toEqual([]);
      setCatalogForTest(ui, catalog);
      expect(describeForms(['causative', 'passive', 'negative', 'past'])).not.toMatch(/causative|passive|negative|past/);
    });
  }
  it('Japanese lists with 、', () => {
    setCatalogForTest('ja', JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'i18n', 'catalogs', 'ja.json'), 'utf8')));
    expect(describeForms(['progressive (te iru)', 'past'])).toBe('「〜ている」（進行）、過去');
    setCatalogForTest('en', {});
    expect(describeForms(['progressive (te iru)', 'past'])).toBe('progressive (te iru), past');
  });
});

// What kind of name a Japanese name is (src/lang/ja/index.ts NAME_GLOSS): 姓, 地名 for a reader of Japanese, not "surname".
const NAME_KINDS = [...new Set(['ja/index.ts', 'ownDictionary.ts'].flatMap((f) => [...readFileSync(join(__dirname, '..', '..', 'src', 'lang', f), 'utf8')
  .matchAll(/ttx\((?:'([^']+)'|"([^"]+)"), 'name kind'\)/g)].map((m) => m[1] ?? m[2])))];
describe('name kinds in the interface language', () => {
  it('finds them', () => expect(NAME_KINDS.length).toBe(9));
  for (const ui of UI_LANGS.filter((l) => l !== 'en')) {
    it(ui, () => {
      const catalog = JSON.parse(readFileSync(join(__dirname, '..', '..', 'src', 'i18n', 'catalogs', `${ui}.json`), 'utf8')) as Record<string, string>;
      expect(NAME_KINDS.filter((k) => !catalog[`${k} [name kind]`])).toEqual([]);
    });
  }
});
