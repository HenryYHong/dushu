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
