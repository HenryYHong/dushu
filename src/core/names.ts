// Surnames and name readings for the lexicon (core/lexicon.ts). Simplified forms; callers fold traditional text first.

/** Common single-character surnames (the Hundred Family Surnames plus the ones novels lean on). */
export const SURNAMES: ReadonlySet<string> = new Set([...(
  '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦傅方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛曲翁冉骆蓝路辛靳管柴蒙鲍华喻祁蒲房滕屈饶解牟艾尤阳时穆农司卓古吉缪简车项连芦麦褚娄窦戚岑景党宫费卜冷晏席卫米柏宗瞿桂佟臧闵苟邬边卞姬师仇栾隋甄暴钮厉戎祖束幸韶郜蓟薄印宿怀邰鄂索咸籍赖蔺屠池阴郁胥苍闻莘贡劳逄扶堵宰雍璩桑濮寿扈冀浦别慕茹宦鱼慎戈庾居衡步弘匡寇禄阙殳沃蔚夔隆巩晁勾敖融訾阚那沙乜养鞠须丰巢蒯荆竺逯盖桓丘仲伊钭乌亢仉墨谯笪铁裘洪全南邵凤宣阎巴班仰牧郎巫郗卿丛'
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
};

// ------------------------------------------------------------- display ---

/** Endings that make a place name two words: 桃花岛 is Táohuā Dǎo, 归云庄 is Guīyún Zhuāng, 净衣派 is Jìngyī Pài. */
const PLACE_GENERIC = new Set([...'岛山庄寺城府村镇峰谷关江河湖海岭洞殿堡宫楼阁庙塔桥坡寨营州县国派帮教门会宗亭郡院庵观觀']);

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
