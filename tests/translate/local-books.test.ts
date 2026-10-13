import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { fileDigest, listOwnerBooks, localBooksHandler, ownerBooks } from '../../scripts/local-books';
import { privateGateway } from '../../scripts/private-access';

// Stand-in files with made-up bytes. The owner's real books are never read by a test.
const dir = mkdtempSync(join(tmpdir(), 'dushu-books-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const first = Buffer.from('PK stand-in one '.repeat(5000));
const second = Buffer.from('PK stand-in two '.repeat(3000));
writeFileSync(join(dir, '活着.epub'), first);
writeFileSync(join(dir, '射雕英雄传.epub'), second);

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); delete process.env.DUSHU_EXTRA_ORIGINS; });
async function serve(books = ownerBooks(dir), withGateway = false) {
  const handle = localBooksHandler(books);
  const gateway: ((rq: IncomingMessage, rs: ServerResponse, next: () => void) => void)[] = [];
  if (withGateway) (privateGateway(() => null).configureServer as unknown as (server: unknown) => void)({ middlewares: { use: (fn: never) => gateway.push(fn) } });
  const server = createServer((rq, rs) => {
    const run = () => void handle(rq, rs, () => { rs.writeHead(404).end(); }).catch(() => { rs.writeHead(500).end(); });
    if (gateway.length) gateway[0](rq, rs, run); else run();
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return (method: string, path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>((resolve, reject) => {
    const r = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...headers } }, rs => {
      const chunks: Buffer[] = [];
      rs.on('data', c => chunks.push(c));
      rs.on('end', () => resolve({ status: rs.statusCode ?? 0, headers: rs.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    r.end();
  });
}

describe('the owner\'s books', () => {
  it('are the two EPUBs, read in place from Downloads', () => {
    const books = ownerBooks();
    expect(books.map(b => [b.id, b.name])).toEqual([['huozhe', '活着.epub'], ['shediao', '射雕英雄传.epub']]);
    for (const b of books) expect(b.path).toMatch(/\/Downloads\/[^/]+\.epub$/);
  });

  it('are listed with a SHA-256 of the file bytes, so a device can tell what it already has', async () => {
    const call = await serve();
    const r = await call('GET', '/api/local-books');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(String(r.headers['content-type'])).toContain('application/json');
    expect(JSON.parse(r.body.toString())).toEqual([
      { id: 'huozhe', name: '活着.epub', size: first.length, sha256: sha(first) },
      { id: 'shediao', name: '射雕英雄传.epub', size: second.length, sha256: sha(second) },
    ]);
  });

  it('leave a missing or unreadable file out of the list', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dushu-books-empty-'));
    try {
      writeFileSync(join(empty, '射雕英雄传.epub'), second);
      expect((await listOwnerBooks(ownerBooks(empty))).map(b => b.id)).toEqual(['shediao']);
      expect(await listOwnerBooks(ownerBooks(join(empty, 'nowhere')))).toEqual([]);
    } finally { rmSync(empty, { recursive: true, force: true }); }
  });

  it('are served byte for byte, with their digest in the headers', async () => {
    const call = await serve();
    const r = await call('GET', '/api/local-books/huozhe');
    expect(r.status).toBe(200);
    expect(r.body.equals(first)).toBe(true);
    expect(r.headers['content-type']).toBe('application/epub+zip');
    expect(r.headers['content-length']).toBe(String(first.length));
    expect(r.headers['etag']).toBe(`"${sha(first)}"`);
    expect(r.headers['x-dushu-digest']).toBe(sha(first));
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('serve only these two ids: no paths, no other files, no other methods', async () => {
    const call = await serve();
    for (const path of ['/api/local-books/other', '/api/local-books/../../etc/hosts', '/api/local-books/huozhe/extra', '/api/local-books/%2e%2e%2fsecret', '/api/local-books/']) {
      expect((await call('GET', path)).status).toBe(404);
    }
    expect((await call('POST', '/api/local-books')).status).toBe(405);
    expect((await call('DELETE', '/api/local-books/huozhe')).status).toBe(405);
  });

  it('answer the owner only', async () => {
    const call = await serve();
    expect((await call('GET', '/api/local-books', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('GET', '/api/local-books', { origin: 'https://henryyhong.com' })).status).toBe(403);
    expect((await call('GET', '/api/local-books/huozhe', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await call('GET', '/api/local-books', { host: 'evil.ts.net:8443', 'tailscale-user-login': 'owner@example.com' })).status).toBe(403);
  });

  it('reach an allowed test origin with CORS headers that expose the digest', async () => {
    process.env.DUSHU_EXTRA_ORIGINS = 'http://localhost:5241';
    const call = await serve(ownerBooks(dir), true);
    const list = await call('GET', '/api/local-books', { origin: 'http://localhost:5241' });
    expect(list.status).toBe(200);
    expect(list.headers['access-control-allow-origin']).toBe('http://localhost:5241');
    expect(list.headers['access-control-allow-credentials']).toBeUndefined();
    expect(list.headers['vary']).toContain('Origin');
    const book = await call('GET', '/api/local-books/shediao', { origin: 'http://localhost:5241' });
    expect(book.body.equals(second)).toBe(true);
    expect(String(book.headers['access-control-expose-headers'])).toMatch(/ETag.*X-Dushu-Digest/);
    const pre = await call('OPTIONS', '/api/local-books', { origin: 'http://localhost:5241', 'access-control-request-method': 'GET' });
    expect(pre.status).toBe(204);
    expect((await call('GET', '/api/local-books', { origin: 'http://localhost:5299' })).status).toBe(403);
  });
});

describe('digests', () => {
  it('are remembered until the file changes', async () => {
    const path = join(dir, 'changing.epub');
    writeFileSync(path, 'one');
    const a = await fileDigest(path);
    expect(a.sha256).toBe(sha(Buffer.from('one')));
    expect(await fileDigest(path)).toBe(a);
    writeFileSync(path, 'two!');
    utimesSync(path, new Date(2030, 0, 1), new Date(2030, 0, 1));
    const b = await fileDigest(path);
    expect(b.sha256).toBe(sha(Buffer.from('two!')));
    expect(b.size).toBe(4);
  });
});
