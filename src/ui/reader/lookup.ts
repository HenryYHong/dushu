// Looking things up from the text: one word (tap, click, hover, arrow keys) or a phrase (drag or long-press selection).
// Shared by the Scroll and Pages layouts; the layouts only differ in how a word is brought into view.
import type { AppContext, BookMeta, Dictionary, Lexicon } from '../../types';
import { hasHan, sentenceAround } from '../../core/text';
import { openPhrasePopup, openWordPopup } from '../popup/popup';
import type { BlockState, ChapterView } from './chapter';
import { rangeToSpans, spansText, type BlockSpan } from './selection';

const MAX_PHRASE = 1500;

export interface LookupHost {
  ctx: AppContext;
  dict: Dictionary;
  book: BookMeta;
  view(): ChapterView | null;
  chapterIndex(): number;
  lexicon(): Lexicon | undefined;
  /** The user added, edited or disabled a lexicon entry in a popup. */
  onLexiconChange(): void;
  /** Bring a word into view (scroll, or turn to its page) before its popup opens. */
  reveal(b: BlockState, start: number, end: number): void;
  pointerKind(): 'mouse' | 'touch' | 'pen';
  /** Continue chapter audio at an exact displayed-text offset. */
  readFrom?(block: BlockState, offset: number): void;
  /** A word popup is now showing this word (it also fires when the popup steps to a neighbor). */
  onWordShown?(b: BlockState, start: number, end: number): void;
  /** The element focus returns to when a popup closes (the word the reader's keyboard cursor is on). */
  restoreFocus?(): HTMLElement | null;
  /** The y of the top edge of a bottom-sheet popup, or null when it is not a sheet (the Pages stage lifts so the word stays in view). */
  onSheetTop?(top: number | null): void;
  /** Can the page move out of a sheet's way right now (Pages)? Popups on a touch tablet become sheets only then. */
  liftsPage?(): boolean;
}

export interface Lookup {
  openWord(b: BlockState, start: number, end: number): void;
  openToken(w: Element): void;
  step(dir: -1 | 1): void;
  resize(delta: -1 | 1): void;
  /** The nearest Han word at or after (dir 1) or before (dir -1) an offset, crossing blocks. */
  nextWord(bi: number, offset: number, dir: -1 | 1): { b: BlockState; s: number; e: number } | null;
  /** Look up the whole sentence around a word (double-tap): the phrase popup with its translation. */
  openSentence(w: Element): void;
  /** Map the native selection to a word or phrase popup. Returns true when it opened one. */
  processSelection(): boolean;
  /** Forget the open word (the chapter changed). */
  reset(): void;
  hasPhraseOpen(): boolean;
}

export function createLookup(host: LookupHost): Lookup {
  const { ctx, dict, book } = host;
  let active: { bi: number; s: number; e: number; kind: 'word' | 'phrase' } | null = null;
  let openSeq = 0;
  let lastPhraseKey = '';

  const fallbackRect = () => new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
  const lexiconProps = () => ({ lexicon: host.lexicon(), bookId: book.id, onLexiconChange: () => host.onLexiconChange() });

  function openWord(b: BlockState, s: number, e: number): void {
    const v = host.view();
    if (!v || !b.rendered) return;
    if (active && active.kind === 'word' && active.bi === b.index && active.s === s && active.e === e) return;
    host.reveal(b, s, e);
    const toks = b.rendered.tokens;
    const prev = [...toks].reverse().find((t) => t.end <= s);
    const next = toks.find((t) => t.start >= e);
    const word = b.text.slice(s, e);
    const token = toks.find((t) => t.start === s && t.end === e && t.kind === 'han');
    const sentence = sentenceAround(b.text, s).text;
    v.clearMarks();
    v.mark(b, s, e, 'rd-active');
    active = { bi: b.index, s, e, kind: 'word' };
    const seq = ++openSeq;
    const getAnchor = () => v.rectOf(b, s, e);
    openWordPopup({
      ctx,
      word,
      reading: token?.pinyin,
      anchor: getAnchor() ?? fallbackRect(),
      getAnchor,
      keepAnchorVisible: true,
      context: { sentence, paragraph: b.text, bookId: book.id, bookTitle: book.title, chapter: host.chapterIndex() },
      prev: prev?.text,
      next: next?.text,
      onStep: (dir) => step(dir),
      onResize: (d) => resize(d),
      onReadFromHere: host.readFrom ? () => host.readFrom!(b, s) : undefined,
      onClose: () => { if (seq === openSeq) { v.clearMarks(); active = null; } },
      restoreFocus: host.restoreFocus,
      onSheetTop: host.liftsPage?.() ? host.onSheetTop : undefined,
      ...lexiconProps(),
    });
    host.onWordShown?.(b, s, e);
  }

  function openToken(w: Element): void {
    const v = host.view();
    const b = v?.blockOfNode(w);
    const tok = b?.rendered?.tokens[Number((w as HTMLElement).dataset.i)];
    if (b && tok) openWord(b, tok.start, tok.end);
  }

  /** The nearest han token starting at or after (dir 1), or ending at or before (dir -1), an offset, crossing blocks. */
  function adjacentHan(bi: number, offset: number, dir: -1 | 1): { b: BlockState; s: number; e: number } | null {
    const v = host.view()!;
    for (let i = bi; i >= 0 && i < v.blocks.length; i += dir) {
      const b = v.blocks[i];
      if (b.kind !== 'text') continue;
      v.ensure(i);
      const toks = b.rendered!.tokens;
      if (dir === 1) {
        const t = toks.find((x) => x.kind === 'han' && x.start >= (i === bi ? offset : 0));
        if (t) return { b, s: t.start, e: t.end };
      } else {
        for (let k = toks.length - 1; k >= 0; k--) {
          const t = toks[k];
          if (t.kind === 'han' && t.end <= (i === bi ? offset : Infinity)) return { b, s: t.start, e: t.end };
        }
      }
    }
    return null;
  }

  function step(dir: -1 | 1): void {
    const v = host.view();
    if (!active || !v) return;
    const found = adjacentHan(active.bi, dir === 1 ? active.e : active.s, dir);
    if (!found) return;
    openWord(found.b, found.s, found.e);
  }

  function resize(delta: -1 | 1): void {
    const v = host.view();
    if (!active || !v) return;
    const b = v.blocks[active.bi];
    const { s, e } = active;
    const len = e - s;
    const cands = dict.wordsAt(b.text, s); // longest first
    let ne: number | null = null;
    if (delta === 1) {
      const longer = cands.filter((w) => w.length > len);
      if (longer.length) ne = s + longer[longer.length - 1].length;
      else {
        const next = b.rendered!.tokens.find((t) => t.kind === 'han' && t.start >= e);
        if (next && next.start === e) ne = next.end; // merge with the touching next word
      }
    } else {
      const shorter = cands.filter((w) => w.length < len);
      if (shorter.length) ne = s + shorter[0].length;
      else if ([...b.text.slice(s, e)].length > 1) ne = e - ([...b.text.slice(s, e)].pop()!.length);
    }
    if (ne === null || ne === e) return;
    openWord(b, s, ne);
  }

  function processSelection(): boolean {
    const v = host.view();
    const sel = window.getSelection();
    if (!v || !sel || sel.isCollapsed || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    if (!v.el.contains(range.startContainer) || !v.el.contains(range.endContainer)) return false;
    let spans = rangeToSpans(range, v.textElements());
    if (!spans.length) return false;

    // Cap very long selections.
    let total = 0;
    const capped: BlockSpan[] = [];
    for (const sp of spans) {
      const room = MAX_PHRASE - total;
      if (room <= 0) break;
      const end = Math.min(sp.end, sp.start + room);
      capped.push({ ...sp, end });
      total += end - sp.start;
    }
    spans = capped;
    const stateOf = (sp: BlockSpan) => v.blocks[Number(sp.block.dataset.b)];
    const text = spansText(spans, (el) => v.blocks[Number(el.dataset.b)].text).trim();
    if (!hasHan(text)) return false;
    const touch = host.pointerKind() === 'touch';

    // One character, or exactly one word: look it up as a word.
    if (spans.length === 1) {
      const b = stateOf(spans[0]);
      const { start, end } = spans[0];
      const slice = b.text.slice(start, end);
      const tokIdx = v.tokenIndexAt(b, start);
      const tok = tokIdx >= 0 ? b.rendered!.tokens[tokIdx] : null;
      const oneChar = [...slice].length === 1 && hasHan(slice);
      if (oneChar || (tok && tok.start === start && tok.end === end)) {
        if (!touch) sel.removeAllRanges();
        openWord(b, start, end);
        return true;
      }
    }

    return showPhrase(spans, text, !touch);
  }

  /** The phrase popup for text already mapped to blocks. `clearNative` drops the browser's selection (mouse; touch keeps its handles). */
  function showPhrase(spans: BlockSpan[], text: string, clearNative: boolean): boolean {
    const v = host.view();
    if (!v) return false;
    const stateOf = (sp: BlockSpan) => v.blocks[Number(sp.block.dataset.b)];
    const key = spans.map((sp) => `${sp.block.dataset.b}:${sp.start}-${sp.end}`).join('|');
    if (key === lastPhraseKey && active?.kind === 'phrase') return true;
    lastPhraseKey = key;

    v.clearMarks();
    for (const sp of spans) v.mark(stateOf(sp), sp.start, sp.end, 'rd-sel');
    const union = () => {
      let r: DOMRect | null = null;
      for (const sp of spans) {
        const q = v.rectOf(stateOf(sp), sp.start, sp.end);
        if (!q) continue;
        r = r ? new DOMRect(Math.min(r.left, q.left), Math.min(r.top, q.top), Math.max(r.right, q.right) - Math.min(r.left, q.left), Math.max(r.bottom, q.bottom) - Math.min(r.top, q.top)) : q;
      }
      return r;
    };
    const first = stateOf(spans[0]);
    active = { bi: first.index, s: spans[0].start, e: spans[0].end, kind: 'phrase' };
    const seq = ++openSeq;
    if (clearNative) window.getSelection()?.removeAllRanges();
    const sentence = sentenceAround(first.text, spans[0].start).text;
    openPhrasePopup({
      ctx,
      text,
      anchor: union() ?? fallbackRect(),
      getAnchor: union,
      keepAnchorVisible: true,
      context: first.text,
      onReadFromHere: host.readFrom ? () => host.readFrom!(first, spans[0].start) : undefined,
      wordContext: { sentence, paragraph: first.text, bookId: book.id, bookTitle: book.title, chapter: host.chapterIndex() },
      onClose: () => { if (seq === openSeq) { v.clearMarks(); active = null; lastPhraseKey = ''; } },
      restoreFocus: host.restoreFocus,
      onSheetTop: host.liftsPage?.() ? host.onSheetTop : undefined,
      ...lexiconProps(),
    });
    return true;
  }

  function openSentence(w: Element): void {
    const v = host.view();
    const b = v?.blockOfNode(w);
    const tok = b?.rendered?.tokens[Number((w as HTMLElement).dataset.i)];
    if (!v || !b || !tok) return;
    const sp = sentenceAround(b.text, tok.start);
    const lead = sp.text.length - sp.text.trimStart().length;
    const start = sp.start + lead;
    const end = sp.start + sp.text.trimEnd().length;
    const phrase = b.text.slice(start, end);
    if (end <= start || !hasHan(phrase)) return;
    showPhrase([{ block: b.el, start, end }], phrase, true);
  }

  return {
    openWord,
    openToken,
    step,
    resize,
    nextWord: adjacentHan,
    openSentence,
    processSelection,
    reset() { active = null; lastPhraseKey = ''; openSeq++; },
    hasPhraseOpen: () => active?.kind === 'phrase',
  };
}
