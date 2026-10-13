import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalTranslator } from '../../src/translate/localMeaning';
import type { TranslateOptions, TranslationNote } from '../../src/translate/prompt';

// The tests run as if on the Mac's own origin, where the bridge is the page itself.
beforeEach(() => vi.stubGlobal('location', new URL('http://localhost:4317/')));
// The tests run as if on the Mac's own origin, where the bridge is the page itself.
beforeEach(() => vi.stubGlobal('location', new URL('http://localhost:4317/')));
afterEach(() => vi.unstubAllGlobals());

const tags = { models: [{ name: 'qwen3.5:9b-q4_K_M' }] };
const json = (value: unknown) => ({ ok: true, json: async () => value });
const terms = [{ word: '平兒', pinyin: 'ping2 er2', gloss: 'name (person)', kind: 'name' as const }];
const text = '平兒笑道：「我不去。」';

// The bridge-facing Translator type does not name onNote; the local translator reads it from the same options object.
const options = (value: TranslateOptions): { signal?: AbortSignal; onDelta?: (soFar: string) => void } => value;

function model(answers: string[]) {
  const requests: Record<string, any>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/tags')) return json(tags);
    requests.push(JSON.parse(init!.body as string));
    return json({ response: answers[Math.min(requests.length, answers.length) - 1] });
  }));
  return requests;
}

describe('local translator checks', () => {
  it('sends the tuned prompt inside the bridge limits, and the glossary spelling of a name', async () => {
    const requests = model([`Ping'er said with a smile, "I am not going."`]);
    await createLocalTranslator().translate({ text, terms, mode: 'translate' });
    expect(requests).toHaveLength(1);
    expect(requests[0].system.length).toBeLessThan(4000);
    expect(requests[0].prompt.length).toBeLessThan(10000);
    expect(requests[0].prompt).toContain("平兒 (name): write Ping'er");
    expect(requests[0].think).toBe(false);
    expect(requests[0].options).toEqual({ temperature: 0, num_ctx: 4096, num_predict: 1400 });
  });

  it('asks once for a correction of a mechanical problem and delivers the corrected answer without a note', async () => {
    const good = `Ping'er said with a smile, "I am not going."`;
    const requests = model([`Here is the translation: ${good}`, good]);
    const notes: TranslationNote[] = [];
    const seen: string[] = [];
    const answer = await createLocalTranslator().translate({ text, terms, mode: 'translate' }, options({ onDelta: (s: string) => seen.push(s), onNote: (n: TranslationNote) => notes.push(n) }));
    expect(answer).toBe(good);
    expect(requests).toHaveLength(2);
    expect(requests[1].system).toContain('Correction required');
    expect(notes).toEqual([]);
    expect(seen.at(-1)).toBe(answer);
  });

  it('labels a missing name unverified instead of asking a small model to fix it', async () => {
    const requests = model(['Patience said with a smile, "I am not going."']);
    const notes: TranslationNote[] = [];
    const answer = await createLocalTranslator().translate({ text, terms, mode: 'translate' }, options({ onNote: (n: TranslationNote) => notes.push(n) }));
    expect(requests).toHaveLength(1);
    expect(answer).toContain('Patience');
    expect(notes).toEqual([{ kind: 'unverified', detail: 'a name from the book may be missing or misspelled' }]);
  });

  it('never retries or labels an Explain answer', async () => {
    const requests = model(['Patience smiled.\n\n- 平兒 is a name.']);
    const notes: TranslationNote[] = [];
    await createLocalTranslator().translate({ text, terms, mode: 'explain' }, options({ onNote: (n: TranslationNote) => notes.push(n) }));
    expect(requests).toHaveLength(1);
    expect(notes).toEqual([]);
  });
});
