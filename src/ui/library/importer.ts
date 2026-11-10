// Turns files, pasted text and samples into stored books, with progress and readable errors.
import type { AppContext, BookMeta, ImportedBook } from '../../types';
import { bookKey, canonical, hash } from '../../core/syncKeys';
import { loadSampleBook, sampleSourceName, type Sample } from './samples';
import { problemsDialog } from './dialogs';
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
  /** What the card says before the reading starts, when it is not "Starting…" (a book being downloaded). */
  stage?: string;
}

/** What the pending card says under the title: "Downloading", "Starting", "Reading 42%", "Saving". */
export function jobStage(job: Pick<Job, 'fraction' | 'stage'>): string {
  if (job.stage) return job.stage;
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
  return sameShapeIn(book, countHan, books)[0];
}

/** Every book in `books` with the shape a new import would have (two short texts of one length can share one). */
function sameShapeIn<B extends BookMeta>(book: Pick<ImportedBook, 'title' | 'chapters'>, countHan: (s: string) => number, books: B[]): B[] {
  // BookMeta.charCount as store.books.add counts it: chapter titles and the text of every block.
  let charCount = 0;
  for (const c of book.chapters) {
    charCount += countHan(c.title);
    for (const b of c.blocks) if ('text' in b) charCount += countHan(b.text);
  }
  const key = shapeKey({ title: book.title, chapterCount: book.chapters.length, charCount, chapterTitles: book.chapters.map((c) => c.title) });
  return books.filter((b) => shapeKey(b) === key);
}

/** What pasted text is kept as: the text itself names it, so the same text pasted again is the same book (bookKey). */
export const pasteSourceName = (text: string): string => `paste:${hash(text.trim())}`;

/**
 * `quiet` skips the "Added" toast, for a caller that says it once for a whole batch. `mac` is for the Mac's own books
 * (syncMacBooks): they are always added, even beside a copy imported by hand. `onProblem` hears what would have been a toast
 * (a book that could not be read, or one already in the library), for a caller whose dialog covers the toasts, with what went
 * wrong (an Error with a `code` the sync server gave). `who` names the book on its card and in messages when the caller knows
 * it and the file's name is not for people (gutenberg-1342.epub): the file keeps its name, which the book is kept under.
 */
export interface FileOpts {
  quiet?: boolean;
  mac?: boolean;
  onProblem?: (message: string, twin?: BookMeta, error?: unknown) => void;
  who?: { title: string; author?: string };
}

export interface Importer {
  jobs: Job[];
  files(files: File[], opts?: FileOpts): Promise<BookMeta[]>;
  /** A book that is downloaded first: its card shows from the moment it is asked for, "Downloading…" under the caller's title. */
  remote(who: { title: string; author?: string }, download: () => Promise<File>, opts?: FileOpts): Promise<BookMeta | null>;
  /** Pasted text: the book added, or the one already here with the same text. */
  text(text: string, title: string, author: string): Promise<BookMeta | { twin: BookMeta } | null>;
  sample(s: Sample): Promise<BookMeta | null>;
}

/**
 * One file of a batch that was not added, or was added with a warning: what a toast would have said on its own (`message`,
 * with Open or Read for the book already here), and the reason alone for the batch's Details.
 */
interface Problem { name: string; message: string; reason: string; twin?: BookMeta; action?: 'Open' | 'Read'; added?: boolean }

/** `onJobs` fires whenever the list of running imports or one job's progress changes. */
export function createImporter(ctx: AppContext, onJobs: () => void): Importer {
  let nextId = 1;
  const jobs: Job[] = [];
  /** A title as the library shows it, in the reading script (the book keeps the one it came with). */
  const shown = (t: string) => scriptView(ctx.settings.get().script, ctx.dictSync()).text(t);
  const read = (b: BookMeta) => () => ctx.navigate(`/read/${encodeURIComponent(b.id)}`);
  /** Classics being added: a second tap on one (the first-book card and the list both offer it) waits for the same book. */
  const samples = new Map<string, Promise<BookMeta | null>>();

  /**
   * `twinOf` finds a book already in the library that this one would copy: then nothing is added and the toast offers it (or
   * `onTwin` hears of it). `stage` is what the card says until `make` reports progress (a download); `onWarning` hears what an
   * import that worked could not read, instead of a toast.
   */
  async function run(
    label: string,
    who: { title: string; author?: string },
    make: (m: ImportModule, onProgress: (f: number) => void) => Promise<ImportedBook> | ImportedBook,
    twinOf?: (book: ImportedBook, m: ImportModule) => BookMeta | undefined | Promise<BookMeta | undefined>,
    onProblem?: FileOpts['onProblem'],
    opts: { stage?: string; onWarning?: (w: string) => void; onTwin?: (twin: BookMeta) => void } = {},
  ): Promise<BookMeta | null> {
    const job: Job = { id: nextId++, label, fraction: 0, title: who.title, author: who.author ?? '', ...(opts.stage ? { stage: opts.stage } : {}) };
    jobs.push(job);
    onJobs();
    let m: ImportModule | undefined;
    try {
      await nextFrame();
      m = await loadImporters();
      const book = await make(m, (f) => { delete job.stage; job.fraction = Math.min(1, Math.max(0, f)) * 0.9; onJobs(); });
      delete job.stage;
      const twin = await twinOf?.(book, m);
      if (twin) {
        if (opts.onTwin) { opts.onTwin(twin); return null; }
        if (onProblem) { onProblem(`“${shown(twin.title)}” is already in your library.`, twin); return null; }
        ctx.toast(`“${shown(twin.title)}” is already in your library.`, { action: { label: 'Open', run: read(twin) }, ms: 7000 });
        return null;
      }
      job.fraction = 0.92;
      job.title = book.title || job.title;
      job.author = book.author || job.author;
      onJobs();
      await nextFrame();
      const meta = await ctx.store.books.add(book);
      // What went wrong in an import that still worked (bad bytes in the file) is said once, beside the "Added" notice.
      for (const w of book.warnings ?? []) {
        if (opts.onWarning) opts.onWarning(w); else ctx.toast(`${label}: ${w}`, { ms: 9000 });
      }
      return meta;
    } catch (e) {
      if (onProblem) onProblem(errorText(e, label, m?.ImportError), undefined, e);
      else ctx.toast(errorText(e, label, m?.ImportError), { ms: 9000 });
      return null;
    } finally {
      jobs.splice(jobs.indexOf(job), 1);
      onJobs();
    }
  }

  const say = (p: Problem) => ctx.toast(p.message, p.twin && p.action ? { action: { label: p.action, run: read(p.twin) }, ms: 7000 } : { ms: 9000 });

  return {
    jobs,
    async files(files, opts) {
      const added: BookMeta[] = [];
      const have = await ctx.store.books.list().catch(() => [] as BookMeta[]);
      // Several files picked at once: what went wrong is gathered and said once at the end (the toasts keep only three).
      const gather = files.length > 1 && !opts?.onProblem && !opts?.quiet;
      const problems: Problem[] = [];
      for (const f of files) {
        // The Mac's own copy of this file is already here, with its progress.
        const existing = macCopyOf(f, have);
        if (existing) {
          const p: Problem = { name: f.name, message: `“${shown(existing.title)}” is already in your library from your Mac.`, reason: 'Already in your library from your Mac.', twin: existing, action: 'Read' };
          if (gather) problems.push(p); else say(p);
          continue;
        }
        // A file picked again would be a second card with its own progress: the book it copies is offered instead.
        const twinOf = opts?.mac ? undefined : (book: ImportedBook, m: ImportModule) => sameBookIn(book, m.countHan, have);
        // The caller's name for the book when the file's is not for people (gutenberg-1342.epub); the file keeps its own.
        const label = `“${opts?.who?.title ?? f.name}”`;
        const who = opts?.who ?? { title: titleFromFileName(f.name) };
        const meta = await run(label, who, (m, onProgress) => m.importFile(f, { onProgress }), twinOf,
          gather ? (message) => problems.push({ name: f.name, message, reason: message.replace(/^“[^”]*”:\s*|^Could not add “[^”]*”\.\s*/, '') }) : opts?.onProblem,
          gather ? {
            onTwin: (twin) => problems.push({ name: f.name, message: `“${shown(twin.title)}” is already in your library.`, reason: `Already in your library as “${shown(twin.title)}”.`, twin, action: 'Open' }),
            onWarning: (w) => problems.push({ name: f.name, message: `${label}: ${w}`, reason: `Added, but ${w[0].toLowerCase()}${w.slice(1)}`, added: true }),
          } : {});
        if (meta) { added.push(meta); have.push(meta); }
      }
      if (problems.length > 1) {
        summarize(files.length, added, problems);
        return added;
      }
      // One problem in a batch is said as it would have been on its own.
      for (const p of problems) say(p);
      if (opts?.quiet) return added;
      if (added.length === 1) {
        ctx.toast(`Added “${shown(added[0].title)}”.`, { action: { label: 'Read', run: read(added[0]) }, ms: 7000 });
      } else if (added.length > 1) {
        ctx.toast(`Added ${added.length} books.`);
      }
      return added;
    },
    async remote(who, download, opts) {
      // The download starts at once, beside the importers loading, and the card is up from the moment the book is asked for.
      const file = download();
      file.catch(() => {});
      const meta = await run(`“${who.title}”`, who, async (m, onProgress) => {
        const f = await file;
        onProgress(0);
        const book = await m.importFile(f, { onProgress });
        // A book with no title or author of its own takes the ones it was asked for, never its file's name (gutenberg-1342).
        const named = !book.title || book.title === titleFromFileName(f.name) || book.title === f.name.replace(/\.[a-z0-9]{1,5}$/i, '');
        return { ...book, title: named ? who.title : book.title, author: book.author || who.author || '' };
      },async (book, m) => sameBookIn(book, m.countHan, await ctx.store.books.list().catch(() => [] as BookMeta[])), opts?.onProblem, { stage: 'Downloading…' });
      if (meta && !opts?.quiet) ctx.toast(`Added “${shown(meta.title)}”.`, { action: { label: 'Read', run: read(meta) }, ms: 7000 });
      return meta;
    },
    async text(text, title, author) {
      const sourceName = pasteSourceName(text);
      let twin: BookMeta | undefined;
      // Same words as PASTED_TITLE in src/import, which names the saved book when the text has no title of its own.
      const meta = await run('that text', { title: title.trim() || 'Pasted text', author }, (m) => ({ ...m.importText(text, title, author), sourceName }),
        async (book, m) => {
          const have = await ctx.store.books.list().catch(() => [] as BookMeta[]);
          const same = have.find((b) => b.sourceName === sourceName);
          if (same) return same;
          // A shape alone is no proof for a short text (two of one length share one): the chapters are compared.
          for (const b of sameShapeIn(book, m.countHan, have)) {
            if (await sameChapters(b, book)) return b;
          }
          return undefined;
        }, undefined, { onTwin: (t) => { twin = t; } });
      return twin ? { twin } : meta;
    },
    sample(s) {
      const running = samples.get(s.id);
      if (running) return running;
      const p = (async () => {
        // Added already (from the first-book card, or the list a moment ago): that book, not a second copy.
        const have = await ctx.store.books.list().catch(() => [] as BookMeta[]);
        const here = have.find((b) => b.sourceName === sampleSourceName(s.id));
        if (here) return here;
        // The label is the one the classics list looks for to show this one as being added.
        return run(`“${s.title}”`, { title: s.title, author: s.author }, (m) => loadSampleBook(s, m.importText, undefined, shown(s.title)));
      })().finally(() => samples.delete(s.id));
      samples.set(s.id, p);
      return p;
    },
  };

  /** Whether a stored book has exactly the chapters of a new import. */
  async function sameChapters(b: BookMeta, book: ImportedBook): Promise<boolean> {
    if (b.chapterCount !== book.chapters.length) return false;
    for (let i = 0; i < book.chapters.length; i++) {
      const here = await ctx.store.books.chapter(b.id, i).catch(() => undefined);
      if (!here || canonical(here) !== canonical(book.chapters[i])) return false;
    }
    return true;
  }

  /** One notice for a batch with several problems, with the whole list behind Details. */
  function summarize(count: number, added: BookMeta[], problems: Problem[]): void {
    const failed = problems.filter((p) => !p.added).length;
    const books = (n: number) => `${n} ${n === 1 ? 'book' : 'books'}`;
    const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
    const message = !added.length ? `None of the ${count} files could be added.`
      : failed ? `Added ${books(added.length)}. ${files(failed)} could not be added.`
      : `Added ${books(added.length)}. ${files(problems.length)} had problems.`;
    ctx.toast(message, { action: { label: 'Details', run: () => void problemsDialog(problems.map((p) => ({
      name: p.name, reason: p.reason, ...(p.twin ? { open: read(p.twin) } : {}),
    }))) }, ms: 12000 });
  }
}
