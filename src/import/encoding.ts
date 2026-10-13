// Text decoding for files with no reliable charset: BOMs, strict UTF-8, then scoring candidates.
import { COMMON_CHARS } from './commonChars';
import { isHan } from './han';

export interface Decoded {
  text: string;
  encoding: string;
}

/** Map a declared charset label to one TextDecoder understands, or undefined. */
export function normalizeCharset(label: string | undefined | null): string | undefined {
  if (!label) return undefined;
  let l = label.trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (!l) return undefined;
  if (l === 'utf8') l = 'utf-8';
  if (/^(gb2312|gbk|gb_2312-80|gb_2312|x-gbk|cp936|gb18030|euc-cn|chinese|csgb2312|iso-ir-58)$/.test(l)) l = 'gb18030';
  else if (/^(big5|big5-hkscs|cp950|x-x-big5|csbig5|big-5|big5hkscs)$/.test(l)) l = 'big5';
  else if (l === 'unicode' || l === 'ucs-2' || l === 'utf16') l = 'utf-16le';
  try {
    new TextDecoder(l);
    return l;
  } catch {
    return undefined;
  }
}

/** Charset declared in an XML prolog or an HTML meta tag, from the first bytes of a document. */
export function sniffMarkupCharset(bytes: Uint8Array): string | undefined {
  let head = '';
  const n = Math.min(bytes.length, 2048);
  for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i]);
  const m = /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head) ?? /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
  return normalizeCharset(m?.[1]);
}

function tryUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

function isAscii(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] > 0x7f) return false;
  return true;
}

/** Share of decoded Han characters that are common ones, penalizing replacement characters and stray scripts. */
export function scoreDecoding(text: string): number {
  let good = 0;
  let han = 0;
  let bad = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) continue;
    if (cp === 0xfffd) bad++;
    else if (isHan(cp)) {
      han++;
      if (COMMON_CHARS.has(ch)) good++;
    } else if ((cp >= 0x2000 && cp <= 0x206f) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0xa0 && cp <= 0xbf)) {
      // punctuation shared by every candidate
    } else bad++;
  }
  return good / (han + bad * 2 + 1);
}

function decodeWith(bytes: Uint8Array, label: string): string {
  return new TextDecoder(label).decode(bytes);
}

/**
 * Decode bytes of unknown encoding. `hint` is a declared charset (XML prolog, meta tag); it only
 * wins when it decodes about as well as the alternatives, because declarations are often wrong.
 */
export function decodeText(bytes: Uint8Array, hint?: string): Decoded {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decodeWith(bytes, 'utf-8'), encoding: 'utf-8' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { text: decodeWith(bytes, 'utf-16le'), encoding: 'utf-16le' };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { text: decodeWith(bytes, 'utf-16be'), encoding: 'utf-16be' };

  const utf8 = tryUtf8(bytes);
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' };

  const sample = bytes.subarray(0, Math.min(bytes.length, 131072));
  const declared = normalizeCharset(hint);
  const candidates = ['gb18030', 'big5', 'utf-16le', 'utf-16be'];
  if (declared && !candidates.includes(declared) && declared !== 'utf-8') candidates.push(declared);
  let best = { label: 'gb18030', score: -1 };
  for (const label of candidates) {
    // UTF-16 decodes of single-byte data are noise; require plenty of zero bytes (ASCII mixed in) or an even length.
    if (label.startsWith('utf-16') && sample.length % 2 === 1 && isAscii(sample)) continue;
    let score = scoreDecoding(decodeWith(sample, label));
    if (label === declared) score += 0.05;
    if (score > best.score) best = { label, score };
  }
  return { text: decodeWith(bytes, best.label), encoding: best.label };
}

/** CRLF/CR/U+2028/2029 to \n, drop NULs and byte-order marks left inside the text. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?|[\u2028\u2029\u000b\u000c\u0085]/g, '\n').replace(/[\u0000\ufeff]/g, '');
}

/**
 * Bidirectional controls (embeddings, overrides, isolates, marks). In a book they only ever reorder the text and
 * its pinyin, so they are removed on import.
 */
const BIDI = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
export function stripBidi(text: string): string {
  return text.replace(BIDI, '');
}

export const NOT_TEXT_MESSAGE = 'This file does not look like text (it may be a binary file with a .txt name), so Dushu did not import it.';

/**
 * Whether bytes decoded as text really are text: not full of zero or control bytes. A strict UTF-8 decode is accepted
 * after that. A fallback decode (GB18030, Big5) of binary data still yields characters, so it must also score as
 * ordinary Chinese.
 */
export function plausibleText(bytes: Uint8Array, decoded: Decoded): boolean {
  if (decoded.encoding.startsWith('utf-16')) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 131072));
  let nul = 0;
  let ctrl = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) nul++;
    else if (b < 0x20 && b !== 9 && b !== 10 && b !== 13 && b !== 12) ctrl++;
  }
  if (nul + ctrl > sample.length * 0.01) return false;
  if (decoded.encoding === 'utf-8') return true;
  const text = decoded.text.length > 200000 ? decoded.text.slice(0, 200000) : decoded.text;
  let high = 0;
  for (const ch of text) if (ch.codePointAt(0)! > 0x7f) high++;
  if (high < 20) return true; // nearly all ASCII: the content check after import decides
  return scoreDecoding(text) >= 0.3;
}
