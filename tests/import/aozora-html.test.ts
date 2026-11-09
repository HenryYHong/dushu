// @vitest-environment jsdom
// An Aozora Bunko work page (import/html.ts tidyAozora) and printed readings (<ruby>) in Japanese pages and EPUBs
// (import/blocks.ts, extractBlocks `ruby`): the story alone, its title and author from the page's DC metadata, and each reading
// on the block as a span of its text. Shaped after 坊っちゃん (aozora.gr.jp card 752), cut down; UTF-8 here, Shift_JIS there.
import { afterEach, describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { setLangForTests } from '../../src/lang/active';
import { CONTAINER, asFile, makeEpub, opf, xhtml } from './helpers';

afterEach(() => setLangForTests(null));

const page = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja"><head><meta http-equiv="Content-Type" content="text/html;charset=UTF-8"/>
<title>夏目漱石 坊っちゃん</title><meta name="DC.Title" content="坊っちゃん"/><meta name="DC.Creator" content="夏目漱石"/><meta name="DC.Publisher" content="青空文庫"/></head>
<body><div class="metadata"><h1 class="title">坊っちゃん</h1><h2 class="author">夏目漱石</h2><br/></div>
<div id="contents" style="display:none"></div><div class="main_text"><br/>
<div class="jisage_5"><h4 class="naka-midashi"><a class="midashi_anchor" id="midashi10">一</a></h4></div><br/>
　<ruby><rb>親譲</rb><rp>（</rp><rt>おやゆず</rt><rp>）</rp></ruby>りの<ruby><rb>無鉄砲</rb><rp>（</rp><rt>むてっぽう</rt><rp>）</rp></ruby>で小供の時から損ばかりしている。<br/>
　親類のものから西洋製のナイフを<ruby>貰<rt>もら</rt></ruby>って奇麗な刃を日に翳して、友達に見せていた。<br/>
<div class="jisage_5"><h4 class="naka-midashi"><a class="midashi_anchor" id="midashi20">二</a></h4></div><br/>
　ぶうと云って汽船がとまると、<ruby><rb>艀</rb><rp>（</rp><rt>はしけ</rt><rp>）</rp></ruby>が岸を離れて、漕ぎ寄せて来た。<br/>
</div>
<div class="bibliographical_information"><hr/><br/>底本：「ちくま日本文学全集　夏目漱石」筑摩書房<br/>入力：小林繁雄<br/></div>
<div class="notation_notes"></div></body></html>`;

describe('an Aozora Bunko page', () => {
  it('keeps the story, its chapters and its readings, and nothing of the library', async () => {
    setLangForTests('ja');
    const b = await importFile(asFile(new TextEncoder().encode(page), 'aozora-752.html'));
    expect(b.title).toBe('坊っちゃん');
    expect(b.author).toBe('夏目漱石');
    expect(b.chapters.map((c) => c.title)).toEqual(['一', '二']);
    const text = JSON.stringify(b.chapters);
    for (const gone of ['底本', '入力', '夏目漱石']) expect(text).not.toContain(gone);
    const first = b.chapters[0].blocks.find((x) => x.t === 'p') as { text: string; ruby?: { start: number; end: number; rt: string }[] };
    expect(first.text.startsWith('親譲りの無鉄砲で')).toBe(true);
    // Each reading over exactly the kanji it reads.
    expect(first.ruby?.map((r) => [first.text.slice(r.start, r.end), r.rt])).toEqual([['親譲', 'おやゆず'], ['無鉄砲', 'むてっぽう']]);
    const second = b.chapters[0].blocks.filter((x) => x.t === 'p')[1] as { text: string; ruby?: { start: number; end: number; rt: string }[] };
    expect(second.ruby?.map((r) => [second.text.slice(r.start, r.end), r.rt])).toEqual([['貰', 'もら']]);
  });
});

describe('printed readings in an EPUB', () => {
  const book = (lang: string, body: string) => makeEpub({
    'META-INF/container.xml': CONTAINER('OPS/content.opf'),
    'OPS/content.opf': opf({ title: 'T', manifest: [['c1', 'c1.xhtml', 'application/xhtml+xml']], spine: ['c1'] }).replace('<dc:language>zh</dc:language>', `<dc:language>${lang}</dc:language>`),
    'OPS/c1.xhtml': xhtml(body),
  });
  it('keeps them for a Japanese book, mono ruby and group ruby alike', async () => {
    setLangForTests('ja');
    const b = await importFile(asFile(book('ja', '<h1><ruby>蜘蛛<rt>くも</rt></ruby>の糸</h1><p>ある日の事でございます。<ruby>御<rt>お</rt>釈<rt>しゃ</rt>迦<rt>か</rt></ruby>様は極楽の蓮池のふちを、独りでぶらぶら御歩きになっていらっしゃいました。</p>'), 'k.epub'));
    const h = b.chapters[0].blocks[0] as { t: string; text: string; ruby?: { start: number; end: number; rt: string }[] };
    expect(h).toMatchObject({ t: 'h', text: '蜘蛛の糸' });
    expect(h.ruby?.map((r) => [h.text.slice(r.start, r.end), r.rt])).toEqual([['蜘蛛', 'くも']]);
    const p = b.chapters[0].blocks[1] as { text: string; ruby?: { start: number; end: number; rt: string }[] };
    expect(p.ruby?.map((r) => [p.text.slice(r.start, r.end), r.rt])).toEqual([['御', 'お'], ['釈', 'しゃ'], ['迦', 'か']]);
    expect(p.text).not.toMatch(/[﷐-﷒]/);
  });
  it('drops them for a Chinese book, as before', async () => {
    setLangForTests('zh');
    const b = await importFile(asFile(book('zh', '<p><ruby>中<rt>zhōng</rt>国<rt>guó</rt></ruby>是一个很大的国家，我们都很喜欢这里的山和水，也喜欢这里的人。</p>'), 'z.epub'));
    const p = b.chapters[0].blocks[0] as { text: string; ruby?: unknown[] };
    expect(p.text.startsWith('中国是一个')).toBe(true);
    expect(p.ruby).toBeUndefined();
  });
});
