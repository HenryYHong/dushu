// What an imported book is checked against in the import suite: the text it must hold, in order, its chapters and paragraphs.
import type { Block, ImportedBook } from '../../../src/types';

export interface Expect {
  /** The import fails with a message matching this. */
  error?: RegExp;
  title?: string;
  author?: string;
  script?: ImportedBook['script'];
  /** The encoding decodeText picks (text files). */
  encoding?: string;
  /** Chapter titles, in order (chapters that continue a cut one are not counted). */
  chapters?: string[];
  /** Every heading and paragraph, in order. Spaces, colons and full-width digits are not compared. */
  content?: string[];
  /** Text the importer may add that `content` does not have (a sign-off line). */
  allowExtra?: string[];
  /** The paragraphs, for counting how many come out exactly as they are. */
  paras?: string[];
  /** The share of `paras` that must come out exactly (default 0.97). */
  paraShare?: number;
  /** Each paragraph is a line of verse that must stay a block of its own. */
  verse?: boolean;
  /** Pictures in the text, and whether there is a cover. */
  imgs?: number;
  cover?: boolean;
  /** The import's warnings (characters that could not be read). */
  warnings?: RegExp[];
  /** Spaces between Chinese characters that the source itself has (a Gutenberg file's "； "). */
  sourceSpaces?: number;
}

const squash = (s: string) => s.replace(/[\s\u3000\u200b]+/g, '');
/** For comparing: no spaces, no colons, ASCII digits. */
export const norm = (s: string) => squash(s).replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10)).replace(/[：:]/g, '');

const textOf = (b: Block): string => (b.t === 'p' || b.t === 'h' || b.t === 'quote' ? b.text : '');
const isText = (b: Block) => b.t === 'p' || b.t === 'h' || b.t === 'quote';

/** Radicals and vertical punctuation forms: a PDF's glyph names that should have become characters. */
const ODD = /[\u2e80-\u2fdf\ufe10-\ufe19\ufe30-\ufe4f]/gu;
/** A space between two Chinese characters or marks inside a paragraph (in the expected text, a wide space counts too). */
const STRAY_SPACE = /[\u3400-\u9fff，。、；：！？「」『』] +(?=[\u3400-\u9fff，。、；：！？「」『』])/gu;
const WANTED_SPACE = /[\u3400-\u9fff，。、；：！？「」『』][ \u3000]+(?=[\u3400-\u9fff，。、；：！？「」『』])/gu;

/** Where two texts first differ, with a little of each, or null when they are the same. */
function firstDifference(want: string, got: string): string | null {
  if (want === got) return null;
  let i = 0;
  while (i < want.length && i < got.length && want[i] === got[i]) i++;
  return `at ${i}: want ${JSON.stringify(want.slice(Math.max(0, i - 8), i + 24))} got ${JSON.stringify(got.slice(Math.max(0, i - 8), i + 24))}`;
}

/** Everything wrong with a book against what was expected (an empty list when it is right). */
export function problems(book: ImportedBook, e: Expect, encoding?: string): string[] {
  const out: string[] = [];
  if (e.title !== undefined && squash(book.title) !== squash(e.title)) out.push(`title ${JSON.stringify(book.title)}, want ${JSON.stringify(e.title)}`);
  if (e.author !== undefined && squash(book.author) !== squash(e.author)) out.push(`author ${JSON.stringify(book.author)}, want ${JSON.stringify(e.author)}`);
  if (e.script && book.script !== e.script) out.push(`script ${book.script}, want ${e.script}`);
  if (e.encoding && encoding !== e.encoding) out.push(`encoding ${encoding}, want ${e.encoding}`);
  const titled = book.chapters.filter((c) => !c.cont);
  if (e.chapters) {
    const got = titled.map((c) => norm(c.title));
    const want = e.chapters.map(norm);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      out.push(`chapters ${JSON.stringify(titled.map((c) => c.title).slice(0, 12))}, want ${JSON.stringify(e.chapters.slice(0, 12))}`);
    }
  }
  const blocks = book.chapters.flatMap((c) => c.blocks);
  const all = blocks.filter(isText).map(textOf);
  if (e.content) {
    let got = norm(all.join(''));
    for (const x of e.allowExtra ?? []) got = got.split(norm(x)).join('');
    const diff = firstDifference(norm(e.content.join('')), got);
    if (diff) out.push(`text differs ${diff}`);
  }
  const odd = all.join('').match(ODD);
  if (odd) out.push(`${odd.length} radicals or vertical forms left (${[...new Set(odd)].slice(0, 6).join(' ')})`);
  const paraTexts = blocks.filter((b) => b.t === 'p' || b.t === 'quote').map(textOf);
  const stray = paraTexts.join('\n').match(STRAY_SPACE)?.length ?? 0;
  const strayWanted = (e.paras ?? e.content ?? []).join('\n').match(WANTED_SPACE)?.length ?? 0;
  if (stray - strayWanted - (e.sourceSpaces ?? 0) > 3) out.push(`${stray - strayWanted} stray spaces between Chinese characters`);
  if (e.paras) {
    const have = new Map<string, number>();
    for (const p of paraTexts) have.set(squash(p), (have.get(squash(p)) ?? 0) + 1);
    let exact = 0;
    for (const p of e.paras) {
      const k = squash(p);
      if ((have.get(k) ?? 0) > 0) {
        have.set(k, have.get(k)! - 1);
        exact++;
      }
    }
    if (exact < e.paras.length * (e.paraShare ?? 0.97)) out.push(`paragraphs: ${exact} of ${e.paras.length} exact (${paraTexts.length} in the book)`);
  }
  if (e.verse) {
    const lines = new Set(blocks.filter(isText).map((b) => squash(textOf(b))));
    const merged = (e.paras ?? []).filter((l) => !lines.has(squash(l)));
    if (merged.length) out.push(`${merged.length} verse lines not kept as lines, e.g. ${JSON.stringify(merged.slice(0, 2))}`);
  }
  if (e.imgs !== undefined) {
    const n = blocks.filter((b) => b.t === 'img').length;
    if (n !== e.imgs) out.push(`${n} pictures in the text, want ${e.imgs}`);
  }
  if (e.cover && !book.cover) out.push('no cover');
  if (e.warnings) {
    const w = book.warnings ?? [];
    if (w.length !== e.warnings.length || e.warnings.some((re, i) => !re.test(w[i]))) out.push(`warnings ${JSON.stringify(w)}`);
  } else if (book.warnings?.length) out.push(`unexpected warnings ${JSON.stringify(book.warnings)}`);
  return out;
}
