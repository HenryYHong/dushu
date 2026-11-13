// The words the interface uses for a language's reading aid and its levels ("Pinyin" and "HSK 3" for Chinese, "Furigana" and
// "N4" for Japanese, "Hints" and "B1" for the rest), so the screens written for Chinese can say the right thing. Each is in
// the app's language (src/i18n); the level labels themselves (HSK 3, N4, B1) are names and stay as they are.
import { isChinese, lang } from './active';
import { AUTO_KNOWN_DAYS, AUTO_KNOWN_PAGES } from '../core/autoKnown';
import { langName, num, tt } from '../i18n';

/** What sits over the words: Pinyin, Furigana or Hints. */
export function aidName(): string {
  const a = lang().aid;
  return a === 'pinyin' ? tt('Pinyin') : a === 'furigana' ? tt('Furigana') : tt('Hints');
}

/** The aid in a phrase: "pinyin", "furigana", "hints" (lowercase in English, for sentences). */
export function aidWord(): string {
  const a = lang().aid;
  return a === 'pinyin' ? tt('pinyin') : a === 'furigana' ? tt('furigana') : tt('hints');
}

/** The language the dictionary's meanings and hints are in: Chinese for English books (read by Chinese speakers), else English. */
export const glossLanguage = (): string => (lang().id === 'en' ? langName('zh', 'Chinese') : langName('en', 'English'));

/** The character on the aid button's seal. */
export function aidSeal(): string {
  const a = lang().aid;
  return a === 'pinyin' ? '拼' : a === 'furigana' ? 'ふ' : lang().id === 'en' ? '中' : 'En';
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

/** The level scheme's name: HSK, JLPT, Level (the last two words in the app's language; registry.ts marks them). */
export const levelScheme = (): string => tt(lang().levels.scheme);

/** What "Learn known words as I read" does, in the words of this language's aid and levels. */
export function autoKnownHelp(): string {
  const vars = { pages: num(AUTO_KNOWN_PAGES), days: num(AUTO_KNOWN_DAYS) };
  if (isChinese()) {
    return tt('A word you read past on {pages} pages over {days} days without looking it up counts as known, and loses its pinyin in the New words and HSK pinyin modes. Looking it up takes it back off.', vars);
  }
  return lang().aid === 'furigana'
    ? tt('A word you read past on {pages} pages over {days} days without looking it up counts as known, and loses its furigana in the New words and {scheme} modes. Looking it up takes it back off.', { ...vars, scheme: levelScheme() })
    : tt('A word you read past on {pages} pages over {days} days without looking it up counts as known, and loses its hint in the New words and {scheme} modes. Looking it up takes it back off.', { ...vars, scheme: levelScheme() });
}
