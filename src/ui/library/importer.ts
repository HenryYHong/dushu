// Turns files, pasted text and samples into stored books, with progress and readable errors.
import type { AppContext, BookMeta, ImportedBook } from '../../types';
import { loadSampleBook, type Sample } from './samples';

/** Same list as ACCEPT in src/import, kept here so the library does not load the importers up front. */
export const ACCEPT = '.epub,.mobi,.azw3,.azw,.prc,.txt,.text,.pdf,.html,.htm,.xhtml,.md';

type ImportModule = typeof import('../../import');
let mod: Promise<ImportModule> | null = null;
export const loadImporters = (): Promise<ImportModule> => (mod ??= import('../../import'));

/** Warm the importer chunk while the user is looking at the library. */
export function prefetchImporters(): void {
  const run = () => { void loadImporters().catch(() => { mod = null; }); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 800);
}

export function errorText(e: unknown, label: string, ImportError?: ImportModule['ImportError']): string {
  if (ImportError && e instanceof ImportError) return label === 'that text' ? e.message : `${label}: ${e.message}`;
  const msg = e instanceof Error && e.message ? e.message : '';
  return msg ? `Could not add ${label}. ${msg}` : `Could not add ${label}.`;
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 30));

export interface Job {
  id: number;
  label: string;
  fraction: number;
}

export interface Importer {
  jobs: Job[];
  files(files: File[]): Promise<BookMeta[]>;
  text(text: string, title: string, author: string): Promise<BookMeta | null>;
  sample(s: Sample): Promise<BookMeta | null>;
}

/** `onJobs` fires whenever the list of running imports or one job's progress changes. */
export function createImporter(ctx: AppContext, onJobs: () => void): Importer {
  let nextId = 1;
  const jobs: Job[] = [];

  async function run(label: string, make: (m: ImportModule, onProgress: (f: number) => void) => Promise<ImportedBook> | ImportedBook): Promise<BookMeta | null> {
    const job: Job = { id: nextId++, label, fraction: 0 };
    jobs.push(job);
    onJobs();
    let m: ImportModule | undefined;
    try {
      await nextFrame();
      m = await loadImporters();
      const book = await make(m, (f) => { job.fraction = Math.min(1, Math.max(0, f)) * 0.9; onJobs(); });
      job.fraction = 0.92;
      onJobs();
      await nextFrame();
      return await ctx.store.books.add(book);
    } catch (e) {
      ctx.toast(errorText(e, label, m?.ImportError), { ms: 9000 });
      return null;
    } finally {
      jobs.splice(jobs.indexOf(job), 1);
      onJobs();
    }
  }

  return {
    jobs,
    async files(files) {
      const added: BookMeta[] = [];
      for (const f of files) {
        const meta = await run(`“${f.name}”`, (m, onProgress) => m.importFile(f, { onProgress }));
        if (meta) added.push(meta);
      }
      if (added.length === 1) {
        ctx.toast(`Added “${added[0].title}”.`, { action: { label: 'Read', run: () => ctx.navigate(`/read/${encodeURIComponent(added[0].id)}`) }, ms: 7000 });
      } else if (added.length > 1) {
        ctx.toast(`Added ${added.length} books.`);
      }
      return added;
    },
    text(text, title, author) {
      return run('that text', (m) => m.importText(text, title, author));
    },
    sample(s) {
      return run(`“${s.title}”`, (m) => loadSampleBook(s, m.importText));
    },
  };
}
