import { describe, expect, it } from 'vitest';
import { SCRIPT_MARKERS, countHan, detectScript, hasHan, isHanCodePoint, sentenceAround, splitSentences } from '../../src/core/text';
import { loadTestDictionary } from '../helpers/data';
import { measure } from '../helpers/perf';

describe('isHanCodePoint', () => {
  const yes: [string, number][] = [
    ['URO start', 0x4e00], ['URO end', 0x9fff], ['Ext A start', 0x3400], ['Ext A end', 0x4dbf],
    ['Ext B start', 0x20000], ['Ext B end', 0x2a6df], ['Ext C', 0x2a700], ['Ext D', 0x2b740], ['Ext E', 0x2b820],
    ['Ext F', 0x2ceb0], ['Ext I', 0x2ebf0], ['Ext G', 0x30000], ['Ext H', 0x31350], ['Ext J start', 0x323b0],
    ['Ext J end', 0x3347f], ['compat', 0xf900], ['compat end', 0xfaff], ['compat supplement', 0x2f800],
    ['Kangxi radical 人', 0x2f08], ['CJK radical supplement', 0x2e80], ['〇', 0x3007], ['人', 0x4eba],
  ];
  for (const [name, cp] of yes) it(`${name} U+${cp.toString(16)} is Han`, () => expect(isHanCodePoint(cp)).toBe(true));
  const no: [string, number][] = [
    ['ASCII a', 0x61], ['digit', 0x31], ['full stop 。', 0x3002], ['hiragana', 0x3042], ['katakana', 0x30a2], ['hangul', 0xac00],
    ['hexagram', 0x4dc0], ['yi syllable', 0xa000], ['ideographic description', 0x2ff0], ['CJK strokes', 0x31c0],
    ['past Ext J', 0x33480], ['fullwidth A', 0xff21], ['emoji', 0x1f600], ['0', 0], ['space', 0x3000],
  ];
  for (const [name, cp] of no) it(`${name} U+${cp.toString(16)} is not Han`, () => expect(isHanCodePoint(cp)).toBe(false));
});

describe('hasHan / countHan', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(countHan('abc')).toBe(0);
    expect(countHan('你好, world')).toBe(2);
    expect(countHan('𠀀𪚥𰻞')).toBe(3);
    expect(countHan('a𠀀b人')).toBe(2);
    expect(countHan('')).toBe(0);
    expect(hasHan('hello')).toBe(false);
    expect(hasHan('hi 人')).toBe(true);
    expect(hasHan('x\u{323B0}')).toBe(true);
    expect(hasHan('')).toBe(false);
  });
  it('does not choke on lone surrogates', () => {
    expect(countHan('\ud800人')).toBe(1);
    expect(hasHan('\udc00')).toBe(false);
  });
});

describe('splitSentences', () => {
  const texts = (s: string) => splitSentences(s).map((x) => x.text);
  it('splits on 。！？；', () => {
    expect(texts('你好。我很好！你呢？好的；再见。')).toEqual(['你好。', '我很好！', '你呢？', '好的；', '再见。']);
  });
  it('keeps closing quotes and brackets with their sentence', () => {
    expect(texts('他说：“走吧。”她点头。')).toEqual(['他说：“走吧。”', '她点头。']);
    expect(texts('「你好。」「再见。」')).toEqual(['「你好。」', '「再见。」']);
    expect(texts('（他走了。）然后呢？')).toEqual(['（他走了。）', '然后呢？']);
    expect(texts('她问：“真的吗？！”')).toEqual(['她问：“真的吗？！”']);
  });
  it('handles straight quotes by parity', () => {
    expect(texts('他说："走吧。"然后走了。')).toEqual(['他说："走吧。"', '然后走了。']);
    expect(texts('"你好。" "再见。"')).toEqual(['"你好。"', '"再见。"']);
  });
  it('splits at line breaks and drops the break itself', () => {
    expect(texts('第一行\n第二行。\r\n第三行')).toEqual(['第一行', '第二行。', '第三行']);
    expect(texts('a。\n\n\nb')).toEqual(['a。', 'b']);
  });
  it('treats an ellipsis as a break only when nothing follows', () => {
    expect(texts('我……我不知道。')).toEqual(['我……我不知道。']);
    expect(texts('他走了……')).toEqual(['他走了……']);
    expect(texts('他走了……\n她来了。')).toEqual(['他走了……', '她来了。']);
    expect(texts('“我不……”他说。')).toEqual(['“我不……”他说。']);
    expect(texts('“好……” “是。”')).toEqual(['“好……”', '“是。”']);
  });
  it('does not split decimals or abbreviations of one capital letter', () => {
    expect(texts('圆周率是3.14。')).toEqual(['圆周率是3.14。']);
    expect(texts('Hello world. 你好。')).toEqual(['Hello world.', '你好。']);
    expect(texts('A. Smith 来了。')).toEqual(['A. Smith 来了。']);
  });
  it('returns exact offsets into the paragraph', () => {
    const t = '  第一句。  第二句！ ';
    for (const s of splitSentences(t)) expect(t.slice(s.start, s.end)).toBe(s.text);
    expect(splitSentences(t).map((s) => [s.start, s.end])).toEqual([[2, 6], [8, 12]]);
  });
  it('handles empty and punctuation-only input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   \n  ')).toEqual([]);
    expect(texts('。。。')).toEqual(['。。。']);
    expect(texts('没有句号')).toEqual(['没有句号']);
  });
  it('works across astral characters', () => {
    const t = '𠀀𪚥。𰻞！';
    expect(texts(t)).toEqual(['𠀀𪚥。', '𰻞！']);
  });
});

describe('sentenceAround', () => {
  const t = '你好。我很好！你呢？';
  it('returns the sentence that holds the index', () => {
    expect(sentenceAround(t, 0).text).toBe('你好。');
    expect(sentenceAround(t, 2).text).toBe('你好。');
    expect(sentenceAround(t, 3).text).toBe('我很好！');
    expect(sentenceAround(t, 6).text).toBe('我很好！');
    expect(sentenceAround(t, 7).text).toBe('你呢？');
    expect(sentenceAround(t, 8).text).toBe('你呢？');
    expect(sentenceAround(t, t.length - 1).text).toBe('你呢？');
  });
  it('reports offsets', () => {
    expect(sentenceAround(t, 4)).toEqual({ start: 3, end: 7, text: '我很好！' });
  });
  it('clamps out-of-range indexes and handles empty text', () => {
    expect(sentenceAround(t, -5).text).toBe('你好。');
    expect(sentenceAround(t, 999).text).toBe('你呢？');
    expect(sentenceAround('', 0)).toEqual({ start: 0, end: 0, text: '' });
  });
  it('maps an index in the gap between sentences to the earlier one', () => {
    expect(sentenceAround('甲。\n乙。', 2).text).toBe('甲。');
  });
});

describe('detectScript', () => {
  it('recognizes simplified', () => {
    expect(detectScript('我们在银行门口见面，他说这个问题很难。')).toBe('simplified');
    expect(detectScript('学习汉语')).toBe('simplified');
  });
  it('recognizes traditional', () => {
    expect(detectScript('我們在銀行門口見面，他說這個問題很難。')).toBe('traditional');
    expect(detectScript('學習漢語')).toBe('traditional');
  });
  it('recognizes a mix', () => {
    expect(detectScript('我们在银行门口见面。我們在銀行門口見面。')).toBe('mixed');
  });
  it('tolerates a stray character of the other script', () => {
    const simp = '他说这个问题很难，我们都觉得应该先学习汉语然后再去北京。'.repeat(4);
    expect(detectScript(simp + '說')).toBe('simplified');
  });
  it('says unknown when nothing distinguishes the scripts', () => {
    expect(detectScript('')).toBe('unknown');
    expect(detectScript('hello 123')).toBe('unknown');
    expect(detectScript('一二三四五六七八九十')).toBe('unknown');
    expect(detectScript('天地玄，宇宙洪荒')).toBe('unknown');
  });
  it('works on long text quickly', () => {
    const t = '我们的故事开始于一个下雨的夜晚。'.repeat(20000);
    const m = measure(() => detectScript(t));
    expect(m.result).toBe('simplified');
    expect(m.cpu).toBeLessThan(300);
  });
});

describe('script markers', () => {
  it('has about 300 characters per side and no overlap', () => {
    expect(SCRIPT_MARKERS.simplified.size).toBeGreaterThanOrEqual(280);
    expect(SCRIPT_MARKERS.traditional.size).toBeGreaterThanOrEqual(280);
    for (const c of SCRIPT_MARKERS.simplified) expect(SCRIPT_MARKERS.traditional.has(c), c).toBe(false);
  });
  it('agrees with the OpenCC tables: every traditional marker converts to a simplified marker', async () => {
    const dict = await loadTestDictionary();
    for (const t of SCRIPT_MARKERS.traditional) {
      const s = dict.toSimplified(t);
      expect(s, `${t} -> ${s}`).not.toBe(t);
      expect(SCRIPT_MARKERS.simplified.has(s), `${t} -> ${s}`).toBe(true);
    }
    for (const s of SCRIPT_MARKERS.simplified) {
      const t = dict.toTraditional(s);
      expect(t, `${s} -> ${t}`).not.toBe(s);
    }
  });
});
