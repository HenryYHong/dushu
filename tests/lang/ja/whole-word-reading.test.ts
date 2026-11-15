// Furigana for a word the analyzer reads piece by piece but the dictionary has whole: a number and what follows it (一晩
// ひとばん, not いち + ばん "number one"; 万歳 ばんざい, not いちまんさい), 三毛 the cat's みけ, 百合 ゆり. A reading the dictionary
// gives the whole word stays (一日中 いちにちじゅう, 三人 さんにん), and so do the prefixes (御飯, 各国). 皆 standing alone is
// みな, not the prefix かい of 皆無.
import { beforeAll, expect, it } from 'vitest';
import type { LangEngine } from '../../../src/lang/types';
import { loadJa } from './load';

let ja: LangEngine;
beforeAll(async () => { ja = await loadJa(); }, 60000);
const reading = (sentence: string, word: string) => ja.segment(sentence).find((t) => t.text === word)?.reading;

it('reads a word the dictionary has whole as the dictionary does', () => {
  expect(reading('うちへ帰って、一晩寝たらそんなに', '一晩')).toBe('ひとばん');
  expect(reading('挨拶が一通り済んだら、校長が', '一通り')).toBe('ひととおり');
  expect(reading('吾輩が隣家の三毛を訪問する時', '三毛')).toBe('みけ');
  expect(reading('皆で万歳を唱えた。', '万歳')).toBe('ばんざい');
  expect(reading('庭に百合が咲いた。', '百合')).toBe('ゆり');
});

it('keeps a reading the dictionary gives the whole word', () => {
  expect(reading('一日中歩いた。', '一日中')).toBe('いちにちじゅう');
  expect(reading('三人で行った。', '三人')).toBe('さんにん');
  expect(reading('十分に休んだ。', '十分')).toBe('じゅうぶん');
  expect(reading('御飯を食べる。', '御飯')).toBe('ごはん');
  expect(reading('各国の代表。', '各国')).toBe('かっこく');
});

it('reads 皆 standing alone as みな', () => {
  expect(reading('兎も蛇も皆嬢様に谷川の水を', '皆')).toBe('みな');
});
