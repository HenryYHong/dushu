// Library screen: book grid, continue card, import (button, drop anywhere, paste), classics. ARCHITECTURE.md 5.4.
import '../../styles/library.css';
import type { AppContext, BookMeta, MountFn, Progress } from '../../types';
import { h, clear } from '../dom';
import { icon } from '../icons';
import { bookCover, generatedCover } from './cover';
import { confirmDialog, formDialog } from './dialogs';
import { compactCount, plural, progressFraction, progressLabel } from './format';
import { ACCEPT, createImporter, prefetchImporters, type Importer, type Job } from './importer';
import { pasteDialog } from './paste';
import { fetchSamples, sampleSourceName, type Sample } from './samples';
import { hasMacBridge } from '../../core/macBridge';

const readHref = (id: string) => `#/read/${encodeURIComponent(id)}`;

function progressBar(fraction: number, label?: string): HTMLElement {
  const bar = h('div.lib-bar', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(fraction * 100), 'aria-label': label ?? 'Progress' },
    h('div.lib-bar-fill', { style: `width:${(fraction * 100).toFixed(1)}%` }));
  return bar;
}

// ------------------------------------------------------------------ menu ---

interface MenuItem { label: string; icon: string; danger?: boolean; run: () => void }

/** One floating menu at a time, anchored under a button; closes on outside click, Esc, scroll or resize. */
function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  closeMenu();
  const menu = h('div.lib-menu', { role: 'menu' },
    items.map((it) => h('button.lib-menu-item' + (it.danger ? '.lib-menu-danger' : ''), {
      type: 'button', role: 'menuitem',
      onclick: () => { closeMenu(); it.run(); },
    }, icon(it.icon), it.label)));
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w));
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
  if (hasMacBridge()) void fetch('/api/local-books', { cache: 'no-store', signal: AbortSignal.timeout(3000) }).then(async response => {
    if (!response.ok) return;
    const available = await response.json();
    if (alive && Array.isArray(available) && available.length) macBooks.hidden = false;
  }).catch(() => {});
  const head = h('div.page-head', null,
    h('div', null, h('h1.page-title', null, 'Library'), h('p.page-sub', null, 'Your books stay on this device.')),
    headActions);
  const continueEl = h('div.lib-continue-slot');
  const libraryCount = h('span.lib-count', { role: 'status', 'aria-live': 'polite' });
  const search = h('input.input.lib-search', { type: 'search', placeholder: 'Search books or authors', 'aria-label': 'Search your library', autocomplete: 'off' }) as HTMLInputElement;
  search.addEventListener('input', () => { query = search.value.trim().toLocaleLowerCase(); renderGrid(); });
  const sort = h('select.select.lib-sort', { 'aria-label': 'Sort library' },
    h('option', { value: 'recent' }, 'Recently read'),
    h('option', { value: 'title' }, 'Title'),
    h('option', { value: 'added' }, 'Recently added')) as HTMLSelectElement;
  sort.addEventListener('change', () => { order = sort.value as typeof order; renderGrid(); });
  const libraryTools = h('section.lib-toolbar', { 'aria-label': 'Your library' },
    h('div.lib-toolbar-head', null, h('h2', null, 'Your books'), libraryCount),
    h('div.lib-filters', null, search, sort));
  libraryTools.hidden = true;
  const gridEl = h('div.lib-body');
  const samplesEl = h('div.lib-samples');
  const drop = h('div.lib-drop', { hidden: true, 'aria-hidden': 'true' },
    h('div.lib-drop-box', null, icon('upload', 'icon lib-drop-icon'), h('div.lib-drop-title', null, 'Drop to add to your library'), h('div.muted', null, 'EPUB, Kindle (MOBI or AZW3), TXT, PDF, HTML or Markdown')));
  const page = h('div.page.lib-page', null, head, continueEl, libraryTools, gridEl, samplesEl, fileInput);
  root.append(page, drop);

  importer = createImporter(ctx, () => { if (alive) renderGrid(); });
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
  }

  // ---- continue card ----
  function renderContinue(): void {
    clear(continueEl);
    const opened = books.filter((b) => b.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
    if (!opened) return;
    const p = progress.get(opened.id);
    const frac = progressFraction(p);
    const where = p && opened.chapterCount > 1 ? `Chapter ${Math.min(opened.chapterCount, p.chapter + 1)} of ${opened.chapterCount} · ` : '';
    continueEl.appendChild(h('section.lib-continue.card', { 'aria-label': 'Continue reading' },
      h('a.lib-continue-cover', { href: readHref(opened.id), tabindex: -1, 'aria-hidden': 'true' }, bookCover(opened, store, 'sm')),
      h('div.lib-continue-info', null,
        h('span.chip.chip-accent', null, 'Continue reading'),
        h('h2.lib-continue-title.zh', null, opened.title),
        opened.author ? h('div.lib-continue-author', null, opened.author) : null,
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
      gridEl.appendChild(h('section.lib-empty.card', null,
        h('div.lib-empty-mark.zh', { 'aria-hidden': 'true' }, '读书'),
        h('h2.lib-empty-title', null, 'Read real Chinese books, and look up anything'),
        h('p', null, 'Import an EPUB, Kindle file (without DRM), text file or PDF, or paste a chapter. Tap any word to see its pinyin and meaning, and drag across a sentence to translate it.'),
        h('p.muted', null, 'Drop a file anywhere on this page, or start with one of the classics below.'),
        h('div.lib-actions.lib-empty-actions', null, importBtn(), pasteBtn(), macBooks)));
      return;
    }
    const searchKey = (value: string) => (ctx.dictSync()?.toSimplified(value) ?? value).normalize('NFKC').toLocaleLowerCase();
    const matched = books.filter(book => !query || searchKey(`${book.title} ${book.author}`).includes(searchKey(query)));
    matched.sort((a, b) => order === 'title' ? a.title.localeCompare(b.title, 'zh-Hans-CN')
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
    return h('article.lib-card.lib-card-pending', { 'aria-busy': 'true' },
      h('div.lib-cover-wrap.lib-cover-wrap-md', null, h('div.lib-cover.lib-cover-md.lib-cover-blank', null, h('div.app-spinner'))),
      h('div.lib-card-info', null,
        h('div.lib-card-title', null, 'Adding…'),
        h('div.lib-card-author', null, job.label),
        progressBar(job.fraction, 'Import progress')));
  }

  function bookCard(b: BookMeta): HTMLElement {
    const p = progress.get(b.id);
    const menuBtn = h('button.lib-card-menu', {
      type: 'button', 'aria-label': `Options for ${b.title}`, 'aria-haspopup': 'menu',
      onclick: (e: Event) => {
        e.preventDefault();
        openMenu(menuBtn, [
          { label: 'Rename', icon: 'pen', run: () => void rename(b) },
          { label: 'Delete', icon: 'trash', danger: true, run: () => void remove(b) },
        ]);
      },
    }, icon('menu'));
    return h('article.lib-card', { 'data-id': b.id },
      h('a.lib-card-main', { href: readHref(b.id), 'aria-label': `${b.title}${b.author ? ', ' + b.author : ''}. ${progressLabel(p)}` },
        bookCover(b, store, 'md'),
        h('div.lib-card-info', null,
          h('div.lib-card-title.zh', null, b.title),
          h('div.lib-card-author', null, b.author || ' '),
          progressBar(progressFraction(p)),
          h('div.lib-card-meta', null, h('span', null, progressLabel(p)), h('span', null, `${compactCount(b.charCount)} chars`)))),
      menuBtn);
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
      message: `“${b.title}” and your reading progress in it will be removed from this device. Your saved words stay.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await store.books.remove(b.id);
      if (alive) ctx.toast(`Deleted “${b.title}”.`);
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

    samplesEl.appendChild(h('h2.section-title', null, 'Start with a classic'));
    samplesEl.appendChild(h('p.lib-samples-sub.muted', null, 'Free to read, all in the public domain. One click adds the book and opens it.'));
    if (loose.length) samplesEl.appendChild(h('div.lib-sample-grid', null, loose.map((s) => sampleCard(s, have.get(sampleSourceName(s.id))))));
    for (const [name, list] of groups) {
      samplesEl.appendChild(h('h3.lib-sample-group', null, name));
      samplesEl.appendChild(h('div.lib-sample-grid', null, list.map((s) => sampleCard(s, have.get(sampleSourceName(s.id))))));
    }
  }

  function sampleCard(s: Sample, existing: BookMeta | undefined): HTMLElement {
    const busy = importer.jobs.some((j) => j.label === `“${s.title}”`);
    const size = [s.chapters && plural(s.chapters, 'chapter'), s.chars && `${compactCount(s.chars)} characters`].filter(Boolean).join(' · ');
    const go = existing
      ? h('a.btn.btn-sm', { href: readHref(existing.id) }, 'Open')
      : h('button.btn.btn-sm.btn-primary', {
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
      h('div.lib-sample-cover', null, generatedCover(s.title, s.author, 'sm')),
      h('div.lib-sample-info', null,
        h('div.lib-sample-head', null,
          h('div.lib-sample-title.zh', null, s.title),
          s.level ? h('span.chip', null, s.level) : null),
        s.author ? h('div.lib-sample-author', null, s.author) : null,
        s.blurb ? h('p.lib-sample-blurb', null, s.blurb) : null,
        h('div.lib-sample-foot', null,
          h('span.muted.lib-sample-size', null, existing ? 'In your library' : size),
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

  const offChange = store.onChange((what) => { if (what === 'books') void load(); });

  async function addMacBooks(): Promise<void> {
    if (macBooks.disabled || !alive) return;
    macBooks.disabled = true;
    macBooks.textContent = 'Adding from Mac…';
    try {
      if (!loaded) await load();
      const response = await fetch('/api/local-books', { cache: 'no-store' });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('The local book service is unavailable.');
      const available = await response.json() as { id: string; name: string }[];
      let added = 0;
      for (const item of available) {
        if (!alive) return;
        if (books.some(b => b.sourceName === item.name)) continue;
        const fileResponse = await fetch(`/api/local-books/${encodeURIComponent(item.id)}`, { cache: 'no-store' });
        if (!fileResponse.ok) throw new Error(`Could not read ${item.name}.`);
        const file = new File([await fileResponse.blob()], item.name, { type: 'application/epub+zip' });
        added += (await importer.files([file])).length;
      }
      if (!added && alive) ctx.toast('The available Mac books are already in your library, or none could be added.');
    } catch (e) {
      if (alive) ctx.toast(e instanceof Error ? e.message : 'Could not add the local books.', { ms: 9000 });
    } finally {
      macBooks.disabled = false;
      macBooks.replaceChildren(icon('download'), 'Add books from Mac');
    }
  }
  void load().then(async () => {
    if (!alive || !new URLSearchParams(location.search).has('importLocalBooks')) return;
    // Explicit opt-in only. Home Screen users can also choose Add books from Mac in Library.
    history.replaceState(null, '', location.pathname + location.hash);
    await addMacBooks();
  });
  void fetchSamples().then((list) => { if (!alive) return; samples = list; renderSamples(); });

  return () => {
    alive = false;
    closeMenu();
    offChange();
    window.removeEventListener('dragenter', onEnter);
    window.removeEventListener('dragover', onOver);
    window.removeEventListener('dragleave', onLeave);
    window.removeEventListener('drop', onDrop);
  };
};
