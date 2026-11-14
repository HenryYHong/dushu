// A kanji chip under a Japanese word gives a reader of Japanese the kanji's meaning in Japanese for the reading it shows
// (src/lang/ownDictionary.ts kanjiOwnMeaning); KANJIDIC's are English. Anyone else keeps KANJIDIC's.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { kanjiOwnMeaning, loadOwnDictionary, resetOwnDictionary, setReaderLanguage } from '../../src/lang/ownDictionary';

const native = () => gunzipSync(readFileSync(join(__dirname, '..', '..', 'public', 'data', 'ja', 'native.tsv.gz'))).toString('utf8');
afterAll(() => { resetOwnDictionary(); setReaderLanguage(undefined); });

it('a reader of Japanese gets the meaning in Japanese for the reading shown', async () => {
  resetOwnDictionary();
  setReaderLanguage('ja');
  await loadOwnDictionary('ja', '/data/ja/', async () => native());
  expect(kanjiOwnMeaning('中', 'なか')).toMatch(/内側/);
  expect(kanjiOwnMeaning('中', 'チュウ')).not.toMatch(/内側/); // the on reading, in katakana as KANJIDIC writes it
  expect(kanjiOwnMeaning('中', 'なか')).not.toMatch(/[A-Za-z]/);
  // A reading cut short in a word (学 in 学校: がっ) finds the kanji's full one (がく).
  expect(kanjiOwnMeaning('学', 'がっ')).toBe(kanjiOwnMeaning('学', 'がく'));
  expect(kanjiOwnMeaning('学', 'がく')).not.toBeNull();
  expect(kanjiOwnMeaning('釈', 'しゃ')).toBe(kanjiOwnMeaning('釈', 'しゃく'));
  // A kana word of the same sound is another word: 釈 read とく is not とく (ておく).
  expect(kanjiOwnMeaning('釈', 'とく') ?? '').not.toMatch(/ておく|て おく/);
});

it('anyone else gets none (the chip keeps KANJIDIC)', () => {
  setReaderLanguage('en');
  expect(kanjiOwnMeaning('中', 'なか')).toBeNull();
});
