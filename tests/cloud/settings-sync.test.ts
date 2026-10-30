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

describe('the language translated into', () => {
  /** A device whose libraries share `storage`, as one browser's do; the syncer reads the same clock as the settings. */
  async function reader(storage = memStorage({ 'dushu.settings.pages.v1': '1', 'dushu.settings.simplified.v1': '1' })) {
    const store = await openStore(`target-${Math.random()}`);
    const open = () => {
      const settings = createSettingsStore(storage);
      const syncer = createSyncer(store, { everyMs: 0, settings, now: () => Date.now() });
      syncers.push(syncer);
      return { settings, syncer };
    };
    return { storage, store, open, ...open() };
  }

  it('is stamped when it was chosen, in whichever library, so an older choice never beats a newer one from another device', async () => {
    const hour = 3_600_000;
    const nine = Date.now() + hour;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(nine);
      const ipad = await reader();
      const mac = await reader();
      await ipad.syncer.run(); await mac.syncer.run();
      // 10:00, iPad, reading a Spanish book: French. Only the Chinese library syncs, and it stays closed for now.
      vi.setSystemTime(nine + hour);
      ipad.syncer.stop();
      createSettingsStore(ipad.storage, 'es').set({ translateTo: 'fr' });
      // 11:00, Mac, in Chinese: German, synced at once.
      vi.setSystemTime(nine + 2 * hour);
      mac.settings.set({ translateTo: 'de' });
      await mac.syncer.run();
      // 12:00, the iPad opens Chinese. It starts from French, but German was chosen later and wins on both.
      vi.setSystemTime(nine + 3 * hour);
      const later = ipad.open();
      expect(later.settings.get().translateTo).toBe('fr');
      await later.syncer.run(); await mac.syncer.run();
      expect([later.settings.get().translateTo, mac.settings.get().translateTo]).toEqual(['de', 'de']);
      expect(createSettingsStore(ipad.storage, 'es').get().translateTo).toBe('de');

      // A choice in the Spanish library made after the Mac's still wins when the Chinese library notices it.
      vi.setSystemTime(nine + 4 * hour);
      mac.settings.set({ translateTo: 'ko' });
      await mac.syncer.run();
      vi.setSystemTime(nine + 5 * hour);
      later.syncer.stop();
      createSettingsStore(ipad.storage, 'es').set({ translateTo: 'it' });
      vi.setSystemTime(nine + 6 * hour);
      const last = ipad.open();
      await last.syncer.run(); await mac.syncer.run();
      expect([last.settings.get().translateTo, mac.settings.get().translateTo]).toEqual(['it', 'it']);
    } finally { vi.useRealTimers(); }
  });

  it('is sent again after a hub that dropped it, from before the setting, is updated', async () => {
    const hub = globalThis.fetch;
    let older = true;
    // A hub from before translateTo drops the name, as main's exchange did: not kept, not echoed.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (older && String(input).endsWith('/sync') && typeof init?.body === 'string') {
        const body = JSON.parse(init.body) as { changes?: { key: string }[] };
        body.changes = body.changes?.filter((c) => c.key !== 'o:translateTo');
        init = { ...init, body: JSON.stringify(body) };
      }
      return hub(input, init);
    });
    const a = await reader();
    const b = await reader();
    await a.syncer.run(); await b.syncer.run();
    a.settings.set({ translateTo: 'fr', fontSize: 30 });
    await a.syncer.run(); await b.syncer.run();
    // The rest arrives; the choice the hub did not keep waits on the device that made it.
    expect(b.settings.get()).toMatchObject({ fontSize: 30, translateTo: 'en' });
    expect(a.syncer.status().pending).toBe(1);
    await a.syncer.run();
    expect(a.syncer.status().pending).toBe(1);
    older = false;
    await a.syncer.run(); await b.syncer.run();
    expect(b.settings.get().translateTo).toBe('fr');
    expect([a.syncer.status().pending, b.syncer.status().pending]).toEqual([0, 0]);
  });
});
