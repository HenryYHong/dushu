// The Pages layout (ARCHITECTURE.md 5.7): a chapter is laid out in CSS columns inside a fixed-height page area, one
// column per page, one or two pages on screen. This file owns the stage: geometry, pagination, page headers and
// footers, page turns (flip, slide, fade, none), swipes, the trackpad, and the neighbor chapters laid out ahead of time.
// What a page shows is always the real chapter DOM; only the turn animation uses copies of a page's text.
//
// Pagination is progressive. A chapter's blocks start out hidden (class rd-wait, display: none) and are revealed in
// slices; each slice renders the blocks it reveals, lays them out and reads which page every one of them landed on.
// The first spread is on screen as soon as the first few pages are known, and the rest is paginated in idle time,
// so opening a 30,000-character chapter costs a few thousand characters of layout, not all of them at once.
import type { AppContext, BookMeta, Settings } from '../../types';
import { h } from '../dom';
import type { BlockState, ChapterView } from './chapter';
import { applyGridVars, effectiveLineHeight, readingSize, resetMeasurements } from './grid';
import {
  blockOfPage, chapterFraction, computeGeometry, estimatePages, firstPageOfSpread, geometryKey, pageAtX, pageCount,
  pagesLeftLabel, settleDuration, spreadCount, spreadOfPage, swipeCompletes, tapZone, turnTarget,
  type BlockPages, type PageGeometry,
} from './pagination';

/** A reading position that survives re-pagination: a block and a UTF-16 offset inside it. */
export interface Anchor { block: number; offset: number }

/** Where to open a chapter: its start or end, a place in view block numbers, or a stored block number (the chapter title not counted). */
export type OpenAt = 'start' | 'end' | Anchor | { stored: number; offset?: number };

export interface PagerOptions {
  root: HTMLElement;
  ctx: AppContext;
  book: BookMeta;
  /** Build the view for a chapter (not yet drawn). Null when the chapter cannot be loaded. */
  makeView(index: number): Promise<ChapterView | null>;
  /** The active chapter changed (after open, or a turn across a chapter edge). */
  onChapter(index: number, view: ChapterView): void;
  /** The visible page changed: save progress, update the bar. */
  onMove(): void;
  /** The number of pages of the chapter on show became known more exactly (progress bar, labels). */
  onPaginated?(): void;
  /** A page is about to turn: close popups. */
  onTurnStart(): void;
  /** Is there a text selection or an open popup that a swipe must not disturb? */
  isBusy(): boolean;
  /** The reader reached the end of the book and tried to go on. */
  onEnd(): void;
  /** A neighbor chapter that a turn needed could not be shown. */
  onChapterError?(index: number, error: unknown): void;
  /** Book text as the reader shows it (the script setting applies to titles and running heads too). */
  text?(s: string): string;
  /** The end of a chapter offers its word list (the drawer's Words tab); without this the link is not shown. */
  onChapterWords?(index: number): void;
}

export interface Pager {
  stage: HTMLElement;
  open(index: number, at?: OpenAt): Promise<void>;
  next(): void;
  prev(): void;
  /** Jump to the first page of the previous or next chapter. */
  chapter(dir: 1 | -1): void;
  relayout(): void;
  /**
   * Call just before changing anything that moves the text (font size, spacing, script, names): the place is remembered and the
   * chapter's text is taken out of the layout, so the browser does not lay all of it out at the new size before the pager can
   * do it in slices. Follow with `relayout()` or `refresh()`.
   */
  freeze(): void;
  /** The chapter's DOM changed (script or lexicon): measure again, keeping the position. */
  refresh(): void;
  /** The text on the pages changed in a way that does not move anything (pinyin style, tone colors, known words): redo the turn pictures. */
  invalidate(): void;
  /** While held, the neighbor chapters are not laid out ahead of time (the first scan of a book is running). */
  holdNeighbors(on: boolean): void;
  /** Drop the neighbor chapters (their views are stale). */
  dropNeighbors(): void;
  view(): ChapterView | null;
  chapterIndex(): number;
  anchor(): Anchor | null;
  /**
   * The text on the pages on show: from the top of the spread to the top of the next one (`end` null: to the chapter's end).
   * Null while a page is turning or the chapter is being set.
   */
  shownRange(): { start: Anchor; end: Anchor | null } | null;
  /** Fraction of the whole book behind the reader, 0..1. */
  percent(): number;
  /** Show the page that holds this place without animating. */
  reveal(block: number, offset: number): void;
  /** Which zone a tap at `x` (viewport px) falls in, without acting on it. */
  zoneAt(x: number): 'prev' | 'next' | 'middle';
  /** A tap at `x` (viewport px): turns the page in the outer strips. Returns which zone it was. */
  tapAt(x: number): 'prev' | 'next' | 'middle';
  info(): { page: number; pages: number; spread: number; spreads: number; per: 1 | 2; exact: boolean };
  /** Make sure the pinyin of the pages on show and the ones next to them is drawn. */
  settle(): void;
  dispose(): void;
}

interface Layout {
  index: number;
  view: ChapterView;
  /** The geometry key the measured blocks are valid for. */
  key: string;
  /** Pages of the blocks measured so far (a prefix of the chapter). */
  cols: BlockPages[];
  /** Every block is measured. */
  done: boolean;
  /** Pages in the chapter: exact once `done`, an estimate before. */
  pages: number;
  weights: number[];
  totalWeight: number;
  measuredWeight: number;
}

type Plan = {
  dir: 1 | -1;
  from: { layout: Layout; spread: number };
  to: { layout: Layout; spread: number };
};

interface Turn {
  plan: Plan;
  kind: 'flip' | 'slide' | 'fade';
  /** The element that holds the turn's pictures (flip and fade), if any. */
  host: HTMLElement | null;
  /** Show the turn: nothing has moved yet. */
  start(): void;
  /** 0 = nothing turned yet, 1 = fully turned. */
  set(p: number): void;
  /** End the turn: keep the new page (commit) or put the old one back. */
  done(commit: boolean): void;
  p: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** How many spreads past the one on show are kept measured. */
const AHEAD_SPREADS = 3;
/** A chapter this short (in characters) is measured to its end in the background, so its page count is exact. */
const COMPLETE_BELOW = 16000;

/** Characters laid out in a pagination slice: tuned at run time so a slice takes about SLICE_MS. */
const SLICE_START = 700;
const SLICE_MS = 14;
/** The turn pictures wait this long after a turn settles, so they do not land in the same frames as the pump's first slices. */
const FACE_DELAY_MS = 300;
/** How long a synchronous stretch of work may run before it hands the main thread back so the busy overlay can draw. */
const STRETCH_MS = 32;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}

/** Hand the main thread back for a moment (input and drawing go first) and continue as soon as it is free. */
function yieldSlot(): Promise<void> {
  return new Promise((resolve) => {
    const sched = (navigator as Navigator & { scheduling?: { isInputPending?: () => boolean } }).scheduling;
    const go = () => {
      if (typeof MessageChannel === 'function') {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
        ch.port2.postMessage(0);
      } else setTimeout(resolve, 0);
    };
    // A touch or a key waiting for the page comes first.
    if (sched?.isInputPending?.()) setTimeout(go, 12);
    else go();
  });
}

function idleSlot(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 120 });
    // Safari has no idle callbacks: leave room for drawing and input between the steps.
    else setTimeout(resolve, 40);
  });
}

export function createPager(o: PagerOptions): Pager {
  const { root, ctx, book } = o;
  const settings = (): Settings => ctx.settings.get();
  const text = (s: string): string => (o.text ? o.text(s) : s);

  // ---------------------------------------------------------------- DOM
  const probe = h('div.rd-safe', { 'aria-hidden': 'true' });
  const spine = h('div.rd-spine', { 'aria-hidden': 'true' });
  const hf = h('div.rd-hf');
  const stash = h('div.rd-pager');
  const busy = h('div.rd-stage-busy', { hidden: true, role: 'status' }, h('span.app-spinner'), h('span', null, 'Setting the pages…'));
  const stage: HTMLElement = h('div.rd-stage', { 'data-rd-stage': '', tabindex: '0', role: 'region', 'aria-label': 'Book page. Press Enter to choose words with the arrow keys; Left and Right arrows turn the page.' },
    stash, spine, hf, busy, probe);

  // ---------------------------------------------------------------- state
  let geom: PageGeometry = computeGeometry({ width: 1000, height: 700, spread: 'auto', pageWidth: 760 });
  let extraKey = '';
  const layouts = new Map<number, Layout>();
  const loading = new Map<number, Promise<Layout | null>>();
  let cur: Layout | null = null;
  let spread = 0;
  let turn: Turn | null = null;
  let anim = 0;
  let disposed = false;
  let openSeq = 0;
  let relayoutSeq = 0;
  let pumpSeq = 0;
  let pumping = false;
  let sliceChars = SLICE_START;
  let suppressClickUntil = 0;
  let relayoutTimer = 0;
  let faceTimer = 0;
  let neighborsHeld = false;
  let measuring = false;
  /** `freeze()` hid the chapter and `relayoutNow` has not put it back yet. */
  let frozen = false;
  /** The place an unfinished relayout is working toward: a second one that starts meanwhile keeps it. */
  let pendingBefore: Anchor | null = null;
  /**
   * The place the reader is really at. After a reflow the page that holds it starts earlier, so reading the place back
   * off the new page would creep toward the start on every change; the place is kept until the reader turns a page.
   */
  let intent: Anchor | null = null;

  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ------------------------------------------------------------ geometry
  function readSafe(): { top: number; bottom: number } {
    const cs = getComputedStyle(probe);
    return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
  }

  /** Everything besides the window size that changes where the text breaks. */
  function layoutExtra(s: Settings): string {
    return [s.fontFamily, s.fontSize, s.lineHeight, s.pinyin === 'off' ? 'off' : s.pinyinStyle, s.script].join(',');
  }

  function computeAll(): void {
    const s = settings();
    const safe = readSafe();
    const size = readingSize(s);
    const grid = applyGridVars(root, size, s.pinyinStyle);
    geom = computeGeometry({
      width: stage.clientWidth || window.innerWidth,
      height: stage.clientHeight || window.innerHeight,
      spread: s.spread,
      pageWidth: s.pageWidth,
      safeTop: safe.top,
      safeBottom: safe.bottom,
      linePitch: size * effectiveLineHeight(s.lineHeight, s.pinyin),
      cellPx: s.pinyin === 'off' ? undefined : grid.metrics.cellEm * size,
    });
    extraKey = layoutExtra(s);
    const st = stage.style;
    st.setProperty('--pg-w', `${geom.width}px`);
    st.setProperty('--pg-h', `${geom.height}px`);
    st.setProperty('--pg-paper', `${geom.paperW}px`);
    st.setProperty('--pg-cw', `${geom.cw}px`);
    st.setProperty('--pg-gap', `${geom.gap}px`);
    st.setProperty('--pg-left', `${geom.margin}px`);
    st.setProperty('--pg-top', `${geom.textTop}px`);
    st.setProperty('--pg-th', `${geom.textH}px`);
    st.setProperty('--pg-cols', String(geom.per));
    st.setProperty('--pg-header-top', `${geom.headerTop}px`);
    st.setProperty('--pg-footer-bottom', `${geom.footerBottom}px`);
    stage.dataset.per = String(geom.per);
    root.style.setProperty('--rd-text-h', `${geom.textH}px`);
    root.style.setProperty('--rd-col-w', `${geom.cw}px`);
  }

  const keyNow = () => geometryKey(geom, extraKey);

  // ------------------------------------------------------------- layouts
  const weightOf = (b: BlockState) => (b.kind === 'text' ? Math.max(1, b.text.length) : 80);

  function styleLayout(l: Layout): void {
    const el = l.view.el;
    el.classList.add('rd-paged');
    el.classList.remove('rd-live');
    el.setAttribute('aria-hidden', 'true');
  }

  /** Forget what was measured and hide every block again: the next slices reveal and measure them one stretch at a time. */
  function resetMeasure(l: Layout): void {
    l.cols = [];
    l.done = false;
    l.measuredWeight = 0;
    l.key = keyNow();
    for (const b of l.view.blocks) b.el.classList.add('rd-wait');
    if (!l.view.blocks.length) l.done = true;
  }

  function createLayout(index: number, view: ChapterView): Layout {
    const weights = view.blocks.map(weightOf);
    const l: Layout = {
      index, view, key: '', cols: [], done: false, pages: 1,
      weights, totalWeight: weights.reduce((a, b) => a + b, 0), measuredWeight: 0,
    };
    layouts.set(index, l);
    styleLayout(l);
    stash.appendChild(view.el);
    resetMeasure(l);
    return l;
  }

  /** Read which page each of blocks [from, to) landed on. They must be revealed (and rendered). */
  function measureBlocks(l: Layout, from: number, to: number): void {
    const el = l.view.el;
    const stride = geom.paperW;
    const base = el.getBoundingClientRect().left;
    let prevLast = from > 0 && l.cols[from - 1] ? l.cols[from - 1].last : 0;
    for (let i = from; i < to; i++) {
      const rects = l.view.blocks[i].el.getClientRects();
      let first = prevLast;
      let last = prevLast;
      if (rects.length) {
        first = pageAtX(rects[0].left - base, stride);
        last = pageAtX(rects[rects.length - 1].left - base, stride);
      }
      // A block cannot start before the one ahead of it ends.
      first = Math.max(first, 0);
      last = Math.max(last, first);
      l.cols[i] = { first, last };
      prevLast = Math.max(prevLast, last);
    }
    l.cols.length = Math.max(l.cols.length, to);
    let w = 0;
    for (let i = 0; i < to; i++) w += l.weights[i];
    l.measuredWeight = w;
    l.done = to >= l.view.blocks.length;
    l.pages = l.done ? pageCount(l.cols) : estimatePages(pageCount(l.cols), w, l.totalWeight);
    l.key = keyNow();
  }

  /** Reveal, render and measure the next blocks, about `chars` characters of them. Returns true when the chapter is done. */
  function advance(l: Layout, chars: number): boolean {
    if (l.done) return true;
    const from = l.cols.length;
    const total = l.view.blocks.length;
    let end = from;
    let w = 0;
    while (end < total && (w < chars || end === from)) {
      l.view.ensure(end);
      l.view.blocks[end].el.classList.remove('rd-wait');
      w += l.weights[end];
      end++;
    }
    // The last block or two of the previous stretch may have moved (a heading wants to stay with the paragraph after it).
    measureBlocks(l, Math.max(0, from - 2), end);
    return l.done;
  }

  /** Pages below this number cannot change when more blocks are measured. */
  const safeLimit = (l: Layout) => (l.done ? Infinity : l.cols.length ? l.cols[l.cols.length - 1].first : 0);
  const valid = (l: Layout | undefined | null): l is Layout => !!l && l.key === keyNow();

  /** One slice of pagination, timed so the next one is sized to take about SLICE_MS. */
  function timedAdvance(l: Layout): boolean {
    const t0 = performance.now();
    const done = advance(l, sliceChars);
    const took = performance.now() - t0;
    if (took > 0.5) sliceChars = clamp(Math.round((sliceChars * SLICE_MS) / took), 150, 2400);
    return done;
  }

  /**
   * Paginate `l` until `until` holds (or the chapter is done), handing the main thread back every STRETCH_MS so the busy
   * overlay can show. Resolves false when `alive()` turned false meanwhile.
   */
  async function advanceUntil(l: Layout, until: (l: Layout) => boolean, alive: () => boolean): Promise<boolean> {
    let t0 = performance.now();
    while (!l.done && !until(l)) {
      if (!alive()) return false;
      // Somebody is waiting: take bigger bites (the cost of a slice grows with what is already laid out), a quarter of what is left.
      const left = l.totalWeight - l.measuredWeight;
      if (left > 4 * sliceChars) advance(l, Math.max(sliceChars, Math.floor(left / 4)));
      else timedAdvance(l);
      if (performance.now() - t0 > STRETCH_MS) {
        if (!measuring) setMeasuring(true);
        await nextFrame();
        t0 = performance.now();
      }
    }
    return alive();
  }

  /** Synchronous, for the few places that need an answer now (a turn a little ahead of the paginating). */
  function advanceNow(l: Layout, until: (l: Layout) => boolean): void {
    let guard = 0;
    while (!l.done && !until(l) && guard++ < 400) timedAdvance(l);
  }

  /** Page `p` of `l` is final (or the chapter ended before it). */
  const pageFinal = (p: number) => (l: Layout) => l.done || p < safeLimit(l);
  const anchorMeasured = (a: Anchor) => (l: Layout) => l.done || l.cols.length > clamp(a.block, 0, l.view.blocks.length - 1) + 1;

  function setMeasuring(on: boolean): void {
    measuring = on;
    stage.classList.toggle('rd-measuring', on);
    busy.hidden = !on;
  }

  async function loadLayout(index: number): Promise<Layout | null> {
    const have = layouts.get(index);
    if (have) return have;
    const pending = loading.get(index);
    if (pending) return pending;
    const p = (async () => {
      const view = await o.makeView(index);
      if (!view || disposed) { view?.dispose(); return null; }
      const raced = layouts.get(index);
      if (raced) { view.dispose(); return raced; }
      return createLayout(index, view);
    })().finally(() => { loading.delete(index); });
    loading.set(index, p);
    return p;
  }

  function discard(i: number, l: Layout): void {
    l.view.dispose();
    l.view.el.remove();
    layouts.delete(i);
  }

  function evictFar(keep: number): void {
    for (const [i, l] of layouts) if (Math.abs(i - keep) > 1) discard(i, l);
  }

  function dropNeighbors(): void {
    for (const [i, l] of layouts) if (l !== cur) discard(i, l);
  }

  // ---------------------------------------------------------- positions
  function rubyPage(l: Layout, ruby: Element): number {
    const base = l.view.el.getBoundingClientRect().left;
    return pageAtX(ruby.getBoundingClientRect().left - base, geom.paperW);
  }

  /** The place at the top of a page: its first block and, when that block began earlier, the first character on the page. */
  function anchorAtPage(l: Layout, page: number): Anchor {
    if (!l.cols.length) return { block: 0, offset: 0 };
    const bi = Math.min(blockOfPage(l.cols, page), l.cols.length - 1);
    const cols = l.cols[bi];
    if (!cols || cols.first >= page) return { block: bi, offset: 0 };
    const rubies = l.view.blocks[bi].el.querySelectorAll('ruby.rd-c');
    let lo = 0;
    let hi = rubies.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rubyPage(l, rubies[mid]) >= page) { found = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (found < 0) return { block: bi, offset: 0 };
    return { block: bi, offset: Number((rubies[found] as HTMLElement).dataset.o) || 0 };
  }

  /** The page that holds a place. The blocks up to it must be measured (see anchorMeasured). */
  function pageOfAnchor(l: Layout, a: Anchor): number {
    if (!l.cols.length) return 0;
    const bi = clamp(a.block, 0, l.cols.length - 1);
    const c = l.cols[bi];
    if (!c) return 0;
    if (a.offset <= 0) return c.first;
    const rubies = l.view.blocks[bi].el.querySelectorAll('ruby.rd-c');
    let lo = 0;
    let hi = rubies.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((Number((rubies[mid] as HTMLElement).dataset.o) || 0) >= a.offset) { found = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (found < 0) return c.last;
    return clamp(rubyPage(l, rubies[found]), c.first, c.last);
  }

  const spreadsOf = (l: Layout) => spreadCount(l.pages, geom.per);
  const lastPageOfSpread = (sp: number) => firstPageOfSpread(sp, geom.per) + geom.per - 1;

  // ---------------------------------------------------- pinyin near the eye
  /** Draw the pinyin of every block that has a piece on the pages [first, last]. */
  function ensurePinyinPages(l: Layout, first: number, last: number): void {
    if (!l.cols.length) return;
    let bi = Math.min(blockOfPage(l.cols, first), l.cols.length - 1);
    for (; bi < l.cols.length; bi++) {
      if (l.cols[bi].first > last) break;
      l.view.ensurePinyin(bi);
    }
  }

  function ensurePinyinSpread(l: Layout, sp: number): void {
    ensurePinyinPages(l, firstPageOfSpread(sp, geom.per), lastPageOfSpread(sp));
  }

  // ----------------------------------------------------- headers, footers
  function titleOf(index: number): string {
    const l = layouts.get(index);
    const t = l?.view.title || book.chapterTitles?.[index] || '';
    return t ? text(t) : '';
  }

  function chapterName(l: Layout): string {
    const t = l.view.title || book.chapterTitles?.[l.index] || `Chapter ${l.index + 1}`;
    // A one-chapter book (a poem, a pasted page) would show its title twice.
    return book.chapterCount === 1 && t === book.title ? '' : text(t);
  }

  function goNextChapterLabel(l: Layout): string {
    const t = titleOf(l.index + 1);
    return t ? `Next: ${t}` : 'Next chapter';
  }

  /** The blank page after a chapter's last page: a quiet end mark and the way on. */
  function endCard(l: Layout): HTMLElement {
    const last = l.index >= book.chapterCount - 1;
    const card = h('div.rd-endcard', { 'data-rd-ui': '' },
      h('div.rd-endmark', { 'aria-hidden': 'true' }),
      h('p.rd-endnote', null, last ? 'You have reached the end of the book.' : 'End of chapter'));
    if (last) card.appendChild(h('a.rd-endbtn', { href: '#/' }, 'Back to the library'));
    else card.appendChild(h('button.rd-endbtn', { type: 'button', onclick: () => api.chapter(1) }, goNextChapterLabel(l)));
    const words = wordsButton(l, 'button.rd-endbtn.rd-endbtn-quiet', 'Words in this chapter');
    if (words) card.appendChild(words);
    return card;
  }

  /** The way to the chapter's word list, from its last page. */
  function wordsButton(l: Layout, tag: string, label: string): HTMLElement | null {
    const go = o.onChapterWords;
    return go ? h(tag, { type: 'button', 'data-rd-ui': '', onclick: () => go(l.index) }, label) : null;
  }

  function pageChrome(l: Layout, page: number, side: 'left' | 'right' | 'single'): HTMLElement {
    const el = h('div.rd-pc');
    if (page >= l.pages) {
      // The blank page that finishes an odd chapter.
      if (side === 'right' && page === l.pages && l.done) el.appendChild(endCard(l));
      return el;
    }
    const header = side === 'left' ? text(book.title) : chapterName(l) || text(book.title);
    const lastShown = side === 'single' || side === 'right';
    const isLast = page >= l.pages - 1;
    const footer = h('div.rd-ftr', { 'data-side': side }, h('span.rd-ftr-n', null, String(page + 1)));
    if (lastShown) {
      // One-page mode has no blank page to hold an end card: the footer carries the way on, and the chapter's words.
      if (side === 'single' && isLast && l.done) {
        const on = l.index < book.chapterCount - 1
          ? h('button.rd-ftr-next', { type: 'button', 'data-rd-ui': '', onclick: () => api.chapter(1) }, goNextChapterLabel(l), ' ›')
          : h('span.rd-ftr-left', null, 'End of the book');
        footer.appendChild(h('span.rd-ftr-end', null, wordsButton(l, 'button.rd-ftr-words', 'Words'), on));
      } else if (side === 'right' && isLast && l.done && o.onChapterWords) {
        // The last page of a chapter that fills its spread (no blank page follows).
        footer.appendChild(wordsButton(l, 'button.rd-ftr-words', 'Words in this chapter')!);
      } else footer.appendChild(h('span.rd-ftr-left', null, pagesLeftLabel(page, l.pages, !l.done)));
    }
    el.append(h('div.rd-hdr', null, h('span', null, header)), footer);
    return el;
  }

  function slotSide(i: number): 'left' | 'right' | 'single' {
    return geom.per === 1 ? 'single' : i === 0 ? 'left' : 'right';
  }

  function paintChrome(l: Layout, sp: number): void {
    hf.textContent = '';
    const first = firstPageOfSpread(sp, geom.per);
    for (let i = 0; i < geom.per; i++) {
      const slot = h('div.rd-pc-slot', { style: `left:${i * geom.paperW}px;width:${geom.paperW}px` });
      slot.appendChild(pageChrome(l, first + i, slotSide(i)));
      hf.appendChild(slot);
    }
  }

  // --------------------------------------------------------------- live
  /** Show a spread of a layout in the stage (no animation). */
  function showLive(l: Layout, sp: number): void {
    if (!l.done) advanceNow(l, pageFinal(lastPageOfSpread(sp)));
    ensurePinyinSpread(l, sp);
    for (const other of layouts.values()) {
      const on = other === l;
      other.view.el.classList.toggle('rd-live', on);
      other.view.el.setAttribute('aria-hidden', on ? 'false' : 'true');
      other.view.el.style.transform = on ? `translate3d(${-sp * geom.width}px,0,0)` : '';
    }
    paintChrome(l, sp);
    stage.dataset.page = String(firstPageOfSpread(sp, geom.per) + 1);
    stage.dataset.pages = String(l.pages);
    stage.dataset.exact = String(l.done);
    stage.dataset.spread = String(sp);
    stage.dataset.chapter = String(l.index);
    stage.dataset.block = String(anchorAtPage(l, firstPageOfSpread(sp, geom.per)).block);
  }

  /** `drawn`: the live pages already show this spread (a turn put it there when it started), so only the bookkeeping is left. */
  function setCurrent(l: Layout, sp: number, announce: boolean, reflow = false, drawn = false): void {
    if (!reflow) intent = null;
    const changed = cur !== l;
    cur = l;
    spread = clamp(sp, 0, spreadsOf(l) - 1);
    if (!drawn) showLive(l, spread);
    if (changed && announce) o.onChapter(l.index, l.view);
    o.onMove();
    scheduleFaces();
  }

  /** The chapter on show got further along: update the numbers that depend on its length. */
  function repaintPages(): void {
    if (!cur) return;
    stage.dataset.pages = String(cur.pages);
    stage.dataset.exact = String(cur.done);
    if (!turn) paintChrome(cur, spread);
    o.onPaginated?.();
  }

  // ---------------------------------------------------------------- pump
  /**
   * Background work, one slice at a time: finish the chapter on show, then get the next chapter's first pages ready,
   * then the previous chapter (when it is short) so a turn back is instant too.
   */
  function startPump(): void {
    if (pumping || disposed) return;
    pumping = true;
    void (async () => {
      const mine = ++pumpSeq;
      try {
        while (!disposed && mine === pumpSeq) {
          await yieldSlot();
          if (disposed || mine !== pumpSeq) return;
          if (turn || drag?.state === 'drag') continue;
          if (!(await pumpOnce(mine))) return;
        }
      } catch (e) {
        console.error('pagination', e);
      } finally {
        if (mine === pumpSeq) pumping = false;
      }
    })();
  }

  function cancelPump(): void {
    pumpSeq++;
    pumping = false;
  }

  /** Do one slice of the most useful background job. False when there is nothing left to do. */
  async function pumpOnce(mine: number): Promise<boolean> {
    const here = cur;
    if (!here) return false;
    // Pages are measured a few spreads ahead of the reader, no further: laying out a revealed chapter again for every slice
    // costs more the more of it there is. A short chapter is finished anyway (its page count is then exact); a long one keeps
    // an estimate ("About 40 pages left") until the reader gets near the end or jumps there.
    if (valid(here) && !here.done && (safeLimit(here) <= lastPageOfSpread(spread) + AHEAD_SPREADS * geom.per || here.totalWeight <= COMPLETE_BELOW)) {
      timedAdvance(here);
      repaintPages();
      return true;
    }
    if (!valid(here)) return false;
    if (ensureNearPinyin()) return true;
    if (neighborsHeld) return false;
    for (const dir of [1, -1] as const) {
      const idx = here.index + dir;
      if (idx < 0 || idx >= book.chapterCount) continue;
      let nb = layouts.get(idx);
      if (!nb) {
        evictFar(here.index);
        nb = (await loadLayout(idx)) ?? undefined;
        if (!nb || mine !== pumpSeq || cur !== here) return mine === pumpSeq;
      }
      if (!valid(nb)) resetMeasure(nb);
      // Forward: only the first pages are needed. Backward: the last page is needed, so the chapter has to be whole; a long
      // one waits until the reader actually turns back.
      const want = dir === 1 ? !nb.done && safeLimit(nb) <= 2 * geom.per : !nb.done && nb.totalWeight <= 14000;
      if (want) { timedAdvance(nb); return true; }
    }
    return false;
  }

  /** Has a block on these pages still to draw its pinyin? */
  function pinyinPending(l: Layout, sp: number): boolean {
    if (!l.cols.length) return false;
    const last = lastPageOfSpread(sp);
    for (let bi = Math.min(blockOfPage(l.cols, firstPageOfSpread(sp, geom.per)), l.cols.length - 1); bi < l.cols.length; bi++) {
      if (l.cols[bi].first > last) break;
      if (l.view.blocks[bi].rendered?.pinyinBuilt === false) return true;
    }
    return false;
  }

  /** Pinyin for the spreads next to the one on show, one spread per call, so a turn does not have to build any. True if it did some. */
  function ensureNearPinyin(): boolean {
    if (!cur) return false;
    for (const s of [spread + 1, spread - 1]) {
      if (s < 0 || s >= spreadsOf(cur)) continue;
      if (!cur.done && lastPageOfSpread(s) >= safeLimit(cur)) continue;
      if (!pinyinPending(cur, s)) continue;
      ensurePinyinSpread(cur, s);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- faces
  function blankFace(host: HTMLElement): HTMLElement {
    const f = h('div.rd-face');
    host.appendChild(f);
    return f;
  }

  /** First and last ruby of a block that sit on `page` (indices), or [-1, -1]. Rubies run in reading order. */
  function rubiesOnPage(l: Layout, rubies: NodeListOf<Element>, page: number): [number, number] {
    let lo = 0;
    let hi = rubies.length - 1;
    let first = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rubyPage(l, rubies[mid]) >= page) { first = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (first < 0 || rubyPage(l, rubies[first]) !== page) return [-1, -1];
    lo = first;
    hi = rubies.length - 1;
    let last = first;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rubyPage(l, rubies[mid]) <= page) { last = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return [first, last];
  }

  /**
   * A picture of one page: its header, footer and the text that sits on it, copied from the live chapter.
   * Each block that has a piece on the page is copied whole and shown through a window that cuts out that piece
   * (the browser reports a broken block as filling its column to the bottom, so the window is sized from the
   * characters that are really on the page).
   */
  function buildFace(host: HTMLElement, l: Layout, page: number, side: 'left' | 'right' | 'single'): HTMLElement {
    const steps = buildFaceSteps(host, l, page, side, false);
    let r = steps.next();
    while (!r.done) r = steps.next();
    return r.value;
  }

  /**
   * The same, a few blocks at a time: with `pause` it yields whenever it has held the thread for a few milliseconds, so an idle build
   * does not land as one long frame (copying a page and laying it out took 40 to 70 ms, then 50 to 100 ms for the frame that followed).
   */
  function* buildFaceSteps(host: HTMLElement, l: Layout, page: number, side: 'left' | 'right' | 'single', pause: boolean): Generator<void, HTMLElement, void> {
    const face = h('div.rd-face');
    host.appendChild(face);
    if (page >= l.pages + (side === 'right' && l.done ? 1 : 0) || page < 0) return face;
    const chrome = pageChrome(l, page, side);
    // A picture, not a control: nothing in it may take focus.
    for (const x of chrome.querySelectorAll('button, a')) x.setAttribute('tabindex', '-1');
    face.appendChild(chrome);
    if (page >= l.pages) return face;
    ensurePinyinPages(l, page, page);
    const text = h('div.rd-article.rd-clone');
    face.appendChild(text);
    // Pinyin hangs above the first line of a block; leave room for it above the window.
    const head = Math.ceil(settings().fontSize * 1.2);
    let lastYield = performance.now();
    for (let i = Math.min(blockOfPage(l.cols, page), l.cols.length - 1); i < l.cols.length; i++) {
      const c = l.cols[i];
      if (c.first > page) break;
      const b: BlockState = l.view.blocks[i];
      // Measured again for every block: a build that pauses between blocks may find the stage lifted for a word card meanwhile.
      const m = l.view.el.getBoundingClientRect();
      const base = m.left;
      const mTop = m.top;
      const rects = Array.from(b.el.getClientRects());
      const idx = rects.findIndex((r) => pageAtX(r.left - base, geom.paperW) === page);
      if (idx < 0) continue;
      const r = rects[idx];
      const continuesBefore = idx > 0;
      const continuesAfter = c.last > page;
      const top = r.top - mTop;
      let height = r.height;
      let rubyTop = -1;
      let kFirst = -1;
      if (b.kind === 'text' && (continuesBefore || continuesAfter)) {
        const rubies = b.el.querySelectorAll('ruby.rd-c');
        const [k, j] = rubiesOnPage(l, rubies, page);
        if (k >= 0) {
          kFirst = k;
          rubyTop = rubies[k].getBoundingClientRect().top - mTop;
          if (continuesAfter) height = rubies[j].getBoundingClientRect().bottom - mTop - top + 2;
        }
      }
      const clone = b.el.cloneNode(true) as HTMLElement;
      clone.removeAttribute('data-b');
      clone.classList.remove('rd-wait');
      clone.removeAttribute('role');
      for (const x of Array.from(clone.querySelectorAll('[data-rd-ui]'))) x.remove();
      for (const x of Array.from(clone.querySelectorAll('[role]'))) x.removeAttribute('role');
      clone.style.cssText = `margin:0;position:relative;top:${head}px;`;
      const frag = h('div.rd-frag', { style: `top:${Math.round((top - head) * 100) / 100}px;height:${Math.round((height + head) * 100) / 100}px` }, clone);
      text.appendChild(frag);
      if (continuesBefore && kFirst >= 0) {
        // Slide the copy up so that its first character on this page lands where it is in the live chapter.
        const own = clone.querySelectorAll('ruby.rd-c')[kFirst];
        if (own) {
          const inside = own.getBoundingClientRect().top - clone.getBoundingClientRect().top;
          const shift = inside - (rubyTop - top);
          clone.style.top = `${head - shift}px`;
        }
      }
      if (pause && performance.now() - lastYield > 12) { yield; lastYield = performance.now(); }
    }
    return face;
  }

  // ---------------------------------------------------------------- turns
  /** Where a turn in `dir` would go, or null when the target is not ready (or there is none). */
  function planTurn(dir: 1 | -1): Plan | null {
    if (!cur || !valid(cur)) return null;
    if (dir === 1) {
      const nextSp = spread + 1;
      if (!cur.done) advanceNow(cur, pageFinal(lastPageOfSpread(nextSp)));
      if (nextSp < spreadsOf(cur)) return { dir, from: { layout: cur, spread }, to: { layout: cur, spread: nextSp } };
      const nb = layouts.get(cur.index + 1);
      if (cur.index + 1 >= book.chapterCount || !valid(nb)) return null;
      if (!nb.done) advanceNow(nb, pageFinal(lastPageOfSpread(0)));
      return { dir, from: { layout: cur, spread }, to: { layout: nb, spread: 0 } };
    }
    if (spread > 0) return { dir, from: { layout: cur, spread }, to: { layout: cur, spread: spread - 1 } };
    const pv = layouts.get(cur.index - 1);
    if (cur.index <= 0 || !valid(pv) || !pv.done) return null;
    return { dir, from: { layout: cur, spread }, to: { layout: pv, spread: spreadsOf(pv) - 1 } };
  }

  // A finished turn's pictures are hidden at once and taken apart a moment later: tearing down thousands of nodes in the
  // frame that ends the turn showed as a stall at the very end of the flip.
  const spent: HTMLElement[] = [];
  let reapTimer = 0;
  function retire(host: HTMLElement): void {
    host.setAttribute('data-idle', '');
    // Out of the render tree altogether (opacity 0 still keeps its 3D layers, which showed as a 60 to 90 ms frame just after the turn).
    host.setAttribute('data-spent', '');
    spent.push(host);
    window.clearTimeout(reapTimer);
    reapTimer = window.setTimeout(function reap() {
      if (turn || drag?.state === 'drag') { reapTimer = window.setTimeout(reap, 400); return; }
      for (const x of spent.splice(0)) x.remove();
    }, spent.length > 2 ? 200 : 1500);
  }

  /** Make a hidden host for a turn's pictures: laid out, so the pictures can be measured, but not seen. */
  function makeHost(): HTMLElement {
    const host = h('div.rd-turn', { 'aria-hidden': 'true', 'data-idle': '' });
    stage.insertBefore(host, busy);
    return host;
  }

  /**
   * The flip: a leaf that rotates around the spine. Everything is built here, against a hidden host, so that starting
   * the turn is only a matter of revealing it: no copying and no measuring on the first frame.
   */
  function* flipSteps(plan: Plan, host: HTMLElement, idle = false): Generator<void, Turn, void> {
    const { dir, from, to } = plan;
    const per = geom.per;
    const fromFirst = firstPageOfSpread(from.spread, per);
    const toFirst = firstPageOfSpread(to.spread, per);
    const W = geom.width;
    const paper = geom.paperW;
    host.style.perspective = `${Math.round(Math.max(1800, W * 2.4))}px`;

    let staticFace: HTMLElement | null = null;
    let front: HTMLElement;
    let back: HTMLElement;
    if (per === 2) {
      // One face at a time, so an idle build never holds the main thread for more than one page's worth of copying.
      if (dir === 1) {
        staticFace = yield* buildFaceSteps(host, from.layout, fromFirst, 'left', idle);
        yield;
        front = yield* buildFaceSteps(host, from.layout, fromFirst + 1, 'right', idle);
        yield;
        back = yield* buildFaceSteps(host, to.layout, toFirst, 'left', idle);
      } else {
        staticFace = yield* buildFaceSteps(host, from.layout, fromFirst + 1, 'right', idle);
        yield;
        front = yield* buildFaceSteps(host, to.layout, toFirst + 1, 'right', idle);
        yield;
        back = yield* buildFaceSteps(host, from.layout, fromFirst, 'left', idle);
      }
      yield;
    } else if (dir === 1) {
      front = yield* buildFaceSteps(host, from.layout, fromFirst, 'single', idle);
      back = blankFace(host);
    } else {
      staticFace = yield* buildFaceSteps(host, from.layout, fromFirst, 'single', idle);
      front = yield* buildFaceSteps(host, to.layout, toFirst, 'single', idle);
      back = blankFace(host);
    }

    const shadeUnder = h('div.rd-shade.rd-shade-under');
    const shadeAside = h('div.rd-shade.rd-shade-aside');
    const shadeFront = h('div.rd-shade.rd-shade-front');
    const shadeBack = h('div.rd-shade.rd-shade-back');
    front.classList.add('rd-face-front');
    back.classList.add('rd-face-back');
    front.appendChild(shadeFront);
    back.appendChild(shadeBack);
    const leaf = h('div.rd-leaf', { style: `left:${(per === 2 ? paper : 0)}px;width:${paper}px` }, front, back);

    // The page under the leaf and the page beside it (two-page mode) get a soft shadow while the leaf passes.
    const underSlot = h('div.rd-under', { style: `left:${per === 2 ? paper : 0}px;width:${paper}px` }, shadeUnder);
    const sideSlot = per === 2 ? h('div.rd-aside', { style: `left:0;width:${paper}px` }, shadeAside) : null;
    if (staticFace) {
      staticFace.style.left = dir === 1 ? '0px' : `${per === 2 ? paper : 0}px`;
      staticFace.style.width = `${paper}px`;
      staticFace.classList.add('rd-face-static');
    }
    host.append(...[underSlot, sideSlot, leaf].filter((x): x is HTMLElement => !!x));

    const t: Turn = {
      plan, kind: 'flip', host, p: 0,
      start() {
        // The live pages show the destination, under the leaf and the static page.
        showLive(to.layout, to.spread);
        host.removeAttribute('data-idle');
      },
      set(p) {
        t.p = p;
        const theta = dir === 1 ? 180 * p : 180 * (1 - p); // angle of the leaf from flat, 0..180
        leaf.style.transform = `rotateY(${-theta}deg)`;
        const rad = (theta * Math.PI) / 180;
        const sin = Math.sin(rad);
        const dark = (n: number) => String(clamp(n, 0, 1));
        // Lit when flat, darker the more it turns away; the back is darkest just after it comes into view.
        shadeFront.style.opacity = dark(theta < 90 ? Math.pow(theta / 90, 1.4) * 0.9 : 0);
        shadeBack.style.opacity = dark(theta > 90 ? Math.pow((180 - theta) / 90, 1.2) * 0.8 : 0);
        shadeUnder.style.opacity = dark(clamp((120 - theta) / 40, 0, 1) * sin * 1.1);
        shadeAside.style.opacity = dark(clamp((theta - 60) / 40, 0, 1) * sin * 1.1);
      },
      done(commit) {
        retire(host);
        if (commit) setCurrent(to.layout, to.spread, to.layout !== from.layout, false, true);
        else showLive(from.layout, from.spread);
        t.p = commit ? 1 : 0;
      },
    };
    t.set(0);
    return t;
  }

  /** Run a stepwise build to the end without pausing. */
  function buildFlip(plan: Plan, host: HTMLElement): Turn {
    const gen = flipSteps(plan, host);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  }

  /** Reduced motion: the old pages fade out over the new ones. */
  function buildFade(plan: Plan): Turn {
    const { from, to } = plan;
    const per = geom.per;
    const host = makeHost();
    const fromFirst = firstPageOfSpread(from.spread, per);
    for (let i = 0; i < per; i++) {
      const face = buildFace(host, from.layout, fromFirst + i, slotSide(i));
      face.style.left = `${i * geom.paperW}px`;
      face.style.width = `${geom.paperW}px`;
    }
    const t: Turn = {
      plan, kind: 'fade', host, p: 0,
      start() { showLive(to.layout, to.spread); host.removeAttribute('data-idle'); },
      set(p) { t.p = p; host.style.opacity = String(1 - p); },
      done(commit) {
        retire(host);
        if (commit) setCurrent(to.layout, to.spread, to.layout !== from.layout, false, true);
        else showLive(from.layout, from.spread);
        t.p = commit ? 1 : 0;
      },
    };
    t.set(0);
    return t;
  }

  function buildSlide(plan: Plan): Turn {
    const { dir, from, to } = plan;
    const W = geom.width;
    const fromEl = from.layout.view.el;
    const toEl = to.layout.view.el;
    const same = from.layout === to.layout;
    const fromX = -from.spread * W;
    const toX = -to.spread * W + (same ? 0 : dir * W);
    const t: Turn = {
      plan, kind: 'slide', host: null, p: 0,
      start() {
        if (!same) { toEl.classList.add('rd-live'); toEl.setAttribute('aria-hidden', 'false'); }
        hf.style.opacity = '0';
      },
      set(p) {
        t.p = p;
        if (same) fromEl.style.transform = `translate3d(${fromX + (toX - fromX) * p}px,0,0)`;
        else {
          fromEl.style.transform = `translate3d(${fromX - dir * W * p}px,0,0)`;
          toEl.style.transform = `translate3d(${toX - dir * W * p}px,0,0)`;
        }
      },
      done(commit) {
        if (commit) setCurrent(to.layout, to.spread, !same);
        else showLive(from.layout, from.spread);
        hf.style.opacity = '';
      },
    };
    return t;
  }

  // Turn pictures made ahead of time (flip only), one per direction.
  type Prepared = { turn: Turn; from: Layout; fromSpread: number; to: Layout; toSpread: number; key: string };
  const prepared = new Map<1 | -1, Prepared>();

  function dropPrepared(): void {
    for (const p of prepared.values()) p.turn.host?.remove();
    prepared.clear();
  }

  function invalidateFaces(): void {
    window.clearTimeout(faceTimer);
    faceEpoch++;
    dropPrepared();
  }

  let faceEpoch = 0;

  /** After the page settles, build the next and previous turn while the reader reads, a face at a time. */
  function scheduleFaces(): void {
    window.clearTimeout(faceTimer);
    dropPrepared();
    faceEpoch++;
    if (disposed || kindNow() !== 'flip') return;
    const at = cur;
    const atSpread = spread;
    const epoch = faceEpoch;
    const stale = () => disposed || epoch !== faceEpoch || !!turn || drag?.state === 'drag' || cur !== at || spread !== atSpread || !valid(at);
    faceTimer = window.setTimeout(async () => {
      for (const dir of [1, -1] as const) {
        await idleSlot();
        if (stale()) return;
        const plan = planTurnQuiet(dir);
        if (!plan) continue;
        ensurePinyinSpread(plan.to.layout, plan.to.spread);
        const host = makeHost();
        const gen = flipSteps(plan, host, true);
        let r = gen.next();
        while (!r.done) {
          await idleSlot();
          if (stale()) { host.remove(); return; }
          r = gen.next();
        }
        prepared.set(dir, {
          turn: r.value, from: plan.from.layout, fromSpread: plan.from.spread,
          to: plan.to.layout, toSpread: plan.to.spread, key: keyNow(),
        });
      }
    }, FACE_DELAY_MS);
  }

  /** planTurn without doing any pagination work: null unless the target is already measured. */
  function planTurnQuiet(dir: 1 | -1): Plan | null {
    if (!cur || !valid(cur)) return null;
    if (dir === 1) {
      const nextSp = spread + 1;
      if (nextSp < spreadsOf(cur) && (cur.done || lastPageOfSpread(nextSp) < safeLimit(cur))) return { dir, from: { layout: cur, spread }, to: { layout: cur, spread: nextSp } };
      if (!cur.done && nextSp >= spreadsOf(cur)) return null;
      const nb = layouts.get(cur.index + 1);
      if (cur.index + 1 >= book.chapterCount || !valid(nb) || !(nb.done || safeLimit(nb) > lastPageOfSpread(0))) return null;
      return { dir, from: { layout: cur, spread }, to: { layout: nb, spread: 0 } };
    }
    if (spread > 0) return { dir, from: { layout: cur, spread }, to: { layout: cur, spread: spread - 1 } };
    const pv = layouts.get(cur.index - 1);
    if (cur.index <= 0 || !valid(pv) || !pv.done) return null;
    return { dir, from: { layout: cur, spread }, to: { layout: pv, spread: spreadsOf(pv) - 1 } };
  }

  function beginTurn(plan: Plan, kind: 'flip' | 'slide' | 'fade'): Turn {
    o.onTurnStart();
    let t: Turn | null = null;
    if (kind === 'flip') {
      const p = prepared.get(plan.dir);
      if (p && p.from === plan.from.layout && p.fromSpread === plan.from.spread && p.to === plan.to.layout && p.toSpread === plan.to.spread && p.key === keyNow()) {
        t = p.turn;
        prepared.delete(plan.dir);
      }
    }
    dropPrepared();
    if (!t) {
      // Nothing ready (a quick second turn, or the first one after a resize): build it now.
      ensurePinyinSpread(plan.from.layout, plan.from.spread);
      ensurePinyinSpread(plan.to.layout, plan.to.spread);
      t = kind === 'flip' ? buildFlip(plan, makeHost()) : kind === 'fade' ? buildFade(plan) : buildSlide(plan);
    }
    turn = t;
    stage.dataset.turn = kind;
    stage.classList.add('rd-turning');
    t.start();
    return t;
  }

  function endTurn(commit: boolean): void {
    if (!turn) return;
    const t = turn;
    turn = null;
    window.cancelAnimationFrame(anim);
    stage.classList.remove('rd-turning');
    delete stage.dataset.turn;
    t.done(commit);
    // The background work waits for the page to be at rest: it would land in the frame after the turn.
    if (commit) pumpSoon();
  }

  let pumpSoonTimer = 0;
  function pumpSoon(ms = 320): void {
    window.clearTimeout(pumpSoonTimer);
    pumpSoonTimer = window.setTimeout(startPump, ms);
  }

  /** Run the turn from its current progress to 0 or 1. */
  function settleTurn(t: Turn, target: 0 | 1, velocity: number, ease: (n: number) => number): Promise<void> {
    return new Promise((resolve) => {
      const start = t.p;
      const dur = t.kind === 'fade' ? 180 : settleDuration(target - start, velocity);
      if (dur === 0) { t.set(target); endTurn(target === 1); resolve(); return; }
      const t0 = performance.now();
      const step = (now: number) => {
        if (turn !== t) { resolve(); return; }
        const k = clamp((now - t0) / dur, 0, 1);
        t.set(start + (target - start) * ease(k));
        if (k < 1) anim = requestAnimationFrame(step);
        else { endTurn(target === 1); resolve(); }
      };
      anim = requestAnimationFrame(step);
    });
  }

  /** What a tap or a key does to a page: turn it like a leaf, slide it, fade it (reduced motion) or just change it. */
  function kindNow(): 'flip' | 'slide' | 'fade' | 'none' {
    const k = settings().pageTurn;
    if (k === 'none') return 'none';
    return reduced() ? 'fade' : k;
  }

  /** A turn asked for this soon after the last one (a held key, quick taps or clicks) changes the page at once. */
  const RAPID_TURN_MS = 350;
  let lastGoAt = -Infinity;

  /** Go one spread forward or back: animated for taps and keys, instant when turns come quickly one after another. */
  function go(dir: 1 | -1): void {
    if (!cur || disposed) return;
    const now = performance.now();
    // Building a turn's pictures takes a while; animating every quick turn queued them up behind the reader and the
    // pages seemed to refuse to turn. The first turn animates; the ones that follow it closely just change the page.
    const rapid = !!turn || now - lastGoAt < RAPID_TURN_MS;
    lastGoAt = now;
    if (turn) endTurn(true);
    const plan = planTurn(dir);
    if (!plan) {
      // The neighbor chapter may still be setting its pages: get it ready, then try again.
      const idx = cur.index + dir;
      if (idx >= 0 && idx < book.chapterCount) {
        const have = layouts.get(idx);
        if (!(valid(have) && (dir === 1 ? have.done || safeLimit(have) > lastPageOfSpread(0) : have.done))) {
          void prepareNeighbor(idx, dir).then((ok) => { if (ok && !disposed) go(dir); });
        }
      } else if (dir === 1) o.onEnd();
      else nudge();
      return;
    }
    const kind = rapid ? 'none' : kindNow();
    if (kind === 'none') {
      o.onTurnStart();
      setCurrent(plan.to.layout, plan.to.spread, plan.to.layout !== plan.from.layout);
      pumpSoon();
      return;
    }
    const t = beginTurn(plan, kind);
    void settleTurn(t, 1, 0, easeInOut);
  }

  /** Load and paginate a neighbor chapter far enough for a turn, showing the busy overlay if it takes a while. */
  async function prepareNeighbor(idx: number, dir: 1 | -1): Promise<boolean> {
    const seq = openSeq;
    const showTimer = window.setTimeout(() => { if (seq === openSeq) busy.hidden = false; }, 120);
    try {
      const l = await loadLayout(idx);
      if (disposed || seq !== openSeq) return false;
      if (!l) throw new Error('The chapter is not in the library.');
      if (!valid(l)) resetMeasure(l);
      const ok = await advanceUntil(l, dir === 1 ? pageFinal(lastPageOfSpread(0)) : (x) => x.done, () => !disposed && seq === openSeq && layouts.get(idx) === l);
      return ok;
    } catch (e) {
      console.error('neighbor chapter', e);
      if (!disposed && seq === openSeq) o.onChapterError?.(idx, e);
      return false;
    } finally {
      window.clearTimeout(showTimer);
      if (seq === openSeq && !measuring) busy.hidden = true;
      if (measuring) setMeasuring(false);
    }
  }

  /** A short rubber-band at the first page of the book. */
  function nudge(): void {
    if (!cur) return;
    const el = cur.view.el;
    if (typeof el.animate !== 'function' || reduced()) return;
    const x = -spread * geom.width;
    el.animate([{ transform: `translate3d(${x}px,0,0)` }, { transform: `translate3d(${x + 18}px,0,0)` }, { transform: `translate3d(${x}px,0,0)` }],
      { duration: 260, easing: 'ease-out' });
  }

  // ------------------------------------------------------------- opening
  async function open(index: number, at: OpenAt = 'start'): Promise<void> {
    const seq = ++openSeq;
    ++relayoutSeq;
    pendingBefore = null;
    cancelPump();
    if (turn) endTurn(true);
    invalidateFaces();
    computeAll();
    const alive = () => !disposed && seq === openSeq;
    const showTimer = window.setTimeout(() => { if (alive()) busy.hidden = false; }, 140);
    try {
      dropNeighborsExcept(index);
      const l = await loadLayout(index);
      if (!alive()) return;
      if (!l) throw new Error('The chapter is not in the library.');
      if (!valid(l)) resetMeasure(l);
      let sp = 0;
      let anchor: Anchor | null = null;
      if (at === 'end') {
        if (!(await advanceUntil(l, (x) => x.done, alive))) return;
        sp = spreadsOf(l) - 1;
      } else if (at !== 'start') {
        anchor = 'stored' in at ? { ...l.view.fromStored(at.stored, at.offset ?? 0) } : at;
        if (!(await advanceUntil(l, anchorMeasured(anchor), alive))) return;
        // The page that holds the place has to be final before it is shown.
        let page = pageOfAnchor(l, anchor);
        if (!(await advanceUntil(l, pageFinal(page + 1), alive))) return;
        page = pageOfAnchor(l, anchor);
        sp = spreadOfPage(page, geom.per);
      } else if (!(await advanceUntil(l, pageFinal(2 * geom.per), alive))) return;
      setMeasuring(false);
      setCurrent(l, sp, true);
      startPump();
    } finally {
      window.clearTimeout(showTimer);
      if (seq === openSeq) { busy.hidden = true; if (measuring) setMeasuring(false); }
    }
  }

  function dropNeighborsExcept(index: number): void {
    for (const [i, l] of layouts) if (Math.abs(i - index) > 1) discard(i, l);
  }

  // --------------------------------------------------------------- resize
  function currentAnchor(): Anchor | null {
    // While the chapter is being set again nothing is measured; the place the reader is at is the one being kept.
    if (cur && !cur.cols.length) return intent ?? pendingBefore;
    if (!cur) return null;
    return anchorAtPage(cur, firstPageOfSpread(spread, geom.per));
  }

  function shownRange(): { start: Anchor; end: Anchor | null } | null {
    if (!cur || !cur.cols.length || frozen || turn) return null;
    const start = anchorAtPage(cur, firstPageOfSpread(spread, geom.per));
    const next = lastPageOfSpread(spread) + 1;
    // Past the blocks measured so far: the rest of the chapter is still hidden, so the pages end where they do.
    if (next > cur.cols[cur.cols.length - 1].last) return { start, end: cur.done ? null : { block: cur.cols.length, offset: 0 } };
    return { start, end: anchorAtPage(cur, next) };
  }

  function freeze(): void {
    if (!cur || disposed) return;
    if (turn) endTurn(true);
    if (!frozen) {
      intent = intent ?? currentAnchor();
      frozen = true;
    }
    cancelPump();
    invalidateFaces();
    resetMeasure(cur);
    // The old picture would only be wrong; the busy overlay waits until it is clear this takes a while.
    measuring = true;
    stage.classList.add('rd-measuring');
  }

  async function relayoutNow(force: boolean): Promise<void> {
    if (!cur || disposed) return;
    if (turn) endTurn(true);
    const before = intent ?? pendingBefore ?? currentAnchor();
    const prevKey = keyNow();
    computeAll();
    if (!force && !frozen && prevKey === keyNow() && cur.key === keyNow()) { showLive(cur, spread); scheduleFaces(); return; }
    frozen = false;
    pendingBefore = before;
    // Everything measured for the old geometry is stale; the neighbors are rebuilt in idle time.
    const seq = ++relayoutSeq;
    cancelPump();
    invalidateFaces();
    dropNeighbors();
    const l = cur;
    for (const e of layouts.values()) styleLayout(e);
    l.view.el.classList.add('rd-live');
    resetMeasure(l);
    const alive = () => !disposed && seq === relayoutSeq && cur === l;
    const showTimer = window.setTimeout(() => { if (alive() && !measuring) setMeasuring(true); }, 100);
    try {
      let sp = 0;
      if (before) {
        if (!(await advanceUntil(l, anchorMeasured(before), alive))) return;
        let page = pageOfAnchor(l, before);
        if (!(await advanceUntil(l, pageFinal(page + 1), alive))) return;
        page = pageOfAnchor(l, before);
        sp = spreadOfPage(page, geom.per);
      } else if (!(await advanceUntil(l, pageFinal(2 * geom.per), alive))) return;
      setCurrent(l, sp, false, true);
      intent = before;
      startPump();
    } finally {
      window.clearTimeout(showTimer);
      if (seq === relayoutSeq) { pendingBefore = null; if (measuring) setMeasuring(false); }
    }
  }

  function relayout(): void {
    window.clearTimeout(relayoutTimer);
    relayoutTimer = window.setTimeout(() => { void relayoutNow(false); }, frozen ? 30 : 90);
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => relayout()) : null;
  ro?.observe(stage);
  const onFonts = () => {
    window.clearTimeout(relayoutTimer);
    relayoutTimer = window.setTimeout(() => { resetMeasurements(); void relayoutNow(true); }, 120);
  };
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  fonts?.addEventListener?.('loadingdone', onFonts);
  const onOrientation = () => relayout();
  window.addEventListener('orientationchange', onOrientation);

  // The stage must never scroll on its own (focus, find-in-page, selection drag near an edge).
  const resetScroll = () => { if (stage.scrollLeft || stage.scrollTop) { stage.scrollLeft = 0; stage.scrollTop = 0; } };
  stage.addEventListener('scroll', resetScroll);
  stash.addEventListener('scroll', () => { stash.scrollLeft = 0; stash.scrollTop = 0; });

  // -------------------------------------------------------------- gestures
  type Drag = { id: number; x0: number; y0: number; t0: number; samples: { x: number; t: number }[]; state: 'pending' | 'drag' | 'ignore'; turn: Turn | null; dir: 1 | -1 };
  let drag: Drag | null = null;

  // A swipe turns the page from anywhere on the reader screen: the text, the words, the running head, the chapter
  // end. Only real controls and the overlays that scroll on their own (popups, menus, the chapter drawer) keep it.
  const interactive = (t: EventTarget | null) => t instanceof Element && !!t.closest(
    'button, a, input, select, textarea, label, [role="slider"], [role="dialog"], [role="menu"], dialog, .pp-pop, .rd-toc, .rd-pop, .rd-menu');
  const area = o.root;
  /** True when the point is on or right next to the current text selection (the user is adjusting it). */
  const nearSelection = (x: number, y: number) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    return Array.from(sel.getRangeAt(0).getClientRects()).some((r) => x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 24 && y <= r.bottom + 24);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || !e.isPrimary || interactive(e.target)) return;
    // A selection only blocks the swipe when the finger starts on it; elsewhere the turn clears it.
    if (o.isBusy() && nearSelection(e.clientX, e.clientY)) { drag = null; return; }
    if (turn) endTurn(true);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, samples: [{ x: e.clientX, t: e.timeStamp }], state: 'pending', turn: null, dir: 1 };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag;
    if (!d || e.pointerId !== d.id || d.state === 'ignore') return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    d.samples.push({ x: e.clientX, t: e.timeStamp });
    if (d.samples.length > 8) d.samples.shift();
    if (d.state === 'pending') {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { d.state = 'ignore'; return; }
      // Mostly sideways is enough: anything closer to horizontal than to vertical turns the page.
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      d.dir = dx < 0 ? 1 : -1;
      const kind = kindNow();
      // A fade has nothing to follow the finger with: the swipe just changes the page when it ends.
      if (kind === 'none' || kind === 'fade') { d.state = 'drag'; return; }
      const plan = planTurn(d.dir);
      if (!plan) {
        if (d.dir === -1 && cur && cur.index === 0 && spread === 0) { d.state = 'ignore'; return; }
        d.state = 'ignore';
        const idx = (cur?.index ?? 0) + d.dir;
        if (idx >= 0 && idx < book.chapterCount) void prepareNeighbor(idx, d.dir);
        return;
      }
      d.turn = beginTurn(plan, kind);
      d.state = 'drag';
      try { area.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
    }
    if (d.state === 'drag' && d.turn) {
      const toward = d.dir === 1 ? -dx : dx;
      d.turn.set(clamp(toward / (geom.paperW * 1.1), 0, 1));
    }
  };

  const onPointerEnd = (e: PointerEvent) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    if (d.state !== 'drag') return;
    suppressClickUntil = performance.now() + 400;
    const toward = (x: number) => (d.dir === 1 ? -x : x);
    const dx = toward(e.clientX - d.x0);
    // Velocity in turns per ms over the last few samples.
    const last = d.samples[d.samples.length - 1];
    const ref = d.samples.find((s) => last.t - s.t <= 90) ?? d.samples[0];
    const vx = last.t > ref.t ? toward(last.x - ref.x) / (last.t - ref.t) : 0;
    const v = vx / (geom.paperW * 1.1);
    const p = clamp(dx / (geom.paperW * 1.1), 0, 1);
    if (!d.turn) {
      // Turning is off: a swipe still changes the page.
      if (e.type !== 'pointercancel' && (dx > geom.paperW * 0.2 || v > 0.0016)) go(d.dir);
      return;
    }
    const commit = e.type !== 'pointercancel' && swipeCompletes(p, v);
    void settleTurn(d.turn, commit ? 1 : 0, Math.abs(v), easeOut);
  };

  area.addEventListener('pointerdown', onPointerDown);
  area.addEventListener('pointermove', onPointerMove);
  area.addEventListener('pointerup', onPointerEnd);
  area.addEventListener('pointercancel', onPointerEnd);
  // A swipe that ends over a word must not look the word up.
  const onSwipeClick = (e: MouseEvent) => {
    if (performance.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); }
  };
  area.addEventListener('click', onSwipeClick, true);

  // Horizontal trackpad scroll: one turn per swipe. A trackpad keeps sending ever smaller deltas while a swipe coasts, so after
  // a turn the rest of that swipe is ignored. A delta that jumps up again, or goes the other way, is a new swipe and may turn
  // at once (waiting for the coasting to stop swallowed quick second swipes).
  let wheelAcc = 0;
  let wheelLock = false;
  let wheelTimer = 0;
  let wheelLast = 0;
  let wheelDir = 0;
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || interactive(e.target)) return;
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const delta = horizontal ? e.deltaX : e.deltaY;
    e.preventDefault();
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => { wheelAcc = 0; wheelLock = false; wheelLast = 0; }, 160);
    const mag = Math.abs(delta);
    if (wheelLock && mag > 0 && (Math.sign(delta) !== wheelDir || (mag > 6 && mag > wheelLast * 2))) {
      wheelLock = false;
      wheelAcc = 0;
    }
    if (mag > 0) wheelLast = mag;
    if (wheelLock) return;
    wheelAcc += delta;
    if (Math.abs(wheelAcc) >= (horizontal ? 40 : 70)) {
      wheelDir = Math.sign(wheelAcc);
      go(wheelAcc > 0 ? 1 : -1);
      wheelAcc = 0;
      wheelLock = true;
    }
  };
  area.addEventListener('wheel', onWheel, { passive: false });

  // ------------------------------------------------------------------ API
  function percent(): number {
    if (!cur) return 0;
    const start = book.chapterOffsets[cur.index] ?? 0;
    const end = book.chapterOffsets[cur.index + 1] ?? book.charCount;
    const frac = chapterFraction(firstPageOfSpread(spread, geom.per) + geom.per - 1, cur.pages);
    return book.charCount > 0 ? clamp((start + (end - start) * frac) / book.charCount, 0, 1) : 0;
  }

  const api: Pager = {
    stage,
    open,
    next: () => go(1),
    prev: () => go(-1),
    chapter(dir) {
      if (!cur) return;
      const idx = cur.index + dir;
      if (idx < 0 || idx >= book.chapterCount) return;
      o.onTurnStart();
      void open(idx, 'start');
    },
    relayout,
    freeze,
    refresh() {
      window.clearTimeout(relayoutTimer);
      void relayoutNow(true);
    },
    invalidate() {
      invalidateFaces();
      scheduleFaces();
    },
    dropNeighbors() {
      cancelPump();
      dropNeighbors();
      invalidateFaces();
    },
    holdNeighbors(on) {
      neighborsHeld = on;
      if (!on) startPump();
    },
    view: () => cur?.view ?? null,
    chapterIndex: () => cur?.index ?? 0,
    anchor: currentAnchor,
    shownRange,
    percent,
    reveal(block, offset) {
      if (!cur) return;
      if (turn) endTurn(true);
      const a: Anchor = { block, offset };
      advanceNow(cur, anchorMeasured(a));
      let page = pageOfAnchor(cur, a);
      advanceNow(cur, pageFinal(page + 1));
      page = pageOfAnchor(cur, a);
      const sp = spreadOfPage(page, geom.per);
      if (sp !== spread) { o.onTurnStart(); setCurrent(cur, sp, false); }
    },
    zoneAt(x) {
      return tapZone(x - stage.getBoundingClientRect().left, geom.width, geom.per);
    },
    tapAt(x) {
      const zone = api.zoneAt(x);
      if (zone === 'prev') go(-1);
      else if (zone === 'next') go(1);
      return zone;
    },
    info() {
      return {
        page: firstPageOfSpread(spread, geom.per),
        pages: cur?.pages ?? 1,
        spread,
        spreads: cur ? spreadsOf(cur) : 1,
        per: geom.per,
        exact: cur?.done ?? false,
      };
    },
    settle() {
      if (!cur) return;
      ensurePinyinSpread(cur, spread);
      for (let i = 0; i < 4 && ensureNearPinyin(); i++);
    },
    dispose() {
      disposed = true;
      openSeq++;
      relayoutSeq++;
      pumpSeq++;
      window.clearTimeout(relayoutTimer);
      window.clearTimeout(faceTimer);
      window.clearTimeout(reapTimer);
      window.clearTimeout(pumpSoonTimer);
      window.clearTimeout(wheelTimer);
      window.cancelAnimationFrame(anim);
      ro?.disconnect();
      fonts?.removeEventListener?.('loadingdone', onFonts);
      window.removeEventListener('orientationchange', onOrientation);
      // The gestures listen on the reader screen, which outlives the pager (switching to Scroll keeps it).
      area.removeEventListener('pointerdown', onPointerDown);
      area.removeEventListener('pointermove', onPointerMove);
      area.removeEventListener('pointerup', onPointerEnd);
      area.removeEventListener('pointercancel', onPointerEnd);
      area.removeEventListener('click', onSwipeClick, true);
      area.removeEventListener('wheel', onWheel);
      for (const l of layouts.values()) l.view.dispose();
      layouts.clear();
      stage.remove();
    },
  };
  return api;
}
