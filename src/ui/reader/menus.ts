// Popover menus for the reader's top bar: pinyin mode and the Aa display menu, plus the shortcuts sheet.
// On a touch screen or a narrow one a menu is a bottom sheet with a grabber and a Done button; on a computer it is a
// panel under its button. Both are dialogs: focus moves into them on open and returns to the button on close.
import type { AppContext, PinyinMode, Settings } from '../../types';
import { AUTO_KNOWN_HELP } from '../../core/autoKnown';
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

const media = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;
/** Touch screens and narrow windows get a bottom sheet. */
const useSheet = (): boolean => media('(pointer: coarse)') || window.innerWidth < 640;
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export interface PopoverOptions {
  /** The dialog's name for a screen reader, and the title of the sheet. */
  label: string;
}

/** A panel under `anchor` (or a bottom sheet). Clicking the anchor again, pressing Esc or clicking elsewhere closes it. */
export function openPopover(anchor: HTMLElement, content: HTMLElement, onClose?: () => void, opts: PopoverOptions = { label: 'Menu' }): Popover {
  closePopover();
  const el = h('div.rd-pop', { role: 'dialog', 'aria-label': opts.label, tabindex: '-1' });
  let sheet = false;
  const pop: Popover = {
    el,
    anchor,
    close() {
      if (current !== pop) return;
      current = null;
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      el.removeEventListener('scroll', cue);
      anchor.setAttribute('aria-expanded', 'false');
      const hadFocus = el.contains(document.activeElement) || document.activeElement === document.body || !document.activeElement;
      el.remove();
      // Focus goes back to the button that opened the menu, not to the page behind it.
      if (hadFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
      onClose?.();
    },
  };
  const onDown = (e: PointerEvent) => {
    const t = e.target as Node;
    if (el.contains(t) || anchor.contains(t)) return;
    pop.close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); pop.close(); return; }
    if (e.key !== 'Tab') return;
    // Keep Tab inside the menu: it is the only thing the reader is working with while it is open.
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.closest('[hidden]'));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === el)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (at === last || !el.contains(at))) { e.preventDefault(); first.focus(); }
  };
  /** A fade at the bottom edge while there is more to scroll to. */
  const cue = () => el.classList.toggle('rd-pop-more', el.scrollHeight - el.scrollTop - el.clientHeight > 6);
  const place = () => {
    const want = useSheet();
    if (want !== sheet || !el.firstChild) {
      sheet = want;
      el.classList.toggle('rd-sheet', sheet);
      el.querySelector('.rd-grab')?.remove();
      if (sheet) el.prepend(grabber());
    }
    if (sheet) {
      el.style.left = el.style.right = el.style.top = el.style.width = el.style.maxHeight = '';
    } else {
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth || 372;
      const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
      Object.assign(el.style, { left: `${Math.round(left)}px`, right: 'auto', width: '', top: `${Math.round(r.bottom + 6)}px` });
      el.style.maxHeight = `${Math.max(160, window.innerHeight - r.bottom - 16)}px`;
    }
    cue();
  };
  /** The top of a sheet: a grabber to drag down, a title and a Done button. */
  function grabber(): HTMLElement {
    const done = h('button.btn.btn-sm', { type: 'button', onclick: () => pop.close() }, 'Done');
    const bar = h('div.rd-grab', null, h('span.rd-grab-title', null, opts.label), done) as HTMLElement;
    let y0 = 0;
    let dy = 0;
    let id = -1;
    bar.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('button')) return;
      id = e.pointerId; y0 = e.clientY; dy = 0;
      bar.setPointerCapture(id);
    });
    bar.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      dy = Math.max(0, e.clientY - y0);
      el.style.transform = `translate(-50%, ${dy}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (dy > 70) pop.close();
      else el.style.transform = '';
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    return bar;
  }
  el.appendChild(content);
  document.body.appendChild(el);
  place();
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', place);
  el.addEventListener('scroll', cue, { passive: true });
  current = pop;
  // Into the dialog: the reader is now in the menu, and Tab starts at its first control.
  el.focus({ preventScroll: true });
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

/** One setting on one line: its name (and a hint) on the left, the control on the right. */
function row(label: string, control: Node, hint?: string): HTMLElement {
  if (control instanceof HTMLElement) {
    if (control.matches('[role="group"], [role="switch"]')) control.setAttribute('aria-label', label);
    control.querySelector('input[type="range"]')?.setAttribute('aria-label', label);
  }
  return h('div.rd-row', null,
    h('div.rd-row-label', null, label, hint ? h('span.rd-row-hint', null, hint) : null),
    h('div.rd-row-ctl', null, control));
}

function section(title: string, ...rows: (Node | null)[]): HTMLElement {
  return h('section.rd-sec', { 'aria-label': title }, h('h3.rd-sec-title', null, title), ...rows.filter((r): r is Node => !!r));
}

function toggle(get: () => boolean, set: (v: boolean) => void): { el: HTMLElement; sync(): void } {
  const btn = h('button.rd-switch', { type: 'button', role: 'switch', onclick: () => set(!get()) }, h('span.rd-switch-dot'));
  const sync = () => btn.setAttribute('aria-checked', String(get()));
  sync();
  return { el: btn, sync };
}

/**
 * A slider that shows its value as it moves but changes the setting once the finger lifts (or a quarter of a second
 * after the last movement): a page layout is set again for every value otherwise, and that is what froze the reader.
 */
export function slider(min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string, delay = 250) {
  const out = h('span.rd-slider-out');
  const input = h('input.rd-slider', { type: 'range', min, max, step, value: get() }) as HTMLInputElement;
  let timer = 0;
  const flush = () => { window.clearTimeout(timer); timer = 0; if (Number(input.value) !== get()) set(Number(input.value)); };
  input.addEventListener('input', () => {
    out.textContent = fmt(Number(input.value));
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, delay);
  });
  input.addEventListener('change', flush);
  const el = h('div.rd-slider-wrap', null, input, out);
  const sync = () => {
    // Do not fight the finger: while a change is pending the slider shows what the reader chose.
    if (timer) return;
    input.value = String(get());
    out.textContent = fmt(get());
  };
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

/**
 * Content of the pinyin menu: the mode, the HSK level, and how the pinyin looks. Returns the element and a function to refresh it.
 * `coverage` counts the chapter's words and those showing pinyin, so the menu can say what a level does to this book.
 */
export function buildPinyinMenu(ctx: AppContext, coverage?: () => { words: number; shown: number } | null): { el: HTMLElement; sync(): void } {
  const get = () => ctx.settings.get();
  const set = (p: Partial<Settings>) => ctx.settings.set(p);
  const syncs: (() => void)[] = [];
  const add = <T extends { el: HTMLElement; sync(): void }>(c: T) => { syncs.push(c.sync); return c; };
  const items = PINYIN_MODES.map((m) =>
    h('button.rd-opt', { type: 'button', role: 'menuitemradio', onclick: () => set({ pinyin: m.value }) },
      h('span.rd-opt-name', null, m.label), h('span.rd-opt-hint', null, m.hint)));
  const level = h('span.rd-level-val');
  const stepper = h('div.rd-stepper', null,
    h('span.rd-row-label', null, 'Known up to HSK'),
    h('button.rd-step', { type: 'button', 'aria-label': 'Lower level', onclick: () => set({ hskThreshold: get().hskThreshold - 1 }) }, icon('minus')),
    level,
    h('button.rd-step', { type: 'button', 'aria-label': 'Higher level', onclick: () => set({ hskThreshold: get().hskThreshold + 1 }) }, icon('plus')));
  const style = add(segmented<Settings['pinyinStyle']>(
    [{ value: 'marks', label: 'hǎo' }, { value: 'numbers', label: 'hao3' }, { value: 'zhuyin', label: 'ㄏㄠˇ' }],
    () => get().pinyinStyle, (v) => set({ pinyinStyle: v })));
  const tones = add(toggle(() => get().toneColors, (v) => set({ toneColors: v })));
  const sandhi = add(toggle(() => get().sandhi, (v) => set({ sandhi: v })));
  const learn = add(toggle(() => get().autoKnown, (v) => set({ autoKnown: v })));
  learn.el.title = AUTO_KNOWN_HELP;
  // Learning from reading changes what Unknown hides, so it sits under the modes while Unknown is the one chosen.
  const learnRow = row('Learn as I read', learn.el, 'Words you read past often lose their pinyin');
  const modes = h('div.rd-menu', { role: 'menu', 'aria-label': 'Show pinyin' }, items, stepper);
  const share = h('p.rd-share', { 'aria-live': 'polite' });
  const el = h('div.rd-menu.rd-pinyin-menu', null,
    section('Show pinyin', modes, share, learnRow),
    section('Look', row('Style', style.el), row('Tone colors', tones.el), row('Tone changes', sandhi.el, 'yí gè, bú shì')));
  const sync = () => {
    const s = get();
    items.forEach((b, i) => b.setAttribute('aria-checked', String(PINYIN_MODES[i].value === s.pinyin)));
    level.textContent = s.hskThreshold >= 7 ? '7-9' : String(s.hskThreshold);
    stepper.hidden = s.pinyin !== 'hsk';
    // Both modes hide known words, so both learn from reading.
    const filtered = s.pinyin === 'unknown' || s.pinyin === 'hsk';
    learnRow.hidden = !filtered;
    const c = filtered ? coverage?.() : null;
    share.hidden = !c?.words;
    if (c?.words) share.textContent = `Pinyin on ${Math.round((100 * c.shown) / c.words)}% of this chapter's words`;
    syncs.forEach((f) => f());
  };
  sync();
  return { el, sync };
}

/** Content of the Aa menu: text, page and reading. (How the pinyin looks lives in the pinyin menu.) */
export function buildDisplayMenu(ctx: AppContext): { el: HTMLElement; sync(): void } {
  const get = () => ctx.settings.get();
  const set = (p: Partial<Settings>) => ctx.settings.set(p);
  const syncs: (() => void)[] = [];
  const add = <T extends { el: HTMLElement; sync(): void }>(c: T) => { syncs.push(c.sync); return c; };
  const touch = media('(hover: none)');

  const sizeVal = h('span.rd-size-val');
  const sizeKey = () => readingFontSizeKey(get());
  const size = h('div.rd-size', null,
    h('button.rd-step.rd-step-lg', { type: 'button', 'aria-label': 'Smaller text', title: 'Smaller ([)', onclick: () => set({ [sizeKey()]: get()[sizeKey()] - 2 }) }, h('span', { style: 'font-size:13px' }, 'A')),
    sizeVal,
    h('button.rd-step.rd-step-lg', { type: 'button', 'aria-label': 'Larger text', title: 'Larger (])', onclick: () => set({ [sizeKey()]: get()[sizeKey()] + 2 }) }, h('span', { style: 'font-size:20px' }, 'A')));
  syncs.push(() => { sizeVal.textContent = `${get()[sizeKey()]} px`; });

  const font = add(segmented<Settings['fontFamily']>(
    [{ value: 'serif', label: '宋体', title: 'Serif', cls: 'rd-f-serif' }, { value: 'sans', label: '黑体', title: 'Sans', cls: 'rd-f-sans' }, { value: 'kai', label: '楷体', title: 'Kai', cls: 'rd-f-kai' }],
    () => get().fontFamily, (v) => set({ fontFamily: v })));
  const lh = add(slider(1.4, 3, 0.1, () => get().lineHeight, (v) => set({ lineHeight: v }), (v) => v.toFixed(1)));
  const width = add(slider(480, 1200, 20, () => get().pageWidth, (v) => set({ pageWidth: v }), (v) => `${v}px`));
  const theme = add(segmented<Settings['theme']>(
    [{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'sepia', label: 'Sepia' }, { value: 'dark', label: 'Dark' }],
    () => get().theme, (v) => set({ theme: v })));
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
  const rate = add(slider(0.5, 2, 0.05, () => get().ttsRate, v => set({ ttsRate: v }), v => `${v.toFixed(2)}×`));

  // Rows that do not apply are not shown (a dimmed row still looks like something you can change).
  const spreadRow = row('Pages shown', spread.el, 'Auto: two on a wide screen');
  const turnRow = row('Page turn', turn.el);
  const widthRow = row('Page width', width.el);
  const lookRow = row('Look up on', trigger.el, 'Drag always works');
  const ptHint = touch ? 'Tap a word twice' : 'Drag across a sentence (Pages) or use the button (Scroll)';
  const el = h('div.rd-menu.rd-display', null,
    section('Text',
      row('Text size', size),
      row('Font', font.el),
      row('Line spacing', lh.el),
      row('Theme', theme.el)),
    section('Page',
      row('Layout', layout.el),
      spreadRow,
      turnRow,
      widthRow),
    section('Reading',
      row('Characters', script.el, 'Convert the book text'),
      touch ? null : lookRow,
      row('Translate paragraphs', ptrans.el, ptHint),
      row('Reading speed', rate.el)),
  );
  syncs.push(() => {
    const s = get();
    const paged = s.layout === 'pages';
    spreadRow.hidden = !paged || window.innerWidth < 640;
    turnRow.hidden = !paged;
    widthRow.hidden = paged;
  });
  const sync = () => syncs.forEach((f) => f());
  sync();
  return { el, sync };
}

// --------------------------------------------------------------- shortcuts ---

const SHORTCUTS = SHORTCUT_GROUPS.flatMap((g) => g.rows).map((r): [string, string] => [r.keys.join(' + '), r.what]);

export function showShortcuts(): void {
  const opener = document.activeElement as HTMLElement | null;
  const dialog: HTMLDialogElement = h('dialog.modal.rd-keys', { 'aria-label': 'Keyboard shortcuts' },
    h('div.rd-keys-body', null,
      h('div.rd-keys-head', null, h('h2', null, 'Keyboard shortcuts'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => dialog.close() }, icon('close'))),
      h('dl.rd-keys-list', null, SHORTCUTS.flatMap(([k, d]) => [h('dt', null, h('span.kbd', null, k)), h('dd', null, d)])))) as HTMLDialogElement;
  dialog.addEventListener('close', () => { dialog.remove(); opener?.isConnected && opener.focus({ preventScroll: true }); });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.appendChild(dialog);
  dialog.showModal();
}
