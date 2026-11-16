// Readings in a modern story's everyday scenes that the rules for older books got wrong: 骑 after a number that is no count
// of horsemen (骑一骑, a name's 四), 将 for 把 after 用牙 and before a word of its own (将校门, not 将校 officers), 藏 hidden
// after 地 西 道 that end other words (悄悄地藏到, 东西藏在, 知道藏在), 卡 stuck, 差 short by a count, and 不了 declining.
// Invented sentences, each run through segment() and the sandhi pass, exactly what the reader shows.
import { describe, expect, it } from 'vitest';
import { applySandhi, numberedToMarked } from '../../src/core/pinyin';
import { segment } from '../../src/core/segment';
import { loadTestDictionary } from '../helpers/data';

const dictP = loadTestDictionary();

/** The marked pinyin of the first occurrence of `part` in `text`, one string per code point, joined by spaces. */
async function py(text: string, part: string): Promise<string> {
  const d = await dictP;
  const at = text.indexOf(part);
  if (at < 0) throw new Error(`"${part}" is not in "${text}"`);
  const toks = segment(text, d);
  applySandhi(toks);
  const out: string[] = [];
  for (const t of toks) {
    if (t.kind !== 'han') continue;
    let off = t.start;
    [...t.text].forEach((ch, i) => {
      if (off >= at && off < at + part.length) out.push(numberedToMarked(t.pinyin![i]));
      off += ch.length;
    });
  }
  return out.join(' ');
}

describe('骑', () => {
  it('is the verb when said twice, or after a name’s number', async () => {
    expect(await py('我也想骑一骑它。', '骑一骑')).toBe('qí yi qí');
    expect(await py('阿五骑在墙头上。', '骑')).toBe('qí');
  });
  it('still counts horsemen', async () => {
    expect(await py('一骑红尘妃子笑。', '骑')).toBe('jì');
    expect(await py('城外来了数骑。', '骑')).toBe('jì');
  });
});

describe('将', () => {
  it('is 把 after 用 and a tool, and before a word of its own', async () => {
    expect(await py('他用牙将绳子咬断了。', '将')).toBe('jiāng');
    expect(await py('我们先将校门关上。', '将')).toBe('jiāng');
  });
  it('still names officers and generals', async () => {
    expect(await py('众将校一齐上前。', '将')).toBe('jiàng');
    expect(await py('城中守将出马。', '将')).toBe('jiàng');
  });
});

describe('藏', () => {
  it('hides, after a word that ends in 地 西 道', async () => {
    expect(await py('他悄悄地藏到门后。', '藏')).toBe('cáng');
    expect(await py('把东西藏在柜子里。', '藏')).toBe('cáng');
    expect(await py('谁也不知道藏在哪里。', '藏')).toBe('cáng');
  });
  it('is still Tibet and the bodhisattva', async () => {
    expect(await py('他去过西藏。', '藏')).toBe('zàng');
    expect(await py('庙里供着地藏王菩萨。', '藏')).toBe('zàng');
    expect(await py('他读过一部大道藏。', '藏')).toBe('zàng');
  });
});

describe('卡 and 差', () => {
  it('卡 stuck is qiǎ, a card kǎ', async () => {
    expect(await py('车轮被卡在石缝里。', '卡')).toBe('qiǎ');
    expect(await py('我的卡在包里。', '卡')).toBe('kǎ');
  });
  it('差 short by a count is chà', async () => {
    expect(await py('鸡也差三只。', '差')).toBe('chà');
  });
});

describe('不了', () => {
  it('declines on its own, and is a complement after a verb', async () => {
    expect(await py('“不了，我还有事。”', '不了')).toBe('bù le');
    expect(await py('今天我去不了。', '不了')).toBe('bu liǎo');
  });
});

describe('more everyday words', () => {
  it('得 is de before 令人 and must opening a clause; 得令 is still took the order', async () => {
    expect(await py('这里的菜贵得令人发愁。', '得')).toBe('de');
    expect(await py('他的额头烫着呢。“不行，得找大夫啦！”她说。', '得')).toBe('děi');
    expect(await py('众将得令，各自回营。', '得')).toBe('dé');
    expect(await py('他们的钱都花着呢。“我家有福，得遇这位先生。”', '得')).toBe('dé');
    expect(await py('他们的钱都花着呢。“我才敢来，得看先生之面。”', '得')).toBe('dé');
    expect(await py('他把房间“大扫除”得跟新的一样。', '得')).toBe('de');
  });
  it('差 lacking only one thing is chà; sending someone stays chāi', async () => {
    expect(await py('他打扮好了，只差一双鞋。', '差')).toBe('chà');
    expect(await py('现在只差等你点头了。', '差')).toBe('chà');
    expect(await py('知县就差人去请他。', '差')).toBe('chāi');
  });
  it('幢 with its 一 left out is zhuàng', async () => {
    expect(await py('他们想在城里买幢旧楼。', '幢')).toBe('zhuàng');
  });
  it('兴 spoiled for someone is xìng', async () => {
    expect(await py('我不想扫大家的兴。', '兴')).toBe('xìng');
  });
  it('数 who counts as the best is shǔ', async () => {
    expect(await py('一家人里头数她最能干。', '数')).toBe('shǔ');
  });
});

describe('a martial-arts novel’s readings', () => {
  it('参 ginseng, 绰 grabbed, 调 regulating, 解 said twice, 率 together', async () => {
    expect(await py('他在山里采参为生。', '参')).toBe('shēn');
    expect(await py('那个参客背着筐走了。', '参')).toBe('shēn');
    expect(await py('他把剑绰在手里。', '绰')).toBe('chāo');
    expect(await py('她坐下来调气。', '调')).toBe('tiáo');
    expect(await py('请村长调处这件事。', '调')).toBe('tiáo');
    expect(await py('喝杯热茶解解乏。', '解')).toBe('jiě');
    expect(await py('众人相率离去。', '率')).toBe('shuài');
    expect(await py('他一刀割断了系船的绳子。', '系')).toBe('jì');
    expect(await py('他用长绳系腰，攀上了崖壁。', '系')).toBe('jì');
  });
  it('降 surrendered or fell, 觉 felt, 将 about to', async () => {
    expect(await py('守军或降或逃。', '降')).toBe('xiáng');
    expect(await py('气温或升或降。', '降')).toBe('jiàng');
    expect(await py('他一觉有人，立刻回头。', '觉')).toBe('jué');
    expect(await py('我想先睡一觉再说。', '觉')).toBe('jiào');
    expect(await py('天将破晓，鸡叫了。', '将')).toBe('jiāng');
    expect(await py('天兵天将都来了。', '将')).toBe('jiàng');
  });
  it('骑 mounting, 差 short by, 数 several, 了 after what was got', async () => {
    expect(await py('他一骑上马就跑远了。', '骑')).toBe('qí');
    expect(await py('一骑快马奔来。', '骑')).toBe('jì');
    expect(await py('那支箭差了两寸。', '差')).toBe('chà');
    expect(await py('他差了一个人去打听。', '差')).toBe('chāi');
    expect(await py('现在只差天时而已。', '差')).toBe('chà');
    expect(await py('众人差愕。', '差')).toBe('chà');
    expect(await py('他喊了数声。', '数')).toBe('shù');
    expect(await py('门口来了数人。', '数')).toBe('shù');
    expect(await py('他一连放了数箭。', '数')).toBe('shù');
    expect(await py('他得了《唐诗三百首》。', '得了')).toBe('dé le');
  });
  it('words: 格格 the creak, 点中 hit, V得出, 所长 one’s forte, 大意 careless', async () => {
    expect(await py('小姑娘格格地笑了。', '格格')).toBe('gē gē');
    expect(await py('冷得他的关节格格直响。', '格格')).toBe('gē gē');
    expect(await py('她抢上一步，点中他的穴道。', '点中')).toBe('diǎn zhòng');
    expect(await py('图上这些点中有一个是红的。', '点中')).toBe('diǎn zhōng');
    expect(await py('这么难的题，他也考得出。', '得出')).toBe('de chū');
    expect(await py('我背得出这首诗。', '得出')).toBe('de chū');
    expect(await py('下棋并非他所长。', '所长')).toBe('suǒ cháng');
    expect(await py('这件事千万不敢大意。', '大意')).toBe('dà yi');
  });
});
