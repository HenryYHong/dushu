// The words the interface uses for a language's reading aid and its levels ("Pinyin" and "HSK 3" for Chinese, "Furigana" and
// "N4" for Japanese, "Hints" and "B1" for the rest), so the screens written for Chinese can say the right thing.
import { lang } from './active';

/** What sits over the words: Pinyin, Furigana or Hints. */
export function aidName(): string {
  const a = lang().aid;
  return a === 'pinyin' ? 'Pinyin' : a === 'furigana' ? 'Furigana' : 'Hints';
}

/** The aid in a phrase: "pinyin", "furigana", "hints" (lowercase, for sentences). */
export const aidWord = (): string => aidName().toLowerCase();

/** The character on the aid button's seal. */
export function aidSeal(): string {
  const a = lang().aid;
  return a === 'pinyin' ? '拼' : a === 'furigana' ? 'ふ' : 'En';
}

/** The name of a level (1-based): "HSK 3", "N4", "B1". Chinese 7 is HSK 7–9. */
export function levelLabel(level: number): string {
  const L = lang();
  const labels = L.levels.labels;
  const i = Math.min(Math.max(1, Math.round(level)), labels.length) - 1;
  return labels[i];
}

/** How many levels the language has (Chinese 7: HSK 1–6 and 7–9). */
export const levelCount = (): number => lang().levels.labels.length;

/** The level scheme's name: HSK, JLPT, Level. */
export const levelScheme = (): string => lang().levels.scheme;
