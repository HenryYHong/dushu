// The open book's fixes in the reader (core/fixes.ts, ARCHITECTURE.md §4.12): read from the store (the user's old rows of the book's
// names and terms adopted once), laid over the book's lexicon, lent to the word and phrase cards and the Corrections tab, and
// counted in the book's text ("Everywhere in this book (12 places)").
import type { AppContext, BookMeta, Fix, Lexicon, LexiconEntry, Token } from '../../types';
import { anchorAt, cleanFix, countIn, exportFixes, fixesOfBook, importFixes, makeFix, withFixes } from '../../core/fixes';
import { bookKey, olderKeys } from '../../core/syncKeys';
import { confirmDialog } from '../library/dialogs';
import type { Fixer, FixPiece, FixTarget } from '../popup/fixView';
import type { BlockState, ChapterView } from './chapter';
import type { SpellingSwitch, TocFixes } from './toc';
import { h } from '../dom';
import { tt, ttn } from '../../i18n';

export interface BookFixes extends Fixer {
  /** Reads the book's fixes again (a change here, in another tab, or from another device). */
  load(): Promise<void>;
  /** The book's lexicon with its fixes. */
  dress(lex: Lexicon): Lexicon;
}

export function createBookFixes(ctx: AppContext, book: BookMeta): BookFixes {
  const store = ctx.store;
  const key = bookKey(book);
  const me = { id: book.id, key };
  let list: Fix[] = [];
  let adopted = false;
  let texts: Promise<string[]> | null = null;

  /** Every paragraph, heading and quote of the book, as the book spells them, read once. */
  const bookTexts = (): Promise<string[]> => (texts ??= (async () => {
    const out: string[] = [];
    for (let i = 0; i < book.chapterCount; i++) {
      const c = await store.books.chapter(book.id, i);
      for (const b of c?.blocks ?? []) if ((b.t === 'p' || b.t === 'h' || b.t === 'quote') && b.text) out.push(b.text);
    }
    return out;
  })());

  return {
    book: me,
    async load() {
      if (!adopted) {
        adopted = true;
        try { await store.fixes.adopt(book.id, key); } catch (e) { console.error('Could not adopt the book\'s own words as fixes', e); }
      }
      list = fixesOfBook(await store.fixes.list(), me);
    },
    dress: (lex) => withFixes(lex, list),
    fixes: () => list,
    async places(word) { return countIn(await bookTexts(), word); },
    async save(fix) {
      // (The store keeps only what cleanFix takes: a fix it would drop is said, not toasted as done.)
      if (!cleanFix(fix)) throw new Error(tt('LinguPengu cannot keep that correction.'));
      const was = (await store.fixes.list()).find((f) => f.id === fix.id);
      await store.fixes.put([{ ...fix, t: Math.max(fix.t, (was?.t ?? 0) + 1) }]);
      return was;
    },
    async remove(id) { await store.fixes.remove([id]); },
  };
}

/**
 * The word from `s` to `e` in a rendered block as a card's fix target: as the book spells it, its reading, the Han words touching it
 * and its anchor in the stored book (none for a chapter title the reader added).
 */
export function fixTarget(v: ChapterView, b: BlockState, s: number, e: number, chapter: number): FixTarget | undefined {
  const toks = b.rendered?.tokens;
  if (!toks || b.kind !== 'text') return undefined;
  const aligned = b.source.length === b.text.length;
  const bookOf = (x: number, y: number) => (aligned ? b.source.slice(x, y) : b.text.slice(x, y));
  const piece = (t: Token): FixPiece => ({ word: bookOf(t.start, t.end), shown: t.text, pinyin: t.pinyin ?? [] });
  const i = toks.findIndex((t) => t.start === s && t.end === e);
  // Each character's reading from the token that holds it, also where the selection starts or ends inside a token (店里 in 酒店|里).
  const pinyin: string[] = [];
  let crosses = false;
  if (i >= 0) pinyin.push(...(toks[i].pinyin ?? []));
  else {
    for (const t of toks) {
      if (t.end <= s || t.start >= e || t.kind !== 'han') continue;
      if (t.start < s || t.end > e) crosses = true;
      let off = t.start;
      [...t.text].forEach((ch, k) => { if (off >= s && off < e) pinyin.push(t.pinyin?.[k] ?? ''); off += ch.length; });
    }
  }
  const prev = i > 0 && toks[i - 1].kind === 'han' && toks[i - 1].end === s ? piece(toks[i - 1]) : undefined;
  const next = i >= 0 && toks[i + 1]?.kind === 'han' && toks[i + 1].start === e ? piece(toks[i + 1]) : undefined;
  const stored = b.index >= v.synthetic ? v.toStored(b.index, s) : null;
  const at = stored ? { ...anchorAt(b.source, chapter, stored.block, s, e - s), offset: stored.offset } : undefined;
  return { word: bookOf(s, e), shown: b.text.slice(s, e), pinyin, ...(prev ? { prev } : {}), ...(next ? { next } : {}), ...(at ? { at } : {}), ...(crosses ? { crosses } : {}) };
}

/** A found name or term switched on or off in the Corrections tab: off is a "Not a word" fix of the book, on takes it away. */
export async function toggleFound(fixes: BookFixes, entry: LexiconEntry): Promise<void> {
  const off = fixes.fixes().find((f) => f.kind === 'unword' && f.word === entry.word && !f.at && f.book !== '*');
  if (off) await fixes.remove(off.id);
  else await fixes.save(makeFix({ book: fixes.book.key, bookId: fixes.book.id, kind: 'unword', word: entry.word }));
}

/** The book a corrections file names ({ title, key }), if it says. */
function fileBook(json: string): { title?: string; key?: string } | undefined {
  try {
    const b = (JSON.parse(json) as { book?: unknown }).book;
    if (!b || typeof b !== 'object') return undefined;
    const { title, key } = b as Record<string, unknown>;
    return { ...(typeof title === 'string' ? { title } : {}), ...(typeof key === 'string' ? { key } : {}) };
  } catch { return undefined; }
}

/** The Corrections tab's hooks for the open book. */
export function correctionsTab(ctx: AppContext, fixes: BookFixes, title: string, spellings?: () => SpellingSwitch[]): TocFixes {
  return {
    list: () => fixes.fixes(),
    async toggle(f) { await fixes.save({ ...f, on: !f.on, t: Date.now() }); },
    async remove(f) {
      try { await fixes.remove(f.id); } catch (e) { ctx.toast(e instanceof Error ? e.message : tt('Could not delete that.')); return; }
      ctx.toast(tt('Your correction of {word} is deleted.', { word: f.word }), { ms: 7000, action: { label: tt('Undo'), run: () => { void fixes.save(f).catch(() => {}); } } });
    },
    places: (w) => fixes.places(w),
    async exportFile() {
      // The book's own corrections, and the words joined for all books (marked so in the file; an import makes them all-books again).
      const own = fixes.fixes().filter((f) => f.book !== '*' || (f.kind === 'word' && !f.at));
      if (!own.length) { ctx.toast(tt('This book has no corrections to export yet.')); return; }
      const url = URL.createObjectURL(new Blob([exportFixes(own, { title, key: fixes.book.key })], { type: 'application/json' }));
      const name = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || tt('Book');
      const a = h('a', { href: url, download: `${tt('{title} corrections', { title: name })}.json` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      ctx.toast(ttn(own.length, '{n} correction saved to your downloads.', '{n} corrections saved to your downloads.'));
    },
    async importFile(file) {
      let list: Fix[];
      let json = '';
      try { json = await file.text(); list = importFixes(json, fixes.book); } catch (e) { ctx.toast(e instanceof Error ? e.message : tt('Could not read that file.')); return; }
      // A file made for another book (it names its book) is added only when the reader says so.
      const from = fileBook(json);
      if (list.length && from?.key && from.key !== fixes.book.key && !olderKeys(fixes.book.key).includes(from.key)) {
        const ok = await confirmDialog({
          title: tt('Corrections of another book'),
          message: from.title
            ? tt('This file holds the corrections of “{other}”, not of “{title}”. Add them to this book anyway?', { other: from.title, title })
            : tt('This file holds the corrections of another book, not of “{title}”. Add them to this book anyway?', { title }),
          confirmLabel: tt('Add them'),
        });
        if (!ok) return;
      }
      const have = new Map(fixes.fixes().map((f) => [f.id, f]));
      // One already here stays when it is the newer of the two.
      const take = list.filter((f) => (have.get(f.id)?.t ?? -1) < f.t);
      if (take.length) await ctx.store.fixes.put(take);
      const kept = list.length - take.length;
      const added = take.length;
      ctx.toast(!list.length ? tt('That file has no corrections LinguPengu can use.')
        : !added ? tt('These corrections are already here.')
          : ttn(added, 'Added {n} correction.', 'Added {n} corrections.') + (kept ? ` ${ttn(kept, '{n} was already here.', '{n} were already here.')}` : ''));
    },
    ...(spellings ? { spellings } : {}),
  };
}
