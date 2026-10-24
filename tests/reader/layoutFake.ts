// A fake layout for the reader in jsdom, where nothing has a size. Both layouts follow the text size the reader set
// (--rd-size on .rd-root), so a test can tell a place measured before a re-style from one measured after it.
//   Scroll: one column TEXT_W wide from the top of the document. A drawn block is `lines * pitch` tall (pitch = 2 * size)
//   and an empty shell is 0, as in a browser. The app nav (56 px) is in the flow above the reader unless
//   body[data-route=read] hides it, as base.css does. window.scrollY, scrollTo and scrollBy work and clamp to the page,
//   and a page that got shorter clamps the scroll position the next time anything is measured.
//   Pages: pages PAGE_W apart, each LINES_PAGE_H / pitch lines of PAGE_TEXT_W / size characters; blocks start on a new line.
// Every rect is computed from the DOM on each call (jsdom's selector engine is slow, so only class and parent checks are used).
import { vi } from 'vitest';

export const BAR_H = 52;
export const NAV_H = 56;
export const VIEW_H = 900;
export const TEXT_W = 700;
export const PAGE_W = 800;
const PAGE_TEXT_W = 600;
const LINES_PAGE_H = 800;

const byClass = (c: string): Element | undefined => document.getElementsByClassName(c)[0];
const size = (): number => parseFloat((byClass('rd-root') as HTMLElement | undefined)?.style.getPropertyValue('--rd-size') || '') || 28;
const pitch = (): number => size() * 2;
export const perLine = (): number => Math.floor(TEXT_W / size());
const pagePerLine = (): number => Math.floor(PAGE_TEXT_W / size());
const linesPerPage = (): number => Math.floor(LINES_PAGE_H / pitch());

/** Characters in a drawn block, cached until the block is drawn again (its first child changes). */
const counts = new WeakMap<Element, { first: Node | null; n: number }>();
function chars(el: Element): number {
  const c = counts.get(el);
  if (c && c.first === el.firstChild) return c.n;
  const rubies = el.getElementsByTagName('ruby');
  const n = rubies.length ? Number((rubies[rubies.length - 1] as HTMLElement).dataset.o) + 1 : el.firstChild ? (el.textContent ?? '').length : 0;
  counts.set(el, { first: el.firstChild, n });
  return n;
}

const isArticle = (el: Element | null): el is HTMLElement => !!el && el.classList.contains('rd-article');
/** The block an element is in, and the article that holds the block. */
function blockOf(el: Element): { block: Element; article: HTMLElement } | null {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.hasAttribute('data-b') && isArticle(e.parentElement)) return { block: e, article: e.parentElement };
  }
  return null;
}
function scrollArticle(): HTMLElement | null {
  for (const a of document.getElementsByClassName('rd-article')) if (!a.classList.contains('rd-paged')) return a as HTMLElement;
  return null;
}
const navShown = (): number => (byClass('app-nav') && document.body.dataset.route !== 'read' ? NAV_H : 0);

/** Document y of each block of the Scroll article, and the bottom of the page. */
function scrollFlow(): { tops: Map<Element, number>; end: number } {
  const tops = new Map<Element, number>();
  const article = scrollArticle();
  if (!article) return { tops, end: 0 };
  let y = navShown() + BAR_H + 24;
  const per = perLine();
  for (const el of article.children) {
    if (!el.hasAttribute('data-b')) continue;
    tops.set(el, y);
    const n = chars(el);
    if (n) y += Math.ceil(n / per) * pitch() + size() / 2;
  }
  const end = y + 300;
  // Layout clamps the scroll position of a page that got shorter.
  const max = Math.max(0, end - VIEW_H);
  if (sy > max) { sy = max; scrolled(); }
  return { tops, end };
}

/** Line of each block in a Pages article (blocks still hidden take no room). */
function pageFlow(article: Element): Map<Element, number> {
  const lines = new Map<Element, number>();
  let line = 0;
  const per = pagePerLine();
  for (const el of article.children) {
    if (!el.hasAttribute('data-b') || el.classList.contains('rd-wait')) continue;
    const n = chars(el);
    if (!n) continue;
    lines.set(el, line);
    line += Math.ceil(n / per);
  }
  return lines;
}

let sy = 0;
// A browser reports the scroll in a later task.
const scrolled = () => setTimeout(() => window.dispatchEvent(new Event('scroll')), 0);
const docHeight = () => scrollFlow().end;
function setY(y: number): void {
  const next = Math.min(Math.max(0, docHeight() - VIEW_H), Math.max(0, y));
  if (next === sy) return;
  sy = next;
  scrolled();
}

export function installLayout(): void {
  sy = 0;
  Object.defineProperty(window, 'innerWidth', { value: PAGE_W, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: VIEW_H, configurable: true });
  Object.defineProperty(window, 'scrollY', { get: () => sy, configurable: true });
  Object.defineProperty(window, 'pageYOffset', { get: () => sy, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', { get: docHeight, configurable: true });
  window.scrollTo = ((a: number | ScrollToOptions, b?: number) => setY(typeof a === 'object' ? (a.top ?? sy) : (b ?? 0))) as typeof window.scrollTo;
  window.scrollBy = ((a: number | ScrollToOptions, b?: number) => setY(sy + (typeof a === 'object' ? (a.top ?? 0) : (b ?? 0)))) as typeof window.scrollBy;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));

  Element.prototype.getBoundingClientRect = function () {
    const el = this as Element;
    if (isArticle(el)) {
      if (el.classList.contains('rd-paged')) return new DOMRect(0, 0, PAGE_W, VIEW_H);
      const { tops, end } = scrollFlow();
      const first = tops.values().next().value ?? 0;
      return new DOMRect(50, first - sy, TEXT_W, end - first);
    }
    const at = blockOf(el);
    if (at && at.article.classList.contains('rd-paged')) {
      const line = pageFlow(at.article).get(at.block);
      if (line === undefined) return new DOMRect(0, 0, 0, 0);
      const k = el.tagName === 'RUBY' ? Number((el as HTMLElement).dataset.o) || 0 : 0;
      const l = line + Math.floor(k / pagePerLine());
      const page = Math.floor(l / linesPerPage());
      return new DOMRect(page * PAGE_W + 10 + (k % pagePerLine()) * size(), 100 + (l % linesPerPage()) * pitch(), size(), size());
    }
    if (at) {
      const top = (scrollFlow().tops.get(at.block) ?? 0) - sy;
      if (el === at.block) {
        const n = chars(el);
        return new DOMRect(50, top, TEXT_W, n ? Math.ceil(n / perLine()) * pitch() : 0);
      }
      if (el.tagName === 'RUBY') {
        // The ruby box (character and pinyin) sits inside its line: 15% down, 60% of the pitch tall.
        const k = Number((el as HTMLElement).dataset.o) || 0;
        const lineTop = top + Math.floor(k / perLine()) * pitch();
        return new DOMRect(50 + (k % perLine()) * size(), lineTop + pitch() * 0.15, size(), pitch() * 0.6);
      }
    }
    if (el.classList?.contains('rd-paged')) return new DOMRect(0, 0, PAGE_W, VIEW_H);
    return new DOMRect(100, 100, 24, 30);
  };
  Element.prototype.getClientRects = function () {
    const el = this as Element;
    const at = blockOf(el);
    if (at && at.block === el && at.article.classList.contains('rd-paged')) {
      const line = pageFlow(at.article).get(el);
      if (line === undefined) return [] as unknown as DOMRectList;
      const last = line + Math.ceil(chars(el) / pagePerLine()) - 1;
      const rects: DOMRect[] = [];
      for (let p = Math.floor(line / linesPerPage()); p <= Math.floor(last / linesPerPage()); p++) rects.push(new DOMRect(p * PAGE_W + 10, 100, PAGE_TEXT_W, 40));
      return rects as unknown as DOMRectList;
    }
    return [] as unknown as DOMRectList;
  };
}

const rubyAt = (b: number, o: number, paged = false): HTMLElement => {
  const article = paged ? document.querySelector('.rd-article.rd-paged.rd-live') : scrollArticle();
  const block = [...article!.children].find((e) => (e as HTMLElement).dataset.b === String(b))!;
  return [...block.getElementsByTagName('ruby')].find((r) => (r as HTMLElement).dataset.o === String(o)) as HTMLElement;
};

/** The first character whose box reaches below the bar, as the reader measures its place: view block and offset. */
export function topLine(): { b: number; o: number } | null {
  const article = scrollArticle();
  if (!article) return null;
  for (const block of article.children) {
    if (!block.hasAttribute('data-b') || block.getBoundingClientRect().bottom <= BAR_H + 2) continue;
    for (const r of block.getElementsByTagName('ruby')) {
      if (r.getBoundingClientRect().bottom > BAR_H + 4) return { b: Number((block as HTMLElement).dataset.b), o: Number((r as HTMLElement).dataset.o) };
    }
  }
  return null;
}

/** Scroll so the line holding character `o` of view block `b` is just under the bar (as a restore puts it). */
export function scrollToLine(b: number, o: number): void {
  window.scrollBy(0, rubyAt(b, o).getBoundingClientRect().top - (BAR_H + 16));
}

/** Screen y of character `o` of view block `b` in Scroll. */
export function lineY(b: number, o: number): number {
  return rubyAt(b, o).getBoundingClientRect().top;
}

/** The page (1-based) that holds character `o` of view block `b` in the live Pages article. */
export function pageHolding(b: number, o: number): number {
  return Math.floor(rubyAt(b, o, true).getBoundingClientRect().left / PAGE_W) + 1;
}
