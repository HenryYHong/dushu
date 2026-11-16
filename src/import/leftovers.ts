// What the making of a file leaves in its text, not the book's own words.
//
// Chapters named after the file that held them ("Chapter_1", "part0001", "index_split_003", "Section0002"): a converter's name,
// often set in the text as a heading too. The heading goes and the chapter takes its name from its own first lines.
//
// A section break written as a row of one letter ("BBB"), set on a line of its own again and again through a Chinese or Japanese
// book: a web edition's stand-in for the printed ornament. It becomes a break, as a row of stars already does.
//
// A story's sections numbered 一, 二, 三 on lines of their own, left plain paragraphs by the file: they are the section numbers a
// printed edition sets in the middle of the page, so they become small headings (the reader centers a heading that is only a
// number, and does not start a page for it).
//
// The back of a book run on into its last story: a chronology of the author's life, an afterword or an appendix whose title the
// file left a plain line (作者生平大事记 after the last paragraph). That line starts a chapter of its own, under its title.
import type { Block, Chapter } from '../types';
import { alignHeading, titleFromText } from './spine';

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
    // A title that is the chapter's first line alone ("河边的故事" over the text) is that line, set as the heading, not shown twice.
    return isFileName(named) ? { ...c, title: '', blocks } : alignHeading({ ...c, title: named, blocks });
  });
}

/** A section number alone on its line, in Chinese numerals: 一, 二 … 二十 (with a 、 or brackets at times). */
const SECTION_NUMBER = /^[（(〔]?([一二三四五六七八九十]{1,3})[)）〕、．.]?$/;
const DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** The value of a Chinese numeral up to 九十九 (一 1, 十 10, 十二 12, 二十 20, 二十三 23); 0 when it is not one. */
export function numeralValue(s: string): number {
  const m = /^([二三四五六七八九])?(十)?([一二三四五六七八九])?$/.exec(s);
  if (!m || !s) return 0;
  if (!m[2]) return m[1] && m[3] ? 0 : DIGIT[m[1] ?? m[3]];
  return (m[1] ? DIGIT[m[1]] : 1) * 10 + (m[3] ? DIGIT[m[3]] : 0);
}

/**
 * Paragraphs that are only a section number, counting 一, 二, 三 … in order through a chapter with text between them, made small
 * headings. Every lone number in the chapter must be in that count, or none is made one.
 */
export function sectionNumbers(chapters: Chapter[]): Chapter[] {
  let changed = false;
  const out = chapters.map((c) => {
    const at: number[] = [];
    let strays = 0;
    c.blocks.forEach((b, i) => {
      const m = b.t === 'p' ? SECTION_NUMBER.exec(b.text.trim()) : null;
      if (!m) return;
      const n = numeralValue(m[1]);
      const prev = at[at.length - 1];
      if (n === at.length + 1 && (prev === undefined || c.blocks.slice(prev + 1, i).some((x) => x.t === 'p'))) at.push(i);
      else strays++;
    });
    if (at.length < 2 || strays) return c;
    changed = true;
    const marks = new Set(at);
    return { ...c, blocks: c.blocks.map((b, i): Block => (marks.has(i) && b.t === 'p' ? { t: 'h', level: 4, text: b.text.trim() } : b)) };
  });
  return changed ? out : chapters;
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

/** The title of a book's back matter: a chronology, an afterword, an appendix (作者生平大事记, 年表, 后记, 附录二). */
const BACK_MATTER = /^[\p{Script=Han}《》·]{0,12}(大事记|大事記|年表|年谱|年譜|后记|後記|附录|附錄|跋)[一二三四五六七八九十]?$/u;

/**
 * A line in the last chapter that titles the book's back matter, with the story's text before it and the back matter's after:
 * the back matter is a chapter of its own, its title its heading.
 */
export function backMatter(chapters: Chapter[]): Chapter[] {
  const last = chapters[chapters.length - 1];
  if (!last) return chapters;
  const blocks = last.blocks;
  const at = blocks.findIndex((b, i) => i >= 5 && b.t === 'p' && BACK_MATTER.test(squash(b.text)) && !squash(last.title).endsWith(squash(b.text)));
  if (at < 0 || blocks.slice(at + 1).filter((b) => b.t === 'p').length < 2) return chapters;
  const title = blocks[at].t === 'p' ? (blocks[at] as { text: string }).text.trim() : '';
  return [...chapters.slice(0, -1), { ...last, blocks: blocks.slice(0, at) }, { title, blocks: [{ t: 'h', level: 1, text: title }, ...blocks.slice(at + 1)] }];
}
