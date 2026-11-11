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
import { miniDict } from '../helpers/mini';

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
  // Anki's four buttons, with their times; the simple pair has its own test below.
  ctx.settings.set({ reviewButtons: 'detailed' });
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  return { store, ctx, root, toasts };
}

beforeEach(() => { localStorage.clear(); });

describe('review screen', () => {
  it('simple buttons: Forgot and Got it, no times; 1 forgets, 2 (or Anki’s 3) remembers', async () => {
    const { ctx, root } = await setup([item('你好', 'ni3 hao3', 'hello'), item('爱', 'ai4', 'to love')]);
    ctx.settings.set({ reviewButtons: 'simple' });
    const cleanup = await mountReview(root, {}, ctx) as () => void;
    try {
      await tick();
      const first = root.querySelector('.rev-word')!.textContent;
      key(' ');
      expect([...root.querySelectorAll('.rev-grade-label')].map((e) => e.textContent)).toEqual(['Forgot', 'Got it']);
      expect(root.querySelectorAll('.rev-grade-iv').length).toBe(0);
      // Got it is Anki's Good: a new card moves on (and comes back once more later in the session, as Good does).
      key('3'); await tick();
      expect(root.querySelector<HTMLElement>('.rev-back')!.hidden).toBe(true);
      expect(root.querySelector('.rev-word')!.textContent).not.toBe(first);
      key(' ');
      key('1'); await tick();
      expect(root.querySelector<HTMLElement>('.rev-back')!.hidden).toBe(true);
    } finally { cleanup(); }
  });

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
    // Above the list of saved words (both sit in the Saved tab).
    const list = root.querySelector('.voc-saved .voc-list')!;
    expect(panel.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('marks the HSK words up to a level as known: each at its easiest reading, the list\'s 儿 words without 儿 too', async () => {
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
    proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    const { ctx, root, store } = await setup([item('爱', 'ai4', 'to love')]);
    const dict = await miniDict({ hsk: [
      ['行', '行', '1', '4', '272', 'xing2=1;hang2=3', '', ''],
      ['一下', '一下', '1', '', '', 'yi1 xia4=1', '', '一下儿'],
      ['好象', '', '2', '', '', 'hao3 xiang4=2', '', '好像'],
      ['好像', '', '2', '', '', 'hao3 xiang4=2', '', ''],
    ] });
    ctx.dict = () => Promise.resolve(dict);
    await mountVocab(root, {}, ctx);
    await until(() => !!root.querySelector('.voc-row'));
    root.querySelector<HTMLSelectElement>('.voc-level')!.value = '2';
    [...root.querySelectorAll<HTMLButtonElement>('.voc-known-actions button')].find((b) => b.textContent === 'Mark as known')!.click();
    await until(() => !!document.querySelector('dialog.voc-dialog'));
    expect(document.querySelector('.voc-dialog-text')!.textContent).toContain('counts at its easiest reading');
    [...document.querySelectorAll<HTMLButtonElement>('dialog.voc-dialog button')].find((b) => b.textContent === 'Add 3')!.click();
    await until(() => store.known.has('一下'));
    expect(store.known.all().sort()).toEqual(['一下', '好像', '行']);
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

describe('page heads', () => {
  // One h1 per screen: the Chinese name first (lang zh-Hans, hidden from screen readers), then the English title.
  const head = (root: HTMLElement) => {
    const h1 = root.querySelector('h1.page-title')!;
    const zh = h1.querySelector('.page-title-zh')!;
    return { count: root.querySelectorAll('h1').length, zh: zh.textContent, lang: zh.getAttribute('lang'), hidden: zh.getAttribute('aria-hidden'), en: h1.querySelector('.page-title-en')?.textContent };
  };
  it('Vocabulary is 生词', async () => {
    const { ctx, root } = await setup([item('你好', 'ni3 hao3', 'hello')]);
    const cleanup = await mountVocab(root, {}, ctx) as () => void;
    await until(() => !!root.querySelector('.voc-row'));
    expect(head(root)).toEqual({ count: 1, zh: '生词', lang: 'zh-Hans', hidden: 'true', en: 'Vocabulary' });
    cleanup();
  });
  it('Review is 复习 over the empty state and the summary, and a session shows only the card', async () => {
    const empty = await setup([]);
    let cleanup = await mountReview(empty.root, {}, empty.ctx) as () => void;
    await until(() => !!empty.root.querySelector('.rev-empty'));
    expect(head(empty.root)).toEqual({ count: 1, zh: '复习', lang: 'zh-Hans', hidden: 'true', en: 'Review' });
    expect(empty.root.querySelector('.rev-empty-title')?.tagName).toBe('H2');
    cleanup();
    const one = await setup([item('爱', 'ai4', 'to love')]);
    cleanup = await mountReview(one.root, {}, one.ctx) as () => void;
    await until(() => !!one.root.querySelector('.rev-word'));
    expect(one.root.querySelector('.page-head')).toBeNull();
    key(' '); key('4');
    await until(() => !!one.root.querySelector('.rev-summary-title'));
    expect(head(one.root).zh).toBe('复习');
    cleanup();
  });
});

describe('review by keyboard and screen reader', () => {
  it('moves focus to the answer when it is shown, and to the next card after a grade, never to Again', async () => {
    const { ctx, root } = await setup([item('你好', 'ni3 hao3', 'hello'), item('爱', 'ai4', 'to love')]);
    const outside = document.body.appendChild(document.createElement('button'));
    outside.focus();
    const cleanup = await mountReview(root, {}, ctx) as () => void;
    await until(() => !!root.querySelector('.rev-word'));
    // The first card does not take focus from where it was.
    expect(document.activeElement).toBe(outside);
    expect(root.querySelector('h1.rev-sr')!.textContent).toContain('Review');
    expect(root.querySelector('[role="progressbar"]')!.getAttribute('aria-label')).toBe('Review progress');
    expect(root.querySelector('.rev-card')!.getAttribute('aria-label')).toBe('Card 1 of 2');

    // Enter on Show answer (a click): the button hides itself, so focus goes to the answer.
    const reveal = root.querySelector<HTMLButtonElement>('.rev-reveal')!;
    reveal.focus();
    reveal.click();
    expect(reveal.hidden).toBe(true);
    expect(document.activeElement).toBe(root.querySelector('.rev-back'));
    expect(document.activeElement?.classList.contains('rev-grade-again')).toBe(false);
    // A second Enter on the answer grades nothing.
    key('Enter'); await tick();
    expect(root.querySelector('.rev-counter')!.textContent).toContain('0 of 2');

    // Grading from a grade button: the screen is drawn again, and focus lands on the new card.
    // Easy: Good keeps a new card in the session (10 minutes).
    const easy = root.querySelector<HTMLButtonElement>('.rev-grade-easy')!;
    easy.focus();
    easy.click();
    await until(() => root.querySelector('.rev-counter')!.textContent!.includes('1 of 2'));
    const card = root.querySelector<HTMLElement>('.rev-card')!;
    expect(document.activeElement).toBe(card);
    expect(card.getAttribute('aria-label')).toBe('Card 2 of 2');

    // Space from the card shows the answer, and focus follows it there.
    key(' ');
    expect(document.activeElement).toBe(root.querySelector('.rev-back'));
    cleanup();
    outside.remove();
  });

  it('leaves focus alone when it is somewhere else on the page', async () => {
    const { ctx, root } = await setup([item('你好', 'ni3 hao3', 'hello'), item('爱', 'ai4', 'to love')]);
    const cleanup = await mountReview(root, {}, ctx) as () => void;
    await until(() => !!root.querySelector('.rev-word'));
    const outside = document.body.appendChild(document.createElement('input'));
    outside.focus();
    root.querySelector<HTMLButtonElement>('.rev-reveal')!.click();
    expect(document.activeElement).toBe(outside);
    root.querySelector<HTMLButtonElement>('.rev-grade-easy')!.click();
    await until(() => root.querySelector('.rev-counter')!.textContent!.includes('1 of 2'));
    expect(document.activeElement).toBe(outside);
    cleanup();
    outside.remove();
  });
});

describe('the Vocabulary line and the Review button agree', () => {
  it('counts the looked-up words Review adds as new, apart from the saved words due', async () => {
    const { store, ctx, root } = await setup([item('你好', 'ni3 hao3', 'hello'), item('爱', 'ai4', 'to love')]);
    for (const [i, w] of ['山', '水', '火'].entries()) await store.lookups.log({ day: '2026-10-24', id: w, word: w, pinyin: '', gloss: '' }, 1000 + i);
    const cleanup = await mountVocab(root, {}, ctx) as () => void;
    await until(() => !!root.querySelector('.voc-row') && /Review 5/.test(root.querySelector('.voc-head-actions')!.textContent ?? ''));
    expect(root.querySelector('.page-sub')!.textContent).toBe('2 words saved, 2 due. 3 new from words you looked up.');
    cleanup();
  });
});
