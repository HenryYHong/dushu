// "Find a free book": Project Gutenberg's public-domain books in the language being read, most read first, or by title or
// author. The catalog answers any page directly; its files do not, so the EPUB comes through the sync server
// (cloud/src/worker.ts gutenbergBook), which fetches nothing but a Gutenberg book by its number.
import { h } from '../dom';
import { icon } from '../icons';
import { showModal } from './dialogs';
import { lang, langId } from '../../lang/active';
import { cloudBase } from '../../core/cloud';
import type { AppContext, BookMeta } from '../../types';
import type { Importer } from './importer';

const SEARCH = 'https://www.gutenberg.org/ebooks/search.opds/';

export interface FoundBook {
  id: number;
  title: string;
  author: string;
  /** Other languages the book is also in (a bilingual reader), as Gutenberg names them. */
  also: string[];
}

/** The file name a book from Gutenberg is added under, so the dialog can tell it is already in the library. */
export const gutenbergFile = (id: number): string => `gutenberg-${id}.epub`;

/**
 * One page of Gutenberg's OPDS search: its books (navigation entries such as "Sort by" have no book number and are left out),
 * and where the next page starts. A title ends with the languages it is in, "Don Quijote (Spanish)": taken off, and any
 * besides `language` kept apart. An entry with no author has its download count in their place, which is no author.
 */
export function parseOpds(xml: string, language = ''): { books: FoundBook[]; next: number | null } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const books: FoundBook[] = [];
  for (const entry of [...doc.getElementsByTagName('entry')]) {
    const m = /\/ebooks\/(\d+)(?:\.opds)?$/.exec(entry.getElementsByTagName('id')[0]?.textContent?.trim() ?? '');
    if (!m) continue;
    let title = (entry.getElementsByTagName('title')[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const langs: string[] = [];
    for (let t = /\s*\(([A-Z][a-z]+(?: [A-Z][a-z]+)?)\)$/.exec(title); t; t = /\s*\(([A-Z][a-z]+(?: [A-Z][a-z]+)?)\)$/.exec(title)) {
      langs.unshift(t[1]);
      title = title.slice(0, t.index).trim();
    }
    const content = (entry.getElementsByTagName('content')[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const author = /^\d[\d,]* downloads?$/.test(content) ? '' : content;
    if (title) books.push({ id: Number(m[1]), title, author, also: langs.filter((l) => l !== language) });
  }
  let next: number | null = null;
  for (const link of [...doc.getElementsByTagName('link')]) {
    if (link.getAttribute('rel') !== 'next') continue;
    const start = Number(new URL(link.getAttribute('href') ?? '', SEARCH).searchParams.get('start_index'));
    if (start > 0) next = start;
  }
  return { books, next };
}

/** A page of Gutenberg's books in `code` (its language codes are the app's), most downloaded first. */
export async function searchGutenberg(query: string, code: string, start = 1, signal?: AbortSignal): Promise<{ books: FoundBook[]; next: number | null }> {
  const params = new URLSearchParams({ query: `${query.trim()} l.${code}`.trim(), sort_order: 'downloads' });
  if (start > 1) params.set('start_index', String(start));
  const res = await fetch(`${SEARCH}?${params}`, { signal });
  if (!res.ok) throw new Error(`Project Gutenberg answered ${res.status}.`);
  return parseOpds(await res.text(), lang().name);
}

/** The book's EPUB, through the sync server. Throws with the server's own words when it says why it could not. */
export async function fetchGutenberg(id: number, signal?: AbortSignal): Promise<File> {
  const base = cloudBase();
  if (!base) throw new Error('Adding books from Project Gutenberg needs the sync server, which this copy of Globereader does not have.');
  const res = await fetch(`${base}/gutenberg/${id}`, { signal });
  if (!res.ok) {
    const why = await res.json().then((b: { error?: unknown }) => (typeof b?.error === 'string' ? b.error : ''), () => '');
    throw new Error(why || `The book could not be downloaded (${res.status}).`);
  }
  return new File([await res.blob()], gutenbergFile(id), { type: 'application/epub+zip' });
}

export const canFindBooks = (): boolean => !!cloudBase();

/** The dialog. Resolves with the book to open when the reader chose Read on one just added (or already there). */
export function findBooksDialog(ctx: AppContext, importer: Importer): Promise<BookMeta | undefined> {
  const L = lang();
  const code = langId();
  return showModal<BookMeta>('Find a free book', (api) => {
    const input = h('input.input.lib-find-input', { type: 'search', placeholder: 'Title or author', 'aria-label': 'Search Project Gutenberg', autocomplete: 'off', enterkeyhint: 'search' }) as HTMLInputElement;
    const heading = h('div.lib-find-heading', { role: 'status', 'aria-live': 'polite' });
    const list = h('ol.lib-find-list');
    const more = h('button.btn.lib-find-more', { type: 'button', hidden: true }, 'More books') as HTMLButtonElement;
    let have: BookMeta[] = [];
    void ctx.store.books.list().then((b) => { have = b; for (const row of list.children) (row as HTMLElement & { sync?: () => void }).sync?.(); }, () => {});
    const inLibrary = (id: number) => have.find((b) => b.sourceName === gutenbergFile(id));

    const row = (b: FoundBook): HTMLElement => {
      const btn = h('button.btn.btn-sm.lib-find-add', { type: 'button' }) as HTMLButtonElement;
      const err = h('div.lib-find-error', { role: 'alert', hidden: true });
      let added: BookMeta | undefined;
      let busy = false;
      const sync = () => {
        added ??= inLibrary(b.id);
        btn.replaceChildren(...(added ? ['Read'] : busy ? ['Adding…'] : [icon('plus'), 'Add']));
        btn.classList.toggle('btn-primary', !!added);
        btn.disabled = busy;
        btn.setAttribute('aria-label', `${added ? 'Read' : 'Add'} “${b.title}”`);
      };
      btn.addEventListener('click', async () => {
        if (added) { api.close(added); return; }
        busy = true;
        err.hidden = true;
        sync();
        try {
          const file = await fetchGutenberg(b.id);
          let problem = '';
          const [meta] = await importer.files([file], { quiet: true, onProblem: (message, twin) => { if (twin) added = twin; else problem = message; } });
          if (meta) { added = meta; have.push(meta); }
          // The importer names the file, which here is only the book's number: the title is already on the row.
          if (problem) throw new Error(problem.replace(/^“[^”]*”:\s*/, ''));
        } catch (e) {
          err.textContent = navigator.onLine === false ? 'You are offline. Connect to the internet to add books.' : e instanceof Error ? e.message : 'The book could not be added.';
          err.hidden = false;
        } finally {
          busy = false;
          sync();
        }
      });
      sync();
      const li = h('li.lib-find-row', null,
        h('div.lib-find-text', null,
          h('div.lib-find-title', { lang: L.tag }, b.title),
          b.author ? h('div.lib-find-author', null, b.author) : null,
          b.also.length ? h('div.lib-find-note', null, `Also in ${b.also.join(' and ')}`) : null,
          err),
        btn) as HTMLElement & { sync?: () => void };
      li.sync = sync;
      return li;
    };

    let seq = 0;
    let ctrl: AbortController | null = null;
    let next: number | null = null;
    let query = '';
    const load = async (append: boolean) => {
      const mine = ++seq;
      ctrl?.abort();
      ctrl = new AbortController();
      if (!append) {
        list.replaceChildren();
        heading.textContent = 'Searching…';
      }
      more.hidden = true;
      try {
        const page = await searchGutenberg(query, code, append && next ? next : 1, ctrl.signal);
        if (mine !== seq) return;
        next = page.next;
        list.append(...page.books.map(row));
        heading.textContent = list.childElementCount
          ? (query ? `Books in ${L.name} matching “${query}”` : `The most read books in ${L.name}`)
          : (query ? `No books in ${L.name} match “${query}”. Try a shorter title or the author’s last name.` : `Project Gutenberg has no books in ${L.name} yet.`);
        more.hidden = !next;
      } catch (e) {
        if (mine !== seq || (e instanceof DOMException && e.name === 'AbortError')) return;
        heading.textContent = navigator.onLine === false ? 'You are offline. Connect to the internet to find books.' : 'Project Gutenberg did not answer. Try again in a moment.';
      }
    };
    let timer = 0;
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const q = input.value.trim();
        if (q === query) return;
        query = q;
        void load(false);
      }, 400);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      window.clearTimeout(timer);
      query = input.value.trim();
      void load(false);
    });
    more.addEventListener('click', () => void load(true));
    void load(false);
    return {
      body: h('div.lib-find', null,
        h('p.lib-find-intro.muted', null, `Free public-domain books in ${L.name} from Project Gutenberg. Add one and it opens like any other book.`),
        h('div.lib-find-search', null, icon('search'), input),
        heading, list, more),
      footer: [h('span.lib-find-credit.muted', null, 'Books from gutenberg.org, free in the United States.'), h('button.btn', { type: 'button', onclick: () => api.close() }, 'Done')],
      focus: input,
    };
  }, { wide: true });
}
