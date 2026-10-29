// Remembers each word looked up in the reader, by local day, for practice (Vocabulary, Looked up). It runs after the card has
// opened and never throws, so it can never slow a lookup down or get in its way.
import type { AppContext, Dictionary, Token, VocabItem } from '../../types';
import { glossFor, headwordsFor } from './saveWord';
import { activeEngine } from '../../lang/active';
import { hasLetters, langVocabItem, safeLookup } from '../../lang/words';

/** The local day of a time, YYYY-MM-DD (the day as the reader lived it, not UTC). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface LookupInput {
  word: string;
  /** Numbered pinyin as read on the page, one per character. */
  syllables: string[];
  around?: { prev?: string; next?: string };
  context?: VocabItem['context'];
  /** The book's own meaning for the word (its lexicon: a name, a term), as the card shows it. */
  bookGloss?: string;
  /** Another language: the token as cut on the page. */
  token?: Token;
}

export function logLookup(ctx: AppContext, dict: Dictionary, input: LookupInput, now = Date.now()): void {
  setTimeout(() => {
    try {
      const engine = activeEngine();
      if (engine) {
        // Another language: the row is the word's dictionary form and its meaning, as its card would save it.
        if (!hasLetters(input.word)) return;
        const lu = safeLookup(engine, input.word, input.token, input.context?.sentence);
        const item = langVocabItem(lu, { token: input.token, context: input.context, ownGloss: input.bookGloss, now });
        void ctx.store.lookups.log({ day: localDay(now), id: item.id, word: input.word, pinyin: item.pinyin, gloss: item.gloss, context: item.context }, now).catch(() => {});
        return;
      }
      if (!/\p{Script=Han}/u.test(input.word)) return;
      const entries = dict.lookup(input.word);
      const { simp } = headwordsFor(dict, input.word, entries, input.syllables);
      const c = input.context;
      void ctx.store.lookups.log({
        day: localDay(now),
        id: simp,
        word: input.word,
        pinyin: input.syllables.filter(Boolean).join(' ').toLowerCase(),
        gloss: input.bookGloss || glossFor(dict, input.word, input.syllables, input.around, entries),
        context: c?.sentence ? { sentence: c.sentence, bookId: c.bookId, bookTitle: c.bookTitle, chapter: c.chapter } : undefined,
      }, now).catch(() => {});
    } catch { /* a history entry is never worth an error */ }
  }, 0);
}
