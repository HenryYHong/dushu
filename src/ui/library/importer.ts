// Turns files, pasted text and samples into stored books, with progress and readable errors.
import type { AppContext, BookMeta, ImportedBook } from '../../types';
import { bookKey } from '../../core/syncKeys';
import { loadSampleBook, type Sample } from './samples';
import { isMacBook } from './macBooks';
import { scriptView } from '../vocab/render';

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

/** The shape bookKey names a book added from a file by (chapter count, size, chapter titles), for any book: a rename keeps it. */
const shapeKey = (b: Pick<BookMeta, 'title' | 'chapterCount' | 'charCount' | 'chapterTitles'>) =>
  bookKey({ title: b.title, chapterCount: b.chapterCount, charCount: b.charCount, chapterTitles: b.chapterTitles });

/** The book in `books` that a new import would copy: the same chapters and size, whatever either is called. */
export function sameBookIn<B extends BookMeta>(book: Pick<ImportedBook, 'title' | 'chapters'>, countHan: (s: string) => number, books: B[]): B | undefined {
  // BookMeta.charCount as store.books.add counts it: chapter titles and the text of every block.
  let charCount = 0;
  for (const c of book.chapters) {
    charCount += countHan(c.title);
    for (const b of c.blocks) if ('text' in b) charCount += countHan(b.text);
  }
  const key = shapeKey({ title: book.title, chapterCount: book.chapters.length, charCount, chapterTitles: book.chapters.map((c) => c.title) });
  return books.find((b) => shapeKey(b) === key);
}

export interface Importer {
  jobs: Job[];
  /**
   * `quiet` skips the "Added" toast, for a caller that says it once for a whole batch. `mac` is for the Mac's own books
   * (syncMacBooks): they are always added, even beside a copy imported by hand.
   */
  files(files: File[], opts?: { quiet?: boolean; mac?: boolean }): Promise<BookMeta[]>;
  text(text: string, title: string, author: string): Promise<BookMeta | null>;
  sample(s: Sample): Promise<BookMeta | null>;
}

/** `onJobs` fires whenever the list of running imports or one job's progress changes. */
export function createImporter(ctx: AppContext, onJobs: () => void): Importer {
  let nextId = 1;
  const jobs: Job[] = [];
  /** A title as the library shows it, in the reading script (the book keeps the one it came with). */
  const shown = (t: string) => scriptView(ctx.settings.get().script, ctx.dictSync()).text(t);

  /** `twinOf` finds a book already in the library that this one would copy: then nothing is added and the toast offers it. */
  async function run(
    label: string,
    who: { title: string; author?: string },
    make: (m: ImportModule, onProgress: (f: number) => void) => Promise<ImportedBook> | ImportedBook,
    twinOf?: (book: ImportedBook, m: ImportModule) => BookMeta | undefined,
  ): Promise<BookMeta | null> {
    const job: Job = { id: nextId++, label, fraction: 0, title: who.title, author: who.author ?? '' };
    jobs.push(job);
    onJobs();
    let m: ImportModule | undefined;
    try {
      await nextFrame();
      m = await loadImporters();
      const book = await make(m, (f) => { job.fraction = Math.min(1, Math.max(0, f)) * 0.9; onJobs(); });
      const twin = twinOf?.(book, m);
      if (twin) {
        ctx.toast(`“${shown(twin.title)}” is already in your library.`, { action: { label: 'Open', run: () => ctx.navigate(`/read/${encodeURIComponent(twin.id)}`) }, ms: 7000 });
        return null;
      }
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
        // The Mac's own copy of this file is already here, with its progress.
        const existing = macCopyOf(f, have);
        if (existing) {
          ctx.toast(`“${shown(existing.title)}” is already in your library from your Mac.`, { action: { label: 'Read', run: () => ctx.navigate(`/read/${encodeURIComponent(existing.id)}`) }, ms: 7000 });
          continue;
        }
        // A file picked again would be a second card with its own progress: the book it copies is offered instead.
        const twinOf = opts?.mac ? undefined : (book: ImportedBook, m: ImportModule) => sameBookIn(book, m.countHan, have);
        const meta = await run(`“${f.name}”`, { title: titleFromFileName(f.name) }, (m, onProgress) => m.importFile(f, { onProgress }), twinOf);
        if (meta) { added.push(meta); have.push(meta); }
      }
      if (opts?.quiet) return added;
      if (added.length === 1) {
        ctx.toast(`Added “${shown(added[0].title)}”.`, { action: { label: 'Read', run: () => ctx.navigate(`/read/${encodeURIComponent(added[0].id)}`) }, ms: 7000 });
      } else if (added.length > 1) {
        ctx.toast(`Added ${added.length} books.`);
      }
      return added;
    },
    text(text, title, author) {
      // Same words as PASTED_TITLE in src/import, which names the saved book when the text has no title of its own.
      return run('that text', { title: title.trim() || 'Pasted text', author }, (m) => m.importText(text, title, author));
    },
    sample(s) {
      return run(`“${s.title}”`, { title: s.title, author: s.author }, (m) => loadSampleBook(s, m.importText, undefined, shown(s.title)));
    },
  };
}
