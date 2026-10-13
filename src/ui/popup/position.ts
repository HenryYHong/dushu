// Where a popup goes: next to the anchor on wide screens, a bottom sheet on narrow ones.

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Size { w: number; h: number }

export const SHEET_BREAKPOINT = 640;
const MARGIN = 8;
const GAP = 8;
const MAX_WIDTH = 400;

export type Placement =
  | { mode: 'sheet'; maxHeight: number }
  | { mode: 'float'; side: 'above' | 'below'; left: number; top: number; bottom: number | null; width: number; maxHeight: number };

/**
 * `contentHeight` is the natural height of the popup. Below the breakpoint the popup is a bottom sheet.
 * Otherwise it opens below the anchor, flips above when there is not enough room, and clamps horizontally;
 * if neither side fits it takes the larger side and scrolls inside.
 */
export function computePlacement(anchor: Rect, contentHeight: number, vp: Size): Placement {
  if (vp.w < SHEET_BREAKPOINT) return { mode: 'sheet', maxHeight: Math.round(vp.h * 0.7) };
  const width = Math.min(MAX_WIDTH, vp.w - MARGIN * 2);
  const center = anchor.left + anchor.width / 2;
  const left = Math.round(Math.min(Math.max(center - width / 2, MARGIN), vp.w - width - MARGIN));
  const below = vp.h - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  if (contentHeight <= below || (below >= above && contentHeight > above)) {
    const maxHeight = Math.max(120, Math.floor(below));
    const top = Math.max(MARGIN, Math.round(anchor.bottom + GAP));
    return { mode: 'float', side: 'below', left, top, bottom: null, width, maxHeight };
  }
  const maxHeight = Math.max(120, Math.floor(above));
  // Pin the bottom edge so the popup grows upward if its content changes.
  return { mode: 'float', side: 'above', left, top: 0, bottom: Math.round(vp.h - (anchor.top - GAP)), width, maxHeight };
}

/** True when the anchor has scrolled completely out of the viewport. */
export function anchorGone(anchor: Rect, vp: Size): boolean {
  return anchor.bottom < 0 || anchor.top > vp.h || anchor.right < 0 || anchor.left > vp.w;
}
