// The languages Dushu reads, and what the app needs to know about each before its engine loads. Chinese is the original app
// and keeps its own modules; every other language has an engine in src/lang/<id>/ (types.ts) and data in public/data/<id>/.
import type { LangId, LangModule } from './types';

export interface LangInfo {
  id: LangId;
  /** In English, for the app's own words ("Japanese"). */
  name: string;
  /** In the language itself ("日本語"). */
  native: string;
  /** The word for reading books shown on the brand mark (读书, 読書, Leer). */
  brand: string;
  /** BCP 47 tag for the text (lang attribute, the Translator API, MyMemory). */
  tag: string;
  /** Speech voices whose lang starts with one of these. */
  voices: string[];
  /** What sits over words: Chinese pinyin, Japanese furigana, or a short English hint (any language, off unless asked). */
  aid: 'pinyin' | 'furigana' | 'hint';
  /** Russian: mark the stressed vowel. */
  stress?: boolean;
  /** Word levels: the scheme's name and one label per level, easiest first. */
  levels: { scheme: string; labels: string[]; about: string };
  /** Whether words are separated by spaces (selection and line breaking follow). */
  spaced: boolean;
  /** CSS font stack for the book text. */
  fonts: { serif: string; sans: string };
  /** The engine (absent for Chinese). */
  load?: () => Promise<LangModule>;
}

const LATIN_SERIF = `'Newsreader', 'Iowan Old Style', 'Palatino', 'Georgia', serif`;
const LATIN_SANS = `-apple-system, 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif`;
const FREQ_LEVELS = (lang: string) => ({
  scheme: 'Level',
  labels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
  about: `${lang} word levels follow how common a word is in everyday ${lang}: A1 is about the 500 most common words, A2 the next 700, B1 up to 2,500, B2 up to 5,000, C1 up to 10,000 and C2 up to 20,000. They are a guide, not an exam list.`,
});

export const LANGS: Record<LangId, LangInfo> = {
  zh: {
    id: 'zh', name: 'Chinese', native: '中文', brand: '读书', tag: 'zh', voices: ['zh'], aid: 'pinyin',
    levels: { scheme: 'HSK', labels: ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6', 'HSK 7–9'], about: 'HSK 3.0 levels.' },
    spaced: false,
    fonts: { serif: `'Noto Serif SC', 'Songti SC', serif`, sans: `'PingFang SC', sans-serif` },
  },
  ja: {
    id: 'ja', name: 'Japanese', native: '日本語', brand: '読書', tag: 'ja', voices: ['ja'], aid: 'furigana',
    levels: { scheme: 'JLPT', labels: ['N5', 'N4', 'N3', 'N2', 'N1'], about: 'JLPT levels from Jonathan Waller’s word lists. N5 is the easiest.' },
    spaced: false,
    fonts: { serif: `'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', 'Noto Serif JP', serif`, sans: `'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif` },
    load: () => import('./ja'),
  },
  es: {
    id: 'es', name: 'Spanish', native: 'Español', brand: 'Leer', tag: 'es', voices: ['es'], aid: 'hint',
    levels: FREQ_LEVELS('Spanish'), spaced: true, fonts: { serif: LATIN_SERIF, sans: LATIN_SANS },
    load: () => import('./spaced/es'),
  },
  fr: {
    id: 'fr', name: 'French', native: 'Français', brand: 'Lire', tag: 'fr', voices: ['fr'], aid: 'hint',
    levels: FREQ_LEVELS('French'), spaced: true, fonts: { serif: LATIN_SERIF, sans: LATIN_SANS },
    load: () => import('./spaced/fr'),
  },
  de: {
    id: 'de', name: 'German', native: 'Deutsch', brand: 'Lesen', tag: 'de', voices: ['de'], aid: 'hint',
    levels: FREQ_LEVELS('German'), spaced: true, fonts: { serif: LATIN_SERIF, sans: LATIN_SANS },
    load: () => import('./spaced/de'),
  },
  it: {
    id: 'it', name: 'Italian', native: 'Italiano', brand: 'Leggere', tag: 'it', voices: ['it'], aid: 'hint',
    levels: FREQ_LEVELS('Italian'), spaced: true, fonts: { serif: LATIN_SERIF, sans: LATIN_SANS },
    load: () => import('./spaced/it'),
  },
  pt: {
    id: 'pt', name: 'Portuguese', native: 'Português', brand: 'Ler', tag: 'pt', voices: ['pt'], aid: 'hint',
    levels: FREQ_LEVELS('Portuguese'), spaced: true, fonts: { serif: LATIN_SERIF, sans: LATIN_SANS },
    load: () => import('./spaced/pt'),
  },
  ru: {
    id: 'ru', name: 'Russian', native: 'Русский', brand: 'Чтение', tag: 'ru', voices: ['ru'], aid: 'hint', stress: true,
    levels: FREQ_LEVELS('Russian'), spaced: true,
    fonts: { serif: `'Iowan Old Style', 'PT Serif', 'Georgia', 'Times New Roman', serif`, sans: LATIN_SANS },
    load: () => import('./spaced/ru'),
  },
};

export const LANG_IDS = Object.keys(LANGS) as LangId[];
export const isLangId = (v: unknown): v is LangId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(LANGS, v);
