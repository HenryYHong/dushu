// PDF text items to paragraphs. Pure functions (no pdf.js import) so they can be tested with synthetic items.
//
// Coordinates follow PDF user space: origin bottom-left, y grows upward. A vertical page (CJK text
// set top to bottom, columns right to left) is handled by mapping both kinds of page onto two axes:
// "along" the line of text and "cross" from one line to the next.
import { cpLen, detectHeadingLine } from './chapters';
import { isCjk } from './han';

export interface PdfItem {
  str: string;
  /** Baseline origin of the item. */
  x: number;
  y: number;
  /** Extent along the direction of writing. */
  w: number;
  /** Font size. */
  size: number;
  /** True when the font is set for vertical writing. */
  vertical?: boolean;
}

export interface PdfPageItems {
  width: number;
  height: number;
  items: PdfItem[];
}

interface Line {
  text: string;
  a0: number;
  a1: number;
  c: number;
  size: number;
  /** 0 at the top edge of the page, 1 at the bottom (horizontal pages only; 0.5 otherwise). */
  edge: number;
}

interface PageParagraphs {
  paras: string[];
  /** The first paragraph begins with an indent or heading, so it cannot continue the previous page. */
  firstStartsNew: boolean;
  lastIsShort: boolean;
}

const TERMINAL = /[。！？!?…”’」』）)；;.]$/;
const PAGE_NUMBER = /^[\s\-—–·.]*(?:第\s*)?\d{1,4}(?:\s*页)?[\s\-—–·.]*$/;

const firstCp = (s: string): number => s.codePointAt(0)!;
const lastCp = (s: string): number => Array.from(s).pop()!.codePointAt(0)!;

function joinLineText(items: { str: string; a0: number; a1: number; size: number }[]): string {
  let out = '';
  let prevEnd = 0;
  for (const it of items) {
    if (out) {
      const gap = it.a0 - prevEnd;
      const left = lastCp(out);
      const right = firstCp(it.str);
      const bothCjk = isCjk(left) && isCjk(right);
      const spaced = out.endsWith(' ') || it.str.startsWith(' ');
      // Chinese runs sit flush; a gap of most of an em between them is a real space.
      if (!spaced && gap > it.size * (bothCjk ? 0.75 : 0.2)) out += ' ';
    }
    out += it.str;
    prevEnd = it.a1;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Split into two columns when a clear empty band runs down the middle of the page. */
function splitColumns(items: PdfItem[], pageWidth: number): PdfItem[][] {
  if (items.length < 20) return [items];
  const spans = items.map((it) => [it.x, it.x + it.w] as const).sort((a, b) => a[0] - b[0]);
  const lo = pageWidth * 0.3;
  const hi = pageWidth * 0.7;
  const medianSize = [...items].map((i) => i.size).sort((a, b) => a - b)[items.length >> 1] || 10;
  let covered = 0;
  let best: { from: number; to: number } | null = null;
  for (const [s, e] of spans) {
    if (s > covered && covered >= lo && s <= hi && s - covered >= medianSize * 1.2 && (!best || s - covered > best.to - best.from)) {
      best = { from: covered, to: s };
    }
    covered = Math.max(covered, e);
  }
  if (!best) return [items];
  const gutter = best;
  const left: PdfItem[] = [];
  const right: PdfItem[] = [];
  let spanning = 0;
  for (const it of items) {
    if (it.x + it.w <= gutter.from + 0.5) left.push(it);
    else if (it.x >= gutter.to - 0.5) right.push(it);
    else spanning++;
  }
  if (spanning > items.length * 0.1 || left.length < items.length * 0.25 || right.length < items.length * 0.25) return [items];
  return [left, right];
}

function buildLines(items: PdfItem[], vertical: boolean, page: { width: number; height: number }): Line[] {
  const mapped = items
    .filter((it) => it.str.trim() !== '')
    .map((it) => {
      const along0 = vertical ? -it.y : it.x;
      return {
        str: it.str,
        a0: along0,
        a1: along0 + (it.w || it.size * cpLen(it.str)),
        c: vertical ? -it.x : -it.y,
        size: it.size || 10,
      };
    })
    .sort((p, q) => p.c - q.c || p.a0 - q.a0);

  const groups: (typeof mapped)[] = [];
  let ref = NaN;
  let curSize = 0;
  for (const m of mapped) {
    const tol = Math.min(m.size, curSize || m.size) * 0.5;
    if (groups.length && Math.abs(m.c - ref) <= tol) {
      groups[groups.length - 1].push(m);
      curSize = Math.max(curSize, m.size);
    } else {
      groups.push([m]);
      ref = m.c;
      curSize = m.size;
    }
  }
  return groups.map((g) => {
    g.sort((p, q) => p.a0 - q.a0);
    const c = g.reduce((n, x) => n + x.c, 0) / g.length;
    const size = g.reduce((n, x) => Math.max(n, x.size), 0);
    return {
      text: joinLineText(g),
      a0: g[0].a0,
      a1: g.reduce((n, x) => Math.max(n, x.a1), g[0].a1),
      c,
      size,
      edge: vertical ? 0.5 : (page.height + c) / (page.height || 1),
    };
  });
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function paragraphsFromLines(lines: Line[]): PageParagraphs {
  if (!lines.length) return { paras: [], firstStartsNew: true, lastIsShort: false };
  const size = median(lines.map((l) => l.size)) || 10;
  const longLines = lines.filter((l) => l.a1 - l.a0 > size * 8);
  // The margin is where most lines start; first lines of paragraphs sit to the right of it.
  const starts = lines.map((l) => l.a0).sort((a, b) => a - b);
  const left = starts[Math.floor(starts.length * 0.25)];
  const right = (longLines.length ? longLines : lines).reduce((n, l) => Math.max(n, l.a1), -Infinity);
  const pitch = median(lines.slice(1).map((l, i) => l.c - lines[i].c).filter((d) => d > size * 0.5)) || size * 1.4;

  const paras: string[] = [];
  let cur = '';
  let firstStartsNew = false;
  const startsNew = (l: Line, prev: Line | undefined): boolean => {
    if (!prev) return true;
    if (l.c - prev.c > pitch * 1.7) return true;
    if (l.a0 > left + size * 0.9) return true;
    if (detectHeadingLine(l.text) || detectHeadingLine(prev.text)) return true;
    return prev.a1 < right - size * 1.2 && TERMINAL.test(prev.text);
  };
  lines.forEach((l, i) => {
    const fresh = startsNew(l, lines[i - 1]);
    if (i === 0) firstStartsNew = l.a0 > left + size * 0.9 || !!detectHeadingLine(l.text);
    if (fresh && cur) {
      paras.push(cur);
      cur = '';
    }
    cur = cur && /[A-Za-z0-9,.;:!?)]$/.test(cur) && /^[A-Za-z0-9(]/.test(l.text) ? `${cur} ${l.text}` : cur + l.text;
  });
  if (cur) paras.push(cur);
  const last = lines[lines.length - 1];
  return { paras, firstStartsNew, lastIsShort: last.a1 < right - size * 1.2 };
}

function layoutPage(page: PdfPageItems, headerFooter: Set<string>): PageParagraphs {
  const spanChars = (its: PdfItem[], v: boolean) => its.reduce((n, i) => n + (!!i.vertical === v ? cpLen(i.str) : 0), 0);
  const vertical = spanChars(page.items, true) > spanChars(page.items, false);
  const columns = vertical ? [page.items] : splitColumns(page.items, page.width);
  const all: PageParagraphs[] = columns.map((col) => {
    const lines = buildLines(col, vertical, page).filter((l) => !headerFooter.has(key(l)));
    return paragraphsFromLines(lines);
  });
  if (all.length === 1) return all[0];
  return {
    paras: all.flatMap((a) => a.paras),
    firstStartsNew: all[0].firstStartsNew,
    lastIsShort: all[all.length - 1].lastIsShort,
  };
}

const key = (l: Line): string => `${l.text}|${l.edge < 0.5 ? 'top' : 'bottom'}`;

/** Running heads and page numbers: lines in the top or bottom margin that repeat across pages, or are bare numbers. */
function findHeadersFooters(pages: PdfPageItems[]): Set<string> {
  const counts = new Map<string, number>();
  const drop = new Set<string>();
  for (const page of pages) {
    const vertical = false;
    const seen = new Set<string>();
    for (const l of buildLines(page.items, vertical, page)) {
      if (l.edge > 0.08 && l.edge < 0.92) continue;
      const pattern = l.text.replace(/\d+/g, '#');
      const k = `${pattern}|${l.edge < 0.5 ? 'top' : 'bottom'}`;
      if (seen.has(k)) continue;
      seen.add(k);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (PAGE_NUMBER.test(l.text)) drop.add(key(l));
    }
  }
  const need = Math.max(3, Math.ceil(pages.length * 0.3));
  // Compare by pattern: store patterns, then match page by page.
  const patterns = new Set([...counts].filter(([, n]) => n >= need).map(([k]) => k));
  for (const page of pages) {
    for (const l of buildLines(page.items, false, page)) {
      if (l.edge > 0.08 && l.edge < 0.92) continue;
      if (patterns.has(`${l.text.replace(/\d+/g, '#')}|${l.edge < 0.5 ? 'top' : 'bottom'}`)) drop.add(key(l));
    }
  }
  return drop;
}

/** All pages to paragraphs; a paragraph that runs over a page break is joined. */
export function pagesToParagraphs(pages: PdfPageItems[]): string[] {
  const drop = findHeadersFooters(pages);
  const out: string[] = [];
  let open = false; // last paragraph of the previous page did not end
  for (const page of pages) {
    const res = layoutPage(page, drop);
    res.paras.forEach((p, i) => {
      if (i === 0 && open && !res.firstStartsNew && out.length) out[out.length - 1] += /[A-Za-z0-9,.;:!?)]$/.test(out[out.length - 1]) && /^[A-Za-z0-9(]/.test(p) ? ` ${p}` : p;
      else out.push(p);
    });
    if (res.paras.length) {
      const lastPara = out[out.length - 1];
      open = !res.lastIsShort && !TERMINAL.test(lastPara);
    }
  }
  return out;
}
