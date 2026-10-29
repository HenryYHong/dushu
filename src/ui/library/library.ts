// Library screen: book grid, continue card, import (button, drop anywhere, paste), classics. ARCHITECTURE.md 5.4.
import '../../styles/library.css';
import type { AppContext, BookMeta, MountFn, Progress } from '../../types';
import { h, clear } from '../dom';
import { icon } from '../icons';
import { createBookShares } from './bookShare';
import { bookCover, generatedCover, setCoverArt, type Label } from './cover';
import { coverChoice, withCoverChoice, type CoverChoice } from './coverStyle';
import { bookEra } from './era';
import { pageTitle } from '../pageHead';
import { confirmDialog, formDialog } from './dialogs';
import { compactCount, plural, progressFraction, progressLabel } from './format';
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
import { forgetBookInAccount, syncBooks } from '../../core/cloudBooks';
import { isChinese, lang } from '../../lang/active';

/**
 * A book's length as a reader thinks of it: characters for Chinese and Japanese, words for the languages written with spaces
 * (the stored count is letters there, lang/units: about six letters and a space to a word). `short`: "chars" on a card.
 */
function sizeLabel(count: number, short: boolean): string {
  if (lang().spaced) return `${compactCount(Math.round(count / 5.6))} words`;
  return `${compactCount(count)} ${short ? 'chars' : 'characters'}`;
}

const readHref = (id: string) => `#/read/${encodeURIComponent(id)}`;

function progressBar(fraction: number, label?: string): HTMLElement {
  const bar = h('div.lib-bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(fraction * 100), 'aria-label': label ?? 'Progress' },
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

/** One floating menu at a time, anchored under a button; closes on outside click, Esc, scroll or resize. */
function openMenu(anchor: HTMLElement, items: (MenuItem | MenuChoices)[], within?: HTMLElement): void {
  closeMenu();
  const menu = h('div.lib-menu', { role: 'menu' },
    items.map((it) => 'heading' in it
      ? h('div.lib-menu-group', { role: 'group', 'aria-label': it.heading },
        h('div.lib-menu-heading', { 'aria-hidden': 'true' }, it.heading),
        it.options.map((o) => h('button.lib-menu-item.lib-menu-choice', {
          type: 'button', role: 'menuitemradio', 'aria-checked': String(o.checked),
          onclick: () => { closeMenu(); o.run(); },
        }, o.checked ? icon('check') : h('span.lib-menu-blank'), o.label)))
      : h('button.lib-menu-item' + (it.danger ? '.lib-menu-danger' : ''), {
        type: 'button', role: 'menuitem',
        onclick: () => { closeMenu(); it.run(); },
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
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus(); } };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);
  disposeMenu = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeMenu);
    window.removeEventListener('scroll', closeMenu, true);
    menu.remove();
  };
  menu.querySelector<HTMLElement>('button')?.focus();
}
let disposeMenu: (() => void) | null = null;
function closeMenu(): void { disposeMenu?.(); disposeMenu = null; }

// ------------------------------------------------------------------ mount ---

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
  // How much of each book's vocabulary is known (a line on each card).
  const shares = createBookShares(ctx);

  const fileInput = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, 'aria-hidden': 'true', tabindex: -1 }) as HTMLInputElement;
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length) void importer.files(files);
  });
  const importBtn = () => h('button.btn.btn-primary', { type: 'button', onclick: () => fileInput.click() }, icon('upload'), 'Import book');
  const pasteBtn = () => h('button.btn', { type: 'button', onclick: () => void openPaste() }, icon('text'), 'Paste text');

  const headActions = h('div.lib-actions', null, pasteBtn(), importBtn());
  const macBooks = h('button.btn', { type: 'button', hidden: true, onclick: () => void addMacBooks() }, icon('download'), 'Add books from Mac') as HTMLButtonElement;
  headActions.appendChild(macBooks);
  // What this device knows about the Mac: set by refreshMac(), which runs when the library opens and when the connection changes.
  let macState: MacState = 'none';
  let macItems: MacBook[] = [];
  const macNote = h('div.lib-mac-note.card', { role: 'status', hidden: true });
  const head = h('div.page-head', null,
    h('div', null, pageTitle('library', 'Library')),
    headActions);
  const continueEl = h('div.lib-continue-slot');
  const libraryTitle = h('h2', null, 'Your books');
  const libraryCount = h('span.lib-count', { role: 'status', 'aria-live': 'polite' });
  // A short placeholder: on a phone the field is about 200 px wide beside the sort menu, and a long one was cut off.
  const search = h('input.input.lib-search', { type: 'search', placeholder: 'Title or author', 'aria-label': 'Search your library', autocomplete: 'off' }) as HTMLInputElement;
  search.addEventListener('input', () => { query = search.value.trim().toLocaleLowerCase(); renderGrid(); });
  const sort = h('select.select.lib-sort', { 'aria-label': 'Sort library' },
    h('option', { value: 'recent' }, 'Recently read'),
    h('option', { value: 'title' }, 'Title'),
    h('option', { value: 'added' }, 'Recently added')) as HTMLSelectElement;
  sort.addEventListener('change', () => { order = sort.value as typeof order; renderGrid(); });
  const libraryTools = h('section.lib-toolbar', { 'aria-label': 'Your library' },
    h('div.lib-toolbar-head', null, libraryTitle, libraryCount),
    h('div.lib-filters', null, h('div.lib-search-wrap', null, icon('search'), search), sort));
  libraryTools.hidden = true;
  const gridEl = h('div.lib-body');
  const samplesEl = h('div.lib-samples');
  const drop = h('div.lib-drop', { hidden: true, 'aria-hidden': 'true' },
    h('div.lib-drop-box', null, icon('upload', 'icon lib-drop-icon'), h('div.lib-drop-title', null, 'Drop to add to your library'), h('div.muted', null, 'EPUB, Kindle (MOBI or AZW3), TXT, PDF, HTML or Markdown')));
  const page = h('div.page.lib-page', null, head, macNote, continueEl, libraryTools, gridEl, samplesEl, fileInput);
  root.append(page, drop);

  // Progress ticks many times a second: update the running cards in place, and rebuild the grid only when the set of jobs
  // (or a job's title) changes, so covers do not flash.
  let jobsKey = '';
  importer = createImporter(ctx, () => {
    if (!alive) return;
    const key = importer.jobs.map((j) => `${j.id}:${j.title}:${j.author}`).join('|');
    if (key === jobsKey && gridEl.querySelector('.lib-card-pending')) { updatePending(); return; }
    jobsKey = key;
    renderGrid();
  });
  prefetchImporters();

  async function openPaste(): Promise<void> {
    const meta = await pasteDialog((text, title, author) => importer.text(text, title, author));
    if (meta && alive) ctx.navigate(readHref(meta.id));
  }

  // ---- data ----
  async function load(): Promise<void> {
    const mine = ++seq;
    const list = await store.books.list();
    const entries = await Promise.all(list.map(async (b) => [b.id, await store.progress.get(b.id)] as const));
    if (!alive || mine !== seq) return;
    books = list;
    loaded = true;
    progress = new Map(entries.filter((e): e is [string, Progress] => !!e[1]));
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

  function renderContinue(): void {
    clear(continueEl);
    const opened = books.filter((b) => b.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
    // The grid below lists every book, this one included, so its heading says "All books" while this card is up.
    libraryTitle.textContent = opened ? 'All books' : 'Your books';
    if (!opened) return;
    const p = progress.get(opened.id);
    const frac = progressFraction(p);
    const where = p && opened.chapterCount > 1 ? `Chapter ${Math.min(opened.chapterCount, p.chapter + 1)} of ${opened.chapterCount} · ` : '';
    continueEl.appendChild(h('section.lib-continue.card', { 'aria-label': 'Continue reading' },
      h('a.lib-continue-cover', { href: readHref(opened.id), tabindex: -1, 'aria-hidden': 'true' }, bookCover(opened, store, 'sm', ctx.settings.get().covers, labelOf(opened))),
      h('div.lib-continue-info', null,
        h('h2.lib-continue-title.zh', null, shown(opened.title)),
        opened.author ? h('div.lib-continue-author', null, shown(opened.author)) : null,
        h('div.lib-continue-progress', null, progressBar(frac, `Progress in ${opened.title}`), h('span.muted', null, `${where}${progressLabel(p)}`))),
      h('a.btn.btn-primary.lib-continue-go', { href: readHref(opened.id) }, 'Continue', icon('chevronRight'))));
  }

  // ---- grid ----
  function renderGrid(): void {
    headActions.appendChild(macBooks); // preserve the live control when replacing the empty-state card
    clear(gridEl);
    const jobs = importer.jobs;
    if (!loaded && !jobs.length) return;
    const empty = !books.length && !jobs.length;
    libraryTools.hidden = !books.length;
    headActions.hidden = empty; // the empty state carries the same two buttons, bigger
    if (empty) {
      // A phone or tablet has no file to drop and no mouse to drag with: it is told its own way to a sentence.
      const touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
      const gives = isChinese() ? 'its pinyin and meaning' : lang().aid === 'furigana' ? 'its reading and meaning' : 'its meaning';
      gridEl.appendChild(h('section.lib-empty.card', null,
        h('h2.lib-empty-title', null, 'No books yet'),
        h('p', null, touch
          ? 'Import an EPUB, a Kindle file without DRM, a text file or a PDF, or paste a chapter. Or pick a classic below.'
          : 'Import an EPUB, a Kindle file without DRM, a text file or a PDF, or paste a chapter. You can also drop a file anywhere on this page, or pick a classic below.'),
        h('p', null, touch
          ? `Then tap any word for ${gives}, and tap it twice for the whole sentence and its translation.`
          : `Then click any word for ${gives}, or drag across a sentence to translate it.`),
        h('div.lib-actions.lib-empty-actions', null, importBtn(), pasteBtn(), macBooks)));
      return;
    }
    const searchKey = (value: string) => (ctx.dictSync()?.toSimplified(value) ?? value).normalize('NFKC').toLocaleLowerCase();
    const matched = books.filter(book => !query || searchKey(`${book.title} ${book.author}`).includes(searchKey(query)));
    matched.sort((a, b) => order === 'title' ? a.title.localeCompare(b.title, isChinese() ? 'zh-Hans-CN' : lang().tag)
      : order === 'added' ? b.addedAt - a.addedAt
      : (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
    libraryCount.textContent = query ? `${matched.length} of ${books.length}` : plural(books.length, 'book');
    if (!matched.length && !jobs.length) {
      gridEl.appendChild(h('div.lib-no-results', null,
        h('p', null, 'No books match your search.'),
        h('button.btn.btn-sm', { type: 'button', onclick: () => { search.value = ''; query = ''; renderGrid(); search.focus(); } }, 'Clear search')));
      return;
    }
    gridEl.appendChild(h('div.lib-grid', null, jobs.map(pendingCard), matched.map(bookCard)));
  }

  function pendingCard(job: Job): HTMLElement {
    const bar = progressBar(job.fraction, `Adding ${job.title}`);
    setJobBar(bar, job);
    return h('article.lib-card.lib-card-pending', { 'aria-busy': 'true', 'data-job': job.id },
      h('div.lib-cover-wrap.lib-cover-wrap-md', null,
        generatedCover(job.title, job.author, 'md', bookEra({ title: job.title, author: job.author })),
        h('div.lib-cover-busy', null, h('div.app-spinner'))),
      h('div.lib-card-info', null,
        h('div.lib-card-title.zh', null, job.title),
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
      type: 'button', 'aria-label': `Options for ${b.title}`, 'aria-haspopup': 'menu',
      onclick: (e: Event) => {
        e.preventDefault();
        // The Mac's books are always in the library, so they have no Delete.
        const fromMac = isMacBook(b) || !!macItemFor(b, macItems);
        const chosen = coverChoice(ctx.settings.get().covers, b);
        // A book that came with a picture shows it unless a drawn cover is picked; one without is drawn in its era's style.
        const auto = b.cover && !hasSamplePainting(b) ? 'The book’s picture' : `Automatic (${bookEra(b) === 'classic' ? 'Classic' : 'Modern'})`;
        const pick = (c: CoverChoice) => ({
          label: c === 'auto' ? auto : c === 'classic' ? 'Classic' : 'Modern',
          checked: chosen === c,
          // A setting that syncs: the pick shows on every device (the settings listener below draws it here).
          run: () => ctx.settings.set({ covers: withCoverChoice(ctx.settings.get().covers, b, c) }),
        });
        openMenu(menuBtn, [
          { label: 'Rename', icon: 'pen', run: () => void rename(b) },
          ...(fromMac ? [] : [{ label: 'Delete', icon: 'trash' as const, danger: true, run: () => void remove(b) }]),
          { heading: 'Cover', options: [pick('auto'), pick('classic'), pick('modern')] },
        ], card);
      },
    }, icon('more'));
    const label = `${b.title}${b.author ? ', ' + b.author : ''}. ${progressLabel(p)}`;
    const known = shares.text(b.id);
    const card: HTMLElement = h('article.lib-card', { 'data-id': b.id },
      h('a.lib-card-main', { href: readHref(b.id), 'data-label': label, 'aria-label': known ? `${label}. ${known}.` : label },
        bookCover(b, store, 'md', ctx.settings.get().covers, labelOf(b)),
        h('div.lib-card-info', null,
          h('div.lib-card-title.zh', null, shown(b.title)),
          h('div.lib-card-author', null, b.author ? shown(b.author) : ' '),
          progressBar(progressFraction(p)),
          h('div.lib-card-meta', null, h('span', null, progressLabel(p)), h('span', null, sizeLabel(b.charCount, true))),
          shares.line(b))),
      menuBtn);
    return card;
  }

  async function rename(b: BookMeta): Promise<void> {
    const v = await formDialog({
      title: 'Rename book',
      submitLabel: 'Save',
      fields: [
        { name: 'title', label: 'Title', value: b.title, required: true },
        { name: 'author', label: 'Author', value: b.author },
      ],
    });
    if (!v || !alive) return;
    if (v.title === b.title && v.author === b.author) return;
    try { await store.books.update(b.id, { title: v.title, author: v.author }); } catch (e) { ctx.toast(e instanceof Error ? e.message : 'Could not rename the book.'); }
  }

  async function remove(b: BookMeta): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete this book?',
      message: cloudSession()
        ? `“${shown(b.title)}” will be removed from this device and from your account. Your place in it and your saved words stay: add it again and it opens where you left off.`
        : `“${shown(b.title)}” will be removed from this device. Your place in it and your saved words stay: add it again and it opens where you left off.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await store.books.remove(b.id);
      forgetBookInAccount(b);
      if (alive) ctx.toast(`Deleted “${shown(b.title)}”.`);
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : 'Could not delete the book.');
    }
  }

  // ---- classics ----
  function renderSamples(): void {
    clear(samplesEl);
    if (!loaded || !samples.length) return;
    const have = new Map(books.filter((b) => b.sourceName?.startsWith('sample:')).map((b) => [b.sourceName!, b]));
    const loose = samples.filter((s) => !s.group);
    const groups = new Map<string, Sample[]>();
    for (const s of samples) if (s.group) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);

    samplesEl.appendChild(h('h2.lib-samples-title', null, 'Start with a classic'));
    if (loose.length) samplesEl.appendChild(h('div.lib-sample-grid', null, loose.map((s) => sampleCard(s, have.get(sampleSourceName(s.id))))));
    for (const [name, list] of groups) {
      samplesEl.appendChild(h('h3.lib-sample-group', null, name));
      samplesEl.appendChild(h('div.lib-sample-grid', null, list.map((s) => sampleCard(s, have.get(sampleSourceName(s.id))))));
    }
  }

  function sampleCard(s: Sample, existing: BookMeta | undefined): HTMLElement {
    const busy = importer.jobs.some((j) => j.label === `“${s.title}”`);
    const size = [s.chapters && plural(s.chapters, 'chapter'), s.chars && sizeLabel(s.chars, false)].filter(Boolean).join(' · ');
    const go = existing
      ? h('a.btn.btn-sm', { href: readHref(existing.id) }, 'Open')
      : h('button.btn.btn-sm.lib-add', {
          type: 'button',
          disabled: busy,
          onclick: async (e: Event) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            const meta = await importer.sample(s);
            if (!alive) return;
            if (meta) ctx.navigate(readHref(meta.id));
            else btn.disabled = false;
          },
        }, busy ? 'Adding…' : 'Add and read');
    return h('article.lib-sample.card', null,
      h('div.lib-sample-cover', null, existing ? bookCover(existing, store, 'sm', ctx.settings.get().covers, sampleLabel(s)) : sampleCoverEl(s)),
      h('div.lib-sample-info', null,
        h('div.lib-sample-head', null,
          h('div.lib-sample-title.zh', null, sampleShown(s, 'title'))),
        s.author ? h('div.lib-sample-author', null, sampleShown(s, 'author')) : null,
        s.blurb ? h('p.lib-sample-blurb', null, s.blurb) : null,
        h('div.lib-sample-foot', null,
          h('span.muted.lib-sample-size', null, existing ? 'In your library' : [s.level, size].filter(Boolean).join(' · ')),
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
    const forget = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* ignore */ } renderMacNote(); };
    const macNeeded = !signedIn && ((publicCopy && !seen('dushu.public-note.v1')) || macState === 'asleep' || macState === 'refused');
    // In Safari on an iPhone or iPad, once: the Home Screen is this app's App Store (full screen, offline, and Safari keeps its data).
    const homeTip = !macNeeded && onIPhoneOrIPad() && !isStandalone() && !seen('dushu.home-note.v1');
    macNote.hidden = !macNeeded && !homeTip;
    if (macNote.hidden) return;
    clear(macNote);
    if (homeTip) {
      macNote.append(
        h('p', null, 'Add Dushu to your Home Screen: tap Share, then Add to Home Screen. It opens full screen like an app, works offline, and Safari keeps your books.'),
        h('div.lib-actions', null, h('button.btn.btn-sm', { type: 'button', onclick: () => forget('dushu.home-note.v1') }, 'Got it')));
      return;
    }
    if (publicCopy) {
      macNote.append(
        h('p', null, cloudBase()
          ? 'Your books and words are saved in this browser. Sign in with your email to have them on your other devices too.'
          : 'Your books and words are saved in this browser. If you run Dushu on your own Mac, connect this device to it in Settings to use its translator, voices and books.'),
        h('div.lib-actions', null,
          cloudBase()
            ? h('button.btn.btn-sm', { type: 'button', onclick: () => openSignIn() }, 'Sign in')
            : h('a.btn.btn-sm', { href: '#/settings' }, 'Open Settings'),
          h('button.btn.btn-sm', { type: 'button', onclick: () => forget('dushu.public-note.v1') }, 'Dismiss')));
      return;
    }
    macNote.append(
      h('p', null, macState === 'refused'
        ? 'Your Mac answered but did not accept this device. Sign in to Tailscale with the same account as the Mac, then try again.'
        : 'Your Mac did not answer, so its books, translator and voices are paused. Wake the Mac and make sure Tailscale is on, then try again.'),
      h('div.lib-actions', null, h('button.btn.btn-sm', { type: 'button', onclick: () => void refreshMac(true) }, 'Try again')));
  }

  /** Asks the Mac what it has. With `auto`, adds what this device is missing; the person never has to ask. */
  async function refreshMac(auto: boolean): Promise<void> {
    const listing = await fetchMacBooks();
    if (!alive) return;
    macState = listing.state;
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
    macBooks.textContent = 'Adding from Mac…';
    try {
      if (!loaded) await load();
      await refreshMac(false);
      if (macState !== 'ready') { ctx.toast('Your Mac did not answer. Wake it and try again.', { ms: 9000 }); return; }
      const { added, failed } = await syncMacBooks(macItems, syncDeps);
      if (added.length) ctx.toast(addedMessage(added, shown));
      else if (failed) ctx.toast('Could not add the books from your Mac.', { ms: 9000 });
      else ctx.toast('The books on your Mac are already in your library.');
    } catch (e) {
      if (alive) ctx.toast(e instanceof Error ? e.message : 'Could not add the Mac books.', { ms: 9000 });
    } finally {
      macBooks.disabled = false;
      macBooks.replaceChildren(icon('download'), 'Add books from Mac');
    }
  }
  const samplesReady = fetchSamples().catch((): Sample[] => []).then((list) => {
    if (alive) { samples = list; renderSamples(); }
    return list;
  });

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
    await upgradeBooks({
      books: () => store.books.list(),
      macItems: macState === 'ready' ? macItems : [],
      samples: await samplesReady,
      fetchMacFile: fetchMacBookFile,
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

  void load().then(async () => {
    if (!alive) return;
    await dropDuplicates();
    if (!alive) return;
    renderMacNote();
    accountBooks();
    forgetRemovedList();
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
