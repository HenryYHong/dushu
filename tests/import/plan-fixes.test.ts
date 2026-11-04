// @vitest-environment jsdom
// The import fixes one at a time: UTF-8 with bad bytes, radicals from Mac PDFs, headings, ads cut off story lines, hard
// wraps, Big5-HKSCS, ciphertext EPUBs. The import suite (suite.test.ts) checks the same through whole files.
import { describe, expect, it } from 'vitest';
import { decodeText, unreadableMessage } from '../../src/import/encoding';
import { radicalMender, mapPlainRadicals } from '../../src/import/radicals';
import { cutAdTail, isBoilerplateLine, storyPart } from '../../src/import/boilerplate';
import { chaptersFromBlocks, detectHeadingLine, linesToParagraphs, normalizeHeading, paragraphsToBlocks, wrapsExactly } from '../../src/import/chapters';
import { mapHkscsPrivateUse } from '../../src/import/hkscs';
import { looksEncrypted } from '../../src/import/epub';
import { pagesToParagraphs, pdfCharacters } from '../../src/import/pdfLayout';
import { prose } from './helpers';

const utf8 = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((p) => [...p]));

describe('UTF-8 with bad bytes', () => {
  const text = prose(3000);
  it('stays UTF-8 when a byte in the middle is bad, and counts it', () => {
    const d = decodeText(cat(utf8(text.slice(0, 100)), [0xff], utf8(text.slice(100))));
    expect(d.encoding).toBe('utf-8');
    expect(d.unreadable).toBe(1);
    expect(d.text).toBe(text.slice(0, 100) + '�' + text.slice(100));
  });
  it('leaves out a character cut in half at the end of the file', () => {
    const d = decodeText(utf8(text).slice(0, -1));
    expect(d).toEqual({ text: text.slice(0, -1), encoding: 'utf-8', unreadable: 1 });
  });
  it('reads a line pasted in from a GBK file as GBK', () => {
    const gbk = [0xb1, 0xbe, 0xd5, 0xc2, 0xd3, 0xc9, 0xc8, 0xc8, 0xd0, 0xc4, 0xca, 0xe9, 0xd3, 0xd1, 0xc9, 0xcf, 0xb4, 0xab]; // 本章由热心书友上传
    const d = decodeText(cat(utf8(text + '\n'), gbk, utf8('\n' + text)));
    expect(d.encoding).toBe('utf-8');
    expect(d.text.split('\n')[1]).toBe('本章由热心书友上传');
    expect(d.unreadable).toBeUndefined();
  });
  it('does not take a GBK file for UTF-8, nor a mostly-English GBK file', () => {
    const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7]); // 你好世界
    expect(decodeText(cat(...Array.from({ length: 200 }, () => gbk))).encoding).toBe('gb18030');
    expect(decodeText(cat(utf8('The quick brown fox jumps over the lazy dog. '.repeat(200)), gbk)).encoding).toBe('gb18030');
  });
  it('words the notice', () => {
    expect(unreadableMessage(1)).toBe('1 character could not be read and shows as �.');
    expect(unreadableMessage(1234)).toBe('1,234 characters could not be read and show as �.');
  });
});

describe('radicals from a Mac PDF', () => {
  it('maps a radical standing for a character, one at a time, and leaves a list of radicals alone', () => {
    const mend = radicalMender(['⼭⼤⼈⼩，⼀⽬了然。', '⼀ ⼁ ⼂ ⼃', '他 ⼈ 来'])!;
    expect(mend('⼭⼤⼈⼩，⼀⽬了然。')).toBe('山大人小，一目了然。');
    expect(mend('⼀ ⼁ ⼂ ⼃')).toBe('⼀ ⼁ ⼂ ⼃');
    // A PDF line with stray spaces: a character on each side, one space away.
    expect(mend('他 ⼈ 来')).toBe('他 人 来');
    expect(radicalMender(['没有部首的书。'])).toBeNull();
  });
  it('reads ⼜ as 口 in a book whose font left 又 alone (Songti SC), and as 又 where 口 has its own radical (PingFang)', () => {
    const songti = ['他⼜不开⼜，又走了。', '她又来，又去。', '⼀⼜唾沫'];
    const m1 = radicalMender(songti)!;
    expect(m1('他⼜不开⼜，又走了。')).toBe('他口不开口，又走了。');
    expect(m1('⼀⼜唾沫')).toBe('一口唾沫');
    const pingfang = ['她⼜笑，⼜唱⼀⽀曲。', '⼈⼝很多，开⼝说话。'];
    const m2 = radicalMender(pingfang)!;
    expect(m2('她⼜笑，⼜唱⼀⽀曲。')).toBe('她又笑，又唱一支曲。');
    expect(m2('⼈⼝很多，开⼝说话。')).toBe('人口很多，开口说话。');
  });
  it('decides by the words a two-way radical makes when the book does not say', () => {
    const m = radicalMender(['开⼜说话', '他⼜'])!;
    expect(m('开⼜说话')).toBe('开口说话');
    expect(m('他⼜')).toBe('他又');
  });
  it('maps radicals and vertical punctuation in PDF text before its lines are read (two-way ones wait)', () => {
    expect(mapPlainRadicals('第⼆章 ⼤⾬')).toBe('第二章 大雨');
    expect(pdfCharacters('他說︐﹃好︒﹄⼜')).toBe('他說，『好。』⼜');
  });
});

describe('justified PDF lines', () => {
  it('drops the narrow spaces a justified line carries and keeps a heading\'s wide one', () => {
    const items = [
      { str: '第一章 序', x: 100, y: 700, w: 15 * 5 + 5, size: 15 },
      { str: '他 走 进 了 门 ，', x: 50, y: 660, w: 11 * 6 + 5 * 2, size: 11 },
      { str: '看见阿 Q 在那里坐着。', x: 50, y: 640, w: 11 * 9 + 6 + 2 * 2, size: 11 },
    ];
    expect(pagesToParagraphs([{ width: 420, height: 800, items }])).toEqual(['第一章 序', '他走进了门，看见阿Q在那里坐着。']);
  });
});

describe('headings', () => {
  it('reads 【第N章】, 正文 第N章 and ## headings', () => {
    expect(detectHeadingLine('【第一章】序')).toEqual({ level: 2 });
    expect(detectHeadingLine('[第3卷]')).toEqual({ level: 1 });
    expect(detectHeadingLine('正文 第一章 风雪')).toEqual({ level: 2 });
    expect(detectHeadingLine('## 第一章 风雪')).toEqual({ level: 2 });
    expect(normalizeHeading('正文 第一章 风雪')).toBe('第一章 风雪');
    expect(normalizeHeading('## 第一章　风雪')).toBe('第一章 风雪');
    expect(detectHeadingLine('正文写得很好')).toBeNull();
  });
  it('makes chapters of numbered titled sections spread through a text, but not of a list inside it', () => {
    const body = (n: number) => prose(2000, n);
    const sections = ['一、风雪', body(1), body(2), '二、山神庙', body(3), '三、夜奔', body(4), body(5)];
    expect(chaptersFromBlocks(paragraphsToBlocks(sections), { title: 'T' }).map((c) => c.title)).toEqual(['一、风雪', '二、山神庙', '三、夜奔']);
    const list = [body(1), '一、早起', '二、读书', '三、写字', body(2), body(3), body(4), body(5), body(6), body(7), body(8), body(9), body(10), body(11), body(12)];
    expect(chaptersFromBlocks(paragraphsToBlocks(list), { title: 'T' }).map((c) => c.title)).not.toContain('一、早起');
    const md = [body(1), '## 风雪', body(2), '## 山神庙', body(3)];
    expect(chaptersFromBlocks(paragraphsToBlocks(md), { title: 'T' }).map((c) => c.title)).toEqual(['T', '风雪', '山神庙']);
  });
});

describe('ads at the end of a story line', () => {
  it('cuts the ad off and keeps the story', () => {
    expect(storyPart('『嚄，阿Q，你回来了！』（更多精彩请访问 www.example.com）')).toBe('『嚄，阿Q，你回来了！』');
    expect(storyPart('雨停了，船也靠岸。求月票！求推荐！')).toBe('雨停了，船也靠岸。');
    expect(cutAdTail('雨停了，船也靠岸。求收藏~求订阅！')).toBe('雨停了，船也靠岸。');
    expect(storyPart('求月票！求推荐！求收藏！')).toBeNull();
    expect(isBoilerplateLine('求月票！求推荐！求收藏！')).toBe(true);
    expect(storyPart('他求推荐信的事，后来没有下文。')).toBe('他求推荐信的事，后来没有下文。');
  });
});

describe('hard wraps', () => {
  it('ends a paragraph at a line one character short of an exact width', () => {
    const w = 20;
    const a = prose(45, 1);
    const b = prose(38, 2);
    const lines = [...a.match(/.{1,20}/gu)!, ...b.match(/.{1,20}/gu)!];
    const filler = Array.from({ length: 30 }, (_, i) => prose(40, i).slice(0, 20));
    expect(wrapsExactly([...lines, ...filler], w)).toBe(true);
    const short = [...prose(39, 3)].slice(0, 39).join('');
    const out = linesToParagraphs([short.slice(0, 20), short.slice(20), '他看了看我。'], w, true);
    expect(out).toEqual([short, '他看了看我。']);
  });
  it('starts a new paragraph at a quotation after a line that ends a sentence, in a text without indents', () => {
    const full = '他慢慢地走到桌边，拿起那本旧书，看了很久。';
    const w = [...full].length;
    const out = linesToParagraphs([full, '“你来了？”他说。'], w);
    expect(out).toEqual([full, '“你来了？”他说。']);
  });
});

describe('Big5-HKSCS', () => {
  it('puts back the Hong Kong characters a decoder gave as private-use code points', () => {
    const decoded = new TextDecoder('big5').decode(new Uint8Array([0x9a, 0xac, 0xfc, 0xd4]));
    expect(mapHkscsPrivateUse(decoded)).toBe('麽旣');
    expect(mapHkscsPrivateUse('普通文字')).toBe('普通文字');
  });
});

describe('ciphertext in an EPUB', () => {
  it('tells encrypted chapter bytes from markup', () => {
    const random = Uint8Array.from({ length: 3000 }, (_, i) => (i * 2654435761) >>> 24);
    expect(looksEncrypted(random)).toBe(true);
    expect(looksEncrypted(utf8('<?xml version="1.0"?><html><body><p>' + prose(500) + '</p></body></html>'))).toBe(false);
    expect(looksEncrypted(cat([0xef, 0xbb, 0xbf], utf8('\n  <html>' + prose(100))))).toBe(false);
  });
});
