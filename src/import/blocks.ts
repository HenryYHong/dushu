// XHTML/HTML document to Block[]. Shared by the EPUB and HTML importers.
import type { Block, RubySpan } from '../types';
import { attr, localName } from './markup';
import { spaceBetweenIsNoise } from './han';
import {
  detectLineWrapWidth, detectWrapWidth, isRuleLine, isSiteJunk, joinWrapped, linesToParagraphs, splitLongParagraph, storyText, trimLine, wrapsOn,
} from './chapters';

export interface ExtractOptions {
  /** Turn an image src/href into an asset name (and store the bytes), or undefined to drop the image. */
  resolveImage?: (src: string) => string | undefined;
  /**
   * Keep the readings a <ruby> prints (親譲<rt>おやゆず</rt>) on the blocks as RubySpans, for a Japanese book: the engine takes
   * them over its own guess. Off, a reading is dropped and only its base text is kept, as before.
   */
  ruby?: boolean;
  /**
   * h3 to h6 are lines of text, not headings: Project Gutenberg's conversion of a plain-text Chinese book marks a wrapped line
   * as a heading when it holds a capital letter (阿Q, S會館), which cut the book into hundreds of chapters mid-sentence.
   */
  textHeadings?: boolean;
}

/**
 * While text is collected, a reading rides in it between three noncharacters (never in any real text): base, reading, end. The
 * text is then cleaned and cut into paragraphs as usual, and takeMarkedRuby turns the marks into spans of the final text.
 */
const RB = '\ufdd0';
const RT = '\ufdd1';
const RE = '\ufdd2';
const MARKED = /\ufdd0([^\ufdd0-\ufdd2]*)\ufdd1([^\ufdd0-\ufdd2]*)\ufdd2/g;

/** A block's text with its marked readings taken out, and the readings as spans of that text. */
export function takeMarkedRuby(text: string): { text: string; ruby: RubySpan[] } {
  if (!text.includes(RB)) return { text, ruby: [] };
  const ruby: RubySpan[] = [];
  let out = '';
  let last = 0;
  for (const m of text.matchAll(MARKED)) {
    out += text.slice(last, m.index);
    const base = m[1];
    const rt = m[2].trim();
    if (base && rt) ruby.push({ start: out.length, end: out.length + base.length, rt });
    out += base;
    last = m.index! + m[0].length;
  }
  out += text.slice(last);
  // A mark cut in two by a paragraph split, or left open: its pieces go, the text stays.
  return { text: out.replace(/[\ufdd0-\ufdd2]/g, ''), ruby };
}

/** The pairs of base text and reading in a <ruby>: 親<rt>おや</rt>譲<rt>ゆず</rt> is two, <rb>無鉄砲</rb><rp>(</rp><rt>むてっぽう</rt> one. */
function rubyPairs(el: Element): { base: string; rt: string }[] {
  const pairs: { base: string; rt: string }[] = [];
  let base = '';
  const visit = (n: Node) => {
    if (n.nodeType === 3 || n.nodeType === 4) { base += (n as CharacterData).data; return; }
    if (n.nodeType !== 1) return;
    const name = localName(n as Element);
    if (name === 'rp') return;
    if (name === 'rt') { pairs.push({ base, rt: (n.textContent ?? '').replace(/\s+/g, '') }); base = ''; return; }
    if (name === 'rtc') return;
    n.childNodes.forEach(visit);
  };
  el.childNodes.forEach(visit);
  if (base) pairs.push({ base, rt: '' });
  return pairs;
}
const markRuby = (pairs: { base: string; rt: string }[]) =>
  pairs.map(({ base, rt }) => (rt && base.trim() ? `${RB}${collapse(base)}${RT}${rt}${RE}` : collapse(base))).join('');

export interface Extracted {
  blocks: Block[];
  /** Element id (or <a name>) to the index of the block that starts there. */
  anchors: Map<string, number>;
  /** Share of visible characters inside links, and the number of links: a high share means a contents page. */
  linkShare: number;
  linkCount: number;
  /**
   * For each block, the share of its text inside links to the book itself (#anchor or another of its files) and how many such
   * links it holds: a run of linked lines is a contents list (epub.ts dropLinkedRuns). A paragraph cut into several blocks
   * counts its links on its first block only.
   */
  links: BlockLinks[];
}

export interface BlockLinks {
  share: number;
  count: number;
}

/** Visible characters, characters inside links to the book itself, and those links: of one paragraph while it is collected. */
interface LinkTally {
  total: number;
  linked: number;
  count: number;
}

type Item =
  | { t: 'p' | 'quote'; raw: string; links?: LinkTally }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; raw: string }
  | { t: 'img'; asset: string; alt?: string }
  | { t: 'hr' }
  /** A blank <p>: no block, but it ends a paragraph of a book set out one printed line per <p>. */
  | { t: 'gap' };

const SKIP = new Set([
  'script', 'style', 'rt', 'rp', 'rtc', 'head', 'nav', 'noscript', 'template', 'title', 'link', 'meta', 'audio', 'video',
  'iframe', 'object', 'canvas', 'button', 'select', 'option', 'textarea', 'input', 'map',
]);
const BLOCK = new Set([
  'html', 'body', 'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'address', 'blockquote',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'figure',
  'figcaption', 'pre', 'form', 'fieldset', 'details', 'summary', 'center', 'hgroup', 'dir', 'menu',
]);

const MARK_RE = /^[\[［(（【〔]?\s*(?:注\s*)?(?:\d{1,3}|[①-⑳⑴-⒇㈠-㈩]|[一二三四五六七八九十]{1,3})\s*[\]］)）】〕]?$/;
const BACKLINK_RE = /^(?:↩︎?|↵|⏎|↑|⤴|返回|返回正文|返回原文|回到原文|回原文|back|back to text)$/i;
const NOTE_CLASS = /footnote|noteref|fnref|endnote-?ref|backlink|bklink|duokan-footnote|note-?mark/i;

const PINYIN_CLASS = /(?:^|[\s_-])(?:pinyin|zhuyin|bopomofo|furigana|ruby-?text)(?:$|[\s_-])/i;

/** Project Gutenberg's own header and footer (license, release date, START and END lines) in the files its ebookmaker makes. */
const GUTENBERG_FRAME = /(?:^|\s)pg-boilerplate(?:\s|$)/;
/** The START or END line inside it. */
const GUTENBERG_LINE = /\*{3}\s*(?:START|END) OF (?:THE|THIS) PROJECT GUTENBERG[^*]*\*{3}/i;
/** A caption a book sets inside a heading, under its picture (Gutenberg's illustrated editions): it is not the heading's text. */
const CAPTION_CLASS = /(?:^|\s)caption(?:\s|$)/i;
/** The letter of a decorative initial drawn as a picture ("M" for "MR. BENNET"), with the opening quote mark some carry. */
const INITIAL_ALT = /^\s*\p{P}?\p{L}{1,2}\s*$/u;
/** A link to the book itself: an anchor, or another of its files (no scheme, not protocol-relative). */
const isInternalHref = (href: string) => !!href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//');

function isHidden(el: Element): boolean {
  if (el.hasAttribute('hidden')) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const style = el.getAttribute('style');
  if (style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return true;
  const type = attr(el, 'type').toLowerCase();
  return /\bpagebreak\b/.test(type) || /doc-pagebreak/i.test(attr(el, 'role'));
}

/** A short inline element classed as pinyin: a reading aid written as a plain span instead of <rt>. */
function isPinyinSpan(el: Element, name: string): boolean {
  return ['span', 'i', 'em', 'sub', 'small', 'font'].includes(name) && PINYIN_CLASS.test(el.getAttribute('class') ?? '') && (el.textContent ?? '').length <= 40;
}

/** Footnote reference marks and backlinks, which are noise when reading. */
function isNoteMarker(el: Element, name: string): boolean {
  if (isPinyinSpan(el, name)) return true;
  const type = attr(el, 'type').toLowerCase();
  const role = attr(el, 'role').toLowerCase();
  if (/\b(noteref|backlink|biblioref|footnote-ref)\b/.test(type) || /doc-(noteref|backlink|biblioref)/.test(role)) return true;
  if (name !== 'a' && name !== 'sup' && name !== 'span') return false;
  const text = (el.textContent ?? '').trim();
  const cls = el.getAttribute('class') ?? '';
  if (name === 'a') {
    const href = el.getAttribute('href') ?? '';
    if (BACKLINK_RE.test(text)) return true;
    if (href.startsWith('#') && MARK_RE.test(text)) {
      const parent = el.parentElement ? localName(el.parentElement) : '';
      return parent === 'sup' || /[\[［(（【〔]/.test(text) || NOTE_CLASS.test(cls) || /fn|note|ref|zhu|endnote/i.test(href);
    }
  }
  if (name === 'sup' && el.children.length === 1 && localName(el.children[0]) === 'a') {
    return (el.children[0].getAttribute('href') ?? '').startsWith('#') && MARK_RE.test(text);
  }
  return text.length <= 8 && NOTE_CLASS.test(cls);
}

/** Marks a line break in the source markup; it is dropped between CJK characters and becomes a space elsewhere. */
const SOFT = '\ue000';

/** Whitespace inside one text node: runs with a line break become SOFT, other runs one space. */
function collapse(data: string): string {
  return data.replace(/[ \t\r\f]*\n[ \t\r\n\f]*/g, SOFT).replace(/[ \t\r\f]+/g, ' ');
}

const lastCp = (s: string): number => {
  const n = s.length;
  const lo = s.charCodeAt(n - 1);
  if (n >= 2 && lo >= 0xdc00 && lo <= 0xdfff) {
    const hi = s.charCodeAt(n - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return s.codePointAt(n - 2)!;
  }
  return lo;
};

/** Collapse whitespace, drop invisible junk, join source line breaks between CJK characters, trim (including U+3000). */
export function normalizeInline(s: string): string {
  const cleaned = s.replace(/[\u200b\u200c\u2060\ufeff\u00ad]/g, '').replace(/[\u00a0\t\r\f\n]/g, ' ');
  const parts = cleaned.split(SOFT);
  if (parts.length === 1) return trimLine(parts[0].replace(/ {2,}/g, ' '));
  // Pieces are collected and joined once: a book can hold tens of thousands of source line breaks in one paragraph.
  const chunks: string[] = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    while (chunks.length) {
      const t = chunks[chunks.length - 1].replace(/ +$/, '');
      if (t) {
        chunks[chunks.length - 1] = t;
        break;
      }
      chunks.pop();
    }
    const right = parts[i].replace(/^ +/, '');
    if (!right) continue;
    const a = chunks.length ? lastCp(chunks[chunks.length - 1]) : undefined;
    const b = right.codePointAt(0)!;
    if (a !== undefined && !spaceBetweenIsNoise(a, b)) chunks.push(' ');
    chunks.push(right);
  }
  return trimLine(chunks.join('').replace(/ {2,}/g, ' '));
}

export function extractBlocks(doc: Document, opts: ExtractOptions = {}): Extracted {
  const items: Item[] = [];
  const anchors = new Map<string, number>();
  let run: string[] = [];
  let quote = 0;
  let pre = 0;
  let linkDepth = 0;
  let linkCount = 0;
  let total = 0;
  let linked = 0;
  /** Inside a link to the book itself, and the tally of the paragraph being collected. */
  let internalDepth = 0;
  let tally: LinkTally = { total: 0, linked: 0, count: 0 };

  const mark = (el: Element) => {
    const id = el.getAttribute('id');
    if (id && !anchors.has(id)) anchors.set(id, items.length);
    if (localName(el) === 'a') {
      const nm = el.getAttribute('name');
      if (nm && !anchors.has(nm)) anchors.set(nm, items.length);
    }
  };

  const flush = () => {
    const raw = run.join('');
    const links = tally;
    run = [];
    tally = { total: 0, linked: 0, count: 0 };
    if (!raw.replace(/\ue000/g, '').trim()) return;
    items.push(links.count ? { t: quote > 0 ? 'quote' : 'p', raw, links } : { t: quote > 0 ? 'quote' : 'p', raw });
  };

  const count = (n: number) => {
    total += n;
    tally.total += n;
    if (linkDepth > 0) linked += n;
    if (internalDepth > 0) tally.linked += n;
  };

  const addText = (data: string) => {
    count(data.replace(/\s+/g, '').length);
    run.push(pre > 0 ? data.replace(/[ \t\r\f]+/g, ' ') : collapse(data));
  };

  /**
   * A decorative initial drawn as a picture at the start of a paragraph (<span class="letra"><img alt="M"/></span>R. BENNET):
   * its letter is the start of the first word, so it joins the text ("MR. BENNET") and no picture is kept. Only before any
   * text of the paragraph (an opening quote mark aside), only inside a <p> that has text of its own, and only when its alt is
   * one or two letters.
   */
  const initialLetter = (el: Element): string | null => {
    const alt = el.getAttribute('alt') ?? '';
    if (!INITIAL_ALT.test(alt)) return null;
    if (!/^[\s\ue000\p{P}]*$/u.test(run.join(''))) return null;
    let p: Element | null = el.parentElement;
    while (p && !BLOCK.has(localName(p))) p = p.parentElement;
    if (!p || localName(p) !== 'p' || !/\p{L}/u.test(p.textContent ?? '')) return null;
    return alt.trim();
  };

  const emitImage = (el: Element, name: string) => {
    if (!opts.resolveImage) return;
    const src = attr(el, name === 'img' ? 'src' : 'href');
    if (!src) return;
    const asset = opts.resolveImage(src);
    if (asset) items.push({ t: 'img', asset, alt: attr(el, 'alt') || undefined });
  };

  const imagesIn = (el: Element): Element[] => {
    const out: Element[] = [];
    const all = el.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const n = localName(all[i]);
      if (n === 'image' || n === 'img') out.push(all[i]);
    }
    return out;
  };

  const heading = (el: Element, level: 1 | 2 | 3 | 4 | 5 | 6) => {
    const parts: string[] = [];
    const imgs: Element[] = [];
    // The caption of the heading's picture ("I hope Mr. Bingley will like it." over "CHAPTER II."): the picture's alt, not the
    // heading's words.
    const captions: string[] = [];
    const collect = (n: Node) => {
      if (n.nodeType === 3 || n.nodeType === 4) {
        parts.push(collapse((n as CharacterData).data));
        return;
      }
      if (n.nodeType !== 1) return;
      const c = n as Element;
      const nm = localName(c);
      if (SKIP.has(nm) || isHidden(c) || isNoteMarker(c, nm)) return;
      mark(c);
      if (CAPTION_CLASS.test(c.getAttribute('class') ?? '')) {
        const t = (c.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t) captions.push(t);
        return;
      }
      if (nm === 'ruby' && opts.ruby) { parts.push(markRuby(rubyPairs(c))); return; }
      if (nm === 'br') parts.push(' ');
      else if (nm === 'img' || nm === 'image') imgs.push(c);
      else if (nm === 'svg') imgs.push(...imagesIn(c));
      else c.childNodes.forEach(collect);
    };
    el.childNodes.forEach(collect);
    const raw = parts.join('');
    total += raw.replace(/[\s\ufdd0-\ufdd2]+/g, '').length;
    if (raw.replace(/[\ufdd0-\ufdd2]/g, '').trim()) items.push({ t: 'h', level, raw });
    for (const img of imgs) {
      const at = items.length;
      emitImage(img, localName(img));
      const it = items[at];
      if (captions.length && it?.t === 'img' && !it.alt) it.alt = captions.shift();
    }
  };

  const walk = (node: Node): void => {
    if (node.nodeType === 3 || node.nodeType === 4) {
      addText((node as CharacterData).data);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const name = localName(el);
    if (SKIP.has(name) || isHidden(el) || isNoteMarker(el, name)) return;
    if (GUTENBERG_FRAME.test(el.getAttribute('class') ?? '')) {
      // Gutenberg's header or footer is not the book, and none of its lines can run into the book's own (the Credits line glued
      // to the START line kept the whole header in 吶喊). Only its START or END line is kept, as a paragraph of its own, for
      // stripGutenberg to cut the book at, with what the plain-text file repeated next to it.
      flush();
      const line = GUTENBERG_LINE.exec((el.textContent ?? '').replace(/\s+/g, ' '));
      if (line) items.push({ t: 'p', raw: line[0] });
      return;
    }
    if (name === 'br') {
      run.push('\n');
      return;
    }
    if (name === 'ruby' && opts.ruby) {
      mark(el);
      const marked = markRuby(rubyPairs(el));
      const n = marked.replace(/[\s\ufdd0-\ufdd2]+/g, '').length;
      total += n;
      if (linkDepth > 0) linked += n;
      run.push(marked);
      return;
    }
    if (name === 'img' || name === 'image') {
      const letter = name === 'img' ? initialLetter(el) : null;
      mark(el);
      if (letter) {
        count(letter.replace(/\s+/g, '').length);
        run.push(letter);
        return;
      }
      flush();
      emitImage(el, name);
      return;
    }
    if (name === 'svg') {
      flush();
      mark(el);
      for (const img of imagesIn(el)) emitImage(img, localName(img));
      return;
    }
    if (name === 'hr') {
      flush();
      mark(el);
      items.push({ t: 'hr' });
      return;
    }
    const hm = /^h([1-6])$/.exec(name);
    if (hm && !(opts.textHeadings && Number(hm[1]) >= 3)) {
      flush();
      mark(el);
      heading(el, Number(hm[1]) as 1 | 2 | 3 | 4 | 5 | 6);
      return;
    }
    if (BLOCK.has(name) || hm) {
      flush();
      mark(el);
      const isQuote = name === 'blockquote';
      const isPre = name === 'pre';
      if (isQuote) quote++;
      if (isPre) pre++;
      const before = items.length;
      el.childNodes.forEach(walk);
      flush();
      if (isQuote) quote--;
      if (isPre) pre--;
      if (name === 'p' && items.length === before) items.push({ t: 'gap' });
      return;
    }
    mark(el);
    const isLink = name === 'a' && !!el.getAttribute('href');
    const internal = isLink && isInternalHref(el.getAttribute('href') ?? '');
    if (isLink) {
      linkDepth++;
      linkCount++;
    }
    if (internal) {
      internalDepth++;
      tally.count++;
    }
    el.childNodes.forEach(walk);
    if (isLink) linkDepth--;
    if (internal) internalDepth--;
  };

  const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
  if (body) walk(body);
  flush();

  const { blocks: expanded, starts, links } = expand(items);
  // Readings marked while collecting become spans of each block's final text.
  const blocks = opts.ruby ? expanded.map((b): Block => {
    if ((b.t !== 'p' && b.t !== 'h' && b.t !== 'quote') || !b.text.includes(RB)) return b;
    const { text, ruby } = takeMarkedRuby(b.text);
    return ruby.length ? { ...b, text, ruby } : { ...b, text };
  }) : expanded;
  const mapped = new Map<string, number>();
  for (const [id, idx] of anchors) mapped.set(id, starts[Math.min(idx, starts.length - 1)]);
  return { blocks, anchors: mapped, linkShare: total ? linked / total : 0, linkCount, links };
}

/** Leading full-width space or two no-break spaces: the line starts a paragraph. */
const INDENT = /^[ \t\r\n\f\ue000]*(?:\u3000|\u00a0{2})/;

/**
 * A paragraph element that holds several paragraphs, each a source line opening with an ideographic space (Gutenberg's
 * Japanese books keep a whole story in one <p>, its lines hard-wrapped, each paragraph indented with U+3000): its paragraphs,
 * or null. Two such line starts at least, so a lone indented line changes nothing. A U+3000 right after a sentence end inside a
 * line starts one too (待っていた。　広い門). Plain line breaks still run together as before.
 */
function indentedParagraphs(raw: string): string[] | null {
  if (raw.includes('\n') || (raw.match(/\ue000(?=\u3000)/g) ?? []).length < 2) return null;
  return raw.split(/[ \t]*\ue000[ \t]*(?=\u3000)|(?<=[。」』！？])(?=\u3000)/);
}

/**
 * Items to blocks. `<br>` inside a paragraph is a paragraph break, unless the lines across the
 * whole document look hard-wrapped (same width, no sentence ends), in which case it is a soft wrap.
 * A document set out one printed line per `<p>` (a book typed in from print, blank `<p>`s between its paragraphs) is joined
 * back the same way when its lines look hard-wrapped: a line that fills the width runs on into the next `<p>`.
 * Returns, for each item, the index of its first block (plus a final entry for the end).
 */
function expand(items: Item[]): { blocks: Block[]; starts: number[]; links: BlockLinks[] } {
  const multi: string[] = [];
  for (const it of items) {
    if ((it.t === 'p' || it.t === 'quote') && it.raw.includes('\n')) {
      for (const line of it.raw.split('\n')) {
        const n = normalizeInline(line);
        if (n) multi.push(n);
      }
    }
  }
  const width = detectWrapWidth(multi);
  // The text of each one-line <p> (no <br> inside), for the wrap test.
  const line = items.map((it) => (it.t === 'p' && !it.raw.includes('\n') ? normalizeInline(it.raw) : ''));
  const lineWidth = width ? 0 : detectLineWrapWidth(line.filter(Boolean));
  // A short line without a mark that the document sets out again and again (a scene break, such as a row of letters) starts a
  // paragraph of its own, even where the blank before it was left out.
  const times = new Map<string, number>();
  if (lineWidth) for (const l of line) if (l) times.set(l, (times.get(l) ?? 0) + 1);
  const isBreak = (l: string) => (times.get(l) ?? 0) >= 3 && [...l].length <= lineWidth / 2 && !/\p{P}/u.test(l);
  const startsParagraph = (k: number) => INDENT.test((items[k] as { raw: string }).raw) || isBreak(line[k]);

  const blocks: Block[] = [];
  const starts: number[] = [];
  const links: BlockLinks[] = [];
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    starts.push(blocks.length);
    if (it.t === 'p' || it.t === 'quote') {
      const tally: LinkTally = { total: 0, linked: 0, count: 0 };
      const add = (t?: LinkTally) => { if (t) { tally.total += t.total; tally.linked += t.linked; tally.count += t.count; } };
      add(it.links);
      const indented = indentedParagraphs(it.raw);
      let lines = indented ? indented.map(normalizeInline).filter(Boolean) : it.raw.split('\n').map(normalizeInline).filter(Boolean);
      if (lineWidth && line[k] && !indented) {
        let text = line[k];
        while (k + 1 < items.length && line[k + 1] && wrapsOn(line[k], line[k + 1], lineWidth, startsParagraph(k + 1))) {
          k++;
          starts.push(starts[starts.length - 1]);
          add((items[k] as { links?: LinkTally }).links);
          text = joinWrapped(text, line[k]);
        }
        lines = [text];
      }
      const first = blocks.length;
      // A wrapped line that starts with the full-width indent begins a paragraph: the indent is kept for linesToParagraphs.
      const paras = width && lines.length > 1 && !indented
        ? linesToParagraphs(it.raw.split('\n').map((l) => (INDENT.test(l) ? '\u3000' : '') + normalizeInline(l)).filter((l) => trimLine(l)), width)
        : lines;
      for (const para of paras) {
        const text = storyText(para);
        if (text === null) continue;
        if (isRuleLine(text)) {
          if (blocks.length && blocks[blocks.length - 1].t !== 'hr') blocks.push({ t: 'hr' });
          continue;
        }
        for (const piece of splitLongParagraph(text)) blocks.push({ t: it.t, text: piece });
      }
      const share = tally.total ? tally.linked / tally.total : 0;
      for (let b = first; b < blocks.length; b++) links[b] = { share, count: b === first ? tally.count : 0 };
    } else if (it.t === 'h') {
      const text = normalizeInline(it.raw);
      if (text && !isSiteJunk(text)) blocks.push({ t: 'h', level: it.level, text });
    } else if (it.t === 'hr') {
      if (blocks.length && blocks[blocks.length - 1].t !== 'hr') blocks.push({ t: 'hr' });
    } else if (it.t === 'img') {
      blocks.push(it.alt ? { t: 'img', asset: it.asset, alt: it.alt } : { t: 'img', asset: it.asset });
    }
  }
  starts.push(blocks.length);
  for (let b = 0; b < blocks.length; b++) links[b] ??= { share: 0, count: 0 };
  return { blocks, starts, links };
}

