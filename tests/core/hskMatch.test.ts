// Matching the reading on screen with the readings the HSK list gives a word, and the 道 "said" rule (src/core/hskMatch.ts).
// Pure: no dictionary. The sentences are invented.
import { describe, expect, it } from 'vitest';
import { compareReading, isSaidDao } from '../../src/core/hskMatch';

describe('compareReading', () => {
  it('is the same reading when every syllable has the same letters and tone', () => {
    expect(compareReading(['xing2'], ['xing2'], '行')).toBe('same');
    expect(compareReading(['yin2', 'hang2'], ['yin2', 'hang2'], '银行')).toBe('same');
    expect(compareReading(['hang2'], ['xing2'], '行')).toBeNull();
    expect(compareReading(['hao3'], ['hao4'], '好')).toBeNull();
  });

  it('reads 一 and 不 in any tone, since their tone follows the next syllable', () => {
    expect(compareReading(['bu4', 'ke4', 'qi4'], ['bu2', 'ke4', 'qi4'], '不客气')).toBe('same');
    expect(compareReading(['yi1', 'xia4'], ['yi2', 'xia4'], '一下')).toBe('same');
    expect(compareReading(['yi1', 'dian3'], ['yi4', 'dian3'], '一点')).toBe('same');
    // Not other characters, and not when the word is not one character per syllable.
    expect(compareReading(['shi4'], ['shi2'], '是')).toBeNull();
    expect(compareReading(['bu4', 'ke4', 'qi4'], ['bu2', 'ke4', 'qi4'], '不客')).toBeNull();
  });

  it('tells a reading that differs only in a neutral tone', () => {
    expect(compareReading(['bei3', 'bian5'], ['bei3', 'bian1'], '北边')).toBe('neutral');
    expect(compareReading(['dong1', 'xi5'], ['dong1', 'xi1'], '东西')).toBe('neutral');
    expect(compareReading(['zhi1', 'dao4'], ['zhi1', 'dao5'], '知道')).toBe('neutral');
    // A neutral tone and a full one differ in letters: no match.
    expect(compareReading(['shi2', 'tou5'], ['dan4', 'tou5'], '石头')).toBeNull();
  });

  it('matches erhua r and ü however it is written, and refuses another number of syllables', () => {
    expect(compareReading(['yi1', 'xia4', 'r5'], ['yi1', 'xia4', 'r5'], '一下儿')).toBe('same');
    expect(compareReading(['yi1', 'xia4', 'r5'], ['yi1', 'xia4', 'er5'], '一下儿')).toBeNull();
    expect(compareReading(['lü4'], ['lu:4'], '绿')).toBe('same');
    expect(compareReading(['lü4'], ['lv4'], '绿')).toBe('same');
    expect(compareReading(['Bei3', 'jing1'], ['bei3', 'jing1'], '北京')).toBe('same');
    expect(compareReading(['yi1', 'xia4'], ['yi1'], '一下')).toBeNull();
    expect(compareReading([], [], '')).toBeNull();
  });
});

describe('isSaidDao', () => {
  it('is "said" after a verb of speaking, or before the colon or opening quote of the words said', () => {
    // 他笑道：“走吧。”  老人问道，  她又道  王二道「好」
    expect(isSaidDao('道', ['dao4'], '笑', '：')).toBe(true);
    expect(isSaidDao('道', ['dao4'], '问', '，')).toBe(true);
    expect(isSaidDao('道', ['dao4'], '又', '走')).toBe(true);
    expect(isSaidDao('道', ['dao4'], '冷笑', '：')).toBe(true);
    expect(isSaidDao('道', ['dao4'], '先生', '：')).toBe(true);
    expect(isSaidDao('道', ['dao4'], '先生', '“')).toBe(true);
    expect(isSaidDao('道', ['dao4'], '先生', '「')).toBe(true);
    expect(isSaidDao('道', undefined, '先生', '：')).toBe(true);
    // A name that ends in a numeral says something too: 王二道：
    expect(isSaidDao('道', ['dao4'], '王二', '：')).toBe(true);
  });

  it('keeps the measure word: after a numeral or demonstrative before a comma, or anywhere else', () => {
    // 天边现出三道，  一道题  这道菜很好吃
    expect(isSaidDao('道', ['dao4'], '三', '，')).toBe(false);
    expect(isSaidDao('道', ['dao4'], '这', '，')).toBe(false);
    expect(isSaidDao('道', ['dao4'], '一', '题')).toBe(false);
    expect(isSaidDao('道', ['dao4'], '这', '菜')).toBe(false);
    // Before a comma with no numeral it is "said" or a noun (修道，), neither of them the measure word.
    expect(isSaidDao('道', ['dao4'], '修', '，')).toBe(true);
  });

  it('is only the single character 道 read dào', () => {
    expect(isSaidDao('说道', ['shuo1', 'dao4'], '他', '：')).toBe(false);
    expect(isSaidDao('知道', ['zhi1', 'dao5'], '笑', '：')).toBe(false);
    expect(isSaidDao('道', ['dao3'], '笑', '：')).toBe(false);
    expect(isSaidDao('到', ['dao4'], '笑', '：')).toBe(false);
    // A straight quote can close a quotation as well: no rule on it.
    expect(isSaidDao('道', ['dao4'], '先生', '"')).toBe(false);
    expect(isSaidDao('道', ['dao4'], undefined, undefined)).toBe(false);
  });
});
