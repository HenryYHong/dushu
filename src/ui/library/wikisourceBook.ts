// A work on a Wikisource made into an EPUB in the page, from that Wikisource's MediaWiki API (it lets any page read it:
// origin=*). Wikisource's own exporter (ws-export) does not, and it answers the sync server with a bot check, so the book is
// put together here the way the exporter does it (wikimedia/ws-export, PageParser::getFullChaptersList and BookProvider):
// - the work's page first, then its parts: the links in its contents (an element marked ws-summary) to pages of the main
//   namespace, or, with no such contents, its links to its own subpages ("Marianela/I"), in the order they come, each once.
//   A link in the page's header (the parts before and after) or in anything marked not to be exported is not a part.
// - each part's own parts the same way, one level down (a volume's chapters), right after it;
// - each page as the API renders it, a few at a time, up to MAX_PARTS parts and MAX_BYTES of markup; the rest is left out
//   and the caller is told.
// The EPUB is shaped like the exporter's (dc:source names the page), so src/import/epub.ts cleans it the same way:
// tidyWikisource takes each page's header, sister-project links and license out, and finds the author and a part's title in
// the header. Pictures are not fetched (the page may only reach the nine Wikisources).
import { strToU8, zipSync } from 'fflate';
import { tt } from '../../i18n';

/**
 * A list of a work's editions or of works sharing a name: a page to choose from, not a book. The categories each Wikisource
 * files them under (en Versions pages, fr Éditions multiples, es Versiones, pt !Listas de versões, ja 底本選択ページ, ru Списки
 * редакций, …).
 */
export const LIST_PAGE = /versions pages|disambiguation|éditions multiples|homonymie|begriffskl|消歧|曖昧|многозначн|desambiguaci|disambigua|versiones|listas de versões|底本選択|списки редакций/i;

/** At most this many parts (chapters, stories, volumes) are added, and this much markup: a long work is cut there. */
export const MAX_PARTS = 400;
export const MAX_BYTES = 40 * 1024 * 1024;
/** Pages asked for at once. Once the API asks to slow down (or does not answer), one at a time. */
const AT_ONCE = 3;
/** How the app names itself to Wikimedia: a page cannot set User-Agent, and the API reads this header instead. */
const API_USER_AGENT = 'Globereader (https://henryyhong.com/dushu)';
/** A work's own page before its parts is kept only for a text of its own this long (a preface), not for a title page. */
const OWN_TEXT = 200;

/** Why a work could not be made a book: `code` is 'missing', 'list', 'no-text', 'busy' or 'status'. The message is a sentence. */
export class WikisourceError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

/** One page as the API rendered it. */
interface Page {
  title: string;
  /** Its title as the page shows it, as text. */
  display: string;
  doc: Document;
  /** The namespace of each page it links to, by title. */
  links: Map<string, number>;
  /** The pages it links to that exist. */
  exists: Set<string>;
  /** A list of editions or of works with one name (flagged as disambiguation, or in such a category). */
  list: boolean;
}

/**
 * A part of the work, in reading order: the page asked for, the parent it was found on, the words of its link, and once it
 * was asked for (`asked`), the page (none when it is gone).
 */
interface Part { title: string; parent: string; label: string; asked?: boolean; page?: Page }

/**
 * Where a Wikisource keeps its navigation: the header of every page (headerContainer on zh and en, ws-header and wst-header on
 * en, headertemplate on es and ru, navigationHeader on ja), its sister-project links and footer, it Wikisource's note on how
 * far the text is checked, and anything marked not to be exported. Links there are never parts, and text there is not the
 * work's.
 */
const NAVIGATION = '.ws-noexport, [id^="headerContainer"], .ws-header, table.ws-header, .wst-header, [id^="navigationHeader"], [id^="navigationNotes"], [id^="headertemplate"], .headertemplate, [id^="plainSister"], .plainSister, [id^="ws-footer"], .licenseContainer, .quality-ns0';
/** Links that are not to a page of this Wikisource: one not written yet, another wiki, the web, a file. */
const NOT_A_PAGE = /(?:^|\s)(?:new|extiw|external|internal|image|mw-file-description)(?:\s|$)/;
/** fr Wikisource's whole work on one page beside its parts: the same text again. */
const WHOLE_TEXT = /\/Texte entier$/;
/** The File namespace: a link to a recording or a scan's page ("Versione recitata"), not words of the work. */
const FILE_NS = 6;
/** A part's name that is only its number ("II"): its link's words name it ("Guiado"). */
const NUMBER = /^(?:[IVXLCDM]+|\d+)\.?$/i;

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
  signal.addEventListener('abort', stop, { once: true });
});

const letters = (s: string) => s.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
const words = (el: Node) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

interface ApiParse {
  error?: { code?: string };
  parse?: {
    title?: string; displaytitle?: string; text?: unknown;
    categories?: { category?: string }[]; properties?: Record<string, unknown>; links?: { ns?: number; title?: string; exists?: boolean }[];
  };
}

/**
 * The API of one Wikisource, shared by the pages of one book. When it asks for a pause (429, Retry-After) every request waits
 * for it, and from then on one goes at a time; so too when a request gets no answer, which is how a browser sees a refusal
 * that carries no CORS headers.
 */
function client(code: string, signal: AbortSignal) {
  let until = 0;
  let width = AT_ONCE;
  const api = `https://${code}.wikisource.org/w/api.php`;
  const pause = (tries: number, seconds = 0) => {
    width = 1;
    until = Math.max(until, Date.now() + Math.min(30, seconds > 0 ? seconds : 2 ** (tries + 1)) * 1000);
  };
  /** The page, or null when there is none by that title. */
  async function parse(title: string): Promise<Page | null> {
    const params = new URLSearchParams({
      action: 'parse', page: title, prop: 'text|displaytitle|categories|properties|links', redirects: '1',
      disableeditsection: '1', disablelimitreport: '1', disabletoc: '1', format: 'json', formatversion: '2', origin: '*',
    });
    for (let tries = 0; ; tries++) {
      const wait = until - Date.now();
      if (wait > 0) await sleep(wait, signal);
      let res: Response;
      try {
        res = await fetch(`${api}?${params}`, { signal, headers: { 'Api-User-Agent': API_USER_AGENT } });
      } catch (e) {
        if (signal.aborted || !(e instanceof TypeError) || tries >= 2 || globalThis.navigator?.onLine === false) throw e;
        pause(tries);
        continue;
      }
      const body = res.ok ? await res.json().catch(() => null) as ApiParse | null : null;
      const error = body?.error?.code;
      if (res.status === 429 || res.status === 503 || error === 'ratelimited' || error === 'maxlag') {
        if (tries >= 4) throw new WikisourceError(tt('Wikisource is busy right now. Try again in a minute.'), 'busy');
        pause(tries, Number(res.headers.get('retry-after')) || 0);
        continue;
      }
      if (error === 'missingtitle' || error === 'invalidtitle') return null;
      if (!res.ok || !body?.parse || typeof body.parse.text !== 'string') {
        throw new WikisourceError(tt('Wikisource did not answer as expected ({status}). Try again in a moment.', { status: (res.ok && error) || res.status }), 'status');
      }
      return pageOf(body.parse);
    }
  }
  return { parse, width: () => width };
}

function pageOf(p: NonNullable<ApiParse['parse']>): Page {
  const title = String(p.title ?? '');
  const categories = (p.categories ?? []).map((c) => String(c.category ?? '').replace(/_/g, ' '));
  const links = new Map<string, number>();
  const exists = new Set<string>();
  for (const l of p.links ?? []) {
    if (typeof l.title !== 'string' || typeof l.ns !== 'number') continue;
    links.set(l.title, l.ns);
    if (l.exists) exists.add(l.title);
  }
  return {
    title,
    display: words(new DOMParser().parseFromString(String(p.displaytitle ?? ''), 'text/html').body) || title,
    doc: new DOMParser().parseFromString(String(p.text), 'text/html'),
    links,
    exists,
    list: (!!p.properties && 'disambiguation' in p.properties) || categories.some((c) => LIST_PAGE.test(c)),
  };
}

/** The page a link goes to, as a title ("Marianela/I"), and the place in it ("#cap1"); null for anything but a page here. */
function linked(a: Element): { title: string; frag: string } | null {
  const m = /^\/wiki\/([^?#]+)(#.*)?$/.exec(a.getAttribute('href') ?? '');
  if (!m) return null;
  try { return { title: decodeURIComponent(m[1]).replace(/_/g, ' ').trim(), frag: m[2] ?? '' }; } catch { return null; }
}

/**
 * The parts a page lists, in its order, each once (`seen` holds the pages already in the book): the links in its contents
 * (ws-summary), or with none, its links to its own subpages. Never a link in its navigation.
 */
function partsOf(page: Page, seen: Set<string>): Part[] {
  const body = page.doc.body;
  const summaries = [...body.querySelectorAll('#ws-summary, .ws-summary')].filter((s) => !s.closest(NAVIGATION));
  const anchors = summaries.length ? summaries.flatMap((s) => [...s.querySelectorAll('a[href]')]) : [...body.querySelectorAll('a[href]')];
  const out: Part[] = [];
  for (const a of anchors) {
    if (a.closest(NAVIGATION) || NOT_A_PAGE.test(a.getAttribute('class') ?? '')) continue;
    const to = linked(a);
    if (!to || page.links.get(to.title) !== 0 || !page.exists.has(to.title) || WHOLE_TEXT.test(to.title) || seen.has(to.title)) continue;
    if (!summaries.length && !to.title.startsWith(`${page.title}/`)) continue;
    seen.add(to.title);
    out.push({ title: to.title, parent: page.title, label: words(a) });
  }
  return out;
}

/** What is not a page's own text: its navigation, its contents, what is hidden. */
const NOT_OWN = `${NAVIGATION}, #ws-summary, .ws-summary, style, script, [style*="display:none"], [style*="display: none"]`;

/**
 * A page's own text, without its navigation and contents: its letters and digits alone (`bare`), how many, how many of them
 * are in links and how many links, and its first heading when a heading comes before any paragraph.
 */
function ownText(page: Page): { bare: string; letters: number; linked: number; links: number; heading: string } {
  const probe = page.doc.body.cloneNode(true) as HTMLElement;
  for (const el of probe.querySelectorAll(NOT_OWN)) el.remove();
  const anchors = [...probe.querySelectorAll('a[href^="/wiki/"]')];
  const bare = (probe.textContent ?? '').replace(/[^\p{L}\p{N}]+/gu, '');
  const top = [...probe.querySelectorAll('h1, h2, h3, h4, h5, h6, p')].find((el) => letters(el.textContent ?? ''));
  return {
    bare, letters: bare.length, linked: anchors.reduce((n, a) => n + letters(a.textContent ?? ''), 0), links: anchors.length,
    heading: top && top.localName !== 'p' ? words(top) : '',
  };
}

const isHeading = (el: Element) => /^h[1-6]$/.test(el.localName) || el.classList.contains('mw-heading');

/**
 * Takes the contents out of a work's page, so what is left is its own text (a preface) or a title page: the stretch of the
 * page from the first link to a part to the last, the lines between them and after the last that are like the ones between
 * (it Wikisource's summary under each chapter), and the heading over it ("Indice", "目錄").
 */
function dropContents(page: Page, parts: Set<string>): void {
  const anchors = [...page.doc.body.querySelectorAll('a[href]')].filter((a) => !a.closest(NAVIGATION) && parts.has(linked(a)?.title ?? ''));
  if (!anchors.length) return;
  let common = anchors[0].parentElement!;
  while (!anchors.every((a) => common.contains(a)) && common.parentElement) common = common.parentElement;
  const childOf = (a: Element) => { let x = a; while (x.parentElement && x.parentElement !== common) x = x.parentElement; return x; };
  const first = childOf(anchors[0]);
  const last = childOf(anchors[anchors.length - 1]);
  const gone: Element[] = [];
  const between = new Set<string>();
  for (let el: Element | null = first; el; el = el.nextElementSibling) {
    gone.push(el);
    if (!anchors.some((a) => el!.contains(a))) between.add(el.localName);
    if (el === last) break;
  }
  for (let el = last.nextElementSibling; el && between.has(el.localName) && !isHeading(el); el = el.nextElementSibling) gone.push(el);
  let before = first.previousElementSibling;
  for (const el of gone) el.remove();
  // A list or table left with nothing in it goes too.
  for (let top: Element = common; top !== page.doc.body && top.parentElement && !letters(top.textContent ?? '');) {
    const up: Element = top.parentElement;
    before = top.previousElementSibling;
    top.remove();
    top = up;
  }
  // The heading over the contents, with the rules and empty lines under it.
  const empty: Element[] = [];
  while (before && !isHeading(before) && !letters(before.textContent ?? '')) { empty.push(before); before = before.previousElementSibling; }
  if (before && isHeading(before)) for (const el of [...empty, before]) el.remove();
}

/** A page marked to be left out of an export (ws-noinclude). */
const leftOut = (page: Page) => !!page.doc.querySelector('#ws-noinclude, .ws-noinclude');

/** What an element of the work's metadata says (ws-title, ws-author), as text: an id or a class names it. */
const metadata = (page: Page, id: string) => { const el = page.doc.querySelector(`#${id}, .${id}`); return el ? words(el) : ''; };

/**
 * The work's name: its metadata's (ws-title) when the page is named that, alone or with a word to tell it from others ("Die
 * Verwandlung (Franz Kafka)", "Тоска (Чехов)"); otherwise the page's own name, as the search found it.
 */
function workTitleOf(main: Page): string {
  const named = metadata(main, 'ws-title');
  return named && (main.display === named || main.display.startsWith(`${named} (`)) ? named : main.display;
}

/**
 * What a part is called in the contents: its link's words, as the exporter names it ("Capitolo 1", "第一回 靈根育孕源流出…"),
 * without the work's name before them ("O Alienista, Capítulo I — …"), and with the number its page's title gives it when
 * they leave it out ("Marianela/II" and "Guiado": "II. Guiado"); its page's title, without the work's, when the link has no
 * words.
 */
function labelOf(part: Part, page: Page, work: string[]): string {
  let own = page.display;
  for (const whole of [part.parent, page.title.replace(/\/[^/]*$/, '')]) {
    if (whole && own.startsWith(`${whole}/`) && own.length > whole.length + 1) { own = own.slice(whole.length + 1); break; }
  }
  let said = part.label.length <= 120 ? part.label : '';
  for (const name of work) {
    const rest = said.slice(name.length).replace(/^\s*[,:.;—–-]\s*/, '');
    if (name && said.toLocaleLowerCase().startsWith(name.toLocaleLowerCase()) && rest.length < said.length - name.length) { said = rest; break; }
  }
  if (!said) return own;
  if (!NUMBER.test(own)) return said;
  const n = own.replace(/\.$/, '');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${n}(?:$|[^\\p{L}\\p{N}])`, 'u').test(said) ? said : `${n}. ${said}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A page's markup as an XHTML document, as the exporter cleans it: no styles, scripts or pictures (they would be fetched
 * from elsewhere; a picture's caption goes with it), no edit links, no contents box or comments, no red links (their words
 * stay), no links to files, no note on how far the text is checked (it); links to the book's own parts go to their files,
 * and other links to the site are made whole. The header stays, for tidyWikisource to read the author and the part's title.
 */
function xhtmlOf(page: Page, main: boolean, code: string, fileOf: (title: string) => string | undefined): string {
  const doc = page.doc;
  const drop = 'style, link, meta, script, noscript, img, picture, video, audio, iframe, object, embed, form, figure[typeof*="mw:File"], #toc, .toc, .mw-editsection, .mw-headline-anchor, .mediaContainer, .mwe-math-mathml-inline, .quality-ns0';
  for (const el of doc.body.querySelectorAll(main ? drop : `${drop}, .ws-if-subpage-noexport`)) el.remove();
  const walker = doc.createTreeWalker(doc.body, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) comments.push(n);
  for (const c of comments) c.parentNode?.removeChild(c);
  for (const a of [...doc.body.querySelectorAll('a')]) {
    const href = a.getAttribute('href') ?? '';
    if (/(?:^|\s)new(?:\s|$)/.test(a.getAttribute('class') ?? '') || /[?&](?:action=edit|redlink=1)/.test(href)) {
      a.replaceWith(...a.childNodes);
      continue;
    }
    const to = linked(a);
    if (to && page.links.get(to.title) === FILE_NS) { a.remove(); continue; }
    const file = to && fileOf(to.title);
    if (file) a.setAttribute('href', `${file}${to.frag}`);
    else if (href.startsWith('//')) a.setAttribute('href', `https:${href}`);
    else if (href.startsWith('/')) a.setAttribute('href', `https://${code}.wikisource.org${href}`);
  }
  const serializer = new XMLSerializer();
  const body = [...doc.body.childNodes].map((n) => serializer.serializeToString(n)).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${esc(code)}" xml:lang="${esc(code)}"><head><meta charset="utf-8"/><title>${esc(page.display)}</title></head><body>${body}</body></html>`;
}

/** Runs `job` over `items`, `width()` at a time, in order; takes no new one once `enough()`. The first failure stops it. */
function inTurn<T>(items: T[], width: () => number, job: (item: T) => Promise<void>, enough: () => boolean): Promise<void> {
  let next = 0;
  let running = 0;
  return new Promise<void>((resolve, reject) => {
    let failed = false;
    const pump = () => {
      if (failed) return;
      while (running < width() && next < items.length && !enough()) {
        const item = items[next++];
        running++;
        job(item).then(() => { running--; pump(); }, (e: unknown) => { failed = true; reject(e); });
      }
      if (!running && (next >= items.length || enough())) resolve();
    };
    pump();
  });
}

export interface WikisourceBook {
  epub: Uint8Array;
  title: string;
  author: string;
  /** The work was too long to add whole: how many of its parts were kept, of how many found. */
  cut: { kept: number; total: number } | null;
}

export interface WikisourceOptions {
  signal?: AbortSignal;
  /** In place of MAX_PARTS and MAX_BYTES (tests). */
  maxParts?: number;
  maxBytes?: number;
}

/**
 * The work at `title` on the `code` Wikisource as an EPUB. Throws a WikisourceError when it is no page, a list of editions or
 * of works with one name, or has no text; a request with no answer and an abort come through as they are.
 */
export async function wikisourceEpub(title: string, code: string, opts: WikisourceOptions = {}): Promise<WikisourceBook> {
  const { signal } = opts;
  // The pages of one book share a signal: one that fails stops the rest.
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal?.reason);
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await build(title.trim(), code, ctrl.signal, opts.maxParts ?? MAX_PARTS, opts.maxBytes ?? MAX_BYTES);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    ctrl.abort();
  }
}

async function build(asked: string, code: string, signal: AbortSignal, maxParts: number, maxBytes: number): Promise<WikisourceBook> {
  const api = client(code, signal);
  const main = await api.parse(asked);
  if (!main) throw new WikisourceError(tt('Wikisource has no page with that title. It may have been renamed or deleted.'), 'missing');
  const notABook = () => new WikisourceError(tt('This page lists several editions or works with the same name, not one book. Search for the one you want.'), 'list');
  if (main.list) throw notABook();

  const workTitle = workTitleOf(main);
  const seen = new Set<string>([main.title, asked]);
  const level1 = partsOf(main, seen);
  const own = ownText(main);
  // A page of links with no parts of its own: a list of works (an author's, a topic's), not a book.
  if (!level1.length && own.links >= 3 && own.linked >= own.letters * 0.7) throw notABook();

  // The parts, a few at a time, until there is enough markup; then one level down, each part's own parts after it.
  let bytes = 0;
  const sizeOf = (page: Page) => page.doc.body.innerHTML.length;
  const fetchAll = (parts: Part[]) => inTurn(parts.filter((p) => !p.asked), api.width, async (p) => {
    const page = await api.parse(p.title);
    p.asked = true;
    if (!page || leftOut(page)) return;
    p.page = page;
    bytes += sizeOf(page);
  }, () => bytes > maxBytes);
  await fetchAll(level1.slice(0, maxParts));
  const order: Part[] = [];
  for (const p of level1) {
    order.push(p);
    if (!p.page) continue;
    seen.add(p.page.title);
    order.push(...partsOf(p.page, seen));
  }
  const candidates = order.slice(0, maxParts);
  await fetchAll(candidates);

  // The book, in reading order, while it fits. A part that is gone is left out; so is one reached again by a redirect.
  const pages: { part?: Part; page: Page }[] = [];
  const inBook = new Set([main.title]);
  let size = 0;
  let cutShort = candidates.length < order.length;
  for (const p of candidates) {
    if (!p.asked) { cutShort = true; break; }
    if (!p.page || inBook.has(p.page.title)) continue;
    const n = sizeOf(p.page);
    if (size + n > maxBytes && pages.length) { cutShort = true; break; }
    size += n;
    inBook.add(p.page.title);
    pages.push({ part: p, page: p.page });
  }
  // The work's own page goes first when it is the whole work, or holds a text of its own besides its contents (吶喊's 自序)
  // that is not one of its parts again (朝花夕拾's 小引, on its page and on a page of its own).
  let mainLabel = workTitle;
  if (!leftOut(main)) {
    if (pages.length) dropContents(main, new Set(level1.map((p) => p.title)));
    const kept = ownText(main);
    const sample = kept.bare.slice(20, 80);
    if (!pages.length || (kept.letters >= OWN_TEXT && !pages.some((x) => ownText(x.page).bare.includes(sample)))) {
      pages.unshift({ page: main });
      if (pages.length > 1) mainLabel = kept.heading || workTitle;
    }
  }
  if (!pages.some((x) => (x.part ? ownText(x.page) : own).letters > 0)) {
    throw new WikisourceError(tt('This page has no text to read yet.'), 'no-text');
  }

  const files = new Map<string, string>();
  pages.forEach((x, i) => {
    files.set(x.page.title, `p${i}.xhtml`);
    if (x.part) files.set(x.part.title, `p${i}.xhtml`);
  });
  const fileOf = (t: string) => files.get(t);
  const author = metadata(main, 'ws-author');
  const source = `https://${code}.wikisource.org/wiki/${encodeURIComponent(main.title.replace(/ /g, '_'))}`;
  // The work's own page, before its parts, is called by its first heading (自序), or the work's name.
  const contents = pages.map((x) => ({
    file: fileOf(x.page.title)!, label: x.part ? labelOf(x.part, x.page, [main.display, workTitle]) : mainLabel,
  }));
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="${esc(code)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">${esc(source)}</dc:identifier>
<dc:title>${esc(workTitle)}</dc:title>
${author ? `<dc:creator>${esc(author)}</dc:creator>\n` : ''}<dc:language>${esc(code)}</dc:language>
<dc:source>${esc(source)}</dc:source>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${pages.map((_, i) => `<item id="p${i}" href="p${i}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine>${pages.map((_, i) => `<itemref idref="p${i}"/>`).join('')}</spine>
</package>`),
    'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(code)}" xml:lang="${esc(code)}"><head><meta charset="utf-8"/><title>${esc(workTitle)}</title></head>
<body><nav epub:type="toc" id="toc"><ol>${contents.map((c) => `<li><a href="${c.file}">${esc(c.label)}</a></li>`).join('')}</ol></nav></body></html>`),
  };
  pages.forEach((x, i) => { entries[`OEBPS/p${i}.xhtml`] = strToU8(xhtmlOf(x.page, !x.part, code, fileOf)); });
  return {
    epub: zipSync(entries as never),
    title: workTitle,
    author,
    cut: cutShort ? { kept: pages.filter((x) => x.part).length, total: order.length } : null,
  };
}
