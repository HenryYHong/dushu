// Clean-ups every import gets (src/import/chapters.ts, applied in src/import/index.ts finish()).
import { describe, expect, it } from 'vitest';
import { importText, IMPORT_VERSION } from '../../src/import';
import { joinSplitParagraphs, normalizePunctuation } from '../../src/import/chapters';
import type { Block } from '../../src/types';

const p = (text: string): Block => ({ t: 'p', text });
const texts = (blocks: Block[]) => blocks.map((b) => ('text' in b ? b.text : b.t));
// Prose of n Han characters (no punctuation inside), for paragraphs long enough to count as prose.
const run = (n: number, from = 0) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + ((from + i * 7) % 2000))).join('');

describe('punctuation', () => {
  it('sets small-form marks full-width', () => {
    expect(normalizePunctuation('伏完忠義欲何如﹖後人有讚曰﹕清河崔琰﹐天性堅剛﹔')).toBe('伏完忠義欲何如？後人有讚曰：清河崔琰，天性堅剛；');
  });
  it('sets an ASCII mark between two Han characters full-width, and leaves other ASCII alone', () => {
    expect(normalizePunctuation('宋江道,我們走;好嗎?走!')).toBe('宋江道，我們走；好嗎？走!');
    expect(normalizePunctuation('第1回: Chapter 1, 3.5 km')).toBe('第1回: Chapter 1, 3.5 km');
  });
});

describe('paragraphs broken mid-sentence', () => {
  it('joins prose that stops on a Han character with prose that goes on', () => {
    const a = run(60) + '前面稍';
    const b = '待片刻' + run(30);
    expect(texts(joinSplitParagraphs([p(a), p(b), p('下一段。')]))).toEqual([a + b, '下一段。']);
  });
  it('joins at a comma only after a long paragraph, and chains', () => {
    const a = run(70) + '，';
    expect(texts(joinSplitParagraphs([p(a), p(run(25, 3)), p(run(25, 5))]))).toEqual([a + run(25, 3) + run(25, 5)]);
  });
  it('joins a paragraph that starts with a closing mark to the one before, whatever their lengths', () => {
    // 水滸傳 on Wikisource was cut every 998 characters, sometimes just before a comma or a full stop.
    const cut = run(998, 1) + '總管做媒';
    expect(texts(joinSplitParagraphs([p(cut), p('。我有個好見識。')]))).toEqual([`${cut}。我有個好見識。`]);
    expect(texts(joinSplitParagraphs([p('短句'), p('，只得收拾了行仗。')]))).toEqual(['短句，只得收拾了行仗。']);
    for (const mark of ['，', '。', '、', '；', '：', '！', '？', '」', '』']) {
      expect(texts(joinSplitParagraphs([p(run(30) + '。'), p(`${mark}${run(5)}`)])), mark).toHaveLength(1);
    }
    // An opening mark starts a paragraph as usual.
    const quote = [p(run(30) + '。'), p('「' + run(30) + '」')];
    expect(joinSplitParagraphs(quote)).toBe(quote);
  });

  it('leaves verse, short lines, finished sentences and spaced-out lines apart', () => {
    const verse = [p('滿紙荒唐言，'), p('一把辛酸淚！'), p('都云作者痴，'), p('誰解其中味？')];
    expect(joinSplitParagraphs(verse)).toBe(verse);
    // Speech that leads into a poem: the line after is a short verse line.
    const lead = [p(run(50) + '道：「我'), p('當年奉旨出長安，')];
    expect(joinSplitParagraphs(lead)).toBe(lead);
    const done = [p(run(50) + '。'), p(run(30))];
    expect(joinSplitParagraphs(done)).toBe(done);
    // A letter's signature line set out with a wide space.
    const letter = [p(run(50) + '某月某日　煥章再拜奉上'), p('宿太尉看了書' + run(30))];
    expect(joinSplitParagraphs(letter)).toBe(letter);
    const head = [{ t: 'h' as const, level: 2 as const, text: run(50) }, p(run(30))];
    expect(joinSplitParagraphs(head)).toBe(head);
  });
});

describe('every import', () => {
  it('is tidied and stamped with the importer version', () => {
    const book = importText(`第一章\n\n${run(60)}前面稍\n\n待片刻${run(30)}﹐好嗎﹖\n\n第二章\n\n${run(80)}。`, '书');
    expect(book.importVersion).toBe(IMPORT_VERSION);
    expect(texts(book.chapters[0].blocks).slice(-1)[0]).toBe(`${run(60)}前面稍待片刻${run(30)}，好嗎？`);
  });

  it('keeps a short text whose sections are bare numerals in one chapter, the numerals as headings', () => {
    const nums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三'];
    const text = `某君昆仲，今隐其名。\n\n${nums.map((n, i) => `${n}\n\n${run(200, i)}。`).join('\n\n')}`;
    const book = importText(text, '狂人日记');
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].title).toBe('狂人日记');
    expect(book.chapters[0].blocks.filter((b) => b.t === 'h').map((b) => ('text' in b ? b.text : ''))).toEqual(nums);
  });

  it('still cuts a long text at bare-numeral sections into chapters', () => {
    const nums = ['一', '二', '三', '四'];
    const book = importText(nums.map((n, i) => `${n}\n\n${Array.from({ length: 6 }, (_, k) => `${run(400, i * 10 + k)}。`).join('\n\n')}`).join('\n\n'), '长');
    expect(book.chapters.map((c) => c.title)).toEqual(nums);
  });
});
