// @vitest-environment jsdom
// The import suite: 79 kinds of file a reader may bring (encodings, heading styles, hard wraps, download-site junk, EPUBs
// as converters and stores make them, Kindle files, PDFs as a Mac prints them, DRM), each built here from public-domain
// text (suite/sources.ts reads public/samples) and checked against the text it must give. Kinds marked `gap` still miss
// something (named there, plan item 9); what they do give is checked.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { importFile } from '../../src/import';
import { decodeText } from '../../src/import/encoding';
import { problems, type Expect } from './suite/check';
import { buildKf8, buildMobi } from './mobiWriter';
import {
  HANS, HANS_AUTHOR, HANS_NAMES, HANS_TITLE, HANT, NUMERALS, contentOf, flat, hongloumeng, sampleBytes, sampleLines, wrap, type Section,
} from './suite/sources';
import { concatBytes, encodable, encodeLegacy, encodeUtf16, utf8 } from './suite/encode';
import {
  PNG, bodyLines, chapterEpub, epub, esc, macPdf, nav, ncx, noise, packageDoc, page, paras, textBook, typeset, verticalPdf, type Item,
} from './suite/build';
import { makeUnicodePdf } from './suite/pdf';

// PDFs go through importFile with pdf.js's Node build and CMaps read from disk.
vi.mock('../../src/import/pdf', async (orig) => {
  const real = await orig<typeof import('../../src/import/pdf')>();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { NodeCMapReaderFactory } = await import('./pdfhelpers');
  return { ...real, importPdf: (b: Uint8Array, n: string, p?: (f: number) => void) => real.importPdf(b, n, p, { pdfjs: pdfjs as never, cMapReaderFactory: NodeCMapReaderFactory }) };
});

interface Case {
  file: string;
  /** The name the file is added under. */
  upload: string;
  make: () => Uint8Array;
  expect: Expect;
  /** What this kind does not do yet (it is not checked). */
  gap?: string;
}

const T = HANS_TITLE;
const A = HANS_AUTHOR;
const titles = (secs: Section[]) => secs.map(([t]) => t.replace(/[\s　]+/g, ' '));
/** The usual expectation for a book made from `secs`. */
const book = (secs: Section[], script: 'simplified' | 'traditional', more: Expect = {}, title = T, author = A): Expect => ({
  title, author, script, chapters: titles(secs), content: contentOf(secs), paras: flat(secs), ...more,
});
/** Sections with every paragraph that has no code in `label` left out. */
const encodableIn = (secs: Section[], label: 'gbk' | 'big5'): Section[] => secs.map(([t, ps]) => [t, ps.filter((p) => encodable(p, label))]);
const keep = (secs: Section[], n: number): Section[] => secs.map(([t, ps]) => [t, ps.slice(0, n)]);

const HANT_TITLE = '紅樓夢';
const HANT_AUTHOR = '曹雪芹';
const hantBook = (lines: string[]) => textBook(lines, HANT_TITLE, `作者：${HANT_AUTHOR}`);
const tradBook = (secs: Section[], more: Expect = {}) => book(secs, 'traditional', more, HANT_TITLE, HANT_AUTHOR);

const GBK_HANS = encodableIn(HANS, 'gbk');
const BIG5_HANT = encodableIn(HANT, 'big5');
const GBK_HANT = encodableIn(HANT, 'gbk');
/** A sentence with Hong Kong characters (Big5-HKSCS, not plain Big5), written for this test. */
const HKSCS_LINE = '他旣不知道這是甚麽，卽使眞的看着也不明白。';
const HKSCS_HANT: Section[] = [[BIG5_HANT[0][0], [...BIG5_HANT[0][1].slice(0, 3), HKSCS_LINE, ...BIG5_HANT[0][1].slice(3)]], ...BIG5_HANT.slice(1)];
/** A sentence with a character GB18030 writes in four bytes (𬬻, U+2CB3B), written for this test. */
const FOUR_BYTE_LINE = '案头搁一只铜𬬻，积灰甚厚。';
const GB18030_HANS: Section[] = [[GBK_HANS[0][0], [FOUR_BYTE_LINE, ...GBK_HANS[0][1]]], ...GBK_HANS.slice(1)];

/** The last paragraph without its last character: a file cut off in the middle of it. */
function cutLast(secs: Section[]): Section[] {
  const out = secs.map(([t, ps]) => [t, ps.slice()] as Section);
  const last = out[out.length - 1][1];
  last[last.length - 1] = [...last[last.length - 1]].slice(0, -1).join('');
  return out;
}

/** Heading lines in each style a text file may use (the line, and the chapter title it gives), for the piece's own name. */
const headingStyles: Record<string, { line: (i: number, n: string) => string; shown: (i: number, n: string) => string }> = {
  arabic: { line: (i, n) => `第${i + 1}章 ${n}`, shown: (i, n) => `第${i + 1}章 ${n}` },
  fullwidth: { line: (i, n) => `第${String.fromCharCode(0xff11 + i)}章　${n}`, shown: (i, n) => `第${i + 1}章 ${n}` },
  colon: { line: (i, n) => `第${NUMERALS[i]}章：${n}`, shown: (i, n) => `第${NUMERALS[i]}章 ${n}` },
  bracket: { line: (i, n) => `【第${NUMERALS[i]}章】${n}`, shown: (i, n) => `【第${NUMERALS[i]}章】${n}` },
  zhengwen: { line: (i, n) => `正文 第${NUMERALS[i]}章 ${n}`, shown: (i, n) => `第${NUMERALS[i]}章 ${n}` },
  dun: { line: (i, n) => `${NUMERALS[i]}、${n}`, shown: (i, n) => `${NUMERALS[i]}、${n}` },
  dot: { line: (i, n) => `${i + 1}. ${n}`, shown: (i, n) => `${i + 1}. ${n}` },
  english: { line: (i, n) => `Chapter ${i + 1} ${n}`, shown: (i, n) => `Chapter ${i + 1} ${n}` },
  markdown: { line: (i, n) => `## 第${NUMERALS[i]}章 ${n}`, shown: (i, n) => `第${NUMERALS[i]}章 ${n}` },
  centered: { line: (i, n) => `${'　'.repeat(12)}第${NUMERALS[i]}章　${n}`, shown: (i, n) => `第${NUMERALS[i]}章 ${n}` },
};
/** The style's heading for section i of HANS. */
const styled = (f: (i: number, n: string) => string) => (i: number) => f(i, HANS_NAMES[i]);
/** HANS with each piece titled by its own name only (an anthology's titles). */
const NAMED: Section[] = HANS.map(([, ps], i) => [HANS_NAMES[i], ps]);

/** The pirate-site file: banners, a URL after a line of the story, a phone-site line, nav bars, calls for votes. */
function pirate(secs: Section[]): string {
  const out = ['书名：' + T, '作者：' + A, '本书由「书香小筑」整理，仅供交流学习，请于下载后24小时内删除。', '更多精彩好书，请访问：www.shuxiangxz.com', '==================================', ''];
  secs.forEach(([t, ps]) => {
    out.push('', t, '-----------------------');
    ps.forEach((p, j) => {
      out.push('　　' + p + (j === 2 ? '（更多精彩请访问 www.shuxiangxz.com）' : j === 4 ? '求月票！求推荐！' : ''));
      if (j === 5) out.push('手机用户请访问 m.shuxiangxz.com 阅读最新章节');
    });
    out.push('（本章完）', '上一章 | 目录 | 下一章', '笔趣阁 www.biquge.la 最快更新最新章节！', '求月票！求推荐！求收藏！');
  });
  out.push('', '==================================', '全文完', '本书由「书香小筑」整理', '更多免费txt电子书下载请到 www.shuxiangxz.com');
  return out.join('\r\n') + '\r\n';
}

const kindle = (name: string) => new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'import', name)));
/** A Kindle file with the store's DRM flag set (encryption type 2 in the MOBI header). */
function withDrm(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const rec0 = new DataView(out.buffer).getUint32(78);
  new DataView(out.buffer).setUint16(rec0 + 12, 2);
  return out;
}
const DAODEJING_CHAPTERS = Array.from({ length: 81 }, (_, i) => `第${chineseNumber(i + 1)}章`);
function chineseNumber(n: number): string {
  const d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return d[n];
  if (n < 20) return '十' + d[n - 10];
  return d[Math.floor(n / 10)] + '十' + d[n % 10];
}

function drmEpub(alg: string, extra: Record<string, string>): Uint8Array {
  const files: Record<string, string | Uint8Array> = { ...extra };
  const items: Item[] = [];
  let refs = '';
  for (let i = 0; i < 3; i++) {
    const id = `ch0${i + 1}.xhtml`;
    files[`OEBPS/${id}`] = noise(3000, i + 1);
    items.push([id, id, 'application/xhtml+xml']);
    refs += `<enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/><enc:CipherData><enc:CipherReference URI="OEBPS/${id}"/></enc:CipherData></enc:EncryptedData>`;
  }
  files['META-INF/encryption.xml'] = `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">${refs}</encryption>`;
  files['OEBPS/content.opf'] = packageDoc({ title: '某書', creators: ['<dc:creator>某人</dc:creator>'], items, spine: items.map(([id]) => id) });
  return epub(files);
}

const TANG = sampleLines('tang-poems.txt');
const POEM_TITLE = /^[㐀-鿿]{1,12}[　 ]+[㐀-鿿]{2,4}$/u;
const tangPoems = (): Section[] => {
  const out: Section[] = [];
  for (const l of TANG.rest) {
    if (POEM_TITLE.test(l)) out.push([l, []]);
    else out[out.length - 1][1].push(l);
  }
  return out;
};

const CASES: Case[] = [
  // ------------------------------------------------------------------------------------------------------------- DRM ---
  { file: 'drm-daodejing.azw3', upload: '道德經.azw3', make: () => withDrm(kindle('daodejing.gutenberg.azw3')), expect: { error: /protected by DRM/ } },
  { file: 'drm-daodejing.mobi', upload: '道德經.azw', make: () => withDrm(kindle('daodejing.gutenberg.mobi')), expect: { error: /protected by DRM/ } },
  { file: 'epub-drm-adobe-adept.epub', upload: '某書.epub', make: () => drmEpub('http://www.w3.org/2001/04/xmlenc#aes128-cbc', { 'META-INF/rights.xml': '<?xml version="1.0"?><adept:rights xmlns:adept="http://ns.adobe.com/adept"/>' }), expect: { error: /EPUB is protected by DRM/ } },
  { file: 'epub-drm-readium-lcp.epub', upload: '某書.epub', make: () => drmEpub('http://www.w3.org/2001/04/xmlenc#aes256-cbc', { 'META-INF/license.lcpl': '{"id":"x","encryption":{"profile":"http://readium.org/lcp/basic-profile"}}' }), expect: { error: /EPUB is protected by DRM/ } },
  {
    file: 'epub-encrypted-no-encryption-xml.epub', upload: '某書.epub',
    // A store's book with its encryption.xml stripped: the chapter files are still ciphertext.
    make: () => {
      const items: Item[] = [0, 1, 2].map((i) => [`ch0${i + 1}.xhtml`, `ch0${i + 1}.xhtml`, 'application/xhtml+xml']);
      const files: Record<string, string | Uint8Array> = Object.fromEntries(items.map(([id], i) => [`OEBPS/${id}`, noise(3000, 7 + i)]));
      files['OEBPS/content.opf'] = packageDoc({ title: '某書', creators: ['<dc:creator>某人</dc:creator>'], items, spine: items.map(([id]) => id) });
      return epub(files);
    },
    expect: { error: /EPUB is protected by DRM/ },
  },
  { file: 'kfx-book.azw', upload: '某書.azw', make: () => concatBytes(Uint8Array.of(0xea), utf8('DRMION'), Uint8Array.of(0xee), new Uint8Array(500).fill(7)), expect: { error: /Topaz or KFX/ } },
  { file: 'topaz-book.azw1', upload: '某書.azw1', make: () => concatBytes(utf8('TPZ0'), new Uint8Array(500).fill(7)), expect: { error: /Topaz or KFX/ } },

  // ------------------------------------------------------------------------------------------------------------ EPUB ---
  {
    file: 'epub2-converted-one-file-p-headings.epub', upload: `${T}.epub`,
    // A TXT-to-EPUB converter's book: one file, headings as <p class="title">, one NCX entry ("正文"), a site tag in the title.
    make: () => {
      const body = HANS.map(([t, ps]) => `<p class="title">${esc(t)}</p>${paras(ps, '　　')}`).join('');
      return epub({
        'OEBPS/Text/chapter.xhtml': page(body, '正文', { epub3: false }),
        'OEBPS/toc.ncx': ncx([['正文', 'Text/chapter.xhtml']], T),
        'OEBPS/content.opf': packageDoc({ title: `${T}(www.xxbook.com)`, creators: [`<dc:creator>${A} 著</dc:creator>`], items: [['ncx', 'toc.ncx', 'application/x-dtbncx+xml'], ['c', 'Text/chapter.xhtml', 'application/xhtml+xml']], spine: ['c'], version: '2.0', toc: 'ncx' }),
      });
    },
    expect: book(HANS, 'simplified'),
  },
  {
    file: 'epub2-gbk-xhtml.epub', upload: `${T}.epub`,
    make: () => chapterEpub(GBK_HANS, { title: T, author: A, v2: true, encoding: 'gbk', ext: 'html', encode: (s) => encodeLegacy(s, 'gbk') }),
    expect: book(GBK_HANS, 'simplified'),
  },
  {
    file: 'epub2-hardwrap-br.epub', upload: `${T}.epub`,
    // Each chapter one <p>: printed lines of 30 characters joined by <br/>, each paragraph starting with 　　.
    make: () => chapterEpub(HANS, { title: T, author: A, v2: true, body: (t, ps) => `<h2>${esc(t)}</h2><p>${ps.flatMap((p) => wrap('　　' + p, 30)).map(esc).join('<br/>')}</p>` }),
    expect: book(HANS, 'simplified'),
  },
  {
    file: 'epub2-sigil-ncx-nested.epub', upload: `${T} - ${A}.epub`,
    // Sigil's layout: Text/ and Images/, an SVG cover page, an introduction, NCX parts over chapters, 　　 indents.
    make: () => {
      const intro = `《${HANS[0][0]}》等七篇，均为白话散文。`;
      const files: Record<string, string | Uint8Array> = {
        'OEBPS/Images/cover.png': PNG,
        'OEBPS/Text/cover.xhtml': page('<div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><image width="1" height="1" xlink:href="../Images/cover.png"/></svg></div>', 'Cover', { epub3: false }),
        'OEBPS/Text/intro.xhtml': page(`<h3>内容简介</h3><p>　　${esc(intro)}</p>`, '内容简介', { epub3: false }),
      };
      const items: Item[] = [['ncx', 'toc.ncx', 'application/x-dtbncx+xml'], ['cover-img', 'Images/cover.png', 'image/png'], ['cover.xhtml', 'Text/cover.xhtml', 'application/xhtml+xml'], ['intro.xhtml', 'Text/intro.xhtml', 'application/xhtml+xml']];
      const spine = ['cover.xhtml', 'intro.xhtml'];
      const parts: [string, string, [string, string][]][] = [];
      HANS.forEach(([t, ps], i) => {
        const id = `Section${String(i + 1).padStart(4, '0')}.xhtml`;
        files[`OEBPS/Text/${id}`] = page(`<div class="chapter"><h3 class="chapter-title">${esc(t)}</h3>${paras(ps, '　　')}</div>`, t, { epub3: false });
        items.push([id, `Text/${id}`, 'application/xhtml+xml']);
        spine.push(id);
        const part = i < 3 ? '第一部' : '第二部';
        if (!parts.length || parts[parts.length - 1][0] !== part) parts.push([part, `Text/${id}`, []]);
        parts[parts.length - 1][2].push([t, `Text/${id}`]);
      });
      files['OEBPS/toc.ncx'] = ncx([['内容简介', 'Text/intro.xhtml'], ...parts.map(([p, src, kids]) => [p, src, kids] as [string, string, [string, string][]])], T);
      files['OEBPS/content.opf'] = packageDoc({ title: T, creators: [`<dc:creator opf:role="aut">${A}</dc:creator>`, '<dc:publisher>www.epubw.com</dc:publisher>'], items, spine, version: '2.0', toc: 'ncx', meta: '<meta name="cover" content="cover-img"/>', guide: '<reference type="cover" title="Cover" href="Text/cover.xhtml"/>' });
      return epub(files);
    },
    expect: book(HANS, 'simplified', {
      chapters: ['内容简介', ...titles(HANS)],
      content: ['内容简介', `《${HANS[0][0]}》等七篇，均为白话散文。`, ...contentOf(HANS)],
      imgs: 0, cover: true,
    }),
  },
  {
    file: 'epub3-big5-xhtml.epub', upload: `${HANT_TITLE}.epub`,
    make: () => chapterEpub(BIG5_HANT, { title: HANT_TITLE, author: HANT_AUTHOR, encoding: 'big5', lang: 'zh-Hant', encode: (s) => encodeLegacy(s, 'big5') }),
    expect: tradBook(BIG5_HANT),
  },
  {
    file: 'epub3-br-paragraphs.epub', upload: `${T}.epub`,
    make: () => chapterEpub(HANS, { title: T, author: A, body: (t, ps) => `<h2>${esc(t)}</h2><p>${ps.map(esc).join('<br/>')}</p>` }),
    expect: book(HANS, 'simplified'),
  },
  {
    file: 'epub3-hardwrap-p-per-line.epub', upload: `${T}.epub`,
    // Typed in from print: one <p> per printed line (33 characters), a blank <p> between paragraphs.
    make: () => chapterEpub(HANS, { title: T, author: A, body: (t, ps) => `<h2>${esc(t)}</h2>` + ps.map((p) => wrap(p, 33).map((l) => `<p>${esc(l)}</p>`).join('') + '<p>&#160;</p>').join('') }),
    expect: book(HANS, 'simplified'),
  },
  {
    file: 'epub3-stories.epub', upload: `${T}.epub`,
    // An anthology: one file per story, titled without 第, the contents a volume over the stories.
    make: () => {
      const files: Record<string, string | Uint8Array> = {};
      const items: Item[] = [];
      const kids: [string, string][] = [];
      NAMED.forEach(([t, ps], i) => {
        const id = `story${String(i + 1).padStart(3, '0')}.xhtml`;
        files[`OEBPS/${id}`] = page(`<h2>${esc(t)}</h2>${paras(ps)}`, t);
        items.push([id, id, 'application/xhtml+xml']);
        kids.push([t, id]);
      });
      files['OEBPS/nav.xhtml'] = nav([['卷一', kids[0][1], kids]]);
      items.push(['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav']);
      files['OEBPS/content.opf'] = packageDoc({ title: T, creators: [`<dc:creator>[现代]${A}</dc:creator>`], items, spine: items.filter(([id]) => id !== 'nav').map(([id]) => id) });
      return epub(files);
    },
    expect: book(NAMED, 'simplified'),
  },
  {
    file: 'epub3-multi-nested-vertical-ruby-img.epub', upload: `${HANT_TITLE}.epub`,
    // EPUB 3: parts over chapters in the nav, vertical writing, ruby with <rt>/<rp>, a PNG and an SVG-wrapped picture, an
    // obfuscated font (not DRM). A part page holding only its title is folded into the next chapter.
    make: () => {
      const files: Record<string, string | Uint8Array> = {
        'OEBPS/style.css': 'html{writing-mode:vertical-rl}p{text-indent:2em}',
        'OEBPS/images/cover.png': PNG, 'OEBPS/images/ill1.png': PNG, 'OEBPS/images/ill2.png': PNG,
        'OEBPS/fonts/kai.ttf': noise(4000, 99),
        'OEBPS/cover.xhtml': page('<div class="cover"><img src="images/cover.png" alt="封面"/></div>', '封面', { css: 'style.css', lang: 'zh-TW' }),
      };
      const items: Item[] = [['cover-img', 'images/cover.png', 'image/png', 'cover-image'], ['ill1', 'images/ill1.png', 'image/png'], ['ill2', 'images/ill2.png', 'image/png'], ['css', 'style.css', 'text/css'], ['font', 'fonts/kai.ttf', 'font/ttf'], ['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'], ['cover', 'cover.xhtml', 'application/xhtml+xml']];
      const spine = ['cover', 'nav'];
      const points: [string, string, [string, string][]][] = [];
      for (const [part, from, to] of [['上卷', 0, 2], ['下卷', 2, 4]] as const) {
        const pid = part === '上卷' ? 'part1' : 'part2';
        files[`OEBPS/${pid}.xhtml`] = page(`<h1 class="part">${part}</h1>`, part, { css: 'style.css', lang: 'zh-TW' });
        items.push([pid, `${pid}.xhtml`, 'application/xhtml+xml']);
        spine.push(pid);
        const kids: [string, string][] = [];
        for (let i: number = from; i < to; i++) {
          const [t, ps] = HANT[i];
          let body = `<h2 id="c${i + 1}">${esc(t)}</h2>`;
          ps.forEach((p, j) => {
            let q = esc(p);
            if (i === 0 && j === 0) q = q.replace('此', '<ruby>此<rp>（</rp><rt>cǐ</rt><rp>）</rp></ruby>');
            body += `<p>${q}</p>`;
            if (i === 1 && j === 3) body += '<div class="illus"><img src="images/ill1.png" alt="插圖"/></div>';
            if (i === 2 && j === 2) body += '<div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><image width="1" height="1" xlink:href="images/ill2.png"/></svg></div>';
          });
          const id = `ch0${i + 1}`;
          files[`OEBPS/${id}.xhtml`] = page(body, t, { css: 'style.css', lang: 'zh-TW' });
          items.push([id, `${id}.xhtml`, 'application/xhtml+xml', i === 2 ? 'svg' : undefined]);
          spine.push(id);
          kids.push([t, `${id}.xhtml`]);
        }
        points.push([part, `${pid}.xhtml`, kids]);
      }
      files['OEBPS/nav.xhtml'] = nav(points);
      files['OEBPS/content.opf'] = packageDoc({ title: HANT_TITLE, creators: [`<dc:creator id="cre">${HANT_AUTHOR}</dc:creator><meta refines="#cre" property="role" scheme="marc:relators">aut</meta>`, '<dc:contributor>紀念委員會</dc:contributor>'], items, spine, ppd: 'rtl', lang: 'zh-TW', meta: '<meta name="primary-writing-mode" content="vertical-rl"/>' });
      files['META-INF/encryption.xml'] = '<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/fonts/kai.ttf"/></enc:CipherData></enc:EncryptedData></encryption>';
      return epub(files);
    },
    expect: tradBook(HANT, { content: ['上卷', ...contentOf(HANT.slice(0, 2)), '下卷', ...contentOf(HANT.slice(2))], imgs: 2, cover: true }),
    gap: 'the parts (上卷, 下卷) are not chapters of their own: a part page with only its title is folded into the next chapter',
  },
  {
    file: 'epub3-one-file-anchors.epub', upload: 'book.epub',
    make: () => {
      const body = HANT.map(([t, ps], i) => `<h2 id="ch${i + 1}">${esc(t)}</h2>${paras(ps)}`).join('');
      return epub({
        'OEBPS/text.xhtml': page(body, HANT_TITLE),
        'OEBPS/nav.xhtml': nav(HANT.map(([t], i) => [t, `text.xhtml#ch${i + 1}`])),
        'OEBPS/content.opf': packageDoc({ title: HANT_TITLE, creators: [`<dc:creator>${HANT_AUTHOR}</dc:creator>`], items: [['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'], ['text', 'text.xhtml', 'application/xhtml+xml']], spine: ['text'] }),
      });
    },
    expect: tradBook(HANT),
  },
  {
    file: 'epub3-poetry.epub', upload: '唐詩八首.epub',
    make: () => {
      const body = `<h1>${TANG.title}</h1>` + tangPoems().map(([t, vs]) => `<h3>${esc(t)}</h3><div class="poem">${vs.map((v) => `<p class="verse">${esc(v)}</p>`).join('')}</div>`).join('');
      return epub({
        'OEBPS/poems.xhtml': page(body, TANG.title),
        'OEBPS/nav.xhtml': nav([[TANG.title, 'poems.xhtml']]),
        'OEBPS/content.opf': packageDoc({ title: TANG.title, items: [['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'], ['p', 'poems.xhtml', 'application/xhtml+xml']], spine: ['p'] }),
      });
    },
    expect: { title: TANG.title, author: '', script: 'traditional', content: [TANG.title, ...TANG.rest], paras: flat(tangPoems()), verse: true },
  },

  // ---------------------------------------------------------------------------------------------------------- Kindle ---
  // Gutenberg's title page ("Produced by …", the title, 老子道經) is no chapter: the book opens on 第一章 (spine.ts dropTitlePage).
  { file: 'gutenberg-daodejing.azw3', upload: 'daodejing.azw3', make: () => kindle('daodejing.gutenberg.azw3'), expect: { title: '道德經', author: 'Laozi', script: 'traditional', chapters: DAODEJING_CHAPTERS, sourceSpaces: 6 } },
  { file: 'gutenberg-daodejing.mobi', upload: 'daodejing.mobi', make: () => kindle('daodejing.gutenberg.mobi'), expect: { title: '道德經', author: 'Laozi', script: 'traditional', chapters: DAODEJING_CHAPTERS, sourceSpaces: 6 } },
  {
    file: 'kf8-azw3.azw3', upload: `${T}.azw3`,
    make: () => buildKf8({ title: T, author: A, files: HANS.map(([t, ps]) => `<h2>${esc(t)}</h2>` + ps.map((p) => `<p>${esc(p)}</p>`).join('')), fragsPerFile: 3, toc: HANS.map(([t], i) => ({ file: i, offset: 0, title: t })) }).bytes,
    expect: book(HANS, 'simplified'),
  },
  ...[true, false].map((withNcx): Case => ({
    file: withNcx ? 'mobi6-ncx.mobi' : 'mobi6-headings-only.mobi', upload: `${HANT_TITLE}.mobi`,
    make: () => {
      const enc = new TextEncoder();
      let markup = '<html><head><guide><reference type="toc" title="目录" filepos="0000000000"/></guide></head><body>';
      const ncxEntries: { pos: number; title: string }[] = [];
      for (const [t, ps] of HANT) {
        ncxEntries.push({ pos: enc.encode(markup).length, title: t });
        markup += `<h2>${esc(t)}</h2>` + ps.map((p) => `<p width="0">${esc(p)}</p>`).join('') + '<mbp:pagebreak/>';
      }
      markup += '</body></html>';
      return buildMobi(markup, { title: HANT_TITLE, author: HANT_AUTHOR, compression: 'palmdoc', extraFlags: 3, ...(withNcx ? { ncx: ncxEntries } : {}) });
    },
    expect: tradBook(HANT),
  })),

  // ------------------------------------------------------------------------------------------------------------- PDF ---
  {
    file: 'pdf-chrome-mac.pdf', upload: `${T}.pdf`,
    // Chrome on a Mac: Songti SC names many glyphs by Kangxi radicals (⼀ for 一, ⼜ for 口), justified lines carry narrow
    // spaces, a title page, a chapter per page.
    make: () => macPdf(typeset(HANS, { titlePage: { title: T, author: A }, justify: true }), T),
    expect: { ...book(HANS, 'simplified', { author: '', chapters: [T, ...titles(HANS)], allowExtra: [T + A] }) },
    gap: 'the title page is a chapter of its own, and its author is not read',
  },
  {
    file: 'pdf-chrome-mac-headers.pdf', upload: `${T}.pdf`,
    make: () => macPdf(typeset(HANS.slice(0, 3), { titlePage: { title: T, author: A }, justify: true, headerFooter: { title: T, url: 'file:///D:/books/book.html' } }), T),
    expect: { title: T, script: 'simplified' },
    gap: "the browser's header and footer lines (date, title, file address, page n/N) stay in the text",
  },
  {
    file: 'pdf-chrome-tang.pdf', upload: '唐詩八首.pdf',
    make: () => macPdf(typeset([[TANG.title, TANG.rest]], { verse: true, size: 12 }), TANG.title),
    expect: { title: TANG.title, script: 'traditional', content: [TANG.title, ...TANG.rest] },
    gap: 'lines of verse run together into paragraphs',
  },
  {
    file: 'pdf-chrome-two-column.pdf', upload: `${T}.pdf`,
    make: () => macPdf(typeset(HANS.slice(0, 3), { width: 595, height: 842, columns: 2, justify: true }), T, { width: 595, height: 842 }),
    expect: book(HANS.slice(0, 3), 'simplified', { author: '' }),
  },
  {
    file: 'pdf-chrome-vertical.pdf', upload: `${HANT_TITLE}.pdf`,
    make: () => verticalPdf(keep(HANT.slice(0, 2), 6), HANT_TITLE),
    expect: { title: HANT_TITLE, script: 'traditional' },
    gap: 'vertical text: the columns are not put back in reading order',
  },
  { file: 'pdf-password.pdf', upload: `${T}.pdf`, make: () => makeUnicodePdf(typeset(HANS.slice(0, 1)), { password: true }), expect: { error: /password protected/ } },
  {
    file: 'pdf-scanned-watermark.pdf', upload: `${T}(扫描版).pdf`,
    // Scanned pages, each with one line of real text: a library's stamp and the page number.
    make: () => makeUnicodePdf(Array.from({ length: 6 }, (_, i) => ({ image: true, runs: [{ x: 120, y: 18, text: `本书由某某数字图书馆扫描制作 第${i + 1}页`, size: 8 }] }))),
    expect: { error: /no text layer/ },
  },
  { file: 'pdf-scanned.pdf', upload: `扫描版${T}.pdf`, make: () => makeUnicodePdf([{ image: true, runs: [] }, { image: true, runs: [] }]), expect: { error: /no text layer/ } },

  // ------------------------------------------------------------------------------------------------- text: encodings ---
  { file: 'txt-big5.txt', upload: `${HANT_TITLE}.txt`, make: () => encodeLegacy(hantBook(bodyLines(BIG5_HANT)), 'big5'), expect: tradBook(BIG5_HANT, { encoding: 'big5' }) },
  { file: 'txt-big5hkscs.txt', upload: `${HANT_TITLE}.txt`, make: () => encodeLegacy(hantBook(bodyLines(HKSCS_HANT)), 'big5-hkscs'), expect: tradBook(HKSCS_HANT, { encoding: 'big5' }) },
  { file: 'txt-cr-only.txt', upload: `${T}.txt`, make: () => utf8(textBook(bodyLines(HANS)).replace(/\n/g, '\r')), expect: book(HANS, 'simplified', { encoding: 'utf-8' }) },
  { file: 'txt-gb18030.txt', upload: 'book.txt', make: () => encodeLegacy(textBook(bodyLines(GB18030_HANS)), 'gb18030'), expect: book(GB18030_HANS, 'simplified', { encoding: 'gb18030' }) },
  { file: 'txt-gbk-crlf.txt', upload: `${T}.txt`, make: () => encodeLegacy(textBook(bodyLines(GBK_HANS), T, `作者：${A}`, '\r\n'), 'gbk'), expect: book(GBK_HANS, 'simplified', { encoding: 'gb18030' }) },
  { file: 'txt-gbk-trad.txt', upload: `${HANT_TITLE}.txt`, make: () => encodeLegacy(hantBook(bodyLines(GBK_HANT)), 'gbk'), expect: tradBook(GBK_HANT, { encoding: 'gb18030' }) },
  {
    file: 'txt-gbk-truncated.txt', upload: `${T}.txt`,
    // The last two bytes cut off: half of the last character (and the line end).
    make: () => encodeLegacy(textBook(bodyLines(GBK_HANS)), 'gbk').slice(0, -2),
    expect: book(cutLast(GBK_HANS), 'simplified', { encoding: 'gb18030', warnings: [/^1 character could not be read/] }),
  },
  {
    file: 'txt-utf8-truncated.txt', upload: `${T}.txt`,
    make: () => utf8(textBook(bodyLines(HANS))).slice(0, -2),
    expect: book(cutLast(HANS), 'simplified', { encoding: 'utf-8', warnings: [/^1 character could not be read/] }),
  },
  {
    file: 'txt-utf8-with-gbk-line.txt', upload: `${T}.txt`,
    // One line pasted in from a GBK file (an uploader's credit): it is read as GBK and dropped as site junk.
    make: () => {
      const lines = textBook(bodyLines(HANS)).split('\n');
      const mid = lines.length >> 1;
      return concatBytes(utf8(lines.slice(0, mid).join('\n') + '\n'), encodeLegacy('本章由热心书友上传', 'gbk'), utf8('\n' + lines.slice(mid).join('\n')));
    },
    expect: book(HANS, 'simplified', { encoding: 'utf-8' }),
  },
  {
    file: 'txt-utf8-bad-bytes.txt', upload: `${T}.txt`,
    // A few bytes that are not UTF-8 in the middle of a UTF-8 book: each one shows as �, and the import says how many.
    make: () => {
      const lines = textBook(bodyLines(HANS)).split('\n');
      return concatBytes(utf8(lines.slice(0, 20).join('\n') + '\n'), Uint8Array.of(0xff, 0xfe, 0x80), utf8(lines.slice(20).join('\n')));
    },
    expect: { title: T, author: A, script: 'simplified', encoding: 'utf-8', chapters: titles(HANS), paraShare: 0.97, paras: flat(HANS), warnings: [/^3 characters could not be read and show as \ufffd\.$/] },
  },
  ...([['txt-utf16le-bom.txt', true, true], ['txt-utf16be-bom.txt', false, true], ['txt-utf16le-nobom.txt', true, false], ['txt-utf16be-nobom.txt', false, false]] as const).map(([file, le, bom]): Case => ({
    file, upload: file, make: () => encodeUtf16(hantBook(bodyLines(HANT)), le, bom), expect: tradBook(HANT, { encoding: le ? 'utf-16le' : 'utf-16be' }),
  })),
  { file: 'txt-utf8-bom.txt', upload: 'book-bom.txt', make: () => concatBytes(Uint8Array.of(0xef, 0xbb, 0xbf), utf8(textBook(bodyLines(HANS)))), expect: book(HANS, 'simplified', { encoding: 'utf-8' }) },
  { file: 'txt-utf8-trad.txt', upload: `${HANT_TITLE}.txt`, make: () => utf8(hantBook(bodyLines(HANT))), expect: tradBook(HANT, { encoding: 'utf-8' }) },
  { file: 'txt-utf8.txt', upload: `${T}.txt`, make: () => utf8(textBook(bodyLines(HANS))), expect: book(HANS, 'simplified', { encoding: 'utf-8' }) },
  ...(() => {
    const poem = ['床前明月光，疑是地上霜。', '举头望明月，低头思故乡。'];
    const trad = ['床前明月光，疑是地上霜。', '舉頭望明月，低頭思故鄉。'];
    const short = (title: string, lines: string[], script: 'simplified' | 'traditional', encoding: string): Expect => ({ title, author: '', script, encoding, content: lines, paras: lines });
    return [
      { file: 'txt-short-gbk.txt', upload: '静夜思.txt', make: () => encodeLegacy(['静夜思', ...poem, ''].join('\r\n'), 'gbk'), expect: short('静夜思', poem, 'simplified', 'gb18030') },
      { file: 'txt-short-big5.txt', upload: '靜夜思.txt', make: () => encodeLegacy(['靜夜思', ...trad, ''].join('\r\n'), 'big5'), expect: short('靜夜思', trad, 'traditional', 'big5') },
      { file: 'txt-short-utf16le-nobom.txt', upload: '靜夜思.txt', make: () => encodeUtf16(['靜夜思', ...trad, ''].join('\n'), true, false), expect: short('靜夜思', trad, 'traditional', 'utf-16le') },
      { file: 'txt-para-gbk.txt', upload: 'note.txt', make: () => encodeLegacy(GBK_HANS[1][1][0] + '\r\n', 'gbk'), expect: { author: '', script: 'simplified', encoding: 'gb18030', content: [GBK_HANS[1][1][0]], paras: [GBK_HANS[1][1][0]] } },
      { file: 'txt-para-big5.txt', upload: 'note.txt', make: () => encodeLegacy(BIG5_HANT[0][1][2] + '\r\n', 'big5'), expect: { author: '', script: 'traditional', encoding: 'big5', content: [BIG5_HANT[0][1][2]], paras: [BIG5_HANT[0][1][2]] } },
    ] satisfies Case[];
  })(),

  // ---------------------------------------------------------------------------------------------- text: hard wraps ---
  { file: 'txt-wrap35-indent-gbk.txt', upload: `${T}.txt`, make: () => encodeLegacy(textBook(bodyLines(GBK_HANS, { wrapAt: 35 }), T, `作者：${A}`, '\r\n'), 'gbk'), expect: book(GBK_HANS, 'simplified', { encoding: 'gb18030' }) },
  { file: 'txt-wrap32-blank.txt', upload: `${T}.txt`, make: () => utf8(textBook(bodyLines(HANS, { indent: '', blank: true, wrapAt: 32 }))), expect: book(HANS, 'simplified') },
  {
    file: 'txt-wrap38-plain.txt', upload: `${T}.txt`,
    // No blank lines and no indent: a line one or two characters short of 38 ends its paragraph; one exactly 38 long that
    // ends a sentence is joined unless a quotation follows (it cannot be told apart from a paragraph that fills its last line).
    make: () => utf8(textBook(bodyLines(HANS, { indent: '', wrapAt: 38 }))),
    expect: book(HANS, 'simplified', { paraShare: 0.95 }),
  },
  { file: 'txt-wrap30-indent-blank-trad.txt', upload: `${HANT_TITLE}.txt`, make: () => utf8(hantBook(bodyLines(HANT, { blank: true, wrapAt: 30 }))), expect: tradBook(HANT) },
  {
    file: 'txt-wrap36-stories.txt', upload: `${HANT_TITLE}.txt`,
    // Classical prose wrapped at 36 with no indent, each story's title a plain line.
    make: () => utf8(hantBook(bodyLines(HANT, { indent: '', wrapAt: 36, head: (_i, t) => t.replace(/^第\S+回\s*/u, '') }))),
    expect: { title: HANT_TITLE, author: HANT_AUTHOR, script: 'traditional', content: contentOf(HANT, (_i, t) => t.replace(/^第\S+回\s*/u, '')), paras: flat(HANT), paraShare: 0.9 },
    gap: 'story titles without 第 are not chapters (the text is cut into parts by size)',
  },

  // ---------------------------------------------------------------------------------------------- text: headings ---
  ...Object.entries(headingStyles).map(([key, s]): Case => ({
    file: `txt-h-${key}.txt`, upload: `${T}.txt`,
    make: () => utf8(textBook(bodyLines(HANS, { head: styled(s.line), headBlank: key === 'centered' }))),
    expect: book(HANS, 'simplified', { chapters: HANS.map((_, i) => s.shown(i, HANS_NAMES[i])), content: contentOf(HANS, styled(s.shown)) }),
  })),
  { file: 'txt-h-none.txt', upload: `${T}.txt`, make: () => utf8(textBook(bodyLines(HANS, { head: null }))), expect: book(HANS, 'simplified', { chapters: undefined, content: flat(HANS) }) },
  {
    file: 'txt-h-volume.txt', upload: `${HANT_TITLE}.txt`,
    // 卷 lines over the 回 headings: the volumes are folded into the chapter that follows.
    make: () => utf8(hantBook(HANT.flatMap(([t, ps], i) => [...(i === 0 ? ['卷一'] : i === 2 ? ['卷二'] : []), t, ...ps.map((p) => '　　' + p)]))),
    expect: tradBook(HANT, { content: HANT.flatMap(([t, ps], i) => [...(i === 0 ? ['卷一'] : i === 2 ? ['卷二'] : []), t, ...ps]) }),
  },
  {
    file: 'txt-hongloumeng-full.txt', upload: '紅樓夢.txt',
    make: () => sampleBytes('hongloumeng.txt'),
    expect: (() => { const all = hongloumeng(); return { title: '紅樓夢', script: 'traditional', chapters: titles(all), content: contentOf(all), paras: flat(all) } as Expect; })(),
  },
  {
    file: 'txt-kuangren.txt', upload: '狂人日记.txt', make: () => sampleBytes('kuangren-riji.txt'),
    expect: (() => { const { title, rest } = sampleLines('kuangren-riji.txt'); return { title, author: '', script: 'simplified', content: rest, paras: rest.filter((l) => !/^[一二三四五六七八九十]+$/.test(l)) } as Expect; })(),
  },
  {
    file: 'txt-lunyu.txt', upload: 'lunyu-xue-er.txt', make: () => sampleBytes('lunyu-xue-er.txt'),
    // A classical book's section title on the first line is taken for the book's title.
    expect: (() => { const { title, rest } = sampleLines('lunyu-xue-er.txt'); return { title, author: '', script: 'traditional', content: rest, paras: rest } as Expect; })(),
  },
  {
    file: 'txt-longpara.txt', upload: `${T}.txt`,
    // Each section one paragraph: a paragraph over 3,000 characters is cut at sentence ends.
    make: () => utf8(textBook(bodyLines(HANS.map(([t, ps]) => [t, [ps.join('')]])))),
    expect: book(HANS, 'simplified', { paras: undefined }),
  },
  {
    file: 'txt-oneline.txt', upload: `${T}.txt`,
    // The whole book on one line, no line breaks at all: cut at sentence ends into pieces.
    make: () => utf8(T + contentOf(HANS).join('')),
    expect: { title: T, script: 'simplified', content: [T, ...contentOf(HANS)] },
  },
  {
    file: 'txt-mixed-script.txt', upload: `${T}.txt`,
    make: () => utf8(textBook(bodyLines([...HANS.slice(0, 2), ...HANT.slice(0, 2)]))),
    expect: book([...HANS.slice(0, 2), ...HANT.slice(0, 2)], 'mixed' as never),
  },

  // ------------------------------------------------------------------------------------ text: download-site junk ---
  {
    file: 'txt-pirate-gbk.txt', upload: `《${T}》（校对版全本）作者：${A}.txt`,
    make: () => encodeLegacy(pirate(GBK_HANS), 'gbk'),
    expect: book(GBK_HANS, 'simplified', { encoding: 'gb18030', allowExtra: ['全文完'] }),
  },
  {
    file: 'txt-stamped.txt', upload: '紅樓夢.txt',
    // A site's stamp every 25 paragraphs through thirty chapters: dropped as a line repeated through the whole book.
    make: () => {
      const lines = ['紅樓夢', '作者：曹雪芹', ''];
      let k = 0;
      for (const [t, ps] of hongloumeng(30)) {
        lines.push(t);
        for (const p of ps) {
          lines.push('　　' + p);
          if (++k % 25 === 0) lines.push('【书香小筑 · 手打精校版】');
        }
      }
      return utf8(lines.join('\n'));
    },
    expect: (() => { const h = hongloumeng(30); return { title: '紅樓夢', author: '曹雪芹', script: 'traditional', chapters: titles(h), content: contentOf(h), paras: flat(h) } as Expect; })(),
  },

  // ------------------------------------------------------------------------------------------------ text: poetry ---
  ...([['txt-tang.txt', 'tang-poems.txt'], ['txt-xinshi.txt', 'xinshi.txt']] as const).map(([file, name]): Case => {
    const { title, rest } = sampleLines(name);
    const heads = rest.filter((l) => POEM_TITLE.test(l) || /^[一二三四五六七八九十]+$/.test(l));
    return { file, upload: name, make: () => sampleBytes(name), expect: { title, author: '', content: rest, paras: rest.filter((l) => !heads.includes(l)), verse: true } };
  }),
];

describe('the import suite', () => {
  it('has the 79 kinds of file of the first measurement, and UTF-8 with bad bytes inside', () => {
    expect(CASES.length).toBe(80);
    expect(new Set(CASES.map((c) => c.file)).size).toBe(80);
  });

  for (const c of CASES) {
    it(`${c.file}${c.gap ? ` (not yet: ${c.gap})` : ''}`, async () => {
      const bytes = c.make();
      if (c.expect.error) {
        await expect(importFile(new File([bytes as Uint8Array<ArrayBuffer>], c.upload))).rejects.toThrow(c.expect.error);
        return;
      }
      const result = await importFile(new File([bytes as Uint8Array<ArrayBuffer>], c.upload));
      const encoding = c.file.endsWith('.txt') ? decodeText(bytes).encoding : undefined;
      expect(problems(result, c.expect, encoding)).toEqual([]);
    });
  }
});
