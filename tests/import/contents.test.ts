// A contents list in plain lines inside a chapter (a 目录 line and its entries, page numbers and dot leaders after each title)
// makes the 目录 line a heading, and the later paragraphs that are exactly its titles the headings of their stories, each story
// a chapter of its own. Nothing changes without such a list, or when fewer than three titles are found again.
import { describe, expect, it } from 'vitest';
import { entryTitle, markContents } from '../../src/import/contents';
import type { Block, Chapter } from '../../src/types';

const p = (text: string): Block => ({ t: 'p', text });
const kinds = (chs: Chapter[]) => chs.map((c) => c.blocks.map((b) => b.t).join(''));
const LONG = '春天来了，河边的柳树发出了新芽，孩子们在田野里奔跑，老人坐在门口晒太阳，说着去年的收成和今年的打算。';

describe('entryTitle', () => {
  it('takes off page numbers in any digits and the dot leaders', () => {
    expect(entryTitle('河边的人家⒈⒍……………………')).toBe('河边的人家');
    expect(entryTitle('一个春天  ……  26')).toBe('一个春天');
    expect(entryTitle('序（代序）１２')).toBe('序（代序）');
  });
});

describe('markContents', () => {
  it('makes the contents line and each story title found later a heading, and each a chapter', () => {
    const chs: Chapter[] = [{ title: '一', blocks: [p('写在前面的话，给读者。'), p('目录'), p('小路⒈……'), p('河边⒐……'), p('春天⒉⒍……'), p('小路'), p(LONG), p('河边'), p(LONG)] },
      { title: '二', blocks: [p('春天'), p(LONG)] }];
    const out = markContents(chs);
    expect(kinds(out)).toEqual(['p', 'hppp', 'hp', 'hp', 'hp']);
    // A chapter that opens on its story keeps its own name.
    expect(out.map((c) => c.title)).toEqual(['一', '目录', '小路', '河边', '二']);
  });

  it('finds a title printed spaced out', () => {
    const chs: Chapter[] = [{ title: '一', blocks: [p('目录'), p('小路⒈'), p('河边⒐'), p('春天⒉⒍'), p('小　路'), p(LONG), p('河边'), p(LONG), p(' 春 天 '), p(LONG)] }];
    expect(markContents(chs).map((c) => c.title)).toEqual(['一', '小　路', '河边', '春 天']);
  });

  it('runs a file cut by size on from the story before, the sentence it cut made whole', () => {
    const chs: Chapter[] = [
      { title: 'Chapter_1', blocks: [{ t: 'h', level: 2, text: 'Chapter_1' }, p('目录'), p('小路⒈'), p('河边⒐'), p('春天⒉⒍'), p('小路'), p(LONG), p('河边'), p('孩子们在田野里奔跑，')] },
      { title: 'Chapter_2', blocks: [{ t: 'h', level: 2, text: 'Chapter_2' }, p('老人坐在门'), p('口晒太阳。'), p(LONG), p('春天'), p(LONG)] },
    ];
    const out = markContents(chs);
    expect(out.map((c) => c.title)).toEqual(['Chapter_1', '小路', '河边', '春天']);
    expect(out[2].blocks).toEqual([{ t: 'h', level: 2, text: '河边' }, p('孩子们在田野里奔跑，老人坐在门口晒太阳。'), p(LONG)]);
  });

  it('drops a converter’s label set over the book’s own', () => {
    const chs: Chapter[] = [{ title: '九', blocks: [p(LONG), p('Table of Contents'), p('目录'), p('第一章 小路'), p('第二章 河边'), p('第三章 春天')] }];
    expect(kinds(markContents(chs))).toEqual(['p', 'hppp']);
  });

  it('leaves a book alone with no contents list, or with too few titles found again', () => {
    const none: Chapter[] = [{ title: '一', blocks: [p('小路'), p(LONG), p('河边'), p(LONG)] }];
    expect(markContents(none)).toBe(none);
    const few: Chapter[] = [{ title: '一', blocks: [p('目录'), p('小路⒈'), p('河边⒐'), p('春天⒉⒍'), p(LONG), p('小路'), p(LONG)] }];
    // The list starts its own page; one title found again is not enough to make the others headings.
    expect(kinds(markContents(few))).toEqual(['hpppppp']);
  });

  it('never makes a heading of a contents label that has no list after it', () => {
    const lone: Chapter[] = [{ title: '一', blocks: [p('目录'), p(LONG), p(LONG)] }];
    expect(kinds(markContents(lone))).toEqual(['ppp']);
  });
});
