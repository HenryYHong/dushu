// What the making of a file leaves in its text, not the book's own words.
//
// Chapters named after the file that held them ("Chapter_1", "part0001", "index_split_003", "Section0002"): a converter's name,
// often set in the text as a heading too. The heading goes and the chapter takes its name from its own first lines.
//
// A section break written as a row of one letter ("BBB"), set on a line of its own again and again through a Chinese or Japanese
// book: a web edition's stand-in for the printed ornament. It becomes a break, as a row of stars already does.
import type { Block, Chapter } from '../types';
import { titleFromText } from './spine';

/** A converter's name for a file: letters, an underscore and a number ("Chapter_1", "index_split_000"), or a padded number ("part0001"). */
const FILE_NAME = /^[A-Za-z]+(?:_[A-Za-z]+)*_\d+$|^[A-Za-z]+0\d+$/;

export const isFileName = (title: string): boolean => FILE_NAME.test(title.trim());

const squash = (s: string) => s.replace(/[\s　]+/g, '').toLowerCase();

/** Chapters named by their file: the heading saying that name dropped, the chapter named by its first lines (or left unnamed). */
export function nameFileNamedChapters(chapters: Chapter[]): Chapter[] {
  return chapters.map((c) => {
    if (!isFileName(c.title)) return c;
    const first = c.blocks[0];
    const blocks = first?.t === 'h' && squash(first.text) === squash(c.title) ? c.blocks.slice(1) : c.blocks;
    const named = titleFromText(blocks);
    return { ...c, title: isFileName(named) ? '' : named, blocks };
  });
}

/** A row of one Latin letter, three or more ("BBB", "ooo"). */
const LETTER_ROW = /^([A-Za-z])\1{2,}$/;
const HAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

/** In a Chinese or Japanese book, a line that is only a row of one letter, set three times or more, is a section break. */
export function letterRowBreaks(chapters: Chapter[]): Chapter[] {
  const rows = new Map<string, number>();
  let han = 0;
  for (const c of chapters) {
    for (const b of c.blocks) {
      if (b.t !== 'p') continue;
      const t = b.text.trim();
      if (LETTER_ROW.test(t)) rows.set(t, (rows.get(t) ?? 0) + 1);
      else if (han < 2000) han += t.match(HAN)?.length ?? 0;
    }
  }
  const marks = new Set([...rows].filter(([, n]) => n >= 3).map(([t]) => t));
  if (!marks.size || han < 2000) return chapters;
  return chapters.map((c) => {
    if (!c.blocks.some((b) => b.t === 'p' && marks.has(b.text.trim()))) return c;
    const blocks: Block[] = [];
    for (const b of c.blocks) {
      if (b.t === 'p' && marks.has(b.text.trim())) {
        if (blocks.length && blocks[blocks.length - 1].t !== 'hr') blocks.push({ t: 'hr' });
      } else blocks.push(b);
    }
    while (blocks.length && blocks[blocks.length - 1].t === 'hr') blocks.pop();
    return { ...c, blocks };
  });
}
