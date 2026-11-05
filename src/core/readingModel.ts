// The reading model: a small per-character classifier for the one-character tokens the reading rules leave alone.
// Contract: ARCHITECTURE.md §4.1 (Reading model).
//
// The rules in core/polyphone.ts run first. Where none of their cases speaks for a one-character token whose character has two
// or more readings, Dushu asks this model, trained offline by scripts/train_reading_model.py on CPP (Wikipedia sentences,
// CC BY-SA), on what the rules' own cases read in public-domain books, and on hand-labeled places in books. It looks at the
// characters and tokens around the character, the rest of its clause, the paragraph's register and script, picks among that
// character's own readings only, and changes the default reading only when it is at least as sure as the file says for that
// character. The file (data/reading-model.tsv.gz) is loaded after the dictionary; without it, or with a file of another
// version, the rules alone give the readings.

/** What the model may see around a one-character token. */
export interface ReadingSite {
  /** The character, folded to simplified. */
  ch: string;
  /** The token k places from this one (k < 0 before it), folded to simplified, "" past either end of the paragraph. */
  tok: (k: number) => string;
  /** How much of a verb a word is from its dictionary senses (2 every sense "to …", 1 some, 0 none or not listed). */
  verb: (w: string) => number;
  /** Whether the dictionary makes a word a noun (a classifier note, a proper name). */
  noun: (w: string) => boolean;
  /** The script the paragraph is written in, as the book writes it (core/text.ts detectScript); absent when unknown. */
  script?: () => string;
  /** The character's reading in the dictionary word it makes with the character just before it (-1) or after it (1), "" if none. */
  pair?: (k: -1 | 1) => string;
}

/** What the dictionary asks the model (core/dict.ts pinyinFor). */
export interface ReadingChooser {
  /** Whether the model may speak for this character at all (asked first, so most tokens cost one lookup). */
  knows?(ch: string): boolean;
  /**
   * A reading for the site other than `fallback`, or undefined to keep `fallback`. `allowed` says whether a reading is one of the
   * character's own (as shown and as the book writes it).
   */
  choose(site: ReadingSite, fallback: string, allowed: (reading: string) => boolean): string | undefined;
  /**
   * Shown every one-character site, with the rules' reading and whether one of their cases decided it (only the training tools
   * set this: scripts/eval/zh-reading-sites.run.ts).
   */
  observe?(site: ReadingSite, reading: string, decided: boolean): void;
}

/** Bump with any change to siteFeatures: a model file of another version is not used. */
export const READING_FEATURES_VERSION = 2;

/** Characters the model never reads: particles, interjections and suffixes, whose readings the rules own. */
export const NOT_FOR_MODEL = new Set([...'了着著得地的儿兒么麼罢罷吧呢啊呀哇啦哪嘛哟喔哦噢呐咯哩唻嘞呗唄啰囉耶邪欤歟乎哉兮焉矣也夫唉嗯哼嘿哈喂呸噫嘻吁咦嗨呃嗳噯哎呦呵嚯个個们們子头頭一不']);

const HAN = /\p{Script=Han}/u;
const CLAUSE_END = /^[。！？!?；;…．]/;

/** One code point or token as a feature value: Han as itself, the rest by kind. */
function kindOf(s: string, end: string): string {
  if (!s) return end;
  if (HAN.test(String.fromCodePoint(s.codePointAt(0)!))) return s;
  const c = s[0];
  if (CLAUSE_END.test(c)) return '。';
  if (/^[，,、：:]/.test(c)) return '，';
  if (/^[「『“‘《（(【〈\[]/.test(c)) return '「';
  if (/^[」』”’》）)】〉\]]/.test(c)) return '」';
  if (/^[0-9０-９]/.test(c)) return '9';
  if (/^[A-Za-zＡ-Ｚａ-ｚ]/.test(c)) return 'a';
  if (/^\s/.test(c)) return '_';
  return '~';
}

const isHanTok = (t: string): boolean => t !== '' && HAN.test(String.fromCodePoint(t.codePointAt(0)!));
const bucket = (n: number, top: number): string => String(Math.min(n, top));

/** The Han tokens from this one to the end (dir 1) or start (dir -1) of its clause, at most 12. */
function clause(s: ReadingSite, dir: 1 | -1): string[] {
  const out: string[] = [];
  for (let k = dir; Math.abs(k) <= 12; k += dir) {
    const t = s.tok(k);
    if (!isHanTok(t)) break;
    out.push(t);
  }
  return out;
}

/** The Han tokens from this one to the end (dir 1) or start (dir -1) of its clause, past quotes, numbers and names, at most 16. */
function clauseWide(s: ReadingSite, dir: 1 | -1): string[] {
  const out: string[] = [];
  for (let k = dir; Math.abs(k) <= 24 && out.length < 16; k += dir) {
    const t = s.tok(k);
    if (!t || CLAUSE_STOP.test(t)) break;
    if (isHanTok(t)) out.push(t);
  }
  return out;
}

const CLAUSE_STOP = /^[，,。．；;：:！!？?…、]/;
/** Tokens of the vernacular and of the classical register, counted by kind around the character. */
const VERNACULAR = new Set(['的', '着', '了', '呢', '吗', '么', '们', '这', '那', '咱', '俺', '哩', '罢', '呀', '啊', '吧']);
const CLASSICAL = new Set(['之', '乎', '者', '也', '矣', '焉', '哉', '曰', '其', '乃', '亦', '皆', '而', '遂', '吾', '汝', '尔', '耳']);

/** How many kinds of vernacular and of classical tokens the paragraph has within 30 tokens of the character, each at most 3. */
function register(s: ReadingSite): [number, number] {
  const v = new Set<string>();
  const c = new Set<string>();
  for (const dir of [-1, 1]) {
    for (let k = dir; Math.abs(k) <= 30; k += dir) {
      const t = s.tok(k);
      if (!t) break;
      if (VERNACULAR.has(t)) v.add(t);
      else if (CLASSICAL.has(t)) c.add(t);
    }
  }
  return [Math.min(v.size, 3), Math.min(c.size, 3)];
}

/** Up to three code points on one side of the character, across tokens, each as kindOf gives it. */
function charsBeside(s: ReadingSite, dir: 1 | -1): string[] {
  const out: string[] = [];
  for (let k = dir; out.length < 3; k += dir) {
    const t = s.tok(k);
    if (!t) { out.push(dir < 0 ? '^' : '$'); break; }
    const cps = Array.from(t);
    if (dir < 0) cps.reverse();
    for (const c of cps) {
      out.push(kindOf(c, ''));
      if (out.length === 3) break;
    }
  }
  while (out.length < 3) out.push(dir < 0 ? '^' : '$');
  return out;
}

/**
 * The features of a site, as strings, given the rules' reading there. scripts/train_reading_model.py trains on exactly these (it
 * gets them from this function through scripts/eval/zh-reading-sites.run.ts), so the model and the app always see the same thing.
 */
export function siteFeatures(s: ReadingSite, fallback: string): string[] {
  const p1 = s.tok(-1), n1 = s.tok(1), p2 = s.tok(-2), n2 = s.tok(2);
  const left = charsBeside(s, -1);
  const right = charsBeside(s, 1);
  const after = clause(s, 1);
  const before = clause(s, -1);
  const last = after[after.length - 1] ?? '';
  const f = [
    `w-1:${kindOf(p1, '^')}`, `w+1:${kindOf(n1, '$')}`, `w-2:${kindOf(p2, '^')}`, `w+2:${kindOf(n2, '$')}`,
    `c-1:${left[0]}`, `c-2:${left[1]}`, `c-3:${left[2]}`, `c+1:${right[0]}`, `c+2:${right[1]}`, `c+3:${right[2]}`,
    `cc-:${left[1]}${left[0]}`, `cc+:${right[0]}${right[1]}`, `c-+:${left[0]}${right[0]}`,
    `E:${bucket(after.length, 5)}`, `S:${bucket(before.length, 5)}`,
  ];
  if (isHanTok(p1)) f.push(`L-1:${bucket(Array.from(p1).length, 3)}`, `V-1:${s.verb(p1)}`);
  if (isHanTok(n1)) f.push(`L+1:${bucket(Array.from(n1).length, 3)}`, `V+1:${s.verb(n1)}`, `N+1:${s.noun(n1) ? 1 : 0}`);
  if (last) {
    f.push(`ce:${last}`, `Vce:${s.verb(last)}`, `Nce:${s.noun(last) ? 1 : 0}`);
    let v = 0;
    for (const t of after) v = Math.max(v, s.verb(t));
    f.push(`Vmax:${v}`);
  }
  // What the rules would say, the whole clause on both sides (为 … 所, 以 … 为), the register and the script.
  f.push(`u:${fallback}`);
  for (const t of new Set(clauseWide(s, 1))) f.push(`A:${t}`);
  for (const t of new Set(clauseWide(s, -1))) f.push(`B:${t}`);
  const [rv, rc] = register(s);
  f.push(`rv:${rv}`, `rc:${rc}`, `rg:${rv}${rc}`);
  const script = s.script?.();
  if (script) f.push(`sc:${script[0]}`);
  // The reading the dictionary gives the character in a word with its neighbor, where the cut went elsewhere.
  const pb = s.pair?.(-1), pa = s.pair?.(1);
  if (pb) f.push(`p-:${pb}`);
  if (pa) f.push(`p+:${pa}`);
  return f;
}

/** One character's model: readings[0] scores 0, readings[k] scores bias[k-1] + the sum of its feature weights. */
interface CharModel {
  readings: string[];
  bias: number[];
  weights: Map<string, number[]>;
}

export class ReadingModel implements ReadingChooser {
  /**
   * `threshold` is the default; `thresholds` the characters set on their own hand-labeled places, keyed by the character, or by
   * "char:reading" for changing it to that reading (为:wei2).
   */
  constructor(readonly chars: ReadonlyMap<string, CharModel>, readonly threshold: number, readonly thresholds: ReadonlyMap<string, number> = new Map()) {}

  /** How sure the model must be to change this character's reading (to `reading`, when given). */
  thresholdOf(ch: string, reading?: string): number {
    return (reading === undefined ? undefined : this.thresholds.get(`${ch}:${reading}`)) ?? this.thresholds.get(ch) ?? this.threshold;
  }

  /** Whether the model knows this character. */
  has(ch: string): boolean {
    return this.chars.has(ch) && !NOT_FOR_MODEL.has(ch);
  }

  knows(ch: string): boolean {
    return this.has(ch);
  }

  /** Each of the character's readings with its probability, or null when the model does not know the character. */
  scores(ch: string, features: readonly string[]): { reading: string; p: number }[] | null {
    const m = this.chars.get(ch);
    if (!m) return null;
    const z = [0, ...m.bias];
    for (const feat of features) {
      const w = m.weights.get(feat);
      if (w) for (let k = 0; k < w.length; k++) z[k + 1] += w[k];
    }
    const top = Math.max(...z);
    const e = z.map((x) => Math.exp(x - top));
    const sum = e.reduce((a, b) => a + b, 0);
    return m.readings.map((reading, k) => ({ reading, p: e[k] / sum }));
  }

  choose(site: ReadingSite, fallback: string, allowed: (reading: string) => boolean): string | undefined {
    if (!this.has(site.ch)) return undefined;
    const scored = this.scores(site.ch, siteFeatures(site, fallback));
    if (!scored) return undefined;
    let best = scored[0];
    for (const x of scored) if (x.p > best.p) best = x;
    if (best.reading === fallback || best.p < this.thresholdOf(site.ch, best.reading) || !allowed(best.reading)) return undefined;
    // Sure only against the readings the model knows: the default must be one of them.
    if (!scored.some((x) => x.reading === fallback)) return undefined;
    return best.reading;
  }
}

/**
 * Reads data/reading-model.tsv.gz (decompressed). Lines: "# " comments; "!<TAB>key<TAB>value" settings (v = the features
 * version, threshold, threshold:<char> for one character, threshold:<char>:<reading> for changing it to that reading); then one
 * character per line: char, its readings (space-separated, numbered), the biases of readings 2…K, and one "feature w2 … wK"
 * column per feature. Null when the file is of another version or unreadable.
 */
export function parseReadingModel(text: string): ReadingModel | null {
  const chars = new Map<string, CharModel>();
  const thresholds = new Map<string, number>();
  let version = 0;
  let threshold = 1;
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('# ')) continue;
    const cols = line.split('\t');
    if (cols[0] === '!') {
      if (cols[1] === 'v') version = Number(cols[2]);
      else if (cols[1] === 'threshold') threshold = Number(cols[2]);
      else if (cols[1]?.startsWith('threshold:') && Number(cols[2]) > 0 && Number(cols[2]) <= 1) thresholds.set(cols[1].slice(10), Number(cols[2]));
      continue;
    }
    if (cols.length < 3) continue;
    const readings = cols[1].split(' ');
    const bias = cols[2].split(' ').map(Number);
    if (readings.length < 2 || bias.length !== readings.length - 1) continue;
    const weights = new Map<string, number[]>();
    for (let i = 3; i < cols.length; i++) {
      const parts = cols[i].split(' ');
      const w = parts.slice(1).map(Number);
      if (w.length === bias.length && w.every(Number.isFinite)) weights.set(parts[0], w);
    }
    chars.set(cols[0], { readings, bias, weights });
  }
  if (version !== READING_FEATURES_VERSION || !chars.size || !(threshold > 0 && threshold <= 1)) return null;
  return new ReadingModel(chars, threshold, thresholds);
}

/** The model file's name in data/. */
export const READING_MODEL_FILE = 'reading-model.tsv.gz';

/** Downloads and reads the model; null when it is missing, old or broken (the rules alone then give every reading). */
export async function loadReadingModel(fetchText: (name: string) => Promise<string>): Promise<ReadingModel | null> {
  try {
    return parseReadingModel(await fetchText(READING_MODEL_FILE));
  } catch {
    return null;
  }
}
