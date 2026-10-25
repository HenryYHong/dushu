import { describe, expect, it } from 'vitest';
import {
  blockOfPage, chapterFraction, computeGeometry, decideSpread, edgeWidth, estimatePages, firstPageOfSpread, geometryKey, pageAtX, pageCount,
  pageOfBlock, pagesLeftLabel, settleDuration, spreadCount, spreadOfPage, swipeCompletes, tapZone, turnTarget,
  type BlockPages,
} from '../../src/ui/reader/pagination';

describe('spread decision', () => {
  it('shows two pages on a wide landscape screen and one on a phone or a portrait iPad', () => {
    expect(decideSpread('auto', 1194, 834)).toBe(2); // iPad Pro 11 landscape
    expect(decideSpread('auto', 1133, 744)).toBe(2); // iPad mini landscape
    expect(decideSpread('auto', 1440, 900)).toBe(2); // laptop
    expect(decideSpread('auto', 834, 1194)).toBe(1); // iPad portrait
    expect(decideSpread('auto', 390, 844)).toBe(1); // phone
    expect(decideSpread('auto', 844, 390)).toBe(1); // phone landscape: too narrow for two pages
    expect(decideSpread('auto', 1000, 1000)).toBe(1); // a square window is not "landscape"
  });
  it('honors the forced settings whatever the size', () => {
    expect(decideSpread('single', 2000, 800)).toBe(1);
    expect(decideSpread('double', 500, 900)).toBe(2);
  });
});

describe('page geometry', () => {
  const base = { spread: 'auto' as const, pageWidth: 760 };
  it('keeps the page stride equal to the paper width, so a column turn is a whole sheet', () => {
    for (const [w, h] of [[1440, 900], [1194, 834], [834, 1194], [390, 844], [1920, 1080]]) {
      const g = computeGeometry({ ...base, width: w, height: h });
      expect(g.paperW).toBeCloseTo(w / g.per, 5);
      expect(g.cw + g.gap).toBeCloseTo(g.paperW, 5);
      expect(g.margin * 2 + g.cw).toBeCloseTo(g.paperW, 5);
    }
  });
  it('never makes a column wider than the page width setting, and centers it on its sheet', () => {
    const g = computeGeometry({ width: 1800, height: 900, spread: 'single', pageWidth: 640 });
    expect(g.cw).toBe(640);
    expect(g.margin).toBe((1800 - 640) / 2);
  });
  it('leaves a generous margin on a phone', () => {
    const g = computeGeometry({ width: 390, height: 844, spread: 'auto', pageWidth: 760 });
    expect(g.per).toBe(1);
    expect(g.margin).toBeGreaterThanOrEqual(22);
    expect(g.cw).toBeLessThanOrEqual(390 - 2 * 22);
  });
  it('makes the column a whole number of cells wide and keeps it centered, so a line ends where the column does', () => {
    for (const [w, h, cell] of [[390, 844, 27.5], [834, 1194, 27.5], [1194, 834, 27.5], [390, 844, 33], [1440, 900, 30.5]]) {
      const g = computeGeometry({ ...base, width: w, height: h, cellPx: cell });
      expect(g.cw / cell).toBeCloseTo(Math.round(g.cw / cell), 5);
      expect(g.margin * 2 + g.cw).toBeCloseTo(g.paperW, 5);
      // No more than one cell is given up to the snapping.
      const loose = computeGeometry({ ...base, width: w, height: h });
      expect(loose.cw - g.cw).toBeLessThan(cell + 1);
      expect(g.cw).toBeLessThanOrEqual(loose.cw);
    }
  });
  it('fits 10 or more cells on a phone at the default size', () => {
    const g = computeGeometry({ ...base, width: 390, height: 844, cellPx: 22 * 1.25 });
    expect(g.cw / (22 * 1.25)).toBeGreaterThanOrEqual(10);
    // Margins left and right are the same.
    expect(g.margin).toBeCloseTo((390 - g.cw) / 2, 5);
  });
  it('makes the text block a whole number of lines and centers it between header and footer', () => {
    const plain = computeGeometry({ ...base, width: 1440, height: 900 });
    const snapped = computeGeometry({ ...base, width: 1440, height: 900, linePitch: 50.4 });
    expect(snapped.textH % 50.4).toBeLessThan(1);
    expect(snapped.textH).toBeLessThanOrEqual(plain.textH);
    expect(snapped.textTop).toBeGreaterThanOrEqual(plain.textTop);
    expect(snapped.textTop + snapped.textH).toBeLessThanOrEqual(plain.textTop + plain.textH + 1);
  });
  it('keeps the text out of the notch and the home indicator', () => {
    const a = computeGeometry({ ...base, width: 834, height: 1194 });
    const b = computeGeometry({ ...base, width: 834, height: 1194, safeTop: 24, safeBottom: 20 });
    expect(b.textTop).toBe(a.textTop + 24);
    expect(b.headerTop).toBe(a.headerTop + 24);
    expect(b.footerBottom).toBe(a.footerBottom + 20);
  });
  it('changes the layout key when anything that moves the text breaks changes', () => {
    const g = computeGeometry({ ...base, width: 1440, height: 900 });
    const g2 = computeGeometry({ ...base, width: 1440, height: 800 });
    expect(geometryKey(g, 'a')).not.toBe(geometryKey(g2, 'a'));
    expect(geometryKey(g, 'a')).not.toBe(geometryKey(g, 'b'));
    expect(geometryKey(g, 'a')).toBe(geometryKey({ ...g }, 'a'));
  });
});

describe('blocks and pages', () => {
  // Five blocks over four pages; block 1 runs from page 0 across page 1; block 3 covers pages 2 and 3.
  const blocks: BlockPages[] = [{ first: 0, last: 0 }, { first: 0, last: 1 }, { first: 1, last: 1 }, { first: 2, last: 3 }, { first: 3, last: 3 }];
  it('finds the column of an x position', () => {
    expect(pageAtX(0, 720)).toBe(0);
    expect(pageAtX(719, 720)).toBe(1); // a hair before the next column still counts as it (2 px tolerance)
    expect(pageAtX(718, 720)).toBe(1);
    expect(pageAtX(717, 720)).toBe(0);
    expect(pageAtX(1440, 720)).toBe(2);
    expect(pageAtX(-5, 720)).toBe(0);
    expect(pageAtX(10, 0)).toBe(0);
  });
  it('page of block is the page the block starts on', () => {
    expect(blocks.map((_, i) => pageOfBlock(blocks, i))).toEqual([0, 0, 1, 2, 3]);
    expect(pageOfBlock(blocks, 99)).toBe(3);
    expect(pageOfBlock([], 0)).toBe(0);
  });
  it('block of page is the first block that has anything on the page, even one that began earlier', () => {
    expect(blockOfPage(blocks, 0)).toBe(0);
    expect(blockOfPage(blocks, 1)).toBe(1); // block 1 continues onto page 1
    expect(blockOfPage(blocks, 2)).toBe(3);
    expect(blockOfPage(blocks, 3)).toBe(3); // block 3 continues onto page 3
    expect(blockOfPage([], 0)).toBe(0);
  });
  it('round trips: the page of the block of a page is that page or the one the block started on', () => {
    for (let p = 0; p < 4; p++) expect(pageOfBlock(blocks, blockOfPage(blocks, p))).toBeLessThanOrEqual(p);
    for (let b = 0; b < blocks.length; b++) expect(blockOfPage(blocks, pageOfBlock(blocks, b))).toBeLessThanOrEqual(b);
  });
  it('counts pages, spreads and the pages left', () => {
    expect(pageCount(blocks)).toBe(4);
    expect(pageCount([])).toBe(1);
    expect(spreadCount(5, 2)).toBe(3);
    expect(spreadCount(4, 2)).toBe(2);
    expect(spreadCount(5, 1)).toBe(5);
    expect(spreadOfPage(0, 2)).toBe(0);
    expect(spreadOfPage(3, 2)).toBe(1);
    expect(spreadOfPage(3, 1)).toBe(3);
    expect(firstPageOfSpread(2, 2)).toBe(4);
    expect(pagesLeftLabel(0, 10)).toBe('9 pages left in chapter');
    expect(pagesLeftLabel(8, 10)).toBe('1 page left in chapter');
    expect(pagesLeftLabel(9, 10)).toBe('Last page of chapter');
    // While the chapter is still being paginated the count is only an estimate, and says so.
    expect(pagesLeftLabel(0, 10, true)).toBe('About 9 pages left in chapter');
    expect(pagesLeftLabel(9, 10, true)).toBe('About 1 page left in chapter');
    expect(estimatePages(10, 1000, 4000)).toBe(40);
    expect(estimatePages(10, 0, 4000)).toBe(10);
    expect(estimatePages(10, 4000, 4000)).toBe(10);
    expect(estimatePages(3, 100, 110)).toBeGreaterThan(3);
    expect(chapterFraction(0, 10)).toBe(0);
    expect(chapterFraction(9, 10)).toBe(1);
    expect(chapterFraction(0, 1)).toBe(0);
  });
});

describe('turning', () => {
  const count = (c: number) => ({ 0: 3, 1: 2, 2: 4 } as Record<number, number>)[c] ?? null;
  it('goes on inside a chapter and over its edges', () => {
    expect(turnTarget(1, { chapter: 0, spread: 0 }, 3, count)).toEqual({ chapter: 0, spread: 1 });
    expect(turnTarget(1, { chapter: 0, spread: 2 }, 3, count)).toEqual({ chapter: 1, spread: 0 });
    expect(turnTarget(-1, { chapter: 1, spread: 0 }, 3, count)).toEqual({ chapter: 0, spread: 'last' });
    expect(turnTarget(-1, { chapter: 1, spread: 1 }, 3, count)).toEqual({ chapter: 1, spread: 0 });
  });
  it('stops at the ends of the book', () => {
    expect(turnTarget(-1, { chapter: 0, spread: 0 }, 3, count)).toBeNull();
    expect(turnTarget(1, { chapter: 2, spread: 3 }, 3, count)).toBeNull();
  });
  it('treats a chapter whose length is not known yet as having a next spread', () => {
    expect(turnTarget(1, { chapter: 5, spread: 7 }, 9, count)).toEqual({ chapter: 5, spread: 8 });
  });
  it('turns the page on a tap off the words almost anywhere: two fifths each side, the bar down the middle', () => {
    expect(edgeWidth(900)).toBe(360);
    expect(tapZone(100, 900)).toBe('prev');
    expect(tapZone(359, 900)).toBe('prev');
    expect(tapZone(450, 900)).toBe('middle');
    expect(tapZone(541, 900)).toBe('next');
    expect(tapZone(800, 900)).toBe('next');
    // iPad Pro 11 in landscape, 1194 wide: the whole of each page but a band around the fold.
    const w = 1194;
    for (const x of [60, 250, 470]) expect(tapZone(x, w)).toBe('prev');
    for (const x of [500, 597, 700]) expect(tapZone(x, w)).toBe('middle');
    for (const x of [720, 1010, 1114]) expect(tapZone(x, w)).toBe('next');
    // A phone: the same shares.
    expect(tapZone(40, 390)).toBe('prev');
    expect(tapZone(195, 390)).toBe('middle');
    expect(tapZone(350, 390)).toBe('next');
  });
  it('lets a short flick finish a turn, and only a tiny drag or a pull back fall back', () => {
    expect(swipeCompletes(0.1, 0.003)).toBe(true);
    // A gentle flick, about 350 px a second on an iPad page, is enough.
    expect(swipeCompletes(0.05, 0.0007)).toBe(true);
    expect(swipeCompletes(0.9, -0.003)).toBe(false);
    expect(swipeCompletes(0.5, 0)).toBe(true);
    expect(swipeCompletes(0.2, 0)).toBe(true);
    expect(swipeCompletes(0.1, 0)).toBe(false);
  });
  it('settles faster after a flick and never outside 160 to 520 ms', () => {
    expect(settleDuration(0, 0)).toBe(0);
    expect(settleDuration(1, 0)).toBe(520);
    expect(settleDuration(0.1, 0)).toBeLessThan(settleDuration(1, 0));
    expect(settleDuration(0.5, 0.01)).toBeGreaterThanOrEqual(160);
    expect(settleDuration(0.5, 0.01)).toBeLessThan(settleDuration(0.5, 0.0008));
    expect(settleDuration(1, 0.00001)).toBe(520);
  });
});
