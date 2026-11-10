// The app's own words in the reader's language (Settings › Your language, or the welcome screen). Every string the app shows is
// written in English in the code and passed through tt() (or ttn() for a count); the catalog for the chosen language
// (catalogs/<code>.json, built from strings.json by scripts/i18n) gives its translation, and a string it lacks stays English.
// The English is the key, so English needs no catalog and reads exactly as written. Books, dictionaries and translations are
// not the app's words and are never passed through here.
//
//   tt('Delete all data')                       a sentence or label
//   tt('Added {title}.', { title })             with a value: {name} marks where it goes, so a language can move it
//   ttn(n, '{n} word', '{n} words')             a count: each language says which form a number takes (Intl.PluralRules)
//   const LABEL = ttm('Casual'); … tt(LABEL)    a string kept in a constant: ttm marks it for the catalog, tt shows it
//
// A sentence is translated whole: never build one from pieces ('Added ' + n + ' words'), since word order differs.

export const UI_LANGS = ['en', 'zh', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'ru'] as const;
export type UiLang = (typeof UI_LANGS)[number];
/** Each one's name in itself, for the list. */
export const UI_NAMES: Record<UiLang, string> = {
  en: 'English', zh: '简体中文', 'zh-Hant': '繁體中文', ja: '日本語', ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch',
  it: 'Italiano', pt: 'Português', ru: 'Русский',
};
/** The tag Intl and `<html lang>` take. English stays en-US: the numbers and dates it writes are the ones the app always wrote. */
const LOCALES: Record<UiLang, string> = {
  en: 'en-US', zh: 'zh-Hans', 'zh-Hant': 'zh-Hant', ja: 'ja', ko: 'ko', es: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt-BR', ru: 'ru',
};

/** The language chosen on this device: `{ lang, at }`. None: the browser's language when the app has it, else English. */
export const UI_KEY = 'dushu.ui.v1';

type Plural = Partial<Record<Intl.LDMLPluralRule, string>>;
export type Catalog = Record<string, string | Plural>;

let current: UiLang = 'en';
let catalog: Catalog = {};
let rules = new Intl.PluralRules('en-US');
let numbers = new Intl.NumberFormat('en-US');

export const isUiLang = (v: unknown): v is UiLang => typeof v === 'string' && (UI_LANGS as readonly string[]).includes(v);

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** The language this device chose, if it did. */
export function chosenUiLang(store = storage()): { lang: UiLang; at: number } | null {
  try {
    const raw = JSON.parse(store?.getItem(UI_KEY) ?? 'null') as { lang?: unknown; at?: unknown } | null;
    if (raw && isUiLang(raw.lang)) return { lang: raw.lang, at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0 };
  } catch { /* not set */ }
  return null;
}

/** The app's language for these browser languages: the first the app has (zh-TW, zh-HK and zh-Hant read traditional), else English. */
export function guessUiLang(prefs: readonly string[] = globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? 'en']): UiLang {
  for (const p of prefs) {
    const tag = (p || '').toLowerCase();
    const base = tag.split('-')[0];
    if (base === 'zh') return /hant|-tw|-hk|-mo/.test(tag) ? 'zh-Hant' : 'zh';
    if (isUiLang(base)) return base;
  }
  return 'en';
}

/** The app's language now. */
export const uiLang = (): UiLang => current;
/** Its tag for Intl (dates, numbers, sorting) and `lang` attributes. */
export const uiLocale = (): string => LOCALES[current];

const loaders = import.meta.glob<{ default: Catalog }>('./catalogs/*.json');

/** Takes `lang` as the app's language: its catalog, number format and plural rules. English needs nothing loaded. */
export async function useUiLang(lang: UiLang): Promise<void> {
  let next: Catalog = {};
  if (lang !== 'en') {
    const load = loaders[`./catalogs/${lang}.json`];
    try { next = load ? (await load()).default : {}; } catch { next = {}; /* offline before it was kept: English this time */ }
  }
  current = lang;
  catalog = next;
  rules = new Intl.PluralRules(LOCALES[lang]);
  numbers = new Intl.NumberFormat(LOCALES[lang]);
  if (typeof document !== 'undefined') document.documentElement.lang = LOCALES[lang];
}

/** At start: the language chosen here, or the browser's. */
export function startI18n(): Promise<void> {
  return useUiLang(chosenUiLang()?.lang ?? guessUiLang());
}

/** Keeps `lang` as this device's choice. The caller reloads the page, so every screen is drawn again in it. */
export function chooseUiLang(lang: UiLang, store = storage()): void {
  try { store?.setItem(UI_KEY, JSON.stringify({ lang, at: Date.now() })); } catch { /* this visit only */ }
}

/** For tests: a catalog in place of the shipped one. */
export function setCatalogForTest(lang: UiLang, c: Catalog): void {
  current = lang;
  catalog = c;
  rules = new Intl.PluralRules(LOCALES[lang]);
  numbers = new Intl.NumberFormat(LOCALES[lang]);
}

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** `src` (English, as written) in the app's language, with its {values} filled in. */
export function tt(src: string, vars?: Record<string, string | number>): string {
  const e = catalog[src];
  return fill(typeof e === 'string' && e ? e : src, vars);
}

/**
 * A count: `one` and `other` are the English forms ('{n} word', '{n} words'); {n} is the number as this language writes it.
 * The catalog keys it by `other` and gives the forms its language has (one, few, many, other…).
 */
export function ttn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const e = catalog[other];
  let s: string;
  if (e && typeof e === 'object') s = e[rules.select(n)] ?? e.other ?? (n === 1 ? one : other);
  else if (typeof e === 'string' && e) s = e;
  else s = n === 1 ? one : other;
  return fill(s, { n: numbers.format(n), ...vars });
}

/** Marks a string kept in a constant for the catalog; show it with tt(). */
export const ttm = <T extends string>(src: T): T => src;

/** A number as the app's language writes it (1,234 in English, 1 234 in French). */
export const num = (n: number): string => numbers.format(n);

/**
 * A language's name in the app's language: `english` as given in English ('Spanish'), Intl's name otherwise ('espagnol').
 * Falls back to `english` where Intl has none.
 */
export function langName(code: string, english: string): string {
  if (current === 'en') return english;
  try { return new Intl.DisplayNames([LOCALES[current]], { type: 'language' }).of(code) ?? english; } catch { return english; }
}
