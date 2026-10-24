// The "You know 82% of its words" line on each library card (core/bookWords.ts does the counting). Books are sampled one
// at a time in the background, the most recently read first, a moment after the library opens; the line stays hidden
// until there is a number, and while no word is marked known (every book would say 0%).
import type { AppContext, BookMeta } from '../../types';
import { buildLexicon } from '../../core/lexicon';
import { cachedSample, keepSample, knownShare, readCache, sampleBook, sampleKey, type BookSample } from '../../core/bookWords';
import { h } from '../dom';

export interface BookShares {
  /** The line for a card (filled now if the book has been sampled, later otherwise). */
  line(b: BookMeta): HTMLElement;
  /** Sample the books that need it, in the background. */
  measure(books: BookMeta[]): void;
  /** Known words changed: every line is worked out again. */
  refresh(): void;
  /** The line's text for a book ('' while there is none), for the card's label. */
  text(bookId: string): string;
  dispose(): void;
}

const TITLE = 'Estimated from six chapters of the book: the share of its words, counted each time they come up, that you have marked known. Names are left out.';

export function createBookShares(ctx: AppContext, opts: { delayMs?: number } = {}): BookShares {
  const store = ctx.store;
  const samples = new Map<string, BookSample>();
  const lines = new Map<string, Set<HTMLElement>>();
  let disposed = false;
  let run = 0;
  let timer = 0;
  /** The samples this device kept, read once. */
  let kept: Record<string, BookSample> | null = null;

  const isKnown = (w: string) => store.known.has(w);

  function text(bookId: string): string {
    // What this device counted last time shows at once; the background pass checks it is still current.
    let s = samples.get(bookId);
    if (!s) {
      kept ??= readCache();
      const k = kept[bookId];
      if (k && Array.isArray(k.words) && typeof k.total === 'number') samples.set(bookId, (s = k));
    }
    if (!s || !store.known.count()) return '';
    const v = knownShare(s, isKnown);
    if (v === null) return '';
    // A few known words in a long book are under 1%, but not none.
    return `You know ${v > 0 && v < 0.01 ? '<1' : Math.floor(v * 100)}% of its words`;
  }

  function fill(el: HTMLElement, bookId: string): void {
    const t = text(bookId);
    // While a book is being counted its line keeps its place, so the cards in a row stay level.
    el.textContent = t || '\u00a0';
    el.hidden = !store.known.count();
    // The card is one link with its own label; the line is part of what it says.
    const link = el.closest<HTMLElement>('[data-label]');
    if (link) link.setAttribute('aria-label', t ? `${link.dataset.label}. ${t}.` : link.dataset.label!);
  }

  function paint(bookId: string): void {
    for (const el of lines.get(bookId) ?? []) {
      if (!el.isConnected) { lines.get(bookId)!.delete(el); continue; }
      fill(el, bookId);
    }
  }

  async function sampleAll(books: BookMeta[], mine: number): Promise<void> {
    let dict;
    try { dict = await ctx.dict(); } catch { return; }
    const order = [...books].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    const ids = books.map((b) => b.id);
    for (const b of order) {
      if (disposed || mine !== run) return;
      let lex;
      try { lex = buildLexicon(await store.lexicon.get(b.id)); } catch { lex = undefined; }
      const key = sampleKey(b, lex);
      const have = samples.get(b.id);
      if (have?.key === key) continue;
      const cached = cachedSample(b.id, key);
      if (cached) { samples.set(b.id, cached); paint(b.id); continue; }
      try {
        const s = await sampleBook(store, dict, b, lex, { cancelled: () => disposed || mine !== run });
        if (disposed || mine !== run) return;
        samples.set(b.id, s);
        keepSample(b.id, s, ids);
        paint(b.id);
      } catch (e) { console.warn('Dushu: could not count the words of', b.title, e); }
    }
  }

  return {
    line(b) {
      const el = h('div.lib-card-known', { title: TITLE, hidden: true });
      let set = lines.get(b.id);
      if (!set) lines.set(b.id, (set = new Set()));
      set.add(el);
      fill(el, b.id);
      return el;
    },
    measure(books) {
      const mine = ++run;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void sampleAll(books, mine), opts.delayMs ?? 1200);
    },
    refresh() { for (const id of lines.keys()) paint(id); },
    text,
    dispose() { disposed = true; window.clearTimeout(timer); lines.clear(); },
  };
}
