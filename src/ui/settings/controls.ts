// Form controls for the settings screen. Each one is driven by an update(settings) function so the
// settings store stays the single source of truth (a change in another tab also updates the page).
import type { Settings } from '../../types';
import { h } from '../dom';
import { choiceGlide } from '../choiceGlide';
import { tt } from '../../i18n';

export interface Control {
  el: HTMLElement;
  update(s: Settings): void;
}

let uid = 0;
export const nextId = (prefix = 'set') => `${prefix}-${++uid}`;

/** A labeled row: name and help on the left, the control on the right (stacked on small screens). */
export function row(label: string, help: string | null, control: Control | Node, forId?: string): HTMLElement {
  const ctrl = 'el' in control ? control.el : control;
  return h('div.set-row', null,
    h('div.set-row-text', null,
      h(forId ? 'label.set-label' : 'div.set-label', forId ? { for: forId } : null, label),
      help ? h('div.set-help', null, help) : null),
    h('div.set-row-ctrl', null, ctrl));
}

/**
 * A row of buttons that is one radio group: the arrow keys move the choice, and only the chosen button is a tab stop (a roving
 * tabindex). `select` marks a value as chosen; the caller calls it whenever the value changes, wherever it is kept.
 */
export function radioGroup<T>(label: string, options: { value: T; label: string }[], set: (v: T) => void): { el: HTMLElement; select(v: T): void } {
  // True while a choice made here (a tap, an arrow key) is being saved, which marks it chosen at once (the stores tell their
  // listeners as they change): only that slides the highlight, never the first draw or a change made somewhere else.
  let byHand = false;
  const choose = (v: T) => {
    byHand = true;
    try { set(v); } finally { byHand = false; }
  };
  const buttons = options.map((o) => h('button.set-seg-btn', {
    type: 'button', role: 'radio', 'aria-checked': 'false',
    onclick: () => choose(o.value),
  }, o.label) as HTMLButtonElement);
  const el = h('div.set-seg', { role: 'radiogroup', 'aria-label': label }, buttons);
  const glide = choiceGlide(el, 'set-seg');
  el.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[n].focus();
    choose(options[n].value);
  });
  return {
    el,
    select(v) {
      const was = buttons.find((b) => b.getAttribute('aria-checked') === 'true');
      const from = byHand ? glide.from(was) : null;
      options.forEach((o, i) => {
        const on = o.value === v;
        buttons[i].setAttribute('aria-checked', String(on));
        buttons[i].tabIndex = on ? 0 : -1;
      });
      const now = buttons[options.findIndex((o) => o.value === v)];
      if (now === was) return;
      if (from && now) glide.to(now, from);
      else glide.stop();
    },
  };
}

/** Segmented control for a setting (a radio group): one button per option. */
export function segmented<K extends keyof Settings>(
  key: K,
  label: string,
  options: { value: Settings[K]; label: string }[],
  set: (v: Settings[K]) => void,
): Control {
  const group = radioGroup(label, options, set);
  return { el: group.el, update(s) { group.select(s[key]); } };
}

export function toggle(key: keyof Settings & string, label: string, set: (v: boolean) => void): Control & { input: HTMLInputElement } {
  const input = h('input.set-switch-input', { type: 'checkbox', role: 'switch', 'aria-label': label }) as HTMLInputElement;
  input.addEventListener('change', () => set(input.checked));
  const el = h('label.set-switch', null, input, h('span.set-switch-track', null, h('span.set-switch-thumb')));
  return { el, input, update(s) { input.checked = s[key] === true; } };
}

export function slider(
  key: (keyof Settings & string) | ((s: Settings) => number),
  label: string,
  o: { min: number; max: number; step: number; unit?: string; format?: (n: number) => string },
  set: (v: number) => void,
): Control & { input: HTMLInputElement } {
  const input = h('input.set-range', { type: 'range', min: o.min, max: o.max, step: o.step, 'aria-label': label }) as HTMLInputElement;
  const out = h('output.set-range-out');
  const fmt = o.format ?? ((n: number) => `${n}${o.unit ?? ''}`);
  input.addEventListener('input', () => set(Number(input.value)));
  return {
    el: h('div.set-range-wrap', null, input, out),
    input,
    update(s) {
      const v = Number(typeof key === 'function' ? key(s) : s[key]);
      input.value = String(v);
      out.textContent = fmt(v);
      input.style.setProperty('--set-fill', `${((v - o.min) / (o.max - o.min)) * 100}%`);
    },
  };
}

/** A settings group: heading plus a card of rows. */
export function group(title: string, intro: string | null, ...rows: (Node | null)[]): HTMLElement {
  return h('section.set-group', null,
    h('h2.section-title.set-group-title', null, title),
    intro ? h('p.set-group-intro', null, intro) : null,
    h('div.set-card.card', null, rows.filter((r): r is Node => !!r)));
}

/**
 * The rows most readers never change, folded under "More settings" at the foot of a group, so the page shows only the few that
 * matter. Once opened it stays open on this device; `open` opens it now (a link to that section).
 */
export function more(key: string, rows: (Node | null)[], open = false): HTMLDetailsElement {
  const stored = `dushu.settings.more.${key}`;
  let kept = false;
  try { kept = localStorage.getItem(stored) === '1'; } catch { /* storage blocked: it starts folded */ }
  const el = h('details.set-more', { open: open || kept },
    h('summary.set-more-title', null, h('span.set-more-show', null, tt('More settings')), h('span.set-more-hide', null, tt('Fewer settings'))),
    rows.filter((r): r is Node => !!r)) as HTMLDetailsElement;
  el.addEventListener('toggle', () => {
    try { if (el.open) localStorage.setItem(stored, '1'); else localStorage.removeItem(stored); } catch { /* storage blocked */ }
  });
  return el;
}
