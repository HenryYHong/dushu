// The cover a book shows: the automatic choice (the book's own picture, else its era's style, era.ts), or the reader's own
// pick from the book card's menu. Picks are a synced setting (core/covers.ts), by each book's sync key.
import type { BookMeta } from '../../types';
import { parseCovers, withCover } from '../../core/covers';
import { bookKey, olderKeys, type KeyedBook } from '../../core/syncKeys';
import { bookEra, type BookEra, type EraInput } from './era';

export type CoverChoice = 'auto' | BookEra;
type CoverBook = KeyedBook & EraInput & Partial<Pick<BookMeta, 'author'>>;

/**
 * The key the covers setting holds this book's pick under: its own, or the one an older importer gave it (a pick made
 * before the book was imported again stays its pick, and a device that has not imported it again yet still finds it).
 */
function pickKey(picks: Map<string, unknown>, book: KeyedBook): string {
  const key = bookKey(book);
  return [key, ...olderKeys(key).reverse()].find((k) => picks.has(k)) ?? key;
}

/** What the menu shows as chosen for this book, from the covers setting. */
export function coverChoice(covers: string, book: KeyedBook): CoverChoice {
  const picks = parseCovers(covers);
  return picks.get(pickKey(picks, book)) ?? 'auto';
}

/** The covers setting with this book's pick, under the key it is held by already; 'auto' forgets it under every key. */
export function withCoverChoice(covers: string, book: KeyedBook, choice: CoverChoice): string {
  if (choice !== 'auto') return withCover(covers, pickKey(parseCovers(covers), book), choice);
  const key = bookKey(book);
  return [key, ...olderKeys(key)].reduce((text, k) => withCover(text, k, null), covers);
}

/** The cover family a book is drawn with. */
export function coverStyleFor(covers: string, book: CoverBook): BookEra {
  const pick = coverChoice(covers, book);
  return pick === 'auto' ? bookEra(book) : pick;
}
