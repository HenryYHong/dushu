// Bounded zip reading for EPUB.
//
// A zip can declare a few kilobytes and inflate to gigabytes (a 1 MB file can unpack to 1 GB). Reading is
// therefore done in two steps: first the central directory is listed without inflating anything, the declared
// sizes are checked against the limits below, and only then are the entries the book needs inflated, each into
// a buffer of its declared size. fflate never writes past that buffer, so a forged size gives a short (damaged)
// entry, never unbounded memory.
import { unzipSync } from 'fflate';
import { ImportError } from './errors';

export const ZIP_LIMITS = {
  /** All entries together, as declared. */
  totalBytes: 300 * 1024 * 1024,
  /** One markup, package or table-of-contents file. */
  textBytes: 64 * 1024 * 1024,
  /** One image. */
  imageBytes: 32 * 1024 * 1024,
  entries: 20000,
};

export const DAMAGED_MESSAGE = 'This file looks damaged or incomplete. Try downloading or exporting the book again.';
export const TOO_BIG_MESSAGE = 'This book is too large to import (it would need more than 300 MB once unpacked). Try a smaller edition.';

export interface ZipEntry {
  name: string;
  /** Declared size once inflated. */
  size: number;
}

export class Archive {
  readonly entries: ZipEntry[];
  private readonly sizes = new Map<string, number>();
  private readonly lower = new Map<string, string>();
  private readonly inflated = new Map<string, Uint8Array>();

  constructor(private readonly data: Uint8Array) {
    const entries: ZipEntry[] = [];
    try {
      // The filter sees each entry's header; returning false skips it, so nothing is inflated here.
      unzipSync(data, {
        filter: (f) => {
          if (entries.length >= ZIP_LIMITS.entries) throw new ImportError(TOO_BIG_MESSAGE);
          if (!f.name.endsWith('/')) entries.push({ name: f.name, size: f.originalSize });
          return false;
        },
      });
    } catch (e) {
      if (e instanceof ImportError) throw e;
      throw new ImportError(DAMAGED_MESSAGE);
    }
    this.entries = entries;
    let total = 0;
    for (const e of entries) {
      total += e.size;
      if (!Number.isFinite(e.size) || e.size < 0 || total > ZIP_LIMITS.totalBytes) throw new ImportError(TOO_BIG_MESSAGE);
      this.sizes.set(e.name, e.size);
      if (!this.lower.has(e.name.toLowerCase())) this.lower.set(e.name.toLowerCase(), e.name);
    }
  }

  /** The entry's real name for a path: an exact match, else a case-insensitive one. */
  resolve(path: string): string | undefined {
    return this.sizes.has(path) ? path : this.lower.get(path.toLowerCase());
  }

  has(path: string): boolean {
    return this.resolve(path) !== undefined;
  }

  names(): string[] {
    return this.entries.map((e) => e.name);
  }

  sizeOf(path: string): number {
    const name = this.resolve(path);
    return name === undefined ? 0 : (this.sizes.get(name) ?? 0);
  }

  /**
   * Inflate these entries (paths resolve case-insensitively); anything already inflated is kept. An entry over
   * `maxBytes` is skipped when `skipLarge` is set, else it is an error. An entry whose data is damaged is left out
   * (reads of it return undefined). Returns the names that were skipped for size.
   */
  inflate(paths: Iterable<string>, opts: { maxBytes: number; skipLarge?: boolean }): string[] {
    const wanted = new Set<string>();
    const skipped: string[] = [];
    let budget = ZIP_LIMITS.totalBytes;
    for (const v of this.inflated.values()) budget -= v.length;
    for (const p of paths) {
      const name = this.resolve(p);
      if (name === undefined || this.inflated.has(name) || wanted.has(name)) continue;
      const size = this.sizeOf(name);
      if (size > opts.maxBytes || size > budget) {
        if (opts.skipLarge) { skipped.push(name); continue; }
        throw new ImportError(size > budget ? TOO_BIG_MESSAGE : 'One of the files inside this book is too large to import.');
      }
      budget -= size;
      wanted.add(name);
    }
    if (!wanted.size) return skipped;
    const run = (names: Set<string>) => unzipSync(this.data, { filter: (f) => names.has(f.name) });
    let files: Record<string, Uint8Array> = {};
    try {
      files = run(wanted);
    } catch {
      // A damaged entry fails the whole call; retry one by one so the good ones still load.
      for (const name of wanted) {
        try { Object.assign(files, run(new Set([name]))); } catch { /* leave this one out */ }
      }
    }
    for (const [name, bytes] of Object.entries(files)) this.inflated.set(name, bytes);
    return skipped;
  }

  /** Bytes of an entry that has been inflated. */
  get(path: string): Uint8Array | undefined {
    const name = this.resolve(path);
    return name === undefined ? undefined : this.inflated.get(name);
  }
}
