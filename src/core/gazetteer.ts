// The name list (gazetteer): people, places and organizations with an article on the Chinese Wikipedia, from Wikidata (CC0),
// built by scripts/build-gazetteer.mjs into public/data/names.tsv.gz. Name detection (core/lexicon.ts) reads it as a prior: a
// listed name seen once may join a book's names when nothing around it says otherwise. Contract: ARCHITECTURE.md §3 and §4.9.
//
// The list is fetched only when a book's names are detected, never for the first page. A missing, old or unreadable file
// gives null, and detection then runs on its rules alone, as before the list existed.

/** What a listed name is: a person, a place, an organization or something else (a dynasty, a people, a war). */
export type GazetteerKind = 'person' | 'place' | 'org' | 'other';

/** The file format this code reads (the `# format` comment); a file of another format is ignored. */
export const GAZETTEER_FORMAT = 1;
/** The longest name in the list, in characters. */
export const GAZETTEER_MAX = 8;

const KINDS: readonly GazetteerKind[] = ['person', 'place', 'org', 'other'];
const KIND_CODE: Readonly<Record<string, number>> = { p: 0, l: 1, o: 2, t: 3 };

export interface Gazetteer {
  /** How many names the list holds. */
  readonly size: number;
  /** The kind of a listed name (written in simplified characters, as the list is), or undefined. */
  kindOf(name: string): GazetteerKind | undefined;
  /**
   * Every listed name in `codes` (UTF-16 units already folded to simplified, one per unit of the text), as `hit(start, length,
   * kind)`. Names never cross a unit for which `han` is 0.
   */
  scan(codes: Uint16Array, han: Uint8Array, hit: (start: number, length: number, kind: GazetteerKind) => void): void;
}

const FNV_OFFSET = 2166136261;
/** Slots of the table of name lengths by their first two units. */
const PAIR_SLOTS = 1 << 20;
const pairKey = (a: number, b: number): number => (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b)) >>> 12;
const step = (h: number, c: number): number => Math.imul(h ^ c, 16777619) >>> 0;

/**
 * The list from the text of names.tsv(.gz): comment lines start with "# ", every other line is "name<TAB>kind" with kind p
 * (person), l (place), o (organization) or t (other). Null when the format comment is missing or names another format.
 * Held as typed arrays (one string of all names, offsets, an open-addressing hash table), not as a Set of 500,000 strings.
 */
export function parseGazetteer(text: string): Gazetteer | null {
  const fmt = /^# format (\d+)/m.exec(text.slice(0, 4000));
  if (!fmt || Number(fmt[1]) !== GAZETTEER_FORMAT) return null;
  // First pass: count names and their units, so the arrays are allocated once.
  let n = 0;
  let units = 0;
  for (let pos = 0; pos < text.length;) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = text.length;
    if (text.charCodeAt(pos) !== 35) {
      const tab = text.indexOf('\t', pos);
      if (tab > pos && tab < nl) { n++; units += tab - pos; }
    }
    pos = nl + 1;
  }
  const chars = new Uint16Array(units);
  const start = new Uint32Array(n + 1);
  const kind = new Uint8Array(n);
  const hashes = new Uint32Array(n);
  let cap = 1;
  while (cap < 1.25 * n) cap <<= 1;
  const mask = cap - 1;
  const slots = new Int32Array(cap).fill(-1);
  /** Lengths of the names that start with a pair of units, by a hash of the pair (bit k = length k): a scan tries only those. */
  const lengths = new Uint16Array(PAIR_SLOTS);
  let k = 0;
  let at = 0;
  for (let pos = 0; pos < text.length;) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = text.length;
    const tab = text.indexOf('\t', pos);
    if (text.charCodeAt(pos) !== 35 && tab > pos && tab < nl) {
      const len = tab - pos;
      const code = KIND_CODE[text[tab + 1]];
      if (code !== undefined && len >= 2 && len <= GAZETTEER_MAX) {
        let h = FNV_OFFSET;
        start[k] = at;
        for (let i = pos; i < tab; i++) { const c = text.charCodeAt(i); chars[at++] = c; h = step(h, c); }
        h = step(h, len);
        let s = h & mask;
        while (slots[s] >= 0) s = (s + 1) & mask;
        slots[s] = k;
        hashes[k] = h;
        kind[k] = code;
        lengths[pairKey(text.charCodeAt(pos), text.charCodeAt(pos + 1))] |= 1 << len;
        k++;
      }
    }
    pos = nl + 1;
  }
  start[k] = at;
  const size = k;

  /** The entry for `units[i, i + len)` whose hash is h, or -1. */
  const find = (units: Uint16Array, i: number, len: number, h: number): number => {
    for (let s = h & mask; slots[s] >= 0; s = (s + 1) & mask) {
      const e = slots[s];
      if (hashes[e] !== h || start[e + 1] - start[e] !== len) continue;
      let same = true;
      for (let j = 0, a = start[e]; j < len; j++, a++) if (chars[a] !== units[i + j]) { same = false; break; }
      if (same) return e;
    }
    return -1;
  };

  return {
    size,
    kindOf(name: string): GazetteerKind | undefined {
      const len = name.length;
      if (len < 2 || len > GAZETTEER_MAX) return undefined;
      const units = new Uint16Array(len);
      let h = FNV_OFFSET;
      for (let i = 0; i < len; i++) { units[i] = name.charCodeAt(i); h = step(h, units[i]); }
      const e = find(units, 0, len, step(h, len));
      return e < 0 ? undefined : KINDS[kind[e]];
    },
    scan(codes, han, hit) {
      const n2 = codes.length;
      for (let i = 0; i + 1 < n2; i++) {
        if (!han[i] || !han[i + 1]) continue;
        const want = lengths[pairKey(codes[i], codes[i + 1])];
        if (!want) continue;
        let h = step(FNV_OFFSET, codes[i]);
        for (let len = 2; len <= GAZETTEER_MAX && i + len <= n2 && han[i + len - 1]; len++) {
          h = step(h, codes[i + len - 1]);
          if (!(want & (1 << len))) continue;
          const e = find(codes, i, len, step(h, len));
          if (e >= 0) hit(i, len, KINDS[kind[e]]);
        }
      }
    },
  };
}

let cached: Promise<Gazetteer | null> | null = null;

/**
 * The list, fetched once per session from `url` (default data/names.tsv.gz next to the page); null when it cannot be had (offline
 * before it was ever stored, an old deployment without it, a file of another format). A failure is not kept: the next book tries
 * again.
 */
export function loadGazetteer(fetchText?: () => Promise<string>): Promise<Gazetteer | null> {
  cached ??= (async () => {
    const text = fetchText ? await fetchText() : await fetchListText();
    return parseGazetteer(text);
  })().then((g) => { if (!g) cached = null; return g; }, () => { cached = null; return null; });
  return cached;
}

async function fetchListText(): Promise<string> {
  if (typeof document === 'undefined') throw new Error('no page to fetch the name list from');
  const { fetchDataText } = await import('./dataFetch');
  return fetchDataText(new URL('data/names.tsv.gz', document.baseURI).href);
}
