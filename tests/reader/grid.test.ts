// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PINYIN_SYLLABLES, formatSyllable } from '../../src/core/pinyin';
import {
  effectiveLineHeight, FALLBACK_LONGEST, FALLBACK_TYPICAL, gridMetrics, indentEm, MAX_CELL_EM, MAX_RT_PX, MIN_CELL_EM, MIN_RT_PX,
  MIN_RT_PX_ZHUYIN, MIN_SQUEEZE, measureSyllables, rtEmFor, squeezeFor, syllableFits, widthOfPinyin,
} from '../../src/ui/reader/grid';

describe('even pinyin grid width rule', () => {
  const typical = FALLBACK_TYPICAL.marks;
  const longest = FALLBACK_LONGEST.marks;

  it('never lets the pinyin get smaller than the legible floor, or bigger than a caption', () => {
    for (let size = 14; size <= 44; size += 1) {
      const px = rtEmFor(size) * size;
      expect(px).toBeGreaterThanOrEqual(MIN_RT_PX - 0.01);
      expect(px).toBeLessThanOrEqual(MAX_RT_PX + 0.01);
      expect(rtEmFor(size, 'zhuyin') * size).toBeGreaterThanOrEqual(MIN_RT_PX_ZHUYIN - 0.01);
    }
  });
  it('is at least 10 px at the sizes an iPad uses', () => {
    for (const size of [20, 22, 24, 26, 28]) expect(gridMetrics(typical, size).rtEm * size).toBeGreaterThanOrEqual(10);
  });
  it('sizes the cell for a typical syllable, between the minimum and the maximum', () => {
    for (let size = 14; size <= 44; size += 2) {
      const m = gridMetrics(typical, size);
      expect(m.cellEm).toBeGreaterThanOrEqual(MIN_CELL_EM);
      expect(m.cellEm).toBeLessThanOrEqual(MAX_CELL_EM);
      // A typical syllable fits with room to spare, no squeeze needed.
      expect(squeezeFor(typical, m)).toBe(1);
    }
  });
  it('is a tighter grid than the old 1.5 em cell at reading sizes', () => {
    for (const size of [20, 22, 24, 26]) expect(gridMetrics(typical, size).cellEm).toBeLessThan(1.4);
  });
  it('widens the cell instead of shrinking the pinyin on small text', () => {
    const small = gridMetrics(typical, 14);
    const big = gridMetrics(typical, 30);
    expect(small.cellEm).toBeGreaterThan(big.cellEm);
    expect(small.rtEm * 14).toBeCloseTo(MIN_RT_PX, 1);
  });
  it('puts equal space on both sides of a character', () => {
    const m = gridMetrics(typical, 22);
    expect(1 + 2 * m.padEm).toBeCloseTo(m.cellEm, 2);
  });
  it('squeezes the long syllables (zhuāng, shuāng, chuáng) so that two neighbors never touch', () => {
    for (let size = 16; size <= 40; size += 2) {
      const m = gridMetrics(typical, size);
      const k = squeezeFor(longest, m);
      expect(k).toBeGreaterThanOrEqual(MIN_SQUEEZE);
      expect(k).toBeLessThanOrEqual(1);
      // Two of the longest side by side: the distance between their centers is one cell.
      const each = longest * m.rtEm * k;
      expect(each).toBeLessThanOrEqual(m.cellEm + 1e-6);
      expect(syllableFits(longest, m)).toBe(true);
    }
  });
  it('leaves zhuyin neighbors more air than pinyin ones, whatever the size', () => {
    for (let size = 16; size <= 40; size += 4) {
      const z = gridMetrics(2.1, size, 'zhuyin');
      const p = gridMetrics(2.1, size, 'marks');
      expect(z.sqEm).toBeGreaterThan(p.sqEm);
      // The widest syllable, squeezed, leaves at least the room in between: at 24 px that is 4.8 px, not 2.9.
      const k = squeezeFor(3.0, z);
      if (k > MIN_SQUEEZE) expect(z.cellEm - 3.0 * z.rtEm * k).toBeGreaterThanOrEqual(z.sqEm - 0.01);
    }
  });
  it('a wider font squeezes more, never past the floor', () => {
    const m = gridMetrics(typical, 22);
    expect(squeezeFor(4, m)).toBeLessThanOrEqual(squeezeFor(3, m));
    expect(squeezeFor(9, m)).toBe(MIN_SQUEEZE);
  });
  it('indents a paragraph exactly two cells, so the first line starts on a column of the grid', () => {
    for (let size = 14; size <= 44; size += 2) {
      for (const t of [typical, 2.8]) {
        const m = gridMetrics(t, size);
        expect(indentEm(m) / m.cellEm).toBeCloseTo(2, 5);
        // A whole number of cells; the stylesheet turns it into text-indent: var(--rd-indent).
        expect(Math.abs(indentEm(m) / m.cellEm - Math.round(indentEm(m) / m.cellEm))).toBeLessThan(1e-6);
      }
    }
  });
  it('gives pinyin lines room only when pinyin can show', () => {
    expect(effectiveLineHeight(1.5, 'off')).toBe(1.5);
    expect(effectiveLineHeight(1.5, 'all')).toBe(1.9);
    expect(effectiveLineHeight(2.4, 'unknown')).toBe(2.4);
  });
});

describe('measuring the pinyin font', () => {
  it('falls back to estimates without a canvas (jsdom) and orders typical below longest', () => {
    for (const style of ['marks', 'numbers', 'zhuyin'] as const) {
      const m = measureSyllables(style, 'sans-serif');
      expect(m.typical).toBeGreaterThan(0.5);
      expect(m.longest).toBeGreaterThanOrEqual(m.typical);
      expect(m.widthOf('zhuāng')).toBeGreaterThan(m.widthOf('wǒ'));
    }
  });
  it('knows the width of any text it is asked about, and remembers it', () => {
    const m = measureSyllables('marks', 'sans-serif');
    expect(m.widthOf('hǎo')).toBe(m.widthOf('hǎo'));
    expect(widthOfPinyin('hǎo')).toBeGreaterThan(0);
  });
  it('covers every syllable the language has', () => {
    expect(PINYIN_SYLLABLES.length).toBeGreaterThan(400);
    const widths = PINYIN_SYLLABLES.map((s) => formatSyllable(`${s}1`, 'marks').length);
    expect(Math.max(...widths)).toBeGreaterThanOrEqual(6);
  });
});

describe('curly quote measuring', () => {
  it('publishes an unmeasurable quote as unset (jsdom has no layout), so the stylesheet falls back to full-width', async () => {
    const { measureQuotes, setQuoteVars, QUOTE_KEYS } = await import('../../src/ui/reader/grid');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const m = measureQuotes(host);
    expect(Object.keys(m).sort()).toEqual(Object.keys(QUOTE_KEYS).sort());
    expect(Object.values(m).every((v) => v === null)).toBe(true);
    host.style.setProperty('--rd-q-ldq', '0.4');
    setQuoteVars(host, 'rd', m);
    expect(host.style.getPropertyValue('--rd-q-ldq')).toBe('');
    setQuoteVars(host, 'rd', { '\u201c': 0.389, '\u201d': 0.411, '\u2018': 0.236, '\u2019': 0.268 });
    expect(host.style.getPropertyValue('--rd-q-ldq')).toBe('0.389');
    expect(host.style.getPropertyValue('--rd-q-rsq')).toBe('0.268');
    expect(host.querySelector('.rd-article')).toBeNull(); // the probe is removed again
  });
});
