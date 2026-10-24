// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importText } from '../../src/import';
import { fetchSamples, loadSampleBook, parseSampleIndex, sampleSourceName } from '../../src/ui/library/samples';

const samplesDir = join(__dirname, '../../public/samples');
const realIndex = JSON.parse(readFileSync(join(samplesDir, 'index.json'), 'utf8'));
const res = (ok: boolean, body: string) => Promise.resolve({ ok, text: () => Promise.resolve(body) });

describe('parseSampleIndex', () => {
  it('reads the real index', () => {
    const list = parseSampleIndex(realIndex);
    expect(list.length).toBe(realIndex.length);
    expect(list.every((s) => s.id && s.title && s.file)).toBe(true);
    expect(list.find((s) => s.id === 'xiyouji')?.group).toBe('Four Great Classical Novels');
  });

  it('drops rows it cannot show or import, and path tricks', () => {
    const list = parseSampleIndex([
      { id: 'a', title: 'A', file: 'a.txt' },
      { id: 'a', title: 'dup', file: 'b.txt' },
      { id: 'b', title: '', file: 'b.txt' },
      { id: 'c', title: 'C', file: '../secret.txt' },
      { id: 'd', title: 'D', file: 'x/y.txt' },
      null, 42, 'x',
    ]);
    expect(list.map((s) => s.id)).toEqual(['a']);
    expect(list[0].script).toBe('unknown');
  });

  it('returns nothing for a non-array', () => {
    expect(parseSampleIndex({})).toEqual([]);
    expect(parseSampleIndex(null)).toEqual([]);
  });
});

describe('fetchSamples when the files are missing', () => {
  it('handles 404, an HTML fallback page, bad JSON and network errors', async () => {
    expect(await fetchSamples(() => res(false, ''))).toEqual([]);
    expect(await fetchSamples(() => res(true, '<!doctype html><html></html>'))).toEqual([]);
    expect(await fetchSamples(() => res(true, '{not json'))).toEqual([]);
    expect(await fetchSamples(() => Promise.reject(new Error('offline')))).toEqual([]);
  });

  it('parses a good response', async () => {
    const list = await fetchSamples(() => res(true, JSON.stringify(realIndex)));
    expect(list.length).toBe(realIndex.length);
  });
});

describe('loadSampleBook', () => {
  it('imports a real sample with the index title, author and provenance', async () => {
    const s = parseSampleIndex(realIndex).find((x) => x.id === 'kong-yiji')!;
    const text = readFileSync(join(samplesDir, s.file), 'utf8');
    const book = await loadSampleBook(s, importText, () => res(true, text));
    expect(book.title).toBe('孔乙己');
    expect(book.author).toBe('鲁迅');
    expect(book.format).toBe('sample');
    expect(book.script).toBe('simplified');
    expect(book.sourceName).toBe(sampleSourceName('kong-yiji'));
    expect(book.note).toContain('wikisource');
    expect(book.chapters.length).toBeGreaterThan(0);
  });

  it('splits a long novel into its chapters', async () => {
    const s = parseSampleIndex(realIndex).find((x) => x.id === 'xiyouji-1')!;
    const text = readFileSync(join(samplesDir, s.file), 'utf8');
    const book = await loadSampleBook(s, importText, () => res(true, text));
    expect(book.chapters.length).toBeGreaterThanOrEqual(1);
    expect(book.script).toBe('traditional');
  });

  it('has no paragraph that starts with a closing mark, in the files or in the books made from them', () => {
    // A line that starts with ，。」 … was cut from the line before it (水滸傳 came from Wikisource in 998-character pieces).
    const closing = /^[\s\u3000]*[，。、；：！？」』]/;
    for (const s of parseSampleIndex(realIndex)) {
      const text = readFileSync(join(samplesDir, s.file), 'utf8');
      const lines = text.split('\n').map((l, i) => ({ l, i: i + 1 })).filter(({ l }) => closing.test(l));
      expect(lines.map(({ l, i }) => `${s.file}:${i} ${l.slice(0, 12)}`)).toEqual([]);
      const starts = importText(text, s.title, s.author).chapters.flatMap((c) => c.blocks)
        .filter((b) => b.t === 'p' && closing.test(b.text)).map((b) => ('text' in b ? b.text.slice(0, 12) : ''));
      expect(starts, s.file).toEqual([]);
    }
  });

  it('draws each sample\'s own headings as headings: poem titles, 學而第一, and the 回目 as the title of 西遊記 第一回', () => {
    const book = (id: string) => {
      const s = parseSampleIndex(realIndex).find((x) => x.id === id)!;
      return importText(readFileSync(join(samplesDir, s.file), 'utf8'), s.title, s.author);
    };
    const heads = (id: string) => book(id).chapters.flatMap((c) => c.blocks).filter((b) => b.t === 'h').map((b) => ('text' in b ? b.text : ''));
    expect(heads('tang-poems')).toEqual(['靜夜思　李白', '春曉　孟浩然', '登鸛雀樓　王之渙', '相思　王維', '江雪　柳宗元', '遊子吟　孟郊', '詠鵝　駱賓王', '鹿柴　王維']);
    expect(book('tang-poems').chapters).toHaveLength(1);
    expect(heads('lunyu-xue-er')).toEqual(['學而第一']);
    expect(book('lunyu-xue-er').chapters.map((c) => c.title)).toEqual(['學而第一']);
    // The chapter's title is its own 回目, so the reader does not add 西遊記 第一回 above it.
    const xi = book('xiyouji-1').chapters;
    expect(xi.map((c) => c.title)).toEqual(['第一回 靈根育孕源流出 心性修持大道生']);
    expect(xi[0].blocks[0]).toMatchObject({ t: 'h', text: xi[0].title });
  });

  it('explains failures in plain words', async () => {
    const s = parseSampleIndex(realIndex)[0];
    await expect(loadSampleBook(s, importText, () => res(false, ''))).rejects.toThrow(/Could not download/);
    await expect(loadSampleBook(s, importText, () => res(true, '<!doctype html><html></html>'))).rejects.toThrow(/not available/);
  });
});
