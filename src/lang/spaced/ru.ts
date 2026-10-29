// Russian. Every word gets its stressed vowel where the dictionary knows it (сказа́ла); ё and е are one letter for
// matching; particles hyphened to a word stay with it (скажи-ка, кто-то).
import type { LangEngine } from '../types';
import { loadSpacedEngine, type LoadOpts, type SpacedLang } from './core';

export const RUSSIAN: SpacedLang = {
  id: 'ru',
  script: 'cyrillic',
  stress: true,
  hyphenClitics: ['то', 'ка', 'нибудь', 'либо', 'таки', 'де', 'с'],
};

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(RUSSIAN, baseUrl, opts);
}
