// Kindle books without DRM: MOBI (PalmDOC or HUFF/CDIC text, MOBI 6 markup) and AZW3 (KF8: skeleton and
// fragment tables, XHTML parts). Combined files hold both; the KF8 half is used when it is there.
// Layout reference: the PalmDB / MOBI / EXTH / KF8 descriptions on the MobileRead wiki.
import type { Chapter, ImportedBook } from '../types';
import { AssetStore } from './assets';
import { extractBlocks } from './blocks';
import { blockText, chaptersFromBlocks, finalizeChapters, stripGutenberg } from './chapters';
import { decodeText } from './encoding';
import { countHan, spaceBetweenIsNoise } from './han';
import { ImportError } from './errors';
import { parseXhtml } from './markup';
import { cleanAuthors, cleanTitle, parseFilename } from './meta';
import { readIndex, type IndexTable } from './mobiIndex';
import { COMPRESSION_HUFF, COMPRESSION_NONE, COMPRESSION_PALMDOC, HuffReader, palmdocDecompress, trailingSize } from './mobiText';
import { chaptersFromSpine, dropTitlePage, type SpineDoc, type TocRef } from './spine';
import { bookFromText } from './txt';

export const KINDLE_DRM_MESSAGE =
  'This Kindle book is protected by DRM (copy protection), so Dushu cannot read it. Use a DRM-free copy of the book, or one you have the right to convert.';
const BROKEN = 'This Kindle book could not be read (the file is damaged or in a layout Dushu does not know).';
const NULL_INDEX = 0xffffffff;

const u16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number): number => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const tag = (b: Uint8Array, o: number, n = 4): string => {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
};
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Does the file carry the PalmDB type and creator of a Kindle / Mobipocket book? */
export function looksLikeMobi(bytes: Uint8Array): boolean {
  if (bytes.length < 80) return false;
  const id = tag(bytes, 60, 8).toUpperCase();
  return id === 'BOOKMOBI' || id === 'TEXTREAD';
}

/** Bytes to a string with one char per byte, so offsets stay byte offsets while markup is edited. */
function toBinary(b: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < b.length; i += 8192) parts.push(String.fromCharCode.apply(null, b.subarray(i, i + 8192) as unknown as number[]));
  return parts.join('');
}
function fromBinary(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------------ headers ---

interface Header {
  compression: number;
  textLength: number;
  textRecords: number;
  encryption: number;
  hasMobi: boolean;
  length: number;
  codepage: number;
  minVersion: number;
  nameOffset: number;
  nameLength: number;
  firstImage: number;
  huffOffset: number;
  huffCount: number;
  exthFlags: number;
  extraFlags: number;
  ncx: number;
  fdst: number;
  fdstCount: number;
  frag: number;
  skel: number;
}

function readHeader(rec: Uint8Array): Header {
  if (rec.length < 16) throw new ImportError(BROKEN);
  const h: Header = {
    compression: u16(rec, 0),
    textLength: u32(rec, 4),
    textRecords: u16(rec, 8),
    encryption: u16(rec, 12),
    hasMobi: rec.length > 16 && tag(rec, 16) === 'MOBI',
    length: 0,
    codepage: 1252,
    minVersion: 0,
    nameOffset: 0,
    nameLength: 0,
    firstImage: NULL_INDEX,
    huffOffset: 0,
    huffCount: 0,
    exthFlags: 0,
    extraFlags: 0,
    ncx: NULL_INDEX,
    fdst: NULL_INDEX,
    fdstCount: 0,
    frag: NULL_INDEX,
    skel: NULL_INDEX,
  };
  if (!h.hasMobi) return h;
  const has = (o: number) => rec.length >= o + 4;
  h.length = u32(rec, 20);
  h.codepage = u32(rec, 28);
  if (has(0x6c)) {
    h.minVersion = u32(rec, 0x68);
    h.firstImage = u32(rec, 0x6c);
  }
  if (has(0x58)) {
    h.nameOffset = u32(rec, 0x54);
    h.nameLength = u32(rec, 0x58);
  }
  if (has(0x74)) {
    h.huffOffset = u32(rec, 0x70);
    h.huffCount = u32(rec, 0x74);
  }
  if (has(0x80)) h.exthFlags = u32(rec, 0x80);
  if (h.length >= 0xe4 && h.length <= 500 && rec.length >= 0xf4) h.extraFlags = u16(rec, 0xf2);
  if (has(0xf4)) h.ncx = u32(rec, 0xf4);
  if (h.minVersion === 8 && rec.length >= 0xf8 + 16) {
    h.frag = u32(rec, 0xf8);
    h.skel = u32(rec, 0xfc);
    h.fdst = u32(rec, 0xc0);
    h.fdstCount = u32(rec, 0xc4);
    if (h.fdstCount <= 1) h.fdst = NULL_INDEX;
  }
  return h;
}

interface Exth {
  title?: Uint8Array;
  authors: Uint8Array[];
  cover?: number;
  kf8?: number;
}

function readExth(rec: Uint8Array, h: Header): Exth {
  const out: Exth = { authors: [] };
  if (!h.hasMobi || !(h.exthFlags & 0x40)) return out;
  const start = 16 + h.length;
  if (rec.length < start + 12 || tag(rec, start) !== 'EXTH') return out;
  const count = u32(rec, start + 8);
  let pos = start + 12;
  for (let i = 0; i < count && pos + 8 <= rec.length; i++) {
    const type = u32(rec, pos);
    const size = u32(rec, pos + 4);
    if (size < 8 || pos + size > rec.length) break;
    const data = rec.subarray(pos + 8, pos + size);
    if (type === 100) out.authors.push(data);
    else if (type === 503) out.title = data;
    else if (type === 201 && data.length >= 4) {
      const v = u32(data, 0);
      if (v !== NULL_INDEX) out.cover = v;
    } else if (type === 121 && data.length >= 4) {
      const v = u32(data, 0);
      if (v !== NULL_INDEX) out.kf8 = v;
    }
    pos += size;
  }
  return out;
}

// ------------------------------------------------------------ text records ---

/** Decode bytes the header says are `codepage`; books often lie about it, so a bad UTF-8 decode is rescued by detection. */
function decodeBytes(b: Uint8Array, codepage: number): string {
  if (codepage === 65001) {
    const text = new TextDecoder('utf-8').decode(b);
    let bad = 0;
    for (let i = text.indexOf('�'); i >= 0 && bad <= 3 + b.length / 2000; i = text.indexOf('�', i + 1)) bad++;
    return bad <= 3 + b.length / 2000 ? text : decodeText(b).text;
  }
  return decodeText(b).text;
}

async function readText(records: Uint8Array[], h: Header, base: number, onTick: () => Promise<void>, report?: (done: number) => void): Promise<Uint8Array> {
  if (h.encryption !== 0) throw new ImportError(KINDLE_DRM_MESSAGE);
  let unpack: (r: Uint8Array) => Uint8Array;
  if (h.compression === COMPRESSION_PALMDOC) unpack = palmdocDecompress;
  else if (h.compression === COMPRESSION_NONE) unpack = (r) => r;
  else if (h.compression === COMPRESSION_HUFF) {
    const first = base + h.huffOffset;
    const huff = new HuffReader(records.slice(first, first + h.huffCount));
    unpack = (r) => huff.unpack(r);
  } else throw new ImportError(BROKEN); // a value that is none of the three real ones is a damaged header

  const last = Math.min(base + h.textRecords, records.length - 1);
  const pieces: Uint8Array[] = [];
  let total = 0;
  for (let i = base + 1; i <= last; i++) {
    const rec = records[i];
    const text = rec.subarray(0, rec.length - trailingSize(rec, h.extraFlags));
    const out = unpack(text);
    pieces.push(out);
    total += out.length;
    report?.((i - base) / Math.max(1, last - base));
    await onTick();
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of pieces) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

// ------------------------------------------------------------------- images ---

function imageType(b: Uint8Array): { ext: string; mime: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x89 && tag(b, 1, 3) === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (tag(b, 0, 3) === 'GIF') return { ext: 'gif', mime: 'image/gif' };
  if (b[0] === 0x42 && b[1] === 0x4d && u32(b, 2) > 0) return { ext: 'bmp', mime: 'image/bmp' };
  if (tag(b, 0, 4) === 'RIFF' && tag(b, 8, 4) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Markup bytes to blocks; images are looked up by `resolve(src)`. */
function parseDoc(html: string, resolve: (src: string) => string | undefined, linkShare = true) {
  const doc = parseXhtml(html);
  const x = extractBlocks(doc, { resolveImage: resolve });
  return { ...x, generated: linkShare && x.linkCount >= 3 && x.linkShare > 0.7 };
}

// ------------------------------------------------------- contents (NCX) -----

interface NcxEntry {
  title: string;
  /** Byte offset into the text (MOBI 6), or -1. */
  pos: number;
  /** Fragment number and offset into it (KF8), or null. */
  posFid: [number, number] | null;
}

function readNcx(table: IndexTable): NcxEntry[] {
  const out: NcxEntry[] = [];
  for (const e of table.entries) {
    const label = e.tags.get(3)?.[0];
    const title = (label !== undefined ? table.cncx.get(label) : undefined) ?? '';
    const fid = e.tags.get(6);
    out.push({
      title: title.replace(/\s+/g, ' ').trim(),
      pos: e.tags.get(1)?.[0] ?? -1,
      posFid: fid && fid.length >= 2 ? [fid[0], fid[1]] : null,
    });
  }
  return out;
}

/** Insert an empty anchor at byte `pos`, moved out of any tag and off the middle of a UTF-8 character. */
function insertMarker(s: string, pos: number, id: string, utf8: boolean): string {
  let p = Math.max(0, Math.min(pos, s.length));
  const lt = s.lastIndexOf('<', p);
  const gt = s.lastIndexOf('>', p - 1);
  if (p < s.length && s[p] !== '<' && lt > gt) p = lt;
  if (utf8) while (p > 0 && p < s.length && (s.charCodeAt(p) & 0xc0) === 0x80) p--;
  const body = /<body\b[^>]*>/i.exec(s);
  if (body && p < body.index + body[0].length) p = body.index + body[0].length;
  return `${s.slice(0, p)}<a id="${id}"></a>${s.slice(p)}`;
}

function insertMarkers(s: string, marks: { pos: number; id: string }[], utf8: boolean): string {
  let out = s;
  // From the end backwards so earlier offsets stay valid.
  for (const m of [...marks].sort((a, b) => b.pos - a.pos)) out = insertMarker(out, m.pos, m.id, utf8);
  return out;
}

/** Source line breaks that turned into spaces between Chinese characters ("同謂之 玄") are noise. */
function tightenSpaces(chapters: Chapter[]): Chapter[] {
  const fix = (t: string): string => {
    if (!t.includes(' ')) return t;
    const cps = Array.from(t);
    let out = '';
    for (let i = 0; i < cps.length; i++) {
      if (cps[i] === ' ' && i > 0 && i + 1 < cps.length && cps[i - 1] !== ' ' && cps[i + 1] !== ' ' && spaceBetweenIsNoise(cps[i - 1].codePointAt(0)!, cps[i + 1].codePointAt(0)!)) continue;
      out += cps[i];
    }
    return out;
  };
  return chapters.map((c) => ({
    title: c.title,
    blocks: c.blocks.map((b) => (b.t === 'p' || b.t === 'quote' ? { ...b, text: fix(b.text) } : b)),
  }));
}

/** Leading chapters with no Chinese in them and no picture (a credit line, a license notice) are not part of the book. */
function dropLeadingNoise(chapters: Chapter[]): Chapter[] {
  let i = 0;
  while (i < chapters.length - 1 && chapters[i].blocks.every((b) => b.t !== 'img' && countHan(blockText(b)) === 0)) i++;
  return chapters.slice(i);
}

// -------------------------------------------------------------------- main ---

export async function importMobi(data: Uint8Array, sourceName: string, onProgress?: (fraction: number) => void): Promise<ImportedBook> {
  if (data.length > 4 && (tag(data, 0, 3) === 'TPZ' || tag(data, 0, 4) === '\xeaDRM')) {
    throw new ImportError('This is a Kindle format Dushu cannot read (Topaz or KFX). Use a DRM-free EPUB instead.');
  }
  if (!looksLikeMobi(data)) throw new ImportError('This file is not a valid Kindle (MOBI or AZW3) book.');

  const count = u16(data, 76);
  if (count < 2) throw new ImportError(BROKEN);
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = 78 + i * 8;
    if (at + 4 > data.length) throw new ImportError(BROKEN);
    const o = u32(data, at);
    // Records follow each other in the file; an offset that goes backwards (or repeats the first record's) means a damaged table.
    if (i > 0 && o < offsets[i - 1]) throw new ImportError(BROKEN);
    offsets.push(o);
  }
  if (offsets[1] === offsets[0]) throw new ImportError(BROKEN);
  const records: Uint8Array[] = offsets.map((o, i) => {
    const end = i + 1 < offsets.length ? offsets[i + 1] : data.length;
    if (o > data.length) throw new ImportError(BROKEN);
    return data.subarray(o, Math.max(o, Math.min(end, data.length)));
  });

  let lastTick = Date.now();
  const onTick = async () => {
    if (Date.now() - lastTick > 30) {
      await tick();
      lastTick = Date.now();
    }
  };

  const rec0 = records[0];
  const h0 = readHeader(rec0);
  const exth0 = readExth(rec0, h0);
  if (h0.encryption !== 0) throw new ImportError(KINDLE_DRM_MESSAGE);

  // ---- which half to read
  let kfBase = -1;
  if (h0.minVersion === 8 && h0.skel !== NULL_INDEX) kfBase = 0;
  else if (exth0.kf8 !== undefined && exth0.kf8 > 0 && exth0.kf8 < records.length && tag(records[exth0.kf8 - 1], 0, 8) === 'BOUNDARY') kfBase = exth0.kf8;
  const h = kfBase >= 0 ? readHeader(records[kfBase]) : h0;
  const exth = kfBase > 0 ? readExth(records[kfBase], h) : exth0;
  if (h.encryption !== 0) throw new ImportError(KINDLE_DRM_MESSAGE);
  onProgress?.(0.03);

  const decode = (b: Uint8Array) => decodeBytes(b, h.codepage);
  const utf8 = h.codepage === 65001;

  // ---- title and author
  let titleBytes = exth.title ?? exth0.title;
  if (!titleBytes && h0.nameLength > 0 && h0.nameOffset + h0.nameLength <= rec0.length) titleBytes = rec0.subarray(h0.nameOffset, h0.nameOffset + h0.nameLength);
  if (!titleBytes) {
    const name = data.subarray(0, 32);
    const end = name.indexOf(0);
    titleBytes = end >= 0 ? name.subarray(0, end) : name;
  }
  const fromFile = parseFilename(sourceName);
  const title = cleanTitle(titleBytes ? decode(titleBytes) : '') || fromFile.title || 'Untitled';
  const authorBytes = exth.authors.length ? exth.authors : exth0.authors;
  const author = cleanAuthors(authorBytes.map(decode));

  // ---- plain PalmDOC text with no MOBI header
  if (!h.hasMobi) {
    const text = await readText(records, h, 0, onTick);
    return { ...bookFromText(decodeText(text).text, { format: 'mobi', sourceName, title, author }) };
  }

  // ---- text
  const text = await readText(records, h, kfBase > 0 ? kfBase : 0, onTick, (f) => onProgress?.(0.03 + 0.37 * f));
  onProgress?.(0.4);

  const store = new AssetStore();
  const imageAsset = (recordIndex: number): string | undefined => {
    const rec = records[recordIndex];
    if (!rec) return undefined;
    const type = imageType(rec);
    return type ? store.add(`rec${recordIndex}`, `image-${String(recordIndex).padStart(5, '0')}.${type.ext}`, rec) : undefined;
  };

  let chapters: Chapter[];
  let cover: string | undefined;

  if (kfBase < 0) {
    // ------------------------------------------------------------- MOBI 6 ---
    const firstImage = h.firstImage === NULL_INDEX || h.firstImage >= records.length ? -1 : h.firstImage;
    const ncx: NcxEntry[] = [];
    if (h.ncx !== NULL_INDEX) {
      try {
        ncx.push(...readNcx(readIndex((n) => records[n], h.ncx, decode)));
      } catch {
        // no usable contents index: headings are used instead
      }
    }
    const marks = ncx.map((e, i) => ({ pos: e.pos, id: `dushu-toc-${i}`, i })).filter((m) => m.pos >= 0 && m.pos <= text.length);
    let markup = insertMarkers(toBinary(text), marks, utf8);
    markup = markup.replace(/\0/g, '');
    let html = decodeBytes(fromBinary(markup), h.codepage);
    html = html
      .replace(/<\/?mbp:[^>]*>/gi, '')
      .replace(/<img\b([^>]*?)\b(?:recindex|hirecindex|lowrecindex)\s*=\s*["']?0*(\d+)["']?/gi, (_m, pre: string, n: string) => `<img${pre} src="kindle:img:${n}"`);
    onProgress?.(0.5);
    await tick();

    const doc = parseDoc(html, (src) => {
      const m = /^kindle:img:(\d+)$/.exec(src);
      return m && firstImage >= 0 ? imageAsset(firstImage + Number(m[1]) - 1) : undefined;
    }, false);
    onProgress?.(0.85);

    const refs: TocRef[] = marks.map((m) => ({ doc: 0, frag: m.id, title: ncx[m.i].title }));
    const anchored = new Set(refs.map((r) => doc.anchors.get(r.frag) ?? 0));
    if (anchored.size >= 2) {
      const spine: SpineDoc = { path: 'text', blocks: doc.blocks, anchors: doc.anchors, skipped: false };
      chapters = chaptersFromSpine([spine], refs);
    } else {
      chapters = chaptersFromBlocks(doc.blocks, { title });
    }

    if (exth.cover !== undefined && firstImage >= 0) cover = imageAsset(firstImage + exth.cover);
    if (!cover && firstImage >= 0) {
      for (let i = firstImage; i < Math.min(records.length, firstImage + 400) && !cover; i++) cover = imageAsset(i);
    }
  } else {
    // ---------------------------------------------------------------- KF8 ---
    const sec = (n: number) => records[kfBase + n];
    const binary = toBinary(text);

    // flows: the first is the markup, the rest are style sheets and SVG
    let flowTable: [number, number][] = [];
    if (h.fdst !== NULL_INDEX) {
      const r = sec(h.fdst);
      if (r && tag(r, 0, 4) === 'FDST') {
        const start = u32(r, 4);
        const n = u32(r, 8);
        for (let i = 0; i < n && start + i * 8 + 8 <= r.length; i++) flowTable.push([u32(r, start + i * 8), u32(r, start + i * 8 + 4)]);
      }
    }
    if (!flowTable.length) flowTable = [[0, binary.length]];
    const flows = flowTable.map(([a, b]) => binary.slice(a, b));
    const main = flows[0];

    // skeleton and fragment tables
    const latin = (b: Uint8Array) => toBinary(b);
    let files: { start: number; length: number; frags: number }[] = [];
    let frags: { insert: number; length: number; aid: string }[] = [];
    try {
      const skel = readIndex(sec, h.skel, latin);
      files = skel.entries.map((e) => ({ start: e.tags.get(6)?.[0] ?? 0, length: e.tags.get(6)?.[1] ?? 0, frags: e.tags.get(1)?.[0] ?? 0 }));
      if (h.frag !== NULL_INDEX) {
        const fr = readIndex(sec, h.frag, latin);
        frags = fr.entries.map((e) => {
          const idText = fr.cncx.get(e.tags.get(2)?.[0] ?? -1) ?? '';
          return { insert: Number(e.key) || 0, length: e.tags.get(6)?.[1] ?? 0, aid: idText.slice(12, -2) };
        });
      }
    } catch {
      throw new ImportError(BROKEN);
    }
    if (!files.length) throw new ImportError(BROKEN);

    // rebuild each XHTML file: the skeleton with its fragments put back
    const parts: string[] = [];
    const partStart: number[] = [];
    const partEnd: number[] = [];
    let fragAt = 0;
    for (const f of files) {
      let ptr = f.start + f.length;
      let skeleton = main.slice(f.start, ptr);
      for (let i = 0; i < f.frags && fragAt < frags.length; i++, fragAt++) {
        const fr = frags[fragAt];
        const piece = main.slice(ptr, ptr + fr.length);
        const at = Math.max(0, Math.min(fr.insert - f.start, skeleton.length));
        skeleton = skeleton.slice(0, at) + piece + skeleton.slice(at);
        ptr += fr.length;
      }
      parts.push(skeleton);
      partStart.push(f.start);
      partEnd.push(ptr);
    }
    onProgress?.(0.5);
    await onTick();

    // contents entries become anchors
    const ncx: NcxEntry[] = [];
    if (h.ncx !== NULL_INDEX) {
      try {
        ncx.push(...readNcx(readIndex(sec, h.ncx, decode)));
      } catch {
        // no usable contents index
      }
    }
    const marksByPart: { pos: number; id: string }[][] = parts.map(() => []);
    const tocRefs: { part: number; id: string; title: string }[] = [];
    ncx.forEach((e, i) => {
      let abs = -1;
      if (e.posFid) {
        const fr = frags[e.posFid[0]];
        if (fr) abs = fr.insert + e.posFid[1];
      } else if (e.pos >= 0) abs = e.pos;
      if (abs < 0) return;
      const p = partStart.findIndex((s, k) => abs >= s && abs < partEnd[k]);
      if (p < 0) return;
      const id = `dushu-toc-${i}`;
      marksByPart[p].push({ pos: abs - partStart[p], id });
      tocRefs.push({ part: p, id, title: e.title });
    });

    // resources: every record after the text, in order; kindle:embed:N is the Nth
    const resources: (number | null)[] = [];
    const firstResource = (first: number, textRecords: number, firstText: number) => (first === NULL_INDEX ? textRecords + firstText : first);
    const addRange = (a: number, b: number) => {
      for (let i = a; i < b && i < records.length; i++) resources.push(imageType(records[i]) ? i : null);
    };
    if (kfBase > 0) {
      addRange(firstResource(h0.firstImage, h0.textRecords, 1), kfBase - 1);
      addRange(firstResource(h.firstImage === NULL_INDEX ? NULL_INDEX : h.firstImage + kfBase, h.textRecords, kfBase + 1), records.length);
    } else addRange(firstResource(h.firstImage, h.textRecords, 1), records.length);

    const embedded = (src: string): string | undefined => {
      const m = /kindle:embed:([0-9A-Va-v]+)/.exec(src);
      if (m) {
        const rec = resources[parseInt(m[1], 32) - 1];
        return rec == null ? undefined : imageAsset(rec);
      }
      const flow = /kindle:flow:([0-9A-Va-v]+)/.exec(src);
      if (flow) {
        // an SVG wrapper around a picture (cover pages)
        const svg = flows[parseInt(flow[1], 32)];
        const inner = svg ? /kindle:embed:([0-9A-Va-v]+)/.exec(svg) : null;
        const rec = inner ? resources[parseInt(inner[1], 32) - 1] : null;
        return rec == null ? undefined : imageAsset(rec);
      }
      return undefined;
    };

    const tocParts = new Set(tocRefs.map((r) => r.part));
    const docs: SpineDoc[] = [];
    for (let i = 0; i < parts.length; i++) {
      const markup = insertMarkers(parts[i], marksByPart[i], true);
      const x = parseDoc(decodeBytes(fromBinary(markup), h.codepage), embedded);
      docs.push({ path: `part${i}`, blocks: x.generated && !tocParts.has(i) ? [] : x.blocks, anchors: x.anchors, skipped: x.generated && !tocParts.has(i) });
      onProgress?.(0.5 + 0.4 * ((i + 1) / parts.length));
      await onTick();
    }

    const refs: TocRef[] = tocRefs.map((r) => ({ doc: r.part, frag: r.id, title: r.title }));
    const positions = new Set(refs.map((r) => `${r.doc}:${docs[r.doc].anchors.get(r.frag) ?? 0}`));
    if (positions.size >= 2) chapters = chaptersFromSpine(docs, refs);
    else chapters = chaptersFromBlocks(docs.flatMap((d) => d.blocks), { title });

    if (exth.cover !== undefined) {
      const rec = resources[exth.cover];
      if (rec != null) cover = imageAsset(rec);
    }
    if (!cover) {
      const first = resources.find((r) => r != null);
      if (first != null) cover = imageAsset(first);
    }
  }

  onProgress?.(0.97);
  const ext = /\.([A-Za-z0-9]+)$/.exec(sourceName)?.[1]?.toLowerCase() ?? '';
  const isAzw3 = kfBase === 0 || (kfBase > 0 && (ext === 'azw3' || ext === 'azw'));
  return {
    title,
    author,
    format: isAzw3 ? 'azw3' : 'mobi',
    script: 'unknown',
    chapters: dropTitlePage(finalizeChapters(dropLeadingNoise(stripGutenberg(tightenSpaces(chapters), title))), title, author),
    assets: store.assets,
    cover,
    sourceName,
  };
}

