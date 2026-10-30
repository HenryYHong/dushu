// @vitest-environment jsdom
// Each language's library through the sync account (the Worker, cloud/src): a Chinese and a Japanese library signed in to one
// account stay apart, Chinese in its own room; a new Japanese library on the Worker live today (tests/fixtures/released/cloud)
// keeps its records and says the server needs updating, and one outdated while the Worker was rolled back to it gets what the
// Worker kept once it is updated again; the Mac's records are copied into the owner's account library by library; and the SQL
// runs on a real SQLite, beside main's own. The page here is on localhost, so it is a device on the Mac: its bridge is its own
// origin. The server runs in process; the Mac's copy is in a temporary folder, or in memory for a Mac from before languages.
import 'fake-indexeddb/auto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../cloud/src/worker';
import { SHARED_RECORD_BYTES } from '../../cloud/src/account';
import { sqlStore, type SqlStorage } from '../../cloud/src/sqlStore';
import { createSyncStore } from '../../scripts/sync-bridge';
import { cloudSession, deleteAccount, requestCode, signIn } from '../../src/core/cloud';
import { copyMacIntoAccount, createSyncer, type Syncer } from '../../src/core/sync';
import { countRecord, exchange, inLang, noCounts, type RecordTable, type StoredRecord, type SyncReply } from '../../src/core/syncExchange';
import { countRecord as releasedCount, exchange as releasedExchange } from '../fixtures/released/syncExchange';
import { sqlStore as releasedSqlStore } from '../fixtures/released/cloud/sqlStore';
import { newSrs } from '../../src/core/srs';
import { openStore } from '../../src/store';
import type { LangId } from '../../src/lang/types';
import type { VocabItem } from '../../src/types';
import { cloud, signedIn } from './helpers';

const dirs: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'dushu-cloud-lang-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const syncers: Syncer[] = [];
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });
beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

const word = (id: string, reading: string, over: Partial<VocabItem> = {}): VocabItem => ({ id, simp: id, trad: id, pinyin: reading, gloss: id, addedAt: 1000, srs: newSrs(1000), ...over });

/** A Mac in memory whose server is, while `released`, the one live today: main's merge over main's table (every record). */
function oldMac() {
  const data = new Map<string, StoredRecord>();
  const m = {
    released: true, version: 0, data,
    exchange(input: Record<string, unknown>): SyncReply {
      const table: RecordTable = {
        epoch: 'mac-1',
        get version() { return m.version; },
        set version(v: number) { m.version = v; },
        get: (k) => data.get(k),
        put: (k, r) => { data.set(k, r); },
        changed: (since, also, lang) => [...data].filter(([k, r]) => (m.released || inLang(k, lang)) && (r.rev > since || also.has(k))).map(([key, r]) => ({ key, at: r.at, data: r.data })),
        counts: (lang) => {
          const c = noCounts();
          for (const [k, r] of data) if (m.released) releasedCount(c, k, r.data); else if (inLang(k, lang)) countRecord(c, k, r.data);
          return c;
        },
      };
      return m.released ? releasedExchange(table as never, input, Date.now()).reply as SyncReply : exchange(table, input, Date.now()).reply;
    },
  };
  return m;
}

/**
 * The account (today's Worker, or with `released` the one live today) and the Mac's copy, behind one fetch as the page sees
 * them. `bodies` are the requests sent to /sync, `macCalls` those sent to the Mac's /api/sync with its answers.
 */
function world(opts: { mac?: boolean | ReturnType<typeof oldMac>; owner?: string } = {}) {
  const state = { released: false };
  const c = cloud({ OWNER_EMAILS: opts.owner ?? 'reader@example.com' } as Partial<Env>, { released: () => state.released });
  const bridge = createSyncStore({ dir: tempDir() });
  const mac: { exchange(input: Record<string, unknown>): SyncReply } = typeof opts.mac === 'object' ? opts.mac : bridge;
  let code = '';
  const bodies: { lang: string; changes: { key: string }[]; reply?: { records?: { key: string }[]; lang?: string } }[] = [];
  const macCalls: { body: Record<string, unknown>; reply: SyncReply }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(new URL(String(input instanceof Request ? input.url : input), 'http://localhost:3000/'), init);
    const url = new URL(req.url);
    const body = req.method === 'GET' ? undefined : await req.text();
    if (url.origin === 'https://sync.test') {
      const res = await c.fetch(new Request(req.url, { method: req.method, headers: req.headers, body }));
      if (url.pathname === '/sync' && body) {
        const b = JSON.parse(body) as { lang?: string; changes?: { key: string }[] };
        bodies.push({ lang: b.lang ?? '', changes: b.changes ?? [], reply: res.ok ? await res.clone().json() : undefined });
      }
      if (url.pathname === '/auth/code' && res.ok) code = (await res.clone().json() as { devCode: string }).devCode;
      return res;
    }
    if (!opts.mac) return Promise.reject(new TypeError('Load failed'));
    if (url.pathname === '/api/private-status') return Response.json({ app: 'dushu', url: 'https://my-mac.tail1234.ts.net:8443' });
    if (url.pathname === '/api/sync') {
      const input = JSON.parse(body ?? '{}') as Record<string, unknown>;
      const reply = mac.exchange(input);
      macCalls.push({ body: input, reply });
      return Response.json(reply);
    }
    return new Response(null, { status: 404 });
  });
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  const login = async (email = 'reader@example.com') => { await requestCode(email); await signIn(email, code); };
  return { c, mac: bridge, login, bodies, state, macCalls };
}

/** A request to /sync as the signed-in page, and the account's answer. */
const post = async (w: ReturnType<typeof world>, body: object) => {
  const res = await w.c.post('/sync', body, cloudSession()!.token);
  return { status: res.status, reply: await res.json() as SyncReply & { error?: string; code?: string } };
};
const pad = (bytes: number) => ({ p: 'x'.repeat(bytes - 8) });

/** A library on this page signed in to the account (the page's own fetch, so the sign-in in localStorage is shared). */
async function library(lang: LangId) {
  const store = await openStore(`cloud-lang-${lang}-${Math.random().toString(36).slice(2)}`);
  const syncer = createSyncer(store, { everyMs: 0, lang });
  syncers.push(syncer);
  return { store, syncer };
}

describe('one account, two libraries', () => {
  it('keeps a Chinese and a Japanese library apart, and each one’s words reach its own library on another device', async () => {
    const w = world();
    await w.login();
    const [zh, ja, zh2, ja2] = [await library('zh'), await library('ja'), await library('zh'), await library('ja')];
    await zh.store.vocab.put(word('学生', 'xue2 sheng5'));
    await ja.store.vocab.put(word('学生', 'がくせい'));
    for (const d of [zh, ja, zh2, ja2]) await d.syncer.run();
    expect((await zh2.store.vocab.get('学生'))?.pinyin).toBe('xue2 sheng5');
    expect((await ja2.store.vocab.get('学生'))?.pinyin).toBe('がくせい');
    expect(zh2.syncer.status()).toMatchObject({ state: 'idle', hub: 'cloud', counts: { words: 1 } });
    expect(ja2.syncer.status()).toMatchObject({ state: 'idle', hub: 'cloud', counts: { words: 1 } });
    // The account's status (GET /sync) is the Chinese library's, as before.
    const token = cloudSession()!.token;
    expect(await (await w.c.call('/sync', { headers: { Authorization: `Bearer ${token}` } })).json()).toMatchObject({ counts: { words: 1 } });
    // The Chinese library sent and got no prefixed key, and the Japanese one only its own.
    const chinese = w.bodies.filter((b) => !b.lang);
    expect(chinese.flatMap((b) => [...b.changes, ...b.reply?.records ?? []]).some((r) => r.key.startsWith('@'))).toBe(false);
    expect(chinese.some((b) => b.reply && 'lang' in b.reply)).toBe(false);
    expect(w.bodies.filter((b) => b.lang).flatMap((b) => [...b.changes, ...b.reply?.records ?? []]).every((r) => r.key.startsWith('@ja:'))).toBe(true);
  });

  it('gives Chinese its own room, so Japanese words never crowd out Chinese ones, and the other languages one together', async () => {
    const c = cloud({ OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const friend = await signedIn(c, 'friend@example.com');
    const send = (body: object) => c.call('/sync', { method: 'POST', body: JSON.stringify(body), headers: { Authorization: `Bearer ${friend}` } });
    const pad = 'x'.repeat(30_000);
    let refused: Response | null = null;
    for (let r = 0; r < 4 && !refused; r++) {
      const res = await send({ lang: 'ja', changes: Array.from({ length: 250 }, (_, i) => ({ key: `@ja:v:w${r}-${i}`, at: 1, data: { pad } })) });
      if (res.status === 413) refused = res;
    }
    expect(SHARED_RECORD_BYTES).toBe(20 * 1024 * 1024);
    expect(await refused?.json()).toMatchObject({ code: 'full', error: 'Your account is full: it keeps up to 20 MB of words, places and settings for all your languages but Chinese together.' });
    // Spanish shares that room: an account holds two rooms of records at most, not one for each of eight languages.
    expect((await send({ lang: 'es', changes: Array.from({ length: 250 }, (_, i) => ({ key: `@es:v:w${i}`, at: 1, data: { pad } })) })).status).toBe(413);
    // The Chinese library has all of its room: the same 7 MB of Chinese words are kept.
    const zh = await send({ changes: Array.from({ length: 250 }, (_, i) => ({ key: `v:w${i}`, at: 1, data: { pad } })) });
    expect(zh.status).toBe(200);
    expect(((await zh.json()) as { counts: { words: number } }).counts.words).toBe(250);
  });

  for (const lang of ['', 'ja']) {
    it(`counts only what the merge keeps toward the room, so a full ${lang ? 'Japanese' : 'Chinese'} library cannot grow past it`, async () => {
      const c = cloud({ OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
      const friend = await signedIn(c, 'friend@example.com');
      const send = async (body: object) => (await c.call('/sync', { method: 'POST', body: JSON.stringify({ ...(lang ? { lang } : {}), ...body }), headers: { Authorization: `Bearer ${friend}` } })).status;
      const p = lang ? `@${lang}:` : '';
      // 699 words of 30 KB: 1.5 KB short of 20 MB.
      const keys: string[] = [];
      for (let r = 0; r < 3; r++) {
        const changes = Array.from({ length: 233 }, (_, i) => { const key = `${p}v:f${r}-${i}`; keys.push(key); return { key, at: 1, data: pad(30_000) }; });
        expect(await send({ changes })).toBe(200);
      }
      expect(await send({ changes: [{ key: `${p}v:one-more`, at: 1, data: pad(30_000) }] })).toBe(413);
      const fresh = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({ key: `${p}v:${tag}-${i}`, at: Date.now(), data: pad(30_000) }));
      // Deletions that lose (time 0 lands only where nothing is) free nothing, so they make no room for new words.
      expect(await send({ changes: [...keys.map((key) => ({ key, at: 0, data: null })), ...fresh(10, 'a')] })).toBe(413);
      // A word deleted and saved again in one request is counted once, as it ends.
      const t = Date.now();
      expect(await send({ changes: [...keys.slice(0, 120).flatMap((key) => [{ key, at: t, data: null }, { key, at: t + 1, data: pad(30_000) }]), ...fresh(120, 'b')] })).toBe(413);
      // A deletion that lands makes room, in the same request.
      expect(await send({ changes: [...keys.slice(0, 120).map((key) => ({ key, at: t + 2, data: null })), ...fresh(120, 'c')] })).toBe(200);
      const store = [...c.stores.values()].find((s) => s.data.size > 0)!;
      expect(store.recordBytes(lang ? 'others' : 'chinese')).toBeLessThanOrEqual(SHARED_RECORD_BYTES);
    });
  }
});

describe('a new Japanese library on the sync server live today', () => {
  it('keeps its records here and says so, the Chinese library syncs as ever, and the records go once the server is updated', async () => {
    const w = world();
    w.state.released = true;
    await w.login();
    const zh = await library('zh');
    const ja = await library('ja');
    await zh.store.vocab.put(word('学生', 'xue2 sheng5'));
    await ja.store.vocab.put(word('学生', 'がくせい'));
    await zh.syncer.run();
    await ja.syncer.run();
    expect(zh.syncer.status()).toMatchObject({ state: 'idle', pending: 0 });
    expect(ja.syncer.status()).toMatchObject({ state: 'outdated', hub: 'cloud', pending: 1 });
    expect(ja.syncer.status().message).toMatch(/^The sync server is older than this version of Dushu and does not keep Japanese yet/);
    // Never sent there: that Worker counts every change toward the Chinese room, and a nearly full one would answer "full".
    expect(w.bodies.filter((b) => b.lang === 'ja').every((b) => b.changes.length === 0)).toBe(true);
    // Kept nowhere on the server, not even as a Chinese word.
    const kept = () => [...[...w.c.stores.values()][0].data.keys()].sort();
    expect(kept()).toEqual(['v:学生']);
    // Asked again, nothing is sent again.
    const sent = w.bodies.length;
    await ja.syncer.run();
    expect(w.bodies.slice(sent).map((b) => b.changes.length)).toEqual([0]);

    w.state.released = false;
    await ja.syncer.run();
    expect(ja.syncer.status()).toMatchObject({ state: 'idle', pending: 0, counts: { words: 1 } });
    expect(kept()).toEqual(['@ja:v:学生', 'v:学生']);
  });
});

describe('a Japanese library and a nearly full Chinese one on the Worker live today', () => {
  it('says the server needs updating, not that the account is full, and sends none of its words there', async () => {
    // That Worker counts every change in a request toward the Chinese room, the Japanese ones it then drops included.
    const w = world({ owner: 'owner@example.com' });
    w.state.released = true;
    await w.login();
    const room = SHARED_RECORD_BYTES - 20;
    let filled = 0;
    for (let r = 0; filled < room; r++) {
      const changes = [];
      for (let i = 0; i < 200 && filled < room; i++) {
        const want = Math.min(30_000, room - filled);
        const data = { p: 'x'.repeat(Math.max(0, want - 8)) };
        filled += JSON.stringify(data).length;
        changes.push({ key: `v:w${r}-${i}`, at: 1, data });
      }
      expect((await post(w, { changes })).status).toBe(200);
    }
    const store = await openStore(`cloud-lang-full-${Math.random().toString(36).slice(2)}`);
    await store.vocab.put(word('学生', 'がくせい'));
    const ja = createSyncer(store, { everyMs: 0, lang: 'ja' });
    syncers.push(ja);
    await ja.run();
    await ja.run();
    expect(ja.status()).toMatchObject({ state: 'outdated', pending: 1 });
    expect(w.bodies.filter((b) => b.lang === 'ja').every((b) => b.changes.length === 0)).toBe(true);
  });
});

describe('the Worker rolled back to the one live before languages, then updated again', () => {
  it('gives a Japanese library that was outdated meanwhile the words the Worker kept before', async () => {
    const w = world();
    await w.login();
    const x = await library('ja');
    await x.store.vocab.put(word('食べる', 'たべる'));
    await x.syncer.run();
    expect(x.syncer.status().state).toBe('idle');
    w.state.released = true;
    const rolledBack = w.bodies.length;
    const y = await library('ja');
    await y.syncer.run();
    expect(y.syncer.status().state).toBe('outdated');
    // The Worker live before languages answers the '@ja:' word it keeps, without naming the language: not taken.
    expect(w.bodies.slice(rolledBack).flatMap((b) => b.reply?.records ?? []).map((r) => r.key)).toContain('@ja:v:食べる');
    expect(await y.store.vocab.get('食べる')).toBeUndefined();
    w.state.released = false;
    await y.syncer.run();
    expect(y.syncer.status()).toMatchObject({ state: 'idle', counts: { words: 1 } });
    expect((await y.store.vocab.get('食べる'))?.pinyin).toBe('たべる');
  });

  it('counts the other languages toward the Chinese room while rolled back, and gives Chinese its room back once updated', async () => {
    // A rollback's cost, kept for as long as it lasts: that Worker sums every record (ARCHITECTURE §4.11, Languages).
    const w = world({ owner: 'owner@example.com' });
    await w.login();
    for (let r = 0; r < 2; r++) {
      expect((await post(w, { lang: 'ja', changes: Array.from({ length: 250 }, (_, i) => ({ key: `@ja:v:w${r}-${i}`, at: 1, data: pad(30_000) })) })).status).toBe(200);
    }
    const zh = { changes: Array.from({ length: 250 }, (_, i) => ({ key: `v:w${i}`, at: 1, data: pad(30_000) })) };
    w.state.released = true;
    expect((await post(w, zh)).status).toBe(413);
    w.state.released = false;
    expect((await post(w, zh)).status).toBe(200);
  });
});

describe('the Mac’s records into the account', () => {
  // The syncs above tried the copy beside themselves and found no Mac, which holds the next try for five minutes: these run
  // later than that.
  const later = (hours: number) => Date.now() + hours * 3_600_000;

  it('are copied library by library, each once', async () => {
    const w = world({ mac: true });
    // Other devices synced a Chinese and a Japanese word through the Mac.
    w.mac.exchange({ changes: [{ key: 'v:银行', at: 2000, data: word('银行', 'yin2 hang2') }] });
    w.mac.exchange({ lang: 'ja', changes: [{ key: '@ja:v:銀行', at: 2000, data: word('銀行', 'ぎんこう') }] });
    await w.login();
    const now = later(1);
    expect(await copyMacIntoAccount(now, 'ja')).toBe(true);
    const token = cloudSession()!.token;
    const records = async (lang?: string) => {
      const reply = await (await w.c.post('/sync', { since: 0, changes: [], ...(lang ? { lang } : {}) }, token)).json() as { records: { key: string }[] };
      return reply.records.map((r) => r.key);
    };
    expect([await records(), await records('ja')]).toEqual([[], ['@ja:v:銀行']]);
    expect(await copyMacIntoAccount(now, 'ja')).toBe(false); // once
    expect(await copyMacIntoAccount(now, 'zh')).toBe(true); // the Chinese library's own copy
    expect([await records(), await records('ja')]).toEqual([['v:银行'], ['@ja:v:銀行']]);
    expect(Object.keys(localStorage).filter((k) => k.includes('mac-copied')).sort()).toEqual(['dushu.cloud.mac-copied.v1', 'dushu.ja.cloud.mac-copied.v1']);
  });

  it('are not marked copied while the account is from before languages, and are copied once it is updated', async () => {
    const w = world({ mac: true });
    w.mac.exchange({ lang: 'ja', changes: [{ key: '@ja:v:銀行', at: 2000, data: word('銀行', 'ぎんこう') }] });
    w.state.released = true;
    await w.login();
    const now = later(2);
    expect(await copyMacIntoAccount(now, 'ja')).toBe(false);
    expect(localStorage.getItem('dushu.ja.cloud.mac-copied.v1')).toBeNull();
    w.state.released = false;
    // Tried again after five minutes, not on every sync.
    expect(await copyMacIntoAccount(now + 1000, 'ja')).toBe(false);
    expect(await copyMacIntoAccount(now + 5 * 60_000 + 1, 'ja')).toBe(true);
    const token = cloudSession()!.token;
    const reply = await (await w.c.post('/sync', { lang: 'ja', changes: [] }, token)).json() as { records: { key: string }[] };
    expect(reply.records.map((r) => r.key)).toEqual(['@ja:v:銀行']);
  });

  it('ask a Mac from before languages from where it last answered, and read it whole once it keeps the language', async () => {
    const mac = oldMac();
    // Other devices' Chinese words on the Mac, which would come back with every whole read.
    mac.exchange({ changes: ['银行', '书', '水'].map((id) => ({ key: `v:${id}`, at: 2000, data: word(id, 'x') })) });
    const w = world({ mac });
    await w.login();
    const t = later(3);
    expect(await copyMacIntoAccount(t, 'ja')).toBe(false);
    expect(await copyMacIntoAccount(t + 5 * 60_000 + 1, 'ja')).toBe(false);
    expect(w.macCalls.map((m) => [m.body.epoch, m.body.since, m.reply.records.length])).toEqual([[undefined, 0, 3], ['mac-1', 3, 0]]);
    // Updated, with a word another Japanese device saved through it since.
    mac.released = false;
    mac.exchange({ lang: 'ja', changes: [{ key: '@ja:v:銀行', at: 2000, data: word('銀行', 'ぎんこう') }] });
    expect(await copyMacIntoAccount(t + 10 * 60_000 + 2, 'ja')).toBe(true);
    expect(w.macCalls.slice(2).map((m) => [m.body.epoch, m.body.since, m.reply.lang])).toEqual([['mac-1', 3, 'ja'], [undefined, 0, 'ja']]);
    expect((await post(w, { lang: 'ja', changes: [] })).reply.records.map((r) => r.key)).toEqual(['@ja:v:銀行']);
  });

  it('are never copied into an account that is not the owner’s', async () => {
    // The owner's iPad (it reaches the Mac) signed in to an account someone else made: their account gets nothing of the Mac.
    const w = world({ mac: true, owner: 'owner@example.com' });
    w.mac.exchange({ changes: [{ key: 'v:银行', at: 2000, data: word('银行', 'yin2 hang2') }] });
    w.mac.exchange({ lang: 'ja', changes: [{ key: '@ja:v:銀行', at: 2000, data: word('銀行', 'ぎんこう') }] });
    await w.login();
    expect(await copyMacIntoAccount(later(4), 'ja')).toBe(false);
    expect(await copyMacIntoAccount(later(5), 'zh')).toBe(false);
    expect(w.macCalls).toEqual([]);
    expect([(await post(w, { changes: [] })).reply.records, (await post(w, { lang: 'ja', changes: [] })).reply.records]).toEqual([[], []]);
    expect(Object.keys(localStorage).filter((k) => k.includes('mac-copied'))).toEqual([]);
  });

  it('are not read for a library until the account names its language, and then are copied by its syncer', async () => {
    // Later than every try above, so the copy is not held back by their five minutes.
    const real = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => real() + 24 * 3_600_000);
    const w = world({ mac: true });
    w.mac.exchange({ lang: 'ja', changes: [{ key: '@ja:v:銀行', at: 2000, data: word('銀行', 'ぎんこう') }] });
    w.state.released = true;
    await w.login();
    const ja = await library('ja');
    await ja.syncer.run();
    expect(ja.syncer.status().state).toBe('outdated');
    await new Promise((r) => setTimeout(r, 20));
    expect(w.macCalls).toEqual([]);
    w.state.released = false;
    await vi.waitFor(async () => { await ja.syncer.run(); expect(ja.store.vocab.has('銀行')).toBe(true); }, { timeout: 3000, interval: 20 });
    expect(localStorage.getItem('dushu.ja.cloud.mac-copied.v1')).not.toBeNull();
  });
});

describe('deleting the account', () => {
  it('forgets what each library put there, so a new account with the same email gets the Mac and the books again', async () => {
    const w = world();
    await w.login();
    const lists = ['dushu.cloud.mac-copied.v1', 'dushu.ja.cloud.mac-copied.v1', 'dushu.es.cloud.books-up.v1'];
    for (const key of lists) localStorage.setItem(key, JSON.stringify(['reader@example.com|old|x', 'friend@example.com|y']));
    await deleteAccount();
    expect(lists.map((key) => JSON.parse(localStorage.getItem(key)!))).toEqual(lists.map(() => ['friend@example.com|y']));
  });
});

/** SQLite through the sqlite3 command (macOS has it), with the bindings written into the query. Enough for the record queries. */
function sqliteCli(file: string): SqlStorage {
  const literal = (v: unknown) => (typeof v === 'number' ? String(v) : v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  return {
    exec(query, ...bindings) {
      let i = 0;
      const sql = query.replace(/\?/g, () => literal(bindings[i++]));
      const out = execFileSync('sqlite3', ['-json', file, sql], { encoding: 'utf8' }).trim();
      const rows = out ? JSON.parse(out) as Record<string, unknown>[] : [];
      return { toArray: () => rows };
    },
  };
}
let hasSqlite = true;
try { execFileSync('sqlite3', ['-version'], { stdio: 'ignore' }); } catch { hasSqlite = false; }

describe('the account’s records in SQLite (sqlStore)', () => {
  it.skipIf(!hasSqlite)('picks one library’s records, counts and bytes', () => {
    const store = sqlStore(sqliteCli(join(tempDir(), 'account.sqlite')));
    const table = store.records('e', 0);
    const at = Date.now();
    exchange(table, { changes: [{ key: 'v:学生', at, data: { id: '学生' } }, { key: 'k:老师', at, data: {} }] }, at);
    const ja = exchange(table, { lang: 'ja', changes: [
      { key: '@ja:v:学生', at, data: { id: '学生', pinyin: 'がくせい' } },
      { key: '@ja:l:2026-10-30:読む', at, data: { count: 1, first: at, last: at } },
    ] }, at).reply;
    exchange(table, { lang: 'es', changes: [{ key: '@es:b:m1', at, data: { book: 'b1' } }] }, at);
    expect(ja.records.map((r) => r.key)).toEqual(['@ja:v:学生', '@ja:l:2026-10-30:読む']);
    expect(ja.counts).toEqual({ words: 1, known: 0, places: 0, lookups: 1, bookmarks: 0 });
    expect(table.changed(0, new Set(), '').map((r) => r.key)).toEqual(['v:学生', 'k:老师']);
    expect(table.changed(0, new Set(), 'es').map((r) => r.key)).toEqual(['@es:b:m1']);
    expect(table.counts('')).toEqual({ words: 1, known: 1, places: 0, lookups: 0, bookmarks: 0 });
    expect(table.counts('es')).toEqual({ words: 0, known: 0, places: 0, lookups: 0, bookmarks: 1 });
    expect(store.recordBytes('chinese')).toBe(JSON.stringify({ id: '学生' }).length + 2);
    // Every other language's in one room.
    const others = [{ id: '学生', pinyin: 'がくせい' }, { count: 1, first: at, last: at }, { book: 'b1' }];
    expect(store.recordBytes('others')).toBe(others.reduce((n, d) => n + JSON.stringify(d).length, 0));
  });

  it.skipIf(!hasSqlite)('keeps other languages’ books where the Worker live before languages never looks, and that Worker reads as releasedView says', () => {
    const file = join(tempDir(), 'account.sqlite');
    const store = sqlStore(sqliteCli(file));
    const at = Date.now();
    for (const key of ['b1', '@ja:b1']) {
      store.putBook({ key, title: key, author: '', size: 3, sha: 'a'.repeat(64), chunks: 1, addedAt: at, complete: true });
      store.putChunk(key, 0, new Uint8Array([1, 2, 3]));
    }
    exchange(store.records('e', 0), { lang: 'ja', changes: [{ key: '@ja:v:学生', at, data: { id: '学生' } }] }, at);
    expect(store.books().map((b) => b.key)).toEqual(['b1', '@ja:b1']);
    expect([store.chunkCount('b1'), store.chunkCount('@ja:b1')]).toEqual([1, 1]);
    // main's sqlStore over the same database (tests/cloud/helpers.ts releasedView): only the Chinese book, no piece of the
    // Japanese one; every record, the Japanese word included, and its bytes in the one room it knows.
    const old = releasedSqlStore(sqliteCli(file));
    expect(old.books().map((b: { key: string }) => b.key)).toEqual(['b1']);
    expect([old.getChunk('@ja:b1', 0), old.chunkCount('@ja:b1')]).toEqual([undefined, 0]);
    expect(old.records('e', 1).changed(0, new Set()).map((r: { key: string }) => r.key)).toEqual(['@ja:v:学生']);
    expect(old.records('e', 1).counts()).toEqual(noCounts());
    expect(old.recordBytes()).toBe(JSON.stringify({ id: '学生' }).length);
    // Deleted with the account, every shelf goes.
    store.wipe();
    expect([store.books(), store.chunkCount('@ja:b1')]).toEqual([[], 0]);
  });
});
