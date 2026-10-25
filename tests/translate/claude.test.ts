import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeReadySync, createClaudeTranslator, fetchClaudeStatus, resetClaudeStatus } from '../../src/translate/claude';
import { translationSystem } from '../../src/translate/prompt';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, SYSTEM_PROMPTS, buildUserMessage, clampContext } from '../../src/translate/claudePrompts';

/** A response whose body arrives in the given pieces, so a line can be split anywhere. */
function pieces(parts: string[], init: ResponseInit = { status: 200 }): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) { for (const p of parts) controller.enqueue(encoder.encode(p)); controller.close(); },
  }), init);
}
const ndjson = (...events: object[]) => events.map(e => JSON.stringify(e) + '\n').join('');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ready = { configured: true, limitReached: false, usage: { day: 'd', requests: 3, inputTokens: 900, outputTokens: 120 }, limits: { requests: 3000, inputTokens: 3000000 } };

function setup(handler: (path: string, init?: RequestInit) => Response | Promise<Response>, settings = { claudeModel: '', localOnly: false }) {
  const fetch = vi.fn(async (path: string, init?: RequestInit) => handler(path, init));
  const hasBridge = vi.fn(() => true);
  return { fetch, hasBridge, t: createClaudeTranslator(settings, { fetch, hasBridge }) };
}

beforeEach(() => { resetClaudeStatus(); });

describe('claude translator (through the Mac)', () => {
  it('posts only the passage, the mode, the model and the glossary, with no key', async () => {
    const { t, fetch } = setup(() => pieces([ndjson({ type: 'text', text: 'Hi' }, { type: 'done', stop: 'end_turn', usage: { input: 1, output: 1 } })]));
    await t.translate({ text: '你好', context: '他说：你好。', mode: 'explain', terms: [{ word: '你好', pinyin: 'ni3 hao3', gloss: 'hello', kind: 'term' }] });
    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe('/api/claude/translate');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ text: '你好', context: '他说：你好。', mode: 'explain', model: DEFAULT_CLAUDE_MODEL,
      terms: [{ word: '你好', pinyin: 'ni3 hao3', gloss: 'hello', kind: 'term' }] });
    expect(String(init?.body)).not.toMatch(/system|sk-ant|apiKey|x-api-key/);
    expect(JSON.stringify(init?.headers)).not.toMatch(/key/i);
  });

  it('sends the chosen model', async () => {
    const { t, fetch } = setup(() => pieces([ndjson({ type: 'text', text: 'x' }, { type: 'done', stop: 'end_turn' })]), { claudeModel: 'claude-haiku-5-5', localOnly: false });
    await t.translate({ text: '好', mode: 'translate' });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).model).toBe('claude-haiku-5-5');
  });

  it('streams the text so far to onDelta, even when a line is split across chunks', async () => {
    const lines = ndjson({ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo ' }, { type: 'text', text: 'world' }, { type: 'done', stop: 'end_turn' });
    const cut = [lines.slice(0, 7), lines.slice(7, 40), lines.slice(40, 41), lines.slice(41)];
    const { t } = setup(() => pieces(cut));
    const seen: string[] = [];
    expect(await t.translate({ text: '你好', mode: 'translate' }, { onDelta: s => seen.push(s) })).toBe('Hello world');
    expect(seen).toEqual(['Hel', 'Hello ', 'Hello world']);
  });

  it('reads a last line that has no newline, and reads a body that is not a stream', async () => {
    const last = pieces([JSON.stringify({ type: 'text', text: 'A' }) + '\n' + JSON.stringify({ type: 'done', stop: 'end_turn' })]);
    expect(await setup(() => last).t.translate({ text: '好', mode: 'translate' })).toBe('A');
    const plain = { ok: true, status: 200, body: null, text: async () => ndjson({ type: 'text', text: 'B' }, { type: 'done', stop: 'end_turn' }) } as unknown as Response;
    expect(await setup(() => plain).t.translate({ text: '好', mode: 'translate' })).toBe('B');
  });

  it('marks an answer that ran out of room', async () => {
    const { t } = setup(() => pieces([ndjson({ type: 'text', text: 'Long' }, { type: 'done', stop: 'max_tokens' })]));
    expect(await t.translate({ text: '好', mode: 'translate' })).toBe('Long …');
  });

  it('says so when the connection ends before Claude finished', async () => {
    const { t } = setup(() => pieces([ndjson({ type: 'text', text: 'Half' })]));
    await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/ended before Claude finished/);
  });

  it('turns a failure partway through into the Mac\'s own short message', async () => {
    const { t } = setup(() => pieces([ndjson({ type: 'text', text: 'Half' }, { type: 'error', code: 'upstream_connection', message: 'Your Mac could not reach Claude. Check its internet connection.' })]));
    await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow('Your Mac could not reach Claude. Check its internet connection.');
  });

  it('shows what the Mac says about an HTTP error', async () => {
    const cases: [number, object, RegExp][] = [
      [429, { code: 'daily_limit', error: 'Today\'s Claude limit on your Mac (3,000 requests) is used up. It resets at midnight. Local only still works.' }, /used up/],
      [503, { code: 'no_key', error: 'No Claude key is set up on your Mac. Save it in ~/.config/dushu/anthropic-api-key.' }, /No Claude key/],
      [422, { code: 'refusal', error: 'Claude declined to translate this passage.' }, /declined/],
      [502, { code: 'upstream_auth', error: 'Anthropic rejected the key on your Mac. Replace it in ~/.config/dushu/anthropic-api-key.' }, /rejected the key/],
    ];
    for (const [status, body, re] of cases) {
      resetClaudeStatus();
      await expect(setup(() => json(body, status)).t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(re);
    }
    resetClaudeStatus();
    await expect(setup(() => new Response('<html>', { status: 500 })).t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/failed \(500\)/);
  });

  it('explains a refusal by the Mac for this device', async () => {
    const { t } = setup(() => new Response(null, { status: 403 }));
    await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/did not accept this device/);
  });

  it('explains an unreachable Mac, and passes an abort through untouched', async () => {
    await expect(setup(() => { throw new TypeError('Failed to fetch'); }).t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/Could not reach your Mac/);
    const abort = new DOMException('aborted', 'AbortError');
    await expect(setup(() => { throw abort; }).t.translate({ text: '好', mode: 'translate' })).rejects.toBe(abort);
    const ac = new AbortController();
    ac.abort();
    const { t, fetch } = setup(() => pieces(['']));
    await expect(t.translate({ text: '好', mode: 'translate' }, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses without any request when Local only is on, there is no Mac, or the passage is too long', async () => {
    const local = setup(() => pieces(['']), { claudeModel: '', localOnly: true });
    await expect(local.t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/Local only is on/);
    expect(await local.t.availability()).toBe('no');
    const none = setup(() => pieces(['']));
    none.hasBridge.mockReturnValue(false);
    await expect(none.t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/Sign in, or connect this device to your Mac/);
    expect(await none.t.availability()).toBe('no');
    const long = setup(() => pieces(['']));
    await expect(long.t.translate({ text: '好'.repeat(8001), mode: 'translate' })).rejects.toThrow(/too long/);
    expect(local.fetch).not.toHaveBeenCalled();
    expect(none.fetch).not.toHaveBeenCalled();
    expect(long.fetch).not.toHaveBeenCalled();
  });

  it('stops choosing Claude for a minute after a failure that will repeat', async () => {
    vi.useFakeTimers();
    try {
      const { t, fetch } = setup((path) => path.endsWith('/status') ? json(ready) : json({ code: 'daily_limit', error: 'Used up.' }, 429));
      expect(await t.availability()).toBe('yes');
      await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow('Used up.');
      const calls = fetch.mock.calls.length;
      expect(await t.availability()).toBe('no');
      expect(fetch.mock.calls.length).toBe(calls);
      vi.advanceTimersByTime(61000);
      expect(await t.availability()).toBe('yes');
    } finally { vi.useRealTimers(); }
  });

  it('does not block Claude after a failure that is only about this passage', async () => {
    const { t } = setup((path) => path.endsWith('/status') ? json(ready) : json({ code: 'refusal', error: 'Claude declined to translate this passage.' }, 422));
    await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/declined/);
    expect(await t.availability()).toBe('yes');
  });
});

describe('Claude status', () => {
  const ask = (handler: (path: string) => Response | Promise<Response>, extra: { force?: boolean } = {}) => {
    const fetch = vi.fn(async (path: string) => handler(path));
    return { fetch, run: () => fetchClaudeStatus({ fetch, hasBridge: () => true, ...extra }) };
  };

  it('reads reachable, key and use today from the Mac', async () => {
    const { run } = ask(() => json(ready));
    expect(await run()).toMatchObject({ reachable: true, denied: false, configured: true, ready: true, usage: { requests: 3 }, limits: { requests: 3000 } });
  });

  it('is not ready when the key is missing or today\'s limit is used', async () => {
    expect(await ask(() => json({ configured: false, problem: 'No key.' })).run()).toMatchObject({ reachable: true, configured: false, ready: false, problem: 'No key.' });
    resetClaudeStatus();
    expect(await ask(() => json({ ...ready, limitReached: true, limitMessage: 'Used up.' })).run()).toMatchObject({ configured: true, ready: false, limitMessage: 'Used up.' });
  });

  it('tells a refusing Mac from a Mac that is off', async () => {
    expect(await ask(() => new Response(null, { status: 403 })).run()).toMatchObject({ reachable: true, denied: true, ready: false });
    resetClaudeStatus();
    expect(await ask(() => { throw new TypeError('Failed to fetch'); }).run()).toMatchObject({ reachable: false, denied: false, ready: false });
    resetClaudeStatus();
    expect(await ask(() => new Response(null, { status: 500 })).run()).toMatchObject({ reachable: false });
  });

  it('asks once within a few seconds, and again when forced', async () => {
    const { fetch, run } = ask(() => json(ready));
    await run();
    await run();
    expect(fetch).toHaveBeenCalledTimes(1);
    await fetchClaudeStatus({ fetch, hasBridge: () => true, force: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('answers claudeReadySync from what was last learned, without asking', async () => {
    const on = { localOnly: false };
    expect(claudeReadySync(on, () => true)).toBe(false);
    const { run } = ask(() => json(ready));
    await run();
    expect(claudeReadySync(on, () => true)).toBe(true);
    expect(claudeReadySync({ localOnly: true }, () => true)).toBe(false);
    expect(claudeReadySync(on, () => false)).toBe(false);
  });

  it('does not ask at all without a Mac', async () => {
    const fetch = vi.fn();
    expect(await fetchClaudeStatus({ fetch, hasBridge: () => false })).toMatchObject({ reachable: false, ready: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('the shared prompts', () => {
  it('offers Sonnet first and Haiku, never Opus', () => {
    expect(CLAUDE_MODELS.map(m => m.value)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(DEFAULT_CLAUDE_MODEL).toBe('claude-sonnet-5-5');
  });
  it('builds the user message with the glossary, the context and the text', () => {
    const message = buildUserMessage({ text: '你好', context: '他说：你好。', terms: [{ word: '你好', pinyin: 'ni3 hao3', gloss: 'hello' }] });
    expect(message).toContain('<glossary>');
    expect(message).toContain('你好: hello');
    expect(message).toContain('<context>\n他说：你好。\n</context>');
    expect(message).toContain('<text>\n你好\n</text>');
    expect(buildUserMessage({ text: '好', context: '好' })).not.toContain('<context>');
  });
  it('asks for plain text, with bullets only in explain mode', () => {
    expect(SYSTEM_PROMPTS.translate).toContain('Reply with only the English translation');
    expect(SYSTEM_PROMPTS.translate).toContain('no Markdown');
    expect(SYSTEM_PROMPTS.explain).toContain('"- "');
    expect(SYSTEM_PROMPTS.explain).toBe(translationSystem('explain', 'claude'));
  });
  it('keeps the selection when it trims a long context, on whole characters', () => {
    const context = '😀'.repeat(3000) + '學而時習之' + '😀'.repeat(3000);
    const kept = clampContext(context, '學而時習之', 3000);
    expect(kept.length).toBeLessThanOrEqual(3000);
    expect(kept).toContain('學而時習之');
    expect(/^[\uDC00-\uDFFF]/.test(kept) || /[\uD800-\uDBFF]$/.test(kept)).toBe(false);
  });
});
