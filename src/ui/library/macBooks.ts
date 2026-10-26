// The owner's books on the Mac. The Mac's bridge lists them with a SHA-256 digest of each file; a device that reaches the
// Mac (the private site, or the public copy once connected) adds any it is missing, in the background, and keeps them.
// They are always there: the library offers no Delete for them, and one that went missing anyway (storage cleared by the
// browser, Delete all data) is added again the next time the device reaches the Mac.
import type { BookMeta } from '../../types';
import { bridgeFetch, hasMacBridge, isCrossOriginBridge } from '../../core/macBridge';

export interface MacBook { id: string; name: string; size?: number; sha256?: string }

/** none: no Mac to ask. ready: the Mac answered. asleep: connected but no answer. refused: the Mac answered and said no. */
export type MacState = 'none' | 'ready' | 'asleep' | 'refused';
export interface MacListing { state: MacState; books: MacBook[] }

/** Marks a book that came from the Mac: `note` holds this prefix and the file's digest. */
export const MAC_NOTE = 'mac-book:';
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

/** Earlier versions kept a list of the Mac's books deleted on this device and left them out. */
const REMOVED_KEY = 'dushu.mac-books.removed.v1';
export function forgetRemovedList(): void {
  try { globalThis.localStorage?.removeItem(REMOVED_KEY); } catch { /* storage blocked */ }
}

export const isMacBook = (b: Pick<BookMeta, 'note'>) => !!b.note?.startsWith(MAC_NOTE);
const digestOf = (b: Pick<BookMeta, 'note'>) => (isMacBook(b) ? b.note!.slice(MAC_NOTE.length) : '');

/** The Mac's copy of a book here, by digest or (a copy added by hand, a file the Mac has since changed) by file name. */
export function macItemFor(b: Pick<BookMeta, 'note' | 'sourceName'>, items: MacBook[]): MacBook | undefined {
  const digest = digestOf(b);
  return (digest ? items.find((m) => m.sha256 === digest) : undefined) ?? items.find((m) => m.name === b.sourceName);
}

// -------------------------------------------------------------------- sync ---

export interface MacPlan {
  /** Books on the Mac this device does not have. */
  missing: MacBook[];
  /** Books already here without the Mac mark (an earlier manual add): mark them, so they count as the Mac's. */
  mark: { id: string; note: string }[];
}

/** A book is the same as a Mac book when its digest matches, or (for a copy added by hand) its file name does. */
export function planMacBooks(items: MacBook[], books: BookMeta[]): MacPlan {
  const plan: MacPlan = { missing: [], mark: [] };
  for (const item of items) {
    const have = books.find((b) => (!!item.sha256 && digestOf(b) === item.sha256) || b.sourceName === item.name);
    if (have) {
      if (item.sha256 && !have.note) plan.mark.push({ id: have.id, note: MAC_NOTE + item.sha256 });
    } else plan.missing.push(item);
  }
  return plan;
}

export interface SyncDeps {
  list(): Promise<BookMeta[]>;
  fetchFile(item: MacBook): Promise<File>;
  /** Imports without a toast per book; resolves to the books that were added. */
  add(files: File[]): Promise<BookMeta[]>;
  update(id: string, patch: Partial<BookMeta>): Promise<void>;
}

export interface SyncResult { added: BookMeta[]; failed: number }

let queue: Promise<unknown> = Promise.resolve();

/** Asks the browser to keep this site's data. Quiet: the answer only matters for how long the books last. */
export function requestPersistence(): void {
  try { void navigator.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
}

/**
 * Adds every book the Mac has that this device lacks. One run at a time per tab, and one per browser where Web Locks exist,
 * so two tabs opening the library together do not add a book twice.
 */
export function syncMacBooks(items: MacBook[], deps: SyncDeps): Promise<SyncResult> {
  const body = () => runSync(items, deps);
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  // Runs queue behind each other: a later one reads the library after the earlier one finished, so it adds nothing twice.
  const job = queue.then(async (): Promise<SyncResult> => (locks ? await locks.request('dushu-mac-books', async () => await body()) : body()));
  queue = job.catch(() => {});
  return job;
}

async function runSync(items: MacBook[], deps: SyncDeps): Promise<SyncResult> {
  const result: SyncResult = { added: [], failed: 0 };
  // Read the library inside the lock: another tab may have just added the same book.
  const plan = planMacBooks(items, await deps.list());
  for (const m of plan.mark) await deps.update(m.id, { note: m.note }).catch(() => {});
  if (plan.missing.length) requestPersistence();
  for (const item of plan.missing) {
    try {
      const [meta] = await deps.add([await deps.fetchFile(item)]);
      if (!meta) { result.failed++; continue; }
      if (item.sha256) await deps.update(meta.id, { note: MAC_NOTE + item.sha256 }).catch(() => {});
      result.added.push(meta);
    } catch { result.failed++; }
  }
  return result;
}

/** "Added 活着 and 射雕英雄传 from your Mac." */
export function addedMessage(added: BookMeta[], shown: (title: string) => string = (t) => t): string {
  if (added.length === 1) return `Added “${shown(added[0].title)}” from your Mac.`;
  if (added.length === 2) return `Added “${shown(added[0].title)}” and “${shown(added[1].title)}” from your Mac.`;
  return `Added ${added.length} books from your Mac.`;
}
