import { describe, expect, it, vi } from 'vitest';
import { chunkText } from '../../src/translate/chunk';
import { createMyMemoryTranslator, QUOTA_MESSAGE } from '../../src/translate/mymemory';

const reply = (text: string, extra: object = {}) =>
  new Response(JSON.stringify({ responseData: { translatedText: text }, responseStatus: 200, quotaFinished: false, ...extra }), { status: 200 });

describe('chunkText', () => {
  it('keeps short text whole', () => expect(chunkText('你好。')).toEqual(['你好。']));
  it('splits at sentence ends and respects the limit', () => {
    const s = '我们去公园玩。'.repeat(100); // 700 chars
    const chunks = chunkText(s, 500);
    expect(chunks.length).toBe(2);
    for (const c of chunks) { expect(c.length).toBeLessThanOrEqual(500); expect(c.endsWith('。')).toBe(true); }
    expect(chunks.join('')).toBe(s);
  });
  it('breaks a huge sentence at commas, then hard', () => {
    const withCommas = '甲乙丙丁，'.repeat(200);
    expect(chunkText(withCommas, 100).every(c => c.length <= 100)).toBe(true);
    const hard = '字'.repeat(1234);
    const chunks = chunkText(hard, 500);
    expect(chunks.map(c => c.length)).toEqual([500, 500, 234]);
  });
  it('never splits a surrogate pair', () => {
    const chunks = chunkText('𠀀'.repeat(7), 5);
    expect(chunks.join('')).toBe('𠀀'.repeat(7));
    for (const c of chunks) expect([...c].join('')).toBe(c);
  });
});

describe('mymemory', () => {
  it('sends a plain GET with langpair, no email', async () => {
    const fetchFn = vi.fn(async () => reply('Hello.'));
    const t = createMyMemoryTranslator({ fetch: fetchFn as unknown as typeof fetch });
    expect(await t.translate({ text: '你好', mode: 'translate' })).toBe('Hello.');
    const url = String((fetchFn.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('q=' + encodeURIComponent('你好'));
    expect(decodeURIComponent(url)).toContain('langpair=zh-CN|en');
    expect(url).not.toMatch(/[?&]de=|@/);
  });
  it('translates each chunk and joins them', async () => {
    const seen: string[] = [];
    const fetchFn = vi.fn(async (u: string) => { seen.push(new URL(u).searchParams.get('q')!); return reply('part' + seen.length); });
    const t = createMyMemoryTranslator({ fetch: fetchFn as unknown as typeof fetch });
    const deltas: string[] = [];
    const out = await t.translate({ text: '我们去公园玩。'.repeat(100), mode: 'translate' }, { onDelta: s => deltas.push(s) });
    expect(seen.length).toBe(2);
    expect(seen.every(q => q.length <= 500)).toBe(true);
    expect(out).toBe('part1 part2');
    expect(deltas).toEqual(['part1', 'part1 part2']);
  });
  it('decodes HTML entities', async () => {
    const t = createMyMemoryTranslator({ fetch: (async () => reply('It&#39;s &quot;fine&quot; &amp; good')) as unknown as typeof fetch });
    expect(await t.translate({ text: '好', mode: 'translate' })).toBe('It\'s "fine" & good');
  });
  it('reports quota exhaustion plainly (flag, warning text, and HTTP 429)', async () => {
    for (const r of [
      () => reply('x', { quotaFinished: true }),
      () => reply('MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. NEXT AVAILABLE IN 05 HOURS'),
      () => new Response('{}', { status: 429 }),
    ]) {
      const t = createMyMemoryTranslator({ fetch: (async () => r()) as unknown as typeof fetch });
      await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(QUOTA_MESSAGE);
    }
  });
  it('maps network failure and API errors to short messages', async () => {
    const down = createMyMemoryTranslator({ fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    await expect(down.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/Could not reach MyMemory/);
    const bad = createMyMemoryTranslator({ fetch: (async () => reply('', { responseStatus: 403, responseDetails: 'INVALID' })) as unknown as typeof fetch });
    await expect(bad.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/INVALID/);
  });
  it('lets aborts through as AbortError', async () => {
    const t = createMyMemoryTranslator({ fetch: (async () => { throw new DOMException('x', 'AbortError'); }) as unknown as typeof fetch });
    await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
