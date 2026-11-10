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

/** Words that open a label naming a part of a book, not a sentence ("Part One. Chapter 1."). */
const LABEL_WORD = /^(?:part|book|volume|chapter|chapitre|cap[ií]tulo|capitolo|kapitel|teil|parte|partie|livre|libro|livro|buch|tome|глава|часть|книга|том)\b/iu;

/**
 * The first heading of a chapter often repeats the table-of-contents label with the spaces
 * squeezed out ("第1回风雪惊变" against "第1回 风雪惊变"). Use the label's spelling for the heading.
 * A label that is a picture's caption followed by the heading ("I hope Mr. Bingley will like it. CHAPTER II.", from Gutenberg's
 * illustrated editions) gives way to the heading: the caption is a sentence of three words or more before it. A label that
 * numbers the chapter before its name ("Chapter 1. The Beginning") is kept as it is.
 */
function alignHeading(c: Chapter): Chapter {
  const first = c.blocks[0];
  if (!c.title || !first || first.t !== 'h' || first.text === c.title) return c;
  if (squash(first.text) === squash(c.title)) return { title: c.title, blocks: [{ ...first, text: c.title }, ...c.blocks.slice(1)] };
  const label = squash(c.title).toLocaleLowerCase();
  const head = squash(first.text).toLocaleLowerCase();
  if (head && label.length > head.length && label.endsWith(head)) {
    // The label's words before the heading, as written.
    let left = label.length - head.length;
    let cut = 0;
    while (cut < c.title.length && left > 0) {
      if (!/[\s　]/.test(c.title[cut])) left--;
      cut++;
    }
    const prefix = c.title.slice(0, cut).trim();
    if (/[.!?"”]$/.test(prefix) && prefix.split(/\s+/).length >= 3 && /\p{Ll}/u.test(prefix) && !LABEL_WORD.test(prefix)) {
      return { title: first.text, blocks: c.blocks };
    }
  }
  return c;
}

/** A heading that is only a chapter's number: "IV", "12.", "Capítulo IV", "Глава 3", "第三章". */
const CHAPTER_NUMBER = /^(?:[IVXLCDM]{1,8}|\d{1,4})\.?$|^(?:cap[ií]tulo|chapter|chapitre|kapitel|capitolo|глава)\s+(?:[IVXLCDM]{1,8}|\d{1,4})\.?$|^第\s*[0-9〇零一二三四五六七八九十百千]+\s*[章回]$/iu;

/** A heading's text with its chapter number put in front: "IV. Um dever amarissimo!", "第三章 风雪". */
function numbered(num: string, text: string): string {
  const n = num.trim();
  if (/^第/.test(n)) return `${n} ${text}`;
  return /[.:]$/.test(n) ? `${n} ${text}` : `${n}. ${text}`;
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

  // A chapter's number set as a heading of its own just before the heading the contents point at (Dom Casmurro: a rule, "IV",
  // then "Um dever amarissimo!"): it is this chapter's, not the end of the one before. It joins this chapter's heading, and the
  // rule before it goes with it. `cut` is where the chapter before ends.
  const cuts = starts.map((s, k) => {
    const prev = starts[k - 1];
    const floor = prev && prev.doc === s.doc ? prev.block + 1 : 0;
    const blocks = docs[s.doc].blocks;
    const num = blocks[s.block - 1];
    const own = blocks[s.block];
    if (s.block - 1 < floor || num?.t !== 'h' || own?.t !== 'h' || !CHAPTER_NUMBER.test(num.text.trim())) return { cut: s.block, num: '' };
    let cut = s.block - 1;
    if (cut - 1 >= floor && blocks[cut - 1].t === 'hr') cut--;
    return { cut, num: num.text.trim() };
  });

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
  if (cuts[0].cut > 0) {
    const blocks = docs[starts[0].doc].blocks.slice(0, cuts[0].cut);
    chapters.push({ title: firstHeading(blocks), blocks });
  }
  starts.forEach((s, k) => {
    const next = starts[k + 1];
    const blocks = next ? slice(s.doc, s.block, next.doc, cuts[k + 1].cut) : slice(s.doc, s.block, docs.length - 1, Infinity);
    const chapter = alignHeading({ title: s.title || firstHeading(blocks), blocks });
    const head = chapter.blocks[0];
    const { num } = cuts[k];
    if (num && head?.t === 'h') {
      // The heading and the title it gives the chapter both carry the number: "IV. Um dever amarissimo!".
      const text = numbered(num, head.text);
      chapters.push({ title: squash(chapter.title) === squash(head.text) ? text : chapter.title, blocks: [{ ...head, text }, ...chapter.blocks.slice(1)] });
      return;
    }
    chapters.push(chapter);
  });
  return chapters;
}

/** A line that credits who made the e-text: "Produced by Rick Davis", "E-text prepared by …", "Digitized by …". */
const CREDIT = /^(?:e-?text\s+)?(?:produced|prepared|transcribed|digiti[sz]ed|scanned)\s+by\b/i;

/**
 * A first page that only repeats the book's title and author ("天龙八部" over "原著：金庸") is not a
 * chapter. It is dropped when other chapters follow. So is a printed title page around them, as Project Gutenberg keeps it:
 * "Marianela / Por / Benito Pérez Galdós / Imprenta y Litografía de La Guirnalda / Madrid / 1878" (short lines that end no
 * sentence, and a year), as long as the title or the author is one of its lines, and a page that only credits who made the
 * e-text ("Produced by Rick Davis"). A book can open on more than one such page (Madame Bovary: the author, then the title
 * page), so up to three go.
 */
export function dropTitlePage(chapters: Chapter[], title: string, author: string): Chapter[] {
  let out = chapters;
  for (let pass = 0; pass < 3; pass++) {
    const next = dropOneTitlePage(out, title, author);
    if (next === out) break;
    out = next;
  }
  return out;
}

function dropOneTitlePage(chapters: Chapter[], title: string, author: string): Chapter[] {
  const first = chapters[0];
  if (!first || chapters.length < 2) return chapters;
  const all = first.blocks.filter((b) => b.t !== 'hr' && b.t !== 'img').map((b) => blockText(b).trim()).filter(Boolean);
  if (all.length && all.length <= 4 && !first.blocks.some((b) => b.t === 'img') && all.every((t) => CREDIT.test(t) && t.length <= 120)) return chapters.slice(1);
  // A contents heading closing the page ("Indice", "Table des matières"): the page is judged without it. What follows it, a
  // picture or a chapter's number, goes on to the next chapter; a list of short lines after it (the contents) goes with it.
  const cut = first.blocks.findIndex((b) => b.t !== 'img' && b.t !== 'hr' && CONTENTS.test(blockText(b).trim()));
  const page = cut > 0 ? first.blocks.slice(0, cut) : first.blocks;
  const rest = cut > 0 ? first.blocks.slice(cut + 1) : [];
  if (rest.some((b) => (b.t === 'p' || b.t === 'quote') && blockText(b).length > 160)) return chapters;
  if (page.filter((b) => b.t !== 'hr').length > 16) return chapters;
  if (page.some((b) => b.t === 'quote')) return chapters;
  // One picture, as the last thing on the page (a frontispiece), and no other.
  const pictures = page.filter((b) => b.t === 'img');
  const last = page.filter((b) => b.t !== 'hr').pop();
  if (pictures.length > 1 || (pictures.length === 1 && last !== pictures[0])) return chapters;
  if (page.reduce((n, b) => n + countHan(blockText(b)), 0) > 80 * unitScale()) return chapters;
  const names = [title, ...author.split(/,\s*/)].map(squash).filter(Boolean);
  // A line that is the title or an author, holds one ("El ingenioso hidalgo don Quijote de la Mancha" for "Don Quijote"), or is
  // part of one. Case counts only for a part shorter than four letters (a capital "TO" is not "Stoker").
  const folded = names.map((n) => n.toLocaleLowerCase());
  const known = (t: string) => {
    const bare = squash(cleanAuthorName(t) || t);
    const low = bare.toLocaleLowerCase();
    return !!bare && (names.some((n) => n === bare || (bare.length >= 2 && (n.includes(bare) || bare.includes(n))))
      || folded.some((n) => n === low || (low.length >= 4 && (n.includes(low) || (n.length >= 4 && low.includes(n))))));
  };
  // What follows the cut that the book still needs: pictures and a chapter's number, at the head of the next chapter (after
  // its heading, so the reader does not title the chapter twice).
  const drop = (): Chapter[] => {
    const kept = rest.filter((b) => b.t === 'img' || (b.t === 'h' && CHAPTER_NUMBER.test(b.text.trim())));
    if (!kept.length) return chapters.slice(1);
    const [next, ...others] = chapters.slice(1);
    const at = next.blocks[0]?.t === 'h' ? 1 : 0;
    return [{ ...next, blocks: [...next.blocks.slice(0, at), ...kept, ...next.blocks.slice(at)] }, ...others];
  };
  // The first rule as it was: a page of nothing but the title and the author, matched as written.
  const texts = page.filter((b) => b.t !== 'hr' && b.t !== 'img').map(blockText);
  if (!texts.length) return chapters;
  if (texts.length <= 4 && texts.every(known)) return drop();
  // A printed title page sets them in capitals ("MARIANELA / POR / B. PEREZ GALDÓS."): from here case does not count, but only
  // for a whole line or whole words (a capital "TO" is not "Stoker").
  const lower = (t: string) => squash(t).toLocaleLowerCase();
  const words = (t: string) => ` ${lower(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const knownAnyCase = (t: string) => known(t) || names.some((n) => {
    const line = words(cleanAuthorName(t) || t).trim();
    const name = words(n).trim();
    return !!line && (line === name || (line.length >= 4 && (words(n).includes(` ${line} `) || words(t).includes(` ${name} `))));
  });
  // A year in figures, also in brackets ("(1857)").
  const YEAR = /^\(?\d{3,4}\)?\s*[.年]?$/;
  const letters = (t: string) => t.replace(/[^\p{L}]/gu, '');
  // In capitals: two letters running somewhere (initials such as "L.F.B." are a signature, not a line of capitals).
  const capitals = (t: string) => { const l = letters(t); return /\p{L}{2}/u.test(t) && l === l.toLocaleUpperCase() && l !== l.toLocaleLowerCase(); };
  // A line of a title page: short and ends no sentence, or in capitals, or an address with its number ("calle de las Pozas,
  // núm. 12."), or a year.
  const furniture = (t: string) => {
    const x = t.trim();
    return YEAR.test(x) || (x.length <= 60 && (!/[.!?;。！？；…]["”’»」』]?$/.test(x) || capitals(x) || (/\d/.test(x) && x.length <= 40)));
  };
  // What only a title page has, so a short first poem headed with the book's title is never taken for one: the author, a year,
  // a credit or a publisher. "By", "Por" and the like count only as a line of their own: a line of verse can open with them
  // ("Par les soirs bleus d'été", "От бурь ища покоя"). A Chinese credit needs its colon (作者的话 is the author speaking).
  const authors = author.split(/,\s*/).map(lower).filter((n) => n.length >= 2);
  // A year counts as printed in figures alone ("1878"); "1934年" is as likely a date in a preface. A short line with a year
  // from 1500 to 1999 in it is an imprint ("12 — 1902. — Tip. di Salvadore Landi, Firenze."), and so is one that names a
  // publisher or a copyright, with or without its full stop ("R. Bemporad & Figlio — Editori.").
  const printed = (t: string) => {
    const x = t.trim();
    return authors.some((a) => lower(x).includes(a)) || /^\(?\d{3,4}\)?\.?$/.test(x) || CREDIT.test(x)
      || /^(?:by|por|par|von|di|от)$/i.test(x) || /^(?:作者|著者?|譯者?|译者?)\s*[:：]/.test(x)
      || /imprenta|editorial|librer[ií]a|verlag|[ée]ditions?|edizioni|издани|出版社|書局|书局/i.test(x)
      || (x.length <= 80 && (/(?:^|\D)1[5-9]\d\d(?![\d年])/.test(x) || /editori\b|editora|\beditor\b|livreiro|copyright|propriet[àa] letteraria|gedruckt/i.test(x)));
  };
  // A dedication is the author's own page, kept whatever else is on it (Oz: "This book is dedicated to my good friend & comrade
  // / My Wife / L.F.B.").
  const dedication = (t: string) => /dedicat|d[ée]di[ée]|gewidmet|посвящ|献给|獻給|谨以|謹以/i.test(t) || (!knownAnyCase(t) && /^(?:to|à|для)(?:\s|$)/i.test(t.trim()));
  if (texts.some(dedication)) return chapters;
  return texts.some(knownAnyCase) && texts.some(printed) && texts.every((t) => knownAnyCase(t) || furniture(t) || printed(t)) ? drop() : chapters;
}

/** Headings of a contents page, in the languages the app reads. */
export const CONTENTS = /^(?:contents|table of contents|índice|indice|capítulos|capitulos|sumario|sumário|chapitres|table des matières|table|sommaire|inhalt|inhaltsverzeichnis|sommario|содержание|оглавление|目录|目錄|目次|もくじ)\s*[:.：]?$/i;

/** A number set before a chapter's name, once punctuation is gone and case is folded: "capítulo primero", "chapter ii", "iv". */
const NUMBER_PREFIX = new RegExp(String.raw`^(?:(?:cap[ií]tulo|chapter|chapitre|capitolo|kapitel|глава|part|parte|partie|libro|livre|livro|book|teil|buch)\s+)?(?:[ivxlcdm]+|\d+|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|premier|première|first|second|third)\s+`, 'u');

/** A word of a squashed contents list: a chapter number in Roman or Arabic figures. */
const NUMBER_WORD = /^(?:[IVXLCDM]+|\d+)[.,]?$/;

/**
 * A title made of the contents run together ("PREMIÈRE PARTIE I II III … DEUXIÈME PARTIE I …", Madame Bovary's contents label
 * for its dedication): six words or more, at least 80% of them chapter numbers or other chapters' titles.
 */
function squashedContents(text: string, others: string[][]): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 6) return false;
  let matched = 0;
  for (let t = 0; t < words.length;) {
    if (NUMBER_WORD.test(words[t])) { matched++; t++; continue; }
    let best = 0;
    for (const o of others) if (o.length > best && o.length < words.length && o.every((w, j) => words[t + j] === w)) best = o.length;
    matched += best;
    t += best || 1;
  }
  return matched >= words.length * 0.8;
}

/**
 * A title for a chapter whose label was the contents run together: its first heading when it opens with one, else its first
 * short lines ("À" and "Marie-Antoine-Jules Senard": "À Marie-Antoine-Jules Senard").
 */
export function titleFromText(blocks: Block[]): string {
  const first = blocks.find((b) => b.t !== 'hr' && b.t !== 'img');
  if (first?.t === 'h' && first.text.length <= 80) return first.text.trim();
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.t === 'hr' || b.t === 'img') continue;
    const t = blockText(b).trim();
    if (b.t !== 'p' || t.length > 40 || lines.length >= 3) break;
    lines.push(t);
    if (lines.join('').replace(/[^\p{L}]/gu, '').length >= 8) break;
  }
  const joined = lines.join(' ');
  return joined.replace(/[^\p{L}]/gu, '').length >= 4 && joined.length <= 80 ? joined : '';
}

/**
 * Chapters titled, or headed, with the contents run together lose that heading and are titled from their own text. The title
 * is never cut short: real titles run long (Pinocchio's to 191 characters).
 */
function untangleSquashedTitles(chapters: Chapter[]): Chapter[] {
  const labels = chapters.map((c) => c.title.trim().split(/\s+/).filter(Boolean));
  let changed = false;
  const out = chapters.map((c, i) => {
    const others = labels.filter((l, k) => k !== i && l.length > 0);
    const head = c.blocks[0]?.t === 'h' ? c.blocks[0].text : '';
    const titleSquashed = squashedContents(c.title, others);
    const headSquashed = !!head && (squashed(head) === squashed(c.title) ? titleSquashed : squashedContents(head, others));
    if (!titleSquashed && !headSquashed) return c;
    changed = true;
    const blocks = headSquashed ? c.blocks.slice(1) : c.blocks;
    return { ...c, title: titleSquashed ? titleFromText(blocks) || `Section ${i + 1}` : c.title, blocks };
  });
  return changed ? out : chapters;
}
const squashed = (t: string) => squash(t).toLocaleLowerCase();

/**
 * A contents page kept as a chapter of its own (Project Gutenberg's "Capítulos: -I-, -II-, …"): a chapter near the start or
 * the end whose lines are the other chapters' titles, or which is headed as a contents page and is all short lines. The
 * reader has its own contents, so this one only stands between the reader and the first page. A contents list made of links
 * goes before this, in the EPUB reader (epub.ts dropLinkedRuns); this is for one in plain lines. A line names a chapter when it
 * is the chapter's title or its end ("Que trata de …" for "Capítulo primero. Que trata de …"), a number before it aside.
 */
export function dropContentsPages(input: Chapter[]): Chapter[] {
  const chapters = untangleSquashedTitles(input);
  if (chapters.length < 3) return chapters;
  const norm = (t: string) => t.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const isContents = (c: Chapter, i: number): boolean => {
    const lines = c.blocks.filter((b) => b.t !== 'hr' && b.t !== 'img').map((b) => blockText(b).trim()).filter(Boolean);
    // Mostly short lines: a few entries run long ("Que trata de la condición y ejercicio del famoso hidalgo …").
    if (lines.length < 3 || lines.filter((l) => l.length <= 160).length < lines.length * 0.8) return false;
    const head = CONTENTS.test(c.title.trim()) || CONTENTS.test(lines[0]);
    const others = chapters.filter((_, k) => k !== i).map((o) => norm(o.title)).filter(Boolean);
    const named = lines.filter((l) => {
      const n = norm(l);
      if (!n) return false;
      const bare = n.replace(NUMBER_PREFIX, '');
      return others.some((o) => o === n || o.startsWith(`${n} `) || n.startsWith(`${o} `)
        || (bare.length >= 8 && (o === bare || o.endsWith(` ${bare}`))));
    }).length;
    return named >= Math.max(3, (lines.length - (head ? 1 : 0)) * 0.6) || (head && lines.slice(1).every((l) => l.length <= 80));
  };
  return chapters.filter((c, i) => !((i < 3 || i >= chapters.length - 2) && isContents(c, i)));
}
