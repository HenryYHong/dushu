// Form controls for the settings screen. Each one is driven by an update(settings) function so the
// settings store stays the single source of truth (a change in another tab also updates the page).
import type { Settings } from '../../types';
import { h } from '../dom';

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

/** Segmented control (a radio group): one button per option. */
export function segmented<K extends keyof Settings>(
  key: K,
  label: string,
  options: { value: Settings[K]; label: string }[],
  set: (v: Settings[K]) => void,
): Control {
  const buttons = options.map((o) => h('button.set-seg-btn', {
    type: 'button', role: 'radio', 'aria-checked': 'false',
    onclick: () => set(o.value),
  }, o.label) as HTMLButtonElement);
  const el = h('div.set-seg', { role: 'radiogroup', 'aria-label': label }, buttons);
  el.addEventListener('keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const n = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[n].focus();
    set(options[n].value);
  });
  return {
    el,
    update(s) {
      options.forEach((o, i) => {
        const on = s[key] === o.value;
        buttons[i].setAttribute('aria-checked', String(on));
        buttons[i].tabIndex = on ? 0 : -1;
      });
    },
  };
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
