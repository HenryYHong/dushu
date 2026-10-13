// Errors found by reading 400 tokens at random from the public-domain books (the four classics, three stories by Lu Xun,
// the Analects, the Tang poems) and by comparing the whole text with an independent pinyin tool. Each case is a sentence
// or a fragment run through segment() and the sandhi pass, exactly what the reader shows; the second block pins the
// dictionary side (readings, spellings and senses).
import { describe, expect, it } from 'vitest';
import { applySandhi, numberedToMarked } from '../../src/core/pinyin';
import { segment } from '../../src/core/segment';
import { entriesForReading } from '../../src/core/reading';
import { leadGloss } from '../../src/ui/popup/defs';
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

describe('readings fixed after sampling the books', () => {
  const cases: [string, string, string][] = [
    // 佛 is fó (Unihan lists fú, which only occurs inside 仿佛)
    ['心即佛', '佛', 'fó'], ['修建佛事', '佛事', 'fó shì'], ['藥師佛', '佛', 'fó'],
    // 甚麼 is one word, shén me (it was cut 甚|麼 and read shèn)
    ['不知是個甚麼妖邪？', '甚麼', 'shén me'], ['我說甚么神仙話', '甚么', 'shén me'],
    // 鋪 pū "to spread" / pù "shop"
    ['兩梢間鋪著四張藤屜床。', '鋪', 'pū'], ['他開了一間店鋪。', '店鋪', 'diàn pù'],
    // 降 xiáng "to surrender, to subdue"
    ['荊州原降文武各官', '降', 'xiáng'], ['降妖杵', '降', 'xiáng'], ['降臨人間', '降臨', 'jiàng lín'], ['天降大雨', '降', 'jiàng'],
    // 那裏 as "how could" (nǎ li) before a verb of will
    ['張飛那裏肯聽', '那裏', 'nǎ li'], ['他在那裏', '那裏', 'nà li'],
    // 數 "several" before a measure word, also right after 了
    ['走過了數個山頭', '數', 'shù'], ['連進了數次粥湯', '數', 'shù'], ['數一數', '數', 'shǔ'],
    ['他不咬人么？', '么', 'ma'], ['什么人', '什么', 'shén me'],
    ['巧言令色，鮮矣仁。', '鮮', 'xiǎn'], ['鮮花', '鮮花', 'xiān huā'],
    ['可謂好學也已', '好學', 'hào xué'],
    ['鹿柴', '鹿柴', 'lù zhài'],
    // 更: a watch of the night
    ['三更時分', '更', 'gēng'], ['更好', '更', 'gèng'],
    ['當差', '差', 'chāi'], ['差人去擒他', '差', 'chāi'], ['差不多', '差', 'chà'],
    ['這一場好殺', '場', 'cháng'], ['一場大雨', '場', 'cháng'],
    ['布沈吟良久曰', '沈吟', 'chén yín'], ['沈氏', '沈', 'shěn'],
    ['怎麼哄我', '哄', 'hǒng'], ['哄堂大笑', '哄', 'hōng'],
    ['大哉乾元', '乾', 'qián'], ['有何事幹', '幹', 'gàn'], ['口乾舌燥', '乾', 'gān'],
    ['我晓得了。', '了', 'le'], ['吃得了。', '了', 'liǎo'],
    ['什物', '什', 'shí'], ['不辱沒嫂嫂', '沒', 'mò'],
    ['恁般利害', '恁般', 'nèn bān'],
    ['魏徵', '徵', 'zhēng'], ['累卵之急', '累', 'lěi'], ['地藏王', '藏', 'zàng'],
    ['星斗', '斗', 'dǒu'], ['翻觔斗', '斗', 'dǒu'],
    ['簡帖', '帖', 'tiě'], ['押解', '解', 'jiè'], ['自己調息', '調', 'tiáo'], ['返復兩回還', '還', 'huán'],
    ['一朝天氣炎熱', '朝', 'zhāo'], ['一朝天子一朝臣', '朝', 'cháo'],
    ['南無阿彌陀佛', '南無', 'nā mó'], ['衣甲旗旛', '衣甲', 'yī jiǎ'],
    ['請大夫來看病', '大夫', 'dài fu'], ['士大夫之家', '大夫', 'dà fū'], ['王夫人', '夫人', 'fū rén'],
    ['拚命扯住', '拚命', 'pīn mìng'],
    ['這箇', '箇', 'ge'], ['悄言', '悄', 'qiāo'],
    ['他得了性命', '得', 'dé'], ['我得去', '得', 'děi'],
    ['單單只剩一個', '單單', 'dān dān'],
    ['綠水青山', '綠', 'lǜ'],
    // second sample
    ['有詩為證', '為', 'wéi'], ['初見方為座上客', '為', 'wéi'], ['為我取來', '為', 'wèi'],
    ['兄弟，我前日在街上', '兄弟', 'xiōng di'], ['兄弟二人', '兄弟', 'xiōng dì'],
    ['走求名利無雙地，打出樊籠', '地', 'dì'], ['他慢慢地走了', '地', 'de'],
    ['數去更無君傲世', '數', 'shǔ'], ['一九一八年', '一九一八', 'yī jiǔ yī bā'],
    // third sample
    ['眾將認的是高可立', '將', 'jiàng'], ['兩將相交', '將', 'jiàng'], ['將他拿來', '將', 'jiāng'],
    ['向者不克而還，皆因軍出甚遲也。', '還', 'huán'], ['不知漢天子怎離此難，', '難', 'nàn'],
    ['為人謀而不忠乎', '為', 'wèi'], ['為人正直', '為人', 'wéi rén'],
    ['曾子曰：吾日三省吾身', '曾', 'zēng'], ['曾經去過', '曾經', 'céng jīng'],
    ['這是佛前海燈嗄。', '嗄', 'a'],
    // 為: the verb "to be" in the old books, "for" before a pronoun, a question word or 了
    ['舉火為號', '為', 'wéi'], ['號為玉音', '為', 'wéi'], ['尊母何氏為太后', '為', 'wéi'], ['為了你', '為了', 'wèi le'], ['他為我取來', '為', 'wèi'], ['孩子为了他', '为了', 'wèi le'],
    ['爲人謀而不忠乎', '爲', 'wèi'], ['為民除害', '為民除害', 'wèi mín chú hài'],
    // 差 chāi "to send", chà "lacking"
    ['蒙玉帝遣差天王', '差', 'chāi'], ['宋公明差我等在此迎', '差', 'chāi'], ['差張飛為先鋒', '差', 'chāi'], ['差得遠', '差得遠', 'chà de yuǎn'], ['差別很大', '差別', 'chā bié'],
    // 得: "must" only before a verb of going, saying or doing
    ['你得何罪', '得', 'dé'], ['我們得見青天了', '得', 'dé'], ['我得去', '得', 'děi'], ['他得叫人去', '得', 'děi'],
    // 教: "to let, to make" unless a lesson or a trick follows
    ['我教時遷去', '教', 'jiào'], ['我教你不要慌', '教', 'jiào'], ['我教你個法子', '教', 'jiāo'],
    ['又中一槍', '中', 'zhòng'], ['發兵以應之', '應', 'yìng'], ['深謝恩相抬舉', '相', 'xiàng'],
    ['正行間，忽見', '行間', 'xíng jiān'], ['大兵重重圍住', '重重', 'chóng chóng'], ['還我人來也', '還', 'huán'], ['畢四大天將進禮', '將', 'jiàng'],
    ['初更兵到', '更', 'gēng'], ['飲了數杯酒', '數', 'shù'], ['瑛淚灑相思地', '地', 'dì'], ['你站著作什麼', '著', 'zhe'], ['垂著手', '著', 'zhe'],
    ['量宋江有何德能', '量', 'liáng'], ['都來告假', '假', 'jià'],
    // fourth sample
    ['博弈調琴講道書', '調', 'tiáo'], ['只為金鈴難解識', '為', 'wèi'], ['天差列宿害生靈', '宿', 'xiù'],
    ['吾日三省吾身', '省', 'xǐng'], ['各省皆有', '省', 'shěng'], ['那菩薩才喝了一聲', '喝', 'hē'], ['大喝一聲', '喝', 'hè'], ['喝道', '喝道', 'hè dào'],
    ['於世路上好機變', '好', 'hào'], ['臨行密密縫', '縫', 'féng'], ['門縫裡看', '縫', 'fèng'], ['便勒住馬不敢近前', '勒', 'lè'], ['司馬師引兵', '司馬師', 'sī mǎ shī'],
    ['干甚么', '干', 'gàn'], ['去干什么', '干什么', 'gàn shén me'], ['晒干了衣服', '干', 'gān'], ['不干我事', '干', 'gān'], ['没干什么', '干什么', 'gàn shén me'], ['道长请坐', '长', 'zhǎng'], ['万夫长', '长', 'zhǎng'],
    ['下卷经', '卷', 'juàn'], ['不差', '差', 'chà'], ['转为', '转为', 'zhuǎn wéi'], ['拚死相救', '拚', 'pīn'], ['察合台', '察合台', 'chá hé tái'], ['重重叠叠的山', '重重叠叠', 'chóng chóng dié dié'],
    ['忽見一騎自北而來', '騎', 'jì'], ['他騎馬去', '騎馬', 'qí mǎ'], ['腰繫烏犀金鞓束帶', '繫', 'jì'], ['合個朱紅龕子盛了', '盛', 'chéng'], ['種出東西來', '種', 'zhòng'], ['你如今為求經', '為', 'wèi'],
    // 儿 is ér inside a transliterated name, r as the suffix of an ordinary word
    ['合撒儿说道', '儿', 'ér'], ['蒲儿帖', '儿', 'ér'], ['花儿开了', '花儿', 'huā r'], ['玩意儿', '玩意儿', 'wán yì r'],
    ['枯莎槎就', '莎', 'suō'], ['父沒觀其行', '沒', 'mò'], ['諕得那老者', '諕', 'xià'], ['舉鈀就築', '鈀', 'pá'], ['第七十八回', '第七十八', 'dì qī shí bā'],
    ['忽見十餘騎馬旗號翩翻', '騎馬', 'jì mǎ'], ['花容嬝娜', '娜', 'nuó'], ['罷咧', '咧', 'lie'], ['咧嘴笑', '咧嘴', 'liě zuǐ'], ['我教給你，記著', '教', 'jiāo'], ['而好作亂者', '好', 'hào'], ['講一兩章書', '一兩章', 'yì liǎng zhāng'],
    ['孫策把槍挑太史慈的小戟', '挑', 'tiǎo'], ['挑水去', '挑', 'tiāo'], ['入則孝，出則弟', '弟', 'tì'], ['兄弟二人', '弟', 'dì'], ['眾兵將得令', '得', 'dé'],
    ['切思伊父子不忍', '切', 'qiè'], ['玄德望公甚切', '切', 'qiè'], ['細細切絲', '切', 'qiē'],
  ];
  for (const [text, part, want] of cases) it(`${text}: ${part} = ${want}`, async () => expect(await py(text, part)).toBe(want));
});

describe('cedict-extra readings (re-cut where the old file split a run-together reading wrongly)', () => {
  const cases: [string, string][] = [
    ['寢宮', 'qǐn gōng'], ['三公', 'sān gōng'], ['不能', 'bù néng'], ['豈能', 'qǐ néng'], ['晚高峰', 'wǎn gāo fēng'], ['船歌', 'chuán gē'], ['反攻倒算', 'fǎn gōng dào suàn'],
  ];
  for (const [word, want] of cases) {
    it(`${word} = ${want}`, async () => {
      const d = await dictP;
      expect(d.pinyinFor(word).map(numberedToMarked).join(' ')).toBe(want);
    });
  }
  it('has no Hokkien word read with a Mandarin reading no character has (甚麼 shi2 wu4)', async () => {
    const d = await dictP;
    for (const e of d.lookup('甚麼')) expect(e.pinyin).not.toBe('shi2 wu4');
  });
});

describe('segmentation fixed after sampling the books', () => {
  const cuts: [string, string[]][] = [
    ['不知是個甚麼妖邪？', ['不知', '是', '個', '甚麼', '妖邪', '？']],
    ['我那時並不知道', ['我', '那時', '並不', '知道']],
    ['南無阿彌陀佛', ['南無阿彌陀佛']],
    ['王之渙', ['王之渙']],
    ['闰土在海边', ['闰土', '在', '海边']],
    // a year in digits is one token, not the dictionary's 九一八 (the Mukden Incident)
    ['（一九一八年四月。）', ['（', '一九一八', '年', '四月', '。', '）']],
    // 三十多年: the 多 goes with the number, not "many years" after it
    ['已是三十多年', ['已', '是', '三十', '多', '年']],
    ['多年來', ['多年', '來']],
    ['子曰：學而時習之', ['子曰', '：', '學', '而', '時', '習', '之']],
    ['劉使君來了', ['劉', '使君', '來', '了']],
    ['第七十八回', ['第七十八', '回']],
    ['第一百零八回', ['第一百零八', '回']],
    ['細作報上關來', ['細作', '報', '上', '關', '來']],
    // principal characters of the classics are one token each
    ['屋里面全是黑沉沉的', ['屋', '里面', '全', '是', '黑沉沉', '的']],
    ['黃蓋與周泰見曹操', ['黃蓋', '與', '周泰', '見', '曹操']],
    ['白勝和郭盛、呂方', ['白勝', '和', '郭盛', '、', '呂方']],
    ['焦大罵人', ['焦大', '罵人']],
    ['他用船來載去', ['他', '用', '船', '來', '載', '去']],
    ['但聞人語響', ['但', '聞', '人', '語', '響']],
    ['司馬師引兵五萬', ['司馬師', '引', '兵', '五', '萬']],
    ['三十多年才能輪到一回', ['三十', '多', '年', '才', '能', '輪', '到', '一', '回']],
    ['他有才能', ['他', '有', '才能']],
    ['現在應天府案下審理', ['現在', '應天府', '案', '下', '審理']],
  ];
  for (const [text, want] of cuts) {
    it(text, async () => {
      const d = await dictP;
      expect(segment(text, d).map((t) => t.text)).toEqual(want);
    });
  }
});

describe('the lead sense is the one a reader needs', () => {
  const lead = async (word: string, pinyin: string, around?: { prev?: string; next?: string }) => {
    const d = await dictP;
    return leadGloss(entriesForReading(d.lookup(word), [pinyin], word, around), word);
  };
  const cases: [string, string, RegExp][] = [
    ['在', 'zai4', /^at; in; on/], ['不', 'bu4', /^not; no/], ['就', 'jiu4', /^just; right away/], ['老', 'lao3', /^old; aged/],
    ['望', 'wang4', /^to look/], ['欲', 'yu4', /^to want/], ['乎', 'hu1', /final particle/], ['話', 'hua4', /^words; talk/],
    ['遂', 'sui4', /^thereupon/], ['所', 'suo3', /particle that puts a verb/], ['魏', 'wei4', /^Wei \(a state/], ['劉', 'liu2', /^Liu \(surname/],
    ['忽', 'hu1', /^suddenly/], ['穿', 'chuan1', /^to wear/], ['趙', 'zhao4', /^Zhao \(surname/], ['曹', 'cao2', /^Cao \(surname/],
    ['稱', 'cheng1', /^to call/], ['考', 'kao3', /^to test/], ['裝', 'zhuang1', /^to install/], ['索', 'suo3', /^rope/],
    ['蒙', 'meng2', /^to receive/], ['士', 'shi4', /^scholar/], ['閒', 'xian2', /^idle/], ['煙', 'yan1', /^smoke/],
    ['讎', 'chou2', /^enemy/], ['麻', 'ma2', /^hemp; flax/], ['並', 'bing4', /^\(before a negative/], ['對', 'dui4', /^to; towards/],
    ['因', 'yin1', /^because of/], ['且', 'qie3', /^for the time being/],
    ['輩', 'bei4', /^people of a kind/], ['語', 'yu3', /^words; speech/], ['訣', 'jue2', /^secret formula/], ['天', 'tian1', /^sky; heaven/],
    ['包裹', 'bao1 guo3', /^bundle/], ['伙計', 'huo3 ji5', /^shop assistant/], ['問道', 'wen4 dao4', /^to ask \(introducing/], ['禮', 'li3', /^rite/],
    ['袁', 'yuan2', /^Yuan \(surname/], ['教', 'jiao4', /^to let; to make/], ['番', 'fan1', /^classifier for occurrences/], ['勒', 'le4', /^to rein in/], ['爺', 'ye2', /^master/], ['陳', 'chen2', /^Chen \(surname/], ['新竹', 'xin1 zhu2', /^new bamboo/],
    ['部', 'bu4', /^classifier for books/], ['影', 'ying3', /^shadow/], ['一口', 'yi1 kou3', /^a mouthful/], ['允', 'yun3', /^to allow/], ['應', 'ying1', /^should/],
    ['員', 'yuan2', /^classifier for generals/], ['程', 'cheng2', /^journey/], ['方', 'fang1', /^only then/],
    ['大作', 'da4 zuo4', /^to break out/], ['靈山', 'ling2 shan1', /^Spirit Mountain/], ['唐', 'tang2', /^Tang \(the Tang dynasty/], ['學名', 'xue2 ming2', /^formal name/], ['幸', 'xing4', /^fortunate/],
    ['太', 'tai4', /^too; excessively/], ['頓', 'dun4', /^classifier for meals/], ['外道', 'wai4 dao4', /^heretics/],
    ['南山', 'nan2 shan1', /^the southern mountain/], ['衝', 'chong1', /^to charge/], ['郎', 'lang2', /^young man/], ['閨', 'gui1', /^women's chamber/], ['咧', 'lie5', /^\(sentence-final particle/],
    ['刺', 'ci4', /^to stab/], ['引', 'yin3', /^to lead/], ['計', 'ji4', /^plan; scheme/], ['奏', 'zou4', /^to report to the emperor/], ['漢', 'han4', /^the Han dynasty/],
    ['左右', 'zuo3 you4', /^attendants/], ['伏', 'fu2', /^to lie in ambush/], ['表', 'biao3', /^memorial/], ['縱', 'zong4', /^even if/], ['靈', 'ling2', /^spirit/], ['辭', 'ci2', /^to take leave/],
    ['圖', 'tu2', /^to plot/], ['討', 'tao3', /^to demand/], ['然', 'ran2', /^so; thus/], ['號', 'hao4', /^signal/], ['領', 'ling3', /^to lead/], ['帶', 'dai4', /^to bring/], ['照', 'zhao4', /^to shine/],
    ['陽', 'yang2', /^sun/], ['分付', 'fen1 fu4', /^to instruct/], ['縫', 'feng2', /^to sew/], ['氣', 'qi4', /^breath/], ['節', 'jie2', /^festival/], ['老娘', 'lao3 niang2', /^I \(said by a woman/], ['更', 'geng1', /^watch of the night/], ['嘗', 'chang2', /^to taste/], ['无人', 'wu2 ren2', /^nobody/],
    ['奉', 'feng4', /^to receive \(an order\)/], ['于', 'yu2', /^in; at; on/], ['伙', 'huo3', /^group; gang/],
    // a variant spelling says what it stands for
    ['偸', 'tou1', /^to steal/], ['喫', 'chi1', /^to eat/], ['牀', 'chuang2', /^bed/], ['愼', 'shen4', /^careful/], ['爲', 'wei2', /^as \(in the capacity|^to be|^to do/],
    // a pointer to a county or a city leads with what it points to
    ['荊州', 'jing1 zhou1', /^Jingzhou/], ['梁山', 'liang2 shan1', /\w/],
  ];
  for (const [word, reading, want] of cases) it(`${word} ${reading}: ${want}`, async () => expect(await lead(word, reading)).toMatch(want));

  it('對 alone or before a particle is "right", before a noun "to, towards"; 嘗 in the old novels is "once"', async () => {
    expect(await lead('對', 'dui4', { prev: '', next: '麼' })).toMatch(/^right/);
    expect(await lead('對', 'dui4', { prev: '你', next: '說' })).toMatch(/^to; towards/);
    expect(await lead('嘗', 'chang2', { prev: '', next: '聞' })).toMatch(/^once/);
    expect(await lead('尝', 'chang2', { prev: '', next: '一' })).toMatch(/^to taste/);
    expect(await lead('賺', 'zhuan4', { prev: '', next: '開' })).toMatch(/^to trick/);
    expect(await lead('赚', 'zhuan4', { prev: '', next: '钱' })).toMatch(/^to earn/);
    expect(await lead('槍', 'qiang1', { prev: '一', next: '刺' })).toMatch(/^spear/);
    expect(await lead('兩', 'liang3', { prev: '十', next: '銀子' })).toMatch(/^tael/);
    expect(await lead('兩', 'liang3', { prev: '', next: '個' })).toMatch(/^two/);
    expect(await lead('對', 'dui4', { prev: '', next: '呀' })).toMatch(/^right/);
  });

  it('之道 is "the way" (道 leads the novels with "to say" everywhere else)', async () => {
    expect(await lead('道', 'dao4', { prev: '之' })).toMatch(/^road|way/);
    expect(await lead('道', 'dao4', { prev: '行者' })).toMatch(/^to say/);
  });

  it('里 after a number is the unit of distance, after a noun it is "inside"', async () => {
    expect(await lead('里', 'li3', { prev: '二十' })).toMatch(/li, |measure of length/);
    expect(await lead('里', 'li3', { prev: '家' })).toMatch(/^in; inside|inside/);
  });
});
