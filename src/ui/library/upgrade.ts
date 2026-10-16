// Books made by an older importer (BookMeta.importVersion below IMPORT_VERSION) are imported again when the library can
// fetch them: the Mac's books from the Mac, the classics from the site. The new chapters replace the stored ones under the
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
  importFile(file: File): Promise<ImportedBook>;
  importSample(s: Sample): Promise<ImportedBook>;
  replace(id: string, book: ImportedBook): Promise<unknown>;
  /** False once the library is closed: the reader may open a book, so nothing is replaced after that. */
  alive(): boolean;
}

export const needsUpgrade = (b: Pick<BookMeta, 'importVersion'>) => (b.importVersion ?? 1) < IMPORT_VERSION;

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
