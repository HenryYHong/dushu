import { AuthenticationError, APIConnectionError, RateLimitError } from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { buildUserMessage, createClaudeTranslator, SYSTEM_PROMPTS, type ClaudeClient, type ClaudeStream } from '../../src/translate/claude';

function fakeStream(deltas: string[], stop: string | null = 'end_turn', fail?: unknown): ClaudeStream {
  let onText: (d: string, s: string) => void = () => {};
  return {
    on(_e, fn) { onText = fn; return this; },
    abort() {},
    async finalMessage() {
      if (fail) throw fail;
      let snap = '';
      for (const d of deltas) { snap += d; onText(d, snap); }
      return { stop_reason: stop, content: [{ type: 'text', text: snap }] };
    },
  };
}

function setup(stream: ClaudeStream, settings = { claudeApiKey: 'sk-test', claudeModel: '' }) {
  const stub = vi.fn((_b: Record<string, unknown>, _o?: unknown) => stream);
  const client: ClaudeClient = { beta: { messages: { stream: stub } } };
  const factory = vi.fn(async (_k: string) => client);
  return { stub, factory, t: createClaudeTranslator(settings, { clientFactory: factory }) };
}

describe('claude translator', () => {
  it('sends the exact request shape', async () => {
    const { t, stub, factory } = setup(fakeStream(['Hi']));
    await t.translate({ text: '你好', context: '他说：你好。', mode: 'translate' });
    expect(factory).toHaveBeenCalledWith('sk-test');
    const body = stub.mock.calls[0][0];
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.max_tokens).toBe(2000);
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(body.fallbacks).toBe('default');
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.system).toBe(SYSTEM_PROMPTS.translate);
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('temperature');
    const msgs = body.messages as { role: string; content: string }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user'); // no assistant prefill
    expect(msgs[0].content).toContain('<context>\n他说：你好。\n</context>');
    expect(msgs[0].content).toContain('<text>\n你好\n</text>');
  });
  it('uses the configured model and the explain prompt', async () => {
    const { t, stub } = setup(fakeStream(['x']), { claudeApiKey: 'k', claudeModel: 'claude-haiku-5-5' });
    await t.translate({ text: '好', mode: 'explain' });
    expect(stub.mock.calls[0][0].model).toBe('claude-haiku-5-5');
    expect(stub.mock.calls[0][0].system).toBe(SYSTEM_PROMPTS.explain);
    expect(SYSTEM_PROMPTS.explain).toContain('"- "');
  });
  it('streams snapshots to onDelta and returns the final text', async () => {
    const { t } = setup(fakeStream(['Hel', 'lo ', 'world']));
    const seen: string[] = [];
    expect(await t.translate({ text: '你好', mode: 'translate' }, { onDelta: s => seen.push(s) })).toBe('Hello world');
    expect(seen).toEqual(['Hel', 'Hello ', 'Hello world']);
  });
  it('omits context when it equals the text', () => {
    expect(buildUserMessage({ text: '好', context: '好', mode: 'translate' })).not.toContain('<context>');
  });
  it('reports a refusal', async () => {
    const { t } = setup(fakeStream([], 'refusal'));
    await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/declined/);
  });
  it('maps SDK errors to short messages', async () => {
    const h = new Headers();
    const cases: [unknown, RegExp][] = [
      [new AuthenticationError(401, { error: { message: 'bad' } }, 'bad', h), /API key/],
      [new RateLimitError(429, {}, 'slow', h), /rate limiting/],
      [new APIConnectionError({ message: 'down' }), /Could not reach Claude/],
    ];
    for (const [err, re] of cases) {
      const { t } = setup(fakeStream([], 'end_turn', err));
      await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(re);
    }
  });
  it('requires a key and never builds a client without one', async () => {
    const { t, factory } = setup(fakeStream(['x']), { claudeApiKey: '  ', claudeModel: '' });
    expect(await t.availability()).toBe('no');
    await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/API key/);
    expect(factory).not.toHaveBeenCalled();
  });
  it('rejects with AbortError when already aborted', async () => {
    const { t } = setup(fakeStream(['x']));
    const c = new AbortController(); c.abort();
    await expect(t.translate({ text: '好', mode: 'translate' }, { signal: c.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
