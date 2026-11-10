// The chapter drawer's Words tab: the words of a chapter you do not know yet, the most frequent first, with how much of the
// chapter you already know. Each row opens the word card (with the sentence the word first occurs in); its star saves the
// word to the flashcards and its check marks it known. Rows stay put when a word is saved or marked known, so a slip is
// one tap to undo; the list is sorted again when the filter changes. ARCHITECTURE.md 5.3.
import type { AppContext, BookMeta } from '../../types';
import { wordShare, type ChapterWord, type ChapterWords } from '../../core/chapterWords';
import { formatSyllable } from '../../core/pinyin';
import { h } from '../dom';
import { icon } from '../icons';
import { glossFor, headwordsFor, vocabItemFor } from '../popup/saveWord';
import { windowed, type Windowed } from './windowed';
import { activeEngine, lang } from '../../lang/active';
import { levelLabel, levelScheme } from '../../lang/labels';
import { langVocabItem, safeLookup, shortGlossOf } from '../../lang/words';
import { foldSearch } from '../vocab/model';
import type { WordLookup } from '../../lang/types';
import { tt, ttn, uiLocale } from '../../i18n';

/** What the Words tab needs from the reader. */
export interface TocWords {
  /** The words of chapter `index`, counted in the book's own script (the tab converts what it shows). */
  load(index: number): Promise<ChapterWords>;
  /** Tap on a row: open the word card, anchored at the row. `word` is in the script on show. */
  onWord(word: ChapterWord, anchor: DOMRect, chapter: number): void;
}

export interface WordsTab {
  /** Summary and controls, above the list. */
  head: HTMLElement;
  list: HTMLElement;
  window: Windowed;
  /** Rows in the list now, and the row Tab reaches. */
  count(): number;
  rove: number;
  /** Show chapter `index` (loads it if needed). */
  show(index: number): void;
  /** The script setting changed: draw again. */
  refreshText(): void;
  /** The book's names and terms changed: count again. */
  reload(): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

type Show = 'new' | 'all';
type Order = 'often' | 'first';

/** A share as the app's language writes it: 75% in English, 75 % in French. */
const percent = (pct: number) => new Intl.NumberFormat(uiLocale(), { style: 'percent' }).format(pct / 100);

export function createWordsTab(ctx: AppContext, book: BookMeta, src: TocWords, opts: { text(s: string): string; rowH: number; chapterTitle(i: number): string }): WordsTab {
  const store = ctx.store;
  const text = opts.text;
  let index = -1;
  let data: ChapterWords | null = null;
  let seq = 0;
  let visible = false;
  let show: Show = 'new';
  let order: Order = 'often';
  let shown: ChapterWord[] = [];
  const glosses = new Map<string, string>();

  const isKnown = (w: ChapterWord) => store.known.has(w.key) || store.known.has(w.word);
  const isSaved = (w: ChapterWord) => store.vocab.has(w.key) || store.vocab.has(w.word);
  const engine = activeEngine();
  /** Another language: each word's lookup once (its meaning, reading and level), read in the sentence it first comes up in,
   * as the word card reads it there (Japanese は is the particle there, not 歯 "tooth"). */
  const lookups = new Map<string, WordLookup>();
  const lookupOf = (w: ChapterWord) => {
    let lu = lookups.get(w.key);
    if (!lu && engine) { lu = safeLookup(engine, w.word, undefined, w.sentence); lookups.set(w.key, lu); }
    return lu;
  };
  const pinyinOf = (w: ChapterWord) => {
    if (engine) {
      const r = lookupOf(w)?.entries[0]?.reading;
      return r && r !== w.word ? r : '';
    }
    const style = ctx.settings.get().pinyinStyle;
    return w.pinyin.filter(Boolean).map((s) => formatSyllable(s.toLowerCase(), style)).join(style === 'zhuyin' ? ' ' : '');
  };
  function gloss(w: ChapterWord): string {
    let g = glosses.get(w.key);
    if (g === undefined) {
      const dict = ctx.dictSync();
      g = engine ? shortGlossOf(lookupOf(w)?.entries ?? [], 60) : dict ? glossFor(dict, w.word, w.pinyin, { prev: w.prev, next: w.next }) : '';
      glosses.set(w.key, g);
    }
    return g;
  }

  // ------------------------------------------------------------- head
  const chapterName = h('div.rd-words-chapter');
  const prevBtn = h('button.icon-btn.rd-words-step', { type: 'button', 'aria-label': tt('Previous chapter'), title: tt('Previous chapter'), onclick: () => step(-1) }, icon('chevronLeft')) as HTMLButtonElement;
  const nextBtn = h('button.icon-btn.rd-words-step', { type: 'button', 'aria-label': tt('Next chapter'), title: tt('Next chapter'), onclick: () => step(1) }, icon('chevronRight')) as HTMLButtonElement;
  const share = h('div.rd-words-share', { 'aria-live': 'polite' });
  const filter = h('input.input.rd-toc-filter.rd-words-filter', { type: 'search', placeholder: tt('Filter words'), 'aria-label': tt('Filter words') }) as HTMLInputElement;
  const chip = (label: string, on: () => boolean, set: () => void, title: string) => {
    const b = h('button.rd-words-chip', { type: 'button', title, onclick: () => { set(); syncChips(); paint(); } }, label) as HTMLButtonElement;
    return { b, on };
  };
  const chips = [
    chip(tt('New'), () => show === 'new', () => { show = 'new'; }, tt('Words you have not marked known')),
    chip(tt('All'), () => show === 'all', () => { show = 'all'; }, tt('Every word in the chapter')),
    chip(tt('Most often'), () => order === 'often', () => { order = 'often'; }, tt('The words that come up most first')),
    chip(tt('In order'), () => order === 'first', () => { order = 'first'; }, tt('In the order they first come up')),
  ];
  function syncChips(): void { for (const c of chips) c.b.setAttribute('aria-pressed', String(c.on())); }
  const head = h('div.rd-words-head', null,
    h('div.rd-words-nav', null, prevBtn, chapterName, nextBtn),
    share,
    filter,
    h('div.rd-words-chips', null,
      h('div.rd-words-group', { role: 'group', 'aria-label': tt('Show') }, chips[0].b, chips[1].b),
      h('div.rd-words-group', { role: 'group', 'aria-label': tt('Order') }, chips[2].b, chips[3].b)));
  syncChips();

  // ------------------------------------------------------------- rows
  const list = h('div.rd-toc-list.rd-words', { role: 'list', 'aria-label': tt('Words in this chapter') });
  const tab: WordsTab = {
    head, list,
    window: null as unknown as Windowed,
    count: () => shown.length,
    rove: 0,
    show: (i) => load(i),
    refreshText() { if (visible) { summary(); tab.window.repaint(); } },
    reload() { data = null; glosses.clear(); lookups.clear(); if (visible && index >= 0) load(index, true); },
    setVisible(on) { visible = on; },
    dispose() { tab.window.dispose(); offChange(); },
  };

  function row(pos: number): HTMLElement {
    const w = shown[pos];
    const word = text(w.word);
    const known = isKnown(w);
    const saved = isSaved(w);
    // Chinese: the level of the chapter's most common reading of the word (教 jiào has none: the list's 教 is jiāo).
    const level = engine ? engine.level(w.key) : ctx.dictSync()?.hsk(w.key, w.pinyin)?.hsk3;
    const levelText = !level ? '' : engine ? levelLabel(level) : level === 7 ? 'HSK 7+' : `HSK ${level}`;
    const stop = pos === tab.rove ? '0' : '-1';
    const main = h('button.rd-name-main.rd-word-main', {
      type: 'button', tabindex: stop, 'data-k': 'main',
      onclick: (e: Event) => src.onWord({ ...w, word, sentence: text(w.sentence), prev: text(w.prev), next: text(w.next) }, (e.currentTarget as HTMLElement).getBoundingClientRect(), index),
    },
    h('span.rd-name-word.zh', { lang: lang().tag }, word),
    h('span.rd-word-line', null,
      h('span.rd-name-py', null, pinyinOf(w)),
      h('span.rd-name-meta', null,
        h('span.rd-name-count', { title: ttn(w.count, '{n} time in this chapter', '{n} times in this chapter') }, `${w.count}×`),
        level ? h('span.rd-word-hsk', { title: engine ? `${levelScheme()} ${levelText}` : `HSK ${level === 7 ? '7–9' : level}` }, levelText) : null)),
    h('span.rd-word-gloss', null, gloss(w)));
    const saveBtn = h('button.icon-btn.rd-word-act', {
      type: 'button', tabindex: stop, 'data-k': 'save', 'aria-pressed': String(saved),
      'aria-label': saved ? tt('Remove {word} from saved words', { word }) : tt('Save {word}', { word }), title: saved ? tt('Saved. Tap to remove.') : tt('Save to flashcards'),
      onclick: () => void toggleSave(w),
    }, icon(saved ? 'starFill' : 'star'));
    const knownBtn = h('button.icon-btn.rd-word-act', {
      type: 'button', tabindex: stop, 'data-k': 'known', 'aria-pressed': String(known),
      'aria-label': known ? tt('{word} is known. Mark as not known', { word }) : tt('Mark {word} as known', { word }), title: known ? tt('Known. Tap to undo.') : tt('I know this word'),
      onclick: () => void toggleKnown(w),
    }, icon(known ? 'checkCircle' : 'check'));
    return h('div.rd-toc-row.rd-name.rd-word', { role: 'listitem', 'data-known': known ? '' : null, 'data-saved': saved ? '' : null }, main, saveBtn, knownBtn);
  }
  tab.window = windowed(list, row, () => tab.rove);

  async function toggleSave(w: ChapterWord): Promise<void> {
    const dict = ctx.dictSync();
    if (!dict) return;
    const word = text(w.word);
    try {
      const existing = (await store.vocab.get(w.key)) ?? (await store.vocab.get(word));
      if (existing) { await store.vocab.remove(existing.id); return; }
      const lu = engine ? lookupOf(w) : undefined;
      if (lu) {
        await store.vocab.put(langVocabItem({ ...lu, key: w.key }, { context: { sentence: w.sentence, bookId: book.id, bookTitle: book.title, chapter: index } }));
        return;
      }
      await store.vocab.put(vocabItemFor(dict, {
        word, syllables: w.pinyin, around: { prev: text(w.prev), next: text(w.next) },
        context: { sentence: text(w.sentence), bookId: book.id, bookTitle: book.title, chapter: index },
      }));
    } catch (e) { ctx.toast(tt('Could not save {word}: {error}', { word, error: String(e) })); }
  }

  async function toggleKnown(w: ChapterWord): Promise<void> {
    const dict = ctx.dictSync();
    const word = text(w.word);
    const { simp, trad } = dict && !engine ? headwordsFor(dict, word, dict.lookup(word), w.pinyin) : { simp: w.key, trad: '' };
    try {
      if (isKnown(w)) await store.known.remove([...new Set([simp, w.key, w.word, word, trad].filter(Boolean))]);
      else await store.known.add([simp || w.key]);
    } catch (e) { ctx.toast(tt('Could not update {word}: {error}', { word, error: String(e) })); }
  }

  // ------------------------------------------------------------- painting
  function summary(): void {
    chapterName.textContent = index >= 0 ? text(opts.chapterTitle(index)) : '';
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= book.chapterCount - 1;
    share.textContent = '';
    if (!data) return;
    if (!data.total) { share.appendChild(h('p.rd-words-note', null, engine ? tt('No words in this chapter.') : tt('No Chinese words in this chapter.'))); return; }
    const s = wordShare(data, isKnown);
    const pct = Math.floor((s.known / s.total) * 100);
    // The share is in bold inside the sentence: the sentence is translated whole and cut where {percent} stands.
    const [before, after = ''] = tt('{percent} of the words in this chapter are ones you know.').split('{percent}');
    const fresh = s.fresh;
    const often = s.freshOften;
    share.append(
      h('div.rd-words-meter', { role: 'img', 'aria-label': tt('{percent} known', { percent: percent(pct) }) }, h('span', { style: `width: ${pct}%` })),
      h('p.rd-words-big', null, before || null, h('strong', null, percent(pct)), after || null),
      h('p.rd-words-note', null, !fresh ? tt('You know every word in this chapter.')
        : !often ? ttn(fresh, '{n} new word.', '{n} new words.')
          : ttn(often, '{words}, {n} of them comes up 3 or more times.', '{words}, {n} of them come up 3 or more times.', { words: ttn(fresh, '{n} new word', '{n} new words') })),
    );
    if (!store.known.count()) {
      // HSK and JLPT are names of levels; elsewhere the scheme is just "Level" (A1 to C2), and "Level levels" says it twice.
      const s = levelScheme();
      share.appendChild(h('p.rd-words-note', null, s === 'HSK' ? tt('Mark words you know with the check, or mark whole HSK levels as known in Vocabulary.')
        : s === 'JLPT' ? tt('Mark words you know with the check, or mark whole JLPT levels as known in Vocabulary.')
          : tt('Mark words you know with the check, or mark whole levels as known in Vocabulary.')));
    }
  }

  function paint(): void {
    summary();
    list.querySelector('.rd-toc-none')?.remove();
    if (!data) { tab.window.set(0, opts.rowH); return; }
    const raw = filter.value.trim();
    const q = raw.toLowerCase();
    // Case and accents do not count (German nouns are capitalized, and a phone types "tambien" for también); the pinyin with
    // numbers stays as typed.
    const f = foldSearch(raw);
    // An inflected form finds its word (Kindern finds Kind).
    let asKey = '';
    if (engine && f) { try { asKey = foldSearch(engine.normalize(raw)); } catch { /* no key for it */ } }
    const numbered = (w: ChapterWord) => w.pinyin.join('').toLowerCase().replace(/[0-5]/g, '');
    shown = data.words.filter((w) => {
      if (show === 'new' && isKnown(w)) return false;
      if (!q) return true;
      const key = foldSearch(w.key);
      return foldSearch(w.word).includes(f) || key.includes(f) || foldSearch(text(w.word)).includes(f) || (!!asKey && key === asKey)
        || numbered(w).includes(q.replace(/\s+/g, '')) || foldSearch(pinyinOf(w)).includes(f) || foldSearch(gloss(w)).includes(f);
    });
    shown.sort(order === 'often' ? (a, b) => b.count - a.count || a.first - b.first : (a, b) => a.first - b.first);
    tab.rove = Math.max(0, Math.min(tab.rove, shown.length - 1));
    tab.window.set(shown.length, opts.rowH);
    if (!shown.length) {
      list.appendChild(h('div.rd-toc-none', null, q ? tt('No words match.') : show === 'new' ? tt('You know every word in this chapter.') : tt('No words in this chapter.')));
    }
  }

  function load(i: number, force = false): void {
    if (i === index && data && !force) { paint(); return; }
    const mine = ++seq;
    index = i;
    data = null;
    glosses.clear();
    tab.rove = 0;
    list.scrollTop = 0;
    paint();
    share.appendChild(h('p.rd-words-note', null, tt('Counting the words in this chapter…')));
    src.load(i).then((got) => {
      if (mine !== seq) return;
      data = got;
      paint();
    }, () => {
      if (mine !== seq) return;
      share.textContent = '';
      share.appendChild(h('p.rd-words-note', null, tt('This chapter could not be read.')));
    });
  }

  function step(d: -1 | 1): void {
    const to = index + d;
    if (to < 0 || to >= book.chapterCount) return;
    filter.value = '';
    load(to);
  }

  filter.addEventListener('input', () => { tab.rove = 0; paint(); });
  // A word saved or marked known (here, in a card, on another device): the rows and the share follow, in place.
  const offChange = store.onChange((what) => {
    if (!visible || what === 'books') return;
    summary();
    tab.window.repaint();
  });

  return tab;
}
