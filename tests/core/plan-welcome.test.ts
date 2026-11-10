// The welcome screen in the order a real visit runs (main.ts): needsWelcome() is asked, then the settings store writes its keys,
// then the welcome shows. A reload (or a second tab) in the middle must bring the welcome back, not take those keys for an old
// reader's; a device used before the welcome existed is still never interrupted.
import { describe, expect, it } from 'vitest';
import { PLAN_KEY, getPlan, needsWelcome, setPlan } from '../../src/core/plan';
import { createSettingsStore } from '../../src/store/settings';

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

describe('the welcome across a reload', () => {
  it('comes back after boot wrote its keys, until it is finished', () => {
    const s = memoryStorage();
    expect(needsWelcome(s)).toBe(true);
    // The unfinished plan is there at once.
    expect(s.getItem(PLAN_KEY)).not.toBeNull();
    expect(getPlan(s).welcomed).toBe(0);
    // What boot writes before the welcome shows: the Chinese settings markers, and the language a ?lang= link names.
    createSettingsStore(s, 'zh');
    s.setItem('dushu.lang.v1', 'ja');
    expect([...Array(s.length)].map((_, i) => s.key(i)).filter((k) => k !== PLAN_KEY).length).toBeGreaterThan(1);
    // The reload.
    expect(needsWelcome(s)).toBe(true);
    expect(needsWelcome(s)).toBe(true);
    // Languages picked so far are kept while it is unfinished.
    setPlan({ langs: ['es'] }, s);
    expect(needsWelcome(s)).toBe(true);
    expect(getPlan(s).langs).toEqual(['es']);
    setPlan({ welcomed: 1 }, s);
    expect(needsWelcome(s)).toBe(false);
  });

  it('never greets a device used before the welcome existed, and marks it welcomed', () => {
    const s = memoryStorage({ 'dushu.settings.v1': '{}', 'dushu.es.settings.v1': '{}' });
    expect(needsWelcome(s)).toBe(false);
    expect(getPlan(s).welcomed).toBeGreaterThan(0);
    expect(needsWelcome(s)).toBe(false);
  });

  it('leaves other apps’ keys out of it', () => {
    const s = memoryStorage({ 'other.app': '1' });
    expect(needsWelcome(s)).toBe(true);
  });

  it('greets nobody when storage cannot be read', () => {
    const broken = { ...memoryStorage(), getItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(needsWelcome(broken)).toBe(false);
  });
});
