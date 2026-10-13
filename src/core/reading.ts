// Matching dictionary entries to the reading on screen, so a short gloss never contradicts the pinyin beside it,
// and ranking the senses so the one a reader wants leads (not a surname, an abbreviation or a variant form).
import type { DictEntry } from '../types';

const tones = /[1-5]/g;

// ----------------------------------------------------------- sense ranking ---

/** "surname Hou", "Japanese surname Hayashi". */
const SURNAME = /^(japanese |korean |chinese )?surname\b/i;
/** "abbr. for Xinjiang", "short name for Guizhou". */
const ABBR = /^(abbr\.|abbreviation|short (name )?for|short form)/i;
/** "variant of 煮[zhu3]", "old variant of 因[yin1]", "same as", "see": the row points at another headword. */
const VARIANT = /^((old|archaic|ancient|japanese|unofficial|erhua|euphemistic|dialectal|taiwan|korean) )*(variant|form)( of| pronunciation)?\b|^(also written|same as|see |see also|also pr\.|taiwan pr\.|pr\. )/i;
const ONOM = /^\(onom\.\)/i;
const USED_IN = /^used in /i;
const NOTE_VARIANT = /^\((variant|old variant) of /i;
/** "hemp (variant of 麻[ma2])": a meaning, but said of a variant spelling; the entry of the real word leads. */
const TRAILING_VARIANT = /\((?:old |archaic )?variant of [^)]*\)\s*$/i;

/**
 * How unattractive one definition is as the lead sense of a word (0 = a real meaning).
 * Surnames, abbreviations, pointers to a variant, sound words and "used in X" rank behind real meanings.
 */
export function defWeakness(def: string): number {
  const d = def.trim();
  if (SURNAME.test(d)) return 5;
  if (ABBR.test(d)) return 4;
  if (VARIANT.test(d)) return 4;
  if (ONOM.test(d)) return 3;
  if (USED_IN.test(d)) return 3;
  if (NOTE_VARIANT.test(d)) return 2;
  if (TRAILING_VARIANT.test(d)) return 2;
  return 0;
}

const isClassifier = (d: string) => /^CL:/.test(d);

/** Definitions with the weak ones moved behind the real meanings (stable; classifier lines keep their place). */
export function rankedDefs(defs: readonly string[]): string[] {
  const idx = defs.map((d, i) => ({ d, i, w: isClassifier(d) ? -1 : defWeakness(d) }));
  if (idx.every((x) => x.w <= 0)) return defs.slice();
  // Classifier lines are pulled out by the popup anyway; keep them where they were relative to their neighbors.
  const real = idx.filter((x) => x.w <= 0 || isClassifier(x.d));
  const weak = idx.filter((x) => x.w > 0).sort((a, b) => a.w - b.w || a.i - b.i);
  return [...real, ...weak].map((x) => x.d);
}

/** Entry-level weakness: that of its best definition, plus a little for proper-noun readings (capitalized pinyin). */
function entryWeakness(e: DictEntry, hasLowercaseTwin: boolean): number {
  // The first definition says what the row is: "(onom.) dong / ding dong (bell)" is a sound word even though its
  // second item reads like a meaning, and "surname Hou" is a surname whatever follows.
  let best = Infinity;
  for (const d of e.defs) { if (isClassifier(d)) continue; best = defWeakness(d); break; }
  if (best === Infinity) best = 0;
  const proper = /^[A-Z]/.test(e.pinyin) ? (hasLowercaseTwin ? 1 : 0.4) : 0;
  return best + proper;
}

/**
 * The same entries, ordered so the one a reader wants comes first, with the weak definitions inside each entry
 * moved to the end. Nothing is dropped and the input is not changed. `shown` is the word as it appears in the text:
 * in simplified text a character that merges several traditional ones (后 for 後) is far likelier than the original.
 */
export function rankEntries(entries: readonly DictEntry[], shown?: string): DictEntry[] {
  if (entries.length === 0) return [];
  const lower = new Set(entries.filter((e) => !/^[A-Z]/.test(e.pinyin)).map((e) => e.pinyin.toLowerCase()));
  const scored = entries.map((e, i) => {
    const defs = rankedDefs(e.defs);
    const same = defs.every((d, k) => d === e.defs[k]);
    const copy = same ? e : { ...e, defs };
    let w = entryWeakness(e, lower.has(e.pinyin.toLowerCase()));
    if (e.curated) w -= 1; // written for this app from the books: it leads
    // (A character that stands for several traditional ones, 后 for 後, used to get a nudge here. That also made 回 lead
    // with "to curve" (迴), so the nudge is gone; book-words.tsv puts the common sense of such characters first.)
    return { e: copy, i, w };
  });
  scored.sort((a, b) => a.w - b.w || a.i - b.i);
  return scored.map((x) => x.e);
}

// ------------------------------------------------------- reading matching ---

/**
 * `entries` reordered so the ones whose pinyin is the reading being shown come first: 说 shown as shuō leads
 * with "to speak", not shuì "to persuade". Sandhi-changed syllables (bú, yí) still match their entry by base.
 * Inside each part the entries are ranked by sense (see rankEntries), so a surname or a variant never leads.
 */
export function entriesForReading(entries: DictEntry[], syllables: readonly (string | undefined)[], shown?: string, around?: { prev?: string; next?: string }): DictEntry[] {
  const ranked = entriesForReadingOnly(entries, syllables, shown);
  return around ? senseByContext(ranked, shown, around) : ranked;
}

/** Characters that count a number of things: the 里 after them is the distance unit, not "inside". */
const COUNTING = '零〇一二三四五六七八九十百千万萬几幾两兩半数數多';

/**
 * One reading, two senses that the neighbors tell apart. 里 after a number is the unit of distance (二十里, 三百里) and the
 * village; after a noun (家里, 城里) it is "inside". The rows already have the reading right, so only the order changes.
 */
/** Definition (by pattern) that leads when the word is written in the traditional form. */
const OLD_NOVEL_LEAD: Readonly<Record<string, RegExp>> = {
  嘗: /^once\b/i, 賺: /^to trick/i, 槍: /^spear/i, 鎗: /^spear/i, 復: /^again\b/i,
};

function senseByContext(entries: DictEntry[], shown: string | undefined, around: { prev?: string; next?: string }): DictEntry[] {
  // The traditional spelling is the one the old novels use, and in them these words mean something other than the modern lead:
  // 嘗聞 "once", 賺 "to trick", 槍 鎗 "spear", 復 "again". The simplified spelling keeps the modern lead (尝试 赚钱 枪 复杂).
  const old = shown ? OLD_NOVEL_LEAD[shown] : undefined;
  if (old && entries.length) {
    const lead = entries[0];
    const at = lead.defs.findIndex((d) => old.test(d));
    if (at > 0) return [{ ...lead, defs: [lead.defs[at], ...lead.defs.slice(0, at), ...lead.defs.slice(at + 1)] }, ...entries.slice(1)];
  }
  // 十兩銀子, 二百兩黃金: after a number and before a metal, 兩 is the tael, not "two".
  if ((shown === '兩' || shown === '两') && entries.length && around.prev && COUNTING.includes([...around.prev].pop() ?? '') && /^[銀银金]/.test(around.next ?? '')) {
    const lead = entries[0];
    const tael = lead.defs.findIndex((d) => /^tael\b/i.test(d));
    if (tael > 0) return [{ ...lead, defs: [lead.defs[tael], ...lead.defs.slice(0, tael), ...lead.defs.slice(tael + 1)] }, ...entries.slice(1)];
  }
  // 「對麼？」 「不對。」: alone, or before a particle, 对 is "right"; before a noun it is "to, towards" (对他说).
  if ((shown === '對' || shown === '对') && entries.length && /^$|^[\p{P}\p{S}\s]|^[么麼嗎吗吧呢不了啊呀哇哪嘛咧]/u.test(around.next ?? '')) {
    const lead = entries[0];
    const right = lead.defs.findIndex((d) => /^right\b/i.test(d));
    if (right > 0) return [{ ...lead, defs: [lead.defs[right], ...lead.defs.slice(0, right), ...lead.defs.slice(right + 1)] }, ...entries.slice(1)];
  }
  if ((shown === '里' || shown === '裡' || shown === '裏') && around.prev && COUNTING.includes([...around.prev].pop() ?? '')) {
    const unit = entries.findIndex((e) => /\b(measure of length|unit of (distance|length))\b|^li, /i.test(e.defs.join('/')) && e.pinyin.toLowerCase() === entries[0]?.pinyin.toLowerCase());
    if (unit > 0) return [entries[unit], ...entries.slice(0, unit), ...entries.slice(unit + 1)];
  }
  // 之道 (三年無改於父之道) is "the way"; the sense of 道 that leads the novels' pages is "to say".
  if (shown === '道' && around.prev && [...around.prev].pop() === '之' && entries.length) {
    const lead = entries[0];
    const way = lead.defs.findIndex((d) => /^road\b/i.test(d));
    if (way > 0) return [{ ...lead, defs: [lead.defs[way], ...lead.defs.slice(0, way), ...lead.defs.slice(way + 1)] }, ...entries.slice(1)];
  }
  return entries;
}

function entriesForReadingOnly(entries: DictEntry[], syllables: readonly (string | undefined)[], shown?: string): DictEntry[] {
  const want = syllables.filter(Boolean).map((s) => s!.toLowerCase()).join(' ');
  if (entries.length < 2) return rankEntries(entries, shown);
  if (!want) return rankEntries(entries, shown);
  const norm = (p: string) => p.toLowerCase().replace(/u:/g, 'ü');
  let lead = entries.filter((e) => norm(e.pinyin) === want);
  if (!lead.length) lead = entries.filter((e) => norm(e.pinyin).replace(tones, '') === want.replace(tones, ''));
  if (!lead.length) return rankEntries(entries, shown);
  const rest = entries.filter((e) => !lead.includes(e));
  return [...rankEntries(lead, shown), ...rankEntries(rest, shown)];
}
