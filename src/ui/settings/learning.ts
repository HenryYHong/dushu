// Settings' Learning rows: the languages being learned and the daily goal (core/plan.ts), and the welcome screen again.
import type { AppContext } from '../../types';
import { h } from '../dom';
import { LANGS, LANG_IDS } from '../../lang/registry';
import { langId } from '../../lang/active';
import { ACTIVITY_EVENT, GOALS } from '../../core/activity';
import { getPlan, setPlan } from '../../core/plan';

export function learningControls(ctx: AppContext): { langs: HTMLElement; goal: HTMLElement; welcome: HTMLElement } {
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

  const goalButtons = GOALS.map((g) => h('button.set-seg-btn', { type: 'button', role: 'radio', 'aria-checked': 'false',
    onclick: () => setPlan({ goal: g }) }, `${g} min`) as HTMLButtonElement);
  const goal = h('div.set-seg', { role: 'radiogroup', 'aria-label': 'Daily goal' }, goalButtons);

  const welcome = h('button.btn', { type: 'button', onclick: () => {
    void import('../welcome').then((m) => m.showWelcome(ctx.settings, { current: langId(), again: true }));
  } }, 'Show it again');

  const draw = () => {
    const plan = getPlan();
    chips.forEach((b, i) => b.setAttribute('aria-pressed', String(plan.langs.includes(LANG_IDS[i]))));
    goalButtons.forEach((b, i) => b.setAttribute('aria-checked', String(GOALS[i] === plan.goal)));
  };
  draw();
  // The rows go when the screen does; a listener left behind only redraws buttons nobody sees.
  window.addEventListener(ACTIVITY_EVENT, () => { if (langs.isConnected) draw(); });
  return { langs, goal, welcome };
}
