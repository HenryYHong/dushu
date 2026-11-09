// Books from Project Gutenberg through the Worker (cloud/src/worker.ts gutenbergBook): only a book number, only for Globereader's
// own pages, only gutenberg.org, and only an EPUB comes back. Gutenberg is played by a stub; nothing goes over the network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloud } from './helpers';

const EPUB: Uint8Array<ArrayBuffer> = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
afterEach(() => vi.unstubAllGlobals());

function gutenberg(files: Record<string, Uint8Array<ArrayBuffer> | string>) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    const body = files[url.split('/').pop()!];
    return body === undefined ? new Response('Not found', { status: 404 }) : new Response(body, { status: 200 });
  }));
  return asked;
}

describe('books from Project Gutenberg', () => {
  it('brings the EPUB with pictures, else the plain one', async () => {
    const c = cloud();
    const asked = gutenberg({ 'pg2000.epub': EPUB });
    const res = await c.call('/gutenberg/2000');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/epub+zip');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://henryyhong.com');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(EPUB);
    expect(asked).toEqual([
      'https://www.gutenberg.org/cache/epub/2000/pg2000-images-3.epub',
      'https://www.gutenberg.org/cache/epub/2000/pg2000-images.epub',
      'https://www.gutenberg.org/cache/epub/2000/pg2000.epub',
    ]);
  });

  it('refuses other pages, other paths, and anything that is not an EPUB', async () => {
    const c = cloud();
    const asked = gutenberg({ 'pg7-images-3.epub': '<html>Sorry</html>', 'pg7.epub': '<html>Sorry</html>' });
    expect((await c.call('/gutenberg/2000', { origin: 'https://example.com' })).status).toBe(403);
    expect((await c.call('/gutenberg/0')).status).toBe(404);
    expect((await c.call('/gutenberg/12a')).status).toBe(404);
    expect((await c.call('/gutenberg/..%2Fetc')).status).toBe(404);
    expect((await c.call('/gutenberg/7')).status).toBe(404);
    expect(asked.every((u) => u.startsWith('https://www.gutenberg.org/cache/epub/7/'))).toBe(true);
  });
});

describe('works from Wikisource', () => {
  it('brings a work in a reading language as ws-export makes it, and nothing else', async () => {
    const c = cloud();
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      asked.push(url);
      return url.startsWith('https://ws-export.wmcloud.org/') ? new Response(EPUB, { status: 200 }) : new Response('no', { status: 404 });
    }));
    const res = await c.call(`/wikisource/zh/${encodeURIComponent('阿Q正傳')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/epub+zip');
    expect(asked).toEqual([`https://ws-export.wmcloud.org/?format=epub&lang=zh&page=${encodeURIComponent('阿Q正傳')}`]);
    // Spaces become underscores, as Wikisource writes its page names.
    await c.call(`/wikisource/fr/${encodeURIComponent('Le Horla')}`);
    expect(asked[1]).toBe('https://ws-export.wmcloud.org/?format=epub&lang=fr&page=Le_Horla');
    // Another language, another host, a broken name, another page: refused before anything is fetched.
    for (const path of ['/wikisource/ko/x', '/wikisource/zh/', `/wikisource/zh/${'a'.repeat(201)}`, '/wikisource/zh/%E0%A4%A', `/wikisource/zh/${encodeURIComponent('a|b')}`]) {
      expect([400, 404]).toContain((await c.call(path)).status);
    }
    expect((await c.call('/wikisource/zh/x', { origin: 'https://example.com' })).status).toBe(403);
    expect(asked).toHaveLength(2);
  });
});

describe('works from Aozora Bunko', () => {
  it('brings a work page by its card and file, and only a page of the library', async () => {
    const c = cloud();
    const asked: string[] = [];
    const work = new TextEncoder().encode('<?xml version="1.0" encoding="Shift_JIS"?><html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="DC.Publisher" content="x"/></head><body/></html>');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      asked.push(url);
      return url.endsWith('752_14964.html') ? new Response(work, { status: 200 }) : new Response('<html><body>Not found</body></html>', { status: 200 });
    }));
    const res = await c.call('/aozora/000148/752_14964.html');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html');
    expect(asked).toEqual(['https://www.aozora.gr.jp/cards/000148/files/752_14964.html']);
    // A page that is not one of its works is no book.
    expect((await c.call('/aozora/000148/1_1.html')).status).toBe(404);
    for (const path of ['/aozora/148/752_14964.html', '/aozora/000148/../x.html', '/aozora/000148/752_14964.txt', '/aozora/000148/a_b.html']) {
      expect((await c.call(path)).status).toBe(404);
    }
    expect((await c.call('/aozora/000148/752_14964.html', { origin: 'https://example.com' })).status).toBe(403);
    expect(asked).toHaveLength(2);
  });
});

describe('the book relay', () => {
  it('stops reading a book that grows past the limit, with or without a length', async () => {
    const c = cloud();
    const big = () => new ReadableStream<Uint8Array>({
      start(ctl) { ctl.enqueue(new Uint8Array([0x50, 0x4b, 3, 4])); for (let i = 0; i < 41; i++) ctl.enqueue(new Uint8Array(1024 * 1024)); ctl.close(); },
    });
    let pulled = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { pulled++; return new Response(big(), { status: 200 }); }));
    expect((await c.call('/wikisource/en/Huge')).status).toBe(413);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 200, headers: { 'Content-Length': String(50 * 1024 * 1024) } })));
    expect((await c.call('/gutenberg/12')).status).toBe(413);
    expect(pulled).toBe(1);
  });

  it('takes a Tailscale page only when it is the owner’s, once that is set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EPUB, { status: 200 })));
    const open = cloud();
    expect((await open.call('/gutenberg/12', { origin: 'https://box.tail1234.ts.net' })).status).toBe(200);
    const pinned = cloud({ BOOK_ORIGINS: 'https://my-mac.tail9999.ts.net:8443' });
    expect((await pinned.call('/gutenberg/12', { origin: 'https://box.tail1234.ts.net' })).status).toBe(403);
    expect((await pinned.call('/gutenberg/12', { origin: 'https://my-mac.tail9999.ts.net:8443' })).status).toBe(200);
    expect((await pinned.call('/gutenberg/12', { origin: 'https://henryyhong.com' })).status).toBe(200);
  });
});
