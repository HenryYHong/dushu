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
  ['a template\'s name', /(?:Template|Vorlage|模板|Шаблон):\S/],
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

// Labels ({…} before a meaning) are a Wiktionary's own labels: never a usage template kaikki did not expand (Spanish "utci"),
// a word that only joins pieces of a note it split (German "und", "auch"), a piece starting mid-sentence ("veces despectivo")
// or a label with the note's comma still on it ("umgangssprachlich,").
const NOT_LABELS: [string, string, RegExp][] = [
  ['es', 'a usage template', /^u[mt][a-z]{1,5}\d*$/],
  ['es', 'a joining word', /^(?:o|y|veces|se aplica|se emplea|personas)$/],
  ['es', 'a piece starting mid-sentence', /^(?:veces|o|y|ni) /],
  ['de', 'a joining word', /^(?:und|oder|auch|oft|sonst|kurz|nur|bes\.|insbesondere)$/],
  ['', 'a trailing comma or colon', /[,;:]$/],
];

describe('own-language dictionaries show only real labels', () => {
  for (const file of files) {
    const lang = file.slice(DATA.length + 1).split('/')[0];
    const checks = NOT_LABELS.filter(([l]) => !l || l === lang);
    it(file.slice(DATA.length + 1), () => {
      const bad: string[] = [];
      for (const line of gunzipSync(readFileSync(file)).toString('utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        for (const m of line.split('\t').slice(3)) {
          const labels = /^\{([^}]*)\}/.exec(m)?.[1].split(', ') ?? [];
          for (const label of labels) {
            const hit = checks.find(([, , re]) => re.test(label));
            if (hit) bad.push(`${hit[1]}: ${line.split('\t')[0]} {${label}}`);
          }
        }
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }
});
