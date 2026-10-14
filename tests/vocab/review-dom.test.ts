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
async function until(fn: () => boolean, ms = 2000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
}
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
    await until(() => root.querySelectorAll('.voc-row').length === 1);
    expect((await store.vocab.list()).length).toBe(1);
    cleanup();
  });

  it('shows saved words in the reader script: the headword and the book sentence agree', async () => {
    const dict = { toSimplified: (t: string) => t.replace(/學/g, '学').replace(/習/g, '习'), toTraditional: (t: string) => t.replace(/学/g, '學').replace(/习/g, '習') };
    const w = item('学习', 'xue2 xi2', 'to study', { trad: '學習', context: { sentence: '我學習漢語。', bookTitle: '學校' } });
    const a = await setup([w]);
    a.ctx.dictSync = () => dict as never;
    a.ctx.settings.set({ script: 'simplified' });
    await mountVocab(a.root, {}, a.ctx);
    await until(() => !!a.root.querySelector('.voc-row'));
    expect(a.root.querySelector('.voc-word')!.textContent).toBe('学习');
    expect(a.root.querySelector('.voc-ctx')!.textContent).toContain('我学习');
    expect(a.root.querySelector('.voc-meta')!.textContent).toContain('学校');
    const b = await setup([w]);
    b.ctx.dictSync = () => dict as never;
    b.ctx.settings.set({ script: 'traditional' });
    const stop = await mountReview(b.root, {}, b.ctx) as () => void;
    await until(() => !!b.root.querySelector('.rev-word'));
    expect(b.root.querySelector('.rev-word')!.textContent).toBe('學習');
    expect(b.root.querySelector('.rev-word')!.getAttribute('lang')).toBe('zh-Hant');
    expect(b.root.querySelector('.rev-ctx')!.textContent).toContain('我學習');
    stop();
  });

  it('keeps the known-words panel at the top, closed until opened', async () => {
    const { ctx, root } = await setup([item('爱', 'ai4', 'to love')]);
    await mountVocab(root, {}, ctx);
    await until(() => !!root.querySelector('.voc-row'));
    const panel = root.querySelector<HTMLDetailsElement>('details.voc-known')!;
    expect(panel).toBeTruthy();
    expect(panel.open).toBe(false);
    const page = root.querySelector('.voc-page')!;
    expect([...page.children].indexOf(panel)).toBeLessThan([...page.children].indexOf(root.querySelector('.voc-list')!));
  });

  it('shows how many known words reading marked, and clears only those', async () => {
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
    proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    const { ctx, root, store } = await setup([item('爱', 'ai4', 'to love')]);
    await store.known.add(['你好']);
    await store.known.add(['山', '水'], { auto: true });
    await store.seen.put([{ word: '火', n: 3, days: 1, lastDay: 1 }]);
    await mountVocab(root, {}, ctx);
    await until(() => !!root.querySelector('.voc-row'));
    expect(root.querySelector('.voc-known-learned')!.textContent).toBe('2 words learned from reading.');
    const btn = [...root.querySelectorAll<HTMLButtonElement>('.voc-known-actions button')].find((b) => b.textContent === 'Clear learned words')!;
    btn.click();
    await until(() => !!document.querySelector('dialog.voc-dialog'));
    [...document.querySelectorAll<HTMLButtonElement>('dialog.voc-dialog button')].find((b) => b.textContent === 'Clear learned words')!.click();
    await until(() => store.known.autoCount() === 0);
    expect(store.known.has('你好')).toBe(true);
    expect(store.known.has('山')).toBe(false);
    await until(() => root.querySelector<HTMLElement>('.voc-known-learned')!.hidden);
    expect(await store.seen.get(['火'])).toEqual([]);
  });

  it('the session summary line is short', async () => {
    const { ctx, root } = await setup([item('爱', 'ai4', 'to love')]);
    const stop = await mountReview(root, {}, ctx) as () => void;
    await until(() => !!root.querySelector('.rev-word'));
    key(' '); key('4');
    await until(() => !!root.querySelector('.rev-summary-title'));
    expect(root.querySelector('.rev-summary .muted')!.textContent).toBe('1 card, 1 answer');
    stop();
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
