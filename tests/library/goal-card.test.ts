// @vitest-environment jsdom
// The goal card at the top of the library (ui/goalCard.ts): its words, the week for screen readers, and a new day at midnight.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goalCard } from '../../src/ui/goalCard';
import { ACTIVITY_EVENT, ACTIVITY_KEY, addDays, addSeconds, dayOf } from '../../src/core/activity';
import { setPlan } from '../../src/core/plan';

const NOW = new Date(2026, 10, 9, 15, 0).getTime(); // a Monday
const TODAY = dayOf(NOW);
const at = (day: string, hour = 12) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, hour).getTime(); };
const text = (el: HTMLElement, sel: string) => el.querySelector(sel)!.textContent;

let card: ReturnType<typeof goalCard> | null = null;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => { card?.dispose(); card = null; vi.useRealTimers(); document.body.innerHTML = ''; });

describe('the goal card', () => {
  it('says "Best: 1 day", and "No streak right now" to someone who had one', () => {
    addSeconds('es', 700, 10, at(addDays(TODAY, -3)));
    card = goalCard();
    expect(text(card.el, '.goal-unit')).toBe('No streak right now');
    expect(text(card.el, '.goal-best')).toBe('Best: 1 day');
    card.dispose();
    for (const d of [-7, -6, -5]) addSeconds('es', 700, 10, at(addDays(TODAY, d)));
    card = goalCard();
    expect(text(card.el, '.goal-best')).toBe('Best: 3 days');
    card.dispose();
    localStorage.clear();
    card = goalCard();
    expect(text(card.el, '.goal-unit')).toBe('No streak yet');
    expect(text(card.el, '.goal-best')).toBe('Reach your goal to start one');
  });

  it('reads the seven days to a screen reader, with the goal set now on the days without reading', () => {
    setPlan({ goal: 20 });
    addSeconds('es', 21 * 60, 20, at(addDays(TODAY, -3)));
    card = goalCard();
    const week = card.el.querySelector('.goal-week')!;
    expect(week.getAttribute('role')).toBe('list');
    expect(week.getAttribute('aria-label')).toBe('The last seven days');
    const days = [...week.querySelectorAll<HTMLElement>('.goal-day')];
    expect(days.map((d) => d.getAttribute('role'))).toEqual(Array(7).fill('listitem'));
    const said = days.map((d) => d.querySelector('.goal-sr')!.textContent);
    expect(said[3]).toBe('Friday: 21 of 20 minutes, goal met');
    expect(said[6]).toBe('Monday: 0 of 20 minutes, today');
    expect(said[0]).toBe('Tuesday: 0 of 20 minutes');
    // The tooltips too: 20 on every day, not 10 on the empty ones.
    expect(days.map((d) => d.title)).toEqual(['Tuesday: 0 of 20 min', 'Wednesday: 0 of 20 min', 'Thursday: 0 of 20 min', 'Friday: 21 of 20 min', 'Saturday: 0 of 20 min', 'Sunday: 0 of 20 min', 'Monday: 0 of 20 min']);
    expect(days[0].querySelector('.goal-day-name')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws a new day within a minute of midnight, with nothing else happening', () => {
    vi.setSystemTime(new Date(2026, 10, 9, 23, 59, 30));
    addSeconds('es', 600, 10, at(TODAY, 20));
    card = goalCard();
    expect(text(card.el, '.goal-best')).toBe('Goal met today');
    expect(card.el.querySelector('.goal-day.today')!.getAttribute('title')).toBe('Monday: 10 of 10 min');
    vi.advanceTimersByTime(61_000);
    expect(text(card.el, '.goal-best')).toBe('Read today to keep it');
    expect(text(card.el, '.goal-today-text')).toBe('0 of 10 min today');
    expect(card.el.querySelector('.goal-day.today')!.getAttribute('title')).toBe('Tuesday: 0 of 10 min');
  });

  it('stops drawing once disposed', () => {
    card = goalCard();
    card.dispose();
    const before = card.el.innerHTML;
    vi.setSystemTime(new Date(2026, 10, 10, 9, 0));
    vi.advanceTimersByTime(120_000);
    window.dispatchEvent(new Event('focus'));
    expect(card.el.innerHTML).toBe(before);
    card = null;
  });

  it('stamps the goal it showed for today without telling the page (no draw loop)', () => {
    let events = 0;
    const count = () => { events++; };
    window.addEventListener(ACTIVITY_EVENT, count);
    card = goalCard();
    window.removeEventListener(ACTIVITY_EVENT, count);
    expect(events).toBe(0);
    const saved = JSON.parse(localStorage.getItem(ACTIVITY_KEY)!);
    expect(Object.values(saved.days[TODAY])).toEqual([{ s: {}, g: 10, t: NOW }]);
  });

  it('fills today\'s bar to its share of the goal, with a transform', () => {
    addSeconds('es', 6 * 60, 10, at(TODAY, 9));
    card = goalCard();
    // jsdom has no IntersectionObserver: the bar is filled at once, as for a reader who never sees it come on screen.
    expect(card.el.querySelector<HTMLElement>('.goal-bar-fill')!.style.transform).toBe('translateX(-40%)');
    addSeconds('es', 20 * 60, 10, at(TODAY, 10));
    window.dispatchEvent(new Event(ACTIVITY_EVENT));
    expect(card.el.querySelector<HTMLElement>('.goal-bar-fill')!.style.transform).toBe('translateX(0%)');
  });

  it('rolls the streak number in only when it changes', () => {
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    const rolled: Element[] = [];
    proto.animate = function (this: Element) { rolled.push(this); return {}; };
    try {
      for (const d of [-2, -1]) addSeconds('es', 700, 10, at(addDays(TODAY, d)));
      card = goalCard();
      expect(text(card.el, '.goal-num')).toBe('2');
      window.dispatchEvent(new Event(ACTIVITY_EVENT));
      expect(rolled).toEqual([]);
      addSeconds('es', 700, 10, at(TODAY, 9));
      window.dispatchEvent(new Event(ACTIVITY_EVENT));
      expect(text(card.el, '.goal-num')).toBe('3');
      expect(rolled).toEqual([card.el.querySelector('.goal-num')]);
    } finally { delete proto.animate; }
  });
});
