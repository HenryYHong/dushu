// Feeds what is on screen to the words-learned-from-reading tracker (core/autoKnown.ts) about once a second: in Pages the
// text on the spread on show, in Scroll the paragraphs in the window. Only while settings.autoKnown is on and the page is visible.
import { createAutoKnown, readingDwell, type AutoKnown, type ReadUnit, type ReadView } from '../../core/autoKnown';
import type { AppContext, Dictionary, Token } from '../../types';
import type { BlockState, ChapterView } from './chapter';
import type { Pager } from './pager';

const TICK_MS = 1000;
/** Chapter, block and offset as one increasing number (blocks are at most a few thousand characters). */
const CHAPTER = 1e9;
const BLOCK = 1e5;

export interface LearningHost {
  ctx: AppContext;
  dict: Dictionary;
  view(): ChapterView | null;
  chapterIndex(): number;
  /** The pager in the Pages layout, null in Scroll. */
  pager(): Pager | null;
  /** The height of the bar over the text in Scroll (text under it is not in view). */
  topInset: number;
}

export interface Learning {
  /** A word card opened on this text. `deliberate` false for a hover popup. */
  lookedUp(word: string, deliberate: boolean): void;
  /** A phrase popup opened on this text (its words were read with a translation). */
  helped(spans: { b: BlockState; start: number; end: number }[]): void;
  restart(): void;
  /** One tick now (tests). */
  tick(): void;
  tracker: AutoKnown;
  dispose(): void;
}

const hanChars = (t: Token) => [...t.text].length;

function unitOf(ch: number, b: BlockState, from: number, toks: Token[], needMs: number): ReadUnit {
  return {
    key: `${ch}:${b.index}:${from}`,
    needMs,
    words: () => toks.map((t) => ({ id: `${ch}:${b.index}:${t.start}`, word: t.text })),
  };
}

const hanIn = (b: BlockState, from: number, to: number): Token[] =>
  b.kind === 'text' && b.rendered ? b.rendered.tokens.filter((t) => t.kind === 'han' && t.start >= from && t.start < to) : [];

/** Pages: the part of every block on the spread on show; the whole spread has to stay up long enough to be read. */
export function pagesView(v: ChapterView, ch: number, range: { start: { block: number; offset: number }; end: { block: number; offset: number } | null }): ReadView {
  const last = range.end ? Math.min(range.end.block, v.blocks.length - 1) : v.blocks.length - 1;
  const parts: { b: BlockState; from: number; toks: Token[] }[] = [];
  let chars = 0;
  for (let bi = range.start.block; bi <= last; bi++) {
    const b = v.blocks[bi];
    if (!b) continue;
    const from = bi === range.start.block ? range.start.offset : 0;
    const to = range.end && bi === range.end.block ? range.end.offset : b.text.length;
    if (to <= from) continue;
    const toks = hanIn(b, from, to);
    if (!toks.length) continue;
    for (const t of toks) chars += hanChars(t);
    parts.push({ b, from, toks });
  }
  const needMs = readingDwell(chars);
  return {
    top: ch * CHAPTER + range.start.block * BLOCK + range.start.offset,
    units: parts.map((p) => unitOf(ch, p.b, p.from, p.toks, needMs)),
  };
}

/** Scroll: every paragraph in the window; each has to stay in view long enough to read it. */
export function scrollView(v: ChapterView, ch: number, topInset: number, height = window.innerHeight): ReadView | null {
  const blocks = v.blocks;
  if (!blocks.length) return null;
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].el.getBoundingClientRect().bottom > topInset) hi = mid;
    else lo = mid + 1;
  }
  const units: ReadUnit[] = [];
  for (let bi = lo; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const r = b.el.getBoundingClientRect();
    if (r.top >= height) break;
    if (r.bottom <= topInset) continue;
    const toks = hanIn(b, 0, b.text.length);
    if (!toks.length) continue;
    units.push(unitOf(ch, b, 0, toks, readingDwell(toks.reduce((n, t) => n + hanChars(t), 0))));
  }
  // The document's scroll position stands in for the place: it grows as the reader reads down. A third of a screen back is allowed.
  return { top: ch * CHAPTER + Math.round(window.scrollY), slack: height / 3, units };
}

export function createLearning(host: LearningHost): Learning {
  const { ctx, dict } = host;
  const tracker = createAutoKnown({
    store: ctx.store,
    enabled: () => ctx.settings.get().autoKnown,
    simplify: (w) => dict.toSimplified(w),
  });

  function current(): ReadView | null {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return null;
    const v = host.view();
    if (!v) return null;
    const ch = host.chapterIndex();
    const pager = host.pager();
    if (pager) {
      const range = pager.shownRange();
      return range ? pagesView(v, ch, range) : null;
    }
    return scrollView(v, ch, host.topInset);
  }

  const tick = () => {
    if (!ctx.settings.get().autoKnown) { tracker.tick(null); return; }
    try { tracker.tick(current()); } catch (e) { console.warn('Dushu: could not read what is on screen', e); }
  };
  const timer = window.setInterval(tick, TICK_MS);

  return {
    lookedUp: (word, deliberate) => tracker.lookedUp(word, deliberate),
    helped(spans) {
      const words: string[] = [];
      for (const sp of spans) for (const t of hanIn(sp.b, sp.start, sp.end)) words.push(t.text);
      tracker.helped(words);
    },
    restart: () => tracker.restart(),
    tick,
    tracker,
    dispose: () => window.clearInterval(timer),
  };
}
