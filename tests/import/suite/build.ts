// Builders for the import suite's files: text files in every common encoding and layout, EPUBs as converters and stores
// make them, Kindle files, and PDFs as a browser on a Mac prints them. All from public-domain text (sources.ts).
import type { Section } from './sources';
import { HANS_AUTHOR, HANS_TITLE, wrap } from './sources';
import { PNG, makeEpub, CONTAINER } from '../helpers';
import { makeUnicodePdf, macFontCodePoint, verticalCodePoint, type PdfPage, type PdfRun } from './pdf';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------------------------------------------------- text files ---

export interface TextLayout {
  /** The heading line of each section (null: no heading lines). */
  head?: ((i: number, t: string) => string | null) | null;
  indent?: string;
  /** A blank line after each paragraph. */
  blank?: boolean;
  /** Hard-wrapped at this many characters (the indent included). */
  wrapAt?: number;
  /** A blank line before and after each heading. */
  headBlank?: boolean;
}

/** The lines of a book's body. */
export function bodyLines(secs: Section[], o: TextLayout = {}): string[] {
  const head = o.head === undefined ? (_i: number, t: string) => t : o.head;
  const indent = o.indent ?? '　　';
  const out: string[] = [];
  secs.forEach(([t, ps], i) => {
    const h = head ? head(i, t) : null;
    if (h !== null) {
      if (o.headBlank) out.push('');
      out.push(h);
      if (o.headBlank) out.push('');
    }
    for (const p of ps) {
      out.push(...(o.wrapAt ? wrap(indent + p, o.wrapAt) : [indent + p]));
      if (o.blank) out.push('');
    }
  });
  return out;
}

/** A text file: a title line, a byline, a blank line, then the body. */
export function textBook(lines: string[], title = HANS_TITLE, byline = `作者：${HANS_AUTHOR}`, eol = '\n'): string {
  return [...[title, byline].filter(Boolean), '', ...lines].join(eol) + eol;
}

// --------------------------------------------------------------------------------------------------------------- EPUB ---

export function page(body: string, title = 't', o: { encoding?: string; epub3?: boolean; lang?: string; css?: string } = {}): string {
  const enc = o.encoding ?? 'utf-8';
  const dt = o.epub3 === false ? '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">' : '<!DOCTYPE html>';
  const link = o.css ? `<link rel="stylesheet" type="text/css" href="${o.css}"/>` : '';
  const lang = o.lang ?? 'zh';
  return `<?xml version="1.0" encoding="${enc}"?>\n${dt}\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"><head><meta http-equiv="Content-Type" content="text/html; charset=${enc}"/><title>${esc(title)}</title>${link}</head><body>${body}</body></html>`;
}

export type Item = [id: string, href: string, type: string, props?: string];

export function packageDoc(o: { title: string; creators?: string[]; items: Item[]; spine: string[]; version?: '2.0' | '3.0'; toc?: string; meta?: string; guide?: string; ppd?: string; lang?: string }): string {
  const items = o.items.map(([id, href, type, props]) => `<item id="${id}" href="${href}" media-type="${type}"${props ? ` properties="${props}"` : ''}/>`).join('\n');
  const refs = o.spine.map((id) => `<itemref idref="${id}"/>`).join('\n');
  const v3 = (o.version ?? '3.0') === '3.0';
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${o.version ?? '3.0'}" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:identifier id="bookid">urn:uuid:00000000-0000-0000-0000-000000000000</dc:identifier>
<dc:title>${esc(o.title)}</dc:title>
${(o.creators ?? []).join('\n')}
<dc:language>${o.lang ?? 'zh'}</dc:language>
${v3 ? '<meta property="dcterms:modified">2026-11-03T00:00:00Z</meta>' : ''}
${o.meta ?? ''}
</metadata>
<manifest>
${items}
</manifest>
<spine${o.toc ? ` toc="${o.toc}"` : ''}${o.ppd ? ` page-progression-direction="${o.ppd}"` : ''}>
${refs}
</spine>
${o.guide ? `<guide>${o.guide}</guide>` : ''}
</package>`;
}

export type TocPoint = [label: string, src: string, kids?: TocPoint[]];

export function ncx(points: TocPoint[], title: string): string {
  let n = 0;
  const pt = ([label, src, kids]: TocPoint): string => {
    n++;
    return `<navPoint id="np${n}" playOrder="${n}"><navLabel><text>${esc(label)}</text></navLabel><content src="${src}"/>${(kids ?? []).map(pt).join('')}</navPoint>`;
  };
  return `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="x"/></head><docTitle><text>${esc(title)}</text></docTitle><navMap>${points.map(pt).join('')}</navMap></ncx>`;
}

export function nav(points: TocPoint[]): string {
  const li = ([label, src, kids]: TocPoint): string =>
    `<li>${src ? `<a href="${src}">${esc(label)}</a>` : `<span>${esc(label)}</span>`}${kids?.length ? `<ol>${kids.map(li).join('')}</ol>` : ''}</li>`;
  return page(`<nav epub:type="toc" id="toc"><h1>目錄</h1><ol>${points.map(li).join('')}</ol></nav><nav epub:type="landmarks" hidden=""><ol><li><a epub:type="bodymatter" href="ch01.xhtml">正文</a></li></ol></nav>`, '目錄');
}

export const paras = (ps: string[], indent = '') => ps.map((p) => `<p>${indent}${esc(p)}</p>`).join('');

/** An EPUB from its files (the container document is added; `opfPath` is where the package document is). */
export function epub(files: Record<string, string | Uint8Array>, opfPath = 'OEBPS/content.opf'): Uint8Array {
  return makeEpub({ 'META-INF/container.xml': CONTAINER(opfPath), ...files });
}

/** One chapter file per section, with a nav or an NCX listing them. */
export function chapterEpub(secs: Section[], o: { title: string; author: string; body?: (t: string, ps: string[]) => string; v2?: boolean; encode?: (s: string) => Uint8Array; encoding?: string; ext?: string; lang?: string }): Uint8Array {
  const files: Record<string, string | Uint8Array> = {};
  const items: Item[] = [];
  const spine: string[] = [];
  const ext = o.ext ?? 'xhtml';
  secs.forEach(([t, ps], i) => {
    const id = `ch${String(i + 1).padStart(2, '0')}.${ext}`;
    const markup = page(o.body ? o.body(t, ps) : `<h2>${esc(t)}</h2>${paras(ps)}`, t, { encoding: o.encoding, epub3: !o.v2, lang: o.lang });
    files[`OEBPS/${id}`] = o.encode ? o.encode(markup) : markup;
    items.push([id, id, 'application/xhtml+xml']);
    spine.push(id);
  });
  const points: TocPoint[] = secs.map(([t], i) => [t, `ch${String(i + 1).padStart(2, '0')}.${ext}`]);
  if (o.v2) {
    files['OEBPS/toc.ncx'] = ncx(points, o.title);
    items.push(['ncx', 'toc.ncx', 'application/x-dtbncx+xml']);
  } else {
    files['OEBPS/nav.xhtml'] = nav(points);
    items.push(['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav']);
  }
  files['OEBPS/content.opf'] = packageDoc({ title: o.title, creators: [`<dc:creator>${esc(o.author)}</dc:creator>`], items, spine, version: o.v2 ? '2.0' : '3.0', toc: o.v2 ? 'ncx' : undefined, lang: o.lang });
  return epub(files);
}

/** Bytes that look like ciphertext (a fixed generator, so the file is the same every run). */
export function noise(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed * 2654435761 + 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

export { PNG };

// ---------------------------------------------------------------------------------------------------------------- PDF ---

export interface Typeset {
  /** Characters on a full line. */
  measure?: number;
  size?: number;
  width?: number;
  height?: number;
  /** A page with the title and author first. */
  titlePage?: { title: string; author: string };
  /** Every fourth full line of a paragraph justified (fewer characters with narrow spaces between them), as Chrome sets them. */
  justify?: boolean;
  /** The browser's header and footer on every page: date and title at the top, the file's address and "n/N" at the bottom. */
  headerFooter?: { title: string; url: string };
  /** Two columns on the page. */
  columns?: 2;
  /** A section's heading starts a new page. */
  pagePerSection?: boolean;
  /** Each paragraph is a line of its own, not indented (verse). */
  verse?: boolean;
}

/** Sections set as pages of a PDF, as a browser prints an HTML book. */
export function typeset(secs: Section[], o: Typeset = {}): PdfPage[] {
  const size = o.size ?? 11;
  const W = o.width ?? 420;
  const H = o.height ?? 595;
  const pitch = Math.round(size * 1.7 * 10) / 10;
  const columns = o.columns ?? 1;
  const gutter = 22;
  const margin = 51;
  const colWidth = (W - 2 * margin - (columns - 1) * gutter) / columns;
  const measure = o.measure ?? Math.floor(colWidth / size);
  const top = H - margin - size;
  const bottom = margin;
  const pages: PdfPage[] = [];
  let runs: PdfRun[] = [];
  let col = 0;
  let y = top;
  const newPage = () => {
    if (runs.length) pages.push({ runs });
    runs = [];
    col = 0;
    y = top;
  };
  const nextLine = (h = pitch) => {
    y -= h;
    if (y < bottom) {
      if (col + 1 < columns) {
        col++;
        y = top;
      } else newPage();
    }
  };
  const x0 = () => margin + col * (colWidth + gutter);
  if (o.titlePage) {
    const t = o.titlePage.title;
    runs.push({ x: W / 2 - ([...t].length * 20) / 2, y: H * 0.65, text: t, size: 20 });
    runs.push({ x: W / 2 - ([...o.titlePage.author].length * size) / 2, y: H * 0.65 - 40, text: o.titlePage.author, size });
    newPage();
  }
  secs.forEach(([t, ps], si) => {
    if (t) {
      if ((o.pagePerSection ?? true) && (si > 0 || runs.length)) newPage();
      const hs = Math.round(size * 1.36);
      runs.push({ x: x0() + (colWidth - [...t].length * hs) / 2, y, text: t, size: hs });
      nextLine(pitch * 2);
    }
    for (const p of ps) {
      if (o.verse) {
        runs.push({ x: x0(), y, text: p, size });
        nextLine();
        continue;
      }
      const cps = [...p];
      let at = 0;
      let row = 0;
      while (at < cps.length) {
        const first = row === 0;
        const room = measure - (first ? 2 : 0);
        const justified = !!o.justify && row % 4 === 3 && cps.length - at > room;
        const take = justified ? room - 3 : room;
        const text = cps.slice(at, at + take).join('');
        const run: PdfRun = { x: x0() + (first ? 2 * size : 0), y, text, size };
        if (justified) run.justify = Math.round((3 * 1000) / (take - 1));
        runs.push(run);
        at += take;
        row++;
        nextLine();
      }
    }
  });
  newPage();
  if (o.headerFooter) {
    const n = pages.length;
    pages.forEach((pg, i) => {
      pg.runs.push({ x: 20, y: H - 20, text: '2026/11/3 16:04', size: 8 });
      pg.runs.push({ x: W / 2, y: H - 20, text: o.headerFooter!.title, size: 8 });
      pg.runs.push({ x: 20, y: 14, text: o.headerFooter!.url, size: 8 });
      pg.runs.push({ x: W - 40, y: 14, text: `${i + 1}/${n}`, size: 8 });
    });
  }
  return pages;
}

/** A PDF as Chrome on a Mac writes it: radicals for many characters (Songti SC). The page size is typeset's (A5 by default). */
export const macPdf = (pages: PdfPage[], title?: string, size: { width?: number; height?: number } = {}) =>
  makeUnicodePdf(pages, { toUnicode: macFontCodePoint, title, ...size });

/** Sections set vertically (columns right to left, top to bottom), with vertical punctuation forms. */
export function verticalPdf(secs: Section[], title?: string): Uint8Array {
  const size = 11;
  const W = 420;
  const H = 595;
  const per = Math.floor((H - 102) / size);
  const pages: PdfPage[] = [];
  let runs: PdfRun[] = [];
  let x = W - 51 - size;
  const column = (text: string, extra = 0) => {
    if (x < 51) {
      pages.push({ runs });
      runs = [];
      x = W - 51 - size;
    }
    runs.push({ x, y: H - 51 - extra * size, text, size });
    x -= size * 1.7;
  };
  for (const [t, ps] of secs) {
    if (runs.length) {
      pages.push({ runs });
      runs = [];
      x = W - 51 - size;
    }
    column(t, 2);
    for (const p of ps) {
      const cps = [...p];
      for (let at = 0, row = 0; at < cps.length; row++) {
        const take = per - (row === 0 ? 2 : 0);
        column(cps.slice(at, at + take).join(''), row === 0 ? 2 : 0);
        at += take;
      }
    }
  }
  if (runs.length) pages.push({ runs });
  return makeUnicodePdf(pages, { toUnicode: verticalCodePoint, vertical: true, title });
}
