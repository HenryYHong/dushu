// Vocabulary screen: saved words, search/sort, exports, backup, and the known-words panel.
import '../../styles/vocab.css';
import type { AppContext, MountFn, Settings, VocabItem } from '../../types';
import { h, clear } from '../dom';
import { icon } from '../icons';
import { openWordPopup } from '../popup/popup';
import { confirmDialog } from './confirm';
import { ankiTsv, dueLabel, filterAndSort, vocabCsv, type SortKey } from './model';
import { contextEl, pinyinEl, scriptView } from './render';

const SORT_LABELS: Record<SortKey, string> = { added: 'Newest first', due: 'Due soonest', pinyin: 'Pinyin A to Z' };
const SORT_KEY = 'dushu.vocab.sort';

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

const today = () => new Date().toISOString().slice(0, 10);
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const mount: MountFn = (root, _params, ctx) => {
  const { store } = ctx;
  let items: VocabItem[] = [];
  let query = '';
  let sort: SortKey = savedSort();
  let settings = ctx.settings.get();
  let alive = true;

  // ------------------------------------------------------------ header ---
  const sub = h('p.page-sub');
  const reviewLink = h('a.btn.btn-primary', { href: '#/review' }, icon('cards'), 'Review');
  const head = h('div.page-head', null,
    h('div', null, h('h1.page-title', null, 'Vocabulary'), sub),
    h('div.voc-head-actions', null, reviewLink),
  );

  // ----------------------------------------------------------- toolbar ---
  const search = h('input', { class: 'input voc-search-input',
    type: 'search', placeholder: 'Search words, pinyin, meanings', 'aria-label': 'Search vocabulary', autocomplete: 'off',
    oninput: () => { query = search.value; renderList(); },
  });
  const sortSel = h('select', { class: 'select voc-sort', 'aria-label': 'Sort', onchange: () => {
    sort = sortSel.value as SortKey;
    try { localStorage.setItem(SORT_KEY, sort); } catch { /* ignore */ }
    renderList();
  } }, (Object.keys(SORT_LABELS) as SortKey[]).map((k) => h('option', { value: k, selected: k === sort }, SORT_LABELS[k])));
  const exportBtn = (label: string, onclick: () => void) => h('button.btn.btn-sm', { type: 'button', onclick }, icon('download'), label);
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => void importFile() });
  const toolbar = h('div.voc-toolbar', null,
    h('div.voc-search', null, icon('search'), search),
    sortSel,
  );
  const tools = h('div.voc-tools', null,
    exportBtn('Anki', () => exportAs('anki')),
    exportBtn('CSV', () => exportAs('csv')),
    exportBtn('Backup', () => void exportBackup()),
    h('button.btn.btn-sm', { type: 'button', onclick: () => fileInput.click() }, icon('upload'), 'Restore'),
    fileInput,
  );

  const list = h('div.voc-list', { role: 'list' });
  const count = h('div.voc-count.muted', { 'aria-live': 'polite' });

  // ------------------------------------------------------------- list ---
  function shown(): VocabItem[] { return filterAndSort(items, query, sort); }

  function renderList(): void {
    clear(list);
    const rows = shown();
    count.textContent = query.trim() ? `${plural(rows.length, 'match', 'matches')} of ${items.length.toLocaleString('en-US')}` : '';
    toolbar.hidden = tools.hidden = items.length === 0;
    if (!items.length) {
      list.appendChild(h('div.empty.voc-empty', null,
        h('h2.voc-empty-title', null, 'No saved words yet'),
        h('p', null, 'While reading, tap a word and press the star to save it. Saved words show up here with the sentence you found them in, and become flashcards.'),
        h('a.btn', { href: '#/' }, icon('book'), 'Open the library'),
      ));
      return;
    }
    if (!rows.length) {
      list.appendChild(h('div.empty', null, `Nothing matches "${query.trim()}".`));
      return;
    }
    const now = Date.now();
    for (const it of rows) list.appendChild(row(it, now));
  }

  function row(it: VocabItem, now: number): HTMLElement {
    const due = dueLabel(it, now);
    const view = scriptView(settings.script, ctx.dictSync());
    const shownWord = view.word(it);
    const word = h('span.voc-word.zh', { lang: shownWord === it.trad && it.trad !== it.simp ? 'zh-Hant' : 'zh' }, shownWord);
    const meta = [it.context?.bookTitle && view.text(it.context.bookTitle), `Added ${fmtDate(it.addedAt)}`].filter(Boolean).join(' · ');
    const el = h('div', { class: 'voc-row', role: 'listitem', tabindex: 0, 'aria-label': `${it.simp}, ${it.gloss}` },
      h('div.voc-main', null,
        h('div.voc-line', null, word, pinyinEl(it.pinyin, settings.pinyinStyle, settings.toneColors, 'voc-py')),
        h('div.voc-gloss', null, it.gloss),
        it.context?.sentence ? h('div.voc-ctx.zh', { lang: shownWord === it.trad && it.trad !== it.simp ? 'zh-Hant' : 'zh' }, contextEl(view.text(it.context.sentence), [it.simp, it.trad], 'b', 90)) : null,
        h('div.voc-meta.muted', null, meta),
      ),
      h('div.voc-side', null,
        h('span', { class: `chip voc-due voc-due-${due.state}` }, due.text),
        h('button.icon-btn.voc-remove', { type: 'button', title: 'Remove', 'aria-label': `Remove ${it.simp}`,
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
      ctx.toast('Could not open the word card.');
    }
  }

  async function remove(it: VocabItem): Promise<void> {
    try {
      await store.vocab.remove(it.id);
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : 'Could not remove the word.');
      return;
    }
    ctx.toast(`Removed ${it.simp}`, { ms: 6000, action: { label: 'Undo', run: () => { void store.vocab.put(it).catch((e) => ctx.toast(String(e))); } } });
  }

  // ---------------------------------------------------------- exports ---
  function exportAs(kind: 'anki' | 'csv'): void {
    const rows = shown();
    if (!rows.length) { ctx.toast('No words to export.'); return; }
    if (kind === 'anki') download(`dushu-anki-${today()}.txt`, ankiTsv(rows, settings.pinyinStyle), 'text/tab-separated-values;charset=utf-8');
    else download(`dushu-vocab-${today()}.csv`, vocabCsv(rows, settings.pinyinStyle), 'text/csv;charset=utf-8');
    ctx.toast(`Exported ${plural(rows.length, 'word')}${query.trim() ? ' (current search)' : ''}.`);
  }

  async function exportBackup(): Promise<void> {
    try {
      download(`dushu-backup-${today()}.json`, await store.exportBackup(), 'application/json');
      ctx.toast('Backup saved. It holds your words, known words, progress and review history.', { ms: 5000 });
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : 'Could not create the backup.');
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
      const bits = [`Added ${plural(r.vocab.added, 'word')}`, `updated ${r.vocab.updated}`];
      if (r.known.added) bits.push(`${plural(r.known.added, 'known word')} added`);
      ctx.toast(bits.join(', ') + (restored ? '. Settings restored.' : '.'), { ms: 6000 });
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : 'That file is not a Dushu backup.', { ms: 6000 });
    }
  }

  // ------------------------------------------------------ known panel ---
  const knownCount = h('span.voc-known-count');
  const levelSel = h('select', { class: 'select voc-level', 'aria-label': 'HSK level' },
    [1, 2, 3, 4, 5, 6, 7].map((n) => h('option', { value: n }, n === 1 ? 'HSK 1' : n === 7 ? 'HSK 1 to 9' : `HSK 1 to ${n}`)));
  const knownList = h('div.voc-known-words');
  const knownDetails = h('details', { class: 'voc-known-details', ontoggle: () => renderKnownWords() },
    h('summary', null, 'Show known words'), knownList);

  function renderKnown(): void {
    const n = store.known.count();
    knownCount.textContent = plural(n, 'word');
    clear(clearBtnHolder);
    if (n) clearBtnHolder.appendChild(clearBtn);
    knownDetails.hidden = n === 0;
    renderKnownWords();
  }

  function renderKnownWords(): void {
    clear(knownList);
    if (!knownDetails.open) return;
    const all = store.known.all();
    for (const w of all.slice(0, 300)) knownList.appendChild(h('span.chip.zh', { lang: 'zh' }, w));
    if (all.length > 300) knownList.appendChild(h('span.muted', null, `and ${(all.length - 300).toLocaleString('en-US')} more`));
  }

  async function markHsk(): Promise<void> {
    const level = Number(levelSel.value);
    let dict;
    try { dict = await ctx.dict(); } catch { ctx.toast('The dictionary is not available.'); return; }
    const words = dict.hskWords(level);
    const fresh = words.filter((w) => !store.known.has(w));
    const label = level === 7 ? 'HSK 1 to 9' : level === 1 ? 'HSK 1' : `HSK 1 to ${level}`;
    if (!fresh.length) { ctx.toast(`All ${plural(words.length, 'word')} from ${label} are already marked as known.`); return; }
    const already = words.length - fresh.length;
    const ok = await confirmDialog({
      title: `Mark ${label} as known?`,
      body: `${plural(fresh.length, 'word')} will be added to your known words${already ? ` (${already.toLocaleString('en-US')} already known)` : ''}. Known words get no pinyin when you read with "unknown words only". Your saved flashcards are not changed.`,
      confirmLabel: `Add ${fresh.length.toLocaleString('en-US')}`,
    });
    if (!ok || !alive) return;
    await store.known.add(fresh);
    ctx.toast(`Marked ${plural(fresh.length, 'word')} as known.`);
  }

  async function clearKnown(): Promise<void> {
    const n = store.known.count();
    const ok = await confirmDialog({
      title: 'Clear all known words?',
      body: `This removes ${plural(n, 'word')} from your known list. Pinyin will show above them again. Saved flashcards are not changed.`,
      confirmLabel: 'Clear known words',
      danger: true,
    });
    if (!ok || !alive) return;
    const words = store.known.all();
    await store.known.remove(words);
    ctx.toast(`Cleared ${plural(words.length, 'known word')}.`, { ms: 6000, action: { label: 'Undo', run: () => { void store.known.add(words); } } });
  }

  const clearBtn = h('button.btn.btn-sm.btn-danger', { type: 'button', onclick: () => void clearKnown() }, 'Clear known words');
  const clearBtnHolder = h('div');
  // Collapsed by default and at the top: it is a setting you reach for now and then, not the end of a long list.
  const knownPanel = h('details.card.voc-known', null,
    h('summary.voc-known-summary', null,
      icon('checkCircle'),
      h('span.voc-known-title', null, 'Known words'),
      h('span.chip.voc-known-total', null, knownCount),
      icon('chevronDown', 'icon voc-known-chev')),
    h('div.voc-known-body', null,
      h('p.voc-known-sub.muted', null, 'Words you already know. Pinyin is hidden above them when you read with "unknown words only".'),
      h('div.voc-known-actions', null,
        levelSel,
        h('button.btn.btn-sm', { type: 'button', onclick: () => void markHsk() }, icon('checkCircle'), 'Mark as known'),
        clearBtnHolder,
      ),
      knownDetails),
  );

  // ------------------------------------------------------------ mount ---
  const page = h('div.page.voc-page', null,
    head,
    knownPanel,
    h('div.voc-bar', null, toolbar, tools),
    count, list,
  );
  root.appendChild(page);

  async function load(): Promise<void> {
    try {
      items = await store.vocab.list();
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : 'Could not read your vocabulary.');
      return;
    }
    if (!alive) return;
    const due = items.filter((i) => i.srs.due <= Date.now()).length;
    sub.textContent = items.length
      ? `${plural(items.length, 'word')} saved, ${due ? `${due.toLocaleString('en-US')} due for review` : 'none due for review'}`
      : 'Words you save while reading collect here.';
    reviewLink.textContent = '';
    reviewLink.append(icon('cards'), due ? `Review ${due}` : 'Review');
    renderList();
    renderKnown();
  }

  // Also fires for a change made in another tab (the store tells every tab), so words saved there show up here.
  const offChange = store.onChange((what) => {
    if (what === 'vocab') void load();
    if (what === 'known') renderKnown();
  });
  const offSettings = ctx.settings.subscribe((s) => { settings = s; renderList(); });
  void load();
  // Converting sentences to the reader's script needs the dictionary; draw again once it is there.
  if (settings.script !== 'original' && !ctx.dictSync()) void ctx.dict().then(() => { if (alive) renderList(); }, () => {});

  return () => { alive = false; offChange(); offSettings(); };
};
