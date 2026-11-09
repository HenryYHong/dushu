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
