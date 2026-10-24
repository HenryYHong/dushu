// The level the HSK pinyin mode compares with its threshold (src/core/hskLevel.ts), on the real HSK list and dictionary.
import { beforeAll, describe, expect, it } from 'vitest';
import { hskLevels, type HskLevelOf } from '../../src/core/hskLevel';
import type { Dictionary } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';

let dict: Dictionary;
let level: HskLevelOf;
beforeAll(async () => {
  dict = await loadTestDictionary();
  level = hskLevels(dict);
});

describe('hskLevels', () => {
  it('gives a listed word the level of its characters when that is lower: they are what you say', () => {
    expect(dict.hsk('说道')?.hsk3).toBe(7);
    // 说 shuō is listed at 1, and 知道, also at 1, reads 道 as dào: so 1, not 7.
    expect(dict.hsk('说')?.hsk3).toBe(1);
    expect(dict.hsk('知道')?.hsk3).toBe(1);
    expect(dict.lookup('知道').map((e) => e.pinyin)).toContain('zhi1 dao4');
    expect(level('说道', ['shuo1', 'dao4'])).toBe(1);
    expect(level('說道', ['shuo1', 'dao4'])).toBeLessThan(3);
    expect(level('阿姨', ['a1', 'yi2'])).toBe(4); // 姨 comes only with 阿姨
  });

  it('keeps the list level of a listed word read with a neutral tone, which its characters do not tell', () => {
    const listed = dict.hsk('本事')?.hsk3;
    expect(listed).toBeGreaterThan(1);
    expect(level('事', ['shi4'])).toBe(1);
    expect(level('本事', ['ben3', 'shi5'])).toBe(listed);
    // Without a reading in context, the list.
    expect(level('说道')).toBe(7);
  });

  it('looks up a traditional spelling by its simplified form', () => {
    expect(dict.hsk('聽')).toEqual(dict.hsk('听'));
    expect(level('聽', ['ting1'])).toBe(1);
    expect(level('這個', ['zhe4', 'ge4'])).toBe(1);
  });

  it('gives a word the list leaves out the level of its hardest character', () => {
    expect(dict.hsk('一个')).toBeNull();
    expect(level('一个', ['yi1', 'ge4'])).toBe(1);
    expect(level('一個', ['yi1', 'ge4'])).toBe(1);
    expect(level('放在', ['fang4', 'zai4'])).toBe(1);
    expect(level('二十', ['er4', 'shi2'])).toBe(1);
    expect(level('王夫人', ['wang2', 'fu1', 'ren2'])).toBe(Math.max(level('王', ['wang2'])!, level('夫人', ['fu1', 'ren2'])!));
  });

  it('gives a single character the lower of its own level and the words it is read the same way in', () => {
    expect(dict.hsk('时')?.hsk3).toBe(3);
    expect(level('時', ['shi2'])).toBe(1); // 时间
    expect(level('石', ['shi2'])).toBe(dict.hsk('石头')?.hsk3);
  });

  it('counts a character only in the readings the list teaches', () => {
    expect(level('石', ['dan4'])).toBeUndefined();
    expect(level('石头', ['dan4', 'tou5'])).toBe(dict.hsk('石头')?.hsk3); // listed: the list's level stands
    expect(level('石匠', ['dan4', 'jiang4'])).toBeUndefined();
  });

  it('does not learn a full tone from a neutral one', () => {
    // 楚 comes on the list only in 清楚 qīngchu.
    expect(dict.hsk('楚')).toBeNull();
    expect(level('楚', ['chu5'])).toBe(dict.hsk('清楚')?.hsk3);
    expect(level('楚', ['chu3'])).toBeUndefined();
    // A neutral tone in the text is read from the character's full tone.
    expect(level('西', ['xi5'])).toBe(level('西', ['xi1']));
  });

  it('teaches the reading a listed word has, not every word its characters spell', () => {
    // CEDICT also spells biànyí "convenient" with 便宜; the list means piányi, the reading the dictionary gives the word.
    expect(dict.lookup('便宜').map((e) => e.pinyin)).toContain('bian4 yi2');
    expect(dict.pinyinFor('便宜')).toEqual(['pian2', 'yi5']);
    expect(level('宜', ['yi5'])).toBe(dict.hsk('便宜')?.hsk3);
    expect(level('宜', ['yi2'])).toBeGreaterThan(dict.hsk('便宜')!.hsk3!);
  });

  it('teaches a bare character in its usual reading and its neutral ones, the rest through the words that use them', () => {
    // 喝 is listed as hē; hè (to shout) comes with 喝彩.
    expect(dict.pinyinFor('喝')).toEqual(['he1']);
    expect(dict.hsk('喝道')).toBeNull();
    expect(level('喝道', ['he4', 'dao4'])).toBe(dict.hsk('喝彩')?.hsk3);
    expect(level('喝道', ['he4', 'dao4'])).toBeGreaterThan(dict.hsk('喝')!.hsk3!);
    expect(level('喝', ['he4'])).toBe(dict.hsk('喝')?.hsk3); // alone it keeps the list's level
    // 地 is dì by default; the particle de is what the list grades with it.
    expect(dict.pinyinFor('地')).toEqual(['di4']);
    expect(dict.hsk('慢慢地')).toBeNull();
    expect(level('慢慢地', ['man4', 'man4', 'de5'])).toBe(Math.max(level('慢', ['man4'])!, dict.hsk('地')!.hsk3!));
  });

  it('learns the rarer readings of a bare character only from the words that use them', () => {
    // 一骑 after a numeral is jì, which no listed word has: CEDICT gives it to 骑 only as "(Tw) saddle horse".
    expect(dict.lookup('骑').find((e) => e.pinyin === 'ji4')?.defs[0]).toMatch(/^\(Tw\)/);
    expect(dict.hsk('騎馬')).toBeNull();
    expect(level('騎馬', ['qi2', 'ma3'])).toBe(Math.max(level('骑', ['qi2'])!, level('马', ['ma3'])!));
    expect(level('騎馬', ['ji4', 'ma3'])).toBeUndefined();
  });

  it('reads 著 as 着, the simplified form t2s leaves alone', () => {
    expect(dict.toSimplified('跟著')).toBe('跟著');
    expect(dict.char('著')?.simplified).toContain('着');
    expect(level('跟著', ['gen1', 'zhe5'])).toBe(Math.max(level('跟', ['gen1'])!, level('着', ['zhe5'])!));
  });

  it('reads a glyph variant as the character it writes, but not a character of its own', () => {
    expect(dict.char('偸')?.variants).toContain('偷');
    expect(level('偸', ['tou1'])).toBe(level('偷', ['tou1']));
    expect(level('偸', ['tou1'])).toBeDefined();
    expect(level('偸', ['yu2'])).toBeUndefined();
    // Unihan lists 沈 as a variant of 沉, but 沈 is also shěn: a reader of 沉 does not know it.
    expect(dict.char('沈')?.variants).toContain('沉');
    expect(level('沉', ['chen2'])).toBeDefined();
    expect(level('沈', ['chen2'])).toBeUndefined();
  });

  it('does not read a variant with another radical, or two strokes off, as the character it points at', () => {
    // 仝 (朱仝) points at 同 and reads tóng like it, with as many strokes beside the radical, but the radical is 人, not 口.
    expect(dict.char('仝')?.variants).toContain('同');
    expect(dict.char('仝')!.readings.every((r) => dict.char('同')!.readings.includes(r))).toBe(true);
    expect(dict.char('仝')?.radical?.num).not.toBe(dict.char('同')?.radical?.num);
    expect(dict.char('仝')?.radical?.residual).toBe(dict.char('同')?.radical?.residual);
    expect(level('同', ['tong2'])).toBe(1);
    expect(level('仝', ['tong2'])).toBeUndefined();
    // 呌 points at 叫 with the same reading and radical 口, but four strokes beside it against two.
    expect(dict.char('呌')?.variants).toContain('叫');
    expect(dict.char('呌')!.readings.every((r) => dict.char('叫')!.readings.includes(r))).toBe(true);
    expect(dict.char('呌')?.radical?.num).toBe(dict.char('叫')?.radical?.num);
    expect(Math.abs(dict.char('呌')!.radical!.residual - dict.char('叫')!.radical!.residual)).toBe(2);
    expect(level('叫', ['jiao4'])).toBe(1);
    expect(level('呌', ['jiao4'])).toBeUndefined();
  });

  it('does not lend a character the level of the one t2s folds it into, in a reading that one never has', () => {
    expect(dict.toSimplified('乾')).toBe('干');
    expect(dict.hsk('乾')).toEqual(dict.hsk('干'));
    expect(dict.lookup('干').some((e) => e.pinyin.toLowerCase() === 'qian2')).toBe(false);
    expect(level('乾', ['gan1'])).toBeLessThanOrEqual(dict.hsk('干')!.hsk3!);
    expect(level('乾', ['qian2'])).toBeUndefined();
  });

  it('leaves a word with a character no listed word has without a level', () => {
    expect(level('猹', ['cha2'])).toBeUndefined();
    expect(level('闰土', ['run4', 'tu3'])).toBeUndefined();
  });

  it('without a reading, counts any reading; with a broken one, only the list', () => {
    expect(level('石')).toBe(level('石', ['shi2']));
    expect(level('一个', ['yi1'])).toBeUndefined();
    expect(level('一个', ['yi1', ''])).toBeUndefined();
    expect(level('安心', ['an1'])).toBe(7);
  });

  it('is one function per dictionary, and answers the same twice', () => {
    expect(hskLevels(dict)).toBe(level);
    expect(level('放在', ['fang4', 'zai4'])).toBe(level('放在', ['fang4', 'zai4']));
  });
});
