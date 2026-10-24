// The cover a book shows: the automatic choice (era.ts), or the reader's own pick from the book card's menu.
// The pick is a display preference of this browser: a small map in localStorage, keyed by book id, never synced.
import type { BookMeta } from '../../types';
import { bookEra, type BookEra, type EraInput } from './era';

export type CoverChoice = 'auto' | BookEra;

const KEY = 'dushu.cover-style.v1';
/** Where the picks live when storage is blocked: they last until the tab closes. */
let memory: Record<string, BookEra> | null = null;

function readMap(): Record<string, BookEra> {
  if (memory) return { ...memory };
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, BookEra> = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) if (v === 'classic' || v === 'modern') out[id] = v;
    return out;
  } catch { return {}; }
}

/** What the menu shows as chosen for this book. */
export function coverChoice(bookId: string): CoverChoice {
  return readMap()[bookId] ?? 'auto';
}

/** Saves the reader's pick; 'auto' forgets it. */
export function setCoverChoice(bookId: string, choice: CoverChoice): void {
  const map = readMap();
  if (choice === 'auto') delete map[bookId]; else map[bookId] = choice;
  try {
    if (!globalThis.localStorage) throw new Error('no storage');
    globalThis.localStorage.setItem(KEY, JSON.stringify(map));
    memory = null;
  } catch { memory = map; /* storage blocked: the pick lasts this visit */ }
}

/** The cover family a book is drawn with. */
export function coverStyleFor(book: Pick<BookMeta, 'id'> & EraInput): BookEra {
  const pick = coverChoice(book.id);
  return pick === 'auto' ? bookEra(book) : pick;
}
