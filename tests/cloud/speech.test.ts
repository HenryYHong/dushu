// @vitest-environment jsdom
// Read-aloud through the account: the server reads one sentence with Workers AI (faked here) and passes the model's answer on
// as it is, counts characters against the day under the free allowance, and refuses past it.
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../cloud/src/worker';
import { cloud, signedIn } from './helpers';

function fakeAi() {
  const asked: { model: string; input: Record<string, unknown>; options?: { returnRawResponse?: boolean } }[] = [];
  const AI: NonNullable<Env['AI']> = {
    run: async (model, input, options) => {
      asked.push({ model, input, options });
      return new Response(JSON.stringify({ audio: btoa('RIFF fake wav') }), { headers: { 'Content-Type': 'application/json' } });
    },
  };
  return { AI, asked };
}

describe('read-aloud through the account', () => {
  it('reads a sentence in Mandarin and passes the model’s answer on, for a device signed in', async () => {
    const ai = fakeAi();
    const c = cloud({ AI: ai.AI });
    const token = await signedIn(c);
    const res = await c.post('/speech', { text: ' 床前明月光。 ' }, token);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://henryyhong.com');
    expect(atob((await res.json() as { audio: string }).audio)).toBe('RIFF fake wav');
    expect(ai.asked).toEqual([{ model: '@cf/myshell-ai/melotts', input: { prompt: '床前明月光。', lang: 'zh' }, options: { returnRawResponse: true } }]);
    expect((await c.post('/speech', { text: '你好' })).status).toBe(401);
    expect((await c.post('/speech', { text: '  ' }, token)).status).toBe(400);
    expect((await c.post('/speech', { text: '好'.repeat(401) }, token)).status).toBe(413);
    expect(ai.asked).toHaveLength(1);
  });

  it('stops at the day’s characters, which never go past the free allowance', async () => {
    const ai = fakeAi();
    const c = cloud({ AI: ai.AI, SPEECH_MAX_CHARS: '10' } as Partial<Env>);
    const token = await signedIn(c);
    expect((await c.post('/speech', { text: '一二三四五六' }, token)).status).toBe(200);
    const over = await c.post('/speech', { text: '七八九十一' }, token);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ code: 'daily_limit' });
    expect((await c.post('/speech', { text: '七八九十' }, token)).status).toBe(200);
    expect(ai.asked).toHaveLength(2);
    // A larger setting cannot raise the cap past the free allowance.
    const big = cloud({ AI: ai.AI, SPEECH_MAX_CHARS: '5000000' } as Partial<Env>);
    const t2 = await signedIn(big);
    for (let i = 0; i < 3; i++) expect((await big.post('/speech', { text: '好'.repeat(400) }, t2)).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let n = 3;
      while ((await big.post('/speech', { text: '好'.repeat(400) }, t2)).status === 200) n++;
      expect(n * 400).toBeLessThanOrEqual(90_000);
      expect(n * 400).toBeGreaterThan(89_000);
    } finally { vi.useRealTimers(); }
  });

  it('says so when read-aloud is not set up or the model fails', async () => {
    const none = cloud();
    expect(await (await none.post('/speech', { text: '你好' }, await signedIn(none))).json()).toMatchObject({ code: 'no_voice' });
    const failing = cloud({ AI: { run: async () => { throw new Error('model down'); } } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await failing.post('/speech', { text: '你好' }, await signedIn(failing));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'voice_failed' });
    vi.restoreAllMocks();
  });
});
