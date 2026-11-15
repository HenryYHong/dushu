// A book's own contents set out in plain paragraphs, inside a chapter: a 目录 line and a list of entries, each a title with its
// page number and dot leaders (河边的人家⒈⒍………). A file made from a web edition often has nothing else to say where its
// stories begin: their titles are plain paragraphs too, and every story runs on after the one before.
//
// The contents names those titles, so a later paragraph that is exactly one of them is that story's heading. The 目录 line becomes
// a heading too. In Pages a heading inside a chapter opens a page of its own (reader.css), so the contents and each story start
// their own page, as in the printed book. Only when the list holds three entries or more, and only titles found three times or
// more: a word that merely looks like a title is never made one.
import type { Chapter } from '../types';

const LABEL = /^(?:目[录錄次]|contents|table of contents)$/i;
/** Dot leaders, rules and spaces at either end of an entry. */
const LEADERS = /^[\s　.…·・_—\-]+|[\s　.…·・_—\-]+$/g;
/** A page number at the end of an entry, in any digits a print edition uses (12, １２, ⒈⒉, ①). */
const PAGE = /[\d０-９①-⓿❶-➓]+$/;
/** An entry is a short line; a long one is the text going on. */
const ENTRY_MAX = 40;
const TITLE_MAX = 30;
const MIN_ENTRIES = 3;
const MIN_FOUND = 3;

/** The title an entry names: its page number, dot leaders and spaces taken off. */
export function entryTitle(entry: string): string {
  let t = entry.replace(LEADERS, '');
  t = t.replace(PAGE, '');
  return t.replace(LEADERS, '').trim();
}

const plain = (s: string) => s.replace(/[\s　]/g, '');

export function markContents(chapters: Chapter[]): Chapter[] {
  // The first contents line of the book, with the run of short entries after it.
  for (let ci = 0; ci < chapters.length; ci++) {
    const blocks = chapters[ci].blocks;
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (b.t !== 'p' || !LABEL.test(plain(b.text))) continue;
      // The list ends at a long line, or at a line that names an entry already listed: the first story's own title, where the
      // text begins straight after the contents.
      let end = bi + 1;
      const listed = new Set<string>();
      while (end < blocks.length) {
        const e = blocks[end];
        if (e.t !== 'p' || [...e.text.trim()].length > ENTRY_MAX || listed.has(e.text.trim())) break;
        listed.add(entryTitle(e.text));
        end++;
      }
      const entries = blocks.slice(bi + 1, end).map((e) => (e.t === 'p' ? entryTitle(e.text) : '')).filter((t) => t && [...t].length <= TITLE_MAX);
      if (entries.length < MIN_ENTRIES) continue;
      return withHeadings(chapters, ci, bi, end, new Set(entries));
    }
  }
  return chapters;
}

/** The label at chapters[ci].blocks[bi] made a heading, and the first paragraph after the list naming each title. */
function withHeadings(chapters: Chapter[], ci: number, bi: number, end: number, titles: Set<string>): Chapter[] {
  const found: [number, number][] = [];
  const left = new Set(titles);
  for (let c = ci; c < chapters.length && left.size; c++) {
    const blocks = chapters[c].blocks;
    for (let i = c === ci ? end : 0; i < blocks.length && left.size; i++) {
      const b = blocks[i];
      if (b.t !== 'p') continue;
      const t = b.text.trim();
      if (left.has(t)) { found.push([c, i]); left.delete(t); }
    }
  }
  const heads = new Set([`${ci}:${bi}`, ...(found.length >= MIN_FOUND ? found.map(([c, i]) => `${c}:${i}`) : [])]);
  return chapters.map((ch, c) => (ch.blocks.some((_, i) => heads.has(`${c}:${i}`))
    ? { ...ch, blocks: ch.blocks.map((b, i) => (heads.has(`${c}:${i}`) && b.t === 'p' ? { t: 'h' as const, level: 2 as const, text: b.text.trim() } : b)) }
    : ch));
}
