// Documents in reading order plus a table of contents pointing into them: the chapter assembly
// shared by the EPUB and the Kindle (MOBI / AZW3) importers.
import type { Block, Chapter } from '../types';
import { blockText, splitAtChapterHeadings } from './chapters';
import { countHan, unitScale } from './han';
import { cleanAuthorName } from './meta';

export interface SpineDoc {
  /** Only used by callers to find a document again. */
  path: string;
  blocks: Block[];
  /** Anchor id to the index of the block that starts there. */
  anchors: Map<string, number>;
  /** A generated contents page, a navigation document: its blocks are not part of the book. */
  skipped: boolean;
}

/** One table-of-contents entry: a document (index into the spine), an optional anchor in it, and a label. */
export interface TocRef {
  doc: number;
  frag: string;
  title: string;
}

export function firstHeading(blocks: Block[]): string {
  for (let i = 0; i < Math.min(blocks.length, 3); i++) {
    const b = blocks[i];
    if (b.t === 'h') return b.text;
    if (b.t === 'p' || b.t === 'quote') return '';
  }
  return '';
}

const squash = (s: string) => s.replace(/[\s　]+/g, '');

/**
 * The first heading of a chapter often repeats the table-of-contents label with the spaces
 * squeezed out ("第1回风雪惊变" against "第1回 风雪惊变"). Use the label's spelling for the heading.
 */
function alignHeading(c: Chapter): Chapter {
  const first = c.blocks[0];
  if (c.title && first && first.t === 'h' && first.text !== c.title && squash(first.text) === squash(c.title)) {
    return { title: c.title, blocks: [{ ...first, text: c.title }, ...c.blocks.slice(1)] };
  }
  return c;
}

/**
 * Cut the documents into chapters at the table-of-contents entries. With no usable entries a
 * document is a chapter, unless it plainly holds several (第一章, 第二章 ...).
 */
export function chaptersFromSpine(docs: SpineDoc[], toc: TocRef[]): Chapter[] {
  interface Start {
    doc: number;
    block: number;
    title: string;
  }
  let starts: Start[] = [];
  for (const e of toc) {
    const d = docs[e.doc];
    if (!d || d.skipped) continue;
    const at = e.frag ? (d.anchors.get(e.frag) ?? 0) : 0;
    starts.push({ doc: e.doc, block: Math.min(at, d.blocks.length), title: e.title });
  }
  starts.sort((a, b) => a.doc - b.doc || a.block - b.block);
  starts = starts.filter((s, i) => !(i + 1 < starts.length && starts[i + 1].doc === s.doc && starts[i + 1].block === s.block));

  const slice = (fromDoc: number, fromBlock: number, toDoc: number, toBlock: number): Block[] => {
    const out: Block[] = [];
    for (let d = fromDoc; d <= toDoc && d < docs.length; d++) {
      const s = d === fromDoc ? fromBlock : 0;
      const e = d === toDoc ? toBlock : docs[d].blocks.length;
      out.push(...docs[d].blocks.slice(s, e));
    }
    return out;
  };

  const chapters: Chapter[] = [];
  const fromDoc = (d: number) => {
    const blocks = docs[d].blocks;
    if (blocks.length) chapters.push({ title: firstHeading(blocks), blocks });
  };
  if (!starts.length) {
    for (let d = 0; d < docs.length; d++) fromDoc(d);
    return chapters.flatMap(splitAtChapterHeadings);
  }
  for (let d = 0; d < starts[0].doc; d++) fromDoc(d);
  if (starts[0].block > 0) {
    const blocks = docs[starts[0].doc].blocks.slice(0, starts[0].block);
    chapters.push({ title: firstHeading(blocks), blocks });
  }
  starts.forEach((s, k) => {
    const next = starts[k + 1];
    const blocks = next ? slice(s.doc, s.block, next.doc, next.block) : slice(s.doc, s.block, docs.length - 1, Infinity);
    chapters.push(alignHeading({ title: s.title || firstHeading(blocks), blocks }));
  });
  return chapters;
}

/**
 * A first page that only repeats the book's title and author ("天龙八部" over "原著：金庸") is not a
 * chapter. It is dropped when other chapters follow. So is a printed title page around them, as Project Gutenberg keeps it:
 * "Marianela / Por / Benito Pérez Galdós / Imprenta y Litografía de La Guirnalda / Madrid / 1878" (short lines that end no
 * sentence, and a year), as long as the title or the author is one of its lines.
 */
export function dropTitlePage(chapters: Chapter[], title: string, author: string): Chapter[] {
  const first = chapters[0];
  if (!first || chapters.length < 2 || first.blocks.length > 10) return chapters;
  if (first.blocks.some((b) => b.t === 'img' || b.t === 'quote')) return chapters;
  if (first.blocks.reduce((n, b) => n + countHan(blockText(b)), 0) > 40 * unitScale()) return chapters;
  const names = [title, ...author.split(/,\s*/)].map(squash).filter(Boolean);
  const known = (t: string) => {
    const bare = squash(cleanAuthorName(t) || t);
    return !!bare && names.some((n) => n === bare || (bare.length >= 2 && (n.includes(bare) || bare.includes(n))));
  };
  // The first rule as it was: a page of nothing but the title and the author, matched as written.
  const texts = first.blocks.filter((b) => b.t !== 'hr').map(blockText);
  if (!texts.length) return chapters;
  if (texts.length <= 4 && texts.every(known)) return chapters.slice(1);
  // A printed title page sets them in capitals ("MARIANELA / POR / B. PEREZ GALDÓS."): from here case does not count.
  const lower = (t: string) => squash(t).toLocaleLowerCase();
  const knownAnyCase = (t: string) => known(t) || names.some((n) => { const a = n.toLocaleLowerCase(); const b = lower(cleanAuthorName(t) || t); return !!b && (a === b || (b.length >= 2 && (a.includes(b) || b.includes(a)))); });
  const YEAR = /^\d{3,4}\s*[.年]?$/;
  const letters = (t: string) => t.replace(/[^\p{L}]/gu, '');
  const capitals = (t: string) => { const l = letters(t); return l.length >= 2 && l === l.toLocaleUpperCase() && l !== l.toLocaleLowerCase(); };
  // A line of a title page: short and ends no sentence, or in capitals, or an address with its number ("calle de las Pozas,
  // núm. 12."), or a year.
  const furniture = (t: string) => {
    const x = t.trim();
    return YEAR.test(x) || (x.length <= 60 && (!/[.!?;。！？；…]["”’»」』]?$/.test(x) || capitals(x) || (/\d/.test(x) && x.length <= 40)));
  };
  // What only a title page has, so a short first poem headed with the book's title is never taken for one: the author, a year,
  // a credit or a publisher.
  const authors = author.split(/,\s*/).map(lower).filter((n) => n.length >= 2);
  const printed = (t: string) => authors.some((a) => lower(t).includes(a)) || YEAR.test(t.trim())
    || /^(?:(?:produced by|by|por|par|von|di|от)\b|(?:著|作者|譯|译)\s*[:：]?)|imprenta|editorial|librer[ií]a|verlag|[ée]ditions?|edizioni|editora|издани|出版|書局|书局/i.test(t.trim());
  return texts.some(knownAnyCase) && texts.some(printed) && texts.every((t) => knownAnyCase(t) || furniture(t)) ? chapters.slice(1) : chapters;
}

/** Headings of a contents page, in the languages the app reads. */
const CONTENTS = /^(?:contents|table of contents|índice|indice|capítulos|capitulos|sumario|sumário|chapitres|table des matières|table|sommaire|inhalt|inhaltsverzeichnis|sommario|содержание|оглавление|目录|目錄|目次|もくじ)\s*[:.：]?$/i;

/**
 * A contents page kept as a chapter of its own (Project Gutenberg's "Capítulos: -I-, -II-, …"): a chapter near the start or
 * the end whose lines are the other chapters' titles, or which is headed as a contents page and is all short lines. The
 * reader has its own contents, so this one only stands between the reader and the first page.
 */
export function dropContentsPages(chapters: Chapter[]): Chapter[] {
  if (chapters.length < 3) return chapters;
  const norm = (t: string) => t.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const isContents = (c: Chapter, i: number): boolean => {
    const lines = c.blocks.filter((b) => b.t !== 'hr').map((b) => blockText(b).trim()).filter(Boolean);
    if (lines.length < 3 || lines.some((l) => l.length > 120) || c.blocks.some((b) => b.t === 'img')) return false;
    const head = CONTENTS.test(c.title.trim()) || CONTENTS.test(lines[0]);
    const others = chapters.filter((_, k) => k !== i).map((o) => norm(o.title)).filter(Boolean);
    const named = lines.filter((l) => {
      const n = norm(l);
      return !!n && others.some((o) => o === n || o.startsWith(`${n} `) || n.startsWith(`${o} `));
    }).length;
    return named >= Math.max(3, (lines.length - (head ? 1 : 0)) * 0.6) || (head && lines.slice(1).every((l) => l.length <= 80));
  };
  return chapters.filter((c, i) => !((i < 3 || i >= chapters.length - 2) && isContents(c, i)));
}
