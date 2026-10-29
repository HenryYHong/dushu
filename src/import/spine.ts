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
 * A first page that only repeats the book's title and author ("射雕英雄传" over "原著：金庸") is not a
 * chapter. It is dropped when other chapters follow.
 */
export function dropTitlePage(chapters: Chapter[], title: string, author: string): Chapter[] {
  const first = chapters[0];
  if (!first || chapters.length < 2 || first.blocks.length > 4) return chapters;
  if (first.blocks.some((b) => b.t === 'img' || b.t === 'quote')) return chapters;
  if (first.blocks.reduce((n, b) => n + countHan(blockText(b)), 0) > 40 * unitScale()) return chapters;
  const names = [title, ...author.split(/,\s*/)].map(squash).filter(Boolean);
  const known = (t: string) => {
    const bare = squash(cleanAuthorName(t) || t);
    return !!bare && names.some((n) => n === bare || (bare.length >= 2 && (n.includes(bare) || bare.includes(n))));
  };
  const texts = first.blocks.filter((b) => b.t !== 'hr').map(blockText);
  return texts.length > 0 && texts.every(known) ? chapters.slice(1) : chapters;
}
