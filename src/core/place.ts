// A reading place as a count of Han characters from the start of the book, so it survives the book being imported again
// with its chapters or paragraphs cut differently (ui/library/upgrade.ts): the same text has the same characters.
import type { Chapter } from '../types';
import { countHan } from '../import/han';

const textOf = (b: Chapter['blocks'][number]) => ('text' in b ? b.text : '');

/** Han characters in a chapter's text (its title not counted: titles change when chapters are cut differently). */
export function textHan(c: Chapter): number {
  let n = 0;
  for (const b of c.blocks) n += countHan(textOf(b));
  return n;
}

/** Han characters before `block` (and `offset` UTF-16 units into it) in a chapter. */
export function hanBefore(c: Chapter, block: number, offset = 0): number {
  let n = 0;
  for (let i = 0; i < Math.min(block, c.blocks.length); i++) n += countHan(textOf(c.blocks[i]));
  const at = c.blocks[block];
  if (at && offset > 0) n += countHan(textOf(at).slice(0, offset));
  return n;
}

/** The chapter, block and UTF-16 offset of the `pos`-th Han character (0-based) of the book; the end if it runs past. */
export function placeAt(chapters: Chapter[], pos: number): { chapter: number; block: number; offset: number } {
  let left = Math.max(0, pos);
  for (let c = 0; c < chapters.length; c++) {
    const n = textHan(chapters[c]);
    if (left >= n && c < chapters.length - 1) { left -= n; continue; }
    const blocks = chapters[c].blocks;
    for (let b = 0; b < blocks.length; b++) {
      const text = textOf(blocks[b]);
      const k = countHan(text);
      if (left < k) {
        // The UTF-16 offset of the Han character `left` places into this block.
        let seen = 0;
        let i = 0;
        for (const ch of text) {
          if (countHan(ch)) { if (seen === left) break; seen++; }
          i += ch.length;
        }
        return { chapter: c, block: b, offset: i };
      }
      left -= k;
    }
    return { chapter: c, block: Math.max(0, blocks.length - 1), offset: 0 };
  }
  return { chapter: 0, block: 0, offset: 0 };
}
