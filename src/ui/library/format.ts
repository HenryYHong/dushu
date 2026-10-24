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

/**
 * The dye of a generated cover: an oklch hue from a short list of book-cloth colors (indigo, plum, umber, pine, slate,
 * madder, violet), picked by a hash of title and author and nudged a few degrees, so neighbors differ and none turns muddy.
 */
const DYES = [262, 332, 50, 166, 222, 22, 292];
export function coverDye(title: string, author = ''): number {
  const h = hashString(`${title}\u0000${author}`);
  return DYES[h % DYES.length] + ((h >>> 8) % 13) - 6;
}

/** How wide a title sets: a CJK character is 1, a Latin letter or digit about half, a space a third. */
export function titleUnits(title: string): number {
  let n = 0;
  for (const ch of title.trim()) n += /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]|[\u{20000}-\u{3ffff}]/u.test(ch) ? 1 : /\s/.test(ch) ? 0.3 : 0.56;
  return n;
}

/** True for a title that cannot stand in a vertical slip: it has Latin letters or a run of digits. */
export const hasLatin = (title: string): boolean => /[A-Za-z]|\d{2,}/.test(title);

export interface ClassicLayout {
  /** 'v': the title set vertically on a narrow slip (题签); 'h': a horizontal slip, for long or Latin titles. */
  slip: 'v' | 'h';
  /** Title size, in percent of the cover width. */
  size: number;
  /** False when the author would not fit on a vertical slip under the title. */
  author: boolean;
}

/** Vertical title sizes by character count (the slip holds about 82% of the cover width in length). */
const VERTICAL = [0, 15, 14, 13, 12, 11, 10, 9.5, 8.5];

/** How a thread-bound cover sets its title: vertically for up to eight CJK characters, otherwise on a horizontal slip. */
export function classicLayout(title: string, author = ''): ClassicLayout {
  const chars = [...title.trim()];
  const n = chars.length;
  if (n >= 1 && n < VERTICAL.length && !hasLatin(title)) {
    const size = VERTICAL[n];
    const a = [...author.trim()].length;
    const fits = n * size * 1.1 + 5 + a * 5.5 * 1.08 <= 82;
    return { slip: 'v', size, author: a > 0 && fits };
  }
  return { slip: 'h', size: horizontalSize(titleUnits(title), [12, 11, 10, 9, 8, 7, 6, 5.2]), author: !!author.trim() };
}

/** A contemporary cover: the title set horizontally, larger while it is short. */
export function modernSize(title: string): number {
  const u = titleUnits(title);
  if (u <= 2) return 17;
  if (u <= 3) return 15;
  if (u <= 4) return 14;
  return horizontalSize(u, [13, 12, 10.5, 9, 8, 7, 6, 5.2]);
}

/** Sizes for 4, 6, 9, 14, 20, 30, 45 and more units: enough lines stay on the cover however long the title is. */
function horizontalSize(units: number, sizes: number[]): number {
  const steps = [4, 6, 9, 14, 20, 30, 45];
  const i = steps.findIndex((s) => units <= s);
  return sizes[i < 0 ? sizes.length - 1 : i];
}

/**
 * "Not started", "42%", "Finished". Never "0%" or "100%" for a book that is not quite there. A long book read a few screens
 * in is under half a percent, but its place is past the start, so it says 1%.
 */
export function progressLabel(p: (Pick<Progress, 'percent'> & Partial<Pick<Progress, 'chapter' | 'block' | 'offset'>>) | undefined): string {
  const v = p?.percent ?? 0;
  if (v >= 0.995) return 'Finished';
  if (v < 0.005) return (p?.chapter ?? 0) > 0 || (p?.block ?? 0) > 0 || (p?.offset ?? 0) > 0 ? '1%' : 'Not started';
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
