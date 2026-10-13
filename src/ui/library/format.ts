// Small pure helpers for the library: cover tint, title size, progress labels.
import type { Progress } from '../../types';

/** FNV-1a, 32 bit. Same title always gets the same cover. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Hue 0-359 for a generated cover. Mixed with the author so two books with one title still differ. */
export function coverHue(title: string, author = ''): number {
  return hashString(`${title}\u0000${author}`) % 360;
}

export interface TitleLayout {
  /** Font size, in percent of the cover width. */
  size: number;
  /** How many full-width characters fit on a line before it wraps. */
  perLine: number;
}

/**
 * How a generated cover sets its title, by how many characters it has. The line length is chosen with the size so a
 * title never ends with one character alone on the last line: four characters make two lines of two, six make two of three.
 * Widths: size x perLine stays within the roughly 70% of the cover width that the frame leaves for text.
 */
export function titleLayout(title: string): TitleLayout {
  const n = [...title.trim()].length;
  if (n <= 2) return { size: 26, perLine: 2 };
  if (n === 3) return { size: 21, perLine: 3 };
  if (n === 4) return { size: 24, perLine: 2 };
  if (n <= 6) return { size: 21, perLine: 3 };
  if (n <= 8) return { size: 16, perLine: 4 };
  if (n === 9) return { size: 14, perLine: 5 };
  if (n <= 12) return { size: 11, perLine: 6 };
  if (n <= 16) return { size: 11, perLine: 6 };
  return { size: 9.5, perLine: 7 };
}

/** Title font size on a generated cover, in percent of the cover width. */
export const titleSize = (title: string): number => titleLayout(title).size;

/** "Not started", "42%", "Finished". Never "0%" or "100%" for a book that is not quite there. */
export function progressLabel(p: Pick<Progress, 'percent'> | undefined): string {
  const v = p?.percent ?? 0;
  if (v >= 0.995) return 'Finished';
  if (v < 0.005) return 'Not started';
  return `${Math.min(99, Math.max(1, Math.round(v * 100)))}%`;
}

export function progressFraction(p: Pick<Progress, 'percent'> | undefined): number {
  const v = p?.percent ?? 0;
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

/** 589256 -> "589k", 20858 -> "21k", 4200 -> "4.2k", 800 -> "800". */
export function compactCount(n: number): string {
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(Math.round(n / 100) / 10).toString()}k`;
  return String(n);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
