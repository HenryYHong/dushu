// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { anchorOf, BUBBLE_MAX_HEIGHT, computePlacement, PHONE_SHEET_SHARE, type Rect } from '../../src/ui/popup/position';

const rect = (left: number, top: number, w = 40, h = 30): Rect => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });

describe('phone sheet', () => {
  it('is capped at 45% of the screen, whatever the content height, so the tapped word stays in view', () => {
    const p = computePlacement(rect(100, 300), 2000, { w: 390, h: 844 });
    expect(p).toMatchObject({ mode: 'sheet', variant: 'phone' });
    if (p.mode !== 'sheet') throw new Error('sheet');
    expect(p.maxHeight).toBe(Math.round(844 * PHONE_SHEET_SHARE));
    expect(PHONE_SHEET_SHARE).toBeLessThanOrEqual(0.45);
  });
});

describe('tablet', () => {
  const ipadLandscape = { w: 1194, h: 834 };
  const ipadPortrait = { w: 820, h: 1180 };
  it('is a bubble at the word, never a sheet, even where the page could move (the page stays put)', () => {
    for (const vp of [ipadLandscape, ipadPortrait, { w: 1366, h: 1024 }]) {
      const p = computePlacement(rect(300, 300), 1500, vp, { coarse: true, canShift: true });
      if (p.mode !== 'float') throw new Error(`float at ${vp.w}x${vp.h}`);
      expect(p.caret).not.toBeNull();
      expect(p.left + (p.caret ?? 0)).toBeCloseTo(320, -1); // the caret points at the middle of the 40 px word
    }
  });
  it('is a small bubble: capped in height and width, the rest scrolls inside', () => {
    const p = computePlacement(rect(300, 200), 1500, { w: 1194, h: 834 }, { coarse: true, canShift: true });
    if (p.mode !== 'float') throw new Error('float');
    expect(p.maxHeight).toBe(BUBBLE_MAX_HEIGHT);
    expect(p.width).toBeLessThanOrEqual(360);
  });
  it('stays at the word on either page of a spread', () => {
    for (const x of [200, 900]) {
      const p = computePlacement(rect(x, 300), 400, ipadLandscape, { coarse: true, canShift: true });
      if (p.mode !== 'float') throw new Error('float');
      expect(p.left).toBeLessThanOrEqual(x + 20);
      expect(p.left + p.width).toBeGreaterThanOrEqual(x + 20);
    }
  });
  it('opens above a word near the bottom of the page', () => {
    const p = computePlacement(rect(500, 760), 400, ipadLandscape, { coarse: true, canShift: true });
    if (p.mode !== 'float') throw new Error('float');
    expect(p.side).toBe('above');
  });
  it('a mouse keeps the card under the word with a caret at its middle', () => {
    const p = computePlacement(rect(500, 300, 40, 30), 300, ipadLandscape);
    if (p.mode !== 'float') throw new Error('float');
    expect(p.caret).not.toBeNull();
    expect(p.left + (p.caret ?? 0)).toBeCloseTo(520, -1); // under the middle of the 40 px word
  });
});

describe('safe area', () => {
  it('keeps a floating card out of the notch and the home indicator', () => {
    const p = computePlacement(rect(2, 10), 300, { w: 800, h: 600 }, { insets: { left: 44, right: 44, top: 24, bottom: 34 } });
    if (p.mode !== 'float') throw new Error('float');
    expect(p.left).toBeGreaterThanOrEqual(8 + 44);
    expect(p.left + p.width).toBeLessThanOrEqual(800 - 8 - 44);
    expect(p.top).toBeGreaterThanOrEqual(8 + 24);
    const q = computePlacement(rect(300, 560), 300, { w: 800, h: 600 }, { insets: { bottom: 34 } });
    if (q.mode !== 'float') throw new Error('float');
    // below has no room: the card goes above, and when below it would be capped above the home indicator
    expect(q.side).toBe('above');
  });
  it('keeps a tablet bubble inside the safe area', () => {
    const p = computePlacement(rect(10, 100), 300, { w: 700, h: 900 }, { coarse: true, canShift: true, insets: { left: 30, right: 30 } });
    if (p.mode !== 'float') throw new Error('float');
    expect(p.left).toBeGreaterThanOrEqual(8 + 30);
    expect(p.left + p.width).toBeLessThanOrEqual(700 - 8 - 30);
  });
});

describe('what a popup points at', () => {
  // A two-page spread on an iPad held sideways: each character 28 px wide, lines 40 px apart.
  const vp = { w: 1180, h: 820 };
  const ch = (left: number, top: number) => rect(left, top, 28, 40);

  it('is the word’s own box when it sits on one line, or on two lines of one page', () => {
    expect(anchorOf([ch(100, 300), ch(128, 300)], vp)).toMatchObject({ left: 100, top: 300, right: 156, bottom: 340 });
    // Wrapped from the end of a line to the start of the next, on the same page.
    expect(anchorOf([ch(500, 300), ch(60, 340)], vp)).toMatchObject({ top: 300, bottom: 380 });
  });

  it('is the larger part of a word or sentence that runs on from the foot of the left page to the top of the right one', () => {
    // 两 characters on the last line of the left page, three at the top of the right page.
    const word = [ch(480, 740), ch(508, 740), ch(620, 60), ch(648, 60), ch(676, 60)];
    const a = anchorOf(word, vp)!;
    expect(a).toMatchObject({ left: 620, top: 60, bottom: 100 });
    // Not a box as tall as the spread, so the bubble goes beside it, not at the top of the screen.
    const p = computePlacement(a, 300, vp, { coarse: true });
    expect(p).toMatchObject({ mode: 'float', side: 'below' });
    if (p.mode === 'float') expect(p.top).toBeGreaterThan(100);
    // A tie goes to the first part.
    expect(anchorOf([ch(480, 740), ch(620, 60)], vp)).toMatchObject({ left: 480, top: 740 });
  });

  it('leaves out a part on a page that is not on screen', () => {
    // Two characters on this page, three on the next page, drawn off to the right.
    expect(anchorOf([ch(480, 740), ch(508, 740), ch(1300, 60), ch(1328, 60), ch(1356, 60)], vp)).toMatchObject({ left: 480, top: 740 });
    expect(anchorOf([], vp)).toBeNull();
    expect(anchorOf([rect(0, 0, 0, 0)], vp)).toBeNull();
  });
});
