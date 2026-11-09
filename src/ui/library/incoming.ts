// Books and links that come from outside the app: a file opened with the installed app ("Open with", manifest file_handlers and
// the launchQueue) and something shared to it (manifest share_target: sw.js keeps it in the cache dushu-shared). The library
// takes them when it opens: files are imported, a link to a book opens Find a book on it, and text opens Paste text with it.

export interface Incoming { files: File[]; title: string; text: string; url: string }

const SHARED_CACHE = 'dushu-shared';
const opened: File[] = [];
let listening = false;
/** Fired on window when a file was opened with the app while it runs. */
export const INCOMING_EVENT = 'dushu:incoming';

/** Called once at start: files opened with the installed app wait here until the library takes them. */
export function listenForOpenedFiles(): void {
  if (listening) return;
  listening = true;
  const queue = (globalThis as { launchQueue?: { setConsumer(fn: (p: { files?: { getFile(): Promise<File> }[] }) => void): void } }).launchQueue;
  queue?.setConsumer((params) => {
    void Promise.all((params.files ?? []).map((h) => h.getFile().catch(() => null))).then((files) => {
      const got = files.filter((f): f is File => !!f);
      if (!got.length) return;
      opened.push(...got);
      globalThis.dispatchEvent?.(new Event(INCOMING_EVENT));
    });
  });
}

/** Everything waiting, taken once: what was shared is removed from the cache as it is read. Null when nothing waits. */
export async function takeIncoming(): Promise<Incoming | null> {
  const files = opened.splice(0);
  let title = '';
  let text = '';
  let url = '';
  try {
    if (typeof caches !== 'undefined' && await caches.has(SHARED_CACHE)) {
      const cache = await caches.open(SHARED_CACHE);
      const meta = await cache.match('./shared/meta').then((r) => r?.json() as Promise<{ files?: number; title?: string; text?: string; url?: string }> | undefined).catch(() => undefined);
      for (let i = 0; i < Math.min(20, meta?.files ?? 0); i++) {
        const r = await cache.match(`./shared/file-${i}`);
        if (!r) continue;
        const name = decodeURIComponent(r.headers.get('X-Name') ?? `book-${i}`);
        files.push(new File([await r.blob()], name, { type: r.headers.get('Content-Type') ?? '' }));
      }
      title = meta?.title ?? '';
      text = meta?.text ?? '';
      url = meta?.url ?? '';
      await caches.delete(SHARED_CACHE);
    }
  } catch { /* storage that cannot be read: what was opened is still taken */ }
  return files.length || text.trim() || url.trim() ? { files, title, text, url } : null;
}
