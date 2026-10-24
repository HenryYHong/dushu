// @vitest-environment jsdom
// The router in main.ts tears the old screen down before the new route's styles apply (the reader saves its place while
// the app nav is still hidden), and a screen that finishes mounting after the route moved on is put away at once.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookMeta, Progress, Store } from '../../src/types';
import { installLayout, scrollToLine, topLine } from '../reader/layoutFake';
import { bootApp, go, readerDrawn } from './bootApp';

const spy = vi.hoisted(() => ({
  vocabMounted: false,
  releaseVocab: null as null | (() => void),
  vocabCleanup: { calls: 0 },
  aboutCleanup: { calls: 0, routes: [] as (string | undefined)[] },
}));

vi.mock('../../src/core/dict', async (orig) => {
  const real = await orig<typeof import('../../src/core/dict')>();
  const { dataText } = await import('./bootApp');
  return { ...real, loadDictionary: () => real.loadDictionary('/', { fetchText: dataText }) };
});
vi.mock('../../src/core/sync', async (orig) => ({ ...(await orig<typeof import('../../src/core/sync')>()), startSync: () => undefined }));
vi.mock('../../src/fonts', () => ({}));
vi.mock('../../src/ui/library/library', () => ({
  mount: (root: HTMLElement) => { root.appendChild(Object.assign(document.createElement('div'), { className: 'lib-page' })); return () => {}; },
}));
vi.mock('../../src/ui/vocab/vocab', () => ({
  mount: async () => {
    spy.vocabMounted = true;
    await new Promise<void>((r) => { spy.releaseVocab = r; });
    return () => { spy.vocabCleanup.calls++; };
  },
}));
vi.mock('../../src/ui/about/about', () => ({
  mount: (root: HTMLElement) => {
    root.appendChild(Object.assign(document.createElement('div'), { className: 'about-page' }));
    return () => { spy.aboutCleanup.calls++; spy.aboutCleanup.routes.push(document.body.dataset.route); };
  },
}));

let store: Store;
let meta: BookMeta;
beforeAll(async () => {
  installLayout();
  ({ store, meta } = await bootApp());
});

const place = (p: Progress | undefined) => p && { chapter: p.chapter, block: p.block, offset: p.offset ?? 0 };
const libraryShown = () => vi.waitFor(() => expect(document.querySelector('.lib-page')).not.toBeNull());

describe('route teardown', () => {
  it('leaving the reader in Scroll and coming back, again and again, keeps the same line', async () => {
    await go(`#/read/${meta.id}`);
    await readerDrawn();
    scrollToLine(13, 50);
    await new Promise((r) => setTimeout(r, 700));
    const first = place(await store.progress.get(meta.id));
    expect(first).toEqual({ chapter: 0, block: 12, offset: 50 });
    for (let trip = 1; trip <= 3; trip++) {
      await go('#/');
      await libraryShown();
      expect(place(await store.progress.get(meta.id))).toEqual(first);
      await go(`#/read/${meta.id}`);
      await readerDrawn();
      await new Promise((r) => setTimeout(r, 900));
      expect(topLine()).toEqual({ b: 13, o: 50 });
      expect(place(await store.progress.get(meta.id))).toEqual(first);
    }
  });

  it('runs a screen\'s cleanup under its own route', async () => {
    await go('#/about');
    await vi.waitFor(() => expect(document.querySelector('.about-page')).not.toBeNull());
    await go('#/');
    await libraryShown();
    expect(spy.aboutCleanup.routes).toEqual(['about']);
  });

  it('a screen that finishes mounting after the route moved on is put away, and the current one keeps its cleanup', async () => {
    spy.aboutCleanup.calls = 0;
    await go('#/vocab');
    await vi.waitFor(() => expect(spy.vocabMounted).toBe(true));
    await go('#/about');
    await vi.waitFor(() => expect(document.querySelector('.about-page')).not.toBeNull());
    spy.releaseVocab!();
    await new Promise((r) => setTimeout(r, 5));
    expect(spy.vocabCleanup.calls).toBe(1);
    expect(spy.aboutCleanup.calls).toBe(0);
    await go('#/');
    await libraryShown();
    expect(spy.aboutCleanup.calls).toBe(1);
    expect(spy.vocabCleanup.calls).toBe(1);
  });
});
