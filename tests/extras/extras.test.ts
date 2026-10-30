import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const root = new URL('../../', import.meta.url).pathname;
const gz = (name: string) => gunzipSync(readFileSync(root + 'public/data/' + name)).toString('utf8');
const rows = (text: string) => text.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
const han = (s: string) => (s.match(/[㐀-䶿一-鿿豈-﫿\u{20000}-\u{3134f}]/gu) ?? []).length;

describe('chars-extra', () => {
  const unihan = new Map(rows(gz('chars.tsv.gz')).map((r) => [r[0], r]));
  const extra = rows(gz('chars-extra.tsv.gz'));

  it('has attribution and column comments', () => {
    const head = gz('chars-extra.tsv.gz').split('\n').slice(0, 2);
    expect(head[0]).toMatch(/^# Wiktionary via kaikki\.org .*CC BY-SA 4\.0/);
    expect(head[1]).toMatch(/^# char<TAB>/);
  });

  it('is sorted by code point, three columns, definitions within 300 chars', () => {
    expect(extra.length).toBeGreaterThan(3000);
    let prev = -1;
    for (const r of extra) {
      expect(r).toHaveLength(3);
      expect([...r[0]]).toHaveLength(1);
      const cp = r[0].codePointAt(0)!;
      expect(cp).toBeGreaterThan(prev);
      prev = cp;
      expect([...r[2]].length).toBeLessThanOrEqual(300);
      expect(r[1] || r[2]).not.toBe('');
    }
  });

  it('only fills gaps that Unihan leaves open', () => {
    for (const r of extra) {
      const u = unihan.get(r[0])!;
      expect(u).toBeDefined();
      if (r[1]) expect(u[1]).toBe('');
      if (r[2]) expect(u[2]).toBe('');
    }
  });

  it('readings are NFC tone-marked lowercase syllables', () => {
    for (const r of extra.filter((x) => x[1])) {
      for (const s of r[1].split(',')) {
        expect(s).toBe(s.normalize('NFC'));
        expect(s).toMatch(/^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ]+$/);
      }
    }
  });
});

describe('samples', () => {
  const index = JSON.parse(readFileSync(root + 'public/samples/index.json', 'utf8')) as Record<string, string>[];

  it('lists the sample books with every field', () => {
    expect(index.length).toBeGreaterThanOrEqual(5);
    expect(index.length).toBeLessThanOrEqual(24);
    // A real choice at every level: the library shows them as Easy, Intermediate and Advanced.
    for (const level of ['Beginner', 'Intermediate', 'Advanced']) expect(index.filter((b) => b.level === level).length, level).toBeGreaterThanOrEqual(4);
    for (const b of index) {
      for (const k of ['id', 'title', 'author', 'script', 'file', 'level', 'blurb', 'source', 'note']) expect(b[k]).toBeTruthy();
      expect(['simplified', 'traditional']).toContain(b.script);
      expect(['Beginner', 'Intermediate', 'Advanced']).toContain(b.level);
      expect(b.source).toMatch(/^https:\/\/zh\.wikisource\.org\//);
      expect(b.blurb).not.toMatch(/[一-鿿]/);
    }
  });

  it('texts are clean UTF-8, one paragraph per line, no wiki junk', () => {
    for (const b of index) {
      const text = readFileSync(root + 'public/samples/' + b.file, 'utf8');
      expect(han(text)).toBeGreaterThan(150);
      // Wikisource's [编辑] edit links, not the word itself (郁达夫's 编辑先生, "the editor").
      expect(text).not.toMatch(/\{\{|\}\}|\[\[|\]\]|<\/?[a-z]+|&[a-z]+;|\[编辑\]|\[編輯\]|\r|�/);
      const lines = text.split('\n');
      expect(lines[lines.length - 1]).toBe('');
      for (const l of lines.slice(0, -1)) expect(l.trim()).toBe(l);
      expect(lines.slice(0, -1).every((l) => l.length > 0)).toBe(true);
    }
  });

  it('keeps the story endings (complete works)', () => {
    const read = (id: string) => readFileSync(root + `public/samples/${id}.txt`, 'utf8');
    expect(read('kong-yiji')).toContain('孔乙己的确死了');
    expect(read('guxiang')).toContain('走的人多了，也便成了路');
    expect(read('kuangren-riji')).toContain('救救孩子');
    expect(read('xiyouji-1')).toContain('且听下回分解'.replace('听', '聽').replace('分解', '分解'));
  });
});
