// The reader screen: top bar, chapter text with ruby pinyin, word and phrase lookup, progress.
// Two layouts share everything else: Scroll (one long column) and Pages (paginated like a book, ARCHITECTURE.md 5.7).
// Contract: ARCHITECTURE.md 5.3 and 5.7.
import '../../styles/reader.css';
import type { Dictionary, Lexicon, LexiconEntry, MountFn, PinyinMode, Progress, Settings } from '../../types';
import { readingFontSizeKey } from '../../store/settings';
import { canSpeak, pauseSpeaking, resumeSpeaking, speakSequence, stopSpeaking } from '../../speech/tts';
import { EMPTY_LEXICON, isDetecting, loadLexicon } from '../../core/lexicon';
import { h, clear } from '../dom';
import { icon } from '../icons';
import { closePopup, openWordPopup } from '../popup/popup';
import { createChapterView, type BlockState, type ChapterView } from './chapter';
import { effectiveLineHeight } from './grid';
import { createLookup } from './lookup';
import {
  buildDisplayMenu, buildPinyinMenu, closePopover, openPopover, pinyinModeLabel, popoverOpenFor, showShortcuts,
} from './menus';
import { createPager, type Pager } from './pager';
import { rangeToSpans, snapToCodePoint, spansText } from './selection';
import { createToc } from './toc';

const BAR_H = 52;
const PINYIN_CYCLE: PinyinMode[] = ['off', 'all', 'unknown', 'hsk'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && !!el.tagName && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function message(root: HTMLElement, title: string, body: string): void {
  clear(root);
  root.appendChild(h('div.page', null,
    h('h1.page-title', null, title),
    h('p.muted', null, body),
    h('p', null, h('a.btn', { href: '#/' }, icon('arrowLeft'), 'Back to the library'))));
}

/** A place in a chapter that survives a change of layout: a stored block number and an offset in it. */
interface Place { chapter: number; block: number; offset: number }

export const mount: MountFn = async (root, params, ctx) => {
  clear(root);
  root.appendChild(h('div.app-loading', null, h('div.app-spinner'), 'Opening the book…'));

  const store = ctx.store;
  const book = params.bookId ? await store.books.get(params.bookId) : undefined;
  if (!book) { message(root, 'Book not found', 'This book is not in your library. It may have been removed.'); return; }
  let dict: Dictionary;
  try { dict = await ctx.dict(); } catch {
    message(root, 'Dictionary not loaded', 'The dictionary data could not be loaded, so words cannot be looked up. Reload the page to try again.');
    return;
  }
  if (!location.hash.startsWith('#/read')) return; // navigated away while loading

  const saved = await store.progress.get(book.id);
  const prevTitle = document.title;
  document.title = `${book.title} - Dushu`;
  void store.books.update(book.id, { lastOpenedAt: Date.now() }).catch(() => {});

  // The book's names and terms. First open: what exists now; detection runs in the background and calls back.
  let lexicon: Lexicon = EMPTY_LEXICON;
  let lexiconReady = false;
  // While the first scan runs, laying out the neighbor chapters would starve it and be thrown away when names arrive.
  let scanning = false;
  const scanDone = () => { scanning = false; pager?.holdNeighbors(false); };
  try {
    lexicon = await loadLexicon(ctx, book.id, (lex) => {
      if (lexiconReady) applyLexicon(lex); else lexicon = lex;
      scanDone();
    });
    scanning = isDetecting(book.id);
  } catch (e) { console.error('lexicon', e); }
  lexiconReady = true;

  // ------------------------------------------------------------------ chrome
  const titleBook = h('div.rd-book-title', null, book.title);
  const titleChapter = h('div.rd-chapter-title');
  const pct = h('span.rd-pct');
  const fill = h('div.rd-progress-fill');
  const pinyinLabel = h('span.rd-pill-label');
  const pinyinBtn = h('button.rd-pill.rd-pinyin-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Pinyin (P)', onclick: () => togglePinyinMenu() },
    icon('eye'), pinyinLabel) as HTMLButtonElement;
  const aaBtn = h('button.rd-pill.rd-aa-btn', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Display settings', onclick: () => toggleDisplayMenu() },
    h('span.rd-aa', null, 'Aa')) as HTMLButtonElement;
  const speechBtn = h('button.icon-btn.rd-speech-btn', {
    type: 'button', title: 'Read chapter aloud', 'aria-label': 'Read chapter aloud', 'aria-pressed': 'false',
    onclick: () => { if (speaking) stopChapterSpeech(); else void startChapterSpeech(); },
  }, icon('speaker')) as HTMLButtonElement;
  speechBtn.hidden = !canSpeak();
  const pauseBtn = h('button.icon-btn.rd-pause-btn', {
    type: 'button', title: 'Pause reading', 'aria-label': 'Pause reading', 'aria-pressed': 'false',
    onclick: () => {
      if (!speaking) return;
      paused = !paused;
      if (paused) pauseSpeaking(); else resumeSpeaking();
      syncSpeechButton();
    },
  }, icon('pause')) as HTMLButtonElement;
  pauseBtn.hidden = true;
  const audioStatus = h('span.rd-audio-status', { role: 'status', 'aria-live': 'polite' }, 'Reading aloud');
  const audioSpeed = h('select.rd-audio-speed', { 'aria-label': 'Reading speed', title: 'Audio speed; applies at the next sentence' }) as HTMLSelectElement;
  audioSpeed.addEventListener('change', () => ctx.settings.set({ ttsRate: Number(audioSpeed.value) }));
  const audioPause = h('button.btn.btn-sm.rd-audio-pause', { type: 'button', 'aria-label': 'Pause audio', onclick: () => pauseBtn.click() }, icon('pause'), 'Pause') as HTMLButtonElement;
  const audio = h('aside.rd-audio', { hidden: true, 'data-rd-ui': true, 'aria-label': 'Read-aloud controls' },
    audioStatus, audioSpeed, audioPause,
    h('button.icon-btn', { type: 'button', 'aria-label': 'Stop audio', title: 'Stop audio', onclick: () => stopChapterSpeech() }, icon('stop')));
  const tocBtn = h('button.icon-btn.rd-toc-btn', { type: 'button', title: 'Chapters (C)', 'aria-label': 'Chapters', onclick: () => toc.open(chapterIndex) }, icon('list'));
  const bar = h('header.rd-bar', null,
    h('a.icon-btn.rd-back', { href: '#/', title: 'Back to the library', 'aria-label': 'Back to the library' }, icon('arrowLeft')),
    h('div.rd-titles', null, titleBook, titleChapter),
    h('div.rd-bar-actions', null, tocBtn, speechBtn, pauseBtn, pinyinBtn, aaBtn, pct),
    h('div.rd-progress', { 'aria-hidden': 'true' }, fill));
  const page: HTMLElement = h('main.rd-page');
  const rd: HTMLElement = h('div.rd-root', null, bar, page, audio);
  clear(root);
  root.appendChild(rd);

  const toc = createToc(ctx, book, (i) => void loadChapter(i, { top: true }), {
    load: () => store.lexicon.get(book.id),
    onWord: (entry, anchor) => openWordPopup({
      ctx, word: entry.word, anchor, lexicon, bookId: book.id, onLexiconChange: () => void reloadLexicon(),
      context: { sentence: '', bookId: book.id, bookTitle: book.title },
    }),
    onToggle: async (entry: LexiconEntry) => {
      // A choice the user made is never overwritten by a new scan.
      await store.lexicon.upsert(book.id, { ...entry, enabled: !entry.enabled, origin: 'user' });
      await reloadLexicon();
    },
  });

  // ------------------------------------------------------------------- state
  let scrollView: ChapterView | null = null;
  let pager: Pager | null = null;
  let paged = false;
  let chapterIndex = 0;
  let loadSeq = 0;
  let disposed = false;
  let suppressClick = false;
  let dragFromArticle = false;
  let pointerKind: 'mouse' | 'touch' | 'pen' = 'mouse';
  let popupWasOpen = false;
  let speaking = false;
  let paused = false;
  let audioStarted = false;
  let speechRun = 0;
  let spokenBlock: BlockState | null = null;

  const view = (): ChapterView | null => (paged ? pager?.view() ?? null : scrollView);

  function syncSpeechButton(): void {
    speechBtn.replaceChildren(icon(speaking ? 'stop' : 'speaker'));
    speechBtn.setAttribute('aria-pressed', String(speaking));
    speechBtn.setAttribute('aria-label', speaking ? 'Stop reading aloud' : 'Read chapter aloud');
    speechBtn.title = speaking ? 'Stop reading aloud' : 'Read chapter aloud';
    pauseBtn.hidden = !speaking || !paged;
    pauseBtn.replaceChildren(icon(paused ? 'play' : 'pause'));
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.setAttribute('aria-label', paused ? 'Resume reading' : 'Pause reading');
    pauseBtn.title = paused ? 'Resume reading' : 'Pause reading';
    audio.hidden = !speaking;
    rd.classList.toggle('rd-audio-on', speaking);
    audioStatus.textContent = paused ? 'Paused' : audioStarted ? 'Reading aloud' : 'Preparing audio…';
    audioPause.replaceChildren(icon(paused ? 'play' : 'pause'), paused ? 'Resume' : 'Pause');
    audioPause.setAttribute('aria-label', paused ? 'Resume audio' : 'Pause audio');
    const rate = ctx.settings.get().ttsRate;
    const rates = [...new Set([0.5, 0.75, 0.9, 1, 1.25, 1.5, 2, rate])].sort((a, b) => a - b);
    audioSpeed.replaceChildren(...rates.map(value => h('option', { value }, `${value}×`)));
    audioSpeed.value = String(rate);
  }

  function stopChapterSpeech(): void {
    const wasSpeaking = speaking;
    speechRun++;
    speaking = false;
    paused = false;
    audioStarted = false;
    spokenBlock?.el.classList.remove('rd-speaking');
    view()?.clearMarks('rd-speaking-word');
    spokenBlock = null;
    if (wasSpeaking) stopSpeaking();
    syncSpeechButton();
  }

  async function startChapterSpeech(from?: { block: number; offset: number }): Promise<void> {
    const v = view();
    if (disposed || !v || !canSpeak()) return;
    const start = from?.block ?? (paged ? (pager?.anchor()?.block ?? 0) : (firstVisible()?.index ?? 0));
    const offset = from ? snapToCodePoint(v.blocks[start]?.text || '', from.offset, -1) : 0;
    const blocks = v.blocks.filter(b => b.kind === 'text' && b.text.trim() && b.index >= start);
    if (!blocks.length) { ctx.toast('No text left to read in this chapter.'); return; }
    const offsets = blocks.map(b => b.index === start ? offset : 0);
    const texts = blocks.map((b, i) => b.text.slice(offsets[i]));
    if (!texts.some(text => text.trim())) { ctx.toast('No text left to read in this chapter.'); return; }
    stopChapterSpeech();
    const mine = ++speechRun;
    speaking = true;
    paused = false;
    audioStarted = false;
    syncSpeechButton();
    const s = ctx.settings.get();
    try {
      await speakSequence(texts, {
        rate: s.ttsRate, voice: s.ttsVoice, lang: langOf(s) === 'zh-Hant' ? 'zh-TW' : 'zh-CN',
        getRate: () => ctx.settings.get().ttsRate,
        onStart: () => {
          if (mine !== speechRun || audioStarted) return;
          audioStarted = true;
          syncSpeechButton();
        },
        onError: message => ctx.toast(message),
      }, (i) => {
        if (mine !== speechRun) return;
        spokenBlock?.el.classList.remove('rd-speaking');
        v.clearMarks('rd-speaking-word');
        const b = blocks[i];
        v.ensure(b.index);
        spokenBlock = b;
        b.el.classList.add('rd-speaking');
        if (paged) pager?.reveal(b.index, offsets[i]);
        else if (offsets[i]) ensureInView(b, offsets[i]);
        else {
          const r = b.el.getBoundingClientRect();
          if (r.top < BAR_H + 8 || r.top > window.innerHeight * 0.8) scrollToBlock(b);
        }
      }, (i, at) => {
        if (mine !== speechRun) return;
        const b = blocks[i];
        const sourceAt = offsets[i] + at;
        const token = b.rendered?.tokens[v.tokenIndexAt(b, sourceAt)];
        if (!token) return;
        v.clearMarks('rd-speaking-word');
        v.mark(b, token.start, token.end, 'rd-speaking-word');
        if (paged) {
          const r = v.rectOf(b, token.start, token.end);
          if (!r || r.top < BAR_H || r.bottom > window.innerHeight - 24) pager?.reveal(b.index, token.start);
        } else ensureInView(b, token.start);
      });
    } finally {
      if (mine === speechRun) stopChapterSpeech();
    }
  }

  const lookup = createLookup({
    ctx, dict, book,
    view,
    chapterIndex: () => chapterIndex,
    lexicon: () => lexicon,
    onLexiconChange: () => void reloadLexicon(),
    reveal: (b, s) => {
      if (paged) pager?.reveal(b.index, s);
      else ensureInView(b, s);
    },
    pointerKind: () => pointerKind,
    readFrom: (block, offset) => {
      if (view()?.blocks[block.index] !== block) { ctx.toast('Choose a starting word again; the text has changed.'); return; }
      void startChapterSpeech({ block: block.index, offset });
    },
  });

  // ------------------------------------------------------------ layout & live updates
  function applyLayout(s: Settings): void {
    // var() resolves where it is declared, so the traditional stacks are named here rather than left to :lang().
    const hant = langOf(s) === 'zh-Hant' ? '-hant' : '';
    const font = s.fontFamily === 'sans' ? `var(--font-sans${hant})` : s.fontFamily === 'kai' ? `var(--font-kai${hant})` : `var(--font-serif${hant})`;
    rd.style.setProperty('--rd-font', font);
    rd.style.setProperty('--rd-size', `${s[readingFontSizeKey(s)]}px`);
    // Pinyin sits in the space between lines, so lines need room for it whenever pinyin can show.
    rd.style.setProperty('--rd-lh', String(effectiveLineHeight(s.lineHeight, s.pinyin)));
    rd.style.setProperty('--rd-width', `${s.pageWidth}px`);
    rd.classList.toggle('rd-py-off', s.pinyin === 'off');
    rd.classList.toggle('rd-grid', s.pinyin !== 'off');
    rd.classList.toggle('rd-pt-on', s.paragraphTranslate);
    rd.classList.toggle('rd-hover-mode', s.lookupTrigger === 'hover');
    pinyinLabel.textContent = s.pinyin === 'hsk' ? `HSK ${s.hskThreshold >= 7 ? '7-9' : s.hskThreshold}` : pinyinModeLabel(s.pinyin);
    pinyinBtn.setAttribute('aria-label', `Pinyin: ${pinyinLabel.textContent}`);
  }
  applyLayout(ctx.settings.get());

  /** Run a change that reflows the scrolling page and keep the same line of text under the top bar. */
  function keepPlace(fn: () => void): void {
    const b = scrollView ? firstVisible() : null;
    const before = b ? b.el.getBoundingClientRect().top : 0;
    fn();
    if (b) {
      const after = b.el.getBoundingClientRect().top;
      if (Math.abs(after - before) > 1) window.scrollBy(0, after - before);
    }
  }

  let menuSync: (() => void) | null = null;

  const LAYOUT_KEYS: (keyof Settings)[] = ['fontSize', 'fontFamily', 'lineHeight', 'pageWidth', 'spread', 'pinyinStyle'];

  const unsubSettings = ctx.settings.subscribe((s, changed) => {
    if (changed.includes('ttsRate')) syncSpeechButton();
    if (changed.every(key => key === 'ttsRate' || key === 'ttsVoice')) { menuSync?.(); return; }
    const v = view();
    if (changed.includes('layout')) {
      applyLayout(s);
      void switchLayout();
      menuSync?.();
      return;
    }
    if (!v) { applyLayout(s); return; }
    if (paged) {
      applyLayout(s);
      if (changed.includes('script')) {
        v.el.lang = langOf(s);
        closePopup();
        v.reconvert();
        v.renderTo(v.blocks.length - 1);
        pager?.dropNeighbors();
        pager?.refresh();
      } else {
        if (changed.some((k) => k === 'pinyinStyle' || k === 'toneColors' || k === 'sandhi')) v.refreshPinyin();
        if (changed.some((k) => k === 'pinyin' || k === 'hskThreshold')) v.refreshVisibility();
        if (changed.some((k) => LAYOUT_KEYS.includes(k) || k === 'pinyin')) { closePopup(); pager?.relayout(); }
      }
      menuSync?.();
      return;
    }
    keepPlace(() => {
      applyLayout(s);
      if (changed.includes('script')) {
        v.el.lang = langOf(s);
        closePopup();
        v.reconvert();
        const anchorIdx = Math.max(0, (firstVisible()?.index ?? 0));
        v.renderTo(anchorIdx + 6);
        void v.renderRest();
      } else if (changed.some((k) => k === 'pinyinStyle' || k === 'toneColors' || k === 'sandhi')) {
        v.refreshPinyin();
      } else if (changed.some((k) => k === 'pinyin' || k === 'hskThreshold')) {
        v.refreshVisibility();
      }
    });
    menuSync?.();
  });
  const unsubStore = store.onChange((what) => {
    if (what === 'vocab' || what === 'known') view()?.refreshMarks();
  });

  // ----------------------------------------------------------- lexicon
  /** Re-segment the chapter with a new lexicon and keep the reading position. */
  function applyLexicon(lex: Lexicon): void {
    lexicon = lex;
    toc.refreshNames();
    const v = view();
    if (!v || disposed) return;
    closePopup();
    lookup.reset();
    if (paged) {
      v.setLexicon(lex);
      v.renderTo(v.blocks.length - 1);
      pager?.dropNeighbors();
      pager?.refresh();
    } else {
      keepPlace(() => v.setLexicon(lex));
      void v.renderRest();
    }
  }

  async function reloadLexicon(): Promise<void> {
    try { applyLexicon(await loadLexicon(ctx, book!.id, (lex) => applyLexicon(lex))); } catch (e) { console.error('lexicon', e); }
  }

  // --------------------------------------------------------------- menus
  function togglePinyinMenu(): void {
    if (popoverOpenFor(pinyinBtn)) { closePopover(); return; }
    const m = buildPinyinMenu(ctx);
    menuSync = m.sync;
    openPopover(pinyinBtn, m.el, () => { menuSync = null; });
  }
  function toggleDisplayMenu(): void {
    if (popoverOpenFor(aaBtn)) { closePopover(); return; }
    const m = buildDisplayMenu(ctx);
    menuSync = m.sync;
    openPopover(aaBtn, m.el, () => { menuSync = null; });
  }

  /** Language tag for the text: lets the browser pick regional glyph shapes and the right speech voice. */
  function langOf(s: Settings): string {
    if (s.script === 'traditional') return 'zh-Hant';
    if (s.script === 'simplified') return 'zh-Hans';
    return book!.script === 'traditional' ? 'zh-Hant' : 'zh-Hans';
  }

  /** Build a chapter view for either layout. */
  async function makeView(index: number): Promise<ChapterView | null> {
    const chapter = await store.books.chapter(book!.id, index);
    if (!chapter) return null;
    const v = createChapterView({ ctx, dict, bookId: book!.id, chapter, chapterIndex: index, lexicon, onResize: () => { if (paged) pager?.relayout(); } });
    v.el.lang = langOf(ctx.settings.get());
    return v;
  }

  /** The chapter on screen changed (opened, or the pages turned over a chapter edge). */
  function chapterShown(index: number, v: ChapterView): void {
    if (speaking && index !== chapterIndex) stopChapterSpeech();
    chapterIndex = index;
    lookup.reset();
    titleChapter.textContent = v.title || `Chapter ${index + 1}`;
    // A one-chapter book (a poem, a pasted page) would show its title twice.
    titleChapter.hidden = book!.chapterCount === 1 && titleChapter.textContent === book!.title;
    toc.setCurrent(index);
  }

  // --------------------------------------------------------------- chapters
  async function loadChapter(index: number, at: { block?: number; offset?: number; top?: boolean; end?: boolean } = {}): Promise<void> {
    const seq = ++loadSeq;
    stopChapterSpeech();
    closePopup();
    closePopover();
    saveProgressNow();
    if (paged) {
      if (!pager) return;
      const target = at.end ? 'end' : at.block !== undefined ? { stored: at.block, offset: at.offset } : 'start';
      await pager.open(index, target);
      if (seq !== loadSeq || disposed) return;
      updateProgressUi();
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveProgressNow, 800);
      return;
    }
    const chapter = await store.books.chapter(book!.id, index);
    if (seq !== loadSeq || disposed) return;
    if (!chapter) {
      clear(page);
      page.appendChild(h('div.page', null, h('p.muted', null, 'This chapter could not be loaded.'),
        h('a.btn', { href: '#/' }, icon('arrowLeft'), 'Back to the library')));
      return;
    }
    scrollView?.dispose();
    const v = createChapterView({ ctx, dict, bookId: book!.id, chapter, chapterIndex: index, lexicon });
    scrollView = v;
    v.el.lang = langOf(ctx.settings.get());
    clear(page);
    page.append(v.el, buildEnd(index));
    chapterShown(index, v);

    const target = at.block !== undefined ? clamp(at.block + v.synthetic, 0, v.blocks.length - 1) : 0;
    // Render down to the target, then about two screens past it; the rest follows in idle time.
    let last = target;
    let chars = 0;
    while (last < v.blocks.length - 1 && chars < 1400) { last++; chars += v.blocks[last].text.length || 40; }
    v.renderTo(last);
    window.scrollTo(0, 0);
    if (at.block !== undefined && target > 0) scrollToBlock(v.blocks[target]);
    if (at.end) {
      v.renderTo(v.blocks.length - 1);
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
    updateProgressUi();
    // Record the new position even if the reader leaves without scrolling.
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveProgressNow, 800);
    void v.renderRest().then(() => { if (scrollView === v) updateProgressUi(); });
  }

  function buildEnd(index: number): HTMLElement {
    const last = index >= book!.chapterCount - 1;
    const el = h('footer.rd-end', { 'data-rd-ui': '' });
    if (index > 0) {
      el.appendChild(h('button.btn.rd-end-prev', { type: 'button', onclick: () => void loadChapter(index - 1, { top: true }) }, icon('chevronLeft'), 'Previous chapter'));
    }
    if (last) {
      el.append(h('p.rd-end-note', null, 'You have reached the end.'),
        h('a.btn.btn-primary', { href: '#/' }, icon('library'), 'Back to the library'));
    } else {
      el.appendChild(h('button.btn.btn-primary.rd-end-next', { type: 'button', onclick: () => void loadChapter(index + 1, { top: true }) }, 'Next chapter', icon('chevronRight')));
    }
    return el;
  }

  // ----------------------------------------------------------- switching layout
  /** Where the reader is, in terms that survive a change of layout. */
  function currentPlace(): Place | null {
    const v = view();
    if (!v) return null;
    if (paged) {
      const a = pager?.anchor();
      return a ? { chapter: chapterIndex, block: Math.max(0, a.block - v.synthetic), offset: a.offset } : null;
    }
    const b = firstVisible();
    return { chapter: chapterIndex, block: Math.max(0, (b?.index ?? 0) - v.synthetic), offset: 0 };
  }

  function enterPaged(): void {
    paged = true;
    document.documentElement.classList.add('rd-lock');
    rd.classList.add('rd-paged');
    clear(page);
    page.hidden = true;
    scrollView?.dispose();
    scrollView = null;
    pager = createPager({
      root: rd, ctx, book: book!, makeView,
      onChapter: (i, v) => chapterShown(i, v),
      onMove: () => { updateProgressUi(); window.clearTimeout(saveTimer); saveTimer = window.setTimeout(saveProgressNow, 600); },
      onTurnStart: () => {
        closePopup();
        closePopover();
        window.getSelection()?.removeAllRanges();
        setChrome(false);
      },
      isBusy: () => { const sel = window.getSelection(); return !!sel && !sel.isCollapsed && !!view()?.el.contains(sel.anchorNode); },
      onEnd: () => ctx.toast('You have reached the end of the book.'),
    });
    if (scanning) pager.holdNeighbors(true);
    rd.appendChild(pager.stage);
    setChrome(true);
  }

  function leavePaged(): void {
    paged = false;
    document.documentElement.classList.remove('rd-lock');
    rd.classList.remove('rd-paged', 'rd-chrome-off');
    pager?.dispose();
    pager = null;
    page.hidden = false;
  }

  async function switchLayout(): Promise<void> {
    const want = ctx.settings.get().layout === 'pages';
    if (want === paged) return;
    const place = currentPlace() ?? (saved ? { chapter: saved.chapter, block: saved.block, offset: 0 } : { chapter: 0, block: 0, offset: 0 });
    stopChapterSpeech();
    closePopup();
    saveProgressNow();
    if (want) enterPaged(); else leavePaged();
    applyLayout(ctx.settings.get());
    await loadChapter(place.chapter, place.block > 0 || place.offset > 0 ? { block: place.block, offset: place.offset } : { top: true });
  }

  // ---------------------------------------------------------------- chrome
  function setChrome(on: boolean): void {
    rd.classList.toggle('rd-chrome-off', paged && !on);
  }
  function toggleChrome(): void {
    setChrome(rd.classList.contains('rd-chrome-off'));
  }

  // ---------------------------------------------------------------- progress
  function scrollToBlock(b: BlockState): void {
    const top = b.el.getBoundingClientRect().top + window.scrollY - BAR_H - 16;
    window.scrollTo(0, Math.max(0, top));
  }

  function ensureInView(b: BlockState, start: number): void {
    const r = view()?.rectOf(b, start, start + 1);
    if (!r) return;
    const vh = window.innerHeight;
    if (r.top < BAR_H + 24 || r.bottom > vh - (speaking ? 90 : 24)) window.scrollBy({ top: r.top - vh * 0.3, behavior: 'instant' as ScrollBehavior });
  }

  function firstVisible(): BlockState | null {
    const v = scrollView;
    if (!v) return null;
    const blocks = v.blocks;
    let lo = 0;
    let hi = blocks.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (blocks[mid].el.getBoundingClientRect().bottom > BAR_H + 2) hi = mid;
      else lo = mid + 1;
    }
    return blocks[lo] ?? null;
  }

  function percent(): number {
    if (paged) return pager?.percent() ?? 0;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    const frac = max > 4 ? clamp(window.scrollY / max, 0, 1) : 1;
    const start = book!.chapterOffsets[chapterIndex] ?? 0;
    const end = book!.chapterOffsets[chapterIndex + 1] ?? book!.charCount;
    return book!.charCount > 0 ? clamp((start + (end - start) * frac) / book!.charCount, 0, 1) : 0;
  }

  let uiRaf = 0;
  function updateProgressUi(): void {
    if (uiRaf) return;
    uiRaf = requestAnimationFrame(() => {
      uiRaf = 0;
      const p = percent();
      fill.style.width = `${(p * 100).toFixed(1)}%`;
      pct.textContent = `${Math.floor(p * 100)}%`;
    });
  }

  let saveTimer = 0;
  function saveProgressNow(): void {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    const v = view();
    if (!v) return;
    let block: number;
    let offset = 0;
    if (paged) {
      const a = pager?.anchor();
      block = Math.max(0, (a?.block ?? 0) - v.synthetic);
      offset = a && a.block >= v.synthetic ? a.offset : 0;
    } else block = Math.max(0, (firstVisible()?.index ?? 0) - v.synthetic);
    const p: Progress = { bookId: book!.id, chapter: chapterIndex, block, percent: percent(), updatedAt: Date.now() };
    if (offset > 0) p.offset = offset;
    void store.progress.set(p).catch(() => {});
  }
  const onScroll = () => {
    if (paged) return;
    updateProgressUi();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveProgressNow, 600);
  };

  // ------------------------------------------------------------------ events
  const inArticle = (t: EventTarget | null) => !!(t instanceof Node && view()?.el.contains(t));

  const onPointerDown = (e: PointerEvent) => {
    pointerKind = (e.pointerType as typeof pointerKind) || 'mouse';
    popupWasOpen = !!document.querySelector('.pp-pop');
  };
  const onMouseDown = (e: MouseEvent) => {
    dragFromArticle = inArticle(e.target);
    if (!dragFromArticle) return;
    // Stop the browser from selecting a word on double or triple click; we look the word up instead.
    if (e.detail > 1) e.preventDefault();
  };
  const onMouseUp = (e: MouseEvent) => {
    if (e.button !== 0 || !dragFromArticle) return;
    dragFromArticle = false;
    window.setTimeout(() => {
      if (disposed) return;
      if (lookup.processSelection()) {
        suppressClick = true;
        window.setTimeout(() => { suppressClick = false; }, 0);
      }
    }, 0);
  };
  const onClick = (e: MouseEvent) => {
    if (suppressClick) { suppressClick = false; return; }
    if (e.detail > 1) return;
    const target = e.target as Element;
    const w = target.closest?.('.rd-w');
    // A tap outside an open popup closes it. (The popup closes itself on a mouse press, but WebKit reports the click
    // that follows a touch as a mouse click, so a tap would otherwise leave it open.)
    if (popupWasOpen && !w && !target.closest?.('[data-rd-ui], button, a, input, .rd-bar')) {
      popupWasOpen = false;
      closePopup();
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && inArticle(sel.anchorNode)) {
      // A tap with a selection showing only puts the selection away, like a native text view.
      // (Not for a mouse drag: its click arrives before the selection has been turned into a phrase popup.)
      if (!w && pointerKind !== 'mouse' && !document.querySelector('.pp-pop')) sel.removeAllRanges();
      return;
    }
    if (w) {
      window.clearTimeout(hoverTimer);
      if (ctx.settings.get().lookupTrigger === 'hover' && pointerKind === 'mouse') return;
      lookup.openToken(w);
      return;
    }
    // Pages: a tap on the margins and gaps turns the page (outer thirds) or shows and hides the bar (middle).
    if (paged && pager && pager.stage.contains(target) && !target.closest('[data-rd-ui], button, a, input')) {
      if (popupWasOpen) return; // the tap only closed the popup
      if (pager.tapAt(e.clientX) === 'middle') toggleChrome();
    }
  };
  const onDblClick = (e: MouseEvent) => {
    const w = (e.target as Element).closest?.('.rd-w');
    window.getSelection()?.removeAllRanges();
    if (w) { window.clearTimeout(hoverTimer); lookup.openToken(w); }
  };

  let hoverTimer = 0;
  let hoverEl: Element | null = null;
  const onOver = (e: MouseEvent) => {
    if (ctx.settings.get().lookupTrigger !== 'hover' || pointerKind === 'touch' || e.buttons) return;
    const w = (e.target as Element).closest?.('.rd-w');
    if (!w || w === hoverEl) return;
    hoverEl = w;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => { if (hoverEl === w && !disposed) lookup.openToken(w); }, 250);
  };
  const onOut = (e: MouseEvent) => {
    const w = (e.target as Element).closest?.('.rd-w');
    if (w && e.relatedTarget instanceof Node && w.contains(e.relatedTarget)) return;
    window.clearTimeout(hoverTimer);
    hoverEl = null;
  };
  // With the bar tucked away, moving the mouse to the top edge brings it back.
  const onMove = (e: MouseEvent) => {
    if (paged && e.clientY < 36 && pointerKind === 'mouse' && rd.classList.contains('rd-chrome-off')) setChrome(true);
  };

  let selTimer = 0;
  const onSelectionChange = () => {
    if (pointerKind !== 'touch') return;
    window.clearTimeout(selTimer);
    selTimer = window.setTimeout(() => { if (!disposed) lookup.processSelection(); }, 600);
  };

  const onCopy = (e: ClipboardEvent) => {
    const v = view();
    const sel = window.getSelection();
    if (!v || !sel || sel.isCollapsed || !sel.rangeCount || !e.clipboardData) return;
    const range = sel.getRangeAt(0);
    if (!inArticle(range.startContainer) && !inArticle(range.endContainer)) return;
    const spans = rangeToSpans(range, v.textElements());
    if (!spans.length) return;
    e.clipboardData.setData('text/plain', spansText(spans, (el) => v.blocks[Number(el.dataset.b)].text));
    e.preventDefault();
  };

  const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;
  const atTop = () => window.scrollY <= 2;

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return;
    if (toc.isOpen()) return;
    const s = ctx.settings.get();
    switch (e.key) {
      case 'p': case 'P':
        ctx.settings.set({ pinyin: PINYIN_CYCLE[(PINYIN_CYCLE.indexOf(s.pinyin) + 1) % PINYIN_CYCLE.length] });
        break;
      case '[': ctx.settings.set({ [readingFontSizeKey(s)]: s[readingFontSizeKey(s)] - 2 }); break;
      case ']': ctx.settings.set({ [readingFontSizeKey(s)]: s[readingFontSizeKey(s)] + 2 }); break;
      case '?': e.preventDefault(); showShortcuts(); break;
      case 'c': case 'C': e.preventDefault(); toc.open(chapterIndex); break;
      case 'n': case 'N': e.preventDefault(); toc.open(chapterIndex, 'names'); break;
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        if (e.repeat && !paged) break;
        if (paged) {
          if (e.key === ' ' && e.shiftKey) { e.preventDefault(); pager?.prev(); break; }
          e.preventDefault();
          if (e.shiftKey && e.key === 'ArrowRight') pager?.chapter(1);
          else pager?.next();
          break;
        }
        if (e.key === ' ') break;
        if ((e.shiftKey && e.key === 'ArrowRight') || (atBottom() && (e.key === 'PageDown' || e.key === 'ArrowRight'))) {
          if (chapterIndex < book.chapterCount - 1) { e.preventDefault(); void loadChapter(chapterIndex + 1, { top: true }); }
        }
        break;
      case 'ArrowLeft':
      case 'PageUp':
        if (e.repeat && !paged) break;
        if (paged) {
          e.preventDefault();
          if (e.shiftKey && e.key === 'ArrowLeft') pager?.chapter(-1);
          else pager?.prev();
          break;
        }
        if ((e.shiftKey && e.key === 'ArrowLeft') || (atTop() && (e.key === 'PageUp' || e.key === 'ArrowLeft'))) {
          if (chapterIndex > 0) { e.preventDefault(); void loadChapter(chapterIndex - 1, { end: e.key === 'PageUp' }); }
        }
        break;
      case 'Home':
        if (paged) { e.preventDefault(); void loadChapter(chapterIndex, { top: true }); }
        break;
      case 'End':
        if (paged) { e.preventDefault(); void loadChapter(chapterIndex, { end: true }); }
        break;
    }
  };

  const onVisibility = () => { if (document.visibilityState === 'hidden') saveProgressNow(); };

  rd.addEventListener('mousedown', onMouseDown);
  rd.addEventListener('click', onClick);
  rd.addEventListener('dblclick', onDblClick);
  rd.addEventListener('mouseover', onOver);
  rd.addEventListener('mouseout', onOut);
  rd.addEventListener('mousemove', onMove);
  rd.addEventListener('copy', onCopy);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', saveProgressNow);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', updateProgressUi);

  // ------------------------------------------------------------- first open
  const wantCh = params.ch !== undefined ? Number.parseInt(params.ch, 10) : NaN;
  const startPaged = ctx.settings.get().layout === 'pages';
  if (startPaged) enterPaged();
  if (Number.isFinite(wantCh) && wantCh >= 0 && wantCh < book.chapterCount) {
    await loadChapter(wantCh, { top: true });
  } else if (saved && saved.chapter >= 0 && saved.chapter < book.chapterCount) {
    await loadChapter(saved.chapter, { block: saved.block, offset: saved.offset });
  } else {
    await loadChapter(0, { top: true });
  }

  return () => {
    stopChapterSpeech();
    saveProgressNow();
    disposed = true;
    loadSeq++;
    window.clearTimeout(hoverTimer);
    window.clearTimeout(selTimer);
    rd.removeEventListener('mousedown', onMouseDown);
    rd.removeEventListener('click', onClick);
    rd.removeEventListener('dblclick', onDblClick);
    rd.removeEventListener('mouseover', onOver);
    rd.removeEventListener('mouseout', onOut);
    rd.removeEventListener('mousemove', onMove);
    rd.removeEventListener('copy', onCopy);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('selectionchange', onSelectionChange);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', saveProgressNow);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', updateProgressUi);
    unsubSettings();
    unsubStore();
    closePopup();
    closePopover();
    toc.dispose();
    scrollView?.dispose();
    scrollView = null;
    pager?.dispose();
    pager = null;
    document.documentElement.classList.remove('rd-lock');
    document.title = prevTitle;
  };
};
