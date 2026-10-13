// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFile, importText } from '../../src/import';
import { detectHeadingLine, detectWrapWidth, linesToParagraphs, splitLongParagraph, textToBlocks } from '../../src/import/chapters';
import { decodeText, normalizeCharset, scoreDecoding } from '../../src/import/encoding';
import { asFile, prose } from './helpers';

const fx = (name: string) => new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'import', name)));
const simplified = readFileSync(join(__dirname, '..', 'fixtures', 'import', 'sample-simplified.txt'), 'utf8');
const traditional = readFileSync(join(__dirname, '..', 'fixtures', 'import', 'sample-traditional.txt'), 'utf8');

describe('encoding detection', () => {
  const cases: [string, string, string][] = [
    ['simplified.utf8.bom.txt', 'utf-8', simplified],
    ['simplified.utf16le.bom.txt', 'utf-16le', simplified],
    ['simplified.utf16be.bom.txt', 'utf-16be', simplified],
    ['simplified.utf16le.nobom.txt', 'utf-16le', simplified],
    ['simplified.gb18030.txt', 'gb18030', simplified],
    ['traditional.big5.txt', 'big5', traditional],
    ['traditional.gb18030.txt', 'gb18030', traditional],
  ];
  it.each(cases)('%s decodes as %s', (file, encoding, expected) => {
    const d = decodeText(fx(file));
    expect(d.encoding).toBe(encoding);
    expect(d.text).toBe(expected);
  });

  it('prefers valid UTF-8 and ignores a wrong hint', () => {
    const bytes = new TextEncoder().encode(simplified);
    expect(decodeText(bytes, 'big5')).toEqual({ text: simplified, encoding: 'utf-8' });
  });

  it('tells GBK from Big5 on a very short text', () => {
    const gbk = Uint8Array.from([0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7, 0xa1, 0xa3]); // 你好，世界。
    expect(decodeText(gbk).text).toBe('你好，世界。');
    const big5 = Uint8Array.from([0xa7, 0x41, 0xa6, 0x6e, 0xa1, 0x41, 0xa5, 0x40, 0xac, 0xc9, 0xa1, 0x43]);
    expect(decodeText(big5).text).toBe('你好，世界。');
  });

  it('scores real text above a wrong decode', () => {
    const wrong = new TextDecoder('big5').decode(fx('simplified.gb18030.txt'));
    expect(scoreDecoding(simplified)).toBeGreaterThan(0.8);
    expect(scoreDecoding(wrong)).toBeLessThan(0.3);
  });

  it('maps charset labels', () => {
    expect(normalizeCharset('GB2312')).toBe('gb18030');
    expect(normalizeCharset('"Big5-HKSCS"')).toBe('big5');
    expect(normalizeCharset('UTF8')).toBe('utf-8');
    expect(normalizeCharset('nonsense-9')).toBeUndefined();
  });

  it('imports each encoding end to end', async () => {
    for (const [file, , expected] of cases) {
      const book = await importFile(asFile(fx(file), '书.txt'));
      expect(book.chapters.map((c) => c.title), file).toEqual(expected.split('\n').filter((l) => l.startsWith('第')));
      expect(book.chapters[0].blocks.filter((b) => b.t === 'p')).toHaveLength(2);
      expect(JSON.stringify(book.chapters)).toContain(expected.split('\n')[2].slice(0, 12));
    }
  });
});

describe('chapter heading detection', () => {
  it.each([
    '第一章', '第12章 出发', '第三百二十一回 大闹天宫', '第一卷', '第二部 风云', '序', '序章', '序言', '楔子', '引子', '前言', '后记', '後記',
    '尾声', '尾聲', '番外', '番外一 重逢', 'Chapter 12', 'CHAPTER 3 The Road', '第 一 章', '卷一', '第〇章', '第１章', '\u3000\u3000第五章\u3000黄昏', '附录：人物表', '第十章 谁是凶手？',
  ])('accepts %s', (line) => {
    expect(detectHeadingLine(line)).not.toBeNull();
  });

  it.each([
    '第一次见面的时候他很紧张', '序号', '第三章里说过的话。', '他说：“第一章讲的是什么。”', '序列号是多少', '尾巴', '引子弹', 'chapter', '第一章，他走了。', '', '后记得很清楚',
    '第一章 ' + '很长的标题'.repeat(10),
  ])('rejects %j', (line) => {
    expect(detectHeadingLine(line)).toBeNull();
  });

  it('levels: volumes are 1, chapters are 2', () => {
    expect(detectHeadingLine('第一卷 少年')?.level).toBe(1);
    expect(detectHeadingLine('第一章 少年')?.level).toBe(2);
  });
});

describe('TXT chapters', () => {
  it('splits on markers and keeps the text before the first one as the opening', async () => {
    const text = `《测试》\n作者：李四\n\n${prose(300)}\n\n第一章 起\n\n${prose(200)}\n\n第二章 承\n\n${prose(200, 1)}\n\n后记\n\n${prose(100, 2)}`;
    const book = await importFile(asFile(new TextEncoder().encode(text), '书.txt'));
    expect(book.title).toBe('书');
    expect(book.chapters.map((c) => c.title)).toEqual(['书', '第一章 起', '第二章 承', '后记']);
  });

  it('prefers a Chinese first-line title over an ASCII file name', async () => {
    const book = await importFile(asFile(new TextEncoder().encode(`《测试》\n\n${prose(300)}`), 'whatever.txt'));
    expect(book.title).toBe('测试');
  });

  it('takes the title from "《》" on the first line when the file name says nothing', async () => {
    const text = `《红楼梦》\n作者：曹雪芹\n\n第一回 甄士隐梦幻识通灵\n${prose(120)}\n\n第二回 贾夫人仙逝扬州城\n${prose(120, 1)}`;
    const book = await importFile(asFile(new TextEncoder().encode(text), '新建文本文档.txt'));
    expect(book.title).toBe('红楼梦');
    expect(book.author).toBe('曹雪芹');
    expect(book.chapters.map((c) => c.title)).toEqual(['第一回 甄士隐梦幻识通灵', '第二回 贾夫人仙逝扬州城']);
  });

  it('reads title and author from a file name like "活着 作者：余华 (精校版).txt"', async () => {
    const book = await importFile(asFile(new TextEncoder().encode(`${prose(300)}`), '活着 作者：余华 (精校版).txt'));
    expect(book.title).toBe('活着');
    expect(book.author).toBe('余华');
  });

  it('drops a first line that repeats the file name', async () => {
    const book = await importFile(asFile(new TextEncoder().encode(`三体\n\n${prose(300)}`), '三体.txt'));
    expect(book.title).toBe('三体');
    expect(book.chapters[0].blocks[0]).toMatchObject({ t: 'p' });
    expect(JSON.stringify(book.chapters[0].blocks[0])).not.toContain('三体');
  });

  it('cuts text with no markers into parts of about 4,000 characters', async () => {
    const paras = Array.from({ length: 40 }, (_, i) => prose(500, i)).join('\n');
    const book = await importFile(asFile(new TextEncoder().encode(paras), '长篇.txt'));
    expect(book.chapters.length).toBeGreaterThanOrEqual(4);
    expect(book.chapters.map((c) => c.title)).toEqual(book.chapters.map((_, i) => `Part ${i + 1}`));
    for (const c of book.chapters.slice(0, -1)) {
      const han = c.blocks.reduce((n, b) => n + (b.t === 'p' ? [...b.text].filter((ch) => /[一-鿿]/.test(ch)).length : 0), 0);
      expect(han).toBeGreaterThanOrEqual(3500);
      expect(han).toBeLessThan(5200);
    }
  });

  it('keeps a short text as one chapter named for the book', () => {
    const book = importText(prose(400), '短篇');
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].title).toBe('短篇');
    expect(book.format).toBe('paste');
  });

  it('does not make chapters out of a typed table of contents', () => {
    const toc = Array.from({ length: 6 }, (_, i) => `第${i + 1}章 标题${i + 1}`).join('\n');
    const body = Array.from({ length: 6 }, (_, i) => `第${i + 1}章 标题${i + 1}\n${prose(200, i)}`).join('\n');
    const book = importText(`目录\n${toc}\n\n${body}`, '书');
    expect(book.chapters.map((c) => c.title)).toEqual(['目录', ...Array.from({ length: 6 }, (_, i) => `第${i + 1}章 标题${i + 1}`)]);
    expect(book.chapters[0].blocks.map((b) => b.t)).toEqual(['h', ...Array(6).fill('p')]);
  });

  it('puts volume headings with the first chapter of the volume', () => {
    const text = ['第一卷 少年', '第一章 初见', prose(120), '第二章 离别', prose(120, 1), '第二卷 青年', '第三章 重逢', prose(120, 2)].join('\n');
    const book = importText(text, '书');
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章 初见', '第二章 离别', '第三章 重逢']);
    expect(book.chapters[0].blocks[0]).toMatchObject({ t: 'h', level: 1, text: '第一卷 少年' });
  });

  it('removes site boilerplate lines and scene-break rules at the edges', () => {
    const text = `本书由“某某书苑”整理，更多电子书下载：www.example.com\n\n${prose(60)}\n\n********\n\n${prose(60, 1)}\n\n更多精校小说尽在 http://www.example.com 下载\n====`;
    const book = importText(text, '书');
    expect(book.chapters[0].blocks.map((b) => b.t)).toEqual(['p', 'hr', 'p']);
  });

  it('splits a single enormous line at sentence ends', () => {
    const one = prose(9000);
    const book = importText(one, '书');
    const blocks = book.chapters.flatMap((c) => c.blocks);
    expect(blocks.length).toBeGreaterThan(3);
    expect(blocks.map((b) => (b.t === 'p' ? b.text : '')).join('')).toBe(one);
    for (const p of splitLongParagraph(one)) expect([...p].length).toBeLessThan(2000);
  });

  it('normalizes CRLF and old Mac line endings', () => {
    const a = importText(`第一章 甲\r\n${prose(60)}\r\n第二章 乙\r\n${prose(60, 1)}`, '书');
    const b = importText(`第一章 甲\r${prose(60)}\r第二章 乙\r${prose(60, 1)}`, '书');
    expect(a.chapters.map((c) => c.title)).toEqual(['第一章 甲', '第二章 乙']);
    expect(b.chapters.map((c) => c.title)).toEqual(['第一章 甲', '第二章 乙']);
  });
});

describe('other structure', () => {
  it('splits on running numerals alone on a line', () => {
    const text = ['一', prose(100), '二', prose(100, 1), '三', prose(100, 2), '十二', prose(50, 3)].join('\n');
    const book = importText(text, '日记');
    expect(book.chapters.map((c) => c.title)).toEqual(['一', '二', '三']);
    expect(book.chapters[2].blocks.map((b) => b.t)).toEqual(['h', 'p', 'p', 'p']);
  });

  it('does not split on stray numerals that do not count up from one', () => {
    const book = importText(['三', prose(100), '五', prose(100, 1), '七', prose(100, 2)].join('\n'), '书');
    expect(book.chapters).toHaveLength(1);
  });

  it('strips the Project Gutenberg license header and footer', () => {
    const text = [
      'The Project Gutenberg eBook of Test', 'This ebook is for the use of anyone anywhere.', '*** START OF THE PROJECT GUTENBERG EBOOK TEST ***',
      prose(100), '*** END OF THE PROJECT GUTENBERG EBOOK TEST ***', 'THE FULL PROJECT GUTENBERG LICENSE',
    ].join('\n');
    const book = importText(text, '书');
    expect(book.chapters).toHaveLength(1);
    expect(JSON.stringify(book.chapters)).not.toMatch(/Gutenberg/i);
  });
});

describe('hard-wrap joining', () => {
  const para = (n: number, seed: number) => prose(n, seed);
  const wrap = (s: string, width: number): string[] => {
    const chars = [...s];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i += width) out.push(chars.slice(i, i + width).join(''));
    return out;
  };

  it('joins lines wrapped at a fixed width', () => {
    const paras = [para(150, 0), para(130, 1), para(170, 2)];
    const text = paras.map((p) => wrap(p, 30).join('\n')).join('\n');
    const blocks = textToBlocks(text);
    expect(blocks.map((b) => (b.t === 'p' ? b.text : ''))).toEqual(paras);
  });

  it('joins wrapped lines inside blank-line separated paragraphs', () => {
    const paras = [para(150, 0), para(130, 1)];
    const blocks = textToBlocks(paras.map((p) => wrap(p, 28).join('\n')).join('\n\n'));
    expect(blocks.map((b) => (b.t === 'p' ? b.text : ''))).toEqual(paras);
  });

  it('starts a new paragraph at an indented line even when the previous line is full', () => {
    const a = para(60, 0);
    const b = para(60, 1);
    const lines = [...wrap(a, 20), ...wrap(b, 20).map((l, i) => (i === 0 ? '\u3000\u3000' + l : l))];
    lines[0] = '\u3000\u3000' + lines[0];
    const more = Array.from({ length: 6 }, (_, i) => para(100, i + 2)).flatMap((p) => wrap(p, 20).map((l, j) => (j === 0 ? '\u3000\u3000' + l : l)));
    const blocks = textToBlocks([...lines, ...more].join('\n'));
    expect(blocks[0]).toEqual({ t: 'p', text: a });
    expect(blocks[1]).toEqual({ t: 'p', text: b });
    expect(blocks).toHaveLength(8);
  });

  it('leaves one-paragraph-per-line text alone', () => {
    const lines = Array.from({ length: 30 }, (_, i) => para(15 + ((i * 37) % 90), i));
    const blocks = textToBlocks(lines.join('\n'));
    expect(blocks.map((b) => (b.t === 'p' ? b.text : ''))).toEqual(lines);
    expect(detectWrapWidth(lines)).toBe(0);
  });

  it('does not treat a poem of equal-length lines as wrapped', () => {
    const poem = Array.from({ length: 24 }, (_, i) => (i % 2 ? '疑是地上霜，举头望明月。' : '床前明月光，低头思故乡。').slice(0, 12));
    expect(detectWrapWidth(poem)).toBe(0);
  });

  it('keeps headings on their own when joining', () => {
    const lines = [...wrap(para(90, 0), 30), '第二章 山', ...wrap(para(90, 1), 30)];
    expect(linesToParagraphs(lines, 30)).toEqual([para(90, 0), '第二章 山', para(90, 1)]);
  });

  it('joins Latin words across a wrap with a space', () => {
    expect(linesToParagraphs(['0123456789012345678901234567 hello', 'world 你好'], 34)).toEqual(['0123456789012345678901234567 hello world 你好']);
  });
});

describe('pasted text', () => {
  it('rejects empty and non-Chinese input with clear errors', () => {
    expect(() => importText('   ')).toThrow(/no text/i);
    expect(() => importText('Only English here, nothing else to see.')).toThrow(/No Chinese text/);
  });

  it('takes the title from a short first line when none is given', () => {
    const book = importText(`静夜思\n${prose(80)}`);
    expect(book.title).toBe('静夜思');
  });

  it('accepts a very short Chinese sentence', () => {
    const book = importText('我喜欢学习中文。', '句子', '我');
    expect(book.title).toBe('句子');
    expect(book.author).toBe('我');
  });
});
