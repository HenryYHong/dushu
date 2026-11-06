// The reading model (core/readingModel.ts): the TypeScript gives the same features and scores as scripts/train_reading_model.py
// (tests/core/fixtures/reading-model-check.tsv, written by that script from the invented sentences of
// scripts/data/reading-model-check.txt), and the dictionary asks it only where it should. Invented sentences.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  NOT_FOR_MODEL, READING_FEATURES_VERSION, READING_MODEL_FILE, loadReadingModel, parseReadingModel, siteFeatures,
  type ReadingChooser, type ReadingModel, type ReadingSite,
} from '../../src/core/readingModel';
import { segment } from '../../src/core/segment';
import { detectScript } from '../../src/core/text';
import { inScript, segmentShown } from '../../src/ui/reader/shown';
import type { Dictionary } from '../../src/types';
import { loadTestDictionary, readDataFile } from '../helpers/data';

const ROOT = join(__dirname, '..', '..');
/** The characters the model file speaks for (see the training script's report). */
const ENABLED = '中为什仔传刹圜奔好姥宿将少差得数杈杓槛率畜相着祇种给脯艮苕茄茆藉藏裨还镝长隽颉';
let dict: Dictionary;
let model: ReadingModel;

beforeAll(async () => {
  dict = await loadTestDictionary();
  const m = parseReadingModel(await readDataFile(READING_MODEL_FILE));
  if (!m) throw new Error('public/data/reading-model.tsv.gz did not load');
  model = m;
});
afterAll(() => dict.setReadingModel?.(null));

/** The features at each place where the dictionary asks the model, by UTF-16 offset, as the training script gets them. */
function sitesOf(line: string): Map<number, { ch: string; fallback: string; features: string[] }> {
  const out = new Map<number, { ch: string; fallback: string; features: string[] }>();
  const recorder: ReadingChooser = {
    choose(site: ReadingSite, fallback: string) {
      let offset = 0;
      for (let k = -1; site.tok(k); k--) offset += site.tok(k).length;
      out.set(offset, { ch: site.ch, fallback, features: siteFeatures(site, fallback) });
      return undefined;
    },
  };
  dict.setReadingModel?.(recorder);
  try {
    segmentShown(inScript(line, 'simplified', dict, detectScript(line)), line, dict);
  } finally {
    dict.setReadingModel?.(null);
  }
  return out;
}

/** The reading of the character at `part`'s first code point, with or without the model. */
function readingAt(text: string, part: string, withModel: boolean): string {
  dict.setReadingModel?.(withModel ? model : null);
  try {
    const at = text.indexOf(part);
    const t = segment(text, dict).find((x) => x.start <= at && at < x.end)!;
    return t.pinyin![[...text.slice(t.start, at)].length];
  } finally {
    dict.setReadingModel?.(null);
  }
}

describe('reading model file', () => {
  it('is the features version the app computes, with thresholds above one half', () => {
    const text = readFileSync(join(ROOT, 'public', 'data', 'reading-model.tsv.gz'));
    expect(text.length).toBeLessThan(1_000_000);
    expect(model.threshold).toBeGreaterThan(0.5);
    expect(model.threshold).toBeLessThanOrEqual(1);
    for (const ch of model.chars.keys()) {
      expect(model.thresholdOf(ch)).toBeGreaterThan(0.5);
      expect(model.thresholdOf(ch)).toBeLessThanOrEqual(1);
    }
    for (const ch of NOT_FOR_MODEL) expect(model.has(ch)).toBe(false);
  });

  it('speaks only for the characters the held-out hand labels enabled', () => {
    // scripts/train_reading_model.py keeps a character only where its changes on the held-out hand labels were right at least
    // 90% of the time; a retrain that changes this list should change it here on purpose.
    expect([...model.chars.keys()].sort().join('')).toBe(ENABLED);
    for (const ch of '的了是在有我他这中个们来上大') if (!ENABLED.includes(ch)) expect(model.knows(ch)).toBe(false);
  });

  it('reads a threshold of its own for a character', () => {
    const m = parseReadingModel(`!\tv\t${READING_FEATURES_VERSION}\n!\tthreshold\t0.7\n!\tthreshold:传\t0.9\n!\tthreshold:杓\t7\n传\tchuan2 zhuan4\t0.5\tw+1:》 2\n杓\tbiao1 shao2\t0.5\n`)!;
    expect(m.thresholdOf('传')).toBe(0.9);
    expect(m.thresholdOf('杓')).toBe(0.7); // out of range: the default
  });

  it('reads a higher threshold for changing a character to one of its readings', () => {
    const m = parseReadingModel(`!\tv\t${READING_FEATURES_VERSION}\n!\tthreshold\t0.7\n!\tthreshold:为\t0.8\n!\tthreshold:为:wei2\t0.9\n为\twei4 wei2\t1\n`)!;
    expect(m.thresholdOf('为')).toBe(0.8);
    expect(m.thresholdOf('为', 'wei4')).toBe(0.8);
    expect(m.thresholdOf('为', 'wei2')).toBe(0.9);
    // e^1 / (1 + e^1) = 0.73: under 0.9, so wéi does not replace the rules' wèi; with the bias at 2.5 (0.92) it does.
    const site = (ch: string): ReadingSite => ({ ch, tok: () => '', verb: () => 0, noun: () => false });
    expect(m.choose(site('为'), 'wei4', () => true)).toBeUndefined();
    const sure = parseReadingModel(`!\tv\t${READING_FEATURES_VERSION}\n!\tthreshold\t0.7\n!\tthreshold:为:wei2\t0.9\n为\twei4 wei2\t2.5\n`)!;
    expect(sure.choose(site('为'), 'wei4', () => true)).toBe('wei2');
    // The real file: changing 为 to wéi asks more of the model than changing it to wèi.
    expect(model.thresholdOf('为', 'wei2')).toBeGreaterThan(model.thresholdOf('为', 'wei4'));
  });

  it('is not used when it is of another version, broken or missing', async () => {
    const good = '!\tv\t' + READING_FEATURES_VERSION + '\n!\tthreshold\t0.7\n传\tchuan2 zhuan4\t0.5\tw+1:》 2\n';
    expect(parseReadingModel(good)).not.toBeNull();
    expect(parseReadingModel(good.replace(`v\t${READING_FEATURES_VERSION}`, `v\t${READING_FEATURES_VERSION + 1}`))).toBeNull();
    expect(parseReadingModel('<!doctype html><html></html>')).toBeNull();
    expect(await loadReadingModel(() => Promise.reject(new Error('404')))).toBeNull();
  });

  it('leaves every reading to the rules when the file is missing', async () => {
    const missing = await loadReadingModel(() => Promise.reject(new Error('404')));
    const t = '他们在山里找到一座古刹，就在刹前歇了一会儿。我先读了《王冕传》。';
    dict.setReadingModel?.(missing);
    const a = segment(t, dict).map((x) => (x.pinyin ?? []).join(' '));
    dict.setReadingModel?.(null);
    const b = segment(t, dict).map((x) => (x.pinyin ?? []).join(' '));
    expect(a).toEqual(b);
  });
});

describe('the TypeScript matches the training script', () => {
  const rows = readFileSync(join(__dirname, 'fixtures', 'reading-model-check.tsv'), 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
  const lines = readFileSync(join(ROOT, 'scripts', 'data', 'reading-model-check.txt'), 'utf8').split('\n');

  it('has check places to compare', () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it('computes the same features at every check place', () => {
    for (const [line, offset, ch, fallback, , ...features] of rows) {
      const site = sitesOf(lines[Number(line) - 1]).get(Number(offset));
      expect(site, `${ch} in line ${line}`).toBeDefined();
      expect(site!.ch).toBe(ch);
      expect(site!.fallback).toBe(fallback);
      expect(site!.features).toEqual(features);
    }
  });

  it('gives the same probabilities as the Python scorer', () => {
    for (const [line, , ch, , scores, ...features] of rows) {
      const ts = model.scores(ch, features)!;
      const py = scores.split(' ').map((s) => { const [reading, p] = s.split(':'); return { reading, p: Number(p) }; });
      expect(ts.map((x) => x.reading), `${ch} in line ${line}`).toEqual(py.map((x) => x.reading));
      ts.forEach((x, k) => expect(Math.abs(x.p - py[k].p), `${ch} ${x.reading} in line ${line}`).toBeLessThan(1e-6));
    }
  });
});

describe('where the dictionary asks the model', () => {
  it('reads a biography, a ladle, a temple and the stars as books mean them', () => {
    const t1 = '我先读了《王冕传》，又读了宋濂写的另一篇传。';
    expect(readingAt(t1, '传》', false)).toBe('chuan2');
    expect(readingAt(t1, '传》', true)).toBe('zhuan4');
    const t2 = '厨房的墙上挂着一把木杓，锅里炖着茄。';
    expect(readingAt(t2, '杓', false)).toBe('biao1');
    expect(readingAt(t2, '杓', true)).toBe('shao2');
    expect(readingAt('他们在山里找到一座古刹，就在刹前歇了一会儿。', '刹前', true)).toBe('cha4');
    expect(readingAt('老先生精通天文，能说出东方七宿的名字。', '宿', true)).toBe('xiu4');
  });

  it('reads 为 as a copula and 藏 as a canon where the rules fall back to their default', () => {
    const t = '历史考试模块为必修课程，地理考试模块为选修课程。';
    const at = t.lastIndexOf('为选修');
    const second = t.slice(at);
    expect(readingAt(t, second, false)).toBe('wei4');
    expect(readingAt(t, second, true)).toBe('wei2');
    const u = '寺里藏着经一藏，从不给外人看。';
    expect(readingAt(u, '藏，', false)).toBe('cang2');
    expect(readingAt(u, '藏，', true)).toBe('zang4');
    expect(readingAt(u, '藏着', true)).toBe('cang2');
  });

  it('keeps the rules where one of their cases matched', () => {
    // 率 after 效 is a rate (the 率 rule's own case), 宿 after 一 is a night: the model is not asked.
    expect(readingAt('这台机器的效率很高。', '率', true)).toBe(readingAt('这台机器的效率很高。', '率', false));
    expect(readingAt('我们在店里住了一宿。', '宿', true)).toBe('xiu3');
    // Enabled 2026-11-05: 祇 for 只 (zhǐ), 得 meaning "get to, obtain" (dé), 为 in a set phrase (wéi); 着了气 (zháo).
    expect(readingAt('丫鬟去不多时，祇见他走入房来。', '祇', true)).toBe('zhi3');
    expect(readingAt('我才得回乡去看看母亲。', '得', true)).toBe('de2');
    expect(readingAt('从何而得？', '得', true)).toBe('de2');
    expect(readingAt('他慈悲为怀，从不杀生。', '为', true)).toBe('wei2');
    expect(readingAt('那两个官着了气，散席后各自回家。', '着', true)).toBe('zhao2');
    // The complement after an adjective or a verb stays de, the reading the model got wrong below 0.99.
    expect(readingAt('他痛得象刀割一样。', '得', true)).toBe('de5');
    // 了 地 的 never; 得 after a verb and 着 where it is a particle stay as the rules read them (de, zhe).
    const t = '他慢慢地走着，看了一眼，跑得很快的样子。';
    for (const p of ['地', '着', '了', '得', '的']) expect(readingAt(t, p, true)).toBe(readingAt(t, p, false));
  });

  it('leaves to the rules the places where the model misread the books it was checked on', () => {
    expect(readingAt('这个月三号井出煤率最高。', '率', true)).toBe('lü4'); // a rate that is high
    expect(readingAt('这口井的出油率很低。', '率', true)).toBe('lü4');
    expect(readingAt('他一边刹裤子，一边往外跑。', '刹', true)).toBe('sha1'); // to tighten
    expect(readingAt('敌兵东奔西突，乱作一团。', '奔', true)).toBe('ben1');
    expect(readingAt('这东西比什头都要紧。', '什', true)).toBe('shen2'); // 什头 for 什么
    expect(readingAt('他谈吐隽雅，人人喜欢。', '隽', true)).toBe('juan4');
    expect(readingAt('她最爱听《胡茄十八拍》。', '茄', true)).toBe('jia1'); // 胡茄 for 胡笳
    expect(readingAt('院里放着木锨、木杈和扫帚。', '杈', true)).toBe('cha1'); // a pitchfork
    // And where the book-trained model misread modern novels: 为 + someone + what is felt or lived for them, a treasure stored, a
    // rate before an adverb.
    expect(readingAt('她心里真为弟弟高兴。', '为弟弟', true)).toBe('wei4');
    expect(readingAt('妈妈一辈子都在为孩子活着。', '为孩子', true)).toBe('wei4');
    expect(readingAt('山洞里有一座藏宝塔，谁也没进去过。', '藏宝', true)).toBe('cang2');
    expect(readingAt('这个月的返修率都在下降。', '率', true)).toBe('lü4');
    // What the model got right stays: a temple, a branch fork, a leader.
    expect(readingAt('他们在山里找到一座古刹，就在刹前歇了一会儿。', '刹前', true)).toBe('cha4');
    expect(readingAt('露水挂在叶杈间。', '杈', true)).toBe('cha4');
  });

  it('reads the characters the hand labels of 2026-11 enabled where the rules fall back to their default', () => {
    // Invented sentences: the young and the grown (少 shào, 长 zhǎng), a liking (好 hào), planting (种 zhòng), a mistake (差 chà),
    // sending someone and wearing (着 zhuó).
    const cases: [string, string, string][] = [
      ['他少孤，及长，好读书，尤好写诗。', '少孤', 'shao4'], ['他少孤，及长，好读书，尤好写诗。', '长，', 'zhang3'],
      ['其人贪而好利，不可与谋。', '好利', 'hao4'], ['他在门前种竹，屋后种梅。', '种竹', 'zhong4'],
      ['这件事你可说差了，不是这样的。', '差了', 'cha4'],
      ['员外着人去请他来。', '着人', 'zhuo2'], ['他身上着一领青布道袍。', '着一', 'zhuo2'],
    ];
    for (const [t, part, want] of cases) {
      expect(readingAt(t, part, false), `${part} with the rules alone`).not.toBe(want);
      expect(readingAt(t, part, true), part).toBe(want);
    }
    // 魂不着体 is a rule's own case (zhuó, with or without the model).
    expect(readingAt('那书生吓得魂不着体，半天才回过神来。', '着体', false)).toBe('zhuo2');
    expect(readingAt('那书生吓得魂不着体，半天才回过神来。', '着体', true)).toBe('zhuo2');
  });

  it('chooses only among the character\'s own readings', () => {
    const fake: ReadingChooser = parseReadingModel(`!\tv\t${READING_FEATURES_VERSION}\n!\tthreshold\t0.6\n杓\tbiao1 xyz9\t9\n`)!;
    dict.setReadingModel?.(fake);
    try {
      const t = segment('一把木杓。', dict).find((x) => x.text === '杓');
      expect(t?.pinyin?.[0]).toBe('biao1');
    } finally {
      dict.setReadingModel?.(null);
    }
  });

  it('changes nothing in sentences without such a character', () => {
    const t = '我们在银行门口见面，然后一起去吃饭。';
    dict.setReadingModel?.(model);
    const a = segment(t, dict).map((x) => (x.pinyin ?? []).join(' '));
    dict.setReadingModel?.(null);
    const b = segment(t, dict).map((x) => (x.pinyin ?? []).join(' '));
    expect(a).toEqual(b);
  });
});
