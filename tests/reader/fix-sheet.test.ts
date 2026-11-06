// @vitest-environment jsdom
// Fixing a word from its card (src/ui/popup/fixView.ts): the pencil opens the Fix sheet (split, join with the word before or after,
// a character's reading, a name), each saved here only or everywhere in the book, with a toast that can undo it; the phrase card's
// "Join as one word…" and "Mark as a name…"; and the "In this book" card's Edit and Not a word saved as fixes. The sentences are
// invented.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { anchorAt } from '../../src/core/fixes';
import { buildLexicon } from '../../src/core/lexicon';
import { bookKey } from '../../src/core/syncKeys';
import type { AppContext, BookMeta, Fix, LexiconEntry } from '../../src/types';
import { closePopup, openPhrasePopup, openWordPopup } from '../../src/ui/popup/popup';
import type { FixTarget } from '../../src/ui/popup/fixView';
import { createBookFixes, type BookFixes } from '../../src/ui/reader/bookFixes';
import { anchorRect, makeCtx, stubBrowser, tick } from './helpers';

beforeAll(() => stubBrowser());
afterEach(() => { closePopup(); document.body.innerHTML = ''; });

const TEXT = '子君说道：先生来了。这家人家很好，子君也来了。';
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const button = (label: string | RegExp) => all('button').find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? '')));
const row = (label: string) => all('.pp-fix-row').find((r) => r.querySelector('.pp-fix-row-label')?.textContent === label);

async function setup() {
  const made = await makeCtx();
  const toast = vi.fn<AppContext['toast']>();
  made.ctx.toast = toast;
  const meta: BookMeta = await made.ctx.store.books.add({
    title: '小说', author: 'T', format: 'paste', script: 'simplified', assets: new Map(),
    chapters: [{ title: '一', blocks: [{ t: 'p', text: TEXT }] }],
  });
  const fixer = createBookFixes(made.ctx, meta);
  await fixer.load();
  return { ...made, meta, fixer, toast };
}

/** The word card for the token at `start` of TEXT, with its neighbors. */
function card(ctx: AppContext, fixer: BookFixes, t: Partial<FixTarget> & { word: string; start: number }, lexicon = buildLexicon([])) {
  const target: FixTarget = { shown: t.word, pinyin: [], at: anchorAt(TEXT, 0, 0, t.start, t.word.length), ...t };
  openWordPopup({ ctx, word: target.shown, reading: target.pinyin, anchor: anchorRect(), lexicon, bookId: fixer.book.id, fix: { fixer, target } });
}

const saved = async (ctx: AppContext) => (await ctx.store.fixes.list()) as Fix[];

describe('the Fix sheet', () => {
  it('opens from the pencil with the fixes that fit the word', async () => {
    const { ctx, fixer } = await setup();
    card(ctx, fixer, { word: '先生', start: 5, pinyin: ['xian1', 'sheng5'], next: { word: '来', shown: '来', pinyin: ['lai2'] } });
    const pencil = q('.pp-fix-btn')!;
    expect(pencil.getAttribute('aria-label')).toBe('Fix this word');
    pencil.click();
    expect(q('.pp-fix-word')?.textContent).toBe('先生');
    expect(all('.pp-fix-row-label').map((e) => e.textContent)).toEqual(['Split', 'Join with next', 'Reading', "It's a name"]);
    expect(row('Join with next')!.querySelector('.pp-fix-row-preview')!.textContent).toBe('先生来');
    // Back is the card again.
    q('.pp-back')!.click();
    expect(q('.pp-fix-btn')).not.toBeNull();
  });

  it('has no pencil without a place on the page, nor for a word that is not Chinese', async () => {
    const { ctx, fixer } = await setup();
    openWordPopup({ ctx, word: '先生', anchor: anchorRect(), bookId: fixer.book.id, fix: { fixer } });
    expect(q('.pp-fix-btn')).toBeNull();
  });

  it('splits a word everywhere in the book, with a live preview and the count of places, and Undo takes it back', async () => {
    const { ctx, fixer, toast } = await setup();
    card(ctx, fixer, { word: '先生', start: 5, pinyin: ['xian1', 'sheng5'] });
    q('.pp-fix-btn')!.click();
    row('Split')!.click();
    const every = await vi.waitFor(() => { const b = button(/^Everywhere in this book \(1 place\)$/); expect(b).toBeTruthy(); return b!; });
    expect((every as HTMLButtonElement).disabled).toBe(true);
    expect(all('.pp-fix-piece')).toHaveLength(1);
    q('.pp-fix-gap')!.click();
    expect(q('.pp-fix-gap')!.getAttribute('aria-pressed')).toBe('true');
    const pieces = all('.pp-fix-piece').map((p) => `${p.querySelector('.pp-fix-piece-word')!.textContent} ${p.querySelector('.pp-py')!.textContent}`);
    expect(pieces).toEqual(['先 xiān', '生 shēng']);
    expect((every as HTMLButtonElement).disabled).toBe(false);
    every.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    const [f] = await saved(ctx);
    expect(f).toMatchObject({ kind: 'cut', word: '先生', cuts: [1], book: fixer.book.key, bookId: fixer.book.id, on: true });
    expect(f.at).toBeUndefined();
    expect(q('.pp-pop')).toBeNull();
    expect(toast.mock.calls[0][0]).toBe('先生 is split into 先 生 everywhere in this book.');
    toast.mock.calls[0][1]!.action!.run();
    await vi.waitFor(async () => expect(await saved(ctx)).toEqual([]));
  });

  it('joins with the next word at this place only, with the meaning the dictionary has', async () => {
    const { ctx, fixer } = await setup();
    card(ctx, fixer, { word: '人', start: 12, pinyin: ['ren2'], prev: { word: '家', shown: '家', pinyin: ['jia1'] }, next: { word: '家', shown: '家', pinyin: ['jia1'] } });
    q('.pp-fix-btn')!.click();
    row('Join with next')!.click();
    expect(q('.pp-fix-joined .pp-word-big')!.textContent).toBe('人家');
    expect(q('.pp-fix-gloss')!.textContent).toBeTruthy(); // a dictionary word: its meaning, no field to type one
    expect(q('.pp-fix-panel input')).toBeNull();
    button('Here only')!.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    const [f] = await saved(ctx);
    expect(f).toMatchObject({ kind: 'word', word: '人家', role: 'user', at: { chapter: 0, block: 0, offset: 12, after: '很好，子君也来' } });
  });

  it('joins with the word before: the place starts where that word does, and the reader can say it is a person', async () => {
    const { ctx, fixer, toast } = await setup();
    card(ctx, fixer, { word: '君', start: 1, pinyin: ['jun1'], prev: { word: '子', shown: '子', pinyin: ['zi3'] } });
    q('.pp-fix-btn')!.click();
    row('Join with previous')!.click();
    expect(q('.pp-fix-joined .pp-word-big')!.textContent).toBe('子君');
    // Not a dictionary word: an optional meaning.
    (q('.pp-fix-panel input') as HTMLInputElement).value = 'the heroine';
    all('.pp-fix-chip').find((c) => c.textContent === 'Person')!.click();
    expect(q('.pp-fix-joined-py')!.textContent).toBe('Zǐjūn');
    button('Here only')!.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    const [f] = await saved(ctx);
    expect(f).toMatchObject({ kind: 'word', word: '子君', role: 'name', gloss: 'the heroine', pinyin: 'zi3 jun1', at: { offset: 0, before: '' } });
    expect(toast.mock.calls[0][0]).toBe('子君 is marked as a person here.');
  });

  it('changes a character\'s reading from its chips, everywhere in the book', async () => {
    const { ctx, fixer, toast } = await setup();
    card(ctx, fixer, { word: '人家', start: 12, pinyin: ['ren2', 'jia1'] });
    q('.pp-fix-btn')!.click();
    row('Reading')!.click();
    const chipsOf = (i: number) => [...all('.pp-fix-read')[i].querySelectorAll<HTMLElement>('.pp-fix-chip')];
    const pressed = (i: number) => chipsOf(i).find((c) => c.getAttribute('aria-checked') === 'true')!.textContent;
    expect(pressed(0)).toBe('rén');
    expect(pressed(1)).toBe('jiā');
    expect(chipsOf(1).map((c) => c.textContent)).toContain('jia');
    const every = button(/^Everywhere in this book/) as HTMLButtonElement;
    expect(every.disabled).toBe(true);
    chipsOf(1).find((c) => c.textContent === 'jia')!.click();
    expect(every.disabled).toBe(false);
    every.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    expect((await saved(ctx))[0]).toMatchObject({ kind: 'reading', word: '人家', pinyin: 'ren2 jia5' });
    expect(toast.mock.calls[0][0]).toBe('人家 reads rén jia everywhere in this book.');
  });

  it('marks a name everywhere in the book, the pinyin written with the surname\'s reading and capitals', async () => {
    const { ctx, fixer, toast } = await setup();
    card(ctx, fixer, { word: '子君', start: 0, pinyin: ['zi3', 'jun1'] });
    q('.pp-fix-btn')!.click();
    row("It's a name")!.click();
    const py = q('.pp-fix-panel input') as HTMLInputElement;
    expect(py.value).toBe('Zǐjūn');
    all('.pp-fix-chip').find((c) => c.textContent === 'Place')!.click();
    expect(py.value).toBe('Zǐjūn');
    all('.pp-fix-chip').find((c) => c.textContent === 'Person')!.click();
    const go = await vi.waitFor(() => { const b = button(/^Mark in this book \(2 places\)$/); expect(b).toBeTruthy(); return b!; });
    // A reading that does not fit is said, not saved.
    py.value = 'zi';
    go.click();
    expect(q('.pp-field-error')!.textContent).toContain('2 characters');
    py.value = 'Zǐ Jūn';
    go.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    expect((await saved(ctx))[0]).toMatchObject({ kind: 'word', word: '子君', role: 'name', pinyin: 'zi3 jun1', n: 2 });
    expect(toast.mock.calls[0][0]).toBe('子君 is marked as a person (2 places in the book).');
  });

  it('counts a split or a reading as "up to" the places of the word: the page may show it inside a longer word', async () => {
    const { ctx, fixer } = await setup();
    card(ctx, fixer, { word: '子君', start: 0, pinyin: ['zi3', 'jun1'] });
    q('.pp-fix-btn')!.click();
    row('Split')!.click();
    await vi.waitFor(() => expect(button(/^Everywhere in this book \(up to 2 places\)$/)).toBeTruthy());
    row("It's a name")!.click();
    await vi.waitFor(() => expect(button(/^Mark in this book \(2 places\)$/)).toBeTruthy());
  });

  it('offers no name for one character, and a fix the store cannot keep is said, not toasted as done', async () => {
    const { ctx, fixer, toast } = await setup();
    card(ctx, fixer, { word: '来', start: 7, pinyin: ['lai2'] });
    q('.pp-fix-btn')!.click();
    expect(row("It's a name")).toBeUndefined();
    await expect(fixer.save({ id: 'y', book: fixer.book.key, bookId: fixer.book.id, kind: 'word', word: '来', role: 'name', pinyin: 'lai2', on: true, t: 1 } as Fix))
      .rejects.toThrow('Globereader cannot keep that correction.');
    expect(await saved(ctx)).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
  });

  it('lists the reader\'s fixes of the word and removes one', async () => {
    const { ctx, fixer, toast } = await setup();
    await fixer.save({ id: 'x', book: fixer.book.key, bookId: fixer.book.id, kind: 'cut', word: '先生', cuts: [1], on: true, t: 1 } as Fix);
    await fixer.load();
    card(ctx, fixer, { word: '先生', start: 5, pinyin: ['xian1', 'sheng5'] });
    q('.pp-fix-btn')!.click();
    expect(q('.pp-fix-have')!.textContent).toContain('Split, everywhere');
    button('Remove')!.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toEqual([]));
    expect(toast.mock.calls[0][0]).toBe('Your correction of 先生 is deleted.');
  });
});

describe('the phrase card', () => {
  it('joins a selection as one word: here, everywhere in the book or in all books', async () => {
    const { ctx, fixer, toast } = await setup();
    const target: FixTarget = { word: '子君', shown: '子君', pinyin: ['zi3', 'jun1'], at: anchorAt(TEXT, 0, 0, 0, 2) };
    openPhrasePopup({ ctx, text: '子君', anchor: anchorRect(), lexicon: buildLexicon([]), bookId: fixer.book.id, fix: { fixer, target } });
    expect(all('.pp-fix-open').map((b) => b.textContent)).toEqual(['Join as one word…', 'Mark as a name…']);
    button('Join as one word…')!.click();
    expect((q('.pp-fix-phrase input') as HTMLInputElement).value).toBe('zi3 jun1');
    button('In all my books')!.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    expect((await saved(ctx))[0]).toMatchObject({ kind: 'word', word: '子君', book: '*', bookId: '*' });
    expect(toast.mock.calls[0][0]).toBe('子君 is one word in all your books.');
  });

  it('marks a selection as a name', async () => {
    const { ctx, fixer } = await setup();
    const target: FixTarget = { word: '子君', shown: '子君', pinyin: ['zi3', 'jun1'], at: anchorAt(TEXT, 0, 0, 0, 2) };
    openPhrasePopup({ ctx, text: '子君', anchor: anchorRect(), lexicon: buildLexicon([]), bookId: fixer.book.id, fix: { fixer, target } });
    button('Mark as a name…')!.click();
    const go = await vi.waitFor(() => { const b = button(/^Mark in this book/); expect(b?.textContent).toContain('2 places'); return b!; });
    go.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    expect((await saved(ctx))[0]).toMatchObject({ kind: 'word', role: 'name', word: '子君', book: fixer.book.key });
  });

  it('starts a selection that crosses the page\'s words from one syllable a character, and joins it here too when saved for the book', async () => {
    const { ctx, fixer, toast } = await setup();
    // 这家人家 cut 这|家人|家 on the page: the selection 人家 starts inside 家人, and only its 人 has a reading from that word.
    const target: FixTarget = { word: '人家', shown: '人家', pinyin: ['ren2'], at: anchorAt(TEXT, 0, 0, 12, 2), crosses: true };
    openPhrasePopup({ ctx, text: '人家', anchor: anchorRect(), lexicon: buildLexicon([]), bookId: fixer.book.id, fix: { fixer, target } });
    button('Join as one word…')!.click();
    const py = q('.pp-fix-phrase input') as HTMLInputElement;
    expect(py.value.split(' ')).toHaveLength(2);
    const every = await vi.waitFor(() => { const b = button(/^Everywhere in this book \(1 place\)$/); expect(b).toBeTruthy(); return b!; });
    py.value = 'ren2 jia1';
    every.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(2));
    const got = await saved(ctx);
    expect(got.find((f) => !f.at)).toMatchObject({ kind: 'word', word: '人家', pinyin: 'ren2 jia1', book: fixer.book.key });
    expect(got.find((f) => f.at)).toMatchObject({ kind: 'word', word: '人家', at: { offset: 12 } });
    // One Undo takes both away.
    toast.mock.calls[0][1]!.action!.run();
    await vi.waitFor(async () => expect(await saved(ctx)).toEqual([]));
  });

  it('takes a name as the card writes it, and asks for the tones when none are typed', async () => {
    const { ctx, fixer } = await setup();
    const target: FixTarget = { word: '先生来', shown: '先生来', pinyin: ['xian1', 'sheng5', 'lai2'], at: anchorAt(TEXT, 0, 0, 5, 3) };
    openPhrasePopup({ ctx, text: '先生来', anchor: anchorRect(), lexicon: buildLexicon([]), bookId: fixer.book.id, fix: { fixer, target } });
    button('Mark as a name…')!.click();
    const py = q('.pp-fix-phrase input') as HTMLInputElement;
    // The form's first field has the focus (its buttons are scrolled into the card's view).
    expect(document.activeElement).toBe(py);
    const go = await vi.waitFor(() => { const b = button(/^Mark in this book/); expect(b).toBeTruthy(); return b!; });
    py.value = 'xian sheng lai';
    go.click();
    expect(q('.pp-field-error')!.textContent).toBe('Add the tones, as marks or numbers, like Guō Jìng or guo1 jing4.');
    // A surname and a given name written together, the way the form writes a three-character name.
    py.value = 'Xiān Shēnglái';
    go.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    expect((await saved(ctx))[0]).toMatchObject({ kind: 'word', word: '先生来', pinyin: 'xian1 sheng1 lai2', role: 'name' });
  });

  it('offers nothing for a selection that is already a name of the book', async () => {
    const { ctx, fixer } = await setup();
    const target: FixTarget = { word: '子君', shown: '子君', pinyin: ['zi3', 'jun1'] };
    const lex = buildLexicon([{ word: '子君', pinyin: 'zi3 jun1', gloss: '', kind: 'name', enabled: true, origin: 'auto' }]);
    openPhrasePopup({ ctx, text: '子君', anchor: anchorRect(), lexicon: lex, bookId: fixer.book.id, fix: { fixer, target } });
    expect(q('.pp-fix-open')).toBeNull();
  });
});

describe('the In this book card saves fixes', () => {
  const entry: LexiconEntry = { word: '郭靖', pinyin: 'guo2 jing4', gloss: 'name (person)', kind: 'name', count: 12, enabled: true, origin: 'auto' };

  it('Edit becomes a word fix of the book, which syncs', async () => {
    const { ctx, fixer, meta } = await setup();
    const onLexiconChange = vi.fn();
    openWordPopup({ ctx, word: '郭靖', anchor: anchorRect(), lexicon: buildLexicon([entry]), bookId: meta.id, onLexiconChange, fix: { fixer } });
    button('Edit')!.click();
    (q('.pp-lex-form input') as HTMLInputElement).value = 'guo1 jing4';
    q('.pp-lex-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    expect((await saved(ctx))[0]).toMatchObject({ kind: 'word', word: '郭靖', pinyin: 'guo1 jing4', role: 'name', book: bookKey(meta) });
    expect(await ctx.store.lexicon.get(meta.id)).toEqual([]);
  });

  it('Not a word becomes an "unword" fix, and Undo takes it away', async () => {
    const { ctx, fixer, meta, toast } = await setup();
    openWordPopup({ ctx, word: '郭靖', anchor: anchorRect(), lexicon: buildLexicon([entry]), bookId: meta.id, fix: { fixer } });
    button('Not a word')!.click();
    await vi.waitFor(async () => expect(await saved(ctx)).toHaveLength(1));
    expect((await saved(ctx))[0]).toMatchObject({ kind: 'unword', word: '郭靖' });
    await tick();
    toast.mock.calls[0][1]!.action!.run();
    await vi.waitFor(async () => expect(await saved(ctx)).toEqual([]));
  });
});
