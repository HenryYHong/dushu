// Small Han helpers local to the importers (no dependency on core/).
import { langId } from '../lang/active';
import type { LangId } from '../lang/types';

/** Any CJK ideograph: URO, Ext A and B-J, compatibility ideographs, and the zero 〇. */
export function isHan(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x20000 && cp <= 0x33fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x2f800 && cp <= 0x2fa1f) ||
    cp === 0x3007
  );
}

/**
 * The units a book's length and reading places are counted in: Han characters for Chinese. A book in another language counts
 * the letters of its script instead (kana and kanji for Japanese), so every caller (importers, places, the store) measures
 * any language the same way. Thresholds tuned in Han characters scale by `unitScale`.
 */
export function countHan(s: string): number {
  const unit = textUnit();
  let n = 0;
  if (!unit) {
    for (const ch of s) if (isHan(ch.codePointAt(0)!)) n++;
    return n;
  }
  for (const ch of s) if (unit.test(ch)) n++;
  return n;
}

/** How many counted units of this language carry about as much text as one Han character does in Chinese. */
export function unitScale(): number {
  const id = langId();
  return id === 'zh' ? 1 : id === 'ja' ? 1.5 : 3.5;
}

const UNITS: Partial<Record<LangId, RegExp>> = {
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]/u,
  ru: /\p{Script=Cyrillic}/u,
};
const LATIN = /\p{Script=Latin}/u;
/** The letters counted for the language read now, or null for Chinese (Han characters). */
function textUnit(): RegExp | null {
  const id = langId();
  return id === 'zh' ? null : UNITS[id] ?? LATIN;
}

/** Han, kana, CJK symbols and punctuation, full-width forms. */
export function isCjk(cp: number): boolean {
  return isHan(cp) || (cp >= 0x3000 && cp <= 0x30ff) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x3100 && cp <= 0x31ff);
}

/** Typographic marks that sit between CJK text without a space (curly quotes, dashes, ellipsis, middle dot). */
function isQuoteish(cp: number): boolean {
  return (cp >= 0x2018 && cp <= 0x201f) || cp === 0x2014 || cp === 0x2026 || cp === 0xb7 || cp === 0x2015;
}

/** Whether a (collapsed) space between a and b should be dropped: both sides are CJK-ish and at least one is real CJK. */
export function spaceBetweenIsNoise(a: number, b: number): boolean {
  const ca = isCjk(a);
  const cb = isCjk(b);
  return (ca && cb) || (ca && isQuoteish(b)) || (cb && isQuoteish(a));
}
