// Plain text to blocks, hard-wrap joining, chapter heading detection and chapter assembly.
// Shared by the TXT, PDF, HTML, Markdown and EPUB importers.
import type { Block, Chapter } from '../types';
import { cutAdTail, isBoilerplateLine } from './boilerplate';
import { countHan, unitScale } from './han';
import { lang } from '../lang/active';

/** Whether the book is read in a language written with spaces (its wrapped lines join with a space, its headings are words). */
const spacedLanguage = (): boolean => lang().spaced;
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

/** A paragraph without its site junk: the paragraph, the paragraph with an ad cut off its end, or null when it is all junk. */
export function storyText(t: string): string | null {
  const cut = cutAdTail(t);
  if (cut !== t && countHan(cut) >= 2 && !isSiteJunk(cut)) return cut;
  return isSiteJunk(t) ? null : t;
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
/**
 * Chapter and part headings of the languages written with spaces: CAPÍTULO III, Chapitre premier, Erstes Kapitel, Capitolo
 * XII, Глава первая, LIVRE DEUXIÈME, a Roman numeral alone on its line (II. or XIV). Volumes (Parte, Livre, Teil, Часть) are
 * level 1.
 */
/** Numbers spelled out (Capítulo uno, Chapitre deux, Kapitel drei, Глава один), each a whole word. */
const CARDINAL_WORD = String.raw`(?:uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci\p{L}+|veint\p{L}*|sext[oa]|s[ée]ptim[oa]|octav[oa]|noven[oa]|d[ée]cim[oa]|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|\p{L}+ième|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|\p{L}+zehn|zwanzig|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|\p{L}+dici|dici\p{L}+|vent\p{L}*|sest[oa]|settim[oa]|ottav[oa]|non[oa]|um|uma|dois|duas|três|sete|oito|dez|treze|quatorze|vinte|oitav[oa]|один|два|три|четыре|пять|шесть|семь|восемь|девять|десять|\p{L}+надцать|двадцать|шест\p{L}*|седьм\p{L}*|восьм\p{L}*|девят\p{L}*|десят\p{L}*)(?!\p{L})`;
const ORDINAL_WORD = String.raw`(?:\d+|[IVXLCDM]+\b\.?|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|premi(?:er|ère)|deuxième|troisième|second|erstes|zweites|drittes|vierte[sn]?|fünfte[sn]?|prim[oa]|secondo|terzo|quarto|quinto|primeiro|segundo|terceiro|перв\S*|втор\S*|трет\S*|четв[её]рт\S*|пят\S*|${CARDINAL_WORD})`;
const SPACED_VOLUME = new RegExp(String.raw`^(?:parte|libro|livre|partie|tome|teil|buch|band|livro|часть|книга|том)\s+${ORDINAL_WORD}`, 'iu');
const SPACED_CHAPTER = new RegExp(String.raw`^(?:cap[ií]tulo|chapitre|kapitel|capitolo|cap\.|глава)\s+${ORDINAL_WORD}|^(?:erstes|zweites|drittes|viertes|fünftes|sechstes|siebentes|siebtes|achtes|neuntes|zehntes)\s+kapitel\b|^[IVXLC]{1,7}\.?$`, 'iu');

/** "【第一章】序", "[第一章]": a chapter marker in brackets, as some sites set it. */
const BRACKETED = new RegExp(`^[【\\[［〔〖]\\s*第\\s*${NUM}+\\s*([章回节節卷集部篇幕折场場话話])\\s*[】\\]］〕〗]`);
/**
 * What comes before the marker of a heading that is not part of it: a Markdown "## " in a text file, and the "正文" (body of
 * the book) download sites put before every chapter ("正文 第一章 序").
 */
const HEAD_PREFIX = new RegExp(`^(?:#{1,6}[ \\t\\u3000]+|正文卷?[\\s\\u3000:：]*(?=第\\s*${NUM}|序|楔子|引子))`);

/** Is this single line a chapter heading? Level 1 for volumes (卷, 部, 集), 2 otherwise. */
export function detectHeadingLine(line: string): { level: 1 | 2 } | null {
  const t = trimLine(line).replace(HEAD_PREFIX, '');
  if (!t || cpLen(t) > 40) return null;
  if (/[。，；、]$/.test(t)) return null;
  if (VOLUME_WORD.test(t) || VOLUME_PREFIX.test(t)) return { level: 1 };
  if (NUMBERED.test(t) || WORD_RE.test(t) || LATIN_CHAPTER.test(t)) return { level: 2 };
  const bracketed = BRACKETED.exec(t);
  if (bracketed) return { level: /[卷集部篇]/.test(bracketed[1]) ? 1 : 2 };
  if (spacedLanguage()) {
    if (SPACED_VOLUME.test(t)) return { level: 1 };
    if (SPACED_CHAPTER.test(t)) return { level: 2 };
  }
  return null;
}

/**
 * Tidy a heading line: full-width digits become ASCII (第１回 to 第1回), runs of spaces become one,
 * and the colon some sites put after the marker goes (第一章：风雪 to 第一章 风雪).
 */
export function normalizeHeading(line: string): string {
  const t = trimLine(line)
    .replace(HEAD_PREFIX, '')
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
  // A language written with spaces: the wrapped lines of a paragraph meet at a space (a word broken with a hyphen at the
  // end of a line is joined back), whatever letters or marks they end and start with.
  if (spacedLanguage()) return /\p{L}-$/u.test(a) && /^\p{Ll}/u.test(b) ? a.slice(0, -1) + b : `${a} ${b}`;
  return a + b;
}

function joinable(prev: string, width: number): boolean {
  const n = cpLen(prev);
  return n >= width - 2 || (n >= width * 0.8 && !TERMINAL.test(prev));
}

/** A clause or sentence mark before the last character: the line is prose, not a line of verse. */
const INNER_MARK = /[，、。；：？！,;:?!]./u;

/**
 * The width a document set out one printed line per paragraph element was hard-wrapped at (its real paragraphs then end at a
 * blank element or a short line), or 0. Stricter than detectWrapWidth, because each element is normally a paragraph of its
 * own: at least 20 lines fill the width, and most of those are prose (a mark inside the line), so verse set one line per
 * element, whose lines are as alike, is left alone.
 */
export function detectLineWrapWidth(lines: string[]): number {
  const width = detectWrapWidth(lines);
  if (!width) return 0;
  let full = 0;
  let prose = 0;
  for (const l of lines) {
    const n = cpLen(l);
    if (n < width - 2 || n > width) continue;
    full++;
    if (INNER_MARK.test(l)) prose++;
  }
  return full >= 20 && prose / full >= 0.6 ? width : 0;
}

/** A line that ends a sentence: a stop, or a closing quotation mark. */
const ENDS_SENTENCE = /[。！？!?…”」』]$/u;
/** A line that opens a quotation. */
const OPENS_QUOTE = /^[“「『]/u;

/**
 * Whether `next` continues the paragraph of the line `prev` in a document hard-wrapped at `width` (detectLineWrapWidth): `prev`
 * nearly fills the width, and `next` does not start a paragraph (`nextStarts`: indented, or a scene break the document sets
 * out on its own elsewhere), and is not a heading, a rule or site junk. A sentence that ends at the end of the line followed by
 * a quotation is a new speaker, a paragraph of its own in print: where the typist left out the blank between the two
 * paragraphs, this is the one sign of it.
 */
export function wrapsOn(prev: string, next: string, width: number, nextStarts = false): boolean {
  // A line longer than the width was not wrapped (a list of dates set out in full): it ends its paragraph.
  if (nextStarts || cpLen(prev) > width || !joinable(prev, width)) return false;
  if (ENDS_SENTENCE.test(prev) && OPENS_QUOTE.test(next)) return false;
  return !detectHeadingLine(next) && !isRuleLine(next) && !isSiteJunk(next);
}

/** Two lines of a hard-wrapped paragraph as one (CJK lines meet without a space). */
export function joinWrapped(a: string, b: string): string {
  return joinPieces(a, b);
}

/**
 * Whether a text hard-wrapped at `width` was cut at exactly that many characters, as converters and old text sites do: nearly
 * every line that comes close to the width is exactly as long (a paragraph's last line is the only one that falls short, so
 * few are one or two characters shorter). Then a line one or two characters short ends its paragraph.
 */
export function wrapsExactly(lines: string[], width: number): boolean {
  if (!width) return false;
  let exact = 0;
  let near = 0;
  for (const l of lines) {
    const n = cpLen(l);
    if (n === width) exact++;
    else if (n >= width - 2 && n < width) near++;
  }
  return exact >= 20 && near <= exact * 0.1;
}

const INDENTED = /^(?:\u3000|\t| {2,})/;

/**
 * Turn raw lines into paragraphs. Blank lines end a paragraph; with a wrap width, a line that
 * nearly fills it continues into the next one unless the next one is indented (a new paragraph).
 * Heading and rule lines always stand alone. `exact`: the text was cut at exactly `width` (wrapsExactly), so only a line
 * that long runs on. In a text that neither indents its paragraphs nor sets blank lines between them, a line that ends a
 * sentence followed by a quotation is a new speaker, a new paragraph.
 */
export function linesToParagraphs(rawLines: string[], width: number, exact = false): string[] {
  const out: string[] = [];
  let cur = '';
  let prev = '';
  const flush = () => {
    if (cur) out.push(cur);
    cur = '';
  };
  let indented = 0;
  let filled = 0;
  let blank = 0;
  if (width) {
    for (const raw of rawLines) {
      if (!trimLine(raw)) {
        blank++;
        continue;
      }
      filled++;
      if (INDENTED.test(raw)) indented++;
    }
  }
  const marked = indented >= Math.max(3, filled * 0.02) || blank >= Math.max(3, filled * 0.05);
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
    const indent = INDENTED.test(raw);
    const runsOn = exact ? cpLen(prev) >= width : joinable(prev, width);
    const speaker = !marked && ENDS_SENTENCE.test(prev) && OPENS_QUOTE.test(t);
    if (cur && width && !indent && prev && runsOn && !speaker) cur = joinPieces(cur, t);
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
  // A language with spaces ends its sentences with a full stop too, and a piece starts at a word, not at the space.
  const spaced = lang().spaced;
  const sentences = (spaced
    ? text.match(/[^.!?…]*[.!?…]+["'»”’)]*\s*|[^.!?…]+$/g)
    : text.match(/[^。！？!?…]*[。！？!?…]+[”’」』）)]*|[^。！？!?…]+$/g)) ?? [text];
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
  return spaced ? out.map((piece) => piece.trim()).filter(Boolean) : out;
}

/** Pasted/TXT/Markdown-body text to blocks: paragraphs, headings by the chapter regex, rules. */
export function textToBlocks(text: string): Block[] {
  const lines = normalizeNewlines(text).split('\n');
  const prose = lines.map(trimLine).filter((l) => l && !detectHeadingLine(l) && !isRuleLine(l));
  const width = detectWrapWidth(prose);
  return paragraphsToBlocks(linesToParagraphs(lines, width, wrapsExactly(prose, width)));
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
  for (const raw of paras) {
    const p = storyText(raw);
    if (p === null) continue;
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
/**
 * A heading element named by its start: "Глава третья. Новое, очень приятное знакомство" (Каштанка) is longer than a heading
 * line may be, but "Глава третья" before its title is one. Only a lead with a chapter word: a bare number or initials ("I. The
 * Problem", "C. S. Lewis", "LXXXVIII. Um pretexto honesto") is not, and only at or above the level the book's chapters are set
 * at (`level`), so numbered sections inside titled chapters never split a book.
 */
function leadNamed(b: Block, level: number): boolean {
  if (!isHead(b) || b.level > level) return false;
  const lead = b.text.split(/(?<=\S)[.:：]\s+|\s+[—–-]\s+/)[0].trim();
  if (lead === b.text.trim() || /^[\p{N}IVXLCDM]+\.?$/iu.test(lead)) return false;
  return !!detectHeadingLine(lead);
}

function boundaries(blocks: Block[]): number[] | null {
  // The shallowest heading level used twice or more: the level a book's chapters are usually set at.
  const counts = new Map<number, number>();
  for (const b of blocks) if (isHead(b)) counts.set(b.level, (counts.get(b.level) ?? 0) + 1);
  let level = 0;
  for (let l = 1; l <= 6; l++) {
    if ((counts.get(l) ?? 0) >= 2) {
      level = l;
      break;
    }
  }
  const named: number[] = [];
  let byLead = false;
  blocks.forEach((b, i) => {
    if (isHead(b) && detectHeadingLine(b.text)) named.push(i);
    else if (leadNamed(b, level || 6)) { named.push(i); byLead = true; }
  });
  if (named.length >= 2) {
    if (!byLead) return named;
    // Chapters named by their start say the level the book sets them at: its other headings there or above (a prologue, an
    // epilogue, notes) are chapters too, not text of the chapter before them.
    const deepest = Math.max(...named.map((i) => (blocks[i] as Extract<Block, { t: 'h' }>).level));
    const idx: number[] = [];
    blocks.forEach((b, i) => { if (isHead(b) && b.level <= deepest) idx.push(i); });
    return idx;
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
  // Sections numbered and titled on their own line (一、序 / 1. 序 / （三）风波), counting up from one: chapters, or headings
  // in one chapter when they are short, like bare numerals. Where a text has both, the longer run is its sections (a story
  // inside it may number its own parts 一, 二, 三).
  const titled = titledSections(blocks);
  if (titled && titled.length >= numbered.length) {
    const han = blocks.reduce((n, b) => n + blockHan(b), 0);
    const level = han / titled.length < SECTION_HAN ? 3 : 2;
    for (const i of titled) blocks[i] = { t: 'h', level, text: (blocks[i] as { text: string }).text.trim() };
    return level === 3 ? [] : titled;
  }
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

  // Markdown headings in a text file ("## 风雪"), two or more.
  const marked: number[] = [];
  blocks.forEach((b, i) => {
    if (b.t === 'p' && MARKDOWN_HEAD.test(b.text) && cpLen(b.text) <= 60) marked.push(i);
  });
  if (marked.length >= 2) {
    for (const i of marked) {
      const text = (blocks[i] as { text: string }).text.trim();
      const hashes = /^#+/.exec(text)![0].length;
      blocks[i] = { t: 'h', level: Math.min(hashes, 6) as 1 | 2 | 3 | 4 | 5 | 6, text: text.replace(/^#+[ \t\u3000]+/, '').replace(/[ \t]+#+$/, '') };
    }
    const top = Math.min(...marked.map((i) => (blocks[i] as { level: number }).level));
    return marked.filter((i) => (blocks[i] as { level: number }).level === top);
  }
  return null;
}

/** Sections marked by bare numerals that average fewer Han characters than this stay in one chapter. */
const SECTION_HAN = 1500;

const MARKDOWN_HEAD = /^#{1,6}[ \t\u3000]+\S/;
/** "一、序", "1. 序", "（三）风波": a section number and a short title (not a digit: 1.5倍 is a number). */
const SECTION_TITLE = /^[（(]?\s*([0-9]{1,3}|[零〇一二两兩三四五六七八九十]{1,3})\s*(?:[)）]|[、.．])[\s\u3000]*([^\d\s\u3000].*)$/u;

/**
 * Lines that number and title the sections of a text (一、序 二、优胜记略 …): at least three, counting up from one, each
 * title short and not a sentence, and text between each two of them (a list of points inside a chapter has little). Their
 * indices, or null.
 */
function titledSections(blocks: Block[]): number[] | null {
  const at: number[] = [];
  let expected = 1;
  blocks.forEach((b, i) => {
    if (b.t !== 'p') return;
    const m = SECTION_TITLE.exec(b.text.trim());
    if (!m || cpLen(m[2]) > 20 || /[。，；、：:！？!?…,.;]$/.test(m[2])) return;
    if (numeralValue(m[1]) === expected) {
      at.push(i);
      expected++;
    }
  });
  if (at.length < 3) return null;
  let total = 0;
  for (let k = 0; k < at.length; k++) {
    const end = k + 1 < at.length ? at[k + 1] : blocks.length;
    let n = 0;
    for (let j = at[k] + 1; j < end; j++) n += blockHan(blocks[j]);
    if (n < 20) return null;
    total += n;
  }
  return total / at.length >= 200 ? at : null;
}

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
export function splitBySize(blocks: Block[], target = PART_HAN * unitScale()): Block[][] {
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
 * The chapters one long document shows by the headings in its text, found as for a TXT file (第N章 lines set as plain
 * paragraphs, numbered sections …), or null when it shows none. For a converter's EPUB that holds the whole book in one file
 * under one contents entry.
 */
export function chaptersByTextHeadings(input: Block[], title: string): Chapter[] | null {
  const blocks = demoteContentsRuns(input);
  const cuts = boundaries(blocks);
  return cuts && cuts.length >= 2 ? cutAt(blocks, cuts, title) : null;
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
    if (han <= PART_HAN * unitScale() * 1.5) chapters = [{ title: wholeTitle(blocks, opts.title), blocks }];
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
  if (chapterHan(c) <= BIG_CHAPTER_HAN * unitScale()) return [c];
  const blocks = c.blocks.slice();
  const cuts = boundaries(blocks);
  let pieces: Chapter[];
  if (cuts && cuts.length >= 2) pieces = cutAt(blocks, cuts, c.title);
  else pieces = [{ title: c.title, blocks }];
  const out: Chapter[] = [];
  for (const piece of pieces) {
    if (chapterHan(piece) <= BIG_CHAPTER_HAN * unitScale()) {
      out.push(piece);
      continue;
    }
    splitBySize(piece.blocks, BIG_PART_HAN * unitScale()).forEach((p, i) => {
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
