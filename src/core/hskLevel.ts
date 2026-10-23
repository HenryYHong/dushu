// The HSK level at which a reader can read a word aloud: what the HSK pinyin mode compares with its threshold.
import type { Dictionary } from '../types';

/** Level of a word, given its reading in context (numbered pinyin per code point) when there is one. */
export type HskLevelOf = (word: string, pinyin?: string[]) => number | undefined;

const cache = new WeakMap<Dictionary, HskLevelOf>();

/**
 * Pinyin is there to say a word, so a word takes the level of its hardest character, read the way it is read here (说道 7 on the
 * list, but 说 and 道 are both HSK 1 in these readings, so 1). A character's level is the lowest level of the listed words it is read
 * the same way in (石 shí from 石头 at 3, 时 shí from 时间 at 1), so a reading only one word has comes at that word's level (银行 háng).
 * A listed word read with a neutral tone keeps its list level: which syllable goes neutral is the word's, not its characters'
 * (本事 běnshi). When a character has no level, a listed word falls back on its list level, so nothing shows more pinyin than the
 * list alone, and a word the list leaves out keeps its pinyin (闰土: no listed word has 闰). A traditional spelling looks up its
 * simplified form; levels run 1-6, and 7 for 7-9.
 */
export function hskLevels(dict: Dictionary): HskLevelOf {
  let fn = cache.get(dict);
  if (!fn) { fn = build(dict); cache.set(dict, fn); }
  return fn;
}

function build(dict: Dictionary): HskLevelOf {
  let chars: Map<string, { syl: string; level: number }[]> | null = null;
  const memo = new Map<string, number | undefined>();
  const others = new Map<string, string[]>();

  /**
   * Each listed word's characters, with the syllable each is read with there. The list names a word, not a reading, so where the
   * dictionary spells two words with the same characters it means the usual one, the word's default reading: 便宜 piányi teaches
   * nothing of 宜 yí (biànyí), 喝 hē nothing of 喝 hè. A bare character keeps its neutral readings too (地 de, 得 de): the particle is
   * what the list grades; its other readings come with the words that use them (骑 jì, "(Tw)" in CEDICT, with none). Surname and
   * place readings count only when a word has no other.
   */
  const index = () => {
    if (chars) return chars;
    const map = new Map<string, { syl: string; level: number }[]>();
    for (const word of dict.hskWords(7)) {
      const level = dict.hsk(word)?.hsk3;
      if (!level) continue;
      const cps = [...word];
      const entries = dict.lookup(word).filter((e) => e.simp === word && e.pinyin.split(' ').length === cps.length);
      const common = entries.filter((e) => !/^[A-Z]/.test(e.pinyin));
      let readings = [...new Set((common.length ? common : entries).map((e) => e.pinyin.toLowerCase()))];
      if (readings.length > 1) {
        const usual = dict.pinyinFor(word).join(' ');
        if (readings.includes(usual)) readings = readings.filter((r) => r === usual || (cps.length === 1 && r.endsWith('5')));
      }
      for (const r of readings) {
        r.split(' ').forEach((syl, k) => {
          let list = map.get(cps[k]);
          if (!list) map.set(cps[k], (list = []));
          const seen = list.find((x) => x.syl === syl);
          if (!seen) list.push({ syl, level });
          else if (level < seen.level) seen.level = level;
        });
      }
    }
    return (chars = map);
  };

  /**
   * Other spellings of a character that a reader of the listed one reads at sight: its simplified forms (著 → 着, which t2s leaves
   * alone because 著 is also a simplified character), and its glyph variants with no reading of their own (偸 偷, 値 值, 緖 绪):
   * the same radical, within a stroke of the same count. 沈 shěn is a character of its own, so it is not 沉.
   */
  const othersOf = (ch: string): string[] => {
    let out = others.get(ch);
    if (out) return out;
    const info = dict.char(ch);
    const set = new Set<string>();
    for (const s of info?.simplified ?? []) set.add(dict.toSimplified(s));
    for (const v of info?.variants ?? []) {
      const w = dict.char(v);
      const r = info!.radical, rv = w?.radical;
      if (!r || !rv || rv.num !== r.num || Math.abs(rv.residual - r.residual) > 1) continue;
      if (info!.readings.every((x) => w!.readings.includes(x))) set.add(dict.toSimplified(v));
    }
    set.delete(ch);
    others.set(ch, (out = [...set]));
    return out;
  };

  const ownLevel = (ch: string, syl: string | undefined): number | undefined => {
    let best: number | undefined;
    for (const x of index().get(ch) ?? []) {
      if (syl !== undefined && !readsAs(x.syl, syl)) continue;
      if (best === undefined || x.level < best) best = x.level;
    }
    return best;
  };

  const charLevel = (ch: string, syl: string | undefined): number | undefined => {
    let best = ownLevel(ch, syl);
    if (best !== undefined) return best;
    for (const o of othersOf(ch)) {
      const l = ownLevel(o, syl);
      if (l !== undefined && (best === undefined || l < best)) best = l;
    }
    return best;
  };

  const compute = (word: string, pinyin?: string[]): number | undefined => {
    const listed = dict.hsk(word)?.hsk3;
    const simp = dict.toSimplified(word);
    const cps = [...simp];
    if (listed && cps.length > 1 && (!pinyin || pinyin.some((p) => !/[1-4]$/.test(p)))) return listed;
    if (cps.length !== [...word].length || (pinyin && pinyin.length !== cps.length) || pinyin?.some((p) => !p)) return listed;
    let level = 0;
    for (let k = 0; k < cps.length; k++) {
      const l = charLevel(cps[k], pinyin?.[k]);
      if (l === undefined) {
        // t2s folds some characters into one that never reads that way (乾 qián → 干, 閤 gé → 合): 干's level says nothing of 乾 qián.
        const merged = cps.length === 1 && simp !== word && pinyin && !dict.lookup(simp).some((e) => e.simp === simp && readsAs(e.pinyin, pinyin[0]));
        return merged ? undefined : listed;
      }
      level = Math.max(level, l);
    }
    return listed ? Math.min(listed, level) : level || undefined;
  };

  return (word, pinyin) => {
    const key = pinyin ? `${word} ${pinyin.join(' ')}` : word;
    if (memo.has(key)) return memo.get(key);
    const level = compute(word, pinyin);
    memo.set(key, level);
    return level;
  };
}

/**
 * Does knowing a character as `learned` let a reader say it as `heard`? Same syllable and tone, or `heard` is neutral (西 xi1 read
 * xi5 in 东西). A character learned only in its neutral tone does not teach its full tone: 友 you5 in 朋友 says nothing of 友好 yǒu.
 */
function readsAs(learned: string, heard: string): boolean {
  const a = /^(.*?)([1-5]?)$/.exec(learned.toLowerCase())!;
  const b = /^(.*?)([1-5]?)$/.exec(heard.toLowerCase())!;
  if (a[1] !== b[1]) return false;
  const ta = a[2] || '5', tb = b[2] || '5';
  return ta === tb || tb === '5';
}
