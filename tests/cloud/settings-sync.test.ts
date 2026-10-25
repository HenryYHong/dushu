// @vitest-environment jsdom
// Settings that follow the reader: devices signed in to one account keep the same reading settings (layout, text size,
// pinyin, theme…), whichever device chose them last, while each device keeps its own voice, hover or tap, and pages side by
// side. A device that never changed a setting takes the account's; a choice made before settings synced beats a default but
// not a change made since. The server runs in process.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../cloud/src/worker';
import { requestCode, signIn } from '../../src/core/cloud';
import { createSyncer, type Syncer } from '../../src/core/sync';
import { DEFAULT_SETTINGS, createSettingsStore } from '../../src/store/settings';
import { openStore } from '../../src/store';
import { cloud } from './helpers';

function memStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); },
  };
}

const syncers: Syncer[] = [];
let clock = 1_800_000_000_000;
beforeEach(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const c = cloud();
  let code = '';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const res = await worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' ? undefined : await req.text() }), c.env);
    if (req.url.endsWith('/auth/code') && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
    return res;
  });
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  await requestCode('reader@example.com');
  await signIn('reader@example.com', code);
});
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

/** One device: its own store and settings (as if its own browser), signed in to the same account. */
async function device(saved?: Partial<typeof DEFAULT_SETTINGS>) {
  const storage = memStorage(saved ? { 'dushu.settings.v1': JSON.stringify({ ...DEFAULT_SETTINGS, ...saved }), 'dushu.settings.pages.v1': '1', 'dushu.settings.simplified.v1': '1' } : {});
  const settings = createSettingsStore(storage);
  const store = await openStore(`settings-${Math.random()}`);
  const syncer = createSyncer(store, { everyMs: 0, settings, now: () => (clock += 1000) });
  syncers.push(syncer);
  return { settings, syncer };
}

describe('settings that follow the reader', () => {
  it('brings the reading settings to a new device and keeps the device’s own ones', async () => {
    const mine = await device({ fontSize: 30, pinyin: 'hsk', hskThreshold: 4, theme: 'sepia', layout: 'pages', ttsVoice: 'Tingting', lookupTrigger: 'hover', spread: 'double' });
    await mine.syncer.run();
    const ipad = await device();
    await ipad.syncer.run();
    expect(ipad.settings.get()).toMatchObject({ fontSize: 30, pinyin: 'hsk', hskThreshold: 4, theme: 'sepia', layout: 'pages' });
    expect(ipad.settings.get()).toMatchObject({ ttsVoice: '', lookupTrigger: 'click', spread: 'auto' });
  });

  it('takes whichever device changed a setting last, both ways', async () => {
    const a = await device();
    const b = await device();
    await a.syncer.run(); await b.syncer.run();
    b.settings.set({ theme: 'dark', layout: 'scroll' });
    await b.syncer.run(); await a.syncer.run();
    expect(a.settings.get()).toMatchObject({ theme: 'dark', layout: 'scroll' });
    a.settings.set({ layout: 'pages', scrollFontSize: 34 });
    await a.syncer.run(); await b.syncer.run();
    expect(b.settings.get()).toMatchObject({ theme: 'dark', layout: 'pages', scrollFontSize: 34 });
    // Nothing more goes either way once both agree.
    await a.syncer.run(); await b.syncer.run();
    expect([a.syncer.status().pending, b.syncer.status().pending]).toEqual([0, 0]);
  });

  it('lets a choice made before settings synced beat a default, but not a change made since', async () => {
    const a = await device({ fontSize: 26 });
    await a.syncer.run();
    const fresh = await device();
    await fresh.syncer.run();
    expect(fresh.settings.get().fontSize).toBe(26);
    a.settings.set({ fontSize: 32 });
    await a.syncer.run();
    // A device that had its own size before settings synced: the size chosen since, on the other device, wins.
    const old = await device({ fontSize: 24 });
    await old.syncer.run();
    expect(old.settings.get().fontSize).toBe(32);
  });

  it('leaves settings alone for a syncer not given them', async () => {
    const a = await device({ fontSize: 30 });
    await a.syncer.run();
    const store = await openStore(`settings-none-${Math.random()}`);
    const plain = createSyncer(store, { everyMs: 0 });
    syncers.push(plain);
    await plain.run();
    expect(plain.status().state).toBe('idle');
    expect((await store.sync.rows()).some((r) => r.key.startsWith('o:'))).toBe(false);
  });
});
