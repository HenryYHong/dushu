// Every word with a level has a meaning in its own language on the card, as a reader of that language taps it: the 20,000
// commonest of a spaced language (A1–C2, through the real engine and withOwnDictionary), every HSK word in Chinese and every
// JLPT word in Japanese, from the shipped own-language dictionaries (public/data/<id>/native.tsv.gz, data/native.tsv.gz).
// Where Wiktionary has no meaning, scripts/lang/native/written/<id>.tsv has one.
//
// DUSHU_OWN_MISSING=<file> writes the words still without one there, for writing them: language, word, the key a meaning goes
// under and the parts of speech it can have (the card's first entry), its English meanings, and the word's other entries.
import { gunzipSync } from 'node:zlib';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadLang } from './spaced/load';
import { OWN_SOURCE, loadOwnDictionary, ownMeanings, resetOwnDictionary, setReaderLanguage, withOwnDictionary } from '../../src/lang/ownDictionary';

const DATA = join(__dirname, '..', '..', 'public', 'data');
const OUT = process.env.DUSHU_OWN_MISSING;
const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru'] as const;

afterAll(() => resetOwnDictionary());

describe('every word with a level has a meaning in its own language', () => {
  for (const id of LANGS) {
    it(id, async () => {
      const engine = await loadLang(id);
      setReaderLanguage(id);
      await loadOwnDictionary(id, `/data/${id}/`, async () => gunzipSync(readFileSync(join(DATA, id, 'native.tsv.gz'))).toString('utf8'));
      const own = withOwnDictionary(engine);
      const missing: string[] = [];
      for (const key of engine.rankLevelWords!(6)) {
        const lu = own.lookup(key);
        if (!lu.entries.length || lu.entries.some((e) => e.source === OWN_SOURCE)) continue;
        missing.push(key);
        if (OUT) {
          // The key and part of speech a meaning is written under: the first entry's word, as the card looks it up.
          const [first, ...rest] = engine.lookup(key).entries;
          const english = (e: typeof first) => e.senses.slice(0, 3).map((s) => s.glosses.join('; ')).join(' / ').slice(0, 200);
          appendFileSync(OUT, [id, key, engine.normalize(first.head), [...new Set(first.senses.map((s) => s.pos ?? ''))].join(','), english(first),
            rest.slice(0, 2).map((e) => `${e.head} (${e.senses[0]?.pos ?? ''}): ${english(e).slice(0, 80)}`).join(' ¦ ')].join('\t') + '\n');
        }
      }
      console.log(`${id}: ${missing.length} of the leveled words lack an own-language meaning`, missing.slice(0, 30).join(' '));
      expect(missing.slice(0, 20)).toEqual([]);
    }, 300_000);
  }
});

/** A data file's rows (comment lines left out), split on tabs. */
const rows = (path: string) => gunzipSync(readFileSync(path)).toString('utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));

describe('every HSK and JLPT word has a meaning in its own language', () => {
  it('Chinese: every HSK word, by any spelling the card tries (CC-CEDICT\'s traditional and simplified)', async () => {
    setReaderLanguage('zh');
    await loadOwnDictionary('zh', '/data/', async () => gunzipSync(readFileSync(join(DATA, 'native.tsv.gz'))).toString('utf8'));
    const spellings = new Map<string, string[]>();
    for (const file of ['cedict.tsv.gz', 'cedict-extra.tsv.gz']) {
      for (const [trad, simp] of rows(join(DATA, file))) spellings.set(simp, [...(spellings.get(simp) ?? []), trad, simp]);
    }
    const missing = rows(join(DATA, 'hsk.tsv.gz')).filter(([simp, trad]) => !ownMeanings('zh', [trad || simp, simp, ...(spellings.get(simp) ?? [])]));
    console.log(`zh: ${missing.length} HSK words lack a meaning in Chinese`, missing.slice(0, 30).map((c) => c[0]).join(' '));
    expect(missing.slice(0, 20).map((c) => c[0])).toEqual([]);
  });

  it('Japanese: every JLPT word, by any of its spellings', async () => {
    setReaderLanguage('ja');
    await loadOwnDictionary('ja', '/data/ja/', async () => gunzipSync(readFileSync(join(DATA, 'ja', 'native.tsv.gz'))).toString('utf8'));
    const forms = (col: string) => col.split(';').map((f) => f.split('#')[0].split('@')[0]).filter(Boolean);
    const missing = rows(join(DATA, 'ja', 'jmdict.tsv.gz')).filter((c) => c[2] && !ownMeanings('ja', [...forms(c[0]), ...forms(c[1])]));
    console.log(`ja: ${missing.length} JLPT words lack a meaning in Japanese`, missing.slice(0, 30).map((c) => [...forms(c[0]), ...forms(c[1])][0]).join(' '));
    expect(missing.slice(0, 20).map((c) => c[0] || c[1])).toEqual([]);
  });
});
