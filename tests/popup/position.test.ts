import { describe, expect, it } from 'vitest';
import { BUBBLE_MAX_HEIGHT, computePlacement, PHONE_SHEET_SHARE, type Rect } from '../../src/ui/popup/position';

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
