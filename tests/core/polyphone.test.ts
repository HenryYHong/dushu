import { describe, expect, it } from 'vitest';
import { WORD_READINGS, POLYPHONE_CHARS } from '../../src/core/polyphone';
import { formatPinyin } from '../../src/core/pinyin';
import { segment } from '../../src/core/segment';
import { isHanCodePoint } from '../../src/core/text';
import type { Dictionary } from '../../src/types';
import { loadTestDictionary, readRows } from '../helpers/data';

const dictP = loadTestDictionary();

/**
 * Segment `text` and return the pinyin (numbered, space-joined) of the code points of the first occurrence of `part`,
 * whatever way the segmenter cut around it.
 */
async function inSentence(text: string, part: string): Promise<string> {
  const d = await dictP;
  const at = text.indexOf(part);
  if (at < 0) throw new Error(`"${part}" is not in "${text}"`);
  const out: string[] = [];
  for (const t of segment(text, d)) {
    if (t.kind !== 'han') continue;
    let off = t.start;
    [...t.text].forEach((ch, i) => {
      if (off >= at && off < at + part.length) out.push(t.pinyin![i]);
      off += ch.length;
    });
  }
  return out.join(' ');
}

describe('polyphones in context (end to end through segment)', () => {
  const cases: [string, string, string, string][] = [
    // sentence, token, expected numbered pinyin, why
    ['我吃了饭', '了', 'le5', '了 after a verb is le'],
    ['我吃了饭', '吃', 'chi1', ''],
    ['我不了解他', '了解', 'liao3 jie3', '了解 comes from CEDICT'],
    ['他慢慢地走了过来。', '地', 'de5', '慢慢地: adverb marker'],
    ['他慢慢地走了过来。', '了', 'le5', ''],
    ['他们更多地了解了我。', '地', 'de5', 'single-character adverb before a verb'],
    ['我告诉他这件事。', '告诉', 'gao4 su5', '告诉 = to tell, not to press charges'],
    ['这个故事很长。', '故事', 'gu4 shi5', ''],
    ['这是什么结果？', '结果', 'jie2 guo3', 'outcome, not to bear fruit'],
    ['这是一片土地。', '土地', 'tu3 di4', '土地 is a word'],
    ['我们在银行门口见面。', '银行', 'yin2 hang2', ''],
    ['他喜欢行走在山间。', '行走', 'xing2 zou3', ''],
    ['孩子长大了。', '长大', 'zhang3 da4', ''],
    ['这条路很长。', '长', 'chang2', '很长'],
    ['别着急。', '着急', 'zhao2 ji2', ''],
    ['他看着我。', '着', 'zhe5', '看着'],
    ['他得到了奖励。', '得到', 'de2 dao4', ''],
    ['他跑得快。', '得', 'de5', '跑得快'],
    ['你喜欢茶还是咖啡？', '还是', 'hai2 shi5', ''],
    ['我要还书。', '还', 'huan2', '还书'],
    ['他们都是学生。', '都', 'dou1', ''],
    ['北京是中国的首都。', '首都', 'shou3 du1', ''],
    // traditional
    ['我們在銀行門口見面。', '銀行', 'yin2 hang2', ''],
    ['孩子長大了。', '長大', 'zhang3 da4', ''],
    ['這條路很長。', '長', 'chang2', ''],
    ['他慢慢地走了過來。', '地', 'de5', ''],
    ['我要還書。', '還', 'huan2', ''],
    ['別著急。', '著急', 'zhao2 ji2', ''],
    ['他看著我。', '著', 'zhe5', ''],
    // more of the same
    ['我吃不了这么多。', '不了', 'bu5 liao3', '吃不了: potential complement, bu is neutral'],
    ['他睡着了。', '睡着', 'shui4 zhao2', ''],
    ['我睡不着。', '着', 'zhao2', ''],
    ['我得去了。', '得', 'dei3', 'must'],
    ['她高兴地笑了。', '地', 'de5', ''],
    ['他在地上坐着。', '地上', 'di4 shang5', ''],
    ['这是我的书。', '的', 'de5', ''],
    ['他一边走一边说。', '说', 'shuo1', ''],
    ['为了你，我愿意。', '为了', 'wei4 le5', ''],
    ['他为人正直。', '为', 'wei2', '为人'],
    ['我为你高兴。', '为', 'wei4', 'for'],
    ['他成为了医生。', '成为', 'cheng2 wei2', ''],
    ['这个孩子爱睡觉。', '睡觉', 'shui4 jiao4', ''],
    ['我觉得很好。', '觉得', 'jue2 de5', ''],
    ['一只猫坐在桌子上。', '只', 'zhi1', 'measure word'],
    ['我只有一个。', '只有', 'zhi3 you3', ''],
    ['种树要在春天。', '种树', 'zhong4 shu4', '种树 is a word'],
    ['这种树很高。', '这种', 'zhe4 zhong3', '这种'],
    ['他中奖了。', '中奖', 'zhong4 jiang3', '中奖'],
    ['我们中国人。', '中国', 'zhong1 guo2', ''],
    ['这个地方很好。', '地方', 'di4 fang5', ''],
    ['他是大夫。', '大夫', 'dai4 fu5', ''],
    ['这东西很便宜。', '便宜', 'pian2 yi5', ''],
    ['这东西很便宜。', '东西', 'dong1 xi5', ''],
    ['他有重要的事。', '重要', 'zhong4 yao4', ''],
    ['请重新开始。', '重新', 'chong2 xin1', ''],
    ['他很快乐。', '快乐', 'kuai4 le4', ''],
    ['我爱听音乐。', '音乐', 'yin1 yue4', ''],
    ['他数了数钱。', '数', 'shu3', '数了数'],
    ['他学习数学。', '数学', 'shu4 xue2', ''],
    ['我的朋友来了。', '朋友', 'peng2 you5', ''],
    ['我们的老师', '老师', 'lao3 shi1', ''],
    ['女儿很可爱。', '女儿', 'nü3 er2', ''],
    ['他在玩儿。', '玩儿', 'wan2 r5', ''],
    ['他在花园里种花儿。', '花儿', 'hua1 r5', 'the flower with the suffix; CEDICT lists the Gansu folk song (hua1 er2) first'],
  ];
  for (const [text, word, expected, why] of cases) {
    it(`${text}: ${word} = ${expected}${why ? ' (' + why + ')' : ''}`, async () => {
      expect(await inSentence(text, word)).toBe(expected);
    });
  }
});

describe('explicit context rules (pinyinFor with prev/next)', () => {
  type C = [string, { prev?: string; next?: string; after?: string }, string | undefined];
  const rules: C[] = [
    // 了
    ['了', {}, 'le5'], ['了', { prev: '吃', next: '饭' }, 'le5'], ['了', { prev: '不' }, 'liao3'],
    ['了', { prev: '受得', next: '。' }, 'liao3'], ['了', { prev: '得', next: '病' }, 'le5'],
    // 的
    ['的', {}, 'de5'], ['的', { prev: '我', next: '书' }, 'de5'],
    // 着
    ['着', { prev: '睡', next: '了' }, 'zhao2'], ['着', { prev: '睡不' }, 'zhao2'], ['着', { prev: '猜', next: '。' }, 'zhao2'],
    ['着', { prev: '看', next: '书' }, 'zhe5'], ['着', { prev: '走', next: '，' }, 'zhe5'], ['着', {}, 'zhe5'],
    // 得
    ['得', { prev: '跑', next: '快' }, 'de5'], ['得', { prev: '我', next: '去' }, 'dei3'], ['得', { next: '知' }, 'de2'],
    ['得', { prev: '他', next: '很' }, 'de5'], ['得', { prev: '，', next: '到' }, 'de2'],
    // 地
    ['地', { prev: '慢慢', next: '走' }, 'de5'], ['地', { prev: '高兴', next: '说' }, 'de5'], ['地', { prev: '在', next: '上' }, 'di4'],
    ['地', { prev: '土' }, 'di4'], ['地', { prev: '的' }, 'di4'], ['地', { prev: '美丽', next: '上' }, 'di4'], ['地', { prev: '，', next: '下' }, 'di4'],
    ['地', {}, 'di4'],
    // 还 都
    ['还', { next: '书' }, 'huan2'], ['还', { next: '钱' }, 'huan2'], ['还', { next: '给' }, 'huan2'], ['还', { next: '有' }, 'hai2'], ['还', { next: '是' }, 'hai2'],
    ['都', { prev: '首' }, 'du1'], ['都', { prev: '古' }, 'du1'], ['都', { prev: '我们' }, 'dou1'], ['都', {}, 'dou1'],
    // 行 长 重
    ['行', { prev: '银' }, 'hang2'], ['行', { next: '业' }, 'hang2'], ['行', { prev: '飞' }, 'xing2'], ['行', { prev: '不' }, 'xing2'],
    ['长', { prev: '生' }, 'zhang3'], ['长', { next: '大' }, 'zhang3'], ['长', { prev: '很' }, 'chang2'], ['长', { prev: '最' }, 'chang2'],
    ['长', { prev: '他', next: '得' }, 'zhang3'], ['长', { prev: '太', next: '大' }, 'chang2'], ['长', {}, 'chang2'],
    ['重', { next: '新' }, 'chong2'], ['重', { next: '要' }, 'zhong4'], ['重', { next: '复' }, 'chong2'],
    // 为 觉
    ['为', { prev: '因' }, 'wei4'], ['为', { prev: '成' }, 'wei2'], ['为', { next: '你' }, 'wei4'], ['为', { next: '人' }, 'wei2'], ['为', { prev: '称' }, 'wei2'], ['为', { next: '人民' }, 'wei4'],
    ['觉', { prev: '睡' }, 'jiao4'], ['觉', { prev: '感' }, 'jue2'], ['觉', { prev: '午' }, 'jiao4'],
    // 好 少 种 中 看 相 应 空 分 便 传
    ['好', { next: '学' }, 'hao4'], ['好', { next: '吃' }, 'hao3'], ['好', {}, 'hao3'], ['好', { next: '学生' }, 'hao3'],
    ['少', { prev: '多' }, 'shao3'], ['少', { next: '年' }, 'shao4'], ['少', { prev: '很' }, 'shao3'], ['少', { prev: '多', next: '年' }, 'shao3'],
    ['种', { next: '树' }, 'zhong4'], ['种', { prev: '这', next: '树' }, 'zhong3'], ['种', { prev: '一' }, 'zhong3'],
    ['中', { prev: '看' }, 'zhong4'], ['中', { next: '奖' }, 'zhong4'], ['中', { prev: '其' }, 'zhong1'], ['中', { prev: '，', next: '国' }, 'zhong1'],
    ['看', { next: '守' }, 'kan1'], ['看', { next: '书' }, 'kan4'],
    ['相', { prev: '照' }, 'xiang4'], ['相', { next: '貌' }, 'xiang4'], ['相', { next: '信' }, 'xiang1'],
    ['应', { next: '付' }, 'ying4'], ['应', { next: '该' }, 'ying1'],
    ['空', { prev: '有' }, 'kong4'], ['空', { next: '白' }, 'kong4'], ['空', { next: '气' }, 'kong1'],
    ['分', { prev: '成' }, 'fen4'], ['分', { next: '内' }, 'fen4'], ['分', { prev: '十', next: '钟' }, 'fen1'],
    ['便', { next: '宜' }, 'pian2'], ['便', { next: '利' }, 'bian4'],
    ['传', { next: '记' }, 'zhuan4'], ['传', { prev: '自' }, 'zhuan4'], ['传', { next: '说' }, 'chuan2'],
    // the rest
    ['数', { next: '一' }, 'shu3'], ['数', { prev: '一' }, 'shu3'], ['数', { next: '学' }, 'shu4'],
    ['乐', { next: '器' }, 'yue4'], ['乐', { prev: '音' }, 'yue4'], ['乐', { prev: '快' }, 'le4'],
    ['干', { next: '活' }, 'gan4'], ['干', { prev: '能' }, 'gan4'], ['干', { next: '净' }, 'gan1'],
    ['假', { prev: '请' }, 'jia4'], ['假', { next: '期' }, 'jia4'], ['假', { next: '装' }, 'jia3'],
    ['倒', { next: '水' }, 'dao4'], ['倒', { next: '霉' }, 'dao3'],
    ['调', { next: '整' }, 'tiao2'], ['调', { next: '查' }, 'diao4'],
    ['薄', { next: '弱' }, 'bo2'], ['薄', { next: '荷' }, 'bo4'], ['薄', { next: '纸' }, 'bao2'],
    ['角', { next: '色' }, 'jue2'], ['角', { prev: '主' }, 'jue2'], ['角', { prev: '三' }, 'jiao3'],
    ['处', { next: '理' }, 'chu3'], ['处', { prev: '到' }, 'chu4'],
    ['只', { prev: '一' }, 'zhi1'], ['只', { prev: '两' }, 'zhi1'], ['只', { next: '有' }, 'zhi3'], ['只', { prev: '1' }, 'zhi1'], ['只', {}, 'zhi3'],
    ['发', { prev: '头' }, 'fa4'], ['发', { next: '现' }, 'fa1'],
    ['率', { next: '领' }, 'shuai4'], ['率', { prev: '效' }, 'lü4'],
    ['量', { next: '体' }, 'liang2'], ['量', { prev: '数' }, 'liang4'],
    ['曲', { prev: '歌' }, 'qu3'], ['曲', {}, 'qu1'],
    ['模', { next: '样' }, 'mu2'], ['模', { next: '型' }, 'mo2'],
    ['会', { next: '计' }, 'kuai4'], ['会', { next: '议' }, 'hui4'],
    ['难', { next: '民' }, 'nan4'], ['难', { prev: '灾' }, 'nan4'], ['难', { next: '道' }, 'nan2'],
    ['将', { next: '士' }, 'jiang4'], ['将', { prev: '大' }, 'jiang4'], ['将', { next: '军' }, 'jiang1'], ['将', { prev: '大', next: '军' }, 'jiang1'],
    ['间', { next: '谍' }, 'jian4'], ['间', { prev: '中' }, 'jian1'],
    ['当', { next: '作' }, 'dang4'], ['当', { next: '时' }, 'dang1'], ['当', { prev: '适' }, 'dang4'],
    ['几', { next: '乎' }, 'ji1'], ['几', { next: '个' }, 'ji3'],
    ['恶', { prev: '可' }, 'wu4'], ['恶', {}, 'e4'],
    ['供', { next: '品' }, 'gong4'], ['供', { next: '应' }, 'gong1'],
    ['弹', { prev: '子' }, 'dan4'], ['弹', { next: '琴' }, 'tan2'],
    ['降', { next: '服' }, 'xiang2'], ['降', { next: '价' }, 'jiang4'],
    ['切', { prev: '一' }, 'qie4'], ['切', { next: '菜' }, 'qie1'],
    ['朝', { next: '气' }, 'zhao1'], ['朝', { next: '阳' }, 'chao2'],
    ['载', { prev: '记' }, 'zai3'], ['载', { prev: '下' }, 'zai4'],
    ['冠', { next: '军' }, 'guan4'], ['冠', {}, 'guan1'],
    ['兴', { prev: '高' }, 'xing4'], ['兴', { next: '趣' }, 'xing4'], ['兴', { next: '奋' }, 'xing1'],
    ['教', { prev: '我', next: '书' }, 'jiao1'], ['教', { prev: '老师', next: '学生' }, 'jiao1'], ['教', { prev: '宗', next: '义' }, 'jiao4'], ['教', { next: '育' }, 'jiao4'],
    ['晕', { next: '车' }, 'yun4'], ['晕', { prev: '头' }, 'yun1'],
    ['卷', { prev: '试' }, 'juan4'], ['卷', { next: '起' }, 'juan3'],
    ['创', { next: '伤' }, 'chuang1'], ['创', { next: '作' }, 'chuang4'],
    ['横', { prev: '蛮' }, 'heng4'], ['横', { next: '行' }, 'heng2'],
    ['磨', { next: '坊' }, 'mo4'], ['磨', { next: '练' }, 'mo2'],
    ['宿', { prev: '一' }, 'xiu3'], ['宿', { next: '舍' }, 'su4'],
    ['儿', { prev: '花' }, 'r5'], ['儿', {}, 'er2'], ['儿', { prev: '，' }, 'er2'], ['儿', { next: '子' }, 'er2'],
    // 倒: the adverb (dào) is the common use in dialogue; falling over stays dǎo
    ['倒', { next: '也' }, 'dao4'], ['倒', { prev: '他', next: '不' }, 'dao4'], ['倒', { prev: '，', next: '像' }, 'dao4'], ['倒', { prev: '你', next: '还' }, 'dao4'],
    ['倒', { next: '是' }, 'dao4'], ['倒', { next: '茶' }, 'dao4'], ['倒', { prev: '摔' }, 'dao3'], ['倒', { next: '下' }, 'dao3'], ['倒', { prev: '怕我', next: '。' }, 'dao3'],
    ['倒', { prev: '墙', next: '了' }, 'dao3'], ['倒', { prev: '反' }, 'dao4'], ['倒', { prev: '，', next: '在' }, 'dao3'], ['倒', { next: '還' }, 'dao4'], ['倒', { next: '沒' }, 'dao4'],
    // sentence-final particles are neutral; a free-standing interjection keeps its tone
    ['啊', { prev: '好', next: '！' }, 'a5'], ['啊', { prev: '，', next: '你' }, 'a1'], ['啊', {}, 'a1'], ['啦', { prev: '走' }, 'la5'], ['啦', {}, 'la5'],
    ['呀', { prev: '好', next: '！' }, 'ya5'], ['哇', { prev: '好', next: '！' }, 'wa5'], ['吧', { prev: '走' }, 'ba5'],
    ['罢', { prev: '去', next: '。' }, 'ba5'], ['罷', { prev: '去', next: '，' }, 'ba5'], ['罢', { prev: '作', next: '。' }, 'ba4'], ['罢', { next: '了' }, 'ba4'],
    ['哩', { prev: '在', next: '。' }, 'li5'], ['哩', { prev: '英' }, 'li3'],
    // smaller context rules
    ['数', { next: '十' }, 'shu4'], ['数', { prev: '了', next: '十' }, 'shu4'], ['数', { prev: '了', next: '数' }, 'shu3'], ['行', { prev: '米' }, 'hang2'], ['行', { prev: '数' }, 'hang2'],
    ['觉', { prev: '一', next: '醒' }, 'jiao4'], ['地', { prev: '猛', next: '站' }, 'di4'], ['地', { prev: '忽', next: '一' }, 'di4'], ['地', { prev: '蓦', next: '然' }, 'di4'],
    ['当', { prev: '当', next: '作' }, 'dang1'], ['當', { prev: '噹', next: '作' }, 'dang1'], ['为', { prev: '劈', next: '两' }, 'wei2'], ['为', { prev: '理解', next: '。' }, 'wei2'], ['为', { next: '妻' }, 'wei2'],
    ['为', { prev: '娶', next: '妻' }, 'wei2'], ['得', { next: '叫' }, 'dei3'], ['了', { prev: '动弹不得', next: '。' }, 'le5'], ['了', { prev: '吃不得', next: '。' }, 'le5'],
    ['重', { next: '又' }, 'chong2'], ['空', { prev: '留个' }, 'kong4'], ['少', { next: '小' }, 'shao4'], ['还', { prev: '他', next: '回' }, 'hai2'], ['还', { next: '回' }, 'huan2'],
    ['中', { prev: '小说', next: '，' }, 'zhong1'], ['中', { prev: '传说' }, 'zhong1'], ['隻', {}, 'zhi1'], ['钯', { prev: '钉' }, 'pa2'], ['鈀', { prev: '釘' }, 'pa2'], ['钯', {}, 'ba3'],
    ['塞', { prev: '边' }, 'sai4'], ['塞', { prev: '堵' }, 'sai1'], ['担', { prev: '挑' }, 'dan4'], ['擔', { prev: '挑' }, 'dan4'], ['担', { next: '心' }, 'dan1'],
    // traditional characters follow the same rules
    ['長', { prev: '生' }, 'zhang3'], ['還', { next: '書' }, 'huan2'], ['著', { prev: '睡', next: '了' }, 'zhao2'], ['發', { prev: '頭' }, 'fa4'],
    ['當', { next: '作' }, 'dang4'], ['數', { next: '一' }, 'shu3'], ['為', { prev: '成' }, 'wei2'], ['處', { next: '理' }, 'chu3'],
    ['種', { next: '樹' }, 'zhong4'], ['傳', { next: '記' }, 'zhuan4'], ['樂', { prev: '音' }, 'yue4'], ['將', { prev: '大' }, 'jiang4'],
    ['調', { next: '整' }, 'tiao2'], ['難', { next: '民' }, 'nan4'], ['興', { next: '趣' }, 'xing4'], ['載', { prev: '記' }, 'zai3'],
    // read from the four classics and Lu Xun (see pinyin-accuracy.test.ts for the same rules through the segmenter)
    ['鮮', { next: '矣' }, 'xian3'], ['鲜', { next: '有' }, 'xian3'], ['鮮', { next: '花' }, 'xian1'],
    ['麼', { prev: '人', next: '？' }, 'ma5'], ['么', { prev: '好', next: '，' }, 'ma5'], ['么', { prev: '什', next: '人' }, 'me5'],
    ['鋪', { next: '著' }, 'pu1'], ['鋪', { prev: '店' }, 'pu4'], ['舖', { next: '子' }, 'pu4'], ['铺', { prev: '十里', next: '。' }, 'pu4'],
    ['更', { prev: '三' }, 'geng1'], ['更', { next: '鼓' }, 'geng1'], ['更', { next: '好' }, 'geng4'],
    ['差', { next: '人' }, 'chai1'], ['差', { prev: '当' }, 'chai1'], ['差', { next: '点' }, 'cha4'], ['差', { next: '得' }, 'cha4'], ['差', { next: '别' }, 'cha1'], ['差', { next: '我' }, 'chai1'],
    ['場', { prev: '一', next: '雨' }, 'chang2'], ['場', { prev: '一', next: '電' }, 'chang3'], ['場', { prev: '市' }, 'chang3'],
    ['沈', { next: '吟' }, 'chen2'], ['沈', { prev: '，', next: '從' }, 'shen3'], ['沈', { next: '氏' }, 'shen3'],
    ['哄', { prev: '怎么', next: '我' }, 'hong3'], ['哄', { prev: '起' }, 'hong4'], ['哄', { next: '堂' }, 'hong1'], ['哄', { next: '骗' }, 'hong3'],
    ['徵', { prev: '魏' }, 'zheng1'], ['徵', { prev: '宮' }, 'zhi3'], ['征', { prev: '出' }, 'zheng1'],
    ['累', { next: '卵' }, 'lei3'], ['累', { next: '了' }, 'lei4'], ['藏', { prev: '地' }, 'zang4'], ['藏', { prev: '收' }, 'cang2'],
    ['斗', { prev: '星' }, 'dou3'], ['斗', { next: '争' }, 'dou4'], ['帖', { prev: '请' }, 'tie3'], ['帖', { prev: '服' }, 'tie1'], ['帖', { prev: '字' }, 'tie4'],
    ['解', { prev: '押' }, 'jie4'], ['解', { next: '送' }, 'jie4'], ['沒', { prev: '辱' }, 'mo4'], ['沒', { prev: '他' }, 'mei2'],
    ['恁', { next: '般' }, 'nen4'], ['咽', { prev: '嗚' }, 'ye4'], ['咽', { prev: '下' }, 'yan4'], ['什', { next: '物' }, 'shi2'], ['什', { next: '么' }, 'shen2'],
    ['譙', { next: '樓' }, 'qiao2'], ['紮', { next: '營' }, 'zha1'], ['紮', { next: '辮' }, 'za1'],
    ['剋', { next: '我' }, 'kei1'], ['剋', { prev: '相' }, 'ke4'], ['拚', { next: '命' }, 'pin1'],
    ['幹', { next: '事' }, 'gan4'], ['乾', { next: '元' }, 'qian2'], ['乾', { next: '淨' }, 'gan1'], ['髮', {}, 'fa4'], ['發', { next: '財' }, 'fa1'],
    ['降', { next: '妖' }, 'xiang2'], ['降', { prev: '歸' }, 'xiang2'], ['降', { next: '臨' }, 'jiang4'], ['降', { prev: '空' }, 'jiang4'],
    ['數', { prev: '了', next: '個' }, 'shu4'], ['數', { prev: '歷' }, 'shu4'], ['數', { prev: '了', next: '數' }, 'shu3'],
    ['得', { prev: '他', next: '了' }, 'de2'], ['得', { prev: '我', next: '去' }, 'dei3'],
    ['了', { prev: '晓得', next: '。' }, 'le5'], ['了', { prev: '吃得', next: '。' }, 'liao3'],
    ['空', { prev: '个', next: '。' }, 'kong4'], ['空', { prev: '个', next: '瓶' }, 'kong1'],
    ['朝', { prev: '一', next: '天氣' }, 'zhao1'], ['朝', { prev: '一', next: '天子' }, 'chao2'],
    ['卷', { prev: '一', next: '經' }, 'juan4'], ['卷', { prev: '一', next: '鋪' }, 'juan3'],
    ['還', { next: '陽' }, 'huan2'], ['樂', { prev: '鼓' }, 'yue4'], ['難', { prev: '急' }, 'nan4'], ['彈', { prev: '珠' }, 'dan4'],
    ['切', { next: '莫' }, 'qie4'], ['切', { next: '不可' }, 'qie4'], ['切', { next: '菜' }, 'qie1'],
    ['佛', {}, 'fo2'], ['擔', {}, 'dan1'], ['卜', {}, 'bu3'],
    ['干', { next: '甚' }, 'gan4'], ['干', { prev: '晒' }, 'gan1'], ['长', { prev: '道' }, 'zhang3'], ['差', { prev: '不' }, 'cha4'], ['卷', { prev: '下', next: '经' }, 'juan4'], ['为', { prev: '转' }, 'wei2'],
    ['骑', { prev: '一', next: '自' }, 'ji4'], ['骑', { next: '马' }, 'qi2'], ['繫', { prev: '腰' }, 'ji4'], ['繫', { next: '統' }, 'xi4'], ['盛', { next: '饭' }, 'cheng2'], ['盛', { prev: '繁' }, 'sheng4'], ['系', { prev: '腰' }, 'xi4'],
    ['莎', { next: '草' }, 'suo1'], ['莎', { prev: '枯' }, 'suo1'], ['鈀', {}, 'pa2'], ['没', { prev: '父' }, 'mo4'],
    ['挑', { prev: '枪' }, 'tiao3'], ['挑', { prev: '水' }, undefined], ['弟', { prev: '则' }, 'ti4'], ['得', { prev: '兵', next: '令' }, 'de2'],
    ['娜', { prev: '婀' }, 'nuo2'], ['娜', { prev: '丽' }, 'na4'], ['咧', { prev: '罢', next: '。' }, 'lie5'], ['咧', { next: '嘴' }, 'lie3'], ['教', { prev: '我', next: '给' }, 'jiao1'],
    ['缝', { prev: '密' }, 'feng2'], ['缝', { prev: '门' }, 'feng4'],
    ['省', { prev: '三' }, 'xing3'], ['省', { prev: '各' }, 'sheng3'], ['喝', { prev: '大' }, 'he4'], ['喝', { next: '酒' }, 'he1'], ['喝', { next: '道' }, 'he4'],
    ['嗄', { prev: '灯', next: '。' }, 'a5'], ['嗄', { prev: '声' , next: '音' }, 'sha4'], ['曾', { next: '子' }, 'zeng1'], ['曾', { prev: '何' }, 'ceng2'],
    ['场', { prev: '一', next: '雨' }, 'chang2'], ['没', { prev: '淹' }, 'mo4'], ['谯', {}, 'qiao2'], ['扎', { next: '针' }, 'zha1'], ['克', { next: '制' }, 'ke4'], ['拼', { next: '命' }, 'pin1'],
  ];
  for (const [ch, ctx, expected] of rules) {
    it(`${ch} ${JSON.stringify(ctx)} -> ${expected}`, async () => {
      const d = await dictP;
      if (expected === undefined) return void expect(d.pinyinFor(ch, ctx)).toHaveLength(1); // no rule: whatever the dictionary says
      expect(d.pinyinFor(ch, ctx)).toEqual([expected]);
    });
  }

  it('every character that has a rule is exercised above', () => {
    const covered = new Set(rules.map((r) => r[0]));
    const missing = POLYPHONE_CHARS.filter((c) => !covered.has(c));
    expect(missing).toEqual([]);
  });

  it('rules also apply inside words CEDICT does not list', async () => {
    const d = await dictP;
    expect(d.pinyinFor('慢慢地')).toEqual(d.lookup('慢慢地').length ? d.pinyinFor('慢慢地') : ['man4', 'man4', 'de5']);
    expect(d.pinyinFor('山山地', {})[2]).toBe('de5');
    expect(d.pinyinFor('睡不着')[2]).toBe('zhao2');
  });

  it('ignores context that is not Han (punctuation, Latin, digits)', async () => {
    const d = await dictP;
    expect(d.pinyinFor('地', { prev: 'abc' })).toEqual(['di4']);
    expect(d.pinyinFor('的', { prev: '，', next: '。' })).toEqual(['de5']);
    expect(d.pinyinFor('得', { prev: '“' })).toEqual(['de2']);
  });
});

describe('word readings from CC-CEDICT', () => {
  const words: [string, string][] = [
    ['行业', 'hang2 ye4'], ['行为', 'xing2 wei2'], ['重复', 'chong2 fu4'], ['长城', 'chang2 cheng2'], ['校长', 'xiao4 zhang3'],
    ['增长', 'zeng1 zhang3'], ['长辈', 'zhang3 bei4'], ['因为', 'yin1 wei4'], ['作为', 'zuo4 wei2'], ['认为', 'ren4 wei2'],
    ['为什么', 'wei4 shen2 me5'], ['少年', 'shao4 nian2'], ['多少', 'duo1 shao5'], ['种子', 'zhong3 zi5'], ['看守', 'kan1 shou3'],
    ['差不多', 'cha4 bu5 duo1'], ['出差', 'chu1 chai1'], ['差别', 'cha1 bie2'], ['头发', 'tou2 fa5'], ['好奇', 'hao4 qi2'],
    ['爱好', 'ai4 hao4'], ['干净', 'gan1 jing4'], ['干部', 'gan4 bu4'], ['倒霉', 'dao3 mei2'], ['调查', 'diao4 cha2'],
    ['调整', 'tiao2 zheng3'], ['薄荷', 'bo4 he5'], ['角色', 'jue2 se4'], ['处理', 'chu3 li3'], ['到处', 'dao4 chu4'],
    ['假期', 'jia4 qi1'], ['请假', 'qing3 jia4'], ['弹药', 'dan4 yao4'], ['难民', 'nan4 min2'], ['难道', 'nan2 dao4'],
    ['将军', 'jiang1 jun1'], ['大将', 'da4 jiang4'], ['间谍', 'jian4 die2'], ['空调', 'kong1 tiao2'], ['有空', 'you3 kong4'],
    ['兴趣', 'xing4 qu4'], ['高兴', 'gao1 xing4'], ['兴奋', 'xing1 fen4'], ['率领', 'shuai4 ling3'], ['效率', 'xiao4 lü4'],
    ['朝代', 'chao2 dai4'], ['记载', 'ji4 zai3'], ['下载', 'xia4 zai3'], ['冠军', 'guan4 jun1'], ['教书', 'jiao1 shu1'],
    ['教育', 'jiao4 yu4'], ['晕车', 'yun4 che1'], ['试卷', 'shi4 juan4'], ['创伤', 'chuang1 shang1'], ['蛮横', 'man2 heng4'],
    ['磨坊', 'mo4 fang2'], ['传记', 'zhuan4 ji4'], ['便宜', 'pian2 yi5'], ['相机', 'xiang4 ji1'], ['相信', 'xiang1 xin4'],
    ['空白', 'kong4 bai2'], ['成分', 'cheng2 fen4'], ['会计', 'kuai4 ji4'], ['模样', 'mu2 yang4'], ['一定', 'yi1 ding4'],
    ['了不起', 'liao3 bu5 qi3'], ['的确', 'di2 que4'], ['目的', 'mu4 di4'], ['似的', 'shi4 de5'], ['来着', 'lai2 zhe5'],
    ['明朝', 'ming2 chao2'], ['大都', 'da4 dou1'], ['所长', 'suo3 zhang3'], ['孙子', 'sun1 zi5'], ['东西', 'dong1 xi5'],
    // traditional
    ['銀行', 'yin2 hang2'], ['首都', 'shou3 du1'], ['頭髮', 'tou2 fa5'], ['調查', 'diao4 cha2'], ['難民', 'nan4 min2'], ['記載', 'ji4 zai3'],
  ];
  for (const [w, py] of words) {
    it(`${w} = ${py}`, async () => {
      const d = await dictP;
      expect(d.pinyinFor(w).join(' ')).toBe(py);
    });
  }

  it('formats them with tone marks', async () => {
    const d = await dictP;
    expect(d.pinyinFor('银行').map((s) => formatPinyin(s, 'marks')).join(' ')).toBe('yín háng');
    expect(d.pinyinFor('首都').map((s) => formatPinyin(s, 'marks')).join(' ')).toBe('shǒu dū');
  });
});

describe('WORD_READINGS overrides', () => {
  it('each override is one of the readings CEDICT lists for that word', async () => {
    const d = await dictP;
    for (const [word, reading] of Object.entries(WORD_READINGS)) {
      const listed = d.lookup(word).map((e) => e.pinyin.toLowerCase());
      expect(listed, word).toContain(reading);
      expect(d.pinyinFor(word).join(' '), word).toBe(reading);
    }
  });
  it('overrides apply to the traditional spelling too', async () => {
    const d = await dictP;
    expect(d.pinyinFor('東西').join(' ')).toBe('dong1 xi5');
    expect(d.pinyinFor('地方').join(' ')).toBe('di4 fang5');
  });
});

describe('choosing among several CEDICT entries', () => {
  it('never picks a "variant of" / Taiwan pronunciation entry when a real one exists', async () => {
    const d: Dictionary = await dictP;
    const rows = await readRows('cedict');
    const bad = /^(old |archaic |ancient )?variant (of|form of|pronunciation)|^also written|^same as|^see |^Taiwan pr\.|^also pr\./i;
    const seen = new Set<string>();
    let checked = 0;
    for (const [trad, simp] of rows) {
      for (const w of [trad, simp]) {
        if (seen.has(w) || [...w].length < 2) continue;
        seen.add(w);
        const entries = d.lookup(w);
        const good = entries.filter((e) => !bad.test(e.defs[0] ?? ''));
        if (good.length === entries.length || good.length === 0) continue;
        const pick = d.pinyinFor(w).join(' ');
        const goodPinyin = good.map((e) => e.pinyin.toLowerCase());
        // Entries with syllable counts that do not match the characters are skipped by alignment, so compare loosely.
        if (!good.some((e) => e.pinyin.split(' ').length === [...w].length)) continue;
        checked++;
        expect(goodPinyin, `${w} -> ${pick}`).toContain(pick);
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('gives a syllable to every Han code point of every CEDICT headword, in both scripts', async () => {
    const d = await dictP;
    const rows = await readRows('cedict');
    let n = 0;
    for (const [trad, simp] of rows) {
      for (const w of new Set([trad, simp])) {
        const cps = [...w];
        const py = d.pinyinFor(w);
        if (py.length !== cps.length) throw new Error(`${w}: ${py.length} syllables for ${cps.length} code points`);
        cps.forEach((c, i) => {
          const han = isHanCodePoint(c.codePointAt(0)!);
          if (han && !py[i]) throw new Error(`${w}: no reading for ${c}`);
          if (!han && py[i]) throw new Error(`${w}: unexpected reading ${py[i]} for ${c}`);
        });
        n++;
      }
    }
    expect(n).toBeGreaterThan(150000);
  });
});
