// The Chinese dictionary's place when the page reads another language. Screens written for Chinese still ask ctx.dict()
// for script conversion and HSK levels; here every answer is the neutral one (no entries, text unchanged), so a path that
// has no other-language branch yet shows less instead of breaking. The language's own engine (activeEngine) does the work.
import type { Dictionary } from '../types';
import type { LangEngine } from './types';

export function noChineseDictionary(engine: LangEngine): Dictionary {
  return {
    lookup: () => [],
    hasWord: () => false,
    freq: () => 0,
    char: () => null,
    hsk: () => null,
    hskWords: () => [],
    wordsAt: () => [],
    pinyinFor: (word) => [...word].map(() => ''),
    toSimplified: (text) => text,
    toTraditional: (text) => text,
    meta: { built: engine.meta.built, unicode: '', counts: { ...engine.meta.counts }, sources: [...engine.meta.sources] },
  };
}
