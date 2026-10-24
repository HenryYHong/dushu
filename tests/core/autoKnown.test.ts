import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AUTO_KNOWN_DAYS, AUTO_KNOWN_HELP, AUTO_KNOWN_PAGES, MIN_DWELL_MS, createAutoKnown, localDay, readingDwell, type AutoKnown, type ReadView,
} from '../../src/core/autoKnown';
import { newSrs } from '../../src/core/srs';
import { openStore } from '../../src/store';
import type { Store } from '../../src/types';

let n = 0;
const dbName = () => `ak-${++n}-${Math.random().toString(36).slice(2)}`;
const DAY = 86_400_000;
/** Noon local time on some day, so adding hours never crosses midnight by surprise. */
const NOON = new Date(2026, 9, 14, 12).getTime();

let store: Store;
let t: number;
let enabled: boolean;
let ak: AutoKnown;
const toSimp = (w: string) => w.replace('書', '书');

beforeEach(async () => {
  store = await openStore(dbName());
  t = NOON;
  enabled = true;
  ak = createAutoKnown({ store, enabled: () => enabled, simplify: toSimp, now: () => t });
});

/** A page with these words at reading place `top`; `page` makes each occurrence new (a different page of the book). */
function view(top: number, words: string[], page = top, needMs = MIN_DWELL_MS): ReadView {
  return {
    top,
    units: [{ key: `u${page}`, needMs, words: () => words.map((word, i) => ({ id: `${page}:${i}`, word })) }],
  };
}

/** Keep `v` on screen for `ms`, ticking once a second. */
function stay(v: ReadView | null, ms: number): void {
  for (let left = ms; left >= 0; left -= 1000) {
    ak.tick(v);
    if (left > 0) t += Math.min(1000, left);
  }
}

/** Read `pages` pages in a row, all with `words`, starting at reading place `from`. */
function readPages(words: string[], pages: number, from = 0): number {
  for (let i = 0; i < pages; i++) stay(view(from + i, words, from + i), MIN_DWELL_MS + 1000);
  return from + pages;
}
const rowOf = async (w: string) => (await store.seen.get([w]))[0];

describe('what the help says', () => {
  // The pinyin modes are All, Unknown, HSK and Off; known words lose their pinyin in Unknown and HSK (render.ts pinyinVisible).
  it('names the pinyin modes that hide a known word\'s pinyin, and no mode that does not exist', () => {
    expect(AUTO_KNOWN_HELP).toMatch(/in the Unknown and HSK pinyin modes/);
    const vocab = readFileSync(join(__dirname, '..', '..', 'src', 'ui', 'vocab', 'vocab.ts'), 'utf8');
    expect(vocab).not.toMatch(/unknown words only/i);
    expect(vocab.match(/in the Unknown and HSK pinyin modes/g)).toHaveLength(2);
  });
});

describe('the rule', () => {
  it('needs a few seconds on screen, and longer for more text', () => {
    expect(readingDwell(10)).toBe(MIN_DWELL_MS);
    expect(readingDwell(600)).toBe(600 * 40);
  });

  it('counts a page that stayed up long enough, once per occurrence', async () => {
    stay(view(0, ['山', '水', '山']), MIN_DWELL_MS);
    await ak.idle();
    expect(await rowOf('山')).toEqual({ word: '山', n: 1, days: 1, lastDay: localDay(t) });
    expect((await rowOf('水'))?.n).toBe(1);
    // Staying longer on the same page adds nothing.
    stay(view(0, ['山', '水', '山']), 10_000);
    await ak.idle();
    expect((await rowOf('山'))?.n).toBe(1);
  });

  it('does not count a page flipped past quickly', async () => {
    for (let i = 0; i < 20; i++) stay(view(i, ['山'], i), 1500);
    await ak.idle();
    expect(await rowOf('山')).toBeUndefined();
  });

  it('does not count going back, and starts counting again once back where the reader was', async () => {
    stay(view(5, ['山'], 5), MIN_DWELL_MS);
    stay(view(4, ['水'], 4), 10_000); // went back a page
    await ak.idle();
    expect(await rowOf('水')).toBeUndefined();
    stay(view(6, ['火'], 6), MIN_DWELL_MS);
    await ak.idle();
    expect((await rowOf('火'))?.n).toBe(1);
  });

  it('a new chapter opened from the contents counts again from there', async () => {
    stay(view(9, ['山'], 9), MIN_DWELL_MS);
    ak.restart();
    stay(view(1, ['水'], 1), MIN_DWELL_MS);
    await ak.idle();
    expect((await rowOf('水'))?.n).toBe(1);
  });

  it('a long page needs its reading time', async () => {
    stay(view(0, ['山'], 0, 20_000), 10_000);
    await ak.idle();
    expect(await rowOf('山')).toBeUndefined();
    stay(view(0, ['山'], 0, 20_000), 11_000);
    await ak.idle();
    expect((await rowOf('山'))?.n).toBe(1);
  });

  it('a hidden page keeps its time but adds none while hidden', async () => {
    stay(view(0, ['山']), 2000);
    stay(null, 60_000);
    stay(view(0, ['山']), 0);
    await ak.idle();
    expect(await rowOf('山')).toBeUndefined();
    stay(view(0, ['山']), 1000);
    await ak.idle();
    expect((await rowOf('山'))?.n).toBe(1);
  });

  it(`marks a word known after ${AUTO_KNOWN_PAGES} pages over ${AUTO_KNOWN_DAYS} days, and only then`, async () => {
    const at = readPages(['山'], AUTO_KNOWN_PAGES + 5);
    await ak.idle();
    // Fifteen pages in one day: not yet.
    expect(store.known.has('山')).toBe(false);
    expect((await rowOf('山'))?.days).toBe(1);
    t += DAY;
    readPages(['山'], 1, at);
    await ak.idle();
    expect(store.known.has('山')).toBe(true);
    expect(store.known.isAuto('山')).toBe(true);
    expect(await rowOf('山')).toBeUndefined();
  });

  it('counts both scripts as one word, in the simplified form', async () => {
    stay(view(0, ['書']), MIN_DWELL_MS);
    stay(view(1, ['书'], 1), MIN_DWELL_MS);
    await ak.idle();
    expect((await rowOf('书'))?.n).toBe(2);
    expect(await rowOf('書')).toBeUndefined();
  });

  it('leaves out words already known and words saved for review', async () => {
    await store.known.add(['山']);
    await store.vocab.put({ id: '水', simp: '水', trad: '水', pinyin: 'shui3', gloss: 'water', addedAt: 1, srs: newSrs(1) });
    stay(view(0, ['山', '水', '火']), MIN_DWELL_MS);
    await ak.idle();
    expect(await rowOf('山')).toBeUndefined();
    expect(await rowOf('水')).toBeUndefined();
    expect((await rowOf('火'))?.n).toBe(1);
  });

  it('a word looked up while its page is up does not count for that page, and loses its count', async () => {
    readPages(['山'], 3);
    await ak.idle();
    expect((await rowOf('山'))?.n).toBe(3);
    stay(view(10, ['山', '水'], 10), 1000);
    ak.lookedUp('山');
    stay(view(10, ['山', '水'], 10), MIN_DWELL_MS);
    await ak.idle();
    expect(await rowOf('山')).toBeUndefined();
    expect((await rowOf('水'))?.n).toBe(1);
  });

  it('a lookup made as the page appeared (before the first look at the screen) still keeps the word from counting', async () => {
    t -= 500;
    ak.lookedUp('山');
    t += 500;
    stay(view(0, ['山', '水']), MIN_DWELL_MS);
    await ak.idle();
    expect(await rowOf('山')).toBeUndefined();
    expect((await rowOf('水'))?.n).toBe(1);
  });

  it('looking up a learned word takes it off the known list; one marked by hand stays', async () => {
    await store.known.add(['山'], { auto: true });
    await store.known.add(['水']);
    ak.lookedUp('山');
    ak.lookedUp('水');
    await ak.idle();
    expect(store.known.has('山')).toBe(false);
    expect(store.known.has('水')).toBe(true);
  });

  it('a hover popup keeps the word from counting on that page but does not take it off', async () => {
    await store.known.add(['山'], { auto: true });
    stay(view(0, ['水']), 1000);
    ak.lookedUp('水', false);
    ak.lookedUp('山', false);
    stay(view(0, ['水']), MIN_DWELL_MS);
    await ak.idle();
    expect(await rowOf('水')).toBeUndefined();
    expect(store.known.has('山')).toBe(true);
  });

  it('words read with a translation do not count for the page on show', async () => {
    stay(view(0, ['山', '水']), 1000);
    ak.helped(['山']);
    stay(view(0, ['山', '水']), MIN_DWELL_MS);
    await ak.idle();
    expect(await rowOf('山')).toBeUndefined();
    expect((await rowOf('水'))?.n).toBe(1);
  });

  it('writes once per page, not once per word', async () => {
    const put = vi.spyOn(store.seen, 'put');
    stay(view(0, ['山', '水', '火', '木', '金']), MIN_DWELL_MS);
    await ak.idle();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toHaveLength(5);
  });

  it('does nothing while the setting is off', async () => {
    enabled = false;
    await store.known.add(['山'], { auto: true });
    readPages(['水'], 3);
    ak.lookedUp('山');
    await ak.idle();
    expect(await rowOf('水')).toBeUndefined();
    expect(store.known.has('山')).toBe(true);
  });

  it('a failing write is reported, not thrown, and later pages still count', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(store.seen, 'put').mockRejectedValueOnce(new Error('full'));
    stay(view(0, ['山']), MIN_DWELL_MS);
    await ak.idle();
    expect(warn).toHaveBeenCalled();
    stay(view(1, ['山'], 1), MIN_DWELL_MS);
    await ak.idle();
    expect((await rowOf('山'))?.n).toBe(1);
    warn.mockRestore();
  });
});
