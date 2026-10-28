// The owner's Mac puts its books (local-books.ts: the two EPUBs and the book folder) in the owner's sync account by itself, so
// they reach every device signed in to the account without any device having to reach the Mac. It signs in with its key
// (~/.config/dushu/mac-key, the same as the sync server's MAC_KEY secret) and keeps that session next to the sync folder.
// Each book goes up as the file itself, under the key a device gives the same file from the Mac (core/syncKeys bookKey), and
// a device reads it as an import when it comes down (core/cloudBooks). Each book is sent once per account: one deleted from
// the account on purpose is not sent again.
import { chmodSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CLOUD_URL } from '../src/core/cloud';
import { bookKey, olderKeys } from '../src/core/syncKeys';
import { IMPORT_VERSION } from '../src/import/version';
import { DROP_FOLDER, fileDigest, ownerBooks, type OwnerBook } from './local-books';

const CHUNK = 1024 * 1024;
type Fetch = typeof fetch;

export interface AccountBooksOptions {
  /** Where the session and the list of books sent are kept (.dushu-local). */
  stateDir: string;
  books: () => OwnerBook[];
  macKey: () => string | null;
  base?: string;
  fetchFn?: Fetch;
}

interface Session { token: string; email: string; created?: string }

/** The key a device gives this file when it adds it from the Mac: the file's digest, and the importer's version. */
export function macBookKey(sha256: string): string {
  return bookKey({ note: `mac-book:${sha256}`, importVersion: IMPORT_VERSION, title: '', chapterCount: 0, charCount: 0 });
}

const sameBook = (a: string, b: string) => a === b || olderKeys(a).includes(b) || olderKeys(b).includes(a);

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return fallback; }
}
function writePrivate(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Sends the Mac's books the account lacks. Resolves with the names it sent; does nothing without a Mac key. Throws when the
 * sync server cannot be reached or refuses (the caller tries again later).
 */
export async function sendMacBooks(opts: AccountBooksOptions): Promise<string[]> {
  const key = opts.macKey();
  if (!key) return [];
  const base = opts.base ?? CLOUD_URL;
  const fetchFn = opts.fetchFn ?? fetch;
  const sessionPath = join(opts.stateDir, 'cloud-session.json');
  const sentPath = join(opts.stateDir, 'account-books.json');

  let session = readJson<Session | null>(sessionPath, null);
  const signIn = async (): Promise<Session> => {
    const res = await fetchFn(`${base}/auth/mac`, { method: 'POST', headers: { Authorization: `MacKey ${key}` } });
    if (!res.ok) throw new Error(`the sync server did not sign in this Mac (${res.status})`);
    const s = await res.json() as Session;
    writePrivate(sessionPath, s);
    return s;
  };
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    session ??= await signIn();
    const go = () => fetchFn(`${base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${session!.token}` } });
    let res = await go();
    // Signed out (the session went idle, or the account was made again): sign in once more.
    if (res.status === 401) { session = await signIn(); res = await go(); }
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res;
  };

  const inAccount = (await (await call('/books')).json() as { key: string }[]).map((b) => b.key);
  // Books sent before, per account (an account deleted and made again has a new `created`).
  const sentAll = readJson<Record<string, string[]>>(sentPath, {});
  const account = session!.created ?? session!.email;
  const sent = sentAll[account] ?? [];
  const names: string[] = [];
  for (const book of opts.books()) {
    if (!existsSync(book.path)) continue;
    const { size, sha256 } = await fileDigest(book.path);
    const bookKeyed = macBookKey(sha256);
    if (sent.includes(bookKeyed) || inAccount.some((k) => sameBook(k, bookKeyed))) continue;
    const start = await (await call('/books', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // The title is the file's name: a device reads the real title from the file, and uses the name for its format.
      body: JSON.stringify({ key: bookKeyed, title: book.name, author: '', size, sha: sha256 }),
    })).json() as { chunks: number; upload?: string; complete?: boolean };
    if (!start.complete) {
      const bytes = readFileSync(book.path);
      const u = start.upload ? `&u=${encodeURIComponent(start.upload)}` : '';
      for (let i = 0; i * CHUNK < bytes.byteLength; i++) {
        await call(`/books/chunk?key=${encodeURIComponent(bookKeyed)}&i=${i}${u}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes.subarray(i * CHUNK, (i + 1) * CHUNK),
        });
      }
    }
    sent.push(bookKeyed);
    writePrivate(sentPath, { ...sentAll, [account]: sent });
    names.push(book.name);
  }
  return names;
}

/** The Mac's key, when this Mac has one. */
export function macKeyFile(path = join(homedir(), '.config', 'dushu', 'mac-key')): () => string | null {
  return () => {
    try { const k = readFileSync(path, 'utf8').trim(); return k.length >= 32 ? k : null; } catch { return null; }
  };
}

/**
 * Keeps the account up to date while the Mac's server runs: soon after it starts, when the book folder changes, and every
 * ten minutes. Only the Mac's own server runs it (local-books.ts, when start-local.mjs sets DUSHU_ACCOUNT_BOOKS).
 */
export function startAccountBooks(syncDir: string | undefined, log: (line: string) => void = console.log): () => void {
  if (!syncDir) return () => {};
  const opts: AccountBooksOptions = { stateDir: dirname(syncDir), books: () => ownerBooks(), macKey: macKeyFile() };
  let running = false;
  let told = '';
  const run = async () => {
    if (running || !opts.macKey()) return;
    running = true;
    try {
      const names = await sendMacBooks(opts);
      if (names.length) log(`Dushu: put ${names.length} book${names.length === 1 ? '' : 's'} in your account: ${names.join(', ')}`);
      told = '';
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (why !== told) log(`Dushu: could not put the Mac's books in your account (${why}); trying again later.`);
      told = why;
    } finally { running = false; }
  };
  const first = setTimeout(run, 5000);
  const every = setInterval(run, 10 * 60_000);
  let soon: ReturnType<typeof setTimeout> | undefined;
  let watcher: ReturnType<typeof watch> | undefined;
  try {
    const folder = join(homedir(), 'Downloads', DROP_FOLDER);
    if (existsSync(folder)) watcher = watch(folder, () => { clearTimeout(soon); soon = setTimeout(run, 3000); });
  } catch { /* no watching: the ten-minute round still runs */ }
  return () => { clearTimeout(first); clearInterval(every); clearTimeout(soon); watcher?.close(); };
}
