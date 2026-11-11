// Library screen: book grid, continue card, import (button, drop anywhere, paste), classics. ARCHITECTURE.md 5.4.
import '../../styles/library.css';
import { goalCard } from '../goalCard';
import { canFindBooks, findBooksDialog, parseBookLink } from './findBooks';
import { GUIDE_EVENT } from '../guide';
import { maybeSiteGuide } from '../siteGuide';
import { penguPeek } from '../pengu';
import { INCOMING_EVENT, takeIncoming } from './incoming';
import type { AppContext, BookMeta, MountFn, Progress } from '../../types';
import { h, clear } from '../dom';
import { icon } from '../icons';
import { createBookShares } from './bookShare';
import { bookCover, generatedCover, setCoverArt, type Label } from './cover';
import { coverChoice, withCoverChoice, type CoverChoice } from './coverStyle';
import { bookEra } from './era';
import { pageTitle } from '../pageHead';
import { confirmDialog, formDialog } from './dialogs';
import { compactCount, progressFraction, progressLabel } from './format';
import { ACCEPT, createImporter, jobStage, loadImporters, prefetchImporters, type Importer, type Job } from './importer';
import { pasteDialog } from './paste';
import { fetchSamples, hasSamplePainting, loadSampleBook, sampleCover, sampleSourceName, type Sample, sampleUrl } from './samples';
import { BRIDGE_EVENT, isMacOrigin } from '../../core/macBridge';
import { REMOTE_PROGRESS_EVENT } from '../../core/sync';
import { addedMessage, duplicateMacBooks, fetchMacBookFile, fetchMacBooks, forgetRemovedList, isMacBook, macItemFor, syncMacBooks, type MacBook, type MacState } from './macBooks';
import { withBookLock } from '../../core/bookLock';
import { upgradeBooks } from './upgrade';
import { scriptView } from '../vocab/render';
import { CLOUD_EVENT, cloudBase, cloudSession } from '../../core/cloud';
import { openSignIn } from '../signIn';
import { isStandalone, onIPhoneOrIPad } from '../fullscreen';
import { accountBooks as accountBooksList, accountFileOf, accountBooksHere, forgetBookInAccount, syncBooks, type AccountBook } from '../../core/cloudBooks';
import { isChinese, lang } from '../../lang/active';
import { langName, num, tt, ttm, ttn } from '../../i18n';

/**
 * A book's length as a reader thinks of it: characters for Chinese and Japanese, words for the languages written with spaces
 * (the stored count is letters there, lang/units: about six letters and a space to a word). `short`: "chars" on a card.
 */
function sizeLabel(count: number, short: boolean): string {
  if (lang().spaced) {
    const words = Math.round(count / 5.6);
    return ttn(words, '{n} word', '{n} words', { n: compactCount(words) });
  }
  // {n} is the count as the library writes it short (21k): the form of the word still follows the whole number.
  return short ? ttn(count, '{n} char', '{n} chars', { n: compactCount(count) }) : ttn(count, '{n} character', '{n} characters', { n: compactCount(count) });
}

/** The language being read, named in the app's language ("Spanish"). */
const readingName = (): string => langName(lang().id, isChinese() ? 'Chinese' : lang().name);

/** A sentence with buttons in it: each {name} in `template` is the element of that name, the rest is text. */
function withParts(template: string, parts: Record<string, Node>): (string | Node)[] {
  return template.split(/\{(\w+)\}/).map((piece, i) => (i % 2 ? parts[piece] ?? `{${piece}}` : piece)).filter((x) => x !== '');
}

/**
 * How to look up a word in a first book, by touch or with a mouse, and what a word gives in this language: Chinese its pinyin,
 * Japanese its reading, the others their meaning. `then`: after the ways to add a book.
 */
const HOW: Record<string, string> = {
  'tap|pinyin': ttm('Tap any word for its pinyin and meaning, and tap it twice for the whole sentence and its translation.'),
  'tap|reading': ttm('Tap any word for its reading and meaning, and tap it twice for the whole sentence and its translation.'),
  'tap|meaning': ttm('Tap any word for its meaning, and tap it twice for the whole sentence and its translation.'),
  'click|pinyin': ttm('Click any word for its pinyin and meaning, or drag across a sentence to translate it.'),
  'click|reading': ttm('Click any word for its reading and meaning, or drag across a sentence to translate it.'),
  'click|meaning': ttm('Click any word for its meaning, or drag across a sentence to translate it.'),
  'then|tap|pinyin': ttm('Then tap any word for its pinyin and meaning, and tap it twice for the whole sentence and its translation.'),
  'then|tap|reading': ttm('Then tap any word for its reading and meaning, and tap it twice for the whole sentence and its translation.'),
  'then|tap|meaning': ttm('Then tap any word for its meaning, and tap it twice for the whole sentence and its translation.'),
  'then|click|pinyin': ttm('Then click any word for its pinyin and meaning, or drag across a sentence to translate it.'),
  'then|click|reading': ttm('Then click any word for its reading and meaning, or drag across a sentence to translate it.'),
  'then|click|meaning': ttm('Then click any word for its meaning, or drag across a sentence to translate it.'),
};
function howToRead(touch: boolean, then: boolean): string {
  const gives = isChinese() ? 'pinyin' : lang().aid === 'furigana' ? 'reading' : 'meaning';
  return tt(HOW[`${then ? 'then|' : ''}${touch ? 'tap' : 'click'}|${gives}`]);
}

const readHref = (id: string) => `#/read/${encodeURIComponent(id)}`;
/** Read by a screen reader, not shown (library.css has no class for it). */
const VISUALLY_HIDDEN = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';

function progressBar(fraction: number, label?: string): HTMLElement {
  const bar = h('div.lib-bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(fraction * 100), 'aria-label': label ?? tt('Progress') },
    h('div.lib-bar-fill', { style: `width:${(fraction * 100).toFixed(1)}%` }));
  return bar;
}

/** The bar of a running import: it slides back and forth until the first real progress arrives. */
function setJobBar(bar: HTMLElement, job: Job): void {
  const waiting = job.fraction < 0.02;
  bar.classList.toggle('lib-bar-wait', waiting);
  if (waiting) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(Math.round(job.fraction * 100)));
  (bar.firstElementChild as HTMLElement).style.width = waiting ? '' : `${(job.fraction * 100).toFixed(1)}%`;
}

// ------------------------------------------------------------------ menu ---

interface MenuItem { label: string; icon: string; danger?: boolean; run: () => void }
/** A set of choices shown as radio items under a small heading, the chosen one checked. */
interface MenuChoices { heading: string; options: { label: string; checked: boolean; run: () => void }[] }

/**
 * One floating menu at a time, anchored under a button; closes on outside click, Esc, Tab, scroll or resize. The arrows,
 * Home and End move between its items. Choosing one puts focus back on the button first, so a dialog it opens returns there.
 */
function openMenu(anchor: HTMLElement, items: (MenuItem | MenuChoices)[], within?: HTMLElement): void {
  closeMenu();
  const choose = (run: () => void) => () => { closeMenu(); anchor.focus({ preventScroll: true }); run(); };
  const menu = h('div.lib-menu', { role: 'menu' },
    items.map((it) => 'heading' in it
      ? h('div.lib-menu-group', { role: 'group', 'aria-label': it.heading },
        h('div.lib-menu-heading', { 'aria-hidden': 'true' }, it.heading),
        it.options.map((o) => h('button.lib-menu-item.lib-menu-choice', {
          type: 'button', role: 'menuitemradio', 'aria-checked': String(o.checked),
          onclick: choose(o.run),
        }, o.checked ? icon('check') : h('span.lib-menu-blank'), o.label)))
      : h('button.lib-menu-item' + (it.danger ? '.lib-menu-danger' : ''), {
        type: 'button', role: 'menuitem',
        onclick: choose(it.run),
      }, icon(it.icon), it.label)));
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  // Inside the card it belongs to when there is one, so it never hangs over the next card; otherwise inside the window.
  const box = within?.getBoundingClientRect();
  const min = Math.max(8, box ? box.left : 0);
  const max = Math.min(window.innerWidth - w - 8, box ? box.right - w : Infinity);
  const left = Math.max(min, Math.min(max, r.right - w));
  const flip = r.bottom + menu.offsetHeight + 8 > window.innerHeight && r.top > menu.offsetHeight + 8;
  menu.style.left = `${left}px`;
  menu.style.top = `${flip ? r.top - menu.offsetHeight - 4 : r.bottom + 4}px`;
  const onDown = (e: Event) => { if (!menu.contains(e.target as Node)) closeMenu(); };
  const entries = [...menu.querySelectorAll<HTMLElement>('.lib-menu-item')];
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus({ preventScroll: true }); return; }
    const i = entries.indexOf(document.activeElement as HTMLElement);
    const n = entries.length;
    const to = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i <= 0 ? n - 1 : i - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0 || !n) return;
    // The page never scrolls under the menu (a scroll would close it).
    e.preventDefault();
    entries[to].focus({ preventScroll: true });
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);
  anchor.setAttribute('aria-expanded', 'true');
  disposeMenu = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeMenu);
    window.removeEventListener('scroll', closeMenu, true);
    anchor.setAttribute('aria-expanded', 'false');
    menu.remove();
  };
  entries[0]?.focus({ preventScroll: true });
}
let disposeMenu: (() => void) | null = null;
function closeMenu(): void { disposeMenu?.(); disposeMenu = null; }

// ------------------------------------------------------------------ mount ---

/** The levels of the classics, easiest first. The index files say Beginner, Intermediate or Advanced (public/samples). Shown with tt. */
const LEVELS = [
  { key: 'easy', name: ttm('Easy'), books: ttm('Easy books'), note: ttm('Short and plain: a good first book') },
  { key: 'intermediate', name: ttm('Intermediate'), books: ttm('Intermediate books'), note: ttm('Stories for grown-up readers') },
  { key: 'advanced', name: ttm('Advanced'), books: ttm('Advanced books'), note: ttm('Novels and older, richer language') },
] as const;
type LevelKey = (typeof LEVELS)[number]['key'];
const levelOf = (s: Sample): LevelKey => (/^(beginner|easy)/i.test(s.level ?? '') ? 'easy' : /^intermediate/i.test(s.level ?? '') ? 'intermediate' : 'advanced');

export const mount: MountFn = (root, _params, ctx) => {
  const { store } = ctx;
  let alive = true;
  let seq = 0;
  let books: BookMeta[] = [];
  let progress = new Map<string, Progress>();
  let samples: Sample[] = [];
  let loaded = false;
  let importer: Importer;
  let query = '';
  let order: 'recent' | 'title' | 'added' = 'recent';
  // Until the classics list answers (or 2.5 s pass), a library with no books shows a quiet placeholder where the first book's
  // card will be, not "No books yet" and then a jump.
  let samplesSettled = false;
  let samplesGaveUp = false;
  // Where focus goes when the grid is drawn again after a menu action took its card away (Rename, Delete). Used once.
  let refocus: { id: string; next?: string; until: number } | null = null;
  // The first-book card on screen, kept while only its own classic is being added, so the button says Opening… in place.
  let startShown: { key: string; el: HTMLElement; paint: (busy: boolean) => void } | null = null;
  // How much of each book's vocabulary is known (a line on each card).
  const shares = createBookShares(ctx);

  const fileInput = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, 'aria-hidden': 'true', tabindex: -1 }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length) void importer.files(files);
  });
  const importBtn = () => h('button.btn.btn-primary.lib-import-btn', { type: 'button', onclick: () => fileInput.click() }, icon('upload'), tt('Import book'));
  const pasteBtn = () => h('button.btn.lib-paste-btn', { type: 'button', onclick: () => void openPaste() }, icon('text'), tt('Paste text'));
  const findBtn = () => (canFindBooks() ? h('button.btn.lib-find-btn', { type: 'button', onclick: () => void openFind() }, icon('search'), tt('Find a book')) : null);

  const headActions = h('div.lib-actions', null, findBtn(), pasteBtn(), importBtn());
  const macBooks = h('button.btn', { type: 'button', hidden: true, onclick: () => void addMacBooks() }, icon('download'), tt('Add books from Mac')) as HTMLButtonElement;
  headActions.appendChild(macBooks);
  // What this device knows about the Mac: set by refreshMac(), which runs when the library opens and when the connection changes.
  let macState: MacState = 'none';
  let macChecked = false;
  let macItems: MacBook[] = [];
  const macNote = h('div.lib-mac-note.card', { role: 'status', hidden: true });
  const head = h('div.page-head', null,
    h('div', null, pageTitle('library', tt('Library'))),
    headActions);
  const continueEl = h('div.lib-continue-slot');
  const libraryTitle = h('h2', null, tt('Your books'));
  const libraryCount = h('span.lib-count', { role: 'status', 'aria-live': 'polite' });
  // A short placeholder: on a phone the field is about 200 px wide beside the sort menu, and a long one was cut off.
  const search = h('input.input.lib-search', { type: 'search', placeholder: tt('Title or author'), 'aria-label': tt('Search your library'), autocomplete: 'off' }) as HTMLInputElement;
  search.addEventListener('input', () => { query = search.value.trim().toLocaleLowerCase(); renderGrid(); });
  const sort = h('select.select.lib-sort', { 'aria-label': tt('Sort library') },
    h('option', { value: 'recent' }, tt('Recently read')),
    h('option', { value: 'title' }, tt('Title')),
    h('option', { value: 'added' }, tt('Recently added'))) as HTMLSelectElement;
  sort.addEventListener('change', () => { order = sort.value as typeof order; renderGrid(); });
  const libraryTools = h('section.lib-toolbar', { 'aria-label': tt('Your library') },
    h('div.lib-toolbar-head', null, libraryTitle, libraryCount),
    h('div.lib-filters', null, h('div.lib-search-wrap', null, icon('search'), search), sort));
  libraryTools.hidden = true;
  const gridEl = h('div.lib-body');
  const samplesEl = h('div.lib-samples');
  const drop = h('div.lib-drop', { hidden: true, 'aria-hidden': 'true' },
    h('div.lib-drop-box', null, icon('upload', 'icon lib-drop-icon'), h('div.lib-drop-title', null, tt('Drop to add to your library')), h('div.muted', null, tt('EPUB, Kindle (MOBI or AZW3), TXT, PDF, HTML or Markdown'))));
  const goal = goalCard();
  const page = h('div.page.lib-page', null, head, goal.el, macNote, continueEl, libraryTools, gridEl, samplesEl, fileInput);
  root.append(page, drop);

  // Progress ticks many times a second: update the running cards in place, and rebuild the grid only when the set of jobs
  // (or a job's title) changes, so covers do not flash.
  let jobsKey = '';
  importer = createImporter(ctx, () => {
    if (!alive) return;
    const key = importer.jobs.map((j) => `${j.id}:${j.title}:${j.author}`).join('|');
    if (key === jobsKey && gridEl.querySelector('.lib-card-pending, .lib-start')) { updatePending(); return; }
    jobsKey = key;
    renderGrid();
  });
  prefetchImporters();

  async function openFind(query?: string): Promise<void> {
    const meta = await findBooksDialog(ctx, importer, { query });
    if (meta && alive) ctx.navigate(readHref(meta.id));
  }

  async function openPaste(given?: { text?: string; title?: string }): Promise<void> {
    const meta = await pasteDialog((text, title, author) => importer.text(text, title, author), given);
    if (meta && alive) ctx.navigate(readHref(meta.id));
  }

  /** A book opened with the app, or shared to it: files are added (one opens), a link to a book finds it, text is pasted. */
  const takeOutside = async () => {
    const got = await takeIncoming();
    if (!got || !alive) return;
    if (got.files.length) {
      const added = await importer.files(got.files);
      if (added.length === 1 && alive) ctx.navigate(readHref(added[0].id));
      return;
    }
    const link = [got.url, ...got.text.split(/\s+/)].map((t) => t.trim()).find((t) => t && parseBookLink(t));
    if (link && canFindBooks()) { void openFind(link); return; }
    const text = [got.text, got.url].filter((t) => t.trim()).join('\n\n');
    if (text.trim()) void openPaste({ text, title: got.title });
  };
  const onIncoming = () => void takeOutside();
  window.addEventListener(INCOMING_EVENT, onIncoming);
  void takeOutside();

  // ---- data ----
  async function load(): Promise<void> {
    const mine = ++seq;
    const list = await store.books.list();
    const entries = await Promise.all(list.map(async (b) => [b.id, await store.progress.get(b.id)] as const));
    if (!alive || mine !== seq) return;
    books = list;
    loaded = true;
    progress = new Map(entries.filter((e): e is [string, Progress] => !!e[1]));
    // The sign-in note counts the reader's own books; drawn again once the Mac has answered, so it never flashes before that.
    if (macChecked) renderMacNote();
    renderContinue();
    renderGrid();
    renderSamples();
    shares.measure(list);
  }

  // ---- continue card ----
  /** A title or author in the script the reader chose (Settings → Characters), as the reader shows it. */
  const shown = (t: string): string => scriptView(ctx.settings.get().script, ctx.dictSync()).text(t);
  /** A classic's title or author in the reading script: the list has both, so it shows right away, before the dictionary is in. */
  const sampleShown = (s: Sample, field: 'title' | 'author'): string => {
    const script = ctx.settings.get().script;
    return script === 'original' ? s[field] : s[script]?.[field] ?? shown(s[field]);
  };
  /** A book's title and author for its drawn cover, in the reading script like the words under it. */
  const labelOf = (b: { title: string; author: string }): Label => ({ title: shown(b.title), author: shown(b.author) });
  const sampleLabel = (s: Sample): Label => ({ title: sampleShown(s, 'title'), author: sampleShown(s, 'author') });
  /** The language titles and authors are in (the library's, in the reading script), so a screen reader says them in it. */
  const bookLang = (): string => (isChinese() && ctx.settings.get().script === 'traditional' ? 'zh-Hant' : lang().tag);
  /** The classic a running job is adding, if it is one. */
  const sampleOfJob = (job: Job): Sample | undefined => samples.find((x) => job.label === `“${x.title}”`);

  function renderContinue(): void {
    clear(continueEl);
    const opened = books.filter((b) => b.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
    // The grid below lists every book, this one included, so its heading says "All books" while this card is up.
    libraryTitle.textContent = opened ? tt('All books') : tt('Your books');
    if (!opened) return;
    const p = progress.get(opened.id);
    const frac = progressFraction(p);
    const where = p && opened.chapterCount > 1
      ? `${tt('Chapter {chapter} of {count}', { chapter: num(Math.min(opened.chapterCount, p.chapter + 1)), count: num(opened.chapterCount) })} · ` : '';
    continueEl.appendChild(h('section.lib-continue.card', { 'aria-label': tt('Continue reading') },
      h('a.lib-continue-cover', { href: readHref(opened.id), tabindex: -1, 'aria-hidden': 'true' }, bookCover(opened, store, 'sm', ctx.settings.get().covers, labelOf(opened))),
      h('div.lib-continue-info', null,
        h('h2.lib-continue-title.zh', { lang: bookLang() }, shown(opened.title)),
        opened.author ? h('div.lib-continue-author', { lang: bookLang() }, shown(opened.author)) : null,
        h('div.lib-continue-progress', null, progressBar(frac, tt('Progress in {title}', { title: opened.title })), h('span.muted', null, `${where}${progressLabel(p)}`))),
      h('a.btn.btn-primary.lib-continue-go', { href: readHref(opened.id) }, tt('Continue'), icon('chevronRight'))));
  }

  // ---- grid ----
  function renderGrid(): void {
    headActions.appendChild(macBooks); // preserve the live control when replacing the empty-state card
    const jobs = importer.jobs;
    // The easiest classic, one tap from its first page. While it is being added the library still counts as empty, so its card
    // stays (saying Opening…) until the book opens.
    const first = samples.find((x) => levelOf(x) === 'easy') ?? samples[0];
    const startLabel = first ? `“${first.title}”` : null;
    const empty = !books.length && jobs.every((j) => j.label === startLabel);
    libraryTools.hidden = !books.length;
    // Find a book, Paste text and Import book stay in the header in every state, so adding a book is always where it was.
    headActions.hidden = false;
    // A new reader's first screen is about a first book; the goal and streak come once there is one.
    goal.el.hidden = empty;
    // A phone or tablet has no file to drop and no mouse to drag with: it is told its own way to a sentence.
    const touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
    const startKey = empty && first ? `${first.id}|${sampleShown(first, 'title')}|${touch}|${canFindBooks()}` : '';
    if (startKey && startShown?.key === startKey && gridEl.contains(startShown.el)) { startShown.paint(jobs.length > 0); return; }
    clear(gridEl);
    startShown = null;
    if (!loaded && !jobs.length) return;
    if (empty) {
      if (first) {
        const card = startCard(first, howToRead(touch, false));
        startShown = { key: startKey, ...card };
        // Pengu peeking over the first book's card (ui/pengu.ts).
        gridEl.appendChild(penguPeek(card.el).el);
        settleFocus();
        return;
      }
      // The classics are still on their way: a quiet card where the first book will be, about its height (a column on a phone,
      // library.css), with nothing to read or press yet.
      if (!samplesSettled && !samplesGaveUp) {
        const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 560px)').matches;
        gridEl.appendChild(h('div.card.lib-start-wait', { 'aria-busy': 'true', style: `min-height: ${narrow ? 520 : 310}px` }));
        return;
      }
      const name = readingName();
      // The ways to add a book, in one sentence: a classic below and a free book when there are any, a file always.
      const find = canFindBooks();
      const ways = samples.length && find ? tt('Pick a classic below, find a free book in {lang}, or import an EPUB, a Kindle file without DRM, a text file or a PDF.', { lang: name })
        : samples.length ? tt('Pick a classic below, or import an EPUB, a Kindle file without DRM, a text file or a PDF.')
        : find ? tt('Find a free book in {lang}, or import an EPUB, a Kindle file without DRM, a text file or a PDF.', { lang: name })
        : tt('Import an EPUB, a Kindle file without DRM, a text file or a PDF.');
      const offline = !samples.length && typeof navigator !== 'undefined' && navigator.onLine === false;
      gridEl.appendChild(h('section.lib-empty.card', null,
        h('h2.lib-empty-title', null, tt('No books yet')),
        offline ? h('p', null, tt('You are offline. {lang} classics and the {lang} dictionary download the first time you open {lang} online.', { lang: name })) : null,
        h('p', null, touch ? ways : `${ways} ${tt('You can also drop a file anywhere on this page.')}`),
        h('p', null, howToRead(touch, true)),
        h('div.lib-actions.lib-empty-actions', null, findBtn(), importBtn(), pasteBtn(), macBooks)));
      settleFocus();
      return;
    }
    const searchKey = (value: string) => (ctx.dictSync()?.toSimplified(value) ?? value).normalize('NFKC').toLocaleLowerCase();
    const matched = books.filter(book => !query || searchKey(`${book.title} ${book.author}`).includes(searchKey(query)));
    matched.sort((a, b) => order === 'title' ? a.title.localeCompare(b.title, isChinese() ? 'zh-Hans-CN' : lang().tag)
      : order === 'added' ? b.addedAt - a.addedAt
      : (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
    const total = books.length;
    libraryCount.textContent = query ? tt('{shown} of {total}', { shown: num(matched.length), total: num(total) }) : ttn(total, '{n} book', '{n} books');
    if (!matched.length && !jobs.length) {
      gridEl.appendChild(h('div.lib-no-results', null,
        h('p', null, tt('No books match your search.')),
        h('button.btn.btn-sm', { type: 'button', onclick: () => { search.value = ''; query = ''; renderGrid(); search.focus(); } }, tt('Clear search'))));
      settleFocus();
      return;
    }
    gridEl.appendChild(h('div.lib-grid', null, jobs.map(pendingCard), matched.map(bookCard)));
    settleFocus();
  }

  /**
   * After Rename or Delete the grid is drawn again and the card's menu button goes with it. When focus went with it, it moves
   * to the new card's menu button, or after a Delete to the next book (or the search, or the first thing to press).
   */
  function settleFocus(): void {
    const want = refocus;
    if (!want) return;
    if (Date.now() > want.until) { refocus = null; return; }
    const at = document.activeElement;
    if (at && at !== document.body && at.isConnected) return;
    const cardOf = (id: string | undefined) => (id ? [...gridEl.querySelectorAll<HTMLElement>('.lib-card[data-id]')].find((c) => c.dataset.id === id) : undefined);
    const same = cardOf(want.id);
    const target = same?.querySelector<HTMLElement>('.lib-card-menu')
      ?? cardOf(want.next)?.querySelector<HTMLElement>('.lib-card-main')
      ?? (libraryTools.hidden ? gridEl.querySelector<HTMLElement>('button:not([disabled]), a[href]') : search);
    if (!target) return;
    refocus = null;
    target.focus({ preventScroll: true });
  }

  function pendingCard(job: Job): HTMLElement {
    // A classic is named from the list, in the reading script (it is there before the dictionary); a file by what it is so far.
    const s = sampleOfJob(job);
    const title = s ? sampleShown(s, 'title') : shown(job.title);
    const author = s ? sampleShown(s, 'author') : job.author ? shown(job.author) : '';
    const bar = progressBar(job.fraction, tt('Adding {title}', { title }));
    setJobBar(bar, job);
    return h('article.lib-card.lib-card-pending', { 'aria-busy': 'true', 'data-job': job.id },
      h('div.lib-cover-wrap.lib-cover-wrap-md', null,
        generatedCover(job.title, job.author, 'md', bookEra({ title: job.title, author: job.author }), { title, author }),
        h('div.lib-cover-busy', null, h('div.app-spinner'))),
      h('div.lib-card-info', null,
        h('div.lib-card-title.zh', { lang: bookLang() }, title),
        h('div.lib-card-author.lib-pending-stage', { role: 'status' }, jobStage(job)),
        bar));
  }

  function updatePending(): void {
    for (const job of importer.jobs) {
      const card = gridEl.querySelector<HTMLElement>(`.lib-card-pending[data-job="${job.id}"]`);
      if (!card) continue;
      setJobBar(card.querySelector<HTMLElement>('.lib-bar')!, job);
      const stage = card.querySelector('.lib-pending-stage');
      const text = jobStage(job);
      if (stage && stage.textContent !== text) stage.textContent = text;
    }
  }

  function bookCard(b: BookMeta): HTMLElement {
    const p = progress.get(b.id);
    const menuBtn = h('button.lib-card-menu', {
      type: 'button', 'aria-label': tt('Options for {title}', { title: shown(b.title) }), 'aria-haspopup': 'menu', 'aria-expanded': 'false',
      onclick: (e: Event) => {
        e.preventDefault();
        // The Mac's books are always in the library, so they have no Delete.
        const fromMac = isMacBook(b) || !!macItemFor(b, macItems);
        const chosen = coverChoice(ctx.settings.get().covers, b);
        // A book that came with a picture shows it unless a drawn cover is picked; one without is drawn in its era's style.
        const auto = b.cover && !hasSamplePainting(b) ? tt('The book’s picture') : bookEra(b) === 'classic' ? tt('Automatic (Classic)') : tt('Automatic (Modern)');
        const pick = (c: CoverChoice) => ({
          label: c === 'auto' ? auto : c === 'classic' ? tt('Classic') : tt('Modern'),
          checked: chosen === c,
          // A setting that syncs: the pick shows on every device (the settings listener below draws it here).
          run: () => ctx.settings.set({ covers: withCoverChoice(ctx.settings.get().covers, b, c) }),
        });
        openMenu(menuBtn, [
          { label: tt('Rename'), icon: 'pen', run: () => void rename(b) },
          ...(fromMac ? [] : [{ label: tt('Delete'), icon: 'trash' as const, danger: true, run: () => void remove(b) }]),
          { heading: tt('Cover'), options: [pick('auto'), pick('classic'), pick('modern')] },
        ], card);
      },
    }, icon('more'));
    // The link is named by what it shows: the title and author in the book's language (a screen reader says them in it), how far
    // in, and the known-words line once there is one. The bar and the size line are for the eye.
    const bar = progressBar(progressFraction(p));
    bar.setAttribute('aria-hidden', 'true');
    const card: HTMLElement = h('article.lib-card', { 'data-id': b.id },
      h('a.lib-card-main', { href: readHref(b.id) },
        bookCover(b, store, 'md', ctx.settings.get().covers, labelOf(b)),
        h('div.lib-card-info', null,
          h('div.lib-card-title.zh', { lang: bookLang() }, shown(b.title)),
          b.author ? h('div.lib-card-author', { lang: bookLang() }, shown(b.author)) : h('div.lib-card-author', { 'aria-hidden': 'true' }, ' '),
          bar,
          h('span', { style: VISUALLY_HIDDEN }, tt('{progress}.', { progress: progressLabel(p) })),
          h('div.lib-card-meta', { 'aria-hidden': 'true' }, h('span', null, progressLabel(p)), h('span', null, sizeLabel(b.charCount, true))),
          shares.line(b))),
      menuBtn);
    return card;
  }

  /** After a dialog from a card's menu: focus back on the menu button when it went nowhere (jsdom, or the card was redrawn). */
  function backToMenu(id: string): void {
    const at = document.activeElement;
    if (at && at !== document.body && at.isConnected) return;
    [...gridEl.querySelectorAll<HTMLElement>('.lib-card[data-id]')].find((c) => c.dataset.id === id)?.querySelector<HTMLElement>('.lib-card-menu')?.focus({ preventScroll: true });
  }

  async function rename(b: BookMeta): Promise<void> {
    const v = await formDialog({
      title: tt('Rename book'),
      submitLabel: tt('Save'),
      fields: [
        { name: 'title', label: tt('Title'), value: b.title, required: true },
        { name: 'author', label: tt('Author'), value: b.author },
      ],
    });
    if (!alive) return;
    if (!v || (v.title === b.title && v.author === b.author)) { backToMenu(b.id); return; }
    // The card is drawn again with the new name: focus follows it to its new menu button.
    refocus = { id: b.id, until: Date.now() + 4000 };
    try { await store.books.update(b.id, { title: v.title, author: v.author }); } catch (e) { refocus = null; backToMenu(b.id); ctx.toast(e instanceof Error ? e.message : tt('Could not rename the book.')); }
  }

  async function remove(b: BookMeta): Promise<void> {
    const ok = await confirmDialog({
      title: tt('Delete this book?'),
      message: accountBooksHere()
        ? tt('“{title}” will be removed from this device and from your account. Your place in it, your saved words and your corrections stay: add it again and it opens where you left off.', { title: shown(b.title) })
        : tt('“{title}” will be removed from this device. Your place in it, your saved words and your corrections stay: add it again and it opens where you left off.', { title: shown(b.title) }),
      confirmLabel: tt('Delete'),
      danger: true,
    });
    if (!alive) return;
    if (!ok) { backToMenu(b.id); return; }
    // Once the card is gone, focus moves to the book after it (or before it, when it was the last).
    const cards = [...gridEl.querySelectorAll<HTMLElement>('.lib-card[data-id]')];
    const at = cards.findIndex((c) => c.dataset.id === b.id);
    refocus = { id: b.id, next: (cards[at + 1] ?? cards[at - 1])?.dataset.id, until: Date.now() + 4000 };
    try {
      await store.books.remove(b.id);
      forgetBookInAccount(b);
      if (alive) ctx.toast(tt('Deleted “{title}”.', { title: shown(b.title) }));
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : tt('Could not delete the book.'));
    }
  }

  /**
   * The first book for a reader with none: the easiest classic, to start in one tap, and the other ways to add one. `paint`
   * shows the button busy (Opening…) while the classic is being added.
   */
  function startCard(s: Sample, how: string): { el: HTMLElement; paint: (busy: boolean) => void } {
    const title = sampleShown(s, 'title');
    const start = h('button.btn.btn-primary.lib-start-go', { type: 'button' }) as HTMLButtonElement;
    const paint = (busy: boolean) => {
      start.disabled = busy;
      start.setAttribute('aria-label', busy ? tt('Opening “{title}”', { title }) : tt('Start reading “{title}”', { title }));
      start.replaceChildren(...(busy ? [tt('Opening…')] : [tt('Start reading'), icon('chevronRight')]));
    };
    paint(importer.jobs.some((j) => j.label === `“${s.title}”`));
    start.addEventListener('click', async () => {
      paint(true);
      const meta = await importer.sample(s);
      if (!alive) return;
      if (meta) ctx.navigate(readHref(meta.id));
      else paint(false);
    });
    const link = (label: string, run: () => void) => h('button.lib-start-link', { type: 'button', onclick: run }, label);
    // One sentence with the links in it, so each language puts them where its word order wants them.
    const links = {
      find: link(tt('find a free book in {lang}', { lang: readingName() }), () => void openFind()),
      paste: link(tt('paste some text'), () => void openPaste()),
      import: link(tt('import a file'), () => fileInput.click()),
    };
    const others = withParts(canFindBooks() ? tt('Or {find}, {paste} or {import}.') : tt('Or {paste} or {import}.'), links);
    const el = h('section.lib-start.card', { 'aria-label': tt('Your first book') },
      h('div.lib-start-cover', null, sampleCoverEl(s)),
      h('div.lib-start-body', null,
        h('div.lib-start-kicker', null, tt('Your first book')),
        h('h2.lib-start-title.zh', { lang: bookLang() }, title),
        s.author ? h('div.lib-start-author', { lang: bookLang() }, sampleShown(s, 'author')) : null,
        s.blurb ? h('p.lib-start-blurb', null, tt(s.blurb)) : null,
        h('p.lib-start-how', null, how),
        h('div.lib-start-actions', null, start),
        h('p.lib-start-other', null, others, ` ${tt('EPUB, Kindle without DRM, text and PDF files all work.')}`)));
    return { el, paint };
  }

  // ---- classics ----
  function renderSamples(): void {
    clear(samplesEl);
    if (!loaded || !samples.length) return;
    const have = new Map(books.filter((b) => b.sourceName?.startsWith('sample:')).map((b) => [b.sourceName!, b]));
    const card = (s: Sample) => sampleCard(s, have.get(sampleSourceName(s.id)));

    samplesEl.appendChild(h('h2.lib-samples-title', null, tt('Start with a classic')));
    // By level, easiest first, so a reader picks a first book by how hard it is; a named set (the four great novels) stays
    // together inside its level.
    for (const level of LEVELS) {
      const here = samples.filter((s) => levelOf(s) === level.key);
      if (!here.length) continue;
      const section = h('section.lib-level', { 'data-level': level.key, 'aria-label': tt(level.books) },
        h('h3.lib-level-title', null, h('span.lib-level-name', null, tt(level.name)), h('span.lib-level-note', null, tt(level.note))));
      const loose = here.filter((s) => !s.group);
      if (loose.length) section.appendChild(h('div.lib-sample-grid', null, loose.map(card)));
      const groups = new Map<string, Sample[]>();
      for (const s of here) if (s.group) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
      for (const [name, list] of groups) {
        section.appendChild(h('h4.lib-sample-group', null, name));
        section.appendChild(h('div.lib-sample-grid', null, list.map(card)));
      }
      samplesEl.appendChild(section);
    }
  }

  function sampleCard(s: Sample, existing: BookMeta | undefined): HTMLElement {
    const busy = importer.jobs.some((j) => j.label === `“${s.title}”`);
    const chapters = s.chapters ?? 0;
    const size = [chapters && ttn(chapters, '{n} chapter', '{n} chapters'), s.chars && sizeLabel(s.chars, false)].filter(Boolean).join(' · ');
    // Each button names its book: a list of a dozen "Add and read" says nothing to a screen reader.
    const title = sampleShown(s, 'title');
    const go = existing
      ? h('a.btn.btn-sm', { href: readHref(existing.id), 'aria-label': tt('Open “{title}”', { title }) }, tt('Open'))
      : h('button.btn.btn-sm.lib-add', {
          type: 'button',
          disabled: busy,
          'aria-label': busy ? tt('Adding “{title}”', { title }) : tt('Add and read “{title}”', { title }),
          onclick: async (e: Event) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            const meta = await importer.sample(s);
            if (!alive) return;
            if (meta) ctx.navigate(readHref(meta.id));
            else btn.disabled = false;
          },
        }, busy ? tt('Adding…') : tt('Add and read'));
    return h('article.lib-sample.card', null,
      h('div.lib-sample-cover', null, existing ? bookCover(existing, store, 'sm', ctx.settings.get().covers, sampleLabel(s)) : sampleCoverEl(s)),
      h('div.lib-sample-info', null,
        h('div.lib-sample-head', null,
          h('div.lib-sample-title.zh', { lang: bookLang() }, title),
          h('span.lib-level-badge', { 'data-level': levelOf(s) }, tt(LEVELS.find((l) => l.key === levelOf(s))!.name))),
        s.author ? h('div.lib-sample-author', { lang: bookLang() }, sampleShown(s, 'author')) : null,
        s.blurb ? h('p.lib-sample-blurb', null, tt(s.blurb)) : null,
        h('div.lib-sample-foot', null,
          h('span.muted.lib-sample-size', null, existing ? tt('In your library') : size),
          go)));
  }

  // ---- drag and drop anywhere on the page ----
  let depth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const onEnter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; drop.hidden = false; };
  const onOver = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
  const onLeave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) drop.hidden = true; };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) void importer.files(files);
  };
  window.addEventListener('dragenter', onEnter);
  window.addEventListener('dragover', onOver);
  window.addEventListener('dragleave', onLeave);
  window.addEventListener('drop', onDrop);

  // The store also fires this when another tab imports, renames or deletes a book, so a second tab needs no reload.
  const offChange = store.onChange((what) => {
    if (what === 'books') void load();
    else if (what === 'known') shares.refresh();
  });
  // A reading place from another device moves the progress bars.
  const onRemoteProgress = () => void load();
  window.addEventListener(REMOTE_PROGRESS_EVENT, onRemoteProgress);
  // Titles follow the script setting: drawn again when it changes, and once the dictionary that converts them is in.
  const redrawTitles = () => { if (!alive) return; renderContinue(); renderGrid(); renderSamples(); };
  const offSettings = ctx.settings.subscribe((_s, changed) => {
    if (changed.includes('script')) redrawTitles();
    // A cover picked here, or on another device and synced.
    if (changed.includes('covers')) { renderContinue(); renderGrid(); renderSamples(); }
  });
  if (!ctx.dictSync() && ctx.settings.get().script !== 'original') void ctx.dict().then(redrawTitles, () => {});

  // ---- the Mac's books ----
  const syncDeps = {
    list: () => store.books.list(),
    fetchFile: fetchMacBookFile,
    add: (files: File[]) => importer.files(files, { quiet: true, mac: true }),
    update: (id: string, patch: Partial<BookMeta>) => store.books.update(id, patch),
  };

  function renderMacNote(): void {
    // Signed in, the account brings the books, Claude and sync, and a Mac that does not answer only means no Mac voices: the
    // note is not shown.
    const signedIn = !!cloudSession();
    const publicCopy = macState === 'none' && !isMacOrigin();
    const seen = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
    const forget = (key: string, value = '1') => { try { localStorage.setItem(key, value); } catch { /* ignore */ } renderMacNote(); };
    // A visitor's own books (not the classics) live only in this browser. Dismissing the note keeps it away until they add
    // another one: it holds how many they had then ('1', from before, counts as none).
    const own = books.filter((b) => !b.sourceName?.startsWith('sample:')).length;
    const dismissedAt = (() => { try { const v = localStorage.getItem('dushu.public-note.v1'); return v === null ? -1 : v === '1' ? 0 : Number(v) || 0; } catch { return 0; } })();
    const keepNote = publicCopy && (dismissedAt < 0 || own > dismissedAt);
    const macNeeded = !signedIn && (keepNote || macState === 'asleep' || macState === 'refused');
    // In Safari on an iPhone or iPad, once: the Home Screen is this app's App Store (full screen, offline, and Safari keeps its data).
    const homeTip = !macNeeded && onIPhoneOrIPad() && !isStandalone() && !seen('dushu.home-note.v1');
    macNote.hidden = !macNeeded && !homeTip;
    if (macNote.hidden) return;
    clear(macNote);
    if (homeTip) {
      macNote.append(
        h('p', null, tt('Add LinguPengu to your Home Screen: tap Share, then Add to Home Screen. It opens full screen like an app, works offline, and Safari keeps your books.')),
        h('div.lib-actions', null, h('button.btn.btn-sm', { type: 'button', onclick: () => forget('dushu.home-note.v1') }, tt('Got it'))));
      return;
    }
    if (publicCopy) {
      macNote.append(
        h('p', null, cloudBase()
          ? own ? tt('Books you add are only saved in this browser. Sign in to keep them.') : tt('Your books and words are only saved in this browser. Sign in to keep them.')
          : tt('Your books and words are saved in this browser. If you run LinguPengu on your own Mac, connect this device to it in Settings to use its translator, voices and books.')),
        h('div.lib-actions', null,
          cloudBase()
            ? h('button.btn.btn-sm', { type: 'button', onclick: () => openSignIn() }, tt('Sign in'))
            : h('a.btn.btn-sm', { href: '#/settings' }, tt('Open Settings')),
          h('button.btn.btn-sm', { type: 'button', onclick: () => forget('dushu.public-note.v1', String(own)) }, tt('Dismiss'))));
      return;
    }
    macNote.append(
      h('p', null, macState === 'refused'
        ? tt('Your Mac answered but did not accept this device. Sign in to Tailscale with the same account as the Mac, then try again.')
        : tt('Your Mac did not answer, so its books, translator and voices are paused. Wake the Mac and make sure Tailscale is on, then try again.')),
      h('div.lib-actions', null, h('button.btn.btn-sm', { type: 'button', onclick: () => void refreshMac(true) }, tt('Try again'))));
  }

  /** Asks the Mac what it has. With `auto`, adds what this device is missing; the person never has to ask. */
  async function refreshMac(auto: boolean): Promise<void> {
    const listing = await fetchMacBooks();
    if (!alive) return;
    macState = listing.state;
    macChecked = true;
    // The Mac's books are the owner's Chinese books: another language's library never takes them.
    macItems = isChinese() ? listing.books : [];
    macBooks.hidden = !(macState === 'ready' && macItems.length);
    renderMacNote();
    if (auto && macState === 'ready' && macItems.length) {
      if (!loaded) await load();
      const { added } = await syncMacBooks(macItems, syncDeps);
      if (added.length) ctx.toast(addedMessage(added, shown), { ms: 6000 });
    }
  }

  /** The manual button: adds what is missing now, and says what happened. */
  async function addMacBooks(): Promise<void> {
    if (macBooks.disabled || !alive) return;
    macBooks.disabled = true;
    macBooks.textContent = tt('Adding from Mac…');
    try {
      if (!loaded) await load();
      await refreshMac(false);
      if (macState !== 'ready') { ctx.toast(tt('Your Mac did not answer. Wake it and try again.'), { ms: 9000 }); return; }
      const { added, failed } = await syncMacBooks(macItems, syncDeps);
      if (added.length) ctx.toast(addedMessage(added, shown));
      else if (failed) ctx.toast(tt('Could not add the books from your Mac.'), { ms: 9000 });
      else ctx.toast(tt('The books on your Mac are already in your library.'));
    } catch (e) {
      if (alive) ctx.toast(e instanceof Error ? e.message : tt('Could not add the Mac books.'), { ms: 9000 });
    } finally {
      macBooks.disabled = false;
      macBooks.replaceChildren(icon('download'), tt('Add books from Mac'));
    }
  }
  // A slow network: after 2.5 s the empty library says how else to add a book. The list, when it comes, still brings the
  // first-book card.
  const giveUp = setTimeout(() => { samplesGaveUp = true; if (alive && !books.length) renderGrid(); }, 2500);
  const samplesReady = fetchSamples().catch((): Sample[] => []).then((list) => {
    samplesSettled = true;
    clearTimeout(giveUp);
    if (alive) { samples = list; renderSamples(); if (!books.length) renderGrid(); }
    return list;
  });
  // Opened offline in a language never opened before, the list is not on the device: back online, it is asked for again.
  let askingAgain = false;
  const onOnline = () => {
    if (!alive) return;
    if (samples.length || askingAgain) { if (!books.length) renderGrid(); return; }
    askingAgain = true;
    void fetchSamples().then((list) => {
      askingAgain = false;
      if (!alive) return;
      if (list.length) { samples = list; renderSamples(); }
      if (!books.length) renderGrid();
    });
  };
  const onOffline = () => { if (alive && !books.length) renderGrid(); };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  /** A classic not added yet: its drawn cover, with its painting as the board. */
  function sampleCoverEl(s: Sample): HTMLElement {
    const drawn = generatedCover(s.title, s.author, 'sm', bookEra({ title: s.title, author: s.author, sourceName: sampleSourceName(s.id) }), sampleLabel(s));
    if (s.cover) setCoverArt(drawn, sampleUrl(s.cover));
    return h('div.lib-cover-wrap.lib-cover-wrap-sm', null, drawn);
  }

  /** Classics added before they had covers get theirs, and ones showing a painting since replaced get the new one, once each
   *  (a drawn cover picked in the menu still wins). */
  async function coverOldSamples(list: Sample[]): Promise<void> {
    for (const b of books) {
      const s = b.sourceName?.startsWith('sample:') && (!b.cover || hasSamplePainting(b)) ? list.find((x) => sampleSourceName(x.id) === b.sourceName) : undefined;
      const from = s?.cover ? `sample:${s.cover}` : '';
      if (!s || !from || b.coverFrom === from || !alive) continue;
      const image = await sampleCover(s);
      if (image) await store.books.setCover(b.id, image, from).catch(() => {});
    }
  }

  /** Books made by an older importer are imported again, quietly, when they can be fetched (upgrade.ts). */
  async function upgradeOld(): Promise<void> {
    if (!alive) return;
    // Asked once per pass, and only when a book needs it.
    let listing: Promise<AccountBook[]> | undefined;
    const accountList = () => (listing ??= accountBooksList());
    await upgradeBooks({
      books: () => store.books.list(),
      macItems: macState === 'ready' ? macItems : [],
      samples: await samplesReady,
      fetchMacFile: fetchMacBookFile,
      fetchAccountFile: (b) => accountFileOf(b, accountList),
      importFile: async (file) => (await loadImporters()).importFile(file),
      importSample: async (s) => loadSampleBook(s, (await loadImporters()).importText),
      replace: (id, book) => store.books.replace(id, book),
      alive: () => alive,
    }).catch(() => 0);
  }

  const onBridge = () => void refreshMac(true).then(upgradeOld);
  window.addEventListener(BRIDGE_EVENT, onBridge);
  // Back in front: the Mac may have woken, Tailscale come on, or a book been put in the Mac's book folder meanwhile.
  const onVisible = () => { if (document.visibilityState === 'visible' && loaded) void refreshMac(true); };
  document.addEventListener('visibilitychange', onVisible);

  // ---- books in the sync account: a book added here goes up soon after (core/cloudBooks.ts; main.ts runs it on open too and
  // says what it did) ----
  let booksTimer: ReturnType<typeof setTimeout> | undefined;
  const accountBooks = () => { if (alive && cloudSession()) void syncBooks(store); };
  const offBooks = store.onChange((what) => {
    if (what !== 'books') return;
    clearTimeout(booksTimer);
    booksTimer = setTimeout(accountBooks, 3000);
  });
  const onCloud = () => { renderMacNote(); accountBooks(); };
  window.addEventListener(CLOUD_EVENT, onCloud);
  /**
   * A Mac book here twice (it came from the Mac and from the account at the same moment, before the book lock) keeps one copy,
   * the one read in most recently. Only this device's copy goes: the account and the reading place are left alone.
   */
  async function dropDuplicates(): Promise<void> {
    await withBookLock(async () => {
      const extra = duplicateMacBooks(await store.books.list(), (id) => progress.get(id)?.updatedAt ?? 0);
      for (const id of extra) await store.books.remove(id).catch(() => {});
    });
  }

  // The library's walkthrough (siteGuide.ts): due after the welcome, or when Settings asks for it again.
  let stopGuide = () => {};
  const startGuide = () => { stopGuide(); stopGuide = maybeSiteGuide(); };
  window.addEventListener(GUIDE_EVENT, startGuide);

  void load().then(async () => {
    if (!alive) return;
    await dropDuplicates();
    if (!alive) return;
    renderMacNote();
    accountBooks();
    forgetRemovedList();
    // The walkthrough, once after the welcome: when the classics are listed, so the first step can point at the first book.
    void samplesReady.finally(() => { if (alive) startGuide(); });
    await refreshMac(true);
    void upgradeOld();
    void samplesReady.then((list) => coverOldSamples(list));
    if (!alive || !new URLSearchParams(location.search).has('importLocalBooks')) return;
    // Explicit opt-in only. Home Screen users can also choose Add books from Mac in Library.
    history.replaceState(null, '', location.pathname + location.hash);
    await addMacBooks();
  });

  return () => {
    alive = false;
    stopGuide();
    window.removeEventListener(GUIDE_EVENT, startGuide);
    clearTimeout(giveUp);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener(INCOMING_EVENT, onIncoming);
    goal.dispose();
    closeMenu();
    offChange();
    offSettings();
    offBooks();
    clearTimeout(booksTimer);
    window.removeEventListener(CLOUD_EVENT, onCloud);
    shares.dispose();
    window.removeEventListener(REMOTE_PROGRESS_EVENT, onRemoteProgress);
    window.removeEventListener(BRIDGE_EVENT, onBridge);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('dragenter', onEnter);
    window.removeEventListener('dragover', onOver);
    window.removeEventListener('dragleave', onLeave);
    window.removeEventListener('drop', onDrop);
  };
};
