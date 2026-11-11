// Pure logic for the vocabulary screen: search, sort, due labels, context excerpts, exports.
// No DOM here so it can be tested in Node.
import { formatInterval } from '../../core/srs';
import { formatPinyin } from '../../core/pinyin';
import { dayOf } from '../../core/activity';
import { activeEngine, isChinese, lang, langId } from '../../lang/active';
import { LANGS } from '../../lang/registry';
import type { LangId } from '../../lang/types';
import type { PinyinStyle, VocabItem } from '../../types';
import { num, tt, ttn } from '../../i18n';

export type SortKey = 'added' | 'due' | 'pinyin';

const MARKS = /[\u0300-\u036f]/g;

/** Lowercase pinyin with no tone numbers or marks: "ni3 hao3" and "nǐ hǎo" both give "ni hao". */
export function pinyinBase(pinyin: string): string {
  return pinyin.normalize('NFD').replace(MARKS, '').replace(/[0-5]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A word or a query as a search compares it: lowercase, and without accents in the languages written in Latin letters, so
 * "vorwort" finds Vorwort and "tambien" finds también. Russian loses only its stress marks and ё (й stays: мои is not мой).
 * Chinese and Japanese are only lowercased (the kana's voicing marks are never taken off: が is not か).
 */
export function foldSearch(s: string, id: LangId = langId()): string {
  const t = s.normalize('NFC').toLocaleLowerCase(LANGS[id].tag);
  if (id === 'zh' || id === 'ja') return t;
  if (id === 'ru') return t.normalize('NFD').replace(/[\u0300\u0301]/g, '').normalize('NFC').replace(/ё/g, 'е');
  return t.normalize('NFD').replace(MARKS, '').normalize('NFC').replace(/ß/g, 'ss');
}

/** Everything a search can match, folded (foldSearch), in one string. */
export function searchText(item: VocabItem): string {
  const fold = (x: string | undefined) => (x ? foldSearch(x) : '');
  const own = [fold(item.simp), fold(item.trad), fold(item.id), fold(item.gloss), fold(item.context?.sentence), fold(item.context?.bookTitle)];
  // Another language's reading (Japanese kana, Russian stress) is matched as it is, folded the same way.
  if (!isChinese()) return [...own, fold(item.pinyin)].join('\n');
  const base = pinyinBase(item.pinyin.replace(/u:/g, 'v').replace(/ü/g, 'v'));
  const baseU = base.replace(/v/g, 'u');
  return [
    ...own, item.pinyin.toLowerCase(), item.pinyin.toLowerCase().replace(/ü|u:/g, 'u'), item.pinyin.toLowerCase().replace(/ü|u:/g, 'v'), formatPinyin(item.pinyin, 'marks').toLowerCase(),
    formatPinyin(item.pinyin, 'marks').toLowerCase().replace(/ /g, ''), base, base.replace(/ /g, ''), baseU,
  ].join('\n');
}

const queryTerms = (query: string) => foldSearch(query.trim()).split(/\s+/).filter(Boolean);
const hasTerms = (item: VocabItem, terms: string[]) => {
  const hay = searchText(item);
  return terms.every((t) => hay.includes(t));
};

/** Every whitespace-separated term of the query must appear somewhere in the item. */
export function matchesQuery(item: VocabItem, query: string): boolean {
  const terms = queryTerms(query);
  return !terms.length || hasTerms(item, terms);
}

function comparePinyin(a: VocabItem, b: VocabItem): number {
  // Another language: alphabetical in that language (Japanese by its kana reading, so 食べる sits under た).
  if (!isChinese()) {
    const tag = lang().tag;
    return (a.pinyin || a.simp).localeCompare(b.pinyin || b.simp, tag) || a.simp.localeCompare(b.simp, tag);
  }
  const ba = pinyinBase(a.pinyin);
  const bb = pinyinBase(b.pinyin);
  if (ba !== bb) return ba < bb ? -1 : 1;
  if (a.pinyin !== b.pinyin) return a.pinyin < b.pinyin ? -1 : 1;
  return a.simp.localeCompare(b.simp, 'zh');
}

export function filterAndSort(items: VocabItem[], query: string, sort: SortKey): VocabItem[] {
  // The query is folded once, not once a word (the list is sorted again on every change to the words).
  const terms = queryTerms(query);
  const out = terms.length ? items.filter((i) => hasTerms(i, terms)) : items.slice();
  switch (sort) {
    case 'added': out.sort((a, b) => b.addedAt - a.addedAt || a.simp.localeCompare(b.simp, 'zh')); break;
    case 'due': out.sort((a, b) => a.srs.due - b.srs.due || b.addedAt - a.addedAt); break;
    case 'pinyin': out.sort(comparePinyin); break;
  }
  return out;
}

/**
 * The line under the Vocabulary title: the saved words, how many are due, and the looked-up words Review adds as new cards,
 * so it adds up to the Review button. "2 words saved, 2 due. 3 new from words you looked up."
 */
export function reviewLine(saved: number, due: number, fresh: number): string {
  if (!saved) return fresh ? ttn(fresh, '{n} new from words you looked up.', '{n} new from words you looked up.') : '';
  if (!fresh) {
    return due
      ? ttn(saved, '{n} word saved, {due} due for review', '{n} words saved, {due} due for review', { due: num(due) })
      : ttn(saved, '{n} word saved, none due for review', '{n} words saved, none due for review');
  }
  return due
    ? ttn(saved, '{n} word saved, {due} due. {fresh} new from words you looked up.', '{n} words saved, {due} due. {fresh} new from words you looked up.', { due: num(due), fresh: num(fresh) })
    : ttn(saved, '{n} word saved, none due. {fresh} new from words you looked up.', '{n} words saved, none due. {fresh} new from words you looked up.', { fresh: num(fresh) });
}

export interface DueLabel { text: string; state: 'new' | 'due' | 'later' }

/** "New", "Due now" or "Due in 3d". */
export function dueLabel(item: VocabItem, now: number): DueLabel {
  if (item.srs.due <= now) {
    return item.srs.reps === 0 && !item.srs.last ? { text: tt('New'), state: 'new' } : { text: tt('Due now'), state: 'due' };
  }
  return { text: tt('Due in {when}', { when: formatInterval(item.srs.due - now) }), state: 'later' };
}

export interface ContextParts { before: string; match: string; after: string }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A letter, mark or digit: what a word is made of, so "un" is not found inside "una". */
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]';

/** Where `w` stands in `sentence` as a whole word, in any case ("La" for la), with the text as the sentence has it; null if absent. */
function findWord(sentence: string, w: string): { at: number; text: string } | null {
  let re: RegExp;
  try {
    re = new RegExp(`(?<!${WORD_CHAR})${escapeRe(w.trim()).replace(/\s+/g, '\\s+')}(?!${WORD_CHAR})`, 'iu');
  } catch { return null; }
  const m = re.exec(sentence);
  return m ? { at: m.index, text: m[0] } : null;
}

/** Recent splits by an engine's tokens (a long Vocabulary list draws the same rows again as the search changes). */
const byToken = new Map<string, ContextParts | null>();

/** The first token of `sentence` whose key is `key` (vivía for vivir, Welche for welcher), as the engine cuts it. */
function splitByKey(sentence: string, key: string): ContextParts | null {
  const engine = activeEngine();
  if (!engine) return null;
  const k = `${key}\u0000${sentence}`;
  const had = byToken.get(k);
  if (had !== undefined) return had;
  let out: ContextParts | null = null;
  try {
    const t = engine.segment(sentence).find((x) => x.kind === 'word' && x.key === key);
    if (t) out = { before: sentence.slice(0, t.start), match: sentence.slice(t.start, t.end), after: sentence.slice(t.end) };
  } catch { /* no mark */ }
  if (byToken.size > 2000) byToken.clear();
  byToken.set(k, out);
  return out;
}

/**
 * Split a sentence around the first occurrence of the word (either script), or null if absent. With spaces between words,
 * a word is found whole and in any case, and marked as the sentence spells it. When none of `words` is there and `key` is
 * given, the sentence is cut by the language's engine and the word with that key is marked (an inflected form).
 */
export function splitContext(sentence: string, words: string[], key?: string): ContextParts | null {
  const spaced = lang().spaced;
  let best = -1;
  let hit = '';
  for (const w of words) {
    if (!w) continue;
    const found = spaced ? findWord(sentence, w) : (() => { const i = sentence.indexOf(w); return i >= 0 ? { at: i, text: w } : null; })();
    if (found && (best < 0 || found.at < best)) { best = found.at; hit = found.text; }
  }
  if (best < 0) return key && !isChinese() ? splitByKey(sentence, key) : null;
  return { before: sentence.slice(0, best), match: hit, after: sentence.slice(best + hit.length) };
}

/**
 * Shorten a long sentence to a window around the word, cutting on code points. With spaces between words (`spaced`), a cut
 * falls between words, never inside one.
 */
export function excerpt(parts: ContextParts, max = 80, spaced = lang().spaced): ContextParts {
  const before = [...parts.before];
  const after = [...parts.after];
  const room = Math.max(0, max - [...parts.match].length);
  let kb = Math.min(before.length, Math.ceil(room / 2));
  const ka = Math.min(after.length, room - kb);
  kb = Math.min(before.length, room - ka); // leftover room goes to the other side
  let b = before.slice(before.length - kb).join('');
  let a = after.slice(0, ka).join('');
  const cutB = before.length > kb;
  const cutA = after.length > ka;
  if (spaced) {
    // Start at a word: drop what is left of a word cut in two, and the space after it.
    if (cutB && !/\s/.test(before[before.length - kb - 1] ?? '')) b = b.replace(/^\S*\s*/u, '');
    else if (cutB) b = b.replace(/^\s+/u, '');
    if (cutA && !/\s/.test(after[ka] ?? '')) a = a.replace(/\s*\S*$/u, '');
    else if (cutA) a = a.replace(/\s+$/u, '');
  }
  return {
    before: (cutB ? (spaced && b ? '… ' : '…') : '') + b,
    match: parts.match,
    after: a + (cutA ? (spaced && a ? ' …' : '…') : ''),
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
  // Whole words only (no engine here): "un" is not marked inside "una".
  const parts = splitContext(s, [item.simp, item.trad]);
  if (!parts) return escHtml(s);
  return `${escHtml(parts.before)}<b>${escHtml(parts.match)}</b>${escHtml(parts.after)}`;
}

/** The language in a file name or a tag: "spanish", "chinese". */
const langSlug = () => lang().name.toLowerCase().replace(/[^a-z]+/g, '-');

/** A download's name, dated by this device's calendar: lingupengu-spanish-vocab-2026-11-09.csv. */
export function exportFileName(kind: 'anki' | 'vocab', now: number = Date.now()): string {
  return `lingupengu-${langSlug()}-${kind}-${dayOf(now)}.${kind === 'anki' ? 'txt' : 'csv'}`;
}

/** A saved word's reading as an export shows it: pinyin in the chosen style, another language's as it is. */
const readingOf = (it: VocabItem, style: PinyinStyle) => (isChinese() ? formatPinyin(it.pinyin, style) : it.pinyin);

/**
 * Anki text import: tab separated, HTML on. Front = word + context sentence,
 * back = reading (when there is one) + gloss, third column = tag.
 */
export function ankiTsv(items: VocabItem[], style: PinyinStyle): string {
  const lines = ['#separator:tab', '#html:true', '#tags column:3'];
  const tag = `lingupengu::${langSlug()}`;
  for (const it of items) {
    const sentence = sentenceHtml(it);
    const front = `<b>${escHtml(it.simp)}</b>${sentence ? `<br>${sentence}` : ''}`;
    // No reading (Spanish, German...), or kana that only repeat the word: the back opens on the meaning.
    const reading = readingOf(it, style).trim();
    const back = reading && reading !== it.simp ? `${escHtml(reading)}<br>${escHtml(it.gloss)}` : escHtml(it.gloss);
    lines.push([ankiField(front), ankiField(back), tag].join('\t'));
  }
  return lines.join('\n') + '\n';
}

function csvField(s: string): string {
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The day on this device's calendar (the one the Vocabulary rows show), not the UTC day. */
const isoDay = (ms: number) => dayOf(ms);

/**
 * The columns a language has: Chinese its traditional form and pinyin, Japanese the kana reading, the others only the word.
 */
export function vocabCsv(items: VocabItem[], style: PinyinStyle): string {
  const id = langId();
  const extra = id === 'zh' ? ['traditional', 'pinyin'] : id === 'ja' ? ['reading'] : [];
  const head = ['word', ...extra, 'meaning', 'sentence', 'book', 'added', 'due'];
  const rows = items.map((it) => [
    it.simp, ...(id === 'zh' ? [it.trad, formatPinyin(it.pinyin, style)] : id === 'ja' ? [it.pinyin] : []), it.gloss, it.context?.sentence ?? '',
    it.context?.bookTitle ?? '', isoDay(it.addedAt), isoDay(it.srs.due),
  ]);
  // BOM so Excel reads the file as UTF-8.
  return '\uFEFF' + [head, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
