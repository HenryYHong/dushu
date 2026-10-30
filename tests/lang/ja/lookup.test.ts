// The Japanese engine's lookups: the right entry first, inflections explained, kanji, names, normalize, levels, hints, meta.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Token } from '../../../src/types';
import type { LangEngine, WordLookup } from '../../../src/lang/types';
import { readFixture } from './aozora';
import { loadJa } from './load';

let ja: LangEngine;
beforeAll(async () => { ja = await loadJa(); }, 60000);

/** The token `word` in `sentence`, as the reader would hand it to lookup. */
function tok(sentence: string, word: string): Token {
  const t = ja.segment(sentence).find((x) => x.text === word);
  if (!t) throw new Error(`${word} is not a token of ${sentence}: ${ja.segment(sentence).map((x) => x.text).join('|')}`);
  return t;
}
const tap = (sentence: string, word: string): WordLookup => ja.lookup(word, { token: tok(sentence, word) });
const first = (l: WordLookup) => l.entries[0];

describe('lookup of a tapped word', () => {
  it('puts the entry meant first: reading and part of speech decide', () => {
    expect(first(tap('生ビールを飲む', '生ビール')).reading).toBe('なまビール');
    expect(first(tap('長く生きる', '生きる')).head).toBe('生きる');
    expect(first(tap('生の魚', '生')).reading).toBe('なま');
    expect(first(tap('こっちの方がいい', '方')).reading).toBe('ほう');
    expect(first(tap('お金が要る', '要る')).senses[0].glosses[0]).toMatch(/needed/);
    expect(first(tap('ここにいる', 'いる')).senses[0].glosses[0]).toMatch(/^to be/);
    expect(first(tap('お茶を飲みます', '飲みます')).head).toBe('飲む');
  });

  it('explains the form of an inflected word in plain English', () => {
    const cases: [string, string, string][] = [
      ['昨日食べた', '食べた', 'past tense'], ['肉は食べない', '食べない', 'negative'], ['食べなかった', '食べなかった', 'negative past'],
      ['パンを食べました', '食べました', 'polite past'], ['肉を食べません', '食べません', 'polite negative'],
      ['何も食べませんでした', '食べませんでした', 'polite negative past'], ['食べて寝る', '食べて', 'te-form'],
      ['本が読める', '読める', 'potential'], ['先生に褒められた', '褒められた', 'passive or potential past'],
      ['手紙が書かれた', '書かれた', 'passive past'], ['子供に読ませる', '読ませる', 'causative'],
      ['野菜を食べさせられた', '食べさせられた', 'causative-passive past'], ['一緒に行こう', '行こう', 'volitional'],
      ['雨が降れば', '降れば', 'conditional (ba)'], ['家に帰ったら', '帰ったら', 'conditional (tara)'],
      ['本を読んでいる', '読んでいる', 'progressive (te iru)'], ['本を読んでいた', '読んでいた', 'progressive (te iru), past'],
      ['全部読んでしまった', '読んでしまった', 'completed (te shimau), past'], ['とても美しかった', '美しかった', 'past tense'],
      ['美しくない', '美しくない', 'negative'], ['早く起きろ', '起きろ', 'imperative'], ['寿司が食べたい', '食べたい', 'want to (tai)'],
    ];
    for (const [sentence, word, form] of cases) {
      const l = tap(sentence, word);
      expect(l.form, `${word} in ${sentence}`).toBe(form);
    }
    expect(tap('寿司を食べる', '食べる').form).toBeUndefined();
  });

  it('gives the key of the token and the word on the page', () => {
    const l = tap('野菜を食べさせられた', '食べさせられた');
    expect(l.key).toBe('食べる');
    expect(l.surface).toBe('食べさせられた');
    expect(first(l)).toMatchObject({ head: '食べる', reading: 'たべる', source: 'JMdict', level: 1, common: true });
    expect(first(l).senses[0]).toMatchObject({ pos: 'verb (ichidan), transitive', glosses: ['to eat'] });
  });

  it('lists each kanji of the word once, with readings and meanings', () => {
    const l = tap('人々が食べ物を食べる', '食べ物');
    expect(l.chars?.map((c) => c.char)).toEqual(['食', '物']);
    const shoku = l.chars![0];
    expect(shoku.meanings).toContain('eat');
    expect(shoku.on).toContain('ショク');
    expect(shoku.kun).toContain('た.べる');
    expect(shoku).toMatchObject({ strokes: 9, grade: 2 });
    expect(tap('ここにいる', 'いる').chars ?? []).toEqual([]);
  });

  it('shows usage notes and parts of speech in plain English', () => {
    const l = tap('ここにいる', 'いる');
    expect(first(l).senses[0].notes).toContain('usually written in kana');
    expect(first(l).senses[0].pos).toBe('verb (ichidan), intransitive');
    expect(first(tap('静かな部屋', '静か')).senses[0].pos).toMatch(/^adjective \(na\)/);
  });

  it('picks the sense of a particle its use points to', () => {
    expect(first(tap('田中と山田', 'と')).senses[0].glosses[0]).toBe('and');
    expect(first(tap('雨が降ると寒い', 'と')).senses[0].glosses[0]).toBe('if');
    expect(first(tap('高いが美味しい', 'が')).senses[0].glosses[0]).toBe('but');
    expect(first(tap('寒いから帰る', 'から')).senses[0].glosses[0]).toBe('because');
    expect(first(tap('東京から来た', 'から')).senses[0].glosses[0]).toBe('from');
  });

  it('keeps homophones out of a particle lookup', () => {
    const l = tap('私は学生', 'は');
    expect(l.entries).toHaveLength(1);
  });

  it('marks names the dictionary does not list, with their reading', () => {
    const l = tap('勘太郎は逃げた', '勘太郎');
    expect(l.name).toBe(true);
    expect(first(l)).toMatchObject({ head: '勘太郎', reading: 'かんたろう', source: 'name' });
    // A name JMdict has is looked up like any word.
    const tokyo = tap('東京へ行った', '東京');
    expect(tokyo.name).toBeUndefined();
    expect(first(tokyo).source).toBe('JMdict');
  });

  it('looks up a token without the token object it came from (a token rebuilt by the UI)', () => {
    const t = tok('野菜を食べさせられた', '食べさせられた');
    const copy: Token = JSON.parse(JSON.stringify(t));
    const l = ja.lookup(copy.text, { token: copy });
    expect(first(l).head).toBe('食べる');
    expect(l.form).toBe('causative-passive past');
  });
});

describe('lookup of a selection that is not one token', () => {
  it('finds an exact headword first', () => {
    const l = ja.lookup('日本語');
    expect(first(l).head).toBe('日本語');
    expect(l.form).toBeUndefined();
  });

  it('deinflects what has no entry of its own', () => {
    const l = ja.lookup('食べさせられなかった');
    expect(first(l).head).toBe('食べる');
    expect(l.form).toBe('causative-passive negative past');
    expect(l.key).toBe('食べる');
    expect(first(ja.lookup('行かなかった')).head).toBe('行く');
    expect(first(ja.lookup('美しくなかった')).head).toBe('美しい');
    expect(first(ja.lookup('勉強しました')).head).toBe('勉強');
  });

  it('puts a common inflection before a rare exact entry', () => {
    // 来た is also a rare interjection; the past of 来る comes first.
    expect(first(ja.lookup('来た')).head).toBe('来る');
  });

  it('returns no entries for a span that is not a word', () => {
    expect(ja.lookup('本を読').entries).toEqual([]);
  });
});

describe('normalize', () => {
  it('gives the dictionary form of any form of a word', () => {
    expect(ja.normalize('食べた')).toBe('食べる');
    expect(ja.normalize('食べさせられなかった')).toBe('食べる');
    expect(ja.normalize('たべる')).toBe('食べる');
    expect(ja.normalize('食べる')).toBe('食べる');
    expect(ja.normalize(' 読んでいる ')).toBe('読む');
    expect(ja.normalize('勉強した')).toBe('勉強');
    expect(ja.normalize('子供')).toBe('子供');
    expect(ja.normalize('子ども')).toBe('子供');
    expect(ja.normalize('xyz')).toBe('xyz');
  });

  it('keeps every key the reader produces as it is', () => {
    const keys = new Set<string>();
    for (const name of ['rashomon', 'chumon', 'bocchan'] as const) {
      for (const p of readFixture(name)) for (const t of ja.segment(p.text)) if (t.kind === 'word' && t.key) keys.add(t.key);
    }
    expect(keys.size).toBeGreaterThan(1000);
    const moved = [...keys].filter((k) => ja.normalize(k) !== k);
    expect(moved).toEqual([]);
  });
});

describe('levels, hints, meta', () => {
  it('knows JLPT levels (N5 = 1)', () => {
    expect(ja.level('食べる')).toBe(1);
    expect(ja.level('勉強')).toBe(1);
    // Waller lists 経済 at N4.
    expect(ja.level('経済')).toBe(2);
    expect(ja.level('羅生門')).toBeUndefined();
    const n5 = ja.levelWords(1);
    const all = ja.levelWords(5);
    expect(n5.length).toBeGreaterThan(500);
    expect(n5).toContain('食べる');
    expect(all.length).toBeGreaterThan(6000);
    expect(new Set(all).size).toBe(all.length);
    for (const k of n5) expect(all).toContain(k);
    // Every listed word has its level under its own key.
    for (const k of n5.slice(0, 200)) expect(ja.level(k)).toBe(1);
  });

  it('gives a short hint over a word', () => {
    expect(ja.hint(tok('パンを食べた', '食べた'))).toBe('to eat');
    expect(ja.hint(tok('大きな家', '家'))).toBe('house');
    expect(ja.hint(tok('本を読む', '本'))).toBe('book');
    for (const p of readFixture('rashomon').slice(0, 5)) {
      for (const t of ja.segment(p.text)) {
        const h = t.kind === 'word' ? ja.hint(t) : undefined;
        if (h) { expect(h).not.toMatch(/[()]/); expect(h.split(' ').length).toBeLessThanOrEqual(4); }
      }
    }
    expect(ja.hint({ text: '。', start: 0, end: 1, kind: 'punct', inDict: false })).toBeUndefined();
  });

  it('describes its data and every license', () => {
    expect(ja.meta.built).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(ja.meta.counts.entries).toBeGreaterThan(200000);
    expect(ja.meta.counts.kanji).toBeGreaterThan(10000);
    const names = ja.meta.sources.map((s) => s.name).join(' | ');
    for (const want of ['JMdict', 'KANJIDIC2', 'JLPT', 'IPADIC', 'kuromoji']) expect(names).toContain(want);
    for (const s of ja.meta.sources) { expect(s.license).toBeTruthy(); expect(s.url).toMatch(/^https?:\/\//); }
  });
});
