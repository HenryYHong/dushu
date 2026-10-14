import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/store';

let n = 0;
const dbName = () => `auto-${++n}-${Math.random().toString(36).slice(2)}`;
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('known words learned from reading', () => {
  it('a learned word is known and says so; it never replaces a word marked by hand', async () => {
    const store = await openStore(dbName());
    await store.known.add(['你好']);
    await store.known.add(['你好', '世界'], { auto: true });
    expect(store.known.has('世界')).toBe(true);
    expect(store.known.isAuto('世界')).toBe(true);
    expect(store.known.isAuto('你好')).toBe(false);
    expect(store.known.count()).toBe(2);
    expect(store.known.autoCount()).toBe(1);
  });

  it('marking a learned word by hand makes it a word marked by hand', async () => {
    const store = await openStore(dbName());
    await store.known.add(['世界'], { auto: true });
    await store.known.add(['世界']);
    expect(store.known.isAuto('世界')).toBe(false);
    expect(store.known.autoCount()).toBe(0);
    expect(store.known.has('世界')).toBe(true);
  });

  it('removing a learned word clears the mark too', async () => {
    const store = await openStore(dbName());
    await store.known.add(['世界'], { auto: true });
    await store.known.remove(['世界']);
    expect(store.known.has('世界')).toBe(false);
    expect(store.known.isAuto('世界')).toBe(false);
    expect(store.known.autoCount()).toBe(0);
  });

  it('isAuto matches the other script once the normalizer is set', async () => {
    const store = await openStore(dbName());
    const toSimp = (w: string) => w.replace('銀', '银');
    await store.known.add(['银行'], { auto: true });
    expect(store.known.isAuto('銀行')).toBe(false);
    store.setNormalizer(toSimp);
    expect(store.known.isAuto('銀行')).toBe(true);
    // A word marked by hand in its own spelling is not learned, whatever another spelling says.
    await store.known.add(['銀行']);
    expect(store.known.isAuto('銀行')).toBe(false);
  });

  it('the mark survives a reload, a change in another tab, and a backup', async () => {
    const name = dbName();
    const a = await openStore(name);
    const b = await openStore(name);
    await a.known.add(['山'], { auto: true });
    await a.known.add(['水']);
    await settle();
    expect(b.known.isAuto('山')).toBe(true);
    expect(b.known.isAuto('水')).toBe(false);
    const again = await openStore(name);
    expect(again.known.isAuto('山')).toBe(true);
    expect(again.known.autoCount()).toBe(1);

    const json = await a.exportBackup();
    expect(JSON.parse(json).knownAuto).toEqual(['山']);
    const fresh = await openStore(dbName());
    await fresh.importBackup(json);
    expect(fresh.known.has('山')).toBe(true);
    expect(fresh.known.isAuto('山')).toBe(true);
    expect(fresh.known.isAuto('水')).toBe(false);
  });

  it('a wipe forgets learned words and the counts', async () => {
    const store = await openStore(dbName());
    await store.known.add(['山'], { auto: true });
    await store.seen.put([{ word: '水', n: 3, days: 1, lastDay: 100 }]);
    await store.wipe();
    expect(store.known.autoCount()).toBe(0);
    expect(await store.seen.get(['水'])).toEqual([]);
  });
});

describe('seen counts', () => {
  it('get returns only the rows that exist; put, remove and clear', async () => {
    const store = await openStore(dbName());
    await store.seen.put([{ word: '山', n: 2, days: 1, lastDay: 10 }, { word: '水', n: 1, days: 1, lastDay: 10 }]);
    expect((await store.seen.get(['山', '火', '山'])).map((r) => r.word)).toEqual(['山']);
    await store.seen.remove(['山']);
    expect(await store.seen.get(['山'])).toEqual([]);
    await store.seen.clear();
    expect(await store.seen.get(['水'])).toEqual([]);
  });
});
