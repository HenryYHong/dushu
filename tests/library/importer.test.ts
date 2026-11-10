// @vitest-environment jsdom
// The library's importer (ui/library/importer.ts) against a real store: copies of a book already here, and pasted text.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '../../src/store/settings';
import { openStore, type DushuStore } from '../../src/store';
import type { AppContext } from '../../src/types';
import { createImporter, jobStage } from '../../src/ui/library/importer';
import type { Sample } from '../../src/ui/library/samples';
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
    expect(meta && 'title' in meta ? meta.title : '').toBe('Pasted text');
    expect((await store.books.list())[0].title).toBe('Pasted text');
  });
});

describe('a file with bad bytes', () => {
  it('is added, and the notice says how many characters could not be read', async () => {
    const importer = createImporter(ctx, () => {});
    const bytes = new TextEncoder().encode(NOVEL);
    // Two bytes that are not UTF-8 in the middle of a UTF-8 file: the book is still UTF-8, with two characters missing.
    const at = new TextEncoder().encode(NOVEL.slice(0, 40)).length;
    const damaged = new Uint8Array([...bytes.subarray(0, at), 0xff, 0xfe, ...bytes.subarray(at)]);
    const added = await importer.files([new File([damaged], '林冲.txt')]);
    expect(added).toHaveLength(1);
    expect(toasts.map((t) => t.message)).toEqual(['“林冲.txt”: 2 characters could not be read and show as \ufffd.', `Added “${added[0].title}”.`]);
  });
});

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('a classic tapped twice', () => {
  const sample: Sample = { id: 'lin-chong', title: '林冲', author: '施耐庵', script: 'simplified', file: 'lin-chong.txt', level: 'HSK 5', blurb: '' };

  it('is added once, whether the second tap comes while it is being added or after', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', async () => { fetched++; await new Promise((r) => setTimeout(r, 20)); return new Response(NOVEL); });
    let adds = 0;
    const add = store.books.add.bind(store.books);
    store.books.add = async (b) => { adds++; return add(b); };
    const importer = createImporter(ctx, () => {});
    const [a, b] = await Promise.all([importer.sample(sample), importer.sample(sample)]);
    expect(a?.id).toBeDefined();
    expect(b?.id).toBe(a?.id);
    // Added already: the book that is here, not a second one.
    expect((await importer.sample(sample))?.id).toBe(a?.id);
    expect([adds, fetched]).toEqual([1, 1]);
    expect(await store.books.list()).toHaveLength(1);
  });
});

describe('a book downloaded first', () => {
  it('has its card from the start, under the title it was asked for, saying it is downloading', async () => {
    const seen: string[] = [];
    const importer = createImporter(ctx, () => { for (const j of importer.jobs) seen.push(`${j.title}|${j.author}|${jobStage(j)}`); });
    let release!: () => void;
    const got = importer.remote({ title: '水浒传', author: '施耐庵' }, async () => {
      await new Promise<void>((r) => { release = r; });
      return file(NOVEL, 'gutenberg-23863.txt');
    }, { quiet: true });
    expect(seen[0]).toBe('水浒传|施耐庵|Downloading…');
    expect(importer.jobs).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(importer.jobs[0].title).toBe('水浒传');
    release();
    const meta = await got;
    expect(meta?.title).toBeTruthy();
    expect(seen.some((s) => s.endsWith('Starting…') || s.includes('Reading'))).toBe(true);
    // Nothing ever named it by its file.
    expect(seen.some((s) => s.includes('gutenberg-'))).toBe(false);
    expect(toasts).toEqual([]);
  });

  it('says why it could not be added, naming the book, not the file', async () => {
    const importer = createImporter(ctx, () => {});
    const problems: string[] = [];
    const meta = await importer.remote({ title: 'Niebla', author: 'Miguel de Unamuno' }, async () => { throw new Error('That book is too large to add.'); },
      { quiet: true, onProblem: (m) => problems.push(m) });
    expect(meta).toBeNull();
    expect(problems).toEqual(['Could not add “Niebla”. That book is too large to add.']);
  });
});

describe('several files at once', () => {
  const pick = () => [
    file(NOVEL, '林冲.txt'),
    file('', 'empty.txt'),
    file(NOVEL.replace('第三章 夜奔', '第三章 火并'), '林冲二.txt'),
    file('not a book', 'letter.docx'),
    file(NOVEL, 'copy.txt'),
  ];

  it('says what went wrong once, with every file and its reason behind Details', async () => {
    const importer = createImporter(ctx, () => {});
    const added = await importer.files(pick());
    expect(added).toHaveLength(2);
    expect(toasts.map((t) => t.message)).toEqual(['Added 2 books. 3 files could not be added.']);
    expect(toasts[0].action?.label).toBe('Details');
    toasts[0].action!.run();
    const dialog = document.querySelector('dialog')!;
    const rows = [...dialog.querySelectorAll('li')].map((li) => li.querySelector('.lib-find-title')?.textContent);
    expect(rows).toEqual(['empty.txt', 'letter.docx', 'copy.txt']);
    expect(dialog.textContent).toContain('Already in your library as “林冲”.');
    // The copy offers the book already here.
    const open = [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Open')!;
    open.click();
    expect(navigated).toEqual([`/read/${encodeURIComponent(added[0].id)}`]);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('none added: says so', async () => {
    const importer = createImporter(ctx, () => {});
    expect(await importer.files([file('', 'a.txt'), file('', 'b.txt')])).toEqual([]);
    expect(toasts.map((t) => t.message)).toEqual(['None of the 2 files could be added.']);
  });

  it('one problem is said as it always was, and a quiet caller hears each', async () => {
    const importer = createImporter(ctx, () => {});
    await importer.files([file(NOVEL, '林冲.txt'), file('', 'empty.txt')]);
    expect(toasts.map((t) => t.message)).toEqual(['“empty.txt”: This file is empty.', 'Added “林冲”.']);
    toasts.length = 0;
    const heard: string[] = [];
    await importer.files([file('', 'a.txt'), file('', 'b.txt')], { quiet: true, onProblem: (m) => heard.push(m) });
    expect(heard).toHaveLength(2);
    expect(toasts).toEqual([]);
  });
});
