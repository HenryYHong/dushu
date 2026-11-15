// A man's given name the book prints a reading over (末造《すえぞう》 in Ogai's 雁) is the name, read so wherever it stands
// again, though JMdict has the kanji as a word read otherwise (末造 ばつぞう "a degenerate age"); a word the book reads as the
// dictionary does (工作《こうさく》) stays the word. And a reader of Japanese gets the meanings of the word as the page reads it
// (真中《まんなか》: JMdict's 真中 is read まなか, Wiktionary's lines are under まんなか), under any spelling of its kanji.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import type { LangEngine } from '../../../src/lang/types';
import { parseAozoraRuby } from '../../../src/import/aozora';
import { OWN_SOURCE, loadOwnDictionary, resetOwnDictionary, setReaderLanguage, withOwnDictionary } from '../../../src/lang/ownDictionary';
import { loadJa } from './load';

let ja: LangEngine;
beforeAll(async () => { ja = await loadJa(); }, 60000);

const read = (raw: string, word: string, engine = ja) => {
  const { text, ruby } = parseAozoraRuby(raw);
  const t = engine.segment(text, { ruby }).find((x) => x.text === word)!;
  return { token: t, lu: engine.lookup(word, { token: t, sentence: text }) };
};

it('reads a printed given name as the name, there and later', () => {
  ja.beginBook?.();
  const first = read('この小使の一人に末造《すえぞう》と云う男がいた。', '末造');
  expect(first.token.reading).toBe('すえぞう');
  expect(first.lu.entries[0].source).toBe('name');
  const later = read('末造は小使ではなかった。', '末造');
  expect(later.token.reading).toBe('すえぞう');
  expect(later.lu.entries[0].source).toBe('name');
});

it('keeps a word the book reads as the dictionary does', () => {
  ja.beginBook?.();
  const w = read('紙で工作《こうさく》をした。', '工作');
  expect(w.lu.entries[0].source).not.toBe('name');
  expect(w.lu.entries[0].reading).toBe('こうさく');
});

it("gives a Japanese reader the meanings of the page's reading", async () => {
  resetOwnDictionary();
  setReaderLanguage('ja');
  await loadOwnDictionary('ja', '/data/ja/', async () => gunzipSync(readFileSync(join(__dirname, '..', '..', '..', 'public', 'data', 'ja', 'native.tsv.gz'))).toString('utf8'));
  const own = withOwnDictionary(ja);
  ja.beginBook?.();
  const { lu } = read('庭の真中《まんなか》に栗の木がある。', '真中', own);
  expect(lu.entries[0].source).toBe(OWN_SOURCE);
  expect(lu.entries[0].reading).toBe('まんなか');
  expect(lu.entries[0].senses[0].glosses[0]).toMatch(/中/);
  // The same kanji spelled with 御 or お and other okurigana: Wiktionary's おしまい names 御仕舞, JMdict お仕舞い.
  const end = read('これでおしまいだ。', 'おしまい', own);
  expect(end.lu.entries[0].source).toBe(OWN_SOURCE);
  resetOwnDictionary();
});
