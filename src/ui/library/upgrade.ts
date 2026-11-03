// Books made by an older importer (BookMeta.importVersion below IMPORT_VERSION) are imported again when the library can
// fetch them: the Mac's books from the Mac (or, on a device that cannot reach it, from the sync account, where the Mac puts
// each of its files), the classics from the site. The new chapters replace the stored ones under the
// same id, with the same name, notes and history, and the reading place moved to the same character (store.books.replace).
// A book added from a file is left as it is: the file is not kept.
import type { BookMeta, ImportedBook } from '../../types';
import { IMPORT_VERSION } from '../../import/version';
import { isMacBook, macItemFor, type MacBook } from './macBooks';
import { sampleSourceName, type Sample } from './samples';

export interface UpgradeDeps {
  books(): Promise<BookMeta[]>;
  /** What the Mac lists now ([] when it did not answer). */
  macItems: MacBook[];
  samples: Sample[];
  fetchMacFile(item: MacBook): Promise<File>;
  /** The Mac's book as the Mac put it in the sync account, or null (not signed in, or not there). */
  fetchAccountFile?(b: BookMeta): Promise<File | null>;
  importFile(file: File): Promise<ImportedBook>;
  importSample(s: Sample): Promise<ImportedBook>;
  replace(id: string, book: ImportedBook): Promise<unknown>;
  /** False once the library is closed: the reader may open a book, so nothing is replaced after that. */
  alive(): boolean;
}

export const needsUpgrade = (b: Pick<BookMeta, 'importVersion'>) => (b.importVersion ?? 1) < IMPORT_VERSION;

/**
 * Books whose file from the sync account did not import, by their Mac mark, with when: not downloaded again for a day (the
 * library opens many times a day, and the file can be megabytes). One that did not come down whole waits in cloudBooks.
 */
const FAILED_KEY = 'dushu.upgrade.account-failed.v1';
const RETRY_MS = 86_400_000;
function failedAt(): Record<string, number> {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(FAILED_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, number> : {};
  } catch { return {}; }
}
function setFailed(note: string, at: number | null): void {
  const all = failedAt();
  if (at === null) delete all[note]; else all[note] = at;
  try { globalThis.localStorage?.setItem(FAILED_KEY, JSON.stringify(all)); } catch { /* tried again next time */ }
}

let running: Promise<number> | null = null;

/** Imports again, one at a time, the old books that can be fetched now. Resolves to how many were replaced. */
export function upgradeBooks(deps: UpgradeDeps): Promise<number> {
  // One pass at a time: the library opening twice must not import a book twice.
  return (running ??= run(deps).finally(() => { running = null; }));
}

async function run(deps: UpgradeDeps): Promise<number> {
  let done = 0;
  for (const b of await deps.books()) {
    if (!deps.alive()) break;
    if (!needsUpgrade(b)) continue;
    try {
      let book: ImportedBook | null = null;
      const item = isMacBook(b) || b.sourceName ? macItemFor(b, deps.macItems) : undefined;
      if (item) book = await deps.importFile(await deps.fetchMacFile(item));
      else if (b.sourceName?.startsWith('sample:')) {
        const s = deps.samples.find((x) => sampleSourceName(x.id) === b.sourceName);
        if (s) book = await deps.importSample(s);
      } else if (isMacBook(b) && deps.fetchAccountFile && Date.now() - (failedAt()[b.note!] ?? 0) >= RETRY_MS) {
        const file = await deps.fetchAccountFile(b);
        if (file) {
          book = await deps.importFile(file).catch((e: unknown) => { setFailed(b.note!, Date.now()); throw e; });
          setFailed(b.note!, null);
        }
      }
      if (!book || !deps.alive()) continue;
      await deps.replace(b.id, book);
      done++;
    } catch {
      // The Mac went to sleep or the network dropped: this book is tried again next time.
    }
  }
  return done;
}
