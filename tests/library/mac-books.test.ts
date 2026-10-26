// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '../../src/store/settings';
import { openStore, type DushuStore } from '../../src/store';
import type { AppContext, BookMeta } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { mount as mountLibrary } from '../../src/ui/library/library';
import { createImporter } from '../../src/ui/library/importer';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MAC_NOTE, addedMessage, planMacBooks } from '../../src/ui/library/macBooks';

// Public-domain stand-ins for the owner's books: only the names, digests and sizes matter to the sync.
const TEXT = '学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？\n\n'.repeat(20);
const LIST = [
  { id: 'one', name: '论语一.txt', size: TEXT.length, sha256: 'a'.repeat(64) },
  { id: 'two', name: '论语二.txt', size: TEXT.length, sha256: 'b'.repeat(64) },
];
const PRIVATE_ORIGIN = 'https://my-mac.example-tailnet.ts.net';

let n = 0;
let store: DushuStore;
let root: HTMLElement;
let toasts: string[];
let ctx: AppContext;
let cleanup: void | (() => void);
let calls: string[];
const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 6000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await flush(10); }
}

/** A Mac that answers the book routes. `status` 0 means the request fails like an unreachable host. */
function stubMac(opts: { list?: unknown; status?: number } = {}) {
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('data/meta.json') || u.includes('samples/')) return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
    if (opts.status === 0) throw new TypeError('Failed to fetch');
    if (u.endsWith('/api/local-books')) {
      const status = opts.status ?? 200;
      return { ok: status === 200, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => opts.list ?? LIST };
    }
    const m = /\/api\/local-books\/(\w+)$/.exec(u);
    const item = m && LIST.find((b: { id: string }) => b.id === m[1]);
    if (item) return { ok: true, status: 200, headers: new Headers(), blob: async () => new Blob([TEXT], { type: 'text/plain' }) };
    return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
  });
}
const onPrivateSite = () => vi.stubGlobal('location', { hostname: 'my-mac.example-tailnet.ts.net', protocol: 'https:', origin: PRIVATE_ORIGIN, search: '', pathname: '/', hash: '' });
const onPublicSite = () => vi.stubGlobal('location', { hostname: 'henryyhong.com', protocol: 'https:', origin: 'https://henryyhong.com', search: '', pathname: '/dushu/', hash: '' });
const titles = async () => (await store.books.list()).map((b) => b.sourceName).sort();

async function openLibrary() {
  cleanup = await mountLibrary(root, {}, ctx);
}

beforeEach(async () => {
  localStorage.clear();
  calls = [];
  store = await openStore(`mac-${++n}-${Math.random().toString(36).slice(2)}`);
  root = document.createElement('div');
  document.body.appendChild(root);
  // Each test's toasts go to its own list: a library from an earlier test that finishes late cannot add to this one.
  const sink: string[] = (toasts = []);
  const dict = await loadTestDictionary();
  ctx = {
    dict: () => Promise.resolve(dict), dictSync: () => dict, settings: createSettingsStore(), store,
    navigate: () => {}, toast: (m: string) => sink.push(m),
  } as unknown as AppContext;
  stubMac();
}, 30000);

afterEach(() => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  root.remove();
  document.querySelectorAll('dialog,.lib-menu').forEach((e) => e.remove());
  vi.unstubAllGlobals();
});

const meta = (over: Partial<BookMeta>): BookMeta => ({
  id: 'x', title: 'x', author: '', format: 'epub', script: 'simplified', addedAt: 1, chapterCount: 1, charCount: 1, chapterOffsets: [0], ...over,
});

describe('planMacBooks', () => {
  it('asks for what is missing, by digest or file name', () => {
    const have = [meta({ id: 'a', sourceName: '论语一.txt', note: MAC_NOTE + 'a'.repeat(64) })];
    const plan = planMacBooks(LIST, have);
    expect(plan.missing.map((b) => b.id)).toEqual(['two']);
    expect(plan.mark).toEqual([]);
  });
  it('marks a copy added by hand instead of adding it again', () => {
    const plan = planMacBooks(LIST, [meta({ id: 'a', sourceName: '论语二.txt' })]);
    expect(plan.missing.map((b) => b.id)).toEqual(['one']);
    expect(plan.mark).toEqual([{ id: 'a', note: MAC_NOTE + 'b'.repeat(64) }]);
  });
  it('words the toast for one, two and many books', () => {
    expect(addedMessage([meta({ title: '甲' })])).toBe('Added “甲” from your Mac.');
    expect(addedMessage([meta({ title: '甲' }), meta({ title: '乙' })])).toBe('Added “甲” and “乙” from your Mac.');
    // In the reading script, as the library cards show them.
    const simplified = (t: string) => t.replace('紅樓夢', '红楼梦').replace('論語', '论语');
    expect(addedMessage([meta({ title: '紅樓夢' })], simplified)).toBe('Added “红楼梦” from your Mac.');
    expect(addedMessage([meta({ title: '紅樓夢' }), meta({ title: '論語' })], simplified)).toBe('Added “红楼梦” and “论语” from your Mac.');
    expect(addedMessage([meta({}), meta({}), meta({})])).toBe('Added 3 books from your Mac.');
  });
});

describe('owner books on the library screen', () => {
  it('adds the Mac books on its own, once, with one quiet toast', async () => {
    onPrivateSite();
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { ...navigator, storage: { persist } });
    await openLibrary();
    await until(() => toasts.length > 0);
    expect(root.querySelectorAll('.lib-card')).toHaveLength(2);
    expect(toasts).toEqual(['Added “论语一” and “论语二” from your Mac.']);
    expect(persist).toHaveBeenCalled();
    const books = await store.books.list();
    expect(books.map((b) => b.note).sort()).toEqual([MAC_NOTE + 'a'.repeat(64), MAC_NOTE + 'b'.repeat(64)]);
    // Opening the library again adds nothing.
    cleanup?.(); root.replaceChildren(); toasts.length = 0; calls.length = 0;
    await openLibrary();
    await until(() => calls.includes('/api/local-books'));
    await flush(200);
    expect(await titles()).toEqual(['论语一.txt', '论语二.txt']);
    expect(calls.filter((c) => /local-books\/\w+$/.test(c))).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it('picking the Mac\'s file by hand does not make a second card', async () => {
    onPrivateSite();
    await openLibrary();
    await until(() => toasts.length > 0);
    toasts.length = 0;
    const importer = createImporter(ctx, () => {});
    const added = await importer.files([new File([TEXT], '论语一.txt', { type: 'text/plain' })]);
    expect(added).toEqual([]);
    expect(await titles()).toEqual(['论语一.txt', '论语二.txt']);
    expect(toasts).toEqual(['“论语一” is already in your library from your Mac.']);
    // Any other file still imports.
    const other = await importer.files([new File([TEXT], '别的.txt', { type: 'text/plain' })], { quiet: true });
    expect(other).toHaveLength(1);
    expect((await store.books.list())).toHaveLength(3);
  });

  it('offers no Delete for the Mac\'s books, and adds one back that went missing', async () => {
    onPrivateSite();
    await openLibrary();
    await until(() => toasts.length > 0 && root.querySelectorAll('.lib-card').length === 2);
    const card = root.querySelector<HTMLElement>('.lib-card[data-id]')!;
    card.querySelector<HTMLElement>('.lib-card-menu')!.click();
    const items = [...document.querySelectorAll<HTMLElement>('.lib-menu-item[role="menuitem"]')].map((b) => b.textContent);
    expect(items).toEqual(['Rename']);
    document.querySelectorAll('.lib-menu').forEach((e) => e.remove());

    // The browser cleared it (or an older version deleted it): the next visit adds it again.
    const gone = (await store.books.get(card.dataset.id!))!;
    await store.books.remove(gone.id);
    cleanup?.(); root.replaceChildren(); toasts.length = 0;
    await openLibrary();
    await until(() => toasts.length > 0);
    expect(await titles()).toEqual(['论语一.txt', '论语二.txt']);
    expect(toasts).toEqual([`Added “${gone.title}” from your Mac.`]);
  });

  it('still offers Delete for a book that is not from the Mac', async () => {
    onPrivateSite();
    await store.books.add({ title: '自己', author: '', format: 'txt', script: 'simplified', sourceName: 'mine.txt',
      chapters: [{ title: '自己', blocks: [{ t: 'p', text: '学而时习之，不亦说乎？' }] }], assets: new Map() });
    await openLibrary();
    await until(() => toasts.length > 0 && root.querySelectorAll('.lib-card').length === 3);
    const mine = [...root.querySelectorAll<HTMLElement>('.lib-card')].find((c) => c.textContent?.includes('自己'))!;
    mine.querySelector<HTMLElement>('.lib-card-menu')!.click();
    expect([...document.querySelectorAll<HTMLElement>('.lib-menu-item[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Rename', 'Delete']);
  });

  it('syncs on the public copy once the device is connected, using the Mac address', async () => {
    onPublicSite();
    localStorage.setItem('dushu.mac-bridge.v1', PRIVATE_ORIGIN);
    await openLibrary();
    await until(() => root.querySelectorAll('.lib-card').length === 2);
    expect(calls).toContain(`${PRIVATE_ORIGIN}/api/local-books`);
    expect(root.querySelector('.lib-mac-note')!.hasAttribute('hidden')).toBe(true);
  });

  it('explains the public copy and sends no Mac request when not connected', async () => {
    onPublicSite();
    await openLibrary();
    await until(() => !root.querySelector<HTMLElement>('.lib-mac-note')!.hidden);
    expect(root.querySelector('.lib-mac-note')!.textContent).toMatch(/public copy.*Sign in with your email/);
    expect([...root.querySelectorAll<HTMLElement>('.lib-mac-note .btn')].map((b) => b.textContent)).toEqual(['Sign in', 'Dismiss']);
    await flush(100);
    expect(calls.filter((c) => c.includes('local-books'))).toEqual([]);
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Add books from Mac')!;
    expect(button.hidden).toBe(true);
    // Dismissing is remembered.
    [...root.querySelectorAll<HTMLElement>('.lib-mac-note .btn')].find((b) => b.textContent === 'Dismiss')!.click();
    expect(root.querySelector<HTMLElement>('.lib-mac-note')!.hidden).toBe(true);
  });

  it('says so when the connected Mac does not answer, and retries on request', async () => {
    onPublicSite();
    localStorage.setItem('dushu.mac-bridge.v1', PRIVATE_ORIGIN);
    stubMac({ status: 0 });
    await openLibrary();
    await until(() => !root.querySelector<HTMLElement>('.lib-mac-note')!.hidden);
    expect(root.querySelector('.lib-mac-note')!.textContent).toMatch(/did not answer/);
    stubMac();
    [...root.querySelectorAll<HTMLElement>('.lib-mac-note .btn')].find((b) => b.textContent === 'Try again')!.click();
    await until(() => root.querySelectorAll('.lib-card').length === 2);
  });

  it('says nothing about a Mac that does not answer once signed in: the account brings the books', async () => {
    onPublicSite();
    localStorage.setItem('dushu.mac-bridge.v1', PRIVATE_ORIGIN);
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 'a'.repeat(64) + '.x', email: 'reader@example.com' }));
    stubMac({ status: 0 });
    await openLibrary();
    await until(() => calls.some((c) => c.includes('local-books')));
    await flush(100);
    expect(root.querySelector<HTMLElement>('.lib-mac-note')!.hidden).toBe(true);
  });

  it('says so when the Mac refuses this device', async () => {
    onPublicSite();
    localStorage.setItem('dushu.mac-bridge.v1', PRIVATE_ORIGIN);
    stubMac({ status: 403 });
    await openLibrary();
    await until(() => /did not accept/.test(root.querySelector('.lib-mac-note')!.textContent ?? ''));
    expect(await store.books.list()).toEqual([]);
  });

  it('adds a book an older version left out on its removed list, and forgets that list', async () => {
    onPrivateSite();
    localStorage.setItem('dushu.mac-books.removed.v1', JSON.stringify([{ name: '论语一.txt' }]));
    await openLibrary();
    await until(() => toasts.length > 0);
    expect(toasts).toEqual(['Added “论语一” and “论语二” from your Mac.']);
    expect(localStorage.getItem('dushu.mac-books.removed.v1')).toBeNull();
    const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Add books from Mac')!;
    await until(() => !button.hidden);
    toasts.length = 0;
    button.click();
    await until(() => toasts.length > 0);
    expect(toasts).toEqual(['The books on your Mac are already in your library.']);
  });
});

// The public bundle is built from src/ui: no screen there may name the owner's private books.
describe('public bundle', () => {
  it('no screen text names the owner books', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const bad = walk(join(__dirname, '..', '..', 'src', 'ui')).filter((f) => /活着|射雕/.test(strip(readFileSync(f, 'utf8'))));
    expect(bad).toEqual([]);
  });
});
