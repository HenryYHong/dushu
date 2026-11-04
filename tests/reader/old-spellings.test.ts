// @vitest-environment jsdom
// A book's old spellings in the reader (ui/reader/oldSpellings.ts, core/bookStyle.ts): found once in the background and kept on the
// book, asked about once (Yes keeps them, No reads the characters as written), the choice kept as a fix of the book (synced), and
// the switches in the Corrections tab. The text is invented.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OLD_SPELLINGS_VERSION } from '../../src/core/bookStyle';
import { bookKey } from '../../src/core/syncKeys';
import type { AppContext, BookMeta } from '../../src/types';
import { closePopup } from '../../src/ui/popup/popup';
import { mount } from '../../src/ui/reader/reader';
import { makeCtx, stubBrowser } from './helpers';

beforeAll(() => stubBrowser());
let cleanup: (() => void) | void;
afterEach(() => { try { cleanup?.(); } catch { /* ignore */ } cleanup = undefined; closePopup(); document.body.innerHTML = ''; });

// 底 for the particle 的, the way some 1920s books write it, many times over.
const OLD = ['我底书放在桌上。', '你底笔在我这里。', '他底家很远。', '她底话我都记得。', '我们底事情很多。', '你们底朋友来了。', '他们底孩子都大了。'];

async function open(ctx: AppContext, id: string) {
  location.hash = `#/read/${id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: id }, ctx);
}

describe('old spellings in the reader', () => {
  it('finds them once, keeps the report on the book, asks once, and keeps the answer as a fix of the book', async () => {
    const { ctx } = await makeCtx({ pinyin: 'all', layout: 'scroll' });
    localStorage.setItem('dushu.reader-hint.v1', '1');
    const meta: BookMeta = await ctx.store.books.add({ title: '旧书', author: 'T', format: 'paste', script: 'simplified', assets: new Map(),
      chapters: [{ title: '一', blocks: OLD.map((text) => ({ t: 'p' as const, text })) }] });
    await open(ctx, meta.id);
    const ask = await vi.waitFor(() => { const el = document.querySelector('.rd-spell-ask'); expect(el).not.toBeNull(); return el!; }, { timeout: 5000 });
    expect(ask.textContent).toContain('This book writes 底 for 的, as many older books do. Read it that way?');
    // While it is up, toasts show above it (its height is kept for the toasts' place).
    await vi.waitFor(() => expect(document.body.style.getPropertyValue('--rd-coach-h')).toMatch(/^\d+px$/));
    expect((await ctx.store.books.get(meta.id))?.oldSpellings).toMatchObject({ v: OLD_SPELLINGS_VERSION, di: { sure: true } });
    [...ask.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'No')!.click();
    expect(document.querySelector('.rd-spell-ask')).toBeNull();
    await vi.waitFor(() => expect(document.body.style.getPropertyValue('--rd-coach-h')).toBe(''));
    await vi.waitFor(async () => expect(await ctx.store.fixes.list()).toEqual([expect.objectContaining({ kind: 'spelling', word: '底', on: false, book: bookKey(meta) })]));
    const first = () => [...document.querySelectorAll('.rd-article ruby')].find((r) => (r.firstChild as Text).data === '底')?.querySelector('rt')?.textContent;
    await vi.waitFor(() => expect(first()).toBe('dǐ'));
    // The Corrections tab has its switch, off now.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    const sw = await vi.waitFor(() => { const el = document.querySelector<HTMLInputElement>('.rd-fix-spell input'); expect(el).not.toBeNull(); return el!; });
    expect(document.querySelector('.rd-fix-spell-label')!.textContent).toBe('底 for 的');
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('.rd-fix-spell input')!.checked).toBe(false));
    sw.checked = true;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(async () => expect((await ctx.store.fixes.list())[0]).toMatchObject({ kind: 'spelling', on: true }));
    // The page follows the switch: 我底书 reads de.
    const di = () => [...document.querySelectorAll('.rd-article ruby')].find((r) => (r.firstChild as Text).data === '底')?.querySelector('rt')?.textContent;
    await vi.waitFor(() => expect(di()).toBe('de'));
    // Opened again: the report is kept, so nothing is found again and nothing is asked.
    cleanup?.();
    document.body.innerHTML = '';
    await open(ctx, meta.id);
    await new Promise((r) => setTimeout(r, 1800));
    expect(document.querySelector('.rd-spell-ask')).toBeNull();
  });

  it('asks nothing of a book that writes 的', async () => {
    const { ctx } = await makeCtx({ pinyin: 'all', layout: 'scroll' });
    localStorage.setItem('dushu.reader-hint.v1', '1');
    const meta: BookMeta = await ctx.store.books.add({ title: '新书', author: 'T', format: 'paste', script: 'simplified', assets: new Map(),
      chapters: [{ title: '一', blocks: OLD.map((text) => ({ t: 'p' as const, text: text.replace('底', '的') })) }] });
    await open(ctx, meta.id);
    await vi.waitFor(async () => expect((await ctx.store.books.get(meta.id))?.oldSpellings?.di.sure).toBe(false), { timeout: 5000 });
    expect(document.querySelector('.rd-spell-ask')).toBeNull();
  });
});
