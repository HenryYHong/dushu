// The popup shell: one at a time, placed next to an anchor (or a bottom sheet on narrow screens),
// closed by Esc, an outside press, or a route change. Views fill it with content.
import { h } from '../dom';
import { anchorGone, computePlacement, type Rect } from './position';

export interface HostOptions {
  kind: 'word' | 'phrase';
  label: string;
  anchor: DOMRect;
  /** Fresh anchor rect while the page scrolls; null if it is gone. Falls back to the first rect. */
  getAnchor?: () => DOMRect | null;
  /** Scroll the page so a bottom sheet does not cover the anchor. */
  keepAnchorVisible?: boolean;
  onClose?: () => void;
  /** Return true when the key was handled. */
  onKey?: (e: KeyboardEvent) => boolean;
}

export interface PopupHost {
  el: HTMLElement;
  /** The element views render into. */
  content: HTMLElement;
  close(): void;
  /** Recompute the position on the next frame. */
  reposition(): void;
  /** Recompute the position now (call once the first content is in). */
  placeNow(): void;
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

export function createHost(o: HostOptions): PopupHost {
  closeActivePopup();
  const content = h('div.pp-content');
  const el = h(`div.pp-pop.pp-k-${o.kind}`, { role: 'dialog', 'aria-label': o.label }, content);
  el.style.visibility = 'hidden'; // until the first placement
  document.body.appendChild(el);

  let closed = false;
  let firstPlace = true;
  const fallbackAnchor = o.anchor;

  const currentAnchor = (): Rect | null => {
    if (!o.getAnchor) return fallbackAnchor;
    return o.getAnchor();
  };

  const place = () => {
    if (closed) return;
    const vp = { w: window.innerWidth, h: window.innerHeight };
    const a = currentAnchor();
    if (!a) { if (!el.classList.contains('pp-sheet')) host.close(); return; }
    const sheet = vp.w < 640;
    // Width must be set before measuring the natural height.
    el.classList.toggle('pp-sheet', sheet);
    el.classList.toggle('pp-float', !sheet);
    el.style.width = sheet ? '' : `${Math.min(400, vp.w - 16)}px`;
    // The content's own height is its natural height even while the popup clips it, so measuring needs no
    // max-height reset. (Resetting it collapsed the scroll area and threw the reader back to the top.)
    const scrolled = el.scrollTop;
    const natural = content.offsetHeight;
    const p = computePlacement(a, natural, vp);
    if (p.mode === 'sheet') {
      Object.assign(el.style, { left: '', top: '', bottom: '', width: '', maxHeight: `${p.maxHeight}px` });
      if (o.keepAnchorVisible && firstPlace) {
        const sheetTop = vp.h - Math.min(natural, p.maxHeight);
        const over = a.bottom - (sheetTop - 16);
        if (over > 0) window.scrollBy({ top: over, behavior: 'smooth' });
      }
    } else {
      if (anchorGone(a, vp)) { host.close(); return; }
      el.dataset.side = p.side;
      Object.assign(el.style, {
        left: `${p.left}px`,
        width: `${p.width}px`,
        maxHeight: `${p.maxHeight}px`,
        top: p.side === 'below' ? `${p.top}px` : 'auto',
        bottom: p.bottom === null ? 'auto' : `${p.bottom}px`,
      });
    }
    firstPlace = false;
    el.style.visibility = '';
    if (el.scrollTop !== scrolled) el.scrollTop = scrolled;
  };

  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; place(); });
  };
  // Scrolling the page moves the anchor; scrolling inside the popup itself must not re-place it.
  const onScroll = (e: Event) => {
    if (e.target instanceof Node && el.contains(e.target)) return;
    schedule();
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

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  ro?.observe(content);

  const host: PopupHost = {
    el,
    content,
    get closed() { return closed; },
    reposition: schedule,
    placeNow: place,
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
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('hashchange', onRoute);
      window.removeEventListener('popstate', onRoute);
      el.remove();
      try { o.onClose?.(); } catch (e) { console.error(e); }
    },
  };
  active = host;

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('popstate', onRoute);
  return host;
}
