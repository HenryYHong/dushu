// "Find a free book", from two public-domain libraries:
// - Project Gutenberg: books in the language being read, most read first, or by title or author. Its catalog (OPDS) answers any
//   page directly; its files do not, so the EPUB comes through the sync server (cloud/src/worker.ts gutenbergBook).
// - Wikisource: any work on the language's Wikisource, by title or author, made an EPUB by Wikisource's own exporter
//   (ws-export) through the sync server (wikisourceBook); its search API answers any page. Chinese and Japanese open on it,
//   since Gutenberg has few of their books.
// - Aozora Bunko (青空文庫), for Japanese: its catalog is shipped as a search index (public/data/ja/aozora.tsv.gz, made by
//   scripts/lang/ja/build_aozora_index.py) and searched on the page; the work's XHTML page, with the readings it prints, comes
//   through the sync server (aozoraBook). Japanese opens on it.
// The sync server fetches nothing but a book from those places.
import { h } from '../dom';
import { icon } from '../icons';
import { showModal } from './dialogs';
import { lang, langId } from '../../lang/active';
import { cloudBase } from '../../core/cloud';
import { fetchDataText } from '../../core/dict';
import type { AppContext, BookMeta } from '../../types';
import type { LangId } from '../../lang/types';
import type { Importer } from './importer';

const GUTENBERG_SEARCH = 'https://www.gutenberg.org/ebooks/search.opds/';

export type SourceId = 'gutenberg' | 'wikisource' | 'aozora';

export interface FoundBook {
  source: SourceId;
  /** Gutenberg's book number, or the Wikisource page's title. */
  key: string;
  title: string;
  author: string;
  /** Other languages the book is also in (a bilingual reader), as Gutenberg names them. */
  also: string[];
  /** A word about the edition (Aozora: older spelling). */
  note?: string;
  /** The file name it is added under, when the key does not make it (Aozora: by its work id). */
  file?: string;
}

/** The file name a book is added under, so the dialog can tell it is already in the library. */
export const gutenbergFile = (id: number | string): string => `gutenberg-${id}.epub`;
export const wikisourceFile = (code: string, title: string): string => `wikisource-${code}-${title.replace(/[/\\:*?"<>|]+/g, '_')}.epub`;
export const aozoraFile = (id: string): string => `aozora-${id}.html`;
const fileOf = (b: FoundBook, code: string) => b.file ?? (b.source === 'gutenberg' ? gutenbergFile(b.key) : wikisourceFile(code, b.key));

/** One work in Aozora Bunko's index. */
export interface AozoraWork { id: string; title: string; reading: string; authors: string; authorReadings: string; modern: boolean; path: string; rank: number }

export function parseAozoraIndex(text: string): AozoraWork[] {
  const out: AozoraWork[] = [];
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const [id, title, reading, authors, authorReadings, modern, path, rank] = line.split('\t');
    if (!id || !title || !/^\d{6}\/\d+_\d+\.html$/.test(path ?? '')) continue;
    out.push({ id, title, reading: reading ?? '', authors: authors ?? '', authorReadings: authorReadings ?? '', modern: modern === '1', path, rank: Number(rank) || 0 });
  }
  return out;
}

/** For matching: full-width and half-width alike, katakana as hiragana, no spaces or middle dots, lower case. */
export function foldJa(s: string): string {
  return s.normalize('NFKC').replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s・･]+/g, '').toLowerCase();
}

/**
 * Works matching a query by title, reading, author or the author's reading: a title that is the query first, then one that
 * starts with it, then the rest, each in the index's order (most read, then modern spelling). No query: the index's order.
 */
export function searchAozora(works: AozoraWork[], query: string): AozoraWork[] {
  const q = foldJa(query);
  if (!q) return works;
  const exact: AozoraWork[] = [];
  const starts: AozoraWork[] = [];
  const rest: AozoraWork[] = [];
  for (const w of works) {
    const title = foldJa(w.title);
    const reading = foldJa(w.reading);
    if (title === q || reading === q) exact.push(w);
    else if (title.startsWith(q) || reading.startsWith(q)) starts.push(w);
    else if (title.includes(q) || reading.includes(q) || foldJa(w.authors).includes(q) || foldJa(w.authorReadings).includes(q)) rest.push(w);
  }
  return [...exact, ...starts, ...rest];
}

let aozoraIndex: Promise<AozoraWork[]> | null = null;
const loadAozora = (): Promise<AozoraWork[]> => {
  aozoraIndex ??= fetchDataText(new URL('data/ja/aozora.tsv.gz', document.baseURI).href).then(parseAozoraIndex, (e: unknown) => { aozoraIndex = null; throw e; });
  return aozoraIndex;
};
const AOZORA_PAGE = 25;
const aozoraBook = (w: AozoraWork): FoundBook => ({
  source: 'aozora', key: w.path, title: w.title, author: w.authors, also: [], file: aozoraFile(w.id),
  ...(w.modern ? {} : { note: 'Older spelling (旧仮名遣い)' }),
});

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
    if (title) books.push({ source: 'gutenberg', key: m[1], title, author, also: langs.filter((l) => l !== language) });
  }
  let next: number | null = null;
  for (const link of [...doc.getElementsByTagName('link')]) {
    if (link.getAttribute('rel') !== 'next') continue;
    const start = Number(new URL(link.getAttribute('href') ?? '', GUTENBERG_SEARCH).searchParams.get('start_index'));
    if (start > 0) next = start;
  }
  return { books, next };
}

/** A page of Gutenberg's books in `code` (its language codes are the app's), most downloaded first. */
export async function searchGutenberg(query: string, code: string, start = 1, signal?: AbortSignal): Promise<{ books: FoundBook[]; next: number | null }> {
  const params = new URLSearchParams({ query: `${query.trim()} l.${code}`.trim(), sort_order: 'downloads' });
  if (start > 1) params.set('start_index', String(start));
  const res = await fetch(`${GUTENBERG_SEARCH}?${params}`, { signal });
  if (!res.ok) throw new Error(`Project Gutenberg answered ${res.status}.`);
  return parseOpds(await res.text(), lang().name);
}

/** A list of a work's editions or of works sharing a name: a page to choose from, not a book. */
const LIST_PAGE = /versions pages|disambiguation|éditions multiples|homonymie|begriffskl|消歧|曖昧|многозначн|desambiguaci|disambigua/i;

/**
 * Wikisource's search results that are works, in its order: a part of one ("吶喊/狂人日記"), an author's or a portal's page, and
 * a list of editions or of works with the same name (flagged as disambiguation, or in such a category) are left out. Titles are
 * plain text from the API (its snippets, which carry markup, are never used).
 */
export function parseWikisourceSearch(json: unknown): { books: FoundBook[]; next: number | null } {
  type Page = { title?: unknown; index?: unknown; pageprops?: { disambiguation?: unknown }; categories?: { title?: unknown }[] };
  const d = json as { query?: { pages?: Page[] }; continue?: { gsroffset?: unknown } };
  const pages = [...(d?.query?.pages ?? [])].sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  const books: FoundBook[] = [];
  for (const p of pages) {
    const title = typeof p.title === 'string' ? p.title.trim() : '';
    if (!title || title.includes('/') || /^(?:Author|Autor|Auteur|Autore|Автор|作者|Portal|Portail|Категория|Category|Catégorie)\s*:/i.test(title)) continue;
    if (p.pageprops && 'disambiguation' in p.pageprops) continue;
    if ((p.categories ?? []).some((c) => typeof c.title === 'string' && LIST_PAGE.test(c.title))) continue;
    books.push({ source: 'wikisource', key: title, title, author: '', also: [] });
  }
  const offset = Number(d?.continue?.gsroffset);
  return { books, next: Number.isInteger(offset) && offset > 0 ? offset : null };
}

export async function searchWikisource(query: string, code: string, offset = 0, signal?: AbortSignal): Promise<{ books: FoundBook[]; next: number | null }> {
  const params = new URLSearchParams({
    action: 'query', generator: 'search', gsrsearch: query.trim(), gsrnamespace: '0', gsrlimit: '25',
    prop: 'pageprops|categories', ppprop: 'disambiguation', cllimit: 'max', format: 'json', formatversion: '2', origin: '*',
  });
  if (offset > 0) params.set('gsroffset', String(offset));
  const res = await fetch(`https://${code}.wikisource.org/w/api.php?${params}`, { signal });
  if (!res.ok) throw new Error(`Wikisource answered ${res.status}.`);
  return parseWikisourceSearch(await res.json());
}

/**
 * Where to start on Wikisource, which has no "most read" list: well-known works whose pages hold the whole work, checked
 * 2026-11-09 (modern prose first for Chinese, then the long classics; Japanese has few modern works there).
 */
const WIKISOURCE_STARTERS: Partial<Record<LangId, string[]>> = {
  zh: ['吶喊', '彷徨', '朝花夕拾', '故事新編', '野艸', '阿Q正傳', '浮生六記', '老殘遊記', '儒林外史', '鏡花緣', '聊齋志異', '世說新語', '封神演義'],
  ja: ['蜘蛛の糸', '竹取物語', '土佐日記', '方丈記', '徒然草', '伊勢物語', '更級日記', '枕草子', '源氏物語'],
};

/** The book's EPUB, through the sync server. Throws with the server's own words when it says why it could not. */
export async function fetchFound(b: FoundBook, code: string, signal?: AbortSignal): Promise<File> {
  const base = cloudBase();
  if (!base) throw new Error('Adding free books needs the sync server, which this copy of Globereader does not have.');
  const url = b.source === 'gutenberg' ? `${base}/gutenberg/${b.key}`
    : b.source === 'aozora' ? `${base}/aozora/${b.key}`
    : `${base}/wikisource/${code}/${encodeURIComponent(b.key)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const why = await res.json().then((x: { error?: unknown }) => (typeof x?.error === 'string' ? x.error : ''), () => '');
    throw new Error(why || `The book could not be downloaded (${res.status}).`);
  }
  return new File([await res.blob()], fileOf(b, code), { type: b.source === 'aozora' ? 'text/html' : 'application/epub+zip' });
}

/** Kept for callers from before Wikisource: a Gutenberg book by its number. */
export const fetchGutenberg = (id: number, signal?: AbortSignal): Promise<File> =>
  fetchFound({ source: 'gutenberg', key: String(id), title: '', author: '', also: [] }, langId(), signal);

export const canFindBooks = (): boolean => !!cloudBase();

const SOURCES: Record<SourceId, { name: string; credit: string }> = {
  aozora: { name: '青空文庫', credit: 'Works from Aozora Bunko (aozora.gr.jp), out of copyright in Japan.' },
  gutenberg: { name: 'Project Gutenberg', credit: 'Books from gutenberg.org, free in the United States.' },
  wikisource: { name: 'Wikisource', credit: 'Works from Wikisource, free to read and share.' },
};

/** The sources offered for a language, the first one open: Japanese reads Aozora Bunko first, Chinese Wikisource. */
export const sourcesFor = (code: LangId): SourceId[] =>
  code === 'ja' ? ['aozora', 'wikisource', 'gutenberg'] : code === 'zh' ? ['wikisource', 'gutenberg'] : ['gutenberg', 'wikisource'];

/** The dialog. Resolves with the book to open when the reader chose Read on one just added (or already there). */
export function findBooksDialog(ctx: AppContext, importer: Importer): Promise<BookMeta | undefined> {
  const L = lang();
  const code = langId();
  const name = code === 'zh' ? 'Chinese' : L.name;
  return showModal<BookMeta>('Find a free book', (api) => {
    const offered = sourcesFor(code);
    let source: SourceId = offered[0];
    const input = h('input.input.lib-find-input', { type: 'search', placeholder: 'Title or author', 'aria-label': 'Search for a book', autocomplete: 'off', enterkeyhint: 'search' }) as HTMLInputElement;
    const intro = h('p.lib-find-intro.muted');
    const heading = h('div.lib-find-heading', { role: 'status', 'aria-live': 'polite' });
    const list = h('ol.lib-find-list');
    const more = h('button.btn.lib-find-more', { type: 'button', hidden: true }, 'More books') as HTMLButtonElement;
    const credit = h('span.lib-find-credit.muted');
    const tabs = offered.map((id) => {
      const b = h('button.lib-find-tab', { type: 'button', role: 'tab', 'aria-selected': 'false', ...(id === 'aozora' ? { title: 'Aozora Bunko' } : {}) }, SOURCES[id].name) as HTMLButtonElement;
      b.addEventListener('click', () => { if (source !== id) { source = id; showSource(); void load(false); } });
      return b;
    });
    const tabBar = h('div.lib-find-tabs', { role: 'tablist', 'aria-label': 'Where to look' }, tabs);
    let have: BookMeta[] = [];
    void ctx.store.books.list().then((b) => { have = b; for (const row of list.children) (row as HTMLElement & { sync?: () => void }).sync?.(); }, () => {});
    const inLibrary = (b: FoundBook) => have.find((m) => m.sourceName === fileOf(b, code));

    const row = (b: FoundBook): HTMLElement => {
      const btn = h('button.btn.btn-sm.lib-find-add', { type: 'button' }) as HTMLButtonElement;
      const err = h('div.lib-find-error', { role: 'alert', hidden: true });
      let added: BookMeta | undefined;
      let busy = false;
      const sync = () => {
        added ??= inLibrary(b);
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
          const file = await fetchFound(b, code);
          let problem = '';
          const [meta] = await importer.files([file], { quiet: true, onProblem: (message, twin) => { if (twin) added = twin; else problem = message; } });
          if (meta) { added = meta; have.push(meta); }
          // The importer names the file, which here is only the book's number or page: the title is already on the row.
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
          b.note ? h('div.lib-find-note', null, b.note) : null,
          err),
        btn) as HTMLElement & { sync?: () => void };
      li.sync = sync;
      return li;
    };

    let seq = 0;
    let ctrl: AbortController | null = null;
    let next: number | null = null;
    let query = '';
    const showSource = () => {
      tabs.forEach((t, i) => t.setAttribute('aria-selected', String(offered[i] === source)));
      credit.textContent = SOURCES[source].credit;
      intro.textContent = source === 'gutenberg'
        ? `Free public-domain books in ${name} from Project Gutenberg. Add one and it opens like any other book.`
        : source === 'aozora'
          ? 'Over 17,000 works out of copyright in Japan, with the readings the library prints over hard words. Search by title or author, in kanji or kana.'
          : `Any work on the ${name} Wikisource, made into a book with its chapters. Search by title or author.`;
    };
    const load = async (append: boolean) => {
      const mine = ++seq;
      ctrl?.abort();
      ctrl = new AbortController();
      if (!append) { list.replaceChildren(); next = null; }
      heading.textContent = append ? heading.textContent : 'Searching…';
      more.hidden = true;
      try {
        let page: { books: FoundBook[]; next: number | null };
        if (source === 'aozora') {
          const found = searchAozora(await loadAozora(), query);
          const from = append && next ? next : 0;
          const to = from + AOZORA_PAGE;
          page = { books: found.slice(from, to).map(aozoraBook), next: to < found.length ? to : null };
        } else if (source === 'wikisource' && !query) {
          const starters = WIKISOURCE_STARTERS[code];
          if (!starters) {
            heading.textContent = `Type a title or an author to search the ${name} Wikisource.`;
            return;
          }
          page = { books: starters.map((t) => ({ source: 'wikisource', key: t, title: t, author: '', also: [] })), next: null };
        } else {
          page = source === 'gutenberg'
            ? await searchGutenberg(query, code, append && next ? next : 1, ctrl.signal)
            : await searchWikisource(query, code, append && next ? next : 0, ctrl.signal);
        }
        if (mine !== seq) return;
        next = page.next;
        list.append(...page.books.map(row));
        heading.textContent = list.childElementCount
          ? (query ? `Books in ${name} matching “${query}”` : source === 'wikisource' ? `Well-known works to start with` : `The most read books in ${name}`)
          : (query ? `No books in ${name} match “${query}”. Try a shorter title or the author’s last name${source === 'gutenberg' && WIKISOURCE_STARTERS[code] === undefined ? ', or look on Wikisource' : ''}.`
            : `${SOURCES[source].name} has no books in ${name} yet.`);
        more.hidden = !next;
      } catch (e) {
        if (mine !== seq || (e instanceof DOMException && e.name === 'AbortError')) return;
        heading.textContent = navigator.onLine === false ? 'You are offline. Connect to the internet to find books.' : `${SOURCES[source].name} did not answer. Try again in a moment.`;
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
    showSource();
    void load(false);
    return {
      body: h('div.lib-find', null, tabBar, intro, h('div.lib-find-search', null, icon('search'), input), heading, list, more),
      footer: [credit, h('button.btn', { type: 'button', onclick: () => api.close() }, 'Done')],
      focus: input,
    };
  }, { wide: true });
}
