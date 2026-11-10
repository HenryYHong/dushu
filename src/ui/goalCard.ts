// The day's goal and the streak, at the top of the library: today's minutes against the goal, the days in a row it was met,
// and the last seven days. Reading in any language, on any device that syncs, counts (core/activity.ts).
import '../styles/goal.css';
import { h } from './dom';
import { ACTIVITY_EVENT, ACTIVITY_KEY, GOALS, dayOf, stampToday, streak, type DayTotal } from '../core/activity';
import { PLAN_KEY, getPlan, setPlan } from '../core/plan';
import { num, tt, ttn, uiLocale } from '../i18n';

const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 2.3c.4 3.2 4.9 5.4 4.9 10.6a5.5 5.5 0 0 1-11 0c0-2.5 1.3-4.4 2.9-5.7.1 1.8.9 3 2.1 3.5-.6-3.4.2-6.2 1.1-8.4z"/></svg>';
/** Stands for the number in "{n} day streak", so the words before and after it can go around the big number. */
const MARK = '\u0001';

const minutes = (sec: number) => Math.floor(sec / 60);
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
  const select = h('select.select.goal-select', { 'aria-label': tt('Daily goal') },
    GOALS.map((g) => h('option', { value: String(g) }, tt('{min} min a day', { min: num(g) })))) as HTMLSelectElement;
  select.addEventListener('change', () => setPlan({ goal: Number(select.value) }));
  const el = h('section.goal.card', { 'aria-label': tt('Daily goal and streak') },
    h('div.goal-streak', null, flame, h('div.goal-streak-text', null, h('div', null, lead, count, unit), best)),
    h('div.goal-today', null, today, bar),
    week,
    h('label.goal-set', null, h('span.goal-set-label', null, tt('Goal')), select));

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

  /** The day the card shows as today: past midnight it draws again. */
  let shown = '';
  const draw = () => {
    const plan = getPlan();
    shown = dayOf();
    // The goal this device judges today by, kept for tomorrow (core/activity.ts totals).
    stampToday(plan.goal);
    const s = streak(plan.goal);
    select.value = String(plan.goal);
    el.classList.toggle('met', s.met);
    // The streak's number is drawn big, with the words around it: "5 day streak".
    const current = s.current;
    const [before, after] = current ? ttn(current, '{n} day streak', '{n} day streak', { n: MARK }).split(MARK) : ['', ''];
    lead.textContent = before ?? '';
    count.textContent = current ? num(current) : '';
    unit.textContent = current ? after ?? '' : s.best ? tt('No streak right now') : tt('No streak yet');
    const top = s.best;
    best.textContent = top > current ? ttn(top, 'Best: {n} day', 'Best: {n} days')
      : current ? (s.met ? tt('Goal met today') : tt('Read today to keep it')) : tt('Reach your goal to start one');
    const m = minutes(s.today);
    const goal = s.goal;
    today.textContent = s.met ? tt('{m} min today. Goal of {goal} min reached.', { m: num(m), goal: num(goal) }) : tt('{m} of {goal} min today', { m: num(m), goal: num(goal) });
    fill.style.width = `${Math.min(100, Math.round((s.today / (s.goal * 60)) * 100))}%`;
    bar.setAttribute('aria-valuemax', String(s.goal));
    bar.setAttribute('aria-valuenow', String(Math.min(m, s.goal)));
    bar.setAttribute('aria-label', ttn(goal, '{m} of {n} minute today', '{m} of {n} minutes today', { m: num(m) }));
    week.replaceChildren(...s.week.map((d, i) => dayCell(d, i === s.week.length - 1)));
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
      window.clearInterval(tick);
      window.removeEventListener(ACTIVITY_EVENT, draw);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onNewDay);
      window.removeEventListener('pageshow', onNewDay);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
