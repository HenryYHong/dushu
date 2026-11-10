// The name model: a small learned scorer for the strings a book repeats that the detector's rules turn down (七斤, 老栓, 淑云,
// 周秉昆). Contract: ARCHITECTURE.md §4.9 (Detection v12).
//
// Detection (core/lexicon.ts modelNames) gathers a book's repeated strings that look like names, reads how each one stands in the
// text, and asks this model how sure it is that the string is a person or a place. The model is a softmax regression over the
// candidate's shape, its statistics in the book (how bound, how often, what stands before and after it) and character priors
// learned from the Wikidata name list (how often a character starts or fills a person's name, ends a place, or spells a foreign
// name). It is trained offline by scripts/train_name_model.py on running text (Wikipedia, public-domain books) where the list's
// names occur, and on hand-judged candidates. The file (data/name-model.tsv.gz) is fetched with the name list, only when a book's
// names are detected; without it, or with a file of another format or features version, the rules alone decide, as before.

import type { Dictionary } from '../types';
import { COMPOUND_SURNAMES, KIN_CHARS, SURNAMES, TRANSLIT_CHARS } from './names';

/** The file format this code reads (`# format`). */
export const NAME_MODEL_FORMAT = 1;
/** Bump with any change to nameFeatures: a model file of another version is not used. */
export const NAME_FEATURES_VERSION = 1;

/** The classes the model scores, in the file's column order. */
export const NAME_CLASSES = ['none', 'person', 'place'] as const;

export interface NameModel {
  readonly features: number;
  /** How sure the model must be (the class's probability) before detection takes a string: person, place, and a person of a
   * shape group of its own (shapeGroup: `-2` for two characters of no shape, `sur3`, `translit4` …). */
  readonly threshold: { person: number; place: number; shapes: ReadonlyMap<string, number> };
  /** Character priors as numbers (log-odds × 2, rounded): surname share, given-name, transliteration, end of a place. */
  readonly chars: ReadonlyMap<string, Int8Array>;
  /** Pairs that follow many surnames in running text but are hardly ever a given name (中丞, 监生, 大喜): a title or a phrase. */
  readonly tails: ReadonlySet<string>;
  /** Probabilities of none, person and place for a candidate's features. */
  score(features: readonly string[]): [number, number, number];
}

/** Columns of a character row: the prior used as `sur`, `giv`, `tra`, `pla`. */
const SUR = 0;
const GIV = 1;
const TRA = 2;
const PLA = 3;

/**
 * The model from the text of name-model.tsv(.gz). Comment lines start with "# "; `!key<TAB>value` rows are settings (features,
 * threshold:person, threshold:place, threshold:person:<shape group>, bias); `=c<TAB>sur<TAB>giv<TAB>tra<TAB>pla` rows are a character's priors; any other row is
 * `feature<TAB>w_none<TAB>w_person<TAB>w_place`; `~XY` rows are title tails. Null when the format or the features version is not
 * this code's.
 */
export function parseNameModel(text: string): NameModel | null {
  const fmt = /^# format (\d+)/m.exec(text.slice(0, 4000));
  if (!fmt || Number(fmt[1]) !== NAME_MODEL_FORMAT) return null;
  const weights = new Map<string, [number, number, number]>();
  const chars = new Map<string, Int8Array>();
  const tails = new Set<string>();
  let bias: [number, number, number] = [0, 0, 0];
  let features = -1;
  const threshold = { person: 0.9, place: 0.9, shapes: new Map<string, number>() };
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('# ')) continue;
    const cols = line.split('\t');
    if (line.startsWith('!')) {
      const key = cols[0].slice(1);
      if (key === 'features') features = Number(cols[1]);
      else if (key === 'threshold:person') threshold.person = Number(cols[1]);
      else if (key === 'threshold:place') threshold.place = Number(cols[1]);
      else if (key.startsWith('threshold:person:')) threshold.shapes.set(key.slice(17), Number(cols[1]));
      else if (key === 'bias') bias = [Number(cols[1]), Number(cols[2]), Number(cols[3])];
    } else if (line.startsWith('~')) {
      tails.add(line.slice(1));
    } else if (line.startsWith('=')) {
      const row = new Int8Array(4);
      for (let k = 0; k < 4; k++) row[k] = Number(cols[k + 1]) || 0;
      chars.set(cols[0].slice(1), row);
    } else if (cols.length === 4) {
      weights.set(cols[0], [Number(cols[1]), Number(cols[2]), Number(cols[3])]);
    }
  }
  if (features !== NAME_FEATURES_VERSION) return null;
  return {
    features,
    threshold,
    chars,
    tails,
    score(feats) {
      const z: [number, number, number] = [bias[0], bias[1], bias[2]];
      for (const f of feats) {
        const w = weights.get(f);
        if (w) { z[0] += w[0]; z[1] += w[1]; z[2] += w[2]; }
      }
      const top = Math.max(z[0], z[1], z[2]);
      const e = z.map((v) => Math.exp(v - top));
      const sum = e[0] + e[1] + e[2];
      return [e[0] / sum, e[1] / sum, e[2] / sum];
    },
  };
}

let cached: Promise<NameModel | null> | null = null;

/**
 * The model, fetched once per session (default data/name-model.tsv.gz next to the page); null when it cannot be had. A failure
 * is not kept: the next book tries again.
 */
export function loadNameModel(fetchText?: () => Promise<string>): Promise<NameModel | null> {
  cached ??= (async () => {
    const text = fetchText ? await fetchText() : await fetchModelText();
    return parseNameModel(text);
  })().then((m) => { if (!m) cached = null; return m; }, () => { cached = null; return null; });
  return cached;
}

async function fetchModelText(): Promise<string> {
  if (typeof document === 'undefined') throw new Error('no page to fetch the name model from');
  const { fetchDataText } = await import('./dataFetch');
  return fetchDataText(new URL('data/name-model.tsv.gz', document.baseURI).href);
}

// ------------------------------------------------------------- the site ---

/** Everything the model sees of one candidate (the detector's statistics, how it stands in the text, what it is made of). */
export interface NameSite {
  /** The string folded to simplified, one code point each. */
  simp: string[];
  count: number;
  bind: number;
  npmi: number;
  /** Entropy of the characters before and after it (nats; 9 for a bracket). */
  left: number;
  right: number;
  /** Shares of its uses (TermCandidate): followed by a verb of speech in either script, after a verb that takes a person, after
   * one that takes only a person, called out, after a numeral or a demonstrative, after a mark. */
  said: number;
  prep: number;
  pprep: number;
  voc: number;
  counted: number;
  open: number;
  known: 'none' | 'jieba' | 'entry';
  /** Made of dictionary words of two characters or more (波兰|饺子); holding a common word (计算). */
  covered: boolean;
  common: boolean;
  /** Corpus counts of its first two and its last two characters as words (dict.freq; 0 for a pair no list has). */
  headFreq: number;
  tailFreq: number;
  /** Its places outside the names already found. */
  free: number;
  /** Counts over those places (see NameStand). */
  stand: NameStand;
  /** Shares a first or last character with other candidates the book uses mostly in them (觉新, 觉民, 觉慧). */
  siblings: boolean;
  /** A form of a name found: a character of its given name with an honorific, or 老 小 阿 before it (础翁 beside 尔础). */
  derived: boolean;
}

/** How a candidate stands in the text, counted over its places outside the names found (core/lexicon.ts standOf). */
export interface NameStand {
  /** Places inside a name found, inside 《》 〈〉 〔〕 【】. */
  inside: number;
  titled: number;
  /** A mark or a line break before, after. */
  openL: number;
  openR: number;
  /** Followed by a verb a person does (说 道 笑 想 看 走 …), by a kinship character (七斤嫂), by 的, by 了 着 过, by a locative
   * (上 下 里 …), by 家. */
  says: number;
  kin: number;
  deAfter: number;
  partAfter: number;
  locAfter: number;
  jiaAfter: number;
  /** After 的, after 在 到 从 往 于 进 出. */
  deBefore: number;
  atPlace: number;
  /** The character before or after makes a common word or a dictionary name with its edge (大|水生, 水生|物, 吴主孙|权). */
  cut: number;
  /** The share of its places that the commonest character before, or after, takes. */
  topLeft: number;
  topRight: number;
  /** Places right after a character of a given name found (宝|二爷), and how many such characters come before it twice or more. */
  afterGiven: number;
  givenWho: number;
  /** Places right before an office a rank names (龙骧|将军, 平阳|亭侯): the string is that rank, not a person. */
  rankAfter: number;
}

/** A numeral, or 老 小 and a numeral, or a surname and a numeral, before an honorific or a kinship character (七大人, 八爷, 四婶). */
const HONOR = new Set(['大人', '太爷', '老爷', '奶奶', '太太', '少爷', '小姐', '相公', '官人', '先生', '大爷', '老太', '婆婆', '公公',
  ...'爷嫂婶叔伯姑姐妹哥弟公婆郎娘妈姨舅爹姊兄']);
const DIGITS = new Set([...'一二三四五六七八九十两']);
/** Endings of a place (core/lexicon.ts PLACE_SUFFIX and a shop's 坊 号 堂 斋 居). */
const PLACE_END = new Set([...'岛山庄寺城府村镇峰谷关江河湖海岭洞殿堡宫楼阁庙塔桥坡寨营州县国亭郡观湾沟屯坪园路街巷坊号堂斋居']);
/** Titles that follow a name (王先生, 张大人, 李老爷). */
const TITLE_TAILS = ['先生', '大人', '老爷', '太太', '小姐', '少爷', '公子', '夫人', '姑娘', '大爷', '奶奶', '相公', '官人', '娘子'];

/**
 * The shape of a candidate, from its characters alone: `numhon` 七大人 八爷 鄒七嫂, `numjin` 七斤, `surnum` 黄三, `laonum` 老五
 * 陈老五, `nick` 老栓 小栓 阿长, `title` 王先生, `kin` 附姐 (a name and a kinship character), `er` 孝儿, `zi` 祥子, `translit` 阿噶利马
 * 拉希姆, `place` 便宜坊 白马湖, `sur` 周秉昆 郑娟 (a surname and a given name), or '' for none of these.
 */
export function nameShape(simp: readonly string[]): string {
  const len = simp.length;
  const first = simp[0];
  const last = simp[len - 1];
  const numAt = DIGITS.has(first) && first !== '一' ? 0 : len >= 3 && SURNAMES.has(first) && DIGITS.has(simp[1]) && simp[1] !== '一' ? 1 : -1;
  if (numAt >= 0 && HONOR.has(simp.slice(numAt + 1).join(''))) return 'numhon';
  if (len === 2 && numAt === 0 && last === '斤') return 'numjin';
  if (len === 2 && SURNAMES.has(first) && DIGITS.has(last) && last !== '一') return 'surnum';
  const oldAt = len >= 3 && SURNAMES.has(first) ? 1 : 0;
  if (len === oldAt + 2 && (simp[oldAt] === '老' || simp[oldAt] === '小') && DIGITS.has(last) && last !== '一') return 'laonum';
  if (len === 2 && (first === '老' || first === '小' || first === '阿')) return 'nick';
  if (len >= 3 && TITLE_TAILS.some((t) => simp.slice(-t.length).join('') === t)) return 'title';
  if (len >= 3 && simp.every((ch, i) => TRANSLIT_CHARS.has(ch) || (i === len - 1 && ch === '儿'))) return 'translit';
  if (len >= 3 && PLACE_END.has(last)) return 'place';
  if (last === '儿' && len === 2) return 'er';
  if (last === '子' && len <= 3) return 'zi';
  if (len === 2 && KIN_CHARS.has(last)) return 'kin';
  if (len >= 3 && COMPOUND_SURNAMES.has(first + simp[1])) return 'sur';
  if (len <= 3 && SURNAMES.has(first)) return 'sur';
  if (len === 2 && simp.every((ch) => TRANSLIT_CHARS.has(ch))) return 'translit';
  return '';
}

/** The group a shape's threshold is set for: the shape, with its length for a surname-led name, a foreign one or one of no shape. */
export function shapeGroup(simp: readonly string[]): string {
  const shape = nameShape(simp);
  const len = Math.min(simp.length, 4);
  return shape === '' ? `-${len}` : shape === 'sur' || shape === 'translit' ? `${shape}${len}` : shape;
}

/** How sure the model must be before detection takes `simp` as a person. */
export function personThreshold(model: NameModel, simp: readonly string[]): number {
  return model.threshold.shapes.get(shapeGroup(simp)) ?? model.threshold.person;
}

/** Index of a value among ascending cut points (0 below the first). */
function bin(x: number, cuts: readonly number[]): number {
  let k = 0;
  while (k < cuts.length && x >= cuts[k]) k++;
  return k;
}

const SHARE = [0.001, 0.03, 0.08, 0.15, 0.3, 0.5, 0.75];
const NPMI = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95];
const BIND = [0.3, 0.5, 0.7, 0.85, 0.95];
const SIDE = [0.5, 1, 1.5, 2, 2.5, 3, 4, 8.5];
/** Cut points of a corpus count. */
const WORD_FREQ = [1, 100, 1000, 10000];
/** Cut points of a prior (log-odds × 2). */
const PRIOR = [-8, -4, -2, 0, 2, 4, 6, 8];

/**
 * The model's features for a candidate, as strings (`key:bin`). `chars` are the model's character priors, `tails` its title tails.
 * Bump NAME_FEATURES_VERSION with any change here.
 */
export function nameFeatures(s: NameSite, chars: ReadonlyMap<string, Int8Array>, tails: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  const len = s.simp.length;
  const shape = nameShape(s.simp);
  const f = Math.max(1, s.free);
  const st = s.stand;
  out.push(`len:${Math.min(len, 5)}`, `known:${s.known}`, `sh:${shape}`, `sh:${shape}|${Math.min(len, 4)}`);
  out.push(`cnt:${Math.min(10, Math.floor(Math.log2(Math.max(1, s.free))))}`);
  out.push(`npmi:${bin(s.npmi, NPMI)}`, `bind:${bin(s.bind, BIND)}`, `le:${bin(s.left, SIDE)}`, `re:${bin(s.right, SIDE)}`);
  const shares: [string, number][] = [
    ['sp', s.said], ['pp', s.prep], ['po', s.pprep], ['vo', s.voc], ['nu', s.counted], ['op', s.open],
    ['oL', st.openL / f], ['oR', st.openR / f], ['sa', st.says / f], ['ki', st.kin / f], ['dA', st.deAfter / f],
    ['pa', st.partAfter / f], ['lo', st.locAfter / f], ['ja', st.jiaAfter / f], ['dB', st.deBefore / f], ['at', st.atPlace / f],
    ['cu', st.cut / f], ['in', st.inside / Math.max(1, s.count)], ['ti', st.titled / f], ['tL', st.topLeft], ['tR', st.topRight],
  ];
  for (const [k, v] of shares) out.push(`${k}:${bin(v, SHARE)}`);
  // A person: speaks or is called out, and opens clauses (the strongest pair of signs, together).
  out.push(`act:${Math.min(2, bin(s.said + s.voc, [0.03, 0.15]))}${Math.min(2, bin(st.openL / f, [0.15, 0.4]))}`);
  if (len >= 3) out.push(`h2:${bin(s.headFreq, WORD_FREQ)}`, `t2:${bin(s.tailFreq, WORD_FREQ)}`, `t2|${shape}:${bin(s.tailFreq, WORD_FREQ)}`);
  // (郡丞, 真君: a title alone.)
  if (len === 2 && tails.has(s.simp.join(''))) out.push('tt');
  if (s.covered) out.push('cov');
  if (s.common) out.push('com');
  if (s.siblings) out.push('sib');
  if (s.derived) out.push('der');
  // Character priors: the surname (one character or two), the given name's characters, a foreign name's, a place's ending.
  const pri = (ch: string, k: number): number => chars.get(ch)?.[k] ?? -12;
  const compound = len >= 3 && COMPOUND_SURNAMES.has(s.simp[0] + s.simp[1]);
  const surLen = compound ? 2 : SURNAMES.has(s.simp[0]) && len <= 4 ? 1 : 0;
  out.push(surLen === 2 ? 'sur:c' : surLen === 1 ? `sur:${bin(pri(s.simp[0], SUR), PRIOR)}` : 'sur:-');
  const given = s.simp.slice(surLen);
  if (given.length) {
    const lo = given.map((ch) => pri(ch, GIV));
    out.push(`gm:${bin(lo.reduce((a, b) => a + b, 0) / lo.length, PRIOR)}`, `gn:${bin(Math.min(...lo), PRIOR)}`);
    if (surLen) out.push(`sg:${bin(lo.reduce((a, b) => a + b, 0) / lo.length, PRIOR)}`);
  }
  const tra = s.simp.map((ch) => pri(ch, TRA));
  out.push(`tra:${bin(tra.reduce((a, b) => a + b, 0) / len, PRIOR)}`, `pe:${bin(pri(s.simp[len - 1], PLA), PRIOR)}`);
  return out;
}

// ------------------------------------------------------------- standing ---

/** After one of these, a string is somewhere, not someone (在窗口, 到村口, 从城里). */
const AT_PLACE = new Set([...'在到从往于於进出']);
/** What a person does right after their name: speak, or think, look, listen, go. */
const SAYS = new Set([...'说道笑叫问答喊哭骂叹怒喝嚷应曰想看听走跑站坐']);
const LOCATIVE = new Set([...'上下里中内外边旁前后']);
const TITLE_OPEN = new Set([...'《〈〔【']);
/** Offices that a rank stands right before (龙骧将军, 散骑常侍, 平阳亭侯), simplified. */
const RANKED_OFFICE = /^(将军|校尉|都尉|中郎将|常侍|亭侯|乡侯|县侯|太守|刺史|都督|大夫)/;
const RANK_HEAD = new Set([...'将校都中常亭乡县太刺大']);
/** Characters that may stand beside a name most of the time without making it a piece of something longer. */
const FREE_SIDE = new Set([...'的了着过是在和与就也都把被我你他她它们这个不很又还而但却才并将已正之所便曰', ...SAYS]);

const isHan = (c: number): boolean => (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff);

/**
 * How each of `words` (as the text spells them) stands in `text`: one pass, trying a word only where its first two units are.
 * `holders` gives the names found that hold a word (洪七 inside 洪七公); a place inside one of them counts as `inside` and nothing
 * else. `due` says when to yield. `givenChars` are the characters of the given names found (for `afterGiven`, `givenWho`).
 */
export function* standOf(text: string, words: Iterable<string>, dict: Dictionary, holders: ReadonlyMap<string, readonly string[]>, due: () => boolean,
  givenChars: ReadonlySet<string> = new Set()): Generator<void, Map<string, NameStand>, void> {
  const out = new Map<string, NameStand>();
  const lefts = new Map<string, Map<string, number>>();
  const rights = new Map<string, Map<string, number>>();
  const starts = new Set<number>();
  const firsts = new Uint8Array(65536);
  const lens = new Set<number>();
  for (const w of words) {
    if (w.length < 2) continue;
    out.set(w, { inside: 0, titled: 0, openL: 0, openR: 0, says: 0, kin: 0, deAfter: 0, partAfter: 0, locAfter: 0, jiaAfter: 0, deBefore: 0, atPlace: 0, cut: 0, topLeft: 0, topRight: 0, afterGiven: 0, givenWho: 0, rankAfter: 0 });
    lefts.set(w, new Map());
    rights.set(w, new Map());
    starts.add(w.charCodeAt(0) * 65536 + w.charCodeAt(1));
    firsts[w.charCodeAt(0)] = 1;
    lens.add(w.length);
  }
  const lenList = [...lens];
  const fold = new Map<string, string>();
  const folded = (ch: string): string => { let f = fold.get(ch); if (f === undefined) fold.set(ch, (f = dict.toSimplified(ch))); return f; };
  // A pair across an edge that is a common word (大|水生, 水生|物) or a name the dictionary has (吴主孙|权: 孙权), and four
  // characters around a pair that are a dictionary word (an idiom).
  const cutCache = new Map<string, boolean>();
  const cuts = (pair: string): boolean => {
    let v = cutCache.get(pair);
    if (v === undefined) {
      v = dict.freq(pair) >= 300 || dict.lookup(pair).some((e) => /^[A-Z]/.test(e.pinyin) && !/^(surname|variant|old variant)\b/i.test(e.defs[0] ?? ''));
      cutCache.set(pair, v);
    }
    return v;
  };
  const idioms = new Map<string, boolean>();
  const inIdiom = (four: string): boolean => {
    let v = idioms.get(four);
    if (v === undefined) idioms.set(four, (v = dict.hasWord(four) || dict.hasWord(dict.toSimplified(four))));
    return v;
  };
  const n = text.length;
  for (let i = 0; i + 1 < n; i++) {
    if ((i & 0x7fff) === 0x7fff && due()) yield;
    const c0 = text.charCodeAt(i);
    if (!firsts[c0] || !starts.has(c0 * 65536 + text.charCodeAt(i + 1))) continue;
    for (const L of lenList) {
      if (i + L > n) continue;
      const w = text.substr(i, L);
      const s = out.get(w);
      if (!s) continue;
      const hold = holders.get(w);
      if (hold?.some((h) => { const k = h.indexOf(w); return i >= k && text.startsWith(h, i - k); })) { s.inside++; continue; }
      const p = i > 0 ? text[i - 1] : '\n';
      const q = i + L < n ? text[i + L] : '\n';
      const pHan = isHan(p.charCodeAt(0));
      const qHan = isHan(q.charCodeAt(0));
      if (!pHan) s.openL++;
      if (!qHan) s.openR++;
      if (TITLE_OPEN.has(p)) s.titled++;
      const ps = pHan ? folded(p) : '';
      const qs = qHan ? folded(q) : '';
      if (ps) { const m = lefts.get(w)!; m.set(ps, (m.get(ps) ?? 0) + 1); }
      if (qs) { const m = rights.get(w)!; m.set(qs, (m.get(qs) ?? 0) + 1); }
      if (SAYS.has(qs)) s.says++;
      if (KIN_CHARS.has(qs)) s.kin++;
      if (qs === '的') s.deAfter++;
      if (qs === '了' || qs === '着' || qs === '过') s.partAfter++;
      if (LOCATIVE.has(qs)) s.locAfter++;
      if (qs === '家') s.jiaAfter++;
      if (ps === '的') s.deBefore++;
      if (AT_PLACE.has(ps)) s.atPlace++;
      if (RANK_HEAD.has(qs) && RANKED_OFFICE.test(dict.toSimplified(text.substr(i + L, 3)))) s.rankAfter++;
      const a = folded(w[0]);
      const b = folded(w[L - 1]);
      // (龙骧|虎步: a pair inside an idiom the dictionary has.)
      if ((ps && cuts(ps + a)) || (qs && cuts(b + qs))
        || (L === 2 && ((qHan && i + 4 <= n && isHan(text.charCodeAt(i + 3)) && inIdiom(text.substr(i, 4)))
          || (pHan && i >= 2 && isHan(text.charCodeAt(i - 2)) && inIdiom(text.substr(i - 2, 4)))))) s.cut++;
    }
  }
  // (段小楼's 小楼, 阿妮塔's 阿妮: the same character before it, or after it, most of the time, unless that character is a
  // function word or what a person does.)
  for (const [w, s] of out) {
    let free = s.openL;
    for (const v of lefts.get(w)!.values()) free += v;
    free = Math.max(1, free);
    let top = 0;
    for (const [ch, v] of lefts.get(w)!) {
      if (!FREE_SIDE.has(ch)) top = Math.max(top, v);
      if (givenChars.has(ch)) { s.afterGiven += v; if (v >= 2) s.givenWho++; }
    }
    s.topLeft = top / free;
    top = 0;
    for (const [ch, v] of rights.get(w)!) if (!FREE_SIDE.has(ch)) top = Math.max(top, v);
    s.topRight = top / free;
  }
  return out;
}
