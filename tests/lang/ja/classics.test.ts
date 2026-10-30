// What a reader of the Japanese classics meets, sentence by sentence, after a native reader's audit of 蜘蛛の糸, 杜子春 and
// 坊っちゃん (no publisher's ruby here: the engine's own reading). Each test is one rule, shown on the sentences it was found in.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Token } from '../../../src/types';
import type { LangEngine, WordLookup } from '../../../src/lang/types';
import { loadJa } from './load';

let ja: LangEngine;
beforeAll(async () => { ja = await loadJa(); }, 60000);
beforeEach(() => ja.beginBook?.());

function tok(sentence: string, word: string): Token {
  const t = ja.segment(sentence).find((x) => x.text === word);
  if (!t) throw new Error(`${word} is not a token of ${sentence}: ${ja.segment(sentence).map((x) => x.text).join('|')}`);
  return t;
}
const tap = (sentence: string, word: string): WordLookup => ja.lookup(word, { token: tok(sentence, word) });
const gloss = (sentence: string, word: string) => tap(sentence, word).entries[0]?.senses[0]?.glosses[0];
const furigana = (t: Token) => (t.ruby ?? []).map((p) => (p.rt ? `${p.text}(${p.rt})` : p.text)).join('');

describe('grammar words', () => {
  it('reads the の that makes a clause a noun, and the ん of explanation, as the particle の (not 野 "field")', () => {
    const s = 'はっきりと見えるのでございます。';
    expect(tok(s, 'の').key).toBe('の');
    expect(gloss(s, 'の')).toMatch(/nominaliz/);
    const n = '何が駄目なんだか今に分らない。';
    expect(tok(n, 'ん').key).toBe('の');
    expect(tap(n, 'ん').form).toBe('contraction');
    // The possessive の stays possessive.
    expect(gloss('極楽の蓮池のふちを', 'の')).toMatch(/possessive/);
  });

  it('takes じゃ after a noun for the copula, and for "well then" only where a sentence starts', () => {
    expect(gloss('商買をしたって面倒くさくって旨く出来るものじゃなし、ことに六百円の金で', 'じゃ')).toBe('be');
    expect(gloss('人じゃありません', 'じゃ')).toBe('be');
    expect(gloss('それじゃ、また', 'じゃ')).toMatch(/then/);
  });

  it('reads 位 after a verb as the particle くらい', () => {
    const s = '今は財産を費い尽して、その日の暮しにも困る位、憐な身分になっているのです。';
    expect(tok(s, '位').key).toBe('くらい');
    expect(gloss('こんな思いをして生きている位なら、一そ川へでも身を投げて', '位')).toMatch(/approximately|extent/);
  });
});

describe('words written in kana', () => {
  it('reads a kana word as its most basic word, not a rare one usually written in kana', () => {
    expect(tok('勘太郎が落ちるときに、おれの袷の片袖がもげて、急に手が自由になった。', 'とき').key).toBe('時');
    expect(tok('きのうこの敷石の上を車でがらがらと通った時は', 'きのう').key).toBe('昨日');
    expect(tok('御釈迦様は極楽の蓮池のふちを、独りでぶらぶら御歩きになっていらっしゃいました。', 'ふち').key).toBe('縁');
    expect(tok('何とも云えない好い匂が、絶間なくあたりへ溢れて居ります。', 'あたり').key).toBe('辺り');
    expect(tok('その命を無暗にとると云う事は、いくら何でも可哀そうだ。', 'とる').key).toBe('取る');
    expect(tok('大工の兼公と肴屋の角をつれて、茂作の人参畠をあらした事がある。', 'つれて').key).toBe('連れる');
    expect(tok('世話をしてくれるにしたところで、喧嘩をするから', 'ところ').key).toBe('所');
    // Usually written in kana and the most basic: いる, ある, なる keep their kana entries.
    expect(tok('ここにいる', 'いる').key).toBe('いる');
    expect(gloss('ここにいる', 'いる')).toMatch(/^to be/);
  });

  it('keeps 要る for いらない, which only it can be', () => {
    expect(gloss('いや、お金はもういらないのです', 'いらない')).toMatch(/needed/);
  });
});

describe('senses, readings and names', () => {
  it('shows first the senses of the part of speech the word has on the page', () => {
    expect(gloss('後にはただ極楽の蜘蛛の糸が、きらきらと細く光りながら', 'ただ')).toMatch(/^only/);
    expect(gloss('たまに聞えるものと云っては、ただ罪人がつく微な嘆息ばかりでございます。', 'ただ')).toMatch(/^only/);
    expect(gloss('水の面を蔽っている蓮の葉の間から、ふと下の容子を御覧になりました。', '御覧')).toMatch(/seeing|look/);
    expect(gloss('それにもかかわらずあまりおやじを怖いとは思わなかった。', 'あまり')).toMatch(/not.*very/);
  });

  it('reads 間, 中 and 後 by the words around them', () => {
    expect(tok('水の面を蔽っている蓮の葉の間から、ふと下の容子を御覧になりました。', '間').reading).toBe('あいだ');
    expect(tok('見る見る中に暗の底へ、まっさかさまに落ちてしまいました。', '中').reading).toBe('うち');
    expect(tok('自分ののぼった後をつけて、まるで蟻の行列のように', '後').reading).toBe('あと');
    expect(tok('後にはただ極楽の蜘蛛の糸が', '後').reading).toBe('あと');
    // 池の中 is なか, and その後 stays ご.
    expect(tok('池の中に咲いている蓮の花は', '中').reading).toBe('なか');
  });

  it('reads a suffix with nothing before it to attach to as the noun (音 おと, 下 した, 川 かわ)', () => {
    expect(tok('ぷつりと音を立てて断れました。', '音').reading).toBe('おと');
    expect(tok('玉のような白蓮の間から、遥か下にある地獄の底へ', '下').reading).toBe('した');
    expect(tok('一そ川へでも身を投げて、死んでしまった方がましかも知れない', '川').reading).toBe('かわ');
  });

  it('keeps a kanji’s own reading that JMdict does not mark common (縁 えん "fate")', () => {
    const s = '何も縁だと思って規則書をもらってすぐ入学の手続きをしてしまった。';
    expect(tok(s, '縁').reading).toBe('えん');
    expect(gloss(s, '縁')).toMatch(/fate|karma/);
    // A rare reading still gives way: 獣 is けもの, not しし; 民 たみ, not みん, which no list has.
    expect(ja.segment('鳥も獣も').find((t) => t.text === '獣')!.reading).toBe('けもの');
    expect(tok('昔小学校へ行く時分、浅井の民さんと云う子が同級生にあったが', '民').reading).toBe('たみ');
  });

  it('reads 御 as お before a word the dictionary knows with お only, and before a verb stem in 御…になる', () => {
    const s = '御釈迦様はその蜘蛛の糸をそっと御手に御取りになって';
    const toks = ja.segment(s);
    const mi = toks.findIndex((t) => t.text === '取り');
    expect(furigana(toks[mi - 1])).toBe('御(お)');
    expect(furigana(tok('するとその地獄の底に、犍陀多と云う男が一人、ほかの罪人と一しょに蠢いている姿が、御眼に止まりました。', '御'))).toBe('御(お)');
    expect(furigana(tok('御存知の通り', '御存知'))).toBe('御(ご)存(ぞん)知(じ)');
  });

  it('keeps a name whose only dictionary entries are history (清, not the Qing dynasty) and drops one that is a plain word', () => {
    const s = '十年来召し使っている清という下女が、泣きながらおやじに詫まって、ようやくおやじの怒りが解けた。';
    expect(tok(s, '清').name).toBe(true);
    expect(tap(s, '清').entries.map((e) => e.senses[0].glosses[0]).join(' ')).not.toMatch(/Qing/);
    expect(ja.hint(tok(s, '清'))).toBeUndefined();
    // IPADIC names that JMdict has as plain words read the same way: 大王 "great king", 風の音.
    expect(tok('これは兼ねて噂に聞いた、大王に違いありません。', '大王').name).toBeUndefined();
    expect(tok('風の音、雨のしぶき、それから絶え間ない稲妻の光', '風の音').name).toBeUndefined();
    // A name that is also a common word read another way is the word: 大分 だいぶ, not Ōita.
    expect(tok('この方は大分金になったようだが、詳しい事は一向知らぬ。', '大分')).toMatchObject({ reading: 'だいぶ' });
    expect(tok('この方は大分金になったようだが', '大分').name).toBeUndefined();
    // A place that JMdict lists read the same way stays a place.
    expect(tok('東京へ行った', '東京').name).toBe(true);
  });
});

describe('words IPADIC cuts up', () => {
  it('joins old okurigana to its kanji (賞める, 恐しい, 極って, 驚ろいて, 悪るく)', () => {
    expect(tok('あなたは真っ直でよいご気性だ」と賞める事が時々あった。', '賞める')).toMatchObject({ key: '褒める', reading: 'ほめる' });
    const fear = tok('それは恐しい針の山の針が光るのでございますから', '恐しい');
    expect(fear).toMatchObject({ key: '恐ろしい', reading: 'おそろしい' });
    expect(furigana(fear)).toBe('恐(おそろ)しい');
    expect(tok('向うでも何とか云い出すに極っている。', '極っている')).toMatchObject({ key: '決まる', reading: 'きまっている' });
    const surprised = tok('田舎者はしみったれだから五円もやれば驚ろいて眼を廻すに極っている。', '驚ろいて');
    expect(surprised).toMatchObject({ key: '驚く', reading: 'おどろいて' });
    expect(furigana(surprised)).toBe('驚(おど)ろいて');
    expect(tok('あんな奴を教えるのかと思ったら何だか気味が悪るくなった。', '気味が悪るく')).toMatchObject({ key: '気味が悪い', reading: 'きみがわるく' });
  });

  it('keeps phrases whole across particles and endings: must, must not, may, as usual, from the first, very', () => {
    const must = tap('元の地獄へ逆落しに落ちてしまわなければなりません。', '落ちてしまわなければなりません');
    expect(must.key).toBe('落ちる');
    expect(must.form).toBe('completed (te shimau), must (nakereba naranai), polite');
    expect(tap('隠してはいけません', '隠してはいけません').form).toBe('must not (te wa ikenai), polite');
    const may = tok('一そ川へでも身を投げて、死んでしまった方がましかも知れない', 'かも知れない');
    expect(may.key).toBe('かもしれない');
    expect(gloss('死んでしまった方がましかも知れない', 'かも知れない')).toMatch(/may/);
    expect(tok('しかし杜子春は相変らず、門の壁に身を凭せて、ぼんやり空ばかり眺めていました。', '相変らず').key).toBe('相変わらず');
    expect(tok('元より大泥坊の事でございますから、こう云う事には昔から、慣れ切っているのでございます。', '元より').key).toBe('もとより');
    expect(gloss('この婆さんがどういう因縁か、おれを非常に可愛がってくれた。', '非常に')).toBe('very');
    // その時に is "at that time": nothing joins a word something modifies.
    expect(ja.segment('その時に').map((t) => t.text)).toEqual(['その', '時', 'に']);
  });

  it('keeps a verb after a stem that only adds to it in the word, with its meaning as the form', () => {
    const used = tap('元より大泥坊の事でございますから、こう云う事には昔から、慣れ切っているのでございます。', '慣れ切っている');
    expect(used.key).toBe('慣れる');
    expect(used.form).toBe('completely (kiru), progressive (te iru)');
    expect(tap('さすがに贅沢家の杜子春も、一年二年と経つ内には、だんだん貧乏になり出しました。', 'なり出しました').form).toBe('start to (dasu), polite past');
    // なさる is a command only as なさい.
    expect(tap('まっすぐにそれを御下しなさいました。', '下しなさいました').form).toBe('honorific (nasaru), polite past');
    expect(tap('早く食べなさい', '食べなさい').form).toBe('polite command (nasai)');
  });

  it('joins a na-adjective and そう, and a counter and the 目 that makes it an ordinal', () => {
    const kind = tap('が、老人はその日も親切そうに、同じ言葉を繰返しますから、こちらも前と同じように', '親切そう');
    expect(kind.key).toBe('親切');
    expect(kind.form).toBe('looks like (sou)');
    expect(tok('ましてとうとう三年目の春、又杜子春が以前の通り、一文無しになって見ると', '三年目').reading).toBe('さんねんめ');
  });

  it('reads 分れた as 分れる, not a conditional of 分る before た', () => {
    const s = '兄とおれはかように分れたが、困ったのは清の行く先である。';
    expect(tok(s, '分れた')).toMatchObject({ key: '分かれる', reading: 'わかれた' });
  });

  it('keeps a mimetic word and its と together (しんと "silently")', () => {
    expect(tok('その上あたりは墓の中のようにしんと静まり返って', 'しんと').key).toBe('しんと');
  });

  it('reads 云えない as the potential, and 十三四 as thirteen or fourteen', () => {
    expect(tap('何とも云えない好い匂が、絶間なくあたりへ溢れて居ります。', '云えない').form).toBe('potential negative');
    expect(tok('この質屋に勘太郎という十三四の倅が居た。', '十三四').reading).toBe('じゅうさんよん');
  });
});
