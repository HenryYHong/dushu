// The Looked up view of the Vocabulary screen: every word looked up in the reader, grouped by day with the newest day first,
// each day with a Practice button, and a practice run for the last week.
import type { AppContext, LookupRow } from '../../types';
import { clear, h } from '../dom';
import { icon } from '../icons';
import { openWordPopup } from '../popup/popup';
import { itemFromLookupRow } from '../popup/saveWord';
import { localDay } from '../popup/lookupLog';
import { contextEl, pinyinEl, scriptView, textAttrs, type ScriptView } from './render';
import { openPractice } from './practice';
import { popIcon, redraw } from './motion';
import { MOST_PATCHED, applyPatch, focusedRow, planPatch, refocus, type Patch } from './patch';
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

/** A row's key: its day and word, as data-flip has it. */
const rowKey = (r: LookupRow) => `${r.day} ${r.id}`;
/** Everything a row shows of a looked-up word but its star, in one string: a word whose row would look different is drawn again. */
const rowShows = (r: LookupRow) => JSON.stringify([r.word, r.pinyin, r.gloss, r.context?.sentence, r.context?.bookTitle, r.count]);
const ROW = '.voc-lk-row[data-flip]';

/** A day on screen: its section, the list its rows are in and its count, and the rows in order. */
interface DrawnDay { section: HTMLElement; list: HTMLElement; count: HTMLElement; keys: string[] }

/** The days and rows on screen and what each was drawn from, so a change of a few words is patched in (patch.ts). */
interface Drawn {
  /** What every row was drawn with (the settings, the day it is): a patch needs the same. */
  with: string;
  days: Map<string, DrawnDay>;
  order: string[];
  rows: Map<string, HTMLElement>;
  shows: Map<string, string>;
  /** Each row's star as drawn: on (the word is saved) or off. */
  stars: Map<string, boolean>;
  summary: HTMLElement;
  week: HTMLElement;
}

export interface LookupsView {
  el: HTMLElement;
  refresh(): Promise<void>;
  /** Draws the rows again; `changed` when the rows themselves changed (motion.ts), not the settings they are shown in. */
  render(changed?: boolean): void;
  /** The saved words changed: the stars are set again in place (one that turns on pops), the rows stay as they are. */
  savedChanged(): void;
  count(): number;
}

export function createLookupsView(ctx: AppContext): LookupsView {
  const { store } = ctx;
  let rows: LookupRow[] = [];
  /** The rows by key, as last read: a row's buttons act on the row as it is now, whenever it was drawn. */
  let byKey = new Map<string, LookupRow>();
  let listed = false;
  /** Null while no rows are shown. */
  let drawn: Drawn | null = null;
  /** The first day of "the last 7 days", as last drawn. */
  let weekStart = '';
  // The words whose star was off at the last drawing, so a star that turns on (saved here, in Practice or on the card) pops.
  let unstarred = new Set<string>();
  const el = h('div.voc-lookups');
  const top = h('div.voc-lk-top');
  const days = h('div.voc-lk-days');
  el.append(top, days);

  async function refresh(): Promise<void> {
    try { rows = await store.lookups.list(); } catch (e) { ctx.toast(e instanceof Error ? e.message : tt('Could not read the words you looked up.')); return; }
    byKey = new Map(rows.map((r) => [rowKey(r), r]));
    // The first list is simply there; after that a word removed or put back folds away or eases in.
    render(listed);
    listed = true;
  }

  function practice(list: LookupRow[], title: string): void {
    if (!list.length) return;
    openPractice(ctx, list, title);
  }

  /**
   * Draws the rows. `changed`: the rows themselves changed (a word removed from a day, put back, looked up again), so the rows
   * of the few that came or went are put in or taken out in place, days and all (patch.ts), and motion.ts shows the way there.
   * A keyboard focus on a row that left goes to the row now in its place.
   */
  function render(changed = false): void {
    const popped: HTMLElement[] = [];
    const focus = focusedRow(days, ROW);
    redraw(days, changed, () => { if (!changed || !patch(popped)) draw(popped); });
    refocus(days, focus, ROW);
    unstarred = new Set(rows.filter((r) => !store.vocab.has(r.id)).map((r) => r.id));
    popped.forEach(popIcon);
  }

  function savedChanged(): void {
    if (!drawn || drawn.with !== drawnWith()) { render(); return; }
    const popped: HTMLElement[] = [];
    setStars(drawn, popped);
    unstarred = new Set(rows.filter((r) => !store.vocab.has(r.id)).map((r) => r.id));
    popped.forEach(popIcon);
  }

  /** The settings and the day every row is drawn with ("Today" is a day's name only today), and whether the script can be
   * converted yet. */
  const drawnWith = () => {
    const s = ctx.settings.get();
    return JSON.stringify([s.script, s.pinyinStyle, s.toneColors, scriptView(s.script, ctx.dictSync()).ready, uiLocale(), localDay(Date.now())]);
  };

  /** The rows of a day as its Practice runs them, and the words of the last 7 days, from the rows as they are now. */
  const dayRows = (day: string) => groupByDay(rows.filter((r) => r.day === day))[0]?.rows ?? [];
  const weekRows = () => distinctWords(rows.filter((r) => r.day >= weekStart));

  function summary(): string {
    // The counts first: scripts/i18n/extract.mjs reads ttn's strings only when its first argument has no call in it.
    const all = distinctWords(rows).length;
    const week = weekRows().length;
    return ttn(all, '{n} word looked up, {week} in the last 7 days.', '{n} words looked up, {week} in the last 7 days.',
      { week: ttn(week, '{n} word', '{n} words') });
  }

  function draw(popped: HTMLElement[]): void {
    clear(top);
    clear(days);
    drawn = null;
    if (!rows.length) {
      days.appendChild(h('div.empty.voc-empty', null,
        h('h2.voc-empty-title', null, tt('No words looked up yet')),
        h('p', null, tt('Every word you tap while reading is listed here by day, with the sentence it was in.')),
        h('a.btn', { href: '#/' }, icon('book'), tt('Open the library')),
      ));
      return;
    }
    const now = Date.now();
    weekStart = localDay(now - 6 * DAY_MS);
    const d: Drawn = {
      with: drawnWith(), days: new Map(), order: [], rows: new Map(), shows: new Map(), stars: new Map(),
      summary: h('p.voc-lk-summary.muted', null, summary()),
      week: h('button.btn.btn-primary', { type: 'button', onclick: () => practice(weekRows(), tt('Last 7 days')) }, icon('cards'), tt('Practice the last 7 days')),
    };
    top.append(...nodes(d.summary, weekRows().length ? d.week : null));
    const view = scriptView(ctx.settings.get().script, ctx.dictSync());
    const groups = groupByDay(rows);
    for (const g of groups) days.appendChild(daySection(d, g, view, popped, now));
    d.order = groups.map((g) => g.day);
    drawn = d;
  }

  /** A day's section with its rows; `d` records it. */
  function daySection(d: Drawn, g: { day: string; rows: LookupRow[] }, view: ScriptView, popped: HTMLElement[], now = Date.now()): HTMLElement {
    const label = dayLabel(g.day, now);
    const count = h('span.voc-lk-count.muted', null, ttn(g.rows.length, '{n} word', '{n} words'));
    const list = h('div.voc-list', { role: 'list' }, g.rows.map((r) => {
      const el = row(r, view, popped, d);
      d.rows.set(rowKey(r), el);
      return el;
    }));
    const section = h('section.voc-lk-day', { 'aria-label': label },
      h('div.voc-lk-head', { 'data-flip': `day ${g.day}` },
        h('h2.voc-lk-title', null, label),
        count,
        h('button.btn.btn-sm.voc-lk-practice', { type: 'button', onclick: () => practice(dayRows(g.day), label) }, icon('cards'), tt('Practice'))),
      list,
    );
    d.days.set(g.day, { section, list, count, keys: g.rows.map(rowKey) });
    return section;
  }

  /**
   * Brings the days and rows on screen up to the rows as they are now, in place: a day that has no rows left is taken out and a
   * new one put in at its place, the rows of words that left a day are taken out and those that came put in at their place in
   * it, and the counts and stars are set again. False, with nothing changed, when it has to be drawn in full (patch.ts).
   */
  function patch(popped: HTMLElement[]): boolean {
    const d = drawn;
    if (!d || d.with !== drawnWith() || !rows.length) return false;
    const groups = groupByDay(rows);
    const order = groups.map((g) => g.day);
    const dayPatch = planPatch(d.order, order, new Set(), Infinity);
    if (!dayPatch) return false;
    // Every row of a day that goes or comes counts as a row taken out or put in.
    let moved = 0;
    for (const day of dayPatch.out) moved += d.days.get(day)!.keys.length;
    const plans: [DrawnDay, Patch, { day: string; rows: LookupRow[] }][] = [];
    for (const g of groups) {
      const was = d.days.get(g.day);
      if (!was) { moved += g.rows.length; continue; }
      const keys = g.rows.map(rowKey);
      const redo = new Set(g.rows.filter((r) => d.shows.get(rowKey(r)) !== rowShows(r)).map(rowKey));
      const p = planPatch(was.keys, keys, redo);
      if (!p) return false;
      moved += p.out.length + p.in.length;
      plans.push([was, p, g]);
    }
    if (moved > MOST_PATCHED) return false;

    const now = Date.now();
    const view = scriptView(ctx.settings.get().script, ctx.dictSync());
    const forget = (k: string) => { d.shows.delete(k); d.stars.delete(k); };
    for (const day of dayPatch.out) {
      const gone = d.days.get(day)!;
      gone.section.remove();
      for (const k of gone.keys) { forget(k); d.rows.delete(k); }
      d.days.delete(day);
    }
    const byDay = new Map(groups.map((g) => [g.day, g]));
    const sections = new Map([...d.days].map(([day, x]) => [day, x.section]));
    applyPatch(days, dayPatch, sections, (day) => daySection(d, byDay.get(day)!, view, popped, now));
    for (const [was, p, g] of plans) {
      p.out.forEach(forget);
      applyPatch(was.list, p, d.rows, (k) => row(byKey.get(k)!, view, popped, d));
      was.keys = g.rows.map(rowKey);
      was.count.textContent = ttn(g.rows.length, '{n} word', '{n} words');
    }
    d.order = order;
    setStars(d, popped);
    d.summary.textContent = summary();
    if (weekRows().length) { if (!d.week.isConnected) top.append(d.week); } else d.week.remove();
    return true;
  }

  /** Sets each star on screen as the saved words are now, as drawing it again would; one that turns on pops. */
  function setStars(d: Drawn, popped: HTMLElement[]): void {
    for (const [k, on] of d.stars) {
      const r = byKey.get(k);
      if (!r) continue;
      const saved = store.vocab.has(r.id);
      if (saved === on) continue;
      const star = d.rows.get(k)!.querySelector<HTMLElement>('.voc-lk-save')!;
      starAttrs(r, saved).forEach(([name, value]) => star.setAttribute(name, value));
      d.stars.set(k, saved);
      if (saved && unstarred.has(r.id)) popped.push(star);
    }
  }

  /** The star's title, label and state, as a row is drawn with them. */
  const starAttrs = (r: LookupRow, saved: boolean): [string, string][] => [
    ['title', saved ? tt('In your flashcards') : tt('Save to flashcards')],
    ['aria-label', saved ? tt('{word} is in your flashcards', { word: r.id }) : tt('Save {word} to flashcards', { word: r.id })],
    ['aria-pressed', String(saved)],
  ];

  /** The row of a looked-up word; `into` records what it shows. */
  function row(r: LookupRow, view: ScriptView, popped: HTMLElement[], into: Drawn): HTMLElement {
    const s = ctx.settings.get();
    const shown = view.text(r.word);
    const ta = textAttrs();
    const word = h('span', { class: `voc-word ${ta.cls}`, lang: ta.lang }, shown);
    const saved = store.vocab.has(r.id);
    const key = rowKey(r);
    const latest = () => byKey.get(key) ?? r;
    into.shows.set(key, rowShows(r));
    into.stars.set(key, saved);
    const meta = [r.context?.bookTitle && view.text(r.context.bookTitle), r.count > 1 ? ttn(r.count, 'looked up {n} time', 'looked up {n} times') : ''].filter(Boolean).join(' · ');
    const star = h('button.icon-btn.voc-lk-save', {
      type: 'button', ...Object.fromEntries(starAttrs(r, saved)),
      onclick: (e: Event) => { e.stopPropagation(); void save(latest()); }, onkeydown: (e: Event) => e.stopPropagation(),
    }, icon('star'));
    if (saved && unstarred.has(r.id)) popped.push(star);
    const el = h('div', { class: 'voc-row voc-lk-row', role: 'listitem', tabindex: 0, 'aria-label': `${r.id}, ${r.gloss}`, 'data-flip': key },
      h('div.voc-main', null,
        h('div.voc-line', null, word, r.pinyin ? pinyinEl(r.pinyin, s.pinyinStyle, s.toneColors, 'voc-py') : null),
        r.gloss ? h('div.voc-gloss', null, r.gloss) : null,
        r.context?.sentence ? h('div', { class: `voc-ctx ${ta.cls}`, lang: ta.lang }, contextEl(view.text(r.context.sentence), [shown, r.word, r.id], 'b', 90)) : null,
        meta ? h('div.voc-meta.muted', null, meta) : null,
      ),
      h('div.voc-side', null,
        star,
        h('button.icon-btn.voc-remove', { type: 'button', title: tt('Remove from this day'), 'aria-label': tt('Remove {word} from {day}', { word: r.id, day: r.day }),
          onclick: (e: Event) => { e.stopPropagation(); void remove(latest()); }, onkeydown: (e: Event) => e.stopPropagation() }, icon('trash')),
      ),
    );
    const open = () => {
      const r = latest();
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

  return { el, refresh, render, savedChanged, count: () => rows.length };
}
