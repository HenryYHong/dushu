// @vitest-environment jsdom
// Sentence translation through the account for anyone signed in: the server asks Qwen3 on Workers AI (faked here) with the
// local model's prompt and its thinking off, counts the neurons it used against the reader's day and everyone's, and refuses
// past them, so the day never leaves the free allowance. The app's side: Automatic picks it for a reader without Claude.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../cloud/src/worker';
import { ACCOUNT_TEXT } from '../../src/translate/prompt';
import { createAccountTranslator, resetAccountTranslator } from '../../src/translate/account';
import { pickTranslator } from '../../src/translate';
import { DEFAULT_SETTINGS } from '../../src/store/settings';
import { cloud, signedIn } from './helpers';

const ANSWER = 'It was the depth of winter, and as I drew near my hometown the sky grew overcast.';

function fakeAi(answer = ANSWER, neurons = 4) {
  const asked: { model: string; input: Record<string, unknown> }[] = [];
  const AI: NonNullable<Env['AI']> = {
    run: async (model, input) => {
      asked.push({ model, input });
      return { choices: [{ message: { content: `\n\n${answer}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 700, completion_tokens: 12, neurons } };
    },
  };
  return { AI, asked };
}

const SENTENCE = { text: '时候既然是深冬；渐近故乡时，天气又阴晦了。', mode: 'translate' };

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); resetAccountTranslator(); });

describe('translation through the account', () => {
  it('translates a sentence for a device signed in, with the local model’s prompt and no thinking', async () => {
    const ai = fakeAi();
    const c = cloud({ AI: ai.AI });
    const token = await signedIn(c);
    const res = await c.post('/ai/translate', SENTENCE, token);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://henryyhong.com');
    expect(await res.json()).toEqual({ text: ANSWER });
    expect(ai.asked).toHaveLength(1);
    expect(ai.asked[0].model).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    const messages = ai.asked[0].input.messages as { role: string; content: string }[];
    expect(messages[0]).toMatchObject({ role: 'system', content: expect.stringContaining('Chinese-to-English literary translator') });
    expect(messages[1].content).toContain(`<text>\n${SENTENCE.text}\n</text>`);
    expect(messages[1].content.endsWith('/no_think')).toBe(true);
    // Signed out, empty, too long, or not a mode it knows: refused before the model is asked.
    expect((await c.post('/ai/translate', SENTENCE)).status).toBe(401);
    expect((await c.post('/ai/translate', { ...SENTENCE, text: ' ' }, token)).status).toBe(400);
    expect((await c.post('/ai/translate', { ...SENTENCE, text: '好'.repeat(ACCOUNT_TEXT + 1) }, token)).status).toBe(413);
    expect((await c.post('/ai/translate', { ...SENTENCE, mode: 'poem' }, token)).status).toBe(400);
    expect(ai.asked).toHaveLength(1);
  });

  it('gives each reader a share and everyone together a day that stays under the free allowance', async () => {
    // 40 neurons a sentence: a reader's 800 is 20 sentences, and everyone's 4,000 is 100.
    const ai = fakeAi(ANSWER, 40);
    const c = cloud({ AI: ai.AI, OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const ask = async (token: string, times: number) => {
      let ok = 0;
      for (let i = 0; i < times; i++) if ((await c.post('/ai/translate', SENTENCE, token)).status === 200) ok++;
      return ok;
    };
    const friends = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((f) => signedIn(c, `${f}@example.com`)));
    expect(await ask(friends[0], 30)).toBe(20);
    const over = await c.post('/ai/translate', SENTENCE, friends[0]);
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ code: 'daily_limit', error: expect.stringContaining('free translations are used up') });
    let all = 20;
    for (const f of friends.slice(1)) all += await ask(f, 30);
    expect(all).toBe(100);
    // The day is spent for the owner too: nothing past the free allowance, for anyone.
    expect(await ask(await signedIn(c, 'owner@example.com'), 5)).toBe(0);
    // What the model used is what counts: 100 sentences of 40 is the day's 4,000, plus no more than one sentence's head start each.
    expect(ai.asked.length).toBeLessThanOrEqual(100 + friends.length);
  });

  it('says so when translation is not set up or the model fails', async () => {
    const none = cloud();
    expect(await (await none.post('/ai/translate', SENTENCE, await signedIn(none))).json()).toMatchObject({ code: 'no_model' });
    const broken = cloud({ AI: { run: async () => { throw new Error('boom'); } } });
    const res = await broken.post('/ai/translate', SENTENCE, await signedIn(broken));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'model_failed' });
  });

  it('is what Automatic picks on a device signed in without Claude, and the app reads its answer', async () => {
    const ai = fakeAi();
    const c = cloud({ AI: ai.AI, OWNER_EMAILS: 'owner@example.com' } as Partial<Env>);
    const token = await signedIn(c, 'friend@example.com');
    // The app's requests go to the Worker in process.
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      const body = req.method === 'GET' ? undefined : await req.text();
      return c.call(url.pathname + url.search, { method: req.method, headers: Object.fromEntries(req.headers), body });
    });
    localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
    localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token, email: 'friend@example.com' }));
    const settings = { ...DEFAULT_SETTINGS, translator: 'auto' as const };
    const picked = await pickTranslator(settings, null);
    expect(picked.id).toBe('account');
    expect(await picked.translate({ text: SENTENCE.text, mode: 'translate' })).toBe(ANSWER);
    // Local only keeps sentences on the device: never sent, and Automatic passes it by.
    const local = createAccountTranslator({ localOnly: true });
    expect(await local.availability()).toBe('no');
    await expect(local.translate({ text: SENTENCE.text, mode: 'translate' })).rejects.toThrow(/Local only/);
    expect((await pickTranslator({ ...settings, localOnly: true }, null)).id).not.toBe('account');
    expect(ai.asked).toHaveLength(1);
  });

  it('asks again once when the first answer fails a check, and passes on what it could not confirm', async () => {
    // "Fine." is far too short for the sentence: the second answer is kept because it fixes that.
    const answers = ['Fine.', ANSWER];
    const AI: NonNullable<Env['AI']> = { run: async () => ({ choices: [{ message: { content: answers.shift() } }], usage: { neurons: 4 } }) };
    const c = cloud({ AI });
    const res = await c.post('/ai/translate', SENTENCE, await signedIn(c));
    expect(await res.json()).toEqual({ text: ANSWER });
    expect(answers).toHaveLength(0);
  });
});
