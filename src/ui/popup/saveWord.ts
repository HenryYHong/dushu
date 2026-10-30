// What saving a word makes: the flashcard's spellings and gloss for the reading on screen. Shared by the word card and the
// reader's Words tab, so a word saved from either has the same card.
import type { Dictionary, DictEntry, LookupRow, VocabItem } from '../../types';
import { activeEngine } from '../../lang/active';
import { langVocabItem, safeLookup } from '../../lang/words';
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

/**
 * The flashcard for a word from "Looked up" (Review's new cards, Practice's Save). Chinese reads the dictionary for the reading
 * logged; another language asks its engine, and keeps the key the row was logged under so it stays the same word.
 */
export function itemFromLookupRow(dict: Dictionary, r: Pick<LookupRow, 'id' | 'word' | 'pinyin' | 'gloss' | 'context'>, now = Date.now(),
  { bookGloss = true }: { bookGloss?: boolean } = {}): VocabItem {
  const engine = activeEngine();
  if (engine) {
    const lu = safeLookup(engine, r.word, undefined, r.context?.sentence);
    // The entry the row was logged under first (its key), so a word saved from the list is the word that was looked up.
    const entries = [...lu.entries].sort((a, b) => Number(engine.normalize(b.head) === r.id) - Number(engine.normalize(a.head) === r.id));
    const item = langVocabItem({ ...lu, key: r.id, entries }, { context: r.context, ownGloss: r.gloss, now });
    if (r.pinyin && !item.pinyin) item.pinyin = r.pinyin;
    return item;
  }
  const item = vocabItemFor(dict, { word: r.word, syllables: r.pinyin ? r.pinyin.split(' ') : [], context: r.context, now });
  // A name or term only the book defines: the meaning logged with the lookup (the book's own, as its card showed it). Chinese
  // Save in Vocabulary and Practice never took it (bookGloss false there), and keeps it that way.
  if (bookGloss && !item.gloss && r.gloss) item.gloss = r.gloss;
  return item;
}
