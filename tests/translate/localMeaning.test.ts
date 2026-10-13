import { afterEach, describe, expect, it, vi } from 'vitest';
import { contextWindow, createLocalTranslator, suggestMeaning, translationIssue } from '../../src/translate/localMeaning';

afterEach(() => vi.unstubAllGlobals());

const tags = { models: [{ name: 'vaultbox/qwen3.5-uncensored:4b' }] };
const json = (value: unknown) => ({ ok: true, json: async () => value });

describe('local translation', () => {
  it('honors cancellation before a corrective retry and never exposes the rejected candidate', async () => {
    const ctl = new AbortController(); const seen: string[] = [];
    const generate = vi.fn(async () => { ctl.abort(); return json({ response: 'He entered the hotel.' }); });
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/api/tags') ? json(tags) : generate());
    await expect(createLocalTranslator().translate({ text: '他在酒店买了一碗温酒。', mode: 'translate' },
      { signal: ctl.signal, onDelta: text => seen.push(text) })).rejects.toMatchObject({ name: 'AbortError' });
    expect(generate).toHaveBeenCalledOnce();
    expect(seen).toEqual([]);
  });
  it('corrects a lodging passage without leaking the older wine-shop hint into it', async () => {
    const requests: Record<string, any>[] = []; const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) return json(tags);
      requests.push(JSON.parse(init!.body as string));
      return json({ response: requests.length === 1 ? 'He booked a room at the wine shop.' : 'He booked a room at the hotel for three nights.' });
    });
    expect(await createLocalTranslator().translate({ text: '他在酒店订了一间客房，打算住三晚。', mode: 'translate' }, { onDelta: text => seen.push(text) })).toContain('hotel');
    expect(JSON.parse(requests[0].prompt).lexicalHints.酒店).toContain('hotel/accommodation');
    expect(seen).toEqual(['He booked a room at the hotel for three nights.']);
    expect(requests).toHaveLength(2);
    expect(requests.every(request => request.system.length <= 4000)).toBe(true);
  });
  it('corrects a wine-shop contradiction once and never streams the invalid candidate', async () => {
    const requests: string[] = []; const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) return json(tags);
      requests.push(JSON.parse(init!.body as string).system);
      return json({ response: requests.length === 1 ? 'He entered the hotel.' : 'He entered the wine shop.' });
    }));
    expect(await createLocalTranslator().translate({ text: '他在酒店买了一碗温酒。', mode: 'translate' }, { onDelta: text => seen.push(text) })).toBe('He entered the wine shop.');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toContain('Correction required');
    expect(seen).toEqual(['He entered the wine shop.']);
  });
  it('withholds repeated contradictions without an unbounded retry loop', async () => {
    const generate = vi.fn(async () => json({ response: 'He entered the hotel.' }));
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/api/tags') ? json(tags) : generate());
    await expect(createLocalTranslator().translate({ text: '他在酒店买了一碗温酒。', mode: 'translate' })).rejects.toThrow('withheld');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('limits checks to grounded wine-shop context and dictionary-term pronunciation', () => {
    expect(translationIssue('He booked a hotel room.', false)).toBeNull();
    expect(translationIssue('He held a jie2 gu3.', false, [{ word: '羯鼓', pinyin: 'jie2 gu3', gloss: 'drum', kind: 'term' }])).not.toBeNull();
    expect(translationIssue('Guo Jing spoke.', false, [{ word: '郭靖', pinyin: 'guo1 jing4', gloss: 'name', kind: 'name' }])).toBeNull();
  });
  it('permits pronunciation and sense-comparison notes in Explain', async () => {
    const generate = vi.fn(async () => json({ response: '酒店 is a wine shop here, not a hotel. 羯鼓 is pronounced jie2 gu3.' }));
    vi.stubGlobal('fetch', async (url: string) => url.endsWith('/api/tags') ? json(tags) : generate());
    expect(await createLocalTranslator().translate({ text: '他在酒店买了一碗温酒，听着羯鼓。', mode: 'explain',
      terms: [{ word: '羯鼓', pinyin: 'jie2 gu3', gloss: 'drum', kind: 'term' }] })).toContain('not a hotel');
    expect(generate).toHaveBeenCalledOnce();
  });
  it('is offered only from the local app and uses the installed model', async () => {
    const fetcher = vi.fn(async (url: string) => url.endsWith('/api/tags') ? json(tags) : json({ response: 'He went home.' }));
    vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('location', { hostname: 'localhost' });
    const translator = createLocalTranslator();
    expect(await translator.availability()).toBe('yes');
    expect(await translator.translate({ text: '他回家了。', mode: 'translate' })).toBe('He went home.');
    const call = fetcher.mock.calls.find(([url]) => url.endsWith('/api/generate'))!;
    expect(JSON.parse((call as unknown as [string, { body: string }])[1].body).model).toBe('vaultbox/qwen3.5-uncensored:4b');
    vi.stubGlobal('location', { hostname: 'example.com' });
    expect(await translator.availability()).toBe('no');
    vi.stubGlobal('location', { hostname: 'my-mac.private.ts.net', protocol: 'https:' });
    expect(await translator.availability()).toBe('yes');
    expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/local-model/'))).toBe(true);
    vi.stubGlobal('location', { hostname: 'my-mac.private.ts.net', protocol: 'http:' });
    expect(await translator.availability()).toBe('no');
  });

  it('validates a contextual suggestion instead of treating malformed output as a definition', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/api/tags') ? json(tags)
      : json({ response: '{"meaning":"wine shop","evidence":"买一碗酒","reason":"They buy bowls of wine.","confidence":"high"}' })));
    expect(await suggestMeaning('酒店', '这里有酒店。', '他们买一碗酒。', ['hotel', 'wine shop']))
      .toEqual({ meaning: 'wine shop', evidence: '买一碗酒', reason: 'They buy bowls of wine.', confidence: 'high' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/api/tags') ? json(tags) : json({ response: 'not JSON' })));
    await expect(suggestMeaning('酒店', '这里有酒店。', '他们买一碗酒。', ['hotel'])).rejects.toThrow('unreadable');
  });

  it('rejects invented senses and evidence that does not occur in the supplied paragraph', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/api/tags') ? json(tags)
      : json({ response: '{"meaning":"hotel","evidence":"客房","reason":"There are rooms.","confidence":"high"}' })));
    await expect(suggestMeaning('酒店', '这里有酒店。', '他们买一碗酒。', ['hotel', 'wine shop'])).rejects.toThrow('could not be confirmed');
  });

  it('streams a response even when a JSON line is split across network chunks', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) return json(tags);
      return new Response(new ReadableStream({
        start(controller) {
          for (const chunk of ['{"response":"He ",', '"done":false}\n{"response":"went home.","done":false}\n', '{"done":true}\n']) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }));
    }));
    const seen: string[] = [];
    expect(await createLocalTranslator().translate({ text: '他回家了。', mode: 'translate' }, { onDelta: text => seen.push(text) })).toBe('He went home.');
    expect(seen).toEqual(['He ', 'He went home.']);
  });

  it('translates every chunk of a long selection rather than silently losing its tail', async () => {
    const source = '他走到河边，看着流水。'.repeat(180) + '最后，他回家了。';
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) return json(tags);
      const body = JSON.parse(init!.body as string);
      sent.push(JSON.parse(body.prompt).text);
      return json({ response: `Part ${sent.length}` });
    }));
    const answer = await createLocalTranslator().translate({ text: source, mode: 'translate' });
    expect(sent.join('')).toBe(source);
    expect(sent.every(s => s.length <= 600)).toBe(true);
    expect(answer).toBe(sent.map((_, i) => `Part ${i + 1}`).join('\n\n'));
  });

  it('keeps context around the selected sentence late in a long paragraph', () => {
    const source = '开头。'.repeat(500) + '他把钱还给了我。' + '结尾。'.repeat(500);
    const result = contextWindow(source, '他把钱还给了我。');
    expect(result).toContain('他把钱还给了我。');
    expect(result.length).toBeLessThanOrEqual(1400);
  });
  it('passes name readings and narrowly supported older meanings as reference data', async () => {
    let request: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) return json(tags);
      request = JSON.parse(JSON.parse(init!.body as string).prompt);
      return json({ response: 'Guo Jing bought warm wine at the tavern.' });
    }));
    await createLocalTranslator().translate({ text: '郭靖在酒店买了一碗温酒。', mode: 'translate',
      terms: [{ word: '郭靖', pinyin: 'guo1 jing4', gloss: 'name (person)' }] });
    expect(request.glossary).toEqual([{ word: '郭靖', pinyin: 'guo1 jing4', gloss: 'name (person)' }]);
    expect(request.lexicalHints).toEqual({ 酒店: expect.stringContaining('tavern') });
  });

  it.each([
    '{"response":"unfinished","done":true,"done_reason":"length"}\n',
    '{"response":"unfinished","done":false}\n',
  ])('rejects a truncated or prematurely closed stream', async stream => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/api/tags') ? json(tags) : new Response(stream)));
    await expect(createLocalTranslator().translate({ text: '他回家了。', mode: 'translate' })).rejects.toThrow(/finish|completion/);
  });

  it('refuses a low-confidence sense even if its dictionary sense and quote are valid', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/api/tags') ? json(tags)
      : json({ response: '{"meaning":"hotel","evidence":"这里","reason":"Not clear.","confidence":"low"}' })));
    await expect(suggestMeaning('酒店', '这里有酒店。', '这里有酒店。', ['hotel', 'wine shop'])).rejects.toThrow('uncertain');
  });
});
