// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { markdownToBlocks } from '../../src/import/html';
import { PNG, asFile, prose } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);

describe('HTML import', () => {
  it('reads title, author, headings and paragraphs', async () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>小城故事 - 某网站</title><meta name="author" content="沈从文">
      <style>p{}</style></head><body><nav>首页 | 目录</nav>
      <h1>边城</h1><h2>第一章 渡口</h2><p>${prose(120)}</p><h2>第二章 白塔</h2><p>${prose(120, 1)}</p></body></html>`;
    const book = await importFile(asFile(enc(html), 'page.html'));
    expect(book.author).toBe('沈从文');
    expect(book.title).toContain('小城故事');
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章 渡口', '第二章 白塔']);
    expect(JSON.stringify(book.chapters)).not.toContain('首页');
    expect(book.format).toBe('html');
  });

  it('decodes a Big5 page by its meta tag and handles self-closing tags', async () => {
    const big5 = Uint8Array.from([
      ...enc('<html><head><meta http-equiv="Content-Type" content="text/html; charset=big5"></head><body><div id="a"/><p>'),
      0xa7, 0x41, 0xa6, 0x6e, 0xa1, 0x41, 0xa5, 0x40, 0xac, 0xc9, 0xa1, 0x43, 0xa7, 0xda, 0xad, 0xcc, 0xa6, 0x62, 0xb3, 0x6f, 0xb8, 0xcc, 0xc5, 0xaa, 0xae, 0xd1, 0xa1, 0x43,
      ...enc('</p></body></html>'),
    ]);
    const book = await importFile(asFile(big5, 'p.htm'));
    expect(JSON.stringify(book.chapters)).toContain('你好，世界。我們在這裡讀書。');
    expect(book.script).toBe('traditional');
  });

  it('keeps inline data: images', async () => {
    const b64 = btoa(String.fromCharCode(...PNG));
    const html = `<html><body><h1>图</h1><p>${prose(60)}</p><img src="data:image/png;base64,${b64}"><img src="photo.jpg"></body></html>`;
    const book = await importFile(asFile(enc(html), 'img.xhtml'));
    const imgs = book.chapters[0].blocks.filter((b) => b.t === 'img');
    expect(imgs).toHaveLength(1);
    expect(book.assets.size).toBe(1);
    expect([...book.assets.values()][0].type).toBe('image/png');
  });
});

describe('Markdown import', () => {
  it('maps headings, quotes, rules, lists and strips inline markup', () => {
    const md = [
      '# 书名', '', '## 第一章 起', '', '这是**加粗**和*斜体*以及[链接](http://x.y)和`代码`。', '', '> 引用的话。', '', '---', '', '- 第一项', '- 第二项', '', '![图](a.png)', '', '1. 编号项',
    ].join('\n');
    const blocks = markdownToBlocks(md);
    expect(blocks).toEqual([
      { t: 'h', level: 1, text: '书名' },
      { t: 'h', level: 2, text: '第一章 起' },
      { t: 'p', text: '这是加粗和斜体以及链接和代码。' },
      { t: 'quote', text: '引用的话。' },
      { t: 'hr' },
      { t: 'p', text: '第一项' },
      { t: 'p', text: '第二项' },
      { t: 'p', text: '编号项' },
    ]);
  });

  it('builds chapters from ## headings with the # title as the book title', async () => {
    const md = `# 我的小说\n\n## 一\n\n${prose(100)}\n\n## 二\n\n${prose(100, 1)}\n\n## 三\n\n${prose(100, 2)}`;
    const book = await importFile(asFile(enc(md), 'novel.md'));
    expect(book.title).toBe('我的小说');
    expect(book.chapters.map((c) => c.title)).toEqual(['一', '二', '三']);
  });

  it('uses the chapter-heading rule for plain lines too', async () => {
    const md = `第一章 起\n\n${prose(100)}\n\n第二章 承\n\n${prose(100, 1)}`;
    const book = await importFile(asFile(enc(md), '小说.markdown'));
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章 起', '第二章 承']);
  });

  it('does not leak code fences', () => {
    const blocks = markdownToBlocks('```\n代码里的中文行\n```\n\n正文。');
    expect(blocks.map((b) => (b.t === 'p' ? b.text : ''))).toEqual(['代码里的中文行', '正文。']);
  });
});
