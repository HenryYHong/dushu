// @vitest-environment jsdom
// Books made by an older importer are imported again by the library when it can fetch them (src/ui/library/upgrade.ts).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '../../src/store/settings';
import { openStore, type DushuStore } from '../../src/store';
import type { AppContext, BookMeta, ImportedBook } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { mount as mountLibrary } from '../../src/ui/library/library';
import { MAC_NOTE } from '../../src/ui/library/macBooks';
import { IMPORT_VERSION } from '../../src/import/version';

// Public-domain stand-ins for the owner's books.
const LINE = '学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？';
const TEXT = `${LINE}\n\n`.repeat(20);
const SHA = 'a'.repeat(64);
const LIST = [{ id: 'one', name: '论语一.txt', size: TEXT.length, sha256: SHA }];
const SAMPLE_TEXT = '學而時習之，不亦說乎？\n\n有朋自遠方來，不亦樂乎？';
const INDEX = [{ id: 'xue-er', title: '學而', author: '孔子', script: 'traditional', file: 'xue-er.txt', level: 'Beginner', blurb: '' }];

let n = 0;
let store: DushuStore;
let root: HTMLElement;
let ctx: AppContext;
let cleanup: void | (() => void);
let calls: string[];
const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, ms = 8000) {
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await flush(10); }
}

function stubNet(opts: { mac?: boolean } = {}) {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    calls.push(u);
    const ok = (body: string, type = 'text/plain') => ({ ok: true, status: 200, headers: new Headers({ 'content-type': type }), text: async () => body, json: async () => JSON.parse(body), blob: async () => new Blob([body], { type }) });
    if (u.endsWith('samples/index.json')) return ok(JSON.stringify(INDEX), 'application/json');
    if (u.endsWith('samples/xue-er.txt')) return ok(SAMPLE_TEXT);
    if (u.endsWith('/api/local-books')) {
      if (opts.mac === false) throw new TypeError('Failed to fetch');
      return ok(JSON.stringify(LIST), 'application/json');
    }
    if (u.endsWith('/api/local-books/one')) return ok(TEXT);
    return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
  });
}

const p = (text: string) => ({ t: 'p' as const, text });
const paras = Array.from({ length: 20 }, () => p(LINE));
/** The Mac's book as an older importer stored it: cut in two chapters. */
const oldMacBook: ImportedBook = {
  title: '论语一', author: '', format: 'txt', script: 'simplified', sourceName: '论语一.txt',
  chapters: [{ title: '论语一 (1)', blocks: paras.slice(0, 10) }, { title: '论语一 (2)', blocks: paras.slice(10) }], assets: new Map(),
};

beforeEach(async () => {
  localStorage.clear();
  calls = [];
  store = await openStore(`upgrade-${++n}-${Math.random().toString(36).slice(2)}`);
  root = document.createElement('div');
  document.body.appendChild(root);
  const dict = await loadTestDictionary();
  ctx = { dict: () => Promise.resolve(dict), dictSync: () => dict, settings: createSettingsStore(), store, navigate: () => {}, toast: () => {} } as unknown as AppContext;
  vi.stubGlobal('location', { hostname: 'my-mac.example-tailnet.ts.net', protocol: 'https:', origin: 'https://my-mac.example-tailnet.ts.net', search: '', pathname: '/', hash: '' });
}, 30000);

afterEach(() => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  root.remove();
  vi.unstubAllGlobals();
});

const current = async (id: string) => (await store.books.get(id)) as BookMeta;

describe('books from an older importer', () => {
  it('imports the Mac\'s book again from the Mac, in place, with the reading place on the same character', async () => {
    stubNet();
    const meta = await store.books.add(oldMacBook);
    await store.books.update(meta.id, { note: MAC_NOTE + SHA, title: '我的论语' });
    await store.progress.set({ bookId: meta.id, chapter: 1, block: 2, percent: 0.6, updatedAt: 99 });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(async () => (await current(meta.id)).importVersion === IMPORT_VERSION);
    const now = await current(meta.id);
    expect(now).toMatchObject({ id: meta.id, title: '我的论语', note: MAC_NOTE + SHA, chapterCount: 1 });
    expect(await store.books.list()).toHaveLength(1);
    // Block 2 of the old second chapter is paragraph 12 of the whole text.
    expect(await store.progress.get(meta.id)).toEqual({ bookId: meta.id, chapter: 0, block: 12, percent: 0.6, updatedAt: 99 });
  });

  it('imports a classic again from the site', async () => {
    stubNet();
    const meta = await store.books.add({
      title: '學而', author: '孔子', format: 'sample', script: 'traditional', sourceName: 'sample:xue-er',
      chapters: [{ title: '學而', blocks: [p('學而時習之，不亦說乎﹖'), p('有朋自遠方來，不亦樂乎﹖')] }], assets: new Map(),
    });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(async () => (await current(meta.id)).importVersion === IMPORT_VERSION);
    const ch = await store.books.chapter(meta.id, 0);
    expect(ch?.blocks.map((b) => ('text' in b ? b.text : ''))).toEqual(['學而時習之，不亦說乎？', '有朋自遠方來，不亦樂乎？']);
  });

  it('leaves a book added from a file, and waits for the Mac when it does not answer', async () => {
    stubNet({ mac: false });
    const mine = await store.books.add({ ...oldMacBook, title: '自己', sourceName: 'mine.txt' });
    const mac = await store.books.add(oldMacBook);
    await store.books.update(mac.id, { note: MAC_NOTE + SHA });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => calls.some((c) => c.endsWith('/api/local-books')));
    await flush(300);
    expect((await current(mine.id)).importVersion).toBeUndefined();
    expect((await current(mac.id)).importVersion).toBeUndefined();
    expect((await current(mac.id)).chapterCount).toBe(2);
  });

  it('does nothing for a book already made by this importer', async () => {
    stubNet();
    const meta = await store.books.add({ ...oldMacBook, importVersion: IMPORT_VERSION });
    await store.books.update(meta.id, { note: MAC_NOTE + SHA });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => calls.some((c) => c.endsWith('/api/local-books')));
    await flush(300);
    expect(calls.filter((c) => c.endsWith('/api/local-books/one'))).toEqual([]);
    expect((await current(meta.id)).chapterCount).toBe(2);
  });
});
