// The sixth pass (2026-11): what an independent review of the fifth pass found worse (为今之计 wéi, the moon that is white,
// 过时 after 而, 吊死 on a beam, 长脸 cháng, 可不枉, the classical 子 zǐ, 为 for and because, 人才, 怪道, 僧道, 教 jiào, 背 bèi,
// 得 dé, 跌仆 pū, a name read qiǎng) and the commonest misses of a full native read of a modern novel (two animals, a pot, a
// shop, one hand, a mirror, a red sun, 就让, 眼泪汪汪, 老是, 年月, 麦场 cháng, 当天 dàng, 怕人, 方桌 …). Every sentence is
// invented or a line of a public-domain classic in public/samples; a case marked `true` is written in traditional characters.
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

/** The tokens (as shown, simplified) joined with | and framed by |, so a test can look for |a|b| anywhere. */
async function cut(text: string, trad = false): Promise<string> {
  const d = await dictP;
  return `|${run(d, text, trad).map((t) => t.text).join('|')}|`;
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

describe('为: what the fifth pass made worse, and the commonest misses', () => {
  it('reads wéi in 为今之计, 宁为, 为人 (conduct), 为恶 为善, and after a verb of showing or defining', () =>
    checkReadings([
      ['伏兵半路以奪之，如之奈何？為今之計，不許便休', '为今', 'wei2 jin1', true],
      ['若此，則江南何日得安？為今之計，莫若使人赴許都', '为今', 'wei2 jin1', true],
      ['一日抒忠憤，千秋仰義名。寧為傅僉死，不作蔣舒生。', '宁为', 'ning4 wei2', true],
      ['近來暴有幾貫浮財，只是為人行短。', '为人', 'wei2 ren2', true],
      ['他年纪小，但为人稳重，做事踏实。', '为人', 'wei2 ren2'],
      ['这伙强盗仗着人多，到处为恶。', '为恶', 'wei2 e4'],
      ['他一生乐于为善，从不求报答。', '为善', 'wei2 shan4'],
      ['仪表把水温显示为蓝色数字。', '为', 'wei2'],
    ]));

  it('reads wèi for someone spoken to or planned for, for a feeling, for a matter, and because of who someone is', () =>
    checkReadings([
      ['霸曰：「吾向嘗為將軍言，鄧艾自幼深明兵法，善曉地理。」', '为将', 'wei4 jiang1', true],
      ['權曰：「孤本欲取荊州，前言特以試卿耳。卿可速為孤圖之。」', '为孤', 'wei4 gu1', true],
      ['今兩國既已和好，豈為一時之忿，而誤了大事？', '为一', 'wei4 yi1', true],
      ['賈充呼成濟曰：「司馬公養你何用？正為今日之事也。」', '正为', 'zheng4 wei4', true],
      ['如今寶玉等出來，又不能同賈政一處坐著，為甄寶玉又是晚一輩，又不好叫寶玉等站著。', '为甄', 'wei4 zhen1', true],
      // A ship's name in quotes before 号 is not "styled as".
      ['“蓝鲸”号驶入了渔民为观测海豚划出的水域。', '为观', 'wei4 guan1'],
    ]));
});

describe('子: the classical son, "you" and the books in 子', () => {
  it('reads zǐ for a son after 兄 我 如 为 立 见 诤 假 厥 哺, and in 子书, 子贵', () =>
    checkReadings([
      ['操之兄子曹安民，知操意，乃密對曰', '兄子', 'xiong1 zi3', true],
      ['立馮方女為后，立子為東宮。', '立子', 'li4 zi3', true],
      ['吾弟尚未有子，今即以賢郎為子，若何？', '郎为子', 'lang2 wei2 zi3', true],
      ['玄德曰：「吾待之如子，彼必事吾如父，何亂之有？」', '如子', 'ru2 zi3', true],
      ['竊聞『君有諍臣，父有諍子』。', '诤子', 'zheng4 zi3', true],
      ['賣履小兒，常使假子拒敵！', '假子', 'jia3 zi3', true],
      ['唐堯不私於厥子，而名播於無窮', '厥子', 'jue2 zi3', true],
      ['你這潑猴！既有兄弟之親，如何坑陷我子？', '我子', 'wo3 zi3', true],
      ['噫！父見子以劍架刀，就當喝退', '见子', 'jian4 zi3', true],
      ['你這樣一個通人，竟沒看見子書？', '子书', 'zi3 shu1', true],
      ['又道寶玉『高魁子貴』，莫非他有遺腹之子', '子贵', 'zi3 gui4', true],
    ]));

  it('keeps the noun suffix after a noun', () =>
    checkReadings([
      ['他坐了一会子就走了。', '会子', 'hui4 zi5'],
      ['那几个媳妇子都悄悄的出去了。', '媳妇子', 'xi2 fu5 zi5'],
    ]));
});

describe('other readings', () => {
  it('教 jiào for a teaching after 其 吾 at the end of a clause; 教 jiāo stays for teaching someone', () =>
    checkReadings([
      ['然惟西域桑門自傳其教。實乃夷犯中國', '其教', 'qi2 jiao4', true],
      ['傷生吃人造孽。幸皈吾教，誠敬迦持', '吾教', 'wu2 jiao4', true],
      ['今喜皈依，秉我迦持，又乘吾教，取去真經', '吾教', 'wu2 jiao4', true],
      ['师父教他一套拳法。', '教', 'jiao1'],
    ]));

  it('背 bèi when reciting in turn; bēi when carrying', () =>
    checkReadings([
      ['学生们依次背了一段课文。', '背', 'bei4'],
      ['他背了一袋米回家。', '背', 'bei1'],
    ]));

  it('得 dé after a permission and the one who gets to; děi when more hands are needed', () =>
    checkReadings([
      ['是巧宗兒你們都得了，難道不許我得一遭兒？', '我得', 'wo3 de2', true],
      ['这活儿太重，又得两个丫头伺候。', '又得', 'you4 dei3'],
    ]));

  it('仆 pū after 跌; 强 qiáng in a name a surname stands before; 什 shí inside a transliteration', () =>
    checkReadings([
      ['那汉子被打得跌仆在地。', '仆', 'pu1'],
      ['王强打着手电筒走在前面。', '强', 'qiang2'],
      ['他勉强笑了笑。', '强', 'qiang3'],
      ['米什拉先生明天到。', '什', 'shi2'],
      ['他见到了卡尔·米什拉。', '什', 'shi2'],
      ['女婿王强要一块地。', '强', 'qiang2'],
      ['瓶里插着什么花？', '什么', 'shen2 me5'],
    ]));

  it('着 zhe in 还睡着 (still asleep); 种 zhòng before so many mu; 了 liǎo in 就算了事', () =>
    checkReadings([
      ['天亮了，姐姐还睡着，我轻轻出了门。', '睡着', 'shui4 zhe5'],
      ['张老汉今年种两亩芝麻。', '种', 'zhong4'],
      ['道个歉就算了事？', '了事', 'liao3 shi4'],
    ]));

  it('reads 麦场 màicháng, 长脸 chángliǎn and 当天 dàngtiān', () =>
    checkReadings([
      ['他在麦场上打麦子。', '麦场', 'mai4 chang2'],
      ['只見這人容長臉，長挑身材，年紀只好十八九歲', '长脸', 'chang2 lian3', true],
      ['李叔当天傍晚赶回村里。', '当天', 'dang4 tian1'],
    ]));
});

describe('groupings the fifth pass made worse', () => {
  it('cuts 月白 where the moon is white and keeps the colour', async () => {
    expect(await cut('是夜，天清月白，風靜雲閑。', true)).toContain('|月|白|');
    expect(await cut('霜晴覺夜長，月白穿窗透。', true)).toContain('|月|白|');
    expect(await cut('身上穿一件月白素綢襖兒', true)).toContain('|月白|');
    expect(await cut('桌上铺着一块月白色桌布。')).toContain('|月白|色|');
  });

  it('keeps 过时 "outdated" after an adjective and 而, cuts it after a motion', async () => {
    expect(await cut('这是一套陈旧而过时的办法。')).toContain('|过时|');
    expect(await cut('卡车呼啸而过时，尘土飞扬。')).not.toContain('|过时|');
  });

  it('keeps 吊死 after a place in 上, cuts 上吊 + 死 otherwise', async () => {
    expect(await cut('那个强盗在房梁上吊死了。')).toContain('|上|吊死|');
    expect(await cut('他想不开，上吊死了。')).toContain('|上吊|死|');
  });

  it('keeps the rhetorical 可不 from becoming 不枉', async () => {
    expect(await cut('一旦身亡，可不枉生世界之中，不得久注天人之內？', true)).not.toContain('|不枉|');
  });

  it('keeps 人才 for talent or looks, cuts 人 + 才 "only then"', async () => {
    expect(await cut('一來結束非凡，二者人才出眾。', true)).toContain('|人才|');
    expect(await cut('汝那廟堂之臣，何不識人才若此！', true)).toContain('|人才|');
    expect(await cut('想我那唐僧，人才雖俊，其實不中用。', true)).toContain('|人才|');
    expect(await cut('那人才走了没多久。')).toContain('|人|才|');
  });

  it('cuts 怪道 before what is said, keeps 僧道 in a list, and 他娘的 when it is his mother\'s', async () => {
    expect(await cut('那菩薩情知，怪道：「你這潑猴不知好歹」', true)).toContain('|怪|道|');
    expect(await cut('三等人不可壞他：第一，是雲游僧道：他又不曾受用過分了', true)).toContain('|僧道|');
    expect(await cut('这件衣裳是他娘的。')).toContain('|他|娘|的|');
    expect(await cut('他娘的，又下雨了。')).toContain('|他娘的|');
  });

  it('cuts 就算了 + 事 into 就 + 算 + 了事, 倒好 before 几', async () => {
    expect(await cut('道个歉就算了事？')).toContain('|算|了事|');
    expect(await cut('他在冰上摔倒好几回。')).toContain('|好几|');
  });
});

describe('a numeral and its measure word where the dictionary lists another word', () => {
  it('cuts 两头 before an animal a few characters on', async () => {
    expect(await cut('他牵来两头大水牛。')).toContain('|两|头|');
    expect(await cut('山上跑下来两头小花鹿。')).toContain('|两|头|');
    expect(await cut('桥的两头都有人守着马。')).toContain('|两头|');
    expect(await cut('話分兩頭。', true)).toContain('|两头|');
  });

  it('cuts 一口 一手 一家 一面 一轮 几点 used as measure words, keeps the words', async () => {
    expect(await cut('厨房角落有一口大缸。')).toContain('|一|口|');
    expect(await cut('洒家要打条禅杖，一口戒刀。')).toContain('|一|口|');
    expect(await cut('店家一口回绝。')).toContain('|一口|');
    expect(await cut('她一手捏着针，一手按着布。')).toContain('|一|手|捏');
    expect(await cut('老师一手指着黑板讲课。')).toContain('|一|手|指着|');
    expect(await cut('这件事是他一手造成的。')).toContain('|一手|');
    expect(await cut('街口有一家小店。')).toContain('|一|家|');
    expect(await cut('我们一家都在这里。')).toContain('|一家|');
    expect(await cut('门后钉着一面铜镜。')).toContain('|一|面|');
    expect(await cut('他一面走一面唱。')).toContain('|一面|');
    expect(await cut('东边升起一轮红日。')).toContain('|一|轮|');
    expect(await cut('纸上溅了几点墨。')).toContain('|几|点|');
    expect(await cut('你几点回来？')).toContain('|几点|');
  });
});

describe('groupings a full native read of a modern novel found wrong', () => {
  it('cuts 就让, 眼|泪汪汪, 怕人 before a verb, 也好 before 叫, 来时 after a directional verb and its object', async () => {
    expect(await cut('老师就让我们回家了。')).toContain('|就|让|');
    expect(await cut('小妹眼泪汪汪，拉着妈妈。')).toContain('|眼泪|汪汪|');
    expect(await cut('小妹双眼泪汪汪，不肯松手。')).toContain('|泪汪汪|');
    expect(await cut('她怕人笑话，不敢出门。')).toContain('|怕|人|');
    expect(await cut('这声音真怕人。')).toContain('|怕人|');
    expect(await cut('多请些人来，也好叫大家放心。')).toContain('|也|好|叫|');
    expect(await cut('阿婆从布包里摸出钱来时，手一直抖。')).toContain('|来|时|');
    expect(await cut('回来时下着雨。')).not.toContain('|时下|');
  });

  it('joins 老是 "always" and 年月 "these times", but not 高老 + 是 or 某年月日', async () => {
    expect(await cut('小狗老是追着自己的尾巴。')).toContain('|老是|');
    expect(await cut('高老是县里的老干部。')).toContain('|老|是|');
    expect(await cut('这年月做买卖不容易。')).toContain('|年月|');
    expect(await cut('某年月日，书赐荣国公。')).not.toContain('|年月|');
  });

  it('joins 方桌 and 供桌 before 上, and cuts 当天 "high in the sky"', async () => {
    expect(await cut('茶壶搁在方桌上。')).toContain('|方桌|上|');
    expect(await cut('他睡在供桌上。')).toContain('|供桌|上|');
    expect(await cut('天氣未及晌午，一輪紅日當天，沒半點雲彩', true)).toContain('|当|天|');
  });
});
