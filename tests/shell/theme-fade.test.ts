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
let reduce = false;

beforeAll(async () => {
  await bootApp();
  window.matchMedia = ((media: string) => ({
    matches: reduce && media.includes('prefers-reduced-motion: reduce'), media, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { reduce = false; vi.useRealTimers(); });

/** Sets the theme in storage and tells the page, as another tab would. */
function pick(theme: string): void {
  const key = 'dushu.settings.v1';
  localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), theme }));
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
}

describe('changing the theme', () => {
  it('eases the colors to a new theme: drawn at once, the class on for the length of the ease', () => {
    vi.useFakeTimers();
    expect(root.dataset.theme).toBe('light');
    pick('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.classList.contains('app-theme-fade')).toBe(true);
    vi.advanceTimersByTime(300);
    expect(root.classList.contains('app-theme-fade')).toBe(false);
  });

  it('a second change before the first ends keeps the class until the second ends', () => {
    vi.useFakeTimers();
    pick('sepia');
    vi.advanceTimersByTime(200);
    pick('light');
    vi.advanceTimersByTime(150);
    expect(root.classList.contains('app-theme-fade')).toBe(true);
    vi.advanceTimersByTime(150);
    expect(root.classList.contains('app-theme-fade')).toBe(false);
    expect(root.dataset.theme).toBe('light');
  });

  it('a theme that looks the same (Auto while the system is light, after Light) changes nothing on screen', () => {
    pick('system');
    expect(root.classList.contains('app-theme-fade')).toBe(false);
    expect(root.dataset.theme).toBe('light');
  });

  it('under reduced motion the theme is drawn at once', () => {
    reduce = true;
    pick('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.classList.contains('app-theme-fade')).toBe(false);
  });
});
