// The chapter drawer, with a second tab for the book's names and terms. Chapter titles are loaded lazily
// (the book record only has counts) and cached.
import type { AppContext, BookMeta, LexiconEntry } from '../../types';
import { formatPinyin } from '../../core/pinyin';
import { h } from '../dom';
import { icon } from '../icons';

export interface TocDrawer {
  open(current: number, tab?: 'chapters' | 'names'): void;
  close(): void;
  setCurrent(index: number): void;
  isOpen(): boolean;
  /** The lexicon changed: redraw the names tab if it is showing. */
  refreshNames(): void;
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

/** Book metadata may carry titles already (optional field); otherwise they are read from the chapters. */
type MetaWithTitles = BookMeta & { chapterTitles?: string[] };

const KIND_LABEL: Record<LexiconEntry['kind'], string> = { name: 'Person', place: 'Place', term: 'Term', user: 'Yours' };

export function createToc(ctx: AppContext, book: BookMeta, onPick: (index: number) => void, names?: TocNames): TocDrawer {
  const titles: (string | undefined)[] = [...((book as MetaWithTitles).chapterTitles ?? [])];
  let loadingAll: Promise<void> | null = null;
  let disposed = false;
  let currentIndex = 0;
  let tab: 'chapters' | 'names' = 'chapters';
  let rows: LexiconEntry[] = [];
  let namesSeq = 0;

  const list = h('ol.rd-toc-list');
  const filter = h('input.input.rd-toc-filter', { type: 'search', placeholder: 'Filter chapters', 'aria-label': 'Filter chapters' }) as HTMLInputElement;
  const nameFilter = h('input.input.rd-toc-filter', { type: 'search', placeholder: 'Filter names and terms', 'aria-label': 'Filter names and terms' }) as HTMLInputElement;
  const nameList = h('ul.rd-toc-list.rd-names');
  const status = h('div.rd-toc-status');
  const tabChapters = h('button.rd-toc-tab', { type: 'button', role: 'tab', onclick: () => setTab('chapters') }, 'Chapters') as HTMLButtonElement;
  const tabNames = h('button.rd-toc-tab', { type: 'button', role: 'tab', onclick: () => setTab('names') }, 'Names & terms') as HTMLButtonElement;
  const tabs = names ? h('div.rd-toc-tabs', { role: 'tablist' }, tabChapters, tabNames) : null;
  const panel = h('aside.rd-toc', { role: 'dialog', 'aria-label': 'Chapters' },
    h('div.rd-toc-head', null,
      h('div', null, h('div.rd-toc-book', null, book.title), h('div.rd-toc-count', null, `${book.chapterCount} chapter${book.chapterCount === 1 ? '' : 's'}`)),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Close chapters', onclick: () => close() }, icon('close'))),
    tabs,
    book.chapterCount > 12 ? filter : null,
    names ? nameFilter : null,
    status,
    list,
    names ? nameList : null);
  const backdrop = h('div.rd-backdrop', { onclick: () => close() });
  const root = h('div.rd-toc-root', { hidden: true }, backdrop, panel);
  document.body.appendChild(root);

  const label = (i: number) => titles[i] || `Chapter ${i + 1}`;

  function paint() {
    const q = filter.value.trim().toLowerCase();
    list.textContent = '';
    for (let i = 0; i < book.chapterCount; i++) {
      const t = label(i);
      if (q && !t.toLowerCase().includes(q) && String(i + 1) !== q) continue;
      const btn = h('button.rd-toc-item', {
        type: 'button',
        onclick: () => { close(); onPick(i); },
        'aria-current': i === currentIndex ? 'true' : null,
      }, h('span.rd-toc-n', null, String(i + 1)), h('span.rd-toc-t', null, t));
      list.appendChild(h('li', null, btn));
    }
    if (!list.childElementCount) list.appendChild(h('li.rd-toc-none', null, 'No chapters match.'));
  }

  // ------------------------------------------------------------ names tab
  function paintNames() {
    const q = nameFilter.value.trim().toLowerCase();
    nameList.textContent = '';
    const style = ctx.settings.get().pinyinStyle;
    const shown = rows
      .filter((r) => !q || r.word.includes(q) || formatPinyin(r.pinyin, style).toLowerCase().includes(q) || r.gloss.toLowerCase().includes(q))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || (b.count ?? 0) - (a.count ?? 0) || a.word.localeCompare(b.word));
    for (const entry of shown) {
      const on = h('input.rd-sw-input', { type: 'checkbox', role: 'switch', 'aria-label': `Use ${entry.word} as a word` }) as HTMLInputElement;
      on.checked = entry.enabled;
      on.addEventListener('change', async () => {
        on.disabled = true;
        try { await names!.onToggle(entry); } finally { on.disabled = false; }
      });
      const main = h('button.rd-name-main', {
        type: 'button',
        onclick: (e: Event) => names!.onWord(entry, (e.currentTarget as HTMLElement).getBoundingClientRect()),
      },
      h('span.rd-name-word.zh', { lang: 'zh' }, entry.word),
      h('span.rd-name-py', null, formatPinyin(entry.pinyin, style)),
      h('span.rd-name-meta', null,
        h('span.rd-name-kind', { 'data-kind': entry.kind }, KIND_LABEL[entry.kind]),
        entry.count ? h('span.rd-name-count', null, `${entry.count}×`) : null));
      nameList.appendChild(h('li.rd-name', { 'data-off': entry.enabled ? null : '' }, main,
        h('label.rd-name-switch', { title: entry.enabled ? 'Treated as a word. Turn off if this is not one.' : 'Not treated as a word' }, on,
          h('span.rd-sw-track', null, h('span.rd-sw-thumb')))));
    }
    if (!shown.length) {
      nameList.appendChild(h('li.rd-toc-none', null,
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

  function setTab(next: 'chapters' | 'names') {
    tab = names ? next : 'chapters';
    const isNames = tab === 'names';
    tabChapters.setAttribute('aria-selected', String(!isNames));
    tabNames.setAttribute('aria-selected', String(isNames));
    list.hidden = isNames;
    filter.hidden = isNames;
    nameList.hidden = !isNames;
    nameFilter.hidden = !isNames;
    status.hidden = isNames;
    panel.setAttribute('aria-label', isNames ? 'Names and terms' : 'Chapters');
    if (isNames) { paintNames(); void loadNames(); } else scrollToCurrent();
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
        if (!root.hidden && tab === 'chapters') paint();
      }
      status.textContent = '';
    })();
    return loadingAll;
  }

  function scrollToCurrent() {
    list.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  function open(current: number, which: 'chapters' | 'names' = 'chapters') {
    currentIndex = current;
    root.hidden = false;
    filter.value = '';
    nameFilter.value = '';
    paint();
    setTab(which);
    window.addEventListener('keydown', onKey, true);
    void loadTitles().then(() => { if (!root.hidden && tab === 'chapters') { paint(); scrollToCurrent(); } });
    if (tab === 'chapters') panel.querySelector<HTMLElement>('.rd-toc-item[aria-current="true"]')?.focus({ preventScroll: true });
  }

  function close() {
    root.hidden = true;
    window.removeEventListener('keydown', onKey, true);
  }

  filter.addEventListener('input', paint);
  nameFilter.addEventListener('input', paintNames);
  setTab('chapters');

  return {
    open,
    close,
    isOpen: () => !root.hidden,
    setCurrent(i) { currentIndex = i; },
    refreshNames() { if (!root.hidden && tab === 'names') void loadNames(); else rows = []; },
    dispose() {
      disposed = true;
      window.removeEventListener('keydown', onKey, true);
      root.remove();
    },
  };
}
