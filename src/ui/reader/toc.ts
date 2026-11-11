// The chapter drawer, with tabs for the words of a chapter (wordsTab.ts) and the book's names and terms. Chapter titles are loaded lazily
// (the book record only has counts) and cached. Both lists are windowed: only the rows near the visible part exist,
// so a book with 2,000 chapters opens as fast as one with twenty.
// The drawer is a modal dialog: focus moves into it on open, Tab stays inside it, and focus returns to its opener on close.
import type { AppContext, Bookmark, BookMeta, Fix, LexiconEntry, PinyinStyle } from '../../types';
import { isDetecting } from '../../core/lexicon';
import { capitalizePinyin } from '../../core/names';
import { formatSyllable } from '../../core/pinyin';
import { clear, h } from '../dom';
import { icon } from '../icons';
import { windowed } from './windowed';
import { createWordsTab, type TocWords } from './wordsTab';
import { lang } from '../../lang/active';
import { tt, ttm, ttn, ttx, uiLocale } from '../../i18n';
import { EASE, EASE_IN, play } from '../review/motion';

export type TocTab = 'chapters' | 'words' | 'names' | 'bookmarks';

export interface TocDrawer {
  open(current: number, tab?: TocTab): void;
  close(): void;
  setCurrent(index: number): void;
  isOpen(): boolean;
  /** The lexicon changed: redraw the names tab if it is showing. */
  refreshNames(): void;
  /** The names and terms in use changed: the words are counted again. */
  refreshWords(): void;
  /** The bookmarks changed: redraw the Bookmarks tab if it is showing. */
  refreshBookmarks(): void;
  /** The script setting changed: titles and names are drawn again in the new script. */
  refreshText(): void;
  dispose(): void;
}

/** What the Corrections tab (the book's names and terms, and the reader's fixes) needs from the reader. */
export interface TocNames {
  /** Every row of the book's lexicon, including rejected ones. */
  load(): Promise<LexiconEntry[]>;
  /** Tap on a row: open the word popup, anchored at the row. */
  onWord(entry: LexiconEntry, anchor: DOMRect): void;
  /** The switch of a name or term the book was found to have: accept or reject it. Resolves once it is saved. */
  onToggle(entry: LexiconEntry): Promise<void>;
  /** The reader's fixes of the book (bookFixes.ts). Without it the tab lists the names and terms only. */
  fixes?: TocFixes;
}

/** The reader's fixes in the Corrections tab. */
export interface TocFixes {
  list(): readonly Fix[];
  /** The switch: a fix in use or not. */
  toggle(fix: Fix): Promise<void>;
  /** Delete, with Undo. */
  remove(fix: Fix): Promise<void>;
  /** Places a word is in the book. */
  places(word: string): Promise<number>;
  /** Export corrections: a small JSON file. */
  exportFile(): Promise<void>;
  /** Import corrections from such a file. */
  importFile(file: File): Promise<void>;
  /** The book's old spellings (底 for 的, 那 for 哪): a switch each that the book needs, none when it needs neither. */
  spellings?(): SpellingSwitch[];
  /** Check names: asks about the strings the book repeats that look like names (nameCheck.ts). */
  checkNames?(): void;
  /** Dictionary words the reader said are not names (nameCheck.ts): listed under Words, and asked about again once deleted. */
  notNames?(): string[];
  askAgain?(word: string): Promise<void>;
}

export interface SpellingSwitch { id: string; label: string; hint: string; on: boolean; set(on: boolean): Promise<void> }

export interface TocOptions {
  /** Book text as the reader shows it (the script setting also applies to the chapter list and the names). */
  text?(s: string): string;
  /** The Words tab: the words of a chapter. Without it the tab is not shown. */
  words?: TocWords;
  /** The Bookmarks tab: the book's bookmarks, a jump to one, and taking one away. */
  bookmarks?: TocBookmarks;
}

export interface TocBookmarks {
  list(): Promise<Bookmark[]>;
  pick(b: Bookmark): void;
  remove(b: Bookmark): void;
}

/** Book metadata may carry titles already (optional field); otherwise they are read from the chapters. */
type MetaWithTitles = BookMeta & { chapterTitles?: string[] };

// The labels below are in English (ttm) and shown with tt().
const KIND_LABEL: Record<LexiconEntry['kind'], string> = { name: ttm('Person'), place: ttm('Place'), term: ttm('Term'), user: ttm('Yours') };

type FixSeg = 'names' | 'words' | 'readings';
const SEG_LABEL: Record<FixSeg, string> = { names: ttm('Names'), words: ttm('Words'), readings: ttm('Readings') };
/** The same with how many rows each part has. */
const SEG_COUNT: Record<FixSeg, string> = { names: ttm('Names {n}'), words: ttm('Words {n}'), readings: ttm('Readings {n}') };
const EMPTY_SEG: Record<FixSeg, string> = {
  names: ttm('No names yet. Tap a name in the text, then the pencil, and choose It\'s a name.'),
  words: ttm('No words fixed yet. Tap a word in the text, then the pencil, to split it or join it with a word beside it. Or select a few characters and choose Join as one word.'),
  readings: ttm('No readings fixed yet. Tap a word in the text, then the pencil, and choose Reading.'),
};

/** One row of the Corrections tab: a name or term found in the book, or one of the reader's fixes. */
interface FixRow {
  key: string;
  word: string;
  /** Numbered pinyin, or '' (a split shows its pieces in `note`). */
  pinyin: string;
  kind: LexiconEntry['kind'];
  label: string;
  note?: string;
  seg: FixSeg;
  count?: number;
  scope: string;
  on: boolean;
  entry?: LexiconEntry;
  fix?: Fix;
  gloss: string;
  /** How its pinyin takes capitals, when not as `kind` says (an other name the reader marked is written like a name). */
  caps?: LexiconEntry['kind'];
  /** A dictionary word the reader said is not a name: no switch, and Delete asks about it again. */
  notName?: true;
}

const entryOf = (r: FixRow): LexiconEntry => ({ word: r.word, pinyin: r.pinyin, gloss: r.gloss, kind: r.kind, enabled: r.on, origin: 'user' });
/** A split as its pieces, in the script the page shows (`shown` is the word as shown): 先生 cut after 先 is 先 | 生. */
const cutPreview = (f: Fix, shown: string) => {
  const chars = [...shown].length === [...f.word].length ? [...shown] : [...f.word];
  return chars.map((c, i) => (i && f.cuts?.includes(i) ? ` | ${c}` : c)).join('');
};
/** Pinyin as typed in a filter: no tone marks, no tone numbers, no spaces (xian finds Xiánhēng). */
const plainPinyin = (s: string) => s.normalize('NFD').replace(/[\u0300\u0301\u0304\u030c]/g, '').replace(/[\s'’1-5]/g, '').toLowerCase();

export function createToc(ctx: AppContext, book: BookMeta, onPick: (index: number) => void, names?: TocNames, opts: TocOptions = {}): TocDrawer {
  const text = (s: string): string => (opts.text ? opts.text(s) : s);
  // The number as English always wrote it here (no thousands separator), in each language's form of the phrase.
  const chapterCount = () => ttn(book.chapterCount, '{n} chapter', '{n} chapters', { n: book.chapterCount });
  /** A row's pinyin as the word card writes it (Xiàhóu Dūn, Táohuā Dǎo); a term stays lowercase. */
  const namePinyin = (entry: Pick<LexiconEntry, 'word' | 'pinyin' | 'kind'>, style: PinyinStyle): string => capitalizePinyin(
    entry.pinyin.split(/\s+/).filter(Boolean).map((s) => formatSyllable(s, style)), entry.kind, entry.word,
    (s) => ctx.dictSync()?.toSimplified(s) ?? s);
  const titles: (string | undefined)[] = [...((book as MetaWithTitles).chapterTitles ?? [])];
  let loadingAll: Promise<void> | null = null;
  let disposed = false;
  let currentIndex = 0;
  let tab: TocTab = 'chapters';
  let rows: LexiconEntry[] = [];
  /** The Corrections tab's rows: the names and terms found in the book, and the reader's fixes. */
  let fixRows: FixRow[] = [];
  let seg: FixSeg = 'names';
  /** The reader chose the part this time the drawer is open (else it opens on the first part that has rows). */
  let segPicked = false;
  /**
   * Where each row stood when the list was sorted: a switch turned on or off leaves its row where it is (under the finger) until the
   * list is opened, filtered or switched again.
   */
  let order: Map<string, number> | null = null;
  /** Places in the book of the words of fixes that do not say (counted once the tab shows them). */
  const counted = new Map<string, number>();
  /** The rows have been read at least once since the tab opened (an empty list before that says nothing). */
  let namesLoaded = false;
  let namesSeq = 0;
  let opener: HTMLElement | null = null;
  /** Chapter indexes the filter lets through, in order. */
  let shown: number[] = [];
  /** The row (position in `shown`) that Tab reaches; arrow keys move it. */
  let rove = 0;
  let shownNames: FixRow[] = [];
  let roveName = 0;

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const chapterRowH = coarse ? 50 : 44;
  const nameRowH = coarse ? 68 : 60;

  const list = h('div.rd-toc-list', { role: 'list', 'aria-label': tt('Chapters') });
  const filter = h('input.input.rd-toc-filter', { type: 'search', placeholder: tt('Filter chapters'), 'aria-label': tt('Filter chapters') }) as HTMLInputElement;
  const fx = names?.fixes;
  const nameFilterLabel = fx ? tt('Filter corrections') : tt('Filter names and terms');
  const nameFilter = h('input.input.rd-toc-filter', { type: 'search', placeholder: nameFilterLabel, 'aria-label': nameFilterLabel }) as HTMLInputElement;
  const nameList = h('div.rd-toc-list.rd-names', { role: 'list', 'aria-label': fx ? tt('Corrections') : tt('Names and terms') });
  // Corrections: Names, Words and Readings; the old spellings above them; Export and Import below.
  const segBtns = (['names', 'words', 'readings'] as FixSeg[]).map((k) => h('button.rd-fix-seg', { type: 'button', 'aria-pressed': 'false', 'data-seg': k,
    onclick: () => { seg = k; segPicked = true; order = null; roveName = 0; paintNames(); } }, tt(SEG_LABEL[k])) as HTMLButtonElement);
  const segBar = fx ? h('div.rd-fix-segs', { role: 'group', 'aria-label': tt('Kinds of corrections') }, ...segBtns) : null;
  const spellBox = h('div.rd-fix-spell', { hidden: true });
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-hidden': 'true', tabindex: '-1' }) as HTMLInputElement;
  fileIn.addEventListener('change', () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (f && fx) void fx.importFile(f).then(() => loadNames());
  });
  const fixFoot = fx ? h('div.rd-fix-foot', null,
    fx.checkNames ? h('button.btn.btn-sm.rd-fix-file.rd-fix-names', { type: 'button', onclick: () => fx.checkNames?.(), title: tt('Strings this book repeats that may be names') }, icon('user'), tt('Check names')) : null,
    h('button.btn.btn-sm.rd-fix-file', { type: 'button', onclick: () => void fx.exportFile() }, icon('download'), tt('Export corrections')),
    h('button.btn.btn-sm.rd-fix-file', { type: 'button', onclick: () => fileIn.click() }, icon('upload'), tt('Import corrections')),
    fileIn) : null;
  const status = h('div.rd-toc-status', { role: 'status' });
  const tabChapters = h('button.rd-toc-tab', { type: 'button', role: 'tab', onclick: () => setTab('chapters') }, tt('Chapters')) as HTMLButtonElement;
  const tabWords = h('button.rd-toc-tab', { type: 'button', role: 'tab', onclick: () => setTab('words') }, tt('Words')) as HTMLButtonElement;
  const tabNames = h('button.rd-toc-tab', { type: 'button', role: 'tab', onclick: () => setTab('names') }, fx ? tt('Corrections') : tt('Names')) as HTMLButtonElement;
  const marks = opts.bookmarks;
  const tabMarks = h('button.rd-toc-tab', { type: 'button', role: 'tab', onclick: () => setTab('bookmarks') }, tt('Bookmarks')) as HTMLButtonElement;
  const markList = h('div.rd-toc-list.rd-marks', { role: 'list', 'aria-label': tt('Bookmarks') });
  const label = (i: number) => text(titles[i] || tt('Chapter {n}', { n: i + 1 }));
  const words = opts.words
    ? createWordsTab(ctx, book, opts.words, { text, rowH: nameRowH, chapterTitle: (i) => titles[i] || tt('Chapter {n}', { n: i + 1 }) })
    : null;
  const tabs = names || words || marks
    ? h('div.rd-toc-tabs', { role: 'tablist' }, tabChapters, words ? tabWords : null, marks ? tabMarks : null, names ? tabNames : null)
    : null;
  const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': tt('Close chapters'), onclick: () => close() }, icon('close'));
  const panel = h('aside.rd-toc', { role: 'dialog', 'aria-modal': 'true', 'aria-label': tt('Chapters'), tabindex: '-1' },
    h('div.rd-toc-head', null,
      h('div', null, h('div.rd-toc-book', null, text(book.title)), h('div.rd-toc-count', null, chapterCount())),
      closeBtn),
    tabs,
    book.chapterCount > 12 ? filter : null,
    names ? nameFilter : null,
    fx ? spellBox : null,
    segBar,
    words?.head ?? null,
    status,
    list,
    words?.list ?? null,
    marks ? markList : null,
    names ? nameList : null,
    fixFoot);
  const backdrop = h('div.rd-backdrop', { onclick: () => close() });
  const root = h('div.rd-toc-root', { hidden: true }, backdrop, panel);
  document.body.appendChild(root);
  /** Open as far as the reader is concerned. A closed drawer can still be on screen for a moment, sliding out (leave). */
  let opened = false;
  /** The slide out and the fade of the backdrop while the drawer leaves. */
  let leaving: Animation[] = [];

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
    if (!shown.length) list.appendChild(h('div.rd-toc-none', null, tt('No chapters match.')));
  }

  // ------------------------------------------------------- corrections tab
  // The names and terms found in the book and the reader's fixes, one list in three parts. A found name's switch says whether it is
  // used ("Not a word" when off); a fix's switch turns it on or off, and Delete takes it away (with Undo).
  function nameRow(pos: number): HTMLElement {
    const r = shownNames[pos];
    const style = ctx.settings.get().pinyinStyle;
    const word = text(r.word);
    const on = h('input.rd-sw-input', { type: 'checkbox', role: 'switch', 'aria-label': r.fix ? tt('Use your correction of {word}', { word }) : tt('Use {word} as a word', { word }) }) as HTMLInputElement;
    on.checked = r.on;
    on.addEventListener('change', async () => {
      on.disabled = true;
      try { if (r.fix && fx) await fx.toggle(r.fix); else if (r.entry) await names!.onToggle(r.entry); } finally { on.disabled = false; }
    });
    const count = r.count ?? (r.fix && !r.fix.at ? counted.get(r.word) : undefined);
    const main = h('button.rd-name-main', {
      type: 'button',
      tabindex: pos === roveName ? '0' : '-1',
      onclick: (e: Event) => names!.onWord(r.entry ?? entryOf(r), (e.currentTarget as HTMLElement).getBoundingClientRect()),
    },
    h('span.rd-name-word.zh', { lang: lang().tag }, word),
    h('span.rd-name-py', null, r.pinyin ? namePinyin({ word: r.word, pinyin: r.pinyin, kind: r.caps ?? r.kind }, style) : r.note ?? ''),
    h('span.rd-name-meta', null,
      h('span.rd-name-kind', { 'data-kind': r.kind }, r.label),
      count ? h('span.rd-name-count', null, `${count}×`) : null,
      fx ? h('span.rd-name-scope', null, r.scope) : null));
    if (r.notName && fx) {
      const del = async () => {
        await fx.askAgain?.(r.word);
        buildRows();
        paintNames();
        ctx.toast(tt('Check names may ask about {word} again.', { word }));
      };
      return h('div.rd-toc-row.rd-name', { role: 'listitem' }, main, h('span.rd-name-switch-none', { 'aria-hidden': 'true' }),
        h('button.icon-btn.rd-fix-del', { type: 'button', 'aria-label': tt('Delete: {word} is not a name', { word }), title: tt('Delete'), onclick: () => void del() }, icon('trash')));
    }
    return h('div.rd-toc-row.rd-name', { role: 'listitem', 'data-off': r.on ? null : '' }, main,
      h('label.rd-name-switch', { title: r.fix ? (r.on ? tt('In use. Turn off to read the page without it.') : tt('Not in use')) : r.on ? tt('Treated as a word. Turn off if this is not one.') : tt('Not treated as a word') }, on,
        h('span.rd-sw-track', null, h('span.rd-sw-thumb'))),
      fx ? (r.fix
        ? h('button.icon-btn.rd-fix-del', { type: 'button', 'aria-label': tt('Delete your correction of {word}', { word }), title: tt('Delete'), onclick: () => void fx.remove(r.fix!) }, icon('trash'))
        : h('span.rd-fix-del-none', { 'aria-hidden': 'true' })) : null);
  }
  const nameWindow = windowed(nameList, nameRow, () => roveName);

  /** The rows of the tab: what was found in the book (unless a fix of the reader's says what the word is), then the fixes. */
  function buildRows(): void {
    const fixes = fx?.list() ?? [];
    const everywhere = (f: Fix) => !f.at && f.book !== '*';
    const unword = new Set(fixes.filter((f) => f.kind === 'unword' && f.on && everywhere(f)).map((f) => f.word));
    const told = new Set(fixes.filter((f) => f.kind === 'word' && everywhere(f)).map((f) => f.word));
    const found = new Set(rows.map((e) => e.word));
    const out: FixRow[] = [];
    for (const e of rows) {
      if (told.has(e.word)) continue;
      out.push({ key: `e:${e.word}`, word: e.word, pinyin: e.pinyin, kind: e.kind, label: tt(KIND_LABEL[e.kind]), seg: e.kind === 'name' || e.kind === 'place' ? 'names' : 'words',
        count: e.count, scope: e.origin === 'user' ? tt('Yours') : tt('Found'), on: e.enabled && !unword.has(e.word), entry: e, gloss: e.gloss });
    }
    for (const f of fixes) {
      if (f.kind === 'spelling' || (f.kind === 'unword' && found.has(f.word) && everywhere(f))) continue;
      const role = f.role ?? 'user';
      const kind: LexiconEntry['kind'] = f.kind === 'word' ? role : 'term';
      const scope = f.book === '*' ? tt('All books') : f.at ? tt('Here, chapter {n}', { n: f.at.chapter + 1 }) : tt('This book');
      const label = f.kind === 'word' ? (role === 'user' ? tt('Joined') : role === 'term' ? tt('Other name') : tt(KIND_LABEL[role])) : f.kind === 'cut' ? tt('Split') : f.kind === 'reading' ? ttx('Reading', 'pronunciation') : tt('Not a word');
      const note = f.kind === 'cut' ? cutPreview(f, text(f.word)) : f.kind === 'unword' ? tt('Not read as one word') : undefined;
      // A person, a place or an other name the reader marked is under Names, its pinyin with capitals (Xīyóushì'èchuán).
      const named = f.kind === 'word' && role !== 'user';
      out.push({ key: `f:${f.id}`, word: f.word, pinyin: f.kind === 'word' || f.kind === 'reading' ? f.pinyin ?? '' : '', kind, label, note,
        seg: f.kind === 'reading' ? 'readings' : named ? 'names' : 'words',
        count: f.at ? 1 : f.n, scope, on: f.on, fix: f, gloss: f.gloss ?? '', ...(named && role === 'term' ? { caps: 'name' as const } : {}) });
    }
    // (水生: a dictionary word said not to be a name changes nothing on the page; it is kept so the name check does not ask again.)
    for (const w of fx?.notNames?.() ?? []) {
      if (found.has(w) || out.some((r) => r.word === w)) continue;
      out.push({ key: `n:${w}`, word: w, pinyin: '', kind: 'term', label: tt('Not a name'), note: tt('Not asked about again'), seg: 'words', scope: tt('This book'), on: true, gloss: '', notName: true });
    }
    fixRows = out;
    // Opened on a part with nothing in it while another has rows: the first part with rows, until the reader picks one.
    if (fx && !segPicked && out.length && !out.some((r) => r.seg === seg)) {
      seg = (['names', 'words', 'readings'] as FixSeg[]).find((k) => out.some((r) => r.seg === k)) ?? seg;
      order = null;
    }
  }

  function paintNames() {
    const q = nameFilter.value.trim().toLowerCase();
    const style = ctx.settings.get().pinyinStyle;
    if (fx) {
      const n = (k: FixSeg) => fixRows.filter((r) => r.seg === k).length;
      segBtns.forEach((b) => {
        const k = b.dataset.seg as FixSeg;
        b.setAttribute('aria-pressed', String(k === seg));
        b.textContent = tt(SEG_COUNT[k], { n: n(k) });
      });
    }
    const pq = plainPinyin(q);
    const sortBy = (a: FixRow, b: FixRow) => Number(b.on) - Number(a.on) || Number(!!b.fix) - Number(!!a.fix) || (b.count ?? 0) - (a.count ?? 0) || a.word.localeCompare(b.word);
    shownNames = fixRows
      .filter((r) => !fx || r.seg === seg)
      .filter((r) => !q || r.word.includes(q) || text(r.word).includes(q) || r.gloss.toLowerCase().includes(q)
        || (!!r.pinyin && (namePinyin({ word: r.word, pinyin: r.pinyin, kind: r.caps ?? r.kind }, style).toLowerCase().includes(q)
          || (!!pq && plainPinyin(namePinyin({ word: r.word, pinyin: r.pinyin, kind: r.kind }, 'marks')).includes(pq)))))
      .sort((a, b) => (order ? (order.get(a.key) ?? Infinity) - (order.get(b.key) ?? Infinity) : 0) || sortBy(a, b));
    order ??= new Map();
    for (const r of shownNames) if (!order.has(r.key)) order.set(r.key, order.size);
    roveName = Math.max(0, Math.min(roveName, shownNames.length - 1));
    nameWindow.set(shownNames.length, nameRowH);
    nameList.querySelector('.rd-toc-none')?.remove();
    if (!shownNames.length) {
      nameList.appendChild(h('div.rd-toc-none', null,
        fixRows.length && !fx ? tt('Nothing matches.')
          : !namesLoaded ? tt('Loading names and terms…')
            : fx && fixRows.length ? (q ? tt('Nothing matches.') : tt(EMPTY_SEG[seg]))
              : isDetecting(book.id) ? tt('No names or terms found yet. Names of people and places in this book appear here once the book has been scanned.')
                : fx ? tt(EMPTY_SEG[seg]) : tt('No names or terms were found in this book.')));
    }
    paintSpellings();
    // The places of a fix's word, counted in the book's text once (they show as the rows come back).
    if (fx) {
      const need = [...new Set(shownNames.filter((r) => r.fix && !r.fix.at && r.count === undefined && !counted.has(r.word)).map((r) => r.word))].slice(0, 40);
      if (need.length) {
        void Promise.all(need.map(async (w) => { counted.set(w, await fx.places(w).catch(() => 0)); })).then(() => { if (tab === 'names' && opened) nameWindow.repaint(); });
      }
    }
  }

  /** The old spellings switches, when the book needs them (core/bookStyle.ts). */
  function paintSpellings(): void {
    const list = fx?.spellings?.() ?? [];
    spellBox.hidden = !list.length;
    if (!list.length) { spellBox.replaceChildren(); return; }
    spellBox.replaceChildren(h('div.rd-fix-spell-title', null, tt('Old spellings')), ...list.map((sw) => {
      const input = h('input.rd-sw-input', { type: 'checkbox', role: 'switch', 'aria-label': sw.label }) as HTMLInputElement;
      input.checked = sw.on;
      input.addEventListener('change', async () => {
        input.disabled = true;
        try { await sw.set(input.checked); } finally { input.disabled = false; }
      });
      return h('label.rd-fix-spell-row', null,
        h('span.rd-fix-spell-text', null, h('span.rd-fix-spell-label.zh', null, sw.label), h('span.rd-fix-spell-hint', null, sw.hint)),
        h('span.rd-name-switch', null, input, h('span.rd-sw-track', null, h('span.rd-sw-thumb'))));
    }));
  }

  async function loadNames() {
    if (!names) return;
    const seq = ++namesSeq;
    try {
      const got = await names.load();
      if (seq !== namesSeq || disposed) return;
      rows = got;
    } catch { rows = []; }
    namesLoaded = true;
    buildRows();
    if (tab === 'names' && opened) paintNames();
  }

  /** Shows tab `next`. `fade` fades its list in: true for a tab picked in the open drawer, not for the one it opens on. */
  function setTab(next: TocTab, fade = true) {
    const was = tab;
    tab = next === 'names' && names ? 'names' : next === 'words' && words ? 'words' : next === 'bookmarks' && marks ? 'bookmarks' : 'chapters';
    order = null;
    const isNames = tab === 'names';
    const isWords = tab === 'words';
    const isMarks = tab === 'bookmarks';
    const isChapters = tab === 'chapters';
    tabChapters.setAttribute('aria-selected', String(isChapters));
    tabWords.setAttribute('aria-selected', String(isWords));
    tabNames.setAttribute('aria-selected', String(isNames));
    tabMarks.setAttribute('aria-selected', String(isMarks));
    markList.hidden = !isMarks;
    list.hidden = !isChapters;
    filter.hidden = !isChapters;
    status.hidden = !isChapters;
    nameList.hidden = !isNames;
    nameFilter.hidden = !isNames;
    if (segBar) segBar.hidden = !isNames;
    if (fixFoot) fixFoot.hidden = !isNames;
    if (!isNames) spellBox.hidden = true;
    if (words) { words.head.hidden = !isWords; words.list.hidden = !isWords; words.setVisible(isWords && opened); }
    panel.setAttribute('aria-label', isNames ? (fx ? tt('Corrections') : tt('Names and terms')) : isWords ? tt('Words in this chapter') : isMarks ? tt('Bookmarks') : tt('Chapters'));
    if (isMarks) void paintMarks();
    else if (isNames) { paintNames(); void loadNames(); }
    else if (isWords) words!.show(currentIndex);
    else { paint(); scrollToCurrent(); }
    // A tab picked in the open drawer: its list fades in over a moment, so the change reads as the same panel turning to
    // another list. Opening on a tab needs nothing more; the drawer's own slide says it.
    if (fade && opened && tab !== was) {
      for (const el of [filter, status, list, nameFilter, segBar, nameList, fixFoot, words?.head, words?.list, markList]) {
        if (el?.isConnected && !el.hidden) play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: EASE });
      }
    }
  }

  async function loadTitles() {
    if (loadingAll) return loadingAll;
    loadingAll = (async () => {
      const need: number[] = [];
      for (let i = 0; i < book.chapterCount; i++) if (!titles[i]) need.push(i);
      if (!need.length) return;
      status.textContent = tt('Loading chapter titles…');
      for (let k = 0; k < need.length && !disposed; k += 20) {
        await Promise.all(need.slice(k, k + 20).map(async (i) => {
          const c = await ctx.store.books.chapter(book.id, i).catch(() => undefined);
          titles[i] = c?.title?.trim() || tt('Chapter {n}', { n: i + 1 });
        }));
        // Redraw the window in place: the row the reader is on keeps its focus.
        if (opened && tab === 'chapters') chapterWindow.repaint();
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

  // ---------------------------------------------------------- bookmarks tab
  async function paintMarks(): Promise<void> {
    if (!marks) return;
    let list: Bookmark[] = [];
    try { list = await marks.list(); } catch { /* shown as empty */ }
    await loadTitles().catch(() => {});
    if (tab !== 'bookmarks') return;
    clear(markList);
    if (!list.length) {
      markList.appendChild(h('div.rd-toc-empty', null, tt('No bookmarks yet. Tap the bookmark at the top of a page to keep your place there.')));
      return;
    }
    for (const b of list) {
      const date = new Date(b.createdAt).toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric' });
      markList.appendChild(h('div.rd-mark', { role: 'listitem' },
        h('button.rd-mark-go', { type: 'button', onclick: () => { close(); marks.pick(b); } },
          h('span.rd-mark-chapter', null, label(b.chapter)),
          h('span.rd-mark-label.zh', { lang: lang().tag }, text(b.label) || '…'),
          h('span.rd-mark-date', null, date)),
        h('button.icon-btn.rd-mark-remove', { type: 'button', 'aria-label': tt('Remove the bookmark in {chapter}', { chapter: label(b.chapter) }), title: tt('Remove'),
          onclick: () => { marks.remove(b); void paintMarks(); } }, icon('trash'))));
    }
  }

  function open(current: number, which: TocTab = 'chapters') {
    opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    currentIndex = current;
    opened = true;
    // Opened again while it was still sliding out: it slides back in from where it got to.
    for (const a of leaving) a.reverse();
    leaving = [];
    root.inert = false;
    root.classList.remove('rd-leaving');
    root.hidden = false;
    filter.value = '';
    nameFilter.value = '';
    segPicked = false;
    rove = current;
    setTab(which, false);
    window.addEventListener('keydown', onKey, true);
    void loadTitles().then(() => { if (opened && tab === 'chapters') { paint(); scrollToCurrent(); } });
    // Into the drawer: the current chapter (or, on the other tab, its first control).
    if (tab === 'chapters') {
      const row = chapterWindow.rowAt(rove)?.querySelector<HTMLElement>('button');
      (row ?? panel).focus({ preventScroll: true });
    } else (tab === 'words' ? tabWords : tab === 'bookmarks' ? tabMarks : tabNames).focus({ preventScroll: true });
  }

  function close() {
    if (!opened) return;
    opened = false;
    leave();
    words?.setVisible(false);
    window.removeEventListener('keydown', onKey, true);
    // Focus goes back to what opened the drawer (the Chapters button, or the page when a key opened it).
    const back = opener && opener.isConnected ? opener : document.querySelector<HTMLElement>('.rd-toc-btn');
    back?.focus({ preventScroll: true });
    opener = null;
  }

  /**
   * The drawer goes back the way it came, to its side, as the backdrop fades: quickly, and taking no taps on the way, so the
   * page is the reader's again at once. Where nothing can move it is simply gone.
   */
  function leave(): void {
    const out = [
      play(panel, [{ transform: 'none' }, { transform: 'translateX(calc(-100% - 16px))' }], { duration: 220, easing: EASE_IN }),
      play(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: EASE }),
    ].filter((a): a is Animation => !!a);
    if (!out.length) { root.hidden = true; return; }
    root.inert = true;
    root.classList.add('rd-leaving');
    leaving = out;
    void Promise.all(out.map((a) => a.finished)).then(() => {
      if (leaving !== out) return;
      leaving = [];
      root.hidden = true;
      root.inert = false;
      root.classList.remove('rd-leaving');
    }, () => {});
  }

  filter.addEventListener('input', () => { paint(); });
  nameFilter.addEventListener('input', () => { order = null; paintNames(); });
  setTab('chapters');

  return {
    open,
    close,
    isOpen: () => opened,
    setCurrent(i) { currentIndex = i; },
    refreshNames() { counted.clear(); if (opened && tab === 'names') void loadNames(); else { rows = []; fixRows = []; namesLoaded = false; } },
    refreshWords() { words?.reload(); },
    refreshBookmarks() { if (opened && tab === 'bookmarks') void paintMarks(); },
    refreshText() {
      if (!opened) return;
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
