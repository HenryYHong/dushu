// @vitest-environment jsdom
// Wikisource's own EPUB export (ws-export), as "Find a book" brings it: each part's header (the parts before and after, the
// author), the sister-project links, the license icons, an English About page, a title page and the logo as the cover all go;
// the author comes from the header and a part's title from its middle cell. Shaped after a real export of 西遊記
// (zh.wikisource.org, 2026-11-09), cut down by hand.
import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { CONTAINER, PNG, asFile, makeEpub, navDoc, opf, prose, xhtml } from './helpers';

const header = (prev: string, part: string, next: string) => `<div id="headerContainer-n5" typeof="mw:Transclusion"><table><tbody><tr>
<td>←</td><td><a href="c1.xhtml" title="西遊記/第001回">${prev}</a></td>
<td><b>西遊記</b><br/>${part}<br/><span>作者：</span><a href="https://zh.wikisource.org/wiki/Author:吳承恩" title="Author:吳承恩">吳承恩</a></td>
<td><a href="c3.xhtml">${next}</a></td><td class="noprint">→</td></tr></tbody></table>
<table><tbody><tr><td><ul id="plainSister-n6"><li class="noprint sisitem"><img src="images/c2_icon.svg_60px_PD_icon.svg.png"/>百科</li></ul></td></tr></tbody></table></div>`;

function book(source = '<dc:source>https://zh.wikisource.org/wiki/%E8%A5%BF%E9%81%8A%E8%A8%98</dc:source><dc:contributor>Wikisource</dc:contributor><meta name="cover" content="logo"/>') {
  return makeEpub({
    'META-INF/container.xml': CONTAINER('OPS/content.opf'),
    'OPS/content.opf': opf({
      title: '西遊記', metaExtra: source,
      manifest: [
        ['nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'],
        ['title', 'title.xhtml', 'application/xhtml+xml'],
        ['c1', 'c1.xhtml', 'application/xhtml+xml'],
        ['c2', 'c2.xhtml', 'application/xhtml+xml'],
        ['about', 'about.xhtml', 'application/xhtml+xml'],
        ['logo', 'images/Wikisource-logo.svg.png', 'image/png'],
        ['icon', 'images/c2_icon.svg_60px_PD_icon.svg.png', 'image/png'],
      ],
      spine: ['title', 'c1', 'c2', 'about'],
    }),
    'OPS/nav.xhtml': navDoc([['title.xhtml', '西遊記'], ['c1.xhtml', '第一回'], ['c2.xhtml', '第二回'], ['about.xhtml', '关于']]),
    'OPS/title.xhtml': xhtml('<h1>西遊記</h1><img src="images/Wikisource-logo.svg.png"/>'),
    'OPS/c1.xhtml': xhtml(`${header('', '第一回<br/>靈根育孕源流出　心性修持大道生', '第二回')}<p>${prose(80)}</p><p>${prose(60, 2)}</p>`),
    'OPS/c2.xhtml': xhtml(`${header('第一回', '第二回<br/>悟徹菩提真妙理　斷魔歸本合元神', '第三回')}<p>${prose(70, 3)}</p>`),
    'OPS/about.xhtml': xhtml('<h1>About this digital edition</h1><p>This e-book comes from the online library Wikisource. This multilingual digital library, built by volunteers, is committed to developing a free accessible collection of publications of every kind.</p>'),
    'OPS/images/Wikisource-logo.svg.png': PNG,
    'OPS/images/c2_icon.svg_60px_PD_icon.svg.png': PNG,
  });
}

describe('a book from Wikisource', () => {
  it('keeps the work and nothing of the site', async () => {
    const b = await importFile(asFile(book(), 'wikisource-zh-西遊記.epub'));
    expect(b.author).toBe('吳承恩');
    expect(b.cover).toBeUndefined();
    expect(b.chapters).toHaveLength(2);
    const text = JSON.stringify(b.chapters);
    for (const gone of ['←', '→', '作者', 'About this digital edition', '百科']) expect(text).not.toContain(gone);
    expect(b.chapters.flatMap((c) => c.blocks).some((x) => x.t === 'img')).toBe(false);
    // The part's title, which only the header had, heads its chapter.
    expect(b.chapters[1].blocks[0]).toMatchObject({ t: 'h', text: expect.stringMatching(/^第二回 悟徹菩提真妙理[ 　]斷魔歸本合元神$/) });
    expect(b.chapters[1].blocks[1]).toMatchObject({ t: 'p' });
  });

  it('knows the Japanese Wikisource header too, and takes the author by the name of their page', async () => {
    const ja = makeEpub({
      'META-INF/container.xml': CONTAINER('OPS/content.opf'),
      'OPS/content.opf': opf({
        title: '蜘蛛の糸', metaExtra: '<dc:source>https://ja.wikisource.org/wiki/%E8%9C%98%E8%9B%9B%E3%81%AE%E7%B3%B8</dc:source>',
        manifest: [['c0', 'c0.xhtml', 'application/xhtml+xml']], spine: ['c0'],
      }),
      'OPS/c0.xhtml': xhtml(`<div id="navigationHeader"><p><b>蜘蛛の糸</b><br/>作者：<a href="https://ja.wikisource.org/wiki/作者:芥川龍之介" title="作者:芥川龍之介">芥川龍之介（あくたがわ）</a><br/>1918年</p></div>
<div id="navigationNotes"><ul id="plainSister"><li class="sisitem"><a title="トーク:蜘蛛の糸">書誌情報</a></li></ul></div>
<h2>一</h2><p>${prose(60)}</p><h2>二</h2><p>${prose(60, 2)}</p>`),
    });
    const b = await importFile(asFile(ja, 'wikisource-ja-蜘蛛の糸.epub'));
    expect(b.author).toBe('芥川龍之介');
    expect(JSON.stringify(b.chapters)).not.toMatch(/書誌情報|作者|1918年/);
  });

  it('leaves another book with the same markup alone', async () => {
    const b = await importFile(asFile(book(''), 'other.epub'));
    expect(JSON.stringify(b.chapters)).toContain('About this digital edition');
  });
});
