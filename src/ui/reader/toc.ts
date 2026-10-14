// The chapter drawer, with tabs for the words of a chapter (wordsTab.ts) and the book's names and terms. Chapter titles are loaded lazily
// (the book record only has counts) and cached. Both lists are windowed: only the rows near the visible part exist,
// so a book with 2,000 chapters opens as fast as one with twenty.
// The drawer is a modal dialog: focus moves into it on open, Tab stays inside it, and focus returns to its opener on close.
import type { AppContext, BookMeta, LexiconEntry, PinyinStyle } from '../../types';
import { formatSyllable } from '../../core/pinyin';
import { h } from '../dom';
import { icon } from '../icons';
import { windowed } from './windowed';
import { createWordsTab, type TocWords } from './wordsTab';

export type TocTab = 'chapters' | 'words' | 'names';

export interface TocDrawer {
  open(current: number, tab?: TocTab): void;
  close(): void;
  setCurrent(index: number): void;
  isOpen(): boolean;
  /** The lexicon changed: redraw the names tab if it is showing. */
  refreshNames(): void;
  /** The names and terms in use changed: the words are counted again. */
  refreshWords(): void;
  /** The script setting changed: titles and names are drawn again in the new script. */
  refreshText(): void;
  dispose(): void;
}

/** What the Names & terms tab needs from the reader. */
export interface TocNames {
  /** Every row of the book's lexicon, including rejected ones. */
  load(): Promise<LexiconEntry[]>;
  /** Tap on a row: open the word popup, anchored at the row. */
  onWord(entry: LexiconEntry, anchor: DOMRect): void;
  /** The switch: accept or reject an entry. Resolves once it is saved. */
  onToggle(entry: LexiconEntry): Promise<void>;
}

export interface TocOptions {
  /** Book text as the reader shows it (the script setting also applies to the chapter list and the names). */
  text?(s: string): string;
  /** The Words tab: the words of a chapter. Without it the tab is not shown. */
  words?: TocWords;
}

/** Book metadata may carry titles already (optional field); otherwise they are read from the chapters. */
type MetaWithTitles = BookMeta & { chapterTitles?: string[] };

const KIND_LABEL: Record<LexiconEntry['kind'], string> = { name: 'Person', place: 'Place', term: 'Term', user: 'Yours' };

/** Syllables that end a place name as a kind of place (Táohuā Dǎo, Huáshān Shān is not one): written as a second word. */
const PLACE_KIND = new Set(['dao', 'shan', 'cheng', 'cun', 'he', 'jiang', 'hu', 'si', 'gong', 'zhen', 'guo', 'xian', 'zhou', 'gu',
  'feng', 'dong', 'guan', 'hai', 'zhuang', 'bao', 'lin', 'qiao', 'men', 'tai', 'ting', 'lou', 'ge', 'an', 'miao', 'chi', 'ling',
  'yuan', 'pu', 'ba', 'fu', 'jun', 'sheng', 'xiang', 'ting']);

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Pinyin of a lexicon entry as a name is written: a person's syllables each start with a capital (Guō Jìng); a place is one
 * word with its kind of place apart when it has one (Táohuā Dǎo); a term stays lowercase. Zhuyin has no capitals.
 * Same signature as the shared helper the language side adds to src/core; this copy is the fallback.
 */
export function capitalizePinyin(numbered: string, kind: LexiconEntry['kind'], style: PinyinStyle = 'marks'): string {
  const syl = numbered.split(/\s+/).filter(Boolean).map((s) => formatSyllable(s, style));
  if (style === 'zhuyin' || (kind !== 'name' && kind !== 'place')) return syl.join(' ');
  if (kind === 'name') return syl.map(cap).join(' ');
  const bases = numbered.split(/\s+/).filter(Boolean).map((s) => s.replace(/[0-5]$/, '').toLowerCase());
  if (syl.length >= 3 && PLACE_KIND.has(bases[bases.length - 1])) return `${cap(syl.slice(0, -1).join(''))} ${cap(syl[syl.length - 1])}`;
  return cap(syl.join(''));
}

export function createToc(ctx: AppContext, book: BookMeta, onPick: (index: number) => void, names?: TocNames, opts: TocOptions = {}): TocDrawer {
  const text = (s: string): string => (opts.text ? opts.text(s) : s);
  const titles: (string | undefined)[] = [...((book as MetaWithTitles).chapterTitles ?? [])];
  let loadingAll: Promise<void> | null = null;
  let disposed = false;
  let currentIndex = 0;
  let tab: TocTab = 'chapters';
  let rows: LexiconEntry[] = [];
  let namesSeq = 0;
  let opener: HTMLElement | null = null;
  /** Chapter indexes the filter lets through, in order. */
  let shown: number[] = [];
  /** The row (position in `shown`) that Tab reaches; arrow keys move it. */
  let rove = 0;
  let shownNames: LexiconEntry[] = [];
  let roveName = 0;

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const chapterRowH = coarse ? 50 : 44;
  const nameRowH = coarse ? 68 : 60;

  const list = h('div.rd-toc-list', { role: 'list', 'aria-label': 'Chapters' });
  const filter = h('input.input.rd-toc-filter', { type: 'search', placeholder: 'Filter chapters', 'aria-label': 'Filter chapters' }) as HTMLInputElement;
  const nameFilter = h('input.input.rd-toc-filter', { type: 'search', placeholder: 'Filter names and terms', 'aria-label': 'Filter names and terms' }) as HTMLInputElement;
  const nameList = h('div.rd-toc-list.rd-names', { role: 'list', 'aria-label': 'Names and terms' });
  const status = h('div.rd-toc-status', { role: 'status' });
  const tabChapters = h('button.rd-toc-tab', { type: 'button', role: 'tab', onclick: () => setTab('chapters') }, 'Chapters') as HTMLButtonElement;
  const tabWords = h('button.rd-toc-tab', { type: 'button', role: 'tab', onclick: () => setTab('words') }, 'Words') as HTMLButtonElement;
  const tabNames = h('button.rd-toc-tab', { type: 'button', role: 'tab', onclick: () => setTab('names') }, 'Names & terms') as HTMLButtonElement;
  const label = (i: number) => text(titles[i] || `Chapter ${i + 1}`);
  const words = opts.words
    ? createWordsTab(ctx, book, opts.words, { text, rowH: nameRowH, chapterTitle: (i) => titles[i] || `Chapter ${i + 1}` })
    : null;
  const tabs = names || words
    ? h('div.rd-toc-tabs', { role: 'tablist' }, tabChapters, words ? tabWords : null, names ? tabNames : null)
    : null;
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Close chapters', onclick: () => close() }, icon('close'));
  const panel = h('aside.rd-toc', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Chapters', tabindex: '-1' },
    h('div.rd-toc-head', null,
      h('div', null, h('div.rd-toc-book', null, text(book.title)), h('div.rd-toc-count', null, `${book.chapterCount} chapter${book.chapterCount === 1 ? '' : 's'}`)),
      closeBtn),
    tabs,
    book.chapterCount > 12 ? filter : null,
    names ? nameFilter : null,
    words?.head ?? null,
    status,
    list,
    words?.list ?? null,
    names ? nameList : null);
  const backdrop = h('div.rd-backdrop', { onclick: () => close() });
  const root = h('div.rd-toc-root', { hidden: true }, backdrop, panel);
  document.body.appendChild(root);

  // ------------------------------------------------------- chapters tab
  function chapterRow(pos: number): HTMLElement {
    const i = shown[pos];
    const btn = h('button.rd-toc-item', {
      type: 'button',
      tabindex: pos === rove ? '0' : '-1',
      onclick: () => { close(); onPick(i); },
      'aria-current': i === currentIndex ? 'true' : null,
    }, h('span.rd-toc-t', null, label(i)));
    return h('div.rd-toc-row', { role: 'listitem' }, btn);
  }
  const chapterWindow = windowed(list, chapterRow, () => rove);

  /** Which chapters the filter lets through, and redraw the window. */
  function paint(): void {
    const q = filter.value.trim().toLowerCase();
    shown = [];
    for (let i = 0; i < book.chapterCount; i++) {
      if (q && !label(i).toLowerCase().includes(q) && !(titles[i] ?? '').toLowerCase().includes(q) && String(i + 1) !== q) continue;
      shown.push(i);
    }
    const at = shown.indexOf(currentIndex);
    rove = Math.max(0, Math.min(rove, shown.length - 1));
    if (q === '' && at >= 0) rove = at;
    chapterWindow.set(shown.length, chapterRowH);
    if (!shown.length) list.appendChild(h('div.rd-toc-none', null, 'No chapters match.'));
  }

  // ------------------------------------------------------------ names tab
  function nameRow(pos: number): HTMLElement {
    const entry = shownNames[pos];
    const style = ctx.settings.get().pinyinStyle;
    const word = text(entry.word);
    const on = h('input.rd-sw-input', { type: 'checkbox', role: 'switch', 'aria-label': `Use ${word} as a word` }) as HTMLInputElement;
    on.checked = entry.enabled;
    on.addEventListener('change', async () => {
      on.disabled = true;
      try { await names!.onToggle(entry); } finally { on.disabled = false; }
    });
    const main = h('button.rd-name-main', {
      type: 'button',
      tabindex: pos === roveName ? '0' : '-1',
      onclick: (e: Event) => names!.onWord(entry, (e.currentTarget as HTMLElement).getBoundingClientRect()),
    },
    h('span.rd-name-word.zh', { lang: 'zh' }, word),
    h('span.rd-name-py', null, capitalizePinyin(entry.pinyin, entry.kind, style)),
    h('span.rd-name-meta', null,
      h('span.rd-name-kind', { 'data-kind': entry.kind }, KIND_LABEL[entry.kind]),
      entry.count ? h('span.rd-name-count', null, `${entry.count}×`) : null));
    return h('div.rd-toc-row.rd-name', { role: 'listitem', 'data-off': entry.enabled ? null : '' }, main,
      h('label.rd-name-switch', { title: entry.enabled ? 'Treated as a word. Turn off if this is not one.' : 'Not treated as a word' }, on,
        h('span.rd-sw-track', null, h('span.rd-sw-thumb'))));
  }
  const nameWindow = windowed(nameList, nameRow, () => roveName);

  function paintNames() {
    const q = nameFilter.value.trim().toLowerCase();
    const style = ctx.settings.get().pinyinStyle;
    shownNames = rows
      .filter((r) => !q || r.word.includes(q) || text(r.word).includes(q) || capitalizePinyin(r.pinyin, r.kind, style).toLowerCase().includes(q) || r.gloss.toLowerCase().includes(q))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (b.count ?? 0) - (a.count ?? 0) || a.word.localeCompare(b.word));
    roveName = Math.max(0, Math.min(roveName, shownNames.length - 1));
    nameWindow.set(shownNames.length, nameRowH);
    nameList.querySelector('.rd-toc-none')?.remove();
    if (!shownNames.length) {
      nameList.appendChild(h('div.rd-toc-none', null,
        rows.length ? 'Nothing matches.' : 'No names or terms found yet. Names of people and places in this book appear here once the book has been scanned.'));
    }
  }

  async function loadNames() {
    if (!names) return;
    const seq = ++namesSeq;
    try {
      const got = await names.load();
      if (seq !== namesSeq || disposed) return;
      rows = got;
    } catch { rows = []; }
    if (tab === 'names' && !root.hidden) paintNames();
  }

  function setTab(next: TocTab) {
    tab = next === 'names' && names ? 'names' : next === 'words' && words ? 'words' : 'chapters';
    const isNames = tab === 'names';
    const isWords = tab === 'words';
    const isChapters = tab === 'chapters';
    tabChapters.setAttribute('aria-selected', String(isChapters));
    tabWords.setAttribute('aria-selected', String(isWords));
    tabNames.setAttribute('aria-selected', String(isNames));
    list.hidden = !isChapters;
    filter.hidden = !isChapters;
    status.hidden = !isChapters;
    nameList.hidden = !isNames;
    nameFilter.hidden = !isNames;
    if (words) { words.head.hidden = !isWords; words.list.hidden = !isWords; words.setVisible(isWords && !root.hidden); }
    panel.setAttribute('aria-label', isNames ? 'Names and terms' : isWords ? 'Words in this chapter' : 'Chapters');
    if (isNames) { paintNames(); void loadNames(); }
    else if (isWords) words!.show(currentIndex);
    else { paint(); scrollToCurrent(); }
  }

  async function loadTitles() {
    if (loadingAll) return loadingAll;
    loadingAll = (async () => {
      const need: number[] = [];
      for (let i = 0; i < book.chapterCount; i++) if (!titles[i]) need.push(i);
      if (!need.length) return;
      status.textContent = 'Loading chapter titles…';
      for (let k = 0; k < need.length && !disposed; k += 20) {
        await Promise.all(need.slice(k, k + 20).map(async (i) => {
          const c = await ctx.store.books.chapter(book.id, i).catch(() => undefined);
          titles[i] = c?.title?.trim() || `Chapter ${i + 1}`;
        }));
        // Redraw the window in place: the row the reader is on keeps its focus.
        if (!root.hidden && tab === 'chapters') chapterWindow.repaint();
      }
      status.textContent = '';
    })();
    return loadingAll;
  }

  function scrollToCurrent() {
    const at = shown.indexOf(currentIndex);
    if (at >= 0) { rove = at; chapterWindow.reveal(at, true); }
  }

  // ------------------------------------------------------------- keys, focus
  const focusables = (): HTMLElement[] =>
    [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')]
      .filter((el) => !el.closest('[hidden]') && !el.hidden && el.getAttribute('tabindex') !== '-1');

  function moveRove(delta: number, absolute?: 'start' | 'end') {
    const n = tab === 'names' ? shownNames.length : tab === 'words' ? words!.count() : shown.length;
    if (!n) return;
    const from = tab === 'names' ? roveName : tab === 'words' ? words!.rove : rove;
    const to = absolute === 'start' ? 0 : absolute === 'end' ? n - 1 : Math.max(0, Math.min(n - 1, from + delta));
    if (tab === 'names') roveName = to; else if (tab === 'words') words!.rove = to; else rove = to;
    const w = tab === 'names' ? nameWindow : tab === 'words' ? words!.window : chapterWindow;
    w.reveal(to);
    // Rows are rebuilt around the new tab stop; the one that gets focus is the new one.
    w.repaint();
    w.reveal(to);
    // The same kind of button as before (a row of words has three), else the row's first.
    const kind = (document.activeElement as HTMLElement | null)?.dataset?.k;
    const row = w.rowAt(to);
    (row?.querySelector<HTMLElement>(kind ? `button[data-k="${kind}"]` : 'button') ?? row?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const items = focusables();
      if (!items.length) { e.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || at === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !panel.contains(at))) { e.preventDefault(); first.focus(); }
      return;
    }
    const inList = (document.activeElement as HTMLElement | null)?.closest?.('.rd-toc-list');
    if (!inList) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveRove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveRove(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); moveRove(8); }
    else if (e.key === 'PageUp') { e.preventDefault(); moveRove(-8); }
    else if (e.key === 'Home') { e.preventDefault(); moveRove(0, 'start'); }
    else if (e.key === 'End') { e.preventDefault(); moveRove(0, 'end'); }
  }

  function open(current: number, which: TocTab = 'chapters') {
    opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    currentIndex = current;
    root.hidden = false;
    filter.value = '';
    nameFilter.value = '';
    rove = current;
    setTab(which);
    window.addEventListener('keydown', onKey, true);
    void loadTitles().then(() => { if (!root.hidden && tab === 'chapters') { paint(); scrollToCurrent(); } });
    // Into the drawer: the current chapter (or, on the other tab, its first control).
    if (tab === 'chapters') {
      const row = chapterWindow.rowAt(rove)?.querySelector<HTMLElement>('button');
      (row ?? panel).focus({ preventScroll: true });
    } else (tab === 'words' ? tabWords : tabNames).focus({ preventScroll: true });
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    words?.setVisible(false);
    window.removeEventListener('keydown', onKey, true);
    // Focus goes back to what opened the drawer (the Chapters button, or the page when a key opened it).
    const back = opener && opener.isConnected ? opener : document.querySelector<HTMLElement>('.rd-toc-btn');
    back?.focus({ preventScroll: true });
    opener = null;
  }

  filter.addEventListener('input', () => { paint(); });
  nameFilter.addEventListener('input', paintNames);
  setTab('chapters');

  return {
    open,
    close,
    isOpen: () => !root.hidden,
    setCurrent(i) { currentIndex = i; },
    refreshNames() { if (!root.hidden && tab === 'names') void loadNames(); else rows = []; },
    refreshWords() { words?.reload(); },
    refreshText() {
      if (root.hidden) return;
      if (tab === 'chapters') chapterWindow.repaint(); else if (tab === 'words') words!.refreshText(); else paintNames();
    },
    dispose() {
      disposed = true;
      window.removeEventListener('keydown', onKey, true);
      chapterWindow.dispose();
      nameWindow.dispose();
      words?.dispose();
      root.remove();
    },
  };
}
