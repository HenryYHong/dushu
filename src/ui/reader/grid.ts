// The even pinyin grid (ARCHITECTURE.md 5.7). With pinyin on, every Han character gets a cell of the same width and
// the pinyin is centered over its character without pushing neighbors apart. The cell is sized from the longest
// syllables (zhuāng, shuāng, chuáng) at the pinyin size, so none of them ever overflows.
import { formatSyllable } from '../../core/pinyin';
import type { PinyinStyle } from '../../types';

export interface GridMetrics {
  /** Width of one character cell, in em of the reading font size. */
  cellEm: number;
  /** Pinyin font size, in em of the reading font size. */
  rtEm: number;
  /** Space on each side of a character inside its cell, in em. */
  padEm: number;
}

/** Smallest pinyin the grid will use, in px. Below this it stops being readable on a screen. */
export const MIN_RT_PX = 9.5;
/** Preferred pinyin size, as a share of the character size. */
export const BASE_RT_EM = 0.46;
/** The cell the grid aims for, in em. The pinyin shrinks (down to MIN_RT_PX) to make the longest syllable fit it. */
export const TARGET_CELL_EM = 1.5;
/** A cell is never narrower than this, even for short pinyin. */
export const MIN_CELL_EM = 1.3;
/** Breathing room kept on each side of the longest syllable, in em of the reading font. */
const SYLLABLE_PAD_EM = 0.045;

/**
 * Cell and pinyin size for a reading size.
 * `longestPerEm` is the width of the widest syllable at a font size of 1 (so 3.1 means the syllable is 3.1 times as
 * wide as the font is tall), `sizePx` the reading font size.
 */
export function gridMetrics(longestPerEm: number, sizePx: number): GridMetrics {
  const longest = Math.max(0.5, longestPerEm);
  const size = Math.max(8, sizePx);
  // Shrink the pinyin until the longest syllable fits the target cell, but not below the legible floor.
  const fit = (TARGET_CELL_EM - 2 * SYLLABLE_PAD_EM) / longest;
  let rtEm = Math.min(BASE_RT_EM, Math.max(fit, 0.34));
  rtEm = Math.max(rtEm, MIN_RT_PX / size);
  const cellEm = Math.max(MIN_CELL_EM, longest * rtEm + 2 * SYLLABLE_PAD_EM);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { cellEm: round(cellEm), rtEm: round(rtEm), padEm: round((cellEm - 1) / 2) };
}

/** Does the longest syllable fit inside its cell? (Used by the tests and by the QA script.) */
export function syllableFits(longestPerEm: number, m: GridMetrics): boolean {
  return longestPerEm * m.rtEm <= m.cellEm + 1e-6;
}

// ------------------------------------------------------------------ measuring ---

/** Six- and five-letter syllables with the widest letters and tone marks; the widest of these sets the cell. */
const WIDE_SYLLABLES = [
  'zhuang1', 'zhuang2', 'zhuang3', 'zhuang4', 'shuang1', 'shuang2', 'shuang3', 'shuang4', 'chuang1', 'chuang2',
  'chuang3', 'chuang4', 'zhang1', 'zheng1', 'sheng1', 'cheng2', 'xiong2', 'qiong2', 'jiang3', 'xiang3', 'qiang2',
  'liang3', 'niang2', 'guang1', 'huang2', 'kuang4', 'zhong1', 'chong2', 'zhuan3', 'shuan1', 'chuan2', 'guai4',
  'huai2', 'kuai4', 'zhui4', 'chui1', 'shui3', 'ruan3', 'nuan3', 'luan4', 'tuan2', 'duan4', 'suan4', 'cuan1',
  'hm5', 'ng2', 'huar5', 'mianr5', 'zher4',
];

/** Fallbacks when no canvas is available (tests, very old browsers): measured with Avenir Next and Helvetica Neue. */
export const FALLBACK_LONGEST: Record<PinyinStyle, number> = { marks: 3.1, numbers: 3.7, zhuyin: 3.6 };

const cache = new Map<string, number>();

/**
 * Width of the longest syllable at a font size of 1, measured with the canvas in the font the pinyin is drawn in.
 * `font` is the CSS font-family list of the rt element.
 */
export function measureLongest(style: PinyinStyle, font: string, weight = 500): number {
  const key = `${style}|${font}|${weight}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let result = FALLBACK_LONGEST[style];
  try {
    const canvas = typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent) ? document.createElement('canvas') : null;
    const c = canvas?.getContext('2d');
    if (c) {
      c.font = `${weight} 100px ${font}`;
      let best = 0;
      for (const s of WIDE_SYLLABLES) {
        const text = formatSyllable(s, style);
        best = Math.max(best, c.measureText(text).width / 100);
      }
      if (best > 0.5) result = best;
    }
  } catch { /* no canvas: keep the fallback */ }
  cache.set(key, result);
  return result;
}

/** Forget measurements (call after web fonts load: widths can change). */
export function resetMeasurements(): void {
  cache.clear();
}

/** Line height the reader actually uses: with pinyin possible, lines need room for it between them. */
export function effectiveLineHeight(lineHeight: number, pinyin: string): number {
  return pinyin === 'off' ? lineHeight : Math.max(lineHeight, 1.9);
}
