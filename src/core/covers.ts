// The covers picked in the book cards' menus (Settings.covers): a setting that syncs, so a cover picked on one device shows
// on every other. It is kept as text, "key:classic,key:modern", by each book's sync key (syncKeys bookKey, the same book on
// every device): settings sync compares values as they are, which works for text and not for a map.

export type CoverPick = 'classic' | 'modern';
const ENTRY = /^([A-Za-z0-9._-]{1,160}):(classic|modern)$/;
/** At most this many picks are kept, the newest, so the setting stays small. */
export const MAX_COVER_PICKS = 400;

/** The picks, by book key, oldest first. Anything malformed is left out; a later pick for a book replaces an earlier one. */
export function parseCovers(text: string): Map<string, CoverPick> {
  const out = new Map<string, CoverPick>();
  for (const part of text.split(',')) {
    const m = ENTRY.exec(part.trim());
    if (!m) continue;
    out.delete(m[1]);
    out.set(m[1], m[2] as CoverPick);
  }
  for (const k of [...out.keys()].slice(0, Math.max(0, out.size - MAX_COVER_PICKS))) out.delete(k);
  return out;
}

export function formatCovers(picks: Map<string, CoverPick>): string {
  return [...picks].map(([k, v]) => `${k}:${v}`).join(',');
}

/** The settings rule: a covers value in its clean form, or undefined when it is not text. */
export function cleanCovers(v: unknown): string | undefined {
  return typeof v === 'string' ? formatCovers(parseCovers(v)) : undefined;
}

/** The covers setting with one book's pick changed; null forgets it (the book's own picture, else its era's style). */
export function withCover(text: string, key: string, pick: CoverPick | null): string {
  const picks = parseCovers(text);
  picks.delete(key);
  if (pick) picks.set(key, pick);
  return formatCovers(parseCovers(formatCovers(picks)));
}
