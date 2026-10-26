// A finger is wider than a character: a tap that lands just off a word (on punctuation, in the gap between lines, in the
// margin beside a line) is still meant for it. This decides which taps are for words, and which word: the nearest one.

/** How far from the finger a word still counts as the one tapped, in px. */
export const NEAR_PX = 12;
const RINGS = [4, 8, NEAR_PX];
const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]];

/** Distance from (x, y) to the nearest of an element's boxes (each line it sits on), 0 inside one; Infinity with no boxes. */
function distanceTo(el: Element, x: number, y: number): number {
  let best = Infinity;
  for (const r of Array.from(el.getClientRects())) {
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}

/** The word at (x, y), or else the nearest one within NEAR_PX of it; null when the tap is off the words. */
export function wordNear(x: number, y: number): HTMLElement | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  const at = document.elementFromPoint(x, y)?.closest<HTMLElement>('.rd-w');
  if (at) return at;
  // Each word the probes reach, with the nearest probe that reached it (used when the word has no boxes to measure).
  const found = new Map<HTMLElement, number>();
  for (const r of RINGS) {
    for (const [dx, dy] of DIRS) {
      const w = document.elementFromPoint(x + dx * r, y + dy * r)?.closest<HTMLElement>('.rd-w');
      if (w && !found.has(w)) found.set(w, r);
    }
  }
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const [w, probe] of found) {
    const measured = distanceTo(w, x, y);
    const d = Number.isFinite(measured) ? measured : probe;
    if (d < bestD) { best = w; bestD = d; }
  }
  return best && bestD <= NEAR_PX ? best : null;
}
