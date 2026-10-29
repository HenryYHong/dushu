// Which language this page reads. One language per page load: switching reloads the page, so a module may read it once.
// Chinese is the original app and keeps every name it had (the 'dushu' database, the dushu.* keys); another language
// gets its own database and settings, so its books, words and places never mix with the Chinese ones.
import { LANGS, isLangId, type LangInfo } from './registry';
import type { LangEngine, LangId } from './types';

/** The language last read on this device (not per language: it says which one opens). */
export const LANG_KEY = 'dushu.lang.v1';

let current: LangId | null = null;
let engine: LangEngine | null = null;

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** ?lang=ja in the address opens Japanese (and makes it the one that opens next time); else the last one read; else Chinese. */
function pick(): LangId {
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
    if (isLangId(q)) {
      try { storage()?.setItem(LANG_KEY, q); } catch { /* the address still says it */ }
      return q;
    }
  } catch { /* no location */ }
  const saved = storage()?.getItem(LANG_KEY);
  return isLangId(saved) ? saved : 'zh';
}

export function langId(): LangId {
  return (current ??= pick());
}

export const lang = (): LangInfo => LANGS[langId()];
export const isChinese = (): boolean => langId() === 'zh';

/** A localStorage key for this language: Chinese keeps the original name, another language gets its own (dushu.ja.…). */
export const langKey = (key: string): string => (isChinese() ? key : key.replace(/^dushu\./, `dushu.${langId()}.`));

/** The IndexedDB database for this language's books and words. */
export const storeName = (): string => (isChinese() ? 'dushu' : `dushu-${langId()}`);

/** Opens the app in another language: it reloads at the library, so nothing of the old language stays in memory. */
export function switchLang(id: LangId): void {
  try { storage()?.setItem(LANG_KEY, id); } catch { /* the address carries it */ }
  const url = new URL(location.href);
  url.search = id === 'zh' ? '' : `?lang=${id}`;
  url.hash = '#/';
  location.assign(url.href);
}

/**
 * Whether this language syncs with the account and the Mac. Off for the languages other than Chinese until the sync
 * format that keeps each language's records apart (core/sync.ts, '@<id>:' keys) is live on every Chinese device: a Chinese
 * copy from before it would take a Japanese saved word for a Chinese one.
 */
export const OTHER_LANGUAGES_SYNC = false;
export const syncsHere = (): boolean => isChinese() || OTHER_LANGUAGES_SYNC;

/** The engine of a language other than Chinese, once main.ts has loaded it (null for Chinese and before it loads). */
export const activeEngine = (): LangEngine | null => engine;
export function setActiveEngine(e: LangEngine | null): void {
  engine = e;
}

/** Tests: read as this language from now on (null: pick again from the address and storage). */
export function setLangForTests(id: LangId | null, e: LangEngine | null = null): void {
  current = id;
  engine = e;
}
