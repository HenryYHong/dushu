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

const fmt = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;

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
  const pinyinOf = (w: ChapterWord) => {
    const style = ctx.settings.get().pinyinStyle;
    return w.pinyin.filter(Boolean).map((s) => formatSyllable(s.toLowerCase(), style)).join(style === 'zhuyin' ? ' ' : '');
  };
  function gloss(w: ChapterWord): string {
    let g = glosses.get(w.key);
    if (g === undefined) {
      const dict = ctx.dictSync();
      g = dict ? glossFor(dict, w.word, w.pinyin, { prev: w.prev, next: w.next }) : '';
      glosses.set(w.key, g);
    }
    return g;
  }

  // ------------------------------------------------------------- head
  const chapterName = h('div.rd-words-chapter');
  const prevBtn = h('button.icon-btn.rd-words-step', { type: 'button', 'aria-label': 'Previous chapter', title: 'Previous chapter', onclick: () => step(-1) }, icon('chevronLeft')) as HTMLButtonElement;
  const nextBtn = h('button.icon-btn.rd-words-step', { type: 'button', 'aria-label': 'Next chapter', title: 'Next chapter', onclick: () => step(1) }, icon('chevronRight')) as HTMLButtonElement;
  const share = h('div.rd-words-share', { 'aria-live': 'polite' });
  const filter = h('input.input.rd-toc-filter.rd-words-filter', { type: 'search', placeholder: 'Filter words', 'aria-label': 'Filter words' }) as HTMLInputElement;
  const chip = (label: string, on: () => boolean, set: () => void, title: string) => {
    const b = h('button.rd-words-chip', { type: 'button', title, onclick: () => { set(); syncChips(); paint(); } }, label) as HTMLButtonElement;
    return { b, on };
  };
  const chips = [
    chip('New', () => show === 'new', () => { show = 'new'; }, 'Words you have not marked known'),
    chip('All', () => show === 'all', () => { show = 'all'; }, 'Every word in the chapter'),
    chip('Most often', () => order === 'often', () => { order = 'often'; }, 'The words that come up most first'),
    chip('In order', () => order === 'first', () => { order = 'first'; }, 'In the order they first come up'),
  ];
  function syncChips(): void { for (const c of chips) c.b.setAttribute('aria-pressed', String(c.on())); }
  const head = h('div.rd-words-head', null,
    h('div.rd-words-nav', null, prevBtn, chapterName, nextBtn),
    share,
    filter,
    h('div.rd-words-chips', null,
      h('div.rd-words-group', { role: 'group', 'aria-label': 'Show' }, chips[0].b, chips[1].b),
      h('div.rd-words-group', { role: 'group', 'aria-label': 'Order' }, chips[2].b, chips[3].b)));
  syncChips();

  // ------------------------------------------------------------- rows
  const list = h('div.rd-toc-list.rd-words', { role: 'list', 'aria-label': 'Words in this chapter' });
  const tab: WordsTab = {
    head, list,
    window: null as unknown as Windowed,
    count: () => shown.length,
    rove: 0,
    show: (i) => load(i),
    refreshText() { if (visible) { summary(); tab.window.repaint(); } },
    reload() { data = null; glosses.clear(); if (visible && index >= 0) load(index, true); },
    setVisible(on) { visible = on; },
    dispose() { tab.window.dispose(); offChange(); },
  };

  function row(pos: number): HTMLElement {
    const w = shown[pos];
    const word = text(w.word);
    const known = isKnown(w);
    const saved = isSaved(w);
    const level = ctx.dictSync()?.hsk(w.key)?.hsk3;
    const stop = pos === tab.rove ? '0' : '-1';
    const main = h('button.rd-name-main.rd-word-main', {
      type: 'button', tabindex: stop, 'data-k': 'main',
      onclick: (e: Event) => src.onWord({ ...w, word, sentence: text(w.sentence), prev: text(w.prev), next: text(w.next) }, (e.currentTarget as HTMLElement).getBoundingClientRect(), index),
    },
    h('span.rd-name-word.zh', { lang: 'zh' }, word),
    h('span.rd-word-line', null,
      h('span.rd-name-py', null, pinyinOf(w)),
      h('span.rd-name-meta', null,
        h('span.rd-name-count', { title: `${plural(w.count, 'time')} in this chapter` }, `${w.count}×`),
        level ? h('span.rd-word-hsk', { title: `HSK ${level === 7 ? '7–9' : level}` }, level === 7 ? 'HSK 7+' : `HSK ${level}`) : null)),
    h('span.rd-word-gloss', null, gloss(w)));
    const saveBtn = h('button.icon-btn.rd-word-act', {
      type: 'button', tabindex: stop, 'data-k': 'save', 'aria-pressed': String(saved),
      'aria-label': saved ? `Remove ${word} from saved words` : `Save ${word}`, title: saved ? 'Saved. Tap to remove.' : 'Save to flashcards',
      onclick: () => void toggleSave(w),
    }, icon(saved ? 'starFill' : 'star'));
    const knownBtn = h('button.icon-btn.rd-word-act', {
      type: 'button', tabindex: stop, 'data-k': 'known', 'aria-pressed': String(known),
      'aria-label': known ? `${word} is known. Mark as not known` : `Mark ${word} as known`, title: known ? 'Known. Tap to undo.' : 'I know this word',
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
      await store.vocab.put(vocabItemFor(dict, {
        word, syllables: w.pinyin, around: { prev: text(w.prev), next: text(w.next) },
        context: { sentence: text(w.sentence), bookId: book.id, bookTitle: book.title, chapter: index },
      }));
    } catch (e) { ctx.toast(`Could not save ${word}: ${String(e)}`); }
  }

  async function toggleKnown(w: ChapterWord): Promise<void> {
    const dict = ctx.dictSync();
    const word = text(w.word);
    const { simp, trad } = dict ? headwordsFor(dict, word, dict.lookup(word), w.pinyin) : { simp: w.key, trad: '' };
    try {
      if (isKnown(w)) await store.known.remove([...new Set([simp, w.key, w.word, word, trad].filter(Boolean))]);
      else await store.known.add([simp || w.key]);
    } catch (e) { ctx.toast(`Could not update ${word}: ${String(e)}`); }
  }

  // ------------------------------------------------------------- painting
  function summary(): void {
    chapterName.textContent = index >= 0 ? text(opts.chapterTitle(index)) : '';
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= book.chapterCount - 1;
    share.textContent = '';
    if (!data) return;
    if (!data.total) { share.appendChild(h('p.rd-words-note', null, 'No Chinese words in this chapter.')); return; }
    const s = wordShare(data, isKnown);
    const pct = Math.floor((s.known / s.total) * 100);
    share.append(
      h('div.rd-words-meter', { role: 'img', 'aria-label': `${pct}% known` }, h('span', { style: `width: ${pct}%` })),
      h('p.rd-words-big', null, h('strong', null, `${pct}%`), ` of the words in this chapter are ones you know.`),
      h('p.rd-words-note', null, s.fresh
        ? `${plural(s.fresh, 'new word')}${s.freshOften ? `, ${fmt(s.freshOften)} of them ${s.freshOften === 1 ? 'comes' : 'come'} up 3 or more times` : ''}.`
        : 'You know every word in this chapter.'),
    );
    if (!store.known.count()) share.appendChild(h('p.rd-words-note', null, 'Mark words you know with the check, or mark whole HSK levels in Vocabulary.'));
  }

  function paint(): void {
    summary();
    list.querySelector('.rd-toc-none')?.remove();
    if (!data) { tab.window.set(0, opts.rowH); return; }
    const q = filter.value.trim().toLowerCase();
    const numbered = (w: ChapterWord) => w.pinyin.join('').toLowerCase().replace(/[0-5]/g, '');
    shown = data.words.filter((w) => {
      if (show === 'new' && isKnown(w)) return false;
      if (!q) return true;
      return w.word.includes(q) || w.key.includes(q) || text(w.word).includes(q) || numbered(w).includes(q.replace(/\s+/g, ''))
        || pinyinOf(w).toLowerCase().includes(q) || gloss(w).toLowerCase().includes(q);
    });
    shown.sort(order === 'often' ? (a, b) => b.count - a.count || a.first - b.first : (a, b) => a.first - b.first);
    tab.rove = Math.max(0, Math.min(tab.rove, shown.length - 1));
    tab.window.set(shown.length, opts.rowH);
    if (!shown.length) {
      list.appendChild(h('div.rd-toc-none', null, q ? 'No words match.' : show === 'new' ? 'You know every word in this chapter.' : 'No words in this chapter.'));
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
    share.appendChild(h('p.rd-words-note', null, 'Counting the words in this chapter…'));
    src.load(i).then((got) => {
      if (mine !== seq) return;
      data = got;
      paint();
    }, () => {
      if (mine !== seq) return;
      share.textContent = '';
      share.appendChild(h('p.rd-words-note', null, 'This chapter could not be read.'));
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
