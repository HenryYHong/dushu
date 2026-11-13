// @vitest-environment jsdom
// The library page (ui/library/library.ts) for a new reader and from the keyboard: the first-book card stays and says Opening…
// while its classic is added; nothing says "No books yet" while the classics are still coming; offline in a language never
// opened, it says why there are no classics and asks again once back online; the card menu works from the keys and gives focus
// back; buttons and titles are named, and titles carry their language.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '../../src/store/settings';
import { openStore, type DushuStore } from '../../src/store';
import type { AppContext, ImportedBook } from '../../src/types';
import { loadTestDictionary, readDataFile } from '../helpers/data';
import { mount as mountLibrary } from '../../src/ui/library/library';
import { setLangForTests } from '../../src/lang/active';

let n = 0;
const flush = async (ms = 30) => { await new Promise((r) => setTimeout(r, ms)); };
async function until(fn: () => boolean, ms = 4000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await flush(10); }
}

function book(title: string, author = '作者'): ImportedBook {
  return {
    title, author, format: 'txt', script: 'simplified',
    chapters: [{ title: '一', blocks: [{ t: 'p', text: '今天天气很好，我们去公园玩。' }] }],
    assets: new Map(),
  };
}

/** A classic whose list title is traditional, with its simplified form beside it (as public/samples/index.json has them). */
const TANG = { id: 'tang', title: '唐詩八首', author: '李白等', script: 'traditional', file: 'tang.txt', level: 'Beginner', blurb: 'Eight poems.', note: 'Public domain.', simplified: { title: '唐诗八首', author: '李白等' } };
const OTHER = { id: 'gu', title: '小故事', author: '某人', script: 'simplified', file: 'gu.txt', level: 'Intermediate', blurb: 'Short.', note: 'Public domain.' };
const TEXT = '床前明月光，疑是地上霜。举头望明月，低头思故乡。';

let store: DushuStore;
let root: HTMLElement;
let navigated: string[];
let ctx: AppContext;
let cleanup: void | (() => void);

/** Serves the classics list (held until `release` when asked) and their texts (each held until its own release). */
function serve(index: unknown[] | null, opts: { holdIndex?: boolean; holdText?: boolean; offline?: boolean } = {}) {
  const held: (() => void)[] = [];
  const hold = <T>(v: T) => new Promise<T>((r) => held.push(() => r(v)));
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (opts.offline) throw new TypeError('Failed to fetch');
    if (u.endsWith('data/meta.json')) return { ok: true, text: async () => readDataFile('meta.json') };
    if (u.endsWith('index.json') && index) {
      const res = { ok: true, text: async () => JSON.stringify(index) };
      return opts.holdIndex ? hold(res) : res;
    }
    if (/samples\/(?:[a-z]{2}\/)?(tang|gu)\.txt$/.test(u)) {
      const res = { ok: true, text: async () => TEXT };
      return opts.holdText ? hold(res) : res;
    }
    return { ok: false, status: 404, text: async () => '' };
  });
  // Waits for the request to be made first: the importer loads its modules before it asks for the text.
  return { release: async () => { await until(() => held.length > 0, 8000); while (held.length) held.shift()!(); } };
}

const card = (id: string) => root.querySelector<HTMLElement>(`.lib-card[data-id="${id}"]`)!;
const key = (k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(e);
  return e;
};

beforeEach(async () => {
  localStorage.clear();
  setLangForTests('zh');
  store = await openStore(`library-page-${++n}-${Math.random().toString(36).slice(2)}`);
  root = document.createElement('div');
  document.body.appendChild(root);
  navigated = [];
  const dict = await loadTestDictionary();
  ctx = {
    dict: () => Promise.resolve(dict),
    dictSync: () => dict,
    settings: createSettingsStore(),
    store,
    navigate: (h) => navigated.push(h),
    toast: () => {},
  };
  serve(null);
});

afterEach(() => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  root.remove();
  document.querySelectorAll('dialog,.lib-menu').forEach((e) => e.remove());
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setLangForTests(null);
  delete (navigator as unknown as Record<string, unknown>).onLine;
});

describe('the first book', () => {
  it('keeps its card while the classic is added, the button saying Opening…, the title in the reading script', async () => {
    ctx.settings.set({ script: 'simplified' });
    const { release } = serve([TANG, OTHER], { holdText: true });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-start-go'));
    const startCard = root.querySelector('.lib-start')!;
    const go = root.querySelector<HTMLButtonElement>('.lib-start-go')!;
    expect(go.getAttribute('aria-label')).toBe('Start reading “唐诗八首”');
    go.click();
    await flush(100);
    // The same card, not the full library with a pending card.
    expect(root.querySelector('.lib-start')).toBe(startCard);
    expect(go.isConnected).toBe(true);
    expect(go.disabled).toBe(true);
    expect(go.textContent).toBe('Opening…');
    expect(go.getAttribute('aria-label')).toBe('Opening “唐诗八首”');
    expect(root.querySelector('.lib-start-title')!.textContent).toBe('唐诗八首');
    expect(root.querySelector('.lib-card-pending')).toBeNull();
    // Find a book, Paste text and Import book stay in the header even before the first book.
    expect(root.querySelector<HTMLElement>('.page-head .lib-actions')!.hidden).toBe(false);
    await release();
    await until(() => navigated.length > 0, 8000);
  });

  it('names a classic being added from the list, in the reading script, once there are books', async () => {
    ctx.settings.set({ script: 'simplified' });
    await store.books.add(book('故乡', '鲁迅'));
    const { release } = serve([TANG, OTHER], { holdText: true });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => [...root.querySelectorAll('.lib-sample .lib-add')].length === 2);
    const add = [...root.querySelectorAll<HTMLButtonElement>('.lib-sample .lib-add')].find((b) => b.getAttribute('aria-label') === 'Add and read “唐诗八首”')!;
    add.click();
    await until(() => !!root.querySelector('.lib-card-pending'));
    const pending = root.querySelector('.lib-card-pending')!;
    expect(pending.querySelector('.lib-card-title')!.textContent).toBe('唐诗八首');
    expect(pending.querySelector('.lib-cover-title')!.textContent).toBe('唐诗八首');
    expect(pending.querySelector('[role=progressbar]')!.getAttribute('aria-label')).toBe('Adding 唐诗八首');
    await release();
    await until(() => navigated.length > 0, 8000);
  });
});

describe('the empty library while the classics are coming', () => {
  it('shows a quiet placeholder, never "No books yet", and says it only after 2.5 s without them; a late list still brings the first book', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tick = async () => { await new Promise((r) => setImmediate(r)); await vi.advanceTimersByTimeAsync(20); };
    const { release } = serve([TANG], { holdIndex: true });
    cleanup = await mountLibrary(root, {}, ctx);
    for (let i = 0; i < 50 && !root.querySelector('.lib-start-wait'); i++) await tick();
    const wait = root.querySelector<HTMLElement>('.lib-start-wait')!;
    expect(wait).not.toBeNull();
    expect(wait.textContent).toBe('');
    expect(wait.querySelector('button')).toBeNull();
    expect(root.querySelector('.lib-empty')).toBeNull();
    // Blocks where the first book's card will put its cover, title and button, hidden from a screen reader; drawn again while
    // the list is still coming, the card stays as it is (its blocks do not start over).
    expect(wait.querySelector('[aria-hidden="true"] .lib-skel')).not.toBeNull();
    window.dispatchEvent(new Event('offline'));
    expect(root.querySelector('.lib-start-wait')).toBe(wait);
    // Find a book, Paste text and Import book stay in the header even before the first book.
    expect(root.querySelector<HTMLElement>('.page-head .lib-actions')!.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(root.querySelector('.lib-empty')).toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    expect(root.querySelector('.lib-empty-title')?.textContent).toBe('No books yet');
    expect(root.querySelector('.lib-start-wait')).toBeNull();
    await release();
    for (let i = 0; i < 50 && !root.querySelector('.lib-start'); i++) await tick();
    expect(root.querySelector('.lib-start-title')?.textContent).toBe('唐诗八首');
    expect(root.querySelector('.lib-empty')).toBeNull();
  });

  it('offline in a language never opened, says the classics come with a first visit online, and asks again once online', async () => {
    setLangForTests('fr');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    serve([TANG], { offline: true });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-empty'));
    const text = root.querySelector('.lib-empty')!.textContent!;
    expect(text).toContain('You are offline. French classics and the French dictionary download the first time you open French online.');
    // No classics to pick below.
    expect(text).not.toMatch(/classic below/);
    expect(root.querySelector('.lib-empty-title')!.textContent).toBe('No books yet');
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    serve([{ ...TANG, title: 'Contes', author: 'Perrault', simplified: undefined }]);
    window.dispatchEvent(new Event('online'));
    await until(() => !!root.querySelector('.lib-start'));
    expect(root.querySelector('.lib-start-title')!.textContent).toBe('Contes');
    expect(root.querySelector('.lib-empty')).toBeNull();
  });

  it('online with no classics list, says neither "offline" nor "pick a classic below"', async () => {
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-empty'));
    const text = root.querySelector('.lib-empty')!.textContent!;
    expect(text).not.toMatch(/offline|classic below/);
    expect(text).toMatch(/import an EPUB/i);
  });
});

describe('a book card from the keyboard', () => {
  it('moves through the menu with the arrows, says when it is open, closes on Tab, and gives focus back after a dialog', async () => {
    const a = await store.books.add(book('孔乙己'));
    const b = await store.books.add(book('故乡'));
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => root.querySelectorAll('.lib-card').length === 2);
    const btn = card(a.id).querySelector<HTMLButtonElement>('.lib-card-menu')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.focus();
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const items = [...document.querySelectorAll<HTMLElement>('.lib-menu .lib-menu-item')];
    expect(items.map((i) => i.textContent).slice(0, 2)).toEqual(['Rename', 'Delete']);
    expect(items.slice(2).map((i) => i.getAttribute('role'))).toEqual(['menuitemradio', 'menuitemradio', 'menuitemradio']);
    expect(document.activeElement).toBe(items[0]);
    expect(key('ArrowDown').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[1]);
    key('End');
    expect(document.activeElement).toBe(items[4]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    key('ArrowUp');
    expect(document.activeElement).toBe(items[4]);
    key('Home');
    expect(document.activeElement).toBe(items[0]);
    // The menu is still open: moving never scrolled the page shut.
    expect(document.querySelector('.lib-menu')).not.toBeNull();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.querySelector('.lib-menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    // Delete, then Esc in the dialog: focus is back on the book's menu button.
    btn.click();
    key('ArrowDown');
    (document.activeElement as HTMLElement).click();
    await until(() => !!document.querySelector('dialog'));
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    await until(() => document.activeElement === btn);
    expect(await store.books.list()).toHaveLength(2);

    // Delete for real: focus goes to the next book.
    const first = root.querySelector<HTMLElement>('.lib-card')!;
    const firstId = first.dataset.id!;
    const otherId = firstId === a.id ? b.id : a.id;
    first.querySelector<HTMLButtonElement>('.lib-card-menu')!.click();
    [...document.querySelectorAll<HTMLElement>('.lib-menu .lib-menu-item')].find((i) => i.textContent === 'Delete')!.click();
    await until(() => !!document.querySelector('dialog'));
    [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((x) => x.textContent === 'Delete')!.click();
    await until(() => root.querySelectorAll('.lib-card').length === 1);
    await until(() => document.activeElement === card(otherId).querySelector('.lib-card-main'));
  });

  it('after Rename, focus follows the redrawn card to its menu button', async () => {
    const a = await store.books.add(book('旧名'));
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-card-menu'));
    root.querySelector<HTMLElement>('.lib-card-menu')!.click();
    [...document.querySelectorAll<HTMLElement>('.lib-menu-item')].find((i) => i.textContent === 'Rename')!.click();
    await until(() => !!document.querySelector('dialog input'));
    document.querySelector<HTMLInputElement>('dialog input')!.value = '新名';
    [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((x) => x.textContent === 'Save')!.click();
    await until(() => card(a.id)?.querySelector('.lib-card-title')?.textContent === '新名');
    await until(() => document.activeElement === card(a.id).querySelector('.lib-card-menu'));
  });
});

describe('names and languages', () => {
  it('names each classic’s button by its book and marks titles and authors with their language', async () => {
    ctx.settings.set({ script: 'simplified' });
    const added = await store.books.add({ ...book('小故事', '某人'), sourceName: 'sample:gu' });
    serve([TANG, OTHER]);
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-sample .lib-add') && !!root.querySelector('.lib-card'));
    expect([...root.querySelectorAll('.lib-sample .lib-add')].map((b) => b.getAttribute('aria-label'))).toEqual(['Add and read “唐诗八首”']);
    // The classic already added is on the shelf, not in the list.
    expect(root.querySelectorAll('.lib-sample')).toHaveLength(1);
    for (const sel of ['.lib-sample-title', '.lib-sample-author', '.lib-card-title', '.lib-card-author']) {
      expect(root.querySelector(sel)!.getAttribute('lang'), sel).toBe('zh');
    }
    // The card's link is named by what it shows (the titles keep their language), not by an English label over it.
    const link = card(added.id).querySelector('.lib-card-main')!;
    expect(link.hasAttribute('aria-label')).toBe(false);
    expect(link.textContent).toContain('小故事');
    expect(link.textContent).toContain('Not started.');
    expect(link.querySelector('[role=progressbar]')!.getAttribute('aria-hidden')).toBe('true');
    // Traditional characters are marked as such.
    ctx.settings.set({ script: 'traditional' });
    await until(() => root.querySelector('.lib-card-title')!.getAttribute('lang') === 'zh-Hant');
    expect(root.querySelector('.lib-sample-title')!.getAttribute('lang')).toBe('zh-Hant');
  });

  it('marks a Spanish library’s first book as Spanish', async () => {
    setLangForTests('es');
    serve([{ ...OTHER, id: 'selva', title: 'Cuentos de la selva', author: 'Horacio Quiroga', level: 'Beginner', script: 'unknown' }]);
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-start'));
    expect(root.querySelector('.lib-start-title')!.getAttribute('lang')).toBe('es');
    expect(root.querySelector('.lib-start-author')!.getAttribute('lang')).toBe('es');
    expect(root.querySelector('.lib-start-go')!.getAttribute('aria-label')).toBe('Start reading “Cuentos de la selva”');
  });
});
