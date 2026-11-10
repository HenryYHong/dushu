// A book's old spellings in the reader (core/bookStyle.ts, ARCHITECTURE.md §4.12): 底 written for 的 and 那 for 哪 in questions, as many
// books of the 1920s and the old novels do. What the book shows is found once in the background and kept on the book (BookMeta.oldSpellings); the reader's
// choice is a 'spelling' fix of the book, synced with the other fixes. Detection decides while there is no choice.
import type { AppContext, BookMeta, OldSpellings } from '../../types';
import { OLD_SPELLINGS_VERSION, chooseOldSpellings, detectOldSpellings, withOldSpellings, type OldSpellingReport } from '../../core/bookStyle';
import { makeFix } from '../../core/fixes';
import type { Lexicon } from '../../types';
import type { BookFixes } from './bookFixes';
import type { SpellingSwitch } from './toc';
import { tt, ttm } from '../../i18n';

export type SpellingId = 'di' | 'na';
export const SPELLING_IDS: SpellingId[] = ['di', 'na'];

/** The character each switch is about, and how the Corrections tab says it (in English: switches() gives the app's language). */
export const SPELLINGS: Record<SpellingId, { word: string; label: string; hint: string }> = {
  di: { word: '底', label: ttm('底 for 的'), hint: ttm('我底书 reads wǒ de shū') },
  na: { word: '那', label: ttm('那 for 哪 in questions'), hint: ttm('那里去？ reads nǎlǐ qù') },
};

export interface BookSpellings {
  /** The switches that apply now: the reader's choice, else what the book was found to do. */
  current(): OldSpellings;
  /** The lexicon carrying them (withOldSpellings). */
  dress(lex: Lexicon): Lexicon;
  /** Finds what the book does, once per book and detector version. Resolves true when that changed what applies. */
  detect(): Promise<boolean>;
  /** The Corrections tab's switches: one for each spelling the book shows or the reader chose. */
  switches(): SpellingSwitch[];
  /** The spellings to ask the reader about once: found for sure, no choice yet. */
  ask(): SpellingId[];
  /** Keep the reader's choice for these spellings. */
  choose(ids: SpellingId[], on: boolean): Promise<void>;
}

/** The paragraphs and quotes of each chapter, one string per chapter (what detection reads, as lexicon.ts gives detectTerms). */
async function chapterTexts(ctx: AppContext, book: BookMeta): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < book.chapterCount; i++) {
    const c = await ctx.store.books.chapter(book.id, i);
    out.push((c?.blocks ?? []).flatMap((b) => ((b.t === 'p' || b.t === 'quote') && b.text ? [b.text] : [])).join('\n'));
  }
  return out;
}

export function createBookSpellings(ctx: AppContext, book: BookMeta, fixes: BookFixes): BookSpellings {
  let report: OldSpellingReport | undefined = book.oldSpellings?.v === OLD_SPELLINGS_VERSION ? book.oldSpellings : undefined;
  /** The reader's choice, from the book's spelling fixes. */
  const choice = (): Partial<OldSpellings> => {
    const out: Partial<OldSpellings> = {};
    for (const f of fixes.fixes()) {
      if (f.kind !== 'spelling' || f.book === '*') continue;
      for (const id of SPELLING_IDS) if (SPELLINGS[id].word === f.word) out[id] = f.on;
    }
    return out;
  };
  const current = () => chooseOldSpellings(report, choice());
  const choose = async (ids: SpellingId[], on: boolean) => {
    await ctx.store.fixes.put(ids.map((id) => makeFix({ book: fixes.book.key, bookId: fixes.book.id, kind: 'spelling', word: SPELLINGS[id].word, on })));
  };
  return {
    current,
    dress: (lex) => withOldSpellings(lex, current()),
    async detect() {
      if (report) return false;
      const was = current();
      const found = detectOldSpellings(await chapterTexts(ctx, book));
      report = found;
      const kept = { v: OLD_SPELLINGS_VERSION, ...found };
      try { await ctx.store.books.update(book.id, { oldSpellings: kept }); book.oldSpellings = kept; } catch (e) { console.error('Could not keep the old spellings found', e); }
      const now = current();
      return was.di !== now.di || was.na !== now.na;
    },
    switches() {
      const c = choice();
      const on = current();
      return SPELLING_IDS.filter((id) => c[id] !== undefined || (report && (report[id].hits > 0 || report[id].sure))).map((id) => ({
        id, label: tt(SPELLINGS[id].label), hint: tt(SPELLINGS[id].hint), on: on[id], set: (v: boolean) => choose([id], v),
      }));
    },
    ask() {
      const c = choice();
      return SPELLING_IDS.filter((id) => report?.[id].sure && c[id] === undefined);
    },
    choose,
  };
}

/**
 * The banner's question for the spellings found: "This book writes 底 for 的 and 那 for 哪, as many older books do." (The old novels,
 * 红楼梦 水浒 西游记, are the books that write 那 for 哪 most: not only the 1920s.)
 */
export function askText(ids: SpellingId[]): string {
  // Each case whole, so a language can say it its own way (ask() gives them in SPELLING_IDS order).
  const di = ids.includes('di');
  const na = ids.includes('na');
  if (di && na) return tt('This book writes 底 for 的 and 那 for 哪, as many older books do. Read them that way?');
  return di ? tt('This book writes 底 for 的, as many older books do. Read it that way?')
    : tt('This book writes 那 for 哪, as many older books do. Read it that way?');
}
