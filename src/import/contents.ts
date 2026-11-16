// A book's own contents set out in plain paragraphs, inside a chapter: a 目录 line and a list of entries, each a title with its
// page number and dot leaders (河边的人家⒈⒍………). A file made from a web edition often has nothing else to say where its
// stories begin: their titles are plain paragraphs too, and every story runs on after the one before, several to a chapter
// named only "Chapter_1".
//
// The contents names those titles, so a later paragraph that is exactly one of them (spaces aside: 小　路) is that story's
// heading, and the story a chapter of its own under its name, as the contents and the chapter list then agree. The 目录 line
// becomes a heading and the contents a chapter too. Only when the list holds three entries or more, and only titles found three
// times or more: a word that merely looks like a title is never made one. Files named only by their number were cut by size
// (Chapter_2 opens in the middle of a sentence): what one holds before its first story runs on from the story before.
import type { Block, Chapter } from '../types';
import { joinSplitParagraphs } from './chapters';
import { isFileName } from './leftovers';

/** Tested with the spaces taken out (目　录, Table of Contents). */
const LABEL = /^(?:目[录錄次]|contents|tableofcontents)$/i;
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

/** A paragraph that ends a sentence (or a quotation). */
const ENDS = /[。！？…」』”"）)!?.:：]$/;

const plain = (s: string) => s.replace(/[\s　]/g, '');

export function markContents(input: Chapter[]): Chapter[] {
  // A file's name set as its heading (Chapter_1) is no part of the text, nor a converter's label set just before the book's
  // own (Table of Contents over 目录).
  const isLabel = (b: Block | undefined) => b?.t === 'p' && LABEL.test(plain(b.text));
  const tidied = input.map((c) => {
    const first = c.blocks[0];
    const own = isFileName(c.title) && first?.t === 'h' && plain(first.text).toLowerCase() === plain(c.title).toLowerCase() ? c.blocks.slice(1) : c.blocks;
    const blocks = own.filter((b, i) => !(isLabel(b) && isLabel(own[i + 1])));
    return blocks.length === c.blocks.length ? c : { ...c, blocks };
  });
  const chapters = tidied.every((c, i) => c === input[i]) ? input : tidied;
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
        if (e.t !== 'p' || [...e.text.trim()].length > ENTRY_MAX || listed.has(plain(e.text))) break;
        listed.add(plain(entryTitle(e.text)));
        end++;
      }
      const entries = blocks.slice(bi + 1, end).map((e) => (e.t === 'p' ? entryTitle(e.text) : '')).filter((t) => t && [...t].length <= TITLE_MAX);
      if (entries.length < MIN_ENTRIES) continue;
      return withHeadings(chapters, ci, bi, end, new Set(entries.map(plain)));
    }
  }
  return chapters;
}

/** The label at chapters[ci].blocks[bi] made a heading, and the first paragraph after the list naming each title; each starts a chapter. */
function withHeadings(chapters: Chapter[], ci: number, bi: number, end: number, titles: Set<string>): Chapter[] {
  const found: [number, number][] = [];
  const left = new Set(titles);
  for (let c = ci; c < chapters.length && left.size; c++) {
    const blocks = chapters[c].blocks;
    for (let i = c === ci ? end : 0; i < blocks.length && left.size; i++) {
      const b = blocks[i];
      if (b.t !== 'p') continue;
      // A title is printed spaced out at times (小　路): the spaces are not part of it.
      const t = plain(b.text);
      if (left.has(t)) { found.push([c, i]); left.delete(t); }
    }
  }
  const stories = found.length >= MIN_FOUND;
  const heads = new Set([`${ci}:${bi}`, ...(stories ? found.map(([c, i]) => `${c}:${i}`) : [])]);
  const out: Chapter[] = [];
  /**
   * Blocks that run on from the chapter before, joined to it. The cut fell in a line: a paragraph left without its closing mark
   * goes on into the first one here, and that one, a line's tail ("老人坐在门"), into the next until a sentence ends.
   */
  const runOn = (blocks: Block[]) => {
    const last = out[out.length - 1];
    const joined = [...last.blocks];
    let k = 0;
    for (let n = 0; n < 2 && k < blocks.length; n++) {
      const prev = joined[joined.length - 1];
      const cur = blocks[k];
      if (prev?.t !== 'p' || cur.t !== 'p' || ENDS.test(prev.text.trimEnd())) break;
      joined[joined.length - 1] = { t: 'p', text: prev.text.trimEnd() + cur.text.trimStart() };
      k++;
    }
    out[out.length - 1] = { ...last, blocks: joinSplitParagraphs([...joined, ...blocks.slice(k)]) };
  };
  chapters.forEach((ch, c) => {
    const cutBySize = stories && c > ci && out.length > 0 && isFileName(ch.title);
    if (!ch.blocks.some((_, i) => heads.has(`${c}:${i}`))) {
      if (cutBySize) runOn(ch.blocks); else out.push(ch);
      return;
    }
    const blocks = ch.blocks.map((b, i) => (heads.has(`${c}:${i}`) && b.t === 'p' ? { t: 'h' as const, level: 2 as const, text: b.text.trim() } : b));
    // A heading with text before it in the chapter starts the next chapter, named by it. One with only headings before it
    // (the chapter's own) stays where it is.
    let from = 0;
    let piece: Chapter = { ...ch, blocks: [] };
    blocks.forEach((b, i) => {
      if (heads.has(`${c}:${i}`) && blocks.slice(from, i).some((x) => x.t !== 'h' && x.t !== 'hr')) {
        if (from === 0 && cutBySize) runOn(blocks.slice(0, i)); else out.push({ ...piece, blocks: blocks.slice(from, i) });
        piece = { title: (b as { text: string }).text, blocks: [] };
        from = i;
      }
    });
    out.push({ ...piece, blocks: blocks.slice(from) });
  });
  return out;
}
