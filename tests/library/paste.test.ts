// @vitest-environment jsdom
// Paste text (ui/library/paste.ts) and how the importer keeps pasted text (importer.ts text): the same text pasted again is the
// book already here, a different text of the same length is not, and each pasted text has a key of its own (syncKeys bookKey).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsStore } from '../../src/store/settings';
import { openStore, type DushuStore } from '../../src/store';
import type { AppContext, BookMeta } from '../../src/types';
import { createImporter } from '../../src/ui/library/importer';
import { headingHint, pasteDialog } from '../../src/ui/library/paste';
import { bookKey } from '../../src/core/syncKeys';
import { setLangForTests } from '../../src/lang/active';

let store: DushuStore;
let ctx: AppContext;

beforeEach(async () => {
  store = await openStore(`paste-${Math.random().toString(36).slice(2)}`);
  ctx = {
    dict: () => Promise.reject(new Error('not needed')),
    dictSync: () => null,
    settings: createSettingsStore(),
    store,
    navigate: () => {},
    toast: () => {},
  } as unknown as AppContext;
});
afterEach(() => { setLangForTests('zh'); document.body.replaceChildren(); });

const isTwin = (v: unknown): v is { twin: BookMeta } => !!v && typeof v === 'object' && 'twin' in v;

describe('the same text pasted twice', () => {
  it('is the book already here, under any title', async () => {
    const importer = createImporter(ctx, () => {});
    const text = '我今天去学校上课了。老师讲了一个很长的故事。';
    const first = await importer.text(text, '', '');
    expect(first && !isTwin(first) ? first.sourceName : '').toMatch(/^paste:[a-z0-9]+$/);
    const again = await importer.text(`\n${text}\n`, '另一个名字', '');
    expect(isTwin(again) && !isTwin(first) && again.twin.id === first?.id).toBe(true);
    expect(await store.books.list()).toHaveLength(1);
  });

  it('is found by its chapters when it was pasted before pasted text had a name of its own', async () => {
    const importer = createImporter(ctx, () => {});
    const text = '他昨天在家里看书呢。外面下着大雨。';
    const first = await importer.text(text, '', '');
    if (!first || isTwin(first)) throw new Error('not added');
    await store.books.update(first.id, { sourceName: undefined });
    const again = await importer.text(text, '', '');
    expect(isTwin(again) && again.twin.id === first.id).toBe(true);
  });

  it('a different text of the same length is another book, with another key', async () => {
    const importer = createImporter(ctx, () => {});
    // Nine Han characters each: the shape (chapters and size) alone cannot tell them apart.
    const a = await importer.text('我今天去学校上课了。', '', '');
    const b = await importer.text('他昨天在家里看书呢。', '', '');
    expect(isTwin(a) || isTwin(b) || !a || !b).toBe(false);
    const [x, y] = await store.books.list();
    expect(x.charCount).toBe(y.charCount);
    expect(bookKey(x)).not.toBe(bookKey(y));
    expect(bookKey(x)).toMatch(/^t[a-z0-9]+$/);
  });
});

describe('the paste dialog', () => {
  it('names a chapter heading in every language, English too', () => {
    expect(headingHint('en')).toBe('Chapters are detected from headings like Chapter 1.');
    expect(headingHint('es')).toBe('Chapters are detected from headings like Capítulo 1.');
    setLangForTests('en');
    void pasteDialog(async () => null);
    expect(document.querySelector('.lib-paste-hint')?.textContent).toBe('Chapters are detected from headings like Chapter 1.');
  });

  it('offers to open the book when the text is already there', async () => {
    const here = { id: 'b1', title: 'Pasted text' } as BookMeta;
    const opened = pasteDialog(async () => ({ twin: here }), { text: '我今天去学校上课了。' });
    const go = [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((b) => b.textContent === 'Add to library')!;
    go.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.lib-paste-hint')?.textContent).toBe('This text is already in your library as “Pasted text”.');
    expect(go.textContent).toBe('Open it');
    go.click();
    expect(await opened).toBe(here);
  });
});
