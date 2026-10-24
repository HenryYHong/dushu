// @vitest-environment jsdom
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ACCEPT, ImportError, importFile, importText, PASTED_TITLE } from '../../src/import';
import { CONTAINER, asFile, makeEpub, opf, prose, xhtml } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);
const epubBytes = () =>
  makeEpub({
    'META-INF/container.xml': CONTAINER('content.opf'),
    'content.opf': opf({ title: '甲', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
    'a.xhtml': xhtml(`<p>${prose(60)}</p>`),
  });

describe('importFile dispatch', () => {
  it('uses magic bytes over the extension', async () => {
    expect((await importFile(asFile(epubBytes(), 'book.dat'))).format).toBe('epub');
    expect((await importFile(asFile(epubBytes(), 'book.txt'))).format).toBe('epub');
    expect((await importFile(asFile(epubBytes(), 'BOOK.EPUB'))).format).toBe('epub');
  });

  it('reads .txt and .text as TXT', async () => {
    for (const name of ['a.txt', 'a.TEXT']) expect((await importFile(asFile(enc(prose(80)), name))).format).toBe('txt');
  });

  it('sniffs text with an unknown or missing extension', async () => {
    expect((await importFile(asFile(enc(prose(80)), 'notes'))).format).toBe('txt');
    expect((await importFile(asFile(enc(`<html><body><p>${prose(80)}</p></body></html>`), 'page'))).format).toBe('html');
  });

  it('explains unsupported formats', async () => {
    await expect(importFile(asFile(enc('x'), 'book.mobi'))).rejects.toThrow(/not a valid Kindle/);
    await expect(importFile(asFile(enc('x'), 'book.azw3'))).rejects.toThrow(/Kindle/);
    await expect(importFile(asFile(enc('x'), 'book.kfx'))).rejects.toThrow(/KFX/);
    await expect(importFile(asFile(enc('x'), 'scan.djvu'))).rejects.toThrow(/DjVu/);
    const docx = zipSync({ 'word/document.xml': strToU8('<w:document/>') });
    await expect(importFile(asFile(docx, 'essay.docx'))).rejects.toThrow(/Word documents/);
    await expect(importFile(asFile(docx, 'essay.bin'))).rejects.toThrow(/Word documents/);
    await expect(importFile(asFile(enc('x'), 'pic.png'))).rejects.toThrow(/not supported/);
    await expect(importFile(asFile(enc('x'), 'x.epub'))).rejects.toBeInstanceOf(ImportError);
  });

  it('rejects empty files and files with no Chinese', async () => {
    await expect(importFile(asFile(new Uint8Array(), 'a.txt'))).rejects.toThrow(/empty/);
    await expect(importFile(asFile(enc('Plain English text only. '.repeat(50)), 'a.txt'))).rejects.toThrow(/No Chinese text/);
  });

  it('accepts a book that is mostly English but has real Chinese content', async () => {
    const book = await importFile(asFile(enc('Chapter notes\n' + prose(600)), 'mixed.txt'));
    expect(book.chapters.length).toBeGreaterThan(0);
  });

  it('reports progress from 0 to 1 without going backwards', async () => {
    const seen: number[] = [];
    await importFile(asFile(epubBytes(), 'a.epub'), { onProgress: (f) => seen.push(f) });
    expect(seen[0]).toBe(0);
    expect(seen[seen.length - 1]).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('sets sourceName and script', async () => {
    const simplified = await importFile(asFile(enc('这个国家的学习与发展。'.repeat(20)), '简.txt'));
    expect(simplified.sourceName).toBe('简.txt');
    expect(simplified.script).toBe('simplified');
    const traditional = await importFile(asFile(enc('這個國家的學習與發展。'.repeat(20)), '繁.txt'));
    expect(traditional.script).toBe('traditional');
  });

  it('lists the formats it accepts', () => {
    expect(ACCEPT.split(',')).toEqual(expect.arrayContaining(['.epub', '.txt', '.pdf', '.html', '.md']));
  });
});

describe('importText', () => {
  it('returns a paste book with the given title and author', () => {
    const book = importText(prose(100), '标题', '作者');
    expect(book).toMatchObject({ title: '标题', author: '作者', format: 'paste' });
    expect(book.assets.size).toBe(0);
  });

  it('calls text with no title of its own "Pasted text", as the card said while it was added', () => {
    expect(importText(prose(100)).title).toBe('Pasted text');
    expect(importText(prose(100), '  ', '').title).toBe(PASTED_TITLE);
    expect(importText(prose(100)).chapters[0].title).toBe('Pasted text');
    // A short first line that reads as a title still wins.
    expect(importText(`春天的故事\n${prose(100)}`).title).toBe('春天的故事');
  });
});
