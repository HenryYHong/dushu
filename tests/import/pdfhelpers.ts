// A tiny PDF writer for tests: one non-embedded CID font (STSong-Light, Adobe-GB1) set with UniGB-UCS2-H,
// plus Helvetica for ASCII. Text is hex-encoded, so the file is plain ASCII and xref offsets are exact.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PdfLine {
  x: number;
  y: number;
  text: string;
  size?: number;
}

const hex16 = (s: string) =>
  Array.from(s)
    .map((ch) => ch.codePointAt(0)!.toString(16).padStart(4, '0'))
    .join('')
    .toUpperCase();

export function makePdf(pages: PdfLine[][], opts: { info?: string } = {}): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body);
  // 1 catalog, 2 pages, 3 type0 font, 4 cid font, 5 its descriptor; then page + contents pairs
  const firstPage = 6;
  const kids = pages.map((_, i) => `${firstPage + i * 2} 0 R`).join(' ');
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  add('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>');
  add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /DW 1000 /FontDescriptor 5 0 R >>');
  add('<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>');
  pages.forEach((lines, i) => {
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${firstPage + i * 2 + 1} 0 R >>`);
    const content = lines
      .map((l) => `BT /F1 ${l.size ?? 12} Tf 1 0 0 1 ${l.x} ${l.y} Tm <${hex16(l.text)}> Tj ET`)
      .join('\n');
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  let infoRef = '';
  if (opts.info) {
    add(opts.info);
    infoRef = ` /Info ${objs.length} 0 R`;
  }

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${infoRef} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** Reads predefined CMaps straight from node_modules, the way a bundled app would serve them. */
export class NodeCMapReaderFactory {
  async fetch({ name }: { name: string }) {
    const file = join(process.cwd(), 'node_modules', 'pdfjs-dist', 'cmaps', `${name}.bcmap`);
    return { cMapData: new Uint8Array(readFileSync(file)), isCompressed: true };
  }
}
