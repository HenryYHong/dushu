// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newSrs } from '../../src/core/srs';
import { REMOTE_PROGRESS_EVENT, bookKey, canonical, createSyncer, setSyncEnabled, type Syncer } from '../../src/core/sync';
import { openStore } from '../../src/store';
import type { ImportedBook, Store, VocabItem } from '../../src/types';
import { createSyncStore } from '../../scripts/sync-bridge';

let n = 0;
const open = () => openStore(`sync-${++n}-${Math.random().toString(36).slice(2)}`);

/** The Mac: the real merge, called in process. `down` makes it act asleep. */
function mac() {
  const server = createSyncStore({ dir: mkdtempSync(join(tmpdir(), 'dushu-sync-')) });
  const m = {
    server,
    down: false,
    requests: 0,
    sent: [] as unknown[][],
    send: (body: string) => {
      if (m.down) return Promise.reject(new TypeError('Load failed'));
      m.requests++;
      const parsed = JSON.parse(body);
      m.sent.push(parsed.changes);
      return Promise.resolve(new Response(JSON.stringify(server.exchange(parsed)), { status: 200, headers: { 'content-type': 'application/json' } }));
    },
  };
  return m;
}

const syncers: Syncer[] = [];
function device(store: Store, m: ReturnType<typeof mac>, clock = { t: 1_000_000 }) {
  const s = createSyncer(store, { send: (body) => m.send(body), everyMs: 0, now: () => clock.t });
  syncers.push(s);
  return s;
}
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); setSyncEnabled(true); });

const word = (simp: string, over: Partial<VocabItem> = {}): VocabItem => ({
  id: simp, simp, trad: simp, pinyin: 'yin2 hang2', gloss: 'bank', addedAt: 1000, srs: newSrs(1000), ...over,
});
const book = (): ImportedBook => ({
  title: '活着', author: '余华', format: 'txt', script: 'simplified', assets: new Map(), sourceName: 'huozhe.txt',
  chapters: [{ title: '一', blocks: [{ t: 'p', text: '我比现在年轻十岁的时候' }] }, { title: '二', blocks: [{ t: 'p', text: '获得了一个游手好闲的职业' }] }],
});

describe('sync between two devices', () => {
  it('brings saved words, reviews and deletions across, and settles', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const sa = device(a, m);
    const sb = device(b, m);
    await Promise.all([sa.run(), sb.run()]);

    await a.vocab.put(word('银行', { context: { sentence: '去银行', bookTitle: '活着' } }));
    await sa.run();
    await sb.run();
    expect((await b.vocab.get('银行'))?.context?.sentence).toBe('去银行');
    expect(b.vocab.has('银行')).toBe(true);

    // Nothing to send once both agree: no record bounces back and forth.
    const before = m.sent.length;
    await sa.run(); await sb.run(); await sa.run();
    expect(m.sent.slice(before).every((c) => c.length === 0)).toBe(true);

    await b.vocab.review('银行', 2, 5_000_000);
    await sb.run();

    await sa.run();
    expect((await a.vocab.get('银行'))?.srs).toEqual((await b.vocab.get('银行'))?.srs);
    expect((await a.vocab.get('银行'))?.srs.last).toBe(5_000_000);

    await a.vocab.remove('银行');
    await sa.run();
    await sb.run();
    expect(await b.vocab.get('银行')).toBeUndefined();
    expect(sb.status()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('syncs known words, keeps the learned-from-reading mark, and removals', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const sa = device(a, m);
    const sb = device(b, m);
    await a.known.add(['你好', '谢谢']);
    await a.known.add(['读书'], { auto: true });
    await sa.run(); await sb.run();
    expect(b.known.all().sort()).toEqual(['你好', '读书', '谢谢'].sort());
    expect(b.known.isAuto('读书')).toBe(true);
    expect(b.known.isAuto('你好')).toBe(false);
    await b.known.remove(['谢谢']);
    await sb.run(); await sa.run();
    expect(a.known.has('谢谢')).toBe(false);
    // The person marking a learned word turns it into theirs, on both devices.
    await a.known.add(['读书']);
    await sa.run(); await sb.run();
    expect(b.known.isAuto('读书')).toBe(false);
  });

  it('moves the reading place to the other device and says so', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const ba = await a.books.add(book());
    const bb = await b.books.add(book());
    expect(bookKey(ba)).toBe(bookKey(bb));
    const sa = device(a, m);
    const sb = device(b, m);
    await Promise.all([sa.run(), sb.run()]);
    const heard: unknown[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener(REMOTE_PROGRESS_EVENT, listen);
    await a.progress.set({ bookId: ba.id, chapter: 1, block: 0, offset: 4, percent: 0.6, updatedAt: 2_000_000 });
    await sa.run(); await sb.run();
    window.removeEventListener(REMOTE_PROGRESS_EVENT, listen);
    expect(await b.progress.get(bb.id)).toEqual({ bookId: bb.id, chapter: 1, block: 0, offset: 4, percent: 0.6, updatedAt: 2_000_000 });
    expect(heard).toEqual([{ bookId: bb.id, progress: expect.objectContaining({ chapter: 1, offset: 4 }) }]);
    // An older place never replaces a newer one.
    await b.progress.set({ bookId: bb.id, chapter: 0, block: 0, percent: 0.1, updatedAt: 1_500_000 });
    await sb.run(); await sa.run();
    expect((await a.progress.get(ba.id))?.chapter).toBe(1);
  });

  it('keeps a place for a book that is not on the device yet, and uses it when the book arrives', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const ba = await a.books.add(book());
    const sa = device(a, m);
    await a.progress.set({ bookId: ba.id, chapter: 1, block: 0, percent: 0.5, updatedAt: 3_000_000 });
    await sa.run();
    const sb = device(b, m);
    await sb.run();
    const bb = await b.books.add(book());
    await sb.run();
    expect((await b.progress.get(bb.id))?.chapter).toBe(1);
    // Removing the book on one device keeps the place on the other.
    await b.books.remove(bb.id);
    await sb.run(); await sa.run();
    expect((await a.progress.get(ba.id))?.chapter).toBe(1);
  });

  it('a device that lost its data only receives: it never deletes words on the Mac', async () => {
    const m = mac();
    const a = await open();
    const sa = device(a, m);
    await a.vocab.put(word('学习'));
    await a.known.add(['学习']);
    await sa.run();
    await a.wipe();
    await sa.run();
    expect(await a.vocab.get('学习')).toBeDefined();
    expect(a.known.has('学习')).toBe(true);
  });

  it('an old copy on a new device does not beat a newer one, and changes wait while the Mac sleeps', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    await a.vocab.put(word('银行', { srs: { ...newSrs(1000), reps: 3, last: 4_000_000 } }));
    const sa = device(a, m);
    await sa.run();
    await b.vocab.put(word('银行')); // saved long ago, never reviewed
    const sb = device(b, m);
    await sb.run();
    expect((await b.vocab.get('银行'))?.srs.reps).toBe(3);

    m.down = true;
    await b.known.add(['晚上']);
    await sb.run();
    expect(sb.status()).toMatchObject({ state: 'asleep', pending: 1 });
    m.down = false;
    await sb.run();
    await sa.run();
    expect(a.known.has('晚上')).toBe(true);
    expect(sb.status().pending).toBe(0);
  });

  it('a word saved on a device that never synced keeps the copy that was studied more', async () => {
    const m = mac();
    const [a, b, c] = [await open(), await open(), await open()];
    const sa = device(a, m);
    await a.vocab.put(word('银行', { srs: { ...newSrs(1000), reps: 4, last: 3_000_000 } }));
    await a.vocab.put(word('火车', { srs: { ...newSrs(1000), reps: 1, last: 2_000_000 } }));
    await a.vocab.put(word('读书'));
    await sa.run();
    await a.vocab.remove('读书');
    await sa.run();
    // B saved 银行 just now (never studied), studied 火车 more than A, and saved 读书 after A deleted it.
    await b.vocab.put(word('银行', { addedAt: 9_000_000 }));
    await b.vocab.put(word('火车', { srs: { ...newSrs(1000), reps: 6, last: 8_000_000 } }));
    await b.vocab.put(word('读书', { addedAt: 9_000_000 }));
    const sb = device(b, m);
    await sb.run();
    await sa.run();
    for (const s of [a, b]) {
      expect((await s.vocab.get('银行'))?.srs.reps).toBe(4);
      expect((await s.vocab.get('火车'))?.srs.reps).toBe(6);
      expect(await s.vocab.get('读书')).toBeDefined();
    }
    // A third device that never saved them just receives them.
    const sc = device(c, m);
    await sc.run();
    expect((await c.vocab.list()).map((v) => v.id).sort()).toEqual(['火车', '读书', '银行'].sort());
  });

  it('sends everything again when the Mac starts a new copy', async () => {
    const m = mac();
    const a = await open();
    const sa = device(a, m);
    await a.known.add(['一', '二']);
    await sa.run();
    // The Mac's file was lost: a new copy with a new epoch.
    const replaced = createSyncStore({ dir: mkdtempSync(join(tmpdir(), 'dushu-sync-')) });
    m.server.exchange = replaced.exchange;
    await a.known.add(['三']);
    await sa.run();
    expect(replaced.status().counts.known).toBe(3);
  });

  it('does nothing when switched off, and sends what waited when switched on', async () => {
    const m = mac();
    const a = await open();
    const sa = device(a, m);
    await sa.run();
    setSyncEnabled(false);
    await a.known.add(['猫']);
    await sa.run();
    expect(sa.status()).toMatchObject({ state: 'off', pending: 1 });
    expect(m.server.status().counts.known).toBe(0);
    setSyncEnabled(true);
    await sa.run();
    expect(m.server.status().counts.known).toBe(1);
  });
});

describe('sync keys', () => {
  it('names a book the same on every device', () => {
    const base = { title: 'x', chapterCount: 2, charCount: 10, chapterTitles: ['a', 'b'] };
    expect(bookKey({ ...base, note: `mac-book:${'a'.repeat(64)}` })).toBe(`m${'a'.repeat(32)}`);
    expect(bookKey({ ...base, sourceName: 'sample:xiyouji' })).toBe('sxiyouji');
    // Imported again with chapters cut differently: another book to sync, so an old place never lands in the new chapters.
    expect(bookKey({ ...base, note: `mac-book:${'a'.repeat(64)}`, importVersion: 2 })).toBe(`m${'a'.repeat(32)}.2`);
    expect(bookKey({ ...base, sourceName: 'sample:xiyouji', importVersion: 2 })).toBe('sxiyouji.2');
    expect(bookKey({ ...base, sourceName: 'sample:xiyouji', importVersion: 1 })).toBe('sxiyouji');
    expect(bookKey(base)).toBe(bookKey({ ...base, title: 'renamed' }));
    expect(bookKey(base)).not.toBe(bookKey({ ...base, charCount: 11 }));
  });
  it('writes records the same way whatever the key order', () => {
    expect(canonical({ b: 1, a: { d: [1, { y: 2, x: undefined }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2}]},"b":1}');
  });
});
