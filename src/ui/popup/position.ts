// Where a popup goes: next to the anchor on wide screens, a bottom sheet on narrow ones (and on touch tablets
// when the page can move out of the sheet's way).

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Size { w: number; h: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

export const SHEET_BREAKPOINT = 640;
const MARGIN = 8;
const GAP = 8; // the 6 px caret sits inside it
const MAX_WIDTH = 400;
/** A phone sheet stays under this share of the screen so the word you tapped is still in view. */
export const PHONE_SHEET_SHARE = 0.45;
/** A tablet sheet may be taller: there is more screen above it. */
export const TABLET_SHEET_SHARE = 0.6;
/** In landscape the screen is short: the sheet takes less of it, so a word in the lower half of the page is never under it. */
export const LANDSCAPE_SHEET_SHARE = 0.44;
/** Never shorter than this (or 60% of a very short screen): a sheet needs room for the header and one meaning. */
const LANDSCAPE_SHEET_FLOOR = 240;
/** A sheet shorter than this is "short": the stepping bar scrolls with the content instead of covering it. */
export const SHORT_SHEET = 420;
const CARET = 10;
/** A touch screen at least this wide shows a two-page spread. */
const SPREAD_MIN_WIDTH = 900;

export interface PlacementOptions {
  /** A touch device (pointer: coarse). Tablets get a sheet instead of a floating card. */
  coarse?: boolean;
  /** The caller moves the page so the anchor stays above a sheet (the Pages reader does). */
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
 * 45% of the screen. On a wider touch screen it is a centered sheet when the caller can move the
 * page out of its way (`canShift`, the reader's onSheetTop): capped at 60% in portrait and 44% in landscape. Otherwise it opens below the anchor, flips above when there is not
 * enough room, and clamps horizontally; if neither side fits it takes the larger side and scrolls inside.
 */
export function computePlacement(anchor: Rect, contentHeight: number, vp: Size, opts?: PlacementOptions): Placement {
  const ins = inset(opts);
  if (vp.w < SHEET_BREAKPOINT) {
    return { mode: 'sheet', variant: 'phone', maxHeight: Math.round(vp.h * PHONE_SHEET_SHARE), left: null, width: null };
  }
  if (opts?.coarse && opts.canShift) {
    const landscape = vp.w > vp.h;
    const maxHeight = landscape
      ? Math.max(Math.round(vp.h * LANDSCAPE_SHEET_SHARE), Math.min(LANDSCAPE_SHEET_FLOOR, Math.round(vp.h * TABLET_SHEET_SHARE)))
      : Math.round(vp.h * TABLET_SHEET_SHARE);
    // The sheet spans the whole screen so no half-cut glyph or pinyin of the pages shows beside it; the card's content is
    // kept to a readable column of about 600 px by CSS (`.pp-sheet-tablet .pp-content`).
    return { mode: 'sheet', variant: 'tablet', maxHeight, left: 0, width: vp.w };
  }
  const minX = MARGIN + ins.left;
  const maxX = vp.w - MARGIN - ins.right;
  const width = Math.min(MAX_WIDTH, maxX - minX);
  const center = anchor.left + anchor.width / 2;
  // On a wide touch screen the text is two pages side by side: the card goes over the other page so the sentence
  // being read stays visible. Mice keep the card under the word.
  const spread = !!opts?.coarse && vp.w >= SPREAD_MIN_WIDTH;
  const aim = spread ? (center < vp.w / 2 ? vp.w * 0.75 : vp.w * 0.25) : center;
  const left = Math.round(Math.min(Math.max(aim - width / 2, minX), maxX - width));
  const along = center - left;
  const caret = along >= 20 && along <= width - 20 ? Math.round(along) : spread ? null : Math.round(Math.min(Math.max(along, 20), width - 20));
  const below = vp.h - ins.bottom - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - ins.top - GAP - MARGIN;
  if (contentHeight <= below || (below >= above && contentHeight > above)) {
    const maxHeight = Math.max(120, Math.floor(below));
    const top = Math.max(MARGIN + ins.top, Math.round(anchor.bottom + GAP));
    return { mode: 'float', side: 'below', left, top, bottom: null, width, maxHeight, caret };
  }
  const maxHeight = Math.max(120, Math.floor(above));
  // Pin the bottom edge so the popup grows upward if its content changes.
  return { mode: 'float', side: 'above', left, top: 0, bottom: Math.round(vp.h - (anchor.top - GAP)), width, maxHeight, caret };
}

/** True when the anchor has scrolled completely out of the viewport. */
export function anchorGone(anchor: Rect, vp: Size): boolean {
  return anchor.bottom < 0 || anchor.top > vp.h || anchor.right < 0 || anchor.left > vp.w;
}

export { CARET as CARET_SIZE };
