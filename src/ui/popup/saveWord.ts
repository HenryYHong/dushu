// What saving a word makes: the flashcard's spellings and gloss for the reading on screen. Shared by the word card and the
// reader's Words tab, so a word saved from either has the same card.
import type { Dictionary, DictEntry, VocabItem } from '../../types';
import { newSrs } from '../../core/srs';
import { entriesForReading } from '../../core/reading';
import { sameReading, shortGloss } from './defs';

/**
 * The simplified and traditional spellings of a word, from the entries that have the reading on screen: 了 as the particle
 * le has no other spelling, and only the liǎo "understand" row is 瞭; 干 gàn is 幹 and 干 gān is 乾. With no reading to go
 * by (or none that an entry has) every entry of the word is considered.
 */
export function headwordsFor(dict: Dictionary, word: string, entries: DictEntry[], syllables: string[]) {
  const own = entries.filter((x) => x.simp === word || x.trad === word);
  const shown = syllables.filter(Boolean).map((x) => x.toLowerCase());
  const exact = shown.length ? own.filter((x) => sameReading(x.pinyin, shown)) : [];
  const e = exact[0] ?? own[0] ?? entries[0];
  const simp = e ? e.simp : dict.toSimplified(word);
  const trad = e ? e.trad : word;
  // Every spelling the matching rows give for this word, the one on screen aside (干 gān: 乾 and 干 itself).
  const pool = exact.length ? exact : own;
  const others = [...new Set(pool.flatMap((x) => [x.trad, x.simp]))].filter((f) => f !== word);
  return { simp, trad: trad === simp ? '' : trad, others, matched: exact.length > 0 || !shown.length };
}

/** A short gloss for the reading on screen (the first matching entry), else for the word, else the character's meaning. */
export function glossFor(dict: Dictionary, word: string, syllables: string[], around?: { prev?: string; next?: string }, entries = dict.lookup(word)): string {
  const info = [...word].length === 1 ? dict.char(word) : null;
  return shortGloss(entriesForReading(entries, syllables, word, around).slice(0, 1), 120, true)
    || shortGloss(entries)
    || info?.definition.split(';').slice(0, 2).join(';').trim()
    || '';
}

export interface SaveWordInput {
  word: string;
  /** Numbered pinyin as read on screen, one syllable per character. */
  syllables: string[];
  around?: { prev?: string; next?: string };
  /** The book's own gloss (names and terms the dictionary lacks); it wins over the dictionary's. */
  bookGloss?: string;
  context?: VocabItem['context'];
  now?: number;
}

/** The new flashcard for a word. */
export function vocabItemFor(dict: Dictionary, input: SaveWordInput): VocabItem {
  const entries = dict.lookup(input.word);
  const { simp, trad } = headwordsFor(dict, input.word, entries, input.syllables);
  const now = input.now ?? Date.now();
  const item: VocabItem = {
    id: simp,
    simp,
    trad: trad || simp,
    pinyin: input.syllables.filter(Boolean).join(' ').toLowerCase(),
    gloss: input.bookGloss || glossFor(dict, input.word, input.syllables, input.around, entries),
    addedAt: now,
    srs: newSrs(now),
  };
  if (input.context?.sentence) {
    const c = input.context;
    item.context = { sentence: c.sentence, bookId: c.bookId, bookTitle: c.bookTitle, chapter: c.chapter };
  }
  return item;
}
