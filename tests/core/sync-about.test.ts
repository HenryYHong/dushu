// @vitest-environment jsdom
// A device signed in to the account tells it, with the first request of each sync, the person's time zone and the app's
// language (`about`): the server sends its review reminders at 6 PM where they are, in their language. The Mac is never told.
import 'fake-indexeddb/auto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createSyncer, type Syncer } from '../../src/core/sync';
import { setCatalogForTest } from '../../src/i18n';
import { newSrs } from '../../src/core/srs';
import { openStore } from '../../src/store';
import { createSyncStore } from '../../scripts/sync-bridge';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const syncers: Syncer[] = [];
afterEach(() => { for (const s of syncers.splice(0)) s.stop(); localStorage.clear(); setCatalogForTest('en', {}); });

/** A hub (the real merge, in process) that keeps every request body it was sent. */
function hub() {
  const dir = mkdtempSync(join(tmpdir(), 'dushu-about-'));
  dirs.push(dir);
  const server = createSyncStore({ dir });
  const bodies: Record<string, unknown>[] = [];
  const send = (body: string) => {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    bodies.push(parsed);
    return Promise.resolve(Response.json(server.exchange(parsed)));
  };
  return { bodies, send };
}

const signIn = () => {
  localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
  localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't', email: 'reader@example.com' }));
};

describe('about the person, with a sync', () => {
  it('tells the account the time zone and the app’s language, once a sync', async () => {
    signIn();
    const h = hub();
    const store = await openStore(`about-${Math.random()}`);
    const s = createSyncer(store, { send: h.send, everyMs: 0 });
    syncers.push(s);
    await s.run();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(h.bodies[0].about).toEqual({ tz, locale: 'en' });

    // A sync that takes two requests (one carries at most 1,000 changes) says it with the first only.
    for (let i = 0; i < 1001; i++) await store.vocab.put({ id: `w${i}`, simp: `w${i}`, trad: `w${i}`, pinyin: '', gloss: 'x', addedAt: 1000, srs: newSrs(1000) });
    h.bodies.length = 0;
    await s.run();
    expect(h.bodies.length).toBe(2);
    expect(h.bodies.map((b) => 'about' in b)).toEqual([true, false]);

    // The app in French: the next sync says so.
    setCatalogForTest('fr', {});
    h.bodies.length = 0;
    await s.run();
    expect(h.bodies[0].about).toEqual({ tz, locale: 'fr' });
  });

  it('tells the Mac nothing about the person', async () => {
    const h = hub();
    const store = await openStore(`about-mac-${Math.random()}`);
    const s = createSyncer(store, { send: h.send, everyMs: 0 });
    syncers.push(s);
    await s.run();
    expect(h.bodies.length).toBeGreaterThan(0);
    expect(h.bodies.some((b) => 'about' in b)).toBe(false);
  });
});
