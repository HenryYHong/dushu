// Settings' Learning rows: the languages being learned and the daily goal (core/plan.ts), and the welcome screen again.
import type { AppContext } from '../../types';
import { h } from '../dom';
import { LANGS, LANG_IDS } from '../../lang/registry';
import { langId } from '../../lang/active';
import { ACTIVITY_EVENT, GOALS } from '../../core/activity';
import { getPlan, setPlan } from '../../core/plan';
import { radioGroup } from './controls';

export function learningControls(ctx: AppContext): { langs: HTMLElement; goal: HTMLElement; welcome: HTMLElement; dispose(): void } {
  const chips = LANG_IDS.map((id) => {
    const b = h('button.set-learn-chip', { type: 'button', 'aria-pressed': 'false', lang: LANGS[id].tag, title: LANGS[id].name },
      LANGS[id].native) as HTMLButtonElement;
    b.addEventListener('click', () => {
      const langs = getPlan().langs;
      setPlan({ langs: langs.includes(id) ? langs.filter((l) => l !== id) : [...langs, id] });
    });
    return b;
  });
  const langs = h('div.set-learn', { role: 'group', 'aria-label': 'Languages you are learning' }, chips);

  // The goal is the plan's, not a setting: the same radio group as the settings' segmented controls (arrow keys, one tab stop).
  const goal = radioGroup('Daily goal', GOALS.map((g) => ({ value: g as number, label: `${g} min` })), (g) => setPlan({ goal: g }));

  const welcome = h('button.btn', { type: 'button', onclick: () => {
    void import('../welcome').then((m) => m.showWelcome(ctx.settings, { current: langId(), again: true }));
  } }, 'Show it again');

  // Redrawn when the plan changes here, in another tab or from another device.
  const draw = () => {
    const plan = getPlan();
    chips.forEach((b, i) => b.setAttribute('aria-pressed', String(plan.langs.includes(LANG_IDS[i]))));
    goal.select(plan.goal);
  };
  draw();
  window.addEventListener(ACTIVITY_EVENT, draw);
  return { langs, goal: goal.el, welcome, dispose() { window.removeEventListener(ACTIVITY_EVENT, draw); } };
}
