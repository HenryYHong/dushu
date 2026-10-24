// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { newSrs } from '../../src/core/srs';
import { REMOTE_PROGRESS_EVENT, bookKey, canonical, createSyncer, setSyncEnabled, syncEnabled, type Syncer } from '../../src/core/sync';
import { openStore } from '../../src/store';
import type { ImportedBook, Store, VocabItem } from '../../src/types';
import { createSyncStore } from '../../scripts/sync-bridge';

let n = 0;
const open = () => openStore(`sync-${++n}-${Math.random().toString(36).slice(2)}`);

const dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'dushu-sync-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** The Mac: the real merge, called in process. `down` makes it act asleep. */
function mac() {
  const server = createSyncStore({ dir: tempDir() });
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

// Ten Han characters each. Version 2 is the newer importer's cut: one chapter.
const LUNYU = ['学而时习之不亦说乎有', '朋自远方来不亦乐乎人', '不知而不愠不亦君子乎', '其为人也孝弟而好犯上'];
const lunyu = (version = 1): ImportedBook => ({
  title: '论语', author: '孔子', format: 'txt', script: 'simplified', assets: new Map(), sourceName: 'sample:lunyu',
  ...(version > 1 ? { importVersion: version } : {}),
  chapters: version > 1
    ? [{ title: '学而', blocks: LUNYU.map((text) => ({ t: 'p' as const, text })) }]
    : [{ title: '一', blocks: LUNYU.slice(0, 2).map((text) => ({ t: 'p' as const, text })) }, { title: '二', blocks: LUNYU.slice(2).map((text) => ({ t: 'p' as const, text })) }],
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
    // A place read before a newer one elsewhere (saved here before the newer one arrived) never replaces it. A place saved
    // here after a newer one arrived is a later read, whatever this device's clock says (see the clock-behind test).
    await a.progress.set({ bookId: ba.id, chapter: 1, block: 1, percent: 0.65, updatedAt: 3_000_000 });
    await b.progress.set({ bookId: bb.id, chapter: 0, block: 0, percent: 0.1, updatedAt: 2_500_000 });
    await sa.run(); await sb.run(); await sa.run();
    expect(await a.progress.get(ba.id)).toMatchObject({ chapter: 1, block: 1 });
    expect(await b.progress.get(bb.id)).toMatchObject({ chapter: 1, block: 1 });
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

  it('a place read and deleted before the Mac heard of it still reaches the Mac, and comes back with the book', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    m.down = true;
    const sa = device(a, m);
    const ba = await a.books.add(book());
    await a.progress.set({ bookId: ba.id, chapter: 1, block: 0, offset: 2, percent: 0.7, updatedAt: 4_000_000 });
    await a.books.remove(ba.id);
    await sa.run();
    m.down = false;
    await sa.run();
    const sb = device(b, m);
    await sb.run();
    const bb = await b.books.add(book());
    expect(await b.progress.get(bb.id)).toMatchObject({ chapter: 1, block: 0, offset: 2, updatedAt: 4_000_000 });
    // Settled: nothing is sent again.
    const before = m.sent.flat().length;
    await sa.run(); await sb.run(); await sa.run();
    expect(m.sent.flat().length).toBe(before);
  });

  it('keeps the place of a book deleted while a sync is running, and opens the book there when it is added again', async () => {
    const m = mac();
    const a = await open();
    const ba = await a.books.add(book());
    const sa = device(a, m);
    await a.progress.set({ bookId: ba.id, chapter: 0, block: 0, percent: 0.2, updatedAt: 2_000_000 });
    await sa.run();
    // Read further, then a sync sends the new place; the book is deleted while the Mac's answer is on its way.
    await a.progress.set({ bookId: ba.id, chapter: 1, block: 0, offset: 3, percent: 0.8, updatedAt: 3_000_000 });
    const send = m.send;
    let asked!: () => void;
    let answer!: () => void;
    const sending = new Promise<void>((r) => { asked = r; });
    const held = new Promise<void>((r) => { answer = r; });
    m.send = async (body) => { asked(); await held; return send(body); };
    const round = sa.run();
    await sending;
    await a.books.remove(ba.id);
    answer();
    await round;
    m.send = send;
    const again = await a.books.add(book());
    expect(await a.progress.get(again.id)).toMatchObject({ chapter: 1, block: 0, offset: 3, updatedAt: 3_000_000 });
  });

  it('a place read in an older import lands in the new one by its percent, until the device that read it moves it exactly', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const ba = await a.books.add(lunyu());
    const sa = device(a, m);
    await a.progress.set({ bookId: ba.id, chapter: 1, block: 0, percent: 0.5, updatedAt: 5_000_000 });
    await sa.run();
    // A new device has only the new import: half of 42 Han characters (titles counted) is the 20th of the new chapter's text.
    const bb = await b.books.add(lunyu(2));
    const sb = device(b, m);
    await sb.run();
    expect(await b.progress.get(bb.id)).toEqual({ bookId: bb.id, chapter: 0, block: 1, offset: 9, percent: 0.5, updatedAt: 4_999_999 });
    // The first device imports it again and moves its place by the text: that wins everywhere.
    await a.books.replace(ba.id, lunyu(2));
    await sa.run(); await sb.run();
    expect(await b.progress.get(bb.id)).toEqual({ bookId: bb.id, chapter: 0, block: 2, percent: 0.5, updatedAt: 5_000_000 });
    await sa.run();
    expect(await a.progress.get(ba.id)).toEqual({ bookId: ba.id, chapter: 0, block: 2, percent: 0.5, updatedAt: 5_000_000 });
  });

  it('a place moved from an older import never replaces a newer place here, nor does a held place on a book that arrived', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const ba = await a.books.add(lunyu());
    const sa = device(a, m);
    await a.progress.set({ bookId: ba.id, chapter: 1, block: 0, percent: 0.5, updatedAt: 5_000_000 });
    await sa.run();
    // b read further in its new import before the older-key place arrives: its place stays.
    const bb = await b.books.add(lunyu(2));
    await b.progress.set({ bookId: bb.id, chapter: 0, block: 3, percent: 0.9, updatedAt: 6_000_000 });
    const sb = device(b, m);
    await sb.run();
    expect(await b.progress.get(bb.id)).toEqual({ bookId: bb.id, chapter: 0, block: 3, percent: 0.9, updatedAt: 6_000_000 });
    // A held place for a book that is here now (as after books.replace under a new key) lands only when it is newer.
    const c = await open();
    const bc = await c.books.add(book());
    await c.progress.set({ bookId: bc.id, chapter: 1, block: 0, percent: 0.9, updatedAt: 6_000_000 });
    const key = `p:${bookKey(bc)}`;
    await c.sync.write([{ key, at: 5_000_000, sig: 'older', held: { chapter: 0, block: 0, percent: 0.1, updatedAt: 5_000_000 } }]);
    await device(c, m).run();
    expect(await c.progress.get(bc.id)).toMatchObject({ chapter: 1, updatedAt: 6_000_000 });
    expect((await c.sync.rows()).find((r) => r.key === key)?.held).toBeUndefined();
  });

  it('a word marked known on a device that synced before beats an older un-mark made elsewhere', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const [ca, cb] = [{ t: 1_000_000 }, { t: 1_000_000 }];
    const sa = device(a, m, ca);
    const sb = device(b, m, cb);
    await sa.run();
    await b.known.add(['书']);
    await sb.run();
    cb.t = 2_000_000;
    await b.known.remove(['书']);
    await sb.run();
    // a has not synced since, and marks the word later.
    ca.t = 3_000_000;
    await a.known.add(['书']);
    await sa.run(); await sb.run();
    expect(a.known.has('书')).toBe(true);
    expect(b.known.has('书')).toBe(true);
  });

  it('deleting a book does not send its saved words again over a newer review made elsewhere', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const [ca, cb] = [{ t: 1_000_000 }, { t: 1_000_000 }];
    const ba = await a.books.add(book());
    await a.vocab.put(word('银行', { context: { sentence: '去银行', bookTitle: '活着', bookId: ba.id } }));
    const sa = device(a, m, ca);
    const sb = device(b, m, cb);
    await sa.run(); await sb.run();
    cb.t = 2_000_000;
    await b.vocab.review('银行', 2, 2_000_000);
    await sb.run();
    // a has not heard of the review when it deletes the book.
    ca.t = 3_000_000;
    const sent = m.sent.length;
    await a.books.remove(ba.id);
    await sa.run(); await sb.run();
    expect(m.sent.slice(sent).flat().map((c) => (c as { key: string }).key)).not.toContain('v:银行');
    expect((await b.vocab.get('银行'))?.srs.last).toBe(2_000_000);
    expect((await a.vocab.get('银行'))?.srs.last).toBe(2_000_000);
  });

  it('a device whose clock is ahead takes the Mac\'s time for its change, so it still receives newer ones', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const fast = { t: Date.now() + 86_400_000 };
    const normal = { t: Date.now() };
    const sa = device(a, m, fast);
    const sb = device(b, m, normal);
    await a.vocab.put(word('银行'));
    await sa.run(); await sb.run();
    // The Mac stores a's review at its own time plus ten minutes at most.
    await a.vocab.review('银行', 2, fast.t);
    await sa.run(); await sb.run();
    normal.t += 1000;
    await b.vocab.review('银行', 3, normal.t);
    await sb.run(); await sa.run();
    expect((await a.vocab.get('银行'))?.srs).toEqual((await b.vocab.get('银行'))?.srs);
    expect((await a.vocab.get('银行'))?.srs.last).toBe(normal.t);
  });

  it('a device whose clock is behind keeps a place read after the one it received', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const ba = await a.books.add(book());
    const bb = await b.books.add(book());
    const sa = device(a, m);
    const sb = device(b, m);
    await a.progress.set({ bookId: ba.id, chapter: 1, block: 0, percent: 0.6, updatedAt: 5_000_000 });
    await sa.run(); await sb.run();
    expect((await b.progress.get(bb.id))?.updatedAt).toBe(5_000_000);
    // b's clock is an hour behind: the place it reads next carries an earlier time than the one it has.
    await b.progress.set({ bookId: bb.id, chapter: 1, block: 0, offset: 6, percent: 0.7, updatedAt: 5_000_000 - 3_600_000 });
    await sb.run(); await sa.run();
    expect(await b.progress.get(bb.id)).toMatchObject({ offset: 6 });
    expect(await a.progress.get(ba.id)).toMatchObject({ offset: 6 });
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
    const replaced = createSyncStore({ dir: tempDir() });
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

describe('looked-up words and bookmarks', () => {
  const DAY = '2026-10-24';
  const log = (s: Store, id: string, at: number, extra: { word?: string; gloss?: string } = {}) =>
    s.lookups.log({ day: DAY, id, word: extra.word ?? id, pinyin: 'yin2 hang2', gloss: extra.gloss ?? 'bank' }, at);

  it('brings words looked up on either device to both, keeps both devices\' lookups of the same word, and removals', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const sa = device(a, m);
    const sb = device(b, m);
    await log(a, '银行', 2_000_000);
    await log(a, '银行', 2_100_000);
    await log(a, '银行', 2_200_000);
    await sa.run();
    // b looked the same word up that day before it heard of a's, and another word too.
    await log(b, '银行', 1_500_000, { word: '銀行' });
    await log(b, '水', 1_600_000, { gloss: 'water' });
    await sb.run(); await sa.run(); await sb.run();
    for (const s of [a, b]) {
      const rows = await s.lookups.list();
      expect(rows.map((r) => r.id).sort()).toEqual(['水', '银行']);
      // The most lookups either device made, from the first to the last of all of them, with the last one's words.
      expect(rows.find((r) => r.id === '银行')).toMatchObject({ count: 3, first: 1_500_000, last: 2_200_000, word: '银行' });
    }
    expect(m.server.status().counts.lookups).toBe(2);
    // A lookup made here after the merge still counts.
    await log(b, '银行', 2_500_000);
    await sb.run(); await sa.run();
    expect((await a.lookups.list()).find((r) => r.id === '银行')).toMatchObject({ count: 4, last: 2_500_000 });

    // Settled: nothing goes back and forth.
    const before = m.sent.length;
    await sa.run(); await sb.run(); await sa.run();
    expect(m.sent.slice(before).every((c) => c.length === 0)).toBe(true);

    await b.lookups.remove(DAY, '水');
    await sb.run(); await sa.run();
    expect((await a.lookups.list()).map((r) => r.id)).toEqual(['银行']);
  });

  it('a lookup made while the Mac was asleep is not lost to the copy the Mac sends back', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const [ca, cb] = [{ t: 1_000_000 }, { t: 1_000_000 }];
    const sa = device(a, m, ca);
    const sb = device(b, m, cb);
    await log(a, '书', 2_000_000);
    await sa.run(); await sb.run();
    m.down = true;
    cb.t = 3_000_000;
    await log(b, '书', 3_000_000);
    await log(b, '书', 3_100_000);
    await sb.run();
    m.down = false;
    // a looks it up again later, and syncs first: its copy (2 lookups) is newer than b's offline one (3 lookups).
    ca.t = 4_000_000;
    await log(a, '书', 4_000_000);
    await sa.run(); await sb.run(); await sa.run();
    for (const s of [a, b]) expect((await s.lookups.list())[0]).toMatchObject({ count: 3, first: 2_000_000, last: 4_000_000 });
  });

  it('puts a bookmark in the same book on the other device, and removes it there', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const ba = await a.books.add(book());
    const bb = await b.books.add(book());
    expect(ba.id).not.toBe(bb.id);
    const sa = device(a, m);
    const sb = device(b, m);
    await a.bookmarks.put({ id: `${ba.id}:1`, bookId: ba.id, chapter: 1, block: 0, offset: 3, label: '获得了', createdAt: 2_000_000, bookKey: bookKey(ba) });
    await sa.run(); await sb.run();
    expect(await b.bookmarks.list(bb.id)).toEqual([expect.objectContaining({ id: `${ba.id}:1`, bookId: bb.id, chapter: 1, offset: 3, label: '获得了' })]);
    expect(m.server.status().counts.bookmarks).toBe(1);
    const before = m.sent.length;
    await sa.run(); await sb.run(); await sa.run();
    expect(m.sent.slice(before).every((c) => c.length === 0)).toBe(true);
    await b.bookmarks.remove(`${ba.id}:1`);
    await sb.run(); await sa.run();
    expect(await a.bookmarks.list()).toEqual([]);
  });

  it('keeps a bookmark for a book that is not on the device yet, and deleting the book keeps it on the other device', async () => {
    const m = mac();
    const [a, b] = [await open(), await open()];
    const ba = await a.books.add(book());
    const sa = device(a, m);
    const sb = device(b, m);
    // Made before bookmarks carried their book's key: it gets it from the book here.
    await a.bookmarks.put({ id: 'm1', bookId: ba.id, chapter: 0, block: 0, offset: 0, label: '我比现在', createdAt: 2_000_000 });
    await sa.run(); await sb.run();
    expect(await b.bookmarks.list()).toHaveLength(1);
    const bb = await b.books.add(book());
    await sb.run();
    expect((await b.bookmarks.list(bb.id)).map((x) => x.id)).toEqual(['m1']);
    // Deleting the book on b (bookmarks stay with it, for when it is added again) sends nothing, and a keeps the bookmark.
    const sent = m.sent.length;
    await b.books.remove(bb.id);
    await sb.run(); await sa.run();
    expect(m.sent.slice(sent).flat()).toEqual([]);
    expect((await a.bookmarks.list(ba.id)).map((x) => x.id)).toEqual(['m1']);
    // Added again (a new id here): the bookmark is in it.
    const again = await b.books.add(book());
    await sb.run();
    expect((await b.bookmarks.list(again.id)).map((x) => x.id)).toEqual(['m1']);
  });
});

describe('QA pages on a server the script did not start', () => {
  it('keep sync off, even after the page clears its storage', async () => {
    const src = (await import('node:fs')).readFileSync('scripts/qa.mjs', 'utf8');
    const body = /const SYNC_OFF = \(\) => \{([\s\S]*?)\n\};/.exec(src)?.[1];
    expect(body).toBeTruthy();
    const clear = Storage.prototype.clear;
    try {
      new Function(body!)();
      expect(syncEnabled()).toBe(false);
      localStorage.clear();
      expect(syncEnabled()).toBe(false);
    } finally {
      Storage.prototype.clear = clear;
      localStorage.clear();
    }
    expect(syncEnabled()).toBe(true);
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
