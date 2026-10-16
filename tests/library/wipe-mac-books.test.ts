// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '../../src/store/settings';
import { openStore, type DushuStore } from '../../src/store';
import type { AppContext, ImportedBook } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';
import { MAC_NOTE, planMacBooks } from '../../src/ui/library/macBooks';
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
  it('removes the Mac\'s books like the rest, and they are missing again for the next visit to add', async () => {
    const marked = await store.books.add(imported('一', '论语一.txt'));
    await store.books.update(marked.id, { note: MAC_NOTE + SHA });
    await eraseAllData(ctx);
    expect(await store.books.list()).toHaveLength(0);
    const plan = planMacBooks(MAC, await store.books.list());
    expect(plan.missing.map((b) => b.id)).toEqual(['one', 'two']);
  });

  it('forgets every dushu key, the old removed list included', async () => {
    await store.books.add(imported('自己', 'mine.txt'));
    localStorage.setItem('dushu.mac-books.removed.v1', JSON.stringify([{ name: '论语二.txt', sha256: 'd'.repeat(64) }]));
    localStorage.setItem('dushu.mac-bridge.v1', 'https://my-mac.example-tailnet.ts.net');
    localStorage.setItem('dushu.settings', '{}');
    await eraseAllData(ctx);
    expect(await store.books.list()).toHaveLength(0);
    expect(localStorage.getItem('dushu.mac-books.removed.v1')).toBeNull();
    expect(localStorage.getItem('dushu.mac-bridge.v1')).toBeNull();
    expect(localStorage.getItem('dushu.settings')).toBeNull();
  });
});
