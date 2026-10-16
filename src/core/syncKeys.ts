// How sync names books and records (core/sync.ts). Apart from it so the store can name a book's place when the book is
// deleted, and find a place kept for a book when it is added again.
import type { BookMeta, Progress } from '../types';

/** cyrb53: a fast 53-bit string hash, as base36. Enough to tell versions of a record (or books) apart. */
export function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** JSON with sorted object keys and no undefined fields, so equal records always hash alike. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

export type KeyedBook = Pick<BookMeta, 'note' | 'sourceName' | 'chapterCount' | 'charCount' | 'chapterTitles' | 'title' | 'importVersion'>;

/**
 * The same book on every device: the Mac's books by their file's digest, the classics by their id, anything else by its
 * shape (chapter titles and size), which an import of the same file reproduces and a rename does not change.
 */
export function bookKey(b: KeyedBook): string {
  // A book imported again by a newer importer may have its chapters cut differently: to sync it is another book, so a place
  // read in the old chapters never lands in the new ones as it is. Each device moves its own place when it imports the
  // book again, and a place only kept under the old key is moved by its percent (olderKeys).
  const v = (b.importVersion ?? 1) > 1 ? `.${b.importVersion}` : '';
  const mac = /^mac-book:([a-f0-9]{64})$/.exec(b.note ?? '');
  if (mac) return `m${mac[1].slice(0, 32)}${v}`;
  if (b.sourceName?.startsWith('sample:')) return `s${b.sourceName.slice(7, 80)}${v}`;
  return `b${hash(`${b.chapterCount}|${b.charCount}|${(b.chapterTitles ?? [b.title]).join('\u0001')}`)}`;
}

/** The keys the same book had under older importers: 'mabc.3' → ['mabc', 'mabc.2']. A book added from a file has none
 * (its key is its shape, which a new importer changes anyway). */
export function olderKeys(key: string): string[] {
  const m = /^([ms].*)\.(\d+)$/.exec(key);
  if (!m) return [];
  const out = [m[1]];
  for (let v = 2; v < Number(m[2]); v++) out.push(`${m[1]}.${v}`);
  return out;
}

/** A reading place as it travels and as it is kept for a book that is not here: without the device's own book id. */
export function progressWire(p: Progress): Omit<Progress, 'bookId'> {
  const { bookId: _id, ...rest } = p;
  void _id;
  return rest;
}
