// The reader's corrections (src/core/fixes.ts): what a fix is called, how it lays over the book's names and terms, how it cuts, joins
// and reads the tokens of a paragraph after the cut, and how a fix made at one place is found again when the book is imported
// again. The sentences are invented.
import { describe, expect, it } from 'vitest';
import {
  anchorAt, applyFixes, cleanFix, countIn, cutWord, exportFixes, fixId, fixedWord, fixesOfBook, fixesSig, hereIn, importFixes, makeFix,
  placeHere, withFixes,
} from '../../src/core/fixes';
import { buildLexicon } from '../../src/core/lexicon';
import { segment } from '../../src/core/segment';
import { segmentShown } from '../../src/ui/reader/shown';
import type { Dictionary, Fix, LexiconEntry, Token } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';

const BOOK = { id: 'local-1', key: 'babc123' };
const fix = (o: Omit<Fix, 'id' | 't' | 'on' | 'book' | 'bookId'> & Partial<Pick<Fix, 'on' | 't' | 'book' | 'bookId'>>): Fix =>
  makeFix({ book: BOOK.key, bookId: BOOK.id, t: 1000, ...o });
const han = (toks: Token[]) => toks.filter((t) => t.kind === 'han').map((t) => `${t.text}{${(t.pinyin ?? []).join(' ')}}`).join('|');
const covers = (toks: Token[], text: string) => {
  expect(toks.map((t) => t.text).join('')).toBe(text);
  let at = 0;
  for (const t of toks) { expect(t.start).toBe(at); at = t.end; expect(t.end - t.start).toBe(t.text.length); }
  expect(at).toBe(text.length);
};
/** A paragraph cut with the book's fixes, as the reader does (shown as written). */
const page = (dict: Dictionary, text: string, fixes: Fix[], found: LexiconEntry[] = [], here?: Parameters<typeof applyFixes>[4]) =>
  segmentShown(text, text, dict, withFixes(buildLexicon(found), fixes), undefined, here);

describe('what a fix is called', () => {
  it('is the same id for the same book, word and place, whoever makes it', () => {
    expect(fixId('b1', 'word', '子君')).toBe(fixId('b1', 'word', '子君'));
    // A word is either joined, cut or not a word in a book: those share an id, so the latest says what it is.
    expect(fixId('b1', 'cut', '子君')).toBe(fixId('b1', 'word', '子君'));
    expect(fixId('b1', 'unword', '子君')).toBe(fixId('b1', 'word', '子君'));
    // A reading is its own fix; so is each place of a "here only" fix, and each book.
    expect(fixId('b1', 'reading', '子君')).not.toBe(fixId('b1', 'word', '子君'));
    const at = { chapter: 2, block: 5, offset: 10, before: '', after: '' };
    expect(fixId('b1', 'word', '子君', at)).not.toBe(fixId('b1', 'word', '子君'));
    expect(fixId('b1', 'word', '子君', at)).toBe(fixId('b1', 'word', '子君', { ...at, before: '他说' }));
    expect(fixId('b2', 'word', '子君')).not.toBe(fixId('b1', 'word', '子君'));
  });

  it('anchors a place with eight characters on each side, as the book spells them', () => {
    const text = '一二三四五六七八九十先生甲乙丙丁戊己庚辛壬癸';
    const a = anchorAt(text, 3, 7, 10, 2);
    expect(a).toEqual({ chapter: 3, block: 7, offset: 10, before: '三四五六七八九十', after: '甲乙丙丁戊己庚辛' });
    expect(anchorAt('先生来了', 0, 0, 0, 2)).toEqual({ chapter: 0, block: 0, offset: 0, before: '', after: '来了' });
    // A character outside the BMP counts as one.
    expect(anchorAt('𠀀𠀁先生', 0, 0, 4, 2).before).toBe('𠀀𠀁');
  });

  it('belongs to its book here, by id, key or an older importer\'s key, and to every book when made so', () => {
    const all: Fix[] = [
      fix({ kind: 'word', word: '子君', pinyin: 'zi3 jun1' }),
      fix({ kind: 'word', word: '甲乙', book: 'sbook', bookId: 'sbook' }),
      fix({ kind: 'word', word: '丙丁', book: 'sbook.2', bookId: 'sbook.2' }),
      fix({ kind: 'word', word: '戊己', book: '*', bookId: '*' }),
      fix({ kind: 'word', word: '庚辛', book: 'bother', bookId: 'other' }),
    ];
    expect(fixesOfBook(all, BOOK).map((f) => f.word)).toEqual(['子君', '戊己']);
    expect(fixesOfBook(all, { id: 'x', key: 'sbook.3' }).map((f) => f.word)).toEqual(['甲乙', '丙丁', '戊己']);
  });
});

describe('the names and terms with the fixes', () => {
  const found = (word: string, kind: LexiconEntry['kind'] = 'name'): LexiconEntry => ({ word, pinyin: 'a1 b1', gloss: 'name (person)', kind, enabled: true, origin: 'auto' });

  it('puts the book\'s own word fixes over what was found, and those for every book under it', () => {
    const lex = withFixes(buildLexicon([found('郭靖'), found('黄蓉')]), [
      fix({ kind: 'word', word: '子君', pinyin: 'zi3 jun1', role: 'name' }),
      fix({ kind: 'unword', word: '黄蓉' }),
      fix({ kind: 'word', word: '郭靖', pinyin: 'guo1 jing4', role: 'name', gloss: 'the hero' }),
      fix({ kind: 'word', word: '郭靖', pinyin: 'x1 y1', book: '*', bookId: '*' }),
      fix({ kind: 'word', word: '书生', pinyin: 'shu1 sheng1', book: '*', bookId: '*' }),
    ]);
    expect(lex.get('子君')).toMatchObject({ kind: 'name', pinyin: 'zi3 jun1', gloss: 'name (person)', origin: 'user' });
    expect(lex.has('黄蓉')).toBe(false);
    expect(lex.get('郭靖')).toMatchObject({ pinyin: 'guo1 jing4', gloss: 'the hero' });
    expect(lex.get('书生')).toMatchObject({ pinyin: 'shu1 sheng1', kind: 'user' });
    // The fixes that act after the cut ride along; one for every book is a word of the lexicon only.
    expect(lex.fixes?.map((f) => f.word).sort()).toEqual(['子君', '郭靖']);
  });

  it('leaves out fixes switched off, keeps what else the lexicon carries, and says when the fixes changed', () => {
    const base = Object.assign(buildLexicon([found('郭靖')]), { spellings: { di: true, na: false } });
    const off = fix({ kind: 'unword', word: '郭靖', on: false });
    const lex = withFixes(base, [off]);
    expect(lex.has('郭靖')).toBe(true);
    expect((lex as unknown as { spellings: unknown }).spellings).toEqual({ di: true, na: false });
    expect(lex.fixes).toBeUndefined();
    const cut = fix({ kind: 'cut', word: '先生', cuts: [1] });
    expect(fixesSig(withFixes(base, [cut]))).not.toBe(fixesSig(lex));
    expect(fixesSig(withFixes(base, [{ ...cut, t: 2000 }]))).not.toBe(fixesSig(withFixes(base, [cut])));
  });

  it('gives a word joined at one place a card, though it is not a word everywhere', () => {
    const at = { chapter: 0, block: 0, offset: 0, before: '', after: '说道' };
    const lex = withFixes(undefined, [fix({ kind: 'word', word: '子君', pinyin: 'zi3 jun1', gloss: 'a friend', at })]);
    expect(lex.has('子君')).toBe(false);
    expect(fixedWord(lex, '子君')).toMatchObject({ word: '子君', gloss: 'a friend', pinyin: 'zi3 jun1' });
  });
});

describe('fixes on the page', () => {
  it('changes nothing without fixes: the same tokens', async () => {
    const dict = await loadTestDictionary();
    const toks = segment('先生今天来了。', dict);
    expect(applyFixes(toks, '先生今天来了。', dict, undefined)).toBe(toks);
    expect(applyFixes(toks, '先生今天来了。', dict, [])).toBe(toks);
    expect(segmentShown('先生今天来了。', '先生今天来了。', dict, withFixes(undefined, []))).toEqual(toks);
  });

  it('splits a word everywhere in the book, each piece read on its own', async () => {
    const dict = await loadTestDictionary();
    const fixes = [fix({ kind: 'cut', word: '先生', cuts: [1] })];
    const text = '先生今天来了，我们去看先生吧。';
    const toks = page(dict, text, fixes);
    covers(toks, text);
    expect(han(toks)).toBe('先{xian1}|生{sheng1}|今天{jin1 tian1}|来{lai2}|了{le5}|我们{wo3 men5}|去{qu4}|看{kan4}|先{xian1}|生{sheng1}|吧{ba5}');
    // A split in three.
    expect(cutWord('为人民服务', [1, 3])).toEqual(['为', '人民', '服务']);
    const three = page(dict, '他为人民服务。', [fix({ kind: 'cut', word: '为人民服务', cuts: [3, 1] })]);
    expect(han(three)).toBe('他{ta1}|为{wei4}|人民{ren2 min2}|服务{fu2 wu4}');
  });

  it('joins two words everywhere: the word joins the names and terms, and the page reads it as the reader said', async () => {
    const dict = await loadTestDictionary();
    const text = '子君说道：我是我自己的。李子君走了。';
    expect(han(segment(text, dict))).toContain('子{zi3}|君{jun1}');
    const toks = page(dict, text, [fix({ kind: 'word', word: '子君', pinyin: 'zi3 jun1', role: 'name' })]);
    covers(toks, text);
    // Both places, 李子君 too: the name beats 李子 there.
    expect(han(toks).split('|').filter((t) => t.includes('子'))).toEqual(['子君{zi3 jun1}', '子君{zi3 jun1}']);
    const name = page(dict, text, [fix({ kind: 'word', word: '李子君', pinyin: 'li3 zi3 jun1', role: 'name' })]);
    expect(han(name)).toContain('李子君{li3 zi3 jun1}');
  });

  it('joins an ordinary word where the page cuts it in two, and never takes a longer word apart for it', async () => {
    const dict = await loadTestDictionary();
    const text = '有的人来了，城里有的是人，所有的人都来了。';
    expect(han(segment(text, dict))).toContain('有{you3}|的{de5}|人');
    const f = fix({ kind: 'word', word: '有的', pinyin: 'you3 de5', role: 'user' });
    // Not a candidate of the cut (it would beat 有的是 and 所有), but joined where it stands as two whole tokens.
    expect(withFixes(undefined, [f]).has('有的')).toBe(false);
    const toks = page(dict, text, [f]);
    covers(toks, text);
    expect(han(toks)).toBe('有的{you3 de5}|人{ren2}|来{lai2}|了{le5}|城里{cheng2 li3}|有的是{you3 de5 shi4}|人{ren2}|所有{suo3 you3}|的{de5}|人{ren2}|都{dou1}|来{lai2}|了{le5}');
  });

  it('joins at one place only, and leaves the same characters elsewhere as the page cut them', async () => {
    const dict = await loadTestDictionary();
    const text = '子君说道：子君是我。';
    const at = anchorAt(text, 0, 0, 5, 2);
    const f = fix({ kind: 'word', word: '子君', pinyin: 'zi3 jun1', at });
    const placed = placeHere([f], 0, [text]);
    const toks = page(dict, text, [f], [], hereIn(placed, 0, 0, text.length));
    covers(toks, text);
    expect(han(toks)).toBe('子{zi3}|君{jun1}|说道{shuo1 dao4}|子君{zi3 jun1}|是{shi4}|我{wo3}');
  });

  it('joins at its place even where the page now cuts across it', async () => {
    const dict = await loadTestDictionary();
    // 李子 is one word on the page; the reader joined 子君 at this place: 李|子君.
    const text = '李子君走了。';
    const f = fix({ kind: 'word', word: '子君', pinyin: 'zi3 jun1', at: anchorAt(text, 0, 0, 1, 2) });
    const toks = page(dict, text, [f], [], [{ fix: f, start: 1 }]);
    covers(toks, text);
    expect(han(toks)).toBe('李{li3}|子君{zi3 jun1}|走{zou3}|了{le5}');
    // The piece left over stays a word of its own (天 of 天子), read on its own.
    const t2 = '今天子君来了。';
    expect(han(segment(t2, dict))).toBe('今{jin1}|天子{tian1 zi3}|君{jun1}|来{lai2}|了{le5}');
    const g = fix({ kind: 'word', word: '子君', pinyin: 'zi3 jun1', at: anchorAt(t2, 0, 0, 2, 2) });
    expect(han(page(dict, t2, [g], [], [{ fix: g, start: 2 }]))).toBe('今{jin1}|天{tian1}|子君{zi3 jun1}|来{lai2}|了{le5}');
  });

  it('reads the words a fix made, and their neighbors, in the new cut', async () => {
    const dict = await loadTestDictionary();
    const text = '他的耳朵分外地灵。';
    expect(han(segment(text, dict))).toContain('分{fen1}|外地{wai4 di4}|灵{ling2}');
    const f = fix({ kind: 'word', word: '分外', role: 'user', at: anchorAt(text, 0, 0, 4, 2) });
    // 分外 is read as a word (fèn), and the 地 left after it is the particle now, not the dì of 外地.
    expect(han(page(dict, text, [f], [], [{ fix: f, start: 4 }]))).toContain('分外{fen4 wai4}|地{de5}|灵{ling2}');
  });

  it('reads a word as the reader said, everywhere or at one place, the place winning', async () => {
    const dict = await loadTestDictionary();
    const text = '这家人家很好，那户人家也好。';
    expect(han(segment(text, dict))).toContain('人家{ren2 jia1}');
    const every = fix({ kind: 'reading', word: '人家', pinyin: 'ren2 jia5' });
    expect(han(page(dict, text, [every])).match(/人家\{[^}]+\}/g)).toEqual(['人家{ren2 jia5}', '人家{ren2 jia5}']);
    const here = fix({ kind: 'reading', word: '人家', pinyin: 'ren2 jia1', at: anchorAt(text, 0, 0, 9, 2) });
    expect(han(page(dict, text, [every], [], [{ fix: here, start: 9 }])).match(/人家\{[^}]+\}/g)).toEqual(['人家{ren2 jia5}', '人家{ren2 jia1}']);
    // A reading that does not fit the word (two syllables for three characters) changes nothing.
    expect(han(page(dict, text, [fix({ kind: 'reading', word: '人家', pinyin: 'ren2' })]))).toBe(han(segment(text, dict)));
  });

  it('lets a place undo the book\'s rule: split everywhere, but one word here', async () => {
    const dict = await loadTestDictionary();
    const text = '先生来了，先生走了。';
    const cut = fix({ kind: 'cut', word: '先生', cuts: [1] });
    const keep = fix({ kind: 'word', word: '先生', pinyin: 'xian1 sheng5', at: anchorAt(text, 0, 0, 5, 2) });
    const toks = page(dict, text, [cut], [], [{ fix: keep, start: 5 }]);
    covers(toks, text);
    expect(han(toks)).toBe('先{xian1}|生{sheng1}|来{lai2}|了{le5}|先生{xian1 sheng5}|走{zou3}|了{le5}');
  });

  it('works on a page shown in the other script: fixes name the book\'s characters', async () => {
    const dict = await loadTestDictionary();
    const source = '這家人家很好。';
    const shown = '这家人家很好。';
    const lex = withFixes(undefined, [fix({ kind: 'reading', word: '人家', pinyin: 'ren2 jia5' })]);
    const toks = segmentShown(shown, source, dict, lex);
    expect(han(toks)).toContain('人家{ren2 jia5}');
    expect(toks.map((t) => t.text).join('')).toBe(shown);
  });
});

describe('a place found again', () => {
  const at = (text: string, offset: number, len: number, block = 0) => anchorAt(text, 4, block, offset, len);

  it('is where the anchor says while the text there is the same', () => {
    const blocks = ['甲乙丙丁戊己庚辛先生壬癸子丑寅卯', '先生'];
    const f = fix({ kind: 'cut', word: '先生', cuts: [1], at: at(blocks[0], 8, 2) });
    expect(placeHere([f], 4, blocks).get(0)).toEqual([{ fix: f, start: 8 }]);
    expect(placeHere([f], 3, blocks).size).toBe(0); // another chapter
  });

  it('follows its context when the book was imported again and the text moved', () => {
    const before = ['他说：甲乙丙丁戊己庚辛先生壬癸子丑寅卯辰巳。'];
    const f = fix({ kind: 'cut', word: '先生', cuts: [1], at: at(before[0], 11, 2) });
    // Two characters more in front of it, and the paragraph is now the second.
    const after = ['第一章', '　　他说：甲乙丙丁戊己庚辛先生壬癸子丑寅卯辰巳。'];
    const placed = placeHere([f], 4, after);
    expect(placed.get(1)).toEqual([{ fix: f, start: 13 }]);
    expect(after[1].slice(13, 15)).toBe('先生');
  });

  it('takes one side of the context when only that side is left, if the place is the only one', () => {
    const text = '甲乙丙丁戊己庚辛先生壬癸子丑寅卯';
    const f = fix({ kind: 'cut', word: '先生', cuts: [1], at: at(text, 8, 2) });
    expect(placeHere([f], 4, ['XX先生壬癸子丑寅卯辰']).get(0)).toEqual([{ fix: f, start: 2 }]);
    expect(placeHere([f], 4, ['甲乙丙丁戊己庚辛先生YY']).get(0)).toEqual([{ fix: f, start: 8 }]);
    // Twice with only one side: nowhere, rather than at the wrong place.
    expect(placeHere([f], 4, ['XX先生壬癸子丑寅卯辰', 'YY先生壬癸子丑寅卯辰']).size).toBe(0);
    expect(placeHere([f], 4, ['先生']).size).toBe(0);
  });

  it('is handed to the piece of a long paragraph that holds it, at its offset there', () => {
    const f = fix({ kind: 'cut', word: '先生', cuts: [1], at: at('x'.repeat(3010) + '先生', 3010, 2) });
    const placed = new Map([[0, [{ fix: f, start: 3010 }]]]);
    expect(hereIn(placed, 0, 0, 3000)).toBeUndefined();
    expect(hereIn(placed, 0, 3000, 100)).toEqual([{ fix: f, start: 10 }]);
  });
});

describe('fixes kept, sent and shared', () => {
  it('cleans what comes from storage, another device or a file', () => {
    const ok = fix({ kind: 'cut', word: '先生', cuts: [1] });
    expect(cleanFix(ok)).toEqual(ok);
    expect(cleanFix({ ...ok, cuts: [0, 2, 1, 1] })?.cuts).toEqual([1]);
    expect(cleanFix({ ...ok, cuts: [5] })).toBeNull();
    expect(cleanFix({ ...ok, word: 'abc' })).toBeNull();
    expect(cleanFix({ ...ok, word: '一'.repeat(17) })).toBeNull();
    expect(cleanFix({ ...ok, kind: 'other' })).toBeNull();
    expect(cleanFix({ ...ok, id: '' })).toBeNull();
    expect(cleanFix(fix({ kind: 'reading', word: '为', pinyin: 'wei2 wei4' }))).toBeNull();
    expect(cleanFix(fix({ kind: 'reading', word: '为', pinyin: 'WEI2' }))?.pinyin).toBe('wei2');
    const word = cleanFix({ ...fix({ kind: 'word', word: '子君', pinyin: 'zi3 jun1' }), role: 'king', gloss: ' x '.repeat(200) });
    expect(word?.role).toBe('user');
    expect(word?.gloss?.length).toBeLessThanOrEqual(300);
    // A one-character word is a join only at one place.
    expect(cleanFix(fix({ kind: 'word', word: '君' }))).toBeNull();
    const at = cleanFix(fix({ kind: 'word', word: '子君', at: { chapter: 1, block: 2, offset: 3, before: '一二三四五六七八九十', after: '' } }));
    expect(at?.at?.before).toBe('一二三四五六七八');
    expect(cleanFix(fix({ kind: 'word', word: '子君', at: { chapter: -1, block: 2, offset: 3, before: '', after: '' } }))).toBeNull();
    expect(cleanFix({ ...fix({ kind: 'spelling', word: '底' }), at: { chapter: 0, block: 0, offset: 0, before: '', after: '' } })).toBeNull();
    // A fix that does not say which device's book it is on is on the book of its key.
    const { bookId: _b, ...wire } = ok;
    void _b;
    expect(cleanFix(wire)?.bookId).toBe(BOOK.key);
  });

  it('writes a corrections file and reads it into another copy of the book, with that book\'s ids', () => {
    const at = { chapter: 1, block: 2, offset: 3, before: '甲乙', after: '丙丁' };
    const fixes = [
      fix({ kind: 'cut', word: '先生', cuts: [1] }),
      fix({ kind: 'word', word: '子君', pinyin: 'zi3 jun1', role: 'name', n: 46 }),
      fix({ kind: 'reading', word: '为', pinyin: 'wei2', at }),
      fix({ kind: 'word', word: '书生', pinyin: 'shu1 sheng1', book: '*', bookId: '*' }),
    ];
    const json = exportFixes(fixes, { title: '一本书', key: BOOK.key });
    const data = JSON.parse(json);
    expect(data).toMatchObject({ app: 'dushu', corrections: 1, book: { title: '一本书', key: BOOK.key } });
    expect(JSON.stringify(data.fixes)).not.toContain(BOOK.id); // the device's own ids stay on the device
    const other = { id: 'ipad-7', key: 'bzzz' };
    const back = importFixes(json, other);
    expect(back).toHaveLength(4);
    expect(back[0]).toMatchObject({ book: 'bzzz', bookId: 'ipad-7', kind: 'cut', cuts: [1], id: fixId('bzzz', 'cut', '先生') });
    expect(back[2].at).toEqual(at);
    expect(back[3]).toMatchObject({ book: '*', bookId: '*' });
    expect(() => importFixes('not json', other)).toThrow(/not valid JSON/);
    expect(() => importFixes('{"app":"dushu","version":1}', other)).toThrow(/not a LinguPengu corrections file/);
    expect(() => importFixes('{"app":"dushu","corrections":2,"fixes":[]}', other)).toThrow(/newer version/);
  });

  it('counts the places a word is in the book', () => {
    expect(countIn(['先生来了，先生走了。', '老先生'], '先生')).toBe(3);
    expect(countIn(['哈哈哈'], '哈哈')).toBe(1);
    expect(countIn(['先生'], '')).toBe(0);
  });
});
