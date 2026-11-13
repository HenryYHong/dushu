// The own-language dictionaries as shipped (public/data/**/native.tsv.gz, scripts/lang/native/build.py): no meaning shows
// Wiktionary markup that kaikki could not expand. The patterns are wiki syntax, not words of any entry, so they hold for any
// rebuild. (Chemistry's "3-[[(3-methylphenyl)amino]…" and math's "10^{10^{100}}" are text, not markup.)
import { gunzipSync } from 'node:zlib';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DATA = join(__dirname, '..', '..', 'public', 'data');
const files = [join(DATA, 'native.tsv.gz'), ...readdirSync(DATA).map((d) => join(DATA, d, 'native.tsv.gz'))].filter(existsSync);

const MARKUP: [string, RegExp][] = [
  ['a magic word', /__[A-Z]+__/],
  ['a template', /\{\{|\}\}/],
  ['a link', /\[\[(?!\()/],
  ['a footnote mark', /\^\(\[|^\^?[‡⁜†]/],
  ['a pointer page', /的發音和釋義，請見/],
  ['a request for a meaning', /需要翻譯|請協助添加|rfdef/],
  ['table markup', /wikitable|class=['"]|displaystyle/],
  ['a stray mark in front', /^[}\],;:]/],
];

/** The meanings of a line (after the word, part of speech and hint), each without its {labels}. */
const meanings = (line: string) => line.split('\t').slice(3).map((m) => m.replace(/^\{[^}]*\}/, ''));

describe('own-language dictionaries carry no wiki markup', () => {
  it('finds the files', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });
  for (const file of files) {
    it(file.slice(DATA.length + 1), () => {
      const bad: string[] = [];
      for (const line of gunzipSync(readFileSync(file)).toString('utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        for (const m of meanings(line)) {
          const hit = MARKUP.find(([, re]) => re.test(m));
          // Math in English ("10^{10^{100}}", "{\\frac…") is text: only the template braces of a word, not a formula, count.
          if (hit && !(hit[0] === 'a template' && /\^\{|\\[a-z]+\{/.test(m))) bad.push(`${hit[0]}: ${line.split('\t')[0]}`);
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }
});
