// @vitest-environment jsdom
// Find a book's two catalogs (ui/library/findBooks.ts): Gutenberg's OPDS search and Wikisource's search API, read into books.
import { describe, expect, it } from 'vitest';
import { gutenbergFile, parseOpds, parseWikisourceSearch, wikisourceFile } from '../../src/ui/library/findBooks';

describe('Project Gutenberg search', () => {
  it('reads books, their authors and languages, and the next page', () => {
    const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<link rel="next" href="/ebooks/search.opds/?query=l.es&amp;sort_order=downloads&amp;start_index=26"/>
<entry><id>https://www.gutenberg.org/ebooks/search.opds/?sort_order=title</id><title>Sort Alphabetically by Title</title></entry>
<entry><id>https://dev.gutenberg.org/ebooks/2000.opds</id><title>Don Quijote (Spanish)</title><content type="text">Miguel de Cervantes Saavedra</content></entry>
<entry><id>https://dev.gutenberg.org/ebooks/16119.opds</id><title>Doctrina Christiana
 (Spanish) (Tagalog)</title><content type="text">6118 downloads</content></entry>
<entry><id>https://dev.gutenberg.org/ebooks/7.opds</id><title>&lt;img src=x onerror=alert(1)&gt;</title><content>x</content></entry>
</feed>`;
    const { books, next } = parseOpds(xml, 'Spanish');
    expect(books.map((b) => [b.key, b.title, b.author, b.also])).toEqual([
      ['2000', 'Don Quijote', 'Miguel de Cervantes Saavedra', []],
      ['16119', 'Doctrina Christiana', '', ['Tagalog']],
      // Markup in a title stays text: the row puts it in a text node.
      ['7', '<img src=x onerror=alert(1)>', 'x', []],
    ]);
    expect(next).toBe(26);
    expect(gutenbergFile(2000)).toBe('gutenberg-2000.epub');
  });
});

describe('Wikisource search', () => {
  it('keeps works in order, leaves out parts, authors, portals and lists of editions, and finds the next page', () => {
    const json = { continue: { gsroffset: 25, continue: 'gsroffset||' }, query: { pages: [
      { index: 3, title: '吶喊' },
      { index: 1, title: '阿Q正傳', categories: [{ title: 'Category:魯迅' }] },
      { index: 2, title: '江南話新文字五分鐘/跋' },
      { index: 4, title: 'Author:魯迅' },
      { index: 5, title: 'The Raven', pageprops: { disambiguation: '' } },
      { index: 6, title: 'The Raven (Poe)', categories: [{ title: 'Category:Versions pages' }] },
      { index: 7, title: 'Le Horla (recueil)', categories: [{ title: 'Catégorie:Éditions multiples' }] },
    ] } };
    const { books, next } = parseWikisourceSearch(json);
    expect(books.map((b) => [b.source, b.key])).toEqual([['wikisource', '阿Q正傳'], ['wikisource', '吶喊']]);
    expect(next).toBe(25);
    expect(parseWikisourceSearch({})).toEqual({ books: [], next: null });
    expect(wikisourceFile('zh', 'a/b:c')).toBe('wikisource-zh-a_b_c.epub');
  });
});

describe('Aozora Bunko', () => {
  const index = `# Aozora Bunko index
# id\ttitle\treading\tauthors\tauthor readings\tmodern spelling\tcard/file\trank
1567\t走れメロス\tはしれメロス\t太宰治\tだざいおさむ\t1\t000035/1567_14913.html\t2
773\tこころ\tこころ\t夏目漱石\tなつめそうせき\t1\t000148/773_14560.html\t3
752\t坊っちゃん\tぼっちゃん\t夏目漱石\tなつめそうせき\t1\t000148/752_14964.html\t
9999\tこころの旅\tこころのたび\t誰か\tだれか\t0\t000001/9999_1.html\t
bad\tno file\t\t\t\t1\tnot/a/path\t
`;
  it('reads the index and finds works by title, reading, author or the author’s reading, best match first', async () => {
    const { parseAozoraIndex, searchAozora, foldJa, sourcesFor } = await import('../../src/ui/library/findBooks');
    const works = parseAozoraIndex(index);
    expect(works.map((w) => w.id)).toEqual(['1567', '773', '752', '9999']);
    expect(works[3]).toMatchObject({ modern: false, rank: 0 });
    expect(searchAozora(works, 'こころ').map((w) => w.id)).toEqual(['773', '9999']);
    expect(searchAozora(works, 'ココロ').map((w) => w.id)).toEqual(['773', '9999']);
    expect(searchAozora(works, '夏目 漱石').map((w) => w.id)).toEqual(['773', '752']);
    expect(searchAozora(works, 'なつめ').map((w) => w.id)).toEqual(['773', '752']);
    expect(searchAozora(works, 'メロス').map((w) => w.id)).toEqual(['1567']);
    expect(searchAozora(works, '').map((w) => w.id)).toEqual(['1567', '773', '752', '9999']);
    expect(foldJa('ﾊｼﾚ メロス')).toBe('はしれめろす');
    expect(sourcesFor('ja')[0]).toBe('aozora');
    expect(sourcesFor('zh')).toEqual(['wikisource', 'gutenberg']);
    expect(sourcesFor('es')).toEqual(['gutenberg', 'wikisource']);
  });
});

describe('a pasted link', () => {
  it('names the book in whichever library it is, and nothing else', async () => {
    const { parseBookLink } = await import('../../src/ui/library/findBooks');
    expect(parseBookLink('https://www.gutenberg.org/ebooks/17340')).toEqual({ source: 'gutenberg', key: '17340' });
    expect(parseBookLink('https://www.gutenberg.org/cache/epub/17340/pg17340-images.html')).toEqual({ source: 'gutenberg', key: '17340' });
    expect(parseBookLink(' http://gutenberg.org/ebooks/2000.epub3.images ')).toEqual({ source: 'gutenberg', key: '2000' });
    expect(parseBookLink('https://zh.wikisource.org/wiki/%E9%98%BFQ%E6%AD%A3%E5%82%B3')).toEqual({ source: 'wikisource', key: '阿Q正傳', lang: 'zh' });
    expect(parseBookLink('https://fr.m.wikisource.org/wiki/Le_Horla_(recueil,_Ollendorff_1895)')).toEqual({ source: 'wikisource', key: 'Le Horla (recueil, Ollendorff 1895)', lang: 'fr' });
    expect(parseBookLink('https://www.aozora.gr.jp/cards/000148/card752.html')).toEqual({ source: 'aozora', key: '752' });
    expect(parseBookLink('https://www.aozora.gr.jp/cards/000148/files/752_14964.html')).toEqual({ source: 'aozora', key: '752' });
    for (const no of ['夏目漱石', 'gutenberg.org/ebooks/1', 'https://example.com/ebooks/12', 'https://www.gutenberg.org/ebooks/search/?query=x', 'javascript:alert(1)', 'https://zh.wikisource.org/w/index.php?title=x', 'https://www.aozora.gr.jp/index_pages/person148.html']) {
      expect(parseBookLink(no)).toBeNull();
    }
  });
});
