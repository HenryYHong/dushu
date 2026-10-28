// A book can arrive two ways at once: added from the Mac (ui/library/macBooks.ts) and downloaded from the sync account
// (cloudBooks.ts). Both check the library and add inside this lock, one at a time per tab, and per browser where Web Locks
// exist, so the same book is never added twice.
let queue: Promise<unknown> = Promise.resolve();

export function withBookLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const job = queue.then(async (): Promise<T> => (locks ? await locks.request('dushu-mac-books', async () => await fn()) : await fn()));
  queue = job.catch(() => {});
  return job;
}
