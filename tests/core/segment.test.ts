import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { segment } from '../../src/core/segment';
import { countHan } from '../../src/core/text';
import type { Dictionary, Token } from '../../src/types';
import { loadTestDictionary, readRows } from '../helpers/data';
import { measure, PERF_SLACK } from '../helpers/perf';
import { GOLD, HELDOUT } from './gold';

const dictP = loadTestDictionary();
const words = (tokens: Token[]) => tokens.map((t) => t.text);

/** Every token must cover the paragraph exactly. */
function expectExactCoverage(text: string, tokens: Token[]): void {
  expect(tokens.map((t) => t.text).join('')).toBe(text);
  let pos = 0;
  for (const t of tokens) {
    expect(t.start).toBe(pos);
    expect(t.end).toBe(pos + t.text.length);
    expect(text.slice(t.start, t.end)).toBe(t.text);
    expect(t.text.length).toBeGreaterThan(0);
    pos = t.end;
  }
  expect(pos).toBe(text.length);
}

describe('segment: the sentences from the spec', () => {
  it('我们在银行门口见面。', async () => {
    const d = await dictP;
    expect(words(segment('我们在银行门口见面。', d))).toEqual(['我们', '在', '银行', '门口', '见面', '。']);
  });
  it('他慢慢地走了过来。 (地 -> de, 了 -> le)', async () => {
    const d = await dictP;
    const t = segment('他慢慢地走了过来。', d);
    expect(words(t)).toEqual(['他', '慢慢', '地', '走', '了', '过来', '。']);
    expect(t[2].pinyin).toEqual(['de5']);
    expect(t[4].pinyin).toEqual(['le5']);
    expect(t[1].pinyin).toEqual(['man4', 'man4']);
  });
  it('長江是中國最長的河流。 (traditional)', async () => {
    const d = await dictP;
    const t = segment('長江是中國最長的河流。', d);
    // 最長 is a common jieba compound (words.tsv); it must still read zuì cháng, not zhǎng.
    expect(words(t)).toEqual(['長江', '是', '中國', '最長', '的', '河流', '。']);
    expect(t[0].pinyin).toEqual(['chang2', 'jiang1']);
    expect(t[3].pinyin).toEqual(['zui4', 'chang2']);
    expect(t[4].pinyin).toEqual(['de5']);
  });
  it('single astral characters are one token each, with readings where Unihan has them', async () => {
    const d = await dictP;
    for (const [ch, py] of [['𠀀', 'he1'], ['𪚥', 'zhe2'], ['𰻞', 'biang2']] as const) {
      const t = segment(ch, d);
      expect(t).toHaveLength(1);
      expect(t[0]).toMatchObject({ text: ch, start: 0, end: 2, kind: 'han', pinyin: [py] });
    }
    const all = segment('𠀀𪚥𰻞', d);
    expect(words(all)).toEqual(['𠀀', '𪚥', '𰻞']);
    expect(all.map((t) => [t.start, t.end])).toEqual([[0, 2], [2, 4], [4, 6]]);
  });
});

describe('segment: gold set', () => {
  /** Boundary positions as "start:end" spans. */
  const spans = (parts: string[]) => {
    const s = new Set<string>();
    let o = 0;
    for (const p of parts) { s.add(`${o}:${o + p.length}`); o += p.length; }
    return s;
  };
  function score(d: Dictionary, items: typeof GOLD) {
    let tp = 0, gp = 0, pp = 0, exact = 0;
    const misses: string[] = [];
    for (const g of items) {
      const gold = g.gold.split('|');
      const pred = words(segment(gold.join(''), d));
      const gs = spans(gold);
      const ps = spans(pred);
      for (const x of ps) if (gs.has(x)) tp++;
      gp += gs.size;
      pp += ps.size;
      if (pred.join('|') === g.gold) exact++;
      else misses.push(`${g.id}\n    gold ${g.gold}\n    pred ${pred.join('|')}`);
    }
    const p = tp / pp, r = tp / gp;
    return { sentences: items.length, exact, precision: p, recall: r, f1: (2 * p * r) / (p + r), misses };
  }

  it('has at least 30 sentences covering every kind of text', () => {
    expect(GOLD.length).toBeGreaterThanOrEqual(30);
    const kinds = new Set(GOLD.map((g) => g.kind));
    expect([...kinds].sort()).toEqual(['classical', 'dialogue', 'mixed', 'simplified', 'traditional']);
  });

  it('every gold sentence is well formed', () => {
    for (const g of GOLD) {
      expect(g.gold.split('|').every((p) => p.length > 0), g.id).toBe(true);
      expect(new Set(GOLD.map((x) => x.id)).size).toBe(GOLD.length);
    }
  });

  it('reaches F1 >= 0.95 overall and on each kind of text', async () => {
    const d = await dictP;
    const all = score(d, GOLD);
    console.log(
      `segmentation gold set: ${all.sentences} sentences, ${all.exact} exact, ` +
        `precision ${all.precision.toFixed(3)}, recall ${all.recall.toFixed(3)}, F1 ${all.f1.toFixed(3)}` +
        (all.misses.length ? '\n  misses:\n  ' + all.misses.join('\n  ') : ''),
    );
    expect(all.f1).toBeGreaterThanOrEqual(0.95);
    expect(all.exact / all.sentences).toBeGreaterThanOrEqual(0.9);
    for (const kind of ['simplified', 'traditional', 'mixed', 'dialogue', 'classical'] as const) {
      const s = score(d, GOLD.filter((g) => g.kind === kind));
      expect(s.f1, kind).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('holds up on sentences it was never tuned on', async () => {
    const d = await dictP;
    expect(HELDOUT.length).toBeGreaterThanOrEqual(30);
    const s = score(d, HELDOUT);
    console.log(
      `held-out set: ${s.sentences} sentences, ${s.exact} exact, precision ${s.precision.toFixed(3)}, ` +
        `recall ${s.recall.toFixed(3)}, F1 ${s.f1.toFixed(3)}` + (s.misses.length ? '\n  misses:\n  ' + s.misses.join('\n  ') : ''),
    );
    expect(s.f1).toBeGreaterThanOrEqual(0.93);
  });

  it('segments the traditional conversion of the simplified sentences about as well', async () => {
    const d = await dictP;
    const simp = GOLD.filter((g) => g.kind === 'simplified');
    const trad = simp.map((g) => ({ ...g, kind: 'traditional' as const, gold: g.gold.split('|').map((p) => d.toTraditional(p)).join('|') }));
    const s = score(d, trad);
    expect(s.f1).toBeGreaterThanOrEqual(0.95);
  });
});

describe('segment: exact coverage and token kinds', () => {
  const samples = [
    '', ' ', '\n', '你好', '你好，世界！', 'Hello, world', '12345', '３．１４', '𠀀𪚥𰻞',
    'a𠀀b', '😀人😀', '\ud800人', '人\udc00', '“你好，”他说。', '「あいう」', '한국어 中文',
    'é人', '人️', 'x\t\ty\r\nz', '3D打印机', 'AA制', '《红楼梦》（上）', '你……好', '—— 破折号',
    '１２３ＡＢＣ', '第3章', '5,000元', "don't 走", 'x-ray 光', '人'.repeat(1000), '\u{323B0}\u{30000}\u{2F800}\u{F900}\u{2F08}',
  ];
  for (const text of samples) {
    it(`covers ${JSON.stringify(text.length > 30 ? text.slice(0, 30) + '…' : text)} exactly`, async () => {
      const d = await dictP;
      const tokens = segment(text, d);
      expectExactCoverage(text, tokens);
      for (const t of tokens) {
        if (t.kind === 'han') expect(t.pinyin, t.text).toHaveLength([...t.text].length);
        else expect(t.pinyin).toBeUndefined();
      }
    });
  }

  it('returns no tokens for an empty paragraph', async () => {
    expect(segment('', await dictP)).toEqual([]);
  });

  it('classifies characters', async () => {
    const d = await dictP;
    const kinds = (s: string) => segment(s, d).map((t) => `${t.kind}:${t.text}`);
    expect(kinds('我有3个苹果, ok?')).toEqual(['han:我', 'han:有', 'num:3', 'han:个', 'han:苹果', 'punct:,', 'space: ', 'latin:ok', 'punct:?']);
    expect(kinds('一二三').every((k) => k.startsWith('han:'))).toBe(true); // Chinese numerals stay Han
    expect(kinds('１２３')).toEqual(['num:１２３']);
    expect(kinds('3.14')).toEqual(['num:3.14']);
    expect(kinds('1,000')).toEqual(['num:1,000']);
    expect(kinds('3. 4')).toEqual(['num:3', 'punct:.', 'space: ', 'num:4']);
    expect(kinds('ＡＢＣ')).toEqual(['latin:ＡＢＣ']);
    expect(kinds("don't")).toEqual(['latin:don\'t']);
    expect(kinds('x-ray')).toEqual(['latin:x-ray']);
    expect(kinds('café')).toEqual(['latin:café']);
    expect(kinds('，。！？、；：')).toEqual(['punct:，', 'punct:。', 'punct:！', 'punct:？', 'punct:、', 'punct:；', 'punct:：']);
    expect(kinds('“”「」『』（）《》〈〉【】')).toHaveLength(14);
    expect(kinds('“”「」『』（）《》〈〉【】').every((k) => k.startsWith('punct:'))).toBe(true);
    expect(kinds('……')).toEqual(['punct:…', 'punct:…']);
    expect(kinds('$+=')).toEqual(['punct:$', 'punct:+', 'punct:=']);
    expect(kinds('  　\n')).toEqual(['space:  　\n']);
    expect(kinds('😀')).toEqual(['other:😀']);
    expect(kinds('あいう')).toEqual(['other:あいう']);
    expect(kinds('привет')).toEqual(['other:привет']);
    expect(kinds('〇')).toEqual(['han:〇']);
    expect(kinds('𠀀a')).toEqual(['han:𠀀', 'latin:a']);
  });

  it('keeps each punctuation mark as its own token', async () => {
    const d = await dictP;
    const t = segment('“你好！”', d);
    expect(words(t)).toEqual(['“', '你好', '！', '”']);
    expect(t.filter((x) => x.kind === 'punct')).toHaveLength(3);
  });

  it('does not segment across non-Han characters', async () => {
    const d = await dictP;
    expect(words(segment('银行3行', d))).toEqual(['银行', '3', '行']);
    expect(words(segment('银行 行走', d))).toEqual(['银行', ' ', '行走']);
  });

  it('marks tokens that are dictionary headwords', async () => {
    const d = await dictP;
    const t = segment('银行好𠀀', d);
    expect(t.map((x) => [x.text, x.inDict])).toEqual([['银行', true], ['好', true], ['𠀀', false]]);
    expect(segment('，', d)[0].inDict).toBe(false);
    expect(segment('abc', d)[0].inDict).toBe(false);
  });

  it('gives the neighbouring tokens to pinyinFor', async () => {
    const d = await dictP;
    // 地 is dì in 在地上-style text and de after an adverb; only the neighbours differ
    expect(segment('慢慢地说', d).find((t) => t.text === '地')!.pinyin).toEqual(['de5']);
    expect(segment('的地', d).find((t) => t.text === '地')!.pinyin).toEqual(['di4']);
    expect(segment('“地', d).find((t) => t.text === '地')!.pinyin).toEqual(['di4']);
    expect(segment('一只猫', d).find((t) => t.text === '只')!.pinyin).toEqual(['zhi1']);
    expect(segment('3只猫', d).find((t) => t.text === '只')!.pinyin).toEqual(['zhi1']);
  });
});

describe('segment: algorithm properties', () => {
  it('prefers the more probable path (longer common words beat unseen splits)', async () => {
    const d = await dictP;
    expect(words(segment('研究生命的起源', d))).toEqual(['研究', '生命', '的', '起源']);
    expect(words(segment('结婚的和尚未结婚的', d))).toContain('尚未');
    expect(words(segment('南京市长江大桥', d))[0]).toBe('南京市');
  });
  it('splits text made only of unknown characters into single characters', async () => {
    const d = await dictP;
    const t = segment('龘龘龘', d);
    expect(words(t).join('')).toBe('龘龘龘');
    expect(t.every((x) => x.kind === 'han')).toBe(true);
  });
  it('handles Kangxi radicals and compatibility ideographs in the middle of a word', async () => {
    const d = await dictP;
    const t = segment('我⼈们', d); // 我⼈们: the radical is not 人 for the matcher, but must not break coverage
    expectExactCoverage('我⼈们', t);
    expect(segment('⼈', d)[0].pinyin).toEqual(d.pinyinFor('人'));
  });
  it('is deterministic and does not mutate the dictionary', async () => {
    const d = await dictP;
    const a = segment('我们在银行门口见面。', d);
    const b = segment('我们在银行门口见面。', d);
    expect(a).toEqual(b);
    a[0].pinyin![0] = 'xxx';
    expect(segment('我们在银行门口见面。', d)[0].pinyin).toEqual(['wo3', 'men5']);
  });
});

describe('segment: performance', () => {
  /** Reproducible text of `n` Han characters made from real dictionary words (seeded LCG). */
  async function syntheticHan(n: number): Promise<string> {
    const rows = await readRows('words');
    const pool = rows.filter((r) => Number(r[1]) > 50 && [...r[0]].length >= 1 && [...r[0]].length <= 4 && countHan(r[0]) === [...r[0]].length).map((r) => r[0]);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let out = '';
    let count = 0;
    while (count < n) {
      const w = pool[Math.floor(rnd() * pool.length)];
      out += w;
      count += [...w].length;
    }
    return out;
  }

  it('segments 10,000 Han characters in under 60 ms', async () => {
    const d = await dictP;
    const text = (await syntheticHan(10000)).slice(0, 10000);
    expect(countHan(text)).toBeGreaterThanOrEqual(9990);
    segment(text.slice(0, 2000), d); // warm up the JIT and the reading cache
    const runs: { wall: number; cpu: number }[] = [];
    for (let i = 0; i < 5; i++) {
      // vary the text a little so the per-word reading cache cannot do all the work
      const shifted = text.slice(i * 7) + text.slice(0, i * 7);
      const m = measure(() => segment(shifted, d));
      runs.push(m);
      expect(m.result.length).toBeGreaterThan(3000);
    }
    console.log(`segment 10k Han chars: cpu ${runs.map((r) => r.cpu.toFixed(1)).join(', ')} ms, wall ${runs.map((r) => r.wall.toFixed(1)).join(', ')} ms`);
    // CPU time of the best of five: other processes on a busy machine only inflate wall-clock time.
    expect(Math.min(...runs.map((r) => r.cpu))).toBeLessThan(60 * PERF_SLACK);
  });

  it('segments 10,000 traditional characters in under 60 ms too', async () => {
    const d = await dictP;
    const text = d.toTraditional((await syntheticHan(10000)).slice(0, 10000));
    segment(text.slice(0, 2000), d);
    const runs: { wall: number; cpu: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const shifted = text.slice(i * 11) + text.slice(0, i * 11);
      runs.push(measure(() => segment(shifted, d)));
    }
    console.log(`segment 10k traditional chars: cpu ${runs.map((r) => r.cpu.toFixed(1)).join(', ')} ms`);
    expect(Math.min(...runs.map((r) => r.cpu))).toBeLessThan(60 * PERF_SLACK);
  });

  it('scales linearly: 200,000 characters in one paragraph take under 1.5 s', async () => {
    const d = await dictP;
    const text = (await syntheticHan(200000)).slice(0, 200000);
    const m = measure(() => segment(text, d));
    console.log(`segment 200k chars: cpu ${m.cpu.toFixed(0)} ms, wall ${m.wall.toFixed(0)} ms`);
    expectExactCoverage(text, m.result);
    expect(m.cpu).toBeLessThan(1500 * PERF_SLACK);
  });

  const huozhe = `${homedir()}/Downloads/活着.epub`;
  it.skipIf(!existsSync(huozhe))('segments a real book (活着.epub, read in place) fast and plausibly', async () => {
    const d = await dictP;
    const xml = execFileSync('unzip', ['-p', huozhe, 'OEBPS/Text/Section0001_split_001.xhtml'], { maxBuffer: 1 << 26 }).toString('utf8');
    const paras = [...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    const han = paras.reduce((a, p) => a + countHan(p), 0);
    expect(han).toBeGreaterThan(10000);
    // Best of two: the first pass also pays for JIT warm-up and filling the reading caches (about 3x slower).
    const first = measure(() => paras.map((p) => segment(p, d)));
    const second = measure(() => paras.map((p) => segment(p, d)));
    const timing = second.cpu < first.cpu ? second : first;
    const all = timing.result;
    const ms = timing.cpu;
    let tokens = 0;
    let inWords = 0;
    all.forEach((t, i) => {
      expect(t.map((x) => x.text).join('')).toBe(paras[i]);
      tokens += t.length;
      for (const x of t) if (x.kind === 'han' && [...x.text].length > 1) inWords += [...x.text].length;
    });
    console.log(`活着 section: ${han} Han chars, ${tokens} tokens, ${ms.toFixed(0)} ms cpu (${timing.wall.toFixed(0)} ms wall), ${((100 * inWords) / han).toFixed(0)}% of characters in multi-character words`);
    expect(ms / han).toBeLessThan(0.006 * PERF_SLACK); // < 60 ms per 10k characters
    expect(inWords / han).toBeGreaterThan(0.4); // modern Chinese prose is roughly 55-65% in multi-character words
    expect(inWords / han).toBeLessThan(0.8);
  });
});
