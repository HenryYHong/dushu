import { describe, expect, it } from 'vitest';
import { pagesToParagraphs, type PdfItem, type PdfPageItems } from '../../src/import/pdfLayout';

const W = 595;
const H = 842;
const SIZE = 12;

/** One line of CJK text starting at x, with its baseline at y. */
function line(x: number, y: number, text: string, extra: Partial<PdfItem> = {}): PdfItem {
  return { str: text, x, y, w: [...text].length * SIZE, size: SIZE, ...extra };
}
const page = (items: PdfItem[]): PdfPageItems => ({ width: W, height: H, items });

/** Lines of a paragraph, each 36 characters wide, 18 pt apart, from the top of the page. */
function para(text: string, top: number, indent = false, width = 36): PdfItem[] {
  const chars = [...text];
  const out: PdfItem[] = [];
  for (let i = 0, row = 0; i < chars.length; i += width, row++) {
    const first = row === 0 && indent;
    out.push(line(72 + (first ? 24 : 0), top - row * 18, chars.slice(i, i + width).join('')));
  }
  return out;
}
const T = (n: number, seed = 0) => {
  const s = '山中有一条小河，河水清清地流着，岸边长满了青草和野花。孩子们常在这里捉鱼，大人们则坐在树下聊天。'.repeat(8);
  return [...s].slice(seed, seed + n - 1).join('') + '。';
};

describe('PDF line and paragraph grouping', () => {
  it('orders items in a line by x and reads lines from the top down', () => {
    const items = [line(108, 700, '世界。'), line(72, 682, '第二行。'), line(72, 700, '你好，')];
    expect(pagesToParagraphs([page(items)])).toEqual(['你好，世界。第二行。']);
  });

  it('breaks paragraphs at an indent', () => {
    const a = T(80, 0);
    const b = T(80, 10);
    const items = [...para(a, 760, true), ...para(b, 760 - 18 * 3, true)];
    expect(pagesToParagraphs([page(items)])).toEqual([a, b]);
  });

  it('breaks paragraphs after a short line that ends a sentence', () => {
    const a = T(50, 0); // 36 + 14: last line is short and ends with 。
    const b = T(70, 20);
    const items = [...para(a, 760), ...para(b, 760 - 18 * 2)];
    expect(pagesToParagraphs([page(items)])).toEqual([a, b]);
  });

  it('breaks paragraphs at a larger vertical gap', () => {
    const a = T(72, 0);
    const b = T(72, 5);
    const items = [...para(a, 760), ...para(b, 760 - 18 * 2 - 18)];
    expect(pagesToParagraphs([page(items)])).toEqual([a, b]);
  });

  it('keeps a wrapped paragraph together', () => {
    const a = T(100, 0);
    const items = [...para(a, 760, true), ...para(T(100, 30), 760 - 18 * 3, true)];
    expect(pagesToParagraphs([page(items)])[0]).toBe(a);
  });

  it('puts a chapter heading on its own', () => {
    const items = [line(72, 780, '第三章 河边'), ...para(T(72, 0), 760), ...para(T(72, 9), 760 - 18 * 2)];
    const out = pagesToParagraphs([page(items)]);
    expect(out[0]).toBe('第三章 河边');
    expect(out).toHaveLength(2);
  });

  it('adds a space between Latin words but not between Chinese characters', () => {
    const latin = [
      { str: 'Hello', x: 72, y: 700, w: 30, size: SIZE },
      { str: 'world', x: 108, y: 700, w: 30, size: SIZE },
    ];
    expect(pagesToParagraphs([page(latin)])).toEqual(['Hello world']);
    const cjk = [line(72, 700, '你好'), line(96, 700, '世界。')];
    expect(pagesToParagraphs([page(cjk)])).toEqual(['你好世界。']);
    const gapped = [line(72, 700, '第一章'), line(120, 700, '清晨')];
    expect(pagesToParagraphs([page(gapped)])).toEqual(['第一章 清晨']);
  });

  it('drops page numbers and running heads', () => {
    const pages = Array.from({ length: 5 }, (_, i) =>
      page([
        line(72, 815, '读书指南'),
        ...para(T(70, i * 3), 760, true),
        line(290, 30, String(i + 12), { w: 24 }),
      ]),
    );
    const out = pagesToParagraphs(pages);
    expect(out).toHaveLength(5);
    expect(out.join('')).not.toMatch(/读书指南|\d/);
  });

  it('joins a paragraph that runs over a page break, but not a new indented one', () => {
    const full = T(72, 0).replace(/。$/, '字'); // fills two lines, no sentence end
    const p1 = page([...para(T(36, 3), 760), ...para(full, 760 - 18 * 2)]);
    const p2 = page(para(T(40, 8), 760));
    expect(pagesToParagraphs([p1, p2])).toEqual([T(36, 3) + full + T(40, 8)]);
    const p2b = page(para(T(40, 8), 760, true));
    const out = pagesToParagraphs([p1, p2b]);
    expect(out).toHaveLength(2);
  });

  it('reads two columns one after the other', () => {
    const left = Array.from({ length: 12 }, (_, i) => line(60, 780 - i * 18, T(14, i)));
    const right = Array.from({ length: 12 }, (_, i) => ({ ...line(330, 780 - i * 18, T(14, 40 + i)), w: 14 * SIZE }));
    const out = pagesToParagraphs([page([...left, ...right])]).join('');
    expect(out.indexOf(T(14, 0))).toBeLessThan(out.indexOf(T(14, 11)));
    expect(out.indexOf(T(14, 11))).toBeLessThan(out.indexOf(T(14, 40)));
  });

  it('reads vertical text in columns from the right', () => {
    const col = (x: number, text: string): PdfItem => ({ str: text, x, y: 780, w: [...text].length * SIZE, size: SIZE, vertical: true });
    const items = [col(300, '第二列在左边。'), col(330, '第一列在右边，'), col(270, '第三列最后。')];
    expect(pagesToParagraphs([page(items)]).join('')).toBe('第一列在右边，第二列在左边。第三列最后。');
  });

  it('returns nothing for a page with no text', () => {
    expect(pagesToParagraphs([page([])])).toEqual([]);
  });
});
