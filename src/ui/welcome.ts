// The welcome screen, on a device's first visit (core/plan.ts needsWelcome) and from Settings: the languages to learn, the
// language translations go into, and a daily goal. Shown before the dictionary downloads, so someone learning Spanish never
// waits for the Chinese one. Finishing opens the first language chosen.
import '../styles/welcome.css';
import globeSvg from './globe.svg?raw';
import { h } from './dom';
import { icon } from './icons';
import { LANGS, LANG_IDS } from '../lang/registry';
import type { LangId } from '../lang/types';
import { switchLang } from '../lang/active';
import { GOALS } from '../core/activity';
import { getPlan, setPlan } from '../core/plan';
import { TARGET_LANGUAGES, isOwnLanguage, targetLanguage } from '../translate/targets';
import type { SettingsStore } from '../types';

/** What each library explains its language in, where that is not English. */
const EXPLAINED: Partial<Record<LangId, string>> = { en: 'Explained in Chinese, for Chinese speakers' };
const GOAL_NAMES: Record<number, string> = { 5: 'Casual', 10: 'Regular', 15: 'Serious', 20: 'Intense', 30: 'Devoted' };

/** The translation language this browser's own languages suggest: zh-TW is Traditional Chinese, pt-BR Portuguese. */
export function suggestedTarget(learning: readonly LangId[], prefs: readonly string[] = navigator.languages ?? [navigator.language]): string {
  const fits = (code: string) => !learning.some((l) => isOwnLanguage(code, l));
  for (const p of prefs) {
    const tag = p.toLowerCase();
    const code = /^zh-(tw|hk|mo|hant)/.test(tag) ? 'zh-Hant' : tag.startsWith('zh') ? 'zh' : tag.startsWith('nb') || tag.startsWith('nn') ? 'no'
      : tag.startsWith('tl') ? 'fil' : tag.split('-')[0];
    if (targetLanguage(code) && fits(code)) return code;
  }
  // Someone learning only English reads it through Chinese (lang/registry.ts); everyone else through English.
  return learning.length === 1 && learning[0] === 'en' ? 'zh' : fits('en') ? 'en' : 'zh';
}

/**
 * Shows the welcome screen over the page. Resolves when it is done and the open library is the one to read; when another
 * language comes first, the page reloads there instead.
 */
export function showWelcome(settings: SettingsStore, opts: { current: LangId; again?: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const plan = getPlan();
    const chosen = new Set<LangId>(plan.langs.length ? plan.langs : opts.again || new URLSearchParams(location.search).has('lang') ? [opts.current] : []);
    let order: LangId[] = [...chosen];
    let target = opts.again ? settings.get().translateTo : '';
    let goal = plan.goal;
    let step = 0;

    const box = h('div.wel-box');
    const overlay = h('div.wel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Globereader' }, box);
    const mark = () => { const el = h('span.wel-mark', { 'aria-hidden': 'true' }); el.innerHTML = globeSvg; return el; };

    const finish = () => {
      const langs = order.filter((l) => chosen.has(l));
      setPlan({ langs, goal, welcomed: Date.now() });
      if (target) settings.set({ translateTo: target });
      if (langs[0] && langs[0] !== opts.current) { switchLang(langs[0]); return; }
      overlay.remove();
      document.body.classList.remove('wel-open');
      resolve();
    };
    const skip = () => {
      setPlan({ welcomed: Date.now() });
      overlay.remove();
      document.body.classList.remove('wel-open');
      resolve();
    };

    const foot = (canGo: boolean, last: boolean, onGo: () => void) => h('div.wel-foot', null,
      step > 0 ? h('button.btn', { type: 'button', onclick: () => { step--; draw(); } }, icon('arrowLeft'), 'Back')
        : h('button.btn.wel-skip', { type: 'button', onclick: opts.again ? () => { overlay.remove(); document.body.classList.remove('wel-open'); resolve(); } : skip }, opts.again ? 'Cancel' : 'Skip'),
      h('span.wel-steps', { 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h(i === step ? 'span.wel-dot.on' : 'span.wel-dot'))),
      h('button.btn.btn-primary', { type: 'button', disabled: !canGo, onclick: onGo }, last ? 'Start reading' : 'Continue', last ? null : icon('chevronRight')));

    const stepLangs = () => {
      const cards = LANG_IDS.map((id) => {
        const L = LANGS[id];
        const b = h('button.wel-lang', { type: 'button', 'aria-pressed': String(chosen.has(id)) },
          h('span.wel-lang-native', { lang: L.tag }, L.native),
          h('span.wel-lang-name', null, L.name),
          EXPLAINED[id] ? h('span.wel-lang-note', null, EXPLAINED[id]) : null,
          h('span.wel-lang-check', { 'aria-hidden': 'true' }, icon('check'))) as HTMLButtonElement;
        b.addEventListener('click', () => {
          if (chosen.has(id)) { chosen.delete(id); order = order.filter((l) => l !== id); } else { chosen.add(id); order.push(id); }
          b.setAttribute('aria-pressed', String(chosen.has(id)));
          go.disabled = !chosen.size;
        });
        return b;
      });
      const f = foot(chosen.size > 0, false, () => { if (!target) target = suggestedTarget(order); step = 1; draw(); });
      const go = f.querySelector<HTMLButtonElement>('.btn-primary')!;
      return [
        h('div.wel-head', null, mark(), h('div', null,
          h('h1.wel-title', null, opts.again ? 'Your languages' : 'Welcome to Globereader'),
          h('p.wel-lede', null, 'Read real books in the language you are learning, with every word a tap away.'))),
        h('h2.wel-q', null, 'What do you want to learn?'),
        h('p.wel-help', null, 'Pick one or more. Each has its own library of classics to start with.'),
        h('div.wel-langs', null, cards),
        f,
      ];
    };

    const stepTarget = () => {
      const learning = order.filter((l) => chosen.has(l));
      const list = [...TARGET_LANGUAGES].sort((a, b) => a.name.localeCompare(b.name, 'en'));
      const select = h('select.select.wel-select', { 'aria-label': 'Translate into' },
        list.map((t) => h('option', { value: t.code, selected: t.code === target }, t.native === t.name ? t.name : `${t.name} · ${t.native}`))) as HTMLSelectElement;
      select.addEventListener('change', () => { target = select.value; note(); });
      const warn = h('p.wel-help.wel-warn', { role: 'status' });
      const note = () => {
        const own = learning.filter((l) => isOwnLanguage(target, l));
        warn.hidden = !own.length;
        warn.textContent = own.length ? `${LANGS[own[0]].name} books will still be translated into ${own[0] === 'en' ? 'Chinese' : 'English'}, since that is the language they are in.` : '';
      };
      note();
      return [
        h('h2.wel-q', null, 'Translate into'),
        h('p.wel-help', null, 'Tap a sentence or a paragraph and it is translated into this language. Pick the one you know best. You can change it any time in Settings.'),
        select,
        warn,
        h('p.wel-help.wel-small', null, learning.includes('en') && learning.length === 1
          ? 'Word cards explain English words in Chinese, whatever you pick here.'
          : `Word cards give short meanings in English${learning.includes('en') ? ' (in Chinese for English books)' : ''}, whatever you pick here.`),
        foot(true, false, () => { step = 2; draw(); }),
      ];
    };

    const stepGoal = () => {
      const opts2 = GOALS.map((g) => {
        const b = h('button.wel-goal', { type: 'button', 'aria-pressed': String(g === goal) },
          h('span.wel-goal-min', null, `${g} min`), h('span.wel-goal-name', null, GOAL_NAMES[g] ?? '')) as HTMLButtonElement;
        b.addEventListener('click', () => {
          goal = g;
          for (const o of box.querySelectorAll('.wel-goal')) o.setAttribute('aria-pressed', String(o === b));
        });
        return b;
      });
      return [
        h('h2.wel-q', null, 'Set a daily goal'),
        h('p.wel-help', null, 'Minutes of reading or review a day. Each day you reach it adds a day to your streak.'),
        h('div.wel-goals', null, opts2),
        foot(true, true, finish),
      ];
    };

    const draw = () => {
      box.replaceChildren(...(step === 0 ? stepLangs() : step === 1 ? stepTarget() : stepGoal()));
      box.scrollTop = 0;
      overlay.scrollTop = 0;
      const head = box.querySelector<HTMLElement>('h1, h2');
      head?.setAttribute('tabindex', '-1');
      head?.focus({ preventScroll: true });
    };
    draw();
    document.body.classList.add('wel-open');
    document.body.appendChild(overlay);
  });
}
