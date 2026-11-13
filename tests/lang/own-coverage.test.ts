// Every word with a level, and every common word, has a meaning in its own language on the card, as a reader of that language
// taps it: the 20,000 commonest of a spaced language (A1–C2, through the real engine and withOwnDictionary); every HSK word and
// the 20,000 commonest in Chinese; every JLPT and common (JMdict priority) word in Japanese, under its own spelling. From the
// shipped own-language dictionaries (public/data/<id>/native.tsv.gz, data/native.tsv.gz).
// Where Wiktionary has no meaning, scripts/lang/native/written/<id>.tsv has one.
//
// DUSHU_OWN_MISSING=<file> writes the words still without one there, for writing them: language, word, the key a meaning goes
// under and the parts of speech it can have (the card's first entry), its English meanings, and the word's other entries.
import { gunzipSync } from 'node:zlib';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadLang } from './spaced/load';
import {
  OWN_SOURCE, japaneseOwn, loadOwnDictionary, ownMeanings, parseOwnTable, resetOwnDictionary, setReaderLanguage, withOwnDictionary,
} from '../../src/lang/ownDictionary';

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

describe('every HSK and JLPT word, and the commonest Chinese and Japanese words, has a meaning in its own language', () => {
  const cedict = new Map<string, string[][]>();
  for (const file of ['cedict.tsv.gz', 'cedict-extra.tsv.gz']) {
    for (const c of rows(join(DATA, file))) cedict.set(c[1], [...(cedict.get(c[1]) ?? []), c]);
  }
  const zhOwn = async () => {
    setReaderLanguage('zh');
    await loadOwnDictionary('zh', '/data/', async () => gunzipSync(readFileSync(join(DATA, 'native.tsv.gz'))).toString('utf8'));
  };
  /** A simplified word's meanings in Chinese, by any spelling the card tries (CC-CEDICT's traditional and simplified). */
  const inChinese = (simp: string, trad = simp) => ownMeanings('zh', [trad, simp, ...(cedict.get(simp) ?? []).flatMap((e) => [e[0], e[1]])]);

  it('Chinese: every HSK word', async () => {
    await zhOwn();
    const missing = rows(join(DATA, 'hsk.tsv.gz')).filter(([simp, trad]) => !inChinese(simp, trad || simp));
    console.log(`zh: ${missing.length} HSK words lack a meaning in Chinese`, missing.slice(0, 30).map((c) => c[0]).join(' '));
    expect(missing.slice(0, 20).map((c) => c[0])).toEqual([]);
  });

  it('Chinese: the 20,000 commonest words (by jieba\'s counts) but names and rare characters (outside GB 2312)', async () => {
    await zhOwn();
    const gb2312 = new Set<string>();
    const gbk = new TextDecoder('gbk');
    for (let a = 0xb0; a <= 0xf7; a++) for (let b = 0xa1; b <= 0xfe; b++) gb2312.add(gbk.decode(new Uint8Array([a, b])));
    const common = rows(join(DATA, 'words.tsv.gz')).filter(([w]) => cedict.has(w))
      .map(([w, n]) => [w, Number(n)] as const).sort((x, y) => y[1] - x[1]).slice(0, 20000).map(([w]) => w);
    const missing = common.filter((w) => cedict.get(w)!.some((e) => /^[a-z]/.test(e[2])) && [...w].every((ch) => gb2312.has(ch)) && !inChinese(w));
    console.log(`zh: ${missing.length} of the commonest words lack a meaning in Chinese`, missing.slice(0, 30).join(' '));
    expect(missing.slice(0, 20)).toEqual([]);
  });

  it('Japanese: every JLPT and common word, by its own spelling (a word in kanji never by another word read the same)', () => {
    const table = parseOwnTable(gunzipSync(readFileSync(join(DATA, 'ja', 'native.tsv.gz'))).toString('utf8'));
    const forms = (col: string) => col.split(';').map((f) => f.split('#')[0].split('@')[0]).filter(Boolean);
    const kana = (s: string) => /^[぀-ヿー]+$/.test(s);
    const missing = rows(join(DATA, 'ja', 'jmdict.tsv.gz')).filter((c) => {
      if (!c[2] && !/#P/.test(c[0] + c[1])) return false;
      const all = [...forms(c[0]), ...forms(c[1])];
      const found = japaneseOwn(table, all, forms(c[1])[0]);
      // A word written in kanji: found under one of its own spellings, or under its reading only by entries naming its kanji.
      const written = all.filter((s) => !kana(s));
      return !found || (written.length > 0 && !written.some((s) => table.get(s)?.length) && !found.some((e) => e.kanji?.length));
    });
    console.log(`ja: ${missing.length} JLPT and common words lack a meaning in Japanese`, missing.slice(0, 30).map((c) => [...forms(c[0]), ...forms(c[1])][0]).join(' '));
    expect(missing.slice(0, 20).map((c) => c[0] || c[1])).toEqual([]);
  });
});
