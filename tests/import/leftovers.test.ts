// What a file's making leaves in the text (import/leftovers.ts): chapters named after their file, named by their text instead,
// and a row of one letter standing for a section break in a Chinese book.
import { describe, expect, it } from 'vitest';
import { isFileName, letterRowBreaks, nameFileNamedChapters } from '../../src/import/leftovers';
import type { Block, Chapter } from '../../src/types';

const p = (text: string): Block => ({ t: 'p', text });
const LONG = '春天来了，河边的柳树发出了新芽，孩子们在田野里奔跑，老人坐在门口晒太阳，说着去年的收成和今年的打算。'.repeat(16);

describe('file names', () => {
  it('knows a converter’s name from a chapter’s', () => {
    for (const t of ['Chapter_1', 'index_split_003', 'part0001', 'Section0002', 'text00012']) expect(isFileName(t)).toBe(true);
    for (const t of ['Chapter 1', 'Chapter1', 'CHAPTER II.', '第一章', 'Part One', 'Interlude']) expect(isFileName(t)).toBe(false);
  });

  it('names such a chapter by its first lines, its heading dropped', () => {
    const chs: Chapter[] = [
      { title: 'Chapter_4', blocks: [{ t: 'h', level: 2, text: 'Chapter_4' }, p('作者年表'), p(LONG)] },
      { title: '第一章', blocks: [p(LONG)] },
    ];
    const out = nameFileNamedChapters(chs);
    expect(out[0]).toEqual({ title: '作者年表', blocks: [p('作者年表'), p(LONG)] });
    expect(out[1]).toBe(chs[1]);
  });
});

describe('a row of letters for a section break', () => {
  it('is a break in a Chinese book when set three times or more', () => {
    const chs: Chapter[] = [{ title: '一', blocks: [p(LONG), p('BBB'), p(LONG), p('BBB'), p(LONG), p('BBB'), p(LONG), p('BBB')] }];
    expect(letterRowBreaks(chs)[0].blocks.map((b) => (b.t === 'hr' ? '—' : b.t)).join('')).toBe('p—p—p—p');
  });

  it('stays text when set only twice, or in a book in letters', () => {
    const twice: Chapter[] = [{ title: '一', blocks: [p(LONG), p('BBB'), p(LONG), p('BBB'), p(LONG)] }];
    expect(letterRowBreaks(twice)).toBe(twice);
    const english: Chapter[] = [{ title: 'One', blocks: [p('Zzz.'), p('ZZZ'), p('He slept.'), p('ZZZ'), p('And slept.'), p('ZZZ')] }];
    expect(letterRowBreaks(english)).toBe(english);
  });
});
