// The day's goal and the streak, at the top of the library: today's minutes against the goal, the days in a row it was met,
// and the last seven days. Reading in any language, on any device that syncs, counts (core/activity.ts).
import '../styles/goal.css';
import { h } from './dom';
import { ACTIVITY_EVENT, ACTIVITY_KEY, GOALS, dayOf, stampToday, streak, type DayTotal } from '../core/activity';
import { goalInput } from './goalInput';
import { PLAN_KEY, getPlan, setPlan } from '../core/plan';
import { num, tt, ttn, uiLocale } from '../i18n';

/** The share of today's goal the bar last showed (this page's life), where a card drawn again starts. */
let barShown = 0;

const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 2.3c.4 3.2 4.9 5.4 4.9 10.6a5.5 5.5 0 0 1-11 0c0-2.5 1.3-4.4 2.9-5.7.1 1.8.9 3 2.1 3.5-.6-3.4.2-6.2 1.1-8.4z"/></svg>';
/** Stands for the number in "{n} day streak", so the words before and after it can go around the big number. */
const MARK = '\u0001';

const minutes = (sec: number) => Math.floor(sec / 60);
const still = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Midday on a day ("2026-11-09"), so its weekday is the same in every time zone. */
const noonOf = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12); };

export function goalCard(): { el: HTMLElement; dispose(): void } {
  // The days in the app's language: S M T W T F S, and Sunday… for a screen reader and the tooltip.
  const letter = new Intl.DateTimeFormat(uiLocale(), { weekday: 'narrow' });
  const dayName = new Intl.DateTimeFormat(uiLocale(), { weekday: 'long' });
  const flame = h('span.goal-flame');
  flame.innerHTML = FLAME;
  // A language that puts words before the number ("连续 5 天") has them here; English has none.
  const lead = h('span');
  const count = h('span.goal-num');
  const unit = h('span.goal-unit');
  const best = h('span.goal-best');
  const today = h('div.goal-today-text');
  const fill = h('span.goal-bar-fill');
  const bar = h('div.goal-bar', { role: 'progressbar', 'aria-valuemin': '0' }, fill);
  const week = h('div.goal-week', { role: 'list', 'aria-label': tt('The last seven days') });
  // The goals offered, a goal of one's own when that is the plan's, and Custom…, which shows a field for any number of minutes.
  const select = h('select.select.goal-select', { 'aria-label': tt('Daily goal') }) as HTMLSelectElement;
  const own = goalInput(25, (g) => setPlan({ goal: g }), 'goal-own-card');
  own.el.hidden = true;
  const options = (goal: number) => {
    const list = (GOALS as readonly number[]).includes(goal) ? [...GOALS] : [...GOALS, goal].sort((a, b) => a - b);
    select.replaceChildren(...list.map((g) => h('option', { value: String(g) }, tt('{min} min a day', { min: num(g) }))),
      h('option', { value: 'custom' }, tt('Custom…')));
    select.value = String(goal);
  };
  select.addEventListener('change', () => {
    if (select.value !== 'custom') { own.el.hidden = true; setPlan({ goal: Number(select.value) }); return; }
    own.show(getPlan().goal);
    own.el.hidden = false;
    select.value = String(getPlan().goal);
    own.input.focus();
    own.input.select();
  });
  const el = h('section.goal.card', { 'aria-label': tt('Daily goal and streak') },
    h('div.goal-streak', null, flame, h('div.goal-streak-text', null, h('div', null, lead, count, unit), best)),
    h('div.goal-today', null, today, bar),
    week,
    h('div.goal-set', null, h('label.goal-set-pick', null, h('span.goal-set-label', null, tt('Goal')), select), own.el));

  const dayCell = (d: DayTotal, isToday: boolean) => {
    const part = d.met ? 1 : Math.min(1, d.seconds / (d.goal * 60));
    const state = d.met ? 'met' : d.seconds > 0 ? 'some' : 'none';
    const noon = noonOf(d.day);
    const day = dayName.format(noon);
    const m = num(minutes(d.seconds));
    const goal = d.goal;
    // The dot and the letter are pictures; a screen reader reads the day in words.
    const said = d.met && isToday ? ttn(goal, '{day}: {m} of {n} minute, goal met, today', '{day}: {m} of {n} minutes, goal met, today', { day, m })
      : d.met ? ttn(goal, '{day}: {m} of {n} minute, goal met', '{day}: {m} of {n} minutes, goal met', { day, m })
      : isToday ? ttn(goal, '{day}: {m} of {n} minute, today', '{day}: {m} of {n} minutes, today', { day, m })
      : ttn(goal, '{day}: {m} of {n} minute', '{day}: {m} of {n} minutes', { day, m });
    return h(`div.goal-day.${state}${isToday ? '.today' : ''}`, { role: 'listitem', title: tt('{day}: {m} of {goal} min', { day, m, goal: num(goal) }) },
      h('span.goal-day-dot', { style: state === 'some' ? `--part:${Math.round(part * 100)}%` : null }),
      h('span.goal-day-name', { 'aria-hidden': 'true' }, letter.format(noon)),
      h('span.goal-sr', null, said));
  };

  // Today's bar fills from empty once the card is first on screen (the library draws it hidden until the books are in), and from
  // where it was when time is added; goal.css moves it with a transform.
  let part = 0;
  let onScreen = false;
  // A card drawn again (back from a book) starts at the share it last showed, so the bar does not refill from empty each visit.
  fill.style.transition = 'none';
  fill.style.transform = `translateX(${barShown - 100}%)`;
  void fill.offsetWidth;
  fill.style.transition = '';
  const paintBar = () => { if (onScreen) { fill.style.transform = `translateX(${part - 100}%)`; barShown = part; } };
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((seen) => {
      if (!seen.some((e) => e.isIntersecting)) return;
      io?.disconnect();
      onScreen = true;
      paintBar();
    })
    : null;
  if (io) io.observe(bar);
  else onScreen = true;

  /** The day the card shows as today: past midnight it draws again. */
  let shown = '';
  let drawn = false;
  const draw = () => {
    const plan = getPlan();
    shown = dayOf();
    // The goal this device judges today by, kept for tomorrow (core/activity.ts totals).
    stampToday(plan.goal);
    const s = streak(plan.goal);
    options(plan.goal);
    el.classList.toggle('met', s.met);
    // The streak's number is drawn big, with the words around it: "5 day streak".
    const current = s.current;
    const [before, after] = current ? ttn(current, '{n} day streak', '{n} day streak', { n: MARK }).split(MARK) : ['', ''];
    lead.textContent = before ?? '';
    const n = current ? num(current) : '';
    // A new streak number rolls up into place; the same one drawn again stays still.
    if (count.textContent !== n) {
      count.textContent = n;
      if (drawn && n && !still() && typeof count.animate === 'function') {
        count.animate([{ opacity: 0, transform: 'translateY(0.3em)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
      }
    }
    unit.textContent = current ? after ?? '' : s.best ? tt('No streak right now') : tt('No streak yet');
    const top = s.best;
    best.textContent = top > current ? ttn(top, 'Best: {n} day', 'Best: {n} days')
      : current ? (s.met ? tt('Goal met today') : tt('Read today to keep it')) : tt('Reach your goal to start one');
    const m = minutes(s.today);
    const goal = s.goal;
    today.textContent = s.met ? tt('{m} min today. Goal of {goal} min reached.', { m: num(m), goal: num(goal) }) : tt('{m} of {goal} min today', { m: num(m), goal: num(goal) });
    part = Math.min(100, Math.round((s.today / (s.goal * 60)) * 100));
    paintBar();
    bar.setAttribute('aria-valuemax', String(s.goal));
    bar.setAttribute('aria-valuenow', String(Math.min(m, s.goal)));
    bar.setAttribute('aria-label', ttn(goal, '{m} of {n} minute today', '{m} of {n} minutes today', { m: num(m) }));
    week.replaceChildren(...s.week.map((d, i) => dayCell(d, i === s.week.length - 1)));
    drawn = true;
  };
  draw();
  const onStorage = (e: StorageEvent) => { if (e.key === ACTIVITY_KEY || e.key === PLAN_KEY || e.key === null) draw(); };
  const onVisible = () => { if (document.visibilityState === 'visible') draw(); };
  // A library left open past midnight: a new day. Checked against the wall clock each minute (a timer set for midnight runs
  // late after sleep or a time zone change), and when the window comes back.
  const onNewDay = () => { if (dayOf() !== shown) draw(); };
  const tick = window.setInterval(onNewDay, 60_000);
  window.addEventListener(ACTIVITY_EVENT, draw);
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', onNewDay);
  window.addEventListener('pageshow', onNewDay);
  document.addEventListener('visibilitychange', onVisible);
  return {
    el,
    dispose() {
      io?.disconnect();
      window.clearInterval(tick);
      window.removeEventListener(ACTIVITY_EVENT, draw);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onNewDay);
      window.removeEventListener('pageshow', onNewDay);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
