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
  ['a request for a source', /référence nécessaire|Exemple d.utilisation manquant/],
  ['an example quoted with its source', / — \((?=[^()]*(?:\b1[5-9]\d\d\b|\b20[0-2]\d\b|\bpage\b))[^()]*\)\s*$/],
  ['a sense number of the page', /\p{L}\p{Ll}{2}[_^]\(\d/u],
  ['a sense number under a word', /\p{L}\p{Ll}{2}(?<!log)[₀-₉]/u],
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
  ['zh', 'pinyin (a note, not a label)', /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/],
];

describe('own-language dictionaries show only real labels', () => {
  for (const file of files) {
    const rel = file.slice(DATA.length + 1);
    const lang = rel.includes('/') ? rel.split('/')[0] : 'zh';
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

// kaikki hands most usage labels on as English tags ("coloquial" as colloquial), and the builder puts them back in the
// language's words (TAG_LABELS in scripts/lang/native/build.py). If that stopped, cards would quietly lose "colloquial",
// "dated" and "vulgar" (as they did before 2026-11-14): each language's commonest usage label must stay common. The floors
// are about half the counts then.
const USAGE_FLOORS: [string, string, number][] = [
  ['es', 'coloquial', 2000], ['fr', 'Familier', 2000], ['de', 'umgangssprachlich', 1800], ['it', 'figurato', 1800], ['pt', 'figurado', 800],
  ['zh', '書面語', 1500], ['zh', '粵語', 250], ['ja', '古風', 700],
];

describe('own-language dictionaries keep their usage labels', () => {
  for (const [lang, label, floor] of USAGE_FLOORS) {
    it(`${lang}: ${label}`, () => {
      let n = 0;
      for (const line of gunzipSync(readFileSync(lang === 'zh' ? join(DATA, 'native.tsv.gz') : join(DATA, lang, 'native.tsv.gz'))).toString('utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        for (const m of line.split('\t').slice(3)) if (/^\{([^}]*)\}/.exec(m)?.[1].split(', ').includes(label)) n++;
      }
      expect(n).toBeGreaterThanOrEqual(floor);
    });
  }
});

// A reader of standard Chinese gets a character's standard meanings before its obsolete ones (靚 漂亮 before 棄用 召見).
describe('Chinese cards put obsolete meanings last', () => {
  it('no obsolete meaning before an unmarked one', () => {
    const bad: string[] = [];
    for (const line of gunzipSync(readFileSync(join(DATA, 'native.tsv.gz'))).toString('utf8').split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const old = line.split('\t').slice(3).map((m) => /^\{([^}]*)\}/.exec(m)?.[1].split(', ').some((l) => ['棄用', '古語', '過時', '罕用'].includes(l)) ?? false);
      if (old.some((o, i) => o && old.slice(i + 1).some((later) => !later))) bad.push(line.split('\t')[0]);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

// Every language's card leads with a current meaning, not one its Wiktionary marks obsolete or dated, when it has one (French
// "tout de suite" is "sur-le-champ" first, not the old "sans interruption").
const OLD_LABELS = new Set(['old', 'old-fashioned', 'desusado', 'anticuado', 'sin uso', 'Désuet', 'Vieilli', 'veraltet', 'veraltend', 'früher', 'obsoleto', 'antico', 'arcaico', 'em desuso']);

describe('cards lead with a current meaning', () => {
  for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt']) {
    it(lang, () => {
      const bad: string[] = [];
      for (const line of gunzipSync(readFileSync(join(DATA, lang, 'native.tsv.gz'))).toString('utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const old = line.split('\t').slice(3).map((m) => /^\{([^}]*)\}/.exec(m)?.[1].split(', ').some((l) => OLD_LABELS.has(l)) ?? false);
        if (old[0] && old.some((o) => !o)) bad.push(line.split('\t')[0]);
      }
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }
});

// A name comes after the word it is also (Spanish "rosa" the flower before Rosa the given name, "tiro" the shot before Tyre).
describe('names come after the common word', () => {
  for (const lang of ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru']) {
    it(lang, () => {
      const seen = new Map<string, string[]>();
      for (const line of gunzipSync(readFileSync(join(DATA, lang, 'native.tsv.gz'))).toString('utf8').split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const [key, pos] = line.split('\t');
        seen.set(key, [...(seen.get(key) ?? []), pos]);
      }
      const bad = [...seen].filter(([, poses]) => poses.indexOf('proper noun') >= 0 && poses.slice(poses.indexOf('proper noun') + 1).length > 0).map(([k]) => k);
      expect(bad.slice(0, 10)).toEqual([]);
    });
  }
});

// A character on a Chinese word's card shows one meaning: its first (src/ui/popup/wordView.ts charGloss). For the commonest
// characters that is never a pointer to another character, a surname or the taxonomic sense (人 was "生物分類法中的一科").
describe('the commonest characters lead with an everyday meaning', () => {
  it('300 commonest', () => {
    const rows = (f: string) => gunzipSync(readFileSync(join(DATA, f))).toString('utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
    const freq = new Map<string, number>();
    for (const [w, n] of rows('words.tsv.gz')) if (/^\d+$/.test(n ?? '')) for (const ch of w) freq.set(ch, (freq.get(ch) ?? 0) + Number(n));
    const s2t = new Map(rows('s2t.tsv.gz').map((c) => [c[0], c[1]]));
    const first = new Map<string, string>();
    for (const c of rows('native.tsv.gz')) if (!first.has(c[0]) && c[3]) first.set(c[0], c[3]);
    const top = [...freq].filter(([ch]) => /^[一-鿿]$/.test(ch)).sort((a, b) => b[1] - a[1]).slice(0, 300).map(([ch]) => ch);
    const bad = top.map((ch) => [ch, first.get(s2t.get(ch) ?? ch) ?? first.get(ch) ?? ''] as const)
      .filter(([, m]) => /本字|異體字|簡體字|^\{?姓|^姓氏|^同「|生物分類|^（ㄅ/.test(m)).map(([ch, m]) => `${ch}: ${m}`);
    expect(bad).toEqual([]);
  });
});
