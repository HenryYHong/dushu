// The publisher's furigana (Aozora ruby, 杜子春《とししゅん》) in the Japanese engine: a reading the book prints is read as printed,
// cuts the words where it says, picks the dictionary entry read that way, and makes a name of what the dictionary cannot read so.
// The sentences are from the classics in public/samples/ja (Akutagawa, Sōseki), with their ruby as Aozora prints it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Token } from '../../../src/types';
import type { LangEngine } from '../../../src/lang/types';
import { parseAozoraRuby } from '../../../src/import/aozora';
import { loadJa } from './load';

let ja: LangEngine;
beforeAll(async () => { ja = await loadJa(); }, 60000);
// Names a book printed are remembered until the next book; every test starts a book of its own.
beforeEach(() => ja.beginBook?.());

/** The tokens of a sentence written in Aozora notation, segmented with its ruby as the reader passes it. */
function read(notated: string): Token[] {
  const { text, ruby } = parseAozoraRuby(notated);
  return ja.segment(text, ruby.length ? { ruby } : undefined);
}
const words = (notated: string) => read(notated).filter((t) => t.kind === 'word');
const tok = (notated: string, text: string): Token => {
  const t = read(notated).find((x) => x.text === text);
  if (!t) throw new Error(`${text} is not a token of ${notated}: ${read(notated).map((x) => x.text).join('|')}`);
  return t;
};
/** Furigana as 杜子春(とししゅん). */
const furigana = (t: Token) => (t.ruby ?? []).map((p) => (p.rt ? `${p.text}(${p.rt})` : p.text)).join('');
const look = (notated: string, text: string) => ja.lookup(text, { token: tok(notated, text) });

describe('a reading the book prints', () => {
  it('makes the words under it one name, read as printed (杜子春, 犍陀多)', () => {
    const s = '杜子春《とししゅん》は驚いて、伏せていた眼を挙げました。';
    const t = tok(s, '杜子春');
    expect(t).toMatchObject({ reading: 'とししゅん', name: true, key: '杜子春', lemma: '杜子春' });
    expect(furigana(t)).toBe('杜子春(とししゅん)');
    const l = look(s, '杜子春');
    expect(l.name).toBe(true);
    expect(l.entries[0]).toMatchObject({ head: '杜子春', reading: 'とししゅん', source: 'name' });
    expect(l.entries.map((e) => e.head)).not.toContain('森');
    // 蜘蛛の糸: the first 犍陀多 carries its reading, the second in the same paragraph does not.
    const kumo = 'するとその地獄の底に、犍陀多《かんだた》と云う男が一人、ほかの罪人と一しょに蠢《うごめ》いている姿が、御眼に止まりました。この犍陀多と云う男は、人を殺したり家に火をつけたり、いろいろ悪事を働いた大泥坊でございますが';
    const kandata = words(kumo).filter((w) => w.text === '犍陀多');
    expect(kandata).toHaveLength(2);
    for (const k of kandata) expect(k).toMatchObject({ reading: 'かんだた', name: true });
    expect(words(kumo).some((w) => w.text === '犍' || w.text === '多')).toBe(false);
  });

  it('reads the name so in the paragraphs after it, until the next book (清 is Kiyo in 坊っちゃん)', () => {
    const kiyo = tok('十年来召し使っている清《きよ》という下女が、泣きながらおやじに詫《あや》まって、ようやくおやじの怒《いか》りが解けた。', '清');
    expect(kiyo).toMatchObject({ reading: 'きよ', name: true });
    expect(look('清《きよ》という下女', '清').entries[0]).toMatchObject({ source: 'name', reading: 'きよ' });
    // Later paragraphs print no reading; next to other kanji too (清以外, 大方清も), where the analyzer cuts there anyway.
    expect(tok('好い気性なら清以外のものも、もう少し善くしてくれるだろうと思った。', '清')).toMatchObject({ reading: 'きよ', name: true });
    expect(tok('大方清も知らないんだろう。', '清')).toMatchObject({ reading: 'きよ', name: true });
    // 清水 is another word, Kiyo or not.
    expect(read('清水の舞台').some((t) => t.text === '清')).toBe(false);
    // A new book forgets her: alone, IPADIC takes this 清 for the stem of 清い.
    ja.beginBook?.();
    expect(tok('好い気性なら清以外のものも', '清').name).toBeUndefined();
  });

  it('chooses the entry read as printed (明後日 あさって, 甲 こう)', () => {
    const s = '明後日《あさって》から課業を始めてくれと云った。';
    expect(tok(s, '明後日')).toMatchObject({ reading: 'あさって', key: '明後日' });
    expect(look(s, '明後日').entries[0].reading).toBe('あさって');
    const kou = '右の手の親指の甲《こう》をはすに切り込《こ》んだ。';
    expect(tok(kou, '甲').key).toBe('甲');
    expect(look(kou, '甲').entries[0].reading).toBe('こう');
    expect(look(kou, '甲').entries.map((e) => e.reading)).not.toContain('かぶと');
  });

  it('keeps the stem’s reading and the okurigana of an inflected word (断《き》れた is 切れる)', () => {
    const s = 'もし万一途中で断《き》れたと致しましたら、折角ここへまでのぼって来たこの肝腎《かんじん》な自分までも';
    const t = tok(s, '断れた');
    expect(furigana(t)).toBe('断(き)れた');
    expect(t).toMatchObject({ reading: 'きれた', key: '切れる' });
    expect(look(s, '断れた').form).toBe('past tense');
    // IPADIC's verb was read another way: 下りる おりる there, 下がる さがる as printed.
    const down = tok('二人を乗せた青竹は、間もなく峨眉山へ舞い下《さが》りました。', '下りました');
    expect(down).toMatchObject({ reading: 'さがりました', key: '下がる' });
    // The reading takes in an okurigana the page does not write: 凄《すさま》じく, 詫《あや》まって.
    expect(tok('うす紫の稲妻がやにわに闇を二つに裂いて、凄《すさま》じく雷《らい》が鳴り出しました。', '凄じく')).toMatchObject({ reading: 'すさまじく', key: '凄まじい' });
    expect(tok('泣きながらおやじに詫《あや》まって、ようやくおやじの怒《いか》りが解けた。', '詫まって')).toMatchObject({ reading: 'あやまって', key: '謝る' });
  });

  it('cuts words where a reading starts or ends between two kanji', () => {
    // 唐の都｜洛陽: the publisher's ｜ says 洛陽 is a word of its own.
    expect(words('唐《とう》の都｜洛陽《らくよう》の西の門の下に').map((w) => w.text)).toEqual(['唐', 'の', '都', '洛陽', 'の', '西', 'の', '門', 'の', '下', 'に']);
    // 唯《ただ》一人 "only one": unprinted, IPADIC reads 唯一 ゆいいつ.
    const rich = words('杜子春は一日の内に、洛陽の都でも唯《ただ》一人という大金持になりました。');
    expect(rich.find((w) => w.text === '唯')).toMatchObject({ reading: 'ただ' });
    expect(rich.find((w) => w.text === '一人')).toMatchObject({ reading: 'ひとり' });
    // A word the dictionary has, read inside as printed, stays whole: the ｜ only says where the furigana starts.
    const whole = tok('御釈迦様は極楽の蓮池のふちに立って、この一部｜始終《しじゅう》をじっと見ていらっしゃいましたが', '一部始終');
    expect(furigana(whole)).toBe('一(いち)部(ぶ)始終(しじゅう)');
    expect(tok('これは兼ねて噂に聞いた、閻魔《えんま》大王に違いありません。', '閻魔大王')).toMatchObject({ reading: 'えんまだいおう', key: '閻魔大王' });
    expect(tok('すると一陣の風が吹き起って、空に渦《うず》巻いた黒雲の中から', '渦巻いた').key).toBe('渦巻く');
    // A counter printed after its number stays with it: 一杯 いっぱい, not いち + ぱい.
    const ws = words('帰りに山嵐は通町《とおりちょう》で氷水を一｜杯《ぱい》奢《おご》った。');
    expect(ws.find((w) => w.text === '一杯')).toMatchObject({ reading: 'いっぱい' });
    expect(furigana(ws.find((w) => w.text === '一杯')!)).toBe('一(いっ)杯(ぱい)');
    expect(ws.find((w) => w.text === '奢った')).toMatchObject({ reading: 'おごった', key: 'おごる' });
  });

  it('takes two readings side by side at the word each one covers', () => {
    // The importer runs the base of 呑気《のんき》 back over 比較的 (a reading right before it); the engine reads each as printed.
    const ws = words('おれの生涯のうちでは比較的《ひかくてき》呑気《のんき》な時節であった。');
    expect(ws.find((w) => w.text === '比較的')).toMatchObject({ reading: 'ひかくてき' });
    expect(ws.find((w) => w.text === '呑気')).toMatchObject({ reading: 'のんき' });
    // Over the word as printed, not kanji by kanji.
    expect(furigana(ws.find((w) => w.text === '呑気')!)).toBe('呑気(のんき)');
  });

  it('gives an honorific prefix and its verb each their share of one reading (御佇《おたたず》み)', () => {
    const ws = words('やがて御釈迦様はその池のふちに御佇《おたたず》みになって、水の面《おもて》を蔽《おお》っている');
    expect(furigana(ws.find((w) => w.text === '御')!)).toBe('御(お)');
    expect(ws.find((w) => w.text === '佇み')).toMatchObject({ reading: 'たたずみ', key: '佇む' });
    expect(ws.some((w) => w.text === '御佇み')).toBe(false);
  });

  it('does not make names of words the dictionary spells or reads otherwise', () => {
    const kumo = '御釈迦様はその蜘蛛の糸をそっと御手に御取りになって、玉のような白蓮《しらはす》の間から、遥か下にある地獄の底へ';
    // JMdict has 白蓮 as びゃくれん: the word, read as printed.
    expect(tok(kumo, '白蓮').name).toBeUndefined();
    expect(look(kumo, '白蓮').entries[0].senses[0].glosses[0]).toMatch(/lotus/);
    // 微《かすか》: the okurigana か is inside the reading (微か).
    const faint = 'ただ罪人がつく微《かすか》な嘆息《たんそく》ばかりでございます。';
    expect(tok(faint, '微')).toMatchObject({ reading: 'かすか', key: 'かすか' });
    expect(tok(faint, '微').name).toBeUndefined();
    // 数限《かずかぎり》もない: the start of 数限りない "countless".
    expect(tok('蜘蛛の糸の下の方には、数限《かずかぎり》もない罪人たちが', '数限')).toMatchObject({ key: '数限りない' });
    expect(tok('蜘蛛の糸の下の方には、数限《かずかぎり》もない罪人たちが', '数限').name).toBeUndefined();
    // A reading in old kana (水晶《すいしよう》) is the dictionary's すいしょう, and shows as the dictionary spells it.
    const crystal = tok('丁度｜地獄《じごく》の底に当って居りますから、水晶《すいしよう》のような水を透き徹して', '水晶');
    expect(crystal).toMatchObject({ key: '水晶', reading: 'すいしょう' });
    expect(furigana(crystal)).toBe('水晶(すいしょう)');
  });

  it('takes a word printed over in katakana or read its own way for the word, not a name (卓布, 整然, 洋机)', () => {
    const cloth = '模様の織り出された厚い糊《のり》の硬《こわ》い卓布《テーブルクロース》が美しくかつ清らかに電燈の光を射返《いかえ》していた。';
    expect(tok(cloth, '卓布').name).toBeUndefined();
    expect(look(cloth, '卓布').entries[0].senses[0].glosses[0]).toMatch(/tablecloth/);
    // 硬《こわ》い is 硬い "stiff", read as printed, not its homophone 怖い "scary".
    expect(tok(cloth, '硬い').key).toBe('硬い');
    expect(furigana(tok(cloth, '硬い'))).toBe('硬(こわ)い');
    const tidy = '書斎なども実に整然《きちり》と片付いていた。';
    expect(tok(tidy, '整然')).toMatchObject({ key: '整然', reading: 'きちり' });
    expect(tok(tidy, '整然').name).toBeUndefined();
    const desk = '書斎には洋机《テーブル》と椅子《いす》の外《ほか》に、沢山の書物が美しい背皮《せがわ》を並べて、硝子越《ガラスごし》に電燈《でんとう》の光で照らされていた。';
    expect(tok(desk, '洋机').name).toBeUndefined();
    expect(tok(desk, '硝子越').name).toBeUndefined();
    // 外《ほか》に is "besides", and the furigana is the book's.
    expect(look(desk, '外').entries[0].senses[0].glosses[0]).toMatch(/^(besides|except)/);
    // Pieces the analyzer or the dictionary read as printed are a word too: 執着力 しゅうじゃく + りょく.
    expect(tok('私は先生の性質の特色として、こんな執着力《しゅうじゃくりょく》をいまだかつて想像した事さえなかった。', '執着力').name).toBeUndefined();
    // The Chinese names of the tales, read kanji by kanji, stay names.
    expect(tok('「いかにもおれは峨眉山《がびさん》に棲《す》んでいる、鉄冠子《てっかんし》という仙人だ。', '鉄冠子')).toMatchObject({ name: true, reading: 'てっかんし' });
  });

  it('shows the words a compound the dictionary lacks is made of, read as printed (竹杖, 紅茶茶碗)', () => {
    const cane = look('おお、幸《さいわい》、ここに竹杖《たけづえ》が一本落ちている。', '竹杖');
    expect(cane.entries).toEqual([]);
    expect(cane.parts?.map((p) => `${p.text}:${p.gloss}`)).toEqual(['竹:bamboo', '杖:cane']);
    const cup = look('奥さんは手に紅茶茶碗《こうちゃぢゃわん》を持ったまま、笑いながらそこに立っていた。', '紅茶茶碗');
    expect(cup.parts?.map((p) => p.text)).toEqual(['紅茶', '茶碗']);
  });

  it('reads a verb spelled its own way as the verb that shares a kanji or a meaning, then as its own spelling', () => {
    // 撲《う》って is 打つ or 殴る, "to strike", not 売る "to sell".
    const hit = '母が病気で死ぬ二三日《にさんち》前台所で宙返りをしてへっついの角で肋骨《あばらぼね》を撲《う》って大いに痛かった。';
    expect(look(hit, '撲って').entries[0].senses[0].glosses[0]).toMatch(/strike|hit/);
    // 淋《さむ》しい is 寂しい, which JMdict reads さびしい: its entry, with the book's furigana.
    expect(look('「私はちっとも淋《さむ》しくはありません」', '淋しく').entries[0].senses[0].glosses[0]).toMatch(/lonely/);
    // 傾《かたぶ》けて is 傾ける, not "can tilt" (傾く).
    const tilt = tok('と思うと、すらりと揺《ゆら》ぐ茎《くき》の頂《いただき》に、心持首を傾《かたぶ》けていた細長い一輪の蕾《つぼみ》が', '傾けていた');
    expect(tilt.key).toBe('傾ける');
    // A common verb read so is the word when nothing closer is: 伴《つ》れて is 連れる.
    expect(tok('先生が一人の西洋人を伴《つ》れていたからである。', '伴れていた').key).toBe('連れる');
  });

  it('keeps the old okurigana after a reading in the word (憚かる, 悪るい, 蟠まり, 磯近く, 机掛け)', () => {
    expect(tok('これは世間を憚《はば》かる遠慮というよりも、その方が私にとって自然だからである。', '憚かる').key).toBe('はばかる');
    expect(tok('それから英語の教師に古賀《こが》とか云う大変顔色の悪《わ》るい男が居た。', '悪るい').key).toBe('悪い');
    expect(tok('自分と夫の間には何の蟠《わだか》まりもない、またないはずであるのに、やはり何かある。', '蟠まり').key).toBe('わだかまり');
    // With no dictionary word for the whole, the kana are still the last kanji's: 近く, 掛け.
    const shore = words('そうして遠浅《とおあさ》の磯近《いそちか》くにわいわい騒いでいる多人数《たにんず》の間《あいだ》を通り抜けて');
    expect(shore.map((w) => w.text)).toContain('磯近く');
    expect(shore.map((w) => w.text)).not.toContain('くに');
    expect(words('書斎の硝子戸《ガラスど》から冬に入《い》って稀《まれ》に見るような懐かしい和《やわ》らかな日光が机掛《つくえか》けの上に射《さ》していた。').map((w) => w.text)).toContain('机掛け');
    // What follows such a word is read in its sentence still: 例の通り "as usual", から "because" after a verb.
    expect(look('或《あ》る時先生が例の通りさっさと海から上がって来て', '通り').entries[0].senses[0].glosses[0]).toMatch(/same way/);
    expect(look('独りで極めて一人で喋舌《しゃべ》るから、こっちは困まって顔を赤くした。', 'から').entries[0].senses[0].glosses[0]).toMatch(/^because/);
    // A na-adjective read so takes the copula な, not the な that ends a sentence.
    const kind = words('先生からもう少し濃《こまや》かな言葉を予期して掛《かか》ったのである。');
    expect(kind.find((w) => w.text === '濃か')?.key).toBe('細やか');
    expect(kind.find((w) => w.text === 'な')?.key).toBe('だ');
  });

  it('looks up a printed name from a copy of its token (a token rebuilt by the UI)', () => {
    const t = tok('杜子春《とししゅん》は驚いて', '杜子春');
    const copy: Token = JSON.parse(JSON.stringify(t));
    const l = ja.lookup(copy.text, { token: copy });
    expect(l.name).toBe(true);
    expect(l.entries[0]).toMatchObject({ head: '杜子春', reading: 'とししゅん', source: 'name' });
  });

  it('covers every paragraph of three classics with the book’s readings in its furigana', () => {
    let spans = 0;
    let agree = 0;
    for (const id of ['kumo-no-ito', 'toshishun', 'botchan']) {
      ja.beginBook?.();
      const md = readFileSync(join(__dirname, '..', '..', '..', 'public', 'samples', 'ja', `${id}.md`), 'utf8');
      for (const line of md.split('\n')) {
        if (!line.trim() || line.startsWith('#')) continue;
        const { text, ruby } = parseAozoraRuby(line);
        const toks = ja.segment(text, { ruby });
        expect(toks.map((t) => t.text).join('')).toBe(text);
        let at = 0;
        for (const t of toks) {
          expect(t.start).toBe(at);
          at = t.end;
          if (t.kind === 'word') expect((t.ruby ?? []).map((p) => p.text).join(''), t.text).toBe(t.text);
        }
        // The furigana over each printed reading spells it (kana in the word as they are).
        const parts: { s: number; e: number; rt: string }[] = [];
        for (const t of toks) {
          let p = t.start;
          for (const r of t.ruby ?? [{ text: t.text }]) { parts.push({ s: p, e: p + r.text.length, rt: r.rt ?? r.text }); p += r.text.length; }
        }
        for (const r of ruby) {
          spans++;
          const over = parts.filter((p) => p.e > r.start && p.s < r.end);
          if (over.every((p) => p.s >= r.start && p.e <= r.end) && over.map((p) => p.rt).join('') === r.rt) agree++;
        }
      }
    }
    expect(spans).toBeGreaterThan(3000);
    // The few left are the importer's: a reading whose base it ran back over the reading before (比較的呑気《のんき》).
    expect(agree / spans).toBeGreaterThan(0.99);
  });
});

describe('a reading the book prints elsewhere', () => {
  it('is taken for a name the dictionary lacks, not for a word it has (a one-off gloss)', async () => {
    const { takeAozoraRuby } = await import('../../../src/import/aozora');
    // 杜子春 is read once, mid-story; 閉口《へこ》 is a gloss of one place in Botchan, and 閉口 is へいこう anywhere else.
    const [c] = takeAozoraRuby([{ title: '一', blocks: [
      { t: 'p', text: '杜子春は閉口した。' },
      { t: 'p', text: '杜子春《とししゅん》は驚いて、すっかり閉口《へこ》んだ。' },
    ] }]);
    const b = c.blocks[0] as { text: string; ruby?: { start: number; end: number; rt: string; inferred?: true }[] };
    expect(b.ruby?.every((r) => r.inferred)).toBe(true);
    const toks = ja.segment(b.text, { ruby: b.ruby });
    const at = (s: string) => toks.find((t) => t.text.startsWith(s))!;
    expect(furigana(at('杜子春'))).toBe('杜子春(とししゅん)');
    expect(at('杜子春').name).toBe(true);
    expect(at('閉口').reading).toMatch(/^へいこう/);
  });
});
