// Turns files, pasted text and samples into stored books, with progress and readable errors.
import type { AppContext, BookMeta, ImportedBook } from '../../types';
import { loadSampleBook, type Sample } from './samples';
import { isMacBook } from './macBooks';

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

export const OFFLINE_MESSAGE = 'You are offline. Connect once to add this classic.';

/** True for what a browser reports when a request got no answer: "Failed to fetch", "Load failed", a service worker's respondWith error. */
export function isNetworkFailure(e: unknown): boolean {
  return e instanceof Error && e.name !== 'ImportError' && /failed to fetch|load failed|networkerror|network request failed|respondwith/i.test(e.message);
}

export function errorText(e: unknown, label: string, ImportError?: ImportModule['ImportError']): string {
  if (ImportError && e instanceof ImportError) return label === 'that text' ? e.message : `${label}: ${e.message}`;
  // Never show a raw browser message such as "FetchEvent.respondWith received an error: TypeError: Load failed".
  if (isNetworkFailure(e)) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return `Could not add ${label}. ${offline ? OFFLINE_MESSAGE : 'The network did not answer. Check your connection and try again.'}`;
  }
  const msg = e instanceof Error && e.message ? e.message : '';
  if (/^(Could not|You are offline)/.test(msg)) return msg.startsWith('Could not') ? msg : `Could not add ${label}. ${msg}`;
  return msg ? `Could not add ${label}. ${msg}` : `Could not add ${label}.`;
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 30));

export interface Job {
  id: number;
  label: string;
  fraction: number;
  /** The book's title and author, as soon as they are known (a classic: at once; a file: from its name, then from its contents). */
  title: string;
  author: string;
}

/** What the pending card says under the title: "Starting", "Reading 42%", "Saving". */
export function jobStage(job: Pick<Job, 'fraction'>): string {
  if (job.fraction < 0.02) return 'Starting…';
  if (job.fraction >= 0.9) return 'Saving…';
  return `Reading… ${Math.round((job.fraction / 0.9) * 100)}%`;
}

/** A readable title from a file name: no extension, underscores as spaces. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').trim() || name;
}

/** The book from the Mac that a file by the same name would copy, if any: the Mac's own copy is already here with its progress. */
export function macCopyOf<B extends Pick<BookMeta, 'note' | 'sourceName'>>(file: Pick<File, 'name'>, books: B[]): B | undefined {
  return books.find((b) => isMacBook(b) && b.sourceName === file.name);
}

export interface Importer {
  jobs: Job[];
  /** `quiet` skips the "Added" toast, for a caller that says it once for a whole batch. */
  files(files: File[], opts?: { quiet?: boolean }): Promise<BookMeta[]>;
  text(text: string, title: string, author: string): Promise<BookMeta | null>;
  sample(s: Sample): Promise<BookMeta | null>;
}

/** `onJobs` fires whenever the list of running imports or one job's progress changes. */
export function createImporter(ctx: AppContext, onJobs: () => void): Importer {
  let nextId = 1;
  const jobs: Job[] = [];

  async function run(label: string, who: { title: string; author?: string }, make: (m: ImportModule, onProgress: (f: number) => void) => Promise<ImportedBook> | ImportedBook): Promise<BookMeta | null> {
    const job: Job = { id: nextId++, label, fraction: 0, title: who.title, author: who.author ?? '' };
    jobs.push(job);
    onJobs();
    let m: ImportModule | undefined;
    try {
      await nextFrame();
      m = await loadImporters();
      const book = await make(m, (f) => { job.fraction = Math.min(1, Math.max(0, f)) * 0.9; onJobs(); });
      job.fraction = 0.92;
      job.title = book.title || job.title;
      job.author = book.author || job.author;
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
    async files(files, opts) {
      const added: BookMeta[] = [];
      const have = await ctx.store.books.list().catch(() => [] as BookMeta[]);
      for (const f of files) {
        // Picking the same file again would make a second card with its own progress.
        const existing = macCopyOf(f, have);
        if (existing) {
          ctx.toast(`“${existing.title}” is already in your library from your Mac.`, { action: { label: 'Read', run: () => ctx.navigate(`/read/${encodeURIComponent(existing.id)}`) }, ms: 7000 });
          continue;
        }
        const meta = await run(`“${f.name}”`, { title: titleFromFileName(f.name) }, (m, onProgress) => m.importFile(f, { onProgress }));
        if (meta) added.push(meta);
      }
      if (opts?.quiet) return added;
      if (added.length === 1) {
        ctx.toast(`Added “${added[0].title}”.`, { action: { label: 'Read', run: () => ctx.navigate(`/read/${encodeURIComponent(added[0].id)}`) }, ms: 7000 });
      } else if (added.length > 1) {
        ctx.toast(`Added ${added.length} books.`);
      }
      return added;
    },
    text(text, title, author) {
      return run('that text', { title: title.trim() || 'Pasted text', author }, (m) => m.importText(text, title, author));
    },
    sample(s) {
      return run(`“${s.title}”`, { title: s.title, author: s.author }, (m) => loadSampleBook(s, m.importText));
    },
  };
}
