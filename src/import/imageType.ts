// Image type by content, never by what a book declares.
//
// A book can label any bytes "image/png". The only images Dushu keeps are raster formats whose bytes are
// recognized here; the type stored with an asset is the one found by looking at the bytes. SVG is not in the
// list on purpose: a blob of type image/svg+xml opened in its own tab runs the SVG's scripts with this app's
// origin (see assets.ts, which turns SVG into a PNG before storing it).

export interface RasterType {
  mime: string;
  ext: string;
}

const ascii = (b: Uint8Array, at: number, n: number): string => {
  let s = '';
  for (let i = at; i < at + n && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

/** The raster image type of these bytes (PNG, JPEG, GIF, WebP, AVIF, BMP), or undefined for anything else. */
export function sniffRaster(b: Uint8Array): RasterType | undefined {
  if (b.length < 12) return undefined;
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a) return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  const head = ascii(b, 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return { mime: 'image/gif', ext: 'gif' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return { mime: 'image/avif', ext: 'avif' };
  }
  if (b[0] === 0x42 && b[1] === 0x4d) {
    // BMP: "BM", a 32-bit file size, two reserved words (zero), then the pixel data offset.
    const reserved = b[6] | b[7] | b[8] | b[9];
    if (reserved === 0 && b[10] >= 26) return { mime: 'image/bmp', ext: 'bmp' };
  }
  return undefined;
}

/** True when the bytes look like an SVG document (an <svg> start tag near the top, after any prolog or comments). */
export function looksLikeSvg(b: Uint8Array): boolean {
  let head = '';
  const n = Math.min(b.length, 4096);
  // UTF-16 SVG is possible in theory; a BOM-less or UTF-8 reading is enough to recognize the common case.
  const utf16 = (b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff);
  if (utf16) {
    const le = b[0] === 0xff;
    for (let i = 2; i + 1 < n; i += 2) head += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  } else {
    for (let i = 0; i < n; i++) head += String.fromCharCode(b[i]);
  }
  return /<svg[\s>/]/i.test(head);
}
