// Text decoding for files with no reliable charset: BOMs, strict UTF-8, UTF-8 with a few bad bytes, then scoring candidates.
import { COMMON_CHARS } from './commonChars';
import { isHan } from './han';
import { langId } from '../lang/active';
import type { LangId } from '../lang/types';
import { ttm, ttn } from '../i18n';

export interface Decoded {
  text: string;
  encoding: string;
  /**
   * Characters the bytes did not give: each bad byte sequence shows as U+FFFD (�) where it was, and a character cut off at the
   * very end of the file is left out. Missing when there were none.
   */
  unreadable?: number;
}

/** What the import result says when some characters could not be decoded (`unreadable`). */
export function unreadableMessage(n: number): string {
  return ttn(n, '{n} character could not be read and shows as �.', '{n} characters could not be read and show as �.');
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

/**
 * Whether bytes with no byte-order mark can be UTF-16 in this byte order: text in UTF-16 has zero bytes on the side of the
 * pair its line breaks and ASCII characters put them (0A 00 little-endian, 00 0A big-endian). Single-byte text has none, and
 * read as UTF-16 it is a page of nonsense characters (a Windows-1252 file in the Chinese library). Which order it is, the
 * scores decide: 一 (U+4E00) puts a zero on the other side, and is common.
 */
function utf16Fits(sample: Uint8Array, label: string): boolean {
  for (let i = label === 'utf-16le' ? 1 : 0; i < sample.length; i += 2) if (sample[i] === 0) return true;
  return false;
}

/**
 * Text in a Western single-byte encoding (Windows-1252, Latin-1): no zero bytes, and most bytes above ASCII stand alone
 * between ASCII ones (é, ’), where GBK and Big5 set theirs in pairs.
 */
function westernSingleByte(sample: Uint8Array): boolean {
  let high = 0;
  let alone = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) return false;
    if (b < 0x80) continue;
    high++;
    if ((i === 0 || sample[i - 1] < 0x80) && (i + 1 === sample.length || sample[i + 1] < 0x80)) alone++;
  }
  return high > 0 && alone > high * 0.8;
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

/**
 * How well a decode reads as the language being read, when it is not Chinese: kana and common kanji for Japanese, lowercase
 * Cyrillic for Russian (a KOI8-R file read as Windows-1251 comes out in capitals), accented Latin letters for the rest. Each
 * candidate decodes something; the right one has the fewest strange characters.
 */
export function scoreFor(text: string, id: LangId): number {
  let good = 0;
  let bad = 0;
  let seen = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) continue;
    seen++;
    if (cp === 0xfffd) { bad += 2; continue; }
    if (id === 'ja') {
      if ((cp >= 0x3040 && cp <= 0x30ff) || COMMON_CHARS.has(ch) || cp === 0x3005 || cp === 0x30fc) good++;
      else if (isHan(cp) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x2000 && cp <= 0x206f)) { /* neutral */ }
      else bad++;
    } else if (id === 'ru') {
      if (cp >= 0x0430 && cp <= 0x044f) good++;
      else if (cp === 0x0451 || (cp >= 0x0410 && cp <= 0x042f) || (cp >= 0x2000 && cp <= 0x206f) || cp === 0xab || cp === 0xbb || cp === 0xa0) { /* neutral */ }
      else bad++;
    } else if ((cp >= 0xc0 && cp <= 0xff && cp !== 0xd7 && cp !== 0xf7) || cp === 0x152 || cp === 0x153) good++;
    else if ((cp >= 0xa0 && cp <= 0xbf) || (cp >= 0x2000 && cp <= 0x206f) || cp === 0x20ac) { /* neutral */ }
    else bad++;
  }
  // Text in Latin letters whose only characters past ASCII are quotes, dashes and the like (an English file in Windows-1252)
  // reads as well as text can.
  if (id !== 'ja' && id !== 'ru' && seen && !bad) return 1;
  return seen ? good / (good + bad * 2 + 1) : 1;
}

/** The legacy encodings a file in each language may come in, most common first. */
const LEGACY: Partial<Record<LangId, string[]>> = {
  ja: ['shift_jis', 'euc-jp', 'iso-2022-jp'],
  ru: ['windows-1251', 'koi8-r', 'ibm866'],
};

function decodeWith(bytes: Uint8Array, label: string): string {
  return new TextDecoder(label).decode(bytes);
}

/**
 * A decode as `encoding` with its replacement characters counted: a U+FFFD at the very end is a character the file cut in
 * half (a truncated download) and is left out; the others stay where the bad bytes were. U+FFFD written in the file itself
 * (`literal`) is not counted.
 */
function counted(text: string, encoding: string, literal = 0): Decoded {
  let bad = 0;
  for (let i = text.indexOf('�'); i >= 0; i = text.indexOf('�', i + 1)) bad++;
  bad -= literal;
  if (bad <= 0) return { text, encoding };
  if (text.endsWith('�')) text = text.slice(0, -1);
  return { text, encoding, unreadable: bad };
}

/** How many times the file itself holds U+FFFD (EF BF BD), so a decode does not count those as bad bytes. */
function literalReplacements(bytes: Uint8Array): number {
  let n = 0;
  for (let i = bytes.indexOf(0xef); i >= 0 && i + 2 < bytes.length; i = bytes.indexOf(0xef, i + 1)) {
    if (bytes[i + 1] === 0xbf && bytes[i + 2] === 0xbd) n++;
  }
  return n;
}

/**
 * UTF-8 with a few bad bytes (one damaged sector, a line pasted in from a GBK file, a download cut off mid-character): the
 * rest of the file is still UTF-8, and reading it all as GB18030 would garble every character. Returns the decode when at
 * least 99.9% of the non-ASCII characters come out whole (`sure`), or when at least 90% do (`maybe`, for the caller to weigh
 * against the other encodings); null when much of the file is not UTF-8. A line whose bad bytes read cleanly as GB18030 (a
 * line from another file) is read that way.
 */
function looseUtf8(bytes: Uint8Array): { decoded: Decoded; sure: boolean } | null {
  const text = new TextDecoder('utf-8').decode(bytes);
  let nonAscii = 0;
  let bad = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80 || (c >= 0xdc00 && c <= 0xdfff)) continue;
    nonAscii++;
    if (c === 0xfffd) bad++;
  }
  bad -= literalReplacements(bytes);
  if (bad <= 0 || bad > nonAscii * 0.1) return null;
  const sure = bad <= nonAscii * 0.001;
  // Lines (a newline byte is never part of a UTF-8 sequence, so text lines and byte lines match one to one).
  const lines = text.split('\n');
  let start = 0;
  let mended = false;
  for (let k = 0; k < lines.length; k++) {
    const end = k + 1 < lines.length ? bytes.indexOf(0x0a, start) : bytes.length;
    if (lines[k].includes('�')) {
      const raw = bytes.subarray(start, end);
      try {
        const gb = new TextDecoder('gb18030', { fatal: true }).decode(raw);
        // Bytes that are UTF-8 apart from one bad byte also decode as GB18030 (as nonsense): the line must read far better.
        if (scoreDecoding(gb) >= 0.5 && scoreDecoding(gb) > scoreDecoding(lines[k]) + 0.2) {
          lines[k] = gb;
          mended = true;
        }
      } catch {
        // not GB18030 either: the replacement characters stay
      }
    }
    start = end + 1;
  }
  return { decoded: counted(mended ? lines.join('\n') : text, 'utf-8', literalReplacements(bytes)), sure };
}

/**
 * Decode bytes of unknown encoding. `hint` is a declared charset (XML prolog, meta tag); it only
 * wins when it decodes about as well as the alternatives, because declarations are often wrong.
 */
export function decodeText(bytes: Uint8Array, hint?: string): Decoded {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return counted(decodeWith(bytes, 'utf-8'), 'utf-8', literalReplacements(bytes));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return counted(decodeWith(bytes, 'utf-16le'), 'utf-16le');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return counted(decodeWith(bytes, 'utf-16be'), 'utf-16be');

  const utf8 = tryUtf8(bytes);
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' };
  const loose = looseUtf8(bytes);
  if (loose?.sure) return loose.decoded;

  const sample = bytes.subarray(0, Math.min(bytes.length, 131072));
  const declared = normalizeCharset(hint);
  const id = langId();
  if (id !== 'zh') return decodeOther(bytes, sample, declared, id);
  // A Spanish or English file saved in Windows-1252, dropped in the Chinese library: read as what it is, so the library can
  // say which language it is in, as for the same text in UTF-8.
  if (westernSingleByte(sample)) return { text: decodeWith(bytes, 'windows-1252'), encoding: 'windows-1252' };
  const candidates = ['gb18030', 'big5', 'utf-16le', 'utf-16be'];
  if (declared && !candidates.includes(declared) && declared !== 'utf-8') candidates.push(declared);
  let best = { label: 'gb18030', score: -1 };
  for (const label of candidates) {
    if (label.startsWith('utf-16') && !utf16Fits(sample, label)) continue;
    let score = scoreDecoding(decodeWith(sample, label));
    if (label === declared) score += 0.05;
    if (score > best.score) best = { label, score };
  }
  // Mostly UTF-8 with more bad bytes than a stray few: it wins when it reads better than every other encoding.
  if (loose && scoreDecoding(loose.decoded.text.slice(0, 131072)) >= best.score) return loose.decoded;
  return counted(decodeWith(bytes, best.label), best.label);
}

/** A book in another language: its legacy encodings (Shift_JIS, Windows-1251, Windows-1252 …) scored by how they read. */
function decodeOther(bytes: Uint8Array, sample: Uint8Array, declared: string | undefined, id: LangId): Decoded {
  // A Western file in the Japanese or Russian library is read as Windows-1252 too, not as Shift_JIS or Windows-1251 nonsense.
  if ((id === 'ja' || id === 'ru') && westernSingleByte(sample)) return { text: decodeWith(bytes, 'windows-1252'), encoding: 'windows-1252' };
  const candidates = [...(LEGACY[id] ?? ['windows-1252', 'iso-8859-15']), 'utf-16le', 'utf-16be'];
  if (declared && !candidates.includes(declared) && declared !== 'utf-8') candidates.push(declared);
  let best = { label: candidates[0], score: -1 };
  for (const label of candidates) {
    if (label.startsWith('utf-16') && !utf16Fits(sample, label)) continue;
    let text: string;
    try { text = decodeWith(sample, label); } catch { continue; }
    let score = scoreFor(text, id);
    if (label.startsWith('utf-16') && /\u0000/.test(text)) score -= 1;
    if (label === declared) score += 0.05;
    if (score > best.score) best = { label, score };
  }
  return { text: decodeWith(bytes, best.label), encoding: best.label };
}

/**
 * A Big5 text whose decoder gave Hong Kong's characters (Big5-HKSCS) as private-use code points, with the characters put
 * back (import/hkscs.ts, about 20 KB, loaded only then).
 */
export async function withHongKongCharacters(decoded: Decoded): Promise<Decoded> {
  if (decoded.encoding !== 'big5' || !/[\ue000-\uf8ff]/.test(decoded.text)) return decoded;
  const { mapHkscsPrivateUse } = await import('./hkscs');
  return { ...decoded, text: mapHkscsPrivateUse(decoded.text) };
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

export const NOT_TEXT_MESSAGE = ttm('This file does not look like text (it may be a binary file with a .txt name), so LinguPengu did not import it.');

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
  const id = langId();
  // Western text read in the Chinese, Japanese or Russian library: scored as the Latin letters it is, so the import can say
  // which language it is in.
  if ((id === 'zh' || id === 'ja' || id === 'ru') && decoded.encoding === 'windows-1252') return scoreFor(text, 'en') >= 0.3;
  return id === 'zh' ? scoreDecoding(text) >= 0.3 : scoreFor(text, id) >= 0.3;
}
