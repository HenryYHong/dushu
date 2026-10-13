// The arithmetic of the Pages layout (ARCHITECTURE.md 5.7): how wide a page is, when two pages sit side by side,
// which page a block is on and which block a page starts with. Pure functions, no DOM, so they are easy to test.

export type SpreadSetting = 'auto' | 'single' | 'double';

/** Two pages side by side need a wide, landscape-ish window: iPad landscape, a laptop, not a phone or a portrait iPad. */
export function decideSpread(setting: SpreadSetting, width: number, height: number): 1 | 2 {
  if (setting === 'single') return 1;
  if (setting === 'double') return 2;
  return width >= 900 && width >= height * 1.1 ? 2 : 1;
}

export interface GeometryInput {
  /** Reading area (the visible viewport), CSS px. */
  width: number;
  height: number;
  spread: SpreadSetting;
  /** Settings.pageWidth: the widest a text column gets. */
  pageWidth: number;
  /** Safe-area insets (notch, home indicator). */
  safeTop?: number;
  safeBottom?: number;
  /** Height of one line of text in px. When given, the text block is a whole number of lines tall, so every page ends evenly. */
  linePitch?: number;
}

export interface PageGeometry {
  /** Pages shown at once. */
  per: 1 | 2;
  width: number;
  height: number;
  /** One sheet of paper: the width of the stage divided by the pages shown. Also the distance between two pages. */
  paperW: number;
  /** Width of one text column. */
  cw: number;
  /** Space between a page edge and its text column (the same on all sides, so the spine gutter is 2 * margin). */
  margin: number;
  /** Gap between columns in the multi-column flow: 2 * margin, which makes the page stride equal paperW. */
  gap: number;
  /** Where the text block starts, from the top of the stage. */
  textTop: number;
  textH: number;
  /** Header and footer line positions (distance from the top / bottom of the stage to their baseline box). */
  headerTop: number;
  footerBottom: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Lay the reading area out: column width, margins and the height of the text block. */
export function computeGeometry(g: GeometryInput): PageGeometry {
  const per = decideSpread(g.spread, g.width, g.height);
  const paperW = g.width / per;
  const minMargin = clamp(Math.round(paperW * 0.09), 22, 84);
  const cw = Math.max(160, Math.floor(Math.min(g.pageWidth, paperW - 2 * minMargin)));
  const margin = Math.max(0, (paperW - cw) / 2);
  const safeTop = g.safeTop ?? 0;
  const safeBottom = g.safeBottom ?? 0;
  const compact = g.height < 560;
  let textTop = Math.round(safeTop + (compact ? 40 : 60));
  const bottom = Math.round(safeBottom + (compact ? 34 : 52));
  const room = Math.max(120, Math.floor(g.height - textTop - bottom));
  let textH = room;
  if (g.linePitch && g.linePitch > 8 && room > g.linePitch * 3) {
    // A whole number of lines, centered between the header and the footer.
    textH = Math.floor(room / g.linePitch) * g.linePitch;
    textTop += Math.floor((room - textH) / 2);
    textH = Math.ceil(textH);
  }
  return {
    per,
    width: g.width,
    height: g.height,
    paperW,
    cw,
    margin,
    gap: 2 * margin,
    textTop,
    textH,
    headerTop: Math.round(safeTop + (compact ? 12 : 22)),
    footerBottom: Math.round(safeBottom + (compact ? 10 : 18)),
  };
}

/** A string that changes whenever a change of geometry means the text must be laid out again. */
export function geometryKey(g: PageGeometry, extra: string): string {
  return [g.per, Math.round(g.width), Math.round(g.height), Math.round(g.cw), g.textH, extra].join('|');
}

// ------------------------------------------------------------------ blocks and pages ---

/** The first and last page (0-based) a block has a piece on. A paragraph that runs over a page break spans several. */
export interface BlockPages { first: number; last: number }

/** Which column of the multi-column flow an x position falls in. `x` is measured from the left edge of the first column. */
export function pageAtX(x: number, stride: number): number {
  if (stride <= 0) return 0;
  return Math.max(0, Math.floor((x + 2) / stride));
}

/** The page a block starts on. */
export function pageOfBlock(blocks: BlockPages[], index: number): number {
  if (!blocks.length) return 0;
  return blocks[Math.min(Math.max(index, 0), blocks.length - 1)].first;
}

/**
 * The first block that is on a page (the block a page starts with, even when it began on an earlier page).
 * Blocks are in reading order, so `last` never decreases and a binary search is enough.
 */
export function blockOfPage(blocks: BlockPages[], page: number): number {
  let lo = 0;
  let hi = blocks.length - 1;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].last >= page) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** How many pages the blocks cover. */
export function pageCount(blocks: BlockPages[]): number {
  let n = 0;
  for (const b of blocks) n = Math.max(n, b.last + 1);
  return Math.max(1, n);
}

/** The spread (a pair of facing pages, or one page) that holds a page. */
export function spreadOfPage(page: number, per: 1 | 2): number {
  return Math.floor(Math.max(0, page) / per);
}

export function firstPageOfSpread(spread: number, per: 1 | 2): number {
  return Math.max(0, spread) * per;
}

export function spreadCount(pages: number, per: 1 | 2): number {
  return Math.max(1, Math.ceil(pages / per));
}

/** The text of the footer: "5 pages left in chapter". `page` is 0-based. */
export function pagesLeftLabel(page: number, total: number): string {
  const left = Math.max(0, total - 1 - page);
  if (left === 0) return 'Last page of chapter';
  return `${left} ${left === 1 ? 'page' : 'pages'} left in chapter`;
}

/** Fraction of the chapter that is behind the reader: 0 on the first page, 1 on the last. */
export function chapterFraction(page: number, total: number): number {
  if (total <= 1) return 0;
  return Math.min(1, Math.max(0, page / (total - 1)));
}

// ---------------------------------------------------------------------- turning ---

export interface TurnTarget { chapter: number; spread: number }

/**
 * Where a page turn goes. Spreads run on inside a chapter; past either end the turn goes to the neighboring chapter
 * (its first spread forward, its last spread backward). Returns null at the edges of the book.
 * `spreadsIn(chapter)` is the spread count of that chapter, or null while its length is not known.
 */
export function turnTarget(
  dir: 1 | -1,
  at: TurnTarget,
  chapterCount: number,
  spreadsIn: (chapter: number) => number | null,
): TurnTarget | { chapter: number; spread: 'last' } | null {
  const here = spreadsIn(at.chapter);
  if (dir === 1) {
    if (here === null || at.spread < here - 1) return { chapter: at.chapter, spread: at.spread + 1 };
    if (at.chapter + 1 >= chapterCount) return null;
    return { chapter: at.chapter + 1, spread: 0 };
  }
  if (at.spread > 0) return { chapter: at.chapter, spread: at.spread - 1 };
  if (at.chapter <= 0) return null;
  return { chapter: at.chapter - 1, spread: 'last' };
}

/** Settle time for a page turn: longer for a long way to go, shorter after a fast flick. `velocity` is turns per ms. */
export function settleDuration(distance: number, velocity: number, base = 520): number {
  const d = Math.abs(distance);
  if (d < 0.001) return 0;
  const byVelocity = velocity > 0 ? d / velocity : base;
  return Math.round(clamp(Math.min(byVelocity, base * (0.45 + 0.55 * d)), 160, base));
}

/** Does a swipe that was released at `progress` (0..1) with `velocity` (turns per ms, signed toward the turn) complete? */
export function swipeCompletes(progress: number, velocity: number): boolean {
  if (velocity > 0.0016) return true;
  if (velocity < -0.0016) return false;
  return progress > 0.32;
}

/** Which tap zone a click at `x` falls in: the outer third of a page turns, the rest toggles the reading chrome. */
export function tapZone(x: number, width: number, per: 1 | 2): 'prev' | 'next' | 'middle' {
  const paper = width / per;
  if (x < paper / 3) return 'prev';
  if (x > width - paper / 3) return 'next';
  return 'middle';
}
