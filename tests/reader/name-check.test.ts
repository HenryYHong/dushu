// @vitest-environment jsdom
// The name check in the reader (ui/reader/nameCheck.ts, core/nameCandidates.ts, ARCHITECTURE.md §4.13): once the book's names are
// found, "Names in this book?" with a chip per candidate; a tap marks a name, a long press picks its kind, × says it is not; Done saves
// the answers as fixes of the book (with Undo), the page shows the names whole, the Corrections tab lists them and its Check names
// asks again about the rest. Asked once per book. The story is invented.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NAME_CHECK_VERSION } from '../../src/core/nameCandidates';
import { bookKey } from '../../src/core/syncKeys';
import type { AppContext, BookMeta } from '../../src/types';
import { closePopup } from '../../src/ui/popup/popup';
import { mount } from '../../src/ui/reader/reader';
import { nameStory } from '../core/nameStory';
import { makeCtx, stubBrowser } from './helpers';

beforeAll(() => stubBrowser());
let cleanup: (() => void) | void;
afterEach(() => { try { cleanup?.(); } catch { /* ignore */ } cleanup = undefined; closePopup(); document.body.innerHTML = ''; });

async function open(ctx: AppContext, id: string) {
  location.hash = `#/read/${id}`;
  const root = document.createElement('div');
  document.body.appendChild(root);
  cleanup = await mount(root, { bookId: id }, ctx);
}

/** The chip of `word` in the card. */
const chip = (word: string) => [...document.querySelectorAll<HTMLElement>('.rd-nc-chip')].find((c) => c.querySelector('.rd-nc-text')?.textContent === word)!;

async function setup() {
  const made = await makeCtx({ pinyin: 'all', layout: 'scroll' });
  localStorage.setItem('dushu.reader-hint.v1', '1');
  const meta: BookMeta = await made.ctx.store.books.add({ title: '村里的故事', author: 'T', format: 'paste', script: 'simplified', assets: new Map(),
    chapters: [{ title: '一', blocks: nameStory().map((text) => ({ t: 'p' as const, text })) }] });
  // Toasts with their actions (Undo).
  const undo: (() => void)[] = [];
  made.ctx.toast = (m, o) => { made.toasts.push(m); if (o?.action) undo.push(o.action.run); };
  return { ...made, meta, undo };
}

describe('the name check', () => {
  it('asks once after the names are found, saves the answers as fixes, and shows the names whole', async () => {
    const { ctx, meta, toasts, undo } = await setup();
    await open(ctx, meta.id);
    const card = await vi.waitFor(() => { const el = document.querySelector<HTMLElement>('.rd-name-ask'); expect(el).not.toBeNull(); return el!; }, { timeout: 10000 });
    expect(card.querySelector('.rd-nc-title')!.textContent).toBe('Names in this book?');
    expect(chip('七斤').querySelector('.rd-nc-count')!.textContent).toBe('24×');
    expect(document.querySelectorAll('.rd-nc-chip').length).toBeLessThanOrEqual(8);
    // While it is up, toasts show above it.
    await vi.waitFor(() => expect(document.body.style.getPropertyValue('--rd-coach-h')).toMatch(/^\d+px$/));
    const done = card.querySelector<HTMLButtonElement>('.rd-nc-done')!;
    expect(done.textContent).toBe('Not now');

    // A tap: a person.
    chip('七斤').querySelector<HTMLElement>('.rd-nc-word')!.click();
    expect(chip('七斤').dataset.state).toBe('yes');
    expect(chip('七斤').querySelector('.rd-nc-kind')!.textContent).toBe('Person');
    expect(done.textContent).toBe('Done');
    // A long press opens the kind menu: Other name.
    const big = chip('七大人').querySelector<HTMLElement>('.rd-nc-word')!;
    big.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    big.dispatchEvent(new Event('pointerup', { bubbles: true }));
    big.click(); // the click that ends a long press does not toggle it back
    const items = [...document.querySelectorAll<HTMLElement>('.rd-nc-menu-item')];
    expect(items.map((b) => b.textContent)).toEqual(['Person', 'Place', 'Other name']);
    expect(chip('七大人').nextElementSibling?.classList.contains('rd-nc-menu')).toBe(true);
    items[2].click();
    expect(chip('七大人').dataset.state).toBe('yes');
    expect(chip('七大人').querySelector('.rd-nc-kind')!.textContent).toBe('Other name');
    // The chevron opens the same menu; Person again.
    chip('七大人').querySelector<HTMLElement>('.rd-nc-more')!.click();
    await new Promise((r) => setTimeout(r, 400));
    [...document.querySelectorAll<HTMLElement>('.rd-nc-menu-item')][0].click();
    expect(chip('七大人').querySelector('.rd-nc-kind')!.textContent).toBe('Person');
    // ×: not a name.
    chip('小栓').querySelector<HTMLElement>('.rd-nc-no')!.click();
    expect(chip('小栓').dataset.state).toBe('no');
    expect(chip('小栓').querySelector('.rd-nc-no')!.getAttribute('aria-pressed')).toBe('true');

    done.click();
    expect(document.querySelector('.rd-name-ask')).toBeNull();
    const key = bookKey(meta);
    await vi.waitFor(async () => {
      const list = await ctx.store.fixes.list();
      expect(list.map((f) => [f.word, f.kind, f.role ?? '', f.pinyin ?? '', f.book]).sort()).toEqual([
        ['七大人', 'word', 'name', 'qi1 da4 ren5', key], ['七斤', 'word', 'name', 'qi1 jin1', key], ['小栓', 'unword', '', '', key]].sort());
    });
    expect(toasts.at(-1)).toBe('Marked 2 names (38 places), and 1 word as not a name.');
    expect((await ctx.store.books.get(meta.id))?.nameCheck).toMatchObject({ v: NAME_CHECK_VERSION, asked: true });
    // The page shows 七斤 as one word, read as a name.
    const whole = () => [...document.querySelectorAll('.rd-article .rd-w')].filter((w) => [...w.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join('') === '七斤');
    await vi.waitFor(() => expect(whole().length).toBeGreaterThan(5));

    // Undo takes all three away.
    undo.at(-1)!();
    await vi.waitFor(async () => expect(await ctx.store.fixes.list()).toEqual([]));
  });

  it('lists the answers under Corrections, whose Check names asks about the rest; opened again, it asks nothing', async () => {
    const { ctx, meta, toasts } = await setup();
    await open(ctx, meta.id);
    const card = await vi.waitFor(() => { const el = document.querySelector<HTMLElement>('.rd-name-ask'); expect(el).not.toBeNull(); return el!; }, { timeout: 10000 });
    const offered = [...card.querySelectorAll('.rd-nc-text')].map((e) => e.textContent);
    chip('七斤').querySelector<HTMLElement>('.rd-nc-word')!.click();
    card.querySelector<HTMLElement>('.rd-nc-done')!.click();
    await vi.waitFor(async () => expect((await ctx.store.fixes.list()).length).toBe(1));
    // Corrections: 七斤 under Names, as a person.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await vi.waitFor(() => expect([...document.querySelectorAll('.rd-name .rd-name-word')].map((e) => e.textContent)).toContain('七斤'));
    const row = [...document.querySelectorAll('.rd-name')].find((r) => r.querySelector('.rd-name-word')?.textContent === '七斤')!;
    expect(row.querySelector('.rd-name-kind')!.textContent).toBe('Person');
    // Check names: the card again, without 七斤.
    const check = [...document.querySelectorAll<HTMLElement>('.rd-fix-foot button')].find((b) => b.textContent === 'Check names')!;
    check.click();
    const again = await vi.waitFor(() => { const el = document.querySelector<HTMLElement>('.rd-name-ask'); expect(el).not.toBeNull(); return el!; });
    expect([...again.querySelectorAll('.rd-nc-text')].map((e) => e.textContent)).toEqual(offered.filter((w) => w !== '七斤'));
    // Put away with ×: nothing saved.
    again.querySelector<HTMLElement>('.rd-nc-close')!.click();
    expect(document.querySelector('.rd-name-ask')).toBeNull();
    expect((await ctx.store.fixes.list()).length).toBe(1);
    // Opened again: not asked.
    cleanup?.();
    document.body.innerHTML = '';
    await open(ctx, meta.id);
    await new Promise((r) => setTimeout(r, 2500));
    expect(document.querySelector('.rd-name-ask')).toBeNull();
    expect(toasts).not.toContain('No more names to check in this book.');
  });

  it('keeps marks made before Close; a right click picks the kind at once; arrows move in the menu; Tab reaches the card early', async () => {
    const { ctx, meta, toasts } = await setup();
    await open(ctx, meta.id);
    const card = await vi.waitFor(() => { const el = document.querySelector<HTMLElement>('.rd-name-ask'); expect(el).not.toBeNull(); return el!; }, { timeout: 10000 });
    // Right after the top bar in the page's order, so the keyboard reaches it before the text.
    expect(card.previousElementSibling?.classList.contains('rd-bar')).toBe(true);
    // A right click opens the kind menu at once; the arrows move between the kinds; the first click counts.
    const word = chip('七大人').querySelector<HTMLElement>('.rd-nc-word')!;
    word.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { button: 2, pointerType: 'mouse' }));
    word.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    const items = [...document.querySelectorAll<HTMLElement>('.rd-nc-menu-item')];
    expect(document.activeElement).toBe(items[0]);
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(items[2]);
    items[1].click();
    expect(chip('七大人').querySelector('.rd-nc-kind')!.textContent).toBe('Place');
    expect(document.querySelector('.rd-nc-menu')).toBeNull();
    // Right click, Escape, then a tap on the chip at once: the mark goes.
    word.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    document.querySelector('.rd-nc-menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.rd-nc-menu')).toBeNull();
    word.click();
    expect(chip('七大人').dataset.state).toBe('');
    // A mark, then Close: kept, as Done keeps it.
    chip('七斤').querySelector<HTMLElement>('.rd-nc-word')!.click();
    card.querySelector<HTMLElement>('.rd-nc-close')!.click();
    expect(document.querySelector('.rd-name-ask')).toBeNull();
    await vi.waitFor(async () => expect((await ctx.store.fixes.list()).map((f) => [f.word, f.role])).toEqual([['七斤', 'name']]));
    expect(toasts.at(-1)).toBe('Marked 1 name (24 places).');
  });

  it('says a dictionary word is not a name with Undo, and lists it under Corrections, whose Delete asks about it again', async () => {
    const { ctx, meta, toasts, undo, dict } = await setup();
    await open(ctx, meta.id);
    let card = await vi.waitFor(() => { const el = document.querySelector<HTMLElement>('.rd-name-ask'); expect(el).not.toBeNull(); return el!; }, { timeout: 10000 });
    // (The story has no dictionary word among its names: 小栓 is made one while the card is answered.)
    const has = dict.hasWord.bind(dict);
    const asWord = () => vi.spyOn(dict, 'hasWord').mockImplementation((w: string) => w === '小栓' || has(w));
    const noOf = async () => (await ctx.store.books.get(meta.id))?.nameCheck?.no;
    let spy = asWord();
    try {
      chip('小栓').querySelector<HTMLElement>('.rd-nc-no')!.click();
      card.querySelector<HTMLElement>('.rd-nc-done')!.click();
      await vi.waitFor(() => expect(toasts.at(-1)).toBe('1 word marked as not a name.'));
    } finally { spy.mockRestore(); }
    expect(await ctx.store.fixes.list()).toEqual([]);
    expect(await noOf()).toEqual(['小栓']);
    // Corrections, under Words: 小栓, not a name. Delete: asked about again.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('.rd-fix-seg[data-seg="words"]')).not.toBeNull());
    document.querySelector<HTMLElement>('.rd-fix-seg[data-seg="words"]')!.click();
    const row = await vi.waitFor(() => { const r = [...document.querySelectorAll('.rd-name')].find((x) => x.querySelector('.rd-name-word')?.textContent === '小栓'); expect(r).toBeTruthy(); return r!; });
    expect(row.querySelector('.rd-name-kind')!.textContent).toBe('Not a name');
    row.querySelector<HTMLElement>('.rd-fix-del')!.click();
    await vi.waitFor(async () => expect(await noOf()).toEqual([]));
    expect(toasts.at(-1)).toBe('Check names may ask about 小栓 again.');
    // Check names offers it again; said not a name once more, Undo takes the answer back.
    [...document.querySelectorAll<HTMLElement>('.rd-fix-foot button')].find((b) => b.textContent === 'Check names')!.click();
    card = await vi.waitFor(() => { const el = document.querySelector<HTMLElement>('.rd-name-ask'); expect(el).not.toBeNull(); return el!; });
    spy = asWord();
    try {
      chip('小栓').querySelector<HTMLElement>('.rd-nc-no')!.click();
      card.querySelector<HTMLElement>('.rd-nc-done')!.click();
      await vi.waitFor(async () => expect(await noOf()).toEqual(['小栓']));
    } finally { spy.mockRestore(); }
    undo.at(-1)!();
    await vi.waitFor(async () => expect(await noOf()).toEqual([]));
  });
});
