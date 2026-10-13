// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildLexicon, parseEntryPinyin, USER_SCOPE } from '../../src/core/lexicon';
import type { LexiconEntry } from '../../src/types';
import { closePopup, openPhrasePopup, openWordPopup } from '../../src/ui/popup/popup';
import { anchorRect, makeCtx, stubBrowser, tick } from './helpers';

beforeAll(() => stubBrowser());
afterEach(() => { closePopup(); document.body.innerHTML = ''; });

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (sel: string) => q(sel)?.textContent ?? '';
const entry = (word: string, over: Partial<LexiconEntry> = {}): LexiconEntry => ({
  word, pinyin: 'guo1 jing4', gloss: 'name (person)', kind: 'name', count: 4999, enabled: true, origin: 'auto', ...over,
});
const type = (el: HTMLElement | null, value: string) => { (el as HTMLInputElement).value = value; };
const submit = (form: HTMLElement | null) => form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

describe('parseEntryPinyin', () => {
  it('reads numbered, marked and run-together pinyin, one syllable per character', () => {
    expect(parseEntryPinyin('guo1 jing4', '郭靖')).toBe('guo1 jing4');
    expect(parseEntryPinyin('Guō Jìng', '郭靖')).toBe('guo1 jing4');
    expect(parseEntryPinyin('guōjìng', '郭靖')).toBe('guo1 jing4');
    expect(parseEntryPinyin('nü3 hai2', '女孩')).toBe('nü3 hai2');
    expect(parseEntryPinyin('guo1', '郭靖')).toBeNull();
    expect(parseEntryPinyin('guo1 jing4 x', '郭靖')).toBeNull();
    expect(parseEntryPinyin('', '郭靖')).toBeNull();
    expect(parseEntryPinyin('1 2', '郭靖')).toBeNull();
  });
});

describe('In this book card', () => {
  it('leads the word popup with the entry: pinyin, kind, count, meaning', async () => {
    const { ctx } = await makeCtx();
    const lexicon = buildLexicon([entry('郭靖')]);
    openWordPopup({ ctx, word: '郭靖', anchor: anchorRect(), lexicon, bookId: 'b1' });
    expect(text('.pp-book .pp-section')).toBe('In this book');
    expect(text('.pp-book .chip')).toBe('Person');
    expect(text('.pp-book')).toContain('4,999 times');
    expect(text('.pp-book .pp-py')).toBe('Guō Jìng'); // a name is capitalized
    expect(text('.pp-book-gloss')).toBe('name (person)');
    expect(text('.pp-pyline .pp-py')).toBe('Guō Jìng'); // the header reading comes from the entry too
    expect(document.querySelectorAll('.pp-card')).toHaveLength(2); // the characters are still there
    expect(q('.pp-body')!.firstElementChild!.classList.contains('pp-book')).toBe(true);
  });

  it('is absent for ordinary words and when no book is open', async () => {
    const { ctx } = await makeCtx();
    const lexicon = buildLexicon([entry('郭靖')]);
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), lexicon, bookId: 'b1' });
    expect(q('.pp-book')).toBeNull();
    closePopup();
    openWordPopup({ ctx, word: '郭靖', anchor: anchorRect() });
    expect(q('.pp-book')).toBeNull();
  });

  it('finds an entry saved in the other script', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '賈母', anchor: anchorRect(), lexicon: buildLexicon([entry('贾母', { pinyin: 'jia3 mu3' })]), bookId: 'b1' });
    expect(text('.pp-book .pp-py')).toBe('Jiǎ Mǔ');
  });

  it('Edit saves the user pinyin and meaning, marks the row as the user\'s, and tells the reader', async () => {
    const { ctx } = await makeCtx();
    const onLexiconChange = vi.fn();
    openWordPopup({ ctx, word: '郭靖', anchor: anchorRect(), lexicon: buildLexicon([entry('郭靖', { pinyin: 'guo2 jing4' })]), bookId: 'b1', onLexiconChange });
    [...document.querySelectorAll<HTMLElement>('.pp-book .btn')].find((b) => b.textContent === 'Edit')!.click();
    const inputs = document.querySelectorAll<HTMLInputElement>('.pp-lex-form input');
    expect(inputs[0].value).toBe('guo2 jing4');
    type(inputs[0], 'guo1');
    submit(q('.pp-lex-form'));
    await tick();
    expect(text('.pp-field-error')).toContain('2 characters');
    expect(await ctx.store.lexicon.get('b1')).toEqual([]);
    type(inputs[0], 'guō jìng');
    type(inputs[1], 'hero of the story');
    submit(q('.pp-lex-form'));
    await tick(10);
    const rows = await ctx.store.lexicon.get('b1');
    expect(rows).toEqual([entry('郭靖', { pinyin: 'guo1 jing4', gloss: 'hero of the story', origin: 'user' })]);
    expect(onLexiconChange).toHaveBeenCalledTimes(1);
    expect(text('.pp-book .pp-py')).toBe('Guō Jìng'); // a name is capitalized
    expect(text('.pp-book-gloss')).toBe('hero of the story');
  });

  it('"Not a word" disables the entry for this book, closes the popup, and offers Undo', async () => {
    const { ctx, toasts } = await makeCtx();
    const onLexiconChange = vi.fn();
    const toast = vi.spyOn(ctx, 'toast');
    openWordPopup({ ctx, word: '郭靖', anchor: anchorRect(), lexicon: buildLexicon([entry('郭靖')]), bookId: 'b1', onLexiconChange });
    [...document.querySelectorAll<HTMLElement>('.pp-book .btn')].find((b) => b.textContent === 'Not a word')!.click();
    await tick(10);
    const rows = await ctx.store.lexicon.get('b1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ word: '郭靖', enabled: false, origin: 'user' });
    expect(onLexiconChange).toHaveBeenCalled();
    expect(q('.pp-pop')).toBeNull();
    void toasts;
    const opts = toast.mock.calls[0][1];
    expect(opts?.action?.label).toBe('Undo');
    opts!.action!.run();
    await tick(10);
    expect((await ctx.store.lexicon.get('b1'))[0].enabled).toBe(true);
  });
});

describe('Add as a word', () => {
  it('turns a 2 to 8 character selection into a word for this book, with the pinyin it already shows', async () => {
    const { ctx, toasts } = await makeCtx();
    const onLexiconChange = vi.fn();
    openPhrasePopup({ ctx, text: '郭靖', anchor: anchorRect(), lexicon: buildLexicon([]), bookId: 'b1', onLexiconChange });
    const open = [...document.querySelectorAll<HTMLElement>('.pp-addword .btn')].find((b) => b.textContent === 'Add as a word…')!;
    open.click();
    const inputs = document.querySelectorAll<HTMLInputElement>('.pp-addword input');
    expect(inputs[0].value).toBe('guo1 jing4');
    type(inputs[1], 'the hero');
    submit(q('.pp-addword form'));
    await tick(10);
    expect(await ctx.store.lexicon.get('b1')).toEqual([{ word: '郭靖', pinyin: 'guo1 jing4', gloss: 'the hero', kind: 'user', enabled: true, origin: 'user' }]);
    expect(await ctx.store.lexicon.get(USER_SCOPE)).toEqual([]);
    expect(onLexiconChange).toHaveBeenCalled();
    expect(toasts.some((t) => t.includes('郭靖'))).toBe(true);
    expect(q('.pp-pop')).toBeNull();
  });

  it('"All books" also saves it for every book', async () => {
    const { ctx } = await makeCtx();
    openPhrasePopup({ ctx, text: '欧阳锋', anchor: anchorRect(), lexicon: buildLexicon([]), bookId: 'b1' });
    [...document.querySelectorAll<HTMLElement>('.pp-addword .btn')].find((b) => b.textContent === 'Add as a word…')!.click();
    const sel = q('.pp-addword select') as HTMLSelectElement;
    sel.value = 'all';
    submit(q('.pp-addword form'));
    await tick(10);
    expect((await ctx.store.lexicon.get(USER_SCOPE)).map((r) => r.word)).toEqual(['欧阳锋']);
  });

  it('is not offered for one character, a long passage, text with punctuation, or a word already in the lexicon', async () => {
    const { ctx } = await makeCtx();
    const lexicon = buildLexicon([entry('郭靖')]);
    for (const t of ['郭', '他说，我们在银行门口见面。', '郭靖，黄蓉', '一二三四五六七八九', '郭靖']) {
      openPhrasePopup({ ctx, text: t, anchor: anchorRect(), lexicon, bookId: 'b1' });
      expect(q('.pp-addword'), t).toBeNull();
      closePopup();
    }
    openPhrasePopup({ ctx, text: '黄蓉', anchor: anchorRect(), lexicon, bookId: 'b1' });
    expect(q('.pp-addword')).not.toBeNull();
    closePopup();
    openPhrasePopup({ ctx, text: '黄蓉', anchor: anchorRect() }); // no book open
    expect(q('.pp-addword')).toBeNull();
  });

  it('a longer word the dictionary lacks offers the same form from the word popup', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '莫远峰', anchor: anchorRect(), lexicon: buildLexicon([]), bookId: 'b1' });
    expect(text('.pp-note')).toContain('not in the dictionary');
    expect(q('.pp-addword')).not.toBeNull();
  });

  it('the phrase popup segments with the lexicon, so a name is one word in the list', async () => {
    const { ctx } = await makeCtx();
    openPhrasePopup({ ctx, text: '郭靖说', anchor: anchorRect(), lexicon: buildLexicon([entry('郭靖')]), bookId: 'b1' });
    const words = [...document.querySelectorAll('.pp-wbw-word')].map((e) => e.textContent);
    expect(words).toEqual(['郭靖', '说']);
  });
});
