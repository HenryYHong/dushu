// Vocabulary screen: saved words, search/sort, exports, backup, and the known-words panel.
import '../../styles/vocab.css';
import type { AppContext, MountFn, Settings, VocabItem } from '../../types';
import { h, clear } from '../dom';
import { penguEl } from '../pengu';
import { icon } from '../icons';
import { pageTitle } from '../pageHead';
import { openWordPopup } from '../popup/popup';
import { confirmDialog } from './confirm';
import { ankiTsv, dueLabel, exportFileName, filterAndSort, reviewLine, vocabCsv, type SortKey } from './model';
import { contextEl, pinyinEl, scriptView, textAttrs } from './render';
import { activeEngine, isChinese } from '../../lang/active';
import { aidName, aidWord, levelCount, levelLabel, levelScheme } from '../../lang/labels';
import { createLookupsView } from './lookups';
import { reviewParts } from '../review/learning';
import { backupFileName } from '../settings/data';
import { num, tt, ttm, ttn, uiLocale } from '../../i18n';

/** In English, shown through tt(). */
const SORT_LABELS: Record<SortKey, string> = { added: ttm('Newest first'), due: ttm('Due soonest'), pinyin: isChinese() ? ttm('Pinyin A to Z') : ttm('A to Z') };
const SORT_KEY = 'dushu.vocab.sort';
const TAB_KEY = 'dushu.vocab.tab';
type Tab = 'saved' | 'lookups';

function savedTab(): Tab | null {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v === 'saved' || v === 'lookups') return v;
  } catch { /* storage blocked */ }
  return null;
}

function savedSort(): SortKey {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (v === 'added' || v === 'due' || v === 'pinyin') return v;
  } catch { /* storage blocked */ }
  return 'added';
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(uiLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
/** Clauses said one after another: "Added 3 words, updated 1, 2 bookmarks added". */
const clauses = (list: string[]) => list.reduce((a, b) => tt('{a}, {b}', { a, b }));

export const mount: MountFn = (root, _params, ctx) => {
  const { store } = ctx;
  let items: VocabItem[] = [];
  let query = '';
  let sort: SortKey = savedSort();
  let settings = ctx.settings.get();
  let alive = true;

  // ------------------------------------------------------------ header ---
  const sub = h('p.page-sub');
  const reviewLink = h('a.btn.btn-primary', { href: '#/review' }, icon('cards'), tt('Review'));
  const head = h('div.page-head', null,
    h('div', null, pageTitle('vocab', tt('Vocabulary')), sub),
    h('div.voc-head-actions', null, reviewLink),
  );

  // ----------------------------------------------------------- toolbar ---
  const search = h('input', { class: 'input voc-search-input',
    type: 'search', placeholder: isChinese() ? tt('Search words, pinyin, meanings') : tt('Search words and meanings'), 'aria-label': tt('Search vocabulary'), autocomplete: 'off',
    oninput: () => { query = search.value; renderList(); },
  });
  const sortSel = h('select', { class: 'select voc-sort', 'aria-label': tt('Sort'), onchange: () => {
    sort = sortSel.value as SortKey;
    try { localStorage.setItem(SORT_KEY, sort); } catch { /* ignore */ }
    renderList();
  } }, (Object.keys(SORT_LABELS) as SortKey[]).map((k) => h('option', { value: k, selected: k === sort }, tt(SORT_LABELS[k]))));
  const exportBtn = (label: string, onclick: () => void) => h('button.btn.btn-sm', { type: 'button', onclick }, icon('download'), label);
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => void importFile() });
  const toolbar = h('div.voc-toolbar', null,
    h('div.voc-search', null, icon('search'), search),
    sortSel,
  );
  const tools = h('div.voc-tools', null,
    exportBtn('Anki', () => exportAs('anki')),
    exportBtn('CSV', () => exportAs('csv')),
    exportBtn(tt('Backup'), () => void exportBackup()),
    h('button.btn.btn-sm', { type: 'button', onclick: () => fileInput.click() }, icon('upload'), tt('Restore')),
    fileInput,
  );

  const list = h('div.voc-list', { role: 'list' });
  const count = h('div.voc-count.muted', { 'aria-live': 'polite' });

  // ------------------------------------------------------------- list ---
  function shown(): VocabItem[] { return filterAndSort(items, query, sort); }

  function renderList(): void {
    clear(list);
    const rows = shown();
    count.textContent = query.trim() ? ttn(rows.length, '{n} match of {total}', '{n} matches of {total}', { total: num(items.length) }) : '';
    toolbar.hidden = tools.hidden = items.length === 0;
    if (!items.length) {
      list.appendChild(h('div.empty.voc-empty', null,
        // Pengu with a book: the words come from reading.
        penguEl('read', 'voc-pengu'),
        h('h2.voc-empty-title', null, tt('No saved words yet')),
        h('p', null, tt('Tap a word while you read and press the star. It shows up here with the sentence you found it in, and goes into Review.')),
        h('a.btn', { href: '#/' }, icon('book'), tt('Open the library')),
      ));
      return;
    }
    if (!rows.length) {
      list.appendChild(h('div.empty', null, tt('Nothing matches "{query}".', { query: query.trim() })));
      return;
    }
    const now = Date.now();
    for (const it of rows) list.appendChild(row(it, now));
  }

  function row(it: VocabItem, now: number): HTMLElement {
    const due = dueLabel(it, now);
    const view = scriptView(settings.script, ctx.dictSync());
    const shownWord = view.word(it);
    const ta = textAttrs(shownWord === it.trad && it.trad !== it.simp);
    const word = h('span', { class: `voc-word ${ta.cls}`, lang: ta.lang }, shownWord);
    const meta = [it.context?.bookTitle && view.text(it.context.bookTitle), tt('Added {date}', { date: fmtDate(it.addedAt) })].filter(Boolean).join(' · ');
    const el = h('div', { class: 'voc-row', role: 'listitem', tabindex: 0, 'aria-label': `${it.simp}, ${it.gloss}` },
      h('div.voc-main', null,
        h('div.voc-line', null, word, pinyinEl(it.pinyin, settings.pinyinStyle, settings.toneColors, 'voc-py')),
        h('div.voc-gloss', null, it.gloss),
        it.context?.sentence ? h('div', { class: `voc-ctx ${ta.cls}`, lang: ta.lang }, contextEl(view.text(it.context.sentence), [it.simp, it.trad], 'b', 90, it.id)) : null,
        h('div.voc-meta.muted', null, meta),
      ),
      h('div.voc-side', null,
        h('span', { class: `chip voc-due voc-due-${due.state}` }, due.text),
        h('button.icon-btn.voc-remove', { type: 'button', title: tt('Remove'), 'aria-label': tt('Remove {word}', { word: it.simp }),
          onclick: (e: Event) => { e.stopPropagation(); void remove(it); },
          onkeydown: (e: Event) => e.stopPropagation() }, icon('trash')),
      ),
    );
    const open = () => openPopup(it, word);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); open(); }
    });
    return el;
  }

  function openPopup(it: VocabItem, anchorEl: HTMLElement): void {
    try {
      openWordPopup({ ctx, word: it.simp, anchor: anchorEl.getBoundingClientRect(), context: it.context });
    } catch (e) {
      console.error(e);
      ctx.toast(tt('Could not open the word card.'));
    }
  }

  async function remove(it: VocabItem): Promise<void> {
    try {
      await store.vocab.remove(it.id);
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : tt('Could not remove the word.'));
      return;
    }
    ctx.toast(tt('Removed {word}', { word: it.simp }), { ms: 6000, action: { label: tt('Undo'), run: () => { void store.vocab.put(it).catch((e) => ctx.toast(String(e))); } } });
  }

  // ---------------------------------------------------------- exports ---
  function exportAs(kind: 'anki' | 'csv'): void {
    const rows = shown();
    if (!rows.length) { ctx.toast(tt('No words to export.')); return; }
    if (kind === 'anki') download(exportFileName('anki'), ankiTsv(rows, settings.pinyinStyle), 'text/tab-separated-values;charset=utf-8');
    else download(exportFileName('vocab'), vocabCsv(rows, settings.pinyinStyle), 'text/csv;charset=utf-8');
    ctx.toast(query.trim()
      ? ttn(rows.length, 'Exported {n} word (current search).', 'Exported {n} words (current search).')
      : ttn(rows.length, 'Exported {n} word.', 'Exported {n} words.'));
  }

  async function exportBackup(): Promise<void> {
    try {
      // The same name as Settings > Data gives the same backup.
      download(backupFileName(), await store.exportBackup(), 'application/json');
      ctx.toast(tt('Backup saved: your saved words, known words, looked-up words, bookmarks, progress and review history.'), { ms: 5000 });
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : tt('Could not create the backup.'));
    }
  }

  async function importFile(): Promise<void> {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const json = await file.text();
      const r = await store.importBackup(json);
      let restored = false;
      if (r.settings && Object.keys(r.settings).length) { ctx.settings.set(r.settings); restored = true; }
      const bits = [ttn(r.vocab.added, 'Added {n} word, updated {updated}', 'Added {n} words, updated {updated}', { updated: r.vocab.updated })];
      if (r.known.added) bits.push(ttn(r.known.added, '{n} known word added', '{n} known words added'));
      if (r.bookmarks.added) bits.push(ttn(r.bookmarks.added, '{n} bookmark added', '{n} bookmarks added'));
      if (r.lookups.added) bits.push(ttn(r.lookups.added, '{n} looked-up word added', '{n} looked-up words added'));
      const list = clauses(bits);
      ctx.toast(restored ? tt('{list}. Settings restored.', { list }) : tt('{list}.', { list }), { ms: 6000 });
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : tt('That file is not a LinguPengu backup.'), { ms: 6000 });
    }
  }

  // ------------------------------------------------------ known panel ---
  const knownCount = h('span.voc-known-count');
  /**
   * Where known words lose their aid, each line a whole sentence: the "HSK pinyin modes" for Chinese (as it always said), "JLPT
   * modes" or "Level modes" for another language. `panel`: the Known words panel's line, else the one in the confirm.
   */
  const noAid = (panel: boolean): string => {
    const aid = aidWord();
    if (isChinese()) {
      return panel
        ? tt('Words you know. They get no {aid} in the Unknown and HSK pinyin modes.', { aid })
        : tt('Known words get no {aid} in the Unknown and HSK pinyin modes.', { aid });
    }
    const scheme = levelScheme();
    return panel
      ? tt('Words you know. They get no {aid} in the Unknown and {scheme} modes.', { aid, scheme })
      : tt('Known words get no {aid} in the Unknown and {scheme} modes.', { aid, scheme });
  };
  // Another language marks its own levels (JLPT N5 up, or A1 up); Chinese keeps HSK 1 to 9.
  const levelName = (n: number) => !isChinese() ? (n === 1 ? levelLabel(1) : tt('{from} to {to}', { from: levelLabel(1), to: levelLabel(n) }))
    : n === 1 ? 'HSK 1' : tt('HSK 1 to {n}', { n: n === 7 ? 9 : n });
  // "HSK level", "JLPT level"; the A1 to C2 levels are just "Level" ("Level level" said it twice).
  const levelSel = h('select', { class: 'select voc-level', 'aria-label': levelScheme() === 'HSK' || levelScheme() === 'JLPT' ? tt('{scheme} level', { scheme: levelScheme() }) : tt('Level') },
    Array.from({ length: isChinese() ? 7 : levelCount() }, (_, i) => i + 1).map((n) => h('option', { value: n }, levelName(n))));
  const knownList = h('div.voc-known-words');
  const knownDetails = h('details', { class: 'voc-known-details', ontoggle: () => renderKnownWords() },
    h('summary', null, tt('Show known words')), knownList);

  function renderKnown(): void {
    const n = store.known.count();
    const learned = store.known.autoCount();
    knownCount.textContent = ttn(n, '{n} word', '{n} words');
    learnedNote.textContent = learned ? ttn(learned, '{n} word learned from reading.', '{n} words learned from reading.') : '';
    learnedNote.hidden = !learned;
    clear(clearBtnHolder);
    if (n) clearBtnHolder.appendChild(clearBtn);
    if (learned) clearBtnHolder.appendChild(clearLearnedBtn);
    knownDetails.hidden = n === 0;
    renderKnownWords();
  }

  function renderKnownWords(): void {
    clear(knownList);
    if (!knownDetails.open) return;
    const all = store.known.all();
    const ta = textAttrs();
    for (const w of all.slice(0, 300)) knownList.appendChild(h('span', { class: `chip ${ta.cls}`, lang: ta.lang }, w));
    const more = all.length - 300;
    if (more > 0) knownList.appendChild(h('span.muted', null, ttn(more, 'and {n} more', 'and {n} more')));
  }

  async function markHsk(): Promise<void> {
    const level = Number(levelSel.value);
    let dict;
    try { dict = await ctx.dict(); } catch { ctx.toast(tt('The dictionary is not available.')); return; }
    const engine = activeEngine();
    const words = engine ? engine.levelWords(level) : dict.hskWords(level);
    const fresh = words.filter((w) => !store.known.has(w));
    const label = levelName(level);
    if (!fresh.length) {
      ctx.toast(ttn(words.length, 'All {n} word from {level} are already marked as known.', 'All {n} words from {level} are already marked as known.', { level: label }));
      return;
    }
    const already = words.length - fresh.length;
    const ok = await confirmDialog({
      title: tt('Mark {level} as known?', { level: label }),
      // Whole sentences, one after another.
      body: [
        already
          ? ttn(fresh.length, '{n} word will be added to your known words ({already} already known).', '{n} words will be added to your known words ({already} already known).', { already: num(already) })
          : ttn(fresh.length, '{n} word will be added to your known words.', '{n} words will be added to your known words.'),
        noAid(false),
        // Chinese: known words are kept by word, not by reading, so a word goes in at its easiest reading and is known in all.
        engine ? '' : tt('A word read more than one way counts at its easiest reading, and is known in all of them (行 xíng is HSK 1, so 行 háng goes too).'),
        tt('Your saved flashcards are not changed.'),
      ].filter(Boolean).join(' '),
      confirmLabel: tt('Add {n}', { n: num(fresh.length) }),
    });
    if (!ok || !alive) return;
    await store.known.add(fresh);
    ctx.toast(ttn(fresh.length, 'Marked {n} word as known.', 'Marked {n} words as known.'));
  }

  async function clearKnown(): Promise<void> {
    const n = store.known.count();
    const ok = await confirmDialog({
      title: tt('Clear all known words?'),
      body: ttn(n, 'This removes {n} word from your known list. {aid} will show above them again. Saved flashcards are not changed.',
        'This removes {n} words from your known list. {aid} will show above them again. Saved flashcards are not changed.', { aid: aidName() }),
      confirmLabel: tt('Clear known words'),
      danger: true,
    });
    if (!ok || !alive) return;
    const words = store.known.all();
    const learned = words.filter((w) => store.known.isAuto(w));
    await store.known.remove(words);
    // Undo puts each word back the way it was: marked by hand, or learned from reading.
    const undo = async () => {
      await store.known.add(words.filter((w) => !learned.includes(w)));
      await store.known.add(learned, { auto: true });
    };
    ctx.toast(ttn(words.length, 'Cleared {n} known word.', 'Cleared {n} known words.'), { ms: 6000, action: { label: tt('Undo'), run: () => { void undo(); } } });
  }

  /** Takes off only the words reading marked (settings.autoKnown) and starts their counts again; words marked by hand stay. */
  async function clearLearned(): Promise<void> {
    const learned = store.known.all().filter((w) => store.known.isAuto(w));
    if (!learned.length) return;
    const ok = await confirmDialog({
      title: tt('Clear words learned from reading?'),
      body: ttn(learned.length, 'This removes {n} word that reading marked as known, and starts counting again from nothing. Words you marked yourself stay known. Saved flashcards are not changed.',
        'This removes {n} words that reading marked as known, and starts counting again from nothing. Words you marked yourself stay known. Saved flashcards are not changed.'),
      confirmLabel: tt('Clear learned words'),
      danger: true,
    });
    if (!ok || !alive) return;
    await store.known.remove(learned);
    await store.seen.clear();
    ctx.toast(ttn(learned.length, 'Cleared {n} word learned from reading.', 'Cleared {n} words learned from reading.'));
  }

  const clearBtn = h('button.btn.btn-sm.btn-danger', { type: 'button', onclick: () => void clearKnown() }, tt('Clear known words'));
  const clearLearnedBtn = h('button.btn.btn-sm', { type: 'button', onclick: () => void clearLearned() }, tt('Clear learned words'));
  const learnedNote = h('p.voc-known-learned.muted', { hidden: true });
  const clearBtnHolder = h('div.voc-known-clear');
  // Collapsed by default and at the top: it is a setting you reach for now and then, not the end of a long list.
  const knownPanel = h('details.card.voc-known', null,
    h('summary.voc-known-summary', null,
      icon('checkCircle'),
      h('span.voc-known-title', null, tt('Known words')),
      h('span.chip.voc-known-total', null, knownCount),
      icon('chevronDown', 'icon voc-known-chev')),
    h('div.voc-known-body', null,
      h('p.voc-known-sub.muted', null, noAid(true)),
      learnedNote,
      h('div.voc-known-actions', null,
        levelSel,
        h('button.btn.btn-sm', { type: 'button', onclick: () => void markHsk() }, icon('checkCircle'), tt('Mark as known')),
        clearBtnHolder,
      ),
      knownDetails),
  );

  // ------------------------------------------------------------- tabs ---
  // Saved words (flashcards) and every word looked up while reading, by day.
  const lookups = createLookupsView(ctx);
  let tab: Tab = savedTab() ?? 'saved';
  const tabBtn = (t: Tab, label: string) => h('button.rd-seg-btn', { type: 'button', onclick: () => setTab(t, true) }, label);
  const tabSaved = tabBtn('saved', tt('Saved'));
  const tabLookups = tabBtn('lookups', tt('Looked up'));
  const tabs = h('div.rd-seg.voc-tabs', { role: 'group', 'aria-label': tt('Words to show') }, tabSaved, tabLookups);
  const savedPane = h('div.voc-saved', null, knownPanel, h('div.voc-bar', null, toolbar, tools), count, list);
  function setTab(t: Tab, remember = false): void {
    tab = t;
    tabSaved.setAttribute('aria-pressed', String(t === 'saved'));
    tabLookups.setAttribute('aria-pressed', String(t === 'lookups'));
    savedPane.hidden = t !== 'saved';
    lookups.el.hidden = t !== 'lookups';
    if (remember) { try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } }
  }
  setTab(tab);

  // ------------------------------------------------------------ mount ---
  const page = h('div.page.voc-page', null, head, tabs, savedPane, lookups.el);
  root.appendChild(page);

  /** The button counts what Review will show: the saved words due and the looked-up words it adds (review/learning.ts). The
   * line under the title says the same two numbers, so the two never disagree. */
  async function refreshHead(): Promise<void> {
    const parts = await reviewParts(store).catch(() => ({ due: 0, fresh: 0 }));
    if (!alive) return;
    sub.textContent = reviewLine(items.length, parts.due, parts.fresh);
    const cards = parts.due + parts.fresh;
    reviewLink.textContent = '';
    reviewLink.append(icon('cards'), cards ? tt('Review {n}', { n: cards }) : tt('Review'));
  }

  async function load(): Promise<void> {
    try {
      items = await store.vocab.list();
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : tt('Could not read your vocabulary.'));
      return;
    }
    await refreshHead();
    if (!alive) return;
    renderList();
    renderKnown();
    // With nothing saved yet, open on what was looked up (unless a tab was chosen before).
    if (!items.length && !savedTab()) setTab('lookups');
  }

  // Also fires for a change made in another tab (the store tells every tab), so words saved there show up here.
  const offChange = store.onChange((what) => {
    if (what === 'vocab') { void load(); lookups.render(); }
    if (what === 'known') { renderKnown(); void refreshHead(); }
    if (what === 'lookups') { void lookups.refresh(); void refreshHead(); }
  });
  const offSettings = ctx.settings.subscribe((s) => { settings = s; renderList(); lookups.render(); });
  void load();
  void lookups.refresh();
  // Converting sentences to the reader's script needs the dictionary; draw again once it is there.
  if (settings.script !== 'original' && !ctx.dictSync()) void ctx.dict().then(() => { if (alive) renderList(); }, () => {});

  return () => { alive = false; offChange(); offSettings(); };
};
