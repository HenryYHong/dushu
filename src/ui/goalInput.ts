// A daily goal of the reader's own (Custom, beside the 5 to 30 minutes offered): any whole number of minutes from 1 to
// GOAL_MAX. Set when the field changes (Enter, or leaving it); a number out of range is brought into it, anything else ignored.
import { h } from './dom';
import { GOAL_MAX, isGoal } from '../core/activity';
import { tt } from '../i18n';

export interface GoalInput {
  el: HTMLElement;
  input: HTMLInputElement;
  /** The minutes in the field, brought into range. */
  value(): number;
  /** Shows `minutes` in the field (a goal set elsewhere). */
  show(minutes: number): void;
}

export function goalInput(minutes: number, onSet: (minutes: number) => void, cls = ''): GoalInput {
  const input = h('input.input.goal-input', {
    type: 'number', min: '1', max: String(GOAL_MAX), step: '1', inputmode: 'numeric', value: String(minutes),
    'aria-label': tt('Minutes a day'),
  }) as HTMLInputElement;
  const value = (): number => {
    const n = Math.round(Number(input.value));
    return Number.isFinite(n) && n > 0 ? Math.min(GOAL_MAX, n) : minutes;
  };
  input.addEventListener('change', () => {
    const n = value();
    input.value = String(n);
    if (isGoal(n)) { minutes = n; onSet(n); }
  });
  const el = h(`label.goal-own${cls ? `.${cls}` : ''}`, null, input, h('span.goal-own-unit', null, tt('min a day')));
  return { el, input, value, show(m) { minutes = m; if (document.activeElement !== input) input.value = String(m); } };
}
