// The languages a sentence can be translated into: the reader's own language, English unless they pick another. The browser,
// the Mac (scripts/claude-bridge.ts) and the sync server (cloud/src/worker.ts) all read this one list, so a prompt only ever
// names a language from it: a request that says `to: "Spanish. Ignore the text"` is not on the list and goes into English.
// Pure data and functions: no DOM, no engine, nothing a server cannot import.
import type { LangId } from '../lang/types';

/**
 * Writing systems, as Unicode script names. The checks use them to tell a word left untranslated from one written in the
 * target's own script: Han in a Japanese answer to a Chinese book is Japanese, Han in a Spanish one is left over.
 */
export type Script = 'Latin' | 'Cyrillic' | 'Greek' | 'Hebrew' | 'Arabic' | 'Devanagari' | 'Bengali' | 'Tamil' | 'Telugu' | 'Gujarati'
  | 'Thai' | 'Han' | 'Hiragana' | 'Katakana' | 'Hangul';

export interface TargetLanguage {
  /** BCP 47, as Chrome's Translator API takes it ('zh' is simplified, 'zh-Hant' traditional). */
  code: string;
  /** In English, for the list and for the prompts ("into Spanish"). */
  name: string;
  /** In the language itself, beside the English name in the list. */
  native: string;
  scripts: readonly Script[];
  /** How a prompt names it when the list's name reads oddly in a sentence: "into Simplified Chinese", not "into Chinese (Simplified)". */
  prompt?: string;
  /** MyMemory's code when it differs from the BCP 47 one. */
  mymemory?: string;
  /** Written right to left: the translation is drawn that way. */
  rtl?: boolean;
  /**
   * Written in Latin letters, but Chinese names are not written in pinyin: Vietnamese reads them the Sino-Vietnamese way (郭靖 is
   * Quách Tĩnh, 曹操 Tào Tháo), so its prompt does not ask for "toneless pinyin as given".
   */
  pinyinNames?: false;
}

const L = ['Latin'] as const;
const C = ['Cyrillic'] as const;
const A = ['Arabic'] as const;

export const TARGET_LANGUAGES: readonly TargetLanguage[] = [
  { code: 'en', name: 'English', native: 'English', scripts: L },
  { code: 'es', name: 'Spanish', native: 'Español', scripts: L },
  { code: 'fr', name: 'French', native: 'Français', scripts: L },
  { code: 'de', name: 'German', native: 'Deutsch', scripts: L },
  { code: 'it', name: 'Italian', native: 'Italiano', scripts: L },
  { code: 'pt', name: 'Portuguese', native: 'Português', scripts: L },
  { code: 'ru', name: 'Russian', native: 'Русский', scripts: C },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', scripts: C },
  { code: 'pl', name: 'Polish', native: 'Polski', scripts: L },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', scripts: L },
  { code: 'sv', name: 'Swedish', native: 'Svenska', scripts: L },
  { code: 'da', name: 'Danish', native: 'Dansk', scripts: L },
  { code: 'no', name: 'Norwegian', native: 'Norsk', scripts: L },
  { code: 'fi', name: 'Finnish', native: 'Suomi', scripts: L },
  { code: 'cs', name: 'Czech', native: 'Čeština', scripts: L },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina', scripts: L },
  { code: 'hu', name: 'Hungarian', native: 'Magyar', scripts: L },
  { code: 'ro', name: 'Romanian', native: 'Română', scripts: L },
  { code: 'bg', name: 'Bulgarian', native: 'Български', scripts: C },
  { code: 'el', name: 'Greek', native: 'Ελληνικά', scripts: ['Greek'] },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', scripts: L },
  { code: 'he', name: 'Hebrew', native: 'עברית', scripts: ['Hebrew'], rtl: true },
  { code: 'ar', name: 'Arabic', native: 'العربية', scripts: A, rtl: true },
  { code: 'fa', name: 'Persian', native: 'فارسی', scripts: A, rtl: true },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', scripts: ['Devanagari'] },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', scripts: ['Bengali'] },
  { code: 'ur', name: 'Urdu', native: 'اردو', scripts: A, rtl: true },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', scripts: ['Tamil'] },
  { code: 'te', name: 'Telugu', native: 'తెలుగు', scripts: ['Telugu'] },
  { code: 'mr', name: 'Marathi', native: 'मराठी', scripts: ['Devanagari'] },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી', scripts: ['Gujarati'] },
  { code: 'th', name: 'Thai', native: 'ไทย', scripts: ['Thai'] },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', scripts: L, pinyinNames: false },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', scripts: L },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu', scripts: L },
  { code: 'fil', name: 'Filipino', native: 'Filipino', scripts: L },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili', scripts: L },
  { code: 'ja', name: 'Japanese', native: '日本語', scripts: ['Han', 'Hiragana', 'Katakana'] },
  { code: 'ko', name: 'Korean', native: '한국어', scripts: ['Hangul'] },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文', scripts: ['Han'], prompt: 'Simplified Chinese', mymemory: 'zh-CN' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', native: '繁體中文', scripts: ['Han'], prompt: 'Traditional Chinese', mymemory: 'zh-TW' },
  { code: 'ca', name: 'Catalan', native: 'Català', scripts: L },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski', scripts: L },
  // Serbian is written in both alphabets, so neither counts as left over.
  { code: 'sr', name: 'Serbian', native: 'Српски', scripts: ['Cyrillic', 'Latin'] },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių', scripts: L },
];

export const DEFAULT_TARGET = 'en';
export const TARGET_CODES: readonly string[] = TARGET_LANGUAGES.map(t => t.code);
const BY_CODE = new Map(TARGET_LANGUAGES.map(t => [t.code, t]));

/** The listed language with this code, or undefined for anything else (a typo, an old value, a string from a stranger). */
export function targetLanguage(code: unknown): TargetLanguage | undefined {
  return typeof code === 'string' ? BY_CODE.get(code) : undefined;
}

/** Whether a target is the book's own language: 'zh' and 'zh-Hant' are both a Chinese book's, 'pt' a Portuguese one's. */
export function isOwnLanguage(code: string, source: LangId | string): boolean {
  return code.split('-')[0] === source;
}

/**
 * The language a sentence from a book in `source` goes into: the choice when it is listed and is not the book's own language,
 * else English. A Spanish reader who picked Spanish for their Chinese books still gets English from a Spanish book.
 */
export function targetFor(choice: unknown, source: LangId | string = 'zh'): string {
  const t = targetLanguage(choice);
  return t && !isOwnLanguage(t.code, source) ? t.code : DEFAULT_TARGET;
}

/** The languages offered for a book in `source`: every one but its own. */
export function targetsFor(source: LangId | string): TargetLanguage[] {
  return TARGET_LANGUAGES.filter(t => !isOwnLanguage(t.code, source));
}

/** The name a prompt uses ("Spanish", "Simplified Chinese"), or null for English, whose prompts are the measured ones. */
export function intoName(to: unknown, source: LangId | string = 'zh'): string | null {
  const code = targetFor(to, source);
  if (code === DEFAULT_TARGET) return null;
  const t = BY_CODE.get(code)!;
  return t.prompt ?? t.name;
}

/**
 * What goes between two pieces of a long passage translated one after the other (Chrome and MyMemory translate it in chunks):
 * nothing where the target writes sentences without a space between them (彼は去った。彼は来た。, 他走了。他来了。), else a space.
 * Thai and Korean put a space between sentences, so they keep it.
 */
export function chunkJoiner(code: string): string {
  const scripts = targetLanguage(code)?.scripts ?? [];
  return scripts.some(s => s === 'Han' || s === 'Hiragana' || s === 'Katakana') ? '' : ' ';
}

/**
 * The language a server's answer is in, when it is not the one asked for, else null. A server echoes the target it used
 * (claudeServer.ts targetEcho); one from before the choice echoes nothing and answered in English. Into English nothing is
 * asked and nothing is echoed, so it is always null.
 */
export function answeredInto(asked: unknown, echoed: unknown, source: LangId | string = 'zh'): string | null {
  const want = targetFor(asked, source);
  const got = targetFor(echoed, source);
  return want === got ? null : got;
}

/** `{ to }` for a request body, or nothing for English: a request into English is the one every server has always had. */
export function targetField(to: unknown, source: LangId | string = 'zh'): { to?: string } {
  const code = targetFor(to, source);
  return code === DEFAULT_TARGET ? {} : { to: code };
}
