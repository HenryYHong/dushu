// The reader screen: top bar, chapter text with ruby pinyin, word and phrase lookup, progress.
// Two layouts share everything else: Scroll (one long column) and Pages (paginated like a book, ARCHITECTURE.md 5.7).
// Contract: ARCHITECTURE.md 5.3 and 5.7.
import '../../styles/reader.css';
import type { Dictionary, Lexicon, LexiconEntry, MountFn, PinyinMode, Progress, Settings } from '../../types';
import { readingFontSizeKey } from '../../store/settings';
import { canSpeak, pauseSpeaking, resumeSpeaking, setSpeakingRate, speakSequence, stopSpeaking } from '../../speech/tts';
import { EMPTY_LEXICON, isDetecting, loadLexicon } from '../../core/lexicon';
import { REMOTE_PROGRESS_EVENT, syncBeforeOpen } from '../../core/sync';
import { chapterWords, type ChapterWords } from '../../core/chapterWords';
import { h, clear } from '../dom';
import { icon } from '../icons';
import { closePopup, openWordPopup } from '../popup/popup';
import { isFullscreen, setFullscreen } from '../fullscreen';
import { createChapterView, type BlockState, type ChapterView } from './chapter';
import { applyGridVars, effectiveLineHeight, readingSize } from './grid';
import { createLearning } from './learning';
import { createLookup } from './lookup';
import {
  buildDisplayMenu, buildPinyinMenu, closePopover, openPopover, pinyinModeLabel, popoverOpenFor, showShortcuts,
} from './menus';
import { createPager, type Pager } from './pager';
import { pointToOffset, rangeToSpans, snapToCodePoint, spansText } from './selection';
import { createToc } from './toc';

const BAR_H = 52;
/** A second tap within this long and this far (CSS px) of the first is a double tap. */
const DOUBLE_TAP_MS = 380;
const DOUBLE_TAP_PX = 48;
/** The page lifts for a bottom sheet only after the double-tap window, so the words stay where the finger is. */
const LIFT_HOLD_MS = 400;
const PINYIN_CYCLE: PinyinMode[] = ['off', 'all', 'unknown', 'hsk'];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && !!el.tagName && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** Chapters that failed to show, per book, so a saved position cannot trap the reader on a chapter that never opens. */
const FAIL_KEY = 'dushu.chapter-failures';
function readFails(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(FAIL_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}
function writeFails(f: Record<string, number>): void {
  try { localStorage.setItem(FAIL_KEY, JSON.stringify(f)); } catch { /* private mode: the count lasts this session only */ }
}
const failKey = (bookId: string, chapter: number) => `${bookId}:${chapter}`;
function failCount(bookId: string, chapter: number): number { return readFails()[failKey(bookId, chapter)] ?? 0; }
function bumpFail(bookId: string, chapter: number): number {
  const f = readFails();
  const k = failKey(bookId, chapter);
  f[k] = (f[k] ?? 0) + 1;
  writeFails(f);
  return f[k];
}
function clearFail(bookId: string, chapter: number): void {
  const f = readFails();
  if (failKey(bookId, chapter) in f) { delete f[failKey(bookId, chapter)]; writeFails(f); }
}

/** The one-time hint about how to look things up. */
const COACH_KEY = 'dushu.reader-hint.v1';
function coachSeen(): boolean { try { return localStorage.getItem(COACH_KEY) === '1'; } catch { return true; } }
function coachMark(): void { try { localStorage.setItem(COACH_KEY, '1'); } catch { /* ignore */ } }

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

  // The place read on another device, if the Mac answers quickly.
  await syncBeforeOpen();
  if (!location.hash.startsWith('#/read')) return;
  const saved = await store.progress.get(book.id);
  /** The place last saved (or the one the book opened at). Saving the same place again would make it look newer than a place
   * read since on another device, so it is not saved again. */
  let lastSaved = saved ? { chapter: saved.chapter, block: saved.block, offset: saved.offset ?? 0 } : { chapter: 0, block: 0, offset: 0 };
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
      if (lexiconReady) applyLexicon(lex, true); else lexicon = lex;
      scanDone();
    });
    scanning = isDetecting(book.id);
  } catch (e) { console.error('lexicon', e); }
  lexiconReady = true;

  // ------------------------------------------------------------------ chrome
  // Every string from the book that the bar, the running heads and the lists show follows the script setting, like the text.
  const text = (s: string): string => {
    const mode = ctx.settings.get().script;
    if (mode === 'simplified') return dict.toSimplified(s);
    if (mode === 'traditional') return dict.toTraditional(s);
    return s;
  };
  const titleBook = h('div.rd-book-title', null, text(book.title));
  const titleChapter = h('div.rd-chapter-title');
  const pct = h('span.rd-pct');
  const fill = h('div.rd-progress-fill');
  const pinyinLabel = h('span.rd-pill-label');
  // The 拼 seal: solid while pinyin shows, an outline (朱文) when it is off. The mode follows it ("All", "HSK 3"); on a
  // phone the label is set smaller, and on the narrowest only the HSK level stays beside the seal.
  const pinyinSeal = h('span.rd-seal.zh', { 'aria-hidden': 'true' }, '拼');
  const pinyinBtn = h('button.rd-pill.rd-pinyin-btn', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Pinyin (P)', onclick: () => togglePinyinMenu() },
    pinyinSeal, pinyinLabel) as HTMLButtonElement;
  const aaBtn = h('button.rd-pill.rd-aa-btn', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Display settings', title: 'Display settings', onclick: () => toggleDisplayMenu() },
    h('span.rd-aa', { 'aria-hidden': 'true' }, 'Aa')) as HTMLButtonElement;
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
  const audioSpeed = h('select.rd-audio-speed', { 'aria-label': 'Read-aloud speed', title: 'Read-aloud speed' }) as HTMLSelectElement;
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

  // The Words tab's counts, per chapter, until the names and terms change.
  const chapterWordCache = new Map<number, Promise<ChapterWords>>();
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
  }, {
    text,
    words: {
      load(i) {
        let got = chapterWordCache.get(i);
        if (!got) {
          const lex = lexicon;
          got = store.books.chapter(book.id, i).then((c) => {
            if (!c) throw new Error('This chapter is missing.');
            const texts = c.blocks.flatMap((b) => (b.t === 'p' || b.t === 'h' || b.t === 'quote' ? [b.text] : []));
            return chapterWords(texts, dict, lex, { cancelled: () => disposed });
          });
          got.catch(() => chapterWordCache.delete(i));
          chapterWordCache.set(i, got);
        }
        return got;
      },
      onWord: (w, anchor, chapter) => openWordPopup({
        ctx, word: w.word, reading: w.pinyin, anchor, prev: w.prev, next: w.next,
        lexicon, bookId: book.id, onLexiconChange: () => void reloadLexicon(),
        context: { sentence: w.sentence, bookId: book.id, bookTitle: book.title, chapter },
      }),
    },
  });

  // ------------------------------------------------------------------- state
  let scrollView: ChapterView | null = null;
  let pager: Pager | null = null;
  let paged = false;
  let chapterIndex = 0;
  let loadSeq = 0;
  let disposed = false;
  /** Puts away the first-visit hint's timers and listener (set while the hint shows). */
  let stopCoach: (() => void) | null = null;
  let suppressClick = false;
  let dragFromArticle = false;
  let pointerKind: 'mouse' | 'touch' | 'pen' = 'mouse';
  let popupWasOpen = false;
  let speaking = false;
  let paused = false;
  let audioStarted = false;
  let speechRun = 0;
  let spokenBlock: BlockState | null = null;
  /** The chapter whose error screen is showing, if any. */
  let failing: number | null = null;
  /** The word the keyboard cursor is on, if the reader is choosing words with the keys. */
  let cursor: { bi: number; s: number; e: number } | null = null;
  let cursorEl: HTMLElement | null = null;
  let movingCursor = false;
  /** The last touch tap that opened a word: when, where on the screen, and which word. A second tap close to it is a double tap. */
  let lastTap: { t: number; x: number; y: number; w: Element } | null = null;
  /** How far the Pages stage is lifted so a bottom-sheet popup does not cover the word. */
  let lift = 0;
  let liftTimer = 0;
  let liftWanted: number | null = null;

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

  /**
   * Puts the read-aloud controls back, leaving the speech engine alone: a run that has ended may have ended because a word
   * card's Pronounce took the voice, and stopping again would silence the word.
   */
  function endChapterSpeech(): void {
    speechRun++;
    speaking = false;
    paused = false;
    audioStarted = false;
    spokenBlock?.el.classList.remove('rd-speaking');
    view()?.clearMarks('rd-speaking-word');
    spokenBlock = null;
    syncSpeechButton();
  }

  function stopChapterSpeech(): void {
    const wasSpeaking = speaking;
    endChapterSpeech();
    if (wasSpeaking) stopSpeaking();
  }

  /**
   * Where the Read button starts: the first word that begins on show. Text before it is on a page already turned (Pages would
   * turn back to read it) or under the bar; a word start, as Read from here uses, rather than half a word.
   */
  function speechStart(v: ChapterView): { block: number; offset: number } {
    const a = paged ? pager?.anchor() : null;
    const b = paged ? v.blocks[a?.block ?? 0] : firstVisible();
    if (!b) return { block: 0, offset: 0 };
    const at = paged ? a?.offset ?? 0 : scrollOffsetAtTop(b);
    if (at <= 0) return { block: b.index, offset: 0 };
    v.ensure(b.index);
    const word = b.rendered?.tokens.find(t => t.start >= at && t.kind !== 'punct' && t.kind !== 'space');
    return { block: b.index, offset: word?.start ?? b.text.length };
  }

  async function startChapterSpeech(from?: { block: number; offset: number }): Promise<void> {
    const v = view();
    if (disposed || !v || !canSpeak()) return;
    const here = from ? { block: from.block, offset: snapToCodePoint(v.blocks[from.block]?.text || '', from.offset, -1) } : speechStart(v);
    const start = here.block;
    const offset = here.offset;
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
        // The words as the reader shows them, so the voice is timed word by word where it can be.
        wordStarts: (i) => {
          const b = blocks[i];
          v.ensure(b.index);
          return (b.rendered?.tokens ?? []).filter(t => t.kind === 'han' && t.start >= offsets[i]).map(t => t.start - offsets[i]);
        },
        onStart: () => {
          if (mine !== speechRun || audioStarted) return;
          audioStarted = true;
          syncSpeechButton();
        },
        onWaiting: () => {
          if (mine !== speechRun || !audioStarted) return;
          audioStarted = false;
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
        else if (offsets[i]) {
          // The Read button starts on the top line, often half under the bar: bring it just clear of the bar rather than a
          // third of the way down.
          const r = from ? null : v.rectOf(b, offsets[i], offsets[i] + 1);
          if (r && r.top < BAR_H + 24) scrollToOffset(b, offsets[i], BAR_H + 32);
          else ensureInView(b, offsets[i]);
        } else {
          const r = b.el.getBoundingClientRect();
          if (r.top < BAR_H + 8 || r.top > window.innerHeight * 0.8) scrollToBlock(b);
        }
      }, (i, at, len) => {
        if (mine !== speechRun) return;
        const b = blocks[i];
        // The words the voice is saying: every shown word that overlaps the range it reported.
        const from = offsets[i] + at;
        const to = from + Math.max(1, len);
        const words = (b.rendered?.tokens ?? []).filter(t => t.kind === 'han' && t.start < to && t.end > from);
        if (!words.length) return;
        const start = words[0].start;
        const end = words[words.length - 1].end;
        v.clearMarks('rd-speaking-word');
        v.mark(b, start, end, 'rd-speaking-word');
        if (paged) {
          // Turn to the page that holds the word once it is past the pages on show (a word on the next page sits beside them,
          // not below, so a screen-position test misses it).
          const shown = pager?.shownRange();
          const upTo = (x: { block: number; offset: number }) => x.block < b.index || (x.block === b.index && x.offset <= start);
          if (shown && !(upTo(shown.start) && (!shown.end || !upTo(shown.end)))) pager?.reveal(b.index, start);
        } else ensureInView(b, start);
      });
    } finally {
      if (mine === speechRun) endChapterSpeech();
    }
  }

  // Words learned from reading (settings.autoKnown): what is on screen, and what was looked up.
  let hoverOpening = false;
  const learning = createLearning({ ctx, dict, view, chapterIndex: () => chapterIndex, pager: () => (paged ? pager : null), topInset: BAR_H });

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
    // With the keyboard cursor on, the cursor follows the popup's word, and focus returns to it when the popup closes.
    onWordShown: (b, s, e) => { learning.lookedUp(b.text.slice(s, e), !hoverOpening); if (cursor) setCursor(b, s, e, false); },
    onPhraseShown: (spans) => learning.helped(spans),
    restoreFocus: () => (cursorEl?.isConnected ? cursorEl : null),
    onSheetTop: (top) => liftPage(top),
    liftsPage: () => paged,
  });

  // ------------------------------------------------------------ layout & live updates
  function applyLayout(s: Settings): void {
    // var() resolves where it is declared, so the traditional stacks are named here rather than left to :lang().
    const hant = langOf(s) === 'zh-Hant' ? '-hant' : '';
    const font = s.fontFamily === 'sans' ? `var(--font-sans${hant})` : s.fontFamily === 'kai' ? `var(--font-kai${hant})` : `var(--font-serif${hant})`;
    rd.style.setProperty('--rd-font', font);
    // Traditional fonts draw ， 。 、 ： ； in the middle of the box (the Taiwan convention). The pinyin grid gives a mark half a
    // cell and expects its ink at the left, as simplified fonts draw it, so in a traditional book the marks come from the
    // simplified stack of the same family (rd is not inside the lang="zh-Hant" text, so these resolve to the simplified ones).
    rd.style.setProperty('--rd-pu-font', !hant ? font : s.fontFamily === 'sans' ? 'var(--font-sans)' : s.fontFamily === 'kai' ? 'var(--font-kai)' : 'var(--font-serif)');
    rd.style.setProperty('--rd-size', `${s[readingFontSizeKey(s)]}px`);
    // Pinyin sits in the space between lines, so lines need room for it whenever pinyin can show.
    rd.style.setProperty('--rd-lh', String(effectiveLineHeight(s.lineHeight, s.pinyin)));
    rd.style.setProperty('--rd-width', `${s.pageWidth}px`);
    rd.classList.toggle('rd-py-off', s.pinyin === 'off');
    rd.classList.toggle('rd-grid', s.pinyin !== 'off');
    rd.classList.toggle('rd-zy', s.pinyinStyle === 'zhuyin');
    rd.classList.toggle('rd-pt-on', s.paragraphTranslate);
    rd.classList.toggle('rd-hover-mode', s.lookupTrigger === 'hover');
    // The cell, the pinyin size and the paragraph indent for the grid (both layouts use them).
    if (rd.isConnected) applyGridVars(rd, readingSize(s), s.pinyinStyle);
    const level = s.hskThreshold >= 7 ? '7-9' : String(s.hskThreshold);
    if (s.pinyin === 'hsk') pinyinLabel.replaceChildren(h('span.rd-pill-pre', null, 'HSK '), level);
    else pinyinLabel.textContent = pinyinModeLabel(s.pinyin);
    pinyinBtn.setAttribute('aria-label', `Pinyin: ${pinyinLabel.textContent}`);
    pinyinBtn.dataset.mode = s.pinyin;
    pinyinBtn.dataset.level = level;
  }
  applyLayout(ctx.settings.get());

  /**
   * Run a change that reflows the scrolling page and keep the same line of text where it was under the top bar. The line, not
   * the paragraph: deep in a long paragraph a re-wrap moves the line by however much the text above it grew or shrank. `fn`
   * gets the block at the top, measured before the change, and must draw down to it before returning (the restore measures it).
   */
  function keepPlace(fn: (top: BlockState | null) => void): void {
    const b = scrollView ? firstVisible() : null;
    if (!b) { fn(null); return; }
    const offset = scrollOffsetAtTop(b);
    const lineTop = () => (offset > 0 ? view()?.rectOf(b, offset, offset + 1)?.top : undefined);
    const line = lineTop();
    const blockTop = b.el.getBoundingClientRect().top;
    fn(b);
    if (line !== undefined && lineTop() !== undefined) { scrollToOffset(b, offset, line); return; }
    const d = b.el.getBoundingClientRect().top - blockTop;
    if (Math.abs(d) > 1) window.scrollBy(0, d);
  }

  let menuSync: (() => void) | null = null;

  const LAYOUT_KEYS: (keyof Settings)[] = ['fontSize', 'fontFamily', 'lineHeight', 'pageWidth', 'spread', 'pinyinStyle'];

  const unsubSettings = ctx.settings.subscribe((s, changed) => {
    if (changed.includes('ttsRate')) {
      syncSpeechButton();
      if (speaking) setSpeakingRate(s.ttsRate);
    }
    if (changed.every(key => key === 'ttsRate' || key === 'ttsVoice')) { menuSync?.(); return; }
    const v = view();
    if (changed.includes('script')) refreshChromeText();
    if (changed.includes('layout')) {
      // No re-styling here: switchLayout reads the place first. Under the other layout's text size the text moves, and Scroll
      // measured a line pages further on, Pages the start of the paragraph.
      void switchLayout();
      menuSync?.();
      return;
    }
    if (!v) { applyLayout(s); return; }
    if (paged) {
      // Anything that moves the text: the pager takes the chapter out of the layout first, so the browser does not lay all of
      // it out at the new size at once (that is what froze the page for a second or more).
      const moves = changed.includes('script') || changed.some((k) => LAYOUT_KEYS.includes(k) || k === 'pinyin');
      if (moves) pager?.freeze();
      applyLayout(s);
      if (changed.includes('script')) {
        v.el.lang = langOf(s);
        closePopup();
        clearCursor();
        v.reconvert();
        pager?.dropNeighbors();
        pager?.refresh();
      } else {
        const repaint = changed.some((k) => k === 'pinyinStyle' || k === 'toneColors' || k === 'sandhi');
        const visibility = changed.some((k) => k === 'pinyin' || k === 'hskThreshold');
        if (repaint) v.refreshPinyin();
        if (visibility) v.refreshVisibility();
        if (changed.some((k) => LAYOUT_KEYS.includes(k) || k === 'pinyin')) { closePopup(); pager?.relayout(); }
        else if (repaint || visibility) pager?.invalidate();
      }
      menuSync?.();
      return;
    }
    keepPlace((top) => {
      applyLayout(s);
      if (changed.includes('script')) {
        v.el.lang = langOf(s);
        closePopup();
        // reconvert empties every drawn block. Nothing may measure the page until the blocks down to the place are drawn again:
        // measured empty, the page is short, the browser clamps the scroll and the next save stores a place near the start.
        v.reconvert();
        renderAround(v, top?.index ?? 0);
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
    if (what === 'vocab' || what === 'known') {
      view()?.refreshMarks();
      if (paged) pager?.invalidate();
    }
  });

  // ----------------------------------------------------------- lexicon
  /** Re-segment the chapter with a new lexicon and keep the reading position. */
  const lexKey = (lex: Lexicon) => lex.entries().map((e) => `${e.word}|${e.pinyin}`).join(',');
  let pendingLex: Lexicon | null = null;
  let pendingLexTimer = 0;
  /**
   * `background`: names found by a scan the reader did not ask for (the first open of a book takes a few seconds). Those wait while a
   * word card is open and are applied once it is closed, so the card is not taken away and the page does not redraw under it.
   * (A name the reader edits in a card applies at once, as before.)
   */
  function applyLexicon(lex: Lexicon, background = false): void {
    if (background && !disposed && document.querySelector('.pp-pop') && lexKey(lex) !== lexKey(lexicon)) {
      pendingLex = lex;
      if (!pendingLexTimer) {
        pendingLexTimer = window.setInterval(() => {
          if (disposed) { window.clearInterval(pendingLexTimer); pendingLexTimer = 0; return; }
          if (document.querySelector('.pp-pop')) return;
          window.clearInterval(pendingLexTimer);
          pendingLexTimer = 0;
          const next = pendingLex;
          pendingLex = null;
          if (next) applyLexicon(next);
        }, 300);
      }
      return;
    }
    if (pendingLex && !background) pendingLex = null; // a newer lexicon replaces a waiting one
    // A scan that found nothing new must not redraw the page, close the card the reader is in or drop the cursor.
    const same = lexKey(lex) === lexKey(lexicon);
    lexicon = lex;
    toc.refreshNames();
    if (same) return;
    chapterWordCache.clear();
    toc.refreshWords();
    const v = view();
    if (!v || disposed) return;
    closePopup();
    lookup.reset();
    if (paged) {
      clearCursor();
      pager?.freeze();
      v.setLexicon(lex);
      pager?.dropNeighbors();
      pager?.refresh();
    } else {
      keepPlace(() => v.setLexicon(lex));
      void v.renderRest();
    }
  }

  async function reloadLexicon(): Promise<void> {
    try { applyLexicon(await loadLexicon(ctx, book!.id, (lex) => applyLexicon(lex, true))); } catch (e) { console.error('lexicon', e); }
  }

  // --------------------------------------------------------------- menus
  function togglePinyinMenu(): void {
    if (popoverOpenFor(pinyinBtn)) { closePopover(); return; }
    const m = buildPinyinMenu(ctx, () => {
      const el = view()?.el;
      return el ? { words: el.querySelectorAll('.rd-w').length, shown: el.querySelectorAll('.rd-w:not(.rd-nopy)').length } : null;
    });
    menuSync = m.sync;
    openPopover(pinyinBtn, m.el, () => { menuSync = null; }, { label: 'Pinyin' });
  }
  function toggleDisplayMenu(): void {
    if (popoverOpenFor(aaBtn)) { closePopover(); return; }
    const m = buildDisplayMenu(ctx);
    menuSync = m.sync;
    openPopover(aaBtn, m.el, () => { menuSync = null; }, { label: 'Display settings' });
  }

  /** Language tag for the text: lets the browser pick regional glyph shapes and the right speech voice. */
  function langOf(s: Settings): string {
    if (s.script === 'traditional') return 'zh-Hant';
    if (s.script === 'simplified') return 'zh-Hans';
    return book!.script === 'traditional' ? 'zh-Hant' : 'zh-Hans';
  }

  /** Build a chapter view for the Pages layout (its pinyin is drawn near the eye only: `lazyPinyin`). */
  async function makeView(index: number): Promise<ChapterView | null> {
    const chapter = await store.books.chapter(book!.id, index);
    if (!chapter) return null;
    const v = createChapterView({
      ctx, dict, bookId: book!.id, chapter, chapterIndex: index, lexicon, lazyPinyin: true,
      onResize: () => { if (paged) pager?.relayout(); },
    });
    v.el.lang = langOf(ctx.settings.get());
    return v;
  }

  const chapterTitleText = (index: number, v?: ChapterView | null): string =>
    text(v?.title || book!.chapterTitles?.[index] || `Chapter ${index + 1}`);

  /** The chapter on screen changed (opened, or the pages turned over a chapter edge). */
  function chapterShown(index: number, v: ChapterView): void {
    if (speaking && index !== chapterIndex) stopChapterSpeech();
    chapterIndex = index;
    failing = null;
    lookup.reset();
    clearCursor();
    titleChapter.textContent = chapterTitleText(index, v);
    // A one-chapter book (a poem, a pasted page) would show its title twice.
    titleChapter.hidden = book!.chapterCount === 1 && titleChapter.textContent === text(book!.title);
    toc.setCurrent(index);
  }

  /** The script setting changed: the bar, the contents list and the names follow it. */
  function refreshChromeText(): void {
    titleBook.textContent = text(book!.title);
    const v = view();
    if (failing !== null) titleChapter.textContent = chapterTitleText(failing);
    else if (v) {
      titleChapter.textContent = chapterTitleText(chapterIndex, v);
      titleChapter.hidden = book!.chapterCount === 1 && titleChapter.textContent === text(book!.title);
    }
    toc.refreshText();
  }

  // ------------------------------------------------------------ chapter errors
  function clearChapterError(): void {
    failing = null;
    rd.querySelector('.rd-fail')?.remove();
  }

  /**
   * A chapter that cannot be shown gets a plain message and the way out, not a blank page: the neighbors, the contents list,
   * and (while it may still work) another try. Keys turn chapters here too.
   */
  function showChapterError(index: number, err: unknown): void {
    console.error('Could not display chapter', index, err);
    failing = index;
    chapterIndex = index;
    stopChapterSpeech();
    closePopup();
    clearCursor();
    toc.setCurrent(index);
    titleChapter.textContent = chapterTitleText(index);
    titleChapter.hidden = false;
    const tries = failCount(book!.id, index);
    const last = index >= book!.chapterCount - 1;
    const actions = h('div.rd-fail-actions', null,
      index > 0 ? h('button.btn', { type: 'button', onclick: () => void loadChapter(index - 1, { top: true }) }, icon('chevronLeft'), 'Previous chapter') : null,
      last ? null : h('button.btn', { type: 'button', onclick: () => void loadChapter(index + 1, { top: true }) }, 'Next chapter', icon('chevronRight')),
      h('button.btn.btn-primary', { type: 'button', onclick: () => toc.open(index) }, icon('list'), 'Open chapter list'),
      tries < 2 ? h('button.btn', { type: 'button', onclick: () => void loadChapter(index, { top: true }) }, icon('refresh'), 'Try again') : null,
      h('a.btn', { href: '#/' }, icon('arrowLeft'), 'Back to the library'));
    const box = h('div.rd-fail', { role: 'alert' },
      h('h2', null, 'Could not display this chapter'),
      h('p', null, `${chapterTitleText(index)} did not draw. Your place in the book is kept. You can read another chapter now.`),
      actions);
    rd.querySelector('.rd-fail')?.remove();
    if (paged) rd.appendChild(box);
    else { clear(page); page.appendChild(box); }
    (box.querySelector('button.btn-primary') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  // --------------------------------------------------------------- chapters
  async function loadChapter(index: number, at: { block?: number; offset?: number; top?: boolean; end?: boolean } = {}): Promise<void> {
    const seq = ++loadSeq;
    stopChapterSpeech();
    closePopup();
    closePopover();
    clearCursor();
    saveProgressNow();
    learning.restart();
    try {
      clearChapterError();
      if (paged) {
        if (!pager) return;
        const target = at.end ? 'end' : at.block !== undefined ? { stored: at.block, offset: at.offset } : 'start';
        await pager.open(index, target);
        if (seq !== loadSeq || disposed) return;
        clearFail(book!.id, index);
        updateProgressUi();
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(saveProgressNow, 800);
        return;
      }
      await loadScrollChapter(index, at, seq);
    } catch (e) {
      if (seq !== loadSeq || disposed) return;
      bumpFail(book!.id, index);
      showChapterError(index, e);
    }
  }

  async function loadScrollChapter(index: number, at: { block?: number; offset?: number; top?: boolean; end?: boolean }, seq: number): Promise<void> {
    const chapter = await store.books.chapter(book!.id, index);
    if (seq !== loadSeq || disposed) return;
    if (!chapter) throw new Error('The chapter is not in the library.');
    const old = scrollView;
    const v = createChapterView({ ctx, dict, bookId: book!.id, chapter, chapterIndex: index, lexicon });
    v.el.lang = langOf(ctx.settings.get());
    v.el.tabIndex = 0;
    v.el.setAttribute('aria-label', 'Book text. Press Enter to choose words with the arrow keys.');
    const place = at.block !== undefined ? v.fromStored(at.block, at.offset ?? 0) : { block: 0, offset: 0 };
    const target = clamp(place.block, 0, v.blocks.length - 1);
    renderAround(v, target);
    if (at.end) v.renderTo(v.blocks.length - 1);
    // Nothing above can throw after this point, so the old chapter is replaced only by one that drew.
    scrollView = v;
    old?.dispose();
    clear(page);
    page.append(v.el, buildEnd(index));
    chapterShown(index, v);
    clearFail(book!.id, index);
    window.scrollTo(0, 0);
    // The first stored block is right under the chapter title (a synthetic block): its top is the top of the chapter, title in view.
    if (at.block !== undefined && target > v.synthetic) scrollToBlock(v.blocks[target]);
    if (at.block !== undefined && place.offset > 0) scrollToOffset(v.blocks[target], place.offset);
    if (at.end) window.scrollTo(0, document.documentElement.scrollHeight);
    updateProgressUi();
    // Record the new position even if the reader leaves without scrolling.
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveProgressNow, 800);
    void v.renderRest().then(() => { if (scrollView === v) updateProgressUi(); });
  }

  /** Draw down to block `target` and about two screens past it now; the rest follows in idle time (renderRest). */
  function renderAround(v: ChapterView, target: number): void {
    let last = target;
    let chars = 0;
    while (last < v.blocks.length - 1 && chars < 1400) { last++; chars += v.blocks[last].text.length || 40; }
    v.renderTo(last);
  }

  function buildEnd(index: number): HTMLElement {
    const last = index >= book!.chapterCount - 1;
    const el = h('footer.rd-end', { 'data-rd-ui': '' });
    if (index > 0) {
      el.appendChild(h('button.btn.rd-end-prev', { type: 'button', onclick: () => void loadChapter(index - 1, { top: true }) }, icon('chevronLeft'), 'Previous chapter'));
    }
    el.appendChild(h('button.btn.rd-end-words', { type: 'button', onclick: () => toc.open(index, 'words') }, icon('list'), 'Words in this chapter'));
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
      if (!a) return null;
      const at = v.toStored(a.block, a.offset);
      return { chapter: chapterIndex, block: at.block, offset: at.offset };
    }
    const b = firstVisible();
    if (!b) return { chapter: chapterIndex, block: 0, offset: 0 };
    const at = v.toStored(b.index, scrollOffsetAtTop(b));
    return { chapter: chapterIndex, block: at.block, offset: at.offset };
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
      onPaginated: () => updateProgressUi(),
      onTurnStart: () => {
        closePopup();
        closePopover();
        window.getSelection()?.removeAllRanges();
        if (!movingCursor) clearCursor();
        setChrome(false);
      },
      isBusy: () => { const sel = window.getSelection(); return !!sel && !sel.isCollapsed && !!view()?.el.contains(sel.anchorNode); },
      onEnd: () => ctx.toast('You have reached the end of the book.'),
      onChapterError: (i, e) => { bumpFail(book!.id, i); showChapterError(i, e); },
      text,
      onChapterWords: (i) => toc.open(i, 'words'),
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
    if (want === paged) { applyLayout(ctx.settings.get()); return; }
    // Measured while the text still has the old layout's styles (applyLayout comes after), as is the save below.
    const place = currentPlace() ?? { ...lastSaved };
    stopChapterSpeech();
    closePopup();
    clearCursor();
    clearChapterError();
    saveProgressNow();
    lift = 0;
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

  /** Offset of the first character of a block that is under the top bar, so a reload comes back to the line and not the paragraph. */
  function scrollOffsetAtTop(b: BlockState): number {
    const y = BAR_H + 4;
    if (b.el.getBoundingClientRect().top >= y) return 0;
    const rubies = b.el.querySelectorAll<HTMLElement>('ruby.rd-c');
    let lo = 0;
    let hi = rubies.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rubies[mid].getBoundingClientRect().bottom > y) { found = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return found < 0 ? 0 : Number(rubies[found].dataset.o) || 0;
  }

  /** Scroll so the line holding `offset` of a block is at `y`: by default just under the top bar. */
  function scrollToOffset(b: BlockState, offset: number, y = BAR_H + 16): void {
    const r = view()?.rectOf(b, offset, offset + 1);
    if (r) window.scrollBy(0, r.top - y);
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
    // A chapter that failed to show must not overwrite the place the reader had.
    if (!v || failing !== null) return;
    let block: number;
    let offset = 0;
    if (paged) {
      const a = pager?.anchor();
      if (!a) return; // the pages are being set: keep the place that is saved
      const at = v.toStored(a.block, a.offset);
      block = at.block;
      offset = at.offset;
    } else {
      const b = firstVisible();
      const at = v.toStored(b?.index ?? 0, b ? scrollOffsetAtTop(b) : 0);
      block = at.block;
      offset = at.offset;
    }
    if (lastSaved.chapter === chapterIndex && lastSaved.block === block && lastSaved.offset === offset) return;
    lastSaved = { chapter: chapterIndex, block, offset };
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
    // Pointing at the page ends keyboard word choosing.
    if (cursor && !(e.target instanceof Element && e.target.closest('.pp-pop'))) clearCursor(false);
  };
  const onMouseDown = (e: MouseEvent) => {
    dragFromArticle = inArticle(e.target);
    // Stop the browser from selecting a word on a double or triple click: on a word we look it up instead, and quick clicks
    // anywhere on the pages turn them (Chrome would otherwise select the word nearest the margin and swallow the turn).
    const onPages = paged && !!pager && e.target instanceof Node && pager.stage.contains(e.target);
    if (e.detail > 1 && (dragFromArticle || onPages)) e.preventDefault();
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
    const touchy = pointerKind !== 'mouse';
    const target = e.target as Element;
    const w = target.closest?.('.rd-w');
    // A double click on a word looks that word up (onDblClick). Quick clicks on the outer strips of a page each turn a page:
    // the browser counts them as double and triple clicks, which used to swallow every click after the first.
    const edgeClick = paged && !!pager && !w && pager.stage.contains(target)
      && !target.closest('[data-rd-ui], button, a, input, .pp-pop') && pager.zoneAt(e.clientX) !== 'middle';
    if (e.detail > 1 && !touchy && !edgeClick) return;
    // A tap outside an open popup closes it. (The popup closes itself on a mouse press, but WebKit reports the click
    // that follows a touch as a mouse click, so a tap would otherwise leave it open.)
    if (popupWasOpen && !w && !target.closest?.('[data-rd-ui], button, a, input, .rd-bar')) {
      popupWasOpen = false;
      closePopup();
      return;
    }
    const sel = window.getSelection();
    if (!edgeClick && sel && !sel.isCollapsed && inArticle(sel.anchorNode)) {
      // A tap with a selection showing only puts the selection away, like a native text view.
      // (Not for a mouse drag: its click arrives before the selection has been turned into a phrase popup.)
      if (!w && pointerKind !== 'mouse' && !document.querySelector('.pp-pop')) sel.removeAllRanges();
      return;
    }
    const inStage = paged && !!pager && pager.stage.contains(target) && !target.closest('[data-rd-ui], button, a, input, .pp-pop');
    // Pages, touch or pen: a tap on the blank margin of the outer strips turns the page. A tap on the text never does, since
    // reaching for a word near the edge used to turn the page instead: a word opens its card wherever it is, and the rest of a
    // text line (punctuation, the gap between lines) shows or hides the bar. Swipes turn the page from anywhere.
    const onText = !!target.closest?.('.rd-b');
    if (inStage && touchy && !onText && pager!.zoneAt(e.clientX) !== 'middle') {
      if (popupWasOpen) { popupWasOpen = false; closePopup(); return; } // the tap only closed the popup
      pager!.tapAt(e.clientX);
      return;
    }
    if (w) {
      window.clearTimeout(hoverTimer);
      if (ctx.settings.get().lookupTrigger === 'hover' && pointerKind === 'mouse') return;
      // Remember the tap: a second one soon after, near the same spot, is a double tap (see onDoubleTap).
      if (touchy) lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY, w };
      lookup.openToken(w);
      return;
    }
    // Pages with a mouse: a click on the margins and gaps turns the page (outer strips) or shows and hides the bar (middle).
    if (inStage) {
      if (popupWasOpen) return; // the tap only closed the popup
      if (touchy && onText) { toggleChrome(); return; }
      if (pager!.tapAt(e.clientX) === 'middle') toggleChrome();
    }
  };
  /**
   * Double tap with a finger or pen: the whole sentence of the word the FIRST tap opened. This runs in the capture phase, before
   * anything under the finger can react, because by the second tap the first tap's card (a bottom sheet, or a card near the word)
   * may be what is under the finger, or the page may have moved. Only the time and the distance on screen decide.
   */
  const onDoubleTap = (e: MouseEvent) => {
    const prev = lastTap;
    if (!prev || pointerKind === 'mouse' || disposed) return;
    if (e.timeStamp - prev.t > DOUBLE_TAP_MS || e.timeStamp < prev.t) { lastTap = null; return; }
    if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) >= DOUBLE_TAP_PX) return;
    lastTap = null;
    if (!prev.w.isConnected) return;
    e.stopPropagation();
    e.preventDefault();
    popupWasOpen = false;
    window.getSelection()?.removeAllRanges();
    lookup.openSentence(prev.w);
  };
  const onDblClick = (e: MouseEvent) => {
    const w = (e.target as Element).closest?.('.rd-w');
    window.getSelection()?.removeAllRanges();
    // With a finger the second tap is already handled in onClick (the browser may not send a dblclick at all).
    if (w && pointerKind === 'mouse') { window.clearTimeout(hoverTimer); lookup.openToken(w); }
  };

  let hoverTimer = 0;
  let hoverEl: Element | null = null;
  const onOver = (e: MouseEvent) => {
    if (ctx.settings.get().lookupTrigger !== 'hover' || pointerKind === 'touch' || e.buttons) return;
    const w = (e.target as Element).closest?.('.rd-w');
    if (!w || w === hoverEl) return;
    hoverEl = w;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      if (hoverEl !== w || disposed) return;
      hoverOpening = true;
      try { lookup.openToken(w); } finally { hoverOpening = false; }
    }, 250);
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

  // ---------------------------------------------------------- keyboard word cursor
  // A reader who cannot point (a keyboard on an iPad, Switch Control, VoiceOver) chooses words with the keys: Enter puts a
  // cursor on the first word of the page, the arrows move it, Enter or Space looks the word up, Escape puts it away.
  function clearCursor(blur = true): void {
    if (cursorEl) {
      cursorEl.classList.remove('rd-cursor');
      cursorEl.removeAttribute('tabindex');
      if (blur && document.activeElement === cursorEl) cursorEl.blur();
    }
    cursor = null;
    cursorEl = null;
  }

  function setCursor(b: BlockState, s: number, e: number, focus: boolean): void {
    const el = b.el.querySelector<HTMLElement>(`.rd-w[data-s="${s}"]`);
    if (!el) return;
    if (cursorEl && cursorEl !== el) { cursorEl.classList.remove('rd-cursor'); cursorEl.removeAttribute('tabindex'); }
    cursor = { bi: b.index, s, e };
    cursorEl = el;
    el.classList.add('rd-cursor');
    el.setAttribute('tabindex', '-1');
    if (focus) el.focus({ preventScroll: true });
  }

  function startCursor(): boolean {
    const v = view();
    if (!v) return false;
    let found: { b: BlockState; s: number; e: number } | null = null;
    if (paged) {
      const a = pager?.anchor();
      found = lookup.nextWord(a?.block ?? 0, a?.offset ?? 0, 1);
    } else {
      const b = firstVisible();
      let at = b ? lookup.nextWord(b.index, 0, 1) : null;
      for (let n = 0; at && n < 600; n++) {
        const r = v.rectOf(at.b, at.s, at.e);
        if (!r || r.top >= BAR_H + 4) break;
        at = lookup.nextWord(at.b.index, at.e, 1);
      }
      found = at;
    }
    if (!found) return false;
    setCursor(found.b, found.s, found.e, true);
    return true;
  }

  function moveCursor(dir: -1 | 1, byLine = false): void {
    const v = view();
    if (!v || !cursor) return;
    let at = lookup.nextWord(cursor.bi, dir > 0 ? cursor.e : cursor.s, dir);
    if (byLine && at) {
      // To the same place on the next or the previous line: step on until the line changes, then until the word is under the old x.
      const start = v.rectOf(v.blocks[cursor.bi], cursor.s, cursor.e);
      const x = start ? start.left + start.width / 2 : 0;
      let lineTop: number | null = null;
      for (let n = 0; at && start && n < 400; n++) {
        const r = v.rectOf(at.b, at.s, at.e);
        if (r && Math.abs(r.top - start.top) > start.height * 0.6) {
          if (lineTop === null) lineTop = r.top;
          const passed = dir > 0 ? r.left + r.width / 2 >= x : r.left + r.width / 2 <= x;
          if (Math.abs(r.top - lineTop) > start.height * 0.6 || passed) break;
        }
        const nx = lookup.nextWord(at.b.index, dir > 0 ? at.e : at.s, dir);
        if (!nx) break;
        at = nx;
      }
    }
    if (!at) {
      if (paged && dir > 0) pager?.next();
      else if (paged && dir < 0) pager?.prev();
      return;
    }
    movingCursor = true;
    try {
      if (paged) pager?.reveal(at.b.index, at.s);
      else ensureInView(at.b, at.s);
    } finally { movingCursor = false; }
    setCursor(at.b, at.s, at.e, true);
  }

  /** Slide the stage up while a bottom-sheet popup covers the lower part of the page, so the word it is about stays in view. */
  function liftPage(top: number | null): void {
    const stage = pager?.stage;
    window.clearTimeout(liftTimer);
    liftWanted = top;
    if (!stage) return;
    if (top === null) {
      lift = 0;
      stage.style.transform = '';
      return;
    }
    // Hold the lift until a second tap could no longer be coming: the word stays under the finger for the double tap.
    const wait = lastTap ? lastTap.t + LIFT_HOLD_MS - performance.now() : 0;
    if (wait > 0) {
      liftTimer = window.setTimeout(() => { if (!disposed && liftWanted !== null) liftPage(liftWanted); }, wait);
      return;
    }
    const mark = stage.querySelector<HTMLElement>('.rd-c.rd-active, .rd-c.rd-sel');
    const r = mark?.getBoundingClientRect();
    if (!r) return;
    // Lift until the word's bottom clears the sheet, by as much as it takes: the only limit is the word itself, whose pinyin must not
    // go up under the top bar. (The old limit, a fixed distance below the bar, held the lift at about 210 px on an iPad in landscape, where
    // the sheet starts at 300 to 450 px, and left a word in the lower third under the sheet.)
    const barBottom = Math.max(0, bar.getBoundingClientRect().bottom);
    const ceiling = r.top + lift - (barBottom + r.height * 0.5 + 6);
    const want = Math.max(0, Math.min(r.bottom + lift + 14 - top, ceiling));
    if (Math.abs(want - lift) < 1) return;
    lift = want;
    stage.style.transition = 'transform 0.2s ease';
    stage.style.transform = want ? `translateY(${-Math.round(want)}px)` : '';
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('dialog[open]')) return;
    if (toc.isOpen()) return;
    const s = ctx.settings.get();
    const popupOpen = !!document.querySelector('.pp-pop');
    const onControl = e.target instanceof Element && !!e.target.closest('button, a, select, [role="dialog"], [role="menu"], .rd-pop');
    // The error screen: the keys that turn chapters still do (its own buttons do not use the arrow keys).
    if (failing !== null && (!onControl || (e.target instanceof Element && !!e.target.closest('.rd-fail')))) {
      if ((e.key === 'ArrowLeft' || e.key === 'PageUp') && failing > 0) { e.preventDefault(); void loadChapter(failing - 1, { top: true }); return; }
      if ((e.key === 'ArrowRight' || e.key === 'PageDown') && failing < book.chapterCount - 1) { e.preventDefault(); void loadChapter(failing + 1, { top: true }); return; }
    }
    if (cursor && !popupOpen) {
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); moveCursor(1); return;
        case 'ArrowLeft': e.preventDefault(); moveCursor(-1); return;
        case 'ArrowDown': e.preventDefault(); moveCursor(1, true); return;
        case 'ArrowUp': e.preventDefault(); moveCursor(-1, true); return;
        case 'Enter': case ' ':
          if (cursorEl) { e.preventDefault(); lookup.openToken(cursorEl); }
          return;
        case 'Escape': e.preventDefault(); clearCursor(); return;
        default: break;
      }
    } else if (e.key === 'Enter' && !popupOpen && !onControl && failing === null) {
      if (startCursor()) e.preventDefault();
      return;
    }
    switch (e.key) {
      case 'p': case 'P':
        ctx.settings.set({ pinyin: PINYIN_CYCLE[(PINYIN_CYCLE.indexOf(s.pinyin) + 1) % PINYIN_CYCLE.length] });
        break;
      case '[': ctx.settings.set({ [readingFontSizeKey(s)]: s[readingFontSizeKey(s)] - 2 }); break;
      case ']': ctx.settings.set({ [readingFontSizeKey(s)]: s[readingFontSizeKey(s)] + 2 }); break;
      case '?': e.preventDefault(); showShortcuts(); break;
      case 'f': case 'F': e.preventDefault(); void setFullscreen(!isFullscreen()).catch(() => {}); break;
      case 'c': case 'C': e.preventDefault(); toc.open(chapterIndex); break;
      case 'n': case 'N': e.preventDefault(); toc.open(chapterIndex, 'names'); break;
      case 'w': case 'W': e.preventDefault(); toc.open(chapterIndex, 'words'); break;
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        if (onControl && e.key === ' ') break;
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
  // Another device read this book further (or elsewhere): offer to go there, never move the page by itself.
  const onRemoteProgress = (e: Event) => {
    const { bookId, progress: p } = (e as CustomEvent<{ bookId: string; progress: Progress }>).detail ?? {};
    if (bookId !== book!.id || !p) return;
    const here = currentPlace();
    if (here && here.chapter === p.chapter && here.block === p.block && here.offset === (p.offset ?? 0)) return;
    ctx.toast(`On another device you are ${Math.round(p.percent * 100)}% through this book.`, {
      ms: 12000,
      action: { label: 'Go there', run: () => void loadChapter(p.chapter, p.block > 0 || (p.offset ?? 0) > 0 ? { block: p.block, offset: p.offset } : { top: true }) },
    });
  };

  rd.addEventListener('mousedown', onMouseDown);
  rd.addEventListener('click', onClick);
  rd.addEventListener('dblclick', onDblClick);
  rd.addEventListener('mouseover', onOver);
  rd.addEventListener('mouseout', onOut);
  rd.addEventListener('mousemove', onMove);
  rd.addEventListener('copy', onCopy);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onDoubleTap, true);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('keydown', onKey);
  // The page itself (the Scroll text or the Pages stage) shows a focus ring only when Tab brought focus to it. A word card
  // closed with Esc hands focus back to it from code, and that must not frame the whole page (reader.css, data-tabbed).
  let lastKeyTab = false;
  const onAnyKey = (e: KeyboardEvent) => { lastKeyTab = e.key === 'Tab'; };
  const onAnyPointer = () => { lastKeyTab = false; };
  const onFocusIn = (e: FocusEvent) => {
    const t = e.target as HTMLElement | null;
    if (t?.matches?.('.rd-article, .rd-stage')) t.toggleAttribute('data-tabbed', lastKeyTab);
  };
  window.addEventListener('keydown', onAnyKey, true);
  window.addEventListener('pointerdown', onAnyPointer, true);
  rd.addEventListener('focusin', onFocusIn);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', saveProgressNow);
  window.addEventListener(REMOTE_PROGRESS_EVENT, onRemoteProgress);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', updateProgressUi);

  // ------------------------------------------------------------- first open
  const wantCh = params.ch !== undefined ? Number.parseInt(params.ch, 10) : NaN;
  const startPaged = ctx.settings.get().layout === 'pages';
  if (startPaged) enterPaged();
  const startAt = Number.isFinite(wantCh) && wantCh >= 0 && wantCh < book.chapterCount ? wantCh
    : saved && saved.chapter >= 0 && saved.chapter < book.chapterCount ? saved.chapter : 0;
  if (failCount(book.id, startAt) >= 2) {
    // This chapter failed to show twice: opening it a third time would only trap the reader on it. Offer the list instead.
    showChapterError(startAt, new Error('This chapter failed to show twice.'));
    toc.open(startAt);
  } else if (startAt === wantCh) {
    await loadChapter(startAt, { top: true });
  } else if (saved && startAt === saved.chapter) {
    await loadChapter(saved.chapter, { block: saved.block, offset: saved.offset });
  } else {
    await loadChapter(0, { top: true });
  }
  if (!disposed && failing === null) showReaderHint();

  /** The first time a book is opened on this device: how to look things up, once. */
  function showReaderHint(): void {
    if (coachSeen()) return;
    const touch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;
    const lines: (string | Node)[][] = [
      [touch
        ? 'Tap a word to look it up. Tap twice for the whole sentence and its translation, or press and hold to select your own words.'
        : 'Click a word to look it up. Drag across text to select a sentence and translate it. Press Enter to choose words with the keys.'],
      // The seal as the bar draws it, so the button is easy to find.
      [touch ? 'Tap ' : 'Click ', h('span.rd-seal.zh', null, '拼'), touch ? ' at the top' : ' at the top (or press P)',
        " to show pinyin on every word, on words you don't know yet, or only above your HSK level."],
    ];
    const s = ctx.settings.get();
    if (s.pinyin === 'unknown' && store.known.count() === 0) {
      lines.push(['Pinyin shows on every word until you mark words as known. Mark one in its card, and it goes away.']);
    }
    const stop = () => {
      document.removeEventListener('pointerdown', close, true);
      window.clearTimeout(timer);
      window.clearTimeout(arm);
      stopCoach = null;
    };
    const close = () => {
      coachMark();
      stop();
      box.remove();
    };
    const box = h('div.rd-coach', { role: 'note', 'data-rd-ui': '' },
      h('div', null, lines.map((l) => h('p', null, ...l))),
      h('button.btn.btn-sm', { type: 'button', onclick: close }, 'Got it'));
    rd.appendChild(box);
    const timer = window.setTimeout(close, 20000);
    // The first tap anywhere puts it away (and still does what the tap was for).
    const arm = window.setTimeout(() => document.addEventListener('pointerdown', close, true), 600);
    // Leaving the reader takes its timers and listener with it (the hint shows again next time).
    stopCoach = stop;
  }

  return () => {
    stopCoach?.();
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
    document.removeEventListener('click', onDoubleTap, true);
    window.clearTimeout(liftTimer);
    window.clearInterval(pendingLexTimer);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('selectionchange', onSelectionChange);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('keydown', onAnyKey, true);
    window.removeEventListener('pointerdown', onAnyPointer, true);
    rd.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', saveProgressNow);
    window.removeEventListener(REMOTE_PROGRESS_EVENT, onRemoteProgress);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', updateProgressUi);
    unsubSettings();
    unsubStore();
    learning.dispose();
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
