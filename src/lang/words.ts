// Saving and logging words of a language other than Chinese: what a flashcard and a "Looked up" row hold, from the engine's
// lookup (lang/types.ts). The fields are the Chinese ones, read differently: `simp` is the dictionary form, `pinyin` the reading
// (Japanese kana, Russian with its stress marked, else empty), `id` the key every form of the word shares.
import type { Token, VocabItem } from '../types';
import { newSrs } from '../core/srs';
import type { LangEngine, WordEntry, WordLookup } from './types';

/** A short meaning for a card: the first sense's first glosses, without what is in parentheses when that leaves enough. */
export function shortGlossOf(entries: readonly WordEntry[], max = 80): string {
  const e = entries[0];
  if (!e) return '';
  const glosses = e.senses[0]?.glosses ?? [];
  let out = '';
  for (const g of glosses) {
    const next = out ? `${out}; ${g}` : g;
    if (next.length > max && out) break;
    out = next;
  }
  if (out.length <= max) return out;
  const plain = out.replace(/\s*\([^)]*\)/g, '').trim();
  return plain.length <= max ? plain : `${plain.slice(0, max - 1).trimEnd()}…`;
}

/** The headword a looked-up word is saved under: the first entry's dictionary form, else the lemma, else the word itself. */
export function headOf(lu: WordLookup, token?: { lemma?: string }): { head: string; reading: string } {
  const e = lu.entries[0];
  if (e) return { head: e.head, reading: e.reading ?? '' };
  return { head: token?.lemma || lu.surface, reading: '' };
}

/** The flashcard for a word of another language. */
export function langVocabItem(lu: WordLookup, input: { token?: { lemma?: string }; context?: VocabItem['context']; ownGloss?: string; now?: number }): VocabItem {
  const now = input.now ?? Date.now();
  const { head, reading } = headOf(lu, input.token);
  const item: VocabItem = {
    id: lu.key || head,
    simp: head,
    trad: head,
    pinyin: reading,
    gloss: input.ownGloss || shortGlossOf(lu.entries, 120) || (lu.name ? 'name' : ''),
    addedAt: now,
    srs: newSrs(now),
  };
  const c = input.context;
  if (c?.sentence) item.context = { sentence: c.sentence, bookId: c.bookId, bookTitle: c.bookTitle, chapter: c.chapter };
  return item;
}

/** Whether a string is worth a "Looked up" row: it has a letter of some script. */
export const hasLetters = (s: string): boolean => /\p{L}/u.test(s);

/** The lookup of a word as the engine sees it, never throwing (a card must open even if one lookup fails). */
export function safeLookup(engine: LangEngine, surface: string, token?: Token, sentence?: string): WordLookup {
  try {
    return engine.lookup(surface, { token, sentence });
  } catch (e) {
    console.error('lookup failed', surface, e);
    return { surface, key: engine.normalize(surface) || surface, entries: [] };
  }
}
