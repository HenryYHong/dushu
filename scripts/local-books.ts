// The owner's books, read in place and served only to the owner's devices through the bridge: the two EPUBs in ~/Downloads,
// and every book in ~/Downloads/Dushu Books (the drop folder: a book put there shows up on the owner's devices and goes up
// to their account). They are never copied into the repo, the build or the public site. The list carries a SHA-256 digest
// of each file's bytes so a device can tell what it already has without downloading it.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { bridgeRequest } from './private-access';
import { startAccountBooks } from './account-books';

export interface OwnerBook { id: string; name: string; path: string }

/** The drop folder, inside ~/Downloads (the Mac's server can read Downloads when it starts at login). */
export const DROP_FOLDER = 'Dushu Books';
const BOOK_TYPES: Record<string, string> = {
  '.epub': 'application/epub+zip', '.mobi': 'application/x-mobipocket-ebook', '.azw3': 'application/vnd.amazon.ebook',
  '.azw': 'application/vnd.amazon.ebook', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};

/** The books in the drop folder, by file name; the id is a hash of the name, so it is the same on every request. */
export function folderBooks(folder: string): OwnerBook[] {
  let names: string[];
  try { names = readdirSync(folder); } catch { return []; }
  return names.filter((n) => !n.startsWith('.') && BOOK_TYPES[extname(n).toLowerCase()]).sort()
    .map((n) => ({ id: 'f-' + createHash('sha1').update(n).digest('hex').slice(0, 16), name: n, path: join(folder, n) }));
}

export function ownerBooks(dir = join(homedir(), 'Downloads')): OwnerBook[] {
  return [
    { id: 'huozhe', name: '活着.epub', path: join(dir, '活着.epub') },
    { id: 'shediao', name: '射雕英雄传.epub', path: join(dir, '射雕英雄传.epub') },
    ...folderBooks(join(dir, DROP_FOLDER)),
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

/** The bridge's book routes. The list is read again on each request, so a book dropped in the folder shows up without a restart. */
export function localBooksHandler(list: OwnerBook[] | (() => OwnerBook[]) = () => ownerBooks()) {
  return async function handle(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
    const route = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (route !== '/api/local-books' && !route.startsWith('/api/local-books/')) { next(); return; }
    const books = typeof list === 'function' ? list() : list;
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
    res.setHeader('Content-Type', BOOK_TYPES[extname(book.path).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', size);
    res.setHeader('ETag', `"${sha256}"`);
    res.setHeader('X-Dushu-Digest', sha256);
    createReadStream(book.path).on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); }).pipe(res);
  };
}

export function requestedLocalBooks(): Plugin {
  const handle = localBooksHandler();
  // The Mac's own server (start-local.mjs says so) also puts these books in the owner's account (account-books.ts). A server a
  // test or QA script starts never does, even with a sync folder of its own.
  let stop: (() => void) | null = null;
  const sendToAccount = () => {
    if (process.env.DUSHU_ACCOUNT_BOOKS === '1') stop ??= startAccountBooks(process.env.DUSHU_SYNC_DIR);
  };
  const install = (server: any) => { server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    void handle(req, res, next).catch(() => { if (!res.headersSent) res.writeHead(500); if (!res.writableEnded) res.end(); });
  }); };
  return {
    name: 'dushu-requested-local-books',
    configureServer: (server: any) => { install(server); sendToAccount(); },
    configurePreviewServer: (server: any) => { install(server); sendToAccount(); },
  };
}
