// Shared setup for the jsdom tests: a real dictionary, an in-memory store and a settings store.
import 'fake-indexeddb/auto';
import { vi } from 'vitest';
import type { AppContext, Dictionary, Settings } from '../../src/types';
import { openStore } from '../../src/store';
import { createSettingsStore } from '../../src/store/settings';
import { loadTestDictionary } from '../helpers/data';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

let n = 0;

export async function makeCtx(settings: Partial<Settings> = {}, opts: { dictReady?: boolean } = {}): Promise<{ ctx: AppContext; dict: Dictionary; toasts: string[] }> {
  const dict = await loadTestDictionary();
  const store = await openStore(`reader-test-${++n}`);
  store.setNormalizer((w) => dict.toSimplified(w));
  const s = createSettingsStore(new MemoryStorage());
  s.set({ translator: 'gloss', ...settings });
  const toasts: string[] = [];
  let ready = opts.dictReady !== false;
  const ctx: AppContext = {
    dict: async () => { ready = true; return dict; },
    dictSync: () => (ready ? dict : null),
    settings: s,
    store,
    navigate: () => {},
    toast: (m) => { toasts.push(m); },
  };
  return { ctx, dict, toasts };
}

/** jsdom does not implement layout or scrolling; the popup code calls these. */
export function stubBrowser(): void {
  window.scrollBy = vi.fn() as unknown as typeof window.scrollBy;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom has no layout: give every element a small box so anchors exist.
  Element.prototype.getBoundingClientRect = function () { return new DOMRect(100, 100, 24, 30); };
  // The stroke-order section fetches from the network; make that fail quietly.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
}

export const anchorRect = () => new DOMRect(300, 200, 40, 30);

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
