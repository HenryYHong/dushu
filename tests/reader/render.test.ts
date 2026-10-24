// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { Dictionary } from '../../src/types';
import {
  displayTokens, pinyinVisible, refreshPinyin, refreshVisibility, renderParagraph, rtContent, type RenderOptions,
} from '../../src/ui/reader/render';
import { blockText, pointToOffset, rangeToSpans, snapToCodePoint, spansText, textNodes } from '../../src/ui/reader/selection';
import { loadTestDictionary } from '../helpers/data';

let dict: Dictionary;
beforeAll(async () => { dict = await loadTestDictionary(); });

const opts = (o: Partial<RenderOptions> = {}): RenderOptions => ({ style: 'marks', toneColors: true, sandhi: true, ...o });
const baseText = (el: Element) => [...el.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join('');

describe('renderParagraph', () => {
  it('makes a span per Han token and a ruby per character', () => {
    const p = renderParagraph('我们在银行门口见面。', dict, opts());
    const words = [...p.el.querySelectorAll('.rd-w')];
    expect(words.map(baseText)).toEqual(['我们', '在', '银行', '门口', '见面']);
    expect(p.el.querySelectorAll('ruby')).toHaveLength(9);
    expect(p.el.querySelectorAll('rt')).toHaveLength(9);
    expect(words[2].getAttribute('data-s')).toBe('3');
    expect(words[2].getAttribute('data-e')).toBe('5');
    // Source text survives, punctuation included, with pinyin excluded.
    expect(blockText(p.el)).toBe('我们在银行门口见面。');
  });

  it('puts pinyin in rt with tone classes and follows the style', () => {
    const marks = renderParagraph('你好', dict, opts());
    const rts = [...marks.el.querySelectorAll('rt')];
    expect(rts.map((r) => r.textContent)).toEqual(['nǐ', 'hǎo']);
    expect(rts.map((r) => r.className)).toEqual(['tone-3', 'tone-3']);
    const numbers = renderParagraph('你好', dict, opts({ style: 'numbers', toneColors: false }));
    expect([...numbers.el.querySelectorAll('rt')].map((r) => r.textContent)).toEqual(['ni3', 'hao3']);
    expect([...numbers.el.querySelectorAll('rt')].every((r) => r.className === '')).toBe(true);
    const zhuyin = renderParagraph('你好', dict, opts({ style: 'zhuyin' }));
    expect([...zhuyin.el.querySelectorAll('rt')].map((r) => r.textContent)).toEqual(['ㄋㄧˇ', 'ㄏㄠˇ']);
  });

  it('applies 一/不 sandhi only when asked and keeps the original tokens pristine', () => {
    const on = renderParagraph('一个人不是', dict, opts({ sandhi: true }));
    const off = renderParagraph('一个人不是', dict, opts({ sandhi: false }));
    const syl = (p: typeof on) => [...p.el.querySelectorAll('rt')].map((r) => r.textContent);
    expect(syl(on)[3]).toBe('bú');
    expect(syl(off)[3]).toBe('bù');
    expect(on.tokens.find((t) => t.text === '不是')?.pinyin).toEqual(['bu4', 'shi4']);
    expect(on.shown.find((t) => t.text === '不是')?.pinyin).toEqual(['bu2', 'shi4']);
  });

  it('renders astral, radical and compatibility characters one ruby each', () => {
    const text = '𠀀𪚥𰻞⼈豈';
    const p = renderParagraph(text, dict, opts());
    const rubies = [...p.el.querySelectorAll('ruby')];
    expect(rubies.map((r) => (r.firstChild as Text).data)).toEqual(['𠀀', '𪚥', '𰻞', '⼈', '豈']);
    expect(rubies.map((r) => r.getAttribute('data-o'))).toEqual(['0', '2', '4', '6', '7']);
    expect(blockText(p.el)).toBe(text);
  });

  it('marks a word of five characters or more (a heading may break inside it in a narrow column)', () => {
    const p = renderParagraph('中华人民共和国成立了。', dict, opts());
    const words = [...p.el.querySelectorAll('.rd-w')];
    expect(words.map(baseText)).toEqual(['中华人民共和国', '成立', '了']);
    expect(words.map((w) => w.classList.contains('rd-w-long'))).toEqual([true, false, false]);
  });

  it('keeps Latin, numbers and spaces as plain text', () => {
    const p = renderParagraph('他有 3 本 book。', dict, opts());
    expect(blockText(p.el)).toBe('他有 3 本 book。');
    expect(baseText(p.el)).toBe('他有本');
  });

  it('hides words through the nopy class and rt content never enters the text', () => {
    const p = renderParagraph('我们在银行', dict, opts({ visible: (t) => t.text !== '银行' }));
    const hidden = [...p.el.querySelectorAll('.rd-nopy')].map(baseText);
    expect(hidden).toEqual(['银行']);
    expect(p.el.textContent).toContain('yín'); // present in the DOM...
    expect(blockText(p.el)).toBe('我们在银行'); // ...but not part of the text
  });
});

describe('live updates reuse the existing nodes', () => {
  it('restyles pinyin without recreating elements', () => {
    const p = renderParagraph('银行的钱', dict, opts());
    const before = [...p.el.querySelectorAll('ruby')];
    refreshPinyin(p, opts({ style: 'numbers', toneColors: false }));
    const after = [...p.el.querySelectorAll('ruby')];
    expect(after).toEqual(before);
    expect(after.every((r, i) => r === before[i])).toBe(true);
    expect([...p.el.querySelectorAll('rt')].map((r) => r.textContent)).toEqual(['yin2', 'hang2', 'de5', 'qian2']);
    expect(p.el.querySelector('rt')!.className).toBe('');
  });

  it('toggles sandhi in place', () => {
    const p = renderParagraph('不是', dict, opts({ sandhi: false }));
    const rt = p.el.querySelector('rt')!;
    expect(rt.textContent).toBe('bù');
    refreshPinyin(p, opts({ sandhi: true }));
    expect(p.el.querySelector('rt')).toBe(rt);
    expect(rt.textContent).toBe('bú');
  });

  it('toggles visibility in place', () => {
    const p = renderParagraph('我们在银行', dict, opts());
    refreshVisibility(p, (t) => t.text === '银行');
    expect([...p.el.querySelectorAll('.rd-w:not(.rd-nopy)')].map(baseText)).toEqual(['银行']);
    refreshVisibility(p, () => true);
    expect(p.el.querySelectorAll('.rd-nopy')).toHaveLength(0);
  });
});

describe('pinyin visibility rule', () => {
  const rule = (mode: 'off' | 'all' | 'unknown' | 'hsk', known: string[] = [], hsk: Record<string, number> = {}, hskThreshold = 3) => ({
    mode, hskThreshold, isKnown: (w: string) => known.includes(w), hskLevel: (w: string) => hsk[w],
  });
  it('off and all', () => {
    expect(pinyinVisible('我', rule('off'))).toBe(false);
    expect(pinyinVisible('我', rule('all', ['我']))).toBe(true);
  });
  it('unknown hides only known words', () => {
    expect(pinyinVisible('我', rule('unknown', ['我']))).toBe(false);
    expect(pinyinVisible('银行', rule('unknown', ['我']))).toBe(true);
  });
  it('hsk hides known words and words at or below the threshold', () => {
    const r = rule('hsk', ['朋友'], { 你好: 1, 银行: 3, 经济: 5 });
    expect(pinyinVisible('你好', r)).toBe(false);
    expect(pinyinVisible('银行', r)).toBe(false);
    expect(pinyinVisible('经济', r)).toBe(true);
    expect(pinyinVisible('朋友', r)).toBe(false);
    expect(pinyinVisible('稀有', r)).toBe(true); // not on the list
  });
  it('hsk passes the reading in context to the level', () => {
    const seen: (string[] | undefined)[] = [];
    const r = { ...rule('hsk'), hskLevel: (_w: string, py?: string[]) => { seen.push(py); return py?.[0] === 'shi2' ? 1 : undefined; } };
    expect(pinyinVisible('石', r, ['shi2'])).toBe(false);
    expect(pinyinVisible('石', r, ['dan4'])).toBe(true);
    expect(seen).toEqual([['shi2'], ['dan4']]);
  });
});

describe('displayTokens and rtContent', () => {
  it('copies tokens before applying sandhi', () => {
    const tokens = renderParagraph('不是', dict, opts()).tokens;
    const shown = displayTokens(tokens, true);
    expect(shown[0].pinyin).not.toBe(tokens[0].pinyin);
    expect(tokens[0].pinyin).toEqual(['bu4', 'shi4']);
  });
  it('lowercases proper-noun syllables', () => {
    expect(rtContent('Bei3', { style: 'marks', toneColors: true })).toEqual({ text: 'běi', cls: 'tone-3' });
  });
});

describe('selection mapping', () => {
  function setup() {
    const root = document.createElement('div');
    const a = renderParagraph('我们在银行门口。', dict, opts());
    const b = renderParagraph('𠀀𪚥𰻞见面', dict, opts());
    a.el.dataset.b = '0';
    b.el.dataset.b = '1';
    root.append(a.el, b.el);
    document.body.appendChild(root);
    return { root, a, b };
  }

  it('skips rt when counting offsets', () => {
    const { a } = setup();
    expect(textNodes(a.el).every((t) => !t.parentElement!.closest('rt'))).toBe(true);
    const ruby = a.el.querySelectorAll('ruby')[4]; // 行
    const text = ruby.firstChild as Text;
    expect(pointToOffset(a.el, text, 0)).toBe(4);
    expect(pointToOffset(a.el, text, 1)).toBe(5);
    const rt = ruby.querySelector('rt')!;
    expect(pointToOffset(a.el, rt.firstChild!, 2)).toBe(5); // inside the pinyin counts as the end of its character
  });

  it('handles element boundaries', () => {
    const { a } = setup();
    expect(pointToOffset(a.el, a.el, 0)).toBe(0);
    expect(pointToOffset(a.el, a.el, a.el.childNodes.length)).toBe('我们在银行门口。'.length);
    const word = a.el.querySelectorAll('.rd-w')[2];
    expect(pointToOffset(a.el, a.el, Array.prototype.indexOf.call(a.el.childNodes, word))).toBe(3);
  });

  it('maps a range across two blocks and returns clean text', () => {
    const { a, b } = setup();
    const r = document.createRange();
    r.setStart(a.el.querySelectorAll('ruby')[2].firstChild!, 0); // 在
    r.setEnd(b.el.querySelectorAll('ruby')[2].firstChild!, 2); // after 𰻞 (two UTF-16 units)
    const spans = rangeToSpans(r, [a.el, b.el]);
    expect(spans.map((s) => [s.start, s.end])).toEqual([[2, 8], [0, 6]]);
    const text = spansText(spans, (el) => (el === a.el ? a.text : b.text));
    expect(text).toBe('在银行门口。\n𠀀𪚥𰻞');
    expect(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(text)).toBe(false);
  });

  it('never splits a surrogate pair', () => {
    const s = '𠀀𪚥';
    expect(snapToCodePoint(s, 1, -1)).toBe(0);
    expect(snapToCodePoint(s, 1, 1)).toBe(2);
    expect(snapToCodePoint(s, 2, 1)).toBe(2);
  });
});

describe('even grid markup', () => {
  it('puts the pinyin text in a span inside the rt (Safari cannot position an rt itself)', () => {
    const p = renderParagraph('你好', dict, opts());
    const rt = p.el.querySelector('rt')!;
    expect(rt.firstElementChild?.className).toBe('rd-rtx');
    expect(rt.textContent).toBe('nǐ');
  });
  it('restyling pinyin updates the span text, not the structure', () => {
    const p = renderParagraph('你好', dict, opts());
    const span = p.el.querySelector('rt .rd-rtx')!;
    refreshPinyin(p, opts({ style: 'numbers' }));
    expect(p.el.querySelector('rt .rd-rtx')).toBe(span);
    expect(span.textContent).toBe('ni3');
  });
  it('wraps full-width punctuation in a cell of its own, marking openers and closers', () => {
    const p = renderParagraph('他说：（你好。）', dict, opts());
    const sides = [...p.el.querySelectorAll('.rd-pu')].map((e) => [e.textContent, e.classList.contains('rd-pu-o') ? 'o' : 'c']);
    expect(sides).toEqual([['：', 'c'], ['（', 'o'], ['。', 'c'], ['）', 'c']]);
    expect(blockText(p.el)).toBe('他说：（你好。）');
  });
  it('gives the curly quotes a class of their own, not the full-width trimming of the other marks', () => {
    const p = renderParagraph('他说：“你好。”她想：‘好’。', dict, opts());
    const quotes = [...p.el.querySelectorAll('.rd-pu-q')].map((e) => [e.textContent, e.className]);
    expect(quotes).toEqual([
      ['“', 'rd-pu rd-pu-q rd-pu-qo rd-pq-ldq'], ['”', 'rd-pu rd-pu-q rd-pu-qc rd-pq-rdq'],
      ['‘', 'rd-pu rd-pu-q rd-pu-qo rd-pq-lsq'], ['’', 'rd-pu rd-pu-q rd-pu-qc rd-pq-rsq'],
    ]);
    // Never in the classes that pull half the box back (that is what put the quote's ink on the colon).
    for (const e of p.el.querySelectorAll('.rd-pu-q')) expect(e.classList.contains('rd-pu-o') || e.classList.contains('rd-pu-c')).toBe(false);
    expect(blockText(p.el)).toBe('他说：“你好。”她想：‘好’。');
  });
  it('leaves ASCII punctuation and dashes alone', () => {
    const p = renderParagraph('好, 好——好...', dict, opts());
    expect(p.el.querySelectorAll('.rd-pu')).toHaveLength(0);
  });
});
