// How far the dictionary download has got, for a screen that waits for it (the reader's "Opening the book…").
export interface DictBytes { loaded: number; total: number }

let current: DictBytes = { loaded: 0, total: 0 };
const watchers = new Set<(b: DictBytes) => void>();

export function setDictBytes(loaded: number, total: number): void {
  current = { loaded, total };
  for (const w of watchers) w(current);
}

/** Calls `fn` now and on every change; returns the way to stop. */
export function watchDictBytes(fn: (b: DictBytes) => void): () => void {
  watchers.add(fn);
  fn(current);
  return () => { watchers.delete(fn); };
}
