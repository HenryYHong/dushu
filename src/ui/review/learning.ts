// What Review asks: the saved words that are due, and the words looked up while reading that are not saved or known yet, as
// new cards. A looked-up word becomes a saved word (with its schedule) the first time it is graded, so the words being learned
// come up in Review without saving each one by hand.
import type { Dictionary, LookupRow, Store, VocabItem } from '../../types';
import { vocabItemFor } from '../popup/saveWord';

/** New cards from looked-up words in one session at most: the rest wait for the next one. */
export const NEW_PER_SESSION = 20;

/** The looked-up words to learn: one row per word (its latest lookup), newest first, none saved or known. */
export function wordsToLearn(rows: LookupRow[], saved: (w: string) => boolean, known: (w: string) => boolean): LookupRow[] {
  const latest = new Map<string, LookupRow>();
  for (const r of rows) {
    const had = latest.get(r.id);
    if (!had || r.last > had.last) latest.set(r.id, r);
  }
  return [...latest.values()]
    .filter((r) => !saved(r.id) && !saved(r.word) && !known(r.id) && !known(r.word))
    .sort((a, b) => b.last - a.last);
}

/** How many cards Review has now: the due saved words and the new ones it would add (for the badge). */
export async function reviewCount(store: Store, now = Date.now()): Promise<number> {
  const due = (await store.vocab.due(now)).length;
  const fresh = wordsToLearn(await store.lookups.list(), (w) => store.vocab.has(w), (w) => store.known.has(w)).length;
  return due + Math.min(fresh, NEW_PER_SESSION);
}

export interface ReviewCards {
  due: VocabItem[];
  /** Looked-up words as new cards, not saved yet (Review saves each one when it is graded). */
  fresh: VocabItem[];
}

/** The cards for a session. The dictionary (for each new card's headwords and meaning) is loaded only when there are new
 * cards; without it, the due saved words are reviewed on their own. */
export async function reviewCards(store: Store, getDict: () => Promise<Dictionary>, now = Date.now()): Promise<ReviewCards> {
  const due = await store.vocab.due(now);
  const rows = wordsToLearn(await store.lookups.list(), (w) => store.vocab.has(w), (w) => store.known.has(w)).slice(0, NEW_PER_SESSION);
  if (!rows.length) return { due, fresh: [] };
  let dict: Dictionary;
  try { dict = await getDict(); } catch { return { due, fresh: [] }; }
  const seen = new Set(due.map((v) => v.id));
  const fresh: VocabItem[] = [];
  for (const r of rows) {
    const item = vocabItemFor(dict, { word: r.word, syllables: r.pinyin ? r.pinyin.split(' ') : [], context: r.context, now });
    if (seen.has(item.id) || store.vocab.has(item.id)) continue;
    seen.add(item.id);
    fresh.push(item);
  }
  return { due, fresh };
}
