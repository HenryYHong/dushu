// A finger is wider than a character: a tap that lands just off a word (on punctuation, in the gap between lines) is still
// meant for it. In Pages a tap anywhere else turns the page, so this decides which taps are for words.

/** How far from the finger a word still counts as the one tapped, in px. */
export const NEAR_PX = 12;
const PROBES: [number, number][] = [
  [0, 0], [0, -NEAR_PX], [0, NEAR_PX], [-NEAR_PX, 0], [NEAR_PX, 0],
  [-NEAR_PX, -NEAR_PX], [NEAR_PX, -NEAR_PX], [-NEAR_PX, NEAR_PX], [NEAR_PX, NEAR_PX],
];

/** The word at (x, y), or else one within NEAR_PX of it; null when the tap is off the words. */
export function wordNear(x: number, y: number): HTMLElement | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  for (const [dx, dy] of PROBES) {
    const w = document.elementFromPoint(x + dx, y + dy)?.closest<HTMLElement>('.rd-w');
    if (w) return w;
  }
  return null;
}
