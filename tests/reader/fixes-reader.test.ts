// @vitest-environment jsdom
// The reader's fixes on the page (ARCHITECTURE.md §4.12): a fix saved (here, in another tab, or by sync) draws the page again cut and
// read as it says; the word card, the Words tab and read-aloud see the fixed words; the Corrections tab lists them with a switch
// and Delete; and a "here only" fix stays at its place. The sentences are invented.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { anchorAt, makeFix } from '../../src/core/fixes';
import { bookKey } from '../../src/core/syncKeys';
import type { AppContext, BookMeta, Chapter, Fix } from '../../src/types';
import { closePopup } from '../../src/ui/popup/popup';
import { correctionsTab, createBookFixes } from '../../src/ui/reader/bookFixes';
import { mount } from '../../src/ui/reader/reader';
import { makeCtx, stubBrowser } from './helpers';

beforeAll(() => stubBrowser());
// jsdom has no showModal or close on <dialog>; give it the parts the import's question uses.
const dialogProto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
dialogProto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
dialogProto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };

const P1 = '我们在银行门口见面。银行很大。';
const P2 = '子君说道：我也去银行。';
const chapters: Chapter[] = [{ title: '第一章', blocks: [{ t: 'p', text: P1 }, { t: 'p', text: P2 }] }, { title: '第二章', blocks: [{ t: 'p', text: '月亮升起来了。' }] }];

let cleanup: (() => void) | void;
afterEach(() => { try { cleanup?.(); } catch { /* ignore */ } cleanup = undefined; closePopup(); document.body.innerHTML = ''; });

async function setup() {
  const made = await makeCtx({ pinyin: 'all', layout: 'scroll' });
  const meta: BookMeta = await made.ctx.store.books.add({ title: '测试书', author: 'T', format: 'paste', script: 'simplified', chapters, assets: new Map() });
  return { ...made, meta, key: bookKey(meta) };
}
async function open(ctx: AppContext, id: string) {
  location.hash = `#/read/${id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: id }, ctx);
}
/** The words of a paragraph on the page, with their readings. */
const words = (i: number) => [...document.querySelectorAll<HTMLElement>(`.rd-article [data-b="${i + 1}"] .rd-w`)]
  .map((w) => `${[...w.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join('')}{${[...w.querySelectorAll('rt')].map((r) => r.textContent).join(' ')}}`);
const fix = (meta: BookMeta, key: string, o: Partial<Fix> & Pick<Fix, 'kind' | 'word'>) => makeFix({ book: key, bookId: meta.id, ...o } as Parameters<typeof makeFix>[0]);

describe('fixes on the page', () => {
  it('draws the page again when a fix is saved: split everywhere, a reading, a name', async () => {
    const { ctx, meta, key } = await setup();
    await open(ctx, meta.id);
    expect(words(0)).toContain('银行{yín háng}');
    await ctx.store.fixes.put([fix(meta, key, { kind: 'cut', word: '银行', cuts: [1] })]);
    await vi.waitFor(() => expect(words(0).filter((w) => w.startsWith('银'))).toEqual(['银{yín}', '银{yín}']));
    expect(words(1)).toContain('银{yín}');
    expect(words(1).slice(0, 2)).toEqual(['子{zǐ}', '君{jūn}']);
    await ctx.store.fixes.put([fix(meta, key, { kind: 'word', word: '子君', pinyin: 'zi3 jun1', role: 'name' }), fix(meta, key, { kind: 'reading', word: '门口', pinyin: 'men2 kou5' })]);
    await vi.waitFor(() => expect(words(1)[0]).toBe('子君{zǐ jūn}'));
    expect(words(0)).toContain('门口{mén kou}');
  });

  it('keeps a "here only" fix at its place', async () => {
    const { ctx, meta, key } = await setup();
    // Only the second 银行 of the first paragraph is split.
    const at = anchorAt(P1, 0, 0, 10, 2);
    await ctx.store.fixes.put([fix(meta, key, { kind: 'cut', word: '银行', cuts: [1], at })]);
    await open(ctx, meta.id);
    await vi.waitFor(() => expect(words(0)).toContain('银{yín}'));
    expect(words(0).filter((w) => w.startsWith('银'))).toEqual(['银行{yín háng}', '银{yín}']);
    expect(words(1)).toContain('银行{yín háng}');
  });

  it('opens the word card with the pencil on the fixed word, and the Words tab counts the fixed words', async () => {
    const { ctx, meta, key } = await setup();
    await ctx.store.fixes.put([fix(meta, key, { kind: 'word', word: '子君', pinyin: 'zi3 jun1', role: 'name' })]);
    await open(ctx, meta.id);
    const w = [...document.querySelectorAll<HTMLElement>('.rd-article [data-b="2"] .rd-w')][0];
    w.querySelector('ruby')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await vi.waitFor(() => expect(document.querySelector('.pp-word')?.textContent).toBe('子君'));
    expect(document.querySelector('.pp-book .chip')?.textContent).toBe('Person');
    expect(document.querySelector('.pp-fix-btn')).not.toBeNull();
    closePopup();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('.rd-toc-root')?.hasAttribute('hidden')).toBe(false));
    [...document.querySelectorAll<HTMLElement>('.rd-toc-tab')].find((t) => t.textContent === 'Words')!.click();
    await vi.waitFor(() => expect(document.querySelectorAll('.rd-words .rd-word').length).toBeGreaterThan(2));
    const listed = [...document.querySelectorAll('.rd-words .rd-name-word')].map((e) => e.textContent);
    expect(listed).not.toContain('子');
    expect(listed).not.toContain('君');
  });

  it('lists the fixes in the Corrections tab, switches one off and deletes one with Undo', async () => {
    const { ctx, meta, key } = await setup();
    const toast = vi.spyOn(ctx, 'toast');
    const cut = fix(meta, key, { kind: 'cut', word: '银行', cuts: [1] });
    const name = fix(meta, key, { kind: 'word', word: '子君', pinyin: 'zi3 jun1', role: 'name', n: 1 });
    await ctx.store.fixes.put([cut, name]);
    await open(ctx, meta.id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelectorAll('.rd-names .rd-name').length).toBe(1));
    expect([...document.querySelectorAll('.rd-toc-tab')].map((t) => t.textContent)).toContain('Corrections');
    expect([...document.querySelectorAll('.rd-fix-seg')].map((b) => b.textContent)).toEqual(['Names 1', 'Words 1', 'Readings 0']);
    const nameRow = document.querySelector('.rd-names .rd-name')!;
    expect(nameRow.querySelector('.rd-name-py')!.textContent).toBe('Zǐjūn');
    expect(nameRow.querySelector('.rd-name-kind')!.textContent).toBe('Person');
    expect(nameRow.querySelector('.rd-name-scope')!.textContent).toBe('This book');
    [...document.querySelectorAll<HTMLElement>('.rd-fix-seg')][1].click();
    const cutRow = document.querySelector('.rd-names .rd-name')!;
    expect(cutRow.querySelector('.rd-name-word')!.textContent).toBe('银行');
    expect(cutRow.querySelector('.rd-name-py')!.textContent).toBe('银 | 行');
    expect(cutRow.querySelector('.rd-name-kind')!.textContent).toBe('Split');
    // Switched off: the page reads 银行 again; the fix stays, off.
    const sw = cutRow.querySelector<HTMLInputElement>('.rd-sw-input')!;
    sw.checked = false;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(async () => expect((await ctx.store.fixes.list()).find((f) => f.id === cut.id)?.on).toBe(false));
    await vi.waitFor(() => expect(words(0)).toContain('银行{yín háng}'));
    // Delete, then Undo.
    await vi.waitFor(() => expect(document.querySelector('.rd-names .rd-fix-del')).not.toBeNull());
    document.querySelector<HTMLElement>('.rd-names .rd-fix-del')!.click();
    await vi.waitFor(async () => expect((await ctx.store.fixes.list()).map((f) => f.id)).toEqual([name.id]));
    const undo = toast.mock.calls.find((c) => c[0] === 'Your correction of 银行 is deleted.')![1]!.action!;
    undo.run();
    await vi.waitFor(async () => expect((await ctx.store.fixes.list()).map((f) => f.id).sort()).toEqual([cut.id, name.id].sort()));
  });

  it('opens Corrections on the part that has rows, lists an other name under Names, keeps a switched row in place, and finds pinyin typed without tones', async () => {
    const { ctx, meta, key } = await setup();
    const joined = [fix(meta, key, { kind: 'word', word: '银行门', pinyin: 'yin2 hang2 men2' }), fix(meta, key, { kind: 'word', word: '见面', pinyin: 'jian4 mian4', n: 5 })];
    await ctx.store.fixes.put(joined);
    await open(ctx, meta.id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelectorAll('.rd-names .rd-name').length).toBe(2));
    // Names has nothing: the tab opens on Words.
    expect([...document.querySelectorAll('.rd-fix-seg')].map((b) => `${b.textContent} ${b.getAttribute('aria-pressed')}`)).toEqual(['Names 0 false', 'Words 2 true', 'Readings 0 false']);
    const order = () => [...document.querySelectorAll('.rd-names .rd-name-word')].map((e) => e.textContent);
    expect(order()).toEqual(['见面', '银行门']);
    // Switched off, the first row stays first (it is under the finger) until the list is opened again.
    const sw = document.querySelector<HTMLInputElement>('.rd-names .rd-sw-input')!;
    sw.checked = false;
    sw.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(async () => expect((await ctx.store.fixes.list()).find((f) => f.word === '见面')?.on).toBe(false));
    await vi.waitFor(() => expect(document.querySelector('.rd-names .rd-name')?.hasAttribute('data-off')).toBe(true));
    expect(order()).toEqual(['见面', '银行门']);
    // An other name the reader marked is a name: under Names, said so, with capitals.
    await ctx.store.fixes.put([fix(meta, key, { kind: 'word', word: '子君说', pinyin: 'zi3 jun1 shuo1', role: 'term' })]);
    [...document.querySelectorAll<HTMLElement>('.rd-fix-seg')][0].click();
    await vi.waitFor(() => expect(document.querySelector('.rd-names .rd-name-word')?.textContent).toBe('子君说'));
    const row = document.querySelector('.rd-names .rd-name')!;
    expect(row.querySelector('.rd-name-kind')!.textContent).toBe('Other name');
    expect(row.querySelector('.rd-name-py')!.textContent).toMatch(/^Z/);
    // Pinyin typed without tones finds it.
    const filter = [...document.querySelectorAll<HTMLInputElement>('.rd-toc-filter')].find((f) => !f.hidden)!;
    filter.value = 'zijun';
    filter.dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('.rd-names .rd-name-word')].map((e) => e.textContent)).toEqual(['子君说']);
  });

  it('asks before importing the corrections of another book, says when they are all here, and exports the words joined for all books', async () => {
    const { ctx, meta, key } = await setup();
    const toast = vi.spyOn(ctx, 'toast');
    const fixes = createBookFixes(ctx, meta);
    await fixes.load();
    const tab = correctionsTab(ctx, fixes, '测试书');
    // (jsdom's File has no text().)
    const file = (book: { title: string; key: string }) => {
      const json = JSON.stringify({ app: 'dushu', corrections: 1, book, fixes: [{ kind: 'word', word: '银行门', pinyin: 'yin2 hang2 men2', role: 'user', on: true, t: 5 }] });
      return Object.assign(new File([json], 'c.json'), { text: async () => json });
    };
    // Another book's file: the reader is asked, and No adds nothing.
    const other = tab.importFile(file({ title: '别的书', key: 'other-key' }));
    const dlg = await vi.waitFor(() => { const d = document.querySelector('dialog'); expect(d).not.toBeNull(); return d!; });
    expect(dlg.textContent).toContain('“别的书”');
    (dlg.querySelector('.btn:not(.btn-primary)') as HTMLElement).click();
    await other;
    expect(await ctx.store.fixes.list()).toEqual([]);
    // This book's file is added at once; the same again is already here.
    await tab.importFile(file({ title: '测试书', key }));
    expect(await ctx.store.fixes.list()).toHaveLength(1);
    expect(toast).toHaveBeenLastCalledWith('Added 1 correction.');
    await fixes.load();
    await tab.importFile(file({ title: '测试书', key }));
    expect(toast).toHaveBeenLastCalledWith('These corrections are already here.');
    // A word joined in all books travels in the file, marked so.
    await ctx.store.fixes.put([makeFix({ book: '*', bookId: '*', kind: 'word', word: '见面', pinyin: 'jian4 mian4', role: 'user' })]);
    await fixes.load();
    let written = '';
    vi.stubGlobal('Blob', class { constructor(parts: string[]) { written = parts.join(''); } });
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
    HTMLAnchorElement.prototype.click = vi.fn();
    await tab.exportFile();
    vi.unstubAllGlobals();
    stubBrowser();
    const data = JSON.parse(written) as { fixes: { word: string; all?: boolean }[] };
    expect(data.fixes.map((f) => `${f.word}${f.all ? ' all' : ''}`).sort()).toEqual(['见面 all', '银行门']);
  });

  it('shows a split of a traditional book in the script the page shows', async () => {
    const made = await makeCtx({ pinyin: 'all', layout: 'scroll', script: 'simplified' });
    const meta: BookMeta = await made.ctx.store.books.add({ title: '舊書', author: 'T', format: 'paste', script: 'traditional', assets: new Map(),
      chapters: [{ title: '一', blocks: [{ t: 'p', text: '我們在銀行門口見面。' }] }] });
    await made.ctx.store.fixes.put([fix(meta, bookKey(meta), { kind: 'cut', word: '銀行', cuts: [1] })]);
    await open(made.ctx, meta.id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('.rd-names .rd-name-py')?.textContent).toBe('银 | 行'));
    expect(document.querySelector('.rd-names .rd-name-word')!.textContent).toBe('银行');
  });

  it('keeps the keyboard cursor on its word when a fix draws the page again, and leaves Enter to a button', async () => {
    const { ctx, meta, key } = await setup();
    await open(ctx, meta.id);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const first = await vi.waitFor(() => { const el = document.querySelector<HTMLElement>('.rd-cursor'); expect(el).not.toBeNull(); return el!; });
    const s = first.dataset.s;
    // A fix redraws the page: the cursor is on the new element of its word, which has the focus.
    await ctx.store.fixes.put([fix(meta, key, { kind: 'cut', word: '我们', cuts: [1] })]);
    await vi.waitFor(() => expect(words(0)[0]).toBe('我{wǒ}'));
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.rd-cursor')?.isConnected).toBe(true));
    const now = document.querySelector<HTMLElement>('.rd-cursor')!;
    expect(now).not.toBe(first);
    expect(now.dataset.s).toBe(s);
    expect(document.activeElement).toBe(now);
    // Enter on a button (the toast's Undo) is the button's: the word card does not open.
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.querySelector('.pp-pop')).toBeNull();
  });
});
