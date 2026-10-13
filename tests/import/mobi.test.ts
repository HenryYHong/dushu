// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCEPT, importFile } from '../../src/import';
import { chapterHan } from '../../src/import/chapters';
import { ImportError } from '../../src/import/errors';
import { looksLikeMobi } from '../../src/import/mobi';
import { palmdocDecompress, trailingSize } from '../../src/import/mobiText';
import type { Block, ImportedBook } from '../../src/types';
import { buildKf8, buildMobi, concat, palmdocCompress } from './mobiWriter';
import { asFile, PNG, prose } from './helpers';

const enc = (s: string) => new TextEncoder().encode(s);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const fx = (name: string) => new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'import', name)));

const textOf = (b: Block) => (b.t === 'p' || b.t === 'h' || b.t === 'quote' ? b.text : '');
const allText = (book: ImportedBook) => book.chapters.flatMap((c) => c.blocks.map(textOf)).join('\n');

/** Three chapters of MOBI 6 markup; returns the markup and the byte offset of each chapter heading. */
function mobi6Markup(): { html: string; offsets: number[]; titles: string[] } {
  const titles = ['第一章 清晨', '第二章 午后', '第三章 夜里'];
  let html = '<html><head><guide><reference type="toc" title="Table of Contents" filepos=0000000000 /></guide></head><body>';
  const offsets: number[] = [];
  titles.forEach((t, i) => {
    offsets.push(enc(html).length);
    html += `<h2>${t}</h2>`;
    if (i === 1) html += '<p><img recindex="00001" align="baseline"/></p>';
    for (let k = 0; k < 6; k++) html += `<p>${prose(120, i * 7 + k)}</p>`;
    html += '<mbp:pagebreak/>';
  });
  html += '</body></html>';
  return { html, offsets, titles };
}

describe('PalmDOC and trailing data', () => {
  it('round-trips through the test compressor', () => {
    const src = enc(`<p>${prose(600)}</p> aaa bbb abcabcabc \u0001\u0002 end`);
    expect(Array.from(palmdocDecompress(palmdocCompress(src)))).toEqual(Array.from(src));
  });

  it('reads every kind of token', () => {
    // literal, binary run of 2, space + letter, back reference of 4 bytes at distance 5
    const data = Uint8Array.from([0x61, 0x62, 0x63, 0x64, 0x65, 2, 0x01, 0x02, 0xc1, 0x80, (5 << 3) >> 0, 0x00]);
    const out = palmdocDecompress(data);
    expect(out.slice(0, 5)).toEqual(Uint8Array.from([0x61, 0x62, 0x63, 0x64, 0x65]));
    expect(Array.from(out.slice(5, 8))).toEqual([1, 2, 0x20]);
  });

  it('measures trailing entries and multibyte overlap', () => {
    const text = enc('正文abc');
    const entry = [0x11, 0x22, 0x80 | 3]; // two data bytes and its size
    const overlap = [0xe4, 0xb8, 2]; // two bytes and a size byte of 2: total 3
    // flags: bit 1 (one entry) + bit 0 (overlap): entries are last, overlap block just before them
    const rec = concat(text, overlap, entry);
    expect(trailingSize(rec, 0b11)).toBe(entry.length + overlap.length);
    expect(trailingSize(rec, 0)).toBe(0);
    expect(trailingSize(concat(text, entry), 0b10)).toBe(3);
    // a corrupt size is ignored instead of eating the text
    expect(trailingSize(concat(text, [0xff]), 0b10)).toBe(0);
  });
});

describe('MOBI 6', () => {
  it('reads metadata, contents list, pictures and the cover', async () => {
    const { html, offsets, titles } = mobi6Markup();
    const bytes = buildMobi(html, {
      title: '清晨的故事',
      author: '原著：金庸',
      images: [PNG, JPEG],
      coverOffset: 1,
      ncx: titles.map((title, i) => ({ pos: offsets[i], title })),
    });
    expect(looksLikeMobi(bytes)).toBe(true);
    const book = await importFile(asFile(bytes, 'story.mobi'));
    expect(book.format).toBe('mobi');
    expect(book.title).toBe('清晨的故事');
    expect(book.author).toBe('金庸');
    expect(book.script).toBe('simplified');
    expect(book.chapters.map((c) => c.title)).toEqual(titles);
    for (const c of book.chapters) expect(chapterHan(c), c.title).toBeGreaterThan(300);
    // the picture sits in chapter two
    const img = book.chapters[1].blocks.find((b) => b.t === 'img');
    expect(img).toBeTruthy();
    expect(book.chapters[0].blocks.some((b) => b.t === 'img')).toBe(false);
    // the cover is the second image record (EXTH 201 = 1)
    expect(book.cover).toBeTruthy();
    expect(book.assets.get(book.cover!)?.type).toBe('image/jpeg');
    expect(book.assets.get((img as { asset: string }).asset)?.type).toBe('image/png');
    expect(allText(book)).not.toMatch(/mbp|<|>/);
  });

  it.each(['none', 'palmdoc', 'huff'] as const)('decompresses %s text records', async (compression) => {
    const { html, offsets, titles } = mobi6Markup();
    const book = await importFile(asFile(buildMobi(html, { title: 'T', compression, images: [PNG], ncx: titles.map((title, i) => ({ pos: offsets[i], title })) }), 'a.mobi'));
    expect(book.chapters.map((c) => c.title)).toEqual(titles);
    expect(allText(book)).toContain(prose(120, 0));
    expect(allText(book)).toContain(prose(120, 7 * 2 + 5));
  });

  it.each([0b1, 0b10, 0b101, 0b1111, 0b100000011])('strips trailing data (extra flags %i)', async (extraFlags) => {
    const { html, offsets, titles } = mobi6Markup();
    const plain = await importFile(asFile(buildMobi(html, { ncx: titles.map((title, i) => ({ pos: offsets[i], title })) }), 'a.mobi'));
    const flagged = await importFile(asFile(buildMobi(html, { extraFlags, ncx: titles.map((title, i) => ({ pos: offsets[i], title })) }), 'a.mobi'));
    expect(allText(flagged)).toBe(allText(plain));
    expect(flagged.chapters.map((c) => c.title)).toEqual(titles);
  });

  it('finds chapters from headings when the book has no contents index', async () => {
    let html = '<html><body>';
    for (let i = 1; i <= 4; i++) html += `<p>第${i}章 标题${i}</p>` + '<p>' + prose(300, i) + '</p>';
    html += '</body></html>';
    const book = await importFile(asFile(buildMobi(html, { title: '无目录' }), 'x.mobi'));
    expect(book.chapters.map((c) => c.title)).toEqual(['第1章 标题1', '第2章 标题2', '第3章 标题3', '第4章 标题4']);
  });

  it('cuts a long book with no headings into parts', async () => {
    const html = '<html><body>' + Array.from({ length: 40 }, (_, i) => `<p>${prose(300, i)}</p>`).join('') + '</body></html>';
    const book = await importFile(asFile(buildMobi(html), 'x.mobi'));
    expect(book.chapters.length).toBeGreaterThan(2);
  });

  it('reads Chinese stored as UTF-8 in a file that declares Windows-1252', async () => {
    const html = `<html><body><h2>第一章 起</h2><p>${prose(200)}</p></body></html>`;
    const book = await importFile(asFile(buildMobi(html, { codepage: 1252, title: '旧式声明', author: '作者：余华' }), 'old.mobi'));
    expect(book.title).toBe('旧式声明');
    expect(book.author).toBe('余华');
    expect(allText(book)).toContain(prose(200));
  });

  it('reads GBK text in a file that declares Windows-1252', async () => {
    const gbk = fx('simplified.gb18030.txt');
    const lines: number[][] = [];
    let cur: number[] = [];
    for (const b of gbk) {
      if (b === 0x0a) {
        if (cur.length) lines.push(cur);
        cur = [];
      } else cur.push(b);
    }
    if (cur.length) lines.push(cur);
    const body = concat(enc('<html><body>'), ...lines.flatMap((l) => [enc('<p>'), Uint8Array.from(l), enc('</p>')]), enc('</body></html>'));
    const book = await importFile(asFile(buildMobi('', { codepage: 1252, textBytes: body, title: 'x' }), 'gbk.mobi'));
    const expected = readFileSync(join(__dirname, '..', 'fixtures', 'import', 'sample-simplified.txt'), 'utf8').replace(/\s+/g, '');
    expect(allText(book).replace(/\s+/g, '')).toContain(expected.slice(-60));
    expect(book.script).toBe('simplified');
  });

  it('reads an old PalmDOC text file with no MOBI header', async () => {
    const text = `书名：旧书\n\n第一章 起\n\n${prose(300)}\n\n第二章 承\n\n${prose(300, 3)}\n\n第三章 合\n\n${prose(300, 5)}`;
    const bytes = buildMobi('', { textBytes: enc(text), palmOnly: true, title: '旧书' });
    expect(looksLikeMobi(bytes)).toBe(true);
    const book = await importFile(asFile(bytes, 'old.prc'));
    expect(book.format).toBe('mobi');
    expect(book.title).toBe('旧书');
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章 起', '第二章 承', '第三章 合']);
  });

  it('puts a damaged contents index aside and still reads the book', async () => {
    const { html, titles } = mobi6Markup();
    const bytes = buildMobi(html, { ncx: titles.map((title, i) => ({ pos: 1e9 + i, title })) });
    const book = await importFile(asFile(bytes, 'a.mobi'));
    expect(allText(book)).toContain(prose(120, 0));
  });
});

describe('MOBI errors', () => {
  const { html } = mobi6Markup();

  it.each([1, 2])('explains DRM (encryption type %i)', async (encryption) => {
    const err = await importFile(asFile(buildMobi(html, { encryption }), 'locked.mobi')).catch((e) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err.message).toMatch(/protected by DRM/);
    expect(err.message).toMatch(/Kindle book/);
  });

  it('explains DRM in the KF8 half too', async () => {
    const { bytes } = buildKf8({ files: ['<p>x</p>'], encryption: 2 });
    await expect(importFile(asFile(bytes, 'locked.azw3'))).rejects.toThrow(/protected by DRM/);
  });

  it('rejects a file that only looks like one', async () => {
    const bytes = buildMobi(html);
    await expect(importFile(asFile(bytes.slice(0, 200), 'cut.mobi'))).rejects.toBeInstanceOf(ImportError);
    await expect(importFile(asFile(enc('hello'), 'nope.mobi'))).rejects.toThrow(/not a valid Kindle/);
    await expect(importFile(asFile(concat(enc('TPZ0'), new Array(100).fill(0)), 'topaz.azw'))).rejects.toThrow(/Topaz or KFX/);
  });

  it('rejects a book with no Chinese', async () => {
    const bytes = buildMobi('<html><body><p>' + 'Plain English only. '.repeat(40) + '</p></body></html>');
    await expect(importFile(asFile(bytes, 'en.mobi'))).rejects.toThrow(/No Chinese/);
  });

  it('is listed in the file picker', () => {
    expect(ACCEPT.split(',')).toEqual(expect.arrayContaining(['.mobi', '.azw3', '.azw']));
  });

  it('detects a Kindle book whatever its extension', async () => {
    const { html: h } = mobi6Markup();
    expect((await importFile(asFile(buildMobi(h), 'book.bin'))).format).toBe('mobi');
    expect((await importFile(asFile(buildMobi(h), 'book.prc'))).format).toBe('mobi');
  });
});

/** Body markup of a KF8 file with a heading, paragraphs and an optional picture. */
function kf8Body(n: number, withImage = false): { body: string; headingAt: number } {
  const head = `<h1 id="c${n}">第${n}章 标题${n}</h1>`;
  let body = '<p>前言一行。</p>'.repeat(0) + head;
  if (withImage) body += '<p><img src="kindle:embed:0002?mime=image/png" alt="图"/></p>';
  for (let k = 0; k < 5; k++) body += `<p>${prose(150, n * 5 + k)}第${n}章第${k}段。</p>`;
  return { body, headingAt: 0 };
}

describe('AZW3 (KF8)', () => {
  const files = [kf8Body(1), kf8Body(2, true), kf8Body(3)].map((f) => f.body);
  const toc = files.map((_, i) => ({ file: i, offset: 0, title: `第${i + 1}章 标题${i + 1}` }));

  it('puts skeletons and fragments back together and reads the contents list', async () => {
    const { bytes } = buildKf8({ title: '三章', author: '金庸', files, toc, fragsPerFile: 3, images: [JPEG, PNG], coverOffset: 0 });
    const book = await importFile(asFile(bytes, 'three.azw3'));
    expect(book.format).toBe('azw3');
    expect(book.title).toBe('三章');
    expect(book.author).toBe('金庸');
    expect(book.chapters.map((c) => c.title)).toEqual(['第1章 标题1', '第2章 标题2', '第3章 标题3']);
    expect(book.chapters[0].blocks[0]).toEqual({ t: 'h', level: 1, text: '第1章 标题1' });
    expect(allText(book)).toContain('第2章第4段。');
    // each fragment of the middle file is present exactly once
    for (let k = 0; k < 5; k++) expect(allText(book).split(`第2章第${k}段。`).length).toBe(2);
    const img = book.chapters[1].blocks.find((b) => b.t === 'img') as { asset: string } | undefined;
    expect(img).toBeTruthy();
    expect(book.assets.get(img!.asset)?.type).toBe('image/png');
    expect(book.assets.get(book.cover!)?.type).toBe('image/jpeg');
    expect(allText(book)).not.toMatch(/kindle:|aid=|<|>/);
  });

  it('cuts a chapter at a fragment boundary and in the middle of one', async () => {
    const body = Array.from({ length: 8 }, (_, i) => `<p id="p${i}">${i === 5 ? '第二部分开始。' : ''}${prose(100, i)}</p>`).join('');
    const mid = enc(body.slice(0, body.indexOf('<p id="p5">'))).length;
    const { bytes } = buildKf8({
      files: [body],
      fragsPerFile: 4,
      toc: [
        { file: 0, offset: 0, title: '开头' },
        { file: 0, offset: mid, title: '后半' },
      ],
    });
    const book = await importFile(asFile(bytes, 'two.azw3'));
    expect(book.chapters.map((c) => c.title)).toEqual(['开头', '后半']);
    expect(book.chapters[1].blocks[0]).toMatchObject({ t: 'p' });
    expect((book.chapters[1].blocks[0] as { text: string }).text.startsWith('第二部分开始')).toBe(true);
    expect(book.chapters[0].blocks.length).toBe(5);
  });

  it('reads the flow table and a cover wrapped in an SVG flow', async () => {
    const withCover = ['<div><img src="kindle:flow:0002?mime=image/svg+xml"/></div>' + '<p>' + prose(200) + '</p>'];
    const { bytes } = buildKf8({ files: withCover, extraFlows: true, images: [JPEG] });
    const book = await importFile(asFile(bytes, 'cover.azw3'));
    expect(book.chapters.length).toBeGreaterThan(0);
    const first = book.chapters[0].blocks.find((b) => b.t === 'img') as { asset: string } | undefined;
    expect(first && book.assets.get(first.asset)?.type).toBe('image/jpeg');
    expect(allText(book)).toContain(prose(200));
    expect(allText(book)).not.toMatch(/margin/); // the style sheet flow is not text
  });

  it('falls back to headings and files when there is no contents list', async () => {
    const { bytes } = buildKf8({ files });
    const book = await importFile(asFile(bytes, 'plain.azw3'));
    expect(book.chapters.map((c) => c.title)).toEqual(['第1章 标题1', '第2章 标题2', '第3章 标题3']);
  });

  it('uses the KF8 half of a combined file and ignores the old MOBI 6 half', async () => {
    const { bytes } = buildKf8({
      title: '合订本',
      files,
      toc,
      images: [PNG],
      joint: { markup: `<html><body><p>${'旧版本的内容。'.repeat(80)}</p></body></html>`, images: [JPEG] },
    });
    const asMobi = await importFile(asFile(bytes, 'both.mobi'));
    expect(asMobi.format).toBe('mobi');
    expect(asMobi.chapters.map((c) => c.title)).toEqual(['第1章 标题1', '第2章 标题2', '第3章 标题3']);
    expect(allText(asMobi)).not.toContain('旧版本');
    expect((await importFile(asFile(bytes, 'both.azw3'))).format).toBe('azw3');
  });
});

// A real Project Gutenberg book (public domain: 道德經), as the Kindle files its site serves. The MOBI 6 file
// has a contents index; the KF8 one has only plain chapter lines.
describe('real Kindle files (Project Gutenberg, public domain)', () => {
  it('reads the MOBI 6 file', async () => {
    const book = await importFile(asFile(fx('daodejing.gutenberg.mobi'), 'pg7337.mobi'));
    expect(book.format).toBe('mobi');
    expect(book.title).toBe('道德經');
    expect(book.script).toBe('traditional');
    const titles = book.chapters.map((c) => c.title);
    expect(titles).toContain('第一章');
    expect(titles).toContain('第八十一章');
    const first = book.chapters.find((c) => c.title === '第一章')!;
    expect(first.blocks.map(textOf).join('')).toContain('道可道，非常道。名可名，非常名。');
    expect(first.blocks.map(textOf).join('')).not.toMatch(/之 玄/); // a line wrap that became a space
    expect(book.cover).toBeTruthy();
  });

  it('reads the KF8 file', async () => {
    const book = await importFile(asFile(fx('daodejing.gutenberg.azw3'), 'pg7337.azw3'));
    expect(book.format).toBe('azw3');
    expect(book.title).toBe('道德經');
    const titles = book.chapters.map((c) => c.title);
    expect(titles).toContain('第一章');
    expect(titles).toContain('第八十一章');
    expect(book.chapters.length).toBeGreaterThanOrEqual(81);
    expect(book.cover).toBeTruthy();
  });

  it('gives the same chapters from both files', async () => {
    const a = await importFile(asFile(fx('daodejing.gutenberg.mobi'), 'a.mobi'));
    const b = await importFile(asFile(fx('daodejing.gutenberg.azw3'), 'b.azw3'));
    const body = (book: ImportedBook, title: string) =>
      book.chapters
        .find((c) => c.title === title)!
        .blocks.map(textOf)
        .filter((t) => t !== title)
        .join('');
    expect(body(a, '第五十一章')).toBe(body(b, '第五十一章'));
  });
});
