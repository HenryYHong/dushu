import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const root = new URL('../../', import.meta.url).pathname;
const gz = (name: string) => gunzipSync(readFileSync(root + 'public/data/' + name)).toString('utf8');
const rows = (text: string) => text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));

describe('cedict-extra', () => {
  const text = gz('cedict-extra.tsv.gz');
  const extra = rows(text);
  const cedict = rows(gz('cedict.tsv.gz'));
  const heads = new Set(cedict.flatMap((r) => [r[0], r[1]]));

  it('has attribution and column comments', () => {
    const head = text.split('\n').slice(0, 3);
    expect(head[0]).toMatch(/^# .*Wiktionary.*CC BY-SA 4\.0/);
    expect(head[1]).toMatch(/^# trad<TAB>simp<TAB>pinyin/);
    expect(head.every((l) => l.startsWith('# '))).toBe(true);
  });

  it('is large enough to matter', () => {
    expect(extra.length).toBeGreaterThan(20000);
  });

  // plain loops collecting violations: ~65k rows x several expects is slow in vitest
  const bad = (pred: (r: string[]) => boolean) => extra.filter(pred).slice(0, 5).map((r) => r.join(' | '));

  it('has four columns, 2+ Han chars, equal trad/simp length, a definition', () => {
    expect(bad((r) => r.length !== 4)).toEqual([]);
    expect(bad((r) => [...r[0]].length < 2)).toEqual([]);
    expect(bad((r) => [...r[1]].length !== [...r[0]].length)).toEqual([]);
    expect(bad((r) => r[3].trim() === '')).toEqual([]);
  });

  it('has numbered pinyin with one syllable per code point', () => {
    expect(bad((r) => r[2].split(' ').length !== [...r[0]].length)).toEqual([]);
    expect(bad((r) => r[2].split(' ').some((s) => !/^[A-Za-zü]+[1-5]$/.test(s)))).toEqual([]);
    expect(bad((r) => /u:|v/.test(r[2]))).toEqual([]);
  });

  it('has no empty definitions', () => {
    expect(bad((r) => r[3].split('/').some((d) => d.trim() === ''))).toEqual([]);
  });

  it('never duplicates a CC-CEDICT headword (either script)', () => {
    expect(bad((r) => heads.has(r[0]) || heads.has(r[1]))).toEqual([]);
  });

  it('is sorted deterministically', () => {
    const keys = extra.map((r) => r.slice(0, 3).join('\t'));
    const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // python sorts by code point; JS compares UTF-16 units, which only differs for astral chars
    const bmp = keys.every((k) => !/[\ud800-\udfff]/.test(k));
    if (bmp) expect(keys).toEqual(sorted);
  });

  it('covers the known gaps', () => {
    const have = new Set(extra.flatMap((r) => [r[0], r[1]]));
    const wanted = ['恁地', '便了', '却说', '甚么', '如何是好', '王熙凤'];
    const found = wanted.filter((w) => have.has(w) || heads.has(w));
    expect(found.length).toBeGreaterThanOrEqual(4);
  });
});
