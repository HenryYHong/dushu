// One chapter on screen: a shell element per block, rendered in batches, with live updates for pinyin,
// saved/known words and highlights. Segmentation happens once per block; settings changes touch existing nodes.
import { buildLexicon } from '../../core/lexicon';
import { hskLevels } from '../../core/hskLevel';
import type { AppContext, Block, Chapter, Dictionary, Lexicon, Settings, Token } from '../../types';
import { segment } from '../../core/segment';
import { h } from '../dom';
import { icon } from '../icons';
import { createTranslationPanel, type TranslationPanel } from '../popup/translation';
import { targetFor } from '../../translate/targets';
import { anchorOf } from '../popup/position';
import {
  POS_SEL, buildPinyin, displayTokens, pinyinVisible, refreshPinyin, refreshVisibility, renderTokens,
  type RenderedParagraph, type RenderOptions,
} from './render';
import { isWord } from '../../lang/token';
import { activeEngine, isChinese, lang, langId } from '../../lang/active';
import { sliceRuby } from '../../import/aozora';

export interface BlockState {
  index: number;
  kind: 'text' | 'img' | 'hr';
  block: Block;
  el: HTMLElement;
  /** Text as displayed (after script conversion). Empty for images and rules. */
  text: string;
  /** Where this block's text starts inside the stored block it came from (a very long paragraph is cut into pieces). */
  pieceStart: number;
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
  /** Called when something inside the chapter changed its height (a paragraph translation opened or grew, an image loaded). */
  onResize?: () => void;
  /**
   * Draw the pinyin of a block only when `ensurePinyin` asks (the Pages layout does so for the pages near the reader).
   * The pinyin hangs out of the flow, so the layout of the text is the same without it.
   */
  lazyPinyin?: boolean;
}

export interface ChapterView {
  el: HTMLElement;
  blocks: BlockState[];
  /** Blocks added in front of the stored ones (the chapter title), for progress bookkeeping. */
  synthetic: number;
  /** A place in this view (block number, offset in that block) as the stored chapter spells it, for saved progress. */
  toStored(block: number, offset: number): { block: number; offset: number };
  /** The place in this view for a stored block number and offset (the reverse of `toStored`). */
  fromStored(block: number, offset?: number): { block: number; offset: number };
  /** The chapter's title as stored. */
  title: string;
  /** Render blocks 0..index now. */
  renderTo(index: number): void;
  /** Render just this block now (it may be below unrendered ones). */
  ensure(index: number): void;
  /** Draw the pinyin of a rendered block that was drawn without it (a no-op otherwise). */
  ensurePinyin(index: number): void;
  /** Blocks whose text could not be segmented are shown as plain text; how many so far. */
  failedBlocks(): number;
  /** Render the rest of the chapter in idle time; resolves when every block is drawn. */
  renderRest(): Promise<void>;
  /** Text blocks as elements, in order (for selection mapping). */
  textElements(): HTMLElement[];
  blockOfNode(n: Node | null): BlockState | null;
  /** Index of the han token containing `offset`, or -1. */
  tokenIndexAt(b: BlockState, offset: number): number;
  mark(b: BlockState, start: number, end: number, cls: string): void;
  /** The same, in two steps: it measures now (before anything on the page changes) and marks when the returned function runs. */
  prepareMark(b: BlockState, start: number, end: number, cls: string): () => void;
  clearMarks(cls?: string): void;
  /** Where characters start..end are on screen, for a popup to point at (popup/position.ts anchorOf). */
  rectOf(b: BlockState, start: number, end: number): DOMRect | null;
  /** The box of each of those characters, in reading order. */
  rectsOf(b: BlockState, start: number, end: number): DOMRect[];
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

/**
 * The longest a paragraph is allowed to be as one block. A book with no paragraph breaks (a whole page of verse, a
 * pasted wall of text) would otherwise be one block of tens of thousands of characters that cannot be paginated in
 * pieces. The pieces break after a sentence end where there is one.
 */
export const MAX_BLOCK_CHARS = 3000;

/** A paragraph this short is marked rd-short (verse or a line of dialogue). It is filled like any other: only headings are balanced. */
const SHORT_PARAGRAPH = 28;

const SENTENCE_END = '。！？；\n';
/** Sentence ends in the languages written with spaces (checked after the Chinese ones). */
const SENTENCE_END_SPACED = '.!?…';
const CLAUSE_END = '，、：,;';
const CLOSERS = '”’」』）》】';

/** Cut `text` into pieces of at most about MAX_BLOCK_CHARS, after sentence ends where possible. Joined, they equal `text`. */
export function splitLongText(text: string, max = MAX_BLOCK_CHARS): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    const last = (chars: string) => Math.max(...[...chars].map((c) => win.lastIndexOf(c)));
    let cut = last(isChinese() ? SENTENCE_END : SENTENCE_END + SENTENCE_END_SPACED);
    if (cut < max * 0.4) cut = Math.max(cut, last(CLAUSE_END));
    let at = cut >= max * 0.3 ? cut + 1 : max;
    while (at < rest.length && at < max + 8 && CLOSERS.includes(rest[at])) at++;
    const prev = rest.charCodeAt(at - 1);
    if (prev >= 0xd800 && prev <= 0xdbff) at++; // never split a surrogate pair
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest) out.push(rest);
  return out;
}

interface SourcePiece { block: Block; src: number; start: number; cont: boolean; more: boolean }

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
  const L = lang();
  const engine = activeEngine();
  article.setAttribute('lang', L.tag);
  let disposed = false;

  // The title is shown as a heading unless the first block already says it.
  const first = chapter.blocks[0];
  const pieces: SourcePiece[] = [];
  chapter.blocks.forEach((block, src) => {
    if ((block.t === 'p' || block.t === 'quote') && block.text.length > MAX_BLOCK_CHARS) {
      let start = 0;
      const parts = splitLongText(block.text);
      parts.forEach((text, k) => {
        const ruby = 'ruby' in block ? sliceRuby(block.ruby, start, start + text.length) : undefined;
        pieces.push({ block: { ...block, text, ruby }, src, start, cont: k > 0, more: k < parts.length - 1 });
        start += text.length;
      });
    } else pieces.push({ block, src, start: 0, cont: false, more: false });
  });
  let synthetic = 0;
  const title = chapter.title?.trim();
  const firstText = first && (first.t === 'h' || first.t === 'p') ? first.text.trim() : '';
  if (title && !chapter.cont && !(first && first.t === 'h' && (firstText === title || firstText.includes(title) || title.includes(firstText)))) {
    pieces.unshift({ block: { t: 'h', level: 1, text: title }, src: -1, start: 0, cont: false, more: false });
    synthetic = 1;
  } else if (!chapter.cont && first?.t === 'h' && first.level !== 1) {
    // The book's own heading is the chapter title: it looks like every other chapter title, whatever level the file gave it.
    pieces[0] = { ...pieces[0], block: { ...first, level: 1 } };
  }
  const sourceBlocks: Block[] = pieces.map((x) => x.block);

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
      hskLevel: hskLevels(dict),
    };
  };
  // A word of another language is known and leveled by its dictionary form (Token.key); a name never gets an English hint.
  const levelOf = engine ? (key: string) => engine.level(key) : null;
  const visible = (t: Token) => {
    if (t.kind !== 'word' || !levelOf) return pinyinVisible(t.text, rule(), t.pinyin);
    if (t.name && L.aid === 'hint') return false;
    return pinyinVisible(t.key || t.text, { ...rule(), hskLevel: levelOf });
  };
  const renderOptions = (): RenderOptions => {
    const s = settings();
    const base: RenderOptions = { style: s.pinyinStyle, toneColors: s.toneColors, sandhi: s.sandhi, visible, words: true };
    if (!engine) return base;
    return { ...base, sandhi: false, aid: L.aid === 'furigana' ? 'furigana' : 'hint', hint: (t) => engine.hint(t), stress: !!L.stress && s.stress };
  };
  const lazy = !!o.lazyPinyin;
  let failed = 0;

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
    const piece = pieces[index];
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
        // A section number alone (一, 二 … in 狂人日记) is set in the middle, as printed editions do.
        if (/^[一二三四五六七八九十百〇零\d]{1,4}$/.test(block.text.trim())) el.classList.add('rd-h-num');
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
          if (url) {
            img.addEventListener('load', () => o.onResize?.(), { once: true });
            img.src = url;
          }
          else { img.remove(); el.appendChild(h('span.rd-img-missing', null, block.alt || 'Image not available')); }
        });
        break;
      }
      default:
        kind = 'hr';
        el = h('hr.rd-b.rd-hr', { 'data-b': index });
    }
    if (kind === 'text' && (piece.cont || /^[　 ]/.test(text))) el.classList.add('rd-noindent');
    if (kind === 'text' && piece.more) el.classList.add('rd-more');
    if (kind === 'text' && isChinese() && !/[\p{Script=Han}]/u.test(text)) el.classList.add('rd-plain');
    else if (kind === 'text' && block.t === 'p' && text.length <= SHORT_PARAGRAPH) el.classList.add('rd-short');
    article.appendChild(el);
    return { index, kind, block, el, text, pieceStart: piece.start, rendered: null, trans: null, transBtn: null };
  });
  const sourceText = blocks.map((b) => b.text);
  blocks.forEach((b) => { if (b.kind === 'text') b.text = convert(b.text); });

  // ---- rendering
  let marked: { el: HTMLElement; cls: string }[] = [];

  function renderBlock(b: BlockState): void {
    if (b.rendered || b.kind !== 'text') return;
    try {
      const tokens = segment(b.text, dict, shownLexicon(), 'ruby' in b.block ? b.block.ruby : undefined);
      const opts = renderOptions();
      const shown = displayTokens(tokens, opts.sandhi);
      const { nodes, views } = renderTokens(tokens, shown, { ...opts, deferPinyin: lazy });
      b.el.appendChild(nodes);
      b.rendered = { el: b.el, text: b.text, tokens, shown, views, pinyinBuilt: lazy ? false : undefined };
    } catch (e) {
      // One bad paragraph must not take the chapter down: show it as plain text, without lookup.
      failed++;
      console.error('Could not set a paragraph', b.index, e);
      while (b.el.firstChild) b.el.removeChild(b.el.firstChild);
      b.el.appendChild(document.createTextNode(b.text));
      b.el.classList.add('rd-plain');
      b.rendered = { el: b.el, text: b.text, tokens: [], shown: [], views: [] };
      return;
    }
    markSaved(b);
    if ((isChinese() ? /[\p{Script=Han}]/u : /\p{L}/u).test(b.text) && b.block.t !== 'h') addTranslateButton(b);
  }

  function markSaved(b: BlockState): void {
    if (!b.rendered) return;
    for (const v of b.rendered.views) {
      const w = v.token.key || v.token.text;
      v.el.classList.toggle('rd-saved', store.vocab.has(w));
      v.el.classList.toggle('rd-known', store.known.has(w));
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

  function ensurePinyin(index: number): void {
    const b = blocks[index];
    if (!b?.rendered || b.rendered.pinyinBuilt !== false) return;
    buildPinyin(b.rendered, renderOptions());
  }

  // ---- places that survive splitting
  const toStored = (block: number, offset: number) => {
    const b = blocks[Math.min(Math.max(block, 0), blocks.length - 1)];
    const src = pieces[b?.index ?? 0]?.src ?? -1;
    if (src < 0) return { block: 0, offset: 0 }; // the chapter title is not a stored block
    return { block: src, offset: (b?.pieceStart ?? 0) + Math.max(0, offset) };
  };
  const fromStored = (stored: number, offset = 0) => {
    // Pieces of one stored block are consecutive; the one holding the offset is the last that starts at or before it.
    let hit = -1;
    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i].src !== stored) { if (hit >= 0) break; continue; }
      if (hit < 0 || pieces[i].start <= offset) hit = i;
    }
    if (hit < 0) return { block: Math.min(Math.max(stored + synthetic, 0), blocks.length - 1), offset: 0 };
    return { block: hit, offset: Math.max(0, offset - pieces[hit].start) };
  };

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
      else return isWord(t) ? mid : -1;
    }
    return -1;
  }

  // A mark (the word whose card is open, a selected phrase, the word being read aloud) is a band drawn behind the text in a layer of
  // its own, one per line, not a box added to each character: in WebKit a box added to a character made the paragraph, and in
  // Pages the whole chapter, lay itself out again (20 to 40 ms a tap on an iPad). The characters still get the class.
  const BANDS: Record<string, string> = { 'rd-active': 'rd-band-active', 'rd-sel': 'rd-band-sel', 'rd-speaking-word': 'rd-band-speaking' };
  let bands: { el: HTMLElement; cls: string }[] = [];
  /** The bands' layer, made with the chapter: layout is contained in it, so a band added there leaves the chapter's columns alone. */
  const layer = h('div.rd-bands', { 'aria-hidden': 'true', 'data-rd-ui': '' });
  article.prepend(layer);

  /** Bands behind `els` (in reading order): measured now, drawn when the returned function runs. */
  function measureBands(els: HTMLElement[], cls: string): () => void {
    const kind = BANDS[cls];
    if (!kind || !els.length) return () => {};
    const box = article.getBoundingClientRect();
    const em = Number.parseFloat(getComputedStyle(els[0]).fontSize) || 16;
    const lines: { l: number; t: number; r: number; b: number }[] = [];
    for (const x of els) {
      const r = x.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      // ！ is drawn moved to the left (rd-pu-b): its band stays where its box was.
      const shift = x.classList.contains('rd-pu-b') ? 0.3 * em : 0;
      // From a little above the character to its foot, as far as the cell reaches.
      const q = { l: r.left + shift, r: r.right + shift, t: r.top - 0.36 * em, b: r.bottom + 0.02 * em };
      const line = lines[lines.length - 1];
      if (line && Math.abs(q.t - line.t) < em * 0.5 && q.l <= line.r + 2 && q.r >= line.l - 2) {
        line.l = Math.min(line.l, q.l); line.r = Math.max(line.r, q.r); line.b = Math.max(line.b, q.b);
      } else lines.push(q);
    }
    return () => {
      for (const q of lines) {
        const band = h(`div.rd-band.${kind}`);
        band.style.cssText = `left:${q.l - box.left}px;top:${q.t - box.top}px;width:${q.r - q.l}px;height:${q.b - q.t}px`;
        layer.appendChild(band);
        bands.push({ el: band, cls });
      }
    };
  }

  function mark(b: BlockState, start: number, end: number, cls: string): void {
    prepareMark(b, start, end, cls)();
  }

  function prepareMark(b: BlockState, start: number, end: number, cls: string): () => void {
    // Characters in the range, and the marks of punctuation between them, so a phrase is one band and not a row of chips.
    const els: HTMLElement[] = [];
    let pending: HTMLElement[] = [];
    let inside = false;
    for (const el of b.el.querySelectorAll<HTMLElement>(`${POS_SEL}, .rd-pu`)) {
      if (el.classList.contains('rd-pu')) { if (inside) pending.push(el); continue; }
      const off = Number(el.dataset.o);
      if (off >= start && off < end) {
        els.push(...pending, el);
        pending = [];
        inside = true;
      } else {
        pending = [];
        inside = false;
        if (off >= end) break;
      }
    }
    const draw = measureBands(els, cls);
    return () => {
      draw();
      for (const el of els) { el.classList.add(cls); marked.push({ el, cls }); }
    };
  }

  function clearMarks(cls?: string): void {
    const keep: typeof marked = [];
    for (const m of marked) {
      if (!cls || m.cls === cls) m.el.classList.remove(m.cls);
      else keep.push(m);
    }
    marked = keep;
    bands = bands.filter((x) => {
      if (cls && x.cls !== cls) return true;
      x.el.remove();
      return false;
    });
  }

  function rectsOf(b: BlockState, start: number, end: number): DOMRect[] {
    const out: DOMRect[] = [];
    for (const ruby of b.el.querySelectorAll<HTMLElement>(POS_SEL)) {
      const off = Number(ruby.dataset.o);
      if (off < start || off >= end) continue;
      const q = ruby.getBoundingClientRect();
      if (q.width || q.height) out.push(q);
    }
    return out;
  }

  function rectOf(b: BlockState, start: number, end: number): DOMRect | null {
    return anchorOf(rectsOf(b, start, end), { w: window.innerWidth, h: window.innerHeight });
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

  // An open paragraph translation is in the language chosen when it opened. A new choice (made in another tab, or brought by
  // sync) translates the open ones again, so a paragraph never shows French under a setting that now says German.
  const targetOf = (s: Settings) => targetFor(s.translateTo, langId());
  let shownTarget = targetOf(ctx.settings.get());
  const unsubTarget = ctx.settings.subscribe?.((s, changed) => {
    if (!changed.includes('translateTo') || targetOf(s) === shownTarget) return;
    shownTarget = targetOf(s);
    for (const b of blocks) if (b.trans) { toggleTranslation(b); toggleTranslation(b); }
  });

  const view: ChapterView = {
    el: article,
    blocks,
    synthetic,
    toStored,
    fromStored,
    title: chapter.title?.trim() ?? '',
    renderTo,
    ensure(index) { const b = blocks[index]; if (b) renderBlock(b); },
    ensurePinyin,
    failedBlocks: () => failed,
    renderRest,
    textElements,
    blockOfNode,
    tokenIndexAt,
    mark,
    clearMarks,
    rectOf,
    rectsOf,
    prepareMark,
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
      unsubTarget?.();
      for (const b of blocks) b.trans?.panel.destroy();
    },
  };
  return view;
}
