// Japanese morphological analysis over the IPADIC files of kuromoji.js. This is a TypeScript port of kuromoji's dictionary
// reader and Viterbi search (kuromoji.js 0.1.2, Apache-2.0, Copyright 2014 Takuya Asano, 2010-2014 Atilika Inc. and
// contributors). It is ported rather than imported so the files load through our own fetch path (the service worker caches
// them), and so the lattice lives in typed arrays: kuromoji builds a JS object per dictionary key at load and re-encodes the
// rest of the sentence to UTF-8 at every position, which made long paragraphs slow.

/** One morpheme on the best path, with IPADIC's features. */
export interface Morpheme {
  /** UTF-16 offsets into the analyzed text. */
  start: number;
  end: number;
  surface: string;
  /** 品詞 and its three subdivisions ('*' when none): 名詞,固有名詞,人名,姓. */
  pos: string;
  pos1: string;
  pos2: string;
  pos3: string;
  /** Conjugation type (五段・カ行イ音便) and form (連用タ接続), '*' when it does not conjugate. */
  ctype: string;
  cform: string;
  /** Dictionary form ('*' for unknown words). */
  base: string;
  /** Katakana reading and pronunciation ('' for unknown words). */
  reading: string;
  pron: string;
  /** False for a word the dictionary does not have (the unknown-word model guessed it). */
  known: boolean;
}

/** The decompressed kuromoji dictionary files, by name without .gz ("base.dat"). */
export type IpadicFiles = Record<'base.dat' | 'check.dat' | 'tid.dat' | 'tid_pos.dat' | 'tid_map.dat' | 'cc.dat' | 'unk.dat' | 'unk_pos.dat' | 'unk_map.dat' | 'unk_char.dat' | 'unk_invoke.dat', Uint8Array>;

export const IPADIC_FILES: (keyof IpadicFiles)[] = ['base.dat', 'check.dat', 'tid.dat', 'tid_pos.dat', 'tid_map.dat', 'cc.dat', 'unk.dat', 'unk_pos.dat', 'unk_map.dat', 'unk_char.dat', 'unk_invoke.dat'];

interface CharClass { id: number; name: string; invoke: boolean; group: boolean; length: number }

/** Bytes as little-endian 32-bit ints; copied when the bytes do not start on a 4-byte boundary (Node's pooled Buffers). */
function int32s(b: Uint8Array): Int32Array {
  if (b.byteOffset % 4 === 0) return new Int32Array(b.buffer, b.byteOffset, b.byteLength >> 2);
  return new Int32Array(b.slice().buffer, 0, b.byteLength >> 2);
}

function int16s(b: Uint8Array): Int16Array {
  if (b.byteOffset % 2 === 0) return new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1);
  return new Int16Array(b.slice().buffer, 0, b.byteLength >> 1);
}

/** Token info records (left id, right id, cost, offset of the feature string), 10 bytes each, as columns. */
class TokenInfo {
  readonly left: Int16Array;
  readonly right: Int16Array;
  readonly cost: Int16Array;
  readonly posAt: Int32Array;
  /** Record indices per key, as offsets into `ids` (CSR): key k owns ids[start[k] .. start[k + 1]). */
  readonly start: Int32Array;
  readonly ids: Int32Array;
  private readonly features: Uint8Array;
  private readonly cache = new Map<number, string>();
  private static readonly decoder = new TextDecoder();

  constructor(tid: Uint8Array, pos: Uint8Array, map: Uint8Array) {
    const n = Math.floor(tid.length / 10);
    this.left = new Int16Array(n);
    this.right = new Int16Array(n);
    this.cost = new Int16Array(n);
    this.posAt = new Int32Array(n);
    const dv = new DataView(tid.buffer, tid.byteOffset, tid.byteLength);
    for (let i = 0, o = 0; i < n; i++, o += 10) {
      this.left[i] = dv.getInt16(o, true);
      this.right[i] = dv.getInt16(o + 2, true);
      this.cost[i] = dv.getInt16(o + 4, true);
      this.posAt[i] = dv.getInt32(o + 6, true);
    }
    this.features = pos;
    // tid_map: [count] then (key, n, n record offsets) per key, keys ascending but not dense.
    const m = new DataView(map.buffer, map.byteOffset, map.byteLength);
    const keys: number[] = [];
    let total = 0;
    let maxKey = 0;
    for (let o = 4; o + 8 <= map.byteLength;) {
      const k = m.getInt32(o, true);
      const c = m.getInt32(o + 4, true);
      if (c === 0 && k === 0 && o > 4) break; // zero padding at the end
      keys.push(o);
      if (k > maxKey) maxKey = k;
      total += c;
      o += 8 + 4 * c;
    }
    this.start = new Int32Array(maxKey + 2);
    this.ids = new Int32Array(total);
    const count = new Int32Array(maxKey + 1);
    for (const o of keys) count[m.getInt32(o, true)] = m.getInt32(o + 4, true);
    for (let k = 0, acc = 0; k <= maxKey; k++) { this.start[k] = acc; acc += count[k]; this.start[k + 1] = acc; }
    for (const o of keys) {
      const k = m.getInt32(o, true);
      const c = m.getInt32(o + 4, true);
      for (let j = 0; j < c; j++) this.ids[this.start[k] + j] = m.getInt32(o + 8 + 4 * j, true) / 10;
    }
  }

  /** The comma-separated feature string of record `i` (surface first for known words, the class name for unknown ones). */
  featureLine(i: number): string {
    let s = this.cache.get(i);
    if (s !== undefined) return s;
    const from = this.posAt[i];
    let to = from;
    const f = this.features;
    while (to < f.length && f[to] !== 0) to++;
    s = TokenInfo.decoder.decode(f.subarray(from, to));
    if (this.cache.size > 50000) this.cache.clear();
    this.cache.set(i, s);
    return s;
  }
}

const TERM = 0;

/** Character classes of IPADIC's char.def, as kuromoji stored them. */
function readClasses(invoke: Uint8Array): CharClass[] {
  const out: CharClass[] = [];
  const dv = new DataView(invoke.buffer, invoke.byteOffset, invoke.byteLength);
  let p = 0;
  while (p + 6 < invoke.length) {
    const inv = invoke[p];
    const grp = invoke[p + 1];
    const len = dv.getInt32(p + 2, true);
    p += 6;
    let e = p;
    while (e < invoke.length && invoke[e] !== 0) e++;
    if (e === p) break;
    out.push({ id: out.length, name: new TextDecoder().decode(invoke.subarray(p, e)), invoke: inv === 1, group: grp === 1, length: len });
    p = e + 1;
  }
  return out;
}

/** Growable typed-array storage for the lattice of one analysis. */
class Nodes {
  size = 0;
  cap: number;
  start: Int32Array;
  end: Int32Array;
  rec: Int32Array; // record index; unknown records are offset by UNK
  left: Int16Array;
  right: Int16Array;
  total: Float64Array;
  prev: Int32Array;
  /** Next node ending at the same position (a linked list per end position). */
  nextAtEnd: Int32Array;
  constructor(cap: number) {
    this.cap = cap;
    this.start = new Int32Array(cap);
    this.end = new Int32Array(cap);
    this.rec = new Int32Array(cap);
    this.left = new Int16Array(cap);
    this.right = new Int16Array(cap);
    this.total = new Float64Array(cap);
    this.prev = new Int32Array(cap);
    this.nextAtEnd = new Int32Array(cap);
  }
  grow(): void {
    const cap = this.cap * 2;
    const g = <T extends Int32Array | Int16Array | Float64Array>(a: T, make: new (n: number) => T): T => { const b = new make(cap); b.set(a); return b; };
    this.start = g(this.start, Int32Array);
    this.end = g(this.end, Int32Array);
    this.rec = g(this.rec, Int32Array);
    this.left = g(this.left, Int16Array);
    this.right = g(this.right, Int16Array);
    this.total = g(this.total, Float64Array);
    this.prev = g(this.prev, Int32Array);
    this.nextAtEnd = g(this.nextAtEnd, Int32Array);
    this.cap = cap;
  }
}

const NO_BREAKS: readonly number[] = [];

/** Offset added to unknown-word record indices so one Int32 column holds both kinds. */
const UNK = 1 << 30;

export class Ipadic {
  private readonly base: Int32Array;
  private readonly check: Int32Array;
  private readonly words: TokenInfo;
  private readonly unknown: TokenInfo;
  private readonly cc: Int16Array;
  private readonly ccCols: number;
  private readonly charClass: Uint8Array;
  private readonly classes: CharClass[];
  private readonly classByName: Map<string, CharClass>;
  private nodes = new Nodes(4096);
  private headAtEnd = new Int32Array(1024);

  constructor(f: IpadicFiles) {
    this.base = int32s(f['base.dat']);
    this.check = int32s(f['check.dat']);
    this.words = new TokenInfo(f['tid.dat'], f['tid_pos.dat'], f['tid_map.dat']);
    this.unknown = new TokenInfo(f['unk.dat'], f['unk_pos.dat'], f['unk_map.dat']);
    this.cc = int16s(f['cc.dat']);
    this.ccCols = this.cc[1];
    this.charClass = f['unk_char.dat'];
    this.classes = readClasses(f['unk_invoke.dat']);
    this.classByName = new Map(this.classes.map((c) => [c.name, c]));
  }

  private child(parent: number, code: number): number {
    const base = this.base;
    const b = parent < base.length ? base[parent] : -parent + 1;
    const c = b + code;
    const chk = c >= 0 && c < this.check.length ? this.check[c] : -c - 1;
    return chk === parent ? c : -1;
  }

  /** The value stored for a key ending at trie node `node`, or -1. */
  private valueAt(node: number): number {
    const t = this.child(node, TERM);
    if (t < 0) return -1;
    const b = this.base[t];
    return b <= 0 ? -b - 1 : -1;
  }

  /** The char.def class of the character at `i` (kuromoji maps undefined BMP characters to SPACE by mistake; they are DEFAULT here). */
  private classOf(text: string, i: number): CharClass {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) return this.classes[0];
    // 々 and 〆 are written inside words like kanji (人々, 〆切); char.def files them as symbols.
    if (c === 0x3005 || c === 0x3006) return this.classByName.get('KANJI') ?? this.classes[0];
    const id = this.charClass[c];
    if (id === 1 && c !== 0x20 && c !== 0x3000 && !(c >= 9 && c <= 13)) return this.classes[0];
    return this.classes[id] ?? this.classes[0];
  }

  private addNode(at: number, end: number, rec: number, info: TokenInfo, r: number): void {
    const nd = this.nodes;
    if (nd.size === nd.cap) nd.grow();
    const id = nd.size++;
    const left = info.left[r];
    nd.start[id] = at;
    nd.end[id] = end;
    nd.rec[id] = rec;
    nd.left[id] = left;
    nd.right[id] = info.right[r];
    // Forward Viterbi step: every node ending at `at` is final already, because nodes are added in order of start.
    let best = Infinity;
    let bestPrev = -1;
    const cc = this.cc;
    const cols = this.ccCols;
    for (let p = this.headAtEnd[at]; p >= 0; p = nd.nextAtEnd[p]) {
      const t = nd.total[p];
      if (t === Infinity) continue;
      const s = t + cc[nd.right[p] * cols + left + 2];
      if (s < best) { best = s; bestPrev = p; }
    }
    nd.total[id] = best + info.cost[r];
    nd.prev[id] = bestPrev;
    nd.nextAtEnd[id] = this.headAtEnd[end];
    this.headAtEnd[end] = id;
  }

  /**
   * The best morpheme path through text[from, to). `breaks` (offsets into `text`, ascending) are places no morpheme may
   * cross: the edges of a reading the book prints (都｜洛陽《らくよう》 is 都 | 洛陽, whatever IPADIC would have glued).
   */
  analyze(text: string, from = 0, to = text.length, breaks: readonly number[] = NO_BREAKS): Morpheme[] {
    const n = to - from;
    if (n <= 0) return [];
    let nextBreak = 0;
    if (this.headAtEnd.length < n + 2) this.headAtEnd = new Int32Array(Math.max(n + 2, this.headAtEnd.length * 2));
    const head = this.headAtEnd;
    head.fill(-1, 0, n + 2);
    const nd = this.nodes;
    nd.size = 0;
    // BOS
    nd.start[0] = 0; nd.end[0] = 0; nd.rec[0] = -1; nd.left[0] = 0; nd.right[0] = 0; nd.total[0] = 0; nd.prev[0] = -1; nd.nextAtEnd[0] = -1;
    nd.size = 1;
    head[0] = 0;
    const words = this.words;
    const unk = this.unknown;
    for (let i = 0; i < n; i++) {
      if (head[i] < 0) continue; // nothing reaches here (the low half of a surrogate pair)
      const c0 = text.charCodeAt(from + i);
      if (c0 >= 0xdc00 && c0 <= 0xdfff) continue;
      // Nothing that starts here may run past the next break.
      while (nextBreak < breaks.length && breaks[nextBreak] - from <= i) nextBreak++;
      const limit = nextBreak < breaks.length ? Math.min(n, breaks[nextBreak] - from) : n;
      // Dictionary words starting here: walk the trie over the UTF-8 bytes of the following characters.
      let found = false;
      let node = 0;
      for (let j = i; j < limit; j++) {
        let cp = text.charCodeAt(from + j);
        if (cp >= 0xd800 && cp <= 0xdbff) break; // the dictionary has no astral characters
        let ok = true;
        if (cp < 0x80) { node = this.child(node, cp); ok = node >= 0; }
        else if (cp < 0x800) {
          node = this.child(node, 0xc0 | (cp >> 6)); ok = node >= 0;
          if (ok) { node = this.child(node, 0x80 | (cp & 63)); ok = node >= 0; }
        } else {
          node = this.child(node, 0xe0 | (cp >> 12)); ok = node >= 0;
          if (ok) { node = this.child(node, 0x80 | ((cp >> 6) & 63)); ok = node >= 0; }
          if (ok) { node = this.child(node, 0x80 | (cp & 63)); ok = node >= 0; }
        }
        if (!ok) break;
        const v = this.valueAt(node);
        if (v >= 0 && v + 1 < words.start.length) {
          for (let k = words.start[v]; k < words.start[v + 1]; k++) {
            const r = words.ids[k];
            this.addNode(i, j + 1, r, words, r);
            found = true;
          }
        }
      }
      // Unknown words (MeCab's rules): the run of characters of the same class when the class groups, and 1..length
      // characters, whenever no dictionary word starts here or the class always invokes.
      const cls = this.classOf(text, from + i);
      if (found && !cls.invoke) continue;
      const lens = new Set<number>();
      const step = (k: number) => (text.charCodeAt(from + k) >= 0xd800 && text.charCodeAt(from + k) <= 0xdbff ? 2 : 1);
      if (cls.group) {
        let k = i + step(i);
        while (k < limit && this.classOf(text, from + k).id === cls.id) k += step(k);
        lens.add(k - i);
      }
      // Unknown kanji are taken one at a time (as kuromoji does): MeCab's two-kanji guesses glue the wrong pairs (級俸|上 as
      // 俸上), and words.ts joins single kanji that JMdict knows as a whole.
      const maxLen = cls.name === 'KANJI' ? 1 : cls.length;
      for (let k = i, c = 0; c < maxLen && k < limit; c++) {
        if (c > 0 && this.classOf(text, from + k).id !== cls.id) break;
        k += step(k);
        lens.add(k - i);
      }
      if (lens.size === 0) lens.add(step(i));
      const list = unk.start[cls.id + 1] !== undefined ? cls.id : 0;
      for (const len of lens) {
        for (let k = unk.start[list]; k < unk.start[list + 1]; k++) {
          const r = unk.ids[k];
          this.addNode(i, i + len, UNK + r, unk, r);
        }
      }
    }
    // EOS: the best node ending at n, plus its connection to EOS (left id 0).
    let best = Infinity;
    let last = -1;
    for (let p = head[n]; p >= 0; p = nd.nextAtEnd[p]) {
      const t = nd.total[p];
      if (t === Infinity) continue;
      const s = t + this.cc[nd.right[p] * this.ccCols + 2];
      if (s < best) { best = s; last = p; }
    }
    const path: number[] = [];
    for (let p = last; p > 0; p = nd.prev[p]) path.push(p);
    path.reverse();
    const out: Morpheme[] = [];
    for (const p of path) out.push(this.morpheme(text, from, nd.start[p], nd.end[p], nd.rec[p]));
    return out;
  }

  private morpheme(text: string, from: number, s: number, e: number, rec: number): Morpheme {
    const surface = text.slice(from + s, from + e);
    const known = rec < UNK;
    const line = known ? this.words.featureLine(rec) : this.unknown.featureLine(rec - UNK);
    const f = line.split(',');
    // Known: surface,pos,pos1,pos2,pos3,ctype,cform,base,reading,pron. Unknown: CLASS,pos,pos1,pos2,pos3,ctype,cform,base.
    // A surface with a comma in it (only "，" and "," entries) shifts the fields; those are symbols, handled below.
    const shift = known && f.length > 10 ? f.length - 10 : 0;
    const g = (k: number) => f[k + shift] ?? '*';
    return {
      start: from + s,
      end: from + e,
      surface,
      pos: g(1), pos1: g(2), pos2: g(3), pos3: g(4),
      ctype: g(5), cform: g(6),
      base: known ? g(7) : '*',
      reading: known && g(8) !== '*' ? g(8) : '',
      pron: known && g(9) !== '*' ? g(9) : '',
      known,
    };
  }
}
