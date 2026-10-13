// Pure logic for the vocabulary screen: search, sort, due labels, context excerpts, exports.
// No DOM here so it can be tested in Node.
import { formatInterval } from '../../core/srs';
import { formatPinyin } from '../../core/pinyin';
import type { PinyinStyle, VocabItem } from '../../types';

export type SortKey = 'added' | 'due' | 'pinyin';

const MARKS = /[\u0300-\u036f]/g;

/** Lowercase pinyin with no tone numbers or marks: "ni3 hao3" and "nǐ hǎo" both give "ni hao". */
export function pinyinBase(pinyin: string): string {
  return pinyin.normalize('NFD').replace(MARKS, '').replace(/[0-5]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Everything a search can match, lowercased, in one string. */
export function searchText(item: VocabItem): string {
  const base = pinyinBase(item.pinyin.replace(/u:/g, 'v').replace(/ü/g, 'v'));
  const baseU = base.replace(/v/g, 'u');
  return [
    item.simp, item.trad, item.pinyin.toLowerCase(), item.pinyin.toLowerCase().replace(/ü|u:/g, 'u'), item.pinyin.toLowerCase().replace(/ü|u:/g, 'v'), formatPinyin(item.pinyin, 'marks').toLowerCase(),
    formatPinyin(item.pinyin, 'marks').toLowerCase().replace(/ /g, ''), base, base.replace(/ /g, ''), baseU, item.gloss.toLowerCase(),
    item.context?.sentence ?? '', item.context?.bookTitle?.toLowerCase() ?? '',
  ].join('\n');
}

/** Every whitespace-separated term of the query must appear somewhere in the item. */
export function matchesQuery(item: VocabItem, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = searchText(item);
  return terms.every((t) => hay.includes(t));
}

function comparePinyin(a: VocabItem, b: VocabItem): number {
  const ba = pinyinBase(a.pinyin);
  const bb = pinyinBase(b.pinyin);
  if (ba !== bb) return ba < bb ? -1 : 1;
  if (a.pinyin !== b.pinyin) return a.pinyin < b.pinyin ? -1 : 1;
  return a.simp.localeCompare(b.simp, 'zh');
}

export function filterAndSort(items: VocabItem[], query: string, sort: SortKey): VocabItem[] {
  const out = items.filter((i) => matchesQuery(i, query));
  switch (sort) {
    case 'added': out.sort((a, b) => b.addedAt - a.addedAt || a.simp.localeCompare(b.simp, 'zh')); break;
    case 'due': out.sort((a, b) => a.srs.due - b.srs.due || b.addedAt - a.addedAt); break;
    case 'pinyin': out.sort(comparePinyin); break;
  }
  return out;
}

export interface DueLabel { text: string; state: 'new' | 'due' | 'later' }

/** "New", "Due now" or "Due in 3d". */
export function dueLabel(item: VocabItem, now: number): DueLabel {
  if (item.srs.due <= now) {
    return item.srs.reps === 0 && !item.srs.last ? { text: 'New', state: 'new' } : { text: 'Due now', state: 'due' };
  }
  return { text: `Due in ${formatInterval(item.srs.due - now)}`, state: 'later' };
}

export interface ContextParts { before: string; match: string; after: string }

/** Split a sentence around the first occurrence of the word (either script), or null if absent. */
export function splitContext(sentence: string, words: string[]): ContextParts | null {
  let best = -1;
  let hit = '';
  for (const w of words) {
    if (!w) continue;
    const i = sentence.indexOf(w);
    if (i >= 0 && (best < 0 || i < best)) { best = i; hit = w; }
  }
  if (best < 0) return null;
  return { before: sentence.slice(0, best), match: hit, after: sentence.slice(best + hit.length) };
}

/** Shorten a long sentence to a window around the word, cutting on code points. */
export function excerpt(parts: ContextParts, max = 80): ContextParts {
  const before = [...parts.before];
  const after = [...parts.after];
  const room = Math.max(0, max - [...parts.match].length);
  let kb = Math.min(before.length, Math.ceil(room / 2));
  const ka = Math.min(after.length, room - kb);
  kb = Math.min(before.length, room - ka); // leftover room goes to the other side
  return {
    before: (before.length > kb ? '…' : '') + before.slice(before.length - kb).join(''),
    match: parts.match,
    after: after.slice(0, ka).join('') + (after.length > ka ? '…' : ''),
  };
}

// ---------------------------------------------------------------- exports ---

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One Anki text-import field: quoted when it holds a tab, quote or line break. */
function ankiField(s: string): string {
  const flat = s.replace(/\r?\n/g, '<br>');
  return /[\t"]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}

function sentenceHtml(item: VocabItem): string {
  const s = item.context?.sentence;
  if (!s) return '';
  const parts = splitContext(s, [item.simp, item.trad]);
  if (!parts) return escHtml(s);
  return `${escHtml(parts.before)}<b>${escHtml(parts.match)}</b>${escHtml(parts.after)}`;
}

/**
 * Anki text import: tab separated, HTML on. Front = word + context sentence,
 * back = pinyin + gloss, third column = tag.
 */
export function ankiTsv(items: VocabItem[], style: PinyinStyle): string {
  const lines = ['#separator:tab', '#html:true', '#tags column:3'];
  for (const it of items) {
    const sentence = sentenceHtml(it);
    const front = `<b>${escHtml(it.simp)}</b>${sentence ? `<br>${sentence}` : ''}`;
    const back = `${escHtml(formatPinyin(it.pinyin, style))}<br>${escHtml(it.gloss)}`;
    lines.push([ankiField(front), ankiField(back), 'dushu'].join('\t'));
  }
  return lines.join('\n') + '\n';
}

function csvField(s: string): string {
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function vocabCsv(items: VocabItem[], style: PinyinStyle): string {
  const head = ['word', 'traditional', 'pinyin', 'meaning', 'sentence', 'book', 'added', 'due'];
  const rows = items.map((it) => [
    it.simp, it.trad, formatPinyin(it.pinyin, style), it.gloss, it.context?.sentence ?? '',
    it.context?.bookTitle ?? '', isoDay(it.addedAt), isoDay(it.srs.due),
  ]);
  // BOM so Excel reads the file as UTF-8.
  return '\uFEFF' + [head, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
