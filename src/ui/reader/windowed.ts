// A window of rows over a long list (the chapter drawer's tabs): only the rows near the visible part exist, so a list of
// thousands of rows opens as fast as one of twenty.
import { h } from '../dom';

/** A window of rows over a long list. Rows are absolutely positioned in a sizer as tall as the whole list. */
export interface Windowed {
  /** The new list of items (the number of them); redraws the window. */
  set(count: number, rowH: number): void;
  /** Redraw the rows that are showing (their content changed). */
  repaint(): void;
  /** Scroll so row `i` is centered (or just visible), and make sure it exists. */
  reveal(i: number, center?: boolean): void;
  /** The row element for item `i`, if it exists right now. */
  rowAt(i: number): HTMLElement | null;
  dispose(): void;
}

export function windowed(scroller: HTMLElement, render: (i: number) => HTMLElement, keep: () => number): Windowed {
  const sizer = h('div.rd-toc-sizer', { role: 'presentation' });
  scroller.appendChild(sizer);
  const rows = new Map<number, HTMLElement>();
  let count = 0;
  let rowH = 44;
  let raf = 0;

  function paint(): void {
    raf = 0;
    const top = scroller.scrollTop;
    const view = scroller.clientHeight || 480;
    const from = Math.max(0, Math.floor(top / rowH) - 6);
    const to = Math.min(count, Math.ceil((top + view) / rowH) + 6);
    const focused = scroller.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest<HTMLElement>('[data-i]') : null;
    const must = new Set<number>([keep()]);
    if (focused) must.add(Number(focused.dataset.i));
    for (const [i, el] of rows) {
      if ((i < from || i >= to) && !must.has(i)) { el.remove(); rows.delete(i); }
    }
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i++) if (!rows.has(i)) rows.set(i, frag.appendChild(place(render(i), i)));
    for (const i of must) if (i >= 0 && i < count && !rows.has(i)) rows.set(i, frag.appendChild(place(render(i), i)));
    sizer.appendChild(frag);
  }
  function place(el: HTMLElement, i: number): HTMLElement {
    el.dataset.i = String(i);
    el.style.top = `${i * rowH}px`;
    el.style.height = `${rowH}px`;
    return el;
  }
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(paint); };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  /** Redraw every row, and give focus back to the row (the same button, named by `data-k` when a row has several) that had it. */
  function redraw(): void {
    const active = document.activeElement as HTMLElement | null;
    const had = active && scroller.contains(active) ? active.closest<HTMLElement>('[data-i]')?.dataset.i : undefined;
    const wasButton = had !== undefined && active!.tagName === 'BUTTON';
    const which = wasButton ? active!.dataset.k : undefined;
    for (const el of rows.values()) el.remove();
    rows.clear();
    paint();
    if (had === undefined || !wasButton) return;
    const row = rows.get(Number(had));
    (row?.querySelector<HTMLElement>(which ? `button[data-k="${which}"]` : 'button') ?? row?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }

  return {
    set(n, h_) {
      count = n;
      rowH = h_;
      sizer.style.height = `${n * rowH}px`;
      redraw();
    },
    repaint: redraw,
    reveal(i, center = false) {
      const top = i * rowH;
      const view = scroller.clientHeight || 480;
      if (center) scroller.scrollTop = Math.max(0, top - view / 2 + rowH / 2);
      else if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (top + rowH > scroller.scrollTop + view) scroller.scrollTop = top + rowH - view;
      paint();
    },
    rowAt: (i) => rows.get(i) ?? null,
    dispose() { scroller.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); },
  };
}
