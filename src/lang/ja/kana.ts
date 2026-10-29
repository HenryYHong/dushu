// Kana and character classes for Japanese text.
import { isHanCodePoint } from '../../core/text';

/** Katakana to hiragana (ヴ to ゔ, ヵヶ to ゕゖ); everything else unchanged, ー included. */
export function toHiragana(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : s[i];
  }
  return out;
}

export function toKatakana(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x3041 && c <= 0x3096 ? String.fromCharCode(c + 0x60) : s[i];
  }
  return out;
}

export const isHiraganaCode = (c: number): boolean => (c >= 0x3041 && c <= 0x309f);
export const isKatakanaCode = (c: number): boolean => (c >= 0x30a1 && c <= 0x30fa) || (c >= 0x30fc && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff) || (c >= 0xff66 && c <= 0xff9f);
export const isKanaCode = (c: number): boolean => isHiraganaCode(c) || isKatakanaCode(c);

/** Characters written inside words like kanji: ideographs, 々 (repeat), 〆, ヶ (as in 三ヶ月), 〇. */
export function isKanjiCode(cp: number): boolean {
  return cp === 0x3005 || cp === 0x3006 || cp === 0x3007 || cp === 0x30f6 || cp === 0x30f5 || cp === 0x303b || isHanCodePoint(cp);
}

export function hasKanji(s: string): boolean {
  for (const ch of s) if (isKanjiCode(ch.codePointAt(0)!)) return true;
  return false;
}

export function isAllKana(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) if (!isKanaCode(s.charCodeAt(i))) return false;
  return true;
}

/** Hiragana with the long-vowel mark spelled out as the vowel it lengthens (ラーメン → らあめん), for comparing readings. */
export function foldReading(s: string): string {
  const h = toHiragana(s);
  if (!h.includes('ー')) return h;
  let out = '';
  for (const ch of h) {
    if (ch === 'ー' && out) out += vowelOf(out[out.length - 1]) ?? ch;
    else out += ch;
  }
  return out;
}

const VOWEL_ROWS: [string, string][] = [
  ['あかさたなはまやらわがざだばぱぁゃゎ', 'あ'],
  ['いきしちにひみりぎじぢびぴぃ', 'い'],
  ['うくすつぬふむゆるぐずづぶぷぅゅゔ', 'う'],
  ['えけせてねへめれげぜでべぺぇ', 'え'],
  ['おこそとのほもよろをごぞどぼぽぉょ', 'お'],
];

export function vowelOf(ch: string): string | undefined {
  for (const [row, v] of VOWEL_ROWS) if (row.includes(ch)) return v;
  return undefined;
}

/** The kana of the same consonant on another vowel row: shiftRow('く', 'え') === 'け'. Used for godan stems. */
const GOJUON = [
  'あいうえお', 'かきくけこ', 'がぎぐげご', 'さしすせそ', 'ざじずぜぞ', 'たちつてと', 'だぢづでど', 'なにぬねの',
  'はひふへほ', 'ばびぶべぼ', 'ぱぴぷぺぽ', 'まみむめも', 'やいゆえよ', 'らりるれろ', 'わいうえを',
];
export function shiftRow(ch: string, vowel: 'あ' | 'い' | 'う' | 'え' | 'お'): string | undefined {
  const col = 'あいうえお'.indexOf(vowel);
  for (const row of GOJUON) {
    const i = row.indexOf(ch);
    if (i >= 0) return row[col];
  }
  return undefined;
}

/** Rendaku and gemination variants of a reading, for aligning furigana in compounds (ほん → ぼん, ぽん; がく → がっ). */
const VOICED: Record<string, string> = {
  か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ',
  た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ',
};
const HALF: Record<string, string> = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };

export function readingVariants(r: string): string[] {
  const out = [r];
  const first = r[0];
  const rest = r.slice(1);
  if (VOICED[first]) out.push(VOICED[first] + rest);
  if (HALF[first]) out.push(HALF[first] + rest);
  if (first === 'ち') out.push('じ' + rest);
  if (first === 'つ') out.push('ず' + rest);
  for (const v of out.slice()) {
    const last = v[v.length - 1];
    if (v.length >= 2 && 'つちくき'.includes(last)) out.push(v.slice(0, -1) + 'っ');
  }
  return out;
}
