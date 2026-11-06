// The seventh pass (2026-11): what a native review of the offline data (corpus words, the name model, the reading model) found
// worse, and how each is narrowed: a counted word gives way to the dictionary word it overlaps (按|剑柄), an archaic word used
// mostly inside titles is counted only there (常侍), a name of two of the commonest characters is left out (比干), an archaic word
// before 这 那 or after 把 is a verb and its object (单|骑这匹马), rule cases for 长 还 着 中 and 骑, a lower bar for 率 shuài, a rank
// before an office is not a person (龙骧将军), and cards that give the sense the books mean (帐房 a tent, 销金 gold-spangled).
// Every sentence is invented or a line of a public-domain classic in public/samples.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { standOf } from '../../src/core/nameModel';
import { parseReadingModel } from '../../src/core/readingModel';
import { segment } from '../../src/core/segment';
import { loadDictionary } from '../../src/core/dict';
import type { Dictionary, Token } from '../../src/types';
import { loadTestDictionary, readDataFile } from '../helpers/data';

let d: Dictionary;
let without: Dictionary;
beforeAll(async () => {
  d = await loadTestDictionary();
  // The real dictionary without the corpus file, as an old deployment or a failed fetch leaves it.
  without = await loadDictionary('/', {
    fetchText: async (name) => {
      if (name === 'corpus-words.tsv.gz') throw new Error('missing');
      return readDataFile(name);
    },
  });
});

const cut = (text: string, dict: Dictionary = d) => `|${segment(text, dict).map((t) => t.text).join('|')}|`;

/** Numbered pinyin of the characters of `part` (its first occurrence), joined by spaces. */
function readingOf(text: string, part: string): string {
  const toks: Token[] = segment(text, d);
  const at = text.indexOf(part);
  const out: string[] = [];
  for (const t of toks) {
    if (t.kind !== 'han') continue;
    [...t.text].forEach((_, i) => { if (t.start + i >= at && t.start + i < at + part.length) out.push(t.pinyin![i]); });
  }
  return out.join(' ');
}

describe('counted words', () => {
  it('give way to the dictionary word they overlap, and still join where they stand free', () => {
    expect(cut('他手按剑柄，喝道：「休走！」')).toContain('|按|剑柄|');
    expect(cut('卓按剑而起。')).toContain('|按剑|');
    expect(cut('三十人各披衣甲，手执钢刀。')).toContain('|披|衣甲|');
    expect(cut('他连忙起身披衣。')).toContain('|披衣|');
    expect(cut('回首大唐肝胆裂。')).toContain('|肝胆|裂|');
    expect(cut('论辈份他是我的叔叔。')).toContain('|辈份|');
  });

  it('leave an archaic title used mostly inside longer ones to them, and a name of two common words out', () => {
    expect(cut('里头只有他们紧跟常侍的丫鬟伺候。')).toContain('|常|侍|');
    expect(cut('中常侍赵忠入宫。')).toContain('|中常侍|');
    expect(cut('遂加孟达为散骑常侍、建武将军。')).toContain('|散骑常侍|');
    for (const w of ['常侍', '比干', '亭子间']) expect(d.segmentFreq!(w), w).toBe(without.segmentFreq!(w));
  });

  it('are a verb and its object before 这 那 or after 把 when the word is archaic', () => {
    expect(cut('他单骑这匹马走了。')).toContain('|单|骑|这|');
    expect(cut('他把车骑到了门口。')).toContain('|车|骑|');
    expect(readingOf('他单骑这匹马走了。', '骑')).toBe('qi2');
    // (The old novels keep them: 张辽领命，单骑先往; 习学这枝方天画戟 is a verb.)
    expect(cut('张辽领命，单骑先往。')).toContain('|单骑|');
    expect(cut('因此习学这枝方天画戟。')).toContain('|习学|');
  });

  it('show the sense the books mean', () => {
    expect(cut('替天行道杏黄旗。')).toContain('|杏黄|旗|');
    expect(d.lookup('帐房')[0].defs.join('; ')).toMatch(/tent/);
    expect(d.lookup('帐房')[0].defs.join('; ')).toMatch(/accounts office/);
    expect(d.lookup('骁雄')[0].defs.join('; ')).toMatch(/valiant/);
    expect(d.lookup('销金')[0].defs[0]).toMatch(/gold-spangled/);
    expect(readingOf('行者走至楼边，果然挤塞。', '挤塞')).toBe('ji3 se4');
    expect(readingOf('精准纪录台北城廓与街道样貌。', '城廓')).toBe('cheng2 kuo4');
  });
});

describe('readings', () => {
  // (With the reading model, as the reader has it.)
  beforeAll(async () => { d.setReadingModel?.(parseReadingModel(await readDataFile('reading-model.tsv.gz'))); });
  afterAll(() => { d.setReadingModel?.(null); });

  it('reads 长 cháng in 从长商议 and in a night that grows long', () => {
    expect(readingOf('待我从长商议，来日说话。', '长')).toBe('chang2');
    expect(readingOf('休要急速！待我从长计较，慢慢地商量。', '长')).toBe('chang2');
    expect(readingOf('宝钗因见天气凉爽，夜复渐长，遂至母亲房中商议。', '长')).toBe('chang2');
    // (A child or an age that grows stays zhǎng.)
    expect(readingOf('生嫡出子渐长，遂使傅之。', '长')).toBe('zhang3');
  });

  it('reads 还 hái before a verb of posture, 着 zhe after a verb of carrying, 中 zhōng before 取', () => {
    expect(readingOf('佛如来是治世之尊，还坐于大鹏之下。', '还')).toBe('hai2');
    expect(readingOf('他还站在那里。', '还')).toBe('hai2');
    expect(readingOf('红须赤身鬼使，头顶着一盘面饼。', '着')).toBe('zhe5');
    expect(readingOf('却就善中取计，可以图之。', '中')).toBe('zhong1');
    // (The model still reads 着人 zhuó and 中计 zhòng.)
    expect(readingOf('一面着人打捞起四个尸首。', '着')).toBe('zhuo2');
    expect(readingOf('操仰面笑曰：「误中匹夫之计！」', '中')).toBe('zhong4');
  });

  it('reads 率 shuài where a lord leads his men', () => {
    expect(readingOf('时龙骧将军王浚率水兵顺流而下。', '率')).toBe('shuai4');
    expect(readingOf('曹嵩率家小行到华、费间。', '率')).toBe('shuai4');
  });
});

describe('the name model', () => {
  it('counts the places a string stands right before an office, which make it a rank (龙骧将军), not a person', () => {
    const text = '时龙骧将军王浚率水兵顺流而下。又遣龙骧将军王浚，广武将军唐彬，浮江东下。龙骧虎视，平吞江夏。';
    const gen = standOf(text, ['龙骧', '广武', '王浚'], d, new Map(), () => false);
    let r = gen.next();
    while (!r.done) r = gen.next();
    expect(r.value.get('龙骧')!.rankAfter).toBe(2);
    expect(r.value.get('广武')!.rankAfter).toBe(1);
    expect(r.value.get('王浚')!.rankAfter).toBe(0);
  });
});
