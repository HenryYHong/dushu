// What a language engine learns a book from when the reader opens it (LangEngine.beginBook): the names the book uses in
// mid-sentence, so the same name starting a sentence reads as the name. One chapter is not enough. Platero y yo's first
// chapter has Platero only at sentence starts and after "¿, so the donkey's name read as "silversmith" until chapter II;
// and a reader who comes back at chapter 30 would teach it from chapter 30 alone.
import type { Chapter } from '../../types';
import { sampleChapters } from '../../core/bookWords';

/** The first chapters, read whole up to this many characters each: a book's names come up early. */
export const START_CHAPTERS = 3;
/** Characters taken from each chapter other than the one opened (as core/bookWords samples a book). */
export const START_CHARS = 4000;
/** All the text taken from other chapters together, at most. */
export const START_CAP = 80_000;

/** The chapters to read, in order: the one opened, the first few, then a spread over the book. Each once. */
export function startChapters(count: number, opened: number): number[] {
  const out: number[] = [];
  const add = (i: number) => { if (i >= 0 && i < count && !out.includes(i)) out.push(i); };
  add(opened);
  for (let i = 0; i < START_CHAPTERS; i++) add(i);
  for (const i of sampleChapters(count)) add(i);
  return out;
}

/** The text of a chapter's paragraphs, headings and quotes, up to `limit` characters. */
export function chapterText(chapter: Chapter, limit = Infinity): string {
  const parts: string[] = [];
  let left = limit;
  for (const b of chapter.blocks) {
    if (left <= 0) break;
    if (b.t !== 'p' && b.t !== 'quote' && b.t !== 'h') continue;
    const t = b.text.length > left ? b.text.slice(0, left) : b.text;
    parts.push(t);
    left -= t.length;
  }
  return parts.join('\n');
}

/**
 * The text to begin the book with: the chapter opened, whole, then up to START_CHARS of each other chapter startChapters
 * names, START_CAP in all. A chapter that cannot be read is left out.
 */
export async function bookStartText(
  count: number, opened: number, load: (index: number) => Promise<Chapter | undefined | null>,
): Promise<string> {
  const texts: string[] = [];
  let left = START_CAP;
  for (const i of startChapters(count, opened)) {
    if (i !== opened && left <= 0) break;
    const c = await load(i).catch(() => undefined);
    if (!c) continue;
    const t = chapterText(c, i === opened ? Infinity : Math.min(START_CHARS, left));
    if (i !== opened) left -= t.length;
    if (t) texts.push(t);
  }
  return texts.join('\n');
}
