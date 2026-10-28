// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore, DEFAULT_SETTINGS } from '../../src/store/settings';
import { openStore, type DushuStore } from '../../src/store';
import type { AppContext, ImportedBook } from '../../src/types';
import { loadTestDictionary, readDataFile } from '../helpers/data';
import { mount as mountLibrary } from '../../src/ui/library/library';
import { bookKey } from '../../src/core/syncKeys';
import { mount as mountSettings } from '../../src/ui/settings/settings';
import { mount as mountAbout } from '../../src/ui/about/about';
import { renderPreview, showsPinyin } from '../../src/ui/settings/preview';
import { autoPick, statusText } from '../../src/ui/settings/translation';
import { backupFileName, describeReport } from '../../src/ui/settings/data';
import { coverageStats } from '../../src/ui/about/about';

let n = 0;
// jsdom's Blob has no text(); browsers do.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(this);
    });
  };
}
const flush = async (ms = 30) => { await new Promise((r) => setTimeout(r, ms)); };
async function until(fn: () => boolean, ms = 3000) {
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

/**
 * Each screen's title is one h1: the Chinese name first, as real text in lang="zh-Hans" but hidden from screen readers,
 * then the English title, which is what a screen reader announces.
 */
function expectPageHead(zh: string, en: string): void {
  const h1s = root.querySelectorAll('h1');
  expect(h1s).toHaveLength(1);
  const h1 = h1s[0];
  expect(h1.classList.contains('page-title')).toBe(true);
  const kicker = h1.querySelector<HTMLElement>('.page-title-zh')!;
  expect(kicker.textContent).toBe(zh);
  expect(kicker.getAttribute('lang')).toBe('zh-Hans');
  expect(kicker.getAttribute('aria-hidden')).toBe('true');
  expect(h1.firstElementChild).toBe(kicker); // Chinese first
  const spoken = [...h1.childNodes].filter((n) => !(n instanceof HTMLElement && n.getAttribute('aria-hidden') === 'true')).map((n) => n.textContent).join('').trim();
  expect(spoken).toBe(en);
}

let store: DushuStore;
let root: HTMLElement;
let toasts: string[];
let navigated: string[];
let ctx: AppContext;
let cleanup: void | (() => void);

beforeEach(async () => {
  localStorage.clear();
  store = await openStore(`screens-${++n}-${Math.random().toString(36).slice(2)}`);
  root = document.createElement('div');
  document.body.appendChild(root);
  toasts = [];
  navigated = [];
  const dict = await loadTestDictionary();
  ctx = {
    dict: () => Promise.resolve(dict),
    dictSync: () => dict,
    settings: createSettingsStore(),
    store,
    navigate: (h) => navigated.push(h),
    toast: (m) => toasts.push(m),
  };
  // Samples absent by default; meta.json served from disk.
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).endsWith('data/meta.json')) return { ok: true, text: async () => readDataFile('meta.json') };
    return { ok: false, text: async () => '' };
  });
});

afterEach(() => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  root.remove();
  document.querySelectorAll('dialog,.lib-menu').forEach((e) => e.remove());
  vi.unstubAllGlobals();
});

describe('library screen', () => {
  it('offers private Mac book import even when the iPad library is empty', async () => {
    vi.stubGlobal('location', { hostname: 'my-mac.private.ts.net', protocol: 'https:', origin: 'https://my-mac.private.ts.net', search: '' });
    vi.stubGlobal('fetch', async (url: string) => url === '/api/local-books'
      ? { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => [{ id: 'huozhe', name: '活着.epub' }] }
      : { ok: false, status: 404, text: async () => '' });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-empty'));
    const button = [...root.querySelectorAll('button')].find(b => b.textContent === 'Add books from Mac')!;
    await until(() => !button.hidden);
    expect(button.closest('.lib-empty')).not.toBeNull();
    expect(button.closest('[hidden]')).toBeNull();
  });
  it('shows the empty state, with no classics section when the index is missing', async () => {
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-empty'));
    expectPageHead('书架', 'Library');
    expect(root.querySelector('.lib-empty-title')?.textContent).toBe('No books yet');
    await flush(50);
    expect(root.querySelector('.lib-samples')?.children.length).toBe(0);
  });

  it('tells a phone or tablet to tap twice for a sentence, not to drop a file or drag', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: none)', media: q, addEventListener() {}, removeEventListener() {} }));
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-empty'));
    const text = root.querySelector('.lib-empty')!.textContent!;
    expect(text).toContain('tap it twice for the whole sentence');
    expect(text).not.toMatch(/Drop a file|drag across/);
  });

  it('lists books, marks the most recent as Continue, and shows progress', async () => {
    const a = await store.books.add(book('孔乙己'));
    const b = await store.books.add(book('故乡'));
    await store.books.update(b.id, { lastOpenedAt: Date.now() });
    await store.progress.set({ bookId: b.id, chapter: 0, block: 0, percent: 0.42, updatedAt: Date.now() });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => root.querySelectorAll('.lib-card').length === 2);
    expect(root.querySelector('.lib-continue-title')?.textContent).toBe('故乡');
    expect(root.querySelector('.lib-continue-go')?.getAttribute('href')).toBe(`#/read/${b.id}`);
    const cards = [...root.querySelectorAll('.lib-card')];
    const forB = cards.find((c) => c.getAttribute('data-id') === b.id)!;
    expect(forB.textContent).toContain('42%');
    expect(cards.find((c) => c.getAttribute('data-id') === a.id)!.textContent).toContain('Not started');
    expect((root.querySelector('.lib-empty') as HTMLElement | null)).toBeNull();
  });

  it('shows titles in the characters the reader chose, simplified by default', async () => {
    const b = await store.books.add(book('西遊記', '〔明〕吳承恩'));
    cleanup = await mountLibrary(root, {}, ctx);
    const title = () => root.querySelector(`.lib-card[data-id="${b.id}"] .lib-card-title`)?.textContent;
    await until(() => title() === '西游记');
    ctx.settings.set({ script: 'original' });
    await until(() => title() === '西遊記');
    ctx.settings.set({ script: 'simplified' });
  });

  it('gives a classic a thread-bound cover and a modern book a contemporary one, and the card menu changes it', async () => {
    const old = await store.books.add(book('西遊記', '〔明〕吳承恩'));
    const modern = await store.books.add(book('故乡', '鲁迅'));
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => root.querySelectorAll('.lib-card').length === 2);
    const coverOf = (id: string) => root.querySelector(`.lib-card[data-id="${id}"] .lib-cover`)!;
    expect(coverOf(old.id).classList.contains('lib-cover-classic')).toBe(true);
    expect(coverOf(modern.id).classList.contains('lib-cover-modern')).toBe(true);
    const card = root.querySelector<HTMLElement>(`.lib-card[data-id="${old.id}"]`)!;
    card.querySelector<HTMLElement>('.lib-card-menu')!.click();
    const choices = [...document.querySelectorAll<HTMLElement>('.lib-menu [role="group"] [role="menuitemradio"]')];
    expect(document.querySelector('.lib-menu [role="group"]')?.getAttribute('aria-label')).toBe('Cover');
    expect(choices.map((c) => c.textContent)).toEqual(['Automatic (Classic)', 'Classic', 'Modern']);
    expect(choices.map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    choices[2].click();
    await until(() => coverOf(old.id).classList.contains('lib-cover-modern'));
    expect(ctx.settings.get().covers).toBe(`${bookKey(old)}:modern`);
    root.querySelector<HTMLElement>(`.lib-card[data-id="${old.id}"] .lib-card-menu`)!.click();
    const again = [...document.querySelectorAll<HTMLElement>('.lib-menu [role="menuitemradio"]')];
    expect(again.map((c) => c.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    again[0].click();
    await until(() => coverOf(old.id).classList.contains('lib-cover-classic'));
  });

  it('draws a classic\'s painting as the board of its cover, title and all, and an imported book\'s picture as it is', async () => {
    const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const classic = await store.books.add({ ...book('故乡', '鲁迅'), sourceName: 'sample:guxiang', cover: 'sample-cover.jpg', assets: new Map([['sample-cover.jpg', png()]]) });
    const own = await store.books.add({ ...book('撒哈拉的故事', '三毛'), cover: 'cover.png', assets: new Map([['cover.png', png()]]) });
    const asked = vi.spyOn(store.books, 'assetUrl').mockImplementation(async (id) => `blob:${id}`);
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector(`.lib-card[data-id="${classic.id}"] .lib-cover-art-img`));
    const painted = root.querySelector(`.lib-card[data-id="${classic.id}"] .lib-cover`)!;
    expect(painted.querySelector('.lib-cover-title')?.textContent).toBe('故乡');
    expect(painted.querySelector<HTMLImageElement>('.lib-cover-art-img')!.src).toBe(`blob:${classic.id}`);
    // The book's own picture is asked for to be shown bare (once it loads), and is never drawn over.
    expect(asked).toHaveBeenCalledWith(own.id, 'cover.png');
    expect(root.querySelector(`.lib-card[data-id="${own.id}"] .lib-cover-art`)).toBeNull();
  });

  it('shows a book\'s own picture until a drawn cover is picked for it in the card menu', async () => {
    const pictured = await store.books.add({ ...book('撒哈拉的故事', '三毛'), cover: 'cover.png', assets: new Map([['cover.png', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })]]) });
    const asked = vi.spyOn(store.books, 'assetUrl');
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => root.querySelectorAll('.lib-card').length === 1);
    expect(asked).toHaveBeenCalledWith(pictured.id, 'cover.png');
    root.querySelector<HTMLElement>(`.lib-card[data-id="${pictured.id}"] .lib-card-menu`)!.click();
    const choices = [...document.querySelectorAll<HTMLElement>('.lib-menu [role="menuitemradio"]')];
    expect(choices.map((c) => c.textContent)).toEqual(['The book’s picture', 'Classic', 'Modern']);
    asked.mockClear();
    choices[2].click();
    await until(() => root.querySelector(`.lib-card[data-id="${pictured.id}"] .lib-cover-modern`) !== null);
    expect(asked).not.toHaveBeenCalled();
  });

  it('says how much of each book\'s words are known once some are, and follows changes', async () => {
    const a = await store.books.add(book('孔乙己'));
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => root.querySelectorAll('.lib-card').length === 1);
    const line = () => root.querySelector<HTMLElement>(`.lib-card[data-id="${a.id}"] .lib-card-known`)!;
    // No known words yet: no line (every book would say 0%).
    await flush(1500);
    expect(line().hidden).toBe(true);
    await store.known.add(['今天', '我们']);
    await until(() => !line().hidden && /You know \d+% of its words/.test(line().textContent ?? ''));
    const first = Number(/(\d+)%/.exec(line().textContent!)![1]);
    expect(first).toBeGreaterThan(0);
    expect(root.querySelector(`.lib-card[data-id="${a.id}"] .lib-card-main`)!.getAttribute('aria-label')).toContain(`You know ${first}% of its words`);
    await store.known.add(['天气', '很', '好', '去', '公园', '玩']);
    await until(() => Number(/(\d+)%/.exec(line().textContent ?? '')?.[1]) > first);
    // Kept on the device: a new library screen has the number without counting again.
    cleanup?.();
    root.textContent = '';
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => /You know \d+%/.test(root.querySelector('.lib-card-known')?.textContent ?? ''), 1000);
  });

  it('says under 1%, not 0%, once a few of a book\'s words are known', async () => {
    // 公园 once among about 400 other words.
    const text = '清晨的阳光照进窗子，他慢慢地走到桌边，拿起那本旧书，轻轻地翻开了第一页。'.repeat(30) + '我们去公园。';
    const a = await store.books.add({ ...book('长书'), chapters: [{ title: '一', blocks: [{ t: 'p', text }] }] });
    await store.known.add(['公园']);
    cleanup = await mountLibrary(root, {}, ctx);
    const line = () => root.querySelector<HTMLElement>(`.lib-card[data-id="${a.id}"] .lib-card-known`);
    await until(() => /You know/.test(line()?.textContent ?? ''));
    expect(line()!.textContent).toBe('You know <1% of its words');
    expect(root.querySelector(`.lib-card[data-id="${a.id}"] .lib-card-main`)!.getAttribute('aria-label')).toContain('You know <1% of its words');
  });

  it('renames through the menu and dialog', async () => {
    const a = await store.books.add(book('旧名'));
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-card-menu'));
    (root.querySelector('.lib-card-menu') as HTMLElement).click();
    const rename = [...document.querySelectorAll<HTMLElement>('.lib-menu-item')].find((b) => b.textContent === 'Rename')!;
    rename.click();
    await until(() => !!document.querySelector('dialog input[name=title]'));
    const input = document.querySelector<HTMLInputElement>('dialog input[name=title]')!;
    input.value = '新名';
    document.querySelector('dialog form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await until(() => root.querySelector('.lib-card-title')?.textContent === '新名');
    expect((await store.books.get(a.id))?.title).toBe('新名');
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('filters by author or title and clears an empty search without changing the library', async () => {
    await store.books.add(book('活着', '余华'));
    await store.books.add(book('射雕英雄传', '金庸'));
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => root.querySelectorAll('.lib-card').length === 2);
    const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = '金庸';
    search.dispatchEvent(new Event('input'));
    expect(root.querySelectorAll('.lib-card')).toHaveLength(1);
    expect(root.querySelector('.lib-card-title')?.textContent).toBe('射雕英雄传');
    search.value = 'no match';
    search.dispatchEvent(new Event('input'));
    expect(root.querySelectorAll('.lib-card')).toHaveLength(0);
    expect(root.querySelector('.lib-no-results')?.textContent).toContain('No books match');
    root.querySelector<HTMLButtonElement>('.lib-no-results button')!.click();
    expect(search.value).toBe('');
    expect(root.querySelectorAll('.lib-card')).toHaveLength(2);
    expect(await store.books.list()).toHaveLength(2);
  });

  it('asks before deleting and keeps the book on cancel', async () => {
    const a = await store.books.add(book('要删'));
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-card-menu'));
    const del = async () => {
      (root.querySelector('.lib-card-menu') as HTMLElement).click();
      [...document.querySelectorAll<HTMLElement>('.lib-menu-item')].find((b) => b.textContent === 'Delete')!.click();
      await until(() => !!document.querySelector('dialog'));
    };
    await del();
    [...document.querySelectorAll<HTMLElement>('dialog .btn')].find((b) => b.textContent === 'Cancel')!.click();
    await flush();
    expect(await store.books.get(a.id)).toBeTruthy();
    await del();
    [...document.querySelectorAll<HTMLElement>('dialog .btn')].find((b) => b.textContent === 'Delete')!.click();
    await until(() => !root.querySelector('.lib-card'));
    expect(await store.books.get(a.id)).toBeUndefined();
  });

  it('imports pasted text through the dialog and opens the reader', async () => {
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-empty'));
    [...root.querySelectorAll<HTMLElement>('.lib-empty .btn')].find((b) => b.textContent!.includes('Paste'))!.click();
    await until(() => !!document.querySelector('.lib-paste-text'));
    const go = document.querySelector<HTMLButtonElement>('dialog .btn-primary')!;
    expect(go.disabled).toBe(true);
    const ta = document.querySelector<HTMLTextAreaElement>('.lib-paste-text')!;
    ta.value = 'hello only';
    ta.dispatchEvent(new Event('input'));
    expect(go.disabled).toBe(true);
    ta.value = '第一章 开始\n今天天气很好，我们一起去公园玩。花开了。\n第二章 回家\n天黑了，我们走路回家。';
    ta.dispatchEvent(new Event('input'));
    expect(go.disabled).toBe(false);
    document.querySelector<HTMLInputElement>('.lib-paste input[aria-label=Title]')!.value = '短文';
    go.click();
    await until(() => navigated.length > 0, 8000);
    const [added] = await store.books.list();
    expect(added.title).toBe('短文');
    expect(added.format).toBe('paste');
    expect(navigated[0]).toBe(`#/read/${added.id}`);
  });

  it('turns a bad file into a toast that names it', async () => {
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('input[type=file]'));
    const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
    const file = new File(['just english'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => toasts.length > 0, 8000);
    expect(toasts[0]).toContain('notes.txt');
    expect(await store.books.list()).toEqual([]);
  });

  it('adds and opens a sample with one click, then shows it as in the library', async () => {
    const index = [{ id: 'x1', title: '小故事', author: '某人', script: 'simplified', file: 'x1.txt', level: 'Beginner', blurb: 'Short.', source: 'https://example.org/x', note: 'Public domain.' }];
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.endsWith('samples/index.json')) return { ok: true, text: async () => JSON.stringify(index) };
      if (u.endsWith('samples/x1.txt')) return { ok: true, text: async () => '从前有一座山，山里有一座庙。庙里有一个老和尚，他每天都给小和尚讲故事。' };
      return { ok: false, text: async () => '' };
    });
    cleanup = await mountLibrary(root, {}, ctx);
    await until(() => !!root.querySelector('.lib-sample .lib-add'));
    (root.querySelector('.lib-sample .lib-add') as HTMLElement).click();
    await until(() => navigated.length > 0, 8000);
    const [added] = await store.books.list();
    expect(added).toMatchObject({ title: '小故事', author: '某人', format: 'sample', sourceName: 'sample:x1' });
    await until(() => root.querySelector('.lib-sample .lib-add') === null);
    expect(root.querySelector('.lib-sample')?.textContent).toContain('In your library');
  });
});

describe('settings screen', () => {
  it('renders every group and a live preview that follows the settings', async () => {
    ctx.settings.set({ layout: 'scroll' });
    cleanup = await mountSettings(root, {}, ctx);
    expectPageHead('设置', 'Settings');
    // The section list marks where you are from the start, before any scrolling.
    expect([...root.querySelectorAll('.set-nav-link')].map((b) => b.getAttribute('aria-current'))[0]).toBe('true');
    expect(root.querySelectorAll('.set-nav-link[aria-current="true"]')).toHaveLength(1);
    for (const t of ['Reading', 'Pinyin', 'Lookup', 'Translation', 'Speech', 'Data']) {
      expect([...root.querySelectorAll('.section-title')].some((e) => e.textContent === t)).toBe(true);
    }
    const rts = () => [...root.querySelectorAll('.set-sample rt')].map((e) => e.textContent).filter(Boolean);
    await until(() => rts().length > 3);
    expect(rts()).toContain('wǒ');
    // 不大 shows the sandhi reading; turning sandhi off restores the dictionary tone.
    expect(rts()).toContain('bú');
    ctx.settings.set({ sandhi: false });
    expect(rts()).toContain('bù');
    ctx.settings.set({ pinyinStyle: 'numbers' });
    expect(rts()).toContain('wo3');
    ctx.settings.set({ pinyin: 'off' });
    expect(rts()).toEqual([]);
    ctx.settings.set({ pinyin: 'all', script: 'traditional' });
    expect(root.querySelector('.set-sample')?.textContent).toContain('們');
    ctx.settings.set({ scrollFontSize: 30, toneColors: false });
    expect((root.querySelector('.set-sample') as HTMLElement).style.fontSize).toBe('30px');
    expect(root.querySelector('.set-sample rt.tone-3')).toBeNull();
  });

  it('writes control changes to the settings store', async () => {
    ctx.settings.set({ layout: 'scroll' });
    cleanup = await mountSettings(root, {}, ctx);
    [...root.querySelectorAll<HTMLElement>('.set-seg-btn')].find((b) => b.textContent === 'Dark')!.click();
    expect(ctx.settings.get().theme).toBe('dark');
    const sw = root.querySelector<HTMLInputElement>('.set-switch-input')!;
    sw.checked = !sw.checked;
    sw.dispatchEvent(new Event('change'));
    expect(ctx.settings.get().toneColors).toBe(false);
    const range = root.querySelector<HTMLInputElement>('.set-range')!;
    range.value = '28';
    range.dispatchEvent(new Event('input'));
    expect(ctx.settings.get().scrollFontSize).toBe(28);
    // A change from elsewhere (another tab) shows up in the controls.
    ctx.settings.set({ theme: 'sepia', scrollFontSize: 18 });
    expect(root.querySelector('.set-seg-btn[aria-checked=true]')?.textContent).toBe('Sepia');
    expect(range.value).toBe('18');
  });

  it('uses independent text sizes when switching between Scroll and Pages', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    const size = root.querySelector<HTMLInputElement>('input[aria-label="Text size"]')!;
    const preview = root.querySelector<HTMLElement>('.set-sample')!;
    const choose = (name: string) => [...root.querySelectorAll<HTMLElement>('.set-seg-btn')].find((b) => b.textContent === name)!.click();
    choose('Scroll');
    expect(size.value).toBe('28');
    expect(preview.style.fontSize).toBe('28px');
    size.value = '32';
    size.dispatchEvent(new Event('input'));
    expect(ctx.settings.get()).toMatchObject({ scrollFontSize: 32, fontSize: 22 });
    choose('Pages');
    expect(size.value).toBe('22');
    expect(preview.style.fontSize).toBe('22px');
    choose('Scroll');
    expect(size.value).toBe('32');
    expect(preview.style.fontSize).toBe('32px');
  });

  it('names the settings as the reader menus do, and says the text size belongs to the layout', async () => {
    ctx.settings.set({ ttsRate: 0.9 });
    cleanup = await mountSettings(root, {}, ctx);
    const row = (label: string) => [...root.querySelectorAll<HTMLElement>('.set-row')].find((r) => r.querySelector('.set-label')?.textContent === label);
    const options = (label: string) => [...row(label)!.querySelectorAll('.set-seg-btn')].map((b) => b.textContent);
    expect(options('Theme')).toEqual(['Auto', 'Light', 'Sepia', 'Dark']);
    expect(options('Characters')).toEqual(['As written', 'Simplified', 'Traditional']);
    expect(row('Learn known words as I read')).toBeDefined();
    expect(row('Read-aloud speed')!.querySelector('.set-range-out')!.textContent).toBe('0.9×');
    expect(row('Text size')!.querySelector('.set-help')!.textContent).toMatch(/Pages and Scroll each keep their own/);
  });

  it('only enables the HSK slider in HSK mode', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    const sliders = [...root.querySelectorAll<HTMLInputElement>('.set-range')];
    const hsk = sliders.find((s) => s.max === '7')!;
    expect(hsk.disabled).toBe(true);
    ctx.settings.set({ pinyin: 'hsk' });
    expect(hsk.disabled).toBe(false);
  });

  it('lists all providers with live status and the Claude model choices', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    await until(() => [...root.querySelectorAll('.set-prov .set-chip')].every((c) => c.textContent !== '…'));
    const rows = [...root.querySelectorAll('.set-prov')];
    expect(rows).toHaveLength(7);
    // Signed out here, so Qwen through the account says how to get it.
    const qwen = rows.find((r) => r.querySelector('.set-prov-name')?.textContent?.startsWith('Qwen'))!;
    expect(qwen.querySelector('.set-chip')?.textContent).toBe('Sign in to use');
    const claude = rows.find((r) => r.querySelector('.set-prov-name')?.textContent?.startsWith('Claude'))!;
    // The test page counts as the Mac's own origin but nothing answers, so Claude cannot be ready; the browser holds no key to be "Ready" from.
    expect(claude.querySelector('.set-chip')?.textContent).toBe('Mac not reachable');
    expect(root.querySelector('.set-key')).toBeNull();
    const models = [...root.querySelectorAll<HTMLOptionElement>('select[aria-label="Claude model"] option')].map((o) => o.value);
    expect(models).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    // choosing a provider sets it
    rows.find((r) => r.querySelector('.set-prov-name')?.textContent?.startsWith('Chrome'))!
      .querySelector<HTMLInputElement>('input')!.click();
    expect(ctx.settings.get().translator).toBe('chrome');
  });

  it('marks Claude as off under Local only', async () => {
    ctx.settings.set({ localOnly: true });
    cleanup = await mountSettings(root, {}, ctx);
    await until(() => [...root.querySelectorAll('.set-prov .set-chip')].every((c) => c.textContent !== '…'));
    const claude = [...root.querySelectorAll('.set-prov')].find((r) => r.querySelector('.set-prov-name')?.textContent?.startsWith('Claude'))!;
    expect(claude.querySelector('.set-chip')?.textContent).toBe('Local only is on');
    const test = [...root.querySelectorAll<HTMLButtonElement>('.btn')].find((b) => b.textContent === 'Test Claude')!;
    expect(test.disabled).toBe(true);
  });

  it('exports a backup file and imports one back with a summary', async () => {
    await store.known.add(['你好']);
    cleanup = await mountSettings(root, {}, ctx);
    const json = await store.exportBackup();
    expect(json).not.toMatch(/sk-ant|apiKey/i);

    const input = root.querySelector<HTMLInputElement>('input[type=file]')!;
    const other = await openStore(`screens-other-${Math.random()}`);
    await other.known.add(['再见', '谢谢']);
    const backup = await other.exportBackup();
    Object.defineProperty(input, 'files', { value: [new File([backup], 'b.json')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => !!root.querySelector('.set-backup .set-good'));
    expect(store.known.has('谢谢')).toBe(true);
    expect(root.querySelector('.set-backup .set-good')?.textContent).toMatch(/Added 2 known words/);

    Object.defineProperty(input, 'files', { value: [new File(['not json'], 'bad.json')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await until(() => !!root.querySelector('.set-backup .set-bad'));
  });
});

describe('settings helpers', () => {
  it('decides which words carry pinyin', async () => {
    const dict = await loadTestDictionary();
    const known = (w: string) => w === '朋友';
    expect(showsPinyin('朋友', { pinyin: 'off', hskThreshold: 3 }, dict, known)).toBe(false);
    expect(showsPinyin('朋友', { pinyin: 'all', hskThreshold: 3 }, dict, known)).toBe(true);
    expect(showsPinyin('朋友', { pinyin: 'unknown', hskThreshold: 3 }, dict, known)).toBe(false);
    expect(showsPinyin('学生', { pinyin: 'unknown', hskThreshold: 3 }, dict, known)).toBe(true);
    expect(showsPinyin('学生', { pinyin: 'hsk', hskThreshold: 3 }, dict, () => false)).toBe(false); // HSK 1
    expect(showsPinyin('阿姨', { pinyin: 'hsk', hskThreshold: 3 }, dict, () => false)).toBe(true); // HSK 4
    expect(showsPinyin('阿姨', { pinyin: 'hsk', hskThreshold: 4 }, dict, () => false)).toBe(false);
    expect(showsPinyin('𠀀', { pinyin: 'hsk', hskThreshold: 7 }, dict, known)).toBe(true);
    // Like the reader, HSK mode hides known words too.
    expect(showsPinyin('阿姨', { pinyin: 'hsk', hskThreshold: 1 }, dict, (w) => w === '阿姨')).toBe(false);
  });

  it('previews a sentence that loses pinyin at every HSK level, tone changes on or off', async () => {
    const dict = await loadTestDictionary();
    for (const sandhi of [true, false]) {
      const target = document.createElement('div');
      document.body.appendChild(target);
      const counts = [1, 2, 3, 4, 5, 6, 7].map((n) => {
        renderPreview(target, { ...DEFAULT_SETTINGS, pinyin: 'hsk', hskThreshold: n, sandhi }, dict, () => false);
        return target.querySelectorAll('.set-w:has(rt)').length;
      });
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThan(counts[i - 1]);
      // 一个 is HSK 1, whatever tone 一 is shown with.
      renderPreview(target, { ...DEFAULT_SETTINGS, pinyin: 'hsk', hskThreshold: 1, sandhi }, dict, () => false);
      const withPinyin = [...target.querySelectorAll('.set-w:has(rt)')].map((w) => [...w.querySelectorAll('.set-ruby')].map((r) => r.firstChild?.textContent).join(''));
      expect(withPinyin.length).toBeGreaterThan(0);
      expect(withPinyin).not.toContain('一个');
      target.remove();
    }
  });

  it('describes availability and what Automatic picks', () => {
    expect(statusText('claude', 'no').text).toBe('Mac not reachable'); // the test page is the Mac's own origin and nothing answers
    expect(statusText('claude', 'no', null, true).text).toBe('Local only is on');
    expect(statusText('chrome', 'download').kind).toBe('warn');
    expect(statusText('gloss', 'yes').kind).toBe('ok');
    expect(autoPick({ local: 'yes', chrome: 'download', claude: 'no', account: 'no', mymemory: 'yes', gloss: 'yes' })).toBe('local');
    expect(autoPick({ local: 'yes', chrome: 'yes', claude: 'no', account: 'no', mymemory: 'yes', gloss: 'yes' })).toBe('chrome');
    expect(autoPick({ local: 'no', chrome: 'download', claude: 'no', account: 'no', mymemory: 'yes', gloss: 'yes' })).toBe('chrome');
    expect(autoPick({ local: 'no', chrome: 'no', claude: 'yes', account: 'no', mymemory: 'yes', gloss: 'yes' })).toBe('claude');
    expect(autoPick({ local: 'no', chrome: 'no', claude: 'no', account: 'no', mymemory: 'yes', gloss: 'yes' })).toBe('gloss');
    // Qwen through the account comes after Claude and the Mac's model, before the browser's translator, and never with Local only.
    expect(autoPick({ local: 'no', chrome: 'yes', claude: 'no', account: 'yes', mymemory: 'yes', gloss: 'yes' })).toBe('account');
    expect(autoPick({ local: 'no', chrome: 'no', claude: 'yes', account: 'yes', mymemory: 'yes', gloss: 'yes' })).toBe('claude');
    expect(autoPick({ local: 'yes', chrome: 'no', claude: 'no', account: 'yes', mymemory: 'yes', gloss: 'yes' }, true)).toBe('local');
    expect(autoPick({ local: 'no', chrome: 'yes', claude: 'no', account: 'yes', mymemory: 'yes', gloss: 'yes' }, false, true)).toBe('chrome');
    expect(statusText('account', 'no').text).toBe('Sign in to use');
    expect(statusText('account', 'yes', null, true).text).toBe('Local only is on');
  });

  it('summarizes backup imports and names the file by date', () => {
    expect(backupFileName(new Date(2026, 9, 5))).toBe('dushu-backup-2026-10-05.json');
    const empty = { vocab: { added: 0, updated: 0, skipped: 0 }, known: { added: 0 }, progress: { added: 0, updated: 0, skipped: 0 }, reviews: { added: 0 } };
    expect(describeReport(empty)).toMatch(/Nothing new/);
    expect(describeReport({ ...empty, vocab: { added: 12, updated: 3, skipped: 0 } })).toBe('Added 12 saved words, updated 3 saved words.');
    expect(describeReport({ ...empty, known: { added: 1 }, settings: {} })).toBe('Added 1 known word, restored your settings.');
  });
});

describe('about screen', () => {
  it('shows coverage from meta.json, every source, and the CC-CEDICT attribution', async () => {
    cleanup = await mountAbout(root, {}, { ...ctx, dictSync: () => null, dict: () => new Promise(() => {}) });
    await until(() => !!root.querySelector('.ab-count'));
    expectPageHead('关于', 'About Dushu');
    expect(root.textContent).toContain('101,997');
    expect(root.textContent).toContain('CC-CEDICT');
    expect(root.textContent).toContain('Creative Commons Attribution-ShareAlike 4.0');
    const names = [...root.querySelectorAll('.ab-source-name')].map((e) => e.textContent);
    for (const want of ['CC-CEDICT', 'Unihan / UCD', 'jieba dict.txt.big', 'OpenCC', 'Wiktionary (via kaikki.org)']) expect(names).toContain(want);
    expect(root.querySelectorAll('.ab-keys-group').length).toBeGreaterThan(1);
  });

  it('still renders when meta.json cannot be loaded', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    cleanup = await mountAbout(root, {}, { ...ctx, dictSync: () => null, dict: () => Promise.reject(new Error('no data')) });
    await until(() => !!root.querySelector('.ab-source'));
    expect(root.textContent).toContain('not available right now');
    expect(root.textContent).toContain('How to use it');
  });

  it('formats coverage tiles and drops the ones it has no number for', () => {
    expect(coverageStats({ counts: { unifiedIdeographs: 101997, withReading: 44362, extraLoaded: 5132 } }).map((s) => s.value)).toEqual(['101,997', '44,362']);
    expect(coverageStats({ counts: {} })).toEqual([]);
  });
});

describe('second tab', () => {
  it('the library and the vocabulary list show what another tab saved, without a reload', async () => {
    const name = `tabs-${Math.random().toString(36).slice(2)}`;
    const a = await openStore(name);
    const b = await openStore(name); // the same database, as a second tab would open it
    const dict = await loadTestDictionary();
    const ctxA: AppContext = { ...ctx, store: a, dict: () => Promise.resolve(dict), dictSync: () => dict };
    cleanup = await mountLibrary(root, {}, ctxA);
    await until(() => !!root.querySelector('.lib-empty'));
    await b.books.add(book('别处导入'));
    await until(() => [...root.querySelectorAll('.lib-card-title')].some((e) => e.textContent === '别处导入'));
    const [added] = await b.books.list();
    await b.books.remove(added.id);
    await until(() => root.querySelectorAll('.lib-card').length === 0);
  });
});
