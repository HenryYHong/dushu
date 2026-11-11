// @vitest-environment jsdom
// A Wikisource work made into an EPUB in the page (ui/library/wikisourceBook.ts) and imported as any EPUB is: the work's page,
// its parts from its contents (or its subpages), never a link in a header; a list of editions, a missing page and a page with
// no text say so; a long work is cut short and says how. The API's answers are saved ones (tests/fixtures/wikisource, real
// answers of es, ja and de Wikisource fetched 2026-11-09 and cut down to a few paragraphs). Nothing goes over the network.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importFile } from '../../src/import';
import { setLangForTests } from '../../src/lang/active';
import type { LangId } from '../../src/lang/types';
import { LANGS } from '../../src/lang/registry';
import { FoundError, fetchFound } from '../../src/ui/library/findBooks';
import { WikisourceError, wikisourceEpub } from '../../src/ui/library/wikisourceBook';

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', 'wikisource', `${name}.json`), 'utf8')) as {
  parse: { title: string; text: string; links: { ns: number; title: string; exists: boolean }[] };
};
const SAVED: Record<string, string> = {
  'es Marianela': 'es-marianela',
  'es Marianela/I': 'es-marianela-i',
  'es Marianela/II': 'es-marianela-ii',
  'es Marianela/III': 'es-marianela-iii',
  'ja 羅生門': 'ja-rashomon',
  'de Die Verwandlung': 'de-die-verwandlung',
};

type Answer = unknown | ((n: number) => Response);
let asked: string[] = [];
let headers: Headers[] = [];
/** The API of each Wikisource: a saved answer, or one given here (a function answers the nth request for that page). */
function api(given: Record<string, Answer> = {}) {
  asked = [];
  headers = [];
  const count = new Map<string, number>();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const page = `${url.hostname.split('.')[0]} ${url.searchParams.get('page')}`;
    if (!/^[a-z]{2}\.wikisource\.org$/.test(url.hostname) || url.pathname !== '/w/api.php') throw new TypeError('Failed to fetch');
    asked.push(page);
    headers.push(new Headers(init?.headers));
    const n = (count.get(page) ?? 0) + 1;
    count.set(page, n);
    const answer = given[page] ?? (SAVED[page] ? fixture(SAVED[page]) : { error: { code: 'missingtitle', info: "The page you specified doesn't exist." } });
    return typeof answer === 'function' ? (answer as (n: number) => Response)(n) : Response.json(answer);
  }));
}

async function imported(title: string, code: LangId, opts = {}) {
  setLangForTests(code);
  const book = await wikisourceEpub(title, code, opts);
  const b = await importFile(new File([book.epub as Uint8Array<ArrayBuffer>], `wikisource-${code}-${title}.epub`));
  return { book, b, text: JSON.stringify(b.chapters) };
}

afterEach(() => { vi.unstubAllGlobals(); setLangForTests('zh'); });

describe('a work on one page', () => {
  it('is one request, read as the page; the header, sister projects, source and license go', async () => {
    api();
    const { b, text } = await imported('羅生門', 'ja');
    expect(asked).toEqual(['ja 羅生門']);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://ja.wikisource.org/w/api.php');
    expect(Object.fromEntries(['action', 'formatversion', 'origin', 'redirects'].map((k) => [k, url.searchParams.get(k)]))).toEqual({ action: 'parse', formatversion: '2', origin: '*', redirects: '1' });
    // Browsers cannot set User-Agent: the API's own header names the app.
    expect(headers[0].get('Api-User-Agent')).toMatch(/^LinguPengu \(https:/);
    expect(b.title).toBe('羅生門');
    // No ws-author on the page: the importer takes the author from the header's link, by the name of their page.
    expect(b.author).toBe('芥川龍之介');
    expect(b.chapters).toHaveLength(1);
    expect(text).toContain('或日の暮方の事である');
    for (const gone of ['作者', '姉妹プロジェクト', 'Wikipedia', '出典', '1915年', '著作権']) expect(text).not.toContain(gone);
    // The readings the book prints stay on the text.
    expect(b.chapters[0].blocks.some((x) => 'ruby' in x && x.ruby?.length)).toBe(true);
  });
});

describe('a work in parts', () => {
  it('reads the parts its contents list, in order, each titled by its number and its link', async () => {
    api();
    const { book, b, text } = await imported('Marianela', 'es');
    expect(asked).toEqual(['es Marianela', 'es Marianela/I', 'es Marianela/II', 'es Marianela/III']);
    expect(book.cut).toBeNull();
    expect(b.title).toBe('Marianela');
    expect(b.author).toBe('Benito Pérez Galdós');
    expect(b.chapters.map((c) => c.title)).toEqual(['I. Perdido', 'II. Guiado', 'III. Un diálogo que servirá de exposicion']);
    // The part's own heading (the scan's running head, its number and name), then its text.
    expect(b.chapters[0].blocks.slice(0, 5).map((x) => ('text' in x ? x.text : x.t))).toEqual(['MARIANELA', 'hr', 'I', 'Perdido.', expect.stringMatching(/^Se puso el sol/)]);
    // The work's page was a title page and contents: not a chapter. Each part's header (the work, the author, the part before
    // and after, the note under it) and the page's notices go.
    for (const gone of ['INDICE', 'págs.', 'Nota:', 'ortografía original', 'fuente digital alternativa', 'Guiado →', 'multimedia']) expect(text).not.toContain(gone);
  });

  it('with no contents, reads its own subpages, and never a link in its header', async () => {
    const main = fixture('es-marianela');
    // The contents as a plain table, and the last chapter linked from the header only.
    main.parse.text = main.parse.text.replace('class="ws-summary"', 'class="indice"')
      .replace('<div id="headerprevious" class="wsbox-prev"></div>', '<div id="headerprevious" class="wsbox-prev"><a href="/wiki/Marianela/XXII" title="Marianela/XXII">Adios</a></div>');
    main.parse.links.push({ ns: 0, title: 'Marianela/XXII', exists: true });
    api({ 'es Marianela': main });
    const { b } = await imported('Marianela', 'es');
    expect(asked).toEqual(['es Marianela', 'es Marianela/I', 'es Marianela/II', 'es Marianela/III']);
    expect(b.chapters).toHaveLength(3);
  });

  it('keeps the work’s own page when it has a text besides its contents, and takes parts that are works of their own', async () => {
    const page = (title: string, text: string, links: string[] = []) => ({
      parse: { title, displaytitle: `<span class="mw-page-title-main">${title}</span>`, text: `<div class="mw-parser-output">${text}</div>`, categories: [], properties: {}, links: links.map((t) => ({ ns: 0, title: t, exists: true })) },
    });
    const preface = `<h2>自序</h2><p>${'我在年青時候也曾經做過許多夢，後來大半忘卻了。'.repeat(12)}</p>`;
    api({
      'zh 吶喊': page('吶喊', `<div id="headerContainer"><table><tr><td><a href="/wiki/%E5%A2%B3" title="墳">墳</a></td><td><b>吶喊</b><br/>作者：<a href="/wiki/Author:%E9%AD%AF%E8%BF%85" title="Author:魯迅">魯迅</a></td><td><a href="/wiki/%E9%87%8E%E8%8D%89" title="野草">野草</a></td></tr></table></div>
<div class="ws-summary"><h2>目錄</h2><ul><li><a href="#自序">自序</a></li><li><a href="/wiki/%E7%8B%82%E4%BA%BA%E6%97%A5%E8%A8%98" title="狂人日記">狂人日記</a></li><li><a href="/wiki/%E5%AD%94%E4%B9%99%E5%B7%B1" title="孔乙己">孔乙己</a></li><li><a href="/wiki/%E9%98%BF%EF%BC%B1%E6%AD%A3%E5%82%B3" class="mw-redirect" title="阿Ｑ正傳">阿Ｑ正傳</a></li></ul></div>${preface}`,
      ['墳', '野草', '狂人日記', '孔乙己', '阿Ｑ正傳']),
      'zh 狂人日記': page('狂人日記', `<p>${'某君昆仲，今隱其名，皆余昔日在中學校時良友。'.repeat(6)}</p>`),
      'zh 孔乙己': page('孔乙己', `<p>${'魯鎮的酒店的格局，是和別處不同的。'.repeat(6)}</p>`),
      'zh 阿Ｑ正傳': page('阿Q正傳', `<p>${'我要給阿Q做正傳，已經不止一兩年了。'.repeat(6)}</p>`),
    });
    const { b } = await imported('吶喊', 'zh');
    // Its header links to the works before and after it (墳, 野草): never asked for.
    expect(asked).toEqual(['zh 吶喊', 'zh 狂人日記', 'zh 孔乙己', 'zh 阿Ｑ正傳']);
    expect(b.author).toBe('魯迅');
    expect(b.chapters.map((c) => c.title)).toEqual(['自序', '狂人日記', '孔乙己', '阿Ｑ正傳']);
    expect(JSON.stringify(b.chapters)).not.toMatch(/目錄|墳|野草|作者/);
  });

  it('leaves out the work’s own text when a part of it is that text again (朝花夕拾’s 小引)', async () => {
    const page = (title: string, text: string, links: string[] = []) => ({
      parse: { title, displaytitle: title, text: `<div class="mw-parser-output">${text}</div>`, categories: [], properties: {}, links: links.map((t) => ({ ns: 0, title: t, exists: true })) },
    });
    const preface = `<h2>小引</h2><p>${'我常想在紛擾中尋出一點閒靜來，然而委實不容易。'.repeat(10)}</p>`;
    api({
      'zh 朝花夕拾': page('朝花夕拾', `<div class="ws-summary"><ul><li><a href="/wiki/%E6%9C%9D%E8%8A%B1%E5%A4%95%E6%8B%BE/%E5%B0%8F%E5%BC%95" title="朝花夕拾/小引">小引</a></li><li><a href="/wiki/%E7%8B%97%C2%B7%E8%B2%93%C2%B7%E9%BC%A0" title="狗·貓·鼠">狗·貓·鼠</a></li></ul></div>${preface}`, ['朝花夕拾/小引', '狗·貓·鼠']),
      'zh 朝花夕拾/小引': page('朝花夕拾/小引', preface),
      'zh 狗·貓·鼠': page('狗·貓·鼠', `<p>${'從去年起，彷彿聽得有人說我是仇貓的。'.repeat(8)}</p>`),
    });
    const { b } = await imported('朝花夕拾', 'zh');
    expect(b.chapters.map((c) => c.title)).toEqual(['小引', '狗·貓·鼠']);
  });

  it('leaves out the work’s page when it is only a title page and contents, with a summary under each entry (it)', async () => {
    const entry = (n: number) => `<ul><li><span class="tl-testo ws-summary"><a href="/wiki/Pinocchio/Capitolo_${n}" title="Pinocchio/Capitolo ${n}">Capitolo ${n}</a></span></li></ul>
<dl><dd><i>Come andò che maestro Ciliegia, falegname, trovò un pezzo di legno, che piangeva e rideva come un bambino, e lo regalò al suo amico Geppetto per fabbricarsi un burattino, nel capitolo ${n}.</i></dd></dl>`;
    const page = (title: string, text: string, links: string[] = []) => ({
      parse: { title, displaytitle: title, text: `<div class="mw-parser-output">${text}</div>`, categories: [], properties: {}, links: links.map((t) => ({ ns: 0, title: t, exists: true })) },
    });
    const chapters = Array.from({ length: 12 }, (_, i) => i + 1);
    api({
      'it Pinocchio': page('Pinocchio', `<div class="quality-ns0"><table class="quality-msg"><tr><td>Questo testo è riletto e controllato.</td></tr></table></div>
<figure><figcaption>C. Collodi - Le Avventure di Pinocchio - Firenze</figcaption></figure>
<div class="mw-heading mw-heading3"><h3 id="Indice">Indice</h3></div>${chapters.map(entry).join('\n')}`, chapters.map((n) => `Pinocchio/Capitolo ${n}`)),
      ...Object.fromEntries(chapters.map((n) => [`it Pinocchio/Capitolo ${n}`, page(`Pinocchio/Capitolo ${n}`, `<p>${'C’era una volta un pezzo di legno. '.repeat(8)}</p>`)])),
    });
    const { b, text } = await imported('Pinocchio', 'it');
    expect(b.chapters.map((c) => c.title)).toEqual(chapters.map((n) => `Capitolo ${n}`));
    for (const gone of ['Indice', 'maestro Ciliegia', 'riletto e controllato', 'Firenze']) expect(text).not.toContain(gone);
  });

  it('is cut at the most parts it may have, and says how many it kept', async () => {
    api();
    const { book, b } = await imported('Marianela', 'es', { maxParts: 2 });
    expect(book.cut).toEqual({ kept: 2, total: 3 });
    expect(asked).not.toContain('es Marianela/III');
    expect(b.chapters.map((c) => c.title)).toEqual(['I. Perdido', 'II. Guiado']);
  });

  it('waits as long as the API asks when it says to slow down, then asks again', async () => {
    api({
      'es Marianela/II': (n: number) => n === 1
        ? new Response('You are making too many requests to the API.', { status: 429, headers: { 'Retry-After': '1' } })
        : Response.json(fixture('es-marianela-ii')),
    });
    const { b } = await imported('Marianela', 'es');
    expect(asked.filter((a) => a === 'es Marianela/II')).toHaveLength(2);
    expect(b.chapters).toHaveLength(3);
  });
});

describe('a page that is not a book', () => {
  it('a list of works with one name says so, after one request', async () => {
    api();
    const e = await wikisourceEpub('Die Verwandlung', 'de').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WikisourceError);
    expect((e as WikisourceError).code).toBe('list');
    expect((e as Error).message).toBe('This page lists several editions or works with the same name, not one book. Search for the one you want.');
    expect(asked).toEqual(['de Die Verwandlung']);
  });

  it('a page that is not there says so', async () => {
    api();
    const e = await wikisourceEpub('沒有這一頁', 'zh').catch((x: unknown) => x);
    expect((e as WikisourceError).code).toBe('missing');
    expect((e as Error).message).toBe('Wikisource has no page with that title. It may have been renamed or deleted.');
  });

  it('a page with only its header and parts not written yet says it has no text', async () => {
    api({
      'en A Work': { parse: {
        title: 'A Work', displaytitle: 'A Work', categories: [], properties: {}, links: [{ ns: 0, title: 'A Work/Chapter 1', exists: false }],
        text: '<div class="mw-parser-output"><div class="ws-header ws-noexport">A Work, by Someone</div><div class="ws-summary"><ul><li><a href="/w/index.php?title=A_Work/Chapter_1&amp;action=edit&amp;redlink=1" class="new" title="A Work/Chapter 1 (page does not exist)">Chapter 1</a></li></ul></div></div>',
      } },
    });
    const e = await wikisourceEpub('A Work', 'en').catch((x: unknown) => x);
    expect((e as WikisourceError).code).toBe('no-text');
    expect(asked).toEqual(['en A Work']);
  });
});

describe('the page’s Content-Security-Policy', () => {
  it('lets the page reach the Wikisource of every language it reads, each by name', () => {
    const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');
    const connect = /connect-src ([^;"]*)/.exec(html)![1].split(' ');
    for (const id of Object.keys(LANGS)) expect(connect).toContain(`https://${id}.wikisource.org`);
    expect(connect.filter((s) => s.includes('*'))).toEqual([]);
  });
});

describe('Find a book’s download of a Wikisource work', () => {
  const marianela = { source: 'wikisource' as const, key: 'Marianela', title: 'Marianela', author: '', also: [] };

  it('asks Wikisource itself, not the sync server, for the file the library keeps it under', async () => {
    api();
    setLangForTests('es');
    const notes: string[] = [];
    const file = await fetchFound(marianela, 'es', undefined, (n) => notes.push(n));
    expect(file.name).toBe('wikisource-es-Marianela.epub');
    expect(file.type).toBe('application/epub+zip');
    expect(asked.every((a) => a.startsWith('es '))).toBe(true);
    expect(notes).toEqual([]);
  });

  it('says why a page is no book in its own words, with its code', async () => {
    api();
    setLangForTests('de');
    const e = await fetchFound({ ...marianela, key: 'Die Verwandlung' }, 'de').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FoundError);
    expect((e as FoundError).code).toBe('list');
    expect((e as Error).message).toMatch(/^This page lists several editions/);
  });

  it('a request with no answer is asked again twice, then says so plainly', async () => {
    const tries = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', tries);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      setLangForTests('es');
      const e = fetchFound(marianela, 'es').catch((x: unknown) => x);
      await vi.runAllTimersAsync();
      expect(((await e) as Error).message).toBe('Could not download the book. Check your connection and try again.');
      expect(tries).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
