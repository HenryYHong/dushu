// HSK levels by reading (dict.hsk(word, pinyin), hskReadings, hskWords): on the real data, the official 2021 list's levels
// (public/data/hsk.tsv.gz, built from ivankra/hsk30), and on tiny hand-made files for the file format.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { hskLevels } from '../../src/core/hskLevel';
import type { Dictionary } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { miniDict } from '../helpers/mini';

let dict: Dictionary;
beforeAll(async () => { dict = await loadTestDictionary(); });

/** hsk3 of `word` read as `pinyin` (numbered syllables, space-separated). */
const at = (word: string, pinyin: string) => dict.hsk(word, pinyin.split(' '))?.hsk3;

describe('dict.hsk by reading, on the official list', () => {
  it('grades each reading of a polyphone at its own level', () => {
    expect(at('行', 'xing2')).toBe(1);
    expect(at('行', 'hang2')).toBe(3);
    expect(at('得', 'de2')).toBe(2);
    expect(at('得', 'de5')).toBe(2);
    expect(at('得', 'dei3')).toBe(4);
    expect(at('好', 'hao3')).toBe(1);
    expect(at('好', 'hao4')).toBe(4);
    expect(at('看', 'kan1')).toBe(6);
    expect(at('了', 'liao3')).toBe(3);
    expect(at('着', 'zhao2')).toBe(4);
    expect(at('重', 'chong2')).toBe(3);
    expect(at('打', 'da2')).toBe(4);
    expect(at('为', 'wei2')).toBe(3);
    expect(at('只', 'zhi1')).toBe(3);
    expect(at('当', 'dang4')).toBe(6);
    expect(at('卡', 'qia3')).toBe(7);
    expect(at('传', 'zhuan4')).toBe(7);
    expect(at('地方', 'di4 fang5')).toBe(1);
    expect(at('地方', 'di4 fang1')).toBe(4);
    // Both readings on the list at the same level.
    expect(at('长', 'zhang3')).toBe(2);
    expect(at('地', 'di4')).toBe(1);
    expect(at('还', 'huan2')).toBe(1);
  });

  it('gives no level to a reading the list does not have, and names the ones it does', () => {
    expect(dict.hsk('教', ['jiao1'])?.hsk3).toBe(1);
    const jiao = dict.hsk('教', ['jiao4'])!;
    expect(jiao.hsk3).toBeUndefined();
    expect(jiao.elsewhere).toEqual([{ pinyin: ['jiao1'], hsk3: 1 }]);
    const jue = dict.hsk('觉', ['jue2'])!;
    expect(jue.hsk3).toBeUndefined();
    expect(jue.elsewhere).toEqual([{ pinyin: ['jiao4'], hsk3: 6 }]);
    expect(at('觉', 'jiao4')).toBe(6);
    expect(at('便宜', 'bian4 yi2')).toBeUndefined();
    // Without a reading, the word's easiest one, as before.
    expect(dict.hsk('教')?.hsk3).toBe(1);
    expect(dict.hsk('教')?.elsewhere).toBeUndefined();
  });

  it('takes a reading that differs only in a neutral tone, unless CC-CEDICT spells both as words', () => {
    expect(at('东西', 'dong1 xi5')).toBe(1);
    expect(at('东西', 'dong1 xi1')).toBeUndefined(); // "east and west"
    expect(at('北边', 'bei3 bian1')).toBe(1);
    expect(at('说道', 'shuo1 dao4')).toBeUndefined(); // 说 + 道 "said"; the list's 说道 is shuōdao
    expect(at('人家', 'ren2 jia1')).toBeUndefined(); // "household"; the list's 人家 is rénjia "others"
  });

  it('grades a same-word reading at the word\'s level', () => {
    expect(at('血', 'xie3')).toBe(3);
    expect(at('血', 'xue4')).toBe(3);
    expect(at('唉', 'ai1')).toBe(7);
    // Every row of the hand table resolves to the level of the list reading it names.
    const rows = readFileSync(join(__dirname, '../../scripts/data/hsk-same-word.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      const [word, shown, listed] = row.split('\t');
      expect(at(word, listed), `${word} ${listed}`).toBeDefined();
      expect(at(word, shown), `${word} ${shown}`).toBe(at(word, listed));
    }
  });

  it('finds the list\'s 儿 words without 儿, and a book\'s 事儿 as 事', () => {
    expect(dict.hsk('一下')).toMatchObject({ hsk3: 1, of: '一下儿' });
    expect(at('一下', 'yi1 xia4')).toBe(1);
    expect(at('一下', 'yi2 xia4')).toBe(1);
    expect(at('玩', 'wan2')).toBe(1);
    expect(at('事儿', 'shi4 r5')).toBe(1);
    // 头儿 "boss" is a word of its own, not 头 "head" with 儿.
    expect(dict.hsk('头儿', ['tou2', 'r5'])).toBeNull();
  });

  it('finds an old spelling of a listed word, but not a word that is only "old variant of" one', () => {
    expect(dict.hsk('好象')).toMatchObject({ hsk3: 2, of: '好像' });
    expect(at('好象', 'hao3 xiang4')).toBe(2);
    expect(dict.hsk('马头')).toBeNull();
  });

  it('has the levels the old source lacked', () => {
    expect(at('森林', 'sen1 lin2')).toBe(4);
    expect(at('表示', 'biao3 shi4')).toBe(2);
    expect(at('〇', 'ling2')).toBe(1);
  });

  it('gives no hint for a character t2s folds into another: 乾 qián is not 干', () => {
    const qian = dict.hsk('乾', ['qian2']);
    expect(qian?.hsk3).toBeUndefined();
    expect(qian?.elsewhere).toBeUndefined();
  });
});

describe('hskWords and hskReadings', () => {
  it('lists the list\'s forms and their 儿-less spellings, not other spellings', () => {
    const l1 = dict.hskWords(1);
    expect(l1).toEqual(expect.arrayContaining(['一下', '教', '行', '玩']));
    expect(l1).not.toContain('好象');
    expect(dict.hskWords(7)).not.toContain('好象');
  });

  it('agree with dict.hsk and the pinyin mode, reading by reading', () => {
    const level = hskLevels(dict);
    const rows = dict.hskReadings(7);
    expect(rows.length).toBeGreaterThan(11000);
    for (const r of rows) {
      const got = dict.hsk(r.word, r.pinyin)?.hsk3;
      expect(got, `${r.word} ${r.pinyin.join(' ')}`).toBeDefined();
      expect(got!, `${r.word} ${r.pinyin.join(' ')}`).toBeLessThanOrEqual(r.hsk3);
      expect(level(r.word, r.pinyin)!, `${r.word} ${r.pinyin.join(' ')}`).toBeLessThanOrEqual(got!);
    }
    for (let n = 1; n <= 7; n++) for (const w of dict.hskWords(n)) expect(dict.hsk(w)!.hsk3!, w).toBeLessThanOrEqual(n);
  });

  it('teach a character only in the readings the list gives it, not a full tone from a neutral one', () => {
    const readings = (word: string) => dict.hskReadings(7).filter((r) => r.word === word).map((r) => r.pinyin.join(' '));
    expect(readings('行').sort()).toEqual(['hang2', 'xing2']);
    expect(readings('血').sort()).toEqual(['xie3', 'xue4']);
    expect(readings('子')).toEqual(['zi5']);
    // CC-CEDICT reads 老婆 lǎopó, the list lǎopo: that teaches no 婆 pó.
    expect(readings('老婆')).toEqual(['lao3 po5']);
  });
});

describe('hsk.tsv.gz format', () => {
  it('still reads the old 5-column file, grading the word in any reading (new code with an old cached file)', async () => {
    const d = await miniDict({ hsk: [['行', '行', '1', '4', '272'], ['呵', '呵', '', '6', '5230']] });
    expect(d.hsk('行', ['hang2'])).toEqual({ hsk3: 1, hsk2: 4, rank: 272 });
    expect(d.hsk('行', ['heng2'])).toEqual({ hsk3: 1, hsk2: 4, rank: 272 });
    expect(d.hsk('呵', ['he1'])).toEqual({ hsk2: 6, rank: 5230 });
    expect(d.hskWords(1)).toEqual(['行']);
  });

  it('reads the 8-column file: readings, same-word readings and derived rows', async () => {
    const d = await miniDict({
      cedict: [['東西', '东西', 'dong1 xi1', 'east and west'], ['東西', '东西', 'dong1 xi5', 'thing'], ['北邊', '北边', 'bei3 bian1', 'north']],
      hsk: [
        ['行', '行', '1', '4', '272', 'xing2=1;hang2=3', '', ''],
        ['着', '著', '1', '2', '38', 'zhe5=1;zhao2=4', '', ''],
        ['血', '血', '3', '4', '726', 'xie3=3', 'xue4=3', ''],
        ['事', '事', '1', '', '113', 'shi4=1', '', ''],
        ['头', '頭', '2', '', '329', 'tou2=2;tou5=2', '', ''],
        ['东西', '東西', '1', '1', '226', 'dong1 xi5=1', '', ''],
        ['北边', '北邊', '1', '', '17637', 'bei3 bian5=1', '', ''],
        ['朋友们', '朋友們', '1', '', '', 'peng2 you5 men5=1', '', ''],
        ['一下', '一下', '1', '', '', 'yi1 xia4=1', '', '一下儿'],
        ['好象', '', '2', '', '', 'hao3 xiang4=2', '', '好像'],
      ],
    });
    expect(d.hsk('行', ['hang2'])?.hsk3).toBe(3);
    expect(d.hsk('行', ['heng2'])).toEqual({ hsk2: 4, rank: 272, elsewhere: [{ pinyin: ['xing2'], hsk3: 1 }, { pinyin: ['hang2'], hsk3: 3 }] });
    expect(d.hsk('行')?.hsk3).toBe(1);
    // A reading that is not one syllable per character is no reading.
    expect(d.hsk('行', ['hang2', 'x'])?.hsk3).toBe(1);
    expect(d.hsk('血', ['xue4'])?.hsk3).toBe(3);
    // Found through the trad column: no hint (著 zhù is not 着).
    expect(d.hsk('著', ['zhe5'])?.hsk3).toBe(1);
    expect(d.hsk('著', ['zhu4'])?.elsewhere).toBeUndefined();
    expect(d.hsk('着', ['zhu4'])?.elsewhere).toHaveLength(2);
    expect(d.hsk('事儿', ['shi4', 'r5'])?.hsk3).toBe(1);
    expect(d.hsk('头儿', ['tou2', 'r5'])).toBeNull();
    expect(d.hsk('东西', ['dong1', 'xi1'])?.hsk3).toBeUndefined();
    expect(d.hsk('北边', ['bei3', 'bian1'])?.hsk3).toBe(1);
    expect(d.hsk('一下', ['yi2', 'xia4'])).toMatchObject({ hsk3: 1, of: '一下儿' });
    expect(d.hsk('好象', ['hao3', 'xiang4'])).toMatchObject({ hsk3: 2, of: '好像' });
    // By level, then the list's frequency rank; the 儿-less 一下 is in, the old spelling 好象 is not.
    expect(d.hskWords(7)).toEqual(['着', '事', '东西', '行', '北边', '朋友们', '一下', '头', '血']);
    expect(d.hskReadings(7).map((r) => `${r.word} ${r.pinyin.join(' ')}`)).not.toContain('一下 yi1 xia4');
    // The list's own forms join the word splitter; a derived spelling does not.
    expect(d.wordsAt('朋友们来了', 0)).toContain('朋友们');
    expect(d.wordsAt('好象', 0)).not.toContain('好象');
  });
});
