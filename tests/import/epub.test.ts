// @vitest-environment jsdom
import { strToU8 } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { setDefaultSvgRasterizer } from '../../src/import/assets';
import { BIG_CHAPTER_HAN, chapterHan } from '../../src/import/chapters';
import { CONTAINER, PNG, SVG, asFile, makeEpub, navDoc, ncxDoc, opf, prose, xhtml } from './helpers';

async function load(files: Parameters<typeof makeEpub>[0], name = 'book.epub') {
  return importFile(asFile(makeEpub(files), name));
}

const texts = (b: { chapters: { blocks: { t: string; text?: string }[] }[] }) => b.chapters.map((c) => c.blocks.filter((x) => x.t === 'p').map((x) => x.text));

describe('EPUB 3 with a nav document', () => {
  const files = {
    'META-INF/container.xml': CONTAINER(),
    'OEBPS/content.opf': opf({
      title: '测试之书',
      creators: ['王小明'],
      // spine order differs from manifest order on purpose
      manifest: [
        ['c2', 'text/ch2.xhtml', 'application/xhtml+xml'],
        ['c1', 'text/ch1.xhtml', 'application/xhtml+xml'],
        ['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'],
      ],
      spine: ['c1', 'c2'],
    }),
    'OEBPS/nav.xhtml': navDoc([['text/ch1.xhtml', '第一章 开始'], ['text/ch2.xhtml#part', '第二章 继续']]),
    'OEBPS/text/ch1.xhtml': xhtml(`<h1>第一章 开始</h1><p>${prose(60)}</p><p>${prose(40, 2)}</p>`),
    'OEBPS/text/ch2.xhtml': xhtml(`<h1 id="part">第二章 继续</h1><p>${prose(80, 1)}</p>`),
  };

  it('reads metadata, spine order and nav titles', async () => {
    const book = await load(files);
    expect(book.title).toBe('测试之书');
    expect(book.author).toBe('王小明');
    expect(book.format).toBe('epub');
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章 开始', '第二章 继续']);
    expect(book.chapters[0].blocks[0]).toEqual({ t: 'h', level: 1, text: '第一章 开始' });
    expect(chapterHan(book.chapters[0])).toBeGreaterThan(90);
  });
});

describe('EPUB 2 with an NCX', () => {
  it('maps several TOC entries inside one spine file by fragment', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        version: '2.0',
        title: '合集',
        manifest: [
          ['ncx', 'toc.ncx', 'application/x-dtbncx+xml'],
          ['a', 'all.xhtml', 'application/xhtml+xml'],
        ],
        spine: ['a'],
        spineToc: 'ncx',
      }),
      'toc.ncx': ncxDoc([['all.xhtml#s1', '甲'], ['all.xhtml#s2', '乙'], ['all.xhtml#s3', '丙']]),
      'all.xhtml': xhtml(
        `<div><a id="s1"/><p>${prose(30)}</p><p>${prose(30, 1)}</p></div><div id="s2"><p>${prose(50, 2)}</p></div><div><span id="s3"></span><p>${prose(20, 3)}</p></div>`,
      ),
    });
    expect(book.chapters.map((c) => c.title)).toEqual(['甲', '乙', '丙']);
    expect(book.chapters[0].blocks).toHaveLength(2);
    expect(book.chapters[1].blocks).toHaveLength(1);
    expect(book.chapters[2].blocks).toHaveLength(1);
  });

  it('attaches spine files the TOC does not list to the previous chapter', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        version: '2.0',
        title: '续',
        manifest: [
          ['ncx', 'toc.ncx', 'application/x-dtbncx+xml'],
          ['a', 'a.xhtml', 'application/xhtml+xml'],
          ['b', 'a_split_2.xhtml', 'application/xhtml+xml'],
          ['c', 'c.xhtml', 'application/xhtml+xml'],
        ],
        spine: ['a', 'b', 'c'],
        spineToc: 'ncx',
      }),
      'toc.ncx': ncxDoc([['a.xhtml', '上'], ['c.xhtml', '下']]),
      'a.xhtml': xhtml(`<p>${prose(30)}</p>`),
      'a_split_2.xhtml': xhtml(`<p>${prose(30, 1)}</p>`),
      'c.xhtml': xhtml(`<p>${prose(30, 2)}</p>`),
    });
    expect(book.chapters.map((c) => [c.title, c.blocks.length])).toEqual([['上', 2], ['下', 1]]);
  });
});

describe('nested and awkward package files', () => {
  it('flattens a nested nav and folds a part page into its first chapter', async () => {
    const nav = xhtml(
      `<nav epub:type="toc"><ol><li><a href="part1.xhtml">第一部</a><ol><li><a href="c1.xhtml">第一章 甲</a></li><li><a href="c2.xhtml">第二章 乙</a></li></ol></li></ol></nav>` +
        `<nav epub:type="landmarks"><ol><li><a href="c1.xhtml">Start</a></li></ol></nav>`,
    );
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        title: '部',
        manifest: [
          ['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'],
          ['p', 'part1.xhtml', 'application/xhtml+xml'],
          ['a', 'c1.xhtml', 'application/xhtml+xml'],
          ['b', 'c2.xhtml', 'application/xhtml+xml'],
        ],
        spine: ['nav', 'p', 'a', 'b'],
      }),
      'nav.xhtml': nav,
      'part1.xhtml': xhtml('<h1>第一部</h1>'),
      'c1.xhtml': xhtml(`<h2>第一章 甲</h2><p>${prose(40)}</p>`),
      'c2.xhtml': xhtml(`<h2>第二章 乙</h2><p>${prose(40, 1)}</p>`),
    });
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章 甲', '第二章 乙']);
    expect(book.chapters[0].blocks[0]).toEqual({ t: 'h', level: 1, text: '第一部' });
  });

  it('reads an OPF with a bare ampersand and an HTML entity in it', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({ title: '甲 & 乙&nbsp;集', creators: ['张三 & 李四'], manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
      'a.xhtml': xhtml(`<p>${prose(40)}</p>`),
    });
    expect(book.title).toContain('甲');
    expect(book.chapters).toHaveLength(1);
    expect(book.author).toBe('张三, 李四');
  });

  it('finds the package document without a container.xml', async () => {
    const book = await load({
      'book/package.opf': opf({ title: '无容器', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
      'book/a.xhtml': xhtml(`<p>${prose(40)}</p>`),
    });
    expect(book.title).toBe('无容器');
  });
});

describe('missing or broken TOC', () => {
  it('falls back to one chapter per file, titled by heading or "Section n"', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        title: '无目录',
        manifest: [['a', 'a.xhtml', 'application/xhtml+xml'], ['b', 'b.xhtml', 'application/xhtml+xml']],
        spine: ['a', 'b'],
      }),
      'a.xhtml': xhtml(`<h2>开篇</h2><p>${prose(40)}</p>`),
      'b.xhtml': xhtml(`<p>${prose(40)}</p>`),
    });
    expect(book.chapters.map((c) => c.title)).toEqual(['开篇', 'Section 2']);
  });

  it('splits a single file at chapter headings when there is no TOC', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({ title: '单', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
      'a.xhtml': xhtml(`<h1>第一章</h1><p>${prose(40)}</p><h1>第二章</h1><p>${prose(40, 1)}</p><h2>小节</h2><p>${prose(40, 2)}</p>`),
    });
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章', '第二章']);
    expect(book.chapters[1].blocks.map((b) => b.t)).toEqual(['h', 'p', 'h', 'p']);
  });

  it('works with no OPF spine at all', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({ title: '无脊', manifest: [], spine: [] }),
      'b.xhtml': xhtml(`<p>${prose(40, 1)}</p>`),
      'a.xhtml': xhtml(`<p>${prose(40)}</p>`),
    });
    expect(book.chapters).toHaveLength(2);
  });

  it('survives a TOC that points at files and ids that do not exist', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        version: '2.0',
        title: '坏目录',
        manifest: [['ncx', 'toc.ncx', 'application/x-dtbncx+xml'], ['a', 'a.xhtml', 'application/xhtml+xml']],
        spine: ['a'],
        spineToc: 'ncx',
      }),
      'toc.ncx': ncxDoc([['missing.xhtml', '没有'], ['a.xhtml#nope', '有']]),
      'a.xhtml': xhtml(`<p>${prose(60)}</p>`),
    });
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].title).toBe('有');
  });
});

describe('block extraction', () => {
  const base = (body: string, head = '') => ({
    'META-INF/container.xml': CONTAINER('content.opf'),
    'content.opf': opf({ title: '块', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
    'a.xhtml': xhtml(body, head),
  });

  it('handles nested divs with text directly inside', async () => {
    const book = await load(base(`<div><div>前面的话。<div>里面的话。</div>后面的话。</div>${prose(30)}</div>`));
    expect(texts(book)[0]).toEqual(['前面的话。', '里面的话。', '后面的话。', prose(30)]);
  });

  it('splits <br>-separated paragraphs when the book uses br as a paragraph break', async () => {
    const book = await load(base(`<p>${prose(30)}<br/>${prose(25, 1)}<br/><br/>${prose(20, 2)}</p>`));
    expect(texts(book)[0]).toEqual([prose(30), prose(25, 1), prose(20, 2)]);
  });

  it('joins <br> that is only a soft wrap at a fixed width', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 12; i++) lines.push([...prose(60, i)].slice(0, 20).join('').replace(/[。，]$/, '字'));
    const book = await load(base(`<p>${lines.join('<br/>')}</p>`));
    expect(texts(book)[0]).toHaveLength(1);
    expect(texts(book)[0][0]).toBe(lines.join(''));
  });

  it('turns blockquote, hr and headings into blocks and ignores vertical-writing CSS', async () => {
    const book = await load(
      base(
        `<h2>标题</h2><p style="writing-mode: vertical-rl">${prose(30)}</p><hr/><blockquote><p>引文一。</p><p>引文二。</p></blockquote>`,
        '<style>body{writing-mode:vertical-rl;-epub-writing-mode:vertical-rl}</style>',
      ),
    );
    expect(book.chapters[0].blocks.map((b) => b.t)).toEqual(['h', 'p', 'hr', 'quote', 'quote']);
  });

  it('keeps deliberate spaces but drops source line breaks between Chinese characters', async () => {
    const book = await load(base(`<h1>第一章 开始</h1><p>你好\n    世界，\n  Hello\n  world。</p>`));
    expect(book.chapters[0].blocks).toEqual([
      { t: 'h', level: 1, text: '第一章 开始' },
      { t: 'p', text: '你好世界， Hello world。' },
    ]);
  });

  it('removes ruby annotations, scripts, styles and footnote markers', async () => {
    const book = await load(
      base(
        `<p>他<ruby>漢<rp>(</rp><rt>han</rt><rp>)</rp></ruby><ruby>字<rt>zì</rt></ruby>很难。<a epub:type="noteref" href="#n1">1</a>` +
          `第二句<sup><a href="#fn2">[2]</a></sup>话<script>alert(1)</script><style>p{}</style>。<a href="#back" class="backlink">↩</a></p>` +
          `<aside epub:type="footnote" id="n1"><p>注释内容在这里。<a epub:type="backlink" href="#r">↩</a></p></aside>`,
      ),
    );
    const t = texts(book)[0];
    expect(t[0]).toBe('他漢字很难。第二句话。');
    expect(t[1]).toBe('注释内容在这里。');
    expect(JSON.stringify(book)).not.toMatch(/han\b|zì|alert|↩/);
  });

  it('drops pinyin that is marked up as plain spans', async () => {
    const book = await load(base(`<p>你<span class="pinyin">nǐ</span>好<span class="Pinyin-text">hǎo</span>。${prose(20)}</p>`));
    expect(texts(book)[0][0]).toBe(`你好。${prose(20)}`);
  });

  it('drops site boilerplate', async () => {
    const book = await load(base(`<div>本书由“<a href="http://epubw.com">ePUBw.COM</a>”整理，提供最新最全的优质电子书下载！！！</div><p>${prose(30)}</p>`));
    expect(book.chapters[0].blocks).toHaveLength(1);
  });

  it('drops a generated contents page', async () => {
    const links = Array.from({ length: 5 }, (_, i) => `<div><a href="c${i}.xhtml">第${i + 1}章</a></div>`).join('');
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        title: '目录书',
        manifest: [['toc', 'toc.xhtml', 'application/xhtml+xml'], ['a', 'a.xhtml', 'application/xhtml+xml']],
        spine: ['toc', 'a'],
      }),
      'toc.xhtml': xhtml(links),
      'a.xhtml': xhtml(`<h1>正文</h1><p>${prose(60)}</p>`),
    });
    expect(book.chapters.map((c) => c.title)).toEqual(['正文']);
  });
});

describe('Project Gutenberg books', () => {
  it('drops the license header and footer and retitles the first chapter', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({ title: '狂人日記', manifest: [['a', 'a.xhtml', 'application/xhtml+xml'], ['b', 'b.xhtml', 'application/xhtml+xml']], spine: ['a', 'b'] }),
      'a.xhtml': xhtml(`<h1>The Project Gutenberg eBook of 狂人日記</h1><p>This ebook is for the use of anyone anywhere.</p><p>*** START OF THE PROJECT GUTENBERG EBOOK 狂人日記 ***</p><p>${prose(80)}</p>`),
      'b.xhtml': xhtml(`<p>${prose(40, 1)}</p><p>*** END OF THE PROJECT GUTENBERG EBOOK 狂人日記 ***</p><p>License text goes on here.</p>`),
    });
    expect(book.chapters.map((c) => c.title)).toEqual(['狂人日記', 'Section 2']);
    expect(JSON.stringify(book.chapters)).not.toMatch(/Gutenberg|License/);
  });
});

describe('malformed markup and encodings', () => {
  const pack = (name: string, bytes: Uint8Array) => ({
    'META-INF/container.xml': CONTAINER('content.opf'),
    'content.opf': opf({ title: '编码', manifest: [['a', name, 'application/xhtml+xml']], spine: ['a'] }),
    [name]: bytes,
  });

  it('falls back to the HTML parser on XML errors (entities, unclosed tags)', async () => {
    const html = `<html><body><p>${prose(30)}&nbsp;&mdash;<br>${prose(20, 1)}<p>第二段。<div id="x"/><p>第三段。</body></html>`;
    const book = await load(pack('a.xhtml', strToU8(html)));
    const t = texts(book)[0];
    expect(t).toContain('第二段。');
    expect(t).toContain('第三段。');
  });

  it('decodes GBK-declared XHTML', async () => {
    const gbk = Uint8Array.from(
      // "<?xml version='1.0' encoding='gbk'?><html><body><p>你好，世界。我们在这里读书。</p></body></html>" with the Chinese in GBK
      [
        ...strToU8("<?xml version='1.0' encoding='gbk'?><html xmlns='http://www.w3.org/1999/xhtml'><body><p>"),
        0xc4, 0xe3, 0xba, 0xc3, 0xa3, 0xac, 0xca, 0xc0, 0xbd, 0xe7, 0xa1, 0xa3, 0xce, 0xd2, 0xc3, 0xc7, 0xd4, 0xda, 0xd5, 0xe2, 0xc0, 0xef, 0xb6, 0xc1, 0xca, 0xe9, 0xa1, 0xa3, // 你好，世界。我们在这里读书。
        ...strToU8('</p></body></html>'),
      ],
    );
    const book = await load(pack('a.xhtml', gbk));
    expect(texts(book)[0]).toEqual(['你好，世界。我们在这里读书。']);
  });

  it('decodes Big5-declared HTML', async () => {
    const big5 = Uint8Array.from([
      ...strToU8('<html><head><meta http-equiv="Content-Type" content="text/html; charset=big5"></head><body><p>'),
      0xa7, 0x41, 0xa6, 0x6e, 0xa1, 0x41, 0xa5, 0x40, 0xac, 0xc9, 0xa1, 0x43, 0xa7, 0xda, 0xad, 0xcc, 0xa6, 0x62, 0xb3, 0x6f, 0xb8, 0xcc, 0xc5, 0xaa, 0xae, 0xd1, 0xa1, 0x43, // 你好，世界。我們在這裡讀書。
      ...strToU8('</p></body></html>'),
    ]);
    const book = await load(pack('a.html', big5));
    expect(texts(book)[0]).toEqual(['你好，世界。我們在這裡讀書。']);
  });
});

afterEach(() => setDefaultSvgRasterizer());

describe('images and cover', () => {
  const files = {
    'META-INF/container.xml': CONTAINER('content.opf'),
    'content.opf': opf({
      title: '图',
      manifest: [
        ['cov', 'images/cover.png', 'image/png', 'cover-image'],
        ['img', 'images/%E5%9B%BE%20%E7%89%87.svg', 'image/svg+xml'],
        ['a', 'text/a.xhtml', 'application/xhtml+xml'],
      ],
      spine: ['a'],
    }),
    'OEBPS/ignored': '',
    'images/cover.png': PNG,
    'images/图 片.svg': SVG,
    'text/a.xhtml': xhtml(
      `<h1>有图</h1><p>${prose(30)}</p><p><img src="../images/%E5%9B%BE%20%E7%89%87.svg" alt="示意图"/></p>` +
        `<div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../images/cover.png"/></svg></div>` +
        `<p><img src="../images/missing.png"/><img src="http://example.com/x.png"/></p>`,
    ),
  };

  it('stores referenced images with their mime type and detects the cover', async () => {
    setDefaultSvgRasterizer(async () => PNG); // no canvas in a test; the browser draws the SVG to a PNG
    const book = await load(files);
    const imgs = book.chapters[0].blocks.filter((b) => b.t === 'img');
    expect(imgs).toHaveLength(2);
    expect(book.cover).toBe('cover.png');
    expect(book.assets.get('cover.png')?.type).toBe('image/png');
    const svgName = (imgs[0] as { asset: string }).asset;
    expect(svgName).toMatch(/\.png$/); // an SVG is stored as the PNG it was drawn to
    expect(book.assets.get(svgName)?.type).toBe('image/png');
    expect((imgs[0] as { alt?: string }).alt).toBe('示意图');
    expect((imgs[1] as { asset: string }).asset).toBe('cover.png');
    expect(book.assets.size).toBe(2);
  });

  it('finds a cover from EPUB 2 <meta name="cover">', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        version: '2.0',
        title: '封',
        manifest: [['c', 'c.png', 'image/png'], ['other', 'other.png', 'image/png'], ['a', 'a.xhtml', 'application/xhtml+xml']],
        spine: ['a'],
        metaExtra: '<meta name="cover" content="c"/>',
      }),
      'other.png': PNG,
      'c.png': PNG,
      'a.xhtml': xhtml(`<p>${prose(40)}</p>`),
    });
    expect(book.cover).toBe('c.png');
  });

  it('finds a cover from the guide, through a cover page', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        version: '2.0',
        title: '封',
        manifest: [['p', 'cover.xhtml', 'application/xhtml+xml'], ['i', 'art/front.jpg', 'image/jpeg'], ['a', 'a.xhtml', 'application/xhtml+xml']],
        spine: ['p', 'a'],
        guide: '<reference type="cover" title="Cover" href="cover.xhtml"/>',
      }),
      'cover.xhtml': xhtml('<div><img src="art/front.jpg"/></div>'),
      'art/front.jpg': PNG,
      'a.xhtml': xhtml(`<p>${prose(40)}</p>`),
    });
    expect(book.cover).toBe('front.jpg');
    expect(book.chapters).toHaveLength(1); // the picture-only cover page is not a chapter
  });

  it('falls back to the first image when nothing marks a cover', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({ title: '无', manifest: [['i', 'z.png', 'image/png'], ['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
      'z.png': PNG,
      'a.xhtml': xhtml(`<p>${prose(40)}</p>`),
    });
    expect(book.cover).toBe('z.png');
  });
});

describe('metadata cleanup', () => {
  it('strips site junk from the creator list and title', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        title: '某书 (z-library.sk, 1lib.sk)',
        creators: ['余华, ePUBw.COM', '未知'],
        manifest: [['a', 'a.xhtml', 'application/xhtml+xml']],
        spine: ['a'],
      }),
      'a.xhtml': xhtml(`<p>${prose(40)}</p>`),
    });
    expect(book.author).toBe('余华');
    expect(book.title).toBe('某书');
  });

  it('keeps only authors when a translator is listed (EPUB 3 refines)', async () => {
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        title: '译',
        creators: ['Jane Doe', 'Li Si'],
        manifest: [['a', 'a.xhtml', 'application/xhtml+xml']],
        spine: ['a'],
      }).replace('<dc:creator>Jane Doe', '<dc:creator id="c1">Jane Doe').replace('<dc:creator>Li Si', '<dc:creator id="c2">Li Si').replace(
        '</metadata>',
        '<meta refines="#c1" property="role" scheme="marc:relators">aut</meta><meta refines="#c2" property="role" scheme="marc:relators">trl</meta></metadata>',
      ),
      'a.xhtml': xhtml(`<p>${prose(40)}</p>`),
    });
    expect(book.author).toBe('Jane Doe');
  });

  it('uses the file name when the book has no title', async () => {
    const book = await load(
      {
        'META-INF/container.xml': CONTAINER('content.opf'),
        'content.opf': opf({ manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
        'a.xhtml': xhtml(`<p>${prose(40)}</p>`),
      },
      '红楼梦.epub',
    );
    expect(book.title).toBe('红楼梦');
  });
});

describe('DRM and bad files', () => {
  const plain = {
    'META-INF/container.xml': CONTAINER('content.opf'),
    'content.opf': opf({ title: '锁', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
    'a.xhtml': xhtml(`<p>${prose(40)}</p>`),
  };
  const enc = (algo: string, uri: string) =>
    `<?xml version="1.0"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${algo}"/><enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData></enc:EncryptedData></encryption>`;

  it('refuses content that is encrypted', async () => {
    await expect(load({ ...plain, 'META-INF/encryption.xml': enc('http://www.w3.org/2001/04/xmlenc#aes128-cbc', 'a.xhtml') })).rejects.toThrow(/DRM/);
  });

  it('accepts font obfuscation', async () => {
    const book = await load({
      ...plain,
      'META-INF/encryption.xml': enc('http://www.idpf.org/2008/embedding', 'fonts/x.otf'),
      'fonts/x.otf': new Uint8Array([1, 2, 3]),
    });
    expect(book.chapters).toHaveLength(1);
    const adobe = await load({ ...plain, 'META-INF/encryption.xml': enc('http://ns.adobe.com/pdf/enc#RC', 'fonts/x.ttf') });
    expect(adobe.chapters).toHaveLength(1);
  });

  it('says so when there is no Chinese', async () => {
    await expect(
      load({
        'META-INF/container.xml': CONTAINER('content.opf'),
        'content.opf': opf({ title: 'English', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
        'a.xhtml': xhtml('<p>This book is written entirely in English, with no Chinese at all. '.repeat(20) + '</p>'),
      }),
    ).rejects.toThrow(/No Chinese text/);
  });

  it('says so for a zip that is not an EPUB', async () => {
    await expect(importFile(asFile(makeEpub({ 'readme.txt': 'hi' }), 'x.epub'))).rejects.toThrow(/EPUB/);
  });

  it('rejects an EPUB name on non-zip bytes', async () => {
    await expect(importFile(asFile(strToU8('not a zip'), 'x.epub'))).rejects.toThrow(/looks damaged or incomplete/);
  });
});

describe('huge single-file books', () => {
  it('splits a spine item over 30k Han characters by its headings', async () => {
    const body = [1, 2, 3].map((n) => `<h2>第${n}章</h2>` + Array.from({ length: 12 }, (_, i) => `<p>${prose(1400, i + n)}</p>`).join('')).join('');
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({ title: '巨', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
      'a.xhtml': xhtml(body),
    });
    expect(book.chapters.map((c) => c.title)).toEqual(['第1章', '第2章', '第3章']);
  });

  it('cuts an oversize file with no headings into sized parts that run on without a title', async () => {
    const body = Array.from({ length: 120 }, (_, i) => `<p>${prose(700, i)}</p>`).join('');
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({ title: '巨', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
      'a.xhtml': xhtml(body),
    });
    expect(book.chapters.length).toBeGreaterThanOrEqual(3);
    for (const c of book.chapters) expect(chapterHan(c)).toBeLessThan(BIG_CHAPTER_HAN);
    expect(book.chapters.map((c) => !!c.cont)).toEqual(book.chapters.map((_, i) => i > 0));
  });

  it('keeps a long chapter whole (a novel\'s chapter of 49,000 characters)', async () => {
    const body = Array.from({ length: 70 }, (_, i) => `<p>${prose(700, i)}</p>`).join('');
    const book = await load({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({ title: '长', manifest: [['a', 'a.xhtml', 'application/xhtml+xml']], spine: ['a'] }),
      'a.xhtml': xhtml(`<h1>第二章</h1>${body}`),
    });
    expect(book.chapters.map((c) => c.title)).toEqual(['第二章']);
    expect(book.chapters[0].cont).toBeUndefined();
  });
});
