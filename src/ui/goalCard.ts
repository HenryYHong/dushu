// The day's goal and the streak, at the top of the library: today's minutes against the goal, the days in a row it was met,
// and the last seven days. Reading in any language, on any device that syncs, counts (core/activity.ts).
import '../styles/goal.css';
import { h } from './dom';
import { ACTIVITY_EVENT, ACTIVITY_KEY, GOALS, dayOf, stampToday, streak, type DayTotal } from '../core/activity';
import { PLAN_KEY, getPlan, setPlan } from '../core/plan';

const FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 2.3c.4 3.2 4.9 5.4 4.9 10.6a5.5 5.5 0 0 1-11 0c0-2.5 1.3-4.4 2.9-5.7.1 1.8.9 3 2.1 3.5-.6-3.4.2-6.2 1.1-8.4z"/></svg>';
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const minutes = (sec: number) => Math.floor(sec / 60);
const weekday = (day: string) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, 12).getDay(); };

export function goalCard(): { el: HTMLElement; dispose(): void } {
  const flame = h('span.goal-flame');
  flame.innerHTML = FLAME;
  const num = h('span.goal-num');
  const unit = h('span.goal-unit');
  const best = h('span.goal-best');
  const today = h('div.goal-today-text');
  const fill = h('span.goal-bar-fill');
  const bar = h('div.goal-bar', { role: 'progressbar', 'aria-valuemin': '0' }, fill);
  const week = h('div.goal-week', { role: 'list', 'aria-label': 'The last seven days' });
  const select = h('select.select.goal-select', { 'aria-label': 'Daily goal' },
    GOALS.map((g) => h('option', { value: String(g) }, `${g} min a day`))) as HTMLSelectElement;
  select.addEventListener('change', () => setPlan({ goal: Number(select.value) }));
  const el = h('section.goal.card', { 'aria-label': 'Daily goal and streak' },
    h('div.goal-streak', null, flame, h('div.goal-streak-text', null, h('div', null, num, unit), best)),
    h('div.goal-today', null, today, bar),
    week,
    h('label.goal-set', null, h('span.goal-set-label', null, 'Goal'), select));

  const dayCell = (d: DayTotal, isToday: boolean) => {
    const part = d.met ? 1 : Math.min(1, d.seconds / (d.goal * 60));
    const state = d.met ? 'met' : d.seconds > 0 ? 'some' : 'none';
    const name = WEEKDAY_NAME[weekday(d.day)];
    // The dot and the letter are pictures; a screen reader reads the day in words.
    const said = `${name}: ${minutes(d.seconds)} of ${d.goal} minutes${d.met ? ', goal met' : ''}${isToday ? ', today' : ''}`;
    return h(`div.goal-day.${state}${isToday ? '.today' : ''}`, { role: 'listitem', title: `${name}: ${minutes(d.seconds)} of ${d.goal} min` },
      h('span.goal-day-dot', { style: state === 'some' ? `--part:${Math.round(part * 100)}%` : null }),
      h('span.goal-day-name', { 'aria-hidden': 'true' }, WEEKDAY[weekday(d.day)]),
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
    num.textContent = s.current ? String(s.current) : '';
    unit.textContent = s.current ? ' day streak' : s.best ? 'No streak right now' : 'No streak yet';
    best.textContent = s.best > s.current ? `Best: ${s.best} ${s.best === 1 ? 'day' : 'days'}` : s.current ? (s.met ? 'Goal met today' : 'Read today to keep it') : `Reach your goal to start one`;
    const m = minutes(s.today);
    today.textContent = s.met ? `${m} min today. Goal of ${s.goal} min reached.` : `${m} of ${s.goal} min today`;
    fill.style.width = `${Math.min(100, Math.round((s.today / (s.goal * 60)) * 100))}%`;
    bar.setAttribute('aria-valuemax', String(s.goal));
    bar.setAttribute('aria-valuenow', String(Math.min(m, s.goal)));
    bar.setAttribute('aria-label', `${m} of ${s.goal} minutes today`);
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
