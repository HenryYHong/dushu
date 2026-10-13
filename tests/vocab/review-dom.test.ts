// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openStore } from '../../src/store';
import { createSettingsStore } from '../../src/store/settings';
import { mount as mountReview } from '../../src/ui/review/review';
import { mount as mountVocab } from '../../src/ui/vocab/vocab';
import type { AppContext } from '../../src/types';
import { item } from './helpers';

vi.mock('../../src/ui/popup/popup', () => ({ openWordPopup: vi.fn() }));

const tick = () => new Promise((r) => setTimeout(r, 30));
const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

async function setup(words: ReturnType<typeof item>[]) {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  const store = await openStore('t' + Math.random());
  const now = Date.now();
  for (const w of words) await store.vocab.put({ ...w, addedAt: now - 1000, srs: { ...w.srs, due: now - 1000 } });
  const toasts: string[] = [];
  const ctx: AppContext = {
    dict: () => Promise.reject(new Error('no dict')), dictSync: () => null,
    settings: createSettingsStore(), store, navigate: () => {},
    toast: (m) => { toasts.push(m); },
  };
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  return { store, ctx, root, toasts };
}

beforeEach(() => { localStorage.clear(); });

describe('review screen', () => {
  it('keyboard-only: space reveals, 3 grades, summary at the end', async () => {
    const { store, ctx, root } = await setup([item('你好', 'ni3 hao3', 'hello', { context: { sentence: '他说你好。' } }), item('爱', 'ai4', 'to love')]);
    const cleanup = await mountReview(root, {}, ctx) as () => void;
    await tick();
    expect(root.querySelector('.rev-word')).toBeTruthy();
    expect(root.querySelector<HTMLElement>('.rev-back')!.hidden).toBe(true);
    key('2'); await tick(); // ignored before reveal
    expect(root.querySelector('.rev-counter')!.textContent).toContain('0 of 2');
    key(' ');
    expect(root.querySelector<HTMLElement>('.rev-back')!.hidden).toBe(false);
    const labels = [...root.querySelectorAll('.rev-grade-iv')].map((e) => e.textContent);
    expect(labels).toEqual(['1m', '6m', '10m', '4d']);
    key('4'); await tick();
    expect(root.querySelector('.rev-counter')!.textContent).toContain('1 of 2');
    expect(root.querySelector<HTMLElement>('.rev-back')!.hidden).toBe(true);
    key(' '); key('4'); await tick(); await tick();
    expect(root.querySelector('.rev-summary-title')?.textContent).toBe('Session complete');
    expect((await store.vocab.due(Date.now())).length).toBe(0);
    expect((await store.vocab.logs()).length).toBe(2);
    cleanup();
  });

  it('Again brings the card back in the same session', async () => {
    const { ctx, root } = await setup([item('爱', 'ai4', 'to love')]);
    const cleanup = await mountReview(root, {}, ctx) as () => void;
    await tick();
    key(' '); key('1'); await tick();
    expect(root.querySelector('.rev-word')).toBeTruthy();
    expect(root.querySelector('.rev-counter')!.textContent).toContain('0 of 1');
    cleanup();
  });

  it('empty state when nothing exists, and when nothing is due', async () => {
    const a = await setup([]);
    await mountReview(a.root, {}, a.ctx);
    await tick();
    expect(a.root.textContent).toContain('No cards yet');
    const b = await setup([item('爱', 'ai4', 'to love')]);
    const it = (await b.store.vocab.list())[0];
    await b.store.vocab.put({ ...it, srs: { ...it.srs, due: Date.now() + 3 * 3600_000 } });
    await mountReview(b.root, {}, b.ctx);
    await tick();
    expect(b.root.textContent).toContain('Nothing due right now');
    expect(b.root.textContent).toContain('in 3 hours');
  });

  it('keys stop working after cleanup', async () => {
    const { ctx, root } = await setup([item('爱', 'ai4', 'to love')]);
    const cleanup = await mountReview(root, {}, ctx) as () => void;
    await tick();
    cleanup();
    key(' ');
    expect(root.querySelector<HTMLElement>('.rev-back')!.hidden).toBe(true);
  });
});

describe('vocab screen', () => {
  it('lists, searches, removes with undo', async () => {
    const { store, ctx, root } = await setup([item('你好', 'ni3 hao3', 'hello'), item('爱', 'ai4', 'to love')]);
    const cleanup = await mountVocab(root, {}, ctx) as () => void;
    await tick();
    expect(root.querySelectorAll('.voc-row')).toHaveLength(2);
    const input = root.querySelector<HTMLInputElement>('.voc-search-input')!;
    input.value = 'love'; input.dispatchEvent(new Event('input'));
    expect(root.querySelectorAll('.voc-row')).toHaveLength(1);
    input.value = 'zzz'; input.dispatchEvent(new Event('input'));
    expect(root.textContent).toContain('Nothing matches');
    input.value = ''; input.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('.voc-remove')!.click();
    await tick();
    expect((await store.vocab.list()).length).toBe(1);
    expect(root.querySelectorAll('.voc-row')).toHaveLength(1);
    cleanup();
  });

  it('empty state', async () => {
    const { ctx, root } = await setup([]);
    await mountVocab(root, {}, ctx);
    await tick();
    expect(root.textContent).toContain('No saved words yet');
  });

  it('row click opens the word popup; a popup failure becomes a toast', async () => {
    const popup = await import('../../src/ui/popup/popup');
    const { ctx, root, toasts } = await setup([item('爱', 'ai4', 'to love')]);
    await mountVocab(root, {}, ctx);
    await tick();
    root.querySelector<HTMLElement>('.voc-row')!.click();
    expect(popup.openWordPopup).toHaveBeenCalledOnce();
    vi.mocked(popup.openWordPopup).mockImplementationOnce(() => { throw new Error('nope'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    root.querySelector<HTMLElement>('.voc-row')!.click();
    expect(toasts.at(-1)).toContain('Could not open');
  });
});
