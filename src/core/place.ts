// A reading place as a count of Han characters from the start of the book, so it survives the book being imported again
// with its chapters or paragraphs cut differently (ui/library/upgrade.ts): the same text has the same characters.
import type { BookMeta, Chapter, Progress } from '../types';
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

/**
 * Where a share of the book (Progress.percent: Han characters with chapter titles counted, as BookMeta counts them) falls:
 * the chapter, and how many Han characters into its text.
 */
export function chapterAtPercent(meta: Pick<BookMeta, 'chapterCount' | 'charCount' | 'chapterOffsets' | 'chapterTitles'>, percent: number): { chapter: number; han: number } {
  const pos = Math.min(1, Math.max(0, percent)) * meta.charCount;
  let c = 0;
  while (c + 1 < meta.chapterCount && (meta.chapterOffsets[c + 1] ?? Infinity) <= pos) c++;
  const title = countHan(meta.chapterTitles?.[c] ?? '');
  return { chapter: c, han: Math.max(0, Math.floor(pos - (meta.chapterOffsets[c] ?? 0) - title)) };
}

/**
 * A place saved in another cut of the same book (an older importer's), moved into this one. Only its percent carries over,
 * so it lands within about a page, and it counts as a moment older than the place it came from: the same place moved by
 * the device that read it (store.books.replace, which goes by the old chapters' text) wins over it.
 */
export async function moveByPercent(
  meta: Pick<BookMeta, 'id' | 'chapterCount' | 'charCount' | 'chapterOffsets' | 'chapterTitles'>,
  place: Omit<Progress, 'bookId'>,
  chapter: (index: number) => Chapter | undefined | Promise<Chapter | undefined>,
): Promise<Progress> {
  const at = chapterAtPercent(meta, place.percent);
  const c = await chapter(at.chapter);
  const inside = c ? placeAt([c], at.han) : { block: 0, offset: 0 };
  const out: Progress = { bookId: meta.id, chapter: at.chapter, block: inside.block, percent: place.percent, updatedAt: place.updatedAt - 1 };
  if (inside.offset > 0) out.offset = inside.offset;
  return out;
}
