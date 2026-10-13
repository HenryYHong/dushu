// The even pinyin grid (ARCHITECTURE.md 5.7). With pinyin on, every Han character gets a cell of the same width and
// the pinyin is centered over its character without pushing neighbors apart. The cell is sized for a typical syllable
// (the 85th percentile of all syllables), not the widest: the few long ones (zhuāng, shuāng, chuáng) are squeezed
// horizontally a little so two neighbors never touch.
import { formatSyllable, PINYIN_SYLLABLES } from '../../core/pinyin';
import type { PinyinStyle, Settings } from '../../types';

export interface GridMetrics {
  /** Width of one character cell, in em of the reading font size. */
  cellEm: number;
  /** Pinyin font size, in em of the reading font size. */
  rtEm: number;
  /** Space on each side of a character inside its cell, in em. */
  padEm: number;
  /** The room a syllable leaves in its cell, in total (both sides), in em of the reading font: neighbors are never closer than this. */
  sqEm: number;
}

/** Smallest pinyin the grid will use, in px. Zhuyin needs more: its tone marks are tiny. */
export const MIN_RT_PX = 10.5;
export const MIN_RT_PX_ZHUYIN = 12;
/** Largest pinyin, in px (big reading sizes would otherwise get pinyin as big as a caption). */
export const MAX_RT_PX = 16;
/** Preferred pinyin size, as a share of the character size. */
export const BASE_RT_EM = 0.46;
/** A cell is never narrower than this, even for short pinyin. */
export const MIN_CELL_EM = 1.25;
/** ... and never wider than this (very small text with big-enough pinyin). */
export const MAX_CELL_EM = 1.9;
/** Breathing room kept on each side of the typical syllable, in em of the reading font. Zhuyin is drawn with wide symbols and small tone
 *  marks, so neighbors need a little more air than pinyin letters do (at 0.06 two squeezed syllables came within 2 px of each other). */
const SYLLABLE_PAD_EM = 0.06;
const SYLLABLE_PAD_EM_ZHUYIN = 0.1;
const syllablePad = (style: PinyinStyle) => (style === 'zhuyin' ? SYLLABLE_PAD_EM_ZHUYIN : SYLLABLE_PAD_EM);
/** The squeeze never goes below this; a still longer syllable overhangs the empty space of its neighbors. */
export const MIN_SQUEEZE = 0.72;
/** Which syllable counts as typical: this share of all syllables is no wider. */
const TYPICAL_PERCENTILE = 0.85;

/** Pinyin size in em of the reading size: at least MIN_RT_PX on screen, at most MAX_RT_PX. */
export function rtEmFor(sizePx: number, style: PinyinStyle = 'marks'): number {
  const size = Math.max(8, sizePx);
  const min = style === 'zhuyin' ? MIN_RT_PX_ZHUYIN : MIN_RT_PX;
  const px = Math.min(MAX_RT_PX, Math.max(min, size * BASE_RT_EM));
  return px / size;
}

/**
 * Cell and pinyin size for a reading size.
 * `typicalPerEm` is the width of a typical syllable at a font size of 1 (so 2.2 means that syllable is 2.2 times as
 * wide as the font is tall), `sizePx` the reading font size.
 */
export function gridMetrics(typicalPerEm: number, sizePx: number, style: PinyinStyle = 'marks'): GridMetrics {
  const typical = Math.max(0.5, typicalPerEm);
  const rtEm = rtEmFor(sizePx, style);
  const pad = syllablePad(style);
  const cellEm = Math.min(MAX_CELL_EM, Math.max(MIN_CELL_EM, typical * rtEm + 2 * pad));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return { cellEm: round(cellEm), rtEm: round(rtEm), padEm: round((cellEm - 1) / 2), sqEm: round(2 * pad) };
}

/** Horizontal squeeze (1 = none) that makes a syllable of `widthPerEm` fit the cell. */
export function squeezeFor(widthPerEm: number, m: GridMetrics): number {
  const w = widthPerEm * m.rtEm;
  const room = m.cellEm - m.sqEm;
  if (w <= room || w <= 0) return 1;
  return Math.max(MIN_SQUEEZE, Math.round((room / w) * 100) / 100);
}

/** Does the syllable fit inside its cell once squeezed? (Used by the tests and by the QA script.) */
export function syllableFits(widthPerEm: number, m: GridMetrics): boolean {
  return widthPerEm * m.rtEm * squeezeFor(widthPerEm, m) <= m.cellEm + 1e-6;
}

/**
 * Text indent of a paragraph in em of the reading size: exactly two cells, so the first line starts on a column of
 * the grid. (The grid off keeps the Chinese convention of 2em.)
 */
export function indentEm(m: GridMetrics): number {
  return Math.round(2 * m.cellEm * 1000) / 1000;
}

// ------------------------------------------------------------------ measuring ---

/** Fallbacks when no canvas is available (tests, very old browsers): average widths per em of the pinyin font. */
export const FALLBACK_TYPICAL: Record<PinyinStyle, number> = { marks: 2.2, numbers: 2.7, zhuyin: 2.1 };
/** The widest syllable (zhuāng) per style, same fallback. */
export const FALLBACK_LONGEST: Record<PinyinStyle, number> = { marks: 3.1, numbers: 3.7, zhuyin: 3.0 };
const FALLBACK_LETTER = 0.5;

export interface SyllableMeasure {
  /** Width of a typical syllable at a font size of 1. */
  typical: number;
  /** Width of the widest syllable at a font size of 1. */
  longest: number;
  /** Width of any pinyin text at a font size of 1. */
  widthOf(text: string): number;
}

const cache = new Map<string, SyllableMeasure>();

/**
 * Measure the pinyin font with the canvas. `font` is the CSS font-family list of the rt element.
 * Without a canvas the widths are estimated from the number of letters.
 */
export function measureSyllables(style: PinyinStyle, font: string, weight = 500): SyllableMeasure {
  const key = `${style}|${font}|${weight}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const canvas = typeof document !== 'undefined' && !/jsdom/i.test(navigator.userAgent) ? document.createElement('canvas') : null;
    ctx = canvas?.getContext('2d') ?? null;
    if (ctx) ctx.font = `${weight} 100px ${font}`;
  } catch { ctx = null; }
  const memo = new Map<string, number>();
  const widthOf = (text: string): number => {
    const known = memo.get(text);
    if (known !== undefined) return known;
    const w = ctx ? ctx.measureText(text).width / 100 : [...text].length * (style === 'zhuyin' ? 0.62 : FALLBACK_LETTER);
    memo.set(text, w);
    return w;
  };
  let typical = FALLBACK_TYPICAL[style];
  let longest = FALLBACK_LONGEST[style];
  if (ctx) {
    const widths = PINYIN_SYLLABLES.map((s) => widthOf(formatSyllable(`${s}1`, style))).sort((a, b) => a - b);
    // Tone marks widen a syllable a little; take the widest tone of the longest bases into account for the maximum.
    const wide = PINYIN_SYLLABLES.filter((s) => s.length >= 5).flatMap((s) => [1, 2, 3, 4].map((t) => widthOf(formatSyllable(`${s}${t}`, style))));
    const p = widths[Math.min(widths.length - 1, Math.floor(widths.length * TYPICAL_PERCENTILE))];
    if (p > 0.5) typical = p;
    const m = Math.max(...widths, ...wide);
    if (m > 0.5) longest = m;
  }
  const result: SyllableMeasure = { typical, longest, widthOf };
  cache.set(key, result);
  return result;
}

/** Forget measurements (call after web fonts load: widths can change). */
export function resetMeasurements(): void {
  cache.clear();
  quoteCache.clear();
}

/** Line height the reader actually uses: with pinyin possible, lines need room for it between them. */
export function effectiveLineHeight(lineHeight: number, pinyin: string): number {
  return pinyin === 'off' ? lineHeight : Math.max(lineHeight, 1.9);
}

// ------------------------------------------------------------------ the DOM side ---

export interface AppliedGrid { metrics: GridMetrics; measure: SyllableMeasure }

/** The measure of the pinyin font in use by the reader, so the renderer can size each syllable without asking the DOM. */
let active: SyllableMeasure | null = null;

/** Width of a pinyin text at a font size of 1, in the font the reader draws pinyin in (estimated until it is measured). */
export function widthOfPinyin(text: string): number {
  return active ? active.widthOf(text) : [...text].length * FALLBACK_LETTER;
}

/**
 * Measure the pinyin font in place and set the grid's CSS variables on `root` (the reader root or the settings preview):
 * --rd-cell, --rd-pad, --rd-rt and --rd-indent. Returns the numbers so the pager can size the page.
 */
export function applyGridVars(root: HTMLElement, sizePx: number, style: PinyinStyle, register = true): AppliedGrid {
  // The stylesheet picks the pinyin font for an rt inside an article (and another one for zhuyin): measure in the same place.
  const holder = document.createElement('div');
  holder.className = 'rd-article';
  holder.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
  const probe = document.createElement('rt');
  holder.appendChild(probe);
  root.appendChild(holder);
  const family = getComputedStyle(probe).fontFamily || 'sans-serif';
  holder.remove();
  const measure = measureSyllables(style, family);
  const metrics = gridMetrics(measure.typical, sizePx, style);
  if (register) active = measure;
  root.style.setProperty('--rd-cell', String(metrics.cellEm));
  root.style.setProperty('--rd-pad', String(metrics.padEm));
  root.style.setProperty('--rd-rt', String(metrics.rtEm));
  root.style.setProperty('--rd-sq', String(metrics.sqEm));
  root.style.setProperty('--rd-indent', `${indentEm(metrics)}em`);
  setQuoteVars(root, 'rd', measureQuotes(root));
  return { metrics, measure };
}

// ------------------------------------------------------------------ curly quotes ---

/** The four curly quotes and the CSS custom property suffix each one's measured advance is published under. */
export const QUOTE_KEYS: Record<string, string> = { '\u2018': 'lsq', '\u2019': 'rsq', '\u201c': 'ldq', '\u201d': 'rdq' };
/** What a quote counts as when it cannot be measured (no layout: tests): a full-width glyph, the old behavior. */
export const QUOTE_FALLBACK_EM = 1;
const quoteCache = new Map<string, Record<string, number>>();

/**
 * Advance of each curly quote at a font size of 1, in the font the reader sets its text in. A full-width CJK face draws them 1 em
 * wide with the ink in one half of the box; Songti SC and most other faces draw narrow proportional glyphs (0.2 to 0.4 em). The
 * stylesheet needs the number to give each quote a box of exactly half a cell either way. Measured on a probe inside `host`
 * (so it inherits the reader's font) with the language the article carries; null for a glyph that could not be measured.
 */
export function measureQuotes(host: HTMLElement, lang = 'zh', articleClass = true): Record<string, number | null> {
  const holder = document.createElement('div');
  // In the reader the font is the article's; the Settings preview sets its font on the host, which the probe inherits.
  if (articleClass) holder.className = 'rd-article';
  holder.lang = lang;
  holder.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;white-space:nowrap;letter-spacing:0';
  const spans = Object.keys(QUOTE_KEYS).map((q) => {
    const el = document.createElement('span');
    el.textContent = q;
    holder.appendChild(el);
    return [q, el] as const;
  });
  host.appendChild(holder);
  try {
    const family = getComputedStyle(holder).fontFamily;
    const key = `${lang}|${family}`;
    const hit = quoteCache.get(key);
    if (hit) return hit;
    const out: Record<string, number> = {};
    let ok = true;
    for (const [q, el] of spans) {
      const px = parseFloat(getComputedStyle(el).fontSize);
      const w = el.getBoundingClientRect().width;
      if (!(w > 0) || !(px > 0)) { ok = false; break; }
      out[q] = Math.round(Math.min(1.2, Math.max(0.15, w / px)) * 1000) / 1000;
    }
    if (!ok) return Object.fromEntries(Object.keys(QUOTE_KEYS).map((q) => [q, null]));
    quoteCache.set(key, out);
    return out;
  } finally {
    holder.remove();
  }
}

/** Publish the measured quote advances on `host` as `--<prefix>-q-<key>` (em, unitless). An unmeasurable one is left to the stylesheet's default. */
export function setQuoteVars(host: HTMLElement, prefix: 'rd' | 'set', measured: Record<string, number | null>): void {
  for (const [q, key] of Object.entries(QUOTE_KEYS)) {
    const w = measured[q];
    if (w == null) host.style.removeProperty(`--${prefix}-q-${key}`);
    else host.style.setProperty(`--${prefix}-q-${key}`, String(w));
  }
}

/** The reading size in px for the layout Settings holds (kept apart so callers need not know which key). */
export function readingSize(s: Settings): number {
  return s.layout === 'scroll' ? s.scrollFontSize : s.fontSize;
}
