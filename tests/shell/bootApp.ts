// Boots the real app shell (src/main.ts) in jsdom: a page with #app, settings for the Scroll layout, and one book in the
// database the app opens. The test file mocks the dictionary loader (with `dataText`) and the sync before importing main.
import 'fake-indexeddb/auto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { vi } from 'vitest';
import type { BookMeta, Chapter, Store } from '../../src/types';
import { openStore } from '../../src/store';

/** Reads public/data the way the browser would fetch it (this module must not import src/core/dict, which the tests mock). */
export async function dataText(name: string): Promise<string> {
  const file = /\.(gz|json)$/.test(name) ? name : name.replace(/(\.tsv)?$/, '.tsv.gz');
  const raw = await readFile(join(__dirname, '..', '..', 'public', 'data', file));
  return file.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
}

const SENTENCE = '我们在银行门口见面，他慢慢地走了过来。';
export const CHAPTERS: Chapter[] = [
  { title: '第一章', blocks: Array.from({ length: 30 }, (_, i) => ({ t: 'p' as const, text: `第${i}段，${SENTENCE.repeat(6)}` })) },
];

export async function bootApp(): Promise<{ store: Store; meta: BookMeta }> {
  window.matchMedia = ((media: string) => ({
    matches: false, media, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  localStorage.setItem('dushu.settings.v1', JSON.stringify({ layout: 'scroll', pinyin: 'all', scrollFontSize: 28, translator: 'gloss' }));
  localStorage.setItem('dushu.reader-hint.v1', '1');
  document.body.innerHTML = '<div id="app"></div>';
  const store = await openStore();
  const meta = await store.books.add({ title: '测试书', author: 'T', format: 'paste', script: 'simplified', chapters: CHAPTERS, assets: new Map() });
  await import('../../src/main');
  await vi.waitFor(() => { if (!document.querySelector('.app-nav')) throw new Error('no nav yet'); });
  return { store, meta };
}

/** Go to a route the way a link does. */
export async function go(hash: string): Promise<void> {
  location.hash = hash;
  await new Promise((r) => setTimeout(r, 5));
}

/** The reader is open and every block of its chapter is drawn. */
export async function readerDrawn(): Promise<void> {
  await vi.waitFor(() => {
    const blocks = [...document.querySelectorAll('.rd-article > [data-b]')];
    if (!blocks.length || blocks.some((b) => !b.childNodes.length)) throw new Error('not drawn yet');
  });
}
