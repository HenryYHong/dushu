// The cover a book shows: the automatic choice (the book's own picture, else its era's style, era.ts), or the reader's own
// pick from the book card's menu. Picks are a synced setting (core/covers.ts), by each book's sync key.
import type { BookMeta } from '../../types';
import { parseCovers, withCover } from '../../core/covers';
import { bookKey, type KeyedBook } from '../../core/syncKeys';
import { bookEra, type BookEra, type EraInput } from './era';

export type CoverChoice = 'auto' | BookEra;
type CoverBook = KeyedBook & EraInput & Partial<Pick<BookMeta, 'author'>>;

/** What the menu shows as chosen for this book, from the covers setting. */
export function coverChoice(covers: string, book: KeyedBook): CoverChoice {
  return parseCovers(covers).get(bookKey(book)) ?? 'auto';
}

/** The covers setting with this book's pick; 'auto' forgets it. */
export function withCoverChoice(covers: string, book: KeyedBook, choice: CoverChoice): string {
  return withCover(covers, bookKey(book), choice === 'auto' ? null : choice);
}

/** The cover family a book is drawn with. */
export function coverStyleFor(covers: string, book: CoverBook): BookEra {
  const pick = coverChoice(covers, book);
  return pick === 'auto' ? bookEra(book) : pick;
}
