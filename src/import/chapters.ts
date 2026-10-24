// Plain text to blocks, hard-wrap joining, chapter heading detection and chapter assembly.
// Shared by the TXT, PDF, HTML, Markdown and EPUB importers.
import type { Block, Chapter } from '../types';
import { isBoilerplateLine } from './boilerplate';
import { countHan } from './han';
import { normalizeNewlines } from './encoding';

/** Target size of a section when a text has no chapter markers. */
export const PART_HAN = 4000;
/** A chapter with more Han characters than this is split further. The reader lays a chapter out a few pages at a time, so
 * this only guards against a whole book in one file; a long real chapter (some novels have 40,000) stays whole. */
export const BIG_CHAPTER_HAN = 60000;
/** Size of the pieces an oversize chapter with no headings inside is cut into. */
export const BIG_PART_HAN = 12000;

// ------------------------------------------------------------------ basics ---

/** A paragraph longer than this is cut in pieces (splitLongParagraph). */
export const LONG_PARAGRAPH = 3000;

const HAN_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{3134f}]/u;
const SMALL_FORMS: Record<string, string> = { '﹐': '，', '﹑': '、', '﹒': '。', '﹔': '；', '﹕': '：', '﹖': '？', '﹗': '！' };
const HALF_TO_FULL: Record<string, string> = { ',': '，', ';': '；', ':': '：', '?': '？', '!': '！' };
const HAN_PUNCT_HAN = /([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{3134f}])([,;:?!])(?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{3134f}])/gu;

/**
 * Punctuation as Chinese text sets it: the small-form marks some editions use (﹐ ﹔ ﹖, drawn tiny and placed oddly) and an
 * ASCII , ; : ? ! between two Han characters (a typo in the source) become the full-width marks.
 */
export function normalizePunctuation(text: string): string {
  if (!/[\ufe50-\ufe57,;:?!]/.test(text)) return text;
  return text.replace(/[\ufe50-\ufe57]/g, (m) => SMALL_FORMS[m] ?? m).replace(HAN_PUNCT_HAN, (_, a: string, p: string) => a + HALF_TO_FULL[p]);
}

/**
 * Join paragraphs a file broke in the middle of a sentence, even in the middle of a word (a page break in the edition an
 * EPUB was made from; 998-character pieces in a Wikisource text). A paragraph of prose that ends on a Han character, or on
 * ， 、 when it is long, runs on into a following paragraph of prose that starts with one. Short lines are verse, headings
 * or list items and stay apart, and so do lines set out with spaces (a letter's signature). A paragraph that starts with a
 * closing mark (，。、；：！？」』) always joins the one before: no paragraph starts with one.
 */
export function joinSplitParagraphs(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let changed = false;
  for (const cur of blocks) {
    const prev = out[out.length - 1];
    if (prev?.t === 'p' && cur.t === 'p' && runsOn(prev.text, cur.text)) {
      out[out.length - 1] = { t: 'p', text: prev.text.trimEnd() + cur.text.trimStart() };
      changed = true;
    } else out.push(cur);
  }
  return changed ? out : blocks;
}

/** Marks that end a clause, a sentence or a quote. */
const CLOSING_START = /^[，。、；：！？」』]/;

function runsOn(a: string, b: string): boolean {
  if (CLOSING_START.test(b.trimStart())) return true;
  // Never past the length a long paragraph is cut at (splitLongParagraph): that cut is on purpose.
  if (a.length + b.length > LONG_PARAGRAPH) return false;
  const t = a.trimEnd();
  const n = [...t].length;
  const end = [...t].pop() ?? '';
  const prose = (HAN_CHAR.test(end) && n >= 40) || ((end === '，' || end === '、') && n >= 60);
  if (!prose || /[\s\u3000]/.test([...t].slice(-12).join(''))) return false;
  const next = b.trimStart();
  return [...next].length >= 20 && HAN_CHAR.test([...next][0] ?? '');
}

export function blockText(b: Block): string {
  return b.t === 'p' || b.t === 'h' || b.t === 'quote' ? b.text : '';
}
export function blockHan(b: Block): number {
  return countHan(blockText(b));
}
export function chapterHan(c: Chapter): number {
  let n = 0;
  for (const b of c.blocks) n += blockHan(b);
  return n;
}
export function totalHan(chapters: Chapter[]): number {
  let n = 0;
  for (const c of chapters) n += chapterHan(c);
  return n;
}
export function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
export function trimLine(s: string): string {
  return s.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
}

/** Site boilerplate that e-book sites append to files ("本书由 ePUBw.COM 整理 ..."). */
export function isSiteJunk(t: string): boolean {
  if (t.length > 160) return false;
  if (/epubw|z-?library|\b1lib\b|zlib\.|b-ok\.|anna.?s archive|libgen/i.test(t)) return true;
  if (
    /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|net|org|cn|cc|info)\b/i.test(t) &&
    /(下载|下載|整理|制作|製作|提供|论坛|論壇|小说|小說|电子书|電子書|txt|更多|欢迎|歡迎|推荐|推薦|扫描|掃描|校对|校對|精校|书友|書友|公众号|关注|手机阅读)/i.test(t)
  ) {
    return true;
  }
  if (/^[\s\p{P}\p{S}]*(?:本书|本書|本电子书|本電子書)(?:由|来自|來自|转自|轉自).{0,40}(?:整理|制作|製作|提供|分享|下载|下載)/u.test(t)) return true;
  return isBoilerplateLine(t);
}

const RULE_RE = /^[\s\u3000=\-_*~#＊※◇◆○●■□—─━＝]{3,}$/;
export function isRuleLine(t: string): boolean {
  return RULE_RE.test(t);
}

// ---------------------------------------------------------------- headings ---

const NUM = '[0-9０-９〇零一二三四五六七八九十百千万萬两兩壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]';
const WORDS = [
  '序章', '序言', '序幕', '序', '自序', '代序', '小序', '总序', '總序', '译序', '譯序', '后序', '後序', '楔子', '引子', '前言', '引言', '导言', '導言',
  '后记', '後記', '跋', '尾声', '尾聲', '终章', '終章', '最终章', '尾章', '番外篇', '番外', '附录', '附錄', '结语', '結語', '后语', '後語',
  '出版说明', '出版說明', '内容简介', '內容簡介', '内容提要', '內容提要', '作者简介', '作者簡介', '致谢', '致謝', '大结局', '大結局', '目录', '目錄',
].sort((a, b) => b.length - a.length);
const SEP = '(?=$|[\\s\\u3000：:、.．·\\-—，,（(【\\[「《])';
const NUMBERED = new RegExp(`^第\\s*${NUM}+\\s*[章回节節卷集部篇幕折场場话話]`);
const VOLUME_WORD = new RegExp(`^第\\s*${NUM}+\\s*[卷集部篇]`);
const VOLUME_PREFIX = new RegExp(`^[卷篇]\\s*${NUM}+${SEP}`);
const WORD_RE = new RegExp(`^(?:${WORDS.join('|')})[\\s\\u3000]*${NUM}*${SEP}`);
const MARKER_COLON = new RegExp(`^(第\\s*${NUM}+\\s*[章回节節卷集部篇幕折场場话話])\\s*[:：]\\s*`);
const LATIN_CHAPTER = /^chapter\s+(?:\d+|[ivxlcdm]+\b|one\b|two\b|three\b|four\b|five\b|six\b|seven\b|eight\b|nine\b|ten\b)/i;

/** Is this single line a chapter heading? Level 1 for volumes (卷, 部, 集), 2 otherwise. */
export function detectHeadingLine(line: string): { level: 1 | 2 } | null {
  const t = trimLine(line);
  if (!t || cpLen(t) > 40) return null;
  if (/[。，；、]$/.test(t)) return null;
  if (VOLUME_WORD.test(t) || VOLUME_PREFIX.test(t)) return { level: 1 };
  if (NUMBERED.test(t) || WORD_RE.test(t) || LATIN_CHAPTER.test(t)) return { level: 2 };
  return null;
}

/**
 * Tidy a heading line: full-width digits become ASCII (第１回 to 第1回), runs of spaces become one,
 * and the colon some sites put after the marker goes (第一章：风雪 to 第一章 风雪).
 */
export function normalizeHeading(line: string): string {
  const t = line
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/\s+/g, ' ')
    .trim();
  const m = MARKER_COLON.exec(t);
  if (!m) return t;
  const rest = t.slice(m[0].length).trim();
  return rest ? `${m[1]} ${rest}` : m[1];
}

// -------------------------------------------------------------- hard wraps ---

const TERMINAL = /[。！？!?…”’」』）)；;.]$/;

/**
 * If most lines have nearly the same length and do not end in sentence punctuation, the file was
 * hard-wrapped at that width. Returns the width, or 0 if the lines look like whole paragraphs.
 */
export function detectWrapWidth(lines: string[]): number {
  const lens: number[] = [];
  for (const l of lines) {
    const n = cpLen(l);
    if (n >= 8) lens.push(n);
  }
  if (lens.length < 10) return 0;
  const hist = new Map<number, number>();
  for (const n of lens) hist.set(n, (hist.get(n) ?? 0) + 1);
  let width = 0;
  let count = 0;
  for (const w of hist.keys()) {
    const c = (hist.get(w) ?? 0) + (hist.get(w - 1) ?? 0) + (hist.get(w - 2) ?? 0);
    if (c > count || (c === count && w > width)) {
      width = w;
      count = c;
    }
  }
  if (width < 14 || count / lens.length < 0.35) return 0;
  let atWidth = 0;
  let terminal = 0;
  for (const l of lines) {
    const n = cpLen(l);
    if (n >= width - 2 && n <= width) {
      atWidth++;
      if (TERMINAL.test(l)) terminal++;
    }
  }
  return terminal / Math.max(atWidth, 1) > 0.6 ? 0 : width;
}

function joinPieces(a: string, b: string): string {
  if (/[A-Za-z0-9,.;:!?)]$/.test(a) && /^[A-Za-z0-9(]/.test(b)) return `${a} ${b}`;
  return a + b;
}

function joinable(prev: string, width: number): boolean {
  const n = cpLen(prev);
  return n >= width - 2 || (n >= width * 0.8 && !TERMINAL.test(prev));
}

/**
 * Turn raw lines into paragraphs. Blank lines end a paragraph; with a wrap width, a line that
 * nearly fills it continues into the next one unless the next one is indented (a new paragraph).
 * Heading and rule lines always stand alone.
 */
export function linesToParagraphs(rawLines: string[], width: number): string[] {
  const out: string[] = [];
  let cur = '';
  let prev = '';
  const flush = () => {
    if (cur) out.push(cur);
    cur = '';
  };
  for (const raw of rawLines) {
    const t = trimLine(raw);
    if (!t) {
      flush();
      prev = '';
      continue;
    }
    if (detectHeadingLine(t) || isRuleLine(t)) {
      flush();
      out.push(t);
      prev = '';
      continue;
    }
    const indent = /^(?:\u3000|\t| {2,})/.test(raw);
    if (cur && width && !indent && prev && joinable(prev, width)) cur = joinPieces(cur, t);
    else {
      flush();
      cur = t;
    }
    prev = t;
  }
  flush();
  return out;
}

/** Where a piece may end when a block has no sentence punctuation: after a comma, semicolon, colon, enumeration mark or space. */
const SOFT_BREAK = /[，,；;：:、\s\u3000]/;
const CLOSERS = /[”’」』）)》〉】〕\]]/;

/**
 * Cut one run of text that has no sentence end into pieces of about `chunk` code points. A piece ends at the
 * last comma, semicolon, colon or space in the second half of its window; with none there, it is cut at `chunk`.
 */
function hardSplit(text: string, chunk: number): string[] {
  const cps = Array.from(text);
  const out: string[] = [];
  let pos = 0;
  while (pos < cps.length) {
    if (cps.length - pos <= chunk) {
      out.push(cps.slice(pos).join(''));
      break;
    }
    let end = pos + chunk;
    for (let i = pos + chunk - 1; i >= pos + Math.floor(chunk / 2); i--) {
      if (SOFT_BREAK.test(cps[i])) {
        end = i + 1;
        break;
      }
    }
    while (end < cps.length && end - pos < chunk * 1.2 && CLOSERS.test(cps[end])) end++;
    out.push(cps.slice(pos, end).join(''));
    pos = end;
  }
  return out;
}

/**
 * Split a very long paragraph so the reader never gets one 100k-character block: at sentence ends first, and where a
 * sentence itself is longer than `max` (no punctuation at all, commas only, OCR text) at commas, semicolons or spaces,
 * else at a fixed length. A paragraph of `max` code points or fewer is left whole.
 */
export function splitLongParagraph(text: string, max = LONG_PARAGRAPH, chunk = 1500): string[] {
  if (cpLen(text) <= max) return [text];
  const sentences = text.match(/[^。！？!?…]*[。！？!?…]+[”’」』）)]*|[^。！？!?…]+$/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  const push = (piece: string) => {
    cur += piece;
    if (cpLen(cur) >= chunk) {
      out.push(cur);
      cur = '';
    }
  };
  for (const s of sentences) {
    if (cpLen(s) > max) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      for (const piece of hardSplit(s, chunk)) push(piece);
    } else push(s);
  }
  if (cur) out.push(cur);
  return out;
}

/** Pasted/TXT/Markdown-body text to blocks: paragraphs, headings by the chapter regex, rules. */
export function textToBlocks(text: string): Block[] {
  const lines = normalizeNewlines(text).split('\n');
  const prose = lines.map(trimLine).filter((l) => l && !detectHeadingLine(l) && !isRuleLine(l));
  return paragraphsToBlocks(linesToParagraphs(lines, detectWrapWidth(prose)));
}

/** "學而第一", "勸學篇第一": a classical section title, a name and its place in the book. */
const ORDINAL_TITLE = /^[\u3400-\u9fff]{1,6}第([〇零一二三四五六七八九十百]{1,4})$/u;

/**
 * Classical books name their sections "學而第一, 爲政第二 …" (論語, 莊子, 荀子). Such a line is a heading when the text opens
 * with the first one, or when two or more count up from 第一 in order; a stray "天下第一" in prose is neither.
 */
function markOrdinalTitles(blocks: Block[]): Block[] {
  const at: number[] = [];
  blocks.forEach((b, i) => {
    const m = b.t === 'p' ? ORDINAL_TITLE.exec(b.text) : null;
    if (m && numeralValue(m[1]) === at.length + 1) at.push(i);
  });
  if (!at.length || (at.length === 1 && at[0] !== 0)) return blocks;
  const out = blocks.slice();
  for (const i of at) out[i] = { t: 'h', level: 2, text: (blocks[i] as { text: string }).text };
  return out;
}

export function paragraphsToBlocks(paras: string[]): Block[] {
  const blocks: Block[] = [];
  for (const p of paras) {
    if (isSiteJunk(p)) continue;
    if (isRuleLine(p)) {
      if (blocks.length && blocks[blocks.length - 1].t !== 'hr') blocks.push({ t: 'hr' });
      continue;
    }
    const head = detectHeadingLine(p);
    if (head) {
      blocks.push({ t: 'h', level: head.level, text: normalizeHeading(p) });
      continue;
    }
    for (const piece of splitLongParagraph(p)) blocks.push({ t: 'p', text: piece });
  }
  while (blocks.length && blocks[blocks.length - 1].t === 'hr') blocks.pop();
  return markOrdinalTitles(blocks);
}

const DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** Value of a line that is only a number: 7, 十二, （三）, 四、 ... or null. */
export function numeralValue(text: string): number | null {
  const m = /^[（(【\[]?\s*([0-9]{1,3}|[零〇一二两兩三四五六七八九十]{1,3})\s*[)）】\]、.．]?$/.exec(text.trim());
  if (!m) return null;
  const s = m[1];
  if (/^[0-9]+$/.test(s)) return Number(s);
  if (s === '十') return 10;
  let r = /^十([一二三四五六七八九])$/.exec(s);
  if (r) return 10 + DIGIT[r[1]];
  r = /^([一二三四五六七八九])十([一二三四五六七八九])?$/.exec(s);
  if (r) return DIGIT[r[1]] * 10 + (r[2] ? DIGIT[r[2]] : 0);
  return s.length === 1 && s in DIGIT ? DIGIT[s] : null;
}

// ---------------------------------------------------------------- chapters ---

function isHead(b: Block): b is Extract<Block, { t: 'h' }> {
  return b.t === 'h';
}

/**
 * A table of contents typed into the text is a run of heading lines with nothing between them, and
 * each of its titles shows up again later as the real heading. Turning the run into headings would
 * make dozens of one-line chapters, so demote the repeated ones to paragraphs.
 */
function demoteContentsRuns(blocks: Block[]): Block[] {
  const out = blocks.slice();
  const key = (t: string) => t.replace(/[\s\u3000]+/g, '');
  const isChapterHead = (b: Block): b is Extract<Block, { t: 'h' }> => isHead(b) && !!detectHeadingLine(b.text);
  const lastSeen = new Map<string, number>();
  out.forEach((b, k) => {
    if (isHead(b)) lastSeen.set(key(b.text), k);
  });
  let i = 0;
  while (i < out.length) {
    if (!isChapterHead(out[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && isChapterHead(out[j])) j++;
    if (j - i >= 4) {
      for (let k = i; k < j; k++) {
        const b = out[k];
        if (isHead(b) && lastSeen.get(key(b.text))! > k) out[k] = { t: 'p', text: b.text };
      }
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

/** Indices where chapters start, choosing the most trustworthy signal. Mutates `blocks` when it promotes paragraphs. */
function boundaries(blocks: Block[]): number[] | null {
  const named: number[] = [];
  blocks.forEach((b, i) => {
    if (isHead(b) && detectHeadingLine(b.text)) named.push(i);
  });
  if (named.length >= 2) return named;

  const counts = new Map<number, number>();
  for (const b of blocks) if (isHead(b)) counts.set(b.level, (counts.get(b.level) ?? 0) + 1);
  let level = 0;
  for (let l = 1; l <= 6; l++) {
    if ((counts.get(l) ?? 0) >= 2) {
      level = l;
      break;
    }
  }
  const promoted: number[] = [];
  blocks.forEach((b, i) => {
    if (b.t === 'p' && detectHeadingLine(b.text)) promoted.push(i);
  });
  if (level) {
    const idx: number[] = [];
    blocks.forEach((b, i) => {
      if (isHead(b) && b.level <= level) idx.push(i);
    });
    // A few stray <h2> (a license header, a title page) beside many plain "第N章" lines: the lines are the chapters.
    if (!(promoted.length >= 3 && promoted.length > idx.length * 2)) return idx;
  }
  if (promoted.length >= 2) {
    for (const i of promoted) {
      const b = blocks[i];
      if (b.t === 'p') blocks[i] = { t: 'h', level: detectHeadingLine(b.text)!.level, text: b.text };
    }
    return promoted;
  }

  // Sections marked only by running numerals alone on a line: 一, 二, 三 ... (1, 2, 3 ...).
  const numbered: number[] = [];
  let expected = 1;
  blocks.forEach((b, i) => {
    if (b.t === 'p' && numeralValue(b.text) === expected) {
      numbered.push(i);
      expected++;
    }
  });
  if (numbered.length >= 3) {
    for (const i of numbered) {
      const b = blocks[i];
      if (b.t === 'p') blocks[i] = { t: 'h', level: 3, text: b.text.trim() };
    }
    // Bare numerals mark sections, not chapters: a short text (狂人日记, 13 sections in 5,000 characters) reads as one
    // chapter with its section numbers as headings, instead of a spread per section.
    const han = blocks.reduce((n, b) => n + blockHan(b), 0);
    if (han / numbered.length < SECTION_HAN) return [];
    return numbered;
  }
  return null;
}

/** Sections marked by bare numerals that average fewer Han characters than this stay in one chapter. */
const SECTION_HAN = 1500;

function headingText(b: Block): string {
  return isHead(b) ? b.text.replace(/\s+/g, ' ').trim() : '';
}

function cutAt(blocks: Block[], cuts: number[], firstTitle: string): Chapter[] {
  const out: Chapter[] = [];
  if (cuts[0] > 0) out.push({ title: firstTitle, blocks: blocks.slice(0, cuts[0]) });
  cuts.forEach((start, k) => {
    const end = k + 1 < cuts.length ? cuts[k + 1] : blocks.length;
    out.push({ title: headingText(blocks[start]), blocks: blocks.slice(start, end) });
  });
  return out;
}

/** Split blocks into parts of about `target` Han characters at paragraph boundaries. */
export function splitBySize(blocks: Block[], target = PART_HAN): Block[][] {
  const parts: Block[][] = [];
  let cur: Block[] = [];
  let acc = 0;
  for (const b of blocks) {
    cur.push(b);
    acc += blockHan(b);
    if (acc >= target) {
      // keep a heading with the text that follows it
      let carry: Block[] = [];
      while (cur.length > 1 && cur[cur.length - 1].t === 'h') carry.unshift(cur.pop()!);
      parts.push(cur);
      cur = carry;
      carry = [];
      acc = cur.reduce((n, x) => n + blockHan(x), 0);
    }
  }
  if (cur.length) {
    const last = parts[parts.length - 1];
    if (last && acc < target / 3) last.push(...cur);
    else parts.push(cur);
  }
  return parts;
}

/**
 * The title of a text kept as one chapter: its own first heading when it opens with one (第一回 …, 學而第一), as the reader
 * shows a chapter's first heading as its title (ARCHITECTURE.md 5.3); else the book's title. Section numerals (level 3) are not titles.
 */
function wholeTitle(blocks: Block[], title: string): string {
  const first = blocks[0];
  return first && isHead(first) && first.level <= 2 ? headingText(first) || title : title;
}

/**
 * Chapters for a flat run of blocks (TXT, pasted text, PDF, HTML, Markdown): by chapter-style
 * headings if there are any, else by heading level, else sections of about 4,000 characters.
 */
export function chaptersFromBlocks(input: Block[], opts: { title: string }): Chapter[] {
  const blocks = demoteContentsRuns(input);
  const cuts = boundaries(blocks);
  let chapters: Chapter[];
  if (cuts && !cuts.length) {
    chapters = [{ title: wholeTitle(blocks, opts.title), blocks }];
  } else if (cuts) {
    chapters = cutAt(blocks, cuts, opts.title);
  } else {
    const han = blocks.reduce((n, b) => n + blockHan(b), 0);
    if (han <= PART_HAN * 1.5) chapters = [{ title: wholeTitle(blocks, opts.title), blocks }];
    else chapters = splitBySize(blocks).map((p, i) => ({ title: `Part ${i + 1}`, blocks: p }));
  }
  return finalizeChapters(chapters).map((c) => {
    const blocks = markPoemTitles(c.blocks);
    return blocks === c.blocks ? c : { ...c, blocks };
  });
}

/** "靜夜思　李白": a title, a wide space and the poet's name. */
const POEM_TITLE = /^[\u3400-\u9fff]{1,12}[\u3000 ]+[\u3400-\u9fff]{2,4}$/u;
/** A line of verse: short clauses, each closed by a mark, the last by a full stop. */
const VERSE_LINE = /^(?:[\u3400-\u9fff]{1,9}[，、；：])+[\u3400-\u9fff]{1,9}[。！？]$/u;

/**
 * Poems typed as plain text set each title and its poet on a line of their own over the verse. Two or more such lines,
 * each followed by a line of verse, are headings (level 3) inside the chapter. They are marked after chapters are cut, so
 * an anthology stays one chapter instead of a chapter per poem.
 */
function markPoemTitles(blocks: Block[]): Block[] {
  const at: number[] = [];
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    if (b.t === 'p' && POEM_TITLE.test(b.text) && next?.t === 'p' && VERSE_LINE.test(next.text)) at.push(i);
  });
  if (at.length < 2) return blocks;
  const out = blocks.slice();
  for (const i of at) out[i] = { t: 'h', level: 3, text: (blocks[i] as { text: string }).text };
  return out;
}

function hasProse(c: Chapter): boolean {
  return c.blocks.some((b) => b.t === 'p' || b.t === 'quote');
}

/** Split a chapter at its own chapter-style headings (第N章 ...) when it holds two or more. */
export function splitAtChapterHeadings(c: Chapter): Chapter[] {
  const cuts: number[] = [];
  c.blocks.forEach((b, i) => {
    if (isHead(b) && detectHeadingLine(b.text)) cuts.push(i);
  });
  return cuts.length >= 2 ? cutAt(c.blocks, cuts, c.title) : [c];
}

/** Split one oversize chapter by its inner headings, then by size. */
function splitOversize(c: Chapter): Chapter[] {
  if (chapterHan(c) <= BIG_CHAPTER_HAN) return [c];
  const blocks = c.blocks.slice();
  const cuts = boundaries(blocks);
  let pieces: Chapter[];
  if (cuts && cuts.length >= 2) pieces = cutAt(blocks, cuts, c.title);
  else pieces = [{ title: c.title, blocks }];
  const out: Chapter[] = [];
  for (const piece of pieces) {
    if (chapterHan(piece) <= BIG_CHAPTER_HAN) {
      out.push(piece);
      continue;
    }
    splitBySize(piece.blocks, BIG_PART_HAN).forEach((p, i) => {
      const part: Chapter = { title: piece.title ? `${piece.title} (${i + 1})` : `Part ${i + 1}`, blocks: p };
      if (i > 0) part.cont = true;
      out.push(part);
    });
  }
  return out;
}

const PG_START = /^\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG/i;
const PG_END = /^\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG/i;

/**
 * Project Gutenberg files wrap the book in an English license header and footer. Drop everything
 * outside the START and END markers (when both or either is present).
 */
export function stripGutenbergBlocks(blocks: Block[]): Block[] {
  const start = blocks.findIndex((b) => b.t === 'p' && PG_START.test(b.text.trim()));
  const end = blocks.findIndex((b, i) => i > start && b.t === 'p' && PG_END.test(b.text.trim()));
  if (start < 0 && end < 0) return blocks;
  return blocks.slice(start + 1, end < 0 ? undefined : end);
}

export function stripGutenberg(chapters: Chapter[], bookTitle: string): Chapter[] {
  const isMark = (b: Block, re: RegExp) => b.t === 'p' && re.test(b.text.trim());
  let startAt: [number, number] | null = null;
  let endAt: [number, number] | null = null;
  chapters.forEach((c, ci) =>
    c.blocks.forEach((b, bi) => {
      if (!startAt && isMark(b, PG_START)) startAt = [ci, bi];
      else if (startAt && !endAt && isMark(b, PG_END)) endAt = [ci, bi];
    }),
  );
  if (!startAt && !endAt) return chapters;
  const out: Chapter[] = [];
  chapters.forEach((c, ci) => {
    if (startAt && ci < startAt[0]) return;
    if (endAt && ci > endAt[0]) return;
    let blocks = c.blocks;
    let title = c.title;
    if (endAt && ci === endAt[0]) blocks = blocks.slice(0, endAt[1]);
    if (startAt && ci === startAt[0]) {
      blocks = blocks.slice(startAt[1] + 1);
      const first = blocks[0];
      title = first && first.t === 'h' ? first.text : bookTitle;
    }
    out.push({ title, blocks });
  });
  return out;
}

/**
 * Clean up a chapter list: drop empty chapters, drop leading picture-only pages, fold chapters
 * that are only a heading (a part title, a volume page) into the next one, split oversize chapters,
 * and give untitled chapters a name.
 */
export function finalizeChapters(input: Chapter[]): Chapter[] {
  const trimmed = input
    .map((c) => {
      const blocks = c.blocks.slice();
      while (blocks.length && blocks[0].t === 'hr') blocks.shift();
      while (blocks.length && blocks[blocks.length - 1].t === 'hr') blocks.pop();
      return { title: c.title.replace(/\s+/g, ' ').trim(), blocks };
    })
    .filter((c) => c.blocks.length > 0);

  const merged: Chapter[] = [];
  let carry: Block[] = [];
  let seenProse = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    const last = i === trimmed.length - 1;
    if (!hasProse(c)) {
      const hasImg = c.blocks.some((b) => b.t === 'img');
      if (hasImg && !seenProse) continue; // cover or title-page picture
      if (!last && !hasImg) {
        carry = carry.concat(c.blocks);
        continue;
      }
    }
    if (hasProse(c)) seenProse = true;
    merged.push({ title: c.title, blocks: carry.concat(c.blocks) });
    carry = [];
  }
  if (carry.length) merged.push({ title: '', blocks: carry });

  const out: Chapter[] = [];
  for (const c of merged) out.push(...splitOversize(c));
  return out.map((c, i) => ({ ...c, title: c.title || `Section ${i + 1}` }));
}
