// A fix as a record (core/fixes.ts): its id, the check that a stored or received one is whole, and what goes over the wire.
// Apart from fixes.ts so the store and sync can take these without the lexicon and the cut code that fixes.ts needs.
import type { Fix, FixAnchor, LexiconEntry } from '../types';
import { canonical, hash } from './syncKeys';

/** Characters of context kept on each side of a "here only" fix. */
export const ANCHOR_SIDE = 8;
/** The longest word a fix may name, in code points. */
export const FIX_MAX_WORD = 16;

const cps = (s: string): string[] => [...s];

/**
 * A fix's id: the book, what is fixed and where. A word's joins, cuts and "not a word" share one (the latest says what the word is),
 * a reading has its own, so does a "here only" fix at each place. The same fix made on two devices is then one record.
 */
export function fixId(book: string, kind: Fix['kind'], word: string, at?: FixAnchor): string {
  const family = kind === 'reading' ? 'r' : kind === 'spelling' ? 's' : 'w';
  return hash(canonical({ b: book, f: family, w: word, a: at ? `${at.chapter}.${at.block}.${at.offset}` : '' }));
}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const KINDS = new Set<Fix['kind']>(['word', 'unword', 'cut', 'reading', 'spelling']);
const ROLES = new Set<LexiconEntry['kind']>(['name', 'place', 'term', 'user']);
const nat = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9;
const HAN = /^[\p{Script=Han}〇]+$/u;

/** A side of an anchor: at most ANCHOR_SIDE code points. */
const side = (v: unknown) => (typeof v === 'string' ? cps(v).slice(0, ANCHOR_SIDE).join('') : '');

/**
 * A fix as Dushu can use it, from storage, a backup, another device or a file; null when it is not one. `id`, `book` and `bookId`
 * are checked as given (sync and files set them for the book they land in).
 */
export function cleanFix(v: unknown): Fix | null {
  if (!isObj(v)) return null;
  const kind = v.kind as Fix['kind'];
  const word = typeof v.word === 'string' ? v.word : '';
  const n = cps(word).length;
  if (!KINDS.has(kind) || !n || n > FIX_MAX_WORD || !HAN.test(word)) return null;
  if (typeof v.id !== 'string' || !v.id || v.id.length > 40 || typeof v.book !== 'string' || !v.book || v.book.length > 100) return null;
  const bookId = typeof v.bookId === 'string' && v.bookId && v.bookId.length <= 100 ? v.bookId : v.book;
  const t = typeof v.t === 'number' && Number.isFinite(v.t) && v.t >= 0 ? v.t : 0;
  const fix: Fix = { id: v.id, book: v.book, bookId, kind, word, on: v.on !== false, t };
  if (kind === 'cut') {
    const cuts = Array.isArray(v.cuts) ? [...new Set(v.cuts.filter((c): c is number => nat(c) && c > 0 && c < n))].sort((a, b) => a - b) : [];
    if (!cuts.length) return null;
    fix.cuts = cuts;
  }
  if (kind === 'word' || kind === 'reading') {
    const py = typeof v.pinyin === 'string' ? v.pinyin.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
    if (py.length === n && py.every((s) => /^[a-zü]{1,7}[1-5]$/.test(s))) fix.pinyin = py.join(' ');
    else if (kind === 'reading') return null;
  }
  if (kind === 'word') {
    if (n < 2 && !v.at) return null;
    if (typeof v.gloss === 'string' && v.gloss.trim()) fix.gloss = v.gloss.trim().slice(0, 300);
    fix.role = ROLES.has(v.role as LexiconEntry['kind']) ? (v.role as LexiconEntry['kind']) : 'user';
  }
  if (isObj(v.at)) {
    const a = v.at;
    if (!nat(a.chapter) || !nat(a.block) || !nat(a.offset)) return null;
    fix.at = { chapter: a.chapter, block: a.block, offset: a.offset, before: side(a.before), after: side(a.after) };
  }
  if (kind === 'spelling' && fix.at) return null;
  if (typeof v.n === 'number' && nat(v.n)) fix.n = v.n;
  return fix;
}

/** What one fix says about its book for a file or another device: the book is named by its key, the device's own id left out. */
export function fixWire(f: Fix): Omit<Fix, 'bookId'> {
  const { bookId: _b, ...rest } = f;
  void _b;
  return rest;
}
