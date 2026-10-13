// Parsing CC-CEDICT definition text: cross-references ("瞭|了[liao3]"), classifier lines ("CL:個|个[ge4]"),
// plain-text glosses, and grouping dictionary rows by reading.
import type { DictEntry } from '../../types';

export type DefPart =
  | { t: 'text'; s: string }
  | { t: 'ref'; simp: string; trad: string; pinyin: string };

// trad|simp[pin1 yin1]  or  simp[pin1 yin1]. Han includes the astral extensions and Kangxi radicals.
const REF = /([\p{Script=Han}·]+)(?:\|([\p{Script=Han}·]+))?\[([^\]]+)\]/gu;

/** Split one definition into plain text and clickable cross-references. */
export function parseDefinition(def: string): DefPart[] {
  const out: DefPart[] = [];
  let last = 0;
  for (const m of def.matchAll(REF)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ t: 'text', s: def.slice(last, at) });
    const trad = m[1];
    const simp = m[2] ?? m[1];
    out.push({ t: 'ref', simp, trad, pinyin: m[3] });
    last = at + m[0].length;
  }
  if (last < def.length) out.push({ t: 'text', s: def.slice(last) });
  return out.length ? out : [{ t: 'text', s: def }];
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

const WEAK = /^(old |archaic |ancient |Japanese |unofficial |erhua )?variant (of|form of|pronunciation)|^(also written|same as|see |abbr\. for|also pr\.|Taiwan pr\.)/i;

/** A short card gloss: the first few real definitions, joined by "; ". */
export function shortGloss(entries: DictEntry[], max = 120): string {
  const picked: string[] = [];
  for (const e of entries) {
    const { rest } = splitClassifiers(e.defs);
    for (const d of rest) {
      const p = plainDefinition(d);
      if (p && !WEAK.test(p) && !picked.includes(p)) picked.push(p);
      if (picked.length >= 3) break;
    }
    if (picked.length >= 3) break;
  }
  if (!picked.length) {
    for (const e of entries) for (const d of e.defs) { const p = plainDefinition(d); if (p) { picked.push(p); break; } }
  }
  let s = picked.join('; ');
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…';
  return s;
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
    const key = e.pinyin;
    let g = map.get(key);
    if (!g) { g = { pinyin: e.pinyin, trad: e.trad, simp: e.simp, defs: [] }; map.set(key, g); }
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
