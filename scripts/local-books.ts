// The owner's two EPUBs, read in place from ~/Downloads and served only to the owner's devices through the bridge.
// They are never copied into the repo, the build or the public site. The list carries a SHA-256 digest of each file's
// bytes so a device can tell what it already has without downloading it.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { bridgeRequest } from './private-access';

export interface OwnerBook { id: string; name: string; path: string }
export function ownerBooks(dir = join(homedir(), 'Downloads')): OwnerBook[] {
  return [
    { id: 'huozhe', name: '活着.epub', path: join(dir, '活着.epub') },
    { id: 'shediao', name: '射雕英雄传.epub', path: join(dir, '射雕英雄传.epub') },
  ];
}

const digests = new Map<string, { size: number; mtimeMs: number; sha256: string }>();
/** SHA-256 of the file, remembered until its size or modification time changes. */
export async function fileDigest(path: string): Promise<{ size: number; mtimeMs: number; sha256: string }> {
  const stat = statSync(path);
  const have = digests.get(path);
  if (have && have.size === stat.size && have.mtimeMs === stat.mtimeMs) return have;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  const entry = { size: stat.size, mtimeMs: stat.mtimeMs, sha256: hash.digest('hex') };
  digests.set(path, entry);
  return entry;
}

export async function listOwnerBooks(books: OwnerBook[]): Promise<{ id: string; name: string; size: number; sha256: string }[]> {
  const out: { id: string; name: string; size: number; sha256: string }[] = [];
  for (const book of books) {
    if (!existsSync(book.path)) continue;
    try { const d = await fileDigest(book.path); out.push({ id: book.id, name: book.name, size: d.size, sha256: d.sha256 }); } catch { /* unreadable: leave it out */ }
  }
  return out;
}

export function localBooksHandler(books: OwnerBook[] = ownerBooks()) {
  return async function handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    const route = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (route !== '/api/local-books' && !route.startsWith('/api/local-books/')) { next(); return; }
    if (!bridgeRequest(req)) { res.writeHead(403).end(); return; }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    res.setHeader('Cache-Control', 'no-store');
    if (route === '/api/local-books') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(await listOwnerBooks(books)));
      return;
    }
    const book = books.find(b => route === `/api/local-books/${b.id}`);
    if (!book || !existsSync(book.path)) { res.writeHead(404).end(); return; }
    const { size, sha256 } = await fileDigest(book.path);
    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Length', size);
    res.setHeader('ETag', `"${sha256}"`);
    res.setHeader('X-Dushu-Digest', sha256);
    createReadStream(book.path).on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); }).pipe(res);
  };
}

export function requestedLocalBooks(): Plugin {
  const handle = localBooksHandler();
  const install = (server: any) => { server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    void handle(req, res, next).catch(() => { if (!res.headersSent) res.writeHead(500); if (!res.writableEnded) res.end(); });
  }); };
  return { name: 'dushu-requested-local-books', configureServer: install, configurePreviewServer: install };
}
