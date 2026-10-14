import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createSyncStore, syncHandler } from '../../scripts/sync-bridge';

const dir = () => mkdtempSync(join(tmpdir(), 'dushu-sync-'));

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
});
