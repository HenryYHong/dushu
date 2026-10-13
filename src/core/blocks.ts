// Unicode blocks that hold Han characters, with the names the popup shows.

export interface HanBlock { start: number; end: number; name: string }

/** Sorted, non-overlapping. Includes unassigned code points inside each block on purpose. */
export const HAN_BLOCKS: readonly HanBlock[] = [
  { start: 0x2e80, end: 0x2eff, name: 'CJK Radicals Supplement' },
  { start: 0x2f00, end: 0x2fdf, name: 'Kangxi Radicals' },
  { start: 0x3007, end: 0x3007, name: 'CJK Symbols and Punctuation' },
  { start: 0x3400, end: 0x4dbf, name: 'CJK Unified Ideographs Extension A' },
  { start: 0x4e00, end: 0x9fff, name: 'CJK Unified Ideographs' },
  { start: 0xf900, end: 0xfaff, name: 'CJK Compatibility Ideographs' },
  { start: 0x20000, end: 0x2a6df, name: 'CJK Unified Ideographs Extension B' },
  { start: 0x2a700, end: 0x2b73f, name: 'CJK Unified Ideographs Extension C' },
  { start: 0x2b740, end: 0x2b81f, name: 'CJK Unified Ideographs Extension D' },
  { start: 0x2b820, end: 0x2ceaf, name: 'CJK Unified Ideographs Extension E' },
  { start: 0x2ceb0, end: 0x2ebef, name: 'CJK Unified Ideographs Extension F' },
  { start: 0x2ebf0, end: 0x2ee5f, name: 'CJK Unified Ideographs Extension I' },
  { start: 0x2f800, end: 0x2fa1f, name: 'CJK Compatibility Ideographs Supplement' },
  { start: 0x30000, end: 0x3134f, name: 'CJK Unified Ideographs Extension G' },
  { start: 0x31350, end: 0x323af, name: 'CJK Unified Ideographs Extension H' },
  { start: 0x323b0, end: 0x3347f, name: 'CJK Unified Ideographs Extension J' },
];

/** Block name for a Han code point, or null. Binary search over HAN_BLOCKS. */
export function hanBlockName(cp: number): string | null {
  let lo = 0;
  let hi = HAN_BLOCKS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = HAN_BLOCKS[mid];
    if (cp < b.start) hi = mid - 1;
    else if (cp > b.end) lo = mid + 1;
    else return b.name;
  }
  return null;
}
