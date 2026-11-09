// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importFile } from '../../src/import';
import { cleanAuthorName, cleanAuthors, parseFilename, authorFromLine } from '../../src/import/meta';
import { dropContentsPages, dropTitlePage } from '../../src/import/spine';
import { CONTAINER, asFile, makeEpub, ncxDoc, opf, prose, xhtml } from './helpers';

describe('author names', () => {
  it.each([
    ['автор Антон Павлович Чехов (1860—1904)', 'Антон Павлович Чехов'],
    ['Author Mary Shelley (1797–1851)', 'Mary Shelley'],
    ['Autoren Kollektiv', 'Autoren Kollektiv'],
    ['Author of Waverley', 'Author of Waverley'],
    ['autor desconocido', 'autor desconocido'],
    ['автор неизвестен', 'автор неизвестен'],
    ['原著：金庸', '金庸'],
    ['原著:金庸', '金庸'],
    ['著：金庸', '金庸'],
    ['作者：金庸', '金庸'],
    ['作　者：金庸', '金庸'],
    ['金庸 著', '金庸'],
    ['金庸著', '金庸'],
    ['[清]曹雪芹', '曹雪芹'],
    ['［清］曹雪芹', '曹雪芹'],
    ['（明）施耐庵', '施耐庵'],
    ['【明】罗贯中', '罗贯中'],
    ['清·曹雪芹', '曹雪芹'],
    ['明・冯梦龙', '冯梦龙'],
    ['文/金庸', '金庸'],
    ['原著：[清]曹雪芹', '曹雪芹'],
    ['余华', '余华'],
    ['宋江', '宋江'], // a name that starts like a dynasty
    ['元稹', '元稹'],
    ['Eileen Chang', 'Eileen Chang'],
  ])('%s becomes %s', (raw, want) => {
    expect(cleanAuthors([raw])).toBe(want);
    expect(cleanAuthorName(raw)).toBe(want);
  });

  it('keeps several authors', () => {
    expect(cleanAuthors(['曹雪芹、高鹗'])).toBe('曹雪芹, 高鹗');
    expect(cleanAuthors(['[清]曹雪芹', '[清]高鹗'])).toBe('曹雪芹, 高鹗');
    expect(cleanAuthors(['原著：曹雪芹；续：高鹗'])).toBe('曹雪芹, 高鹗');
    expect(cleanAuthors(['金庸', '金庸'])).toBe('金庸');
  });

  it('leaves out translators and placeholders', () => {
    expect(cleanAuthors(['作者：余华，译者：某某'])).toBe('余华');
    expect(cleanAuthors(['Unknown'])).toBe('');
    expect(cleanAuthors(['未知'])).toBe('');
    expect(cleanAuthors(['ePUBw.COM'])).toBe('');
  });

  it('cleans bylines in text files and file names', () => {
    expect(authorFromLine('作者：[清]曹雪芹')).toBe('曹雪芹');
    expect(authorFromLine('作　者：金庸')).toBe('金庸');
    expect(authorFromLine('原著：金庸')).toBe('金庸');
    expect(authorFromLine('著：[明]施耐庵')).toBe('施耐庵');
    expect(parseFilename('天龙八部 作者：金庸.txt')).toEqual({ title: '天龙八部', author: '金庸' });
  });
});

describe('EPUB title page and heading spelling', () => {
  const chapterFile = (n: number, heading: string) => xhtml(`<h1>${heading}</h1><p>${prose(120, n)}</p><p>${prose(80, n + 2)}</p>`);
  const base = (extra: Record<string, string>, creators = ['原著：金庸']) =>
    makeEpub({
      'META-INF/container.xml': CONTAINER('content.opf'),
      'content.opf': opf({
        version: '2.0',
        title: '射雕',
        creators,
        manifest: [
          ['t', 'title.xhtml', 'application/xhtml+xml'],
          ['a', 'a.xhtml', 'application/xhtml+xml'],
          ['b', 'b.xhtml', 'application/xhtml+xml'],
          ['ncx', 'toc.ncx', 'application/x-dtbncx+xml'],
        ],
        spine: ['t', 'a', 'b'],
        spineToc: 'ncx',
      }),
      'toc.ncx': ncxDoc([['a.xhtml', '第1回 风雪惊变'], ['b.xhtml', '第2回 江南七怪']]),
      'a.xhtml': chapterFile(1, '第1回风雪惊变'),
      'b.xhtml': chapterFile(2, '第2回江南七怪'),
      ...extra,
    });

  it('drops a page that only repeats the title and author, and spells headings like the contents list', async () => {
    const book = await importFile(
      asFile(base({ 'title.xhtml': xhtml('<h1>射雕</h1><div>原著：金庸</div>') }), 'x.epub'),
    );
    expect(book.author).toBe('金庸');
    expect(book.chapters.map((c) => c.title)).toEqual(['第1回 风雪惊变', '第2回 江南七怪']);
    expect(book.chapters[0].blocks[0]).toEqual({ t: 'h', level: 1, text: '第1回 风雪惊变' });
  });

  it('keeps a short page that says something else', async () => {
    const book = await importFile(asFile(base({ 'title.xhtml': xhtml('<h1>献词</h1><p>献给所有读者。</p>') }), 'x.epub'));
    expect(book.chapters.map((c) => c.title)).toEqual(['献词', '第1回 风雪惊变', '第2回 江南七怪']);
  });

  it('dropTitlePage only touches a short first chapter made of the title and author', () => {
    const ch = (title: string, texts: string[]) => ({ title, blocks: texts.map((text) => ({ t: 'p' as const, text })) });
    const rest = ch('一', [prose(100)]);
    expect(dropTitlePage([ch('天龙八部', ['天龙八部', '金庸']), rest], '天龙八部', '金庸')).toEqual([rest]);
    expect(dropTitlePage([ch('道', ['道']), rest], '道德经', '老子')).toHaveLength(2); // one character is too little to match
    expect(dropTitlePage([ch('序', [prose(100)]), rest], '天龙八部', '金庸')).toHaveLength(2);
    expect(dropTitlePage([ch('天龙八部', ['天龙八部'])], '天龙八部', '金庸')).toHaveLength(1); // never the only chapter
  });

  it('drops a printed title page as Project Gutenberg keeps it, and never a short first poem', () => {
    const ch = (title: string, texts: string[]) => ({ title, blocks: texts.map((text) => ({ t: 'p' as const, text })) });
    const rest = ch('I', [prose(100)]);
    // Marianela (Gutenberg 17340): the title, "Por", the author, the printer, the city, the year.
    expect(dropTitlePage([ch('Marianela', ['Marianela', 'Por', 'Benito Pérez Galdós', 'Imprenta y Litografía de La Guirnalda', 'Madrid', '1878']), rest], 'Marianela', 'Benito Pérez Galdós')).toEqual([rest]);
    expect(dropTitlePage([ch('道德經', ['Produced by Ching-yi Chen', '老子《道德經》第一~四十章', '老子道經']), rest], '道德經', 'Laozi')).toEqual([rest]);
    // A poem headed with the book's title says nothing of a printed book.
    expect(dropTitlePage([ch('Rimas', ['Rimas', 'Volverán las oscuras golondrinas', 'en tu balcón sus nidos a colgar']), rest], 'Rimas', 'Gustavo Adolfo Bécquer')).toHaveLength(2);
    // A dedication stays, initials and all (Gutenberg's Oz), and so does a dedication in capitals.
    expect(dropTitlePage([ch('The Wonderful Wizard of Oz', ['The Wonderful Wizard of Oz', 'by L. Frank Baum', 'This book is dedicated to my good friend & comrade', 'My Wife', 'L.F.B.']), rest], 'The Wonderful Wizard of Oz', 'L. Frank Baum')).toHaveLength(2);
    expect(dropTitlePage([ch('Dracula', ['DRACULA', 'BY BRAM STOKER', 'TO', 'MY DEAR FRIEND', 'HOMMY-BEG', '1897']), rest], 'Dracula', 'Bram Stoker')).toHaveLength(2);
    // Chinese credit lines need their colon: 作者的话 is the author speaking.
    expect(dropTitlePage([ch('边城', ['边城', '作者的话', '1934年']), rest], '边城', '沈从文')).toHaveLength(2);
    // A line that ends a sentence is the book talking, not its title page.
    expect(dropTitlePage([ch('Marianela', ['Marianela', 'Benito Pérez Galdós', 'Se puso el sol.']), rest], 'Marianela', 'Benito Pérez Galdós')).toHaveLength(2);
  });

  it('drops a contents page kept as a chapter, and keeps a short chapter that lists other things', () => {
    const ch = (title: string, texts: string[]) => ({ title, blocks: texts.map((text) => ({ t: 'p' as const, text })) });
    const body = ['-I- Perdido', '-II- Guiado', '-III- Un diálogo', '-IV- La familia de piedra'].map((t) => ch(t, [prose(100)]));
    const toc = ch('Capítulos:', ['Capítulos:', '-I-,', '-II-,', '-III-,', '-IV-.']);
    expect(dropContentsPages([toc, ...body])).toEqual(body);
    expect(dropContentsPages([ch('Contents', ['Contents', 'Preface', 'The Voyage', 'Notes']), ...body])).toEqual(body);
    // The titles listed, without a heading (an index at the end).
    expect(dropContentsPages([...body, ch('', ['I. Perdido', 'II. Guiado', 'III. Un diálogo', 'IV. La familia de piedra'])])).toEqual(body);
    // A chapter of short lines that are not the book's chapters, and no contents heading: a poem, kept.
    const poem = ch('Rima I', ['Yo sé un himno gigante y extraño', 'que anuncia en la noche del alma una aurora', 'y estas páginas son de ese himno', 'cadencias que el aire dilata en las sombras']);
    expect(dropContentsPages([poem, ...body])).toEqual([poem, ...body]);
  });
});
