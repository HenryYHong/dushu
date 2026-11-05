// The build step of scripts/build-gazetteer.mjs (run inside Vitest by that launcher, so it uses the app's own dictionary;
// options arrive as JSON in ZH_EVAL_ARGS): the Wikidata answers in <raw> become public/data/names.tsv.gz. Prints counts only.
//
// Kept: a label or alias (zh, zh-hans, zh-hant, zh-cn, zh-tw) of an item with a zh.wikipedia article that is a person, a place,
// an organization or one of a few other kinds (a dynasty, a people, a war, a battle, a period), written in 2 to 7 Han characters
// of the Basic Multilingual Plane, folded to simplified one character at a time (the way detection folds a book's text). Left out:
// - a name the dictionary has as a word (CC-CEDICT, Wiktionary, jieba's counts): the segmenter joins it already, and a common
//   word (社群, 清华 "pure") must never become a name because a list has it;
// - a name that opens or closes with a particle or a pronoun, or holds 的 了 着 过 (a phrase, not a name), or opens with 字 or 号
//   (字子桓: a courtesy name with the word that introduces it);
// - two characters that open with a numeral (一中, 三和: a school's nickname, and a count in running text), a numeral and a
//   measure word anywhere (一粒米, 三杯酒, 上一站), one character three times (哒哒哒);
// - four characters or more made of dictionary words end to end (北京市|第一|中学, 天天|向上): the segmenter cuts them into words
//   a reader can look up already, and as a phrase such a string is more often not the name.
// Also left out: an organization, a place or anything else whose English label is lower case (a concept: animism, urban
// planning); a courtesy or art name (an alias) of a person with fewer than 3 sitelinks; and in two characters, anything with
// fewer than 3 sitelinks, a person's alias, and a place's alias unless the place has 10 or more.
// Each name gets the kind of its best-known item (most sitelinks). Readings are not stored: Wikidata has almost none for Chinese
// names (P1721 is on 11 items), and the app's name rules read a listed name (core/lexicon.ts pinyinOf, surname readings).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { it } from 'vitest';
import { GAZETTEER_FORMAT } from '../src/core/gazetteer';
import { covered } from '../src/core/lexicon';
import { loadEvalDictionary } from './eval/zh-shown';

interface Args { raw: string; out: string }

type Kind = 'p' | 'l' | 'o' | 't';
const KIND_OF_GROUP: Record<string, Kind> = { person: 'p', place: 'l', org: 'o', other: 't', sky: 't' };
/** When one item is in classes of two kinds: a person first, then a place (a municipality is an organization too), then the rest. */
const RANK: Record<Kind, number> = { p: 0, l: 1, o: 2, t: 3 };

const isHan = (c: number): boolean => (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff);
/** Never at the edge of a name: particles, pronouns, the commonest adverbs and conjunctions (core/lexicon.ts EDGE_STOP). */
const EDGE = new Set([...'的了着过是在和与就也都把被我你他她它们这那个不很又还而但却才并将已正']);
/**
 * The longest name kept. Eight characters would do, but `node scripts/check-public.mjs --source` refuses any run of eight Han
 * characters that one of the owner's private books also has, and a long name in the list can be one; seven never is.
 */
const MAX_CHARS = 7;
const NUMERAL = new Set([...'零〇一二三四五六七八九十百千万两几']);
/** Measure words after a numeral (not 里: 三里屯, 十里铺 are places). */
const COUNTED = new Set([...'个只件条张把顶本头匹位口座片块根枝支双对句声眼次回遍番场阵粒杯盏碗瓶毛角元块站层届期级岁年天夜步尺丈寸亩斤']);

it('builds the name list', async () => {
  const a = JSON.parse(process.env.ZH_EVAL_ARGS ?? '{}') as Args;
  const dict = await loadEvalDictionary();
  const files = readdirSync(a.raw);

  // ---- the kind of every item
  const kindOf = new Map<number, Kind>();
  const sky = new Set<number>();
  for (const f of files) {
    const m = /^class-(\w+)-\w+\.tsv$/.exec(f);
    if (!m) continue;
    const k = KIND_OF_GROUP[m[1]];
    for (const line of readFileSync(join(a.raw, f), 'utf8').split('\n')) {
      const q = Number(line);
      if (!q) continue;
      if (m[1] === 'sky') { sky.add(q); continue; }
      const was = kindOf.get(q);
      if (!was || RANK[k] < RANK[was]) kindOf.set(q, k);
    }
  }
  // A star or a constellation is "other" whatever else the class tree says (not a place).
  for (const q of sky) if (kindOf.has(q) && kindOf.get(q) !== 'p') kindOf.set(q, 't');

  // ---- every name of those items, folded one character at a time
  const foldChar = new Map<string, string>();
  const fold = (s: string): string => {
    let out = '';
    for (const ch of s) {
      let v = foldChar.get(ch);
      if (v === undefined) { v = dict.toSimplified(ch); if ([...v].length !== 1) v = ch; foldChar.set(ch, v); }
      out += v;
    }
    return out;
  };
  // Items whose English label is lower case are concepts the class tree files under organizations or places (animism, urban
  // planning, desinicization): not names. People are named whatever their English label says.
  const concept = new Set<number>();
  for (const f of files) {
    if (!/^en-\d+\.tsv$/.test(f)) continue;
    for (const line of readFileSync(join(a.raw, f), 'utf8').split('\n')) if (line.endsWith('\tl')) concept.add(Number(line.slice(0, line.indexOf('\t'))));
  }
  /** Per name: the sitelinks of its best-known item, and that item's kind. */
  const names = new Map<string, { sl: number; kind: Kind }>();
  const skipped = { concept: 0, obscureAlias: 0, short: 0 };
  let rows = 0;
  for (const f of files) {
    const m = /^(label|alias)-[\w-]+\.\d+\.tsv$/.exec(f);
    if (!m) continue;
    const alias = m[1] === 'alias';
    for (const line of readFileSync(join(a.raw, f), 'utf8').split('\n')) {
      if (!line) continue;
      const [q, sl, label] = line.split('\t');
      const kind = kindOf.get(Number(q));
      if (!kind || !label) continue;
      rows++;
      const n = Number(sl) || 0;
      if (kind !== 'p' && concept.has(Number(q))) { skipped.concept++; continue; }
      // (A courtesy or art name of someone hardly known, 冲霄 悦之 逊一, is more often two ordinary words.)
      if (kind === 'p' && alias && n < 3) { skipped.obscureAlias++; continue; }
      const name = fold(label);
      // Two characters are a name only for someone or somewhere known (sitelinks in three languages or more), and a person only by
      // a label (韩干 for 韓幹; not 广厦, a courtesy name); an old name of a place (阳羡, 申江) only for a well-known place.
      if (name.length === 2 && (n < 3 || (alias && (kind === 'p' || n < 10)))) { skipped.short++; continue; }
      const was = names.get(name);
      if (!was) names.set(name, { sl: n, kind });
      else if (n > was.sl) { was.sl = n; was.kind = kind; }
    }
  }

  // ---- what the reader gains from
  const drop = { units: 0, known: 0, edge: 0, numeral: 0, words: 0 };
  const kept: [string, Kind][] = [];
  for (const [name, v] of names) {
    if (name.length < 2 || name.length > MAX_CHARS || ![...name].every((ch) => ch.length === 1 && isHan(ch.charCodeAt(0)))) { drop.units++; continue; }
    const phrase = dict.toSimplified(name);
    if (dict.hasWord(name) || dict.hasWord(phrase) || dict.freq(name) > 0 || dict.freq(phrase) > 0) { drop.known++; continue; }
    if (EDGE.has(name[0]) || EDGE.has(name[name.length - 1]) || /[的了着过]/.test(name.slice(1, -1)) || /^[字号]/.test(name)) { drop.edge++; continue; }
    if (name.length === 2 && NUMERAL.has(name[0])) { drop.numeral++; continue; }
    // (一粒米, 三杯酒, 上一站, 九毛九: a count of something; 哒哒哒: a sound.)
    if ([...name].some((ch, i) => NUMERAL.has(ch) && COUNTED.has(name[i + 1] ?? '')) || [...name].every((ch) => ch === name[0])) { drop.numeral++; continue; }
    if (name.length >= 4 && covered([...name], dict)) { drop.words++; continue; }
    kept.push([name, v.kind]);
  }
  kept.sort((x, y) => RANK[x[1]] - RANK[y[1]] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

  const byKind: Record<Kind, number> = { p: 0, l: 0, o: 0, t: 0 };
  const byLen = new Map<number, number>();
  for (const [name, k] of kept) { byKind[k]++; byLen.set(name.length, (byLen.get(name.length) ?? 0) + 1); }
  const header = [
    '# Dushu name list: people, places and organizations with an article on the Chinese Wikipedia, and their other names.',
    '# Source: Wikidata (https://www.wikidata.org), CC0 1.0: labels and aliases in zh, zh-hans, zh-hant, zh-cn and zh-tw,',
    '# folded to simplified one character at a time. Built by scripts/build-gazetteer.mjs; names the dictionary has are left out.',
    `# format ${GAZETTEER_FORMAT}`,
    '# columns: name, kind (p person, l place, o organization, t other)',
    `# built ${new Date().toISOString().slice(0, 10)}, ${kept.length} names`,
  ];
  const text = header.join('\n') + '\n' + kept.map(([n, k]) => `${n}\t${k}`).join('\n') + '\n';
  const gz = gzipSync(Buffer.from(text, 'utf8'), { level: 9 });
  writeFileSync(a.out, gz);
  console.log(`items with a kind: ${kindOf.size}; label rows of those items: ${rows}; distinct names: ${names.size}`);
  console.log(`rows skipped: ${JSON.stringify(skipped)}; names left out: ${JSON.stringify(drop)}`);
  console.log(`kept ${kept.length}: ${JSON.stringify(byKind)}; by length ${JSON.stringify(Object.fromEntries([...byLen].sort((x, y) => x[0] - y[0])))}`);
  console.log(`names.tsv: ${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB, gzipped ${(gz.length / 1e6).toFixed(2)} MB`);
});
