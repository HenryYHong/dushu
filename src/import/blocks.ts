// XHTML/HTML document to Block[]. Shared by the EPUB and HTML importers.
import type { Block } from '../types';
import { attr, localName } from './markup';
import { spaceBetweenIsNoise } from './han';
import { detectWrapWidth, isRuleLine, isSiteJunk, linesToParagraphs, splitLongParagraph, trimLine } from './chapters';

export interface ExtractOptions {
  /** Turn an image src/href into an asset name (and store the bytes), or undefined to drop the image. */
  resolveImage?: (src: string) => string | undefined;
}

export interface Extracted {
  blocks: Block[];
  /** Element id (or <a name>) to the index of the block that starts there. */
  anchors: Map<string, number>;
  /** Share of visible characters inside links, and the number of links: a high share means a contents page. */
  linkShare: number;
  linkCount: number;
}

type Item =
  | { t: 'p' | 'quote'; raw: string }
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; raw: string }
  | { t: 'img'; asset: string; alt?: string }
  | { t: 'hr' };

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
    run = [];
    if (!raw.replace(/\ue000/g, '').trim()) return;
    items.push({ t: quote > 0 ? 'quote' : 'p', raw });
  };

  const addText = (data: string) => {
    const n = data.replace(/\s+/g, '').length;
    total += n;
    if (linkDepth > 0) linked += n;
    run.push(pre > 0 ? data.replace(/[ \t\r\f]+/g, ' ') : collapse(data));
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
      if (nm === 'br') parts.push(' ');
      else if (nm === 'img' || nm === 'image') imgs.push(c);
      else if (nm === 'svg') imgs.push(...imagesIn(c));
      else c.childNodes.forEach(collect);
    };
    el.childNodes.forEach(collect);
    const raw = parts.join('');
    total += raw.replace(/\s+/g, '').length;
    if (raw.trim()) items.push({ t: 'h', level, raw });
    for (const img of imgs) emitImage(img, localName(img));
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
    if (name === 'br') {
      run.push('\n');
      return;
    }
    if (name === 'img' || name === 'image') {
      flush();
      mark(el);
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
    if (hm) {
      flush();
      mark(el);
      heading(el, Number(hm[1]) as 1 | 2 | 3 | 4 | 5 | 6);
      return;
    }
    if (BLOCK.has(name)) {
      flush();
      mark(el);
      const isQuote = name === 'blockquote';
      const isPre = name === 'pre';
      if (isQuote) quote++;
      if (isPre) pre++;
      el.childNodes.forEach(walk);
      flush();
      if (isQuote) quote--;
      if (isPre) pre--;
      return;
    }
    mark(el);
    const isLink = name === 'a' && !!el.getAttribute('href');
    if (isLink) {
      linkDepth++;
      linkCount++;
    }
    el.childNodes.forEach(walk);
    if (isLink) linkDepth--;
  };

  const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
  if (body) walk(body);
  flush();

  const { blocks, starts } = expand(items);
  const mapped = new Map<string, number>();
  for (const [id, idx] of anchors) mapped.set(id, starts[Math.min(idx, starts.length - 1)]);
  return { blocks, anchors: mapped, linkShare: total ? linked / total : 0, linkCount };
}

/**
 * Items to blocks. `<br>` inside a paragraph is a paragraph break, unless the lines across the
 * whole document look hard-wrapped (same width, no sentence ends), in which case it is a soft wrap.
 * Returns, for each item, the index of its first block (plus a final entry for the end).
 */
function expand(items: Item[]): { blocks: Block[]; starts: number[] } {
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

  const blocks: Block[] = [];
  const starts: number[] = [];
  for (const it of items) {
    starts.push(blocks.length);
    if (it.t === 'p' || it.t === 'quote') {
      const lines = it.raw.split('\n').map(normalizeInline).filter(Boolean);
      const paras = width && lines.length > 1 ? linesToParagraphs(lines, width) : lines;
      for (const text of paras) {
        if (isSiteJunk(text)) continue;
        if (isRuleLine(text)) {
          if (blocks.length && blocks[blocks.length - 1].t !== 'hr') blocks.push({ t: 'hr' });
          continue;
        }
        for (const piece of splitLongParagraph(text)) blocks.push({ t: it.t, text: piece });
      }
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
  return { blocks, starts };
}

