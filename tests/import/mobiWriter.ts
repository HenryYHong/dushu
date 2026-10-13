// A small MOBI / AZW3 writer for tests: PalmDB container, MOBI header, EXTH, PalmDOC / HUFF-CDIC text
// records with trailing entries, INDX contents tables, KF8 skeleton / fragment tables. It writes only what
// the importer reads, from the published layout of the format. All content is generated.

const enc = (s: string) => new TextEncoder().encode(s);
const NULL = 0xffffffff;

export const be16 = (n: number) => [(n >> 8) & 255, n & 255];
export const be32 = (n: number) => [Math.floor(n / 0x1000000) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

export function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function put32(b: Uint8Array, at: number, n: number) {
  b.set(be32(n), at);
}

// ------------------------------------------------------------- compression ---

/** PalmDOC compression, the plain way: back-references of 3..10 bytes, space + letter pairs, binary runs. */
export function palmdocCompress(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    if (i > 10 && data.length - i > 10) {
      let match = -1;
      let n = 0;
      for (let j = 10; j > 2 && match < 0; j--) {
        const chunk = data.subarray(i, i + j);
        for (let k = i - 1; k >= 0 && i - k <= 2047; k--) {
          let ok = true;
          for (let q = 0; q < j && ok; q++) if (data[k + q] !== chunk[q]) ok = false;
          if (ok) {
            match = k;
            n = j;
            break;
          }
        }
      }
      if (match >= 0) {
        const m = i - match;
        const code = 0x8000 + ((m << 3) & 0x3ff8) + (n - 3);
        out.push(code >> 8, code & 255);
        i += n;
        continue;
      }
    }
    const ch = data[i++];
    if (ch === 0x20 && i + 1 < data.length && data[i] >= 0x40 && data[i] < 0x80) {
      out.push(data[i] ^ 0x80);
      i++;
      continue;
    }
    if (ch === 0 || (ch > 8 && ch < 0x80)) {
      out.push(ch);
    } else {
      const seq = [ch];
      let j = i;
      while (j < data.length && seq.length < 8) {
        const c = data[j];
        if (c === 0 || (c > 8 && c < 0x80)) break;
        seq.push(c);
        j++;
      }
      out.push(seq.length, ...seq);
      i += seq.length - 1;
    }
  }
  return Uint8Array.from(out);
}

/** A HUFF record and CDIC record(s) with a fixed 8-bit code: phrase i is coded as byte 255 - i. */
export function huffTables(text: Uint8Array): { huff: Uint8Array; cdic: Uint8Array; encode: (rec: Uint8Array) => Uint8Array } {
  // dictionary: every distinct 3-byte UTF-8 character and every other byte that occurs, up to 254 entries,
  // plus one phrase that is itself coded (the four bytes "</p>") to exercise the recursive case
  const phrases: Uint8Array[] = [];
  const index = new Map<string, number>();
  const add = (p: Uint8Array) => {
    const k = Array.from(p).join(',');
    if (!index.has(k)) {
      if (phrases.length >= 254) throw new Error('too many distinct characters for the test dictionary');
      index.set(k, phrases.length);
      phrases.push(p);
    }
  };
  for (const c of '</p>') add(enc(c));
  for (let i = 0; i < text.length; ) {
    if (text[i] >= 0xe0 && text[i] < 0xf0 && i + 2 < text.length) {
      add(text.subarray(i, i + 3));
      i += 3;
    } else add(text.subarray(i, i++ + 1));
  }
  const coded = Uint8Array.from([...'</p>'].map((c) => 255 - index.get(String(c.charCodeAt(0)))!));
  const codedIndex = phrases.length;
  phrases.push(coded);
  const flags = phrases.map((_, i) => i !== codedIndex);

  const huff = new Uint8Array(24 + 1024 + 256);
  huff.set(ascii('HUFF'), 0);
  put32(huff, 4, 0x18);
  put32(huff, 8, 24);
  put32(huff, 12, 24 + 1024);
  for (let i = 0; i < 256; i++) {
    // codelen 8, terminal, maxcode field 255
    put32(huff, 24 + i * 4, ((255 << 8) | 0x80 | 8) >>> 0);
  }
  const n = phrases.length;
  const offsets: number[] = [];
  const body: number[] = [];
  let off = n * 2;
  phrases.forEach((p, i) => {
    offsets.push(off);
    const len = p.length | (flags[i] ? 0x8000 : 0);
    body.push(...be16(len), ...p);
    off += 2 + p.length;
  });
  const cdic = concat(ascii('CDIC'), be32(0x10), be32(n), be32(8), offsets.flatMap(be16), body);

  const lookup = (p: Uint8Array) => index.get(Array.from(p).join(','));
  const encode = (rec: Uint8Array): Uint8Array => {
    const out: number[] = [];
    for (let i = 0; i < rec.length; ) {
      if (rec[i] === 0x3c && rec[i + 1] === 0x2f && rec[i + 2] === 0x70 && rec[i + 3] === 0x3e) {
        out.push(255 - codedIndex);
        i += 4;
        continue;
      }
      let hit: number | undefined;
      let len = 1;
      if (rec[i] >= 0xe0 && rec[i] < 0xf0 && i + 2 < rec.length) {
        hit = lookup(rec.subarray(i, i + 3));
        len = 3;
      }
      if (hit === undefined) {
        hit = lookup(rec.subarray(i, i + 1));
        len = 1;
      }
      if (hit === undefined) throw new Error(`byte ${rec[i]} is not in the dictionary`);
      out.push(255 - hit);
      i += len;
    }
    return Uint8Array.from(out);
  };
  return { huff, cdic, encode };
}

// ---------------------------------------------------------------- indexes ---

const encint = (n: number): number[] => {
  const bytes = [n & 0x7f];
  for (let v = n >> 7; v > 0; v >>= 7) bytes.unshift(v & 0x7f);
  bytes[bytes.length - 1] |= 0x80;
  return bytes;
};

export interface TagDef {
  tag: number;
  values: number;
  mask: number;
}

export interface IndexSpec {
  tags: TagDef[];
  /** key and tag number to values */
  entries: { key: string; values: Record<number, number[]> }[];
  /** compiled strings; their offsets are returned by `cncxOffsets` */
  strings?: string[];
}

/** Records for one index: the header record, data records, then CNCX records. */
export function indexRecords(spec: IndexSpec, perRecord = 3): { records: Uint8Array[]; cncxOffsets: number[] } {
  const tagxBody: number[] = [];
  for (const t of spec.tags) tagxBody.push(t.tag, t.values, t.mask, 0);
  tagxBody.push(0, 0, 0, 1);
  const tagx = concat(ascii('TAGX'), be32(12 + tagxBody.length), be32(1), tagxBody);

  // CNCX
  const cncxOffsets: number[] = [];
  const cncxBytes: number[] = [];
  for (const s of spec.strings ?? []) {
    cncxOffsets.push(cncxBytes.length);
    const b = enc(s);
    cncxBytes.push(...encint(b.length), ...b);
  }
  const cncx = spec.strings?.length ? [Uint8Array.from(cncxBytes)] : [];

  const header = (len: number, start: number, count: number, ncncx: number, tagxAt: number) => {
    const h = new Uint8Array(192);
    h.set(ascii('INDX'), 0);
    put32(h, 4, 192);
    put32(h, 4 + 4 * 4, start);
    put32(h, 4 + 4 * 5, count);
    put32(h, 4 + 4 * 6, 65001);
    put32(h, 4 + 4 * 7, NULL);
    put32(h, 4 + 4 * 8, spec.entries.length);
    put32(h, 4 + 4 * 12, ncncx);
    put32(h, 4 + 4 * 44, tagxAt);
    return h;
  };

  const groups: IndexSpec['entries'][] = [];
  for (let i = 0; i < spec.entries.length; i += perRecord) groups.push(spec.entries.slice(i, i + perRecord));
  if (!groups.length) groups.push([]);

  const data = groups.map((group) => {
    const entries: number[][] = group.map((e) => {
      let control = 0;
      const vals: number[] = [];
      for (const t of spec.tags) {
        const v = e.values[t.tag];
        if (!v) continue;
        control |= t.mask & -t.mask; // count 1: the lowest bit of the mask
        for (const x of v) vals.push(...encint(x));
      }
      return [e.key.length, ...ascii(e.key), control, ...vals];
    });
    let pos = 192;
    const idxt: number[] = [];
    const flat: number[] = [];
    for (const e of entries) {
      idxt.push(pos);
      flat.push(...e);
      pos += e.length;
    }
    while (pos % 4) {
      flat.push(0);
      pos++;
    }
    const table = concat(ascii('IDXT'), idxt.flatMap(be16));
    const h = header(192, pos, group.length, 0, 0);
    return concat(h, flat, table, new Array((4 - (table.length % 4)) % 4).fill(0));
  });

  const primaryHead = header(192, 192 + tagx.length, data.length, cncx.length, 192);
  const primary = concat(primaryHead, tagx);
  return { records: [primary, ...data, ...cncx], cncxOffsets };
}

// ----------------------------------------------------------- record builder ---

export interface BuildOptions {
  title?: string;
  author?: string | string[];
  codepage?: number;
  /** Bytes of the text as stored (default: UTF-8 of the markup). */
  textBytes?: Uint8Array;
  compression?: 'none' | 'palmdoc' | 'huff';
  /** Extra-data flags written into the header, and trailing data added to every record to match. */
  extraFlags?: number;
  encryption?: number;
  coverOffset?: number;
  /** Image records (after the text records) */
  images?: Uint8Array[];
  /** Extra tail records (e.g. a FLIS record) before the images are not needed; keep false */
  withFullName?: boolean;
  /** Contents index entries: byte offset in the text and label (MOBI 6). */
  ncx?: { pos: number; title: string; level?: number }[];
  /** A MOBI 6 file with this many bytes of record 0 before the MOBI header ends (default 232). */
  headerLength?: number;
  /** An old PalmDOC text file: a 16-byte record 0 and no MOBI header. */
  palmOnly?: boolean;
}

const RECORD = 4096;

function exthBlock(items: [number, Uint8Array | number[]][]): Uint8Array {
  const body: number[] = [];
  for (const [type, data] of items) body.push(...be32(type), ...be32(8 + data.length), ...data);
  let len = 12 + body.length;
  const pad = (4 - (len % 4)) % 4;
  len += pad;
  return concat(ascii('EXTH'), be32(len), be32(items.length), body, new Array(pad).fill(0));
}

function palmDb(name: string, records: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(78);
  header.set(enc(name).subarray(0, 31), 0);
  header.set(ascii('BOOKMOBI'), 60);
  put32(header, 68, 2 * records.length - 1);
  header.set(be16(records.length), 76);
  let off = 78 + records.length * 8 + 2;
  const list: number[] = [];
  records.forEach((r, i) => {
    list.push(...be32(off), 0, ...be32(2 * i).slice(1));
    off += r.length;
  });
  return concat(header, list, [0, 0], ...records);
}

/** Text records: chunks of 4096 bytes compressed and given trailing data to match `extraFlags`. */
function textRecords(text: Uint8Array, o: BuildOptions): { records: Uint8Array[]; extra: Uint8Array[] } {
  const flags = o.extraFlags ?? 0;
  const tables = o.compression === 'huff' ? huffTables(text) : null;
  const records: Uint8Array[] = [];
  for (let at = 0; at < text.length; at += RECORD) {
    const chunk = text.subarray(at, Math.min(at + RECORD, text.length));
    let body: Uint8Array = chunk;
    if (o.compression === 'palmdoc') body = palmdocCompress(chunk);
    else if (tables) body = tables.encode(chunk);
    const trail: number[] = [];
    // multibyte overlap (bit 0): the bytes of a character that runs into the next record, then a size byte
    if (flags & 1) {
      const next = text.subarray(at + RECORD, at + RECORD + 2);
      trail.push(...next, next.length);
    }
    // other entries: data then a one-byte size with the top bit set; the lowest set bit ends up last
    for (let bit = 15; bit >= 1; bit--) {
      if (flags & (1 << bit)) {
        const data = [0x11, 0x22, 0x33].slice(0, (bit % 3) + 1);
        trail.push(...data, 0x80 | (data.length + 1));
      }
    }
    records.push(concat(body, trail));
  }
  const extra = tables ? [tables.huff, tables.cdic] : [];
  return { records, extra };
}

export function buildMobi(markup: string, o: BuildOptions = {}): Uint8Array {
  const text = o.textBytes ?? enc(markup);
  const compression = o.compression ?? 'palmdoc';
  const { records: textRecs, extra } = textRecords(text, { ...o, compression });
  const images = o.images ?? [];
  const headerLength = o.headerLength ?? 232;
  if (o.palmOnly) {
    const r0 = new Uint8Array(16);
    r0.set(be16(compression === 'none' ? 1 : 2), 0);
    put32(r0, 4, text.length);
    r0.set(be16(textRecs.length), 8);
    r0.set(be16(RECORD), 10);
    const db = palmDb(o.title ?? 'Test', [r0, ...textRecs]);
    db.set(ascii('TEXTREAD'), 60);
    return db;
  }

  // contents index (after the text, before the images)
  const tail: Uint8Array[] = [];
  let ncxIndex = NULL;
  const ncx = o.ncx ?? [];
  if (ncx.length) {
    const spec: IndexSpec = {
      tags: [
        { tag: 1, values: 1, mask: 1 },
        { tag: 2, values: 1, mask: 2 },
        { tag: 3, values: 1, mask: 4 },
        { tag: 4, values: 1, mask: 8 },
      ],
      entries: [],
      strings: ncx.map((e) => e.title),
    };
    const { cncxOffsets } = indexRecords(spec);
    spec.entries = ncx.map((e, i) => ({ key: i.toString(16).padStart(3, '0'), values: { 1: [e.pos], 2: [0], 3: [cncxOffsets[i]], 4: [e.level ?? 0] } }));
    const built = indexRecords(spec);
    ncxIndex = 1 + textRecs.length + extra.length;
    tail.push(...built.records);
  }

  const firstImage = images.length ? 1 + textRecs.length + extra.length + tail.length : NULL;
  const title = o.title ?? 'Test';
  const authors = Array.isArray(o.author) ? o.author : o.author ? [o.author] : [];
  const exthItems: [number, Uint8Array | number[]][] = [...authors.map((a) => [100, enc(a)] as [number, Uint8Array]), [503, enc(title)]];
  if (o.coverOffset !== undefined) exthItems.push([201, be32(o.coverOffset)]);
  const exth = exthBlock(exthItems);

  const base = 16 + headerLength;
  const nameAt = base + exth.length;
  const nameBytes = enc(title);
  const rec0 = new Uint8Array(nameAt + nameBytes.length + 2);
  const compCode = compression === 'none' ? 1 : compression === 'palmdoc' ? 2 : 17480;
  rec0.set(be16(compCode), 0);
  put32(rec0, 4, text.length);
  rec0.set(be16(textRecs.length), 8);
  rec0.set(be16(RECORD), 10);
  rec0.set(be16(o.encryption ?? 0), 12);
  rec0.set(ascii('MOBI'), 16);
  put32(rec0, 20, headerLength);
  put32(rec0, 24, 2);
  put32(rec0, 28, o.codepage ?? 65001);
  put32(rec0, 36, 6);
  put32(rec0, 0x68, 6);
  put32(rec0, 0x54, nameAt);
  put32(rec0, 0x58, nameBytes.length);
  put32(rec0, 0x6c, firstImage);
  if (compression === 'huff') {
    put32(rec0, 0x70, 1 + textRecs.length);
    put32(rec0, 0x74, extra.length);
  }
  put32(rec0, 0x80, 0x40);
  rec0.set(be16(o.extraFlags ?? 0), 0xf2);
  put32(rec0, 0xf4, ncxIndex);
  rec0.set(exth, base);
  rec0.set(nameBytes, nameAt);

  return palmDb(title, [rec0, ...textRecs, ...extra, ...tail, ...images]);
}

// ---------------------------------------------------------------------- KF8 ---

export interface Kf8Options {
  title?: string;
  author?: string;
  /** Body markup of each XHTML file. Images are referenced as kindle:embed:NNNN (base32, 1-based). */
  files: string[];
  /** Split each file body into at most this many fragments (at </p> boundaries). */
  fragsPerFile?: number;
  /** Contents entries: file, byte offset into that file's body, label, nesting level. */
  toc?: { file: number; offset: number; title: string; level?: number }[];
  images?: Uint8Array[];
  coverOffset?: number;
  encryption?: number;
  /** Add a style sheet flow and an SVG flow after the markup flow (exercises the FDST table). */
  extraFlows?: boolean;
  /** Wrap in a combined MOBI 6 + KF8 file; the MOBI 6 half carries this markup and these images. */
  joint?: { markup: string; images?: Uint8Array[] };
  extraFlags?: number;
}

const SKELETON = (n: number) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>part ${n}</title><link rel="stylesheet" type="text/css" href="kindle:flow:0001?mime=text/css"/></head><body aid="${n}"></body></html>`;

function splitBody(body: string, n: number): string[] {
  const cut = body.split(/(?<=<\/p>|<\/h\d>)/);
  if (n <= 1 || cut.length <= 1) return [body];
  const per = Math.ceil(cut.length / n);
  const out: string[] = [];
  for (let i = 0; i < cut.length; i += per) out.push(cut.slice(i, i + per).join(''));
  return out;
}

export function buildKf8(o: Kf8Options): { bytes: Uint8Array; kf8Record: number } {
  const title = o.title ?? 'Test';
  const joint = o.joint;

  // ---- flow 0: skeletons and fragments
  let text: Uint8Array = new Uint8Array(0);
  const skel: { start: number; length: number; frags: number }[] = [];
  const frags: { insert: number; length: number; file: number; seq: number; startInBody: number; file0: number }[] = [];
  o.files.forEach((body, fi) => {
    const skeleton = enc(SKELETON(fi));
    const at = text.length;
    const rel = enc(SKELETON(fi).slice(0, SKELETON(fi).indexOf('</body>'))).length;
    const parts = splitBody(body, o.fragsPerFile ?? 1);
    skel.push({ start: at, length: skeleton.length, frags: parts.length });
    let pos = rel;
    let bodyAt = 0;
    const pieces = parts.map(enc);
    parts.forEach((p, k) => {
      frags.push({ insert: at + pos, length: pieces[k].length, file: fi, seq: k, startInBody: bodyAt, file0: at });
      pos += pieces[k].length;
      bodyAt += pieces[k].length;
    });
    text = concat(text, skeleton, ...pieces);
  });

  const flows: Uint8Array[] = [text];
  if (o.extraFlows) {
    flows.push(enc('p { margin: 0; }'));
    flows.push(enc('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="kindle:embed:0001?mime=image/jpeg"/></svg>'));
  }
  const fdstPairs: number[] = [];
  let flowAt = 0;
  for (const f of flows) {
    fdstPairs.push(...be32(flowAt), ...be32(flowAt + f.length));
    flowAt += f.length;
  }
  const fdst = concat(ascii('FDST'), be32(12), be32(flows.length), fdstPairs);
  const all = concat(...flows);

  const textRecs = textRecords(all, { extraFlags: o.extraFlags, compression: 'palmdoc' }).records;

  // ---- indexes
  const skelSpec: IndexSpec = {
    tags: [
      { tag: 1, values: 1, mask: 1 },
      { tag: 6, values: 2, mask: 4 },
    ],
    entries: skel.map((s, i) => ({ key: `SKEL${String(i).padStart(10, '0')}`, values: { 1: [s.frags], 6: [s.start, s.length] } })),
  };
  const fragStrings = frags.map((_, i) => `P-//*[@aid='${i}']`);
  const fragSpec: IndexSpec = {
    tags: [
      { tag: 2, values: 1, mask: 1 },
      { tag: 3, values: 1, mask: 2 },
      { tag: 4, values: 1, mask: 4 },
      { tag: 6, values: 2, mask: 8 },
    ],
    entries: [],
    strings: fragStrings,
  };
  const fragOffsets = indexRecords(fragSpec).cncxOffsets;
  fragSpec.entries = frags.map((f, i) => ({ key: String(f.insert), values: { 2: [fragOffsets[i]], 3: [f.file], 4: [f.seq], 6: [f.startInBody, f.length] } }));

  const toc = o.toc ?? [];
  const ncxSpec: IndexSpec = {
    tags: [
      { tag: 2, values: 1, mask: 1 },
      { tag: 3, values: 1, mask: 2 },
      { tag: 4, values: 1, mask: 4 },
      { tag: 6, values: 2, mask: 8 },
    ],
    entries: [],
    strings: toc.map((t) => t.title),
  };
  const ncxOffsets = indexRecords(ncxSpec).cncxOffsets;
  ncxSpec.entries = toc.map((t, i) => {
    const inFile = frags.map((f, gi) => ({ f, gi })).filter((x) => x.f.file === t.file);
    let hit = inFile[0];
    for (const x of inFile) if (x.f.startInBody <= t.offset) hit = x;
    return { key: i.toString(16).padStart(3, '0'), values: { 2: [0], 3: [ncxOffsets[i]], 4: [t.level ?? 0], 6: [hit.gi, t.offset - hit.f.startInBody] } };
  });

  const skelRecs = indexRecords(skelSpec).records;
  const fragRecs = indexRecords(fragSpec).records;
  const ncxRecs = toc.length ? indexRecords(ncxSpec).records : [];

  // ---- record 0 of the KF8 half
  const images = o.images ?? [];
  const textCount = textRecs.length;
  const fdstAt = 1 + textCount;
  const skelAt = fdstAt + 1;
  const fragAt = skelAt + skelRecs.length;
  const ncxAt = fragAt + fragRecs.length;
  const firstImage = ncxAt + ncxRecs.length; // relative to this record 0
  const exthItems: [number, Uint8Array | number[]][] = [[503, enc(title)]];
  if (o.author) exthItems.push([100, enc(o.author)]);
  if (o.coverOffset !== undefined) exthItems.push([201, be32(o.coverOffset)]);
  const exth = exthBlock(exthItems);
  const headerLength = 264;
  const base = 16 + headerLength;
  const rec0 = new Uint8Array(base + exth.length + 8);
  rec0.set(be16(2), 0);
  put32(rec0, 4, all.length);
  rec0.set(be16(textCount), 8);
  rec0.set(be16(RECORD), 10);
  rec0.set(be16(o.encryption ?? 0), 12);
  rec0.set(ascii('MOBI'), 16);
  put32(rec0, 20, headerLength);
  put32(rec0, 24, 2);
  put32(rec0, 28, 65001);
  put32(rec0, 36, 8);
  put32(rec0, 0x68, 8);
  put32(rec0, 0x54, base + exth.length);
  put32(rec0, 0x58, 0);
  put32(rec0, 0x6c, images.length ? firstImage : NULL);
  put32(rec0, 0x80, 0x40);
  put32(rec0, 0xc0, o.extraFlows ? fdstAt : NULL);
  put32(rec0, 0xc4, flows.length);
  rec0.set(be16(o.extraFlags ?? 0), 0xf2);
  put32(rec0, 0xf4, toc.length ? ncxAt : NULL);
  put32(rec0, 0xf8, fragAt);
  put32(rec0, 0xfc, skelAt);
  put32(rec0, 0x100, NULL);
  put32(rec0, 0x104, NULL);
  rec0.set(exth, base);

  const kf8Records = [rec0, ...textRecs, ...(o.extraFlows ? [fdst] : [fdstPlaceholder()]), ...skelRecs, ...fragRecs, ...ncxRecs, ...images];

  if (!joint) return { bytes: palmDb(title, kf8Records), kf8Record: 0 };

  // ---- combined file: MOBI 6 half, BOUNDARY, KF8 half
  const m6 = buildMobi(joint.markup, { title, images: joint.images ?? [], coverOffset: o.coverOffset });
  const m6Records = readRecords(m6);
  const boundary = enc('BOUNDARY');
  // EXTH 121 in the MOBI 6 record 0 points at the KF8 record 0
  const kf8Index = m6Records.length + 1;
  m6Records[0] = withExth121(m6Records[0], kf8Index);
  return { bytes: palmDb(title, [...m6Records, boundary, ...kf8Records]), kf8Record: kf8Index };
}

function fdstPlaceholder(): Uint8Array {
  return concat(ascii('FDST'), be32(12), be32(0));
}

function readRecords(file: Uint8Array): Uint8Array[] {
  const dv = new DataView(file.buffer, file.byteOffset, file.length);
  const n = dv.getUint16(76);
  const offs = Array.from({ length: n }, (_, i) => dv.getUint32(78 + i * 8));
  return offs.map((o, i) => file.slice(o, i + 1 < n ? offs[i + 1] : file.length));
}

/** Rewrite record 0 of a MOBI 6 file with an extra EXTH record 121 (KF8 boundary). */
function withExth121(rec0: Uint8Array, kf8: number): Uint8Array {
  const dv = new DataView(rec0.buffer, rec0.byteOffset, rec0.length);
  const hdrLen = dv.getUint32(20);
  const exthAt = 16 + hdrLen;
  const exthLen = dv.getUint32(exthAt + 4);
  const count = dv.getUint32(exthAt + 8);
  const item = [...be32(121), ...be32(12), ...be32(kf8)];
  let end = exthAt + 12;
  for (let i = 0; i < count; i++) end += dv.getUint32(end + 4);
  const items = rec0.subarray(exthAt + 12, end);
  let len = 12 + items.length + item.length;
  const pad = (4 - (len % 4)) % 4;
  len += pad;
  const block = concat(ascii('EXTH'), be32(len), be32(count + 1), items, item, new Array(pad).fill(0));
  const nameAt = dv.getUint32(0x54);
  const rest = rec0.subarray(exthAt + exthLen);
  const out = concat(rec0.subarray(0, exthAt), block, rest);
  new DataView(out.buffer).setUint32(0x54, nameAt - exthLen + block.length);
  return out;
}
