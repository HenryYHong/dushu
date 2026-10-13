import { describe, expect, it } from 'vitest';
import { capitalizePinyin, pinyinGroups } from '../../src/core/names';
import { formatSyllable } from '../../src/core/pinyin';

const marks = (numbered: string) => numbered.split(' ').map((s) => formatSyllable(s, 'marks'));

describe('capitalizePinyin', () => {
  it('writes a name as an English reader does: surname, then the given name joined', () => {
    expect(capitalizePinyin(marks('guo1 jing4'), 'name', '郭靖')).toBe('Guō Jìng');
    expect(capitalizePinyin(marks('han2 xiao3 ying2'), 'name', '韩小莹')).toBe('Hán Xiǎoyíng');
    expect(capitalizePinyin(marks('ou1 yang2 wu2 ji4'), 'name', '欧阳无忌')).toBe('Ōuyáng Wújì');
    expect(capitalizePinyin(marks('lao3 wan2 tong2'), 'name', '老顽童')).toBe('Lǎo Wántóng');
    // no surname: one word (a Mongol name, a maid)
    expect(capitalizePinyin(marks('zhe2 bie2'), 'name', '哲别')).toBe('Zhébié');
    expect(capitalizePinyin(marks('ping2 er2'), 'name', '平兒')).toBe("Píng'ér"); // an apostrophe where a syllable starts with a, o or e
    expect(capitalizePinyin(marks('he2 sa1 er2'), 'name', '合撒儿')).toBe("Hésā'ér");
  });
  it('joins the syllables of a place and sets the generic ending apart', () => {
    expect(capitalizePinyin(marks('tao2 hua1 dao3'), 'place', '桃花岛')).toBe('Táohuā Dǎo');
    expect(capitalizePinyin(marks('gui1 yun2 zhuang1'), 'place', '归云庄')).toBe('Guīyún Zhuāng');
    expect(capitalizePinyin(marks('jin1 guo2'), 'place', '金国')).toBe('Jīn Guó');
    expect(capitalizePinyin(marks('niu2 jia1 cun1'), 'place', '牛家村')).toBe('Niújiā Cūn');
  });
  it('leaves terms, user words and zhuyin alone, and numbers get a capital too', () => {
    expect(capitalizePinyin(marks('jiu3 yin1 zhen1 jing1'), 'term', '九阴真经')).toBe('jiǔ yīn zhēn jīng');
    expect(capitalizePinyin(['guo1', 'jing4'], 'user', '郭靖')).toBe('guo1 jing4');
    expect(capitalizePinyin(['ㄍㄨㄛ', 'ㄐㄧㄥˋ'], 'name', '郭靖')).toBe('ㄍㄨㄛ ㄐㄧㄥˋ');
    expect(capitalizePinyin(['guo1', 'jing4'], 'name', '郭靖')).toBe('Guo1 Jing4');
  });
  it('folds traditional text for the surname lookup and falls back when the counts do not match', () => {
    const fold = (s: string) => s.replace('歐陽', '欧阳').replace('無', '无').replace('忌', '忌');
    expect(capitalizePinyin(marks('ou1 yang2 wu2 ji4'), 'name', '歐陽無忌', fold)).toBe('Ōuyáng Wújì');
    expect(capitalizePinyin(marks('guo1 jing4 xx5'), 'name', '郭靖')).toBe('Guō Jìng Xx');
    expect(pinyinGroups('郭靖', 'term')).toBeNull();
  });
});
