// A kanji chip under a Japanese word says how the kanji is read in that word (src/lang/ja/index.ts charsOf: the word's
// reading split over its kanji, as furigana is), not the kanji's first kun reading (釈 in 御釈迦様 is しゃ(く), not とく).
import { beforeAll, expect, it } from 'vitest';
import type { LangEngine } from '../../../src/lang/types';
import { loadJa } from './load';

let ja: LangEngine;
beforeAll(async () => { ja = await loadJa(); }, 60000);

const readHere = (sentence: string, word: string) => {
  const t = ja.segment(sentence).find((x) => x.text === word)!;
  return Object.fromEntries((ja.lookup(word, { token: t, sentence }).chars ?? []).map((k) => [k.char, k.readHere]));
};

it('reads each kanji as the word does', () => {
  expect(readHere('御釈迦様は極楽の蓮池のふちを', '極楽')).toEqual({ 極: 'ごく', 楽: 'らく' });
  expect(readHere('学校へ行く。', '学校')).toEqual({ 学: 'がっ', 校: 'こう' });
  const s = readHere('ある日の事でございます。御釈迦様は極楽の蓮池のふちを', '御釈迦様');
  expect(s['釈']).toMatch(/^しゃ/);
});
