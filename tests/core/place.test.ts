// A reading place carried across a new import of the same book (src/core/place.ts).
import { describe, expect, it } from 'vitest';
import { hanBefore, placeAt, textHan } from '../../src/core/place';
import type { Chapter } from '../../src/types';

const p = (text: string) => ({ t: 'p' as const, text });
// The same text, cut two ways: three chapters before, one paragraph joined and one chapter merged after.
const before: Chapter[] = [
  { title: '一', blocks: [p('天下大势，分久必合。'), p('合久必分。')] },
  { title: '二 (1)', blocks: [p('周末七国分争，并入于秦。')] },
  { title: '二 (2)', blocks: [p('及秦灭之后，楚、汉分争，'), p('又并入于汉。')] },
];
const after: Chapter[] = [
  { title: '一', blocks: [p('天下大势，分久必合。'), p('合久必分。')] },
  { title: '二', blocks: [p('周末七国分争，并入于秦。'), p('及秦灭之后，楚、汉分争，又并入于汉。')] },
];

describe('reading places across a new import', () => {
  it('counts Han characters only, titles left out', () => {
    expect(textHan(before[0])).toBe(12);
    expect(hanBefore(before[0], 1)).toBe(8);
    expect(hanBefore(before[0], 1, 2)).toBe(10);
  });

  it('finds the same character in chapters cut differently', () => {
    // 合久 in the first chapter: unchanged.
    expect(placeAt(after, hanBefore(before[0], 1))).toEqual({ chapter: 0, block: 1, offset: 0 });
    // The start of the old second part is the start of the second paragraph of the merged chapter.
    const pos = textHan(before[0]) + textHan(before[1]);
    expect(placeAt(after, pos)).toEqual({ chapter: 1, block: 1, offset: 0 });
    // 又 began a paragraph of its own; now it is inside the joined one, after 及秦灭之后，楚、汉分争，(12 UTF-16 units).
    const you = pos + hanBefore(before[2], 1);
    expect(placeAt(after, you)).toEqual({ chapter: 1, block: 1, offset: 12 });
    expect(after[1].blocks[1].t === 'p' && after[1].blocks[1].text.slice(12, 13)).toBe('又');
  });

  it('lands on the last block when the place runs past the end', () => {
    expect(placeAt(after, 999)).toEqual({ chapter: 1, block: 1, offset: 0 });
    expect(placeAt([], 5)).toEqual({ chapter: 0, block: 0, offset: 0 });
  });
});
