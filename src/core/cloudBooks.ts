// Books kept in the sync account, so a device signed in has the owner's books without the Mac or Tailscale. What is kept is
// the book as this app stored it (its chapters and images, packed in a zip), not the file it came from: a device that
// downloads it adds exactly the same book, with the same sync key, so reading places and bookmarks land in it. Each book is
// uploaded by the first device signed in that has it, and downloaded by every other. The classics are not kept (any device
// adds them from the public site). Deleting a book in the Library removes it from the account too; a book from the Mac has no
// Delete, so it stays.
import { strFromU8, strToU8, zipSync } from 'fflate';
import type { Block, BookMeta, Chapter, ImportedBook, Store } from '../types';
import { Archive } from '../import/zip';
import { bytesOf } from '../store';
import { cloudBase, cloudFetch, cloudSession } from './cloud';
import { bookKey, olderKeys } from './syncKeys';

/** The server's piece size (cloud/src/account.ts BOOK_CHUNK). */
export const BOOK_CHUNK = 1024 * 1024;
const UP_KEY = 'dushu.cloud.books-up.v1';
const REMOVED_KEY = 'dushu.cloud.books-removed.v1';
const FORMATS = new Set(['epub', 'txt', 'pdf', 'html', 'md', 'mobi', 'azw3', 'paste', 'sample']);
const SCRIPTS = new Set(['simplified', 'traditional', 'mixed', 'unknown']);

export interface AccountBook { key: string; title: string; author: string; size: number; sha: string; chunks: number; addedAt: number }

function list(key: string): string[] {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function setList(key: string, values: string[]): void {
  try { globalThis.localStorage?.setItem(key, JSON.stringify([...new Set(values)])); } catch { /* tried again next time */ }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Whether two sync keys name the same book (one may be the key an older importer gave it). */
function sameBook(a: string, b: string): boolean {
  return a === b || olderKeys(a).includes(b) || olderKeys(b).includes(a);
}

// ------------------------------------------------------------------ packing ---

/** The stored book as a zip: book.json (its text and details) and its images, a/0, a/1, … */
export async function packBook(store: Store, meta: BookMeta): Promise<Uint8Array> {
  const chapters: Chapter[] = [];
  for (let i = 0; i < meta.chapterCount; i++) {
    const ch = await store.books.chapter(meta.id, i);
    if (!ch) throw new Error(`Chapter ${i + 1} of “${meta.title}” is missing on this device.`);
    chapters.push(ch);
  }
  const names = new Set<string>();
  if (meta.cover) names.add(meta.cover);
  for (const ch of chapters) for (const b of ch.blocks) if (b.t === 'img') names.add(b.asset);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  const assets: string[] = [];
  for (const name of names) {
    const blob = await store.books.asset(meta.id, name);
    if (!blob) continue;
    files[`a/${assets.length}`] = [new Uint8Array(await bytesOf(blob)), { level: 0 }]; // images are compressed already
    assets.push(name);
  }
  const book = {
    v: 1, title: meta.title, author: meta.author, format: meta.format, script: meta.script, cover: meta.cover,
    sourceName: meta.sourceName, note: meta.note, importVersion: meta.importVersion, assets, chapters,
  };
  files['book.json'] = strToU8(JSON.stringify(book));
  return zipSync(files, { level: 6 });
}

function cleanBlock(v: unknown): Block | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Record<string, unknown>;
  if (b.t === 'hr') return { t: 'hr' };
  if (b.t === 'img') return typeof b.asset === 'string' ? { t: 'img', asset: b.asset, ...(typeof b.alt === 'string' ? { alt: b.alt } : {}) } : null;
  if (typeof b.text !== 'string') return null;
  if (b.t === 'p' || b.t === 'quote') return { t: b.t, text: b.text };
  if (b.t === 'h') {
    const level = typeof b.level === 'number' && b.level >= 1 && b.level <= 6 ? Math.round(b.level) as 1 | 2 | 3 | 4 | 5 | 6 : 2;
    return { t: 'h', level, text: b.text };
  }
  return null;
}

/** The book in a package from the account, checked, ready for store.books.add. */
export function unpackBook(bytes: Uint8Array): ImportedBook {
  const zip = new Archive(bytes);
  zip.inflate(['book.json'], { maxBytes: 64 * 1024 * 1024 });
  const raw = zip.get('book.json');
  if (!raw) throw new Error('A book in your account is damaged.');
  const b = JSON.parse(strFromU8(raw)) as Record<string, unknown>;
  if (b.v !== 1 || typeof b.title !== 'string' || !Array.isArray(b.chapters) || !b.chapters.length) throw new Error('A book in your account is damaged.');
  const chapters: Chapter[] = b.chapters.map((c) => {
    const ch = c as Record<string, unknown>;
    const blocks = Array.isArray(ch.blocks) ? ch.blocks.map(cleanBlock).filter((x): x is Block => !!x) : [];
    return { title: typeof ch.title === 'string' ? ch.title : '', blocks, ...(ch.cont === true ? { cont: true as const } : {}) };
  });
  const names = Array.isArray(b.assets) ? b.assets.filter((x): x is string => typeof x === 'string') : [];
  const paths = names.map((_, i) => `a/${i}`);
  zip.inflate(paths, { maxBytes: 32 * 1024 * 1024, skipLarge: true });
  const assets = new Map<string, Blob>();
  names.forEach((name, i) => {
    const data = zip.get(paths[i]);
    if (data) assets.set(name, new Blob([data as Uint8Array<ArrayBuffer>]));
  });
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  return {
    title: b.title, author: str(b.author) ?? '', chapters, assets,
    format: (FORMATS.has(String(b.format)) ? b.format : 'txt') as ImportedBook['format'],
    script: (SCRIPTS.has(String(b.script)) ? b.script : 'unknown') as ImportedBook['script'],
    ...(str(b.cover) ? { cover: str(b.cover) } : {}),
    ...(str(b.sourceName) ? { sourceName: str(b.sourceName) } : {}),
    ...(str(b.note) ? { note: str(b.note) } : {}),
    ...(typeof b.importVersion === 'number' ? { importVersion: b.importVersion } : {}),
  };
}

// ---------------------------------------------------------------- the account ---

async function ok(res: Promise<Response> | null): Promise<Response> {
  if (!res) throw new Error('This device is not signed in.');
  const r = await res;
  if (!r.ok) {
    const why = await r.json().then((x: { error?: unknown }) => x?.error, () => undefined);
    throw new Error(typeof why === 'string' ? why : `The sync server answered ${r.status}.`);
  }
  return r;
}

export async function accountBooks(): Promise<AccountBook[]> {
  const data = await (await ok(cloudFetch('/books', { signal: AbortSignal.timeout(20_000) }))).json() as unknown;
  return Array.isArray(data) ? data.filter((b): b is AccountBook => !!b && typeof b === 'object' && typeof (b as AccountBook).key === 'string') : [];
}

async function upload(key: string, meta: BookMeta, bytes: Uint8Array): Promise<void> {
  const sha = await sha256(bytes);
  const json = { 'Content-Type': 'application/json' };
  await ok(cloudFetch('/books', { method: 'POST', headers: json, body: JSON.stringify({ key, title: meta.title, author: meta.author, size: bytes.byteLength, sha }), signal: AbortSignal.timeout(20_000) }));
  for (let i = 0; i * BOOK_CHUNK < bytes.byteLength; i++) {
    const piece = bytes.slice(i * BOOK_CHUNK, (i + 1) * BOOK_CHUNK);
    await ok(cloudFetch(`/books/chunk?key=${encodeURIComponent(key)}&i=${i}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: piece, signal: AbortSignal.timeout(60_000),
    }));
  }
}

async function download(book: AccountBook): Promise<ImportedBook> {
  const out = new Uint8Array(book.size);
  let at = 0;
  for (let i = 0; i < book.chunks; i++) {
    const r = await ok(cloudFetch(`/books/chunk?key=${encodeURIComponent(book.key)}&i=${i}`, { signal: AbortSignal.timeout(60_000) }));
    const piece = new Uint8Array(await r.arrayBuffer());
    if (at + piece.byteLength > out.byteLength) throw new Error(`“${book.title}” in your account is damaged.`);
    out.set(piece, at);
    at += piece.byteLength;
  }
  if (at !== book.size || await sha256(out) !== book.sha) throw new Error(`“${book.title}” did not download whole. Dushu will try again.`);
  return unpackBook(out);
}

/** Deleted here on purpose: removed from the account too (now, or on the next try), and never downloaded again here. */
export function forgetBookInAccount(meta: BookMeta): void {
  const key = bookKey(meta);
  if (key.startsWith('s')) return;
  setList(REMOVED_KEY, [...list(REMOVED_KEY), key]);
  void cloudFetch(`/books?key=${encodeURIComponent(key)}`, { method: 'DELETE' })?.catch(() => {});
}

/** Fired on window after each run that did something or failed: `{ added: titles, uploaded: titles, error? }` (main.ts says so). */
export const BOOKS_EVENT = 'dushu:account-books';
export interface BooksReport { added: string[]; uploaded: string[]; error?: string }

let running: Promise<{ added: BookMeta[]; uploaded: number }> | null = null;

/**
 * Puts this device's books in the account and the account's books on this device. One at a time; never throws (a failure
 * is tried again on the next call). Resolves with the books it added here and how many it uploaded.
 */
export function syncBooks(store: Store): Promise<{ added: BookMeta[]; uploaded: number }> {
  running ??= (async () => {
    const added: BookMeta[] = [];
    const up: string[] = [];
    let uploaded = 0;
    let error: string | undefined;
    const s = cloudSession();
    if (!s || !cloudBase()) return { added, uploaded };
    try {
      const removed = list(REMOVED_KEY);
      // Removals that did not reach the account before.
      for (const key of removed) await cloudFetch(`/books?key=${encodeURIComponent(key)}`, { method: 'DELETE' })?.catch(() => {});
      const inAccount = await accountBooks();
      const local = await store.books.list();
      const localKeys = local.map((b) => bookKey(b));
      // Up: books here that the account does not have and this device has not put there before (one it did, now missing,
      // was deleted from the account on another device, and stays deleted).
      const marks = list(UP_KEY);
      for (const meta of local) {
        const key = bookKey(meta);
        const mark = `${s.email}|${key}`;
        if (key.startsWith('s') || marks.includes(mark) || inAccount.some((b) => sameBook(b.key, key))) continue;
        await upload(key, meta, await packBook(store, meta));
        marks.push(mark);
        setList(UP_KEY, marks);
        up.push(meta.title);
        uploaded++;
      }
      // Down: books in the account that are not here and were not deleted here.
      for (const book of inAccount) {
        if (localKeys.some((k) => sameBook(k, book.key)) || removed.some((k) => sameBook(k, book.key))) continue;
        const meta = await store.books.add(await download(book));
        setList(UP_KEY, [...list(UP_KEY), `${s.email}|${bookKey(meta)}`]);
        localKeys.push(bookKey(meta));
        added.push(meta);
      }
    } catch (e) {
      console.warn('Dushu: books in your account', e);
      error = e instanceof Error ? e.message : String(e);
    }
    if (added.length || up.length || error) {
      const detail: BooksReport = { added: added.map((m) => m.title), uploaded: up, ...(error ? { error } : {}) };
      try { globalThis.dispatchEvent?.(new CustomEvent(BOOKS_EVENT, { detail })); } catch { /* no window */ }
    }
    return { added, uploaded };
  })().finally(() => { running = null; });
  return running;
}
