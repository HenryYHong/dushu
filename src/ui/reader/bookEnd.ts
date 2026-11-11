// The end of a book: the first time a reader gets to the end of a book's last chapter, Pengu says so (reader.ts, bookFinished).
// Once per book on this device: the books celebrated are kept in localStorage. It must never fire by itself: not when a book
// opens at its end (finished before, or one short chapter that fits on a screen), not while a chapter is still being laid out.
// The reader has to get there from somewhere else in the book.

/** The books celebrated on this device: id -> when. */
const KEY = 'dushu.books-finished.v1';

/** A saved place this far in is a finished book, as the library labels it ("Finished", library/format.ts progressLabel). */
export const FINISHED_AT = 0.995;

function read(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

/** Whether this book's end was celebrated (or found already reached) on this device. */
export function finishedBefore(bookId: string): boolean {
  return typeof read()[bookId] === 'number';
}

/** Remembers that this book's end was reached, so it is not celebrated again. */
export function markFinished(bookId: string, now = Date.now()): void {
  const all = read();
  if (typeof all[bookId] === 'number') return;
  all[bookId] = now;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: it may come again next time */ }
}

export interface FinishWatch {
  /**
   * Where the reader is now: true when the end of the last chapter is on screen, false when not, null when it cannot be told yet
   * (the last chapter is still being laid out). Returns true once: the first time the reader reaches the end from elsewhere.
   */
  see(atEnd: boolean | null): boolean;
}

/**
 * Watches the reader's place for the end of the book. `openedFinished`: the place saved before this visit was already at the end
 * (FINISHED_AT), so the book was finished before and is only remembered as such.
 */
export function watchFinish(bookId: string, openedFinished: boolean): FinishWatch {
  let done = finishedBefore(bookId);
  if (!done && openedFinished) { markFinished(bookId); done = true; }
  // Somewhere else in the book was seen on this visit: reaching the end now is the reader's doing.
  let away = false;
  return {
    see(atEnd) {
      if (done || atEnd === null) return false;
      if (!atEnd) { away = true; return false; }
      // At the end since the book opened (one short chapter, or a place restored there): nothing to celebrate yet.
      if (!away) return false;
      done = true;
      markFinished(bookId);
      return true;
    },
  };
}
