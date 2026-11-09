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
