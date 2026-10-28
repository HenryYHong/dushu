// @vitest-environment jsdom
// A dictionary download that fails (offline, a dropped connection) is not kept: the toast says so in plain words and the
// next use downloads it again, so opening a book works without a reload.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookMeta } from '../../src/types';
import { installLayout } from '../reader/layoutFake';
import { bootApp, go, readerDrawn } from './bootApp';

const calls = vi.hoisted(() => ({ n: 0 }));

vi.mock('../../src/core/dict', async (orig) => {
  const real = await orig<typeof import('../../src/core/dict')>();
  const { dataText } = await import('./bootApp');
  return {
    ...real,
    loadDictionary: async () => {
      if (++calls.n === 1) throw new Error('Failed to fetch');
      return real.loadDictionary('/', { fetchText: dataText });
    },
  };
});
vi.mock('../../src/core/sync', async (orig) => ({ ...(await orig<typeof import('../../src/core/sync')>()), startSync: () => undefined }));
vi.mock('../../src/fonts', () => ({}));
vi.mock('../../src/ui/library/library', () => ({
  mount: (root: HTMLElement) => { root.appendChild(Object.assign(document.createElement('div'), { className: 'lib-page' })); return () => {}; },
}));

let meta: BookMeta;
beforeAll(async () => {
  installLayout();
  ({ meta } = await bootApp());
});

describe('dictionary download', () => {
  it('says plainly that it failed, and the next use tries again', async () => {
    await vi.waitFor(() => expect(document.querySelector('.app-toast-text')?.textContent)
      .toBe('Could not download the dictionary. Check your connection; Dushu will try again.'));
    await go(`#/read/${meta.id}`);
    await readerDrawn();
    expect(document.body.textContent).not.toContain('Dictionary not loaded');
    expect(calls.n).toBe(2);
    // Close the book, so the reader's timers (the place it saves) stop before the test environment goes away.
    await go('#/');
  });
});
