// Encoders for the legacy Chinese encodings, made by running the platform's own decoder backwards over every two-byte code
// (TextEncoder writes UTF-8 only). Big5 includes Hong Kong's characters (Big5-HKSCS), which some decoders give as
// private-use code points: those are put back with the importer's own table, so the bytes are the HKSCS ones.
import { mapHkscsPrivateUse } from '../../../src/import/hkscs';

type Label = 'gbk' | 'gb18030' | 'big5' | 'big5-hkscs';
const tables = new Map<string, Map<string, number[]>>();

/** Character to bytes. Plain Big5 leaves out the Hong Kong characters (the codes a decoder may give as private use). */
function table(label: 'gbk' | 'big5' | 'big5-hkscs'): Map<string, number[]> {
  let t = tables.get(label);
  if (t) return t;
  t = new Map();
  const dec = new TextDecoder(label === 'gbk' ? 'gbk' : 'big5');
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f || (label !== 'gbk' && trail > 0x7e && trail < 0xa1)) continue;
      let s = dec.decode(new Uint8Array([lead, trail]));
      if (label === 'big5-hkscs') s = mapHkscsPrivateUse(s);
      const cps = [...s];
      // The first code for a character wins (the standard one over a duplicate in an extension area).
      if (cps.length === 1 && s !== '\ufffd' && !/[\ue000-\uf8ff]/.test(s) && !t.has(s)) t.set(s, [lead, trail]);
    }
  }
  tables.set(label, t);
  return t;
}

/** GB18030's four-byte form of a code point outside the BMP. */
function gb18030Four(cp: number): number[] {
  let n = cp - 0x10000; // linear index 189000 + n: four bytes from 90 30 81 30
  const b4 = 0x30 + (n % 10);
  n = Math.floor(n / 10);
  const b3 = 0x81 + (n % 126);
  n = Math.floor(n / 126);
  const b2 = 0x30 + (n % 10);
  const b1 = 0x90 + Math.floor(n / 10);
  return [b1, b2, b3, b4];
}

/** Whether every character of `text` has a code in the encoding. */
export function encodable(text: string, label: Label): boolean {
  const t = table(label === 'gb18030' ? 'gbk' : label);
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || t.has(ch) || (label === 'gb18030' && cp > 0xffff)) continue;
    return false;
  }
  return true;
}

/** Text in GBK, GB18030 (four-byte codes outside the BMP), Big5 or Big5-HKSCS. Throws on a character with no code. */
export function encodeLegacy(text: string, label: Label): Uint8Array {
  const t = table(label === 'gb18030' ? 'gbk' : label);
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (t.has(ch)) out.push(...t.get(ch)!);
    else if (label === 'gb18030' && cp > 0xffff) out.push(...gb18030Four(cp));
    else throw new Error(`${label} has no code for ${ch} (U+${cp.toString(16)})`);
  }
  return Uint8Array.from(out);
}

/** Text in UTF-16, little or big endian, with or without a byte-order mark. */
export function encodeUtf16(text: string, littleEndian: boolean, bom: boolean): Uint8Array {
  const units = (bom ? '\ufeff' : '') + text;
  const out = new Uint8Array(units.length * 2);
  for (let i = 0; i < units.length; i++) {
    const u = units.charCodeAt(i);
    out[2 * i + (littleEndian ? 0 : 1)] = u & 0xff;
    out[2 * i + (littleEndian ? 1 : 0)] = u >> 8;
  }
  return out;
}

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
