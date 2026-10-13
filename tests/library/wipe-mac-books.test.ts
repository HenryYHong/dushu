// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '../../src/store/settings';
import { openStore, type DushuStore } from '../../src/store';
import type { AppContext, ImportedBook } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { MAC_NOTE, planMacBooks, removedMacBooks } from '../../src/ui/library/macBooks';
import { eraseAllData } from '../../src/ui/settings/data';

// Public-domain stand-ins: only the names and digests matter.
const SHA = 'c'.repeat(64);
const MAC = [
  { id: 'one', name: '论语一.txt', sha256: SHA },
  { id: 'two', name: '论语二.txt', sha256: 'd'.repeat(64) },
];
let n = 0;
let store: DushuStore;
let ctx: AppContext;

const imported = (title: string, sourceName: string): ImportedBook => ({
  title, author: '', format: 'txt', script: 'simplified', sourceName,
  chapters: [{ title, blocks: [{ t: 'p', text: '学而时习之，不亦说乎？' }] }], assets: new Map(),
});

beforeEach(async () => {
  localStorage.clear();
  store = await openStore(`wipe-${++n}-${Math.random().toString(36).slice(2)}`);
  const dict = await loadTestDictionary();
  ctx = { dict: () => Promise.resolve(dict), dictSync: () => dict, settings: createSettingsStore(), store, navigate: () => {}, toast: () => {} } as unknown as AppContext;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Delete all data and the owner books', () => {
  it('keeps a Mac book on the removed list so it is not silently re-added', async () => {
    const marked = await store.books.add(imported('一', '论语一.txt'));
    await store.books.update(marked.id, { note: MAC_NOTE + SHA });
    await eraseAllData(ctx, MAC);
    expect(await store.books.list()).toHaveLength(0);
    expect(removedMacBooks()).toEqual([{ name: '论语一.txt', sha256: SHA }]);
    // A later sync plan holds it back and still adds the other.
    const plan = planMacBooks(MAC, await store.books.list(), removedMacBooks());
    expect(plan.held.map((b) => b.id)).toEqual(['one']);
    expect(plan.missing.map((b) => b.id)).toEqual(['two']);
  });

  it('recognizes a Mac book added by hand (no mark yet) by its file name', async () => {
    await store.books.add(imported('二', '论语二.txt'));
    await eraseAllData(ctx, MAC);
    expect(removedMacBooks().map((r) => r.name)).toEqual(['论语二.txt']);
  });

  it('keeps earlier removals, forgets everything else, and ignores books that are not the Mac\'s', async () => {
    await store.books.add(imported('自己', 'mine.txt'));
    localStorage.setItem('dushu.mac-books.removed.v1', JSON.stringify([{ name: '论语二.txt', sha256: 'd'.repeat(64) }]));
    localStorage.setItem('dushu.mac-bridge.v1', 'https://my-mac.example-tailnet.ts.net');
    localStorage.setItem('dushu.settings', '{}');
    await eraseAllData(ctx, MAC);
    expect(removedMacBooks()).toEqual([{ name: '论语二.txt', sha256: 'd'.repeat(64) }]);
    expect(localStorage.getItem('dushu.mac-bridge.v1')).toBeNull();
    expect(localStorage.getItem('dushu.settings')).toBeNull();
  });
});
