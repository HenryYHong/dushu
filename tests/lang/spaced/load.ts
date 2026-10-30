// Loads a spaced language's real engine from public/data/<id>/ for tests, once per worker, and reads the excerpts in
// fixtures/ (public-domain books, a few thousand words each).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LangEngine, WordLookup } from '../../../src/lang/types';
import type { Token } from '../../../src/types';

const ROOT = join(__dirname, '..', '..', '..');
/** DUSHU_LANG_DATA=<dir> reads <dir>/<id>/ instead (a build made elsewhere, checked before it replaces public/data). */
const DATA = process.env.DUSHU_LANG_DATA || join(ROOT, 'public', 'data');
const cache = new Map<string, Promise<LangEngine>>();

export function loadLang(id: 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ru'): Promise<LangEngine> {
  let p = cache.get(id);
  if (!p) {
    p = import(`../../../src/lang/spaced/${id}.ts`).then((m: { loadEngine: (base: string, opts: object) => Promise<LangEngine> }) =>
      m.loadEngine('/', { fetchBytes: (name: string) => readFile(join(DATA, id, name)) }));
    cache.set(id, p);
  }
  return p;
}

export async function fixture(name: string): Promise<string[]> {
  const text = await readFile(join(__dirname, 'fixtures', name + '.txt'), 'utf8');
  return text.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
}

/** The word tokens of a sentence. */
export const words = (eng: LangEngine, text: string): Token[] => eng.segment(text).filter((t) => t.kind === 'word');

/** The word token with this text (the first, or the nth). */
export function tok(eng: LangEngine, text: string, word: string, nth = 0): Token {
  const found = words(eng, text).filter((t) => t.text === word);
  if (!found[nth]) throw new Error(`no token ${word} in: ${text}`);
  return found[nth];
}

/** The lookup of a word in its sentence, as the reader's popup asks for it. */
export function lookupIn(eng: LangEngine, text: string, word: string, nth = 0): WordLookup {
  const t = tok(eng, text, word, nth);
  return eng.lookup(t.text, { token: t, sentence: text });
}

/** Tokens cover the text exactly, in order, with right offsets. */
export function expectCovers(tokens: Token[], text: string): void {
  let at = 0;
  for (const t of tokens) {
    if (t.start !== at || t.end !== at + t.text.length || text.slice(t.start, t.end) !== t.text) {
      throw new Error(`bad token ${JSON.stringify(t)} at ${at}`);
    }
    at = t.end;
  }
  if (at !== text.length) throw new Error(`tokens end at ${at}, text at ${text.length}`);
}
