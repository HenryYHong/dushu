// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importFile, importText } from '../../src/import';
import { isBoilerplateLine, stripBoilerplate, stripUrlTail } from '../../src/import/boilerplate';
import { detectHeadingLine, normalizeHeading } from '../../src/import/chapters';
import { asFile, prose } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);

describe('isBoilerplateLine', () => {
  it.each([
    '本书由 www.example.com 整理制作',
    '【本书由“某某论坛”整理，仅供学习交流】',
    '更多精彩小说请访问 www.example.com',
    '更多精彩尽在 http://www.example.com/book/123.html',
    '更多精彩内容请关注',
    '射雕英雄传txt下载',
    '《射雕英雄传》TXT电子书下载',
    '手机阅读请访问 m.example.com',
    '手机用户请浏览 m.example.cn 阅读',
    '射雕英雄传最新章节',
    '射雕英雄传全文阅读',
    '上一章 目录 下一章',
    '[上一页] [返回目录] [下一页]',
    '（未完待续）',
    '(本章未完)',
    'www.example.com',
    'http://www.example.com/read/1.html',
    'ｗｗｗ．ｅｘａｍｐｌｅ．ｃｏｍ',
    '请记住本站域名：example.com',
    '本站网址：www.example.com 请收藏',
    '本书仅供试阅，请在24小时内删除',
    '笔趣阁',
    '加入书签',
  ])('drops %s', (line) => {
    expect(isBoilerplateLine(line)).toBe(true);
  });

  it.each([
    '他把手机放在桌上，说：“这本书由我来整理。”',
    '郭靖道：“我们去更多的地方看看。”',
    '那封信上写着：“请到最新的地址来找我。”',
    '他打开手机阅读了一遍新闻，然后睡去。',
    '第一回 风雪惊变',
    '目录',
    '后记',
    '下一章的故事要从江南说起，但在这之前，先要说说牛家村。',
    '“上一次你说过，下一次再来。”',
    '全文完',
    '他在网站上看到了那条消息。',
    prose(80),
  ])('keeps %s', (line) => {
    expect(isBoilerplateLine(line)).toBe(false);
  });

  it('cuts a call to action off the end of a real line', () => {
    const real = '郭靖拔出长剑，向前一指，大声喝道：你们这些人，快快放下兵器。';
    expect(stripUrlTail(`${real} 更多精彩请访问 www.example.com`)).toBe(real);
    expect(stripUrlTail(real)).toBe(real);
    expect(stripUrlTail('欢迎访问 www.example.com')).toBe('欢迎访问 www.example.com'); // nothing before it to keep
  });
});

describe('stripBoilerplate', () => {
  const body = (n: number) => Array.from({ length: n }, (_, i) => prose(60, i * 3) + `第${i}节。`);

  it('removes a line stamped through the whole book, and nothing else', () => {
    const lines: string[] = [];
    body(300).forEach((l, i) => {
      lines.push(l);
      if (i % 20 === 0) lines.push('金庸作品集（连载）');
    });
    const out = stripBoilerplate(lines);
    expect(out.filter((l) => l.includes('金庸作品集'))).toHaveLength(0);
    expect(out.length).toBe(300);
  });

  it('keeps lines that repeat only a few times, locally, or end a sentence', () => {
    const lines = body(300);
    for (let i = 0; i < 8; i++) lines.splice(i * 30, 0, '这是一句重复八次的话语啊');
    for (let i = 0; i < 12; i++) lines.splice(100 + i, 0, '啦啦啦啦啦啦啦啦'); // a refrain, in one place
    for (let i = 0; i < 15; i++) lines.splice(i * 18, 0, '“好。”');
    const out = stripBoilerplate(lines);
    expect(out).toEqual(lines);
  });

  it('never drops headings, rules or blank lines that repeat', () => {
    const lines: string[] = [];
    body(300).forEach((l, i) => {
      lines.push('', l);
      if (i % 20 === 0) lines.push('第一章', '※※※※');
    });
    const out = stripBoilerplate(lines, { isHeading: (l) => !!detectHeadingLine(l) });
    expect(out).toEqual(lines);
  });

  it('leaves short texts alone', () => {
    const lines = Array.from({ length: 30 }, () => '站点名称重复出现的行');
    expect(stripBoilerplate(lines)).toEqual(lines);
  });
});

describe('text files from download sites', () => {
  const junkHead = ['【www.example.com】射雕英雄传 txt下载', '本书由“某某论坛”整理制作', '更多精彩小说，尽在 www.example.com', ''];
  const chapter = (heading: string, n: number) => [heading, '', ...Array.from({ length: 8 }, (_, k) => `　　${prose(120, n * 9 + k)}`), '', '（未完待续）', '手机阅读请访问 m.example.com', '射雕英雄传最新章节', ''];

  it('strips the boilerplate and keeps the story', async () => {
    const lines = [...junkHead, '射雕英雄传', '作者：金庸', '', ...chapter('第一回 风雪惊变', 1), ...chapter('第二回 江南七怪', 2), ...chapter('第三回 大漠风沙', 3)];
    const book = await importFile(asFile(enc(lines.join('\r\n')), '射雕英雄传.txt'));
    expect(book.title).toBe('射雕英雄传');
    expect(book.author).toBe('金庸');
    expect(book.chapters.map((c) => c.title)).toEqual(['第一回 风雪惊变', '第二回 江南七怪', '第三回 大漠风沙']);
    const text = book.chapters.flatMap((c) => c.blocks.map((b) => (b.t === 'p' || b.t === 'h' ? b.text : ''))).join('\n');
    expect(text).not.toMatch(/example|整理制作|未完待续|手机阅读|最新章节|txt下载/i);
    expect(text).toContain(prose(120, 9));
    for (const c of book.chapters) expect(c.blocks.filter((b) => b.t === 'p')).toHaveLength(8);
  });

  it('drops a site name repeated on every page of a long file', async () => {
    const lines: string[] = ['射雕英雄传'];
    for (let c = 1; c <= 12; c++) {
      lines.push(`第${c}回 标题${c}`, '');
      for (let k = 0; k < 20; k++) {
        lines.push(prose(100, c * 20 + k) + `${c}-${k}。`);
        if (k % 5 === 4) lines.push('金庸武侠小说全集 · 某某书屋');
      }
    }
    const book = await importFile(asFile(enc(lines.join('\n')), 'x.txt'));
    const text = book.chapters.flatMap((c) => c.blocks.map((b) => (b.t === 'p' ? b.text : ''))).join('\n');
    expect(text).not.toContain('某某书屋');
    expect(book.chapters).toHaveLength(12);
  });

  it('applies to pasted text too', () => {
    const book = importText(['更多精彩小说请访问 www.example.com', '第一章 起', ...Array.from({ length: 6 }, (_, k) => prose(100, k))].join('\n'), '粘贴');
    const text = book.chapters.flatMap((c) => c.blocks.map((b) => (b.t === 'p' ? b.text : ''))).join('\n');
    expect(text).not.toContain('example');
  });

  it('reads full-width digits and a colon after the chapter marker', async () => {
    const lines = ['书名', ''];
    const heads = ['第１回：风雪惊变', '第２回　江南七怪', '第十二回： 大漠风沙', '第３回：'];
    heads.forEach((h, i) => lines.push(h, ...Array.from({ length: 4 }, (_, k) => `${prose(120, i * 5 + k)}`), ''));
    const book = await importFile(asFile(enc(lines.join('\n')), 'b.txt'));
    expect(book.chapters.map((c) => c.title)).toEqual(['第1回 风雪惊变', '第2回 江南七怪', '第十二回 大漠风沙', '第3回']);
    expect(book.chapters[0].blocks[0]).toEqual({ t: 'h', level: 2, text: '第1回 风雪惊变' });
  });
});

describe('normalizeHeading', () => {
  it.each([
    ['第１２回　风雪惊变', '第12回 风雪惊变'],
    ['第一章：风雪惊变', '第一章 风雪惊变'],
    ['第一章:  风雪惊变', '第一章 风雪惊变'],
    ['第一章：', '第一章'],
    ['第一章 风雪：惊变', '第一章 风雪：惊变'],
    ['楔子', '楔子'],
  ])('%s becomes %s', (raw, want) => {
    expect(normalizeHeading(raw)).toBe(want);
  });
});
