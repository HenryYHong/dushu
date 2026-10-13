import { describe, expect, it } from 'vitest';
import { anchorGone, computePlacement, type Rect } from '../../src/ui/popup/position';

const rect = (left: number, top: number, w = 40, h = 30): Rect => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
const vp = { w: 1000, h: 800 };

describe('computePlacement', () => {
  it('opens below the anchor when there is room', () => {
    const p = computePlacement(rect(300, 200), 300, vp);
    expect(p).toMatchObject({ mode: 'float', side: 'below', top: 238 });
  });

  it('flips above when the content does not fit below', () => {
    const p = computePlacement(rect(300, 600), 300, vp);
    expect(p).toMatchObject({ mode: 'float', side: 'above' });
    if (p.mode === 'float') expect(p.bottom).toBe(800 - (600 - 8));
  });

  it('clamps horizontally at both edges', () => {
    const left = computePlacement(rect(0, 100), 200, vp);
    const right = computePlacement(rect(980, 100), 200, vp);
    if (left.mode !== 'float' || right.mode !== 'float') throw new Error('expected floats');
    expect(left.left).toBe(8);
    expect(right.left + right.width).toBe(vp.w - 8);
  });

  it('takes the larger side and scrolls inside when neither fits', () => {
    const p = computePlacement(rect(300, 300), 2000, vp);
    if (p.mode !== 'float') throw new Error('expected float');
    expect(p.maxHeight).toBeGreaterThanOrEqual(120);
    expect(p.maxHeight).toBeLessThan(500);
  });

  it('is a bottom sheet under 640 px', () => {
    expect(computePlacement(rect(100, 100), 300, { w: 390, h: 844 }).mode).toBe('sheet');
    expect(computePlacement(rect(100, 100), 300, { w: 640, h: 844 }).mode).toBe('float');
  });

  it('knows when the anchor scrolled away', () => {
    expect(anchorGone(rect(100, -80), vp)).toBe(true);
    expect(anchorGone(rect(100, 900), vp)).toBe(true);
    expect(anchorGone(rect(100, 100), vp)).toBe(false);
  });
});
