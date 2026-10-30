// Every spaced language on a few thousand words of a real book (fixtures/): the tokens cover the text exactly, the
// dictionary reads nearly every word, and segmenting stays fast. Floors sit a little under what the data reads today, so a
// rebuild that loses words (a broken rule file, a stale fold) fails here before a reader sees it.
import { describe, expect, it } from 'vitest';
import { measure, PERF_SLACK } from '../../helpers/perf';
import { expectCovers, fixture, loadLang } from './load';

type Id = 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ru';

/** found: share of word tokens with a dictionary entry, at least; unknown: share neither found nor a name, at most. */
// Dom Casmurro is in the spelling of 1899 (elle, theatro, commigo), which the dictionary only partly knows.
const BOOKS: { id: Id; book: string; found: number; unknown: number }[] = [
  { id: 'es', book: 'es-quijote', found: 0.97, unknown: 0.015 },
  { id: 'fr', book: 'fr-miserables', found: 0.97, unknown: 0.01 },
  { id: 'de', book: 'de-verwandlung', found: 0.97, unknown: 0.02 },
  { id: 'it', book: 'it-pinocchio', found: 0.97, unknown: 0.025 },
  { id: 'pt', book: 'pt-casmurro', found: 0.94, unknown: 0.02 },
  { id: 'ru', book: 'ru-kashtanka', found: 0.945, unknown: 0.03 },
];

/** CPU budget for segmenting 10,000 characters of the book, warm (a laptop takes 4 to 15 ms). */
const SEGMENT_10K_MS = 60;

describe.each(BOOKS)('$id on $book', ({ id, book, found, unknown }) => {
  it('covers every paragraph exactly and finds nearly every word in the dictionary', async () => {
    const eng = await loadLang(id);
    let words = 0;
    let inDict = 0;
    let names = 0;
    const misses = new Map<string, number>();
    for (const p of await fixture(book)) {
      const toks = eng.segment(p);
      expectCovers(toks, p);
      for (const t of toks) {
        if (t.kind !== 'word') continue;
        words++;
        expect(t.key, t.text).toBeTruthy();
        expect(t.lemma, t.text).toBeTruthy();
        if (t.inDict) inDict++;
        else if (t.name) names++;
        else misses.set(t.text, (misses.get(t.text) ?? 0) + 1);
      }
    }
    const share = (n: number) => n / words;
    const top = [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => `${w}×${n}`).join(' ');
    console.log(`${id} ${book}: ${words} words, ${(100 * share(inDict)).toFixed(1)}% found, ${(100 * share(names)).toFixed(1)}% names, `
      + `${(100 * share(words - inDict - names)).toFixed(1)}% unknown (${top})`);
    expect(words).toBeGreaterThan(3000);
    expect(share(inDict)).toBeGreaterThanOrEqual(found);
    expect(share(words - inDict - names)).toBeLessThanOrEqual(unknown);
  }, 60000);

  it('segments 10,000 characters of the book quickly', async () => {
    const eng = await loadLang(id);
    const text = (await fixture(book)).join('\n\n').slice(0, 10000);
    expect(text.length).toBe(10000);
    // The words were met above, so this times the reading of a page (context, names, stress), not the first lookups.
    eng.segment(text.slice(0, 1500)); // warm up the JIT
    const runs = [0, 1, 2].map(() => measure(() => eng.segment(text)));
    const best = Math.min(...runs.map((r) => r.cpu));
    console.log(`${id} segment 10,000 chars: ${best.toFixed(0)} ms cpu (${runs.map((r) => r.wall.toFixed(0)).join(', ')} ms wall)`);
    expect(best).toBeLessThan(SEGMENT_10K_MS * PERF_SLACK);
  }, 60000);
});
