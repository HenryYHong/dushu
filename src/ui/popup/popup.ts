// Word and phrase popups. One is open at a time; opening one closes the other. Contract: ARCHITECTURE.md §5.2.
import '../../styles/popup.css';
import type { AppContext, Lexicon, Token } from '../../types';
import { activeEngine } from '../../lang/active';
import { mountLangWordView } from './langWordView';
import { h } from '../dom';
import { closeActivePopup, createHost } from './host';
import { mountPhraseView } from './phraseView';
import { mountWordView } from './wordView';

export interface WordContext { sentence: string; paragraph?: string; bookId?: string; bookTitle?: string; chapter?: number }

export interface WordPopupOptions {
  ctx: AppContext;
  /** The word as displayed (either script). */
  word: string;
  /** The base (non-sandhi) reading of the selected token as rendered in the book. */
  reading?: string[];
  /** Another language: the token as cut on the page (its lemma and reading). */
  token?: Token;
  /** Viewport rect of the word; the popup positions itself above/below and stays on screen. */
  anchor: DOMRect;
  context?: WordContext;
  /** Neighbouring text, used for polyphone context. */
  prev?: string;
  next?: string;
  /** Reader hooks; omit to hide the controls. */
  onStep?: (dir: -1 | 1) => void;
  onResize?: (delta: -1 | 1) => void;
  onClose?: () => void;
  /** Continue chapter audio at the word's source position (reader only). */
  onReadFromHere?: () => void;
  /** Optional: fresh viewport rect of the word while the page scrolls (null = gone). */
  getAnchor?: () => DOMRect | null;
  /** Optional: on a narrow screen, scroll so the bottom sheet does not cover the word. */
  keepAnchorVisible?: boolean;
  /**
   * Optional: called after each placement with the viewport y of the bottom sheet's top edge, or null when the popup
   * floats or closes. The Pages reader lifts the page by this much so the tapped word stays above the sheet.
   */
  onSheetTop?: (top: number | null) => void;
  /** Optional: the element focus returns to when the popup closes (default: the element it was opened from). */
  restoreFocus?: () => HTMLElement | null;
  /** Optional: shows a Back button on the first view (used when opened from a phrase popup). */
  onBack?: () => void;
  /** The open book's lexicon (names/terms + user words); the popup shows and edits its entries. */
  lexicon?: Lexicon;
  /** Book the lexicon edits belong to. */
  bookId?: string;
  /** Called after the user adds, edits or disables a lexicon entry, so the reader can re-segment. */
  onLexiconChange?: () => void;
}

export interface PhrasePopupOptions {
  ctx: AppContext;
  text: string;
  anchor: DOMRect;
  /** Paragraph the selection came from. */
  context?: string;
  wordContext?: WordContext;
  onClose?: () => void;
  /** Continue chapter audio at the beginning of the selection (reader only). */
  onReadFromHere?: () => void;
  getAnchor?: () => DOMRect | null;
  keepAnchorVisible?: boolean;
  /**
   * Optional: called after each placement with the viewport y of the bottom sheet's top edge, or null when the popup
   * floats or closes. The Pages reader lifts the page by this much so the tapped word stays above the sheet.
   */
  onSheetTop?: (top: number | null) => void;
  /** Optional: the element focus returns to when the popup closes (default: the element it was opened from). */
  restoreFocus?: () => HTMLElement | null;
  /** Optional: shows a Back button (used when opened from a word popup). */
  onBack?: () => void;
  lexicon?: Lexicon;
  bookId?: string;
  onLexiconChange?: () => void;
}

export interface PopupHandle { el: HTMLElement; close(): void }

/** Stands in until the dictionary has loaded. */
function loadingNote(): HTMLElement {
  return h('div.pp-loading', null, h('span.app-spinner'), 'Loading the dictionary…');
}

export function openWordPopup(o: WordPopupOptions): PopupHandle {
  let view: { onKey(e: KeyboardEvent): boolean; dispose(): void } | null = null;
  const host = createHost({
    kind: 'word',
    label: `Word: ${o.word}`,
    anchor: o.anchor,
    getAnchor: o.getAnchor,
    keepAnchorVisible: o.keepAnchorVisible,
    onSheetTop: o.onSheetTop,
    restoreFocus: o.restoreFocus,
    onKey: (e) => view?.onKey(e) ?? false,
    onClose: () => { view?.dispose(); o.onClose?.(); },
  });

  const openPhrase = (text: string, anchor: DOMRect, context?: string) => {
    const wasContext = o.context;
    openPhrasePopup({
      ctx: o.ctx, text, anchor, context, wordContext: wasContext,
      lexicon: o.lexicon, bookId: o.bookId, onLexiconChange: o.onLexiconChange,
      onSheetTop: o.onSheetTop, restoreFocus: o.restoreFocus,
      onBack: () => { openWordPopup({ ...o, anchor: o.getAnchor?.() ?? o.anchor }); },
    });
  };
  const start = (dict: NonNullable<ReturnType<AppContext['dictSync']>>) => {
    if (host.closed) return;
    host.content.textContent = '';
    // Another language's card reads its own engine (loaded with ctx.dict(), lang/active.ts).
    const engine = activeEngine();
    view = engine ? mountLangWordView(host, o, engine, openPhrase) : mountWordView(host, o, dict, openPhrase);
  };

  const dict = o.ctx.dictSync();
  if (dict) start(dict);
  else {
    host.content.appendChild(loadingNote());
    host.placeNow();
    o.ctx.dict().then(start).catch(() => {
      if (host.closed) return;
      host.content.textContent = '';
      host.content.appendChild(h('p.pp-note', null, 'The dictionary could not be loaded.'));
    });
  }
  return { el: host.el, close: () => host.close() };
}

export function openPhrasePopup(o: PhrasePopupOptions): PopupHandle {
  let view: { onKey(e: KeyboardEvent): boolean; dispose(): void } | null = null;
  const host = createHost({
    kind: 'phrase',
    label: 'Phrase',
    anchor: o.anchor,
    getAnchor: o.getAnchor,
    keepAnchorVisible: o.keepAnchorVisible,
    onSheetTop: o.onSheetTop,
    restoreFocus: o.restoreFocus,
    onKey: (e) => view?.onKey(e) ?? false,
    onClose: () => { view?.dispose(); o.onClose?.(); },
  });

  const openWord = (r: { word: string; syllables: string[]; reading?: string[]; prev?: string; next?: string; token?: Token }, anchor: DOMRect) => {
    openWordPopup({
      ctx: o.ctx, word: r.word, anchor, prev: r.prev, next: r.next, reading: r.reading, token: r.token,
      lexicon: o.lexicon, bookId: o.bookId, onLexiconChange: o.onLexiconChange,
      context: o.wordContext ?? (o.context ? { sentence: o.context } : undefined),
      onSheetTop: o.onSheetTop, restoreFocus: o.restoreFocus,
      onBack: () => { openPhrasePopup({ ...o, anchor: o.getAnchor?.() ?? o.anchor }); },
    });
  };
  const start = (dict: NonNullable<ReturnType<AppContext['dictSync']>>) => {
    if (host.closed) return;
    host.content.textContent = '';
    view = mountPhraseView(host, o, dict, openWord);
  };

  const dict = o.ctx.dictSync();
  if (dict) start(dict);
  else {
    host.content.appendChild(loadingNote());
    host.placeNow();
    o.ctx.dict().then(start).catch(() => {
      if (host.closed) return;
      host.content.textContent = '';
      host.content.appendChild(h('p.pp-note', null, 'The dictionary could not be loaded.'));
    });
  }
  return { el: host.el, close: () => host.close() };
}

export function closePopup(): void {
  closeActivePopup();
}
