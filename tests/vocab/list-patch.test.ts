// @vitest-environment jsdom
// A change of one or a few words patches the Vocabulary lists in place (ui/vocab/patch.ts): a removed word's row is taken out
// and a returning one put in at its place, while every other row stays the very same element. What a patch leaves on screen
// must be exactly what drawing the whole list again would draw, in Saved (every sort, a search) and in Looked up (days and
// all); a keyboard focus on a removed row moves to the row now in its place; and Undo still brings the word back.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '../../src/store';
import { createSettingsStore } from '../../src/store/settings';
import { mount as mountVocab } from '../../src/ui/vocab/vocab';
import { createLookupsView } from '../../src/ui/vocab/lookups';
import { localDay } from '../../src/ui/popup/lookupLog';
import { applyPatch, planPatch } from '../../src/ui/vocab/patch';
import type { AppContext, VocabItem } from '../../src/types';
import { item } from './helpers';
import { makeCtx, stubBrowser } from '../reader/helpers';

vi.mock('../../src/ui/popup/popup', () => ({ openWordPopup: vi.fn() }));

async function until(fn: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 5)); }
}
const tick = () => new Promise((r) => setTimeout(r, 30));
/** The very same elements, in order (toEqual would only compare them as markup). */
const same = (a: Element[], b: Element[]) => a.length === b.length && a.every((x, i) => x === b[i]);

describe('planPatch', () => {
  it('takes out the rows that left and puts in the rows that came, each before the row that follows it', () => {
    expect(planPatch(['a', 'b', 'c'], ['a', 'c'])).toEqual({ out: ['b'], in: [] });
    expect(planPatch(['a', 'c'], ['a', 'b', 'c'])).toEqual({ out: [], in: [{ key: 'b', before: 'c' }] });
    expect(planPatch(['a', 'b'], ['a', 'b', 'c'])).toEqual({ out: [], in: [{ key: 'c', before: null }] });
    // Last first, so the row each goes before is already there.
    expect(planPatch(['b'], ['a', 'b', 'c', 'd'])!.in).toEqual([{ key: 'd', before: null }, { key: 'c', before: 'd' }, { key: 'a', before: 'b' }]);
  });
  it('draws a changed row again at its new place', () => {
    expect(planPatch(['a', 'b', 'c'], ['b', 'a', 'c'], new Set(['a']))).toEqual({ out: ['a'], in: [{ key: 'a', before: 'c' }] });
  });
  it('leaves a big change, or rows that stay in another order, to a full drawing', () => {
    expect(planPatch([...'abcdefghij'], ['a'])).toBeNull();
    expect(planPatch(['a', 'b', 'c'], ['c', 'b', 'a'])).toBeNull();
    expect(planPatch(['a', 'a'], ['a'])).toBeNull();
  });
  it('applies to a list: the same elements stay, the new ones land in order', () => {
    const parent = document.createElement('div');
    const rows = new Map<string, HTMLElement>();
    for (const k of ['a', 'c', 'x']) { const el = document.createElement('p'); el.textContent = k; parent.append(el); rows.set(k, el); }
    const c = rows.get('c');
    applyPatch(parent, planPatch(['a', 'c', 'x'], ['a', 'b', 'c', 'd'])!, rows, (k) => Object.assign(document.createElement('p'), { textContent: k }));
    expect(parent.textContent).toBe('abcd');
    expect(rows.get('c')).toBe(c);
    expect([...rows.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ------------------------------------------------------------------------------------------------------------- Saved ---

const DAY = 86_400_000;
const words = (n: number): VocabItem[] => Array.from({ length: n }, (_, i) => item(`词${i}`, `ci2 ${String.fromCharCode(97 + (i * 7) % 26)}1`, `gloss ${i}`, {
  addedAt: Date.now() - i * 60_000,
  context: { sentence: `他说词${i}在这里。`, bookTitle: i % 2 ? '活着' : '书' },
  srs: { due: Date.now() + ((i * 5) % 9 - 3) * DAY, interval: 3, ease: 2.5, reps: i % 3, lapses: 0, last: i % 3 ? Date.now() - DAY : undefined },
}));

async function savedScreen(list: VocabItem[]) {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  const store = await openStore('patch' + Math.random());
  for (const w of list) await store.vocab.put(w);
  const undo: (() => void)[] = [];
  const ctx: AppContext = {
    dict: () => Promise.reject(new Error('no dict')), dictSync: () => null,
    settings: createSettingsStore(), store, navigate: () => {},
    toast: (_m, opts) => { if (opts?.action) undo.push(opts.action.run); },
  };
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const stop = await mountVocab(root, {}, ctx) as () => void;
  await until(() => root.querySelectorAll('.voc-saved .voc-row').length === list.length);
  const listEl = root.querySelector<HTMLElement>('.voc-saved .voc-list')!;
  const search = root.querySelector<HTMLInputElement>('.voc-search-input')!;
  const sort = root.querySelector<HTMLSelectElement>('.voc-sort')!;
  const rows = () => [...listEl.querySelectorAll<HTMLElement>('.voc-row')];
  const ids = () => rows().map((r) => r.dataset.flip);
  const remove = (id: string) => listEl.querySelector<HTMLElement>(`[data-flip="${id}"] .voc-remove`)!.click();
  /** The list as a full drawing makes it now (a search drawn again with the same words), and whether that drew new rows. */
  const fullDrawing = () => {
    const kept = rows()[0];
    search.dispatchEvent(new Event('input'));
    expect(rows()[0]).not.toBe(kept);
    return listEl.innerHTML;
  };
  const setSort = (v: string) => { sort.value = v; sort.dispatchEvent(new Event('change')); };
  const setQuery = (q: string) => { search.value = q; search.dispatchEvent(new Event('input')); };
  const count = () => root.querySelector('.voc-count')!.textContent;
  return { store, root, listEl, rows, ids, remove, fullDrawing, setSort, setQuery, count, undo, stop };
}

describe('the Saved list, a few words changed', () => {
  beforeEach(() => { localStorage.clear(); });

  it('takes out a removed word’s row and keeps every other row; the result is what a full drawing draws', async () => {
    const s = await savedScreen(words(20));
    const before = s.listEl.innerHTML;
    const rows = s.rows();
    const id = s.ids()[7]!;
    s.remove(id);
    await until(() => s.rows().length === 19);
    // Measurement free: the rows that stayed are the very same elements, so nothing was built again.
    expect(same(s.rows(), rows.filter((r) => r.dataset.flip !== id))).toBe(true);
    expect(s.ids()).not.toContain(id);
    const patched = s.listEl.innerHTML;
    expect(patched).toBe(s.fullDrawing());

    // Undo puts the word back in its place: the list is again exactly the one before.
    expect(s.undo).toHaveLength(1);
    const kept = s.rows();
    s.undo[0]();
    await until(() => s.rows().length === 20);
    expect(s.ids()[7]).toBe(id);
    expect(same(s.rows().filter((r) => r.dataset.flip !== id), kept)).toBe(true);
    expect(s.listEl.innerHTML).toBe(before);
    expect(s.listEl.innerHTML).toBe(s.fullDrawing());
    s.stop();
  });

  it('patches the same in every sort, and under a search with its count', async () => {
    const s = await savedScreen(words(16));
    for (const sort of ['due', 'pinyin', 'added']) {
      s.setSort(sort);
      const n = s.rows().length;
      const rows = s.rows();
      const id = s.ids()[3]!;
      s.remove(id);
      await until(() => s.rows().length === n - 1);
      expect(same(s.rows(), rows.filter((r) => r.dataset.flip !== id))).toBe(true);
      expect(s.listEl.innerHTML).toBe(s.fullDrawing());
    }
    s.setQuery('gloss 1');
    const n = s.rows().length;
    expect(s.count()).toMatch(new RegExp(`^${n} matches of 13$`));
    const rows = s.rows();
    s.remove(s.ids()[0]!);
    await until(() => s.rows().length === n - 1);
    expect(same(s.rows(), rows.slice(1))).toBe(true);
    expect(s.count()).toBe(`${n - 1} matches of 12`);
    const patched = s.listEl.innerHTML;
    expect(patched).toBe(s.fullDrawing());
    s.stop();
  });

  it('puts in a word saved elsewhere at its place, and draws a changed word again', async () => {
    const s = await savedScreen(words(12));
    const rows = s.rows();
    await s.store.vocab.put(item('新词', 'xin1 ci2', 'new word', { addedAt: Date.now() - 4.5 * 60_000, context: { sentence: '新词。', bookTitle: '书' } }));
    await until(() => s.rows().length === 13);
    expect(s.ids()[5]).toBe('新词');
    expect(same(s.rows().filter((r) => r.dataset.flip !== '新词'), rows)).toBe(true);
    expect(s.listEl.innerHTML).toBe(s.fullDrawing());

    const kept = s.rows();
    const old = (await s.store.vocab.get('词2'))!;
    await s.store.vocab.put({ ...old, gloss: 'a better gloss' });
    await until(() => s.listEl.textContent!.includes('a better gloss'));
    const changed = s.rows().find((r) => r.dataset.flip === '词2')!;
    expect(kept).not.toContain(changed);
    expect(same(s.rows().filter((r) => r !== changed), kept.filter((r) => r.dataset.flip !== '词2'))).toBe(true);
    expect(s.listEl.innerHTML).toBe(s.fullDrawing());
    s.stop();
  });

  it('draws in full a change of many words, and the last word gone', async () => {
    const s = await savedScreen(words(14));
    const first = s.rows()[0];
    for (const id of s.ids().slice(0, 10)) await s.store.vocab.remove(id!);
    await until(() => s.rows().length === 4);
    await tick();
    expect(s.rows()).not.toContain(first);
    for (const id of s.ids()) await s.store.vocab.remove(id!);
    await until(() => s.root.textContent!.includes('No saved words yet'));
    s.stop();
  });

  it('moves a keyboard focus on a removed row to the row now in its place', async () => {
    const s = await savedScreen(words(6));
    const ids = s.ids();
    const btn = s.listEl.querySelector<HTMLElement>(`[data-flip="${ids[2]}"] .voc-remove`)!;
    btn.focus();
    btn.click();
    await until(() => s.rows().length === 5);
    expect(document.activeElement).toBe(s.rows()[2]);
    expect((document.activeElement as HTMLElement).dataset.flip).toBe(ids[3]);
    // The last row: focus goes to the row before it.
    const last = s.listEl.querySelector<HTMLElement>(`[data-flip="${ids[5]}"] .voc-remove`)!;
    last.focus();
    last.click();
    await until(() => s.rows().length === 4);
    expect((document.activeElement as HTMLElement).dataset.flip).toBe(ids[4]);
    // A focus somewhere else is left there.
    const search = s.root.querySelector<HTMLInputElement>('.voc-search-input')!;
    search.focus();
    await s.store.vocab.remove(ids[0]!);
    await until(() => s.rows().length === 3);
    expect(document.activeElement).toBe(search);
    s.stop();
  });
});

// --------------------------------------------------------------------------------------------------------- Looked up ---

describe('the Looked up list, a few words changed', () => {
  beforeAll(() => stubBrowser());

  it('takes out a row, a whole day, and puts them back; the result is what a full drawing draws', async () => {
    const { ctx } = await makeCtx();
    const undo: (() => void)[] = [];
    ctx.toast = (_m, opts) => { if (opts?.action) undo.push(opts.action.run); };
    const now = Date.now();
    const days = [localDay(now), localDay(now - DAY), localDay(now - 3 * DAY)];
    const log = (d: number, id: string, at: number) => ctx.store.lookups.log({ day: days[d], id, word: id, pinyin: 'a1', gloss: `${id} gloss`, context: { sentence: `${id}在这里。`, bookTitle: '书' } }, at);
    for (const [i, id] of ['书', '水', '山', '火'].entries()) await log(0, id, now - i * 1000);
    await log(1, '水', now - DAY);
    await log(2, '木', now - 3 * DAY);
    await log(2, '土', now - 3 * DAY - 1000);
    const view = createLookupsView(ctx);
    document.body.replaceChildren(view.el);
    // As the Vocabulary screen does.
    const off = ctx.store.onChange((what) => { if (what === 'lookups') void view.refresh(); });
    await view.refresh();
    const html = () => view.el.innerHTML;
    const rows = () => [...view.el.querySelectorAll<HTMLElement>('.voc-lk-row')];
    const full = () => { view.render(); return html(); };
    const before = html();
    const removeBtn = (key: string) => view.el.querySelector<HTMLElement>(`[data-flip="${key}"] .voc-remove`)!;

    // One word from today.
    let kept = rows().filter((r) => r.dataset.flip !== `${days[0]} 山`);
    removeBtn(`${days[0]} 山`).click();
    await until(() => rows().length === 6);
    expect(same(rows(), kept)).toBe(true);
    expect(view.el.querySelector('.voc-lk-count')!.textContent).toBe('3 words');
    const patched = html();
    expect(patched).toBe(full());

    // The only word of yesterday: the day goes with it.
    kept = rows().filter((r) => r.dataset.flip !== `${days[1]} 水`);
    removeBtn(`${days[1]} 水`).click();
    await until(() => rows().length === 5);
    expect(same(rows(), kept)).toBe(true);
    expect(view.el.querySelectorAll('.voc-lk-day')).toHaveLength(2);
    expect(html()).toBe(full());

    // Undo both: the day comes back in its place, and the list is the one before.
    kept = rows();
    undo.forEach((run) => run());
    await until(() => rows().length === 7);
    await view.refresh();
    expect(same(rows().filter((r) => kept.includes(r)), kept)).toBe(true);
    expect(html()).toBe(before);
    expect(html()).toBe(full());
    off();
  });

  it('turns on a star in place when the word is saved elsewhere, as a full drawing would draw it', async () => {
    const { ctx } = await makeCtx();
    const now = Date.now();
    for (const [i, id] of ['书', '水'].entries()) await ctx.store.lookups.log({ day: localDay(now), id, word: id, pinyin: 'a1', gloss: 'g' }, now - i);
    const view = createLookupsView(ctx);
    document.body.replaceChildren(view.el);
    await view.refresh();
    const rows = [...view.el.querySelectorAll('.voc-lk-row')];
    const star = view.el.querySelector<HTMLElement>(`[data-flip="${localDay(now)} 水"] .voc-lk-save`)!;
    star.focus();
    await ctx.store.vocab.put(item('水', 'shui3', 'water'));
    view.savedChanged();
    expect(same([...view.el.querySelectorAll('.voc-lk-row')], rows)).toBe(true);
    expect(star.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(star);
    const patched = view.el.innerHTML;
    view.render();
    expect(view.el.innerHTML).toBe(patched);
  });
});
