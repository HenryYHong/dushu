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
    const c = cloud({ AI: ai.AI, SPEECH_MAX_CHARS: '10', OWNER_EMAILS: 'reader@example.com' } as Partial<Env>);
    const token = await signedIn(c);
    expect((await c.post('/speech', { text: '一二三四五六' }, token)).status).toBe(200);
    const over = await c.post('/speech', { text: '七八九十一' }, token);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ code: 'daily_limit' });
    expect((await c.post('/speech', { text: '七八九十' }, token)).status).toBe(200);
    expect(ai.asked).toHaveLength(2);
    // A larger setting cannot raise the cap past the free allowance, even for the owner.
    const big = cloud({ AI: ai.AI, SPEECH_MAX_CHARS: '5000000', OWNER_EMAILS: 'reader@example.com' } as Partial<Env>);
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

  it('gives everyone else a share each, and all of them together two thirds of the day, so the owner always has some', async () => {
    const ai = fakeAi();
    const c = cloud({ AI: ai.AI, OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const read = async (token: string, times: number) => {
      let ok = 0;
      for (let i = 0; i < times; i++) if ((await c.post('/speech', { text: '好'.repeat(400) }, token)).status === 200) ok++;
      return ok;
    };
    // One friend: 15,000 characters a day (37 sentences of 400).
    const friends = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((f) => signedIn(c, `${f}@example.com`)));
    expect(await read(friends[0], 40)).toBe(37);
    // Four more: together they stop at 60,000 (150 sentences of 400), the last one short.
    let rest = 0;
    for (const f of friends.slice(1)) rest += await read(f, 40);
    expect(37 + rest).toBe(150);
    const over = await c.post('/speech', { text: '好' }, friends[4]);
    expect(await over.json()).toMatchObject({ code: 'daily_limit', error: expect.stringContaining('free read-aloud is used up') });
    // The owner still has the last third of the free allowance.
    expect(await read(await signedIn(c, 'owner@example.com'), 80)).toBe(75);
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
