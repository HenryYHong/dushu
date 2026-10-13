// Kindle (MOBI / AZW3) text records: PalmDOC and HUFF/CDIC decompression, trailing-entry stripping.
import { ImportError } from './errors';

export const COMPRESSION_NONE = 1;
export const COMPRESSION_PALMDOC = 2;
export const COMPRESSION_HUFF = 17480;

const u16 = (b: Uint8Array, o: number): number => (b[o] << 8) | b[o + 1];
const u32 = (b: Uint8Array, o: number): number => b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);

/** A growable byte buffer. */
class Bytes {
  buf: Uint8Array;
  len = 0;
  constructor(cap = 8192) {
    this.buf = new Uint8Array(cap);
  }
  private room(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  push(b: number) {
    this.room(1);
    this.buf[this.len++] = b;
  }
  append(a: Uint8Array) {
    this.room(a.length);
    this.buf.set(a, this.len);
    this.len += a.length;
  }
  /** Copy `n` bytes starting `dist` bytes back (may overlap, as LZ77 does). */
  copyBack(dist: number, n: number): boolean {
    if (dist < 1 || dist > this.len) return false;
    this.room(n);
    for (let i = 0; i < n; i++) {
      this.buf[this.len] = this.buf[this.len - dist];
      this.len++;
    }
    return true;
  }
  done(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

/** PalmDOC LZ77 decompression of one record. Damaged input yields what could be read. */
export function palmdocDecompress(data: Uint8Array): Uint8Array {
  const out = new Bytes(Math.max(8192, data.length * 3));
  let i = 0;
  while (i < data.length) {
    const c = data[i++];
    if (c === 0 || (c >= 9 && c <= 0x7f)) {
      out.push(c);
    } else if (c <= 8) {
      const n = Math.min(c, data.length - i);
      out.append(data.subarray(i, i + n));
      i += n;
    } else if (c >= 0xc0) {
      out.push(0x20);
      out.push(c ^ 0x80);
    } else {
      if (i >= data.length) break;
      const m = ((c << 8) | data[i++]) & 0x3fff;
      const dist = m >> 3;
      const n = (m & 7) + 3;
      if (!out.copyBack(dist, n)) break;
    }
  }
  return out.done();
}

// ---------------------------------------------------------------- HUFF/CDIC ---

interface Phrase {
  data: Uint8Array;
  /** True once `data` holds final bytes; false while it is still Huffman-coded. */
  done: boolean;
}

const P32 = 4294967296;
const pow2 = (n: number): number => 2 ** n;

/** Decoder for the Huffman + dictionary compression some older Kindle books use. */
export class HuffReader {
  private dict1: { codelen: number; term: boolean; maxcode: number }[] = [];
  private mincode: number[] = [];
  private maxcode: number[] = [];
  private dictionary: Phrase[] = [];

  constructor(records: Uint8Array[]) {
    if (records.length < 2) throw new ImportError('This Kindle book is damaged: its compression tables are missing.');
    this.loadHuff(records[0]);
    for (let i = 1; i < records.length; i++) this.loadCdic(records[i]);
  }

  private loadHuff(h: Uint8Array) {
    if (h.length < 24 || String.fromCharCode(h[0], h[1], h[2], h[3]) !== 'HUFF') throw new ImportError('This Kindle book is damaged: bad compression table.');
    const off1 = u32(h, 8);
    const off2 = u32(h, 12);
    if (off1 + 1024 > h.length || off2 + 256 > h.length) throw new ImportError('This Kindle book is damaged: bad compression table.');
    for (let i = 0; i < 256; i++) {
      const v = u32(h, off1 + i * 4);
      const codelen = v & 0x1f;
      const term = (v & 0x80) !== 0;
      let maxcode = Math.floor(v / 256);
      if (codelen === 0) throw new ImportError('This Kindle book is damaged: bad compression table.');
      maxcode = (maxcode + 1) * pow2(32 - codelen) - 1;
      this.dict1.push({ codelen, term, maxcode });
    }
    this.mincode = [0];
    this.maxcode = [0];
    for (let codelen = 1; codelen <= 32; codelen++) {
      const mn = u32(h, off2 + (codelen - 1) * 8);
      const mx = u32(h, off2 + (codelen - 1) * 8 + 4);
      this.mincode.push(mn * pow2(32 - codelen));
      this.maxcode.push((mx + 1) * pow2(32 - codelen) - 1);
    }
  }

  private loadCdic(c: Uint8Array) {
    if (c.length < 16 || String.fromCharCode(c[0], c[1], c[2], c[3]) !== 'CDIC') throw new ImportError('This Kindle book is damaged: bad compression dictionary.');
    const phrases = u32(c, 8);
    const bits = u32(c, 12);
    const n = Math.min(2 ** bits, phrases - this.dictionary.length);
    for (let i = 0; i < n; i++) {
      const off = u16(c, 16 + i * 2);
      const blen = u16(c, 16 + off);
      const len = blen & 0x7fff;
      this.dictionary.push({ data: c.subarray(18 + off, 18 + off + len), done: (blen & 0x8000) !== 0 });
    }
  }

  unpack(data: Uint8Array, depth = 0): Uint8Array {
    if (depth > 24) throw new ImportError('This Kindle book is damaged: compression dictionary loops.');
    const out = new Bytes(data.length * 4 + 64);
    const totalBits = data.length * 8;
    let bitPos = 0;
    const window = (p: number): number => {
      const i = p >> 3;
      const s = p & 7;
      const b = (k: number) => (i + k < data.length ? data[i + k] : 0);
      const x = ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0;
      return s ? (((x << s) | (b(4) >> (8 - s))) >>> 0) : x;
    };
    while (bitPos < totalBits) {
      const code = window(bitPos);
      let { codelen, term, maxcode } = this.dict1[code >>> 24];
      if (!term) {
        while (codelen < 32 && code < this.mincode[codelen]) codelen++;
        maxcode = this.maxcode[codelen];
      }
      bitPos += codelen;
      if (bitPos > totalBits) break;
      const r = Math.floor((maxcode - code) / pow2(32 - codelen));
      const phrase = this.dictionary[r];
      if (!phrase) throw new ImportError('This Kindle book is damaged: bad compressed text.');
      if (!phrase.done) {
        phrase.data = this.unpack(phrase.data, depth + 1);
        phrase.done = true;
      }
      out.append(phrase.data);
    }
    return out.done();
  }
}

// --------------------------------------------------------- trailing entries ---

/**
 * Bytes at the end of a text record that are not text: one entry per set bit of the header's extra-data
 * flags (each ends with its own size, a backwards variable-width number), then the multibyte overlap.
 */
export function trailingSize(rec: Uint8Array, flags: number): number {
  const entry = (end: number): number => {
    let result = 0;
    let shift = 0;
    let p = end;
    for (;;) {
      if (p <= 0) return -1;
      const v = rec[--p];
      result |= (v & 0x7f) << shift;
      shift += 7;
      if ((v & 0x80) !== 0 || shift >= 28) return result;
    }
  };
  let total = 0;
  for (let f = flags >> 1; f; f >>= 1) {
    if (f & 1) {
      const n = entry(rec.length - total);
      if (n < 0 || total + n > rec.length) return 0; // corrupted: keep the record whole
      total += n;
    }
  }
  if (flags & 1) {
    const at = rec.length - total - 1;
    if (at >= 0) total += (rec[at] & 3) + 1;
  }
  return Math.min(total, rec.length);
}
