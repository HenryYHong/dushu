// @vitest-environment jsdom
// Claude through the sync account: the server checks the passage, counts the request against the account's daily limit,
// builds the Mac's prompt and streams the answer the way the Mac does, and the app's translator uses it when signed in.
// Anthropic is faked; the server runs in process.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../../cloud/src/worker';
import type { ServerClient } from '../../src/translate/claudeServer';
import { requestCode, signIn } from '../../src/core/cloud';
import { createClaudeTranslator, fetchClaudeStatus, resetClaudeStatus } from '../../src/translate/claude';
import { cloud, signedIn } from './helpers';

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); resetClaudeStatus(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

/** A fake Anthropic client: streams `deltas`, then finishes with `stop` and some usage. Records what it was asked. */
function fakeClaude(deltas: string[], stop = 'end_turn') {
  const bodies: Record<string, unknown>[] = [];
  const client = (): ServerClient => ({
    beta: { messages: { stream(body) {
      bodies.push(body);
      const fns: ((d: string) => void)[] = [];
      return {
        on: (_e: 'text', fn: (d: string) => void) => { fns.push(fn); },
        finalMessage: async () => {
          for (const d of deltas) for (const fn of fns) fn(d);
          return { stop_reason: stop, content: [{ type: 'text', text: deltas.join('') }], usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 5 } };
        },
      };
    } } },
  });
  return { client, bodies };
}

const lines = async (res: Response) => (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

describe('Claude through the account', () => {
  it('streams the answer as the Mac does, counts it against the day, and refuses past the limit', async () => {
    const fake = fakeClaude(['The bank ', 'is closed.']);
    const c = cloud({ OWNER_EMAILS: 'reader@example.com', ANTHROPIC_API_KEY: 'test-key', CLAUDE_MAX_REQUESTS: '2', claudeClient: fake.client } as Partial<Env>);
    const token = await signedIn(c);
    const ask = () => c.post('/claude/translate', { text: '银行关门了。', mode: 'translate', model: 'claude-haiku-5-5', terms: [{ word: '银行', pinyin: 'yin2 hang2', gloss: 'bank' }] }, token);
    const res = await ask();
    expect(res.headers.get('content-type')).toContain('ndjson');
    expect(await lines(res)).toEqual([
      { type: 'text', text: 'The bank ' }, { type: 'text', text: 'is closed.' },
      { type: 'done', stop: 'end_turn', usage: { input: 125, output: 30 } },
    ]);
    // The Mac's prompt: its system prompt, the passage and the glossary, the effort, and no fallback for Haiku.
    expect(fake.bodies[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } });
    expect(String(fake.bodies[0].system)).toBeTruthy();
    expect(JSON.stringify(fake.bodies[0].messages)).toContain('银行关门了');
    expect(fake.bodies[0].fallbacks).toBeUndefined();

    const status = await (await c.call('/claude/status', { headers: { Authorization: `Bearer ${token}` } })).json() as Record<string, any>;
    expect(status).toMatchObject({ configured: true, ready: true, usage: { requests: 1, inputTokens: 125, outputTokens: 30 }, limits: { requests: 2 } });

    await lines(await ask());
    const over = await ask();
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ code: 'daily_limit' });
  });

  it('says so when no key is set up, when signed out, and for a refusal or a bad request', async () => {
    const none = cloud();
    const t1 = await signedIn(none);
    const res = await none.post('/claude/translate', { text: '你好', mode: 'translate' }, t1);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'no_key' });
    expect(await (await none.call('/claude/status', { headers: { Authorization: `Bearer ${t1}` } })).json()).toMatchObject({ configured: false, ready: false });

    const refusing = cloud({ OWNER_EMAILS: 'reader@example.com', ANTHROPIC_API_KEY: 'test-key', claudeClient: fakeClaude([], 'refusal').client } as Partial<Env>);
    const t2 = await signedIn(refusing);
    expect((await refusing.post('/claude/translate', { text: '你好', mode: 'translate' })).status).toBe(401);
    expect(await lines(await refusing.post('/claude/translate', { text: '你好', mode: 'translate' }, t2))).toEqual([{ type: 'error', code: 'refusal', message: 'Claude declined to translate this passage.' }]);
    const bad = await refusing.post('/claude/translate', { text: '你好', mode: 'translate', model: 'claude-opus-5-5' }, t2);
    expect(bad.status).toBe(400);
  });

  it('is the owner’s alone: anyone else signed in is told so, and nothing reaches Anthropic', async () => {
    const fake = fakeClaude(['Hello.']);
    const c = cloud({ OWNER_EMAILS: 'owner@example.com', ANTHROPIC_API_KEY: 'test-key', claudeClient: fake.client } as Partial<Env>);
    const friend = await signedIn(c, 'friend@example.com');
    const res = await c.post('/claude/translate', { text: '你好。', mode: 'translate' }, friend);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'not_owner' });
    expect(await (await c.call('/claude/status', { headers: { Authorization: `Bearer ${friend}` } })).json()).toMatchObject({ ownerOnly: true, ready: false });
    expect(fake.bodies).toEqual([]);
    const owner = await signedIn(c, 'Owner@Example.com');
    expect(await lines(await c.post('/claude/translate', { text: '你好。', mode: 'translate' }, owner))).toContainEqual({ type: 'text', text: 'Hello.' });
    // Before OWNER_EMAILS is set, whoever may sign in is the owner (the Dushu as it was, for one person).
    const old = cloud({ ALLOWED_EMAILS: 'reader@example.com', ANTHROPIC_API_KEY: 'test-key', claudeClient: fake.client } as Partial<Env>);
    expect(await (await old.call('/claude/status', { headers: { Authorization: `Bearer ${await signedIn(old)}` } })).json()).toMatchObject({ ready: true });
  });

  it('is what the app’s Claude translator uses once signed in', async () => {
    const fake = fakeClaude(['Hello.']);
    const c = cloud({ OWNER_EMAILS: 'reader@example.com', ANTHROPIC_API_KEY: 'test-key', claudeClient: fake.client } as Partial<Env>);
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
    const t = createClaudeTranslator({ claudeModel: 'claude-sonnet-5-5', localOnly: false });
    expect(t.label).toBe('Claude (through your account)');
    expect((await fetchClaudeStatus({ force: true })).ready).toBe(true);
    expect(await t.availability()).toBe('yes');
    const deltas: string[] = [];
    expect(await t.translate({ text: '你好。', mode: 'translate' }, { onDelta: (s) => deltas.push(s) })).toBe('Hello.');
    expect(deltas).toEqual(['Hello.']);
    // Sonnet gets the server-side fallback, as on the Mac.
    expect(fake.bodies[0]).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] });
    // Local only still keeps every sentence off any server.
    const local = createClaudeTranslator({ claudeModel: '', localOnly: true });
    expect(await local.availability()).toBe('no');
  });
});
