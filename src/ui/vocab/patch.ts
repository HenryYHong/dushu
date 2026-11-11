// Bringing a drawn list of words up to date in place. When one or a few words come or go (a word removed, put back by Undo,
// saved or removed in another tab), only their rows are taken out or put in, so a list of 800 words does not build every row
// again for one word (about 400 ms at 4x CPU throttling, a mid-range phone). The rows that stay are the same elements, so the
// keyboard focus and the motion of motion.ts carry on as they were. What a patch draws is exactly what drawing the whole list
// would; a search, a sort, a setting or a change of many words still draws the list in full.

/** More rows than this coming and going at once is a new list (a restore, a sync), drawn in full like motion.ts does. */
export const MOST_PATCHED = 8;

export interface Patch {
  /** The keys whose rows are taken out. */
  out: string[];
  /** The keys whose rows are put in, last first, so the row each goes `before` is already in place (null: at the end). */
  in: { key: string; before: string | null }[];
}

/**
 * The patch that turns a list drawn as `was` (its row keys in order) into `now`, or null when it should be drawn in full: more
 * than `most` rows taken out and put in, or the rows that stay in another order (a patch never moves a row). `redo` names rows
 * in both whose content changed; each is taken out and drawn again at its new place.
 */
export function planPatch(was: readonly string[], now: readonly string[], redo: ReadonlySet<string> = new Set(), most = MOST_PATCHED): Patch | null {
  const wasSet = new Set(was);
  const nowSet = new Set(now);
  if (wasSet.size !== was.length || nowSet.size !== now.length) return null;
  const out = was.filter((k) => !nowSet.has(k) || redo.has(k));
  if (out.length > most) return null;
  const ins: number[] = [];
  now.forEach((k, i) => { if (!wasSet.has(k) || redo.has(k)) ins.push(i); });
  if (out.length + ins.length > most) return null;
  const stay = (k: string) => wasSet.has(k) && nowSet.has(k) && !redo.has(k);
  const keptWas = was.filter(stay);
  const keptNow = now.filter(stay);
  if (keptWas.some((k, i) => k !== keptNow[i])) return null;
  return { out, in: ins.reverse().map((i) => ({ key: now[i], before: i + 1 < now.length ? now[i + 1] : null })) };
}

/**
 * Applies `patch` to the rows of `parent`. `rows` maps each key to its row on screen and is kept up to date; `build` draws the
 * row of a key that is put in.
 */
export function applyPatch(parent: HTMLElement, patch: Patch, rows: Map<string, HTMLElement>, build: (key: string) => HTMLElement): void {
  for (const k of patch.out) {
    rows.get(k)?.remove();
    rows.delete(k);
  }
  for (const { key, before } of patch.in) {
    const el = build(key);
    parent.insertBefore(el, before === null ? null : rows.get(before) ?? null);
    rows.set(key, el);
  }
}

/** A row holding the keyboard focus and its place among the rows. */
export interface FocusedRow { key: string; at: number }

/**
 * The row holding the keyboard focus (itself or a button in it), taken before a drawing. A focus that a tap or a click left on
 * a button is not followed: nobody is moving through the list with keys.
 */
export function focusedRow(root: HTMLElement, rowSelector: string): FocusedRow | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active) || !byKeyboard(active)) return null;
  const row = active.closest<HTMLElement>(rowSelector);
  if (!row?.dataset.flip || !root.contains(row)) return null;
  return { key: row.dataset.flip, at: [...root.querySelectorAll(rowSelector)].indexOf(row) };
}

function byKeyboard(el: HTMLElement): boolean {
  try { return el.matches(':focus-visible'); } catch { return true; } // a browser without :focus-visible
}

/**
 * After a drawing, a keyboard focus that was on a row and is now lost (its row left, or the list was drawn in full) goes to the
 * same row if it is still there, else to the row now in its place, else to the last row, else to the first link or button
 * the list shows (an empty list's Open the library), so a keyboard reader carries on from where they were. Focus that is still
 * in the list, or that went somewhere else, is left alone.
 */
export function refocus(root: HTMLElement, was: FocusedRow | null, rowSelector: string): void {
  if (!was) return;
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected && !active.closest('[inert]')) return;
  const rows = [...root.querySelectorAll<HTMLElement>(rowSelector)];
  const to = rows.find((r) => r.dataset.flip === was.key) ?? rows[Math.min(was.at, rows.length - 1)]
    ?? root.querySelector<HTMLElement>('a[href], button:not([disabled])');
  to?.focus({ preventScroll: true });
}
