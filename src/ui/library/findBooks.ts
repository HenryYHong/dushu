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
import { scriptView } from '../vocab/render';
import { cloudBase } from '../../core/cloud';
import { LANGS, isLangId } from '../../lang/registry';
import { targetLanguage } from '../../translate/targets';
import { fetchDataText } from '../../core/dataFetch';
import type { AppContext, BookMeta } from '../../types';
import type { LangId } from '../../lang/types';
import { isNetworkFailure, type Importer } from './importer';
import { hash } from '../../core/syncKeys';
import { langName, tt, ttm, uiLang, uiLocale } from '../../i18n';

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
  /** Gutenberg lists it as a recording (its sound icon): most have no text to add, so the dialog asks before offering it. */
  audio?: boolean;
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
  ...(w.modern ? {} : { note: tt('Older spelling (旧仮名遣い)') }),
});

/**
 * The languages Gutenberg names at the end of a title, "Don Quijote (Spanish)": every reading language and the others its
 * books in them are most often also in. Anything else in parentheses is the title's own ("Niebla (Nivola)").
 */
const GUTENBERG_LANGUAGES = new Set<string>([
  ...Object.values(LANGS).map((l) => l.name),
  'Latin', 'Catalan', 'Galician', 'Basque', 'Occidental', 'Tagalog', 'Esperanto', 'Interlingua', 'Dutch', 'Greek', 'Middle English',
  'Old English', 'Arabic', 'Hebrew', 'Polish', 'Czech', 'Slovak', 'Slovenian', 'Croatian', 'Serbian', 'Bulgarian', 'Ukrainian',
  'Romanian', 'Hungarian', 'Finnish', 'Estonian', 'Swedish', 'Danish', 'Norwegian', 'Icelandic', 'Irish', 'Welsh', 'Scots',
  'Gaelic', 'Breton', 'Frisian', 'Provencal', 'Occitan', 'Friulian', 'Romansh', 'Sanskrit', 'Korean', 'Vietnamese', 'Tibetan',
  'Persian', 'Turkish', 'Armenian', 'Georgian', 'Yiddish', 'Afrikaans', 'Maori', 'Hawaiian', 'Ilocano', 'Cebuano', 'Bodo',
]);
const LANGUAGE_GROUP = /\s*\(([A-Z][a-z]+(?: [A-Z][a-z]+)?)\)$/;
/** Gutenberg's thumbnail for a recording (a speaker, as a data: URI), by its hash: the only sign of one in a search page. */
const SOUND_ICON = '17zjt7gbso2';

/**
 * One page of Gutenberg's OPDS search: its books (navigation entries such as "Sort by" have no book number and are left out),
 * and where the next page starts. A title ends with the languages it is in, "Don Quijote (Spanish)": taken off while they are
 * languages, and only when they name `language` (every result is in it), and any besides `language` kept apart. An entry with
 * no author has its download count in their place, which is no author. One with the sound icon is marked `audio`.
 */
export function parseOpds(xml: string, language = ''): { books: FoundBook[]; next: number | null } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const books: FoundBook[] = [];
  for (const entry of [...doc.getElementsByTagName('entry')]) {
    const m = /\/ebooks\/(\d+)(?:\.opds)?$/.exec(entry.getElementsByTagName('id')[0]?.textContent?.trim() ?? '');
    if (!m) continue;
    let title = (entry.getElementsByTagName('title')[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    let rest = title;
    const peeled: string[] = [];
    for (let t = LANGUAGE_GROUP.exec(rest); t && GUTENBERG_LANGUAGES.has(t[1]); t = LANGUAGE_GROUP.exec(rest)) {
      peeled.unshift(t[1]);
      rest = rest.slice(0, t.index).trim();
    }
    const langs = rest && peeled.length && (!language || peeled.includes(language)) ? peeled : [];
    if (langs.length) title = rest;
    const content = (entry.getElementsByTagName('content')[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const author = /^\d[\d,]* downloads?$/.test(content) ? '' : content;
    const thumb = [...entry.getElementsByTagName('link')].find((l) => l.getAttribute('rel') === 'http://opds-spec.org/image/thumbnail')?.getAttribute('href') ?? '';
    const audio = thumb.startsWith('data:') && hash(thumb) === SOUND_ICON;
    if (title) books.push({ source: 'gutenberg', key: m[1], title, author, also: langs.filter((l) => l !== language), ...(audio ? { audio } : {}) });
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

/**
 * A list of a work's editions or of works sharing a name: a page to choose from, not a book. The categories each Wikisource
 * files them under (en Versions pages, fr Éditions multiples, es Versiones, pt !Listas de versões, ja 底本選択ページ, …).
 */
const LIST_PAGE = /versions pages|disambiguation|éditions multiples|homonymie|begriffskl|消歧|曖昧|многозначн|desambiguaci|disambigua|versiones|listas de versões|底本選択/i;
/** German Wikisource keeps authors' and topics' pages among the works: by their exact category. */
const NOT_A_WORK = /^Kategorie:(?:Autoren|Thema)$/;
/** Encyclopedia entries filed as pages of their own ("ADB:Goethe", "MKL1888:Faust"); a title with ": " is a real work's. */
const ENTRY_PREFIX = /^[A-Z][A-Za-z0-9]*:\S/;

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
    if ((p.categories ?? []).some((c) => typeof c.title === 'string' && (LIST_PAGE.test(c.title) || NOT_A_WORK.test(c.title)))) continue;
    if (ENTRY_PREFIX.test(title)) continue;
    books.push({ source: 'wikisource', key: title, title, author: '', also: [] });
  }
  const offset = Number(d?.continue?.gsroffset);
  return { books, next: Number.isInteger(offset) && offset > 0 ? offset : null };
}

/**
 * A page of works from the language's Wikisource search. Most hits of a work in parts are its parts ("Les Misérables/Tome 1/…"),
 * which are left out, so pages are asked for one after another (never at once: the API slows a burst down) until five works are
 * found or four pages were read.
 */
export async function searchWikisource(query: string, code: string, offset = 0, signal?: AbortSignal): Promise<{ books: FoundBook[]; next: number | null }> {
  const books: FoundBook[] = [];
  let next: number | null = offset;
  for (let asked = 0; next !== null && asked < 4 && books.length < 5; asked++) {
    const params = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: query.trim(), gsrnamespace: '0', gsrlimit: '25',
      prop: 'pageprops|categories', ppprop: 'disambiguation', cllimit: 'max', format: 'json', formatversion: '2', origin: '*',
    });
    if (next > 0) params.set('gsroffset', String(next));
    const res = await fetch(`https://${code}.wikisource.org/w/api.php?${params}`, { signal });
    if (!res.ok) throw new Error(`Wikisource answered ${res.status}.`);
    const page = parseWikisourceSearch(await res.json());
    for (const b of page.books) if (!books.some((x) => x.key === b.key)) books.push(b);
    next = page.next;
  }
  return { books, next };
}

/**
 * Where Chinese starts on Wikisource, which has no "most read" list: well-known works whose pages hold the whole work, each
 * exported and imported 2026-11-09 (modern prose first, then the long classics). Japanese opens on Aozora Bunko instead: its
 * Wikisource files most classics as pages to choose an edition from.
 */
const WIKISOURCE_STARTERS: Partial<Record<LangId, string[]>> = {
  zh: ['吶喊', '彷徨', '朝花夕拾', '故事新編', '野艸', '阿Q正傳', '浮生六記', '老殘遊記', '儒林外史', '鏡花緣', '聊齋志異', '封神演義'],
};

/**
 * A link to a book in one of the libraries, pasted into the search box: a Gutenberg book page (or one of its files), a page of a
 * Wikisource, an Aozora Bunko card or work page. Null when it is no such link.
 */
export function parseBookLink(text: string): { source: SourceId; key: string; lang?: string } | null {
  let url: URL;
  try { url = new URL(text.trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'gutenberg.org' || host === 'dev.gutenberg.org') {
    const m = /^\/(?:ebooks|cache\/epub|files)\/(\d{1,6})(?:[./]|$)/.exec(url.pathname);
    return m ? { source: 'gutenberg', key: m[1] } : null;
  }
  const ws = /^([a-z]{2,3})(?:\.m)?\.wikisource\.org$/.exec(host);
  if (ws) {
    const m = /^\/wiki\/(.+)$/.exec(url.pathname);
    if (!m) return null;
    let title: string;
    try { title = decodeURIComponent(m[1]); } catch { return null; }
    title = title.replace(/_/g, ' ').trim();
    return title ? { source: 'wikisource', key: title, lang: ws[1] } : null;
  }
  if (host === 'aozora.gr.jp') {
    const card = /^\/cards\/(\d{6})\/card(\d+)\.html$/.exec(url.pathname);
    if (card) return { source: 'aozora', key: card[2] };
    const file = /^\/cards\/(\d{6})\/files\/(\d+)_\d+\.html$/.exec(url.pathname);
    if (file) return { source: 'aozora', key: file[2] };
  }
  return null;
}

/** "Pérez Galdós, Benito" as people write it: Benito Pérez Galdós. */
const nameOrder = (s: string) => { const m = /^([^,]+),\s*([^,]+)$/.exec(s.trim()); return m ? `${m[2]} ${m[1]}` : s.trim(); };

/** The book a pasted link names, with its title and author when its library says them. Throws with a reason a reader can act on. */
export async function bookFromLink(link: { source: SourceId; key: string; lang?: string }, code: LangId, signal?: AbortSignal): Promise<FoundBook> {
  const name = langName(code, code === 'zh' ? 'Chinese' : lang().name);
  if (link.source === 'gutenberg') {
    let title = tt('Project Gutenberg book {number}', { number: link.key });
    let author = '';
    try {
      const res = await fetch(`https://www.gutenberg.org/ebooks/${link.key}.opds`, { signal });
      if (res.ok) {
        const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
        const entry = [...doc.getElementsByTagName('entry')].find((e) => e.getElementsByTagName('author').length);
        title = entry?.getElementsByTagName('title')[0]?.textContent?.trim() || title;
        author = nameOrder(entry?.getElementsByTagName('author')[0]?.getElementsByTagName('name')[0]?.textContent ?? '');
      }
    } catch (e) { if (e instanceof DOMException && e.name === 'AbortError') throw e; }
    return { source: 'gutenberg', key: link.key, title, author, also: [] };
  }
  if (link.source === 'wikisource') {
    if (link.lang && link.lang !== code) {
      const english = LANGS[link.lang as LangId]?.name ?? targetLanguage(link.lang)?.name;
      const other = english ? langName(link.lang, english) : '';
      throw new Error(other && isLangId(link.lang)
        ? tt('That page is on the {other} Wikisource. Open the {other} library to add it; this one reads {lang}.', { other, lang: name })
        : other ? tt('That page is on the {other} Wikisource, a language Globereader does not read yet.', { other })
          : tt('That page is on another language’s Wikisource, a language Globereader does not read yet.'));
    }
    return { source: 'wikisource', key: link.key, title: link.key, author: '', also: [] };
  }
  if (code !== 'ja') {
    throw new Error(tt("Aozora Bunko's works are in {japanese}. Open the {japanese} library to add one; this one reads {lang}.", { japanese: langName('ja', 'Japanese'), lang: name }));
  }
  const work = (await loadAozora()).find((w) => w.id === link.key);
  if (!work) throw new Error(tt('That Aozora Bunko work is not one Globereader can add: it may still be under copyright, or have no XHTML page.'));
  return aozoraBook(work);
}

/** Why a book could not be had from the sync server, in its words, with its `code` ('no-epub': Gutenberg has no text of it). */
export class FoundError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

/** What a download that got no answer says (never the browser's own "Failed to fetch"). */
export const DOWNLOAD_FAILED = ttm('Could not download the book. Check your connection and try again.');

/** The book's EPUB, through the sync server. Throws with the server's own words when it says why it could not. */
export async function fetchFound(b: FoundBook, code: string, signal?: AbortSignal): Promise<File> {
  const base = cloudBase();
  if (!base) throw new Error(tt('Adding free books needs the sync server, which this copy of Globereader does not have.'));
  const url = b.source === 'gutenberg' ? `${base}/gutenberg/${b.key}`
    : b.source === 'aozora' ? `${base}/aozora/${b.key}`
    : `${base}/wikisource/${code}/${encodeURIComponent(b.key)}`;
  // A request with no answer (the server down or out of reach, or an error page without CORS) says so plainly.
  const unanswered = (e: unknown): never => {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new FoundError(tt(DOWNLOAD_FAILED));
  };
  const res = await fetch(url, { signal }).catch(unanswered);
  if (!res.ok) {
    const why = await res.json().then((x: { error?: unknown; code?: unknown }) => x, () => null) as { error?: unknown; code?: unknown } | null;
    throw new FoundError(typeof why?.error === 'string' && why.error ? why.error : tt('The book could not be downloaded ({status}).', { status: res.status }),
      typeof why?.code === 'string' ? why.code : undefined);
  }
  const body = await res.blob().catch(unanswered);
  return new File([body], fileOf(b, code), { type: b.source === 'aozora' ? 'text/html' : 'application/epub+zip' });
}

/**
 * Whether Gutenberg has an EPUB of a book it lists as a recording, from the sync server (one HEAD a week for everyone): true,
 * false, or null when it could not say (a server from before it asked, or no answer). Asked once a page for each such book.
 */
const hasText = new Map<string, Promise<boolean | null>>();
export function gutenbergHasText(id: string): Promise<boolean | null> {
  const base = cloudBase();
  if (!base) return Promise.resolve(null);
  let p = hasText.get(id);
  if (!p) {
    p = fetch(`${base}/gutenberg/${id}?check`).then(async (res) => {
      const x = res.ok ? await res.json() as { epub?: unknown } : null;
      return typeof x?.epub === 'boolean' ? x.epub : null;
    }).catch(() => null);
    hasText.set(id, p);
    // No answer is asked again next time.
    void p.then((v) => { if (v === null) hasText.delete(id); });
  }
  return p;
}

/** What became of a book asked for: added, already in the library, or why not (with the server's code). */
interface AddOutcome { meta?: BookMeta; twin?: BookMeta; message?: string; code?: string }
interface Adding { done: Promise<AddOutcome>; rows: Set<{ live: () => boolean; settle: (o: AddOutcome) => void }> }
/**
 * Books being added, by the file they are added under. Done is not Cancel: an add goes on with the dialog closed, and a dialog
 * opened again shows it as being added and waits for the same download. When it ends, a row showing it says how it went; with
 * none open, a toast does.
 */
const adding = new Map<string, Adding>();

function addFound(ctx: AppContext, importer: Importer, b: FoundBook, code: LangId, who: { title: string; author: string }): Adding {
  const key = fileOf(b, code);
  const running = adding.get(key);
  if (running) return running;
  const rows: Adding['rows'] = new Set();
  const done = (async (): Promise<AddOutcome> => {
    let twin: BookMeta | undefined;
    let message = '';
    let why: string | undefined;
    const meta = await importer.remote(who, () => fetchFound(b, code), {
      quiet: true,
      // The row's own words for what went wrong: the reason alone, without the book's title, which the row shows.
      onProblem: (m, t, e, reason) => {
        if (t) twin = t;
        else { message = reason ?? m; why = e instanceof FoundError ? e.code : undefined; }
      },
    });
    if (meta) return { meta };
    if (twin) return { twin };
    // The browser's own words never show ("Failed to fetch"); offline says so.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) message = tt('You are offline. Connect to the internet to add books.');
    else if (!message || isNetworkFailure(new Error(message))) message = tt(DOWNLOAD_FAILED);
    return { message, ...(why ? { code: why } : {}) };
  })();
  const entry: Adding = { done, rows };
  adding.set(key, entry);
  void done.then((o) => {
    adding.delete(key);
    const live = [...rows].filter((r) => r.live());
    if (live.length) { for (const r of live) r.settle(o); return; }
    const shown = (t: string) => scriptView(ctx.settings.get().script, ctx.dictSync()).text(t);
    const open = (m: BookMeta) => () => ctx.navigate(`/read/${encodeURIComponent(m.id)}`);
    if (o.meta) ctx.toast(tt('Added “{title}”.', { title: shown(o.meta.title) }), { action: { label: tt('Read'), run: open(o.meta) }, ms: 7000 });
    else if (o.twin) ctx.toast(tt('“{title}” is already in your library.', { title: shown(o.twin.title) }), { action: { label: tt('Open'), run: open(o.twin) }, ms: 7000 });
    else ctx.toast(tt('“{title}” could not be added. {reason}', { title: who.title, reason: o.message ?? '' }), { ms: 9000 });
  });
  return entry;
}

/** Kept for callers from before Wikisource: a Gutenberg book by its number. */
export const fetchGutenberg = (id: number, signal?: AbortSignal): Promise<File> =>
  fetchFound({ source: 'gutenberg', key: String(id), title: '', author: '', also: [] }, langId(), signal);

export const canFindBooks = (): boolean => !!cloudBase();

/** Each library's own name, and the line that credits it (shown with tt). */
const SOURCES: Record<SourceId, { name: string; credit: string }> = {
  aozora: { name: '青空文庫', credit: ttm('Works from Aozora Bunko (aozora.gr.jp), out of copyright in Japan.') },
  gutenberg: { name: 'Project Gutenberg', credit: ttm('Books from gutenberg.org, free in the United States.') },
  wikisource: { name: 'Wikisource', credit: ttm('Works from Wikisource, free to read and share.') },
};

/** A language Gutenberg names in English ("Spanish"), in the app's language when it is one the app reads. */
const gutenbergName = (english: string): string => {
  const L = Object.values(LANGS).find((l) => l.name === english);
  return L ? langName(L.id, english) : english;
};
/** "Spanish and English": the languages a book is also in, as the app's language lists them. */
const listed = (names: string[]): string =>
  uiLang() === 'en' ? names.join(' and ') : new Intl.ListFormat(uiLocale(), { type: 'conjunction' }).format(names.map(gutenbergName));

/** The sources offered for a language, the first one open: Japanese reads Aozora Bunko first, Chinese Wikisource. */
export const sourcesFor = (code: LangId): SourceId[] =>
  code === 'ja' ? ['aozora', 'wikisource', 'gutenberg'] : code === 'zh' ? ['wikisource', 'gutenberg'] : ['gutenberg', 'wikisource'];

/** Han characters: a Chinese query typed in them is looked for on Gutenberg in traditional characters, as its catalog has them. */
const HAN = /\p{Script=Han}/u;

/** The dialog. Resolves with the book to open when the reader chose Read on one just added (or already there). */
export function findBooksDialog(ctx: AppContext, importer: Importer, opts: { query?: string } = {}): Promise<BookMeta | undefined> {
  const L = lang();
  const code = langId();
  const name = langName(code, code === 'zh' ? 'Chinese' : L.name);
  return showModal<BookMeta>(tt('Find a free book'), (api) => {
    const offered = sourcesFor(code);
    let source: SourceId = offered[0];
    const input = h('input.input.lib-find-input', { type: 'search', 'aria-label': tt('Search for a book, or paste a link to one'), autocomplete: 'off', enterkeyhint: 'search' }) as HTMLInputElement;
    // Titles in the reader's script (a Chinese reader on simplified sees 呐喊 for 吶喊); the key stays as the library spells it.
    const shown = (t: string) => scriptView(ctx.settings.get().script, ctx.dictSync()).text(t);
    // What happens to a book being added, said aloud (the button's own text changes are not announced).
    const said = h('div.lib-find-said', { role: 'status', 'aria-live': 'polite' });
    const intro = h('p.lib-find-intro.muted');
    const heading = h('div.lib-find-heading', { role: 'status', 'aria-live': 'polite' });
    const list = h('ol.lib-find-list');
    const MORE = tt('More books');
    const more = h('button.btn.lib-find-more', { type: 'button', hidden: true }, MORE) as HTMLButtonElement;
    // A page after the first that did not come, said beside the button that asks for it again.
    const moreError = h('div.lib-find-error', { role: 'alert', hidden: true });
    const credit = h('span.lib-find-credit.muted');
    // Two or three places to look: toggle buttons (as the welcome screen's), not tabs, so nothing promises arrow keys.
    const tabs = offered.map((id) => {
      const b = h('button.lib-find-tab', { type: 'button', 'aria-pressed': 'false', ...(id === 'aozora' ? { title: tt('Aozora Bunko') } : {}) }, SOURCES[id].name) as HTMLButtonElement;
      b.addEventListener('click', () => { if (source !== id) { source = id; showSource(); void load(false); } });
      return b;
    });
    const tabBar = h('div.lib-find-tabs', { role: 'group', 'aria-label': tt('Where to look') }, tabs);
    let have: BookMeta[] = [];
    void ctx.store.books.list().then((b) => { have = b; for (const row of list.children) (row as Row).sync?.(); }, () => {});
    const inLibrary = (b: FoundBook) => have.find((m) => m.sourceName === fileOf(b, code));
    type Row = HTMLElement & { sync?: () => void; paint?: () => void };

    const row = (b: FoundBook): HTMLElement => {
      const btn = h('button.btn.btn-sm.lib-find-add', { type: 'button' }) as HTMLButtonElement;
      const err = h('div.lib-find-error', { role: 'alert', hidden: true });
      const titleEl = h('div.lib-find-title', { lang: code === 'zh' && ctx.settings.get().script === 'traditional' ? 'zh-Hant' : L.tag });
      const authorEl = b.author ? h('div.lib-find-author') : null;
      const key = fileOf(b, code);
      let added: BookMeta | undefined;
      let busy = adding.has(key);
      // Gutenberg has no text of it (one of its recordings): nothing to add, and the button says so.
      let none = false;
      const title = () => shown(b.title);
      const sync = () => {
        added ??= inLibrary(b);
        if (none && !added) {
          btn.replaceChildren(tt('No text'));
          btn.classList.remove('btn-primary');
          btn.removeAttribute('aria-disabled');
          btn.setAttribute('aria-label', tt('“{title}” has no text to add', { title: title() }));
          btn.disabled = true;
          return;
        }
        btn.replaceChildren(...(added ? [tt('Read')] : busy ? [tt('Adding…')] : [icon('plus'), tt('Add')]));
        btn.classList.toggle('btn-primary', !!added);
        // Not disabled while busy: a disabled button drops the keyboard's focus to the page. A second press does nothing.
        btn.setAttribute('aria-disabled', String(busy));
        btn.setAttribute('aria-label', added ? tt('Read “{title}”', { title: title() }) : busy ? tt('Adding “{title}”…', { title: title() }) : tt('Add “{title}”', { title: title() }));
      };
      // Again once the dictionary is in, for a Chinese reader on simplified who opened the dialog before it was.
      const paint = () => {
        titleEl.textContent = title();
        if (authorEl) authorEl.textContent = shown(b.author);
        sync();
      };
      const settle = (o: AddOutcome) => {
        busy = false;
        if (o.meta) {
          added = o.meta;
          have.push(o.meta);
          said.textContent = tt('Added “{title}”. The button now opens it.', { title: title() });
        } else if (o.twin) {
          added = o.twin;
          said.textContent = tt('“{title}” is already in your library. The button opens it.', { title: title() });
        } else {
          none = o.code === 'no-epub';
          // The button is about to be disabled: the keyboard goes on to the next book rather than to the page.
          if (none && document.activeElement === btn) (nextButton(li) ?? input).focus();
          err.textContent = o.message ?? '';
          err.hidden = false;
          said.textContent = '';
        }
        sync();
      };
      const watch = (a: Adding) => a.rows.add({ live: () => li.isConnected, settle });
      btn.addEventListener('click', () => {
        if (busy || none) return;
        if (added) { api.close(added); return; }
        busy = true;
        err.hidden = true;
        sync();
        said.textContent = tt('Adding “{title}”…', { title: title() });
        watch(addFound(ctx, importer, b, code, { title: title(), author: shown(b.author) }));
      });
      const li = h('li.lib-find-row', null,
        h('div.lib-find-text', null,
          titleEl,
          authorEl,
          b.also.length ? h('div.lib-find-note', null, tt('Also in {languages}', { languages: listed(b.also) })) : null,
          b.note ? h('div.lib-find-note', null, b.note) : null,
          err),
        btn) as Row;
      li.sync = sync;
      li.paint = paint;
      paint();
      // Being added from an earlier opening of the dialog: this row says how it ends.
      const running = adding.get(key);
      if (running) watch(running);
      // One of Gutenberg's recordings: offered only if it has a text after all (a few do). No answer keeps it.
      if (b.audio) {
        void gutenbergHasText(b.key).then((has) => {
          if (has === false && li.isConnected && !added && !busy) drop(li);
        });
      }
      return li;
    };
    const nextButton = (li: Element): HTMLElement | null =>
      (li.nextElementSibling ?? li.previousElementSibling)?.querySelector<HTMLElement>('button:not([disabled])') ?? null;
    /** A row that turned out to have nothing to add, taken out of the list. */
    const drop = (li: HTMLElement) => {
      if (li.contains(document.activeElement)) (nextButton(li) ?? input).focus();
      li.remove();
      if (!list.childElementCount) heading.textContent = headingText(false);
    };

    let seq = 0;
    let ctrl: AbortController | null = null;
    let next: number | null = null;
    let query = '';
    // What Gutenberg is asked for the pages after the first: the traditional form of a Chinese query when that found books.
    let asked = '';
    // The first page did not come: the button under the heading asks for it again.
    let retry = false;
    const showSource = () => {
      tabs.forEach((t, i) => t.setAttribute('aria-pressed', String(offered[i] === source)));
      input.placeholder = source === 'wikisource' ? tt('Title, or a link to a book') : tt('Title, author, or a link to a book');
      credit.textContent = tt(SOURCES[source].credit);
      intro.textContent = source === 'gutenberg'
        ? tt('Free public-domain books in {lang} from Project Gutenberg. Add one and it opens like any other book.', { lang: name })
        : source === 'aozora'
          ? tt('Over 17,000 works out of copyright in Japan, with the readings the library prints over hard words. Search by title or author, in kanji or kana.')
          : code === 'zh'
            ? tt('Any work on the {lang} Wikisource, made into a book with its chapters. Search by title; add the author to narrow it ({example}).', { lang: name, example: '吶喊 魯迅' })
            : tt('Any work on the {lang} Wikisource, made into a book with its chapters. Search by title; add the author to narrow it.', { lang: name });
    };
    /** The line over the list: what it shows, or that nothing matched and what to try. The query as the reader typed it. */
    const headingText = (link: boolean): string => {
      if (list.childElementCount) {
        return link ? tt('The book at that link') : query ? tt('Books in {lang} matching “{query}”', { lang: name, query })
          : source === 'wikisource' ? tt('Well-known works to start with') : tt('The most read books in {lang}', { lang: name });
      }
      if (!query) return tt('{source} has no books in {lang} yet.', { source: SOURCES[source].name, lang: name });
      // Chinese: the last name alone is often one character, which matches nothing; the name in pinyin finds Gutenberg's books.
      const tip = code === 'zh'
        ? (source === 'gutenberg' ? tt('Try fewer characters, or the author’s name in pinyin.') : tt('Try fewer characters.'))
        : source === 'gutenberg' && WIKISOURCE_STARTERS[code] === undefined ? tt('Try a shorter title or the author’s last name, or look on Wikisource.')
          : tt('Try a shorter title or the author’s last name.');
      return `${tt('No books in {lang} match “{query}”.', { lang: name, query })} ${tip}`;
    };
    /** The button under the list: the next page, or the first one again after it did not come. */
    const showMore = (label: string, visible: boolean) => {
      if (more.hidden === visible) {
        if (!visible && document.activeElement === more) (list.lastElementChild?.querySelector<HTMLElement>('button') ?? input).focus();
        more.hidden = !visible;
      }
      more.textContent = label;
    };
    const load = async (append: boolean) => {
      const mine = ++seq;
      ctrl?.abort();
      ctrl = new AbortController();
      const signal = ctrl.signal;
      moreError.hidden = true;
      retry = false;
      if (!append) { list.replaceChildren(); next = null; showMore(MORE, false); heading.textContent = tt('Searching…'); }
      // More stays where it is while the next page comes (hiding it would drop the keyboard's focus to the page).
      more.setAttribute('aria-busy', String(append));
      more.setAttribute('aria-disabled', String(append));
      if (append) more.textContent = tt('Loading…');
      const before = list.childElementCount;
      const link = parseBookLink(query);
      try {
        let page: { books: FoundBook[]; next: number | null };
        if (link) {
          // A pasted link: that one book, whichever library it is in.
          page = { books: [await bookFromLink(link, code, signal)], next: null };
        } else if (source === 'aozora') {
          const found = searchAozora(await loadAozora(), query);
          const from = append && next ? next : 0;
          const to = from + AOZORA_PAGE;
          page = { books: found.slice(from, to).map(aozoraBook), next: to < found.length ? to : null };
        } else if (source === 'wikisource' && !query) {
          const starters = WIKISOURCE_STARTERS[code];
          if (!starters) {
            heading.textContent = tt('Type a title to search the {lang} Wikisource.', { lang: name });
            return;
          }
          page = { books: starters.map((t) => ({ source: 'wikisource', key: t, title: t, author: '', also: [] })), next: null };
        } else if (source === 'gutenberg') {
          if (append && next) page = await searchGutenberg(asked, code, next, signal);
          else {
            // Gutenberg's Chinese titles and names are traditional: 鲁迅 finds nothing there, 魯迅 Lu Xun's books. The typed form
            // is tried when the traditional one finds nothing (a character with two traditional forms, a simplified alternate title).
            const dict = code === 'zh' && HAN.test(query) ? await ctx.dict().catch(() => null) : null;
            const trad = dict?.toTraditional(query) ?? query;
            asked = trad;
            page = await searchGutenberg(trad, code, 1, signal);
            if (trad !== query && !page.books.length && mine === seq) {
              asked = query;
              page = await searchGutenberg(query, code, 1, signal);
            }
          }
        } else {
          page = await searchWikisource(query, code, append && next ? next : 0, signal);
        }
        if (mine !== seq) return;
        next = page.next;
        list.append(...page.books.map(row));
        more.removeAttribute('aria-busy');
        more.setAttribute('aria-disabled', 'false');
        // After More, the keyboard goes on from the first new book (or stays on More when nothing came).
        if (append && document.activeElement === more) {
          const first = list.children[before]?.querySelector<HTMLElement>('button');
          if (first && !next) first.focus();
        }
        heading.textContent = headingText(!!link);
        // Never "No books match" with a More button under it.
        if (!append && !list.childElementCount) next = null;
        showMore(MORE, !!next);
      } catch (e) {
        if (mine !== seq || (e instanceof DOMException && e.name === 'AbortError')) return;
        more.removeAttribute('aria-busy');
        more.setAttribute('aria-disabled', 'false');
        const offline = navigator.onLine === false;
        if (append) {
          // The books already listed stay, and so does the line over them: the button asks for the same page again.
          moreError.textContent = offline ? tt('You are offline. Connect to the internet to find books.') : tt('Could not load more books. Try again.');
          moreError.hidden = false;
          showMore(MORE, !!next);
          return;
        }
        heading.textContent = offline ? tt('You are offline. Connect to the internet to find books.')
          : link && e instanceof Error ? e.message
          : tt('{source} did not answer. Try again in a moment.', { source: SOURCES[source].name });
        retry = true;
        showMore(tt('Try again'), true);
      }
    };
    // Chinese and Japanese are typed through an input method: nothing is searched for while a word is being composed ("lu xun"
    // before it becomes 魯迅), only once it is chosen.
    let timer = 0;
    let composing = false;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const q = input.value.trim();
        if (q === query) return;
        query = q;
        void load(false);
      }, 400);
    };
    input.addEventListener('compositionstart', () => { composing = true; window.clearTimeout(timer); });
    input.addEventListener('compositionend', () => { composing = false; schedule(); });
    input.addEventListener('input', (e) => { if (!composing && !(e as InputEvent).isComposing) schedule(); });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || composing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      window.clearTimeout(timer);
      query = input.value.trim();
      void load(false);
    });
    more.addEventListener('click', () => { if (more.getAttribute('aria-busy') !== 'true') void load(!retry); });
    showSource();
    // The rows were drawn before the dictionary came in (simplified for traditional, in Chinese): drawn again once it is.
    if (code === 'zh' && !ctx.dictSync()) void ctx.dict().then(() => { for (const r of list.children) (r as Row).paint?.(); }, () => {});
    // Opened on a link shared to the app, or a search: it shows that at once.
    if (opts.query) { input.value = opts.query; query = opts.query.trim(); }
    void load(false);
    return {
      body: h('div.lib-find', null, tabBar, intro, h('div.lib-find-search', null, icon('search'), input), heading, list, more, moreError, said),
      footer: [credit, h('button.btn', { type: 'button', onclick: () => api.close() }, tt('Done'))],
      focus: input,
    };
  }, { wide: true });
}
