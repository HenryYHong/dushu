// The dictionary's data plumbing for books Dushu was never tuned on: a floor for dictionary words the corpus never saw, 著 written
// 着 on the simplified page where it reads zhe, zháo or zhuó, variant characters shown and looked up in their standard form, and
// the lexicon's guards against junk entries and against curated words of one book firing in every book. Every sentence here is
// invented.
import { describe, expect, it } from 'vitest';
import { UNSEEN_FLOOR } from '../../src/core/dict';
import { buildLexicon, detectTerms, judgeCandidate } from '../../src/core/lexicon';
import type { TermCandidate } from '../../src/core/lexicon';
import { segment } from '../../src/core/segment';
import { inScript, lexiconInScript, segmentShown } from '../../src/ui/reader/shown';
import { loadTestDictionary } from '../helpers/data';
import { novel } from '../helpers/novel';

const dictP = loadTestDictionary();

/** The tokens of `text` joined with | and framed by |. */
async function cut(text: string): Promise<string> {
  const d = await dictP;
  return `|${segment(text, d).map((t) => t.text).join('|')}|`;
}

/** The tokens of a traditional paragraph as the simplified page shows them, framed by |. */
async function shownCut(source: string): Promise<string> {
  const d = await dictP;
  const shown = inScript(source, 'simplified', d, 'traditional');
  return `|${segmentShown(shown, source, d).map((t) => t.text).join('|')}|`;
}

describe('the floor for dictionary words the corpus never saw', () => {
  it('gives a listed word the floor, and a counted word its count', async () => {
    const d = await dictP;
    expect(d.freq('胶皮')).toBe(0);
    expect(d.segmentFreq!('胶皮')).toBe(UNSEEN_FLOOR);
    expect(d.segmentFreq!('前往')).toBe(d.freq('前往'));
    // A pair that only names a town (三合) is a coincidence in a book; another proper noun keeps the floor (术赤).
    expect(d.segmentFreq!('三合')).toBe(0);
    expect(d.segmentFreq!('术赤')).toBe(UNSEEN_FLOOR);
  });

  it('gives none to a Wiktionary word that reads otherwise than its characters, nor to a traditional spelling', async () => {
    const d = await dictP;
    expect(d.segmentFreq!('率兵')).toBe(0); // lǜ bīng against the shuài the characters read
    expect(d.segmentFreq!('齐齐')).toBe(0); // the literary zhāizhāi
    expect(d.segmentFreq!('五口')).toBe(0); // a row written with tone sandhi
    expect(d.segmentFreq!('為人')).toBe(0); // the page shows 为人
  });

  it('joins such words in running text', async () => {
    expect(await cut('球拍上的胶皮已经旧了。')).toContain('|胶皮|');
    expect(await cut('这个文旅项目很受欢迎。')).toContain('|文旅|');
    expect(await cut('台风的风眼很平静。')).toContain('|风眼|');
  });

  it('leaves a word to its neighbors where they mean its parts', async () => {
    // A measure word after a numeral, a pronoun opening the word, a particle after a verb.
    expect(await cut('他买了一本书。')).not.toContain('|本书|');
    expect(await cut('她在台上演了一出戏。')).not.toContain('|出戏|');
    expect(await cut('奶奶把糖留给我孙子。')).not.toContain('|我孙子|');
    expect(await cut('他大声吼得人心慌。')).not.toContain('|得人心|');
  });

  it('reads a negation after an adverb as 不 bù, not the neutral 不 of a verb complement', async () => {
    const d = await dictP;
    expect(d.pinyinFor('还不如')[1]).toBe('bu4');
    expect(d.pinyinFor('受不了')[1]).toBe('bu5');
  });
});

describe('著 on the simplified page', () => {
  it('is 着 where it reads zhe, zháo or zhuó, and stays 著 for zhù', async () => {
    const s = await shownCut('他隨著人群走了，心裏著實高興。這部著作很有名。');
    expect(s).toContain('|随着|');
    expect(s).toContain('着实');
    expect(s).toContain('著作');
    expect(s).not.toMatch(/著实|随著/);
  });

  it('is 着 on the simplified page even where nothing else converts, and stays 著 in the original or traditional script', async () => {
    const d = await dictP;
    expect(inScript('他看著我笑。', 'simplified', d, 'traditional')).toBe('他看着我笑。');
    expect(inScript('他看著我笑。', 'simplified', d, 'simplified')).toBe('他看着我笑。');
    const src = '他隨著人群走了。';
    expect(inScript(src, 'original', d, 'traditional')).toBe(src);
    expect(inScript(src, 'traditional', d, 'traditional')).toBe(src);
  });
});

describe('variant characters', () => {
  it('are shown in their standard form on the simplified page', async () => {
    const d = await dictP;
    expect(d.toSimplified('靑春')).toBe('青春');
    expect(d.toSimplified('大槪')).toBe('大概');
    expect(d.toSimplified('摹倣')).toBe('摹仿');
    expect(d.toSimplified('讐人')).toBe('仇人');
  });

  it('are left alone where the 2013 standard table keeps them (names, a sense of their own)', async () => {
    const d = await dictP;
    for (const ch of ['斌', '犟', '珪', '焱', '绔']) expect(d.toSimplified(ch)).toBe(ch);
  });

  it('find the standard word when the text keeps the variant', async () => {
    const d = await dictP;
    expect(d.lookup('靑春')[0]?.simp).toBe('青春');
    expect(d.freq('靑春')).toBe(d.freq('青春'));
    expect(await cut('他的靑春過去了。')).toContain('|靑春|');
    // A character looked up alone keeps its own row.
    expect(d.lookup('靑')[0]?.defs[0]).toMatch(/variant of 青/);
  });
});

/** A candidate with the statistics of a strongly bound string, for the verdict rules. */
function candidate(word: string, over: Partial<TermCandidate> = {}): TermCandidate {
  return { word, count: 60, bind: 1, pmi: 9, left: 3, right: 3, speech: 0, prep: 0, known: 'none', kind: 'term', surnameLed: false, ...over };
}

describe('lexicon guards', () => {
  it('rejects a verb and its object as a place or a term (前往中国, 疏浚西湖)', async () => {
    const d = await dictP;
    expect(judgeCandidate(candidate('前往中国'), d)).toBeNull();
    expect(judgeCandidate(candidate('疏浚西湖'), d)).toBeNull();
    expect(judgeCandidate(candidate('紫霞岛'), d)?.kind).toBe('place');
  });

  it('keeps a verb and its object, or a piece of one, out of a short text\'s places (前往中国, 疏|浚西湖)', async () => {
    const d = await dictP;
    const lines = [novel(23, 300)];
    for (let i = 0; i < 4; i++) lines.push(['那年春天，商队前往中国。', '工匠们疏浚西湖，又筑了长堤。'][i % 2], ['船队又一次前往中国。', '官府下令疏浚西湖。'][i % 2]);
    const words = detectTerms([lines.join('\n')], d).map((e) => e.word);
    for (const junk of ['前往中国', '疏浚西湖', '浚西湖']) expect(words).not.toContain(junk);
  });

  it('does not make a short name of a title (钱典史 is a person, 典史 an office)', async () => {
    const d = await dictP;
    const filler = ['衙门口贴了告示', '县里新修了石桥', '码头上卸着盐包', '他把文书收进匣里', '轿夫换了一班', '城西的当铺关门了'];
    const lines = [novel(11, 2200)];
    for (let i = 0; i < 60; i++) {
      const f = filler[i % filler.length];
      lines.push([`钱典史笑道：“${f}。”`, `${f}，大家都看着钱典史。`, `他对钱典史说，${f}。`, `钱典史听了，${f}。`][i % 4]);
    }
    for (let i = 0; i < 15; i++) lines.push(['他做过一任典史，后来回家了。', '这典史的官，比知县小些。', '我们做典史的，全靠着做生日。'][i % 3]);
    const found = detectTerms([lines.join('\n')], d);
    expect(found.map((e) => e.word)).toContain('钱典史');
    // (It stays a word of the book, as a term: tests/core/held-out-review.test.ts.)
    expect(found.find((e) => e.word === '典史')?.kind).not.toBe('name');
  });
});

describe('curated words of one book (book-words scope "book")', () => {
  it('have no count of their own in every book', async () => {
    const d = await dictP;
    expect(d.bookScoped!().has('小红')).toBe(true);
    expect(d.freq('小红')).toBe(0);
    expect(await cut('柜上摆着两盏小红灯笼。')).not.toContain('|小红|');
  });

  it('join the lexicon of a book that uses them as a name', async () => {
    const d = await dictP;
    const lines = [novel(13, 600)];
    for (let i = 0; i < 12; i++) lines.push(['小红笑道：“药炉还温着。”', '叫小红进来。', '小红捧着茶盘站在廊下。'][i % 3]);
    const found = detectTerms([lines.join('\n')], d);
    const e = found.find((x) => x.word === '小红');
    expect(e?.kind).toBe('name');
    expect(e?.pinyin).toBe('xiao3 hong2');
  });

  it('cut the sentences of their book whole once in its lexicon (張任|教, not 張|任教)', async () => {
    const d = await dictP;
    const lines = [novel(19, 600)];
    for (let i = 0; i < 10; i++) lines.push(['張任引兵出城。', '張任大怒。', '玄德問張任。'][i % 3]);
    const lex = buildLexicon(detectTerms([lines.join('\n')], d));
    expect(lex.has('張任')).toBe(true);
    const src = '張任教張翼守城。';
    expect(segmentShown(inScript(src, 'simplified', d, 'traditional'), src, d, lexiconInScript(lex, 'simplified', d, 'traditional'))
      .map((t) => t.text).join('|')).toContain('张任|教');
  });

  it('do not join where the book means something else (小红花, 公子曰)', async () => {
    const d = await dictP;
    const flowers = [novel(13, 600), ...Array.from({ length: 12 }, () => '院子里的小红花开了。')].join('\n');
    expect(detectTerms([flowers], d).some((e) => e.word === '小红')).toBe(false);
    const sons = [novel(17, 600), ...Array.from({ length: 10 }, () => '公子曰：「此山多虎。」')].join('\n');
    expect(detectTerms([sons], d).some((e) => e.word === '子曰')).toBe(false);
    const sayings = [novel(17, 600), ...Array.from({ length: 10 }, () => '子曰：「學而時習之。」')].join('\n');
    expect(detectTerms([sayings], d).some((e) => e.word === '子曰')).toBe(true);
  });
});
