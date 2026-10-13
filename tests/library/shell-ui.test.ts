// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRoute } from '../../src/ui/route';
import { errorText, isNetworkFailure, jobStage, titleFromFileName, OFFLINE_MESSAGE } from '../../src/ui/library/importer';
import { loadSampleBook } from '../../src/ui/library/samples';
import { titleLayout } from '../../src/ui/library/format';
import { keepAboveKeyboard, confirmDialog } from '../../src/ui/library/dialogs';
import { SHORTCUTS, keyCaps, openShortcuts } from '../../src/ui/shortcuts';
import { scriptView } from '../../src/ui/vocab/render';
import { confirmDialog as vocabConfirm } from '../../src/ui/vocab/confirm';

// jsdom has no showModal or close on <dialog>; give it the parts these screens use.
const dialogProto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
dialogProto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
dialogProto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

const known = (r: string) => ['', 'read', 'vocab', 'review', 'settings', 'about'].includes(r);

describe('hash router', () => {
  it('reads the route, the book id and the query', () => {
    expect(parseRoute('#/read/abc?x=1', known)).toEqual({ route: 'read', params: { x: '1', bookId: 'abc' } });
    expect(parseRoute('', known).route).toBe('');
    expect(parseRoute('#/nowhere', known).route).toBe('');
  });
  it('does not throw on a malformed percent escape', () => {
    expect(() => parseRoute('#/read/%', known)).not.toThrow();
    expect(parseRoute('#/read/%', known)).toEqual({ route: 'read', params: { bookId: '%' } });
    expect(parseRoute('#/read/%E4%BD', known).params.bookId).toBe('%E4%BD');
    expect(parseRoute('#/read/%E4%BD%A0', known).params.bookId).toBe('你');
    expect(parseRoute('#/%zz', known).route).toBe('');
  });
  it('treats inherited names such as constructor as unknown', () => {
    const own = (r: string) => Object.prototype.hasOwnProperty.call({ '': 1, read: 1 }, r);
    expect(parseRoute('#/constructor', own).route).toBe('');
  });
});

describe('import errors', () => {
  it('maps a browser network failure to a plain sentence', () => {
    for (const msg of ['Failed to fetch', 'Load failed', 'FetchEvent.respondWith received an error: TypeError: Load failed', 'NetworkError when attempting to fetch resource.']) {
      const e = new TypeError(msg);
      expect(isNetworkFailure(e)).toBe(true);
      const text = errorText(e, '“孔乙己”');
      expect(text).not.toMatch(/respondWith|TypeError|Load failed|Failed to fetch/);
      expect(text).toMatch(/^Could not add “孔乙己”\./);
    }
  });
  it('says you are offline when the browser knows it', () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    expect(errorText(new TypeError('Load failed'), '“孔乙己”')).toContain(OFFLINE_MESSAGE);
  });
  it('keeps other messages, and does not double the prefix', () => {
    expect(errorText(new Error('The file is empty.'), '“a.txt”')).toBe('Could not add “a.txt”. The file is empty.');
    expect(errorText(new Error('Could not download “x”. Check your connection.'), '“x”')).toBe('Could not download “x”. Check your connection.');
    expect(errorText(new Error('You are offline. Connect once to add this classic.'), '“x”')).toBe('Could not add “x”. You are offline. Connect once to add this classic.');
  });
  it('a classic that cannot be fetched explains itself instead of leaking the browser message', async () => {
    const sample = { id: 's', title: '孔乙己', author: '鲁迅', script: 'simplified' as const, file: 'k.txt', level: '', blurb: '' };
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const failing = async () => { throw new TypeError('FetchEvent.respondWith received an error: TypeError: Load failed'); };
    await expect(loadSampleBook(sample, () => { throw new Error('unused'); }, failing)).rejects.toThrow(OFFLINE_MESSAGE);
    vi.stubGlobal('navigator', { ...navigator, onLine: true });
    await expect(loadSampleBook(sample, () => { throw new Error('unused'); }, failing)).rejects.toThrow(/Could not download “孔乙己”/);
  });
  it('describes progress and names files', () => {
    expect(jobStage({ fraction: 0 })).toBe('Starting…');
    expect(jobStage({ fraction: 0.45 })).toBe('Reading… 50%');
    expect(jobStage({ fraction: 0.92 })).toBe('Saving…');
    expect(titleFromFileName('my_book_one.epub')).toBe('my book one');
    expect(titleFromFileName('noext')).toBe('noext');
  });
});

describe('generated covers', () => {
  it('sets four characters as two lines of two, and never leaves one character alone', () => {
    expect(titleLayout('唐詩三百')).toMatchObject({ perLine: 2 });
    expect(titleLayout('西遊記')).toMatchObject({ perLine: 3 });
    for (let n = 1; n <= 12; n++) {
      const { perLine } = titleLayout('字'.repeat(n));
      const last = n % perLine;
      // Longer titles are three lines or more, and text-wrap: balance evens those out in the browser.
      if (n > perLine) expect(last === 1 && n > perLine * 2 ? 'orphan' : 'ok', `${n} characters`).toBe('ok');
    }
  });
});

describe('dialogs and the on-screen keyboard', () => {
  it('pins a dialog to the visible area while the keyboard covers part of the window, and releases it after', () => {
    const listeners: Record<string, () => void> = {};
    const vv = { height: 500, offsetTop: 0, addEventListener: (t: string, f: () => void) => { listeners[t] = f; }, removeEventListener: (t: string) => { delete listeners[t]; } };
    vi.stubGlobal('innerHeight', 900);
    const dlg = document.createElement('div');
    const stop = keepAboveKeyboard(dlg, vv as unknown as VisualViewport);
    expect(dlg.style.maxHeight).toBe('476px');
    expect(dlg.style.insetBlockStart || dlg.style.getPropertyValue('inset-block-start')).toBe('12px');
    vv.height = 900; listeners.resize();
    expect(dlg.style.maxHeight).toBe('');
    vv.height = 560; listeners.resize();
    expect(dlg.style.maxHeight).toBe('536px');
    stop();
    expect(Object.keys(listeners)).toEqual([]);
  });
  it('does nothing without a visual viewport', () => {
    expect(() => keepAboveKeyboard(document.createElement('div'), null)()).not.toThrow();
  });
  it('a plain question focuses the dialog, not a button', async () => {
    const p = confirmDialog({ title: 'Delete?', message: 'Gone.', confirmLabel: 'Delete', danger: true });
    const dlg = document.querySelector('dialog')!;
    expect(document.activeElement).toBe(dlg);
    expect(dlg.querySelector('.btn-danger-solid')?.textContent).toBe('Delete');
    (dlg.querySelector('.btn:not(.btn-danger-solid)') as HTMLElement).click();
    expect(await p).toBe(false);
  });
  it('the vocabulary confirm also focuses the dialog and uses the danger button', async () => {
    const p = vocabConfirm({ title: 'Clear?', body: 'All of it.', confirmLabel: 'Clear', danger: true });
    const dlg = document.querySelector('dialog')!;
    expect(document.activeElement).toBe(dlg);
    expect(dlg.querySelector('.btn-danger-solid')).toBeTruthy();
    dlg.close();
    expect(await p).toBe(false);
  });
});

describe('shortcut sheet', () => {
  it('groups the keys, and no group lists the same key twice', () => {
    expect(SHORTCUTS.map((g) => g.group)).toEqual(['Reading', 'In a word card', 'Review']);
    for (const g of SHORTCUTS) {
      const seen = g.rows.map((r) => r.keys.join('+'));
      expect(new Set(seen).size, g.group).toBe(seen.length);
    }
  });
  it('draws alternatives as separate keys with the word between, not with a plus', () => {
    const div = document.createElement('div');
    div.append(...keyCaps({ keys: ['Shift', '← or →'], what: '' }));
    expect(div.querySelectorAll('kbd')).toHaveLength(3);
    expect(div.textContent).toContain('Shift');
    expect(div.textContent).toMatch(/←\s*or\s*→/);
    expect(div.textContent).toContain('+');
  });
  it('opens only the groups asked for, and focuses the dialog rather than the close button', () => {
    const dlg = openShortcuts({ groups: ['Reading', 'In a word card'] });
    expect([...dlg.querySelectorAll('.sc-group-title')].map((e) => e.textContent)).toEqual(['Reading', 'In a word card']);
    expect(document.activeElement).toBe(dlg);
    dlg.close();
    expect(document.querySelector('dialog')).toBeNull();
    const all = openShortcuts();
    expect(all.querySelectorAll('.sc-group')).toHaveLength(3);
  });
});

describe('script of saved words', () => {
  const dict = { toSimplified: (t: string) => t.replace(/學/g, '学').replace(/習/g, '习'), toTraditional: (t: string) => t.replace(/学/g, '學').replace(/习/g, '習') };
  const item = { id: 'x', simp: '学习', trad: '學習', pinyin: '', gloss: '', addedAt: 0, srs: {} } as never;
  it('converts sentences and the headword to the reader setting', () => {
    expect(scriptView('simplified', dict).text('我學習')).toBe('我学习');
    expect(scriptView('traditional', dict).text('我学习')).toBe('我學習');
    expect(scriptView('simplified', dict).word(item)).toBe('学习');
    expect(scriptView('traditional', dict).word(item)).toBe('學習');
  });
  it('leaves text alone as written, and before the dictionary has loaded', () => {
    expect(scriptView('original', dict).text('我學习')).toBe('我學习');
    expect(scriptView('simplified', null).text('我學习')).toBe('我學习');
    expect(scriptView('simplified', null).ready).toBe(false);
    expect(scriptView('original', null).ready).toBe(true);
  });
  it('as written, the headword takes the form the saved sentence uses', () => {
    const it2 = { ...(item as object), context: { sentence: '我學習了。' } } as never;
    expect(scriptView('original', dict).word(it2)).toBe('學習');
  });
});
