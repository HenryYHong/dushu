import { describe, expect, it } from 'vitest';
import {
  PINYIN_SYLLABLES,
  applySandhi,
  baseOf,
  formatPinyin,
  formatSyllable,
  markedToNumbered,
  normalizePinyinField,
  numberedToMarked,
  numberedToZhuyin,
  splitPinyinRun,
  toneOf,
} from '../../src/core/pinyin';
import type { Token } from '../../src/types';

describe('toneOf', () => {
  it('reads the digit, defaulting to neutral', () => {
    expect(toneOf('hao3')).toBe(3);
    expect(toneOf('ma1')).toBe(1);
    expect(toneOf('de5')).toBe(5);
    expect(toneOf('de')).toBe(5);
    expect(toneOf('r5')).toBe(5);
    expect(toneOf('lü4')).toBe(4);
    expect(toneOf('Bei3')).toBe(3);
  });
  it('also reads tone marks', () => {
    expect(toneOf('hǎo')).toBe(3);
    expect(toneOf('lǜ')).toBe(4);
    expect(toneOf('ma')).toBe(5);
  });
  it('treats tone 0 and junk as neutral', () => {
    expect(toneOf('ma0')).toBe(5);
    expect(toneOf('11')).toBe(5);
    expect(toneOf('')).toBe(5);
  });
});

describe('numberedToMarked', () => {
  const cases: [string, string][] = [
    ['ni3', 'nǐ'], ['hao3', 'hǎo'], ['ma1', 'mā'], ['ma2', 'má'], ['ma4', 'mà'],
    // a and e first
    ['lai2', 'lái'], ['hao3', 'hǎo'], ['mei3', 'měi'], ['jie1', 'jiē'], ['xue2', 'xué'], ['er2', 'ér'],
    ['jiao4', 'jiào'], ['guang1', 'guāng'], ['zhuang4', 'zhuàng'],
    // ou goes on the o
    ['kou3', 'kǒu'], ['zhou1', 'zhōu'], ['dou1', 'dōu'],
    // otherwise the last vowel: iu, ui, uo, io
    ['jiu3', 'jiǔ'], ['liu2', 'liú'], ['gui4', 'guì'], ['dui4', 'duì'], ['guo2', 'guó'], ['huo4', 'huò'],
    // ü
    ['lü4', 'lǜ'], ['nü3', 'nǚ'], ['lü1', 'lǖ'], ['lü2', 'lǘ'], ['nüe4', 'nüè'], ['lüe4', 'lüè'], ['jun1', 'jūn'],
    ['lv4', 'lǜ'], ['lu:4', 'lǜ'], ['nv3', 'nǚ'],
    // neutral and erhua
    ['ma5', 'ma'], ['de5', 'de'], ['r5', 'r'], ['er5', 'er'], ['zi5', 'zi'],
    // capitals keep their case
    ['Bei3', 'Běi'], ['Jing1', 'Jīng'], ['A1', 'Ā'], ['Er2', 'Ér'], ['Ou1', 'Ōu'], ['Lü4', 'Lǜ'],
  ];
  for (const [num, marked] of cases) {
    it(`${num} -> ${marked}`, () => expect(numberedToMarked(num)).toBe(marked));
  }

  it('marks syllabic m, n, ng on their first nasal', () => {
    expect(numberedToMarked('m2')).toBe('ḿ');
    expect(numberedToMarked('n2')).toBe('ń');
    expect(numberedToMarked('n3')).toBe('ň');
    expect(numberedToMarked('n4')).toBe('ǹ');
    expect(numberedToMarked('ng2')).toBe('ńg');
    expect(numberedToMarked('hng1').normalize('NFD')).toBe('hn̄g');
  });

  it('passes through anything that is not a numbered syllable', () => {
    expect(numberedToMarked('xx5')).toBe('xx'); // tone 5 just drops the digit
    expect(numberedToMarked('xx1')).toBe('xx1'); // no vowel to carry the mark
    expect(numberedToMarked('3D')).toBe('3D');
    expect(numberedToMarked('·')).toBe('·');
    expect(numberedToMarked(',')).toBe(',');
    expect(numberedToMarked('hao')).toBe('hao');
    expect(numberedToMarked('')).toBe('');
    expect(numberedToMarked('11')).toBe('11');
    expect(numberedToMarked('C')).toBe('C');
  });

  it('is NFC (composed) output', () => {
    expect(numberedToMarked('lü3')).toBe('lǚ'.normalize('NFC'));
    expect(numberedToMarked('lü3')).toHaveLength(2);
  });
});

describe('markedToNumbered', () => {
  it('inverts numberedToMarked for every known syllable and tone', () => {
    for (const base of PINYIN_SYLLABLES) {
      for (let tone = 1; tone <= 5; tone++) {
        const numbered = base + tone;
        const marked = numberedToMarked(numbered);
        if (!/[aeiouü]|^[mn]|^ng|^hng|^hm/.test(base)) continue; // r has no vowel and no mark
        expect(markedToNumbered(marked), `${numbered} -> ${marked}`).toBe(numbered);
      }
    }
  });
  it('handles the usual forms', () => {
    expect(markedToNumbered('hǎo')).toBe('hao3');
    expect(markedToNumbered('lǜ')).toBe('lü4');
    expect(markedToNumbered('Běi')).toBe('Bei3');
    expect(markedToNumbered('ma')).toBe('ma5');
    expect(markedToNumbered('hao3')).toBe('hao3');
    expect(markedToNumbered('ńg')).toBe('ng2');
  });
  it('leaves non-syllables alone', () => {
    expect(markedToNumbered('C')).toBe('C');
    expect(markedToNumbered('·')).toBe('·');
    expect(markedToNumbered('xx')).toBe('xx');
  });
});

describe('baseOf', () => {
  it('gives the toneless lowercase letters', () => {
    expect(baseOf('Bei3')).toBe('bei');
    expect(baseOf('lǜ')).toBe('lü');
    expect(baseOf('lv4')).toBe('lü');
    expect(baseOf('r5')).toBe('r');
  });
});

describe('numberedToZhuyin', () => {
  const cases: [string, string][] = [
    ['hao3', 'ㄏㄠˇ'], ['ni3', 'ㄋㄧˇ'], ['ma1', 'ㄇㄚ'], ['ma2', 'ㄇㄚˊ'], ['ma4', 'ㄇㄚˋ'], ['ma5', '˙ㄇㄚ'],
    ['a1', 'ㄚ'], ['o1', 'ㄛ'], ['e2', 'ㄜˊ'], ['ai4', 'ㄞˋ'], ['ei3', 'ㄟˇ'], ['ao1', 'ㄠ'], ['ou3', 'ㄡˇ'],
    ['an1', 'ㄢ'], ['en1', 'ㄣ'], ['ang1', 'ㄤ'], ['eng1', 'ㄥ'], ['er2', 'ㄦˊ'], ['r5', 'ㄦ'],
    // whole-syllable i
    ['zhi1', 'ㄓ'], ['chi1', 'ㄔ'], ['shi4', 'ㄕˋ'], ['ri4', 'ㄖˋ'], ['zi3', 'ㄗˇ'], ['ci2', 'ㄘˊ'], ['si4', 'ㄙˋ'],
    // y and w
    ['yi1', 'ㄧ'], ['ya1', 'ㄧㄚ'], ['ye4', 'ㄧㄝˋ'], ['yao4', 'ㄧㄠˋ'], ['you3', 'ㄧㄡˇ'], ['yan2', 'ㄧㄢˊ'],
    ['yin1', 'ㄧㄣ'], ['yang2', 'ㄧㄤˊ'], ['ying1', 'ㄧㄥ'], ['yong3', 'ㄩㄥˇ'], ['yu2', 'ㄩˊ'], ['yue4', 'ㄩㄝˋ'],
    ['yuan2', 'ㄩㄢˊ'], ['yun2', 'ㄩㄣˊ'], ['yo1', 'ㄧㄛ'],
    ['wu3', 'ㄨˇ'], ['wa1', 'ㄨㄚ'], ['wo3', 'ㄨㄛˇ'], ['wai4', 'ㄨㄞˋ'], ['wei4', 'ㄨㄟˋ'], ['wan3', 'ㄨㄢˇ'],
    ['wen2', 'ㄨㄣˊ'], ['wang2', 'ㄨㄤˊ'], ['weng1', 'ㄨㄥ'],
    // contracted finals and ü after j q x
    ['jiu3', 'ㄐㄧㄡˇ'], ['hui4', 'ㄏㄨㄟˋ'], ['lun2', 'ㄌㄨㄣˊ'], ['jun1', 'ㄐㄩㄣ'], ['ju4', 'ㄐㄩˋ'],
    ['que4', 'ㄑㄩㄝˋ'], ['xuan2', 'ㄒㄩㄢˊ'], ['xiong2', 'ㄒㄩㄥˊ'], ['qun2', 'ㄑㄩㄣˊ'],
    ['lü4', 'ㄌㄩˋ'], ['nü3', 'ㄋㄩˇ'], ['lüe4', 'ㄌㄩㄝˋ'], ['nüe4', 'ㄋㄩㄝˋ'],
    ['zhuang1', 'ㄓㄨㄤ'], ['chui2', 'ㄔㄨㄟˊ'], ['shuo1', 'ㄕㄨㄛ'], ['tun1', 'ㄊㄨㄣ'], ['dong1', 'ㄉㄨㄥ'],
    ['liu2', 'ㄌㄧㄡˊ'], ['guo2', 'ㄍㄨㄛˊ'], ['xie4', 'ㄒㄧㄝˋ'], ['bian1', 'ㄅㄧㄢ'], ['ping2', 'ㄆㄧㄥˊ'],
  ];
  for (const [num, zy] of cases) {
    it(`${num} -> ${zy}`, () => expect(numberedToZhuyin(num)).toBe(zy));
  }

  it('spells every known syllable in Bopomofo only', () => {
    for (const base of PINYIN_SYLLABLES) {
      const zy = numberedToZhuyin(base + '1');
      expect(zy, base).toMatch(/^[ㄅ-ㄯ]+$/);
    }
  });

  it('is injective over the standard syllables (no two spellings collide)', () => {
    const seen = new Map<string, string>();
    for (const base of PINYIN_SYLLABLES) {
      if (['n', 'ng', 'hm', 'hng', 'm', 'r', 'er'].includes(base)) continue;
      const zy = numberedToZhuyin(base + '1');
      const prev = seen.get(zy);
      // a few dialect syllables are spelled the same as a standard one (e.g. "biu"); everything else must differ
      if (prev && !['biu', 'ging'].includes(base)) expect.soft(prev, `${base} vs ${zy}`).toBe(base);
      seen.set(zy, base);
    }
  });

  it('passes non-syllables through', () => {
    expect(numberedToZhuyin('3D')).toBe('3D');
    expect(numberedToZhuyin('xx5')).toBe('xx5');
    expect(numberedToZhuyin(',')).toBe(',');
    expect(numberedToZhuyin('A')).toBe('A');
  });
});

describe('formatSyllable / formatPinyin', () => {
  it('formats in each style', () => {
    expect(formatSyllable('hao3', 'marks')).toBe('hǎo');
    expect(formatSyllable('hao3', 'numbers')).toBe('hao3');
    expect(formatSyllable('hao3', 'zhuyin')).toBe('ㄏㄠˇ');
    expect(formatPinyin('ni3 hao3', 'marks')).toBe('nǐ hǎo');
    expect(formatPinyin('ni3 hao3', 'numbers')).toBe('ni3 hao3');
    expect(formatPinyin('ni3 hao3', 'zhuyin')).toBe('ㄋㄧˇ ㄏㄠˇ');
    expect(formatPinyin('Bei3 jing1', 'marks')).toBe('Běi jīng');
    expect(formatPinyin('lü4 se4  de5', 'marks')).toBe('lǜ sè de');
    expect(formatPinyin('san1 D da3 yin4', 'marks')).toBe('sān D dǎ yìn');
    expect(formatPinyin('', 'marks')).toBe('');
  });
});

describe('splitPinyinRun / normalizePinyinField', () => {
  it('splits run-together marked pinyin', () => {
    expect(splitPinyinRun('yǒujìnr5')).toEqual(['you3', 'jin4', 'r5']);
    expect(splitPinyinRun('shíhòu')).toEqual(['shi2', 'hou4']);
    expect(splitPinyinRun('nányǐxiǎngxiàng')).toEqual(['nan2', 'yi3', 'xiang3', 'xiang4']);
    expect(splitPinyinRun('zhuóyǎn')).toEqual(['zhuo2', 'yan3']);
    expect(splitPinyinRun("xi'an")).toEqual(['xi5', 'an5']);
    expect(splitPinyinRun('lǜsè')).toEqual(['lü4', 'se4']);
  });
  it('rejects things that are not pinyin', () => {
    expect(splitPinyinRun('hello!')).toBeNull();
    expect(splitPinyinRun('qzx')).toBeNull();
  });
  it('repairs the mixed rows at the end of cedict', () => {
    expect(normalizePinyinField('bu4 lìyú')).toBe('bu4 li4 yu2');
    expect(normalizePinyinField('bu4 yīhuǐr5')).toBe('bu4 yi1 hui3 r5');
    expect(normalizePinyinField('zhe4 shíhòu')).toBe('zhe4 shi2 hou4');
    expect(normalizePinyinField('chènzhe')).toBe('chen4 zhe5');
    expect(normalizePinyinField('niu3 kou4 er')).toBe('niu3 kou4 er5');
    expect(normalizePinyinField('ping2 zhe5')).toBe('ping2 zhe5');
  });
  it('keeps ordinary CEDICT pinyin untouched', () => {
    for (const p of ['ni3 hao3', 'Bei3 jing1', 'san1 D da3 yin4', '11 Qu1', 'lü4 se4', 'AA zhi4', 'ya1 xi1 er3 · a1']) {
      expect(normalizePinyinField(p)).toBe(p);
    }
  });
});

// ------------------------------------------------------------------ sandhi ---

function han(text: string, start: number, ...pinyin: string[]): Token {
  return { text, start, end: start + [...text].length, kind: 'han', pinyin, inDict: false };
}
function punct(text: string, start: number): Token {
  return { text, start, end: start + text.length, kind: 'punct', inDict: false };
}
function sandhi(...tokens: Token[]): string[][] {
  applySandhi(tokens);
  return tokens.filter((t) => t.pinyin).map((t) => t.pinyin!);
}

describe('applySandhi', () => {
  it('不 before a fourth tone becomes bu2', () => {
    expect(sandhi(han('不', 0, 'bu4'), han('是', 1, 'shi4'))).toEqual([['bu2'], ['shi4']]);
    expect(sandhi(han('不要', 0, 'bu4', 'yao4'))).toEqual([['bu2', 'yao4']]);
  });
  it('不 elsewhere stays bu4', () => {
    expect(sandhi(han('不', 0, 'bu4'), han('好', 1, 'hao3'))).toEqual([['bu4'], ['hao3']]);
    expect(sandhi(han('不', 0, 'bu4'), han('来', 1, 'lai2'))).toEqual([['bu4'], ['lai2']]);
    expect(sandhi(han('不', 0, 'bu4'), han('吃', 1, 'chi1'))).toEqual([['bu4'], ['chi1']]);
  });
  it('一 before a fourth tone becomes yi2', () => {
    expect(sandhi(han('一', 0, 'yi1'), han('个', 1, 'ge4'))).toEqual([['yi2'], ['ge4']]);
    expect(sandhi(han('一定', 0, 'yi1', 'ding4'))).toEqual([['yi2', 'ding4']]);
  });
  it('一 before a neutral 个 becomes yi2 (一个 is yí ge)', () => {
    expect(sandhi(han('一', 0, 'yi1'), han('个', 1, 'ge5'))).toEqual([['yi2'], ['ge5']]);
  });
  it('一 before tones 1-3 becomes yi4', () => {
    expect(sandhi(han('一', 0, 'yi1'), han('天', 1, 'tian1'))).toEqual([['yi4'], ['tian1']]);
    expect(sandhi(han('一', 0, 'yi1'), han('年', 1, 'nian2'))).toEqual([['yi4'], ['nian2']]);
    expect(sandhi(han('一', 0, 'yi1'), han('起', 1, 'qi3'))).toEqual([['yi4'], ['qi3']]);
    expect(sandhi(han('一起', 0, 'yi1', 'qi3'))).toEqual([['yi4', 'qi3']]);
  });
  it('一 stays yi1 as a number or ordinal', () => {
    expect(sandhi(han('第', 0, 'di4'), han('一', 1, 'yi1'), han('次', 2, 'ci4'))).toEqual([['di4'], ['yi1'], ['ci4']]);
    expect(sandhi(han('第一', 0, 'di4', 'yi1'), han('个', 2, 'ge4'))).toEqual([['di4', 'yi1'], ['ge4']]);
    expect(sandhi(han('十', 0, 'shi2'), han('一', 1, 'yi1'), han('个', 2, 'ge4'))).toEqual([['shi2'], ['yi1'], ['ge4']]);
    expect(sandhi(han('一二三', 0, 'yi1', 'er4', 'san1'))).toEqual([['yi1', 'er4', 'san1']]);
    expect(sandhi(han('一月', 0, 'yi1', 'yue4'))).toEqual([['yi1', 'yue4']]);
    expect(sandhi(han('一', 0, 'yi1'), han('月', 1, 'yue4'))).toEqual([['yi1'], ['yue4']]);
    expect(sandhi(han('一', 0, 'yi1'), han('号', 1, 'hao4'))).toEqual([['yi1'], ['hao4']]);
  });
  it('一 stays yi1 at the end of a word or phrase', () => {
    expect(sandhi(han('唯一', 0, 'wei2', 'yi1'), han('的', 2, 'de5'))).toEqual([['wei2', 'yi1'], ['de5']]);
    expect(sandhi(han('统一', 0, 'tong3', 'yi1'), han('战线', 2, 'zhan4', 'xian4'))).toEqual([['tong3', 'yi1'], ['zhan4', 'xian4']]);
    expect(sandhi(han('万一', 0, 'wan4', 'yi1'))).toEqual([['wan4', 'yi1']]);
    expect(sandhi(han('是', 0, 'shi4'), han('一', 1, 'yi1'), punct('。', 2))).toEqual([['shi4'], ['yi1']]);
    expect(sandhi(han('一', 0, 'yi1'))).toEqual([['yi1']]);
  });
  it('does not reach across punctuation or gaps', () => {
    expect(sandhi(han('不', 0, 'bu4'), punct('，', 1), han('是', 2, 'shi4'))).toEqual([['bu4'], ['shi4']]);
    expect(sandhi(han('一', 0, 'yi1'), han('个', 5, 'ge4'))).toEqual([['yi1'], ['ge4']]);
  });
  it('一/不 between two copies of a character are neutral', () => {
    expect(sandhi(han('看', 0, 'kan4'), han('一', 1, 'yi1'), han('看', 2, 'kan4'))).toEqual([['kan4'], ['yi5'], ['kan4']]);
    expect(sandhi(han('好不好', 0, 'hao3', 'bu4', 'hao3'))).toEqual([['hao3', 'bu5', 'hao3']]);
    expect(sandhi(han('对', 0, 'dui4'), han('不', 1, 'bu4'), han('对', 2, 'dui4'))).toEqual([['dui4'], ['bu5'], ['dui4']]);
  });
  it('leaves 一 read as yao alone and does not crash on empty input', () => {
    expect(sandhi(han('一', 0, 'yao1'), han('九', 1, 'jiu3'))).toEqual([['yao1'], ['jiu3']]);
    expect(() => applySandhi([])).not.toThrow();
    expect(sandhi(han('不', 0, ''), han('是', 1, 'shi4'))).toEqual([[''], ['shi4']]);
  });
  it('skips tokens that carry no pinyin', () => {
    const t: Token[] = [{ text: 'abc', start: 0, end: 3, kind: 'latin', inDict: false }, han('不', 3, 'bu4'), han('对', 4, 'dui4')];
    applySandhi(t);
    expect(t[1].pinyin).toEqual(['bu2']);
  });
});
