// The owner's books on the Mac. The Mac's bridge lists them with a SHA-256 digest of each file; a device that reaches the
// Mac (the private site, or the public copy once connected) adds any it is missing, in the background, and keeps them.
// A book the person deletes is remembered on that device and offered back with "Restore", never silently re-added.
import type { BookMeta } from '../../types';
import { bridgeFetch, hasMacBridge, isCrossOriginBridge } from '../../core/macBridge';

export interface MacBook { id: string; name: string; size?: number; sha256?: string }

/** none: no Mac to ask. ready: the Mac answered. asleep: connected but no answer. refused: the Mac answered and said no. */
export type MacState = 'none' | 'ready' | 'asleep' | 'refused';
export interface MacListing { state: MacState; books: MacBook[] }

/** Marks a book that came from the Mac: `note` holds this prefix and the file's digest. */
export const MAC_NOTE = 'mac-book:';
const REMOVED_KEY = 'dushu.mac-books.removed.v1';

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** Reads the Mac's book list. Never throws: a Mac that is off is a state, not an error. */
export async function fetchMacBooks(): Promise<MacListing> {
  if (!hasMacBridge()) return { state: 'none', books: [] };
  let response: Response;
  try { response = await bridgeFetch('/api/local-books', { signal: AbortSignal.timeout(6000) }); }
  catch { return { state: isCrossOriginBridge() ? 'asleep' : 'none', books: [] }; }
  if (response.status === 403) return { state: 'refused', books: [] };
  const json: unknown = response.ok && response.headers.get('content-type')?.includes('application/json')
    ? await response.json().catch(() => null) : null;
  if (!Array.isArray(json)) return { state: isCrossOriginBridge() ? 'asleep' : 'none', books: [] };
  const books = json.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && !!text((b as Record<string, unknown>).id) && !!text((b as Record<string, unknown>).name))
    .map((b) => ({ id: text(b.id), name: text(b.name), size: typeof b.size === 'number' ? b.size : undefined, sha256: text(b.sha256) || undefined }));
  return { state: 'ready', books };
}

/** The EPUB itself, as a File named like the original so the importer reads its title and author as usual. */
export async function fetchMacBookFile(item: MacBook): Promise<File> {
  const response = await bridgeFetch(`/api/local-books/${encodeURIComponent(item.id)}`);
  if (!response.ok) throw new Error(`Could not read ${item.name} from your Mac.`);
  return new File([await response.blob()], item.name, { type: 'application/epub+zip' });
}

// ------------------------------------------------------------ removed list ---

export interface RemovedMacBook { name: string; sha256?: string }

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function removedMacBooks(): RemovedMacBook[] {
  try {
    const raw = JSON.parse(storage()?.getItem(REMOVED_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((r): r is RemovedMacBook => !!r && typeof r === 'object' && !!text((r as RemovedMacBook).name)) : [];
  } catch { return []; }
}
function saveRemoved(list: RemovedMacBook[]): void {
  try { storage()?.setItem(REMOVED_KEY, JSON.stringify(list)); } catch { /* storage blocked: the book may come back */ }
}

export const isMacBook = (b: Pick<BookMeta, 'note'>) => !!b.note?.startsWith(MAC_NOTE);
const digestOf = (b: Pick<BookMeta, 'note'>) => (isMacBook(b) ? b.note!.slice(MAC_NOTE.length) : '');

/** Called when the person deletes a book: if it came from the Mac, remember that so it stays gone. */
export function rememberRemoval(book: Pick<BookMeta, 'note' | 'sourceName'>, known: MacBook[] = []): void {
  // A book is the Mac's when it carries the mark, or (just added, mark not written yet) has the name of one the Mac listed.
  const listed = known.find((k) => k.name === book.sourceName);
  if ((!isMacBook(book) && !listed) || !book.sourceName) return;
  const list = removedMacBooks().filter((r) => r.name !== book.sourceName);
  list.push({ name: book.sourceName, sha256: digestOf(book) || listed?.sha256 });
  saveRemoved(list);
}
export function forgetRemoval(name: string): void {
  saveRemoved(removedMacBooks().filter((r) => r.name !== name));
}

const isRemoved = (item: MacBook, removed: RemovedMacBook[]) => removed.some((r) => r.name === item.name || (!!item.sha256 && r.sha256 === item.sha256));

// -------------------------------------------------------------------- sync ---

export interface MacPlan {
  /** Books on the Mac this device does not have and has not been told to leave out. */
  missing: MacBook[];
  /** Books the Mac lists that the person removed on this device. */
  held: MacBook[];
  /** Books already here without the Mac mark (an earlier manual add): mark them so a later delete is remembered. */
  mark: { id: string; note: string }[];
}

/** A book is the same as a Mac book when its digest matches, or (for a copy added by hand) its file name does. */
export function planMacBooks(items: MacBook[], books: BookMeta[], removed: RemovedMacBook[]): MacPlan {
  const plan: MacPlan = { missing: [], held: [], mark: [] };
  for (const item of items) {
    const have = books.find((b) => (!!item.sha256 && digestOf(b) === item.sha256) || b.sourceName === item.name);
    if (have) {
      if (item.sha256 && !have.note) plan.mark.push({ id: have.id, note: MAC_NOTE + item.sha256 });
    } else if (isRemoved(item, removed)) plan.held.push(item);
    else plan.missing.push(item);
  }
  return plan;
}

export interface SyncDeps {
  list(): Promise<BookMeta[]>;
  fetchFile(item: MacBook): Promise<File>;
  /** Imports without a toast per book; resolves to the books that were added. */
  add(files: File[]): Promise<BookMeta[]>;
  update(id: string, patch: Partial<BookMeta>): Promise<void>;
  removed(): RemovedMacBook[];
  forget(name: string): void;
}

export interface SyncResult { added: BookMeta[]; held: MacBook[]; failed: number }

let queue: Promise<unknown> = Promise.resolve();

/** Asks the browser to keep this site's data. Quiet: the answer only matters for how long the books last. */
export function requestPersistence(): void {
  try { void navigator.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
}

/**
 * Adds every book the Mac has that this device lacks. One run at a time per tab, and one per browser where Web Locks exist,
 * so two tabs opening the library together do not add a book twice. `force` (the manual button) also brings back
 * books the person removed.
 */
export function syncMacBooks(items: MacBook[], deps: SyncDeps, force = false): Promise<SyncResult> {
  const body = () => runSync(items, deps, force);
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  // Runs queue behind each other: a later one reads the library after the earlier one finished, so it adds nothing twice.
  const job = queue.then(async (): Promise<SyncResult> => (locks ? await locks.request('dushu-mac-books', async () => await body()) : body()));
  queue = job.catch(() => {});
  return job;
}

async function runSync(items: MacBook[], deps: SyncDeps, force: boolean): Promise<SyncResult> {
  const result: SyncResult = { added: [], held: [], failed: 0 };
  // Read the library inside the lock: another tab may have just added the same book.
  const plan = planMacBooks(items, await deps.list(), force ? [] : deps.removed());
  result.held = plan.held;
  for (const m of plan.mark) await deps.update(m.id, { note: m.note }).catch(() => {});
  if (plan.missing.length) requestPersistence();
  for (const item of plan.missing) {
    try {
      const [meta] = await deps.add([await deps.fetchFile(item)]);
      if (!meta) { result.failed++; continue; }
      if (item.sha256) await deps.update(meta.id, { note: MAC_NOTE + item.sha256 }).catch(() => {});
      deps.forget(item.name);
      result.added.push(meta);
    } catch { result.failed++; }
  }
  return result;
}

/** "Added 活着 and 射雕英雄传 from your Mac." */
export function addedMessage(added: BookMeta[]): string {
  if (added.length === 1) return `Added “${added[0].title}” from your Mac.`;
  if (added.length === 2) return `Added “${added[0].title}” and “${added[1].title}” from your Mac.`;
  return `Added ${added.length} books from your Mac.`;
}
