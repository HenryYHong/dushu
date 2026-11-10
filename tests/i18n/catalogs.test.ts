// The app's words in other languages (src/i18n): strings.json lists every string the code shows (scripts/i18n/extract.mjs),
// and each catalog translates them, keeping the {values} each one fills in.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { UI_LANGS, guessUiLang, langName, setCatalogForTest, tt, ttn } from '../../src/i18n';
// @ts-expect-error a build script, plain JavaScript
import { extract } from '../../scripts/i18n/extract.mjs';

const DIR = join(__dirname, '../../src/i18n');
const strings = JSON.parse(readFileSync(join(DIR, 'strings.json'), 'utf8')) as Record<string, { one?: string; where: string[] }>;
const catalogs = readdirSync(join(DIR, 'catalogs')).filter((f) => f.endsWith('.json'));
const holes = (s: string) => new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

afterEach(() => setCatalogForTest('en', {}));

describe('the strings', () => {
  it('strings.json lists every string the code passes to tt, ttm and ttn (node scripts/i18n/extract.mjs)', () => {
    expect(extract()).toEqual(strings);
  });
  it('a catalog for every language but English, and none for a language the app does not offer', () => {
    expect(catalogs.map((f) => f.replace('.json', '')).sort()).toEqual(UI_LANGS.filter((l) => l !== 'en').sort());
  });
});

describe.each(catalogs)('%s', (file) => {
  const c = JSON.parse(readFileSync(join(DIR, 'catalogs', file), 'utf8')) as Record<string, string | Record<string, string>>;
  it('translates only strings the app has, keeping their values', () => {
    const bad: string[] = [];
    for (const [src, tr] of Object.entries(c)) {
      const s = strings[src];
      if (!s) { bad.push(`not in strings.json: ${src}`); continue; }
      const want = holes(src);
      const forms = typeof tr === 'string' ? [tr] : Object.values(tr);
      if (typeof tr !== 'string' && (s.one === undefined || !tr.other)) bad.push(`a count needs an 'other' form, a sentence a string: ${src}`);
      if (typeof tr === 'string' && s.one !== undefined && /\{n\}/.test(src) && !/\{n\}/.test(tr)) bad.push(`a count lost its number: ${src}`);
      for (const f of forms) {
        if (!f.trim()) { bad.push(`empty: ${src}`); continue; }
        const got = holes(f);
        for (const k of got) if (!want.has(k)) bad.push(`{${k}} is not in the English: ${src} → ${f}`);
        for (const k of want) if (k !== 'n' && !got.has(k)) bad.push(`{${k}} left out: ${src} → ${f}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('covers nearly every string (a missing one shows in English)', () => {
    const total = Object.keys(strings).length;
    const have = Object.keys(strings).filter((k) => k in c).length;
    expect(have / Math.max(1, total)).toBeGreaterThanOrEqual(0.95);
  });
});

describe('tt and ttn', () => {
  it('English reads as written, with its values filled in', () => {
    expect(tt('Delete all data')).toBe('Delete all data');
    expect(tt('Added {title}.', { title: 'Marianela' })).toBe('Added Marianela.');
    expect(ttn(1, '{n} word', '{n} words')).toBe('1 word');
    expect(ttn(1234, '{n} word', '{n} words')).toBe('1,234 words');
    expect(langName('es', 'Spanish')).toBe('Spanish');
  });
  it('a catalog gives the translation, each count in the form its language takes, and English where it has none', () => {
    setCatalogForTest('ru', { 'Delete all data': 'Удалить все данные', '{n} words': { one: '{n} слово', few: '{n} слова', many: '{n} слов', other: '{n} слова' } });
    expect(tt('Delete all data')).toBe('Удалить все данные');
    expect(tt('Settings')).toBe('Settings');
    expect([1, 3, 5, 21].map((n) => ttn(n, '{n} word', '{n} words'))).toEqual(['1 слово', '3 слова', '5 слов', '21 слово']);
    expect(langName('es', 'Spanish')).toBe('испанский');
  });
  it('takes the browser’s language when the app has it', () => {
    expect(guessUiLang(['fr-CA', 'en'])).toBe('fr');
    expect(guessUiLang(['zh-TW'])).toBe('zh-Hant');
    expect(guessUiLang(['zh-CN'])).toBe('zh');
    expect(guessUiLang(['nl', 'de'])).toBe('de');
    expect(guessUiLang(['nl'])).toBe('en');
  });
});
