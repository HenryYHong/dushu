// Kindle index records (INDX / TAGX / CNCX): the tables that hold the contents list and, in KF8 files,
// the skeleton and fragment tables.

const u16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number): number => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const tag4 = (b: Uint8Array, o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export interface IndexEntry {
  key: string;
  /** Tag number to its values. */
  tags: Map<number, number[]>;
}

export interface IndexTable {
  entries: IndexEntry[];
  /** Compiled strings: offset to text. */
  cncx: Map<number, string>;
}

/** Variable-width number: 7 bits per byte, most significant first, the last byte has its top bit set. */
function decint(b: Uint8Array, at: number): { value: number; used: number } {
  let value = 0;
  let used = 0;
  while (at + used < b.length) {
    const byte = b[at + used++];
    value = value * 128 + (byte & 0x7f);
    if (byte & 0x80) break;
  }
  return { value, used };
}

const bits = (n: number): number => {
  let c = 0;
  for (let v = n; v; v >>= 1) c += v & 1;
  return c;
};

interface TagX {
  tag: number;
  values: number;
  mask: number;
  eof: number;
}

function readTagMap(controlCount: number, tagx: TagX[], rec: Uint8Array): Map<number, number[]> {
  const map = new Map<number, number[]>();
  let control = Array.from(rec.subarray(0, controlCount));
  let at = controlCount;
  const pending: { tag: number; count: number | null; bytes: number | null; per: number }[] = [];
  for (const x of tagx) {
    if (x.eof === 1) {
      control = control.slice(1);
      continue;
    }
    if (!control.length) break;
    let value = control[0] & x.mask;
    if (value === 0) continue;
    let count: number | null = null;
    let nbytes: number | null = null;
    if (value === x.mask) {
      if (bits(x.mask) > 1) {
        const d = decint(rec, at);
        at += d.used;
        nbytes = d.value;
      } else count = 1;
    } else {
      let mask = x.mask;
      while ((mask & 1) === 0) {
        mask >>= 1;
        value >>= 1;
      }
      count = value;
    }
    pending.push({ tag: x.tag, count, bytes: nbytes, per: x.values });
  }
  for (const p of pending) {
    const values: number[] = [];
    if (p.count !== null) {
      for (let i = 0; i < p.count * p.per && at < rec.length; i++) {
        const d = decint(rec, at);
        at += d.used;
        values.push(d.value);
      }
    } else if (p.bytes !== null) {
      let used = 0;
      while (used < p.bytes && at < rec.length) {
        const d = decint(rec, at);
        at += d.used;
        used += d.used;
        values.push(d.value);
      }
    }
    map.set(p.tag, values);
  }
  return map;
}

/** Fields of an INDX record header, by name. */
function indxHeader(rec: Uint8Array) {
  if (rec.length < 192 || tag4(rec, 0) !== 'INDX') throw new Error('not an INDX record');
  const f = (k: number) => u32(rec, 4 + 4 * k);
  return { idxt: f(4), count: f(5), code: f(6), ncncx: f(12), tagx: f(44), end: 4 * 46 };
}

/**
 * Read the index that starts at record `at`. `sec(n)` returns record n of the section the index
 * numbers refer to. `decode` turns CNCX bytes into text.
 */
export function readIndex(sec: (n: number) => Uint8Array | undefined, at: number, decode: (b: Uint8Array) => string): IndexTable {
  const first = sec(at);
  if (!first) throw new Error('index record missing');
  const head = indxHeader(first);

  let tagxAt = head.tagx;
  if (tag4(first, tagxAt) !== 'TAGX') {
    tagxAt = -1;
    for (let i = head.end; i + 4 <= first.length; i++) {
      if (tag4(first, i) === 'TAGX') {
        tagxAt = i;
        break;
      }
    }
    if (tagxAt < 0) throw new Error('TAGX missing');
  }
  const firstEntry = u32(first, tagxAt + 4);
  const controlCount = u32(first, tagxAt + 8);
  const tagx: TagX[] = [];
  for (let i = tagxAt + 12; i + 4 <= tagxAt + firstEntry && i + 4 <= first.length; i += 4) {
    tagx.push({ tag: first[i], values: first[i + 1], mask: first[i + 2], eof: first[i + 3] });
  }

  const cncx = new Map<number, string>();
  for (let r = 0; r < head.ncncx; r++) {
    const rec = sec(at + head.count + 1 + r);
    if (!rec) break;
    let pos = 0;
    while (pos < rec.length) {
      const d = decint(rec, pos);
      if (d.value > 0 && pos + d.used + d.value <= rec.length) {
        cncx.set(r * 0x10000 + pos, decode(rec.subarray(pos + d.used, pos + d.used + d.value)));
      }
      pos += d.used + d.value;
    }
  }

  const entries: IndexEntry[] = [];
  for (let n = 1; n <= head.count; n++) {
    const rec = sec(at + n);
    if (!rec) break;
    const h = indxHeader(rec);
    if (tag4(rec, h.idxt) !== 'IDXT') continue;
    const starts: number[] = [];
    for (let j = 0; j < h.count; j++) starts.push(u16(rec, h.idxt + 4 + 2 * j));
    starts.push(h.idxt);
    for (let j = 0; j < h.count; j++) {
      const s = starts[j];
      const e = Math.min(starts[j + 1], rec.length);
      if (s >= e) continue;
      const keyLen = rec[s];
      let key = '';
      for (let k = 0; k < keyLen && s + 1 + k < e; k++) key += String.fromCharCode(rec[s + 1 + k]);
      entries.push({ key, tags: readTagMap(controlCount, tagx, rec.subarray(s + 1 + keyLen, e)) });
    }
  }
  return { entries, cncx };
}
