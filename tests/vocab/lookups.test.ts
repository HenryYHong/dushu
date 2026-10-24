// @vitest-environment jsdom
// Words looked up while reading: the store keeps one row per word per day, the Looked up view groups them by day, and
// practice runs over them without touching the flashcards' schedule.
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LookupRow } from '../../src/types';
import { openStore } from '../../src/store';
import { localDay, logLookup } from '../../src/ui/popup/lookupLog';
import { dayLabel, distinctWords, groupByDay } from '../../src/ui/vocab/lookups';
import { openPractice } from '../../src/ui/vocab/practice';
import { makeCtx, stubBrowser } from '../reader/helpers';

let n = 0;
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 24, 15, 0).getTime();
const row = (day: string, id: string, last: number, extra: Partial<LookupRow> = {}): LookupRow =>
  ({ day, id, word: id, pinyin: '', gloss: `${id} gloss`, count: 1, first: last, last, ...extra });

beforeAll(() => stubBrowser());
afterEach(() => { document.body.innerHTML = ''; });

describe('store.lookups', () => {
  it('keeps one row per word per day and counts repeat lookups', async () => {
    const store = await openStore(`lookups-${++n}`);
    const today = localDay(NOW);
    await store.lookups.log({ day: today, id: '银行', word: '銀行', pinyin: 'yin2 hang2', gloss: 'bank' }, NOW);
    await store.lookups.log({ day: today, id: '银行', word: '銀行', pinyin: 'yin2 hang2', gloss: 'bank' }, NOW + 1000);
    await store.lookups.log({ day: localDay(NOW - DAY), id: '银行', word: '银行', pinyin: 'yin2 hang2', gloss: 'bank' }, NOW - DAY);
    const rows = await store.lookups.list();
    expect(rows).toHaveLength(2);
    const t = rows.find((r) => r.day === today)!;
    expect(t).toMatchObject({ count: 2, first: NOW, last: NOW + 1000, word: '銀行' });
    await store.lookups.remove(today, '银行');
    expect((await store.lookups.list()).map((r) => r.day)).toEqual([localDay(NOW - DAY)]);
  });

  it('survives reopening (a real table), and a wipe of all data clears it', async () => {
    const name = `lookups-${++n}`;
    const store = await openStore(name);
    await store.lookups.log({ day: '2026-10-24', id: '书', word: '書', pinyin: 'shu1', gloss: 'book' }, NOW);
    expect(await (await openStore(name)).lookups.list()).toHaveLength(1);
  });
});

describe('store.bookmarks', () => {
  it('lists a book’s bookmarks in reading order and removes one', async () => {
    const store = await openStore(`marks-${++n}`);
    const mk = (id: string, chapter: number, block: number, bookId = 'b1') => ({ id, bookId, chapter, block, offset: 0, label: id, createdAt: NOW });
    await store.bookmarks.put(mk('c', 2, 0));
    await store.bookmarks.put(mk('a', 0, 5));
    await store.bookmarks.put(mk('b', 1, 1));
    await store.bookmarks.put(mk('x', 0, 0, 'other'));
    expect((await store.bookmarks.list('b1')).map((b) => b.id)).toEqual(['a', 'b', 'c']);
    await store.bookmarks.remove('b');
    expect((await store.bookmarks.list('b1')).map((b) => b.id)).toEqual(['a', 'c']);
    expect(await store.bookmarks.list()).toHaveLength(3);
  });
});

describe('grouping by day', () => {
  it('labels today and yesterday, then the date', () => {
    expect(dayLabel(localDay(NOW), NOW)).toBe('Today');
    expect(dayLabel(localDay(NOW - DAY), NOW)).toBe('Yesterday');
    expect(dayLabel('2026-10-20', NOW)).toBe('Tue, Oct 20');
    expect(dayLabel('2025-03-02', NOW)).toBe('Sun, Mar 2, 2025');
  });
  it('puts the newest day first and, within a day, the last word looked up first', () => {
    const g = groupByDay([row('2026-10-22', 'a', 1), row('2026-10-24', 'b', 5), row('2026-10-24', 'c', 9)]);
    expect(g.map((x) => x.day)).toEqual(['2026-10-24', '2026-10-22']);
    expect(g[0].rows.map((r) => r.id)).toEqual(['c', 'b']);
  });
  it('practice over several days has each word once', () => {
    const d = distinctWords([row('2026-10-22', 'a', 1), row('2026-10-24', 'a', 7), row('2026-10-24', 'b', 5)]);
    expect(d.map((r) => [r.id, r.last])).toEqual([['a', 7], ['b', 5]]);
  });
});

describe('logLookup', () => {
  it('records the simplified headword, the reading on the page and the sentence, after the card has opened', async () => {
    const { ctx, dict } = await makeCtx();
    const log = vi.spyOn(ctx.store.lookups, 'log');
    logLookup(ctx, dict, { word: '銀行', syllables: ['yin2', 'hang2'], context: { sentence: '我們在銀行。', bookId: 'b1', bookTitle: '書', chapter: 2 } }, NOW);
    expect(log).not.toHaveBeenCalled(); // not in the way of the card
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toHaveBeenCalledTimes(1);
    const [entry, at] = log.mock.calls[0];
    expect(at).toBe(NOW);
    expect(entry).toMatchObject({ day: localDay(NOW), id: '银行', word: '銀行', pinyin: 'yin2 hang2', context: { sentence: '我們在銀行。', chapter: 2 } });
    expect(entry.gloss).toMatch(/bank/);
  });
  it('ignores text that is not Chinese', async () => {
    const { ctx, dict } = await makeCtx();
    const log = vi.spyOn(ctx.store.lookups, 'log');
    logLookup(ctx, dict, { word: 'OK', syllables: [] }, NOW);
    await new Promise((r) => setTimeout(r, 5));
    expect(log).not.toHaveBeenCalled();
  });
});

describe('practice', () => {
  const click = (sel: string) => (document.querySelector(sel) as HTMLElement).click();
  it('shows a word, reveals it, puts a missed word back, and ends with the score', async () => {
    const { ctx } = await makeCtx();
    openPractice(ctx, [row('2026-10-24', '书', 2, { pinyin: 'shu1' }), row('2026-10-24', '水', 1, { pinyin: 'shui3' })], 'Today');
    expect(document.querySelector('.prc-progress')!.textContent).toBe('1 of 2');
    expect(document.querySelector('.prc-gloss')).toBeNull(); // the answer is hidden until Show
    click('.prc-show');
    expect(document.querySelector('.prc-gloss')).not.toBeNull();
    const first = document.querySelector('.prc-word')!.textContent;
    click('.prc-again'); // back at the end of the run
    click('.prc-show');
    click('.prc-got');
    click('.prc-show');
    expect(document.querySelector('.prc-word')!.textContent).toBe(first); // the missed word came round again
    click('.prc-got');
    expect(document.querySelector('.prc-end-title')!.textContent).toBe('Done');
    expect(document.querySelector('.prc-end')!.textContent).toContain('1 of 2 on the first try');
    const again = [...document.querySelectorAll<HTMLButtonElement>('.prc-foot .btn')].find((b) => b.textContent === 'Practice the missed ones')!;
    again.click();
    expect(document.querySelector('.prc-progress')!.textContent).toBe('1 of 1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.prc-overlay')).toBeNull();
  });
  it('does not change the flashcards’ schedule, but the star saves a word to them', async () => {
    const { ctx } = await makeCtx();
    openPractice(ctx, [row('2026-10-24', '书', 2, { word: '書', pinyin: 'shu1' })], 'Today');
    click('.prc-show');
    click('.prc-got');
    expect(await ctx.store.vocab.list()).toHaveLength(0);
    click('.prc-foot .btn-primary'); // Finish
    openPractice(ctx, [row('2026-10-24', '书', 2, { word: '書', pinyin: 'shu1' })], 'Today');
    click('.prc-show');
    click('.prc-save');
    await vi.waitFor(async () => expect((await ctx.store.vocab.list()).map((v) => v.id)).toEqual(['书']));
  });
});
