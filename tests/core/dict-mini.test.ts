// Exact-control tests of the dictionary logic on tiny hand-made data.
import { describe, expect, it } from 'vitest';
import { miniDict } from '../helpers/mini';

describe('choosing a reading among several CEDICT entries', () => {
  it('skips surname-only entries', async () => {
    const d = await miniDict({
      cedict: [
        ['甲乙', '甲乙', 'Jia3 yi3', 'surname Jia'],
        ['甲乙', '甲乙', 'jia3 yi3', 'A and B'],
      ],
    });
    expect(d.pinyinFor('甲乙')).toEqual(['jia3', 'yi3']);
  });

  it('skips "variant of" and "old variant of" entries, whatever their file order', async () => {
    const d = await miniDict({
      cedict: [
        ['丙丁', '丙丁', 'bing4 ding4', 'variant of 丁丙[ding1 bing3]'],
        ['丙丁', '丙丁', 'bing3 ding1', 'C and D'],
        ['戊己', '戊己', 'wu4 ji4', 'old variant of 己戊[ji3 wu4]'],
        ['戊己', '戊己', 'wu4 ji3', 'E and F'],
      ],
    });
    expect(d.pinyinFor('丙丁')).toEqual(['bing3', 'ding1']);
    expect(d.pinyinFor('戊己')).toEqual(['wu4', 'ji3']);
  });

  it('skips Taiwan pronunciations', async () => {
    const d = await miniDict({
      cedict: [
        ['垃圾', '垃圾', 'la1 ji1', 'rubbish'],
        ['垃圾', '垃圾', 'le4 se4', 'Taiwan pr. [le4 se4]'],
      ],
    });
    expect(d.pinyinFor('垃圾')).toEqual(['la1', 'ji1']);
    const d2 = await miniDict({
      cedict: [
        ['垃圾', '垃圾', 'le4 se4', 'Taiwan pr. [le4 se4]'],
        ['垃圾', '垃圾', 'la1 ji1', 'rubbish'],
      ],
    });
    expect(d2.pinyinFor('垃圾')).toEqual(['la1', 'ji1']);
  });

  it('prefers a common noun over a proper noun, but uses the proper noun when it is the only one', async () => {
    const d = await miniDict({
      cedict: [
        ['白云', '白云', 'Bai2 yun2', 'Baiyun district'],
        ['白云', '白云', 'bai2 yun2', 'white cloud'],
        ['北京', '北京', 'Bei3 jing1', 'Beijing'],
      ],
    });
    expect(d.lookup('白云')).toHaveLength(2);
    expect(d.pinyinFor('白云')).toEqual(['bai2', 'yun2']);
    expect(d.pinyinFor('北京')).toEqual(['bei3', 'jing1']);
  });

  it('uses the entry that agrees with the characters\' customary readings when everything else is equal', async () => {
    const d = await miniDict({
      cedict: [
        ['行行', '行行', 'hang2 hang2', 'rows'],
        ['行行', '行行', 'xing2 xing2', 'walking'],
        ['行', '行', 'xing2', 'to walk'],
        ['行', '行', 'hang2', 'row'],
      ],
      chars: [['行', 'xíng,háng', 'walk', '6', '144.0']],
    });
    expect(d.pinyinFor('行行')).toEqual(['xing2', 'xing2']);
  });

  it('breaks remaining ties by file order', async () => {
    const d = await miniDict({
      cedict: [
        ['丁戊', '丁戊', 'ding1 wu4', 'first'],
        ['丁戊', '丁戊', 'ding1 wu5', 'second'],
      ],
    });
    expect(d.pinyinFor('丁戊')).toEqual(['ding1', 'wu4']);
  });
});

describe('aligning syllables to code points', () => {
  const d = () =>
    miniDict({
      cedict: [
        ['A片', 'A片', 'A pian4', 'adult video'],
        ['11區', '11区', '11 Qu1', 'Area 11'],
        ['阿拉法特', '阿拉法特', 'A1 la1 fa3 te4', 'Arafat'],
        ['亞·阿', '亚·阿', 'Ya4 · A1', 'x'],
        ['趁著', '趁着', 'chènzhe', 'while'],
        ['有勁兒', '有劲儿', 'yǒujìnr5', 'energetic'],
        ['三心二意', '三心二意', 'san1 xin1 er4', 'wrong count'],
        ['甲乙丙', '甲乙丙', 'jia3 yi3 bing3', 'ok'],
      ],
      chars: [
        ['三', 'sān'], ['心', 'xīn'], ['二', 'èr'], ['意', 'yì'],
      ],
    });

  it('maps syllables onto Han characters and leaves Latin and digits empty', async () => {
    const x = await d();
    expect(x.pinyinFor('A片')).toEqual(['', 'pian4']);
    expect(x.pinyinFor('11区')).toEqual(['', '', 'qu1']);
    expect(x.pinyinFor('亚·阿')).toEqual(['ya4', '', 'a1']);
  });
  it('repairs tone-marked and run-together pinyin when loading', async () => {
    const x = await d();
    expect(x.lookup('趁着')[0].pinyin).toBe('chen4 zhe5');
    expect(x.pinyinFor('趁着')).toEqual(['chen4', 'zhe5']);
    expect(x.pinyinFor('有劲儿')).toEqual(['you3', 'jin4', 'r5']);
  });
  it('falls back to per-character readings when the counts cannot be aligned', async () => {
    const x = await d();
    expect(x.pinyinFor('三心二意')).toEqual(['san1', 'xin1', 'er4', 'yi4']);
  });
  it('keeps one entry per code point', async () => {
    const x = await d();
    expect(x.pinyinFor('甲乙丙')).toHaveLength(3);
  });
});

describe('char() fallbacks', () => {
  const build = () =>
    miniDict({
      chars: [
        // full row
        ['人', 'rén', 'man; people', '2', '9.0'],
        // Unihan reading but no definition; the supplement has one
        ['一', 'yī', '', '1', '1.0'],
        // nothing in Unihan; the supplement fills both
        ['二', '', '', '2', '7.0'],
        // nothing anywhere, but a traditional form with a reading and a definition
        ['三', '', '', '3', '1.2', '', '', ''],
        ['\u{20000}', '', '', '5', '1.4', '', '人', ''],
        // semantic variant only
        ['\u{20001}', '', '', '5', '1.4', '', '', '一'],
        // nothing at all
        ['\u{20002}', '', '', '5', '1.4'],
        // compatibility ideograph
        ['豈', '', 'how? what?', '10', '151.3', '', '', '', '豈'],
        ['豈', 'qǐ,kǎi', 'how? what?', '10', '151.3'],
        // 'extra' must not override Unihan readings
        ['四', 'sì', '', '5', '31.2'],
      ],
      extra: [
        ['一', 'XX', 'one (from the supplement)'],
        ['二', 'èr', 'two (from the supplement)'],
        ['四', 'si1', 'four (supplement)'],
      ],
      radicals: [['9', '⼈', '人'], ['1', '⼀', '一']],
    });

  it('returns Unihan data with its source', async () => {
    const d = await build();
    expect(d.char('人')).toMatchObject({ readings: ['rén'], definition: 'man; people', source: 'unihan', strokes: 2 });
    expect(d.char('人')!.radical).toEqual({ num: '9', radicalChar: '⼈', char: '人', residual: 0 });
  });
  it('fills only the gaps from the supplement', async () => {
    const d = await build();
    expect(d.char('一')).toMatchObject({ readings: ['yī'], definition: 'one (from the supplement)', source: 'unihan' });
    expect(d.char('二')).toMatchObject({ readings: ['èr'], definition: 'two (from the supplement)', source: 'wiktionary' });
    expect(d.char('四')).toMatchObject({ readings: ['sì'], definition: 'four (supplement)', source: 'unihan' });
  });
  it('borrows readings and a definition from simplified/traditional forms, then from variants, and says so', async () => {
    const d = await build();
    const a = d.char('\u{20000}')!;
    expect(a.readings).toEqual(['rén']);
    expect(a.definition).toBe('(cf. 人) man; people');
    expect(a.source).toBe('variant');
    expect(a.traditional).toEqual(['人']);
    const b = d.char('\u{20001}')!;
    expect(b.readings).toEqual(['yī']);
    expect(b.source).toBe('variant');
    expect(b.variants).toEqual(['一']);
  });
  it('never returns null for a Han code point, even with nothing to say', async () => {
    const d = await build();
    expect(d.char('\u{20002}')).toMatchObject({ readings: [], definition: '', source: 'none', block: 'CJK Unified Ideographs Extension B' });
    expect(d.char('\u{2A700}')).toMatchObject({ readings: [], source: 'none', strokes: null, radical: null });
    expect(d.char('\u{323B0}')!.block).toBe('CJK Unified Ideographs Extension J');
  });
  it('resolves compatibility ideographs to the unified character', async () => {
    const d = await build();
    const c = d.char('豈')!;
    expect(c).toMatchObject({ compatOf: '豈', readings: ['qǐ', 'kǎi'], definition: 'how? what?', source: 'unihan' });
    expect(d.pinyinFor('豈')).toEqual(['qi3']);
  });
  it('resolves Kangxi radicals through the radicals table', async () => {
    const d = await build();
    const k = d.char('⼈')!;
    expect(k).toMatchObject({ compatOf: '人', readings: ['rén'], block: 'Kangxi Radicals' });
  });
  it('uses the supplement for pinyinFor too, and variants of the same character, but not semantic variants', async () => {
    const d = await build();
    expect(d.pinyinFor('二')).toEqual(['er4']);
    expect(d.pinyinFor('\u{20000}')).toEqual(['ren2']);
    expect(d.pinyinFor('\u{20001}')).toEqual(['']);
    expect(d.pinyinFor('四')).toEqual(['si4']);
  });
  it('treats a missing supplement like an empty one', async () => {
    const d = await miniDict({ chars: [['二', '', '', '2', '7.0']] });
    expect(d.char('二')).toMatchObject({ readings: [], source: 'none' });
  });
});

describe('segmentation vocabulary', () => {
  it('lists words longest first and counts a CEDICT-only word as present', async () => {
    const d = await miniDict({
      cedict: [['中華人民共和國', '中华人民共和国', 'zhong1 hua2 ren2 min2 gong4 he2 guo2', 'PRC'], ['中華', '中华', 'zhong1 hua2', 'China']],
      words: [['中华', 100], ['中', 50], ['华', 10]],
    });
    expect(d.wordsAt('中华人民共和国', 0)).toEqual(['中华人民共和国', '中华', '中']);
    expect(d.freq('中华人民共和国')).toBe(0);
    expect(d.freq('中华')).toBe(100);
    expect(d.hasWord('中華人民共和國')).toBe(true);
  });
  it('treats very long words (over 30 code points) as lookup-only', async () => {
    const long = '一二三四五六七八九十'.repeat(4);
    const d = await miniDict({ cedict: [[long, long, 'yi1', 'x']] });
    expect(d.hasWord(long)).toBe(true);
    expect(d.wordsAt(long, 0)).toEqual(['一']);
  });
});

describe('cedict-extra (optional supplementary words)', () => {
  it('adds words CEDICT lacks, after the CEDICT entries, without duplicating a reading', async () => {
    const d = await miniDict({
      cedict: [['很', '很', 'hen3', 'very']],
      cedictExtra: [
        ['很多', '很多', 'hen3 duo1', 'many'],
        ['很', '很', 'hen3', 'very (again)'],
        ['很', '很', 'hen2', 'rare reading'],
      ],
      words: [['很', 100], ['多', 100]],
    });
    expect(d.hasWord('很多')).toBe(true);
    expect(d.pinyinFor('很多')).toEqual(['hen3', 'duo1']);
    expect(d.wordsAt('很多', 0)).toEqual(['很多', '很']);
    expect(d.lookup('很').map((e) => e.pinyin)).toEqual(['hen3', 'hen2']);
    expect(d.meta.counts.wordsExtraLoaded).toBe(2);
  });
  it('is fine when the file is absent', async () => {
    const d = await miniDict({ cedict: [['很', '很', 'hen3', 'very']] });
    expect(d.meta.counts.wordsExtraLoaded).toBe(0);
  });
});

describe('proper-noun discount', () => {
  it('cuts the segmentation weight of two-character proper nouns to a quarter, leaving common words alone', async () => {
    const d = await miniDict({
      cedict: [
        ['花都', '花都', 'Hua1 du1', 'Huadu'],
        ['花园', '花园', 'hua1 yuan2', 'garden'],
        ['北京大学', '北京大学', 'Bei3 jing1 Da4 xue2', 'Peking University'],
        ['白云', '白云', 'Bai2 yun2', 'Baiyun'],
        ['白云', '白云', 'bai2 yun2', 'white cloud'],
      ],
      words: [['花都', 51], ['花园', 400], ['北京大学', 40], ['白云', 80]],
    });
    expect(d.freq('花都')).toBe(12);
    expect(d.freq('花园')).toBe(400);
    expect(d.freq('北京大学')).toBe(40);
    expect(d.freq('白云')).toBe(80);
  });
});

describe('hsk', () => {
  it('parses levels, ranks and both scripts', async () => {
    const d = await miniDict({
      hsk: [['爱', '愛', '1', '1', '120'], ['呵', '呵', '', '6', '5230'], ['阿姨', '阿姨', '4', '3', '4355']],
    });
    expect(d.hsk('愛')).toEqual({ hsk3: 1, hsk2: 1, rank: 120 });
    expect(d.hsk('呵')).toEqual({ hsk2: 6, rank: 5230 });
    expect(d.hskWords(1)).toEqual(['爱']);
    expect(d.hskWords(4)).toEqual(['爱', '阿姨']);
  });
});

describe('conversion', () => {
  it('prefers the longest phrase and never splits a surrogate pair', async () => {
    const d = await miniDict({
      s2t: [['发', '發'], ['头发', '頭髮'], ['发展', '發展'], ['\u{20000}', '\u{20001}']],
      t2s: [['發', '发'], ['髮', '发']],
    });
    expect(d.toTraditional('头发和发展，发')).toBe('頭髮和發展，發');
    expect(d.toTraditional('\u{20000}发')).toBe('\u{20001}發');
    expect(d.toSimplified('髮與發')).toBe('发與发');
  });
});
