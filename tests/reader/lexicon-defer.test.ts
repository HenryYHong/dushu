// @vitest-environment jsdom
// The names scan of a book's first open finishes while the reader may already have a word card open.
// It must not take the card away or redraw under it: it waits for the card to be closed.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookMeta, Chapter, Lexicon, LexiconEntry } from '../../src/types';
import { closePopup } from '../../src/ui/popup/popup';
import { makeCtx, stubBrowser } from './helpers';

const hooks = vi.hoisted(() => ({ onUpdate: null as null | ((lex: unknown) => void) }));
vi.mock('../../src/core/lexicon', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/lexicon')>();
  return {
    ...real,
    loadLexicon: async (_ctx: unknown, _id: string, onUpdate?: (lex: unknown) => void) => { hooks.onUpdate = onUpdate ?? null; return real.EMPTY_LEXICON; },
    isDetecting: () => true,
  };
});
const { mount } = await import('../../src/ui/reader/reader');
const { buildLexicon } = await import('../../src/core/lexicon');

beforeAll(() => stubBrowser());

const chapters: Chapter[] = [{ title: '第一章', blocks: [{ t: 'p', text: '我们在银行门口见面。' }, { t: 'p', text: '他慢慢地走了过来。' }] }];
const entry = (word: string): LexiconEntry => ({ word, pinyin: 'men2 kou3 jian4', gloss: 'a made-up name', kind: 'name', count: 9, enabled: true, origin: 'auto' });
const wordTexts = () => [...document.querySelectorAll('.rd-p .rd-w')].map((w) => [...w.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join(''));

let cleanup: (() => void) | void;
afterEach(() => { try { cleanup?.(); } catch { /* ignore */ } cleanup = undefined; closePopup(); document.body.innerHTML = ''; hooks.onUpdate = null; });

async function open() {
  const { ctx } = await makeCtx({ pinyin: 'all', layout: 'scroll' });
  const meta: BookMeta = await ctx.store.books.add({ title: '测试书', author: 'T', format: 'paste', script: 'simplified', chapters, assets: new Map() });
  location.hash = `#/read/${meta.id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: meta.id }, ctx);
}

describe('names found while a word card is open', () => {
  it('wait for the card to close, then redraw the page', async () => {
    await open();
    expect(hooks.onUpdate).not.toBeNull();
    const word = document.querySelector<HTMLElement>('.rd-p .rd-w')!;
    word.querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(document.querySelector('.pp-pop')).not.toBeNull();
    const found: Lexicon = buildLexicon([entry('门口见面')]);
    hooks.onUpdate!(found);
    await new Promise((r) => setTimeout(r, 450));
    expect(document.querySelector('.pp-pop'), 'the card is still there').not.toBeNull();
    expect(wordTexts()).not.toContain('门口见面');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.pp-pop')).toBeNull();
    await vi.waitFor(() => expect(wordTexts()).toContain('门口见面'), { timeout: 2000 });
  });

  it('with no card open the names apply at once', async () => {
    await open();
    hooks.onUpdate!(buildLexicon([entry('门口见面')]));
    await vi.waitFor(() => expect(wordTexts()).toContain('门口见面'), { timeout: 2000 });
  });
});
