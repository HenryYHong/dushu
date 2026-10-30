import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Ledger, claudeHandler, claudeStatus, describeError, limitMessage, localDay, parseTranslateBody, readKey,
  type ClaudeBridgeConfig, type ServerClient, type ServerStream,
} from '../../scripts/claude-bridge';
import { CLAUDE_LIMITS, SYSTEM_PROMPTS } from '../../src/translate/claudePrompts';

// A made-up key that looks like a real one. It must never appear in any response, file or log.
const SECRET = 'sk-ant-api03-TESTONLY0123456789abcdefghijklmnop';
const dir = mkdtempSync(join(tmpdir(), 'dushu-claude-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Final = Awaited<ReturnType<ServerStream['finalMessage']>>;
function fakeStream(deltas: string[], opts: { stop?: string | null; fail?: unknown; usage?: Final['usage']; hold?: Promise<void>; text?: string } = {}): ServerStream {
  let onText: (d: string) => void = () => {};
  return {
    on(_event, fn) { onText = fn; return this; },
    async finalMessage() {
      await opts.hold;
      for (const d of deltas) onText(d);
      if (opts.fail) throw opts.fail;
      const text = opts.text ?? deltas.join('');
      return { stop_reason: opts.stop === undefined ? 'end_turn' : opts.stop, content: [{ type: 'text', text }],
        usage: opts.usage ?? { input_tokens: 120, output_tokens: 15 } };
    },
  };
}

let n = 0;
function setup(make: (body: Record<string, unknown>) => ServerStream = () => fakeStream(['Hello ', 'world']), over: Partial<ClaudeBridgeConfig> = {}) {
  n++;
  const keyFile = join(dir, `key${n}`);
  writeFileSync(keyFile, SECRET + '\n', { mode: 0o600 });
  const calls: { apiKey: string; body: Record<string, unknown>; signal?: AbortSignal }[] = [];
  const clientFactory = vi.fn((apiKey: string): ServerClient => ({
    beta: { messages: { stream(body, opts) { calls.push({ apiKey, body, signal: opts?.signal }); return make(body); } } },
  }));
  const config: ClaudeBridgeConfig = {
    keyFile, usageFile: join(dir, `usage${n}.json`), maxRequests: 3000, maxInputTokens: 3_000_000, effort: 'low',
    clientFactory, now: () => new Date(2026, 9, 13, 12, 0, 0), ...over,
  };
  return { config, calls, clientFactory };
}

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });
async function serve(config: ClaudeBridgeConfig) {
  const handle = claudeHandler(config);
  const server = createServer((rq: IncomingMessage, rs: ServerResponse) => {
    void handle(rq, rs, () => { rs.writeHead(404).end(); }).catch(() => { rs.writeHead(500).end(); });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw?: string) => new Promise<{ status: number; headers: Record<string, unknown>; text: string }>((resolve, reject) => {
    const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const r = httpRequest({ host: '127.0.0.1', port, method, path, headers: { host: `localhost:${port}`, ...(payload ? { 'content-type': 'application/json' } : {}), ...headers } }, rs => {
      let text = '';
      rs.on('data', c => { text += c; });
      rs.on('end', () => resolve({ status: rs.statusCode ?? 0, headers: rs.headers, text }));
    });
    r.on('error', reject);
    r.end(payload);
  });
  return { send, port, server };
}
const lines = (text: string) => text.trim().split('\n').map(l => JSON.parse(l) as Record<string, any>);
const ask = { text: '學而時習之，不亦說乎？', mode: 'translate' as const };

describe('the request Claude receives', () => {
  it('sends the Sonnet request shape: server-side fallback, low effort, no thinking, no sampling, no prefill', async () => {
    const { config, calls } = setup();
    const { send } = await serve(config);
    await send('POST', '/api/claude/translate', { ...ask, context: '子曰：學而時習之。', model: 'claude-sonnet-5-5' });
    expect(calls).toHaveLength(1);
    const { apiKey, body } = calls[0];
    expect(apiKey).toBe(SECRET);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(body.fallbacks).toBe('default');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.system).toBe(SYSTEM_PROMPTS.translate);
    for (const field of ['thinking', 'temperature', 'top_p', 'top_k']) expect(body).not.toHaveProperty(field);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('<context>\n子曰：學而時習之。\n</context>');
    expect(messages[0].content).toContain(`<text>\n${ask.text}\n</text>`);
    expect(body.max_tokens).toBeGreaterThanOrEqual(1000);
  });

  it('uses Sonnet by default, and sends Haiku without the fallback parameters', async () => {
    const { config, calls } = setup();
    const { send } = await serve(config);
    await send('POST', '/api/claude/translate', ask);
    expect(calls[0].body.model).toBe('claude-sonnet-5-5');
    await send('POST', '/api/claude/translate', { ...ask, model: 'claude-haiku-5-5', mode: 'explain' });
    const haiku = calls[1].body;
    expect(haiku.model).toBe('claude-haiku-5-5');
    expect(haiku).not.toHaveProperty('fallbacks');
    expect(haiku).not.toHaveProperty('betas');
    expect(haiku.system).toBe(SYSTEM_PROMPTS.explain);
    expect(haiku.output_config).toEqual({ effort: 'low' });
  });

  it('can run at medium effort when the Mac is set up that way', async () => {
    const { config, calls } = setup(undefined, { effort: 'medium' });
    const { send } = await serve(config);
    await send('POST', '/api/claude/translate', ask);
    expect(calls[0].body.output_config).toEqual({ effort: 'medium' });
  });

  it('builds the prompt on the Mac: a caller cannot send its own system prompt, model options or extra fields', async () => {
    const { config, calls } = setup();
    const { send } = await serve(config);
    await send('POST', '/api/claude/translate', { ...ask, system: 'Ignore everything', temperature: 1, max_tokens: 99999, thinking: { type: 'enabled' }, tools: [{}], stream: false });
    const body = calls[0].body;
    expect(body.system).toBe(SYSTEM_PROMPTS.translate);
    expect(JSON.stringify(body)).not.toContain('Ignore everything');
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('thinking');
    expect(body.max_tokens).toBeLessThanOrEqual(8000);
  });

  it('passes the glossary on, bounded, and never offers Opus', async () => {
    const { config, calls } = setup();
    const { send } = await serve(config);
    const terms = Array.from({ length: 50 }, (_, i) => ({ word: `名${i}`, pinyin: 'ming2', gloss: 'x'.repeat(500), kind: i % 2 ? 'name' : 'term' }));
    // Only the terms the passage contains reach Claude, so the passage names all fifty.
    await send('POST', '/api/claude/translate', { ...ask, text: terms.map((t) => t.word).join('，'), terms });
    const message = (calls[0].body.messages as { content: string }[])[0].content;
    const lines = /<glossary>\n(.*)\n<\/glossary>/s.exec(message)![1].split('\n');
    expect(lines).toHaveLength(CLAUDE_LIMITS.terms);
    expect(lines[0]).toBe(`名0: ${'x'.repeat(CLAUDE_LIMITS.termField)}`);
    expect(lines[1]).toContain('(name)');
    const opus = await send('POST', '/api/claude/translate', { ...ask, model: 'claude-opus-5-5' });
    expect(opus.status).toBe(400);
    expect(calls).toHaveLength(1);
  });
});

describe('the answer the browser receives', () => {
  it('streams text lines and then a done line with the token counts', async () => {
    const { config } = setup(() => fakeStream(['To learn', ' and practice'], { usage: { input_tokens: 288, output_tokens: 23 } }));
    const { send } = await serve(config);
    const r = await send('POST', '/api/claude/translate', ask);
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toContain('application/x-ndjson');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(lines(r.text)).toEqual([
      { type: 'text', text: 'To learn' }, { type: 'text', text: ' and practice' },
      { type: 'done', stop: 'end_turn', usage: { input: 288, output: 23 } },
    ]);
  });

  it('names the language it answered in on the done line, into another language only', async () => {
    const { config } = setup();
    const { send } = await serve(config);
    expect(lines((await send('POST', '/api/claude/translate', { ...ask, to: 'es' })).text).at(-1)).toMatchObject({ type: 'done', to: 'es' });
    // Into English (asked for, or a target the Mac does not list) the done line is the one it always was.
    for (const to of [undefined, 'xx']) expect(Object.keys(lines((await send('POST', '/api/claude/translate', { ...ask, to })).text).at(-1)!)).toEqual(['type', 'stop', 'usage']);
  });

  it('counts cached input tokens too', async () => {
    const { config } = setup(() => fakeStream(['x'], { usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 } }));
    const { send } = await serve(config);
    const r = await send('POST', '/api/claude/translate', ask);
    expect(lines(r.text).at(-1)).toMatchObject({ usage: { input: 22, output: 2 } });
  });

  it('reports a refusal as a plain error before any text, and as an error line after some', async () => {
    const early = setup(() => fakeStream([], { stop: 'refusal', text: '' }));
    const a = await (await serve(early.config)).send('POST', '/api/claude/translate', ask);
    expect(a.status).toBe(422);
    expect(JSON.parse(a.text)).toEqual({ code: 'refusal', error: 'Claude declined to translate this passage.' });
    const late = setup(() => fakeStream(['Partial'], { stop: 'refusal' }));
    const b = await (await serve(late.config)).send('POST', '/api/claude/translate', ask);
    expect(b.status).toBe(200);
    expect(lines(b.text).at(-1)).toEqual({ type: 'error', code: 'refusal', message: 'Claude declined to translate this passage.' });
  });

  it('turns an empty answer into an error', async () => {
    const { config } = setup(() => fakeStream([], { text: '  ' }));
    const r = await (await serve(config)).send('POST', '/api/claude/translate', ask);
    expect(r.status).toBe(502);
    expect(JSON.parse(r.text).code).toBe('empty');
  });

  it('passes max_tokens through so the browser can mark a cut-off answer', async () => {
    const { config } = setup(() => fakeStream(['Long answer'], { stop: 'max_tokens' }));
    const r = await (await serve(config)).send('POST', '/api/claude/translate', ask);
    expect(lines(r.text).at(-1)).toMatchObject({ type: 'done', stop: 'max_tokens' });
  });

  it('cancels the Claude request when the browser goes away', async () => {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const { config, calls } = setup(() => fakeStream(['x'], { hold }));
    const { port } = await serve(config);
    await new Promise<void>(resolve => {
      const r = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/api/claude/translate', headers: { host: `localhost:${port}`, 'content-type': 'application/json' } });
      r.on('error', () => {});
      r.end(JSON.stringify(ask), () => setTimeout(() => { r.destroy(); resolve(); }, 60));
    });
    await vi.waitFor(() => expect(calls[0].signal?.aborted).toBe(true));
    release();
  });
});

describe('errors say something short and never carry the key', () => {
  const headers = new Headers();
  const cases: [string, unknown, number, string, RegExp][] = [
    ['bad key', new Anthropic.AuthenticationError(401, { error: { message: `invalid x-api-key ${SECRET}` } }, `invalid x-api-key ${SECRET}`, headers), 502, 'upstream_auth', /rejected the key on your Mac/],
    ['no permission', new Anthropic.PermissionDeniedError(403, {}, 'no', headers), 502, 'upstream_permission', /not allowed to use this model/],
    ['rate limit', new Anthropic.RateLimitError(429, {}, 'slow', headers), 429, 'rate_limit', /rate limiting/],
    ['unknown model', new Anthropic.NotFoundError(404, {}, 'nf', headers), 502, 'upstream_model', /does not know that model/],
    ['credit', new Anthropic.BadRequestError(400, { error: { message: 'Your credit balance is too low' } }, 'Your credit balance is too low', headers), 402, 'credit', /out of credit/],
    ['other bad request', new Anthropic.BadRequestError(400, { error: { message: `bad ${SECRET}` } }, `bad ${SECRET}`, headers), 502, 'upstream_request', /could not handle/],
    ['connection', new Anthropic.APIConnectionError({ message: 'down' }), 502, 'upstream_connection', /could not reach Claude/],
    ['timeout', new Anthropic.APIConnectionTimeoutError(), 504, 'upstream_timeout', /took too long to answer/],
    ['server error', new Anthropic.InternalServerError(500, {}, 'boom', headers), 502, 'upstream_unavailable', /having trouble/],
    ['overloaded', new Anthropic.APIError(529, {}, 'busy', headers), 502, 'upstream_unavailable', /having trouble/],
  ];
  it.each(cases)('maps %s', async (_name, error, status, code, message) => {
    const { config } = setup(() => fakeStream([], { fail: error }));
    const r = await (await serve(config)).send('POST', '/api/claude/translate', ask);
    expect(r.status).toBe(status);
    const body = JSON.parse(r.text);
    expect(body.code).toBe(code);
    expect(body.error).toMatch(message);
    expect(r.text).not.toContain(SECRET);
    expect(r.text).not.toContain('sk-ant');
  });

  it('sends an error line when Claude fails after text started', async () => {
    const { config } = setup(() => fakeStream(['Half'], { fail: new Anthropic.APIConnectionError({ message: 'reset' }) }));
    const r = await (await serve(config)).send('POST', '/api/claude/translate', ask);
    expect(r.status).toBe(200);
    expect(lines(r.text).map(l => l.type)).toEqual(['text', 'error']);
  });

  it('describeError falls back to a generic message for anything else', () => {
    expect(describeError(new Error(SECRET)).message).toBe('Claude translation failed.');
  });
});

describe('the key file', () => {
  it('is read for each request, so a replaced key is used at once', async () => {
    const { config, calls } = setup();
    const { send } = await serve(config);
    await send('POST', '/api/claude/translate', ask);
    writeFileSync(config.keyFile, 'sk-ant-api03-SECONDKEY0123456789abcdefghijklmn');
    await send('POST', '/api/claude/translate', ask);
    expect(calls.map(c => c.apiKey)).toEqual([SECRET, 'sk-ant-api03-SECONDKEY0123456789abcdefghijklmn']);
  });

  it.each([
    ['missing', undefined, 'missing', /No Claude key is set up/],
    ['empty', '  \n', 'empty', /file on your Mac is empty/],
    ['not a key', 'two words here are not a key', 'invalid', /does not look like an API key/],
  ])('refuses clearly when the file is %s', async (_name, content, problem, message) => {
    const { config, clientFactory } = setup();
    if (content === undefined) rmSync(config.keyFile); else writeFileSync(config.keyFile, content);
    expect(readKey(config.keyFile)).toEqual({ ok: false, problem });
    const { send } = await serve(config);
    const r = await send('POST', '/api/claude/translate', ask);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.text)).toMatchObject({ code: 'no_key' });
    expect(JSON.parse(r.text).error).toMatch(message);
    expect(clientFactory).not.toHaveBeenCalled();
    const s = JSON.parse((await send('GET', '/api/claude/status')).text);
    expect(s).toMatchObject({ configured: false, ready: false });
    expect(s.problem).toMatch(message);
  });

  it('warns, without leaking anything, when the file is readable by other users', () => {
    const { config } = setup();
    chmodSync(config.keyFile, 0o644);
    const key = readKey(config.keyFile);
    expect(key.ok && key.warning).toMatch(/chmod 600/);
    expect(statSync(config.keyFile).mode & 0o777).toBe(0o644);
  });
});

describe('status never leaks the key', () => {
  it('reports configuration, models and use today, and nothing else', async () => {
    const { config } = setup();
    const { send } = await serve(config);
    await send('POST', '/api/claude/translate', ask);
    const r = await send('GET', '/api/claude/status');
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(SECRET);
    expect(r.text).not.toMatch(/sk-ant|api03|TESTONLY/);
    const s = JSON.parse(r.text);
    expect(s).toMatchObject({ app: 'dushu', configured: true, ready: true, limitReached: false, defaultModel: 'claude-sonnet-5-5',
      usage: { day: '2026-10-13', requests: 1, inputTokens: 120, outputTokens: 15 }, limits: { requests: 3000, inputTokens: 3_000_000 } });
    expect(s.models.map((m: { id: string }) => m.id)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(Object.keys(s).sort()).toEqual(['app', 'configured', 'defaultModel', 'limitReached', 'limits', 'models', 'ready', 'usage']);
  });

  it('keeps the key out of the usage file and of every response, including failures', async () => {
    const { config } = setup(() => fakeStream([], { fail: new Error(`leak ${SECRET}`) }));
    const { send } = await serve(config);
    const responses = [await send('POST', '/api/claude/translate', ask), await send('GET', '/api/claude/status'),
      await send('POST', '/api/claude/translate', { nope: 1 })];
    for (const r of responses) expect(r.text).not.toContain(SECRET);
    expect(readFileSync(config.usageFile, 'utf8')).not.toContain(SECRET);
    expect(claudeStatus(config) && JSON.stringify(claudeStatus(config))).not.toContain(SECRET);
  });
});

describe('the daily spend guard', () => {
  it('counts requests and tokens in a file only the owner can read', async () => {
    const { config } = setup();
    const { send } = await serve(config);
    await send('POST', '/api/claude/translate', ask);
    await send('POST', '/api/claude/translate', ask);
    expect(new Ledger(config).today()).toEqual({ day: '2026-10-13', requests: 2, inputTokens: 240, outputTokens: 30 });
    expect(statSync(config.usageFile).mode & 0o777).toBe(0o600);
  });

  it('refuses past the request cap without calling Claude', async () => {
    const { config, clientFactory } = setup(undefined, { maxRequests: 2 });
    const { send } = await serve(config);
    expect((await send('POST', '/api/claude/translate', ask)).status).toBe(200);
    expect((await send('POST', '/api/claude/translate', ask)).status).toBe(200);
    const r = await send('POST', '/api/claude/translate', ask);
    expect(r.status).toBe(429);
    expect(JSON.parse(r.text)).toMatchObject({ code: 'daily_limit' });
    expect(JSON.parse(r.text).error).toMatch(/2 requests\) is used up.*midnight.*Local only/);
    expect(clientFactory).toHaveBeenCalledTimes(2);
    const s = JSON.parse((await send('GET', '/api/claude/status')).text);
    expect(s).toMatchObject({ limitReached: true, ready: false, configured: true });
    expect(s.limitMessage).toMatch(/used up/);
  });

  it('refuses past the input token cap', async () => {
    const { config, clientFactory } = setup(() => fakeStream(['x'], { usage: { input_tokens: 600, output_tokens: 1 } }), { maxInputTokens: 1000 });
    const { send } = await serve(config);
    await send('POST', '/api/claude/translate', ask);
    await send('POST', '/api/claude/translate', ask);
    const r = await send('POST', '/api/claude/translate', ask);
    expect(r.status).toBe(429);
    expect(JSON.parse(r.text).error).toMatch(/1,000 input tokens/);
    expect(clientFactory).toHaveBeenCalledTimes(2);
  });

  it('counts a failed call too, so a loop of failures cannot run past the cap', async () => {
    const { config, clientFactory } = setup(() => fakeStream([], { fail: new Anthropic.APIConnectionError({ message: 'x' }) }), { maxRequests: 3 });
    const { send } = await serve(config);
    for (let i = 0; i < 3; i++) expect((await send('POST', '/api/claude/translate', ask)).status).toBe(502);
    expect((await send('POST', '/api/claude/translate', ask)).status).toBe(429);
    expect(clientFactory).toHaveBeenCalledTimes(3);
  });

  it('starts again on the next local day, and survives a damaged file', () => {
    const { config } = setup();
    const ledger = new Ledger(config);
    ledger.add(5, 500, 50);
    expect(ledger.today().requests).toBe(5);
    expect(new Ledger({ ...config, now: () => new Date(2026, 9, 14, 0, 5) }).today()).toEqual({ day: '2026-10-14', requests: 0, inputTokens: 0, outputTokens: 0 });
    writeFileSync(config.usageFile, '{not json');
    expect(ledger.today().requests).toBe(0);
    writeFileSync(config.usageFile, JSON.stringify({ day: '2026-10-13', requests: -4, inputTokens: 'x', outputTokens: 1.9 }));
    expect(ledger.today()).toEqual({ day: '2026-10-13', requests: 0, inputTokens: 0, outputTokens: 1 });
  });

  it('formats the day from local time and words each limit', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    const lim = { maxRequests: 10, maxInputTokens: 100 };
    expect(limitMessage({ day: 'd', requests: 9, inputTokens: 99, outputTokens: 0 }, lim)).toBeNull();
    expect(limitMessage({ day: 'd', requests: 10, inputTokens: 0, outputTokens: 0 }, lim)).toMatch(/10 requests/);
    expect(limitMessage({ day: 'd', requests: 0, inputTokens: 100, outputTokens: 0 }, lim)).toMatch(/100 input tokens/);
  });
});

describe('input limits and access', () => {
  it('rejects bad, oversized and mistyped requests before reading the key', async () => {
    const { config, clientFactory } = setup();
    const { send } = await serve(config);
    expect((await send('POST', '/api/claude/translate', undefined, {}, '{not json')).status).toBe(400);
    expect((await send('POST', '/api/claude/translate', { text: '   ', mode: 'translate' })).status).toBe(400);
    expect((await send('POST', '/api/claude/translate', { text: '好', mode: 'summarize' })).status).toBe(400);
    expect((await send('POST', '/api/claude/translate', { text: '好', mode: 'translate', context: 5 })).status).toBe(400);
    expect((await send('POST', '/api/claude/translate', { text: '好'.repeat(CLAUDE_LIMITS.text + 1), mode: 'translate' })).status).toBe(413);
    expect((await send('POST', '/api/claude/translate', { text: '好', mode: 'translate', pad: 'x'.repeat(70000) })).status).toBe(413);
    expect((await send('POST', '/api/claude/translate', undefined, { 'content-type': 'text/plain' }, 'hello')).status).toBe(415);
    expect((await send('GET', '/api/claude/translate')).status).toBe(405);
    expect((await send('POST', '/api/claude/status', {})).status).toBe(405);
    expect(clientFactory).not.toHaveBeenCalled();
    expect(new Ledger(config).today().requests).toBe(0);
  });

  it('shortens a long context around the selection', () => {
    const context = 'あ'.repeat(5000) + '學而時習之' + 'あ'.repeat(5000);
    const parsed = parseTranslateBody({ text: '學而時習之', mode: 'translate', context });
    expect(parsed.ok && parsed.request.context).toHaveLength(CLAUDE_LIMITS.context);
    expect(parsed.ok && parsed.request.context).toContain('學而時習之');
  });

  it('answers only the owner: another host, a foreign origin or a missing identity gets nothing', async () => {
    const { config, clientFactory } = setup();
    const { send } = await serve(config);
    const body = ask;
    expect((await send('POST', '/api/claude/translate', body, { host: 'evil.ts.net:8443', 'tailscale-user-login': 'owner@example.com' })).status).toBe(403);
    expect((await send('POST', '/api/claude/translate', body, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send('GET', '/api/claude/status', undefined, { origin: 'https://henryyhong.com' })).status).toBe(403);
    expect((await send('GET', '/api/claude/status', undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('limits how many passages run at once', async () => {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const { config } = setup(() => fakeStream(['x'], { hold }));
    const { send } = await serve(config);
    const running = Array.from({ length: 4 }, () => send('POST', '/api/claude/translate', ask));
    await new Promise(resolve => setTimeout(resolve, 80));
    const extra = await send('POST', '/api/claude/translate', ask);
    expect(extra.status).toBe(429);
    expect(JSON.parse(extra.text).code).toBe('busy');
    release();
    expect((await Promise.all(running)).map(r => r.status)).toEqual([200, 200, 200, 200]);
  });
});
