// The Looked up view of the Vocabulary screen: every word looked up in the reader, grouped by day with the newest day first,
// each day with a Practice button, and a practice run for the last week.
import type { AppContext, LookupRow } from '../../types';
import { clear, h } from '../dom';
import { icon } from '../icons';
import { openWordPopup } from '../popup/popup';
import { itemFromLookupRow } from '../popup/saveWord';
import { localDay } from '../popup/lookupLog';
import { contextEl, pinyinEl, scriptView, textAttrs } from './render';
import { openPractice } from './practice';
import { popIcon, redraw } from './motion';
import { tt, ttn, uiLocale } from '../../i18n';

const DAY_MS = 86_400_000;

/** "Today", "Yesterday", then "Wed, Oct 22" (with the year when it is not this year), in the app's language. */
export function dayLabel(day: string, now = Date.now()): string {
  if (day === localDay(now)) return tt('Today');
  if (day === localDay(now - DAY_MS)) return tt('Yesterday');
  const [y, m, d] = day.split('-').map(Number);
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  if (y !== new Date(now).getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString(uiLocale(), opts);
}

/** Days newest first; within a day, the word looked up last comes first. */
export function groupByDay(rows: LookupRow[]): { day: string; rows: LookupRow[] }[] {
  const byDay = new Map<string, LookupRow[]>();
  for (const r of rows) {
    const list = byDay.get(r.day);
    if (list) list.push(r); else byDay.set(r.day, [r]);
  }
  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, list]) => ({ day, rows: list.sort((a, b) => b.last - a.last) }));
}

/** One row per word over the days given, the most recent lookup of each (for a practice run over several days). */
export function distinctWords(rows: LookupRow[]): LookupRow[] {
  const best = new Map<string, LookupRow>();
  for (const r of rows) {
    const cur = best.get(r.id);
    if (!cur || r.last > cur.last) best.set(r.id, r);
  }
  return [...best.values()].sort((a, b) => b.last - a.last);
}

const nodes = (...list: (HTMLElement | null)[]): HTMLElement[] => list.filter((n): n is HTMLElement => n !== null);

export interface LookupsView {
  el: HTMLElement;
  refresh(): Promise<void>;
  /** Draws the rows again; `changed` when the rows themselves changed (motion.ts), not the settings they are shown in. */
  render(changed?: boolean): void;
  count(): number;
}

export function createLookupsView(ctx: AppContext): LookupsView {
  const { store } = ctx;
  let rows: LookupRow[] = [];
  let listed = false;
  // The words whose star was off at the last drawing, so a star that turns on (saved here, in Practice or on the card) pops.
  let unstarred = new Set<string>();
  const el = h('div.voc-lookups');
  const top = h('div.voc-lk-top');
  const days = h('div.voc-lk-days');
  el.append(top, days);

  async function refresh(): Promise<void> {
    try { rows = await store.lookups.list(); } catch (e) { ctx.toast(e instanceof Error ? e.message : tt('Could not read the words you looked up.')); return; }
    // The first list is simply there; after that a word removed or put back folds away or eases in.
    render(listed);
    listed = true;
  }

  function practice(list: LookupRow[], title: string): void {
    if (!list.length) return;
    openPractice(ctx, list, title);
  }

  function render(changed = false): void {
    const popped: HTMLElement[] = [];
    redraw(days, changed, () => draw(popped));
    unstarred = new Set(rows.filter((r) => !store.vocab.has(r.id)).map((r) => r.id));
    popped.forEach(popIcon);
  }

  function draw(popped: HTMLElement[]): void {
    clear(top);
    clear(days);
    if (!rows.length) {
      days.appendChild(h('div.empty.voc-empty', null,
        h('h2.voc-empty-title', null, tt('No words looked up yet')),
        h('p', null, tt('Every word you tap while reading is listed here by day, with the sentence it was in.')),
        h('a.btn', { href: '#/' }, icon('book'), tt('Open the library')),
      ));
      return;
    }
    const now = Date.now();
    const weekStart = localDay(now - 6 * DAY_MS);
    const week = distinctWords(rows.filter((r) => r.day >= weekStart));
    const all = distinctWords(rows).length;
    top.append(...nodes(
      h('p.voc-lk-summary.muted', null, ttn(all, '{n} word looked up, {week} in the last 7 days.', '{n} words looked up, {week} in the last 7 days.',
        { week: ttn(week.length, '{n} word', '{n} words') })),
      week.length ? h('button.btn.btn-primary', { type: 'button', onclick: () => practice(week, tt('Last 7 days')) }, icon('cards'), tt('Practice the last 7 days')) : null,
    ));
    const view = scriptView(ctx.settings.get().script, ctx.dictSync());
    for (const g of groupByDay(rows)) {
      const label = dayLabel(g.day, now);
      days.appendChild(h('section.voc-lk-day', { 'aria-label': label },
        h('div.voc-lk-head', { 'data-flip': `day ${g.day}` },
          h('h2.voc-lk-title', null, label),
          h('span.voc-lk-count.muted', null, ttn(g.rows.length, '{n} word', '{n} words')),
          h('button.btn.btn-sm.voc-lk-practice', { type: 'button', onclick: () => practice(g.rows, label) }, icon('cards'), tt('Practice'))),
        h('div.voc-list', { role: 'list' }, g.rows.map((r) => row(r, view, popped))),
      ));
    }
  }

  function row(r: LookupRow, view: ReturnType<typeof scriptView>, popped: HTMLElement[]): HTMLElement {
    const s = ctx.settings.get();
    const shown = view.text(r.word);
    const ta = textAttrs();
    const word = h('span', { class: `voc-word ${ta.cls}`, lang: ta.lang }, shown);
    const saved = store.vocab.has(r.id);
    const meta = [r.context?.bookTitle && view.text(r.context.bookTitle), r.count > 1 ? ttn(r.count, 'looked up {n} time', 'looked up {n} times') : ''].filter(Boolean).join(' · ');
    const star = h('button.icon-btn.voc-lk-save', {
      type: 'button', title: saved ? tt('In your flashcards') : tt('Save to flashcards'),
      'aria-label': saved ? tt('{word} is in your flashcards', { word: r.id }) : tt('Save {word} to flashcards', { word: r.id }),
      'aria-pressed': String(saved), onclick: (e: Event) => { e.stopPropagation(); void save(r); }, onkeydown: (e: Event) => e.stopPropagation(),
    }, icon('star'));
    if (saved && unstarred.has(r.id)) popped.push(star);
    const el = h('div', { class: 'voc-row voc-lk-row', role: 'listitem', tabindex: 0, 'aria-label': `${r.id}, ${r.gloss}`, 'data-flip': `${r.day} ${r.id}` },
      h('div.voc-main', null,
        h('div.voc-line', null, word, r.pinyin ? pinyinEl(r.pinyin, s.pinyinStyle, s.toneColors, 'voc-py') : null),
        r.gloss ? h('div.voc-gloss', null, r.gloss) : null,
        r.context?.sentence ? h('div', { class: `voc-ctx ${ta.cls}`, lang: ta.lang }, contextEl(view.text(r.context.sentence), [shown, r.word, r.id], 'b', 90)) : null,
        meta ? h('div.voc-meta.muted', null, meta) : null,
      ),
      h('div.voc-side', null,
        star,
        h('button.icon-btn.voc-remove', { type: 'button', title: tt('Remove from this day'), 'aria-label': tt('Remove {word} from {day}', { word: r.id, day: r.day }),
          onclick: (e: Event) => { e.stopPropagation(); void remove(r); }, onkeydown: (e: Event) => e.stopPropagation() }, icon('trash')),
      ),
    );
    const open = () => {
      try { openWordPopup({ ctx, word: r.word, reading: r.pinyin ? r.pinyin.split(' ') : undefined, anchor: word.getBoundingClientRect(), context: r.context }); }
      catch (e) { console.error(e); ctx.toast(tt('Could not open the word card.')); }
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); open(); } });
    return el;
  }

  async function save(r: LookupRow): Promise<void> {
    if (store.vocab.has(r.id)) { ctx.toast(tt('{word} is already in your flashcards.', { word: r.id })); return; }
    try {
      const dict = await ctx.dict();
      await store.vocab.put(itemFromLookupRow(dict, r, Date.now(), { bookGloss: false }));
      ctx.toast(tt('Saved {word} to your flashcards.', { word: r.id }));
    } catch (e) {
      ctx.toast(e instanceof Error ? e.message : tt('Could not save the word.'));
    }
  }

  async function remove(r: LookupRow): Promise<void> {
    try { await store.lookups.remove(r.day, r.id); } catch (e) { ctx.toast(e instanceof Error ? e.message : tt('Could not remove the word.')); return; }
    ctx.toast(tt('Removed {word} from {day}.', { word: r.id, day: dayLabel(r.day) }), { ms: 6000, action: { label: tt('Undo'), run: () => {
      void store.lookups.log({ day: r.day, id: r.id, word: r.word, pinyin: r.pinyin, gloss: r.gloss, context: r.context }, r.last).catch(() => {});
    } } });
  }

  return { el, refresh, render, count: () => rows.length };
}
