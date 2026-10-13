import { describe, expect, it } from 'vitest';
import {
  effectiveLineHeight, FALLBACK_LONGEST, gridMetrics, MIN_CELL_EM, MIN_RT_PX, syllableFits, TARGET_CELL_EM,
} from '../../src/ui/reader/grid';

describe('even pinyin grid width rule', () => {
  // Widest syllable per em, as measured for the usual pinyin fonts (zhuāng, shuāng, chuáng are the longest).
  const longest = [FALLBACK_LONGEST.marks, 3.4, 2.9];

  it('fits the longest syllable inside its cell at every text size', () => {
    for (const l of longest) {
      for (let size = 14; size <= 44; size += 2) {
        const m = gridMetrics(l, size);
        expect(syllableFits(l, m)).toBe(true);
      }
    }
  });
  it('keeps the cell near the target at reading sizes and never below the minimum', () => {
    for (let size = 22; size <= 44; size += 2) {
      const m = gridMetrics(3.1, size);
      expect(m.cellEm).toBeGreaterThanOrEqual(MIN_CELL_EM);
      expect(m.cellEm).toBeLessThanOrEqual(TARGET_CELL_EM + 0.12);
    }
  });
  it('never lets the pinyin get smaller than the legible floor', () => {
    for (let size = 14; size <= 44; size += 1) {
      const m = gridMetrics(3.4, size);
      expect(m.rtEm * size).toBeGreaterThanOrEqual(MIN_RT_PX - 0.01);
    }
  });
  it('widens the cell instead of shrinking the pinyin on small text', () => {
    const small = gridMetrics(3.1, 14);
    const big = gridMetrics(3.1, 30);
    expect(small.cellEm).toBeGreaterThan(big.cellEm);
    expect(small.rtEm * 14).toBeCloseTo(MIN_RT_PX, 1);
  });
  it('puts equal space on both sides of a character', () => {
    const m = gridMetrics(3.1, 22);
    expect(1 + 2 * m.padEm).toBeCloseTo(m.cellEm, 2);
  });
  it('a wider syllable set gives a wider cell or smaller pinyin, never an overflow', () => {
    const narrow = gridMetrics(2.5, 24);
    const wide = gridMetrics(4, 24);
    expect(wide.cellEm >= narrow.cellEm || wide.rtEm <= narrow.rtEm).toBe(true);
    expect(syllableFits(4, wide)).toBe(true);
  });
  it('gives pinyin lines room only when pinyin can show', () => {
    expect(effectiveLineHeight(1.5, 'off')).toBe(1.5);
    expect(effectiveLineHeight(1.5, 'all')).toBe(1.9);
    expect(effectiveLineHeight(2.4, 'unknown')).toBe(2.4);
  });
});
