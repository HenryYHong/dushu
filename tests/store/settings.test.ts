import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, createSettingsStore, sanitizeSettings } from '../../src/store/settings';

function memStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null, removeItem: (k) => { m.delete(k); }, setItem: (k, v) => { m.set(k, String(v)); },
  };
}

describe('settings', () => {
  it('starts with defaults', () => {
    expect(createSettingsStore(memStorage()).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numbers', () => {
    const s = createSettingsStore(memStorage());
    s.set({ fontSize: 5, lineHeight: 9, pageWidth: 100, hskThreshold: 99, ttsRate: 10 });
    expect(s.get()).toMatchObject({ fontSize: 14, lineHeight: 3, pageWidth: 480, hskThreshold: 7, ttsRate: 2 });
    s.set({ fontSize: 100, lineHeight: 0, pageWidth: 5000, hskThreshold: -3 });
    expect(s.get()).toMatchObject({ fontSize: 44, lineHeight: 1.4, pageWidth: 1200, hskThreshold: 1 });
    s.set({ fontSize: 20.6 });
    expect(s.get().fontSize).toBe(21);
  });

  it('ignores invalid patch values and keeps the current one', () => {
    const s = createSettingsStore(memStorage());
    s.set({ theme: 'dark' });
    s.set({ theme: 'neon', fontSize: NaN, toneColors: 'yes', bogus: 1 } as never);
    expect(s.get().theme).toBe('dark');
    expect(s.get().fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(s.get().toneColors).toBe(true);
    expect('bogus' in s.get()).toBe(false);
  });

  it('migration: drops unknown keys, resets bad types, keeps good ones', () => {
    const st = memStorage({ [SETTINGS_KEY]: JSON.stringify({ theme: 'sepia', fontSize: '30', lineHeight: 99, old: 1, translator: 'gone', claudeModel: '  ', sandhi: false }) });
    const s = createSettingsStore(st).get();
    expect(s).toEqual({ ...DEFAULT_SETTINGS, theme: 'sepia', lineHeight: 3, sandhi: false });
  });

  it('survives corrupt JSON, arrays and null', () => {
    expect(createSettingsStore(memStorage({ [SETTINGS_KEY]: '{oops' })).get()).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('persists and reloads', () => {
    const st = memStorage();
    createSettingsStore(st).set({ fontSize: 30, pinyin: 'all' });
    expect(createSettingsStore(st).get()).toMatchObject({ fontSize: 30, pinyin: 'all' });
  });

  it('gives existing settings the larger Scroll default and remembers a later adjustment', () => {
    const st = memStorage({ [SETTINGS_KEY]: JSON.stringify({ layout: 'scroll', fontSize: 22 }) });
    const s = createSettingsStore(st);
    expect(s.get()).toMatchObject({ fontSize: 22, scrollFontSize: 28 });
    s.set({ scrollFontSize: 32 });
    expect(createSettingsStore(st).get()).toMatchObject({ fontSize: 22, scrollFontSize: 32 });
  });

  it('subscribe reports changed keys only, and unsubscribes', () => {
    const s = createSettingsStore(memStorage());
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.set({ theme: 'dark', fontSize: DEFAULT_SETTINGS.fontSize });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][1]).toEqual(['theme']);
    off();
    s.set({ theme: 'light' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a throwing subscriber does not break others or set()', () => {
    const s = createSettingsStore(memStorage());
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    s.subscribe(() => { throw new Error('x'); });
    s.subscribe(ok);
    s.set({ theme: 'dark' });
    expect(ok).toHaveBeenCalled();
    err.mockRestore();
  });

  it('works when storage throws or is missing', () => {
    const bad = { ...memStorage(), getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } } as Storage;
    const s = createSettingsStore(bad);
    s.set({ theme: 'dark' });
    expect(s.get().theme).toBe('dark');
    expect(createSettingsStore(undefined).get()).toEqual(DEFAULT_SETTINGS);
  });
});
