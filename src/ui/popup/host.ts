// The popup shell: one at a time, placed next to an anchor (or a bottom sheet on narrow screens),
// closed by Esc, an outside press, or a route change. Views fill it with content.
import { h } from '../dom';
import { anchorGone, computePlacement, SHORT_SHEET, type Insets, type Rect } from './position';

export interface HostOptions {
  kind: 'word' | 'phrase';
  label: string;
  anchor: DOMRect;
  /** Fresh anchor rect while the page scrolls; null if it is gone. Falls back to the first rect. */
  getAnchor?: () => DOMRect | null;
  /** Scroll the page so a bottom sheet does not cover the anchor. */
  keepAnchorVisible?: boolean;
  /**
   * Called after every placement with the viewport y of the sheet's top edge, or null when the popup is a floating
   * card (or closed). A reader that cannot scroll (Pages) uses it to lift the page so the word stays in view.
   * Passing it also tells the host the page can move, so a touch tablet gets the taller sheet.
   */
  onSheetTop?: (top: number | null) => void;
  /** The element focus returns to on close; defaults to the element the popup was opened from. */
  restoreFocus?: () => HTMLElement | null;
  onClose?: () => void;
  /** Return true when the key was handled. */
  onKey?: (e: KeyboardEvent) => boolean;
}

export interface PopupHost {
  el: HTMLElement;
  /** The element views render into. */
  content: HTMLElement;
  /** The box that scrolls (the popup's own overflow area); `el` itself never scrolls. */
  scroller: HTMLElement;
  close(): void;
  /** Recompute the position on the next frame. */
  reposition(): void;
  /** Recompute the position now (call once the first content is in). */
  placeNow(): void;
  /** Put focus back on the dialog itself (after a view replaced the element that had it). */
  focus(): void;
  readonly closed: boolean;
}

let active: PopupHost | null = null;

export function closeActivePopup(): void {
  active?.close();
}

export function activePopupElement(): HTMLElement | null {
  return active?.el ?? null;
}

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/** A closing popup tells its reader "no sheet" a moment later, so a popup that replaces it does not make the page jump back and forth. */
let pendingClear: { cb: (top: number | null) => void; timer: ReturnType<typeof setTimeout> } | null = null;

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex], .rd-w';

/** The element the popup grew out of: the focused control, or the word under the anchor. */
function findOpener(anchor: Rect): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && active !== document.documentElement) return active;
  if (typeof document.elementFromPoint !== 'function') return null;
  try {
    const hit = document.elementFromPoint(anchor.left + anchor.width / 2, anchor.top + anchor.height / 2);
    return (hit?.closest(FOCUSABLE) as HTMLElement | null) ?? null;
  } catch { return null; }
}

let insetProbe: HTMLElement | null = null;
/** Safe-area insets in px (a notch, the home indicator). Zero where env() is unsupported. */
function readInsets(): Insets {
  if (typeof getComputedStyle !== 'function') return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!insetProbe || !insetProbe.isConnected) {
    insetProbe = h('div', { 'aria-hidden': 'true', style: 'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;'
      + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)' });
    document.body.appendChild(insetProbe);
  }
  const cs = getComputedStyle(insetProbe);
  const px = (v: string) => Number.parseFloat(v) || 0;
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}

const isCoarse = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

export function createHost(o: HostOptions): PopupHost {
  closeActivePopup();
  const opener = findOpener(o.anchor);
  const content = h('div.pp-content');
  // The card (el) clips nothing so the caret can stick out; the scroller inside it is what scrolls.
  const scroller = h('div.pp-scroll', null, content);
  const el = h(`div.pp-pop.pp-k-${o.kind}`, { role: 'dialog', 'aria-label': o.label, tabindex: '-1' }, scroller);
  el.style.visibility = 'hidden'; // until the first placement
  document.body.appendChild(el);

  let closed = false;
  let firstPlace = true;
  let lastSheetTop: number | null | undefined;
  const fallbackAnchor = o.anchor;
  let room: HTMLElement | null = null;

  const currentAnchor = (): Rect | null => {
    if (!o.getAnchor) return fallbackAnchor;
    return o.getAnchor();
  };

  const reportSheetTop = (top: number | null, deferred = false) => {
    if (top === lastSheetTop || !o.onSheetTop) return;
    lastSheetTop = top;
    const cb = o.onSheetTop;
    const send = () => { try { cb(top); } catch (e) { console.error(e); } };
    if (top !== null && pendingClear?.cb === cb) { clearTimeout(pendingClear.timer); pendingClear = null; }
    if (top === null && deferred) {
      if (pendingClear) { clearTimeout(pendingClear.timer); pendingClear = null; }
      const timer = setTimeout(() => { if (pendingClear?.timer === timer) pendingClear = null; send(); }, 0);
      pendingClear = { cb, timer };
    } else send();
  };

  /** Marks the card while there is more to scroll to, so the sticky footer can show a fade above it. */
  const updateMore = () => {
    el.classList.toggle('pp-more', scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 2);
  };
  scroller.addEventListener('scroll', updateMore, { passive: true });

  const place = () => {
    if (closed) return;
    const vp = { w: window.innerWidth, h: window.innerHeight };
    const a = currentAnchor();
    if (!a) { if (!el.classList.contains('pp-sheet')) host.close(); return; }
    // The popup's natural height is the content's own height; the scroll box's max-height never changes it, so
    // there is nothing to clear before measuring (clearing it used to clamp scrollTop to 0 on every placement).
    const natural = content.offsetHeight;
    const p = computePlacement(a, natural, vp, { coarse: isCoarse(), canShift: !!o.onSheetTop, insets: readInsets() });
    const sheet = p.mode === 'sheet';
    el.classList.toggle('pp-sheet', sheet);
    el.classList.toggle('pp-float', !sheet);
    el.classList.toggle('pp-sheet-tablet', sheet && p.variant === 'tablet');
    el.classList.toggle('pp-short', sheet && p.maxHeight < SHORT_SHEET);
    if (p.mode === 'sheet') {
      delete el.dataset.side;
      Object.assign(el.style, {
        left: p.left === null ? '' : `${p.left}px`, width: p.width === null ? '' : `${p.width}px`,
        top: '', bottom: '', maxHeight: `${p.maxHeight}px`,
      });
      const sheetTop = vp.h - Math.min(natural + 12, p.maxHeight);
      // A page that scrolls by itself ends at its last line: without more room below, a word on that line could not be
      // scrolled above the sheet. The room is as tall as the sheet and goes away with it.
      if (o.keepAnchorVisible && !o.onSheetTop) {
        room ??= h('div.pp-sheet-room', { 'aria-hidden': 'true', style: 'pointer-events:none' });
        if (!room.isConnected) document.body.appendChild(room);
        room.style.height = `${vp.h - sheetTop}px`;
      }
      if (o.keepAnchorVisible && firstPlace) {
        const over = a.bottom - (sheetTop - 16);
        if (over > 0) window.scrollBy({ top: over, behavior: 'smooth' });
      }
      const height = el.getBoundingClientRect().height; // the sheet is pinned to the bottom edge
      reportSheetTop(Math.round(height ? vp.h - height : sheetTop));
    } else {
      if (anchorGone(a, vp)) { host.close(); return; }
      room?.remove();
      el.dataset.side = p.side;
      if (p.caret === null) el.dataset.caret = 'off';
      else { delete el.dataset.caret; el.style.setProperty('--pp-caret', `${p.caret}px`); }
      Object.assign(el.style, {
        left: `${p.left}px`,
        width: `${p.width}px`,
        maxHeight: `${p.maxHeight}px`,
        top: p.side === 'below' ? `${p.top}px` : 'auto',
        bottom: p.bottom === null ? 'auto' : `${p.bottom}px`,
      });
      reportSheetTop(null);
    }
    el.style.visibility = '';
    updateMore();
    if (firstPlace) {
      firstPlace = false;
      // A dialog takes focus when it opens, so a keyboard or screen reader user lands inside it.
      try { el.focus({ preventScroll: true }); } catch { /* not focusable yet */ }
    }
  };

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; place(); });
  };

  // Safari reports the click that follows a touch tap as pointerType 'mouse'. Remember the touch so that click
  // still counts as a tap (and closes the popup) instead of being mistaken for a mouse press already handled.
  let lastTouchAt = -Infinity;
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') { lastTouchAt = performance.now(); return; } // a tap closes on click; a scroll must not
    if (e.target instanceof Node && el.contains(e.target)) return;
    host.close();
  };
  const onClick = (e: MouseEvent) => {
    if (e.target instanceof Node && el.contains(e.target)) return;
    // Mouse and pen are handled on pointerdown; this catches taps.
    if ((e as PointerEvent).pointerType === 'mouse' && performance.now() - lastTouchAt > 1000) return;
    host.close();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); host.close(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (o.onKey?.(e)) { e.preventDefault(); e.stopPropagation(); }
  };
  const onRoute = () => host.close();
  // The popup scrolls by itself; that must not trigger a placement (it used to, and the placement reset the scroll).
  const onPageScroll = (e: Event) => {
    if (e.target instanceof Node && el.contains(e.target)) return;
    schedule();
  };

  // Focus goes back to the word (or control) the popup came from, unless the user already moved it somewhere else.
  const giveFocusBack = () => {
    const target = o.restoreFocus?.() ?? opener;
    if (!target || !target.isConnected) return;
    try {
      if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    } catch { /* ignore */ }
  };

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  ro?.observe(content);

  const host: PopupHost = {
    el,
    content,
    scroller,
    get closed() { return closed; },
    reposition: schedule,
    placeNow: place,
    focus() { if (!closed) try { el.focus({ preventScroll: true }); } catch { /* ignore */ } },
    close() {
      if (closed) return;
      closed = true;
      if (active === host) active = null;
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', onPageScroll, true);
      window.removeEventListener('hashchange', onRoute);
      window.removeEventListener('popstate', onRoute);
      const hadFocus = el.contains(document.activeElement) || document.activeElement === document.body || !document.activeElement;
      el.remove();
      room?.remove();
      reportSheetTop(null, true);
      if (hadFocus) giveFocusBack();
      try { o.onClose?.(); } catch (e) { console.error(e); }
    },
  };
  active = host;

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', onPageScroll, true);
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('popstate', onRoute);
  return host;
}
