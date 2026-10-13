import { describe, expect, it } from 'vitest';
import { ankiTsv, dueLabel, excerpt, filterAndSort, matchesQuery, pinyinBase, splitContext, vocabCsv } from '../../src/ui/vocab/model';
import { SAMPLE, T0, item } from './helpers';

describe('search', () => {
  it('pinyin base ignores tones, marks and spacing', () => {
    expect(pinyinBase('ni3 hao3')).toBe('ni hao');
    expect(pinyinBase('nǐ hǎo')).toBe('ni hao');
  });
  it('matches by word, either script, pinyin spellings and gloss', () => {
    const lv = SAMPLE[2];
    for (const q of ['绿', '綠', 'lu4', 'lü', 'lv', 'lu se', 'lǜsè', 'lǜ sè', 'green', 'GREEN']) expect(matchesQuery(lv, q), q).toBe(true);
    expect(matchesQuery(lv, 'blue')).toBe(false);
    expect(matchesQuery(SAMPLE[0], 'nihao')).toBe(true);
    expect(matchesQuery(SAMPLE[0], 'ni3 hao3')).toBe(true);
  });
  it('matches the context sentence and book title', () => {
    expect(matchesQuery(SAMPLE[0], '活着')).toBe(true);
    expect(matchesQuery(SAMPLE[0], '他说')).toBe(true);
  });
  it('requires every term', () => {
    expect(matchesQuery(SAMPLE[0], 'hello study')).toBe(false);
    expect(matchesQuery(SAMPLE[0], '  ')).toBe(true);
  });
});

describe('sort', () => {
  const words = (s: ReturnType<typeof filterAndSort>) => s.map((i) => i.simp);
  it('added: newest first', () => expect(words(filterAndSort(SAMPLE, '', 'added'))).toEqual(['爱', '绿色', '学习', '你好']));
  it('due: soonest first, overdue ahead of later', () => {
    expect(words(filterAndSort(SAMPLE, '', 'due')).at(-1)).toBe('绿色');
  });
  it('pinyin: alphabetical ignoring tone', () => expect(words(filterAndSort(SAMPLE, '', 'pinyin'))).toEqual(['爱', '绿色', '你好', '学习']));
  it('does not mutate the input', () => {
    const copy = SAMPLE.slice();
    filterAndSort(SAMPLE, '', 'pinyin');
    expect(SAMPLE).toEqual(copy);
  });
});

describe('due label', () => {
  it('new, due now and later', () => {
    expect(dueLabel(SAMPLE[0], T0)).toEqual({ text: 'New', state: 'new' });
    const reviewed = item('的', 'de5', 'of', { srs: { due: T0 - 1, interval: 2, ease: 2.5, reps: 2, lapses: 0, last: T0 - 86400000 } });
    expect(dueLabel(reviewed, T0)).toEqual({ text: 'Due now', state: 'due' });
    expect(dueLabel(SAMPLE[2], T0)).toEqual({ text: 'Due in 3d', state: 'later' });
  });
});

describe('context', () => {
  it('splits around the first match in either script', () => {
    expect(splitContext('我爱你', ['爱', '愛'])).toEqual({ before: '我', match: '爱', after: '你' });
    expect(splitContext('我愛你', ['爱', '愛'])).toEqual({ before: '我', match: '愛', after: '你' });
    expect(splitContext('我你', ['爱'])).toBeNull();
  });
  it('excerpt keeps short text and trims long text around the word', () => {
    const short = { before: 'a', match: 'b', after: 'c' };
    expect(excerpt(short, 80)).toEqual(short);
    const long = excerpt({ before: '前'.repeat(100), match: '词', after: '后'.repeat(100) }, 20);
    expect([...long.before].length + [...long.after].length).toBeLessThanOrEqual(21 + 2);
    expect(long.before.startsWith('…') && long.after.endsWith('…')).toBe(true);
  });
  it('excerpt gives unused room to the other side and keeps astral characters whole', () => {
    const e = excerpt({ before: '前', match: '词', after: '𠀀'.repeat(50) }, 10);
    expect(e.before).toBe('前');
    expect([...e.after].filter((c) => c === '𠀀')).toHaveLength(8);
  });
});

describe('exports', () => {
  it('anki: header, bold word, bold in sentence, back has pinyin and gloss', () => {
    const lines = ankiTsv([SAMPLE[0]], 'marks').trim().split('\n');
    expect(lines.slice(0, 3)).toEqual(['#separator:tab', '#html:true', '#tags column:3']);
    const [front, back, tag] = lines[3].split('\t');
    expect(front).toContain('<b>你好</b><br>他说：“<b>你好</b>！”');
    expect(back).toBe('nǐ hǎo<br>hello; hi');
    expect(tag).toBe('dushu');
  });
  it('anki: escapes html and quotes tabs', () => {
    const it = item('a', 'a1', 'x<y> "q"\tz');
    const row = ankiTsv([it], 'numbers').trim().split('\n')[3];
    expect(row).toContain('x&lt;y&gt; "');
    expect(row.split('\t').length).toBe(3 + 0 + 0 + 0 + (row.match(/\t/g)!.length - 2));
  });
  it('csv: BOM, header, quoting, and formula guard', () => {
    const csv = vocabCsv([item('x', 'a1', '=cmd, "hi"')], 'numbers');
    expect(csv.startsWith('﻿word,traditional,pinyin,meaning,sentence,book,added,due\r\n')).toBe(true);
    expect(csv).toContain(`"'=cmd, ""hi"""`);
    expect(csv).toContain('2026-10-01');
  });
});
