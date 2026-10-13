import { describe, expect, it } from 'vitest';
import { computePlacement, LANDSCAPE_SHEET_SHARE, PHONE_SHEET_SHARE, SHORT_SHEET, TABLET_SHEET_SHARE, type Rect } from '../../src/ui/popup/position';

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
  it('is a full-width sheet up to 60% in portrait when the page can move out of its way', () => {
    const p = computePlacement(rect(300, 300), 1500, { w: 834, h: 1194 }, { coarse: true, canShift: true });
    if (p.mode !== 'sheet') throw new Error('sheet');
    expect(p.variant).toBe('tablet');
    expect(p.maxHeight).toBe(Math.round(1194 * TABLET_SHEET_SHARE));
    // The sheet spans the screen, so no half-cut text of the page shows beside it.
    expect(p.left).toBe(0);
    expect(p.width).toBe(834);
  });
  it('is capped at 44% in landscape, so the lower half of the page is never under it', () => {
    for (const vp of [{ w: 1194, h: 834 }, { w: 1133, h: 744 }, { w: 1366, h: 1024 }]) {
      const p = computePlacement(rect(300, 300), 1500, vp, { coarse: true, canShift: true });
      if (p.mode !== 'sheet') throw new Error('sheet');
      expect(p.maxHeight).toBe(Math.round(vp.h * LANDSCAPE_SHEET_SHARE));
      expect(p.maxHeight).toBeLessThan(vp.h * 0.45);
      expect(p.left).toBe(0);
      expect(p.width).toBe(vp.w);
      if (vp.h < 900) expect(p.maxHeight).toBeLessThan(SHORT_SHEET); // iPad Pro 11 and Mini: short, so the stepping bar scrolls
    }
  });
  it('keeps room for the header and a meaning on a phone held sideways', () => {
    const p = computePlacement(rect(300, 100), 1500, { w: 844, h: 390 }, { coarse: true, canShift: true });
    if (p.mode !== 'sheet') throw new Error('sheet');
    expect(p.maxHeight).toBeGreaterThanOrEqual(230);
    expect(p.maxHeight).toBeLessThanOrEqual(Math.round(390 * TABLET_SHEET_SHARE));
  });
  it('floats when the page cannot move, and aims at the other page of a spread', () => {
    const left = computePlacement(rect(200, 300), 400, ipadLandscape, { coarse: true });
    const right = computePlacement(rect(900, 300), 400, ipadLandscape, { coarse: true });
    if (left.mode !== 'float' || right.mode !== 'float') throw new Error('float');
    expect(left.left).toBeGreaterThan(1194 / 2); // a word on the left page: the card is over the right page
    expect(right.left + right.width).toBeLessThan(1194 / 2 + 1); // and the other way round
    expect(left.caret).toBeNull(); // the card is not under the word, so no caret points at nothing
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
  it('a tablet sheet spans the screen; its content keeps off the rounded corners (popup.css padding)', () => {
    const p = computePlacement(rect(100, 100), 300, { w: 700, h: 900 }, { coarse: true, canShift: true, insets: { left: 30, right: 30 } });
    if (p.mode !== 'sheet') throw new Error('sheet');
    expect(p.left).toBe(0);
    expect(p.width).toBe(700);
  });
});
