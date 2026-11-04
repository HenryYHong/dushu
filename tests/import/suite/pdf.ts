// A PDF writer for the import suite, close to what a browser's "Save as PDF" writes on a Mac: one Type0 font with
// Identity-H (or -V) codes, no embedded glyphs, and a ToUnicode map that can name a character's glyph by another code point
// (⼀ for 一, as Songti SC and PingFang do, ︐ for ， in vertical text). Lines can be justified the way Chrome does it, with
// narrow space glyphs between the characters. Pages can carry a picture (a scanned page), and the file a password.

export interface PdfRun {
  x: number;
  y: number;
  text: string;
  size?: number;
  /** Justified: a narrow space glyph (this many thousandths of an em) between every two characters. */
  justify?: number;
}

export interface PdfPage {
  runs: PdfRun[];
  /** A picture over the whole page (a scan). */
  image?: boolean;
}

export interface PdfOptions {
  /** The code point the file names each character by (default: itself). */
  toUnicode?: (ch: string) => string;
  /** Vertical writing (Identity-V): runs go down the page. */
  vertical?: boolean;
  /** A user password the reader does not have. */
  password?: boolean;
  title?: string;
  width?: number;
  height?: number;
}

const hex = (n: number, w = 4) => n.toString(16).toUpperCase().padStart(w, '0');
const utf16Hex = (s: string) => Array.from(s).map((c) => {
  const cp = c.codePointAt(0)!;
  if (cp <= 0xffff) return hex(cp);
  const v = cp - 0x10000;
  return hex(0xd800 + (v >> 10)) + hex(0xdc00 + (v & 0x3ff));
}).join('');
const pdfString = (s: string) => `<FEFF${utf16Hex(s)}>`;

export function makeUnicodePdf(pages: PdfPage[], opts: PdfOptions = {}): Uint8Array {
  const W = opts.width ?? 420;
  const H = opts.height ?? 595;
  const toU = opts.toUnicode ?? ((c: string) => c);
  // CIDs: 1 is the narrow (justification) space, 2 the full space, then every character in order of first use.
  const cids = new Map<string, number>();
  const NARROW = 1;
  const SPACE = 2;
  let next = 3;
  const cidOf = (ch: string) => {
    if (ch === ' ') return SPACE;
    let c = cids.get(ch);
    if (!c) cids.set(ch, (c = next++));
    return c;
  };
  let justifyWidth = 160;
  const contents = pages.map((p) => {
    const ops: string[] = [];
    if (p.image) ops.push(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`);
    for (const r of p.runs) {
      const codes: number[] = [];
      Array.from(r.text).forEach((ch, i) => {
        if (r.justify && i > 0 && ch !== ' ') codes.push(NARROW);
        codes.push(cidOf(ch));
      });
      if (r.justify) justifyWidth = r.justify;
      ops.push(`BT /F1 ${r.size ?? 11} Tf 1 0 0 1 ${r.x} ${r.y} Tm <${codes.map((c) => hex(c)).join('')}> Tj ET`);
    }
    return ops.join('\n');
  });

  const objs: string[] = [];
  const add = (body: string) => objs.push(body) as number;
  // 1 catalog, 2 pages, 3 type0 font, 4 cid font, 5 descriptor, 6 ToUnicode, 7 image; then page + contents pairs
  const first = 8;
  const kids = pages.map((_, i) => `${first + i * 2} 0 R`).join(' ');
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  add(`<< /Type /Font /Subtype /Type0 /BaseFont /SongtiSC-Regular /Encoding /Identity-${opts.vertical ? 'V' : 'H'} /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>`);
  add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SongtiSC-Regular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /W [${NARROW} [${justifyWidth}] ${SPACE} [1000]] /FontDescriptor 5 0 R /CIDToGIDMap /Identity >>`);
  add('<< /Type /FontDescriptor /FontName /SongtiSC-Regular /Flags 4 /FontBBox [0 -120 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>');
  const entries: string[] = [`<${hex(NARROW)}> <0020>`, `<${hex(SPACE)}> <0020>`];
  for (const [ch, cid] of cids) entries.push(`<${hex(cid)}> <${utf16Hex(toU(ch))}>`);
  let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
  for (let i = 0; i < entries.length; i += 100) {
    const part = entries.slice(i, i + 100);
    cmap += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`;
  }
  cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  add(`<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  add('<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 4 >>\nstream\nÀ00À\nendstream');
  pages.forEach((p, i) => {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R >>${p.image ? ' /XObject << /Im0 7 0 R >>' : ''} >> /Contents ${first + i * 2 + 1} 0 R >>`);
    add(`<< /Length ${contents[i].length} >>\nstream\n${contents[i]}\nendstream`);
  });
  let trailerExtra = '';
  if (opts.title) trailerExtra += ` /Info ${add(`<< /Title ${pdfString(opts.title)} /Producer (Skia/PDF m120) >>`)} 0 R`;
  if (opts.password) {
    // A user password the empty one does not match: a reader must ask for it.
    const owner = 'A1'.repeat(32);
    const user = '5C'.repeat(32);
    trailerExtra += ` /Encrypt ${add(`<< /Filter /Standard /V 1 /R 2 /O <${owner}> /U <${user}> /P -44 >>`)} 0 R /ID [<${'0F'.repeat(16)}> <${'0F'.repeat(16)}>]`;
  }

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(latin1Length(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = latin1Length(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}

/** The file is written one byte per UTF-16 unit (latin-1), so its length in bytes is its string length. */
const latin1Length = (s: string) => s.length;

/**
 * The code point a Mac's Chinese fonts name a character's glyph by in a PDF: the Kangxi radical of the same shape where there
 * is one (⼀ for 一, ⼈ for 人), and ⼜ for 口, which Songti SC draws with the glyph of 口 (又 itself stays 又).
 */
export function macFontCodePoint(ch: string): string {
  if (ch === '口') return '⼜';
  if (ch === '又') return ch;
  return KANGXI.get(ch) ?? ch;
}

const KANGXI = (() => {
  const m = new Map<string, string>();
  for (let cp = 0x2f00; cp <= 0x2fd5; cp++) {
    const r = String.fromCodePoint(cp);
    const u = r.normalize('NFKC');
    if (u !== r && !m.has(u)) m.set(u, r);
  }
  return m;
})();

/** Punctuation as a vertical font names it (︐ for ，). */
export function verticalCodePoint(ch: string): string {
  return ({ '，': '︐', '、': '︑', '。': '︒', '：': '︓', '；': '︔', '！': '︕', '？': '︖', '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄' } as Record<string, string>)[ch] ?? macFontCodePoint(ch);
}
