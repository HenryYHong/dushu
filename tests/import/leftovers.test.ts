// What a file's making leaves in the text (import/leftovers.ts): chapters named after their file, named by their text instead,
// a row of one letter standing for a section break in a Chinese book, section numbers left plain lines, and back matter run on
// into the last story.
import { describe, expect, it } from 'vitest';
import { backMatter, isFileName, letterRowBreaks, nameFileNamedChapters, numeralValue, sectionNumbers } from '../../src/import/leftovers';
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
    expect(out[0]).toEqual({ title: '作者年表', blocks: [{ t: 'h', level: 1, text: '作者年表' }, p(LONG)] });
    expect(out[1]).toBe(chs[1]);
  });

  it('keeps a title made of several first lines as text', () => {
    const out = nameFileNamedChapters([{ title: 'Chapter_2', blocks: [p('小路'), p('春天'), p(LONG)] }]);
    expect(out[0].title).toBe('小路 春天');
    expect(out[0].blocks[0]).toEqual(p('小路'));
  });
});

describe('section numbers', () => {
  it('reads Chinese numerals', () => {
    expect([...'一二九'].map(numeralValue)).toEqual([1, 2, 9]);
    expect(['十', '十二', '二十', '二十三', '九十九'].map(numeralValue)).toEqual([10, 12, 20, 23, 99]);
    expect(['', '十十', '一十二', '二二', '百'].map(numeralValue)).toEqual([0, 0, 0, 0, 0]);
  });

  it('makes 一 二 三 on lines of their own, in order with text between, small headings', () => {
    const chs: Chapter[] = [{ title: '河边', blocks: [{ t: 'h', level: 1, text: '河边' }, p('一'), p(LONG), p('二、'), p(LONG), p('（三）'), p(LONG)] }];
    const out = sectionNumbers(chs);
    expect(out[0].blocks.map((b) => (b.t === 'h' ? `h${b.level}:${b.text}` : b.t))).toEqual(['h1:河边', 'h4:一', 'p', 'h4:二、', 'p', 'h4:（三）', 'p']);
  });

  it('leaves numbers that are not a count of sections', () => {
    const one: Chapter = { title: '河边', blocks: [p('一'), p(LONG)] };
    const skips: Chapter = { title: '河边', blocks: [p('一'), p(LONG), p('三'), p(LONG)] };
    const stray: Chapter = { title: '河边', blocks: [p('一'), p(LONG), p('二'), p(LONG), p('五'), p(LONG)] };
    const list: Chapter = { title: '河边', blocks: [p(LONG), p('一'), p('二'), p('三')] };
    const chs = [one, skips, stray, list];
    expect(sectionNumbers(chs)).toBe(chs);
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

describe('back matter run on into the last story', () => {
  const story = [p(LONG), p(LONG), p(LONG), p(LONG), p(LONG)];
  it('is a chapter of its own under its title', () => {
    const chs: Chapter[] = [{ title: '河边', blocks: [p(LONG)] }, { title: '春天', blocks: [...story, p('作者生平大事记'), p('⊙1920年生于河边小镇。'), p('⊙1950年写成第一本书。')] }];
    const out = backMatter(chs);
    expect(out.map((c) => c.title)).toEqual(['河边', '春天', '作者生平大事记']);
    expect(out[1].blocks).toEqual(story);
    expect(out[2].blocks).toEqual([{ t: 'h', level: 1, text: '作者生平大事记' }, p('⊙1920年生于河边小镇。'), p('⊙1950年写成第一本书。')]);
  });
  it('is left where the line is no such title, opens the chapter, or has nothing after it', () => {
    const plain: Chapter[] = [{ title: '春天', blocks: [...story, p('他写了一篇后记，'), p(LONG), p(LONG)] }];
    const opens: Chapter[] = [{ title: '后记', blocks: [p('后记'), ...story] }];
    const bare: Chapter[] = [{ title: '春天', blocks: [...story, p('后记'), p(LONG)] }];
    for (const chs of [plain, opens, bare]) expect(backMatter(chs)).toBe(chs);
  });
});
