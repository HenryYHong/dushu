// From IPADIC morphemes to the words a learner taps. IPADIC cuts 食べさせられた into 食べ|させ|られ|た; a learner looks up
// 食べる, so a verb or adjective takes its auxiliaries and endings into one word, and the endings become a description of the
// form ("causative-passive past"). The rules:
//   - A verb or adjective keeps everything that only inflects it: た/だ, ない/ぬ/ん/ず, ます, たい, う/よう, まい, べき, the voice
//     suffixes れる/られる/せる/させる, the conjunctive て/で, ば, たり, and そう (looks like).
//   - て/で + いる/ある/おく/しまう (and their contractions てる, ちゃう, とく) stay in the word: 読んでいる is one word, the
//     progressive of 読む. Other verbs after て (くる, いく, みる, くれる, あげる, もらう) are words of their own, because each has
//     a meaning of its own to look up.
//   - A する-noun and the する after it are one word (勉強した, lemma 勉強する).
//   - A number and its counter are one word (三本 さんぼん); a surname and the given name after it are one name.
//   - Nouns, prefixes and suffixes side by side become one word when JMdict has the whole (子供たち, 一日中, 支那).
//   - Particles, the copula after a noun (静か|な, 学生|だった) and honorific suffixes (太郎|さん) are their own words.
import type { Morpheme } from './ipadic';
import { isKanaCode, toHiragana } from './kana';
import { approximateParts, counterBase, counterReading, isNumeralText, numberParts, numeralValue } from './numbers';

/** A word assembled from morphemes. */
export interface Word {
  start: number;
  end: number;
  text: string;
  morphemes: Morpheme[];
  /** Dictionary form (食べる for 食べさせられた). */
  lemma: string;
  /** Hiragana reading of the word as written; '' when unknown. */
  reading: string;
  /** Hiragana reading of the lemma, when it can be told ('' otherwise). */
  lemmaReading: string;
  /** Furigana units: the reading of each piece is aligned on its own (a morpheme each, or the whole word). */
  pieces: { text: string; reading: string }[];
  /** What the endings do, in order ("causative", "passive", "past"). */
  forms: string[];
  /** The word's class for matching dictionary entries. */
  cls: WordClass;
  /** IPADIC conjugation type of the head (一段, 五段・カ行イ音便, サ変・スル …). */
  ctype: string;
  /** A proper noun: what kind (IPADIC 固有名詞 subclasses). */
  name?: 'surname' | 'given' | 'person' | 'place' | 'org' | 'proper';
  /** True when the word has no IPADIC analysis of its own (an unknown-word guess). */
  unknown: boolean;
  /** Joined from several IPADIC words because JMdict lists the whole; its reading may need JMdict's (rendaku). */
  compound?: boolean;
}

export type WordClass = 'verb' | 'adj' | 'noun' | 'adjna' | 'pronoun' | 'adverb' | 'particle' | 'conj' | 'interj' | 'prenoun' | 'aux' | 'prefix' | 'suffix' | 'counter' | 'number' | 'symbol' | 'other';

export interface WordContext {
  /** True when JMdict has this exact form (for joining nouns into compounds). */
  has(form: string): boolean;
}

const hira = (s: string) => toHiragana(s);

function classOf(m: Morpheme): WordClass {
  switch (m.pos) {
    case '動詞': return 'verb';
    case '形容詞': return 'adj';
    case '副詞': return 'adverb';
    case '助詞': return 'particle';
    case '接続詞': return 'conj';
    case '感動詞': case 'フィラー': return 'interj';
    case '連体詞': return 'prenoun';
    case '助動詞': return 'aux';
    case '接頭詞': return 'prefix';
    case '記号': return 'symbol';
    case '名詞':
      if (m.pos1 === '代名詞') return 'pronoun';
      if (m.pos1 === '形容動詞語幹') return 'adjna';
      if (m.pos1 === '数') return 'number';
      if (m.pos1 === '接尾') return m.pos2 === '助数詞' ? 'counter' : 'suffix';
      return 'noun';
    default: return 'other';
  }
}

function nameKind(m: Morpheme): Word['name'] {
  if (m.pos !== '名詞' || m.pos1 !== '固有名詞') return undefined;
  if (m.pos2 === '人名') return m.pos3 === '姓' ? 'surname' : m.pos3 === '名' ? 'given' : 'person';
  if (m.pos2 === '地域') return 'place';
  if (m.pos2 === '組織') return 'org';
  return 'proper';
}

/**
 * Readings where IPADIC's choice is the less usual one: 日本 is にほん more often than にっぽん, and 言う/云う is spelled いう
 * (IPADIC reads 云っ as ゆっ).
 */
function preferredReading(m: Morpheme): string {
  const r = hira(m.reading);
  if (m.surface === '日本' && r === 'にっぽん') return 'にほん';
  if ((m.base === '言う' || m.base === '云う' || m.base === '謂う') && r.startsWith('ゆ')) return 'い' + r.slice(1);
  return r;
}

/** The reading of a morpheme in hiragana: IPADIC's, or the kana itself for an unknown word written in kana. */
function readingOf(m: Morpheme): string {
  if (m.reading) return preferredReading(m);
  for (let i = 0; i < m.surface.length; i++) if (!isKanaCode(m.surface.charCodeAt(i))) return '';
  return hira(m.surface);
}

/** Te-form constructions that stay inside the verb's word, by the base form of the verb after て/で. */
const AFTER_TE: Record<string, string> = {
  いる: 'progressive (te iru)', ある: 'resultative (te aru)', おく: 'in advance (te oku)', 置く: 'in advance (te oku)',
  しまう: 'completed (te shimau)', 仕舞う: 'completed (te shimau)', 居る: 'progressive (te iru)', 在る: 'resultative (te aru)',
};
/** Contracted constructions IPADIC files as their own verbs right after the stem: 食べてる, 食べちゃう, 読んどく. */
const CONTRACTED: Record<string, string> = {
  てる: 'progressive (te iru)', でる: 'progressive (te iru)', ちゃう: 'completed (te shimau)', じゃう: 'completed (te shimau)',
  ちまう: 'completed (te shimau)', じまう: 'completed (te shimau)', とく: 'in advance (te oku)', どく: 'in advance (te oku)',
  とる: 'progressive (te oru)', どる: 'progressive (te oru)',
};
/** Verbs and adjectives IPADIC files as non-independent that only add an ending meaning to the stem before them. */
const AFTER_STEM: Record<string, string> = {
  なさる: 'polite command (nasai)', すぎる: 'too much (sugiru)', 過ぎる: 'too much (sugiru)',
  やすい: 'easy to (yasui)', 易い: 'easy to (yasui)', にくい: 'hard to (nikui)', 難い: 'hard to (nikui)', づらい: 'hard to (zurai)', 辛い: 'hard to (zurai)',
  がたい: 'hard to (gatai)',
};

interface Builder {
  ms: Morpheme[];
  forms: string[];
  /** The last morpheme taken was the conjunctive て/で (a construction verb may follow). */
  afterTe: boolean;
  head: Morpheme;
  /** Voice so far, to tell causative-passive from passive. */
  causative: boolean;
}

/** Labels for an auxiliary taken into the word, or null when it does not belong to the word. */
function auxLabel(b: Builder, m: Morpheme, next: Morpheme | undefined): string[] | null {
  const prev = b.ms[b.ms.length - 1];
  if (m.pos === '助動詞') {
    switch (m.base) {
      case 'た': case 'だ':
        if (m.ctype !== '特殊・タ') return null;
        if (m.cform === '仮定形') return ['conditional (tara)'];
        if (m.cform === '未然形') return ['past'];
        return ['past'];
      case 'ない': return m.ctype === '特殊・ナイ' ? ['negative'] : null;
      case 'ぬ': case 'ん': case 'ず':
        return ['negative'];
      case 'ます': return ['polite'];
      case 'たい': return ['want to (tai)'];
      case 'う': case 'よう': return ['volitional'];
      case 'まい': return ['negative volitional'];
      case 'べし': return ['should (beki)'];
      case 'です':
        // ません + でした: the polite negative past. Elsewhere です after a verb or adjective is a word of its own.
        return prev.base === 'ん' || prev.base === 'ぬ' ? [] : null;
      default: return null;
    }
  }
  if (m.pos === '動詞' && m.pos1 === '接尾') {
    if (m.base === 'させる' || m.base === 'せる' || m.base === 'しめる') { b.causative = true; return ['causative']; }
    if (m.base === 'れる' || m.base === 'られる') {
      if (b.causative) return ['passive'];
      if (prev === b.head && b.head.ctype === '一段' && m.base === 'られる') return ['passive or potential'];
      if (prev === b.head && b.head.ctype === '一段' && m.base === 'れる') return ['potential'];
      if (prev === b.head && b.head.ctype.startsWith('カ変')) return ['passive or potential'];
      return ['passive'];
    }
    if (m.base === 'がる') return ['shows signs of (garu)'];
    return null;
  }
  // 読まされる: the short causative-passive is 読ま + さ (する) + れる.
  if (m.pos === '動詞' && m.base === 'する' && m.surface === 'さ' && prev === b.head && prev.cform === '未然形' && next?.base === 'れる') {
    b.causative = true;
    return ['causative'];
  }
  if (m.pos === '助詞' && m.pos1 === '接続助詞') {
    if (m.surface === 'て' || m.surface === 'で') { b.afterTe = true; return ['te-form']; }
    if (m.surface === 'ば') return ['conditional (ba)'];
    if (m.surface === 'ちゃ' || m.surface === 'じゃ') return ['te wa (cha)'];
    return null;
  }
  if (m.pos === '助詞' && m.pos1 === '並立助詞' && (m.surface === 'たり' || m.surface === 'だり')) return ['tari'];
  if (b.afterTe && (m.pos === '動詞') && AFTER_TE[m.base]) { b.afterTe = false; return [AFTER_TE[m.base]]; }
  if (m.pos === '動詞' && m.pos1 === '非自立' && CONTRACTED[m.base] && (prev.cform.startsWith('連用'))) return [CONTRACTED[m.base]];
  if ((m.pos === '動詞' || m.pos === '形容詞') && m.pos1 === '非自立' && AFTER_STEM[m.base] && prev.cform.startsWith('連用')) return [AFTER_STEM[m.base]];
  if (m.pos === '形容詞' && m.pos1 === '非自立' && m.base === 'ほしい' && b.afterTe) { b.afterTe = false; return ['want someone to (te hoshii)']; }
  if (m.pos === '名詞' && m.pos1 === '接尾' && m.pos2 === '助動詞語幹' && m.base === 'そう') return ['looks like (sou)'];
  if (m.pos === '名詞' && m.pos1 === '接尾' && m.pos2 === '特殊' && (m.base === 'さ' || m.base === 'み') && b.head.pos === '形容詞' && prev === b.head) return ['noun (-' + (m.base === 'さ' ? 'sa' : 'mi') + ')'];
  return null;
}

/** Forms the head's own ending tells (imperative, the bare stem), when nothing follows it. */
function headForm(m: Morpheme, alone: boolean): string[] {
  if (m.cform.startsWith('命令')) return ['imperative'];
  if (!alone) return [];
  if (m.pos === '形容詞' && m.cform === '連用テ接続') return ['adverbial (ku)'];
  if (m.pos === '形容詞' && m.cform === 'ガル接続') return ['stem'];
  if (m.pos === '動詞' && m.cform === '連用形') return ['stem (continuative)'];
  if (m.pos === '動詞' && m.cform === '未然形') return ['negative stem'];
  if (m.pos === '動詞' && m.cform === '仮定形') return ['conditional stem'];
  return [];
}

/** The reading of a lemma from its head morpheme: 書い (カイ) with base 書く → かく. */
function lemmaReadingOf(head: Morpheme, lemma: string): string {
  const r = readingOf(head);
  if (!r) return '';
  if (head.base === '来る' || head.ctype.startsWith('カ変')) return head.base === '来る' ? 'くる' : hira(head.base);
  if (head.base === head.surface) return r;
  // The surface and the base share their kanji part; swap the kana ending.
  let p = 0;
  while (p < head.surface.length && p < head.base.length && head.surface[p] === head.base[p]) p++;
  const surfTail = head.surface.slice(p);
  const baseTail = lemma.slice(p);
  if (!r.endsWith(hira(surfTail))) return '';
  return r.slice(0, r.length - hira(surfTail).length) + hira(baseTail);
}

const DIGITS_RE = /^[0-9０-９]+$/;
/** The value of a run of ASCII or full-width digits (null past what reads safely). */
export function digitValue(s: string): number | null {
  const v = Number(s.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10)));
  return Number.isSafeInteger(v) && v < 1e16 ? v : null;
}

const isTe = (m: Morpheme) => m.pos === '助詞' && m.pos1 === '接続助詞' && (m.surface === 'て' || m.surface === 'で');

function makeWord(ms: Morpheme[], forms: string[], lemma: string, cls: WordClass, extra?: Partial<Word>): Word {
  const text = ms.map((m) => m.surface).join('');
  const reading = ms.every((m) => readingOf(m)) ? ms.map(readingOf).join('') : '';
  const head = ms[0];
  return {
    start: ms[0].start,
    end: ms[ms.length - 1].end,
    text,
    morphemes: ms,
    lemma,
    reading,
    lemmaReading: lemma === text ? reading : '',
    pieces: ms.map((m) => ({ text: m.surface, reading: readingOf(m) })),
    forms,
    cls,
    ctype: head.ctype,
    unknown: ms.some((m) => !m.known),
    ...extra,
  };
}

/** Takes the endings that belong to the verb or adjective at ms[i]; returns the word and the index after it. */
function inflected(ms: Morpheme[], i: number, prefix: Morpheme[] = []): [Word, number] {
  const head = ms[i];
  const b: Builder = { ms: [head], forms: [], afterTe: false, head, causative: false };
  let j = i + 1;
  while (j < ms.length) {
    const labels = auxLabel(b, ms[j], ms[j + 1]);
    if (!labels) break;
    b.ms.push(ms[j]);
    b.forms.push(...labels);
    b.afterTe = isTe(ms[j]);
    j++;
  }
  const own = headForm(head, b.ms.length === 1);
  const forms = [...own, ...b.forms];
  const all = [...prefix, ...b.ms];
  let lemma = head.base !== '*' ? head.base : head.surface;
  if (prefix.length) lemma = prefix.map((m) => m.surface).join('') + lemma;
  const word = makeWord(all, forms, lemma, prefix.length ? 'verb' : classOf(head));
  word.ctype = head.ctype;
  const lr = lemmaReadingOf(head, head.base);
  word.lemmaReading = prefix.length ? (prefix.every((m) => readingOf(m)) && lr ? prefix.map(readingOf).join('') + lr : '') : lr;
  return [word, j];
}

/** Groups morphemes of one run of Japanese text into words. */
export function groupWords(ms: Morpheme[], ctx: WordContext): Word[] {
  const out: Word[] = [];
  let i = 0;
  while (i < ms.length) {
    const m = ms[i];
    const cls = classOf(m);
    // A する-noun and its する: 勉強した. (できる after it is the potential: 勉強できる.)
    if ((m.pos1 === 'サ変接続' && m.pos === '名詞') && ms[i + 1]?.pos === '動詞' && ms[i + 1].base === 'する' && ms[i + 1].pos1 === '自立') {
      const [w, j] = inflected(ms, i + 1, [m]);
      w.lemma = m.surface + 'する';
      w.cls = 'verb';
      w.ctype = 'サ変・スル';
      out.push(w);
      i = j;
      continue;
    }
    if (m.pos === '動詞' || m.pos === '形容詞') {
      const [w, j] = inflected(ms, i);
      out.push(w);
      i = j;
      continue;
    }
    // The copula and other auxiliaries with no verb before them: だった, でした, でしょう, ません.
    if (m.pos === '助動詞') {
      const [w, j] = inflected(ms, i);
      w.cls = 'aux';
      out.push(w);
      i = j;
      continue;
    }
    // Numbers: a run of kanji numerals (or of digits), and the counter after it.
    if (cls === 'number' && (isNumeralText(m.surface) || DIGITS_RE.test(m.surface))) {
      let j = i;
      let text = '';
      const digits = DIGITS_RE.test(m.surface);
      while (j < ms.length && classOf(ms[j]) === 'number' && (digits ? DIGITS_RE.test(ms[j].surface) : isNumeralText(ms[j].surface))) text += ms[j++].surface;
      const rough = digits ? null : approximateParts(text);
      const value = rough ? null : digits ? digitValue(text) : numeralValue(text);
      const parts = rough ?? (value === null ? [] : numberParts(value));
      const group = ms.slice(i, j);
      // IPADIC files some counters as plain nouns (疋, 艘): a noun right after a number that counts things is one too.
      const counter = ms[j] && (classOf(ms[j]) === 'counter' || (ms[j].pos === '名詞' && counterBase(ms[j].surface) !== undefined && ms[j].surface.length === 1)) ? ms[j] : undefined;
      if (counter) {
        group.push(counter);
        const plain = counterBase(counter.surface) ?? readingOf(counter);
        const reading = parts.length && plain ? counterReading(parts, value, counter.surface, plain) : '';
        const w = makeWord(group, [], text + counter.surface, 'counter');
        if (reading) { w.reading = reading; w.pieces = [{ text: w.text, reading }]; }
        w.lemmaReading = w.reading;
        out.push(w);
        i = j + 1;
      } else {
        const w = makeWord(group, [], text, 'number');
        if (parts.length) { w.reading = parts.join(''); w.pieces = [{ text, reading: w.reading }]; w.lemmaReading = w.reading; }
        out.push(w);
        i = j;
      }
      continue;
    }
    // 何本, 何匹: 何 with a counter.
    if (m.surface === '何' && ms[i + 1] && classOf(ms[i + 1]) === 'counter') {
      const c = ms[i + 1];
      const plain = counterBase(c.surface) ?? readingOf(c);
      const reading = plain ? counterReading(['なん'], null, c.surface, plain) : '';
      const w = makeWord([m, c], [], m.surface + c.surface, 'counter');
      if (reading) { w.reading = reading; w.pieces = [{ text: w.text, reading }]; w.lemmaReading = reading; }
      out.push(w);
      i += 2;
      continue;
    }
    // A full name: surname + given name.
    const nk = nameKind(m);
    if (nk === 'surname' && ms[i + 1] && nameKind(ms[i + 1]) === 'given') {
      const w = makeWord([m, ms[i + 1]], [], m.surface + ms[i + 1].surface, 'noun', { name: 'person' });
      out.push(w);
      i += 2;
      continue;
    }
    const w = makeWord([m], [], m.base !== '*' && m.pos !== '記号' ? m.base : m.surface, cls === 'number' ? 'number' : cls);
    if (nk) w.name = nk;
    out.push(w);
    i++;
  }
  return joinCompounds(out, ctx);
}

const JOINABLE: ReadonlySet<WordClass> = new Set(['noun', 'prefix', 'suffix', 'adjna', 'pronoun', 'counter', 'number']);

/**
 * A verb stem or te-form and the verb after it that JMdict lists together: 読み|終わった → 読み終わった (読み終わる), 持って|きた →
 * 持ってきた (持ってくる), 出て|いった (出ていく).
 */
function joinVerb(w: Word, v: Word | undefined, ctx: WordContext): Word | null {
  if (!v || w.cls !== 'verb' || v.cls !== 'verb' || v.morphemes[0].pos !== '動詞') return null;
  const stem = w.forms.length === 1 && w.forms[0] === 'stem (continuative)';
  const te = w.forms.length === 1 && w.forms[0] === 'te-form';
  if (!stem && !te) return null;
  const vForms = v.forms[0] === 'stem (continuative)' ? v.forms.slice(1) : v.forms;
  const heads = [v.lemma];
  if (te) {
    const swap: Record<string, string[]> = { いく: ['行く'], 行く: ['いく'], くる: ['来る'], 来る: ['くる'], ゆく: ['行く', 'いく'] };
    heads.push(...(swap[v.lemma] ?? []));
  }
  const lemma = heads.map((h) => w.text + h).find((c) => ctx.has(c));
  if (!lemma) return null;
  const joined = makeWord([...w.morphemes, ...v.morphemes], vForms, lemma, 'verb');
  joined.ctype = v.ctype;
  joined.reading = w.reading && v.reading ? w.reading + v.reading : '';
  joined.lemmaReading = w.reading && v.lemmaReading ? w.reading + v.lemmaReading : '';
  joined.pieces = [...w.pieces, ...v.pieces];
  return joined;
}

/** Nouns side by side that JMdict lists as one word become that word: 子供|たち, 一日|中, unknown 支|那. Longest first. */
function joinCompounds(words: Word[], ctx: WordContext): Word[] {
  const out: Word[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const verb = joinVerb(w, words[i + 1], ctx);
    if (verb) { out.push(verb); i += 2; continue; }
    if (!JOINABLE.has(w.cls) || w.forms.length) { out.push(w); i++; continue; }
    let best = -1;
    let text = w.text;
    for (let j = i + 1; j < words.length && j < i + 5; j++) {
      const v = words[j];
      if (!JOINABLE.has(v.cls) || v.forms.length) break;
      // A name stays a name (田中 + さん), and a person's suffix is not part of a noun, unless JMdict lists the whole
      // (御釈迦様, 神様, お母さん).
      if (v.morphemes[0].pos2 === '人名' && !ctx.has(text + v.text)) break;
      text += v.text;
      if (ctx.has(text)) best = j;
    }
    if (best < 0) { out.push(w); i++; continue; }
    const parts = words.slice(i, best + 1);
    const ms = parts.flatMap((p) => p.morphemes);
    const joined = makeWord(ms, [], parts.map((p) => p.text).join(''), parts.some((p) => p.cls === 'noun' || p.cls === 'pronoun') ? 'noun' : parts[parts.length - 1].cls);
    joined.reading = parts.every((p) => p.reading) ? parts.map((p) => p.reading).join('') : '';
    joined.lemmaReading = joined.reading;
    joined.pieces = parts.flatMap((p) => p.pieces);
    joined.name = parts.every((p) => p.name) ? parts[0].name : undefined;
    joined.compound = true;
    out.push(joined);
    i = best + 1;
  }
  return out;
}
