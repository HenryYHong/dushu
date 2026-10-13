import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChromeTranslator, resetChromeTranslator, sourceFor } from '../../src/translate/chrome';

const g = globalThis as { Translator?: unknown };
afterEach(() => { resetChromeTranslator(); delete g.Translator; });

function install(avail: string, opts: { createError?: string; stream?: string[] } = {}) {
  const inst = {
    translate: vi.fn(async (t: string) => 'EN:' + t),
    translateStreaming: opts.stream ? vi.fn(() => new ReadableStream<string>({
      start(c) { opts.stream!.forEach(s => c.enqueue(s)); c.close(); },
    })) : undefined,
  };
  const create = vi.fn(async (o: { monitor?: (m: EventTarget) => void }) => {
    if (opts.createError) throw Object.assign(new Error('x'), { name: opts.createError });
    const m = new EventTarget();
    o.monitor?.(m);
    m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 0.5 }));
    return inst;
  });
  g.Translator = { availability: vi.fn(async () => avail), create };
  return { inst, create };
}

describe('chrome translator', () => {
  it('is unavailable without the API (never throws)', async () => {
    expect(await createChromeTranslator().availability()).toBe('no');
    await expect(createChromeTranslator().translate({ text: '好', mode: 'translate' })).rejects.toThrow();
  });
  it.each([
    ['available', 'yes'], ['readily', 'yes'], ['downloadable', 'download'], ['downloading', 'download'],
    ['after-download', 'download'], ['unavailable', 'no'], ['no', 'no'],
  ])('maps %s to %s', async (a, want) => {
    install(a);
    expect(await createChromeTranslator().availability()).toBe(want);
  });
  it('translates and caches one instance', async () => {
    const { create, inst } = install('available');
    const t = createChromeTranslator();
    expect(await t.translate({ text: '你好', mode: 'translate' })).toBe('EN:你好');
    await t.translate({ text: '再见', mode: 'translate' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(inst.translate).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toMatchObject({ sourceLanguage: 'zh', targetLanguage: 'en' });
  });
  it('streams accumulated text when onDelta is given', async () => {
    install('available', { stream: ['Hel', 'lo'] });
    const seen: string[] = [];
    const out = await createChromeTranslator().translate({ text: '你好', mode: 'translate' }, { onDelta: s => seen.push(s) });
    expect(out).toBe('Hello');
    expect(seen).toContain('Hello');
  });
  it('prepare() downloads with progress from a click', async () => {
    const { create } = install('downloadable');
    const progress: number[] = [];
    await createChromeTranslator().prepare(f => progress.push(f));
    expect(create).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([0.5]);
  });
  it('explains a missing user gesture and lets the next click retry', async () => {
    const { create } = install('downloadable', { createError: 'NotAllowedError' });
    const t = createChromeTranslator();
    await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/needs a click/);
    await expect(t.translate({ text: '好', mode: 'translate' })).rejects.toThrow(/needs a click/);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('refuses when unavailable', async () => {
    install('unavailable');
    await expect(createChromeTranslator().translate({ text: '好', mode: 'translate' })).rejects.toThrow(/not available/);
  });
  it('detects the script of the text', () => {
    expect(sourceFor('他們說這個國家的人都來了')).toBe('zh-Hant');
    expect(sourceFor('他们说这个国家的人都来了')).toBe('zh');
    expect(sourceFor('你好')).toBe('zh');
  });
  it('uses zh-Hant for traditional text when that model is ready, else zh', async () => {
    const { create } = install('available');
    const t = createChromeTranslator();
    await t.translate({ text: '他們說這個國家的人都來了', mode: 'translate' });
    expect(create.mock.calls[0][0]).toMatchObject({ sourceLanguage: 'zh-Hant', targetLanguage: 'en' });
    resetChromeTranslator();
    const g2 = globalThis as { Translator?: { availability: (o: { sourceLanguage: string }) => Promise<string>; create: typeof create } };
    g2.Translator!.availability = async (o) => (o.sourceLanguage === 'zh-Hant' ? 'downloadable' : 'available');
    await createChromeTranslator().translate({ text: '他們說這個國家的人都來了', mode: 'translate' });
    expect(create.mock.calls[1][0]).toMatchObject({ sourceLanguage: 'zh' });
  });
});
