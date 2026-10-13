// Popover menus for the reader's top bar: pinyin mode and the Aa display menu, plus the shortcuts sheet.
import type { AppContext, PinyinMode, Settings } from '../../types';
import { readingFontSizeKey } from '../../store/settings';
import { h } from '../dom';
import { icon } from '../icons';
import { SHORTCUTS as SHORTCUT_GROUPS } from '../shortcuts';

export interface Popover { el: HTMLElement; anchor: HTMLElement; close(): void }

let current: Popover | null = null;

export function closePopover(): void {
  current?.close();
}

export function popoverOpenFor(anchor: HTMLElement): boolean {
  return current?.anchor === anchor;
}

/** A small panel under `anchor`. Clicking the anchor again, pressing Esc or clicking elsewhere closes it. */
export function openPopover(anchor: HTMLElement, content: HTMLElement, onClose?: () => void): Popover {
  closePopover();
  const el = h('div.rd-pop', { role: 'dialog' }, content);
  const pop: Popover = {
    el,
    anchor,
    close() {
      if (current !== pop) return;
      current = null;
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      anchor.setAttribute('aria-expanded', 'false');
      el.remove();
      onClose?.();
    },
  };
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (el.contains(t) || anchor.contains(t)) return;
    pop.close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); pop.close(); }
  };
  const place = () => {
    const r = anchor.getBoundingClientRect();
    if (window.innerWidth < 640) {
      Object.assign(el.style, { left: '8px', right: '8px', width: 'auto', top: `${Math.round(r.bottom + 6)}px` });
    } else {
      const w = el.offsetWidth || 320;
      const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
      Object.assign(el.style, { left: `${Math.round(left)}px`, right: 'auto', width: '', top: `${Math.round(r.bottom + 6)}px` });
    }
    el.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 20)}px`;
  };
  document.body.appendChild(el);
  place();
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  current = pop;
  return pop;
}

// ---------------------------------------------------------------- controls ---

function segmented<T extends string>(
  options: { value: T; label: string; title?: string; cls?: string }[],
  get: () => T,
  set: (v: T) => void,
): { el: HTMLElement; sync(): void } {
  const buttons = options.map((o) => h('button.rd-seg-btn', { type: 'button', title: o.title, class: o.cls, onclick: () => set(o.value) }, o.label));
  const el = h('div.rd-seg', { role: 'group' }, buttons);
  const sync = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === get())));
  sync();
  return { el, sync };
}

function row(label: string, control: Node, hint?: string): HTMLElement {
  if (control instanceof HTMLElement) {
    if (control.matches('[role="group"], [role="switch"]')) control.setAttribute('aria-label', label);
    control.querySelector('input[type="range"]')?.setAttribute('aria-label', label);
  }
  return h('div.rd-row', null, h('div.rd-row-label', null, label, hint ? h('span.rd-row-hint', null, hint) : null), control);
}

function toggle(get: () => boolean, set: (v: boolean) => void): { el: HTMLElement; sync(): void } {
  const btn = h('button.rd-switch', { type: 'button', role: 'switch', onclick: () => set(!get()) }, h('span.rd-switch-dot'));
  const sync = () => btn.setAttribute('aria-checked', String(get()));
  sync();
  return { el: btn, sync };
}

function slider(min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) {
  const out = h('span.rd-slider-out');
  const input = h('input.rd-slider', { type: 'range', min, max, step, value: get() }) as HTMLInputElement;
  input.addEventListener('input', () => { out.textContent = fmt(Number(input.value)); set(Number(input.value)); });
  const el = h('div.rd-slider-wrap', null, input, out);
  const sync = () => { input.value = String(get()); out.textContent = fmt(get()); };
  sync();
  return { el, sync };
}

export const PINYIN_MODES: { value: PinyinMode; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'No pinyin' },
  { value: 'all', label: 'All', hint: 'Pinyin over every word' },
  { value: 'unknown', label: 'Unknown', hint: 'Hide words you marked as known' },
  { value: 'hsk', label: 'HSK', hint: 'Hide words at or below an HSK level' },
];

export function pinyinModeLabel(m: PinyinMode): string {
  return PINYIN_MODES.find((p) => p.value === m)?.label ?? 'Off';
}

/** Content of the pinyin quick menu. Returns the element and a function to refresh it. */
export function buildPinyinMenu(ctx: AppContext): { el: HTMLElement; sync(): void } {
  const get = () => ctx.settings.get();
  const items = PINYIN_MODES.map((m) =>
    h('button.rd-opt', { type: 'button', role: 'menuitemradio', onclick: () => ctx.settings.set({ pinyin: m.value }) },
      h('span.rd-opt-name', null, m.label), h('span.rd-opt-hint', null, m.hint)));
  const level = h('span.rd-level-val');
  const stepper = h('div.rd-stepper', null,
    h('span.rd-row-label', null, 'Known up to HSK'),
    h('button.rd-step', { type: 'button', 'aria-label': 'Lower level', onclick: () => ctx.settings.set({ hskThreshold: get().hskThreshold - 1 }) }, icon('minus')),
    level,
    h('button.rd-step', { type: 'button', 'aria-label': 'Higher level', onclick: () => ctx.settings.set({ hskThreshold: get().hskThreshold + 1 }) }, icon('plus')));
  const el = h('div.rd-menu', { role: 'menu' }, items, stepper);
  const sync = () => {
    const s = get();
    items.forEach((b, i) => b.setAttribute('aria-checked', String(PINYIN_MODES[i].value === s.pinyin)));
    level.textContent = s.hskThreshold >= 7 ? '7-9' : String(s.hskThreshold);
    stepper.hidden = s.pinyin !== 'hsk';
  };
  sync();
  return { el, sync };
}

/** Content of the Aa menu: size, font, spacing, width, theme, pinyin style, script, lookup. */
export function buildDisplayMenu(ctx: AppContext): { el: HTMLElement; sync(): void } {
  const get = () => ctx.settings.get();
  const set = (p: Partial<Settings>) => ctx.settings.set(p);
  const syncs: (() => void)[] = [];
  const add = <T extends { el: HTMLElement; sync(): void }>(c: T) => { syncs.push(c.sync); return c; };

  const sizeVal = h('span.rd-size-val');
  const sizeKey = () => readingFontSizeKey(get());
  const size = h('div.rd-size', null,
    h('button.rd-step.rd-step-lg', { type: 'button', 'aria-label': 'Smaller text', title: 'Smaller ([)', onclick: () => set({ [sizeKey()]: get()[sizeKey()] - 2 }) }, h('span', { style: 'font-size:13px' }, 'A')),
    sizeVal,
    h('button.rd-step.rd-step-lg', { type: 'button', 'aria-label': 'Larger text', title: 'Larger (])', onclick: () => set({ [sizeKey()]: get()[sizeKey()] + 2 }) }, h('span', { style: 'font-size:20px' }, 'A')));
  syncs.push(() => { sizeVal.textContent = `${get()[sizeKey()]}px`; });

  const font = add(segmented<Settings['fontFamily']>(
    [{ value: 'serif', label: '宋体', title: 'Serif', cls: 'rd-f-serif' }, { value: 'sans', label: '黑体', title: 'Sans', cls: 'rd-f-sans' }, { value: 'kai', label: '楷体', title: 'Kai', cls: 'rd-f-kai' }],
    () => get().fontFamily, (v) => set({ fontFamily: v })));
  const lh = add(slider(1.4, 3, 0.1, () => get().lineHeight, (v) => set({ lineHeight: v }), (v) => v.toFixed(1)));
  const width = add(slider(480, 1200, 20, () => get().pageWidth, (v) => set({ pageWidth: v }), (v) => `${v}px`));
  const theme = add(segmented<Settings['theme']>(
    [{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'sepia', label: 'Sepia' }, { value: 'dark', label: 'Dark' }],
    () => get().theme, (v) => set({ theme: v })));
  const style = add(segmented<Settings['pinyinStyle']>(
    [{ value: 'marks', label: 'hǎo' }, { value: 'numbers', label: 'hao3' }, { value: 'zhuyin', label: 'ㄏㄠˇ' }],
    () => get().pinyinStyle, (v) => set({ pinyinStyle: v })));
  const tones = add(toggle(() => get().toneColors, (v) => set({ toneColors: v })));
  const sandhi = add(toggle(() => get().sandhi, (v) => set({ sandhi: v })));
  const script = add(segmented<Settings['script']>(
    [{ value: 'original', label: 'Original' }, { value: 'simplified', label: '简体' }, { value: 'traditional', label: '繁體' }],
    () => get().script, (v) => set({ script: v })));
  const trigger = add(segmented<Settings['lookupTrigger']>(
    [{ value: 'click', label: 'Click' }, { value: 'hover', label: 'Hover' }],
    () => get().lookupTrigger, (v) => set({ lookupTrigger: v })));
  const ptrans = add(toggle(() => get().paragraphTranslate, (v) => set({ paragraphTranslate: v })));
  const layout = add(segmented<Settings['layout']>(
    [{ value: 'pages', label: 'Pages', title: 'Turn pages like a book' }, { value: 'scroll', label: 'Scroll', title: 'One long column' }],
    () => get().layout, (v) => set({ layout: v })));
  const spread = add(segmented<Settings['spread']>(
    [{ value: 'auto', label: 'Auto' }, { value: 'single', label: 'One' }, { value: 'double', label: 'Two' }],
    () => get().spread, (v) => set({ spread: v })));
  const turn = add(segmented<Settings['pageTurn']>(
    [{ value: 'flip', label: 'Flip' }, { value: 'slide', label: 'Slide' }, { value: 'none', label: 'None' }],
    () => get().pageTurn, (v) => set({ pageTurn: v })));
  const spreadRow = row('Pages shown', spread.el, 'Auto shows two on a wide screen');
  const turnRow = row('Page turn', turn.el);
  const rate = add(slider(0.5, 2, 0.05, () => get().ttsRate, v => set({ ttsRate: v }), v => `${v.toFixed(2)}×`));
  syncs.push(() => { const paged = get().layout === 'pages'; spreadRow.hidden = !paged; turnRow.hidden = !paged; });

  const el = h('div.rd-menu.rd-display', null,
    row('Layout', layout.el),
    spreadRow,
    turnRow,
    h('hr.rd-sep'),
    row('Text size', size),
    row('Font', font.el),
    row('Line spacing', lh.el),
    row('Page width', width.el),
    row('Theme', theme.el),
    row('Reading speed', rate.el, 'Audio changes at the next sentence'),
    h('hr.rd-sep'),
    row('Pinyin style', style.el),
    row('Tone colors', tones.el),
    row('Tone changes', sandhi.el, 'yí gè, bú shì'),
    row('Script', script.el, 'Convert the book text'),
    h('hr.rd-sep'),
    row('Look up on', trigger.el, 'Double-click and drag always work'),
    row('Paragraph translate', ptrans.el, 'Scroll layout'),
  );
  const sync = () => syncs.forEach((f) => f());
  sync();
  return { el, sync };
}

// --------------------------------------------------------------- shortcuts ---

const SHORTCUTS = SHORTCUT_GROUPS.flatMap((g) => g.rows).map((r): [string, string] => [r.keys.join(' + '), r.what]);

export function showShortcuts(): void {
  const dialog: HTMLDialogElement = h('dialog.modal.rd-keys', null,
    h('div.rd-keys-body', null,
      h('div.rd-keys-head', null, h('h2', null, 'Keyboard shortcuts'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('close'))),
      h('dl.rd-keys-list', null, SHORTCUTS.flatMap(([k, d]) => [h('dt', null, h('span.kbd', null, k)), h('dd', null, d)])))) as HTMLDialogElement;
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.appendChild(dialog);
  dialog.showModal();
}
