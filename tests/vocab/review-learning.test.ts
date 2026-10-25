// @vitest-environment jsdom
// Review includes the words being learned: words looked up while reading that are not saved or known come up as new cards, the
// newest first and at most a session's worth, and grading one saves it with its schedule. Saved words that are due come too.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '../../src/store';
import { createSettingsStore } from '../../src/store/settings';
import { mount as mountReview } from '../../src/ui/review/review';
import { NEW_PER_SESSION, reviewCount, wordsToLearn } from '../../src/ui/review/learning';
import type { AppContext, LookupRow } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { item } from './helpers';

vi.mock('../../src/ui/popup/popup', () => ({ openWordPopup: vi.fn() }));

const tick = () => new Promise((r) => setTimeout(r, 30));
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const row = (id: string, last: number, day = '2026-10-24'): LookupRow => ({ day, id, word: id, pinyin: '', gloss: '', count: 1, first: last, last });

async function setup() {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  const store = await openStore('t' + Math.random());
  const dict = await loadTestDictionary();
  const ctx: AppContext = {
    dict: () => Promise.resolve(dict), dictSync: () => dict,
    settings: createSettingsStore(), store, navigate: () => {}, toast: () => {},
  };
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  return { store, ctx, root };
}

beforeEach(() => { localStorage.clear(); });

describe('the words being learned', () => {
  it('are the looked-up words not saved or known, one per word, newest first', () => {
    const rows = [row('银行', 100, '2026-10-23'), row('银行', 300), row('喜欢', 200), row('你好', 400), row('学校', 50)];
    const saved = (w: string) => w === '你好';
    const known = (w: string) => w === '学校';
    expect(wordsToLearn(rows, saved, known).map((r) => [r.id, r.last])).toEqual([['银行', 300], ['喜欢', 200]]);
  });

  it('come up in Review as new cards, and grading one saves it with its schedule', async () => {
    const { store, ctx, root } = await setup();
    await store.lookups.log({ day: '2026-10-24', id: '银行', word: '银行', pinyin: 'yin2 hang2', gloss: 'bank', context: { sentence: '他去银行了。' } }, 1000);
    await store.lookups.log({ day: '2026-10-24', id: '喜欢', word: '喜欢', pinyin: 'xi3 huan1', gloss: 'to like' }, 2000);
    await store.known.add(['喜欢']);
    expect(await reviewCount(store)).toBe(1);
    const cleanup = await mountReview(root, {}, ctx) as () => void;
    await tick();
    expect(root.querySelector('.rev-word')?.textContent).toBe('银行');
    expect(root.querySelector('.rev-counter')!.textContent).toContain('0 of 1');
    expect(store.vocab.has('银行')).toBe(false); // not saved until it is graded
    key(' '); key('4'); await tick(); await tick();
    expect(root.querySelector('.rev-summary-title')?.textContent).toBe('Session complete');
    const saved = (await store.vocab.list()).find((v) => v.id === '银行')!;
    expect(saved).toMatchObject({ simp: '银行', context: { sentence: '他去银行了。' } });
    expect(saved.srs.due).toBeGreaterThan(Date.now() + 86_400_000); // Easy: days away
    expect((await store.vocab.logs()).map((l) => l.itemId)).toEqual(['银行']);
    expect(await reviewCount(store)).toBe(0);
    cleanup();
  });

  it('come after the saved words that are due, a session’s worth at a time', async () => {
    const { store, ctx, root } = await setup();
    const now = Date.now();
    const old = item('爱', 'ai4', 'to love');
    await store.vocab.put({ ...old, addedAt: now - 1000, srs: { ...old.srs, due: now - 1000 } });
    const words = '一二三四五六七八九十天地人山水火木金土日月星风雨'.split('');
    for (let i = 0; i < words.length; i++) await store.lookups.log({ day: '2026-10-24', id: words[i], word: words[i], pinyin: '', gloss: '' }, 1000 + i);
    expect(await reviewCount(store)).toBe(1 + NEW_PER_SESSION);
    const cleanup = await mountReview(root, {}, ctx) as () => void;
    await tick();
    expect(root.querySelector('.rev-word')?.textContent).toBe('爱');
    expect(root.querySelector('.rev-counter')!.textContent).toContain(`0 of ${1 + NEW_PER_SESSION}`);
    cleanup();
  });

  it('do not stop Review when the dictionary cannot load: the saved words due are reviewed alone', async () => {
    const { store, ctx, root } = await setup();
    ctx.dict = () => Promise.reject(new Error('offline'));
    const now = Date.now();
    const old = item('爱', 'ai4', 'to love');
    await store.vocab.put({ ...old, addedAt: now - 1000, srs: { ...old.srs, due: now - 1000 } });
    await store.lookups.log({ day: '2026-10-24', id: '银行', word: '银行', pinyin: '', gloss: '' }, 1000);
    const cleanup = await mountReview(root, {}, ctx) as () => void;
    await tick();
    expect(root.querySelector('.rev-counter')!.textContent).toContain('0 of 1');
    cleanup();
  });
});
