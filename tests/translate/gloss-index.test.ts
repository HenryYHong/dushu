import { afterEach, describe, expect, it, vi } from 'vitest';
import { glossText, createGlossTranslator, type GlossDeps } from '../../src/translate/gloss';
import { getTranslator, listTranslators, pickTranslator } from '../../src/translate';
import { resetClaudeStatus } from '../../src/translate/claude';
import type { Dictionary, Settings, Token } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';

const entries: Record<string, { pinyin: string; defs: string[] }> = {
  我: { pinyin: 'wo3', defs: ['I', 'me'] },
  喜欢: { pinyin: 'xi3 huan5', defs: ['to like (doing)', 'to be fond of'] },
  书: { pinyin: 'shu1', defs: ['CL:本[ben3]', 'book'] },
};
const dict = {
  lookup: (w: string) => (entries[w] ? [{ trad: w, simp: w, ...entries[w] }] : []),
  char: (c: string) => (c === '𠀀' ? { char: c, readings: ['kǔn'], definition: 'rare char' } : null),
} as unknown as Dictionary;

// Fake segmenter: longest dictionary match, else one token per code point.
const fakeSegment = (text: string): Token[] => {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const w = ['喜欢', '我', '书'].find(x => text.startsWith(x, i));
    const cp = String.fromCodePoint(text.codePointAt(i)!);
    const s = w ?? cp;
    const han = /[一-鿿\u{20000}-\u{2ffff}\u{20000}\u{10000}-\u{1ffff}]/u.test(s) || s === '𠀀';
    out.push({ text: s, start: i, end: i + s.length, kind: han ? 'han' : 'punct', inDict: !!w });
    i += s.length;
  }
  return out;
};
const deps: GlossDeps = { segment: fakeSegment, format: n => n.toUpperCase() };

describe('gloss', () => {
  it('does not let capitalized names displace ordinary glosses in a water passage', async () => {
    const real = await loadTestDictionary();
    const text = glossText('红掌拨清波。', real);
    expect(text).toContain('red');
    expect(text).toContain('clear');
    expect(text).toContain('wave');
    expect(text).not.toContain('surname Hong');
    expect(text).not.toContain('Poland');
  });
  it('formats word (pinyin): gloss joined by dots, skipping classifier notes', () => {
    expect(glossText('我喜欢书。', dict, deps)).toBe('我 (WO3): I · 喜欢 (XI3 HUAN5): to like · 书 (SHU1): book');
  });
  it('falls back to per-character info and dedupes', () => {
    expect(glossText('我𠀀我', dict, deps)).toBe('我 (WO3): I · 𠀀 (kǔn): rare char');
  });
  it('translator reports availability and streams once', async () => {
    const t = createGlossTranslator(dict, deps);
    expect(await t.availability()).toBe('yes');
    const seen: string[] = [];
    await t.translate({ text: '我', mode: 'translate' }, { onDelta: s => seen.push(s) });
    expect(seen).toEqual(['我 (WO3): I']);
    expect(await createGlossTranslator(null, deps).availability()).toBe('no');
    await expect(createGlossTranslator(null, deps).translate({ text: '我', mode: 'translate' })).rejects.toThrow(/loading/);
    await expect(t.translate({ text: 'abc', mode: 'translate' })).rejects.toThrow(/no Chinese/);
  });
});

const base = { translator: 'auto', claudeModel: 'claude-sonnet-5-5', localOnly: false } as Settings;
const g = globalThis as { Translator?: unknown };
type Mac = { claude?: object | 'down' | 'denied'; models?: string[] };
/** A Mac on the page's own origin: Claude status and the local model's tag list, and a log of every path asked. */
function mac({ claude = 'down', models = [] }: Mac = {}) {
  const asked: string[] = [];
  vi.stubGlobal('location', { hostname: 'localhost', protocol: 'http:', origin: 'http://localhost:5240' });
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    if (url === '/api/claude/status') {
      if (claude === 'down') throw new TypeError('Failed to fetch');
      if (claude === 'denied') return new Response(null, { status: 403 });
      return new Response(JSON.stringify(claude), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url === '/api/local-model/api/tags') return { ok: true, json: async () => ({ models: models.map(name => ({ name })) }) };
    throw new Error(`unexpected request ${url}`);
  });
  return asked;
}
const claudeReady = { configured: true, limitReached: false };
afterEach(() => { delete g.Translator; vi.unstubAllGlobals(); resetClaudeStatus(); });

describe('pickTranslator', () => {
  it('auto with nothing ready is gloss', async () => {
    expect((await pickTranslator(base, dict)).id).toBe('gloss');
  });
  it('auto prefers chrome when ready or downloadable', async () => {
    for (const a of ['available', 'downloadable']) {
      g.Translator = { availability: async () => a, create: async () => ({}) };
      expect((await pickTranslator(base, dict)).id).toBe('chrome');
    }
  });
  it('auto skips unavailable chrome and ends at the gloss', async () => {
    g.Translator = { availability: async () => 'unavailable', create: async () => ({}) };
    expect((await pickTranslator(base, dict)).id).toBe('gloss');
  });
  it('prefers the ready browser model and uses the local model while the browser model needs a download', async () => {
    mac({ models: ['vaultbox/qwen3.5-uncensored:4b'] });
    g.Translator = { availability: async () => 'available', create: async () => ({}) };
    expect((await pickTranslator(base, dict)).id).toBe('chrome');
    g.Translator = { availability: async () => 'downloadable', create: async () => ({}) };
    expect((await pickTranslator(base, dict)).id).toBe('local');
  });
  it('prefers the evaluated local 9B model over a ready browser model', async () => {
    mac({ models: ['qwen3.5:9b-q4_K_M'] });
    g.Translator = { availability: async () => 'available', create: async () => ({}) };
    expect((await pickTranslator(base, dict)).id).toBe('local');
  });
  it('auto never picks mymemory', async () => {
    expect((await pickTranslator(base, null)).id).toBe('gloss');
  });
  it('an explicit choice is honored even if unavailable', async () => {
    expect((await pickTranslator({ ...base, translator: 'mymemory' }, dict)).id).toBe('mymemory');
    expect((await pickTranslator({ ...base, translator: 'claude' }, dict)).id).toBe('claude');
  });
  it('listTranslators returns all six with availability', async () => {
    const list = await listTranslators(base, dict);
    expect(list.map(x => x.translator.id)).toEqual(['local', 'chrome', 'claude', 'account', 'mymemory', 'gloss']);
    expect(Object.fromEntries(list.map(x => [x.translator.id, x.availability]))).toMatchObject({ chrome: 'no', claude: 'no', account: 'no', gloss: 'yes' });
    expect(getTranslator('gloss', base, dict).id).toBe('gloss');
  });
});

describe('automatic order: Claude through the Mac, local Qwen, Chrome, gloss', () => {
  const chromeReady = () => { g.Translator = { availability: async () => 'available', create: async () => ({}) }; };

  it('picks Claude first when the Mac has a key, even over the 9B model and a ready Chrome', async () => {
    mac({ claude: claudeReady, models: ['qwen3.5:9b-q4_K_M'] });
    chromeReady();
    expect((await pickTranslator(base, dict)).id).toBe('claude');
  });
  it('then the local 9B model, then Chrome, then the dictionary', async () => {
    chromeReady();
    mac({ claude: { configured: false }, models: ['qwen3.5:9b-q4_K_M'] });
    expect((await pickTranslator(base, dict)).id).toBe('local');
    mac({ claude: { configured: false }, models: [] });
    expect((await pickTranslator(base, dict)).id).toBe('chrome');
    delete g.Translator;
    resetClaudeStatus();
    mac({ claude: { configured: false }, models: [] });
    expect((await pickTranslator(base, dict)).id).toBe('gloss');
  });
  it('falls through when the Mac is off, refuses this device, or today\'s limit is used', async () => {
    chromeReady();
    for (const claude of ['down', 'denied', { ...claudeReady, limitReached: true }] as const) {
      resetClaudeStatus();
      mac({ claude, models: ['qwen3.5:9b-q4_K_M'] });
      expect((await pickTranslator(base, dict)).id).toBe('local');
    }
  });
  it('Local only never asks Claude and never picks it', async () => {
    const asked = mac({ claude: claudeReady, models: ['qwen3.5:9b-q4_K_M'] });
    chromeReady();
    expect((await pickTranslator({ ...base, localOnly: true }, dict)).id).toBe('local');
    const asked2 = mac({ claude: claudeReady, models: [] });
    expect((await pickTranslator({ ...base, localOnly: true }, dict)).id).toBe('chrome');
    expect(asked).not.toContain('/api/claude/status');
    expect(asked2).not.toContain('/api/claude/status');
  });
  it('Local only turns Claude and MyMemory off in the list, and refuses to run them when chosen', async () => {
    const asked = mac({ claude: claudeReady, models: [] });
    const settings = { ...base, localOnly: true };
    const list = await listTranslators(settings, dict);
    expect(Object.fromEntries(list.map(x => [x.translator.id, x.availability]))).toMatchObject({ claude: 'no', mymemory: 'no', gloss: 'yes' });
    for (const id of ['claude', 'mymemory'] as const) {
      const picked = await pickTranslator({ ...settings, translator: id }, dict);
      expect(picked.id).toBe(id);
      await expect(picked.translate({ text: '你好', mode: 'translate' })).rejects.toThrow(/Local only is on/);
    }
    expect(asked.filter(u => u.includes('translate'))).toEqual([]);
    const notLocal = await listTranslators(base, dict);
    expect(notLocal.find(x => x.translator.id === 'mymemory')?.availability).toBe('yes');
  });
  it('after a failure that will repeat, the next automatic pick moves on to the local model', async () => {
    mac({ claude: claudeReady, models: ['qwen3.5:9b-q4_K_M'] });
    const first = await pickTranslator(base, dict);
    expect(first.id).toBe('claude');
    const fetchSoFar = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => url === '/api/claude/translate'
      ? new Response(JSON.stringify({ code: 'daily_limit', error: 'Used up.' }), { status: 429 }) : fetchSoFar(url, init));
    await expect(first.translate({ text: '你好', mode: 'translate' })).rejects.toThrow('Used up.');
    expect((await pickTranslator(base, dict)).id).toBe('local');
  });
});
