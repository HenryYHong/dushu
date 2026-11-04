// The per-book switches of core/bookStyle.ts: books of the 1920s that write 底 for the particle 的 (我底书) and the old novels and
// 1920s books that write 那 for 哪 in questions (那里去呢？). Detection over a book's chapters, the reader's choice over it, the lexicon
// that carries the switches to segment(), and the readings they change. Invented sentences.
import { describe, expect, it } from 'vitest';
import { chooseOldSpellings, detectOldSpellings, NO_OLD_SPELLINGS, withOldSpellings } from '../../src/core/bookStyle';
import { buildLexicon } from '../../src/core/lexicon';
import { numberedToMarked } from '../../src/core/pinyin';
import { segment } from '../../src/core/segment';
import type { Lexicon, OldSpellings } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';

const dictP = loadTestDictionary();

/** The marked pinyin of `part` (first occurrence, or the n-th with `nth`) in `text` read with the switches `s`. */
async function py(text: string, part: string, s: OldSpellings, nth = 0): Promise<string> {
  const d = await dictP;
  let at = -1;
  for (let k = 0; k <= nth; k++) at = text.indexOf(part, at + 1);
  if (at < 0) throw new Error(`"${part}" is not in "${text}"`);
  const out: string[] = [];
  for (const t of segment(text, d, withOldSpellings(undefined, s))) {
    if (t.kind !== 'han') continue;
    let off = t.start;
    [...t.text].forEach((ch, i) => {
      if (off >= at && off < at + part.length) out.push(numberedToMarked(t.pinyin![i]));
      off += ch.length;
    });
  }
  return out.join(' ');
}

const DI: OldSpellings = { di: true, na: false };
const NA: OldSpellings = { di: false, na: true };

describe('detectOldSpellings', () => {
  it('is sure of 底 for 的 when 我底 她底 … come often, and not for 底下 到底 心底', () => {
    const old = ['她底眼睛很亮。我底朋友来了，你底书在桌上。', '他底话是真的。他们底事情多。自己底命自己管。', '她底父亲来了，我底心很乱。'];
    const r = detectOldSpellings(old);
    expect(r.di.sure).toBe(true);
    expect(r.di.hits).toBeGreaterThanOrEqual(5);
    const modern = ['我的朋友在桥底下等我。他到底来不来？', '她心底很难过。我的书在你的包里。', '他底气很足。'];
    expect(detectOldSpellings(modern).di).toEqual({ hits: 0, of: 3, sure: false });
  });

  it('is sure of 那 for 哪 when questions ask with 那里 那个 and the book never writes 哪', () => {
    const old = ['你们往那里跑？', '那个是你的哥哥？', '你家在那里？', '那一位是先生？', '这东西从那里来的？', '那些人去不得？'];
    expect(detectOldSpellings(old).na.sure).toBe(true);
    const modern = [...old, '你去哪里？', '哪个好？', '哪一天来？', '你在哪儿？', '哪些人去了？', '哪能这样？', '哪有这事？'];
    expect(detectOldSpellings(modern).na.sure).toBe(false);
    // "That one?" with another word that asks is no evidence.
    expect(detectOldSpellings(['那位客人是谁？', '那里有什么？', '那里有人吗？', '那是你的吗？', '那个人呢？']).na.hits).toBe(0);
  });

  it('lets the reader choose over detection', () => {
    const r = detectOldSpellings(['她底眼睛很亮。我底朋友来了，你底书在桌上。他底话是真的。他们底事情多。']);
    expect(chooseOldSpellings(r)).toEqual({ di: true, na: false });
    expect(chooseOldSpellings(r, { di: false })).toEqual({ di: false, na: false });
    expect(chooseOldSpellings(r, { na: true })).toEqual({ di: true, na: true });
    expect(chooseOldSpellings(undefined)).toEqual(NO_OLD_SPELLINGS);
  });

  it('carries the switches on the lexicon and keeps whatever else it carries', () => {
    const lex = buildLexicon([{ word: '加陵', pinyin: 'jia1 ling2', gloss: 'name', kind: 'name', enabled: true, origin: 'auto' }]);
    const dressed: Lexicon & { note?: string } = { ...lex, note: 'kept' };
    const on: Lexicon & { note?: string } = withOldSpellings(dressed, DI);
    expect(on.spellings).toEqual(DI);
    expect(on.note).toBe('kept');
    expect(on.get('加陵')?.pinyin).toBe('jia1 ling2');
    expect(withOldSpellings(on, NO_OLD_SPELLINGS).spellings).toBeUndefined();
    expect(withOldSpellings(undefined, NA).has('加陵')).toBe(false);
  });
});

describe('底 for 的', () => {
  const cases: [string, string, string, OldSpellings][] = [
    ['她底眼睛很亮。', '底', 'de', DI], ['她底眼睛很亮。', '底', 'dǐ', NO_OLD_SPELLINGS],
    ['那是一扇宝石底门。', '底', 'de', DI], ['有些躺着底，有些坐着底。', '底', 'de', DI], ['这段很容易记底。', '底', 'de', DI],
    ['只听她底祈祷：', '底', 'de', DI],
    // the noun stays: before 下 里 的, in a word, ending a transliteration
    ['钱藏在箱底里。', '底', 'dǐ', DI], ['他坐在桥底下。', '底', 'dǐ', DI], ['你到底去不去？', '到底', 'dào dǐ', DI], ['一只脱底的船', '底', 'dǐ', DI],
    ['安多瓦底说：', '底', 'dǐ', DI],
  ];
  for (const [text, part, want, s] of cases) it(`${text} ${part} = ${want} (${s.di ? 'on' : 'off'})`, async () => expect(await py(text, part, s)).toBe(want));
});

describe('那 for 哪', () => {
  const cases: [string, string, string, OldSpellings][] = [
    ['你们往那里跑？', '那里', 'nǎ li', NA], ['你家在那里？', '那里', 'nǎ li', NA], ['你家在那里？', '那里', 'nà li', NO_OLD_SPELLINGS], ['那个便宜？', '那个', 'nǎ ge', NA],
    ['你是那寺里的和尚？', '那', 'nǎ', NA], ['差那两个去？', '那', 'nǎ', NA], ['那一个不想发财？', '那', 'nǎ', NA],
    ['那里还会有这样的事。', '那里', 'nǎ li', NA], ['那有这样的道理！', '那', 'nǎ', NA], ['这东西从那里来的？', '那里', 'nǎ li', NA],
    // "that, there": another word asks, someone's place, a yes-no question, what a verb takes, another 那 word that asks
    ['那位客人是谁？', '那位', 'nà wèi', NA], ['我那里还有。', '那里', 'nà li', NA], ['你在三姑娘那里吗？', '那里', 'nà li', NA],
    ['方才可见在三姑娘那里？', '那里', 'nà li', NA], ['那不是他家？', '那', 'nà', NA], ['寻那个苦恼去？', '那个', 'nà ge', NA],
    ['把那个碗都打了？', '那个', 'nà ge', NA], ['那秃驴在那里？', '那', 'nà', NA], ['那秃驴在那里？', '那里', 'nǎ li', NA],
    ['那么你去不去？', '那么', 'nà me', NA], ['那时候你在那里？', '那时', 'nà shí', NA],
  ];
  for (const [text, part, want, s] of cases) it(`${text} ${part} = ${want} (${s.na ? 'on' : 'off'})`, async () => expect(await py(text, part, s)).toBe(want));
});

describe('那 for 哪: "that, there" the books still mean', () => {
  // Lines of the old novels (public domain), which write 那 for 哪 and still mean "that, there" in these.
  const cases: [string, string, string][] = [
    // 那里 + 不 …来了？ (isn't someone coming over there?), a statement of what is there, 想是 and 莫不 (could it be), 兀那 pointing
    ['悟空，那里不有人来了？', '那里', 'nà li'], ['那里不是孙行者来了？', '那里', 'nà li'], ['那里有只渡船儿来了。', '那里', 'nà li'],
    ['那里想是酆都城鬼王弄喧？', '那里', 'nà li'], ['莫不公孙胜也在那里？', '那里', 'nà li'], ['兀那松树背后一个人立在那里？', '那里', 'nà li'],
    ['你不看见孙行者那里哭将来了？', '那里', 'nà li'],
    // a title after it (管营, 知府), a long subject before 不, 将 + what is taken, this one … that one, 是那 + what someone did + 的
    ['那管营相公正在厅上坐。', '那', 'nà'], ['那知府喝令左右把武松一索捆翻。', '那', 'nà'], ['那一座大的园子人家是不敢买的。', '那', 'nà'],
    ['二处若得一处，那一处亦不久也。', '那', 'nà'], ['却将那匹大马连鞍辔都吃了？', '那', 'nà'], ['这个要把佛衣来庆寿，那个不得袈裟肯善归？', '那个', 'nà ge'],
    ['这一个因师伤命来求水，那一个为侄亡身不与泉。', '那', 'nà'], ['你是那闹天宫的孙悟空？', '那', 'nà'],
    // 那得 before a verb of depending on something: that takes (nà děi)
    ['说到下棋，那得让他三分！', '那得', 'nà děi'], ['成不成，那得瞧他自己。', '那得', 'nà děi'],
  ];
  for (const [text, part, want] of cases) it(`${text} ${part} = ${want}`, async () => expect(await py(text, part, NA)).toBe(want));
  // …and what still asks (or asks rhetorically) there.
  const asks: [string, string, string][] = [
    ['放着这些小子们，那一个派不得？', '那', 'nǎ'], ['这些管家奶奶们，那一位是好缠的？', '那', 'nǎ'], ['你这一向病着，那里有什么新鲜东西。', '那里', 'nǎ li'],
    ['行者道：「拿那个？」', '那个', 'nǎ ge'], ['诸如此类，那得齐全。', '那得', 'nǎ dé'], ['那得闲工夫陪你？', '那得', 'nǎ dé'],
    ['我们这几个吃尚且不够，那得回与你。', '那得', 'nǎ dé'], ['论吃穿用度，那一样也不比别人差。', '那', 'nǎ'],
  ];
  for (const [text, part, want] of asks) it(`${text} ${part} = ${want}`, async () => expect(await py(text, part, NA)).toBe(want));

  it('reads 那得 that opens a clause as nà děi in any book', async () => {
    expect(await py('那得多少钱啊？', '那得', NO_OLD_SPELLINGS)).toBe('nà děi');
    expect(await py('那得看情况。', '那得', NO_OLD_SPELLINGS)).toBe('nà děi');
    expect(await py('那得要他点头才行。', '那得', NO_OLD_SPELLINGS)).toBe('nà děi');
  });

  it('reads 那 as written everywhere once the reader turns the switch off, even where the rules for the old novels read nǎ', async () => {
    const off = chooseOldSpellings(detectOldSpellings(['你们往那里跑？', '那个是你的哥哥？', '你家在那里？', '那一位是先生？', '这东西从那里来的？', '那些人去不得？']), { na: false });
    expect(off).toEqual({ di: false, na: false, naAsWritten: true });
    expect(withOldSpellings(undefined, off).spellings).toEqual({ di: false, na: false, naAsWritten: true });
    // Without a choice, the rules for the old novels read these nǎ; turned off, they read nà.
    for (const [text, part] of [['我们打那里走？', '那里'], ['他那里晓得这个？', '那里'], ['那知他不来。', '那']]) {
      expect(await py(text, part, NO_OLD_SPELLINGS), text).toMatch(/^nǎ/);
      expect(await py(text, part, off), text).toMatch(/^nà/);
    }
  });
});

describe('底 for 的 after a verb the dictionary joins with it', () => {
  it('cuts 见底 到底 before a noun when the book writes 底 for 的, and keeps the words otherwise', async () => {
    const d = await dictP;
    const cut = (text: string, s: OldSpellings) => segment(text, d, withOldSpellings(undefined, s)).map((t) => (t.pinyin && t.kind === 'han' ? `${t.text}{${t.pinyin.join(' ')}}` : t.text)).join('|');
    expect(cut('我们所见底山水都很美。', DI)).toContain('见{jian4}|底{de5}|山水');
    expect(cut('车到底时候，雨还在下。', DI)).toContain('到{dao4}|底{de5}|时候');
    expect(cut('你到底去不去？', DI)).toContain('到底{dao4 di3}');
    expect(cut('这水见底了。', DI)).toContain('见底{jian4 di3}');
    expect(cut('我们所见底山水都很美。', NO_OLD_SPELLINGS)).toContain('见底{jian4 di3}');
  });
});
