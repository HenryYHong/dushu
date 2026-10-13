import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDictionary } from '../../src/core/dict';
import { HAN_BLOCKS, hanBlockName } from '../../src/core/blocks';
import { DATA_DIR, loadTestDictionary, readDataFile, readRows } from '../helpers/data';
import { measureAsync, PERF_SLACK } from '../helpers/perf';

const dictP = loadTestDictionary();

describe('loadDictionary', () => {
  it('loads everything from the real data in a few seconds', async () => {
    const m = await measureAsync(() => loadDictionary('/', { fetchText: readDataFile }));
    const d = m.result;
    console.log(`loadDictionary: cpu ${m.cpu.toFixed(0)} ms, wall ${m.wall.toFixed(0)} ms`);
    expect(m.cpu).toBeLessThan(4000 * PERF_SLACK);
    expect(d.meta.unicode).toBe('18.0.0');
    expect(d.meta.sources.map((s) => s.name)).toContain('CC-CEDICT');
    expect(d.meta.counts.cedict).toBe(125262);
    expect(d.meta.counts.wordTotal).toBeGreaterThan(8e7);
  });

  it('yields to the event loop while parsing', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    try {
      await loadDictionary('/', { fetchText: readDataFile });
    } finally {
      clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(5);
  });

  it('works without chars-extra', async () => {
    const d = await loadDictionary('/', {
      fetchText: (name) => (name.startsWith('chars-extra') ? Promise.reject(new Error('404')) : readDataFile(name)),
    });
    expect(d.char('人')!.readings[0]).toBe('rén');
    expect(d.meta.counts.extraLoaded).toBe(0);
    // Without the supplement a rare character may be empty, but never null and never a throw.
    expect(d.char('\u{323B0}')).not.toBeNull();
  });

  it('reports monotone progress that ends at 100/100', async () => {
    const seen: [number, number][] = [];
    await loadDictionary('/', { fetchText: readDataFile, onProgress: (a, b) => seen.push([a, b]) });
    expect(seen.length).toBeGreaterThan(3);
    expect(seen[seen.length - 1]).toEqual([100, 100]);
    for (let i = 1; i < seen.length; i++) expect(seen[i][0]).toBeGreaterThanOrEqual(seen[i - 1][0]);
    expect(new Set(seen.map((s) => s[1]))).toEqual(new Set([100]));
  });

  it('rejects when a required file is missing', async () => {
    await expect(
      loadDictionary('/', { fetchText: (n) => (n.startsWith('words') ? Promise.reject(new Error('gone')) : readDataFile(n)) }),
    ).rejects.toThrow('gone');
  });

  it('survives a missing meta.json', async () => {
    const d = await loadDictionary('/', { fetchText: (n) => (n === 'meta.json' ? Promise.reject(new Error('x')) : readDataFile(n)) });
    expect(d.meta.sources).toEqual([]);
    expect(d.lookup('你好').length).toBeGreaterThan(0);
  });

  describe('over HTTP (fetch + DecompressionStream)', () => {
    afterEach(() => vi.unstubAllGlobals());

    const serve = (mode: 'gz' | 'plain' | 'html404') => {
      vi.stubGlobal('fetch', async (url: string) => {
        const name = String(url).split('/').pop()!;
        if (name === 'chars-extra.tsv.gz' && mode === 'html404') {
          // Vite's dev server answers unknown paths with index.html and a 200.
          return new Response('<!doctype html><html><body>app</body></html>', { status: 200 });
        }
        if (name === 'chars-extra.tsv.gz') return new Response('nope', { status: 404 });
        const raw = await readFile(join(DATA_DIR, name));
        if (mode === 'plain' && name.endsWith('.gz')) return new Response(await readDataFile(name));
        return new Response(raw);
      });
    };

    it('reads gzip files', async () => {
      serve('gz');
      const d = await loadDictionary('http://localhost/data/');
      expect(d.lookup('你好')[0].pinyin).toBe('ni3 hao3');
      expect(d.char('\u{2F800}')!.compatOf).toBe('丽');
    });
    it('reads files a server already decompressed', async () => {
      serve('plain');
      const d = await loadDictionary('http://localhost/data');
      expect(d.hasWord('银行')).toBe(true);
    });
    it('treats an HTML fallback page for the optional file as missing', async () => {
      serve('html404');
      const d = await loadDictionary('http://localhost/data/');
      expect(d.meta.counts.extraLoaded).toBe(0);
      expect(d.hasWord('银行')).toBe(true);
    });
  });
});

describe('lookup / hasWord / freq', () => {
  it('finds a word in either script', async () => {
    const d = await dictP;
    const simp = d.lookup('银行');
    const trad = d.lookup('銀行');
    expect(simp.length).toBeGreaterThan(0);
    expect(trad).toEqual(simp);
    expect(simp[0]).toMatchObject({ simp: '银行', trad: '銀行' });
    expect(simp[0].pinyin).toBe('yin2 hang2');
    expect(simp[0].defs.length).toBeGreaterThan(0);
    expect(simp[0].defs[0]).toMatch(/bank/);
  });
  it('keeps every reading of a word, in file order, without duplicates', async () => {
    const d = await dictP;
    const e = d.lookup('地方');
    expect(e.map((x) => x.pinyin).sort()).toEqual(expect.arrayContaining(['di4 fang5']));
    expect(new Set(e).size).toBe(e.length);
    const la = d.lookup('了');
    expect(la.map((x) => x.pinyin)).toEqual(expect.arrayContaining(['le5', 'liao3']));
    // a headword that is both a traditional and a simplified form of different entries is listed once each
    const hou = d.lookup('后');
    expect(new Set(hou).size).toBe(hou.length);
  });
  it('returns copies, so callers may sort', async () => {
    const d = await dictP;
    const a = d.lookup('地方');
    a.reverse();
    a.length = 0;
    expect(d.lookup('地方').length).toBeGreaterThan(0);
  });
  it('normalizes compatibility ideographs and radicals before looking up', async () => {
    const d = await dictP;
    expect(d.hasWord('豈')).toBe(d.hasWord('豈'));
    expect(d.hasWord('⼈')).toBe(true); // Kangxi 人
    expect(d.lookup('⼈')).toEqual(d.lookup('人'));
    expect(d.lookup('⼈⼦').length).toBeGreaterThanOrEqual(0);
    // a compatibility ideograph inside a word
    const compatKe = '晴'; // 晴 is a compatibility ideograph for itself in some builds; just must not throw
    expect(() => d.lookup('天' + compatKe)).not.toThrow();
    expect(d.lookup('\u{2F800}')).toEqual(d.lookup('丽'));
    expect(d.freq('⼈')).toBe(d.freq('人'));
  });
  it('does not NFKC whole strings (full-width punctuation stays)', async () => {
    const d = await dictP;
    expect(d.hasWord('，')).toBe(false);
    expect(d.lookup('，')).toEqual([]);
    expect(d.toSimplified('你好，世界！')).toBe('你好，世界！');
  });
  it('returns nothing for unknown, empty and non-Han input', async () => {
    const d = await dictP;
    expect(d.lookup('')).toEqual([]);
    expect(d.lookup('xyzzy')).toEqual([]);
    expect(d.lookup('山山山山山山')).toEqual([]);
    expect(d.hasWord('')).toBe(false);
    expect(d.freq('山山山山山山')).toBe(0);
    expect(d.hsk('山山山山山山')).toBeNull();
  });
  it('exposes jieba counts', async () => {
    const d = await dictP;
    expect(d.freq('的')).toBeGreaterThan(d.freq('银行'));
    expect(d.freq('銀行')).toBe(d.freq('银行'));
    expect(d.freq('银行')).toBeGreaterThan(0);
  });
  it('lists words even for the 30 hand-added HSK rows, with numbered pinyin', async () => {
    const d = await dictP;
    expect(d.lookup('趁着')[0].pinyin).toBe('chen4 zhe5');
    expect(d.lookup('一番')[0].pinyin).toBe('yi4 fan1');
    expect(d.lookup('有劲儿')[0].pinyin).toBe('you3 jin4 r5');
    expect(d.lookup('不一会儿')[0].pinyin).toBe('bu4 yi1 hui3 r5');
    expect(d.lookup('这时候')[0].pinyin).toBe('zhe4 shi2 hou4');
    expect(d.lookup('难以想象')[0].pinyin).toBe('nan2 yi3 xiang3 xiang4');
    expect(d.lookup('纽扣儿').some((e) => e.pinyin === 'niu3 kou4 er5')).toBe(true);
    // every pinyin field in the dictionary is now ASCII-numbered (apart from names with a middle dot)
    const rows = await readRows('cedict');
    let bad = 0;
    for (const [, simp] of rows) {
      for (const e of d.lookup(simp)) if (/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(e.pinyin)) bad++;
    }
    expect(bad).toBe(0);
  });
  it('adds OpenCC spellings of traditional words as aliases', async () => {
    const d = await dictP;
    expect(d.meta.counts.tradAliases).toBeGreaterThan(1000);
    // 為/爲 and 裡/裏: whichever spelling CEDICT uses, both are found
    expect(d.hasWord('分爲')).toBe(d.hasWord('分為'));
    expect(d.hasWord('分爲')).toBe(true);
  });
});

describe('hsk', () => {
  it('maps words in either script to levels', async () => {
    const d = await dictP;
    expect(d.hsk('爱')).toMatchObject({ hsk3: 1 });
    expect(d.hsk('愛')).toEqual(d.hsk('爱'));
    expect(d.hsk('阿姨')).toMatchObject({ hsk3: 4, hsk2: 3 });
    expect(d.hsk('银行')!.hsk3).toBeGreaterThanOrEqual(1);
    expect(d.hsk('呵')).toMatchObject({ hsk2: 6 });
    expect(d.hsk('呵')!.hsk3).toBeUndefined();
    expect(d.hsk('𠀀')).toBeNull();
  });
  it('hskWords lists simplified words up to a level', async () => {
    const d = await dictP;
    const l1 = d.hskWords(1);
    const l3 = d.hskWords(3);
    const l7 = d.hskWords(7);
    expect(l1.length).toBeGreaterThan(400);
    expect(l1.length).toBeLessThan(700);
    expect(l3.length).toBeGreaterThan(l1.length);
    expect(l7.length).toBeGreaterThan(l3.length);
    expect(l1).toContain('爱');
    expect(l1).not.toContain('阿姨');
    expect(l3.slice(0, l1.length)).toEqual(l1); // lower levels come first
    expect(new Set(l7).size).toBe(l7.length);
    for (const w of l3) expect(d.hsk(w)!.hsk3!).toBeLessThanOrEqual(3);
    expect(d.hskWords(0)).toEqual([]);
    expect(d.hskWords(99)).toEqual(l7);
  });
});

describe('wordsAt', () => {
  it('lists dictionary words starting at an offset, longest first', async () => {
    const d = await dictP;
    const t = '中华人民共和国成立了';
    const w = d.wordsAt(t, 0);
    expect(w[0]).toBe('中华人民共和国');
    expect(w).toContain('中华');
    expect(w[w.length - 1]).toBe('中');
    for (let i = 1; i < w.length; i++) expect(w[i].length).toBeLessThan(w[i - 1].length);
    for (const x of w) expect(t.startsWith(x)).toBe(true);
  });
  it('always includes the single Han code point, even an unknown or astral one', async () => {
    const d = await dictP;
    expect(d.wordsAt('龘', 0)).toEqual(['龘']);
    expect(d.wordsAt('𠀀𪚥', 0)).toEqual(['𠀀']);
    expect(d.wordsAt('𠀀𪚥', 2)).toEqual(['𪚥']);
    expect(d.wordsAt('\u{323B0}', 0)).toEqual(['\u{323B0}']);
  });
  it('is code-point aware: never returns half of a surrogate pair', async () => {
    const d = await dictP;
    for (const w of d.wordsAt('𠀀银行', 2)) expect(w).toBe(w.normalize('NFC').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '?'));
    expect(d.wordsAt('𠀀银行', 2)[0]).toBe('银行');
  });
  it('returns [] outside the text and for non-Han non-words', async () => {
    const d = await dictP;
    expect(d.wordsAt('银行', 5)).toEqual([]);
    expect(d.wordsAt('银行', -1)).toEqual([]);
    expect(d.wordsAt('', 0)).toEqual([]);
    expect(d.wordsAt('，银行', 0)).toEqual([]);
    expect(d.wordsAt('zzz银行', 0)).toEqual([]);
  });
  it('sees through compatibility ideographs and Kangxi radicals', async () => {
    const d = await dictP;
    expect(d.wordsAt('⼈们', 0)[0]).toBe('⼈们');
  });
  it('finds mixed-script headwords when they start the text', async () => {
    const d = await dictP;
    expect(d.wordsAt('3D打印机', 0)[0]).toBe('3D打印机');
    expect(d.wordsAt('AA制', 0)).toContain('AA制');
  });
  it('knows traditional words as well as simplified', async () => {
    const d = await dictP;
    expect(d.wordsAt('圖書館裡', 0)[0]).toBe('圖書館');
    expect(d.wordsAt('图书馆里', 0)[0]).toBe('图书馆');
  });
});

describe('toSimplified / toTraditional', () => {
  it('converts characters and phrases with longest match', async () => {
    const d = await dictP;
    expect(d.toSimplified('長江是中國最長的河流')).toBe('长江是中国最长的河流');
    expect(d.toTraditional('长江是中国最长的河流')).toBe('長江是中國最長的河流');
    expect(d.toTraditional('头发')).toBe('頭髮');
    expect(d.toTraditional('发展')).toBe('發展');
    expect(d.toSimplified('頭髮')).toBe('头发');
    expect(d.toSimplified('發展')).toBe('发展');
    expect(d.toTraditional('皇后')).toBe('皇后');
    expect(d.toTraditional('王后和皇后')).toBe('王后和皇后');
    expect(d.toTraditional('后面')).toBe('後面');
    expect(d.toTraditional('以后')).toBe('以後');
  });
  it('leaves everything else untouched', async () => {
    const d = await dictP;
    for (const s of ['', 'abc 123', '你好，世界！', '「引用」', '𠀀𪚥', 'a\nb']) {
      expect(d.toSimplified(s)).toBe(s);
    }
    expect(d.toTraditional('Hello 学习 2024年')).toBe('Hello 學習 2024年');
    expect(d.toSimplified('\u{20000}龍\u{20001}')).toBe('\u{20000}龙\u{20001}');
  });
  it('round-trips ordinary text', async () => {
    const d = await dictP;
    const s = '他说这个问题很难，我们都觉得应该先学习汉语。';
    expect(d.toSimplified(d.toTraditional(s))).toBe(s);
  });
  it('does not cut surrogate pairs', async () => {
    const d = await dictP;
    expect(d.toTraditional('𠀀们')).toBe('𠀀們');
    expect(d.toSimplified('們𠀀')).toBe('们𠀀');
  });
});

describe('block table', () => {
  it('is sorted and non-overlapping', () => {
    for (let i = 1; i < HAN_BLOCKS.length; i++) expect(HAN_BLOCKS[i].start).toBeGreaterThan(HAN_BLOCKS[i - 1].end);
  });
  it('names the block of boundary code points', () => {
    expect(hanBlockName(0x3400)).toBe('CJK Unified Ideographs Extension A');
    expect(hanBlockName(0x4dbf)).toBe('CJK Unified Ideographs Extension A');
    expect(hanBlockName(0x4dc0)).toBeNull();
    expect(hanBlockName(0x4e00)).toBe('CJK Unified Ideographs');
    expect(hanBlockName(0x9fff)).toBe('CJK Unified Ideographs');
    expect(hanBlockName(0xa000)).toBeNull();
    expect(hanBlockName(0x323af)).toBe('CJK Unified Ideographs Extension H');
    expect(hanBlockName(0x323b0)).toBe('CJK Unified Ideographs Extension J');
    expect(hanBlockName(0x3347f)).toBe('CJK Unified Ideographs Extension J');
    expect(hanBlockName(0x33480)).toBeNull();
  });
});

describe('char()', () => {
  const oneFromEveryBlock: [string, number][] = [
    ['CJK Radicals Supplement', 0x2e80],
    ['Kangxi Radicals', 0x2f08],
    ['CJK Symbols and Punctuation', 0x3007],
    ['CJK Unified Ideographs Extension A', 0x3400],
    ['CJK Unified Ideographs', 0x4eba],
    ['CJK Compatibility Ideographs', 0xf900],
    ['CJK Unified Ideographs Extension B', 0x20000],
    ['CJK Unified Ideographs Extension C', 0x2a700],
    ['CJK Unified Ideographs Extension D', 0x2b740],
    ['CJK Unified Ideographs Extension E', 0x2b820],
    ['CJK Unified Ideographs Extension F', 0x2ceb0],
    ['CJK Unified Ideographs Extension I', 0x2ebf0],
    ['CJK Compatibility Ideographs Supplement', 0x2f800],
    ['CJK Unified Ideographs Extension G', 0x30000],
    ['CJK Unified Ideographs Extension H', 0x31350],
    ['CJK Unified Ideographs Extension J', 0x323b0],
  ];
  for (const [block, cp] of oneFromEveryBlock) {
    it(`${block} (U+${cp.toString(16).toUpperCase()})`, async () => {
      const d = await dictP;
      const info = d.char(String.fromCodePoint(cp));
      expect(info).not.toBeNull();
      expect(info!.block).toBe(block);
      expect(info!.char).toBe(String.fromCodePoint(cp));
      expect(Array.isArray(info!.readings)).toBe(true);
      expect(['unihan', 'wiktionary', 'variant', 'cedict', 'none']).toContain(info!.source);
    });
  }

  it('the end of Ext J and the whole range edges do not throw', async () => {
    const d = await dictP;
    for (const b of HAN_BLOCKS) {
      expect(d.char(String.fromCodePoint(b.start))!.block).toBe(b.name);
      expect(d.char(String.fromCodePoint(b.end))!.block).toBe(b.name);
    }
  });

  it('returns Unihan data for ordinary characters', async () => {
    const d = await dictP;
    const ren = d.char('人')!;
    expect(ren.readings[0]).toBe('rén');
    expect(ren.definition).toMatch(/man|people/);
    expect(ren.strokes).toBe(2);
    expect(ren.radical).toMatchObject({ num: '9', char: '人', residual: 0 });
    expect(ren.source).toBe('unihan');
    const hao = d.char('好')!;
    expect(hao.readings).toEqual(expect.arrayContaining(['hǎo', 'hào']));
    const mao = d.char('猫')!;
    expect(mao.traditional).toContain('貓');
    const mao2 = d.char('貓')!;
    expect(mao2.simplified).toContain('猫');
  });

  it('reads simplified-radical numbers (120\' is 纟)', async () => {
    const d = await dictP;
    const c = d.char('红')!;
    expect(c.radical).toMatchObject({ num: "120'", char: '纟' });
    expect(c.radical!.radicalChar).toBe('⺰');
  });

  it('maps compatibility ideographs to their unified character', async () => {
    const d = await dictP;
    const c = d.char('豈')!;
    expect(c.compatOf).toBe('豈');
    expect(c.block).toBe('CJK Compatibility Ideographs');
    expect(c.readings).toEqual(d.char('豈')!.readings);
    expect(c.readings.length).toBeGreaterThan(0);
    expect(c.definition).not.toBe('');
    const s = d.char('\u{2F800}')!;
    expect(s.compatOf).toBe('丽');
    expect(s.readings.length).toBeGreaterThan(0);
  });

  it('maps Kangxi radicals and CJK radicals to the ideograph', async () => {
    const d = await dictP;
    const k = d.char('⼈')!;
    expect(k.block).toBe('Kangxi Radicals');
    expect(k.compatOf).toBe('人');
    expect(k.readings[0]).toBe('rén');
    const s = d.char('⺰')!; // ⺰ simplified 纟
    expect(s.block).toBe('CJK Radicals Supplement');
    expect(s.compatOf).toBe('纟');
    expect(s.definition).not.toBe('');
  });

  it('knows 〇 from CC-CEDICT', async () => {
    const d = await dictP;
    const c = d.char('〇')!;
    expect(c.readings).toEqual(['líng']);
    expect(c.definition).toBe('zero');
  });

  it('returns null for anything that is not a Han character', async () => {
    const d = await dictP;
    for (const s of ['', 'a', '1', '。', 'あ', '한', '😀', ' ', '\ud800']) expect(d.char(s), JSON.stringify(s)).toBeNull();
  });

  it('uses the first code point of a longer string', async () => {
    const d = await dictP;
    expect(d.char('𠀀人')!.char).toBe('𠀀');
    expect(d.char('人𠀀')!.char).toBe('人');
  });

  it('returns a fresh object each time', async () => {
    const d = await dictP;
    const a = d.char('好')!;
    a.readings.push('zzz');
    a.variants.push('x');
    expect(d.char('好')!.readings).not.toContain('zzz');
  });

  it('falls back to Wiktionary, then to variants, and says so', async () => {
    const d = await dictP;
    const rows = await readRows('chars');
    let wik: string | null = null;
    let variant: string | null = null;
    for (const r of rows) {
      if (!r[1] && !r[7] && !r[5] && !r[6]) continue;
      const info = d.char(r[0])!;
      if (info.source === 'wiktionary' && !wik) wik = r[0];
      if (info.source === 'variant' && !variant) variant = r[0];
      if (wik && variant) break;
    }
    if (d.meta.counts.extraLoaded > 0) {
      expect(wik).not.toBeNull();
      const w = d.char(wik!)!;
      expect(w.readings.length + (w.definition ? 1 : 0)).toBeGreaterThan(0);
    }
    expect(variant).not.toBeNull();
    const v = d.char(variant!)!;
    expect(v.readings.length).toBeGreaterThan(0);
    const raw = rows.find((r) => r[0] === variant)!;
    expect(raw[1]).toBe('');
    // the borrowed reading really belongs to one of the listed forms
    const forms = [...v.simplified, ...v.traditional, ...v.variants].map((f) => d.char(f)!.readings).flat();
    expect(forms.some((r) => v.readings.includes(r))).toBe(true);
  });
});

describe('coverage over every row of chars.tsv', () => {
  it('char() is non-null with a block for each of the 102,999 rows, and merges the supplement', async () => {
    const d = await dictP;
    const rows = await readRows('chars');
    expect(rows.length).toBe(102999);
    let withReading = 0;
    let withDefinition = 0;
    let rawReading = 0;
    let rawDefinition = 0;
    const sources: Record<string, number> = {};
    for (const r of rows) {
      const info = d.char(r[0]);
      if (!info) throw new Error(`char(${r[0]}) is null`);
      if (!info.block) throw new Error(`char(${r[0]}) has no block`);
      if (info.char !== r[0]) throw new Error(`char(${r[0]}).char is ${info.char}`);
      if (r[1]) rawReading++;
      if (r[2]) rawDefinition++;
      if (info.readings.length) withReading++;
      if (info.definition) withDefinition++;
      sources[info.source] = (sources[info.source] ?? 0) + 1;
      if (info.source === 'variant' && info.readings.length === 0 && !info.definition) {
        throw new Error(`${r[0]}: source variant but nothing borrowed`);
      }
      if (info.source === 'none' && (info.readings.length || info.definition)) throw new Error(`${r[0]}: source none but has data`);
      if (r[8]) expect(info.compatOf).toBe(r[8]);
    }
    console.log('char coverage', { rows: rows.length, rawReading, rawDefinition, withReading, withDefinition, sources });
    expect(withReading).toBeGreaterThanOrEqual(rawReading);
    expect(withDefinition).toBeGreaterThanOrEqual(rawDefinition);
    expect(sources.variant ?? 0).toBeGreaterThan(0);
  });

  it('char() answers for every code point of every Han block without throwing', async () => {
    const d = await dictP;
    let n = 0;
    for (const b of HAN_BLOCKS) {
      for (let cp = b.start; cp <= b.end; cp++) {
        const info = d.char(String.fromCodePoint(cp));
        if (!info || info.block !== b.name) throw new Error(`U+${cp.toString(16)} -> ${info?.block}`);
        n++;
      }
    }
    expect(n).toBeGreaterThan(100000);
  });
});

describe('pinyinFor basics', () => {
  it('reads words from CC-CEDICT, lowercase, one syllable per code point', async () => {
    const d = await dictP;
    expect(d.pinyinFor('你好')).toEqual(['ni3', 'hao3']);
    expect(d.pinyinFor('北京')).toEqual(['bei3', 'jing1']);
    expect(d.pinyinFor('銀行')).toEqual(['yin2', 'hang2']);
    expect(d.pinyinFor('朋友')).toEqual(['peng2', 'you5']);
    expect(d.pinyinFor('女儿')).toEqual(['nü3', 'er2']);
    expect(d.pinyinFor('玩儿')).toEqual(['wan2', 'r5']);
  });
  it('gives "" for non-Han code points and keeps one entry per code point', async () => {
    const d = await dictP;
    expect(d.pinyinFor('')).toEqual([]);
    expect(d.pinyinFor('a')).toEqual(['']);
    expect(d.pinyinFor('A片')).toEqual(['', 'pian4']);
    expect(d.pinyinFor('AA制')).toEqual(['', '', 'zhi4']);
    expect(d.pinyinFor('11区')).toEqual(['', '', 'qu1']);
    expect(d.pinyinFor('亚西尔·阿拉法特')).toEqual(['ya4', 'xi1', 'er3', '', 'a1', 'la1', 'fa3', 'te4']);
    for (const w of ['𠀀𪚥', '人𠀀人', '3D打印机', '，银行。']) expect(d.pinyinFor(w)).toHaveLength([...w].length);
  });
  it('reads astral characters from Unihan', async () => {
    const d = await dictP;
    expect(d.pinyinFor('𠀀')).toEqual(['he1']);
    expect(d.pinyinFor('𪚥')).toEqual(['zhe2']);
    expect(d.pinyinFor('𰻞')).toEqual(['biang2']);
  });
  it('falls back to per-character readings for unknown words', async () => {
    const d = await dictP;
    expect(d.pinyinFor('山水人')).toEqual(['shan1', 'shui3', 'ren2']);
    expect(d.pinyinFor('龘龘')).toHaveLength(2);
  });
  it('normalizes compatibility ideographs and radicals', async () => {
    const d = await dictP;
    expect(d.pinyinFor('⼈')).toEqual(d.pinyinFor('人'));
    expect(d.pinyinFor('豈')).toEqual(d.pinyinFor('豈'));
  });
  it('gives characters with no reading anywhere an empty string, not a guess', async () => {
    const d = await dictP;
    const rows = await readRows('chars');
    const bare = rows.find((r) => !r[1] && !r[5] && !r[6] && !r[8] && d.char(r[0])!.source === 'none')!;
    expect(d.pinyinFor(bare[0])).toEqual(['']);
  });
  it('prefers a real reading over a variant-of entry', async () => {
    const d = await dictP;
    expect(d.pinyinFor('衹')).toEqual(['zhi3']);
  });
});
