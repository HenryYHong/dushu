// Where a popup goes: a bubble next to the word on anything wider than a phone (an iPad included, so the page never moves
// to make room), a bottom sheet on a phone.

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Size { w: number; h: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

export const SHEET_BREAKPOINT = 640;
const MARGIN = 8;
const GAP = 8; // the 6 px caret sits inside it
const MAX_WIDTH = 400;
/** On a touch screen the card is a bubble at the word: narrower, and never taller than this (the rest scrolls inside it),
 * so it covers a few lines around the word instead of the facing page. */
export const BUBBLE_MAX_HEIGHT = 340;
const BUBBLE_MAX_WIDTH = 360;
/** A phone sheet stays under this share of the screen so the word you tapped is still in view. */
export const PHONE_SHEET_SHARE = 0.45;
/** A sheet shorter than this is "short": the stepping bar scrolls with the content instead of covering it. */
export const SHORT_SHEET = 420;
const CARET = 10;

export interface PlacementOptions {
  /** A touch device (pointer: coarse). */
  coarse?: boolean;
  /** The caller could move the page out of a sheet's way (the Pages reader). Only a phone sheet uses it now. */
  canShift?: boolean;
  /** Safe-area insets in px. */
  insets?: Partial<Insets>;
}

export type Placement =
  | { mode: 'sheet'; variant: 'phone' | 'tablet'; maxHeight: number; left: number | null; width: number | null }
  | {
    mode: 'float'; side: 'above' | 'below'; left: number; top: number; bottom: number | null; width: number; maxHeight: number;
    /** Where the caret sits, in px from the popup's left edge: under the middle of the anchor. Null when the card is not over the anchor. */
    caret: number | null;
  };

const inset = (o?: PlacementOptions): Insets => ({ top: 0, right: 0, bottom: 0, left: 0, ...(o?.insets ?? {}) });

/**
 * `contentHeight` is the natural height of the popup. Below the breakpoint the popup is a bottom sheet capped at
 * 45% of the screen. Wider, mouse or touch, it is a bubble at the word: it opens below the anchor with its caret under the
 * word, flips above when there is not enough room, and clamps horizontally; if neither side fits it takes the larger side
 * and scrolls inside. The page never moves for it.
 */
export function computePlacement(anchor: Rect, contentHeight: number, vp: Size, opts?: PlacementOptions): Placement {
  const ins = inset(opts);
  if (vp.w < SHEET_BREAKPOINT) {
    return { mode: 'sheet', variant: 'phone', maxHeight: Math.round(vp.h * PHONE_SHEET_SHARE), left: null, width: null };
  }
  const minX = MARGIN + ins.left;
  const maxX = vp.w - MARGIN - ins.right;
  const width = Math.min(opts?.coarse ? BUBBLE_MAX_WIDTH : MAX_WIDTH, maxX - minX);
  const cap = opts?.coarse ? BUBBLE_MAX_HEIGHT : Infinity;
  const center = anchor.left + anchor.width / 2;
  const left = Math.round(Math.min(Math.max(center - width / 2, minX), maxX - width));
  const caret = Math.round(Math.min(Math.max(center - left, 20), width - 20));
  const below = vp.h - ins.bottom - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - ins.top - GAP - MARGIN;
  // A capped bubble only needs room for its capped height.
  const want = Math.min(contentHeight, cap);
  if (want <= below || (below >= above && want > above)) {
    const maxHeight = Math.min(cap, Math.max(120, Math.floor(below)));
    const top = Math.max(MARGIN + ins.top, Math.round(anchor.bottom + GAP));
    return { mode: 'float', side: 'below', left, top, bottom: null, width, maxHeight, caret };
  }
  const maxHeight = Math.min(cap, Math.max(120, Math.floor(above)));
  // Pin the bottom edge so the popup grows upward if its content changes.
  return { mode: 'float', side: 'above', left, top: 0, bottom: Math.round(vp.h - (anchor.top - GAP)), width, maxHeight, caret };
}

/**
 * The box a popup points at, from the boxes of a word's or a phrase's characters in reading order. Characters on one page
 * (or column) make one box. Text that runs on from the foot of one page to the top of the next would make a box as tall as
 * the spread, with no room above or below it, so the popup would go to the top of the screen: instead it points at the
 * part with the most characters in view (the first part on a tie).
 */
export function anchorOf(rects: readonly Rect[], vp?: Size): DOMRect | null {
  const parts: Rect[][] = [];
  let prev: Rect | null = null;
  for (const q of rects) {
    if (!q.width && !q.height) continue;
    // Back up the page: the text went on in the next column or page.
    if (!prev || q.top < prev.top - prev.height / 2) parts.push([]);
    parts[parts.length - 1].push(q);
    prev = q;
  }
  const seen = (part: Rect[]) => !vp || part.some((q) => q.bottom > 0 && q.top < vp.h && q.right > 0 && q.left < vp.w);
  const pool = parts.some(seen) ? parts.filter(seen) : parts;
  const best = pool.reduce<Rect[] | null>((a, p) => (!a || p.length > a.length ? p : a), null);
  if (!best) return null;
  const l = Math.min(...best.map((q) => q.left)), t = Math.min(...best.map((q) => q.top));
  const r = Math.max(...best.map((q) => q.right)), b = Math.max(...best.map((q) => q.bottom));
  return new DOMRect(l, t, r - l, b - t);
}

/** True when the anchor has scrolled completely out of the viewport. */
export function anchorGone(anchor: Rect, vp: Size): boolean {
  return anchor.bottom < 0 || anchor.top > vp.h || anchor.right < 0 || anchor.left > vp.w;
}

export { CARET as CARET_SIZE };
