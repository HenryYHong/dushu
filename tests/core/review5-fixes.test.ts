// The fifth pass over the readings (2026-11): the places an independent review found worse than before the earlier passes (为 wéi
// for "for, because of" in the old novels, 干 "to concern", 削 xuē, 尽 jǐn, 差 chāi, 将 jiàng, 紮 zhā, 子 zǐ, 相 xiāng, 垛 duǒ, 背 bèi,
// 也得 dé, 乾 qián, 应名 yīng …) and the readings a full read of a modern novel found wrong (干 gàn, 得 děi, 一通 tòng, 转一圈 zhuàn,
// 着 zháo, 倒 dǎo/dào, 地, 人家, 场 cháng, 晃, 长, 背, 猫 máo, 待 dāi, 挑, 背篼 bēi, 精神 and one-offs). Each case is an invented
// sentence or a line of a public-domain classic run through segment(). A case marked `true` is written in traditional characters.
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

describe('为 in the old novels: wèi "for, because of" again where the earlier passes made it wéi', () => {
  it('reads wèi before what is done for someone named after it', () =>
    checkReadings([
      ['先主答曰：「朕不為弟報讎，雖有萬里江山，何足為貴？」', '为弟', 'wei4 di4', true],
      ['厲聲大叫曰：「賊將休走！吾今為關公報讎！」', '为关', 'wei4 guan1', true],
      ['權曰：「爾欲為諸葛亮作說客，來說孤絕魏向蜀，是否？」', '为诸', 'wei4 zhu1', true],
      ['菩薩道：「我要見見玉帝，煩為轉奏。」', '为转', 'wei4 zhuan3', true],
      ['啟道：「師父，為人須為徹，索性捨個大慈悲」', '为人须为彻', 'wei4 ren2 xu1 wei4 che4', true],
    ]));

  it('reads wèi for a cause: 盖为, 为见, 为折了, 原为 + a deed, the reasons counted, 为…之故, 为底', () =>
    checkReadings([
      ['宋江答道：「蓋為朝廷不明，縱容奸臣當道，讒佞專權」', '盖为', 'gai4 wei4', true],
      ['小人為見本人是個好男子，不忍下手', '为见', 'wei4 jian4', true],
      ['此時知府為折了呼延灼正納悶間', '为', 'wei4', true],
      ['邢夫人，王夫人道：“我們來原為給大老爺拜壽，這不竟是我們來過生日來了么？”', '原为', 'yuan2 wei4', true],
      ['賈母道：“我原為氣得慌，今日接你們來給孫子媳婦過生日。”', '原为', 'yuan2 wei4', true],
      ['開卷即云「風塵懷閨秀」，則知作者本意原爲記述當日閨友閨情，並非怨世駡時之書矣。', '原为', 'yuan2 wei4', true],
      ['便趁此机會，一為送妹待選，二為望親，三因親自入部銷算舊帳', '一为送', 'yi1 wei4 song4', true],
      ['此玉早已離世。一為避禍，二為撮合，從此夙緣一了', '二为', 'er4 wei4', true],
      // (为今之计 is wéi: tests/core/review6-fixes.test.ts.)
      ['孔明笑曰：「此乃周瑜之計，必為荊州之故。」', '必为', 'bi4 wei4', true],
      ['孤標傲世偕誰隱，一樣花開為底遲？', '为底', 'wei4 di3', true],
      ['吾昔已許之，豈可失信？彼各為其主，勿追也。', '各为', 'ge4 wei4', true],
    ]));

  it('keeps wéi for what someone is or does: a role, a plan, a deed of a kind, a suspicion', () =>
    checkReadings([
      ['統曰：「只今便選精兵，晝夜兼道逕襲成都，此為上計。」', '此为', 'ci3 wei2', true],
      ['賈不假，白玉為堂金作馬。', '玉为', 'yu4 wei2', true],
      ['祖居西土流沙國，我父原為沙國王。', '原为', 'yuan2 wei2', true],
      ['對曰：「某舉孝廉。原為袁紹，張揚從事。」', '原为', 'yuan2 wei2', true],
      ['今無端據而有之，天下將以備為無義人矣。', '备为', 'bei4 wei2', true],
      ['吾寧死，不為不仁不義之事。', '不为', 'bu4 wei2', true],
      ['操賊奸惡日甚，將來必為篡逆之事。', '必为', 'bi4 wei2', true],
      ['故見鳳姐掣肘如此，便疑為不肯用心，便在賈母靈前嘮嘮叨叨哭個不了。', '疑为', 'yi2 wei2', true],
      ['朕聞上古有云：『僧是佛家弟子。』端的不知為僧可能不死，向佛可能長生？', '为僧', 'wei2 seng1', true],
      ['若真也葬花，可謂‘東施效顰’，不但不為新特，且更可厭了。', '不为', 'bu4 wei2', true],
    ]));
});

describe('干 "to concern" (gān) and 干 "to do" (gàn)', () => {
  it('reads gān for what is no concern of someone, 干连, 干与国政, and where an edition writes 幹 for 干 or 乾', () =>
    checkReadings([
      ['晁蓋便挺朴刀叫道：「不干百姓事，休只管傷人。」', '干', 'gan1', true],
      ['傳令曰：「要害我者，陳應、鮑隆也；不干眾人之事。」', '干', 'gan1', true],
      ['不想賊心不改，致有此事。實不干陶謙之故：望明公察之。', '干', 'gan1', true],
      ['便一齊往前頭回賈母王夫人知道，好不干連了他們。', '干', 'gan1', true],
      ['皓哭拜維曰：「某早晚趨侍聖上而已，並不干與國政。」', '干', 'gan1', true],
      ['叵耐黃文炳那廝，事又不干他己，卻在知府面前胡言亂道', '干', 'gan1', true],
      ['一隻裝載馬匹，一隻裝裴宣等一幹人，一隻請太尉下船', '干', 'gan1', true],
      ['一個皮主腰幹紅簇就，一個羅踢串彩色裝成。', '干', 'gan1', true],
      ['我们不干伤天害理的事。', '干', 'gan4'],
      ['他从来不干家务事。', '干', 'gan4'],
    ]));

  it('reads gàn for work (干不动, 干惯, 直干到, 有活干, 多干) and gān for what is not dry yet or sitting idle', () =>
    checkReadings([
      ['他老了，干不动了。', '干', 'gan4'],
      ['有活干，心里就不慌。', '干', 'gan4'],
      ['你也该多干些，别总歇着。', '干', 'gan4'],
      ['他们直干到天黑才收工。', '干', 'gan4'],
      ['他们早就干惯了重活。', '干', 'gan4'],
      ['下雨天，衣服还没干。', '干', 'gan1'],
      ['这件事我没干。', '干', 'gan4'],
      ['客人来了，他只好干坐着。', '干', 'gan1'],
    ]));
});

describe('削 xuē, 尽 jǐn, 差 chāi, 将 jiàng, 紮 zhā, 赚 zhuàn', () => {
  it('reads 削 xuē in the literary phrases and shapes, xiāo for cutting or peeling', () =>
    checkReadings([
      ['巍巍峻嶺，削削尖峰。', '削削', 'xue1 xue1', true],
      ['致被蔡京喝罵，削了趙鼎官職。', '削', 'xue1', true],
      ['然後圖魏。魏削則東吳亦不能久存，可以復一統之基業也。', '削', 'xue1', true],
      ['遂回步入館舍，用劍尖削去此詩，棄劍上馬。', '削', 'xiao1', true],
      ['这把宝剑削铁如泥。', '削', 'xue1'],
      ['来人尖嘴削腮，一脸奸笑。', '削', 'xue1'],
      ['她坐在窗边削苹果。', '削', 'xiao1'],
    ]));

  it('reads 尽 jǐn in 尽让 尽够 尽可 and 别尽著, however the book writes it', () =>
    checkReadings([
      ['以後一處念書認字學針線，或是偶一頑笑，都有盡讓的。', '尽', 'jin3', true],
      ['大夫不許我多吃茶，這半鐘盡夠了，難為你想的到。', '尽', 'jin3', true],
      ['這些人原是買的，如今雖不學唱，盡可留著使喚', '尽', 'jin3', true],
      ['寶釵不待說完，便道：“你醒醒兒罷，別盡著迷在里頭。”', '尽', 'jin3', true],
    ]));

  it('reads 差 chāi when someone named in quotes is sent, and chā for "without fail"', () =>
    checkReadings([
      ['我這裏先差『黑旋風』李逵，引著樊瑞，將帶步軍一千', '差', 'chai1', true],
      ['朱武道：「論我愚意，可差『鼓上蚤』時遷。」', '差', 'chai1', true],
      ['常言道：『官差吏差，來人不差。』', '吏差', 'li4 chai1', true],
      ['主上仁慈待下，明慎用刑，賞罰無差。', '差', 'cha1', true],
      ['他的成绩再差，也要读完。', '差', 'cha4'],
    ]));

  it('reads 将 jiàng for the generals in 上将 勇将 猛将 神将', () =>
    checkReadings([
      ['第一路大將張勳居中，第二路上將橋蕤居左', '将桥', 'jiang4 qiao2', true],
      ['宋江軍中，智勇猛將極多。', '将', 'jiang4', true],
      ['天曹神將盡皆驚，地府閻羅心膽怯。', '将', 'jiang4', true],
      ['夏天将尽，河水也凉了。', '将', 'jiang1'],
    ]));

  it('reads 紮 zhā for stationing troops and holding one\'s ground; 赚 zhuàn for earning', () =>
    checkReadings([
      ['當時見了眾人，就在中軍紮駐。', '扎', 'zha1', true],
      ['花榮傳令，於城北五里外，紮兩個營寨', '扎', 'zha1', true],
      ['維折了許多人馬，一路收紮不住，自回漢中。', '扎', 'zha1', true],
      ['只管丟出去餵狗，大家賺不成。', '赚', 'zhuan4', true],
      ['商人想赚你的“血汗钱”。', '赚', 'zhuan4'],
    ]));
});

describe('子 zǐ, 相 xiāng, 垛 duǒ, 背 bèi, 也得 dé, 乾 qián, 应名 yīng, 那里 nà, 教 jiào', () => {
  it('reads each as the classics mean it', () =>
    checkReadings([
      ['第七十五回　關雲長刮骨療毒　呂子明白衣渡江', '子', 'zi3', true],
      ['好個妙齡聰俊風流子，堪配西梁窈窕娘。', '子', 'zi3', true],
      ['孟獲率引大小洞主酋長及諸部落，羅拜相送。', '相', 'xiang1', true],
      ['陰交書命，外助王師，內相掩襲。', '相', 'xiang1', true],
      ['賈珍忙笑道：“老內相所見不差。”', '相', 'xiang4', true],
      ['挂於垂楊枝上，下設一箭垛，以百步為界。', '垛', 'duo3', true],
      ['如要進發，垛樓上一聲梆子響，二十四部水車，一齊用力踏動', '垛', 'duo3', true],
      ['飛曰：「你背了兄長，降了曹操，封侯賜爵。」', '背', 'bei4', true],
      ['這個果子，也莫背了沙僧，可叫他一聲。', '背', 'bei4', true],
      ['眾人道：「把梯子上去拆了，也得耳根清淨。」', '得', 'de2', true],
      ['倘或皇天見憐，有人救得，收養此子，他日還得相逢。', '还得', 'hai2 de2', true],
      ['只是除非穿上身長生不老，就得成佛作祖，也值不得這許多！', '得', 'de2', true],
      ['取經未知有無，及回又得十二三年，豈不違背聖旨？', '得', 'dei3', true],
      ['煉石補天，普救閻浮世界。補到乾宮缺地，見一座崑崙山腳下', '乾', 'qian2', true],
      ['這賈薔外相既美，內性又聰明，雖然應名來上學，亦不過虛掩眼目而已。', '应', 'ying1', true],
      ['我悄悄把去溪邊殺了。提桶湯去後面，就那裏撏得乾淨，煮得熟了', '那里', 'na4 li5', true],
      ['若是個志誠老實的人，可以容他在家出入，也教孩兒們學些好。', '教', 'jiao4', true],
    ]));
});

describe('readings of a modern novel that were wrong (invented sentences)', () => {
  it('得 děi for "must" after a deed or a subject, dé for an illness got', () =>
    checkReadings([
      ['吃完饭，他又得去挑水。', '得', 'dei3'],
      ['做人得讲道理。', '得', 'dei3'],
      ['她俩得住在一起。', '得', 'dei3'],
      ['他又得了一员大将。', '得', 'de2'],
      ['他得了一种怪病，医生也查不出来。', '得', 'de2'],
    ]));

  it('一通 tòng, 转一圈 zhuàn, 着 zháo, 倒 dǎo or dào, 地 de or dì', () =>
    checkReadings([
      ['老师把他骂了一通。', '通', 'tong4'],
      ['他给家里打了一通电话。', '通', 'tong1'],
      ['他绕着池塘转了一圈。', '转', 'zhuan4'],
      ['别吓着孩子，慢慢说。', '着', 'zhao2'],
      ['幸好没伤着人。', '着', 'zhao2'],
      ['她轻轻地踩着石阶下楼。', '着', 'zhe5'],
      ['这回他可倒大霉了。', '倒', 'dao3'],
      ['他把剩下的水倒在盆里。', '倒', 'dao4'],
      ['大家一起把那头猪按倒。', '倒', 'dao3'],
      ['教室里哄地一声笑开了。', '地', 'de5'],
      ['那片落叶刚挨着地，就被风吹走了。', '地', 'di4'],
    ]));

  it('人家 a household, 场 cháng for rain and illness, 晃, 长, 背, 猫, 待, 挑', () =>
    checkReadings([
      ['这条街上有些人家还亮着灯。', '人家', 'ren2 jia1'],
      ['下了几场雨，地就软了。', '场', 'chang2'],
      ['那场雨下了三天。', '场', 'chang2'],
      ['老人身子一晃，扶住了门框。', '一晃', 'yi1 huang4'],
      ['一晃就是十年。', '一晃', 'yi1 huang3'],
      ['他站起来时，腿直打晃。', '晃', 'huang4'],
      ['别着急，路还长着呢。', '长', 'chang2'],
      ['今年的玉米怕是长不好了。', '长', 'zhang3'],
      ['把孩子背回家去。', '背', 'bei1'],
      ['伤员太重，我来背。', '背', 'bei1'],
      ['他猫着腰跑了过来。', '猫', 'mao2'],
      ['你在湖边待这么久，不冷吗？', '待', 'dai1'],
      ['他把扁担挑起来就走。', '挑', 'tiao1'],
      ['他用长竿挑着一面旗。', '挑', 'tiao3'],
    ]));

  it('背篼 bēi, 精神 jīngshen, 地道 dìdao and the one-offs', () =>
    checkReadings([
      ['他给女儿编了个背篼。', '背篼', 'bei1 dou1'],
      ['换了新衣服，他看上去格外精神。', '精神', 'jing1 shen5'],
      ['他的北京话说得很地道。', '地道', 'di4 dao5'],
      ['他会唱酸曲。', '曲', 'qu3'],
      ['她拿扇子扇火。', '扇火', 'shan1 huo3'],
      ['往锅里撒些盐。', '撒', 'sa3'],
      ['他划燃了一根火柴。', '划', 'hua2'],
      ['他上了车，还回过身来招手。', '还', 'hai2'],
      ['这辆旧车的架子快散了。', '散', 'san3'],
      ['屋里不通风，闷得慌。', '闷', 'men1'],
      ['他把裤子褪到膝盖。', '褪', 'tun4'],
      ['他冲着门外喊了一声。', '冲', 'chong4'],
    ]));
});
