// @vitest-environment jsdom
// The theme (main.ts applyTheme): a new theme cross-fades the page through the View Transitions API, with the class that gives
// it its own animation (base.css .app-theme-fade) on while it plays and off once it ends; a theme that looks the same as the one
// shown, or any change under reduced motion, is drawn at once. Changed here the way another tab changes it (the storage event).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootApp } from './bootApp';

vi.mock('../../src/core/dict', async (orig) => {
  const real = await orig<typeof import('../../src/core/dict')>();
  const { dataText } = await import('./bootApp');
  return { ...real, loadDictionary: () => real.loadDictionary('/', { fetchText: dataText }) };
});
vi.mock('../../src/core/sync', async (orig) => ({ ...(await orig<typeof import('../../src/core/sync')>()), startSync: () => undefined }));
vi.mock('../../src/fonts', () => ({}));
vi.mock('../../src/ui/library/library', () => ({ mount: () => () => {} }));

const root = document.documentElement;
/** Each view transition started: the theme and class when it was asked for, and what ends it. */
const fades: { theme?: string; cls: boolean; end: () => void }[] = [];
let reduce = false;

beforeAll(async () => {
  await bootApp();
  (document as unknown as { startViewTransition: unknown }).startViewTransition = (update: () => void) => {
    let end = () => {};
    const finished = new Promise<void>((r) => { end = r; });
    fades.push({ theme: root.dataset.theme, cls: root.classList.contains('app-theme-fade'), end });
    const done = Promise.resolve().then(update);
    return { ready: done, finished, updateCallbackDone: done, skipTransition() {} };
  };
  window.matchMedia = ((media: string) => ({
    matches: reduce && media.includes('prefers-reduced-motion: reduce'), media, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { reduce = false; fades.length = 0; });

/** Sets the theme in storage and tells the page, as another tab would. */
function pick(theme: string): void {
  const key = 'dushu.settings.v1';
  localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), theme }));
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('changing the theme', () => {
  it('cross-fades to a new theme, the class on while it plays', async () => {
    expect(root.dataset.theme).toBe('light');
    pick('dark');
    expect(fades).toHaveLength(1);
    // Asked for with the old theme still drawn and the class already on, so the old picture is taken with it.
    expect(fades[0]).toMatchObject({ theme: 'light', cls: true });
    await tick();
    expect(root.dataset.theme).toBe('dark');
    expect(root.classList.contains('app-theme-fade')).toBe(true);
    fades[0].end();
    await tick();
    expect(root.classList.contains('app-theme-fade')).toBe(false);
  });

  it('a second change before the first ends keeps the class until the second ends', async () => {
    pick('sepia');
    pick('light');
    expect(fades).toHaveLength(2);
    await tick();
    fades[0].end();
    await tick();
    expect(root.classList.contains('app-theme-fade')).toBe(true);
    fades[1].end();
    await tick();
    expect(root.classList.contains('app-theme-fade')).toBe(false);
    expect(root.dataset.theme).toBe('light');
  });

  it('a theme that looks the same (Auto while the system is light, after Light) changes nothing on screen', async () => {
    pick('system');
    expect(fades).toHaveLength(0);
    expect(root.dataset.theme).toBe('light');
  });

  it('under reduced motion the theme is drawn at once', () => {
    reduce = true;
    pick('dark');
    expect(fades).toHaveLength(0);
    expect(root.dataset.theme).toBe('dark');
    expect(root.classList.contains('app-theme-fade')).toBe(false);
  });
});
