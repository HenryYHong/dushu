// @vitest-environment jsdom
// The chapter drawer's Words tab: what it lists, the share of the chapter known, and saving / marking known from a row.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BookMeta, Dictionary } from '../../src/types';
import type { LangEngine, LangId } from '../../src/lang/types';
import { chapterWords } from '../../src/core/chapterWords';
import { createToc } from '../../src/ui/reader/toc';
import { setLangForTests } from '../../src/lang/active';
import { noChineseDictionary } from '../../src/lang/noChinese';
import { loadJa } from '../lang/ja/load';
import { loadLang } from '../lang/spaced/load';
import { makeCtx, stubBrowser, tick } from './helpers';
import { Blob as NodeBlob } from 'node:buffer';

beforeAll(() => stubBrowser());
afterEach(() => { document.body.innerHTML = ''; });

const CHAPTERS = [
  '我们在银行门口见面。银行很大。我们一起去吃饭。',
  '月亮升起来了。街上的人都回家了。',
];

async function setup(chapters = CHAPTERS) {
  const { ctx, dict } = await makeCtx();
  const book: BookMeta = {
    id: 'b1', title: '书', author: '', format: 'paste', script: 'simplified', addedAt: 0,
    chapterCount: CHAPTERS.length, charCount: 40, chapterOffsets: [], chapterTitles: ['第一章', '第二章'],
  } as BookMeta;
  const opened: { word: string; sentence: string; chapter: number }[] = [];
  const toc = createToc(ctx, book, () => {}, undefined, {
    words: {
      load: (i) => chapterWords([chapters[i]], dict as Dictionary, undefined, { pause: async () => {} }),
      onWord: (w, _a, chapter) => opened.push({ word: w.word, sentence: w.sentence, chapter }),
    },
  });
  return { ctx, toc, opened };
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.rd-words .rd-word')];
const rowOf = (w: string) => rows().find((r) => r.querySelector('.rd-name-word')?.textContent === w)!;
const share = () => document.querySelector('.rd-words-share')!.textContent ?? '';

describe('Words tab', () => {
  it('lists the chapter\'s words, most frequent first, with how much is known', async () => {
    const { toc } = await setup();
    toc.open(0, 'words');
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(3));
    expect(document.querySelector('.rd-toc')!.getAttribute('aria-label')).toBe('Words in this chapter');
    expect(document.querySelector('.rd-words-chapter')!.textContent).toBe('第一章');
    // 我们 and 银行 come up twice: they lead.
    const first = rows().slice(0, 2).map((r) => r.querySelector('.rd-name-word')!.textContent).sort();
    expect(first).toEqual(['我们', '银行']);
    expect(rowOf('银行').querySelector('.rd-name-py')!.textContent).toBe('yínháng');
    expect(rowOf('银行').querySelector('.rd-word-gloss')!.textContent).toMatch(/bank/);
    expect(share()).toMatch(/^0% of the words in this chapter are ones you know\./);
    expect(share()).toMatch(/Mark words you know/);
    toc.dispose();
  });

  it('saves a word with the sentence it first occurs in, and marks one known in place', async () => {
    const { ctx, toc } = await setup();
    toc.open(0, 'words');
    await vi.waitFor(() => expect(rowOf('银行')).toBeTruthy());
    rowOf('银行').querySelector<HTMLButtonElement>('[data-k="save"]')!.click();
    await vi.waitFor(async () => expect(await ctx.store.vocab.get('银行')).toBeTruthy());
    const item = (await ctx.store.vocab.get('银行'))!;
    expect(item.context).toEqual({ sentence: '我们在银行门口见面。', bookId: 'b1', bookTitle: '书', chapter: 0 });
    expect(item.pinyin).toBe('yin2 hang2');
    expect(item.gloss).toMatch(/bank/);
    await vi.waitFor(() => expect(rowOf('银行').querySelector('[data-k="save"]')!.getAttribute('aria-pressed')).toBe('true'));

    const before = rows().length;
    rowOf('我们').querySelector<HTMLButtonElement>('[data-k="known"]')!.click();
    await vi.waitFor(() => expect(ctx.store.known.has('我们')).toBe(true));
    // The row stays (one tap undoes a slip), dimmed; the share goes up.
    await vi.waitFor(() => expect(rowOf('我们').hasAttribute('data-known')).toBe(true));
    expect(rows().length).toBe(before);
    expect(share()).not.toMatch(/^0%/);
    rowOf('我们').querySelector<HTMLButtonElement>('[data-k="known"]')!.click();
    await vi.waitFor(() => expect(ctx.store.known.has('我们')).toBe(false));
    toc.dispose();
  });

  it('filters, shows known words under All, sorts in order, and steps to another chapter', async () => {
    const { ctx, toc, opened } = await setup();
    await ctx.store.known.add(['我们']);
    toc.open(0, 'words');
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(3));
    expect(rowOf('我们')).toBeUndefined();
    const chip = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('.rd-words-chip')].find((b) => b.textContent === t)!;
    chip('All').click();
    expect(rowOf('我们')).toBeTruthy();
    chip('In order').click();
    expect(rows()[0].querySelector('.rd-name-word')!.textContent).toBe('我们');
    const filter = document.querySelector<HTMLInputElement>('.rd-words-filter')!;
    filter.value = 'bank';
    filter.dispatchEvent(new Event('input'));
    expect(rows().map((r) => r.querySelector('.rd-name-word')!.textContent)).toEqual(['银行']);
    rowOf('银行').querySelector<HTMLButtonElement>('.rd-word-main')!.click();
    expect(opened).toEqual([{ word: '银行', sentence: '我们在银行门口见面。', chapter: 0 }]);

    document.querySelector<HTMLButtonElement>('.rd-words-step[aria-label="Next chapter"]')!.click();
    await vi.waitFor(() => expect(rowOf('月亮')).toBeTruthy());
    expect(document.querySelector('.rd-words-chapter')!.textContent).toBe('第二章');
    expect(document.querySelector<HTMLButtonElement>('.rd-words-step[aria-label="Next chapter"]')!.disabled).toBe(true);
    toc.dispose();
  });

  it('shows the HSK level of the chapter\'s most common reading of a word, and none for a reading the list does not have', async () => {
    // 教 twice as jiào "make" and once as jiāo "teach", the list's HSK 1 word: the row reads jiào, with no level.
    const { toc } = await setup(['这件事教人担心。那件事也教人难过。他教我写字。他在银行工作。', '月亮升起来了。']);
    toc.open(0, 'words');
    await vi.waitFor(() => expect(rowOf('银行')).toBeTruthy());
    const level = (w: string) => rowOf(w).querySelector('.rd-word-hsk')?.textContent ?? null;
    expect(rowOf('教').querySelector('.rd-name-py')!.textContent).toBe('jiào');
    expect(level('教')).toBeNull();
    expect(level('银行')).toBe('HSK 2');
    toc.dispose();
  });

  it('opens on the W key path (open with the words tab) and is reachable as a tab', async () => {
    const { toc } = await setup();
    toc.open(1);
    const tab = [...document.querySelectorAll<HTMLButtonElement>('.rd-toc-tab')].map((b) => b.textContent);
    expect(tab).toEqual(['Chapters', 'Words']);
    [...document.querySelectorAll<HTMLButtonElement>('.rd-toc-tab')][1].click();
    await tick(0);
    await vi.waitFor(() => expect(rowOf('月亮')).toBeTruthy());
    expect((document.querySelector('.rd-toc-list:not(.rd-words)') as HTMLElement).hidden).toBe(true);
    toc.dispose();
  });
});

describe('Words tab in other languages', () => {
  afterEach(() => setLangForTests('zh'));
  // The engines unzip their data with Blob.stream(), which jsdom's Blob lacks: they load with Node's.
  let ja: LangEngine;
  let de: LangEngine;
  let es: LangEngine;
  beforeAll(async () => {
    const jsdomBlob = globalThis.Blob;
    globalThis.Blob = NodeBlob as unknown as typeof Blob;
    try { [ja, de, es] = await Promise.all([loadJa(), loadLang('de'), loadLang('es')]); } finally { globalThis.Blob = jsdomBlob; }
  }, 60000);

  async function setupLang(id: LangId, engine: LangEngine, chapter: string) {
    setLangForTests(id, engine);
    const { ctx } = await makeCtx();
    const book = {
      id: 'b2', title: 'Book', author: '', format: 'paste', script: 'original', addedAt: 0,
      chapterCount: 1, charCount: chapter.length, chapterOffsets: [], chapterTitles: ['One'],
    } as unknown as BookMeta;
    const toc = createToc(ctx, book, () => {}, undefined, {
      words: { load: () => chapterWords([chapter], noChineseDictionary(engine), undefined, { pause: async () => {} }), onWord: () => {} },
    });
    return { ctx, toc };
  }
  const glossOf = (w: string) => rowOf(w).querySelector('.rd-word-gloss')!.textContent ?? '';
  const filterBy = (q: string) => {
    const filter = document.querySelector<HTMLInputElement>('.rd-words-filter')!;
    filter.value = q;
    filter.dispatchEvent(new Event('input'));
    return rows().map((r) => r.querySelector('.rd-name-word')!.textContent);
  };

  it('Japanese: gives the particles their meaning in the sentence, and saves them as particles', async () => {
    const { ctx, toc } = await setupLang('ja', ja, 'お釈迦様は池のふちを歩いていた。男は門の前に立って、友と話した。');
    toc.open(0, 'words');
    await vi.waitFor(() => expect(rowOf('は')).toBeTruthy());
    expect(glossOf('は')).toMatch(/topic/);
    expect(glossOf('は')).not.toMatch(/tooth/);
    expect(glossOf('に')).not.toMatch(/two/);
    expect(glossOf('と')).not.toMatch(/door/);
    rowOf('は').querySelector<HTMLButtonElement>('[data-k="save"]')!.click();
    await vi.waitFor(async () => expect(await ctx.store.vocab.get('は')).toBeTruthy());
    const item = (await ctx.store.vocab.get('は'))!;
    expect(item.simp).toBe('は');
    expect(item.gloss).toMatch(/topic/);
    toc.dispose();
  }, 60000);

  it('German and Spanish: the filter finds a word whatever its case and accents, and by a form of it', async () => {
    const a = await setupLang('de', de, 'Ach, was muß man oft von bösen Kindern hören oder lesen! Das Vorwort ist kurz. Das Kind liest.');
    a.toc.open(0, 'words');
    await vi.waitFor(() => expect(rowOf('Vorwort')).toBeTruthy());
    [...document.querySelectorAll<HTMLButtonElement>('.rd-words-chip')].find((b) => b.textContent === 'All')!.click();
    for (const q of ['Vorwort', 'vorwort', 'Vorw', 'VORWORT']) expect(filterBy(q), q).toContain('Vorwort');
    expect(filterBy('kind')).toContain('Kind');
    expect(filterBy('Kindern')).toContain('Kind');
    expect(filterBy('bose')).toContain('böse');
    a.toc.dispose();
    document.body.innerHTML = '';

    const b = await setupLang('es', es, 'También vino el médico. Después se fue.');
    b.toc.open(0, 'words');
    await vi.waitFor(() => expect(rowOf('también')).toBeTruthy());
    expect(filterBy('tambien')).toEqual(['también']);
    expect(filterBy('MEDICO')).toEqual(['médico']);
    b.toc.dispose();
  }, 60000);

  it('says how to mark whole levels without naming the scheme twice', async () => {
    const { toc } = await setupLang('es', es, 'Había una vez un hombre.');
    toc.open(0, 'words');
    await vi.waitFor(() => expect(share()).toMatch(/Mark words you know/));
    expect(share()).toContain('or mark whole levels as known in Vocabulary.');
    expect(share()).not.toMatch(/Level levels/);
    toc.dispose();
  }, 60000);
});
