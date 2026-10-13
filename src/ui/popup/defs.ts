// Parsing CC-CEDICT definition text: cross-references ("瞭|了[liao3]"), classifier lines ("CL:個|个[ge4]"),
// plain-text glosses, and grouping dictionary rows by reading.
import type { DictEntry } from '../../types';
import { defWeakness, rankEntries, rankedDefs } from '../../core/reading';

export type DefPart =
  | { t: 'text'; s: string }
  | { t: 'ref'; simp: string; trad: string; pinyin: string };

// trad|simp[pin1 yin1]  or  simp[pin1 yin1]. Han includes the astral extensions and Kangxi radicals.
const REF = /([\p{Script=Han}·]+)(?:\|([\p{Script=Han}·]+))?\[([^\]]+)\]/gu;

// "戰國七雄|战国七雄" with no [pinyin] after it: CEDICT's trad|simp pair, not worth showing twice.
const BARE_PAIR = /([\p{Script=Han}·]+)\|([\p{Script=Han}·]+)(?!\[)/gu;
const ABBREVIATIONS: [RegExp, string][] = [
  [/\bfig\.(?=\s|$|[;,)])/g, 'figuratively'],
  [/\bcoll\.(?=\s|$|[;,)])/g, 'colloquial'],
  [/\blit\.(?=\s|$|[;,)])/g, 'literally'],
  [/\bTw\b(?=[);,\s])/g, 'Taiwan'],
  [/\bderog\.(?=\s|$|[;,)])/g, 'derogatory'],
  [/\bpoet\.(?=\s|$|[;,)])/g, 'poetic'],
  [/\barch\.(?=\s|$|[;,)])/g, 'archaic'],
];

/** Raw CEDICT notation turned into plain words: bare "trad|simp" pairs keep the simplified form, short tags are spelled out. */
export function cleanDefinitionText(s: string): string {
  let out = s.replace(BARE_PAIR, '$2');
  for (const [re, to] of ABBREVIATIONS) out = out.replace(re, to);
  return out;
}

/** Split one definition into plain text and clickable cross-references. */
export function parseDefinition(def: string): DefPart[] {
  const out: DefPart[] = [];
  let last = 0;
  const text = (s: string) => out.push({ t: 'text', s: cleanDefinitionText(s) });
  for (const m of def.matchAll(REF)) {
    const at = m.index ?? 0;
    if (at > last) text(def.slice(last, at));
    const trad = m[1];
    const simp = m[2] ?? m[1];
    out.push({ t: 'ref', simp, trad, pinyin: m[3] });
    last = at + m[0].length;
  }
  if (last < def.length) text(def.slice(last));
  return out.length ? out : [{ t: 'text', s: cleanDefinitionText(def) }];
}

export interface Classifier { simp: string; trad: string; pinyin: string }

const CL_PREFIX = /^CL:/;

/** Pull "CL:" lines out of a definition list. */
export function splitClassifiers(defs: string[]): { rest: string[]; classifiers: Classifier[] } {
  const rest: string[] = [];
  const classifiers: Classifier[] = [];
  for (const d of defs) {
    if (!CL_PREFIX.test(d)) { rest.push(d); continue; }
    for (const part of parseDefinition(d.replace(CL_PREFIX, ''))) {
      if (part.t === 'ref') classifiers.push({ simp: part.simp, trad: part.trad, pinyin: part.pinyin });
    }
  }
  return { rest, classifiers };
}

/** Definition as plain text: cross-references become just the simplified word. */
export function plainDefinition(def: string): string {
  return parseDefinition(def)
    .map((p) => (p.t === 'text' ? p.s : p.simp))
    .join('')
    .replace(/\s*\(CL:[^)]*\)/g, '') // "(CL:家)" notes belong on the measure-word line
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A short card gloss: the first few real definitions, joined by "; ". Surnames, abbreviations and variants come last.
 * `ordered`: the entries are already in the order to use (entriesForReading puts the reading on screen first and
 * ranks inside it), so they are not ranked again; otherwise they are ranked here.
 */
export function shortGloss(entries: DictEntry[], max = 120, ordered = false): string {
  const list = ordered ? entries.map((e) => ({ ...e, defs: rankedDefs(e.defs) })) : rankEntries(entries);
  const picked: string[] = [];
  for (const e of list) {
    const { rest } = splitClassifiers(e.defs);
    for (const d of rest) {
      const p = plainDefinition(d);
      if (p && defWeakness(d) === 0 && !picked.includes(p)) picked.push(p);
      if (picked.length >= 3) break;
    }
    if (picked.length >= 3) break;
  }
  if (!picked.length) {
    for (const e of list) for (const d of e.defs) { const p = plainDefinition(d); if (p) { picked.push(p); break; } }
  }
  let s = picked.join('; ');
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…';
  return s;
}

/**
 * The first real definition of the first entry that has one, as plain text (a character card's gloss). `entries` come
 * from entriesForReading, which already put the reading on screen first: a surname row that matches the reading (賈 jiǎ)
 * stays ahead of an unrelated reading (gǔ, "merchant"), and only when it has nothing else is "surname Jia" the lead.
 */
export function leadGloss(entries: DictEntry[], _shown?: string): string {
  if (!entries.length) return '';
  const reading = entries[0].pinyin.toLowerCase();
  const sameReading = entries.filter((e) => e.pinyin.toLowerCase() === reading);
  for (const e of sameReading) {
    const { rest } = splitClassifiers(rankedDefs(e.defs));
    const d = rest.find((x) => defWeakness(x) === 0);
    if (d) return plainDefinition(d);
  }
  // Nothing but weak senses for this reading (a surname, a variant pointer): say what there is rather than nothing.
  for (const e of sameReading) {
    const { rest } = splitClassifiers(rankedDefs(e.defs));
    if (rest[0]) return plainDefinition(rest[0]);
  }
  return '';
}

export interface ReadingGroup {
  /** Numbered pinyin as in CEDICT. */
  pinyin: string;
  trad: string;
  simp: string;
  defs: string[];
}

/** Rows with the same reading are one group; groups keep file order. */
export function groupByReading(entries: DictEntry[]): ReadingGroup[] {
  const map = new Map<string, ReadingGroup>();
  for (const e of entries) {
    const key = e.pinyin.toLowerCase(); // Hou4 (the surname) and hou4 are one reading
    let g = map.get(key);
    if (!g) { g = { pinyin: key, trad: e.trad, simp: e.simp, defs: [] }; map.set(key, g); }
    for (const d of e.defs) if (!g.defs.includes(d)) g.defs.push(d);
  }
  return [...map.values()];
}

const norm = (p: string) => p.toLowerCase().replace(/u:|v/g, 'ü').replace(/\s+/g, ' ').trim();

/** Does a CEDICT pinyin string equal the in-context syllable list (case and spacing ignored)? */
export function sameReading(cedict: string, syllables: string[]): boolean {
  return norm(cedict) === norm(syllables.filter(Boolean).join(' '));
}

/** Put the reading used in the sentence first; the rest keep their order. */
export function orderGroups(groups: ReadingGroup[], inContext: string[]): { groups: ReadingGroup[]; matched: boolean } {
  const i = groups.findIndex((g) => sameReading(g.pinyin, inContext));
  if (i <= 0) return { groups, matched: i === 0 };
  return { groups: [groups[i], ...groups.slice(0, i), ...groups.slice(i + 1)], matched: true };
}

/** "U+20000" style code point label. */
export function codePointLabel(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  return 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
}
