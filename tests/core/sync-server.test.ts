import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { Agent, createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { SYNC_LIMITS, createSyncStore, syncDir, syncHandler } from '../../scripts/sync-bridge';

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join(tmpdir(), 'dushu-sync-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('the Mac copy (createSyncStore)', () => {
  it('keeps the later change and returns what is newer than the cursor', () => {
    const s = createSyncStore({ dir: dir(), now: () => 10_000 });
    const a = s.exchange({ since: 0, changes: [{ key: 'v:银行', at: 100, data: { id: '银行', gloss: 'bank' } }] });
    expect(a.version).toBe(1);
    expect(a.records).toEqual([{ key: 'v:银行', at: 100, data: { id: '银行', gloss: 'bank' } }]);
    // An older change loses, and the winner comes back so the sender can take it.
    const b = s.exchange({ epoch: a.epoch, since: 1, changes: [{ key: 'v:银行', at: 50, data: { id: '银行', gloss: 'old' } }] });
    expect(b.version).toBe(1);
    expect(b.records).toEqual([{ key: 'v:银行', at: 100, data: { id: '银行', gloss: 'bank' } }]);
    // A newer one wins; nothing is returned twice to a device that is up to date.
    const c = s.exchange({ epoch: a.epoch, since: 1, changes: [{ key: 'v:银行', at: 200, data: null }] });
    expect(c.version).toBe(2);
    expect(s.exchange({ epoch: a.epoch, since: 2, changes: [] }).records).toEqual([]);
    expect(c.counts).toEqual({ words: 0, known: 0, places: 0 });
  });

  it('breaks a tie the same way whatever the order', () => {
    const one = createSyncStore({ dir: dir() });
    const two = createSyncStore({ dir: dir() });
    const x = { key: 'k:好', at: 5, data: {} };
    const y = { key: 'k:好', at: 5, data: { a: 1 } };
    one.exchange({ changes: [x] }); one.exchange({ changes: [y] });
    two.exchange({ changes: [y] }); two.exchange({ changes: [x] });
    expect(one.exchange({ changes: [] }).records).toEqual(two.exchange({ changes: [] }).records);
  });

  it('lets a copy that was never synced (time 0) land only where nothing is', () => {
    const s = createSyncStore({ dir: dir() });
    s.exchange({ changes: [{ key: 'v:书', at: 0, data: { id: '书', gloss: 'first' } }] });
    const r = s.exchange({ changes: [{ key: 'v:书', at: 0, data: { id: '书', gloss: 'zzz' } }] });
    expect(r.records).toEqual([{ key: 'v:书', at: 0, data: { id: '书', gloss: 'first' } }]);
  });

  it('sends everything to a device that knows another copy (new epoch), and ignores bad records', () => {
    const s = createSyncStore({ dir: dir(), now: () => 1000 });
    const first = s.exchange({ changes: [
      { key: 'k:人', at: 1, data: {} },
      { key: 'x:bad', at: 1, data: {} },
      { key: 'k:', at: 1, data: {} },
      { key: 'k:大', at: Number.NaN, data: {} },
      { key: 'k:小', at: 1, data: 'string' },
      { key: 'v:' + 'x'.repeat(200), at: 1, data: {} },
      { key: 'v:长', at: 1, data: { gloss: 'x'.repeat(40_000) } },
    ] });
    expect(first.records.map((r) => r.key)).toEqual(['k:人']);
    expect(s.exchange({ epoch: 'other', since: 99, changes: [] }).records).toHaveLength(1);
    // A cursor past the end (the Mac's copy was replaced) also starts over.
    expect(s.exchange({ epoch: first.epoch, since: 99, changes: [] }).records).toHaveLength(1);
  });

  it('answers a record too large to keep with the copy it has, like a change that lost', () => {
    const s = createSyncStore({ dir: dir(), now: () => 1000 });
    const first = s.exchange({ changes: [{ key: 'v:长', at: 1, data: { id: '长', gloss: 'long' } }] });
    const r = s.exchange({ epoch: first.epoch, since: first.version, changes: [{ key: 'v:长', at: 5, data: { id: '长', gloss: 'x'.repeat(40_000) } }] });
    expect(r.records).toEqual([{ key: 'v:长', at: 1, data: { id: '长', gloss: 'long' } }]);
  });

  it('merges what another process saved to the same folder instead of overwriting it', () => {
    const d = dir();
    const one = createSyncStore({ dir: d });
    const two = createSyncStore({ dir: d });
    one.exchange({ changes: [{ key: 'k:一', at: 1, data: {} }] });
    two.exchange({ changes: [{ key: 'k:二', at: 2, data: {} }] });
    one.exchange({ changes: [{ key: 'k:三', at: 3, data: {} }] });
    expect(Object.keys(JSON.parse(readFileSync(join(d, 'state.json'), 'utf8')).records).sort()).toEqual(['k:一', 'k:三', 'k:二'].sort());
    expect(createSyncStore({ dir: d }).status().counts.known).toBe(3);
  });

  it('does not let a clock far in the future win forever', () => {
    const s = createSyncStore({ dir: dir(), now: () => 1_000_000 });
    const r = s.exchange({ changes: [{ key: 'k:天', at: 9e15, data: {} }] });
    expect(r.records[0].at).toBe(1_000_000 + 10 * 60_000);
  });

  it('saves to disk, keeps a copy per day, and sets aside a file it cannot read', () => {
    const d = dir();
    let t = new Date(2026, 9, 1, 12).getTime();
    const s = createSyncStore({ dir: d, now: () => t });
    s.exchange({ changes: [{ key: 'k:一', at: 1, data: {} }] });
    t += 86_400_000;
    s.exchange({ changes: [{ key: 'k:二', at: 2, data: {} }] });
    expect(readdirSync(d).sort()).toEqual(['state-2026-10-02.json', 'state.json']);
    expect(Object.keys(JSON.parse(readFileSync(join(d, 'state-2026-10-02.json'), 'utf8')).records)).toEqual(['k:一']);
    const again = createSyncStore({ dir: d });
    expect(again.status().counts.known).toBe(2);
    writeFileSync(join(d, 'state.json'), '{not json');
    const fresh = createSyncStore({ dir: d });
    expect(fresh.status().counts.known).toBe(0);
    expect(readdirSync(d).some((f) => f.startsWith('state-unreadable-'))).toBe(true);
  });
});

describe('which folder the Mac copy uses', () => {
  it('only one named by an absolute DUSHU_SYNC_DIR: there is no default folder', () => {
    expect(syncDir({ DUSHU_SYNC_DIR: '/tmp/dushu-sync-x' })).toBe('/tmp/dushu-sync-x');
    expect(syncDir({})).toBeNull();
    expect(syncDir({ DUSHU_SYNC_DIR: '' })).toBeNull();
    expect(syncDir({ DUSHU_SYNC_DIR: '.dushu-local/sync' })).toBeNull();
    expect(() => createSyncStore({ dir: '' })).toThrow(/DUSHU_SYNC_DIR/);
  });

  it('every QA script gives a server it starts an empty folder of its own, and switches sync off for one it did not start', () => {
    const scripts = readdirSync('scripts').filter((f) => /^qa.*\.mjs$/.test(f));
    expect(scripts.length).toBeGreaterThanOrEqual(10);
    for (const f of scripts) {
      const src = readFileSync(join('scripts', f), 'utf8');
      expect(src, f).toMatch(/(evaluateOnNewDocument|addInitScript)\(SYNC_OFF\)/);
      const spawns = src.split('\n').filter((l) => /spawn\(.*vite/.test(l));
      for (const line of spawns) expect(line, f).toMatch(/DUSHU_SYNC_DIR: (SYNC_DIR|syncDir)/);
      if (spawns.length) {
        expect(src, f).toMatch(/mkdtempSync\(join\(tmpdir\(\), 'dushu-qa-sync-'\)\)/);
        expect(src, f).toMatch(/rmSync\((SYNC_DIR|syncDir), \{ recursive: true, force: true \}\)/);
      }
    }
    // qa.mjs starts its own server unless given a URL: it never defaults to the owner's 4317.
    expect(readFileSync('scripts/qa.mjs', 'utf8')).not.toMatch(/urlArg = '[^']*4317/);
  });

  it('a server started without one says sync is off and writes nothing, even in the folder the owner keeps his words in', async () => {
    // Run from an empty folder: a server that fell back to .dushu-local/sync would create it here, never in the repo.
    const was = process.cwd();
    const env = process.env.DUSHU_SYNC_DIR;
    const here = realpathSync(dir());
    process.chdir(here);
    delete process.env.DUSHU_SYNC_DIR;
    try {
      expect(process.cwd()).toBe(here);
      const handle = syncHandler();
      const post = await call(handle, 'POST', JSON.stringify({ changes: [{ key: 'k:书', at: 1, data: {} }] }), { 'content-type': 'application/json' });
      expect(post.status).toBe(503);
      expect(post.json).toMatchObject({ off: true, error: expect.stringMatching(/does not sync/) });
      expect((await call(handle, 'GET')).status).toBe(503);
      expect(existsSync(join(here, '.dushu-local'))).toBe(false);
      expect(readdirSync(here)).toEqual([]);
    } finally {
      process.chdir(was);
      if (env !== undefined) process.env.DUSHU_SYNC_DIR = env;
    }
  });
});

function call(handle: ReturnType<typeof syncHandler>, method: string, body?: string, headers: Record<string, string> = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []) as unknown as IncomingMessage;
  Object.assign(req, { method, url: '/api/sync', headers: { host: 'localhost:4317', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  let status = 0;
  let out = '';
  const res = {
    headersSent: false, writableEnded: false,
    setHeader() {}, writeHead(s: number) { status = s; return res; },
    end(chunk?: string) { if (chunk) out += chunk; Object.assign(res, { writableEnded: true }); return res; },
  } as unknown as ServerResponse;
  return handle(req, res, () => { status = -1; }).then(() => ({ status, json: out ? JSON.parse(out) : null }));
}

describe('the /api/sync route', () => {
  const handle = syncHandler(createSyncStore({ dir: dir() }));
  it('answers the owner and refuses everyone else', async () => {
    const ok = await call(handle, 'POST', JSON.stringify({ changes: [{ key: 'k:书', at: 1, data: {} }] }), { 'content-type': 'application/json' });
    expect(ok.status).toBe(200);
    expect(ok.json.counts.known).toBe(1);
    expect((await call(handle, 'GET')).json.counts.known).toBe(1);
    const stranger = await call(handle, 'POST', '{}', { 'content-type': 'application/json', host: 'evil.example' });
    expect(stranger.status).toBe(403);
    const crossSite = await call(handle, 'GET', undefined, { origin: 'https://evil.example' });
    expect(crossSite.status).toBe(403);
  });
  it('checks the request', async () => {
    expect((await call(handle, 'POST', '{}')).status).toBe(415);
    expect((await call(handle, 'POST', 'nope', { 'content-type': 'application/json' })).status).toBe(400);
    expect((await call(handle, 'PUT')).status).toBe(405);
    expect((await call(handle, 'POST', JSON.stringify({ changes: Array.from({ length: 5001 }, () => ({})) }), { 'content-type': 'application/json' })).status).toBe(413);
  });
  it('reads the rest of a body that is too large before refusing it, so the next request on the connection is not stuck', async () => {
    const server = createServer((req, res) => void handle(req, res, () => res.writeHead(404).end()));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const send = (method: string, body?: string) => new Promise<number | string>((resolve) => {
      const r = request({ host: '127.0.0.1', port, agent, method, path: '/api/sync', headers: { host: `localhost:${port}`, 'content-type': 'application/json' } }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      const stuck = setTimeout(() => { r.destroy(); resolve('stuck'); }, 5000);
      r.on('close', () => clearTimeout(stuck));
      r.on('error', (e) => resolve(e.message));
      r.end(body);
    });
    try {
      // Well over the limit, so part of the body is still unread when the answer goes.
      expect(await send('POST', JSON.stringify({ changes: [], pad: 'x'.repeat(SYNC_LIMITS.body + 512 * 1024) }))).toBe(413);
      expect(await send('GET')).toBe(200);
    } finally {
      agent.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
