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

  it('explains failures in plain words', async () => {
    const s = parseSampleIndex(realIndex)[0];
    await expect(loadSampleBook(s, importText, () => res(false, ''))).rejects.toThrow(/Could not download/);
    await expect(loadSampleBook(s, importText, () => res(true, '<!doctype html><html></html>'))).rejects.toThrow(/not available/);
  });
});
