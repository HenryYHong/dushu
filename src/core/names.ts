// Surnames and name readings for the lexicon (core/lexicon.ts). Simplified forms; callers fold traditional text first.

/** Common single-character surnames (the Hundred Family Surnames plus the ones novels lean on). */
export const SURNAMES: ReadonlySet<string> = new Set([...(
  '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦傅方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛曲翁冉骆蓝路辛靳管柴蒙鲍华喻祁蒲房滕屈饶解牟艾尤阳时穆农司卓古吉缪简车项连芦麦褚娄窦戚岑景党宫费卜冷晏席卫米柏宗瞿桂佟臧闵苟邬边卞姬师仇栾隋甄暴钮厉戎祖束幸韶郜蓟薄印宿怀邰鄂索咸籍赖蔺屠池阴郁胥苍闻莘贡劳逄扶堵宰雍璩桑濮寿扈冀浦别慕茹宦鱼慎戈庾居衡步弘匡寇禄阙殳沃蔚夔隆巩晁勾敖融訾阚那沙乜养鞠须丰巢蒯荆竺逯盖桓丘仲伊钭乌亢仉墨谯笪铁裘洪全南邵凤宣阎巴班仰牧郎巫郗卿丛燕'
)]);

export const COMPOUND_SURNAMES: ReadonlySet<string> = new Set([
  '欧阳', '司马', '诸葛', '上官', '慕容', '令狐', '东方', '公孙', '尉迟', '长孙', '宇文', '皇甫', '端木', '独孤', '完颜',
  '夏侯', '澹台', '公冶', '宗政', '濮阳', '淳于', '单于', '太叔', '申屠', '轩辕', '闻人', '南宫', '西门', '呼延', '百里',
  '东郭', '南门', '羊舌', '微生', '梁丘', '左丘', '司徒', '司空', '万俟', '耶律', '拓跋', '赫连', '谷梁', '乐正', '漆雕',
  '公羊', '鲜于', '钟离', '夹谷', '巫马', '颛孙', '第五', '仲孙', '叱干', '独狐', '贺兰', '纳兰', '段干', '归海', '亓官',
]);

/** Surnames read differently from the character's usual reading (numbered pinyin). */
export const SURNAME_READINGS: Readonly<Record<string, string>> = {
  单: 'shan4', 曾: 'zeng1', 解: 'xie4', 区: 'ou1', 朴: 'piao2', 仇: 'qiu2', 查: 'zha1', 盖: 'ge3', 乐: 'yue4',
  华: 'hua4', 任: 'ren2', 缪: 'miao4', 翟: 'zhai2', 秘: 'bi4', 召: 'shao4', 种: 'chong2', 覃: 'qin2', 繁: 'po2',
  员: 'yun2', 那: 'na1', 谌: 'chen2', 黑: 'he4', 过: 'guo1', 褚: 'chu3', 殷: 'yin1', 宓: 'fu2',
  牟: 'mou4', 洗: 'xian3', 蕃: 'pi2', 郇: 'huan2', 郏: 'jia2', 句: 'gou1', 能: 'nai4', 乜: 'nie4', 阚: 'kan4',
  燕: 'yan1', // 燕青 燕顺: the surname is Yān (the swallow is yàn)
  宁: 'ning4', // 宁采臣: the surname is Nìng
  沈: 'shen3', // 沈从文: the surname is Shěn (沈 chén is an old form of 沉)
  薄: 'bo2', // 薄太后, 薄一波: the surname is Bó (báo is "thin")
};

export const COMPOUND_SURNAME_READINGS: Readonly<Record<string, string>> = {
  尉迟: 'yu4 chi2', 万俟: 'mo4 qi2', 长孙: 'zhang3 sun1', 单于: 'chan2 yu2', 澹台: 'tan2 tai2', 皇甫: 'huang2 fu3',
  令狐: 'ling2 hu2', 钟离: 'zhong1 li2', 夏侯: 'xia4 hou2', 东方: 'dong1 fang1', 呼延: 'hu1 yan2', 宇文: 'yu3 wen2',
  慕容: 'mu4 rong2', 贺兰: 'he4 lan2', 欧阳: 'ou1 yang2', 诸葛: 'zhu1 ge3', 上官: 'shang4 guan1', 司马: 'si1 ma3',
  公孙: 'gong1 sun1', 端木: 'duan1 mu4', 独孤: 'du2 gu1', 完颜: 'wan2 yan2', 淳于: 'chun2 yu2', 仲孙: 'zhong4 sun1',
  叱干: 'chi4 gan4', 鲜于: 'xian1 yu2', 乐正: 'yue4 zheng4', 濮阳: 'pu2 yang2', 太叔: 'tai4 shu1', 轩辕: 'xuan1 yuan2',
  闻人: 'wen2 ren2', 巫马: 'wu1 ma3', 耶律: 'ye4 lü4', 拓跋: 'tuo4 ba2', 赫连: 'he4 lian2', 公冶: 'gong1 ye3', 第五: 'di4 wu3',
};

/** Characters read differently inside a given name from what a plain lookup says (numbered pinyin). */
export const NAME_CHAR_READINGS: Readonly<Record<string, string>> = {
  处: 'chu3', // 丘处机, 王处一
  儿: 'er2', // 平儿, 蓉儿: a full syllable in a name, not the erhua suffix
  乐: 'le4',
  曾: 'zeng1',
  裳: 'chang2', // 黄裳
  发: 'fa1', // 王金发: "prosper", not 金发 "blond hair"
  兴: 'xing1', // 程日兴, 张振兴
  冠: 'guan4', // 乔冠华, 吴冠中: "foremost"
  都: 'du1', // 张都监, 老都管: never the adverb dōu inside a name
  乾: 'qian2', // 孫乾: looked up by the character as written (it folds to 干, which is gàn in 蒋干)
  少: 'shao4', // 李少春, 少林寺: "young", not shǎo "few"
  // Names the name list joins, read wrong by the plain lookup (CPP, Wikipedia sentences): 严隽琪, 朱隽 (jùn, not 隽永 juàn);
  // 裨治文 (pí); 马加什, 什坊街 (shí, not 什么); 黎刹, 罗刹 (chà); 茆圩乡 (máo).
  隽: 'jun4',
  裨: 'pi2',
  什: 'shi2',
  刹: 'cha4',
  茆: 'mao2',
};

/** Characters a given name reads apart from their usual reading, in a person's name only (陈蕃 Fān; 孛儿只斤, 孛要合 Bó). */
export const PERSON_CHAR_READINGS: Readonly<Record<string, string>> = { 蕃: 'fan2', 孛: 'bo2' };

/** Given names that read as a whole apart from their characters (郦食其 Yìjī, 金日磾 Mìdī, 金兀术 Wùzhú, 司马相如 Xiàngrú). */
export const NAME_PIECE_READINGS: Readonly<Record<string, string>> = {
  食其: 'yi4 ji1', 日磾: 'mi4 di1', 日䃅: 'mi4 di1', 兀术: 'wu4 zhu2', 相如: 'xiang4 ru2',
};

/**
 * The lunar mansions in the shape mansion + one of the seven luminaries + animal (斗木獬, 参水猿, 角木蛟): the mansions read
 * here are 斗 dǒu (the Dipper, not dòu "to fight") and 参 shēn.
 */
export const MANSION_READINGS: Readonly<Record<string, string>> = { 斗: 'dou3', 参: 'shen1' };
export const LUMINARIES: ReadonlySet<string> = new Set([...'日月火水木金土']);

/** Colors before 发 in a name: hair (赤发鬼, 白发魔女 fà). 金 is not one: 王金发 is "prosper" (fā). */
export const HAIR_COLORS: ReadonlySet<string> = new Set([...'赤红白黑青银乌紫']);

/**
 * Characters of transliterated foreign names, both scripts (拉希姆, 贝莱赫斯特, 奎登·德拉尔, 施特茨纳). A string made only of these
 * that is never seen apart is a foreign name rather than a phrase; core/segment.ts keeps a narrower list for its ·-join.
 */
export const TRANSLIT_CHARS: ReadonlySet<string> = new Set([...(
  '阿埃艾爱愛安昂奥奧澳巴拜班邦保鲍鮑贝貝本比彼毕畢波伯博布查察楚达達戴黛丹德登迪蒂丁东東杜顿頓多厄鄂恩尔爾法菲费費芬丰豐弗伏夫福'
  + '盖蓋冈岡高戈哥格葛根贡貢古圭哈海汉漢豪赫亨胡华華霍基吉加伽贾賈杰傑捷金喀卡凯凱坎考柯科可克肯寇库庫夸奎昆阔闊拉莱萊赖賴兰蘭朗劳勞'
  + '勒雷蕾黎里理利莉丽麗廉列林琳留卢盧鲁魯伦倫罗羅洛玛瑪马馬迈邁麦麥曼梅门門蒙米密敏缪繆摩莫墨默姆穆纳納娜奈南内內尼妮涅宁寧纽紐努诺諾'
  + '欧歐帕派潘佩彭皮珀普齐齊奇契恰乔喬琼瓊丘萨薩塞赛賽桑瑟森沙莎绍紹舍什史斯丝絲松苏蘇索塔泰坦汤湯唐特提廷汀图圖托瓦旺威韦韋维維'
  + '温溫文沃乌烏西希锡錫夏谢謝辛休修雅亚亞扬揚耶伊依因英尤约約赞贊泽澤扎詹兹茲佐若撒勉采娃宾賓季诃訶瑞台勃热熱娅婭茨孜赫茹嘉包甘'
)]);

/** In a name with no Chinese surname (a transliterated Mongol or Jurchen name), 术 is zhú; after a surname (袁术) it stays shù. */
export const TRANSLITERATION_READINGS: Readonly<Record<string, string>> = { 术: 'zhu2' };

/** A doubled kinship word at the end of a name is neutral (靖哥哥, 小姑姑); a doubled given name is not (李师师). */
export const KIN_CHARS: ReadonlySet<string> = new Set([...'哥姐妹弟爷奶姑叔伯舅婶娘爹妈婆公嫂姨姥嬷兄侄姊']);

/** Offices that end in 长 are zhǎng (连长, 支队长 after a surname); 云长 and 天长 keep cháng. */
export const HEAD_BEFORE_ZHANG: ReadonlySet<string> = new Set([...'队务连排班营团旅师军部局科处站所社院校县市省乡村厂组舰船']);

/**
 * Chinese era names (年号) that the dictionary lacks, simplified as dict.toSimplified folds them (乾亨 is 干亨 here): 泰常, 太平真君,
 * 天保. From Wikidata's items for era names (CC0), 2 and 4 characters; core/lexicon.ts reads one before a year (泰常八年).
 */
export const ERA_NAMES: ReadonlySet<string> = new Set((
  '万利 万岁登封 万岁通天 上愿 上明 上治 久视 义兴 义宁 义熙 五凤 交泰 人庆 仪凤 保大 保天 保立 元丰 元亨 元光 元兴 元凤 元初 元嘉 元始 元寿 元封 元平 元康 元延 ' +
  '元德 元徽 元朔 元熙 元狩 元玺 元祐 元符 元统 元象 元贞 元鼎 光兴 光初 光启 光天 光始 光宅 光定 光寿 光熙 光熹 全义 兴元 兴光 兴圣 兴定 兴武 凤历 初元 ' +
  '初历 利贞 前元 化顺 升元 升明 同光 后元 启历 咸和 咸平 咸康 咸清 咸熙 咸通 咸雍 唐隆 嗣圣 嘉宁 嘉平 嘉泰 嘉熙 嘉祐 圣历 圣武 地节 垂拱 大中祥符 大历 大康 ' +
  '天仪治平 天会 天保 天兴 天册 天册万岁 天凤 天历 天喜 天嘉 天圣 天复 天安礼定 天寿 天应 天康 天建 天开 天德 天授 天政 天显 天正 天泰 天玺 天盛 天眷 天祐 天祐垂圣 天祐民安 ' +
  '天祚 天福 天禧 天纪 天纵 天绣 天赞 天辅 天造 天齐 太兴 太初元将 太始 太宁 太安 太平真君 太延 太建 太昌 太清 太熙 太缘 奲都 始光 始平 孝基 孝建 孝治 宁康 安和 ' +
  '宝义 宝元 宝历 宝大 宝正 宝祐 宝胜 宝鼎 宣和 宣政 尊圣 居摄 崇宁 崇福 嵯耶 干亨 干兴 干化 干和 干宁 干定 干封 干德 干明 干祐 干符 干统 干贞 广政 广明 ' +
  '广运 广顺 庆历 应历 应干 应道 应顺 延光 延兴 延初 延和 延嗣宁国 延康 延昌 延熙 延熹 延载 建世 建中 建中靖国 建义 建元 建光 建兴 建初 建和 建弘 建明 建昭 建极 ' +
  '建武 建武中元 建熙 建福 建衡 建隆 开兴 开宝 开庆 开成 开泰 开禧 开耀 开运 弘始 弘昌 彝泰 征和 得圣 德胜 总章 承光 承和 承圣 承安 承明 承玄 拱化 收国 文兴 ' +
  '文经 昌武 明启 明应 明政 明昌 明道 昭宁 昭武 显庆 显德 显道 晏平 晏朝 普泰 景云 景元 景初 景和 景定 景平 景明 景炎 景瑞 景祐 景福 景耀 景龙 更兴 曹睿 ' +
  '正元 正光 正始 正平 正隆 武成 武泰 永元 永光 永凤 永初 永始 永建 永弘 永憙 永明 永汉 永淳 永熙 永贞 汉兴 汉复 汉安 汉昌 河平 河清 河瑞 泰始 泰定 泰常 ' +
  '泰豫 洪化 洪德 淳熙 淳祐 添元 清宁 清泰 炎兴 熙宁 熙平 熹平 燕元 燕兴 燕平 玄始 玄静 玉恒 王霸 登国 白雀 白龙 皇兴 皇初 皇始 皇庆 皇建 皇武 皇泰 皇祐 ' +
  '皇统 真兴 真王 神册 神凤 神历 神嘉 神爵 神玺 神瑞 神鼎 神龟 祥兴 祯明 福圣承道 秦兴 竟宁 章和 章武 端平 端拱 绍圣 绍定 绍汉 绍泰 绍熙 统和 续兴 缘禾 胜光 ' +
  '至元 至和 至大 至宁 至治 至道 至顺 致和 见龙 证圣 调露 贞元 贞明 贞祐 赤符 载初 进通 通志 通文 通正 道隆 重兴 重和 重德 重熙 金统 长庆 阜昌 阳嘉 隆兴 ' +
  '隆和 雍宁 雍熙 鸿嘉 麟嘉 麟德 黄初 黄武 龙兴 龙升 龙启 龙德 龙朔 龙纪 '
).split(' ').filter(Boolean));

// ------------------------------------------------------------- display ---

/** A place in the family (老三, 小乙: numerals and the stems 甲乙丙丁). */
const BIRTH_ORDER = new Set([...'一二三四五六七八九十甲乙丙丁大']);

/** Endings that make a place name two words: 桃花岛 is Táohuā Dǎo, 归云庄 is Guīyún Zhuāng, 净衣派 is Jìngyī Pài. */
const PLACE_GENERIC = new Set([...'岛山庄寺城府村镇峰谷关江河湖海岭洞殿堡宫楼阁庙塔桥坡寨营州县国派帮教门会宗亭郡院庵观觀湾沟屯坪']);

/**
 * How the syllables of a name or place are grouped when written with capitals: Guō Jìng, Hán Xiǎoyíng, Ōuyáng Wújì,
 * Táohuā Dǎo. Returns the size of each group in syllables (they add up to the number of characters), or null when the
 * word is not a name or a place. `fold` turns traditional text into simplified before the surname lookup.
 */
export function pinyinGroups(word: string, kind: string | undefined, fold: (s: string) => string = (s) => s): number[] | null {
  const orig = [...word];
  const simp = [...fold(word)];
  const n = orig.length;
  if (n === 0 || simp.length !== n) return null;
  if (kind === 'place') {
    return n >= 2 && PLACE_GENERIC.has(simp[n - 1]) ? [n - 1, 1] : [n];
  }
  if (kind !== 'name') return null;
  if (n === 1) return [1];
  // 老张, 小乙, 阿长: 老 and 小 before a surname or a place in the family, and 阿 before a name, are written apart (GB/T 16159:
  // Lǎo Zhāng, Xiǎo Yǐ, Ā Cháng). (小红 is a given name, Xiǎohóng; 阿里 a transliteration, Ālǐ.)
  if (n === 2 && (((simp[0] === '老' || simp[0] === '小') && (SURNAMES.has(simp[1]) || BIRTH_ORDER.has(simp[1])))
    || (simp[0] === '阿' && !TRANSLIT_CHARS.has(simp[1])))) return [1, 1];
  if (n >= 3 && COMPOUND_SURNAMES.has(simp[0] + simp[1])) return [2, n - 2];
  if (n <= 4 && SURNAMES.has(simp[0])) return [1, n - 1];
  // 老顽童, 小红马: the prefix is a word of its own.
  if (n >= 3 && (simp[0] === '老' || simp[0] === '小')) return [1, n - 1];
  return [n];
}

/**
 * Pinyin of a name or place with capitals the way an English reader expects it: "Guō Jìng", "Táohuā Dǎo". The
 * syllables are already formatted (tone marks or numbers); characters of a name are joined inside a group and groups are
 * separated by a space. A term (a technique, a book) and a user word stay lowercase, and so does anything in zhuyin.
 */
export function capitalizePinyin(
  syllables: readonly string[],
  kind: string | undefined,
  word = '',
  fold?: (s: string) => string,
): string {
  const syl = syllables.filter(Boolean);
  const plain = syl.join(' ');
  if (kind !== 'name' && kind !== 'place') return plain;
  if (syl.some((s) => !/^[A-Za-zÀ-ž\u0100-\u024f\u1e00-\u1eff]/.test(s))) return plain; // zhuyin or anything not Latin
  const groups = pinyinGroups(word, kind, fold);
  const sizes = groups && groups.reduce((a, b) => a + b, 0) === syl.length ? groups : syl.map(() => 1);
  const out: string[] = [];
  let at = 0;
  for (const size of sizes) {
    const part = joinSyllables(syl.slice(at, at + size));
    at += size;
    out.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  return out.join(' ');
}

/** A syllable that starts with a, o or e after another one in the same word needs an apostrophe: Píng'ér, Xī'ān. */
export function needsApostrophe(syllable: string): boolean {
  return /^[aoe]/i.test(syllable.normalize('NFD').charAt(0));
}

/** Syllables written as one word, with the apostrophes pinyin asks for. */
export function joinSyllables(syllables: readonly string[]): string {
  return syllables.map((s, i) => (i > 0 && needsApostrophe(s) ? "'" + s : s)).join('');
}

/**
 * CC-CEDICT writes a proper noun with a capital at the start of each of its words ("Cao2 Cao1", "Zhu1 ge3 Liang4", "Bei3
 * jing1"). When the reading on screen is that of a proper-noun row, and no ordinary row has the same reading, the sizes of its
 * groups follow the capitals: Cáo Cāo, Zhūgě Liàng, Běijīng. Null for anything else (a common word, a reading no row has).
 */
export function properGroups(entries: readonly { pinyin: string }[], syllables: readonly string[]): number[] | null {
  const norm = (p: string) => p.toLowerCase().replace(/u:/g, 'ü').replace(/\s+/g, ' ').trim();
  const want = norm(syllables.filter(Boolean).join(' '));
  if (!want) return null;
  const same = entries.filter((e) => norm(e.pinyin) === want);
  if (!same.length || same.some((e) => !/^[A-ZÜ]/.test(e.pinyin.trim()))) return null;
  const sizes: number[] = [];
  for (const syl of same[0].pinyin.trim().split(/\s+/)) {
    if (/^[A-ZÜ]/.test(syl) || !sizes.length) sizes.push(1);
    else sizes[sizes.length - 1]++;
  }
  return sizes;
}
