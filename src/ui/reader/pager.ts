// The Pages layout (ARCHITECTURE.md 5.7): a chapter is laid out in CSS columns inside a fixed-height page area, one
// column per page, one or two pages on screen. This file owns the stage: geometry, pagination, page headers and
// footers, page turns (flip, slide, none), swipes, the trackpad, and the neighbor chapters laid out ahead of time.
// What a page shows is always the real chapter DOM; only the turn animation uses copies of a page's text.
import type { AppContext, BookMeta, Settings } from '../../types';
import { h } from '../dom';
import type { BlockState, ChapterView } from './chapter';
import { effectiveLineHeight, gridMetrics, measureLongest } from './grid';
import {
  blockOfPage, chapterFraction, computeGeometry, firstPageOfSpread, geometryKey, pageAtX, pageCount,
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
  /** A page is about to turn: close popups. */
  onTurnStart(): void;
  /** Is there a text selection or an open popup that a swipe must not disturb? */
  isBusy(): boolean;
  /** The reader reached the end of the book and tried to go on. */
  onEnd(): void;
}

export interface Pager {
  stage: HTMLElement;
  open(index: number, at?: OpenAt): Promise<void>;
  next(): void;
  prev(): void;
  /** Jump to the first page of the previous or next chapter. */
  chapter(dir: 1 | -1): void;
  relayout(): void;
  /** The chapter's DOM changed (script or lexicon): measure again, keeping the position. */
  refresh(): void;
  /** While held, the neighbor chapters are not laid out ahead of time (the first scan of a book is running). */
  holdNeighbors(on: boolean): void;
  /** Drop the neighbor chapters (their views are stale). */
  dropNeighbors(): void;
  view(): ChapterView | null;
  chapterIndex(): number;
  anchor(): Anchor | null;
  /** Fraction of the whole book behind the reader, 0..1. */
  percent(): number;
  /** Show the page that holds this place without animating. */
  reveal(block: number, offset: number): void;
  /** A tap at `x` (viewport px): turns the page in the outer thirds. Returns which zone it was. */
  tapAt(x: number): 'prev' | 'next' | 'middle';
  info(): { page: number; pages: number; spread: number; spreads: number; per: 1 | 2 };
  dispose(): void;
}

interface Layout {
  index: number;
  view: ChapterView;
  key: string;
  cols: BlockPages[];
  pages: number;
  ready: boolean;
}

type Plan = {
  dir: 1 | -1;
  from: { layout: Layout; spread: number };
  to: { layout: Layout; spread: number };
};

interface Turn {
  plan: Plan;
  kind: 'flip' | 'slide';
  /** 0 = nothing turned yet, 1 = fully turned. */
  set(p: number): void;
  /** End the turn: keep the new page (commit) or put the old one back. */
  done(commit: boolean): void;
  p: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export function createPager(o: PagerOptions): Pager {
  const { root, ctx, book } = o;
  const settings = (): Settings => ctx.settings.get();

  // ---------------------------------------------------------------- DOM
  const probe = h('div.rd-safe', { 'aria-hidden': 'true' });
  const spine = h('div.rd-spine', { 'aria-hidden': 'true' });
  const hf = h('div.rd-hf', { 'aria-hidden': 'true' });
  const stash = h('div.rd-pager');
  const turnLayer = h('div.rd-turn', { 'aria-hidden': 'true' });
  const busy = h('div.rd-stage-busy', { hidden: true }, h('span.app-spinner'), h('span', null, 'Setting the pages…'));
  const stage: HTMLElement = h('div.rd-stage', { 'data-rd-stage': '' }, stash, spine, hf, turnLayer, busy, probe);

  // ---------------------------------------------------------------- state
  let geom: PageGeometry = computeGeometry({ width: 1000, height: 700, spread: 'auto', pageWidth: 760 });
  let extraKey = '';
  const layouts = new Map<number, Layout>();
  let cur: Layout | null = null;
  let spread = 0;
  let turn: Turn | null = null;
  let anim = 0;
  let disposed = false;
  let openSeq = 0;
  let suppressClickUntil = 0;
  let relayoutTimer = 0;
  let neighborTimer = 0;
  let neighborsHeld = false;
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
    geom = computeGeometry({
      width: stage.clientWidth || window.innerWidth,
      height: stage.clientHeight || window.innerHeight,
      spread: s.spread,
      pageWidth: s.pageWidth,
      safeTop: safe.top,
      safeBottom: safe.bottom,
      linePitch: s.fontSize * effectiveLineHeight(s.lineHeight, s.pinyin),
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
    applyGrid(s);
  }

  /** Cell width and pinyin size for the even grid (set on the reader root; the scroll layout uses them too). */
  function applyGrid(s: Settings): void {
    const probeRt = h('rt', { style: 'position:absolute;visibility:hidden' });
    root.appendChild(probeRt);
    const family = getComputedStyle(probeRt).fontFamily || 'sans-serif';
    probeRt.remove();
    const m = gridMetrics(measureLongest(s.pinyinStyle, family), s.fontSize);
    root.style.setProperty('--rd-cell', String(m.cellEm));
    root.style.setProperty('--rd-pad', String(m.padEm));
    root.style.setProperty('--rd-rt', String(m.rtEm));
  }

  const keyNow = () => geometryKey(geom, extraKey);

  // ------------------------------------------------------------- layouts
  function styleLayout(l: Layout): void {
    const el = l.view.el;
    el.classList.add('rd-paged');
    el.classList.remove('rd-live');
    el.setAttribute('aria-hidden', 'true');
  }

  /** Measure which pages every block is on. The chapter must be fully drawn and in the document. */
  function measure(l: Layout): void {
    const el = l.view.el;
    const stride = geom.paperW;
    const base = el.getBoundingClientRect().left;
    const cols: BlockPages[] = [];
    let prevLast = 0;
    for (const b of l.view.blocks) {
      const rects = b.el.getClientRects();
      let first = prevLast;
      let last = prevLast;
      if (rects.length) {
        first = pageAtX(rects[0].left - base, stride);
        last = pageAtX(rects[rects.length - 1].left - base, stride);
      }
      // A block cannot start before the one ahead of it ends.
      first = Math.max(first, 0);
      last = Math.max(last, first);
      cols.push({ first, last });
      prevLast = Math.max(prevLast, last);
    }
    l.cols = cols;
    l.pages = pageCount(cols);
    l.key = keyNow();
    l.ready = true;
  }

  async function drawAll(view: ChapterView, sync: boolean): Promise<void> {
    if (sync) { view.renderTo(view.blocks.length - 1); return; }
    await view.renderRest();
  }

  /** Put a layout in the stage, laid out and measured. Re-measures a layout built for another geometry. */
  async function ensureLayout(index: number, sync: boolean): Promise<Layout | null> {
    let l = layouts.get(index) ?? null;
    if (l && l.ready && l.key === keyNow()) return l;
    if (!l) {
      const view = await o.makeView(index);
      if (!view || disposed) { view?.dispose(); return null; }
      const raced = layouts.get(index);
      if (raced) { view.dispose(); l = raced; } else {
        l = { index, view, key: '', cols: [], pages: 1, ready: false };
        layouts.set(index, l);
        styleLayout(l);
        stash.appendChild(view.el);
      }
    }
    const layout = l;
    await drawAll(layout.view, sync);
    if (disposed || layouts.get(index) !== layout) return null;
    if (layout.view.renderedCount() < layout.view.blocks.length) layout.view.renderTo(layout.view.blocks.length - 1);
    measure(layout);
    return layout;
  }

  function evictFar(keep: number): void {
    for (const [i, l] of layouts) {
      if (Math.abs(i - keep) > 1) { l.view.dispose(); l.view.el.remove(); layouts.delete(i); }
    }
  }

  function dropNeighbors(): void {
    window.clearTimeout(neighborTimer);
    for (const [i, l] of layouts) {
      if (l === cur) continue;
      l.view.dispose();
      l.view.el.remove();
      layouts.delete(i);
    }
  }

  function scheduleNeighbors(): void {
    window.clearTimeout(neighborTimer);
    if (!cur || neighborsHeld) return;
    const at = cur.index;
    neighborTimer = window.setTimeout(async () => {
      if (disposed || !cur || cur.index !== at || turn) return;
      evictFar(at);
      for (const i of [at + 1, at - 1]) {
        if (i < 0 || i >= book.chapterCount) continue;
        try { await ensureLayout(i, false); } catch { /* the chapter will load when it is needed */ }
        if (disposed || !cur || cur.index !== at) return;
      }
    }, 350);
  }

  // ---------------------------------------------------------- positions
  function rubyPage(l: Layout, ruby: Element): number {
    const base = l.view.el.getBoundingClientRect().left;
    return pageAtX(ruby.getBoundingClientRect().left - base, geom.paperW);
  }

  /** The place at the top of a page: its first block and, when that block began earlier, the first character on the page. */
  function anchorAtPage(l: Layout, page: number): Anchor {
    const bi = blockOfPage(l.cols, page);
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

  function pageOfAnchor(l: Layout, a: Anchor): number {
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

  // ----------------------------------------------------- headers, footers
  function pageChrome(l: Layout, page: number, side: 'left' | 'right' | 'single'): HTMLElement {
    const el = h('div.rd-pc');
    if (page >= l.pages) return el;
    const header = side === 'left' ? book.title : chapterName(l) || book.title;
    el.append(
      h('div.rd-hdr', null, h('span', null, header)),
      h('div.rd-ftr', null,
        h('span.rd-ftr-n', null, String(page + 1)),
        h('span.rd-ftr-left', null, pagesLeftLabel(page, l.pages))));
    return el;
  }

  function chapterName(l: Layout): string {
    const t = l.view.title || book.chapterTitles?.[l.index] || `Chapter ${l.index + 1}`;
    // A one-chapter book (a poem, a pasted page) would show its title twice.
    return book.chapterCount === 1 && t === book.title ? '' : t;
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
    for (const other of layouts.values()) {
      const on = other === l;
      other.view.el.classList.toggle('rd-live', on);
      other.view.el.setAttribute('aria-hidden', on ? 'false' : 'true');
      other.view.el.style.transform = on ? `translate3d(${-sp * geom.width}px,0,0)` : '';
    }
    paintChrome(l, sp);
    stage.dataset.page = String(firstPageOfSpread(sp, geom.per) + 1);
    stage.dataset.pages = String(l.pages);
    stage.dataset.spread = String(sp);
    stage.dataset.chapter = String(l.index);
    stage.dataset.block = String(anchorAtPage(l, firstPageOfSpread(sp, geom.per)).block);
  }

  function setCurrent(l: Layout, sp: number, announce: boolean, reflow = false): void {
    if (!reflow) intent = null;
    const changed = cur !== l;
    cur = l;
    spread = clamp(sp, 0, spreadsOf(l) - 1);
    showLive(l, spread);
    if (changed && announce) o.onChapter(l.index, l.view);
    o.onMove();
  }

  // ---------------------------------------------------------------- faces
  function blankFace(): HTMLElement {
    return h('div.rd-face');
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
  function buildFace(l: Layout, page: number, side: 'left' | 'right' | 'single'): HTMLElement {
    const face = h('div.rd-face');
    turnLayer.appendChild(face);
    if (page >= l.pages || page < 0) return face;
    face.appendChild(pageChrome(l, page, side));
    const text = h('div.rd-article.rd-clone');
    face.appendChild(text);
    const m = l.view.el.getBoundingClientRect();
    const base = m.left;
    const mTop = m.top;
    // Pinyin hangs above the first line of a block; leave room for it above the window.
    const head = Math.ceil(settings().fontSize * 1.2);
    for (let i = blockOfPage(l.cols, page); i < l.view.blocks.length; i++) {
      const c = l.cols[i];
      if (c.first > page) break;
      const b: BlockState = l.view.blocks[i];
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
      for (const x of Array.from(clone.querySelectorAll('[data-rd-ui]'))) x.remove();
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
    }
    return face;
  }

  // ---------------------------------------------------------------- turns
  function planTurn(dir: 1 | -1): Plan | null {
    if (!cur) return null;
    const t = turnTarget(dir, { chapter: cur.index, spread }, book.chapterCount, (c) => {
      const l = layouts.get(c);
      return l && l.ready && l.key === keyNow() ? spreadsOf(l) : null;
    });
    if (!t) return null;
    const layout = t.chapter === cur.index ? cur : layouts.get(t.chapter);
    if (!layout || !layout.ready || layout.key !== keyNow()) return null;
    const sp = t.spread === 'last' ? spreadsOf(layout) - 1 : t.spread;
    if (layout === cur && sp >= spreadsOf(cur)) return null;
    return { dir, from: { layout: cur, spread }, to: { layout, spread: sp } };
  }

  function leafLayer(): { host: HTMLElement } {
    turnLayer.textContent = '';
    // Faces are laid out (to measure them) before they are seen.
    turnLayer.hidden = false;
    turnLayer.style.visibility = 'hidden';
    return { host: turnLayer };
  }

  function makeFlip(plan: Plan): Turn {
    const { dir, from, to } = plan;
    const per = geom.per;
    const fromFirst = firstPageOfSpread(from.spread, per);
    const toFirst = firstPageOfSpread(to.spread, per);
    const { host } = leafLayer();
    const W = geom.width;
    const paper = geom.paperW;
    host.style.perspective = `${Math.round(Math.max(1800, W * 2.4))}px`;

    let staticFace: HTMLElement | null = null;
    let front: HTMLElement;
    let back: HTMLElement;
    if (per === 2) {
      if (dir === 1) {
        staticFace = buildFace(from.layout, fromFirst, 'left');
        front = buildFace(from.layout, fromFirst + 1, 'right');
        back = buildFace(to.layout, toFirst, 'left');
      } else {
        staticFace = buildFace(from.layout, fromFirst + 1, 'right');
        front = buildFace(to.layout, toFirst + 1, 'right');
        back = buildFace(from.layout, fromFirst, 'left');
      }
    } else if (dir === 1) {
      front = buildFace(from.layout, fromFirst, 'single');
      back = blankFace();
    } else {
      staticFace = buildFace(from.layout, fromFirst, 'single');
      front = buildFace(to.layout, toFirst, 'single');
      back = blankFace();
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
    host.append(...[staticFace, underSlot, sideSlot, leaf].filter((x): x is HTMLElement => !!x));
    host.hidden = false;
    host.style.visibility = '';

    // The live pages already show the destination, under the leaf and the static page.
    showLive(to.layout, to.spread);
    const t: Turn = {
      plan, kind: 'flip', p: 0,
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
        host.textContent = '';
        host.hidden = true;
        if (commit) setCurrent(to.layout, to.spread, to.layout !== from.layout);
        else showLive(from.layout, from.spread);
        t.p = commit ? 1 : 0;
      },
    };
    t.set(0);
    return t;
  }

  function makeSlide(plan: Plan): Turn {
    const { dir, from, to } = plan;
    const W = geom.width;
    const fromEl = from.layout.view.el;
    const toEl = to.layout.view.el;
    const same = from.layout === to.layout;
    const fromX = -from.spread * W;
    const toX = -to.spread * W + (same ? 0 : dir * W);
    o.onTurnStart();
    if (!same) { toEl.classList.add('rd-live'); toEl.setAttribute('aria-hidden', 'false'); }
    hf.style.opacity = '0';
    const t: Turn = {
      plan, kind: 'slide', p: 0,
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
    t.set(0);
    return t;
  }

  function beginTurn(plan: Plan, kind: 'flip' | 'slide'): Turn {
    o.onTurnStart();
    turn = kind === 'flip' ? makeFlip(plan) : makeSlide(plan);
    stage.classList.add('rd-turning');
    return turn;
  }

  function endTurn(commit: boolean): void {
    if (!turn) return;
    const t = turn;
    turn = null;
    window.cancelAnimationFrame(anim);
    stage.classList.remove('rd-turning');
    t.done(commit);
    if (commit) scheduleNeighbors();
  }

  /** Run the turn from its current progress to 0 or 1. */
  function settle(t: Turn, target: 0 | 1, velocity: number, ease: (n: number) => number): Promise<void> {
    return new Promise((resolve) => {
      const start = t.p;
      const dur = settleDuration(target - start, velocity);
      if (dur === 0 || reduced()) { t.set(target); endTurn(target === 1); resolve(); return; }
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

  function kindNow(): 'flip' | 'slide' | 'none' {
    const k = settings().pageTurn;
    return reduced() ? 'none' : k;
  }

  /** Go one spread forward or back: animated for taps and keys. */
  function go(dir: 1 | -1): void {
    if (!cur || disposed) return;
    if (turn) endTurn(true);
    const plan = planTurn(dir);
    if (!plan) {
      // The neighbor chapter may still be setting its pages: start it, then try again.
      const idx = cur.index + dir;
      const have = layouts.get(idx);
      if (idx >= 0 && idx < book.chapterCount && !(have && have.ready && have.key === keyNow())) {
        busy.hidden = false;
        void ensureLayout(idx, false).then(() => { busy.hidden = true; if (!disposed) go(dir); });
      } else if (dir === 1 && idx >= book.chapterCount) o.onEnd();
      else if (dir === -1) nudge();
      return;
    }
    const kind = kindNow();
    if (kind === 'none') {
      o.onTurnStart();
      setCurrent(plan.to.layout, plan.to.spread, plan.to.layout !== plan.from.layout);
      scheduleNeighbors();
      return;
    }
    const t = beginTurn(plan, kind);
    void settle(t, 1, 0, easeInOut);
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
    if (turn) endTurn(true);
    busy.hidden = false;
    computeAll();
    try {
      dropNeighborsExcept(index);
      const l = await ensureLayout(index, true);
      if (!l || seq !== openSeq || disposed) return;
      let sp = 0;
      if (at === 'end') sp = spreadsOf(l) - 1;
      else if (at !== 'start') {
        const a: Anchor = 'stored' in at ? { block: at.stored + l.view.synthetic, offset: at.offset ?? 0 } : at;
        sp = spreadOfPage(pageOfAnchor(l, a), geom.per);
      }
      setCurrent(l, sp, true);
      scheduleNeighbors();
    } finally {
      if (seq === openSeq) busy.hidden = true;
    }
  }

  function dropNeighborsExcept(index: number): void {
    for (const [i, l] of layouts) {
      if (Math.abs(i - index) > 1) { l.view.dispose(); l.view.el.remove(); layouts.delete(i); }
    }
  }

  // --------------------------------------------------------------- resize
  function currentAnchor(): Anchor | null {
    if (!cur) return null;
    return anchorAtPage(cur, firstPageOfSpread(spread, geom.per));
  }

  function relayoutNow(force: boolean): void {
    if (!cur || disposed) return;
    if (turn) endTurn(true);
    const before = intent ?? currentAnchor();
    const prevKey = keyNow();
    computeAll();
    if (!force && prevKey === keyNow() && cur.ready) { showLive(cur, spread); return; }
    // Everything measured for the old geometry is stale; the neighbors are rebuilt in idle time.
    dropNeighbors();
    const l = cur;
    for (const e of layouts.values()) styleLayout(e);
    l.view.el.classList.add('rd-live');
    measure(l);
    const sp = before ? spreadOfPage(pageOfAnchor(l, before), geom.per) : 0;
    setCurrent(l, sp, false, true);
    intent = before;
    scheduleNeighbors();
  }

  function relayout(): void {
    window.clearTimeout(relayoutTimer);
    relayoutTimer = window.setTimeout(() => relayoutNow(false), 90);
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => relayout()) : null;
  ro?.observe(stage);
  const onFonts = () => { window.clearTimeout(relayoutTimer); relayoutTimer = window.setTimeout(() => relayoutNow(true), 120); };
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
      if (kind === 'none') { d.state = 'drag'; return; }
      const plan = planTurn(d.dir);
      if (!plan) {
        if (d.dir === -1 && cur && cur.index === 0 && spread === 0) { d.state = 'ignore'; return; }
        d.state = 'ignore';
        const idx = (cur?.index ?? 0) + d.dir;
        if (idx >= 0 && idx < book.chapterCount) void ensureLayout(idx, false);
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
    void settle(d.turn, commit ? 1 : 0, Math.abs(v), easeOut);
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

  // Horizontal trackpad scroll: one turn per gesture.
  let wheelAcc = 0;
  let wheelLock = false;
  let wheelTimer = 0;
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || interactive(e.target)) return;
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const delta = horizontal ? e.deltaX : e.deltaY;
    e.preventDefault();
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => { wheelAcc = 0; wheelLock = false; }, 160);
    if (wheelLock) return;
    wheelAcc += delta;
    if (Math.abs(wheelAcc) >= (horizontal ? 40 : 70)) {
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

  return {
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
    refresh() {
      window.clearTimeout(relayoutTimer);
      relayoutNow(true);
    },
    dropNeighbors,
    holdNeighbors(on) {
      neighborsHeld = on;
      if (on) window.clearTimeout(neighborTimer);
      else scheduleNeighbors();
    },
    view: () => cur?.view ?? null,
    chapterIndex: () => cur?.index ?? 0,
    anchor: currentAnchor,
    percent,
    reveal(block, offset) {
      if (!cur) return;
      if (turn) endTurn(true);
      const sp = spreadOfPage(pageOfAnchor(cur, { block, offset }), geom.per);
      if (sp !== spread) { o.onTurnStart(); setCurrent(cur, sp, false); }
    },
    tapAt(x) {
      const zone = tapZone(x - stage.getBoundingClientRect().left, geom.width, geom.per);
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
      };
    },
    dispose() {
      disposed = true;
      openSeq++;
      window.clearTimeout(relayoutTimer);
      window.clearTimeout(neighborTimer);
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
}
