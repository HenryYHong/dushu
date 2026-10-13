// @vitest-environment jsdom
// Smoke test against a real book on this machine (~/Downloads/活着.epub). Skipped when it is not there.
// The book is read in place and never copied into the repo.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { chapterHan, totalHan } from '../../src/import/chapters';

const path = join(homedir(), 'Downloads', '活着.epub');

describe.skipIf(!existsSync(path))('活着.epub (real book)', () => {
  it('imports with sensible metadata, chapters and text', async () => {
    const book = await importFile(new File([readFileSync(path)], '活着.epub'));
    const summary = book.chapters.map((c) => `${c.title} (${c.blocks.length} blocks, ${chapterHan(c)} Han)`);
    console.log(`${book.title} / ${book.author} / ${totalHan(book.chapters)} Han / script ${book.script}\n${summary.join('\n')}`);

    expect(book.title).toBe('活着');
    expect(book.author).toContain('余华');
    expect(book.author).not.toMatch(/epubw/i);
    expect(book.format).toBe('epub');
    expect(book.script).toBe('simplified');

    // prefaces, then 第一章 to 第三章 (the long second one is cut into pieces)
    const titles = book.chapters.map((c) => c.title);
    expect(titles.slice(0, 5)).toEqual(['中文版自序', '日文版自序', '韩文版自序', '英文版自序', '麦田新版自序']);
    expect(titles).toContain('第一章');
    expect(titles.some((t) => t.startsWith('第二章'))).toBe(true);
    expect(titles[titles.length - 1]).toBe('第三章');
    expect(book.chapters.length).toBeGreaterThanOrEqual(8);

    const han = totalHan(book.chapters);
    expect(han).toBeGreaterThan(70000);
    expect(han).toBeLessThan(100000);

    for (const c of book.chapters) {
      expect(c.blocks.length, c.title).toBeGreaterThan(0);
      expect(c.blocks.some((b) => b.t === 'p'), c.title).toBe(true);
      expect(chapterHan(c), c.title).toBeLessThan(30000);
    }

    const text = book.chapters.flatMap((c) => c.blocks.map((b) => (b.t === 'p' || b.t === 'h' || b.t === 'quote' ? b.text : ''))).join('\n');
    expect(text).not.toMatch(/epubw/i);
    expect(text).not.toMatch(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/); // no pinyin leaking in
    expect(text).not.toMatch(/(^|\n)[\s\u3000]/); // paragraphs start clean
    expect(text).not.toMatch(/<[a-z]+[ >]/i); // no markup

    expect(book.cover).toBe('cover.jpg');
    expect(book.assets.get('cover.jpg')?.type).toBe('image/jpeg');
    for (const c of book.chapters) for (const b of c.blocks) if (b.t === 'img') expect(book.assets.has(b.asset)).toBe(true);
  });
});

const shediao = join(homedir(), 'Downloads', '射雕英雄传.epub');

describe.skipIf(!existsSync(shediao))('射雕英雄传.epub (real book)', () => {
  it('imports with the bare author name, 40 numbered chapters and no front-matter page', async () => {
    const book = await importFile(new File([readFileSync(shediao)], '射雕英雄传.epub'));
    expect(book.title).toBe('射雕英雄传');
    expect(book.author).toBe('金庸'); // the file says "原著：金庸"
    expect(book.format).toBe('epub');
    expect(book.script).toBe('simplified');
    expect(book.cover).toBe('cover.jpeg');

    const titles = book.chapters.map((c) => c.title);
    // the title page (title and author only) is not a chapter
    expect(titles[0]).toBe('第1回 风雪惊变');
    const numbered = titles.slice(0, 40);
    numbered.forEach((t, i) => expect(t, `chapter ${i + 1}`).toMatch(new RegExp(`^第${i + 1}回 \\S+$`)));
    expect(titles.slice(0, 3)).toEqual(['第1回 风雪惊变', '第2回 江南七怪', '第3回 大漠风沙']);
    expect(titles[39]).toBe('第40回 华山论剑');
    expect(titles.slice(40)).toEqual(['成吉思汗家族', '关于“全真教”', '后记']);

    for (const c of book.chapters) {
      expect(c.blocks.length, c.title).toBeGreaterThan(5);
      expect(chapterHan(c), c.title).toBeGreaterThan(2000);
      expect(chapterHan(c), c.title).toBeLessThan(30000);
    }
    // each numbered chapter opens with its own heading, spelled like its contents entry
    for (let i = 0; i < 40; i++) expect(book.chapters[i].blocks[0]).toMatchObject({ t: 'h', text: titles[i] });

    const han = totalHan(book.chapters);
    expect(han).toBeGreaterThan(700000);
    expect(han).toBeLessThan(900000);

    const text = book.chapters.flatMap((c) => c.blocks.map((b) => (b.t === 'p' || b.t === 'h' || b.t === 'quote' ? b.text : ''))).join('\n');
    expect(text).not.toMatch(/[<>]|&[a-z]+;|calibre|class=|原著：/);
    expect(text).not.toMatch(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/);
    expect(text).not.toMatch(/(^|\n)[\s　]/);
    expect(text).toContain('钱塘江浩浩江水');
  });

  it('keeps going after the lookups it needs: 活着 still has its 11 chapters', async () => {
    const huozhe = join(homedir(), 'Downloads', '活着.epub');
    if (!existsSync(huozhe)) return;
    const book = await importFile(new File([readFileSync(huozhe)], '活着.epub'));
    expect(book.chapters.length).toBe(11);
  });
});
