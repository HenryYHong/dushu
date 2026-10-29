// How much of a book's vocabulary you know, for the library cards. Counting a whole novel would take seconds, so a sample
// is counted: six chapters spread over the book, the first 4,000 characters of each, segmented like the reader (the book's
// names and terms left out). The counts are kept on this device (localStorage, `dushu.book-words.v1`), so the share is
// worked out again from them whenever the known words change, without reading the book. ARCHITECTURE.md 5.4.
import type { BookMeta, Dictionary, Lexicon, Store } from '../types';
import { chapterWords, type ChapterWordsOptions } from './chapterWords';
import { langKey } from '../lang/active';

export const SAMPLE_CHAPTERS = 6;
export const SAMPLE_CHARS = 4000;
/** Per library: each language keeps the samples of its own books (lang/active.ts langKey). */
const CACHE_KEY = (): string => langKey('dushu.book-words.v1');

export interface BookSample {
  /** What the sample was taken from; a different key (chapters added, names found) means take it again. */
  key: string;
  /** Word occurrences counted. */
  total: number;
  /** [simplified word, count] */
  words: [string, number][];
}

/** The chapters a sample reads: spread evenly, missing the very first and last (front matter, afterwords) when it can. */
export function sampleChapters(count: number, n = SAMPLE_CHAPTERS): number[] {
  if (count <= n) return Array.from({ length: count }, (_, i) => i);
  const out = new Set<number>();
  for (let k = 0; k < n; k++) out.add(Math.min(count - 1, Math.floor(((k + 0.5) * count) / n)));
  return [...out];
}

export function sampleKey(book: Pick<BookMeta, 'chapterCount' | 'charCount'>, lexicon?: Lexicon): string {
  return `${book.chapterCount}|${book.charCount}|${lexicon?.entries().length ?? 0}`;
}

/** Count the words of a sample of `book`. */
export async function sampleBook(
  store: Pick<Store, 'books'>, dict: Dictionary, book: BookMeta, lexicon?: Lexicon, opts: ChapterWordsOptions = {},
): Promise<BookSample> {
  const texts: string[] = [];
  for (const i of sampleChapters(book.chapterCount)) {
    const c = await store.books.chapter(book.id, i).catch(() => undefined);
    if (!c) continue;
    let left = SAMPLE_CHARS;
    for (const b of c.blocks) {
      if (left <= 0) break;
      if (b.t !== 'p' && b.t !== 'quote' && b.t !== 'h') continue;
      const t = b.text.length > left ? b.text.slice(0, left) : b.text;
      texts.push(t);
      left -= t.length;
    }
  }
  const got = await chapterWords(texts, dict, lexicon, opts);
  return { key: sampleKey(book, lexicon), total: got.total, words: got.words.map((w) => [w.key, w.count]) };
}

/** The share of the sample's word occurrences that are known, 0..1 (null when the sample has no words). */
export function knownShare(sample: BookSample, isKnown: (word: string) => boolean): number | null {
  if (!sample.total) return null;
  let known = 0;
  for (const [w, n] of sample.words) if (isKnown(w)) known += n;
  return known / sample.total;
}

// ---------------------------------------------------------------- device cache

/** Every sample kept on this device, by book id. */
export function readCache(): Record<string, BookSample> {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY()) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

/** The sample kept for `bookId`; with `key`, only if it was taken from the book as it is now. */
export function cachedSample(bookId: string, key?: string): BookSample | null {
  const s = readCache()[bookId];
  return s && (key === undefined || s.key === key) && Array.isArray(s.words) && typeof s.total === 'number' ? s : null;
}

/** Keep `sample` for `bookId`, and drop the samples of books that are gone. */
export function keepSample(bookId: string, sample: BookSample, books: string[]): void {
  const all = readCache();
  all[bookId] = sample;
  const live = new Set(books);
  for (const id of Object.keys(all)) if (!live.has(id)) delete all[id];
  try { localStorage.setItem(CACHE_KEY(), JSON.stringify(all)); } catch { /* full or blocked: it is counted again next time */ }
}
