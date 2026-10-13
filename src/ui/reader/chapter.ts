// One chapter on screen: a shell element per block, rendered in batches, with live updates for pinyin,
// saved/known words and highlights. Segmentation happens once per block; settings changes touch existing nodes.
import { buildLexicon } from '../../core/lexicon';
import type { AppContext, Block, Chapter, Dictionary, Lexicon, Settings, Token } from '../../types';
import { segment } from '../../core/segment';
import { h } from '../dom';
import { icon } from '../icons';
import { createTranslationPanel, type TranslationPanel } from '../popup/translation';
import {
  displayTokens, pinyinVisible, refreshPinyin, refreshVisibility, renderTokens,
  type RenderedParagraph, type RenderOptions,
} from './render';

export interface BlockState {
  index: number;
  kind: 'text' | 'img' | 'hr';
  block: Block;
  el: HTMLElement;
  /** Text as displayed (after script conversion). Empty for images and rules. */
  text: string;
  rendered: RenderedParagraph | null;
  trans: { el: HTMLElement; panel: TranslationPanel } | null;
  transBtn: HTMLButtonElement | null;
}

export interface ChapterViewOptions {
  ctx: AppContext;
  dict: Dictionary;
  bookId: string;
  chapter: Chapter;
  chapterIndex: number;
  /** Names and terms of the book; they join segmentation. Replace later with `setLexicon`. */
  lexicon?: Lexicon;
  /** Called when something inside the chapter changed its height (a paragraph translation opened or grew). */
  onResize?: () => void;
}

export interface ChapterView {
  el: HTMLElement;
  blocks: BlockState[];
  /** Blocks added in front of the stored ones (the chapter title), for progress bookkeeping. */
  synthetic: number;
  /** The chapter's title as stored. */
  title: string;
  /** Render blocks 0..index now. */
  renderTo(index: number): void;
  /** Render just this block now (it may be below unrendered ones). */
  ensure(index: number): void;
  /** Render the rest of the chapter in idle time; resolves when every block is drawn. */
  renderRest(): Promise<void>;
  /** Text blocks as elements, in order (for selection mapping). */
  textElements(): HTMLElement[];
  blockOfNode(n: Node | null): BlockState | null;
  /** Index of the han token containing `offset`, or -1. */
  tokenIndexAt(b: BlockState, offset: number): number;
  mark(b: BlockState, start: number, end: number, cls: string): void;
  clearMarks(cls?: string): void;
  rectOf(b: BlockState, start: number, end: number): DOMRect | null;
  refreshPinyin(): void;
  refreshVisibility(): void;
  refreshMarks(): void;
  /** Re-segment everything (script conversion changed), keeping the DOM shells. */
  reconvert(): void;
  /** Use a new lexicon: every rendered block is segmented and drawn again (the blocks that were drawn stay drawn). */
  setLexicon(lex: Lexicon | undefined): void;
  /** Number of blocks drawn so far. */
  renderedCount(): number;
  dispose(): void;
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

function schedule(fn: () => void): void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 250 });
  else setTimeout(fn, 16);
}

export function createChapterView(o: ChapterViewOptions): ChapterView {
  const { ctx, dict, chapter } = o;
  let lexicon = o.lexicon;
  const store = ctx.store;
  const settings = (): Settings => ctx.settings.get();
  const article = h('article.rd-article');
  article.setAttribute('lang', 'zh');
  let disposed = false;

  // The title is shown as a heading unless the first block already says it.
  const first = chapter.blocks[0];
  const sourceBlocks: Block[] = [...chapter.blocks];
  let synthetic = 0;
  const title = chapter.title?.trim();
  const firstText = first && (first.t === 'h' || first.t === 'p') ? first.text.trim() : '';
  if (title && !(first && first.t === 'h' && (firstText === title || firstText.includes(title) || title.includes(firstText)))) {
    sourceBlocks.unshift({ t: 'h', level: 1, text: title });
    synthetic = 1;
  }

  // ---- visibility rule, memoized per word until known/saved words change
  const knownMemo = new Map<string, boolean>();
  const rule = () => {
    const s = settings();
    return {
      mode: s.pinyin,
      hskThreshold: s.hskThreshold,
      isKnown: (w: string) => {
        let v = knownMemo.get(w);
        if (v === undefined) { v = store.known.has(w); knownMemo.set(w, v); }
        return v;
      },
      hskLevel: (w: string) => dict.hsk(w)?.hsk3,
    };
  };
  const visible = (t: Token) => pinyinVisible(t.text, rule());
  const renderOptions = (): RenderOptions => {
    const s = settings();
    return { style: s.pinyinStyle, toneColors: s.toneColors, sandhi: s.sandhi, visible };
  };

  // Names and terms are stored as the book spells them; when the reader converts the script they convert too.
  let lexMemo: { lex: Lexicon | undefined; mode: string; out: Lexicon | undefined } | null = null;
  function shownLexicon(): Lexicon | undefined {
    const mode = settings().script;
    if (!lexicon || mode === 'original') return lexicon;
    if (lexMemo && lexMemo.lex === lexicon && lexMemo.mode === mode) return lexMemo.out;
    const conv = mode === 'simplified' ? dict.toSimplified : dict.toTraditional;
    const out = buildLexicon(lexicon.entries().map((e) => ({ ...e, word: conv.call(dict, e.word) })).filter((e) => [...e.word].length === [...e.pinyin.split(' ')].length || !e.pinyin));
    lexMemo = { lex: lexicon, mode, out };
    return out;
  }

  const convert = (text: string): string => {
    const mode = settings().script;
    if (mode === 'simplified') return dict.toSimplified(text);
    if (mode === 'traditional') return dict.toTraditional(text);
    return text;
  };

  // ---- shells
  const blocks: BlockState[] = sourceBlocks.map((block, index) => {
    let el: HTMLElement;
    let kind: BlockState['kind'] = 'text';
    let text = '';
    switch (block.t) {
      case 'p':
        el = h('p.rd-b.rd-p', { 'data-b': index });
        text = block.text;
        break;
      case 'h':
        el = h(`${HEADING_TAGS[block.level - 1] ?? 'h3'}.rd-b.rd-h.rd-h${block.level}`, { 'data-b': index });
        text = block.text;
        break;
      case 'quote':
        el = h('blockquote.rd-b.rd-quote', { 'data-b': index });
        text = block.text;
        break;
      case 'img': {
        kind = 'img';
        const img = h('img.rd-img', { alt: block.alt ?? '', loading: 'lazy' }) as HTMLImageElement;
        el = h('figure.rd-b.rd-fig', { 'data-b': index }, img);
        void store.books.assetUrl(o.bookId, block.asset).then((url) => {
          if (disposed) return;
          if (url) img.src = url;
          else { img.remove(); el.appendChild(h('span.rd-img-missing', null, block.alt || 'Image not available')); }
        });
        break;
      }
      default:
        kind = 'hr';
        el = h('hr.rd-b.rd-hr', { 'data-b': index });
    }
    if (kind === 'text' && /^[　 ]/.test(text)) el.classList.add('rd-noindent');
    if (kind === 'text' && !/[\p{Script=Han}]/u.test(text)) el.classList.add('rd-plain');
    article.appendChild(el);
    return { index, kind, block, el, text, rendered: null, trans: null, transBtn: null };
  });
  const sourceText = blocks.map((b) => b.text);
  blocks.forEach((b) => { if (b.kind === 'text') b.text = convert(b.text); });

  // ---- rendering
  let marked: { el: HTMLElement; cls: string }[] = [];

  function renderBlock(b: BlockState): void {
    if (b.rendered || b.kind !== 'text') return;
    const tokens = segment(b.text, dict, shownLexicon());
    const opts = renderOptions();
    const shown = displayTokens(tokens, opts.sandhi);
    const { nodes, views } = renderTokens(tokens, shown, opts);
    b.el.appendChild(nodes);
    b.rendered = { el: b.el, text: b.text, tokens, shown, views };
    markSaved(b);
    if (/[\p{Script=Han}]/u.test(b.text) && b.block.t !== 'h') addTranslateButton(b);
  }

  function markSaved(b: BlockState): void {
    if (!b.rendered) return;
    for (const v of b.rendered.views) {
      v.el.classList.toggle('rd-saved', store.vocab.has(v.token.text));
      v.el.classList.toggle('rd-known', store.known.has(v.token.text));
    }
  }

  function addTranslateButton(b: BlockState): void {
    const btn = h('button.rd-pt-btn', {
      'data-rd-ui': '',
      type: 'button',
      title: 'Translate paragraph',
      'aria-label': 'Translate paragraph',
      'aria-pressed': 'false',
      onclick: (e: Event) => { e.stopPropagation(); toggleTranslation(b); },
    }, icon('translate')) as HTMLButtonElement;
    b.transBtn = btn;
    b.el.appendChild(btn);
  }

  function toggleTranslation(b: BlockState): void {
    if (b.trans) {
      b.trans.panel.destroy();
      b.trans.el.remove();
      b.trans = null;
      b.transBtn?.setAttribute('aria-pressed', 'false');
      o.onResize?.();
      return;
    }
    const panel = createTranslationPanel({ ctx, text: b.text, context: b.text, lexicon });
    const wrap = h('div.rd-trans', { 'data-rd-ui': '' }, panel.el);
    b.el.after(wrap);
    b.trans = { el: wrap, panel };
    b.transBtn?.setAttribute('aria-pressed', 'true');
    o.onResize?.();
  }

  function renderTo(index: number): void {
    for (let i = 0; i <= index && i < blocks.length; i++) renderBlock(blocks[i]);
  }

  let restToken = 0;
  function renderRest(): Promise<void> {
    const mine = ++restToken;
    return new Promise((resolve) => {
      let next = 0;
      const slice = () => {
        if (disposed || mine !== restToken) { resolve(); return; }
        const t0 = performance.now();
        while (next < blocks.length && performance.now() - t0 < 8) renderBlock(blocks[next++]);
        if (next < blocks.length) schedule(slice);
        else resolve();
      };
      schedule(slice);
    });
  }

  // ---- queries
  const textElements = () => blocks.filter((b) => b.kind === 'text').map((b) => b.el);

  function blockOfNode(n: Node | null): BlockState | null {
    const el = n && (n.nodeType === 1 ? (n as Element) : n.parentElement);
    const host = el?.closest('[data-b]') as HTMLElement | null;
    if (!host || !article.contains(host)) return null;
    return blocks[Number(host.dataset.b)] ?? null;
  }

  function tokenIndexAt(b: BlockState, offset: number): number {
    const toks = b.rendered?.tokens;
    if (!toks) return -1;
    let lo = 0;
    let hi = toks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = toks[mid];
      if (offset < t.start) hi = mid - 1;
      else if (offset >= t.end) lo = mid + 1;
      else return t.kind === 'han' ? mid : -1;
    }
    return -1;
  }

  function mark(b: BlockState, start: number, end: number, cls: string): void {
    const rubies = b.el.querySelectorAll<HTMLElement>('ruby.rd-c');
    for (const r of rubies) {
      const off = Number(r.dataset.o);
      if (off >= start && off < end) { r.classList.add(cls); marked.push({ el: r, cls }); }
    }
  }

  function clearMarks(cls?: string): void {
    const keep: typeof marked = [];
    for (const m of marked) {
      if (!cls || m.cls === cls) m.el.classList.remove(m.cls);
      else keep.push(m);
    }
    marked = keep;
  }

  function rectOf(b: BlockState, start: number, end: number): DOMRect | null {
    let l = Infinity, t = Infinity, r = -Infinity, bt = -Infinity;
    for (const ruby of b.el.querySelectorAll<HTMLElement>('ruby.rd-c')) {
      const off = Number(ruby.dataset.o);
      if (off < start || off >= end) continue;
      const q = ruby.getBoundingClientRect();
      if (!q.width && !q.height) continue;
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); bt = Math.max(bt, q.bottom);
    }
    if (!Number.isFinite(l)) return null;
    return new DOMRect(l, t, r - l, bt - t);
  }

  function eachRendered(fn: (p: RenderedParagraph, b: BlockState) => void): void {
    for (const b of blocks) if (b.rendered) fn(b.rendered, b);
  }

  function reconvert(): void {
    // Script conversion changed: drop and redraw rendered blocks in place.
    clearMarks();
    for (const b of blocks) {
      if (b.kind !== 'text') continue;
      b.text = convert(sourceText[b.index]);
      if (b.trans) { b.trans.panel.destroy(); b.trans.el.remove(); b.trans = null; }
      if (b.rendered) {
        while (b.el.firstChild) b.el.removeChild(b.el.firstChild);
        b.rendered = null;
        b.transBtn = null;
      }
    }
  }

  const view: ChapterView = {
    el: article,
    blocks,
    synthetic,
    title: chapter.title?.trim() ?? '',
    renderTo,
    ensure(index) { const b = blocks[index]; if (b) renderBlock(b); },
    renderRest,
    textElements,
    blockOfNode,
    tokenIndexAt,
    mark,
    clearMarks,
    rectOf,
    refreshPinyin() {
      const opts = renderOptions();
      eachRendered((p) => { refreshPinyin(p, opts); refreshVisibility(p, visible); });
    },
    refreshVisibility() {
      knownMemo.clear();
      eachRendered((p) => refreshVisibility(p, visible));
    },
    refreshMarks() {
      knownMemo.clear();
      for (const b of blocks) markSaved(b);
      eachRendered((p) => refreshVisibility(p, visible));
    },
    reconvert,
    setLexicon(lex) {
      lexicon = lex;
      clearMarks();
      for (const b of blocks) {
        if (b.kind !== 'text' || !b.rendered) continue;
        while (b.el.firstChild) b.el.removeChild(b.el.firstChild);
        b.rendered = null;
        b.transBtn = null;
        renderBlock(b);
      }
    },
    renderedCount: () => blocks.filter((b) => b.rendered || b.kind !== 'text').length,
    dispose() {
      disposed = true;
      restToken++;
      for (const b of blocks) b.trans?.panel.destroy();
    },
  };
  return view;
}
