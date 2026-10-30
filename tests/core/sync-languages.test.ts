// @vitest-environment jsdom
// Each language's library syncs on its own through the same hubs (core/sync.ts, core/syncExchange.ts): a Japanese saved word
// travels and is kept as '@ja:v:学生' and never meets the Chinese 'v:学生'. Chinese sends and takes exactly what it did before
// languages synced, so the Chinese app live today (tests/fixtures/released, main ff6ab6c) sees no change on a new hub; and a
// new Japanese library on a hub from before keeps its records unsent, says so, and sends them once the hub is updated. The
// words and books are made up; the hubs run in process.
import 'fake-indexeddb/auto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { newSrs } from '../../src/core/srs';
import { createSyncer, setSyncEnabled, startSync, syncEnabled, type SyncOptions, type Syncer } from '../../src/core/sync';
import { SYNC_LIMITS, countRecord, exchange, inLang, noCounts, type RecordTable, type StoredRecord, type SyncReply } from '../../src/core/syncExchange';
import { createSyncStore } from '../../scripts/sync-bridge';
import { openStore } from '../../src/store';
import { createSettingsStore } from '../../src/store/settings';
import { setLangForTests } from '../../src/lang/active';
import type { LangId } from '../../src/lang/types';
import type { ImportedBook, Settings, Store, VocabItem } from '../../src/types';
import { describeSync } from '../../src/ui/settings/sync';
import { createSyncer as releasedSyncer } from '../fixtures/released/sync';
import { countRecord as releasedCount, exchange as releasedExchange } from '../fixtures/released/syncExchange';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const syncers: { stop(): void }[] = [];
afterEach(() => {
  for (const s of syncers.splice(0)) s.stop();
  localStorage.clear();
  setLangForTests(null);
  vi.useRealTimers();
});

type Hub = ReturnType<typeof hub>;
/**
 * A hub in memory: today's merge, or with `released` the one live today, over the same records, so a test can update it (or
 * roll it back) between two syncs. Released, its table is main's: it never knew a language, so it answers every record whatever
 * its key, a newer hub's '@ja:' ones included, and counts the kind by the key's first letter (an '@' record counts as nothing),
 * as main's Mac file and SQL do. `log` holds every request as sent and its reply, with the library it named ('' for Chinese).
 */
function hub(epoch = 'hub-1') {
  const data = new Map<string, StoredRecord>();
  const h = {
    released: false, epoch, version: 0, data,
    log: [] as { body: string; lang: string; reply: SyncReply }[],
    send(body: string): Promise<Response> {
      const input = JSON.parse(body) as Record<string, unknown>;
      const table: RecordTable = {
        epoch: h.epoch,
        get version() { return h.version; },
        set version(v: number) { h.version = v; },
        get: (k) => data.get(k),
        put: (k, r) => { data.set(k, r); },
        changed: (since, also, lang) => [...data].filter(([k, r]) => (h.released || inLang(k, lang)) && (r.rev > since || also.has(k))).map(([key, r]) => ({ key, at: r.at, data: r.data })),
        counts: (lang) => {
          const c = noCounts();
          for (const [k, r] of data) if (h.released) releasedCount(c, k, r.data); else if (inLang(k, lang)) countRecord(c, k, r.data);
          return c;
        },
      };
      const reply = h.released ? releasedExchange(table as never, input, Date.now()).reply as SyncReply : exchange(table, input, Date.now()).reply;
      h.log.push({ body, lang: typeof input.lang === 'string' ? input.lang : '', reply });
      return Promise.resolve(new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } }));
    },
  };
  return h;
}

let n = 0;
/** One device's library in one language, syncing with whatever hub `to` returns at the time. */
async function device(to: Hub | (() => Hub), lang: LangId = 'zh', extra: Partial<SyncOptions> = {}) {
  const store = await openStore(`langs-${lang}-${++n}-${Math.random().toString(36).slice(2)}`);
  const syncer = createSyncer(store, { send: (body) => (typeof to === 'function' ? to() : to).send(body), everyMs: 0, lang, ...extra });
  syncers.push(syncer);
  return { store, syncer };
}

const zhWord = (over: Partial<VocabItem> = {}): VocabItem => ({ id: '学生', simp: '学生', trad: '學生', pinyin: 'xue2 sheng5', gloss: 'student', addedAt: 1000, srs: newSrs(1000), ...over });
const jaWord = (over: Partial<VocabItem> = {}): VocabItem => ({ id: '学生', simp: '学生', trad: '学生', pinyin: 'がくせい', gloss: 'student (at a university)', addedAt: 2000, srs: newSrs(2000), ...over });
const jaBook = (): ImportedBook => ({
  title: '小さな話', author: '誰か', format: 'txt', script: 'unknown', assets: new Map(), sourceName: 'chiisana.txt',
  chapters: [{ title: '一', blocks: [{ t: 'p', text: '学生は本を読みました。' }] }, { title: '二', blocks: [{ t: 'p', text: '先生も来ました。' }] }],
});
const changesOf = (body: string) => (JSON.parse(body) as { changes: { key: string }[] }).changes;

function memStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); },
  };
}

describe('what a hub keeps of each library (syncExchange)', () => {
  const at = Date.now();
  it('takes a language’s records only from a request that names it, and gives each library only its own', () => {
    const h = hub();
    const send = (body: object) => { void h.send(JSON.stringify(body)); return h.log[h.log.length - 1].reply; };
    // A Chinese request (no lang) cannot write a Japanese record, nor a Japanese one a Chinese or a Spanish record.
    const zh = send({ changes: [{ key: 'v:学生', at, data: zhWord() }, { key: '@ja:v:先生', at, data: jaWord({ id: '先生' }) }] });
    const ja = send({ lang: 'ja', changes: [{ key: '@ja:v:学生', at, data: jaWord() }, { key: 'v:老师', at, data: zhWord({ id: '老师' }) }, { key: '@es:v:casa', at, data: {} }] });
    expect([...h.data.keys()].sort()).toEqual(['@ja:v:学生', 'v:学生']);
    expect(zh).not.toHaveProperty('lang');
    expect(ja.lang).toBe('ja');
    // Each sees its own: a Chinese request since 0 gets no Japanese record, and the other way around.
    expect(send({ since: 0, changes: [] }).records.map((r) => r.key)).toEqual(['v:学生']);
    expect(send({ lang: 'ja', since: 0, changes: [] }).records.map((r) => r.key)).toEqual(['@ja:v:学生']);
    expect(send({ lang: 'es', since: 0, changes: [] }).records).toEqual([]);
    expect(send({ since: 0, changes: [] }).counts).toEqual({ words: 1, known: 0, places: 0, lookups: 0, bookmarks: 0 });
  });

  it('measures a key without its prefix, and keeps only the settings the library syncs', () => {
    const h = hub();
    const long = 'あ'.repeat(SYNC_LIMITS.key - 2);
    void h.send(JSON.stringify({ lang: 'ja', changes: [
      { key: `@ja:k:${long}`, at, data: {} }, // 160 characters without '@ja:', as long as a Chinese key may be
      { key: `@ja:k:${long}い`, at, data: {} },
      { key: '@ja:o:fontSize', at, data: { v: 30 } },
      { key: '@ja:o:stress', at, data: { v: false } },
      // The reader's settings are the Chinese library's to sync: two libraries sending them would undo each other.
      { key: '@ja:o:translateTo', at, data: { v: 'fr' } },
      { key: '@ja:o:localOnly', at, data: { v: true } },
    ] }));
    void h.send(JSON.stringify({ changes: [{ key: 'o:stress', at, data: { v: false } }, { key: 'o:translateTo', at, data: { v: 'de' } }] }));
    expect([...h.data.keys()].sort()).toEqual([`@ja:k:${long}`, '@ja:o:fontSize', '@ja:o:stress', 'o:translateTo']);
  });

  it('merges a language’s lookups like Chinese ones', () => {
    const h = hub();
    const row = (count: number, last: number) => ({ word: '読んだ', pinyin: 'よんだ', gloss: 'read', count, first: 1000, last });
    void h.send(JSON.stringify({ lang: 'ja', changes: [{ key: '@ja:l:2026-10-30:読む', at: 2000, data: row(2, 2000) }] }));
    void h.send(JSON.stringify({ lang: 'ja', changes: [{ key: '@ja:l:2026-10-30:読む', at: 1500, data: row(3, 1500) }] }));
    expect(h.data.get('@ja:l:2026-10-30:読む')?.data).toMatchObject({ count: 3, last: 2000 });
  });

  it('answers a language it does not know as a hub from before languages does: not kept, not named', () => {
    const h = hub();
    void h.send(JSON.stringify({ lang: 'ko', changes: [{ key: '@ko:v:학생', at, data: {} }] }));
    expect(h.data.size).toBe(0);
    expect(h.log[0].reply).not.toHaveProperty('lang');
  });

  it('keeps them apart on the Mac too, and its status counts Chinese', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dushu-sync-lang-'));
    dirs.push(dir);
    const mac = createSyncStore({ dir });
    mac.exchange({ changes: [{ key: 'v:学生', at, data: zhWord() }] });
    const ja = mac.exchange({ lang: 'ja', changes: [{ key: '@ja:v:学生', at, data: jaWord() }, { key: '@ja:k:先生', at, data: {} }] });
    expect(ja).toMatchObject({ lang: 'ja', counts: { words: 1, known: 1 } });
    expect(ja.records.map((r) => r.key).sort()).toEqual(['@ja:k:先生', '@ja:v:学生']);
    expect(mac.exchange({ since: 0, changes: [] }).records.map((r) => r.key)).toEqual(['v:学生']);
    expect(mac.status().counts).toMatchObject({ words: 1, known: 0 });
  });
});

describe('one hub, two libraries', () => {
  it('keeps a Japanese library apart from the Chinese one, even for a word both spell 学生', async () => {
    const h = hub();
    const [zhA, zhB, jaA, jaB] = [await device(h), await device(h), await device(h, 'ja'), await device(h, 'ja')];
    await zhA.store.vocab.put(zhWord());
    await zhA.store.known.add(['老师']);
    await jaA.store.vocab.put(jaWord());
    await jaA.store.known.add(['先生']);
    for (const d of [zhA, jaA, zhB, jaB]) await d.syncer.run();
    expect((await zhB.store.vocab.get('学生'))?.pinyin).toBe('xue2 sheng5');
    expect((await jaB.store.vocab.get('学生'))?.pinyin).toBe('がくせい');
    expect([zhB.store.known.all(), jaB.store.known.all()]).toEqual([['老师'], ['先生']]);
    expect([...h.data.keys()].sort()).toEqual(['@ja:k:先生', '@ja:v:学生', 'k:老师', 'v:学生']);
    // Each library hears its own counts.
    expect(zhB.syncer.status().counts).toMatchObject({ words: 1, known: 1 });
    expect(jaB.syncer.status().counts).toMatchObject({ words: 1, known: 1 });

    // Deleting the Japanese word leaves the Chinese one, on every device and on the hub.
    await jaB.store.vocab.remove('学生');
    for (const d of [jaB, jaA, zhA, zhB]) await d.syncer.run();
    expect(await jaA.store.vocab.get('学生')).toBeUndefined();
    expect((await zhA.store.vocab.get('学生'))?.gloss).toBe('student');
    expect([h.data.get('@ja:v:学生')?.data, h.data.get('v:学生')?.data]).toEqual([null, expect.objectContaining({ pinyin: 'xue2 sheng5' })]);

    // What the Chinese library sent and got is what it always did: no language named, no prefixed key either way.
    const chinese = h.log.filter((x) => !x.lang);
    expect(chinese.length).toBeGreaterThan(3);
    for (const x of chinese) {
      expect(JSON.parse(x.body)).not.toHaveProperty('lang');
      expect(changesOf(x.body).some((c) => c.key.startsWith('@'))).toBe(false);
      expect(x.reply).not.toHaveProperty('lang');
      expect(x.reply.records.some((r) => r.key.startsWith('@'))).toBe(false);
    }
    for (const x of h.log.filter((y) => y.lang)) {
      expect([x.lang, x.reply.lang]).toEqual(['ja', 'ja']);
      expect(changesOf(x.body).every((c) => c.key.startsWith('@ja:'))).toBe(true);
      expect(x.reply.records.every((r) => r.key.startsWith('@ja:'))).toBe(true);
    }
  });

  it('brings a Japanese library’s words, known words, place, lookups, bookmarks and own settings to another device', async () => {
    const h = hub();
    // Two devices, each reading Chinese in English and Japanese; the second chose German and Local only for itself.
    const settingsA = createSettingsStore(memStorage(), 'ja');
    const settingsB = createSettingsStore(memStorage({ 'dushu.translate-to.v1': '{"to":"de","at":1}', 'dushu.local-only.v1': '1' }), 'ja');
    const a = await device(h, 'ja', { settings: settingsA });
    const b = await device(h, 'ja', { settings: settingsB });
    const bookA = await a.store.books.add(jaBook());
    const bookB = await b.store.books.add(jaBook());
    await a.store.vocab.put(jaWord({ context: { sentence: '学生は本を読みました。', bookId: bookA.id, bookTitle: '小さな話' } }));
    await a.store.known.add(['先生'], { auto: true });
    await a.store.progress.set({ bookId: bookA.id, chapter: 1, block: 0, percent: 0.6, updatedAt: Date.now() });
    await a.store.lookups.log({ day: '2026-10-30', id: '読む', word: '読んだ', pinyin: 'よんだ', gloss: 'read' }, Date.now());
    await a.store.bookmarks.put({ id: 'bm1', bookId: bookA.id, chapter: 1, block: 0, offset: 0, label: '先生も来ました', createdAt: Date.now() });
    settingsA.set({ fontSize: 30, stress: false, translateTo: 'fr', localOnly: true } as Partial<Settings>);
    await a.syncer.run();
    await b.syncer.run();

    expect((await b.store.vocab.get('学生'))?.context?.bookId).toBe(bookB.id);
    expect(b.store.known.isAuto('先生')).toBe(true);
    expect(await b.store.progress.get(bookB.id)).toMatchObject({ chapter: 1, percent: 0.6 });
    expect((await b.store.lookups.list()).map((r) => [r.id, r.word])).toEqual([['読む', '読んだ']]);
    expect((await b.store.bookmarks.list()).map((x) => [x.id, x.bookId])).toEqual([['bm1', bookB.id]]);
    // The library's own settings follow; the reader's (the language translated into, Local only) stay each device's own.
    expect(settingsB.get()).toMatchObject({ fontSize: 30, stress: false, translateTo: 'de', localOnly: true });
    expect(h.log.flatMap((x) => changesOf(x.body)).map((c) => c.key).filter((k) => /translateTo|localOnly/.test(k))).toEqual([]);
    expect(b.syncer.status()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('measures a setting against the library’s own default', async () => {
    // Spanish text starts at 21 px, Chinese at 22: a device that never touched it sends it as a default (time 0), not as a
    // choice (time 1) that would tie with 18 chosen on another device before it synced, and win the tie as the larger value.
    const h = hub();
    const chose = createSettingsStore(memStorage(), 'es');
    chose.set({ fontSize: 18 });
    await (await device(h, 'es', { settings: chose })).syncer.run();
    const fresh = createSettingsStore(memStorage(), 'es');
    expect(fresh.get().fontSize).toBe(21);
    await (await device(h, 'es', { settings: fresh })).syncer.run();
    expect(fresh.get().fontSize).toBe(18);
    expect(h.data.get('@es:o:fontSize')?.data).toEqual({ v: 18 });
  });
});

describe('a new library on a hub from before languages (main’s exchange)', () => {
  it('keeps its records unsent and says so, asks without sending them again, and sends them once the hub is updated', async () => {
    const h = hub();
    h.released = true;
    const zh = await device(h);
    const ja = await device(h, 'ja');
    await zh.store.vocab.put(zhWord());
    await ja.store.vocab.put(jaWord());
    await ja.store.known.add(['先生']);
    await zh.syncer.run();
    await ja.syncer.run();
    // Not sent to a hub that has not named the language (it would drop them), so still pending here, and nothing of it there.
    expect([...h.data.keys()]).toEqual(['v:学生']);
    expect(h.log.filter((x) => x.lang === 'ja').every((x) => changesOf(x.body).length === 0)).toBe(true);
    expect(ja.syncer.status()).toMatchObject({ state: 'outdated', hub: 'mac', pending: 2 });
    expect(describeSync(ja.syncer.status(), true)).toBe('Dushu on your Mac is older than this page and does not keep Japanese yet. Your Japanese words, places and bookmarks stay on this device and sync once it is updated. 2 changes from this device are waiting.');
    expect(await ja.store.vocab.get('学生')).toMatchObject({ pinyin: 'がくせい' });
    expect(ja.store.known.all()).toEqual(['先生']);
    // The next syncs ask, sending nothing (no loop of records the hub drops), and the Chinese library is untouched.
    const before = h.log.length;
    await ja.syncer.run();
    await ja.syncer.run();
    const asks = h.log.slice(before).filter((x) => x.lang === 'ja');
    expect(asks.length).toBe(2);
    expect(asks.every((x) => changesOf(x.body).length === 0)).toBe(true);
    expect(ja.syncer.status()).toMatchObject({ state: 'outdated', pending: 2 });
    expect(await zh.store.vocab.get('学生')).toMatchObject({ pinyin: 'xue2 sheng5' });

    // Asked from where the hub last answered, so it does not send its Chinese records again each time.
    expect(asks.map((x) => x.reply.records.length)).toEqual([0, 0]);

    // The hub is updated: the next sync sends what waited, and another Japanese device gets it.
    h.released = false;
    await ja.syncer.run();
    expect(ja.syncer.status()).toMatchObject({ state: 'idle', pending: 0 });
    expect([...h.data.keys()].sort()).toEqual(['@ja:k:先生', '@ja:v:学生', 'v:学生']);
    const other = await device(h, 'ja');
    await other.syncer.run();
    expect((await other.store.vocab.get('学生'))?.pinyin).toBe('がくせい');
    expect(other.store.known.all()).toEqual(['先生']);
  });

  it('asks before it sends anything, so a library opened with words in it sends none to such a hub', async () => {
    const h = hub();
    h.released = true;
    // The words are there when the app opens and starts the syncer, as on a device updated with a Japanese library in use.
    const store = await openStore(`langs-ask-first-${Math.random().toString(36).slice(2)}`);
    await store.vocab.put(jaWord());
    await store.known.add(['先生']);
    const ja = createSyncer(store, { send: (body) => h.send(body), everyMs: 0, lang: 'ja' });
    syncers.push(ja);
    await ja.run();
    expect(ja.status()).toMatchObject({ state: 'outdated', pending: 2 });
    expect(h.log.map((x) => changesOf(x.body).length).every((n) => n === 0)).toBe(true);
    h.released = false;
    await ja.run();
    expect(ja.status()).toMatchObject({ state: 'idle', pending: 0 });
    expect([...h.data.keys()].sort()).toEqual(['@ja:k:先生', '@ja:v:学生']);
  });

  it('sends everything it had agreed on with another hub, once the older one it moved to is updated', async () => {
    // Synced with an updated Mac, then signed in to a sync server from before languages: what it agreed on with the Mac is
    // not marked as known to the server, so it all goes there once the server is updated.
    const mac = hub('mac');
    const server = hub('server');
    server.released = true;
    let to = mac;
    const ja = await device(() => to, 'ja');
    await ja.store.vocab.put(jaWord());
    await ja.store.known.add(['先生']);
    await ja.syncer.run();
    expect(ja.syncer.status()).toMatchObject({ state: 'idle', pending: 0 });
    to = server;
    await ja.syncer.run();
    expect(ja.syncer.status()).toMatchObject({ state: 'outdated', pending: 2 });
    server.released = false;
    await ja.syncer.run();
    expect([...server.data.keys()].sort()).toEqual(['@ja:k:先生', '@ja:v:学生']);
    expect(ja.syncer.status()).toMatchObject({ state: 'idle', pending: 0 });
  });
});

describe('a hub rolled back to a version from before languages, then updated again', () => {
  // The Worker rolled back (wrangler rollback), or the Mac's server started from an older checkout on the same folder: main's
  // table keeps the '@ja:' records the newer hub stored, and answers them too, without naming the language.
  it('gives a library that was outdated meanwhile the records the hub kept before', async () => {
    const h = hub();
    const a = await device(h, 'ja');
    const b = await device(h, 'ja');
    await a.syncer.run();
    await b.syncer.run();
    await a.store.vocab.put(jaWord());
    await a.syncer.run();
    expect(h.data.has('@ja:v:学生')).toBe(true);
    h.released = true;
    await b.syncer.run();
    expect(b.syncer.status().state).toBe('outdated');
    // Main answered with the Japanese word (it keeps it), which B does not take, and its cursor did not move past it.
    expect(h.log.at(-1)?.reply.records.map((r) => r.key)).toContain('@ja:v:学生');
    expect(await b.store.vocab.get('学生')).toBeUndefined();
    h.released = false;
    await b.syncer.run();
    expect(b.syncer.status()).toMatchObject({ state: 'idle', counts: { words: 1 } });
    expect((await b.store.vocab.get('学生'))?.pinyin).toBe('がくせい');
  });

  it('gives a new device that first synced during the rollback everything, and it sent nothing then', async () => {
    const h = hub();
    const x = await device(h, 'ja');
    await x.store.vocab.put(jaWord({ id: '食べる', simp: '食べる', trad: '食べる', pinyin: 'たべる' }));
    await x.store.known.add(['先生']);
    await x.syncer.run();
    expect([...h.data.keys()].sort()).toEqual(['@ja:k:先生', '@ja:v:食べる']);
    h.released = true;
    const rolledBack = h.log.length;
    const y = await device(h, 'ja');
    await y.store.known.add(['大学']);
    await y.syncer.run();
    await y.syncer.run();
    expect(y.syncer.status()).toMatchObject({ state: 'outdated', pending: 1 });
    expect(h.log.slice(rolledBack).every((e) => changesOf(e.body).length === 0)).toBe(true);
    h.released = false;
    await y.syncer.run();
    expect(y.syncer.status()).toMatchObject({ state: 'idle', pending: 0, counts: { words: 1, known: 2 } });
    expect((await y.store.vocab.list()).map((v) => v.id)).toEqual(['食べる']);
    expect(y.store.known.all().sort()).toEqual(['先生', '大学']);
    await x.syncer.run();
    expect(x.store.known.all().sort()).toEqual(['先生', '大学']);
  });
});

describe('the Chinese app live today, on a new hub', () => {
  /**
   * The same Chinese reading on two devices, run by `make` (the released syncer or today's), against `h`. Each step syncs by
   * hand, and fake timers keep the syncers' own timers (1.5 s after a change) from adding requests of their own.
   */
  async function chineseDay(h: Hub, make: typeof releasedSyncer, japanese?: { store: Store; syncer: Syncer }) {
    // Behind the hub's clock, so no time is held back to it (which would differ from run to run).
    let t = 1_700_000_000_000;
    const now = () => (t += 1000);
    const open = async (i: number) => {
      const store = await openStore(`zh-day-${i}-${++n}-${Math.random().toString(36).slice(2)}`);
      const syncer = make(store, { send: (body) => h.send(body), everyMs: 0, now });
      syncers.push(syncer);
      return { store, syncer };
    };
    const [a, b] = [await open(1), await open(2)];
    const between = async () => { if (japanese) { await japanese.store.known.add([`語${t}`]); await japanese.syncer.run(); } };
    await a.store.vocab.put(zhWord({ addedAt: 5000, srs: newSrs(5000) }));
    await a.store.known.add(['老师']);
    await a.syncer.run();
    await between();
    await b.syncer.run();
    await b.store.vocab.review('学生', 2, 6000);
    await b.store.lookups.log({ day: '2026-10-30', id: '书', word: '书', pinyin: 'shu1', gloss: 'book' }, 7000);
    await b.syncer.run();
    await between();
    await a.syncer.run();
    await a.store.known.remove(['老师']);
    await a.syncer.run();
    await b.syncer.run();
    const state = async (s: Store) => ({
      vocab: (await s.vocab.list()).map((v) => [v.id, v.pinyin, v.srs.last]),
      known: s.known.all(),
      lookups: (await s.lookups.list()).map((r) => [r.id, r.count]),
      rows: (await s.sync.rows()).filter((r) => r.key !== '#meta').map((r) => [r.key, r.at, r.sig, r.dirty ?? 0]),
    });
    return { a: await state(a.store), b: await state(b.store) };
  }

  it('sees no change at all: the same records, counts and outcome as on the hub it has today, with a Japanese library beside it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // Today: the released Chinese app on the released hub, no other language.
    const before = hub();
    before.released = true;
    const then = await chineseDay(before, releasedSyncer);
    // After: the same app on the new hub, while a Japanese library on the same hub syncs between its steps.
    const after = hub();
    const ja = await device(after, 'ja');
    await ja.store.vocab.put(jaWord());
    const now = await chineseDay(after, releasedSyncer, ja);
    expect(now).toEqual(then);
    // It sent the same requests and got the same replies. The version alone differs: one count for the whole hub, which the
    // Japanese changes move on too, so the app's cursor (since) moves past them.
    const chinese = (h: Hub) => h.log.filter((x) => !x.lang);
    const sent = (h: Hub) => chinese(h).map((x) => x.body.replace(/"since":\d+/, '"since":#'));
    expect(sent(after)).toEqual(sent(before));
    const seen = (h: Hub) => chinese(h).map((x) => ({ records: x.reply.records, counts: x.reply.counts, keys: Object.keys(x.reply) }));
    expect(seen(after)).toEqual(seen(before));
    expect(after.log.some((x) => x.lang === 'ja' && x.reply.records.length > 0)).toBe(true);
  });

  it('is what today’s Chinese library sends, byte for byte', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const released = hub();
    const today = hub();
    const a = await chineseDay(released, releasedSyncer);
    const b = await chineseDay(today, createSyncer as typeof releasedSyncer);
    expect(b).toEqual(a);
    expect(today.log.map((x) => x.body)).toEqual(released.log.map((x) => x.body));
  });

  it('sends its settings as it always did', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const bodies: string[][] = [];
    for (const make of [releasedSyncer, createSyncer as typeof releasedSyncer]) {
      const h = hub();
      const settings = createSettingsStore(memStorage({ 'dushu.settings.pages.v1': '1', 'dushu.settings.simplified.v1': '1' }), 'zh');
      settings.set({ fontSize: 30, translateTo: 'fr' });
      const store = await openStore(`zh-settings-${++n}-${Math.random().toString(36).slice(2)}`);
      const s = make(store, { send: (body) => h.send(body), everyMs: 0, settings, now: () => 1_700_000_000_000 });
      syncers.push(s);
      await s.run();
      // The time translateTo was chosen is today's: blank it in both.
      bodies.push(h.log.map((x) => x.body.replace(/"key":"o:translateTo","at":\d+/, '"key":"o:translateTo","at":0')));
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[0].join('')).toContain('"o:translateTo"');
  });
});

describe('a library’s Sync switch', () => {
  it('is its own once set, and until then follows the Chinese one', () => {
    localStorage.setItem('dushu.sync.off.v1', '1');
    expect([syncEnabled('zh'), syncEnabled('ja')]).toEqual([false, false]);
    setSyncEnabled(true, 'ja');
    expect([syncEnabled('zh'), syncEnabled('ja'), syncEnabled('es')]).toEqual([false, true, false]);
    setSyncEnabled(true, 'zh');
    setSyncEnabled(false, 'ja');
    expect([syncEnabled('zh'), syncEnabled('ja'), syncEnabled('es')]).toEqual([true, false, true]);
    expect(localStorage.getItem('dushu.ja.sync.off.v1')).toBe('1');
  });

  it('is written down when the library first syncs, so turning Chinese off later leaves it on', async () => {
    const h = hub();
    // A reader who turned sync off (or a QA run): a library opening for the first time starts off too.
    localStorage.setItem('dushu.sync.off.v1', '1');
    const es = await device(h, 'es');
    await es.syncer.run();
    expect([es.syncer.status().state, localStorage.getItem('dushu.es.sync.off.v1')]).toEqual(['off', '1']);
    // A library that synced keeps syncing when the Chinese switch goes off (as Chinese Delete all data does).
    localStorage.removeItem('dushu.sync.off.v1');
    const ja = await device(h, 'ja');
    await ja.store.known.add(['先生']);
    await ja.syncer.run();
    setSyncEnabled(false, 'zh');
    await ja.store.known.add(['学生']);
    await ja.syncer.run();
    expect(ja.syncer.status()).toMatchObject({ state: 'idle', pending: 0 });
    expect(h.data.has('@ja:k:学生')).toBe(true);
  });

  it('is turned off by deleting the library’s data, which stays deleted, while Chinese syncs on', async () => {
    const { eraseAllData } = await import('../../src/ui/settings/data');
    const h = hub();
    const zh = await device(h);
    const other = await device(h, 'ja');
    await other.store.vocab.put(jaWord());
    await other.syncer.run();
    // This device's Japanese library, running as the app runs it (startSync), with its words synced.
    setLangForTests('ja');
    const store = await openStore(`langs-wipe-${Math.random().toString(36).slice(2)}`);
    const running = startSync(store, { send: (body) => h.send(body), everyMs: 0 });
    syncers.push(running);
    await running.run();
    expect(store.vocab.has('学生')).toBe(true);
    await eraseAllData({ store } as never);
    expect([syncEnabled('ja'), syncEnabled('zh')]).toEqual([false, true]);
    // Opened again (the page reloads): nothing comes back from the hub, which keeps its copy.
    const again = createSyncer(store, { send: (body) => h.send(body), everyMs: 0, lang: 'ja' });
    syncers.push(again);
    await again.run();
    expect(again.status().state).toBe('off');
    expect(await store.vocab.list()).toEqual([]);
    expect(h.data.get('@ja:v:学生')?.data).toMatchObject({ pinyin: 'がくせい' });
    // Chinese syncs on, and its words are where they were.
    await zh.store.vocab.put(zhWord());
    await zh.syncer.run();
    expect(zh.syncer.status()).toMatchObject({ state: 'idle', pending: 0 });
    expect(h.data.get('v:学生')).toBeDefined();
    // Turned on again, the library takes the hub's copy, as Chinese does.
    setSyncEnabled(true, 'ja');
    await again.run();
    expect(store.vocab.has('学生')).toBe(true);
  });

  for (const lang of ['ja', 'zh'] as const) {
    it(`is not filled again by a sync that was waiting on the hub when the data was deleted (${lang})`, async () => {
      const { eraseAllData } = await import('../../src/ui/settings/data');
      const h = hub();
      const other = await device(h, lang);
      await other.store.vocab.put(lang === 'ja' ? jaWord() : zhWord());
      await other.syncer.run();
      // This page's library, as the app runs it, its first request held on the way to the hub.
      setLangForTests(lang);
      const store = await openStore(`langs-wipe-race-${lang}-${Math.random().toString(36).slice(2)}`);
      let release = () => {};
      let asked = false;
      const running = startSync(store, {
        everyMs: 0,
        send: (body) => {
          if (asked) return h.send(body);
          asked = true;
          return new Promise<Response>((done) => { release = () => { void h.send(body).then(done); }; });
        },
      });
      syncers.push(running);
      await vi.waitFor(() => expect(asked).toBe(true));
      // Delete everything, and the hub's answer (with the word) arrives meanwhile.
      const erasing = eraseAllData({ store } as never);
      release();
      await erasing;
      expect(await store.vocab.list()).toEqual([]);
      expect(await store.sync.rows()).toEqual([]);
      expect(syncEnabled(lang)).toBe(false);
    });
  }
});
