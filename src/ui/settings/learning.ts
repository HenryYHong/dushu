// Settings' Learning rows: the reader's own language (the app's and the translations'), the languages being learned and the daily
// goal (core/plan.ts), and the welcome screen again.
import type { AppContext } from '../../types';
import { h } from '../dom';
import { LANGS, LANG_IDS } from '../../lang/registry';
import { langId } from '../../lang/active';
import { ACTIVITY_EVENT, GOALS } from '../../core/activity';
import { getPlan, setPlan } from '../../core/plan';
import { radioGroup } from './controls';
import { goalInput } from '../goalInput';
import { markReaderGuide, markSiteGuide } from '../guide';
import { UI_LANGS, UI_NAMES, chooseUiLang, langName, tt, ttn, uiLang } from '../../i18n';

export function learningControls(ctx: AppContext): { own: HTMLElement; langs: HTMLElement; goal: HTMLElement; welcome: HTMLElement; walkthrough: HTMLElement; dispose(): void } {
  // The app is shown in it, and sentences are translated into it (Translation › Translate into changes only that). The page
  // reloads, so every screen is drawn again in the new language.
  const own = h('select.select', { id: 'set-ui-lang', 'aria-label': tt('Your language') },
    UI_LANGS.map((code) => h('option', { value: code, selected: code === uiLang(), lang: code }, UI_NAMES[code]))) as HTMLSelectElement;
  own.addEventListener('change', () => {
    const code = own.value as (typeof UI_LANGS)[number];
    chooseUiLang(code);
    ctx.settings.set({ translateTo: code });
    location.reload();
  });

  const chips = LANG_IDS.map((id) => {
    const b = h('button.set-learn-chip', { type: 'button', 'aria-pressed': 'false', lang: LANGS[id].tag, title: langName(id, LANGS[id].name) },
      LANGS[id].native) as HTMLButtonElement;
    b.addEventListener('click', () => {
      const langs = getPlan().langs;
      setPlan({ langs: langs.includes(id) ? langs.filter((l) => l !== id) : [...langs, id] });
    });
    return b;
  });
  const langs = h('div.set-learn', { role: 'group', 'aria-label': tt('Languages you are learning') }, chips);

  // The goal is the plan's, not a setting: the same radio group as the settings' segmented controls (arrow keys, one tab stop).
  // Custom (0) shows a field for any number of minutes.
  const ownGoal = goalInput(25, (g) => setPlan({ goal: g }));
  const goalRadios = radioGroup(tt('Daily goal'), [...GOALS.map((g) => ({ value: g as number, label: ttn(g, '{n} min', '{n} min') })), { value: 0, label: tt('Custom') }],
    (g) => {
      if (g) { setPlan({ goal: g }); return; }
      ownGoal.el.hidden = false;
      goalRadios.select(0);
      ownGoal.input.focus();
      setPlan({ goal: ownGoal.value() });
    });
  const goal = { el: h('div.set-goal', null, goalRadios.el, ownGoal.el) };

  const welcome = h('button.btn', { type: 'button', onclick: () => {
    void import('../welcome').then((m) => m.showWelcome(ctx.settings, { current: langId(), again: true }));
  } }, tt('Show it again'));
  // The walkthrough (ui/guide.ts): the library's starts as the library opens, and the reader's the next time a book does.
  const walkthrough = h('button.btn', { type: 'button', onclick: () => {
    markReaderGuide(false);
    markSiteGuide('due');
    location.hash = '#/';
  } }, tt('Show it again'));

  // Redrawn when the plan changes here, in another tab or from another device.
  const draw = () => {
    const plan = getPlan();
    chips.forEach((b, i) => b.setAttribute('aria-pressed', String(plan.langs.includes(LANG_IDS[i]))));
    const offered = (GOALS as readonly number[]).includes(plan.goal);
    goalRadios.select(offered ? plan.goal : 0);
    ownGoal.el.hidden = offered && document.activeElement !== ownGoal.input;
    if (!offered) ownGoal.show(plan.goal);
  };
  draw();
  window.addEventListener(ACTIVITY_EVENT, draw);
  return { own, langs, goal: goal.el, welcome, walkthrough, dispose() { window.removeEventListener(ACTIVITY_EVENT, draw); } };
}
