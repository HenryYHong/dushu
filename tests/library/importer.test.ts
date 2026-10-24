// @vitest-environment jsdom
// The library's importer (ui/library/importer.ts) against a real store: copies of a book already here, and pasted text.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSettingsStore } from '../../src/store/settings';
import { openStore, type DushuStore } from '../../src/store';
import type { AppContext } from '../../src/types';
import { createImporter } from '../../src/ui/library/importer';
import { prose } from '../import/helpers';

const NOVEL = `第一章 风雪\n${prose(80)}\n第二章 山神庙\n${prose(80, 1)}\n第三章 夜奔\n${prose(80, 2)}\n`;

let n = 0;
let store: DushuStore;
let toasts: { message: string; action?: { label: string; run: () => void } }[];
let navigated: string[];
let ctx: AppContext;

beforeEach(async () => {
  store = await openStore(`importer-${++n}-${Math.random().toString(36).slice(2)}`);
  toasts = [];
  navigated = [];
  ctx = {
    dict: () => Promise.reject(new Error('not needed')),
    dictSync: () => null,
    settings: createSettingsStore(),
    store,
    navigate: (h: string) => navigated.push(h),
    toast: (message: string, opts?: { action?: { label: string; run: () => void } }) => toasts.push({ message, action: opts?.action }),
  } as unknown as AppContext;
});

const file = (text: string, name: string) => new File([text], name, { type: 'text/plain' });

describe('importing a book that is already in the library', () => {
  it('adds the same file once and offers the copy here the second time', async () => {
    const importer = createImporter(ctx, () => {});
    const [first] = await importer.files([file(NOVEL, '林冲.txt')]);
    expect(first).toBeDefined();
    toasts.length = 0;
    expect(await importer.files([file(NOVEL, '林冲.txt')])).toEqual([]);
    expect(await store.books.list()).toHaveLength(1);
    expect(toasts.map((t) => t.message)).toEqual(['“林冲” is already in your library.']);
    expect(toasts[0].action?.label).toBe('Open');
    toasts[0].action!.run();
    expect(navigated).toEqual([`/read/${encodeURIComponent(first.id)}`]);
  });

  it('finds it after a rename, under another file name, and twice in one pick', async () => {
    const importer = createImporter(ctx, () => {});
    const [first] = await importer.files([file(NOVEL, '林冲.txt')], { quiet: true });
    await store.books.update(first.id, { title: '豹子头' });
    toasts.length = 0;
    expect(await importer.files([file(NOVEL, 'copy of 林冲.txt')], { quiet: true })).toEqual([]);
    expect(toasts.map((t) => t.message)).toEqual(['“豹子头” is already in your library.']);
    // A fresh library: the same file twice in one drop adds one book.
    store = await openStore(`importer-${++n}-${Math.random().toString(36).slice(2)}`);
    ctx = { ...ctx, store };
    const again = createImporter(ctx, () => {});
    expect(await again.files([file(NOVEL, 'a.txt'), file(NOVEL, 'a.txt')], { quiet: true })).toHaveLength(1);
    expect(await store.books.list()).toHaveLength(1);
  });

  it('still adds a different book, and always adds the Mac\'s own copy', async () => {
    const importer = createImporter(ctx, () => {});
    await importer.files([file(NOVEL, '林冲.txt')], { quiet: true });
    const other = NOVEL.replace('第三章 夜奔', '第三章 火并');
    expect(await importer.files([file(other, '林冲二.txt')], { quiet: true })).toHaveLength(1);
    // syncMacBooks adds the Mac's books even beside a copy imported by hand (the Mac rules decide those).
    expect(await importer.files([file(NOVEL, '林冲.txt')], { quiet: true, mac: true })).toHaveLength(1);
    expect(await store.books.list()).toHaveLength(3);
  });
});

describe('pasted text', () => {
  it('is saved under the name its card showed while it was added', async () => {
    const shown: string[] = [];
    const importer = createImporter(ctx, () => { for (const j of importer.jobs) shown.push(j.title); });
    const meta = await importer.text(prose(60), '', '');
    expect(shown[0]).toBe('Pasted text');
    expect(meta?.title).toBe('Pasted text');
    expect((await store.books.list())[0].title).toBe('Pasted text');
  });
});
