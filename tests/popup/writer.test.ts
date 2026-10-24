import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStrokes, strokeDataPossible } from '../../src/ui/popup/writer';

afterEach(() => vi.unstubAllGlobals());

describe('stroke data', () => {
  it('skips what the data cannot hold', () => {
    expect(strokeDataPossible('字')).toBe(true);
    expect(strokeDataPossible('𠀀')).toBe(false); // above U+FFFF
    expect(strokeDataPossible('豈')).toBe(false); // compatibility ideograph
    expect(strokeDataPossible('㌀')).toBe(false);
  });

  it('remembers a 404 but retries after a network failure', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 404 }));
    vi.stubGlobal('fetch', f);
    await expect(loadStrokes('鑫')).rejects.toThrow();
    await new Promise(r => setTimeout(r, 0));
    await expect(loadStrokes('鑫')).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);

    const g = vi.fn(async () => { throw new TypeError('network'); });
    vi.stubGlobal('fetch', g);
    await expect(loadStrokes('森')).rejects.toThrow();
    await new Promise(r => setTimeout(r, 0));
    await expect(loadStrokes('森')).rejects.toThrow();
    expect(g).toHaveBeenCalledTimes(2);
  });
});
