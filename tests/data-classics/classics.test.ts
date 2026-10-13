// Data checks for the Four Great Classical Novels in public/samples/. Reads the files with fs only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '../../public/samples');
const BOOKS = [
  { id: 'xiyouji', file: 'xiyouji.txt', title: '西遊記', chapters: 100 },
  { id: 'hongloumeng', file: 'hongloumeng.txt', title: '紅樓夢', chapters: 120 },
  { id: 'sanguo', file: 'sanguo.txt', title: '三國演義', chapters: 120 },
  { id: 'shuihu', file: 'shuihu.txt', title: '水滸傳', chapters: 120 },
];

// Same rule as the importer's heading detection (ARCHITECTURE.md 4.5; src/import/chapters.ts): a short
// line that starts like a chapter heading and does not end in sentence punctuation.
const HEAD = /^\s*(第[0-9〇零一二三四五六七八九十百千两]+[章回节卷集部篇幕]|序[章言]?|楔子|引子|前言|后记|後記|尾声|尾聲|番外|Chapter\s+\d+)/;
const isHeading = (l: string) => [...l.trim()].length <= 40 && !/[。，；、]$/.test(l.trim()) && HEAD.test(l);
const HAN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{3134f}]/gu;
const han = (s: string) => (s.match(HAN) ?? []).length;
const MARKUP = /\[\[|\]\]|\{\{|\}\}|<\/?[a-zA-Z!][^>]*>|<ref|-\{|\}-|&[a-z]+;|&#\d+;|^=+|=+$|\|\||^\s*[*#:;]|__[A-Z]+__|https?:\/\/|\[|\]/;
const NAV = /^(上一回|下一回|回目[录錄])([\s\u3000]|$)/;

function cnToInt(s: string): number {
  const d: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else cur = d[ch];
  }
  return total + cur;
}

for (const b of BOOKS) {
  describe(b.title, () => {
    const text = readFileSync(join(DIR, b.file), 'utf8');
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    const headings = lines.map((l, i) => ({ l, i })).filter((x) => isHeading(x.l));

    it('starts with the title alone and is UTF-8 text with LF line ends', () => {
      expect(lines[0]).toBe(b.title);
      expect(text).not.toContain('\r');
      expect(text).not.toContain('�');
    });

    it(`splits into exactly ${b.chapters} chapters by the importer heading rule`, () => {
      expect(headings.length).toBe(b.chapters);
      // numbered 1..N in order, "第N回" + U+3000 + couplet title
      headings.forEach((h, k) => {
        const m = /^第([〇零一二三四五六七八九十百]+)回　(\S+(?:\u3000\S+)*)$/.exec(h.l);
        expect(m, h.l).not.toBeNull();
        expect(cnToInt(m![1]), h.l).toBe(k + 1);
      });
      expect(headings[0].i).toBe(1);
    });

    it('has no empty or truncated chapter', () => {
      const counts = headings.map((h, k) => han(lines.slice(h.i + 1, headings[k + 1]?.i ?? lines.length).join('')));
      const sorted = [...counts].sort((x, y) => x - y);
      const median = sorted[sorted.length >> 1];
      counts.forEach((n, k) => expect(n, `chapter ${k + 1}`).toBeGreaterThan(median * 0.3));
      counts.forEach((n, k) => expect(n, `chapter ${k + 1}`).toBeLessThan(median * 3));
    });

    it('has no markup or navigation leakage', () => {
      const bad = lines.filter((l) => MARKUP.test(l) || NAV.test(l));
      expect(bad.slice(0, 3)).toEqual([]);
      expect(lines.filter((l) => /[A-Za-z0-9]/.test(l)).slice(0, 3)).toEqual([]);
      expect(lines.filter((l) => !han(l)).slice(0, 3)).toEqual([]);
    });

    it('is registered in samples/index.json with matching counts', () => {
      const idx = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as Record<string, unknown>[];
      const e = idx.find((x) => x.id === b.id)!;
      expect(e).toBeDefined();
      expect(e.file).toBe(b.file);
      expect(e.script).toBe('traditional');
      expect(e.group).toBe('Four Great Classical Novels');
      expect(e.chapters).toBe(b.chapters);
      expect(e.chars).toBe(han(text));
    });
  });
}
