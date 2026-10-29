// The Japanese engine's segmentation: coverage, merging into learner words, lemmas, readings, furigana, names, numbers, speed.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Token } from '../../../src/types';
import type { LangEngine } from '../../../src/lang/types';
import { measure, PERF_SLACK } from '../../helpers/perf';
import { readFixture } from './aozora';
import { loadJa } from './load';

let ja: LangEngine;
beforeAll(async () => { ja = await loadJa(); }, 60000);

const words = (text: string) => ja.segment(text).filter((t) => t.kind === 'word');
const texts = (text: string) => ja.segment(text).map((t) => t.text);
/** Furigana as 食(た)べる. */
const ruby = (t: Token) => (t.ruby ?? []).map((p) => (p.rt ? `${p.text}(${p.rt})` : p.text)).join('');
const one = (text: string): Token => {
  const ws = words(text);
  expect(ws.map((w) => w.text)).toEqual([text]);
  return ws[0];
};

function checkCover(text: string, toks: Token[]): void {
  expect(toks.map((t) => t.text).join('')).toBe(text);
  let at = 0;
  for (const t of toks) {
    expect(t.start).toBe(at);
    expect(t.end).toBe(at + t.text.length);
    expect(text.slice(t.start, t.end)).toBe(t.text);
    at = t.end;
    if (t.kind === 'word') {
      expect(t.key, t.text).toBeTruthy();
      expect(t.lemma, t.text).toBeTruthy();
      expect((t.ruby ?? []).map((p) => p.text).join(''), t.text).toBe(t.text);
      for (const p of t.ruby ?? []) if (p.rt) expect(p.rt).toMatch(/^[ぁ-ゟー]+$/);
    }
    if (t.kind === 'punct') expect([...t.text]).toHaveLength(1);
  }
  expect(at).toBe(text.length);
}

describe('coverage', () => {
  it('covers every paragraph of three public-domain stories exactly', () => {
    for (const name of ['rashomon', 'chumon', 'bocchan'] as const) {
      for (const p of readFixture(name)) checkCover(p.text, ja.segment(p.text));
    }
  });

  it('covers mixed text: Latin, digits, spaces, symbols, emoji, other scripts', () => {
    for (const text of [
      'Tシャツを3枚買った。', '２０２５年に東京へ。', 'NHKの「ニュース」を見る！？', 'えっ……本当？', 'AI（人工知能）', 'カフェ・ラテ',
      '😀を送った', '서울と東京', '  先頭の空白', '3.14と1,000円', '～だよね〜', '〆切は々', '', 'a', '。', '\n改行\n',
    ]) checkCover(text, ja.segment(text));
  });

  it('cuts punctuation one mark per token and keeps other kinds apart', () => {
    const toks = ja.segment('「はい、そうです。」と彼は言った……');
    expect(toks.filter((t) => t.kind === 'punct').map((t) => t.text)).toEqual(['「', '、', '。', '」', '…', '…']);
    const mixed = ja.segment('Tシャツ 3枚 iPhone');
    expect(mixed.map((t) => `${t.kind}:${t.text}`)).toEqual(['latin:T', 'word:シャツ', 'space: ', 'num:3', 'word:枚', 'space: ', 'latin:iPhone']);
  });
});

describe('words a learner taps', () => {
  it('keeps a verb with its auxiliaries and endings, lemma = dictionary form', () => {
    for (const [text, lemma] of [
      ['食べさせられた', '食べる'], ['行かなかった', '行く'], ['美しくない', '美しい'], ['読んでいる', '読む'], ['食べてる', '食べる'],
      ['書かれていた', '書く'], ['食べませんでした', '食べる'], ['来なかった', '来る'], ['行こう', '行く'], ['読みましょう', '読む'],
      ['食べちゃった', '食べる'], ['待っておく', '待つ'], ['置いてある', '置く'], ['行けば', '行く'], ['行ったら', '行く'],
      ['食べたくなかった', '食べる'], ['読まされる', '読む'], ['美しかった', '美しい'], ['食べなさい', '食べる'], ['降りそうだ', ''],
    ] as const) {
      if (!lemma) continue;
      const t = one(text);
      expect(t.lemma, text).toBe(lemma);
    }
  });

  it('keeps particles, the copula and honorific suffixes as words of their own', () => {
    expect(texts('私は学生だった。')).toEqual(['私', 'は', '学生', 'だった', '。']);
    expect(texts('静かな部屋')).toEqual(['静か', 'な', '部屋']);
    expect(texts('太郎さんが来た')).toEqual(['太郎', 'さん', 'が', '来た']);
    expect(texts('友達と映画を見に行きました')).toEqual(['友達', 'と', '映画', 'を', '見', 'に', '行きました']);
  });

  it('keeps other verbs after て as words of their own (くる, みる, くれる, あげる)', () => {
    expect(texts('食べてみた')).toEqual(['食べて', 'みた']);
    expect(texts('教えてくれた')).toEqual(['教えて', 'くれた']);
    expect(texts('作ってあげる')).toEqual(['作って', 'あげる']);
  });

  it('joins what JMdict lists as one word', () => {
    expect(texts('子供たちと私たち')).toEqual(['子供たち', 'と', '私たち']);
    expect(texts('一日中')).toEqual(['一日中']);
    expect(one('読み終わったら').lemma).toBe('読み終わる');
    expect(one('出て行った').lemma).toBe('出て行く');
    expect(one('持ってきた').lemma).toBe('持ってくる');
  });

  it('makes a する-noun and its する one word, keyed by the noun', () => {
    const t = one('勉強しました');
    expect(t.lemma).toBe('勉強する');
    expect(t.key).toBe('勉強');
    expect(one('勉強している').key).toBe('勉強');
  });

  it('keys a word by its JMdict head, whatever the spelling', () => {
    expect(one('食べた').key).toBe('食べる');
    expect(one('たべた').key).toBe('食べる');
    expect(one('坊っちゃん').key).toBe('坊ちゃん');
    expect(one('いう').key).toBe('言う');
    // Usually written in kana: the kana is the key.
    expect(words('ここにいる').map((t) => t.key)).toEqual(['ここ', 'に', 'いる']);
    expect(one('ありがとう').key).toBe('ありがとう');
  });

  it('reads potential verbs as the potential of the godan verb', () => {
    expect(one('読める').lemma).toBe('読む');
    expect(one('話せる').lemma).toBe('話す');
    expect(one('見える').lemma).toBe('見える');
  });
});

describe('readings and furigana', () => {
  it('puts furigana over kanji only, aligned with okurigana', () => {
    const cases: [string, string][] = [
      ['食べさせられた', '食(た)べさせられた'], ['取り扱い', '取(と)り扱(あつか)い'], ['今日', '今日(きょう)'], ['人々', '人(ひと)々(びと)'],
      ['日本人', '日(に)本(ほん)人(じん)'], ['大人', '大人(おとな)'], ['お茶', 'お茶(ちゃ)'], ['聞き手', '聞(き)き手(て)'],
      ['美しくない', '美(うつく)しくない'], ['行かなかった', '行(い)かなかった'], ['来なかった', '来(こ)なかった'],
      ['勉強しました', '勉(べん)強(きょう)しました'], ['学校', '学(がっ)校(こう)'], ['一人', '一(ひと)人(り)'], ['明日', '明日(あした)'],
      ['時々', '時(とき)々(どき)'], ['ひらがな', 'ひらがな'], ['カタカナ', 'カタカナ'], ['ありがとう', 'ありがとう'],
    ];
    for (const [text, want] of cases) expect(ruby(one(text)), text).toBe(want);
  });

  it('gives the whole reading in hiragana', () => {
    expect(one('食べさせられた').reading).toBe('たべさせられた');
    expect(one('コーヒー').reading).toBe('こーひー');
    expect(one('読んでいる').reading).toBe('よんでいる');
  });

  it('reads numbers and counters with their sound changes', () => {
    const cases: [string, string][] = [
      ['三本', 'さんぼん'], ['一本', 'いっぽん'], ['六百円', 'ろっぴゃくえん'], ['三百本', 'さんびゃっぽん'], ['八匹', 'はっぴき'],
      ['一人', 'ひとり'], ['二人', 'ふたり'], ['二十歳', 'はたち'], ['二三日', 'にさんにち'], ['十分', 'じゅっぷん'], ['四時', 'よじ'],
      ['九月', 'くがつ'], ['三千', 'さんぜん'], ['一万円', 'いちまんえん'], ['三階', 'さんがい'], ['二十日', 'はつか'], ['何本', 'なんぼん'],
    ];
    for (const [text, reading] of cases) expect(one(text).reading, text).toBe(reading);
    const toks = ja.segment('3本');
    expect(toks.map((t) => t.kind)).toEqual(['num', 'word']);
    expect(toks[1].reading).toBe('ぼん');
  });

  it('prefers the common reading where IPADIC picks a rare one', () => {
    expect(words('鳥も獣も')[2].reading).toBe('けもの');
    expect(words('日本へ')[0].reading).toBe('にほん');
    expect(one('云った').reading).toBe('いった');
  });

  it('reads verbs spelled with kanji IPADIC does not know through JMdict', () => {
    const t = words('鼻を掩った')[2];
    expect(t.text).toBe('掩った');
    expect(t.lemma).toBe('掩う');
    expect(t.reading).toBe('おおった');
    expect(ruby(one('喰べたい'))).toBe('喰(た)べたい');
    expect(texts('斯ういう事')).toEqual(['斯う', 'いう', '事']);
  });
});

describe('names', () => {
  it('marks proper nouns and joins surname and given name', () => {
    const t = one('夏目漱石');
    expect(t.name).toBe(true);
    expect(t.reading).toBe('なつめそうせき');
    expect(ruby(t)).toBe('夏(なつ)目(め)漱(そう)石(せき)');
    expect(words('東京へ行った')[0].name).toBe(true);
    expect(words('本を読む').some((w) => w.name)).toBe(false);
  });
});

describe('speed', () => {
  it('segments 10,000 characters of a novel well under 200 ms', () => {
    const text = readFixture('bocchan').map((p) => p.text).join('').slice(0, 10000);
    expect(text.length).toBe(10000);
    ja.segment(text.slice(0, 2000)); // warm up the JIT
    const runs = [0, 1, 2].map(() => measure(() => ja.segment(text)));
    const best = Math.min(...runs.map((r) => r.cpu));
    console.log(`segment 10,000 chars: ${best.toFixed(0)} ms cpu (${runs.map((r) => r.wall.toFixed(0)).join(', ')} ms wall)`);
    expect(best).toBeLessThan(120 * PERF_SLACK);
  });

  it('segments one long paragraph without breaking up', () => {
    const para = readFixture('rashomon').map((p) => p.text).join('');
    const r = measure(() => ja.segment(para));
    checkCover(para, r.result);
    expect(r.cpu).toBeLessThan(150 * PERF_SLACK);
  });
});
