// The welcome screen, on a device's first visit (core/plan.ts needsWelcome) and from Settings: the languages to learn, the
// language translations go into, and a daily goal. Shown before the dictionary downloads, so someone learning Spanish never
// waits for the Chinese one. Finishing opens the first language chosen (from Settings, only when the open one was dropped).
import '../styles/welcome.css';
import globeSvg from './globe.svg?raw';
import { h } from './dom';
import { icon } from './icons';
import { LANGS, LANG_IDS } from '../lang/registry';
import type { LangId } from '../lang/types';
import { switchLang } from '../lang/active';
import { GOALS } from '../core/activity';
import { getPlan, setPlan, type Plan } from '../core/plan';
import { TARGET_LANGUAGES, isOwnLanguage, targetFor, targetLanguage, type TargetLanguage } from '../translate/targets';
import { markLangChoice } from './langSwitch';
import { markSiteGuide } from './guide';
import { chooseUiLang, isUiLang, langName, num, tt, ttm, uiLang, uiLocale } from '../i18n';
import type { SettingsStore } from '../types';

/** What each library explains its language in, where that is not English. Shown with tt. */
const EXPLAINED: Partial<Record<LangId, string>> = { en: ttm('For Chinese speakers') };
const GOAL_NAMES: Record<number, string> = { 5: ttm('Casual'), 10: ttm('Regular'), 15: ttm('Serious'), 20: ttm('Intense'), 30: ttm('Devoted') };

/** A translation language named in the app's language: `english` as the list or a sentence has it ("Simplified Chinese"). */
const targetName = (t: TargetLanguage, english = t.name): string => langName(t.code === 'zh' ? 'zh-Hans' : t.code, english);
/** Two names said once when they are the same ("English · English", "Español · español"). */
const same = (a: string, b: string): boolean => a.toLocaleLowerCase() === b.toLocaleLowerCase();

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
 * Shows the welcome screen over the page, as a modal dialog. Resolves when it is done and the open library is the one to
 * read; when another language comes first, the page reloads there instead.
 */
export function showWelcome(settings: SettingsStore, opts: { current: LangId; again?: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const plan = getPlan();
    const chosen = new Set<LangId>(plan.langs.length ? plan.langs : opts.again || new URLSearchParams(location.search).has('lang') ? [opts.current] : []);
    let order: LangId[] = [...chosen];
    let target = opts.again ? settings.get().translateTo : '';
    // The guess from the browser's languages. Made again when the languages change, unless a language was picked by hand.
    let suggested = '';
    let goal = plan.goal;
    let step = 0;
    let done = false;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const learning = () => order.filter((l) => chosen.has(l));
    // On the first visit what is picked is kept as it is picked (still unfinished), so a reload in the middle comes back to it.
    // From Settings nothing changes until Done: Cancel leaves the plan as it was.
    const keep = (patch: Partial<Plan>) => { if (!opts.again) setPlan(patch); };
    const guessTarget = () => {
      if (target && target !== suggested) return;
      suggested = suggestedTarget(learning());
      target = suggested;
    };

    const box = h('div.wel-box');
    const dlg = h('dialog.wel', { 'aria-label': tt('Welcome to Globereader') }, box) as HTMLDialogElement;
    const mark = () => { const el = h('span.wel-mark', { 'aria-hidden': 'true' }); el.innerHTML = globeSvg; return el; };

    const close = () => {
      if (done) return;
      done = true;
      if (typeof dlg.close === 'function' && dlg.open) dlg.close();
      dlg.remove();
      document.body.classList.remove('wel-open');
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      resolve();
    };
    const finish = () => {
      const langs = learning();
      // A goal left as it was is not a new choice: a new device's untouched default must not replace the one the account has.
      setPlan({ langs, goal, ...(goal === plan.goal ? { goalAt: getPlan().goalAt } : {}), welcomed: Date.now() });
      if (target) settings.set({ translateTo: target });
      // The reader's own language: the app is shown in it when it has it (src/i18n). A new language needs the page drawn again.
      const reshow = !!target && isUiLang(target) && target !== uiLang();
      if (target && isUiLang(target)) chooseUiLang(target);
      // The first visit goes on to the library's walkthrough (ui/siteGuide.ts), and the reader's when a book opens.
      if (!opts.again) markSiteGuide('due');
      // From Settings the open library stays while it is still one being learned. The first visit opens the first one chosen.
      const next = opts.again ? (langs.includes(opts.current) ? undefined : langs[0]) : langs[0] !== opts.current ? langs[0] : undefined;
      if (next) { done = true; switchLang(next); return; }
      if (reshow) { done = true; location.reload(); return; }
      close();
    };
    const skip = () => {
      // A language picked before Skip is kept: that library opens, with the translation language the browser suggests.
      if (chosen.size) { guessTarget(); finish(); return; }
      setPlan({ welcomed: Date.now() });
      const guess = suggestedTarget([]);
      if (targetLanguage(guess)) settings.set({ translateTo: guess });
      // The bar then shows the language chip, the way to another library.
      markLangChoice();
      close();
    };

    const foot = (canGo: boolean, last: boolean, onGo: () => void) => h('div.wel-foot', null,
      step > 0 ? h('button.btn', { type: 'button', onclick: () => { step--; draw(); } }, icon('arrowLeft'), tt('Back'))
        : h('button.btn.btn-ghost.wel-skip', { type: 'button', onclick: opts.again ? close : skip }, opts.again ? tt('Cancel') : tt('Skip')),
      h('span.wel-sr', null, tt('Step {step} of {total}', { step: num(step + 1), total: num(3) })),
      h('span.wel-steps', { 'aria-hidden': 'true' }, [0, 1, 2].map((i) => h(i === step ? 'span.wel-dot.on' : 'span.wel-dot'))),
      h('button.btn.btn-primary', { type: 'button', disabled: !canGo, onclick: onGo },
        last ? (opts.again ? tt('Done') : tt('Go to my library')) : tt('Continue'), last ? null : icon('chevronRight')));

    const stepLangs = () => {
      const cards = LANG_IDS.map((id) => {
        const L = LANGS[id];
        const name = langName(id, L.name);
        const note = EXPLAINED[id];
        const b = h('button.wel-lang', { type: 'button', 'aria-pressed': String(chosen.has(id)) },
          h('span.wel-lang-native', { lang: L.tag }, L.native),
          // English is English in English too, and Español Spanish in Spanish: said once.
          !same(name, L.native) ? h('span.wel-lang-name', null, name) : null,
          note ? h('span.wel-lang-note', null, tt(note)) : null,
          h('span.wel-lang-check', { 'aria-hidden': 'true' }, icon('check'))) as HTMLButtonElement;
        b.addEventListener('click', () => {
          if (chosen.has(id)) { chosen.delete(id); order = order.filter((l) => l !== id); } else { chosen.add(id); order.push(id); }
          b.setAttribute('aria-pressed', String(chosen.has(id)));
          go.disabled = !chosen.size;
          keep({ langs: learning() });
        });
        return b;
      });
      const f = foot(chosen.size > 0, false, () => { guessTarget(); step = 1; draw(); });
      const go = f.querySelector<HTMLButtonElement>('.btn-primary')!;
      return [
        h('div.wel-head', null, mark(), h('div', null,
          h('h1.wel-title', null, opts.again ? tt('Your languages') : tt('Welcome to Globereader')),
          h('p.wel-lede', null, tt('Read real books in the language you’re learning. Tap any word to see what it means.')))),
        h('h2.wel-q', null, tt('What do you want to learn?')),
        h('p.wel-help', null, tt('Pick one or more. Each comes with free classic books.')),
        h('div.wel-langs', null, cards),
        f,
      ];
    };

    const stepTarget = () => {
      const langs = learning();
      // By name in the app's language, then each in its own ("German · Deutsch").
      const list = TARGET_LANGUAGES.map((t) => ({ t, name: targetName(t) })).sort((a, b) => a.name.localeCompare(b.name, uiLocale()));
      const select = h('select.select.wel-select', { 'aria-label': tt('Your language') },
        list.map(({ t, name }) => h('option', { value: t.code, selected: t.code === target }, same(name, t.native) ? name : `${name} · ${t.native}`))) as HTMLSelectElement;
      // Picked by hand: kept, whatever languages come next.
      select.addEventListener('change', () => { target = select.value; suggested = ''; note(); });
      const warn = h('p.wel-help.wel-warn', { role: 'status' });
      const note = () => {
        const own = langs.filter((l) => isOwnLanguage(target, l));
        warn.hidden = !own.length;
        if (!own.length) { warn.textContent = ''; return; }
        // What the translator really does with a book in the language picked (translate/targets.ts targetFor).
        const name = langName(own[0], LANGS[own[0]].name);
        const into = targetLanguage(targetFor(target, own[0]));
        warn.textContent = tt('{lang} books will be translated into {into} instead.',
          { lang: name, into: into ? targetName(into, into.prompt ?? into.name) : langName('en', 'English') });
      };
      // Where word meanings come from: an English dictionary, a Chinese one for English books. Said only when that is not the
      // reader's language, with the card's way to translate them (translate/meanings.ts).
      const dicts = new Set(langs.map((l) => (l === 'en' ? 'zh' : 'en')));
      const meanings = h('p.wel-help.wel-small');
      const sayMeanings = () => {
        const mine = target.split('-')[0];
        const other = [...dicts].some((d) => d !== mine);
        meanings.hidden = !other;
        meanings.textContent = !other ? '' : dicts.size > 1 ? tt('Word meanings are in English (in Chinese for English books). Word cards can translate them for you.')
          : dicts.has('zh') ? tt('Word meanings are in Chinese. Word cards can translate them for you.')
            : tt('Word meanings are in English. Word cards can translate them for you.');
      };
      sayMeanings();
      select.addEventListener('change', sayMeanings);
      note();
      return [
        h('h2.wel-q', null, tt('Your language')),
        h('p.wel-help', null, tt('The one you know best. Sentences you translate are shown in it, and it will be the default language of your home screen. You can change it any time in Settings.')),
        select,
        warn,
        meanings,
        foot(true, false, () => { step = 2; draw(); }),
      ];
    };

    const stepGoal = () => {
      const at = Math.max(0, GOALS.indexOf(goal as (typeof GOALS)[number]));
      const buttons = GOALS.map((g, i) => h('button.wel-goal', { type: 'button', role: 'radio', 'aria-checked': String(i === at), tabindex: i === at ? 0 : -1 },
        h('span.wel-goal-min', null, tt('{min} min', { min: num(g) })), h('span.wel-goal-name', null, GOAL_NAMES[g] ? tt(GOAL_NAMES[g]) : '')) as HTMLButtonElement);
      const pick = (i: number) => {
        goal = GOALS[i];
        keep({ goal });
        buttons.forEach((b, j) => { b.setAttribute('aria-checked', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
      };
      buttons.forEach((b, i) => b.addEventListener('click', () => pick(i)));
      const group = h('div.wel-goals', { role: 'radiogroup', 'aria-label': tt('Daily goal') }, buttons);
      // A radio group: one tab stop, and the arrows move the choice.
      group.addEventListener('keydown', (ev) => {
        const e = ev as KeyboardEvent;
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (i < 0) return;
        const n = buttons.length;
        const k = e.key;
        const to = k === 'ArrowRight' || k === 'ArrowDown' ? (i + 1) % n : k === 'ArrowLeft' || k === 'ArrowUp' ? (i - 1 + n) % n
          : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1;
        if (to < 0) return;
        e.preventDefault();
        pick(to);
        buttons[to].focus();
      });
      return [
        h('h2.wel-q', null, tt('Set a daily goal')),
        h('p.wel-help', null, tt('Minutes of reading or review a day. Hit it every day to build a streak. You can change it later.')),
        group,
        foot(true, true, finish),
      ];
    };

    const draw = () => {
      box.replaceChildren(...(step === 0 ? stepLangs() : step === 1 ? stepTarget() : stepGoal()));
      box.scrollTop = 0;
      dlg.scrollTop = 0;
      const head = box.querySelector<HTMLElement>('h1, h2');
      head?.setAttribute('tabindex', '-1');
      head?.focus({ preventScroll: true });
    };

    // Esc is Cancel from Settings. On the first visit there is nothing behind it to go back to, so it does nothing (and never
    // counts as Skip). Handled on the key, so the browser never starts closing the dialog itself.
    dlg.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (opts.again) close();
    });
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (opts.again) close();
    });
    // A close the page could not stop (a second back gesture in a row): from Settings it is a Cancel; the first visit stays.
    dlg.addEventListener('close', () => {
      if (done) return;
      if (opts.again) close();
      else if (dlg.isConnected && typeof dlg.showModal === 'function') dlg.showModal();
    });

    document.body.classList.add('wel-open');
    document.body.appendChild(dlg);
    // jsdom has no showModal; a plain open attribute is enough there.
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    draw();
  });
}
