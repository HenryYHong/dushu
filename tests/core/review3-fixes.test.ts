// The third native review of every Chinese book (2026-11): 教 "to teach", 当 "to treat as", 应 "to answer", 将 "a general" and
// 马上 "on horseback". Each case is an invented sentence or a line of a public-domain classic run through segment(), so the
// paragraph's other tokens are seen as the reader sees them. A case marked `t` is written in traditional characters.
import { describe, expect, it } from 'vitest';
import { segment } from '../../src/core/segment';
import { loadTestDictionary } from '../helpers/data';
import type { Dictionary, Token } from '../../src/types';

const dictP = loadTestDictionary();

function run(d: Dictionary, text: string, trad: boolean): Token[] {
  if (!trad) return segment(text, d);
  const shown = d.toSimplified(text);
  return segment(shown, d, undefined, undefined, shown.length === text.length ? text : undefined);
}

/** Numbered pinyin of the characters of `part` (its first occurrence in the text shown), joined by spaces. */
function readingOf(toks: Token[], shown: string, part: string): string {
  const at = shown.indexOf(part);
  if (at < 0) throw new Error(`"${part}" is not in "${shown}"`);
  const out: string[] = [];
  for (const t of toks) {
    if (t.kind !== 'han') continue;
    let off = t.start;
    [...t.text].forEach((ch, i) => {
      if (off >= at && off < at + part.length) out.push(t.pinyin![i]);
      off += ch.length;
    });
  }
  return out.join(' ');
}

/** [sentence, part (as shown, simplified), expected numbered pinyin, written in traditional?] */
type R = [string, string, string, boolean?];

async function checkReadings(cases: R[]): Promise<void> {
  const d = await dictP;
  for (const [text, part, want, trad] of cases) {
    const toks = run(d, text, !!trad);
    const shown = toks.map((t) => t.text).join('');
    expect(`${text} ${part}: ${readingOf(toks, shown, part)}`).toBe(`${text} ${part}: ${want}`);
  }
}

async function cut(text: string, trad = false): Promise<string> {
  const d = await dictP;
  return run(d, text, trad).filter((t) => t.kind === 'han').map((t) => t.text).join('|');
}

describe('教: jiāo "to teach" and jiào "to let, to make"', () => {
  it('reads jiāo before a skill or a subject, a number of lessons, what someone taught (的) and at the end of a question', () =>
    checkReadings([
      ['师父教他一套剑法。', '教', 'jiao1'], ['谁教你剑法的？', '教', 'jiao1'], ['我再教你几招。', '教', 'jiao1'],
      ['是我爷爷教我的。', '教', 'jiao1'], ['她教孩子们画画。', '教', 'jiao1'], ['老人教他识字。', '教', 'jiao1'],
      ['她只想好好教她的书。', '教', 'jiao1'], ['学校里谁能教呢？', '教', 'jiao1'], ['这么一教，孩子就会了。', '教', 'jiao1'],
      ['这个本事是一位老道士教我的。', '教', 'jiao1'], ['他教来教去，还是不会。', '教', 'jiao1'], ['这孩子笨，教也教不懂。', '教', 'jiao1'],
      ['这套拳我只教两遍。', '教', 'jiao1'], ['他还没教你呢？', '教', 'jiao1'], ['父子相传，不教徒弟。', '教', 'jiao1'],
      ['明天再教你几招罢。', '教', 'jiao1'], ['先生要教他做诗。', '教', 'jiao1'],
    ]));

  it('keeps jiào where someone is let or made to do something', () =>
    checkReadings([
      ['这事教我好生为难。', '教', 'jiao4'], ['要是骗你，教我功夫尽废。', '教', 'jiao4'], ['天子甚喜，命教再唱。', '教', 'jiao4'],
      ['操教将红旗一招。', '教', 'jiao4'], ['他却教石勇骑了马。', '教', 'jiao4'], ['正欲领世兄们的教呢。', '教', 'jiao4'],
      ['好教他们学个乖。', '教', 'jiao4'], ['医不活，教师父念紧箍儿咒。', '教', 'jiao4'],
    ]));
});

describe('当: dàng "to treat as, to pawn" and dāng', () => {
  it('reads dàng in 把X当Y, 当一回事, 当…用 and pawning', () =>
    checkReadings([
      ['你别把我当客人。', '当', 'dang4'], ['老板把这场比赛当一回事。', '当', 'dang4'], ['那个警告，经理却没当回事。', '当', 'dang4'],
      ['这根棍子可当拐杖用。', '当', 'dang4'], ['把绵衣服叫人当了几吊钱。', '当', 'dang4'], ['怎么就把他拿来当果子？', '当', 'dang4'],
      ['这破袍子去当吧！', '当', 'dang4'], ['村民把那棵古树当神灵来崇拜。', '当', 'dang4'], ['你上了他的当，还不知道。', '当', 'dang4'],
      ['他们把这些话当“命令”，谁也不敢违抗。', '当', 'dang4'], ['他把木棍拿出来当扁担，慢慢往前走。', '当', 'dang4'],
    ]));

  it('keeps dāng for "when", "should", "in front of", "at" and "to serve as"', () =>
    checkReadings([
      ['当他推开门的时候，屋里没人。', '当', 'dang1'], ['她到县报当记者。', '当', 'dang1'], ['把他送到县里当学徒。', '当', 'dang1'],
      ['他把组长当得很好。', '当', 'dang1'], ['把武松押至当厅。', '当', 'dang1'], ['汝妹亦当恩养。', '当', 'dang1'],
      ['他当著我拜了师父。', '当', 'dang1'], ['一把将他当胸抓住。', '当', 'dang1'], ['但用之物，当依命拜奉。', '当', 'dang1'],
    ]));
});

describe('应: yìng "to answer, to respond, to be borne out" and yīng "should"', () => {
  it('reads yìng at the end of a clause, before 之 弦 and what is fulfilled, and for the one answered', () =>
    checkReadings([
      ['叫了几声，他只不应。', '应', 'ying4'], ['玄德曰：「已应之矣。」', '应', 'ying4'], ['一箭射去，应弦落马。', '应', 'ying4'],
      ['今果应其言。', '应', 'ying4'], ['此人上应天星。', '应', 'ying4'], ['他曾应过武举。', '应', 'ying4'],
      ['有我应著呢。', '应', 'ying4'], ['宝玉应一句。', '应', 'ying4'], ['你敢应我么？', '应', 'ying4'],
      ['此大凶之兆也，应在今夜。', '应', 'ying4'], ['婆子应喏了。', '应', 'ying4'], ['欲结东吴，结为外应矣。', '应', 'ying4'],
      ['你可应么？', '应', 'ying4'], ['唐僧没奈何，应他一声。', '应', 'ying4'], ['他虽然应名来上学，也不读书。', '应', 'ying1'], // 应名 (in name only) is yīngmíng, as CEDICT has it
      ['自从兄长应武举后，便不得相见。', '应', 'ying4'], ['那应差听差的妇人都来了。', '应', 'ying4'],
    ]));

  it('keeps yīng for "should"', () =>
    checkReadings([
      ['这花儿应在三月里开的。', '应', 'ying1'], ['所有孝男等俱应在庙伴宿。', '应', 'ying1'], ['此事不应如此。', '应', 'ying1'],
      ['你本应早来。', '应', 'ying1'],
    ]));
});

describe('将: jiàng "a general" and jiāng', () => {
  it('reads jiàng at the end of a clause, in 将星 将佐 and after 心腹 为主 番 川 蛮', () =>
    checkReadings([
      ['斩关杀将，如入无人之境。', '将', 'jiang4'], ['汝乃无名下将，非我对手。', '将', 'jiang4'], ['夜观天象，见将星坠地。', '将', 'jiang4'],
      ['左右将佐皆抵挡不住。', '将', 'jiang4'], ['便命心腹将李傕领兵。', '将', 'jiang4'], ['吾命张辽为主将。', '将', 'jiang4'],
      ['番将落马。', '将', 'jiang4'], ['此乃智勇之将也。', '将', 'jiang4'], ['名號「雙鎗將」。', '将', 'jiang4', true],
    ]));

  it('keeps jiāng for 把, "about to", "together" and the chess check', () =>
    checkReadings([
      ['妻许你共相将。', '将', 'jiang1'], ['他拍着棋盘喊：「再将！」', '将', 'jiang1'], ['他先将《论语》读完。', '将', 'jiang1'],
      ['曹兵将至，孤城不可守。', '将', 'jiang1'],
    ]));
});

describe('马上: on horseback or at once', () => {
  it('cuts 马 + 上 where a horse, a rider or a horseback deed is beside it, or the clause ends on it', async () => {
    expect(await cut('關公馬上欠身言曰：「吾弟安在？」', true)).toContain('马|上');
    expect(await cut('当先马上两员上将。')).toContain('马|上');
    expect(await cut('两匹马上，驮著行李。')).toContain('马|上');
    expect(await cut('他被绑在了马上。')).toContain('马|上');
    expect(await cut('那马上骑着两个人。')).toContain('马|上');
    expect(await cut('袍上马上，都是泥水。')).toContain('马|上');
  });

  it('keeps 马上 "at once"', async () => {
    for (const text of ['老师马上回来。', '马上！', '我马上。', '她怔住了。马上，脸就红了。', '后面马上就有人来了。', '店主马上一口答应。']) {
      expect(`${text} ${await cut(text)}`).toContain('马上');
    }
  });
});
