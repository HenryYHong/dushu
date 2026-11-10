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
    // A page instead of an EPUB is no book, and not a sure "Gutenberg has none" either.
    expect((await c.call('/gutenberg/7')).status).toBe(502);
    expect(asked.every((u) => u.startsWith('https://www.gutenberg.org/cache/epub/7/'))).toBe(true);
  });
});

/** The Worker's cache, in memory. */
function memoryCache() {
  const kept = new Map<string, Response>();
  vi.stubGlobal('caches', {
    default: {
      match: async (k: Request) => kept.get(k.url)?.clone(),
      put: async (k: Request, r: Response) => { kept.set(k.url, r.clone()); },
    },
  });
  return kept;
}

/** Gutenberg with files of a given size: `length` is what it says, `size` what it sends (0: a small EPUB). */
function gutenbergSized(files: Record<string, { length?: number; size?: number }>) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(`${init?.method ?? 'GET'} ${url.split('/').pop()}`);
    const f = files[url.split('/').pop()!];
    if (!f) return new Response('Not found', { status: 404 });
    const headers: Record<string, string> = f.length ? { 'Content-Length': String(f.length) } : {};
    if (init?.method === 'HEAD') return new Response(null, { status: 200, headers });
    const body = f.size
      ? new ReadableStream<Uint8Array>({ start(ctl) { ctl.enqueue(EPUB.slice(0, 4)); for (let i = 0; i < f.size! / (1024 * 1024); i++) ctl.enqueue(new Uint8Array(1024 * 1024)); ctl.close(); } })
      : EPUB;
    return new Response(body, { status: 200, headers });
  }));
  return asked;
}

describe('Gutenberg books that cannot be added', () => {
  it('says whether a book has an EPUB, by HEAD, once a week, without counting it as a book', async () => {
    const c = cloud();
    const kept = memoryCache();
    const asked = gutenbergSized({ 'pg19681.epub': {} });
    const check = async (id: number, ip = '203.0.113.9') => {
      const res = await c.call(`/gutenberg/${id}?check`, { headers: { 'CF-Connecting-IP': ip } });
      return [res.status, await res.json()];
    };
    // A recording with a text after all (Детство), and one with none.
    expect(await check(19681)).toEqual([200, { epub: true }]);
    expect(await check(21183)).toEqual([200, { epub: false }]);
    expect(asked).toEqual([
      'HEAD pg19681-images-3.epub', 'HEAD pg19681-images.epub', 'HEAD pg19681.epub',
      'HEAD pg21183-images-3.epub', 'HEAD pg21183-images.epub', 'HEAD pg21183.epub',
    ]);
    // Asked again: the cache answers, Gutenberg is not asked.
    expect(await check(21183)).toEqual([200, { epub: false }]);
    expect(asked).toHaveLength(6);
    expect(kept.has('https://gutenberg.books/21183.check')).toBe(true);
    // Not from another page.
    expect((await c.call('/gutenberg/2000?check', { origin: 'https://example.com' })).status).toBe(403);
    // Checks are not books: a network that asked about as many books as it may add in a day can still add one.
    for (let i = 0; i < 200; i++) {
      kept.clear();
      expect(await check(19681)).toEqual([200, { epub: true }]);
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EPUB, { status: 200 })));
    expect((await c.call('/gutenberg/19681', { headers: { 'CF-Connecting-IP': '203.0.113.9' } })).status).toBe(200);
  });

  it('answers no-epub for a book with none, remembers it, and does not count it', async () => {
    const c = cloud();
    memoryCache();
    const asked = gutenbergSized({});
    const res = await c.call('/gutenberg/21144', { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Project Gutenberg has no text of this book to read. It is probably an audiobook.', code: 'no-epub' });
    expect(asked).toHaveLength(3);
    // Tapped again: answered from the cache, Gutenberg not asked.
    const again = await c.call('/gutenberg/21144', { headers: { 'CF-Connecting-IP': '203.0.113.9' } });
    expect([again.status, (await again.json() as { code?: string }).code]).toEqual([404, 'no-epub']);
    expect(asked).toHaveLength(3);
    // The check route knows it too.
    expect(await (await c.call('/gutenberg/21144?check')).json()).toEqual({ epub: false });
    expect(asked).toHaveLength(3);
  });

  it('a failure on Gutenberg’s side is not remembered as "none"', async () => {
    const c = cloud();
    const kept = memoryCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('busy', { status: 503 })));
    expect((await c.call('/gutenberg/2000')).status).toBe(502);
    expect((await c.call('/gutenberg/2000?check')).status).toBe(502);
    expect(kept.size).toBe(0);
  });
});

describe('a Gutenberg book too large with its pictures', () => {
  it('comes as the plain EPUB when the one with pictures says it is too large', async () => {
    const c = cloud();
    const asked = gutenbergSized({ 'pg100-images-3.epub': { length: 50 * 1024 * 1024 }, 'pg100-images.epub': { length: 50 * 1024 * 1024 }, 'pg100.epub': {} });
    const res = await c.call('/gutenberg/100');
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(EPUB);
    // Straight to the plain one: -images.epub has the same pictures.
    expect(asked).toEqual(['GET pg100-images-3.epub', 'GET pg100.epub']);
  });

  it('and when it grows past the limit with no length given', async () => {
    const c = cloud();
    const asked = gutenbergSized({ 'pg101-images-3.epub': { size: 41 * 1024 * 1024 }, 'pg101.epub': {} });
    const res = await c.call('/gutenberg/101');
    expect(res.status).toBe(200);
    expect(asked).toEqual(['GET pg101-images-3.epub', 'GET pg101.epub']);
  });

  it('is refused as too large only when every file is', async () => {
    const c = cloud();
    gutenbergSized({ 'pg102-images-3.epub': { length: 50 * 1024 * 1024 }, 'pg102.epub': { length: 45 * 1024 * 1024 } });
    const res = await c.call('/gutenberg/102');
    expect([res.status, (await res.json() as { error: string }).error]).toEqual([413, 'That book is too large to add.']);
    // Too large with pictures and no plain file: still too large, never "no EPUB".
    gutenbergSized({ 'pg103-images-3.epub': { length: 50 * 1024 * 1024 } });
    expect((await c.call('/gutenberg/103')).status).toBe(413);
  });
});

describe('books a network may add in a day', () => {
  it('refuses the one past the limit from the same network', async () => {
    const c = cloud();
    const add = (ip: string, id = 2000) => c.call(`/gutenberg/${id}`, { headers: { 'CF-Connecting-IP': ip } });
    // Books Gutenberg has no EPUB of are not counted.
    gutenbergSized({});
    for (let i = 0; i < 5; i++) expect((await add('198.51.100.7', 21144)).status).toBe(404);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(EPUB, { status: 200 })));
    for (let i = 0; i < 200; i++) expect((await add('198.51.100.7')).status).toBe(200);
    const over = await add('198.51.100.7');
    expect([over.status, (await over.json() as { error: string }).error]).toEqual([429, 'Too many books were added from this network today. Try again tomorrow.']);
    // Another network is not held to it.
    expect((await add('192.0.2.44')).status).toBe(200);
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
