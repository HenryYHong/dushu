// Builders for test EPUBs and small utilities. Everything is generated; no book content is copied.
import { strToU8, zipSync } from 'fflate';

export type Files = Record<string, string | Uint8Array>;

/** 1x1 transparent PNG. */
export const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

export const SVG = strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');

export function xhtml(body: string, head = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><meta charset="utf-8"/><title>t</title>${head}</head><body>${body}</body></html>`;
}

export interface OpfOptions {
  version?: '2.0' | '3.0';
  title?: string;
  creators?: string[];
  /** [id, href, mediaType, properties?] */
  manifest: [string, string, string, string?][];
  spine: string[];
  spineToc?: string;
  metaExtra?: string;
  guide?: string;
}

export function opf(o: OpfOptions): string {
  const items = o.manifest
    .map(([id, href, type, props]) => `<item id="${id}" href="${href}" media-type="${type}"${props ? ` properties="${props}"` : ''}/>`)
    .join('\n');
  const refs = o.spine.map((id) => `<itemref idref="${id}"/>`).join('\n');
  const creators = (o.creators ?? []).map((c) => `<dc:creator>${c}</dc:creator>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${o.version ?? '3.0'}" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
<dc:identifier id="id">urn:test</dc:identifier>
${o.title !== undefined ? `<dc:title>${o.title}</dc:title>` : ''}
${creators}
<dc:language>zh</dc:language>
${o.metaExtra ?? ''}
</metadata>
<manifest>${items}</manifest>
<spine${o.spineToc ? ` toc="${o.spineToc}"` : ''}>${refs}</spine>
${o.guide ? `<guide>${o.guide}</guide>` : ''}
</package>`;
}

export const CONTAINER = (path = 'OEBPS/content.opf') =>
  `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${path}" media-type="application/oebps-package+xml"/></rootfiles></container>`;

export function navDoc(entries: [string, string][], extra = ''): string {
  const lis = entries.map(([href, title]) => `<li><a href="${href}">${title}</a></li>`).join('');
  return xhtml(`<nav epub:type="toc"><ol>${lis}</ol></nav>${extra}`);
}

export function ncxDoc(entries: [string, string][]): string {
  const points = entries
    .map(([src, title], i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${title}</text></navLabel><content src="${src}"/></navPoint>`)
    .join('');
  return `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${points}</navMap></ncx>`;
}

export function makeEpub(files: Files): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  };
  for (const [path, data] of Object.entries(files)) entries[path] = typeof data === 'string' ? strToU8(data) : data;
  return zipSync(entries as never);
}

export function asFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as Uint8Array<ArrayBuffer>], name);
}

/** A paragraph of plausible Chinese of about n characters (repeats a sentence; content is made up). */
export function prose(n: number, seed = 0): string {
  const base = ['清晨的阳光照进窗子，', '他慢慢地走到桌边，', '拿起那本旧书，', '轻轻地翻开了第一页。', '外面的风很大，', '树叶沙沙地响着。'];
  let out = '';
  let count = 0;
  let i = seed;
  while (count < n) {
    const piece = base[i++ % base.length];
    out += piece;
    count += [...piece].length;
  }
  return out.replace(/，$/, '。');
}
