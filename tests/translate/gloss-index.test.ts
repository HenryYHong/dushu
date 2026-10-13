import { afterEach, describe, expect, it, vi } from 'vitest';
import { glossText, createGlossTranslator, type GlossDeps } from '../../src/translate/gloss';
import { getTranslator, listTranslators, pickTranslator } from '../../src/translate';
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

const base = { translator: 'auto', claudeApiKey: '', claudeModel: '' } as Settings;
const g = globalThis as { Translator?: unknown };
afterEach(() => { delete g.Translator; vi.unstubAllGlobals(); });

describe('pickTranslator', () => {
  it('auto with nothing ready is gloss', async () => {
    expect((await pickTranslator(base, dict)).id).toBe('gloss');
  });
  it('auto prefers chrome when ready or downloadable', async () => {
    for (const a of ['available', 'downloadable']) {
      g.Translator = { availability: async () => a, create: async () => ({}) };
      expect((await pickTranslator({ ...base, claudeApiKey: 'k' }, dict)).id).toBe('chrome');
    }
  });
  it('auto skips unavailable chrome and uses claude when a key is set', async () => {
    g.Translator = { availability: async () => 'unavailable', create: async () => ({}) };
    expect((await pickTranslator({ ...base, claudeApiKey: 'k' }, dict)).id).toBe('claude');
  });
  it('prefers the ready browser model and uses the local model while the browser model needs a download', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' });
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ models: [{ name: 'vaultbox/qwen3.5-uncensored:4b' }] }) }));
    g.Translator = { availability: async () => 'available', create: async () => ({}) };
    expect((await pickTranslator(base, dict)).id).toBe('chrome');
    g.Translator = { availability: async () => 'downloadable', create: async () => ({}) };
    expect((await pickTranslator(base, dict)).id).toBe('local');
  });
  it('prefers the evaluated local 9B model over a ready browser model', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' });
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen3.5:9b-q4_K_M' }] }) }));
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
  it('listTranslators returns all five with availability', async () => {
    const list = await listTranslators({ ...base, claudeApiKey: 'k' }, dict);
    expect(list.map(x => x.translator.id)).toEqual(['local', 'chrome', 'claude', 'mymemory', 'gloss']);
    expect(Object.fromEntries(list.map(x => [x.translator.id, x.availability]))).toMatchObject({ chrome: 'no', claude: 'yes', gloss: 'yes' });
    expect(getTranslator('gloss', base, dict).id).toBe('gloss');
  });
});
